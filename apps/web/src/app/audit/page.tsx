'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, ScrollText, MapPin, Plus } from 'lucide-react';

function money(v:any){ const n=Number(v||0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function AuditPage() {
  const { token, user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const canManage = ['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'].includes(String(user?.role));
  const [act, setAct] = useState<any>({ activity_type:'COLLECTION', employee_id:'', status:'PLANNED', amount:'', notes:'', scheduled_at:'' });

  const load = useCallback(async () => {
    if(!token) return; setLoading(true); setErr(null);
    try {
      const [l,a,e] = await Promise.all([
        apiFetch<any>('/api/audit', {}, token),
        apiFetch<any>('/api/audit/field-activities', {}, token),
        apiFetch<any>('/api/hr/employees', {}, token).catch(()=>({data:[]})),
      ]);
      setLogs(l.data||[]); setActivities(a.data||[]); setEmployees(e.data||[]);
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(()=>{ load(); }, [load]);

  const addActivity = async () => {
    if(!token) return; setErr(null); setMsg(null);
    try {
      await apiFetch('/api/audit/field-activities', { method:'POST', body: JSON.stringify({ ...act, employee_id: act.employee_id||null, amount: act.amount===''?null:Number(act.amount), scheduled_at: act.scheduled_at||null }) }, token);
      setMsg('Field activity created'); setAct({ activity_type:'COLLECTION', employee_id:'', status:'PLANNED', amount:'', notes:'', scheduled_at:'' }); await load();
    } catch(e:any){ setErr(e.message); }
  };
  const markDone = async (id:string) => { if(!token) return; try { await apiFetch(`/api/audit/field-activities/${id}`, { method:'PUT', body: JSON.stringify({ status:'DONE' }) }, token); await load(); } catch(e:any){ setErr(e.message);} };

  return (
    <div className="space-y-5">
      <div className="page-header flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="page-title"><ScrollText className="w-6 h-6 text-primary"/>Audit & Field Ops</h1><p className="text-sm text-muted-foreground">Audit trail, compliance visibility, and field/agent activity workflows (Phase 7).</p></div>
        <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary"/>Field / Agent Activities</h2>
            <div className="table-wrap overflow-auto max-h-[360px]">
              <table className="table table-hover"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Employee</th><th className="text-left py-2 px-2">Subscriber</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Action</th></tr></thead>
                <tbody>{activities.map(a=>(<tr key={a.id} className="border-b border-border/50"><td className="py-2 px-2 font-medium">{a.activity_type}</td><td className="py-2 px-2">{a.employee_name||'-'}</td><td className="py-2 px-2">{a.subscriber_name||a.client_code||'-'}</td><td className="py-2 px-2">{a.status}</td><td className="py-2 px-2">{a.amount!=null?money(a.amount):'-'}</td><td className="py-2 px-2">{canManage && a.status!=='DONE' && <button onClick={()=>markDone(a.id)} className="btn btn-primary btn-sm">Done</button>}</td></tr>))}{!activities.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No field activities.</td></tr>}</tbody>
              </table>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-bold mb-3">Audit Logs</h2>
            <div className="table-wrap overflow-auto max-h-[360px]">
              <table className="table table-hover"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Actor</th><th className="text-left py-2 px-2">Action</th><th className="text-left py-2 px-2">Entity</th><th className="text-left py-2 px-2">Details</th></tr></thead>
                <tbody>{logs.map(l=>(<tr key={l.id} className="border-b border-border/50 align-top"><td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{l.created_at?new Date(l.created_at).toLocaleString():'-'}</td><td className="py-2 px-2">{l.actor_name||l.actor_id||'-'}<div className="text-muted-foreground">{l.actor_role||''}</div></td><td className="py-2 px-2 font-medium">{l.action}</td><td className="py-2 px-2">{l.entity_type||'-'}<div className="text-muted-foreground font-mono">{l.entity_id||''}</div></td><td className="py-2 px-2 text-muted-foreground max-w-[320px] truncate" title={typeof l.details==='string'?l.details:JSON.stringify(l.details)}>{typeof l.details==='string'?l.details:JSON.stringify(l.details)}</td></tr>))}{!logs.length && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No audit logs yet. (Logs can be posted via /api/audit)</td></tr>}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-primary"/>Create Field Activity</h2>
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
