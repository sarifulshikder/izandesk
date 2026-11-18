# IzanDesk ERP — Next-Generation ISP Billing & Network Management

**IzanDesk** is an all-in-one, plug-and-play Enterprise Resource Planning (ERP) platform designed for Internet Service Providers (ISPs), Fiber-to-the-Home (FTTH) network operators, and Wireless ISPs (WISPs).

---

## 📚 Project Documentation Hub

All complete architectural blueprints, database schemas, and feature catalogs are available in the [`docs/`](./docs/) directory:

1. **[565+ Master Feature Catalog](./docs/izandesk_500_plus_feature_catalog.md)**  
   *Comprehensive matrix of 565 built-in, production-ready features across 18 telecom and business domains.*

2. **[Software Requirements Specification (SRS) & Architecture](./docs/izandesk_software_requirements_specification.md)**  
   *Carrier-grade FreeRADIUS 3 AAA, Dynamic CoA, TR-069 GenieACS, MikroTik RouterOS automation, OLT telemetry, and the Hot-Reload Plugin Kernel.*

3. **[Database Schema & Data Dictionary](./docs/izandesk_database_schema_and_models.md)**  
   *PostgreSQL 16 + PostGIS relational schema, double-entry general ledger, hardware inventory serials, and multi-tier reseller wallets.*

4. **[Phased Implementation Roadmap & Verification Plan](./docs/izandesk_phase_implementation_roadmap.md)**  
   *Detailed step-by-step 6-phase engineering milestones with browser verification criteria.*

5. **[ISP ERP Research & Benchmark Analysis](./docs/izandesk_isp_erp_research_and_architecture.md)**  
   *Deep-dive analysis of CIS Complete ISP Solution (`demo.cisbd.net`) vs. international market leaders (Splynx, Sonar).*

---

## ⚡ Core Architecture Highlights

- **Frontend:** Next.js 16 (App Router, React 19, Turbopack; `proxy.ts` network boundary) + Tailwind CSS 4 (CSS-first `@theme` config) + Shadcn UI + Lucide Icons ("Neo-Telecom" Dark/Light responsive design).
- **Backend API:** Express 5 (TypeScript) + Event-Driven Workers + Hot-Reload Plugin Kernel.
- **Database & Storage:** PostgreSQL 16 (with PostGIS 3.4 for fiber mapping) + Redis 7 & BullMQ.
- **Network Engine:** FreeRADIUS 3.2 (with Dynamic CoA / PoD) + MikroTik RouterOS REST/API + SNMP OLT Poller + TR-069 GenieACS.
- **Extensibility:** Hot-reloadable plugins in `/plugins/` (payment gateways, SMS providers, OLT vendor CLI profiles) loaded dynamically at runtime without server restarts.
- **Runtime/Toolchain:** Node.js 24 + pnpm 12 (monorepo workspaces).
- **Deployment:** 1-Click Plug-and-Play containerized with Docker and Docker Compose (`node:24-alpine` images).

---

## 🚀 Development Phases

- **Phase 1:** Project Scaffolding, "Neo-Telecom" UI/UX Design System, Auth & Hot-Reload Plugin Kernel *(Implemented)*
  - Monorepo scaffold: `apps/web`, `apps/api`, `packages/shared-types`, `plugins/`
  - Hot-reload plugin kernel (`chokidar` watcher, lifecycle hooks/event bus, plugin status API, reload endpoints)
  - Neo-Telecom UI: dark/light mode, responsive sidebar + mobile bottom nav, Cmd/Ctrl+K command palette
  - RBAC authentication shell: JWT login/session, protected app shell, role-based access context (Super Admin, NOC Engineer, Billing Operator, Technician, Reseller)
  - Executive dashboard with KPI/telemetry cards and live plugin kernel status
