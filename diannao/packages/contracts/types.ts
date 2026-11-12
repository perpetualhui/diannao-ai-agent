/**
 * 店脑 · 共享契约类型定义
 *
 * 主责：B 邱 ｜ 其他人不得直接修改本目录，改动请以 patch 形式提交给主责人。
 * 版本：v1（2026-11-07，首次产出）
 *
 * 字段来源：
 *  - docs/03-业务接口_OpenAPI.yaml（业务端点与 schema）
 *  - docs/04-核心数据库草案.sql（数据状态机与枚举）
 *  - config/行业配置样例.json（行业字段组与规则）
 *  - 01-共用开发规范.md 第三节（契约必须覆盖的字段）
 *
 * 规则：
 *  - TypeScript 严格模式，禁止 any / @ts-ignore。
 *  - 业务主键一律 UUID；手机尾号、姓名只做检索线索。
 *  - 时间后端统一 UTC 存储，返回 ISO 8601 字符串。
 *  - 错误统一 { code, message, trace_id }。
 *  - 所有跨域对接以此文件为准，与 OpenAPI 冲突时以 OpenAPI 为准，由 B 同步本文件。
 */

// ============================================================
// 0. 基础别名
// ============================================================

/** UUID 字符串。业务主键统一用 UUID。 */
export type Uuid = string;

/** ISO 8601 字符串（UTC 存储，前端本地化显示）。 */
export type IsoTimestamp = string;

/** ISO 8601 日期字符串（仅日期，如生日、发布日）。 */
export type IsoDate = string;

/** 手机尾号、姓名等只用于检索候选，不作为主键。 */
export type IdentityHint = string;

/** 幂等键：消息/请求唯一标识，重复请求不重复记账。 */
export type IdempotencyKey = string;

/** 链路追踪 ID，贯穿一次请求的日志与回写。 */
export type TraceId = string;

/** 租户/门店/主体等引用，已消歧确认后返回。 */
export type SubjectRef = Uuid;

// ============================================================
// 1. 主体与身份（identity/resolve）
// ============================================================

/** 主体类型：来自数据库 subjects.subject_type 与行业配置 scenes.subject_types。 */
export type SubjectType =
  | 'person'
  | 'child'
  | 'vehicle'
  | 'family';

/**
 * 客户匹配状态 —— 契约必须覆盖。
 *  - matched: 命中唯一客户
 *  - ambiguous: 命中多个，需店员确认
 *  - not_found: 无命中
 */
export type MatchStatus = 'matched' | 'ambiguous' | 'not_found';

/** 检索线索类型：尾号、姓名、车牌等。 */
export type IdentityKeyType =
  | 'phone_tail'
  | 'name'
  | 'plate'
  | 'member_no'
  | 'external_ref';

/** 脱敏候选：歧义未确认前只展示这些字段，不展示完整档案。 */
export interface MaskedCandidate {
  /** 已消歧后可用的主体引用；确认前仅作占位。 */
  subject_ref: SubjectRef;
  /** 脱敏标签，如「尾号 1234 · 张*」「尾号 1234 · 张女士」。 */
  masked_label: string;
  /** 可选辅助线索，帮助店员二次判断，仍为脱敏。 */
  hint?: string;
}

/** POST /v1/identity/resolve 请求体。 */
export interface ResolveIdentityRequest {
  /** 检索文本，maxLength 200。 */
  query: string;
  /** 限定主体类型，缩小范围；不传则不限。 */
  subject_type?: SubjectType;
}

/** POST /v1/identity/resolve 200 响应体。 */
export interface ResolveIdentityResponse {
  /** 当前门店范围内的脱敏候选列表。 */
  candidates: MaskedCandidate[];
  /** 命中多人时为 true，需店员确认后才能查看完整档案。 */
  needs_confirmation: boolean;
  /** 匹配状态，便于前端分支处理。 */
  match_status: MatchStatus;
  /** 选中确认后的主体引用；仅在 matched 单命中时直接返回。 */
  resolved_subject_ref?: SubjectRef;
  trace_id: TraceId;
  /** Mock 标记，避免被误当真实数据演示。 */
  __mock?: boolean;
}

// ============================================================
// 2. 证据 Evidence（事实必须有来源）
// ============================================================

/** 证据来源类型：对应数据库各业务表。 */
export type EvidenceSourceType =
  | 'transaction'
  | 'service_event'
  | 'verified_attribute'
  | 'product'
  | 'inventory_snapshot'
  | 'knowledge_entry'
  | 'rule';

