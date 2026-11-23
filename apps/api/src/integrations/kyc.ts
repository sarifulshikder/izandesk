import path = require('path');
import fs = require('fs');
import { pool } from '../db';
import { auditLog } from './audit';
import { getCached } from './settings';
import { maskIdentityNumber } from '../security/file-validation';
import {
  activeKycKey, decryptKycFile, EncryptedKycFile, KycEncryptionMeta,
  reencryptKycFile, secureUnlinkKycFile,
} from '../security/file-encryption';

export const KYC_DOC_TYPES = ['NID', 'PASSPORT', 'CONTRACT', 'PHOTO', 'UTILITY_BILL', 'TRADE_LICENSE', 'OTHER'] as const;
export const KYC_STATUSES = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED', 'EXPIRED', 'NOT_APPLICABLE'] as const;
export const KYC_SERVICE_TYPES = ['FIXED_BROADBAND', 'WIRELESS_BROADBAND', 'HOTSPOT', 'CYBER_CAFE', 'LEASED_LINE'] as const;
export const KYC_IDENTITY_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export const KYC_LAWFUL_BASES = ['CONTRACT', 'LEGAL_OBLIGATION', 'CONSENT', 'VITAL_INTERESTS'] as const;

/** Review is a staff-only trust boundary. Resellers may upload/view their own
 *  subscribers' documents, but never decide identity verification. */
export const KYC_REVIEW_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'TECHNICIAN'];
export const KYC_VIEW_ROLES = [...KYC_REVIEW_ROLES, 'NOC_ENGINEER'];

export const DECISION_STATUS: Record<string, string> = {
  MARK_UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_RESUBMISSION: 'RESUBMISSION_REQUIRED',
  MARK_EXPIRED: 'EXPIRED',
};
export const KYC_DECISIONS = Object.keys(DECISION_STATUS);

const uploadDir = path.resolve(__dirname, '../../../uploads/kyc');

export function kycMetaFromRow(row: any): KycEncryptionMeta | null {
  if (!row?.encryption_alg) return null; // legacy plaintext document
  return {
    algorithm: String(row.encryption_alg),
    iv: String(row.encryption_iv || ''),
    authTag: String(row.encryption_auth_tag || ''),
    keyId: String(row.encryption_key_id || ''),
  };
}

/** Read and verify a stored KYC document before it is sent to an authorized viewer. */
export function readKycDocument(row: any): Buffer {
  const fp = path.resolve(uploadDir, String(row?.file_path || ''));
  if (!fp.startsWith(uploadDir + path.sep)) {
    const err: any = new Error('Invalid document path'); err.status = 400; throw err;
  }
  if (!fs.existsSync(fp)) {
    const err: any = new Error('Document file not found'); err.status = 404; throw err;
  }
  try {
    return decryptKycFile(fp, kycMetaFromRow(row));
  } catch {
    const err: any = new Error('KYC document could not be decrypted'); err.status = 500; throw err;
  }
}

export interface KycActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  ip?: string | null;
}

export function canReviewKyc(req: any): boolean {
  return KYC_REVIEW_ROLES.includes(String(req?.user?.role || ''));
}

export function canViewKyc(req: any): boolean {
  return KYC_VIEW_ROLES.includes(String(req?.user?.role || ''));
}

export async function canResellerUploadKyc(): Promise<boolean> {
  return Boolean(await getCached('kyc.allow_reseller_upload', true));
}

export async function allowedKycDocTypes(): Promise<string[]> {
  const configured = await getCached('kyc.allowed_doc_types', [...KYC_DOC_TYPES]);
  const list = Array.isArray(configured) && configured.length ? configured.map((x: any) => String(x).toUpperCase()) : [...KYC_DOC_TYPES];
  return list.filter((x: string) => (KYC_DOC_TYPES as readonly string[]).includes(x));
}

