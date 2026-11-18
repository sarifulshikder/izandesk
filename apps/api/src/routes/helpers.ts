import { Request, Response, NextFunction } from 'express';

export function asyncHandler(fn: (req: any, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);
}

export function getPagination(req: Request) {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/** Error that maps to a 400 response with the given message. */
export class ValidationError extends Error {
  status = 400;
}

/** Error that maps to a 409 response with the given message. */
export class ConflictError extends Error {
  status = 409;
}

/** Roles that may view the global GIS map and mutate network topology.
 *  Resellers are deliberately excluded: the map contains customer PII and the
 *  topology is ISP-wide infrastructure. The web UI hides these screens from
 *  resellers; this list enforces the same boundary on the API. */
export const GIS_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER', 'BILLING_OPERATOR', 'TECHNICIAN'];
/** Only these roles may create/update/delete topology or import/restore it. */
export const GIS_WRITE_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER'];

export function hasGisAccess(req: any): boolean {
  return GIS_ROLES.includes(String(req?.user?.role || ''));
}

export function hasGisWrite(req: any): boolean {
  return GIS_WRITE_ROLES.includes(String(req?.user?.role || ''));
}

/** Remove sensitive/internal fields before returning a subscriber to clients. */
export function sanitizeSubscriber<T = any>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const { password, portal_password, ...safe } = row as any;
  return safe;
}

/** Strip sensitive fields from a list of rows. */
export function sanitizeSubscribers<T = any>(rows: T[]): T[] {
  return (rows || []).map((r) => sanitizeSubscriber(r));
}

/** Network/OSS surfaces expose device credentials and service-control actions.
 *  They are staff-only; resellers use their own scoped portal APIs. */
export const NETWORK_READ_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER', 'BILLING_OPERATOR', 'TECHNICIAN'];
export const NETWORK_WRITE_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER'];

export function hasNetworkRead(req: any): boolean {
  return NETWORK_READ_ROLES.includes(String(req?.user?.role || ''));
}
export function hasNetworkWrite(req: any): boolean {
  return NETWORK_WRITE_ROLES.includes(String(req?.user?.role || ''));
}

/** Read access for all routes; only network engineers/admins may mutate. */
export function networkGuard(req: any, res: any, next: any) {
  if (!hasNetworkRead(req)) return res.status(403).json({ message: 'Network access is restricted to staff accounts' });
  if (req.method !== 'GET' && req.method !== 'HEAD' && !hasNetworkWrite(req)) {
    return res.status(403).json({ message: 'Insufficient permissions for network changes' });
  }
  return next();
}

/** Remove sensitive device credentials before returning a router/NAS to clients. */
export function sanitizeRouter<T = any>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const { password, radius_secret, ...safe } = row as any;
  return {
    ...safe,
    has_password: !!(row as any).password,
    has_radius_secret: !!(row as any).radius_secret,
  } as T;
}

export function sanitizeRouters<T = any>(rows: T[]): T[] {
  return (rows || []).map((r) => sanitizeRouter(r));
}

/** Remove sensitive device credentials before returning an OLT to clients. */
export function sanitizeOlt<T = any>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const { password, snmp_community, ...safe } = row as any;
  return {
    ...safe,
    has_password: !!(row as any).password,
    has_snmp_community: !!(row as any).snmp_community,
  } as T;
}

export function sanitizeOlts<T = any>(rows: T[]): T[] {
  return (rows || []).map((r) => sanitizeOlt(r));
}