/**
 * 证据 —— 契约必须覆盖。
 * 每条具体事实（价格、库存、交易、推荐理由）必须有来源；
 * 无来源就说「暂无记录」，不猜。
 */
export interface Evidence {
  source_type: EvidenceSourceType;
  /** 来源记录 ID（UUID 或业务键）。 */
  record_id: string;
  /** 观察到该事实的时间。 */
  observed_at: IsoTimestamp;
  /** 该来源记录最近一次更新时间。 */
  updated_at?: IsoTimestamp;
  /** 摘录，maxLength 200，用于问答引用展示。 */
  excerpt?: string;
}

// ============================================================
// 3. 问答（assistant/ask）
// ============================================================

/** POST /v1/assistant/ask 请求体。 */
export interface AskRequest {
  /** 自然语言问题，minLength 1, maxLength 1000。 */
  question: string;
  /**
   * 会话/消息引用，仅做幂等与关联，不作为授权证明。
   * 租户隔离在服务端，tenant_id 由登录态解析，绝不信任请求体或聊天文本。
   */
  conversation_ref?: string;
  /** 幂等键，重复请求返回同一结果，不重复记账。 */
  request_id?: IdempotencyKey;
}

/** 问答/操作结果状态。 */
export type AssistantStatus =
  | 'ok'
  | 'no_data'
  | 'needs_confirmation'
  | 'needs_human'
  | 'forbidden'
  | 'error';

/**
 * 问答结果 —— 契约必须覆盖。
 * 字段：subject, facts, approved_experience, suggestions, citations, uncertainties, handoff_required。
 * 这里以 AssistantResponse 统一表达，answer 内含事实/经验/建议的分层，
 * citations 用 evidence，uncertainties 单独列出，handoff_required 即 handoff。
 */
export interface AssistantResponse {
  status: AssistantStatus;
  /** 当前问答涉及的主体引用（已消歧）。 */
  subject?: SubjectRef;
  /** 自然语言答案；分事实/已审核经验/建议三层呈现。 */
  answer: string;
  /** 已审核经验（只有 approved 进入正式检索）。 */
  approved_experience: string[];
  /** 建议下一步动作。 */
  suggestions: string[];
  /** 引用证据，可展开。 */
  citations: Evidence[];
  /** 不确定项，缺资料时明确列出，不编造。 */
  uncertainties: string[];
  /** 命中多人时的脱敏候选。 */
  candidates?: MaskedCandidate[];
  needs_confirmation: boolean;
  /** 需转人工（医疗/健康/投诉/安全冲突等）。 */
  handoff: boolean;
  handoff_required?: boolean;
  /** 可执行动作提示。 */
  actions?: string[];
  trace_id: TraceId;
  __mock?: boolean;
}

// ============================================================
// 3.5 客户摘要（客户卡片：是谁 / 以前买过什么 / 建议做什么）
// ============================================================

/** 交易明细行。 */
export interface TransactionLine {
  product_id: Uuid;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
}

/** 一条购买记录摘要。 */
export interface TransactionSummary {
  id: Uuid;
  occurred_at: IsoTimestamp;
  lines: TransactionLine[];
  total_amount: number;
  currency: string;
}

/**
 * 客户摘要 —— 客户卡片数据。
 * 三行结构：display_label（是谁）/ recent_transactions（以前买过什么）/ suggestions（建议做什么）。
 * 仅在身份「已消歧确认」后返回完整档案；歧义未确认前只返回脱敏候选（见 ResolveIdentityResponse）。
 */
export interface CustomerSummary {
  subject_ref: SubjectRef;
  /** 脱敏展示标签，如「张女士（尾号 1234）」。 */
  display_label: string;
  subject_type: SubjectType;
  /** 行业字段组（jsonb），如 child.birthdate / vehicle.plate 等，键见 configs/scenarios。 */
  profile: Record<string, unknown>;
  recent_transactions: TransactionSummary[];
  last_purchase_at?: IsoTimestamp;
  /** 建议做什么（基于已审核经验与规则）。 */
  suggestions: string[];
  /** 支撑该摘要的证据。 */
  evidence: Evidence[];
  /** 涉及健康/安全冲突等需转人工。 */
  handoff_required: boolean;
  trace_id: TraceId;
  __mock?: boolean;
}

// ============================================================
// 4. 回写凭证 MutationReceipt（幂等）
// ============================================================

/** 回写/审核状态。 */
export type MutationStatus =
  | 'draft'
  | 'approved'
  | 'rejected'
  | 'queued'
  | 'sent'
  | 'failed';

