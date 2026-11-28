import { Router } from 'express';
import { execFile } from 'child_process';
import { createClient } from 'redis';
import fs = require('fs');
import path = require('path');
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { LITE_MODE } from '../config/runtime';
import { emitNocAlert } from '../integrations/noc-alerts';
import { getBillingHealth } from '../integrations/billing-health';
import { withSchedulerRun, getSchedulerStatus, getSchedulerMetrics } from '../integrations/scheduler-observability';
import { getMigrationStatus } from '../db/migrator';
import { getQueuesOverview, isQueuesActive, registerQueueHandler, retryFailedJobs, scheduleRecurringJob, type QueueName } from '../infra/queues';
import { getSecurityStatus } from '../security/guards';
import { isRedisReady } from '../infra/redis';
import { getActiveSecretKeyId, isActiveSecretKeyAvailable, isSecretsEncryptionConfigured } from '../security/secret-store';
import { stepUpSatisfied } from '../security/step-up';
import { rotateStoredSecrets } from '../integrations/secret-migration';
import { migrateKycFileEncryption } from '../integrations/kyc';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();
function requireAdmin(req:any,res:any){ if (!['SUPER_ADMIN','NOC_ENGINEER'].includes(String((req as any).user?.role))) { res.status(403).json({ message: 'Forbidden' }); return false; } return true; }

function run(cmd: string, args: string[], timeout = 15000): Promise<{ ok:boolean; stdout:string; stderr:string; code:number|null }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout||''), stderr: String(stderr||err?.message||''), code: (err as any)?.code ?? 0 });
    });
  });
}

