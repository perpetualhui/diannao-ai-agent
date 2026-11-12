# adapters/wechat

主责：E（吴）｜其他人不得直接修改本目录，改动请以 patch 形式提交给主责人。

## 这是什么

店脑 OpenClaw **业务 Tool**（不是微信渠道插件）。需与腾讯 `@tencent-weixin/openclaw-weixin` 渠道插件同时安装：腾讯插件负责微信消息收发，本 Tool 只负责"受控调用店脑业务 API"。

迁入自起始包 `plugin/`，安全模型未改：

- 仅当 `nativeChannelId === openclaw-weixin` 且可信通道元数据里的 `requesterSenderId` 出现在 `DIANNAO_ALLOWED_SENDER_IDS` 白名单时才调 API。
- 后端 API Token 单独绑定指定员工/租户且只读。
- 缺失可信通道元数据时 **fail-closed**，默认无人有权限。
- 不能用聊天文字或模型传入的角色作为授权信息。

## 文件

| 文件 | 作用 |
|---|---|
| `index.ts` | OpenClaw 插件入口，注册 `dian_nao_ask` 只读工具 |
| `openclaw.plugin.json` | 插件元数据 |
| `package.json` | 依赖与 OpenClaw 兼容声明 |
| `CH-01-插件能力矩阵.md` | E 的第 1 项硬交付：插件实测能力矩阵 |
| `SKILL.md` | 复制自起始包 skill/，使用规则说明 |
| `README.md` | 本文件 |

## 配置（环境变量，真实值只写本机 .env）

- `DIANNAO_API_BASE=https://...`：店脑业务 API 地址（非本包提供）
- `DIANNAO_API_TOKEN=...`：只读店员 token，密钥管理注入，勿写在 config 或仓库
- `DIANNAO_ALLOWED_SENDER_IDS=...`：可信插件运行环境确认的员工 sender ID，英文逗号分隔
- `OPENCLAW_WEIXIN_ENABLED=true`：是否启用微信通道（当前未实测）

## 状态（必须如实）

**未在真实用户机器上构建或联调。** 腾讯插件配对存在版本局限（见 CH-01 矩阵）。正式多店/多员工不得共享本原型的固定员工 API Token；需要可信渠道身份绑定、短时凭证和服务端逐请求授权。

## 开发版加载

在与本地 OpenClaw 兼容的工具链安装依赖后，按该 OpenClaw 版本的本地插件安装方式加载本目录，并显式 allowlist `dian_nao_ask` 工具。官方文档：https://docs.openclaw.ai/plugins/building-plugins 。

对外发行前应编译成 JS，指定 `openclaw.extensions` 指向编译结果，并通过目标版本的 `openclaw plugins inspect dian-nao-tool --runtime --json` 和实际微信回合测试。
