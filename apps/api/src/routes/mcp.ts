/**
 * Streamable HTTP transport for the IzanDesk MCP server.
 *
 * One JSON-RPC endpoint (POST /api/mcp). Accepts both modern stateless
 * requests and legacy initialize-based clients. Always replies with a single
 * JSON object; clients that advertise text/event-stream still accept that.
 */
import { randomBytes } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { getAllSettings, getCached, invalidateCache } from '../integrations/settings';
import { auditLog } from '../integrations/audit';
import { handleMcpRpc, validateModernRequest, MCP_TOOLS, type McpContext, MCP_SERVER_VERSION } from '../integrations/mcp';
import { hashMcpSecret, type McpKeyRecord } from '../integrations/mcp-auth';
import { stepUpSatisfied } from '../security/step-up';

// In-process sliding-window limiter, keyed by actor + credential. Protects
// against runaway agents without punishing other users behind the same NAT.
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimited(key: string, limit: number): { blocked: boolean; retryAfter: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.reset) { b = { count: 0, reset: now + 60_000 }; buckets.set(key, b); }
  if (b.count >= limit) return { blocked: true, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
  b.count += 1;
  if (buckets.size > 2000) for (const [k, v] of buckets) if (now >= v.reset) buckets.delete(k);
  return { blocked: false, retryAfter: 0 };
}

function originAllowed(req: Request, allowed: string[]): boolean {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true; // desktop / CLI clients send no Origin
  if (!allowed.length) return true; // self-hosted default, matches current CORS posture
  return allowed.some((o) => o === origin || o === '*');
}

