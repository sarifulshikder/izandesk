import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();
function guard(req:any,res:any, roles=['SUPER_ADMIN','BILLING_OPERATOR']){ if(!roles.includes(String((req as any).user?.role||''))){ res.status(403).json({message:'Forbidden'}); return false;} return true; }

router.get('/employees', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','TECHNICIAN','NOC_ENGINEER'])) return;
  const r=await pool.query('SELECT * FROM hr_employees ORDER BY created_at DESC');
  res.json({ok:true,data:r.rows});
}));
router.post('/employees', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN'])) return;
  const b=req.body||{}; if(!b.full_name) return res.status(400).json({message:'full_name required'});
  const code=b.employee_code || `EMP-${Date.now().toString().slice(-6)}`;
  const r=await pool.query(`INSERT INTO hr_employees(employee_code,full_name,designation,department,role,phone,email,nid_number,address,joining_date,status,base_salary,commission_percent,meta)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
    [code,b.full_name,b.designation||null,b.department||null,b.role||null,b.phone||null,b.email||null,b.nid_number||null,b.address||null,b.joining_date||null,b.status||'ACTIVE',Number(b.base_salary||0),Number(b.commission_percent||0),JSON.stringify(b.meta||{})]);
  await auditLog({ ...reqActor(req), action:'HR_EMPLOYEE_CREATE', entity_type:'hr_employee', entity_id:r.rows[0].id, details:{code,name:b.full_name} });
  res.status(201).json({ok:true,data:r.rows[0]});
}));
router.put('/employees/:id', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN'])) return; const b=req.body||{};
  const r=await pool.query(`UPDATE hr_employees SET full_name=COALESCE($1,full_name),designation=$2,department=$3,role=$4,phone=$5,email=$6,nid_number=$7,address=$8,joining_date=$9,status=COALESCE($10,status),base_salary=COALESCE($11,base_salary),commission_percent=COALESCE($12,commission_percent),meta=COALESCE($13::jsonb,meta),updated_at=now() WHERE id=$14 RETURNING *`,
    [b.full_name??null,b.designation??null,b.department??null,b.role??null,b.phone??null,b.email??null,b.nid_number??null,b.address??null,b.joining_date??null,b.status??null,b.base_salary!=null?Number(b.base_salary):null,b.commission_percent!=null?Number(b.commission_percent):null,b.meta?JSON.stringify(b.meta):null,req.params.id]);
  if(!r.rows[0]) return res.status(404).json({message:'Not found'});
  await auditLog({ ...reqActor(req), action:'HR_EMPLOYEE_UPDATE', entity_type:'hr_employee', entity_id:r.rows[0].id });
  res.json({ok:true,data:r.rows[0]});
}));

router.get('/attendance', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const { from,to,employee_id } = req.query as any; const where:string[]=[]; const params:any[]=[];
  if(from){ params.push(from); where.push(`a.att_date >= $${params.length}::date`); }
  if(to){ params.push(to); where.push(`a.att_date <= $${params.length}::date`); }
  if(employee_id){ params.push(employee_id); where.push(`a.employee_id=$${params.length}`); }
  const sql=where.length?`WHERE ${where.join(' AND ')}`:'';
  const r=await pool.query(`SELECT a.*, e.full_name, e.employee_code, e.department, e.designation FROM hr_attendance a JOIN hr_employees e ON e.id=a.employee_id ${sql} ORDER BY a.att_date DESC, e.full_name LIMIT 1000`, params);
  res.json({ok:true,data:r.rows});
}));
router.post('/attendance', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN'])) return; const b=req.body||{}; if(!b.employee_id||!b.att_date) return res.status(400).json({message:'employee_id and att_date required'});
  const r=await pool.query(`INSERT INTO hr_attendance(employee_id,att_date,status,check_in,check_out,notes) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (employee_id, att_date) DO UPDATE SET status=EXCLUDED.status, check_in=COALESCE(EXCLUDED.check_in,hr_attendance.check_in), check_out=COALESCE(EXCLUDED.check_out,hr_attendance.check_out), notes=COALESCE(EXCLUDED.notes,hr_attendance.notes) RETURNING *`,
    [b.employee_id,b.att_date,b.status||'PRESENT',b.check_in||null,b.check_out||null,b.notes||null]);
  await auditLog({ ...reqActor(req), action:'HR_ATTENDANCE_MARK', entity_type:'hr_attendance', entity_id:r.rows[0].id, details:{employee_id:b.employee_id,date:b.att_date,status:b.status} });
  res.json({ok:true,data:r.rows[0]});
}));

router.get('/leaves', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const r=await pool.query(`SELECT l.*, e.full_name, e.employee_code FROM hr_leaves l JOIN hr_employees e ON e.id=l.employee_id ORDER BY l.from_date DESC, l.created_at DESC LIMIT 500`);
  res.json({ok:true,data:r.rows});
}));
router.post('/leaves', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','TECHNICIAN'])) return;
  const b=req.body||{}; if(!b.employee_id||!b.from_date||!b.to_date) return res.status(400).json({message:'employee_id, from_date, to_date required'});
  const days = Number(b.days || 1);
  const r=await pool.query(`INSERT INTO hr_leaves(employee_id,leave_type,from_date,to_date,days,status,reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.employee_id,b.leave_type||'CASUAL',b.from_date,b.to_date,days,b.status||'PENDING',b.reason||null]);
  await auditLog({ ...reqActor(req), action:'HR_LEAVE_REQUEST', entity_type:'hr_leave', entity_id:r.rows[0].id, details:{employee_id:b.employee_id,from:b.from_date,to:b.to_date} });
  res.status(201).json({ok:true,data:r.rows[0]});
}));
router.put('/leaves/:id', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN'])) return; const b=req.body||{};
  const r=await pool.query(`UPDATE hr_leaves SET status=COALESCE($1,status), approved_by=$2, reason=COALESCE($3,reason) WHERE id=$4 RETURNING *`,
    [b.status??null,(req as any).user?.email||null,b.reason??null,req.params.id]);
  if(!r.rows[0]) return res.status(404).json({message:'Not found'});
  await auditLog({ ...reqActor(req), action:'HR_LEAVE_UPDATE', entity_type:'hr_leave', entity_id:r.rows[0].id, details:{status:r.rows[0].status} });
  res.json({ok:true,data:r.rows[0]});
}));

