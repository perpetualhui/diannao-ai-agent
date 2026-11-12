/**
 * 店脑 · 内存数据层
 * 主责：B 邱
 *
 * 覆盖 API-01~04 的数据操作。第 2 阶段切 PostgreSQL 时，函数签名不变，
 * 内部改为 SQL 查询（迁移见 db/migrations/）。
 *
 * 铁律：所有查询带 tenant_id，且 tenant_id 来自鉴权层，绝不来自请求体。
 */

import { randomUUID } from 'node:crypto';
import { saveSnapshot } from './db';
import type {
  AuditAction,
  AuditLog,
  AuditQuery,
  CustomerSummary,
  DraftSourceType,
  Evidence,
  ImportErrorRow,
  ImportPreviewRow,
  KnowledgeApplicable,
  KnowledgeConstraint,
  KnowledgeEntry,
  KnowledgeReviewDecision,
  KnowledgeStatus,
  MaskedCandidate,
  Membership,
  MutationReceipt,
  ProductRecord,
  Reminder,
  ResolveIdentityResponse,
  Role,
  SubjectType,
  TransactionSummary,
  Uuid,
} from '../../../packages/contracts/index';
import { contentHash, parseCsv, serializeCsv } from './csv';

// ============================================================
// 常量：租户与门店
// ============================================================

export const TENANT_A = 'tenant-a-uuid-0000-0000-000000000001';
export const TENANT_B = 'tenant-b-uuid-0000-0000-000000000002';
/** 服装店租户（场景二） */
export const TENANT_C = 'tenant-c-uuid-0000-0000-000000000003';
export const STORE_A1 = 'store-a1-uuid-0000-0000-0000000000a1';
export const STORE_B1 = 'store-b1-uuid-0000-0000-0000000000b1';
export const STORE_C1 = 'store-c1-uuid-0000-0000-0000000000c1';

// ============================================================
// 主体
// ============================================================

export interface SubjectRecord {
  id: Uuid;
  tenant_id: Uuid;
  store_id: Uuid;
  subject_type: SubjectType;
  display_label: string;
  identity_hints: string[];
  profile: Record<string, unknown>;
  /** 画像变更留痕：每次审核通过记下旧值，便于回溯。 */
  profile_history?: ProfileChange[];
  transactions: TransactionSummary[];
}

export interface ProfileChange {
  at: string;
  field: string;
  from: unknown;
  to: unknown;
  draft_id: string;
}

