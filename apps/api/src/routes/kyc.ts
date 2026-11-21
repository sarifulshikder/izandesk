import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, getPagination, ValidationError } from './helpers';
import { assertSubscriberOwnership, resellerScope } from './subscriber-scope';
import { auditLog, reqActor } from '../integrations/audit';
import { getCached } from '../integrations/settings';
import {
  applyKycDecision, canReviewKyc, canViewKyc, ensureKycProfile, KYC_DECISIONS,
  KYC_IDENTITY_TYPES, KYC_LAWFUL_BASES, KYC_SERVICE_TYPES,
  recordKycEvent, recomputeKycProfile, runKycMaintenance,
} from '../integrations/kyc';
import { maskIdentityNumber } from '../security/file-validation';

const router: Router = Router();

function reviewGuard(req: any, res: any, next: any) {
  if (!canReviewKyc(req)) return res.status(403).json({ message: 'KYC review is restricted to staff reviewer roles' });
  return next();
}

function viewGuard(req: any, res: any, next: any) {
  if (canViewKyc(req) || req?.user?.role === 'RESELLER') return next();
  return res.status(403).json({ message: 'KYC access is restricted' });
}

function superAdminGuard(req: any, res: any, next: any) {
  if (req?.user?.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'SUPER_ADMIN required' });
  return next();
}

function actor(req: any) {
  const a = reqActor(req);
  return { id: a.actor_id, name: a.actor_name, role: a.actor_role, ip: a.ip_address };
}

function csvCell(value: any): string {
  const s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type FilterResult = { sql: string; params: any[]; blocked?: boolean };

async function filterFor(req: any): Promise<FilterResult> {
  const where: string[] = [];
  const params: any[] = [];
  const add = (value: any, clause: string) => { if (value !== undefined && value !== '' && value !== null) { params.push(value); where.push(clause.replace('?', `$${params.length}`)); } };
  const q = req.query as any;
  add(q.status, 'd.status=?');
  add(q.doc_type, 'd.doc_type=?');
  add(q.subscriber_id, 'd.subscriber_id=?');
  add(q.reseller_id, 's.reseller_id=?');
  add(q.service_type, 'p.service_type=?');
  if (q.expiring_days) {
    add(Number(q.expiring_days), `d.expires_at IS NOT NULL AND d.expires_at <= CURRENT_DATE + ?`);
  }
  if (q.q) {
    const like = `%${String(q.q).toLowerCase()}%`;
    const base = params.length;
    params.push(like, like, like, like);
    where.push(`(lower(s.client_code) LIKE $${base + 1} OR lower(s.full_name) LIKE $${base + 2} OR lower(d.doc_type) LIKE $${base + 3} OR lower(COALESCE(d.document_number_masked,'')) LIKE $${base + 4})`);
  }
  const scope = await resellerScope(req);
  if (scope.restricted) {
    if (!scope.uuid) return { sql: 'AND 1=0', params, blocked: true };
    params.push(scope.uuid);
    where.push(`s.reseller_id=$${params.length}`);
  }
  return { sql: where.length ? `AND ${where.join(' AND ')}` : '', params };
}

const QUEUE_FROM = `
  FROM kyc_documents d
  JOIN subscribers s ON s.id=d.subscriber_id
  LEFT JOIN resellers r ON r.id=s.reseller_id
  LEFT JOIN subscriber_kyc_profiles p ON p.subscriber_id=s.id`;

const QUEUE_SELECT = `
  SELECT d.*, s.client_code, s.full_name AS subscriber_name, s.status AS subscriber_status,
         s.reseller_id, r.name AS reseller_name,
         COALESCE(p.service_type,'FIXED_BROADBAND') AS service_type, p.overall_status
  ${QUEUE_FROM}`;

router.get('/summary', viewGuard, asyncHandler(async (req, res) => {
  const filter = await filterFor(req);
  const r = await pool.query(
    `SELECT d.status, COUNT(*)::int AS count ${QUEUE_FROM}
     WHERE 1=1 ${filter.sql} GROUP BY d.status`,
    filter.params
  );
  const byStatus: Record<string, number> = {};
  for (const row of r.rows) byStatus[row.status] = Number(row.count);
  const scope = await resellerScope(req);
  const attention = await pool.query(
    `SELECT COUNT(*)::int AS count FROM subscriber_kyc_profiles p JOIN subscribers s ON s.id=p.subscriber_id
     WHERE p.overall_status='ATTENTION' AND ($1::boolean = false OR s.reseller_id = $2::uuid)`,
    [scope.restricted, scope.uuid]
  );
  res.json({ ok: true, by_status: byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0), attention_profiles: Number(attention.rows[0]?.count || 0) });
}));

