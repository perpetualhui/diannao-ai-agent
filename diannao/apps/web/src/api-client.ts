/**
 * 拼装日接线层（INTEGRATION GLUE）—— 整合产物，非罗（C）原始交付
 *
 * 作用：把罗的 web 组件（Customer 结构）接到邱的 API（契约 v2 端点）。
 *  - 身份/租户全部由服务端 token 解析，前端不传 tenant_id/role（铁律 1）
 *  - API 不可用时由 App.vue 降级到本地 demo 数据（铁律 9）
 *  - 待罗（C）复核后可并入 apps/web 正式代码；接口字段以 packages/contracts 为准
 *
 * 依赖端点（邱 B，services/api）：
 *  POST /v1/auth/login      → LoginResponse
 *  POST /v1/identity/resolve→ ResolveIdentityResponse
 *  GET  /v1/subjects/:id    → CustomerSummary
 *  POST /v1/notes/drafts    → MutationReceipt
 */

import type { Customer, ServiceNote } from './demo-data'

// ── API 返回结构（与 contracts 对齐的最小面） ─────────────────────────

interface LoginResponse {
  principal: { user_id: string; tenant_id: string; role: string; token: string }
  expires_at: string
}

export interface ResolveResult {
  match_status: 'matched' | 'ambiguous' | 'not_found'
  candidates: { subject_ref: string; masked_label: string }[]
  needs_confirmation: boolean
  resolved_subject_ref?: string
  trace_id: string
}

interface SummaryLine { product_id: string; product_name: string; sku: string; quantity: number; unit_price: number }
interface SummaryTransaction { id: string; occurred_at: string; lines: SummaryLine[]; total_amount: number; currency: string }
interface SummaryEvidence { source_type: string; record_id: string; observed_at: string; excerpt?: string }

export interface CustomerSummary {
  subject_ref: string
  display_label: string
  subject_type: string
  profile: Record<string, unknown>
  recent_transactions: SummaryTransaction[]
  last_purchase_at?: string
  suggestions: string[]
  evidence: SummaryEvidence[]
  handoff_required: boolean
  trace_id: string
}

interface MutationReceipt { id: string; status: string; trace_id: string }

// ── 会话（token 只存内存，不落 localStorage） ─────────────────────────

let session: { token: string; role: string; tenantId: string } | null = null
export function currentRole(): 'staff' | 'manager' | null {
  if (!session) return null
  return session.role === 'owner' || session.role === 'manager' || session.role === 'hq' ? 'manager' : 'staff'
}
export function hasSession(): boolean { return session !== null }
/** 当前登录 token（供后台管理接口使用）。 */
export function authToken(): string { return session?.token ?? '' }
export function clearSession(): void { session = null }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session) headers['Authorization'] = `Bearer ${session.token}`
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `请求失败 ${res.status}`)
  }
  return (await res.json()) as T
}

// ── API 操作 ─────────────────────────────────────────────────────────

/** 普通用户自助注册（人设注册后不可更改）。 */
export async function apiRegister(
  loginName: string,
  password: string,
  promptType: 'baby' | 'apparel' | 'fraud',
): Promise<{ role: 'staff' | 'manager' }> {
  const data = await call<LoginResponse>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ login_name: loginName, password, prompt_type: promptType }),
  })
  session = { token: data.principal.token, role: data.principal.role, tenantId: data.principal.tenant_id }
  return { role: currentRole() ?? 'staff' }
}

export async function apiLogin(loginName: string, password: string): Promise<{ role: 'staff' | 'manager' }> {
  const data = await call<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login_name: loginName, password }),
  })
  session = { token: data.principal.token, role: data.principal.role, tenantId: data.principal.tenant_id }
  return { role: currentRole() ?? 'staff' }
}

export async function apiResolve(query: string): Promise<ResolveResult> {
  return call<ResolveResult>('/v1/identity/resolve', {
    method: 'POST',
    body: JSON.stringify({ query: query.trim().slice(0, 200) }),
  })
}

export async function apiGetSummary(subjectRef: string): Promise<CustomerSummary> {
  return call<CustomerSummary>(`/v1/subjects/${encodeURIComponent(subjectRef)}`)
}

export async function apiCreateDraft(subjectRef: string, content: string): Promise<MutationReceipt> {
  return call<MutationReceipt>('/v1/notes/drafts', {
    method: 'POST',
    body: JSON.stringify({ subject_ref: subjectRef, content: content.slice(0, 4000), source_type: 'staff_text' }),
  })
}

// ── CustomerSummary → 罗 Customer 结构映射 ───────────────────────────

function ageLabel(birthdate: unknown): string {
  if (typeof birthdate !== 'string') return '孩子信息待补'
  const b = new Date(birthdate)
  if (Number.isNaN(b.getTime())) return '孩子信息待补'
  const now = new Date()
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months -= 1
  return months >= 0 ? `宝宝 ${months} 个月` : '宝宝信息待补'
}

function labelTail(label: string): { name: string; tail: string } {
  const m = /^(.+?)（尾号\s*(\d{4})）$/.exec(label)
  if (m) return { name: m[1] ?? label, tail: m[2] ?? '' }
  return { name: label, tail: '' }
}

export function summaryToCustomer(summary: CustomerSummary): Customer {
  const { name, tail } = labelTail(summary.display_label)
  const tags: string[] = []
  if (summary.recent_transactions.length > 0) tags.push('老客')
  if (summary.handoff_required) tags.push('需人工确认')
  const purchases = summary.recent_transactions.map((t) => ({
    id: t.id,
    item: t.lines.map((l) => `${l.product_name}×${l.quantity}`).join('、') || '（无明细）',
    date: t.occurred_at.slice(0, 10),
    detail: `金额 ¥${t.total_amount.toFixed(2)} · 已核订单`,
  }))
  const suggestion = summary.suggestions.length
    ? summary.suggestions.join('；')
    : '暂无经审核的经验建议，请先确认需求。'
  return {
    id: summary.subject_ref,
    name,
    phoneMasked: tail ? `尾号 ${tail}` : summary.display_label,
    phoneSuffix: tail,
    child: ageLabel(summary.profile['child.birthdate']),
    tags,
    purchases,
    notes: [] as ServiceNote[],
    suggestion,
  }
}

export function candidateToCustomer(c: { subject_ref: string; masked_label: string }): Customer {
  return {
    id: c.subject_ref,
    name: c.masked_label,
    phoneMasked: '脱敏候选',
    phoneSuffix: '',
    child: '',
    tags: ['待确认'],
    purchases: [],
    notes: [],
    suggestion: '先确认身份，再查看完整档案。',
  }
}

export { type ServiceNote }
