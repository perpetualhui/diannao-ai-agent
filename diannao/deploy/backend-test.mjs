/**
 * 店脑后台功能自测（黑盒，跑在服务器上）
 * 用法：node deploy/backend-test.mjs
 * 覆盖：登录/权限/概览/员工/绑定/存储/接待/反诈/租户隔离
 */

const BASE = process.env.DIANNAO_BASE ?? 'http://127.0.0.1:7401';
const PASSWORD = process.env.DIANNAO_DEMO_PASSWORD || 'demo-password';
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail = '') {
  pass += 1;
  console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`);
}
function bad(name, detail) {
  fail += 1;
  failures.push(`${name}: ${detail}`);
  console.log(`FAIL  ${name}  — ${detail}`);
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  let data = {};
  try { data = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, data };
}

async function login(name, password = PASSWORD) {
  const r = await req('POST', '/v1/auth/login', { body: { login_name: name, password } });
  return r;
}

console.log('==========================================');
console.log('  店脑后台功能自测');
console.log('  目标：' + BASE);
console.log('==========================================');

// ── 1. 登录 ──
const owner = await login('diannaoxy');
owner.status === 200 && owner.data.principal?.token
  ? ok('店长登录', 'role=' + owner.data.principal.role)
  : bad('店长登录', 'HTTP ' + owner.status);
const T = owner.data.principal?.token;

const wrong = await login('diannaoxy', 'wrong-pass');
wrong.status === 401 ? ok('错误密码被拒绝', '401') : bad('错误密码被拒绝', 'HTTP ' + wrong.status);

// ── 2. 概览 ──
const ov = await req('GET', '/v1/admin/overview', { token: T });
ov.status === 200 && typeof ov.data.staff_count === 'number'
  ? ok('概览统计', `员工${ov.data.staff_count} 绑定${ov.data.binding_count} 客户${ov.data.customer_count}`)
  : bad('概览统计', 'HTTP ' + ov.status);

// ── 3. 员工管理 ──
const staff = await req('GET', '/v1/admin/staff', { token: T });
Array.isArray(staff.data.items) && staff.data.items.length >= 4
  ? ok('员工列表', staff.data.items.length + ' 人')
  : bad('员工列表', 'HTTP ' + staff.status);

const testName = 'test-' + Math.random().toString(36).slice(2, 7);
const add = await req('POST', '/v1/admin/staff', {
  token: T,
  body: { login_name: testName, password: 'test123456', scene: 'baby' },
});
add.status === 201 ? ok('新增员工', testName) : bad('新增员工', 'HTTP ' + add.status);

const newLogin = await login(testName, 'test123456');
newLogin.status === 200 ? ok('新员工可登录', testName) : bad('新员工可登录', 'HTTP ' + newLogin.status);

const staffToken = newLogin.data.principal?.token;
// 概览按设计允许普通用户查看（仅本店）；管理类接口仍须 403
const staffOverview = await req('GET', '/v1/admin/overview', { token: staffToken });
staffOverview.status === 200 && staffOverview.data.staff_count === null
  ? ok('普通用户可看本店概览', 'staff_count=null')
  : bad('普通用户可看本店概览', 'HTTP ' + staffOverview.status + ' staff=' + staffOverview.data.staff_count);
const forbidden = await req('GET', '/v1/admin/staff', { token: staffToken });
forbidden.status === 403
  ? ok('店员访问管理接口被拒', '403')
  : bad('店员访问管理接口被拒', 'HTTP ' + forbidden.status);

const del = await req('POST', '/v1/admin/staff/remove', { token: T, body: { login_name: testName } });
del.status === 200 ? ok('删除员工', testName) : bad('删除员工', 'HTTP ' + del.status);

// ── 4. 微信绑定 ──
const binds = await req('GET', '/v1/admin/bindings', { token: T });
Array.isArray(binds.data.items)
  ? ok('绑定列表', binds.data.items.length + ' 条')
  : bad('绑定列表', 'HTTP ' + binds.status);

const unbindMiss = await req('POST', '/v1/admin/bindings/unbind', {
  token: T,
  body: { sender_id: 'wxid-not-exist' },
});
unbindMiss.status === 404
  ? ok('解绑不存在账号返回 404', '')
  : bad('解绑不存在账号返回 404', 'HTTP ' + unbindMiss.status);

const wxAcc = await req('GET', '/v1/admin/wechat/accounts', { token: T });
Array.isArray(wxAcc.data.items)
  ? ok('OpenClaw 微信账号列表', wxAcc.data.items.length + ' 个')
  : bad('OpenClaw 微信账号列表', 'HTTP ' + wxAcc.status);

// ── 5. 数据存储 ──
const detail = await req('GET', '/v1/admin/storage/detail', { token: T });
Array.isArray(detail.data.tables) && detail.data.tables.length >= 8
  ? ok('存储明细', detail.data.tables.length + ' 张表')
  : bad('存储明细', 'HTTP ' + detail.status + ' tables=' + (detail.data.tables?.length ?? 0));

// ── 6. 客户接待链路 ──
const resolve = await req('POST', '/v1/identity/resolve', { token: T, body: { query: '1234' } });
resolve.status === 200 && resolve.data.match_status
  ? ok('认人检索', resolve.data.match_status + ' ' + (resolve.data.candidates?.length ?? 0) + ' 候选')
  : bad('认人检索', 'HTTP ' + resolve.status);

const subjectRef = resolve.data.resolved_subject_ref ?? resolve.data.candidates?.[0]?.subject_ref;
if (subjectRef) {
  const sum = await req('GET', '/v1/subjects/' + encodeURIComponent(subjectRef), { token: T });
  sum.status === 200 && sum.data.display_label
    ? ok('客户档案', sum.data.display_label)
    : bad('客户档案', 'HTTP ' + sum.status);
} else {
  bad('客户档案', '未取得 subject_ref');
}

const draft = await req('POST', '/v1/notes/drafts', {
  token: T,
  body: { subject_ref: subjectRef, content: '自测记录：客户确认要补货', source_type: 'staff_text' },
});
draft.status === 201 ? ok('服务记录写入', 'draft ' + String(draft.data.id).slice(0, 8)) : bad('服务记录写入', 'HTTP ' + draft.status);

// ── 7. 反诈 ──
const fraud = await req('POST', '/v1/antifraud/assess', {
  body: { description: '对方说刷单返利，让我先垫付500转账' },
});
fraud.status === 200 && fraud.data.risk_level
  ? ok('反诈评估', 'risk=' + fraud.data.risk_level + ' 信号' + (fraud.data.matched_signals?.length ?? 0))
  : bad('反诈评估', 'HTTP ' + fraud.status);

// ── 8. 租户隔离 ──
const cloth = await login('cloth-demo');
const clothToken = cloth.data.principal?.token;
const clothResolve = await req('POST', '/v1/identity/resolve', { token: clothToken, body: { query: '1234' } });
const clothHits = (clothResolve.data.candidates ?? []).map((c) => c.masked_label);
const leaked = clothHits.some((l) => l.includes('张女士'));
leaked
  ? bad('租户隔离', '服装店看到了母婴客户：' + clothHits.join(','))
  : ok('租户隔离', '服装店查不到母婴客户（' + (clothResolve.data.match_status ?? '?') + '）');

// ── 汇总 ──
console.log('==========================================');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exitCode = 1;
} else {
  console.log('全部通过。');
}
