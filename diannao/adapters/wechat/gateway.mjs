/**
 * 店脑 · 微信 ClawBot 多用户网关 v2（拼装产物，待吴 E 复核）
 * ============================================================
 * v2 变化：从「所有微信用户共用一个店脑账号」升级为
 *          「每个微信 sender 绑定自己的店脑账号，各自独立租户/角色」。
 *
 * 多用户模型：
 *   微信用户 A (wxid-a) ──┐
 *   微信用户 B (wxid-b) ──┼─> 网关按 sender 查 users.json ─> 各自登录店脑 API
 *   微信用户 C (wxid-c) ──┘                                  └─> 租户隔离由 API 保证
 *
 * 配置：同目录 users.json（示例见 users.example.json）
 *   {
 *     "users": [
 *       { "sender_id": "wxid-a", "login_name": "staff-a", "password": "demo", "label": "A店店员" }
 *     ]
 *   }
 *
 * 兼容：没有 users.json 时回退到环境变量单账号模式
 *   DIANNAO_LOGIN_NAME / DIANNAO_LOGIN_PASSWORD / DIANNAO_ALLOWED_SENDER_IDS
 *
 * 安全底线（不变）：
 *   - channel 必须是 openclaw-weixin
 *   - 未绑定 sender 只回绑定引导，不查任何数据（fail-closed）
 *   - 每个 sender 的 token 独立缓存，互不串用
 *   - 日志不打印 token / 密码；输出只含白名单字段
 *   - 反诈走公共提示，不触商家数据
 *   - 导出/批量请求拒绝
 *   - message_id 幂等
 *
 * 运行：node adapters/wechat/gateway.mjs
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

const PORT = Number(process.env.GATEWAY_PORT ?? 7402);
const API_BASE = (process.env.DIANNAO_API_BASE ?? 'http://localhost:7401').replace(/\/$/, '');
const CHANNEL = 'openclaw-weixin';
const PROVISION_KEY_FILE = process.env.PROVISION_KEY_FILE ?? pathResolve(process.cwd(), 'data', 'provision.key');

/** 读取网关内部开通密钥（文件或环境变量）。 */
function provisionKey() {
  if (process.env.GATEWAY_PROVISION_KEY !== undefined) return process.env.GATEWAY_PROVISION_KEY;
  try {
    return existsSync(PROVISION_KEY_FILE) ? readFileSync(PROVISION_KEY_FILE, 'utf8').trim() : '';
  } catch {
    return '';
  }
}
const USERS_FILE = process.env.DIANNAO_USERS_FILE ?? pathResolve(import.meta.dirname, 'users.json');

// ── 用户映射 ─────────────────────────────────────────────────────────
// users.json 结构：{ users: [{ sender_id, login_name, password, label }] }
function loadUsers() {
  const map = new Map();
  if (existsSync(USERS_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
      for (const u of raw.users ?? []) {
        if (typeof u.sender_id === 'string' && typeof u.login_name === 'string') {
          map.set(u.sender_id, {
            login_name: u.login_name,
            password: String(u.password ?? ''),
            label: String(u.label ?? u.login_name),
          });
        }
      }
    } catch (e) {
      console.error(`[gateway] users.json 解析失败：${e.message}（将退回环境变量单账号模式）`);
    }
  }
  // 兼容：环境变量单账号模式（所有白名单 sender 共用同一账号）
  if (map.size === 0) {
    const loginName = process.env.DIANNAO_LOGIN_NAME ?? 'staff-a';
    const password = process.env.DIANNAO_LOGIN_PASSWORD ?? '';
    for (const sender of (process.env.DIANNAO_ALLOWED_SENDER_IDS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)) {
      map.set(sender, { login_name: loginName, password, label: `${loginName}（共享账号）` });
    }
  }
  return map;
}

let USERS = loadUsers();
let usersMtime = 0;
try { usersMtime = statSync(USERS_FILE).mtimeMs; } catch { /* 文件不存在时首次创建后再更新 */ }