const SUBJECT_ZHANG: SubjectRecord = {
  id: '00000000-0000-4000-8000-000000000101',
  tenant_id: TENANT_A,
  store_id: STORE_A1,
  subject_type: 'person',
  display_label: '张女士（尾号 1234）',
  identity_hints: ['1234', '张女士'],
  profile: {
    'child.birthdate': '2025-09-12',
    'child.formula_stage': '2段',
    'child.diapers_size': 'L',
    'pref.brand': '帮宝适',
  },
  transactions: [
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
};

const SUBJECT_ZHANG_B: SubjectRecord = {
  id: '00000000-0000-4000-8000-000000000901',
  tenant_id: TENANT_B,
  store_id: STORE_B1,
  subject_type: 'person',
  display_label: '张先生（尾号 1234）',
  identity_hints: ['1234', '张先生'],
  profile: {},
  transactions: [],
};

const SUBJECT_LI_A: SubjectRecord = {
  id: '00000000-0000-4000-8000-000000000201',
  tenant_id: TENANT_A,
  store_id: STORE_A1,
  subject_type: 'person',
  display_label: '李*（尾号 5678）',
  identity_hints: ['5678', '李'],
  profile: {},
  transactions: [],
};

const SUBJECT_LI_A2: SubjectRecord = {
  id: '00000000-0000-4000-8000-000000000202',
  tenant_id: TENANT_A,
  store_id: STORE_A1,
  subject_type: 'person',
  display_label: '黎*（尾号 5678）',
  identity_hints: ['5678', '黎'],
  profile: {},
  transactions: [],
};

// ── 场景二：服装店客户画像（租户 C）──────────────────────────────────
const SUBJECT_CHEN_C: SubjectRecord = {
  id: '00000000-0000-4000-8000-000000000c01',
  tenant_id: TENANT_C,
  store_id: STORE_C1,
  subject_type: 'person',
  display_label: '陈女士（会员 C2001 · 尾号 2468）',
  identity_hints: ['2468', '陈女士', 'C2001'],
  profile: {
    'size.top': 'M',
    'size.bottom': 'L',
    'pref.color': ['莫兰迪色', '米白', '雾霾蓝'],
    'pref.fit': ['宽松版型'],
    'style': '通勤休闲',
    'last_visit': '2026-10-15',
  },
  transactions: [
    {
      id: '00000000-0000-4000-8000-000000000c11',
      occurred_at: '2026-10-15T06:20:00.000Z',
      lines: [
        {
          product_id: '00000000-0000-4000-8000-000000000c51',
          product_name: '米白针织开衫 M码',
          sku: 'KNIT-M-001',
          quantity: 1,
          unit_price: 399.0,
        },
      ],
      total_amount: 399.0,
      currency: 'CNY',
    },
    {
      id: '00000000-0000-4000-8000-000000000c12',
      occurred_at: '2026-09-20T09:10:00.000Z',
      lines: [
        {
          product_id: '00000000-0000-4000-8000-000000000c52',
          product_name: '直筒牛仔裤 L码',
          sku: 'JEAN-L-002',
          quantity: 1,
          unit_price: 459.0,
        },
      ],
      total_amount: 459.0,
      currency: 'CNY',
    },
  ],
};

const SUBJECT_WANG_C: SubjectRecord = {
  id: '00000000-0000-4000-8000-000000000c02',
  tenant_id: TENANT_C,
  store_id: STORE_C1,
  subject_type: 'person',
  display_label: '王女士（会员 C2002 · 尾号 1357）',
  identity_hints: ['1357', '王女士', 'C2002'],
  profile: {
    'size.top': 'S',
    'size.bottom': 'M',
    'pref.color': ['黑色', '深灰'],
    'pref.fit': ['修身'],
    'style': '商务通勤',
  },
  transactions: [
    {
      id: '00000000-0000-4000-8000-000000000c21',
      occurred_at: '2026-10-08T07:40:00.000Z',
      lines: [
        {
          product_id: '00000000-0000-4000-8000-000000000c53',
          product_name: '黑色西装外套 S码',
          sku: 'BLAZER-S-003',
          quantity: 1,
          unit_price: 699.0,
        },
      ],
      total_amount: 699.0,
      currency: 'CNY',
    },
  ],
};

const SUBJECTS: SubjectRecord[] = [
  SUBJECT_ZHANG, SUBJECT_ZHANG_B, SUBJECT_LI_A, SUBJECT_LI_A2,
  SUBJECT_CHEN_C, SUBJECT_WANG_C,
];

// ============================================================
// 成员关系（撤权失效）
// ============================================================

const MEMBERSHIPS: Membership[] = [
  {
    id: '00000000-0000-4000-8000-000000000701',
    tenant_id: TENANT_A,
    store_id: STORE_A1,
    user_id: '00000000-0000-4000-8000-000000000001',
    role: 'manager',
    membership_version: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000702',
    tenant_id: TENANT_B,
    store_id: STORE_B1,
    user_id: '00000000-0000-4000-8000-000000000002',
    role: 'staff',
    membership_version: 1,
  },
  // A 店店员：用于验证「撤权后旧会话立即失效」，由 manager-a 撤销。
  {
    id: '00000000-0000-4000-8000-000000000703',
    tenant_id: TENANT_A,
    store_id: STORE_A1,
    user_id: '00000000-0000-4000-8000-000000000003',
    role: 'staff',
    membership_version: 1,
  },
  // ── 场景二：服装店（租户 C）──
  {
    id: '00000000-0000-4000-8000-000000000703c',
    tenant_id: TENANT_C,
    store_id: STORE_C1,
    user_id: '00000000-0000-4000-8000-000000000004',
    role: 'owner',
    membership_version: 1,
  },
];

/** 按 user_id 查当前成员关系。 */
export function getMembershipByUser(userId: Uuid): Membership | undefined {
  return MEMBERSHIPS.find((m) => m.user_id === userId);
}

/** 后台新增员工时创建成员关系。 */
export function addMembership(
  tenantId: Uuid,
  storeId: Uuid,
  userId: Uuid,
  role: Role,
): Membership {
  const m: Membership = {
    id: randomUUID(),
    tenant_id: tenantId,
    store_id: storeId,
    user_id: userId,
    role,
    membership_version: 1,
  };
  MEMBERSHIPS.push(m);
  schedulePersist();
  return m;
}

/** 按用户撤销成员关系（删除员工时调用）。 */
export function revokeMembershipForUser(userId: Uuid): boolean {
  const m = MEMBERSHIPS.find((x) => x.user_id === userId);
  if (m === undefined || m.revoked_at !== undefined) return false;
  m.revoked_at = new Date().toISOString();
  m.membership_version += 1;
  schedulePersist();
  return true;
}

export function getMembership(tenantId: Uuid, membershipId: Uuid): Membership | undefined {
  return MEMBERSHIPS.find((m) => m.id === membershipId && m.tenant_id === tenantId);
}

/**
 * 撤权：设 revoked_at，membership_version++。
 * 该 user 持有的所有旧 session 因 issued_version 与当前 version 不符而立即失效。
 */
export function revokeMembership(
  tenantId: Uuid,
  membershipId: Uuid,
  expectedVersion: number,
): { ok: true; membership: Membership } | { ok: false; reason: 'not_found' | 'forbidden' | 'conflict' } {
  const m = MEMBERSHIPS.find((x) => x.id === membershipId && x.tenant_id === tenantId);
  if (m === undefined) return { ok: false, reason: 'not_found' };
  if (m.revoked_at !== undefined) return { ok: false, reason: 'conflict' };
  if (m.membership_version !== expectedVersion) return { ok: false, reason: 'conflict' };
  m.revoked_at = new Date().toISOString();
  m.membership_version += 1;
  schedulePersist();
  return { ok: true, membership: m };
}

/** 判定某 user 的成员关系当前是否有效（未撤权）。 */
export function isMembershipActive(userId: Uuid): boolean {
  const m = getMembershipByUser(userId);
  return m !== undefined && m.revoked_at === undefined;
}

/** 取成员关系的当前版本号（供 session 校验）。 */
export function membershipVersionOf(userId: Uuid): number | undefined {
  return getMembershipByUser(userId)?.membership_version;
}

export function roleOf(userId: Uuid): Role | undefined {
  return getMembershipByUser(userId)?.role;
}

// ============================================================
// 商品
// ============================================================

const PRODUCTS: ProductRecord[] = [
  {
    id: '00000000-0000-4000-8000-000000000501',
    tenant_id: TENANT_A,
    sku: 'DIA-L-001',
    name: 'L 码纸尿裤',
    category: '纸尿裤',
    current_price: 89.0,
    currency: 'CNY',
    shelf_location: 'A-3',
    attributes: { applicable_age_months: '12-24', health_tag: '日用品' },
    updated_at: '2026-11-01T00:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000502',
    tenant_id: TENANT_A,
    sku: 'DIA-2-001',
    name: '2 段奶粉',
    category: '奶粉',
    current_price: 268.0,
    currency: 'CNY',
    shelf_location: 'B-1',
    attributes: { applicable_age_months: '6-12', health_tag: '食品' },
    updated_at: '2026-11-01T00:00:00.000Z',
  },
  // ── 服装店（租户 C）──
  {
    id: '00000000-0000-4000-8000-000000000c51',
    tenant_id: TENANT_C,
    sku: 'KNIT-M-001',
    name: '米白针织开衫 M码',
    category: '上装',
    current_price: 399.0,
    currency: 'CNY',
    shelf_location: 'C-1',
    attributes: { size: 'M', fit: '宽松', color: '米白', season: '春秋' },
    updated_at: '2026-11-01T00:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000c52',
    tenant_id: TENANT_C,
    sku: 'JEAN-L-002',
    name: '直筒牛仔裤 L码',
    category: '下装',
    current_price: 459.0,
    currency: 'CNY',
    shelf_location: 'C-2',
    attributes: { size: 'L', fit: '直筒', color: '深蓝', season: '四季' },
    updated_at: '2026-11-01T00:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000c53',
    tenant_id: TENANT_C,
    sku: 'BLAZER-S-003',
    name: '黑色西装外套 S码',
    category: '上装',
    current_price: 699.0,
    currency: 'CNY',
    shelf_location: 'C-3',
    attributes: { size: 'S', fit: '修身', color: '黑色', season: '四季' },
    updated_at: '2026-11-01T00:00:00.000Z',
  },
];

const PRODUCT_IDEMPOTENT: Map<string, ProductRecord> = new Map();

export function createProduct(
  tenantId: Uuid,
  sku: string,
  name: string,
  category: string | undefined,
  currentPrice: number | undefined,
  shelfLocation: string | undefined,
  attributes: Record<string, unknown> | undefined,
  requestId: string | undefined,
): ProductRecord | { error: 'duplicate_sku' } {
  if (PRODUCTS.some((p) => p.tenant_id === tenantId && p.sku === sku)) {
    return { error: 'duplicate_sku' };
  }
  if (requestId !== undefined) {
    const existing = PRODUCT_IDEMPOTENT.get(requestId);
    if (existing !== undefined) return existing;
  }
  const p: ProductRecord = {
    id: randomUUID(),
    tenant_id: tenantId,
    sku,
    name,
    category,
    current_price: currentPrice,
    currency: 'CNY',
    shelf_location: shelfLocation,
    attributes: attributes ?? {},
    updated_at: new Date().toISOString(),
  };
  PRODUCTS.push(p);
  schedulePersist();
  if (requestId !== undefined) PRODUCT_IDEMPOTENT.set(requestId, p);
  return p;
}

export function listProducts(tenantId: Uuid): ProductRecord[] {
  return PRODUCTS.filter((p) => p.tenant_id === tenantId);
}

// ============================================================
// 知识（状态机：draft → pending_review → approved → archived）
// ============================================================

const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: '00000000-0000-4000-8000-000000000402',
    tenant_id: TENANT_A,
    title: '纸尿裤补货提醒经验',
    applicable: { scene_id: 'baby', subject_types: ['child'] },
    steps: ['距上次购买 ≥ 15 天触发补货提醒'],
    constraints: [
      { rule_key: 'allergy_manual_check' },
      { rule_key: 'stock_freshness_check' },
    ],
    status: 'approved',
    version: 2,
    approved_by: '00000000-0000-4000-8000-000000000001',
    updated_at: '2026-11-07T09:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000401',
    tenant_id: TENANT_A,
    title: '14 个月龄纸尿裤码数建议',
    applicable: { scene_id: 'baby', subject_types: ['child'] },
    steps: ['确认月龄', '对照码数表'],
    constraints: [{ rule_key: 'hard_age_range_filter' }],
    status: 'draft',
    version: 1,
    updated_at: '2026-11-07T08:00:00.000Z',
  },
];

