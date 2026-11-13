'use client';

import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api';
import { Wifi, Receipt, CreditCard, Gauge, LogOut, RefreshCw, Download, User, LifeBuoy, BarChart3, Bell, KeyRound, Send, Package, FileText, Upload } from 'lucide-react';

const money = (v:any) => `৳${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtBytes = (n:any) => { const x=Number(n||0); if(x>1e9) return (x/1e9).toFixed(2)+' GB'; if(x>1e6) return (x/1e6).toFixed(2)+' MB'; if(x>1e3) return (x/1e3).toFixed(1)+' KB'; return x+' B'; };
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
  const [tickets, setTickets] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [ann, setAnn] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any>({ announcements: [], messages: [] });
  const [tab, setTab] = useState<'overview'|'invoices'|'payments'|'usage'|'tickets'|'plans'|'documents'|'notifications'|'speedtest'|'wifi'|'profile'>('overview');
  const [msg, setMsg] = useState<string|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState<any>(null);
  const [wifi, setWifi] = useState({ device_id: '', ssid: '', password: '' });
  const [acs, setAcs] = useState<any>(null);
  const [profile, setProfile] = useState<any>({ phone:'', email:'', address:'', nid_number:'' });
  const [pw, setPw] = useState({ current_password:'', new_password:'' });
  const [newTicket, setNewTicket] = useState({ subject:'', description:'', priority:'MEDIUM', category:'SUPPORT' });
  const [ticketDetail, setTicketDetail] = useState<any>(null);
  const [comment, setComment] = useState('');
  const [docType, setDocType] = useState('NID');
  const [live, setLive] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>({ auto_pay_enabled: false, preferred_gateway: '' });
  const [liveHistory, setLiveHistory] = useState<any[]>([]);

  useEffect(() => { const t = localStorage.getItem('portal_token'); if (t) setToken(t); }, []);

  const load = async (tkn = token) => {
    if (!tkn) return;
    try {
      const [m, inv, pay, gw, acsStatus, tix, usg, an, pkgs, docs, notifs, prefRes, liveRes] = await Promise.all([
        pfetch('/api/portal/me', {}, tkn),
        pfetch('/api/portal/invoices', {}, tkn),
        pfetch('/api/portal/payments', {}, tkn),
        fetch(`${getApiBaseUrl()}/api/portal/gateways`).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${getApiBaseUrl()}/api/acs/status`).then(r=>r.json()).catch(()=>({configured:false})),
        pfetch('/api/portal/tickets', {}, tkn).catch(()=>({data:[]})),
        pfetch('/api/portal/usage', {}, tkn).catch(()=>({sessions:[],daily:[]})),
        fetch(`${getApiBaseUrl()}/api/portal/announcements`).then(r=>r.json()).catch(()=>({data:[]})),
        pfetch('/api/portal/packages', {}, tkn).catch(()=>({data:[]})),
        pfetch('/api/portal/documents', {}, tkn).catch(()=>({data:[]})),
        pfetch('/api/portal/notifications', {}, tkn).catch(()=>({announcements:[],messages:[]})),
        pfetch('/api/portal/preferences', {}, tkn).catch(()=>({preferences:{auto_pay_enabled:false,preferred_gateway:''}})),
        pfetch('/api/portal/live', {}, tkn).catch(()=>({session:null})),
      ]);
      setMe(m); setInvoices(inv.data||[]); setPayments(pay.data||[]);
      const gwList = Array.isArray(gw?.data) ? gw.data : Array.isArray(gw) ? gw : [];
      const g = gwList.filter((x:any)=>x && x.gateway);
      setGateways(g.length?g:[{gateway:'bkash',mode:'SANDBOX'},{gateway:'nagad',mode:'SANDBOX'},{gateway:'stripe',mode:'SANDBOX'}]);
      setAcs(acsStatus); setTickets(tix.data||[]); setUsage(usg); setAnn(an.data||[]);
      setPackages(pkgs.data||[]); setDocuments(docs.data||[]); setNotifications(notifs||{announcements:[],messages:[]});
      setPrefs(prefRes.preferences || { auto_pay_enabled: false, preferred_gateway: '' });
      setLive(liveRes.session || null);
      if (liveRes.session) setLiveHistory(h => [...h.slice(-29), { t: Date.now(), rx: Number(liveRes.session.rx_bps||0), tx: Number(liveRes.session.tx_bps||0) }]);
      const s = m.subscriber || {};
      setProfile({ phone: s.phone||'', email: s.email||'', address: s.address||'', nid_number: s.nid_number||'' });
    } catch (e:any) { setErr(e.message); if (String(e.message).includes('session') || String(e.message).includes('token')) { localStorage.removeItem('portal_token'); setToken(null); } }
  };
  useEffect(() => { if (token) load(token); }, [token]);
  useEffect(() => {
    if (!token) return;
    const poll = async () => { try { const r = await pfetch('/api/portal/live', {}, token); const sess = r.session||null; setLive(sess); if (sess) setLiveHistory(h => [...h.slice(-29), { t: Date.now(), rx: Number(sess.rx_bps||0), tx: Number(sess.tx_bps||0) }]); } catch {} };
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, [token]);

  const doLogin = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await pfetch('/api/portal/login', { method:'POST', body: JSON.stringify({ client_code: login.id, username: login.id, phone: login.id, password: login.password }) });
      localStorage.setItem('portal_token', r.token); setToken(r.token); setMsg('Logged in'); setErr(null);
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };
  const logout = () => { localStorage.removeItem('portal_token'); setToken(null); setMe(null); };

  const payInvoice = async (inv: any, gateway: string) => {
    if (!token) return; setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await pfetch('/api/portal/payments/checkout', { method:'POST', body: JSON.stringify({ invoice_id: inv.id, gateway, amount: inv.due_amount || inv.total_amount, return_url: window.location.href }) }, token);
      const url = r.checkout?.paymentUrl || r.checkout?.url || r.payment?.checkout_url;
      if (url) { window.open(url, '_blank'); setMsg('Checkout created. Complete payment in the opened window.'); }
      else setMsg('Checkout created (simulated if gateway not live-configured).');
      await load(token);
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };

  const runSpeedtest = async () => {
    setBusy(true); setErr(null); setSpeed(null);
    try {
      const base = getApiBaseUrl();
      const t1 = performance.now(); const dl = await fetch(`${base}/api/portal/speedtest/download?cb=${Date.now()}`, { cache:'no-store' }); const buf = await dl.arrayBuffer(); const t2 = performance.now();
      const downMbps = ((buf.byteLength * 8) / ((t2-t1)/1000)) / 1e6;
      const upData = new Uint8Array(1024*1024); const t3 = performance.now(); await fetch(`${base}/api/portal/speedtest/upload?cb=${Date.now()}`, { method:'POST', body: upData, headers: { 'Content-Type':'application/octet-stream' } }); const t4 = performance.now();
      const upMbps = ((upData.byteLength * 8) / ((t4-t3)/1000)) / 1e6;
      const ping = await (async()=>{ const s=performance.now(); await fetch(`${base}/api/health?cb=${Date.now()}`,{cache:'no-store'}); return performance.now()-s; })();
      setSpeed({ downMbps:+downMbps.toFixed(2), upMbps:+upMbps.toFixed(2), pingMs:+ping.toFixed(1), at: new Date().toLocaleString() });
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };

  const saveWifi = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/acs/wifi`, { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(wifi) });
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d?.message || 'Failed to update Wi-Fi');
      setMsg('Wi-Fi update task submitted via TR-069/GenieACS (if configured and device reachable).');
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };

  const saveProfile = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/profile', { method:'PUT', body: JSON.stringify(profile) }, token); setMsg('Profile updated'); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const changePassword = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/change-password', { method:'POST', body: JSON.stringify(pw) }, token); setMsg('Password changed'); setPw({current_password:'',new_password:''}); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const createTicket = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/tickets', { method:'POST', body: JSON.stringify(newTicket) }, token); setMsg('Support ticket submitted'); setNewTicket({subject:'',description:'',priority:'MEDIUM',category:'SUPPORT'}); await load(token); setTab('tickets'); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const openTicket = async (id: string) => { if (!token) return; try { const r = await pfetch(`/api/portal/tickets/${id}`, {}, token); setTicketDetail(r.data); } catch(e:any){ setErr(e.message); } };
  const addComment = async () => { if (!token || !ticketDetail || !comment.trim()) return; setBusy(true); try { await pfetch(`/api/portal/tickets/${ticketDetail.id}/comments`, { method:'POST', body: JSON.stringify({ body: comment }) }, token); setComment(''); await openTicket(ticketDetail.id); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const requestPlan = async (pkg: any) => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/package-request', { method:'POST', body: JSON.stringify({ package_id: pkg.id, package_name: pkg.name }) }, token); setMsg(`Plan change request submitted for ${pkg.name}`); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const uploadDoc = async (file: File) => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { const fd = new FormData(); fd.append('file', file); fd.append('doc_type', docType); const res = await fetch(`${getApiBaseUrl()}/api/portal/documents`, { method:'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }); const d = await res.json().catch(()=>({})); if(!res.ok) throw new Error(d?.message||'Upload failed'); setMsg('Document uploaded'); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const openDoc = async (id: string) => { if (!token) return; const res = await fetch(`${getApiBaseUrl()}/api/portal/documents/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }); if(!res.ok) { setErr('Failed to open document'); return; } const b = await res.blob(); window.open(URL.createObjectURL(b), '_blank'); };
  const savePrefs = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { const r = await pfetch('/api/portal/preferences', { method:'PUT', body: JSON.stringify(prefs) }, token); setPrefs(r.preferences||prefs); setMsg('Payment preferences saved'); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };

  if (!token || !me) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 space-y-4 shadow-2xl">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black">I</div><div><div className="font-bold text-lg">IzanDesk Self-Care Portal</div><div className="text-xs text-slate-400">Subscription, invoices, payments, usage, tickets, plans & more</div></div></div>
          {err && <div className="text-sm p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{err}</div>}
          <label className="block"><div className="text-xs text-slate-400 mb-1">Client Code / Username / Phone</div><input className="w-full p-3 rounded-xl bg-slate-900/70 border border-white/10" value={login.id} onChange={e=>setLogin({...login,id:e.target.value})} /></label>
          <label className="block"><div className="text-xs text-slate-400 mb-1">Password</div><input type="password" className="w-full p-3 rounded-xl bg-slate-900/70 border border-white/10" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} /></label>
          <button onClick={doLogin} disabled={busy} className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">{busy?'Signing in...':'Sign in to Portal'}</button>
          <div className="text-xs text-slate-400">Use your subscriber credentials. If no password is set, your client code/username/phone may be accepted.</div>
        </div>
      </div>
    );
  }

  const sub = me.subscriber || {};
  const sess = live || me.session || null;
  const isOnline = String(sess?.status||'').toUpperCase() === 'ONLINE';
  const monthUsage = (usage?.daily||[]).reduce((a:any,d:any)=>({rx:a.rx+Number(d.rx_bytes||0),tx:a.tx+Number(d.tx_bytes||0),sec:a.sec+Number(d.session_seconds||0)}),{rx:0,tx:0,sec:0});
  const tabs: any[] = [['overview','Overview',Wifi],['invoices','Invoices',Receipt],['payments','Payments',CreditCard],['usage','Usage',BarChart3],['tickets','Support',LifeBuoy],['plans','Plans',Package],['documents','Documents',FileText],['notifications','Notifications',Bell],['speedtest','Speedtest',Gauge],['wifi','Wi-Fi',Wifi],['profile','Profile',User]];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div><h1 className="text-2xl font-black">Customer Self-Care</h1><p className="text-sm text-slate-400">Welcome, {sub.full_name} ({sub.client_code})</p></div>
          <div className="flex gap-2"><button onClick={()=>load(token!)} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 inline-flex items-center gap-2 text-sm"><RefreshCw className="w-4 h-4"/>Refresh</button><button onClick={logout} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 inline-flex items-center gap-2 text-sm"><LogOut className="w-4 h-4"/>Logout</button></div>
        </div>
        {err && <div className="text-sm p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{err}</div>}
        {msg && <div className="text-sm p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{msg}</div>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={`p-4 rounded-2xl border ${isOnline?'border-emerald-500/20 bg-emerald-500/5':'border-white/10 bg-white/5'}`}><div className="text-xs text-slate-400">Connection</div><div className={`text-lg font-bold mt-1 ${isOnline?'text-emerald-400':''}`}>{isOnline?'ONLINE':'OFFLINE'}</div><div className="text-xs text-slate-500 mt-1">{sess?.ip_address ? `IP ${sess.ip_address}` : 'No live session'}{sess?.source==='radacct' ? ' • RADIUS' : ''}</div></div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><div className="text-xs text-slate-400">Package</div><div className="text-lg font-bold mt-1">{sub.package_name||'-'}</div><div className="text-xs text-slate-500 mt-1">{sub.bandwidth_mbps ? `${sub.bandwidth_mbps} Mbps` : ''} • {sub.connection_type}</div></div>
          <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5"><div className="text-xs text-amber-300/80">Current Due</div><div className="text-lg font-bold mt-1 text-amber-400">{money(sub.current_due)}</div></div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><div className="text-xs text-slate-400">30d Usage</div><div className="text-sm font-bold mt-1">↓ {fmtBytes(monthUsage.rx)} ↑ {fmtBytes(monthUsage.tx)}</div><div className="text-xs text-slate-500">{Math.round(monthUsage.sec/3600)}h session time</div></div>
        </div>

        {!!(notifications.announcements||ann).length && <div className="p-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5"><div className="font-semibold flex items-center gap-2 mb-2"><Bell className="w-4 h-4 text-cyan-400"/>Announcements</div><div className="space-y-2">{((notifications.announcements||ann) as any[]).slice(0,3).map((a:any,i:number)=>(<div key={a.id||i} className="text-sm"><div className="font-medium">{a.title}</div><div className="text-slate-300">{a.body}</div></div>))}</div></div>}

        <div className="flex flex-wrap gap-2">
          {tabs.map(([k,label,Icon]:any)=>(<button key={k} onClick={()=>{setTab(k); if(k==='tickets') setTicketDetail(null);}} className={`px-3 py-2 rounded-xl text-sm inline-flex items-center gap-2 border ${tab===k?'bg-cyan-600 border-cyan-500':'bg-white/5 border-white/10 hover:bg-white/10'}`}><Icon className="w-4 h-4"/>{label}</button>))}
        </div>

        {tab==='overview' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold">Subscription</h2><div className="text-sm space-y-2 text-slate-300"><div><b>Account:</b> {sub.client_code} • {sub.username||'-'}</div><div><b>Status:</b> {sub.status} {sub.suspension_stage && sub.suspension_stage!=='NONE' ? `(${sub.suspension_stage})` : ''}</div><div><b>Connection:</b> {sub.connection_type} ({sub.provisioning_mode})</div><div><b>Monthly Bill:</b> {money(sub.monthly_bill)}</div><div><b>Address:</b> {sub.address||'-'}</div></div><div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2"><div className="text-xs text-slate-400">Live Traffic (auto-refresh every 15s)</div><div className="text-sm font-medium">{sess ? `${sess.status} • ${sess.ip_address||'-'}` : 'No active session'}</div><div className="text-xs text-slate-300">RX {fmtBytes(sess?.rx_bytes||0)} total • TX {fmtBytes(sess?.tx_bytes||0)} total • Rate ↓{Math.round(Number(sess?.rx_bps||0)/1000)} kbps ↑{Math.round(Number(sess?.tx_bps||0)/1000)} kbps</div>{sess?.uptime_seconds!=null && <div className="text-xs text-slate-400">Uptime: {Math.round(Number(sess.uptime_seconds||0)/60)} min</div>}{liveHistory.length>1 && (()=>{const max=Math.max(1,...liveHistory.map(h=>Math.max(h.rx,h.tx)));return (<div><div className="text-[10px] text-slate-500 mb-1">Live rate samples (↓ RX / ↑ TX)</div><div className="flex items-end gap-0.5 h-10">{liveHistory.slice(-24).map((h,i)=>(<div key={i} className="flex-1 flex flex-col justify-end gap-px h-full"><div className="w-full bg-cyan-500/70 rounded-sm" style={{height:`${Math.max(2,(h.rx/max)*100)}%`}} title={`RX ${Math.round(h.rx/1000)} kbps`}/><div className="w-full bg-emerald-500/70 rounded-sm" style={{height:`${Math.max(2,(h.tx/max)*100)}%`}} title={`TX ${Math.round(h.tx/1000)} kbps`}/></div>))}</div></div>);})()}</div>{me.quota ? (<div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2"><div className="flex items-center justify-between text-xs"><span className="text-slate-400">FUP/Quota ({me.quota.period.replace('_',' ')})</span><span className={me.quota.over_cap?'text-red-400 font-semibold':'text-slate-300'}>{me.quota.over_cap?'Over cap':'Within cap'}</span></div><div className="text-sm">{fmtBytes(me.quota.used_bytes)} used of {me.quota.cap_gb} GB {me.quota.fup_speed_mbps ? `• FUP ${me.quota.fup_speed_mbps} Mbps` : ''}</div><div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className={`${me.quota.over_cap?'bg-red-500':'bg-cyan-500'} h-full`} style={{width:`${Math.min(100,me.quota.percent)}%`}}/></div><div className="text-xs text-slate-400">Remaining: {fmtBytes(me.quota.remaining_bytes)} ({Math.max(0,100-me.quota.percent).toFixed(1)}%) • policy enforcement depends on NAS/RADIUS configuration.</div></div>) : (<div className="text-xs text-slate-400">Quota/FUP: no data cap configured for this package (30-day usage shown in Usage).</div>)}</div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">Recent Invoices</h2><div className="space-y-2">{invoices.slice(0,5).map(inv=>(<div key={inv.id} className="p-3 rounded-xl bg-slate-900/50 border border-white/5 flex items-center justify-between gap-3"><div><div className="font-medium text-sm">{inv.invoice_number}</div><div className="text-xs text-slate-400">{inv.bill_month} • Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '-'}</div></div><div className="text-right"><div className="font-semibold">{money(inv.due_amount || inv.total_amount)}</div><div className="text-xs text-slate-400">{inv.status}</div></div></div>))}{!invoices.length && <div className="text-sm text-slate-400">No invoices found.</div>}</div></div>
        </div>}

        {tab==='invoices' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold">Invoices & Online Payment</h2>{invoices.map(inv => (<div key={inv.id} className="p-3 rounded-xl bg-slate-900/50 border border-white/5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"><div><div className="font-medium">{inv.invoice_number} <span className="text-xs text-slate-400">({inv.status})</span></div><div className="text-xs text-slate-400">Period {inv.period_start ? new Date(inv.period_start).toLocaleDateString():''} - {inv.period_end ? new Date(inv.period_end).toLocaleDateString():''} • Total {money(inv.total_amount)} • Due {money(inv.due_amount)}</div></div><div className="flex flex-wrap items-center gap-2"><button className="px-3 py-2 rounded-lg border border-white/10 text-sm inline-flex items-center gap-1" onClick={()=>{ fetch(`${getApiBaseUrl()}/api/portal/invoices/${inv.id}/pdf`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b); window.open(u,'_blank');}); }}><Download className="w-4 h-4"/>PDF</button>{Number(inv.due_amount||0)>0 && gateways.slice(0,4).map((g:any)=>(<button key={g.gateway} onClick={()=>payInvoice(inv, g.gateway)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm">Pay {String(g.gateway).toUpperCase()}</button>))}</div></div>))}{!invoices.length && <div className="text-sm text-slate-400">No invoices found.</div>}</div>}
        {tab==='payments' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">Payment History</h2><div className="space-y-2">{payments.map(p=>(<div key={p.id} className="p-3 rounded-xl bg-slate-900/50 border border-white/5 flex items-center justify-between"><div><div className="font-medium text-sm">{p.payment_ref}</div><div className="text-xs text-slate-400">{String(p.gateway).toUpperCase()} • {p.trx_id||'-'} • {new Date(p.created_at).toLocaleString()}</div></div><div className="text-right"><div className="font-semibold">{money(p.amount)}</div><div className="text-xs text-slate-400">{p.status}</div></div></div>))}{!payments.length && <div className="text-sm text-slate-400">No payments found.</div>}</div></div>}

        {tab==='usage' && <div className="space-y-4">{me.quota && <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-2">Monthly FUP / Data Cap</h2><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm"><div>{fmtBytes(me.quota.used_bytes)} used of {me.quota.cap_gb} GB {me.quota.fup_speed_mbps ? `• FUP speed ${me.quota.fup_speed_mbps} Mbps` : ''}</div><div className={me.quota.over_cap?'text-red-400 font-semibold':'text-emerald-400'}>{me.quota.over_cap?'Over cap':'Within cap'} • {me.quota.percent.toFixed(2)}%</div></div><div className="mt-2 h-2.5 rounded-full bg-white/10 overflow-hidden"><div className={`${me.quota.over_cap?'bg-red-500':'bg-cyan-500'} h-full`} style={{width:`${Math.min(100,me.quota.percent)}%`}}/></div><div className="text-xs text-slate-400 mt-1">Remaining {fmtBytes(me.quota.remaining_bytes)} for {me.quota.period.replace('_',' ')}. Enforcement/signaling depends on NAS/RADIUS policy.</div></div>}<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-400"/>Daily Usage (30 days)</h2>
            <div className="space-y-2 max-h-[420px] overflow-auto">{(usage?.daily||[]).map((d:any,i:number)=>{const total=Number(d.rx_bytes||0)+Number(d.tx_bytes||0); const max=Math.max(1,...((usage?.daily||[]).map((x:any)=>Number(x.rx_bytes||0)+Number(x.tx_bytes||0)))); const w=Math.max(6,Math.round((total/max)*100)); return (<div key={i} className="p-2.5 rounded-xl bg-slate-900/50 border border-white/5 text-sm"><div className="flex items-center justify-between"><div><div className="font-medium">{d.day ? new Date(d.day).toLocaleDateString() : '-'}</div><div className="text-xs text-slate-400">{d.sessions} session(s) • {Math.round(Number(d.session_seconds||0)/60)} min</div></div><div className="text-right text-xs"><div>↓ {fmtBytes(d.rx_bytes)}</div><div>↑ {fmtBytes(d.tx_bytes)}</div></div></div><div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-cyan-500" style={{width:`${w}%`}}/></div></div>);})}{!(usage?.daily||[]).length && <div className="text-sm text-slate-400">No usage data yet (requires RADIUS accounting).</div>}</div>
          </div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">Recent Sessions</h2><div className="space-y-2 max-h-[420px] overflow-auto">{(usage?.sessions||[]).slice(0,20).map((s:any,i:number)=>(<div key={i} className="p-2.5 rounded-xl bg-slate-900/50 border border-white/5 text-sm"><div className="flex items-center justify-between"><div className="font-medium">{s.ip_address||'-'}</div><div className="text-xs text-slate-400">{s.acctstoptime ? 'Ended' : 'Active/Open'}</div></div><div className="text-xs text-slate-400 mt-1">Start: {s.acctstarttime ? new Date(s.acctstarttime).toLocaleString() : '-'}{s.acctstoptime ? ` • Stop: ${new Date(s.acctstoptime).toLocaleString()}` : ''}</div><div className="text-xs mt-1">↓ {fmtBytes(s.rx_bytes)} ↑ {fmtBytes(s.tx_bytes)} • {Math.round(Number(s.acctsessiontime||0)/60)} min {s.acctterminatecause ? `• ${s.acctterminatecause}` : ''}</div></div>))}{!(usage?.sessions||[]).length && <div className="text-sm text-slate-400">No session history found.</div>}</div></div>
        </div></div>}

        {tab==='tickets' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-cyan-400"/>Create Support Ticket</h2><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-sm" placeholder="Subject" value={newTicket.subject} onChange={e=>setNewTicket({...newTicket,subject:e.target.value})} /><div className="grid grid-cols-2 gap-2"><select className="p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-sm" value={newTicket.priority} onChange={e=>setNewTicket({...newTicket,priority:e.target.value})}>{['LOW','MEDIUM','HIGH','CRITICAL'].map(p=><option key={p} value={p}>{p}</option>)}</select><select className="p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-sm" value={newTicket.category} onChange={e=>setNewTicket({...newTicket,category:e.target.value})}>{['SUPPORT','BILLING','NETWORK','INSTALLATION','OTHER'].map(p=><option key={p} value={p}>{p}</option>)}</select></div><textarea className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-sm min-h-[90px]" placeholder="Describe your issue..." value={newTicket.description} onChange={e=>setNewTicket({...newTicket,description:e.target.value})} /><button onClick={createTicket} disabled={busy || !newTicket.subject} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">Submit Ticket</button></div>
            <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">My Tickets</h2><div className="space-y-2 max-h-[420px] overflow-auto">{tickets.map(t=>(<button key={t.id} onClick={()=>openTicket(t.id)} className={`w-full text-left p-3 rounded-xl border ${ticketDetail?.id===t.id?'border-cyan-500 bg-cyan-500/10':'border-white/5 bg-slate-900/50 hover:bg-slate-900'}`}><div className="flex items-center justify-between gap-2"><div className="font-medium text-sm">{t.ticket_no} — {t.subject}</div><span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10">{t.status}</span></div><div className="text-xs text-slate-400 mt-1">{t.priority} • {t.category} • {t.created_at ? new Date(t.created_at).toLocaleString() : ''}</div></button>))}{!tickets.length && <div className="text-sm text-slate-400">No tickets yet.</div>}</div></div>
          </div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5">{!ticketDetail ? <div className="text-sm text-slate-400 py-10 text-center">Select a ticket to view details and replies.</div> : (<div className="space-y-3"><div><h2 className="font-bold">{ticketDetail.ticket_no}</h2><div className="text-sm text-slate-300">{ticketDetail.subject}</div><div className="text-xs text-slate-400 mt-1">{ticketDetail.status} • {ticketDetail.priority} • SLA due {ticketDetail.sla_due_at ? new Date(ticketDetail.sla_due_at).toLocaleString() : '-'}</div></div>{ticketDetail.description && <div className="text-sm p-3 rounded-xl bg-slate-900/60 border border-white/5 whitespace-pre-wrap">{ticketDetail.description}</div>}<div className="space-y-2 max-h-[320px] overflow-auto">{(ticketDetail.comments||[]).map((c:any)=>(<div key={c.id} className="p-2.5 rounded-xl bg-slate-900/50 border border-white/5 text-sm"><div className="flex items-center justify-between text-xs text-slate-400 mb-1"><span>{c.author_name} ({c.author_role||'USER'})</span><span>{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span></div><div className="whitespace-pre-wrap">{c.body}</div></div>))}{!(ticketDetail.comments||[]).length && <div className="text-xs text-slate-400">No replies yet.</div>}</div><div className="flex gap-2"><input className="flex-1 p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-sm" placeholder="Write a reply..." value={comment} onChange={e=>setComment(e.target.value)} /><button onClick={addComment} disabled={busy || !comment.trim()} className="px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"><Send className="w-4 h-4"/></button></div></div>)}</div>
        </div>}

        {tab==='plans' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold flex items-center gap-2"><Package className="w-4 h-4 text-cyan-400"/>Available Plans & Upgrade Requests</h2><p className="text-sm text-slate-400">Current: <b>{sub.package_name||'-'}</b> ({sub.bandwidth_mbps||'-'} Mbps). Request a plan change and our team will process it.</p><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{packages.map(p=>(<div key={p.id} className="p-4 rounded-xl border border-white/10 bg-slate-900/50 space-y-2"><div className="font-semibold">{p.name}</div><div className="text-sm text-slate-300">{p.download_mbps}/{p.upload_mbps} Mbps</div><div className="text-xs text-slate-400">{p.data_cap_gb ? `${Number(p.data_cap_gb)} GB/mo cap` : 'Unlimited data'}{p.fup_speed_mbps ? ` • FUP ${p.fup_speed_mbps} Mbps` : ''}</div><div className="text-lg font-bold text-cyan-400">{money(p.price)}</div>{p.description && <div className="text-xs text-slate-400">{p.description}</div>}<button onClick={()=>requestPlan(p)} disabled={busy || sub.package_name===p.name} className="w-full mt-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-semibold disabled:opacity-50">{sub.package_name===p.name?'Current Plan':'Request This Plan'}</button></div>))}{!packages.length && <div className="text-sm text-slate-400">No plans available.</div>}</div></div>}

        {tab==='documents' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold flex items-center gap-2"><FileText className="w-4 h-4 text-cyan-400"/>My Documents (KYC)</h2><div className="space-y-2">{documents.map(d=>(<button key={d.id} onClick={()=>openDoc(d.id)} className="w-full text-left p-3 rounded-xl bg-slate-900/50 border border-white/5 hover:bg-slate-900 flex items-center justify-between"><div><div className="font-medium text-sm">{d.doc_type} — {d.file_name}</div><div className="text-xs text-slate-400">{d.uploaded_at ? new Date(d.uploaded_at).toLocaleString():''}</div></div><span className="text-xs text-cyan-400">View</span></button>))}{!documents.length && <div className="text-sm text-slate-400">No documents uploaded.</div>}</div></div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold flex items-center gap-2"><Upload className="w-4 h-4 text-cyan-400"/>Upload Document</h2><select className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-sm" value={docType} onChange={e=>setDocType(e.target.value)}>{['NID','PASSPORT','CONTRACT','PHOTO','OTHER'].map(t=><option key={t} value={t}>{t}</option>)}</select><input type="file" className="w-full text-sm" onChange={e=>{const f=e.target.files?.[0]; if(f){ uploadDoc(f); e.currentTarget.value=''; }}} disabled={busy} /><p className="text-xs text-slate-400">Upload KYC/supporting documents (ID, contract, photo). Files are stored securely and visible to your ISP for verification.</p></div>
        </div>}

        {tab==='notifications' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-cyan-400"/>Announcements</h2><div className="space-y-2">{((notifications.announcements||[]) as any[]).map((a:any,i:number)=>(<div key={a.id||i} className="p-3 rounded-xl bg-slate-900/50 border border-white/5"><div className="font-medium text-sm">{a.title}</div><div className="text-sm text-slate-300 mt-1">{a.body}</div></div>))}{!(notifications.announcements||[]).length && <div className="text-sm text-slate-400">No announcements.</div>}</div></div>
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5"><h2 className="font-bold mb-3">Messages & Alerts</h2><div className="space-y-2 max-h-[480px] overflow-auto">{((notifications.messages||[]) as any[]).map((m:any,i:number)=>(<div key={m.id||i} className="p-3 rounded-xl bg-slate-900/50 border border-white/5"><div className="flex items-center justify-between gap-2"><div className="text-xs text-slate-400">{String(m.channel_type||'').toUpperCase()} • {String(m.provider||'')}</div><div className="text-[10px] px-2 py-0.5 rounded-full border border-white/10">{m.status}</div></div>{m.subject && <div className="font-medium text-sm mt-1">{m.subject}</div>}<div className="text-sm text-slate-300 mt-1 whitespace-pre-wrap">{m.body}</div><div className="text-xs text-slate-500 mt-1">{m.sent_at ? new Date(m.sent_at).toLocaleString() : (m.created_at ? new Date(m.created_at).toLocaleString() : '')}</div></div>))}{!(notifications.messages||[]).length && <div className="text-sm text-slate-400">No messages yet. Payment/invoice/ticket notifications sent to your registered contact will appear here when matched.</div>}</div></div>
        </div>}

        {tab==='speedtest' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-4"><h2 className="font-bold flex items-center gap-2"><Gauge className="w-4 h-4 text-cyan-400"/>Live Bandwidth Speedtest</h2><p className="text-sm text-slate-400">Browser-based download/upload test against IzanDesk server (results vary by device, Wi-Fi/LAN and path).</p><button onClick={runSpeedtest} disabled={busy} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">{busy?'Testing...':'Run Speedtest'}</button>{speed && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[['Download', `${speed.downMbps} Mbps`],['Upload', `${speed.upMbps} Mbps`],['Ping', `${speed.pingMs} ms`]].map(([l,v]:any)=>(<div key={l} className="p-4 rounded-xl bg-slate-900/60 border border-white/10"><div className="text-xs text-slate-400">{l}</div><div className="text-xl font-black mt-1">{v}</div></div>))}</div>}{speed && <div className="text-xs text-slate-500">Measured at {speed.at}</div>}</div>}

        {tab==='wifi' && <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-4"><h2 className="font-bold flex items-center gap-2"><Wifi className="w-4 h-4 text-cyan-400"/>Wi-Fi SSID & Password (TR-069 / GenieACS)</h2><p className="text-sm text-slate-400">Manage CPE Wi-Fi via GenieACS/TR-069. Requires GenieACS configured and the CPE device ID online in ACS.</p><div className="text-xs p-3 rounded-xl border border-white/10 bg-slate-900/50">ACS: <b>{acs?.configured ? 'Configured' : 'Not configured'}</b>{acs?.baseUrl ? ` (${acs.baseUrl})` : ''}</div><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><label className="block"><div className="text-xs text-slate-400 mb-1">ACS Device ID</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={wifi.device_id} onChange={e=>setWifi({...wifi,device_id:e.target.value})} /></label><label className="block"><div className="text-xs text-slate-400 mb-1">New SSID</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={wifi.ssid} onChange={e=>setWifi({...wifi,ssid:e.target.value})} /></label><label className="block"><div className="text-xs text-slate-400 mb-1">New Wi-Fi Password</div><input type="password" className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={wifi.password} onChange={e=>setWifi({...wifi,password:e.target.value})} /></label></div><button onClick={saveWifi} disabled={busy || !wifi.device_id || (!wifi.ssid && !wifi.password)} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">Apply Wi-Fi Settings</button></div>}

        {tab==='profile' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold flex items-center gap-2"><User className="w-4 h-4 text-cyan-400"/>Profile & Contact</h2><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="block"><div className="text-xs text-slate-400 mb-1">Phone</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={profile.phone||''} onChange={e=>setProfile({...profile,phone:e.target.value})} /></label><label className="block"><div className="text-xs text-slate-400 mb-1">Email</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={profile.email||''} onChange={e=>setProfile({...profile,email:e.target.value})} /></label><label className="block sm:col-span-2"><div className="text-xs text-slate-400 mb-1">Address</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={profile.address||''} onChange={e=>setProfile({...profile,address:e.target.value})} /></label><label className="block"><div className="text-xs text-slate-400 mb-1">NID/ID</div><input className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={profile.nid_number||''} onChange={e=>setProfile({...profile,nid_number:e.target.value})} /></label></div><button onClick={saveProfile} disabled={busy} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">Save Profile</button></div><div className="space-y-4"><div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold flex items-center gap-2"><KeyRound className="w-4 h-4 text-cyan-400"/>Change Password</h2><label className="block"><div className="text-xs text-slate-400 mb-1">Current Password</div><input type="password" className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={pw.current_password} onChange={e=>setPw({...pw,current_password:e.target.value})} /></label><label className="block"><div className="text-xs text-slate-400 mb-1">New Password</div><input type="password" className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10" value={pw.new_password} onChange={e=>setPw({...pw,new_password:e.target.value})} /></label><button onClick={changePassword} disabled={busy || !pw.new_password} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">Update Password</button><div className="text-xs text-slate-500 p-3 rounded-xl border border-white/10 bg-slate-900/50">If no password was previously set, your current password is your client code/username/phone.</div></div><div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3"><h2 className="font-bold flex items-center gap-2"><CreditCard className="w-4 h-4 text-cyan-400"/>Payment Preferences (Auto-pay)</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!prefs.auto_pay_enabled} onChange={e=>setPrefs({...prefs,auto_pay_enabled:e.target.checked})} /> Enable auto-pay preference</label><label className="block"><div className="text-xs text-slate-400 mb-1">Preferred Gateway</div><select className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/10 text-sm" value={prefs.preferred_gateway||''} onChange={e=>setPrefs({...prefs,preferred_gateway:e.target.value})}><option value="">Select gateway...</option>{gateways.map((g:any)=>(<option key={g.gateway} value={g.gateway}>{String(g.gateway).toUpperCase()}</option>))}</select></label><button onClick={savePrefs} disabled={busy} className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-semibold disabled:opacity-50">Save Preferences</button><div className="text-xs text-slate-500">Preferences are saved to your account. Automatic charging requires gateway tokenization/mandate setup.</div></div></div></div>}
      </div>
    </div>
  );
}