function backupsDir() {
  const dir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listBackupFiles(dir = backupsDir()) {
  if (!fs.existsSync(dir)) return [] as any[];
  return fs.readdirSync(dir).filter(f=>/\.sql(\.gz)?$/.test(f)).map(f=>{ const st=fs.statSync(path.join(dir,f)); return { name:f, size: st.size, created_at: st.mtime, path: path.join(dir,f) }; }).sort((a:any,b:any)=>+new Date(b.created_at)-+new Date(a.created_at));
}

export function getBackupConfig() {
  const enabled = String(process.env.BACKUP_SCHEDULE_ENABLED || 'false').toLowerCase() === 'true';
  const hours = Math.max(1, Number(process.env.BACKUP_SCHEDULE_HOURS || 24) || 24);
  const retentionCount = Math.max(0, Number(process.env.BACKUP_RETENTION_COUNT || 14) || 14);
  const retentionDays = Math.max(0, Number(process.env.BACKUP_RETENTION_DAYS || 30) || 30);
  return { enabled, hours, retentionCount, retentionDays, dir: backupsDir() };
}

export function applyBackupRetention(cfg = getBackupConfig()) {
  const files = listBackupFiles(cfg.dir);
  const now = Date.now();
  const toDelete = new Set<string>();
  if (cfg.retentionDays > 0) {
    const cutoff = now - cfg.retentionDays * 24*3600*1000;
    for (const f of files) if (+new Date(f.created_at) < cutoff) toDelete.add(f.path);
  }
  if (cfg.retentionCount > 0) {
    files.slice(cfg.retentionCount).forEach((f:any)=>toDelete.add(f.path));
  }
  let deleted = 0;
  for (const p of Array.from(toDelete)) {
    try { fs.unlinkSync(p); deleted++; } catch {}
  }
  return { deleted, kept: Math.max(0, files.length - deleted) };
}

async function recordBackupRun(row: { trigger: string; ok: boolean; file_name?: string|null; file_size_bytes?: number|null; message?: string|null; detail?: string|null }) {
  await pool.query(
    `INSERT INTO backup_runs(trigger, ok, file_name, file_size_bytes, message, detail) VALUES($1,$2,$3,$4,$5,$6)`,
    [row.trigger, row.ok, row.file_name || null, row.file_size_bytes ?? null, row.message || null, row.detail || null]
  ).catch(() => {});
}

export async function runDbBackup(trigger: 'manual'|'scheduled' = 'manual') {
  const dir = backupsDir();
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  const file = path.join(dir, `izandesk-${ts}.sql`);
  // Prefer explicit DATABASE_URL, then PG* vars, then the same DB_* vars the pool uses (container env)
  const dbUrl = process.env.DATABASE_URL || `postgresql://${encodeURIComponent(process.env.PGUSER||process.env.DB_USER||'izandesk_user')}:${encodeURIComponent(process.env.PGPASSWORD||process.env.DB_PASSWORD||'izandesk_secret_password')}@${process.env.PGHOST||process.env.DB_HOST||'localhost'}:${process.env.PGPORT||process.env.DB_PORT||'5432'}/${process.env.PGDATABASE||process.env.DB_NAME||'izandesk'}`;
  const r = await run('pg_dump', [dbUrl, '-f', file], 120000);
  if (!r.ok) {
    try { if (fs.existsSync(file) && fs.statSync(file).size === 0) fs.unlinkSync(file); } catch {}
    const result = { ok: false as const, trigger, message: 'Backup failed (pg_dump unavailable or DB unreachable)', detail: String(r.stderr||'').slice(0,500) };
    await recordBackupRun({ trigger, ok: false, message: result.message, detail: result.detail });
    return result;
  }
  const st = fs.statSync(file);
  const retention = applyBackupRetention();
  const result = { ok: true as const, trigger, backup: { name: path.basename(file), size: st.size, path: file, created_at: st.mtime }, retention };
  await recordBackupRun({ trigger, ok: true, file_name: result.backup.name, file_size_bytes: result.backup.size });
  return result;
}

async function tryAcquireBackupLock(minutes = 30) {
  const name = 'backup_scheduler';
  const holder = `api-${process.pid}-${Date.now()}`;
  const r = await pool.query(`INSERT INTO billing_scheduler_locks(name, locked_until, holder, updated_at)
    VALUES($1, now() + ($2 || ' minutes')::interval, $3, now())
    ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until, holder = EXCLUDED.holder, updated_at = now()
      WHERE billing_scheduler_locks.locked_until <= now()
    RETURNING name`, [name, String(minutes), holder]);
  return r.rowCount === 1;
}

export function startBackupScheduler() {
  if (LITE_MODE) { console.log('[BackupScheduler] disabled in lite mode (manual backups still available)'); return; }
  const cfg = getBackupConfig();
  if (!cfg.enabled) { console.log('[BackupScheduler] disabled (set BACKUP_SCHEDULE_ENABLED=true to enable)'); return; }
  const intervalMs = cfg.hours * 3600 * 1000;
  console.log(`[BackupScheduler] enabled every ${cfg.hours}h, retention ${cfg.retentionCount} files / ${cfg.retentionDays} days`);
  const runOnce = async () => {
    try {
      await withSchedulerRun('backup-scheduler', async () => {
        if (!(await tryAcquireBackupLock(Math.max(10, Math.min(55, cfg.hours*60 - 5))))) return { skipped: 'lock' };
        const res = await runDbBackup('scheduled');
        if (res.ok) {
          console.log(`[BackupScheduler] backup ok: ${res.backup?.name} (${res.backup?.size} bytes), pruned=${res.retention?.deleted}`);
          return { ok: true, file: res.backup?.name, pruned: res.retention?.deleted };
        }
        const fail: any = res;
        console.error('[BackupScheduler] backup failed:', fail.message, fail.detail || '');
        await emitNocAlert({ severity: 'CRITICAL', source: 'BACKUP', title: 'Scheduled backup failed', message: String(fail.message || 'Backup failed'), details: { detail: fail.detail || null } }).catch(() => {});
        throw new Error(String(fail.message || 'Backup failed'));
      });
    } catch (e:any) { console.error('[BackupScheduler] error', e.message); }
  };
  registerQueueHandler('ops', 'db-backup', runOnce);
  if (isQueuesActive()) {
    void scheduleRecurringJob('ops', 'sched:db-backup', 'db-backup', intervalMs);
    return;
  }
  setTimeout(runOnce, 60 * 1000);
  setInterval(runOnce, intervalMs);
}

// Redis health via the official client (no redis-cli binary needed in the container)
async function redisPing(): Promise<{ ok: boolean | null; detail?: string; version?: string }> {
  if (LITE_MODE) return { ok: null, detail: 'disabled in lite mode' };
  const client = createClient({
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      connectTimeout: 2000,
      reconnectStrategy: () => false,
    },
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  });
  client.on('error', () => {});
  try {
    await client.connect();
    const pong = await Promise.race([
      client.ping(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('redis ping timeout')), 3000)),
    ]);
    let version: string | undefined;
    try {
      const info = await client.info('server');
      const m = info.match(/redis_version:([^\r\n]+)/);
      if (m) version = m[1];
    } catch {}
    return pong === 'PONG' ? { ok: true, ...(version ? { version } : {}) } : { ok: false, detail: String(pong) };
  } finally {
    try { await client.quit(); } catch { try { client.disconnect(); } catch {} }
  }
}

