'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Plus, Pencil, Trash2, RefreshCw, Warehouse, Package, Barcode, X, Radio } from 'lucide-react';

type Tab = 'warehouses' | 'items' | 'serials';

export default function InventoryPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('warehouses');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [serials, setSerials] = useState<any[]>([]);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{type: Tab|'edit-warehouse'|'edit-item'|'edit-serial', data?: any} | null>(null);
  const [form, setForm] = useState<any>({});
  const [serialFilter, setSerialFilter] = useState({ q: '', status: '', item_id: '', warehouse_id: '', source: '' });
  const [onuSummary, setOnuSummary] = useState<any>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [w, i, s, subs, onuSum] = await Promise.all([
        apiFetch<{data:any[]}>('/api/inventory/warehouses', {}, token),
        apiFetch<{data:any[]}>('/api/inventory/items', {}, token),
        apiFetch<{data:any[]}>(`/api/inventory/serials?${new URLSearchParams(Object.entries(serialFilter).filter(([,v])=>v) as any)}`, {}, token),
        apiFetch<{data:any[]}>('/api/subscribers?limit=200', {}, token),
        apiFetch<{data:any}>('/api/inventory/serials/onu-import/summary', {}, token).catch(() => ({ data: null })),
      ]);
      setWarehouses(w.data||[]); setItems(i.data||[]); setSerials(s.data||[]); setSubscribers(subs.data||[]); setOnuSummary(onuSum?.data || null);
    } catch(e:any){ setError(e.message); } finally { setLoading(false); }
  }, [token, serialFilter]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!token || !modal) return;
    try {
      if (modal.type === 'warehouses') await apiFetch('/api/inventory/warehouses', { method:'POST', body: JSON.stringify(form) }, token);
      else if (modal.type === 'edit-warehouse') await apiFetch(`/api/inventory/warehouses/${modal.data.id}`, { method:'PUT', body: JSON.stringify(form) }, token);
      else if (modal.type === 'items') await apiFetch('/api/inventory/items', { method:'POST', body: JSON.stringify(form) }, token);
      else if (modal.type === 'edit-item') await apiFetch(`/api/inventory/items/${modal.data.id}`, { method:'PUT', body: JSON.stringify(form) }, token);
      else if (modal.type === 'serials') await apiFetch('/api/inventory/serials', { method:'POST', body: JSON.stringify(form) }, token);
      else if (modal.type === 'edit-serial') await apiFetch(`/api/inventory/serials/${modal.data.id}`, { method:'PUT', body: JSON.stringify(form) }, token);
      setModal(null); setForm({}); await load();
    } catch(e:any){ setError(e.message); }
  };

  const del = async (path: string) => {
    if (!token || !confirm('Delete this record?')) return;
    await apiFetch(path, { method:'DELETE' }, token);
    await load();
  };

  // The trick: import subscriber-linked ONUs from OLTs into inventory serials
  const syncOnus = async () => {
    if (!token) return;
    setSyncMsg(null);
    try {
      const r = await apiFetch<any>('/api/olt/sync-inventory', { method: 'POST', body: JSON.stringify({ limit: 500 }) }, token);
      setSyncMsg(`✅ Imported ${r.synced?.length || 0} linked ONUs into inventory (${r.checked || 0} checked).`);
      await load();
    } catch (e: any) { setSyncMsg(`❌ ${e.message}`); }
  };

  const openNew = (type: Tab) => {
    if (type === 'warehouses') setForm({ name:'', location:'' });
    if (type === 'items') setForm({ name:'', category:'ONT', brand:'', model:'', unit:'pcs', reorder_level:0 });
    if (type === 'serials') setForm({ item_id: items[0]?.id || '', warehouse_id: warehouses[0]?.id || '', serial_number:'', mac_address:'', status:'IN_STOCK', assigned_subscriber_id:'', notes:'' });
    setModal({ type });
  };
  const openEdit = (type: Tab, data: any) => {
    setForm({ ...data });
    setModal({ type: (type === 'warehouses' ? 'edit-warehouse' : type === 'items' ? 'edit-item' : 'edit-serial') as any, data });
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Asset management · Fulfilment</span>
          <h1 className="page-title">Inventory &amp; Serial Tracking</h1>
          <p className="page-subtitle">Warehouses, hardware items and serial-number lifecycle — stock, assigned, faulty and RMA.</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={()=>openNew(tab)} className="btn btn-primary"><Plus className="w-4 h-4"/>Add {tab==='warehouses'?'Warehouse':tab==='items'?'Item':'Serial'}</button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="page-tabbar">
        {([['warehouses','Warehouses',Warehouse],['items','Items',Package],['serials','Serial Numbers',Barcode]] as any[]).map(([k,label,Icon]) => (
          <button key={k} onClick={()=>setTab(k)} className={`page-tab ${tab===k?'active':''}`}><Icon className="w-3.5 h-3.5"/>{label}</button>
        ))}
      </div>

      {tab === 'warehouses' && (
        <CardTable loading={loading} headers={['Name','Location','In Stock Serials','Created','Actions']} rows={warehouses.map(w => [
          <b key="n">{w.name}</b>, w.location||'-', String(w.in_stock_count ?? 0), new Date(w.created_at).toLocaleDateString(),
          <Actions key="a" onEdit={()=>openEdit('warehouses',w)} onDelete={()=>del(`/api/inventory/warehouses/${w.id}`)} />
        ])} empty="No warehouses." />
      )}

      {tab === 'items' && (
        <CardTable loading={loading} headers={['Item','Category','Brand/Model','Stock (In/Assigned/Faulty)','Reorder','Actions']} rows={items.map(i => [
          <div key="n"><div className="font-semibold">{i.name}</div><div className="text-xs text-muted-foreground">{i.unit}</div></div>,
          i.category, `${i.brand||'-'} ${i.model||''}`.trim(), `${i.in_stock||0} / ${i.assigned||0} / ${i.faulty||0}`, String(i.reorder_level||0),
          <Actions key="a" onEdit={()=>openEdit('items',i)} onDelete={()=>del(`/api/inventory/items/${i.id}`)} />
        ])} empty="No inventory items." />
      )}

      {tab === 'serials' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <input value={serialFilter.q} onChange={e=>setSerialFilter({...serialFilter,q:e.target.value})} placeholder="Search serial/MAC..." className="form-control"/>
            <select value={serialFilter.status} onChange={e=>setSerialFilter({...serialFilter,status:e.target.value})} className="form-select">
              <option value="">All statuses</option>{['IN_STOCK','ASSIGNED','FAULTY','RMA','RETIRED'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <select value={serialFilter.item_id} onChange={e=>setSerialFilter({...serialFilter,item_id:e.target.value})} className="form-select">
              <option value="">All items</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <select value={serialFilter.warehouse_id} onChange={e=>setSerialFilter({...serialFilter,warehouse_id:e.target.value})} className="form-select">
              <option value="">All warehouses</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select value={serialFilter.source} onChange={e=>setSerialFilter({...serialFilter,source:e.target.value})} className="form-select">
              <option value="">All sources</option>
              <option value="MANUAL">Manual entry</option>
              <option value="ONU_IMPORT">ONU (auto-imported from OLT)</option>
            </select>
          </div>
          {onuSummary && Number(onuSummary.total_onu_serials) > 0 && (
            <div className="alert alert-success flex-wrap text-sm">
              <span className="inline-flex items-center gap-1.5 font-semibold text-success"><Radio className="w-4 h-4"/>ONU auto-import</span>
              <span className="text-success/80">{onuSummary.total_onu_serials} linked ONUs in inventory • {onuSummary.assigned} assigned • {onuSummary.subscribers_with_onu} subscribers</span>
              {(onuSummary.by_vendor||[]).map((v:any)=>(<span key={v.vendor} className="badge badge-success">{v.vendor}: {v.count}</span>))}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={syncOnus} className="btn btn-primary"><Radio className="w-4 h-4"/>Sync ONUs from OLT</button>
            {syncMsg && <span className="text-xs text-muted-foreground">{syncMsg}</span>}
          </div>
          <CardTable loading={loading} headers={['Serial / MAC','Item','Source','Warehouse','Status','Assigned To','Actions']} rows={serials.map(s => [
            <div key="n"><div className="font-mono text-xs font-semibold">{s.serial_number}</div><div className="text-xs text-muted-foreground">{s.mac_address||'-'}</div></div>,
            <div key="i"><div>{s.item_name}</div><div className="text-xs text-muted-foreground">{s.item_category} {s.brand?`• ${s.brand}`:''}</div></div>,
            s.source === 'ONU_IMPORT'
              ? <span key="src" title={s.olt_vendor ? `OLT vendor: ${s.olt_vendor}` : ''} className="badge badge-success whitespace-nowrap"><Radio className="w-3 h-3"/>{s.olt_name ? `${s.olt_name}${s.onu_pon_port ? ' • ' + s.onu_pon_port : ''}` : 'ONU import'}</span>
              : <span key="src" className="badge badge-outline text-muted-foreground">MANUAL</span>,
            s.warehouse_name||'-', <span key="st" className="badge badge-outline">{s.status}</span>,
            s.subscriber_name ? `${s.subscriber_name} (${s.subscriber_code})` : '-',
            <Actions key="a" onEdit={()=>openEdit('serials',s)} onDelete={()=>del(`/api/inventory/serials/${s.id}`)} />
          ])} empty="No serials found." />
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto">
          <div className="w-full max-w-xl card my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-bold capitalize">{modal.type.replace('-', ' ')}</h2>
              <button onClick={()=>setModal(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              {(modal.type === 'warehouses' || modal.type === 'edit-warehouse') && (<>
                <Field label="Name"><input className="form-control" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
                <Field label="Location"><input className="form-control" value={form.location||''} onChange={e=>setForm({...form,location:e.target.value})}/></Field>
              </>)}
              {(modal.type === 'items' || modal.type === 'edit-item') && (<>
                <Field label="Name"><input className="form-control" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
                <Field label="Category"><select className="form-select" value={form.category||'ONT'} onChange={e=>setForm({...form,category:e.target.value})}>{['ONT','Router','Fiber','Cable','SFP','OLT','Accessory','Other'].map(c=><option key={c}>{c}</option>)}</select></Field>
                <Field label="Brand"><input className="form-control" value={form.brand||''} onChange={e=>setForm({...form,brand:e.target.value})}/></Field>
                <Field label="Model"><input className="form-control" value={form.model||''} onChange={e=>setForm({...form,model:e.target.value})}/></Field>
                <Field label="Unit"><input className="form-control" value={form.unit||'pcs'} onChange={e=>setForm({...form,unit:e.target.value})}/></Field>
                <Field label="Reorder Level"><input className="form-control" type="number" value={form.reorder_level||0} onChange={e=>setForm({...form,reorder_level:Number(e.target.value)})}/></Field>
              </>)}
              {(modal.type === 'serials' || modal.type === 'edit-serial') && (<>
                <Field label="Item"><select className="form-select" value={form.item_id||''} onChange={e=>setForm({...form,item_id:e.target.value})}><option value="">Select</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
                <Field label="Warehouse"><select className="form-select" value={form.warehouse_id||''} onChange={e=>setForm({...form,warehouse_id:e.target.value})}><option value="">None</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
                <Field label="Serial Number"><input className="form-control" value={form.serial_number||''} onChange={e=>setForm({...form,serial_number:e.target.value})}/></Field>
                <Field label="MAC Address"><input className="form-control" value={form.mac_address||''} onChange={e=>setForm({...form,mac_address:e.target.value})}/></Field>
                <Field label="Status"><select className="form-select" value={form.status||'IN_STOCK'} onChange={e=>setForm({...form,status:e.target.value})}>{['IN_STOCK','ASSIGNED','FAULTY','RMA','RETIRED'].map(s=><option key={s}>{s}</option>)}</select></Field>
                <Field label="Assigned Subscriber"><select className="form-select" value={form.assigned_subscriber_id||''} onChange={e=>setForm({...form,assigned_subscriber_id:e.target.value||null})}><option value="">None</option>{subscribers.map(s=><option key={s.id} value={s.id}>{s.full_name} ({s.client_code})</option>)}</select></Field>
                <div className="md:col-span-2"><Field label="Notes"><input className="form-control" value={form.notes||''} onChange={e=>setForm({...form,notes:e.target.value})}/></Field></div>
              </>)}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button onClick={()=>setModal(null)} className="px-4 py-2 rounded-xl border border-border">Cancel</button>
              <button onClick={save} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({label, children}: any) { return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>{children}</label>; }
function Actions({onEdit, onDelete}: any) { return <div className="flex justify-end gap-1"><button onClick={onEdit} className="p-2 rounded-lg hover:bg-muted"><Pencil className="w-4 h-4"/></button><button onClick={onDelete} className="p-2 rounded-lg hover:bg-danger/10 text-danger"><Trash2 className="w-4 h-4"/></button></div>; }
function CardTable({headers, rows, loading, empty}: any) {
  return (
    <div className="card overflow-hidden"><div className="overflow-auto"><table className="table table-hover text-sm">
      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr>{headers.map((h:string,i:number)=><th key={i} className={`px-4 py-3 ${i===headers.length-1?'text-right':'text-left'}`}>{h}</th>)}</tr></thead>
      <tbody>
        {loading ? <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr> :
         rows.length===0 ? <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">{empty}</td></tr> :
         rows.map((r:any,i:number)=><tr key={i} className="border-t border-border/70 hover:bg-muted/20">{r.map((c:any,j:number)=><td key={j} className={`px-4 py-3 ${j===r.length-1?'text-right':''}`}>{c}</td>)}</tr>)}
      </tbody>
    </table></div></div>
  );
}
