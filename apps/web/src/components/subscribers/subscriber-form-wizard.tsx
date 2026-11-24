'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import {
  MapPin, LocateFixed, ChevronLeft, ChevronRight, CheckCircle2, X,
} from 'lucide-react';

// Same MapLibre map picker the admin panel uses. Loaded client-side only (WebGL needs window).
const LocationPicker = dynamic(() => import('@/app/subscribers/location-picker'), {
  ssr: false,
  loading: () => <div className="h-[320px] sm:h-[380px] rounded-xl border border-border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">Loading map picker...</div>,
});

const emptyForm = {
  full_name: '', subscriber_type: 'HOME', connection_type: 'PPPOE', username: '', password: '', phone: '', email: '', nid_number: '',
  package_name: '', bandwidth_mbps: '', monthly_bill: '', status: 'PENDING', area_id: '', zone_id: '', distribution_box_id: '',
  address: '', latitude: '', longitude: '', ip_address: '', mac_address: '', installation_date: '',
  district: '', thana: '', upazila: '', post_office: '', village: '', area_name: '', ward_no: '', road_no: '', house_no: '',
  provisioning_mode: 'RADIUS', router_id: '', reseller_id: '',
};

const steps = [
  { id: 1, title: 'Basic Info', desc: 'Identity & contact' },
  { id: 2, title: 'Connection & Package', desc: 'Service profile' },
  { id: 3, title: 'Location & Topology', desc: 'Map pin & address' },
  { id: 4, title: 'Review & Save', desc: 'Confirm details' },
];

/** Fields the reseller portal needs that the admin wizard doesn't expose.
 *  Shown as an extra final step only when showExtraFields is set. */
const EXTRA_DETAIL_FIELDS: [string, string][] = [
  ['Customer ID', 'external_customer_id'], ['Company', 'company_name'], ['Alt Email', 'alt_email'], ['Alt Phone', 'alt_phone'],
  ['NID Information', 'nid_info'], ['GPS Location', 'gps_location'], ['Division', 'division'], ['Block', 'block_no'],
  ['Cable Serial', 'cable_serial_no'], ['Cable Length', 'cable_length'], ['Cable Info', 'cable_info'],
  ['ONU Info', 'onu_info'], ['ONU Owner', 'onu_owner'], ['Established By', 'connection_established_by'],
  ['IPv6 Address', 'ipv6_address'], ['IPv6 Prefix', 'ipv6_prefix'],
  ['Old Expiry', 'old_expiry_date'], ['Excess Amount', 'excess_amount'],
  ['Expiry Date', 'expiry_date'], ['Price Override', 'price_override'],
  ['Custom Package Note', 'custom_package_note'], ['Branch', 'branch_name'],
];
const EXTRA_DETAIL_BOOLS: [string, string][] = [
  ['Extended expiry / custom validity', 'extended_expiry'],
  ['Static IP', 'static_ip'],
  ['MAC Lock', 'mac_lock'],
  ['Multiple Sessions', 'multi_session'],
  ['Enable Bill Cycle', 'bill_cycle_enabled'],
  ['Parental Control', 'parental_control_enabled'],
];

/** Only editable columns are sent back; the API record may contain computed,
 *  joined or sensitive fields that must never be echoed from the form. */
const WIZARD_FIELDS = [
  'full_name', 'subscriber_type', 'connection_type', 'status', 'username', 'password',
  'phone', 'email', 'nid_number', 'package_name', 'bandwidth_mbps', 'monthly_bill',
  'area_id', 'zone_id', 'distribution_box_id', 'address', 'latitude', 'longitude',
  'ip_address', 'mac_address', 'installation_date', 'district', 'thana', 'upazila',
  'post_office', 'village', 'area_name', 'ward_no', 'road_no', 'house_no', 'notes',
  'billing_cycle_day', 'expiry_date', 'due_date', 'next_bill_date',
  'auto_suspend_enabled', 'auto_pay_enabled', 'provisioning_mode', 'router_id',
  'reseller_id', 'price_override', 'custom_package_note', 'extended_expiry', 'branch_name',
  ...EXTRA_DETAIL_FIELDS.map(([, key]) => key),
  ...EXTRA_DETAIL_BOOLS.map(([, key]) => key),
];

