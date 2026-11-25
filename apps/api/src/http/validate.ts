/** Zod v4 request validation helpers mapping schema failures to ValidationError (HTTP 400). */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../routes/helpers';

export function formatZodError(err: z.ZodError): string {
  const issues = err.issues || [];
  if (!issues.length) return 'Validation failed';
  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path?.length ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(formatZodError(parsed.error));
  }
  return parsed.data;
}

export function validateBody<T>(schema: z.ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parseWithSchema(schema, req.body ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function validateQuery<T>(schema: z.ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      (req as any).validatedQuery = parseWithSchema(schema, req.query ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const StaffRoleSchema = z.enum([
  'SUPER_ADMIN',
  'NOC_ENGINEER',
  'BILLING_OPERATOR',
  'TECHNICIAN',
  'RESELLER',
]);

export const UuidLikeSchema = z.string().trim().min(1).max(128);
