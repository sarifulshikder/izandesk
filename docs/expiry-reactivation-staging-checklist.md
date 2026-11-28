# Expiry → self-service renewal staging checklist

Target deployment: `https://izandesk.duckdns.org/`

Use this after deploying the package-purchase / reactivation changes. Do **not** run mutation checks against production customer data.

## 1. Deploy order

1. **Deploy/restart the API first.**
   - `initDb()` applies the new schema at boot:
     - `payments.purpose`
     - `payments.package_id`
     - `enforcement_outbox`
   - Confirm startup logs have no `[DB] enforcement outbox skipped` warning.
2. **Deploy/rebuild the web app.**
   - The updated `/portal` and `/expired` pages need the new production build.
3. **Keep the API supervised.**
   - `billing-due-policy-sweep`, `enforcement-outbox-worker`, and `billing-health-sweep` run inside the API process.

## 2. Environment / gateway configuration

Set these on the API container/service:

```bash
PUBLIC_BASE_URL=https://izandesk.duckdns.org
PORTAL_URL=https://izandesk.duckdns.org/portal
CAPTIVE_PORTAL_BASE_URL=https://izandesk.duckdns.org
```

Payment gateway settings (per chosen gateway):

- Webhook endpoint: `https://izandesk.duckdns.org/api/billing/webhooks/<gateway>`
- Webhook secret: must be configured; unsigned events are rejected.
- bKash callback URL: `https://izandesk.duckdns.org/api/billing/payments/bkash/callback`
  - The plugin/callback config must override captive `return_url=/expired`.
- Public checkout fails closed when the gateway is disabled or unconfigured.

For **staging only**, simulated checkout can be enabled:

```bash
PORTAL_SANDBOX_CHECKOUT=1
```

It only works when the gateway row has `mode=SANDBOX`. Never enable this in production.

## 3. Fast database verification

Run inside the API container or with the app DB client:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'payments'
  AND column_name IN ('purpose', 'package_id')
ORDER BY column_name;

SELECT to_regclass('public.enforcement_outbox');
```

Expected: both columns and the `enforcement_outbox` table exist.

## 4. Rakib scenario

Use a test subscriber and a package with `validity_value=1`, `validity_unit=CALENDAR_MONTH`.

### A. First purchase / activation

1. Create the subscriber with that package.
2. Confirm:
   - `subscribers.status='EXPIRED'`
   - `suspension_source='CREATION'`
   - portal login still works with the **portal** password, not the PPPoE secret.
3. In `/portal` → **Plans**, click **Buy/Renew**.
4. Complete checkout.
5. Confirm:
   - `payments.status='COMPLETED'`
   - `payments.purpose='PACKAGE_PURCHASE'`
   - `payments.package_id=<selected package id>`
   - exactly **one** completed payment for the transaction
   - no second `ADM-RECHARGE-*` payment
   - `subscribers.status='ACTIVE'`
   - new `expiry_date` = today + package validity in the business timezone
   - UI shows the new expiry and “Internet restored”

### B. Expiry day

On the package expiry date:

1. Wait for the 60-second due-policy sweep.
2. Confirm:
   - internet session is blocked/redirected,
   - `/portal` and `/expired` remain reachable through the walled garden,
   - portal shows `EXPIRED` and days remaining `0`.
3. Confirm the boundary rule: restriction starts **on** the expiry date, not at the next UTC midnight.

### C. Renewal after expiry

1. From `/expired`, select the same or another active package.
2. Complete online checkout.
3. Confirm:
   - one completed payment,
   - subscriber `ACTIVE`,
   - expiry extended from today (not from the lapsed date),
   - RADIUS/MikroTik state restored,
   - captive redirect entries removed,
   - UI polls payment status and confirms restoration without manual refresh.

## 5. Useful verification queries

Replace the identifiers with the test subscriber’s values:

```sql
SELECT id, status, expiry_date, suspension_stage, suspension_source,
       walled_garden, current_due
FROM subscribers
WHERE client_code = 'TEST-RAKIB';

SELECT payment_ref, purpose, package_id, amount, status, trx_id, created_at
FROM payments
WHERE subscriber_id = '<subscriber-id>'
ORDER BY created_at DESC
LIMIT 10;

SELECT id, action, status, attempts, last_error, next_attempt_at
FROM enforcement_outbox
WHERE subscriber_id = '<subscriber-id>'
ORDER BY created_at DESC
LIMIT 10;

SELECT username, attribute, value
FROM radcheck
WHERE username = '<pppoe-username>';
```

For RADIUS hard suspension expect `Auth-Type := Reject`; for walled garden expect restricted attributes/address list rather than a full reject.

## 6. Failure-path checks

- **Webhook replay:** deliver the same signed event twice. Expect one completed payment; second delivery returns duplicate.
- **Failed side effect:** temporarily break the payment write path. Event must remain `processed=false` and be retried.
- **Disabled gateway:** `enabled=false` must return HTTP 403 and create no pending payment.
- **Underpayment:** amount below server package price must not activate.
- **Unrelated dues:** a package purchase must extend validity without clearing a separate open invoice.
- **Router outage:** point the subscriber at an unreachable router, complete a purchase, then restore the router. The outbox worker should converge DB and network state.
- **Paid but not active:** `GET /api/system/billing-health` must eventually report zero for `paidNotActive`.

## 7. Health endpoint

Authenticate as `SUPER_ADMIN` or `NOC_ENGINEER`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://izandesk.duckdns.org/api/system/billing-health
```

Healthy response has `healthy: true` and all counts zero.

## 8. E2E command against this host

```bash
E2E_BASE_URL=https://izandesk.duckdns.org \
E2E_ADMIN_EMAIL='<admin-email>' \
E2E_ADMIN_PASSWORD='<admin-password>' \
E2E_MUTATIONS=1 \
pnpm test:e2e
```

Run mutations only in staging/test data.

## 9. Rollback note

Rolling back code does not remove the new schema columns or `enforcement_outbox`; they are additive and safe to leave. Disable `PORTAL_SANDBOX_CHECKOUT` first if it was enabled for staging.
