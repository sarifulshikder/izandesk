import type { Express, Request, Response } from 'express';

type ProbeDeps = {
  getDbReady: () => boolean;
  probeDbReady: () => Promise<boolean>;
  getKernel: () => { isReady: () => boolean; listPlugins: () => any[] };
  lite: boolean;
};

export function registerProbeRoutes(app: Express, deps: ProbeDeps) {
  app.get('/api/live', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service: 'izandesk-api', live: true });
  });

  app.get('/api/ready', async (_req: Request, res: Response) => {
    const liveDbReady = deps.getDbReady() && await deps.probeDbReady();
    const kernelReady = deps.getKernel().isReady();
    const ok = liveDbReady && kernelReady;
    res.status(ok ? 200 : 503).json({ ok, service: 'izandesk-api', ready: ok, dbReady: liveDbReady, kernelReady, pluginCount: deps.getKernel().listPlugins().length, lite: deps.lite });
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    const liveDbReady = deps.getDbReady() && await deps.probeDbReady();
    const kernelReady = deps.getKernel().isReady();
    const ok = liveDbReady && kernelReady;
    res.status(ok ? 200 : 503).json({ ok, service: 'izandesk-api', phase: 7, dbReady: liveDbReady, kernelReady, pluginCount: deps.getKernel().listPlugins().length, lite: deps.lite });
  });

  app.get('/api/metrics', async (_req: Request, res: Response) => {
    const liveDbReady = deps.getDbReady() && await deps.probeDbReady();
    const kernelReady = deps.getKernel().isReady();
    const mem = process.memoryUsage();
    const lines = [
      '# HELP izandesk_up Process liveness (1 = up).',
      '# TYPE izandesk_up gauge',
      'izandesk_up 1',
      '# HELP izandesk_ready Readiness status (1 = ready).',
      '# TYPE izandesk_ready gauge',
      `izandesk_ready ${liveDbReady && kernelReady ? 1 : 0}`,
      '# HELP izandesk_db_ready Database readiness (1 = ready).',
      '# TYPE izandesk_db_ready gauge',
      `izandesk_db_ready ${liveDbReady ? 1 : 0}`,
      '# HELP izandesk_kernel_ready Plugin kernel readiness (1 = ready).',
      '# TYPE izandesk_kernel_ready gauge',
      `izandesk_kernel_ready ${kernelReady ? 1 : 0}`,
      '# HELP izandesk_plugins_loaded Loaded plugin count.',
      '# TYPE izandesk_plugins_loaded gauge',
      `izandesk_plugins_loaded ${deps.getKernel().listPlugins().length}`,
      '# HELP process_uptime_seconds Process uptime in seconds.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${Math.floor(process.uptime())}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '# HELP nodejs_heap_used_bytes Node.js heap used bytes.',
      '# TYPE nodejs_heap_used_bytes gauge',
      `nodejs_heap_used_bytes ${mem.heapUsed}`,
    ];
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(lines.join('\n') + '\n');
  });
}
