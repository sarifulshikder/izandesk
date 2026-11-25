-- 003: Observability indexes and default SMTP email messaging channel

CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_job_started
  ON scheduler_job_runs (job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_logs_related_created
  ON message_logs (related_type, related_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_desc
  ON audit_logs (created_at DESC);

INSERT INTO messaging_channels (name, channel_type, provider, enabled, is_default, config, notes)
VALUES (
  'System SMTP Email',
  'EMAIL',
  'SMTP',
  false,
  true,
  '{"source":"settings.notifications"}'::jsonb,
  'Uses SMTP settings configured under Settings -> Notifications'
)
ON CONFLICT (channel_type, provider, name) DO NOTHING;
