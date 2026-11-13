import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();
function okRole(req:any, roles:string[]) { return roles.includes(String((req as any).user?.role||'')); }
function guard(req:any,res:any, roles=['SUPER_ADMIN','BILLING_OPERATOR']){ if(!okRole(req,roles)){ res.status(403).json({message:'Forbidden'}); return false;} return true; }

async function createJournal(opts:{ date?:any; description?:string; source_type?:string; source_id?:string; created_by?:string; lines: Array<{account_id?:string|null; debit?:number; credit?:number; memo?:string}> }) {
  const no = `JE-${Date.now()}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
  const je = await pool.query(`INSERT INTO finance_journal_entries(entry_no,entry_date,description,source_type,source_id,posted,created_by) VALUES($1,$2,$3,$4,$5,true,$6) RETURNING *`,
    [no, opts.date||new Date(), opts.description||null, opts.source_type||null, opts.source_id||null, opts.created_by||null]);
  const id = je.rows[0].id;
  for (const l of opts.lines||[]) {
    const d = Number(l.debit||0), c = Number(l.credit||0);
    if (!(d>0 || c>0)) continue;
    await pool.query(`INSERT INTO finance_journal_lines(entry_id,account_id,debit,credit,memo) VALUES($1,$2,$3,$4,$5)`, [id, l.account_id||null, d, c, l.memo||null]);
  }
  return je.rows[0];
}

async function accountIdByCode(code:string){ const r=await pool.query('SELECT id FROM finance_accounts WHERE code=$1 LIMIT 1',[code]); return r.rows[0]?.id || null; }

router.get('/accounts', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const r = await pool.query(`SELECT a.*, COALESCE(j.debit,0)::numeric(14,2) as total_debit, COALESCE(j.credit,0)::numeric(14,2) as total_credit,
    (COALESCE(j.debit,0)-COALESCE(j.credit,0))::numeric(14,2) as balance
    FROM finance_accounts a
    LEFT JOIN (SELECT account_id, SUM(debit) debit, SUM(credit) credit FROM finance_journal_lines GROUP BY account_id) j ON j.account_id=a.id
    ORDER BY a.code NULLS LAST, a.name`);
  res.json({ ok:true, data:r.rows });
}));
router.post('/accounts', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{}; if(!b.name) return res.status(400).json({message:'name required'});
  const r=await pool.query(`INSERT INTO finance_accounts(code,name,type,parent_id,is_active,meta) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`, [b.code||null,b.name,b.type||'ASSET',b.parent_id||null,b.is_active!==false, JSON.stringify(b.meta||{})]);
  await auditLog({ ...reqActor(req), action:'FINANCE_ACCOUNT_CREATE', entity_type:'finance_account', entity_id:r.rows[0].id, details:{code:r.rows[0].code,name:r.rows[0].name} });
  res.status(201).json({ok:true,data:r.rows[0]});
}));
router.put('/accounts/:id', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{};
  const r=await pool.query(`UPDATE finance_accounts SET code=COALESCE($1,code),name=COALESCE($2,name),type=COALESCE($3,type),parent_id=$4,is_active=COALESCE($5,is_active),meta=COALESCE($6::jsonb,meta),updated_at=now() WHERE id=$7 RETURNING *`,
    [b.code??null,b.name??null,b.type??null,b.parent_id??null,b.is_active, b.meta?JSON.stringify(b.meta):null, req.params.id]);
  if(!r.rows[0]) return res.status(404).json({message:'Not found'});
  await auditLog({ ...reqActor(req), action:'FINANCE_ACCOUNT_UPDATE', entity_type:'finance_account', entity_id:r.rows[0].id });
  res.json({ok:true,data:r.rows[0]});
}));

router.get('/transactions', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const { from, to, type, account_id, q } = req.query as any;
  const where:string[]=[]; const params:any[]=[];
  if(from){ params.push(from); where.push(`t.txn_date >= $${params.length}::date`); }
  if(to){ params.push(to); where.push(`t.txn_date <= $${params.length}::date`); }
  if(type){ params.push(type); where.push(`t.txn_type = $${params.length}`); }
  if(account_id){ params.push(account_id); where.push(`(t.account_id=$${params.length} OR t.counter_account_id=$${params.length})`); }
  if(q){ params.push(`%${String(q).toLowerCase()}%`); where.push(`(lower(COALESCE(t.description,'')) LIKE $${params.length} OR lower(COALESCE(t.reference_id,'')) LIKE $${params.length})`); }
  const sql = where.length?`WHERE ${where.join(' AND ')}`:'';
  const r=await pool.query(`SELECT t.*, a.name as account_name, ca.name as counter_account_name, s.full_name as subscriber_name, s.client_code, e.full_name as employee_name
    FROM finance_transactions t LEFT JOIN finance_accounts a ON a.id=t.account_id LEFT JOIN finance_accounts ca ON ca.id=t.counter_account_id
    LEFT JOIN subscribers s ON s.id=t.subscriber_id LEFT JOIN hr_employees e ON e.id=t.employee_id
    ${sql} ORDER BY t.txn_date DESC, t.created_at DESC LIMIT 1000`, params);
  res.json({ ok:true, data:r.rows });
}));

router.post('/transactions', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{}; const amount = Number(b.amount||0);
  if(!(amount>0) || !b.txn_type) return res.status(400).json({message:'txn_type and positive amount required'});
  const r=await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,account_id,counter_account_id,method,amount,currency,reference_type,reference_id,subscriber_id,reseller_id,vendor_id,employee_id,description,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [b.txn_date||new Date(), b.txn_type, b.account_id||null, b.counter_account_id||null, b.method||null, amount, b.currency||'BDT', b.reference_type||'MANUAL', b.reference_id||null, b.subscriber_id||null, b.reseller_id||null, b.vendor_id||null, b.employee_id||null, b.description||null, (req as any).user?.email||'user']);
  // auto journal (double-entry-lite) if accounts provided
  if (b.account_id || b.counter_account_id) {
    const debitAcc = ['EXPENSE','PAYMENT','TRANSFER'].includes(b.txn_type) ? b.account_id : b.account_id; // best-effort
    const creditAcc = b.counter_account_id || null;
    if (debitAcc && creditAcc) {
      await createJournal({ date:b.txn_date, description:b.description||b.txn_type, source_type:'TRANSACTION', source_id:r.rows[0].id, created_by:(req as any).user?.email, lines:[{account_id:debitAcc,debit:amount,memo:'debit'},{account_id:creditAcc,credit:amount,memo:'credit'}] });
    }
  }
  await auditLog({ ...reqActor(req), action:'FINANCE_TXN_CREATE', entity_type:'finance_transaction', entity_id:r.rows[0].id, details:{type:b.txn_type,amount} });
  res.status(201).json({ok:true,data:r.rows[0]});
}));

router.get('/vouchers', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const r=await pool.query('SELECT * FROM finance_vouchers ORDER BY date DESC, created_at DESC LIMIT 500');
  res.json({ok:true,data:r.rows});
}));
router.post('/vouchers', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{}; const amount=Number(b.amount||0); if(!(amount>0)||!b.voucher_type) return res.status(400).json({message:'voucher_type and amount required'});
  const voucherNo = b.voucher_no || `VCH-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const r=await pool.query(`INSERT INTO finance_vouchers(voucher_no,voucher_type,date,party_type,party_id,amount,method,narration,status,lines,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
    [voucherNo,b.voucher_type,b.date||new Date(),b.party_type||null,b.party_id||null,amount,b.method||null,b.narration||null,b.status||'POSTED',JSON.stringify(b.lines||[]),(req as any).user?.email||'user']);
  // auto post to transactions/journal
  const ttype = b.voucher_type==='RECEIPT' ? 'INCOME' : (b.voucher_type==='PAYMENT' ? 'EXPENSE' : 'ADJUSTMENT');
  await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,method,amount,currency,reference_type,reference_id,description,created_by) VALUES($1,$2,$3,$4,$5,'VOUCHER',$6,$7,$8)`,
    [b.date||new Date(), ttype, b.method||null, amount, 'BDT', r.rows[0].id, b.narration||`${b.voucher_type} voucher ${voucherNo}`, (req as any).user?.email||'user']).catch(()=>{});
  const cashAcc = await accountIdByCode(b.method==='BANK'?'1010':(String(b.method||'').match(/BKASH|NAGAD|ROCKET/i)?'1020':'1000'));
  const revAcc = await accountIdByCode(ttype==='INCOME'?'4000':'5000');
  if (cashAcc && revAcc) {
    const lines = ttype==='INCOME' ? [{account_id:cashAcc,debit:amount},{account_id:revAcc,credit:amount}] : [{account_id:revAcc,debit:amount},{account_id:cashAcc,credit:amount}];
    await createJournal({ date:b.date, description:b.narration||voucherNo, source_type:'VOUCHER', source_id:r.rows[0].id, created_by:(req as any).user?.email, lines }).catch(()=>{});
  }
  await auditLog({ ...reqActor(req), action:'FINANCE_VOUCHER_POST', entity_type:'finance_voucher', entity_id:r.rows[0].id, details:{voucher_no:voucherNo,amount} });
  res.status(201).json({ok:true,data:r.rows[0]});
}));

