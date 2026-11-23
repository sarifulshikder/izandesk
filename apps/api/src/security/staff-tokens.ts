/**
 * Staff bearer-token verification.
 *
 * MFA challenges, step-up tokens, portal tokens and other purpose-specific JWTs
 * are signed with the same secret. They must never be accepted as general staff
 * sessions. This verifier makes that boundary explicit: a staff token must have
 * a known staff role, a subject, and no purpose/type/audience claims.
 */
import jwt = require('jsonwebtoken');

export type StaffTokenPayload = {
  sub: string;
  role: string;
  email?: string;
  jti?: string;
};

const STAFF_ROLES = new Set([
  'SUPER_ADMIN',
  'NOC_ENGINEER',
  'BILLING_OPERATOR',
  'TECHNICIAN',
  'RESELLER',
]);

export function verifyStaffToken(token: string, secret: string): StaffTokenPayload {
  const payload = jwt.verify(token, secret) as Record<string, any>;
  if (!payload || typeof payload !== 'object') throw new Error('invalid token payload');
  if (payload.purpose || payload.type || payload.aud || payload.iss) throw new Error('purpose-specific token is not a staff session');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('token subject is missing');
  if (!STAFF_ROLES.has(String(payload.role))) throw new Error('token role is missing or unknown');
  return {
    sub: payload.sub,
    role: String(payload.role),
    ...(payload.email ? { email: String(payload.email) } : {}),
    ...(payload.jti ? { jti: String(payload.jti) } : {}),
  };
}

export function verifyPurposeToken(token: string | undefined, secret: string, purpose: string): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret) as Record<string, any>;
    if (payload?.purpose !== purpose || typeof payload.sub !== 'string' || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
