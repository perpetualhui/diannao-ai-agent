-- 0002 · 身份：主体、身份键、主体关系、渠道绑定
-- 主责：B 邱 ｜ 依赖 0001。
-- 客户主键是 UUID；手机尾号/姓名只做检索线索，存 hash + 脱敏标签。

CREATE TABLE subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid,
  subject_type text NOT NULL,
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id),
  display_name text,
  -- 行业字段组（jsonb），键见 configs/scenarios/*.field_schema
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, tenant_id)
);

-- 检索线索：key_hash 存哈希，masked_label 存脱敏展示值（如「尾号1234」）。
CREATE TABLE identity_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_id uuid NOT NULL,
  key_type text NOT NULL,
  key_hash text NOT NULL,
  masked_label text,
  FOREIGN KEY (subject_id, tenant_id) REFERENCES subjects(id, tenant_id),
  UNIQUE(tenant_id, key_type, key_hash, subject_id)
);
CREATE INDEX idx_identity_lookup ON identity_keys(tenant_id, key_type, key_hash);

CREATE TABLE subject_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  from_subject uuid NOT NULL,
  to_subject uuid NOT NULL,
  relation_type text NOT NULL,
  approved_by uuid REFERENCES app_users(id),
  FOREIGN KEY (from_subject, tenant_id) REFERENCES subjects(id, tenant_id),
  FOREIGN KEY (to_subject, tenant_id) REFERENCES subjects(id, tenant_id)
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
  UNIQUE(channel, account_ref, peer_ref)
);
