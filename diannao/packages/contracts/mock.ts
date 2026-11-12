/**
 * 店脑 · Mock 数据
 *
 * 主责：B 邱 ｜ 其他人不得直接修改本目录。
 * 版本：v1（2026-11-07）
 *
 * 规则（来自 01-共用开发规范.md §3.3）：
 *  - C/D/E 在 B 的 API 未实现前，一律基于 Mock 开发。
 *  - Mock 返回数据必须带 __mock: true 标记，避免被误当真实数据演示。
 *  - 任何演示必须能说清「这段数据是 Mock 还是真实」。
 *
 * 本文件覆盖冲刺主链路三条路径：单匹配 / 多匹配（歧义）/ 无匹配，
 * 以及问答的 ok / no_data / needs_human 分支，供 C/D/E 直接 import。
 */

import type {
  AssessFraudResponse,
  AssistantResponse,
  AuditLog,
  AuthPrincipal,
  CreateDraftRequest,
  CustomerSummary,
  ImportCommitResponse,
  KnowledgeEntry,
  LoginResponse,
  Membership,
  MutationReceipt,
  PreviewImportResponse,
  ProductRecord,
  RecommendRequest,
  Reminder,
  ReportOverview,
  ResolveIdentityResponse,
} from './types';

// ============================================================
// 0. 登录态（冲刺版写死两个测试账号）
// ============================================================

export const MOCK_PRINCIPAL_TENANT_A: AuthPrincipal = {
  user_id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-00000000000a',
  store_id: '00000000-0000-4000-8000-0000000000a1',
  role: 'manager',
  token: 'mock-token-manager-A',
};

export const MOCK_PRINCIPAL_TENANT_B: AuthPrincipal = {
  user_id: '00000000-0000-4000-8000-000000000002',
  tenant_id: '00000000-0000-4000-8000-00000000000b',
  store_id: '00000000-0000-4000-8000-0000000000b1',
  role: 'staff',
  token: 'mock-token-staff-B',
};

const LOGIN_TOKENS: Record<string, LoginResponse> = {
  'diannaoxy': {
    principal: MOCK_PRINCIPAL_TENANT_A,
    expires_at: '2026-11-07T18:00:00.000Z',
    __mock: true,
  },
  'staff-b': {
    principal: MOCK_PRINCIPAL_TENANT_B,
    expires_at: '2026-11-07T18:00:00.000Z',
    __mock: true,
  },
};

/** 冲刺版登录：仅认两个写死账号。 */
export function mockLogin(login_name: string, _password: string): LoginResponse | undefined {
  return LOGIN_TOKENS[login_name];
}

// ============================================================
// 1. 身份检索：单匹配 / 多匹配 / 无匹配
// ============================================================

/** 单命中：尾号 1234 张女士。 */
export const MOCK_RESOLVE_MATCHED: ResolveIdentityResponse = {
  candidates: [
    { subject_ref: '00000000-0000-4000-8000-000000000101', masked_label: '尾号 1234 · 张女士' },
  ],
  needs_confirmation: false,
  match_status: 'matched',
  resolved_subject_ref: '00000000-0000-4000-8000-000000000101',
  trace_id: 'trace-resolve-matched',
  __mock: true,
};

/** 多命中：尾号 5678 歧义，需店员确认，只展示脱敏候选。 */
export const MOCK_RESOLVE_AMBIGUOUS: ResolveIdentityResponse = {
  candidates: [
    { subject_ref: '00000000-0000-4000-8000-000000000201', masked_label: '尾号 5678 · 张*', hint: '上次到店 10-20' },
    { subject_ref: '00000000-0000-4000-8000-000000000202', masked_label: '尾号 5678 · 章*', hint: '上次到店 10-25' },
  ],
  needs_confirmation: true,
  match_status: 'ambiguous',
  trace_id: 'trace-resolve-ambiguous',
  __mock: true,
};

