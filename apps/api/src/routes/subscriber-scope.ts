import { pool } from '../db';

export interface ResellerScope {
  restricted: boolean;
  uuid: string | null;
}

/** Resolve the caller's reseller ownership. Never trusts a client-supplied id. */
export async function resellerScope(req: any): Promise<ResellerScope> {
  const user = req.user || {};
  if (user.role !== 'RESELLER') return { restricted: false, uuid: null };
  const code = String(user.resellerId ?? '').trim();
  if (!code) return { restricted: true, uuid: null };
  const r = await pool.query(
    'SELECT id FROM resellers WHERE id::text=$1 OR lower(code)=lower($1) OR lower(subdomain)=lower($1) LIMIT 1',
    [code],
  );
  return { restricted: true, uuid: r.rows[0]?.id || null };
}

/**
 * Fail closed for resellers: an unresolvable account (uuid null) is denied, and
 * an unassigned subscriber (reseller_id IS NULL) is never treated as owned.
 * Sends the response and returns false when access must be blocked.
 */
export async function assertSubscriberOwnership(req: any, res: any, subscriberId: string): Promise<boolean> {
  const scope = await resellerScope(req);
  if (!scope.restricted) return true;
  if (!scope.uuid || !subscriberId) {
    res.status(403).json({ message: 'No reseller account linked to this login' });
    return false;
  }
  const r = await pool.query('SELECT id FROM subscribers WHERE id=$1 AND reseller_id=$2', [subscriberId, scope.uuid]);
  if (!r.rows[0]) {
    res.status(404).json({ message: 'Subscriber not found' });
    return false;
  }
  return true;
}
