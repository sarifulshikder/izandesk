# Production security hardening

IzanDesk's public demo uses well-known accounts and a development JWT secret. Real deployments must opt out of that profile; the API now validates its environment before mounting any route.

## 1. Bootstrap guard

Set these in `apps/api/.env` (and the matching compose variables):

| Variable | Required value | Why |
| --- | --- | --- |
| `JWT_SECRET` | 32+ chars, not a known default | Signs staff, portal, MCP and invoice tokens |
| `DB_PASSWORD` | Non-default, strong | PostgreSQL credential |
| `DISABLE_DEMO_ACCOUNTS` | `true` | Removes the five well-known demo logins |
| `WEB_ORIGIN` | Explicit comma-separated origins | Browser origin allowlist |
| `ALLOW_LAN_ORIGINS` | `false` | Stops automatic private-network origin access |
| `SECURITY_STRICT_MODE` | `true` (optional) | Applies the same fatal checks in staging/CI |

When `NODE_ENV=production` or `SECURITY_STRICT_MODE=true`, a failed check throws during bootstrap and the process exits with the list of problems. For a local demo that intentionally runs the insecure profile in production mode, set `SECURITY_ALLOW_INSECURE_DEMO=true` (never on a real deployment).

## 2. Revocable staff sessions

- Interactive logins create a row in `auth_sessions` and embed its UUID as the JWT `jti`.
- `authMiddleware` rejects tokens whose session was revoked or expired. Service tokens (MCP action executor, webhook helpers) have no `jti` and keep JWT-only behaviour.
- `POST /api/auth/logout` revokes the current session.
- `GET /api/auth/sessions` lists the caller's sessions; `?all=true` is SUPER_ADMIN-only.
- `POST /api/auth/sessions/revoke` accepts `{ session_id }` or `{ all: true }`.
- Changing a password revokes all other sessions for that user.
- `security.admin_ip_allowlist` is now enforced on SUPER_ADMIN API requests (exact IP or IPv4 CIDR entries).

UI: **Admin → Settings → Security → Active sessions**.

## 3. TOTP / MFA

Existing setting `security.require_2fa` is now live, alongside:

- `security.require_mfa_super_admin` — require TOTP enrollment for SUPER_ADMIN.
- `security.require_step_up` — require a fresh TOTP verification before sensitive SUPER_ADMIN actions (default `true`).

Flow:

1. `POST /api/auth/mfa/enroll` (with current password) returns an `otpauth://` URI and manual secret. The seed is AES-256-GCM encrypted with a key derived from `JWT_SECRET` before storage in `user_mfa`.
2. `POST /api/auth/mfa/confirm` verifies the first 6-digit code, enables TOTP, and returns eight one-time recovery codes (bcrypt-hashed at rest, removed after use).
3. When TOTP is enabled or required by policy, `POST /api/auth/login` returns `{ mfa_required: true, mfa_token }` instead of a session token. The web login screen shows a verification step.
4. `POST /api/auth/mfa/verify` exchanges the 5-minute challenge plus a TOTP/recovery code for a normal session.
5. `POST /api/auth/mfa/step-up` issues a 5-minute step-up token in `X-Izan-Step-Up`; MCP key create/revoke require it when the admin has TOTP enrolled.

`GET /api/auth/mfa/status` reports enrollment/requirement state. Disable with `POST /api/auth/mfa/disable` (password + current code).

UI: **Admin → Settings → Security → Multi-factor authentication**.

## 4. Login throttling

- Failed logins are locked per identifier **and** source IP (settings `security.login_max_attempts`, `security.login_lockout_minutes`).
- A 60-second IP bucket caps login attempts at 30, with `Retry-After` on 429 responses.
- MFA and session-management endpoints have their own small per-user/IP limiters.

## 5. Audit trail and retention

- `GET /api/audit/export.csv` accepts the same filters as `GET /api/audit` (`entity_type`, `entity_id`, `action`, `q`) and streams CSV with a Bearer token. The web Audit page has an **Export CSV** button that respects the active filter.
- `security.audit_retention_days` (default 365, `0` = keep forever) drives a daily cleanup sweep at API startup.
- New audited actions: `auth.logout`, `auth.session_revoked`, `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.mfa_verified`, `auth.step_up`, `auth.step_up_required`, `auth.mfa_enrollment_required`.

## 6. Validation

```bash
pnpm --filter @izandesk/shared-types build
pnpm --filter api build
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
pnpm --filter web build
node scripts/smoke-security.mjs
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/security-hardening.spec.ts
```