- **Phase 2:** Subscriber & Inventory Management (BSS Core) *(Implemented)*
  - PostgreSQL/PostGIS schema & initialization for areas/zones/distribution boxes, fiber routes, subscribers, KYC documents, warehouses/items/serials (seeded topology/inventory data)
  - Subscriber management: advanced **wizard** onboarding/edit (Basic, Connection & Package, Location & Topology, Review), real CRUD, auto client-code generation, PPPoE/connection profiles, status lifecycle, instant search/filter
  - Location intelligence: map pin picker (MapLibre, same free no-key hybrid basemap as the GIS workbench) with **satellite + street views** and layer switching, **"Pick my current location"** (browser geolocation), lat/lng capture, and **reverse-geocoding auto-fill** of address fields (district, thana/upazila, post office, village, area, ward no, road/street, house, full address) with manual edit support
  - KYC: document upload/list/storage per subscriber (NID/Passport/Contract/etc.) via API and UI
  - Topology management APIs: Areas, Zones, Distribution Boxes (TJ/Splitter), Fiber Routes and subscriber-to-topology linkage
  - GIS: PostGIS-backed GeoJSON overview, MapLibre GL interactive map with subscriber pins, distribution boxes, fiber routes, add-box placement, route drawing, and trace-to-subscriber residence flow
  - Inventory & serial tracking: warehouses, items, serial numbers (in stock/assigned/faulty/RMA/retired) with assignment to subscribers and stock summaries — including **automatic ONU import**: every subscriber-linked ONU from the OLT is auto-created as an `ONU_IMPORT` serial (ASSIGNED) + ONU equipment record (see [ONU → Inventory auto-import](./docs/onu_inventory_auto_import.md))
