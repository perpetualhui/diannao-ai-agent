-- 店脑核心数据骨架（PostgreSQL 15+，示意用；需迁移/权限/加密/备份与审计完善）
-- 注意：所有业务表的 tenant_id 必须在服务端从已认证主体决定；严禁信任模型传入的租户值。
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
  UNIQUE(id,tenant_id)
);
CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name text NOT NULL UNIQUE,
  disabled_at timestamptz
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid,
  user_id uuid NOT NULL REFERENCES app_users(id),
  FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id),
  role text NOT NULL CHECK (role IN ('owner','hq','manager','staff','auditor')),
  revoked_at timestamptz,
  UNIQUE(tenant_id,store_id,user_id)
);
CREATE TABLE channel_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  channel text NOT NULL,
  account_ref text NOT NULL,
  peer_ref text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(channel,account_ref,peer_ref)
);
CREATE TABLE subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid,
  subject_type text NOT NULL,
  FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id),
  display_name text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id)
);
CREATE TABLE identity_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_id uuid NOT NULL,
  key_type text NOT NULL,
  key_hash text NOT NULL,
  masked_label text,
  FOREIGN KEY (subject_id,tenant_id) REFERENCES subjects(id,tenant_id),
  UNIQUE(tenant_id,key_type,key_hash,subject_id)
);
CREATE INDEX idx_identity_lookup ON identity_keys(tenant_id,key_type,key_hash);
CREATE TABLE subject_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  from_subject uuid NOT NULL,
  to_subject uuid NOT NULL,
  relation_type text NOT NULL,
  approved_by uuid REFERENCES app_users(id),
  FOREIGN KEY (from_subject,tenant_id) REFERENCES subjects(id,tenant_id),
  FOREIGN KEY (to_subject,tenant_id) REFERENCES subjects(id,tenant_id)
);
CREATE TABLE attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_id uuid NOT NULL,
  attr_key text NOT NULL,
  value jsonb NOT NULL,
  data_class text NOT NULL CHECK(data_class IN ('objective','preference','relationship','safety','inferred')),
  source_type text NOT NULL,
  source_id text,
  observed_at timestamptz,
  verified_by uuid REFERENCES app_users(id),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','verified','superseded','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(subject_id,tenant_id) REFERENCES subjects(id,tenant_id)
);
CREATE INDEX idx_attr_subject ON attributes(tenant_id,subject_id,attr_key,created_at DESC);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sku text NOT NULL,
  name text NOT NULL,
  category text,
  current_price numeric(12,2),
  currency char(3) DEFAULT 'CNY',
  shelf_location text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,sku),
  UNIQUE(id,tenant_id)
);
CREATE TABLE inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id),
  quantity integer NOT NULL,
  observed_at timestamptz NOT NULL,
  source_type text NOT NULL,
  FOREIGN KEY (product_id,tenant_id) REFERENCES products(id,tenant_id)
);
CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id),
  occurred_at timestamptz NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  FOREIGN KEY (subject_id,tenant_id) REFERENCES subjects(id,tenant_id),
  UNIQUE(id,tenant_id)
);
CREATE TABLE transaction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  transaction_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(12,2) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  FOREIGN KEY (transaction_id,tenant_id) REFERENCES transactions(id,tenant_id),
  FOREIGN KEY (product_id,tenant_id) REFERENCES products(id,tenant_id)
);
CREATE TABLE service_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  FOREIGN KEY (store_id,tenant_id) REFERENCES stores(id,tenant_id),
  service_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  source_type text NOT NULL,
  FOREIGN KEY (subject_id,tenant_id) REFERENCES subjects(id,tenant_id)
);
CREATE TABLE knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  applicable jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
  version integer NOT NULL DEFAULT 1,
  approved_by uuid REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  channel text NOT NULL,
  account_ref text NOT NULL,
  external_message_id text NOT NULL,
  direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
  media_type text NOT NULL DEFAULT 'text',
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'received',
  UNIQUE(channel,account_ref,external_message_id,direction)
);
CREATE TABLE reminder_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_id uuid NOT NULL,
  rule_key text NOT NULL,
  due_at timestamptz NOT NULL,
  draft_text text,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','approved','queued','sent','failed','expired')),
  approved_by uuid REFERENCES app_users(id),
  sent_at timestamptz,
  FOREIGN KEY (subject_id,tenant_id) REFERENCES subjects(id,tenant_id)
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  actor_id uuid REFERENCES app_users(id),
  action text NOT NULL,
  object_type text,
  object_ref text,
  status text NOT NULL,
  trace_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- 独立公共反诈域：只允许公开已审核记录被 public token 读取，绝不能与商家 Subject 做外键关联。
CREATE TABLE public_fraud_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fraud_type text NOT NULL,
  title text NOT NULL,
  publisher text NOT NULL,
  published_at date NOT NULL,
  official_url text NOT NULL,
  risk_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
  reviewed_by uuid REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS 仅展示代表性示例；上线时须对每个私有表配置完备的 SELECT/INSERT/UPDATE/DELETE 策略。
-- 关键要求：后端在同一个 DB 事务里用可信 token 导出的 tenant id 执行 SET LOCAL app.tenant_id；
-- 无法建立可信上下文就拒绝请求，不能默许 service_role 绕过 RLS。
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY subjects_tenant_select ON subjects FOR SELECT USING (
  tenant_id::text = nullif(current_setting('app.tenant_id',true),'')
);
-- 对其他私有表请逐一添加覆盖所有 DML 的 RLS 策略及 WITH CHECK，再允许生产访问。

-- 其他私有表默认 RLS 拒绝访问，实施各自严格策略之前不可开放应用角色：
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores','memberships','channel_bindings','identity_keys','subject_relations',
    'attributes','products','inventory_snapshots','transactions','transaction_lines',
    'service_events','knowledge_entries','message_events','reminder_tasks','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
-- 此草案的默认拒绝意味着新增业务必须补全授权 policies 才能访问。
