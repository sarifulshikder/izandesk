/** Session management and TOTP enrollment/verification for staff accounts. */
import { Router } from 'express';
import bcrypt = require('bcrypt');
import jwt = require('jsonwebtoken');
import { pool } from '../db';
import { auditLog, reqActor } from '../integrations/audit';
import { getCached } from '../integrations/settings';
import { asyncHandler } from './helpers';
import { consumeMfaCode, getMfaRecord, mfaEnabled, mfaRequiredFor } from '../security/mfa';
import { createRateLimiter } from '../security/rate-limit';
import { encryptSecret, decryptSecret } from '../security/secret-store';
import { createSession, findSession, listSessions, newSessionId, revokeAllSessions, revokeSessions, touchSession } from '../security/sessions';
import { issueStepUpToken } from '../security/step-up';
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from '../security/totp';

const JWT_SECRET = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
const mfaLimiter = createRateLimiter('mfa', 10, 60_000);
const sessionLimiter = createRateLimiter('sessions', 20, 60_000);

export type AuthSecurityDeps = {
  findUser: (id: string) => any | Promise<any | undefined>;
  checkPassword: (user: any, password: string) => Promise<boolean>;
  issueToken: (user: any, minutes: number, jti?: string) => string;
};

export function createAuthSecurityRouter(deps: AuthSecurityDeps): Router {
  const router = Router();
  const actor = (req: any) => req.user as { id: string; name?: string; email?: string; role: string };
  const sessionMinutes = async () => Number(await getCached('security.session_timeout_minutes', 720)) || 720;

  async function startSession(req: any, res: any, user: any, extra: Record<string, any> = {}) {
    const minutes = await sessionMinutes();
    const jti = newSessionId();
    await createSession({
      id: jti,
      userId: user.id,
      minutes,
      ip: req.ip || String(req.headers['x-forwarded-for'] || '') || undefined,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || undefined,
    });
    await auditLog({ actor_id: user.id, actor_name: user.name || user.email, actor_role: user.role, action: 'auth.login', entity_type: 'auth', ip_address: req.ip });
    res.json({ token: deps.issueToken(user, minutes, jti), user, ...extra });
  }

  router.post('/logout', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const jti = String((jwt.decode(String(req.headers.authorization || '').slice(7)) as any)?.jti || '');
    if (jti) await revokeSessions([jti], user.id);
    await auditLog({ ...reqActor(req), action: 'auth.logout', entity_type: 'auth', entity_id: user.id });
    res.json({ ok: true });
  }));

  router.get('/sessions', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const all = user.role === 'SUPER_ADMIN' && req.query.all === 'true';
    res.json({ ok: true, data: await listSessions(user.id, all) });
  }));

  router.post('/sessions/revoke', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const limit = await sessionLimiter.checkDistributed(`${user.id}:${req.ip || ''}`, 20);
    if (!limit.allowed) return res.status(429).json({ message: 'Too many session requests. Try again shortly.', retry_after_sec: limit.retryAfterSec });
    const { session_id, all } = req.body || {};
    let revoked = 0;
    if (all === true || all === 'true') {
      revoked = await revokeAllSessions(user.id);
    } else if (session_id) {
      const id = String(session_id);
      const target = await findSession(id);
      if (!target) return res.status(404).json({ message: 'Session not found' });
      if (target.user_id !== user.id && user.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Cannot revoke another user’s session' });
      revoked = await revokeSessions([id]);
    } else {
      return res.status(400).json({ message: 'session_id or all=true is required' });
    }
    await auditLog({ ...reqActor(req), action: 'auth.session_revoked', entity_type: 'auth', entity_id: all ? 'all' : String(session_id), details: { count: revoked } });
    res.json({ ok: true, revoked });
  }));

  router.get('/mfa/status', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const record = await getMfaRecord(user.id);
    res.json({
      ok: true,
      enabled: !!(record?.enabled && !record.disabled_at),
      required: await mfaRequiredFor(user.role),
      enrolled: !!record,
      recovery_codes_remaining: Array.isArray(record?.recovery_hashes) ? record.recovery_hashes.length : 0,
    });
  }));

  router.post('/mfa/enroll', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const limit = await mfaLimiter.checkDistributed(`enroll:${user.id}:${req.ip || ''}`, 5);
    if (!limit.allowed) return res.status(429).json({ message: 'Too many MFA attempts. Try again shortly.', retry_after_sec: limit.retryAfterSec });
    const existing = await getMfaRecord(user.id);
    if (existing?.enabled && !existing.disabled_at) return res.status(409).json({ message: 'MFA is already enabled. Disable it before re-enrolling.' });
    const found = await deps.findUser(user.id);
    if (!found || !await deps.checkPassword(found, String(req.body?.password || ''))) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    const secret = generateTotpSecret();
    await pool.query(
      `INSERT INTO user_mfa(user_id, secret_enc, enabled, recovery_hashes, enrolled_at)
       VALUES($1,$2,false,'[]'::jsonb,now())
       ON CONFLICT (user_id) DO UPDATE SET secret_enc=EXCLUDED.secret_enc, enabled=false, recovery_hashes='[]'::jsonb, enrolled_at=now(), verified_at=NULL, disabled_at=NULL`,
      [user.id, encryptSecret(secret)],
    );
    res.json({ ok: true, secret, otpauth_uri: otpauthUri(secret, user.email || String(user.id)), issuer: 'IzanDesk' });
  }));

  router.post('/mfa/confirm', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const limit = await mfaLimiter.checkDistributed(`confirm:${user.id}:${req.ip || ''}`, 5);
    if (!limit.allowed) return res.status(429).json({ message: 'Too many MFA attempts. Try again shortly.', retry_after_sec: limit.retryAfterSec });
    const record = await getMfaRecord(user.id);
    if (!record || record.enabled) return res.status(400).json({ message: 'Start MFA enrollment first.' });
    let valid = false;
    try { valid = verifyTotp(decryptSecret(record.secret_enc), String(req.body?.code || '')); } catch {}
    if (!valid) return res.status(400).json({ message: 'Invalid authenticator code.' });
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map((code) => bcrypt.hash(code, 10)));
    await pool.query('UPDATE user_mfa SET enabled=true, verified_at=now(), recovery_hashes=$2::jsonb WHERE user_id=$1', [user.id, JSON.stringify(hashes)]);
    await auditLog({ ...reqActor(req), action: 'auth.mfa_enabled', entity_type: 'auth', entity_id: user.id });
    const extra = { ok: true, recovery_codes: recoveryCodes, note: 'Save these recovery codes now. Each one works once.' };
    if ((req as any).authPurpose === 'mfa_enrollment') {
      const foundUser = await deps.findUser(user.id);
      if (foundUser) return await startSession(req, res, foundUser, extra);
    }
    res.json(extra);
  }));

  router.post('/mfa/disable', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const limit = await mfaLimiter.checkDistributed(`disable:${user.id}:${req.ip || ''}`, 5);
    if (!limit.allowed) return res.status(429).json({ message: 'Too many MFA attempts. Try again shortly.', retry_after_sec: limit.retryAfterSec });
    const found = await deps.findUser(user.id);
    if (!found || !await deps.checkPassword(found, String(req.body?.password || ''))) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    const consumed = await consumeMfaCode(user.id, String(req.body?.code || ''));
    if (!consumed.ok) return res.status(400).json({ message: consumed.error || 'Invalid verification code.' });
    await pool.query('UPDATE user_mfa SET enabled=false, recovery_hashes=\'[]\'::jsonb, disabled_at=now() WHERE user_id=$1', [user.id]);
    await auditLog({ ...reqActor(req), action: 'auth.mfa_disabled', entity_type: 'auth', entity_id: user.id });
    res.json({ ok: true });
  }));

  // Second half of login when require_2fa / an enrolled account demands TOTP.
  router.post('/mfa/verify', asyncHandler(async (req: any, res) => {
    const limit = await mfaLimiter.checkDistributed(`verify:${req.ip || ''}`, 10);
    if (!limit.allowed) return res.status(429).json({ message: 'Too many verification attempts. Try again shortly.', retry_after_sec: limit.retryAfterSec });
    let sub = '';
    try {
      const payload = jwt.verify(String(req.body?.mfa_token || ''), JWT_SECRET) as { sub?: string; purpose?: string };
      if (payload.purpose !== 'mfa' || !payload.sub) throw new Error('invalid');
      sub = payload.sub;
    } catch { return res.status(400).json({ message: 'MFA challenge expired. Sign in again.' }); }
    const user = await deps.findUser(sub);
    if (!user) return res.status(401).json({ message: 'Invalid session' });
    if (!await mfaEnabled(user.id)) return res.status(400).json({ message: 'MFA is not enabled for this account.' });
    const consumed = await consumeMfaCode(user.id, String(req.body?.code || ''));
    if (!consumed.ok) return res.status(400).json({ message: consumed.error || 'Invalid verification code.' });
    await auditLog({ actor_id: user.id, actor_name: user.name || user.email, actor_role: user.role, action: 'auth.mfa_verified', entity_type: 'auth', details: { method: consumed.method } });
    await startSession(req, res, user);
  }));

  router.post('/mfa/step-up', asyncHandler(async (req: any, res) => {
    const user = actor(req);
    const limit = await mfaLimiter.checkDistributed(`stepup:${user.id}:${req.ip || ''}`, 10);
    if (!limit.allowed) return res.status(429).json({ message: 'Too many verification attempts. Try again shortly.', retry_after_sec: limit.retryAfterSec });
    if (!await mfaEnabled(user.id)) return res.status(400).json({ message: 'Enroll MFA before using step-up verification.' });
    const consumed = await consumeMfaCode(user.id, String(req.body?.code || ''));
    if (!consumed.ok) return res.status(400).json({ message: consumed.error || 'Invalid verification code.' });
    await auditLog({ ...reqActor(req), action: 'auth.step_up', entity_type: 'auth', entity_id: user.id });
    res.json({ ok: true, step_up_token: issueStepUpToken(user.id), expires_in_sec: 300 });
  }));

  return router;
}