- **Phase 3:** Network OSS, MikroTik RouterOS API & OLT Telemetry *(Implemented)*
  - **Dual-mode router/NAS provisioning:** per-router **Integration Method** `API` (RouterOS API), `REST` (RouterOS v7 REST), or `RADIUS` (NAS for centralized AAA) with mode-specific fields (`/api/network/routers`, `/routers`). RADIUS-mode routers store **per-NAS shared secret** and **CoA port** (can differ per router). **UI:** Network & Routers has a sidebar drawer (overview + per-router links), an overview page, and **dedicated per-router 360° pages** (`/routers/[id]`) with identity/integration/connectivity details, telemetry/health, session stats, and live sessions.
  - **Subscriber network assignment & per-subscriber provisioning:** provision via **Specific Router (API/REST)** (direct per-router) or **RADIUS** (NAS pool) (`provisioning_mode`, `router_id`). For ROUTER-mode subscribers, IzanDesk **syncs/removes PPP secrets** on the assigned MikroTik (create/update/delete/move), applies package/profile and status (enabled/disabled), in addition to RADIUS SQL sync for AAA-mode users.
  - **Real MikroTik RouterOS (API/REST):** real connectivity/test, live identity/resource telemetry (CPU/RAM/uptime/board), active PPP session presence/uptime, and best-effort per-session traffic rates (interface monitor/traffic sampling) for direct API/REST routers (`/api/network/routers`, `/api/network/sessions`). Live throughput/session streaming via **SSE** (`/api/network/sessions/stream`) and **WebSocket** (`/api/network/sessions/ws?token=...`).
  - **Bandwidth & QoS packages:** CRUD with burst/priority/queue types and **real sync/provisioning to direct API/REST MikroTik routers** (PPP profile rate-limits + simple queue templates) (`/api/network/packages`, `/bandwidth`). Queue Tree/PCQ and deeper per-subscriber queue binding/lifecycle automation are available as template/profile-based provisioning (vendor/device behavior may vary).
  - **FreeRADIUS integrated in docker stack:** `freeradius` service (UDP 1812/1813) with PostgreSQL SQL backend (`radcheck`, `radreply`, `radgroupcheck`, `radgroupreply`, `radusergroup`, `radacct`, `radpostauth`, `nas`) managed in IzanDesk DB; config in `docker/radius/`, service in `docker/docker-compose.yml`. FR3-compatible SQL query structure and `authorize_*` column order (`attribute,value,op`) are configured for auth/acct/post-auth; `filter_username`/`suffix` are disabled to accept non-FQDN usernames (e.g. `user@site`).
  - **Real RADIUS/AAA & accounting:** subscriber sync writes real FreeRADIUS SQL records (`radcheck`/`radreply`/`radusergroup`) (`/api/radius/sync`, `/radius`); **RFC3576 CoA/PoD** sends real UDP packets to the target NAS using stored per-router secret & CoA port (`/api/radius/coa`). Accounting start/interim-update/stop is recorded to `radacct` and live RADIUS sessions are overlaid from `radacct` when accounting data is received. Live PPPoE/RADIUS auth (PAP/SQL, e.g. `Mikrotik-Group`) and `radacct` start/stop with session time, octets, IP and terminate cause have been validated in a real flow; `radpostauth` logging may vary by flow/config.
  - **NAS auto-sync:** RADIUS-mode routers are auto-synced to FreeRADIUS `nas` table on create/update/delete; bulk sync via `POST /api/network/routers/sync-radius-nas` (FreeRADIUS may require reload/restart to pick up SQL client changes depending on config). Observed NAS source IPs can be registered to accept real auth/acct traffic.
  - **WireGuard overlay for NAT/CGNAT sites (plug-and-play):** IzanDesk-managed hub-and-spoke tunnel (`wg-hub` container/service, configurable hub endpoint/UDP port and overlay CIDR, DB-driven hub/peer config) so MikroTik routers without public IPs can be reached/managed by IzanDesk (`/api/wireguard`, `/wireguard`). Peers are auto-provisioned to MikroTik (API/REST when reachable) or via RouterOS v7 bootstrap scripts (spoke dials out with keepalive), with per-peer allowed/tunnel routes and declared OLT management CIDRs to reach OLTs behind spoke routers.
  - **FTTH OLT manager:** OLT CRUD/test, ONU discovery, 1-click authorize & subscriber link, optical telemetry, and **automatic ONU↔subscriber recognition/linking** — name matching splits usernames into word tokens on separator *and* letter/digit boundaries (`Ac025Amina`→`amina`) with exact-match scoring + ONLINE preference + ambiguity guard, plus PPPoE session/caller MAC↔OLT FDB correlation via live SNMP (`dot1qTpFdbPort` lookups; verified against VSOL/BDCOM over WG) (`/api/olt/*`, `/olts`, `POST /api/olt/auto-link`) — **every linked/authorized ONU is auto-imported into inventory & serial tracking** (`POST /api/olt/sync-inventory`, `POST /api/olt/onus/:id/sync-inventory`; see [ONU → Inventory auto-import](./docs/onu_inventory_auto_import.md)) via an **SNMP-capable, tunnel-aware adapter** — `net-snmp-tools` ships in both the `api` and `wg-hub` containers, so real SNMP test/discovery/telemetry runs directly from the API container (dev adds WG routes) or via `docker exec` into `wg-hub` (tunnel path) when local access is unavailable; verified live against VSOL V1600D (`10.5.0.100`) and BDCOM P3310C (`10.5.0.101`) over WireGuard (IF-MIB ONU discovery + vendor OID enrichment); safe simulated fallback only when SNMP is truly unreachable. **UI:** FTTH & OLTs has a sidebar drawer (overview + per-OLT links), an overview page, and **dedicated per-OLT 360° pages** (`/olts/[id]`) with KPIs/health, identity/connectivity, PON breakdown, discovered/pending authorization, and full ONU telemetry/search. **Telemetry (best-effort):** Rx/Tx (dBm), distance, and DDM diagnostics (temperature, voltage, TX bias) with color-coded optical thresholds. Real vendor mappings (best-effort): **VSOL V1600D (EPON)** — IF-MIB ONU discovery with online/offline status, optical Rx/Tx, distance, DDM (temp/voltage/bias), and MAC enrichment; **BDCOM P3310C (EPON)** — IF-MIB `EPON0/x:y` discovery with online/offline status, ONU MAC, RX/TX optical, distance, description/name, last-down timestamp, and partial DDM enrichment (vendor/unit mapping may vary). (Not all fields/units are exposed on every vendor/firmware; explicit alarm/down-cause codes and CLI provisioning may require vendor-specific mapping.)
  - *Notes:* Real end-to-end behavior depends on device reachability/config (MikroTik API/REST services, NAS RADIUS/Accounting to IzanDesk, CoA, OLT SNMP/CLI access, and WireGuard UDP reachability/routing/firewall). Accounting-driven sessions/rates require NAS accounting packets; advanced OLT per-ONU fields/operations and 100% automatic ONU linking depend on vendor/model-specific mappings and unambiguous identifiers (e.g. learned FDB/session MAC or consistent ONU naming/serial metadata), and for NATed sites correct tunnel routes. FreeRADIUS SQL client changes may require container reload/restart. MikroTik PPP profile/rate-limit values must be valid for dynamic queue creation (e.g. burst-rate >= max-rate when bursting is configured) to avoid session termination on connect. Client-side PPP/LCP keepalive loss or weak optical signal (e.g. low ONU RX dBm) can drop established sessions independently of RADIUS/provisioning.
