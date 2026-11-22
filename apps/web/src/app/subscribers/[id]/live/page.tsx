'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, RefreshCw, Wifi, Activity, Gauge, Globe, Router, KeyRound, Signal, Server, AlertTriangle, Eye, EyeOff } from 'lucide-react';

function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(2)} Mbps`;
  if (n > 1e3) return `${(n / 1e3).toFixed(1)} Kbps`;
  return `${n.toFixed(0)} bps`;
}
function fmtBytes(b: number) {
  const n = Number(b || 0);
  if (n > 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

export default function SubscriberLivePage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [bwHistory, setBwHistory] = useState<Array<{ t: number; rx: number; tx: number }>>([]);
  const [latencyState, setLatencyState] = useState<any>(null);
  const lastPingAt = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async (opts?: { ping?: boolean; silent?: boolean }) => {
    if (!token || !id) return;
    if (inFlight.current && opts?.silent) return; // avoid piling up 1s polls
    const ping = opts?.ping ?? false;
    inFlight.current = true;
    if (!opts?.silent) setLoading(true);
    if (!opts?.silent) setError(null);
    try {
      const res = await apiFetch<any>(`/api/subscribers/${id}/live${ping ? '' : '?ping=0'}`, {}, token);
      setData(res);
      const rx = Number(res?.bandwidth?.rx_bps || 0);
      const tx = Number(res?.bandwidth?.tx_bps || 0);
      setBwHistory(h => [...h.slice(-59), { t: Date.now(), rx, tx }]); // last 60s
      if (ping) {
        lastPingAt.current = Date.now();
        setLatencyState(res?.latency ?? null);
      } else if (res?.latency) {
        setLatencyState(res.latency);
      }
    } catch (e: any) {
      if (!opts?.silent) setError(e.message || 'Failed to load live data');
    } finally {
      inFlight.current = false;
      if (!opts?.silent) setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    const tick = async (forcePing = false) => {
      if (cancelled) return;
      const now = Date.now();
      const shouldPing = forcePing || (now - lastPingAt.current > 15000);
      await load({ ping: shouldPing, silent: true });
    };
    load({ ping: true });
    const t = setInterval(() => { tick(false); }, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [token, id, load]);

  const sub = data?.subscriber || {};
  const bw = data?.bandwidth || {};
  const active = data?.active_session || null;
  const onus = data?.onu?.linked || [];
  const equipment = data?.onu?.equipment || [];
  const latency = latencyState ?? data?.latency;

  const chart = useMemo(() => {
    const W = 700, H = 180, pad = 10;
    const vals = bwHistory.length ? bwHistory : [{ t: Date.now(), rx: 0, tx: 0 }];
    const max = Math.max(1, ...vals.map(v => Math.max(v.rx, v.tx, v.rx + v.tx)));
    const toX = (i: number) => vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * W;
    const toY = (v: number) => H - pad - ((v / max) * (H - pad * 2));
    const rxPts = vals.map((v, i) => `${toX(i)},${toY(v.rx)}`).join(' ');
    const txPts = vals.map((v, i) => `${toX(i)},${toY(v.tx)}`).join(' ');
    const rxArea = `0,${H} ${rxPts} ${W},${H}`;
    const txArea = `0,${H} ${txPts} ${W},${H}`;
    return { rxPts, txPts, rxArea, txArea, max };
  }, [bwHistory]);

  const passwordValue = useMemo(() => String(sub.password || ''), [sub.password]);
  const isHashed = passwordValue.startsWith('$2') || passwordValue.length > 40;

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div className="flex items-start gap-3">
          <Link href="/subscribers" className="btn btn-outline btn-icon mt-0.5" title="Back to subscribers"><ArrowLeft className="w-4 h-4"/></Link>
          <div>
            <span className="page-eyebrow">Client operations · Live diagnostics</span>
            <h1 className="page-title">Subscriber Live Dashboard</h1>
            <p className="page-subtitle">{sub.full_name || 'Subscriber'} {sub.client_code ? `• ${sub.client_code}` : ''} {sub.username ? `• ${sub.username}` : ''}</p>
          </div>
        </div>
        <div className="page-actions">
          <Link href="/subscribers/live" className="btn btn-outline"><Activity className="w-4 h-4"/>All Live Sessions</Link>
          <button onClick={() => load({ ping: true })} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/>Refresh</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="stat-grid">
        <div className={`dash-stat ${bw.online ? 'dash-stat-success' : 'dash-stat-secondary'}`}>
          <span className="dash-stat-icon"><Wifi className="w-4 h-4"/></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Connection</span><span className="dash-stat-value">{bw.online ? 'ONLINE' : (sub.status || 'OFFLINE')}</span><span className="dash-stat-hint">Uptime: {bw.uptime || '-'}</span></span>
        </div>
        <div className="dash-stat dash-stat-info">
          <span className="dash-stat-icon"><Gauge className="w-4 h-4"/></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Live Download (RX)</span><span className="dash-stat-value">{fmtBps(Number(bw.rx_bps || 0))}</span><span className="dash-stat-hint">Total: {fmtBytes(Number(bw.rx_bytes || 0))}</span></span>
        </div>
        <div className="dash-stat dash-stat-indigo">
          <span className="dash-stat-icon"><Gauge className="w-4 h-4"/></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Live Upload (TX)</span><span className="dash-stat-value">{fmtBps(Number(bw.tx_bps || 0))}</span><span className="dash-stat-hint">Total: {fmtBytes(Number(bw.tx_bytes || 0))}</span></span>
        </div>
        <div className={`dash-stat ${latency?.ok ? (Number(latency.latency_ms) < 50 ? 'dash-stat-success' : Number(latency.latency_ms) < 120 ? 'dash-stat-warning' : 'dash-stat-danger') : 'dash-stat-secondary'}`}>
          <span className="dash-stat-icon"><Signal className="w-4 h-4"/></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Latency (Ping)</span><span className="dash-stat-value">{latency ? (latency.ok ? `${latency.latency_ms ?? '-'} ms` : 'Unreachable') : (bw.ip_address ? 'Checking...' : '-')}</span><span className="dash-stat-hint">Target: {bw.ip_address || sub.ip_address || 'No IP'}</span></span>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div>
            <h2 className="font-bold flex items-center gap-2"><Activity className="w-4 h-4 text-primary"/>Live Bandwidth (1s updates)</h2>
            <p className="text-xs text-muted-foreground">Real-time RX/TX throughput for this subscriber (last ~60 seconds)</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="badge badge-info font-mono">RX {fmtBps(Number(bw.rx_bps || 0))}</div>
            <div className="badge badge-primary font-mono">TX {fmtBps(Number(bw.tx_bps || 0))}</div>
          </div>
        </div>
        <div className="w-full h-48 relative overflow-hidden rounded-xl bg-gradient-to-b from-muted/30 to-muted/10 border border-border/40 p-2">
          <svg viewBox="0 0 700 180" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="rxGradSub" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06B6D4" stopOpacity="0.35"/><stop offset="100%" stopColor="#06B6D4" stopOpacity="0.02"/></linearGradient>
              <linearGradient id="txGradSub" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366F1" stopOpacity="0.28"/><stop offset="100%" stopColor="#6366F1" stopOpacity="0.02"/></linearGradient>
            </defs>
            <polygon points={chart.txArea} fill="url(#txGradSub)" />
            <polygon points={chart.rxArea} fill="url(#rxGradSub)" />
            <polyline fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={chart.txPts} />
            <polyline fill="none" stroke="#06B6D4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chart.rxPts} />
          </svg>
          <div className="absolute bottom-2 left-3 text-[10px] font-mono text-muted-foreground flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span>Updating every 1s • Peak scale {fmtBps(chart.max)} • RX cyan / TX indigo</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="card p-4 space-y-3">
          <h2 className="font-bold flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary"/>Account & Connection</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Info label="Username" value={sub.username || '-'} mono />
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                <span>Password (stored)</span>
                <button onClick={()=>setShowPass(s=>!s)} className="btn btn-outline btn-sm">{showPass ? <><EyeOff className="w-3 h-3"/>Hide</> : <><Eye className="w-3 h-3"/>Show</>}</button>
              </div>
              <div className="font-mono text-xs p-2 rounded-lg bg-muted/30 border border-border break-all">{showPass ? (passwordValue || '-') : (passwordValue ? '••••••••••••' : '-')}</div>
              {isHashed && showPass && <div className="text-[11px] text-warning mt-1">Stored as hash (plain text not available). PPPoE provisioning may require re-setting a known password.</div>}
            </div>
            <Info label="IP Address" value={bw.ip_address || sub.ip_address || '-'} mono />
            <Info label="MAC Address" value={bw.mac_address || sub.mac_address || '-'} mono />
            <Info label="Connection Type" value={sub.connection_type || '-'} />
            <Info label="Provisioning" value={`${sub.provisioning_mode || '-'}${bw.router_name ? ` • ${bw.router_name}` : sub.router_name ? ` • ${sub.router_name}` : ''}`} />
            <Info label="Package" value={sub.package_name || '-'} />
            <Info label="Profile Bandwidth" value={sub.bandwidth_mbps ? `${sub.bandwidth_mbps} Mbps` : '-'} />
            <Info label="Subscriber Status" value={sub.status || '-'} />
            <Info label="Session Source" value={bw.integration_mode || '-'} />
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h2 className="font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-primary"/>Live Session & Network</h2>
          {active ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Info label="Session Status" value={active.status || '-'} />
              <Info label="Session Uptime" value={active.uptime || '-'} />
              <Info label="Router / NAS" value={active.router_name || '-'} />
              <Info label="NAS IP / Port" value={`${active.nas_ip || active.nas_port || '-'}${active.nas_port ? ` • ${active.nas_port}` : ''}`} />
              <Info label="Session ID" value={active.session_id || '-'} mono />
              <Info label="Last Update" value={active.updated_at ? new Date(active.updated_at).toLocaleString() : '-'} />
              <Info label="RX Bytes" value={fmtBytes(Number(active.rx_bytes || 0))} />
              <Info label="TX Bytes" value={fmtBytes(Number(active.tx_bytes || 0))} />
              <Info label="Latency" value={latency ? (latency.ok ? `${latency.latency_ms ?? '-'} ms` : 'Unreachable / no reply') : '-'} />
              <Info label="Ping Target" value={bw.ip_address || 'No IP to ping'} mono />
            </div>
          ) : (
            <div className="alert alert-warning">No live/session record found for this subscriber yet. If the subscriber is online, ensure they are provisioned in IzanDesk (username matched), connected via the monitored router/NAS, and accounting/active-session data is available.</div>
          )}
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-bold flex items-center gap-2"><Server className="w-4 h-4 text-primary"/>ONU / OLT Information</h2>
          {onus.length > 0 && <div className="text-xs text-muted-foreground">{onus.length} linked ONU{onus.length > 1 ? 's' : ''}</div>}
        </div>
        {!onus.length && !equipment.length ? (
          <div className="alert alert-warning space-y-1">
            <div>No ONU/OLT info linked to this subscriber.</div>
            <div>ONU details are auto-discovered/linked when possible (by PPPoE session MAC/FDB or username/client-code match). You can also link an ONU from FTTH &amp; OLTs.</div>
          </div>
        ) : (
          <div className="space-y-4">
            {onus.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {onus.map((o:any, i:number) => {
                  const st = String(o.status || 'UNKNOWN').toUpperCase();
                  const online = st === 'ONLINE';
                  const rx = o.rx_power_dbm != null ? Number(o.rx_power_dbm) : null;
                  const tx = o.tx_power_dbm != null ? Number(o.tx_power_dbm) : null;
                  const optState = rx == null ? 'Unknown' : rx >= -24 ? 'Good' : rx >= -27 ? 'Warn' : 'Critical';
                  return (
                    <div key={o.id || i} className={`card p-4 space-y-4 ${online ? 'border-success/30' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">Linked ONU (from OLT)</div>
                          <div className="font-bold text-base truncate" title={o.name || o.serial_number || ''}>{o.name || o.serial_number || 'ONU'}</div>
                          <div className="text-xs text-muted-foreground truncate">{o.olt_name || 'OLT'} {o.olt_vendor || o.olt_model ? `• ${[o.olt_vendor,o.olt_model].filter(Boolean).join(' ')}` : ''} {o.olt_host ? `• ${o.olt_host}` : ''}</div>
                        </div>
                        <span className={`badge shrink-0 ${online ? 'badge-success' : st === 'OFFLINE' ? 'badge-danger' : 'badge-secondary'}`}>{o.status || 'UNKNOWN'}</span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-3 rounded-xl border border-border/70 bg-card/60">
                          <div className="text-[11px] text-muted-foreground">Optical Rx</div>
                          <div className={`mt-1 text-lg font-black ${rxClass(rx)}`}>{rx != null ? `${Number(rx).toFixed(2)}` : '-'}<span className="text-xs font-medium text-muted-foreground"> {rx!=null?'dBm':''}</span></div>
                          <div className="text-[11px] text-muted-foreground">{optState} signal</div>
                        </div>
                        <div className="p-3 rounded-xl border border-border/70 bg-card/60">
                          <div className="text-[11px] text-muted-foreground">Optical Tx</div>
                          <div className="mt-1 text-lg font-black text-foreground">{tx != null ? `${Number(tx).toFixed(2)}` : '-'}<span className="text-xs font-medium text-muted-foreground"> {tx!=null?'dBm':''}</span></div>
                          <div className="text-[11px] text-muted-foreground">Transmit</div>
                        </div>
                        <div className="p-3 rounded-xl border border-border/70 bg-card/60">
                          <div className="text-[11px] text-muted-foreground">Distance</div>
                          <div className="mt-1 text-lg font-black text-foreground">{o.distance_m != null ? `${o.distance_m}` : '-'}<span className="text-xs font-medium text-muted-foreground"> {o.distance_m!=null?'m':''}</span></div>
                          <div className="text-[11px] text-muted-foreground">Fiber length</div>
                        </div>
                        <div className="p-3 rounded-xl border border-border/70 bg-card/60">
                          <div className="text-[11px] text-muted-foreground">Temperature</div>
                          <div className="mt-1 text-lg font-black text-foreground">{o.temperature_c != null ? `${Number(o.temperature_c).toFixed(2)}` : '-'}<span className="text-xs font-medium text-muted-foreground"> {o.temperature_c!=null?'°C':''}</span></div>
                          <div className="text-[11px] text-muted-foreground">Module temp</div>
                        </div>
                        <div className="p-3 rounded-xl border border-border/70 bg-card/60">
                          <div className="text-[11px] text-muted-foreground">Voltage</div>
                          <div className="mt-1 text-lg font-black text-foreground">{o.voltage_v != null ? `${Number(o.voltage_v).toFixed(2)}` : '-'}<span className="text-xs font-medium text-muted-foreground"> {o.voltage_v!=null?'V':''}</span></div>
                          <div className="text-[11px] text-muted-foreground">Supply</div>
                        </div>
                        <div className="p-3 rounded-xl border border-border/70 bg-card/60">
                          <div className="text-[11px] text-muted-foreground">TX Bias</div>
                          <div className="mt-1 text-lg font-black text-foreground">{o.tx_bias_ma != null ? `${Number(o.tx_bias_ma).toFixed(2)}` : '-'}<span className="text-xs font-medium text-muted-foreground"> {o.tx_bias_ma!=null?'mA':''}</span></div>
                          <div className="text-[11px] text-muted-foreground">Laser bias</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60"><div className="text-[11px] text-muted-foreground">PON / ONU ID</div><div className="font-mono text-xs mt-0.5">{o.pon_port || '-'} {o.onu_id ? `/ ${o.onu_id}` : ''}</div></div>
                        <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60"><div className="text-[11px] text-muted-foreground">Serial / SN</div><div className="font-mono text-xs mt-0.5 break-all">{o.serial_number || '-'}</div></div>
                        <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60"><div className="text-[11px] text-muted-foreground">ONU MAC</div><div className="font-mono text-xs mt-0.5">{o.mac_address || '-'}</div></div>
                        <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60"><div className="text-[11px] text-muted-foreground">OLT Status</div><div className="text-xs mt-0.5">{o.olt_status || (online ? 'ONLINE' : '-') }{o.olt_host ? ` • ${o.olt_host}` : ''}</div></div>
                        <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60 col-span-2"><div className="text-[11px] text-muted-foreground">Last Seen / Last Down</div><div className="text-xs mt-0.5">{o.last_seen_at ? new Date(o.last_seen_at).toLocaleString() : '-'}{o.last_down_cause ? ` • ${o.last_down_cause}` : ''}</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {equipment.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2">Assigned Equipment (CPE/ONU)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {equipment.map((e:any, i:number) => (
                    <div key={e.id || i} className="card p-4 text-sm space-y-2">
                      <div className="flex items-center justify-between gap-2"><div className="font-medium">{e.equipment_type || 'Equipment'} {e.serial_number ? `• ${e.serial_number}` : ''}</div><span className="badge badge-secondary">{e.status || '-'}</span></div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>MAC: <span className="font-mono text-foreground">{e.mac_address || '-'}</span></div>
                        <div>ONU: <span className="font-mono text-foreground">{e.onu_serial || '-'}</span> {e.onu_pon_port ? `(${e.onu_pon_port})` : ''}</div>
                        <div>OLT: {e.olt_name || '-'}</div>
                        <div>Optical: Rx {e.rx_power_dbm ?? '-'} / Tx {e.tx_power_dbm ?? '-'} dBm</div>
                        {e.location_details ? <div className="col-span-2">Location: {e.location_details}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="text-xs text-muted-foreground flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 text-warning"/>Optical/ONU telemetry is polled from the OLT (via SNMP over the tunnel). Refresh or run OLT discovery/telemetry if values look stale.</div>
      </div>

      <div className="text-xs text-muted-foreground">Live bandwidth updates every 1s (latency refreshed periodically, ping skipped on fast polls). Last fetched: {data?.fetched_at ? new Date(data.fetched_at).toLocaleString() : '-'}</div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`${mono ? 'font-mono text-xs' : 'text-sm'} p-2 rounded-lg bg-muted/30 border border-border break-all`}>{value ?? '-'}</div>
    </div>
  );
}
function rxClass(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'text-muted-foreground';
  if (n >= -24) return 'text-success';
  if (n >= -27) return 'text-warning';
  return 'text-danger';
}
