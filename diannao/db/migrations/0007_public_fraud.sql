-- 0007 · 公共反诈域（完全独立）
-- 主责：B 邱 ｜ 独立于商家域。
-- 只允许 public token 读取已审核（status='approved'）的公共案例；
-- 绝不与商家 subjects/transactions/attributes 建立任何外键或查询关联。

CREATE TABLE public_fraud_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fraud_type text NOT NULL,
  title text NOT NULL,
  publisher text NOT NULL,
  published_at date NOT NULL,
  official_url text NOT NULL,
  risk_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  reviewed_by uuid REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 反诈域不开启商家 RLS，而是通过独立的 public 角色 + 只读视图隔离；
-- 应用层强制：该连接不得持有任何商家私有表的访问权限。
