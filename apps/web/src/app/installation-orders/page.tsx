'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { Search, Plus, Pencil, Trash2, X, User, ChevronLeft, ChevronRight, CheckCircle2, Calendar, Clock, MapPin, Wrench, AlertTriangle, CheckCircle, Package, Truck, ArrowRight } from 'lucide-react';

const ORDER_TYPES = ['INSTALLATION', 'REPAIR', 'RELOCATION', 'UPGRADE', 'DISCONNECTION', 'EQUIPMENT_SWAP'];
const ORDER_STATUSES = ['PENDING', 'SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const emptyForm = {
  subscriber_id: '', lead_id: '', order_type: 'INSTALLATION', status: 'PENDING', priority: 'NORMAL',
  scheduled_date: '', scheduled_time_start: '', scheduled_time_end: '',
  assigned_technician_id: '', assigned_technician_name: '',
  site_address: '', site_latitude: '', site_longitude: '',
  site_contact_name: '', site_contact_phone: '',
  required_equipment: [], checklist: [], sla_due_at: ''
};

export default function InstallationOrdersPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<any>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [technician, setTechnician] = useState('');
  const [subscriber, setSubscriber] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [detail, setDetail] = useState<any | null>(null);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<any[]>([]);

  const loadRefs = useCallback(async () => {
    if (!token) return;
    const [subs, techs, ld] = await Promise.all([
      apiFetch<{data:any[]}>('/api/subscribers?limit=500', {}, token),
      apiFetch<{data:any[]}>('/api/hr/employees?limit=200', {}, token).catch(()=>({data:[]})),
      apiFetch<{data:any[]}>('/api/leads?limit=500', {}, token).catch(()=>({data:[]})),
    ]);
    setSubscribers(subs.data || []); setTechnicians(techs.data || []); setLeads(ld.data || []);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      if (technician) params.set('technician_id', technician);
      if (subscriber) params.set('subscriber_id', subscriber);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('limit', '100');
      const [res, sum] = await Promise.all([
        apiFetch<{data:any[], total:number}>(`/api/installation-orders?${params.toString()}`, {}, token),
        apiFetch<{summary:any}>(`/api/installation-orders/summary`, {}, token),
      ]);
      setRows(res.data || []); setTotal(res.total || 0); setSummary(sum?.summary || null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [token, q, status, type, technician, subscriber, from, to]);

  const loadChecklist = useCallback(async (orderId: string) => {
    if (!token) return;
    const cl = await apiFetch<{checklist:any[]}>(`/api/installation-orders/${orderId}`, {}, token);
    setChecklist(cl?.checklist || []);
  }, [token]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };
  useEffect(() => {
    const wantsNew = searchParams?.get('new') === '1' || searchParams?.get('action') === 'new' || searchParams?.get('add') === '1';
    if (wantsNew) openCreate();
  }, [searchParams]);

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ ...emptyForm, ...row, scheduled_date: row.scheduled_date ? String(row.scheduled_date).slice(0,10) : '', sla_due_at: row.sla_due_at ? String(row.sla_due_at).slice(0,16) : '' });
    setShowForm(true);
    loadChecklist(row.id);
  };

  const openDetail = async (id: string) => {
    if (!token) return;
    const d = await apiFetch<any>(`/api/installation-orders/${id}`, {}, token);
    setDetail(d);
    setChecklist(d?.checklist || []);
  };

  const save = async () => {
    if (!token) return;
    setError(null);
    try {
      const payload = { ...form };
      ['subscriber_id','lead_id','assigned_technician_id','scheduled_time_start','scheduled_time_end','site_latitude','site_longitude','sla_due_at'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      if (editing) await apiFetch(`/api/installation-orders/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      else await apiFetch('/api/installation-orders', { method: 'POST', body: JSON.stringify(payload) }, token);
      setShowForm(false); await load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!token || !confirm('Delete this order?')) return;
    await apiFetch(`/api/installation-orders/${id}`, { method: 'DELETE' }, token);
    if (detail?.id === id) setDetail(null);
    await load();
  };

  const statusBadge = (s: string) => {
    const v = String(s || '').toUpperCase();
    if (v === 'COMPLETED') return 'badge-success';
    if (v === 'IN_PROGRESS') return 'badge-info';
    if (v === 'CANCELLED') return 'badge-danger';
    if (v === 'ASSIGNED') return 'badge-purple';
    if (v === 'SCHEDULED') return 'badge-warning';
    return 'badge-secondary';
  };

  const priorityBadge = (p: string) => {
    const v = String(p || '').toUpperCase();
    if (v === 'URGENT') return 'badge-danger';
    if (v === 'HIGH') return 'badge-warning';
    if (v === 'LOW') return 'badge-secondary';
    return 'badge-success';
  };

  const typeIcon = (t: string) => {
    switch(t) {
      case 'INSTALLATION': return <Package className="w-4 h-4"/>;
      case 'REPAIR': return <Wrench className="w-4 h-4"/>;
      case 'RELOCATION': return <Truck className="w-4 h-4"/>;
      case 'UPGRADE': return <ArrowRight className="w-4 h-4"/>;
      case 'DISCONNECTION': return <AlertTriangle className="w-4 h-4"/>;
      case 'EQUIPMENT_SWAP': return <Package className="w-4 h-4"/>;
      default: return <Package className="w-4 h-4"/>;
    }
  };

  return (
    <div className="space-y-5">
      <div className="page-header flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Installation Orders</h1>
          <p className="text-sm text-muted-foreground">Schedule, dispatch, and track field work — {total} total</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-outline">Refresh</button>
          <button onClick={openCreate} className="btn btn-primary"><Plus className="w-4 h-4"/>Create Order</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="card p-4"><div className="text-xs text-muted-foreground">Pending</div><div className="text-xl font-black mt-1 text-amber-400">{summary.pending}</div></div>
          <div className="card p-4 border-info/30"><div className="text-xs text-blue-300/80">In Progress</div><div className="text-xl font-black mt-1 text-blue-400">{summary.in_progress}</div></div>
          <div className="card p-4 border-success/30"><div className="text-xs text-emerald-300/80">Completed</div><div className="text-xl font-black mt-1 text-emerald-400">{summary.completed}</div></div>
          <div className="card p-4 border-danger/30"><div className="text-xs text-red-300/80">Overdue</div><div className="text-xl font-black mt-1 text-red-400">{summary.overdue}</div></div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by order no, address, contact..." className="form-control w-full pl-9"/>
        </div>
        <select value={status} onChange={e=>setStatus(e.target.value)} className="btn btn-outline">
          <option value="">All Statuses</option>
          {ORDER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={type} onChange={e=>setType(e.target.value)} className="btn btn-outline">
          <option value="">All Types</option>
          {ORDER_TYPES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="btn btn-outline" />
        <input type="date" value={to} onChange={e=>setTo(e.target.value)} className="btn btn-outline" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 card overflow-hidden">
          <div className="table-wrap">
            <table className="table table-hover text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Order</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Subscriber / Site</th>
                  <th className="text-left px-4 py-3">Schedule</th>
                  <th className="text-left px-4 py-3">Technician</th>
                  <th className="text-left px-4 py-3">Status / Priority</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading orders...</td></tr> :
                 rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No orders found. Create one with the form.</td></tr> :
                 rows.map(r => (
                  <tr key={r.id} className="border-t border-border/70 hover:bg-muted/30 cursor-pointer" onClick={()=>openDetail(r.id)}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{r.order_no}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs">{typeIcon(r.order_type)}<span>{r.order_type}</span></div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium">{r.subscriber_name || r.lead_id ? 'Lead' : 'Direct Order'}</div>
                      <div className="text-xs text-muted-foreground">{r.site_address || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs flex items-center gap-1"><Calendar className="w-3.5 h-3.5"/> {r.scheduled_date ? new Date(r.scheduled_date).toLocaleDateString() : 'Unscheduled'}</div>
                      {r.scheduled_time_start && <div className="text-xs flex items-center gap-1"><Clock className="w-3.5 h-3.5"/> {r.scheduled_time_start} - {r.scheduled_time_end || ''}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{r.technician_name_full || r.assigned_technician_name || 'Unassigned'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`badge ${statusBadge(r.status)}`}>{r.status}</span>
                        <span className={`badge font-semibold ${priorityBadge(r.priority)}`}>{r.priority}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>openEdit(r)} className="p-2 rounded-lg hover:bg-muted"><Pencil className="w-4 h-4"/></button>
                      <button onClick={()=>remove(r.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-400"><Trash2 className="w-4 h-4"/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4 space-y-4">
          {!detail ? (
            <div className="text-sm text-muted-foreground py-16 text-center border border-dashed border-border rounded-xl">Select an order to view details and manage checklist.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-foreground flex items-center gap-2">{typeIcon(detail.order_type)}<span className="truncate">{detail.order_no}</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">{detail.order_type}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className={`badge ${statusBadge(detail.status)}`}>{detail.status}</span>
                    <span className={`badge ${priorityBadge(detail.priority)}`}>{detail.priority}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={()=>openEdit(detail)} className="p-1.5 rounded-lg hover:bg-muted border border-transparent hover:border-border" title="Edit"><Pencil className="w-4 h-4"/></button>
                  <button onClick={()=>setDetail(null)} className="p-1.5 rounded-lg hover:bg-muted" title="Close"><X className="w-4 h-4"/></button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Subscriber" value={detail.subscriber_name || (detail.lead_id ? 'From Lead' : 'Direct')} />
                <Info label="Technician" value={detail.technician_name_full || detail.assigned_technician_name || 'Unassigned'} />
                <Info label="Site Address" value={detail.site_address || '-'} />
                <Info label="Contact" value={`${detail.site_contact_name || ''} ${detail.site_contact_phone || ''}`.trim() || '-'} />
                <Info label="Scheduled" value={detail.scheduled_date ? `${new Date(detail.scheduled_date).toLocaleDateString()} ${detail.scheduled_time_start || ''}-${detail.scheduled_time_end || ''}` : 'Unscheduled'} />
                <Info label="SLA Due" value={detail.sla_due_at ? new Date(detail.sla_due_at).toLocaleString() : '-'} />
              </div>

              <div className="pt-2 border-t border-border">
                <div className="font-semibold text-sm mb-2 flex items-center gap-2"><CheckCircle className="w-4 h-4 text-primary"/>Checklist</div>
                <div className="space-y-2 max-h-[200px] overflow-auto">
                  {checklist.length === 0 ? <div className="text-xs text-muted-foreground">No checklist items. Add items when editing.</div> :
                    checklist.map((item: any) => (
                      <label key={item.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/20">
                        <input type="checkbox" checked={item.is_completed} onChange={async () => {
                          await apiFetch(`/api/installation-orders/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ is_completed: !item.is_completed, completed_by: 'User' }) }, token);
                          loadChecklist(detail.id);
                        }} className="w-4 h-4" />
                        <span className={item.is_completed ? 'line-through text-muted-foreground' : ''}>{item.item_text} {item.is_required && <span className="text-red-400 text-[10px]">(required)</span>}</span>
                        {item.completed_at && <span className="text-[10px] text-muted-foreground ml-auto">✓ {new Date(item.completed_at).toLocaleString()}</span>}
                      </label>
                    ))
                  }
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <div className="font-semibold text-sm mb-2">Completion</div>
                <div className="space-y-2 text-xs">
                  <textarea placeholder="Completion notes..." rows={3} className="form-control w-full text-xs" defaultValue={detail.completion_notes || ''} />
                  <button className="btn btn-primary btn-sm">Save Completion Notes</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-3 sm:p-4 overflow-auto">
          <div className="w-full max-w-3xl card my-4 sm:my-6 max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
              <div>
                <h2 className="font-bold text-lg">{editing ? 'Edit Order' : 'Create Installation Order'}</h2>
                <p className="text-xs text-muted-foreground">Fill in all required fields. Checklist can be managed after saving.</p>
              </div>
              <button onClick={()=>setShowForm(false)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button>
            </div>

            <div className="p-4 sm:p-5 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select label="Subscriber" value={form.subscriber_id||''} onChange={v=>setForm({...form, subscriber_id:v, lead_id:''})} options={[{v:'',l:'Select subscriber...'}, ...subscribers.map((s:any)=>({v:s.id,l:`${s.full_name} (${s.client_code})`}))]} />
                <Select label="Lead (optional)" value={form.lead_id||''} onChange={v=>setForm({...form, lead_id:v, subscriber_id:''})} options={[{v:'',l:'Select lead...'}, ...leads.map((l:any)=>({v:l.id,l:`${l.full_name} (${l.lead_no})`}))]} />
                <Select label="Order Type" value={form.order_type} onChange={v=>setForm({...form, order_type:v})} options={ORDER_TYPES} />
                <Select label="Status" value={form.status} onChange={v=>setForm({...form, status:v})} options={ORDER_STATUSES} />
                <Select label="Priority" value={form.priority} onChange={v=>setForm({...form, priority:v})} options={PRIORITIES} />
                <Select label="Technician" value={form.assigned_technician_id||''} onChange={v=>setForm({...form, assigned_technician_id:v, assigned_technician_name: technicians.find((t:any)=>t.id===v)?.full_name || ''})} options={[{v:'',l:'Unassigned'}, ...technicians.map((t:any)=>({v:t.id,l:t.full_name}))]} />
                <Input label="Scheduled Date" value={form.scheduled_date} onChange={v=>setForm({...form, scheduled_date:v})} type="date" />
                <Input label="Start Time" value={form.scheduled_time_start} onChange={v=>setForm({...form, scheduled_time_start:v})} type="time" />
                <Input label="End Time" value={form.scheduled_time_end} onChange={v=>setForm({...form, scheduled_time_end:v})} type="time" />
                <Input label="SLA Due" value={form.sla_due_at} onChange={v=>setForm({...form, sla_due_at:v})} type="datetime-local" />
                <Input label="Site Address" value={form.site_address||''} onChange={v=>setForm({...form, site_address:v})} />
                <Input label="Contact Name" value={form.site_contact_name||''} onChange={v=>setForm({...form, site_contact_name:v})} />
                <Input label="Contact Phone" value={form.site_contact_phone||''} onChange={v=>setForm({...form, site_contact_phone:v})} />
                <Input label="Site Latitude" value={form.site_latitude||''} onChange={v=>setForm({...form, site_latitude:v})} />
                <Input label="Site Longitude" value={form.site_longitude||''} onChange={v=>setForm({...form, site_longitude:v})} />
              </div>

              <div className="border-t border-border pt-4">
                <div className="font-semibold text-sm mb-2">Required Equipment (serial numbers, comma-separated)</div>
                <textarea placeholder="ONU-123, ROUTER-456, CABLE-789" rows={2} className="form-control w-full text-xs" value={form.required_equipment?.join(', ') || ''} onChange={e=>setForm({...form, required_equipment: e.target.value.split(',').map((s:string)=>s.trim()).filter(Boolean)})} />
              </div>
            </div>

            <div className="px-4 sm:px-5 py-4 border-t border-border flex justify-end gap-2">
              <button onClick={()=>setShowForm(false)} className="px-4 py-2 rounded-xl border border-border">Cancel</button>
              <button onClick={save} className="btn btn-primary">{editing ? 'Save Changes' : 'Create Order'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="font-medium text-foreground break-words">{value}</div></div>;
}
function Input({ label, value, onChange, type='text', placeholder='' }: { label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} className="form-control w-full text-foreground outline-none focus:border-primary/50" />
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: any; onChange: (v: string) => void; options: any[] }) {
  const opts = options.map((o: any) => typeof o === 'string' ? {v:o,l:o} : o);
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)} className="form-control w-full text-foreground outline-none focus:border-primary/50">
        {opts.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}