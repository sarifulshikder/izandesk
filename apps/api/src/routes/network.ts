import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, sanitizeRouter, sanitizeRouters, networkGuard, hasNetworkWrite } from './helpers';
import { mikrotikTest, mikrotikTelemetry, mikrotikActiveSessions, mikrotikSyncPackage, mikrotikListPppSecrets, mikrotikListPppProfiles, mikrotikListHotspotUsers, mikrotikListHotspotProfiles, mikrotikSyncPppSecret } from '../integrations/mikrotik';
import { syncNasForRouter, removeNasForRouter, syncAllRadiusNas } from '../integrations/radius';
import { autoLinkOnusBulk } from '../integrations/onu-autolink';

const router: Router = Router();
router.use(networkGuard);

// Routers CRUD
router.get('/routers', asyncHandler(async (req, res) => {
  const mode = String(req.query.integration_mode || req.query.mode || '').toUpperCase();
  const enabled = req.query.enabled;
  const where: string[] = [];
  const params: any[] = [];
  if (mode) { params.push(mode); where.push(`integration_mode = $${params.length}`); }
  if (enabled === 'true' || enabled === '1') where.push('is_enabled = true');
  const sql = `SELECT * FROM network_routers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY integration_mode ASC, created_at DESC`;
  const r = await pool.query(sql, params);
  const rows: any[] = [];
  for (const row of r.rows) {
    let t: any = null;
    const imode = String(row.integration_mode || 'API').toUpperCase();
    if (row.is_enabled && (imode === 'API' || imode === 'REST')) {
      try {
        const live = await mikrotikTelemetry(row);
        t = { ...live, last_seen_at: new Date().toISOString() };
      } catch (e: any) {
        t = { status: 'OFFLINE', last_seen_at: row.last_seen_at, last_error: e.message || 'unreachable' };
      }
    } else if (row.is_enabled && imode === 'RADIUS') {
      t = { status: row.status || 'ONLINE', last_seen_at: new Date().toISOString() };
    } else {
      t = { status: 'DISABLED', last_seen_at: row.last_seen_at };
    }
    const merged = { ...row, ...t };
    await pool.query('UPDATE network_routers SET cpu_load=$1,memory_used_mb=$2,memory_total_mb=$3,rx_bps=$4,tx_bps=$5,uptime_seconds=$6,status=$7,last_seen_at=COALESCE($8,last_seen_at),identity=COALESCE($9,identity),board_name=COALESCE($10,board_name),updated_at=now() WHERE id=$11',
      [merged.cpu_load ?? row.cpu_load ?? null, merged.memory_used_mb ?? row.memory_used_mb ?? null, merged.memory_total_mb ?? row.memory_total_mb ?? null, merged.rx_bps ?? row.rx_bps ?? 0, merged.tx_bps ?? row.tx_bps ?? 0, merged.uptime_seconds ?? row.uptime_seconds ?? null, merged.status || row.status, merged.last_seen_at || null, merged.identity || null, merged.board_name || null, row.id]);
    rows.push(merged);
  }
  res.json({ data: sanitizeRouters(rows) });
}));

router.get('/routers/:id', asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [req.params.id]);
  const row = r.rows[0];
  if (!row) return res.status(404).json({ message: 'Router not found' });
  const [sess, subs] = await Promise.all([
    pool.query(`SELECT
        COUNT(*)::int AS total_sessions,
        COUNT(*) FILTER (WHERE status='ONLINE')::int AS online_sessions,
        COALESCE(SUM(COALESCE(rx_bps,0)),0)::bigint AS agg_rx_bps,
        COALESCE(SUM(COALESCE(tx_bps,0)),0)::bigint AS agg_tx_bps
      FROM subscriber_sessions WHERE router_id=$1`, [req.params.id]),
    pool.query(`SELECT COUNT(*)::int AS assigned_subscribers FROM subscribers WHERE router_id=$1`, [req.params.id]).catch(()=>({ rows:[{ assigned_subscribers: 0 }] } as any)),
  ]);
  res.json({ ...sanitizeRouter(row), stats: { ...(sess.rows[0] || {}), ...(subs.rows[0] || {}) } });
}));

