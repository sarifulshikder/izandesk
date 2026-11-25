import { Router } from 'express';
import { pool } from '../db';
import {
  asyncHandler,
  getPagination,
  ValidationError,
  ConflictError,
  sanitizeSubscriber,
  sanitizeSubscribers,
} from './helpers';
import multer = require('multer');
import path = require('path');
import fs = require('fs');
import crypto = require('crypto');
import XLSX = require('xlsx');
import PDFDocument = require('pdfkit');
import { hashPassword, verifyPassword, generateNtPasswordHash, isHashed, sanitizePassword } from '../utils/password';
import { mikrotikRemovePppSecret } from '../integrations/mikrotik';
import { oltFindOnuByClientMac } from '../integrations/olt';
import { removeSubscriberFromRadiusDb, syncSubscriberToRadiusDb } from '../integrations/radius';
import { applyProvisioningState } from '../integrations/billing';
import { getBusinessDateYmd } from '../integrations/settings';
import { resellerScope, assertSubscriberOwnership } from './subscriber-scope';
import { auditLog, reqActor } from '../integrations/audit';
import {
  applyKycDecision, canResellerUploadKyc, canReviewKyc, createKycDocument,
  deleteKycDocument, normalizeDocType, readKycDocument,
} from '../integrations/kyc';
import { assertAllowedKycFileBuffer, sha256Buffer } from '../security/file-validation';
import { encryptKycBuffer, secureUnlinkKycFile } from '../security/file-encryption';
import { execFile } from 'child_process';

const router: Router = Router();

// SRZone-parity subscriber columns appended to the base INSERT/UPDATE statements.
const EXTRA_SUBSCRIBER_TEXT = [
  'external_customer_id', 'company_name', 'alt_email', 'alt_phone', 'nid_info', 'gps_location',
  'division', 'block_no', 'cable_serial_no', 'cable_length', 'cable_info', 'onu_info',
  'onu_owner', 'connection_established_by', 'ipv6_address', 'ipv6_prefix', 'branch_id',
];
const EXTRA_SUBSCRIBER_BOOL = ['static_ip', 'mac_lock', 'multi_session', 'bill_cycle_enabled', 'parental_control_enabled'];
const EXTRA_SUBSCRIBER_OTHER = ['old_expiry_date', 'excess_amount'];
const EXTRA_SUBSCRIBER_FIELDS = [...EXTRA_SUBSCRIBER_TEXT, ...EXTRA_SUBSCRIBER_BOOL, ...EXTRA_SUBSCRIBER_OTHER];
const EXTRA_FIELD_COUNT = EXTRA_SUBSCRIBER_FIELDS.length;

const uploadDir = path.resolve(__dirname, '../../../uploads/kyc');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const importUploadDir = path.resolve(__dirname, '../../../uploads/imports');
if (!fs.existsSync(importUploadDir)) fs.mkdirSync(importUploadDir, { recursive: true });

const SUBSCRIBER_TYPES = ['HOME', 'CORPORATE', 'HOTSPOT'];
const CONNECTION_TYPES = ['PPPOE', 'STATIC_IP', 'DHCP', 'HOTSPOT', 'LEASED_LINE_CIR'];
const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED'];
const SUSPENSION_STAGES = ['NONE', 'WARNING', 'GRACE', 'ISOLATED', 'WALLED_GARDEN', 'SUSPENDED'];
const MAX_KYC_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

// KYC uploads stay in memory until they are encrypted; plaintext never lands in the document store.
const kycStorage = multer.memoryStorage();
const upload = multer({
  storage: kycStorage,
  limits: { fileSize: MAX_KYC_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i.test(file.mimetype)) {
      return cb(new ValidationError('Only PNG, JPEG, WebP, GIF or PDF files are allowed'));
    }
    cb(null, true);
  },
});

const importStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, importUploadDir),
  filename: (_req, file, cb) => {
    // Unguessable name: KYC documents must not be reachable by file enumeration.
    const safe = crypto.randomUUID() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const importUpload = multer({
  storage: importStorage,
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/csv',
    ];
    if (!allowed.includes(file.mimetype) && !/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      return cb(new ValidationError('Only XLSX, XLS or CSV files are allowed'));
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ */
/* Small parsing / validation helpers                                  */
/* ------------------------------------------------------------------ */

function has(obj: any, key: string) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}
function str(v: any): string {
  return v === undefined || v === null ? '' : String(v).trim();
}
function nullableStr(v: any): string | null {
  const s = str(v);
  return s === '' ? null : s;
}
function enumVal(v: any, allowed: string[], field: string, fallback: string): string {
  const s = str(v).toUpperCase() || fallback;
  if (!allowed.includes(s)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return s;
}
function intVal(v: any, field: string, opts: { min?: number; max?: number } = {}): number | null {
  const min = opts.min ?? 0;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number`);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
  return n;
}
function moneyVal(v: any, field: string): number {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${field} must be a non-negative amount`);
  if (n > 999999999) throw new ValidationError(`${field} is too large`);
  return Math.round(n * 100) / 100;
}
function dateVal(v: any, field: string): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new ValidationError(`${field} must be a valid date`);
  return d.toISOString().slice(0, 10);
}
function boolVal(v: any, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || String(v).toLowerCase() === 'true' || v === '1' || v === 1;
}

/* ------------------------------------------------------------------ */
/* Client-code generation (sequence based, collision safe)             */
/* ------------------------------------------------------------------ */

async function nextClientCode(areaId?: string | null) {
  let prefix = 'IZN';
  if (areaId) {
    const a = await pool.query('SELECT name FROM areas WHERE id=$1', [areaId]);
    if (a.rows[0]?.name) {
      prefix = 'IZN-' + str(a.rows[0].name).substring(0, 3).toUpperCase();
    }
  }
  const r = await pool.query("SELECT nextval('subscriber_client_code_seq')::int AS n");
  const n = Number(r.rows[0]?.n || 1);
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Provisioning normalization                                          */
/* ------------------------------------------------------------------ */

async function normalizeProvisioning(b: any, cur?: any) {
  const provisioning_mode = str(b.provisioning_mode ?? cur?.provisioning_mode ?? 'RADIUS').toUpperCase();
  let router_id: string | null = b.router_id ?? cur?.router_id ?? null;
  if (provisioning_mode === 'RADIUS') {
    router_id = null;
  } else if (provisioning_mode === 'ROUTER') {
    if (!router_id) throw new ValidationError('router_id is required when provisioning_mode is ROUTER (select a specific API/REST router)');
    const r = await pool.query('SELECT id, integration_mode FROM network_routers WHERE id=$1', [router_id]);
    if (!r.rows[0]) throw new ValidationError('Selected router not found');
    const mode = str(r.rows[0].integration_mode).toUpperCase();
    if (mode === 'RADIUS') throw new ValidationError('Selected router is RADIUS-mode. Choose an API/REST router for direct provisioning, or select RADIUS mode.');
  } else {
    throw new ValidationError('provisioning_mode must be ROUTER or RADIUS');
  }
  return { provisioning_mode, router_id };
}

/* ------------------------------------------------------------------ */
/* Reference + hierarchy validation                                    */
/* ------------------------------------------------------------------ */

async function validateReferences(p: any) {
  if (p.area_id) {
    const r = await pool.query('SELECT id FROM areas WHERE id=$1', [p.area_id]);
    if (!r.rows[0]) throw new ValidationError('Selected area does not exist');
  }
  if (p.zone_id) {
    const r = await pool.query('SELECT id, area_id FROM zones WHERE id=$1', [p.zone_id]);
    if (!r.rows[0]) throw new ValidationError('Selected zone does not exist');
    if (p.area_id && r.rows[0].area_id !== p.area_id) throw new ValidationError('Selected zone does not belong to the selected area');
  }
  if (p.distribution_box_id) {
    const r = await pool.query('SELECT id, zone_id FROM distribution_boxes WHERE id=$1', [p.distribution_box_id]);
    if (!r.rows[0]) throw new ValidationError('Selected distribution box does not exist');
    if (p.zone_id && r.rows[0].zone_id !== p.zone_id) throw new ValidationError('Selected distribution box does not belong to the selected zone');
  }
  if (p.router_id) {
    const r = await pool.query('SELECT id FROM network_routers WHERE id=$1', [p.router_id]);
    if (!r.rows[0]) throw new ValidationError('Selected router does not exist');
  }
  if (p.reseller_id) {
    const r = await pool.query('SELECT id FROM resellers WHERE id=$1', [p.reseller_id]);
    if (!r.rows[0]) throw new ValidationError('Selected reseller does not exist');
  }
}

/* ------------------------------------------------------------------ */
/* Payload builder (create + update)                                   */
/* ------------------------------------------------------------------ */

async function buildPayload(b: any, cur: any) {
  const get = (k: string) => (has(b, k) ? b[k] : cur?.[k]);
  // Date fields need special handling on partial updates: `cur` comes back from
  // Postgres as a timezone-aware ISO string (e.g. 2026-12-05T18:00Z for a local
  // date of 2026-12-06). Re-parsing that with dateVal() would shift the stored
  // date back one day on every unrelated PUT. Only normalize dates supplied by
  // the caller; keep existing values byte-for-byte when the field is absent.
  const dateField = (key: string) => has(b, key) ? dateVal(b[key], key) : (cur?.[key] ?? null);
  const p: any = {};

  p.full_name = str(get('full_name'));
  if (!p.full_name) throw new ValidationError('full_name is required');
  if (p.full_name.length > 200) throw new ValidationError('full_name is too long (max 200 characters)');

  p.subscriber_type = enumVal(get('subscriber_type'), SUBSCRIBER_TYPES, 'subscriber_type', 'HOME');
  p.connection_type = enumVal(get('connection_type'), CONNECTION_TYPES, 'connection_type', 'PPPOE');
  p.status = enumVal(get('status'), STATUSES, 'status', 'PENDING');

  p.username = nullableStr(get('username'));
  if (p.username) {
    if (!/^[A-Za-z0-9._@:-]{3,64}$/.test(p.username)) {
      throw new ValidationError('username must be 3-64 characters (letters, digits, . _ @ : -)');
    }
    const dup = await pool.query('SELECT id FROM subscribers WHERE username=$1', [p.username]);
    if (dup.rows[0] && dup.rows[0].id !== (cur?.id || null)) {
      throw new ConflictError(`Username "${p.username}" is already in use`);
    }
  }

  // Password handling: `password` is the cleartext PPPoE/RADIUS secret used for
  // provisioning; `portal_password` is the bcrypt hash for customer-portal login.
  const rawPassword = has(b, 'password') ? nullableStr(b.password) : null;
  if (rawPassword !== null && rawPassword !== '') {
    p.password = rawPassword;
    p.portal_password = await hashPassword(rawPassword);
  } else if (cur?.password || cur?.portal_password) {
    p.password = cur.password ?? null;
    p.portal_password = cur.portal_password ?? null;
  } else {
    p.password = null;
    p.portal_password = null;
  }

  p.phone = nullableStr(get('phone'));
  if (p.phone && !/^\+?[0-9\s\-()]{7,20}$/.test(p.phone)) throw new ValidationError('phone number format is invalid');
  p.email = nullableStr(get('email'));
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new ValidationError('email address format is invalid');
  p.nid_number = nullableStr(get('nid_number'));

  p.package_name = nullableStr(get('package_name'));
  p.bandwidth_mbps = intVal(get('bandwidth_mbps'), 'bandwidth_mbps', { min: 0, max: 100000 });
  p.monthly_bill = moneyVal(get('monthly_bill'), 'monthly_bill');

  p.area_id = nullableStr(get('area_id'));
  p.zone_id = nullableStr(get('zone_id'));
  p.distribution_box_id = nullableStr(get('distribution_box_id'));
  p.address = nullableStr(get('address'));

  const la = get('latitude');
  const lo = get('longitude');
  const laN = la === '' || la === null || la === undefined ? null : Number(la);
  const loN = lo === '' || lo === null || lo === undefined ? null : Number(lo);
  if ((laN !== null && !Number.isFinite(laN)) || (loN !== null && !Number.isFinite(loN))) {
    throw new ValidationError('latitude/longitude must be valid numbers');
  }
  if ((laN !== null || loN !== null) && (laN === null || loN === null)) {
    throw new ValidationError('latitude and longitude must be provided together');
  }
  p.latitude = laN;
  p.longitude = loN;

  p.ip_address = nullableStr(get('ip_address'));
  p.mac_address = nullableStr(get('mac_address'));
  p.installation_date = dateField('installation_date');

  p.district = nullableStr(get('district'));
  p.thana = nullableStr(get('thana'));
  p.upazila = nullableStr(get('upazila'));
  p.post_office = nullableStr(get('post_office'));
  p.village = nullableStr(get('village'));
  p.area_name = nullableStr(get('area_name'));
  p.ward_no = nullableStr(get('ward_no'));
  p.road_no = nullableStr(get('road_no'));
  p.house_no = nullableStr(get('house_no'));
  p.notes = nullableStr(get('notes'));

  p.billing_cycle_day = intVal(get('billing_cycle_day'), 'billing_cycle_day', { min: 1, max: 31 }) ?? 1;
  p.expiry_date = dateField('expiry_date');
  p.due_date = dateField('due_date');
  p.next_bill_date = dateField('next_bill_date');
  p.auto_suspend_enabled = boolVal(get('auto_suspend_enabled'), cur?.auto_suspend_enabled ?? true);
  p.auto_pay_enabled = boolVal(get('auto_pay_enabled'), cur?.auto_pay_enabled ?? false);

  p.reseller_id = nullableStr(get('reseller_id'));
  const po = get('price_override');
  p.price_override = (po === '' || po === null || po === undefined) ? null : moneyVal(po, 'price_override');
  p.custom_package_note = nullableStr(get('custom_package_note'));
  p.extended_expiry = boolVal(get('extended_expiry'), cur?.extended_expiry ?? false);
  p.branch_name = nullableStr(get('branch_name'));

  // SRZone-parity fields
  for (const key of EXTRA_SUBSCRIBER_TEXT) p[key] = nullableStr(get(key));
  for (const key of EXTRA_SUBSCRIBER_BOOL) p[key] = boolVal(get(key), cur?.[key] ?? false);
  p.old_expiry_date = dateField('old_expiry_date');
  p.excess_amount = moneyVal(get('excess_amount') ?? 0, 'excess_amount') ?? 0;

  await validateReferences(p);
  const prov = await normalizeProvisioning(b, cur);
  p.provisioning_mode = prov.provisioning_mode;
  p.router_id = prov.router_id;

  return p;
}

function stageForStatus(status: string): string {
  switch (status) {
    case 'SUSPENDED': return 'SUSPENDED';
    case 'EXPIRED': return 'GRACE';
    case 'TERMINATED': return 'ISOLATED';
    default: return 'NONE';
  }
}

/* ------------------------------------------------------------------ */
/* Reseller RBAC scoping                                               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Remove PPP secret helper                                            */
/* ------------------------------------------------------------------ */

async function removePppSecretFromRouter(routerId: string | null | undefined, username: string | null | undefined) {
  if (!routerId || !username) return null;
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [routerId]);
  const router = r.rows[0];
  if (!router) return null;
  const mode = str(router.integration_mode).toUpperCase();
  if (mode !== 'API' && mode !== 'REST') return null;
  try { return await mikrotikRemovePppSecret(router, String(username)); } catch (e: any) { return { ok: false, error: e.message }; }
}

/* ------------------------------------------------------------------ */
/* Shared SELECT fragments                                             */
/* ------------------------------------------------------------------ */

const FROM_SQL = `
  FROM subscribers s
  LEFT JOIN areas a ON a.id=s.area_id
  LEFT JOIN zones z ON z.id=s.zone_id
  LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id
  LEFT JOIN network_routers nr ON nr.id=s.router_id
  LEFT JOIN resellers rs ON rs.id=s.reseller_id`;

const LIST_SELECT = `
  SELECT s.*, a.name as area_name, z.name as zone_name, d.name as distribution_box_name, d.code as distribution_box_code,
         nr.name as router_name, nr.integration_mode as router_integration_mode,
         rs.name as reseller_name, rs.code as reseller_code
  ${FROM_SQL}`;

function buildFilters(req: any, bizToday: string) {
  const q = str(req.query.q).toLowerCase();
  const status = str(req.query.status);
  const type = str(req.query.type || req.query.subscriber_type);
  const zoneId = str(req.query.zone_id);
  const areaId = str(req.query.area_id);
  const resellerId = str(req.query.reseller_id);
  const routerId = str(req.query.router_id);
  const pkg = str(req.query.package);
  const due = str(req.query.due || req.query.overdue);
  const expiringRaw = str(req.query.expiring_days || req.query.expiring || req.query.expiring_soon);
  const expiringTomorrow = str(req.query.expiring_tomorrow);
  const validityExpired = str(req.query.validity_expired || req.query.expired_validity);
  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(lower(s.full_name) LIKE $${params.length} OR lower(s.client_code) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length} OR lower(COALESCE(s.phone,'')) LIKE $${params.length} OR lower(COALESCE(s.email,'')) LIKE $${params.length} OR lower(COALESCE(s.address,'')) LIKE $${params.length} OR lower(COALESCE(s.package_name,'')) LIKE $${params.length} OR lower(COALESCE(d.name,'')) LIKE $${params.length} OR lower(COALESCE(nr.name,'')) LIKE $${params.length})`);
  }
  if (status) {
    const st = status.toUpperCase();
    if (st === 'EXPIRING' || st === 'EXPIRING_SOON') {
      params.push(bizToday);
      where.push(`s.expiry_date >= $${params.length}::date AND s.expiry_date <= $${params.length}::date + 7 AND s.status NOT IN ('TERMINATED')`);
    } else if (st === 'DUE' || st === 'OVERDUE' || st === 'HAS_DUE') {
      where.push(`COALESCE(s.current_due, 0) > 0`);
    } else if (st === 'EXPIRED_VALIDITY' || st === 'VALIDITY_EXPIRED') {
      params.push(bizToday);
      where.push(`s.expiry_date < $${params.length}::date AND s.status NOT IN ('TERMINATED')`);
    } else {
      params.push(status);
      where.push(`s.status = $${params.length}`);
    }
  }
  if (type) { params.push(type); where.push(`s.subscriber_type = $${params.length}`); }
  if (zoneId) { params.push(zoneId); where.push(`s.zone_id = $${params.length}`); }
  if (areaId) { params.push(areaId); where.push(`s.area_id = $${params.length}`); }
  if (resellerId) { params.push(resellerId); where.push(`s.reseller_id = $${params.length}`); }
  if (routerId) { params.push(routerId); where.push(`s.router_id = $${params.length}`); }
  if (pkg) { params.push(`%${pkg}%`); where.push(`s.package_name LIKE $${params.length}`); }
  if (due === '1' || due === 'true' || due === 'yes') { where.push(`COALESCE(s.current_due, 0) > 0`); }
  if (validityExpired === '1' || validityExpired === 'true' || validityExpired === 'yes') {
    params.push(bizToday);
    where.push(`s.expiry_date < $${params.length}::date AND s.status NOT IN ('TERMINATED')`);
  }
  if (expiringTomorrow === '1' || expiringTomorrow === 'true' || expiringRaw.toLowerCase() === 'tomorrow') {
    params.push(bizToday);
    where.push(`s.expiry_date = $${params.length}::date + 1 AND s.status NOT IN ('TERMINATED')`);
  } else if (expiringRaw) {
    const days = Math.max(1, Math.min(365, parseInt(expiringRaw === '1' || expiringRaw === 'true' || expiringRaw === 'soon' ? '7' : expiringRaw, 10) || 7));
    params.push(bizToday);
    params.push(days);
    where.push(`s.expiry_date >= $${params.length - 1}::date AND s.expiry_date <= $${params.length - 1}::date + $${params.length} * INTERVAL '1 day' AND s.status NOT IN ('TERMINATED')`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

// Status summary cards (must be registered before '/:id')
router.get('/summary', asyncHandler(async (req, res) => {
  const scope = await resellerScope(req);
  if (scope.restricted && !scope.uuid) return res.json({ ok: true, summary: { total: 0, by_status: {}, active: 0, pending: 0, suspended: 0, expired: 0, expired_validity: 0, terminated: 0, expiring_soon: 0, expiring_tomorrow: 0, overdue: 0 } });
  const bizToday = await getBusinessDateYmd();
  const params: any[] = [];
  let where = '';
  if (scope.uuid) { params.push(scope.uuid); where = 'WHERE reseller_id=$1'; }
  const whereAnd = where ? `${where} AND` : 'WHERE';
  const total = (await pool.query(`SELECT COUNT(*)::int AS c FROM subscribers ${where}`, params)).rows[0].c;
  const byStatus = (await pool.query(`SELECT status, COUNT(*)::int AS c FROM subscribers ${where} GROUP BY status`, params)).rows;
  const expiring = (await pool.query(`SELECT COUNT(*)::int AS c FROM subscribers ${whereAnd} expiry_date >= $${params.length + 1}::date AND expiry_date <= $${params.length + 1}::date + 7 AND status NOT IN ('TERMINATED')`, [...params, bizToday])).rows[0].c;
  const expiringTomorrow = (await pool.query(`SELECT COUNT(*)::int AS c FROM subscribers ${whereAnd} expiry_date = $${params.length + 1}::date + 1 AND status NOT IN ('TERMINATED')`, [...params, bizToday])).rows[0].c;
  const overdue = (await pool.query(`SELECT COUNT(*)::int AS c FROM subscribers ${whereAnd} current_due > 0`, params)).rows[0].c;
  const expiredValidity = (await pool.query(`SELECT COUNT(*)::int AS c FROM subscribers ${whereAnd} expiry_date < $${params.length + 1}::date AND status NOT IN ('TERMINATED')`, [...params, bizToday])).rows[0].c;
  const by_status: Record<string, number> = {};
  for (const r of byStatus) by_status[r.status] = Number(r.c);
  res.json({
    ok: true,
    summary: {
      total: Number(total),
      by_status,
      active: by_status.ACTIVE || 0,
      pending: by_status.PENDING || 0,
      suspended: by_status.SUSPENDED || 0,
      expired: by_status.EXPIRED || 0,
      expired_validity: Number(expiredValidity),
      terminated: by_status.TERMINATED || 0,
      expiring_soon: Number(expiring),
      expiring_tomorrow: Number(expiringTomorrow),
      overdue: Number(overdue),
    },
  });
}));

// Compact, tenant-scoped area aggregates for the dashboard. Connectivity uses
// the same last-known subscriber_sessions state as the live-session dashboard.
router.get('/area-health', asyncHandler(async (req, res) => {
  const scope = await resellerScope(req);
  if (scope.restricted && !scope.uuid) return res.json({ ok: true, data: [], total: 0 });
  const bizToday = await getBusinessDateYmd();
  const params: any[] = [];
  let where = '';
  if (scope.uuid) { params.push(scope.uuid); where = 'WHERE s.reseller_id=$1'; }
  params.push(bizToday);
  const todayParam = `$${params.length}::date`;
  const rows = (await pool.query(`
    WITH online_subscribers AS (
      SELECT DISTINCT subscriber_id FROM subscriber_sessions
      WHERE status='ONLINE' AND subscriber_id IS NOT NULL
    )
    SELECT a.id AS area_id, COALESCE(a.name, 'Unassigned') AS area_name,
      COUNT(s.id)::int AS total,
      (COUNT(s.id) FILTER (WHERE s.status='ACTIVE'))::int AS active,
      (COUNT(s.id) FILTER (WHERE s.status='SUSPENDED'))::int AS suspended,
      (COUNT(s.id) FILTER (WHERE s.status='EXPIRED'))::int AS expired,
      (COUNT(s.id) FILTER (WHERE s.expiry_date < ${todayParam} AND s.status <> 'TERMINATED'))::int AS expired_validity,
      (COUNT(s.id) FILTER (WHERE os.subscriber_id IS NOT NULL))::int AS online,
      (COUNT(s.id) FILTER (WHERE COALESCE(s.current_due,0) > 0))::int AS due,
      (COUNT(s.id) FILTER (WHERE s.expiry_date BETWEEN ${todayParam} AND ${todayParam} + 7 AND s.status <> 'TERMINATED'))::int AS expiring
    FROM subscribers s
    LEFT JOIN areas a ON a.id=s.area_id
    LEFT JOIN online_subscribers os ON os.subscriber_id=s.id
    ${where}
    GROUP BY a.id, a.name
    ORDER BY expired_validity DESC, due DESC, total DESC, area_name ASC`, params)).rows;
  res.json({ ok: true, data: rows.slice(0, 8), total: rows.length });
}));

router.get('/renewals', asyncHandler(async (req, res) => {
  const scope = await resellerScope(req);
  const days = Math.max(1, Math.min(30, parseInt(String(req.query.days || '7'), 10) || 7));
  const limit = Math.max(1, Math.min(20, parseInt(String(req.query.limit || '6'), 10) || 6));
  if (scope.restricted && !scope.uuid) return res.json({ ok: true, data: [], total: 0, days });
  const bizToday = await getBusinessDateYmd();
  const params: any[] = [bizToday, days];
  const where = [`s.expiry_date >= $1::date`, `s.status <> 'TERMINATED'`, `s.expiry_date <= $1::date + $2 * INTERVAL '1 day'`];
  if (scope.uuid) { params.push(scope.uuid); where.push(`s.reseller_id=$${params.length}`); }
  params.push(limit);
  const rows = (await pool.query(`
    SELECT s.id, s.full_name, s.client_code, s.username, s.package_name,
      s.monthly_bill, s.current_due, s.expiry_date, s.status,
      (s.expiry_date - $1::date)::int AS days_left, COUNT(*) OVER()::int AS total_matching
    FROM subscribers s
    WHERE ${where.join(' AND ')}
    ORDER BY s.expiry_date ASC, COALESCE(s.current_due,0) DESC, s.full_name ASC
    LIMIT $${params.length}`, params)).rows;
  const total = Number(rows[0]?.total_matching || 0);
  const data = rows.map((r: any) => { const { total_matching: _total, ...item } = r; return item; });
  res.json({ ok: true, data, total, days });
}));

// CSV export (must be registered before '/:id')
router.get('/export', asyncHandler(async (req, res) => {
  const scope = await resellerScope(req);
  const bizToday = await getBusinessDateYmd();
  const { whereSql, params } = buildFilters(req, bizToday);
  const scopedParams = [...params];
  let scopedWhere = whereSql;
  if (scope.uuid) { scopedParams.push(scope.uuid); scopedWhere = scopedWhere ? `${scopedWhere} AND s.reseller_id=$${scopedParams.length}` : `WHERE s.reseller_id=$${scopedParams.length}`; }
  else if (scope.restricted) return res.json({ ok: false, message: 'No reseller account linked' });
  const rows = (await pool.query(`${LIST_SELECT} ${scopedWhere} ORDER BY s.created_at DESC LIMIT 5000`, scopedParams)).rows;

  const headers = ['Client Code', 'Full Name', 'Type', 'Status', 'Phone', 'Email', 'Username', 'Package', 'Bandwidth Mbps', 'Monthly Bill', 'Current Due', 'Connection', 'Provisioning', 'Router', 'Reseller', 'Area', 'Zone', 'Distribution Box', 'Address', 'District', 'Thana', 'Upazila', 'Post Office', 'Village', 'Ward', 'Road', 'House', 'Installation Date', 'Expiry Date', 'Due Date', 'Next Bill Date', 'Latitude', 'Longitude', 'Created At', 'Notes'];
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.client_code, r.full_name, r.subscriber_type, r.status, r.phone, r.email, r.username, r.package_name,
      r.bandwidth_mbps, r.monthly_bill, r.current_due, r.connection_type, r.provisioning_mode, r.router_name,
      r.reseller_name, r.area_name, r.zone_name, r.distribution_box_name, r.address, r.district, r.thana, r.upazila,
      r.post_office, r.village, r.ward_no, r.road_no, r.house_no, r.installation_date, r.expiry_date, r.due_date,
      r.next_bill_date, r.latitude, r.longitude, r.created_at, r.notes,
    ].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
  res.send('﻿' + lines.join('\r\n'));
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const bizToday = await getBusinessDateYmd();
  const { whereSql, params } = buildFilters(req, bizToday);
  const scope = await resellerScope(req);
  if (scope.restricted && !scope.uuid) return res.json({ data: [], total: 0, page, limit });
  const scopedParams = [...params];
  let scopedWhere = whereSql;
  if (scope.uuid) { scopedParams.push(scope.uuid); scopedWhere = scopedWhere ? `${scopedWhere} AND s.reseller_id=$${scopedParams.length}` : `WHERE s.reseller_id=$${scopedParams.length}`; }
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total ${FROM_SQL} ${scopedWhere}`, scopedParams);
  scopedParams.push(limit, offset);
  const rowsRes = await pool.query(`${LIST_SELECT} ${scopedWhere} ORDER BY s.created_at DESC LIMIT $${scopedParams.length - 1} OFFSET $${scopedParams.length}`, scopedParams);
  res.json({ data: sanitizeSubscribers(rowsRes.rows), total: totalRes.rows[0].total, page, limit });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  const r = await pool.query(`${LIST_SELECT} WHERE s.id=$1`, [req.params.id]);
  const sub = r.rows[0];
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });

  const kyc = await pool.query('SELECT * FROM kyc_documents WHERE subscriber_id=$1 ORDER BY uploaded_at DESC', [req.params.id]);
  let quota: any = null;
  let pkg: any = null;
  try {
    if (sub.package_name) {
      pkg = (await pool.query('SELECT id,name,download_mbps,upload_mbps,price,data_cap_gb,fup_speed_mbps FROM bandwidth_packages WHERE name=$1 LIMIT 1', [sub.package_name])).rows[0] || null;
    }
    if (pkg?.data_cap_gb != null) {
      const u = (await pool.query(`SELECT COALESCE(SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0)),0)::bigint AS used_bytes
        FROM radacct WHERE username=$1 AND acctstarttime >= date_trunc('month', now())`, [sub.username || ''])).rows[0];
      const used = Number(u?.used_bytes || 0);
      const capBytes = Number(pkg.data_cap_gb) * 1024 * 1024 * 1024;
      quota = { period: 'current_month', cap_gb: Number(pkg.data_cap_gb), fup_speed_mbps: pkg.fup_speed_mbps, used_bytes: used, remaining_bytes: Math.max(0, capBytes - used), over_cap: used > capBytes, percent: capBytes > 0 ? Math.min(999, (used / capBytes) * 100) : 0 };
    }
  } catch {}

  const invoices = (await pool.query(`SELECT id, invoice_number, bill_month, total_amount, due_amount, status, issue_date, due_date, paid_at
    FROM invoices WHERE subscriber_id=$1 ORDER BY created_at DESC LIMIT 10`, [req.params.id])).rows;
  const sessions = (await pool.query(`SELECT * FROM subscriber_sessions WHERE subscriber_id=$1 ORDER BY updated_at DESC LIMIT 5`, [req.params.id])).rows;
  const radiusUser = sub.username
    ? (await pool.query('SELECT username, profile, framed_ip_address, status, last_synced_at, last_error FROM radius_users WHERE username=$1', [sub.username])).rows[0] || null
    : null;
  const suspensionLogs = (await pool.query(`SELECT id, action, stage, reason, details, triggered_by, created_at FROM billing_suspension_logs WHERE subscriber_id=$1 ORDER BY created_at DESC LIMIT 10`, [req.params.id])).rows;

  res.json(sanitizeSubscriber({
    ...sub,
    kyc_documents: kyc.rows,
    quota,
    package_info: pkg,
    invoices,
    sessions,
    radius_user: radiusUser,
    suspension_logs: suspensionLogs,
  }));
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const p = await buildPayload(b, null);
  // A reseller may only create subscribers under their own account — never under a
  // reseller_id supplied by the client (the reseller portal used to send one explicitly).
  const scope = await resellerScope(req);
  if (scope.restricted) {
    if (!scope.uuid) throw new ValidationError('No reseller account linked to this login');
    p.reseller_id = scope.uuid;
  }
  // Auto-fill from package when assigned but fields were not explicitly set.
  let pkgForExpiry: any = null;
  if (p.package_name) {
    pkgForExpiry = (await pool.query('SELECT price, download_mbps, upload_mbps, validity_value, validity_unit FROM bandwidth_packages WHERE name=$1 LIMIT 1', [p.package_name])).rows[0] || null;
    if (pkgForExpiry) {
      const reqBill = b.monthly_bill ?? b.monthlyBill;
      if ((p.monthly_bill === 0 || p.monthly_bill == null) && Number(pkgForExpiry.price || 0) > 0 && (reqBill === '' || reqBill == null || Number(reqBill) === 0)) p.monthly_bill = Number(pkgForExpiry.price);
      const reqBw = b.bandwidth_mbps ?? b.bandwidthMbps;
      if ((p.bandwidth_mbps == null || p.bandwidth_mbps === 0) && Number(pkgForExpiry.download_mbps || 0) > 0 && (reqBw === '' || reqBw == null || Number(reqBw) === 0)) p.bandwidth_mbps = Number(pkgForExpiry.download_mbps);
    }
  }
  if (!p.expiry_date && p.package_name) {
    const base = p.installation_date ? new Date(String(p.installation_date)) : new Date();
    const unit = String(pkgForExpiry?.validity_unit || 'CALENDAR_MONTH').toUpperCase();
    const val = Math.max(1, Number(pkgForExpiry?.validity_value || 1));
    const exp = new Date(base);
    if (unit === 'DAYS') exp.setDate(exp.getDate() + val);
    else if (unit === 'MONTHS') exp.setMonth(exp.getMonth() + val);
    else exp.setMonth(exp.getMonth() + 1); // CALENDAR_MONTH default
    p.expiry_date = exp.toISOString().slice(0, 10);
  }

  let clientCode = nullableStr(b.client_code);
  if (clientCode) {
    const dup = await pool.query('SELECT id FROM subscribers WHERE client_code=$1', [clientCode]);
    if (dup.rows[0]) throw new ConflictError(`Client code "${clientCode}" is already in use`);
  } else {
    clientCode = await nextClientCode(p.area_id);
  }

  const insertSql = `
    INSERT INTO subscribers (
      client_code, full_name, subscriber_type, connection_type, username, password, phone, email, nid_number,
      package_name, bandwidth_mbps, monthly_bill, status, area_id, zone_id, distribution_box_id, address,
      latitude, longitude, location, ip_address, mac_address, installation_date,
      district, thana, upazila, post_office, village, area_name, ward_no, road_no, house_no, notes,
      billing_cycle_day, expiry_date, due_date, next_bill_date, auto_suspend_enabled, auto_pay_enabled,
      provisioning_mode, router_id, reseller_id, price_override, custom_package_note, extended_expiry, branch_name,
      ${EXTRA_SUBSCRIBER_FIELDS.join(', ')}, portal_password
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
      CASE WHEN $18::float IS NOT NULL AND $19::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($19,$18),4326)::geography ELSE NULL END,
      $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
      $33,$34,$35,$36,$37,$38,
      $39,$40,$41,$42,$43,$44,$45,
      ${EXTRA_SUBSCRIBER_FIELDS.map((_, i) => `$${46 + i}`).join(',')},
      $${46 + EXTRA_FIELD_COUNT}
    ) RETURNING *`;
  const values = [
    clientCode, p.full_name, p.subscriber_type, p.connection_type, p.username, p.password, p.phone, p.email, p.nid_number,
    p.package_name, p.bandwidth_mbps, p.monthly_bill, p.status, p.area_id, p.zone_id, p.distribution_box_id, p.address,
    p.latitude, p.longitude, p.ip_address, p.mac_address, p.installation_date,
    p.district, p.thana, p.upazila, p.post_office, p.village, p.area_name, p.ward_no, p.road_no, p.house_no, p.notes,
    p.billing_cycle_day, p.expiry_date, p.due_date, p.next_bill_date, p.auto_suspend_enabled, p.auto_pay_enabled,
    p.provisioning_mode, p.router_id, p.reseller_id, p.price_override, p.custom_package_note, p.extended_expiry, p.branch_name,
    ...EXTRA_SUBSCRIBER_FIELDS.map((key) => p[key] ?? null),
    p.portal_password ?? null,
  ];

  let created: any = null;
  for (let attempt = 0; attempt < 4 && !created; attempt++) {
    try {
      created = (await pool.query(insertSql, values)).rows[0];
    } catch (e: any) {
      const isClientCodeConflict = e.code === '23505' && /client_code/i.test(e.message || '');
      if (isClientCodeConflict && !clientCode) {
        values[0] = await nextClientCode(p.area_id);
        continue;
      }
      if (isClientCodeConflict) throw new ConflictError(`Client code "${clientCode}" is already in use`);
      throw e;
    }
  }
  if (!created) throw new Error('Could not allocate a unique client code');

  let provision_result: any = null;
  try {
    const applied = await applyProvisioningState(created.id, {
      status: created.status,
      stage: stageForStatus(created.status),
      walled_garden: false,
      reason: 'Subscriber created',
      sendCoa: false,
    });
    provision_result = applied?.results || applied;
  } catch (e: any) {
    provision_result = { ok: false, error: e.message };
  }

  await auditLog({
    ...reqActor(req),
    action: 'SUBSCRIBER_CREATE',
    entity_type: 'subscriber',
    entity_id: created.id,
    details: { client_code: created.client_code, full_name: created.full_name, status: created.status, username: created.username },
  });

  res.status(201).json(sanitizeSubscriber({ ...created, provision_result }));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  const existing = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Subscriber not found' });
  const scope = await resellerScope(req);

  // Resellers must never be able to move a subscriber to another partner via PUT.
  // Override before validation so a client-supplied id cannot change ownership
  // (or fail validation) at all.
  const body = scope.restricted ? { ...b, reseller_id: scope.uuid } : b;
  const p = await buildPayload(body, existing);
  let pkgForExpiry: any = null;
  if (p.package_name) {
    pkgForExpiry = (await pool.query('SELECT price, download_mbps, validity_value, validity_unit FROM bandwidth_packages WHERE name=$1 LIMIT 1', [p.package_name])).rows[0] || null;
    if (pkgForExpiry) {
      const reqBill = b.monthly_bill ?? b.monthlyBill;
      const reqExplicitBill = !(reqBill === '' || reqBill == null);
      if ((p.monthly_bill === 0 || p.monthly_bill == null) && Number(pkgForExpiry.price || 0) > 0 && !reqExplicitBill) p.monthly_bill = Number(pkgForExpiry.price);
      const reqBw = b.bandwidth_mbps ?? b.bandwidthMbps;
      const reqExplicitBw = !(reqBw === '' || reqBw == null);
      if ((p.bandwidth_mbps == null || p.bandwidth_mbps === 0) && Number(pkgForExpiry.download_mbps || 0) > 0 && !reqExplicitBw) p.bandwidth_mbps = Number(pkgForExpiry.download_mbps);
    }
  }
  if (!p.expiry_date && p.package_name) {
    const base = p.installation_date ? new Date(String(p.installation_date)) : new Date();
    const unit = String(pkgForExpiry?.validity_unit || 'CALENDAR_MONTH').toUpperCase();
    const val = Math.max(1, Number(pkgForExpiry?.validity_value || 1));
    const exp = new Date(base);
    if (unit === 'DAYS') exp.setDate(exp.getDate() + val);
    else if (unit === 'MONTHS') exp.setMonth(exp.getMonth() + val);
    else exp.setMonth(exp.getMonth() + 1);
    p.expiry_date = exp.toISOString().slice(0, 10);
  }
  const statusChanged = p.status !== existing.status;
  const usernameChanged = (p.username || '') !== (existing.username || '');
  const provisioningChanged = ['provisioning_mode', 'router_id', 'package_name', 'ip_address', 'password']
    .some((k) => String(p[k] ?? '') !== String(existing[k] ?? ''));

  const updateSql = `
    UPDATE subscribers SET
      full_name=$1, subscriber_type=$2, connection_type=$3, username=$4, password=$5, phone=$6, email=$7, nid_number=$8,
      package_name=$9, bandwidth_mbps=$10, monthly_bill=$11, status=$12, area_id=$13, zone_id=$14, distribution_box_id=$15, address=$16,
      latitude=$17, longitude=$18,
      location=CASE WHEN $17::float IS NOT NULL AND $18::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($18,$17),4326)::geography ELSE NULL END,
      ip_address=$19, mac_address=$20, installation_date=$21,
      district=$22, thana=$23, upazila=$24, post_office=$25, village=$26, area_name=$27, ward_no=$28, road_no=$29, house_no=$30, notes=$31,
      billing_cycle_day=$32, expiry_date=$33, due_date=$34, next_bill_date=$35, auto_suspend_enabled=$36, auto_pay_enabled=$37,
      provisioning_mode=$38, router_id=$39, reseller_id=$40,
      price_override=$41, custom_package_note=$42, extended_expiry=$43, branch_name=$44,
      ${EXTRA_SUBSCRIBER_FIELDS.map((key, i) => `${key}=$${46 + i}`).join(',\n      ')},
      portal_password=$${46 + EXTRA_FIELD_COUNT},
      updated_at=now()
    WHERE id=$45 RETURNING *`;
  const updated = (await pool.query(updateSql, [
    p.full_name, p.subscriber_type, p.connection_type, p.username, p.password, p.phone, p.email, p.nid_number,
    p.package_name, p.bandwidth_mbps, p.monthly_bill, p.status, p.area_id, p.zone_id, p.distribution_box_id, p.address,
    p.latitude, p.longitude, p.ip_address, p.mac_address, p.installation_date,
    p.district, p.thana, p.upazila, p.post_office, p.village, p.area_name, p.ward_no, p.road_no, p.house_no, p.notes,
    p.billing_cycle_day, p.expiry_date, p.due_date, p.next_bill_date, p.auto_suspend_enabled, p.auto_pay_enabled,
    p.provisioning_mode, p.router_id, p.reseller_id,
    p.price_override, p.custom_package_note, p.extended_expiry, p.branch_name,
    req.params.id,
    ...EXTRA_SUBSCRIBER_FIELDS.map((key) => p[key] ?? null),
    p.portal_password ?? null,
  ])).rows[0];

  // Clean up stale network artifacts when the username or router binding changes.
  if (usernameChanged && existing.username) {
    try { await removeSubscriberFromRadiusDb(existing.username); } catch {}
  }
  const oldWasRouter = str(existing.provisioning_mode).toUpperCase() === 'ROUTER' && existing.router_id && existing.username;
  if (oldWasRouter) {
    const routerChanged = String(existing.router_id || '') !== String(updated.router_id || '');
    const userChanged = String(existing.username || '') !== String(updated.username || '');
    const modeChanged = String(existing.provisioning_mode).toUpperCase() !== String(updated.provisioning_mode).toUpperCase();
    if (modeChanged || routerChanged || userChanged) {
      await removePppSecretFromRouter(existing.router_id, existing.username);
    }
  }

  let provision_result: any = null;
  if (statusChanged || provisioningChanged || usernameChanged) {
    try {
      const applied = await applyProvisioningState(updated.id, {
        status: updated.status,
        stage: statusChanged ? stageForStatus(updated.status) : undefined,
        walled_garden: statusChanged ? false : undefined,
        reason: statusChanged ? (updated.status === 'ACTIVE' || updated.status === 'PENDING' ? null : 'Manual status change') : undefined,
        sendCoa: statusChanged,
      });
      provision_result = applied?.results || applied;
    } catch (e: any) {
      provision_result = { ok: false, error: e.message };
    }
  }

  // Re-read so the response reflects the resulting suspension/stage/dues state.
  const fresh = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [req.params.id])).rows[0] || updated;

  const changes: Record<string, any> = {};
  for (const k of ['full_name', 'status', 'username', 'package_name', 'monthly_bill', 'phone', 'provisioning_mode', 'router_id', 'reseller_id']) {
    if (String(existing[k] ?? '') !== String(updated[k] ?? '')) changes[k] = { from: existing[k] ?? null, to: updated[k] ?? null };
  }
  await auditLog({
    ...reqActor(req),
    action: statusChanged ? 'SUBSCRIBER_STATUS_CHANGE' : 'SUBSCRIBER_UPDATE',
    entity_type: 'subscriber',
    entity_id: updated.id,
    details: { client_code: updated.client_code, changes },
  });

  res.json(sanitizeSubscriber({ ...fresh, provision_result }));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  const existing = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Subscriber not found' });

  const deps = (await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM invoices WHERE subscriber_id=$1) AS invoices,
    (SELECT COUNT(*)::int FROM payments WHERE subscriber_id=$1) AS payments,
    (SELECT COUNT(*)::int FROM tickets WHERE subscriber_id=$1) AS tickets`, [req.params.id])).rows[0];
  if (Number(deps.invoices) > 0 || Number(deps.payments) > 0) {
    throw new ConflictError(`Cannot delete subscriber with ${deps.invoices} invoice(s) and ${deps.payments} payment(s). Set status to TERMINATED instead.`);
  }

  if (str(existing.provisioning_mode).toUpperCase() === 'ROUTER' && existing.router_id && existing.username) {
    await removePppSecretFromRouter(existing.router_id, existing.username);
  }
  if (existing.username) {
    try { await removeSubscriberFromRadiusDb(existing.username); } catch {}
  }
  await pool.query('DELETE FROM subscribers WHERE id=$1', [req.params.id]);

  await auditLog({
    ...reqActor(req),
    action: 'SUBSCRIBER_DELETE',
    entity_type: 'subscriber',
    entity_id: existing.id,
    details: { client_code: existing.client_code, full_name: existing.full_name, username: existing.username, tickets: Number(deps.tickets) },
  });

  res.json({ ok: true });
}));

// KYC — legacy subscriber-scoped surface. The richer review workflow lives in
// /api/kyc; these routes remain for the subscriber detail panel and integrations.
router.get('/:id/kyc', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  const r = await pool.query('SELECT * FROM kyc_documents WHERE subscriber_id=$1 ORDER BY uploaded_at DESC', [req.params.id]);
  res.json({ data: r.rows });
}));

router.post('/:id/kyc', upload.single('file'), asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  if (!req.file) return res.status(400).json({ message: 'file is required' });
  if (req.user?.role === 'RESELLER' && !await canResellerUploadKyc()) {
    return res.status(403).json({ message: 'Reseller KYC uploads are disabled by policy' });
  }
  assertAllowedKycFileBuffer(req.file.buffer, req.file.mimetype);
  const b = req.body || {};
  let encrypted: ReturnType<typeof encryptKycBuffer> | null = null;
  let doc;
  try {
    const checksum = sha256Buffer(req.file.buffer); // checksum of plaintext before encryption
    encrypted = encryptKycBuffer(req.file.buffer, uploadDir);
    doc = await createKycDocument({
      subscriberId: req.params.id,
      docType: normalizeDocType(b.doc_type),
      fileName: req.file.originalname,
      filePath: path.basename(encrypted.filePath),
      mimeType: req.file.mimetype,
      source: 'STAFF',
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email, role: req.user?.role, ip: req.ip },
      checksum,
      documentNumber: b.document_number,
      issuer: b.issuer,
      issueDate: b.issue_date,
      expiresAt: b.expires_at,
      verificationMethod: b.verification_method,
      verificationReference: b.verification_reference,
      reuploadOf: b.reupload_of || null,
      encryption: encrypted,
    });
  } catch (e) {
    secureUnlinkKycFile(encrypted?.filePath);
    throw e;
  }
  res.status(201).json(doc);
}));

router.delete('/:id/kyc/:docId', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  if (req.user?.role === 'RESELLER' && !await canResellerUploadKyc()) {
    return res.status(403).json({ message: 'Reseller KYC changes are disabled by policy' });
  }
  const doc = await deleteKycDocument({
    documentId: req.params.docId,
    subscriberId: req.params.id,
    actor: { id: req.user?.id, name: req.user?.name || req.user?.email, role: req.user?.role, ip: req.ip },
  });
  if (!doc) return res.status(404).json({ message: 'KYC document not found' });
  res.json({ ok: true });
}));

// Backwards-compatible status endpoint. Reasons and reviewer metadata are now
// persisted by applyKycDecision; /api/kyc/documents/:id/decision is preferred.
router.put('/:id/kyc/:docId/status', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  if (!canReviewKyc(req)) return res.status(403).json({ message: 'KYC review is restricted to staff reviewer roles' });
  const b = req.body || {};
  const newStatus = String(b.status || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(newStatus)) return res.status(400).json({ message: 'status must be APPROVED or REJECTED' });
  const found = await pool.query('SELECT id FROM kyc_documents WHERE id=$1 AND subscriber_id=$2', [req.params.docId, req.params.id]);
  if (!found.rows[0]) return res.status(404).json({ message: 'KYC document not found' });
  const doc = await applyKycDecision({
    documentId: req.params.docId,
    decision: newStatus === 'APPROVED' ? 'APPROVE' : 'REJECT',
    reason: b.reason || b.rejection_reason,
    evidenceRef: b.evidence_ref,
    actor: { id: req.user?.id, name: req.user?.name || req.user?.email, role: req.user?.role, ip: req.ip },
  });
  res.json({ ok: true, data: doc });
}));

// Ownership-checked KYC download. Replaces public static serving of /uploads/kyc.
router.get('/:id/kyc/:docId/file', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  const r = await pool.query(
    `SELECT file_path, file_name, mime_type, encryption_alg, encryption_iv, encryption_auth_tag, encryption_key_id
     FROM kyc_documents WHERE id=$1 AND subscriber_id=$2`,
    [req.params.docId, req.params.id],
  );
  const doc = r.rows[0];
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  const plain = readKycDocument(doc); // decrypted and authenticated before anything is sent
  const safeName = String(doc.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const mime = String(doc.mime_type || '');
  res.setHeader('Content-Type', /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i.test(mime) ? mime : 'application/octet-stream');
  res.setHeader('Content-Length', String(plain.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  await auditLog({ ...reqActor(req), action: 'KYC_DOCUMENT_VIEWED', entity_type: 'kyc_document', entity_id: req.params.docId, details: { subscriber_id: req.params.id } });
  res.end(plain);
}));

/* ------------------------------------------------------------------ */
/* Package Catalog for Subscriber Form                                 */
/* ------------------------------------------------------------------ */

router.get('/packages/catalog', asyncHandler(async (_req, res) => {
  const pkgs = await pool.query(`SELECT id, name, profile_name, download_mbps, upload_mbps, burst_download_mbps, burst_upload_mbps, price, description, data_cap_gb, fup_speed_mbps FROM bandwidth_packages WHERE is_active=true ORDER BY price ASC`);
  res.json({ ok: true, data: pkgs.rows });
}));

/* ------------------------------------------------------------------ */
/* Subscriber Status History                                           */
/* ------------------------------------------------------------------ */

router.get('/:id/history', asyncHandler(async (req, res) => {
  const sub = await pool.query('SELECT id FROM subscribers WHERE id=$1', [req.params.id]);
  if (!sub.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;

  // Get status changes from audit logs
  const logs = await pool.query(`SELECT action, details, actor_name, actor_role, created_at FROM audit_logs WHERE entity_type='subscriber' AND entity_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]);
  // Get suspension logs
  const susp = await pool.query(`SELECT action, stage, reason, details, triggered_by, created_at FROM billing_suspension_logs WHERE subscriber_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]);
  // Get provisioning logs (from radius_users)
  const prov = await pool.query(`SELECT status, last_synced_at, last_error FROM radius_users WHERE subscriber_id=$1 ORDER BY last_synced_at DESC LIMIT 20`, [req.params.id]);

  res.json({ ok: true, data: { status_changes: logs.rows, suspension_logs: susp.rows, provisioning_logs: prov.rows } });
}));

/* ------------------------------------------------------------------ */
/* Customer Application Form (CAF) PDF                                 */
/* ------------------------------------------------------------------ */

router.get('/:id/caf', asyncHandler(async (req, res) => {
  const r = await pool.query(`${LIST_SELECT} WHERE s.id=$1`, [req.params.id]);
  const sub = r.rows[0];
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;

  const kyc = await pool.query('SELECT * FROM kyc_documents WHERE subscriber_id=$1 ORDER BY uploaded_at DESC', [req.params.id]);

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="CAF-${sub.client_code}.pdf"`);
  doc.pipe(res);

  // Helper functions
  const drawLabelValue = (label: string, value: string, y: number, x: number = 50, labelWidth: number = 180) => {
    doc.font('Helvetica-Bold').fontSize(9).text(label, x, y, { width: labelWidth });
    doc.font('Helvetica').fontSize(9).text(value || '-', x + labelWidth, y, { width: 350 });
  };

  let y = 50;
  // Header
  doc.font('Helvetica-Bold').fontSize(18).text('Customer Application Form (CAF)', 50, y, { align: 'center' });
  y += 30;
  doc.font('Helvetica').fontSize(10).text(`ISP: IzanDesk ERP  |  Generated: ${new Date().toLocaleString()}  |  Client Code: ${sub.client_code}`, 50, y, { align: 'center' });
  y += 40;

  // Section 1: Personal Information
  doc.font('Helvetica-Bold').fontSize(12).text('1. Personal Information', 50, y);
  y += 20;
  drawLabelValue('Full Name:', sub.full_name, y); y += 18;
  drawLabelValue('Client Code:', sub.client_code, y); y += 18;
  drawLabelValue('Subscriber Type:', sub.subscriber_type, y); y += 18;
  drawLabelValue('Connection Type:', sub.connection_type, y); y += 18;
  drawLabelValue('Status:', sub.status, y); y += 18;
  drawLabelValue('Phone:', sub.phone || '-', y); y += 18;
  drawLabelValue('Email:', sub.email || '-', y); y += 18;
  drawLabelValue('NID Number:', sub.nid_number || '-', y); y += 18;
  drawLabelValue('Installation Date:', sub.installation_date || '-', y); y += 25;

  // Section 2: Network & Provisioning
  doc.font('Helvetica-Bold').fontSize(12).text('2. Network & Provisioning', 50, y);
  y += 20;
  drawLabelValue('PPPoE Username:', sub.username || '-', y); y += 18;
  drawLabelValue('Provisioning Mode:', sub.provisioning_mode, y); y += 18;
  drawLabelValue('Router:', sub.router_name || (sub.provisioning_mode === 'RADIUS' ? 'RADIUS Pool' : '-'), y); y += 18;
  drawLabelValue('Package:', sub.package_name || '-', y); y += 18;
  drawLabelValue('Bandwidth:', sub.bandwidth_mbps ? `${sub.bandwidth_mbps} Mbps` : '-', y); y += 18;
  drawLabelValue('Monthly Bill:', sub.monthly_bill ? `৳${sub.monthly_bill}` : '-', y); y += 18;
  drawLabelValue('IP Address:', sub.ip_address || '-', y); y += 18;
  drawLabelValue('MAC Address:', sub.mac_address || '-', y); y += 25;

  // Section 3: Location & Topology
  doc.font('Helvetica-Bold').fontSize(12).text('3. Location & Topology', 50, y);
  y += 20;
  drawLabelValue('Address:', sub.address || '-', y); y += 18;
  drawLabelValue('District:', sub.district || '-', y); y += 18;
  drawLabelValue('Thana/Upazila:', sub.thana || sub.upazila || '-', y); y += 18;
  drawLabelValue('Post Office:', sub.post_office || '-', y); y += 18;
  drawLabelValue('Village/Area:', sub.village || sub.area_name || '-', y); y += 18;
  drawLabelValue('Ward/Road/House:', [sub.ward_no, sub.road_no, sub.house_no].filter(Boolean).join(', ') || '-', y); y += 18;
  drawLabelValue('Coordinates:', sub.latitude && sub.longitude ? `${sub.latitude}, ${sub.longitude}` : '-', y); y += 18;
  drawLabelValue('ISP Area:', sub.area_name || '-', y); y += 18;
  drawLabelValue('Zone:', sub.zone_name || '-', y); y += 18;
  drawLabelValue('Distribution Box:', sub.distribution_box_name || sub.distribution_box_code || '-', y); y += 25;

  // Section 4: KYC Documents
  doc.font('Helvetica-Bold').fontSize(12).text('4. KYC Documents', 50, y);
  y += 20;
  if (kyc.rows.length === 0) {
    doc.font('Helvetica').fontSize(9).text('No KYC documents uploaded.', 50, y);
    y += 18;
  } else {
    for (const d of kyc.rows) {
      drawLabelValue(`${d.doc_type}:`, d.file_name, y);
      y += 18;
    }
  }
  y += 15;

  // Section 5: Declaration & Signature
  doc.font('Helvetica-Bold').fontSize(12).text('5. Declaration', 50, y);
  y += 20;
  const declaration = 'I hereby declare that the information provided above is true and correct to the best of my knowledge. I agree to abide by the terms and conditions of the service provider. I understand that providing false information may lead to termination of service and legal action.';
  doc.font('Helvetica').fontSize(9).text(declaration, 50, y, { width: 480, align: 'justify' });
  y += 60;

  doc.font('Helvetica-Bold').fontSize(10).text('Subscriber Signature: _________________________', 50, y);
  y += 20;
  doc.font('Helvetica-Bold').fontSize(10).text('Date: _________________________', 50, y);
  y += 20;
  doc.font('Helvetica-Bold').fontSize(10).text('Authorized Officer Signature: _________________________', 50, y);
  y += 20;
  doc.font('Helvetica-Bold').fontSize(10).text('Date: _________________________', 50, y);

  doc.end();
}));

