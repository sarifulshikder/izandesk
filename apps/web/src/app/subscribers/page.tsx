'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { Search, Plus, Pencil, Trash2, X, Upload, FileText, User, RefreshCw, MapPin, LocateFixed, ChevronLeft, ChevronRight, CheckCircle2, Download, Upload as UploadIcon, Eye, History, FileSpreadsheet, AlertCircle, CheckCircle, MinusCircle, Package, MessageSquare, Phone, Mail, Activity } from 'lucide-react';

const LocationPicker = dynamic(() => import('./location-picker'), { ssr: false, loading: () => <div className="h-[320px] sm:h-[380px] rounded-xl border border-border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">Loading map picker...</div> });

const emptyForm = {
  full_name: '', subscriber_type: 'HOME', connection_type: 'PPPOE', username: '', password: '', phone: '', email: '', nid_number: '',
  package_name: '', bandwidth_mbps: '', monthly_bill: '', status: 'PENDING', area_id: '', zone_id: '', distribution_box_id: '',
  address: '', latitude: '', longitude: '', ip_address: '', mac_address: '', installation_date: '',
  district: '', thana: '', upazila: '', post_office: '', village: '', area_name: '', ward_no: '', road_no: '', house_no: '',
  provisioning_mode: 'RADIUS', router_id: '', reseller_id: ''
};

const steps = [
  { id: 1, title: 'Basic Info', desc: 'Identity & contact' },
  { id: 2, title: 'Connection & Package', desc: 'Service profile' },
  { id: 3, title: 'Location & Topology', desc: 'Map pin & address' },
  { id: 4, title: 'Review & Save', desc: 'Confirm details' },
];

