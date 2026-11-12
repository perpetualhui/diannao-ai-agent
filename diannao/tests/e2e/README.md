# tests/e2e

主责：E（吴）｜模块作者补自己模块用例，E 整合。

## 这是什么

店脑端到端回归骨架。冲刺版（M1 / OPS-01）目标：跑通**接待链路**——登录 → 搜索客户 → 打开客户卡片。

## 技术栈

Playwright + TypeScript。统一 TypeScript 严格模式，禁止 `any`/`@ts-ignore`。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 依赖（playwright + typescript） |
| `tsconfig.json` | 严格模式 TS 配置 |
| `playwright.config.ts` | Playwright 配置，baseURL 走 `E2E_WEB_BASE_URL` |
| `mock/customers.ts` | Mock 客户与订单数据（标 `__mock: true`）与最小兼容类型 |
| `fixtures/api.ts` | API client fixture：登录拿 token、调 `/v1/identity/resolve`、`/v1/assistant/ask`（Mock 模式本地返回） |
| `接待链路_登录_搜索_卡片.spec.ts` | 五条用例：单匹配、撞号、无匹配、租户隔离、未登录拒绝 |
| `微信适配器_安全边界.spec.ts` | 两条用例：可信通道 fail-closed、响应字段白名单 |
| `README.md` | 本文件 |

## 运行

```bash
npm install
npm run typecheck
npm test
```

默认使用本地 Mock，不依赖浏览器下载、网页或真实后端。真实 API 到位后设置 `E2E_API_MODE=real`、`DIANNAO_API_BASE`、`DIANNAO_API_TOKEN`，同一组断言直接验证既定端点。

## 状态（必须如实）

- Mock 数据明确标注 `__mock: true`，不与真实客户数据混淆。
- 2026-11-07 实测：`npm run typecheck` 通过；`npm test` 7/7 通过，无跳过项。
- Mock 客户按 token 对应租户过滤；跨租户 subject 引用返回 `forbidden` 且不返回证据。
- 当前验证 API/契约链路。C 的网页尚未交付，因此没有伪造 UI 断言；网页接入后可另加页面级用例，不影响本交付运行。
