import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();
function guard(req:any,res:any, roles=['SUPER_ADMIN','BILLING_OPERATOR']){ if(!roles.includes(String((req as any).user?.role||''))){ res.status(403).json({message:'Forbidden'}); return false;} return true; }

router.get('/vendors', asyncHandler(async (req,res)=>{ if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return; const r=await pool.query('SELECT * FROM vendors ORDER BY created_at DESC'); res.json({ok:true,data:r.rows}); }));
router.post('/vendors', asyncHandler(async (req,res)=>{ if(!guard(req,res)) return; const b=req.body||{}; if(!b.name) return res.status(400).json({message:'name required'}); const r=await pool.query('INSERT INTO vendors(name,company_name,phone,email,address,category,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.name,b.company_name||null,b.phone||null,b.email||null,b.address||null,b.category||null,b.status||'ACTIVE']); await auditLog({ ...reqActor(req), action:'VENDOR_CREATE', entity_type:'vendor', entity_id:r.rows[0].id, details:{name:b.name} }); res.status(201).json({ok:true,data:r.rows[0]}); }));
router.put('/vendors/:id', asyncHandler(async (req,res)=>{ if(!guard(req,res)) return; const b=req.body||{}; const r=await pool.query('UPDATE vendors SET name=COALESCE($1,name),company_name=$2,phone=$3,email=$4,address=$5,category=$6,status=COALESCE($7,status) WHERE id=$8 RETURNING *',[b.name??null,b.company_name??null,b.phone??null,b.email??null,b.address??null,b.category??null,b.status??null,req.params.id]); if(!r.rows[0]) return res.status(404).json({message:'Not found'}); res.json({ok:true,data:r.rows[0]}); }));

router.get('/purchases', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const r=await pool.query(`SELECT p.*, v.name as vendor_name, w.name as warehouse_name FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN inventory_warehouses w ON w.id=p.warehouse_id ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT 500`);
  res.json({ok:true,data:r.rows});
}));
router.get('/purchases/:id', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const p=(await pool.query('SELECT * FROM purchases WHERE id=$1',[req.params.id])).rows[0]; if(!p) return res.status(404).json({message:'Not found'});
  const items=await pool.query('SELECT * FROM purchase_items WHERE purchase_id=$1 ORDER BY id',[p.id]);
  res.json({ok:true,data:{...p, items: items.rows}});
}));
router.post('/purchases', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{}; const items=Array.isArray(b.items)?b.items:[]; if(!items.length) return res.status(400).json({message:'items required'});
  const purchaseNo=b.purchase_no || `PO-${Date.now()}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
  let subtotal=0; for(const it of items){ subtotal += Number(it.qty||0)*Number(it.unit_cost||0); }
  const tax=Number(b.tax||0); const total=subtotal+tax;
  const pr=await pool.query(`INSERT INTO purchases(purchase_no,vendor_id,warehouse_id,purchase_date,status,subtotal,tax,total,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [purchaseNo,b.vendor_id||null,b.warehouse_id||null,b.purchase_date||new Date(),b.status||'DRAFT',subtotal,tax,total,b.notes||null,(req as any).user?.email||'user']);
  const pid=pr.rows[0].id;
  for(const it of items){ const qty=Number(it.qty||0), uc=Number(it.unit_cost||0); await pool.query(`INSERT INTO purchase_items(purchase_id,item_name,category,sku,qty,unit_cost,total_cost,inventory_item_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [pid,it.item_name||'Item',it.category||null,it.sku||null,qty,uc,qty*uc,it.inventory_item_id||null]); }
  await auditLog({ ...reqActor(req), action:'PURCHASE_CREATE', entity_type:'purchase', entity_id:pid, details:{purchase_no:purchaseNo,total} });
  res.status(201).json({ok:true,data:pr.rows[0]});
}));

router.post('/purchases/:id/receive', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const p=(await pool.query('SELECT * FROM purchases WHERE id=$1',[req.params.id])).rows[0]; if(!p) return res.status(404).json({message:'Not found'});
  if (String(p.status).toUpperCase()==='RECEIVED') return res.json({ok:true,data:p,duplicate:true});
  const items=(await pool.query('SELECT * FROM purchase_items WHERE purchase_id=$1',[p.id])).rows;
  // stock-in: if inventory_item_id present and warehouse known, create serial-less stock records by inserting inventory_serials as IN_STOCK with generated serials for countable items? easier: update/create inventory_items quantities not modeled; fallback: create inventory_serials entries per qty when item_id exists
  for(const it of items){
    const qty = Math.max(0, Math.floor(Number(it.qty||0)));
    if (it.inventory_item_id && qty>0) {
      for(let i=0;i<qty;i++){
        await pool.query(`INSERT INTO inventory_serials(item_id,warehouse_id,serial_number,status,notes) VALUES($1,$2,$3,'IN_STOCK',$4)`,
          [it.inventory_item_id, p.warehouse_id||null, `${p.purchase_no}-${it.id}-${i+1}-${Math.random().toString(36).slice(2,5).toUpperCase()}`, `Received from purchase ${p.purchase_no}`]).catch(()=>{});
      }
    }
  }
  const r=await pool.query(`UPDATE purchases SET status='RECEIVED' WHERE id=$1 RETURNING *`,[req.params.id]);
  await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,amount,currency,reference_type,reference_id,vendor_id,description,created_by) VALUES(CURRENT_DATE,'EXPENSE',$1,'BDT','PURCHASE',$2,$3,$4,$5)`,
    [Number(r.rows[0].total||0), r.rows[0].id, r.rows[0].vendor_id||null, `Purchase received ${r.rows[0].purchase_no}`, (req as any).user?.email||'user']).catch(()=>{});
  await auditLog({ ...reqActor(req), action:'PURCHASE_RECEIVE', entity_type:'purchase', entity_id:r.rows[0].id, details:{purchase_no:r.rows[0].purchase_no,stocked:items.length} });
  res.json({ok:true,data:r.rows[0]});
}));

