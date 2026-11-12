# 店脑 AI × 微信 ClawBot 接入手册 V2.0

> 版本日期：2026-11-07｜目标：先打通“微信私聊 → 安全查询 → 店脑 API → 带依据回复”，再开放草稿、提醒审批及各行业模板。

## 1. 实施边界

- **已知**：腾讯维护的微信渠道插件 `@tencent-weixin/openclaw-weixin`，频道 ID `openclaw-weixin`，可以把私聊文本与部分媒体消息送入 OpenClaw，插件负责对端消息收发。官方文档：https://docs.openclaw.ai/channels/wechat / https://github.com/Tencent/openclaw-weixin。
- **未知/需在目标版本实测**：微信用户是否都能与该 ClawBot 联系、主动提醒发送范围与时效、转发名片解析、特定媒体格式、图片识别链路、账号绑定策略、发消息的成功回执；**不以普通微信群聊作为 P0 功能**。
- **不是**：直接取得普通微信个人号全部聊天记录、全部好友列表或群发权限；不能靠一条安装命令完成产品的多租户 CRM 授权。
- **状态**：本交付没有访问到用户 OpenClaw 主机、微信登录二维码、API 域名和密钥，因此是实施包，不表示已经线上接通。

## 2. 工作部署拓扑

```text
A. 微信通道（腾讯插件）
微信私聊 → OpenClaw Gateway → 专用店脑 Agent / Skill

B. 业务能力（自行部署）
专用 Agent → 受控 API（短时身份 token / 内部服务凭证）
            → 店脑数据库：租户 RBAC、事实、知识、交易、推荐、提醒
            → 应答 evidence[] + status + trace_id

C. 独立公共反诈（最好单独 Agent）
公共咨询 → antifraud-only token → 已审核案例库
```

**建议拆为两个 Agent**：`dian-nao-staff`（只能读取授权门店，允许新建草稿）和 `dian-nao-antifraud`（只能读取公共案例）；不要在公共 Agent 注册私有客户查询工具。

## 3. 腾讯插件通道安装（在目标机器上执行）

```bash
openclaw --version
node --version
npx -y @tencent-weixin/openclaw-weixin-cli install
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw channels login --channel openclaw-weixin
openclaw gateway restart
openclaw plugins list
openclaw channels status --probe
```

需要用微信实际扫码授权。为多账号对话隔离（注意会调整全局配置）：

```bash
openclaw config set session.dmScope per-account-channel-peer
```

如安装输出与此处不符，**优先遵守当前插件 CLI/README**，不要强行套旧版本配置。官方当前文档中的 `2.4.8` 配对限制属于**特定版本**；无论版本如何，业务权限仍须由店脑自己的后端验证。

## 4. 店脑 Agent 技能安装

实施包提供 **`plugin/`（推荐，结构化业务 Tool）** 和 `skill/SKILL.md`（使用规则说明）。建议优先安装/验证 `dian_nao_ask` 工具，由其接收结构化问题参数，直接调用店脑业务 API；再复制 Skill 到代理 workspace 的 `skills/dian-nao/SKILL.md`。`skill/ask.py` 仅用于内部离线开发调试，不允许 Agent 把未经转义的用户聊天文本拼成 shell 命令。官方技能规范：https://docs.openclaw.ai/tools/skills ，插件注册规范：https://docs.openclaw.ai/plugins/building-plugins 。

**说明：技能不是对接微信的官方 SDK，也不会替你自动部署后端。** 它只提供私聊消息如何安全调用业务 API 的操作规范。本文示例业务工具 `dian_nao_ask` 只发一个只读问答请求；要在实际 OpenClaw 上安装工具、配置后端地址和 API token，并保证 token 不出现在聊天/日志/仓库中；生产运行不要为此开放通用 `exec` 权限。

脚本与 Skill 按“单店内部测试模式”设计：`DIANNAO_API_TOKEN` **对应后端已绑定的内部员工/测试角色**，模型不能提供租户 ID、角色或客户 ID 来提升权限。如果要面向多家店、多名微信用户开放，必须建设可信适配器：由渠道受信任元数据提取发送者 ID，服务端完成一次性绑定、签发短时身份 token，并采用每次调用的 ABAC/RBAC 判断。不得把微信聊天里的“我是店主”作为身份证据。

推荐 API 环境变量：

```bash
DIANNAO_API_BASE=https://<your-backend-domain>
DIANNAO_API_TOKEN=<secret-token-from-your-backend>
```

不要在真实命令行历史、群聊或录屏中公开 token；可通过 OpenClaw 的密钥注入/部署密钥管理设置。脚本请求返回前禁止打印请求头与密钥。若使用 sandbox，需另行配置凭证注入。Webhook 或自建 Hook 需要以实际运行版 OpenClaw 的规范实现，**不要将下面的业务 API 路由当成腾讯微信插件原生 webhook**。

## 5. 员工绑定与权限流程

1. 店主在网页添加员工、确定门店和权限；生成一次性、短期有效、单次使用的绑定码。
2. 员工通过已登录网页扫码或确认，并在微信 ClawBot 中发送该绑定码。
3. 可信通道适配器从通信元数据获取 `channel_account_id + peer_id`；店脑服务端校验绑定码与登录员工的关联并持久化 `channel_bindings`。
4. 每次请求均由服务端查询 `channel_bindings` 和 `memberships`，独立校验 `tenant_id/store_id` 范围和有效状态；撤权立即生效。
5. 公共反诈入口无此身份，仅能查已审核公共反诈案例。

