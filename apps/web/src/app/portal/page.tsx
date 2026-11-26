'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api';
import { Wifi, Receipt, CreditCard, Gauge, LogOut, RefreshCw, Download, User, LifeBuoy, BarChart3, Bell, KeyRound, Send, Package, FileText, Upload, Menu, X } from 'lucide-react';

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
  const [reuploadFor, setReuploadFor] = useState<string | null>(null);
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
  const [savedMethods, setSavedMethods] = useState<any[]>([]);
  const [newMethod, setNewMethod] = useState<any>({ gateway: '', label: '', masked_identifier: '', is_default: false });
  const [menuOpen, setMenuOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState('');

  useEffect(() => { const t = localStorage.getItem('portal_token'); if (t) setToken(t); }, []);

  const load = useCallback(async (tkn = token) => {
    if (!tkn) return;
    try {
      const [m, inv, pay, gw, acsStatus, tix, usg, an, pkgs, docs, notifs, prefRes, liveRes, pmRes] = await Promise.all([
        pfetch('/api/portal/me', {}, tkn),
        pfetch('/api/portal/invoices', {}, tkn),
        pfetch('/api/portal/payments', {}, tkn),
        fetch(`${getApiBaseUrl()}/api/portal/gateways`).then(r=>r.json()).catch(()=>({data:[]})),
        pfetch('/api/portal/acs/status', {}, tkn).catch(()=>({ configured:false, devices:[] })),
        pfetch('/api/portal/tickets', {}, tkn).catch(()=>({data:[]})),
        pfetch('/api/portal/usage', {}, tkn).catch(()=>({sessions:[],daily:[]})),
        fetch(`${getApiBaseUrl()}/api/portal/announcements`).then(r=>r.json()).catch(()=>({data:[]})),
        pfetch('/api/portal/packages', {}, tkn).catch(()=>({data:[]})),
        pfetch('/api/portal/documents', {}, tkn).catch(()=>({data:[]})),
        pfetch('/api/portal/notifications', {}, tkn).catch(()=>({announcements:[],messages:[]})),
        pfetch('/api/portal/preferences', {}, tkn).catch(()=>({preferences:{auto_pay_enabled:false,preferred_gateway:''}})),
        pfetch('/api/portal/live', {}, tkn).catch(()=>({session:null})),
        pfetch('/api/portal/payment-methods', {}, tkn).catch(()=>({data:[]})),
      ]);
      setMe(m); setInvoices(inv.data||[]); setPayments(pay.data||[]);
      const gwList = Array.isArray(gw?.data) ? gw.data : Array.isArray(gw) ? gw : [];
      const g = gwList.filter((x:any)=>x && x.gateway);
      setGateways(g.length?g:[{gateway:'bkash',mode:'SANDBOX'},{gateway:'nagad',mode:'SANDBOX'},{gateway:'stripe',mode:'SANDBOX'}]);
      setAcs(acsStatus); setTickets(tix.data||[]); setUsage(usg); setAnn(an.data||[]);
      setPackages(pkgs.data||[]); setDocuments(docs.data||[]); setNotifications(notifs||{announcements:[],messages:[]});
      setPrefs(prefRes.preferences || { auto_pay_enabled: false, preferred_gateway: '' });
      setLive(liveRes.session || null);
      setSavedMethods(pmRes.data || []);
      if (liveRes.session) setLiveHistory(h => [...h.slice(-29), { t: Date.now(), rx: Number(liveRes.session.rx_bps||0), tx: Number(liveRes.session.tx_bps||0) }]);
      const s = m.subscriber || {};
      setProfile({ phone: s.phone||'', email: s.email||'', address: s.address||'', nid_number: s.nid_number||'' });
    } catch (e:any) { setErr(e.message); if (String(e.message).includes('session') || String(e.message).includes('token')) { localStorage.removeItem('portal_token'); setToken(null); } }
  }, [token]);
  useEffect(() => { if (token) load(token); }, [token, load]);
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
  const logout = () => { localStorage.removeItem('portal_token'); setToken(null); setMe(null); setMenuOpen(false); };

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

  const payAdvance = async (gateway: string) => {
    if (!token) return;
    const amount = Number(advanceAmount);
    if (!(amount > 0)) { setErr('Enter a valid advance payment amount'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await pfetch('/api/portal/payments/checkout', { method:'POST', body: JSON.stringify({ gateway, amount, return_url: window.location.href, metadata: { type: 'ADVANCE_PAYMENT' } }) }, token);
      const url = r.checkout?.paymentUrl || r.checkout?.url || r.payment?.checkout_url;
      if (url) { window.open(url, '_blank'); setMsg(`Advance payment checkout created for ${money(amount)}. Complete payment in the opened window.`); }
      else setMsg(`Advance payment checkout created for ${money(amount)} (simulated if gateway not live-configured).`);
      setAdvanceAmount('');
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
      if (!token) throw new Error('Portal session expired. Sign in again.');
      await pfetch('/api/portal/acs/wifi', { method:'POST', body: JSON.stringify(wifi) }, token);
      setMsg('Wi-Fi update task submitted via TR-069/GenieACS for your linked device.');
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };

  const saveProfile = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/profile', { method:'PUT', body: JSON.stringify(profile) }, token); setMsg('Profile updated'); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const changePassword = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/change-password', { method:'POST', body: JSON.stringify(pw) }, token); setMsg('Password changed'); setPw({current_password:'',new_password:''}); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const createTicket = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/tickets', { method:'POST', body: JSON.stringify(newTicket) }, token); setMsg('Support ticket submitted'); setNewTicket({subject:'',description:'',priority:'MEDIUM',category:'SUPPORT'}); await load(token); setTab('tickets'); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const openTicket = async (id: string) => { if (!token) return; try { const r = await pfetch(`/api/portal/tickets/${id}`, {}, token); setTicketDetail(r.data); } catch(e:any){ setErr(e.message); } };
  const addComment = async () => { if (!token || !ticketDetail || !comment.trim()) return; setBusy(true); try { await pfetch(`/api/portal/tickets/${ticketDetail.id}/comments`, { method:'POST', body: JSON.stringify({ body: comment }) }, token); setComment(''); await openTicket(ticketDetail.id); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const requestPlan = async (pkg: any) => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { await pfetch('/api/portal/package-request', { method:'POST', body: JSON.stringify({ package_id: pkg.id, package_name: pkg.name }) }, token); setMsg(`Plan change request submitted for ${pkg.name}`); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const uploadDoc = async (file: File) => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { const fd = new FormData(); fd.append('file', file); fd.append('doc_type', docType); if (reuploadFor) fd.append('reupload_of', reuploadFor); const res = await fetch(`${getApiBaseUrl()}/api/portal/documents`, { method:'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }); const d = await res.json().catch(()=>({})); if(!res.ok) throw new Error(d?.message||'Upload failed'); setMsg(reuploadFor ? 'Replacement uploaded and linked to the previous document. Our team will review it shortly.' : 'Document uploaded. It will appear as pending until reviewed.'); setReuploadFor(null); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const openDoc = async (id: string) => { if (!token) return; const res = await fetch(`${getApiBaseUrl()}/api/portal/documents/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }); if(!res.ok) { setErr('Failed to open document'); return; } const b = await res.blob(); window.open(URL.createObjectURL(b), '_blank'); };
  const savePrefs = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { const r = await pfetch('/api/portal/preferences', { method:'PUT', body: JSON.stringify(prefs) }, token); setPrefs(r.preferences||prefs); setMsg('Payment preferences saved'); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const addPaymentMethod = async () => { if (!token) return; setBusy(true); setErr(null); setMsg(null); try { const gw = newMethod.gateway || prefs.preferred_gateway || (gateways[0]?.gateway||''); await pfetch('/api/portal/payment-methods', { method:'POST', body: JSON.stringify({ ...newMethod, gateway: gw }) }, token); setNewMethod({ gateway:'', label:'', masked_identifier:'', is_default:false }); setMsg('Payment method saved (reference). Real auto-pay requires gateway tokenization/mandate.'); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };
  const removePaymentMethod = async (id:string) => { if (!token) return; setBusy(true); setErr(null); try { await pfetch(`/api/portal/payment-methods/${id}`, { method:'DELETE' }, token); await load(token); } catch(e:any){ setErr(e.message); } finally { setBusy(false); } };

  if (!token || !me) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <div className="card w-full max-w-md p-6 space-y-4">
          <div className="flex items-center gap-3"><div className="page-title-icon !w-10 !h-10">I</div><div><div className="font-bold text-lg">IzanDesk স্ব-পরিচর্যা পোর্টাল</div><div className="text-xs text-muted-foreground">সাবস্ক্রিপশন, ইনভয়েস, পেমেন্ট, ব্যবহার, টিকেট, প্ল্যান ও আরও</div></div></div>
          {err && <div className="alert alert-danger">{err}</div>}
          <label className="block"><div className="form-label">ক্লায়েন্ট কোড / ইউজারনেম / ফোন</div><input className="form-control" value={login.id} onChange={e=>setLogin({...login,id:e.target.value})} /></label>
          <label className="block"><div className="form-label">পাসওয়ার্ড</div><input type="password" className="form-control" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} /></label>
          <button onClick={doLogin} disabled={busy} className="btn btn-primary w-full">{busy?'সাইন ইন হচ্ছে...':'পোর্টালে সাইন ইন করুন'}</button>
          <div className="text-xs text-muted-foreground">আপনার সাবস্ক্রাইবার অ্যাকাউন্টের জন্য সেট করা পোর্টাল পাসওয়ার্ড ব্যবহার করুন। ক্লায়েন্ট কোড, ইউজারনেম এবং ফোন শুধু শনাক্তকারী।</div>
        </div>
      </div>
    );
  }

  const sub = me.subscriber || {};
  const sess = live || me.session || null;
  const isOnline = String(sess?.status||'').toUpperCase() === 'ONLINE';
  const monthUsage = (usage?.daily||[]).reduce((a:any,d:any)=>({rx:a.rx+Number(d.rx_bytes||0),tx:a.tx+Number(d.tx_bytes||0),sec:a.sec+Number(d.session_seconds||0)}),{rx:0,tx:0,sec:0});
  const tabs: any[] = [
    ['overview','ওভারভিউ',Wifi],
    ['invoices','ইনভয়েস',Receipt],
    ['payments','পেমেন্ট',CreditCard],
    ['usage','ব্যবহার',BarChart3],
    ['tickets','সাপোর্ট',LifeBuoy],
    ['plans','প্ল্যান',Package],
    ['documents','নথি',FileText],
    ['notifications','নোটিফিকেশন',Bell],
    ['speedtest','স্পিডটেস্ট',Gauge],
    ['wifi','ওয়াই-ফাই',Wifi],
    ['profile','প্রোফাইল',User],
  ];

  const current = tabs.find((t:any)=>t[0]===tab) || tabs[0];
  const selectTab = (k:any) => { setTab(k); setMenuOpen(false); if (k==='tickets') setTicketDetail(null); };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 border-b border-border/60 bg-card/95 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={()=>setMenuOpen(v=>!v)} className="p-2 rounded-lg border border-border/60 bg-muted/30"><Menu className="w-5 h-5"/></button>
          <div className="min-w-0"><div className="font-bold truncate">সেলফ-কെയার পোর্টাল</div><div className="text-xs text-muted-foreground truncate">{current[1]}</div></div>
        </div>
        <div className={`badge ${isOnline?'badge-success':'badge-secondary'}`}>{isOnline?'ONLINE':'OFFLINE'}</div>
      </div>

      {/* Mobile overlay sidebar */}
      {menuOpen && <div className="fixed inset-0 z-50 lg:hidden">
        <div className="absolute inset-0 bg-black/60" onClick={()=>setMenuOpen(false)} />
        <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-card border-r border-border/60 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><div className="page-title-icon !w-8 !h-8">I</div><div className="font-bold">IzanDesk</div></div>
            <button onClick={()=>setMenuOpen(false)} className="p-2 rounded-lg hover:bg-muted/50"><X className="w-4 h-4"/></button>
          </div>
          <div className="text-xs text-muted-foreground mb-3 px-1 truncate">{sub.full_name} • {sub.client_code}</div>
          <nav className="flex-1 space-y-1 overflow-auto">
            {tabs.map(([k,label,Icon]:any)=> (
              <button key={k} onClick={()=>selectTab(k)} className={`w-full text-left px-3 py-2.5 rounded-xl text-sm inline-flex items-center gap-2 ${tab===k?'bg-primary text-primary-foreground':'hover:bg-muted/50 text-foreground'}`}><Icon className="w-4 h-4"/>{label}</button>
            ))}
          </nav>
          <div className="pt-3 mt-3 border-t border-border/60 space-y-2">
            <button onClick={()=>{load(token!); setMenuOpen(false);}} className="w-full px-3 py-2 rounded-xl border border-border/60 bg-muted/30 text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>রিফ্রেশ</button>
            <button onClick={logout} className="w-full px-3 py-2 rounded-xl border border-border/60 bg-muted/30 text-sm inline-flex items-center gap-2"><LogOut className="w-4 h-4"/>লগআউট</button>
          </div>
        </div>
      </div>}

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-72 border-r border-border/60 bg-card/60 backdrop-blur">
          <div className="p-5 border-b border-border/60">
            <div className="flex items-center gap-3"><div className="page-title-icon !w-10 !h-10">I</div><div><div className="font-bold">Customer Portal</div><div className="text-xs text-muted-foreground">IzanDesk Self-Care</div></div></div>
            <div className="mt-4 p-3 rounded-xl bg-muted/30 border border-border/60">
              <div className="font-medium text-sm truncate">{sub.full_name}</div>
              <div className="text-xs text-muted-foreground truncate">{sub.client_code} • {sub.username||'-'}</div>
              <div className={`badge mt-2 ${isOnline?'badge-success':'badge-secondary'}`}>{isOnline?'অনলাইন':'অফলাইন'}{sess?.ip_address ? ` • ${sess.ip_address}` : ''}</div>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-1 overflow-auto">
            {tabs.map(([k,label,Icon]:any)=> (
              <button key={k} onClick={()=>selectTab(k)} className={`w-full text-left px-3 py-2.5 rounded-xl text-sm inline-flex items-center gap-3 transition-colors ${tab===k?'bg-primary text-primary-foreground shadow-lg':'hover:bg-muted/50 text-foreground'}`}><Icon className="w-4 h-4"/>{label}</button>
            ))}
          </nav>
          <div className="p-3 border-t border-border/60 space-y-2">
            <button onClick={()=>load(token!)} className="w-full px-3 py-2 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/50 text-sm inline-flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4"/>রিফ্রেশ</button>
            <button onClick={logout} className="w-full px-3 py-2 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/50 text-sm inline-flex items-center justify-center gap-2"><LogOut className="w-4 h-4"/>লগআউট</button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 lg:ml-72 min-w-0">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-5">
            <div className="page-header items-start">
              <div>
                <span className="page-eyebrow">সেলফ-কെയার · {current[1]}</span>
                <h1 className="page-title">{current[1]}</h1>
                <p className="page-subtitle">স্বাগতম, {sub.full_name} ({sub.client_code})</p>
              </div>
              <div className="page-actions hidden lg:flex">
                <button onClick={()=>load(token!)} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>রিফ্রেশ</button>
                <button onClick={logout} className="btn btn-outline"><LogOut className="w-4 h-4"/>লগআউট</button>
              </div>
            </div>

            <div className="page-tabbar">
              {tabs.map(([k,label,Icon]:any)=> (
                <button key={k} onClick={()=>selectTab(k)} className={`page-tab ${tab===k?'active':''}`}><Icon className="w-3.5 h-3.5"/>{label}</button>
              ))}
            </div>

            {err && <div className="alert alert-danger">{err}</div>}
            {msg && <div className="alert alert-success">{msg}</div>}

            {/* summary cards */}
            <div className="stat-grid">
              <div className={`dash-stat ${isOnline?'dash-stat-success':'dash-stat-secondary'}`}><span className="dash-stat-icon"><Wifi className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">কানেকশন</span><span className="dash-stat-value">{isOnline?'অনলাইন':'অফলাইন'}</span><span className="dash-stat-hint">{sess?.ip_address ? `IP ${sess.ip_address}` : 'লাইভ সেশন নেই'}{sess?.source==='radacct' ? ' • RADIUS' : ''}</span></span></div>
              <div className="dash-stat dash-stat-primary"><span className="dash-stat-icon"><Package className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">প্যাকেজ</span><span className="dash-stat-value">{sub.package_name||'-'}</span><span className="dash-stat-hint">{sub.bandwidth_mbps ? `${sub.bandwidth_mbps} Mbps` : ''} • {sub.connection_type}</span></span></div>
              <div className="dash-stat dash-stat-warning"><span className="dash-stat-icon"><Receipt className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">বর্তমান বকিয়া</span><span className="dash-stat-value tabular-nums">{money(sub.current_due)}</span><span className="dash-stat-hint">এখনই चुका করতে হবে</span></span></div>
              <div className="dash-stat dash-stat-info"><span className="dash-stat-icon"><BarChart3 className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">৩০ দিনের ব্যবহার</span><span className="dash-stat-value tabular-nums">↓ {fmtBytes(monthUsage.rx)} ↑ {fmtBytes(monthUsage.tx)}</span><span className="dash-stat-hint">{Math.round(monthUsage.sec/3600)}ঘণ্টা সেশন</span></span></div>
            </div>

            {!!(notifications.announcements||ann).length && <div className="card p-4 border-info/30"><div className="font-semibold flex items-center gap-2 mb-2"><Bell className="w-4 h-4 text-info"/>ঘোষণা</div><div className="space-y-2">{((notifications.announcements||ann) as any[]).slice(0,3).map((a:any,i:number)=>(<div key={a.id||i} className="text-sm"><div className="font-medium">{a.title}</div><div className="text-foreground">{a.body}</div></div>))}</div></div>}

            {tab==='overview' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card p-4 space-y-3"><h2 className="font-bold">Subscription</h2><div className="text-sm space-y-2 text-foreground"><div><b>Account:</b> {sub.client_code} • {sub.username||'-'}</div><div><b>Status:</b> {sub.status} {sub.suspension_stage && sub.suspension_stage!=='NONE' ? `(${sub.suspension_stage})` : ''}</div><div><b>Connection:</b> {sub.connection_type} ({sub.provisioning_mode})</div><div><b>Monthly Bill:</b> {money(sub.monthly_bill)}</div><div><b>Address:</b> {sub.address||'-'}</div></div><div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-2"><div className="text-xs text-muted-foreground">Live Traffic (auto-refresh every 15s)</div><div className="text-sm font-medium">{sess ? `${sess.status} • ${sess.ip_address||'-'}` : 'No active session'}</div><div className="text-xs text-foreground">RX {fmtBytes(sess?.rx_bytes||0)} total • TX {fmtBytes(sess?.tx_bytes||0)} total • Rate ↓{Math.round(Number(sess?.rx_bps||0)/1000)} kbps ↑{Math.round(Number(sess?.tx_bps||0)/1000)} kbps</div>{sess?.uptime_seconds!=null && <div className="text-xs text-muted-foreground">Uptime: {Math.round(Number(sess.uptime_seconds||0)/60)} min</div>}{liveHistory.length>1 && (()=>{const max=Math.max(1,...liveHistory.map(h=>Math.max(h.rx,h.tx)));return (<div><div className="text-[10px] text-muted-foreground mb-1">Live rate samples (↓ RX / ↑ TX)</div><div className="flex items-end gap-0.5 h-10">{liveHistory.slice(-24).map((h,i)=>(<div key={i} className="flex-1 flex flex-col justify-end gap-px h-full"><div className="w-full bg-info/70 rounded-sm" style={{height:`${Math.max(2,(h.rx/max)*100)}%`}} title={`RX ${Math.round(h.rx/1000)} kbps`}/><div className="w-full bg-success/70 rounded-sm" style={{height:`${Math.max(2,(h.tx/max)*100)}%`}} title={`TX ${Math.round(h.tx/1000)} kbps`}/></div>))}</div></div>);})()}</div>{me.quota ? (<div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-2"><div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">FUP/Quota ({me.quota.period.replace('_',' ')})</span><span className={me.quota.over_cap?'text-danger font-semibold':'text-foreground'}>{me.quota.over_cap?'Over cap':'Within cap'}</span></div><div className="text-sm">{fmtBytes(me.quota.used_bytes)} used of {me.quota.cap_gb} GB {me.quota.fup_speed_mbps ? `• FUP ${me.quota.fup_speed_mbps} Mbps` : ''}{sub.fup_exceeded ? ' • throttled (FUP enforced)' : ''}</div><div className="h-2 rounded-full bg-border/60 overflow-hidden"><div className={`${me.quota.over_cap?'bg-danger':'bg-info'} h-full`} style={{width:`${Math.min(100,me.quota.percent)}%`}}/></div><div className="text-xs text-muted-foreground">Remaining: {fmtBytes(me.quota.remaining_bytes)} ({Math.max(0,100-me.quota.percent).toFixed(1)}%) • policy enforcement depends on NAS/RADIUS configuration.</div></div>) : (<div className="text-xs text-muted-foreground">Quota/FUP: no data cap configured for this package (30-day usage shown in Usage).</div>)}</div>
              <div className="card p-4"><h2 className="font-bold mb-3">Recent Invoices</h2><div className="space-y-2">{invoices.slice(0,5).map(inv=>(<div key={inv.id} className="p-3 rounded-xl bg-muted/30 border border-border/60 flex items-center justify-between gap-3"><div><div className="font-medium text-sm">{inv.invoice_number}</div><div className="text-xs text-muted-foreground">{inv.bill_month} • Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '-'}</div></div><div className="text-right"><div className="font-semibold">{money(inv.due_amount || inv.total_amount)}</div><div className="text-xs text-muted-foreground">{inv.status}</div></div></div>))}{!invoices.length && <div className="empty-state">No invoices found.</div>}</div></div>
            </div>}

            {tab==='invoices' && <div className="space-y-4">
              <div className="card p-4 border-info/30 space-y-3">
                <h2 className="font-bold flex items-center gap-2"><CreditCard className="w-4 h-4 text-info"/>Advance Payment / Pay Any Amount</h2>
                <p className="text-sm text-foreground">Make an online payment without selecting a specific invoice. The amount will be applied to your outstanding dues (oldest first) after successful payment confirmation.</p>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                  <label className="block flex-1 max-w-xs"><div className="form-label">Amount (BDT)</div><input type="number" min="1" step="0.01" className="form-control" value={advanceAmount} onChange={e=>setAdvanceAmount(e.target.value)} placeholder="Enter amount" /></label>
                  <div className="flex flex-wrap gap-2">{gateways.slice(0,5).map((g:any)=>(<button key={g.gateway} onClick={()=>payAdvance(g.gateway)} disabled={busy || !(Number(advanceAmount)>0)} className="btn btn-primary btn-sm">Pay {String(g.gateway).toUpperCase()}</button>))}</div>
                </div>
                <div className="text-xs text-muted-foreground">Current due: <b>{money(sub.current_due)}</b>. Real online payment requires a live-configured gateway and provider callback/webhook confirmation.</div>
              </div>
              <div className="card p-4 space-y-3"><h2 className="font-bold">Invoices & Online Payment</h2>{invoices.map(inv => (<div key={inv.id} className="p-3 rounded-xl bg-muted/30 border border-border/60 flex flex-col lg:flex-row lg:items-center justify-between gap-3"><div><div className="font-medium">{inv.invoice_number} <span className="text-xs text-muted-foreground">({inv.status})</span></div><div className="text-xs text-muted-foreground">Period {inv.period_start ? new Date(inv.period_start).toLocaleDateString():''} - {inv.period_end ? new Date(inv.period_end).toLocaleDateString():''} • Total {money(inv.total_amount)} • Due {money(inv.due_amount)}</div></div><div className="flex flex-wrap items-center gap-2"><button className="btn btn-outline btn-sm" onClick={()=>{ fetch(`${getApiBaseUrl()}/api/portal/invoices/${inv.id}/pdf`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b); window.open(u,'_blank');}); }}><Download className="w-4 h-4"/>PDF</button>{Number(inv.due_amount||0)>0 && gateways.slice(0,4).map((g:any)=>(<button key={g.gateway} onClick={()=>payInvoice(inv, g.gateway)} className="btn btn-primary btn-sm">Pay {String(g.gateway).toUpperCase()}</button>))}</div></div>))}{!invoices.length && <div className="empty-state">No invoices found. You can still make an advance payment above.</div>}</div>
            </div>}
            {tab==='payments' && <div className="card p-4"><h2 className="font-bold mb-3">Payment History</h2><div className="space-y-2">{payments.map(p=>(<div key={p.id} className="p-3 rounded-xl bg-muted/30 border border-border/60 flex items-center justify-between"><div><div className="font-medium text-sm">{p.payment_ref}</div><div className="text-xs text-muted-foreground">{String(p.gateway).toUpperCase()} • {p.trx_id||'-'} • {new Date(p.created_at).toLocaleString()}</div></div><div className="text-right"><div className="font-semibold">{money(p.amount)}</div><div className="text-xs text-muted-foreground">{p.status}</div></div></div>))}{!payments.length && <div className="empty-state">No payments found.</div>}</div></div>}

            {tab==='usage' && <div className="space-y-4">{me.quota && <div className="card p-4"><h2 className="font-bold mb-2">Monthly FUP / Data Cap</h2><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm"><div>{fmtBytes(me.quota.used_bytes)} used of {me.quota.cap_gb} GB {me.quota.fup_speed_mbps ? `• FUP speed ${me.quota.fup_speed_mbps} Mbps` : ''}{sub.fup_exceeded ? ' • throttled (FUP enforced)' : ''}</div><div className={me.quota.over_cap?'text-danger font-semibold':'text-success'}>{me.quota.over_cap?'Over cap':'Within cap'} • {me.quota.percent.toFixed(2)}%</div></div><div className="mt-2 h-2.5 rounded-full bg-border/60 overflow-hidden"><div className={`${me.quota.over_cap?'bg-danger':'bg-info'} h-full`} style={{width:`${Math.min(100,me.quota.percent)}%`}}/></div><div className="text-xs text-muted-foreground mt-1">Remaining {fmtBytes(me.quota.remaining_bytes)} for {me.quota.period.replace('_',' ')}. Enforcement/signaling depends on NAS/RADIUS policy.</div></div>}<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-info"/>Daily Usage (30 days)</h2>
                <div className="space-y-2 max-h-[420px] overflow-auto">{(usage?.daily||[]).map((d:any,i:number)=>{const total=Number(d.rx_bytes||0)+Number(d.tx_bytes||0); const max=Math.max(1,...((usage?.daily||[]).map((x:any)=>Number(x.rx_bytes||0)+Number(x.tx_bytes||0)))); const w=Math.max(6,Math.round((total/max)*100)); return (<div key={i} className="p-2.5 rounded-xl bg-muted/30 border border-border/60 text-sm"><div className="flex items-center justify-between"><div><div className="font-medium">{d.day ? new Date(d.day).toLocaleDateString() : '-'}</div><div className="text-xs text-muted-foreground">{d.sessions} session(s) • {Math.round(Number(d.session_seconds||0)/60)} min</div></div><div className="text-right text-xs"><div>↓ {fmtBytes(d.rx_bytes)}</div><div>↑ {fmtBytes(d.tx_bytes)}</div></div></div><div className="mt-2 h-1.5 rounded-full bg-border/60 overflow-hidden"><div className="h-full bg-info" style={{width:`${w}%`}}/></div></div>);})}{!(usage?.daily||[]).length && <div className="empty-state">No usage data yet (requires RADIUS accounting).</div>}</div>
              </div>
              <div className="card p-4"><h2 className="font-bold mb-3">Recent Sessions</h2><div className="space-y-2 max-h-[420px] overflow-auto">{(usage?.sessions||[]).slice(0,20).map((s:any,i:number)=>(<div key={i} className="p-2.5 rounded-xl bg-muted/30 border border-border/60 text-sm"><div className="flex items-center justify-between"><div className="font-medium">{s.ip_address||'-'}</div><div className="text-xs text-muted-foreground">{s.acctstoptime ? 'Ended' : 'Active/Open'}</div></div><div className="text-xs text-muted-foreground mt-1">Start: {s.acctstarttime ? new Date(s.acctstarttime).toLocaleString() : '-'}{s.acctstoptime ? ` • Stop: ${new Date(s.acctstoptime).toLocaleString()}` : ''}</div><div className="text-xs mt-1">↓ {fmtBytes(s.rx_bytes)} ↑ {fmtBytes(s.tx_bytes)} • {Math.round(Number(s.acctsessiontime||0)/60)} min {s.acctterminatecause ? `• ${s.acctterminatecause}` : ''}</div></div>))}{!(usage?.sessions||[]).length && <div className="empty-state">No session history found.</div>}</div></div>
            </div></div>}

            {tab==='tickets' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-info"/>Create Support Ticket</h2><input className="form-control" placeholder="Subject" value={newTicket.subject} onChange={e=>setNewTicket({...newTicket,subject:e.target.value})} /><div className="grid grid-cols-2 gap-2"><select className="form-select w-full" value={newTicket.priority} onChange={e=>setNewTicket({...newTicket,priority:e.target.value})}>{['LOW','MEDIUM','HIGH','CRITICAL'].map(p=><option key={p} value={p}>{p}</option>)}</select><select className="form-select w-full" value={newTicket.category} onChange={e=>setNewTicket({...newTicket,category:e.target.value})}>{['SUPPORT','BILLING','NETWORK','INSTALLATION','OTHER'].map(p=><option key={p} value={p}>{p}</option>)}</select></div><textarea className="form-control" placeholder="Describe your issue..." value={newTicket.description} onChange={e=>setNewTicket({...newTicket,description:e.target.value})} /><button onClick={createTicket} disabled={busy || !newTicket.subject} className="btn btn-primary">Submit Ticket</button></div>
                <div className="card p-4"><h2 className="font-bold mb-3">My Tickets</h2><div className="space-y-2 max-h-[420px] overflow-auto">{tickets.map(t=>(<button key={t.id} onClick={()=>openTicket(t.id)} className={`w-full text-left p-3 rounded-xl border ${ticketDetail?.id===t.id?'border-primary bg-primary/5':'border-border/60 bg-muted/30 hover:bg-muted/50'}`}><div className="flex items-center justify-between gap-2"><div className="font-medium text-sm">{t.ticket_no} — {t.subject}</div><span className="badge badge-secondary">{t.status}</span></div><div className="text-xs text-muted-foreground mt-1">{t.priority} • {t.category} • {t.created_at ? new Date(t.created_at).toLocaleString() : ''}</div></button>))}{!tickets.length && <div className="empty-state">No tickets yet.</div>}</div></div>
              </div>
              <div className="card p-4">{!ticketDetail ? <div className="empty-panel">
                <span className="empty-panel-icon"><LifeBuoy className="w-5 h-5"/></span>
                <div>
                  <div className="text-sm font-semibold">No ticket selected</div>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px] leading-relaxed">Choose a ticket from the list to view its details, conversation and replies.</p>
                </div>
              </div> : (<div className="space-y-3"><div><h2 className="font-bold">{ticketDetail.ticket_no}</h2><div className="text-sm text-foreground">{ticketDetail.subject}</div><div className="text-xs text-muted-foreground mt-1">{ticketDetail.status} • {ticketDetail.priority} • SLA due {ticketDetail.sla_due_at ? new Date(ticketDetail.sla_due_at).toLocaleString() : '-'}</div></div>{ticketDetail.description && <div className="text-sm p-3 rounded-xl bg-muted/30 border border-border/60 whitespace-pre-wrap">{ticketDetail.description}</div>}<div className="space-y-2 max-h-[320px] overflow-auto">{(ticketDetail.comments||[]).map((c:any)=>(<div key={c.id} className="p-2.5 rounded-xl bg-muted/30 border border-border/60 text-sm"><div className="flex items-center justify-between text-xs text-muted-foreground mb-1"><span>{c.author_name} ({c.author_role||'USER'})</span><span>{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span></div><div className="whitespace-pre-wrap">{c.body}</div></div>))}{!(ticketDetail.comments||[]).length && <div className="empty-state">No replies yet.</div>}</div><div className="flex gap-2"><input className="form-control flex-1" placeholder="Write a reply..." value={comment} onChange={e=>setComment(e.target.value)} /><button onClick={addComment} disabled={busy || !comment.trim()} className="btn btn-primary btn-icon"><Send className="w-4 h-4"/></button></div></div>)}</div>
            </div>}

            {tab==='plans' && <div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><Package className="w-4 h-4 text-info"/>Available Plans & Upgrade Requests</h2><p className="text-sm text-muted-foreground">Current: <b>{sub.package_name||'-'}</b> ({sub.bandwidth_mbps||'-'} Mbps). Request a plan change and our team will process it.</p><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{packages.map(p=>(<div key={p.id} className="card card-body-sm space-y-2"><div className="font-semibold">{p.name}</div><div className="text-sm text-foreground">{p.download_mbps}/{p.upload_mbps} Mbps</div><div className="text-xs text-muted-foreground">{p.data_cap_gb ? `${Number(p.data_cap_gb)} GB/mo cap` : 'Unlimited data'}{p.fup_speed_mbps ? ` • FUP ${p.fup_speed_mbps} Mbps` : ''}</div><div className="text-lg font-bold text-info">{money(p.price)}</div>{p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}<button onClick={()=>requestPlan(p)} disabled={busy || sub.package_name===p.name} className="btn btn-primary btn-sm w-full mt-1">{sub.package_name===p.name?'Current Plan':'Request This Plan'}</button></div>))}{!packages.length && <div className="empty-state">No plans available.</div>}</div></div>}

            {tab==='documents' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><FileText className="w-4 h-4 text-info"/>My Documents (KYC)</h2><div className="space-y-2">{documents.map(d=>{
                const tone = d.status==='APPROVED' ? 'badge-success' : d.status==='REJECTED' || d.status==='EXPIRED' ? 'badge-danger' : d.status==='RESUBMISSION_REQUIRED' ? 'badge-warning' : d.status==='UNDER_REVIEW' ? 'badge-info' : 'badge-secondary';
                return <div key={d.id} className="p-3 rounded-xl bg-muted/30 border border-border/60" data-testid={`portal-kyc-${d.id}`}>
                  <div className="flex items-center justify-between gap-2"><button onClick={()=>openDoc(d.id)} className="text-left"><div className="font-medium text-sm">{d.doc_type} — {d.file_name}</div></button><span className={`badge ${tone}`}>{String(d.status||'PENDING').replaceAll('_',' ')}</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{d.uploaded_at ? new Date(d.uploaded_at).toLocaleString():''}{d.reviewed_at ? ` · reviewed ${new Date(d.reviewed_at).toLocaleDateString()}` : ''}{d.expires_at ? ` · expires ${new Date(d.expires_at).toLocaleDateString()}` : ''}</div>
                  {d.rejection_reason && <div className="text-xs text-danger mt-2" data-testid={`portal-kyc-reason-${d.id}`}>Reviewer note: {d.rejection_reason}</div>}
                  {['REJECTED','RESUBMISSION_REQUIRED','EXPIRED'].includes(String(d.status)) && <button className="btn btn-outline btn-sm mt-2" onClick={()=>{ setReuploadFor(d.id); setDocType(d.doc_type); setMsg('Select a replacement file below. It will be linked to this review.'); }} data-testid={`portal-kyc-reupload-${d.id}`}>Upload replacement</button>}
                </div>;
              })}{!documents.length && <div className="empty-state">No documents uploaded.</div>}</div></div>
              <div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><Upload className="w-4 h-4 text-info"/>{reuploadFor ? 'Upload Replacement' : 'Upload Document'}</h2>{reuploadFor && <div className="alert alert-warning !py-2 !text-xs">This upload replaces a document the reviewer asked you to resubmit. The earlier record stays in the audit trail.</div>}<select className="form-select w-full" value={docType} onChange={e=>setDocType(e.target.value)}>{['NID','PASSPORT','CONTRACT','PHOTO','UTILITY_BILL','TRADE_LICENSE','OTHER'].map(t=><option key={t} value={t}>{t}</option>)}</select><input type="file" className="form-control" onChange={e=>{const f=e.target.files?.[0]; if(f){ uploadDoc(f); e.currentTarget.value=''; }}} disabled={busy} data-testid="portal-kyc-upload" /><p className="text-xs text-muted-foreground">PNG, JPEG, WebP, GIF or PDF only. Files are content-checked and shown to your ISP for verification. Identity numbers are masked in staff records.</p></div>
            </div>}

            {tab==='notifications' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-info"/>Announcements</h2><div className="space-y-2">{((notifications.announcements||[]) as any[]).map((a:any,i:number)=>(<div key={a.id||i} className="p-3 rounded-xl bg-muted/30 border border-border/60"><div className="font-medium text-sm">{a.title}</div><div className="text-sm text-foreground mt-1">{a.body}</div></div>))}{!(notifications.announcements||[]).length && <div className="empty-state">No announcements.</div>}</div></div>
              <div className="card p-4"><h2 className="font-bold mb-3">Messages & Alerts</h2><div className="space-y-2 max-h-[480px] overflow-auto">{((notifications.messages||[]) as any[]).map((m:any,i:number)=>(<div key={m.id||i} className="p-3 rounded-xl bg-muted/30 border border-border/60"><div className="flex items-center justify-between gap-2"><div className="text-xs text-muted-foreground">{String(m.channel_type||'').toUpperCase()} • {String(m.provider||'')}</div><div className="text-[10px] px-2 py-0.5 rounded-full border border-border/60">{m.status}</div></div>{m.subject && <div className="font-medium text-sm mt-1">{m.subject}</div>}<div className="text-sm text-foreground mt-1 whitespace-pre-wrap">{m.body}</div><div className="text-xs text-muted-foreground mt-1">{m.sent_at ? new Date(m.sent_at).toLocaleString() : (m.created_at ? new Date(m.created_at).toLocaleString() : '')}</div></div>))}{!(notifications.messages||[]).length && <div className="empty-state">No messages yet. Payment/invoice/ticket notifications sent to your registered contact will appear here when matched.</div>}</div></div>
            </div>}

            {tab==='speedtest' && <div className="card p-4 space-y-4"><h2 className="font-bold flex items-center gap-2"><Gauge className="w-4 h-4 text-info"/>Live Bandwidth Speedtest</h2><p className="text-sm text-muted-foreground">Browser-based download/upload test against IzanDesk server (results vary by device, Wi-Fi/LAN and path).</p><button onClick={runSpeedtest} disabled={busy} className="btn btn-primary">{busy?'Testing...':'Run Speedtest'}</button>{speed && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[['Download', `${speed.downMbps} Mbps`],['Upload', `${speed.upMbps} Mbps`],['Ping', `${speed.pingMs} ms`]].map(([l,v]:any)=>(<div key={l} className="card p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-xl font-black mt-1">{v}</div></div>))}</div>}{speed && <div className="text-xs text-muted-foreground">Measured at {speed.at}</div>}</div>}

            {tab==='wifi' && <div className="card p-4 space-y-4"><h2 className="font-bold flex items-center gap-2"><Wifi className="w-4 h-4 text-info"/>Wi-Fi SSID & Password (TR-069 / GenieACS)</h2><p className="text-sm text-muted-foreground">Manage CPE Wi-Fi via GenieACS/TR-069. Requires GenieACS configured and the CPE device ID online in ACS.</p><div className="alert alert-primary text-xs">ACS: <b>{acs?.configured ? 'Configured' : 'Not configured'}</b>{acs?.baseUrl ? ` (${acs.baseUrl})` : ''}</div><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><label className="block"><div className="form-label">ACS Device ID</div><input className="form-control" value={wifi.device_id} onChange={e=>setWifi({...wifi,device_id:e.target.value})} /></label><label className="block"><div className="form-label">New SSID</div><input className="form-control" value={wifi.ssid} onChange={e=>setWifi({...wifi,ssid:e.target.value})} /></label><label className="block"><div className="form-label">New Wi-Fi Password</div><input type="password" className="form-control" value={wifi.password} onChange={e=>setWifi({...wifi,password:e.target.value})} /></label></div><button onClick={saveWifi} disabled={busy || !wifi.device_id || (!wifi.ssid && !wifi.password)} className="btn btn-primary">Apply Wi-Fi Settings</button></div>}

            {tab==='profile' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><User className="w-4 h-4 text-info"/>Profile & Contact</h2><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="block"><div className="form-label">Phone</div><input className="form-control" value={profile.phone||''} onChange={e=>setProfile({...profile,phone:e.target.value})} /></label><label className="block"><div className="form-label">Email</div><input className="form-control" value={profile.email||''} onChange={e=>setProfile({...profile,email:e.target.value})} /></label><label className="block sm:col-span-2"><div className="form-label">Address</div><input className="form-control" value={profile.address||''} onChange={e=>setProfile({...profile,address:e.target.value})} /></label><label className="block"><div className="form-label">NID/ID</div><input className="form-control" value={profile.nid_number||''} onChange={e=>setProfile({...profile,nid_number:e.target.value})} /></label></div><button onClick={saveProfile} disabled={busy} className="btn btn-primary">Save Profile</button></div><div className="space-y-4"><div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><KeyRound className="w-4 h-4 text-info"/>Change Password</h2><label className="block"><div className="form-label">Current Password</div><input type="password" className="form-control" value={pw.current_password} onChange={e=>setPw({...pw,current_password:e.target.value})} /></label><label className="block"><div className="form-label">New Password</div><input type="password" className="form-control" value={pw.new_password} onChange={e=>setPw({...pw,new_password:e.target.value})} /></label><button onClick={changePassword} disabled={busy || !pw.new_password} className="btn btn-primary">Update Password</button><div className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/30 border border-border/60">If no password was previously set, your current password is your client code/username/phone.</div></div><div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><CreditCard className="w-4 h-4 text-info"/>Payment Preferences (Auto-pay)</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!prefs.auto_pay_enabled} onChange={e=>setPrefs({...prefs,auto_pay_enabled:e.target.checked})} /> Enable auto-pay preference</label><label className="block"><div className="form-label">Preferred Gateway</div><select className="form-select w-full" value={prefs.preferred_gateway||''} onChange={e=>setPrefs({...prefs,preferred_gateway:e.target.value})}><option value="">Select gateway...</option>{gateways.map((g:any)=>(<option key={g.gateway} value={g.gateway}>{String(g.gateway).toUpperCase()}</option>))}</select></label><button onClick={savePrefs} disabled={busy} className="btn btn-primary">Save Preferences</button><div className="text-xs text-muted-foreground">Preferences saved. Automatic charging requires gateway tokenization/mandate setup.</div><div className="pt-2 border-t border-border/60"><div className="font-semibold text-sm mb-2">Saved Payment Methods (scaffold)</div><div className="space-y-2">{savedMethods.map(m=>(<div key={m.id} className="p-2.5 rounded-xl bg-muted/30 border border-border/60 flex items-center justify-between gap-2 text-sm"><div><div className="font-medium">{String(m.gateway||'').toUpperCase()} {m.label ? `• ${m.label}` : ''} {m.is_default ? <span className="text-[10px] text-info ml-1">DEFAULT</span> : ''}</div><div className="text-xs text-muted-foreground">{m.masked_identifier || 'Reference saved'} • {m.status}</div></div><button onClick={()=>removePaymentMethod(m.id)} className="btn btn-outline btn-sm">Remove</button></div>))}{!savedMethods.length && <div className="text-xs text-muted-foreground">No saved methods. Add a reference below (real tokenization/mandate handled by gateway integration).</div>}</div><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3"><select className="form-select w-full" value={newMethod.gateway||prefs.preferred_gateway||''} onChange={e=>setNewMethod({...newMethod,gateway:e.target.value})}><option value="">Gateway...</option>{gateways.map((g:any)=>(<option key={g.gateway} value={g.gateway}>{String(g.gateway).toUpperCase()}</option>))}</select><input className="form-control" placeholder="Label (e.g. Personal bKash)" value={newMethod.label||''} onChange={e=>setNewMethod({...newMethod,label:e.target.value})} /><input className="form-control" placeholder="Masked identifier (e.g. 01****89) - optional" value={newMethod.masked_identifier||''} onChange={e=>setNewMethod({...newMethod,masked_identifier:e.target.value})} /><label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={!!newMethod.is_default} onChange={e=>setNewMethod({...newMethod,is_default:e.target.checked})} /> Set as default</label></div><button onClick={addPaymentMethod} disabled={busy || !(newMethod.gateway || prefs.preferred_gateway || gateways[0]?.gateway)} className="btn btn-outline btn-sm mt-2">Save Method (Reference)</button></div></div></div></div>}
          </div>
        </main>
      </div>
    </div>
  );
}
