# 店脑 · 拼装日报告（整合验证）

日期：2026-11-07｜整合执行：受周（A 队长）委托｜方法：按《02-本地文件管理与交接.md》第八节拼装日流程

## 一、结论

**主链路跑通：登录 → 认人（撞号消歧）→ 客户档案 → 服务记录回写（幂等）→ 越权拒绝。**
四层验证全部通过，本次拼装达成 `05-几小时冲刺执行清单.md` 的冲刺目标（演示骨架跑通），**不等于 P0 验收通过**。

## 二、验证结果（全部真实运行）

| # | 验证层 | 命令 | 结果 |
|---|---|---|---|
| 1 | 张（D）AI 引擎评测 | `node --experimental-strip-types eval-runner.ts` | **7/7 通过** |
| 2 | 邱（B）API 冒烟 | `npm run test:api` | **79/79 通过** |
| 3 | 罗（C）网页类型检查 | `vue-tsc --noEmit` | **0 错误** |
| 4 | 罗（C）网页构建 | `vite build` | **成功**（7.1s） |
| 5 | 主链路 curl（经 vite proxy） | login→resolve→summary→draft→幂等→越权 | **7 项全过**（见下） |
| 6 | 吴（E）e2e 契约测试 | `playwright test` | **7/7 通过**（5 接待链路 + 2 微信安全边界） |

### 主链路 curl 证据（走 http://localhost:5173/v1 代理）

| 步骤 | 请求 | 结果 |
|---|---|---|
| 登录 | POST /v1/auth/login（staff-b/demo、staff-a/demo） | 200，token 服务端签发 |
| 唯一匹配 | B 店 resolve "1234" | matched，1 候选（张先生·B店） |
| 租户隔离 | B 店店员查 A 店客户 | **404 拒绝** |
| 撞号 | A 店 resolve "1234" | 张女士（A店 seed 当前单候选；吴的 mock 层为双候选） |
| 客户档案 | GET /v1/subjects/:id | 完整 CustomerSummary（profile+交易+建议） |
| 回写 | POST /v1/notes/drafts（Idempotency-Key: idem-e2e-001） | **201 draft** |
| 幂等 | 同键重复提交 | **同一 receipt id，未重复记账** |
| 未登录 | 无 token 调 resolve | **401 拒绝** |

## 三、整合动作清单（拼装胶水，待各主责人复核）

### 3.1 补缺口（复制，无逻辑改动）

| 动作 | 来源 → 去向 |
|---|---|
| 张的引擎数据 | Demo-zhang `services/ai/data/mock_data.json` → 整合目录同路径（此前缺失，引擎无法跑） |
| 张的评测报告 | Demo-zhang `eval/eval-report.md` → 整合目录 `eval/` |
| 周的文档 | Demo-Zhou 三份（接待问题/演示脚本/冲刺记录）→ 整合目录 `docs/` |
| 罗的入口 | demo-Luo `index.html` → 整合目录 `apps/web/index.html`（此前缺失，vite 无法构建） |

### 3.2 接缝修复（拼装中发现的真实缺陷）

| # | 接缝 | 根因 | 修复 | 影响 |
|---|---|---|---|---|
| 1 | 张的引擎无法直跑 | 整合版 import 丢了 `.ts` 后缀（tsc 风格），Node strip-types 需要 `.ts` | 3 个文件 5 处 import 加回 `.ts`；邱的两个 tsconfig 均不含 services/ai，零影响 | 引擎恢复 7/7 |
| 2 | 张的评测器崩溃 | 整合版把 `import.meta.dirname` 改成了 `__dirname`（CJS），ESM 直跑无此变量 | 改回 `import.meta.dirname` | 同上 |
| 3 | 网页构建失败 | `index.html` 未合并进 apps/web | 从罗的包补入并修正 main.ts 引用路径 | vite build 成功 |

### 3.3 跨域接线 patch（新文件 + 最小改动，**需主责人复核**）

| 文件 | 性质 | 内容 | 待复核人 |
|---|---|---|---|
| `apps/web/src/api-client.ts` | **新文件**（拼装胶水） | login/resolve/getSummary/createDraft 四个 API 调用 + CustomerSummary→Customer 映射 | 罗（C），邱（B）核对契约字段 |
| `apps/web/src/App.vue` | patch 罗 | 登录/搜索/档案/回写切 API，**失败自动降级本地模拟**（铁律 9）；token 只存内存 | 罗（C） |
| `apps/web/src/components/SearchPanel.vue` | patch 罗 | 新增 remote/loading prop 与 search 事件（远程模式父组件调 API，本地模式保持原过滤） | 罗（C） |
| `apps/web/vite.config.ts` | patch 罗 | `/v1` 代理 → `localhost:7401`（可用 DIANNAO_API_ORIGIN 覆盖） | 罗（C） |
| `apps/web/package.json` | patch 罗 | 增加 `pnpm.onlyBuiltDependencies: ["esbuild"]`（pnpm 安全策略放行） | 罗（C） |

**未动的主责目录**：`packages/contracts/`（邱）、`services/api/`（邱）、`db/migrations/`（邱）、`services/ai/` 业务逻辑（张，仅修 import 后缀与 dirname 两处机械接缝）、`adapters/wechat/`（吴）、`tests/e2e/`（吴）、`configs/scenarios/`（张）。

## 四、已暴露未解决的差异（拼装日的核心产出）

