# Playwright smoke suite

Verifies the reseller portal and the shared subscriber wizard against a running
dev stack. It **does not start a server** — bring up `pnpm dev:all` (or the Docker
dev containers) first.

## Run

```bash
pnpm test:e2e                 # safe, read-only smoke checks
pnpm test:e2e:mutations       # also runs the opt-in create/edit/delete/drag flows
                              # (subscriber, GIS box, GIS area, MCP key lifecycle)
pnpm test:mcp                 # standalone MCP JSON-RPC protocol smoke test
pnpm seed:e2e                 # idempotent demo fixtures for a fresh disposable stack
node scripts/smoke-security.mjs  # guards, TOTP, secret encryption, rate limiter (after api build)
```

Tests target `http://localhost:3000` by default. For a fast, deterministic run
against the Docker stack, start the optional built web server and point the suite
at it (first start builds once, subsequent runs are fast):

```bash
pnpm test:e2e:docker
```

That script starts the `web-e2e` profile container and points Playwright at
`http://localhost:3100`. `web-e2e` builds from an isolated copy of the source
with its own node_modules volume, so the hot-reloading `web` service on `:3000`,
the public URL and generated files in the working tree are unaffected.

Point at another host explicitly with `E2E_BASE_URL=https://your-host` (only do
this for a disposable environment when running `test:e2e:mutations`). The smoke
suite itself is read-only; the reseller wizard and tenant-scoping checks seed
their own disposable subscriber. GIS checks still expect seeded topology, so run
`pnpm seed:e2e` once against a fresh disposable stack first. CI does this
automatically.

CI (`.github/workflows/e2e-smoke.yml`) boots `postgres`, `redis`, `api` and `web`
from `docker/docker-compose.yml`, waits for `/api/health` (readiness) and the web root, then
runs the default (non-mutating) suite against `http://localhost:3000` on every
push to `master`, pull request and manual dispatch. CI also typechecks both apps
and runs the standalone `pnpm test:mcp` protocol smoke plus `scripts/smoke-security.mjs`.
The opt-in mutating Playwright tests are not run in CI. CI opts into the demo
security profile (`DISABLE_DEMO_ACCOUNTS=false`, `SECURITY_ALLOW_INSECURE_DEMO=true`);
real deployments must leave that flag unset.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_BASE_URL` | `http://localhost:3000` | App under test (`http://localhost:3100` for the built `web-e2e` container) |
| `E2E_WEB_PORT` | `3100` | Host port for the optional `e2e` profile service |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | `admin@izandesk.com` / `admin123` | Admin login |
| `E2E_RESELLER_EMAIL` / `E2E_RESELLER_PASSWORD` | `reseller@cybernet.bd` / `reseller123` | Partner login |
| `E2E_RESELLER_ID` | resolved from `/api/resellers` | Partner id for scoping assertions |
| `E2E_MUTATIONS` | unset | Enables the create/delete test |

## Coverage

- All 17 reseller portal tabs render with no console errors or failed `/api/` calls.
- Add and Edit open the shared four/five-step wizard for both reseller and admin,
  including the `?new=1` deep link.
- Dashboard KPI cards navigate to the Complaints and Parental Control modules.
- The reseller mobile bottom nav exposes both new tabs with query-aware active
  state and no horizontal overflow at phone widths.
- A reseller gets `404` for KYC, live status, customer detail and complaint
  creation against a foreign subscriber.
- GIS: resellers get `403` from every GIS/topology-mutation endpoint (including
  geocoding, live sessions, audit and trash), read-only roles can browse the map
  and governance views but get `403` on mutations, viewport `bbox` filtering
  returns only pins in view, direct URL navigation shows the access-restricted
  page, and the admin workbench renders its KPIs, layers, Satellite/Streets
  switch, heatmap and live toggles without API errors or phone-width overflow.
- The MCP Server settings tab renders key management, tool allowlisting and a
  client-config template; `/api/mcp/tools` returns the role-safe catalog; and the
  audit deep link filters to MCP events.
- (Opt-in) A scoped, read-only MCP key can be created, used for `tools/list` and
  revoked.
- Security settings render TOTP enrollment and active sessions; the audit CSV
  export requires a session and honours the `entity_type` filter; unknown
  accounts hit progressive lockout with `Retry-After`; and logout revokes the
  current session.
- (Opt-in) A reseller can create and delete a subscriber through the wizard.
- (Opt-in) An admin can create, edit, drag, undo a drag and delete a GIS box,
  create, rename and delete a GIS area, and bulk-import boxes/routes from a
  GeoJSON FeatureCollection, and verify a deleted area is snapshotted into the
  trash, recorded in the audit log and restorable. All test data is removed
  afterwards.