function contextFor(req: Request, pool: any): McpContext {
  const user = (req as any).user || {};
  const auth = (req as any).mcpAuth || {};
  const meta = (req.body?.params?._meta || {}) as any;
  return {
    pool,
    actor: {
      id: String(user.id || user.sub || 'unknown'),
      name: String(user.name || user.email || user.id || 'unknown'),
      role: String(user.role || ''),
      resellerId: user.resellerId || null,
    },
    actorSource: auth.source === 'api_key' ? 'api_key' : 'jwt',
    keyId: auth.keyId,
    keyName: auth.keyName,
    readOnly: !!auth.readOnly,
    allowedTools: auth.allowedTools || null,
    executor: {
      apiBaseUrl: process.env.MCP_API_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || 4000}`,
      jwtSecret: process.env.JWT_SECRET || 'izandesk-dev-secret-change-me',
    },
    ip: req.ip || String(req.headers['x-forwarded-for'] || '') || null,
    clientInfo: meta['io.modelcontextprotocol/clientInfo'] || null,
    protocolVersion: meta['io.modelcontextprotocol/protocolVersion'] || String(req.headers['mcp-protocol-version'] || '') || undefined,
  };
}

export function createMcpRouter(pool: any): Router {
  const router = Router();
  const KEY_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER', 'BILLING_OPERATOR', 'TECHNICIAN', 'RESELLER'];
  const toolNames = new Set(MCP_TOOLS.map((t) => t.name));

  async function readKeys(): Promise<Record<string, McpKeyRecord>> {
    const all = await getAllSettings();
    const raw = all['mcp.api_keys'];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  async function writeKeys(keys: Record<string, McpKeyRecord>, actorName: string) {
    await pool.query(
      `INSERT INTO settings(key, category, value, updated_by) VALUES('mcp.api_keys','mcp',$1::jsonb,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [JSON.stringify(keys), actorName],
    );
    invalidateCache();
  }

  function adminSession(req: Request, res: Response): any | null {
    if ((req as any).mcpAuth?.source === 'api_key') {
      res.status(403).json({ message: 'Use an interactive admin session to manage MCP keys' });
      return null;
    }
    const user = (req as any).user || {};
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ message: 'MCP key management requires SUPER_ADMIN' });
      return null;
    }
    return user;
  }

  function publicKey(keyId: string, key: McpKeyRecord) {
    return {
      key_id: keyId,
      name: key.name || keyId,
      role: key.role,
      user_id: key.user_id || null,
      read_only: !!key.read_only,
      allowed_tools: key.allowed_tools || null,
      created_at: key.created_at || null,
      last_used_at: key.last_used_at || null,
      revoked: !!key.revoked,
    };
  }

  // ── Dedicated MCP key management (interactive admin JWT only) ─────────────
  // Tool catalog for the admin key form. Kept separate from tools/list so the
  // configuration UI does not need an MCP client handshake.
  router.get('/tools', async (req: Request, res: Response) => {
    if (!adminSession(req, res)) return;
    res.json({
      data: MCP_TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        category: t.category,
        read_only: t.annotations?.readOnlyHint !== false,
        destructive: t.annotations?.destructiveHint === true,
      })),
    });
  });

  router.get('/keys', async (req: Request, res: Response) => {
    if (!adminSession(req, res)) return;
    const keys = await readKeys();
    res.json({ data: Object.entries(keys).map(([id, key]) => publicKey(id, key)) });
  });

  router.post('/keys', async (req: Request, res: Response) => {
    const admin = adminSession(req, res);
    if (!admin) return;
    if (!await stepUpSatisfied(req, admin)) {
      await auditLog({ actor_id: admin.id, actor_role: admin.role, action: 'auth.step_up_required', entity_type: 'mcp', ip_address: req.ip || null });
      return res.status(403).json({ message: 'MFA step-up required to create MCP keys', step_up_required: true });
    }
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const role = String(b.role || 'SUPER_ADMIN');
    if (!name || name.length > 120) return res.status(400).json({ message: 'name is required (max 120 chars)' });
    if (!KEY_ROLES.includes(role)) return res.status(400).json({ message: `role must be one of: ${KEY_ROLES.join(', ')}` });

    let allowedTools: string[] | null = null;
    if (b.allowed_tools !== undefined && b.allowed_tools !== null && b.allowed_tools !== '') {
      if (!Array.isArray(b.allowed_tools)) return res.status(400).json({ message: 'allowed_tools must be an array of tool names' });
      allowedTools = b.allowed_tools.map((t: any) => String(t).trim());
      const unknown = allowedTools.filter((t) => t !== '*' && !toolNames.has(t));
      if (unknown.length) return res.status(400).json({ message: `Unknown tool(s): ${unknown.join(', ')}` });
    }

    const keys = await readKeys();
    const keyId = `izmc_${randomBytes(6).toString('hex')}`;
    const secret = `izsk_${randomBytes(24).toString('base64url')}`;
    keys[keyId] = {
      name,
      role,
      user_id: b.user_id ? String(b.user_id) : undefined,
      secret_hash: hashMcpSecret(secret),
      read_only: b.read_only === true || b.read_only === 'true',
      allowed_tools: allowedTools,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked: false,
    } satisfies McpKeyRecord;
    await writeKeys(keys, admin.name || admin.id);
    await auditLog({
      actor_id: admin.id, actor_name: admin.name, actor_role: admin.role,
      action: 'MCP_KEY_CREATED', entity_type: 'mcp', entity_id: keyId,
      details: { name, role, read_only: keys[keyId].read_only, allowed_tools: allowedTools },
      ip_address: req.ip || null,
    });
    res.status(201).json({
      key_id: keyId,
      secret,
      note: 'Store this secret now. It is never shown again.',
      ...publicKey(keyId, keys[keyId]),
    });
  });

  router.delete('/keys/:keyId', async (req: Request, res: Response) => {
    const admin = adminSession(req, res);
    if (!admin) return;
    if (!await stepUpSatisfied(req, admin)) {
      await auditLog({ actor_id: admin.id, actor_role: admin.role, action: 'auth.step_up_required', entity_type: 'mcp', entity_id: req.params.keyId, ip_address: req.ip || null });
      return res.status(403).json({ message: 'MFA step-up required to revoke MCP keys', step_up_required: true });
    }
    const keyId = String(req.params.keyId);
    const keys = await readKeys();
    const key = keys[keyId];
    if (!key) return res.status(404).json({ message: 'MCP key not found' });
    keys[keyId] = { ...key, revoked: true };
    await writeKeys(keys, admin.name || admin.id);
    await auditLog({
      actor_id: admin.id, actor_name: admin.name, actor_role: admin.role,
      action: 'MCP_KEY_REVOKED', entity_type: 'mcp', entity_id: keyId,
      details: { name: key.name || null }, ip_address: req.ip || null,
    });
    res.json({ ok: true });
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const enabled = await getCached('mcp.enabled', true);
      if (!enabled) {
        return res.status(503).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'MCP server is disabled by the administrator' },
        });
      }

      const configuredOrigins = String(await getCached('mcp.allowed_origins', '') || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      const allowedOrigins = configuredOrigins.length
        ? configuredOrigins
        : [
            ...String(process.env.WEB_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
            'http://localhost:3000',
            'http://127.0.0.1:3000',
          ];
      if (!originAllowed(req, allowedOrigins)) {
        await auditLog({
          actor_id: (req as any).user?.id, actor_role: (req as any).user?.role,
          action: 'MCP_ORIGIN_BLOCKED', entity_type: 'mcp', ip_address: req.ip || null,
          details: { origin: req.headers.origin || null },
        });
        return res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' } });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid JSON-RPC request' } });
      }

      const validation = validateModernRequest(req.body, req.headers as Record<string, any>);
      if (validation) {
        res.status(validation.status);
        return res.json(validation.body);
      }

      const ctx = contextFor(req, pool);
      const limit = Number(await getCached('mcp.rate_limit_per_min', 90)) || 90;
      const gate = rateLimited(`${ctx.actor.id}:${ctx.keyId || 'jwt'}`, limit);
      if (gate.blocked) {
        res.setHeader('Retry-After', String(gate.retryAfter));
        return res.status(429).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'MCP rate limit reached', retry_after_sec: gate.retryAfter },
        });
      }

      const response = await handleMcpRpc(req.body, ctx);
      res.status(response.status);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-IzanDesk-MCP', MCP_SERVER_VERSION);
      if (response.body === undefined) return res.end();
      return res.json(response.body);
    } catch (e: any) {
      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: e?.message || 'MCP internal error' },
      });
    }
  });

  // The 2026-07-28 revision removed the GET stream and protocol-level sessions.
  // 405 is also what older clients expect when a server offers no SSE stream.
  router.get('/', (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Use POST for MCP JSON-RPC requests' } });
  });

  router.delete('/', (_req: Request, res: Response) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32600, message: 'This MCP server is stateless; no session to terminate' } });
  });

  return router;
}
