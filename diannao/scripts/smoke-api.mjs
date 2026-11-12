// 店脑 API 端到端冒烟：覆盖 API-01~04 验收标准。
// 前置：API 干净启动在 BASE（默认 http://localhost:7401）。撤权会改变内存状态，重跑前请重启 API。
const BASE = process.env.BASE ?? 'http://localhost:7401';

let pass = 0;
let fail = 0;
function check(name, expect, actual) {
  const ok = JSON.stringify(expect) === JSON.stringify(actual);
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}  expected=${JSON.stringify(expect)} actual=${JSON.stringify(actual)}`); }
}

async function req(method, path, { token, body, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  let json;
  let text;
  if (ct.includes('application/json')) { try { json = await res.json(); } catch { json = undefined; } }
  else { text = await res.text(); }
  return { status: res.status, json, text, contentType: ct };
}

const SUBJ_A = '00000000-0000-4000-8000-000000000101';
const SUBJ_B = '00000000-0000-4000-8000-000000000901';
const MEMBERSHIP_STAFF_A = '00000000-0000-4000-8000-000000000703';

// ---------- 0. 健康检查 ----------
console.log('== 健康检查 ==');
check('health 200', 200, (await req('GET', '/v1/health')).status);

// ---------- 1. 登录（会话制 token） ----------
console.log('== 登录 ==');
const loginA = await req('POST', '/v1/auth/login', { body: { login_name: 'diannaoxy', password: (process.env.DIANNAO_DEMO_PASSWORD || 'demo-password') } });
check('manager-a 登录 200', 200, loginA.status);
const tokenA = loginA.json?.principal?.token;
check('返回 session token', true, typeof tokenA === 'string' && tokenA.startsWith('sess-'));
const loginStaffA = await req('POST', '/v1/auth/login', { body: { login_name: 'staff-a', password: (process.env.DIANNAO_DEMO_PASSWORD || 'demo-password') } });
const tokenStaffA = loginStaffA.json?.principal?.token;
check('staff-a 登录 200', 200, loginStaffA.status);
const loginB = await req('POST', '/v1/auth/login', { body: { login_name: 'staff-b', password: (process.env.DIANNAO_DEMO_PASSWORD || 'demo-password') } });
const tokenB = loginB.json?.principal?.token;
check('staff-b 登录 200', 200, loginB.status);
check('错误密码 401', 401, (await req('POST', '/v1/auth/login', { body: { login_name: 'diannaoxy', password: 'bad' } })).status);
check('无 token 401', 401, (await req('POST', '/v1/identity/resolve', { body: { query: '1234' } })).status);

// ---------- 2. 身份检索三路径 ----------
console.log('== 身份检索 ==');
const r1 = await req('POST', '/v1/identity/resolve', { token: tokenA, body: { query: '1234' } });
check('单匹配 matched', 'matched', r1.json.match_status);
check('单匹配无需确认', false, r1.json.needs_confirmation);
check('检索不跨租户(仅1条)', 1, r1.json.candidates.length);
const r2 = await req('POST', '/v1/identity/resolve', { token: tokenA, body: { query: '5678' } });
check('多匹配 ambiguous', 'ambiguous', r2.json.match_status);
check('多匹配需确认', true, r2.json.needs_confirmation);
check('多匹配只出脱敏候选(2条)', 2, r2.json.candidates.length);
check('无匹配 not_found', 'not_found', (await req('POST', '/v1/identity/resolve', { token: tokenA, body: { query: '0000' } })).json.match_status);

// ---------- 3. 租户隔离 ----------
console.log('== 租户隔离 ==');
check('租户B访问A客户 404', 404, (await req('GET', `/v1/subjects/${SUBJ_A}`, { token: tokenB })).status);
check('租户A访问A客户 200', 200, (await req('GET', `/v1/subjects/${SUBJ_A}`, { token: tokenA })).status);
check('越权写他店客户 403', 403, (await req('POST', '/v1/notes/drafts', { token: tokenA, body: { subject_ref: SUBJ_B, content: 'x', source_type: 'staff_text' } })).status);

// ---------- 4. 客户摘要三行 ----------
console.log('== 客户摘要 ==');
const sum = await req('GET', `/v1/subjects/${SUBJ_A}`, { token: tokenA });
check('摘要是谁', true, typeof sum.json.display_label === 'string' && sum.json.display_label.length > 0);
check('摘要以前买过什么', true, Array.isArray(sum.json.recent_transactions) && sum.json.recent_transactions.length > 0);
check('摘要建议做什么', true, Array.isArray(sum.json.suggestions) && sum.json.suggestions.length > 0);
check('摘要带证据', true, Array.isArray(sum.json.evidence) && sum.json.evidence.length > 0);

// ---------- 5. 问答 ----------
console.log('== 问答 ==');
const q1 = await req('POST', '/v1/assistant/ask', { token: tokenA, body: { question: '尾号1234上次买什么' } });
check('问答有数据 ok', 'ok', q1.json.status);
check('问答带引用', true, Array.isArray(q1.json.citations) && q1.json.citations.length > 0);
check('健康问题转人工', true, (await req('POST', '/v1/assistant/ask', { token: tokenA, body: { question: '孩子过敏怎么办' } })).json.handoff);

// ---------- 6. 写记录 + 幂等 ----------
console.log('== 写记录 + 幂等 ==');
const IDEM = `idem-${Date.now()}`;
const d1 = await req('POST', '/v1/notes/drafts', { token: tokenA, headers: { 'idempotency-key': IDEM }, body: { subject_ref: SUBJ_A, content: '客户反馈纸尿裤偏小', source_type: 'staff_text' } });
const d2 = await req('POST', '/v1/notes/drafts', { token: tokenA, headers: { 'idempotency-key': IDEM }, body: { subject_ref: SUBJ_A, content: '客户反馈纸尿裤偏小', source_type: 'staff_text' } });
check('写记录 201', 201, d1.status);
check('幂等：同 key 同 id', d1.json.id, d2.json.id);
check('审核批准 200', 200, (await req('POST', `/v1/notes/${d1.json.id}/approve`, { token: tokenA, body: { decision: 'approve', expected_version: 1 } })).status);
check('版本冲突 409', 409, (await req('POST', `/v1/notes/${d1.json.id}/approve`, { token: tokenA, body: { decision: 'approve', expected_version: 1 } })).status);
check('店员无审批权 403', 403, (await req('POST', `/v1/notes/${d1.json.id}/approve`, { token: tokenB, body: { decision: 'approve', expected_version: 2 } })).status);
check('提醒列表 200', 200, (await req('GET', '/v1/reminders', { token: tokenA })).status);

// ---------- 7. API-02：商品记录 ----------
console.log('== API-02 商品记录 ==');
const prodCreate = await req('POST', '/v1/products', { token: tokenA, body: { sku: 'NEW-001', name: '新生儿礼盒', category: '礼盒', current_price: 199 } });
check('创建商品 201', 201, prodCreate.status);
check('重复 SKU 409', 409, (await req('POST', '/v1/products', { token: tokenA, body: { sku: 'NEW-001', name: '重复' } })).status);
const prodListA = await req('GET', '/v1/products', { token: tokenA });
check('A 店商品可见(含新建)', true, prodListA.json.items.some((p) => p.sku === 'NEW-001'));
const prodListB = await req('GET', '/v1/products', { token: tokenB });
check('B 店看不到 A 店商品(0条)', 0, prodListB.json.items.length);
check('店员创建商品 403', 403, (await req('POST', '/v1/products', { token: tokenB, body: { sku: 'X', name: 'X' } })).status);

// ---------- 8. API-03：导入预览 + 提交幂等 + 导出 ----------
console.log('== API-03 导入/导出 ==');
const CSV = 'name,phone_tail\n李女士,8888\n王女士,9999\n,\n张女士,1234';
const MAPPING = { name: 'name', phone_tail: 'phone_tail' };
const preview = await req('POST', '/v1/imports/preview', { token: tokenA, body: { csv_text: CSV, mapping: MAPPING } });
check('导入预览 200', 200, preview.status);
check('可导入 2 条', 2, preview.json.importable_count);
const missingRow = preview.json.rows.find((r) => r.status === 'missing_field');
check('错误行有原因', true, missingRow !== undefined && typeof missingRow.reason === 'string' && missingRow.reason.length > 0);
check('疑似重复被识别', true, preview.json.rows.some((r) => r.status === 'suspected_duplicate'));
check('店员导入 403', 403, (await req('POST', '/v1/imports/preview', { token: tokenB, body: { csv_text: CSV, mapping: MAPPING } })).status);

const commit1 = await req('POST', '/v1/imports/commit', { token: tokenA, body: { batch_id: preview.json.batch_id, content_hash: preview.json.content_hash, csv_text: CSV, mapping: MAPPING } });
check('首次提交 imported=2', 2, commit1.json.imported_count);
check('首次提交非重放', false, commit1.json.idempotent_replay);
check('跳过重复 1 条', 1, commit1.json.skipped_duplicates);
check('错误行带原因', true, commit1.json.errors.length > 0 && typeof commit1.json.errors[0].reason === 'string');
const commit2 = await req('POST', '/v1/imports/commit', { token: tokenA, body: { batch_id: preview.json.batch_id, content_hash: preview.json.content_hash, csv_text: CSV, mapping: MAPPING } });
check('重复提交为幂等重放', true, commit2.json.idempotent_replay);
check('重复提交不重复记账(仍=2)', 2, commit2.json.imported_count);
check('内容指纹不符 409', 409, (await req('POST', '/v1/imports/commit', { token: tokenA, body: { batch_id: preview.json.batch_id, content_hash: 'hfake', csv_text: CSV, mapping: MAPPING } })).status);

const exp = await req('GET', '/v1/exports/customers', { token: tokenA });
check('管理员导出 200', 200, exp.status);
check('导出返回 CSV', true, exp.contentType.includes('text/csv') && typeof exp.text === 'string' && exp.text.startsWith('subject_id'));
check('店员导出 403', 403, (await req('GET', '/v1/exports/customers', { token: tokenB })).status);

// ---------- 9. API-04：知识状态机（只有 approved 进检索） ----------
console.log('== API-04 知识审核 ==');
const kn = await req('POST', '/v1/knowledge', { token: tokenA, body: { title: '夜奶减少建议', applicable: { scene_id: 'baby', subject_types: ['child'] }, steps: ['确认夜奶次数', '逐步减少'] } });
check('提交知识草稿 201', 201, kn.status);
check('新草稿状态 draft', 'draft', kn.json.status);
const knId = kn.json.id;
const knVersion = kn.json.version; // 1

const askBefore = await req('POST', '/v1/assistant/ask', { token: tokenA, body: { question: '尾号1234上次买什么' } });
check('draft 不进检索', false, askBefore.json.approved_experience.includes('确认夜奶次数'));
check('approved 进检索', true, askBefore.json.approved_experience.includes('距上次购买 ≥ 15 天触发补货提醒'));

check('提交审核 200', 200, (await req('POST', `/v1/knowledge/${knId}/review`, { token: tokenA, body: { decision: 'submit_review', expected_version: knVersion } })).status);
check('草稿直接 approve 非法 409', 409, (await req('POST', `/v1/knowledge/${knId}/review`, { token: tokenA, body: { decision: 'approve', expected_version: knVersion } })).status);
const knApprove = await req('POST', `/v1/knowledge/${knId}/review`, { token: tokenA, body: { decision: 'approve', expected_version: knVersion + 1 } });
check('审核批准 200', 200, knApprove.status);
check('批准后状态 approved', 'approved', knApprove.json.status);
const askAfter = await req('POST', '/v1/assistant/ask', { token: tokenA, body: { question: '尾号1234上次买什么' } });
check('approved 后进入检索', true, askAfter.json.approved_experience.includes('确认夜奶次数'));
const knArchive = await req('POST', `/v1/knowledge/${knId}/review`, { token: tokenA, body: { decision: 'archive', expected_version: knVersion + 2 } });
check('下架 200', 200, knArchive.status);
check('下架后状态 archived', 'archived', knArchive.json.status);
const askArchived = await req('POST', '/v1/assistant/ask', { token: tokenA, body: { question: '尾号1234上次买什么' } });
check('archived 后退出检索', false, askArchived.json.approved_experience.includes('确认夜奶次数'));
const knList = await req('GET', '/v1/knowledge?status=archived', { token: tokenA });
check('知识列表按状态过滤', true, knList.json.items.some((e) => e.id === knId));
check('店员审核知识 403', 403, (await req('POST', `/v1/knowledge/${knId}/review`, { token: tokenB, body: { decision: 'approve', expected_version: 1 } })).status);

// ---------- 10. API-02：撤权 → 旧会话立即失效 ----------
console.log('== API-02 撤权失效 ==');
check('撤权前 staff-a 可访问', 200, (await req('GET', '/v1/products', { token: tokenStaffA })).status);
check('店员无撤权权限 403', 403, (await req('POST', `/v1/memberships/${MEMBERSHIP_STAFF_A}/revoke`, { token: tokenB, body: { expected_version: 1 } })).status);
const revoke = await req('POST', `/v1/memberships/${MEMBERSHIP_STAFF_A}/revoke`, { token: tokenA, body: { expected_version: 1, reason: '离职' } });
check('管理员撤权 200', 200, revoke.status);
check('撤权返回失效会话数 1', 1, revoke.json.revoked_session_count);
check('撤权后 staff-a 旧 token 立即 401', 401, (await req('GET', '/v1/products', { token: tokenStaffA })).status);
check('撤权后 staff-a 重新登录 401', 401, (await req('POST', '/v1/auth/login', { body: { login_name: 'staff-a', password: (process.env.DIANNAO_DEMO_PASSWORD || 'demo-password') } })).status);
check('撤权后 manager-a 仍可访问', 200, (await req('GET', '/v1/products', { token: tokenA })).status);

// ---------- 11. API-04：审计可追溯 ----------
console.log('== API-04 审计 ==');
const audit = await req('GET', '/v1/audit?limit=200', { token: tokenA });
check('审计查询 200', 200, audit.status);
const actions = new Set((audit.json.items ?? []).map((i) => i.action));
check('审计含撤权记录', true, actions.has('membership_revoke'));
check('审计含知识审核记录', true, actions.has('knowledge_review'));
check('审计含知识下架记录', true, actions.has('knowledge_archive'));
check('审计含导入提交记录', true, actions.has('import_commit'));
check('审计含导出记录', true, actions.has('export'));
check('审计含登录记录', true, actions.has('login'));
check('店员查审计 403', 403, (await req('GET', '/v1/audit', { token: tokenB })).status);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
