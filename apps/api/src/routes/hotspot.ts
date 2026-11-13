import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import crypto from 'crypto';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();
function guard(req:any,res:any, roles=['SUPER_ADMIN','BILLING_OPERATOR','RESELLER']){ if(!roles.includes(String((req as any).user?.role||''))){ res.status(403).json({message:'Forbidden'}); return false;} return true; }
function makeCode(){ return crypto.randomBytes(4).toString('hex').toUpperCase(); }

router.get('/vouchers', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const { status, batch_no, q } = req.query as any;
  const where:string[]=[]; const params:any[]=[];
  if(status){ params.push(status); where.push(`v.status=$${params.length}`); }
  if(batch_no){ params.push(batch_no); where.push(`v.batch_no=$${params.length}`); }
  if(q){ params.push(`%${String(q).toLowerCase()}%`); where.push(`(lower(v.code) LIKE $${params.length} OR lower(COALESCE(v.plan_name,'')) LIKE $${params.length})`); }
  const sql=where.length?`WHERE ${where.join(' AND ')}`:'';
  const r=await pool.query(`SELECT v.*, s.full_name as subscriber_name, s.client_code, res.name as reseller_name
    FROM hotspot_vouchers v LEFT JOIN subscribers s ON s.id=v.subscriber_id LEFT JOIN resellers res ON res.id=v.reseller_id
    ${sql} ORDER BY v.created_at DESC LIMIT 2000`, params);
  res.json({ok:true,data:r.rows});
}));

router.post('/vouchers/generate', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return; const b=req.body||{}; const count=Math.min(1000, Math.max(1, Number(b.count||1)));
  const batch = b.batch_no || `BATCH-${Date.now()}`; const rows:any[]=[];
  for(let i=0;i<count;i++){
    const code = b.prefix ? `${b.prefix}${makeCode()}` : makeCode()+makeCode().slice(0,4);
    const r=await pool.query(`INSERT INTO hotspot_vouchers(batch_no,code,plan_name,package_name,price,duration_hours,data_limit_mb,status,reseller_id,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,'AVAILABLE',$8,$9) RETURNING *`,
      [batch, code, b.plan_name||null, b.package_name||null, Number(b.price||0), b.duration_hours?Number(b.duration_hours):null, b.data_limit_mb?Number(b.data_limit_mb):null, b.reseller_id||null, b.notes||null]);
    rows.push(r.rows[0]);
  }
  await auditLog({ ...reqActor(req), action:'HOTSPOT_VOUCHERS_GENERATE', entity_type:'hotspot_batch', entity_id:batch, details:{count,batch} });
  res.status(201).json({ok:true,batch_no:batch,count:rows.length,data:rows});
}));

router.post('/vouchers/:id/sell', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','RESELLER'])) return; const b=req.body||{};
  const r=await pool.query(`UPDATE hotspot_vouchers SET status='SOLD', sold_at=now(), subscriber_id=$2, reseller_id=COALESCE($3,reseller_id), notes=COALESCE($4,notes) WHERE id=$1 AND status='AVAILABLE' RETURNING *`,
    [req.params.id, b.subscriber_id||null, b.reseller_id||null, b.notes||null]);
  if(!r.rows[0]) return res.status(400).json({message:'Voucher not available or not found'});
  const v=r.rows[0];
  if(Number(v.price||0)>0){
    await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,method,amount,currency,reference_type,reference_id,subscriber_id,reseller_id,description,created_by) VALUES(CURRENT_DATE,'INCOME',$1,$2,'BDT','VOUCHER',$3,$4,$5,$6,$7)`,
      [b.method||'CASH', Number(v.price||0), v.id, v.subscriber_id||null, v.reseller_id||null, `Hotspot voucher sold ${v.code}`, (req as any).user?.email||'user']).catch(()=>{});
  }
  await auditLog({ ...reqActor(req), action:'HOTSPOT_VOUCHER_SELL', entity_type:'hotspot_voucher', entity_id:v.id, details:{code:v.code,price:v.price} });
  res.json({ok:true,data:v});
}));

router.post('/vouchers/:id/activate', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{};
  const v0=(await pool.query('SELECT * FROM hotspot_vouchers WHERE id=$1',[req.params.id])).rows[0]; if(!v0) return res.status(404).json({message:'Not found'});
  const hours = Number(b.duration_hours || v0.duration_hours || 24);
  const r=await pool.query(`UPDATE hotspot_vouchers SET status='ACTIVE', activated_at=now(), expires_at=now() + ($2 || ' hours')::interval, subscriber_id=COALESCE($3,subscriber_id), mac_address=COALESCE($4,mac_address) WHERE id=$1 RETURNING *`,
    [req.params.id, String(hours), b.subscriber_id||null, b.mac_address||null]);
  await auditLog({ ...reqActor(req), action:'HOTSPOT_VOUCHER_ACTIVATE', entity_type:'hotspot_voucher', entity_id:req.params.id, details:{hours} });
  res.json({ok:true,data:r.rows[0], sync:{ attempted:false, note:'RADIUS/hotspot profile sync hook: integrate with router/NAS or external hotspot controller for live enforcement.' }});
}));

router.post('/vouchers/:id/expire', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const r=await pool.query(`UPDATE hotspot_vouchers SET status='EXPIRED' WHERE id=$1 RETURNING *`, [req.params.id]);
  if(!r.rows[0]) return res.status(404).json({message:'Not found'});
  res.json({ok:true,data:r.rows[0]});
}));

router.get('/summary', asyncHandler(async (_req,res)=>{
  const r=await pool.query(`SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status='AVAILABLE')::int as available, COUNT(*) FILTER (WHERE status='SOLD')::int as sold,
    COUNT(*) FILTER (WHERE status='ACTIVE')::int as active, COUNT(*) FILTER (WHERE status='USED')::int as used, COUNT(*) FILTER (WHERE status='EXPIRED')::int as expired,
    COALESCE(SUM(price) FILTER (WHERE status IN ('SOLD','ACTIVE','USED')),0)::numeric(14,2) as revenue FROM hotspot_vouchers`);
  res.json({ok:true,data:r.rows[0]});
}));

router.get('/reconciliation', asyncHandler(async (_req,res)=>{
  const [sum, byBatch, finance] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int total, COALESCE(SUM(price) FILTER (WHERE status IN ('SOLD','ACTIVE','USED')),0)::numeric(14,2) sold_value FROM hotspot_vouchers`),
    pool.query(`SELECT batch_no, COUNT(*)::int count, COALESCE(SUM(price) FILTER (WHERE status IN ('SOLD','ACTIVE','USED')),0)::numeric(14,2) sold_value FROM hotspot_vouchers GROUP BY batch_no ORDER BY MIN(created_at) DESC LIMIT 50`),
    pool.query(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) as income FROM finance_transactions WHERE reference_type='VOUCHER' AND txn_type='INCOME'`),
  ]);
  res.json({ok:true,data:{ summary:sum.rows[0], finance_voucher_income:finance.rows[0]?.income||0, batches:byBatch.rows }});
}));

export default router;
