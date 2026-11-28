import { pool } from '../db';
import { emitNocAlert } from './noc-alerts';
import { withSchedulerRun } from './scheduler-observability';

/**
 * Billing-health observability for the expiry/reactivation pipeline.
 *
 * The goal is to catch the production failure mode called out by ISP
 * troubleshooting guides: money arrived, but the subscriber is still blocked.
 * All queries are bounded by age so a busy system does not alert forever about
 * payments that are legitimately still being processed.
 */

async function count(sql: string, params: any[] = []): Promise<number> {
  const r = await pool.query(sql, params).catch(() => ({ rows: [] as any[] }));
  return Number(r.rows[0]?.count || 0);
}

async function sample(sql: string, params: any[] = []): Promise<any[]> {
  const r = await pool.query(sql, params).catch(() => ({ rows: [] as any[] }));
  return r.rows || [];
}

export async function getBillingHealth() {
  const [stuckPayments, stuckWebhooks, failedEnforcement, overdueEnforcement, paidNotActive] = await Promise.all([
    count(`SELECT COUNT(*)::int AS count FROM payments
           WHERE status IN ('PENDING','VERIFYING') AND created_at < now() - interval '15 minutes'`),
    // Signature-failure rows are deliberately left unprocessed; they are denied
    // webhooks, not work waiting to be done.
    count(`SELECT COUNT(*)::int AS count FROM payment_webhook_events
           WHERE processed=false AND created_at < now() - interval '10 minutes'
             AND COALESCE((result->>'verified')::boolean, true) = true`),
    count(`SELECT COUNT(*)::int AS count FROM enforcement_outbox
           WHERE status='FAILED' AND updated_at < now() - interval '5 minutes'`),
    count(`SELECT COUNT(*)::int AS count FROM enforcement_outbox
           WHERE status='PENDING' AND next_attempt_at < now() - interval '10 minutes'`),
    count(`SELECT COUNT(*)::int AS count FROM payments p
           JOIN subscribers s ON s.id=p.subscriber_id
           WHERE p.status='COMPLETED' AND p.purpose='PACKAGE_PURCHASE'
             AND p.updated_at >= now() - interval '30 minutes'
             AND upper(COALESCE(s.status,'')) <> 'ACTIVE'`),
  ]);

  const [paymentSamples, paidSamples, outboxSamples] = await Promise.all([
    sample(`SELECT payment_ref, gateway, status, amount, created_at FROM payments
            WHERE status IN ('PENDING','VERIFYING') AND created_at < now() - interval '15 minutes'
            ORDER BY created_at ASC LIMIT 10`),
    sample(`SELECT p.payment_ref, p.amount, p.updated_at, s.client_code, s.status, s.expiry_date
            FROM payments p JOIN subscribers s ON s.id=p.subscriber_id
            WHERE p.status='COMPLETED' AND p.purpose='PACKAGE_PURCHASE'
              AND p.updated_at >= now() - interval '30 minutes'
              AND upper(COALESCE(s.status,'')) <> 'ACTIVE'
            ORDER BY p.updated_at DESC LIMIT 10`),
    sample(`SELECT o.id, o.subscriber_id, o.action, o.status, o.attempts, o.last_error, o.next_attempt_at
            FROM enforcement_outbox o
            WHERE (o.status='FAILED' AND o.updated_at < now() - interval '5 minutes')
               OR (o.status='PENDING' AND o.next_attempt_at < now() - interval '10 minutes')
            ORDER BY o.updated_at ASC LIMIT 10`),
  ]);

  return {
    ok: true,
    counts: { stuckPayments, stuckWebhooks, failedEnforcement, overdueEnforcement, paidNotActive },
    samples: { stuckPayments: paymentSamples, paidNotActive: paidSamples, enforcement: outboxSamples },
    healthy: stuckPayments === 0 && stuckWebhooks === 0 && failedEnforcement === 0 &&
      overdueEnforcement === 0 && paidNotActive === 0,
    thresholds: { stuckPaymentsMinutes: 15, stuckWebhooksMinutes: 10, failedEnforcementMinutes: 5, paidNotActiveMinutes: 30 },
  };
}

export async function runBillingHealthSweep() {
  return withSchedulerRun('billing-health-sweep', async () => {
    const health = await getBillingHealth();
    const c = health.counts;

    if (c.paidNotActive > 0) {
      await emitNocAlert({
        severity: 'CRITICAL',
        source: 'BILLING_HEALTH',
        title: 'Paid package purchase but subscriber not active',
        message: `${c.paidNotActive} completed package purchase(s) in the last 30 minutes still have a non-ACTIVE subscriber.`,
        details: { count: c.paidNotActive, samples: health.samples.paidNotActive },
        dedupeMinutes: 15,
      }).catch(() => {});
    }
    if (c.stuckPayments > 0) {
      await emitNocAlert({
        severity: 'WARNING',
        source: 'BILLING_HEALTH',
        title: 'Stuck pending payments',
        message: `${c.stuckPayments} payment(s) have been PENDING/VERIFYING for more than 15 minutes.`,
        details: { count: c.stuckPayments, samples: health.samples.stuckPayments },
        dedupeMinutes: 30,
      }).catch(() => {});
    }
    if (c.stuckWebhooks > 0) {
      await emitNocAlert({
        severity: 'WARNING',
        source: 'BILLING_HEALTH',
        title: 'Unprocessed verified webhook events',
        message: `${c.stuckWebhooks} verified webhook event(s) remain unprocessed for more than 10 minutes.`,
        details: { count: c.stuckWebhooks },
        dedupeMinutes: 30,
      }).catch(() => {});
    }
    if (c.failedEnforcement > 0 || c.overdueEnforcement > 0) {
      await emitNocAlert({
        severity: 'WARNING',
        source: 'BILLING_HEALTH',
        title: 'Enforcement outbox backlog',
        message: `${c.failedEnforcement} failed and ${c.overdueEnforcement} overdue enforcement job(s) are waiting for RADIUS/MikroTik reprovisioning.`,
        details: { failed: c.failedEnforcement, overdue: c.overdueEnforcement, samples: health.samples.enforcement },
        dedupeMinutes: 30,
      }).catch(() => {});
    }

    return { ...health, alertsChecked: 4 };
  }).catch(() => null);
}

export function startBillingHealthMonitor(intervalMs = 2 * 60 * 1000) {
  const tick = () => { void runBillingHealthSweep(); };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
