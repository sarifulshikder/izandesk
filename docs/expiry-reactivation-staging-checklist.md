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

Run mutations only in staging/test data. For a faster local run, use
`pnpm test:e2e:docker`; it starts the optional `web-e2e` container on `:3100`
with a prebuilt copy of the app, leaving `:3000` and the public URL on the
hot-reloading dev server.

## 9. Resolved staging E2E flakiness

Earlier full runs on this slow Docker host hit UI-only timeouts on pages untouched by the expiry/reactivation work. These are now addressed:

- Playwright ceilings raised for on-demand Next dev compiles (`180s` test, `30s` action, `15s` expect).
- Reseller tab sweep, wizard buttons, dashboard KPI click and AI sidebar link pass with those ceilings.
- Reseller wizard and tenant-scoping checks now seed their own disposable subscriber and delete it in `finally`; they no longer depend on leftovers from opt-in mutation runs.
- MapLibre readiness no longer misses a cached `style.load`: the GIS map checks `isStyleLoaded()` after attaching the listener and initializes once.
- The location-picker canvas assertion is page-scoped because the picker portal renders outside the wizard DOM.

These were test/environment and readiness issues, not billing regressions. The self-care purchase checks, signed webhook/idempotency checks and GIS workbench checks pass.

## 10. Failure-path checks (disposable data only)

These checks were verified against staging with throwaway subscribers. Each one cleans up its own subscriber, payment, webhook event, and RADIUS rows.

1. **Webhook side-effect retry:** temporarily force the payment insert to fail for one checkout ref. The signed delivery returns 500 and leaves the webhook event `processed=false` with the payment still `PENDING`. After removing the fault, replaying the *same* event gives `processed=true`, one `COMPLETED` payment, no synthetic `ADM-RECHARGE-*`, and an `ACTIVE` subscriber.
2. **Underpayment:** send a signed webhook for a `PACKAGE_PURCHASE` checkout with an amount below the server price. It is rejected with `verified=false, processed=false`; the checkout stays `PENDING` and the subscriber stays `EXPIRED`. A later webhook with the exact price then completes and activates. Invoice payments may still be partial, but no webhook may exceed the stored payment amount.
3. **Router/RADIUS outage:** block the provisioning write to `radius_users` for one subscriber. The entitlement commits (`ACTIVE`, renewed expiry) but the outbox job moves to `FAILED` with `last_error=Enforcement failed: radius_sync` and an exponential backoff. After the write is restored, the worker moves the job to `DONE` and the RADIUS projection becomes `SYNCED`. A job that reaches 8 attempts is marked terminal instead of retried forever.

After each check, `GET /api/system/billing-health` must return `healthy: true` with all counts zero.

## 11. Rollback note

Rolling back code does not remove the new schema columns or `enforcement_outbox`; they are additive and safe to leave. Disable `PORTAL_SANDBOX_CHECKOUT` first if it was enabled for staging.