router.get('/health', asyncHandler(async (_req, res) => {
  const checks: any = { api: { ok: true }, db: { ok: false }, redis: { ok: null }, disk: { ok: null }, memory: { ok: true }, time: new Date().toISOString() };
  try { await pool.query('SELECT 1'); checks.db = { ok: true }; } catch { checks.db = { ok: false }; }
  try {
    const mu = process.memoryUsage();
    checks.memory = { ok: true, rss: mu.rss, heapUsed: mu.heapUsed, heapTotal: mu.heapTotal };
  } catch {}
  try {
    checks.redis = await redisPing();
    // Existing health UI treats null as "N/A" rather than a failed service.
    if (checks.redis.ok === null) checks.redis = null;
  } catch { checks.redis = { ok: false }; }
  try {
    if (typeof (fs as any).statfsSync === 'function') {
      const stat = (fs as any).statfsSync('/');
      const total = stat.bsize * stat.blocks; const free = stat.bsize * stat.bfree;
      checks.disk = { ok: free/total > 0.05, total, free, usedPercent: +(((total-free)/total)*100).toFixed(2) };
    } else {
      checks.disk = { ok: null, note: 'statfs not available in this runtime' };
    }
  } catch { checks.disk = { ok: null, note: 'disk check unavailable' }; }
  const ok = checks.api.ok && checks.db.ok;
  // Keep the payload for the UI, but fail the HTTP status too so probes and
  // load balancers do not treat an unhealthy service as healthy.
  res.status(ok ? 200 : 503).json({ ok, checks });
}));

router.get('/diagnostics', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const [tables, subs, invoices, schedStatus, schedMetrics] = await Promise.all([
    pool.query(`SELECT relname as table, n_live_tup::bigint as rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC NULLS LAST LIMIT 50`).catch(()=>({ rows: [] as any[] })),
    pool.query(`SELECT status, COUNT(*)::int as count FROM subscribers GROUP BY status`).catch(()=>({ rows: [] as any[] })),
    pool.query(`SELECT status, COUNT(*)::int as count, COALESCE(SUM(due_amount),0)::numeric(12,2) as due FROM invoices GROUP BY status`).catch(()=>({ rows: [] as any[] })),
    getSchedulerStatus().catch(()=>({ jobs: [], backoff: [] })),
    getSchedulerMetrics().catch(()=>[]),
  ]);
  res.json({ ok: true, version: 'phase-6', uptime_sec: Math.floor(process.uptime()), tables: tables.rows, subscribers: subs.rows, invoices: invoices.rows, schedulers: { ...schedStatus, metrics: schedMetrics }, env: { node: process.version, platform: process.platform } });
}));

router.get('/backups', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const dir = backupsDir();
  const files = listBackupFiles(dir).map((f:any)=>({ name:f.name, size:f.size, created_at:f.created_at }));
  const cfg = getBackupConfig();
  const runs = await pool.query('SELECT * FROM backup_runs ORDER BY created_at DESC LIMIT 20').catch(()=>({rows:[]}));
  const last = runs.rows[0] || null;
  res.json({ ok: true, dir, files, runs: runs.rows, last_run: last, config: { enabled: cfg.enabled, schedule_hours: cfg.hours, retention_count: cfg.retentionCount, retention_days: cfg.retentionDays } });
}));

router.post('/backups/run', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const result = await runDbBackup('manual');
  if (!result.ok) { const fail: any = result; return res.status(500).json({ ok: false, message: fail.message, detail: fail.detail }); }
  res.json({ ok: true, backup: result.backup, retention: result.retention });
}));

router.get('/alerts', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const r = await pool.query('SELECT * FROM noc_alerts ORDER BY created_at DESC LIMIT $1', [limit]).catch(()=>({rows:[]}));
  const unread = await pool.query('SELECT COUNT(*)::int AS c FROM noc_alerts WHERE acknowledged=false').catch(()=>({rows:[{c:0}]}));
  res.json({ ok: true, data: r.rows, unread: unread.rows[0]?.c || 0 });
}));

