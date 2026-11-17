# Playwright smoke suite

Verifies the reseller portal and the shared subscriber wizard against a running
dev stack. It **does not start a server** — bring up `pnpm dev:all` (or the Docker
dev containers) first.

## Run

```bash
pnpm test:e2e                 # safe, read-only smoke checks
pnpm test:e2e:mutations       # also creates and deletes one test subscriber
```

Target a different host with `E2E_BASE_URL=https://your-host`.

CI (`.github/workflows/e2e-smoke.yml`) boots `postgres`, `redis`, `api` and `web`
from `docker/docker-compose.yml`, waits for `/api/health` and the web root, then
runs the default (non-mutating) suite against `http://localhost:3000` on every
push to `master`, pull request and manual dispatch. The opt-in mutating test is
not run in CI.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_BASE_URL` | `https://izandesk.duckdns.org` | App under test |
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
- (Opt-in) A reseller can create and delete a subscriber through the wizard.
