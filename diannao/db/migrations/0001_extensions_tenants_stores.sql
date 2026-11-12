-- 0001 · 扩展 + 租户 + 门店
-- 主责：B 邱 ｜ 基于 docs/04-核心数据库草案.sql 拆分为有序迁移。
-- 冲刺阶段不执行（用内存/SQLite 跑通演示）；第二阶段切 PostgreSQL 时按序执行。
-- 铁律：所有业务表的 tenant_id 必须由服务端从已认证主体决定，严禁信任模型/前端传入的租户值。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, tenant_id)
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name text NOT NULL UNIQUE,
  disabled_at timestamptz
);

-- 成员关系：tenant_id / store_id 与角色绑定；revoked_at 支持撤权即时失效。
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid,
  user_id uuid NOT NULL REFERENCES app_users(id),
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id),
  role text NOT NULL CHECK (role IN ('owner','hq','manager','staff','auditor')),
  revoked_at timestamptz,
  UNIQUE(tenant_id, store_id, user_id)
);
