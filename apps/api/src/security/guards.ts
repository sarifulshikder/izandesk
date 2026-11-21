/**
 * Production security bootstrap checks.
 *
 * The public demo keeps well-known accounts and a development JWT secret, so
 * the checks only hard-fail in production or when SECURITY_STRICT_MODE=true.
 * Operators can explicitly opt into the insecure demo profile with
 * SECURITY_ALLOW_INSECURE_DEMO=true (never use that in production).
 */

const INSECURE_SECRETS = new Set([
  'change-me',
  'change-me-in-production',
  'izandesk-dev-secret-change-me',
  'secret',
  'dev-secret',
]);

const INSECURE_DB_PASSWORDS = new Set([
  'izandesk_secret_password',
  'postgres',
  'password',
]);

function enabled(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

export type SecurityStatus = {
  strict: boolean;
  production: boolean;
  demoAccountsDisabled: boolean;
  webOriginConfigured: boolean;
  jwtSecretConfigured: boolean;
  dbPasswordConfigured: boolean;
  lanOriginsAllowed: boolean;
  warnings: string[];
};

export function getSecurityStatus(): SecurityStatus {
  const jwt = String(process.env.JWT_SECRET || '').trim();
  const dbPassword = String(process.env.DB_PASSWORD || '').trim();
  const strict = enabled(process.env.SECURITY_STRICT_MODE);
  const production = process.env.NODE_ENV === 'production';
  const warnings: string[] = [];

  const jwtSecretConfigured = jwt.length >= 32 && !INSECURE_SECRETS.has(jwt.toLowerCase());
  const dbPasswordConfigured = !!dbPassword && !INSECURE_DB_PASSWORDS.has(dbPassword.toLowerCase());
  const demoAccountsDisabled = enabled(process.env.DISABLE_DEMO_ACCOUNTS);
  const webOriginConfigured = String(process.env.WEB_ORIGIN || '').trim().length > 0;
  const lanOriginsAllowed = String(process.env.ALLOW_LAN_ORIGINS || 'true').toLowerCase() !== 'false';

  if (!jwtSecretConfigured) warnings.push('JWT_SECRET is missing, too short (<32 chars), or a known default value.');
  if (!dbPasswordConfigured) warnings.push('DB_PASSWORD is missing or a known default value.');
  if (!demoAccountsDisabled) warnings.push('Demo accounts are enabled (DISABLE_DEMO_ACCOUNTS is not true).');
  if (!webOriginConfigured) warnings.push('WEB_ORIGIN is empty; browser origin policy is unrestricted.');
  if (lanOriginsAllowed) warnings.push('ALLOW_LAN_ORIGINS is enabled; private-network origins are accepted.');

  return {
    strict,
    production,
    demoAccountsDisabled,
    webOriginConfigured,
    jwtSecretConfigured,
    dbPasswordConfigured,
    lanOriginsAllowed,
    warnings,
  };
}

/** Call once during API bootstrap, before any route is mounted. */
export function assertProductionSecurity(): SecurityStatus {
  const status = getSecurityStatus();
  const insecureDemoOptIn = enabled(process.env.SECURITY_ALLOW_INSECURE_DEMO);
  const shouldFail = (status.production || status.strict) && !insecureDemoOptIn;

  if (status.warnings.length && shouldFail) {
    throw new Error(
      `SECURITY_STRICT_MODE / production bootstrap checks failed:\n` +
      status.warnings.map((w) => `  - ${w}`).join('\n') +
      '\n  Fix the environment or set SECURITY_ALLOW_INSECURE_DEMO=true for a local demo only.',
    );
  }
  if (status.warnings.length && status.production && insecureDemoOptIn) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Security] INSECURE DEMO PROFILE ENABLED — ${status.warnings.length} production hardening warning(s):\n` +
      status.warnings.map((w) => `  - ${w}`).join('\n'),
    );
  }
  return status;
}

/** Simple IPv4/IPv6-exact or IPv4 CIDR allowlist check for admin endpoints. */
export function ipAllowed(ip: string | undefined, entries: unknown): boolean {
  if (!Array.isArray(entries) || entries.length === 0) return true;
  const candidate = String(ip || '').replace(/^::ffff:/, '');
  return entries.some((raw) => {
    const rule = String(raw || '').trim();
    if (!rule) return false;
    if (rule === candidate) return true;
    if (!rule.includes('/')) return false;
    const [base, bitsRaw] = rule.split('/');
    const bits = Number(bitsRaw);
    const toInt = (value: string) => value.split('.').reduce((acc, oct) => (acc << 8) | (Number(oct) & 255), 0) >>> 0;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(base) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (toInt(candidate) & mask) === (toInt(base) & mask);
  });
}
