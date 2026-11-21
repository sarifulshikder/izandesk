/** Short-lived step-up token for sensitive SUPER_ADMIN operations. */
import jwt = require('jsonwebtoken');
import { getCached } from '../integrations/settings';
import { mfaEnabled } from './mfa';

const SECRET = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
const TTL = '5m';

export async function stepUpRequiredFor(userId: string, role: string): Promise<boolean> {
  const configured = await getCached('security.require_step_up', true);
  return !!configured && role === 'SUPER_ADMIN' && await mfaEnabled(userId);
}

/** Returns true when no step-up is needed or a valid fresh token was supplied. */
export async function stepUpSatisfied(req: { headers: Record<string, any> }, user: { id: string; role: string }): Promise<boolean> {
  if (!await stepUpRequiredFor(user.id, user.role)) return true;
  return verifyStepUpToken(stepUpHeader(req), user.id);
}

export function issueStepUpToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'step_up' }, SECRET, { expiresIn: TTL });
}

export function verifyStepUpToken(token: string | undefined, userId: string): boolean {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, SECRET) as { sub?: string; purpose?: string };
    return payload.purpose === 'step_up' && payload.sub === userId;
  } catch { return false; }
}

export function stepUpHeader(req: { headers: Record<string, any> }): string | undefined {
  const value = req.headers['x-izan-step-up'];
  return Array.isArray(value) ? value[0] : value ? String(value) : undefined;
}
