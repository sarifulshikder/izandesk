import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { dispatchMessage } from '../integrations/messaging';
import { nextTicketNo } from '../utils/ticket-no';

const router: Router = Router();
function user(req:any){ return req.user || {}; }
async function resolveResellerIdForUser(req:any){
  const u = user(req);
  if (u.resellerId) {
    const r = await pool.query('SELECT id FROM resellers WHERE id::text=$1 OR lower(code)=lower($1) OR lower(subdomain)=lower($1) LIMIT 1', [String(u.resellerId)]);
    if (r.rows[0]) return r.rows[0].id as string;
  }
  if (u.email) {
    const r = await pool.query('SELECT id FROM resellers WHERE lower(email)=lower($1) LIMIT 1', [String(u.email)]);
    if (r.rows[0]) return r.rows[0].id as string;
  }
  return null;
}
async function canAccessTicket(req:any, ticketId:string){
  const u = user(req);
  if (['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'].includes(String(u.role))) return true;
  const t = (await pool.query('SELECT * FROM tickets WHERE id=$1', [ticketId])).rows[0];
  if (!t) return false;
  if (u.role === 'TECHNICIAN') {
    const name = String(u.name||'').toLowerCase(); const id = String(u.id||'');
    return String(t.assigned_technician_id||'') === id || String(t.assigned_technician_name||'').toLowerCase().includes(name) || !t.assigned_technician_id;
  }
  if (u.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    return !!rid && String(t.reseller_id||'') === String(rid);
  }
  return false;
}

function slaDue(priority: string, from = new Date()) {
  const hours = priority === 'CRITICAL' ? 4 : priority === 'HIGH' ? 8 : priority === 'LOW' ? 48 : 24;
  return new Date(from.getTime() + hours * 3600 * 1000);
}