/**
 * 回写凭证 —— 契约必须覆盖。
 * 字段：id, status, trace_id。
 * 回写必须幂等：重复请求不重复记账；失败不显示成功。
 */
export interface MutationReceipt {
  id: Uuid;
  status: MutationStatus;
  trace_id: TraceId;
  /** 当前记录版本号，用于乐观并发控制（expected_version）。 */
  version?: number;
  __mock?: boolean;
}

// ============================================================
// 5. 草稿与审核（notes/drafts, notes/{id}/approve）
// ============================================================

/** 草稿来源类型：对应 /v1/notes/drafts source_type。 */
export type DraftSourceType =
  | 'staff_text'
  | 'voice_transcript'
  | 'image_extract'
  | 'imported';

/** POST /v1/notes/drafts 请求体。 */
export interface CreateDraftRequest {
  /** 已消歧确认、授权返回的主体引用。 */
  subject_ref: SubjectRef;
  /** 草稿内容，maxLength 4000；不直接覆盖客观/安全字段。 */
  content: string;
  source_type: DraftSourceType;
  /** 幂等键。 */
  request_id?: IdempotencyKey;
}

/** 审核决策。 */
export type DraftDecision = 'approve' | 'reject';

/** POST /v1/notes/{id}/approve 请求体。 */
export interface ApproveDraftRequest {
  decision: DraftDecision;
  /** 期望的版本号，乐观并发；冲突返回 409。 */
  expected_version: number;
  note?: string;
}

// ============================================================
// 6. 知识状态机（knowledge_entries）
// ============================================================

/**
 * 知识状态 —— 契约必须覆盖。
 * 流转：draft → pending_review → approved → archived。
 * 注意：数据库草案用 'draft','approved','retired'；OpenAPI 未定义知识状态。
 * 本契约采用四态以支持 pending_review 中间态；与 SQL 映射由 B 在 services/api 完成。
 *  - 只有 approved 进入正式检索。
 *  - 下架（archived）后同步失效索引与缓存。
 */
export type KnowledgeStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'archived';

/** 知识条目适用范围（jsonb，行业字段组驱动）。 */
export interface KnowledgeApplicable {
  scene_id?: string;
  subject_types?: SubjectType[];
  [key: string]: unknown;
}

/** 知识条目约束。 */
export interface KnowledgeConstraint {
  rule_key: string;
  params?: Record<string, unknown>;
}

/** 知识条目 —— 对应数据库 knowledge_entries。 */
export interface KnowledgeEntry {
  id: Uuid;
  tenant_id: Uuid;
  title: string;
  applicable: KnowledgeApplicable;
  /** 操作步骤文本列表。数据库存 jsonb 数组，语义上为字符串步骤。 */
  steps: string[];
  constraints: KnowledgeConstraint[];
  status: KnowledgeStatus;
  version: number;
  approved_by?: Uuid;
  updated_at: IsoTimestamp;
  __mock?: boolean;
}

// ============================================================
// 7. 推荐与提醒（recommendations, reminders）
// ============================================================

/** POST /v1/recommendations 请求体。 */
export interface RecommendRequest {
  subject_ref: SubjectRef;
  intent: string;
  max_results?: number;
  request_id?: IdempotencyKey;
}

/** 提醒状态 —— 对应数据库 reminder_tasks.status。 */
export type ReminderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'expired';

/** 提醒 —— 对应 /v1/reminders 响应。 */
export interface Reminder {
  id: Uuid;
  subject_ref: SubjectRef;
  status: ReminderStatus;
  due_at: IsoTimestamp;
  draft_text?: string;
  last_delivery_error?: string;
  __mock?: boolean;
}

// ============================================================
// 8. 报表与导入（reports/overview, imports/preview）
// ============================================================

/** GET /v1/reports/overview 响应体（从业务流水聚合）。 */
export interface ReportOverview {
  period: string;
  currency: string;
  gross_sales: number;
  order_count: number;
  repeat_buyer_count: number;
  source_updated_at: IsoTimestamp;
  __mock?: boolean;
}

/** POST /v1/imports/preview 请求体（需管理权限）。 */
export interface PreviewImportRequest {
  file_ref: string;
  /** 字段映射：源列名 → 目标字段名。 */
  mapping: Record<string, string>;
}

/** 导入预览结果项。 */
export interface ImportPreviewRow {
  row_index: number;
  status: 'ok' | 'missing_field' | 'suspected_duplicate' | 'error';
  missing_fields?: string[];
  reason?: string;
}

