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

- **Frontend:** Next.js 15 (App Router, React 19) + Tailwind CSS + Shadcn UI + Lucide Icons ("Neo-Telecom" Dark/Light responsive design).
- **Backend API:** NestJS (TypeScript) + Event-Driven Workers + Hot-Reload Plugin Kernel.
- **Database & Storage:** PostgreSQL 16 (with PostGIS 3.4 for fiber mapping) + Redis 7 & BullMQ.
- **Network Engine:** FreeRADIUS 3.2 (with Dynamic CoA / PoD) + MikroTik RouterOS REST/API + SNMP OLT Poller + TR-069 GenieACS.
- **Extensibility:** Hot-reloadable plugins in `/plugins/` (payment gateways, SMS providers, OLT vendor CLI profiles) loaded dynamically at runtime without server restarts.
- **Deployment:** 1-Click Plug-and-Play containerized with Docker and Docker Compose.

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
  - Location intelligence: map pin picker (Leaflet) with **satellite + label views** (free no-key options) and layer switching, **"Pick my current location"** (browser geolocation), lat/lng capture, and **reverse-geocoding auto-fill** of address fields (district, thana/upazila, post office, village, area, ward no, road/street, house, full address) with manual edit support
  - KYC: document upload/list/storage per subscriber (NID/Passport/Contract/etc.) via API and UI
  - Topology management APIs: Areas, Zones, Distribution Boxes (TJ/Splitter), Fiber Routes and subscriber-to-topology linkage
  - GIS: PostGIS-backed GeoJSON overview, Leaflet interactive map with subscriber pins, distribution boxes, fiber routes, add-box placement, route drawing, and trace-to-subscriber residence flow
  - Inventory & serial tracking: warehouses, items, serial numbers (in stock/assigned/faulty/RMA/retired) with assignment to subscribers and stock summaries