/** 无命中。 */
export const MOCK_RESOLVE_NOT_FOUND: ResolveIdentityResponse = {
  candidates: [],
  needs_confirmation: false,
  match_status: 'not_found',
  trace_id: 'trace-resolve-notfound',
  __mock: true,
};

/**
 * Mock 身份检索：按 query 关键词分流到三条路径，便于 C/D/E 覆盖单测。
 * 真实实现由 B 在 services/api 完成，tenant_id 从 token 解析。
 */
export function mockResolve(query: string): ResolveIdentityResponse {
  const q = query.trim();
  if (q.includes('1234') || q.includes('张女士')) return MOCK_RESOLVE_MATCHED;
  if (q.includes('5678')) return MOCK_RESOLVE_AMBIGUOUS;
  return MOCK_RESOLVE_NOT_FOUND;
}

// ============================================================
// 2. 问答：ok / no_data / needs_human
// ============================================================

/** 有数据：上次买过什么纸尿裤。 */
export const MOCK_ASK_OK: AssistantResponse = {
  status: 'ok',
  subject: '00000000-0000-4000-8000-000000000101',
  answer:
    '张女士上次在 10-20 购买了 L 码纸尿裤 2 包。孩子目前约 14 个月，L 码仍合适。',
  approved_experience: ['14 个月龄客户常配 L 码纸尿裤'],
  suggestions: ['可提醒补货：上次购买距今 18 天', '本月有促销可告知'],
  citations: [
    {
      source_type: 'transaction',
      record_id: '00000000-0000-4000-8000-000000000310',
      observed_at: '2026-10-20T03:15:00.000Z',
      updated_at: '2026-10-20T03:15:00.000Z',
      excerpt: 'L 码纸尿裤 ×2',
    },
  ],
  uncertainties: [],
  needs_confirmation: false,
  handoff: false,
  trace_id: 'trace-ask-ok',
  __mock: true,
};

/** 缺数据：返回「暂无记录」，不编造。 */
export const MOCK_ASK_NO_DATA: AssistantResponse = {
  status: 'no_data',
  answer: '暂无记录：该客户近期没有购买记录可参考。',
  approved_experience: [],
  suggestions: ['可现场询问并补录'],
  citations: [],
  uncertainties: ['该客户购买历史为空'],
  needs_confirmation: false,
  handoff: false,
  trace_id: 'trace-ask-nodata',
  __mock: true,
};

/** 转人工：涉及儿童健康/医疗建议。 */
export const MOCK_ASK_NEEDS_HUMAN: AssistantResponse = {
  status: 'needs_human',
  subject: '00000000-0000-4000-8000-000000000101',
  answer: '该问题涉及儿童健康判断，已转人工，AI 不作医疗建议。',
  approved_experience: [],
  suggestions: ['请店长或具备资质人员跟进'],
  citations: [],
  uncertainties: ['儿童健康类问题需人工核实'],
  needs_confirmation: false,
  handoff: true,
  handoff_required: true,
  actions: ['转店长'],
  trace_id: 'trace-ask-human',
  __mock: true,
};

/** Mock 问答：含「健康/过敏/医疗」关键词转人工；有「1234」走 ok；其余 no_data。 */
export function mockAsk(question: string): AssistantResponse {
  const q = question.toLowerCase();
  if (/(健康|过敏|医疗|生病|发烧|用药)/.test(q)) return MOCK_ASK_NEEDS_HUMAN;
  if (question.includes('1234') || question.includes('张女士')) return MOCK_ASK_OK;
  return MOCK_ASK_NO_DATA;
}

// ============================================================
// 3. 回写凭证（幂等）
// ============================================================

const DRAFT_STORE: Record<string, MutationReceipt> = {};

// 确定性计数器：避免随机 ID 导致单元测试不可复现。
let draftSeq = 0;
function nextDraftId(): string {
  draftSeq += 1;
  const seq = String(draftSeq).padStart(12, '0');
  return `00000000-0000-4000-8000-${seq}`;
}

