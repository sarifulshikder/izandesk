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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><ShoppingCart className="w-6 h-6 text-primary"/>Procurement & Assets</h1><p className="text-sm text-muted-foreground">Vendors, purchases/GRN stock-in, assets and depreciation (Phase 7).</p></div>
        <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Purchases / GRN">
            <table className="w-full text-xs"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">No</th><th className="text-left py-2 px-2">Vendor</th><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Total</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Action</th></tr></thead>
              <tbody>{purchases.map(p=>(<tr key={p.id} className="border-b border-border/50"><td className="py-2 px-2 font-mono">{p.purchase_no}</td><td className="py-2 px-2">{p.vendor_name||'-'}</td><td className="py-2 px-2">{String(p.purchase_date).slice(0,10)}</td><td className="py-2 px-2 font-semibold">{money(p.total)}</td><td className="py-2 px-2">{p.status}</td><td className="py-2 px-2">{canManage && p.status!=='RECEIVED' && <button onClick={()=>receive(p.id)} className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs">Receive (GRN)</button>}</td></tr>))}{!purchases.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No purchases.</td></tr>}</tbody>
            </table>
          </Panel>
          <Panel title="Assets & Depreciation">
            <table className="w-full text-xs"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Tag</th><th className="text-left py-2 px-2">Name</th><th className="text-left py-2 px-2">Cost</th><th className="text-left py-2 px-2">Current</th><th className="text-left py-2 px-2">Acc. Dep</th><th className="text-left py-2 px-2">Rate%</th><th className="text-left py-2 px-2">Status</th></tr></thead>
              <tbody>{assets.map(a=>(<tr key={a.id} className="border-b border-border/50"><td className="py-2 px-2 font-mono">{a.asset_tag}</td><td className="py-2 px-2 font-medium">{a.name}<div className="text-muted-foreground">{a.category||''}</div></td><td className="py-2 px-2">{money(a.cost)}</td><td className="py-2 px-2">{money(a.current_value)}</td><td className="py-2 px-2">{money(a.accumulated_depreciation||0)}</td><td className="py-2 px-2">{Number(a.depreciation_rate||0)}</td><td className="py-2 px-2">{a.status}</td></tr>))}{!assets.length && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No assets.</td></tr>}</tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><input type="month" className="p-2 rounded-xl border border-border bg-card" value={depPeriod} onChange={e=>setDepPeriod(e.target.value)} /><button onClick={runDep} disabled={!isAdmin} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50">Run Monthly Depreciation</button><span className="text-xs text-muted-foreground">Applies straight-line monthly rate to active assets and records expense.</span></div>
          </Panel>
          <Panel title="Vendors">
            <table className="w-full text-xs"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Name</th><th className="text-left py-2 px-2">Company</th><th className="text-left py-2 px-2">Phone</th><th className="text-left py-2 px-2">Category</th><th className="text-left py-2 px-2">Status</th></tr></thead>
              <tbody>{vendors.map(v=>(<tr key={v.id} className="border-b border-border/50"><td className="py-2 px-2 font-medium">{v.name}</td><td className="py-2 px-2">{v.company_name||'-'}</td><td className="py-2 px-2">{v.phone||'-'}</td><td className="py-2 px-2">{v.category||'-'}</td><td className="py-2 px-2">{v.status}</td></tr>))}{!vendors.length && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No vendors.</td></tr>}</tbody>
            </table>
          </Panel>
        </div>
        <div className="space-y-5">
          <FormCard title="Add Vendor" onSubmit={addVendor} disabled={!canManage || !vendor.name}>
            <input placeholder="Name" className="w-full p-2.5 rounded-xl border border-border bg-card" value={vendor.name} onChange={e=>setVendor({...vendor,name:e.target.value})} />
            <input placeholder="Company" className="w-full p-2.5 rounded-xl border border-border bg-card" value={vendor.company_name} onChange={e=>setVendor({...vendor,company_name:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input placeholder="Phone" className="p-2.5 rounded-xl border border-border bg-card" value={vendor.phone} onChange={e=>setVendor({...vendor,phone:e.target.value})} /><input placeholder="Category" className="p-2.5 rounded-xl border border-border bg-card" value={vendor.category} onChange={e=>setVendor({...vendor,category:e.target.value})} /></div>
          </FormCard>
          <FormCard title="Create Purchase" onSubmit={addPurchase} disabled={!canManage || !purchase.item_name || !purchase.unit_cost}>
            <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={purchase.vendor_id} onChange={e=>setPurchase({...purchase,vendor_id:e.target.value})}><option value="">Vendor (optional)</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <input type="date" className="w-full p-2.5 rounded-xl border border-border bg-card" value={purchase.purchase_date} onChange={e=>setPurchase({...purchase,purchase_date:e.target.value})} />
            <input placeholder="Item name" className="w-full p-2.5 rounded-xl border border-border bg-card" value={purchase.item_name} onChange={e=>setPurchase({...purchase,item_name:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Qty" className="p-2.5 rounded-xl border border-border bg-card" value={purchase.qty} onChange={e=>setPurchase({...purchase,qty:e.target.value})} /><input type="number" placeholder="Unit cost" className="p-2.5 rounded-xl border border-border bg-card" value={purchase.unit_cost} onChange={e=>setPurchase({...purchase,unit_cost:e.target.value})} /></div>
          </FormCard>
          <FormCard title="Add Asset" onSubmit={addAsset} disabled={!canManage || !asset.name}>
            <input placeholder="Asset name" className="w-full p-2.5 rounded-xl border border-border bg-card" value={asset.name} onChange={e=>setAsset({...asset,name:e.target.value})} />
            <input placeholder="Category" className="w-full p-2.5 rounded-xl border border-border bg-card" value={asset.category} onChange={e=>setAsset({...asset,category:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Cost" className="p-2.5 rounded-xl border border-border bg-card" value={asset.cost} onChange={e=>setAsset({...asset,cost:e.target.value})} /><input type="number" placeholder="Depreciation %/yr" className="p-2.5 rounded-xl border border-border bg-card" value={asset.depreciation_rate} onChange={e=>setAsset({...asset,depreciation_rate:e.target.value})} /></div>
            <input placeholder="Location" className="w-full p-2.5 rounded-xl border border-border bg-card" value={asset.location} onChange={e=>setAsset({...asset,location:e.target.value})} />
          </FormCard>
        </div>
      </div>
    </div>
  );
}

function Panel({title,children}:any){ return <div className="rounded-2xl border border-border bg-card p-4"><h2 className="font-bold mb-3">{title}</h2><div className="overflow-auto max-h-[360px]">{children}</div></div>; }
function FormCard({title,onSubmit,disabled,children}:any){ return <div className="rounded-2xl border border-border bg-card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-primary"/>{title}</h2><div className="space-y-2 text-sm">{children}</div><button onClick={onSubmit} disabled={disabled} className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50">Save</button></div>; }