- **Phase 3:** Network OSS, MikroTik RouterOS API & OLT Telemetry *(Implemented)*
  - **Dual-mode router/NAS provisioning:** per-router **Integration Method** `API` (RouterOS API), `REST` (RouterOS v7 REST), or `RADIUS` (NAS for centralized AAA) with mode-specific fields (`/api/network/routers`, `/routers`). RADIUS-mode routers store **per-NAS shared secret** and **CoA port** (can differ per router).
  - **Subscriber network assignment & per-subscriber provisioning:** provision via **Specific Router (API/REST)** (direct per-router) or **RADIUS** (NAS pool) (`provisioning_mode`, `router_id`). For ROUTER-mode subscribers, IzanDesk **syncs/removes PPP secrets** on the assigned MikroTik (create/update/delete/move), applies package/profile and status (enabled/disabled), in addition to RADIUS SQL sync for AAA-mode users.
  - **Real MikroTik RouterOS (API/REST):** real connectivity/test, live identity/resource telemetry (CPU/RAM/uptime/board), active PPP session presence/uptime, and best-effort per-session traffic rates (interface monitor/traffic sampling) for direct API/REST routers (`/api/network/routers`, `/api/network/sessions`). Live throughput/session streaming via **SSE** (`/api/network/sessions/stream`) and **WebSocket** (`/api/network/sessions/ws?token=...`).
  - **Bandwidth & QoS packages:** CRUD with burst/priority/queue types and **real sync/provisioning to direct API/REST MikroTik routers** (PPP profile rate-limits + simple queue templates) (`/api/network/packages`, `/bandwidth`). Queue Tree/PCQ and deeper per-subscriber queue binding/lifecycle automation are available as template/profile-based provisioning (vendor/device behavior may vary).
  - **FreeRADIUS integrated in docker stack:** `freeradius` service (UDP 1812/1813) with PostgreSQL SQL backend (`radcheck`, `radreply`, `radgroupcheck`, `radgroupreply`, `radusergroup`, `radacct`, `radpostauth`, `nas`) managed in IzanDesk DB; config in `docker/radius/`, service in `docker/docker-compose.yml`. FR3-compatible SQL query structure and `authorize_*` column order (`attribute,value,op`) are configured for auth/acct/post-auth; `filter_username`/`suffix` are disabled to accept non-FQDN usernames (e.g. `user@site`).
  - **Real RADIUS/AAA & accounting:** subscriber sync writes real FreeRADIUS SQL records (`radcheck`/`radreply`/`radusergroup`) (`/api/radius/sync`, `/radius`); **RFC3576 CoA/PoD** sends real UDP packets to the target NAS using stored per-router secret & CoA port (`/api/radius/coa`). Accounting start/interim-update/stop is recorded to `radacct` and live RADIUS sessions are overlaid from `radacct` when accounting data is received. Live PPPoE/RADIUS auth (PAP/SQL, e.g. `Mikrotik-Group`) and `radacct` start/stop with session time, octets, IP and terminate cause have been validated in a real flow; `radpostauth` logging may vary by flow/config.
  - **NAS auto-sync:** RADIUS-mode routers are auto-synced to FreeRADIUS `nas` table on create/update/delete; bulk sync via `POST /api/network/routers/sync-radius-nas` (FreeRADIUS may require reload/restart to pick up SQL client changes depending on config). Observed NAS source IPs can be registered to accept real auth/acct traffic.
  - **WireGuard overlay for NAT/CGNAT sites (plug-and-play):** IzanDesk-managed hub-and-spoke tunnel (`wg-hub` container/service, configurable hub endpoint/UDP port and overlay CIDR, DB-driven hub/peer config) so MikroTik routers without public IPs can be reached/managed by IzanDesk (`/api/wireguard`, `/wireguard`). Peers are auto-provisioned to MikroTik (API/REST when reachable) or via RouterOS v7 bootstrap scripts (spoke dials out with keepalive), with per-peer allowed/tunnel routes and declared OLT management CIDRs to reach OLTs behind spoke routers.
  - **FTTH OLT manager:** OLT CRUD/test, ONU discovery, 1-click authorize & subscriber link, and optical Rx/Tx telemetry with color-coded thresholds (Normal/Warning/Critical) (`/api/olt/*`, `/olts`) via an **SNMP-capable, tunnel-aware adapter** (real SNMP test/discovery/telemetry attempts when SNMP tools, access, and vendor/model OID/index mapping are available, including polling via the WireGuard path; safe fallback when unavailable). Real vendor mappings (best-effort): **VSOL V1600D (EPON)** — IF-MIB ONU discovery with online/offline status, optical Rx/Tx (dBm), and MAC enrichment; **BDCOM P3310C (EPON)** — IF-MIB `EPON0/x:y` discovery with online/offline status, ONU MAC, RX/TX optical (dBm, vendor MIB), distance (m, best-effort), description/name, and last-down timestamp enrichment. (Explicit distance units/Tx scaling and alarm/down-cause codes may require MIB/manual or CLI confirmation.)
  - *Notes:* Real end-to-end behavior depends on device reachability/config (MikroTik API/REST services, NAS RADIUS/Accounting to IzanDesk, CoA, OLT SNMP/CLI access, and WireGuard UDP reachability/routing/firewall). Accounting-driven sessions/rates require NAS accounting packets; advanced OLT per-ONU fields/operations depend on vendor/model-specific mappings and, for NATed sites, correct tunnel routes. FreeRADIUS SQL client changes may require container reload/restart. MikroTik PPP profile/rate-limit values must be valid for dynamic queue creation (e.g. burst-rate >= max-rate when bursting is configured) to avoid session termination on connect. Client-side PPP/LCP keepalive loss or weak optical signal (e.g. low ONU RX dBm) can drop established sessions independently of RADIUS/provisioning.
