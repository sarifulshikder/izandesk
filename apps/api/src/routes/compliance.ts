import { Router } from 'express';
import multer = require('multer');
import path = require('path');
import fs = require('fs');
import crypto = require('crypto');
import { pool } from '../db';
import { asyncHandler, ValidationError } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';
import { KYC_VIEW_ROLES } from '../integrations/kyc';
import { assertAllowedSubmissionFile, sha256File } from '../security/file-validation';

const router: Router = Router();
const uploadDir = path.resolve(__dirname, '../../../uploads/compliance');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const MAX_BYTES = 20 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = ['.pdf', '.csv', '.xlsx'].includes(ext) ? ext : '';
    cb(null, `${crypto.randomUUID()}${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^(application\/pdf|text\/csv|application\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/i.test(file.mimetype)) {
      return cb(new ValidationError('Only PDF, CSV or XLSX files are allowed'));
    }
    return cb(null, true);
  },
});

function staffGuard(req: any, res: any, next: any) {
  if (!KYC_VIEW_ROLES.includes(String(req?.user?.role || ''))) return res.status(403).json({ message: 'Compliance access is restricted to staff accounts' });
  return next();
}

function writeGuard(req: any, res: any, next: any) {
  if (!['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(req?.user?.role || ''))) return res.status(403).json({ message: 'Only SUPER_ADMIN or BILLING_OPERATOR may record submissions' });
  return next();
}

router.get('/submissions', staffGuard, asyncHandler(async (req, res) => {
  const q = String((req.query as any).q || '').trim();
  const r = await pool.query(
    `SELECT * FROM compliance_submissions
     WHERE $1='' OR lower(period_label) LIKE $2 OR lower(report_type) LIKE $2 OR lower(portal) LIKE $2
     ORDER BY created_at DESC LIMIT 500`,
    [q, `%${q.toLowerCase()}%`]
  );
  res.json({ ok: true, data: r.rows });
}));

router.post('/submissions', writeGuard, upload.single('file'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const portal = String(b.portal || 'DIS').toUpperCase();
  const reportType = String(b.report_type || 'MONTHLY').toUpperCase();
  const periodLabel = String(b.period_label || '').trim();
  if (!periodLabel) throw new ValidationError('period_label is required');
  if (!['DIS', 'ISPMS', 'EMAIL', 'MANUAL'].includes(portal)) throw new ValidationError('Invalid portal');
  if (!['MONTHLY', 'QUARTERLY', 'ANNUAL_CLIENT_LIST', 'KYC_PACK', 'OTHER'].includes(reportType)) throw new ValidationError('Invalid report_type');
  let checksum: string | null = null;
  if (req.file) {
    try {
      assertAllowedSubmissionFile(req.file.path, req.file.mimetype);
      checksum = sha256File(req.file.path);
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      throw e;
    }
  }
  const r = await pool.query(
    `INSERT INTO compliance_submissions(portal,report_type,period_label,period_start,period_end,file_name,file_path,checksum,submitted_at,acknowledgement_ref,status,submitted_by,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [portal, reportType, periodLabel, b.period_start || null, b.period_end || null,
      req.file?.originalname || null, req.file?.filename || null, checksum,
      b.submitted_at || null, b.acknowledgement_ref || null, String(b.status || (b.submitted_at ? 'SUBMITTED' : 'DRAFT')).toUpperCase(),
      req.user?.id || null, req.user?.id || null]
  );
  await auditLog({ ...reqActor(req), action: 'COMPLIANCE_SUBMISSION_CREATED', entity_type: 'compliance_submission', entity_id: r.rows[0].id,
    details: { portal, report_type: reportType, period_label: periodLabel, checksum } });
  res.status(201).json({ ok: true, data: r.rows[0] });
}));

router.patch('/submissions/:id', writeGuard, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query(
    `UPDATE compliance_submissions SET status=COALESCE($2,status), acknowledgement_ref=COALESCE($3,acknowledgement_ref),
      rejection_reason=COALESCE($4,rejection_reason), submitted_at=COALESCE($5,submitted_at) WHERE id=$1 RETURNING *`,
    [req.params.id, b.status || null, b.acknowledgement_ref || null, b.rejection_reason || null, b.submitted_at || null]
  );
  if (!r.rows[0]) return res.status(404).json({ message: 'Submission not found' });
  await auditLog({ ...reqActor(req), action: 'COMPLIANCE_SUBMISSION_UPDATED', entity_type: 'compliance_submission', entity_id: req.params.id, details: { fields: Object.keys(b) } });
  res.json({ ok: true, data: r.rows[0] });
}));

router.get('/submissions/:id/file', staffGuard, asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT * FROM compliance_submissions WHERE id=$1', [req.params.id]);
  const row = r.rows[0];
  if (!row?.file_path) return res.status(404).json({ message: 'Submission file not found' });
  const fp = path.resolve(uploadDir, String(row.file_path));
  if (!fp.startsWith(uploadDir + path.sep) || !fs.existsSync(fp)) return res.status(404).json({ message: 'Submission file not found' });
  const safeName = String(row.file_name || 'submission').replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  fs.createReadStream(fp).pipe(res);
}));

export default router;