/** Mock 创建草稿：幂等——同 request_id 返回同一 receipt；重复请求不重复记账。 */
export function mockCreateDraft(req: CreateDraftRequest): MutationReceipt {
  if (req.request_id && DRAFT_STORE[req.request_id]) {
    return DRAFT_STORE[req.request_id];
  }
  const receipt: MutationReceipt = {
    id: nextDraftId(),
    status: 'draft',
    trace_id: 'trace-draft-' + draftSeq,
    version: 1,
    __mock: true,
  };
  if (req.request_id) DRAFT_STORE[req.request_id] = receipt;
  return receipt;
}

// ============================================================
// 3.5 客户摘要（客户卡片三行结构）
// ============================================================

export const MOCK_CUSTOMER_SUMMARY: CustomerSummary = {
  subject_ref: '00000000-0000-4000-8000-000000000101',
  display_label: '张女士（尾号 1234）',
  subject_type: 'person',
  profile: {
    'child.birthdate': '2025-09-12',
    'child.formula_stage': '2段',
    'child.diapers_size': 'L',
    'pref.brand': '帮宝适',
  },
  recent_transactions: [
    {
      id: '00000000-0000-4000-8000-000000000310',
      occurred_at: '2026-10-20T03:15:00.000Z',
      lines: [
        {
          product_id: '00000000-0000-4000-8000-000000000501',
          product_name: 'L 码纸尿裤',
          sku: 'DIA-L-001',
          quantity: 2,
          unit_price: 89.0,
        },
      ],
      total_amount: 178.0,
      currency: 'CNY',
    },
  ],
  last_purchase_at: '2026-10-20T03:15:00.000Z',
  suggestions: ['可提醒补货：上次购买距今 18 天', '本月有促销可告知'],
  evidence: [
    {
      source_type: 'transaction',
      record_id: '00000000-0000-4000-8000-000000000310',
      observed_at: '2026-10-20T03:15:00.000Z',
      updated_at: '2026-10-20T03:15:00.000Z',
      excerpt: 'L 码纸尿裤 ×2',
    },
    {
      source_type: 'verified_attribute',
      record_id: '00000000-0000-4000-8000-000000000320',
      observed_at: '2026-09-12T00:00:00.000Z',
      excerpt: '孩子生日 2025-09-12',
    },
  ],
  handoff_required: false,
  trace_id: 'trace-summary',
  __mock: true,
};

/** Mock 客户摘要：未知 subject_ref 返回 undefined（API 应转 404）。 */
export function mockGetSummary(subjectRef: string): CustomerSummary | undefined {
  if (subjectRef === MOCK_CUSTOMER_SUMMARY.subject_ref) return MOCK_CUSTOMER_SUMMARY;
  return undefined;
}

// ============================================================
// 4. 知识条目（只有 approved 进检索）
// ============================================================

export const MOCK_KNOWLEDGE_DRAFT: KnowledgeEntry = {
  id: '00000000-0000-4000-8000-000000000401',
  tenant_id: MOCK_PRINCIPAL_TENANT_A.tenant_id,
  title: '14 个月龄纸尿裤码数建议（草稿）',
  applicable: { scene_id: 'baby', subject_types: ['child'] },
  steps: ['确认月龄', '对照码数表'],
  constraints: [{ rule_key: 'hard_age_range_filter' }],
  status: 'draft',
  version: 1,
  updated_at: '2026-11-07T08:00:00.000Z',
  __mock: true,
};

