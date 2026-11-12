// 运行时行为校验：Mock 三路径 + 问答分支 + 幂等。由 verify.sh 在临时目录执行（.ts 扩展名已补全）。
import {
  mockLogin,
  mockResolve,
  mockAsk,
  mockCreateDraft,
  mockRecommend,
  mockGetSummary,
  CONTRACTS_VERSION,
} from './contracts/index.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

// 1. 登录
const login = mockLogin('diannaoxy', 'x');
check('login manager-a 命中', !!login && login.__mock === true);
check('login 未知账号返回 undefined', mockLogin('nope', 'x') === undefined);

// 2. 身份检索三路径
const r1 = mockResolve('尾号1234');
check('resolve 单匹配 matched', r1.match_status === 'matched' && r1.needs_confirmation === false && r1.candidates.length === 1);
const r2 = mockResolve('5678');
check('resolve 多匹配 ambiguous 需确认', r2.match_status === 'ambiguous' && r2.needs_confirmation === true && r2.candidates.length === 2);
const r3 = mockResolve('9999');
check('resolve 无匹配 not_found', r3.match_status === 'not_found' && r3.candidates.length === 0);
check('resolve 全部带 __mock', r1.__mock === true && r2.__mock === true && r3.__mock === true);

// 3. 问答三分支
check('ask 有数据 ok', mockAsk('尾号1234上次买什么').status === 'ok');
check('ask 缺数据 no_data 不编造', mockAsk('陌生客户').status === 'no_data');
const human = mockAsk('孩子过敏怎么办');
check('ask 健康问题转人工', human.status === 'needs_human' && human.handoff === true);

// 4. 幂等：同 request_id 返回同一 receipt
const a = mockCreateDraft({ subject_ref: 's1', content: 'x', source_type: 'staff_text', request_id: 'req-1' });
const b = mockCreateDraft({ subject_ref: 's1', content: 'x', source_type: 'staff_text', request_id: 'req-1' });
check('draft 幂等：同 request_id 同一 id', a.id === b.id && a.trace_id === b.trace_id);
const c = mockCreateDraft({ subject_ref: 's2', content: 'y', source_type: 'staff_text', request_id: 'req-2' });
check('draft 不同 request_id 不同 id', c.id !== a.id);

// 5. 推荐
const rec = mockRecommend({ subject_ref: 's1', intent: '补货' });
check('recommend ok 且带引用', rec.status === 'ok' && rec.citations.length > 0 && rec.__mock === true);

// 6. 客户摘要（三行结构）
const sum = mockGetSummary('00000000-0000-4000-8000-000000000101');
check('summary 命中且三行齐全', !!sum && sum.display_label.length > 0 && sum.recent_transactions.length > 0 && sum.suggestions.length > 0);
check('summary 带证据', !!sum && sum.evidence.length > 0 && sum.__mock === true);
check('summary 未知主体返回 undefined', mockGetSummary('nope') === undefined);

// 7. 版本
check('CONTRACTS_VERSION === v2', CONTRACTS_VERSION === 'v2');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
