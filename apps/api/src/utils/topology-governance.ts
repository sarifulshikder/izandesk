import { pool } from '../db';

/** Append-only record of a topology change. Never throws into the request path —
 *  auditing must not make a successful mutation look like a failure. */
export async function auditTopology(req: any, entityType: string, entityId: string | null, action: string, details: any = {}) {
  try {
    const u = req?.user || {};
    await pool.query(
      `INSERT INTO topology_audit(entity_type,entity_id,action,details,actor_id,actor_email)
       VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
      [entityType, entityId, action, JSON.stringify(details || {}), u.id || null, u.email || null]);
  } catch (e) { console.error('[Audit] topology audit insert failed', e); }
}

/** Snapshot a row before deletion so it can be restored later. */
export async function trashTopology(req: any, entityType: string, entityId: string, payload: any): Promise<string | null> {
  const u = req?.user || {};
  const r = await pool.query(
    `INSERT INTO topology_trash(entity_type,entity_id,payload,deleted_by)
     VALUES($1,$2,$3::jsonb,$4) RETURNING id`,
    [entityType, entityId, JSON.stringify(payload), u.email || u.id || null]);
  return r.rows[0]?.id || null;
}
