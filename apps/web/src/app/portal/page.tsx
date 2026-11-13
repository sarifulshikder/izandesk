'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api';
import { Wifi, Receipt, CreditCard, Gauge, LogOut, RefreshCw, Download } from 'lucide-react';

const money = (v:any) => `৳${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
async function pfetch(path: string, opts: any = {}, token?: string) {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers||{}) } });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

export default function CustomerPortalPage() {
  const [token, setToken] = useState<string | null>(null);
  const [login, setLogin] = useState({ id: '', password: '' });
  const [me, setMe] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [gateways, setGateways] = useState<any[]>([]);
  const [tab, setTab] = useState<'overview'|'invoices'|'payments'|'speedtest'|'wifi'>('overview');
  const [msg, setMsg] = useState<string|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState<any>(null);
  const [wifi, setWifi] = useState({ device_id: '', ssid: '', password: '' });
  const [acs, setAcs] = useState<any>(null);

  useEffect(() => { const t = localStorage.getItem('portal_token'); if (t) setToken(t); }, []);

  const load = async (tkn = token) => {
    if (!tkn) return;
    try {
      const [m, inv, pay, gw, acsStatus] = await Promise.all([
        pfetch('/api/portal/me', {}, tkn),
        pfetch('/api/portal/invoices', {}, tkn),
        pfetch('/api/portal/payments', {}, tkn),
        fetch(`${getApiBaseUrl()}/api/billing/gateways`).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${getApiBaseUrl()}/api/acs/status`).then(r=>r.json()).catch(()=>({configured:false})),
      ]);
      setMe(m); setInvoices(inv.data||[]); setPayments(pay.data||[]);
      const g = (gw.data||gw||[]).filter((x:any)=>x.enabled!==false); setGateways(g.length?g:[{gateway:'bkash',mode:'SANDBOX'},{gateway:'nagad',mode:'SANDBOX'},{gateway:'stripe',mode:'SANDBOX'}]);
      setAcs(acsStatus);
    } catch (e:any) { setErr(e.message); if (String(e.message).includes('session')) { localStorage.removeItem('portal_token'); setToken(null); } }
  };
  useEffect(() => { if (token) load(token); }, [token]);

  const doLogin = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await pfetch('/api/portal/login', { method:'POST', body: JSON.stringify({ client_code: login.id, username: login.id, phone: login.id, password: login.password }) });
      localStorage.setItem('portal_token', r.token); setToken(r.token); setMsg('Logged in'); setErr(null);
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };
  const logout = () => { localStorage.removeItem('portal_token'); setToken(null); setMe(null); };

  const payInvoice = async (inv: any, gateway: string) => {
    if (!token) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await pfetch('/api/portal/payments/checkout', { method:'POST', body: JSON.stringify({ invoice_id: inv.id, gateway, amount: inv.due_amount || inv.total_amount, return_url: window.location.href }) }, token);
      const url = r.checkout?.paymentUrl || r.checkout?.url || r.payment?.checkout_url;
      if (url) { window.open(url, '_blank'); setMsg('Checkout created. Complete payment in the opened window; status will update after confirmation/webhook.'); }
      else setMsg('Checkout created (simulated). If gateway is not live-configured, payment may be simulated.');
      await load(token);
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };

  const runSpeedtest = async () => {
    setBusy(true); setErr(null); setSpeed(null);
    try {
      const base = getApiBaseUrl();
      // download
      const t1 = performance.now();
      const dl = await fetch(`${base}/api/portal/speedtest/download?cb=${Date.now()}`, { cache:'no-store' });
      const buf = await dl.arrayBuffer();
      const t2 = performance.now();
      const downMbps = ((buf.byteLength * 8) / ((t2-t1)/1000)) / 1e6;
      // upload
      const upData = new Uint8Array(1024*1024);
      const t3 = performance.now();
      const up = await fetch(`${base}/api/portal/speedtest/upload?cb=${Date.now()}`, { method:'POST', body: upData, headers: { 'Content-Type':'application/octet-stream' } });
      await up.json().catch(()=>null);
      const t4 = performance.now();
      const upMbps = ((upData.byteLength * 8) / ((t4-t3)/1000)) / 1e6;
      const ping = await (async()=>{ const s=performance.now(); await fetch(`${base}/api/health?cb=${Date.now()}`,{cache:'no-store'}); return performance.now()-s; })();
      setSpeed({ downMbps:+downMbps.toFixed(2), upMbps:+upMbps.toFixed(2), pingMs:+ping.toFixed(1), at: new Date().toLocaleString() });
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };

  const saveWifi = async () => {
    if (!token) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/acs/wifi`, { method:'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(wifi) });
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d?.message || 'Failed to update Wi-Fi');
      setMsg('Wi-Fi update task submitted via TR-069/GenieACS (if device is online and reachable by ACS).');
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };

  if (!token || !me) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 space-y-4 shadow-2xl">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black">I</div><div><div className="font-bold text-lg">IzanDesk Self-Care Portal</div><div className="text-xs text-slate-400">View subscription, invoices, pay online, speedtest & Wi-Fi</div></div></div>
          {err && <div className="text-sm p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{err}</div>}
          <label className="block"><div className="text-xs text-slate-400 mb-1">Client Code / Username / Phone</div><input className="w-full p-3 rounded-xl bg-slate-900/70 border border-white/10" value={login.id} onChange={e=>setLogin({...login,id:e.target.value})} /></label>
          <label className="block"><div className="text-xs text-slate-400 mb-1">Password</div><input type="password" className="w-full p-3 rounded-xl bg-slate-900/70 border border-white/10" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} /></label>
          <button onClick={doLogin} disabled={busy} className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">{busy?'Signing in...':'Sign in to Portal'}</button>
          <div className="text-xs text-slate-400">Use your subscriber credentials (client code/username/phone and password). If no password is set, use your client code/username/phone as password (as configured).</div>
        </div>
      </div>
    );
  }

  const sub = me.subscriber || {};
  const sess = me.session || null;
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div><h1 className="text-2xl font-black">Customer Self-Care</h1><p className="text-sm text-slate-400">Welcome, {sub.full_name} ({sub.client_code})</p></div>
          <div className="flex gap-2"><button onClick={()=>load(token!)} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 inline-flex items-center gap-2 text-sm"><RefreshCw className="w-4 h-4"/>Refresh</button><button onClick={logout} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 inline-flex items-center gap-2 text-sm"><LogOut className="w-4 h-4"/>Logout</button></div>
        </div>
        {err && <div className="text-sm p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{err}</div>}
        {msg && <div className="text-sm p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{msg}</div>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><div className="text-xs text-slate-400">Status</div><div className="text-lg font-bold mt-1">{sub.status}</div><div className="text-xs text-slate-500 mt-1">{sess?.status==='ONLINE' ? `Online • ${sess.ip_address||''}` : 'Offline / no live session'}</div></div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><div className="text-xs text-slate-400">Package</div><div className="text-lg font-bold mt-1">{sub.package_name||'-'}</div><div className="text-xs text-slate-500 mt-1">{sub.bandwidth_mbps ? `${sub.bandwidth_mbps} Mbps` : ''}</div></div>
          <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5"><div className="text-xs text-amber-300/80">Current Due</div><div className="text-lg font-bold mt-1 text-amber-400">{money(sub.current_due)}</div></div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><div className="text-xs text-slate-400">Expiry / Due Date</div><div className="text-sm font-bold mt-1">{sub.expiry_date ? new Date(sub.expiry_date).toLocaleDateString() : '-'}</div><div className="text-xs text-slate-500">{sub.due_date ? `Due: ${new Date(sub.due_date).toLocaleDateString()}` : ''}</div></div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ['overview','Overview',Wifi],['invoices','Invoices',Receipt],['payments','Payments',CreditCard],['speedtest','Speedtest',Gauge],['wifi','Wi-Fi (TR-069)',Wifi]
          ].map(([k,label,Icon]:any)=>(<button key={k} onClick={()=>setTab(k)} className={`px-3 py-2 rounded-xl text-sm inline-flex items-center gap-2 border ${tab===k?'bg-cyan-600 border-cyan-500':'bg-white/5 border-white/10 hover:bg-white/10'}`}><Icon className="w-4 h-4"/>{label}</button>))}
        </div>

        {tab==='overview' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">Subscription</h2><div className="text-sm space-y-2 text-slate-300"><div><b>Account:</b> {sub.client_code} • {sub.username||'-'}</div><div><b>Connection:</b> {sub.connection_type} ({sub.provisioning_mode})</div><div><b>Monthly Bill:</b> {money(sub.monthly_bill)}</div><div><b>Address:</b> {sub.address||'-'}</div><div><b>Session:</b> {sess ? `${sess.status} • RX ${Math.round((sess.rx_bps||0)/1000)} kbps / TX ${Math.round((sess.tx_bps||0)/1000)} kbps` : 'No active session data'}</div></div></div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">Recent Invoices</h2><div className="space-y-2">{invoices.slice(0,5).map(inv=>(<div key={inv.id} className="p-3 rounded-xl bg-slate-900/50 border border-white/5 flex items-center justify-between gap-3"><div><div className="font-medium text-sm">{inv.invoice_number}</div><div className="text-xs text-slate-400">{inv.bill_month} • Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '-'}</div></div><div className="text-right"><div className="font-semibold">{money(inv.due_amount || inv.total_amount)}</div><div className="text-xs text-slate-400">{inv.status}</div></div></div>))}{!invoices.length && <div className="text-sm text-slate-400">No invoices found.</div>}</div></div>
        </div>}

        {tab==='invoices' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
          <h2 className="font-bold">Invoice History & Online Payment</h2>
          {invoices.map(inv => (
            <div key={inv.id} className="p-3 rounded-xl bg-slate-900/50 border border-white/5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div><div className="font-medium">{inv.invoice_number} <span className="text-xs text-slate-400">({inv.status})</span></div><div className="text-xs text-slate-400">Period {inv.period_start ? new Date(inv.period_start).toLocaleDateString():''} - {inv.period_end ? new Date(inv.period_end).toLocaleDateString():''} • Total {money(inv.total_amount)} • Due {money(inv.due_amount)}</div></div>
              <div className="flex flex-wrap items-center gap-2">
                <a className="px-3 py-2 rounded-lg border border-white/10 text-sm inline-flex items-center gap-1" href={`${getApiBaseUrl()}/api/portal/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" onClick={(e)=>{e.preventDefault(); fetch(`${getApiBaseUrl()}/api/portal/invoices/${inv.id}/pdf`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b); window.open(u,'_blank');});}}><Download className="w-4 h-4"/>PDF</a>
                {Number(inv.due_amount||0)>0 && gateways.slice(0,4).map((g:any)=>(<button key={g.gateway} onClick={()=>payInvoice(inv, g.gateway)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm">Pay via {String(g.gateway).toUpperCase()}</button>))}
              </div>
            </div>
          ))}
          {!invoices.length && <div className="text-sm text-slate-400">No invoices found.</div>}
        </div>}

        {tab==='payments' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">Payment History</h2><div className="space-y-2">{payments.map(p=>(<div key={p.id} className="p-3 rounded-xl bg-slate-900/50 border border-white/5 flex items-center justify-between"><div><div className="font-medium text-sm">{p.payment_ref}</div><div className="text-xs text-slate-400">{String(p.gateway).toUpperCase()} • {p.trx_id||'-'} • {new Date(p.created_at).toLocaleString()}</div></div><div className="text-right"><div className="font-semibold">{money(p.amount)}</div><div className="text-xs text-slate-400">{p.status}</div></div></div>))}{!payments.length && <div className="text-sm text-slate-400">No payments found.</div>}</div></div>}

        {tab==='speedtest' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-4">
          <h2 className="font-bold flex items-center gap-2"><Gauge className="w-4 h-4 text-cyan-400"/>Live Bandwidth Speedtest</h2>
          <p className="text-sm text-slate-400">Browser-based download/upload test against IzanDesk server (results depend on your device, Wi-Fi/LAN and path to server).</p>
          <button onClick={runSpeedtest} disabled={busy} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">{busy?'Testing...':'Run Speedtest'}</button>
          {speed && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[['Download', `${speed.downMbps} Mbps`],['Upload', `${speed.upMbps} Mbps`],['Ping', `${speed.pingMs} ms`]].map(([l,v]:any)=>(<div key={l} className="p-4 rounded-xl bg-slate-900/60 border border-white/10"><div className="text-xs text-slate-400">{l}</div><div className="text-xl font-black mt-1">{v}</div></div>))}</div>}
          {speed && <div className="text-xs text-slate-500">Measured at {speed.at}</div>}
        </div>}

        {tab==='wifi' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-4">
          <h2 className="font-bold flex items-center gap-2"><Wifi className="w-4 h-4 text-cyan-400"/>Wi-Fi SSID & Password (TR-069 / GenieACS)</h2>
          <p className="text-sm text-slate-400">Update CPE Wi-Fi settings via GenieACS/TR-069. Requires GenieACS to be configured and the CPE online/managed (device ID from ACS).</p>
          <div className="text-xs p-3 rounded-xl border border-white/10 bg-slate-900/50">ACS status: <b>{acs?.configured ? 'Configured' : 'Not configured'}</b>{acs?.baseUrl ? ` (${acs.baseUrl})` : ''}. {acs?.configured ? 'Submit a Wi-Fi change task for your managed device.' : 'Set GENIEACS_URL/credentials on server to enable.'}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block"><div className="text-xs text-slate-400 mb-1">ACS Device ID</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={wifi.device_id} onChange={e=>setWifi({...wifi,device_id:e.target.value})} placeholder="e.g. 202BC1-Device..." /></label>
            <label className="block"><div className="text-xs text-slate-400 mb-1">New SSID</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={wifi.ssid} onChange={e=>setWifi({...wifi,ssid:e.target.value})} /></label>
            <label className="block"><div className="text-xs text-slate-400 mb-1">New Wi-Fi Password</div><input type="password" className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={wifi.password} onChange={e=>setWifi({...wifi,password:e.target.value})} /></label>
          </div>
          <button onClick={saveWifi} disabled={busy || !wifi.device_id || (!wifi.ssid && !wifi.password)} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">Apply Wi-Fi Settings</button>
        </div>}
      </div>
    </div>
  );
}
