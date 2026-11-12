/**
 * 店脑 · 全服务自检
 * 用法：node scripts/health-check.mjs
 * 逐项检查 API / 网页 / 网关 / 登录 / 认人 / 网关消息，输出 PASS/FAIL。
 */

const API = process.env.DIANNAO_API ?? 'http://127.0.0.1:7401';
const WEB = process.env.DIANNAO_WEB ?? 'http://127.0.0.1:5173';
const GW = process.env.DIANNAO_GW ?? 'http://127.0.0.1:7402';

const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    console.log(`FAIL  ${name}  — ${e instanceof Error ? e.message : e}`);
  }
}

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  return { res, body };
}

console.log('==========================================');
console.log('  店脑 · 服务自检');
console.log('==========================================');

await check('后端 API 健康检查 /v1/health', async () => {
  const { body } = await getJson(`${API}/v1/health`);
  if (body.status !== 'ok') throw new Error('status 不是 ok');
  return `${API} · ${body.service}`;
});

await check('后端 API 根路径状态页', async () => {
  const res = await fetch(`${API}/`, { signal: AbortSignal.timeout(5000) });
  const html = await res.text();
  if (!res.ok || !html.includes('店脑 API')) throw new Error(`HTTP ${res.status}`);
  return '返回状态页（不是 401 错误）';
});

await check('登录（demo→diannaoxy / demo）', async () => {
  const { body } = await getJson(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_name: 'diannaoxy', password: (process.env.DIANNAO_DEMO_PASSWORD || 'demo-password') }),
  });
  if (!body.principal?.token) throw new Error('未签发 token');
  return `role=${body.principal.role}`;
});

await check('认人检索（尾号 1234）', async () => {
  const { body: login } = await getJson(`${API}/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_name: 'diannaoxy', password: (process.env.DIANNAO_DEMO_PASSWORD || 'demo-password') }),
  });
  const { body } = await getJson(`${API}/v1/identity/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.principal.token}` },
    body: JSON.stringify({ query: '1234' }),
  });
  if (!['matched', 'ambiguous'].includes(body.match_status)) throw new Error(`match_status=${body.match_status}`);
  return `${body.match_status} · ${body.candidates.length} 候选`;
});

await check('网页工作台首页', async () => {
  const res = await fetch(`${WEB}/`, { signal: AbortSignal.timeout(5000) });
  const html = await res.text();
  if (!res.ok || !html.includes('店脑')) throw new Error(`HTTP ${res.status}`);
  return `${WEB} · 标题正常`;
});

await check('网页 → API 代理', async () => {
  const { body } = await getJson(`${WEB}/v1/health`);
  if (body.status !== 'ok') throw new Error('代理返回非 ok');
  return 'vite proxy 正常';
});

await check('微信网关健康检查 /wechat/health', async () => {
  const { body } = await getJson(`${GW}/wechat/health`);
  if (body.status !== 'ok') throw new Error('status 不是 ok');
  return `channel=${body.channel} · 白名单 ${body.allowed_senders} 人（API 连接由下一项业务链路验证）`;
});

await check('微信网关根路径状态页', async () => {
  const res = await fetch(`${GW}/`, { signal: AbortSignal.timeout(5000) });
  const html = await res.text();
  if (!res.ok || !html.includes('微信网关')) throw new Error(`HTTP ${res.status}`);
  return '返回状态页（不是 404）';
});

await check('网页 → API 登录（经代理）', async () => {
  const { body } = await getJson(`${WEB}/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_name: 'diannaoxy', password: (process.env.DIANNAO_DEMO_PASSWORD || 'demo-password') }),
  });
  if (!body.principal?.token) throw new Error('代理登录未签发 token');
  return '网页登录链路正常';
});

await check('微信网关 fail-closed（陌生 sender 被拒）', async () => {
  const { body } = await getJson(`${GW}/wechat/simulate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'openclaw-weixin', message_id: 'selfcheck-' + Date.now() + '-stranger', sender_id: 'wxid-stranger', text: '查一下尾号1234' }),
  });
  if (body.status !== 'unbound') throw new Error(`期望 unbound，实际 ${body.status}`);
  return '未绑定用户不返回任何客户数据';
});

await check('微信网关 → 店脑 API 业务链路', async () => {
  const { body } = await getJson(`${GW}/wechat/simulate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'openclaw-weixin', message_id: 'selfcheck-' + Date.now() + '-bound', sender_id: 'wxid-staff-luo', text: '查一下尾号1234上次买什么' }),
  });
  if (body.status !== 'ok') throw new Error(`期望 ok，实际 ${body.status}：${body.reply ?? ''}`);
  if (!String(body.reply).includes('张女士')) throw new Error('回复未包含客户信息，链路可能未打通');
  return '绑定 sender 查询成功，网关已连上 API';
});

console.log('==========================================');
const passed = results.filter((r) => r.ok).length;
console.log(`结果：${passed}/${results.length} 通过`);
if (passed !== results.length) {
  console.log('失败项：' + results.filter((r) => !r.ok).map((r) => r.name).join('、'));
  console.log('排查：先运行「店脑-启动.bat」，确认三个窗口都没有报错。');
  process.exitCode = 1;
} else {
  console.log('全部通过。打开 http://localhost:5173 使用网页工作台。');
}