/* ------------------------------------------------------------------ */
/* Bulk Import: Preview (Dry-run)                                      */
/* ------------------------------------------------------------------ */

const IMPORT_FIELDS = [
  'client_code', 'full_name', 'subscriber_type', 'connection_type', 'username', 'password', 'phone', 'email', 'nid_number',
  'package_name', 'bandwidth_mbps', 'monthly_bill', 'status', 'area_id', 'zone_id', 'distribution_box_id', 'address',
  'latitude', 'longitude', 'ip_address', 'mac_address', 'installation_date',
  'district', 'thana', 'upazila', 'post_office', 'village', 'area_name', 'ward_no', 'road_no', 'house_no', 'notes',
  'billing_cycle_day', 'expiry_date', 'due_date', 'next_bill_date', 'auto_suspend_enabled', 'auto_pay_enabled',
  'provisioning_mode', 'router_id', 'reseller_id',
];

type ImportRefs = {
  areaMap: Map<string, string>; zoneMap: Map<string, string>; boxMap: Map<string, string>;
  routerMap: Map<string, string>; resellerMap: Map<string, string>; packageSet: Set<string>;
};

async function loadImportRefs(): Promise<ImportRefs> {
  const [areas, zones, boxes, routers, resellers, packages] = await Promise.all([
    pool.query('SELECT id, name FROM areas'),
    pool.query('SELECT id, name, area_id FROM zones'),
    pool.query('SELECT id, name, zone_id FROM distribution_boxes'),
    pool.query("SELECT id, name, integration_mode FROM network_routers WHERE is_enabled=true"),
    pool.query("SELECT id, name FROM resellers WHERE status='ACTIVE'"),
    pool.query('SELECT name FROM bandwidth_packages WHERE is_active=true'),
  ]);
  return {
    areaMap: new Map(areas.rows.map((a: any) => [a.name.toLowerCase(), a.id])),
    zoneMap: new Map(zones.rows.map((z: any) => [z.name.toLowerCase(), z.id])),
    boxMap: new Map(boxes.rows.map((b: any) => [b.name.toLowerCase(), b.id])),
    routerMap: new Map(routers.rows.map((r: any) => [r.name.toLowerCase(), r.id])),
    resellerMap: new Map(resellers.rows.map((r: any) => [r.name.toLowerCase(), r.id])),
    packageSet: new Set(packages.rows.map((p: any) => p.name.toLowerCase())),
  };
}