/** POST /v1/imports/preview 200 响应体。 */
export interface PreviewImportResponse {
  importable_count: number;
  rows: ImportPreviewRow[];
  trace_id: TraceId;
  __mock?: boolean;
}

// ============================================================
// 9. 反诈域（独立隔离，只读审核过的公共来源）
// ============================================================

/** 反诈风险等级。 */
export type FraudRiskLevel = 'unknown' | 'low' | 'medium' | 'high';

/** 反诈官方案例引用 —— 对应数据库 public_fraud_cases。 */
export interface FraudCaseReference {
  case_id: string;
  publisher: string;
  published_at: IsoDate;
  title: string;
  url: string;
}

/** POST /v1/antifraud/assess 请求体（独立 Public-Scope-Token）。 */
export interface AssessFraudRequest {
  description: string;
}

/** POST /v1/antifraud/assess 200 响应体。 */
export interface AssessFraudResponse {
  risk_level: FraudRiskLevel;
  matched_signals: string[];
  cases: FraudCaseReference[];
  uncertain_facts: string[];
  suggested_steps: string[];
  trace_id: TraceId;
  __mock?: boolean;
}

// ============================================================
// 10. 错误与统一信封
// ============================================================

/** 错误码：统一 { code, message, trace_id }，失败必须返回明确错误码，不得静默成功。 */
export interface ApiError {
  code: string;
  message: string;
  trace_id: TraceId;
  /** HTTP 状态码便于前端分支。 */
  http_status?: number;
  /** 缺失/冲突字段等明细。 */
  details?: Record<string, unknown>;
}

/** 安全字段数据分级：来自数据库 attributes.data_class。 */
export type DataClass =
  | 'objective'
  | 'preference'
  | 'relationship'
  | 'safety'
  | 'inferred';

/** 登录态：tenant_id 由服务端从 token 解析，不接受前端传入。 */
export interface AuthPrincipal {
  user_id: Uuid;
  tenant_id: Uuid;
  store_id?: Uuid;
  role: 'owner' | 'hq' | 'manager' | 'staff' | 'auditor';
  /** 简化 token（冲刺版写死两个测试账号）。 */
  token: string;
}

/** POST /v1/auth/login 请求体（冲刺版简化）。 */
export interface LoginRequest {
  login_name: string;
  password: string;
}

/** 登录响应。 */
export interface LoginResponse {
  principal: AuthPrincipal;
  /** token 过期时间（ISO）。 */
  expires_at: IsoTimestamp;
  __mock?: boolean;
}

// ============================================================
// 11. 成员关系与撤权（API-02：旧会话撤权失效）
// ============================================================

/** 角色 —— 对应数据库 memberships.role。 */
export type Role = 'owner' | 'hq' | 'manager' | 'staff' | 'auditor';

/** 成员关系 —— 对应数据库 memberships。revoked_at 非空即已撤权。 */
export interface Membership {
  id: Uuid;
  tenant_id: Uuid;
  store_id?: Uuid;
  user_id: Uuid;
  role: Role;
  /** 撤权时间；非空表示该成员关系已失效，其持有的旧 token 立即不可用。 */
  revoked_at?: IsoTimestamp;
  /** 签发该 token 时的成员关系版本号；撤权/复权各 +1，用于让旧会话失效。 */
  membership_version: number;
}

/** POST /v1/memberships/:id/revoke 请求体（店长/管理员）。 */
export interface RevokeMembershipRequest {
  /** 乐观锁：期望的当前 membership_version。 */
  expected_version: number;
  reason?: string;
}

/** POST /v1/memberships/:id/revoke 响应。 */
export interface RevokeMembershipResponse {
  membership: Membership;
  /** 被撤权用户当前已发出的旧 token 数量（已全部失效）。 */
  revoked_session_count: number;
  trace_id: TraceId;
  __mock?: boolean;
}

// ============================================================
// 12. 商品与库存记录（API-02：客户商品记录接口）
// ============================================================

/** 商品记录 —— 对应数据库 products。 */
export interface ProductRecord {
  id: Uuid;
  tenant_id: Uuid;
  sku: string;
  name: string;
  category?: string;
  current_price?: number;
  currency: string;
  shelf_location?: string;
  /** 品类/位置/适用月龄/健康标签等，行业字段组。 */
  attributes: Record<string, unknown>;
  updated_at: IsoTimestamp;
  __mock?: boolean;
}

