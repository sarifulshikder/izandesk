/** Lightweight in-process Prometheus metrics for HTTP, network polls, streams and queues. */

const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Histogram = { counts: number[]; sum: number; count: number };

const httpTotals = new Map<string, number>();
const httpDurations = new Map<string, Histogram>();
const pollTotals = new Map<string, number>();
const pollDurationSums = new Map<string, { sum: number; count: number }>();

let wsClients = 0;
let sseClients = 0;

function escLabel(val: string): string {
  return String(val || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function recordHttpMetric(method: string, route: string, status: number, durationSec: number) {
  const statusClass = `${Math.floor(status / 100)}xx`;
  const m = String(method || 'GET').toUpperCase();
  const r = String(route || '/').slice(0, 120);
  const totalKey = `${m}|${r}|${statusClass}`;
  httpTotals.set(totalKey, (httpTotals.get(totalKey) || 0) + 1);

  const histKey = `${m}|${r}`;
  let h = httpDurations.get(histKey);
  if (!h) {
    h = { counts: new Array(DURATION_BUCKETS.length).fill(0), sum: 0, count: 0 };
    if (httpDurations.size > 500) httpDurations.clear();
    httpDurations.set(histKey, h);
  }
  for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
    if (durationSec <= DURATION_BUCKETS[i]) h.counts[i] += 1;
  }
  h.sum += durationSec;
  h.count += 1;
}

export function recordPollMetric(target: 'mikrotik' | 'olt' | 'radius', ok: boolean, durationMs: number) {
  const key = `${target}|${ok ? 'ok' : 'error'}`;
  pollTotals.set(key, (pollTotals.get(key) || 0) + 1);
  const cur = pollDurationSums.get(target) || { sum: 0, count: 0 };
  cur.sum += Math.max(0, durationMs) / 1000;
  cur.count += 1;
  pollDurationSums.set(target, cur);
}

export function adjustStreamClients(kind: 'ws' | 'sse', delta: number) {
  if (kind === 'ws') wsClients = Math.max(0, wsClients + delta);
  else sseClients = Math.max(0, sseClients + delta);
}

export function getStreamClientCounts() {
  return { wsClients, sseClients };
}

export function renderAppPrometheusLines(opts: {
  redisReady?: boolean | null;
  queues?: Array<{ name: string; counts: Record<string, number> }>;
} = {}): string[] {
  const lines: string[] = [
    '# HELP izandesk_active_stream_clients Active realtime streaming connections.',
    '# TYPE izandesk_active_stream_clients gauge',
    `izandesk_active_stream_clients{transport="ws"} ${wsClients}`,
    `izandesk_active_stream_clients{transport="sse"} ${sseClients}`,
  ];

  if (opts.redisReady !== undefined && opts.redisReady !== null) {
    lines.push('# HELP izandesk_redis_ready Redis connection readiness (1 = ready).');
    lines.push('# TYPE izandesk_redis_ready gauge');
    lines.push(`izandesk_redis_ready ${opts.redisReady ? 1 : 0}`);
  }

  if (httpTotals.size) {
    lines.push('# HELP izandesk_http_requests_total Total HTTP requests handled.');
    lines.push('# TYPE izandesk_http_requests_total counter');
    for (const [k, v] of httpTotals.entries()) {
      const [method, route, statusClass] = k.split('|');
      lines.push(`izandesk_http_requests_total{method="${escLabel(method)}",route="${escLabel(route)}",status_class="${escLabel(statusClass)}"} ${v}`);
    }
  }

  if (httpDurations.size) {
    lines.push('# HELP izandesk_http_request_duration_seconds HTTP request duration in seconds.');
    lines.push('# TYPE izandesk_http_request_duration_seconds histogram');
    for (const [k, h] of httpDurations.entries()) {
      const [method, route] = k.split('|');
      const labels = `method="${escLabel(method)}",route="${escLabel(route)}"`;
      for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
        lines.push(`izandesk_http_request_duration_seconds_bucket{${labels},le="${DURATION_BUCKETS[i]}"} ${h.counts[i]}`);
      }
      lines.push(`izandesk_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
      lines.push(`izandesk_http_request_duration_seconds_sum{${labels}} ${h.sum.toFixed(6)}`);
      lines.push(`izandesk_http_request_duration_seconds_count{${labels}} ${h.count}`);
    }
  }

  if (pollTotals.size) {
    lines.push('# HELP izandesk_network_polls_total Total device poll attempts by target and status.');
    lines.push('# TYPE izandesk_network_polls_total counter');
    for (const [k, v] of pollTotals.entries()) {
      const [target, status] = k.split('|');
      lines.push(`izandesk_network_polls_total{target="${escLabel(target)}",status="${escLabel(status)}"} ${v}`);
    }
    lines.push('# HELP izandesk_network_poll_duration_seconds_sum Cumulative seconds spent polling network devices.');
    lines.push('# TYPE izandesk_network_poll_duration_seconds_sum counter');
    for (const [target, s] of pollDurationSums.entries()) {
      lines.push(`izandesk_network_poll_duration_seconds_sum{target="${escLabel(target)}"} ${s.sum.toFixed(6)}`);
      lines.push(`izandesk_network_poll_duration_seconds_count{target="${escLabel(target)}"} ${s.count}`);
    }
  }

  if (opts.queues?.length) {
    lines.push('# HELP izandesk_queue_jobs BullMQ job counts by queue and state.');
    lines.push('# TYPE izandesk_queue_jobs gauge');
    for (const q of opts.queues) {
      for (const [state, count] of Object.entries(q.counts || {})) {
        lines.push(`izandesk_queue_jobs{queue="${escLabel(q.name)}",state="${escLabel(state)}"} ${Number(count || 0)}`);
      }
    }
  }

  return lines;
}