**安全底线**：私有 API 不接受客户端自由提交 `tenant_id`, `role`, `store_id` 作为权限依据；这些值应从服务端已认证主体取得。对单店测试绑定 token 时，权限就是 token 对应的主体，不能用于生产多用户混合会话。手机号/尾号不可直接证明微信提问者是客户本人。

## 6. 业务 API 调用示例

以下 URL 是**店脑拟实现的业务 API**，不是微信/腾讯官方接口。

**请求（员工已绑定时）**：

```http
POST /v1/assistant/ask HTTP/1.1
Authorization: Bearer ${DIANNAO_API_TOKEN}
Content-Type: application/json
X-Request-ID: req-demo-001

{"question":"张女士之前买过哪个尺码？","conversation_ref":"wechat:test-session:001"}
```

**返回示例（合成数据，不代表真实客户）**：

```json
{
  "status": "needs_confirmation",
  "answer": "发现两位同名客户，暂不能确定。请补充会员号或手机号尾号。",
  "evidence": [],
  "candidates": [{"subject_ref": "masked-01", "masked_label": "张女士 · 尾号 **12"},{"subject_ref": "masked-02", "masked_label": "张女士 · 尾号 **39"}],
  "needs_confirmation": true,
  "handoff": false,
  "actions": [],
  "trace_id": "trace-demo-001"
}
```

**真正成功的私有查询**：必须带至少一个 `evidence`（如真实订单 `record_id` + `observed_at`）。`answer` 由服务端业务规则形成，Agent 不得补写来源外的事实或价格。

## 7. 微信公共模板（拷贝到 Agent 系统指令/Skill）

> 你是“店脑 AI”门店工作助手。先判定本条对话是否有权访问商家数据。对涉及客户、订单、价格、库存、服务、经验的具体事实，调用受控业务 API，不从对话猜测、编造或记忆私人资料。若身份未绑定、客户不唯一或数据冲突，要求补充信息，不能提前披露详情。普通用户反诈查询必须切到只可读公共案例的服务域。医疗、儿童健康、药品用法、汽修安全诊断、投诉赔付、交易承诺等场景只给出人工核实/转接建议。对每个真实事实列来源与日期；缺失时说明没有记录。优先输出三行：匹配对象 / 历史依据 / 下一步。只有收到服务端明确 `sent` 的回执才说已发送；`draft`、`queued` 不能说完成。

### 7.1 主要触发意图

| 触发示例 | 动作 |
|---|---|
| “查一下尾号 1234 上次买的……” | `identity.resolve` 后 `assistant.ask` |
| “记一下，客户说以后只要宽松版” | 提取并显示确认内容 → `notes.drafts` |
| “推荐一个适用的……” | `recommendations`，只对合规 SKU 且有证据解释 |
| “今天谁需要提醒？” | `reminders` 返回已校验的任务列表，不发送 |
| “这个刷单转账是真的么？” | 单独公共反诈服务，不能查询商家客户 |
| “把这个买家所有历史导出来” | 拒绝在普通微信输出；引导授权管理员后台审批导出 |

### 7.2 场景差异

- 母婴：围绕孩子月龄、常购 SKU、禁忌、补货；健康判断转人工。
- 服装：围绕具体尺码、颜色、版型与退换货；尺码不确定必须追问。
- 汽修：围绕车牌/VIN、工单与里程；报价和故障以已确认工单为准。
- 医美/药店：只汇总授权可访问的历史服务资料，不给医疗诊断/治疗建议。
- 公共反诈：只使用已审核官方案例，输出吻合信号、不确定点、核验步骤；不对他人作犯罪定性。

## 8. 接入验收测试（先只读）

| 编号 | 动作 | 预期 |
|---|---|---|
| T01 | 微信向 ClawBot 发“你好” | 通道私聊可回复，日志有 message ID |
| T02 | 未绑定用户问某客户购物记录 | 返回“需要绑定/没有权限”，不出客户信息 |
| T03 | 员工问本店唯一老客的上次 SKU | 有订单来源与时间，非模型记忆 |
| T04 | 员工问同名/尾号撞号客户 | 返回脱敏候选，不展示档案 |
| T05 | 员工请求其他店数据 | API 拒绝，审计有记录 |
| T06 | 微信重复投递同一消息 | 只处理一次，避免重复笔记/提醒 |
| T07 | 员工要求更改“过敏”属性 | 只可草稿/人工复核，不自动覆盖 |
| T08 | 请求库存但记录过期 | 明确过期或转人工，不保证现货 |
| T09 | 普通反诈询问“刷单先交钱” | 返回风险信号和已审核官方案例来源 |
| T10 | 关闭/卸载微信插件 | 网页业务仍可用，任务状态正常 |

## 9. 生产上线核查

- 通道实际版本、Node/OpenClaw 版本记录并锁定；升级走回归测试。
- 每个 Agent 仅注册最小必需的工具，关闭任意代码执行/数据库直连的危险权限（如非必要）。
- 生产 API 全 HTTPS、密钥轮换、速率限制、审计与错误脱敏。
- 机器人不应直接运行用户提供的命令或随意打开外部链接/附件；媒体解析需做文件大小/类型限制和敏感内容处理。
- 每次重新授权、离职撤销、跨店调整进行红队测试。
- 客户授权、撤回、删除、导出流程可操作；发营销消息需获许可并遵守渠道政策。

> **交付判定**：通道扫码成功 ≠ 业务接入成功。只有 T01–T10 测试通过、店员绑定生效、客户端没有私有数据越权，才算完成“微信 ClawBot 接入店脑”的第一阶段。
