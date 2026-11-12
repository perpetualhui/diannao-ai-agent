主责：B 邱 ｜ 其他人不得直接修改本文件，改动请以 patch 形式提交给主责人。

# 店脑 · 项目 AI 协作规则

> 五人共用一套开发逻辑。任何 AI 助手在本项目开工前，必须先读 `00-分工与协作总纲.md`、`01-共用开发规范.md`、`ROADMAP.md`。

## 目录主权（不可越界）

| 目录 | 权威产出人 |
|---|---|
| `packages/contracts/` | B 邱（唯一出口） |
| `services/api/` | B 邱 |
| `db/migrations/` | B 邱 |
| `apps/web/` | C 罗 |
| `services/ai/` | D 张 |
| `adapters/wechat/` | E 吴 |
| `tests/e2e/` | E 吴 |
| `configs/scenarios/` | D 张 |
| `docs/` | A 周（只读） |
| `ROADMAP.md` | A 统筹（每人只改自己任务行） |
| `README.md` | C 罗 |
| `CLAUDE.md` | B 邱 |

## 给 AI 派任务时必须写清

1. 任务 ID
2. 只改哪个目录
3. 依赖哪份契约
4. 验收标准

## AI 铁律

- 不得把猜测写成已验证结论；不得把未运行的测试写成通过。
- 不得擅自修改 `packages/contracts`（B 的域），发现契约问题只能提建议。
- 产出的代码，本人必须跑过、看过、类型检查过才能交付。
- 多人同时用 AI 时各自独立工作目录，不两人同时改同一份文件。

## 技术基线

- 统一 TypeScript 严格模式，禁止 `any` / `@ts-ignore`（例外须注释原因并经 B 同意）。
- 接口 REST，路径 `/v1/<资源>`；错误统一 `{ code, message, trace_id }`。
- 时间后端 UTC，返回 ISO 8601；业务主键一律 UUID。
- 日志禁止打印 token、密码、完整手机号、完整聊天记录。

## 数据与 AI 铁律

1. 租户隔离在服务端：`tenant_id` 由登录态解析，绝不信任请求体。
2. 客户主键是 UUID；尾号、姓名只做检索线索；歧义未确认前不展示完整档案。
3. 事实 / 经验 / 推测分开存；模型抽取先进草稿，人工确认后才成事实。
4. 只有 `approved` 知识进入正式检索；下架后同步失效索引与缓存。
5. 每条具体事实必须有来源；无来源就说「暂无记录」，不猜。
6. 安全字段（过敏/健康）冲突时阻断自动推荐，转人工。
7. 回写必须幂等；失败不显示成功。
8. 反诈域完全隔离，只读审核过的官方案例。
9. 微信与网页共用业务服务；渠道故障时网页与人工流程继续可用。
10. 导出按授权范围并留审计；店员默认无批量导出。

## 本机运行（B 的 API）

```bash
npm install
npm run build:api                        # 编译 API
node dist/services/api/src/server.js     # http://localhost:7401
npm run test:api                         # 端到端 79 条（自动起停干净服务，可重复）
```

测试账号：`manager-a / demo`、`staff-b / demo`、`staff-a / demo`（A 店店员，用于撤权验证）。