const KNOWLEDGE_IDEMPOTENT: Map<string, KnowledgeEntry> = new Map();

export function submitKnowledge(
  tenantId: Uuid,
  title: string,
  applicable: KnowledgeApplicable,
  steps: string[],
  constraints: KnowledgeConstraint[] | undefined,
  requestId: string | undefined,
): KnowledgeEntry {
  if (requestId !== undefined) {
    const existing = KNOWLEDGE_IDEMPOTENT.get(requestId);
    if (existing !== undefined) return existing;
  }
  const entry: KnowledgeEntry = {
    id: randomUUID(),
    tenant_id: tenantId,
    title,
    applicable,
    steps,
    constraints: constraints ?? [],
    status: 'draft',
    version: 1,
    updated_at: new Date().toISOString(),
  };
  KNOWLEDGE.push(entry);
  schedulePersist();
  if (requestId !== undefined) KNOWLEDGE_IDEMPOTENT.set(requestId, entry);
  return entry;
}

/**
 * 知识审核流转。
 *  - submit_review: draft → pending_review
 *  - approve: pending_review → approved（进入检索）
 *  - reject: pending_review → draft
 *  - archive: approved → archived（失效）
 */
export function reviewKnowledge(
  tenantId: Uuid,
  entryId: Uuid,
  decision: KnowledgeReviewDecision,
  expectedVersion: number,
  approverId: Uuid,
): { ok: true; entry: KnowledgeEntry } | { ok: false; reason: 'not_found' | 'forbidden' | 'conflict' | 'invalid_transition' } {
  const e = KNOWLEDGE.find((x) => x.id === entryId && x.tenant_id === tenantId);
  if (e === undefined) return { ok: false, reason: 'not_found' };
  if (e.version !== expectedVersion) return { ok: false, reason: 'conflict' };

  const next = nextStatus(e.status, decision);
  if (next === null) return { ok: false, reason: 'invalid_transition' };

  e.status = next;
  e.version += 1;
  schedulePersist();
  e.updated_at = new Date().toISOString();
  if (decision === 'approve') {
    e.approved_by = approverId;
  }
  return { ok: true, entry: e };
}

