'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { MapPin, Route, Plus, RefreshCw, X, Box, LocateFixed } from 'lucide-react';

const GisMap = dynamic(() => import('./gis-map'), { ssr: false, loading: () => <div className="h-[600px] card flex items-center justify-center text-muted-foreground">Loading map...</div> });

export default function GisPage() {
  const { token, user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [boxesList, setBoxesList] = useState<any[]>([]);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'none'|'add-box'|'add-route'|'trace'>('none');
  const [picked, setPicked] = useState<{lat:number,lng:number}|null>(null);
  const [draftPoints, setDraftPoints] = useState<[number,number][]>([]);
  const [form, setForm] = useState<any>({});

  const load = useCallback(async () => {
    if (!token || user?.role === 'RESELLER') return;
    setLoading(true); setError(null);
    try {
      const [g, z, b, s] = await Promise.all([
        apiFetch<any>('/api/gis/overview', {}, token),
        apiFetch<{data:any[]}>('/api/topology/zones', {}, token),
        apiFetch<{data:any[]}>('/api/topology/boxes', {}, token),
        apiFetch<{data:any[]}>('/api/subscribers?limit=200', {}, token),
      ]);
      setData(g); setZones(z.data||[]); setBoxesList(b.data||[]); setSubscribers(s.data||[]);
    } catch(e:any){ setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const onPick = (lat:number,lng:number) => {
    setPicked({lat,lng});
    if (mode === 'add-box') setForm((f:any)=>({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
    if (mode === 'add-route' || mode === 'trace') setDraftPoints(p => [...p, [lat,lng]]);
  };

  const createBox = async () => {
    if (!token) return;
    try {
      await apiFetch('/api/topology/boxes', { method:'POST', body: JSON.stringify(form) }, token);
      setMode('none'); setForm({}); setPicked(null); await load();
    } catch(e:any){ setError(e.message); }
  };

  const createRoute = async () => {
    if (!token) return;
    try {
      const path = draftPoints.map(([lat,lng]) => [lng,lat]);
      const payload = { ...form, path: path.length >= 2 ? path : undefined };
      await apiFetch('/api/topology/fiber-routes', { method:'POST', body: JSON.stringify(payload) }, token);
      setMode('none'); setForm({}); setDraftPoints([]); await load();
    } catch(e:any){ setError(e.message); }
  };

  const traceToSubscriber = async () => {
    if (!token || !form.from_box_id || !form.subscriber_id) return setError('Select source box and subscriber');
    const sub = subscribers.find(s=>s.id===form.subscriber_id);
    const box = boxesList.find(b=>b.id===form.from_box_id);
    if (!sub || !box) return setError('Box or subscriber not found');
    const points: [number,number][] = [];
    if (box.latitude && box.longitude) points.push([Number(box.longitude), Number(box.latitude)]);
    if (draftPoints.length) points.push(...draftPoints.map(([lat,lng]) => [lng,lat] as [number,number]));
    if (sub.longitude && sub.latitude) points.push([Number(sub.longitude), Number(sub.latitude)]);
    if (points.length < 2) return setError('Need coordinates for box and subscriber (or draw path points)');
    try {
      await apiFetch('/api/topology/fiber-routes', { method:'POST', body: JSON.stringify({ name: form.name || `Trace ${box.code||box.name} -> ${sub.client_code}`, route_type: 'DROP_FIBER', from_box_id: box.id, to_box_id: null, path: points, notes: `Traced to subscriber ${sub.client_code}` }) }, token);
      setMode('none'); setForm({}); setDraftPoints([]); await load();
    } catch(e:any){ setError(e.message); }
  };

  const boxCount = data?.boxes?.features?.length || 0;
  const subCount = data?.subscribers?.features?.length || 0;
  const routeCount = data?.fiberRoutes?.features?.length || 0;

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
          <h1 className="page-title">Fiber GIS Map & Topology</h1>
          <p className="text-sm text-muted-foreground">PostGIS-backed subscriber pins, distribution boxes, and fiber route tracing. {subCount} subscribers • {boxCount} boxes • {routeCount} routes</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="btn btn-outline inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={()=>{setMode('add-box'); setForm({name:'', code:'', box_type:'TJ', capacity_ports:8, zone_id: zones[0]?.id || '', latitude:'', longitude:'', address:''}); setPicked(null);}} className="btn btn-primary"><Plus className="w-4 h-4"/>Add Distribution Box</button>
          <button onClick={()=>{setMode('add-route'); setForm({name:'', route_type:'FIBER', from_box_id:'', to_box_id:''}); setDraftPoints([]);}} className="px-3 py-2 rounded-xl border border-primary/40 text-primary text-sm font-semibold inline-flex items-center gap-2"><Route className="w-4 h-4"/>Draw Fiber Route</button>
          <button onClick={()=>{setMode('trace'); setForm({name:'', from_box_id:'', subscriber_id:''}); setDraftPoints([]);}} className="px-3 py-2 rounded-xl border border-cyan-500/40 text-cyan-400 text-sm font-semibold inline-flex items-center gap-2"><LocateFixed className="w-4 h-4"/>Trace to Subscriber</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 h-[650px] card overflow-hidden">
          <GisMap data={data} onPick={(mode!=='none')?onPick:undefined} draftLine={draftPoints} />
        </div>
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-bold mb-2">Map Layers & Legend</h3>
            <div className="text-sm space-y-2 text-muted-foreground">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-blue-500 inline-block"></span> Distribution Boxes (TJ/Splitter) — click for details</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span> Active subscribers</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span> Suspended subscribers</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span> Pending/Other subscribers</div>
              <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-cyan-400 inline-block"></span> Fiber routes / traces</div>
              {mode !== 'none' && <div className="mt-2 p-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs">Map click mode: {mode === 'add-box' ? 'pick box location' : 'add route/trace points'} {picked ? `• picked ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}` : ''}</div>}
            </div>
          </div>

          {mode === 'add-box' && (
            <Panel title="Add Distribution Box" onClose={()=>{setMode('none'); setPicked(null);}}>
              <div className="text-xs text-muted-foreground mb-2">Click on the map to set latitude/longitude.</div>
              <div className="space-y-2">
                <Inp label="Name" value={form.name||''} onChange={v=>setForm({...form,name:v})} />
                <Inp label="Code" value={form.code||''} onChange={v=>setForm({...form,code:v})} />
                <Sel label="Zone" value={form.zone_id||''} onChange={v=>setForm({...form,zone_id:v})} options={[{v:'',l:'Select zone'}, ...zones.map(z=>({v:z.id,l:`${z.area_name} / ${z.name}`}))]} />
                <Sel label="Type" value={form.box_type||'TJ'} onChange={v=>setForm({...form,box_type:v})} options={['TJ','Splitter','FAT','FDB','Closure']} />
                <Inp label="Capacity Ports" value={form.capacity_ports||8} onChange={v=>setForm({...form,capacity_ports:Number(v)})} type="number" />
                <div className="grid grid-cols-2 gap-2"><Inp label="Latitude" value={form.latitude||''} onChange={v=>setForm({...form,latitude:v})} /><Inp label="Longitude" value={form.longitude||''} onChange={v=>setForm({...form,longitude:v})} /></div>
                <Inp label="Address" value={form.address||''} onChange={v=>setForm({...form,address:v})} />
                <button onClick={createBox} className="w-full mt-2 btn btn-primary">Save Distribution Box</button>
              </div>
            </Panel>
          )}

          {mode === 'add-route' && (
            <Panel title="Draw Fiber Route" onClose={()=>{setMode('none'); setDraftPoints([]);}}>
              <div className="text-xs text-muted-foreground mb-2">Click map to add path points ({draftPoints.length} points). Select from/to boxes for topology link.</div>
              <div className="space-y-2">
                <Inp label="Route Name" value={form.name||''} onChange={v=>setForm({...form,name:v})} />
                <Sel label="From Box" value={form.from_box_id||''} onChange={v=>setForm({...form,from_box_id:v})} options={[{v:'',l:'None'}, ...boxesList.map(b=>({v:b.id,l:b.name}))]} />
                <Sel label="To Box" value={form.to_box_id||''} onChange={v=>setForm({...form,to_box_id:v})} options={[{v:'',l:'None'}, ...boxesList.map(b=>({v:b.id,l:b.name}))]} />
                <div className="flex gap-2">
                  <button onClick={()=>setDraftPoints(p=>p.slice(0,-1))} className="px-3 py-2 rounded-xl border border-border text-xs">Undo point</button>
                  <button onClick={()=>setDraftPoints([])} className="px-3 py-2 rounded-xl border border-border text-xs">Clear points</button>
                </div>
                <button onClick={createRoute} disabled={draftPoints.length<2 || !form.name} className="w-full mt-2 btn btn-primary disabled:opacity-50">Save Fiber Route</button>
              </div>
            </Panel>
          )}

          {mode === 'trace' && (
            <Panel title="Trace Fiber Line to Subscriber" onClose={()=>{setMode('none'); setDraftPoints([]);}}>
              <div className="text-xs text-muted-foreground mb-2">Select source box and subscriber. Optionally click map to add intermediate path points; subscriber/box coordinates are used as endpoints when available.</div>
              <div className="space-y-2">
                <Inp label="Trace Name (optional)" value={form.name||''} onChange={v=>setForm({...form,name:v})} />
                <Sel label="From Distribution Box" value={form.from_box_id||''} onChange={v=>setForm({...form,from_box_id:v})} options={[{v:'',l:'Select box'}, ...boxesList.map(b=>({v:b.id,l:b.name}))]} />
                <Sel label="Subscriber (residence)" value={form.subscriber_id||''} onChange={v=>setForm({...form,subscriber_id:v})} options={[{v:'',l:'Select subscriber'}, ...subscribers.map(s=>({v:s.id,l:`${s.full_name} (${s.client_code})`}))]} />
                <div className="flex gap-2"><button onClick={()=>setDraftPoints(p=>p.slice(0,-1))} className="px-3 py-2 rounded-xl border border-border text-xs">Undo</button><button onClick={()=>setDraftPoints([])} className="px-3 py-2 rounded-xl border border-border text-xs">Clear</button></div>
                <button onClick={traceToSubscriber} className="w-full mt-2 px-4 py-2 rounded-xl bg-cyan-600 text-white font-semibold">Create Trace</button>
              </div>
            </Panel>
          )}

          {mode === 'none' && (
            <div className="card p-4 space-y-3">
              <h3 className="font-bold flex items-center gap-2"><Box className="w-4 h-4 text-primary"/>Topology Summary</h3>
              <div className="text-sm text-muted-foreground">Areas/Zones: {new Set(zones.map(z=>z.area_id)).size} / {zones.length}</div>
              <div className="text-sm text-muted-foreground">Distribution boxes: {boxesList.length}</div>
              <div className="text-sm text-muted-foreground">Mapped subscribers (with geo): {subCount}</div>
              <div className="text-sm text-muted-foreground">Fiber routes/traces: {routeCount}</div>
              <div className="text-xs text-muted-foreground pt-2 border-t border-border">Use "Add Distribution Box" then click map to place it. Use "Trace to Subscriber" to draw a fiber line from a box to a subscriber residence.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({title,onClose,children}: {title:string;onClose:()=>void;children:React.ReactNode}){ return <div className="card p-4"><div className="flex items-center justify-between mb-3"><h3 className="font-bold">{title}</h3><button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4"/></button></div>{children}</div>; }
function Inp({label,value,onChange,type='text'}: {label:string;value:any;onChange:(v:string)=>void;type?:string}){ return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div><input type={type} value={value} onChange={e=>onChange(e.target.value)} className="w-full btn btn-outline text-foreground"/></label>; }
function Sel({label,value,onChange,options}: {label:string;value:any;onChange:(v:string)=>void;options:any[]}){ return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div><select value={value} onChange={e=>onChange(e.target.value)} className="w-full btn btn-outline text-foreground">{options.map((o:any)=><option key={o.v} value={o.v}>{o.l}</option>)}</select></label>; }
