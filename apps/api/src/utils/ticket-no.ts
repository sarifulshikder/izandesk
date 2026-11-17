import { pool } from '../db';

/** Returns a unique, gap-tolerant ticket number from a database sequence.
 *  Shared by the admin ticket route and the reseller complaint route so
 *  concurrent creates can never produce the same TKT-######## value. */
export async function nextTicketNo(): Promise<string> {
  const r = await pool.query("SELECT nextval('ticket_no_seq') AS n");
  return `TKT-${String(r.rows[0].n).padStart(6, '0')}`;
}
