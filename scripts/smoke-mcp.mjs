#!/usr/bin/env node
/**
 * End-to-end smoke test for the IzanDesk MCP endpoint.
 * Requires the web proxy and API to be running with demo auth enabled.
 */
const WEB = process.env.WEB_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:4000';
const MCP = `${API}/api/mcp`;

function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'izandesk-smoke', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error */ }
  return { status: res.status, json, text };
}

function rpc(method, params = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: { ...modernMeta } } };
}

function modernHeaders(body) {
  const headers = {
    'MCP-Protocol-Version': '2026-07-28',
    'Mcp-Method': body.method,
  };
  if (body.params?.name || body.params?.uri) headers['Mcp-Name'] = String(body.params.name || body.params.uri);
  return headers;
}

async function mcpCall(body, authHeader, extraHeaders = {}) {
  return post(MCP, body, {
    Authorization: authHeader,
    ...modernHeaders(body),
    ...extraHeaders,
  });
}

async function main() {
  const login = await post(`${WEB}/api/auth/login`, {
    email: process.env.DEMO_EMAIL || 'admin@izandesk.com',
    password: process.env.DEMO_PASSWORD || 'admin123',
  });
  assert(login.status === 200 && login.json?.token, `login failed: ${login.status} ${login.text.slice(0, 200)}`);
  const jwt = `Bearer ${login.json.token}`;
  let res;

  console.log('· modern metadata validation');
  const incomplete = rpc('tools/list');
  delete incomplete.params._meta['io.modelcontextprotocol/clientInfo'];
  res = await mcpCall(incomplete, jwt);
  assert(res.status === 400 && res.json?.error?.code === -32602, 'missing clientInfo was not rejected');

  console.log('· server/discover');
  let body = rpc('server/discover');
  res = await mcpCall(body, jwt);
  assert(res.status === 200 && res.json?.result?.capabilities?.tools, `discover failed: ${res.status} ${res.text.slice(0, 300)}`);
  assert(res.json.result.supportedVersions.includes('2026-07-28'), 'missing 2026-07-28 support');

  console.log('· tools/list');
  body = rpc('tools/list');
  res = await mcpCall(body, jwt);
  const tools = res.json?.result?.tools || [];
  assert(tools.length > 20, `expected a full tool catalog, got ${tools.length}`);
  assert(tools.every((t) => t.resultType !== 'input_required'), 'unexpected result type');

  console.log('· resources');
  body = rpc('resources/list', {}, 10);
  res = await mcpCall(body, jwt);
  const resources = res.json?.result?.resources || [];
  assert(resources.some((r) => r.uri === 'izandesk://capabilities'), 'missing capabilities resource');
  body = rpc('resources/read', { uri: 'izandesk://capabilities' }, 11);
  res = await mcpCall(body, jwt);
  assert(res.json?.result?.contents?.[0]?.text?.includes('SUPER_ADMIN'), 'resource read failed');

  console.log('· prompts');
  body = rpc('prompts/list', {}, 12);
  res = await mcpCall(body, jwt);
  const prompts = res.json?.result?.prompts || [];
  assert(prompts.some((p) => p.name === 'collections_review'), 'missing collections_review prompt');
  body = rpc('prompts/get', { name: 'collections_review' }, 13);
  res = await mcpCall(body, jwt);
  assert(res.json?.result?.messages?.[0]?.content?.text?.includes('collections'), 'prompt get failed');

  console.log('· initialize (legacy clients)');
  res = await post(MCP, {
    jsonrpc: '2.0', id: 2, method: 'initialize',
    params: { protocolVersion: '2025-11-25', clientInfo: { name: 'izandesk-smoke', version: '1.0' } },
  }, { Authorization: jwt });
  assert(res.json?.result?.serverInfo?.name === 'izandesk-mcp', 'legacy initialize failed');

  console.log('· query tool');
  body = rpc('tools/call', { name: 'izandesk_overview', arguments: {} }, 3);
  res = await mcpCall(body, jwt);
  assert(res.json?.result?.content?.[0]?.text?.includes('IzanDesk'), 'overview did not return live AI output');

  console.log('· confirmation gate');
  body = rpc('tools/call', {
    name: 'izandesk_set_subscriber_status',
    arguments: { identifier: '__smoke_test__', status: 'SUSPENDED' },
  }, 4);
  res = await mcpCall(body, jwt);
  assert(res.json?.result?.structuredContent?.requires_confirmation === true, 'mutation was not confirmation-gated');

  console.log('· read-only scoped API key');
  const keyRes = await post(`${API}/api/mcp/keys`, {
    name: 'smoke-read-only',
    role: 'SUPER_ADMIN',
    read_only: true,
    allowed_tools: ['izandesk_overview', 'izandesk_collections_today'],
  }, { Authorization: jwt });
  assert(keyRes.status === 201 && keyRes.json?.secret, `key creation failed: ${keyRes.status} ${keyRes.text.slice(0, 300)}`);
  const { key_id: keyId, secret } = keyRes.json;
  const basic = `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}`;

  try {
    body = rpc('tools/list');
    res = await mcpCall(body, basic);
    const scoped = res.json?.result?.tools || [];
    assert(scoped.length === 2, `read-only allowlist returned ${scoped.length} tools`);
    assert(scoped.every((t) => t.annotations?.readOnlyHint === true), 'read-only key saw a mutating tool');

    body = rpc('tools/call', { name: 'izandesk_subscriber_stats', arguments: {} }, 5);
    res = await mcpCall(body, basic);
    assert(res.json?.result?.isError === true, 'disallowed tool was not denied');
  } finally {
    const revoke = await fetch(`${API}/api/mcp/keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE', headers: { Authorization: jwt },
    });
    assert(revoke.status === 200, `key cleanup failed: ${revoke.status}`);
  }

  console.log('MCP smoke test passed.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
