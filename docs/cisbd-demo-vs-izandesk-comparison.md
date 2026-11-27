# CIS Complete ISP Solution (demo.cisbd.net) vs IzanDesk

**Research date:** 2026-11-25
**Reference system:** CIS Complete ISP Solution / Cloud Core Soft — `https://demo.cisbd.net`
**Access used:** admin `demo` / `demo`; client portal via a demo PPPoE account from the client list
**IzanDesk baseline:** this repository (`apps/web`, `apps/api`, `docs/`)

---

## 1. Method

1. Signed in to the CIS admin at `demo.cisbd.net/login` and crawled the authenticated admin area
   (dashboard, clients, billing, network, OLT, resellers, HR, SMS/Telegram, settings, reports,
   imports/exports, portal content, and record-detail screens). 231 distinct admin paths were
   observed; ~90 are screens rather than per-record links.
2. Signed in to the CIS **customer self-care portal** with a demo PPPoE account and crawled all
   10 portal screens (dashboard, invoices, billing overview, payments, ledger, live traffic, usage,
   notices, movie servers, tickets, profile).
3. Compared the observed screens and workflows against IzanDesk's shipped pages, API routes, and
   database schema in this repo. Where IzanDesk has a documented-but-partial capability, it is marked
   **Partial** rather than **Missing**.

> Caveat: the CIS demo contains deliberately messy test data (clients named `sdsdf`, tickets saying
> "blank blank"). The comparison therefore focuses on **available workflows and screen depth**, not
> on data quality.

---

## 2. What CIS is

| Aspect | Observation |
| :--- | :--- |
| Product | "CIS Complete ISP Solution" by Cloud Core Soft; Bangladesh-focused ISP billing/operations suite |
| Stack | PHP 8.5, Laravel Blade server-rendered pages, Bootstrap + Tabler, full-page reloads |
| Admin surface | ~90 screens across Dashboard, Clients, Billing, Accounts, Resellers, Network, HRM, SMS, OLT, Settings, Reports, Import/Export |
| Client portal | 10 screens: dashboard, invoices, billing overview, payments, ledger, live traffic, usage, notices, movie servers, tickets, profile |
| Commercial model | LAMP-style application; the demo is a shared hosted tenant |
| Network model | MikroTik RouterOS API + external "OLT Monitor" service (Telnet templates, `GET /templates`) |
| Notable BD-market features | Prepaid/postpaid/free bill types, dedicated bandwidth (BW) clients, upstream IIG/NTTN billing, MFS ("Personal Pay") reconciliation inbox, reseller per-package wholesale pricing, SMS/Telegram notification queue, staff client-scope, movie-server portal links |
| Not observed in the demo account | RADIUS/AAA, CoA/PoD, TR-069/ACS, WireGuard, PostGIS fiber GIS, plugin kernel, MCP, AI assistant, inventory/serial lifecycle, leads/installation orders, MFA/security policy engine |

The demo account can see most operations but several super-admin screens return **403**
(`/admin/cron-dashboard`, `/admin/activity-monitor`, `/admin/user-scope`, `/admin/db-backup`).
Those features exist but could not be inspected in-session.

---

## 3. What IzanDesk is

A modern, containerized ISP ERP:

- **Frontend:** Next.js 16 / React 19 / Tailwind 4, responsive sidebar + mobile nav, dark/light,
  command palette, PWA customer portal.
- **Backend:** Express 5 + TypeScript, PostgreSQL 16 + PostGIS, Redis, in-process schedulers with
  DB locks, hot-reload plugin kernel.
- **Network:** FreeRADIUS 3 (SQL AAA, accounting, CoA/PoD), MikroTik RouterOS API/REST/RADIUS
  dual-mode provisioning, WireGuard hub/spoke for CGNAT sites, TR-069/GenieACS, SNMP OLT manager.
- **Modules:** subscribers/KYC/GIS/inventory, billing/due policies/walled garden/payment gateways,
  resellers/white-label, tickets/SMS/WhatsApp/Telegram, finance/HR/procurement/hotspot/reports,
  AI copilot (English/Bangla) and an audited MCP server.

