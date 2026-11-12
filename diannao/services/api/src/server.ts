/**
 * 店脑 · 业务 API（API-01~04 完整版）
 * 主责：B 邱
 *
 * 零框架依赖（Node 内置 http），内存数据，启动即用。
 * 端点：
 *   GET  /v1/health
 *   POST /v1/auth/login
 *   POST /v1/identity/resolve
 *   GET  /v1/subjects/:id
 *   POST /v1/assistant/ask
 *   POST /v1/notes/drafts
 *   POST /v1/notes/:id/approve
 *   GET  /v1/reminders
 *   POST /v1/memberships/:id/revoke          ← API-02 撤权失效
 *   GET  /v1/products                        ← API-02 商品记录
 *   POST /v1/products                        ← API-02 商品记录
 *   POST /v1/imports/preview                 ← API-03 导入预览
 *   POST /v1/imports/commit                  ← API-03 导入提交（幂等）
 *   GET  /v1/exports/:resource               ← API-03 导出（留审计）
 *   GET  /v1/knowledge                       ← API-04 知识列表
 *   POST /v1/knowledge                       ← API-04 提交草稿
 *   POST /v1/knowledge/:id/review            ← API-04 审核流转
 *   GET  /v1/audit                           ← API-04 审计查询
 *
 * 错误统一 { code, message, trace_id }；失败必须返回明确错误码，不得静默成功。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  AuditAction,
  AuditQuery,
  DraftSourceType,
  KnowledgeApplicable,
  KnowledgeConstraint,
  KnowledgeReviewDecision,
  KnowledgeStatus,
  Role,
  SubjectType,
} from '../../../packages/contracts/index';
import { contentHash } from './csv';
import { assessFraud } from './fraud';
import QRCode from 'qrcode';
import { activeSessionCountForUser, authenticate, login, DEMO_PASSWORD, listAccounts, addAccount, removeAccount, resetPassword, promptTypeOf } from './auth';
import { loadSnapshot, snapshotInfo } from './db';
import { listWechatAccounts, addWechatAccount, readLoginLog, logoutWechatAccount } from './wechat-admin';
import { restoreSnapshot, getSnapshot, type StoreSnapshot, getMembershipByUser } from './store';
import {
  ask,
  approveDraft,
  commitImport,
  createDraft,
  createProduct,
  exportResource,
  getSummary,
  listKnowledge,
  listProducts,
  previewImport,
  listDrafts,
  queryAudit,
  resolveIdentity,
  reviewKnowledge,
  sanitizeProfilePatch,
  revokeMembership,
  SEED_REMINDERS,
  submitKnowledge,
  writeAudit,
  createSubject,
} from './store';

const PORT = Number(process.env.PORT ?? 7401);

let traceSeq = 0;
function nextTrace(): string {
  traceSeq += 1;
  return `trace-${Date.now()}-${traceSeq}`;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function sendJson(res: ServerResponse, status: number, body: unknown, traceId: string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-trace-id': traceId,
    ...CORS,
  });
  res.end(JSON.stringify(body));
}

function sendCsv(res: ServerResponse, csv: string, filename: string, traceId: string): void {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'x-trace-id': traceId,
    ...CORS,
  });
  res.end(csv);
}

function sendError(res: ServerResponse, status: number, code: string, message: string, traceId: string): void {
  sendJson(res, status, { code, message, trace_id: traceId }, traceId);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;
}

// ---------- 微信绑定表（与 adapters/wechat/users.json 共享） ----------
interface BindingEntry {
  sender_id: string;
  login_name: string;
  label: string;
}

/** 内部结构：含凭证，仅用于网关开通，不对外返回。 */
interface BindingEntryRaw extends BindingEntry {
  password?: string;
}

const USERS_FILE = process.env.DIANNAO_USERS_FILE ?? resolve(process.cwd(), 'adapters/wechat/users.json');
/** 网关内部开通密钥文件（不入库、不进仓库）。 */
const PROVISION_KEY_FILE = process.env.PROVISION_KEY_FILE ?? resolve(process.cwd(), 'data', 'provision.key');

function readBindingsRaw(): BindingEntryRaw[] {
  try {
    if (!existsSync(USERS_FILE)) return [];
    const raw = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as {
      users?: { sender_id?: string; login_name?: string; label?: string; password?: string }[];
    };
    return (raw.users ?? [])
      .filter((u) => typeof u.sender_id === 'string' && typeof u.login_name === 'string')
      .map((u) => ({
        sender_id: u.sender_id as string,
        login_name: u.login_name as string,
        label: typeof u.label === 'string' ? u.label : (u.login_name as string),
        password: typeof u.password === 'string' ? u.password : undefined,
      }));
  } catch {
    return [];
  }
}

/** 对外安全视图：不包含密码。 */
function readBindings(): BindingEntry[] {
  return readBindingsRaw().map((u) => ({ sender_id: u.sender_id, login_name: u.login_name, label: u.label }));
}

function writeBindings(items: BindingEntryRaw[]): void {
  writeFileSync(USERS_FILE, JSON.stringify({ users: items }, null, 2), 'utf8');
}

