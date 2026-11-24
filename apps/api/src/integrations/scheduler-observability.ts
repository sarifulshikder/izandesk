import { pool } from '../db';

type JobStatus = 'OK' | 'ERROR' | 'SKIPPED' | 'RUNNING';

const backoffState = new Map<string, { failures: number; nextAt: number }>();

export function shouldSkipForBackoff(jobName: string): { skip: boolean; retryInMs?: number } {
  const s = backoffState.get(jobName);
  if (!s) return { skip: false };
  if (Date.now() < s.nextAt) return { skip: true, retryInMs: s.nextAt - Date.now() };
  return { skip: false };
}

function markBackoff(jobName: string, ok: boolean, baseMs = 30_000, maxMs = 15 * 60_000) {
  if (ok) { backoffState.delete(jobName); return; }
  const prev = backoffState.get(jobName)?.failures || 0;
  const failures = prev + 1;
  const delay = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, failures - 1)));
  backoffState.set(jobName, { failures, nextAt: Date.now() + delay });
}

export async function recordSchedulerRun(jobName: string, status: JobStatus, details: any = {}, error?: string | null, startedAt = Date.now()) {
  const durationMs = Math.max(0, Date.now() - startedAt);
  await pool.query(
    `INSERT INTO scheduler_job_runs(job_name,status,started_at,finished_at,duration_ms,details,error)
     VALUES($1,$2,to_timestamp($3/1000.0),now(),$4,$5::jsonb,$6)`,
    [jobName, status, startedAt, durationMs, JSON.stringify(details || {}), error ? String(error).slice(0, 1000) : null]
  ).catch(() => {});
  if (status === 'OK' || status === 'ERROR') markBackoff(jobName, status === 'OK');
}

export async function withSchedulerRun<T>(jobName: string, fn: () => Promise<T>, opts: { backoffBaseMs?: number; backoffMaxMs?: number } = {}): Promise<T | null> {
  const backoff = shouldSkipForBackoff(jobName);
  if (backoff.skip) {
    await recordSchedulerRun(jobName, 'SKIPPED', { reason: 'backoff', retryInMs: backoff.retryInMs }, null);
    return null;
  }
  const startedAt = Date.now();
  try {
    const result = await fn();
    const details = result && typeof result === 'object' ? result : { result };
    await recordSchedulerRun(jobName, 'OK', details, null, startedAt);
    markBackoff(jobName, true, opts.backoffBaseMs, opts.backoffMaxMs);
    return result;
  } catch (e: any) {
    await recordSchedulerRun(jobName, 'ERROR', {}, e?.message || String(e), startedAt);
    markBackoff(jobName, false, opts.backoffBaseMs, opts.backoffMaxMs);
    throw e;
  }
}

export async function getSchedulerStatus(limitPerJob = 1) {
  const r = await pool.query(`
    SELECT DISTINCT ON (job_name)
      job_name, status, started_at, finished_at, duration_ms, details, error
    FROM scheduler_job_runs
    ORDER BY job_name, started_at DESC
  `).catch(() => ({ rows: [] as any[] }));
  const backoff = Array.from(backoffState.entries()).map(([job_name, s]) => ({ job_name, failures: s.failures, next_retry_at: new Date(s.nextAt).toISOString() }));
  return { jobs: r.rows, backoff };
}

export async function getSchedulerMetrics() {
  const r = await pool.query(`
    SELECT job_name,
      COUNT(*) FILTER (WHERE started_at > now() - interval '24 hours')::int AS runs_24h,
      COUNT(*) FILTER (WHERE status='ERROR' AND started_at > now() - interval '24 hours')::int AS errors_24h,
      COUNT(*) FILTER (WHERE status='SKIPPED' AND started_at > now() - interval '24 hours')::int AS skipped_24h,
      AVG(duration_ms) FILTER (WHERE started_at > now() - interval '24 hours')::int AS avg_duration_ms_24h,
      MAX(started_at) AS last_run_at,
      (SELECT status FROM scheduler_job_runs s2 WHERE s2.job_name=s.job_name ORDER BY started_at DESC LIMIT 1) AS last_status
    FROM scheduler_job_runs s
    GROUP BY job_name
    ORDER BY job_name
  `).catch(() => ({ rows: [] as any[] }));
  return r.rows;
}