---

## 4. Head-to-head capability matrix

Legend: **Yes** = shipped and usable; **Partial** = exists but narrower than CIS or not fully wired
in the UI; **No** = not observed in the CIS demo account or in IzanDesk's shipped UI/API. Because
some CIS screens are super-admin-only (403 for the demo account), "No" for CIS means "not visible in
this inspection", not a definitive product limitation.

### 4.1 Subscribers & service lifecycle

| Capability | CIS demo | IzanDesk | Verdict |
| :--- | :--- | :--- | :--- |
| Home/corporate subscriber CRUD, status lifecycle | Yes | Yes | Parity |
| KYC fields, documents, photo, printable KYC | Yes (NID/DOB/profession/parents/reference + PDF) | Yes (documents, review queue, encryption, retention/legal holds) | IzanDesk deeper workflow; CIS has more demographic fields |
| Separate **dedicated bandwidth (BW) client** vertical | Yes (`/admin/bw/clients`, `/bw/invoices`, `/bw/payments`) | No | **CIS lead** |
| BW per-source costing (Internet/FNA/GGC/CDN/BDIX, Mbps × price/Mbps) | Yes, with mid-month proration | No | **CIS lead** |
| Billing modes: Prepaid / Postpaid / Free | Yes, per client | No (`billing_cycle_day` only) | **CIS lead** |
| Per-client permanent monthly discount | Yes | No (invoice-level discount only) | **CIS lead** |
| Per-client invoice due day / billing expiry day / grace days | Yes | Partial (cycle day + dates; grace is policy-global) | CIS lead |
| One-click renew (months/days, amount preview, cash type, SMS) | Yes, from client list and 360 | Partial (reseller-wallet renew; no direct-subscriber renew UI) | **CIS lead** |
| Bulk enable/disable, change package, transfer reseller, delete | Yes | Yes (activate/suspend/walled garden/reprovision/set package/set reseller/delete) | Parity |
| Transfer router, mark left / undo left / trash | Yes | Partial (router/package edit; `TERMINATED` status, no left/trash restore) | CIS lead |
| MAC binding, disconnect, live graph, session/device pages | Yes | Partial (360 view, live page, equipment; no bind/disconnect/live graph/session page) | CIS lead |
| Client ledger with manual adjustment | Yes | Partial (finance transactions; no per-client ledger editor) | CIS lead |
| Client 360 with financials + KYC PDF + actions | Yes | Partial (360 view with profile/equipment/comms/history) | CIS lead |
| Bulk location pinning / map | Yes (bulk map, "use my location") | Yes (MapLibre pin picker, geolocation, reverse geocode, PostGIS GIS) | **IzanDesk lead** |
| CSV/XLSX import + MikroTik import | Yes (CSV + MikroTik) | Yes (XLSX/CSV + MikroTik PPP/Hotspot import) | Parity |
| Export clients/invoices (CSV/Excel/PDF, selected rows) | Yes | Partial (CSV export) | CIS lead |
| Area → zone hierarchy | Yes | Yes (+ distribution boxes, splitters, fiber routes) | **IzanDesk lead** |
| Leads pipeline, installation orders | No | Yes | **IzanDesk lead** |
| Inventory, serials, RMA, ONU auto-import | No | Yes | **IzanDesk lead** |

### 4.2 Billing, collections & finance