function nextStatus(current: KnowledgeStatus, decision: KnowledgeReviewDecision): KnowledgeStatus | null {
  switch (decision) {
    case 'submit_review':
      return current === 'draft' ? 'pending_review' : null;
    case 'approve':
      return current === 'pending_review' ? 'approved' : null;
    case 'reject':
      return current === 'pending_review' ? 'draft' : null;
    case 'archive':
      return current === 'approved' ? 'archived' : null;
  }
}

export function listKnowledge(tenantId: Uuid, status?: KnowledgeStatus): KnowledgeEntry[] {
  return KNOWLEDGE.filter(
    (e) => e.tenant_id === tenantId && (status === undefined || e.status === status),
  );
}

/** 只有 approved 进入正式检索。 */
export function approvedKnowledgeForAsk(tenantId: Uuid, sceneId?: string): KnowledgeEntry[] {
  return KNOWLEDGE.filter(
    (e) => e.tenant_id === tenantId && e.status === 'approved' &&
      (sceneId === undefined || e.applicable.scene_id === sceneId),
  );
}

// ============================================================
// 检索
// ============================================================

/** 新建客户（微信写入/后台补录）。数据只属于当前租户。 */
export function createSubject(
  tenantId: Uuid,
  storeId: Uuid,
  displayName: string,
  hints: string[] = [],
): SubjectRecord {
  const s: SubjectRecord = {
    id: randomUUID(),
    tenant_id: tenantId,
    store_id: storeId,
    subject_type: 'person',
    display_label: displayName,
    identity_hints: hints,
    profile: {},
    transactions: [],
  };
  SUBJECTS.push(s);
  schedulePersist();
  return s;
}

