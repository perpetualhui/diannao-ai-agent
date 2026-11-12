# 店脑 OpenClaw 业务工具（单店内部原型）

这是**业务 Tool**，不是微信渠道插件；需与腾讯 `openclaw-weixin` 同时安装。

**安全模型**：只有 `nativeChannelId === openclaw-weixin` 且通道可信元数据里的 `requesterSenderId` 出现在 `DIANNAO_ALLOWED_SENDER_IDS` 白名单时才调用 API。后端 API Token 还须单独绑定指定员工/租户并只读。插件会拒绝无法判定来源的会话，默认无人有权限。不能用聊天文字或模型传入的角色作为授权信息。

配置：

- `DIANNAO_API_BASE=https://...`：部署后的店脑业务 API 地址（非本包提供）
- `DIANNAO_API_TOKEN=...`：只读店员 token，密钥管理注入，勿写在 config 或仓库
- `DIANNAO_ALLOWED_SENDER_IDS=...`：从可信插件运行环境确认的员工 sender ID，以英文逗号分隔

开发版：在与本地 OpenClaw 兼容的工具链安装依赖后，按该 OpenClaw 版本的本地插件安装方式加载此目录，并显式 allowlist `dian_nao_ask` 工具。官方文档：https://docs.openclaw.ai/plugins/building-plugins 。对外发行前应编译成 JS，指定 `openclaw.extensions` 指向编译结果，并通过目标版本的 `openclaw plugins inspect dian-nao-tool --runtime --json` 和实际微信回合测试。

注意：**未在真实用户机器上构建或联调**。正式多店/多员工不得共享本原型的固定员工 API Token；需要可信渠道身份绑定、短时凭证和服务端逐请求授权。
