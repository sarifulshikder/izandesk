'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, Marker as MapLibreMarker, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Single MapLibre map for the whole workbench. One locally hosted style carries
// both basemaps: Esri imagery plus the same OpenFreeMap vector layers the
// streets view uses, so satellite labels have street-view typography/density.
// Point these at internal/self-hosted endpoints for air-gapped deployments.
const BASEMAP_STYLE = process.env.NEXT_PUBLIC_GIS_BASEMAP_STYLE_URL || '/gis-basemap.json';
const SATELLITE_TILE_OVERRIDE = process.env.NEXT_PUBLIC_GIS_SATELLITE_TILE_URL;
const VECTOR_TILE_OVERRIDE = process.env.NEXT_PUBLIC_GIS_VECTOR_TILE_URL;
const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125];
const parseCenter = (): [number, number] => {
  const raw = process.env.NEXT_PUBLIC_GIS_CENTER;
  if (!raw) return DEFAULT_CENTER;
  const [lat, lng] = raw.split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : DEFAULT_CENTER;
};

const STREET_TEXT = '#374151';
const STREET_HALO = 'rgba(255,255,255,0.95)';
const SAT_TEXT = '#ffffff';
const SAT_HALO = 'rgba(0,0,0,0.85)';

const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c] as string));
const actionBtn = (bg: string, label: string, action: string) =>
  `<button data-map-action="${action}" style="background:${bg};color:#fff;border:0;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer;margin-right:6px">${label}</button>`;

export type GisMapStyle = 'streets' | 'satellite';

export interface GisMapProps {
  data: any;
  onPick?: (lat: number, lng: number) => void;
  draftLine?: [number, number][];
  layers?: Record<string, boolean>;
  focus?: { lat: number; lng: number; zoom?: number; key: number } | null;
  fitKey?: number;
  locateKey?: number;
  selectedBoxId?: string | null;
  mapStyle?: GisMapStyle;
  satelliteLabels?: boolean;
  readOnly?: boolean;
  heatmap?: boolean;
  liveSessions?: any[];
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  onBoxMove?: (id: string, lat: number, lng: number) => void;
  onBoxAction?: (id: string, action: 'details' | 'edit' | 'delete') => void;
  onSubscriberAction?: (id: string, action: 'trace') => void;
  onRouteAction?: (id: string, action: 'edit' | 'delete') => void;
  onLocateError?: () => void;
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] } as any;

/** Topology layers are added once the style loads, above the basemap labels. */
function addTopologyLayers(map: MapLibreMap) {
  map.addSource('gis-subscribers-src', { type: 'geojson', data: EMPTY_FC });
  map.addSource('gis-routes-src', { type: 'geojson', data: EMPTY_FC });
  map.addSource('gis-heat-src', { type: 'geojson', data: EMPTY_FC });
  map.addSource('gis-draft-src', { type: 'geojson', data: EMPTY_FC });

  map.addLayer({
    id: 'gis-heat', type: 'heatmap', source: 'gis-heat-src', layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': 1,
      'heatmap-radius': 24,
      'heatmap-opacity': 0.75,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)', 0.2, '#22c55e', 0.5, '#f59e0b', 0.9, '#ef4444'],
    },
  });
  map.addLayer({
    id: 'gis-routes', type: 'line', source: 'gis-routes-src',
    paint: { 'line-color': '#06b6d4', 'line-width': 4, 'line-opacity': 0.85 },
  });
  map.addLayer({
    id: 'gis-draft', type: 'line', source: 'gis-draft-src',
    paint: { 'line-color': '#f59e0b', 'line-width': 4, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: 'gis-subscribers', type: 'circle', source: 'gis-subscribers-src',
    paint: {
      'circle-radius': 6,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
      'circle-color': ['match', ['get', 'status'], 'ACTIVE', '#22c55e', 'SUSPENDED', '#ef4444', '#f59e0b'],
    },
  });
}

function popupWithActions(map: MapLibreMap, lngLat: [number, number], html: string, handlers: Record<string, () => void>) {
  const el = document.createElement('div');
  el.innerHTML = html;
  for (const [action, fn] of Object.entries(handlers)) {
    el.querySelectorAll(`[data-map-action="${action}"]`).forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); }));
  }
  new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(lngLat).setDOMContent(el).addTo(map);
}