router.get('/queue', viewGuard, asyncHandler(async (req, res) => {
  const filter = await filterFor(req);
  const { limit, offset, page } = getPagination(req);
  const sql = `${QUEUE_SELECT} WHERE 1=1 ${filter.sql} ORDER BY
    CASE d.status WHEN 'PENDING' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 WHEN 'RESUBMISSION_REQUIRED' THEN 2 ELSE 3 END,
    d.uploaded_at DESC LIMIT $${filter.params.length + 1} OFFSET $${filter.params.length + 2}`;
  const [rows, count] = await Promise.all([
    pool.query(sql, [...filter.params, limit, offset]),
    pool.query(`SELECT COUNT(*)::int AS count ${QUEUE_FROM} WHERE 1=1 ${filter.sql}`, filter.params),
  ]);
  res.json({ ok: true, data: rows.rows, total: Number(count.rows[0]?.count || 0), page, limit, offset });
}));

router.get('/documents/:docId', viewGuard, asyncHandler(async (req, res) => {
  const r = await pool.query(`${QUEUE_SELECT} WHERE d.id=$1`, [req.params.docId]);
  const doc = r.rows[0];
  if (!doc) return res.status(404).json({ message: 'KYC document not found' });
  if (!(await assertSubscriberOwnership(req, res, doc.subscriber_id))) return;
  const events = await pool.query('SELECT * FROM kyc_review_events WHERE document_id=$1 ORDER BY created_at DESC', [doc.id]);
  res.json({ ok: true, data: doc, events: events.rows });
}));

