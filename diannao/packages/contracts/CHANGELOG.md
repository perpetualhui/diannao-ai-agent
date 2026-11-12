# packages/contracts CHANGELOG

版本号规则：每次对外发文件包 +1；不跳号、不复用；接收方本地版本更高则先同步不降级。

## v2 — 2026-11-07（B 邱，补齐 API-02/03/04 契约）

- 新增成员关系与撤权：`Role`、`Membership`（含 `revoked_at` + `membership_version`）、`RevokeMembershipRequest/Response`
- 新增商品与库存：`ProductRecord`、`InventorySnapshot`、`CreateProductRequest`
- 新增导入提交与导出：`ImportBatchStatus`、`ImportCommitRequest`、`ImportCommitResponse`（含 `idempotent_replay`）、`ImportErrorRow`、`ExportRequest`、`ExportReceipt`
- 新增知识审核：`KnowledgeReviewDecision`（submit_review/approve/reject/archive）、`KnowledgeSubmitRequest`、`KnowledgeReviewRequest`
- 新增审计：`AuditAction`、`AuditLog`、`AuditQuery`
- Mock 新增：`MOCK_MEMBERSHIP_MANAGER_A/STAFF_B`、`MOCK_PRODUCTS`、`mockImportCommit`（幂等）、`nextKnowledgeStatus`（状态机）、`MOCK_AUDIT_LOGS`
- 验证：`tsc --noEmit` 0 error；运行时 16/16

## v1 — 2026-11-07（B 邱，首次产出）

- 新增 `types.ts`：覆盖契约必须的字段
  - 客户匹配状态：`matched` / `ambiguous` / `not_found`
  - 问答结果：`subject, answer, approved_experience, suggestions, citations, uncertainties, handoff_required`
  - 证据 Evidence：`source_type, record_id, observed_at, updated_at, excerpt`
  - 回写凭证 MutationReceipt：`id, status, trace_id`（含幂等 `request_id`）
  - 知识状态：`draft → pending_review → approved → archived`
  - 幂等字段：`request_id` / `conversation_ref` / `trace_id`
  - 安全字段数据分级 `DataClass`：objective / preference / relationship / safety / inferred
  - 登录态 `AuthPrincipal`：tenant_id 由服务端从 token 解析，不接受前端传入
  - 反诈域：`AssessFraudRequest/Response`、`FraudCaseReference`（独立隔离，只读公共来源）
  - 报表/导入/提醒/推荐请求与响应类型
- 新增 `mock.ts`：登录（两个测试账号）、身份检索三路径、问答三分支、草稿幂等、知识草稿/已审核、推荐、提醒、报表、导入预览、反诈，全部带 `__mock: true`
- 新增 `index.ts`：统一出口 + `CONTRACTS_VERSION`
- 验证：`tsc --noEmit` 通过

## v0 — 2026-11-07（起始包占位）

- 起始包目录占位，无实际类型。