/** 库存快照 —— 对应数据库 inventory_snapshots。 */
export interface InventorySnapshot {
  id: Uuid;
  tenant_id: Uuid;
  store_id: Uuid;
  product_id: Uuid;
  quantity: number;
  observed_at: IsoTimestamp;
  source_type: string;
  __mock?: boolean;
}

/** POST /v1/products 请求体（创建商品，管理权限）。 */
export interface CreateProductRequest {
  sku: string;
  name: string;
  category?: string;
  current_price?: number;
  shelf_location?: string;
  attributes?: Record<string, unknown>;
  request_id?: IdempotencyKey;
}

// ============================================================
// 13. 导入提交与导出（API-03：CSV 导入导出 + 幂等回写）
// ============================================================

/** 导入批次状态。 */
export type ImportBatchStatus = 'previewed' | 'committed' | 'failed';

/** 导入提交请求体：基于预览结果正式写入。 */
export interface ImportCommitRequest {
  /** 预览时返回的批次引用。 */
  batch_id: Uuid;
  /** 内容指纹：相同 content_hash 的重复提交不重复记账（幂等）。 */
  content_hash: string;
  request_id?: IdempotencyKey;
}

/** 导入提交响应。 */
export interface ImportCommitResponse {
  batch_id: Uuid;
  status: ImportBatchStatus;
  imported_count: number;
  /** 因疑似重复而跳过的行数。 */
  skipped_duplicates: number;
  /** 失败行明细（错误行有原因）。 */
  errors: ImportErrorRow[];
  /** 重复导入同一内容时为 true，不重复记账。 */
  idempotent_replay: boolean;
  trace_id: TraceId;
  __mock?: boolean;
}

/** 导入错误行。 */
export interface ImportErrorRow {
  row_index: number;
  reason: string;
  /** 出错的字段。 */
  field?: string;
  /** 该行原始内容摘要（脱敏）。 */
  raw_excerpt?: string;
}

/** 导出请求（管理员按授权范围导出，留审计）。 */
export interface ExportRequest {
  /** 导出资源类型：customers / transactions / products。 */
  resource: 'customers' | 'transactions' | 'products';
  /** ISO 日期范围。 */
  from?: IsoDate;
  to?: IsoDate;
  request_id?: IdempotencyKey;
}

/** 导出响应（返回 CSV 文本，content-type: text/csv）。 */
export interface ExportReceipt {
  resource: string;
  row_count: number;
  /** 审计记录已写入。 */
  audit_logged: boolean;
  trace_id: TraceId;
  __mock?: boolean;
}

// ============================================================
// 14. 知识审核状态机（API-04：经验审核状态接口）
// ============================================================

/**
 * 知识审核决策。
 *  - submit_review: draft → pending_review（提交审核）
 *  - approve: pending_review → approved（批准，进入检索）
 *  - reject: pending_review → draft（打回重改）
 *  - archive: approved → archived（下架，失效索引与缓存）
 */
export type KnowledgeReviewDecision =
  | 'submit_review'
  | 'approve'
  | 'reject'
  | 'archive';

/** POST /v1/knowledge 提交知识草稿请求体。 */
export interface KnowledgeSubmitRequest {
  title: string;
  applicable: KnowledgeApplicable;
  steps: string[];
  constraints?: KnowledgeConstraint[];
  request_id?: IdempotencyKey;
}

/** POST /v1/knowledge/:id/review 审核请求体（店长/管理员）。 */
export interface KnowledgeReviewRequest {
  decision: KnowledgeReviewDecision;
  expected_version: number;
  note?: string;
}

// ============================================================
// 15. 审计日志（API-04：流转可追溯）
// ============================================================

/** 审计动作类型。 */
export type AuditAction =
  | 'login'
  | 'logout'
  | 'membership_revoke'
  | 'draft_create'
  | 'draft_approve'
  | 'draft_reject'
  | 'import_preview'
  | 'import_commit'
  | 'export'
  | 'knowledge_submit'
  | 'knowledge_review'
  | 'knowledge_archive';

/** 审计日志 —— 对应数据库 audit_logs。每次状态变更必须留痕，流转可追溯。 */
export interface AuditLog {
  id: Uuid;
  tenant_id?: Uuid;
  actor_id?: Uuid;
  action: AuditAction;
  object_type?: string;
  object_ref?: string;
  status: string;
  trace_id: TraceId;
  occurred_at: IsoTimestamp;
  __mock?: boolean;
}

/** 审计日志查询参数。 */
export interface AuditQuery {
  action?: AuditAction;
  object_type?: string;
  object_ref?: string;
  from?: IsoTimestamp;
  to?: IsoTimestamp;
  limit?: number;
}