router.patch('/documents/:docId', reviewGuard, asyncHandler(async (req, res) => {
  const found = await pool.query('SELECT * FROM kyc_documents WHERE id=$1', [req.params.docId]);
  if (!found.rows[0]) return res.status(404).json({ message: 'KYC document not found' });
  const b = req.body || {};
  const sets: string[] = [];
  const params: any[] = [];
  const set = (column: string, value: any) => { params.push(value); sets.push(`${column}=$${params.length}`); };
  for (const key of ['issuer', 'verification_method', 'verification_reference', 'privacy_notice_version'] as const) {
    if (b[key] !== undefined) set(key, String(b[key] || '').slice(0, 300) || null);
  }
  for (const key of ['issue_date', 'expires_at'] as const) {
    if (b[key] !== undefined) {
      const value = String(b[key] || '');
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${key} must be YYYY-MM-DD`);
      set(key, value || null);
    }
  }
  if (b.document_number !== undefined) set('document_number_masked', maskIdentityNumber(b.document_number));
  if (b.scan_status !== undefined) {
    const value = String(b.scan_status).toUpperCase();
    if (!['PENDING', 'CLEAN', 'FLAGGED', 'NOT_SCANNED'].includes(value)) throw new ValidationError('Invalid scan_status');
    set('scan_status', value);
  }
  if (!sets.length) throw new ValidationError('No updatable fields supplied');
  set('updated_at', new Date().toISOString());
  params.push(req.params.docId);
  const r = await pool.query(`UPDATE kyc_documents SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *`, params);
  const doc = r.rows[0];
  await recordKycEvent({ documentId: doc.id, subscriberId: doc.subscriber_id, actor: actor(req), action: 'METADATA_UPDATED', fromStatus: doc.status, toStatus: doc.status, reason: String(b.reason || '').slice(0, 500) || null });
  await auditLog({ ...reqActor(req), action: 'KYC_DOCUMENT_METADATA_UPDATED', entity_type: 'kyc_document', entity_id: doc.id, details: { fields: Object.keys(b), expires_at: doc.expires_at, scan_status: doc.scan_status } });
  await recomputeKycProfile(doc.subscriber_id);
  res.json({ ok: true, data: doc });
}));

router.post('/documents/:docId/decision', reviewGuard, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const decision = String(b.decision || '').toUpperCase();
  if (!(KYC_DECISIONS as readonly string[]).includes(decision)) throw new ValidationError(`decision must be one of ${KYC_DECISIONS.join(', ')}`);
  const doc = await applyKycDecision({
    documentId: req.params.docId,
    decision,
    reason: b.reason,
    evidenceRef: b.evidence_ref,
    actor: actor(req),
  });
  if (!doc) return res.status(404).json({ message: 'KYC document not found' });
  res.json({ ok: true, data: doc });
}));

router.get('/profiles/:subscriberId', viewGuard, asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.subscriberId))) return;
  await ensureKycProfile(req.params.subscriberId);
  const r = await pool.query(
    `SELECT p.*, s.client_code, s.full_name AS subscriber_name FROM subscriber_kyc_profiles p
     JOIN subscribers s ON s.id=p.subscriber_id WHERE p.subscriber_id=$1`,
    [req.params.subscriberId]
  );
  res.json({ ok: true, data: r.rows[0] });
}));

router.put('/profiles/:subscriberId', reviewGuard, asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.subscriberId))) return;
  await ensureKycProfile(req.params.subscriberId);
  const b = req.body || {};
  const sets: string[] = [];
  const params: any[] = [];
  const textKeys = ['legal_name', 'occupation', 'business_registration_number', 'tax_id', 'present_address', 'permanent_address', 'verified_mobile', 'email', 'privacy_notice_version'];
  const set = (col: string, value: any) => { params.push(value); sets.push(`${col}=$${params.length}`); };
  for (const key of textKeys) if (b[key] !== undefined) set(key, String(b[key] || '').slice(0, 500) || null);
  if (b.nid_number !== undefined) set('nid_number_masked', maskIdentityNumber(b.nid_number));
  if (b.date_of_birth !== undefined) set('date_of_birth', String(b.date_of_birth || '') || null);
  if (b.service_type !== undefined) {
    const value = String(b.service_type).toUpperCase();
    if (!(KYC_SERVICE_TYPES as readonly string[]).includes(value)) throw new ValidationError('Invalid service_type');
    set('service_type', value);
  }
  if (b.identity_type !== undefined) {
    const value = String(b.identity_type).toUpperCase();
    if (!(KYC_IDENTITY_TYPES as readonly string[]).includes(value)) throw new ValidationError('Invalid identity_type');
    set('identity_type', value);
  }
  if (b.lawful_basis !== undefined) {
    const value = String(b.lawful_basis).toUpperCase();
    if (!(KYC_LAWFUL_BASES as readonly string[]).includes(value)) throw new ValidationError('Invalid lawful_basis');
    set('lawful_basis', value);
  }
  if (b.consent_at !== undefined) set('consent_at', b.consent_at || null);
  if (b.consent_withdrawn_at !== undefined) set('consent_withdrawn_at', b.consent_withdrawn_at || null);
  if (b.risk_flags !== undefined) {
    const flags = Array.isArray(b.risk_flags) ? b.risk_flags.map((x: any) => String(x).slice(0, 80)) : [];
    set('risk_flags', JSON.stringify(flags));
  }
  if (!sets.length) throw new ValidationError('No updatable fields supplied');
  set('updated_at', new Date().toISOString());
  params.push(req.params.subscriberId);
  const r = await pool.query(`UPDATE subscriber_kyc_profiles SET ${sets.join(',')} WHERE subscriber_id=$${params.length} RETURNING *`, params);
  await auditLog({ ...reqActor(req), action: 'KYC_PROFILE_UPDATED', entity_type: 'subscriber', entity_id: req.params.subscriberId, details: { fields: Object.keys(b) } });
  await recomputeKycProfile(req.params.subscriberId);
  res.json({ ok: true, data: r.rows[0] });
}));

router.get('/export.csv', viewGuard, asyncHandler(async (req, res) => {
  const filter = await filterFor(req);
  const r = await pool.query(`${QUEUE_SELECT} WHERE 1=1 ${filter.sql} ORDER BY d.uploaded_at DESC LIMIT 10000`, filter.params);
  const redact = await getCached('kyc.redact_exports', true);
  const cols = ['subscriber_code', 'subscriber_name', 'service_type', 'doc_type', 'status', 'document_number_masked', 'issuer',
    'issue_date', 'expires_at', 'verification_method', 'reviewed_by_name', 'reviewed_at', 'rejection_reason', 'uploaded_at', 'checksum'];
  const rows = r.rows.map((d: any) => ({
    subscriber_code: d.client_code,
    subscriber_name: d.subscriber_name,
    service_type: d.service_type,
    doc_type: d.doc_type,
    status: d.status,
    document_number_masked: d.document_number_masked || '',
    issuer: d.issuer,
    issue_date: d.issue_date,
    expires_at: d.expires_at,
    verification_method: d.verification_method,
    reviewed_by_name: redact && d.reviewed_by_name ? `${String(d.reviewed_by_name).slice(0, 1)}***` : d.reviewed_by_name,
    reviewed_at: d.reviewed_at,
    rejection_reason: d.rejection_reason,
    uploaded_at: d.uploaded_at,
    checksum: d.checksum,
  }));
  await auditLog({ ...reqActor(req), action: 'KYC_EXPORT', entity_type: 'kyc', details: { rows: rows.length, redacted: !!redact, filters: req.query } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="izandesk-kyc-compliance.csv"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send([cols.join(','), ...rows.map((row: any) => cols.map((c: string) => csvCell(row[c])).join(','))].join('\n'));
}));

router.get('/legal-holds', viewGuard, asyncHandler(async (req, res) => {
  const scope = await resellerScope(req);
  const r = await pool.query(
    `SELECT h.*, d.doc_type, s.client_code FROM kyc_legal_holds h
     LEFT JOIN kyc_documents d ON d.id=h.document_id LEFT JOIN subscribers s ON s.id=h.subscriber_id
     WHERE ($1::boolean = false OR s.reseller_id = $2::uuid)
     ORDER BY h.end_at DESC LIMIT 200`,
    [scope.restricted, scope.uuid]
  );
  res.json({ ok: true, data: r.rows });
}));

router.post('/legal-holds', superAdminGuard, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const caseReference = String(b.case_reference || '').trim();
  const authority = String(b.authority || '').trim();
  const requestedBy = String(b.requested_by || '').trim();
  if (!caseReference || !authority || !requestedBy) throw new ValidationError('case_reference, authority and requested_by are required');
  let subscriberId = String(b.subscriber_id || '').trim() || null;
  const documentId = String(b.document_id || '').trim() || null;
  if (documentId) {
    const d = await pool.query('SELECT subscriber_id FROM kyc_documents WHERE id=$1', [documentId]);
    if (!d.rows[0]) return res.status(404).json({ message: 'KYC document not found' });
    subscriberId = d.rows[0].subscriber_id;
  }
  if (!subscriberId) throw new ValidationError('subscriber_id or document_id is required');
  const days = Math.min(180, Math.max(1, Number(b.days) || Number(await getCached('kyc.legal_hold_days', 90)) || 90));
  const r = await pool.query(
    `INSERT INTO kyc_legal_holds(subscriber_id,document_id,case_reference,authority,requested_by,end_at,created_by)
     VALUES($1,$2,$3,$4,$5,now() + ($6 || ' days')::interval,$7) RETURNING *`,
    [subscriberId, documentId, caseReference, authority, requestedBy, String(days), req.user?.id || null]
  );
  if (documentId) {
    await pool.query(`UPDATE kyc_documents SET legal_hold_until=GREATEST(COALESCE(legal_hold_until, now()), now() + ($2 || ' days')::interval) WHERE id=$1`, [documentId, String(days)]);
    await recordKycEvent({ documentId, subscriberId, actor: actor(req), action: 'LEGAL_HOLD', reason: `${authority} / ${caseReference}` });
  }
  await auditLog({ ...reqActor(req), action: 'KYC_LEGAL_HOLD_CREATED', entity_type: 'kyc', entity_id: r.rows[0].id, details: { subscriber_id: subscriberId, document_id: documentId, authority, case_reference: caseReference, days } });
  res.status(201).json({ ok: true, data: r.rows[0] });
}));

router.post('/legal-holds/:id/release', superAdminGuard, asyncHandler(async (req, res) => {
  const r = await pool.query('UPDATE kyc_legal_holds SET released_at=now() WHERE id=$1 AND released_at IS NULL RETURNING *', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Active legal hold not found' });
  await auditLog({ ...reqActor(req), action: 'KYC_LEGAL_HOLD_RELEASED', entity_type: 'kyc', entity_id: req.params.id });
  res.json({ ok: true, data: r.rows[0] });
}));

router.post('/maintenance/run', superAdminGuard, asyncHandler(async (req, res) => {
  const result = await runKycMaintenance();
  await auditLog({ ...reqActor(req), action: 'KYC_MAINTENANCE_RUN', entity_type: 'kyc', details: result });
  res.json({ ok: true, ...result });
}));

export default router;
