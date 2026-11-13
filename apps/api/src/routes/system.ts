import { Router } from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
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

router.get('/health', asyncHandler(async (_req, res) => {
  const checks: any = { api: { ok: true }, db: { ok: false }, redis: { ok: null }, disk: { ok: null }, memory: { ok: true }, time: new Date().toISOString() };
  try { await pool.query('SELECT 1'); checks.db = { ok: true }; } catch (e:any) { checks.db = { ok: false, error: e.message }; }
  try {
    const mu = process.memoryUsage();
    checks.memory = { ok: true, rss: mu.rss, heapUsed: mu.heapUsed, heapTotal: mu.heapTotal };
  } catch {}
  try {
    // best-effort redis ping via redis-cli if available
    const r = await run('redis-cli', ['-h', process.env.REDIS_HOST || '127.0.0.1', 'ping']);
    checks.redis = r.stdout.trim() === 'PONG' ? { ok: true } : { ok: false, detail: r.stderr || r.stdout };
  } catch (e:any) { checks.redis = { ok: false, error: e.message }; }
  try {
    const statfs = (fs as any).statfsSync || (fs as any).statfs;
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
  const dir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir).filter(f=>/\.sql(\.gz)?$/.test(f)).map(f=>{ const st=fs.statSync(path.join(dir,f)); return { name:f, size: st.size, created_at: st.mtime }; }).sort((a:any,b:any)=>b.created_at-a.created_at);
  res.json({ ok: true, dir, files });
}));

router.post('/backups/run', asyncHandler(async (req, res) => {
  if (!requireAdmin(req,res)) return;
  const dir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  const file = path.join(dir, `izandesk-${ts}.sql`);
  const dbUrl = process.env.DATABASE_URL || `postgresql://${process.env.PGUSER||'izandesk_user'}:${process.env.PGPASSWORD||'izandesk_secret_password'}@${process.env.PGHOST||'localhost'}:${process.env.PGPORT||'5432'}/${process.env.PGDATABASE||'izandesk'}`;
  // best-effort: pg_dump must be available in environment
  const r = await run('pg_dump', [dbUrl, '-f', file], 120000);
  if (!r.ok) return res.status(500).json({ ok: false, message: 'Backup failed (pg_dump unavailable or DB unreachable)', detail: r.stderr.slice(0,500) });
  const st = fs.statSync(file);
  res.json({ ok: true, backup: { name: path.basename(file), size: st.size, path: file } });
}));

export default router;
