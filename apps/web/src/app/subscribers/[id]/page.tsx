'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, RefreshCw, User, Activity, Package, MessageSquare, History, Wifi, ShieldCheck } from 'lucide-react';
import { TelemetryChart } from '@/components/charts/telemetry-chart';

function badge(status: string) {
  const s = String(status || '').toUpperCase();
  if (['ACTIVE','ONLINE','COMPLETED','VERIFIED','PAID'].includes(s)) return 'badge-success';
  if (['SUSPENDED','EXPIRED','FAILED','REJECTED','OVERDUE'].includes(s)) return 'badge-danger';
  if (['PENDING','DUE','PARTIAL'].includes(s)) return 'badge-warning';
  return 'badge-secondary';
}
function fmtDate(d: any) { return d ? new Date(d).toLocaleString() : '-'; }
function money(v: any) { return `৳${Number(v || 0).toLocaleString()}`; }
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 py-1.5 border-b border-border/50 last:border-0 text-sm"><span className="text-muted-foreground">{k}</span><span className="font-medium text-right break-all">{v ?? '-'}</span></div>;
}

export default function Subscriber360Page() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const { token } = useAuth();
  const [d, setD] = useState<any>(null);
  const [fupLogs, setFupLogs] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [comms, setComms] = useState<any[]>([]);
  const [kyc, setKyc] = useState<any>(null);
  const [telemetryHist, setTelemetryHist] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true); setErr(null);
    try {
      const [sub, fl, hist, eq, cm, kp, th] = await Promise.all([
        apiFetch<any>(`/api/subscribers/${id}`, {}, token),
        apiFetch<any>(`/api/billing/fup/logs?subscriber_id=${id}`, {}, token).catch(()=>({data:[]})),
        apiFetch<any>(`/api/subscribers/${id}/history`, {}, token).catch(()=>({data:{status_changes:[]}})),
        apiFetch<any>(`/api/subscriber-equipment/subscriber/${id}`, {}, token).catch(()=>({data:[]})),
        apiFetch<any>(`/api/subscriber-communications/subscriber/${id}?limit=50`, {}, token).catch(()=>({data:[]})),
        apiFetch<any>(`/api/kyc/profiles/${id}`, {}, token).catch(()=>({data:null})),
        apiFetch<any>(`/api/subscribers/${id}/telemetry-history?hours=24`, {}, token).catch(()=>({data:[]})),
      ]);
      setD(sub); setFupLogs(fl?.data||[]); setHistory(hist?.data?.status_changes||[]); setEquipment(eq?.data||[]); setComms(cm?.data||[]); setKyc(kp?.data||null); setTelemetryHist(th?.data||[]);
    } catch (e: any) { setErr(e.message || 'Failed to load subscriber'); }
    finally { setLoading(false); }
  }, [token, id]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading subscriber 360° view...</div>;
  if (err) return <div className="p-6"><div className="alert alert-danger mb-3">{err}</div><Link href="/subscribers" className="btn btn-outline"><ArrowLeft className="w-4 h-4"/>Back</Link></div>;
  if (!d) return <div className="p-6">Subscriber not found.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/subscribers" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3"/>Back to subscribers</Link>
          <h1 className="page-title mt-1"><User className="w-5 h-5 text-primary inline mr-2"/>{d.full_name} <span className="text-sm font-semibold text-muted-foreground">360° View</span></h1>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="badge badge-secondary font-mono">{d.client_code}</span>
            <span className={`badge ${badge(d.status)}`}>{d.status}</span>
            {d.fup_exceeded && <span className="badge badge-warning">FUP Throttled</span>}
            <span className="badge badge-secondary">{d.connection_type || '-'}</span>
            <span className="badge badge-secondary">{d.provisioning_mode || 'RADIUS'}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/subscribers/${id}/live`} className="btn btn-outline"><Activity className="w-4 h-4"/>Live</Link>
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="dash-stat dash-stat-primary"><span className="dash-stat-body"><span className="dash-stat-label">Monthly Bill</span><span className="dash-stat-value text-base">{money(d.monthly_bill)}</span></span></div>
        <div className={`dash-stat ${Number(d.current_due||0)>0?'dash-stat-warning':'dash-stat-success'}`}><span className="dash-stat-body"><span className="dash-stat-label">Current Due</span><span className="dash-stat-value text-base">{money(d.current_due)}</span></span></div>
        <div className="dash-stat dash-stat-info"><span className="dash-stat-body"><span className="dash-stat-label">Package</span><span className="dash-stat-value text-base">{d.package_name || '-'}</span><span className="dash-stat-hint">{d.bandwidth_mbps ? `${d.bandwidth_mbps} Mbps` : ''}</span></span></div>
        <div className="dash-stat dash-stat-secondary"><span className="dash-stat-body"><span className="dash-stat-label">Expiry</span><span className="dash-stat-value text-base">{d.expiry_date ? String(d.expiry_date).slice(0,10) : '-'}</span></span></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card p-4"><h2 className="font-bold mb-2 flex items-center gap-2"><User className="w-4 h-4 text-primary"/>Profile</h2>
          <KV k="Username" v={<span className="font-mono text-xs">{d.username || '-'}</span>} />
          <KV k="Phone" v={d.phone || '-'} /><KV k="Email" v={d.email || '-'} />
          <KV k="Address" v={d.address || '-'} /><KV k="Area/District" v={[d.area_name, d.thana||d.upazila, d.district].filter(Boolean).join(', ') || '-'} />
          <KV k="NID" v={d.nid_number || '-'} /><KV k="Created" v={fmtDate(d.created_at)} />
        </div>
        <div className="card p-4"><h2 className="font-bold mb-2 flex items-center gap-2"><Wifi className="w-4 h-4 text-primary"/>Connection</h2>
          <KV k="Type" v={d.connection_type || '-'} /><KV k="Provisioning" v={d.provisioning_mode || 'RADIUS'} />
          <KV k="IP" v={<span className="font-mono text-xs">{d.ip_address || '-'}</span>} /><KV k="MAC" v={<span className="font-mono text-xs">{d.mac_address || '-'}</span>} />
          <KV k="Router" v={d.router_name || d.router_id || '-'} /><KV k="Distribution Box" v={d.distribution_box_name || d.distribution_box_code || '-'} />
          <KV k="Coordinates" v={d.latitude && d.longitude ? `${d.latitude}, ${d.longitude}` : '-'} />
        </div>
        <div className="card p-4"><h2 className="font-bold mb-2 flex items-center gap-2"><Package className="w-4 h-4 text-primary"/>Equipment ({equipment.length})</h2>
          <div className="space-y-2 max-h-[260px] overflow-auto">{equipment.map((e:any)=><div key={e.id} className="p-2 rounded-lg border border-border bg-muted/20 text-xs"><div className="font-medium">{e.equipment_type || 'Equipment'} {e.serial_number ? `• ${e.serial_number}` : ''}</div><div className="text-muted-foreground">{e.mac_address || ''} {e.status ? `• ${e.status}` : ''}</div></div>)}{!equipment.length && <div className="text-xs text-muted-foreground">No equipment.</div>}</div>
        </div>
        <div className="card p-4"><h2 className="font-bold mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary"/>KYC</h2>
          <KV k="Profile status" v={kyc?.overall_status || kyc?.status || '-'} />
          <KV k="Service type" v={kyc?.service_type || '-'} /><KV k="Identity type" v={kyc?.identity_type || '-'} />
          <div className="text-xs text-muted-foreground mt-2">Documents: {(kyc?.documents||[]).length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card p-4"><h2 className="font-bold mb-2 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary"/>Communications ({comms.length})</h2>
          <div className="space-y-2 max-h-[260px] overflow-auto">{comms.map((c:any,i:number)=><div key={c.id||i} className="p-2 rounded-lg border border-border bg-muted/20 text-xs"><div className="flex justify-between gap-2"><span className="font-medium">{c.channel_type || c.type || 'MSG'}</span><span className="text-muted-foreground">{fmtDate(c.created_at)}</span></div><div className="text-muted-foreground truncate">{c.body || c.subject || c.message || '-'}</div></div>)}{!comms.length && <div className="text-xs text-muted-foreground">No communications.</div>}</div>
        </div>
        <div className="card p-4"><h2 className="font-bold mb-2 flex items-center gap-2"><History className="w-4 h-4 text-primary"/>History ({history.length})</h2>
          <div className="space-y-2 max-h-[260px] overflow-auto">{history.map((h:any,i:number)=><div key={h.id||i} className="p-2 rounded-lg border border-border bg-muted/20 text-xs"><div className="flex justify-between gap-2"><span className="font-medium">{h.action || h.status || 'Event'}</span><span className="text-muted-foreground">{fmtDate(h.created_at)}</span></div><div className="text-muted-foreground truncate">{typeof h.details === 'string' ? h.details : JSON.stringify(h.details || h.note || '')}</div></div>)}{!history.length && <div className="text-xs text-muted-foreground">No history.</div>}</div>
        </div>
      </div>

      <TelemetryChart
        title="Bandwidth History (Last 24h)"
        subtitle="Collected from active MikroTik / RADIUS sessions"
        labels={telemetryHist.map((p: any) => new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}
        series={[
          { label: 'Download', color: '#14b8a6', values: telemetryHist.map((p: any) => +(Number(p.rx_bps || 0) / 1e6).toFixed(2)) },
          { label: 'Upload', color: '#6366f1', values: telemetryHist.map((p: any) => +(Number(p.tx_bps || 0) / 1e6).toFixed(2)) },
        ]}
        unit=" Mbps"
      />

      {fupLogs.length > 0 && <div className="card p-4"><h2 className="font-bold mb-2">FUP Logs</h2><div className="space-y-2 max-h-[220px] overflow-auto">{fupLogs.map((f:any,i:number)=><div key={f.id||i} className="text-xs p-2 rounded border border-border bg-muted/20 flex justify-between gap-2"><span>{f.action || 'FUP'} {f.details?.reason ? `- ${f.details.reason}` : ''}</span><span className="text-muted-foreground">{fmtDate(f.created_at)}</span></div>)}</div></div>}
    </div>
  );
}