router.get('/journals', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const entries = await pool.query('SELECT * FROM finance_journal_entries ORDER BY entry_date DESC, created_at DESC LIMIT 300');
  const ids = entries.rows.map((e:any)=>e.id);
  let lines:any[] = [];
  if (ids.length) { const lr = await pool.query(`SELECT l.*, a.code, a.name as account_name FROM finance_journal_lines l LEFT JOIN finance_accounts a ON a.id=l.account_id WHERE l.entry_id = ANY($1::uuid[]) ORDER BY l.entry_id, l.id`, [ids]); lines = lr.rows; }
  const by = new Map<string, any[]>(); for (const l of lines){ const arr=by.get(l.entry_id)||[]; arr.push(l); by.set(l.entry_id,arr); }
  const data = entries.rows.map((e:any)=>({ ...e, lines: by.get(e.id)||[] }));
  res.json({ok:true,data});
}));

router.get('/ledger', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const { account_id, from, to } = req.query as any;
  const params:any[]=[]; const where:string[]=[];
  if(account_id){ params.push(account_id); where.push(`l.account_id=$${params.length}`); }
  if(from){ params.push(from); where.push(`e.entry_date >= $${params.length}::date`); }
  if(to){ params.push(to); where.push(`e.entry_date <= $${params.length}::date`); }
  const sql = where.length?`WHERE ${where.join(' AND ')}`:'';
  const r = await pool.query(`SELECT e.entry_no,e.entry_date,e.description,e.source_type,e.source_id,l.debit,l.credit,l.memo,a.code as account_code,a.name as account_name
    FROM finance_journal_lines l JOIN finance_journal_entries e ON e.id=l.entry_id LEFT JOIN finance_accounts a ON a.id=l.account_id
    ${sql} ORDER BY e.entry_date DESC, e.created_at DESC, l.id DESC LIMIT 1000`, params);
  res.json({ok:true,data:r.rows});
}));

