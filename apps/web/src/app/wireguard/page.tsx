'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plus, Pencil, Trash2, Shield, Server, KeyRound, Copy, Play, Network, Activity, X, Globe } from 'lucide-react';

function fmtBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length-1) { v /= 1024; i++; }
  return `${v.toFixed(v>=10||i===0?0:1)} ${u[i]}`;
}

export default function WireGuardPage() {
  const { token } = useAuth();
  const [hub, setHub] = useState<any>(null);
  const [runtime, setRuntime] = useState<any>(null);
  const [peers, setPeers] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubForm, setHubForm] = useState<any>({});
  const [hubModal, setHubModal] = useState(false);
  const [peerModal, setPeerModal] = useState<any>(null);
  const [peerForm, setPeerForm] = useState<any>({});
  const [scriptModal, setScriptModal] = useState<{title:string; script:string} | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [h, p, r] = await Promise.all([
        apiFetch<any>('/api/wireguard/hub', {}, token),
        apiFetch<any>('/api/wireguard/peers', {}, token),
        apiFetch<any>('/api/network/routers', {}, token).catch(()=>({data:[]})),
      ]);
      setHub(h.hub || null); setRuntime(h.runtime || null);
      setPeers(p.data || []); setRouters(r.data || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); const t = setInterval(load, 7000); return () => clearInterval(t); }, [load]);

  const initHub = async () => {
    if (!token) return;
    try { await apiFetch('/api/wireguard/hub/init', { method: 'POST', body: JSON.stringify({}) }, token); await load(); }
    catch (e:any) { setError(e.message); }
  };
  const saveHub = async () => {
    if (!token) return;
    try {
      await apiFetch('/api/wireguard/hub', { method: 'PUT', body: JSON.stringify(hubForm) }, token);
      setHubModal(false); await load();
    } catch (e:any) { setError(e.message); }
  };
  const savePeer = async () => {
    if (!token) return;
    try {
      const payload = { ...peerForm };
      if (typeof payload.allowed_ips === 'string') payload.allowed_ips = payload.allowed_ips.split(',').map((s:string)=>s.trim()).filter(Boolean);
      if (typeof payload.olt_mgmt_cidrs === 'string') payload.olt_mgmt_cidrs = payload.olt_mgmt_cidrs.split(',').map((s:string)=>s.trim()).filter(Boolean);
      if (!payload.router_id) payload.router_id = null;
      if (peerModal === 'new') await apiFetch('/api/wireguard/peers', { method: 'POST', body: JSON.stringify(payload) }, token);
      else await apiFetch(`/api/wireguard/peers/${peerModal.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      setPeerModal(null); await load();
    } catch (e:any) { setError(e.message); }
  };
  const delPeer = async (id: string) => { if (!token || !confirm('Delete peer?')) return; await apiFetch(`/api/wireguard/peers/${id}`, { method: 'DELETE' }, token); load(); };
  const provision = async (id: string) => {
    if (!token) return;
    try { const r = await apiFetch<any>(`/api/wireguard/peers/${id}/provision`, { method: 'POST' }, token); alert(r.ok ? 'Provisioned to router' : (r.message||'Failed')); await load(); }
    catch(e:any){ setError(e.message); }
  };
  const showBootstrap = async (p: any) => {
    if (!token) return;
    try { const r = await apiFetch<any>(`/api/wireguard/peers/${p.id}/bootstrap`, {}, token); setScriptModal({ title: `Bootstrap: ${p.name}`, script: r.script || '' }); }
    catch(e:any){ setError(e.message); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch {} };

  const onlineCount = peers.filter(p=>p.online).length;

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Network · Overlay VPN</span>
          <h1 className="page-title"><Shield className="w-6 h-6 text-primary"/>WireGuard Overlay (NAT/CGNAT Sites)</h1>
          <p className="page-subtitle">Plug-and-play hub-and-spoke tunnels to reach MikroTik routers without public IPs and manage <b>OLTs behind them</b>.</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={()=>{ setPeerForm({name:'', site_name:'', router_id:'', tunnel_ip:'', allowed_ips:'', olt_mgmt_cidrs:'', keepalive_sec:25, provision_mode:'AUTO'}); setPeerModal('new'); }} className="btn btn-primary"><Plus className="w-4 h-4"/>Add Site/Peer</button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="stat-grid">
        <Stat label="Peers Online" value={`${onlineCount}/${peers.length}`} icon={Activity} tone="success" />
        <Stat label="Hub" value={hub?.enabled ? 'Enabled' : 'Configured'} icon={Server} tone="primary" />
        <Stat label="Overlay" value={hub?.overlay_cidr || '10.77.0.0/16'} icon={Network} tone="info" />
        <Stat label="Endpoint" value={hub?.endpoint_host ? `${hub.endpoint_host}:${hub.endpoint_port||hub?.listen_port||51820}` : 'Not set'} icon={Globe} tone="purple" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1 card p-4 space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-bold flex items-center gap-2"><Server className="w-4 h-4 text-primary"/>Hub Configuration</h2><button onClick={()=>{ setHubForm({ ...(hub||{}), endpoint_host: hub?.endpoint_host||'', endpoint_port: hub?.endpoint_port||51820, hub_address: hub?.hub_address||'10.77.0.1/16', overlay_cidr: hub?.overlay_cidr||'10.77.0.0/16', enabled: hub?.enabled ?? true }); setHubModal(true); }} className="btn btn-ghost btn-icon"><Pencil className="w-4 h-4"/></button></div>
          <div className="text-xs space-y-2 text-muted-foreground">
            <Row k="Public endpoint" v={hub?.endpoint_host ? `${hub.endpoint_host}:${hub.endpoint_port||hub?.listen_port||51820}` : <span className="badge badge-warning">Set public DNS/IP (reachable by routers)</span>} />
            <Row k="Hub tunnel address" v={hub?.hub_address || '-'} />
            <Row k="Overlay CIDR" v={hub?.overlay_cidr || '-'} />
            <Row k="Listen port (UDP)" v={String(hub?.listen_port || 51820)} />
            <Row k="Hub public key" v={hub?.public_key ? <span className="font-mono break-all text-foreground/90">{hub.public_key}</span> : <span className="badge badge-warning">Not initialized</span>} />
            <Row k="Runtime" v={runtime?.ok ? <span className="badge badge-success">OK ({runtime.source||'wg'})</span> : <span className="badge badge-warning">Unavailable (config/provisioning still works)</span>} />
          </div>
          <div className="toolbar-strip pt-1">
            <button onClick={initHub} className="btn btn-outline"><KeyRound className="w-4 h-4"/>Init/Generate Keys</button>
          </div>
          <div className="alert alert-primary text-[11px] space-y-1">
            <div className="font-semibold text-foreground">Plug-and-play flow</div>
            <div>1) Set hub public endpoint &amp; init keys. 2) Add peer/site + OLT mgmt subnets. 3) If router not reachable remotely, run <b>Bootstrap script</b> once on MikroTik (it dials out behind NAT/CGNAT). 4) If reachable, use <b>Provision</b>. 5) Ensure UDP {hub?.listen_port||51820} is open on server and routes exist to OLT subnets.</div>
          </div>
        </div>

        <div className="xl:col-span-2 card p-4">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Network className="w-4 h-4 text-primary"/>Sites / Peers (MikroTik spokes, OLTs behind routers)</h2>
          <div className="space-y-3">
            {peers.map(p => (
              <div key={p.id} className="p-4 rounded-xl border border-border bg-muted/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{p.name}</span>
                      {p.site_name && <span className="badge badge-outline">{p.site_name}</span>}
                      <span className={`badge ${p.online?'badge-success':'badge-warning'}`}>{p.online?'ONLINE':(p.status||'PENDING')}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Tunnel: <span className="font-mono text-foreground/90">{p.tunnel_ip}</span>{p.router_name ? <> • Router: <span className="text-foreground/90">{p.router_name}</span> <span className="text-[10px]">({p.router_host})</span></> : <> • <span className="badge badge-warning">No router linked (bootstrap mode)</span></>}</div>
                    {!!(p.olt_mgmt_cidrs||[]).length && <div className="text-xs text-muted-foreground mt-1">OLT mgmt routes: <span className="font-mono text-info">{(p.olt_mgmt_cidrs||[]).join(', ')}</span></div>}
                    {p.last_error && <div className="text-xs text-danger mt-1">{p.last_error}</div>}
                  </div>
                  <div className="toolbar-strip shrink-0 justify-end">
                    <button onClick={()=>showBootstrap(p)} className="btn btn-outline btn-sm" title="Bootstrap script"><Copy className="w-3.5 h-3.5"/>Script</button>
                    {p.router_id && <button onClick={()=>provision(p.id)} className="btn btn-primary btn-sm" title="Provision to linked router"><Play className="w-3.5 h-3.5"/>Provision</button>}
                    <button onClick={()=>{ setPeerForm({ ...p, allowed_ips: (p.allowed_ips||[]).join(', '), olt_mgmt_cidrs: (p.olt_mgmt_cidrs||[]).join(', '), router_id: p.router_id||'' }); setPeerModal(p); }} className="btn btn-ghost btn-icon btn-sm"><Pencil className="w-4 h-4"/></button>
                    <button onClick={()=>delPeer(p.id)} className="btn btn-ghost btn-icon btn-sm text-danger"><Trash2 className="w-4 h-4"/></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
                  <Mini label="Handshake" value={p.runtime?.latest_handshake ? new Date(p.runtime.latest_handshake*1000).toLocaleString() : '-'} tone="secondary" />
                  <Mini label="Endpoint" value={p.runtime?.endpoint || '-'} tone="info" />
                  <Mini label="RX" value={fmtBytes(Number(p.runtime?.rx_bytes||0))} tone="success" />
                  <Mini label="TX" value={fmtBytes(Number(p.runtime?.tx_bytes||0))} tone="purple" />
                </div>
              </div>
            ))}
            {!peers.length && <div className="empty-panel"><span className="empty-panel-icon"><Globe className="w-5 h-5"/></span><div><div className="text-sm font-semibold">No WireGuard peers yet</div><p className="text-[11px] text-muted-foreground mt-1">Add a site/peer and bootstrap or provision a MikroTik (behind NAT/CGNAT) to reach routers and OLTs over the tunnel.</p></div></div>}
          </div>
        </div>
      </div>

      {hubModal && (
        <Modal title="WireGuard Hub" onClose={()=>setHubModal(false)} onSave={saveHub}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <F label="Public endpoint host (DNS/IP)"><input className="form-control" value={hubForm.endpoint_host||''} onChange={e=>setHubForm({...hubForm,endpoint_host:e.target.value})} placeholder="e.g. izandesk.example.com or public IP"/></F>
            <F label="Endpoint / listen port (UDP)"><input className="form-control" type="number" value={hubForm.endpoint_port ?? 51820} onChange={e=>setHubForm({...hubForm,endpoint_port:Number(e.target.value||51820), listen_port:Number(e.target.value||51820)})}/></F>
            <F label="Hub tunnel address (CIDR)"><input className="form-control" value={hubForm.hub_address||''} onChange={e=>setHubForm({...hubForm,hub_address:e.target.value})}/></F>
            <F label="Overlay CIDR"><input className="form-control" value={hubForm.overlay_cidr||''} onChange={e=>setHubForm({...hubForm,overlay_cidr:e.target.value})}/></F>
            <F label="MTU (optional)"><input className="form-control" type="number" value={hubForm.mtu ?? ''} onChange={e=>setHubForm({...hubForm,mtu:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Enabled"><select className="form-select" value={hubForm.enabled?'yes':'no'} onChange={e=>setHubForm({...hubForm,enabled:e.target.value==='yes'})}><option value="yes">Yes</option><option value="no">No</option></select></F>
          </div>
          <div className="alert alert-primary text-xs mt-3">Set the public endpoint that remote MikroTiks can reach (UDP {hubForm.endpoint_port||51820} must be allowed/forwarded to this server). Hub keys are generated via Init/Generate Keys.</div>
        </Modal>
      )}

      {peerModal && (
        <Modal title={peerModal==='new'?'Add Site / Peer':'Edit Site / Peer'} onClose={()=>setPeerModal(null)} onSave={savePeer} wide>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <F label="Peer / Site name"><input className="form-control" value={peerForm.name||''} onChange={e=>setPeerForm({...peerForm,name:e.target.value})}/></F>
            <F label="Site label"><input className="form-control" value={peerForm.site_name||''} onChange={e=>setPeerForm({...peerForm,site_name:e.target.value})}/></F>
            <F label="Linked MikroTik router (optional, for auto-provision)"><select className="form-select" value={peerForm.router_id||''} onChange={e=>setPeerForm({...peerForm,router_id:e.target.value})}><option value="">-- none (bootstrap/script) --</option>{routers.filter((r:any)=>['API','REST'].includes(String(r.integration_mode||'').toUpperCase())).map((r:any)=>(<option key={r.id} value={r.id}>{r.name} ({r.host})</option>))}</select></F>
            <F label="Tunnel IP (CIDR, auto if blank)"><input className="form-control" value={peerForm.tunnel_ip||''} onChange={e=>setPeerForm({...peerForm,tunnel_ip:e.target.value})} placeholder="auto-allocate (e.g. 10.77.0.2/32)"/></F>
            <F label="Keepalive (sec)"><input className="form-control" type="number" value={peerForm.keepalive_sec ?? 25} onChange={e=>setPeerForm({...peerForm,keepalive_sec:Number(e.target.value||25)})}/></F>
            <F label="Provision mode"><select className="form-select" value={peerForm.provision_mode||'AUTO'} onChange={e=>setPeerForm({...peerForm,provision_mode:e.target.value})}><option value="AUTO">AUTO (API/REST when linked)</option><option value="BOOTSTRAP">BOOTSTRAP (script/import)</option></select></F>
            <F label="Allowed IPs (comma-separated)"><input className="form-control" value={peerForm.allowed_ips||''} onChange={e=>setPeerForm({...peerForm,allowed_ips:e.target.value})} placeholder="extra routes via this peer"/></F>
            <F label="OLT mgmt CIDRs behind this router (comma-separated)"><input className="form-control" value={peerForm.olt_mgmt_cidrs||''} onChange={e=>setPeerForm({...peerForm,olt_mgmt_cidrs:e.target.value})} placeholder="e.g. 192.168.88.0/24, 10.20.0.5/32"/></F>
            <div className="md:col-span-2"><F label="Notes"><input className="form-control" value={peerForm.notes||''} onChange={e=>setPeerForm({...peerForm,notes:e.target.value})}/></F></div>
          </div>
          <div className="alert alert-primary text-xs mt-3">For NAT/CGNAT sites: create peer, copy <b>Bootstrap script</b>, run once on RouterOS v7 (spoke dials out). Add OLT management subnets so IzanDesk can reach OLTs behind this MikroTik over the tunnel (ensure non-overlapping site subnets and routes/firewall on both ends).</div>
        </Modal>
      )}

      {scriptModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto" onClick={()=>setScriptModal(null)}>
          <div className="w-full max-w-3xl card my-8" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold flex items-center gap-2"><Copy className="w-4 h-4"/> {scriptModal.title}</h2><div className="toolbar-strip"><button onClick={()=>copy(scriptModal.script)} className="btn btn-outline btn-sm">Copy</button><button onClick={()=>setScriptModal(null)} className="btn btn-ghost btn-icon"><X className="w-4 h-4"/></button></div></div>
            <div className="p-4"><pre className="mono text-xs whitespace-pre-wrap bg-muted/40 border border-border rounded-xl p-4 overflow-auto max-h-[70vh]">{scriptModal.script}</pre>
            <div className="text-xs text-muted-foreground mt-3">Apply on MikroTik RouterOS v7+ (Terminal/import). Ensure hub <b>public endpoint</b> is set correctly and UDP port is reachable. The spoke will initiate the tunnel outbound (works behind NAT/CGNAT).</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({label,value,icon:Icon,tone='primary'}:any){ return <div className={`dash-stat dash-stat-${tone}`}><span className="dash-stat-icon"><Icon className="w-3.5 h-3.5"/></span><span className="dash-stat-body"><span className="dash-stat-label">{label}</span><span className="dash-stat-value text-base break-all">{value}</span></span></div>; }
function Row({k,v}:any){ return <div className="flex items-start justify-between gap-3"><span className="shrink-0">{k}</span><span className="text-right font-medium text-foreground/90 break-all">{v}</span></div>; }
function Mini({label,value,tone='secondary'}:any){ return <div className={`dash-stat compact dash-stat-${tone}`}><span className="dash-stat-body"><span className="dash-stat-label">{label}</span><span className="dash-stat-value text-sm break-all">{value}</span></span></div>; }
function F({label,children}:any){ return <label className="block"><div className="form-label">{label}</div>{children}</label>; }
function Modal({title,onClose,onSave,children,wide}:any){ return (
  <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className={`w-full ${wide?'max-w-3xl':'max-w-2xl'} card my-8`}>
    <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">{title}</h2><button onClick={onClose} className="btn btn-ghost btn-icon"><X className="w-4 h-4"/></button></div>
    <div className="p-5">{children}</div>
    <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={onClose} className="btn btn-outline">Cancel</button><button onClick={onSave} className="btn btn-primary">Save</button></div>
  </div></div>
); }
