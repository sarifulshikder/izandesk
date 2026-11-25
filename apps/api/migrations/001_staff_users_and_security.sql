-- 001: Database-backed staff users & router TLS verification columns

CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','NOC_ENGINEER','BILLING_OPERATOR','TECHNICIAN','RESELLER')),
  tenant_id TEXT NOT NULL DEFAULT 'tnt-primary-01',
  reseller_id TEXT,
  branch_id UUID,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_email_lower ON staff_users (lower(email));
CREATE INDEX IF NOT EXISTS idx_staff_users_role_active ON staff_users (role, is_active);

ALTER TABLE network_routers ADD COLUMN IF NOT EXISTS tls_verify BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE network_routers ADD COLUMN IF NOT EXISTS tls_ca_cert TEXT;
