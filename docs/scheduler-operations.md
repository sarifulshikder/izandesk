# Scheduler Operations

IzanDesk schedulers run **inside the API process** (no OS cron). Keep the API supervised and monitor readiness.

## Schedulers

| Job | Default | Lock/claim | Notes |
|---|---:|---|---|
| `billing-due-policy-sweep` | 60s | DB lock `billing-due-policy-sweep` | Overdue invoices + due policies |
| `messaging-sweep` | 10 min | DB lock `messaging-sweep` | Messaging summaries/reminders |
| `fup-enforcement-sweep` | 30 min | DB lock `fup-enforcement-sweep` | FUP apply/clear |
| `report-scheduler` | 10 min tick | Atomic `last_run_at` claim per schedule | Uses `report_schedules.interval_minutes`, legacy cron fallback |
| `backup-scheduler` | `BACKUP_SCHEDULE_HOURS` (24h default) | DB lock `backup_scheduler` | Disabled unless `BACKUP_SCHEDULE_ENABLED=true`; persists `backup_runs`; NOC alert on failure |
| `collector:sessions` | 30s normal / 60s lite | DB lock `collector:sessions` | Session sync; in-memory guard + DB lock |
| `collector:telemetry` | 60s | DB lock `collector:telemetry` | Router telemetry + RADIUS NAS reachability; deduped NOC alerts |

## Observability

- `GET /api/system/schedulers` (admin): latest run per job, 24h metrics, backoff state.
- `GET /api/metrics`: includes `izandesk_scheduler_runs_24h`, `izandesk_scheduler_errors_24h`, `izandesk_scheduler_last_success_timestamp_seconds{job,status}`.
- `scheduler_job_runs` table stores run history (`status`, `duration_ms`, `details`, `error`).
- System Health UI shows scheduler status card.

## Reliability recommendations

1. **Supervision:** run API under systemd/docker/pm2 with restart policy. Monitor `/api/live` (liveness) and `/api/ready` (readiness).
2. **Single instance or safe multi-instance:** DB locks/claims prevent most duplicate work; keep one API instance unless you have verified multi-instance behavior for all jobs.
3. **Backoff:** scheduler observability applies in-memory exponential backoff after errors to avoid tight failure loops.
4. **Idempotency:** side-effect jobs should remain idempotent per window/entity. Report delivery uses atomic claim; collectors upsert state; backup creates timestamped files and records runs.
5. **Queue option:** for higher scale, move heavy jobs (reports/backups/bulk sweeps) to a queue/worker (BullMQ, pg-boss, or DB-backed worker). Keep API as scheduler trigger; workers handle retries, concurrency, and dead-letter visibility.