| Capability | CIS demo | IzanDesk | Verdict |
| :--- | :--- | :--- | :--- |
| Monthly batch invoicing with proration | Yes | Yes | Parity |
| Manual invoice creation with VAT % | Yes | Partial (tax column exists; no VAT rate/UI) | CIS lead |
| Due policies, auto-suspend, reactivation | Yes (auto suspend/enable) | Yes (staged warnings, grace, isolation, walled garden, instant reactivation) | **IzanDesk lead** |
| Walled-garden captive access | No | Yes | **IzanDesk lead** |
| Due reports: simple / pro / analytics (router × area matrix, aging) | Yes (three report screens) | Partial (aging buckets, collections; no router × area matrix) | CIS lead |
| Collections & payment reports | Yes | Yes | Parity |
| Waivers / adjustments with report | Yes | Partial (waiver recorded as finance adjustment; no approval workflow) | CIS lead |
| Invoice PDF / print / signed share link / email | Yes (PDF/print) | Yes (PDF/HTML, signed expiring links, email) | Parity |
| Prepaid invoice lifecycle | Yes (separate handling, skip in monthly run) | No (batch bills all `monthly_bill > 0`) | **CIS lead** |
| MFS payment reconciliation inbox (bKash/Nagad/Rocket) | Yes ("Personal Pay" inbox: unmatched/pending/failed, rematch, fix & post) | Partial (SMS ingest + matching; no operator inbox UI) | **CIS lead** |
| Payment gateways | bKash + MFS SMS, mostly regional | bKash, Nagad, Rocket, Stripe, PayPal via hot-reload plugins | **IzanDesk lead** |
| Company accounts (cash/bank/MFS) and balances | Yes | Yes (finance accounts/transactions) | Parity |
| Wallet-to-wallet settlement + approvals | Yes (company/personal/reseller wallets) | Partial (reseller top-up approvals; no general settlement) | CIS lead |
| Upstream/IIG/NTTN bandwidth billing | Yes (`/admin/expense-upstreams`) | No | **CIS lead** |
| Expenses, income, other income | Yes | Yes (finance vouchers/transactions) | Parity |
| Procurement, assets, depreciation | No | Yes | **IzanDesk lead** |
| Double-entry journals / P&L / reconciliation | Partial (accounts + income/expense) | Yes (journals, P&L, reconciliation, CSV exports) | **IzanDesk lead** |
| Payroll & HR | Yes (salary components, payslips, self-service, attendance check-in/out) | Partial (employees, attendance, leave, payroll runs with commission) | CIS lead |
| Reseller management, wallet, renew | Yes | Yes | Parity |
| Reseller **per-package wholesale price book** | Yes (cost per package, hidden/ready) | No (global buying-margin %) | **CIS lead** |
| Reseller auto-renew rules / allowed renew days | Yes | No | **CIS lead** |
| Reseller SMS balance & unit price | Yes | No | **CIS lead** |
| Reseller portal parity tabs (balance/sharing/billing/invoice/online/branches/RADIUS/login/complaints/parental) | Yes | Yes | Parity |
| White-label branding / subdomain | Partial (branding fields) | Yes (brand, colors, logo, subdomain/custom domain) | **IzanDesk lead** |

### 4.3 Network, OLT & provisioning

| Capability | CIS demo | IzanDesk | Verdict |
| :--- | :--- | :--- | :--- |
| MikroTik RouterOS API/REST provisioning | Yes (API + sync toggles both directions) | Yes (API/REST/RADIUS per router; PPP secrets, profiles, queues) | Parity; IzanDesk broader modes |
| RADIUS AAA, accounting, CoA/PoD | No | Yes (FreeRADIUS SQL, `radacct`, RFC3576) | **IzanDesk lead** |
| PPPoE audit: secret vs client package/status/MAC mismatch, import unknown, fix either side | Yes (`/admin/routers/{id}/audit`) | Partial (import preview; no audit/mismatch reconciliation UI) | **CIS lead** |
| Package → PPP profile sync | Yes | Yes | Parity |
| Package bulk import from router PPP profiles | Yes | Partial (sync to router; no import-from-router package creation) | CIS lead |
| WireGuard overlay for CGNAT/NAT sites | No | Yes | **IzanDesk lead** |
| TR-069 / GenieACS (Wi-Fi, reboot, diagnostics, params) | No | Yes | **IzanDesk lead** |
| OLT discovery / ONU authorization / optical telemetry | Yes (Telnet-based external OLT Monitor) | Yes (SNMP, IF-MIB + vendor OIDs, Rx/Tx/DDM/distance) | **IzanDesk lead** |
| OLT vendor/template breadth | Yes (~40 vendor templates: VSOL, BDCOM, CDATA, HSGQ, ECOM, etc.) | Partial (VSOL V1600D, BDCOM P3310C + generic EPON/GPON) | **CIS lead** |
| OLT MAC table ↔ PPPoE client correlation | Yes | Yes (FDB correlation + auto-link, ambiguity guard) | Parity |
| ONU → inventory auto-import | No | Yes | **IzanDesk lead** |
| Real-time session streaming | Polling | SSE + WebSocket | **IzanDesk lead** |

