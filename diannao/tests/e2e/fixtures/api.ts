import { MOCK_CUSTOMERS, MOCK_TEST_ACCOUNTS } from "../mock/customers";
import type { MockAssistantResponse, MockIdentityResolveResponse, MockMaskedCandidate } from "../mock/customers";

export type ApiMode = "mock" | "real";
export interface Session { token: string; tenantId: string }
export interface ApiClient {
  login(loginName: string): Promise<Session>;
  resolveIdentity(query: { tailDigits?: string; name?: string }): Promise<MockIdentityResolveResponse>;
  askAssistant(question: string, subjectRef?: string): Promise<MockAssistantResponse>;
}

const MODE: ApiMode = process.env.E2E_API_MODE === "real" ? "real" : "mock";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("API 返回值不是对象");
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`API 字段 ${key} 不是字符串`);
  return value;
}

function parseCandidates(value: unknown): MockMaskedCandidate[] {
  if (!Array.isArray(value)) throw new Error("API 字段 candidates 不是数组");
  return value.map((item) => {
    const record = asRecord(item);
    return { subject_ref: requiredString(record, "subject_ref"), masked_label: requiredString(record, "masked_label") };
  });
}

function parseIdentityResponse(value: unknown): MockIdentityResolveResponse {
  const record = asRecord(value);
  const status = requiredString(record, "status");
  if (status !== "matched" && status !== "ambiguous" && status !== "not_found") throw new Error(`未知匹配状态：${status}`);
  if (typeof record.needs_confirmation !== "boolean") throw new Error("API 字段 needs_confirmation 不是布尔值");
  return { status, candidates: parseCandidates(record.candidates), needs_confirmation: record.needs_confirmation, trace_id: requiredString(record, "trace_id") };
}

function parseAssistantResponse(value: unknown): MockAssistantResponse {
  const record = asRecord(value);
  const status = requiredString(record, "status");
  const statuses: MockAssistantResponse["status"][] = ["ok", "no_data", "needs_confirmation", "needs_human", "forbidden", "error"];
  if (!statuses.includes(status as MockAssistantResponse["status"])) throw new Error(`未知问答状态：${status}`);
  if (!Array.isArray(record.evidence)) throw new Error("API 字段 evidence 不是数组");
  const evidence = record.evidence.map((item) => {
    const evidenceRecord = asRecord(item);
    const sourceType = requiredString(evidenceRecord, "source_type");
    const allowedSources = ["transaction", "service_event", "verified_attribute", "product", "inventory_snapshot", "knowledge_entry", "rule"] as const;
    if (!allowedSources.some((allowed) => allowed === sourceType)) throw new Error(`未知证据类型：${sourceType}`);
    const updatedAt = evidenceRecord.updated_at;
    const excerpt = evidenceRecord.excerpt;
    return {
      source_type: sourceType as (typeof allowedSources)[number],
      record_id: requiredString(evidenceRecord, "record_id"),
      observed_at: requiredString(evidenceRecord, "observed_at"),
      ...(typeof updatedAt === "string" ? { updated_at: updatedAt } : {}),
      ...(typeof excerpt === "string" ? { excerpt } : {}),
    };
  });
  if (typeof record.needs_confirmation !== "boolean" || typeof record.handoff !== "boolean") throw new Error("问答布尔字段格式错误");
  return {
    status: status as MockAssistantResponse["status"], answer: requiredString(record, "answer"), evidence,
    candidates: parseCandidates(record.candidates), needs_confirmation: record.needs_confirmation,
    handoff: record.handoff, trace_id: requiredString(record, "trace_id"),
  };
}

function createMockClient(): ApiClient {
  let session: Session | undefined;
  return {
    async login(loginName) {
      const account = Object.values(MOCK_TEST_ACCOUNTS).find((item) => item.login === loginName);
      if (!account) throw new Error(`[mock] 未知测试账号：${loginName}`);
      session = { token: account.token, tenantId: account.tenant_id };
      return session;
    },
    async resolveIdentity(query) {
      if (!session) throw new Error("请先登录");
      const tail = query.tailDigits?.trim();
      const name = query.name?.trim();
      const hits = MOCK_CUSTOMERS.filter((customer) =>
        customer.tenant_id === session?.tenantId && (!tail || customer.last_tail_digits === tail) && (!name || customer.search_name === name),
      );
      return {
        status: hits.length === 0 ? "not_found" : hits.length === 1 ? "matched" : "ambiguous",
        candidates: hits.map(({ subject_ref, masked_label }) => ({ subject_ref, masked_label })),
        needs_confirmation: hits.length > 1,
        trace_id: `trace-mock-resolve-${hits.length}`,
      };
    },
    async askAssistant(question, subjectRef) {
      if (!session) throw new Error("请先登录");
      if (!question.trim()) throw new Error("问题不能为空");
      if (!subjectRef) return { status: "needs_confirmation", answer: "请先确认客户身份。", evidence: [], candidates: [], needs_confirmation: true, handoff: false, trace_id: "trace-mock-confirm" };
      const target = MOCK_CUSTOMERS.find((customer) => customer.subject_ref === subjectRef && customer.tenant_id === session?.tenantId);
      if (!target) return { status: "forbidden", answer: "没有权限查询该客户，或当前没有相关记录。", evidence: [], candidates: [], needs_confirmation: false, handoff: false, trace_id: "trace-mock-forbidden" };
      return {
        status: "ok",
        answer: `${target.summary.who}｜${target.summary.history}｜${target.summary.suggest}`,
        evidence: [target.last_order_evidence], candidates: [], needs_confirmation: false, handoff: false,
        trace_id: `trace-mock-ask-${target.subject_ref}`,
      };
    },
  };
}

function createRealClient(): ApiClient {
  const base = (process.env.DIANNAO_API_BASE ?? "").replace(/\/$/, "");
  const token = process.env.DIANNAO_API_TOKEN ?? "";
  if (!/^https?:\/\//.test(base) || !token) throw new Error("real 模式需要 DIANNAO_API_BASE 和 DIANNAO_API_TOKEN");
  async function request(path: string, body: object): Promise<Record<string, unknown>> {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(`${path} 返回 ${response.status}`);
    return asRecord(payload);
  }
  return {
    async login() { return { token, tenantId: "server-derived" }; },
    async resolveIdentity(query) { return parseIdentityResponse(await request("/v1/identity/resolve", { query: query.tailDigits ?? query.name ?? "" })); },
    async askAssistant(question, subjectRef) { return parseAssistantResponse(await request("/v1/assistant/ask", { question, ...(subjectRef ? { subject_ref: subjectRef } : {}) })); },
  };
}

export function createApiClient(): ApiClient { return MODE === "real" ? createRealClient() : createMockClient(); }
export const CURRENT_MODE: ApiMode = MODE;
export function assertMasked(candidate: MockMaskedCandidate): void {
  if (!candidate.masked_label.includes("**") || /1\d{10}/.test(candidate.masked_label)) throw new Error(`候选未正确脱敏：${candidate.masked_label}`);
}