export function resolveIdentity(
  tenantId: Uuid,
  query: string,
  subjectType: SubjectType | undefined,
): ResolveIdentityResponse {
  const q = query.trim();
  if (q.length === 0) {
    return { candidates: [], needs_confirmation: false, match_status: 'not_found', trace_id: 'trace-empty' };
  }
  const hits = SUBJECTS.filter(
    (s) =>
      s.tenant_id === tenantId &&
      (subjectType === undefined || s.subject_type === subjectType) &&
      s.identity_hints.some((h) => q.includes(h) || h.includes(q)),
  );

  const candidates: MaskedCandidate[] = hits.map((s) => ({
    subject_ref: s.id,
    masked_label: s.display_label,
  }));

  if (hits.length === 1) {
    return {
      candidates,
      needs_confirmation: false,
      match_status: 'matched',
      resolved_subject_ref: hits[0]!.id,
      trace_id: 'trace-resolve-1',
    };
  }
  if (hits.length > 1) {
    return { candidates, needs_confirmation: true, match_status: 'ambiguous', trace_id: 'trace-resolve-n' };
  }
  return { candidates: [], needs_confirmation: false, match_status: 'not_found', trace_id: 'trace-resolve-0' };
}

export function getSummary(tenantId: Uuid, subjectRef: string): CustomerSummary | undefined {
  const s = SUBJECTS.find((x) => x.id === subjectRef && x.tenant_id === tenantId);
  if (s === undefined) return undefined;

  const evidence: Evidence[] = [];
  for (const t of s.transactions) {
    evidence.push({
      source_type: 'transaction',
      record_id: t.id,
      observed_at: t.occurred_at,
      updated_at: t.occurred_at,
      excerpt: t.lines.map((l) => `${l.product_name} ×${l.quantity}`).join('，'),
    });
  }

  const suggestions: string[] = [];
  const last = s.transactions[0];

  if (tenantId === TENANT_C) {
    // 服装店：给尺码与搭配建议，不说补货
    const top = String(s.profile['size.top'] ?? '未知');
    const bottom = String(s.profile['size.bottom'] ?? '未知');
    const colors = Array.isArray(s.profile['pref.color'])
      ? (s.profile['pref.color'] as string[]).join('、')
      : '未记录';
    const fit = Array.isArray(s.profile['pref.fit'])
      ? (s.profile['pref.fit'] as string[]).join('、')
      : '未记录';
    suggestions.push(`常穿尺码：上装 ${top} / 下装 ${bottom}；偏好色 ${colors}；版型 ${fit}。`);
    if (last !== undefined) {
      suggestions.push('可按上次风格搭配同色系新品，推荐前先确认本次场合。');
    } else {
      suggestions.push('暂无购买记录，可先了解场合与尺码再推荐。');
    }
  } else if (last !== undefined) {
    suggestions.push('可提醒补货：距上次购买已有一段时间');
  } else {
    suggestions.push('暂无购买记录，可现场询问并补录');
  }

  return {
    subject_ref: s.id,
    display_label: s.display_label,
    subject_type: s.subject_type,
    profile: s.profile,
    recent_transactions: s.transactions,
    last_purchase_at: last?.occurred_at,
    suggestions,
    evidence,
    handoff_required: false,
    trace_id: 'trace-summary',
  };
}

export function getSubject(tenantId: Uuid, subjectRef: string): SubjectRecord | undefined {
  return SUBJECTS.find((x) => x.id === subjectRef && x.tenant_id === tenantId);
}

// ============================================================
// 问答（规则简版，approved_experience 只取 approved 知识）
// ============================================================

const HEALTH_PATTERN = /(健康|过敏|医疗|生病|发烧|用药|剂量)/;

export function ask(tenantId: Uuid, question: string): import('../../../packages/contracts/index').AssistantResponse {
  const trace = 'trace-ask';
  const isClothing = tenantId === TENANT_C;
  const approvedExp = approvedKnowledgeForAsk(tenantId, isClothing ? 'clothing' : 'baby').flatMap((e) => e.steps);

  if (!isClothing && HEALTH_PATTERN.test(question)) {
    return {
      status: 'needs_human',
      answer: '该问题涉及健康/医疗判断，已转人工，AI 不作医疗建议。',
      approved_experience: [],
      suggestions: ['请店长或具备资质人员跟进'],
      citations: [],
      uncertainties: ['健康类问题需人工核实'],
      needs_confirmation: false,
      handoff: true,
      handoff_required: true,
      actions: ['转店长'],
      trace_id: trace,
    };
  }

  const resolved = resolveIdentity(tenantId, question, undefined);
  if (resolved.match_status === 'ambiguous') {
    return {
      status: 'needs_confirmation',
      answer: '命中多个客户，请先确认是哪一位。',
      approved_experience: [],
      suggestions: [],
      citations: [],
      uncertainties: ['身份未确认'],
      candidates: resolved.candidates,
      needs_confirmation: true,
      handoff: false,
      trace_id: trace,
    };
  }

  if (resolved.match_status === 'not_found' || resolved.resolved_subject_ref === undefined) {
    return {
      status: 'no_data',
      answer: '暂无记录：没有找到对应客户或历史数据。',
      approved_experience: [],
      suggestions: ['可现场询问并补录'],
      citations: [],
      uncertainties: ['未找到客户'],
      needs_confirmation: false,
      handoff: false,
      trace_id: trace,
    };
  }

  const summary = getSummary(tenantId, resolved.resolved_subject_ref);
  if (summary === undefined || summary.recent_transactions.length === 0) {
    return {
      status: 'no_data',
      answer: '暂无记录：该客户近期没有购买记录可参考。',
      approved_experience: approvedExp,
      suggestions: ['可现场询问并补录'],
      citations: [],
      uncertainties: ['该客户购买历史为空'],
      needs_confirmation: false,
      handoff: false,
      trace_id: trace,
    };
  }

  const last = summary.recent_transactions[0]!;
  return {
    status: 'ok',
    subject: summary.subject_ref,
    answer: `${summary.display_label} 上次购买了 ${last.lines.map((l) => `${l.product_name} ×${l.quantity}`).join('，')}。`,
    approved_experience: approvedExp,
    suggestions: summary.suggestions,
    citations: summary.evidence,
    uncertainties: [],
    needs_confirmation: false,
    handoff: false,
    trace_id: trace,
  };
}

