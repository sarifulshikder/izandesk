/** Structured JSON logging (pino) with automatic secret redaction and request IDs. */
import crypto = require('crypto');
import type { NextFunction, Request, Response } from 'express';
import pino = require('pino');
import { recordHttpMetric } from './metrics';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

export const logger = pino({
  level,
  base: { service: 'izandesk-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      'password_hash',
      'portal_password',
      'secret',
      'token',
      'api_key',
      'apiKey',
      'snmp_community',
      'radius_secret',
      'webhook_secret',
      'smtp_pass',
      'private_key',
      'preshared_key',
      '*.password',
      '*.password_hash',
      '*.secret',
      '*.token',
      '*.api_key',
      '*.snmp_community',
      '*.radius_secret',
      '*.webhook_secret',
      '*.smtp_pass',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-sms-token"]',
    ],
    censor: '[REDACTED]',
  },
});

const QUIET_PATHS = new Set(['/api/live', '/api/ready', '/api/health', '/api/metrics']);

function routeLabel(req: Request): string {
  const base = req.baseUrl || '';
  const routePath = (req as any).route?.path;
  if (routePath) {
    const p = typeof routePath === 'string' ? routePath : '';
    return `${base}${p}` || req.path || '/';
  }
  return (req.path || '/').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const reqId = String(req.headers['x-request-id'] || '') || crypto.randomUUID();
    res.setHeader('x-request-id', reqId);
    const start = process.hrtime.bigint();
    const child = logger.child({ reqId, method: req.method, path: req.originalUrl || req.url });
    (req as any).id = reqId;
    (req as any).log = child;

    res.on('finish', () => {
      const durSec = Number(process.hrtime.bigint() - start) / 1e9;
      const label = routeLabel(req);
      recordHttpMetric(req.method, label, res.statusCode, durSec);
      if (QUIET_PATHS.has(req.path) && res.statusCode < 400) {
        child.debug({ statusCode: res.statusCode, durationMs: Math.round(durSec * 1000) }, 'http request');
        return;
      }
      const payload = {
        statusCode: res.statusCode,
        durationMs: Math.round(durSec * 1000),
        route: label,
        userId: (req as any).user?.id,
        role: (req as any).user?.role,
      };
      if (res.statusCode >= 500) child.error(payload, 'http request failed');
      else if (res.statusCode >= 400) child.warn(payload, 'http request error');
      else child.info(payload, 'http request');
    });

    next();
  };
}