router.post('/routers', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const mode = String(b.integration_mode || 'API').toUpperCase();
  if (!b.name || !b.host) return res.status(400).json({ message: 'name and host are required' });
  if (!['API','REST','RADIUS'].includes(mode)) return res.status(400).json({ message: 'integration_mode must be API, REST, or RADIUS' });
  if (mode === 'RADIUS' && !b.radius_secret) return res.status(400).json({ message: 'radius_secret is required for RADIUS routers' });
  const r = await pool.query(`INSERT INTO network_routers(
      name,host,api_port,rest_port,username,password,router_type,ros_version,use_ssl,site,is_enabled,status,integration_mode,radius_secret,coa_port,nas_identifier
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'UNKNOWN',$12,$13,$14,$15) RETURNING *`,
    [
      b.name,b.host,
      mode === 'REST' ? (b.api_port ?? null) : (b.api_port ?? 8728),
      b.rest_port ?? (mode === 'REST' ? 443 : null),
      b.username || (mode === 'RADIUS' ? '' : 'admin'),
      b.password || null,
      b.router_type || 'MIKROTIK',
      b.ros_version || 'v7',
      !!b.use_ssl,
      b.site || null,
      b.is_enabled !== false,
      mode,
      mode === 'RADIUS' ? (b.radius_secret || null) : null,
      Number(b.coa_port || 3799),
      b.nas_identifier || null,
    ]);
  try { await syncNasForRouter(r.rows[0]); } catch {}
  res.status(201).json(sanitizeRouter(r.rows[0]));
}));

router.put('/routers/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const cur = await pool.query('SELECT * FROM network_routers WHERE id=$1',[req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ message: 'Router not found' });
  const c = cur.rows[0];
  const mode = String(b.integration_mode ?? c.integration_mode ?? 'API').toUpperCase();
  if (!['API','REST','RADIUS'].includes(mode)) return res.status(400).json({ message: 'integration_mode must be API, REST, or RADIUS' });
  if (mode === 'RADIUS' && !(b.radius_secret || c.radius_secret)) return res.status(400).json({ message: 'radius_secret is required for RADIUS routers' });
  const r = await pool.query(`UPDATE network_routers SET
      name=$1,host=$2,api_port=$3,rest_port=$4,username=$5,password=COALESCE(NULLIF($6,''),password),
      router_type=$7,ros_version=$8,use_ssl=$9,site=$10,is_enabled=$11,integration_mode=$12,
      radius_secret=CASE WHEN $12='RADIUS' THEN COALESCE(NULLIF($13,''), radius_secret) ELSE NULL END,
      coa_port=$14,nas_identifier=$15,updated_at=now()
    WHERE id=$16 RETURNING *`,
    [
      b.name??c.name,b.host??c.host,b.api_port??c.api_port,b.rest_port??c.rest_port,b.username??c.username,b.password??'',
      b.router_type??c.router_type,b.ros_version??c.ros_version,b.use_ssl??c.use_ssl,b.site??c.site,b.is_enabled??c.is_enabled,
      mode, b.radius_secret ?? '', Number(b.coa_port ?? c.coa_port ?? 3799), b.nas_identifier ?? c.nas_identifier, req.params.id
    ]);
  try { await syncNasForRouter(r.rows[0], c.host); } catch {}
  res.json(sanitizeRouter(r.rows[0]));
}));

router.delete('/routers/:id', asyncHandler(async (req, res) => {
  const cur = await pool.query('SELECT * FROM network_routers WHERE id=$1',[req.params.id]);
  await pool.query('DELETE FROM network_routers WHERE id=$1',[req.params.id]);
  try { if (cur.rows[0]) await removeNasForRouter(cur.rows[0]); } catch {}
  res.json({ ok: true });
}));

router.post('/routers/sync-radius-nas', asyncHandler(async (_req, res) => {
  const result = await syncAllRadiusNas();
  res.json({ ok: true, ...result, note: 'RADIUS-mode routers synced to FreeRADIUS nas table. Restart/reload FreeRADIUS if clients are not picked up dynamically.' });
}));

router.post('/routers/:id/test', asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1',[req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Router not found' });
  const row = r.rows[0];
  const mode = String(row.integration_mode || 'API').toUpperCase();
  try {
    if (mode === 'API' || mode === 'REST') {
      const result = await mikrotikTest(row);
      await pool.query(`UPDATE network_routers SET status='ONLINE', last_seen_at=now(), identity=$1, updated_at=now() WHERE id=$2`, [result.identity || row.identity || row.name, req.params.id]);
      return res.json({ ok: true, message: `Real ${mode} connection successful. Identity: ${result.identity}`, identity: result.identity, integration_mode: mode });
    } else {
      // RADIUS NAS: verify config (real CoA reachability tested via CoA action); mark enabled NAS as configured
      if (!row.radius_secret) return res.status(400).json({ message: 'RADIUS shared secret is required' });
      await pool.query(`UPDATE network_routers SET status='ONLINE', last_seen_at=now(), identity=COALESCE(identity,$1), updated_at=now() WHERE id=$2`, [row.nas_identifier || row.name.replace(/\s+/g,'-').toUpperCase(), req.params.id]);
      return res.json({ ok: true, message: `RADIUS NAS configured. Secret set, CoA port ${row.coa_port||3799}. (Use CoA/PoD to verify real NAS response; FreeRADIUS handles AAA.)`, identity: row.nas_identifier || row.identity || row.name, integration_mode: mode, coa_port: row.coa_port || 3799 });
    }
  } catch (e: any) {
    await pool.query(`UPDATE network_routers SET status='OFFLINE', updated_at=now() WHERE id=$1`, [req.params.id]);
    return res.status(502).json({ ok: false, message: `Connection failed: ${e.message || e}`, integration_mode: mode });
  }
}));

