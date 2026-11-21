'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { RefreshCw, ScrollText, MapPin, Plus, Download } from 'lucide-react';

function money(v:any){ const n=Number(v||0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function AuditPage() {
  const { token, user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const [entityFilter, setEntityFilter] = useState('');
  const canManage = ['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'].includes(String(user?.role));
  const [act, setAct] = useState<any>({ activity_type:'COLLECTION', employee_id:'', status:'PLANNED', amount:'', notes:'', scheduled_at:'' });

  const load = useCallback(async () => {
    if(!token) return; setLoading(true); setErr(null);
    const auditPath = entityFilter ? `/api/audit?entity_type=${encodeURIComponent(entityFilter)}` : '/api/audit';
    try {
      const [l,a,e] = await Promise.all([
        apiFetch<any>(auditPath, {}, token),
        apiFetch<any>('/api/audit/field-activities', {}, token),
        apiFetch<any>('/api/hr/employees', {}, token).catch(()=>({data:[]})),
      ]);
      setLogs(l.data||[]); setActivities(a.data||[]); setEmployees(e.data||[]);
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token, entityFilter]);
  useEffect(()=>{ load(); }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setEntityFilter(new URLSearchParams(window.location.search).get('entity_type') || '');
  }, []);

  const applyFilter = (value: string) => {
    setEntityFilter(value);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('entity_type', value);
    else url.searchParams.delete('entity_type');
    window.history.replaceState({}, '', url);
  };

  const addActivity = async () => {
    if(!token) return; setErr(null); setMsg(null);
    try {
      await apiFetch('/api/audit/field-activities', { method:'POST', body: JSON.stringify({ ...act, employee_id: act.employee_id||null, amount: act.amount===''?null:Number(act.amount), scheduled_at: act.scheduled_at||null }) }, token);
      setMsg('Field activity created'); setAct({ activity_type:'COLLECTION', employee_id:'', status:'PLANNED', amount:'', notes:'', scheduled_at:'' }); await load();
    } catch(e:any){ setErr(e.message); }
  };
  const markDone = async (id:string) => { if(!token) return; try { await apiFetch(`/api/audit/field-activities/${id}`, { method:'PUT', body: JSON.stringify({ status:'DONE' }) }, token); await load(); } catch(e:any){ setErr(e.message);} };

  const exportCsv = async () => {
    if (!token) return;
    try {
      const query = entityFilter ? `?entity_type=${encodeURIComponent(entityFilter)}` : '';
      const res = await fetch(`${getApiBaseUrl()}/api/audit/export.csv${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `Export failed: ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `izandesk-audit${entityFilter ? `-${entityFilter}` : ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e?.message || 'Export failed'); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div><span className="page-eyebrow">Governance · Audit &amp; field operations</span><h1 className="page-title"><ScrollText className="w-6 h-6 text-primary"/>Audit &amp; Field Ops</h1><p className="page-subtitle">Audit trail, compliance visibility, and field/agent activity workflows (Phase 7).</p></div>
        <div className="page-actions">
          <button onClick={() => void exportCsv()} disabled={!canManage} className="btn btn-outline" data-testid="audit-export"><Download className="w-4 h-4"/>Export CSV</button>
          <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
        </div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="card p-4">
            <h2 className="card-title mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary"/>Field / Agent Activities</h2>
            <div className="table-wrap overflow-auto max-h-[360px]">
              <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Employee</th><th className="px-3 py-2.5">Subscriber</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Amount</th><th className="px-3 py-2.5">Action</th></tr></thead>
                <tbody>{activities.map(a=>(<tr key={a.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] font-medium">{a.activity_type}</td><td className="px-3 py-2.5 text-[11px]">{a.employee_name||'-'}</td><td className="px-3 py-2.5 text-[11px]">{a.subscriber_name||a.client_code||'-'}</td><td className="px-3 py-2.5 text-[11px]">{a.status}</td><td className="px-3 py-2.5 text-[11px] tabular-nums">{a.amount!=null?money(a.amount):'-'}</td><td className="px-3 py-2.5 text-[11px]">{canManage && a.status!=='DONE' && <button onClick={()=>markDone(a.id)} className="btn btn-primary btn-sm">Done</button>}</td></tr>))}{!activities.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No field activities.</td></tr>}</tbody>
              </table>
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-bold">Audit Logs</h2>
              <div className="toolbar">
                <button onClick={() => applyFilter('')} className={`filter-chip ${!entityFilter ? 'active' : ''}`}>All events</button>
                <button onClick={() => applyFilter('mcp')} className={`filter-chip ${entityFilter === 'mcp' ? 'active' : ''}`}>MCP</button>
                <button onClick={() => applyFilter('settings')} className={`filter-chip ${entityFilter === 'settings' ? 'active' : ''}`}>Settings</button>
              </div>
            </div>
            <div className="table-wrap overflow-auto max-h-[360px]">
              <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Time</th><th className="px-3 py-2.5">Actor</th><th className="px-3 py-2.5">Action</th><th className="px-3 py-2.5">Entity</th><th className="px-3 py-2.5">Details</th></tr></thead>
                <tbody>{logs.map(l=>(<tr key={l.id} className="border-b border-border/50 align-top"><td className="px-3 py-2.5 text-[11px] whitespace-nowrap text-muted-foreground">{l.created_at?new Date(l.created_at).toLocaleString():'-'}</td><td className="px-3 py-2.5 text-[11px]">{l.actor_name||l.actor_id||'-'}<div className="text-muted-foreground">{l.actor_role||''}</div></td><td className="px-3 py-2.5 text-[11px] font-medium">{l.action}</td><td className="px-3 py-2.5 text-[11px]">{l.entity_type||'-'}<div className="text-muted-foreground font-mono">{l.entity_id||''}</div></td><td className="px-3 py-2.5 text-[11px] text-muted-foreground max-w-[320px] truncate" title={typeof l.details==='string'?l.details:JSON.stringify(l.details)}>{typeof l.details==='string'?l.details:JSON.stringify(l.details)}</td></tr>))}{!logs.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No audit logs yet. (Logs can be posted via /api/audit)</td></tr>}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="card-title"><Plus className="w-4 h-4 text-primary"/>Create Field Activity</h2>
          <div className="space-y-2 text-sm">
            <select className="form-select" value={act.activity_type} onChange={e=>setAct({...act,activity_type:e.target.value})}>{['COLLECTION','VISIT','INSTALLATION','SUPPORT','TICKET'].map(x=><option key={x} value={x}>{x}</option>)}</select>
            <select className="form-select" value={act.employee_id} onChange={e=>setAct({...act,employee_id:e.target.value})}><option value="">Assign employee (optional)</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}</select>
            <select className="form-select" value={act.status} onChange={e=>setAct({...act,status:e.target.value})}>{['PLANNED','IN_PROGRESS','DONE','CANCELLED'].map(x=><option key={x} value={x}>{x}</option>)}</select>
            <input type="datetime-local" className="form-control" value={act.scheduled_at} onChange={e=>setAct({...act,scheduled_at:e.target.value})} />
            <input type="number" placeholder="Amount (for collection)" className="form-control" value={act.amount} onChange={e=>setAct({...act,amount:e.target.value})} />
            <textarea placeholder="Notes / proof reference" className="form-control min-h-[90px]" value={act.notes} onChange={e=>setAct({...act,notes:e.target.value})} />
          </div>
          <button onClick={addActivity} disabled={!canManage} className="btn btn-primary w-full">Create Activity</button>
          <div className="text-xs text-muted-foreground">Use for collector/technician workflows, visits, and proof-of-collection tracking. Extend with GPS capture and mobile UI as needed.</div>
        </div>
      </div>
    </div>
  );
}