/** Single source of truth for import row validation and normalization, used by
 *  both /import/preview and /import/execute so the two can never diverge. */
function buildImportRow(row: any, rowNum: number, refs: ImportRefs, scope: { restricted: boolean; uuid: string | null }) {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`Row ${rowNum}: ${msg}`);
  const pick = (...keys: string[]) => {
    for (const k of keys) { const v = row?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; }
    return '';
  };
  const checked = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch (e: any) { err(e.message); return fallback; } };

  const fullName = str(pick('full_name', 'Full Name'));
  if (!fullName) err('full_name is required');
  const subType = enumValSafe(pick('subscriber_type', 'Subscriber Type'), SUBSCRIBER_TYPES, 'HOME');
  const connType = enumValSafe(pick('connection_type', 'Connection Type'), CONNECTION_TYPES, 'PPPOE');
  const status = enumValSafe(pick('status', 'Status'), STATUSES, 'PENDING');
  const provMode = enumValSafe(pick('provisioning_mode', 'Provisioning Mode'), ['ROUTER', 'RADIUS'], 'RADIUS');

  const username = nullableStr(pick('username', 'Username'));
  if (username && !/^[A-Za-z0-9._@:-]{3,64}$/.test(username)) err('invalid username format');
  const phone = nullableStr(pick('phone', 'Phone'));
  if (phone && !/^\+?[0-9\s\-()]{7,20}$/.test(phone)) err('invalid phone');
  const email = nullableStr(pick('email', 'Email'));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('invalid email');

  const resolveRef = (value: string, map: Map<string, string>, label: string): string | null => {
    if (!value) return null;
    const id = map.get(value.toLowerCase()) || null;
    if (!id) err(`${label} "${value}" not found`);
    return id;
  };
  const areaName = str(pick('area_id', 'Area', 'Area Name'));
  const areaId = resolveRef(areaName, refs.areaMap, 'area');
  const zoneName = str(pick('zone_id', 'Zone'));
  const zoneId = resolveRef(zoneName, refs.zoneMap, 'zone');
  const boxName = str(pick('distribution_box_id', 'Distribution Box'));
  const boxId = resolveRef(boxName, refs.boxMap, 'distribution box');
  const routerName = str(pick('router_id', 'Router'));
  let routerId = resolveRef(routerName, refs.routerMap, 'router');
  const resellerName = str(pick('reseller_id', 'Reseller'));
  let resellerId = scope.restricted ? scope.uuid : resolveRef(resellerName, refs.resellerMap, 'reseller');
  if (provMode === 'RADIUS') routerId = null;
  else if (provMode === 'ROUTER' && !routerId) err('router_id required for ROUTER mode');

  const pkgName = str(pick('package_name', 'Package'));
  if (pkgName && !refs.packageSet.has(pkgName.toLowerCase())) err(`package "${pkgName}" not found in catalog`);

  const latRaw = pick('latitude', 'Latitude'), lngRaw = pick('longitude', 'Longitude');
  const latitude = latRaw === '' ? null : checked(() => Number(latRaw), NaN);
  const longitude = lngRaw === '' ? null : checked(() => Number(lngRaw), NaN);
  if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
    err('invalid latitude/longitude');
  }

  const bwRaw = pick('bandwidth_mbps', 'Bandwidth');
  const billRaw = pick('monthly_bill', 'Monthly Bill');
  const cycleRaw = pick('billing_cycle_day', 'Billing Cycle Day');
  const data = {
    client_code: nullableStr(pick('client_code', 'Client Code')),
    full_name: fullName,
    subscriber_type: subType,
    connection_type: connType,
    status,
    username,
    password: nullableStr(pick('password', 'Password')),
    phone, email,
    nid_number: nullableStr(pick('nid_number', 'NID')),
    package_name: pkgName || null,
    bandwidth_mbps: bwRaw === '' ? null : checked(() => intVal(bwRaw, 'bandwidth_mbps', { min: 0, max: 100000 }), null),
    monthly_bill: billRaw === '' ? 0 : checked(() => moneyVal(billRaw, 'monthly_bill'), 0),
    area_id: areaId, zone_id: zoneId, distribution_box_id: boxId,
    address: nullableStr(pick('address', 'Address')),
    latitude: Number.isFinite(latitude as any) ? Number(latitude) : null,
    longitude: Number.isFinite(longitude as any) ? Number(longitude) : null,
    ip_address: nullableStr(pick('ip_address', 'IP')),
    mac_address: nullableStr(pick('mac_address', 'MAC')),
    installation_date: checked(() => dateVal(pick('installation_date', 'Installation Date'), 'installation_date'), null),
    district: nullableStr(pick('district', 'District')),
    thana: nullableStr(pick('thana', 'Thana')),
    upazila: nullableStr(pick('upazila', 'Upazila')),
    post_office: nullableStr(pick('post_office', 'Post Office')),
    village: nullableStr(pick('village', 'Village')),
    area_name: nullableStr(pick('area_name', 'Area Name')),
    ward_no: nullableStr(pick('ward_no', 'Ward')),
    road_no: nullableStr(pick('road_no', 'Road')),
    house_no: nullableStr(pick('house_no', 'House')),
    notes: nullableStr(pick('notes', 'Notes')),
    billing_cycle_day: cycleRaw === '' ? 1 : (checked(() => intVal(cycleRaw, 'billing_cycle_day', { min: 1, max: 31 }), null) ?? 1),
    expiry_date: checked(() => dateVal(pick('expiry_date', 'Expiry Date'), 'expiry_date'), null),
    due_date: checked(() => dateVal(pick('due_date', 'Due Date'), 'due_date'), null),
    next_bill_date: checked(() => dateVal(pick('next_bill_date', 'Next Bill Date'), 'next_bill_date'), null),
    auto_suspend_enabled: boolVal(pick('auto_suspend_enabled', 'Auto Suspend'), true),
    auto_pay_enabled: boolVal(pick('auto_pay_enabled', 'Auto Pay'), false),
    provisioning_mode: provMode, router_id: routerId, reseller_id: resellerId,
  };

  const display = { full_name: fullName, username, package_name: data.package_name, area_id: areaName, provisioning_mode: provMode };
  return { row: rowNum, valid: errors.length === 0, errors, data: errors.length === 0 ? data : { ...row, ...display } };
}