// ============================================================
// 草稿与审核（幂等）
// ============================================================

export interface DraftRecord {
  id: Uuid;
  tenant_id: Uuid;
  subject_ref: Uuid;
  content: string;
  source_type: DraftSourceType;
  status: 'draft' | 'approved' | 'rejected';
  version: number;
  trace_id: string;
  created_at: string;
  /** 待审核的画像字段变更；审核通过后才合并进客户档案。 */
  profile_patch?: Record<string, string>;
}

/** 画像字段白名单：不允许客户端自定义键，避免脏字段污染档案。 */
export const PROFILE_FIELDS = new Set([
  'child.birthdate',
  'child.formula_stage',
  'child.diapers_size',
  'pref.brand',
  'pref.note',
  'apparel.size',
  'apparel.style',
  'apparel.color',
]);

/** 校验画像补丁：键必须在白名单内，值为 1~200 字符字符串。 */
export function sanitizeProfilePatch(input: unknown): Record<string, string> | { error: 'invalid_profile_patch' } {
  if (input === undefined) return {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { error: 'invalid_profile_patch' };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!PROFILE_FIELDS.has(k)) return { error: 'invalid_profile_patch' };
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > 200) return { error: 'invalid_profile_patch' };
    out[k] = v.trim();
  }
  return out;
}

const DRAFTS: Map<string, DraftRecord> = new Map();
const REQUEST_INDEX: Map<string, string> = new Map();

export function createDraft(
  tenantId: Uuid,
  subjectRef: Uuid,
  content: string,
  sourceType: DraftSourceType,
  requestId: string | undefined,
  profilePatch?: Record<string, string>,
): MutationReceipt | { error: 'forbidden' } {
  if (getSubject(tenantId, subjectRef) === undefined) {
    return { error: 'forbidden' };
  }
  if (requestId !== undefined) {
    const existingId = REQUEST_INDEX.get(requestId);
    if (existingId !== undefined) {
      const d = DRAFTS.get(existingId);
      if (d !== undefined) {
        return { id: d.id, status: d.status, trace_id: d.trace_id, version: d.version };
      }
    }
  }
  const id = randomUUID();
  const record: DraftRecord = {
    id,
    tenant_id: tenantId,
    subject_ref: subjectRef,
    content,
    source_type: sourceType,
    status: 'draft',
    version: 1,
    trace_id: 'trace-draft-' + id.slice(0, 8),
    created_at: new Date().toISOString(),
    ...(profilePatch !== undefined && Object.keys(profilePatch).length > 0 ? { profile_patch: { ...profilePatch } } : {}),
  };
  DRAFTS.set(id, record);
  schedulePersist();
  if (requestId !== undefined) REQUEST_INDEX.set(requestId, id);
  return { id: record.id, status: record.status, trace_id: record.trace_id, version: record.version };
}