// Bandwidth packages
router.get('/packages', asyncHandler(async (_req, res) => {
  const r = await pool.query('SELECT * FROM bandwidth_packages ORDER BY download_mbps ASC');
  res.json({ data: r.rows });
}));
router.post('/packages', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || b.download_mbps == null || b.upload_mbps == null) return res.status(400).json({ message: 'name, download_mbps, upload_mbps required' });
  const r = await pool.query(`INSERT INTO bandwidth_packages(name,profile_name,download_mbps,upload_mbps,burst_download_mbps,burst_upload_mbps,burst_threshold_download_mbps,burst_threshold_upload_mbps,burst_time_sec,priority,queue_type,price,description,is_active,data_cap_gb,fup_speed_mbps)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [b.name,b.profile_name||null,b.download_mbps,b.upload_mbps,b.burst_download_mbps||null,b.burst_upload_mbps||null,b.burst_threshold_download_mbps||null,b.burst_threshold_upload_mbps||null,b.burst_time_sec||null,b.priority??8,b.queue_type||'SIMPLE',b.price||0,b.description||null,b.is_active!==false,b.data_cap_gb===''||b.data_cap_gb==null?null:Number(b.data_cap_gb),b.fup_speed_mbps===''||b.fup_speed_mbps==null?null:Number(b.fup_speed_mbps)]);
  res.status(201).json(r.rows[0]);
}));
router.put('/packages/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const c = (await pool.query('SELECT * FROM bandwidth_packages WHERE id=$1',[req.params.id])).rows[0];
  if (!c) return res.status(404).json({ message: 'Package not found' });
  const r = await pool.query(`UPDATE bandwidth_packages SET name=$1,profile_name=$2,download_mbps=$3,upload_mbps=$4,burst_download_mbps=$5,burst_upload_mbps=$6,burst_threshold_download_mbps=$7,burst_threshold_upload_mbps=$8,burst_time_sec=$9,priority=$10,queue_type=$11,price=$12,description=$13,is_active=$14,data_cap_gb=$15,fup_speed_mbps=$16,updated_at=now() WHERE id=$17 RETURNING *`,
    [b.name??c.name,b.profile_name??c.profile_name,b.download_mbps??c.download_mbps,b.upload_mbps??c.upload_mbps,b.burst_download_mbps??c.burst_download_mbps,b.burst_upload_mbps??c.burst_upload_mbps,b.burst_threshold_download_mbps??c.burst_threshold_download_mbps,b.burst_threshold_upload_mbps??c.burst_threshold_upload_mbps,b.burst_time_sec??c.burst_time_sec,b.priority??c.priority,b.queue_type??c.queue_type,b.price??c.price,b.description??c.description,b.is_active??c.is_active, b.data_cap_gb==='' ? null : (b.data_cap_gb ?? c.data_cap_gb), b.fup_speed_mbps==='' ? null : (b.fup_speed_mbps ?? c.fup_speed_mbps), req.params.id]);
  res.json(r.rows[0]);
}));
router.delete('/packages/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM bandwidth_packages WHERE id=$1',[req.params.id]);
  res.json({ ok: true });
}));

// Sync packages to routers (Simple Queues / Queue Trees / PPP profiles) - direct API/REST provisioning
router.post('/packages/sync', asyncHandler(async (req, res) => {
  const { router_ids, package_ids } = req.body || {};
  const routers = router_ids?.length
    ? (await pool.query("SELECT * FROM network_routers WHERE id = ANY($1::uuid[]) AND integration_mode IN ('API','REST') AND is_enabled=true",[router_ids])).rows
    : (await pool.query("SELECT * FROM network_routers WHERE is_enabled=true AND integration_mode IN ('API','REST')")).rows;
  const pkgs = package_ids?.length ? (await pool.query('SELECT * FROM bandwidth_packages WHERE id = ANY($1::uuid[])',[package_ids])).rows : (await pool.query('SELECT * FROM bandwidth_packages WHERE is_active=true')).rows;
  const results: any[] = [];
  for (const rt of routers) {
    for (const p of pkgs) {
      try {
        const syncRes = await mikrotikSyncPackage(rt, p);
        const remoteRef = syncRes.remote_ref || `${String(rt.integration_mode||'API').toLowerCase()}:${p.queue_type === 'QUEUE_TREE' ? `qt-${p.profile_name||p.name}` : `sq-${p.profile_name||p.name}`}`;
        await pool.query(`INSERT INTO router_package_sync(router_id,package_id,sync_status,last_synced_at,remote_ref,last_error)
          VALUES($1,$2,'SYNCED',now(),$3,NULL)
          ON CONFLICT (router_id,package_id) DO UPDATE SET sync_status='SYNCED', last_synced_at=now(), remote_ref=$3, last_error=NULL`,
          [rt.id,p.id,remoteRef]);
        results.push({ router: rt.name, mode: rt.integration_mode, package: p.name, queue_type: p.queue_type, remote_ref: remoteRef, status: 'SYNCED', real: true });
      } catch (e: any) {
        const remoteRef = `${String(rt.integration_mode||'API').toLowerCase()}:ERR`;
        await pool.query(`INSERT INTO router_package_sync(router_id,package_id,sync_status,last_synced_at,remote_ref,last_error)
          VALUES($1,$2,'FAILED',now(),$3,$4)
          ON CONFLICT (router_id,package_id) DO UPDATE SET sync_status='FAILED', last_synced_at=now(), remote_ref=$3, last_error=$4`,
          [rt.id,p.id,remoteRef, e.message || String(e)]);
        results.push({ router: rt.name, mode: rt.integration_mode, package: p.name, status: 'FAILED', error: e.message });
      }
    }
  }
  res.json({ ok: true, synced: results.filter(r=>r.status==='SYNCED').length, failed: results.filter(r=>r.status==='FAILED').length, results, note: 'Real provisioning to MikroTik API/REST attempted (PPP profile + optional simple queue). RADIUS-mode routers use AAA profiles via RADIUS sync.' });
}));

router.get('/packages/sync-status', asyncHandler(async (_req, res) => {
  const r = await pool.query(`SELECT s.*, r.name as router_name, r.integration_mode, p.name as package_name, p.download_mbps, p.upload_mbps, p.queue_type
    FROM router_package_sync s JOIN network_routers r ON r.id=s.router_id JOIN bandwidth_packages p ON p.id=s.package_id
    ORDER BY s.last_synced_at DESC NULLS LAST`);
  res.json({ data: r.rows });
}));

// MikroTik import (preview + import) for PPP/Hotspot users & profiles
function mbpsFromRateLimit(rate: any): number {
  const s = String(rate || '').trim();
  if (!s) return 0;
  const first = s.split(/\s+/)[0] || s;
  const pick = (x: string) => {
    const m = String(x || '').trim().match(/^([\d.]+)\s*([kKmMgG])?/);
    if (!m) return 0;
    const n = Number(m[1]); if (!Number.isFinite(n)) return 0;
    const u = (m[2] || '').toLowerCase();
    if (u === 'g') return Math.round(n * 1000);
    if (u === 'k') return Math.max(1, Math.round(n / 1000));
    return Math.round(n);
  };
  const parts = first.split('/');
  return Math.max(pick(parts[0] || ''), pick(parts[1] || parts[0] || '')) || 0;
}

router.get('/routers/:id/mikrotik/import-preview', asyncHandler(async (req, res) => {
  // The preview includes PPP secret passwords — restrict to network engineers.
  if (!hasNetworkWrite(req)) return res.status(403).json({ message: 'Insufficient permissions to view router secrets' });
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Router not found' });
  const row = r.rows[0];
  const mode = String(row.integration_mode || 'API').toUpperCase();
  if (!['API', 'REST'].includes(mode)) return res.status(400).json({ message: 'Import is supported only for direct API/REST MikroTik routers' });
  const type = String(req.query.type || '').toLowerCase();
  try {
    if (type === 'ppp-secrets' || type === 'ppp_users' || type === 'ppp-users') {
      const items = await mikrotikListPppSecrets(row);
      const names = items.map((x: any) => x.name).filter(Boolean);
      const existing = names.length ? (await pool.query('SELECT username FROM subscribers WHERE username = ANY($1::text[])', [names])).rows.map((x: any) => x.username) : [];
      const set = new Set(existing);
      return res.json({ ok: true, type: 'ppp-secrets', count: items.length, items: items.map((x: any) => ({ ...x, exists: set.has(x.name) })) });
    }
    if (type === 'ppp-profiles' || type === 'ppp_profiles') {
      const items = await mikrotikListPppProfiles(row);
      const names = items.map((x: any) => x.name).filter(Boolean);
      const existing = names.length ? (await pool.query('SELECT name, profile_name FROM bandwidth_packages WHERE name = ANY($1::text[]) OR profile_name = ANY($1::text[])', [names])).rows : [];
      const set = new Set(existing.flatMap((x: any) => [x.name, x.profile_name]).filter(Boolean));
      return res.json({ ok: true, type: 'ppp-profiles', count: items.length, items: items.map((x: any) => ({ ...x, exists: set.has(x.name) })) });
    }
    if (type === 'hotspot-users' || type === 'hotspot_users') {
      const items = await mikrotikListHotspotUsers(row);
      const names = items.map((x: any) => x.name).filter(Boolean);
      const existing = names.length ? (await pool.query('SELECT username FROM subscribers WHERE username = ANY($1::text[])', [names])).rows.map((x: any) => x.username) : [];
      const set = new Set(existing);
      return res.json({ ok: true, type: 'hotspot-users', count: items.length, items: items.map((x: any) => ({ ...x, exists: set.has(x.name) })) });
    }
    if (type === 'hotspot-profiles' || type === 'hotspot_profiles') {
      const items = await mikrotikListHotspotProfiles(row);
      const names = items.map((x: any) => x.name).filter(Boolean);
      const existing = names.length ? (await pool.query('SELECT name, profile_name FROM bandwidth_packages WHERE name = ANY($1::text[]) OR profile_name = ANY($1::text[])', [names])).rows : [];
      const set = new Set(existing.flatMap((x: any) => [x.name, x.profile_name]).filter(Boolean));
      return res.json({ ok: true, type: 'hotspot-profiles', count: items.length, items: items.map((x: any) => ({ ...x, exists: set.has(x.name) })) });
    }
    return res.status(400).json({ message: 'type must be ppp-secrets, ppp-profiles, hotspot-users, or hotspot-profiles' });
  } catch (e: any) {
    return res.status(502).json({ ok: false, message: `Failed to fetch from MikroTik: ${e.message || e}` });
  }
}));

router.post('/routers/:id/mikrotik/import', asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Router not found' });
  const row = r.rows[0];
  const mode = String(row.integration_mode || 'API').toUpperCase();
  if (!['API', 'REST'].includes(mode)) return res.status(400).json({ message: 'Import is supported only for direct API/REST MikroTik routers' });

  const b = req.body || {};
  const type = String(b.type || '').toLowerCase();
  const selected: string[] = Array.isArray(b.selected) ? b.selected.map((x: any) => String(x)) : [];
  const selectedSet = selected.length ? new Set(selected) : null;
  const opts = b.options || {};
  const skipExisting = opts.skip_existing !== false; // default true
  const provisionRouterMode = opts.provisioning_mode ? String(opts.provisioning_mode).toUpperCase() : 'ROUTER';

  const summary = { imported: 0, skipped: 0, failed: 0, errors: [] as any[] };

  try {
    if (type === 'ppp-profiles' || type === 'ppp_profiles') {
      const items = await mikrotikListPppProfiles(row);
      for (const it of items) {
        if (selectedSet && !selectedSet.has(it.name)) continue;
        try {
          const ex = await pool.query('SELECT id FROM bandwidth_packages WHERE name=$1 OR profile_name=$1 LIMIT 1', [it.name]);
          if (ex.rows[0]) { summary.skipped++; continue; }
          const speed = Math.max(1, mbpsFromRateLimit(it.rate_limit) || 1);
          await pool.query(`INSERT INTO bandwidth_packages(name,profile_name,download_mbps,upload_mbps,queue_type,priority,price,description,is_active)
            VALUES($1,$2,$3,$4,'SIMPLE',8,0,$5,true)`,
            [it.name, it.name, speed, speed, it.comment || `Imported from MikroTik ${row.name}`]);
          summary.imported++;
        } catch (e: any) { summary.failed++; summary.errors.push({ name: it.name, error: e.message }); }
      }
      return res.json({ ok: true, type: 'ppp-profiles', ...summary });
    }

    if (type === 'hotspot-profiles' || type === 'hotspot_profiles') {
      const items = await mikrotikListHotspotProfiles(row);
      for (const it of items) {
        if (selectedSet && !selectedSet.has(it.name)) continue;
        try {
          const ex = await pool.query('SELECT id FROM bandwidth_packages WHERE name=$1 OR profile_name=$1 LIMIT 1', [it.name]);
          if (ex.rows[0]) { summary.skipped++; continue; }
          const speed = Math.max(1, mbpsFromRateLimit(it.rate_limit) || 1);
          await pool.query(`INSERT INTO bandwidth_packages(name,profile_name,download_mbps,upload_mbps,queue_type,priority,price,description,is_active)
            VALUES($1,$2,$3,$4,'SIMPLE',8,0,$5,true)`,
            [it.name, it.name, speed, speed, it.comment || `Imported Hotspot profile from MikroTik ${row.name}`]);
          summary.imported++;
        } catch (e: any) { summary.failed++; summary.errors.push({ name: it.name, error: e.message }); }
      }
      return res.json({ ok: true, type: 'hotspot-profiles', ...summary });
    }

    if (type === 'ppp-secrets' || type === 'ppp_users' || type === 'ppp-users') {
      const items = await mikrotikListPppSecrets(row);
      const profiles = await pool.query('SELECT id,name,profile_name,download_mbps,price FROM bandwidth_packages');
      const byName = new Map<string, any>();
      for (const p of profiles.rows) { if (p.profile_name) byName.set(String(p.profile_name), p); if (p.name) byName.set(String(p.name), p); }
      for (const it of items) {
        if (selectedSet && !selectedSet.has(it.name)) continue;
        try {
          const ex = await pool.query('SELECT id FROM subscribers WHERE username=$1', [it.name]);
          if (ex.rows[0]) { if (skipExisting) { summary.skipped++; continue; } }
          const pkg = byName.get(String(it.profile || ''));
          const seq = await pool.query("SELECT nextval('subscriber_client_code_seq')::int AS n");
          const n = Number(seq.rows[0]?.n || Date.now() % 100000);
          const clientCode = `IZN-MT-${String(n).padStart(5, '0')}`;
          const status = it.disabled ? 'SUSPENDED' : 'ACTIVE';
          const uname = String(it.name).slice(0, 64);
          const ins = await pool.query(`INSERT INTO subscribers(
              client_code, full_name, subscriber_type, connection_type, username, password, phone, email, nid_number,
              package_name, bandwidth_mbps, monthly_bill, status, address, ip_address, mac_address,
              provisioning_mode, router_id
            ) VALUES($1,$2,'HOME','PPPOE',$3,$4,NULL,NULL,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, username, client_code`,
            [clientCode, uname, uname, it.password || null, pkg?.name || it.profile || null, pkg?.download_mbps || null, Number(pkg?.price || 0), status,
             it.comment || `Imported from MikroTik ${row.name}`, it.remote_address || null, it.caller_id || null,
             provisionRouterMode === 'RADIUS' ? 'RADIUS' : 'ROUTER', provisionRouterMode === 'RADIUS' ? null : row.id]);
          summary.imported++;
        } catch (e: any) { summary.failed++; summary.errors.push({ name: it.name, error: e.message }); }
      }
      return res.json({ ok: true, type: 'ppp-secrets', ...summary, note: 'Imported subscribers are created in IzanDesk (client_code auto-generated). RADIUS sync/provisioning is not auto-run for imported rows; review and provision as needed.' });
    }

    if (type === 'hotspot-users' || type === 'hotspot_users') {
      const items = await mikrotikListHotspotUsers(row);
      for (const it of items) {
        if (selectedSet && !selectedSet.has(it.name)) continue;
        try {
          const ex = await pool.query('SELECT id FROM subscribers WHERE username=$1', [it.name]);
          if (ex.rows[0]) { if (skipExisting) { summary.skipped++; continue; } }
          const seq = await pool.query("SELECT nextval('subscriber_client_code_seq')::int AS n");
          const n = Number(seq.rows[0]?.n || Date.now() % 100000);
          const clientCode = `IZN-HS-${String(n).padStart(5, '0')}`;
          const status = it.disabled ? 'SUSPENDED' : 'ACTIVE';
          const uname = String(it.name).slice(0, 64);
          await pool.query(`INSERT INTO subscribers(
              client_code, full_name, subscriber_type, connection_type, username, password, phone, email, nid_number,
              package_name, bandwidth_mbps, monthly_bill, status, address, mac_address,
              provisioning_mode, router_id
            ) VALUES($1,$2,'HOTSPOT','HOTSPOT',$3,$4,NULL,NULL,NULL,$5,NULL,0,$6,$7,$8,$9,$10)`,
            [clientCode, uname, uname, it.password || null, it.profile || null, status,
             it.comment || `Imported Hotspot user from MikroTik ${row.name}`, it.mac_address || null,
             provisionRouterMode === 'RADIUS' ? 'RADIUS' : 'ROUTER', provisionRouterMode === 'RADIUS' ? null : row.id]);
          summary.imported++;
        } catch (e: any) { summary.failed++; summary.errors.push({ name: it.name, error: e.message }); }
      }
      return res.json({ ok: true, type: 'hotspot-users', ...summary, note: 'Hotspot users imported as subscribers (HOTSPOT). Voucher-based hotspot flows remain separate in Hotspot module.' });
    }

    return res.status(400).json({ message: 'type must be ppp-secrets, ppp-profiles, hotspot-users, or hotspot-profiles' });
  } catch (e: any) {
    return res.status(502).json({ ok: false, message: `Import failed: ${e.message || e}`, ...summary });
  }
}));

// Live sessions / throughput
router.get('/sessions', asyncHandler(async (req, res) => {
  const subs = await pool.query(`SELECT s.id, s.username, s.full_name, s.client_code, s.status, s.connection_type, s.ip_address, s.mac_address, s.provisioning_mode, s.router_id
    FROM subscribers s WHERE s.username IS NOT NULL AND s.username <> ''`);
  const allRouters = (await pool.query('SELECT * FROM network_routers ORDER BY created_at')).rows;
  const radiusRouters = allRouters.filter((r:any)=>String(r.integration_mode).toUpperCase()==='RADIUS' && r.is_enabled);
  const directRouters = allRouters.filter((r:any)=>['API','REST'].includes(String(r.integration_mode).toUpperCase()) && r.is_enabled);

  // Try real active PPP sessions from direct API/REST routers
  const realMap = new Map<string, {router_id:string; address?:string; caller_id?:string; uptime?:string; rx_bps?:number; tx_bps?:number}>();
  for (const rt of directRouters) {
    try {
      const actives = await mikrotikActiveSessions(rt);
      for (const a of (actives||[])) {
        if (a && a.name) realMap.set(String(a.name), { router_id: rt.id, address: a.address, caller_id: a.caller_id, uptime: a.uptime, rx_bps: Number(a.rx_bps||0), tx_bps: Number(a.tx_bps||0) });
      }
    } catch (_e) { /* unreachable/unsupported - fall through */ }
  }

  for (let i=0; i<subs.rows.length; i++) {
    const s = subs.rows[i];
    const uname = String(s.username);
    let rt: any = null;
    const real = realMap.get(uname);
    if (String(s.provisioning_mode||'').toUpperCase() === 'ROUTER' && s.router_id) {
      rt = directRouters.find((r:any)=>r.id===s.router_id) || allRouters.find((r:any)=>r.id===s.router_id) || null;
    } else if (real) {
      rt = allRouters.find((r:any)=>r.id===real.router_id) || null;
    } else if (String(s.provisioning_mode||'').toUpperCase() === 'RADIUS') {
      if (radiusRouters.length) rt = radiusRouters[i % radiusRouters.length];
      else rt = directRouters[i % Math.max(1,directRouters.length)] || allRouters[0] || null;
    } else {
      rt = directRouters[i % Math.max(1,directRouters.length)] || allRouters[0] || null;
    }
    if (!rt) continue;

    const isDirect = ['API','REST'].includes(String(rt.integration_mode||'').toUpperCase());
    let online = false; let ip = s.ip_address; let mac = s.mac_address; let uptimeSec = 0; let rx = 0; let tx = 0;
    if (isDirect && real && real.router_id === rt.id) {
      online = true; ip = real.address || ip; mac = real.caller_id || mac;
      uptimeSec = parseUptimeSimple(real.uptime || '0s');
      rx = Number(real.rx_bps || 0); tx = Number(real.tx_bps || 0);
    } else if (isDirect && String(s.provisioning_mode||'').toUpperCase() === 'ROUTER') {
      online = false; // direct router but not in active list
    } else if (String(s.provisioning_mode||'').toUpperCase() === 'RADIUS') {
      // RADIUS: session state is driven by accounting (radacct overlay below) / NAS; do not fabricate traffic
      online = false; rx = 0; tx = 0; uptimeSec = 0;
    } else {
      // Fallback: unknown without telemetry/accounting
      online = false; rx = 0; tx = 0; uptimeSec = 0;
    }
    await pool.query(`INSERT INTO subscriber_sessions(subscriber_id,router_id,username,ip_address,mac_address,rx_bps,tx_bps,rx_bytes,tx_bytes,status,uptime_sec,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      ON CONFLICT (username, router_id) DO UPDATE SET subscriber_id=$1,ip_address=COALESCE($4,subscriber_sessions.ip_address),mac_address=COALESCE($5,subscriber_sessions.mac_address),rx_bps=$6,tx_bps=$7,rx_bytes=subscriber_sessions.rx_bytes+$6,tx_bytes=subscriber_sessions.tx_bytes+$7,status=$10,uptime_sec=$11,updated_at=now()`,
      [s.id, rt.id, uname, ip || null, mac || null, rx, tx, rx*5, tx*5, online?'ONLINE':'OFFLINE', uptimeSec]);
  }
  // Overlay RADIUS accounting (radacct) for live sessions where available
  try {
    const acct = await pool.query(`SELECT DISTINCT ON (username) username, framedipaddress::text as ip_address, nasipaddress::text as nas_ip, acctstarttime, acctupdatetime, acctsessiontime, acctinputoctets, acctoutputoctets
      FROM radacct WHERE acctstoptime IS NULL ORDER BY username, acctupdatetime DESC NULLS LAST, acctstarttime DESC`);
    for (const a of acct.rows) {
      const uname = String(a.username || '');
      if (!uname) continue;
      const sub = subs.rows.find((s:any)=>String(s.username)===uname);
      let rt = radiusRouters[0] || directRouters[0] || allRouters[0];
      if (sub && String(sub.provisioning_mode||'').toUpperCase() === 'ROUTER' && sub.router_id) rt = allRouters.find((r:any)=>r.id===sub.router_id) || rt;
      if (!rt) continue;
      const uptimeSec = Number(a.acctsessiontime || 0);
      await pool.query(`INSERT INTO subscriber_sessions(subscriber_id,router_id,username,ip_address,mac_address,rx_bps,tx_bps,rx_bytes,tx_bytes,status,uptime_sec,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ONLINE',$10,now())
        ON CONFLICT (username, router_id) DO UPDATE SET subscriber_id=COALESCE($1,subscriber_sessions.subscriber_id),ip_address=COALESCE($4,subscriber_sessions.ip_address),status='ONLINE',rx_bps=0,tx_bps=0,rx_bytes=$8,tx_bytes=$9,uptime_sec=$10,updated_at=now()`,
        [sub?.id || null, rt.id, uname, a.ip_address || sub?.ip_address || null, sub?.mac_address || null, 0, 0, Number(a.acctoutputoctets||0), Number(a.acctinputoctets||0), uptimeSec]);
    }
  } catch (_e) { /* radacct not available or no accounting yet */ }

  const q = String(req.query.q || '').toLowerCase();
  let rows = (await pool.query(`SELECT ss.*, s.full_name, s.client_code, s.provisioning_mode, r.name as router_name, r.integration_mode
    FROM subscriber_sessions ss
    LEFT JOIN subscribers s ON s.id=ss.subscriber_id LEFT JOIN network_routers r ON r.id=ss.router_id
    ORDER BY ss.status DESC, ss.updated_at DESC LIMIT 200`)).rows;
  if (q) rows = rows.filter((x:any)=>[x.username,x.full_name,x.client_code,x.ip_address,x.router_name].some(v=>String(v||'').toLowerCase().includes(q)));
  rows = rows.map((x:any) => ({ ...x, uptime: formatUptimeSec(Number(x.uptime_sec || 0)) }));
  // Best-effort automatic ONU↔subscriber linking (name/client_code + MAC/FDB correlation)
  try { await autoLinkOnusBulk({ allowFdb: true, limit: 30 }); } catch {}
  res.json({ data: rows, summary: { online: rows.filter((r:any)=>r.status==='ONLINE').length, total: rows.length, aggRxBps: rows.reduce((a:number,r:any)=>a+Number(r.rx_bps||0),0), aggTxBps: rows.reduce((a:number,r:any)=>a+Number(r.tx_bps||0),0) } });
}));

function parseUptimeSimple(s: string): number {
  let sec = 0; const re = /(\d+)(w|d|h|m|s)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) { const v = Number(m[1]); sec += m[2]==='w'?v*604800:m[2]==='d'?v*86400:m[2]==='h'?v*3600:m[2]==='m'?v*60:v; }
  return sec || 0;
}
function formatUptimeSec(sec: number): string {
  const s = Math.max(0, Number(sec || 0));
  if (!s) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// SSE live throughput stream
router.get('/sessions/stream', asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  let closed = false;
  req.on('close', () => { closed = true; });
  const send = async () => {
    if (closed) return;
    let rows = (await pool.query(`SELECT ss.username, ss.rx_bps, ss.tx_bps, ss.status, ss.ip_address, ss.uptime_sec, r.name as router_name, r.integration_mode, s.full_name, s.provisioning_mode
      FROM subscriber_sessions ss LEFT JOIN network_routers r ON r.id=ss.router_id LEFT JOIN subscribers s ON s.id=ss.subscriber_id
      ORDER BY ss.updated_at DESC LIMIT 50`)).rows;
    rows = rows.map((x:any) => ({ ...x, uptime: formatUptimeSec(Number(x.uptime_sec || 0)) }));
    const payload = { t: Date.now(), sessions: rows, summary: { online: rows.filter((r:any)=>r.status==='ONLINE').length, aggRxBps: rows.reduce((a:number,r:any)=>a+Number(r.rx_bps||0),0), aggTxBps: rows.reduce((a:number,r:any)=>a+Number(r.tx_bps||0),0) } };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  await send();
  const iv = setInterval(send, 3000);
  req.on('close', () => clearInterval(iv));
}));

export default router;