router.post('/import/preview', importUpload.single('file'), asyncHandler(async (req, res) => {
  const importScope = await resellerScope(req);
  if (importScope.restricted && !importScope.uuid) return res.status(403).json({ message: 'No reseller account linked to this login' });
  if (!req.file) return res.status(400).json({ message: 'file is required' });

  let workbook: any;
  try {
    workbook = XLSX.readFile(req.file.path);
  } finally {
    // Always remove the upload, even when the file cannot be parsed.
    try { fs.unlinkSync(req.file.path); } catch {}
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];

  if (rows.length === 0) return res.json({ ok: true, preview: [], errors: ['No data rows found'], valid: 0, invalid: 0 });

  const refs = await loadImportRefs();
  const preview = rows.map((row, i) => buildImportRow(row, i + 2, refs, importScope));
  const errors = preview.flatMap((p: any) => p.errors);
  const valid = preview.filter((p: any) => p.valid).length;

  res.json({ ok: true, total: rows.length, valid, invalid: rows.length - valid, errors: errors.slice(0, 50), preview: preview.slice(0, 100) });
}));

/* ------------------------------------------------------------------ */
/* Bulk Import: Execute                                                */
/* ------------------------------------------------------------------ */

router.post('/import/execute', importUpload.single('file'), asyncHandler(async (req, res) => {
  const importScope = await resellerScope(req);
  if (importScope.restricted && !importScope.uuid) return res.status(403).json({ message: 'No reseller account linked to this login' });
  if (!req.file) return res.status(400).json({ message: 'file is required' });
  const force = boolVal(req.body.force, false); // skip validation errors if true

  let workbook: any;
  try {
    workbook = XLSX.readFile(req.file.path);
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];

  // Same validator as the preview endpoint — the two can no longer diverge.
  const refs = await loadImportRefs();
  const prepared = rows.map((row, i) => buildImportRow(row, i + 2, refs, importScope));

  const results: any[] = [];
  let created = 0, failed = 0, skipped = 0;

  for (const item of prepared) {
    const rowNum = item.row;
    if (!item.valid) {
      failed++;
      results.push({ row: rowNum, ok: false, error: item.errors.join('; ') });
      if (!force) break;
      continue;
    }
    try {
      const p: any = { ...item.data };

      // Cleartext NAS secret + separate bcrypt hash for portal login.
      const rawPass = p.password;
      p.password = rawPass;
      p.portal_password = rawPass ? await hashPassword(rawPass) : null;

      // Client code
      let clientCode = p.client_code;
      if (!clientCode) clientCode = await nextClientCode(p.area_id);
      const dup = await pool.query('SELECT id FROM subscribers WHERE client_code=$1', [clientCode]);
      if (dup.rows[0]) throw new ConflictError(`Client code exists: ${clientCode}`);

      // Insert
      const insertSql = `
        INSERT INTO subscribers (
          client_code, full_name, subscriber_type, connection_type, username, password, phone, email, nid_number,
          package_name, bandwidth_mbps, monthly_bill, status, area_id, zone_id, distribution_box_id, address,
          latitude, longitude, location, ip_address, mac_address, installation_date,
          district, thana, upazila, post_office, village, area_name, ward_no, road_no, house_no, notes,
          billing_cycle_day, expiry_date, due_date, next_bill_date, auto_suspend_enabled, auto_pay_enabled,
          provisioning_mode, router_id, reseller_id, portal_password
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          CASE WHEN $18::float IS NOT NULL AND $19::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($19,$18),4326)::geography ELSE NULL END,
          $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
          $33,$34,$35,$36,$37,$38,
          $39,$40,$41,$42
        ) RETURNING *`;
      const values = [
        clientCode, p.full_name, p.subscriber_type, p.connection_type, p.username, p.password, p.phone, p.email, p.nid_number,
        p.package_name, p.bandwidth_mbps, p.monthly_bill, p.status, p.area_id, p.zone_id, p.distribution_box_id, p.address,
        p.latitude, p.longitude, p.ip_address, p.mac_address, p.installation_date,
        p.district, p.thana, p.upazila, p.post_office, p.village, p.area_name, p.ward_no, p.road_no, p.house_no, p.notes,
        p.billing_cycle_day, p.expiry_date, p.due_date, p.next_bill_date, p.auto_suspend_enabled, p.auto_pay_enabled,
        p.provisioning_mode, p.router_id, p.reseller_id,
        p.portal_password ?? null,
      ];
      const createdRow = (await pool.query(insertSql, values)).rows[0];

      // Provision
      let provision_result: any = null;
      try {
        const applied = await applyProvisioningState(createdRow.id, {
          status: createdRow.status, stage: stageForStatus(createdRow.status), walled_garden: false,
          reason: 'Bulk import', sendCoa: false,
        });
        provision_result = applied?.results || applied;
      } catch (e: any) { provision_result = { ok: false, error: e.message }; }

      await auditLog({ ...reqActor(req), action: 'SUBSCRIBER_BULK_IMPORT', entity_type: 'subscriber', entity_id: createdRow.id, details: { client_code: clientCode, row: rowNum } });
      results.push({ row: rowNum, ok: true, client_code: clientCode, id: createdRow.id, provision_result });
      created++;
    } catch (e: any) {
      failed++;
      // Explicit conflicts already raise ConflictError; a concurrent 23505 is
      // still captured here as a per-row failure rather than a 500.
      results.push({ row: rowNum, ok: false, error: e.message });
      if (!force) {
        // On first error without force, stop and return
        break;
      }
    }
  }

  res.json({ ok: true, total: rows.length, created, failed, skipped, results });
}));