router.get('/', asyncHandler(async (req, res) => {
  const u = user(req);
  const where: string[] = [];
  const params: any[] = [];
  if (u.role === 'TECHNICIAN') {
    params.push(u.name || '', u.id || '');
    where.push(`(t.assigned_technician_id = $${params.length} OR t.assigned_technician_name ILIKE '%' || $${params.length-1} || '%')`);
  }
  if (u.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    params.push(rid || u.resellerId || u.email || '');
    where.push(`(t.reseller_id::text = $${params.length})`);
  }
  const status = String(req.query.status || '').trim();
  if (status) { params.push(status); where.push(`t.status = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(`
    SELECT t.*, s.full_name as subscriber_name, s.client_code, s.phone as subscriber_phone,
           r.name as reseller_name
    FROM tickets t
    LEFT JOIN subscribers s ON s.id=t.subscriber_id
    LEFT JOIN resellers r ON r.id=t.reseller_id
    ${whereSql}
    ORDER BY t.created_at DESC
    LIMIT 300
  `, params);
  // mark breached in response (not persisted mutation except optional later)
  const now = Date.now();
  const data = r.rows.map((t:any)=>({ ...t, sla_breached: t.status !== 'RESOLVED' && t.status !== 'CLOSED' && t.sla_due_at ? new Date(t.sla_due_at).getTime() < now : !!t.sla_breached }));
  res.json({ data });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!(await canAccessTicket(req, req.params.id))) return res.status(403).json({ message: 'Forbidden' });
  const r = await pool.query(`
    SELECT t.*, s.full_name as subscriber_name, s.client_code, s.phone as subscriber_phone, s.address as subscriber_address,
           r.name as reseller_name
    FROM tickets t LEFT JOIN subscribers s ON s.id=t.subscriber_id LEFT JOIN resellers r ON r.id=t.reseller_id WHERE t.id=$1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Ticket not found' });
  const comments = await pool.query('SELECT * FROM ticket_comments WHERE ticket_id=$1 ORDER BY created_at ASC', [req.params.id]);
  res.json({ data: { ...r.rows[0], comments: comments.rows } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subject) return res.status(400).json({ message: 'subject is required' });
  const priority = b.priority || 'MEDIUM';
  const due = slaDue(priority);
  const ticketNo = b.ticket_no || await nextTicketNo();
  let siteAddress = b.site_address || null;
  let siteLat = b.site_latitude != null ? Number(b.site_latitude) : null;
  let siteLng = b.site_longitude != null ? Number(b.site_longitude) : null;
  if (b.subscriber_id && (!siteAddress || siteLat == null)) {
    const s = await pool.query('SELECT address, latitude, longitude, reseller_id FROM subscribers WHERE id=$1', [b.subscriber_id]);
    if (s.rows[0]) {
      siteAddress = siteAddress || s.rows[0].address;
      if (siteLat == null) siteLat = s.rows[0].latitude;
      if (siteLng == null) siteLng = s.rows[0].longitude;
      if (!b.reseller_id) b.reseller_id = s.rows[0].reseller_id;
    }
  }
  // Resellers may only file complaints for their own subscribers, and every
  // ticket they create is forced to their own partner account.
  if (user(req).role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (!rid) return res.status(403).json({ message: 'No reseller account linked to this login' });
    if (b.subscriber_id) {
      const owned = await pool.query('SELECT reseller_id FROM subscribers WHERE id=$1', [b.subscriber_id]);
      if (!owned.rows[0] || String(owned.rows[0].reseller_id || '') !== String(rid)) {
        return res.status(404).json({ message: 'Subscriber not found' });
      }
    }
    b.reseller_id = rid;
  }
  const gps = (siteLat != null && siteLng != null) ? `https://www.google.com/maps/search/?api=1&query=${siteLat},${siteLng}` : (siteAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteAddress)}` : null);
  const r = await pool.query(`INSERT INTO tickets(ticket_no,subscriber_id,reseller_id,subject,description,category,priority,status,sla_policy,sla_due_at,assigned_technician_id,assigned_technician_name,assigned_technician_phone,dispatch_status,site_latitude,site_longitude,site_address,gps_nav_url,source,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [ticketNo,b.subscriber_id||null,b.reseller_id||null,b.subject,b.description||null,b.category||'SUPPORT',priority,b.status||'OPEN',b.sla_policy||`${priority} SLA`,due,b.assigned_technician_id||null,b.assigned_technician_name||null,b.assigned_technician_phone||null,b.assigned_technician_id||b.assigned_technician_name?'DISPATCHED':'UNASSIGNED',siteLat,siteLng,siteAddress,gps,b.source||'PORTAL',user(req).email||user(req).id||'system']);
  try { await dispatchMessage({ provider: 'TELEGRAM_BOT', channel_type: 'TELEGRAM', body: `New ticket ${r.rows[0].ticket_no}: ${r.rows[0].subject}\nPriority: ${r.rows[0].priority} SLA due: ${new Date(r.rows[0].sla_due_at).toLocaleString()}\nSite: ${r.rows[0].site_address || '-'}`, related_type:'TICKET', related_id:String(r.rows[0].id), requireEnabled:false }); } catch {}
  res.status(201).json({ data: r.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  if (!(await canAccessTicket(req, req.params.id))) return res.status(403).json({ message: 'Forbidden' });
  const b = req.body || {};
  const cur = (await pool.query('SELECT * FROM tickets WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ message: 'Ticket not found' });
  const priority = b.priority || cur.priority;
  const slaDueAt = b.sla_due_at ? new Date(b.sla_due_at) : (b.priority && b.priority !== cur.priority ? slaDue(priority) : cur.sla_due_at);
  const status = b.status || cur.status;
  const closedAt = (status === 'RESOLVED' || status === 'CLOSED') ? (cur.closed_at || new Date()) : (b.closed_at || null);
  const assignedName = b.assigned_technician_name ?? cur.assigned_technician_name;
  const assignedId = b.assigned_technician_id ?? cur.assigned_technician_id;
  const dispatch = b.dispatch_status || ((assignedId || assignedName) ? (status === 'RESOLVED' || status === 'CLOSED' ? 'COMPLETED' : 'DISPATCHED') : cur.dispatch_status);
  const lat = b.site_latitude != null ? Number(b.site_latitude) : cur.site_latitude;
  const lng = b.site_longitude != null ? Number(b.site_longitude) : cur.site_longitude;
  const addr = b.site_address ?? cur.site_address;
  const gps = b.gps_nav_url || ((lat != null && lng != null) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : (addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : cur.gps_nav_url));
  const r = await pool.query(`UPDATE tickets SET subject=COALESCE($1,subject), description=$2, category=COALESCE($3,category), priority=COALESCE($4,priority), status=COALESCE($5,status), sla_due_at=$6, sla_breached=$7, assigned_technician_id=$8, assigned_technician_name=$9, assigned_technician_phone=$10, dispatch_status=$11, site_latitude=$12, site_longitude=$13, site_address=$14, gps_nav_url=$15, resolution_notes=$16, closed_at=$17, updated_at=now() WHERE id=$18 RETURNING *`,
    [b.subject,b.description ?? cur.description,b.category,priority,status,slaDueAt,false,assignedId,assignedName,b.assigned_technician_phone ?? cur.assigned_technician_phone,dispatch,lat,lng,addr,gps,b.resolution_notes ?? cur.resolution_notes,closedAt,req.params.id]);
  res.json({ data: r.rows[0] });
}));

router.post('/:id/comments', asyncHandler(async (req, res) => {
  if (!(await canAccessTicket(req, req.params.id))) return res.status(403).json({ message: 'Forbidden' });
  const b = req.body || {};
  if (!b.body) return res.status(400).json({ message: 'body is required' });
  const r = await pool.query(`INSERT INTO ticket_comments(ticket_id,author_name,author_role,body,is_internal) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id,b.author_name||user(req).name||user(req).email||'User',b.author_role||user(req).role||null,b.body,!!b.is_internal]);
  await pool.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [req.params.id]);
  res.status(201).json({ data: r.rows[0] });
}));

router.post('/:id/assign', asyncHandler(async (req, res) => {
  if (!['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'].includes(String(user(req).role))) return res.status(403).json({ message: 'Forbidden' });
  const b = req.body || {};
  const r = await pool.query(`UPDATE tickets SET assigned_technician_id=$1, assigned_technician_name=$2, assigned_technician_phone=$3, dispatch_status='DISPATCHED', status=CASE WHEN status='OPEN' THEN 'IN_PROGRESS' ELSE status END, updated_at=now() WHERE id=$4 RETURNING *`,
    [b.technician_id||null,b.technician_name||b.name||null,b.technician_phone||b.phone||null,req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Ticket not found' });
  await pool.query(`INSERT INTO ticket_comments(ticket_id,author_name,author_role,body,is_internal) VALUES($1,$2,$3,$4,false)`,
    [req.params.id,user(req).name||'System',user(req).role||'SYSTEM',`Assigned to ${b.technician_name||b.name||b.technician_id||'technician'} for dispatch.`]);
  try { await dispatchMessage({ provider: 'TELEGRAM_BOT', channel_type: 'TELEGRAM', body: `Ticket ${r.rows[0].ticket_no} assigned: ${r.rows[0].subject}\nPriority: ${r.rows[0].priority}\nTechnician: ${r.rows[0].assigned_technician_name || '-'}\nSite: ${r.rows[0].site_address || '-'}`, related_type:'TICKET', related_id:String(r.rows[0].id), requireEnabled:false }); } catch {}
  res.json({ data: r.rows[0] });
}));

export default router;
