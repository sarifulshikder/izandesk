'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { RefreshCw, Database, Server, HardDrive, Activity, ShieldCheck, Clock } from 'lucide-react';

export default function SystemHealthPage() {
  const { token } = useAuth();
  const [health, setHealth] = useState<any>(null);
  const [diag, setDiag] = useState<any>(null);
  const [backups, setBackups] = useState<any>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!token) return;
    setErr(null);
    try {
      const h = await fetch(`${getApiBaseUrl()}/api/system/health`).then(r=>r.json());
      setHealth(h);
      const [d,b] = await Promise.all([
        apiFetch<any>('/api/system/diagnostics', {}, token).catch(()=>null),
        apiFetch<any>('/api/system/backups', {}, token).catch(()=>null),
      ]);
      setDiag(d); setBackups(b);
    } catch(e:any){ setErr(e.message); }
  };
  useEffect(()=>{ load(); }, [token]);

  const runBackup = async () => {
    if (!token) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<any>('/api/system/backups/run', { method:'POST' }, token);
      const pruned = r.retention?.deleted ? ` (pruned ${r.retention.deleted})` : '';
      setMsg(`Backup created: ${r.backup?.name}${pruned}`);
      await load();
    } catch(e:any){ setErr(e.message || 'Backup failed'); } finally { setBusy(false); }
  };

  const ok = (v:any) => v?.ok === true;
  const cfg = backups?.config;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black tracking-tight">System Health & Diagnostics</h1><p className="text-sm text-muted-foreground">Runtime health checks, diagnostics, and database backups (manual, scheduled, retention).</p></div>
        <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`p-4 rounded-2xl border ${ok(health) ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}><div className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="w-3.5 h-3.5"/>Overall</div><div className="text-xl font-black mt-1">{ok(health)?'Healthy':'Degraded'}</div></div>
        <div className={`p-4 rounded-2xl border ${ok(health?.checks?.db)?'border-emerald-500/20 bg-emerald-500/5':'border-red-500/20 bg-red-500/5'}`}><div className="text-xs text-muted-foreground flex items-center gap-1"><Database className="w-3.5 h-3.5"/>Database</div><div className="text-xl font-black mt-1">{ok(health?.checks?.db)?'OK':'Error'}</div></div>
        <div className={`p-4 rounded-2xl border ${ok(health?.checks?.redis)?'border-emerald-500/20 bg-emerald-500/5':'border-amber-500/20 bg-amber-500/5'}`}><div className="text-xs text-muted-foreground flex items-center gap-1"><Server className="w-3.5 h-3.5"/>Redis</div><div className="text-xl font-black mt-1">{health?.checks?.redis==null?'N/A': ok(health?.checks?.redis)?'OK':'Unavailable'}</div></div>
        <div className={`p-4 rounded-2xl border ${ok(health?.checks?.disk) || health?.checks?.disk?.ok===null ?'border-border bg-card':'border-amber-500/20 bg-amber-500/5'}`}><div className="text-xs text-muted-foreground flex items-center gap-1"><HardDrive className="w-3.5 h-3.5"/>Disk</div><div className="text-xl font-black mt-1">{health?.checks?.disk?.usedPercent!=null?`${health.checks.disk.usedPercent}% used`:'N/A'}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary"/>Diagnostics</h2>
          {!diag ? <div className="text-sm text-muted-foreground">Diagnostics require admin access.</div> : (
            <div className="space-y-3 text-sm">
              <div><b>Uptime:</b> {diag.uptime_sec}s • <b>Node:</b> {diag.env?.node} • <b>Platform:</b> {diag.env?.platform}</div>
              <div><div className="font-semibold mb-1">Subscribers by status</div><div className="flex flex-wrap gap-2">{(diag.subscribers||[]).map((r:any)=>(<span key={r.status} className="px-2 py-1 rounded-lg border border-border bg-muted/30 text-xs">{r.status}: {r.count}</span>))}</div></div>
              <div><div className="font-semibold mb-1">Invoices by status</div><div className="flex flex-wrap gap-2">{(diag.invoices||[]).map((r:any)=>(<span key={r.status} className="px-2 py-1 rounded-lg border border-border bg-muted/30 text-xs">{r.status}: {r.count} (due {Number(r.due||0).toFixed(2)})</span>))}</div></div>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between mb-3"><h2 className="font-bold flex items-center gap-2"><Database className="w-4 h-4 text-primary"/>Database Backups</h2><button onClick={runBackup} disabled={busy} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">{busy?'Running...':'Run Backup Now'}</button></div>
          {!backups ? <div className="text-sm text-muted-foreground">Backup management requires admin access. Backups require <code>pg_dump</code> availability and writable storage.</div> : (
            <div className="space-y-3">
              <div className="text-xs p-3 rounded-xl border border-border bg-muted/20 space-y-1">
                <div className="flex items-center gap-2 font-medium"><Clock className="w-3.5 h-3.5"/>Schedule: <span className={cfg?.enabled?'text-emerald-400':'text-muted-foreground'}>{cfg?.enabled ? `Enabled every ${cfg.schedule_hours}h` : 'Disabled'}</span></div>
                <div>Retention: keep last <b>{cfg?.retention_count ?? 0}</b> files and/or <b>{cfg?.retention_days ?? 0}</b> days (applied after runs).</div>
                <div className="text-muted-foreground">Configure via env: <code>BACKUP_SCHEDULE_ENABLED</code>, <code>BACKUP_SCHEDULE_HOURS</code>, <code>BACKUP_RETENTION_COUNT</code>, <code>BACKUP_RETENTION_DAYS</code>, <code>BACKUP_DIR</code>.</div>
              </div>
              <div className="space-y-2">{(backups.files||[]).slice(0,10).map((f:any)=>(<div key={f.name} className="p-2.5 rounded-xl border border-border bg-muted/20 flex items-center justify-between text-sm"><div><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()}</div></div><div className="text-xs text-muted-foreground">{(Number(f.size||0)/1024/1024).toFixed(2)} MB</div></div>))}{!(backups.files||[]).length && <div className="text-sm text-muted-foreground">No backups yet.</div>}</div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4"><h2 className="font-bold mb-2">Raw Health Payload</h2><pre className="text-xs overflow-auto max-h-[280px] p-3 rounded-xl bg-muted/30 border border-border">{JSON.stringify(health, null, 2)}</pre></div>
    </div>
  );
}