router.get('/reconciliation', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const [payments, txns, unmatched] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) completed, COUNT(*)::int count FROM payments WHERE status='COMPLETED'`),
    pool.query(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) collected, COUNT(*)::int count FROM finance_transactions WHERE txn_type IN ('INCOME','COLLECTION')`),
    pool.query(`SELECT p.id,p.payment_ref,p.amount,p.gateway,p.status,p.trx_id,p.created_at FROM payments p
      LEFT JOIN finance_transactions t ON t.reference_id = p.payment_ref OR t.reference_id = p.id::text
      WHERE p.status='COMPLETED' AND t.id IS NULL ORDER BY p.created_at DESC LIMIT 100`),
  ]);
  res.json({ ok:true, data:{ completed_payments: payments.rows[0], finance_collections: txns.rows[0], unmatched_completed_payments: unmatched.rows } });
}));

router.get('/summary', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'])) return;
  const { from, to } = req.query as any;
  const where:string[]=[]; const params:any[]=[];
  if(from){ params.push(from); where.push(`txn_date >= $${params.length}::date`); }
  if(to){ params.push(to); where.push(`txn_date <= $${params.length}::date`); }
  const sql = where.length?`WHERE ${where.join(' AND ')}`:'';
  const totals = await pool.query(`
    SELECT COALESCE(SUM(amount) FILTER (WHERE txn_type IN ('INCOME','COLLECTION')),0)::numeric(14,2) as income,
      COALESCE(SUM(amount) FILTER (WHERE txn_type IN ('EXPENSE','PAYMENT')),0)::numeric(14,2) as expense,
      COALESCE(SUM(amount) FILTER (WHERE txn_type IN ('INCOME','COLLECTION')),0)::numeric(14,2) - COALESCE(SUM(amount) FILTER (WHERE txn_type IN ('EXPENSE','PAYMENT')),0)::numeric(14,2) as net
    FROM finance_transactions ${sql}`, params);
  let byMethodRows:any[]=[]; if(!sql){ const r=await pool.query(`SELECT COALESCE(method,'UNKNOWN') as method, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count FROM finance_transactions WHERE txn_type IN ('INCOME','COLLECTION') GROUP BY 1 ORDER BY total DESC`); byMethodRows=r.rows; }
  else { const r=await pool.query(`SELECT COALESCE(method,'UNKNOWN') as method, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count FROM finance_transactions ${sql} AND txn_type IN ('INCOME','COLLECTION') GROUP BY 1 ORDER BY total DESC`, params); byMethodRows=r.rows; }
  const dues = await pool.query(`SELECT COALESCE(SUM(due_amount),0)::numeric(14,2) as outstanding, COUNT(*)::int as due_invoices FROM invoices WHERE status IN ('UNPAID','PARTIAL','OVERDUE')`).catch(()=>({rows:[{outstanding:0,due_invoices:0}]}));
  res.json({ ok:true, totals: totals.rows[0], income_by_method: byMethodRows, dues: dues.rows[0] });
}));

