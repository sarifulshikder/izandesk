/**
 * Durable BullMQ job queues backed by Redis, with transparent in-process
 * fallback when running in LITE_MODE or when Redis is unavailable.
 */
import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { getRedisConfig, isRedisEnabled, isRedisReady } from './redis';
import { logger } from './logger';

export type QueueName = 'billing' | 'network' | 'messaging' | 'ops';

export type JobHandler = (job: Job) => Promise<any>;

const queues = new Map<QueueName, Queue>();
const workers = new Map<QueueName, Worker>();
const registeredHandlers = new Map<string, JobHandler>();
let active = false;

function bullConnection(): ConnectionOptions {
  const cfg = getRedisConfig();
  if (cfg.url) {
    try {
      const u = new URL(cfg.url);
      return {
        host: u.hostname || '127.0.0.1',
        port: Number(u.port || 6379),
        ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
        ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      };
    } catch { /* fall through */ }
  }
  return {
    host: cfg.host,
    port: cfg.port,
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.db ? { db: cfg.db } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export function isQueuesActive(): boolean {
  return active;
}

export function registerQueueHandler(queue: QueueName, jobName: string, handler: JobHandler) {
  registeredHandlers.set(`${queue}:${jobName}`, handler);
}

export async function initQueues(): Promise<boolean> {
  if (!isRedisEnabled() || !isRedisReady()) {
    logger.info('[Queues] BullMQ skipped (Redis unavailable or lite mode); using in-process scheduler fallback');
    return false;
  }
  if (active) return true;

  const connection = bullConnection();
  const defs: Array<{ name: QueueName; concurrency: number }> = [
    { name: 'billing', concurrency: 2 },
    { name: 'network', concurrency: 3 },
    { name: 'messaging', concurrency: 4 },
    { name: 'ops', concurrency: 2 },
  ];

  try {
    for (const def of defs) {
      const qName = `izandesk-${def.name}`;
      const q = new Queue(qName, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 200, age: 86400 },
          removeOnFail: { count: 200, age: 7 * 86400 },
        },
      });
      q.on('error', (err) => {
        logger.debug({ queue: def.name, err: err?.message }, '[Queues] queue error');
      });
      const w = new Worker(
        qName,
        async (job) => {
          const handler = registeredHandlers.get(`${def.name}:${job.name}`);
          if (!handler) throw new Error(`No handler registered for ${def.name}:${job.name}`);
          return await handler(job);
        },
        { connection, concurrency: def.concurrency },
      );
      w.on('failed', (job, err) => {
        logger.warn({ queue: def.name, job: job?.name, jobId: job?.id, err: err?.message }, '[Queues] job failed');
      });
      w.on('error', (err) => {
        logger.debug({ queue: def.name, err: err?.message }, '[Queues] worker error');
      });
      await Promise.race([
        Promise.all([q.waitUntilReady(), w.waitUntilReady()]),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('BullMQ ready timeout')), 3000)),
      ]);
      queues.set(def.name, q);
      workers.set(def.name, w);
    }
    active = true;
    logger.info({ queues: defs.map((d) => d.name) }, '[Queues] BullMQ queues & workers started');
    return true;
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[Queues] BullMQ initialization failed; falling back to in-process execution');
    await closeQueues();
    return false;
  }
}

export async function scheduleRecurringJob(
  queue: QueueName,
  schedulerId: string,
  jobName: string,
  everyMs: number,
  data: any = {},
): Promise<boolean> {
  const q = queues.get(queue);
  if (!active || !q) return false;
  try {
    await q.upsertJobScheduler(schedulerId, { every: Math.max(5000, everyMs) }, { name: jobName, data });
    return true;
  } catch (e: any) {
    logger.warn({ queue, schedulerId, err: e?.message }, '[Queues] failed to schedule recurring job');
    return false;
  }
}

export async function enqueueJob<T = any>(
  queue: QueueName,
  jobName: string,
  data: any,
  fallback?: () => Promise<T>,
  opts: { jobId?: string; delayMs?: number; attempts?: number } = {},
): Promise<{ queued: boolean; jobId?: string; result?: T }> {
  const q = queues.get(queue);
  if (active && q) {
    try {
      const job = await q.add(jobName, data, {
        ...(opts.jobId ? { jobId: opts.jobId } : {}),
        ...(opts.delayMs ? { delay: opts.delayMs } : {}),
        ...(opts.attempts ? { attempts: opts.attempts } : {}),
      });
      return { queued: true, jobId: String(job.id || '') };
    } catch (e: any) {
      logger.warn({ queue, jobName, err: e?.message }, '[Queues] enqueue failed; running fallback');
    }
  }
  if (fallback) {
    const result = await fallback();
    return { queued: false, result };
  }
  return { queued: false };
}

export async function getQueuesOverview(): Promise<{
  active: boolean;
  queues: Array<{ name: string; counts: Record<string, number>; schedulers: number }>;
}> {
  if (!active) return { active: false, queues: [] };
  const out: Array<{ name: string; counts: Record<string, number>; schedulers: number }> = [];
  for (const [name, q] of queues.entries()) {
    try {
      const [counts, schedulers] = await Promise.all([
        q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        q.getJobSchedulersCount().catch(() => 0),
      ]);
      out.push({ name, counts, schedulers });
    } catch {
      out.push({ name, counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, schedulers: 0 });
    }
  }
  return { active: true, queues: out };
}

export async function retryFailedJobs(queue: QueueName): Promise<{ ok: boolean; retried: number }> {
  const q = queues.get(queue);
  if (!active || !q) return { ok: false, retried: 0 };
  const failed = await q.getFailed(0, 100);
  let retried = 0;
  for (const job of failed) {
    try {
      await job.retry();
      retried += 1;
    } catch { /* ignore */ }
  }
  return { ok: true, retried };
}

export async function closeQueues(): Promise<void> {
  active = false;
  for (const w of workers.values()) {
    try { await w.close(); } catch { /* ignore */ }
  }
  for (const q of queues.values()) {
    try { await q.close(); } catch { /* ignore */ }
  }
  workers.clear();
  queues.clear();
}
