'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plus, ShoppingCart } from 'lucide-react';

function money(v:any){ const n=Number(v||0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function ProcurementPage() {
  const { token, user } = useAuth();
  const [vendors, setVendors] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [err, setErr] = useState<string|null>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const canManage = ['SUPER_ADMIN','BILLING_OPERATOR'].includes(String(user?.role));
  const isAdmin = String(user?.role)==='SUPER_ADMIN';
  const [vendor, setVendor] = useState<any>({ name:'', company_name:'', phone:'', email:'', category:'' });
  const [purchase, setPurchase] = useState<any>({ vendor_id:'', purchase_date: new Date().toISOString().slice(0,10), item_name:'', qty:1, unit_cost:'', notes:'' });
  const [asset, setAsset] = useState<any>({ name:'', category:'', cost:'', location:'', status:'ACTIVE', depreciation_rate:'' });
  const [depPeriod, setDepPeriod] = useState(new Date().toISOString().slice(0,7));

  const load = useCallback(async () => {
    if(!token) return; setLoading(true); setErr(null);
    try {
      const [v,p,a] = await Promise.all([
        apiFetch<any>('/api/procurement/vendors', {}, token),
        apiFetch<any>('/api/procurement/purchases', {}, token),
        apiFetch<any>('/api/procurement/assets', {}, token),
      ]);
      setVendors(v.data||[]); setPurchases(p.data||[]); setAssets(a.data||[]);
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(()=>{ load(); }, [load]);

  const addVendor = async () => { if(!token) return; setErr(null); try { await apiFetch('/api/procurement/vendors',{method:'POST',body:JSON.stringify(vendor)},token); setMsg('Vendor added'); setVendor({name:'',company_name:'',phone:'',email:'',category:''}); await load(); } catch(e:any){ setErr(e.message);} };
  const addPurchase = async () => { if(!token) return; setErr(null); try { await apiFetch('/api/procurement/purchases',{method:'POST',body:JSON.stringify({ vendor_id: purchase.vendor_id||null, purchase_date: purchase.purchase_date, notes: purchase.notes, items:[{ item_name: purchase.item_name||'Item', qty:Number(purchase.qty||1), unit_cost:Number(purchase.unit_cost||0) }] })},token); setMsg('Purchase created'); setPurchase({ vendor_id:'', purchase_date: new Date().toISOString().slice(0,10), item_name:'', qty:1, unit_cost:'', notes:'' }); await load(); } catch(e:any){ setErr(e.message);} };
  const receive = async (id:string) => { if(!token) return; setErr(null); try { await apiFetch(`/api/procurement/purchases/${id}/receive`,{method:'POST'},token); setMsg('Purchase received (stock-in attempted for linked inventory items, expense recorded)'); await load(); } catch(e:any){ setErr(e.message);} };
  const addAsset = async () => { if(!token) return; setErr(null); try { await apiFetch('/api/procurement/assets',{method:'POST',body:JSON.stringify({ ...asset, cost:Number(asset.cost||0), depreciation_rate: asset.depreciation_rate===''?0:Number(asset.depreciation_rate) })},token); setMsg('Asset added'); setAsset({ name:'', category:'', cost:'', location:'', status:'ACTIVE', depreciation_rate:'' }); await load(); } catch(e:any){ setErr(e.message);} };
  const runDep = async () => { if(!token) return; setErr(null); try { const r=await apiFetch<any>('/api/procurement/assets/depreciate/run',{method:'POST',body:JSON.stringify({ period_month: depPeriod })},token); setMsg(`Depreciation run ${r.period}: ${r.updated} assets, total ${money(r.total_depreciation)} (expense recorded)`); await load(); } catch(e:any){ setErr(e.message);} };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div><span className="page-eyebrow">Supply chain · Procurement &amp; assets</span><h1 className="page-title"><ShoppingCart className="w-6 h-6 text-primary"/>Procurement &amp; Assets</h1><p className="page-subtitle">Vendors, purchases/GRN stock-in, assets and depreciation (Phase 7).</p></div>
        <div className="page-actions"><button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button></div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Purchases / GRN">
            <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">No</th><th className="px-3 py-2.5">Vendor</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Total</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Action</th></tr></thead>
              <tbody>{purchases.map(p=>(<tr key={p.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] font-mono">{p.purchase_no}</td><td className="px-3 py-2.5 text-[11px]">{p.vendor_name||'-'}</td><td className="px-3 py-2.5 text-[11px]">{String(p.purchase_date).slice(0,10)}</td><td className="px-3 py-2.5 text-[11px] font-semibold tabular-nums">{money(p.total)}</td><td className="px-3 py-2.5 text-[11px]">{p.status}</td><td className="px-3 py-2.5 text-[11px]">{canManage && p.status!=='RECEIVED' && <button onClick={()=>receive(p.id)} className="btn btn-primary btn-sm">Receive (GRN)</button>}</td></tr>))}{!purchases.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No purchases.</td></tr>}</tbody>
            </table>
          </Panel>
          <Panel title="Assets & Depreciation">
            <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Tag</th><th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Cost</th><th className="px-3 py-2.5">Current</th><th className="px-3 py-2.5">Acc. Dep</th><th className="px-3 py-2.5">Rate%</th><th className="px-3 py-2.5">Status</th></tr></thead>
              <tbody>{assets.map(a=>(<tr key={a.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] font-mono">{a.asset_tag}</td><td className="px-3 py-2.5 text-[11px] font-medium">{a.name}<div className="text-muted-foreground">{a.category||''}</div></td><td className="px-3 py-2.5 text-[11px] tabular-nums">{money(a.cost)}</td><td className="px-3 py-2.5 text-[11px] tabular-nums">{money(a.current_value)}</td><td className="px-3 py-2.5 text-[11px] tabular-nums">{money(a.accumulated_depreciation||0)}</td><td className="px-3 py-2.5 text-[11px] tabular-nums">{Number(a.depreciation_rate||0)}</td><td className="px-3 py-2.5 text-[11px]">{a.status}</td></tr>))}{!assets.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No assets.</td></tr>}</tbody>
            </table>
            <div className="toolbar-strip mt-3 text-sm"><input type="month" className="form-control w-auto" value={depPeriod} onChange={e=>setDepPeriod(e.target.value)} /><button onClick={runDep} disabled={!isAdmin} className="btn btn-primary">Run Monthly Depreciation</button><span className="text-[11px] text-muted-foreground">Applies straight-line monthly rate to active assets and records expense.</span></div>
          </Panel>
          <Panel title="Vendors">
            <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Company</th><th className="px-3 py-2.5">Phone</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5">Status</th></tr></thead>
              <tbody>{vendors.map(v=>(<tr key={v.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] font-medium">{v.name}</td><td className="px-3 py-2.5 text-[11px]">{v.company_name||'-'}</td><td className="px-3 py-2.5 text-[11px]">{v.phone||'-'}</td><td className="px-3 py-2.5 text-[11px]">{v.category||'-'}</td><td className="px-3 py-2.5 text-[11px]">{v.status}</td></tr>))}{!vendors.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No vendors.</td></tr>}</tbody>
            </table>
          </Panel>
        </div>
        <div className="space-y-5">
          <FormCard title="Add Vendor" onSubmit={addVendor} disabled={!canManage || !vendor.name}>
            <input placeholder="Name" className="form-control" value={vendor.name} onChange={e=>setVendor({...vendor,name:e.target.value})} />
            <input placeholder="Company" className="form-control" value={vendor.company_name} onChange={e=>setVendor({...vendor,company_name:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input placeholder="Phone" className="form-control" value={vendor.phone} onChange={e=>setVendor({...vendor,phone:e.target.value})} /><input placeholder="Category" className="form-control" value={vendor.category} onChange={e=>setVendor({...vendor,category:e.target.value})} /></div>
          </FormCard>
          <FormCard title="Create Purchase" onSubmit={addPurchase} disabled={!canManage || !purchase.item_name || !purchase.unit_cost}>
            <select className="form-select" value={purchase.vendor_id} onChange={e=>setPurchase({...purchase,vendor_id:e.target.value})}><option value="">Vendor (optional)</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <input type="date" className="form-control" value={purchase.purchase_date} onChange={e=>setPurchase({...purchase,purchase_date:e.target.value})} />
            <input placeholder="Item name" className="form-control" value={purchase.item_name} onChange={e=>setPurchase({...purchase,item_name:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Qty" className="form-control" value={purchase.qty} onChange={e=>setPurchase({...purchase,qty:e.target.value})} /><input type="number" placeholder="Unit cost" className="form-control" value={purchase.unit_cost} onChange={e=>setPurchase({...purchase,unit_cost:e.target.value})} /></div>
          </FormCard>
          <FormCard title="Add Asset" onSubmit={addAsset} disabled={!canManage || !asset.name}>
            <input placeholder="Asset name" className="form-control" value={asset.name} onChange={e=>setAsset({...asset,name:e.target.value})} />
            <input placeholder="Category" className="form-control" value={asset.category} onChange={e=>setAsset({...asset,category:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Cost" className="form-control" value={asset.cost} onChange={e=>setAsset({...asset,cost:e.target.value})} /><input type="number" placeholder="Depreciation %/yr" className="form-control" value={asset.depreciation_rate} onChange={e=>setAsset({...asset,depreciation_rate:e.target.value})} /></div>
            <input placeholder="Location" className="form-control" value={asset.location} onChange={e=>setAsset({...asset,location:e.target.value})} />
          </FormCard>
        </div>
      </div>
    </div>
  );
}

function Panel({title,children}:any){ return <div className="card p-4"><h2 className="card-title mb-3">{title}</h2><div className="table-wrap overflow-auto max-h-[360px]">{children}</div></div>; }
function FormCard({title,onSubmit,disabled,children}:any){ return <div className="card p-4 space-y-3"><h2 className="card-title"><Plus className="w-4 h-4 text-primary"/>{title}</h2><div className="space-y-2 text-sm">{children}</div><button onClick={onSubmit} disabled={disabled} className="btn btn-primary w-full">Save</button></div>; }
