import * as util from 'util';
import type { RouterRow } from './mikrotik';

/**
 * `node-routeros` wraps raw socket errors in `RosException` using `err.errno`
 * (a negative number), while its message table only contains string codes like
 * `ECONNRESET`. The result is an exception whose `.message` is empty, surfaced
 * to operators as "Connection failed: RosException". Translate that back into
 * the real OS error and add the non-secret endpoint for diagnosis.
 */
export function mikrotikErrorMessage(error: any, router?: RouterRow): string {
  let cause = '';
  if (error) {
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    const blankRos = error.name === 'RosException' && Number.isFinite(Number(error.errno))
      && (!message || message === 'RosException');
    if (blankRos) {
      cause = util.getSystemErrorName(Number(error.errno)) || `errno ${error.errno}`;
    } else if (message) {
      cause = message;
    } else if (typeof error.code === 'string' && error.code.trim()) {
      cause = error.code.trim();
    } else {
      cause = String(error);
    }
  }
  if (!cause) cause = 'unknown error';

  if (!router) return cause;
  const host = String(router.host || '').trim();
  if (!host) return cause;
  const mode = String(router.integration_mode || 'API').toUpperCase();
  const port = mode === 'REST'
    ? Number(router.rest_port || (router.use_ssl ? 443 : 80))
    : Number(router.api_port || (router.use_ssl ? 8729 : 8728));
  return `${cause} (${host}:${port})`;
}

export function normalizeMikrotikError(error: any, router?: RouterRow): Error {
  const normalized = new Error(mikrotikErrorMessage(error, router));
  (normalized as any).cause = error;
  return normalized;
}

/**
 * A blank RosException or a dropped pooled socket is worth one fresh attempt.
 * Authentication/configuration errors are not — retrying them only doubles
 * lockout risk and latency.
 */
export function isTransientMikrotikError(error: any): boolean {
  const message = String(error?.message || '');
  if (/CANTLOGIN|invalid|unauthorized|authentication|password/i.test(message)) return false;
  const cause = error?.cause;
  const code = String(error?.code || cause?.code || '');
  const errno = Number(error?.errno ?? cause?.errno);
  const systemName = Number.isFinite(errno) ? (util.getSystemErrorName(errno) || '') : '';
  const transient = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND']);
  return transient.has(code) || transient.has(systemName) || (error?.name === 'RosException' && !message);
}
