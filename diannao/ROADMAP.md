# 店脑 · 进度与下一步（B 邱 本地副本）

最后更新：2026-11-07｜副本维护：B 邱｜原版由 A 周统筹

> 本文件是 B 邱 本地工作副本，只回填 B 自己任务行；全局进度以 A 的 `ROADMAP.md` 为准。
> **真实状态：契约与最小 API 已在 B 本地跑通；无真实门店数据、无微信联调、未执行 PostgreSQL 迁移。**

## 人员

| 角色 | 姓名 | 职责 | 本机目录 |
|---|---|---|---|
| A 队长 | 周 | 产品范围、试点、验收、仲裁、进度统筹 | `docs/`、样例数据工具 |
| B 组员 | **邱** | 架构、数据、契约、API、迁移 | `packages/contracts/`、`services/api/`、`db/migrations/` |
| C 组员 | 罗 | 网页与体验 | `apps/web/` |
| D 组员 | 张 | AI、知识、规则、评测 | `services/ai/`、`configs/scenarios/` |
| E 组员 | 吴 | 渠道、测试、环境、发布与恢复 | `adapters/wechat/`、`tests/e2e/` |

## B 的任务状态

| ID | 交付 | 主责 | 复核 | 状态 | 证据 |
|---|---|---|---|---|---|
| API-01 | 共享契约：TS 类型 + Mock | B | D | **待复核** | `packages/contracts/` v2；`tsc --noEmit` 0 error；运行时 16/16 |
| API-02 | 登录、租户权限、客户商品记录接口 | B | E | **待复核** | 会话制登录、撤权失效、商品记录；端到端 79/79 含「撤权后旧 token 立即 401」「B 店访问 A 店客户 404」 |
| API-03 | CSV 导入导出与幂等回写 | B | E | **待复核** | 导入预览错误行带 reason；重复 commit `idempotent_replay=true` 且 imported_count 不变；导出留审计 |
| API-04 | 经验审核状态接口 + 审计 | B | E | **待复核** | 状态机 draft→pending_review→approved→archived；draft 不进检索、approved 进、archived 退出；审计 6 类动作可查 |

> 按状态定义：`已完成` 只有 A 能改，B 最高只能标到「待复核」。
> 本副本**达到四项验收标准**，但尚未经 E 复核、A 签认，故一律为「待复核」。

## B 的交付清单（API-01~04 完整）

- [x] `packages/contracts/` v2：types / mock / index / CHANGELOG / README
- [x] 覆盖：客户搜索状态、Evidence、AssistantResponse、MutationReceipt、知识状态机、幂等、客户摘要、成员撤权、商品、导入导出、审计
- [x] `tsc --noEmit` 0 error；契约运行时 16/16
- [x] `services/api/` 完整 API（18 端点）：登录/检索/摘要/问答/写记录/审核/提醒/撤权/商品/导入预览/导入提交/导出/知识列表/知识提交/知识审核/审计
- [x] API-02：租户隔离、越权 403/404、**旧会话撤权失效**
- [x] API-03：CSV 预览（错误行有原因）、提交幂等（content_hash）、导出权限 + 审计
- [x] API-04：知识状态机、只有 approved 进检索、审计可追溯
- [x] `db/migrations/` 有序迁移（0001–0007）
- [x] 可重复测试：`npm run test:api` 自动起停干净服务，连续两次 79/79
- [x] 打包 `邱-全体-20261107-contracts-v2.zip` 并发全体（见 MANIFEST）

## 阻塞与未知

| 事项 | 当前事实 | 负责人 | 安排 |
|---|---|---|---|
| 门店样本 | 未取得授权与样本 | A | 用显式模拟数据开发 |
| 微信插件 | 未验证 | E | 核心业务走网页，插件标阻塞 |
| PostgreSQL | 本机不装，内存数据 | B | 第二阶段切真实库，迁移已备 |
| 复核 | 等 D（契约）、E（API-02/03/04）复核 | D/E | 收到意见即修订 |
| 正式 JWT | 当前为简化会话 token | B | 第二阶段换 JWT 签名 + 完整 RBAC |

## 下一轮 B 的第一优先

1. 收 D/E 复核意见，出 contracts v3（若有变更）。
2. 接 PostgreSQL：执行 `db/migrations/`，跑同样的 79 条用例回归。
3. 会话 token 换真实 JWT 签名 + 完整 RBAC 策略。
