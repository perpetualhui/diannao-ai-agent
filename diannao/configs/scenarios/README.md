主责：D 张 ｜ 其他人不得直接修改本目录，改动请以 patch 形式提交给主责人。

# configs/scenarios · 行业场景配置

- 主责：D 张（A 复核业务口径）
- 来源：起始包 `config/行业配置样例.json`

## 结构要点

- `schema_version`：配置版本
- `common`：通用规则（身份识别、证据必填项、提醒策略）
- `scenes[]`：各行业场景（母婴 / 服装 / 汽修 / 医美 / 药店）
  - `field_schema`：行业字段组，键与 `subjects.profile`（jsonb）、`attributes.attr_key` 对应
  - `data_class`：objective / preference / relationship / safety / inferred（与契约 `DataClass` 一致）
  - `triggers` / `rules` / `human_handoff`
- `antifraud_service`：独立反诈域，只读审核过的公共来源

## 与契约/迁移的映射

- `field_schema.*.data_class` ↔ `types.ts` `DataClass`
- 母婴字段 `child.birthdate` / `child.allergy` / `child.formula_stage` / `child.diapers_size` ↔ 客户摘要 `profile`

> 本目录当前为空骨架（B 仅建目录与主责声明），配置迁入与维护由 D 张产出。