### 4.1 张的引擎未接入邱的 API（下一轮第一优先）

现状：邱的 `/v1/assistant/ask` 内置他自己的规则简版（79 条测试锚定该行为）；张的 engine.ts 是更完整实现（含过敏阻断、月龄计算，7/7 评测），但**两者签名与数据源不一致**：

| 维度 | 邱的 API ask | 张的引擎 |
|---|---|---|
| 签名 | `ask(tenantId, question)` | `ask(dataset, ctx, question, subjectRef)` |
| 数据源 | 自带 seed（manager-a/staff-b，TENANT_A/B） | 周（A）的 mock_data.json（zhou/luo，t-001） |
| 返回 | AssistantResponse（contracts v2：citations/approved_experience） | AssistantResponse（临时类型：evidence） |
| 测试锚定 | 79 条冒烟 + 吴 5 条契约 | 张 7 条评测 |

强行替换会同时打碎邱 79 条与吴 5 条已验证测试。**处置**：两实现并存，接入方案需邱+张协商（建议：张按 contracts v2 适配输出 + 邱的 store 加载数据源切到周的 mock_data.json，双方各自回归后合并）。

### 4.2 契约字段差异（张的临时类型 vs 邱的 contracts v2）

- 邱版 AssistantResponse 用 `citations`；张版用 `evidence`（OpenAPI 原文是 `evidence[]`）——**邱 v2 与 OpenAPI 有出入，按规范以 OpenAPI 为准，需邱确认是否改名或 OpenAPI 升版**
- 邱版多 `subject / approved_experience / suggestions / uncertainties` 字段（比 OpenAPI 更丰富，向前兼容）
- 张的 `types.local.ts` 待邱 contracts v2 稳定后删除并切换 import

### 4.3 环境问题（本机）

- npm 11.19 在 Node 24.14 下崩溃（`Class extends value undefined`），**已绕过**：根目录 npm install 实际可用；web 依赖改用 corepack pnpm 安装。五人本机如遇同错，统一用 `corepack pnpm install`。

## 五、诚实声明（验收口径）

- 本次达成：**演示骨架跑通**（五层验证见第二节），页面标注 Mock/API 模式，未混淆
- 本次未达成：AI 引擎与 API 的合并（4.1）、真实 PostgreSQL（迁移脚本就绪未执行）、CSV 导入 UI、经验审核页、微信实机联调（吴的微信 spec 是安全边界单测，非实机）
- 周的验收演示（演示脚本.md）中场景四/五依赖张的引擎接入 API 后才能端到端演示，当前可由张的独立评测（7/7）作为等价证据

## 六、微信 ClawBot 本地网关（追加交付，待吴复核）

新增 `adapters/wechat/gateway.mjs`（拼装胶水，复用吴 security.ts 的安全模型）：本地服务器，桥接「微信 ClawBot 渠道消息信封 ↔ 店脑 API:7401」。

### 冒烟结果（真实运行，`node gateway.mjs` + curl simulate）

| 用例 | 输入 | 结果 |
|---|---|---|
| 健康检查 | GET /wechat/health | ok，显示白名单数/API 绑定状态 |
| 未绑定 sender | 陌生 wxid 查客户 | **绑定引导，零数据返回**（T02） |
| 通道不符 | channel=wcferry | **403 fail-closed** |
| 查唯一客户 | 「查一下尾号1234上次买什么」 | 三行档案：是谁/以前买过/建议 + 依据（T03） |
| 撞号 | 「尾号5678」 | 两个脱敏候选，要求补充确认（T04） |
| 重复投递 | 同 message_id 重发 | **duplicate，只处理一次**（T06） |
| 反诈 | 「刷单转账返利是真的吗」 | **公共反诈提示（96110），不触商家数据**（T09） |
| 导出 | 「把所有历史导出来」 | **拒绝，引导网页管理员操作** |
| 记一下（无主体） | 未确认客户先记事 | **引导先确认客户，不创建无主体记录** |
| 记一下（有主体） | 确认客户后记事 | **201 draft，等待店长审核** |

已知环境坑：Windows curl 命令行传中文会 GBK 乱码导致关键词路由失效——冒烟请用 `--data-binary @file.json`（UTF-8 文件体）。

### 连真实微信还需要（需用户本机操作，网关不代替扫码）

1. 本机安装 OpenClaw Gateway：`openclaw --version` 检查
2. 安装腾讯插件：`npx -y @tencent-weixin/openclaw-weixin-cli install` 后 `openclaw channels login --channel openclaw-weixin` 微信扫码
3. 将 OpenClaw 渠道消息配置为 POST 到 `http://localhost:7402/wechat/webhook`（信封格式：channel/message_id/sender_id/text）
4. 设置 `DIANNAO_ALLOWED_SENDER_IDS` 白名单（员工微信 sender id）

未完成以上四步前，网关处于「可联调、未连微」状态，如实标注。

## 七、下一轮第一优先

1. 张的引擎接入邱的 API（按 4.1 建议方案，双方回归后合并）
2. 契约 evidence/citations 命名裁决（A 周拍板）
3. 周跑验收演示（演示脚本.md），确认后更新 ROADMAP 里程碑 M0→达成
4. 真实微信链路四步（OpenClaw 安装/扫码/信封对接/白名单）由 E 吴 + 用户执行
5. AI 真实模型接入（等待用户提供 LLM API Key 后，升级网关/引擎的自然语言理解）