interface SubscriberFormWizardProps {
  /** Existing subscriber to edit; omit/null to create a new one. */
  initial?: any | null;
  /** When set, the subscriber is forced to this reseller and the ownership selector is hidden. */
  lockedResellerId?: string | null;
  /** Display label for the locked reseller (shown in review). */
  lockedResellerName?: string | null;
  /** Called after a successful create/update — parent should refresh its list and close the modal. */
  onSaved: (result: any) => void;
  onCancel: () => void;
  token?: string | null;
  /** Adds a final "Additional Details" step for the reseller portal's parity fields. */
  showExtraFields?: boolean;
}

/** A faithful port of the admin panel's 4-step Add/Edit Subscriber wizard so the
 *  reseller portal renders the exact same form. */
export function SubscriberFormWizard({
  initial, lockedResellerId, lockedResellerName, onSaved, onCancel, token: tokenProp, showExtraFields = false,
}: SubscriberFormWizardProps) {
  const { token: ctxToken } = useAuth();
  const token = tokenProp ?? ctxToken;
  const activeSteps = showExtraFields
    ? [...steps, { id: 5, title: 'Additional Details', desc: 'SRZone parity fields' }]
    : steps;

  const [form, setForm] = useState<any>(() => ({
    ...emptyForm,
    ...(initial || {}),
    latitude: initial?.latitude ?? '',
    longitude: initial?.longitude ?? '',
    bandwidth_mbps: initial?.bandwidth_mbps ?? '',
    monthly_bill: initial?.monthly_bill ?? '',
    router_id: initial?.router_id ?? '',
    provisioning_mode: initial?.provisioning_mode ?? 'RADIUS',
    reseller_id: lockedResellerId || initial?.reseller_id || '',
    password: '', // never prefill / echo the existing hash
  }));
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [resellers, setResellers] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);

  // Reference data is best-effort: a reseller token may be denied admin-only catalogues.
  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiFetch<{ data: any[] }>('/api/topology/areas', {}, token).catch(() => ({ data: [] })),
      apiFetch<{ data: any[] }>('/api/topology/zones', {}, token).catch(() => ({ data: [] })),
      apiFetch<{ data: any[] }>('/api/topology/boxes', {}, token).catch(() => ({ data: [] })),
      apiFetch<{ data: any[] }>('/api/network/routers', {}, token).catch(() => ({ data: [] })),
      apiFetch<{ data: any[] }>('/api/resellers', {}, token).catch(() => ({ data: [] })),
      apiFetch<{ data: any[] }>('/api/subscribers/packages/catalog', {}, token).catch(() => ({ data: [] })),
    ]).then(([a, z, b, r, rs, pkgs]) => {
      setAreas(a.data || []); setZones(z.data || []); setBoxes(b.data || []);
      setRouters(r.data || []); setResellers(rs.data || []); setPackages(pkgs.data || []);
    });
  }, [token]);

  useEffect(() => { if (lockedResellerId) setForm((f: any) => ({ ...f, reseller_id: lockedResellerId })); }, [lockedResellerId]);

  const filteredZones = useMemo(() => form.area_id ? zones.filter(z => z.area_id === form.area_id) : zones, [zones, form.area_id]);
  const filteredBoxes = useMemo(() => form.zone_id ? boxes.filter(b => b.zone_id === form.zone_id) : boxes, [boxes, form.zone_id]);
  const directRouters = useMemo(() => routers.filter((r: any) => ['API', 'REST'].includes(String(r.integration_mode || 'API').toUpperCase()) && r.is_enabled !== false), [routers]);
  const radiusRouters = useMemo(() => routers.filter((r: any) => String(r.integration_mode || '').toUpperCase() === 'RADIUS' && r.is_enabled !== false), [routers]);

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
      const res = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Language': 'en' } });
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

  const validateStep = () => {
    if (step === 1 && !String(form.full_name || '').trim()) { setError('Full name is required'); return false; }
    if (step === 2 && form.provisioning_mode === 'ROUTER' && !form.router_id) { setError('Select a specific router (API/REST) or choose RADIUS mode.'); return false; }
    setError(null); return true;
  };

  const nextStep = () => { if (validateStep()) setStep(s => Math.min(activeSteps.length, s + 1)); };
  const prevStep = () => setStep(s => Math.max(1, s - 1));

  const save = async () => {
    if (!token) return;
    if (!String(form.full_name || '').trim()) { setError('Full name is required'); setStep(1); return; }
    setError(null); setSaving(true);
    try {
      const payload: any = {};
      for (const key of WIZARD_FIELDS) if (key in form) payload[key] = form[key];
      ['bandwidth_mbps', 'monthly_bill', 'latitude', 'longitude'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      ['area_id', 'zone_id', 'distribution_box_id', 'installation_date', 'router_id', 'reseller_id'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      EXTRA_DETAIL_FIELDS.forEach(([, key]) => { if (payload[key] === '') payload[key] = null; });
      if (payload.provisioning_mode === 'RADIUS') payload.router_id = null;
      if (lockedResellerId) payload.reseller_id = lockedResellerId;
      if (payload.password === '') delete payload.password;
      const result = initial?.id
        ? await apiFetch<any>(`/api/subscribers/${initial.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token)
        : await apiFetch<any>('/api/subscribers', { method: 'POST', body: JSON.stringify(payload) }, token);
      onSaved(result);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const ownershipLabel = lockedResellerId
    ? (lockedResellerName || 'My Reseller Account')
    : (form.reseller_id ? (resellers.find((r: any) => r.id === form.reseller_id)?.name || 'Reseller') : 'Own Subscriber (ISP)');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-3 sm:p-4 overflow-auto">
      <div className="w-full max-w-5xl card my-4 sm:my-6">
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-bold text-lg">{initial ? 'Edit Subscriber' : 'Add Subscriber'} — Wizard</h2>
            <p className="text-xs text-muted-foreground">Step {step} of {activeSteps.length}: {activeSteps[step - 1].title} — {activeSteps[step - 1].desc}</p>
          </div>
          <button onClick={onCancel} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 sm:px-5 pt-4">
          <div className={`grid grid-cols-2 gap-2 ${activeSteps.length === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
            {activeSteps.map(s => (
              <button key={s.id} onClick={() => { if (s.id < step || validateStep()) setStep(s.id); }} className={`text-left p-2.5 rounded-xl border text-xs ${step === s.id ? 'border-primary bg-primary/10' : 'border-border bg-muted/20'} ${s.id < step ? 'opacity-100' : ''}`}>
                <div className="flex items-center gap-2 font-semibold text-foreground"><span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] ${step >= s.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{step > s.id ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.id}</span>{s.title}</div>
                <div className="text-muted-foreground mt-0.5 hidden sm:block">{s.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {error && <div className="mx-4 sm:mx-5 mt-4 alert alert-danger">{error}</div>}

        <div className="p-4 sm:p-5">
          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label="Full Name *" value={form.full_name} onChange={v => setForm({ ...form, full_name: v })} />
              <Select label="Subscriber Type" value={form.subscriber_type} onChange={v => setForm({ ...form, subscriber_type: v })} options={['HOME', 'CORPORATE', 'HOTSPOT']} />
              <Select label="Status" value={form.status} onChange={v => setForm({ ...form, status: v })} options={['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED']} />
              {lockedResellerId ? (
                <div className="p-3 rounded-xl border border-primary/30 bg-primary/5">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Subscriber Ownership</div>
                  <div className="text-sm font-semibold text-foreground">{ownershipLabel}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Customers you create belong to your reseller account.</div>
                </div>
              ) : (
                <Select label="Subscriber Ownership" value={form.reseller_id || ''} onChange={v => setForm({ ...form, reseller_id: v })} options={[{ v: '', l: 'Own Subscriber (ISP)' }, ...resellers.map((r: any) => ({ v: r.id, l: `Reseller: ${r.name}${r.company_name ? ' (' + r.company_name + ')' : ''}` }))]} />
              )}
              <Input label="Phone" value={form.phone || ''} onChange={v => setForm({ ...form, phone: v })} />
              <Input label="Email" value={form.email || ''} onChange={v => setForm({ ...form, email: v })} />
              <Input label="NID Number" value={form.nid_number || ''} onChange={v => setForm({ ...form, nid_number: v })} />
              <Input label="Installation Date" value={form.installation_date ? String(form.installation_date).slice(0, 10) : ''} onChange={v => setForm({ ...form, installation_date: v })} type="date" />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                <div className="font-semibold text-sm">Network Provisioning (required)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Select label="Provision Via" value={form.provisioning_mode || 'RADIUS'} onChange={v => setForm({ ...form, provisioning_mode: v, router_id: v === 'RADIUS' ? '' : form.router_id })} options={[{ v: 'ROUTER', l: 'Specific Router (API/REST) — direct per-router' }, { v: 'RADIUS', l: 'RADIUS (all RADIUS-enabled routers / NAS pool)' }]} />
                  {form.provisioning_mode === 'ROUTER' ? (
                    <Select label="Select Router (API/REST)" value={form.router_id || ''} onChange={v => setForm({ ...form, router_id: v })} options={[{ v: '', l: 'Select router by name...' }, ...directRouters.map((r: any) => ({ v: r.id, l: `${r.name} (${String(r.integration_mode || 'API').toUpperCase()} • ${r.host})` }))]} />
                  ) : (
                    <div className="alert alert-primary text-[11px]">
                      Subscriber will authenticate via centralized RADIUS across <b>all enabled RADIUS NAS routers</b> ({radiusRouters.length} available). Ensure RADIUS users are synced in <b>RADIUS &amp; AAA</b>.
                    </div>
                  )}
                </div>
                {form.provisioning_mode === 'ROUTER' && !directRouters.length && <div className="alert alert-warning text-[11px]">No API/REST routers available. Add one in Network &amp; Routers or choose RADIUS mode.</div>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Select label="Connection Type" value={form.connection_type} onChange={v => setForm({ ...form, connection_type: v })} options={['PPPOE', 'STATIC_IP', 'DHCP', 'HOTSPOT']} />
                <Input label="PPPoE Username" value={form.username || ''} onChange={v => setForm({ ...form, username: v })} />
                <Input label="PPPoE/Access Password" value={form.password || ''} onChange={v => setForm({ ...form, password: v })} type="password" placeholder={initial ? 'Leave blank to keep' : ''} />
                <Select label="Package" value={form.package_name || ''} onChange={v => {
                  const pkg = packages.find((p: any) => p.name === v);
                  setForm((f: any) => ({
                    ...f,
                    package_name: v,
                    monthly_bill: pkg ? String(pkg.price ?? f.monthly_bill ?? '') : f.monthly_bill,
                    bandwidth_mbps: pkg ? String(pkg.download_mbps ?? f.bandwidth_mbps ?? '') : f.bandwidth_mbps,
                  }));
                }} options={[{ v: '', l: 'Select package...' }, ...packages.map((p: any) => ({ v: p.name, l: `${p.name} (${p.download_mbps}↓/${p.upload_mbps}↑ Mbps • ৳${p.price})` }))]} />
                <Input label="Bandwidth (Mbps)" value={form.bandwidth_mbps ?? ''} onChange={v => setForm({ ...form, bandwidth_mbps: v })} />
                <Input label="Monthly Bill" value={form.monthly_bill ?? ''} onChange={v => setForm({ ...form, monthly_bill: v })} />
                <Input label="IP Address" value={form.ip_address || ''} onChange={v => setForm({ ...form, ip_address: v })} />
                <Input label="MAC Address" value={form.mac_address || ''} onChange={v => setForm({ ...form, mac_address: v })} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />Map Pin Picker</div>
                    <button type="button" onClick={pickCurrentLocation} className="px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold inline-flex items-center gap-1.5"><LocateFixed className="w-3.5 h-3.5" />Pick My Current Location</button>
                  </div>
                  <LocationPicker lat={form.latitude === '' ? null : Number(form.latitude)} lng={form.longitude === '' ? null : Number(form.longitude)} onChange={onPickLocation} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Latitude" value={form.latitude ?? ''} onChange={v => setForm({ ...form, latitude: v })} />
                    <Input label="Longitude" value={form.longitude ?? ''} onChange={v => setForm({ ...form, longitude: v })} />
                  </div>
                  <div className="text-xs text-muted-foreground">Click on the map or drag the pin to set location. Address fields auto-fill via reverse geocoding (editable).</div>
                  {geoMsg && <div className={`text-xs px-3 py-2 rounded-lg border ${geoLoading ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted/30 text-foreground/80'}`}>{geoMsg}</div>}
                </div>

                <div className="space-y-3">
                  <div className="font-semibold text-sm">Auto-filled Address Details</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input label="District" value={form.district || ''} onChange={v => setForm({ ...form, district: v })} />
                    <Input label="Thana" value={form.thana || ''} onChange={v => setForm({ ...form, thana: v })} />
                    <Input label="Upazila" value={form.upazila || ''} onChange={v => setForm({ ...form, upazila: v })} />
                    <Input label="Post Office" value={form.post_office || ''} onChange={v => setForm({ ...form, post_office: v })} />
                    <Input label="Village" value={form.village || ''} onChange={v => setForm({ ...form, village: v })} />
                    <Input label="Area/Neighborhood" value={form.area_name || ''} onChange={v => setForm({ ...form, area_name: v })} />
                    <Input label="Ward No" value={form.ward_no || ''} onChange={v => setForm({ ...form, ward_no: v })} />
                    <Input label="Road/Street No" value={form.road_no || ''} onChange={v => setForm({ ...form, road_no: v })} />
                    <Input label="House No" value={form.house_no || ''} onChange={v => setForm({ ...form, house_no: v })} />
                  </div>
                  <Input label="Full Address" value={form.address || ''} onChange={v => setForm({ ...form, address: v })} />
                  <div className="font-semibold text-sm pt-2">Network Topology Link</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Select label="Area (ISP)" value={form.area_id || ''} onChange={v => setForm({ ...form, area_id: v, zone_id: '', distribution_box_id: '' })} options={[{ v: '', l: 'Select area' }, ...areas.map(a => ({ v: a.id, l: a.name }))]} />
                    <Select label="Zone" value={form.zone_id || ''} onChange={v => setForm({ ...form, zone_id: v, distribution_box_id: '' })} options={[{ v: '', l: 'Select zone' }, ...filteredZones.map(z => ({ v: z.id, l: z.name }))]} />
                    <Select label="Distribution Box" value={form.distribution_box_id || ''} onChange={v => setForm({ ...form, distribution_box_id: v })} options={[{ v: '', l: 'Select box' }, ...filteredBoxes.map(b => ({ v: b.id, l: `${b.name} (${b.code || b.box_type})` }))]} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ReviewCard title="Basic & Contact" items={[
                  ['Name', form.full_name], ['Type', form.subscriber_type], ['Status', form.status], ['Ownership', ownershipLabel], ['Phone', form.phone || '-'], ['Email', form.email || '-'], ['NID', form.nid_number || '-']
                ]} />
                <ReviewCard title="Connection & Package" items={[
                  ['Provision Via', form.provisioning_mode === 'ROUTER' ? 'Specific Router (API/REST)' : 'RADIUS (all RADIUS-enabled routers)'],
                  ['Router', form.provisioning_mode === 'ROUTER' ? (routers.find((r: any) => r.id === form.router_id)?.name || '-') : `RADIUS pool (${radiusRouters.length} NAS)`],
                  ['Connection', form.connection_type], ['PPPoE Username', form.username || '-'], ['Package', form.package_name || '-'], ['Bandwidth', form.bandwidth_mbps ? `${form.bandwidth_mbps} Mbps` : '-'], ['Monthly Bill', form.monthly_bill || '-'], ['IP/MAC', `${form.ip_address || '-'} / ${form.mac_address || '-'}`]
                ]} />
                <ReviewCard title="Location & Address" items={[
                  ['Latitude, Longitude', (form.latitude && form.longitude) ? `${form.latitude}, ${form.longitude}` : '-'], ['District', form.district || '-'], ['Thana/Upazila', form.thana || form.upazila || '-'], ['Post Office', form.post_office || '-'], ['Village/Area', form.village || form.area_name || '-'], ['Ward/Road/House', [form.ward_no, form.road_no, form.house_no].filter(Boolean).join(', ') || '-'], ['Full Address', form.address || '-']
                ]} />
                <ReviewCard title="Topology & Notes" items={[
                  ['ISP Area', areas.find(a => a.id === form.area_id)?.name || '-'], ['Zone', zones.find(z => z.id === form.zone_id)?.name || '-'], ['Distribution Box', boxes.find(b => b.id === form.distribution_box_id)?.name || '-'], ['Client Code', initial?.client_code || 'Auto-generated on save']
                ]} />
              </div>
              <div className="text-xs text-muted-foreground p-3 rounded-xl border border-border bg-muted/20">Review all details. Client code will be generated automatically for new subscribers. You can edit later and upload KYC documents from the subscriber details panel.</div>
            </div>
          )}

          {showExtraFields && step === 5 && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground p-3 rounded-xl border border-border bg-muted/20">
                These are the partner-portal fields from the subscriber record. Values already captured in the previous steps (name, address, IPv4/MAC, package) are edited there.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {EXTRA_DETAIL_FIELDS.map(([label, key]) => (
                  <Input key={key} label={label} value={form[key] ?? ''}
                    type={key === 'old_expiry_date' || key === 'expiry_date' ? 'date' : key === 'excess_amount' || key === 'price_override' ? 'number' : 'text'}
                    onChange={v => setForm((f: any) => ({ ...f, [key]: v }))} />
                ))}
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <div className="font-semibold text-sm mb-3">Provisioning &amp; validity flags</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {EXTRA_DETAIL_BOOLS.map(([label, key]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!form[key]} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.checked }))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-5 py-4 border-t border-border flex flex-col sm:flex-row justify-between gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-border">Cancel</button>
          <div className="flex gap-2 justify-end">
            <button onClick={prevStep} disabled={step === 1} className="px-4 py-2 rounded-xl border border-border disabled:opacity-50 inline-flex items-center gap-1"><ChevronLeft className="w-4 h-4" />Back</button>
            {step < activeSteps.length ? (
              <button onClick={nextStep} className="btn btn-primary inline-flex items-center gap-1">Next<ChevronRight className="w-4 h-4" /></button>
            ) : (
              <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-50">{saving ? 'Saving…' : (initial ? 'Save Changes' : 'Create Subscriber')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ title, items }: { title: string; items: [string, any][] }) {
  return <div className="p-4 rounded-xl border border-border bg-muted/20"><div className="font-semibold mb-2 text-sm">{title}</div><div className="space-y-1.5 text-xs">{items.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-foreground font-medium text-right break-words">{String(v ?? '-')}</span></div>)}</div></div>;
}
function Input({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="form-control w-full text-foreground outline-none focus:border-primary/50" />
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: any; onChange: (v: string) => void; options: any[] }) {
  const opts = options.map((o: any) => typeof o === 'string' ? { v: o, l: o } : o);
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} className="form-control w-full text-foreground outline-none focus:border-primary/50">
        {opts.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
