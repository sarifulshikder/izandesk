'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { Search, Plus, Pencil, Trash2, X, Upload, FileText, User, RefreshCw, MapPin, LocateFixed, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';

const LocationPicker = dynamic(() => import('./location-picker'), { ssr: false, loading: () => <div className="h-[320px] sm:h-[380px] rounded-xl border border-border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">Loading map picker...</div> });

const emptyForm = {
  full_name: '', subscriber_type: 'HOME', connection_type: 'PPPOE', username: '', password: '', phone: '', email: '', nid_number: '',
  package_name: '', bandwidth_mbps: '', monthly_bill: '', status: 'PENDING', area_id: '', zone_id: '', distribution_box_id: '',
  address: '', latitude: '', longitude: '', ip_address: '', mac_address: '', installation_date: '',
  district: '', thana: '', upazila: '', post_office: '', village: '', area_name: '', ward_no: '', road_no: '', house_no: '',
  provisioning_mode: 'RADIUS', router_id: ''
};

const steps = [
  { id: 1, title: 'Basic Info', desc: 'Identity & contact' },
  { id: 2, title: 'Connection & Package', desc: 'Service profile' },
  { id: 3, title: 'Location & Topology', desc: 'Map pin & address' },
  { id: 4, title: 'Review & Save', desc: 'Confirm details' },
];

