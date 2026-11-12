-- 0005 · 知识、提醒、消息（含幂等）
-- 主责：B 邱 ｜ 依赖 0001、0002。
-- 知识生命周期：draft → approved → retired；只有 approved 进正式检索。
-- 消息按 (channel, account_ref, external_message_id, direction) 去重，保证回写幂等。

CREATE TABLE knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  applicable jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
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
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  media_type text NOT NULL DEFAULT 'text',
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'received',
  -- 幂等：同一渠道同一外部消息 ID 只记一次
  UNIQUE(channel, account_ref, external_message_id, direction)
);

CREATE TABLE reminder_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_id uuid NOT NULL,
  rule_key text NOT NULL,
  due_at timestamptz NOT NULL,
  draft_text text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','queued','sent','failed','expired')),
  approved_by uuid REFERENCES app_users(id),
  sent_at timestamptz,
  FOREIGN KEY (subject_id, tenant_id) REFERENCES subjects(id, tenant_id)
);
