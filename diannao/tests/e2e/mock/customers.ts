/**
 * Mock 客户与订单数据（冲刺版）。
 * 明确标注 __mock: true，避免被误当真实数据演示。
 * B 发 contracts-v1 后：类型改 import 自 '@dian-nao/contracts'，删除这里的内联类型定义。
 */

// ---- E2E 最小兼容类型（真实模式会在运行时校验响应结构）----

export type MatchStatus = "matched" | "ambiguous" | "not_found";

export interface MockEvidence {
  source_type:
  | "transaction"
  | "service_event"
  | "verified_attribute"
  | "product"
  | "inventory_snapshot"
  | "knowledge_entry"
  | "rule";
  record_id: string;
  observed_at: string;
  updated_at?: string;
  excerpt?: string;
}

export interface MockMaskedCandidate {
  subject_ref: string;
  masked_label: string;
}

export interface MockAssistantResponse {
  status: "ok" | "no_data" | "needs_confirmation" | "needs_human" | "forbidden" | "error";
  answer: string;
  evidence: MockEvidence[];
  candidates: MockMaskedCandidate[];
  needs_confirmation: boolean;
  handoff: boolean;
  trace_id: string;
}

export interface MockIdentityResolveResponse {
  status: MatchStatus;
  candidates: MockMaskedCandidate[];
  needs_confirmation: boolean;
  trace_id: string;
}

// ---- Mock 数据（合成，不代表真实客户）----

export interface MockCustomer {
  __mock: true;
  subject_ref: string;
  tenant_id: string;
  masked_label: string;
  search_name: string;
  last_tail_digits: string; // 仅作检索线索，不是主键
  summary: {
    who: string;
    history: string;
    suggest: string;
  };
  last_order_evidence: MockEvidence;
}

/** 单店母婴 Demo 的两个测试客户（尾号故意有撞号设计，用于双匹配用例）。 */
export const MOCK_CUSTOMERS: readonly MockCustomer[] = [
  {
    __mock: true,
    subject_ref: "masked-01",
    tenant_id: "tenant-demo-a",
    masked_label: "张女士 · 尾号 **12",
    search_name: "张女士",
    last_tail_digits: "1234",
    summary: {
      who: "张女士，母婴店熟客",
      history: "上次购买 XXX 纸尿裤 M 码 1 包（订单 od-001，2026-10-20）",
      suggest: "建议回问尺码是否变化，并提示补货周期",
    },
    last_order_evidence: {
      source_type: "transaction",
      record_id: "od-001",
      observed_at: "2026-10-20T03:20:00Z",
      excerpt: "纸尿裤 M 码 ×1",
    },
  },
  {
    __mock: true,
    subject_ref: "masked-02",
    tenant_id: "tenant-demo-a",
    masked_label: "张女士 · 尾号 **39",
    search_name: "张女士",
    last_tail_digits: "1234", // 与 masked-01 撞尾号，用于歧义用例
    summary: {
      who: "张女士（另一位），偶尔到店",
      history: "上次购买婴儿湿巾 1 包（订单 od-002，2026-09-30）",
      suggest: "建议确认是否为常购纸尿裤的客户",
    },
    last_order_evidence: {
      source_type: "transaction",
      record_id: "od-002",
      observed_at: "2026-09-30T07:05:00Z",
      excerpt: "婴儿湿巾 ×1",
    },
  },
  {
    __mock: true, subject_ref: "masked-03", tenant_id: "tenant-demo-a", masked_label: "李女士 · 尾号 **88", search_name: "李女士", last_tail_digits: "8888",
    summary: { who: "李女士，母婴店熟客", history: "上次购买婴儿湿巾 2 包（订单 od-003，2026-10-28）", suggest: "建议确认本次所需数量" },
    last_order_evidence: { source_type: "transaction", record_id: "od-003", observed_at: "2026-10-28T08:00:00Z", excerpt: "婴儿湿巾 ×2" },
  },
  {
    __mock: true, subject_ref: "masked-b01", tenant_id: "tenant-demo-b", masked_label: "王女士 · 尾号 **34", search_name: "王女士", last_tail_digits: "1234",
    summary: { who: "王女士，B 店客户", history: "上次购买奶粉 1 罐（订单 od-b01）", suggest: "建议核对段位" },
    last_order_evidence: { source_type: "transaction", record_id: "od-b01", observed_at: "2026-10-29T08:00:00Z", excerpt: "奶粉 ×1" },
  },
] as const;

/** 冲刺版写死的两个测试账号（不做完整 JWT/RBAC，但 tenant_id 仍由服务端从 token 解析）。 */
export const MOCK_TEST_ACCOUNTS = {
  staff_a: {
    login: "staff-a",
    token: "mock-token-staff-a",
    tenant_id: "tenant-demo-a",
    role: "staff" as const,
  },
  staff_b: {
    login: "staff-b",
    token: "mock-token-staff-b",
    tenant_id: "tenant-demo-b",
    role: "staff" as const,
  },
} as const;
