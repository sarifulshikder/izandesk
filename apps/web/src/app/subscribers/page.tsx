'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { SubscriberFormWizard } from '@/components/subscribers/subscriber-form-wizard';
import { Search, Plus, Pencil, Trash2, X, Upload, FileText, User, RefreshCw, MapPin, Download, Upload as UploadIcon, Eye, History, FileSpreadsheet, AlertCircle, CheckCircle, MinusCircle, Package, MessageSquare, Phone, Mail, Activity, Users, UserCheck, UserX, Clock3 } from 'lucide-react';

export default function SubscribersPage() {
  const { token, user } = useAuth();
  const canReviewKyc = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'TECHNICIAN'].includes(String(user?.role));
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
  const [detail, setDetail] = useState<any | null>(null);
  const [routers, setRouters] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kycUploading, setKycUploading] = useState(false);
  const [kycProfile, setKycProfile] = useState<any>(null);
  const [fupBusy, setFupBusy] = useState(false);
  const [fupLogs, setFupLogs] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
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
    const r = await apiFetch<{data:any[]}>('/api/network/routers', {}, token).catch(()=>({data:[]}));
    setRouters(r.data || []);
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

  const openCreate = () => { setEditing(null); setShowForm(true); };
  useEffect(() => {
    const wantsNew = searchParams?.get('new') === '1' || searchParams?.get('action') === 'new' || searchParams?.get('add') === '1';
    if (wantsNew) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const openEdit = (row: any) => { setEditing(row); setShowForm(true); };

  const remove = async (id: string) => {
    if (!token || !confirm('Delete this subscriber?')) return;
    setError(null);
    try {
      await apiFetch(`/api/subscribers/${id}`, { method: 'DELETE' }, token);
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const openDetail = async (id: string) => {
    if (!token) return;
    const d = await apiFetch<any>(`/api/subscribers/${id}`, {}, token);
    setDetail(d);
    try {
      const [fl, hist, eq, comm, kyc] = await Promise.all([
        apiFetch<any>(`/api/billing/fup/logs?subscriber_id=${id}`, {}, token),
        apiFetch<any>(`/api/subscribers/${id}/history`, {}, token),
        apiFetch<any>(`/api/subscriber-equipment/subscriber/${id}`, {}, token),
        apiFetch<any>(`/api/subscriber-communications/subscriber/${id}?limit=50`, {}, token),
        apiFetch<any>(`/api/kyc/profiles/${id}`, {}, token).catch(() => ({ data: null })),
      ]);
      setFupLogs(fl?.data || []);
      setHistory(hist?.data?.status_changes || []);
      setEquipment(eq?.data || []);
      setCommunications(comm?.data || []);
      setKycProfile(kyc?.data || null);
    } catch { setFupLogs([]); setHistory([]); setEquipment([]); setCommunications([]); setKycProfile(null); }
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

  const viewKyc = async (docId: string) => {
    if (!token || !detail) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/subscribers/${detail.id}/kyc/${docId}/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Unable to open document');
      const url = window.URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener');
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
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

  const decideKyc = async (docId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION') => {
    if (!token || !detail || !canReviewKyc) return;
    let reason = '';
    if (decision !== 'APPROVE') {
      const answer = window.prompt('Reason (stored in the review trail and shown to the subscriber):');
      if (answer === null || !answer.trim()) return;
      reason = answer.trim();
    }
    try {
      await apiFetch(`/api/kyc/documents/${docId}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, reason: reason || null }),
      }, token);
      await openDetail(detail.id);
    } catch (e: any) { setError(e.message); }
  };

  const handleImportPreview = async (file: File) => {
    if (!token) return;
    setImportLoading(true); setImportPreview(null); setImportFile(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${getApiBaseUrl()}/api/subscribers/import/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Preview failed');
      setImportPreview(data);
      setImportFile(file);
    } catch (e: any) { setError(e.message); }
    finally { setImportLoading(false); }
  };

  const handleImportExecute = async () => {
    if (!token || !importPreview || !importFile) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
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
    setError(null);
    try {
      await apiFetch(`/api/subscriber-equipment/${id}`, { method: 'DELETE' }, token);
      await loadEquipment();
    } catch (e: any) { setError(e.message); }
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

  const counts = {
    active: rows.filter(r => String(r.status).toUpperCase() === 'ACTIVE').length,
    expired: rows.filter(r => String(r.status).toUpperCase() === 'EXPIRED').length,
    suspended: rows.filter(r => String(r.status).toUpperCase() === 'SUSPENDED').length,
    pending: rows.filter(r => ['PENDING','INACTIVE'].includes(String(r.status).toUpperCase())).length,
  };
  const statusBadge = (s: string) => {
    const v = String(s || '').toUpperCase();
    if (v === 'ACTIVE') return 'badge-success';
    if (v === 'EXPIRED') return 'badge-warning';
    if (v === 'SUSPENDED') return 'badge-danger';
    if (v === 'PENDING') return 'badge-info';
    return 'badge-secondary';
  };

  const closeImportModal = () => {
    setShowImport(false);
    setImportPreview(null);
    setImportFile(null);
    setImportMode('file');
    resetMtImport();
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Client operations · BSS Core</span>
          <h1 className="page-title">Subscribers</h1>
          <p className="page-subtitle">Onboarding, PPPoE profiles, KYC, topology and billing in one client record · {total} total</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={exportCsv} className="btn btn-outline"><Download className="w-4 h-4"/>Export CSV</button>
          <button onClick={()=>{ setShowImport(true); setImportMode('file'); resetMtImport(); }} className="btn btn-outline btn-icon" title="Import subscribers"><UploadIcon className="w-4 h-4"/></button>
          <button onClick={openCreate} className="btn btn-primary"><Plus className="w-4 h-4"/>Add Subscriber</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="stat-grid-5">
        <button onClick={()=>setStatus('')} className={`dash-stat dash-stat-primary compact ${status === '' ? '!border-primary/50' : ''}`}>
          <span className="dash-stat-icon"><Users /></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Total Clients</span><span className="dash-stat-value">{total}</span><span className="dash-stat-hint">all records</span></span>
        </button>
        <button onClick={()=>setStatus('ACTIVE')} className={`dash-stat dash-stat-success compact ${status === 'ACTIVE' ? '!border-primary/50' : ''}`}>
          <span className="dash-stat-icon"><UserCheck /></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Active</span><span className="dash-stat-value">{counts.active}</span><span className="dash-stat-hint">in current view</span></span>
        </button>
        <button onClick={()=>setStatus('EXPIRED')} className={`dash-stat dash-stat-warning compact ${status === 'EXPIRED' ? '!border-primary/50' : ''}`}>
          <span className="dash-stat-icon"><Clock3 /></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Expired</span><span className="dash-stat-value">{counts.expired}</span><span className="dash-stat-hint">renewal needed</span></span>
        </button>
        <button onClick={()=>setStatus('SUSPENDED')} className={`dash-stat dash-stat-danger compact ${status === 'SUSPENDED' ? '!border-primary/50' : ''}`}>
          <span className="dash-stat-icon"><UserX /></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Suspended</span><span className="dash-stat-value">{counts.suspended}</span><span className="dash-stat-hint">access restricted</span></span>
        </button>
        <button onClick={()=>setStatus('PENDING')} className={`dash-stat dash-stat-info compact ${status === 'PENDING' ? '!border-primary/50' : ''}`}>
          <span className="dash-stat-icon"><FileSpreadsheet /></span>
          <span className="dash-stat-body"><span className="dash-stat-label">Pending</span><span className="dash-stat-value">{counts.pending}</span><span className="dash-stat-hint">awaiting activation</span></span>
        </button>
      </div>

      <div className="toolbar-strip">
        {[
          ['', 'All'],
          ['ACTIVE', 'Active'],
          ['EXPIRED', 'Expired'],
          ['SUSPENDED', 'Suspended'],
          ['PENDING', 'Pending'],
        ].map(([k, label]) => (
          <button key={k || 'all'} onClick={() => setStatus(k)} className={`filter-chip ${status === k ? 'active' : ''}`}>{label}</button>
        ))}
        <span className="toolbar-divider" />
        <Link href="/gis" className="btn btn-ghost btn-sm"><MapPin className="w-3.5 h-3.5"/>Client Locations</Link>
        <button onClick={() => setClientView(v => v === 'detailed' ? 'compact' : 'detailed')} className={`filter-chip ${clientView === 'detailed' ? 'active' : ''}`}>All Client Info</button>
        {selectedIds.length > 0 && (
          <>
            <span className="toolbar-divider" />
            <span className="text-[11px] font-semibold text-warning">{selectedIds.length} selected</span>
            <select value={batchAction} onChange={e=>setBatchAction(e.target.value)} className="form-select !h-[30px] !w-auto !text-[11px]">
              <option value="">Bulk action…</option>
              <option value="activate">Activate</option>
              <option value="suspend">Suspend</option>
              <option value="walled_garden">Walled Garden</option>
              <option value="provision">Re-provision</option>
              <option value="set_package">Set Package</option>
              <option value="set_reseller">Set Reseller</option>
              <option value="delete">Delete</option>
            </select>
            <button onClick={handleBatchAction} disabled={!batchAction} className="btn btn-warning btn-sm">Apply</button>
            <button onClick={clearSelection} className="topbar-icon-btn !w-[30px] !h-[30px]" title="Clear selection"><X className="w-3.5 h-3.5"/></button>
          </>
        )}
      </div>

      <div className="card p-3 grid grid-cols-1 md:grid-cols-4 gap-2.5">
        <div className="md:col-span-2 input-icon">
          <Search />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, client code, username, phone, email, MAC or IP…" className="form-control w-full"/>
        </div>
        <select value={status} onChange={e=>setStatus(e.target.value)} className="form-select">
          <option value="">All Statuses</option>
          {['PENDING','ACTIVE','SUSPENDED','EXPIRED','TERMINATED'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={type} onChange={e=>setType(e.target.value)} className="form-select">
          <option value="">All Types</option>
          {['HOME','CORPORATE','HOTSPOT'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className={`grid grid-cols-1 ${clientView === 'detailed' ? '' : 'xl:grid-cols-3'} gap-5`}>
        <div className={`${clientView === 'detailed' ? '' : 'xl:col-span-2'} card overflow-hidden`}>
          <div className="table-wrap">
            <table className="table table-hover text-sm min-w-[820px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-center px-3 py-2.5 w-10"><input type="checkbox" checked={selectedIds.length === rows.length && rows.length > 0} onChange={selectedIds.length === rows.length ? clearSelection : selectAll} className="w-4 h-4"/></th>
                  <th className="text-left px-3 py-2.5">Client</th>
                  {clientView === 'detailed' && <th className="text-left px-3 py-2.5">Contact</th>}
                  {clientView === 'detailed' && <th className="text-left px-3 py-2.5">Address</th>}
                  <th className="text-left px-3 py-2.5">Connection</th>
                  <th className="text-left px-3 py-2.5">Package</th>
                  {clientView === 'detailed' && <th className="text-left px-3 py-2.5">Billing</th>}
                  <th className="text-left px-3 py-2.5">Location / Topology</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="text-right px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={clientView === 'detailed' ? 10 : 7} className="px-4 py-8 text-center text-muted-foreground">Loading subscribers...</td></tr> :
                 rows.length === 0 ? <tr><td colSpan={clientView === 'detailed' ? 10 : 7} className="px-4 py-8 text-center text-muted-foreground">No subscribers found. Add one with the wizard.</td></tr> :
                 rows.map(r => (
                  <tr key={r.id} className="border-t border-border/70 hover:bg-muted/30 cursor-pointer" onClick={(e)=>{ if(!(e.target as HTMLElement).closest('button,input')) openDetail(r.id); }}>
                    <td className="px-3 py-2.5 text-center"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={(e)=>{ e.stopPropagation(); toggleSelect(r.id); }} className="w-4 h-4"/></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="avatar avatar-sm avatar-primary">{String(r.full_name || '?').charAt(0).toUpperCase()}</span>
                        <div className="min-w-0">
                          <div className="font-semibold text-foreground text-[12px] truncate max-w-[150px]">{r.full_name}</div>
                          <div className="text-[10px] text-primary font-mono truncate max-w-[140px]">{r.client_code}</div>
                          {clientView !== 'detailed' && <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{r.phone || r.email || '-'}</div>}
                        </div>
                      </div>
                    </td>
                    {clientView === 'detailed' && <td className="px-3 py-2.5">
                      <div className="text-xs">{r.phone || '-'}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[150px]" title={r.email || ''}>{r.email || '-'}</div>
                    </td>}
                    {clientView === 'detailed' && (
                      <td className="px-3 py-2.5">
                        <div className="text-xs max-w-[180px] truncate" title={r.address || ''}>{r.address || '-'}</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{[r.village, r.thana || r.upazila, r.district].filter(Boolean).join(', ') || '-'}</div>
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium">{r.connection_type}</div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={r.username || ''}>{r.username ? `PPPoE: ${r.username}` : (r.subscriber_type || 'HOME')}</div>
                      <div className="text-[9.5px] mt-0.5 truncate max-w-[140px]">{r.provisioning_mode === 'ROUTER' ? <span className="text-teal">Router: {r.router_name || 'selected'}</span> : <span className="text-purple">RADIUS pool</span>}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs truncate max-w-[140px]">{r.package_name || '-'}</div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">{r.bandwidth_mbps ? `${r.bandwidth_mbps} Mbps` : ''} {r.monthly_bill ? `• ৳${r.monthly_bill}` : ''}</div>
                    </td>
                    {clientView === 'detailed' && (
                      <td className="px-3 py-2.5">
                        <div className="text-xs tabular-nums">Bill: {r.monthly_bill != null ? `৳${Number(r.monthly_bill).toLocaleString()}` : '-'}</div>
                        <div className={`text-[10px] font-medium tabular-nums ${Number(r.current_due || 0) > 0 ? 'text-warning' : 'text-muted-foreground'}`}>Due: ৳{Number(r.current_due || 0).toLocaleString()}</div>
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <div className="text-[11px] truncate max-w-[175px]" title={[r.area_name, r.village, r.thana || r.upazila, r.district].filter(Boolean).join(', ')}>{[r.area_name, r.village, r.thana || r.upazila, r.district].filter(Boolean).join(', ') || `${r.area_name_db || r.area_name || '-'}`}</div>
                      <div className="text-[9.5px] text-muted-foreground truncate max-w-[175px]">{r.distribution_box_name || r.distribution_box_code || '-'} {r.latitude ? '• 📍' : ''}</div>
                    </td>
                    <td className="px-3 py-2.5"><div className="flex flex-col gap-1 items-start"><span className={`badge ${statusBadge(r.status)}`}>{r.status}</span>{r.fup_exceeded && <span className="badge badge-warning">FUP Throttled</span>}</div></td>
                    <td className="px-3 py-2.5 text-right" onClick={e=>e.stopPropagation()}>
                      <div className="inline-flex items-center gap-0.5">
                        <Link href={`/subscribers/${r.id}/live`} onClick={e=>e.stopPropagation()} className="topbar-icon-btn !w-7 !h-7 !rounded-lg" title="Open Live Dashboard"><Activity className="w-3.5 h-3.5"/></Link>
                        <button onClick={(e)=>{e.stopPropagation();openEdit(r)}} className="topbar-icon-btn !w-7 !h-7 !rounded-lg" title="Edit"><Pencil className="w-3.5 h-3.5"/></button>
                        <button onClick={(e)=>{e.stopPropagation();remove(r.id)}} className="topbar-icon-btn !w-7 !h-7 !rounded-lg hover:!text-danger" title="Delete"><Trash2 className="w-3.5 h-3.5"/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card overflow-hidden">
          {!detail ? (
            <div className="p-4">
              <div className="empty-panel">
                <span className="empty-panel-icon"><Users className="w-5 h-5" /></span>
                <div>
                  <div className="text-sm font-semibold text-foreground">No client selected</div>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px] leading-relaxed">Choose a subscriber from the table to open the full profile, provisioning, location and KYC record.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={openCreate} className="btn btn-primary btn-sm"><Plus className="w-3.5 h-3.5" />Add client</button>
                  <Link href="/gis" className="btn btn-outline btn-sm"><MapPin className="w-3.5 h-3.5" />GIS map</Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-foreground flex items-center gap-2"><User className="w-4 h-4 text-primary"/><span className="truncate">{detail.full_name}</span></div>
                  <div className="text-xs font-mono text-primary mt-0.5">{detail.client_code}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className={`badge ${statusBadge(detail.status)}`}>{detail.status}</span>{detail.fup_exceeded && <span className="badge badge-warning">FUP Throttled</span>}
                    <span className="badge badge-secondary">{detail.connection_type || '-'}</span>
                    <span className="badge badge-secondary">{detail.provisioning_mode === 'ROUTER' ? 'ROUTER' : 'RADIUS'}</span>
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
                    <Link href={`/subscribers/${detail.id}/live`} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-success/30 text-success bg-success/5 hover:bg-success/10 inline-flex items-center gap-1"><Activity className="w-3.5 h-3.5"/>Open Live Dashboard</Link>
                    <a href={`/subscribers/live`} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50">All Live Sessions</a>
                    <a href={`/billing`} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50">Billing</a>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <div className="font-semibold text-sm mb-2">FUP / Quota Enforcement</div>
                    <div className="text-xs text-muted-foreground mb-2 space-y-1">
                      <div className="flex flex-wrap items-center gap-2"><span>Status: {detail.fup_exceeded ? <span className="text-warning font-semibold">Throttled (FUP enforced)</span> : <span className="text-success">Not throttled</span>}{detail.fup_applied_at ? ` • applied ${new Date(detail.fup_applied_at).toLocaleString()}` : ''}</span>{detail.fup_exempt && <span className="badge badge-purple">EXEMPT</span>}</div>
                      {detail.quota ? (
                        <div>
                          <div>Monthly usage: {Number(detail.quota.used_bytes||0) > 1e9 ? (Number(detail.quota.used_bytes)/1e9).toFixed(2)+' GB' : Number(detail.quota.used_bytes||0) > 1e6 ? (Number(detail.quota.used_bytes)/1e6).toFixed(2)+' MB' : `${Number(detail.quota.used_bytes||0)} B`} of {Number(detail.quota.cap_gb)} GB ({Number(detail.quota.percent||0).toFixed(2)}%) • {detail.quota.over_cap ? <span className="text-danger">Over cap</span> : <span className="text-success">Within cap</span>}{detail.quota.fup_speed_mbps ? ` • FUP ${detail.quota.fup_speed_mbps} Mbps` : ''}</div>
                          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className={`${detail.quota.over_cap?'bg-danger':'bg-teal'} h-full`} style={{width:`${Math.min(100,Number(detail.quota.percent||0))}%`}}/></div>
                        </div>
                      ) : <div>Quota: not configured for this package.</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={fupBusy} onClick={()=>fupAction('evaluate')} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50 disabled:opacity-50">Evaluate</button>
                      <button disabled={fupBusy} onClick={()=>fupAction('clear')} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-success/30 text-success hover:bg-success/10 disabled:opacity-50">Clear FUP</button>
                      <button disabled={fupBusy} onClick={()=>fupAction('apply')} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-warning/30 text-warning hover:bg-warning/10 disabled:opacity-50">Force Apply</button>
                      <button disabled={fupBusy} onClick={toggleFupExempt} className={`text-[11px] px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${detail.fup_exempt ? 'border-purple/30 text-purple hover:bg-purple/10' : 'border-border hover:bg-muted/50'}`}>{detail.fup_exempt ? 'Remove Exemption' : 'Mark Exempt'}</button>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-2">Best-effort: RADIUS/CoA and direct PPPoE profile throttling (ROUTER mode) with session refresh. Billing restrictions take precedence.</div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold mb-1">Recent FUP actions</div>
                      <div className="space-y-1.5 max-h-[140px] overflow-auto">
                        {fupLogs.slice(0,6).map((l:any)=>(
                          <div key={l.id} className="text-[11px] p-2 rounded-lg border border-border bg-muted/20 flex items-center justify-between gap-2">
                            <div className="min-w-0"><div><span className={`font-semibold ${l.action==='APPLIED'?'text-warning':'text-success'}`}>{l.action}</span> • {Number(l.used_bytes||0)>1e9?(Number(l.used_bytes)/1e9).toFixed(2)+' GB':Number(l.used_bytes||0)>1e6?(Number(l.used_bytes)/1e6).toFixed(2)+' MB':`${Number(l.used_bytes||0)} B`} / {l.cap_gb!=null?Number(l.cap_gb)+' GB':'-'} {l.fup_speed_mbps?`• FUP ${l.fup_speed_mbps} Mbps`:''}</div>{l.details?.reason && <div className="text-muted-foreground truncate">Reason: {String(l.details.reason)}</div>}</div>
                            <div className="text-muted-foreground whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString() : ''}</div>
                          </div>
                        ))}
                        {!fupLogs.length && <div className="text-[11px] text-muted-foreground">No FUP enforcement history for this subscriber.</div>}
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <div className="font-semibold text-sm flex items-center gap-2 mb-2"><FileText className="w-4 h-4 text-primary"/>KYC Documents
                      <Link href="/kyc-review" className="text-[11px] font-normal text-primary hover:underline ml-auto">Review queue →</Link>
                    </div>
                    {kycProfile && <div className="text-[11px] text-muted-foreground mb-2">Profile: <span className="font-semibold text-foreground">{String(kycProfile.overall_status || 'INCOMPLETE').replaceAll('_', ' ')}</span> · {kycProfile.service_type || 'FIXED_BROADBAND'} · lawful basis {kycProfile.lawful_basis || 'CONTRACT'}</div>}
                    <div className="space-y-2">
                      {(detail.kyc_documents || []).length === 0 ? <div className="text-xs text-muted-foreground">No KYC documents uploaded.</div> :
                        detail.kyc_documents.map((d: any) => {
                          const tone = d.status === 'APPROVED' ? 'badge-success' : d.status === 'REJECTED' ? 'badge-danger' : d.status === 'EXPIRED' ? 'badge-secondary' : d.status === 'UNDER_REVIEW' ? 'badge-info' : 'badge-warning';
                          return (
                            <div key={d.id} className="p-2 rounded-lg border border-border" data-testid={`subscriber-kyc-${d.id}`}>
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <button onClick={() => viewKyc(d.id)} className="text-left hover:text-primary"><span className="font-medium">{d.doc_type}</span> — {d.file_name}</button>
                                <span className={`badge ${tone}`}>{String(d.status || 'PENDING').replaceAll('_', ' ')}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-1">
                                Uploaded {d.uploaded_at ? new Date(d.uploaded_at).toLocaleString() : '—'} · Expires {d.expires_at ? new Date(d.expires_at).toLocaleDateString() : '—'}
                                {d.reviewed_by_name ? ` · Reviewed by ${d.reviewed_by_name}` : ''}
                              </div>
                              {d.rejection_reason && <div className="text-[11px] text-danger mt-1">Reason: {d.rejection_reason}</div>}
                              {d.checksum && <div className="text-[10px] mono text-muted-foreground truncate" title={d.checksum}>SHA-256 {String(d.checksum).slice(0, 16)}…</div>}
                              {canReviewKyc && <div className="flex gap-1 mt-2 flex-wrap">
                                <button className="btn btn-outline btn-sm" disabled={d.status === 'APPROVED'} onClick={() => void decideKyc(d.id, 'APPROVE')}>Approve</button>
                                <button className="btn btn-outline btn-sm" onClick={() => void decideKyc(d.id, 'REQUEST_RESUBMISSION')}>Resubmit</button>
                                <button className="btn btn-outline btn-sm" onClick={() => void decideKyc(d.id, 'REJECT')}>Reject</button>
                              </div>}
                            </div>
                          );
                        })}
                    </div>
                    <div className="mt-3 p-3 rounded-xl bg-muted/30 border border-border space-y-2">
                      <div className="text-xs font-semibold flex items-center gap-2"><Upload className="w-3.5 h-3.5"/>Upload KYC</div>
                      <div className="flex gap-2">
                        <select id="kyc-type" className="form-select !w-auto min-w-[92px] !h-8 !text-[11px]" defaultValue="NID">{['NID','PASSPORT','CONTRACT','PHOTO','UTILITY_BILL','TRADE_LICENSE','OTHER'].map(t=><option key={t} value={t}>{t}</option>)}</select>
                        <input type="file" className="text-xs flex-1" onChange={e=>{ const f=e.target.files?.[0]; const t=(document.getElementById('kyc-type') as HTMLSelectElement)?.value || 'OTHER'; if(f){ uploadKyc(f,t); e.currentTarget.value=''; } }} disabled={kycUploading} />
                      </div>
                      {kycUploading && <div className="text-xs text-muted-foreground">Uploading...</div>}
                      <div className="text-[10px] text-muted-foreground">PNG, JPEG, WebP, GIF or PDF only. Files are content-checked, checksummed and access-controlled. Identity numbers are masked.</div>
                    </div>
                  </div>
                </>
              )}

              {detailTab === 'equipment' && (
                <div className="pt-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-primary"/>Assigned Equipment</div>
                    <button onClick={() => setShowEquipModal(true)} className="btn btn-primary btn-sm inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5"/>Assign Equipment</button>
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
                            <span className={`badge ${
                              eq.status === 'INSTALLED' ? 'badge-success' :
                              eq.status === 'ASSIGNED' ? 'badge-info' :
                              eq.status === 'FAULTY' ? 'badge-danger' :
                              eq.status === 'RMA' ? 'badge-warning' :
                              'badge-secondary'
                            }`}>{eq.status}</span>
                            <button onClick={() => setEditEquip(eq)} className="p-1.5 rounded hover:bg-muted"><Pencil className="w-3.5 h-3.5"/></button>
                            <button onClick={() => removeEquip(eq.id)} className="p-1.5 rounded hover:bg-danger/10 text-danger"><Trash2 className="w-3.5 h-3.5"/></button>
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
                              <span className={`badge ${
                                c.channel === 'CALL' ? 'badge-success' :
                                c.channel === 'WHATSAPP' ? 'badge-success' :
                                c.channel === 'EMAIL' ? 'badge-info' :
                                c.channel === 'SMS' ? 'badge-purple' :
                                'badge-secondary'
                              }`}>{c.channel}</span>
                              <span className={`badge ${
                                c.direction === 'INBOUND' ? 'badge-info' :
                                'badge-success'
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
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <SubscriberFormWizard
          initial={editing}
          token={token}
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl card max-h-[90vh] flex flex-col">
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
                        <div className={`p-2 rounded-lg ${importPreview.valid > 0 ? 'bg-success/10 border-success/20' : 'bg-danger/10 border-danger/20'} border`}>
                          <div className="text-xs text-muted-foreground">Total Rows</div>
                          <div className="text-xl font-black">{importPreview.total}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-success/10 border border-success/20">
                          <div className="text-xs text-muted-foreground">Valid</div>
                          <div className="text-xl font-black text-success">{importPreview.valid}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-danger/10 border border-danger/20">
                          <div className="text-xs text-muted-foreground">Invalid</div>
                          <div className="text-xl font-black text-danger">{importPreview.invalid}</div>
                        </div>
                      </div>
                      <button onClick={()=>{ setImportPreview(null); setImportFile(null); }} className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted">Change File</button>
                    </div>

                    {importPreview.errors?.length > 0 && (
                      <div className="p-3 rounded-xl border border-danger/30 bg-danger/10">
                        <div className="text-xs font-semibold text-danger mb-2">Validation Errors (first 50)</div>
                        <div className="space-y-1 max-h-40 overflow-auto text-[11px] text-danger">
                          {importPreview.errors.slice(0, 50).map((e: string, i: number) => <div key={i} className="truncate">{e}</div>)}
                        </div>
                      </div>
                    )}

                    <div className="p-3 rounded-xl border border-border bg-muted/20">
                      <div className="text-xs font-semibold mb-2">Preview (first 100 rows)</div>
                      <div className="table-wrap max-h-80 overflow-auto">
                        <table className="table table-hover text-xs">
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
                                <td className="px-2 py-1">{p.valid ? <CheckCircle className="w-4 h-4 text-success"/> : <AlertCircle className="w-4 h-4 text-danger"/>}</td>
                                <td className="px-2 py-1">{p.data?.full_name || '-'}</td>
                                <td className="px-2 py-1">{p.data?.username || '-'}</td>
                                <td className="px-2 py-1">{p.data?.package_name || '-'}</td>
                                <td className="px-2 py-1">{p.data?.area_id || '-'}</td>
                                <td className="px-2 py-1">{p.data?.provisioning_mode || '-'}</td>
                                <td className="px-2 py-1 text-danger truncate max-w-xs">{p.errors?.join('; ') || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button onClick={()=>{ setImportPreview(null); setImportFile(null); }} className="px-4 py-2 rounded-xl border border-border">Back</button>
                      <button onClick={handleImportExecute} disabled={importLoading || !importFile} className="btn btn-primary disabled:opacity-50">
                        {importLoading ? 'Importing...' : 'Execute Import'}
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">Router (API/REST)</div>
                      <select className="form-control w-full" value={mtImportRouterId} onChange={e=>{ setMtImportRouterId(e.target.value); resetMtImport(); }}>
                        <option value="">Select router</option>
                        {routers.filter((r:any)=>['API','REST'].includes(String(r.integration_mode||'').toUpperCase())).map((r:any)=> <option key={r.id} value={r.id}>{r.name} ({r.host})</option>)}
                      </select>
                    </label>
                    <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">User Type</div>
                      <select className="form-control w-full" value={mtImportType} onChange={e=>{ setMtImportType(e.target.value as any); resetMtImport(); }}>
                        <option value="ppp-secrets">PPPoE Users (PPP Secrets)</option>
                        <option value="hotspot-users">Hotspot Users</option>
                      </select>
                    </label>
                    <div className="flex items-end gap-2">
                      <button onClick={fetchMtImportPreview} disabled={importLoading || !mtImportRouterId} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${importLoading?'animate-spin':''}`}/>{importLoading?'Fetching...':'Fetch Users'}</button>
                      <button onClick={runMtImport} disabled={importLoading || !mtImportItems.length} className="btn btn-primary"><Download className="w-4 h-4"/>Import Selected</button>
                    </div>
                  </div>
                  {mtImportMsg && <div className="p-3 rounded-xl border border-success/30 bg-success/10 text-success text-sm">{mtImportMsg}</div>}
                  <div className="text-xs text-muted-foreground">Imports selected MikroTik users as IzanDesk subscribers (auto client code, assigned to this router as ROUTER provisioning). PPP profile names are matched to existing bandwidth package names/profile names when possible. Existing usernames are detected and unchecked by default.</div>

                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border text-xs">
                      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={mtImportItems.length>0 && mtImportItems.every(i=>mtImportSelected[i.name])} onChange={e=>{ const checked=e.target.checked; const sel:Record<string,boolean>={}; for(const it of mtImportItems) sel[it.name]=checked; setMtImportSelected(sel); }} /> Select all</label>
                      <span className="text-muted-foreground">{Object.values(mtImportSelected).filter(Boolean).length} selected / {mtImportItems.length} fetched</span>
                    </div>
                    <div className="max-h-[360px] overflow-auto">
                      <table className="table table-hover text-xs">
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
                                {it.disabled ? <span className="badge badge-warning">disabled</span> : <span className="badge badge-success">enabled</span>}
                                {it.exists ? <span className="badge badge-info">exists</span> : <span className="badge badge-secondary">new</span>}
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
          <div className="w-full max-w-md card">
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
                <button onClick={saveEquip} className="btn btn-primary">{editEquip ? 'Save Changes' : 'Assign Equipment'}</button>
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
function Input({ label, value, onChange, type='text', placeholder='' }: { label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} className="form-control w-full text-foreground outline-none focus:border-primary/50" />
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: any; onChange: (v: string) => void; options: any[] }) {
  const opts = options.map((o: any) => typeof o === 'string' ? {v:o,l:o} : o);
  return (
    <label className="block">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)} className="form-control w-full text-foreground outline-none focus:border-primary/50">
        {opts.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
