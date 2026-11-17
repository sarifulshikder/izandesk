'use client';

import React, { useEffect, useMemo } from 'react';
import { DivIcon, latLngBounds, LatLngBounds } from 'leaflet';
import { HeatLayer as LeafletHeatLayer } from 'leaflet.heat';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, CircleMarker, useMap, Pane } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// No CDN marker images: boxes use DivIcons and subscribers use CircleMarkers.
// Point NEXT_PUBLIC_GIS_TILE_URL at an internal tile server for offline/air-gapped
// deployments, and NEXT_PUBLIC_GIS_CENTER at "lat,lng" for a different region.
const TILE_URL = process.env.NEXT_PUBLIC_GIS_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const SATELLITE_URL = process.env.NEXT_PUBLIC_GIS_SATELLITE_TILE_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Label-only overlay: Esri's reference labels use the same clean sans-serif
// typography as the streets basemap. CSS inverts them to white over imagery.
const SATELLITE_LABELS_URL = process.env.NEXT_PUBLIC_GIS_SATELLITE_LABELS_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
// Optional extra overlay (e.g. Esri World_Transportation) — off by default.
const SATELLITE_ROADS_URL = process.env.NEXT_PUBLIC_GIS_SATELLITE_ROADS_URL || '';
const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125];
const parseCenter = (): [number, number] => {
  const raw = process.env.NEXT_PUBLIC_GIS_CENTER;
  if (!raw) return DEFAULT_CENTER;
  const [lat, lng] = raw.split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : DEFAULT_CENTER;
};
const boxIcon = (selected: boolean, id: string) => new DivIcon({
  className: 'gis-box-marker',
  html: `<div data-box-id="${id}" style="width:${selected ? 24 : 18}px;height:${selected ? 24 : 18}px;border-radius:5px;background:${selected ? '#8b5cf6' : '#3b82f6'};border:2px solid white;box-shadow:0 0 0 3px rgba(59,130,246,.35)"></div>`,
  iconSize: [selected ? 24 : 18, selected ? 24 : 18],
  iconAnchor: [selected ? 12 : 9, selected ? 12 : 9],
});
const liveIcon = new DivIcon({
  className: 'gis-live-marker',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#22d3ee;border:2px solid white;box-shadow:0 0 0 0 rgba(34,211,238,.7);animation:gis-pulse 1.8s infinite"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7],
});

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

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function BoundsReporter({ onChange }: { onChange?: (bbox: [number, number, number, number]) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!onChange) return;
    const report = () => {
      const b: LatLngBounds = map.getBounds();
      onChange([
        Number(b.getWest().toFixed(4)), Number(b.getSouth().toFixed(4)),
        Number(b.getEast().toFixed(4)), Number(b.getNorth().toFixed(4)),
      ]);
    };
    map.on('moveend zoomend', report);
    return () => { map.off('moveend zoomend', report); };
  }, [map, onChange]);
  return null;
}

function MapCommands({ focus, fitKey, locateKey, points, onLocateError }: {
  focus: GisMapProps['focus']; fitKey?: number; locateKey?: number; points: [number, number][];
  onLocateError?: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom || 16, { duration: 0.7 });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fitKey || !points.length) return;
    map.fitBounds(latLngBounds(points), { padding: [48, 48], maxZoom: 17 });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!locateKey || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => map.flyTo([p.coords.latitude, p.coords.longitude], 15, { duration: 0.7 }),
      () => onLocateError?.(),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, [locateKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function HeatLayer({ points, visible }: { points: [number, number, number][]; visible: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!visible || !points.length) return;
    const layer = new (LeafletHeatLayer as any)(points, {
      radius: 24, blur: 20, maxZoom: 17, minOpacity: 0.25,
      gradient: { 0.2: '#22c55e', 0.5: '#f59e0b', 0.9: '#ef4444' },
    }).addTo(map);
    return () => { try { map.removeLayer(layer); } catch {} };
  }, [map, visible, points]);
  return null;
}

