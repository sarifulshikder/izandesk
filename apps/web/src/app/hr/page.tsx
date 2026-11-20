'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plus, UsersRound } from 'lucide-react';

function money(v:any){ const n=Number(v||0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function HrPage() {
  const { token, user } = useAuth();
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const isAdmin = String(user?.role) === 'SUPER_ADMIN';
  const canManage = ['SUPER_ADMIN','BILLING_OPERATOR','TECHNICIAN'].includes(String(user?.role));

  const [emp, setEmp] = useState<any>({ full_name:'', designation:'', department:'', phone:'', email:'', base_salary:'', commission_percent:'', status:'ACTIVE' });
  const [att, setAtt] = useState<any>({ employee_id:'', att_date: new Date().toISOString().slice(0,10), status:'PRESENT', notes:'' });
  const [leave, setLeave] = useState<any>({ employee_id:'', leave_type:'CASUAL', from_date: new Date().toISOString().slice(0,10), to_date: new Date().toISOString().slice(0,10), reason:'' });
  const [period, setPeriod] = useState<string>(new Date().toISOString().slice(0,7));

  const load = useCallback(async () => {
    if (!token) return; setLoading(true); setErr(null);
    try {
      const [e,a,l,r] = await Promise.all([
        apiFetch<any>('/api/hr/employees', {}, token),
        apiFetch<any>('/api/hr/attendance', {}, token),
        apiFetch<any>('/api/hr/leaves', {}, token).catch(()=>({data:[]})),
        apiFetch<any>('/api/hr/payroll/runs', {}, token),
      ]);
      setEmployees(e.data||[]); setAttendance(a.data||[]); setLeaves(l.data||[]); setRuns(r.data||[]);
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(()=>{ load(); }, [load]);

  const addEmployee = async () => { if(!token) return; setErr(null); try { await apiFetch('/api/hr/employees', { method:'POST', body: JSON.stringify({ ...emp, base_salary:Number(emp.base_salary||0), commission_percent:Number(emp.commission_percent||0) }) }, token); setMsg('Employee added'); setEmp({ full_name:'', designation:'', department:'', phone:'', email:'', base_salary:'', commission_percent:'', status:'ACTIVE' }); await load(); } catch(e:any){ setErr(e.message);} };
  const markAttendance = async () => { if(!token) return; setErr(null); try { await apiFetch('/api/hr/attendance', { method:'POST', body: JSON.stringify(att) }, token); setMsg('Attendance saved'); await load(); } catch(e:any){ setErr(e.message);} };
  const requestLeave = async () => { if(!token) return; setErr(null); try { await apiFetch('/api/hr/leaves', { method:'POST', body: JSON.stringify(leave) }, token); setMsg('Leave request submitted'); await load(); } catch(e:any){ setErr(e.message);} };
  const updateLeave = async (id:string,status:string) => { if(!token) return; try { await apiFetch(`/api/hr/leaves/${id}`, { method:'PUT', body: JSON.stringify({status}) }, token); await load(); } catch(e:any){ setErr(e.message);} };
  const createRun = async () => { if(!token) return; setErr(null); try { const r=await apiFetch<any>('/api/hr/payroll/runs', { method:'POST', body: JSON.stringify({ period_month: period }) }, token); setSelectedRun(r.data); setMsg(`Payroll draft created for ${period} (commissions auto-calculated from completed field collections)`); await load(); } catch(e:any){ setErr(e.message);} };
  const viewRun = async (id:string) => { if(!token) return; try { const r=await apiFetch<any>(`/api/hr/payroll/runs/${id}`, {}, token); setSelectedRun(r.data); } catch(e:any){ setErr(e.message);} };
  const viewPayslips = async (id:string) => { if(!token) return; try { const r=await apiFetch<any>(`/api/hr/payroll/runs/${id}/payslips`, {}, token); setSelectedRun({ ...r.data.run, items: r.data.payslips?.map((p:any)=>({ employee_id:p.employee.id, full_name:p.employee.name, employee_code:p.employee.code, designation:p.employee.designation, department:p.employee.department, base_salary:p.earnings.base_salary, commission:p.earnings.commission, bonus:p.earnings.bonus, deductions:p.deductions.total, net_pay:p.net_pay, components:p.components }))||[], payslips:true }); } catch(e:any){ setErr(e.message);} };
  const postRun = async (id:string) => { if(!token) return; try { await apiFetch(`/api/hr/payroll/runs/${id}/post`, { method:'POST' }, token); setMsg('Payroll posted (salary expense recorded)'); await viewRun(id); await load(); } catch(e:any){ setErr(e.message);} };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div><span className="page-eyebrow">People operations · HR &amp; payroll</span><h1 className="page-title"><UsersRound className="w-6 h-6 text-primary"/>HR &amp; Payroll</h1><p className="page-subtitle">Employees, attendance, leave, commissions and payroll (Phase 7).</p></div>
        <div className="page-actions"><button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button></div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Employees">
            <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Code</th><th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Designation</th><th className="px-3 py-2.5">Dept</th><th className="px-3 py-2.5">Salary</th><th className="px-3 py-2.5">Comm%</th><th className="px-3 py-2.5">Status</th></tr></thead>
              <tbody>{employees.map(e=>(<tr key={e.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] font-mono">{e.employee_code}</td><td className="px-3 py-2.5 text-[11px] font-medium">{e.full_name}<div className="text-muted-foreground">{e.phone||e.email||''}</div></td><td className="px-3 py-2.5 text-[11px]">{e.designation||'-'}</td><td className="px-3 py-2.5 text-[11px]">{e.department||'-'}</td><td className="px-3 py-2.5 text-[11px] tabular-nums">{money(e.base_salary)}</td><td className="px-3 py-2.5 text-[11px] tabular-nums">{Number(e.commission_percent||0)}%</td><td className="px-3 py-2.5 text-[11px]">{e.status}</td></tr>))}{!employees.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No employees.</td></tr>}</tbody>
            </table>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel title="Attendance (recent)">
              <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Employee</th><th className="px-3 py-2.5">Status</th></tr></thead>
                <tbody>{attendance.slice(0,50).map(a=>(<tr key={a.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px]">{String(a.att_date).slice(0,10)}</td><td className="px-3 py-2.5 text-[11px]">{a.full_name}</td><td className="px-3 py-2.5 text-[11px]">{a.status}</td></tr>))}{!attendance.length && <tr><td colSpan={3} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No attendance records.</td></tr>}</tbody>
              </table>
            </Panel>
            <Panel title="Leave Requests">
              <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Employee</th><th className="px-3 py-2.5">Period</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Action</th></tr></thead>
                <tbody>{leaves.map(l=>(<tr key={l.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px]">{l.full_name}<div className="text-muted-foreground">{l.leave_type}</div></td><td className="px-3 py-2.5 text-[11px]">{String(l.from_date).slice(0,10)}→{String(l.to_date).slice(0,10)}</td><td className="px-3 py-2.5 text-[11px]">{l.status}</td><td className="px-3 py-2.5 text-[11px] space-x-1">{isAdmin && l.status==='PENDING' && <><button onClick={()=>updateLeave(l.id,'APPROVED')} className="btn btn-success btn-sm">Approve</button><button onClick={()=>updateLeave(l.id,'REJECTED')} className="btn btn-outline btn-sm">Reject</button></>}</td></tr>))}{!leaves.length && <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No leave requests.</td></tr>}</tbody>
              </table>
            </Panel>
          </div>

          <div className="card p-4">
            <h2 className="font-bold mb-3">Payroll Runs</h2>
            <div className="table-wrap overflow-auto max-h-[260px]">
              <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Period</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Total</th><th className="px-3 py-2.5">Actions</th></tr></thead>
                <tbody>{runs.map(r=>(<tr key={r.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] font-medium">{r.period_month}</td><td className="px-3 py-2.5 text-[11px]">{r.status}</td><td className="px-3 py-2.5 text-[11px] font-semibold tabular-nums">{money(r.total_amount)}</td><td className="px-3 py-2.5 text-[11px] space-x-2"><button onClick={()=>viewRun(r.id)} className="btn btn-outline btn-sm">View</button><button onClick={()=>viewPayslips(r.id)} className="btn btn-outline btn-sm">Payslips</button>{isAdmin && r.status!=='POSTED' && <button onClick={()=>postRun(r.id)} className="btn btn-primary btn-sm">Post</button>}</td></tr>))}{!runs.length && <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No payroll runs.</td></tr>}</tbody>
              </table>
            </div>
            {selectedRun && (
              <div className="card card-body-sm mt-4">
                <div className="font-semibold mb-2">Run {selectedRun.period_month} • {selectedRun.status} • {money(selectedRun.total_amount)} {selectedRun.payslips?'• Payslips':''}</div>
                <div className="table-wrap overflow-auto max-h-56"><table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Base</th><th className="px-3 py-2">Comm</th><th className="px-3 py-2">Bonus</th><th className="px-3 py-2">Deduct</th><th className="px-3 py-2">Net</th></tr></thead><tbody>{(selectedRun.items||[]).map((i:any)=>(<tr key={i.id||i.employee_id} className="border-b border-border/50"><td className="px-3 py-2 text-[11px]">{i.full_name}</td><td className="px-3 py-2 text-[11px] tabular-nums">{money(i.base_salary)}</td><td className="px-3 py-2 text-[11px] tabular-nums">{money(i.commission)}</td><td className="px-3 py-2 text-[11px] tabular-nums">{money(i.bonus)}</td><td className="px-3 py-2 text-[11px] tabular-nums">{money(i.deductions)}</td><td className="px-3 py-2 text-[11px] font-semibold tabular-nums">{money(i.net_pay)}</td></tr>))}</tbody></table></div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <FormCard title="Add Employee" onSubmit={addEmployee} disabled={!isAdmin || !emp.full_name} btn="Add Employee">
            <input placeholder="Full name" className="form-control" value={emp.full_name} onChange={e=>setEmp({...emp,full_name:e.target.value})} />
            <input placeholder="Designation" className="form-control" value={emp.designation} onChange={e=>setEmp({...emp,designation:e.target.value})} />
            <input placeholder="Department" className="form-control" value={emp.department} onChange={e=>setEmp({...emp,department:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input placeholder="Phone" className="form-control" value={emp.phone} onChange={e=>setEmp({...emp,phone:e.target.value})} /><input placeholder="Email" className="form-control" value={emp.email} onChange={e=>setEmp({...emp,email:e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Base salary" className="form-control" value={emp.base_salary} onChange={e=>setEmp({...emp,base_salary:e.target.value})} /><input type="number" placeholder="Commission %" className="form-control" value={emp.commission_percent} onChange={e=>setEmp({...emp,commission_percent:e.target.value})} /></div>
          </FormCard>
          <FormCard title="Mark Attendance" onSubmit={markAttendance} disabled={!isAdmin || !att.employee_id} btn="Save Attendance">
            <select className="form-select" value={att.employee_id} onChange={e=>setAtt({...att,employee_id:e.target.value})}><option value="">Select employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}</select>
            <input type="date" className="form-control" value={att.att_date} onChange={e=>setAtt({...att,att_date:e.target.value})} />
            <select className="form-select" value={att.status} onChange={e=>setAtt({...att,status:e.target.value})}>{['PRESENT','ABSENT','LEAVE','HALF_DAY'].map(x=><option key={x} value={x}>{x}</option>)}</select>
          </FormCard>
          <FormCard title="Leave Request" onSubmit={requestLeave} disabled={!canManage || !leave.employee_id} btn="Submit Leave">
            <select className="form-select" value={leave.employee_id} onChange={e=>setLeave({...leave,employee_id:e.target.value})}><option value="">Employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select>
            <select className="form-select" value={leave.leave_type} onChange={e=>setLeave({...leave,leave_type:e.target.value})}>{['CASUAL','SICK','ANNUAL','UNPAID'].map(x=><option key={x} value={x}>{x}</option>)}</select>
            <div className="grid grid-cols-2 gap-2"><input type="date" className="form-control" value={leave.from_date} onChange={e=>setLeave({...leave,from_date:e.target.value})} /><input type="date" className="form-control" value={leave.to_date} onChange={e=>setLeave({...leave,to_date:e.target.value})} /></div>
            <input placeholder="Reason" className="form-control" value={leave.reason} onChange={e=>setLeave({...leave,reason:e.target.value})} />
          </FormCard>
          <div className="card p-4 space-y-3"><h2 className="font-bold">Create Payroll Run</h2><input type="month" className="form-control" value={period} onChange={e=>setPeriod(e.target.value)} /><button onClick={createRun} disabled={!isAdmin || !period} className="btn btn-primary w-full">Generate Draft Run</button><div className="text-xs text-muted-foreground">Draft uses base salary + commission% of completed field collections for the period. Posting records salary expense.</div></div>
        </div>
      </div>
    </div>
  );
}

function Panel({title,children}:any){ return <div className="card p-4"><h2 className="card-title mb-3">{title}</h2><div className="table-wrap overflow-auto max-h-[320px]">{children}</div></div>; }
function FormCard({title,onSubmit,disabled,btn,children}:any){ return <div className="card p-4 space-y-3"><h2 className="card-title"><Plus className="w-4 h-4 text-primary"/>{title}</h2><div className="space-y-2 text-sm">{children}</div><button onClick={onSubmit} disabled={disabled} className="btn btn-primary w-full">{btn||'Save'}</button></div>; }