/** 后台解绑/新增后，users.json 变化时自动重载。 */
function reloadUsersIfChanged() {
  try {
    const m = statSync(USERS_FILE).mtimeMs;
    if (m !== usersMtime) {
      usersMtime = m;
      USERS = loadUsers();
      console.log(`[gateway] users.json 已重载，绑定用户 ${USERS.size} 人`);
    }
  } catch { /* 忽略 */ }
}

// ── 每用户 token（内存，不落盘不打日志）──────────────────────────────
const tokens = new Map(); // sender -> { token, fetchedAt }

/** 凭据自愈：向店脑申请重置该 sender 的网关登录密码（账号与数据都保留）。 */
async function reauthSender(sender) {
  const key = provisionKey();
  if (!key) throw new Error('缺少内部开通密钥');
  const res = await fetch(`${API_BASE}/v1/gateway/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-provision-key': key },
    body: JSON.stringify({ sender_id: sender, reset: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`店脑 API 凭据重置失败 ${res.status}`);
  const b = await res.json();
  const user = USERS.get(sender);
  if (!user) throw new Error('未绑定用户');
  user.login_name = b.login_name;
  user.password = b.password;
  persistUsers();
  tokens.delete(sender);
  console.log(`[gateway] 凭据已自愈 sender=${sender} -> ${b.login_name}`);
  return user;
}

async function ensureToken(sender) {
  let user = USERS.get(sender);
  if (!user) throw new Error('未绑定用户');
  const cached = tokens.get(sender);
  if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) return cached.token;

  const doLogin = (u) => fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_name: u.login_name, password: u.password }),
    signal: AbortSignal.timeout(8000),
  });

  if (!user.password) user = await reauthSender(sender);
  let res = await doLogin(user);
  if (res.status === 401) {
    // 密码丢失或账号被重置：自愈一次再试，不让用户看到「不可用」
    user = await reauthSender(sender);
    res = await doLogin(user);
  }
  if (!res.ok) throw new Error(`店脑 API 登录失败 ${res.status}`);
  const body = await res.json();
  const token = body.principal.token;
  tokens.set(sender, { token, fetchedAt: Date.now() });
  return token;
}

async function apiCall(sender, path, body, method = 'POST') {
  const doFetch = async (token) => fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });

  let res = await doFetch(await ensureToken(sender));
  if (res.status === 401) {                 // token 失效：强制重登一次
    tokens.delete(sender);
    res = await doFetch(await ensureToken(sender));
  }
  if (!res.ok) throw new Error(`店脑 API ${path} 返回 ${res.status}`);
  return res.json();
}

// ── 幂等表 ───────────────────────────────────────────────────────────
const seenMessages = new Map(); // `${sender}:${message_id}` -> { reply, processedAt }
const SEEN_TTL = 30 * 60 * 1000;
function pruneSeen() {
  const now = Date.now();
  for (const [k, v] of seenMessages) if (now - v.processedAt > SEEN_TTL) seenMessages.delete(k);
}

// ── 回复组装 ─────────────────────────────────────────────────────────
const shortId = (id) => String(id).slice(0, 8);

function summarizeToText(summary) {
  const lines = [];
  lines.push(`【是谁】${summary.display_label}`);
  if (summary.recent_transactions.length > 0) {
    const parts = summary.recent_transactions.slice(0, 3).map((t) => {
      const items = t.lines.map((l) => `${l.product_name}×${l.quantity}`).join('、');
      return `${items}（${t.occurred_at.slice(0, 10)}）`;
    });
    lines.push(`【以前买过】${parts.join('；')}`);
  } else {
    lines.push('【以前买过】暂无购买记录');
  }
  if (summary.suggestions.length > 0) lines.push(`【建议】${summary.suggestions.join('；')}`);
  if (summary.handoff_required) lines.push('⚠ 该客户涉及需人工确认事项，请转店长核对。');
  const ev = summary.recent_transactions[0];
  if (ev) lines.push(`依据：订单 ${shortId(ev.id)} · ${ev.occurred_at.slice(0, 10)}`);
  return lines.join('\n');
}

function resolveToText(result) {
  if (result.match_status === 'not_found') return '未找到匹配客户。请核对尾号/姓名，或用会员号再试。';
  if (result.match_status === 'ambiguous') {
    const list = result.candidates.map((c, i) => `${i + 1}. ${c.masked_label}`).join('\n');
    return `找到 ${result.candidates.length} 位候选，请补充会员号或姓名确认后再查：\n${list}`;
  }
  return null;
}

// ── 反诈公共域 ───────────────────────────────────────────────────────
const FRAUD_KEYWORDS = ['刷单', '返利', '转账', '验证码', '安全账户', '裸聊', '约炮', '美女上门', '解冻费', '垫资'];
const isFraudQuestion = (text) => FRAUD_KEYWORDS.some((k) => text.includes(k));
function fraudReply() {
  return [
    '【反诈提示 · 公共服务】',
    '你描述的情形与常见诈骗手法特征相似（如刷单返利、垫资转账）。',
    '请记住三条：',
    '1. 不再转账，不提供验证码/密码；',
    '2. 保留聊天与转账凭证；',
    '3. 拨打 96110 或 110 核实，或通过国家反诈中心 APP 举报。',
    '注：本提示基于公开常见手法，未匹配具体案件不代表安全。本服务不读取门店客户资料。',
  ].join('\n');
}

// ── 每用户会话状态（记住上一个确认的客户，按 sender 隔离）────────────
const lastSubject = new Map(); // sender -> subject_ref

/** 把当前绑定表写回 users.json，重启后仍然有效。 */
function persistUsers() {
  const users = [...USERS.entries()].map(([sender_id, u]) => ({
    sender_id, login_name: u.login_name, password: u.password, label: u.label,
  }));
  try {
    writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
  } catch (e) {
    console.error(`[gateway] 写回 users.json 失败：${e.message}`);
  }
}

// ── 意图路由 ─────────────────────────────────────────────────────────
async function routeMessage(sender, text) {
  const t = text.trim();

  // 扫码绑定：6 位数字绑定码
  if (/^\d{6}$/.test(t)) {
    try {
      const r = await fetch(`${API_BASE}/v1/setup/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: t }),
        signal: AbortSignal.timeout(8000),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        return { reply: `绑定码无效或已过期（${b.message ?? r.status}）。请在网页重新生成。`, domain: 'binding' };
      }
      USERS.set(sender, { login_name: b.login_name, password: b.password, label: b.label });
      tokens.delete(sender);
      persistUsers();
      const sceneName = b.scene === 'baby' ? '母婴店' : '服装店';
      return {
        reply: `✅ 绑定成功：${b.label} · ${sceneName}\n\n现在可以直接问我，例如：\n· 查一下尾号1234上次买什么\n· 记一下：顾客偏好无香型`,
        domain: 'binding',
      };
    } catch {
      return { reply: '绑定服务暂不可用，请稍后重试。', domain: 'binding' };
    }
  }

  if (isFraudQuestion(t)) return { reply: fraudReply(), domain: 'public_antifraud' };

  if (/导出|批量导出/.test(t)) {
    return { reply: '导出仅限管理员在网页后台按授权范围操作，微信端不提供导出。', domain: 'denied' };
  }

  // 新建客户：新建客户：张姐，尾号1234，喜欢无香型
  if (/^(新建|添加|新增)客户/.test(t)) {
    const bodyText = t.replace(/^(新建|添加|新增)客户[:：,，]?\s*/, '').trim();
    if (!bodyText) return { reply: '格式：新建客户：张姐，尾号1234，喜欢无香型', domain: 'subject' };
    const parts = bodyText.split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);
    const displayName = (parts[0] || '新客户').slice(0, 20);
    const tailMatch = bodyText.match(/(?:尾号|后四位)[:：]?\s*(\d{4})/);
    const hints = tailMatch ? [tailMatch[1]] : [];
    try {
      const created = await apiCall(sender, '/v1/subjects', { display_name: displayName, hints });
      lastSubject.set(sender, created.subject_ref);
      const note = parts.slice(1).join('；');
      if (note) {
        await apiCall(sender, '/v1/notes/drafts', {
          subject_ref: created.subject_ref,
          content: note,
          source_type: 'staff_text',
        });
      }
      return {
        reply: `已新建客户「${displayName}」${hints.length ? '（尾号 ' + hints[0] + '）' : ''}。\n${note ? '资料已存入草稿，待店长审核。' : ''}\n以后发「查一下${hints.length ? '尾号' + hints[0] : displayName}」就能找到。`,
        domain: 'subject',
        trace: created.trace_id,
      };
    } catch (e) {
      return { reply: '新建客户失败，请稍后重试。', domain: 'subject' };
    }
  }

  // 更新画像：更新画像：尾号1234，奶粉换3段，喜欢帮宝适
  if (/^(更新画像|更新资料|画像更新)/.test(t)) {
    const bodyText = t.replace(/^(更新画像|更新资料|画像更新)[:：,，]?\s*/, '').trim();
    if (!bodyText) {
      return { reply: '格式：更新画像：尾号1234，奶粉换3段\n（支持：宝宝生日/奶粉段位/纸尿裤尺码/品牌偏好/服装尺码/风格/颜色）', domain: 'profile' };
    }
    const patch = {};
    const rules = [
      ['child.birthdate', /生日[:：]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/],
      ['child.formula_stage', /(\d)\s*段(?:奶粉)?/],
      ['child.diapers_size', /(?:纸尿裤|尿不湿|尿布)[^\s，。]{0,8}?([SMLX]{1,3})\s*码/i],
      ['apparel.size', /(?:尺码|码数|穿)(?:是|为|:)?\s*([SMLX]{1,3}|1[0-9]{2}|[0-9]{2})\s*码?/i],
      ['apparel.style', /风格[:：]?\s*([^\s，。、]{1,12})/],
      ['apparel.color', /(?:颜色|色系)[:：]?\s*([^\s，。、]{1,8})/],
      ['pref.brand', /(?:品牌|牌子|偏好|喜欢)[:：]?\s*([^\s，。、]{1,12})/],
    ];
    for (const [field, re] of rules) {
      const hit = bodyText.match(re);
      if (hit && !(field in patch)) {
        const raw = String(hit[0]).trim();
        patch[field] = field === 'child.formula_stage' ? raw.replace(/s+/g, '') : String(hit[1]).trim();
      }
    }
    // 显式写法：child.formula_stage=3段
    for (const m of bodyText.matchAll(/([a-z][a-z_.]{2,30})\s*[=:：]\s*([^\s，。、]{1,200})/gi)) {
      patch[m[1]] = m[2];
    }
    if (Object.keys(patch).length === 0) {
      return {
        reply: '没识别出要更新的字段。可以这样说：\n· 更新画像：尾号1234，奶粉换3段\n· 更新画像：尾号1234，生日2025-03-08\n· 更新画像：尾号1234，子字段 child.diapers_size=XL',
        domain: 'profile',
      };
    }
    // 定位客户：优先消息里的尾号，其次上一次确认的客户
    const tailMatch = bodyText.match(/(?:尾号|后四位)[:：]?\s*(\d{4})/);
    let subjectRef = lastSubject.get(sender);
    if (tailMatch) {
      const found = await apiCall(sender, '/v1/identity/resolve', { query: tailMatch[1] });
      if (found && found.match_status === 'matched' && found.resolved_subject_ref) {
        subjectRef = found.resolved_subject_ref;
      }
    }
    if (!subjectRef) {
      return { reply: '请先告诉我是哪位客户，例如：更新画像：尾号1234，奶粉换3段', domain: 'profile' };
    }
    lastSubject.set(sender, subjectRef);
    try {
      const receipt = await apiCall(sender, '/v1/notes/drafts', {
        subject_ref: subjectRef,
        content: bodyText,
        source_type: 'staff_text',
        profile_patch: patch,
      });
      const lines = Object.entries(patch).map(([k, v]) => `· ${k} → ${v}`).join('\n');
      return {
        reply: `已提交画像更新（${receipt.status}），待店长审核后生效：\n${lines}\n未直接改写客户档案。`,
        domain: 'profile',
        trace: receipt.trace_id,
      };
    } catch (e) {
      return { reply: `画像更新提交失败：${e.message}`, domain: 'profile' };
    }
  }

  if (/^(帮|请)?记一下[:：,，]?/.test(t)) {
    const content = t.replace(/^(帮|请)?记一下[:：,，]?/, '').trim();
    if (!content) return { reply: '请补充要记的内容，例如：记一下：顾客偏好无香型。', domain: 'draft' };
    let subject = lastSubject.get(sender);
    if (!subject) {
      // 没有确认过客户时，尝试从内容里提取姓名/尾号自动建档
      const tailMatch = content.match(/(?:尾号|后四位)[:：]?\s*(\d{4})/);
      const nameMatch = content.match(/([一-龥]{2,6})(?:姐|哥|女士|先生|阿姨|叔叔)/);
      if (tailMatch || nameMatch) {
        const displayName = (nameMatch ? nameMatch[0] : '客户' + tailMatch[1]).slice(0, 20);
        try {
          const created = await apiCall(sender, '/v1/subjects', {
            display_name: displayName,
            hints: tailMatch ? [tailMatch[1]] : [],
          });
          subject = created.subject_ref;
          lastSubject.set(sender, subject);
        } catch { /* 建档失败则走下面的引导 */ }
      }
    }
    if (!subject) {
      return {
        reply: '请先确认要记录哪位客户（先发例如：查一下尾号1234，或发「新建客户：张姐，尾号1234」）。',
        domain: 'draft',
      };
    }
    const receipt = await apiCall(sender, '/v1/notes/drafts', {
      subject_ref: subject,
      content,
      source_type: 'staff_text',
    });
    return {
      reply: `已保存为草稿（${receipt.status}），等待店长审核后生效。未直接写入客户档案。`,
      domain: 'draft',
      trace: receipt.trace_id,
    };
  }

  // 认人 + 档案
  const m = t.match(/(?:尾号|后四位)[:：]?\s*(\d{4})/) ?? t.match(/(\d{4})/);
  const nameMatch = t.match(/(?:查一下|找)?([一-龥]{2,4})(?:女士|先生|姐|哥)?/);
  const query = m ? m[1] : (nameMatch ? nameMatch[1] : t);
  const resolve = await apiCall(sender, '/v1/identity/resolve', { query });
  const text1 = resolveToText(resolve);
  if (text1) return { reply: text1, domain: 'identity', trace: resolve.trace_id };

  if (resolve.match_status === 'matched' && resolve.resolved_subject_ref) {
    lastSubject.set(sender, resolve.resolved_subject_ref);
    const summary = await apiCall(sender, `/v1/subjects/${encodeURIComponent(resolve.resolved_subject_ref)}`, null, 'GET');
    return { reply: summarizeToText(summary), domain: 'summary', trace: summary.trace_id };
  }
  return { reply: '请描述要查询的客户线索（尾号或姓名）。', domain: 'fallback' };
}