/** 列出本租户草稿（按创建时间倒序），可按状态过滤。 */
export function listDrafts(tenantId: Uuid, status?: DraftRecord['status']): DraftRecord[] {
  return [...DRAFTS.values()]
    .filter((d) => d.tenant_id === tenantId && (status === undefined || d.status === status))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function approveDraft(
  tenantId: Uuid,
  draftId: string,
  decision: 'approve' | 'reject',
  expectedVersion: number,
): { ok: true; receipt: MutationReceipt } | { ok: false; reason: 'not_found' | 'forbidden' | 'conflict' } {
  const d = DRAFTS.get(draftId);
  if (d === undefined) return { ok: false, reason: 'not_found' };
  if (d.tenant_id !== tenantId) return { ok: false, reason: 'forbidden' };
  if (d.version !== expectedVersion) return { ok: false, reason: 'conflict' };
  // 审核通过时把画像补丁合并进客户档案（拒绝则不动档案）
  if (decision === 'approve' && d.profile_patch !== undefined) {
    const subject = getSubject(tenantId, d.subject_ref);
    if (subject === undefined) return { ok: false, reason: 'not_found' };
    const at = new Date().toISOString();
    const history = subject.profile_history ?? [];
    for (const [field, value] of Object.entries(d.profile_patch)) {
      const from = subject.profile[field];
      if (from === value) continue;
      history.push({ at, field, from, to: value, draft_id: d.id });
      subject.profile[field] = value;
    }
    subject.profile_history = history;
  }
  d.version += 1;
  d.status = decision === 'approve' ? 'approved' : 'rejected';
  schedulePersist();
  return { ok: true, receipt: { id: d.id, status: d.status, trace_id: d.trace_id, version: d.version } };
}

// ============================================================
// CSV 导入（预览 + 提交，幂等回写）
// ============================================================

export interface ImportPreviewResult {
  batch_id: Uuid;
  content_hash: string;
  importable_count: number;
  rows: ImportPreviewRow[];
  trace_id: string;
}

/** 导入字段映射的目标字段白名单。 */
const IMPORTABLE_FIELDS = new Set(['name', 'phone_tail', 'sku', 'product_name', 'quantity', 'unit_price']);

/**
 * 预览导入：解析 CSV，按映射校验每行，返回错误行（有原因）+ 可导入数 + 内容指纹。
 * 不写入任何数据。
 */
export function previewImport(
  tenantId: Uuid,
  csvText: string,
  mapping: Record<string, string>,
): ImportPreviewResult {
  const rows = parseCsv(csvText);
  const batchId = randomUUID();
  const hash = contentHash(csvText);
  const previewRows: ImportPreviewRow[] = [];

  if (rows.length === 0) {
    return { batch_id: batchId, content_hash: hash, importable_count: 0, rows: [], trace_id: 'trace-import-preview' };
  }

  const header = rows[0]!;
  const existingSubjects = new Set(SUBJECTS.filter((s) => s.tenant_id === tenantId).flatMap((s) => s.identity_hints));
  let importable = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const obj: Record<string, string> = {};
    header.forEach((col, idx) => {
      const target = mapping[col] ?? col;
      obj[target] = row[idx] ?? '';
    });

    const missing: string[] = [];
    if (!obj['name'] && !obj['phone_tail']) missing.push('name/phone_tail');
    const errors: string[] = [];
    if (missing.length > 0) errors.push(`缺少必填字段 ${missing.join(',')}`);

    // 疑似重复：phone_tail 已存在
    let suspectedDup = false;
    if (obj['phone_tail'] && existingSubjects.has(obj['phone_tail'])) {
      suspectedDup = true;
    }

    if (errors.length > 0) {
      previewRows.push({ row_index: i, status: 'missing_field', missing_fields: missing, reason: errors.join('; ') });
    } else if (suspectedDup) {
      previewRows.push({ row_index: i, status: 'suspected_duplicate', reason: `phone_tail ${obj['phone_tail']} 已存在` });
    } else {
      previewRows.push({ row_index: i, status: 'ok' });
      importable += 1;
    }
  }

  // 校验映射字段合法性
  for (const target of Object.values(mapping)) {
    if (!IMPORTABLE_FIELDS.has(target)) {
      // 未知映射字段不阻断，但记录为提示（不影响导入）
    }
  }

  return { batch_id: batchId, content_hash: hash, importable_count: importable, rows: previewRows, trace_id: 'trace-import-preview' };
}

const IMPORT_COMMITTED: Map<string, { result: ImportCommitInternal; committed_at: string }> = new Map();

export interface ImportCommitInternal {
  batch_id: Uuid;
  status: 'committed';
  imported_count: number;
  skipped_duplicates: number;
  errors: ImportErrorRow[];
}

/**
 * 提交导入：相同 content_hash 重复提交不重复记账（幂等）。
 * 返回 idempotent_replay=true 表示重复提交。
 */
export function commitImport(
  tenantId: Uuid,
  batchId: Uuid,
  contentHashValue: string,
  csvText: string,
  mapping: Record<string, string>,
  requestId: string | undefined,
): { result: ImportCommitInternal; idempotent_replay: boolean } {
  const key = contentHashValue;
  const existing = IMPORT_COMMITTED.get(key);
  if (existing !== undefined) {
    return { result: existing.result, idempotent_replay: true };
  }

  const preview = previewImport(tenantId, csvText, mapping);
  const errors: ImportErrorRow[] = preview.rows
    .filter((r) => r.status !== 'ok')
    .map((r) => ({
      row_index: r.row_index,
      reason: r.reason ?? r.status,
      field: r.missing_fields?.join(','),
    }));

  const internal: ImportCommitInternal = {
    batch_id: batchId,
    status: 'committed',
    imported_count: preview.importable_count,
    skipped_duplicates: preview.rows.filter((r) => r.status === 'suspected_duplicate').length,
    errors,
  };
  IMPORT_COMMITTED.set(key, { result: internal, committed_at: new Date().toISOString() });
  return { result: internal, idempotent_replay: false };
}

