import { Router } from 'express';
import { execFile } from 'child_process';
import fs = require('fs');
import path = require('path');
import { pool } from '../db';
import { asyncHandler } from './helpers';

const router: Router = Router();
function requireAdmin(req:any,res:any){ if (!['SUPER_ADMIN','NOC_ENGINEER'].includes(String(req.user?.role))) { res.status(403).json({ message: 'Forbidden' }); return false; } return true; }

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

export async function runDbBackup(trigger: 'manual'|'scheduled' = 'manual') {
  const dir = backupsDir();
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  const file = path.join(dir, `izandesk-${ts}.sql`);
  const dbUrl = process.env.DATABASE_URL || `postgresql://${process.env.PGUSER||'izandesk_user'}:${process.env.PGPASSWORD||'izandesk_secret_password'}@${process.env.PGHOST||'localhost'}:${process.env.PGPORT||'5432'}/${process.env.PGDATABASE||'izandesk'}`;
  const r = await run('pg_dump', [dbUrl, '-f', file], 120000);
  if (!r.ok) {
    try { if (fs.existsSync(file) && fs.statSync(file).size === 0) fs.unlinkSync(file); } catch {}
    return { ok: false, trigger, message: 'Backup failed (pg_dump unavailable or DB unreachable)', detail: String(r.stderr||'').slice(0,500) };
  }
  const st = fs.statSync(file);
  const retention = applyBackupRetention();
  return { ok: true, trigger, backup: { name: path.basename(file), size: st.size, path: file, created_at: st.mtime }, retention };
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
  const cfg = getBackupConfig();
  if (!cfg.enabled) { console.log('[BackupScheduler] disabled (set BACKUP_SCHEDULE_ENABLED=true to enable)'); return; }
  const intervalMs = cfg.hours * 3600 * 1000;
  console.log(`[BackupScheduler] enabled every ${cfg.hours}h, retention ${cfg.retentionCount} files / ${cfg.retentionDays} days`);
  const runOnce = async () => {
    try {
      if (!(await tryAcquireBackupLock(Math.max(10, Math.min(55, cfg.hours*60 - 5))))) return;
      const res = await runDbBackup('scheduled');
      if (res.ok) console.log(`[BackupScheduler] backup ok: ${res.backup?.name} (${res.backup?.size} bytes), pruned=${res.retention?.deleted}`);
      else console.error('[BackupScheduler] backup failed:', res.message, res.detail || '');
    } catch (e:any) { console.error('[BackupScheduler] error', e.message); }
  };
  setTimeout(runOnce, 60 * 1000);
  setInterval(runOnce, intervalMs);
}

router.get('/health', asyncHandler(async (_req, res) => {
  const checks: any = { api: { ok: true }, db: { ok: false }, redis: { ok: null }, disk: { ok: null }, memory: { ok: true }, time: new Date().toISOString() };
  try { await pool.query('SELECT 1'); checks.db = { ok: true }; } catch (e:any) { checks.db = { ok: false, error: e.message }; }
  try {
    const mu = process.memoryUsage();
    checks.memory = { ok: true, rss: mu.rss, heapUsed: mu.heapUsed, heapTotal: mu.heapTotal };
  } catch {}
  try {
    const r = await run('redis-cli', ['-h', process.env.REDIS_HOST || '127.0.0.1', 'ping']);
    checks.redis = r.stdout.trim() === 'PONG' ? { ok: true } : { ok: false, detail: r.stderr || r.stdout };
  } catch (e:any) { checks.redis = { ok: false, error: e.message }; }
  try {
    if (typeof (fs as any).statfsSync === 'function') {
      const stat = (fs as any).statfsSync('/');
      const total = stat.bsize * stat.blocks; const free = stat.bsize * stat.bfree;
      checks.disk = { ok: free/total > 0.05, total, free, usedPercent: +(((total-free)/total)*100).toFixed(2) };
    } else {
      checks.disk = { ok: null, note: 'statfs not available in this runtime' };
    }
  } catch (e:any) { checks.disk = { ok: null, note: e.message }; }
  const ok = checks.api.ok && checks.db.ok;
  res.json({ ok, checks });
}));

router.get('/diagnostics', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const tables = await pool.query(`SELECT relname as table, n_live_tup::bigint as rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC NULLS LAST LIMIT 50`).catch(()=>({ rows: [] as any[] }));
  const subs = await pool.query(`SELECT status, COUNT(*)::int as count FROM subscribers GROUP BY status`).catch(()=>({ rows: [] as any[] }));
  const invoices = await pool.query(`SELECT status, COUNT(*)::int as count, COALESCE(SUM(due_amount),0)::numeric(12,2) as due FROM invoices GROUP BY status`).catch(()=>({ rows: [] as any[] }));
  res.json({ ok: true, version: 'phase-6', uptime_sec: Math.floor(process.uptime()), tables: tables.rows, subscribers: subs.rows, invoices: invoices.rows, env: { node: process.version, platform: process.platform } });
}));

router.get('/backups', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const dir = backupsDir();
  const files = listBackupFiles(dir).map((f:any)=>({ name:f.name, size:f.size, created_at:f.created_at }));
  const cfg = getBackupConfig();
  res.json({ ok: true, dir, files, config: { enabled: cfg.enabled, schedule_hours: cfg.hours, retention_count: cfg.retentionCount, retention_days: cfg.retentionDays } });
}));

router.post('/backups/run', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const result = await runDbBackup('manual');
  if (!result.ok) return res.status(500).json({ ok: false, message: result.message, detail: result.detail });
  res.json({ ok: true, backup: result.backup, retention: result.retention });
}));

export default router;
