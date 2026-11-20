import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, ValidationError } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';
import { getAllSettings, getCached, maskedView, setCategory } from '../integrations/settings';
import { askAI, capabilitiesFor, quickPromptsFor, testExternalProvider } from '../integrations/ai';

const router: Router = Router();

const AI_SETTING_KEYS = [
  'ai.enabled', 'ai.provider', 'ai.allow_external', 'ai.gemini_api_key',
  'ai.gemini_model', 'ai.openai_api_key', 'ai.openai_model',
  'ai.nim_api_key', 'ai.nim_base_url', 'ai.nim_model',
  'ai.rate_limit_per_min', 'ai.max_history',
];

function requireAdmin(req: any, res: any) {
  if (String(req.user?.role || '') !== 'SUPER_ADMIN') {
    res.status(403).json({ message: 'AI Copilot settings require SUPER_ADMIN' });
    return false;
  }
  return true;
}

// Small in-process sliding-window limiter. Per-user, not per-IP, so a shared
// office NAT does not throttle everyone. Cost control for external providers.
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(req: any, res: any, next: any) {
  (async () => {
    const limit = Number(await getCached('ai.rate_limit_per_min', 30)) || 30;
    const key = String(req.user?.id || 'anon');
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now >= b.reset) { b = { count: 0, reset: now + 60_000 }; buckets.set(key, b); }
    if (b.count >= limit) {
      res.status(429).json({ message: 'AI Copilot rate limit reached. Please wait a minute.', retry_after_sec: Math.max(1, Math.ceil((b.reset - now) / 1000)) });
      return;
    }
    b.count++;
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now >= v.reset) buckets.delete(k);
    return next();
  })().catch(next);
}

router.get('/status', asyncHandler(async (req, res) => {
  const role = String(req.user?.role || '');
  const enabled = await getCached('ai.enabled', true);
  const provider = String(await getCached('ai.provider', 'auto'));
  const externalAllowed = !!(await getCached('ai.allow_external', false));
  const labels: Record<string, string> = { gemini: 'Gemini', openai: 'OpenAI', nim: 'NVIDIA NIM' };
  const externalReady = ['gemini', 'openai', 'nim'].includes(provider)
    && externalAllowed
    && !!(await getCached(`ai.${provider}_api_key`, ''));
  res.json({
    ok: true,
    available: !!enabled,
    engine: !enabled ? 'disabled' : externalReady ? provider : 'local',
    active_mode: !enabled ? 'Disabled' : externalReady
      ? `${labels[provider]} + Built-in Engine`
      : 'Built-in Free Engine',
    role,
    capabilities: capabilitiesFor(role),
    quick_prompts: quickPromptsFor(role, 'bn'),
    limits: { per_minute: Number(await getCached('ai.rate_limit_per_min', 30)) || 30, message_chars: 2000, history_turns: Number(await getCached('ai.max_history', 20)) || 20 },
    privacy: externalReady
      ? `${labels[provider]} is enabled for free-form questions; only aggregate metrics and explicit action intents (e.g. "suspend <client code>") leave the app.`
      : 'Local-only: your questions and data never leave IzanDesk.',
  });
}));

router.post('/chat', rateLimit, asyncHandler(async (req, res) => {
  const enabled = await getCached('ai.enabled', true);
  if (!enabled) return res.status(503).json({ message: 'AI Copilot is disabled by the administrator' });
  const b = req.body || {};
  if (typeof b.message !== 'string' || !b.message.trim() || b.message.length > 2000) {
    throw new ValidationError('message must be 1–2000 characters');
  }
  const maxHistory = Number(await getCached('ai.max_history', 20)) || 20;
  const history = Array.isArray(b.history)
    ? b.history.slice(-maxHistory).map((h: any) => ({
        role: h?.role === 'user' ? 'user' : 'assistant',
        content: String(h?.content || '').slice(0, 4000),
      }))
    : [];
  const u = req.user as any;
  const actor = { id: u.id, name: u.name || u.email, role: u.role, resellerId: u.resellerId || null };
  const started = Date.now();
  const mode = (['local', 'llm'].includes(String(b.mode || '')) ? String(b.mode) : 'auto') as 'auto' | 'local' | 'llm';
  const result = await askAI(pool, actor, b.message.trim(), history, { mode });
  await auditLog({
    ...reqActor(req), action: 'AI_CHAT', entity_type: 'ai', entity_id: result.intent,
    details: { intent: result.intent, provider: result.provider, latency_ms: Date.now() - started, chars: b.message.length, mode },
  });
  res.json(result);
}));

router.post('/test-provider', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const b = req.body || {};
  const result = await testExternalProvider(String(b.provider || ''), b.api_key);
  res.json(result);
}));

router.get('/settings', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const all = maskedView(await getAllSettings());
  const values: Record<string, any> = {};
  for (const k of AI_SETTING_KEYS) values[k] = all[k];
  res.json({ ok: true, values });
}));

router.put('/settings', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body || {};
  const unknown = Object.keys(body).filter((k) => !AI_SETTING_KEYS.includes(k));
  if (unknown.length) throw new ValidationError(`Unknown setting(s): ${unknown.join(', ')}`);
  const values: Record<string, any> = {};
  // setCategory() expects bare field names ("nim_api_key"), not "ai.nim_api_key".
  for (const k of AI_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) values[k.slice(3)] = body[k];
  }
  const updated = await setCategory('ai', values, reqActor(req));
  const all = maskedView(await getAllSettings());
  const masked: Record<string, any> = {};
  for (const k of AI_SETTING_KEYS) masked[k] = all[k];
  res.json({ ok: true, updated: updated.updated, values: masked });
}));

router.get('/usage', asyncHandler(async (req, res) => {
  const u = req.user as any;
  const today = await pool.query(
    `SELECT COUNT(*)::int requests,
      COUNT(*) FILTER (WHERE details->>'provider' <> 'local')::int external_requests,
      COALESCE(AVG((details->>'latency_ms')::numeric),0)::numeric avg_latency_ms
      FROM audit_logs WHERE action='AI_CHAT' AND created_at >= CURRENT_DATE${u.role === 'SUPER_ADMIN' ? '' : ' AND actor_id=$1'}`,
    u.role === 'SUPER_ADMIN' ? [] : [u.id],
  );
  res.json({ ok: true, data: today.rows[0] || { requests: 0, external_requests: 0, avg_latency_ms: 0 } });
}));

export default router;