export const MOCK_KNOWLEDGE_APPROVED: KnowledgeEntry = {
  id: '00000000-0000-4000-8000-000000000402',
  tenant_id: MOCK_PRINCIPAL_TENANT_A.tenant_id,
  title: '纸尿裤补货提醒经验（已审核）',
  applicable: { scene_id: 'baby', subject_types: ['child'] },
  steps: ['距上次购买 ≥ 15 天触发补货提醒'],
  constraints: [
    { rule_key: 'allergy_manual_check' },
    { rule_key: 'stock_freshness_check' },
  ],
  status: 'approved',
  version: 2,
  approved_by: MOCK_PRINCIPAL_TENANT_A.user_id,
  updated_at: '2026-11-07T09:00:00.000Z',
  __mock: true,
};

// ============================================================
// 5. 推荐 / 提醒 / 报表 / 导入 / 反诈
// ============================================================

export function mockRecommend(req: RecommendRequest): AssistantResponse {
  return {
    status: 'ok',
    subject: req.subject_ref,
    answer: '基于历史购买与库存，建议 L 码纸尿裤。',
    approved_experience: MOCK_KNOWLEDGE_APPROVED.steps,
    suggestions: ['L 码纸尿裤', '配套湿巾'],
    citations: [
      {
        source_type: 'inventory_snapshot',
        record_id: '00000000-0000-4000-8000-000000000510',
        observed_at: '2026-11-07T00:00:00.000Z',
        excerpt: 'L 码纸尿裤库存 12',
      },
    ],
    uncertainties: [],
    needs_confirmation: false,
    handoff: false,
    trace_id: 'trace-recommend',
    __mock: true,
  };
}

export const MOCK_REMINDERS: Reminder[] = [
  {
    id: '00000000-0000-4000-8000-000000000601',
    subject_ref: '00000000-0000-4000-8000-000000000101',
    status: 'approved',
    due_at: '2026-11-09T02:00:00.000Z',
    draft_text: '张女士，您上次买的纸尿裤可能需要补货，本月有促销。',
    __mock: true,
  },
];

export const MOCK_REPORT_OVERVIEW: ReportOverview = {
  period: '2026-10',
  currency: 'CNY',
  gross_sales: 38650.0,
  order_count: 142,
  repeat_buyer_count: 47,
  source_updated_at: '2026-11-07T07:00:00.000Z',
  __mock: true,
};

export const MOCK_IMPORT_PREVIEW: PreviewImportResponse = {
  importable_count: 18,
  rows: [
    { row_index: 1, status: 'ok' },
    { row_index: 2, status: 'missing_field', missing_fields: ['phone_tail'] },
    { row_index: 3, status: 'suspected_duplicate', reason: '与 subject_ref 已有记录疑似重复' },
  ],
  trace_id: 'trace-import-preview',
  __mock: true,
};

export const MOCK_ANTIFRAUD: AssessFraudResponse = {
  risk_level: 'high',
  matched_signals: ['刷单返利', '要求先转账'],
  cases: [
    {
      case_id: 'public-fraud-001',
      publisher: '国家反诈中心',
      published_at: '2026-10-01',
      title: '刷单返利类诈骗典型案例',
      url: 'https://example.invalid/fraud/001',
    },
  ],
  uncertain_facts: ['无法确认对方真实身份'],
  suggested_steps: ['不要转账', '保留聊天记录', '拨打 96110'],
  trace_id: 'trace-antifraud',
  __mock: true,
};

// ============================================================
// 6. 成员关系与撤权（API-02）
// ============================================================

// store_id 常量（mock 用），与 services/api/src/store.ts 的 STORE_A1/STORE_B1 保持同值。
export const STORE_A1_REF = '00000000-0000-4000-8000-0000000000a1';
export const STORE_B1_REF = '00000000-0000-4000-8000-0000000000b1';

export const MOCK_MEMBERSHIP_MANAGER_A: Membership = {
  id: '00000000-0000-4000-8000-000000000701',
  tenant_id: MOCK_PRINCIPAL_TENANT_A.tenant_id,
  store_id: STORE_A1_REF,
  user_id: MOCK_PRINCIPAL_TENANT_A.user_id,
  role: 'manager',
  membership_version: 1,
};

