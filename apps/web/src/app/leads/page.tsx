'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { Search, Plus, Pencil, Trash2, X, Phone, Mail, MessageSquare, MapPin, User, ChevronLeft, ChevronRight, CheckCircle2, ArrowRight, Filter, Filter as FunnelIcon } from 'lucide-react';

// Same MapLibre picker the subscriber wizard uses (free hybrid basemap, no key).
const LocationPicker = dynamic(() => import('@/app/subscribers/location-picker'), {
  ssr: false,
  loading: () => <div className="h-[320px] sm:h-[380px] rounded-xl border border-border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">Loading map…</div>,
});

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];
const LEAD_SOURCES = ['WALK_IN', 'CALL', 'WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'CAMPAIGN', 'OTHER'];
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'WHATSAPP', 'SITE_VISIT', 'NOTE'];

const emptyForm = {
  full_name: '', phone: '', email: '', address: '', latitude: '', longitude: '',
  area_id: '', zone_id: '', interested_package: '', source: 'OTHER', status: 'NEW',
  priority: 'MEDIUM', assigned_to: '', notes: ''
};

const steps = [
  { id: 1, title: 'Basic Info', desc: 'Identity & contact' },
  { id: 2, title: 'Location & Interest', desc: 'Map pin & package interest' },
  { id: 3, title: 'Review & Save', desc: 'Confirm details' },
];