- **Phase 4:** Automated Billing, Due Policies & Payment Gateways *(Implemented, gap-hardened)*
  - **Automated invoicing engine:** batch monthly invoice generation with prorated mid-month calculations, invoice items/records, due recalculation, and billing metrics (`/api/billing/*`, `/billing`).
  - **Multi-stage due policy & enforcement:** pre-expiry warning, grace countdown, overdue suspension/isolation and walled-garden stage with DB-locked periodic evaluation, suspension logs, and manual evaluate/suspend/reactivate controls.
  - **Restricted access / walled garden:** MikroTik restricted PPP profile provisioning, RADIUS reply attributes and RFC3576 CoA/PoD (CoA with fallback) for immediate enforcement. *(Full captive redirect to portal requires NAS/router address-list/firewall/DNS/NAT rules; provisioning helper/endpoint available for API/REST-managed routers.)*
  - **Hot-reloadable payment gateway plugins:** bKash (tokenized checkout + personal MFS SMS listener hook), Nagad merchant PGW, Rocket, Stripe (Elements/cards/Apple/Google Pay), and PayPal Smart Buttons (`plugins/payment-*`), with runtime gateway config/credentials managed in DB via Plugins/Billing APIs and UI (`/plugins`, `/plugins/payment-gateways/*`).
  - **Payments, webhooks & MFS ingest:** checkout/confirm/webhook flows with idempotent processing. Webhooks fail closed — a webhook secret must be configured and the event must either be verified by a payment plugin or bind to an existing PENDING payment with an amount not exceeding it; unsigned/anonymous hooks are rejected. MFS SMS ingestion (`/api/billing/payments/sms/ingest`) requires a verified JWT or `MFS_SMS_INGEST_TOKEN`. `/api/billing` is staff-only (`SUPER_ADMIN`, `BILLING_OPERATOR`, read access for `NOC_ENGINEER`); resellers use the partner-scoped APIs. Public invoice PDF/HTML links use a signed expiring token (`INVOICE_SHARE_SECRET`, falls back to `JWT_SECRET`).
  - **Instant auto-reactivation:** confirmed/cleared payments restore access by updating dues/state and re-enabling/provisioning PPP/RADIUS/CoA (target < 2s).
  - *Notes:* End-to-end validation of live enforcement, NAS captive redirect, and real/signed gateway or MFS-forwarder flows depends on device/network configuration and provider credentials/webhook secrets/callback setup.