/* ------------------------------------------------------------------ */
/* Batch Actions                                                       */
/* ------------------------------------------------------------------ */

router.post('/batch', asyncHandler(async (req, res) => {
  const { action, ids, params } = req.body || {};
  if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'action and ids[] are required' });
  }
  const scope = await resellerScope(req);
  if (scope.restricted && !scope.uuid) return res.status(403).json({ message: 'No reseller account linked' });

  // The raw provision action writes arbitrary status/stage values and can bypass
  // billing suspension, so it is admin/ops only. Validate its inputs for admins.
  if (action === 'provision') {
    if (scope.restricted) throw new ValidationError('Resellers cannot use the provision action');
    if (params?.status && !STATUSES.includes(String(params.status).toUpperCase())) throw new ValidationError(`status must be one of: ${STATUSES.join(', ')}`);
    if (params?.stage && !SUSPENSION_STAGES.includes(String(params.stage).toUpperCase())) throw new ValidationError(`stage must be one of: ${SUSPENSION_STAGES.join(', ')}`);
  }
  if (action === 'set_package') {
    if (!params?.package_name) throw new ValidationError('package_name required');
    const pkg = await pool.query('SELECT name FROM bandwidth_packages WHERE name=$1', [params.package_name]);
    if (!pkg.rows[0]) throw new ValidationError('Selected package does not exist');
  }

  // Verify all IDs belong to reseller (if restricted)
  let targetIds = ids;
  if (scope.uuid) {
    const check = await pool.query('SELECT id FROM subscribers WHERE id = ANY($1) AND reseller_id=$2', [ids, scope.uuid]);
    targetIds = check.rows.map(r => r.id);
    if (targetIds.length !== ids.length) {
      return res.status(403).json({ message: 'Some subscribers not accessible' });
    }
  }

  const results: any[] = [];
  for (const id of targetIds) {
    try {
      let result: any = { id, ok: false };
      switch (action) {
        case 'suspend':
          result = await applyProvisioningState(id, { status: 'SUSPENDED', stage: 'SUSPENDED', walled_garden: false, reason: params?.reason || 'Batch suspend', sendCoa: true });
          break;
        case 'activate':
          result = await applyProvisioningState(id, { status: 'ACTIVE', stage: 'NONE', walled_garden: false, reason: params?.reason || 'Batch activate', sendCoa: true });
          break;
        case 'walled_garden':
          result = await applyProvisioningState(id, { status: 'ACTIVE', stage: 'WALLED_GARDEN', walled_garden: true, reason: params?.reason || 'Batch walled garden', sendCoa: true });
          break;
        case 'provision':
          result = await applyProvisioningState(id, {
            status: String(params?.status || 'ACTIVE').toUpperCase(),
            stage: params?.stage ? String(params.stage).toUpperCase() : undefined,
            walled_garden: params?.walled_garden, reason: params?.reason || 'Batch provision', sendCoa: true,
          });
          break;
        case 'delete':
          // Only allow if no invoices/payments
          const deps = await pool.query(`SELECT (SELECT COUNT(*) FROM invoices WHERE subscriber_id=$1) as inv, (SELECT COUNT(*) FROM payments WHERE subscriber_id=$1) as pay`, [id]);
          if (Number(deps.rows[0].inv) > 0 || Number(deps.rows[0].pay) > 0) throw new ConflictError('Has invoices/payments');
          const ex = await pool.query('SELECT * FROM subscribers WHERE id=$1', [id]);
          if (ex.rows[0]?.username) await removeSubscriberFromRadiusDb(ex.rows[0].username);
          if (ex.rows[0]?.router_id && ex.rows[0]?.username) await removePppSecretFromRouter(ex.rows[0].router_id, ex.rows[0].username);
          await pool.query('DELETE FROM subscribers WHERE id=$1', [id]);
          result = { ok: true };
          break;
        case 'set_package':
          if (!params?.package_name) throw new ValidationError('package_name required');
          await pool.query('UPDATE subscribers SET package_name=$2, updated_at=now() WHERE id=$1', [id, params.package_name]);
          result = { ok: true };
          break;
        case 'set_reseller':
          if (scope.restricted) throw new ValidationError('Resellers cannot reassign subscribers to another partner');
          if (!params?.reseller_id) throw new ValidationError('reseller_id required');
          await pool.query('UPDATE subscribers SET reseller_id=$2, updated_at=now() WHERE id=$1', [id, params.reseller_id]);
          result = { ok: true };
          break;
        default:
          throw new ValidationError(`Unknown action: ${action}`);
      }
      result.id = id;
      results.push(result);
    } catch (e: any) {
      results.push({ id, ok: false, error: e.message });
    }
  }
  res.json({ ok: true, action, results });
}));