- **Phase 4:** Automated Billing, Due Policies & Payment Gateways *(Implemented, gap-hardened)*
  - **Automated invoicing engine:** batch monthly invoice generation with prorated mid-month calculations, invoice items/records, due recalculation, and billing metrics (`/api/billing/*`, `/billing`).
  - **Multi-stage due policy & enforcement:** pre-expiry warning, grace countdown, overdue suspension/isolation and walled-garden stage with DB-locked periodic evaluation, suspension logs, and manual evaluate/suspend/reactivate controls.
  - **Restricted access / walled garden:** MikroTik restricted PPP profile provisioning, RADIUS reply attributes and RFC3576 CoA/PoD (CoA with fallback) for immediate enforcement. *(Full captive redirect to portal requires NAS/router address-list/firewall/DNS/NAT rules; provisioning helper/endpoint available for API/REST-managed routers.)*
  - **Hot-reloadable payment gateway plugins:** bKash (tokenized checkout + personal MFS SMS listener hook), Nagad merchant PGW, Rocket, Stripe (Elements/cards/Apple/Google Pay), and PayPal Smart Buttons (`plugins/payment-*`), with runtime gateway config/credentials managed in DB via Plugins/Billing APIs and UI (`/plugins`, `/plugins/payment-gateways/*`).
  - **Payments, webhooks & MFS ingest:** checkout/confirm/webhook flows with idempotent processing and signature/token verification when configured, plus MFS SMS ingestion (`/api/billing/payments/sms/ingest`) for plugin parsing/auto-match.
  - **Instant auto-reactivation:** confirmed/cleared payments restore access by updating dues/state and re-enabling/provisioning PPP/RADIUS/CoA (target < 2s).
  - *Notes:* End-to-end validation of live enforcement, NAS captive redirect, and real/signed gateway or MFS-forwarder flows depends on device/network configuration and provider credentials/webhook secrets/callback setup.
- **Phase 5:** Reseller Multi-Tier System, CRM & Omnichannel Messaging
- **Phase 6:** Customer Self-Care Portal & 1-Click Plug-and-Play Packaging

## ▶️ Local Run

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
- **API:** see `apps/api/.env.example`
  - `API_PORT`, `JWT_SECRET`, `WEB_ORIGIN`, `ALLOW_LAN_ORIGINS`
- **Caddy/HTTPS (optional):** see `docker/.env.example` and `docker/Caddyfile`
  - `CADDY_SITE_ADDRESS` — domain for automatic HTTPS (e.g. `izandesk.example.com`) or `:80` for HTTP
  - `CADDY_UPSTREAM` — defaults to `http://localhost:3000` (Caddy uses host networking in compose)
  - `CADDY_ACME_EMAIL` — recommended for public TLS certificates
- **Remote/NAT:** with same-origin proxy, browsers only need the web port (`3000`, or `80/443` via reverse proxy). Do not expose Postgres/Redis ports publicly. Automatic Let's Encrypt HTTPS requires a public domain pointing to your server with ports 80/443 forwarded; for public-IP-only access use HTTP (`:80`) or configure custom TLS.
- **RADIUS (FreeRADIUS):** `docker-compose` exposes UDP `1812/1813` for auth/acct — restrict by firewall to trusted NAS IPs. RADIUS-mode routers in IzanDesk are auto-synced to FreeRADIUS `nas` clients; CoA/PoD is sent to the NAS using the per-router shared secret and CoA port (allow inbound CoA/UDP, e.g. 3799, from the IzanDesk server to the NAS). If SQL NAS/client changes aren’t picked up, reload/restart `izandesk-freeradius`.
- **WireGuard overlay (optional):** `izandesk-wg-hub` exposes UDP `51820` (configurable) for spoke routers behind NAT/CGNAT to dial out; set the hub public endpoint/port in `/wireguard`, allow/forward the UDP port, and apply per-peer bootstrap/provisioning. Declare OLT management CIDRs per peer and ensure tunnel↔LAN routing/firewall on spokes for OLT reachability.

**Demo RBAC accounts:** `admin@izandesk.com/admin123`, `noc@izandesk.com/noc123`, `billing@izandesk.com/billing123`, `tech@izandesk.com/tech123`, `reseller@cybernet.bd/reseller123`

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