router.post('/alerts/:id/ack', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const who = String((req as any).user?.email || (req as any).user?.id || 'admin');
  const r = await pool.query(
    `UPDATE noc_alerts SET acknowledged=true, acknowledged_at=now(), acknowledged_by=$2 WHERE id=$1 RETURNING *`,
    [req.params.id, who]
  ).catch(()=>({rows:[]}));
  if (!r.rows[0]) return res.status(404).json({ ok: false, message: 'Alert not found' });
  res.json({ ok: true, data: r.rows[0] });
}));

router.get('/billing-health', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(await getBillingHealth());
}));

router.get('/schedulers', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const [status, metrics, queues] = await Promise.all([
    getSchedulerStatus(),
    getSchedulerMetrics(),
    getQueuesOverview().catch(() => ({ active: false, queues: [] })),
  ]);
  res.json({ ok: true, ...status, metrics, queues });
}));

router.get('/queues', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const overview = await getQueuesOverview();
  res.json({ ok: true, redis_ready: isRedisReady(), ...overview });
}));

router.post('/queues/:name/retry', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = String(req.params.name || '').toLowerCase() as QueueName;
  if (!['billing', 'network', 'messaging', 'ops'].includes(name)) {
    return res.status(400).json({ ok: false, message: 'Unknown queue name' });
  }
  const out = await retryFailedJobs(name);
  res.json(out);
}));

router.get('/migrations', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = await getMigrationStatus();
  res.json({ ok: true, data: rows });
}));

router.get('/security-status', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const s = getSecurityStatus();
  res.json({ ok: true, status: s });
}));

/**
 * Re-encrypt stored secrets under the active SECRETS_ENCRYPTION key.
 *
 * Rotation procedure: add the new key to SECRETS_ENCRYPTION_KEYS, set
 * SECRETS_ENCRYPTION_ACTIVE_KEY_ID to the new id, restart the API, then call
 * this endpoint (optionally with `{ "dry_run": true }` first). Keep the old
 * key in the ring until the response reports no errors.
 */
router.post('/rotate-secrets', asyncHandler(async (req, res) => {
  const user = (req as any).user;
  if (!user || String(user.role) !== 'SUPER_ADMIN') {
    return res.status(403).json({ ok: false, message: 'Secret rotation requires SUPER_ADMIN' });
  }
  if (!await stepUpSatisfied(req, user)) {
    return res.status(403).json({ ok: false, message: 'MFA step-up required to rotate secrets', step_up_required: true });
  }
  if (!isSecretsEncryptionConfigured()) {
    return res.status(400).json({ ok: false, message: 'SECRETS_ENCRYPTION_KEYS is not configured; refusing to rotate with the demo key' });
  }
  if (!isActiveSecretKeyAvailable()) {
    return res.status(400).json({ ok: false, message: 'SECRETS_ENCRYPTION_ACTIVE_KEY_ID is not present in SECRETS_ENCRYPTION_KEYS' });
  }

  const dryRun = req.body?.dry_run === true || String(req.body?.dry_run) === 'true';
  const includeKyc = req.body?.include_kyc !== false && String(req.body?.include_kyc) !== 'false';

  const report = await rotateStoredSecrets({ dryRun });
  let kyc: { encrypted: number; reencrypted: number } | null = null;

  if (includeKyc && !dryRun) {
    try {
      kyc = await migrateKycFileEncryption();
    } catch (e: any) {
      report.errors.push({ table: 'kyc_documents', message: String(e?.message || e).slice(0, 300) });
    }
  }

  await auditLog({
    ...reqActor(req),
    action: dryRun ? 'SECRETS_ROTATE_DRY_RUN' : 'SECRETS_ROTATE',
    entity_type: 'security',
    details: {
      active_key_id: getActiveSecretKeyId(),
      dry_run: dryRun,
      include_kyc: includeKyc,
      rotated: report.rotated,
      errors: report.errors,
      kyc,
    },
  });

  res.json({
    ok: report.errors.length === 0,
    active_key_id: report.active_key_id,
    dry_run: dryRun,
    rotated: report.rotated,
    errors: report.errors,
    kyc,
  });
}));

export default router;