### 4.4 Support, messaging & portal

| Capability | CIS demo | IzanDesk | Verdict |
| :--- | :--- | :--- | :--- |
| Ticketing with status/priority/assignee/conversation | Yes | Yes (+ SLA due/breach, dispatch, GPS, mobile resolution) | **IzanDesk lead** |
| SMS / WhatsApp / Telegram / email channels | Yes (SMS, Telegram, email) | Yes (GreenWeb, Twilio, WhatsApp Cloud, Telegram, SMTP) | Parity |
| Notification **queue** with retry/requeue + status pages | Yes (queued/sent/failed, attempts, last error, requeue) | Partial (delivery logs + gateway tester; no queue/retry UI) | **CIS lead** |
| Per-event templates (welcome, bill, due, payment, disable, expiry) | Yes | Partial (templates exist; fewer event hooks/UI) | CIS lead |
| Bulk SMS with recipient filters and placeholders | Yes (rich filters + payment link) | Partial (channels/templates/tester; no bulk campaign screen) | CIS lead |
| Customer portal: invoices, payments, usage, tickets | Yes | Yes | Parity |
| Portal ledger | Yes | No (invoices/payments, no running ledger) | CIS lead |
| Portal plan catalog / upgrade request | No | Yes | **IzanDesk lead** |
| Portal documents/KYC upload | Partial (view status) | Yes (upload/replace, review status) | **IzanDesk lead** |
| Portal speedtest, Wi-Fi (TR-069), FUP/quota, notifications, payment prefs | No | Yes | **IzanDesk lead** |
| Portal notices / marquee for due clients / movie servers | Yes | Partial (hard-coded welcome announcement; no CMS, marquee, or movie links) | CIS lead |
| AI copilot (English/Bangla), MCP server | No | Yes | **IzanDesk lead** |

### 4.5 Administration, security & operations

| Capability | CIS demo | IzanDesk | Verdict |
| :--- | :--- | :--- | :--- |
| Roles | Admin / reseller / client | Super Admin, NOC, Billing, Technician, Reseller | **IzanDesk lead** |
| Staff user management UI | Yes (`/admin/users` link, user-scope) | Partial (staff API + session admin; no staff CRUD/scope UI) | **CIS lead** |
| Restrict staff to areas/clients (client scope) | Yes (super-admin screen, 403 for demo) | No | **CIS lead** |
| Audit log with filters/export | Yes | Yes | Parity |
| Login activity report | Yes | Partial (auth audit; no dedicated page) | CIS lead |
| MFA/TOTP, session timeout, lockout, IP allowlist, maintenance mode | No | Yes | **IzanDesk lead** |
| Database backup UI | Yes (403 for demo) | Yes (system health, run/list backups) | Parity |
| Cron dashboard / activity monitor | Yes (403 for demo) | Partial (scheduler status in system health) | CIS lead |
| Settings: locale, currency, invoice prefix, branding, portal, billing, gateways | Yes | Yes (schema-driven, per-category reset, masked secrets) | **IzanDesk lead** |
| Multi-language UI (English/Bangla) | Yes | Partial (language setting; UI largely English, AI bilingual) | CIS lead |
| API tokens / MCP scoped keys | Partial (integration tokens) | Yes (MCP keys, role-scoped, step-up gated) | **IzanDesk lead** |
| Plugin kernel / hot reload | No | Yes | **IzanDesk lead** |
| Deployment | Manual LAMP | Docker Compose 1-click, multi-arch images | **IzanDesk lead** |
| UI/UX | Bootstrap/Tabler, full-page reloads | Next.js/Tailwind, responsive PWA, dark/light, Cmd+K | **IzanDesk lead** |

