'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plus, Ticket, UserCog, MapPin, Navigation, Clock, MessageSquare, CheckCircle2, AlertTriangle, Phone } from 'lucide-react';

type AnyObj = Record<string, any>;
const fmt = (d:any) => d ? new Date(d).toLocaleString() : '-';

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
    if (v==='RESOLVED'||v==='CLOSED') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (v==='IN_PROGRESS'||v==='DISPATCHED') return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    if (v==='OPEN') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-muted text-muted-foreground border-border';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">CRM & Trouble Tickets</h1>
          <p className="text-sm text-muted-foreground">SLA-driven ticketing, technician assignment/dispatch, GPS navigation, and mobile-friendly resolution workflow.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={()=>setShowNew(true)} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Plus className="w-4 h-4"/>New Ticket</button>
        </div>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Open/In Progress" value={stats.open} />
        <Stat label="SLA Breached" value={stats.breached} danger={stats.breached>0} />
        <Stat label="Resolved/Closed" value={stats.resolved} />
        <Stat label="Total Tickets" value={stats.total} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select className="p-2.5 rounded-xl border border-border bg-card text-sm" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {['OPEN','IN_PROGRESS','DISPATCHED','RESOLVED','CLOSED'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-auto max-h-[620px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-3">Ticket</th><th className="text-left px-4 py-3">Subscriber</th><th className="text-left px-4 py-3">SLA / Priority</th><th className="text-left px-4 py-3">Assigned</th><th className="text-left px-4 py-3">Status</th></tr></thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} className="border-t border-border/70 hover:bg-muted/30 cursor-pointer" onClick={()=>openDetail(t.id)}>
                    <td className="px-4 py-3"><div className="font-semibold">{t.ticket_no}</div><div className="text-xs text-muted-foreground">{t.subject}</div><div className="text-[11px] text-muted-foreground">{t.category}</div></td>
                    <td className="px-4 py-3 text-xs"><div>{t.subscriber_name || '-'}</div><div className="text-muted-foreground font-mono">{t.client_code || ''}</div></td>
                    <td className="px-4 py-3 text-xs"><div className="font-medium">{t.priority}</div><div className={t.sla_breached ? 'text-red-400' : 'text-muted-foreground'}>Due: {fmt(t.sla_due_at)} {t.sla_breached && '• BREACHED'}</div></td>
                    <td className="px-4 py-3 text-xs"><div>{t.assigned_technician_name || 'Unassigned'}</div><div className="text-muted-foreground">{t.dispatch_status || ''}</div></td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-1 rounded-full border font-semibold ${statusBadge(t.status)}`}>{t.status}</span></td>
                  </tr>
                ))}
                {!tickets.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{loading?'Loading tickets...':'No tickets found.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 min-h-[320px]">
            {!selected ? <div className="text-sm text-muted-foreground py-16 text-center">Select a ticket to view details, assign technician, navigate to site, and resolve.</div> : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{selected.ticket_no}</div>
                    <div className="text-sm">{selected.subject}</div>
                    <div className="flex flex-wrap gap-2 mt-1"><span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusBadge(selected.status)}`}>{selected.status}</span><span className="text-[11px] px-2 py-0.5 rounded-full border border-border">{selected.priority}</span>{selected.sla_breached && <span className="text-[11px] px-2 py-0.5 rounded-full border border-red-500/30 text-red-400">SLA BREACHED</span>}</div>
                  </div>
                </div>
                <div className="text-xs space-y-1 text-muted-foreground">
                  <div><b className="text-foreground">Subscriber:</b> {selected.subscriber_name || '-'} {selected.client_code ? `(${selected.client_code})` : ''} {selected.subscriber_phone ? `• ${selected.subscriber_phone}` : ''}</div>
                  <div><b className="text-foreground">SLA due:</b> <span className={selected.sla_breached?'text-red-400':''}>{fmt(selected.sla_due_at)}</span></div>
                  <div><b className="text-foreground">Technician:</b> {selected.assigned_technician_name || 'Unassigned'} {selected.assigned_technician_phone ? `• ${selected.assigned_technician_phone}` : ''} ({selected.dispatch_status || 'UNASSIGNED'})</div>
                  <div><b className="text-foreground">Site:</b> {selected.site_address || 'No address'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={assign} className="px-3 py-2 rounded-xl border border-border text-xs inline-flex items-center gap-1"><UserCog className="w-3.5 h-3.5"/>Assign/Dispatch</button>
                  {selected.gps_nav_url && <a href={selected.gps_nav_url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl border border-border text-xs inline-flex items-center gap-1"><Navigation className="w-3.5 h-3.5"/>GPS Navigate</a>}
                  {selected.status !== 'RESOLVED' && selected.status !== 'CLOSED' && <button onClick={()=>update(selected.id,{status:'RESOLVED', resolution_notes: selected.resolution_notes || 'Resolved by technician', dispatch_status:'COMPLETED'})} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/>Mark Resolved</button>}
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
                    <input className="flex-1 p-2 rounded-lg border border-border bg-card text-xs" placeholder="Add comment/update..." value={comment} onChange={e=>setComment(e.target.value)} />
                    <button onClick={addComment} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">Post</button>
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">Create Ticket</h2><button onClick={()=>setShowNew(false)} className="p-2 rounded-lg hover:bg-muted">✕</button></div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <label className="md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Subject</div><input className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} /></label>
            <label><div className="text-xs text-muted-foreground mb-1">Category</div><select className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{['SUPPORT','INSTALLATION','OUTAGE','BILLING','NETWORK','OTHER'].map(x=><option key={x}>{x}</option>)}</select></label>
            <label><div className="text-xs text-muted-foreground mb-1">Priority (SLA)</div><select className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{['LOW','MEDIUM','HIGH','CRITICAL'].map(x=><option key={x}>{x}</option>)}</select></label>
            <label className="md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Subscriber (optional)</div><select className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.subscriber_id} onChange={e=>setForm({...form,subscriber_id:e.target.value})}><option value="">None</option>{subscribers.map(s=><option key={s.id} value={s.id}>{s.client_code||''} — {s.full_name} ({s.username||''})</option>)}</select></label>
            <label><div className="text-xs text-muted-foreground mb-1">Assign Technician</div><input className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.assigned_technician_name} onChange={e=>setForm({...form,assigned_technician_name:e.target.value})} placeholder="Name (auto-dispatch if set)" /></label>
            <label><div className="text-xs text-muted-foreground mb-1">Technician Phone</div><input className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.assigned_technician_phone} onChange={e=>setForm({...form,assigned_technician_phone:e.target.value})} /></label>
            <label className="md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Site Address</div><input className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.site_address} onChange={e=>setForm({...form,site_address:e.target.value})} placeholder="Auto-filled from subscriber if selected" /></label>
            <label className="md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Description</div><textarea className="w-full p-2.5 rounded-xl border border-border bg-card min-h-[100px]" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></label>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setShowNew(false)} className="px-4 py-2 rounded-xl border border-border">Cancel</button><button onClick={create} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">Create Ticket</button></div>
        </div></div>
      )}
    </div>
  );
}

function Stat({label,value,danger}:{label:string;value:any;danger?:boolean}){ return <div className={`p-4 rounded-2xl border bg-card ${danger?'border-red-500/30':'border-border'}`}><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-xl font-black ${danger?'text-red-400':'text-foreground'}`}>{value}</div></div>; }