export default function SubscribersPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [clientView, setClientView] = useState<'compact' | 'detailed'>('compact');

  useEffect(() => {
    const s = searchParams?.get('status') || '';
    if (s) setStatus(s);
    const v = String(searchParams?.get('view') || '').toLowerCase();
    if (v === 'all-info' || v === 'detailed' || v === 'all') setClientView('detailed');
  }, [searchParams]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [detail, setDetail] = useState<any | null>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [resellers, setResellers] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kycUploading, setKycUploading] = useState(false);
  const [step, setStep] = useState(1);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [fupBusy, setFupBusy] = useState(false);
  const [fupLogs, setFupLogs] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  // MikroTik import (subscribers/users)
  const [importMode, setImportMode] = useState<'file' | 'mikrotik'>('file');
  const [mtImportRouterId, setMtImportRouterId] = useState<string>('');
  const [mtImportType, setMtImportType] = useState<'ppp-secrets' | 'hotspot-users'>('ppp-secrets');
  const [mtImportItems, setMtImportItems] = useState<any[]>([]);
  const [mtImportSelected, setMtImportSelected] = useState<Record<string, boolean>>({});
  const [mtImportMsg, setMtImportMsg] = useState<string | null>(null);
  const [batchAction, setBatchAction] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailTab, setDetailTab] = useState<'profile' | 'equipment' | 'communications' | 'history'>('profile');
  const [equipment, setEquipment] = useState<any[]>([]);
  const [communications, setCommunications] = useState<any[]>([]);
  const [equipLoading, setEquipLoading] = useState(false);
  const [commLoading, setCommLoading] = useState(false);
  const [showEquipModal, setShowEquipModal] = useState(false);
  const [editEquip, setEditEquip] = useState<any | null>(null);
  const [equipForm, setEquipForm] = useState<any>({
    equipment_type: 'CPE', serial_number: '', mac_address: '', inventory_serial_id: '', onu_id: '',
    status: 'ASSIGNED', location_details: '', firmware_version: '', config_backup: '', notes: ''
  });

  const loadRefs = useCallback(async () => {
    if (!token) return;
    const [a, z, b, r, rs, pkgs] = await Promise.all([
      apiFetch<{data:any[]}>('/api/topology/areas', {}, token),
      apiFetch<{data:any[]}>('/api/topology/zones', {}, token),
      apiFetch<{data:any[]}>('/api/topology/boxes', {}, token),
      apiFetch<{data:any[]}>('/api/network/routers', {}, token),
      apiFetch<{data:any[]}>('/api/resellers', {}, token).catch(()=>({data:[]})),
      apiFetch<{data:any[]}>('/api/subscribers/packages/catalog', {}, token).catch(()=>({data:[]})),
    ]);
    setAreas(a.data || []); setZones(z.data || []); setBoxes(b.data || []); setRouters(r.data || []); setResellers(rs.data || []); setPackages(pkgs.data || []);
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

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, reseller_id: '' }); setStep(1); setGeoMsg(null); setShowForm(true); };
  useEffect(() => {
    const wantsNew = searchParams?.get('new') === '1' || searchParams?.get('action') === 'new' || searchParams?.get('add') === '1';
    if (wantsNew) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ ...emptyForm, ...row, latitude: row.latitude ?? '', longitude: row.longitude ?? '', bandwidth_mbps: row.bandwidth_mbps ?? '', monthly_bill: row.monthly_bill ?? '', router_id: row.router_id ?? '', provisioning_mode: row.provisioning_mode ?? 'RADIUS', reseller_id: row.reseller_id ?? '', password: '' });
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
      ['area_id','zone_id','distribution_box_id','installation_date','router_id','reseller_id'].forEach(k => { if (payload[k] === '') payload[k] = null; });
      if (payload.provisioning_mode === 'RADIUS') payload.router_id = null;
      // Don't send empty password - backend will keep existing hash
      if (payload.password === '') delete payload.password;
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
    try {
      const [fl, hist, eq, comm] = await Promise.all([
        apiFetch<any>(`/api/billing/fup/logs?subscriber_id=${id}`, {}, token),
        apiFetch<any>(`/api/subscribers/${id}/history`, {}, token),
        apiFetch<any>(`/api/subscriber-equipment/subscriber/${id}`, {}, token),
        apiFetch<any>(`/api/subscriber-communications/subscriber/${id}?limit=50`, {}, token),
      ]);
      setFupLogs(fl?.data || []);
      setHistory(hist?.data?.status_changes || []);
      setEquipment(eq?.data || []);
      setCommunications(comm?.data || []);
    } catch { setFupLogs([]); setHistory([]); setEquipment([]); setCommunications([]); }
  };

  const downloadCaf = async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/subscribers/${id}/caf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to generate CAF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CAF-${detail?.client_code || id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); }
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

  const handleImportPreview = async (file: File) => {
    if (!token) return;
    setImportLoading(true); setImportPreview(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${getApiBaseUrl()}/api/subscribers/import/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Preview failed');
      setImportPreview(data);
    } catch (e: any) { setError(e.message); }
    finally { setImportLoading(false); }
  };

  const handleImportExecute = async (file: File) => {
    if (!token || !importPreview) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('force', 'false');
      const res = await fetch(`${getApiBaseUrl()}/api/subscribers/import/execute`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Import failed');
      setShowImport(false);
      setImportPreview(null);
      await load();
      alert(`Import complete: ${data.created} created, ${data.failed} failed`);
    } catch (e: any) { setError(e.message); }
    finally { setImportLoading(false); }
  };

  const resetMtImport = () => {
    setMtImportItems([]);
    setMtImportSelected({});
    setMtImportMsg(null);
  };
  const fetchMtImportPreview = async () => {
    if (!token || !mtImportRouterId) { setError('Select a router first'); return; }
    setImportLoading(true); setError(null); setMtImportMsg(null);
    try {
      const r = await apiFetch<any>(`/api/network/routers/${mtImportRouterId}/mikrotik/import-preview?type=${encodeURIComponent(mtImportType)}`, {}, token);
      const items = r.items || [];
      setMtImportItems(items);
      const sel: Record<string, boolean> = {};
      for (const it of items) { if (!it.exists) sel[it.name] = true; }
      setMtImportSelected(sel);
      setMtImportMsg(`Fetched ${items.length} user(s). ${items.filter((x:any)=>x.exists).length} already exist in IzanDesk (unchecked by default).`);
    } catch (e: any) { setError(e.message); }
    finally { setImportLoading(false); }
  };
  const runMtImport = async () => {
    if (!token || !mtImportRouterId) return;
    const selected = mtImportItems.map(i => i.name).filter(n => mtImportSelected[n]);
    if (!selected.length) { setError('Select at least one user to import'); return; }
    if (!confirm(`Import ${selected.length} selected user(s) from MikroTik as subscribers?`)) return;
    setImportLoading(true); setError(null); setMtImportMsg(null);
    try {
      const r = await apiFetch<any>(`/api/network/routers/${mtImportRouterId}/mikrotik/import`, { method: 'POST', body: JSON.stringify({ type: mtImportType, selected, options: { skip_existing: true } }) }, token);
      setMtImportMsg(`Import complete: ${r.imported || 0} imported, ${r.skipped || 0} skipped, ${r.failed || 0} failed.${r.note ? ' ' + r.note : ''}`);
      await fetchMtImportPreview();
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setImportLoading(false); }
  };

  const handleBatchAction = async () => {
    if (!token || !batchAction || selectedIds.length === 0) return;
    const reason = window.prompt(`Reason for ${batchAction}:`, '') || undefined;
    setError(null);
    try {
      await apiFetch('/api/subscribers/batch', { method: 'POST', body: JSON.stringify({ action: batchAction, ids: selectedIds, params: { reason } }) }, token);
      setBatchAction('');
      setSelectedIds([]);
      await load();
      if (detail && selectedIds.includes(detail.id)) setDetail(null);
    } catch (e: any) { setError(e.message); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    setSelectedIds(rows.map(r => r.id));
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const exportCsv = async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      const res = await fetch(`${getApiBaseUrl()}/api/subscribers/export?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'subscribers.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); }
  };

  // Equipment functions
  const loadEquipment = useCallback(async () => {
    if (!token || !detail) return;
    setEquipLoading(true);
    try {
      const eq = await apiFetch<any>(`/api/subscriber-equipment/subscriber/${detail.id}`, {}, token);
      setEquipment(eq?.data || []);
    } catch { setEquipment([]); }
    finally { setEquipLoading(false); }
  }, [token, detail]);

  const saveEquip = async () => {
    if (!token || !detail) return;
    setError(null);
    try {
      const payload = { ...equipForm, subscriber_id: detail.id };
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
      if (editEquip) {
        await apiFetch(`/api/subscriber-equipment/${editEquip.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      } else {
        await apiFetch('/api/subscriber-equipment', { method: 'POST', body: JSON.stringify(payload) }, token);
      }
      setShowEquipModal(false);
      setEditEquip(null);
      setEquipForm({ equipment_type: 'CPE', serial_number: '', mac_address: '', inventory_serial_id: '', onu_id: '', status: 'ASSIGNED', location_details: '', firmware_version: '', config_backup: '', notes: '' });
      await loadEquipment();
    } catch (e: any) { setError(e.message); }
  };

  const removeEquip = async (id: string) => {
    if (!token || !confirm('Remove this equipment assignment?')) return;
    await apiFetch(`/api/subscriber-equipment/${id}`, { method: 'DELETE' }, token);
    await loadEquipment();
  };

  const logComm = async (channel: string) => {
    if (!token || !detail) return;
    const subject = window.prompt('Subject (optional):', '') || undefined;
    const body = window.prompt('Details:', '') || undefined;
    if (!body && !subject) return;
    try {
      await apiFetch('/api/subscriber-communications/log-' + channel.toLowerCase(), { method: 'POST', body: JSON.stringify({ subscriber_id: detail.id, subject, body }) }, token);
      const comm = await apiFetch<any>(`/api/subscriber-communications/subscriber/${detail.id}?limit=50`, {}, token);
      setCommunications(comm?.data || []);
    } catch (e: any) { setError(e.message); }
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


  const fupAction = async (action: 'evaluate'|'clear'|'apply') => {
    if (!token || !detail) return;
    const reason = window.prompt('Optional reason (leave blank to skip):', '') || undefined;
    setFupBusy(true); setError(null);
    try {
      await apiFetch(`/api/billing/fup/subscribers/${detail.id}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }, token);
      await openDetail(detail.id);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setFupBusy(false); }
  };
  const toggleFupExempt = async () => {
    if (!token || !detail) return;
    const next = !detail.fup_exempt;
    const reason = window.prompt('Optional reason (leave blank to skip):', next ? 'Marked FUP exempt by admin' : 'FUP exemption removed by admin') || undefined;
    setFupBusy(true); setError(null);
    try {
      await apiFetch(`/api/billing/fup/subscribers/${detail.id}/exempt`, { method: 'POST', body: JSON.stringify({ exempt: next, ...(reason ? { reason } : {}) }) }, token);
      await openDetail(detail.id);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setFupBusy(false); }
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

  const counts = {
    active: rows.filter(r => String(r.status).toUpperCase() === 'ACTIVE').length,
    expired: rows.filter(r => String(r.status).toUpperCase() === 'EXPIRED').length,
    suspended: rows.filter(r => String(r.status).toUpperCase() === 'SUSPENDED').length,
    pending: rows.filter(r => ['PENDING','INACTIVE'].includes(String(r.status).toUpperCase())).length,
  };
  const statusBadge = (s: string) => {
    const v = String(s || '').toUpperCase();
    if (v === 'ACTIVE') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (v === 'EXPIRED') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (v === 'SUSPENDED') return 'bg-red-500/10 text-red-400 border-red-500/20';
    if (v === 'PENDING') return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    return 'bg-muted/40 text-muted-foreground border-border';
  };

  const closeImportModal = () => {
    setShowImport(false);
    setImportPreview(null);
    setImportMode('file');
    resetMtImport();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Subscribers (BSS Core)</h1>
          <p className="text-sm text-muted-foreground">Wizard onboarding, PPPoE profiles, map-based location, auto address fill, KYC & topology — {total} total</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[
              ['', 'All'],
              ['ACTIVE', 'Active'],
              ['EXPIRED', 'Expired'],
              ['SUSPENDED', 'Suspended'],
              ['PENDING', 'Pending'],
            ].map(([k, label]) => (
              <button key={k || 'all'} onClick={() => setStatus(k)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${status === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted/50 text-foreground'}`}>{label}</button>
            ))}
            <Link href="/gis" className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-border bg-card hover:bg-muted/50 text-foreground inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5"/>Client Locations (GIS)</Link>
            <button onClick={() => setClientView(v => v === 'detailed' ? 'compact' : 'detailed')} className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${clientView === 'detailed' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted/50 text-foreground'}`}>All Client Info</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={exportCsv} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Download className="w-4 h-4"/>Export CSV</button>
          <button onClick={()=>{ setShowImport(true); setImportMode('file'); resetMtImport(); }} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><UploadIcon className="w-4 h-4"/>Import</button>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/5">
              <span className="text-xs text-amber-400">{selectedIds.length} selected</span>
              <select value={batchAction} onChange={e=>setBatchAction(e.target.value)} className="px-2 py-1 rounded-lg bg-card border border-border text-xs text-foreground">
                <option value="">Action...</option>
                <option value="activate">Activate</option>
                <option value="suspend">Suspend</option>
                <option value="walled_garden">Walled Garden</option>
                <option value="provision">Re-provision</option>
                <option value="set_package">Set Package</option>
                <option value="set_reseller">Set Reseller</option>
                <option value="delete">Delete</option>
              </select>
              <button onClick={handleBatchAction} disabled={!batchAction} className="px-2 py-1.5 rounded-lg bg-amber-500 text-amber-foreground text-xs font-semibold">Apply</button>
              <button onClick={clearSelection} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-3.5 h-3.5"/></button>
            </div>
          )}
          <button onClick={openCreate} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Plus className="w-4 h-4"/>Add Subscriber</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground">Total (all)</div><div className="text-xl font-black mt-1">{total}</div></div>
        <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5"><div className="text-xs text-emerald-300/80">Active (loaded)</div><div className="text-xl font-black mt-1 text-emerald-400">{counts.active}</div></div>
        <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5"><div className="text-xs text-amber-300/80">Expired (loaded)</div><div className="text-xl font-black mt-1 text-amber-400">{counts.expired}</div></div>
        <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5"><div className="text-xs text-red-300/80">Suspended (loaded)</div><div className="text-xl font-black mt-1 text-red-400">{counts.suspended}</div></div>
        <div className="p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5"><div className="text-xs text-blue-300/80">Pending (loaded)</div><div className="text-xl font-black mt-1 text-blue-400">{counts.pending}</div></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name, client code, username, phone, email, MAC, IP..." className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground outline-none focus:border-primary/50"/>
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

      <div className={`grid grid-cols-1 ${clientView === 'detailed' ? '' : 'xl:grid-cols-3'} gap-5`}>
        <div className={`${clientView === 'detailed' ? '' : 'xl:col-span-2'} rounded-2xl border border-border bg-card overflow-hidden`}>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="text-center px-4 py-3 w-10"><input type="checkbox" checked={selectedIds.length === rows.length && rows.length > 0} onChange={selectedIds.length === rows.length ? clearSelection : selectAll} className="w-4 h-4"/></th>
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-left px-4 py-3">Contact</th>
                  {clientView === 'detailed' && <th className="text-left px-4 py-3">Address</th>}
                  <th className="text-left px-4 py-3">Connection</th>
                  <th className="text-left px-4 py-3">Package</th>
                  {clientView === 'detailed' && <th className="text-left px-4 py-3">Billing</th>}
                  <th className="text-left px-4 py-3">Location/Topology</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={clientView === 'detailed' ? 10 : 8} className="px-4 py-8 text-center text-muted-foreground">Loading subscribers...</td></tr> :
                 rows.length === 0 ? <tr><td colSpan={clientView === 'detailed' ? 10 : 8} className="px-4 py-8 text-center text-muted-foreground">No subscribers found. Add one with the wizard.</td></tr> :
                 rows.map(r => (
                  <tr key={r.id} className="border-t border-border/70 hover:bg-muted/30 cursor-pointer" onClick={(e)=>{ if(!(e.target as HTMLElement).closest('button,input')) openDetail(r.id); }}>
                    <td className="px-4 py-3 text-center"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={(e)=>{ e.stopPropagation(); toggleSelect(r.id); }} className="w-4 h-4"/></td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{r.full_name}</div>
                      <div className="text-xs text-primary font-mono">{r.client_code}</div>
                      {clientView !== 'detailed' && <div className="text-xs text-muted-foreground">{r.phone || r.email || '-'}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{r.phone || '-'}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]" title={r.email || ''}>{r.email || '-'}</div>
                    </td>
                    {clientView === 'detailed' && (
                      <td className="px-4 py-3">
                        <div className="text-xs max-w-[240px] truncate" title={r.address || ''}>{r.address || '-'}</div>
                        <div className="text-xs text-muted-foreground">{[r.village, r.thana || r.upazila, r.district].filter(Boolean).join(', ') || '-'}</div>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium">{r.connection_type}</div>
                      <div className="text-xs text-muted-foreground">{r.username ? `PPPoE: ${r.username}` : (r.subscriber_type || 'HOME')}</div>
                      <div className="text-[10px] mt-0.5">{r.provisioning_mode === 'ROUTER' ? <span className="text-cyan-400">Router: {r.router_name || 'selected'}</span> : <span className="text-violet-400">RADIUS pool</span>}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{r.package_name || '-'}</div>
                      <div className="text-xs text-muted-foreground">{r.bandwidth_mbps ? `${r.bandwidth_mbps} Mbps` : ''} {r.monthly_bill ? `• ৳${r.monthly_bill}` : ''}</div>
                    </td>
                    {clientView === 'detailed' && (
                      <td className="px-4 py-3">
                        <div className="text-xs">Bill: {r.monthly_bill != null ? `৳${Number(r.monthly_bill).toLocaleString()}` : '-'}</div>
                        <div className={`text-xs font-medium ${Number(r.current_due || 0) > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>Due: ৳{Number(r.current_due || 0).toLocaleString()}</div>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="text-xs">{[r.area_name, r.village, r.thana || r.upazila, r.district].filter(Boolean).join(', ') || `${r.area_name_db || r.area_name || '-'}`}</div>
                      <div className="text-xs text-muted-foreground">{r.distribution_box_name || r.distribution_box_code || '-'} {r.latitude ? '• 📍' : ''}</div>
                    </td>
                    <td className="px-4 py-3"><div className="flex flex-col gap-1 items-start"><span className={`text-[11px] px-2 py-1 rounded-full border font-semibold ${statusBadge(r.status)}`}>{r.status}</span>{r.fup_exceeded && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 font-semibold">FUP Throttled</span>}</div></td>
                    <td className="px-4 py-3 text-right" onClick={e=>e.stopPropagation()}>
                      <Link href={`/subscribers/${r.id}/live`} onClick={e=>e.stopPropagation()} className="p-2 rounded-lg hover:bg-emerald-500/10 text-emerald-400 inline-flex" title="Open Live Dashboard"><Activity className="w-4 h-4"/></Link>
                      <button onClick={(e)=>{e.stopPropagation();openEdit(r)}} className="p-2 rounded-lg hover:bg-muted" title="Edit"><Pencil className="w-4 h-4"/></button>
                      <button onClick={(e)=>{e.stopPropagation();remove(r.id)}} className="p-2 rounded-lg hover:bg-red-500/10 text-red-400" title="Delete"><Trash2 className="w-4 h-4"/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          {!detail ? (
            <div className="text-sm text-muted-foreground py-16 text-center border border-dashed border-border rounded-xl">Select a subscriber to view profile, provisioning, location and KYC documents.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-foreground flex items-center gap-2"><User className="w-4 h-4 text-primary"/><span className="truncate">{detail.full_name}</span></div>
                  <div className="text-xs font-mono text-primary mt-0.5">{detail.client_code}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${statusBadge(detail.status)}`}>{detail.status}</span>{detail.fup_exceeded && <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 font-semibold">FUP Throttled</span>}
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-muted/30">{detail.connection_type || '-'}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-muted/30">{detail.provisioning_mode === 'ROUTER' ? 'ROUTER' : 'RADIUS'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={()=>downloadCaf(detail.id)} className="p-1.5 rounded-lg hover:bg-muted border border-transparent hover:border-border" title="Download CAF PDF"><FileText className="w-4 h-4"/></button>
                  <button onClick={()=>openEdit(detail)} className="p-1.5 rounded-lg hover:bg-muted border border-transparent hover:border-border" title="Edit"><Pencil className="w-4 h-4"/></button>
                  <button onClick={()=>setDetail(null)} className="p-1.5 rounded-lg hover:bg-muted" title="Close"><X className="w-4 h-4"/></button>
                </div>
              </div>

              {/* Detail Tabs */}
              <div className="border-b border-border">
                <nav className="flex gap-1 overflow-x-auto pb-1" role="tablist">
                  {[
                    { id: 'profile', label: 'Profile', icon: User },
                    { id: 'equipment', label: 'Equipment', icon: Package },
                    { id: 'communications', label: 'Communications', icon: MessageSquare },
                    { id: 'history', label: 'History', icon: History },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={detailTab === tab.id}
                      onClick={() => setDetailTab(tab.id as any)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-colors whitespace-nowrap ${
                        detailTab === tab.id
                          ? 'bg-primary/10 text-primary border-b-2 border-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                      }`}
                    >
                      <tab.icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              {detailTab === 'profile' && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Info label="Type" value={detail.subscriber_type} /><Info label="Connection" value={detail.connection_type} />
                    <Info label="Ownership" value={detail.reseller_name ? `Reseller: ${detail.reseller_name}` : 'Own Subscriber (ISP)'} />
                    <Info label="Provisioning" value={detail.provisioning_mode === 'ROUTER' ? `Router (API/REST): ${detail.router_name || detail.router_id || '-'}` : 'RADIUS (all RADIUS-enabled routers)'} />
                    <Info label="PPPoE User" value={detail.username || '-'} /><Info label="Phone" value={detail.phone || '-'} />
                    <Info label="Package" value={detail.package_name || '-'} />
                    <Info label="Monthly Bill" value={detail.monthly_bill ? `৳${detail.monthly_bill}` : '-'} /><Info label="Current Due" value={detail.current_due != null ? `৳${detail.current_due}` : '-'} />
                    <Info label="District" value={detail.district || '-'} /><Info label="Thana/Upazila" value={detail.thana || detail.upazila || '-'} />
                    <Info label="Post Office" value={detail.post_office || '-'} /><Info label="Village/Area" value={detail.village || detail.area_name || '-'} />
                    <Info label="Ward/Road" value={[detail.ward_no, detail.road_no].filter(Boolean).join(' / ') || '-'} /><Info label="Geo" value={detail.latitude ? `${Number(detail.latitude).toFixed(5)}, ${Number(detail.longitude).toFixed(5)}` : '-'} />
                    <div className="col-span-2"><Info label="Address" value={detail.address || '-'} /></div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link href={`/subscribers/${detail.id}/live`} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10 inline-flex items-center gap-1"><Activity className="w-3.5 h-3.5"/>Open Live Dashboard</Link>
                    <a href={`/subscribers/live`} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50">All Live Sessions</a>
                    <a href={`/billing`} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50">Billing</a>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <div className="font-semibold text-sm mb-2">FUP / Quota Enforcement</div>
                    <div className="text-xs text-muted-foreground mb-2 space-y-1">
                      <div className="flex flex-wrap items-center gap-2"><span>Status: {detail.fup_exceeded ? <span className="text-amber-400 font-semibold">Throttled (FUP enforced)</span> : <span className="text-emerald-400">Not throttled</span>}{detail.fup_applied_at ? ` • applied ${new Date(detail.fup_applied_at).toLocaleString()}` : ''}</span>{detail.fup_exempt && <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 font-semibold">EXEMPT</span>}</div>
                      {detail.quota ? (
                        <div>
                          <div>Monthly usage: {Number(detail.quota.used_bytes||0) > 1e9 ? (Number(detail.quota.used_bytes)/1e9).toFixed(2)+' GB' : Number(detail.quota.used_bytes||0) > 1e6 ? (Number(detail.quota.used_bytes)/1e6).toFixed(2)+' MB' : `${Number(detail.quota.used_bytes||0)} B`} of {Number(detail.quota.cap_gb)} GB ({Number(detail.quota.percent||0).toFixed(2)}%) • {detail.quota.over_cap ? <span className="text-red-400">Over cap</span> : <span className="text-emerald-400">Within cap</span>}{detail.quota.fup_speed_mbps ? ` • FUP ${detail.quota.fup_speed_mbps} Mbps` : ''}</div>
                          <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`${detail.quota.over_cap?'bg-red-500':'bg-cyan-500'} h-full`} style={{width:`${Math.min(100,Number(detail.quota.percent||0))}%`}}/></div>
                        </div>
                      ) : <div>Quota: not configured for this package.</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={fupBusy} onClick={()=>fupAction('evaluate')} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50 disabled:opacity-50">Evaluate</button>
                      <button disabled={fupBusy} onClick={()=>fupAction('clear')} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50">Clear FUP</button>
                      <button disabled={fupBusy} onClick={()=>fupAction('apply')} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50">Force Apply</button>
                      <button disabled={fupBusy} onClick={toggleFupExempt} className={`text-[11px] px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${detail.fup_exempt ? 'border-violet-500/30 text-violet-300 hover:bg-violet-500/10' : 'border-border hover:bg-muted/50'}`}>{detail.fup_exempt ? 'Remove Exemption' : 'Mark Exempt'}</button>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-2">Best-effort: RADIUS/CoA and direct PPPoE profile throttling (ROUTER mode) with session refresh. Billing restrictions take precedence.</div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold mb-1">Recent FUP actions</div>
                      <div className="space-y-1.5 max-h-[140px] overflow-auto">
                        {fupLogs.slice(0,6).map((l:any)=>(
                          <div key={l.id} className="text-[11px] p-2 rounded-lg border border-border bg-muted/20 flex items-center justify-between gap-2">
                            <div className="min-w-0"><div><span className={`font-semibold ${l.action==='APPLIED'?'text-amber-400':'text-emerald-400'}`}>{l.action}</span> • {Number(l.used_bytes||0)>1e9?(Number(l.used_bytes)/1e9).toFixed(2)+' GB':Number(l.used_bytes||0)>1e6?(Number(l.used_bytes)/1e6).toFixed(2)+' MB':`${Number(l.used_bytes||0)} B`} / {l.cap_gb!=null?Number(l.cap_gb)+' GB':'-'} {l.fup_speed_mbps?`• FUP ${l.fup_speed_mbps} Mbps`:''}</div>{l.details?.reason && <div className="text-muted-foreground truncate">Reason: {String(l.details.reason)}</div>}</div>
                            <div className="text-muted-foreground whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString() : ''}</div>
                          </div>
                        ))}
                        {!fupLogs.length && <div className="text-[11px] text-muted-foreground">No FUP enforcement history for this subscriber.</div>}
                      </div>
                    </div>
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

              {detailTab === 'equipment' && (
                <div className="pt-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-primary"/>Assigned Equipment</div>
                    <button onClick={() => setShowEquipModal(true)} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5"/>Assign Equipment</button>
                  </div>
                  <div className="space-y-2">
                    {equipment.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">No equipment assigned. Click "Assign Equipment" to add.</div> :
                      equipment.map((eq: any) => (
                        <div key={eq.id} className="p-3 rounded-lg border border-border bg-muted/20 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Package className="w-5 h-5 text-primary"/></div>
                            <div>
                              <div className="font-medium text-foreground">{eq.equipment_type}</div>
                              <div className="text-xs text-primary font-mono">{eq.serial_number}</div>
                              {eq.mac_address && <div className="text-xs text-muted-foreground">MAC: {eq.mac_address}</div>}
                              {eq.firmware_version && <div className="text-xs text-muted-foreground">FW: {eq.firmware_version}</div>}
                              {eq.location_details && <div className="text-xs text-muted-foreground">Loc: {eq.location_details}</div>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-1 rounded-full border ${
                              eq.status === 'INSTALLED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                              eq.status === 'ASSIGNED' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                              eq.status === 'FAULTY' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                              eq.status === 'RMA' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                              'bg-muted/40 text-muted-foreground border-border'
                            }`}>{eq.status}</span>
                            <button onClick={() => setEditEquip(eq)} className="p-1.5 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5"/></button>
                            <button onClick={() => removeEquip(eq.id)} className="p-1.5 rounded hover:bg-red-500/10 text-red-400"><Trash2 className="w-3.5 h-3.5"/></button>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

              {detailTab === 'communications' && (
                <div className="pt-2 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="font-semibold text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary"/>Communication Log</div>
                    <div className="flex gap-1">
                      <button onClick={() => logComm('CALL')} className="px-2 py-1 rounded-lg border border-border text-xs hover:bg-muted"><Phone className="w-3.5 h-3.5"/></button>
                      <button onClick={() => logComm('WHATSAPP')} className="px-2 py-1 rounded-lg border border-border text-xs hover:bg-muted"><MessageSquare className="w-3.5 h-3.5"/></button>
                      <button onClick={() => logComm('EMAIL')} className="px-2 py-1 rounded-lg border border-border text-xs hover:bg-muted"><Mail className="w-3.5 h-3.5"/></button>
                      <button onClick={() => logComm('SMS')} className="px-2 py-1 rounded-lg border border-border text-xs hover:bg-muted"><MessageSquare className="w-3.5 h-3.5"/></button>
                      <button onClick={() => logComm('NOTE')} className="px-2 py-1 rounded-lg border border-border text-xs hover:bg-muted"><FileText className="w-3.5 h-3.5"/></button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-[300px] overflow-auto">
                    {communications.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">No communications logged. Use the buttons above to log calls, WhatsApp, emails, etc.</div> :
                      communications.map((c: any) => (
                        <div key={c.id} className="p-3 rounded-lg border border-border bg-muted/20">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                c.channel === 'CALL' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                c.channel === 'WHATSAPP' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                c.channel === 'EMAIL' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                c.channel === 'SMS' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' :
                                'bg-muted/40 text-muted-foreground border-border'
                              }`}>{c.channel}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                c.direction === 'INBOUND' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              }`}>{c.direction}</span>
                              {c.subject && <span className="font-medium text-xs">{c.subject}</span>}
                            </div>
                            <div className="text-[10px] text-muted-foreground whitespace-nowrap">{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</div>
                          </div>
                          {c.body && <div className="text-xs text-muted-foreground line-clamp-2">{c.body}</div>}
                          {c.contact_person && <div className="text-[10px] text-muted-foreground">Contact: {c.contact_person} {c.contact_phone ? `(${c.contact_phone})` : ''}{c.contact_email ? ` ${c.contact_email}` : ''}</div>}
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

              {detailTab === 'history' && (
                <div className="pt-2 space-y-2 max-h-[300px] overflow-auto">
                  {history.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">No status history available.</div> :
                    history.slice(0, 50).map((h: any) => (
                      <div key={h.action + h.created_at} className="text-[11px] p-2 rounded-lg border border-border bg-muted/20 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="font-semibold text-primary">{h.action}</span><span className="text-muted-foreground">by {h.actor_name} ({h.actor_role})</span></div>
                          {h.details?.changes && <div className="text-muted-foreground truncate">Changes: {Object.keys(h.details.changes).join(', ')}</div>}
                        </div>
                        <div className="text-muted-foreground whitespace-nowrap">{h.created_at ? new Date(h.created_at).toLocaleString() : ''}</div>
                      </div>
                    ))
                  }
                </div>
              )}
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
                  <Select label="Subscriber Ownership" value={form.reseller_id||''} onChange={v=>setForm({...form, reseller_id:v})} options={[{v:'',l:'Own Subscriber (ISP)'}, ...resellers.map((r:any)=>({v:r.id,l:`Reseller: ${r.name}${r.company_name ? ' ('+r.company_name+')' : ''}`}))]} />
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
                    <Select label="Package" value={form.package_name||''} onChange={v=>setForm({...form, package_name:v})} options={[{v:'',l:'Select package...'}, ...packages.map((p:any)=>({v:p.name,l:`${p.name} (${p.download_mbps}↓/${p.upload_mbps}↑ Mbps • ৳${p.price})`}))]} />
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
                      ['Name', form.full_name], ['Type', form.subscriber_type], ['Status', form.status], ['Ownership', form.reseller_id ? (resellers.find((r:any)=>r.id===form.reseller_id)?.name || 'Reseller') : 'Own Subscriber (ISP)'], ['Phone', form.phone||'-'], ['Email', form.email||'-'], ['NID', form.nid_number||'-']
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

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-bold text-lg">Import Subscribers</h2>
                <p className="text-xs text-muted-foreground">Upload a file or import PPPoE/Hotspot users directly from a MikroTik router</p>
              </div>
              <button onClick={closeImportModal} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button>
            </div>

            <div className="p-5 space-y-4 overflow-auto">
              <div className="flex gap-2">
                <button onClick={()=>{ setImportMode('file'); setImportPreview(null); resetMtImport(); }} className={`px-3 py-2 rounded-xl text-sm border ${importMode==='file' ? 'bg-primary/10 text-primary border-primary/30' : 'border-border bg-card'}`}>Upload File (XLSX/CSV)</button>
                <button onClick={()=>{ setImportMode('mikrotik'); setImportPreview(null); resetMtImport(); }} className={`px-3 py-2 rounded-xl text-sm border ${importMode==='mikrotik' ? 'bg-primary/10 text-primary border-primary/30' : 'border-border bg-card'}`}>From MikroTik (PPPoE/Hotspot Users)</button>
              </div>

              {importMode === 'file' ? (
                !importPreview ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-2">
                      <div className="font-semibold text-sm flex items-center gap-2"><UploadIcon className="w-4 h-4"/>Upload File</div>
                      <input type="file" accept=".xlsx,.xls,.csv" className="text-xs" onChange={e=>{ const f=e.target.files?.[0]; if(f) handleImportPreview(f); }} disabled={importLoading} />
                      {importLoading && <div className="text-xs text-primary">Processing preview...</div>}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Supported formats: XLSX, XLS, CSV</div>
                      <div>Required columns: full_name</div>
                      <div>Optional columns include username, password, package_name, provisioning_mode, router_id, status, connection_type, etc. (case-insensitive / snake_case or Title Case).</div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${importPreview.valid > 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'} border`}>
                          <div className="text-xs text-muted-foreground">Total Rows</div>
                          <div className="text-xl font-black">{importPreview.total}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <div className="text-xs text-muted-foreground">Valid</div>
                          <div className="text-xl font-black text-emerald-400">{importPreview.valid}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                          <div className="text-xs text-muted-foreground">Invalid</div>
                          <div className="text-xl font-black text-red-400">{importPreview.invalid}</div>
                        </div>
                      </div>
                      <button onClick={()=>setImportPreview(null)} className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted">Change File</button>
                    </div>

                    {importPreview.errors?.length > 0 && (
                      <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10">
                        <div className="text-xs font-semibold text-red-400 mb-2">Validation Errors (first 50)</div>
                        <div className="space-y-1 max-h-40 overflow-auto text-[11px] text-red-300">
                          {importPreview.errors.slice(0, 50).map((e: string, i: number) => <div key={i} className="truncate">{e}</div>)}
                        </div>
                      </div>
                    )}

                    <div className="p-3 rounded-xl border border-border bg-muted/20">
                      <div className="text-xs font-semibold mb-2">Preview (first 100 rows)</div>
                      <div className="overflow-x-auto max-h-80 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40 text-muted-foreground">
                            <tr>
                              <th className="text-left px-2 py-1">Row</th>
                              <th className="text-left px-2 py-1">Status</th>
                              <th className="text-left px-2 py-1">Name</th>
                              <th className="text-left px-2 py-1">Username</th>
                              <th className="text-left px-2 py-1">Package</th>
                              <th className="text-left px-2 py-1">Area</th>
                              <th className="text-left px-2 py-1">Provisioning</th>
                              <th className="text-left px-2 py-1">Errors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importPreview.preview.map((p: any) => (
                              <tr key={p.row} className="border-t border-border/50">
                                <td className="px-2 py-1">{p.row}</td>
                                <td className="px-2 py-1">{p.valid ? <CheckCircle className="w-4 h-4 text-emerald-400"/> : <AlertCircle className="w-4 h-4 text-red-400"/>}</td>
                                <td className="px-2 py-1">{p.data?.full_name || '-'}</td>
                                <td className="px-2 py-1">{p.data?.username || '-'}</td>
                                <td className="px-2 py-1">{p.data?.package_name || '-'}</td>
                                <td className="px-2 py-1">{p.data?.area_id || '-'}</td>
                                <td className="px-2 py-1">{p.data?.provisioning_mode || '-'}</td>
                                <td className="px-2 py-1 text-red-400 truncate max-w-xs">{p.errors?.join('; ') || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button onClick={()=>setImportPreview(null)} className="px-4 py-2 rounded-xl border border-border">Back</button>
                      <button onClick={async () => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.xlsx,.xls,.csv';
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            const formData = new FormData();
                            formData.append('file', file);
                            formData.append('force', 'false');
                            setImportLoading(true);
                            try {
                              const res = await fetch(`${getApiBaseUrl()}/api/subscribers/import/execute`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data?.message || 'Import failed');
                              closeImportModal();
                              await load();
                              alert(`Import complete: ${data.created} created, ${data.failed} failed`);
                            } catch (e: any) { setError(e.message); }
                            finally { setImportLoading(false); }
                          }
                        };
                        input.click();
                      }} disabled={importLoading} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50">
                        {importLoading ? 'Importing...' : 'Execute Import'}
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">Router (API/REST)</div>
                      <select className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm" value={mtImportRouterId} onChange={e=>{ setMtImportRouterId(e.target.value); resetMtImport(); }}>
                        <option value="">Select router</option>
                        {routers.filter((r:any)=>['API','REST'].includes(String(r.integration_mode||'').toUpperCase())).map((r:any)=> <option key={r.id} value={r.id}>{r.name} ({r.host})</option>)}
                      </select>
                    </label>
                    <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">User Type</div>
                      <select className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm" value={mtImportType} onChange={e=>{ setMtImportType(e.target.value as any); resetMtImport(); }}>
                        <option value="ppp-secrets">PPPoE Users (PPP Secrets)</option>
                        <option value="hotspot-users">Hotspot Users</option>
                      </select>
                    </label>
                    <div className="flex items-end gap-2">
                      <button onClick={fetchMtImportPreview} disabled={importLoading || !mtImportRouterId} className="px-4 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${importLoading?'animate-spin':''}`}/>{importLoading?'Fetching...':'Fetch Users'}</button>
                      <button onClick={runMtImport} disabled={importLoading || !mtImportItems.length} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Download className="w-4 h-4"/>Import Selected</button>
                    </div>
                  </div>
                  {mtImportMsg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{mtImportMsg}</div>}
                  <div className="text-xs text-muted-foreground">Imports selected MikroTik users as IzanDesk subscribers (auto client code, assigned to this router as ROUTER provisioning). PPP profile names are matched to existing bandwidth package names/profile names when possible. Existing usernames are detected and unchecked by default.</div>

                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border text-xs">
                      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={mtImportItems.length>0 && mtImportItems.every(i=>mtImportSelected[i.name])} onChange={e=>{ const checked=e.target.checked; const sel:Record<string,boolean>={}; for(const it of mtImportItems) sel[it.name]=checked; setMtImportSelected(sel); }} /> Select all</label>
                      <span className="text-muted-foreground">{Object.values(mtImportSelected).filter(Boolean).length} selected / {mtImportItems.length} fetched</span>
                    </div>
                    <div className="max-h-[360px] overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card text-muted-foreground uppercase border-b border-border"><tr>
                          <th className="text-left py-2 px-3 w-10"></th>
                          <th className="text-left py-2 px-3">Username</th>
                          <th className="text-left py-2 px-3">Profile / Service</th>
                          <th className="text-left py-2 px-3">Details</th>
                          <th className="text-left py-2 px-3">State</th>
                        </tr></thead>
                        <tbody>
                          {mtImportItems.map((it:any)=> (
                            <tr key={it.name} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="py-2 px-3"><input type="checkbox" checked={!!mtImportSelected[it.name]} onChange={()=>setMtImportSelected(s=>({...s,[it.name]:!s[it.name]}))} /></td>
                              <td className="py-2 px-3"><div className="font-mono font-medium text-foreground">{it.name}</div>{it.comment ? <div className="text-muted-foreground truncate max-w-[220px]">{it.comment}</div> : null}</td>
                              <td className="py-2 px-3">{it.profile || '-'} {it.service ? <span className="text-muted-foreground">({it.service})</span> : null}</td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {it.remote_address ? <div>remote: {it.remote_address}</div> : null}
                                {it.caller_id || it.mac_address ? <div>mac/caller: {it.caller_id || it.mac_address}</div> : null}
                                {it.limit_uptime || it.limit_bytes_total ? <div>limits: {it.limit_uptime||''} {it.limit_bytes_total||''}</div> : null}
                              </td>
                              <td className="py-2 px-3"><div className="flex flex-wrap gap-1">
                                {it.disabled ? <span className="px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">disabled</span> : <span className="px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">enabled</span>}
                                {it.exists ? <span className="px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/20">exists</span> : <span className="px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">new</span>}
                              </div></td>
                            </tr>
                          ))}
                          {!mtImportItems.length && <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">{importLoading ? 'Fetching from MikroTik...' : 'Select a router and click "Fetch Users".'}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Equipment Modal */}
      {showEquipModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-bold text-lg">{editEquip ? 'Edit Equipment' : 'Assign Equipment'}</h2>
                <p className="text-xs text-muted-foreground">Add or update CPE/ONU/Router assignment</p>
              </div>
              <button onClick={()=>{setShowEquipModal(false); setEditEquip(null); setEquipForm({ equipment_type: 'CPE', serial_number: '', mac_address: '', inventory_serial_id: '', onu_id: '', status: 'ASSIGNED', location_details: '', firmware_version: '', config_backup: '', notes: '' });}} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button>
            </div>

            <div className="p-5 space-y-4">
              <Select label="Equipment Type" value={equipForm.equipment_type} onChange={v=>setEquipForm({...equipForm, equipment_type:v})} options={['ONU','ROUTER','SWITCH','AP','CPE','MODEM','SPLITTER','OTHER']} />
              <Input label="Serial Number *" value={equipForm.serial_number} onChange={v=>setEquipForm({...equipForm, serial_number:v})} />
              <Input label="MAC Address" value={equipForm.mac_address} onChange={v=>setEquipForm({...equipForm, mac_address:v})} />
              <Input label="Inventory Serial ID" value={equipForm.inventory_serial_id} onChange={v=>setEquipForm({...equipForm, inventory_serial_id:v})} />
              <Input label="ONU ID" value={equipForm.onu_id} onChange={v=>setEquipForm({...equipForm, onu_id:v})} />
              <Select label="Status" value={equipForm.status} onChange={v=>setEquipForm({...equipForm, status:v})} options={['ASSIGNED','INSTALLED','FAULTY','RMA','RETURNED','RETIRED']} />
              <Input label="Location Details" value={equipForm.location_details} onChange={v=>setEquipForm({...equipForm, location_details:v})} placeholder="e.g., Living room, wall mount" />
              <Input label="Firmware Version" value={equipForm.firmware_version} onChange={v=>setEquipForm({...equipForm, firmware_version:v})} />
              <Input label="Config Backup (JSON)" value={equipForm.config_backup} onChange={v=>setEquipForm({...equipForm, config_backup:v})} />
              <Input label="Notes" value={equipForm.notes} onChange={v=>setEquipForm({...equipForm, notes:v})} />

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>{setShowEquipModal(false); setEditEquip(null); setEquipForm({ equipment_type: 'CPE', serial_number: '', mac_address: '', inventory_serial_id: '', onu_id: '', status: 'ASSIGNED', location_details: '', firmware_version: '', config_backup: '', notes: '' });}} className="px-4 py-2 rounded-xl border border-border">Cancel</button>
                <button onClick={saveEquip} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">{editEquip ? 'Save Changes' : 'Assign Equipment'}</button>
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