function provisionKey(): string {
  if (process.env.GATEWAY_PROVISION_KEY !== undefined) return process.env.GATEWAY_PROVISION_KEY;
  try {
    return existsSync(PROVISION_KEY_FILE) ? readFileSync(PROVISION_KEY_FILE, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

function removeBinding(senderId: string): boolean {
  const items = readBindingsRaw();   // 必须读原始结构，否则会丢掉网关登录用的 password
  const next = items.filter((u) => u.sender_id !== senderId);
  if (next.length === items.length) return false;
  writeBindings(next);
  return true;
}


/** 扫码绑定码：6 位数字，一次性，10 分钟有效。 */
interface BindingRecord {
  scene: string;
  label: string;
  login_name: string;
  password: string;
  expires_at: number;
  used: boolean;
}
const BINDING_CODES = new Map<string, BindingRecord>();
const BINDING_TTL_MS = 10 * 60 * 1000;

const SUBJECT_TYPES: readonly SubjectType[] = ['person', 'child', 'vehicle', 'family'];
const DRAFT_SOURCES: readonly DraftSourceType[] = ['staff_text', 'voice_transcript', 'image_extract', 'imported'];
const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = ['draft', 'pending_review', 'approved', 'archived'];
const REVIEW_DECISIONS: readonly KnowledgeReviewDecision[] = ['submit_review', 'approve', 'reject', 'archive'];
const MANAGER_ROLES: readonly Role[] = ['owner', 'hq', 'manager'];
const EXPORT_RESOURCES = ['customers', 'transactions', 'products'] as const;

function isManager(role: Role): boolean {
  return MANAGER_ROLES.includes(role);
}

// ---------- 简易滑动窗口限流（按 IP + 路径） ----------
interface RateRule {
  limit: number;
  windowMs: number;
}
const RATE_RULES: Record<string, RateRule> = {
  '/v1/auth/login': { limit: 10, windowMs: 60_000 },
  '/v1/auth/register': { limit: 5, windowMs: 3_600_000 },
  '/v1/setup/verify': { limit: 30, windowMs: 60_000 },
};
const RATE_HITS = new Map<string, number[]>();

function checkRate(path: string, ip: string): { limited: boolean; retryAfter: number } {
  const rule = RATE_RULES[path];
  if (rule === undefined) return { limited: false, retryAfter: 0 };
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return { limited: false, retryAfter: 0 }; // 本机网关调用不限流
  }
  const key = path + '|' + ip;
  const now = Date.now();
  const hits = (RATE_HITS.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (hits.length >= rule.limit) {
    const oldest = hits[0] as number;
    const retryAfter = Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000));
    RATE_HITS.set(key, hits);
    return { limited: true, retryAfter };
  }
  hits.push(now);
  RATE_HITS.set(key, hits);
  return { limited: false, retryAfter: 0 };
}

const server = createServer((req, res) => {
  void handle(req, res);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const traceId = nextTrace();
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (method === 'OPTIONS') {
    sendJson(res, 204, {}, traceId);
    return;
  }

  // 限流：登录/注册/绑定码校验
  const clientIp = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? 'unknown');
  const rate = checkRate(path, clientIp);
  if (rate.limited) {
    res.writeHead(429, {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': String(rate.retryAfter),
    });
    res.end(JSON.stringify({ code: 'rate_limited', message: '请求过于频繁，请稍后再试', trace_id: traceId }));
    return;
  }

  try {
    // ---------- 根路径状态页（浏览器直接打开即可看到服务状态） ----------
    if (method === 'GET' && (path === '/' || path === '/status')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>店脑 API · 运行中</title>
<style>body{font-family:"Microsoft YaHei",sans-serif;background:#f4f5f1;color:#22353b;margin:0;padding:48px}
.card{max-width:720px;margin:auto;background:#fbfcf9;border:1px solid #dce6df;border-radius:16px;padding:36px}
h1{margin:0 0 8px;font-size:28px}.ok{color:#2c6660;font-weight:700}
code{background:#edf5ef;padding:2px 6px;border-radius:4px}li{line-height:2}</style></head>
<body><div class="card"><h1>店脑 API</h1>
<p class="ok">● 运行中（端口 ${PORT}）</p>
<p>这是店脑后端服务的状态页。网页工作台请打开 <code>http://localhost:5173</code>。</p>
<ul>
<li>健康检查：<a href="/v1/health">/v1/health</a></li>
<li>登录：<code>POST /v1/auth/login</code>（账号 diannaoxy）</li>
<li>认人：<code>POST /v1/identity/resolve</code></li>
<li>客户档案：<code>GET /v1/subjects/:id</code></li>
<li>问答：<code>POST /v1/assistant/ask</code></li>
<li>记录草稿：<code>POST /v1/notes/drafts</code></li>
<li>导入 / 导出 / 知识审核 / 审计：详见 ROADMAP.md</li>
</ul>
<p>说明：业务端点需要 <code>Authorization: Bearer &lt;token&gt;</code>，直接打开会返回 401，属正常鉴权行为。</p>
</div></body></html>`);
      return;
    }

    // ---------- 健康检查 ----------
    if (method === 'GET' && path === '/v1/health') {
      sendJson(res, 200, { status: 'ok', service: 'diannao-api', trace_id: traceId }, traceId);
      return;
    }

    // ---------- 登录 ----------
    if (method === 'POST' && path === '/v1/auth/login') {
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const name = str(body.login_name);
      const pwd = str(body.password);
      if (name === undefined || pwd === undefined) {
        sendError(res, 400, 'missing_field', '缺少 login_name 或 password', traceId);
        return;
      }
      const result = login(name, pwd);
      if (result === undefined) {
        sendError(res, 401, 'invalid_credentials', '账号或密码错误（或该账号已撤权）', traceId);
        return;
      }
      writeAudit({
        tenant_id: result.principal.tenant_id,
        actor_id: result.principal.user_id,
        action: 'login',
        object_type: 'user',
        object_ref: result.principal.user_id,
        status: 'ok',
        trace_id: traceId,
      });
      sendJson(res, 200, { ...result, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 公共反诈评估（隔离域：不读商家数据，无需登录） ----------
    if (method === 'POST' && path === '/v1/antifraud/assess') {
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const description = str(body.description);
      if (description === undefined || description.length < 2 || description.length > 4000) {
        sendError(res, 400, 'invalid_description', 'description 必填且 2~4000 字符', traceId);
        return;
      }
      sendJson(res, 200, { ...assessFraud(description), trace_id: traceId }, traceId);
      return;
    }

    // ---------- 绑定码校验（网关调用：微信发送绑定码后换取账号） ----------
    if (method === "POST" && path === "/v1/setup/verify") {
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, "invalid_body", "请求体必须是 JSON 对象", traceId);
        return;
      }
      const code = str(body.code);
      if (code === undefined) {
        sendError(res, 400, "missing_field", "缺少 code", traceId);
        return;
      }
      const rec = BINDING_CODES.get(code);
      if (rec === undefined || rec.used || Date.now() > rec.expires_at) {
        sendError(res, 400, "invalid_code", "绑定码无效或已过期", traceId);
        return;
      }
      rec.used = true;
      sendJson(res, 200, { ok: true, scene: rec.scene, label: rec.label, login_name: rec.login_name, password: rec.password, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 演示 token（默认关闭；必须显式 DEMO_MODE=1 才开启） ----------
    if (method === 'POST' && path === '/v1/demo/token') {
      if (process.env.DEMO_MODE !== '1') {
        sendError(res, 403, 'demo_disabled', '演示模式未开启', traceId);
        return;
      }
      const body = await readJson(req);
      const scene = isRecord(body) ? (str(body.scene) ?? 'baby') : 'baby';
      const loginName = scene === 'apparel' ? 'cloth-demo' : 'diannaoxy';
      const result = login(loginName, DEMO_PASSWORD);
      if (result === undefined) {
        sendError(res, 500, 'demo_login_failed', '演示账号不可用', traceId);
        return;
      }
      sendJson(res, 200, { ...result, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 普通用户自助注册（公开；只能注册自己，人设注册后不可更改） ----------
    if (method === 'POST' && path === '/v1/auth/register') {
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const loginName = str(body.login_name)?.trim();
      const password = str(body.password);
      const promptType = str(body.prompt_type) ?? 'baby';
      if (loginName === undefined || !/^[a-zA-Z0-9_-]{2,20}$/.test(loginName)) {
        sendError(res, 400, 'invalid_login_name', '账号 2-20 位，仅字母数字下划线', traceId);
        return;
      }
      if (password === undefined || password.length < 6) {
        sendError(res, 400, 'invalid_password', '密码至少 6 位', traceId);
        return;
      }
      if (!['baby', 'apparel', 'fraud'].includes(promptType)) {
        sendError(res, 400, 'invalid_prompt_type', '人设只能是 baby / apparel / fraud', traceId);
        return;
      }
      // 每个注册用户独立租户：资料从空白开始，互不可见
      const tenantId = 'tenant-u-' + randomUUID();
      const storeId = 'store-u-' + randomUUID();
      const created = addAccount(loginName, password, tenantId, storeId, 'staff', promptType);
      if (!created.ok) {
        const msg = created.reason === 'exists' ? '账号已存在' : '账号或密码不符合要求';
        sendError(res, 400, created.reason, msg, traceId);
        return;
      }
      const loggedIn = login(loginName, password);
      if (loggedIn === undefined) {
        sendError(res, 500, 'register_login_failed', '注册成功但登录失败，请手动登录', traceId);
        return;
      }
      sendJson(res, 201, { ...loggedIn, prompt_type: promptType, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 网关内部开通（每个微信 sender 独立空白租户；需内部密钥） ----------
    if (method === 'POST' && path === '/v1/gateway/provision') {
      const expected = provisionKey();
      const provided = req.headers['x-provision-key'];
      if (expected.length < 16 || typeof provided !== 'string' || provided !== expected) {
        sendError(res, 403, 'provision_forbidden', '内部开通密钥无效', traceId);
        return;
      }
      const body = await readJson(req);
      const senderId = isRecord(body) ? str(body.sender_id) : undefined;
      if (senderId === undefined || senderId.length === 0) {
        sendError(res, 400, 'missing_field', '缺少 sender_id', traceId);
        return;
      }
      const existing = readBindingsRaw().find((u) => u.sender_id === senderId);
      const wantReset = isRecord(body) && (body.reset === true || body.reset === 'true');
      if (existing !== undefined && !wantReset) {
        // 已绑定：密码丢了就现场重置，绝不给同一个 sender 另开新租户
        const password = existing.password ?? randomUUID().replace(/-/g, '').slice(0, 12);
        if (!resetPassword(existing.login_name, password)) {
          sendError(res, 500, 'provision_failed', '重置密码失败', traceId);
          return;
        }
        writeBindings(readBindingsRaw().map((u) => (u.sender_id === senderId ? { ...u, password } : u)));
        sendJson(res, 200, { ok: true, login_name: existing.login_name, password, reused: true, trace_id: traceId }, traceId);
        return;
      }
      if (existing !== undefined) {
        // 显式要求重置：保留账号与数据，只换网关登录密码
        const password = randomUUID().replace(/-/g, '').slice(0, 12);
        if (!resetPassword(existing.login_name, password)) {
          sendError(res, 500, 'provision_failed', '重置密码失败', traceId);
          return;
        }
        writeBindings(readBindingsRaw().map((u) => (u.sender_id === senderId ? { ...u, password } : u)));
        sendJson(res, 200, {
          ok: true,
          login_name: existing.login_name,
          password,
          reused: true,
          trace_id: traceId,
        }, traceId);
        return;
      }
      const loginName = 'u-' + randomUUID().replace(/-/g, '').slice(0, 10);
      const password = randomUUID().replace(/-/g, '').slice(0, 12);
      const tenantId = 'tenant-u-' + randomUUID();
      const storeId = 'store-u-' + randomUUID();
      const created = addAccount(loginName, password, tenantId, storeId, 'staff', 'baby');
      if (!created.ok) {
        sendError(res, 500, 'provision_failed', '开通账号失败', traceId);
        return;
      }
      const items = readBindingsRaw().filter((u) => u.sender_id !== senderId);
      items.push({ sender_id: senderId, login_name: loginName, label: '新用户', password });
      writeBindings(items);
      sendJson(res, 201, {
        ok: true,
        login_name: loginName,
        password,
        tenant_id: tenantId,
        reused: false,
        trace_id: traceId,
      }, traceId);
      return;
    }

    // ---------- 二维码图片（公开：仅把传入内容渲染成 PNG，不含任何凭据） ----------
    if (method === "GET" && path === "/v1/admin/qr") {
      const data = url.searchParams.get("data") ?? "";
      if (data.length === 0 || data.length > 2000) {
        sendError(res, 400, "invalid_data", "缺少二维码内容", traceId);
        return;
      }
      try {
        const png = await QRCode.toBuffer(data, { width: 320, margin: 2 });
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        res.end(png);
      } catch {
        sendError(res, 500, "qr_failed", "二维码生成失败", traceId);
      }
      return;
    }
    // ---------- 以下均需鉴权 ----------
    const principal = authenticate(req.headers.authorization);
    if (principal === undefined) {
      sendError(res, 401, 'unauthorized', '缺少、无效或已失效的 Bearer token', traceId);
      return;
    }
    const tenantId = principal.tenant_id; // 只来自 token，忽略请求体

    // ---------- 身份检索 ----------
    if (method === 'POST' && path === '/v1/identity/resolve') {
      if (promptTypeOf(principal.user_id) === 'fraud') { sendError(res, 403, 'persona_restricted', '反诈人设不支持客户查询', traceId); return; }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const query = str(body.query);
      if (query === undefined || query.length > 200) {
        sendError(res, 400, 'invalid_query', 'query 必填且不超过 200 字符', traceId);
        return;
      }
      const rawType = str(body.subject_type);
      if (rawType !== undefined && !SUBJECT_TYPES.includes(rawType as SubjectType)) {
        sendError(res, 400, 'invalid_subject_type', 'subject_type 非法', traceId);
        return;
      }
      const result = resolveIdentity(tenantId, query, rawType as SubjectType | undefined);
      sendJson(res, 200, { ...result, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 新建客户（微信写入 / 后台补录，数据只属于当前租户） ----------
    if (method === 'POST' && path === '/v1/subjects') {
      if (promptTypeOf(principal.user_id) === 'fraud') {
        sendError(res, 403, 'persona_restricted', '反诈人设不支持客户资料', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const displayName = str(body.display_name)?.trim();
      if (displayName === undefined || displayName.length === 0 || displayName.length > 40) {
        sendError(res, 400, 'invalid_display_name', '客户名称必填，最多 40 字', traceId);
        return;
      }
      const hints = Array.isArray(body.hints)
        ? body.hints.filter((h): h is string => typeof h === 'string' && h.length > 0).slice(0, 5)
        : [];
      const created = createSubject(tenantId, principal.store_id ?? '', displayName, hints);
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: 'draft_create',
        object_type: 'subject',
        object_ref: created.id,
        status: 'created',
        trace_id: traceId,
      });
      sendJson(res, 201, {
        subject_ref: created.id,
        display_label: created.display_label,
        trace_id: traceId,
      }, traceId);
      return;
    }

    // ---------- 客户摘要 ----------
    const subjectMatch = /^\/v1\/subjects\/([^/]+)$/.exec(path);
    if (method === 'GET' && subjectMatch !== null) {
      if (promptTypeOf(principal.user_id) === 'fraud') { sendError(res, 403, 'persona_restricted', '反诈人设不支持客户查询', traceId); return; }
      const summary = getSummary(tenantId, decodeURIComponent(subjectMatch[1]!));
      if (summary === undefined) {
        sendError(res, 404, 'not_found', '未找到该客户（或不属于当前门店）', traceId);
        return;
      }
      sendJson(res, 200, { ...summary, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 问答 ----------
    if (method === 'POST' && path === '/v1/assistant/ask') {
      if (promptTypeOf(principal.user_id) === 'fraud') { sendError(res, 403, 'persona_restricted', '反诈人设不支持客户问答', traceId); return; }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const question = str(body.question);
      if (question === undefined || question.length < 1 || question.length > 1000) {
        sendError(res, 400, 'invalid_question', 'question 必填且 1~1000 字符', traceId);
        return;
      }
      sendJson(res, 200, { ...ask(tenantId, question), trace_id: traceId }, traceId);
      return;
    }

    // ---------- 草稿列表（审核用） ----------
    if (method === 'GET' && path === '/v1/notes/drafts') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无审批权限', traceId);
        return;
      }
      const statusParam = str(url.searchParams.get('status') ?? undefined);
      if (statusParam !== undefined && statusParam !== 'draft' && statusParam !== 'approved' && statusParam !== 'rejected') {
        sendError(res, 400, 'invalid_status', 'status 只能是 draft / approved / rejected', traceId);
        return;
      }
      const items = listDrafts(tenantId, statusParam);
      sendJson(res, 200, { items, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 新建草稿 ----------
    if (method === 'POST' && path === '/v1/notes/drafts') {
      if (promptTypeOf(principal.user_id) === 'fraud') { sendError(res, 403, 'persona_restricted', '反诈人设不支持客户记录', traceId); return; }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const subjectRef = str(body.subject_ref);
      const content = str(body.content);
      const sourceType = str(body.source_type);
      if (subjectRef === undefined || content === undefined || sourceType === undefined) {
        sendError(res, 400, 'missing_field', '缺少 subject_ref / content / source_type', traceId);
        return;
      }
      if (content.length > 4000) {
        sendError(res, 400, 'content_too_long', 'content 不超过 4000 字符', traceId);
        return;
      }
      if (!DRAFT_SOURCES.includes(sourceType as DraftSourceType)) {
        sendError(res, 400, 'invalid_source_type', 'source_type 非法', traceId);
        return;
      }
      const requestId = str(req.headers['idempotency-key']) ?? str(body.request_id);
      // 画像字段变更（可选）：只接受白名单字段，审核通过后才落档
      const patch = sanitizeProfilePatch(body.profile_patch);
      if ('error' in patch) {
        sendError(res, 400, 'invalid_profile_patch', 'profile_patch 字段不在白名单或值非法', traceId);
        return;
      }
      const result = createDraft(tenantId, subjectRef, content, sourceType as DraftSourceType, requestId, patch);
      if ('error' in result) {
        sendError(res, 403, 'forbidden', '无权为该客户写记录', traceId);
        return;
      }
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: 'draft_create',
        object_type: 'note_draft',
        object_ref: result.id,
        status: result.status,
        trace_id: traceId,
      });
      sendJson(res, 201, { ...result, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 审核草稿 ----------
    const approveMatch = /^\/v1\/notes\/([^/]+)\/approve$/.exec(path);
    if (method === 'POST' && approveMatch !== null) {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无审批权限', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const decision = str(body.decision);
      const expectedVersion = num(body.expected_version);
      if (decision !== 'approve' && decision !== 'reject') {
        sendError(res, 400, 'invalid_decision', 'decision 只能是 approve / reject', traceId);
        return;
      }
      if (expectedVersion === undefined || expectedVersion < 1) {
        sendError(res, 400, 'invalid_version', 'expected_version 必填且 ≥ 1', traceId);
        return;
      }
      const result = approveDraft(tenantId, decodeURIComponent(approveMatch[1]!), decision, expectedVersion);
      if (!result.ok) {
        if (result.reason === 'not_found') sendError(res, 404, 'not_found', '草稿不存在', traceId);
        else if (result.reason === 'forbidden') sendError(res, 403, 'forbidden', '无权审批该草稿', traceId);
        else sendError(res, 409, 'version_conflict', '版本冲突，请刷新后重试', traceId);
        return;
      }
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: decision === 'approve' ? 'draft_approve' : 'draft_reject',
        object_type: 'note_draft',
        object_ref: result.receipt.id,
        status: result.receipt.status,
        trace_id: traceId,
      });
      sendJson(res, 200, { ...result.receipt, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 生成微信绑定码（管理员） ----------
    if (method === 'POST' && path === '/v1/setup/code') {
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const scene = str(body.scene) ?? 'baby';
      const selfAccount = listAccounts().find((a) => a.user_id === principal.user_id);
      const labelInput = str(body.label);
      const label = labelInput !== undefined && labelInput.length > 0 ? labelInput : (selfAccount?.login_name ?? '店员');
      if (scene !== 'baby' && scene !== 'apparel') {
        sendError(res, 400, 'invalid_scene', 'scene 只能是 baby / apparel', traceId);
        return;
      }
      // 普通用户只能给自己生成绑定码，店长可指定店员账号
      const self = selfAccount;
      const loginNameInput = str(body.login_name);
      const loginNameRaw = isManager(principal.role)
        ? (loginNameInput !== undefined && loginNameInput.length > 0 ? loginNameInput : self?.login_name)
        : self?.login_name;
      const password = DEMO_PASSWORD;
      if (loginNameRaw === undefined) {
        sendError(res, 403, 'forbidden', '当前账号没有绑定权限', traceId);
        return;
      }
      const login_name = loginNameRaw;
      if (!listAccounts().some((a) => a.login_name === login_name)) {
        sendError(res, 400, 'unknown_account', '绑定的店脑账号不存在', traceId);
        return;
      }
      let code = '';
      do {
        code = String(Math.floor(100000 + Math.random() * 900000));
      } while (BINDING_CODES.has(code));
      const expiresAt = Date.now() + BINDING_TTL_MS;
      BINDING_CODES.set(code, { scene, label, login_name, password, expires_at: expiresAt, used: false });
      const qrDataUrl = await QRCode.toDataURL(code, { width: 320, margin: 2 });
      sendJson(res, 200, {
        code,
        scene,
        label,
        login_name,
        expires_at: new Date(expiresAt).toISOString(),
        qr_data_url: qrDataUrl,
        instruction: '用微信扫一扫二维码，把得到的 6 位数字发给「店脑 ClawBot」，即完成绑定。',
        trace_id: traceId,
      }, traceId);
      return;
    }

    // ---------- 提醒 ----------
    if (method === 'GET' && path === '/v1/reminders') {
      sendJson(res, 200, { items: SEED_REMINDERS, trace_id: traceId }, traceId);
      return;
    }

    // ---------- API-02：撤权（旧会话立即失效） ----------
    const revokeMatch = /^\/v1\/memberships\/([^/]+)\/revoke$/.exec(path);
    if (method === 'POST' && revokeMatch !== null) {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无撤权权限', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const expectedVersion = num(body.expected_version);
      if (expectedVersion === undefined || expectedVersion < 1) {
        sendError(res, 400, 'invalid_version', 'expected_version 必填且 ≥ 1', traceId);
        return;
      }
      const targetId = decodeURIComponent(revokeMatch[1]!);
      const result = revokeMembership(tenantId, targetId, expectedVersion);
      if (!result.ok) {
        if (result.reason === 'not_found') sendError(res, 404, 'not_found', '成员关系不存在', traceId);
        else if (result.reason === 'forbidden') sendError(res, 403, 'forbidden', '无权撤权该成员', traceId);
        else sendError(res, 409, 'version_conflict', '版本冲突或已撤权', traceId);
        return;
      }
      const revokedSessions = activeSessionCountForUser(result.membership.user_id);
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: 'membership_revoke',
        object_type: 'membership',
        object_ref: result.membership.id,
        status: 'revoked',
        trace_id: traceId,
      });
      sendJson(
        res,
        200,
        { membership: result.membership, revoked_session_count: revokedSessions, trace_id: traceId },
        traceId,
      );
      return;
    }

    // ---------- API-02：商品列表 ----------
    if (method === 'GET' && path === '/v1/products') {
      sendJson(res, 200, { items: listProducts(tenantId), trace_id: traceId }, traceId);
      return;
    }

    // ---------- API-02：创建商品 ----------
    if (method === 'POST' && path === '/v1/products') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '需要管理权限', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const sku = str(body.sku);
      const name = str(body.name);
      if (sku === undefined || name === undefined) {
        sendError(res, 400, 'missing_field', '缺少 sku 或 name', traceId);
        return;
      }
      const requestId = str(req.headers['idempotency-key']) ?? str(body.request_id);
      const result = createProduct(
        tenantId,
        sku,
        name,
        str(body.category),
        num(body.current_price),
        str(body.shelf_location),
        isRecord(body.attributes) ? body.attributes : undefined,
        requestId,
      );
      if ('error' in result) {
        sendError(res, 409, 'duplicate_sku', 'SKU 已存在', traceId);
        return;
      }
      sendJson(res, 201, { ...result, trace_id: traceId }, traceId);
      return;
    }

    // ---------- API-03：导入预览 ----------
    if (method === 'POST' && path === '/v1/imports/preview') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无权导入', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const csvText = str(body.csv_text);
      const mappingRaw = body.mapping;
      if (csvText === undefined || !isRecord(mappingRaw)) {
        sendError(res, 400, 'missing_field', '缺少 csv_text 或 mapping', traceId);
        return;
      }
      const mapping: Record<string, string> = {};
      for (const [k, v] of Object.entries(mappingRaw)) {
        if (typeof v !== 'string') {
          sendError(res, 400, 'invalid_mapping', 'mapping 的值必须都是字符串', traceId);
          return;
        }
        mapping[k] = v;
      }
      const result = previewImport(tenantId, csvText, mapping);
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: 'import_preview',
        object_type: 'import_batch',
        object_ref: result.batch_id,
        status: 'previewed',
        trace_id: traceId,
      });
      sendJson(res, 200, { ...result, trace_id: traceId }, traceId);
      return;
    }

    // ---------- API-03：导入提交（幂等） ----------
    if (method === 'POST' && path === '/v1/imports/commit') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无权导入', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const batchId = str(body.batch_id);
      const declaredHash = str(body.content_hash);
      const csvText = str(body.csv_text);
      const mappingRaw = body.mapping;
      if (batchId === undefined || declaredHash === undefined || csvText === undefined || !isRecord(mappingRaw)) {
        sendError(res, 400, 'missing_field', '缺少 batch_id / content_hash / csv_text / mapping', traceId);
        return;
      }
      const actualHash = contentHash(csvText);
      if (actualHash !== declaredHash) {
        sendError(res, 409, 'content_hash_mismatch', '内容指纹不一致，拒绝提交（防篡改）', traceId);
        return;
      }
      const mapping: Record<string, string> = {};
      for (const [k, v] of Object.entries(mappingRaw)) {
        if (typeof v !== 'string') {
          sendError(res, 400, 'invalid_mapping', 'mapping 的值必须都是字符串', traceId);
          return;
        }
        mapping[k] = v;
      }
      const requestId = str(req.headers['idempotency-key']) ?? str(body.request_id);
      const { result, idempotent_replay } = commitImport(
        tenantId,
        batchId,
        actualHash,
        csvText,
        mapping,
        requestId,
      );
      if (!idempotent_replay) {
        writeAudit({
          tenant_id: tenantId,
          actor_id: principal.user_id,
          action: 'import_commit',
          object_type: 'import_batch',
          object_ref: result.batch_id,
          status: 'committed',
          trace_id: traceId,
        });
      }
      sendJson(res, 200, { ...result, idempotent_replay, trace_id: traceId }, traceId);
      return;
    }

    // ---------- API-03：导出（留审计） ----------
    const exportMatch = /^\/v1\/exports\/([^/]+)$/.exec(path);
    if (method === 'GET' && exportMatch !== null) {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '店员无批量导出权限', traceId);
        return;
      }
      const resource = decodeURIComponent(exportMatch[1]!);
      if (!(EXPORT_RESOURCES as readonly string[]).includes(resource)) {
        sendError(res, 400, 'invalid_resource', 'resource 只能是 customers / transactions / products', traceId);
        return;
      }
      const { csv, row_count } = exportResource(tenantId, resource as (typeof EXPORT_RESOURCES)[number]);
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: 'export',
        object_type: resource,
        status: `rows:${row_count}`,
        trace_id: traceId,
      });
      sendCsv(res, csv, `${resource}-${tenantId.slice(0, 8)}.csv`, traceId);
      return;
    }

    // ---------- API-04：知识列表 ----------
    if (method === 'GET' && path === '/v1/knowledge') {
      const statusParam = url.searchParams.get('status') ?? undefined;
      if (statusParam !== undefined && !KNOWLEDGE_STATUSES.includes(statusParam as KnowledgeStatus)) {
        sendError(res, 400, 'invalid_status', 'status 非法', traceId);
        return;
      }
      sendJson(
        res,
        200,
        { items: listKnowledge(tenantId, statusParam as KnowledgeStatus | undefined), trace_id: traceId },
        traceId,
      );
      return;
    }

    // ---------- API-04：提交知识草稿 ----------
    if (method === 'POST' && path === '/v1/knowledge') {
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const title = str(body.title);
      const steps = strArray(body.steps);
      if (title === undefined || steps === undefined) {
        sendError(res, 400, 'missing_field', '缺少 title 或 steps（字符串数组）', traceId);
        return;
      }
      const applicableRaw = body.applicable;
      const applicable: KnowledgeApplicable = isRecord(applicableRaw) ? applicableRaw : {};
      const constraints: KnowledgeConstraint[] | undefined = Array.isArray(body.constraints)
        ? body.constraints.filter(isRecord).map((c) => ({
            rule_key: str(c.rule_key) ?? '',
            params: isRecord(c.params) ? c.params : undefined,
          }))
        : undefined;
      const requestId = str(req.headers['idempotency-key']) ?? str(body.request_id);
      const entry = submitKnowledge(tenantId, title, applicable, steps, constraints, requestId);
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: 'knowledge_submit',
        object_type: 'knowledge_entry',
        object_ref: entry.id,
        status: entry.status,
        trace_id: traceId,
      });
      sendJson(res, 201, { ...entry, trace_id: traceId }, traceId);
      return;
    }

    // ---------- API-04：知识审核流转 ----------
    const reviewMatch = /^\/v1\/knowledge\/([^/]+)\/review$/.exec(path);
    if (method === 'POST' && reviewMatch !== null) {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无知识审核权限', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const decision = str(body.decision);
      const expectedVersion = num(body.expected_version);
      if (decision === undefined || !REVIEW_DECISIONS.includes(decision as KnowledgeReviewDecision)) {
        sendError(res, 400, 'invalid_decision', 'decision 非法', traceId);
        return;
      }
      if (expectedVersion === undefined || expectedVersion < 1) {
        sendError(res, 400, 'invalid_version', 'expected_version 必填且 ≥ 1', traceId);
        return;
      }
      const entryId = decodeURIComponent(reviewMatch[1]!);
      const result = reviewKnowledge(
        tenantId,
        entryId,
        decision as KnowledgeReviewDecision,
        expectedVersion,
        principal.user_id,
      );
      if (!result.ok) {
        if (result.reason === 'not_found') sendError(res, 404, 'not_found', '知识条目不存在', traceId);
        else if (result.reason === 'conflict') sendError(res, 409, 'version_conflict', '版本冲突', traceId);
        else if (result.reason === 'invalid_transition') sendError(res, 409, 'invalid_transition', '状态流转非法', traceId);
        else sendError(res, 403, 'forbidden', '无权审核', traceId);
        return;
      }
      writeAudit({
        tenant_id: tenantId,
        actor_id: principal.user_id,
        action: decision === 'archive' ? 'knowledge_archive' : 'knowledge_review',
        object_type: 'knowledge_entry',
        object_ref: result.entry.id,
        status: result.entry.status,
        trace_id: traceId,
      });
      sendJson(res, 200, { ...result.entry, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 后台：概览（所有登录用户可看；数据按本租户隔离；管理项仅管理员） ----------
    if (method === 'GET' && path === '/v1/admin/overview') {
      const snap = getSnapshot();
      const tenantId = principal.tenant_id;
      const ptype = promptTypeOf(principal.user_id);
      const mine = ptype === 'fraud' ? { customers: 0, products: 0, drafts: 0, knowledge: 0 } : {
        customers: snap.subjects.filter((s) => s.tenant_id === tenantId).length,
        products: snap.products.filter((p) => p.tenant_id === tenantId).length,
        drafts: snap.drafts.filter((d) => d.tenant_id === tenantId).length,
        knowledge: snap.knowledge.filter((k) => k.tenant_id === tenantId).length,
      };
      const manager = isManager(principal.role);
      sendJson(res, 200, {
        role: principal.role,
        prompt_type: ptype,
        staff_count: manager ? listAccounts().length : null,
        binding_count: manager ? readBindings().length : null,
        customer_count: mine.customers,
        product_count: mine.products,
        draft_count: mine.drafts,
        knowledge_count: mine.knowledge,
        storage: manager ? snapshotInfo() : null,
        trace_id: traceId,
      }, traceId);
      return;
    }

    // ---------- 后台：员工列表 ----------
    if (method === 'GET' && path === '/v1/admin/staff') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无查看权限', traceId);
        return;
      }
      const items = listAccounts().map((a) => {
        const m = getMembershipByUser(a.user_id);
        return {
          login_name: a.login_name,
          user_id: a.user_id,
          role: m?.role ?? 'none',
          tenant_id: m?.tenant_id ?? null,
          store_id: m?.store_id ?? null,
          revoked: m?.revoked_at !== undefined,
          prompt_type: a.prompt_type,
        };
      });
      sendJson(res, 200, { items, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 后台：新增员工 ----------
    if (method === 'POST' && path === '/v1/admin/staff') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '只有店长/管理员可以新增员工', traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const loginName = str(body.login_name);
      const password = str(body.password);
      const scene = str(body.scene) ?? 'baby';
      if (loginName === undefined || password === undefined) {
        sendError(res, 400, 'missing_field', '缺少 login_name 或 password', traceId);
        return;
      }
      const tenantId = scene === 'apparel' ? 'tenant-c-uuid-0000-0000-000000000003' : 'tenant-a-uuid-0000-0000-000000000001';
      const storeId = scene === 'apparel' ? 'store-c1-uuid-0000-0000-0000000000c1' : 'store-a1-uuid-0000-0000-0000000000a1';
      const promptType = isRecord(body) && typeof body.prompt_type === 'string' ? body.prompt_type : 'baby';
      const result = addAccount(loginName, password, tenantId, storeId, 'staff', promptType);
      if (!result.ok) {
        const msg = result.reason === 'exists' ? '账号已存在' : '账号至少 2 位、密码至少 6 位';
        sendError(res, 400, result.reason, msg, traceId);
        return;
      }
      writeAudit({
        tenant_id: principal.tenant_id,
        actor_id: principal.user_id,
        action: 'membership_revoke',
        object_type: 'staff_account',
        object_ref: loginName,
        status: 'created',
        trace_id: traceId,
      });
      sendJson(res, 201, { ok: true, user_id: result.user_id, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 后台：删除员工 ----------
    if (method === 'POST' && path === '/v1/admin/staff/remove') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '只有店长/管理员可以删除员工', traceId);
        return;
      }
      const body = await readJson(req);
      const loginName = isRecord(body) ? str(body.login_name) : undefined;
      if (loginName === undefined) {
        sendError(res, 400, 'missing_field', '缺少 login_name', traceId);
        return;
      }
      if (!removeAccount(loginName)) {
        sendError(res, 400, 'cannot_remove', '账号不存在，或属于内置账号不可删除', traceId);
        return;
      }
      sendJson(res, 200, { ok: true, removed: loginName, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 后台：OpenClaw 微信账号（多开） ----------
    if (path.startsWith("/v1/admin/wechat/accounts")) {
      if (!isManager(principal.role)) {
        sendError(res, 403, "forbidden", "无查看权限", traceId);
        return;
      }
      try {
        if (method === "GET" && path === "/v1/admin/wechat/accounts") {
          sendJson(res, 200, { items: await listWechatAccounts(), trace_id: traceId }, traceId);
          return;
        }
        if (method === "GET" && path === "/v1/admin/wechat/accounts/login-log") {
          const account = url.searchParams.get("account") ?? "";
          sendJson(res, 200, { ...readLoginLog(account), trace_id: traceId }, traceId);
          return;
        }
        if (method === "POST" && path === "/v1/admin/wechat/accounts/add") {
          const body = await readJson(req);
          const account = isRecord(body) ? str(body.account) : undefined;
          if (account !== undefined && !/^[a-zA-Z0-9_-]{2,40}$/.test(account)) {
            sendError(res, 400, "invalid_account", "账号名 2-40 位，仅字母数字下划线", traceId);
            return;
          }
          const created = await addWechatAccount(account);
          sendJson(res, 200, { ok: true, account: created, trace_id: traceId }, traceId);
          return;
        }
        if (method === "POST" && path === "/v1/admin/wechat/accounts/logout") {
          const body = await readJson(req);
          const account = isRecord(body) ? str(body.account) : undefined;
          if (account === undefined) { sendError(res, 400, "missing_field", "缺少 account", traceId); return; }
          await logoutWechatAccount(account);
          sendJson(res, 200, { ok: true, account, trace_id: traceId }, traceId);
          return;
        }
        sendError(res, 404, "no_route", "未知操作", traceId);
      } catch (e) {
        sendError(res, 500, "openclaw_error", e instanceof Error ? e.message : "操作失败", traceId);
      }
      return;
    }

    // ---------- 后台：微信绑定账户管理 ----------
    if (method === 'GET' && path === '/v1/admin/bindings') {
      const self = listAccounts().find((a) => a.user_id === principal.user_id);
      const items = isManager(principal.role)
        ? readBindings()
        : readBindings().filter((b) => b.login_name === self?.login_name);
      sendJson(res, 200, { items, trace_id: traceId }, traceId);
      return;
    }

    if (method === 'POST' && path === '/v1/admin/bindings/unbind') {
      const body = await readJson(req);
      if (!isRecord(body)) {
        sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象', traceId);
        return;
      }
      const senderId = str(body.sender_id);
      if (senderId === undefined) {
        sendError(res, 400, 'missing_field', '缺少 sender_id', traceId);
        return;
      }
      if (!isManager(principal.role)) {
        const self = listAccounts().find((a) => a.user_id === principal.user_id);
        const mine = readBindings().some((b) => b.sender_id === senderId && b.login_name === self?.login_name);
        if (!mine) {
          sendError(res, 403, 'forbidden', '只能解绑自己的微信', traceId);
          return;
        }
      }
      const removed = removeBinding(senderId);
      if (!removed) {
        sendError(res, 404, 'not_found', '绑定记录不存在', traceId);
        return;
      }
      writeAudit({
        tenant_id: principal.tenant_id,
        actor_id: principal.user_id,
        action: 'membership_revoke',
        object_type: 'channel_binding',
        object_ref: senderId,
        status: 'unbound',
        trace_id: traceId,
      });
      sendJson(res, 200, { ok: true, removed: senderId, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 后台：更新微信绑定归属 ----------
    if (method === "POST" && path === "/v1/admin/bindings/update") {
      if (!isManager(principal.role)) {
        sendError(res, 403, "forbidden", "只有店长/管理员可以设置归属", traceId);
        return;
      }
      const body = await readJson(req);
      if (!isRecord(body)) { sendError(res, 400, "invalid_body", "请求体必须是 JSON 对象", traceId); return; }
      const senderId = str(body.sender_id);
      const loginName = str(body.login_name);
      const label = str(body.label);
      if (senderId === undefined) { sendError(res, 400, "missing_field", "缺少 sender_id", traceId); return; }
      const items = readBindingsRaw();   // 保留 password
      const idx = items.findIndex((u) => u.sender_id === senderId);
      if (idx < 0) { sendError(res, 404, "not_found", "绑定记录不存在", traceId); return; }
      if (loginName !== undefined) {
        if (!listAccounts().some((a) => a.login_name === loginName)) {
          sendError(res, 400, "unknown_account", "店脑账号不存在", traceId);
          return;
        }
        if (items[idx]!.login_name !== loginName) {
          // 换归属：给新账号换一个网关可用的密码，旧归属账号不受影响
          const newPw = randomUUID().replace(/-/g, '').slice(0, 12);
          resetPassword(loginName, newPw);
          items[idx]!.login_name = loginName;
          items[idx]!.password = newPw;
        }
      }
      if (label !== undefined) items[idx]!.label = label;
      writeBindings(items);
      const safe = { sender_id: items[idx]!.sender_id, login_name: items[idx]!.login_name, label: items[idx]!.label };
      sendJson(res, 200, { ok: true, item: safe, trace_id: traceId }, traceId);
      return;
    }

    // ---------- 后台：存储明细（各表数据） ----------
    if (method === "GET" && path === "/v1/admin/storage/detail") {
      if (!isManager(principal.role)) {
        sendError(res, 403, "forbidden", "无查看权限", traceId);
        return;
      }
      const tenantId = principal.tenant_id;
      const snap = getSnapshot();
      const subjects = snap.subjects.filter((x) => x.tenant_id === tenantId);
      const memberships = snap.memberships.filter((x) => x.tenant_id === tenantId);
      const products = snap.products.filter((x) => x.tenant_id === tenantId);
      const knowledge = snap.knowledge.filter((x) => x.tenant_id === tenantId);
      const drafts = snap.drafts.filter((x) => x.tenant_id === tenantId);
      const auditLogs = snap.audit_logs.filter((x) => x.tenant_id === tenantId);
      const tenantUserIds = new Set(memberships.map((m) => m.user_id));
      const accounts = listAccounts().filter((a) => tenantUserIds.has(a.user_id));
      const accountNames = new Set(accounts.map((a) => a.login_name));
      const binds = readBindings().filter((b) => accountNames.has(b.login_name));
      const tables = [
        { name: "客户画像", count: subjects.length, columns: ["ID", "名称", "类型"], rows: subjects.slice(0, 20).map((x) => [x.id.slice(0, 8), x.display_label, x.subject_type]) },
        { name: "成员关系", count: memberships.length, columns: ["用户", "角色", "门店"], rows: memberships.slice(0, 20).map((x) => [x.user_id.slice(0, 8), x.role, (x.store_id ?? "").slice(0, 8)]) },
        { name: "商品", count: products.length, columns: ["SKU", "名称", "价格"], rows: products.slice(0, 20).map((x) => [x.sku, x.name, String(x.current_price ?? "")]) },
        { name: "知识条目", count: knowledge.length, columns: ["标题", "状态", "版本"], rows: knowledge.slice(0, 20).map((x) => [x.title, x.status, String(x.version)]) },
        { name: "服务记录", count: drafts.length, columns: ["客户", "内容", "状态"], rows: drafts.slice(0, 20).map((x) => [x.subject_ref.slice(0, 8), x.content.slice(0, 40), x.status]) },
        { name: "微信绑定", count: binds.length, columns: ["sender", "账号", "说明"], rows: binds.map((x) => [x.sender_id, x.login_name, x.label]) },
        { name: "登录账号", count: accounts.length, columns: ["账号", "用户ID"], rows: accounts.map((x) => [x.login_name, x.user_id.slice(0, 8)]) },
        { name: "审计日志", count: auditLogs.length, columns: ["动作", "对象", "时间"], rows: auditLogs.slice(-20).reverse().map((x) => [x.action, x.object_type ?? "", x.occurred_at.slice(0, 19)]) },
      ];
      sendJson(res, 200, { tables, storage: snapshotInfo(), trace_id: traceId }, traceId);
      return;
    }

    // ---------- 后台：存储状态 ----------
    if (method === 'GET' && path === '/v1/admin/storage') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无查看权限', traceId);
        return;
      }
      const tenantId = principal.tenant_id;
      const snap = getSnapshot();
      const inTenant = <T extends { tenant_id?: string }>(rows: T[]): T[] => rows.filter((x) => x.tenant_id === tenantId);
      sendJson(res, 200, {
        storage: 'sqlite',
        snapshot: snapshotInfo(),
        counts: {
          subjects: inTenant(snap.subjects).length,
          memberships: inTenant(snap.memberships).length,
          products: inTenant(snap.products).length,
          knowledge: inTenant(snap.knowledge).length,
          drafts: inTenant(snap.drafts).length,
          audit_logs: inTenant(snap.audit_logs).length,
        },
        trace_id: traceId,
      }, traceId);
      return;
    }

    // ---------- API-04：审计查询 ----------
    if (method === 'GET' && path === '/v1/audit') {
      if (!isManager(principal.role)) {
        sendError(res, 403, 'forbidden', '无审计查看权限', traceId);
        return;
      }
      const q: AuditQuery = {
        action: (url.searchParams.get('action') as AuditAction | null) ?? undefined,
        object_type: url.searchParams.get('object_type') ?? undefined,
        object_ref: url.searchParams.get('object_ref') ?? undefined,
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        limit: url.searchParams.get('limit') !== null ? Number(url.searchParams.get('limit')) : undefined,
      };
      sendJson(res, 200, { items: queryAudit(tenantId, q), trace_id: traceId }, traceId);
      return;
    }

    sendError(res, 404, 'no_route', `未知端点 ${method} ${path}`, traceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    sendError(res, 500, 'internal_error', message, traceId);
  }
}

// 启动时从 SQLite 恢复上次快照（客户画像、成员、商品、知识、服务记录）
const persisted = loadSnapshot<StoreSnapshot>();
if (persisted !== undefined) {
  restoreSnapshot(persisted);
  // eslint-disable-next-line no-console
  console.log(`[db] restored snapshot saved_at=${persisted.saved_at}`);
} else {
  // eslint-disable-next-line no-console
  console.log('[db] no snapshot yet, using seed data');
}

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[diannao-api] listening on http://localhost:${PORT}`);
  console.log('[diannao-api] 测试账号：manager-a / demo，staff-b / demo');
});
