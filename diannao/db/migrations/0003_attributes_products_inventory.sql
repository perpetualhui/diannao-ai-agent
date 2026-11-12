-- 0003 · 属性、商品、库存
-- 主责：B 邱 ｜ 依赖 0001、0002。
-- 属性分数据等级 data_class：objective/preference/relationship/safety/inferred，
-- 安全字段（safety）冲突时阻断自动推荐，转人工。

CREATE TABLE attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_id uuid NOT NULL,
  attr_key text NOT NULL,
  value jsonb NOT NULL,
  data_class text NOT NULL CHECK (data_class IN ('objective','preference','relationship','safety','inferred')),
  source_type text NOT NULL,
  source_id text,
  observed_at timestamptz,
  verified_by uuid REFERENCES app_users(id),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified','superseded','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (subject_id, tenant_id) REFERENCES subjects(id, tenant_id)
);
CREATE INDEX idx_attr_subject ON attributes(tenant_id, subject_id, attr_key, created_at DESC);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sku text NOT NULL,
  name text NOT NULL,
  category text,
  current_price numeric(12,2),
  currency char(3) DEFAULT 'CNY',
  shelf_location text,
  -- 品类/位置/适用月龄/健康标签等，见 config/行业配置样例.json
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, sku),
  UNIQUE(id, tenant_id)
);

CREATE TABLE inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id),
  quantity integer NOT NULL,
  observed_at timestamptz NOT NULL,
  source_type text NOT NULL,
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id)
);