export default function GisMap({
  data, onPick, draftLine, layers, focus, fitKey, locateKey, selectedBoxId,
  mapStyle = 'streets', satelliteLabels = true, readOnly, heatmap, liveSessions, onBoundsChange,
  onBoxMove, onBoxAction, onSubscriberAction, onRouteAction, onLocateError,
}: GisMapProps) {
  const center = useMemo(parseCenter, []);
  const shown = (key: string) => layers?.[key] !== false;
  const statusKey = (status: string) => status === 'ACTIVE' ? 'status_active' : status === 'SUSPENDED' ? 'status_suspended' : 'status_other';
  const statusColor = (status: string) => status === 'ACTIVE' ? '#22c55e' : status === 'SUSPENDED' ? '#ef4444' : '#f59e0b';

  const boxes: any[] = shown('boxes') ? (data?.boxes?.features || []) : [];
  const subs: any[] = (data?.subscribers?.features || []).filter((f: any) => shown(statusKey(f.properties.status)));
  const routes: any[] = shown('routes') ? (data?.fiberRoutes?.features || []) : [];
  const heatPoints = useMemo<[number, number, number][]>(() =>
    subs.map((f: any) => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.8]), [subs]);

  const fitPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    for (const f of boxes) pts.push([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    for (const f of subs) pts.push([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    for (const f of routes) for (const c of (f.geometry?.coordinates || [])) pts.push([c[1], c[0]]);
    return pts;
  }, [boxes, subs, routes]);

  return (
    <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} className="rounded-2xl overflow-hidden">
      <TileLayer
        key={mapStyle}
        url={mapStyle === 'satellite' ? SATELLITE_URL : TILE_URL}
        attribution={mapStyle === 'satellite'
          ? 'Imagery &copy; Esri, Maxar, Earthstar Geographics &mdash; labels &copy; Esri, HERE, Garmin, OpenStreetMap contributors'
          : '&copy; OpenStreetMap contributors'}
      />
      {mapStyle === 'satellite' && satelliteLabels && (
        // Custom pane sits above the imagery tile pane (200) but below markers.
        <Pane name="gis-labels" style={{ zIndex: 350 }}>
          {SATELLITE_ROADS_URL && <TileLayer key={`roads-${mapStyle}`} pane="gis-labels" url={SATELLITE_ROADS_URL} opacity={0.7} />}
          <TileLayer key={`labels-${mapStyle}`} pane="gis-labels" url={SATELLITE_LABELS_URL} />
        </Pane>
      )}
      <MapCommands focus={focus} fitKey={fitKey} locateKey={locateKey} points={fitPoints} onLocateError={onLocateError} />
      <BoundsReporter onChange={onBoundsChange} />
      {onPick && <ClickCapture onPick={onPick} />}
      {heatmap && <HeatLayer points={heatPoints} visible={!!heatmap} />}

      {shown('live') && (liveSessions || []).map((s: any) => (
        <Marker key={`live-${s.id}`} position={[Number(s.latitude), Number(s.longitude)]} icon={liveIcon}>
          <Popup>
            <div style={{ minWidth: 180 }}>
              <b>{s.full_name}</b><br />{s.client_code}<br />
              Live session • {s.session_status}<br />
              {s.rx_bps ? `↓ ${(Number(s.rx_bps) / 1e6).toFixed(2)} Mbps • ↑ ${(Number(s.tx_bps || 0) / 1e6).toFixed(2)} Mbps` : ''}
            </div>
          </Popup>
        </Marker>
      ))}

      {boxes.map((f: any) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        const selected = selectedBoxId === p.id;
        return (
          <Marker
            key={`b-${p.id}`}
            position={[lat, lng]}
            icon={boxIcon(selected, p.id)}
            draggable={!!onBoxMove && !readOnly}
            eventHandlers={onBoxMove ? {
              dragend: (e: any) => { const ll = e.target.getLatLng(); onBoxMove(p.id, ll.lat, ll.lng); },
            } : {}}
          >
            <Popup>
              <div style={{ minWidth: 190 }}>
                <b>{p.name}</b> {p.code ? `(${p.code})` : ''}<br />
                Type: {p.box_type} • Ports: {p.capacity_ports}<br />
                Subscribers: {p.subscriber_count || 0}<br />
                {p.zone_name || ''}{p.area_name ? `, ${p.area_name}` : ''}
                {onBoxAction && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => onBoxAction(p.id, 'details')} style={btnStyle('#2563eb')}>Details</button>
                    {!readOnly && <>
                      <button onClick={() => onBoxAction(p.id, 'edit')} style={btnStyle('#7c3aed')}>Edit</button>
                      <button onClick={() => onBoxAction(p.id, 'delete')} style={btnStyle('#dc2626')}>Delete</button>
                    </>}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {subs.map((f: any) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        const color = statusColor(p.status);
        return (
          <CircleMarker key={`s-${p.id}`} center={[lat, lng]} radius={6} pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}>
            <Popup>
              <div style={{ minWidth: 190 }}>
                <b>{p.full_name}</b><br />
                {p.client_code}<br />
                {p.connection_type}{p.username ? ` • ${p.username}` : ''}<br />
                Status: {p.status}<br />
                Box: {p.distribution_box_name || '-'}
                {onSubscriberAction && !readOnly && (
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => onSubscriberAction(p.id, 'trace')} style={btnStyle('#0891b2')}>Trace fiber to this subscriber</button>
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {routes.map((f: any) => {
        const coords = (f.geometry?.coordinates || []).map((c: any) => [c[1], c[0]]);
        const p = f.properties;
        return (
          <Polyline key={`r-${p.id}`} positions={coords} pathOptions={{ color: '#06b6d4', weight: 4, opacity: 0.8 }}>
            <Popup>
              <div style={{ minWidth: 190 }}>
                <b>{p.name}</b><br />
                {p.from_box_name || '?'} → {p.to_box_name || '?'}<br />
                {p.route_type}{p.length_m ? ` • ${(Number(p.length_m) / 1000).toFixed(2)} km` : ''}
                {p.notes ? <><br />{p.notes}</> : null}
                {onRouteAction && !readOnly && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button onClick={() => onRouteAction(p.id, 'edit')} style={btnStyle('#7c3aed')}>Edit</button>
                    <button onClick={() => onRouteAction(p.id, 'delete')} style={btnStyle('#dc2626')}>Delete</button>
                  </div>
                )}
              </div>
            </Popup>
          </Polyline>
        );
      })}

      {draftLine && draftLine.length >= 2 && <Polyline positions={draftLine} pathOptions={{ color: '#f59e0b', weight: 4, dashArray: '6 6' }} />}
    </MapContainer>
  );
}

const btnStyle = (bg: string): React.CSSProperties => ({
  background: bg, color: '#fff', border: 0, borderRadius: 6,
  padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
});