export const MOCK_MEMBERSHIP_STAFF_B: Membership = {
  id: '00000000-0000-4000-8000-000000000702',
  tenant_id: MOCK_PRINCIPAL_TENANT_B.tenant_id,
  store_id: STORE_B1_REF,
  user_id: MOCK_PRINCIPAL_TENANT_B.user_id,
  role: 'staff',
  membership_version: 1,
};

// ============================================================
// 7. 商品记录（API-02）
// ============================================================

export const MOCK_PRODUCTS: ProductRecord[] = [
  {
    id: '00000000-0000-4000-8000-000000000501',
    tenant_id: MOCK_PRINCIPAL_TENANT_A.tenant_id,
    sku: 'DIA-L-001',
    name: 'L 码纸尿裤',
    category: '纸尿裤',
    current_price: 89.0,
    currency: 'CNY',
    shelf_location: 'A-3',
    attributes: { applicable_age_months: '12-24', health_tag: '日用品' },
    updated_at: '2026-11-01T00:00:00.000Z',
    __mock: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000502',
    tenant_id: MOCK_PRINCIPAL_TENANT_A.tenant_id,
    sku: 'DIA-2-001',
    name: '2 段奶粉',
    category: '奶粉',
    current_price: 268.0,
    currency: 'CNY',
    shelf_location: 'B-1',
    attributes: { applicable_age_months: '6-12', health_tag: '食品' },
    updated_at: '2026-11-01T00:00:00.000Z',
    __mock: true,
  },
];

// ============================================================
// 8. 导入提交（API-03 幂等）
// ============================================================

const IMPORT_BATCHES: Map<string, ImportCommitResponse> = new Map();

/** Mock 导入提交：相同 content_hash 重复提交返回同一结果，不重复记账。 */
export function mockImportCommit(
  batchId: string,
  contentHash: string,
  requestId?: string,
): ImportCommitResponse {
  const key = contentHash;
  const existing = IMPORT_BATCHES.get(key);
  if (existing) {
    return { ...existing, idempotent_replay: true };
  }
  const result: ImportCommitResponse = {
    batch_id: batchId,
    status: 'committed',
    imported_count: 18,
    skipped_duplicates: 1,
    errors: [
      { row_index: 2, reason: '缺少必填字段 phone_tail', field: 'phone_tail', raw_excerpt: '李,,' },
    ],
    idempotent_replay: false,
    trace_id: 'trace-import-' + (requestId ?? contentHash.slice(0, 8)),
    __mock: true,
  };
  IMPORT_BATCHES.set(key, result);
  return result;
}

// ============================================================
// 9. 知识审核流转（API-04）
// ============================================================

/** 知识状态流转表：draft → pending_review → approved → archived。 */
export function nextKnowledgeStatus(
  current: KnowledgeEntry['status'],
  decision: 'submit_review' | 'approve' | 'reject' | 'archive',
): KnowledgeEntry['status'] {
  switch (decision) {
    case 'submit_review':
      return current === 'draft' ? 'pending_review' : current;
    case 'approve':
      return current === 'pending_review' ? 'approved' : current;
    case 'reject':
      return current === 'pending_review' ? 'draft' : current;
    case 'archive':
      return current === 'approved' ? 'archived' : current;
  }
}

// ============================================================
// 10. 审计日志（API-04 流转可追溯）
// ============================================================

export const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: '00000000-0000-4000-8000-000000000801',
    tenant_id: MOCK_PRINCIPAL_TENANT_A.tenant_id,
    actor_id: MOCK_PRINCIPAL_TENANT_A.user_id,
    action: 'knowledge_review',
    object_type: 'knowledge_entry',
    object_ref: MOCK_KNOWLEDGE_APPROVED.id,
    status: 'approved',
    trace_id: 'trace-audit-1',
    occurred_at: '2026-11-07T09:00:00.000Z',
    __mock: true,
  },
];