- **Phase 5:** Reseller Multi-Tier System, CRM & Omnichannel Messaging *(Implemented foundation)*
  - **Resellers & wallet:** multi-tier reseller records with parent-child support, white-label/branding fields (subdomain/custom domain, brand, colors/logo/title), prepaid wallet balance, recharge, buying margin/commission fields, and reseller-to-subscriber linkage (`/api/resellers`, `/resellers`).
  - **Wallet auto-deduction & renewals:** reseller can renew subscribers using wallet credit with wholesale margin calculation, wallet debit transaction logging, and payment/renewal recording (`/api/resellers/:id/renew-subscriber`, `/api/resellers/:id/wallet`).
  - **SLA-driven trouble ticketing (CRM):** ticket CRUD with priority-based SLA due times/breach indicators, technician assignment/dispatch, comments/activity, subscriber/site context, and GPS navigation links with mobile-friendly resolution workflow (`/api/tickets`, `/tickets`).
  - **Omnichannel messaging engine:** channel/config/template/log models and APIs for Local BD SMS (GreenWeb), Twilio SMS, WhatsApp Business API (invoice delivery/PDF link support hooks), and Telegram Bot (NOC alerts/daily revenue summary hooks), plus built-in **Gateway Tester** for test dispatch (`/api/messaging`, `/messaging`).
  - *Notes:* Live external delivery requires provider credentials/tokens and API-specific integration setup (Twilio/GreenWeb/Meta WhatsApp Cloud/Telegram). White-label subdomain/custom-domain routing requires DNS and reverse-proxy host mapping in deployment.
- **Phase 6:** Customer Self-Care Portal & 1-Click Plug-and-Play Packaging *(Implemented foundation)*
- **Phase 7:** Settings & Security module *(Implemented)*
  - Schema-driven settings store (`settings` table, key=`<category>.<field>` JSONB) with categories **General** (company profile, timezone/currency/date format/language, invoice prefix + sequence), **Security**, **Notifications**, **Branding**, **Billing**, **Network**, **ACS**, **AI Copilot**; seeded defaults, per-category reset, secrets masked on read (`••••••••`, blank = keep on write)
  - APIs: `GET /api/settings` (+`/schema`, `/:category`), `PUT /api/settings/:category` (SUPER_ADMIN, validated + coerced + audited), `POST /api/settings/reset/:category`, `POST /api/settings/test-smtp` (live SMTP EHLO test), `GET /api/settings/audit/recent` (`/api/settings`, `/settings`)
  - **Live enforcement from settings:** session timeout on issued JWTs (`security.session_timeout_minutes`), login lockout (`login_max_attempts`/`login_lockout_minutes` → 429 + audit), maintenance mode (non-SUPER_ADMIN API → 503 with message), password policy on `POST /api/auth/change-password` (bcrypt-hashed overrides persisted in `security.password_overrides`, re-applied at boot), invoice numbering uses `general.invoice_prefix`/`invoice_next_number`
  - **UI:** `/settings` — tabbed editor per category (auto-rendered from schema), save/reset per tab, SMTP test button, change-password card, maintenance banner, recent-changes audit feed

