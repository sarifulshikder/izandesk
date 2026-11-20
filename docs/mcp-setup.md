# IzanDesk MCP Server

IzanDesk exposes its AI Copilot capabilities as a **Model Context Protocol (MCP)** server over Streamable HTTP. An AI assistant can inspect live ISP operations, then perform allowlisted actions through IzanDesk's own REST handlers — with the same RBAC, reseller scoping, validation, provisioning and audit trail as the web UI.

Endpoint:

```text
http://localhost:4000/api/mcp
```

Production example:

```text
https://api.your-isp.example/api/mcp
```

---

## What is exposed

MCP tools are filtered by the connected account's role. A read-only key never sees a mutating tool.

| Category | Example tools |
| --- | --- |
| Discovery | `search_izandesk_tools`, `get_izandesk_tool_schema`, `izandesk_overview` |
| Finance | `izandesk_collections_today`, `izandesk_revenue_month`, `izandesk_dues`, `izandesk_payment_gateways`, `izandesk_staff_collections` |
| Subscribers | `izandesk_subscriber_stats`, `izandesk_customer_lookup`, `izandesk_new_connections`, `izandesk_expiring_subscribers`, `izandesk_packages` |
| Network | `izandesk_online_users`, `izandesk_router_health`, `izandesk_olt_health`, `izandesk_subscriber_live`, `izandesk_subscriber_onu`, `izandesk_hotspot_vouchers`, `izandesk_gis_sites` |
| Support / CRM | `izandesk_tickets`, `izandesk_leads`, `izandesk_kyc_queue`, `izandesk_reseller_wallets`, `izandesk_inventory` |
| Actions | `izandesk_create_subscriber`, `izandesk_set_subscriber_status`, `izandesk_record_payment`, `izandesk_assign_package`, `izandesk_create_ticket`, `izandesk_close_ticket`, `izandesk_approve_kyc`, `izandesk_reject_kyc`, `izandesk_topup_reseller_wallet` |

Tools also advertise `readOnlyHint` and `destructiveHint`. Query tools call the existing role-scoped AI engine in forced-local mode — no external LLM is contacted. Action tools require `confirm: true` and call IzanDesk's own REST API with a short-lived, scoped JWT for the resolved actor.

The server also exposes:

- `izandesk://capabilities` — what the connected account may access
- `izandesk://tools` — visible tool catalog
- `izandesk://audit/recent` — recent MCP calls (billing/super-admin only)
- Prompts: `collections_review`, `noc_handover`, `subscriber_onboarding`, `billing_close`

---

## Authentication

### Option A — use your normal web login JWT

For quick testing, log in at `POST /api/auth/login` and pass the returned token as a bearer token.

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@izandesk.com","password":"admin123"}' | jq -r .token)

curl -s http://localhost:4000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"tools/list",
    "params":{
      "_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0"},
        "io.modelcontextprotocol/clientCapabilities":{}
      }
    }
  }'
```

### Option B — create a dedicated MCP API key (recommended)

Keys are revocable, carry their own role, and can be read-only and/or limited to specific tools. The secret is hashed at rest and shown only once.

Create one with a super-admin JWT:

```bash
curl -s -X POST http://localhost:4000/api/mcp/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Claude Desktop — read only",
    "role":"SUPER_ADMIN",
    "read_only":true,
    "allowed_tools":[
      "izandesk_overview",
      "izandesk_collections_today",
      "izandesk_dues",
      "izandesk_router_health"
    ]
  }'
```

Response:

```json
{
  "key_id": "izmc_0123456789abcdef",
  "secret": "izsk_...",
  "note": "Store this secret now. It is never shown again."
}
```

Use it with HTTP Basic auth:

```bash
curl -s http://localhost:4000/api/mcp \
  -u 'izmc_0123456789abcdef:izsk_...' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Clients that cannot send Basic auth can use `Authorization: Bearer izmc_0123456789abcdef.izsk_...`.

Other key endpoints:

```text
GET    /api/mcp/keys              list key metadata (never returns secrets)
DELETE /api/mcp/keys/:key_id      revoke a key
```