export default function GisMap(props: GisMapProps) {
  const {
    data, draftLine, layers, focus, fitKey, locateKey, selectedBoxId,
    mapStyle = 'satellite', satelliteLabels = true, heatmap, liveSessions,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const boxMarkersRef = useRef<{ id: string; marker: MapLibreMarker }[]>([]);
  const liveMarkersRef = useRef<MapLibreMarker[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [ready, setReady] = useState(false);
  const center = useMemo(parseCenter, []);

  const shown = (key: string) => layers?.[key] !== false;
  const boxes: any[] = shown('boxes') ? (data?.boxes?.features || []) : [];
  const subs: any[] = (data?.subscribers?.features || []).filter((f: any) => {
    const s = f.properties?.status;
    if (s === 'ACTIVE') return shown('status_active');
    if (s === 'SUSPENDED') return shown('status_suspended');
    return shown('status_other');
  });
  const routes: any[] = shown('routes') ? (data?.fiberRoutes?.features || []) : [];

  const fitPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    for (const f of data?.boxes?.features || []) pts.push([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    for (const f of data?.subscribers?.features || []) pts.push([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    for (const f of data?.fiberRoutes?.features || []) for (const c of (f.geometry?.coordinates || [])) pts.push([c[1], c[0]]);
    return pts;
  }, [data]);
  const fitPointsRef = useRef(fitPoints);
  fitPointsRef.current = fitPoints;

  // ----- create the map once -----
  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    (async () => {
      let style: any = BASEMAP_STYLE;
      try {
        const res = await fetch(BASEMAP_STYLE);
        if (res.ok) {
          style = await res.json();
          if (SATELLITE_TILE_OVERRIDE && style.sources?.['gis-satellite'])
            style.sources['gis-satellite'].tiles = [SATELLITE_TILE_OVERRIDE];
          if (VECTOR_TILE_OVERRIDE && style.sources?.openmaptiles)
            style.sources.openmaptiles.url = VECTOR_TILE_OVERRIDE;
        }
      } catch {}
      if (cancelled || !containerRef.current) return;

      map = new maplibregl.Map({
        // Leaflet uses [lat, lng]; MapLibre uses GeoJSON order [lng, lat].
        container: containerRef.current, style, center: [center[1], center[0]], zoom: 12, maxZoom: 19,
      });
      mapRef.current = map;
      (window as any).__gisMap = map; // read-only E2E/debug handle
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

      // The local style is ready well before remote tiles finish loading.
      // Gate topology layers and UI readiness on style.load so map controls
      // stay actionable even when tile requests are slow or blocked.
      map.on('style.load', () => {
        const m = map!;
        addTopologyLayers(m);

        m.on('moveend', () => {
          const b = m.getBounds();
          propsRef.current.onBoundsChange?.([
            +b.getWest().toFixed(4), +b.getSouth().toFixed(4),
            +b.getEast().toFixed(4), +b.getNorth().toFixed(4),
          ]);
        });
        m.on('click', (e) => {
          const p = propsRef.current;
          if (!p.onPick) return;
          // Don't drop a pick point when clicking an interactive topology feature.
          if (m.queryRenderedFeatures(e.point, { layers: ['gis-routes', 'gis-subscribers'] }).length) return;
          p.onPick(e.lngLat.lat, e.lngLat.lng);
        });

        m.on('click', 'gis-routes', (e: any) => {
          const f = e.features?.[0]; if (!f) return;
          const p = f.properties || {}; const id = String(p.id);
          const cur = propsRef.current;
          const actions: Record<string, () => void> = {};
          let buttons = '';
          if (cur.onRouteAction && !cur.readOnly) {
            buttons = `<div style="margin-top:8px">${actionBtn('#7c3aed', 'Edit', 'edit')}${actionBtn('#dc2626', 'Delete', 'delete')}</div>`;
            actions.edit = () => cur.onRouteAction?.(id, 'edit');
            actions.delete = () => cur.onRouteAction?.(id, 'delete');
          }
          popupWithActions(m, [e.lngLat.lng, e.lngLat.lat],
            `<div style="min-width:190px"><b>${esc(p.name)}</b><br />${esc(p.from_box_name || '?')} → ${esc(p.to_box_name || '?')}<br />${esc(p.route_type)}${p.length_m ? ` • ${(Number(p.length_m) / 1000).toFixed(2)} km` : ''}${buttons}</div>`, actions);
        });

        m.on('click', 'gis-subscribers', (e: any) => {
          const f = e.features?.[0]; if (!f) return;
          const p = f.properties || {}; const id = String(p.id);
          const cur = propsRef.current;
          const actions: Record<string, () => void> = {};
          let button = '';
          if (cur.onSubscriberAction && !cur.readOnly) {
            button = `<div style="margin-top:8px">${actionBtn('#0891b2', 'Trace fiber to this subscriber', 'trace')}</div>`;
            actions.trace = () => cur.onSubscriberAction?.(id, 'trace');
          }
          popupWithActions(m, [e.lngLat.lng, e.lngLat.lat],
            `<div style="min-width:190px"><b>${esc(p.full_name)}</b><br />${esc(p.client_code)}<br />${esc(p.connection_type)}${p.username ? ` • ${esc(p.username)}` : ''}<br />Status: ${esc(p.status)}<br />Box: ${esc(p.distribution_box_name || '-')}${button}</div>`, actions);
        });

        for (const layer of ['gis-routes', 'gis-subscribers']) {
          m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
          m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
        }
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      boxMarkersRef.current.forEach(({ marker }) => marker.remove());
      liveMarkersRef.current.forEach(marker => marker.remove());
      boxMarkersRef.current = []; liveMarkersRef.current = [];
      if (map) { try { map.remove(); } catch {} }
      mapRef.current = null;
      delete (window as any).__gisMap;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- basemap + label visibility -----
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const meta: any = map.getStyle()?.metadata || {};
    const streets = mapStyle === 'streets';
    const setVis = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    };
    for (const id of meta.streetLayers || []) setVis(id, streets);
    setVis(meta.satelliteLayer, !streets);
    const showLabels = streets || satelliteLabels;
    for (const id of meta.labelLayers || []) {
      if (!map.getLayer(id)) continue;
      setVis(id, showLabels);
      if (map.getPaintProperty(id, 'text-color') !== undefined) map.setPaintProperty(id, 'text-color', streets ? STREET_TEXT : SAT_TEXT);
      if (map.getPaintProperty(id, 'text-halo-color') !== undefined) map.setPaintProperty(id, 'text-halo-color', streets ? STREET_HALO : SAT_HALO);
    }
  }, [ready, mapStyle, satelliteLabels]);

  // ----- topology source data -----
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const setData = (id: string, fc: any) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
    setData('gis-subscribers-src', { type: 'FeatureCollection', features: subs });
    setData('gis-routes-src', { type: 'FeatureCollection', features: routes });
    setData('gis-heat-src', {
      type: 'FeatureCollection',
      features: subs.map((f: any) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.geometry.coordinates[0], f.geometry.coordinates[1]] },
        properties: { weight: 0.8 },
      })),
    });
  }, [ready, data, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- layer visibility + status filter -----
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const setVis = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    };
    setVis('gis-routes', shown('routes'));
    setVis('gis-heat', !!heatmap);
    const parts: any[] = [];
    if (shown('status_active')) parts.push(['==', ['get', 'status'], 'ACTIVE']);
    if (shown('status_suspended')) parts.push(['==', ['get', 'status'], 'SUSPENDED']);
    if (shown('status_other')) parts.push(['!', ['in', ['get', 'status'], ['literal', ['ACTIVE', 'SUSPENDED']]]]);
    map.setFilter('gis-subscribers', parts.length ? ['any', ...parts] : ['==', ['get', 'status'], '__none__']);
  }, [ready, layers, heatmap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- draft route/trace line -----
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const src = map.getSource('gis-draft-src') as GeoJSONSource | undefined;
    src?.setData(draftLine && draftLine.length >= 2
      ? { type: 'Feature', geometry: { type: 'LineString', coordinates: draftLine.map(([lat, lng]) => [lng, lat]) }, properties: {} }
      : EMPTY_FC);
  }, [ready, draftLine]);

  // ----- box markers (draggable) -----
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    boxMarkersRef.current.forEach(({ marker }) => marker.remove());
    boxMarkersRef.current = [];
    for (const f of boxes) {
      const [lng, lat] = f.geometry.coordinates;
      const p = f.properties || {}; const id = String(p.id);
      const selected = selectedBoxId === p.id;
      const size = selected ? 24 : 18;
      const el = document.createElement('div');
      el.className = 'gis-box-marker';
      el.innerHTML = `<div data-box-id="${esc(id)}" style="width:${size}px;height:${size}px;border-radius:5px;background:${selected ? '#8b5cf6' : '#3b82f6'};border:2px solid white;box-shadow:0 0 0 3px rgba(59,130,246,.35)"></div>`;
      const marker = new maplibregl.Marker({
        element: el,
        draggable: !!propsRef.current.onBoxMove && !propsRef.current.readOnly,
      }).setLngLat([lng, lat]).addTo(map);

      const content = document.createElement('div');
      const canEdit = propsRef.current.onBoxAction && !propsRef.current.readOnly;
      content.innerHTML = `<div style="min-width:190px"><b>${esc(p.name)}</b> ${p.code ? `(${esc(p.code)})` : ''}<br />Type: ${esc(p.box_type)} • Ports: ${esc(p.capacity_ports)}<br />Subscribers: ${p.subscriber_count || 0}<br />${esc(p.zone_name || '')}${p.area_name ? `, ${esc(p.area_name)}` : ''}${canEdit ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${actionBtn('#2563eb', 'Details', 'details')}${actionBtn('#7c3aed', 'Edit', 'edit')}${actionBtn('#dc2626', 'Delete', 'delete')}</div>` : ''}</div>`;
      for (const action of ['details', 'edit', 'delete']) {
        content.querySelectorAll(`[data-map-action="${action}"]`).forEach(btn =>
          btn.addEventListener('click', (e) => { e.stopPropagation(); propsRef.current.onBoxAction?.(id, action as any); }));
      }
      marker.setPopup(new maplibregl.Popup({ maxWidth: '280px' }).setDOMContent(content));
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        propsRef.current.onBoxMove?.(id, ll.lat, ll.lng);
      });
      boxMarkersRef.current.push({ id, marker });
    }
  }, [ready, data, layers, selectedBoxId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- live session markers -----
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    liveMarkersRef.current.forEach(marker => marker.remove());
    liveMarkersRef.current = [];
    if (!shown('live')) return;
    for (const s of liveSessions || []) {
      const el = document.createElement('div');
      el.className = 'gis-live-marker';
      el.innerHTML = '<div style="width:14px;height:14px;border-radius:50%;background:#22d3ee;border:2px solid white;box-shadow:0 0 0 0 rgba(34,211,238,.7);animation:gis-pulse 1.8s infinite"></div>';
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(s.longitude), Number(s.latitude)]).addTo(map);
      const content = document.createElement('div');
      content.innerHTML = `<div style="min-width:180px"><b>${esc(s.full_name)}</b><br />${esc(s.client_code)}<br />Live session • ${esc(s.session_status)}<br />${s.rx_bps ? `↓ ${(Number(s.rx_bps) / 1e6).toFixed(2)} Mbps • ↑ ${(Number(s.tx_bps || 0) / 1e6).toFixed(2)} Mbps` : ''}</div>`;
      marker.setPopup(new maplibregl.Popup({ maxWidth: '240px' }).setDOMContent(content));
      liveMarkersRef.current.push(marker);
    }
  }, [ready, layers, liveSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- map commands -----
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !focus) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom || 16, duration: 700, essential: true });
  }, [ready, focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !fitKey || !fitPointsRef.current.length) return;
    const pts = fitPointsRef.current;
    const lngs = pts.map(p => p[1]), lats = pts.map(p => p[0]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 48, maxZoom: 17, duration: 700 });
  }, [ready, fitKey]);  
  useEffect(() => {
    if (!locateKey || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => mapRef.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15, duration: 700 }),
      () => propsRef.current.onLocateError?.(),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, [locateKey]);  

  return (
    <div className="h-full w-full" data-map-style={mapStyle} data-labels={satelliteLabels ? 'on' : 'off'}
      data-heatmap={heatmap ? 'on' : 'off'} data-map-ready={ready ? '1' : '0'}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
