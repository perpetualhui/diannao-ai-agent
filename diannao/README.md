主责：C 罗（面向店主店员的使用说明） ｜ 本文件当前由 B 邱 建骨架，后续由 C 交接维护。

# 店脑 · 门店经验与老客服务系统（冲刺版）

> ⚠️ 本目录是 **B 组员 邱 的本地工作副本**。当前状态：**演示骨架跑通**，不是 P0 验收通过。
> 未验证能力（微信插件、反诈案例库、真实门店数据）一律标注为待验证。

## 团队

| 角色 | 姓名 | 负责域 |
|---|---|---|
| A 队长 | 周 | 产品范围、试点、验收、仲裁、进度 |
| B 组员 | **邱** | 架构、数据、契约、API、迁移 |
| C 组员 | 罗 | 网页与体验 |
| D 组员 | 张 | AI、知识、规则、评测 |
| E 组员 | 吴 | 渠道、测试、环境、发布与恢复 |

## 本副本已交付（B 邱 · API-01~04）

| 任务 | 交付 | 位置 | 验证 |
|---|---|---|---|
| API-01 | 共享契约（TS 类型 + Mock）v2 | `packages/contracts/` | `tsc --noEmit` 0 error；运行时 16/16 |
| API-02 | 登录、租户隔离、撤权失效、商品记录 | `services/api/` | 端到端含「撤权后旧 token 立即 401」「B 店访问 A 店 404」 |
| API-03 | CSV 导入预览/提交幂等、导出 | `services/api/` | 错误行有 reason；重复 commit 不重复记账 |
| API-04 | 知识状态机、审计 | `services/api/` | 只有 approved 进检索；审计 6 类动作可查 |
| — | 数据库迁移（有序） | `db/migrations/` | 未执行（第二阶段 PostgreSQL） |
| — | 目录骨架 + 主责声明 + 环境模板 | 各目录 `README.md`、`.env.example` | — |
| — | 项目 AI 协作规则 | `CLAUDE.md`、`AGENTS.md` | — |

端到端总计 **79 passed / 0 failed**，`npm run test:api` 可重复复现。

## 快速开始

```bash
npm install

# 契约类型检查
./node_modules/.bin/tsc --noEmit -p tsconfig.json

# 契约运行时校验（Mock 三路径 + 幂等）
bash scripts/verify.sh

# 启动 API
npm run build:api
node dist/services/api/src/server.js       # http://localhost:7401

# 一键端到端测试（自动起停干净服务，可重复跑）
npm run test:api
```

测试账号：`manager-a / demo`（A 店经理）、`staff-b / demo`（B 店店员）、`staff-a / demo`（A 店店员，用于撤权验证）。

## 目录结构

```text
demo-邱/
├── CLAUDE.md / AGENTS.md       # AI 协作规则（B 维护）
├── ROADMAP.md                  # 进度（A 统筹，此处为 B 本地副本）
├── README.md                   # 使用说明
├── docs/                       # 方案原文归档（只读）
├── packages/contracts/         # 【唯一真相】类型 + Mock（B）
├── services/api/               # 最小 API（B）
├── services/ai/                # AI（D，空骨架）
├── apps/web/                   # 网页（C，空骨架）
├── adapters/wechat/            # 微信（E，空骨架）
├── db/migrations/              # 数据库迁移（B）
├── configs/scenarios/          # 行业配置（D，空骨架）
├── tests/e2e/                  # 端到端测试（E，空骨架）
├── scripts/                    # 校验与冒烟脚本
├── _snapshots/ _incoming/      # 快照 / 待合并包
└── MANIFEST.md                 # 本次交付的文件包说明
```

## 已知限制（如实标注，勿当正式能力）

- 内存数据，重启即重置；未接 PostgreSQL（迁移已备，第二阶段执行）。
- 会话 token 为简化实现，非完整 JWT 签名；撤权/版本校验/租户隔离逻辑完整。
- 问答为规则简版，未接真实模型与检索；`approved_experience` 已按知识状态机过滤。
- 微信插件：E 未验证，标阻塞，核心业务走网页。
- 尚未经 D（契约）、E（API-02/03/04）复核，也未获 A 签认，状态均为「待复核」。

## 数据来源标注

- 契约 `packages/contracts/mock.ts` 中所有 Mock 数据带 `__mock: true`。
- 演示时必须说清「这段是 Mock 还是真实」。
