# Staging deployment & smoke checklist

Use this after the auth/billing/network hardening changes and before promoting a
build to production. Run against a **disposable staging environment** with a
recent database backup; mutation tests must never target a live customer stack.

## 1. Preflight

1. Take a database backup.
2. Check for legacy duplicates that would prevent the new payment idempotency
   indexes from being created:

   ```sql
   SELECT gateway, trx_id, count(*) AS n
   FROM payments
   WHERE trx_id IS NOT NULL
   GROUP BY gateway, trx_id
   HAVING count(*) > 1;

   SELECT idempotency_key, count(*) AS n
   FROM payments
   WHERE idempotency_key IS NOT NULL
   GROUP BY idempotency_key
   HAVING count(*) > 1;

   SELECT gateway, trx_id, count(*) AS n
   FROM payment_sms_events
   WHERE trx_id IS NOT NULL
   GROUP BY gateway, trx_id
   HAVING count(*) > 1;
   ```

   The API migration logs `[DB] payment idempotency index skipped` when it hits
   duplicates; it does not abort startup. Review duplicates manually, then
   create the missing indexes before production.

3. Check for orphan reseller links (the new FK is skipped if any exist):

   ```sql
   SELECT s.id
   FROM subscribers s
   LEFT JOIN resellers r ON r.id = s.reseller_id
   WHERE s.reseller_id IS NOT NULL AND r.id IS NULL;
   ```

4. Confirm required environment/settings:
   - `JWT_SECRET`, `DB_PASSWORD`, `KYC_ENCRYPTION_KEYS`, `KYC_ENCRYPTION_ACTIVE_KEY_ID`
   - `WEB_ORIGIN`, `DISABLE_DEMO_ACCOUNTS`, `SECURITY_STRICT_MODE` / `NODE_ENV`
   - `PLUGINS_DIR=/plugins` in API/all-in-one containers
   - FreeRADIUS SQL template values rendered from `.env`
   - `RADIUS_NAS_HOSTS` / `RADIUS_NAS_SECRET` only when SQL-backed NAS clients should be seeded on FreeRADIUS start (leave the secret empty to skip)
   - payment gateways: intended `enabled` values; gateways seed as disabled

5. Confirm probes: `/api/live` returns **200** while the process is alive (even
   during DB outage), while `/api/ready` and `/api/health` return **503** when DB
   or kernel are not ready. Do not treat the old always-200 response as healthy.
   The API performs a live `SELECT 1` probe and keeps an `error` listener on the
   pg pool, so a DB restart must produce 503 on readiness/health without crashing the process.

## 2. Deploy to staging

```bash
pnpm build
pnpm --filter api test
pnpm --filter web lint
docker compose -f docker/docker-compose.yml config
docker compose -f docker/docker-compose.yml up -d --build
```

For a **fresh disposable** local/CI stack only, seed the smoke fixtures once:

```bash
pnpm seed:e2e
```

Do not run the E2E seeder against a staging database that contains customer data.

Review startup logs for:
- no `payment idempotency index skipped` warnings (or a tracked cleanup ticket)
- no `subscribers.reseller_id FK skipped` warning
- plugins loaded from `/plugins`
- no production security bootstrap failure

## 3. Smoke tests

### Auth & session security

- [ ] Staff login succeeds; logout revokes the session.
- [ ] An MFA challenge token, step-up token, or portal token cannot be used as
      the `Authorization: Bearer` staff credential.
- [ ] MFA enrollment requires the current password; confirm uses a TOTP code;
      disable requires password + code.
- [ ] WebSocket connections require a staff token and enforce role checks.
- [ ] Session listing/revocation works and cannot revoke another user's session
      without `SUPER_ADMIN`.

### Billing & payments

- [ ] Invoice generation applies an existing `subscribers.excess_amount` as a
      discount and subtracts it from the subscriber credit.
- [ ] Two concurrent invoice batches do not lose an invoice to an
      `invoice_number` collision.
- [ ] Gateway checkout works; a gateway with `enabled=false` returns 403 and
      creates no pending payment.
- [ ] Webhook with a valid HMAC over the **exact raw body** is accepted.
- [ ] Webhook with the same JSON but different whitespace/signature is rejected.
- [ ] Webhook amount above the pending checkout is rejected.
- [ ] Webhook not bound to a `PENDING` payment records no payment.
- [ ] Duplicate webhook/SMS deliveries with the same transaction ID are
      idempotent (one payment, one finance entry).
- [ ] Overpayment is credited to `excess_amount` and consumed by the next invoice.
- [ ] A `due_amount` waiver is not recreated as debt by a later payment.
- [ ] Paying an auto-suspended subscriber reactivates them; a
      `suspension_source=MANUAL` subscriber stays suspended unless explicitly
      reactivated.
- [ ] A `PACKAGE_PURCHASE` checkout records the server-side package price in
      `payments.amount`, `purpose`, and `package_id`; a caller-supplied amount is
      ignored.
- [ ] A completed package purchase extends validity even when an unrelated
      invoice is still due, without clearing that invoice or consuming
      `excess_amount`.
- [ ] An online payment for a created-EXPIRED subscriber produces exactly one
      completed payment and one wallet/finance posting, then sets `ACTIVE`.
- [ ] A webhook whose side effect fails stays `processed=false` and is retried;
      `GET /api/system/billing-health` reports it until handled.
- [ ] A deliberately unreachable router leaves an `enforcement_outbox` job that
      succeeds after the router returns; the database and network state converge.

### Network integrations

- [ ] RouterOS API: watch logs for ~10 minutes; expect one `izandesk` login per
      router and no 30-second login/logout churn (`keepalive: true`).
- [ ] RADIUS CoA/Disconnect validates the response instead of trusting a socket
      write.
- [ ] OLT discovery never fabricates ONUs from unsupported enterprise OIDs.
- [ ] OLT telemetry refresh is grouped and SSE streams stop their timers on
      disconnect.
- [ ] WireGuard tunnel allocation honors the configured CIDR and avoids the
      hub/network/broadcast addresses.

### Portal & web

- [ ] Portal login requires the real password; no client code/phone/username
      fallback.
- [ ] A customer can read only their own `/api/portal/acs/status` and can update
      Wi-Fi only on their own subscription.
- [ ] An EXPIRED subscriber can log into `/portal`, sees the expiry banner and a
      Buy/Renew action, and can buy an active package from `/expired`.
- [ ] After gateway return, the portal polls `/api/portal/payments/:ref` and
      displays the new expiry plus "Internet restored" only when the backend
      reports `ACTIVE`; a timeout does not claim success.
- [ ] CSV downloads require staff authentication.
- [ ] No React "script tag while rendering" console error; light/dark theme is
      applied before first paint and survives reload.
- [ ] AI Copilot actions respect role capabilities and do not target arbitrary
      subscriber IDs from free text.

### Operations

- [ ] Stop DB briefly (or point at an invalid DB host) and confirm
      `/api/health` returns 503 with `ok:false`, the API process stays up, and
      health returns 200 again after the DB recovers.
- [ ] Plugins appear in the kernel plugin list after a container restart.
- [ ] FreeRADIUS authenticates a test subscriber using credentials from `.env`.
- [ ] Scheduled report/message jobs produce no duplicate sends after a restart.

## 4. Promote / rollback

- Promote only when every smoke item passes and logs are clean.
- Keep the pre-deploy backup until one full billing cycle has completed.
- If rollback is needed, restore the backup **and** redeploy the previous image
  tag; schema additions are mostly backward-compatible but the new unique
  indexes and FK will not exist on the old build.