// ============================================================
// 导出（管理员，留审计）
// ============================================================

export function exportResource(tenantId: Uuid, resource: 'customers' | 'transactions' | 'products'): { csv: string; row_count: number } {
  let rows: string[][] = [];
  if (resource === 'customers') {
    rows = [['subject_id', 'display_label', 'subject_type', 'identity_hints']];
    for (const s of SUBJECTS.filter((s) => s.tenant_id === tenantId)) {
      rows.push([s.id, s.display_label, s.subject_type, s.identity_hints.join('|')]);
    }
  } else if (resource === 'transactions') {
    rows = [['transaction_id', 'subject_id', 'occurred_at', 'total_amount', 'currency']];
    for (const s of SUBJECTS.filter((s) => s.tenant_id === tenantId)) {
      for (const t of s.transactions) {
        rows.push([t.id, s.id, t.occurred_at, String(t.total_amount), t.currency]);
      }
    }
  } else {
    rows = [['product_id', 'sku', 'name', 'category', 'current_price']];
    for (const p of PRODUCTS.filter((p) => p.tenant_id === tenantId)) {
      rows.push([p.id, p.sku, p.name, p.category ?? '', p.current_price !== undefined ? String(p.current_price) : '']);
    }
  }
  return { csv: serializeCsv(rows), row_count: rows.length - 1 };
}

// ============================================================
// 审计日志（流转可追溯）
// ============================================================

const AUDIT_LOGS: AuditLog[] = [];

export function writeAudit(entry: Omit<AuditLog, 'id' | 'occurred_at'>): AuditLog {
  const log: AuditLog = {
    ...entry,
    id: randomUUID(),
    occurred_at: new Date().toISOString(),
  };
  AUDIT_LOGS.push(log);
  return log;
}

export function queryAudit(tenantId: Uuid, q: AuditQuery): AuditLog[] {
  return AUDIT_LOGS.filter(
    (l) =>
      l.tenant_id === tenantId &&
      (q.action === undefined || l.action === q.action) &&
      (q.object_type === undefined || l.object_type === q.object_type) &&
      (q.object_ref === undefined || l.object_ref === q.object_ref) &&
      (q.from === undefined || l.occurred_at >= q.from) &&
      (q.to === undefined || l.occurred_at <= q.to),
  ).slice(0, q.limit ?? 100);
}

// ============================================================
// 提醒（种子数据）
// ============================================================

export const SEED_REMINDERS: Reminder[] = [
  {
    id: '00000000-0000-4000-8000-000000000601',
    subject_ref: SUBJECT_ZHANG.id,
    status: 'approved',
    due_at: '2026-11-09T02:00:00.000Z',
    draft_text: '张女士，您上次买的纸尿裤可能需要补货，本月有促销。',
  },
];

// ============================================================
// 快照持久化（SQLite）
// ============================================================

export interface StoreSnapshot {
  version: 1;
  saved_at: string;
  subjects: SubjectRecord[];
  memberships: Membership[];
  products: ProductRecord[];
  knowledge: KnowledgeEntry[];
  drafts: DraftRecord[];
  audit_logs: AuditLog[];
}

export function getSnapshot(): StoreSnapshot {
  return {
    version: 1,
    saved_at: new Date().toISOString(),
    subjects: SUBJECTS,
    memberships: MEMBERSHIPS,
    products: PRODUCTS,
    knowledge: KNOWLEDGE,
    drafts: [...DRAFTS.values()],
    audit_logs: AUDIT_LOGS.slice(-500),
  };
}

export function restoreSnapshot(s: StoreSnapshot): void {
  if (s === undefined || s.version !== 1) return;
  SUBJECTS.length = 0; SUBJECTS.push(...(s.subjects ?? []));
  MEMBERSHIPS.length = 0; MEMBERSHIPS.push(...(s.memberships ?? []));
  PRODUCTS.length = 0; PRODUCTS.push(...(s.products ?? []));
  KNOWLEDGE.length = 0; KNOWLEDGE.push(...(s.knowledge ?? []));
  DRAFTS.clear(); for (const d of s.drafts ?? []) DRAFTS.set(d.id, d);
  AUDIT_LOGS.length = 0; AUDIT_LOGS.push(...(s.audit_logs ?? []));
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;

/** 写操作后调用；300ms 防抖合并多次写入。 */
export function schedulePersist(): void {
  if (persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    try {
      saveSnapshot(getSnapshot());
    } catch (e) {
      console.error('[db] 持久化失败', e);
    }
  }, 300);
}
