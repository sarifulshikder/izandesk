/**
 * ONU → Inventory auto-import ("the trick")
 *
 * When an ONU is linked to a subscriber (onus.subscriber_id set), automatically:
 *   1. Find/create an inventory_items row for the ONU vendor/model (category 'ONU')
 *   2. Find/create an inventory_serials row with the ONU serial, status=ASSIGNED, assigned to the subscriber
 *   3. Find/create a subscriber_equipment row (type=ONU) linking onu_id + inventory_serial_id
 *
 * This makes FTTH ONUs visible in Inventory & Serial Tracking as assigned assets.
 */
import { pool } from '../db';

export type OnvInventorySyncResult = {
  onu_id: string;
  subscriber_id: string;
  item_id: string;
  serial_id: string;
  created: { item: boolean; serial: boolean; equipment: boolean };
};

function onuSerial(onu: any): string {
  return String(onu.serial_number || '').trim()
    || `ONU-${String(onu.olt_id).slice(0, 8)}-${String(onu.pon_port).replace(/[^0-9A-Za-z]/g, '')}-${String(onu.onu_id || '').replace(/[^0-9A-Za-z]/g, '')}`;
}

/** Sync a single ONU (must have subscriber_id) into inventory. Idempotent. */
export async function syncOnuToInventory(onuId: string): Promise<OnvInventorySyncResult | null> {
  const r = await pool.query(
    `SELECT o.*, ol.vendor AS olt_vendor, ol.model AS olt_model, ol.name AS olt_name
     FROM onus o JOIN olts ol ON ol.id = o.olt_id WHERE o.id = $1`,
    [onuId]
  );
  const onu = r.rows[0];
  if (!onu || !onu.subscriber_id) return null;

  const serial = onuSerial(onu);
  const vendor = String(onu.olt_vendor || 'Generic').toUpperCase();
  const model = onu.olt_model ? String(onu.olt_model) : null;
  const mac = onu.mac_address || null;

  // 1) Find or create inventory item for this ONU vendor/model
  let itemId: string | null = null;
  const foundItem = await pool.query(
    `SELECT id FROM inventory_items WHERE category='ONU' AND (upper(brand)=upper($1) OR upper(name) LIKE $2) ORDER BY created_at LIMIT 1`,
    [vendor, `%${vendor}%`]
  );
  let createdItem = false;
  if (foundItem.rows[0]) {
    itemId = foundItem.rows[0].id;
  } else {
    const ins = await pool.query(
      `INSERT INTO inventory_items(name, category, brand, model, unit, reorder_level)
       VALUES($1, 'ONU', $2, $3, 'pcs', 0) RETURNING id`,
      [`${vendor} ONU/ONT`, vendor, model]
    );
    itemId = ins.rows[0].id;
    createdItem = true;
  }

  // 2) Find or create inventory serial (ASSIGNED to subscriber)
  let serialId: string | null = null;
  let createdSerial = false;
  const foundSerial = await pool.query(
    `SELECT id, status, assigned_subscriber_id, item_id FROM inventory_serials WHERE serial_number=$1`,
    [serial]
  );
  const note = `Auto-imported from OLT ${onu.olt_name || vendor} (PON ${onu.pon_port}${onu.onu_id ? '/' + onu.onu_id : ''})`;
  if (foundSerial.rows[0]) {
    serialId = foundSerial.rows[0].id;
    await pool.query(
      `UPDATE inventory_serials SET item_id=$2, status='ASSIGNED', assigned_subscriber_id=$3,
         mac_address=COALESCE($4, mac_address), source='ONU_IMPORT', notes=$5, updated_at=now() WHERE id=$1`,
      [serialId, itemId, onu.subscriber_id, mac, note]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO inventory_serials(item_id, warehouse_id, serial_number, mac_address, status, assigned_subscriber_id, notes, source)
       VALUES($1, NULL, $2, $3, 'ASSIGNED', $4, $5, 'ONU_IMPORT') RETURNING id`,
      [itemId, serial, mac, onu.subscriber_id, note]
    );
    serialId = ins.rows[0].id;
    createdSerial = true;
  }

  // Back-reference on the ONU row
  await pool.query(`UPDATE onus SET inventory_serial_id=$2, updated_at=now() WHERE id=$1`, [onuId, serialId]);

  // 3) Find or create subscriber_equipment (type=ONU)
  let createdEquip = false;
  const foundEquip = await pool.query(
    `SELECT id FROM subscriber_equipment WHERE onu_id=$1 OR (subscriber_id=$2 AND serial_number=$3) LIMIT 1`,
    [onuId, onu.subscriber_id, serial]
  );
  if (foundEquip.rows[0]) {
    await pool.query(
      `UPDATE subscriber_equipment SET inventory_serial_id=$2, onu_id=$3, equipment_type='ONU',
         mac_address=COALESCE($4, mac_address), status=COALESCE(NULLIF($5,''),'INSTALLED'), updated_at=now() WHERE id=$1`,
      [foundEquip.rows[0].id, serialId, onuId, mac, 'INSTALLED']
    );
  } else {
    await pool.query(
      `INSERT INTO subscriber_equipment(subscriber_id, equipment_type, serial_number, mac_address, inventory_serial_id, onu_id, status, installed_at, notes)
       VALUES($1, 'ONU', $2, $3, $4, $5, 'INSTALLED', now(), $6)`,
      [onu.subscriber_id, serial, mac, serialId, onuId, note]
    );
    createdEquip = true;
  }

  return {
    onu_id: onuId,
    subscriber_id: onu.subscriber_id,
    item_id: itemId!,
    serial_id: serialId,
    created: { item: createdItem, serial: createdSerial, equipment: createdEquip },
  };
}

/** Bulk sync: all ONUs that are linked to a subscriber but not yet imported. */
export async function syncAllLinkedOnusToInventory(opts?: { limit?: number }): Promise<{ synced: OnvInventorySyncResult[]; checked: number; skipped: number }> {
  const limit = Math.max(1, Math.min(Number(opts?.limit || 500), 2000));
  const rows = (await pool.query(
    `SELECT o.id FROM onus o
     WHERE o.subscriber_id IS NOT NULL
       AND (o.inventory_serial_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM inventory_serials s WHERE s.id=o.inventory_serial_id))
     ORDER BY o.updated_at DESC NULLS LAST LIMIT $1`,
    [limit]
  )).rows;
  const synced: OnvInventorySyncResult[] = [];
  let skipped = 0;
  for (const row of rows) {
    try {
      const res = await syncOnuToInventory(row.id);
      if (res) synced.push(res); else skipped++;
    } catch (e) {
      skipped++;
    }
  }
  // Also re-sync already-linked ONUs whose subscriber changed
  const stale = (await pool.query(
    `SELECT o.id FROM onus o JOIN inventory_serials s ON s.id=o.inventory_serial_id
     WHERE o.subscriber_id IS NOT NULL AND (s.assigned_subscriber_id IS DISTINCT FROM o.subscriber_id)
     LIMIT $1`,
    [limit]
  )).rows;
  for (const row of stale) {
    try {
      const res = await syncOnuToInventory(row.id);
      if (res) synced.push(res);
    } catch {}
  }
  return { synced, checked: rows.length + stale.length, skipped };
}
