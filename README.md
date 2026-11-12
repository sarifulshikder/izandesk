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

- **Phase 1:** Project Scaffolding, "Neo-Telecom" UI/UX Design System, Auth & Hot-Reload Plugin Kernel *(In Progress)*
- **Phase 2:** Subscriber & Inventory Management (BSS Core)
- **Phase 3:** Network OSS, MikroTik RouterOS API & OLT Telemetry
- **Phase 4:** Automated Billing, Due Policies & Payment Gateways
- **Phase 5:** Reseller Multi-Tier System, CRM & Omnichannel Messaging
- **Phase 6:** Customer Self-Care Portal & 1-Click Plug-and-Play Packaging
