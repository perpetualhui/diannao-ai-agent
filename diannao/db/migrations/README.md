主责：B 邱 ｜ 其他人不得直接修改本目录，改动请以 patch 形式提交给主责人。

# db/migrations · 数据库迁移

来源：`docs/04-核心数据库草案.sql` 拆分为有序迁移。目标库 PostgreSQL 15+。

## 顺序（必须按序执行）

| 文件 | 内容 | 依赖 |
|---|---|---|
| `0001_extensions_tenants_stores.sql` | pgcrypto、租户、门店、用户、成员关系 | 无 |
| `0002_identity.sql` | subjects、identity_keys、subject_relations、channel_bindings | 0001 |
| `0003_attributes_products_inventory.sql` | 属性（含数据分级）、商品、库存快照 | 0001–0002 |
| `0004_transactions_service.sql` | 交易、交易明细、服务记录 | 0001–0003 |
| `0005_knowledge_reminders_message.sql` | 知识、提醒、消息（幂等） | 0001–0002 |
| `0006_audit_rls.sql` | 审计日志 + RLS（默认拒绝） | 0001–0005 |
| `0007_public_fraud.sql` | 公共反诈域（完全独立） | 0001 |

## 状态（真实，不夸大）

- **冲刺阶段不执行**：本次演示用内存数据跑通，不装 PostgreSQL、不跑迁移。
- 迁移文件为第二阶段（真实 PostgreSQL）准备的基线，未经真实库执行验证。
- RLS 仅为代表性示例，生产前必须对每张私有表补全全量策略。

## 与契约的映射

- `attributes.data_class` ↔ `types.ts` 的 `DataClass`
- `knowledge_entries.status` ↔ `types.ts` 的 `KnowledgeStatus`（SQL 为 draft/approved/retired；契约四态 draft→pending_review→approved→archived，映射由 services/api 完成）
- `reminder_tasks.status` ↔ `ReminderStatus`
- `transactions/transaction_lines` ↔ `TransactionSummary/TransactionLine`
- `public_fraud_cases` ↔ `FraudCaseReference`