async function calcCommission(employeeId:string, periodMonth:string){
  // best-effort: sum completed payments linked via field activities collections in period OR 0
  const r = await pool.query(`SELECT COALESCE(SUM(amount),0) as amt FROM field_activities WHERE employee_id=$1 AND activity_type='COLLECTION' AND status='DONE' AND to_char(COALESCE(completed_at,created_at),'YYYY-MM')=$2`, [employeeId, periodMonth]).catch(()=>({rows:[{amt:0}]}));
  return Number(r.rows[0]?.amt||0);
}

router.get('/payroll/runs', asyncHandler(async (req,res)=>{ if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return; const r=await pool.query('SELECT * FROM hr_payroll_runs ORDER BY period_month DESC, created_at DESC'); res.json({ok:true,data:r.rows}); }));
router.post('/payroll/runs', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN'])) return; const b=req.body||{}; if(!b.period_month) return res.status(400).json({message:'period_month (YYYY-MM) required'});
  const emp = await pool.query("SELECT id, base_salary, commission_percent FROM hr_employees WHERE status='ACTIVE'");
  const items:any[]=[]; let total=0;
  for(const e of emp.rows||[]){
    const base=Number(e.base_salary||0);
    const collected = await calcCommission(e.id, b.period_month);
    const commission = Math.round(collected * Number(e.commission_percent||0)) / 100;
    const bonus=Number(b.default_bonus||0), deductions=Number(b.default_deductions||0);
    const net = base + commission + bonus - deductions; total += net;
    items.push({ employee_id:e.id, base_salary:base, commission, bonus, deductions, net_pay:net, components:{ collected, commission_percent:Number(e.commission_percent||0) } });
  }
  const run = await pool.query(`INSERT INTO hr_payroll_runs(period_month,status,total_amount,notes,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`, [b.period_month,'DRAFT',total,b.notes||null,(req as any).user?.email||'user']);
  const rid = run.rows[0].id;
  for(const it of items){ await pool.query(`INSERT INTO hr_payroll_items(payroll_run_id,employee_id,base_salary,commission,bonus,deductions,net_pay,components) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [rid,it.employee_id,it.base_salary,it.commission,it.bonus,it.deductions,it.net_pay,JSON.stringify(it.components||{})]); }
  const det = await pool.query(`SELECT i.*, e.full_name, e.employee_code, e.designation, e.department FROM hr_payroll_items i JOIN hr_employees e ON e.id=i.employee_id WHERE i.payroll_run_id=$1 ORDER BY e.full_name`, [rid]);
  await auditLog({ ...reqActor(req), action:'HR_PAYROLL_CREATE', entity_type:'hr_payroll_run', entity_id:rid, details:{period:b.period_month,total} });
  res.status(201).json({ok:true,data:{...run.rows[0], items: det.rows}});
}));
router.get('/payroll/runs/:id', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const run = (await pool.query('SELECT * FROM hr_payroll_runs WHERE id=$1',[req.params.id])).rows[0]; if(!run) return res.status(404).json({message:'Not found'});
  const items = await pool.query(`SELECT i.*, e.full_name, e.employee_code, e.designation, e.department, e.phone, e.email FROM hr_payroll_items i JOIN hr_employees e ON e.id=i.employee_id WHERE i.payroll_run_id=$1 ORDER BY e.full_name`, [run.id]);
  res.json({ok:true,data:{...run, items: items.rows}});
}));
router.get('/payroll/runs/:id/payslips', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const run = (await pool.query('SELECT * FROM hr_payroll_runs WHERE id=$1',[req.params.id])).rows[0]; if(!run) return res.status(404).json({message:'Not found'});
  const items = await pool.query(`SELECT i.*, e.full_name, e.employee_code, e.designation, e.department FROM hr_payroll_items i JOIN hr_employees e ON e.id=i.employee_id WHERE i.payroll_run_id=$1 ORDER BY e.full_name`, [run.id]);
  const payslips = items.rows.map((i:any)=>({ period: run.period_month, status: run.status, employee:{ id:i.employee_id, name:i.full_name, code:i.employee_code, designation:i.designation, department:i.department }, earnings:{ base_salary:i.base_salary, commission:i.commission, bonus:i.bonus }, deductions:{ total:i.deductions }, net_pay:i.net_pay, components:i.components||{} }));
  res.json({ok:true,data:{ run, payslips }});
}));
router.post('/payroll/runs/:id/post', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN'])) return;
  const r=await pool.query(`UPDATE hr_payroll_runs SET status='POSTED', posted_at=now() WHERE id=$1 RETURNING *`, [req.params.id]); if(!r.rows[0]) return res.status(404).json({message:'Not found'});
  const run=r.rows[0];
  await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,amount,currency,reference_type,reference_id,description,created_by) VALUES(CURRENT_DATE,'EXPENSE',$1,'BDT','PAYROLL',$2,$3,$4)`,
    [Number(run.total_amount||0), run.id, `Payroll posted for ${run.period_month}`, (req as any).user?.email||'user']).catch(()=>{});
  await auditLog({ ...reqActor(req), action:'HR_PAYROLL_POST', entity_type:'hr_payroll_run', entity_id:run.id, details:{period:run.period_month,total:run.total_amount} });
  res.json({ok:true,data:r.rows[0]});
}));

export default router;