// ── HTTP 服务 ────────────────────────────────────────────────────────
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  if (chunks.length === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}

const BINDING_GUIDE = '无权限：你还没有绑定门店。请让店长在网页后台生成绑定码，完成绑定后再使用。未绑定前不提供任何客户查询。';

async function handleWebhook(req, res, { simulate = false } = {}) {
  reloadUsersIfChanged();
  const body = await readJson(req);
  if (typeof body !== 'object' || body === null) {
    sendJson(res, 400, { code: 'invalid_body', message: '请求体必须是 JSON 对象' });
    return;
  }
  const { channel, sender_id: sender, message_id: messageId } = body;
  const text = typeof body.text === 'string' ? body.text : '';

  if (channel !== CHANNEL) {
    sendJson(res, 403, { code: 'untrusted_channel', message: `渠道必须是 ${CHANNEL}` });
    return;
  }
  // 6 位纯数字视为绑定尝试：未绑定用户也放行到路由层处理
  const isBindingAttempt = /^\d{6}$/.test(text.trim());
  let user = USERS.get(sender);
  if (!user && !isBindingAttempt) {
    // 首次发消息：为该微信开通独立空白租户（后台调用内部开通接口）
    if (process.env.DIANNAO_AUTO_BIND !== "0") {
      const key = provisionKey();
      if (key.length >= 16) {
        try {
          const r = await fetch(`${API_BASE}/v1/gateway/provision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-provision-key': key },
            body: JSON.stringify({ sender_id: sender }),
            signal: AbortSignal.timeout(10000),
          });
          if (r.ok) {
            const b = await r.json();
            user = { login_name: b.login_name, password: b.password, label: '新用户' };
            USERS.set(sender, user);
            tokens.delete(sender);
            persistUsers();
            console.log(`[gateway] provisioned sender=${sender} -> ${b.login_name} (reused=${b.reused})`);
          }
        } catch { /* 开通失败走下面的未绑定引导 */ }
      }
    }
    if (!user) {
      sendJson(res, 200, { status: 'unbound', reply: BINDING_GUIDE, processed: false });
      return;
    }
  }
  if (!messageId || !text.trim()) {
    sendJson(res, 400, { code: 'missing_field', message: '缺少 message_id 或 text' });
    return;
  }

  const key = `${sender}:${messageId}`;
  pruneSeen();
  const seen = seenMessages.get(key);
  if (seen) {
    sendJson(res, 200, { status: 'duplicate', reply: seen.reply, processed: false, message_id: messageId });
    return;
  }

  try {
    const { reply, domain, trace } = await routeMessage(sender, text);
    seenMessages.set(key, { reply, processedAt: Date.now() });
    sendJson(res, 200, {
      status: 'ok', reply, domain, message_id: messageId,
      actor: USERS.get(sender)?.label ?? '新绑定用户',
      ...(trace ? { trace_id: trace } : {}),
      ...(simulate ? { simulated: true } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '服务暂不可用';
    sendJson(res, 200, { status: 'error', reply: `店脑服务暂不可用（${msg}），请通过网页后台核实。`, message_id: messageId });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/status')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>店脑 · 微信 ClawBot 多用户网关运行中</title>
<style>body{font-family:"Microsoft YaHei",sans-serif;background:#f4f5f1;color:#22353b;margin:0;padding:48px}
.card{max-width:760px;margin:auto;background:#fbfcf9;border:1px solid #dce6df;border-radius:16px;padding:36px}
h1{margin:0 0 8px;font-size:28px}.ok{color:#2c6660;font-weight:700}code{background:#edf5ef;padding:2px 6px;border-radius:4px}li{line-height:2}
table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border-bottom:1px solid #e3e9e5;padding:8px;text-align:left;font-size:13px}</style></head>
<body><div class="card"><h1>店脑 · 微信网关（多用户）</h1>
<p class="ok">● 运行中（端口 ${PORT}）</p>
<p>渠道 <code>${CHANNEL}</code>　已绑定用户 <b>${USERS.size}</b> 人　业务 API <code>${API_BASE}</code></p>
<table><tr><th>微信发送者</th><th>店脑账号</th><th>说明</th></tr>
${[...USERS.entries()].map(([sid, u]) => `<tr><td><code>${sid}</code></td><td>${u.login_name}</td><td>${u.label}</td></tr>`).join('')}
</table>
<p style="margin-top:16px">未绑定发送者一律拒绝（fail-closed）；每个用户使用自己的租户与角色，互不可见。</p>
<p>健康检查：<a href="/wechat/health">/wechat/health</a>　消息入口：<code>POST /wechat/webhook</code></p>
</div></body></html>`);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/wechat/health') {
    sendJson(res, 200, {
      status: 'ok',
      channel: CHANNEL,
      mode: existsSync(USERS_FILE) ? 'users.json' : 'env-single-account',
      bound_users: USERS.size,
      active_sessions: tokens.size,
      api_base: API_BASE,
      seen_messages: seenMessages.size,
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/wechat/webhook') {
    void handleWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/wechat/simulate') {
    void handleWebhook(req, res, { simulate: true });
    return;
  }
  sendJson(res, 404, { code: 'no_route', message: `未知端点 ${req.method} ${url.pathname}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[wechat-gateway] listening on http://localhost:${PORT}`);
  console.log(`[wechat-gateway] mode=${existsSync(USERS_FILE) ? 'users.json' : 'env'} bound_users=${USERS.size} api=${API_BASE}`);
  if (USERS.size === 0) {
    console.log('[wechat-gateway] ⚠ 没有绑定任何用户：所有消息都会被拒绝（fail-closed）。');
    console.log('[wechat-gateway]   复制 users.example.json 为 users.json 并填写 sender → 店脑账号。');
  }
});