export default function LeadsPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<any>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [assigned, setAssigned] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [detail, setDetail] = useState<any | null>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    if (!token) return;
    const [a, z, pkgs] = await Promise.all([
      apiFetch<{data:any[]}>('/api/topology/areas', {}, token),
      apiFetch<{data:any[]}>('/api/topology/zones', {}, token),
      apiFetch<{data:any[]}>('/api/subscribers/packages/catalog', {}, token).catch(()=>({data:[]})),
    ]);
    setAreas(a.data || []); setZones(z.data || []); setPackages(pkgs.data || []);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (source) params.set('source', source);
      if (assigned) params.set('assigned_to', assigned);
      params.set('limit', '100');
      const [res, sum] = await Promise.all([
        apiFetch<{data:any[], total:number}>(`/api/leads?${params.toString()}`, {}, token),
        apiFetch<{summary:any}>(`/api/leads/summary`, {}, token),
      ]);
      setRows(res.data || []); setTotal(res.total || 0); setSummary(sum?.summary || null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [token, q, status, source, assigned]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const filteredZones = useMemo(() => form.area_id ? zones.filter(z => z.area_id === form.area_id) : zones, [zones, form.area_id]);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm }); setStep(1); setGeoMsg(null); setShowForm(true); };
  useEffect(() => {
    const wantsNew = searchParams?.get('new') === '1' || searchParams?.get('action') === 'new' || searchParams?.get('add') === '1';
    if (wantsNew) openCreate();
  }, [searchParams]);

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ ...emptyForm, ...row, latitude: row.latitude ?? '', longitude: row.longitude ?? '' });
    setStep(1); setGeoMsg(null); setShowForm(true);
  };

  const openDetail = async (id: string) => {
    if (!token) return;
    const d = await apiFetch<any>(`/api/leads/${id}`, {}, token);
    setDetail(d);
  };

  const validateStep = () => {
    if (step === 1 && !String(form.full_name || '').trim()) { setError('Full name is required'); return false; }
    setError(null); return true;
  };

  const nextStep = () => { if (validateStep()) setStep(s => Math.min(3, s + 1)); };
  const prevStep = () => setStep(s => Math.max(1, s - 1));

  const save = async () => {
    if (!token) return;
    if (!String(form.full_name || '').trim()) { setError('Full name is required'); setStep(1); return; }
    setError(null);
    try {
      const payload = { ...form };
      ['latitude','longitude'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      ['area_id','zone_id'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      if (editing) await apiFetch(`/api/leads/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      else await apiFetch('/api/leads', { method: 'POST', body: JSON.stringify(payload) }, token);
      setShowForm(false); await load();
    } catch (e: any) { setError(e.message); }
  };

  const convertLead = async (id: string) => {
    if (!token || !confirm('Convert this lead to a subscriber?')) return;
    try {
      await apiFetch(`/api/leads/${id}/convert`, { method: 'POST', body: JSON.stringify({}) }, token);
      await load();
      if (detail?.id === id) setDetail(null);
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!token || !confirm('Delete this lead?')) return;
    await apiFetch(`/api/leads/${id}`, { method: 'DELETE' }, token);
    if (detail?.id === id) setDetail(null);
    await load();
  };

  const applyReverseGeocode = (addr: any, display?: string) => {
    const pick = (...keys: string[]) => {
      for (const k of keys) { const v = addr?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); }
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
      ...f, district: district || f.district || '', thana: thana || f.thana || '',
      upazila: upazila || f.upazila || '', post_office: postOffice || f.post_office || '',
      village: village || f.village || '', area_name: areaName || f.area_name || '',
      ward_no: ward || f.ward_no || '', road_no: road || f.road_no || '',
      house_no: house || f.house_no || '', address: fullAddress || f.address || '',
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
      setGeoMsg('Address fields auto-filled from pinned location. Review and edit if needed.');
    } catch {
      setGeoMsg('Could not auto-fill address. You can fill fields manually.');
    } finally { setGeoLoading(false); }
  };

  const pickCurrentLocation = () => {
    if (!navigator.geolocation) { setGeoMsg('Geolocation is not supported by this browser.'); return; }
    setGeoLoading(true); setGeoMsg('Detecting current location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setForm((f: any) => ({ ...f, latitude: pos.coords.latitude, longitude: pos.coords.longitude })); reverseGeocode(pos.coords.latitude, pos.coords.longitude); },
      () => { setGeoLoading(false); setGeoMsg('Unable to access current location. Please allow permission or pin on map.'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const onPickLocation = (lat: number, lng: number) => {
    setForm((f: any) => ({ ...f, latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) }));
    reverseGeocode(lat, lng);
  };

  const statusBadge = (s: string) => {
    const v = String(s || '').toUpperCase();
    if (v === 'WON') return 'badge-success';
    if (v === 'LOST') return 'badge-danger';
    if (v === 'PROPOSAL') return 'badge-purple';
    if (v === 'QUALIFIED') return 'badge-primary';
    if (v === 'CONTACTED') return 'badge-warning';
    return 'badge-secondary';
  };

  const priorityBadge = (p: string) => {
    const v = String(p || '').toUpperCase();
    if (v === 'HIGH') return 'badge-danger';
    if (v === 'LOW') return 'badge-secondary';
    return 'badge-warning';
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Client operations · Lead pipeline</span>
          <h1 className="page-title">Leads Pipeline</h1>
          <p className="page-subtitle">Track prospects from inquiry to subscriber — {total} total</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline">Refresh</button>
          <button onClick={openCreate} className="btn btn-primary"><Plus className="w-4 h-4"/>Add Lead</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {summary && (
        <div className="stat-grid">
          <div className="dash-stat dash-stat-primary"><span className="dash-stat-icon"><User /></span><span className="dash-stat-body"><span className="dash-stat-label">Total Leads</span><span className="dash-stat-value">{summary.total}</span><span className="dash-stat-hint">all records</span></span></div>
          <div className="dash-stat dash-stat-success"><span className="dash-stat-icon"><CheckCircle2 /></span><span className="dash-stat-body"><span className="dash-stat-label">Won</span><span className="dash-stat-value">{summary.won}</span><span className="dash-stat-hint">converted</span></span></div>
          <div className="dash-stat dash-stat-danger"><span className="dash-stat-icon"><X /></span><span className="dash-stat-body"><span className="dash-stat-label">Lost</span><span className="dash-stat-value">{summary.lost}</span><span className="dash-stat-hint">closed out</span></span></div>
          <div className="dash-stat dash-stat-info"><span className="dash-stat-icon"><ArrowRight /></span><span className="dash-stat-body"><span className="dash-stat-label">This Month</span><span className="dash-stat-value">{summary.this_month}</span><span className="dash-stat-hint">new leads</span></span></div>
          <div className="dash-stat dash-stat-purple"><span className="dash-stat-icon"><Filter /></span><span className="dash-stat-body"><span className="dash-stat-label">Conversion</span><span className="dash-stat-value">{summary.conversion_rate}%</span><span className="dash-stat-hint">won / total</span></span></div>
          <div className="dash-stat dash-stat-teal"><span className="dash-stat-icon"><FunnelIcon /></span><span className="dash-stat-body"><span className="dash-stat-label">Pipeline Value</span><span className="dash-stat-value">—</span><span className="dash-stat-hint">open opportunities</span></span></div>
        </div>
      )}

      <div className="toolbar-strip">
        <div className="relative input-icon flex-1 min-w-[220px]">
          <Search className="w-4 h-4"/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name, phone, email, lead no..." className="form-control"/>
        </div>
        <span className="toolbar-divider"/>
        <select value={status} onChange={e=>setStatus(e.target.value)} className="form-select w-auto">
          <option value="">All Statuses</option>
          {LEAD_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={source} onChange={e=>setSource(e.target.value)} className="form-select w-auto">
          <option value="">All Sources</option>
          {LEAD_SOURCES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 card overflow-hidden">
          <div className="table-wrap overflow-auto">
            <table className="table table-hover min-w-[720px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2.5">Lead</th>
                  <th className="text-left px-3 py-2.5">Contact</th>
                  <th className="text-left px-3 py-2.5">Interest</th>
                  <th className="text-left px-3 py-2.5">Source</th>
                  <th className="text-left px-3 py-2.5">Status / Priority</th>
                  <th className="text-right px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-[11px]">Loading leads...</td></tr> :
                 rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No leads found. Use “Add Lead” to create one.</td></tr> :
                 rows.map(r => (
                  <tr key={r.id} className="border-t border-border/70 hover:bg-muted/30 cursor-pointer" onClick={()=>openDetail(r.id)}>
                    <td className="px-3 py-2.5 text-[11px]">
                      <div className="font-semibold text-foreground">{r.full_name}</div>
                      <div className="text-xs text-primary font-mono">{r.lead_no}</div>
                    </td>
                    <td className="px-3 py-2.5 text-[11px]">
                      <div className="text-xs">{r.phone || '-'}</div>
                      <div className="text-xs text-muted-foreground">{r.email || '-'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-[11px]">
                      <div className="text-xs">{r.interested_package || '-'}</div>
                      <div className="text-xs text-muted-foreground">{[r.area_name, r.village, r.thana || r.upazila].filter(Boolean).join(', ') || '-'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-[11px]">
                      <span className="badge badge-secondary">{r.source || 'OTHER'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px]">
                      <div className="flex flex-col gap-1">
                        <span className={`badge ${statusBadge(r.status)}`}>{r.status}</span>
                        <span className={`badge ${priorityBadge(r.priority)}`}>{r.priority}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right" onClick={e=>e.stopPropagation()}>
                      {r.status !== 'WON' && r.status !== 'LOST' && (
                        <button onClick={()=>convertLead(r.id)} className="btn btn-ghost btn-icon btn-sm text-success" title="Convert to Subscriber"><ArrowRight className="w-4 h-4"/></button>
                      )}
                      <button onClick={()=>openEdit(r)} className="btn btn-ghost btn-icon btn-sm"><Pencil className="w-4 h-4"/></button>
                      <button onClick={()=>remove(r.id)} className="btn btn-ghost btn-icon btn-sm text-danger"><Trash2 className="w-4 h-4"/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4 space-y-4">
          {!detail ? (
            <div className="empty-panel">
              <span className="empty-panel-icon"><User className="w-5 h-5" /></span>
              <div>
                <div className="text-sm font-semibold text-foreground">No lead selected</div>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-[270px] leading-relaxed">Open a lead to review contact details, log activities and convert it to a subscriber.</p>
              </div>
              <button onClick={openCreate} className="btn btn-primary btn-sm"><Plus className="w-3.5 h-3.5"/>Add lead</button>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-foreground flex items-center gap-2"><User className="w-4 h-4 text-primary"/><span className="truncate">{detail.full_name}</span></div>
                  <div className="text-xs font-mono text-primary mt-0.5">{detail.lead_no}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className={`badge ${statusBadge(detail.status)}`}>{detail.status}</span>
                    <span className={`badge ${priorityBadge(detail.priority)}`}>{detail.priority}</span>
                    <span className="badge badge-secondary">{detail.source || 'OTHER'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {detail.status !== 'WON' && detail.status !== 'LOST' && (
                    <button onClick={()=>convertLead(detail.id)} className="btn btn-success btn-sm"><ArrowRight className="w-3.5 h-3.5"/>Convert</button>
                  )}
                  <button onClick={()=>openEdit(detail)} className="btn btn-ghost btn-icon btn-sm" title="Edit"><Pencil className="w-4 h-4"/></button>
                  <button onClick={()=>setDetail(null)} className="btn btn-ghost btn-icon btn-sm" title="Close"><X className="w-4 h-4"/></button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Phone" value={detail.phone || '-'} /><Info label="Email" value={detail.email || '-'} />
                <Info label="Source" value={detail.source} /><Info label="Assigned To" value={detail.assigned_to || '-'} />
                <Info label="Interested Package" value={detail.interested_package || '-'} />
                <Info label="Area/Zone" value={[detail.area_name, detail.zone_name].filter(Boolean).join(' / ') || '-'} />
                <div className="col-span-2"><Info label="Address" value={detail.address || '-'} /></div>
                <div className="col-span-2"><Info label="Notes" value={detail.notes || '-'} /></div>
              </div>

              <div className="pt-2 border-t border-border">
                <div className="font-semibold text-sm mb-2 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary"/>Activities</div>
                <div className="space-y-2 max-h-[200px] overflow-auto">
                  {(detail.activities || []).length === 0 ? <div className="text-xs text-muted-foreground">No activities logged.</div> :
                    detail.activities.map((a: any) => (
                      <div key={a.id} className="text-[11px] p-2 rounded-lg border border-border bg-muted/20 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="font-semibold text-primary">{a.activity_type}</span><span className="text-muted-foreground">{a.subject || ''}</span></div>
                          {a.description && <div className="text-muted-foreground truncate">{a.description}</div>}
                        </div>
                        <div className="text-muted-foreground whitespace-nowrap">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
                      </div>
                    ))
                  }
                </div>
                <div className="card card-body-sm mt-3 space-y-2">
                  <div className="text-xs font-semibold flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5"/>Log Activity</div>
                  <div className="grid grid-cols-2 gap-2">
                    <select defaultValue="CALL" className="form-select">{ACTIVITY_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select>
                    <input type="text" placeholder="Subject" className="form-control" />
                  </div>
                  <textarea placeholder="Description" rows={2} className="form-control" />
                  <button className="btn btn-primary btn-sm">Add Activity</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-3 sm:p-4 overflow-auto">
          <div className="card w-full max-w-3xl my-4 sm:my-6">
            <div className="card-header px-4 sm:px-5">
              <div>
                <h2 className="font-bold text-lg">{editing ? 'Edit Lead' : 'Add Lead'} — Wizard</h2>
                <p className="text-xs text-muted-foreground">Step {step} of 3: {steps[step-1].title} — {steps[step-1].desc}</p>
              </div>
              <button onClick={()=>setShowForm(false)} className="btn btn-ghost btn-icon"><X className="w-4 h-4"/></button>
            </div>

            <div className="px-4 sm:px-5 pt-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                  <Select label="Source" value={form.source} onChange={v=>setForm({...form, source:v})} options={LEAD_SOURCES} />
                  <Select label="Status" value={form.status} onChange={v=>setForm({...form, status:v})} options={LEAD_STATUSES} />
                  <Select label="Priority" value={form.priority} onChange={v=>setForm({...form, priority:v})} options={['LOW','MEDIUM','HIGH']} />
                  <Input label="Phone" value={form.phone||''} onChange={v=>setForm({...form, phone:v})} />
                  <Input label="Email" value={form.email||''} onChange={v=>setForm({...form, email:v})} />
                  <Input label="Assigned To" value={form.assigned_to||''} onChange={v=>setForm({...form, assigned_to:v})} />
                  <Input label="Notes" value={form.notes||''} onChange={v=>setForm({...form, notes:v})} />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-primary"/>Map Pin Picker</div>
                        <button type="button" onClick={pickCurrentLocation} className="btn btn-outline btn-sm">Pick My Current Location</button>
                      </div>
                      <LocationPicker lat={form.latitude === '' ? null : Number(form.latitude)} lng={form.longitude === '' ? null : Number(form.longitude)} onChange={onPickLocation} />
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Latitude" value={form.latitude??''} onChange={v=>setForm({...form, latitude:v})} />
                        <Input label="Longitude" value={form.longitude??''} onChange={v=>setForm({...form, longitude:v})} />
                      </div>
                      {geoMsg && <div className="alert alert-primary">{geoMsg}</div>}
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
                      <div className="font-semibold text-sm pt-2">Package Interest</div>
                      <Select label="Interested Package" value={form.interested_package||''} onChange={v=>setForm({...form, interested_package:v})} options={[{v:'',l:'Select package...'}, ...packages.map((p:any)=>({v:p.name,l:`${p.name} (${p.download_mbps}↓/${p.upload_mbps}↑ Mbps • ৳${p.price})`}))]} />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Select label="Area (ISP)" value={form.area_id||''} onChange={v=>setForm({...form, area_id:v, zone_id:''})} options={[{v:'',l:'Select area'}, ...areas.map(a=>({v:a.id,l:a.name}))]} />
                        <Select label="Zone" value={form.zone_id||''} onChange={v=>setForm({...form, zone_id:v})} options={[{v:'',l:'Select zone'}, ...filteredZones.map(z=>({v:z.id,l:z.name}))]} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ReviewCard title="Basic & Contact" items={[
                      ['Name', form.full_name], ['Phone', form.phone||'-'], ['Email', form.email||'-'],
                      ['Source', form.source], ['Status', form.status], ['Priority', form.priority],
                      ['Assigned To', form.assigned_to||'-'], ['Notes', form.notes||'-']
                    ]} />
                    <ReviewCard title="Location & Interest" items={[
                      ['Latitude, Longitude', (form.latitude && form.longitude) ? `${form.latitude}, ${form.longitude}` : '-'],
                      ['District', form.district||'-'], ['Thana/Upazila', form.thana || form.upazila || '-'],
                      ['Post Office', form.post_office||'-'], ['Village/Area', form.village || form.area_name || '-'],
                      ['Ward/Road/House', [form.ward_no, form.road_no, form.house_no].filter(Boolean).join(', ') || '-'],
                      ['Full Address', form.address||'-'], ['Interested Package', form.interested_package||'-'],
                      ['ISP Area', areas.find(a=>a.id===form.area_id)?.name || '-'], ['Zone', zones.find(z=>z.id===form.zone_id)?.name || '-']
                    ]} />
                  </div>
                  <div className="alert alert-primary">Review all details. Lead number will be generated automatically. You can convert to subscriber later from the detail panel.</div>
                </div>
              )}
            </div>

            <div className="px-4 sm:px-5 py-4 border-t border-border flex flex-col sm:flex-row justify-between gap-2">
              <button onClick={()=>setShowForm(false)} className="btn btn-outline">Cancel</button>
              <div className="flex gap-2 justify-end">
                <button onClick={prevStep} disabled={step===1} className="btn btn-outline"><ChevronLeft className="w-4 h-4"/>Back</button>
                {step < 3 ? (
                  <button onClick={nextStep} className="btn btn-primary">Next<ChevronRight className="w-4 h-4"/></button>
                ) : (
                  <button onClick={save} className="btn btn-primary">{editing ? 'Save Changes' : 'Create Lead'}</button>
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
  return <div className="card card-body-sm"><div className="card-title mb-2">{title}</div><div className="space-y-1.5 text-xs">{items.map(([k,v]) => <div key={k} className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-foreground font-medium text-right break-words">{String(v ?? '-')}</span></div>)}</div></div>;
}
function Input({ label, value, onChange, type='text', placeholder='' }: { label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} className="form-control" />
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: any; onChange: (v: string) => void; options: any[] }) {
  const opts = options.map((o: any) => typeof o === 'string' ? {v:o,l:o} : o);
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)} className="form-select">
        {opts.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

