-- 0004 · 交易与服务记录
-- 主责：B 邱 ｜ 依赖 0001~0003。
-- 每条交易/服务记录都必须可回溯到主体与门店，作为「事实必须有来源」的证据底座。

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id),
  occurred_at timestamptz NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  FOREIGN KEY (subject_id, tenant_id) REFERENCES subjects(id, tenant_id),
  UNIQUE(id, tenant_id)
);

CREATE TABLE transaction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  transaction_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(12,2) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  FOREIGN KEY (transaction_id, tenant_id) REFERENCES transactions(id, tenant_id),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products(id, tenant_id)
);

CREATE TABLE service_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  store_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id),
  service_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  source_type text NOT NULL,
  FOREIGN KEY (subject_id, tenant_id) REFERENCES subjects(id, tenant_id)
);
