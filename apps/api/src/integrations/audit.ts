import { pool } from '../db';

export async function auditLog(entry: { actor_id?: any; actor_name?: any; actor_role?: any; action: string; entity_type?: any; entity_id?: any; details?: any; ip_address?: any }) {
  try {
    await pool.query(`INSERT INTO audit_logs(actor_id,actor_name,actor_role,action,entity_type,entity_id,details,ip_address)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [entry.actor_id||null, entry.actor_name||null, entry.actor_role||null, entry.action, entry.entity_type||null, entry.entity_id||null, JSON.stringify(entry.details||{}), entry.ip_address||null]);
  } catch {}
}

export function reqActor(req:any){ return { actor_id: req?.user?.id, actor_name: req?.user?.name || req?.user?.email, actor_role: req?.user?.role, ip_address: req?.ip || req?.headers?.['x-forwarded-for'] || null }; }