---

## 5. Where CIS is still stronger (and what to build)

These are the gaps that matter for a Bangladesh ISP switching from CIS. Ordered by commercial impact.

### P0 — parity blockers

1. **Dedicated bandwidth (BW) client vertical**
   - CIS separates home clients from corporate/dedicated BW clients, with per-source line items
     (Internet, FNA, GGC, Baishan, CDN, BDIX), Mbps, price/Mbps, mid-month proration, and separate
     BW invoices/payments/portal login.
   - IzanDesk has `CORPORATE` subscriber type and `LEASED_LINE_CIR` in the API, but no BW source
     catalog, per-source costing, or BW invoice flow.
   - Suggested slice: `bw_sources` (name, price_per_mbps), `bw_clients`, `bw_client_items`
     (effective_from, source, mbps, price), `bw_invoices`; routes `/api/bw/*`; page `/bw`; portal tab.
     Reuse the existing invoice/payment ledger where possible.

2. **Upstream provider (IIG/NTTN/transit) billing**
   - CIS tracks upstream companies, bandwidth, rate/Mbps, outstanding/advance, monthly bills and
     payments; this feeds true margin.
   - IzanDesk has procurement/vendors but no upstream bandwidth billing.
   - Suggested slice: `upstream_providers`, `upstream_bills`, `upstream_bill_items`,
     `upstream_payments`; post to finance expenses; page `/upstream`.

3. **Billing modes + direct renewal**
   - CIS supports Prepaid/Postpaid/Free per client, permanent discount, per-client due day/grace,
     and one-click renew (months/days, cash/bKash, amount preview, SMS).
   - IzanDesk batches every subscriber with `monthly_bill > 0`; direct-subscriber renewal is not a
     first-class UI action (reseller wallet renew exists).
   - Suggested slice: `subscribers.billing_mode`, `permanent_discount`, `grace_days`,
     `invoice_due_day`; skip PREPAID/FREE in `runBatchInvoicing`; add
     `POST /api/billing/subscribers/:id/renew` and a Renew action on the subscriber 360 page.

4. **MFS reconciliation inbox**
   - CIS "Personal Pay" shows unmatched/pending/failed bKash/Nagad/Rocket events, lets an operator
     search a client, rematch, and "fix & post" — the highest-friction daily task for BD ISPs.
   - IzanDesk already has `payment_sms_events`, ingest, and conservative matching, but no inbox.
   - Suggested slice: `/billing/mfs-inbox` reading `payment_sms_events`; filters by status/provider;
     search subscribers; `POST /api/billing/payments/sms/:id/match` and `/post`.

5. **Reseller price book + auto-renew + SMS balance**
   - CIS lets each reseller have per-package wholesale cost and hidden/ready status, auto-renew
     days, allowed renew days, and an SMS balance with unit price.
   - IzanDesk has a single `buying_margin_percent` per reseller.
   - Suggested slice: `reseller_package_prices` (reseller_id, package_id, wholesale_price, status);
     `auto_renew_enabled`, `auto_renew_days_before`, `allowed_renew_days`; `sms_balance`,
     `sms_unit_price`; use the price book in `renew-subscriber`.

### P1 — operational depth

6. **PPPoE audit / reconciliation** — compare router secrets against IzanDesk subscribers
   (package/status/MAC mismatches, unknown/importable secrets, fix on router or in app).
7. **Notification queue + status pages** — persist outbound SMS/email with attempts, last error,
   requeue, and delivered/pending/failed views; add per-event templates (welcome, bill, due, payment,
   disable, expiry).
8. **HR self-service + payroll depth** — "my salary / my attendance / my statement", employee wallet,
   salary components (basic, mobile, rent, medical, food, PF, tax), payslips, attendance check-in/out
   with late/verification/source.
