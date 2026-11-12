主责：B 邱 ｜ 其他人不得直接修改本目录，改动请以 patch 形式提交给主责人。

# services/api · 业务 API（API-01~04）

零框架依赖（Node 内置 `http`），内存数据，启动即用。所有类型来自 `packages/contracts`（v2）。

## 运行

```bash
# 1. 装依赖（只需一次）
npm install

# 2. 编译 + 启动
npm run build:api
node dist/services/api/src/server.js
# 默认 http://localhost:7401

# 3. 一键端到端测试（自动起停干净服务，可重复跑）
npm run test:api
```

## 测试账号（会话制 token，登录后签发）

| 账号 | 密码 | 角色 | 租户 | 用途 |
|---|---|---|---|---|
| `manager-a` | `demo` | manager | tenant A | 管理员操作、审核、撤权、导入导出 |
| `staff-b` | `demo` | staff | tenant B | 跨租户隔离验证 |
| `staff-a` | `demo` | staff | tenant A | 撤权失效验证（被 manager-a 撤销） |

## 端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/v1/health` | 免鉴权 | 健康检查 |
| POST | `/v1/auth/login` | 免鉴权 | 登录，签发 session token |
| POST | `/v1/identity/resolve` | 登录 | 客户检索（matched/ambiguous/not_found） |
| GET | `/v1/subjects/:id` | 登录 | 客户摘要（是谁/以前买过什么/建议做什么） |
| POST | `/v1/assistant/ask` | 登录 | 问答（approved_experience 只取 approved 知识） |
| POST | `/v1/notes/drafts` | 登录 | 新建服务记录草稿（幂等） |
| POST | `/v1/notes/:id/approve` | 管理 | 审核草稿（乐观锁 expected_version） |
| GET | `/v1/reminders` | 登录 | 提醒列表 |
| POST | `/v1/memberships/:id/revoke` | 管理 | **撤权，旧会话立即失效** |
| GET | `/v1/products` | 登录 | 商品列表（按租户隔离） |
| POST | `/v1/products` | 管理 | 创建商品（SKU 唯一、支持幂等键） |
| POST | `/v1/imports/preview` | 管理 | CSV 导入预览（错误行有原因） |
| POST | `/v1/imports/commit` | 管理 | 导入提交（content_hash 幂等，重复不重复记账） |
| GET | `/v1/exports/:resource` | 管理 | 导出 CSV（customers/transactions/products），留审计 |
| GET | `/v1/knowledge` | 登录 | 知识列表（可按 status 过滤） |
| POST | `/v1/knowledge` | 登录 | 提交知识草稿 |
| POST | `/v1/knowledge/:id/review` | 管理 | 审核流转（submit_review/approve/reject/archive） |
| GET | `/v1/audit` | 管理 | 审计日志查询 |

## 铁律落实

- **租户隔离在服务端**：`tenant_id` 只来自 `Authorization: Bearer <session token>`，请求体里的租户字段一律忽略。
- **越权不泄漏**：跨租户访问返回 404（不暴露他店存在性）。
- **歧义不露档案**：多命中仅返回脱敏候选。
- **回写幂等**：`Idempotency-Key` 头或 `request_id`，同键返回同一 receipt。
- **撤权即失效**：撤权后 `membership_version` 前进，旧 session 立即 401，被撤权账号无法再登录。
- **只有 approved 进检索**：draft / pending_review / archived 知识不进 `approved_experience`。
- **导入幂等**：同 `content_hash` 重复提交返回 `idempotent_replay: true`，不重复记账。
- **导出留审计**：管理员导出写 `audit_logs`，店员默认无批量导出。
- **失败不静默**：统一 `{ code, message, trace_id }`。

## 验证记录（真实）

- 编译：`tsc -p tsconfig.api.json` → 0 error
- 端到端：`npm run test:api` → **79 passed / 0 failed**（连续跑两次均 79/79，可重复）

覆盖验收标准：

| 任务 | 验收标准 | 证据 |
|---|---|---|
| API-01 | import 成功、tsc 通过 | 契约 tsc 0 error、运行时 16/16 |
| API-02 | 两店隔离 0 越权；旧会话撤权失效 | B 店访问 A 店客户 404；撤权后 staff-a 旧 token 立即 401、重新登录 401 |
| API-03 | 错误行有原因；重复导入不重复记账 | 预览返回 missing_field+suspected_duplicate 带 reason；重复 commit `idempotent_replay=true` 且 imported_count 不变 |
| API-04 | 只有 approved 进检索；流转可追溯 | draft 不进 → submit_review → approve 后进 → archive 后退出；审计含 membership_revoke/knowledge_review/knowledge_archive/import_commit/export/login |

## 说明（诚实标注）

- 内存数据，重启即重置；未接 PostgreSQL（迁移见 `db/migrations/`，第二阶段切换）。
- 会话 token 为简化实现，非完整 JWT 签名；但撤权、版本校验、租户隔离逻辑完整。
- 问答为规则简版，未接真实模型与检索；`approved_experience` 已按知识状态机过滤。
- `npm run test:api` 每次起干净进程，因此可重复；手动连跑 `smoke-api.mjs` 前需重启服务。
