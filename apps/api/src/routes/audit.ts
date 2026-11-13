import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();
function guard(req:any,res:any){ if(!['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER','TECHNICIAN'].includes(String((req as any).user?.role||''))){ res.status(403).json({message:'Forbidden'}); return false;} return true; }

router.get('/', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const { entity_type, entity_id, action, q } = req.query as any;
  const where:string[]=[]; const params:any[]=[];
  if(entity_type){ params.push(entity_type); where.push(`entity_type=$${params.length}`); }
  if(entity_id){ params.push(entity_id); where.push(`entity_id=$${params.length}`); }
  if(action){ params.push(action); where.push(`action=$${params.length}`); }
  if(q){ params.push(`%${String(q).toLowerCase()}%`); where.push(`(lower(COALESCE(action,'')) LIKE $${params.length} OR lower(COALESCE(actor_name,'')) LIKE $${params.length} OR lower(COALESCE(entity_type,'')) LIKE $${params.length})`); }
  const sql=where.length?`WHERE ${where.join(' AND ')}`:'';
  const r=await pool.query(`SELECT * FROM audit_logs ${sql} ORDER BY created_at DESC LIMIT 1000`, params);
  res.json({ok:true,data:r.rows});
}));

router.post('/', asyncHandler(async (req,res)=>{
  const b=req.body||{}; if(!b.action) return res.status(400).json({message:'action required'});
  await auditLog({ ...reqActor(req), actor_name: b.actor_name, actor_role: b.actor_role, action: b.action, entity_type: b.entity_type, entity_id: b.entity_id, details: b.details||{} });
  res.status(201).json({ok:true});
}));

// Field activities (field/agent workflows)
router.get('/field-activities', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const r=await pool.query(`SELECT f.*, e.full_name as employee_name, s.full_name as subscriber_name, s.client_code, t.ticket_no
    FROM field_activities f LEFT JOIN hr_employees e ON e.id=f.employee_id LEFT JOIN subscribers s ON s.id=f.subscriber_id LEFT JOIN tickets t ON t.id=f.ticket_id
    ORDER BY COALESCE(f.scheduled_at,f.created_at) DESC LIMIT 1000`);
  res.json({ok:true,data:r.rows});
}));
router.post('/field-activities', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const b=req.body||{}; if(!b.activity_type) return res.status(400).json({message:'activity_type required'});
  const r=await pool.query(`INSERT INTO field_activities(activity_type,employee_id,subscriber_id,ticket_id,reseller_id,scheduled_at,status,amount,proof_ref,latitude,longitude,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [b.activity_type,b.employee_id||null,b.subscriber_id||null,b.ticket_id||null,b.reseller_id||null,b.scheduled_at||null,b.status||'PLANNED',b.amount!=null?Number(b.amount):null,b.proof_ref||null,b.latitude??null,b.longitude??null,b.notes||null]);
  await auditLog({ ...reqActor(req), action:'FIELD_ACTIVITY_CREATE', entity_type:'field_activity', entity_id:r.rows[0].id, details:{type:b.activity_type,status:r.rows[0].status} });
  res.status(201).json({ok:true,data:r.rows[0]});
}));
router.put('/field-activities/:id', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{};
  const r=await pool.query(`UPDATE field_activities SET status=COALESCE($1,status), completed_at=$2, amount=COALESCE($3,amount), proof_ref=$4, notes=COALESCE($5,notes), latitude=COALESCE($6,latitude), longitude=COALESCE($7,longitude) WHERE id=$8 RETURNING *`,
    [b.status??null,b.completed_at|| (b.status==='DONE'? new Date(): null), b.amount!=null?Number(b.amount):null, b.proof_ref??null,b.notes??null,b.latitude??null,b.longitude??null,req.params.id]);
  if(!r.rows[0]) return res.status(404).json({message:'Not found'});
  await auditLog({ ...reqActor(req), action:'FIELD_ACTIVITY_UPDATE', entity_type:'field_activity', entity_id:r.rows[0].id, details:{status:r.rows[0].status} });
  res.json({ok:true,data:r.rows[0]});
}));

export default router;
