# ONU → Inventory Auto-Import ("the trick")

Subscriber-linked ONUs (FTTH CPE discovered on OLTs) are **automatically imported into Inventory & Serial Tracking** — no manual data entry. As soon as an ONU is linked to a subscriber, it appears as an assigned serial number and as ONU equipment on the subscriber profile.

---

## How it works

Linking an ONU to a subscriber happens through any of these flows, and each one triggers the inventory sync automatically:

| Trigger | Where |
|---|---|
| Bulk auto-link (`POST /api/olt/auto-link`) — name/client_code or FDB/session-MAC match | `apps/api/src/integrations/onu-autolink.ts` |
| Single ONU authorize/provision with `subscriber_id` (`POST /api/olt/onus/:id/authorize`) | `apps/api/src/routes/olt.ts` |
| Manual bulk import (`POST /api/olt/sync-inventory`) or single (`POST /api/olt/onus/:id/sync-inventory`) | `apps/api/src/routes/olt.ts` |

The sync itself lives in **`apps/api/src/integrations/onu-inventory-sync.ts`** (`syncOnuToInventory()` / `syncAllLinkedOnusToInventory()`) and is **idempotent** — re-running it never creates duplicates.

## What gets created (per linked ONU)

1. **`inventory_items`** — one row per ONU vendor/model, category `ONU` (e.g. `VSOL ONU/ONT`, `BDCOM ONU/ONT`). Reused if it already exists.
2. **`inventory_serials`** — one row per ONU serial number with:
   - `source = 'ONU_IMPORT'` (vs. `'MANUAL'` for hand-entered serials)
   - `status = 'ASSIGNED'`, `assigned_subscriber_id = <subscriber>`
   - `mac_address` from the ONU, `notes = "Auto-imported from OLT <olt> (PON <port>/<onu_id>)"`
3. **`subscriber_equipment`** — one row `equipment_type='ONU'`, `status='INSTALLED'`, linking both `onu_id` and `inventory_serial_id`.
4. **Back-reference** — `onus.inventory_serial_id` points at the created serial, so the ONU↔serial link is queryable from both sides.

Fallback serial when the ONU has no real serial: `ONU-<olt8>-<pon>-<onu_id>`.

## Schema changes

```sql
ALTER TABLE onus ADD COLUMN IF NOT EXISTS inventory_serial_id UUID REFERENCES inventory_serials(id) ON DELETE SET NULL;
ALTER TABLE inventory_serials ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL';
```

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/olt/sync-inventory` | Bulk import all linked ONUs not yet in inventory (`{ limit }`) |
| `POST` | `/api/olt/onus/:id/sync-inventory` | Import one ONU (must be subscriber-linked) |
| `GET` | `/api/inventory/serials?source=ONU_IMPORT` | List ONU-imported serials (joins OLT name, PON port, ONU status, subscriber, equipment) |
| `GET` | `/api/inventory/serials/onu-import/summary` | Counts: total/assigned/in-stock/faulty/RMA, item types, subscribers with ONU, per-vendor breakdown |

## UI

**Inventory → Serial Numbers** (`apps/web/src/app/inventory/page.tsx`):

- **Source filter** dropdown: All / Manual entry / ONU (auto-imported from OLT)
- **Sync ONUs from OLT** button — triggers the bulk import and shows the result count
- **ONU auto-import banner** — totals + per-vendor chips (VSOL/BDCOM/…)
- Each ONU-imported row shows a green badge with **OLT name + PON port** (e.g. `VSOL V1600D • EPON0/4`)

## Verified behavior

- Bulk sync imported **45 linked ONUs** (VSOL 37, BDCOM 8), all `ASSIGNED`; re-run synced **0** (idempotent).
- End-to-end: a newly auto-linked ONU (`EPON04ONU24_Raju` → subscriber `IZN-MT-00039`) appeared in `inventory_serials` (`ONU_IMPORT`, ASSIGNED, note "Auto-imported from OLT VSOL V1600D (PON EPON0/4/24)"), `subscriber_equipment` (`ONU`, INSTALLED, both links), and `onus.inventory_serial_id` — count 45 → 46 — with **no manual sync**.