9. **Wallet/settlement model** — company/personal/reseller wallets, wallet-to-wallet transfers,
   approvals, settlement and statements (IzanDesk currently has reseller wallet + top-up approvals).
10. **Report cuts & exports** — area-wise client health, package-wise revenue, BW reports, and
    CSV/Excel/PDF exports for clients/invoices/selected rows.
11. **Client 360 action surface** — disconnect/reconnect, MAC bind, live graph, sessions/devices,
    KYC PDF, ledger adjustment, mark-left/trash/restore, transfer router.
12. **Portal content CMS** — notices, due-client marquee, movie-server links, and a ledger tab
    (IzanDesk's portal already leads on plans/docs/speedtest/Wi-Fi/FUP).
13. **Staff users + client scope** — UI for `staff` CRUD and area/client scoping. The API exists but
    there is no screen; CIS exposes both.
14. **OLT vendor templates** — expand beyond VSOL/BDCOM/generic; CIS ships ~40 telnet templates.

### P2 — nice-to-have

15. Login-activity report, cron dashboard/activity monitor screens.
16. Package bulk import from router PPP profiles.
17. Richer KYC demographics (profession, nationality, parents, reference).
18. Personal message archive (WhatsApp/Messenger import) — niche; not ISP-core.
19. Excel/PDF exports across more modules.

---

## 6. Where IzanDesk is clearly ahead

- **Carrier-grade AAA:** FreeRADIUS SQL, `radacct` accounting, CoA/PoD, NAS auto-sync, per-NAS
  secret/CoA port. CIS has no RADIUS layer.
- **Real network automation:** MikroTik API/REST/RADIUS dual-mode, package/profile/queue
  provisioning, WireGuard hub-and-spoke for CGNAT sites, SSE/WebSocket live sessions.
- **FTTH depth:** SNMP OLT discovery/telemetry (Rx/Tx, DDM, distance), ONU authorization, automatic
  ONU↔subscriber linking (name tokens + FDB/MAC correlation), inventory auto-import.
- **TR-069/GenieACS:** remote Wi-Fi SSID/password, reboot, diagnostics, parameter get/set.
- **GIS:** PostGIS fiber routes, distribution boxes/splitters, trace-to-subscriber, pin picker,
  reverse geocoding.
- **BSS breadth:** inventory/serials/RMA, procurement/assets/depreciation, leads, installation
  orders, hotspot vouchers, FUP enforcement, walled garden, compliance/legal holds.
- **Platform:** plugin kernel, payment-gateway plugins, AI copilot (English/Bangla), MCP server,
  schema-driven settings, MFA/session/lockout/maintenance, signed invoice links, scheduled reports.
- **UX/ops:** modern responsive UI/PWA, command palette, Docker 1-click deployment, audit trail,
  white-label reseller portal.

---

## 7. Architecture comparison

| Layer | CIS demo | IzanDesk |
| :--- | :--- | :--- |
| UI | Laravel Blade + Bootstrap/Tabler, server-rendered, full reloads | Next.js 16 / React 19 / Tailwind 4, responsive PWA, dark/light, Cmd+K |
| API | Laravel controllers/routes inside the monolith | Express 5 TypeScript REST API, role-scoped |
| Data | Relational DB behind Laravel (single tenant) | PostgreSQL 16 + PostGIS, Redis |
| Jobs | Cron scripts (`monthly_invoice_runner`, SMS sender, reminders) | In-process schedulers with DB locks; queue tier planned |
| Network | MikroTik API + external Telnet OLT Monitor | MikroTik API/REST, FreeRADIUS, WireGuard, SNMP OLT, GenieACS |
| Extensibility | Hard-coded modules | Hot-reload plugin kernel (payment/SMS/OLT plugins) |
| Auth | Session login, admin/reseller/client | JWT + RBAC, MFA/TOTP, step-up, session revocation |
| Deployment | Manual LAMP/LEMP | Docker Compose, multi-arch images, health checks |
| Real-time | Polling / page reload | SSE + WebSocket, live session cache |

---

## 8. Recommended plan

**Sprint A (revenue parity, 2–3 weeks):** BW clients + BW invoices; upstream billing; billing
modes + direct renew; MFS inbox; reseller price book.

**Sprint B (retention/ops, 2–3 weeks):** PPPoE audit; notification queue/status pages; client 360
actions; portal notices/marquee/ledger; report cuts/exports.

**Sprint C (admin depth):** staff users + client scope; HR self-service/payslips; wallet
settlements; OLT vendor templates.

Sequencing rationale: Sprint A closes the flows that block a CIS customer from migrating (corporate
BW contracts, upstream cost visibility, prepaid renewals, MFS cash reconciliation, reseller pricing).
Sprint B removes daily operator friction. Sprint C closes administrative and HR parity.

---

## 9. Evidence appendix

**CIS admin screens observed (selection):**
`/admin/dashboard`, `/admin/clients`, `/admin/clients/create`, `/admin/clients/{id}` (+ ledger,
financial, sessions, devices, kyc-print), `/admin/clients-all-info`, `/admin/clients-geo`,
`/admin/clients-online|offline`, `/admin/clients-import`, `/admin/clients-mikrotik-import`,
`/admin/bw/clients`, `/admin/bw/clients/{id}/items`, `/admin/bw/invoices`, `/admin/bw/payments`,
`/admin/billing`, `/admin/billing/adjust`, `/admin/billing/auto-suspend`, `/admin/invoices`,
`/admin/invoices/monthly-generate`, `/admin/collections`, `/admin/payment-report`,
`/admin/due-report`, `/admin/due-report-pro`, `/admin/due-analytics`, `/admin/waivers`,
`/admin/accounts`, `/admin/wallets`, `/admin/wallet-settlement`, `/admin/wallet-approvals`,
`/admin/wallet-statement`, `/admin/expenses`, `/admin/income`, `/admin/expense-upstreams`,
`/admin/bkash/payments`, `/admin/personal-pay`, `/admin/resellers`, `/admin/resellers/{id}`,
`/admin/reseller-packages`, `/admin/reseller-report`, `/admin/routers`,
`/admin/routers/{id}/audit`, `/admin/routers/mac-audit`, `/admin/packages`, `/admin/areas`,
`/admin/zones`, `/admin/olts`, `/admin/olt/tools`, `/admin/olt/mac-table`, `/admin/tickets`,
`/admin/employees`, `/admin/payroll`, `/admin/attendance`, `/admin/employee-statement`,
`/admin/my-salary`, `/admin/sms/send|bulk|report|templates|gateway-tester`,
`/admin/notifications`, `/admin/tg/dashboard`, `/admin/settings` (+ billing/telegram/bkash/
reseller/portal sections), `/admin/company-info`, `/admin/portal-notices`, `/admin/portal-marquee`,
`/admin/movie-servers`, `/admin/db-backup` (403), `/admin/cron-dashboard` (403),
`/admin/user-scope` (403).

**CIS portal screens observed:**
`/portal`, `/portal/billing-overview`, `/portal/invoices`, `/portal/payments`, `/portal/ledger`,
`/portal/live-traffic`, `/portal/usage`, `/portal/notices`, `/portal/movie-servers`,
`/portal/tickets`, `/portal/profile`.

**IzanDesk pages referenced:**
`/` dashboard, `/subscribers` (+ wizard, 360, live), `/kyc-review`, `/leads`,
`/installation-orders`, `/gis`, `/inventory`, `/billing` (+ all/unpaid/paid/invoices/
monthly-generate/collections/payments/due-analytics/adjust-bill/auto-suspend/waivers),
`/due-report`, `/collections`, `/resellers` (+ wallet/renew, parity tabs), `/routers` (+ 360),
`/bandwidth`, `/radius`, `/wireguard`, `/acs`, `/olts` (+ 360), `/walled-garden`, `/tickets`,
`/messaging`, `/portal`, `/finance`, `/reports`, `/hr`, `/procurement`, `/hotspot`, `/audit`,
`/plugins`, `/system/health`, `/settings`, `/ai-assistant`, `/ai-settings`.