### AI Copilot (role-scoped, bilingual)
- **`/ai-assistant`** — an operations assistant that answers questions from live IzanDesk data in **Bangla or English** (the reply follows the question's language). It is **role-scoped**: a reseller only sees their own subscribers, wallet and tickets; technicians see tickets/optical/subscriber data; billing sees money; NOC sees network; super admins see everything. Denied topics return a clear restricted notice and the response `stats` blob is filtered too.
- **Free local engine by default.** A deterministic intent engine answers ~20 topics — collections, revenue, dues, subscriber stats, online PPPoE sessions, new connections, expiry, router/OLT health, tickets, leads, reseller wallets, hotspot vouchers, low stock, package rates, payment gateways, staff collections, KYC, GIS sites, customer lookups by name/ID/username/phone, named-subscriber ONU details (network roles: OLT, PON port, ONU id, serial, optical Rx, distance), and ready-to-copy SMS/WhatsApp templates. No key, no network call, no third-party data sharing. A named subscriber takes priority over topic keywords, so "isa's ONU info" resolves to that customer instead of the network-wide OLT table.
- **UI control (local, all roles):** asking the Copilot to **"turn dark theme on"**, **"switch to light mode"**, **"turn off dark mode"**, **"switch theme"** (or the Bengali equivalents) runs a local intent that returns an allowlisted `action: { type: 'set_theme', value }`. Both chat surfaces apply it through the same auth-context theme state as the top-bar toggle, so `izandesk_theme` and the `<html>` class stay in sync. These commands never reach an external provider; the "Switch theme" quick prompt is available to every role.
- **Scoped mutations (SUPER_ADMIN only):** commands return an allowlisted `action` that the web app executes through the normal API with the signed-in user's token, so validation, RBAC, provisioning and audit logs all apply. A follow-up chat message confirms the result (or the error).
  - **"create a subscriber with random credentials"** (or "add a new customer") generates a fresh PPPoE identity (`ai-<hex>` username, random 12-char secret, `PENDING` status, no user-supplied fields) and calls `POST /api/subscribers`.
  - **"suspend isa"** / **"activate IZN-MT-00045"** resolve a subscriber by client code, username, phone or name (exactly one match required) and call `PUT /api/subscribers/:id`.
  - **"top up cybernet wallet 500"** / **"recharge reseller X with 1000"** credit a partner wallet through `POST /api/resellers/:id/wallet/recharge` (AI-initiated amounts capped at ৳100,000).
  - **"create a ticket for isa about slow internet"** calls `POST /api/tickets`, optionally linked to a single matched subscriber; priority and subject are parsed from the command.
  - Resellers and other roles get the standard restricted notice, and questions ("how do I create a subscriber?", "what is my status?") stay informational. External providers never receive these commands or credentials.
- **Optional external AI:** super admins can add an **NVIDIA NIM**, **Google Gemini** (free tier) or **OpenAI** key on `/ai-settings` (sidebar → **AI Copilot → AI Copilot Settings**) and enable `ai.allow_external`. External providers are used only for free-form questions and receive **aggregate, role-filtered metrics only** — never subscriber PII, passwords or secrets. Both are off by default via `ai.provider=auto` / `ai.allow_external=false`.
  - **NVIDIA NIM** uses the OpenAI-compatible Chat Completions API: set `ai.nim_api_key` (`nvapi-…`), `ai.nim_base_url` (NVIDIA Cloud `https://integrate.api.nvidia.com/v1` by default, or a self-hosted NIM URL such as `http://nim-host:8000/v1`) and `ai.nim_model` (`nvidia/nemotron-3-ultra-550b-a55b` by default; any NIM chat model such as `meta/llama-3.3-70b-instruct` also works), then choose provider `nim`. The call is a short non-streaming request — reasoning tokens, when the model emits them, are discarded and only the final answer is shown. Keys are stored server-side, masked on read, and blank means "keep existing".
- **Navigation:** the sidebar has a dedicated **AI Copilot** group with **AI Copilot** (`/ai-assistant`) and, for super admins, **AI Copilot Settings** (`/ai-settings`). Resellers see the assistant but not the staff settings entry.
- **APIs:** `GET /api/ai/status` (engine, role, capabilities, prompts, limits), `POST /api/ai/chat` (`{message, history}` → `{reply, provider, intent, cards, quickPrompts, stats, meta}`), `GET/PUT /api/ai/settings` (SUPER_ADMIN, masked keys), `GET /api/ai/usage`. Per-user sliding-window rate limit (`ai.rate_limit_per_min`, default 30), 2,000-char messages, capped history. Every chat is audit-logged with intent/provider/latency but **never the raw message**.
- **UI:** chat bubbles with markdown tables/cards that deep-link into the relevant module, quick-prompt chips, new chat, copy, Markdown export, voice read-aloud (Web Speech API), and an engine/privacy panel. Markdown is rendered as React elements (no `dangerouslySetInnerHTML`), so model output cannot inject HTML.
- **Quick access:** a floating **AI bubble** is mounted in the app shell, so the assistant is one click away on every page (it sits above the mobile bottom nav and hides itself on the full `/ai-assistant` page). The conversation stays in memory while you navigate; the panel has a maximize button to open the full workspace.

## ▶️ Local Run

### Docker dev (hot-reload)

```bash
# Start infra + app servers with hot-reload (Next.js HMR, API tsc watch + restart)
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up

# Or, if infra is already running, (re)start only app servers in dev mode
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up api web
```

- Uses `docker/docker-compose.dev.yml` to override `web`/`api` commands for development.
- Source is bind-mounted; if file-change events aren’t detected in your environment, set polling is enabled by default for web, or run `web`/`api` locally and keep infra in Docker.

```bash
# 1) Install deps
pnpm install

# 2) Start infra (Postgres/PostGIS, Redis, Caddy, FreeRADIUS, WireGuard hub)
docker compose -f docker/docker-compose.yml up -d
# includes: izandesk-postgres, izandesk-redis, izandesk-caddy, izandesk-freeradius (UDP 1812/1813), izandesk-wg-hub (UDP 51820)

# 3) Build shared types
pnpm --filter @izandesk/shared-types build

# 4) Start API (hot-reload plugin kernel, auth, BSS/OSS, network/RADIUS/WireGuard integrations)
pnpm --filter api build
pnpm --filter api start   # http://localhost:4000

# 5) Start Web
pnpm --filter web dev     # http://localhost:3000
```

### Environment configuration (no hardcoded deployment hosts)

- **Web:** copy `apps/web/.env.example` to `apps/web/.env.local`
  - `NEXT_PUBLIC_API_URL=` (empty = same-origin `/api` proxy, recommended)
  - `INTERNAL_API_URL=http://localhost:4000` (Next.js rewrite target)
  - `ALLOWED_DEV_ORIGINS=` comma-separated hosts/IPs/domains for remote dev access (e.g. public NAT IP)
  - GIS permissions: all admin/ops roles (SUPER_ADMIN, NOC_ENGINEER, BILLING_OPERATOR, TECHNICIAN) can view the map and the topology audit/trash views; only SUPER_ADMIN and NOC_ENGINEER can create, edit, delete, import or restore topology. Read-only users see a "Read-only" badge and no mutation controls.
  - GIS map: the workbench is a single **MapLibre GL** map driven by one local style, `apps/web/public/gis-basemap.json`, that carries both basemaps — Esri World Imagery (the default) and the full **OpenFreeMap** OSM vector style. Because both basemaps share the same vector label layers, satellite labels use the exact same road/area/river/place names, density and typography as the Streets view (free, no API key); the "Labels" button toggles them and the choice is remembered per browser. `NEXT_PUBLIC_GIS_BASEMAP_STYLE_URL` overrides the style file; `NEXT_PUBLIC_GIS_SATELLITE_TILE_URL` and `NEXT_PUBLIC_GIS_VECTOR_TILE_URL` override the imagery and vector tile sources inside it for internal/offline deployments. The Streets/Satellite choice is also remembered per browser. `NEXT_PUBLIC_GIS_CENTER="lat,lng"` overrides the initial map centre (default `23.8103,90.4125`). See `apps/web/.env.example`. The map loads pins for the current viewport (pan/zoom to load another area) with a configurable per-request cap of 5,000 (up to 50,000); a warning appears when the cap truncates results. `GIS_GEOCODE_URL` (API) overrides the Nominatim address-to-coordinates provider; see `apps/api/.env.example`.
- **API:** see `apps/api/.env.example`
  - `API_PORT`, `JWT_SECRET`, `WEB_ORIGIN`, `ALLOW_LAN_ORIGINS`
- **Caddy/HTTPS (optional):** see `docker/.env.example` and `docker/Caddyfile`
  - `CADDY_SITE_ADDRESS` — domain for automatic HTTPS (e.g. `izandesk.example.com`) or `:80` for HTTP
  - `CADDY_UPSTREAM` — defaults to `http://localhost:3000` (Caddy uses host networking in compose)
  - `CADDY_ACME_EMAIL` — recommended for public TLS certificates
- **Remote/NAT:** with same-origin proxy, browsers only need the web port (`3000`, or `80/443` via reverse proxy). Do not expose Postgres/Redis ports publicly. Automatic Let's Encrypt HTTPS requires a public domain pointing to your server with ports 80/443 forwarded; for public-IP-only access use HTTP (`:80`) or configure custom TLS.
- **RADIUS (FreeRADIUS):** `docker-compose` exposes UDP `1812/1813` for auth/acct — restrict by firewall to trusted NAS IPs. RADIUS-mode routers in IzanDesk are auto-synced to FreeRADIUS `nas` clients; CoA/PoD is sent to the NAS using the per-router shared secret and CoA port (allow inbound CoA/UDP, e.g. 3799, from the IzanDesk server to the NAS). If SQL NAS/client changes aren’t picked up, reload/restart `izandesk-freeradius`.
- **WireGuard overlay (optional):** `izandesk-wg-hub` exposes UDP `51820` (configurable) for spoke routers behind NAT/CGNAT to dial out; set the hub public endpoint/port in `/wireguard`, allow/forward the UDP port, and apply per-peer bootstrap/provisioning. Declare OLT management CIDRs per peer and ensure tunnel↔LAN routing/firewall on spokes for OLT reachability. Hub/peer private keys and preshared keys are never returned by list/detail APIs (only presence flags); bootstrap scripts embed a peer private key by design and are restricted to `SUPER_ADMIN`/`NOC_ENGINEER`.
- **Network/OSS credential boundary:** routers, OLTs, RADIUS, WireGuard and ACS are staff-only (`SUPER_ADMIN`, `NOC_ENGINEER`, `BILLING_OPERATOR`, `TECHNICIAN`); only `SUPER_ADMIN`/`NOC_ENGINEER` may mutate them. Device passwords, RADIUS shared secrets, MikroTik PPP secrets and raw `wg show` dumps are stripped from API responses. Router management TLS currently accepts self-signed certificates (`rejectUnauthorized: false`) — verify/terminate TLS at the network layer for production. `GET /api/network/sessions` is an operational dashboard read that also refreshes the session cache and best-effort ONU↔subscriber links; it is not a pure read.

**Demo RBAC accounts:** `admin@izandesk.com/admin123`, `noc@izandesk.com/noc123`, `billing@izandesk.com/billing123`, `tech@izandesk.com/tech123`, `reseller@cybernet.bd/reseller123`. These accounts have well-known passwords — set `DISABLE_DEMO_ACCOUNTS=true` for any real deployment (there is no database-backed user store yet, so configure a real identity source before doing so). Customer-portal sessions are invalidated when the subscriber changes their password, and portal login is rate-limited. Subscriber KYC uploads are limited to 5 MB of PNG/JPEG/WebP/GIF/PDF. Subscriber portal credentials are stored as a separate bcrypt hash (`portal_password`) from the cleartext PPPoE/RADIUS secret (`password`); the migration backfills legacy hashes and never returns either field in subscriber API responses.

### HTTPS with Caddy (optional)

```bash
# Configure (optional)
cp docker/.env.example docker/.env
# edit docker/.env: set CADDY_SITE_ADDRESS=your-domain.example.com for automatic HTTPS

# Start Caddy (reverse proxy to web :3000)
docker compose -f docker/docker-compose.yml up -d caddy
```

- Caddy proxies to the IzanDesk web app; web already proxies `/api` to the API internally.
- For automatic HTTPS, ensure DNS for `CADDY_SITE_ADDRESS` resolves to your public IP and ports **80/443** are forwarded to this server.
- For LAN/IP-only or testing, set `CADDY_SITE_ADDRESS=:80`.
