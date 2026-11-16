'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { RefreshCw, Wifi, Server, Power, RotateCcw, Link2, Search, AlertTriangle, CheckCircle2, XCircle, Activity, Settings2, ListChecks, Database, FileCode2, Bug, Play } from 'lucide-react';

function fmtDate(v: any) { if (!v) return '-'; try { return new Date(v).toLocaleString(); } catch { return String(v); } }

export default function AcsPage() {
  const { token, user } = useAuth();
  const canManage = ['SUPER_ADMIN','NOC_ENGINEER','BILLING_OPERATOR'].includes(String(user?.role));
  const canDanger = ['SUPER_ADMIN','NOC_ENGINEER'].includes(String(user?.role));
  const [status, setStatus] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<'overview'|'actions'|'tasks'|'faults'|'catalog'>('overview');
  const [tasks, setTasks] = useState<any[]>([]);
  const [faults, setFaults] = useState<any[]>([]);
  const [local, setLocal] = useState<any>(null);
  const [catalog, setCatalog] = useState<{presets:any[];provisions:any[];files:any[]}>({presets:[],provisions:[],files:[]});
  const [wifi, setWifi] = useState({ ssid: '', password: '', ssid_path: '', password_path: '' });
  const [param, setParam] = useState({ mode: 'get' as 'get'|'set', name: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress', value: '', type: 'xsd:string' });
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [linkSubId, setLinkSubId] = useState('');

  const loadStatus = useCallback(async () => {
    if (!token) return;
    try { const r = await apiFetch<any>('/api/acs/status', {}, token); setStatus(r); } catch (e:any) { setStatus({ ok:false, configured:false, message:e.message }); }
  }, [token]);

  const loadDevices = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch<any>('/api/acs/devices?limit=200', {}, token);
      setDevices(r.data || []);
      if (!status) setStatus({ ok: r.ok, configured: r.configured });
    } catch (e:any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token, status]);

  const loadSubscribers = useCallback(async () => {
    if (!token) return;
    try { const r = await apiFetch<any>('/api/subscribers?limit=500', {}, token).catch(()=>({data:[]})); setSubscribers(r.data || []); } catch {}
  }, [token]);

  const loadDetail = useCallback(async (id: string) => {
    if (!token || !id) return;
    setBusy('detail');
    try {
      const [d, t, f, l] = await Promise.all([
        apiFetch<any>(`/api/acs/devices/${encodeURIComponent(id)}`, {}, token),
        apiFetch<any>(`/api/acs/devices/${encodeURIComponent(id)}/tasks`, {}, token).catch(()=>({data:[]})),
        apiFetch<any>(`/api/acs/faults?device=${encodeURIComponent(id)}`, {}, token).catch(()=>({data:[]})),
        apiFetch<any>(`/api/acs/devices/${encodeURIComponent(id)}/local`, {}, token).catch(()=>({local:null,actions:[]})),
      ]);
      setDetail(d);
      setTasks(t.data || []);
      setFaults(f.data || []);
      setLocal(l);
      setLinkSubId(String(d?.local?.subscriber_id || ''));
    } catch (e:any) { setErr(e.message); }
    finally { setBusy(null); }
  }, [token]);

  const loadCatalog = useCallback(async () => {
    if (!token) return;
    try {
      const [p, pr, fi] = await Promise.all([
        apiFetch<any>('/api/acs/presets', {}, token).catch(()=>({data:[]})),
        apiFetch<any>('/api/acs/provisions', {}, token).catch(()=>({data:[]})),
        apiFetch<any>('/api/acs/files', {}, token).catch(()=>({data:[]})),
      ]);
      setCatalog({ presets: p.data || [], provisions: pr.data || [], files: fi.data || [] });
    } catch {}
  }, [token]);

  useEffect(() => { if (token) loadStatus(); loadSubscribers(); }, [token, loadStatus, loadSubscribers]);
  useEffect(() => { if (token) { loadDevices(); loadCatalog(); } }, [token, loadDevices, loadCatalog]);
  useEffect(() => { if (selected?.id && token) loadDetail(selected.id); }, [selected?.id, token, loadDetail]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return devices;
    return devices.filter(d => [d.id, d.serial_number, d.manufacturer, d.model_name, d.ip_address, d?.local?.subscriber_name, d?.local?.client_code].some(x => String(x||'').toLowerCase().includes(s)));
  }, [devices, q]);

  const run = async (label: string, fn: () => Promise<any>, refresh = true) => {
    setErr(null); setMsg(null); setBusy(label);
    try { await fn(); setMsg(`${label} completed/queued.`); if (refresh && selected?.id) await loadDetail(selected.id); if (refresh) await loadDevices(); }
    catch (e:any) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const sync = () => run('Sync', async () => { await apiFetch('/api/acs/sync', { method:'POST' }, token!); });
  const refreshDevice = () => selected?.id && run('Refresh', async () => { await apiFetch(`/api/acs/devices/${encodeURIComponent(selected.id)}/refresh`, { method:'POST', body: JSON.stringify({ root: 'InternetGatewayDevice.' }) }, token!); });
  const rebootDevice = () => selected?.id && confirm('Reboot this CPE device via TR-069?') && run('Reboot', async () => { await apiFetch(`/api/acs/devices/${encodeURIComponent(selected.id)}/reboot`, { method:'POST' }, token!); });
  const factoryReset = () => selected?.id && run('Factory reset', async () => { await apiFetch(`/api/acs/devices/${encodeURIComponent(selected.id)}/factory-reset`, { method:'POST', body: JSON.stringify({ confirm: 'FACTORY_RESET' }) }, token!); }, false);
  const saveWifi = () => selected?.id && run('Wi-Fi update', async () => { await apiFetch('/api/acs/wifi', { method:'POST', body: JSON.stringify({ device_id: selected.id, ssid: wifi.ssid || undefined, password: wifi.password || undefined, ssid_path: wifi.ssid_path || undefined, password_path: wifi.password_path || undefined }) }, token!); });
  const runParam = () => selected?.id && run(param.mode === 'get' ? 'Get parameter' : 'Set parameter', async () => {
    if (param.mode === 'get') await apiFetch(`/api/acs/devices/${encodeURIComponent(selected.id)}/get-params`, { method:'POST', body: JSON.stringify({ parameterNames: [param.name] }) }, token!);
    else await apiFetch(`/api/acs/devices/${encodeURIComponent(selected.id)}/set-params`, { method:'POST', body: JSON.stringify({ parameterValues: [[param.name, param.value, param.type || 'xsd:string']] }) }, token!);
  });
  const linkSubscriber = () => selected?.id && run('Link subscriber', async () => { await apiFetch(`/api/acs/devices/${encodeURIComponent(selected.id)}/link`, { method:'POST', body: JSON.stringify({ subscriber_id: linkSubId || null }) }, token!); });
  const deleteTask = (taskId: string) => run('Delete task', async () => { await apiFetch(`/api/acs/tasks/${encodeURIComponent(taskId)}`, { method:'DELETE' }, token!); });
  const deleteFault = (id: string) => run('Delete fault', async () => { await apiFetch(`/api/acs/faults/${encodeURIComponent(id)}`, { method:'DELETE' }, token!); });

  const deviceCount = devices.length;
  const onlineish = devices.filter(d => d.last_inform_at).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Wifi className="w-6 h-6 text-primary"/>ACS / TR-069 (GenieACS)</h1>
          <p className="text-sm text-muted-foreground">Manage CPE devices via GenieACS: discovery, Wi-Fi/config tasks, diagnostics actions, and provisioning catalog.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadDevices} disabled={loading} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
          <button onClick={sync} disabled={!canDanger || !status?.configured || busy==='Sync'} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Database className="w-4 h-4"/>Sync from ACS</button>
        </div>
      </div>

      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground">ACS Status</div><div className="mt-1 font-bold flex items-center gap-2">{status?.configured ? (status?.reachable !== false ? <><CheckCircle2 className="w-4 h-4 text-emerald-400"/>Configured</> : <><AlertTriangle className="w-4 h-4 text-amber-400"/>Unreachable</>) : <><XCircle className="w-4 h-4 text-red-400"/>Not configured</>}</div><div className="text-xs text-muted-foreground mt-1 truncate">{status?.baseUrl || 'Set in Settings → ACS / TR-069 (or GENIEACS_URL env)'}{status?.source ? ` • source: ${status.source}` : ''}</div></div>
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground">Devices (loaded)</div><div className="text-xl font-black mt-1">{deviceCount}</div></div>
        <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5"><div className="text-xs text-emerald-300/80">With inform timestamp</div><div className="text-xl font-black mt-1 text-emerald-400">{onlineish}</div></div>
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground">Catalog</div><div className="text-sm mt-1">{catalog.presets.length} presets • {catalog.provisions.length} provisions • {catalog.files.length} files</div></div>
      </div>

      {!status?.configured && (
        <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-sm text-amber-100 space-y-2">
          <div className="font-semibold">GenieACS is not configured</div>
          <div>Configure GenieACS from the UI or via environment variables, then (optionally) start the ACS stack:</div>
          <ul className="list-disc ml-5 text-amber-100/90">
            <li><b>UI (recommended):</b> go to <a href="/settings" className="underline font-semibold">Settings & Security → ACS / TR-069</a> and set the GenieACS NBI URL (and credentials if needed), then save.</li>
            <li><b>Env fallback:</b> set <code>GENIEACS_URL</code> (and <code>GENIEACS_USER</code>/<code>GENIEACS_PASS</code>) for the API service.</li>
            <li>Docker: enable compose profile <code>acs</code> to run GenieACS + MongoDB (<code>docker compose --profile acs up -d</code>).</li>
            <li>Point CPE TR-069/CWMP ACS URL to your GenieACS CWMP endpoint (e.g. <code>http://&lt;server&gt;:7547/</code>) and wait for devices to inform.</li>
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground"/>
            <input className="flex-1 bg-transparent outline-none text-sm" placeholder="Search device, serial, model, subscriber..." value={q} onChange={e=>setQ(e.target.value)} />
          </div>
          <div className="max-h-[70vh] overflow-auto divide-y divide-border/70">
            {loading ? <div className="p-6 text-sm text-muted-foreground">Loading devices...</div> :
             filtered.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No ACS devices found.</div> :
             filtered.map(d => (
              <button key={d.id} onClick={()=>{ setSelected(d); setTab('overview'); }} className={`w-full text-left p-3 hover:bg-muted/30 ${selected?.id===d.id?'bg-primary/5':''}`}>
                <div className="flex items-center justify-between gap-2"><div className="font-semibold text-sm truncate">{d.model_name || d.product_class || d.id}</div><span className="text-[10px] px-2 py-0.5 rounded-full border border-border">{d.last_inform_at ? 'Seen' : 'Unknown'}</span></div>
                <div className="text-xs text-muted-foreground truncate">{d.manufacturer || '-'} • {d.serial_number || 'no serial'}</div>
                <div className="text-xs text-muted-foreground truncate">{d.ip_address || '-'} {d?.local?.client_code ? `• ${d.local.client_code}` : ''}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="xl:col-span-2 rounded-2xl border border-border bg-card p-4 min-h-[400px]">
          {!selected ? <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a device to view details and actions.</div> : (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold">{detail?.summary?.model_name || selected.model_name || selected.id}</div>
                  <div className="text-xs text-muted-foreground break-all">{selected.id}</div>
                  <div className="text-xs text-muted-foreground mt-1">Serial: {detail?.summary?.serial_number || selected.serial_number || '-'} • IP: {detail?.summary?.ip_address || selected.ip_address || '-'} • Last inform: {fmtDate(detail?.summary?.last_inform_at || selected.last_inform_at)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={refreshDevice} disabled={!canManage || busy==='Refresh'} className="px-3 py-1.5 rounded-lg border border-border text-xs inline-flex items-center gap-1 disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5"/>Refresh</button>
                  <button onClick={rebootDevice} disabled={!canDanger || busy==='Reboot'} className="px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-300 text-xs inline-flex items-center gap-1 disabled:opacity-50"><Power className="w-3.5 h-3.5"/>Reboot</button>
                  {String(user?.role)==='SUPER_ADMIN' && <button onClick={factoryReset} disabled={busy==='Factory reset'} className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 text-xs inline-flex items-center gap-1 disabled:opacity-50"><AlertTriangle className="w-3.5 h-3.5"/>Factory Reset</button>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                {(['overview','actions','tasks','faults','catalog'] as const).map(t => (
                  <button key={t} onClick={()=>setTab(t)} className={`px-3 py-1.5 rounded-lg border font-semibold capitalize ${tab===t?'bg-primary text-primary-foreground border-primary':'border-border hover:bg-muted/40'}`}>{t}</button>
                ))}
              </div>

              {tab==='overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border p-3 space-y-2 text-sm">
                    <div className="font-semibold flex items-center gap-2"><Server className="w-4 h-4"/>Device Summary</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div className="text-muted-foreground">Manufacturer</div><div>{detail?.summary?.manufacturer || selected.manufacturer || '-'}</div>
                      <div className="text-muted-foreground">Model</div><div>{detail?.summary?.model_name || selected.model_name || '-'}</div>
                      <div className="text-muted-foreground">Product Class</div><div>{detail?.summary?.product_class || selected.product_class || '-'}</div>
                      <div className="text-muted-foreground">OUI</div><div>{detail?.summary?.oui || selected.oui || '-'}</div>
                      <div className="text-muted-foreground">Software</div><div>{detail?.summary?.software_version || selected.software_version || '-'}</div>
                      <div className="text-muted-foreground">Hardware</div><div>{detail?.summary?.hardware_version || selected.hardware_version || '-'}</div>
                      <div className="text-muted-foreground">Connection URL</div><div className="truncate" title={detail?.summary?.connection_request_url || ''}>{detail?.summary?.connection_request_url || '-'}</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-3 space-y-3">
                    <div className="font-semibold flex items-center gap-2 text-sm"><Link2 className="w-4 h-4"/>Subscriber Linking</div>
                    <div className="text-xs text-muted-foreground">Link this ACS device to an IzanDesk subscriber for operational mapping.</div>
                    <select className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" value={linkSubId} onChange={e=>setLinkSubId(e.target.value)}>
                      <option value="">(Not linked)</option>
                      {subscribers.map(s => <option key={s.id} value={s.id}>{s.client_code || s.username || s.id} • {s.full_name || s.name || ''}</option>)}
                    </select>
                    <button onClick={linkSubscriber} disabled={!canManage || busy==='Link subscriber'} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">Save Link</button>
                    {detail?.local?.subscriber_name && <div className="text-xs text-emerald-300">Linked: {detail.local.client_code || ''} {detail.local.subscriber_name}</div>}
                  </div>
                  <div className="rounded-xl border border-border p-3 lg:col-span-2">
                    <div className="font-semibold text-sm mb-2">Raw Device (truncated preview)</div>
                    <pre className="text-xs bg-muted/30 border border-border rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">{JSON.stringify(detail?.data ? Object.fromEntries(Object.entries(detail.data).slice(0, 40)) : selected, null, 2)}</pre>
                  </div>
                </div>
              )}

              {tab==='actions' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border p-3 space-y-2">
                    <div className="font-semibold text-sm flex items-center gap-2"><Wifi className="w-4 h-4"/>Wi-Fi Update</div>
                    <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" placeholder="New SSID (optional)" value={wifi.ssid} onChange={e=>setWifi({...wifi,ssid:e.target.value})} />
                    <input type="password" className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" placeholder="New Wi-Fi password (optional)" value={wifi.password} onChange={e=>setWifi({...wifi,password:e.target.value})} />
                    <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Advanced parameter paths</summary>
                      <div className="mt-2 space-y-2">
                        <input className="w-full p-2 rounded-lg border border-border bg-card" placeholder="SSID path (TR-098/TR-181)" value={wifi.ssid_path} onChange={e=>setWifi({...wifi,ssid_path:e.target.value})} />
                        <input className="w-full p-2 rounded-lg border border-border bg-card" placeholder="Password path (KeyPassphrase)" value={wifi.password_path} onChange={e=>setWifi({...wifi,password_path:e.target.value})} />
                      </div>
                    </details>
                    <button onClick={saveWifi} disabled={!canManage || (!wifi.ssid && !wifi.password) || busy==='Wi-Fi update'} className="w-full px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">Queue Wi-Fi Task</button>
                    <div className="text-xs text-muted-foreground">Device must support the parameter paths and be reachable by GenieACS (connection request/inform).</div>
                  </div>
                  <div className="rounded-xl border border-border p-3 space-y-2">
                    <div className="font-semibold text-sm flex items-center gap-2"><Settings2 className="w-4 h-4"/>Get / Set Parameter</div>
                    <div className="flex gap-2 text-xs">
                      <button onClick={()=>setParam(p=>({...p,mode:'get'}))} className={`px-2.5 py-1 rounded-lg border ${param.mode==='get'?'bg-primary text-primary-foreground border-primary':'border-border'}`}>Get</button>
                      <button onClick={()=>setParam(p=>({...p,mode:'set'}))} className={`px-2.5 py-1 rounded-lg border ${param.mode==='set'?'bg-primary text-primary-foreground border-primary':'border-border'}`}>Set</button>
                    </div>
                    <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm font-mono" placeholder="Parameter name/path" value={param.name} onChange={e=>setParam({...param,name:e.target.value})} />
                    {param.mode==='set' && <>
                      <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" placeholder="Value" value={param.value} onChange={e=>setParam({...param,value:e.target.value})} />
                      <select className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" value={param.type} onChange={e=>setParam({...param,type:e.target.value})}>
                        {['xsd:string','xsd:boolean','xsd:int','xsd:unsignedInt'].map(t=> <option key={t} value={t}>{t}</option>)}
                      </select>
                    </>}
                    <button onClick={runParam} disabled={!canManage || !param.name || busy==='Get parameter' || busy==='Set parameter'} className="w-full px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted/40 text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"><Play className="w-4 h-4"/>Queue {param.mode === 'get' ? 'GetParameterValues' : 'SetParameterValues'}</button>
                    <div className="text-xs text-muted-foreground">Use TR-098 (InternetGatewayDevice.*) or TR-181 (Device.*) paths depending on the CPE.</div>
                  </div>
                </div>
              )}

              {tab==='tasks' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><div className="font-semibold text-sm flex items-center gap-2"><ListChecks className="w-4 h-4"/>ACS Tasks (queued/active on GenieACS)</div><button onClick={()=>selected?.id && loadDetail(selected.id)} className="text-xs px-2 py-1 rounded border border-border">Refresh</button></div>
                  <div className="overflow-auto rounded-xl border border-border">
                    <table className="w-full text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="text-left p-2">Task</th><th className="text-left p-2">Name</th><th className="text-left p-2">Time</th><th className="text-left p-2">Fault</th><th className="text-right p-2">Action</th></tr></thead>
                    <tbody>{tasks.length ? tasks.map((t:any)=>(
                      <tr key={t._id || JSON.stringify(t)} className="border-t border-border/60"><td className="p-2 font-mono truncate max-w-[180px]" title={t._id}>{t._id || '-'}</td><td className="p-2">{t.name || '-'}</td><td className="p-2">{fmtDate(t.timestamp || t._timestamp)}</td><td className="p-2 text-red-300 truncate max-w-[180px]">{t.fault ? (t.fault.message || JSON.stringify(t.fault)) : '-'}</td><td className="p-2 text-right">{t._id && <button onClick={()=>deleteTask(t._id)} disabled={!canDanger} className="px-2 py-1 rounded border border-border hover:bg-muted/40 disabled:opacity-50">Delete</button>}</td></tr>
                    )) : <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No tasks found for this device.</td></tr>}</tbody></table>
                  </div>
                  <div className="font-semibold text-sm mt-2">Local action history</div>
                  <div className="space-y-2 max-h-48 overflow-auto">{(local?.actions||[]).length ? (local.actions||[]).map((a:any)=>(<div key={a.id} className="p-2 rounded-lg border border-border text-xs"><div className="flex justify-between gap-2"><span className="font-semibold">{a.action}</span><span className="text-muted-foreground">{fmtDate(a.created_at)}</span></div><div className="text-muted-foreground">{a.status}{a.error_message ? ` • ${a.error_message}`:''}</div></div>)) : <div className="text-xs text-muted-foreground">No local actions recorded.</div>}</div>
                </div>
              )}

              {tab==='faults' && (
                <div className="space-y-3">
                  <div className="font-semibold text-sm flex items-center gap-2"><Bug className="w-4 h-4"/>Device Faults</div>
                  <div className="overflow-auto rounded-xl border border-border">
                    <table className="w-full text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="text-left p-2">Fault ID</th><th className="text-left p-2">Channel/Code</th><th className="text-left p-2">Message</th><th className="text-left p-2">Time</th><th className="text-right p-2">Action</th></tr></thead>
                    <tbody>{faults.length ? faults.map((f:any)=>(
                      <tr key={f._id || JSON.stringify(f)} className="border-t border-border/60"><td className="p-2 font-mono truncate max-w-[160px]" title={f._id}>{f._id || '-'}</td><td className="p-2">{f.channel || f.code || '-'}</td><td className="p-2 text-red-300">{f.message || f.detail?.message || JSON.stringify(f.detail || f).slice(0,120)}</td><td className="p-2">{fmtDate(f.timestamp)}</td><td className="p-2 text-right">{f._id && <button onClick={()=>deleteFault(f._id)} disabled={!canDanger} className="px-2 py-1 rounded border border-border hover:bg-muted/40 disabled:opacity-50">Delete</button>}</td></tr>
                    )) : <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No faults reported for this device.</td></tr>}</tbody></table>
                  </div>
                </div>
              )}

              {tab==='catalog' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-border p-3"><div className="font-semibold text-sm flex items-center gap-2 mb-2"><FileCode2 className="w-4 h-4"/>Presets ({catalog.presets.length})</div><div className="space-y-1 max-h-72 overflow-auto text-xs">{catalog.presets.length ? catalog.presets.map((p:any,i:number)=><div key={p._id||i} className="p-2 rounded border border-border/60"><div className="font-medium">{p._id || p.name || '(preset)'}</div><div className="text-muted-foreground truncate">weight: {p.weight ?? '-'} • events: {Array.isArray(p.events)?p.events.join(', '):'-'}</div></div>) : <div className="text-muted-foreground">No presets or ACS not reachable.</div>}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="font-semibold text-sm flex items-center gap-2 mb-2"><Activity className="w-4 h-4"/>Provisions ({catalog.provisions.length})</div><div className="space-y-1 max-h-72 overflow-auto text-xs">{catalog.provisions.length ? catalog.provisions.map((p:any,i:number)=><div key={p._id||i} className="p-2 rounded border border-border/60 font-mono truncate" title={p._id}>{p._id || '(provision)'}</div>) : <div className="text-muted-foreground">No provisions or ACS not reachable.</div>}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="font-semibold text-sm flex items-center gap-2 mb-2"><Database className="w-4 h-4"/>Files ({catalog.files.length})</div><div className="space-y-1 max-h-72 overflow-auto text-xs">{catalog.files.length ? catalog.files.map((f:any,i:number)=><div key={f._id||i} className="p-2 rounded border border-border/60"><div className="font-medium truncate" title={f._id || f.filename}>{f.filename || f._id || '(file)'}</div><div className="text-muted-foreground truncate">{f.metadata?.fileType || f['metadata.fileType'] || ''} {f.length ? `• ${f.length} bytes` : ''}</div></div>) : <div className="text-muted-foreground">No files or ACS not reachable.</div>}</div></div>
                  <div className="lg:col-span-3 text-xs text-muted-foreground">Presets/provisions/files are managed by GenieACS. IzanDesk surfaces them for visibility; create/edit advanced provisioning logic in GenieACS UI/config for your CPE fleet (including Tenda/vendor-specific parameter models).</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
