/**
 * 店脑 · 公共反诈域（隔离，只读公开案例，不触商家数据）
 * 主责：D 张（整理）· A 周（业务复核）
 *
 * 数据来源：docs/05-反诈官方案例来源_待审核.md 的 3 条候选官方来源。
 * 状态：演示用。正式上线前必须由平台管理员逐条核对正文并改为 approved。
 *
 * 铁律：
 *  - 不对具体对象作犯罪定性
 *  - 不索取密码/验证码/银行卡
 *  - 未命中案例不等于安全
 *  - 不读取任何门店客户资料
 */

export interface FraudCase {
  case_id: string;
  fraud_type: string;
  publisher: string;
  title: string;
  published_at: string;
  url: string;
  risk_signals: string[];
  status: 'draft' | 'approved';
}

export const FRAUD_CASES: FraudCase[] = [
  {
    case_id: 'AF-001',
    fraud_type: '刷单返利 + 同城交友诱导',
    publisher: '江苏省公安厅',
    title: '同城交友＋刷单返利＋线下取现？骗局又更新了！',
    published_at: '2025-05-09',
    url: 'https://gat.jiangsu.gov.cn/art/2025/5/9/art_89956_11560749.html',
    risk_signals: ['先做任务领取服务', '小额返利建立信任', '持续转账', '线下取现'],
    status: 'draft',
  },
  {
    case_id: 'AF-002',
    fraud_type: '涉黄卡片 / 色情引流 + 刷单',
    publisher: '福建省公安厅',
    title: '警惕！电诈案件最常见的七种引流方式',
    published_at: '2025-07-01',
    url: 'https://gat.fj.gov.cn/ztzl/fjjffpzxrx/spjq/202507/t20250701_6960424.htm',
    risk_signals: ['美女上门字样', '二维码卡片', '陌生链接', '诱导转账'],
    status: 'draft',
  },
  {
    case_id: 'AF-003',
    fraud_type: '色情引流 + 刷单返利（复合型）',
    publisher: '开平市公安局',
    title: '“约炮+刷单”，新型复合式诈骗来袭',
    published_at: '2024-03-22',
    url: 'https://www.kaiping.gov.cn/kpsgaj/gakx/gakx/content/post_3057196.html',
    risk_signals: ['陌生链接下载 APP', '先小额返利', '不断追加', '解冻费/保证金'],
    status: 'draft',
  },
];

/** 风险信号词典：描述命中即列出，不作为定性依据。 */
const SIGNAL_RULES: { signal: string; keywords: string[] }[] = [
  { signal: '要求垫资/转账', keywords: ['垫付', '垫资', '先转', '转账', '打款', '充值'] },
  { signal: '承诺高额返利', keywords: ['返利', '返现', '稳赚', '高收益', '佣金', '刷单'] },
  { signal: '做任务解锁服务', keywords: ['做任务', '完成任务', '解锁', '会员任务'] },
  { signal: '陌生链接/二维码下载', keywords: ['链接', '二维码', '下载app', '下载 APP', '安装包'] },
  { signal: '色情引流话术', keywords: ['美女上门', '约炮', '同城交友', '裸聊', '上门服务'] },
  { signal: '账号冻结/解冻费', keywords: ['冻结', '解冻', '保证金', '操作失败', '风控'] },
  { signal: '索要验证码/密码', keywords: ['验证码', '密码', '银行卡', '安全账户'] },
];

export interface FraudAssessment {
  risk_level: 'unknown' | 'low' | 'medium' | 'high';
  matched_signals: string[];
  cases: { case_id: string; publisher: string; published_at: string; title: string; url: string }[];
  uncertain_facts: string[];
  suggested_steps: string[];
  trace_id: string;
}

export function assessFraud(description: string): FraudAssessment {
  const text = description.toLowerCase();
  const matched = SIGNAL_RULES.filter((r) => r.keywords.some((k) => text.includes(k.toLowerCase())))
    .map((r) => r.signal);

  const cases = FRAUD_CASES.filter((c) =>
    c.risk_signals.some((s) => matched.some((m) => s.includes(m.slice(0, 2)) || m.includes(s.slice(0, 2)))),
  );

  let risk: FraudAssessment['risk_level'] = 'unknown';
  if (matched.length >= 3) risk = 'high';
  else if (matched.length === 2) risk = 'medium';
  else if (matched.length === 1) risk = 'low';

  const steps = [
    '立即停止转账，不提供验证码、密码、银行卡信息',
    '保留聊天记录与转账凭证',
    '拨打 96110 或 110 核实，或通过国家反诈中心 APP 举报',
  ];
  if (/已转|已经转|转过去|付款了/.test(description)) {
    steps.unshift('已转账：立刻联系银行申请止付/冻结，并尽快报警');
  }

  return {
    risk_level: risk,
    matched_signals: matched,
    cases: cases.slice(0, 3).map((c) => ({
      case_id: c.case_id,
      publisher: c.publisher,
      published_at: c.published_at,
      title: c.title,
      url: c.url,
    })),
    uncertain_facts: [
      '未核实对方身份与平台资质',
      '未确认资金流向',
      '未命中具体案例不代表安全',
    ],
    suggested_steps: steps,
    trace_id: 'trace-fraud',
  };
}