export default function SubscribersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [detail, setDetail] = useState<any | null>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kycUploading, setKycUploading] = useState(false);
  const [step, setStep] = useState(1);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    if (!token) return;
    const [a, z, b, r] = await Promise.all([
      apiFetch<{data:any[]}>('/api/topology/areas', {}, token),
      apiFetch<{data:any[]}>('/api/topology/zones', {}, token),
      apiFetch<{data:any[]}>('/api/topology/boxes', {}, token),
      apiFetch<{data:any[]}>('/api/network/routers', {}, token),
    ]);
    setAreas(a.data || []); setZones(z.data || []); setBoxes(b.data || []); setRouters(r.data || []);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      params.set('limit', '100');
      const res = await apiFetch<{data:any[], total:number}>(`/api/subscribers?${params.toString()}`, {}, token);
      setRows(res.data || []); setTotal(res.total || 0);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [token, q, status, type]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const filteredZones = useMemo(() => form.area_id ? zones.filter(z => z.area_id === form.area_id) : zones, [zones, form.area_id]);
  const filteredBoxes = useMemo(() => form.zone_id ? boxes.filter(b => b.zone_id === form.zone_id) : boxes, [boxes, form.zone_id]);
  const directRouters = useMemo(() => routers.filter((r: any) => ['API','REST'].includes(String(r.integration_mode || 'API').toUpperCase()) && r.is_enabled !== false), [routers]);
  const radiusRouters = useMemo(() => routers.filter((r: any) => String(r.integration_mode || '').toUpperCase() === 'RADIUS' && r.is_enabled !== false), [routers]);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm }); setStep(1); setGeoMsg(null); setShowForm(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ ...emptyForm, ...row, latitude: row.latitude ?? '', longitude: row.longitude ?? '', bandwidth_mbps: row.bandwidth_mbps ?? '', monthly_bill: row.monthly_bill ?? '', router_id: row.router_id ?? '', provisioning_mode: row.provisioning_mode ?? 'RADIUS' });
    setStep(1); setGeoMsg(null); setShowForm(true);
  };

  const validateStep = () => {
    if (step === 1 && !String(form.full_name || '').trim()) { setError('Full name is required'); return false; }
    if (step === 2 && form.provisioning_mode === 'ROUTER' && !form.router_id) { setError('Select a specific router (API/REST) or choose RADIUS mode.'); return false; }
    setError(null); return true;
  };

  const nextStep = () => { if (validateStep()) setStep(s => Math.min(4, s + 1)); };
  const prevStep = () => setStep(s => Math.max(1, s - 1));

  const save = async () => {
    if (!token) return;
    if (!String(form.full_name || '').trim()) { setError('Full name is required'); setStep(1); return; }
    setError(null);
    try {
      const payload = { ...form };
      ['bandwidth_mbps','monthly_bill','latitude','longitude'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      ['area_id','zone_id','distribution_box_id','installation_date','router_id'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      if (payload.provisioning_mode === 'RADIUS') payload.router_id = null;
      if (editing) await apiFetch(`/api/subscribers/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      else await apiFetch('/api/subscribers', { method: 'POST', body: JSON.stringify(payload) }, token);
      setShowForm(false); await load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!token || !confirm('Delete this subscriber?')) return;
    await apiFetch(`/api/subscribers/${id}`, { method: 'DELETE' }, token);
    if (detail?.id === id) setDetail(null);
    await load();
  };

  const openDetail = async (id: string) => {
    if (!token) return;
    const d = await apiFetch<any>(`/api/subscribers/${id}`, {}, token);
    setDetail(d);
  };

  const uploadKyc = async (file: File, docType: string) => {
    if (!token || !detail) return;
    setKycUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('doc_type', docType);
      const res = await fetch(`${getApiBaseUrl()}/api/subscribers/${detail.id}/kyc`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Upload failed');
      await openDetail(detail.id);
    } catch (e: any) { setError(e.message); }
    finally { setKycUploading(false); }
  };

  const applyReverseGeocode = (addr: any, display?: string) => {
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = addr?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    };
    const district = pick('state_district', 'district', 'county', 'state');
    const upazila = pick('upazila', 'subdistrict', 'county', 'state_district', 'municipality', 'city_district', 'town');
    const thana = pick('thana', 'police', 'suburb', 'town', 'city_district', 'municipality', 'city', upazila);
    const postOffice = pick('post_office', 'postcode', 'postal_code');
    const village = pick('village', 'hamlet', 'isolated_dwelling', 'croft', 'locality');
    const areaName = pick('neighbourhood', 'quarter', 'residential', 'suburb', 'city_district', 'commercial', 'industrial', 'locality');
    const road = pick('road', 'street', 'pedestrian', 'footway', 'path', 'highway', 'residential', 'living_street', 'service');
    const house = pick('house_number', 'house_name', 'building', 'amenity');
    const ward = pick('ward', 'city_block', 'quarter', 'neighbourhood', 'suburb', 'municipality');
    const fullAddress = display || [house, road, ward ? `Ward ${ward}` : '', village || areaName, thana || upazila, postOffice, district].filter(Boolean).join(', ');

    setForm((f: any) => ({
      ...f,
      district: district || f.district || '',
      thana: thana || f.thana || '',
      upazila: upazila || f.upazila || '',
      post_office: postOffice || f.post_office || '',
      village: village || f.village || '',
      area_name: areaName || f.area_name || '',
      ward_no: ward || f.ward_no || '',
      road_no: road || f.road_no || '',
      house_no: house || f.house_no || '',
      address: fullAddress || f.address || '',
    }));
  };

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      setGeoLoading(true); setGeoMsg('Resolving address from map location...');
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json', 'Accept-Language': 'en' } });
      if (!res.ok) throw new Error('Reverse geocoding failed');
      const data = await res.json();
      applyReverseGeocode(data?.address || {}, data?.display_name);
      setGeoMsg('Address fields auto-filled from pinned location (satellite/map). Review and edit if needed.');
    } catch {
      setGeoMsg('Could not auto-fill address (reverse geocoding unavailable or limited data for this point). You can fill fields manually.');
    } finally { setGeoLoading(false); }
  };

  const onPickLocation = (lat: number, lng: number) => {
    setForm((f: any) => ({ ...f, latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) }));
    reverseGeocode(lat, lng);
  };

  const pickCurrentLocation = () => {
    if (!navigator.geolocation) { setGeoMsg('Geolocation is not supported by this browser.'); return; }
    setGeoLoading(true); setGeoMsg('Detecting current location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => onPickLocation(pos.coords.latitude, pos.coords.longitude),
      () => { setGeoLoading(false); setGeoMsg('Unable to access current location. Please allow permission or pin on map.'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Subscribers (BSS Core)</h1>
          <p className="text-sm text-muted-foreground">Wizard onboarding, PPPoE profiles, map-based location, auto address fill, KYC & topology — {total} total</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={openCreate} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Plus className="w-4 h-4"/>Add Subscriber</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name, client code, username, phone, email..." className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground outline-none focus:border-primary/50"/>
        </div>
        <select value={status} onChange={e=>setStatus(e.target.value)} className="px-3 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground">
          <option value="">All Statuses</option>
          {['PENDING','ACTIVE','SUSPENDED','EXPIRED','TERMINATED'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={type} onChange={e=>setType(e.target.value)} className="px-3 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground">
          <option value="">All Types</option>
          {['HOME','CORPORATE','HOTSPOT'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-left px-4 py-3">Connection</th>
                  <th className="text-left px-4 py-3">Package</th>
                  <th className="text-left px-4 py-3">Location/Topology</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading subscribers...</td></tr> :
                 rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No subscribers found. Add one with the wizard.</td></tr> :
                 rows.map(r => (
                  <tr key={r.id} className="border-t border-border/70 hover:bg-muted/30 cursor-pointer" onClick={()=>openDetail(r.id)}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{r.full_name}</div>
                      <div className="text-xs text-primary font-mono">{r.client_code}</div>
                      <div className="text-xs text-muted-foreground">{r.phone || r.email || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium">{r.connection_type}</div>
                      <div className="text-xs text-muted-foreground">{r.username ? `PPPoE: ${r.username}` : (r.subscriber_type || 'HOME')}</div>
                      <div className="text-[10px] mt-0.5">{r.provisioning_mode === 'ROUTER' ? <span className="text-cyan-400">Router: {r.router_name || 'selected'}</span> : <span className="text-violet-400">RADIUS pool</span>}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{r.package_name || '-'}</div>
                      <div className="text-xs text-muted-foreground">{r.bandwidth_mbps ? `${r.bandwidth_mbps} Mbps` : ''} {r.monthly_bill ? `• ৳${r.monthly_bill}` : ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{[r.area_name, r.village, r.thana || r.upazila, r.district].filter(Boolean).join(', ') || `${r.area_name_db || r.area_name || '-'}`}</div>
                      <div className="text-xs text-muted-foreground">{r.distribution_box_name || r.distribution_box_code || '-'} {r.latitude ? '• 📍' : ''}</div>
                    </td>
                    <td className="px-4 py-3"><span className="text-[11px] px-2 py-1 rounded-full border border-border bg-muted/40">{r.status}</span></td>
                    <td className="px-4 py-3 text-right" onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>openEdit(r)} className="p-2 rounded-lg hover:bg-muted"><Pencil className="w-4 h-4"/></button>
                      <button onClick={()=>remove(r.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-400"><Trash2 className="w-4 h-4"/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          {!detail ? (
            <div className="text-sm text-muted-foreground py-10 text-center">Select a subscriber to view details, location, and KYC documents.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-foreground flex items-center gap-2"><User className="w-4 h-4 text-primary"/>{detail.full_name}</div>
                  <div className="text-xs font-mono text-primary">{detail.client_code}</div>
                </div>
                <button onClick={()=>setDetail(null)} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4"/></button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Type" value={detail.subscriber_type} /><Info label="Connection" value={detail.connection_type} />
                <Info label="Provisioning" value={detail.provisioning_mode === 'ROUTER' ? `Router (API/REST): ${detail.router_name || detail.router_id || '-'}` : 'RADIUS (all RADIUS-enabled routers)'} />
                <Info label="PPPoE User" value={detail.username || '-'} /><Info label="Status" value={detail.status} />
                <Info label="Phone" value={detail.phone || '-'} /><Info label="Package" value={detail.package_name || '-'} />
                <Info label="District" value={detail.district || '-'} /><Info label="Thana/Upazila" value={detail.thana || detail.upazila || '-'} />
                <Info label="Post Office" value={detail.post_office || '-'} /><Info label="Village/Area" value={detail.village || detail.area_name || '-'} />
                <Info label="Ward/Road" value={[detail.ward_no, detail.road_no].filter(Boolean).join(' / ') || '-'} /><Info label="Geo" value={detail.latitude ? `${Number(detail.latitude).toFixed(5)}, ${Number(detail.longitude).toFixed(5)}` : '-'} />
                <div className="col-span-2"><Info label="Address" value={detail.address || '-'} /></div>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="font-semibold text-sm flex items-center gap-2 mb-2"><FileText className="w-4 h-4 text-primary"/>KYC Documents</div>
                <div className="space-y-2">
                  {(detail.kyc_documents || []).length === 0 ? <div className="text-xs text-muted-foreground">No KYC documents uploaded.</div> :
                    detail.kyc_documents.map((d: any) => (
                      <a key={d.id} href={`${getApiBaseUrl()}/uploads/kyc/${d.file_path}`} target="_blank" rel="noreferrer" className="flex items-center justify-between p-2 rounded-lg border border-border hover:bg-muted/40 text-xs">
                        <span><span className="font-medium">{d.doc_type}</span> — {d.file_name}</span><span className="text-muted-foreground">View</span>
                      </a>
                    ))}
                </div>
                <div className="mt-3 p-3 rounded-xl bg-muted/30 border border-border space-y-2">
                  <div className="text-xs font-semibold flex items-center gap-2"><Upload className="w-3.5 h-3.5"/>Upload KYC</div>
                  <div className="flex gap-2">
                    <select id="kyc-type" className="px-2 py-1.5 rounded-lg bg-card border border-border text-xs text-foreground" defaultValue="NID">{['NID','PASSPORT','CONTRACT','PHOTO','OTHER'].map(t=><option key={t} value={t}>{t}</option>)}</select>
                    <input type="file" className="text-xs flex-1" onChange={e=>{ const f=e.target.files?.[0]; const t=(document.getElementById('kyc-type') as HTMLSelectElement)?.value || 'OTHER'; if(f){ uploadKyc(f,t); e.currentTarget.value=''; } }} disabled={kycUploading} />
                  </div>
                  {kycUploading && <div className="text-xs text-muted-foreground">Uploading...</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-3 sm:p-4 overflow-auto">
          <div className="w-full max-w-5xl bg-card border border-border rounded-2xl shadow-2xl my-4 sm:my-6">
            <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-bold text-lg">{editing ? 'Edit Subscriber' : 'Add Subscriber'} — Wizard</h2>
                <p className="text-xs text-muted-foreground">Step {step} of 4: {steps[step-1].title} — {steps[step-1].desc}</p>
              </div>
              <button onClick={()=>setShowForm(false)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button>
            </div>

            <div className="px-4 sm:px-5 pt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {steps.map(s => (
                  <button key={s.id} onClick={()=>{ if (s.id < step || validateStep()) setStep(s.id); }} className={`text-left p-2.5 rounded-xl border text-xs ${step===s.id?'border-primary bg-primary/10':'border-border bg-muted/20'} ${s.id < step ? 'opacity-100' : ''}`}>
                    <div className="flex items-center gap-2 font-semibold text-foreground"><span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] ${step>=s.id?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground'}`}>{step>s.id ? <CheckCircle2 className="w-3.5 h-3.5"/> : s.id}</span>{s.title}</div>
                    <div className="text-muted-foreground mt-0.5 hidden sm:block">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 sm:p-5">
              {step === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input label="Full Name *" value={form.full_name} onChange={v=>setForm({...form, full_name:v})} />
                  <Select label="Subscriber Type" value={form.subscriber_type} onChange={v=>setForm({...form, subscriber_type:v})} options={['HOME','CORPORATE','HOTSPOT']} />
                  <Select label="Status" value={form.status} onChange={v=>setForm({...form, status:v})} options={['PENDING','ACTIVE','SUSPENDED','EXPIRED','TERMINATED']} />
                  <Input label="Phone" value={form.phone||''} onChange={v=>setForm({...form, phone:v})} />
                  <Input label="Email" value={form.email||''} onChange={v=>setForm({...form, email:v})} />
                  <Input label="NID Number" value={form.nid_number||''} onChange={v=>setForm({...form, nid_number:v})} />
                  <Input label="Installation Date" value={form.installation_date?String(form.installation_date).slice(0,10):''} onChange={v=>setForm({...form, installation_date:v})} type="date" />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                    <div className="font-semibold text-sm">Network Provisioning (required)</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Select label="Provision Via" value={form.provisioning_mode || 'RADIUS'} onChange={v=>setForm({...form, provisioning_mode:v, router_id: v==='RADIUS' ? '' : form.router_id})} options={[{v:'ROUTER',l:'Specific Router (API/REST) — direct per-router'}, {v:'RADIUS',l:'RADIUS (all RADIUS-enabled routers / NAS pool)'}]} />
                      {form.provisioning_mode === 'ROUTER' ? (
                        <Select label="Select Router (API/REST)" value={form.router_id||''} onChange={v=>setForm({...form, router_id:v})} options={[{v:'',l:'Select router by name...'}, ...directRouters.map((r:any)=>({v:r.id,l:`${r.name} (${String(r.integration_mode||'API').toUpperCase()} • ${r.host})`}))]} />
                      ) : (
                        <div className="text-xs text-muted-foreground p-3 rounded-xl border border-violet-500/20 bg-violet-500/5">
                          Subscriber will authenticate via centralized RADIUS across <b>all enabled RADIUS NAS routers</b> ({radiusRouters.length} available). Ensure RADIUS users are synced in <b>RADIUS & AAA</b>.
                        </div>
                      )}
                    </div>
                    {form.provisioning_mode === 'ROUTER' && !directRouters.length && <div className="text-xs text-amber-400">No API/REST routers available. Add one in Network & Routers or choose RADIUS mode.</div>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Select label="Connection Type" value={form.connection_type} onChange={v=>setForm({...form, connection_type:v})} options={['PPPOE','STATIC_IP','DHCP','HOTSPOT']} />
                    <Input label="PPPoE Username" value={form.username||''} onChange={v=>setForm({...form, username:v})} />
                    <Input label="PPPoE/Access Password" value={form.password||''} onChange={v=>setForm({...form, password:v})} type="password" placeholder={editing ? 'Leave blank to keep' : ''} />
                    <Input label="Package Name" value={form.package_name||''} onChange={v=>setForm({...form, package_name:v})} />
                    <Input label="Bandwidth (Mbps)" value={form.bandwidth_mbps??''} onChange={v=>setForm({...form, bandwidth_mbps:v})} />
                    <Input label="Monthly Bill" value={form.monthly_bill??''} onChange={v=>setForm({...form, monthly_bill:v})} />
                    <Input label="IP Address" value={form.ip_address||''} onChange={v=>setForm({...form, ip_address:v})} />
                    <Input label="MAC Address" value={form.mac_address||''} onChange={v=>setForm({...form, mac_address:v})} />
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-primary"/>Map Pin Picker</div>
                        <button type="button" onClick={pickCurrentLocation} className="px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold inline-flex items-center gap-1.5"><LocateFixed className="w-3.5 h-3.5"/>Pick My Current Location</button>
                      </div>
                      <LocationPicker lat={form.latitude === '' ? null : Number(form.latitude)} lng={form.longitude === '' ? null : Number(form.longitude)} onChange={onPickLocation} />
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Latitude" value={form.latitude??''} onChange={v=>setForm({...form, latitude:v})} />
                        <Input label="Longitude" value={form.longitude??''} onChange={v=>setForm({...form, longitude:v})} />
                      </div>
                      <div className="text-xs text-muted-foreground">Click on the map or drag the pin to set location. Address fields auto-fill via reverse geocoding (editable).</div>
                      {geoMsg && <div className={`text-xs px-3 py-2 rounded-lg border ${geoLoading?'border-primary/30 bg-primary/10 text-primary':'border-border bg-muted/30 text-foreground/80'}`}>{geoMsg}</div>}
                    </div>

                    <div className="space-y-3">
                      <div className="font-semibold text-sm">Auto-filled Address Details</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input label="District" value={form.district||''} onChange={v=>setForm({...form,district:v})} />
                        <Input label="Thana" value={form.thana||''} onChange={v=>setForm({...form,thana:v})} />
                        <Input label="Upazila" value={form.upazila||''} onChange={v=>setForm({...form,upazila:v})} />
                        <Input label="Post Office" value={form.post_office||''} onChange={v=>setForm({...form,post_office:v})} />
                        <Input label="Village" value={form.village||''} onChange={v=>setForm({...form,village:v})} />
                        <Input label="Area/Neighborhood" value={form.area_name||''} onChange={v=>setForm({...form,area_name:v})} />
                        <Input label="Ward No" value={form.ward_no||''} onChange={v=>setForm({...form,ward_no:v})} />
                        <Input label="Road/Street No" value={form.road_no||''} onChange={v=>setForm({...form,road_no:v})} />
                        <Input label="House No" value={form.house_no||''} onChange={v=>setForm({...form,house_no:v})} />
                      </div>
                      <Input label="Full Address" value={form.address||''} onChange={v=>setForm({...form,address:v})} />
                      <div className="font-semibold text-sm pt-2">Network Topology Link</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Select label="Area (ISP)" value={form.area_id||''} onChange={v=>setForm({...form, area_id:v, zone_id:'', distribution_box_id:''})} options={[{v:'',l:'Select area'}, ...areas.map(a=>({v:a.id,l:a.name}))]} />
                        <Select label="Zone" value={form.zone_id||''} onChange={v=>setForm({...form, zone_id:v, distribution_box_id:''})} options={[{v:'',l:'Select zone'}, ...filteredZones.map(z=>({v:z.id,l:z.name}))]} />
                        <Select label="Distribution Box" value={form.distribution_box_id||''} onChange={v=>setForm({...form, distribution_box_id:v})} options={[{v:'',l:'Select box'}, ...filteredBoxes.map(b=>({v:b.id,l:`${b.name} (${b.code||b.box_type})`}))]} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ReviewCard title="Basic & Contact" items={[
                      ['Name', form.full_name], ['Type', form.subscriber_type], ['Status', form.status], ['Phone', form.phone||'-'], ['Email', form.email||'-'], ['NID', form.nid_number||'-']
                    ]} />
                    <ReviewCard title="Connection & Package" items={[
                      ['Provision Via', form.provisioning_mode === 'ROUTER' ? `Specific Router (API/REST)` : 'RADIUS (all RADIUS-enabled routers)'],
                      ['Router', form.provisioning_mode === 'ROUTER' ? (routers.find((r:any)=>r.id===form.router_id)?.name || '-') : `RADIUS pool (${radiusRouters.length} NAS)`],
                      ['Connection', form.connection_type], ['PPPoE Username', form.username||'-'], ['Package', form.package_name||'-'], ['Bandwidth', form.bandwidth_mbps ? `${form.bandwidth_mbps} Mbps` : '-'], ['Monthly Bill', form.monthly_bill || '-'], ['IP/MAC', `${form.ip_address||'-'} / ${form.mac_address||'-'}`]
                    ]} />
                    <ReviewCard title="Location & Address" items={[
                      ['Latitude, Longitude', (form.latitude && form.longitude) ? `${form.latitude}, ${form.longitude}` : '-'], ['District', form.district||'-'], ['Thana/Upazila', form.thana || form.upazila || '-'], ['Post Office', form.post_office||'-'], ['Village/Area', form.village || form.area_name || '-'], ['Ward/Road/House', [form.ward_no, form.road_no, form.house_no].filter(Boolean).join(', ') || '-'], ['Full Address', form.address||'-']
                    ]} />
                    <ReviewCard title="Topology & Notes" items={[
                      ['ISP Area', areas.find(a=>a.id===form.area_id)?.name || '-'], ['Zone', zones.find(z=>z.id===form.zone_id)?.name || '-'], ['Distribution Box', boxes.find(b=>b.id===form.distribution_box_id)?.name || '-'], ['Client Code', editing?.client_code || 'Auto-generated on save']
                    ]} />
                  </div>
                  <div className="text-xs text-muted-foreground p-3 rounded-xl border border-border bg-muted/20">Review all details. Client code will be generated automatically for new subscribers. You can edit later and upload KYC documents from the subscriber details panel.</div>
                </div>
              )}
            </div>

            <div className="px-4 sm:px-5 py-4 border-t border-border flex flex-col sm:flex-row justify-between gap-2">
              <button onClick={()=>setShowForm(false)} className="px-4 py-2 rounded-xl border border-border">Cancel</button>
              <div className="flex gap-2 justify-end">
                <button onClick={prevStep} disabled={step===1} className="px-4 py-2 rounded-xl border border-border disabled:opacity-50 inline-flex items-center gap-1"><ChevronLeft className="w-4 h-4"/>Back</button>
                {step < 4 ? (
                  <button onClick={nextStep} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center gap-1">Next<ChevronRight className="w-4 h-4"/></button>
                ) : (
                  <button onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">{editing ? 'Save Changes' : 'Create Subscriber'}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="font-medium text-foreground break-words">{value}</div></div>;
}
function ReviewCard({ title, items }: { title: string; items: [string, any][] }) {
  return <div className="p-4 rounded-xl border border-border bg-muted/20"><div className="font-semibold mb-2 text-sm">{title}</div><div className="space-y-1.5 text-xs">{items.map(([k,v]) => <div key={k} className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-foreground font-medium text-right break-words">{String(v ?? '-')}</span></div>)}</div></div>;
}
function Input({ label, value, onChange, type='text', placeholder='' }: { label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm text-foreground outline-none focus:border-primary/50" />
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: any; onChange: (v: string) => void; options: any[] }) {
  const opts = options.map((o: any) => typeof o === 'string' ? {v:o,l:o} : o);
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm text-foreground outline-none focus:border-primary/50">
        {opts.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