Key management requires an interactive super-admin JWT; an MCP API key cannot mint more keys.

---

## Client configuration

### Claude Desktop / Claude Code / Cursor

Use a Streamable HTTP MCP server pointing at the endpoint, with the API key in the authorization header. Exact field names vary by client version; the important values are:

```json
{
  "mcpServers": {
    "izandesk": {
      "url": "http://localhost:4000/api/mcp",
      "headers": {
        "Authorization": "Bearer izmc_0123456789abcdef.izsk_..."
      }
    }
  }
}
```

Older clients that send an `initialize` handshake are supported. The server also supports the stateless `2026-07-28` revision using `server/discover`, per-request `_meta`, and mirrored `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers.

### Browser-based clients

Set **Admin → Settings → MCP Server → Allowed browser origins** to the client origin, for example `https://chatgpt.com`. Requests with a disallowed `Origin` are rejected with HTTP 403 and audited as `MCP_ORIGIN_BLOCKED`. Desktop and CLI clients send no `Origin` and are allowed.

---

## Calling a tool

Every mutating tool uses a two-step confirmation flow. The first call returns `requires_confirmation` with the arguments echoed back. The assistant must show these to the user, then retry with `confirm: true`.

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "izandesk_set_subscriber_status",
    "arguments": {
      "identifier": "IZN-2401-0031",
      "status": "SUSPENDED"
    }
  }
}
```

After user approval:

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "izandesk_set_subscriber_status",
    "arguments": {
      "identifier": "IZN-2401-0031",
      "status": "SUSPENDED",
      "confirm": true
    }
  }
}
```

Identifiers must resolve to exactly one subscriber, reseller or ticket. Ambiguous matches are rejected instead of guessed.

---

## Settings

Managed under **Admin → Settings → MCP Server**:

| Setting | Default | Purpose |
| --- | --- | --- |
| `mcp.enabled` | `true` | Master switch; disabled returns HTTP 503 |
| `mcp.rate_limit_per_min` | `90` | Per-actor, per-credential sliding window |
| `mcp.allowed_origins` | local web app | Additional browser origins allowed to connect |

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `MCP_API_BASE_URL` | Loopback base URL used by the action executor; defaults to `http://127.0.0.1:${API_PORT}` |
| `API_PORT` | API listen port; defaults to `4000` |
| `JWT_SECRET` | Signs the short-lived JWT used when MCP re-enters the REST API |

---

## Security model

1. **No new permission system.** Roles come from the existing user table and AI Copilot intent gates.
2. **Least privilege discovery.** `tools/list` and `search_izandesk_tools` only return tools the caller may invoke.
3. **Read-only keys.** A read-only key cannot even discover mutating tools.
4. **Human confirmation.** Every write requires `confirm: true`; destructive tools are annotated accordingly.
5. **No duplicated write logic.** Mutations call IzanDesk's REST handlers, so validation, provisioning, duplicate-payment protection and reseller ownership checks all remain in one place.
6. **Audited.** Every tool call writes `MCP_TOOL_CALL` with outcome, duration, protocol version, client name and redacted arguments. Key lifecycle and init/origin events are audited too.
7. **Rate limited and origin checked.** Runaway agents are throttled; browser DNS-rebinding attempts are blocked.

Tool-call audit details redact fields named `password`, `secret`, `token`, `trx_id` and `note`.

---

## Protocol notes

- Single JSON-RPC endpoint; POST only. GET and DELETE return `405` because this server is stateless and offers no SSE stream.
- Notifications receive `202 Accepted` with no body.
- Supported versions: `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`.
- Modern requests must carry `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo` and `io.modelcontextprotocol/clientCapabilities` in `params._meta`, plus `MCP-Protocol-Version`, `Mcp-Method` and (where applicable) `Mcp-Name` headers that match the body. The `Accept` header must list both `application/json` and `text/event-stream`.
- Result objects include `resultType: "complete"` per the 2026-07-28 specification.
- Unknown methods return `-32601` with HTTP 404; unknown tools and invalid arguments are tool execution errors with `isError: true`.