export function normalizeDocType(value: unknown): string {
  const raw = String(value ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  return (KYC_DOC_TYPES as readonly string[]).includes(raw) ? raw : 'OTHER';
}

function badRequest(message: string): never {
  const err: any = new Error(message);
  err.status = 400;
  throw err;
}

function conflict(message: string): never {
  const err: any = new Error(message);
  err.status = 409;
  throw err;
}

async function retentionDate(): Promise<string | null> {
  const days = Number(await getCached('kyc.document_retention_days', 0)) || 0;
  if (days <= 0) return null;
  const until = new Date();
  until.setUTCDate(until.getUTCDate() + Math.round(days));
  return until.toISOString().slice(0, 10);
}

export async function ensureKycProfile(subscriberId: string): Promise<void> {
  await pool.query(
    `INSERT INTO subscriber_kyc_profiles(subscriber_id, privacy_notice_version)
     VALUES($1,$2) ON CONFLICT (subscriber_id) DO NOTHING`,
    [subscriberId, String(await getCached('kyc.privacy_notice_version', '2026-11-v1'))]
  );
}

export async function recordKycEvent(input: {
  documentId: string;
  subscriberId: string;
  actor: KycActor;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  evidenceRef?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO kyc_review_events(document_id,subscriber_id,actor_id,actor_name,actor_role,action,from_status,to_status,reason,evidence_ref,ip_address)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [input.documentId, input.subscriberId, input.actor.id || null, input.actor.name || null, input.actor.role || null,
      input.action, input.fromStatus || null, input.toStatus || null, input.reason || null, input.evidenceRef || null, input.actor.ip || null]
  ).catch(() => {});
}

export async function recomputeKycProfile(subscriberId: string): Promise<void> {
  await ensureKycProfile(subscriberId);
  const [mandatoryRes, docsRes] = await Promise.all([
    (async () => {
      const configured = await getCached('kyc.mandatory_doc_types', []);
      return Array.isArray(configured) ? configured.map((x: any) => String(x).toUpperCase()) : [];
    })(),
    pool.query('SELECT doc_type,status FROM kyc_documents WHERE subscriber_id=$1', [subscriberId]),
  ]);
  const docs = docsRes.rows;
  const statuses = docs.map((d: any) => String(d.status));
  const attention = statuses.some((s: string) => ['REJECTED', 'RESUBMISSION_REQUIRED', 'EXPIRED'].includes(s));
  const required = mandatoryRes.length ? mandatoryRes : null;
  // Every configured mandatory type must be present AND approved. Filtering
  // only the documents that exist would wrongly mark a subscriber COMPLETE
  // when a required document type has not been uploaded at all.
  const allRequiredApproved = required
    ? required.every((type: string) => docs.some((d: any) => String(d.doc_type) === type && d.status === 'APPROVED'))
    : statuses.includes('APPROVED');
  let overall = 'INCOMPLETE';
  if (attention) overall = 'ATTENTION';
  else if (allRequiredApproved) overall = 'COMPLETE';
  else if (statuses.includes('UNDER_REVIEW')) overall = 'UNDER_REVIEW';
  else if (docs.length) overall = 'PENDING';
  await pool.query(
    `UPDATE subscriber_kyc_profiles SET overall_status=$2, updated_at=now() WHERE subscriber_id=$1`,
    [subscriberId, overall]
  );
}

export async function createKycDocument(input: {
  subscriberId: string;
  docType: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  source: 'STAFF' | 'PORTAL' | 'MCP' | 'IMPORT';
  actor: KycActor;
  checksum?: string | null;
  documentNumber?: string | null;
  issuer?: string | null;
  issueDate?: string | null;
  expiresAt?: string | null;
  verificationMethod?: string | null;
  verificationReference?: string | null;
  reuploadOf?: string | null;
  encryption?: EncryptedKycFile | null;
}): Promise<any> {
  const allowed = await allowedKycDocTypes();
  const docType = normalizeDocType(input.docType);
  if (!allowed.includes(docType)) badRequest(`${docType} is not an allowed KYC document type`);
  if (input.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) badRequest('expires_at must be YYYY-MM-DD');
  if (input.issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) badRequest('issue_date must be YYYY-MM-DD');
  if (input.reuploadOf) {
    const previous = await pool.query('SELECT subscriber_id FROM kyc_documents WHERE id=$1', [input.reuploadOf]);
    if (!previous.rows[0] || previous.rows[0].subscriber_id !== input.subscriberId) {
      badRequest('reupload_of must reference a document belonging to this subscriber');
    }
  }
  await ensureKycProfile(input.subscriberId);
  const retention = await retentionDate();
  const notice = String(await getCached('kyc.privacy_notice_version', '2026-11-v1'));
  const r = await pool.query(
    `INSERT INTO kyc_documents(
      subscriber_id,doc_type,file_name,file_path,mime_type,status,checksum,storage_key,scan_status,source,
      document_number_masked,issuer,issue_date,expires_at,verification_method,verification_reference,
      privacy_notice_version,reupload_of,retention_until,
      encryption_alg,encryption_iv,encryption_auth_tag,encryption_key_id,updated_at)
     VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7,'PENDING',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now())
     RETURNING *`,
    [input.subscriberId, docType, input.fileName, input.filePath, input.mimeType, input.checksum || null,
      input.filePath, input.source, maskIdentityNumber(input.documentNumber), input.issuer || null,
      input.issueDate || null, input.expiresAt || null, input.verificationMethod || null,
      input.verificationReference || null, notice, input.reuploadOf || null, retention,
      input.encryption?.algorithm || null, input.encryption?.iv || null,
      input.encryption?.authTag || null, input.encryption?.keyId || null]
  );
  const doc = r.rows[0];
  await recordKycEvent({ documentId: doc.id, subscriberId: doc.subscriber_id, actor: input.actor, action: 'UPLOADED', toStatus: 'PENDING' });
  await auditLog({
    ...input.actor,
    action: 'KYC_DOCUMENT_UPLOADED',
    entity_type: 'kyc_document',
    entity_id: doc.id,
    details: { subscriber_id: doc.subscriber_id, doc_type: doc.doc_type, source: doc.source, checksum: doc.checksum, file_name: doc.file_name, encryption_key_id: doc.encryption_key_id || null },
  });
  await recomputeKycProfile(input.subscriberId);
  return doc;
}

export async function deleteKycDocument(input: {
  documentId: string;
  subscriberId: string;
  actor: KycActor;
}): Promise<any | null> {
  const r = await pool.query('SELECT * FROM kyc_documents WHERE id=$1 AND subscriber_id=$2', [input.documentId, input.subscriberId]);
  const doc = r.rows[0];
  if (!doc) return null;
  const hold = await pool.query(
    `SELECT 1 FROM kyc_legal_holds
     WHERE released_at IS NULL AND end_at > now() AND (document_id=$1 OR subscriber_id=$2) LIMIT 1`,
    [doc.id, doc.subscriber_id]
  );
  if (hold.rows.length) conflict('Document is under legal hold and cannot be deleted');
  await recordKycEvent({ documentId: doc.id, subscriberId: doc.subscriber_id, actor: input.actor, action: 'DELETED', fromStatus: doc.status });
  await pool.query('DELETE FROM kyc_documents WHERE id=$1', [doc.id]);
  const fp = path.resolve(uploadDir, String(doc.file_path || ''));
  if (fp.startsWith(uploadDir + path.sep)) secureUnlinkKycFile(fp);
  await auditLog({
    ...input.actor,
    action: 'KYC_DOCUMENT_DELETED',
    entity_type: 'kyc_document',
    entity_id: doc.id,
    details: { subscriber_id: doc.subscriber_id, doc_type: doc.doc_type, file_name: doc.file_name },
  });
  await recomputeKycProfile(doc.subscriber_id);
  return doc;
}

export async function applyKycDecision(input: {
  documentId: string;
  decision: string;
  reason?: string | null;
  evidenceRef?: string | null;
  actor: KycActor;
}): Promise<any | null> {
  const target = DECISION_STATUS[input.decision];
  if (!target) badRequest(`Unsupported KYC decision: ${input.decision}`);
  const reason = String(input.reason || '').trim() || null;
  if (['REJECT', 'REQUEST_RESUBMISSION'].includes(input.decision) && !reason) {
    badRequest('A reason is required to reject or request resubmission');
  }
  const client = await pool.connect();
  let doc: any;
  let fromStatus: string | null = null;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM kyc_documents WHERE id=$1 FOR UPDATE', [input.documentId]);
    doc = found.rows[0];
    if (!doc) { await client.query('ROLLBACK'); return null; }
    fromStatus = String(doc.status || null);
    if (doc.status === 'APPROVED' && target === 'APPROVED') conflict('Document is already approved');
    const updated = await client.query(
      `UPDATE kyc_documents SET status=$1, reviewed_by=$2, reviewed_by_name=$3, reviewed_at=now(),
       rejection_reason=$4, updated_at=now() WHERE id=$5 RETURNING *`,
      [target, input.actor.id || null, input.actor.name || null, reason, input.documentId]
    );
    doc = updated.rows[0];
    await client.query(
      `INSERT INTO kyc_review_events(document_id,subscriber_id,actor_id,actor_name,actor_role,action,from_status,to_status,reason,evidence_ref,ip_address)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [doc.id, doc.subscriber_id, input.actor.id || null, input.actor.name || null, input.actor.role || null,
        input.decision, found.rows[0].status, target, reason, input.evidenceRef || null, input.actor.ip || null]
    );
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
  await recomputeKycProfile(doc.subscriber_id);
  await auditLog({
    ...input.actor,
    action: `KYC_${input.decision}`,
    entity_type: 'kyc_document',
    entity_id: doc.id,
    details: { subscriber_id: doc.subscriber_id, doc_type: doc.doc_type, from_status: fromStatus, to_status: target, reason, evidence_ref: input.evidenceRef || null },
  });
  return doc;
}

/** Encrypt legacy plaintext files and re-key documents after a key rotation. */
export async function migrateKycFileEncryption(limit = 200): Promise<{ encrypted: number; reencrypted: number }> {
  const result = { encrypted: 0, reencrypted: 0 };
  const activeId = activeKycKey().id;
  const rows = await pool.query(
    `SELECT * FROM kyc_documents
     WHERE file_path IS NOT NULL AND (encryption_alg IS NULL OR encryption_key_id IS DISTINCT FROM $1)
     ORDER BY uploaded_at ASC LIMIT $2`,
    [activeId, limit]
  );
  for (const doc of rows.rows) {
    const fp = path.resolve(uploadDir, String(doc.file_path || ''));
    if (!fp.startsWith(uploadDir + path.sep) || !fs.existsSync(fp)) continue;
    const meta = kycMetaFromRow(doc);
    const wasPlain = !meta?.algorithm;
    let next: (EncryptedKycFile & { previousPath: string }) | null = null;
    try {
      next = reencryptKycFile(fp, meta);
      if (!next) continue;
      const relativePath = path.relative(uploadDir, next.filePath).split(path.sep).join('/');
      await pool.query(
        `UPDATE kyc_documents SET file_path=$2, storage_key=$2, encryption_alg=$3, encryption_iv=$4,
         encryption_auth_tag=$5, encryption_key_id=$6, updated_at=now() WHERE id=$1`,
        [doc.id, relativePath, next.algorithm, next.iv, next.authTag, next.keyId]
      );
      secureUnlinkKycFile(next.previousPath); // remove the superseded ciphertext only after the row is updated
      await auditLog({
        actor_role: 'SYSTEM',
        action: wasPlain ? 'KYC_FILE_ENCRYPTED' : 'KYC_FILE_REKEYED',
        entity_type: 'kyc_document',
        entity_id: doc.id,
        details: { key_id: next.keyId, from_key_id: meta?.keyId || null, subscriber_id: doc.subscriber_id },
      });
      if (wasPlain) result.encrypted += 1;
      else result.reencrypted += 1;
    } catch (e: any) {
      if (next) secureUnlinkKycFile(next.filePath); // avoid leaving an orphaned re-keyed file
      await auditLog({
        actor_role: 'SYSTEM', action: 'KYC_FILE_ENCRYPTION_ERROR', entity_type: 'kyc_document', entity_id: doc.id,
        details: { message: String(e?.message || e).slice(0, 300) },
      });
    }
  }
  return result;
}

/** Daily expiry/reminder/retention sweep. Legal holds always win. */
export async function runKycMaintenance(): Promise<{ expired: number; reminded: number; deleted: number; encrypted: number; reencrypted: number }> {
  const result = { expired: 0, reminded: 0, deleted: 0, encrypted: 0, reencrypted: 0 };
  const warningDays = Number(await getCached('kyc.expiry_warning_days', 30)) || 0;
  try {
    const expired = await pool.query(
      `UPDATE kyc_documents SET status='EXPIRED', updated_at=now()
       WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE
         AND status NOT IN ('EXPIRED','NOT_APPLICABLE') RETURNING *`
    );
    for (const doc of expired.rows) {
      await recordKycEvent({ documentId: doc.id, subscriberId: doc.subscriber_id, actor: { role: 'SYSTEM' }, action: 'AUTO_EXPIRED', fromStatus: doc.status, toStatus: 'EXPIRED' });
      await recomputeKycProfile(doc.subscriber_id);
    }
    result.expired = expired.rows.length;

    if (warningDays > 0) {
      const soon = await pool.query(
        `UPDATE kyc_documents SET last_reminder_at=now(), updated_at=now()
         WHERE expires_at IS NOT NULL AND expires_at >= CURRENT_DATE
           AND expires_at <= CURRENT_DATE + ($1)::integer
           AND status NOT IN ('EXPIRED','NOT_APPLICABLE','APPROVED')
           AND (last_reminder_at IS NULL OR last_reminder_at < now() - interval '7 days')
         RETURNING *`,
        [Math.trunc(warningDays)]
      );
      for (const doc of soon.rows) {
        await auditLog({ actor_role: 'SYSTEM', action: 'KYC_EXPIRY_REMINDER', entity_type: 'kyc_document', entity_id: doc.id,
          details: { subscriber_id: doc.subscriber_id, expires_at: doc.expires_at, warning_days: warningDays } });
      }
      result.reminded = soon.rows.length;
    }

    const retentionDays = Number(await getCached('kyc.document_retention_days', 0)) || 0;
    if (retentionDays > 0) {
      const stale = await pool.query(
        `SELECT * FROM kyc_documents
         WHERE retention_until IS NOT NULL AND retention_until < CURRENT_DATE
           AND (legal_hold_until IS NULL OR legal_hold_until < now())
           AND NOT EXISTS (SELECT 1 FROM kyc_legal_holds h
                           WHERE (h.document_id=kyc_documents.id OR h.subscriber_id=kyc_documents.subscriber_id)
                              AND h.released_at IS NULL AND h.end_at > now())`
      );
      for (const doc of stale.rows) {
        await deleteKycDocument({ documentId: doc.id, subscriberId: doc.subscriber_id, actor: { role: 'SYSTEM', name: 'Retention sweep' } });
      }
      result.deleted = stale.rows.length;
    }

    const migrated = await migrateKycFileEncryption();
    result.encrypted = migrated.encrypted;
    result.reencrypted = migrated.reencrypted;
  } catch (e: any) {
    await auditLog({ actor_role: 'SYSTEM', action: 'KYC_MAINTENANCE_ERROR', entity_type: 'kyc', details: { message: String(e?.message || e).slice(0, 300) } });
  }
  return result;
}
