主责：D 张 ｜ 其他人不得直接修改本目录，改动请以 patch 形式提交给主责人。

# services/ai · AI、知识、规则、评测

- 主责：D 张
- 依赖契约：`packages/contracts`（`AssistantResponse`、`Evidence`、`KnowledgeEntry` 等）

## 冲刺目标（H1:30–H3:30）

- 按客户 ID 查历史 + 生成三行回答（规则 + Mock，不接真模型）
- 每条事实带 `evidence`（`record_id` + `observed_at`）
- 缺数据时返回「暂无记录」，不编造
- 答案结构严格按 `AssistantResponse`：`status / answer / approved_experience / suggestions / citations / uncertainties / needs_confirmation / handoff`

## 铁律

- 事实 / 经验 / 推测分开；模型抽取先进草稿，人工确认后才成事实。
- 只有 `approved` 知识进入正式检索。
- 安全字段（过敏/健康）冲突时阻断自动推荐，转人工。

> 本目录当前为空骨架（B 仅建目录与主责声明），实现由 D 张产出。
