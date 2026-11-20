'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plus, Ticket, UserCog, MapPin, Navigation, Clock, MessageSquare, CheckCircle2, AlertTriangle, Phone } from 'lucide-react';

type AnyObj = Record<string, any>;
const fmt = (d:any) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

export default function TicketsPage() {
  const { token, user } = useAuth();
  const [tickets, setTickets] = useState<AnyObj[]>([]);
  const [selected, setSelected] = useState<AnyObj|null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const [showNew, setShowNew] = useState(false);
  const [subscribers, setSubscribers] = useState<AnyObj[]>([]);
  const [form, setForm] = useState<any>({ subject:'', description:'', category:'SUPPORT', priority:'MEDIUM', subscriber_id:'', assigned_technician_name:'', assigned_technician_phone:'', site_address:'' });
  const [comment, setComment] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const [t, s] = await Promise.all([
        apiFetch<any>(`/api/tickets${statusFilter?`?status=${encodeURIComponent(statusFilter)}`:''}`, {}, token),
        apiFetch<any>('/api/subscribers?limit=200', {}, token).catch(()=>({data:[]})),
      ]);
      setTickets(t.data || []); setSubscribers(s.data || []);
      if (selected) {
        const d = await apiFetch<any>(`/api/tickets/${selected.id}`, {}, token).catch(()=>null);
        if (d?.data) setSelected(d.data);
      }
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token, statusFilter, selected?.id]);

  useEffect(()=>{ load(); }, [load]);

  const openDetail = async (id:string) => {
    if (!token) return;
    try { const d = await apiFetch<any>(`/api/tickets/${id}`, {}, token); setSelected(d.data); } catch(e:any){ setErr(e.message); }
  };

  const create = async () => {
    if (!token) return;
    try {
      await apiFetch('/api/tickets', { method:'POST', body: JSON.stringify(form) }, token);
      setShowNew(false); setForm({ subject:'', description:'', category:'SUPPORT', priority:'MEDIUM', subscriber_id:'', assigned_technician_name:'', assigned_technician_phone:'', site_address:'' });
      setMsg('Ticket created'); await load();
    } catch(e:any){ setErr(e.message); }
  };

  const update = async (id:string, patch:any) => {
    if (!token) return;
    try { await apiFetch(`/api/tickets/${id}`, { method:'PUT', body: JSON.stringify(patch) }, token); await openDetail(id); await load(); } catch(e:any){ setErr(e.message); }
  };

  const assign = async () => {
    if (!token || !selected) return;
    const name = prompt('Technician name', selected.assigned_technician_name || '');
    if (name == null) return;
    const phone = prompt('Technician phone (optional)', selected.assigned_technician_phone || '') || '';
    await update(selected.id, { assigned_technician_name: name, assigned_technician_phone: phone, dispatch_status: 'DISPATCHED', status: selected.status === 'OPEN' ? 'IN_PROGRESS' : selected.status });
  };

  const addComment = async () => {
    if (!token || !selected || !comment.trim()) return;
    try {
      await apiFetch(`/api/tickets/${selected.id}/comments`, { method:'POST', body: JSON.stringify({ body: comment }) }, token);
      setComment(''); await openDetail(selected.id);
    } catch(e:any){ setErr(e.message); }
  };

  const stats = useMemo(()=>{
    const open = tickets.filter(t=>['OPEN','IN_PROGRESS','DISPATCHED'].includes(String(t.status))).length;
    const breached = tickets.filter(t=>t.sla_breached).length;
    const resolved = tickets.filter(t=>['RESOLVED','CLOSED'].includes(String(t.status))).length;
    return { open, breached, resolved, total: tickets.length };
  }, [tickets]);

  const statusBadge = (s:string) => {
    const v = String(s||'').toUpperCase();
    if (v==='RESOLVED'||v==='CLOSED') return 'badge badge-success';
    if (v==='IN_PROGRESS'||v==='DISPATCHED') return 'badge badge-info';
    if (v==='OPEN') return 'badge badge-warning';
    return 'badge badge-secondary';
  };
  const priorityBadge = (p:string) => {
    const v = String(p||'').toUpperCase();
    if (v==='CRITICAL') return 'badge-danger';
    if (v==='HIGH') return 'badge-warning';
    if (v==='MEDIUM') return 'badge-info';
    return 'badge-secondary';
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Field operations · Service desk</span>
          <h1 className="page-title">CRM &amp; Trouble Tickets</h1>
          <p className="page-subtitle">SLA-driven ticketing, technician dispatch, GPS navigation and mobile-friendly resolution.</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={()=>setShowNew(true)} className="btn btn-primary"><Plus className="w-4 h-4"/>New Ticket</button>
        </div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dash-stat dash-stat-warning"><span className="dash-stat-icon"><Clock /></span><span className="dash-stat-body"><span className="dash-stat-label">Open / In Progress</span><span className="dash-stat-value">{stats.open}</span><span className="dash-stat-hint">active workload</span></span></div>
        <div className="dash-stat dash-stat-danger"><span className="dash-stat-icon"><AlertTriangle /></span><span className="dash-stat-body"><span className="dash-stat-label">SLA Breached</span><span className="dash-stat-value">{stats.breached}</span><span className="dash-stat-hint">needs escalation</span></span></div>
        <div className="dash-stat dash-stat-success"><span className="dash-stat-icon"><CheckCircle2 /></span><span className="dash-stat-body"><span className="dash-stat-label">Resolved / Closed</span><span className="dash-stat-value">{stats.resolved}</span><span className="dash-stat-hint">completed work</span></span></div>
        <div className="dash-stat dash-stat-primary"><span className="dash-stat-icon"><Ticket /></span><span className="dash-stat-body"><span className="dash-stat-label">Total Tickets</span><span className="dash-stat-value">{stats.total}</span><span className="dash-stat-hint">in this view</span></span></div>
      </div>

      <div className="toolbar-strip">
        {[['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['DISPATCHED', 'Dispatched'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']].map(([k, label]) => (
          <button key={k || 'all'} onClick={()=>setStatusFilter(k)} className={`filter-chip ${statusFilter === k ? 'active' : ''}`}>{label}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 card overflow-hidden">
          <div className="table-wrap overflow-auto max-h-[620px]">
            <table className="table table-hover min-w-[720px]">
              <thead className="sticky top-0 z-10"><tr><th className="text-left px-3 py-2.5">Ticket</th><th className="text-left px-3 py-2.5">Subscriber</th><th className="text-left px-3 py-2.5">SLA / Priority</th><th className="text-left px-3 py-2.5">Assigned</th><th className="text-left px-3 py-2.5">Status</th></tr></thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} className="border-t border-border/70 hover:bg-muted/30 cursor-pointer" onClick={()=>openDetail(t.id)}>
                    <td className="px-3 py-2.5"><div className="font-semibold font-mono text-[11px]">{t.ticket_no}</div><div className="text-[11px] text-muted-foreground truncate max-w-[230px]" title={t.subject}>{t.subject}</div><div className="text-[9.5px] text-muted-foreground">{t.category}</div></td>
                    <td className="px-3 py-2.5 text-[11px]"><div className="truncate max-w-[130px]">{t.subscriber_name || '-'}</div><div className="text-muted-foreground font-mono text-[9.5px]">{t.client_code || ''}</div></td>
                    <td className="px-3 py-2.5 text-[11px]"><div className="flex items-center gap-1.5"><span className={`badge ${priorityBadge(t.priority)}`}>{t.priority}</span>{t.sla_breached && <span className="badge badge-danger">BREACHED</span>}</div><div className={`text-[9.5px] mt-1 whitespace-nowrap ${t.sla_breached ? 'text-danger' : 'text-muted-foreground'}`}>Due {fmt(t.sla_due_at)}</div></td>
                    <td className="px-3 py-2.5 text-[11px]"><div className="truncate max-w-[130px]">{t.assigned_technician_name || 'Unassigned'}</div><div className="text-muted-foreground text-[9.5px]">{t.dispatch_status || ''}</div></td>
                    <td className="px-3 py-2.5"><span className={statusBadge(t.status)}>{t.status}</span></td>
                  </tr>
                ))}
                {!tickets.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{loading?'Loading tickets...':'No tickets found.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card overflow-hidden">
            {!selected ? <div className="p-4"><div className="empty-panel">
              <span className="empty-panel-icon"><Ticket className="w-5 h-5" /></span>
              <div>
                <div className="text-sm font-semibold text-foreground">No ticket selected</div>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-[270px] leading-relaxed">Open a ticket to assign a technician, navigate to the site and post resolution notes.</p>
              </div>
              <button onClick={()=>setShowNew(true)} className="btn btn-primary btn-sm"><Plus className="w-3.5 h-3.5" />New ticket</button>
            </div></div> : (
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{selected.ticket_no}</div>
                    <div className="text-sm">{selected.subject}</div>
                    <div className="flex flex-wrap gap-2 mt-1"><span className={statusBadge(selected.status)}>{selected.status}</span><span className="badge badge-outline">{selected.priority}</span>{selected.sla_breached && <span className="badge badge-danger">SLA BREACHED</span>}</div>
                  </div>
                </div>
                <div className="text-xs space-y-1 text-muted-foreground">
                  <div><b className="text-foreground">Subscriber:</b> {selected.subscriber_name || '-'} {selected.client_code ? `(${selected.client_code})` : ''} {selected.subscriber_phone ? `• ${selected.subscriber_phone}` : ''}</div>
                  <div><b className="text-foreground">SLA due:</b> <span className={selected.sla_breached?'text-danger':''}>{fmt(selected.sla_due_at)}</span></div>
                  <div><b className="text-foreground">Technician:</b> {selected.assigned_technician_name || 'Unassigned'} {selected.assigned_technician_phone ? `• ${selected.assigned_technician_phone}` : ''} ({selected.dispatch_status || 'UNASSIGNED'})</div>
                  <div><b className="text-foreground">Site:</b> {selected.site_address || 'No address'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={assign} className="btn btn-outline btn-sm"><UserCog className="w-3.5 h-3.5"/>Assign/Dispatch</button>
                  {selected.gps_nav_url && <a href={selected.gps_nav_url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm"><Navigation className="w-3.5 h-3.5"/>GPS Navigate</a>}
                  {selected.status !== 'RESOLVED' && selected.status !== 'CLOSED' && <button onClick={()=>update(selected.id,{status:'RESOLVED', resolution_notes: selected.resolution_notes || 'Resolved by technician', dispatch_status:'COMPLETED'})} className="btn btn-success btn-sm"><CheckCircle2 className="w-3.5 h-3.5"/>Mark Resolved</button>}
                </div>
                <div className="pt-2 border-t border-border">
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5"/>Comments / Activity</div>
                  <div className="space-y-2 max-h-[180px] overflow-auto mb-2">
                    {(selected.comments||[]).map((c:any)=>(
                      <div key={c.id} className="p-2 rounded-lg bg-muted/30 border border-border/60 text-xs"><div className="font-medium">{c.author_name} <span className="text-muted-foreground font-normal">({c.author_role||'user'}) • {fmt(c.created_at)}</span></div><div className="mt-0.5">{c.body}</div></div>
                    ))}
                    {!(selected.comments||[]).length && <div className="text-xs text-muted-foreground">No comments yet.</div>}
                  </div>
                  <div className="flex gap-2">
                    <input className="form-control flex-1" placeholder="Add comment/update..." value={comment} onChange={e=>setComment(e.target.value)} />
                    <button onClick={addComment} className="btn btn-primary btn-sm">Post</button>
                  </div>
                </div>
                <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground mb-1">Mobile field view</div>
                  <p>Technicians can open this ticket on mobile to view customer/site details, tap <b>GPS Navigate</b>, update status, and post resolution notes/comments.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="card w-full max-w-2xl my-8">
          <div className="card-header"><h2 className="card-title">Create Ticket</h2><button onClick={()=>setShowNew(false)} className="btn btn-ghost btn-icon">✕</button></div>
          <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="md:col-span-2"><div className="form-label">Subject</div><input className="form-control" value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} /></label>
            <label><div className="form-label">Category</div><select className="form-select" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{['SUPPORT','INSTALLATION','OUTAGE','BILLING','NETWORK','OTHER'].map(x=><option key={x}>{x}</option>)}</select></label>
            <label><div className="form-label">Priority (SLA)</div><select className="form-select" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{['LOW','MEDIUM','HIGH','CRITICAL'].map(x=><option key={x}>{x}</option>)}</select></label>
            <label className="md:col-span-2"><div className="form-label">Subscriber (optional)</div><select className="form-select" value={form.subscriber_id} onChange={e=>setForm({...form,subscriber_id:e.target.value})}><option value="">None</option>{subscribers.map(s=><option key={s.id} value={s.id}>{s.client_code||''} — {s.full_name} ({s.username||''})</option>)}</select></label>
            <label><div className="form-label">Assign Technician</div><input className="form-control" value={form.assigned_technician_name} onChange={e=>setForm({...form,assigned_technician_name:e.target.value})} placeholder="Name (auto-dispatch if set)" /></label>
            <label><div className="form-label">Technician Phone</div><input className="form-control" value={form.assigned_technician_phone} onChange={e=>setForm({...form,assigned_technician_phone:e.target.value})} /></label>
            <label className="md:col-span-2"><div className="form-label">Site Address</div><input className="form-control" value={form.site_address} onChange={e=>setForm({...form,site_address:e.target.value})} placeholder="Auto-filled from subscriber if selected" /></label>
            <label className="md:col-span-2"><div className="form-label">Description</div><textarea className="form-control min-h-[100px]" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></label>
          </div>
          <div className="card-footer flex justify-end gap-2"><button onClick={()=>setShowNew(false)} className="btn btn-outline">Cancel</button><button onClick={create} className="btn btn-primary">Create Ticket</button></div>
        </div></div>
      )}
    </div>
  );
}
