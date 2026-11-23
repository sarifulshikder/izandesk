'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { RefreshCw, Database, Server, HardDrive, Activity, ShieldCheck, Clock, Gauge, Play } from 'lucide-react';

export default function SystemHealthPage() {
  const { token } = useAuth();
  const [health, setHealth] = useState<any>(null);
  const [diag, setDiag] = useState<any>(null);
  const [backups, setBackups] = useState<any>(null);
  const [fupLogs, setFupLogs] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [msg, setMsg] = useState<string|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [fupBusy, setFupBusy] = useState(false);

  const load = async () => {
    if (!token) return;
    setErr(null);
    try {
      const h = await fetch(`${getApiBaseUrl()}/api/system/health`).then(r=>r.json());
      setHealth(h);
      const [d,b,f,a] = await Promise.all([
        apiFetch<any>('/api/system/diagnostics', {}, token).catch(()=>null),
        apiFetch<any>('/api/system/backups', {}, token).catch(()=>null),
        apiFetch<any>('/api/billing/fup/logs', {}, token).catch(()=>({data:[]})),
        apiFetch<any>('/api/system/alerts?limit=20', {}, token).catch(()=>({data:[]})),
      ]);
      setDiag(d); setBackups(b); setFupLogs(f?.data || []); setAlerts(a?.data || []);
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

  const runFup = async () => {
    if (!token) return;
    setFupBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<any>('/api/billing/fup/evaluate', { method:'POST' }, token);
      setMsg(`FUP sweep: evaluated ${r.evaluated ?? 0}, applied ${r.applied ?? 0}, cleared ${r.cleared ?? 0}, skipped ${r.skipped ?? 0}`);
      await load();
    } catch(e:any){ setErr(e.message || 'FUP evaluation failed'); } finally { setFupBusy(false); }
  };

  const ackAlert = async (id: string) => {
    if (!token) return;
    try { await apiFetch(`/api/system/alerts/${id}/ack`, { method:'POST' }, token); await load(); }
    catch (e:any) { setErr(e.message || 'Failed to acknowledge alert'); }
  };

  const ok = (v:any) => v?.ok === true;
  const cfg = backups?.config;
  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div><span className="page-eyebrow">Operations · Diagnostics</span><h1 className="page-title">System Health &amp; Diagnostics</h1><p className="page-subtitle">Runtime health checks, diagnostics, backups, and FUP enforcement audit.</p></div>
        <div className="page-actions"><button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button></div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="stat-grid">
        <div className={`dash-stat ${ok(health) ? 'dash-stat-success' : 'dash-stat-danger'}`}><span className="dash-stat-icon"><Activity className="w-3.5 h-3.5"/></span><span className="dash-stat-body"><span className="dash-stat-label">Overall</span><span className="dash-stat-value text-base">{ok(health)?'Healthy':'Degraded'}</span></span></div>
        <div className={`dash-stat ${ok(health?.checks?.db)?'dash-stat-success':'dash-stat-danger'}`}><span className="dash-stat-icon"><Database className="w-3.5 h-3.5"/></span><span className="dash-stat-body"><span className="dash-stat-label">Database</span><span className="dash-stat-value text-base">{ok(health?.checks?.db)?'OK':'Error'}</span></span></div>
        <div className={`dash-stat ${ok(health?.checks?.redis)?'dash-stat-success':health?.checks?.redis==null?'dash-stat-secondary':'dash-stat-warning'}`}><span className="dash-stat-icon"><Server className="w-3.5 h-3.5"/></span><span className="dash-stat-body"><span className="dash-stat-label">Redis</span><span className="dash-stat-value text-base">{health?.checks?.redis==null?'N/A': ok(health?.checks?.redis)?'OK':'Unavailable'}</span></span></div>
        <div className={`dash-stat ${ok(health?.checks?.disk) || health?.checks?.disk?.ok===null ?'dash-stat-secondary':'dash-stat-warning'}`}><span className="dash-stat-icon"><HardDrive className="w-3.5 h-3.5"/></span><span className="dash-stat-body"><span className="dash-stat-label">Disk</span><span className="dash-stat-value text-base tabular-nums">{health?.checks?.disk?.usedPercent!=null?`${health.checks.disk.usedPercent}% used`:'N/A'}</span></span></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary"/>Diagnostics</h2>
          {!diag ? <div className="text-sm text-muted-foreground">Diagnostics require admin access.</div> : (
            <div className="space-y-3 text-sm">
              <div><b>Uptime:</b> {diag.uptime_sec}s • <b>Node:</b> {diag.env?.node} • <b>Platform:</b> {diag.env?.platform}</div>
              <div><div className="font-semibold mb-1">Subscribers by status</div><div className="flex flex-wrap gap-2">{(diag.subscribers||[]).map((r:any)=>(<span key={r.status} className="badge badge-secondary">{r.status}: {r.count}</span>))}</div></div>
              <div><div className="font-semibold mb-1">Invoices by status</div><div className="flex flex-wrap gap-2">{(diag.invoices||[]).map((r:any)=>(<span key={r.status} className="badge badge-secondary">{r.status}: {r.count} (due {Number(r.due||0).toFixed(2)})</span>))}</div></div>
            </div>
          )}
        </div>
        <div className="card p-4"><div className="flex items-center justify-between mb-3"><h2 className="font-bold flex items-center gap-2"><Database className="w-4 h-4 text-primary"/>Database Backups</h2><button onClick={runBackup} disabled={busy} className="btn btn-primary">{busy?'Running...':'Run Backup Now'}</button></div>
          {!backups ? <div className="text-sm text-muted-foreground">Backup management requires admin access. Backups require <code>pg_dump</code> availability and writable storage.</div> : (
            <div className="space-y-3">
              <div className="alert alert-primary text-xs space-y-1">
                <div className="flex items-center gap-2 font-medium"><Clock className="w-3.5 h-3.5"/>Schedule: <span className={cfg?.enabled?'badge badge-success':'badge badge-secondary'}>{cfg?.enabled ? `Enabled every ${cfg.schedule_hours}h` : 'Disabled'}</span></div>
                <div>Retention: keep last <b>{cfg?.retention_count ?? 0}</b> files and/or <b>{cfg?.retention_days ?? 0}</b> days (applied after runs).</div>
                <div className="text-muted-foreground">Configure via env: <code>BACKUP_SCHEDULE_ENABLED</code>, <code>BACKUP_SCHEDULE_HOURS</code>, <code>BACKUP_RETENTION_COUNT</code>, <code>BACKUP_RETENTION_DAYS</code>, <code>BACKUP_DIR</code>.</div>
              </div>
              <div className="space-y-2">{(backups.files||[]).slice(0,10).map((f:any)=>(<div key={f.name} className="p-2.5 rounded-xl border border-border bg-muted/20 flex items-center justify-between text-sm"><div><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()}</div></div><div className="text-xs text-muted-foreground tabular-nums">{(Number(f.size||0)/1024/1024).toFixed(2)} MB</div></div>))}{!(backups.files||[]).length && <div className="empty-panel"><span className="empty-panel-icon"><Database className="w-5 h-5"/></span><div><div className="text-sm font-semibold">No backups yet</div><p className="text-[11px] text-muted-foreground mt-1">Run a backup to create the first snapshot.</p></div></div>}</div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div><h2 className="font-bold flex items-center gap-2"><Gauge className="w-4 h-4 text-primary"/>FUP Enforcement &amp; Audit</h2><p className="text-xs text-muted-foreground mt-1">Monthly cap/FUP evaluation (RADIUS CoA/rate-limit and best-effort direct PPPoE profile throttling). Billing restrictions take precedence.</p></div>
          <button onClick={runFup} disabled={fupBusy} className="btn btn-primary"><Play className="w-4 h-4"/>{fupBusy?'Running...':'Run FUP Sweep'}</button>
        </div>
        <div className="space-y-2 max-h-[360px] overflow-auto">
          {fupLogs.map((l:any)=>(
            <div key={l.id} className="p-3 rounded-xl border border-border bg-muted/20 text-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div className="font-medium">{l.client_code || '-'} — {l.full_name || l.username || l.subscriber_id || 'Subscriber'} <span className="text-xs text-muted-foreground">({l.package_name || '-'})</span></div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${l.action==='APPLIED'?'badge-warning':'badge-success'}`}>{l.action}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{l.created_at ? new Date(l.created_at).toLocaleString() : ''}</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                Used {Number(l.used_bytes||0) > 1e9 ? (Number(l.used_bytes)/1e9).toFixed(2)+' GB' : Number(l.used_bytes||0) > 1e6 ? (Number(l.used_bytes)/1e6).toFixed(2)+' MB' : `${Number(l.used_bytes||0)} B`}
                {l.cap_gb!=null ? ` / ${Number(l.cap_gb)} GB` : ''}{l.fup_speed_mbps!=null ? ` • FUP ${l.fup_speed_mbps} Mbps` : ''} • over_cap: {String(!!l.over_cap)}
              </div>
              {l.details && <div className="text-[11px] text-muted-foreground mt-1">RADIUS sync: {String(l.details.radius_sync_ok)} • CoA: {String(l.details.coa_ok)} • Router PPPoE: {String(l.details.router_ok)} {l.details.rate_limit ? `• rate ${l.details.rate_limit}` : ''}</div>}
            </div>
          ))}
          {!fupLogs.length && <div className="empty-panel"><span className="empty-panel-icon"><Gauge className="w-5 h-5"/></span><div><div className="text-sm font-semibold">No FUP actions logged</div><p className="text-[11px] text-muted-foreground mt-1">Transitions appear when caps are applied/cleared.</p></div></div>}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3"><h2 className="font-bold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary"/>NOC Alerts / Notification Feed</h2><span className="text-xs text-muted-foreground">{alerts.filter((a:any)=>!a.acknowledged).length} unread</span></div>
        <div className="space-y-2 max-h-[320px] overflow-auto">
          {alerts.map((a:any) => (
            <div key={a.id} className="p-3 rounded-xl border border-border bg-muted/20 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{a.title} <span className={`badge ${a.severity==='CRITICAL'?'badge-danger':a.severity==='INFO'?'badge-secondary':'badge-warning'}`}>{a.severity}</span></div>
                  <div className="text-xs text-muted-foreground">{a.source} • {a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
                  {a.message && <div className="text-xs mt-1">{a.message}</div>}
                </div>
                {!a.acknowledged ? <button onClick={()=>ackAlert(a.id)} className="btn btn-ghost btn-sm">Ack</button> : <span className="text-xs text-muted-foreground">Acked</span>}
              </div>
            </div>
          ))}
          {!alerts.length && <div className="empty-panel"><span className="empty-panel-icon"><ShieldCheck className="w-5 h-5"/></span><div><div className="text-sm font-semibold">No alerts</div><p className="text-[11px] text-muted-foreground mt-1">NOC alerts will appear here when emitted.</p></div></div>}
        </div>
      </div>

      <div className="card p-4"><h2 className="font-bold mb-2">Raw Health Payload</h2><pre className="mono text-xs overflow-auto max-h-[280px] p-3 rounded-xl bg-muted/30 border border-border">{JSON.stringify(health, null, 2)}</pre></div>
    </div>
  );
}