router.get('/assets', asyncHandler(async (req,res)=>{ if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return; const r=await pool.query(`SELECT a.*, v.name as vendor_name, e.full_name as assigned_employee_name FROM assets a LEFT JOIN vendors v ON v.id=a.vendor_id LEFT JOIN hr_employees e ON e.id=a.assigned_to_employee_id ORDER BY a.created_at DESC`); res.json({ok:true,data:r.rows}); }));
router.post('/assets', asyncHandler(async (req,res)=>{ if(!guard(req,res)) return; const b=req.body||{}; if(!b.name) return res.status(400).json({message:'name required'}); const tag=b.asset_tag||`AST-${Date.now().toString().slice(-6)}`; const cost=Number(b.cost||0); const r=await pool.query(`INSERT INTO assets(asset_tag,name,category,vendor_id,purchase_id,purchase_date,cost,current_value,status,location,assigned_to_employee_id,notes,depreciation_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [tag,b.name,b.category||null,b.vendor_id||null,b.purchase_id||null,b.purchase_date||null,cost,Number(b.current_value||cost),b.status||'ACTIVE',b.location||null,b.assigned_to_employee_id||null,b.notes||null,Number(b.depreciation_rate||0)]); await auditLog({ ...reqActor(req), action:'ASSET_CREATE', entity_type:'asset', entity_id:r.rows[0].id, details:{tag,name:b.name} }); res.status(201).json({ok:true,data:r.rows[0]}); }));
router.put('/assets/:id', asyncHandler(async (req,res)=>{ if(!guard(req,res)) return; const b=req.body||{}; const r=await pool.query(`UPDATE assets SET name=COALESCE($1,name),category=$2,status=COALESCE($3,status),location=$4,current_value=COALESCE($5,current_value),assigned_to_employee_id=$6,notes=$7,depreciation_rate=COALESCE($8,depreciation_rate) WHERE id=$9 RETURNING *`, [b.name??null,b.category??null,b.status??null,b.location??null,b.current_value!=null?Number(b.current_value):null,b.assigned_to_employee_id??null,b.notes??null,b.depreciation_rate!=null?Number(b.depreciation_rate):null,req.params.id]); if(!r.rows[0]) return res.status(404).json({message:'Not found'}); res.json({ok:true,data:r.rows[0]}); }));

router.post('/assets/depreciate/run', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN'])) return;
  const period = String((req.body||{}).period_month || new Date().toISOString().slice(0,7));
  const assets = await pool.query(`SELECT * FROM assets WHERE status='ACTIVE' AND COALESCE(depreciation_rate,0)>0 AND cost>0`);
  let updated=0; let totalDep=0;
  for(const a of assets.rows){
    const rate = Number(a.depreciation_rate||0)/100/12; // monthly straight-line %
    const dep = Math.max(0, Math.min(Number(a.current_value||0), Number(a.cost||0)*rate));
    if(!(dep>0)) continue;
    const newVal = Math.max(0, Number(a.current_value||0)-dep); const acc = Number(a.accumulated_depreciation||0)+dep;
    await pool.query(`UPDATE assets SET current_value=$2, accumulated_depreciation=$3, last_depreciated_at=now() WHERE id=$1`, [a.id, newVal, acc]);
    updated++; totalDep += dep;
  }
  if(totalDep>0){ await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,amount,currency,reference_type,reference_id,description,created_by) VALUES(CURRENT_DATE,'EXPENSE',$1,'BDT','DEPRECIATION',$2,$3,$4)`, [totalDep, period, `Asset depreciation ${period} (${updated} assets)`, (req as any).user?.email||'user']).catch(()=>{}); }
  await auditLog({ ...reqActor(req), action:'ASSET_DEPRECIATION_RUN', entity_type:'assets', details:{period,updated,total:totalDep} });
  res.json({ok:true,period,updated,total_depreciation:totalDep});
}));

export default router;
