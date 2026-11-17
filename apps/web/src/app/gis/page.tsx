'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import {
  MapPin, Route, Plus, RefreshCw, X, Box, LocateFixed, Search, Maximize2,
  Download, Pencil, Trash2, Layers, Building2, Users, Network, Info, CheckCircle2,
} from 'lucide-react';

const GisMap = dynamic(() => import('./gis-map'), { ssr: false, loading: () => <div className="h-[650px] card flex items-center justify-center text-muted-foreground">Loading map...</div> });

type Mode = 'none' | 'add-box' | 'edit-box' | 'delete-box' | 'add-route' | 'edit-route' | 'delete-route' | 'trace' | 'manage' | 'details';

export default function GisPage() {
  const { token, user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [boxesList, setBoxesList] = useState<any[]>([]);
  const [routesList, setRoutesList] = useState<any[]>([]);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('none');
  const [form, setForm] = useState<any>({});
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const [layers, setLayers] = useState<Record<string, boolean>>({ boxes: true, routes: true, status_active: true, status_suspended: true, status_other: true });
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; key: number } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [locateKey, setLocateKey] = useState(0);
  const [details, setDetails] = useState<any>(null);
  const [areaName, setAreaName] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [zoneArea, setZoneArea] = useState('');

  const load = useCallback(async () => {
    if (!token || user?.role === 'RESELLER') return;
    setLoading(true); setError(null);
    try {
      const [g, a, z, b, r, s] = await Promise.all([
        apiFetch<any>('/api/gis/overview', {}, token),
        apiFetch<{ data: any[] }>('/api/topology/areas', {}, token),
        apiFetch<{ data: any[] }>('/api/topology/zones', {}, token),
        apiFetch<{ data: any[] }>('/api/topology/boxes', {}, token),
        apiFetch<{ data: any[] }>('/api/topology/fiber-routes', {}, token),
        apiFetch<{ data: any[] }>('/api/subscribers?limit=200', {}, token),
      ]);
      setData(g); setAreas(a.data || []); setZones(z.data || []);
      setBoxesList(b.data || []); setRoutesList(r.data || []); setSubscribers(s.data || []);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token, user]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setNotice(msg); setError(null); };
  const fail = (e: any) => { setError(e.message || String(e)); setNotice(null); };
  const endMode = () => { setMode('none'); setForm({}); setPicked(null); setDraftPoints([]); setDetails(null); };
  const flyTo = (lat: number, lng: number, zoom = 16) => setFocus({ lat, lng, zoom, key: Date.now() + Math.random() });

  const boxCount = data?.boxes?.features?.length || 0;
  const subCount = data?.subscribers?.features?.length || 0;
  const routeCount = data?.fiberRoutes?.features?.length || 0;
  const summary = data?.summary || {};

  const onPick = (lat: number, lng: number) => {
    setPicked({ lat, lng });
    if (mode === 'add-box' || mode === 'edit-box') setForm((f: any) => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
    if (['add-route', 'edit-route', 'trace'].includes(mode)) setDraftPoints(p => [...p, [lat, lng]]);
  };

  // ----- Distribution boxes -----
  const openNewBox = () => { setForm({ name: '', code: '', zone_id: zones[0]?.id || '', box_type: 'TJ', capacity_ports: 8, latitude: '', longitude: '', address: '', notes: '' }); setPicked(null); setMode('add-box'); setNotice(null); };
  const saveBox = async () => {
    try {
      if (!form.name?.trim()) throw new Error('Name is required');
      const payload = { ...form, capacity_ports: Number(form.capacity_ports) || 8 };
      if (form.id) await apiFetch(`/api/topology/boxes/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      else await apiFetch('/api/topology/boxes', { method: 'POST', body: JSON.stringify(payload) }, token);
      flash(form.id ? 'Distribution box updated' : 'Distribution box created');
      endMode(); await load();
    } catch (e: any) { fail(e); }
  };
  const removeBox = async (id: string) => {
    if (!window.confirm('Delete this distribution box? Attached subscribers will be unlinked.')) return;
    try { await apiFetch(`/api/topology/boxes/${id}`, { method: 'DELETE' }, token); flash('Distribution box deleted'); endMode(); await load(); }
    catch (e: any) { fail(e); }
  };
  const handleBoxAction = async (id: string, action: 'details' | 'edit' | 'delete') => {
    const b = boxesList.find(x => x.id === id);
    if (action === 'details') {
      try {
        const d = await apiFetch<any>(`/api/gis/boxes/${id}/details`, {}, token);
        setDetails(d); setMode('details');
        if (b?.latitude && b?.longitude) flyTo(Number(b.latitude), Number(b.longitude), 17);
      } catch (e: any) { fail(e); }
      return;
    }
    if (action === 'edit') {
      setForm({ ...b }); setPicked(b?.latitude && b?.longitude ? { lat: Number(b.latitude), lng: Number(b.longitude) } : null);
      setMode('edit-box'); flyTo(Number(b.latitude), Number(b.longitude), 16); return;
    }
    setForm({ id, name: b?.name || '' }); setMode('delete-box');
  };
  const handleBoxMove = async (id: string, lat: number, lng: number) => {
    const b = boxesList.find(x => x.id === id); if (!b) return;
    try {
      await apiFetch(`/api/topology/boxes/${id}`, { method: 'PUT', body: JSON.stringify({ ...b, latitude: lat, longitude: lng }) }, token);
      flash(`Moved ${b.name} to ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      await load();
    } catch (e: any) { fail(e); }
  };

  // ----- Fiber routes -----
  const routePayload = () => {
    const path = draftPoints.map(([lat, lng]) => [lng, lat]);
    return { ...form, path: path.length >= 2 ? path : undefined };
  };
  const openNewRoute = () => { setForm({ name: '', route_type: 'FIBER', from_box_id: '', to_box_id: '', notes: '' }); setDraftPoints([]); setMode('add-route'); setNotice(null); };
  const openEditRoute = (r: any) => {
    let coords: [number, number][] = [];
    try { if (r.path_geojson) coords = JSON.parse(r.path_geojson).coordinates.map(([lng, lat]: any) => [lat, lng] as [number, number]); } catch {}
    setDraftPoints(coords);
    setForm({ id: r.id, name: r.name, route_type: r.route_type, from_box_id: r.from_box_id || '', to_box_id: r.to_box_id || '', notes: r.notes || '' });
    setMode('edit-route');
    if (coords.length) flyTo(coords[0][0], coords[0][1], 15);
  };
  const saveRoute = async () => {
    try {
      if (!form.name?.trim()) throw new Error('Route name is required');
      if (draftPoints.length < 2) throw new Error('Click the map to add at least 2 path points');
      const payload = routePayload();
      if (form.id) await apiFetch(`/api/topology/fiber-routes/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      else await apiFetch('/api/topology/fiber-routes', { method: 'POST', body: JSON.stringify(payload) }, token);
      flash(form.id ? 'Fiber route updated' : 'Fiber route saved');
      endMode(); await load();
    } catch (e: any) { fail(e); }
  };
  const removeRoute = async (id: string) => {
    if (!window.confirm('Delete this fiber route?')) return;
    try { await apiFetch(`/api/topology/fiber-routes/${id}`, { method: 'DELETE' }, token); flash('Fiber route deleted'); endMode(); await load(); }
    catch (e: any) { fail(e); }
  };
  const traceToSubscriber = async () => {
    if (!form.from_box_id || !form.subscriber_id) return fail(new Error('Select a source box and a subscriber'));
    const sub = subscribers.find(s => s.id === form.subscriber_id);
    const box = boxesList.find(b => b.id === form.from_box_id);
    if (!sub || !box) return fail(new Error('Box or subscriber not found'));
    const points: [number, number][] = [];
    if (box.latitude && box.longitude) points.push([Number(box.longitude), Number(box.latitude)]);
    points.push(...draftPoints.map(([lat, lng]) => [lng, lat] as [number, number]));
    if (sub.longitude && sub.latitude) points.push([Number(sub.longitude), Number(sub.latitude)]);
    if (points.length < 2) return fail(new Error('Box and subscriber need coordinates (or add path points)'));
    try {
      await apiFetch('/api/topology/fiber-routes', { method: 'POST', body: JSON.stringify({
        name: form.name || `Trace ${box.code || box.name} → ${sub.client_code}`,
        route_type: 'DROP_FIBER', from_box_id: box.id, to_box_id: null, path: points,
        notes: `Traced to subscriber ${sub.client_code}`,
      }) }, token);
      flash('Subscriber fiber trace saved'); endMode(); await load();
    } catch (e: any) { fail(e); }
  };
  const traceFromPin = (subscriberId: string) => {
    setForm({ name: '', from_box_id: '', subscriber_id: subscriberId }); setDraftPoints([]);
    setMode('trace'); setNotice(null);
    const sub = subscribers.find(s => s.id === subscriberId);
    if (sub?.latitude && sub?.longitude) flyTo(Number(sub.latitude), Number(sub.longitude), 16);
  };

  // ----- Areas & zones -----
  const saveArea = async () => {
    try { if (!areaName.trim()) throw new Error('Area name is required');
      await apiFetch('/api/topology/areas', { method: 'POST', body: JSON.stringify({ name: areaName }) }, token);
      setAreaName(''); flash('Area created'); await load();
    } catch (e: any) { fail(e); }
  };
  const saveZone = async () => {
    try { if (!zoneName.trim() || !zoneArea) throw new Error('Zone name and area are required');
      await apiFetch('/api/topology/zones', { method: 'POST', body: JSON.stringify({ name: zoneName, area_id: zoneArea }) }, token);
      setZoneName(''); flash('Zone created'); await load();
    } catch (e: any) { fail(e); }
  };
  const removeArea = async (id: string) => {
    if (!window.confirm('Delete this area and its zones?')) return;
    try { await apiFetch(`/api/topology/areas/${id}`, { method: 'DELETE' }, token); flash('Area deleted'); await load(); } catch (e: any) { fail(e); }
  };
  const removeZone = async (id: string) => {
    if (!window.confirm('Delete this zone?')) return;
    try { await apiFetch(`/api/topology/zones/${id}`, { method: 'DELETE' }, token); flash('Zone deleted'); await load(); } catch (e: any) { fail(e); }
  };

  const exportGeoJson = () => {
    const fc = { type: 'FeatureCollection', features: [
      ...(data?.boxes?.features || []), ...(data?.subscribers?.features || []), ...(data?.fiberRoutes?.features || []),
    ] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'izandesk-topology.geojson'; a.click();
    URL.revokeObjectURL(url); flash(`Exported ${fc.features.length} features`);
  };

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    const out: any[] = [];
    for (const b of boxesList) if (`${b.name} ${b.code || ''} ${b.address || ''}`.toLowerCase().includes(q) && b.latitude && b.longitude)
      out.push({ kind: 'Box', id: b.id, label: b.name, sub: `${b.box_type} • ${b.code || ''}`, lat: +b.latitude, lng: +b.longitude });
    for (const s of subscribers) if (`${s.full_name} ${s.client_code} ${s.username || ''}`.toLowerCase().includes(q) && s.latitude && s.longitude)
      out.push({ kind: 'Subscriber', id: s.id, label: s.full_name, sub: `${s.client_code} • ${s.status}`, lat: +s.latitude, lng: +s.longitude });
    for (const r of routesList) if (`${r.name} ${r.notes || ''}`.toLowerCase().includes(q)) {
      try { const c = JSON.parse(r.path_geojson).coordinates[0]; out.push({ kind: 'Route', id: r.id, label: r.name, sub: r.route_type, lat: c[1], lng: c[0] }); } catch {}
    }
    return out.slice(0, 12);
  }, [query, boxesList, subscribers, routesList]);

  // Defense in depth: the API denies resellers, so don't even render the map
  // shell (or fire its requests) when one navigates here directly by URL.
  if (user?.role === 'RESELLER') {
    return (
      <div className="card p-6 space-y-2">
        <h1 className="page-title">Access restricted</h1>
        <p className="text-sm text-muted-foreground">The Fiber GIS Map covers ISP-wide topology and customer locations, and is available to administrators only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Fiber GIS Map &amp; Topology</h1>
          <p className="text-sm text-muted-foreground">PostGIS-backed subscriber pins, distribution boxes and fiber route tracing — {subCount} mapped subscribers • {boxCount} boxes • {routeCount} routes</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { load(); setFitKey(k => k + 1); }} className="btn btn-outline inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button onClick={() => setFitKey(k => k + 1)} className="btn btn-outline inline-flex items-center gap-2"><Maximize2 className="w-4 h-4" />Zoom to fit</button>
          <button onClick={() => setLocateKey(k => k + 1)} className="btn btn-outline inline-flex items-center gap-2"><LocateFixed className="w-4 h-4" />Locate me</button>
          <button onClick={exportGeoJson} className="btn btn-outline inline-flex items-center gap-2"><Download className="w-4 h-4" />Export GeoJSON</button>
          <button onClick={openNewBox} className="btn btn-primary inline-flex items-center gap-2"><Plus className="w-4 h-4" />Add Box</button>
          <button onClick={openNewRoute} className="px-3 py-2 rounded-xl border border-primary/40 text-primary text-sm font-semibold inline-flex items-center gap-2"><Route className="w-4 h-4" />Draw Route</button>
          <button onClick={() => { setForm({ name: '', from_box_id: '', subscriber_id: '' }); setDraftPoints([]); setMode('trace'); }} className="px-3 py-2 rounded-xl border border-cyan-500/40 text-cyan-400 text-sm font-semibold inline-flex items-center gap-2"><LocateFixed className="w-4 h-4" />Trace to Subscriber</button>
          <button onClick={() => { setMode('manage'); setNotice(null); }} className="btn btn-outline inline-flex items-center gap-2"><Building2 className="w-4 h-4" />Areas & Zones</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={<Users className="w-4 h-4" />} label="Subscribers" value={summary.subscribers_total ?? '—'} hint={`${summary.subscribers_geocoded ?? 0} mapped`} />
        <Kpi icon={<MapPin className="w-4 h-4" />} label="Geo coverage" value={`${summary.geocoded_coverage_pct ?? 0}%`} hint="pins / subscribers" />
        <Kpi icon={<Box className="w-4 h-4" />} label="Boxes" value={summary.boxes_total ?? 0} hint={`${summary.boxes_in_use ?? 0} in use`} />
        <Kpi icon={<Network className="w-4 h-4" />} label="Port capacity" value={summary.capacity_ports ?? 0} hint="total ports" />
        <Kpi icon={<Route className="w-4 h-4" />} label="Fiber routes" value={summary.routes_total ?? 0} hint="drawn / traced" />
        <Kpi icon={<Info className="w-4 h-4" />} label="Mapped fiber" value={`${((summary.route_length_m ?? 0) / 1000).toFixed(2)} km`} hint="total length" />
      </div>

      {notice && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{notice}</div>}
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 h-[650px] card overflow-hidden">
          <GisMap
            data={data}
            onPick={['add-box', 'edit-box', 'add-route', 'edit-route', 'trace'].includes(mode) ? onPick : undefined}
            draftLine={draftPoints}
            layers={layers}
            focus={focus}
            fitKey={fitKey}
            locateKey={locateKey}
            selectedBoxId={mode === 'edit-box' || mode === 'details' ? form.id || details?.box?.id : null}
            onBoxMove={handleBoxMove}
            onBoxAction={handleBoxAction}
            onSubscriberAction={traceFromPin}
          />
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search boxes, subscribers, routes…" className="w-full btn btn-outline pl-9 text-foreground" />
            </div>
            {query.trim() && (
              <div className="mt-2 max-h-56 overflow-auto space-y-1">
                {searchResults.length === 0 && <div className="text-xs text-muted-foreground p-2">No matches</div>}
                {searchResults.map((r, i) => (
                  <button key={`${r.kind}-${r.id}-${i}`} onClick={() => flyTo(r.lat, r.lng, 17)} className="w-full text-left p-2 rounded-lg hover:bg-muted text-sm">
                    <div className="font-semibold">{r.label}</div>
                    <div className="text-xs text-muted-foreground">{r.kind} • {r.sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <button onClick={() => setLayers(l => ({ ...l, _open: l._open === false }))} className="w-full flex items-center justify-between font-bold text-sm mb-2">
              <span className="flex items-center gap-2"><Layers className="w-4 h-4 text-primary" />Map layers</span>
              <span className="text-xs text-muted-foreground">{layers._open === false ? 'Show' : 'Hide'}</span>
            </button>
            {layers._open !== false && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Chk label="Boxes" checked={layers.boxes} onChange={v => setLayers(l => ({ ...l, boxes: v }))} color="bg-blue-500" />
                <Chk label="Routes" checked={layers.routes} onChange={v => setLayers(l => ({ ...l, routes: v }))} color="bg-cyan-400" />
                <Chk label="Active subs" checked={layers.status_active} onChange={v => setLayers(l => ({ ...l, status_active: v }))} color="bg-emerald-500" />
                <Chk label="Suspended" checked={layers.status_suspended} onChange={v => setLayers(l => ({ ...l, status_suspended: v }))} color="bg-red-500" />
                <Chk label="Other subs" checked={layers.status_other} onChange={v => setLayers(l => ({ ...l, status_other: v }))} color="bg-amber-500" />
              </div>
            )}
            <div className="text-[11px] text-muted-foreground pt-3 mt-3 border-t border-border">
              Drag a blue box marker to relocate it. Click a box for details, edit or delete.
            </div>
          </div>

          {(mode === 'add-box' || mode === 'edit-box') && (
            <Panel title={`${mode === 'edit-box' ? 'Edit' : 'Add'} Distribution Box`} onClose={endMode}>
              <div className="text-xs text-muted-foreground mb-2">Click the map to set coordinates, or type them below.</div>
              <div className="space-y-2">
                <Inp label="Name" value={form.name || ''} onChange={v => setForm({ ...form, name: v })} />
                <Inp label="Code" value={form.code || ''} onChange={v => setForm({ ...form, code: v })} />
                <Sel label="Zone" value={form.zone_id || ''} onChange={v => setForm({ ...form, zone_id: v })} options={[{ v: '', l: 'Select zone' }, ...zones.map(z => ({ v: z.id, l: `${z.area_name} / ${z.name}` }))]} />
                <Sel label="Type" value={form.box_type || 'TJ'} onChange={v => setForm({ ...form, box_type: v })} options={['TJ', 'Splitter', 'FAT', 'FDB', 'Closure']} />
                <Inp label="Capacity Ports" value={form.capacity_ports ?? 8} onChange={v => setForm({ ...form, capacity_ports: Number(v) })} type="number" />
                <div className="grid grid-cols-2 gap-2"><Inp label="Latitude" value={form.latitude || ''} onChange={v => setForm({ ...form, latitude: v })} /><Inp label="Longitude" value={form.longitude || ''} onChange={v => setForm({ ...form, longitude: v })} /></div>
                <Inp label="Address" value={form.address || ''} onChange={v => setForm({ ...form, address: v })} />
                <Inp label="Notes" value={form.notes || ''} onChange={v => setForm({ ...form, notes: v })} />
                <button onClick={saveBox} className="w-full mt-2 btn btn-primary">Save Distribution Box</button>
              </div>
            </Panel>
          )}

          {mode === 'delete-box' && (
            <Panel title="Delete Distribution Box" onClose={endMode}>
              <p className="text-sm text-muted-foreground">Delete <b>{form.name}</b>? Subscribers attached to it will be unlinked.</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => removeBox(form.id)} className="flex-1 py-2 rounded-xl bg-red-600 text-white font-semibold">Delete</button>
                <button onClick={endMode} className="flex-1 py-2 rounded-xl border border-border font-semibold">Cancel</button>
              </div>
            </Panel>
          )}

          {(mode === 'add-route' || mode === 'edit-route') && (
            <Panel title={`${mode === 'edit-route' ? 'Edit' : 'Draw'} Fiber Route`} onClose={endMode}>
              <div className="text-xs text-muted-foreground mb-2">Click map to add/append path points ({draftPoints.length}). Click a saved route's line to edit it.</div>
              <div className="space-y-2">
                <Inp label="Route Name" value={form.name || ''} onChange={v => setForm({ ...form, name: v })} />
                <Sel label="Route type" value={form.route_type || 'FIBER'} onChange={v => setForm({ ...form, route_type: v })} options={['FIBER', 'DROP_FIBER', 'BACKBONE', 'UPLINK']} />
                <Sel label="From Box" value={form.from_box_id || ''} onChange={v => setForm({ ...form, from_box_id: v })} options={[{ v: '', l: 'None' }, ...boxesList.map(b => ({ v: b.id, l: b.name }))]} />
                <Sel label="To Box" value={form.to_box_id || ''} onChange={v => setForm({ ...form, to_box_id: v })} options={[{ v: '', l: 'None' }, ...boxesList.map(b => ({ v: b.id, l: b.name }))]} />
                <Inp label="Notes" value={form.notes || ''} onChange={v => setForm({ ...form, notes: v })} />
                <div className="flex gap-2">
                  <button onClick={() => setDraftPoints(p => p.slice(0, -1))} className="px-3 py-2 rounded-xl border border-border text-xs">Undo point</button>
                  <button onClick={() => setDraftPoints([])} className="px-3 py-2 rounded-xl border border-border text-xs">Clear points</button>
                </div>
                <button onClick={saveRoute} className="w-full mt-2 btn btn-primary">Save Fiber Route</button>
              </div>
            </Panel>
          )}

          {mode === 'delete-route' && (
            <Panel title="Delete Fiber Route" onClose={endMode}>
              <p className="text-sm text-muted-foreground">Delete <b>{form.name}</b>?</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => removeRoute(form.id)} className="flex-1 py-2 rounded-xl bg-red-600 text-white font-semibold">Delete</button>
                <button onClick={endMode} className="flex-1 py-2 rounded-xl border border-border font-semibold">Cancel</button>
              </div>
            </Panel>
          )}

          {mode === 'trace' && (
            <Panel title="Trace Fiber Line to Subscriber" onClose={endMode}>
              <div className="text-xs text-muted-foreground mb-2">Select a source box and subscriber. Add intermediate points by clicking the map.</div>
              <div className="space-y-2">
                <Inp label="Trace name (optional)" value={form.name || ''} onChange={v => setForm({ ...form, name: v })} />
                <Sel label="From Distribution Box" value={form.from_box_id || ''} onChange={v => setForm({ ...form, from_box_id: v })} options={[{ v: '', l: 'Select box' }, ...boxesList.map(b => ({ v: b.id, l: b.name }))]} />
                <Sel label="Subscriber" value={form.subscriber_id || ''} onChange={v => setForm({ ...form, subscriber_id: v })} options={[{ v: '', l: 'Select subscriber' }, ...subscribers.map(s => ({ v: s.id, l: `${s.full_name} (${s.client_code})` }))]} />
                <div className="flex gap-2"><button onClick={() => setDraftPoints(p => p.slice(0, -1))} className="px-3 py-2 rounded-xl border border-border text-xs">Undo</button><button onClick={() => setDraftPoints([])} className="px-3 py-2 rounded-xl border border-border text-xs">Clear</button></div>
                <button onClick={traceToSubscriber} className="w-full mt-2 px-4 py-2 rounded-xl bg-cyan-600 text-white font-semibold">Create Trace</button>
              </div>
            </Panel>
          )}

          {mode === 'details' && details && (
            <Panel title="Distribution Box Details" onClose={endMode}>
              <div className="text-sm space-y-1 mb-3">
                <div className="font-bold text-base">{details.box.name} <span className="text-muted-foreground text-xs">{details.box.code}</span></div>
                <div className="text-muted-foreground">{details.box.box_type} • {details.box.capacity_ports} ports • {details.box.zone_name || ''} {details.box.area_name ? `, ${details.box.area_name}` : ''}</div>
                <div className="text-muted-foreground">{details.box.address || 'No address'} • {Number(details.box.latitude).toFixed(5)}, {Number(details.box.longitude).toFixed(5)}</div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => handleBoxAction(details.box.id, 'edit')} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold inline-flex items-center gap-1"><Pencil className="w-3 h-3" />Edit</button>
                  <button onClick={() => handleBoxAction(details.box.id, 'delete')} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1"><Trash2 className="w-3 h-3" />Delete</button>
                </div>
              </div>
              <h4 className="font-bold text-xs uppercase tracking-wide text-muted-foreground mt-3">Subscribers ({details.subscribers.length})</h4>
              <div className="max-h-40 overflow-auto mt-1 space-y-1">
                {details.subscribers.length === 0 && <div className="text-xs text-muted-foreground">No subscribers attached</div>}
                {details.subscribers.map((s: any) => <div key={s.id} className="text-sm flex justify-between gap-2 p-1.5 rounded-lg bg-muted/40"><span>{s.full_name} <span className="text-muted-foreground text-xs">{s.client_code}</span></span><span className="text-xs">{s.status}</span></div>)}
              </div>
              <h4 className="font-bold text-xs uppercase tracking-wide text-muted-foreground mt-3">Linked routes ({details.routes.length})</h4>
              <div className="max-h-32 overflow-auto mt-1 space-y-1">
                {details.routes.length === 0 && <div className="text-xs text-muted-foreground">No fiber routes linked</div>}
                {details.routes.map((r: any) => <div key={r.id} className="text-sm flex justify-between gap-2 p-1.5 rounded-lg bg-muted/40"><span>{r.name}</span><span className="text-xs text-muted-foreground">{r.length_m ? `${(r.length_m / 1000).toFixed(2)} km` : r.route_type}</span></div>)}
              </div>
            </Panel>
          )}

          {mode === 'manage' && (
            <Panel title="Areas & Zones" onClose={endMode}>
              <div className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <input value={areaName} onChange={e => setAreaName(e.target.value)} placeholder="New area name" className="flex-1 btn btn-outline text-foreground" />
                  <button onClick={saveArea} className="btn btn-primary">Add</button>
                </div>
                <div className="max-h-28 overflow-auto space-y-1">
                  {areas.map(a => <div key={a.id} className="flex items-center justify-between p-1.5 rounded-lg bg-muted/40"><span>{a.name}</span><button onClick={() => removeArea(a.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button></div>)}
                </div>
                <div className="flex gap-2 pt-2 border-t border-border">
                  <input value={zoneName} onChange={e => setZoneName(e.target.value)} placeholder="New zone name" className="flex-1 btn btn-outline text-foreground" />
                  <select value={zoneArea} onChange={e => setZoneArea(e.target.value)} className="btn btn-outline text-foreground"><option value="">Area…</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  <button onClick={saveZone} className="btn btn-primary">Add</button>
                </div>
                <div className="max-h-28 overflow-auto space-y-1">
                  {zones.map(z => <div key={z.id} className="flex items-center justify-between p-1.5 rounded-lg bg-muted/40"><span>{z.name} <span className="text-xs text-muted-foreground">/ {z.area_name}</span></span><button onClick={() => removeZone(z.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button></div>)}
                </div>
              </div>
            </Panel>
          )}

          {mode === 'none' && (
            <>
              <div className="card p-4">
                <h3 className="font-bold mb-2 flex items-center gap-2"><Box className="w-4 h-4 text-primary" />Distribution boxes <span className="text-xs font-normal text-muted-foreground">({boxesList.length})</span></h3>
                <div className="max-h-48 overflow-auto space-y-1">
                  {boxesList.length === 0 && <div className="text-xs text-muted-foreground">None yet — use “Add Box”.</div>}
                  {boxesList.map(b => (
                    <div key={b.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 text-sm">
                      <button className="text-left flex-1" onClick={() => { if (b.latitude && b.longitude) flyTo(+b.latitude, +b.longitude, 17); handleBoxAction(b.id, 'details'); }}>
                        <div className="font-semibold">{b.name}</div><div className="text-xs text-muted-foreground">{b.box_type} • {b.subscriber_count || 0} subs • {b.zone_name || ''}</div>
                      </button>
                      <button onClick={() => handleBoxAction(b.id, 'edit')} className="text-primary" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleBoxAction(b.id, 'delete')} className="text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card p-4">
                <h3 className="font-bold mb-2 flex items-center gap-2"><Route className="w-4 h-4 text-cyan-400" />Fiber routes <span className="text-xs font-normal text-muted-foreground">({routesList.length})</span></h3>
                <div className="max-h-40 overflow-auto space-y-1">
                  {routesList.length === 0 && <div className="text-xs text-muted-foreground">None yet — use “Draw Route” or trace a subscriber.</div>}
                  {routesList.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 text-sm">
                      <button className="text-left flex-1" onClick={() => openEditRoute(r)}><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.route_type}{r.length_m ? ` • ${(r.length_m / 1000).toFixed(2)} km` : ''}</div></button>
                      <button onClick={() => openEditRoute(r)} className="text-primary" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { setForm({ id: r.id, name: r.name }); setMode('delete-route'); }} className="text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string }) {
  return <div className="card p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div><div className="text-xl font-bold mt-1">{value}</div><div className="text-[11px] text-muted-foreground">{hint}</div></div>;
}
function Chk({ label, checked, onChange, color }: { label: string; checked: boolean; onChange: (v: boolean) => void; color: string }) {
  return <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="accent-primary" /><span className={`w-2.5 h-2.5 rounded ${color} inline-block`} />{label}</label>;
}
function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="card p-4"><div className="flex items-center justify-between mb-3"><h3 className="font-bold">{title}</h3><button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button></div>{children}</div>;
}
function Inp({ label, value, onChange, type = 'text' }: { label: string; value: any; onChange: (v: string) => void; type?: string }) {
  return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div><input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full btn btn-outline text-foreground" /></label>;
}
function Sel({ label, value, onChange, options }: { label: string; value: any; onChange: (v: string) => void; options: any[] }) {
  return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div><select value={value} onChange={e => onChange(e.target.value)} className="w-full btn btn-outline text-foreground">{options.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>;
}