function toCsv(rows:any[], cols:string[]){
  const esc=(v:any)=>{ const s=v==null?'':String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  return [cols.join(','), ...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\n');
}

router.get('/transactions/export.csv', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const r=await pool.query('SELECT txn_date,txn_type,method,amount,currency,reference_type,reference_id,description,created_by FROM finance_transactions ORDER BY txn_date DESC, created_at DESC LIMIT 5000');
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="finance-transactions.csv"');
  res.send(toCsv(r.rows,['txn_date','txn_type','method','amount','currency','reference_type','reference_id','description','created_by']));
}));

router.get('/ledger/export.csv', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const r=await pool.query(`SELECT e.entry_no,e.entry_date,a.code as account_code,a.name as account_name,l.debit,l.credit,l.memo,e.source_type,e.source_id,e.description FROM finance_journal_lines l JOIN finance_journal_entries e ON e.id=l.entry_id LEFT JOIN finance_accounts a ON a.id=l.account_id ORDER BY e.entry_date DESC, l.id DESC LIMIT 10000`);
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="finance-ledger.csv"');
  res.send(toCsv(r.rows,['entry_no','entry_date','account_code','account_name','debit','credit','memo','source_type','source_id','description']));
}));


router.post('/sync-payments', asyncHandler(async (req,res)=>{
  if(!guard(req,res,['SUPER_ADMIN','BILLING_OPERATOR'])) return;
  const unmatched = await pool.query(`SELECT p.* FROM payments p LEFT JOIN finance_transactions t ON t.reference_id = p.payment_ref OR t.reference_id = p.id::text
    WHERE p.status='COMPLETED' AND t.id IS NULL ORDER BY p.created_at ASC LIMIT 500`);
  let created=0;
  for(const p of unmatched.rows){
    const method = String(p.gateway||p.method||'CASH').toUpperCase();
    const accCode = method.includes('BANK')?'1010':(method.match(/BKASH|NAGAD|ROCKET|MFS/)?'1020':'1000');
    const cashAcc = await accountIdByCode(accCode);
    const revAcc = await accountIdByCode('4000');
    const tx = await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,method,amount,currency,reference_type,reference_id,subscriber_id,description,created_by)
      VALUES(COALESCE($1::date,CURRENT_DATE),'COLLECTION',$2,$3,$4,'PAYMENT',$5,$6,$7,$8) RETURNING id`,
      [p.verified_at||p.created_at, p.gateway||p.method||'CASH', Number(p.amount||0), p.currency||'BDT', p.payment_ref||p.id, p.subscriber_id||null, `Payment ${p.payment_ref||p.id} (${p.gateway||''}${p.trx_id?` ${p.trx_id}`:''})`, (req as any).user?.email||'system']);
    if(cashAcc && revAcc){
      await createJournal({ date:p.verified_at||p.created_at, description:`Payment ${p.payment_ref||p.id}`, source_type:'PAYMENT_SYNC', source_id:tx.rows[0]?.id||p.id, created_by:(req as any).user?.email, lines:[{account_id:cashAcc,debit:Number(p.amount||0)},{account_id:revAcc,credit:Number(p.amount||0)}] }).catch(()=>{});
    }
    created++;
  }
  await auditLog({ ...reqActor(req), action:'FINANCE_SYNC_PAYMENTS', entity_type:'payments', details:{created} });
  res.json({ok:true,created,checked:unmatched.rows.length});
}));

export default router;
