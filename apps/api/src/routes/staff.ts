/** Staff & RBAC user management routes (SUPER_ADMIN only). */
import { Router } from 'express';
import bcrypt = require('bcrypt');
import { z } from 'zod';
import { pool } from '../db';
import { asyncHandler, ConflictError, ValidationError } from './helpers';
import { StaffRoleSchema, validateBody } from '../http/validate';
import { auditLog, reqActor } from '../integrations/audit';
import { validatePasswordPolicy } from '../integrations/settings';
import {
  createStaffUser,
  listStaffUsers,
  updateStaffPasswordHash,
  updateStaffUser,
  invalidateStaffCache,
} from '../integrations/staff-users';
import { revokeAllSessions } from '../security/sessions';

const router: Router = Router();

function requireSuperAdmin(req: any, res: any): boolean {
  if (String(req.user?.role || '') !== 'SUPER_ADMIN') {
    res.status(403).json({ message: 'Staff user management requires SUPER_ADMIN' });
    return false;
  }
  return true;
}

const CreateStaffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  password: z.string().min(6).max(200),
  role: StaffRoleSchema,
  reseller_id: z.string().trim().max(120).optional().nullable(),
  branch_id: z.string().uuid().optional().nullable(),
  permissions: z.array(z.string().trim().min(1).max(80)).optional(),
  must_change_password: z.boolean().optional(),
});

const UpdateStaffSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(180).optional(),
  role: StaffRoleSchema.optional(),
  reseller_id: z.string().trim().max(120).optional().nullable(),
  branch_id: z.string().uuid().optional().nullable(),
  permissions: z.array(z.string().trim().min(1).max(80)).optional(),
  is_active: z.boolean().optional(),
});

const ResetPasswordSchema = z.object({
  password: z.string().min(6).max(200),
  revoke_sessions: z.boolean().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const data = await listStaffUsers();
  res.json({ ok: true, data });
}));

router.post('/', validateBody(CreateStaffSchema), asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const b = req.body as z.infer<typeof CreateStaffSchema>;
  const pwErr = await validatePasswordPolicy(b.password);
  if (pwErr) throw new ValidationError(pwErr);
  if (b.role === 'RESELLER' && !b.reseller_id) {
    throw new ValidationError('reseller_id is required for RESELLER accounts');
  }

  try {
    const created = await createStaffUser(b);
    await auditLog({
      ...reqActor(req),
      action: 'staff.create',
      entity_type: 'staff_user',
      entity_id: created.id,
      details: { email: created.email, role: created.role },
    });
    res.status(201).json({ ok: true, data: created });
  } catch (e: any) {
    if (e?.code === '23505') throw new ConflictError('A staff user with this email already exists');
    throw e;
  }
}));

router.put('/:id', validateBody(UpdateStaffSchema), asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const targetId = String(req.params.id);
  const actorId = String((req as any).user?.id || '');
  const b = req.body as z.infer<typeof UpdateStaffSchema>;

  const cur = (await pool.query('SELECT id, role, is_active FROM staff_users WHERE id=$1', [targetId])).rows[0];
  if (!cur) return res.status(404).json({ message: 'Staff user not found' });

  if (targetId === actorId) {
    if (b.is_active === false) throw new ValidationError('You cannot disable your own active account');
    if (b.role && b.role !== 'SUPER_ADMIN') throw new ValidationError('You cannot demote your own SUPER_ADMIN role');
  }

  const removingAdmin = cur.role === 'SUPER_ADMIN' && cur.is_active && (b.is_active === false || (b.role && b.role !== 'SUPER_ADMIN'));
  if (removingAdmin) {
    const others = await pool.query(
      `SELECT COUNT(*)::int AS c FROM staff_users WHERE role='SUPER_ADMIN' AND is_active=true AND id <> $1`,
      [targetId],
    );
    if (!others.rows[0]?.c) {
      throw new ValidationError('Cannot remove or disable the last active SUPER_ADMIN');
    }
  }

  try {
    const updated = await updateStaffUser(targetId, b);
    if (!updated) return res.status(404).json({ message: 'Staff user not found' });
    let revokedSessions = 0;
    if (b.is_active === false || (b.role && b.role !== cur.role)) {
      revokedSessions = await revokeAllSessions(targetId);
    }
    await auditLog({
      ...reqActor(req),
      action: 'staff.update',
      entity_type: 'staff_user',
      entity_id: targetId,
      details: { role: updated.role, is_active: updated.is_active, revoked_sessions: revokedSessions },
    });
    res.json({ ok: true, data: updated, revoked_sessions: revokedSessions });
  } catch (e: any) {
    if (e?.code === '23505') throw new ConflictError('A staff user with this email already exists');
    throw e;
  }
}));

router.post('/:id/reset-password', validateBody(ResetPasswordSchema), asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const targetId = String(req.params.id);
  const b = req.body as z.infer<typeof ResetPasswordSchema>;
  const pwErr = await validatePasswordPolicy(b.password);
  if (pwErr) throw new ValidationError(pwErr);

  const cur = (await pool.query('SELECT id, email FROM staff_users WHERE id=$1', [targetId])).rows[0];
  if (!cur) return res.status(404).json({ message: 'Staff user not found' });

  const hash = await bcrypt.hash(b.password, 12);
  await updateStaffPasswordHash(targetId, hash);
  const revoked = b.revoke_sessions !== false ? await revokeAllSessions(targetId) : 0;

  await auditLog({
    ...reqActor(req),
    action: 'staff.reset_password',
    entity_type: 'staff_user',
    entity_id: targetId,
    details: { email: cur.email, revoked_sessions: revoked },
  });
  res.json({ ok: true, revoked_sessions: revoked });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const targetId = String(req.params.id);
  if (targetId === String((req as any).user?.id || '')) {
    throw new ValidationError('You cannot delete your own active account');
  }
  const cur = (await pool.query('SELECT id, email, role, is_active FROM staff_users WHERE id=$1', [targetId])).rows[0];
  if (!cur) return res.status(404).json({ message: 'Staff user not found' });
  if (cur.role === 'SUPER_ADMIN' && cur.is_active) {
    const others = await pool.query(
      `SELECT COUNT(*)::int AS c FROM staff_users WHERE role='SUPER_ADMIN' AND is_active=true AND id <> $1`,
      [targetId],
    );
    if (!others.rows[0]?.c) {
      throw new ValidationError('Cannot delete the last active SUPER_ADMIN');
    }
  }
  await revokeAllSessions(targetId);
  await pool.query('DELETE FROM staff_users WHERE id=$1', [targetId]);
  await invalidateStaffCache(targetId);
  await auditLog({
    ...reqActor(req),
    action: 'staff.delete',
    entity_type: 'staff_user',
    entity_id: targetId,
    details: { email: cur.email },
  });
  res.json({ ok: true });
}));

export default router;