/* ------------------------------------------------------------------ */
/* Helper functions for import                                         */
/* ------------------------------------------------------------------ */

function enumValSafe(v: any, allowed: string[], fallback: string): string {
  const s = str(v).toUpperCase() || fallback;
  return allowed.includes(s) ? s : fallback;
}

/* ------------------------------------------------------------------ */
/* Subscriber live dashboard data                                      */
/* ------------------------------------------------------------------ */

function execPing(ip: string, timeoutMs = 1200): Promise<{ ok: boolean; latency_ms: number | null; output?: string }> {
  return new Promise((resolve) => {
    const target = String(ip || '').trim();
    // basic IPv4/hostname sanity check to avoid shell injection/garbage
    if (!/^[a-zA-Z0-9.:_-]+$/.test(target)) return resolve({ ok: false, latency_ms: null });
    const args = ['-c', '1', '-W', '1', target];
    const child = execFile('ping', args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve({ ok: false, latency_ms: null, output: String(stdout || '') });
      const m = String(stdout).match(/time[=<]([\d.]+)\s*ms/i);
      resolve({ ok: true, latency_ms: m ? Number(m[1]) : null, output: String(stdout || '') });
    });
    child.on('error', () => resolve({ ok: false, latency_ms: null }));
  });
}

router.get('/:id/live', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.id))) return;
  const id = req.params.id;
  const subRes = await pool.query(`
    SELECT s.id, s.client_code, s.full_name, s.subscriber_type, s.connection_type, s.username,
           s.phone, s.email, s.status, s.package_name, s.bandwidth_mbps, s.monthly_bill,
           s.ip_address, s.mac_address, s.provisioning_mode, s.router_id, s.area_id, s.zone_id, s.distribution_box_id,
           s.address, s.latitude, s.longitude, s.installation_date, s.expiry_date,
           r.name as router_name, r.host as router_host, r.integration_mode as router_mode, r.status as router_status
    FROM subscribers s
    LEFT JOIN network_routers r ON r.id = s.router_id
    WHERE s.id = $1
  `, [id]);
  if (!subRes.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  const sub = subRes.rows[0];

  const sessionRes = await pool.query(`
    SELECT ss.*, r.name as router_name, r.integration_mode
    FROM subscriber_sessions ss
    LEFT JOIN network_routers r ON r.id = ss.router_id
    WHERE ss.subscriber_id = $1 OR ($2::text IS NOT NULL AND $2::text <> '' AND ss.username = $2)
    ORDER BY CASE WHEN ss.status='ONLINE' THEN 0 ELSE 1 END, ss.updated_at DESC
    LIMIT 5
  `, [id, sub.username || null]);
  const sessions = sessionRes.rows.map((x: any) => {
    const sec = Number(x.uptime_sec || 0);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    const uptime = !sec ? '-' : (d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`);
    return { ...x, uptime };
  });
  const active = sessions.find((s: any) => String(s.status).toUpperCase() === 'ONLINE') || sessions[0] || null;

  let onus: any[] = [];
  const fetchLinkedOnus = async () => {
    const onuRes = await pool.query(`
      SELECT o.*, ol.name as olt_name, ol.host as olt_host, ol.vendor as olt_vendor, ol.model as olt_model, ol.status as olt_status
      FROM onus o
      LEFT JOIN olts ol ON ol.id = o.olt_id
      WHERE o.subscriber_id = $1
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC
    `, [id]);
    return onuRes.rows;
  };
  try {
    onus = await fetchLinkedOnus();

    // Auto-recognize/link ONU when none linked: (1) username/client_code in ONU name/serial, (2) PPPoE session MAC via OLT FDB
    if (onus.length === 0) {
      const normMac = (v: any) => {
        const m = String(v || '').toLowerCase().replace(/[^0-9a-f]/g, '');
        return m.length === 12 ? m.match(/.{2}/g)!.join(':') : null;
      };
      let matchedOnuId: string | null = null;

      // 1) Cheap heuristic: subscriber username/client_code appears in ONU name or serial
      try {
        const tokens = Array.from(new Set([sub.username, sub.client_code].map((x: any) => String(x || '').trim()).filter(x => x.length >= 3)));
        if (tokens.length) {
          const ors = tokens.map((_, i) => `(o.name ILIKE $${i + 2} OR o.serial_number ILIKE $${i + 2})`).join(' OR ');
          const params: any[] = [id, ...tokens.map(t => `%${t}%`)];
          const cand = await pool.query(
            `SELECT o.id, o.subscriber_id FROM onus o WHERE (o.subscriber_id IS NULL OR o.subscriber_id = $1) AND (${ors}) ORDER BY CASE WHEN o.subscriber_id = $1 THEN 0 ELSE 1 END, o.updated_at DESC NULLS LAST LIMIT 2`,
            params
          );
          if (cand.rows.length === 1 && !cand.rows[0].subscriber_id) matchedOnuId = cand.rows[0].id;
          else if (cand.rows.length >= 1 && cand.rows[0].subscriber_id === id) matchedOnuId = cand.rows[0].id;
        }
      } catch {}

      // 2) MAC/FDB correlation (heavier, SNMP) - run on non-fast polls
      const wantAutoFdb = !['0', 'false', 'no'].includes(String(req.query.ping ?? '1').toLowerCase());
      if (!matchedOnuId && wantAutoFdb) {
        const sessionMac = normMac(active?.mac_address || sub.mac_address || (active as any)?.caller_id || (active as any)?.callerId);
        if (sessionMac) {
          try {
            const olts = (await pool.query("SELECT id, host, vendor, model, snmp_community, snmp_port, is_enabled FROM olts WHERE is_enabled = true ORDER BY updated_at DESC NULLS LAST")).rows;
            for (const olt of olts) {
              try {
                const hit = await oltFindOnuByClientMac(olt, sessionMac) as any;
                if (!hit?.ok) continue;
                let onuRow: any = null;
                if (hit.pon_port && hit.onu_id) {
                  const r = await pool.query('SELECT id, subscriber_id FROM onus WHERE olt_id=$1 AND pon_port=$2 AND onu_id=$3 LIMIT 1', [olt.id, hit.pon_port, String(hit.onu_id)]);
                  onuRow = r.rows[0] || null;
                }
                if (!onuRow && hit.ifName) {
                  const r = await pool.query('SELECT id, subscriber_id FROM onus WHERE olt_id=$1 AND (name=$2 OR serial_number=$3) LIMIT 1', [olt.id, hit.ifName, String(hit.ifName).replace(/\s+/g, '_')]);
                  onuRow = r.rows[0] || null;
                }
                if (onuRow && (!onuRow.subscriber_id || onuRow.subscriber_id === id)) { matchedOnuId = onuRow.id; break; }
              } catch {}
            }
          } catch {}
        }
      }

      if (matchedOnuId) {
        try {
          await pool.query("UPDATE onus SET subscriber_id=$1, updated_at=now() WHERE id=$2 AND (subscriber_id IS NULL OR subscriber_id=$1)", [id, matchedOnuId]);
          onus = await fetchLinkedOnus();
        } catch {}
      }
    }
  } catch {}

  let equipment: any[] = [];
  try {
    const eqRes = await pool.query(`
      SELECT se.*, o.serial_number as onu_serial, o.pon_port as onu_pon_port, o.status as onu_status, o.rx_power_dbm, o.tx_power_dbm, ol.name as olt_name
      FROM subscriber_equipment se
      LEFT JOIN onus o ON o.id = se.onu_id
      LEFT JOIN olts ol ON ol.id = o.olt_id
      WHERE se.subscriber_id = $1
      ORDER BY se.created_at DESC
    `, [id]);
    equipment = eqRes.rows;
  } catch {}

  const wantPing = !['0', 'false', 'no'].includes(String(req.query.ping ?? '1').toLowerCase());
  const targetIp = (active && active.ip_address) || sub.ip_address || null;
  let latency: any = null;
  if (wantPing && targetIp) {
    latency = await execPing(String(targetIp));
  }

  // Credentials are never selected here — keep them out of live dashboard payloads.
  res.json({
    ok: true,
    subscriber: sub,
    active_session: active,
    sessions,
    bandwidth: {
      rx_bps: Number(active?.rx_bps || 0),
      tx_bps: Number(active?.tx_bps || 0),
      rx_bytes: Number(active?.rx_bytes || 0),
      tx_bytes: Number(active?.tx_bytes || 0),
      online: String(active?.status || '').toUpperCase() === 'ONLINE',
      ip_address: targetIp,
      mac_address: active?.mac_address || sub.mac_address || null,
      uptime: active?.uptime || '-',
      uptime_sec: Number(active?.uptime_sec || 0),
      router_name: active?.router_name || sub.router_name || null,
      integration_mode: active?.integration_mode || sub.router_mode || null,
      updated_at: active?.updated_at || null,
    },
    latency,
    onu: { linked: onus, equipment },
    fetched_at: new Date().toISOString(),
  });
}));

export default router;
