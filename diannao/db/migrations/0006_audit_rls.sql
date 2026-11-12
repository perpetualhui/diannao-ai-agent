-- 0006 · 审计 + 行级安全（RLS）
-- 主责：B 邱 ｜ 依赖 0001~0005。
-- 关键要求：后端在同一 DB 事务里用可信 token 导出的 tenant id 执行 SET LOCAL app.tenant_id；
-- 无法建立可信上下文就拒绝请求，不能默许 service_role 绕过 RLS。

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

-- 代表性策略：subjects 只允许同租户 SELECT（其余私有表需逐一补全 SELECT/INSERT/UPDATE/DELETE 策略）。
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY subjects_tenant_select ON subjects FOR SELECT USING (
  tenant_id::text = nullif(current_setting('app.tenant_id', true), '')
);

-- 其余私有表默认开启并强制 RLS，未补策略前默认拒绝访问。
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores','memberships','channel_bindings','identity_keys','subject_relations',
    'attributes','products','inventory_snapshots','transactions','transaction_lines',
    'service_events','knowledge_entries','message_events','reminder_tasks','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
