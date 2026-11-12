主责：B 邱 ｜ 其他人不得直接修改本目录，改动请以 patch 形式提交给主责人。

# packages/contracts · 店脑共享契约

> **全场唯一真相。** 所有接口字段、状态枚举、返回结构以此目录为准。
> 主责：B 邱。任何人需要新字段，向 B 提，不自己在本地加。

## 文件

| 文件 | 作用 |
|---|---|
| `types.ts` | TS 类型定义，覆盖客户匹配状态、Evidence、AssistantResponse、MutationReceipt、知识状态机、幂等字段、客户摘要、成员撤权、商品、导入导出、审计、反诈域 |
| `mock.ts` | Mock 数据与函数，全部带 `__mock: true` 标记，覆盖单匹配/多匹配/无匹配、问答 ok/no_data/needs_human、导入幂等、知识状态流转 |
| `index.ts` | 统一出口，所有人 `import { ... } from '@dian-nao/contracts'` |
| `CHANGELOG.md` | 版本变更记录 |
| `package.json` | 包名 `@dian-nao/contracts` |
| `tsconfig.json` | 严格模式类型检查配置 |

## 使用

```ts
import {
  type ResolveIdentityResponse,
  type AssistantResponse,
  mockResolve,
  mockAsk,
  CONTRACTS_VERSION,
} from '@dian-nao/contracts';
```

## 规则

1. 不自己定义同名类型；发现字段缺失向 B 提，写清「哪个端点、哪个字段、期望什么」。
2. 与 `docs/03-业务接口_OpenAPI.yaml` 冲突时以 OpenAPI 为准，由 B 同步本文件。
3. Mock 返回数据必须带 `__mock: true`，避免被误当真实数据演示。
4. C/D/E 在 B 的 API 未实现前一律基于 Mock 开发；B 每实现一个真实端点发增量包，消费方替换 Mock 并回归。

## 验证状态

- `tsc --noEmit`：通过（见根目录 tsconfig.json，strict 模式，禁 any）。
- Mock 分支：单匹配 / 多匹配 / 无匹配 / ok / no_data / needs_human 均可调用。
- 幂等：`mockCreateDraft` 同 `request_id` 返回同一 receipt。

## 版本

- v2（2026-11-07）补齐 API-02/03/04：成员撤权、商品、导入提交幂等、导出、知识审核状态机、审计。详见 `CHANGELOG.md`。
- v1（2026-11-07）首次产出。
