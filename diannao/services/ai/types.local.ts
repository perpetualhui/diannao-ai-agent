/**
 * 临时契约类型 —— 主责：张（D）· services/ai
 *
 * ⚠️ 本文件是【临时契约】：邱（B）的 packages/contracts v1 发出后，
 *    本文件删除，所有 import 切换为 '@dian-nao/contracts'。
 *    切换时只改 import 路径，字段名以 contracts 为准；如有出入以邱的版本为准并通知张。
 *
 * 字段与 docs/03-业务接口_OpenAPI.yaml 逐字对齐（AssistantResponse / Evidence / MaskedCandidate）。
 * 运行方式：Node >= 22.6 `--experimental-strip-types`（团队 Node v24 默认可用）。
 */

// ── 客户匹配状态（对应 OpenAPI identity/resolve）──────────────────────
export type MatchStatus = 'matched' | 'ambiguous' | 'not_found';

// ── 应答状态（对应 OpenAPI AssistantResponse.status）──────────────────
export type AnswerStatus =
  | 'ok'                // 正常回答
  | 'no_data'           // 查无记录
  | 'needs_confirmation'// 身份歧义，需先确认
  | 'needs_human'       // 安全/健康/投诉 → 转人工
  | 'forbidden'         // 无权或已撤销
  | 'error';

// ── 证据来源类型（对应 OpenAPI Evidence.source_type 枚举）────────────
export type EvidenceSourceType =
  | 'transaction'
  | 'service_event'
  | 'verified_attribute'
  | 'product'
  | 'inventory_snapshot'
  | 'knowledge_entry'
  | 'rule';

// ── 证据（对应 OpenAPI Evidence schema，required: source_type/record_id/observed_at）
export interface Evidence {
  source_type: EvidenceSourceType;
  record_id: string;
  observed_at: string;
  updated_at?: string;
  excerpt?: string;
}

// ── 脱敏候选（对应 OpenAPI MaskedCandidate，required: subject_ref/masked_label）
export interface MaskedCandidate {
  subject_ref: string;
  masked_label: string;
}

// ── 统一应答（对应 OpenAPI AssistantResponse）─────────────────────────
export interface AssistantResponse {
  status: AnswerStatus;
  answer: string;
  evidence: Evidence[];
  candidates: MaskedCandidate[];
  needs_confirmation: boolean;
  handoff: boolean;
  actions: string[];
  trace_id: string;
}

// ── 请求上下文：由服务端（邱的 services/api）解析 token 后传入 ─────────
// AI 引擎不得从请求体/聊天文本采信任何身份字段；context 一律服务端注入。
export interface RequestContext {
  user_id: string;
  tenant_id: string;
  role: string;
  trace_id: string;
}

// ── mock 数据集结构（数据主责：周 A，版本 v1 2026-11-07）───────────────
export interface MockProduct {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  category: string;
  current_price: number;
  shelf_location: string;
  attributes: Record<string, unknown>;
}

export interface MockSubject {
  id: string;
  tenant_id: string;
  store_id: string;
  subject_type: 'person' | 'child';
  display_name: string;
  profile: Record<string, unknown>;
}

export interface MockIdentityKey {
  tenant_id: string;
  subject_id: string;
  key_type: 'phone_last4' | 'member_no';
  key_hash: string;
  masked_label: string;
}

export interface MockAttribute {
  id: string;
  tenant_id: string;
  subject_id: string;
  attr_key: string;
  value: unknown;
  data_class: 'objective' | 'preference' | 'relationship' | 'safety' | 'inferred';
  source_type: string;
  source_id: string;
  observed_at: string;
  verified_by: string;
  status: string;
}

export interface MockTransactionLine {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface MockTransaction {
  id: string;
  tenant_id: string;
  store_id: string;
  subject_id: string;
  occurred_at: string;
  source_type: string;
  status: string;
  lines: MockTransactionLine[];
}

export interface MockRelation {
  id: string;
  tenant_id: string;
  from_subject: string;
  to_subject: string;
  relation_type: string;
}

export interface MockUser {
  id: string;
  login_name: string;
  display_name: string;
  disabled_at: string | null;
}

export interface MockMembership {
  id: string;
  tenant_id: string;
  store_id: string;
  user_id: string;
  role: string;
  revoked_at: string | null;
}

export interface MockDataset {
  __mock: boolean;
  tenants: { id: string; name: string; industry_code: string }[];
  stores: { id: string; tenant_id: string; name: string }[];
  app_users: MockUser[];
  memberships: MockMembership[];
  test_accounts: {
    login_name: string;
    token: string;
    binds_tenant: string;
    binds_store: string;
    role: string;
    display_name: string;
  }[];
  products: MockProduct[];
  subjects: MockSubject[];
  children: MockSubject[];
  subject_relations: MockRelation[];
  identity_keys: MockIdentityKey[];
  attributes: MockAttribute[];
  transactions: MockTransaction[];
  service_events: {
    id: string;
    tenant_id: string;
    store_id: string;
    subject_id: string;
    service_type: string;
    details: Record<string, unknown>;
    occurred_at: string;
    source_type: string;
  }[];
}

export function loadDataset(raw: unknown): MockDataset {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('数据集格式错误：不是对象');
  }
  const d = raw as MockDataset;
  if (d.__mock !== true) throw new Error('数据集缺少 __mock 标记，拒绝加载非模拟数据');
  return d;
}

/**
 * 全量服务对象查询：周（A）的数据结构里 person 在 subjects、child 在 children，
 * 语义上两者都是 subject，所有按 ID 查对象的入口统一走这里，避免漏查。
 */
export function allSubjects(dataset: MockDataset): MockSubject[] {
  return [...dataset.subjects, ...(dataset.children ?? [])];
}

export function findSubject(
  dataset: MockDataset,
  subjectId: string,
  tenantId: string,
): MockSubject | undefined {
  return allSubjects(dataset).find(
    (s) => s.id === subjectId && s.tenant_id === tenantId,
  );
}
