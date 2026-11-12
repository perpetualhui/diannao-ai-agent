# 文件包说明

- 发送人：B 邱
- 接收人：全体（A 周 / C 罗 / D 张 / E 吴）
- 日期：2026-11-07
- 基于版本：起始包 v0
- 包名：`邱-全体-20261107-contracts-v2.zip`

## 本次变更（v2：补齐 API-02/03/04）

- `packages/contracts/` **v2**：新增成员撤权、商品、导入提交幂等、导出、知识审核状态机、审计类型与 Mock
- `services/api/` **完整 API**（18 端点）：新增
  - `POST /v1/memberships/:id/revoke`（撤权，旧会话立即失效）
  - `GET|POST /v1/products`（商品记录）
  - `POST /v1/imports/preview`、`POST /v1/imports/commit`（CSV 导入，错误行有原因，content_hash 幂等）
  - `GET /v1/exports/:resource`（导出 CSV，留审计）
  - `GET|POST /v1/knowledge`、`POST /v1/knowledge/:id/review`（知识状态机）
  - `GET /v1/audit`（审计查询）
- `services/api/src/csv.ts`：零依赖 CSV 解析/序列化 + 内容指纹
- `scripts/test-api.mjs`：一键起停干净服务跑冒烟，解决内存状态不可重复问题
- `scripts/smoke-api.mjs`：扩展为 79 条，覆盖 API-01~04 全部验收标准
- 文档：ROADMAP / README / API README / 契约 README+CHANGELOG 同步更新

## 覆盖路径

- `packages/contracts/`（仅此目录）
- `services/api/`（仅此目录）
- `db/migrations/`（仅此目录）
- 根目录：`CLAUDE.md`、`AGENTS.md`、`.env.example`、`.gitignore`、`scripts/`

## 验证状态（真实，可重复）

| 项 | 命令 | 结果 |
|---|---|---|
| 依赖安装 | `npm install` | added 3 packages |
| 契约类型检查 | `tsc --noEmit -p tsconfig.json` | 0 error |
| 契约运行时校验 | `bash scripts/verify.sh` | 16 passed / 0 failed |
| API 编译 | `npm run build:api` | 0 error |
| API 端到端 | `npm run test:api` | **79 passed / 0 failed**（连跑两次均 79/79） |

### 验收标准对照

| 任务 | 验收标准 | 证据 |
|---|---|---|
| API-01 | C/D/E import 成功、tsc 通过 | 契约 tsc 0 error、运行时 16/16 |
| API-02 | 两店隔离 0 越权；旧会话撤权失效 | B 店访问 A 店客户 404、B 店商品列表 0 条；撤权后 staff-a 旧 token 立即 401、重新登录 401 |
| API-03 | 错误行有原因；重复导入不重复记账 | 预览 missing_field/suspected_duplicate 带 reason；重复 commit `idempotent_replay=true` 且 imported_count 不变 |
| API-04 | 只有 approved 进检索；流转可追溯 | draft 不进 → submit_review → approve 进 → archive 退出；审计含 6 类动作 |

## 已知问题（如实）

- 内存数据，重启重置；未接 PostgreSQL（迁移 0001–0007 已备，第二阶段执行）。
- 会话 token 为简化实现，非完整 JWT 签名；撤权/版本校验/租户隔离逻辑完整。
- 问答为规则简版，未接真实模型；`approved_experience` 已按知识状态机过滤。
- 手动连跑 `smoke-api.mjs` 前需重启服务（撤权等状态不可逆）；用 `npm run test:api` 可自动保证干净。

## 接收方需要做

1. 解压到临时目录，按 MANIFEST 覆盖路径合并，**不做整目录替换**。
2. `import { ... } from '@dian-nao/contracts'`，跑一次类型检查。
3. C/D/E 据此并行开工；有差异写清「哪个端点、哪个字段、期望什么」反馈 B。

## 不得覆盖

`apps/web`、`services/ai`、`adapters/wechat`、`tests/e2e`、`configs/scenarios` 等他人主责目录。

## 追加：拼装日交付（2026-11-07）

- 整合验证：张 7/7 · 邱 79/79 · 罗 typecheck+build · 吴 e2e 7/7 · 主链路 curl 全通 → 详见 INTEGRATION-REPORT.md
- 新增：adapters/wechat/gateway.mjs（微信 ClawBot 本地网关，冒烟 10 项通过，待吴复核）
- 新增：apps/web/src/api-client.ts + App.vue/SearchPanel/vite.config 接线 patch（web→API 主链路，待罗复核）
- 补缺：services/ai/data/mock_data.json、eval/eval-report.md、apps/web/index.html、docs/（周三份文档）
