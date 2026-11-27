'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { parityTabs, ResellerParityPanel, type ParityTab } from '@/components/resellers/reseller-parity';
import { SubscriberFormWizard } from '@/components/subscribers/subscriber-form-wizard';
import {
  LayoutDashboard, Users, Wifi, Wallet, ArrowLeftRight, Receipt, RadioTower, RefreshCw,
  Search, ArrowUpRight, ArrowDownLeft, Building2, Plus, UserCheck,
  UserX, Clock3, Ban, Activity, Phone, Mail, CreditCard, ChevronRight, PlugZap, Eye,
  ScrollText, Download, MessageSquare, Send, X, Edit3, CalendarPlus, CheckSquare, Square, FileText, UserPlus, BarChart3, Trash2, AlertCircle, FileSpreadsheet, RefreshCcw, BellRing
} from 'lucide-react';

type AnyObj = Record<string, any>;
type PendingRecharge = { payment_ref: string; amount: number; gateway: string; at: string };
const money = (v: any) => `৳${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/* A reseller wallet RECHARGE credited by a verified gateway webhook carries metadata.payment_ref. */
const isRechargeCredited = (txs: any[], ref: string) => !!ref && (txs || []).some((t: any) =>
  String(t?.type || '').toUpperCase() === 'RECHARGE' &&
  (String(t?.metadata?.payment_ref || '') === ref ||
    (String(t?.created_by || '').toLowerCase() === 'gateway' && String(t?.description || '').toLowerCase().includes('gateway wallet recharge'))));
const dt = (v: any) => v ? new Date(v).toLocaleString() : '-';
const d = (v: any) => v ? new Date(v).toLocaleDateString() : '-';
const daysLeft = (v: any) => { if (!v) return null; const t = new Date(v).getTime(); if (isNaN(t)) return null; return Math.ceil((t - Date.now()) / 86400000); };
const gb = (v: any) => { const b = Number(v || 0); return b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${b} B`; };

const USER_COLS = ['customer', 'status', 'package', 'bill', 'expiry', 'contact', 'address', 'actions'] as const;
type UserCol = typeof USER_COLS[number];
const USER_COL_LABELS: Record<UserCol, string> = { customer: 'Customer', status: 'Status', package: 'Package', bill: 'Bill/Due', expiry: 'Expiry', contact: 'Contact', address: 'Address/Zone', actions: 'Actions' };

const tabs = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'sessions', label: 'Online Users', icon: Wifi },
  { key: 'balance', label: 'Balance Report', icon: Wallet },
  { key: 'sharing', label: 'Sharing Report', icon: ArrowLeftRight },
  { key: 'payments', label: 'Payments', icon: Receipt },
  { key: 'onus', label: 'ONU List', icon: RadioTower },
  { key: 'logs', label: 'Logs', icon: ScrollText },
  { key: 'notifications', label: 'Notifications', icon: BellRing },
  { key: 'branches', label: 'Branches', icon: Building2 },
  { key: 'complaints', label: 'Complaints', icon: AlertCircle },
  { key: 'parental', label: 'Parental Control', icon: Ban },
  ...parityTabs,
] as const;
type TabKey = typeof tabs[number]['key'];
const parityKeys = new Set<string>(parityTabs.map(t => t.key));

function Card({ label, value, icon: Icon, tone = 'default', sub, onClick }: { label: string; value: any; icon: any; tone?: string; sub?: string; onClick?: ()=>void }) {
  const tones: Record<string, string> = { default: 'primary', green: 'success', amber: 'warning', red: 'danger', blue: 'info', slate: 'secondary', purple: 'purple' };
  const C: any = onClick ? 'button' : 'div';
  return (<C onClick={onClick} className={`dash-stat dash-stat-${tones[tone] || tones.default}`}>
    <span className="dash-stat-icon"><Icon /></span>
    <span className="dash-stat-body">
      <span className="dash-stat-label">{label}</span>
      <span className="dash-stat-value">{value}</span>
      {sub && <span className="dash-stat-hint">{sub}</span>}
    </span>
  </C>);
}
function downloadCsv(filename: string, rows: AnyObj[]) {
  if (!rows || !rows.length) return;
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r || {}))));
  const esc = (v: any) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc((r as any)[c])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
const statusBadge = (s: any) => {
  const v = String(s || '').toUpperCase();
  const cls = v==='ACTIVE'||v==='COMPLETED'||v==='SUCCESS'||v==='PAID'||v==='EXECUTED'||v==='SENT'||v==='DELIVERED'||v==='ONLINE'||v==='RESOLVED'||v==='CLOSED' ? 'badge-success'
    : v==='EXPIRED'||v==='PENDING'||v==='VERIFYING'||v==='QUEUED' ? 'badge-warning'
    : v==='SUSPENDED'||v==='FAILED'||v==='CANCELLED'||v==='ERROR' ? 'badge-danger'
    : v==='OPEN'||v==='IN_PROGRESS' ? 'badge-info' : 'badge-secondary';
  return <span className={`badge ${cls}`}>{s || '-'}</span>;
};
function SimpleTable({ rows, cols, empty }: { rows: AnyObj[]; cols: [string,string][]; empty: string }) {
  if (!rows?.length) return <div className="text-xs text-muted-foreground py-6 text-center">{empty}</div>;
  return <div className="overflow-auto max-h-[360px]"><table className="w-full text-xs min-w-[520px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border">{cols.map(([label])=><th key={label} className="text-left py-2 px-2">{label}</th>)}</tr></thead><tbody>{rows.map((r:any,i:number)=><tr key={r.id || i} className="border-b border-border/50">{cols.map(([,key])=><td key={key} className="py-2 px-2 text-muted-foreground">{key.includes('at')||key.includes('time')||key.includes('start')||key.includes('stop') ? dt(r[key]) : String(r[key] ?? '-')}</td>)}</tr>)}</tbody></table></div>;
}
function MiniBars({ labels, values, colorClass }: { labels: string[]; values: number[]; colorClass: string }) {
  const max = Math.max(1, ...values.map(v => Number(v || 0)));
  return <div className="flex items-end gap-1.5 h-24">{values.map((v,i)=>(<div key={i} className="flex-1 flex flex-col items-center gap-1"><div className="w-full bg-muted/30 rounded-t relative flex items-end" style={{height: '72px'}}><div className={`w-full rounded-t ${colorClass}`} style={{height: `${Math.max(4, Math.round((Number(v||0)/max)*72))}px`}} title={`${labels[i]}: ${v}`} /></div><div className="text-[9px] text-muted-foreground truncate w-full text-center">{labels[i]?.slice(5) || labels[i]}</div></div>))}</div>;
}

export function ResellerPortal({ resellerId }: { resellerId: string }) {
  const { token, user } = useAuth();
  const [tab, setTabState] = useState<TabKey>('dashboard');
  const router = useRouter();
  const searchParams = useSearchParams();
  // Sidebar links use /resellers?tab=... — keep the portal tab in sync with the URL.
  const setTab = useCallback((t: TabKey) => {
    setTabState(t);
    const base = typeof window !== 'undefined' ? window.location.pathname : '/resellers';
    router.replace(t === 'dashboard' ? base : `${base}?tab=${t}`, { scroll: false });
  }, [router]);
  useEffect(() => {
    const t = searchParams.get('tab');
    setTabState(t && tabs.some(x => x.key === t) ? t as TabKey : 'dashboard');
  }, [searchParams]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<AnyObj | null>(null);
  const [charts, setCharts] = useState<AnyObj | null>(null);
  const [notifications, setNotifications] = useState<AnyObj[]>([]);
  const [bandwidth, setBandwidth] = useState<AnyObj[]>([]);
  const [history, setHistory] = useState<AnyObj | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState<AnyObj>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [widgets, setWidgets] = useState<Record<string, boolean>>(() => { try { const v = localStorage.getItem('resellerPortalWidgets'); return v ? JSON.parse(v) : { kpis:true, charts:true, profile:true, overview:true, alerts:true }; } catch { return { kpis:true, charts:true, profile:true, overview:true, alerts:true }; } });
  const [users, setUsers] = useState<AnyObj[]>([]);
  const [kycRows, setKycRows] = useState<AnyObj[]>([]);
  const [sessions, setSessions] = useState<AnyObj[]>([]);
  const [liveTraffic, setLiveTraffic] = useState(false);
  const [trafficHistory, setTrafficHistory] = useState<{ t: number; rx: number; tx: number }[]>([]);
  const [balance, setBalance] = useState<AnyObj | null>(null);
  const [sharing, setSharing] = useState<AnyObj[]>([]);
  const [payments, setPayments] = useState<AnyObj[]>([]);
  const [paySummary, setPaySummary] = useState<AnyObj>({});
  const [onus, setOnus] = useState<AnyObj[]>([]);
  const [onuAssign, setOnuAssign] = useState<Record<string, string>>({});
  const [showUnlinkedOnus, setShowUnlinkedOnus] = useState(false);
  const [onuFilters, setOnuFilters] = useState<Record<string, string>>({});
  const [showOnuFilters, setShowOnuFilters] = useState(false);
  const [logs, setLogs] = useState<AnyObj>({ audit: [], auth: [], wallet: [] });
  const [notifLog, setNotifLog] = useState<AnyObj[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [branches, setBranches] = useState<AnyObj[]>([]);
  const [branchForm, setBranchForm] = useState<AnyObj>({ name: '', code: '', address: '' });

  // Complaints (scoped tickets)
  const [complaints, setComplaints] = useState<AnyObj[]>([]);
  const [complaintFilters, setComplaintFilters] = useState<AnyObj>({ q: '', status: '' });
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [complaintForm, setComplaintForm] = useState<AnyObj>({ subscriber_id: '', subject: '', description: '', category: 'COMPLAINT', priority: 'MEDIUM' });
  const [complaintDetail, setComplaintDetail] = useState<AnyObj | null>(null);
  const [complaintComment, setComplaintComment] = useState('');
  const [complaintBusy, setComplaintBusy] = useState(false);

  // Parental control (scoped subscriber flag)
  const [parental, setParental] = useState<AnyObj[]>([]);
  const [parentalEnabledCount, setParentalEnabledCount] = useState(0);
  const [parentalFilters, setParentalFilters] = useState<AnyObj>({ q: '', enabled: '' });
  const [logQ, setLogQ] = useState('');
  const [logKind, setLogKind] = useState<'all' | 'wallet' | 'audit' | 'auth'>('all');
  const [logFilters, setLogFilters] = useState<Record<string, string>>({ from: '', to: '', event: '', manager: '', user: '', agent: '', ip: '' });
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<AnyObj | null>(null);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [userQ, setUserQ] = useState(''); const [userStatus, setUserStatus] = useState('');
  const [userFilters, setUserFilters] = useState<Record<string, string>>({});
  const [showUserFilters, setShowUserFilters] = useState(false);
  const [userLimit, setUserLimit] = useState('500');
  const [hiddenCols, setHiddenCols] = useState<Record<string, boolean>>(() => { try { const v = localStorage.getItem('resellerUserHiddenCols'); return v ? JSON.parse(v) : {}; } catch { return {}; } });
  const [colOrder, setColOrder] = useState<UserCol[]>(() => {
    try { const v = localStorage.getItem('resellerUserCols'); const p = v ? JSON.parse(v) : null; if (Array.isArray(p) && p.length === USER_COLS.length && USER_COLS.every(c => p.includes(c))) return p; } catch {}
    return [...USER_COLS];
  });
  const [dragCol, setDragCol] = useState<UserCol | null>(null);
  const visibleCols = colOrder.filter(c => !hiddenCols[c]);
  const [payKind, setPayKind] = useState<'all' | 'online' | 'invoice'>('all'); const [payQ, setPayQ] = useState(''); const [payStatus, setPayStatus] = useState(''); const [payGateway, setPayGateway] = useState(''); const [payMethod, setPayMethod] = useState(''); const [payType, setPayType] = useState(''); const [payApproval, setPayApproval] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState(''); const [showBalance, setShowBalance] = useState(false);
  // reseller self-service wallet recharge via payment gateway
  const [gwRechargeAmount, setGwRechargeAmount] = useState(''); const [gwName, setGwName] = useState('bkash'); const [gwBusy, setGwBusy] = useState(false);
  const [gateways, setGateways] = useState<any[]>([]);
  // gateway checkout return handling: PENDING recharges we started, credited only once a verified webhook credits the wallet
  const [pendingRecharges, setPendingRecharges] = useState<PendingRecharge[]>([]);
  const pendingRef = React.useRef<PendingRecharge[]>([]);
  const [topups, setTopups] = useState<AnyObj[]>([]);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupForm, setTopupForm] = useState<AnyObj>({ amount: '', gateway: 'bKash', method: 'Billpay', trx_id: '', payer_number: '', notes: '', terms_accepted: false });
  const [topupBusy, setTopupBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [, setMsgTarget] = useState<AnyObj | null>(null);
  const [, setMsgForm] = useState({ channel_type: 'SMS', provider: 'GREENWEB', to: '', subject: '', body: '', templateId: '' });
  const [templates, setTemplates] = useState<AnyObj[]>([]);
  const [, setSaveTplName] = useState('');
  const [, setBulkMsgReport] = useState<AnyObj[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [, setImportOpen] = useState(false);
  const [, setBulkEditOpen] = useState(false);
  const [, setBulkMode] = useState<'EDIT' | 'RENAME'>('EDIT');
  const [sessionSelected, setSessionSelected] = useState<Record<string, boolean>>({});

  const [viewUser, setViewUser] = useState<AnyObj | null>(null);
  const [customerDetail, setCustomerDetail] = useState<AnyObj | null>(null);
  const [detailTab, setDetailTab] = useState('basic');
  const [detailLoading, setDetailLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payMode, setPayMode] = useState<'PAY' | 'ADD'>('PAY');
  const [payForm, setPayForm] = useState<AnyObj>({ amount: '', payment_type: 'CASH', trx_id: '', notes: '' });
  const [payBusy, setPayBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnyObj | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [, setEditPay] = useState<AnyObj | null>(null);
  const [, setEditPayForm] = useState<AnyObj>({});
  const [wizard, setWizard] = useState<{ initial?: AnyObj } | null>(null);

  const reseller = dashboard?.reseller || balance?.reseller || null;
  const isResellerUser = user?.role === 'RESELLER';
  // Wallet credit is money: only admins may recharge. Reseller self-recharge must go through a payment gateway.
  const canRecharge = ['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role));
  const canMessage = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(String(user?.role));
  const canManageResellerUsers = ['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role));
  // Resellers may onboard their own subscribers — the API scopes them to this reseller.
  const canAddSubscriber = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'RESELLER'].includes(String(user?.role));

  // ---- reseller self-service recharge edge: surface credit_limit + buying margin ----
  const creditLimit = Number(reseller?.credit_limit ?? balance?.reseller?.credit_limit ?? 0) || 0;
  const creditLimitApplies = creditLimit > 0; // 0 = unlimited (backend rejects only when limit > 0 && newBalance > limit)
  const walletBalance = Number(balance?.balance ?? reseller?.wallet_balance ?? 0) || 0;
  const creditHeadroom = creditLimitApplies ? Math.max(0, +(creditLimit - walletBalance).toFixed(2)) : null;
  const marginPct = Math.min(100, Math.max(0, Number(reseller?.buying_margin_percent ?? balance?.reseller?.buying_margin_percent ?? 0) || 0)); // wholesale = retail × (1 − margin%); applies to SUBSCRIBER activation, not wallet recharge
  const walletTxs = (balance?.transactions || []) as any[];
  const pendingRechargeActive = pendingRecharges.filter(p => !isRechargeCredited(walletTxs, p.payment_ref));
  React.useEffect(() => { pendingRef.current = pendingRecharges; }, [pendingRecharges]);
  const pendingKey = `resellerWalletPending:${resellerId}`;
  const addPendingRecharge = (p: PendingRecharge) => setPendingRecharges(prev => [...prev.filter(x => x.payment_ref !== p.payment_ref), p]);
  const removePendingRecharge = (ref: string) => setPendingRecharges(prev => prev.filter(x => x.payment_ref !== ref));

  const loadDashboard = useCallback(async () => { if (!token) return; const [d,c,n,bw,h] = await Promise.all([
    apiFetch<any>(`/api/resellers/${resellerId}/dashboard`, {}, token),
    apiFetch<any>(`/api/resellers/${resellerId}/charts`, {}, token).catch(()=>({data:null})),
    apiFetch<any>(`/api/resellers/${resellerId}/notifications`, {}, token).catch(()=>({data:[]})),
    apiFetch<any>(`/api/resellers/${resellerId}/top-bandwidth`, {}, token).catch(()=>({data:[]})),
    apiFetch<any>(`/api/resellers/${resellerId}/history`, {}, token).catch(()=>({data:null})),
  ]); setDashboard(d.data); setCharts(c.data); setNotifications(n.data || []); setBandwidth(bw.data || []); setHistory(h.data || null); }, [token, resellerId]);
  useEffect(() => { if (!autoRefresh || tab !== 'dashboard') return; const t = setInterval(() => { loadDashboard().catch(()=>{}); }, 60000); return () => clearInterval(t); }, [autoRefresh, tab, loadDashboard]);
  useEffect(() => { try { localStorage.setItem('resellerPortalWidgets', JSON.stringify(widgets)); } catch {} }, [widgets]);
  useEffect(() => { try { localStorage.setItem('resellerUserCols', JSON.stringify(colOrder)); localStorage.setItem('resellerUserHiddenCols', JSON.stringify(hiddenCols)); } catch {} }, [colOrder, hiddenCols]);
  const saveLayout = async (layout: any) => { if (!token) return; try { await apiFetch(`/api/resellers/${resellerId}/layout`, { method: 'PUT', body: JSON.stringify(layout) }, token); } catch {} };
  useEffect(() => { if (!token) return; apiFetch<any>(`/api/resellers/${resellerId}/wallet/gateways`, {}, token).then((g: any) => { const arr = (g?.data || g || []); setGateways(Array.isArray(arr) ? arr : []); }).catch(() => {}); }, [token, resellerId]);
  const moveCol = (from: UserCol, to: UserCol) => {
    if (from === to) return;
    setColOrder(prev => { const next = [...prev]; next.splice(next.indexOf(from), 1); next.splice(next.indexOf(to), 0, from); saveLayout({ column_layout: { users: { order: next, hidden: hiddenCols } } }); return next; });
  };
  const resetLayout = () => { setColOrder([...USER_COLS]); setHiddenCols({}); saveLayout({ column_layout: { users: { order: [...USER_COLS], hidden: {} } } }); };
  const userCell = (col: UserCol, s: AnyObj) => {
    const left = daysLeft(s.expiry_date);
    const expSoon = left != null && left >= 0 && left <= 3;
    switch (col) {
      case 'customer': return <><div className="font-semibold">{s.full_name || '-'}</div><div className="text-muted-foreground font-mono">{s.client_code || s.username || '-'}</div><div className="text-muted-foreground">{s.username}</div></>;
      case 'status': return statusBadge(s.status);
      case 'package': return <><div>{s.package_name || '-'}</div><div className="text-muted-foreground">{s.connection_type || s.provisioning_mode || '-'}</div></>;
      case 'bill': return <><div>{money(s.monthly_bill)}</div><div className="text-warning font-semibold">Due {money(s.current_due)}</div></>;
      case 'expiry': return <><div className={expSoon ? 'text-warning font-semibold' : ''}>{d(s.expiry_date)}</div><div className="text-muted-foreground">{left==null?'': left<0?`${Math.abs(left)}d overdue`: `${left}d left`}</div></>;
      case 'contact': return <><div className="flex items-center gap-1"><Phone className="w-3 h-3" />{s.phone || '-'}</div><div className="flex items-center gap-1 text-muted-foreground truncate max-w-[180px]"><Mail className="w-3 h-3" />{s.email || '-'}</div></>;
      case 'address': return <><div className="truncate max-w-[200px]">{s.address || '-'}</div><div className="text-muted-foreground">{[s.zone,s.area].filter(Boolean).join(' / ') || '-'}</div></>;
      case 'actions': return <div className="flex flex-wrap gap-1.5">
        <div className="flex flex-col gap-0.5">
          <button disabled={actionBusy===`renew:${s.id}` || String(s.status||'').toUpperCase()!=='EXPIRED'} onClick={()=>renew(s.id)} className="btn btn-primary btn-sm" title={String(s.status||'').toUpperCase()!=='EXPIRED' ? 'Only expired subscribers can be activated from wallet' : 'Pay from wallet balance'}><CreditCard className="w-3 h-3" />{String(s.status||'').toUpperCase()==='EXPIRED' ? 'Pay from wallet / Activate' : 'Renew'}</button>
          {String(s.status||'').toUpperCase()==='EXPIRED' && (() => { const retail = Number(s.monthly_bill || 0); const est = +(retail * (1 - marginPct / 100)).toFixed(2) || retail; if (!(retail > 0)) return null; const short = est > 0 && walletBalance + 1e-9 < est; return <span className={`text-[10px] leading-tight ${short ? 'text-danger' : 'text-muted-foreground'}`} title="Wholesale = package retail × (1 − buying margin %); paid from your wallet">{money(est)} from wallet{retail !== est ? ` (retail ${money(retail)} − ${marginPct}% margin)` : ''}{short ? ` · insufficient (have ${money(walletBalance)})` : ''}</span>; })()}
        </div>
        <button onClick={()=>openView(s)} className="btn btn-outline btn-sm"><Eye className="w-3 h-3" />View</button>
        <button onClick={()=>openEdit(s)} className="btn btn-outline btn-sm"><Edit3 className="w-3 h-3" />Edit</button>
        {canAddSubscriber && <button disabled={!!actionBusy} onClick={()=>setDeleteTarget(s)} className="btn btn-outline btn-sm text-danger"><Trash2 className="w-3 h-3" />Delete</button>}
        <button disabled={actionBusy===`ext:${s.id}`} onClick={()=>extendExpiry(s,30)} className="btn btn-outline btn-sm disabled:opacity-50" title="Extend +30 days"><CalendarPlus className="w-3 h-3" />+30d</button>
        {String(s.status).toUpperCase()!=='ACTIVE' ? <button onClick={()=>batchStatus('activate',[s.id])} className="btn btn-success btn-sm">Activate</button> : <button onClick={()=>batchStatus('suspend',[s.id])} className="btn btn-danger btn-sm">Suspend</button>}
        {canMessage && <button onClick={()=>openMessage(s)} className="btn btn-outline btn-sm"><MessageSquare className="w-3 h-3" />Msg</button>}
        <button disabled={actionBusy===`ping:${s.id}`} onClick={()=>pingTarget(s)} className="btn btn-outline btn-sm disabled:opacity-50" title={s.ip_address ? `Ping ${s.ip_address}` : 'Ping (no IP)'}><Activity className="w-3 h-3" />Ping</button>
      </div>;
    }
  };
  const loadUsers = useCallback(async () => { if (!token) return; const qs = new URLSearchParams(); if (userQ) qs.set('q', userQ); if (userStatus) qs.set('status', userStatus); Object.entries(userFilters).forEach(([k, v]) => { if (v) qs.set(k, v); }); qs.set('limit', userLimit); const r = await apiFetch<any>(`/api/resellers/${resellerId}/users${qs.toString() ? `?${qs}` : ''}`, {}, token); setUsers(r.data || []); setSelected({}); }, [token, resellerId, userQ, userStatus, userFilters, userLimit]);
  const loadSessions = useCallback(async () => { if (!token) return; const r = await apiFetch<any>(`/api/resellers/${resellerId}/sessions`, {}, token); setSessions(r.data || []); setSessionSelected({}); }, [token, resellerId]);
  // Reseller-scoped, read-only KYC status. The API restricts rows to this
  // reseller's subscribers and never returns document images or approval actions.
  const loadKyc = useCallback(async () => { if (!token) return; try { const r = await apiFetch<any>('/api/kyc/queue?limit=100', {}, token); setKycRows(r.data || []); } catch { setKycRows([]); } }, [token]);
  const loadBalance = useCallback(async () => { if (!token) return; const r = await apiFetch<any>(`/api/resellers/${resellerId}/balance-report`, {}, token); setBalance(r.data); }, [token, resellerId]);
  // re-read server truth after a gateway return / window focus (wallet credited server-side only on verified webhook)
  const refreshWallet = useCallback(async () => { await Promise.all([loadBalance().catch(() => {}), loadDashboard().catch(() => {})]); }, [loadBalance, loadDashboard]);

  // hydrate + persist pending gateway recharges across redirects (checkout return handling)
  useEffect(() => { try { const raw = localStorage.getItem(pendingKey); if (raw) setPendingRecharges(JSON.parse(raw)); } catch {} }, [pendingKey]);
  useEffect(() => { try { localStorage.setItem(pendingKey, JSON.stringify(pendingRecharges)); } catch {} }, [pendingRecharges, pendingKey]);
  // prune pending entries once a verified gateway recharge has credited the wallet
  useEffect(() => {
    const txs = (balance?.transactions || []) as any[];
    setPendingRecharges(prev => {
      const next = prev.filter(p => !isRechargeCredited(txs, p.payment_ref));
      return next.length === prev.length ? prev : next;
    });
  }, [balance]);
  // gateway checkout RETURN handling + window-focus re-check. We always re-read server truth; never trust the return query, never claim credited before a verified webhook.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleReturn = async () => {
      const p = new URLSearchParams(window.location.search);
      const returned = (p.get('wallet_return') || p.get('bkash') || p.get('payment_status') || p.get('status') || '').toLowerCase();
      const retRef = p.get('payment_ref') || p.get('paymentID') || p.get('paymentId') || p.get('payment_id') || '';
      if (!returned && !retRef) return;
      await refreshWallet();
      if (/cancel|cancelled|canceled/.test(returned) || p.get('wallet_return') === 'cancel') setMsg('Payment cancelled. Nothing was credited; your wallet is unchanged. You can retry.');
      else if (/fail|error/.test(returned)) setMsg('Gateway returned an error. If you completed payment, your wallet updates once the verified confirmation arrives — Refresh status.');
      else setMsg('Returned from payment gateway. Wallet is credited only after verified confirmation — re-checking…');
    };
    // only re-check the wallet on focus/visibility when a payment is actually awaiting verification
    const onVisible = () => { if (document.visibilityState === 'visible' && pendingRef.current.length) refreshWallet(); };
    const onFocus = () => { if (pendingRef.current.length) refreshWallet(); };
    void handleReturn();
    window.addEventListener('focus', onFocus);
    window.addEventListener('popstate', handleReturn);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('popstate', handleReturn); document.removeEventListener('visibilitychange', onVisible); };
  }, [refreshWallet]);

  const loadTopups = useCallback(async () => { if (!token) return; try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/wallet/topups`, {}, token); setTopups(r.data || []); } catch {} }, [token, resellerId]);
  const submitTopup = async () => { if (!token) return; const amount = Number(topupForm.amount); if (!(amount > 0)) { setErr('Enter a valid amount'); return; } if (!topupForm.terms_accepted) { setErr('Please accept the terms and conditions'); return; } setTopupBusy(true); setErr(null); try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/wallet/topups`, { method: 'POST', body: JSON.stringify({ ...topupForm, amount }) }, token); setMsg(r.message || 'Top-up request submitted.'); setTopupOpen(false); setTopupForm({ amount: '', gateway: 'bKash', method: 'Billpay', trx_id: '', payer_number: '', notes: '', terms_accepted: false }); await loadTopups(); } catch (e: any) { setErr(e.message); } finally { setTopupBusy(false); } };
  const loadSharing = useCallback(async () => { if (!token) return; const r = await apiFetch<any>(`/api/resellers/${resellerId}/sharing-report`, {}, token); setSharing(r.data || []); }, [token, resellerId]);
  const loadPayments = useCallback(async () => { if (!token) return; const qs = new URLSearchParams({ kind: payKind }); if (payQ) qs.set('q', payQ); if (payStatus) qs.set('status', payStatus); if (payGateway) qs.set('gateway', payGateway); if (payMethod) qs.set('method', payMethod); if (payType) qs.set('payment_type', payType); if (payApproval) qs.set('approval', payApproval); const r = await apiFetch<any>(`/api/resellers/${resellerId}/payments?${qs.toString()}`, {}, token); setPayments(r.data || []); setPaySummary(r.summary || {}); }, [token, resellerId, payKind, payQ, payStatus, payGateway, payMethod, payType, payApproval]);
  const loadOnus = useCallback(async (unlinked = showUnlinkedOnus) => { if (!token) return; const qs = new URLSearchParams(); if (unlinked) qs.set('unlinked', '1'); Object.entries(onuFilters).forEach(([k, v]) => { if (v) qs.set(k, v); }); const r = await apiFetch<any>(`/api/resellers/${resellerId}/onus${qs.toString() ? `?${qs}` : ''}`, {}, token); const linked = r.data || []; const extra = r.unlinked || []; setOnus(unlinked ? [...linked, ...extra] : linked); }, [token, resellerId, showUnlinkedOnus, onuFilters]);
  const loadLogs = useCallback(async () => { if (!token) return; const qs = new URLSearchParams(); if (logQ) qs.set('q', logQ); if (logKind && logKind !== 'all') qs.set('kind', logKind); Object.entries(logFilters).forEach(([k,v]) => { if (v) qs.set(k, v); }); const r = await apiFetch<any>(`/api/resellers/${resellerId}/logs${qs.toString() ? `?${qs}` : ''}`, {}, token); setLogs(r.data || { audit: [], auth: [], wallet: [] }); }, [token, resellerId, logQ, logKind, logFilters]);
  const loadBranches = useCallback(async () => { if (!token) return; try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/branches`, {}, token); setBranches(r.data || []); } catch {} }, [token, resellerId]);
  const saveBranch = async () => { if (!token || !branchForm.name) return; try { await apiFetch(`/api/resellers/${resellerId}/branches`, { method: 'POST', body: JSON.stringify(branchForm) }, token); setBranchForm({ name: '', code: '', address: '' }); await loadBranches(); } catch (e: any) { setErr(e.message); } };
  const deleteBranch = async (id: string) => { if (!token) return; try { await apiFetch(`/api/resellers/${resellerId}/branches/${id}`, { method: 'DELETE' }, token); await loadBranches(); } catch (e: any) { setErr(e.message); } };

  const loadComplaints = useCallback(async () => {
    if (!token) return;
    const qs = new URLSearchParams();
    if (complaintFilters.q) qs.set('q', complaintFilters.q);
    if (complaintFilters.status) qs.set('status', complaintFilters.status);
    const r = await apiFetch<any>(`/api/resellers/${resellerId}/complaints${qs.toString() ? `?${qs}` : ''}`, {}, token);
    setComplaints(r.data || []);
  }, [token, resellerId, complaintFilters]);

  const openComplaint = async (id: string) => {
    if (!token) return;
    setComplaintBusy(true);
    try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/complaints/${id}`, {}, token); setComplaintDetail(r.data || null); setComplaintComment(''); }
    catch (e: any) { setErr(e.message); }
    finally { setComplaintBusy(false); }
  };

  const createComplaint = async () => {
    if (!token || !complaintForm.subject) { setErr('Subject is required'); return; }
    setComplaintBusy(true); setErr(null);
    try {
      await apiFetch(`/api/resellers/${resellerId}/complaints`, { method: 'POST', body: JSON.stringify(complaintForm) }, token);
      setMsg('Complaint filed. ISP support has been notified.');
      setComplaintOpen(false);
      setComplaintForm({ subscriber_id: '', subject: '', description: '', category: 'COMPLAINT', priority: 'MEDIUM' });
      await Promise.all([loadComplaints(), loadDashboard().catch(()=>{})]);
    } catch (e: any) { setErr(e.message); }
    finally { setComplaintBusy(false); }
  };

  const addComplaintComment = async () => {
    if (!token || !complaintDetail || !complaintComment.trim()) return;
    setComplaintBusy(true);
    try {
      await apiFetch(`/api/resellers/${resellerId}/complaints/${complaintDetail.id}/comments`, { method: 'POST', body: JSON.stringify({ body: complaintComment }) }, token);
      setComplaintComment(''); await openComplaint(complaintDetail.id);
    } catch (e: any) { setErr(e.message); }
    finally { setComplaintBusy(false); }
  };

  const updateComplaintStatus = async (status: string) => {
    if (!token || !complaintDetail) return;
    setComplaintBusy(true);
    try {
      await apiFetch(`/api/resellers/${resellerId}/complaints/${complaintDetail.id}`, { method: 'PUT', body: JSON.stringify({ status }) }, token);
      await openComplaint(complaintDetail.id);
      await Promise.all([loadComplaints(), loadDashboard().catch(()=>{})]);
    } catch (e: any) { setErr(e.message); }
    finally { setComplaintBusy(false); }
  };

  const loadParental = useCallback(async () => {
    if (!token) return;
    const qs = new URLSearchParams();
    if (parentalFilters.q) qs.set('q', parentalFilters.q);
    if (parentalFilters.enabled) qs.set('enabled', parentalFilters.enabled);
    const r = await apiFetch<any>(`/api/resellers/${resellerId}/parental-control${qs.toString() ? `?${qs}` : ''}`, {}, token);
    setParental(r.data || []); setParentalEnabledCount(r.enabled_count || 0);
  }, [token, resellerId, parentalFilters]);

  const toggleParental = async (sid: string, enabled: boolean) => {
    if (!token) return;
    try {
      await apiFetch(`/api/resellers/${resellerId}/parental-control/${sid}`, { method: 'PUT', body: JSON.stringify({ enabled }) }, token);
      await Promise.all([loadParental(), loadDashboard().catch(()=>{})]);
    } catch (e: any) { setErr(e.message); }
  };
  const loadNotifLog = useCallback(async () => { if (!token) return; const r = await apiFetch<any>(`/api/resellers/${resellerId}/notification-log`, {}, token); setNotifLog(r.data || []); setNotifUnread(r.unread || 0); }, [token, resellerId]);

  const loadTab = useCallback(async (t: TabKey) => { if (parityKeys.has(t)) return; setLoading(true); setErr(null); try { if (t === 'dashboard') await loadDashboard(); if (t === 'users') await Promise.all([loadUsers(), loadKyc().catch(()=>{}), dashboard ? Promise.resolve() : loadDashboard().catch(()=>{})]); if (t === 'sessions') await loadSessions(); if (t === 'balance') await Promise.all([loadBalance(), loadTopups()]); if (t === 'sharing') await loadSharing(); if (t === 'payments') await loadPayments(); if (t === 'onus') await Promise.all([loadOnus(), users.length ? Promise.resolve() : loadUsers().catch(()=>{})]); if (t === 'logs') await loadLogs(); if (t === 'notifications') await loadNotifLog(); if (t === 'branches') await loadBranches(); if (t === 'complaints') await loadComplaints(); if (t === 'parental') await loadParental(); } catch (e: any) { setErr(e.message || 'Failed to load'); } finally { setLoading(false); } }, [loadDashboard, loadUsers, loadKyc, loadSessions, loadBalance, loadTopups, loadSharing, loadPayments, loadOnus, loadLogs, loadNotifLog, loadBranches, loadComplaints, loadParental, dashboard, users.length]);
  useEffect(() => { loadTab('dashboard'); }, [resellerId]); // eslint-disable-line
  useEffect(() => { if (tab !== 'dashboard') loadTab(tab); }, [tab, payKind]); // eslint-disable-line
  useEffect(() => { if (tab === 'payments') { const t = setTimeout(() => loadPayments().catch(()=>{}), 250); return () => clearTimeout(t); } }, [payQ, payStatus, payGateway, payMethod, payType, payApproval]); // eslint-disable-line
  useEffect(() => { if (tab === 'logs') { const t = setTimeout(() => loadLogs().catch(()=>{}), 250); return () => clearTimeout(t); } }, [logQ, logKind, logFilters]); // eslint-disable-line
  useEffect(() => {
    if (!liveTraffic || tab !== 'sessions' || !token) return;
    const sample = async () => { try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/sessions`, {}, token); const rows = r.data || []; const rx = rows.reduce((a:number,x:any)=>a+Number(x.rx_bps||0),0); const tx = rows.reduce((a:number,x:any)=>a+Number(x.tx_bps||0),0); setTrafficHistory(h => [...h.slice(-39), { t: Date.now(), rx, tx }]); } catch {} };
    sample(); const int = setInterval(sample, 5000); return () => clearInterval(int);
  }, [liveTraffic, tab, token, resellerId]);

  const doGlobalSearch = async () => {
    const q = globalSearch.trim();
    if (!q || !token) { setGlobalResults(null); setGlobalOpen(false); return; }
    setGlobalBusy(true); setGlobalOpen(true);
    try {
      const r = await apiFetch<any>(`/api/resellers/${resellerId}/search?q=${encodeURIComponent(q)}`, {}, token);
      setGlobalResults(r.data || { users: [], payments: [], sessions: [], onus: [] });
    } catch { setGlobalResults({ users: [], payments: [], sessions: [], onus: [], error: true }); }
    finally { setGlobalBusy(false); }
  };
  useEffect(() => { if (tab==='users' && userQ===globalSearch.trim() && globalSearch.trim()) loadUsers().catch(()=>{}); }, [userQ]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(() => { if (globalSearch.trim().length >= 2) doGlobalSearch(); else { setGlobalResults(null); setGlobalOpen(false); } }, 350); return () => clearTimeout(t); }, [globalSearch]); // eslint-disable-line
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const goSearchResult = (type: 'users'|'payments'|'sessions'|'onus', _row?: any) => {
    setGlobalOpen(false);
    if (type === 'users') { setUserQ(globalSearch.trim()); setUserStatus(''); setTab('users'); }
    if (type === 'payments') { setPayQ(globalSearch.trim()); setPayKind('all'); setTab('payments'); }
    if (type === 'sessions') { setTab('sessions'); }
    if (type === 'onus') { setTab('onus'); }
  };

  const filteredPayments = useMemo(() => payments, [payments]);
  const payGateways = useMemo(() => Array.from(new Set(payments.map((p:any)=>String(p.gateway||'').toUpperCase()).filter(Boolean))), [payments]);
  const payMethods = useMemo(() => Array.from(new Set(payments.map((p:any)=>String(p.method||'').toUpperCase()).filter(Boolean))), [payments]);
  const payTypes = useMemo(() => Array.from(new Set(payments.map((p:any)=>String(p.payment_type||'').toUpperCase()).filter(Boolean))), [payments]);
  const payApprovals = useMemo(() => Array.from(new Set(payments.map((p:any)=>String(p.approval_status||'APPROVED').toUpperCase()).filter(Boolean))), [payments]);
  const gatewayBreakdown = useMemo(() => { const m: Record<string,{count:number,amount:number}> = {}; payments.forEach((p:any)=>{ const k=String(p.gateway||'UNKNOWN').toUpperCase(); if(!m[k]) m[k]={count:0,amount:0}; m[k].count++; m[k].amount += Number(p.amount||0); }); return Object.entries(m).sort((a,b)=>b[1].amount-a[1].amount); }, [payments]);
  const selectedIds = useMemo(() => Object.keys(selected).filter(k => selected[k]), [selected]);
  const allSelected = users.length > 0 && users.every(u => selected[u.id]);
  const sessionKey = (s:any,i:number) => String(s.subscriber_id || s.username || i);
  const selectedSessionKeys = useMemo(() => Object.keys(sessionSelected).filter(k => sessionSelected[k]), [sessionSelected]);
  const allSessionsSelected = sessions.length > 0 && sessions.every((s,i)=> sessionSelected[sessionKey(s,i)]);

  // Reseller self-service wallet recharge via payment gateway (wallet credited only after verified gateway confirmation).
  const rechargeGateway = async () => {
    if (!token) return;
    const amount = Number(gwRechargeAmount);
    if (!Number.isFinite(amount) || !(amount > 0)) { setErr('Enter a valid amount'); return; }
    // surface credit_limit BEFORE starting checkout — the server rejects crediting past it (and a paid-but-uncredited payment is worse). 0 = unlimited.
    if (creditLimitApplies && +(walletBalance + amount).toFixed(2) > creditLimit + 1e-9) {
      setErr(`Recharge would exceed credit limit (${money(creditLimit)}). Headroom: ${money(creditHeadroom ?? 0)}. Lower the amount.`); return;
    }
    setErr(null); setMsg(null); setGwBusy(true);
    try {
      const r = await apiFetch<any>(`/api/resellers/${resellerId}/wallet/recharge-gateway`, { method: 'POST', body: JSON.stringify({ amount, gateway: gwName }) }, token);
      const url = r.checkout?.paymentUrl || r.checkout?.approvalUrl || null;
      const ref = String(r.payment_ref || '');
      // track PENDING; we NEVER claim credited here — server credits only on a verified gateway webhook
      if (ref) addPendingRecharge({ payment_ref: ref, amount, gateway: gwName, at: new Date().toISOString() });
      const noCheckout = !url && !r.checkout?.clientSecret;
      setMsg(`Payment started (${gwName})${ref ? ` — ref ${ref}` : ''}. Status: PENDING verification; wallet is credited automatically once the gateway sends a verified confirmation.${url ? ' Complete payment in the opened window.' : ''}${noCheckout ? ` No checkout URL was returned${r.checkout?.message ? ` (${r.checkout.message})` : ''}; complete payment at your gateway, then Refresh status.` : ''}`);
      setGwRechargeAmount('');
      if (url) { try { window.open(url, '_blank', 'noopener'); } catch {} }
    } catch (e: any) { setErr(e.message); } finally { setGwBusy(false); }
  };
  const recharge = async () => { if (!token) return; const amount = Number(rechargeAmount); if (!(amount > 0)) { setErr('Enter a valid amount'); return; } if (creditLimitApplies && +(walletBalance + amount).toFixed(2) > creditLimit + 1e-9) { setErr(`Recharge would exceed credit limit (${money(creditLimit)}). Headroom: ${money(creditHeadroom ?? 0)}.`); return; } setErr(null); setMsg(null); try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/wallet/recharge`, { method: 'POST', body: JSON.stringify({ amount, description: 'Portal wallet recharge' }) }, token); setMsg(`Wallet recharged ${money(amount)}. New balance: ${money(r.balance)}`); setRechargeAmount(''); await Promise.all([loadBalance().catch(()=>{}), loadDashboard().catch(()=>{})]); } catch (e: any) { setErr(e.message); } };
  const renew = async (subscriberId: string) => { if (!token || !subscriberId) return; setErr(null); setMsg(null); setActionBusy(`renew:${subscriberId}`); try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/renew-subscriber`, { method: 'POST', body: JSON.stringify({ subscriber_id: subscriberId }) }, token); setMsg(`Renewed. Charged ${money(r.charged)} (retail ${money(r.retail)}, margin ${r.margin_percent}%). Balance: ${money(r.balance)}. New expiry: ${r.subscriber?.expiry_date || '-'}.`); await Promise.all([loadUsers().catch(()=>{}), loadBalance().catch(()=>{}), loadDashboard().catch(()=>{})]); } catch (e: any) { setErr(e.message); } finally { setActionBusy(null); } };
  const disconnect = async (s: AnyObj) => { if (!token) return; const uname = s.username; if (!uname && !s.subscriber_id) return; if (!confirm(`Disconnect ${uname || s.full_name || 'user'}?`)) return; setErr(null); setMsg(null); setActionBusy(`dc:${uname || s.subscriber_id}`); try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/disconnect`, { method: 'POST', body: JSON.stringify({ username: uname, subscriber_id: s.subscriber_id }) }, token); setMsg(r.message || (r.ok ? 'Disconnect requested' : 'Disconnect failed')); await loadSessions().catch(()=>{}); } catch (e: any) { setErr(e.message); } finally { setActionBusy(null); } };
  const reconnect = async (s: AnyObj) => { if (!token) return; setErr(null); setMsg(null); setActionBusy(`rc:${s.username || s.subscriber_id}`); try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/reconnect`, { method: 'POST', body: JSON.stringify({ username: s.username, subscriber_id: s.subscriber_id }) }, token); setMsg(r.message || (r.ok ? 'Reconnect requested' : 'Reconnect failed')); } catch (e: any) { setErr(e.message); } finally { setActionBusy(null); } };
  const bulkDisconnect = async () => { const targets = sessions.filter((s,i)=>sessionSelected[sessionKey(s,i)]); if(!targets.length) return; if(!confirm(`Disconnect ${targets.length} selected session(s)?`)) return; setErr(null); setMsg(null); setActionBusy('bulkdc'); let ok=0,fail=0; for(const s of targets){ try{ const r=await apiFetch<any>(`/api/resellers/${resellerId}/disconnect`, { method:'POST', body: JSON.stringify({ username:s.username, subscriber_id:s.subscriber_id }) }, token); if(r.ok) ok++; else fail++; } catch { fail++; } } setMsg(`Bulk disconnect: ${ok} ok${fail?`, ${fail} failed`:''}.`); await loadSessions().catch(()=>{}); setActionBusy(null); };
  const batchStatus = async (action: 'activate'|'suspend', ids: string[]) => { if (!token || !ids.length) return; let reason = action === 'suspend' ? (prompt('Suspend reason (optional):', 'Manual suspend') || undefined) : undefined; if (reason === undefined && action==='suspend') reason = 'Manual suspend'; setErr(null); setMsg(null); setActionBusy(`batch:${action}`); try { const r = await apiFetch<any>('/api/subscribers/batch', { method: 'POST', body: JSON.stringify({ action, ids, params: reason ? { reason } : {} }) }, token); const ok = (r.results||[]).filter((x:any)=>x.ok).length; setMsg(`${action === 'activate' ? 'Activated' : 'Suspended'} ${ok}/${ids.length} subscriber(s).`); await Promise.all([loadUsers().catch(()=>{}), loadDashboard().catch(()=>{}), loadSessions().catch(()=>{})]); } catch (e:any) { setErr(e.message); } finally { setActionBusy(null); } };
  const extendExpiry = async (sub: AnyObj, extraDays = 30) => { if (!token) return; setErr(null); setMsg(null); setActionBusy(`ext:${sub.id}`); try { const base = sub.expiry_date ? new Date(sub.expiry_date) : new Date(); if (isNaN(base.getTime())) base.setTime(Date.now()); base.setDate(base.getDate() + extraDays); const expiry_date = base.toISOString().slice(0,10); await apiFetch<any>(`/api/subscribers/${sub.id}`, { method: 'PUT', body: JSON.stringify({ expiry_date }) }, token); setMsg(`Extended ${sub.full_name || sub.username} by ${extraDays} days (new expiry: ${expiry_date}).`); await loadUsers().catch(()=>{}); } catch (e:any) { setErr(e.message); } finally { setActionBusy(null); } };
  const submitCustomerPayment = async () => {
    if (!token || !viewUser) return;
    const amount = Number(payForm.amount);
    if (!(amount > 0)) { setErr('Enter a valid amount'); return; }
    setPayBusy(true); setErr(null);
    try {
      await apiFetch<any>(`/api/resellers/${resellerId}/customers/${viewUser.id}/payment`, { method: 'POST', body: JSON.stringify({ ...payForm, amount, mode: payMode }) }, token);
      setMsg(`${payMode === 'ADD' ? 'Money added' : 'Payment recorded'} for ${viewUser.full_name || viewUser.username}.`);
      setPayOpen(false); setPayForm({ amount: '', payment_type: 'CASH', trx_id: '', notes: '' });
      await openView(viewUser); await loadBalance().catch(()=>{});
    } catch (e: any) { setErr(e.message); }
    finally { setPayBusy(false); }
  };
  const printInvoice = (invoiceId: string) => { if (!token || !viewUser) return; fetch(`/api/resellers/${resellerId}/customers/${viewUser.id}/invoices/${invoiceId}/pdf`, { headers: { Authorization: `Bearer ${token}` } }).then(async r => { if (!r.ok) { setErr('Invoice PDF unavailable'); return; } const blob = await r.blob(); const url = URL.createObjectURL(blob); window.open(url, '_blank'); setTimeout(()=>URL.revokeObjectURL(url), 60000); }); };
  const openView = async (s: AnyObj) => { setViewUser(s); setCustomerDetail(null); setDetailTab('basic'); setDetailLoading(true); try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/customers/${s.id}/detail`, {}, token || ''); setCustomerDetail(r.data || null); } catch { /* show basic fallback */ } finally { setDetailLoading(false); } };
  const openEdit = (s: AnyObj) => setWizard({ initial: s });
  const deleteSubscriber = async () => { if (!token || !deleteTarget) return; setDeleting(true); setErr(null); setMsg(null); try {
    await apiFetch<any>(`/api/subscribers/${deleteTarget.id}`, { method: 'DELETE' }, token);
    setMsg(`Deleted ${deleteTarget.full_name || deleteTarget.username}.`);
    setDeleteTarget(null); await Promise.all([loadUsers().catch(()=>{}), loadDashboard().catch(()=>{})]);
  } catch (e: any) { setErr(e.message || 'Delete failed'); setDeleteTarget(null); } finally { setDeleting(false); } };

  const loadTemplates = async () => { if (!token) return; try { const r = await apiFetch<any>('/api/messaging/templates', {}, token); setTemplates(r.data || []); } catch { setTemplates([]); } };
  const openMessage = async (s: AnyObj) => { setMsgTarget(s); setSaveTplName(''); setBulkMsgReport(null); setMsgForm({ channel_type: 'SMS', provider: 'GREENWEB', to: s.phone || s.email || '', subject: '', body: `Dear ${s.full_name || s.username || 'Customer'}, `, templateId: '' }); if (!templates.length) await loadTemplates(); };
  const bulkRenew = async () => { const ids = selectedIds; if (!ids.length) return; if (!confirm(`Renew ${ids.length} selected subscriber(s) using reseller wallet?`)) return; setErr(null); setMsg(null); setActionBusy('bulkrenew'); let ok=0, fail=0; for (const id of ids) { try { await apiFetch<any>(`/api/resellers/${resellerId}/renew-subscriber`, { method: 'POST', body: JSON.stringify({ subscriber_id: id }) }, token); ok++; } catch { fail++; } } setMsg(`Bulk renew: ${ok} ok${fail ? `, ${fail} failed` : ''}.`); await Promise.all([loadUsers().catch(()=>{}), loadBalance().catch(()=>{}), loadDashboard().catch(()=>{})]); setActionBusy(null); };

  const assignOnu = async (onuId: string) => { if (!token) return; const subscriber_id = onuAssign[onuId]; if (!subscriber_id) { setErr('Select a subscriber to assign ONU'); return; } setErr(null); setMsg(null); setActionBusy(`onu:${onuId}`); try { await apiFetch<any>(`/api/resellers/${resellerId}/onus/${onuId}/assign`, { method: 'POST', body: JSON.stringify({ subscriber_id }) }, token); setMsg('ONU assigned/linked to subscriber.'); await loadOnus().catch(()=>{}); } catch (e:any) { setErr(e.message); } finally { setActionBusy(null); } };

  const pingTarget = async (sub: AnyObj) => { if (!token) return; setErr(null); setMsg(null); setActionBusy(`ping:${sub.id || sub.subscriber_id}`); try { const r = await apiFetch<any>(`/api/resellers/${resellerId}/ping`, { method: 'POST', body: JSON.stringify({ subscriber_id: sub.id || sub.subscriber_id, ip_address: sub.ip_address }) }, token); setMsg(r.ok ? `Ping ${r.ip}: reachable${r.avg_ms!=null ? ` (avg ${r.avg_ms} ms)` : ''}` : `Ping ${r.ip || sub.ip_address || ''}: unreachable${r.error ? ` (${r.error})` : ''}`); } catch (e:any) { setErr(e.message); } finally { setActionBusy(null); } };
  const openEditPayment = (p: AnyObj) => { setEditPay(p); setEditPayForm({ payment_type: p.payment_type || '', collector_name: p.collector_name || '', approval_status: p.approval_status || 'APPROVED', approval_note: p.approval_note || '' }); };

  const stats = dashboard?.stats || {}; const walletInfo = dashboard?.wallet || { balance: reseller?.wallet_balance || 0 };
  const openProfile = () => { setProfileForm({ company_name: reseller?.company_name || '', email: reseller?.email || '', phone: reseller?.phone || '', address: reseller?.address || '', brand_name: reseller?.brand_name || '', logo_url: reseller?.logo_url || '', primary_color: reseller?.primary_color || '', secondary_color: reseller?.secondary_color || '', portal_title: reseller?.portal_title || '', avatar_url: reseller?.avatar_url || '', notify_expiry: reseller?.notify_expiry !== false, notify_payment: reseller?.notify_payment !== false, notify_system: reseller?.notify_system !== false, notes: reseller?.notes || '' }); setProfileOpen(true); };
  const saveProfile = async () => { if (!token || !reseller?.id) return; setProfileSaving(true); setErr(null); try { await apiFetch<any>(`/api/resellers/${reseller.id}/profile`, { method: 'PUT', body: JSON.stringify(profileForm) }, token); setMsg('Profile updated.'); setProfileOpen(false); await loadDashboard().catch(()=>{}); } catch (e: any) { setErr(e.message); } finally { setProfileSaving(false); } };
  const tabDataForExport = () => { if (tab === 'users') return users; if (tab === 'sessions') return sessions; if (tab === 'balance') return (balance?.transactions || []); if (tab === 'sharing') return sharing; if (tab === 'payments') return filteredPayments; if (tab === 'onus') return onus; if (tab === 'logs') return [...(logs.audit||[]), ...(logs.wallet||[])]; return []; };

  return (
    <div className="space-y-4">
      <div className="page-header items-start">
        <div className="flex items-start gap-3">
          {!isResellerUser && <Link href="/resellers" className="btn btn-outline btn-icon mt-0.5"><ChevronRight className="w-4 h-4 rotate-180" /></Link>}
          <div>
            <span className="page-eyebrow">Partner workspace · Reseller portal</span>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="page-title">{reseller?.name || 'Reseller Portal'}</h1>
              {reseller?.status && <span className="badge badge-success">{reseller.status}</span>}
            </div>
            <p className="page-subtitle">{reseller?.company_name || reseller?.code || 'Partner-scoped ISP reseller portal'}{reseller?.tier ? ` · ${reseller.tier} tier` : ''}</p>
          </div>
        </div>
        <div className="page-actions">
          <button onClick={() => setShowBalance(v => !v)} className="btn btn-outline"><Wallet className="w-4 h-4 text-success" />{showBalance ? money(walletInfo.balance ?? reseller?.wallet_balance) : 'Show Balance'}</button>
          <button onClick={openProfile} className="btn btn-outline"><Building2 className="w-4 h-4" />Profile</button>
          <button onClick={() => loadTab(tab)} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </div>

      <div className="toolbar-strip">
        <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="form-control w-full pl-8 pr-8" placeholder="Global search — user, IP, MAC, trx, ONU…" value={globalSearch} onChange={e=>{setGlobalSearch(e.target.value); setGlobalOpen(true);}} onKeyDown={e=>{ if(e.key==='Enter') doGlobalSearch(); if(e.key==='Escape') setGlobalOpen(false); }} onFocus={()=>{ if(globalResults) setGlobalOpen(true); }} />
            {globalSearch && <button onClick={()=>{setGlobalSearch(''); setGlobalResults(null); setGlobalOpen(false);}} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
            {globalOpen && globalSearch.trim().length >= 2 && (
              <div className="dropdown-menu right-0 w-[420px] max-w-[90vw] p-3 space-y-2 max-h-[420px] overflow-auto">
                <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{globalBusy ? 'Searching...' : 'Search results'}</span><button onClick={()=>setGlobalOpen(false)} className="hover:text-foreground">Close</button></div>
                {globalResults && !globalBusy && (
                  <>
                    {(['users','payments','sessions','onus'] as const).every(k => !(globalResults[k]||[]).length) && <div className="text-sm text-muted-foreground py-2">No matches found.</div>}
                    {!!(globalResults.users||[]).length && <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Users ({globalResults.users.length})</div><div className="space-y-1">{globalResults.users.slice(0,6).map((u:any)=>(<button key={u.id} onClick={()=>goSearchResult('users',u)} className="w-full text-left p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border"><div className="text-sm font-medium">{u.full_name || u.username} <span className="text-muted-foreground font-normal">({u.client_code || u.username})</span></div><div className="text-[11px] text-muted-foreground">{[u.status,u.phone,u.ip_address,u.mac_address].filter(Boolean).join(' • ')}</div></button>))}</div></div>}
                    {!!(globalResults.payments||[]).length && <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Payments ({globalResults.payments.length})</div><div className="space-y-1">{globalResults.payments.slice(0,5).map((p:any)=>(<button key={p.id} onClick={()=>goSearchResult('payments',p)} className="w-full text-left p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border"><div className="text-sm font-medium">{money(p.amount)} {statusBadge(p.status)} <span className="text-muted-foreground font-normal ml-1">{p.trx_id || p.payment_ref || ''}</span></div><div className="text-[11px] text-muted-foreground">{[p.full_name||p.username,p.invoice_number,p.gateway,p.method].filter(Boolean).join(' • ')}</div></button>))}</div></div>}
                    {!!(globalResults.sessions||[]).length && <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Online/Sessions ({globalResults.sessions.length})</div><div className="space-y-1">{globalResults.sessions.slice(0,5).map((s:any,i:number)=>(<button key={s.subscriber_id||i} onClick={()=>goSearchResult('sessions',s)} className="w-full text-left p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border"><div className="text-sm font-medium">{s.full_name || s.username} <span className="text-muted-foreground font-normal">({s.client_code || s.username})</span></div><div className="text-[11px] text-muted-foreground">{[s.status||'ONLINE',s.ip_address,s.mac_address].filter(Boolean).join(' • ')}</div></button>))}</div></div>}
                    {!!(globalResults.onus||[]).length && <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">ONUs ({globalResults.onus.length})</div><div className="space-y-1">{globalResults.onus.slice(0,5).map((o:any,i:number)=>(<button key={o.id||i} onClick={()=>goSearchResult('onus',o)} className="w-full text-left p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border"><div className="text-sm font-medium">{o.serial_number || o.onu_serial || o.name || o.onu_name} {statusBadge(o.status || o.onu_status)}</div><div className="text-[11px] text-muted-foreground">{[o.subscriber_name,o.client_code,o.username].filter(Boolean).join(' • ')}</div></button>))}</div></div>}
                  </>
                )}
              </div>
            )}
          </div>
        <span className="toolbar-divider" />
        <button onClick={() => downloadCsv(`reseller-${tab}-${resellerId}.csv`, tabDataForExport())} className="page-tab"><Download className="w-3.5 h-3.5" />CSV</button>
        <button onClick={async () => { if (!token) return; try { const res = await fetch(`/api/resellers/${resellerId}/export/xlsx`, { headers: { Authorization: `Bearer ${token}` } }); if (!res.ok) throw new Error('Export failed'); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `reseller-subscribers-${resellerId}.xlsx`; a.click(); URL.revokeObjectURL(url); } catch (e: any) { setErr(e.message); } }} className="page-tab"><FileSpreadsheet className="w-3.5 h-3.5" />Excel</button>
      </div>

      <div className="page-tabbar">{tabs.map(t => { const Icon = t.icon; const active = tab === t.key; return (<button key={t.key} onClick={() => setTab(t.key)} className={`page-tab ${active ? 'active' : ''}`}><Icon className="w-3.5 h-3.5" />{t.label}</button>); })}</div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">Customizable dashboard: toggle widgets to focus on what matters.</div>
            <div className="flex flex-wrap gap-1.5 text-xs">{autoRefresh && <span className="px-2.5 py-1.5 rounded-lg border border-success/30 text-success inline-flex items-center gap-1"><span className="status-dot online" />Auto 60s</span>}{[['kpis','KPIs'],['charts','Charts'],['alerts','Alerts'],['profile','Profile'],['overview','Overview']].map(([k,label]) => (<button key={k} onClick={()=>setWidgets(w=>({...w,[k]:!w[k]}))} className={`px-2.5 py-1.5 rounded-lg border ${widgets[k]!==false?'bg-primary/10 border-primary/30 text-primary':'border-border text-muted-foreground'}`}>{label}</button>))}<button onClick={()=>setAutoRefresh(v=>!v)} className={`px-2.5 py-1.5 rounded-lg border ${autoRefresh?'bg-success/10 border-success/30 text-success':'border-border text-muted-foreground'}`}>Auto-refresh 60s</button></div>
          </div>
          {widgets.alerts !== false && !!notifications.length && (
            <div className="card p-4 space-y-2">
              <h2 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-warning" />Notifications & Alerts <span className="text-xs text-muted-foreground font-normal">({notifications.filter(n => !dismissed.includes(String(n.title))).length})</span><button onClick={()=>setDismissed(notifications.map(n=>String(n.title)))} className="btn btn-outline btn-sm ml-auto">Clear All</button></h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">{notifications.filter(n=>!dismissed.includes(String(n.title))).slice(0,12).map((n,i)=>(<button key={i} onClick={()=>{ if(n.subscriber_id){ setUserQ(''); setUserStatus(''); setTab('users'); } else if(n.payment_id){ setTab('payments'); } else if(n.type==='LOW_BALANCE'){ setTab('balance'); } }} className={`card card-link text-left p-3 ${n.severity==='error'?'border-danger/25 bg-danger/5':n.severity==='warning'?'border-warning/25 bg-warning/5':'border-info/20 bg-info/5'}`}><div className="text-sm font-semibold">{n.title}</div><div className="text-xs text-muted-foreground">{n.message}</div><div className="text-[10px] mt-1 text-muted-foreground">{n.type}</div></button>))}</div>
            </div>
          )}
          {widgets.kpis !== false && <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Card label="Total" value={stats.total ?? 0} icon={Users} onClick={()=>{setTab('users');setUserStatus('');}} />
            <Card label="Active" value={stats.active ?? 0} icon={UserCheck} tone="blue" onClick={()=>{setTab('users');setUserStatus('ACTIVE');}} />
            <Card label="Online" value={stats.online ?? 0} icon={Activity} tone="green" onClick={()=>setTab('sessions')} />
            <Card label="Expired" value={stats.expired ?? 0} icon={Clock3} tone="amber" onClick={()=>{setTab('users');setUserStatus('EXPIRED');}} />
            <Card label="Expiring (3d)" value={stats.expiring_3d ?? 0} icon={Clock3} tone="amber" onClick={()=>{setTab('users');setUserStatus('');}} sub="view users" />
            <Card label="Suspended" value={stats.suspended ?? 0} icon={UserX} tone="red" onClick={()=>{setTab('users');setUserStatus('SUSPENDED');}} />
            <Card label="Pending" value={stats.pending ?? 0} icon={Clock3} tone="slate" onClick={()=>{setTab('users');setUserStatus('PENDING');}} />
            <Card label="Terminated" value={stats.terminated ?? 0} icon={Ban} tone="slate" />
            <Card label="Complaints" value={stats.complaints ?? 0} icon={AlertCircle} tone="amber" onClick={()=>setTab('complaints')} sub="open tickets" />
            <Card label="Parental Control" value={stats.parental_control_users ?? 0} icon={Ban} tone="purple" onClick={()=>setTab('parental')} sub="protected users" />
            <Card label="Custom Bandwidth" value={stats.custom_bandwidth_users ?? 0} icon={Activity} tone="blue" />
            <Card label="Extended Users" value={stats.extended_users ?? 0} icon={Clock3} tone="amber" />
            <Card label="Wallet Balance" value={money(walletInfo.balance ?? 0)} icon={Wallet} tone="green" onClick={()=>setTab('balance')} />
            <Card label="Total Credited" value={money(walletInfo.total_credited ?? 0)} icon={ArrowUpRight} tone="green" />
            <Card label="Total Debited" value={money(walletInfo.total_debited ?? 0)} icon={ArrowDownLeft} tone="red" />
            <Card label="Month Collected" value={money(dashboard?.month?.month_collected ?? 0)} icon={CreditCard} tone="purple" sub={`${dashboard?.month?.month_payments ?? 0} payments`} onClick={()=>setTab('payments')} />
          </div>}
          {widgets.charts !== false && charts && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="card p-4"><div className="font-semibold text-sm mb-2 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary"/>Registrations (6m)</div><MiniBars labels={charts.months||[]} values={charts.registrations||[]} colorClass="bg-teal" /></div>
            <div className="card p-4"><div className="font-semibold text-sm mb-2 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-warning"/>Expirations (6m)</div><MiniBars labels={charts.months||[]} values={charts.expirations||[]} colorClass="bg-warning" /></div>
            <div className="card p-4"><div className="font-semibold text-sm mb-2 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-success"/>Renewals (6m)</div><MiniBars labels={charts.months||[]} values={charts.renewals||[]} colorClass="bg-success" /></div>
            <div className="card p-4"><div className="font-semibold text-sm mb-2 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-purple"/>Collections (6m)</div><MiniBars labels={charts.months||[]} values={(charts.payments_amount||[]).map((v:any)=>Math.round(Number(v||0)))} colorClass="bg-purple" /><div className="text-[10px] text-muted-foreground mt-1">Amount (BDT, rounded)</div></div>
          </div>}
          {widgets.charts !== false && <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-4 lg:col-span-2"><h2 className="font-bold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-teal" />Top Bandwidth Users (This Month)</h2>
              {!!bandwidth.length ? <div className="space-y-2">{bandwidth.slice(0,8).map((b: any, i: number) => {
                const max = Math.max(1, ...bandwidth.map((x: any) => Number(x.total_bytes || 0)));
                return <div key={b.id || i} className="flex items-center gap-3 text-xs"><span className="w-4 text-muted-foreground">{i + 1}</span><span className="w-32 truncate font-medium">{b.full_name || b.username || '-'}</span><div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden"><div className="h-full bg-teal" style={{ width: `${Math.round((Number(b.total_bytes || 0) / max) * 100)}%` }} /></div><span className="w-20 text-right font-semibold">{gb(b.total_bytes)}</span></div>;
              })}</div> : <div className="text-xs text-muted-foreground py-4 text-center">No traffic data yet.</div>}
            </div>
            <div className="card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><ScrollText className="w-4 h-4 text-primary" />History</h2>
              <div className="space-y-3 text-xs">{[
                ['Registrations', [['Today', history?.today?.registered], ['Yesterday', history?.yesterday?.registered], ['This month', history?.month?.registered], ['Last month', history?.last_month?.registered]]],
                ['Expirations', [['Today', history?.today?.expired], ['Tomorrow', history?.next_7?.expired], ['This month', history?.month?.expired]]],
                ['Renewals', [['Today', history?.today?.renewed], ['Yesterday', history?.yesterday?.renewed], ['This month', history?.month?.renewed]]],
                ['Invoice payments', [['Today', history?.today?.paid], ['Yesterday', history?.yesterday?.paid], ['This month', history?.month?.paid]]],
              ].map(([title, rows]: any) => <div key={title}><div className="font-semibold mb-1">{title}</div>{rows.map(([label, val]: any) => <div key={label} className="flex justify-between border-b border-border/40 py-0.5"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{val ?? 0}</span></div>)}</div>)}</div>
            </div>
          </div>}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {widgets.profile !== false && <div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Reseller Profile</h2><div className="text-sm space-y-2">{[['Code', reseller?.code], ['Company', reseller?.company_name], ['Email', reseller?.email], ['Phone', reseller?.phone], ['Tier', reseller?.tier], ['Buying Margin', `${Number(reseller?.buying_margin_percent || 0)}%`], ['Commission', `${Number(reseller?.commission_percent || 0)}%`], ['Subdomain', reseller?.subdomain ? `${reseller.subdomain}.` : '-'], ['Custom Domain', reseller?.custom_domain || '-']].map(([k,v]: any) => (<div key={k} className="flex justify-between gap-3 border-b border-border/40 pb-1.5"><span className="text-muted-foreground">{k}</span><span className="font-medium text-right break-all">{String(v ?? '-')}</span></div>))}</div></div>}
            {widgets.overview !== false && <div className="card p-4 lg:col-span-2"><h2 className="font-bold mb-3">Status Overview</h2><div className="space-y-2">{[['Active', stats.active||0,'bg-success'],['Online', stats.online||0,'bg-teal'],['Expired', stats.expired||0,'bg-warning'],['Expiring (3d)', stats.expiring_3d||0,'bg-orange'],['Suspended', stats.suspended||0,'bg-danger'],['Pending', stats.pending||0,'bg-secondary']].map(([label,val,color]: any) => { const total = Math.max(Number(stats.total||0), 1); const pct = Math.min(100, Math.round((Number(val)/total)*100)); return <div key={label}><div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{val} <span className="text-muted-foreground">({pct}%)</span></span></div><div className="h-2 rounded-full bg-muted/40 overflow-hidden"><div className={`h-full ${color}`} style={{width:`${pct}%`}} /></div></div>; })}</div><div className="mt-4 p-3 rounded-xl border border-border bg-muted/10 text-xs text-muted-foreground">Partner-scoped portal: dashboard charts, global search (name/user/phone/IP/MAC/NID), bulk ops, disconnect/CoA, renewals, wallet/sharing, payments breakdown/filters, ONU, logs, messaging templates & delivery reports.</div></div>}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h2 className="font-bold flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Users List <span className="text-xs text-muted-foreground font-normal">({users.length})</span></h2>
            <div className="flex flex-wrap gap-2">
              <div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="form-control w-56 pl-8" placeholder="Search name/user/phone/IP/MAC..." value={userQ} onChange={e=>setUserQ(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') loadUsers(); }} /></div>
              <select className="form-select" value={userStatus} onChange={e=>setUserStatus(e.target.value)}><option value="">All Status</option>{['ACTIVE','EXPIRED','SUSPENDED','PENDING','TERMINATED','DISABLED'].map(s=> <option key={s} value={s}>{s}</option>)}</select>
              <button onClick={() => setShowUserFilters(v => !v)} className="btn btn-outline">More Filters</button>
              <button onClick={loadUsers} className="btn btn-outline">Apply</button>
              {canAddSubscriber && <button onClick={()=>setImportOpen(true)} className="btn btn-outline inline-flex items-center gap-1"><FileSpreadsheet className="w-4 h-4" />Import XLSX</button>}
              {canAddSubscriber && <button onClick={()=>setWizard({})} className="btn btn-primary inline-flex items-center gap-1"><UserPlus className="w-4 h-4" />Add Subscriber</button>}
            </div>
          </div>
          {showUserFilters && <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 p-3 rounded-xl border border-border bg-muted/20">
            {[
              ['online','Connection','ONLINE/OFFLINE'], ['profile','Package','package name'],
              ['from','Created from (YYYY-MM-DD)',''], ['to','Created to (YYYY-MM-DD)',''],
              ['expiry_from','Expiry from (YYYY-MM-DD)',''], ['expiry_to','Expiry to (YYYY-MM-DD)',''],
              ['zone','Zone',''], ['area','Area',''], ['notes','Notes',''],
            ].map(([key,label,ph]) => <label key={key} className="block"><span className="form-label">{label}</span><input className="form-control" placeholder={ph} value={userFilters[key] || ''} onChange={e => setUserFilters(f => ({ ...f, [key]: e.target.value }))} /></label>)}
            {[
              ['custom_price','Custom Price'], ['custom_bandwidth','Custom Bandwidth'], ['extended','Extended Expiry'], ['static_ip','Static IP'], ['has_onu','Has ONU'],
            ].map(([key,label]) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={userFilters[key] === '1'} onChange={e => setUserFilters(f => ({ ...f, [key]: e.target.checked ? '1' : '' }))} />{label}</label>)}
            <label className="block"><span className="form-label">Rows per page</span><select className="form-control" value={userLimit} onChange={e => setUserLimit(e.target.value)}>{['10','25','50','100','500','1000','2000','5000','10000'].map(n => <option key={n}>{n}</option>)}</select></label>
            <div className="flex items-end"><button onClick={() => { setUserFilters({}); setUserLimit('500'); loadUsers(); }} className="btn btn-outline btn-sm">Reset Filters</button></div>
          </div>}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Columns (drag headers to reorder):</span>
            {(['contact','address','package','expiry'] as UserCol[]).map(c => <button key={c} onClick={() => setHiddenCols(h => ({ ...h, [c]: !h[c] }))} className={`filter-chip ${!hiddenCols[c] ? 'active' : ''}`}>{USER_COL_LABELS[c]}</button>)}
            <button onClick={resetLayout} className="btn btn-outline btn-sm">Reset Table Layout</button>
            <span className="text-muted-foreground ml-auto">Rows: {users.length}</span>
          </div>
          {selectedIds.length > 0 && (<div className="flex flex-wrap items-center gap-2 p-2 rounded-xl border border-primary/30 bg-primary/5 text-xs">
              <span className="font-semibold">{selectedIds.length} selected</span>
              <button disabled={!!actionBusy} onClick={bulkRenew} className="btn btn-primary btn-sm">{actionBusy==='bulkrenew'?'...':'Bulk Renew'}</button>
              <button disabled={!!actionBusy} onClick={()=>batchStatus('activate', selectedIds)} className="btn btn-success btn-sm">Activate</button>
              <button disabled={!!actionBusy} onClick={()=>batchStatus('suspend', selectedIds)} className="btn btn-danger btn-sm">Suspend</button>
              {canMessage && <button disabled={!!actionBusy} onClick={async ()=>{ const first = users.find(u=>selected[u.id]); if(first){ await openMessage(first); } }} className="px-2.5 py-1.5 rounded-lg border border-border font-semibold disabled:opacity-50">Bulk Message</button>}
              {canAddSubscriber && <button disabled={!!actionBusy} onClick={()=>{ setBulkMode('EDIT'); setBulkEditOpen(true); }} className="px-2.5 py-1.5 rounded-lg border border-border font-semibold disabled:opacity-50">Bulk Edit</button>}
              {canAddSubscriber && <button disabled={!!actionBusy} onClick={()=>{ setBulkMode('RENAME'); setBulkEditOpen(true); }} className="px-2.5 py-1.5 rounded-lg border border-border font-semibold disabled:opacity-50">Bulk Rename</button>}
              <button onClick={()=>setSelected({})} className="ml-auto text-muted-foreground hover:text-foreground">Clear</button>
            </div>)}
          <div className="card card-body-sm space-y-2" data-testid="reseller-kyc-status">
            <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-xs">KYC status (read-only)</h3><span className="text-[11px] text-muted-foreground">Resellers can upload documents but cannot approve or reject identity.</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[150px] overflow-auto">
              {kycRows.map(k => <div key={k.id} className="rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-[11px] flex items-center justify-between gap-2"><span className="truncate"><b>{k.client_code || k.subscriber_name || 'Subscriber'}</b> · {k.doc_type}</span><span className={`badge ${k.status==='APPROVED'?'badge-success':k.status==='REJECTED'||k.status==='EXPIRED'?'badge-danger':'badge-warning'}`}>{String(k.status||'PENDING').replaceAll('_',' ')}</span></div>)}
              {!kycRows.length && <div className="text-[11px] text-muted-foreground">No KYC documents for your subscribers yet.</div>}
            </div>
          </div>
          <div className="overflow-auto"><table className="w-full text-xs min-w-[1200px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border">
              <th className="text-left py-2 px-2"><button onClick={()=>{ if(allSelected) setSelected({}); else { const m: any={}; users.forEach(u=>m[u.id]=true); setSelected(m);} }} className="p-0.5">{allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>
              {visibleCols.map(c => <th key={c} draggable onDragStart={()=>setDragCol(c)} onDragOver={e=>e.preventDefault()} onDrop={()=>{ if(dragCol) moveCol(dragCol, c); setDragCol(null); }} className="text-left py-2 px-2 cursor-grab active:cursor-grabbing" title="Drag to reorder columns">{USER_COL_LABELS[c]}</th>)}
            </tr></thead><tbody>
              {users.map(s => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="py-2 px-2"><button onClick={()=>setSelected(p=>({...p,[s.id]:!p[s.id]}))} className="p-0.5">{selected[s.id] ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}</button></td>
                  {visibleCols.map(c => <td key={c} className="py-2 px-2">{userCell(c, s)}</td>)}
                </tr>
              ))}
              {!users.length && <tr><td colSpan={visibleCols.length + 1} className="py-8 text-center text-muted-foreground">No subscribers found for this reseller.</td></tr>}
            </tbody></table></div>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold flex items-center gap-2"><Wifi className="w-4 h-4 text-primary" />Online Users / Sessions <span className="text-xs text-muted-foreground font-normal">({sessions.length})</span></h2>
            <div className="flex items-center gap-2"><button onClick={()=>setLiveTraffic(v=>!v)} className={`btn btn-outline btn-sm ${liveTraffic?'border-success/40 text-success':''}`}><Activity className="w-3.5 h-3.5" />{liveTraffic?'Live Traffic: ON':'Live Traffic'}</button></div>
            {selectedSessionKeys.length>0 && <div className="flex items-center gap-2 text-xs"><span className="font-semibold">{selectedSessionKeys.length} selected</span><button disabled={actionBusy==='bulkdc'} onClick={bulkDisconnect} className="btn btn-danger btn-sm">{actionBusy==='bulkdc'?'...':'Bulk Disconnect'}</button><button onClick={()=>setSessionSelected({})} className="text-muted-foreground">Clear</button></div>}
          </div>
          {liveTraffic && <div className="rounded-xl border border-border bg-muted/10 p-3"><div className="flex items-center justify-between text-xs mb-2"><span className="font-semibold flex items-center gap-1"><span className="status-dot online" />Live aggregate traffic (5s sampling)</span><span className="text-muted-foreground">↓ {gb(trafficHistory[trafficHistory.length - 1]?.rx)} / ↑ {gb(trafficHistory[trafficHistory.length - 1]?.tx)}</span></div><div className="flex items-end gap-0.5 h-20">{trafficHistory.length ? trafficHistory.map((p,i)=>{ const max=Math.max(1,...trafficHistory.map(x=>x.rx+x.tx)); return <div key={i} className="flex flex-col justify-end gap-0.5 flex-1 h-full"><div className="bg-teal/80 rounded-t" style={{height:`${Math.max(2,(p.rx/max)*72)}px`}} title={`Rx ${gb(p.rx)}`} /><div className="bg-purple/80" style={{height:`${Math.max(1,(p.tx/max)*72)}px`}} title={`Tx ${gb(p.tx)}`} /></div>; }) : <div className="text-xs text-muted-foreground w-full text-center self-center">Collecting samples…</div>}</div></div>}
          <div className="overflow-auto"><table className="w-full text-xs min-w-[1040px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border">
              <th className="text-left py-2 px-2"><button onClick={()=>{ if(allSessionsSelected) setSessionSelected({}); else { const m:any={}; sessions.forEach((s,i)=>m[sessionKey(s,i)]=true); setSessionSelected(m);} }} className="p-0.5">{allSessionsSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>
              <th className="text-left py-2 px-2">User</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">IP / MAC</th><th className="text-left py-2 px-2">IPv6</th><th className="text-left py-2 px-2">Package</th><th className="text-left py-2 px-2">NAS / Device / Port</th><th className="text-left py-2 px-2">Rx/Tx (bps)</th><th className="text-left py-2 px-2">Uptime</th><th className="text-left py-2 px-2">Updated</th><th className="text-left py-2 px-2">Action</th>
            </tr></thead><tbody>
              {sessions.map((s, i) => { const k=sessionKey(s,i); return (<tr key={k} className="border-b border-border/50"><td className="py-2 px-2"><button onClick={()=>setSessionSelected(p=>({...p,[k]:!p[k]}))} className="p-0.5">{sessionSelected[k]?<CheckSquare className="w-4 h-4 text-primary"/>:<Square className="w-4 h-4"/>}</button></td><td className="py-2 px-2"><div className="font-semibold">{s.full_name || '-'}</div><div className="text-muted-foreground font-mono">{s.client_code || s.username}</div></td><td className="py-2 px-2">{statusBadge(s.status||'UNKNOWN')}</td><td className="py-2 px-2"><div>{s.ip_address || '-'}</div><div className="text-muted-foreground">{s.mac_address || '-'}</div></td><td className="py-2 px-2"><div>{s.ipv6_address || '-'}</div><div className="text-muted-foreground">{s.ipv6_prefix || ''}</div></td><td className="py-2 px-2">{s.package_name || '-'}</td><td className="py-2 px-2"><div>{s.device || s.nas_ip || '-'}</div><div className="text-muted-foreground">{s.nas_port || ''} {s.nas_ip ? String(s.nas_ip) : ''}</div></td><td className="py-2 px-2"><div>↓ {Number(s.rx_bps||0).toLocaleString()}</div><div>↑ {Number(s.tx_bps||0).toLocaleString()}</div></td><td className="py-2 px-2">{s.uptime_sec ? `${Math.floor(Number(s.uptime_sec)/3600)}h ${Math.floor((Number(s.uptime_sec)%3600)/60)}m` : '-'}</td><td className="py-2 px-2 text-muted-foreground">{dt(s.updated_at)}</td><td className="py-2 px-2"><div className="flex flex-wrap gap-1.5"><button disabled={actionBusy===`dc:${s.username || s.subscriber_id}`} onClick={()=>disconnect(s)} className="btn btn-danger btn-sm"><PlugZap className="w-3 h-3" />{actionBusy===`dc:${s.username || s.subscriber_id}`?'...':'Disconnect'}</button><button disabled={actionBusy===`rc:${s.username || s.subscriber_id}`} onClick={()=>reconnect(s)} className="btn btn-outline btn-sm"><RefreshCcw className="w-3 h-3" />Reconnect</button><button disabled={actionBusy===`ping:${s.subscriber_id}`} onClick={()=>pingTarget({ ...s, id: s.subscriber_id })} className="btn btn-outline btn-sm"><Activity className="w-3 h-3" />Ping</button></div></td></tr>); })}
              {!sessions.length && <tr><td colSpan={11} className="py-8 text-center text-muted-foreground">No session data available.</td></tr>}
            </tbody></table></div>
        </div>
      )}

      {tab === 'balance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3"><Card label="Current Balance" value={money(walletBalance)} icon={Wallet} tone="green" /><Card label="Total Credited" value={money(balance?.totals?.total_credited ?? 0)} icon={ArrowUpRight} tone="green" /><Card label="Total Debited" value={money(balance?.totals?.total_debited ?? 0)} icon={ArrowDownLeft} tone="red" /><Card label="Credit Limit" value={creditLimitApplies ? money(creditLimit) : 'Unlimited'} icon={CreditCard} tone="green" /></div>
          <div className="text-xs text-muted-foreground px-1">{creditLimitApplies ? `Credit limit ${money(creditLimit)} · headroom ${money(creditHeadroom ?? 0)} before recharge is rejected (balance can't exceed the limit).` : 'No credit limit (0 = unlimited).'} Buying margin {marginPct}% → subscriber activation wholesale = package retail × (1 − {marginPct}%); wallet recharge itself is at face value.</div>
          {isResellerUser && <div className="card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-success" />Add Money (payment gateway)</div><div className="text-xs text-muted-foreground">Submit a payment reference; the ISP admin verifies and credits your wallet.</div></div><button onClick={()=>setTopupOpen(true)} className="btn btn-primary btn-sm">Request Top-up</button></div>
            {!!topups.length && <div className="overflow-auto mt-3"><table className="w-full text-xs min-w-[700px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Gateway</th><th className="text-left py-2 px-2">Trx ID</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Note</th></tr></thead><tbody>{topups.map(t=><tr key={t.id} className="border-b border-border/50"><td className="py-2 px-2">{dt(t.created_at)}</td><td className="py-2 px-2 font-semibold">{money(t.amount)}</td><td className="py-2 px-2">{t.gateway}</td><td className="py-2 px-2 font-mono">{t.trx_id || '-'}</td><td className="py-2 px-2">{statusBadge(t.status)}</td><td className="py-2 px-2 text-muted-foreground">{t.rejection_reason || '-'}</td></tr>)}</tbody></table></div>}
          </div>}
          {canRecharge && <div className="card p-4 flex flex-col md:flex-row md:items-end gap-3"><div className="flex-1"><div className="font-bold mb-1 flex items-center gap-2"><Plus className="w-4 h-4 text-success" />Add Money / Recharge</div><div className="text-xs text-muted-foreground mb-2">Recharge prepaid reseller wallet balance.</div><input className="form-control w-full md:w-64" type="number" placeholder="Amount (BDT)" value={rechargeAmount} onChange={e=>setRechargeAmount(e.target.value)} /></div><button onClick={recharge} className="btn btn-primary">Recharge Wallet</button></div>}
          <div className="card p-4 flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <div className="font-bold mb-1 flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" />Recharge via payment gateway</div>
              <div className="text-xs text-muted-foreground mb-2">Reseller self-service. A PENDING payment is created; wallet is credited <span className="font-medium">only after a verified gateway confirmation</span> (not a direct credit).{creditLimitApplies ? ` Max this recharge: ${money(creditHeadroom ?? 0)} (credit limit ${money(creditLimit)}).` : ''}</div>
              <div className="flex flex-wrap gap-2">
                <select className="form-control w-full md:w-44" value={gwName} onChange={e=>setGwName(e.target.value)}>
                  {(gateways.length ? gateways : [{gateway:'bkash'}]).map((g:any)=><option key={g.gateway||g.id||g.name} value={String(g.gateway||g.id||g.name).toLowerCase()}>{g.gateway||g.id||g.name}</option>)}
                </select>
                <input className="form-control w-full md:w-40" type="number" placeholder="Amount (BDT)" value={gwRechargeAmount} onChange={e=>setGwRechargeAmount(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={rechargeGateway} disabled={gwBusy} className="btn btn-primary">{gwBusy ? 'Starting…' : 'Pay & recharge'}</button>
              <button onClick={()=>refreshWallet()} className="btn btn-outline btn-sm"><RefreshCw className="w-3.5 h-3.5" />Refresh status</button>
            </div>
          </div>
          {!!pendingRechargeActive.length && (
            <div className="card p-4">
              <div className="font-bold mb-2 flex items-center gap-2"><Clock3 className="w-4 h-4 text-warning" />Pending gateway recharges <span className="text-xs font-normal text-muted-foreground">(PENDING verification — not yet credited)</span></div>
              <div className="space-y-1.5">
                {pendingRechargeActive.map(p => (
                  <div key={p.payment_ref} className="flex flex-wrap items-center justify-between gap-2 text-xs border border-border/50 rounded-lg p-2">
                    <div><span className="font-mono">{p.payment_ref}</span> · {money(p.amount)} · {p.gateway} · {dt(p.at)}</div>
                    <div className="flex items-center gap-1.5">{statusBadge('PENDING')}<button onClick={()=>refreshWallet()} className="btn btn-outline btn-sm">Check</button><button onClick={()=>removePendingRecharge(p.payment_ref)} className="btn btn-outline btn-sm" title="Stop tracking (does not cancel the payment)">Dismiss</button></div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-2">Complete payment at your gateway. Wallet credit appears here once the gateway's verified webhook arrives; this list never implies money was added. If it was cancelled, nothing is charged.</div>
            </div>
          )}
          <div className="card p-4"><h2 className="font-bold mb-3">Partner Balance Report (Ledger)</h2><div className="overflow-auto"><table className="w-full text-xs min-w-[900px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Subscriber</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Balance After</th><th className="text-left py-2 px-2">Comments</th><th className="text-left py-2 px-2">Added By</th></tr></thead><tbody>{(balance?.transactions || []).map((t: any) => (<tr key={t.id} className="border-b border-border/50"><td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{dt(t.created_at)}</td><td className="py-2 px-2"><div className="font-medium">{t.type}</div><div className="text-muted-foreground">{t.direction}</div></td><td className="py-2 px-2">{t.subscriber_name || t.client_code || t.subscriber_username || '-'}</td><td className={`py-2 px-2 font-semibold ${t.direction==='CREDIT'?'text-success':'text-danger'}`}>{t.direction==='CREDIT'?'+':'-'}{money(t.amount)}</td><td className="py-2 px-2 font-medium">{money(t.balance_after)}</td><td className="py-2 px-2 max-w-[280px] truncate" title={t.description || ''}>{t.description || '-'}</td><td className="py-2 px-2 text-muted-foreground">{t.created_by || '-'}</td></tr>))}{!(balance?.transactions || []).length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No transactions found.</td></tr>}</tbody></table></div></div>
        </div>
      )}

      {tab === 'sharing' && (<div className="card p-4 space-y-3"><h2 className="font-bold flex items-center gap-2"><ArrowLeftRight className="w-4 h-4 text-primary" />Partner Sharing Report</h2><p className="text-xs text-muted-foreground">Derived from reseller wallet renewals (retail vs wholesale/margin). Partner share = charged to reseller wallet; ISP share = retail − partner share.</p><div className="overflow-auto"><table className="w-full text-xs min-w-[1000px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">User</th><th className="text-left py-2 px-2">Package</th><th className="text-left py-2 px-2">Invoice</th><th className="text-left py-2 px-2">Plan Price</th><th className="text-left py-2 px-2">Offer / VAT</th><th className="text-left py-2 px-2">Total Invoice</th><th className="text-left py-2 px-2">Partner Share</th><th className="text-left py-2 px-2">ISP Share</th><th className="text-left py-2 px-2">Margin %</th><th className="text-left py-2 px-2">Payment Ref</th><th className="text-left py-2 px-2">Partner</th><th className="text-left py-2 px-2">Partner Amount</th><th className="text-left py-2 px-2">Renewed By</th></tr></thead><tbody>{sharing.map((r: any) => (<tr key={r.id} className="border-b border-border/50"><td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{dt(r.date)}</td><td className="py-2 px-2"><div className="font-medium">{r.full_name || '-'}</div><div className="text-muted-foreground font-mono">{r.client_code || r.username}</div></td><td className="py-2 px-2">{r.package_name || '-'}</td><td className="py-2 px-2 font-mono">{r.invoice_number || '-'}</td><td className="py-2 px-2">{money(r.retail)}</td><td className="py-2 px-2">{money(r.invoice_discount)} / {money(r.invoice_vat)}</td><td className="py-2 px-2">{money(r.invoice_total || r.retail)}</td><td className="py-2 px-2 text-success font-semibold">{money(r.partner_share)}</td><td className="py-2 px-2 text-teal font-semibold">{money(r.isp_share)}</td><td className="py-2 px-2">{Number(r.margin_percent || 0)}%</td><td className="py-2 px-2 font-mono text-muted-foreground">{r.payment_ref || '-'}</td><td className="py-2 px-2">{r.partner_name || '-'}</td><td className="py-2 px-2 text-success">{money(r.partner_amount)}</td><td className="py-2 px-2 text-muted-foreground">{r.created_by || '-'}</td></tr>))}{!sharing.length && <tr><td colSpan={14} className="py-8 text-center text-muted-foreground">No sharing/renewal records found.</td></tr>}</tbody></table></div></div>)}

      {tab === 'payments' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card label="Total Collected" value={money(paySummary.total_collected ?? 0)} icon={CreditCard} tone="green" />
            <Card label="Total Pending" value={money(paySummary.total_pending ?? 0)} icon={Clock3} tone="amber" />
            <div className="card p-4 md:col-span-2 grid grid-cols-2 lg:grid-cols-4 gap-2">
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">View</div><select className="form-select w-full" value={payKind} onChange={e=>setPayKind(e.target.value as any)}><option value="all">All</option><option value="invoice">Invoice</option><option value="online">Online</option></select></label>
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Status</div><select className="form-select w-full" value={payStatus} onChange={e=>setPayStatus(e.target.value)}><option value="">All</option>{['COMPLETED','PENDING','FAILED','CANCELLED','REFUNDED','VERIFYING'].map(s=><option key={s} value={s}>{s}</option>)}</select></label>
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Gateway</div><select className="form-select w-full" value={payGateway} onChange={e=>setPayGateway(e.target.value)}><option value="">All</option>{payGateways.map(g=><option key={g} value={g}>{g}</option>)}</select></label>
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Method</div><select className="form-select w-full" value={payMethod} onChange={e=>setPayMethod(e.target.value)}><option value="">All</option>{payMethods.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Payment Type</div><select className="form-select w-full" value={payType} onChange={e=>setPayType(e.target.value)}><option value="">All</option>{payTypes.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Approval</div><select className="form-select w-full" value={payApproval} onChange={e=>setPayApproval(e.target.value)}><option value="">All</option>{payApprovals.map(a=><option key={a} value={a}>{a}</option>)}</select></label>
              <label className="block lg:col-span-2"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Search</div><div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="form-control w-full pl-8" placeholder="User, invoice, trx, collector, type..." value={payQ} onChange={e=>setPayQ(e.target.value)} /></div></label>
            </div>
          </div>
          {!!gatewayBreakdown.length && <div className="card p-4"><div className="font-semibold text-sm mb-2">Gateway Breakdown</div><div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">{gatewayBreakdown.map(([g,v])=> (<div key={g} className="p-2.5 rounded-xl border border-border bg-muted/20"><div className="text-[11px] text-muted-foreground truncate">{g}</div><div className="font-bold">{money(v.amount)}</div><div className="text-[10px] text-muted-foreground">{v.count} txn</div></div>))}</div></div>}
          <div className="card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />{payKind === 'online' ? 'Online Payments' : payKind === 'invoice' ? 'Invoice Payments' : 'Billing / Payments'} <span className="text-xs text-muted-foreground font-normal">({filteredPayments.length})</span></h2>
            <div className="overflow-auto"><table className="w-full text-xs min-w-[1200px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">User</th><th className="text-left py-2 px-2">Invoice</th><th className="text-left py-2 px-2">Gateway/Method</th><th className="text-left py-2 px-2">Type / Collector</th><th className="text-left py-2 px-2">Ref/Trx</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Approval</th></tr></thead><tbody>
              {filteredPayments.map((p: any) => (<tr key={p.id} className="border-b border-border/50"><td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{dt(p.verified_at || p.created_at)}</td><td className="py-2 px-2"><div className="font-medium">{p.full_name || '-'}</div><div className="text-muted-foreground font-mono">{p.client_code || p.username}</div></td><td className="py-2 px-2">{p.invoice_number || '-'}</td><td className="py-2 px-2"><div>{p.gateway || '-'}</div><div className="text-muted-foreground">{p.method || '-'}</div></td><td className="py-2 px-2"><div>{p.payment_type || '-'}</div><div className="text-muted-foreground">{p.collector_name || '-'}</div></td><td className="py-2 px-2 font-mono text-muted-foreground max-w-[180px] truncate" title={p.trx_id || p.payment_ref}>{p.trx_id || p.payment_ref || '-'}</td><td className="py-2 px-2 font-semibold">{money(p.amount)}</td><td className="py-2 px-2">{statusBadge(p.status)}</td><td className="py-2 px-2"><div className="flex items-center gap-2">{statusBadge(p.approval_status || 'APPROVED')}{canManageResellerUsers && <button onClick={()=>openEditPayment(p)} className="px-2 py-1 rounded-lg border border-border text-[10px] font-semibold">Edit</button>}</div>{p.approval_note ? <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[140px] truncate" title={p.approval_note}>{p.approval_note}</div> : null}</td></tr>))}
              {!filteredPayments.length && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No payments found.</td></tr>}
            </tbody></table></div></div>
        </div>
      )}

      {tab === 'onus' && (<div className="card p-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold flex items-center gap-2"><RadioTower className="w-4 h-4 text-primary" />ONU List <span className="text-xs text-muted-foreground font-normal">({onus.length})</span></h2><div className="flex items-center gap-2 flex-wrap"><div className="text-xs text-muted-foreground">Assign/link an ONU to one of this reseller’s subscribers (scoped).</div>{canManageResellerUsers && <button onClick={async ()=>{ const next = !showUnlinkedOnus; setShowUnlinkedOnus(next); await loadOnus(next).catch(()=>{}); }} className={`btn btn-sm ${showUnlinkedOnus ? 'btn-primary' : 'btn-outline'}`}>{showUnlinkedOnus ? 'Showing Unlinked/Discovered' : 'Show Unlinked/Discovered'}</button>}</div></div>
        <div className="flex items-center gap-2 flex-wrap"><button onClick={()=>setShowOnuFilters(v=>!v)} className="btn btn-outline btn-sm">Advanced ONU Filters</button><button onClick={()=>loadOnus()} className="btn btn-outline btn-sm">Refresh</button></div>
        {showOnuFilters && <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 p-3 rounded-xl border border-border bg-muted/20">
          {[
            ['serial','Serial Number',''], ['mac','MAC Address',''], ['match','User Match',''], ['port','PON Port',''],
            ['olt_id','OLT ID',''], ['status','Status (UP/DOWN)',''], ['rx_min','RX min (dBm)',''], ['rx_max','RX max (dBm)',''],
            ['dist_min','Distance min (m)',''], ['dist_max','Distance max (m)',''],
          ].map(([key,label,ph]) => <label key={key} className="block"><span className="form-label">{label}</span><input className="form-control" placeholder={ph} value={onuFilters[key] || ''} onChange={e=>setOnuFilters(f=>({...f,[key]:e.target.value}))} /></label>)}
          <div className="flex items-end gap-2"><button onClick={()=>loadOnus()} className="btn btn-primary btn-sm">Apply</button><button onClick={()=>{ setOnuFilters({}); loadOnus(); }} className="btn btn-outline btn-sm">Reset</button></div>
        </div>}
        <div className="overflow-auto"><table className="w-full text-xs min-w-[1100px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Subscriber</th><th className="text-left py-2 px-2">ONU/Serial</th><th className="text-left py-2 px-2">Vendor / Model</th><th className="text-left py-2 px-2">OLT/Slot/Port</th><th className="text-left py-2 px-2">User Match</th><th className="text-left py-2 px-2">RX Power</th><th className="text-left py-2 px-2">Optical DBM / Speed</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Last Sync</th><th className="text-left py-2 px-2">Assign / Link</th></tr></thead><tbody>{onus.map((o: any, i: number) => (<tr key={o.id || i} className="border-b border-border/50"><td className="py-2 px-2"><div className="font-medium">{o.subscriber_name || (o._unlinked ? <span className="text-warning">Unlinked / Discovered</span> : '-')}</div><div className="text-muted-foreground font-mono">{o.client_code || o.username || ''}</div></td><td className="py-2 px-2"><div>{o.onu_name || o.name || '-'}</div><div className="text-muted-foreground font-mono">{o.serial_number || o.onu_serial || o.mac_address || '-'}</div></td><td className="py-2 px-2"><div>{o.vendor || '-'}</div><div className="text-muted-foreground">{o.model || '-'}</div></td><td className="py-2 px-2"><div>{o.olt_name || o.olt_id || '-'}</div><div className="text-muted-foreground">{[o.slot_no || o.slot, o.pon_port || o.port, o.onu_id].filter(v=>v!=null).join('/') || '-'}</div></td><td className="py-2 px-2 font-mono">{o.user_id_match || '-'}</td><td className="py-2 px-2">{o.rx_power_dbm ?? o.rx_power ?? o.rx_dbm ?? o.onu_rx_power ?? '-'}</td><td className="py-2 px-2"><div>{o.optical_dbm_temp ?? o.temperature_c ?? '-'}</div><div className="text-muted-foreground">{o.speed || '-'}</div></td><td className="py-2 px-2">{statusBadge(o.status || o.onu_status || '-')}</td><td className="py-2 px-2 text-muted-foreground">{dt(o.last_sync || o.last_sync_time || o.updated_at)}</td><td className="py-2 px-2"><div className="flex items-center gap-1.5"><select className="form-select !h-8 !text-[11px] max-w-[220px]" value={onuAssign[o.id] || o.subscriber_id || ''} onChange={e=>setOnuAssign(p=>({...p,[o.id]:e.target.value}))}><option value="">Select subscriber...</option>{users.map(u=> <option key={u.id} value={u.id}>{u.full_name || u.username} ({u.client_code || u.username})</option>)}</select><button disabled={actionBusy===`onu:${o.id}`} onClick={()=>assignOnu(o.id)} className="btn btn-primary btn-sm">{actionBusy===`onu:${o.id}`?'...':'Assign'}</button></div>{o._unlinked && !canManageResellerUsers && <div className="text-[10px] text-muted-foreground mt-1">Admin/billing required</div>}</td></tr>))}{!onus.length && <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">No ONU records found. {canManageResellerUsers ? 'Try “Show Unlinked/Discovered” to assign discovered ONUs to reseller subscribers.' : 'No linked ONU records found for this reseller’s subscribers.'}</td></tr>}</tbody></table></div></div>)}

      {tab === 'logs' && (<div className="space-y-4">
          <div className="card p-4 flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Log Type</div><select className="form-select w-full" value={logKind} onChange={e=>setLogKind(e.target.value as any)}><option value="all">All Logs</option><option value="wallet">Wallet / Activity</option><option value="audit">Audit / System</option><option value="auth">User Auth / Session</option></select></label>
              <label className="block md:col-span-2"><div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Search</div><div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="form-control w-full pl-8" placeholder="Search action, actor, username, IP/MAC, description..." value={logQ} onChange={e=>setLogQ(e.target.value)} /></div></label>
            </div>
            <div className="text-xs text-muted-foreground flex gap-3"><span>Wallet: <b className="text-foreground">{(logs.wallet||[]).length}</b></span><span>Audit: <b className="text-foreground">{(logs.audit||[]).length}</b></span><span>Auth: <b className="text-foreground">{(logs.auth||[]).length}</b></span></div>
          </div>
          <div className="card p-3 flex flex-wrap items-end gap-2 text-xs">
            {([['from','From date'],['to','To date'],['event','Event'],['manager','Manager'],['user','User'],['agent','Agent'],['ip','IP']] as [string,string][]).map(([k,label])=><label key={k} className="block"><span className="form-label">{label}</span><input type={k==='from'||k==='to'?'date':'text'} className="form-control" value={logFilters[k] || ''} onChange={e=>setLogFilters(f=>({...f,[k]:e.target.value}))} /></label>)}
            <button onClick={()=>loadLogs()} className="btn btn-outline btn-sm">Apply</button><button onClick={()=>{ setLogFilters({from:'',to:'',event:'',manager:'',user:'',agent:'',ip:''}); loadLogs(); }} className="btn btn-outline btn-sm">Reset</button>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {(logKind === 'all' || logKind === 'wallet') && <div className="card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><ScrollText className="w-4 h-4 text-primary" />Wallet / Activity Log <span className="text-xs text-muted-foreground font-normal">({(logs.wallet||[]).length})</span></h2><div className="overflow-auto max-h-[420px]"><table className="w-full text-xs min-w-[520px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">By</th><th className="text-left py-2 px-2">Desc</th></tr></thead><tbody>{(logs.wallet || []).map((l: any) => (<tr key={l.id} className="border-b border-border/50"><td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{dt(l.created_at)}</td><td className="py-2 px-2">{l.type}</td><td className={`py-2 px-2 font-semibold ${l.direction==='CREDIT'?'text-success':'text-danger'}`}>{l.direction==='CREDIT'?'+':'-'}{money(l.amount)}</td><td className="py-2 px-2 text-muted-foreground">{l.created_by || '-'}</td><td className="py-2 px-2 max-w-[220px] truncate" title={l.description||''}>{l.description||'-'}</td></tr>))}{!(logs.wallet||[]).length && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No wallet logs.</td></tr>}</tbody></table></div></div>}
            {(logKind === 'all' || logKind === 'audit') && <div className="card p-4"><h2 className="font-bold mb-3 flex items-center gap-2"><ScrollText className="w-4 h-4 text-primary" />Audit / System Log <span className="text-xs text-muted-foreground font-normal">({(logs.audit||[]).length})</span></h2><div className="overflow-auto max-h-[420px]"><table className="w-full text-xs min-w-[520px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Action</th><th className="text-left py-2 px-2">Actor</th><th className="text-left py-2 px-2">Entity</th></tr></thead><tbody>{(logs.audit || []).map((l: any) => (<tr key={l.id} className="border-b border-border/50"><td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{dt(l.created_at)}</td><td className="py-2 px-2 font-medium">{l.action}</td><td className="py-2 px-2 text-muted-foreground">{l.actor_name || l.actor_role || '-'}</td><td className="py-2 px-2 text-muted-foreground">{l.entity_type}{l.entity_id ? `:${String(l.entity_id).slice(0,8)}` : ''}</td></tr>))}{!(logs.audit||[]).length && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No audit logs found.</td></tr>}</tbody></table></div></div>}
            {(logKind === 'all' || logKind === 'auth') && <div className={`card p-4 ${logKind==='all'?'xl:col-span-2':''}`}><h2 className="font-bold mb-3 flex items-center gap-2"><ScrollText className="w-4 h-4 text-primary" />User Auth / Session Log <span className="text-xs text-muted-foreground font-normal">({(logs.auth||[]).length})</span></h2><div className="overflow-auto max-h-[360px]"><table className="w-full text-xs min-w-[900px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Username</th><th className="text-left py-2 px-2">IP / MAC</th><th className="text-left py-2 px-2">Start</th><th className="text-left py-2 px-2">Stop</th><th className="text-left py-2 px-2">Status/Cause</th></tr></thead><tbody>{(logs.auth || []).map((l: any, i: number) => (<tr key={l.id || i} className="border-b border-border/50"><td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{dt(l.created_at || l.timestamp || l.acctstarttime)}</td><td className="py-2 px-2 font-mono">{l.username || '-'}</td><td className="py-2 px-2">{l.ip_address || l.framedipaddress || '-'}<div className="text-muted-foreground">{l.mac_address || l.callingstationid || '-'}</div></td><td className="py-2 px-2 text-muted-foreground">{dt(l.acctstarttime || l.start_time)}</td><td className="py-2 px-2 text-muted-foreground">{dt(l.acctstoptime || l.stop_time)}</td><td className="py-2 px-2">{l.status || l.acctterminatecause || l.result || '-'}</td></tr>))}{!(logs.auth||[]).length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No auth/session logs available.</td></tr>}</tbody></table></div></div>}
          </div>
        </div>)}

      {tab === 'notifications' && (<div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold flex items-center gap-2"><BellRing className="w-4 h-4 text-primary" />Notification Log <span className="text-xs text-muted-foreground font-normal">({notifLog.length}{notifUnread ? ` · ${notifUnread} unread` : ''})</span></h2><div className="flex gap-2"><button onClick={()=>loadNotifLog()} className="btn btn-outline btn-sm">Refresh</button><button onClick={async()=>{ if(!token)return; await apiFetch(`/api/resellers/${resellerId}/notifications/read-all`,{method:'POST'},token); await loadNotifLog().catch(()=>{}); }} className="btn btn-outline btn-sm">Mark all read</button></div></div>
        <div className="overflow-auto"><table className="w-full text-xs min-w-[620px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Title</th><th className="text-left py-2 px-2">Message</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Action</th></tr></thead><tbody>
          {notifLog.map(n=><tr key={n.id} className={`border-b border-border/50 ${!n.is_read?'bg-primary/5':''}`}><td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{dt(n.created_at)}</td><td className="py-2 px-2">{n.kind}</td><td className="py-2 px-2 font-semibold">{n.title}</td><td className="py-2 px-2 max-w-[320px] truncate" title={n.message||''}>{n.message||'-'}</td><td className="py-2 px-2">{n.is_read?<span className="text-muted-foreground">Read</span>:<span className="text-primary font-semibold">Unread</span>}</td><td className="py-2 px-2">{!n.is_read&&<button onClick={async()=>{ if(!token)return; await apiFetch(`/api/resellers/${resellerId}/notifications/${n.id}/read`,{method:'POST'},token); await loadNotifLog().catch(()=>{}); }} className="btn btn-outline btn-sm">Mark read</button>}</td></tr>)}
          {!notifLog.length&&<tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No notifications yet. Alerts are recorded here as they are generated.</td></tr>}
        </tbody></table></div>
      </div>)}

      {tab === 'branches' && (<div className="card p-4 space-y-3">
        <h2 className="font-bold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Branches</h2>
        <div className="flex flex-wrap items-end gap-2">{([['name','Name'],['code','Code'],['address','Address']] as [string,string][]).map(([k,l])=><label key={k} className="block"><span className="form-label">{l}</span><input className="form-control" value={branchForm[k] || ''} onChange={e=>setBranchForm(f=>({...f,[k]:e.target.value}))} /></label>)}<button onClick={saveBranch} className="btn btn-primary btn-sm">Add Branch</button></div>
        <div className="overflow-auto"><table className="w-full text-xs min-w-[500px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Name</th><th className="text-left py-2 px-2">Code</th><th className="text-left py-2 px-2">Address</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Action</th></tr></thead><tbody>{branches.map(b=><tr key={b.id} className="border-b border-border/50"><td className="py-2 px-2 font-semibold">{b.name}</td><td className="py-2 px-2">{b.code||'-'}</td><td className="py-2 px-2">{b.address||'-'}</td><td className="py-2 px-2">{statusBadge(b.status)}</td><td className="py-2 px-2"><button onClick={()=>deleteBranch(b.id)} className="btn btn-outline btn-sm text-danger">Delete</button></td></tr>)}{!branches.length&&<tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No branches yet. Add one to organise your subscribers.</td></tr>}</tbody></table></div>
      </div>)}

      {tab === 'complaints' && (<div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" />Complaints <span className="text-xs text-muted-foreground font-normal">({complaints.length})</span></h2>
          <div className="flex gap-2"><button onClick={()=>loadComplaints()} className="btn btn-outline btn-sm"><RefreshCw className="w-3.5 h-3.5" />Refresh</button><button onClick={()=>setComplaintOpen(true)} className="btn btn-primary btn-sm"><Plus className="w-3.5 h-3.5" />File Complaint</button></div>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="block"><span className="form-label">Search</span><input className="form-control" placeholder="Ticket #, subject, customer..." value={complaintFilters.q || ''} onChange={e=>setComplaintFilters((f:any)=>({...f,q:e.target.value}))} /></label>
          <label className="block"><span className="form-label">Status</span><select className="form-control" value={complaintFilters.status || ''} onChange={e=>setComplaintFilters((f:any)=>({...f,status:e.target.value}))}><option value="">All statuses</option>{['OPEN','IN_PROGRESS','RESOLVED','CLOSED'].map(s=><option key={s}>{s}</option>)}</select></label>
          <button onClick={()=>loadComplaints()} className="btn btn-outline btn-sm">Apply</button>
        </div>
        <div className="overflow-auto"><table className="w-full text-xs min-w-[950px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Ticket</th><th className="text-left py-2 px-2">Subject</th><th className="text-left py-2 px-2">Subscriber</th><th className="text-left py-2 px-2">Category</th><th className="text-left py-2 px-2">Priority</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">SLA Due</th><th className="text-left py-2 px-2">Opened</th><th className="text-left py-2 px-2">Action</th></tr></thead><tbody>
          {complaints.map(c => {
            const breached = c.sla_due_at && !['RESOLVED','CLOSED'].includes(String(c.status).toUpperCase()) && new Date(c.sla_due_at).getTime() < Date.now();
            return (<tr key={c.id} className="border-b border-border/50">
              <td className="py-2 px-2 font-mono">{c.ticket_no}</td>
              <td className="py-2 px-2 max-w-[260px] truncate" title={c.description || ''}>{c.subject}</td>
              <td className="py-2 px-2">{c.subscriber_name || '-'}<div className="text-muted-foreground font-mono">{c.client_code || ''}</div></td>
              <td className="py-2 px-2">{c.category}</td>
              <td className="py-2 px-2"><span className={`badge ${c.priority==='CRITICAL'?'badge-danger':c.priority==='HIGH'?'badge-warning':'badge-secondary'}`}>{c.priority}</span></td>
              <td className="py-2 px-2">{statusBadge(c.status)}</td>
              <td className={`py-2 px-2 whitespace-nowrap ${breached?'text-danger font-semibold':'text-muted-foreground'}`}>{dt(c.sla_due_at)}</td>
              <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{dt(c.opened_at || c.created_at)}</td>
              <td className="py-2 px-2"><button onClick={()=>openComplaint(c.id)} className="btn btn-outline btn-sm"><Eye className="w-3 h-3" />View</button></td>
            </tr>);
          })}
          {!complaints.length && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No complaints filed yet. Use “File Complaint” to open one with ISP support.</td></tr>}
        </tbody></table></div>
      </div>)}

      {tab === 'parental' && (<div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold flex items-center gap-2"><Ban className="w-4 h-4 text-primary" />Parental Control <span className="text-xs text-muted-foreground font-normal">({parentalEnabledCount} protected)</span></h2>
          <button onClick={()=>loadParental()} className="btn btn-outline btn-sm"><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
        </div>
        <p className="text-xs text-muted-foreground">Enforced via RADIUS address list <code className="font-mono">izn-parental-control</code>, or a filtered PPPoE profile for direct-router subscribers. Configure the matching policy on your routers.</p>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="block"><span className="form-label">Search</span><input className="form-control" placeholder="Name, username, client code, phone..." value={parentalFilters.q || ''} onChange={e=>setParentalFilters((f:any)=>({...f,q:e.target.value}))} /></label>
          <label className="block"><span className="form-label">Filter</span><select className="form-control" value={parentalFilters.enabled || ''} onChange={e=>setParentalFilters((f:any)=>({...f,enabled:e.target.value}))}><option value="">All users</option><option value="1">Protected only</option><option value="0">Unprotected only</option></select></label>
          <button onClick={()=>loadParental()} className="btn btn-outline btn-sm">Apply</button>
        </div>
        <div className="overflow-auto"><table className="w-full text-xs min-w-[760px]"><thead className="text-muted-foreground uppercase"><tr className="border-b border-border"><th className="text-left py-2 px-2">Customer</th><th className="text-left py-2 px-2">Username</th><th className="text-left py-2 px-2">Phone</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Package</th><th className="text-left py-2 px-2">Parental Control</th></tr></thead><tbody>
          {parental.map(s => (<tr key={s.id} className="border-b border-border/50">
            <td className="py-2 px-2 font-semibold">{s.full_name || '-'}<div className="text-muted-foreground font-mono font-normal">{s.client_code || ''}</div></td>
            <td className="py-2 px-2 font-mono">{s.username || '-'}</td>
            <td className="py-2 px-2">{s.phone || '-'}</td>
            <td className="py-2 px-2">{statusBadge(s.status)}</td>
            <td className="py-2 px-2">{s.package_name || '-'}</td>
            <td className="py-2 px-2"><button onClick={()=>toggleParental(s.id,!s.parental_control_enabled)} className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${s.parental_control_enabled?'border-success/30 text-success bg-success/10':'border-border text-muted-foreground'}`}><span className={`w-2 h-2 rounded-full ${s.parental_control_enabled?'bg-success':'bg-muted-foreground/50'}`} />{s.parental_control_enabled?'Enabled':'Disabled'}</button></td>
          </tr>))}
          {!parental.length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No subscribers match this filter.</td></tr>}
        </tbody></table></div>
      </div>)}

      {complaintOpen && (<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setComplaintOpen(false)}><div className="w-full max-w-xl card p-4 space-y-3" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" />File a Complaint</h3><button onClick={()=>setComplaintOpen(false)} className="p-1 rounded"><X className="w-4 h-4" /></button></div>
        <p className="text-xs text-muted-foreground">Your complaint is routed to ISP support and visible to you here. Only your own subscribers can be selected.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="block md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Subject *</div><input className="form-control" value={complaintForm.subject || ''} onChange={e=>setComplaintForm((f:any)=>({...f,subject:e.target.value}))} /></label>
          <label className="block md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Subscriber (optional)</div><select className="form-select" value={complaintForm.subscriber_id || ''} onChange={e=>setComplaintForm((f:any)=>({...f,subscriber_id:e.target.value}))}><option value="">General complaint</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.client_code || u.username})</option>)}</select></label>
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Category</div><select className="form-select" value={complaintForm.category || 'COMPLAINT'} onChange={e=>setComplaintForm((f:any)=>({...f,category:e.target.value}))}>{['COMPLAINT','SUPPORT','BILLING','NETWORK','OTHER'].map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Priority</div><select className="form-select" value={complaintForm.priority || 'MEDIUM'} onChange={e=>setComplaintForm((f:any)=>({...f,priority:e.target.value}))}>{['LOW','MEDIUM','HIGH','CRITICAL'].map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="block md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Description</div><textarea className="form-control min-h-[90px]" value={complaintForm.description || ''} onChange={e=>setComplaintForm((f:any)=>({...f,description:e.target.value}))} /></label>
        </div>
        <div className="flex justify-end gap-2"><button onClick={()=>setComplaintOpen(false)} className="px-3 py-2 rounded-xl border border-border text-sm">Cancel</button><button disabled={complaintBusy} onClick={createComplaint} className="btn btn-primary">{complaintBusy?'Submitting…':'Submit Complaint'}</button></div>
      </div></div>)}

      {complaintDetail && (<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setComplaintDetail(null)}><div className="w-full max-w-2xl card p-4 space-y-3 max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" />{complaintDetail.ticket_no} — {complaintDetail.subject}</h3><button onClick={()=>setComplaintDetail(null)} className="p-1 rounded"><X className="w-4 h-4" /></button></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">{[['Status', statusBadge(complaintDetail.status)], ['Priority', complaintDetail.priority], ['Category', complaintDetail.category], ['Subscriber', complaintDetail.subscriber_name || '-']].map(([k,v]:any)=><div key={k} className="p-2 rounded-xl border border-border bg-muted/20"><div className="text-muted-foreground">{k}</div><div className="font-semibold mt-0.5">{v}</div></div>)}</div>
        {complaintDetail.description && <div className="text-sm p-3 rounded-xl border border-border bg-muted/20">{complaintDetail.description}</div>}
        <div className="text-xs text-muted-foreground">Opened {dt(complaintDetail.opened_at || complaintDetail.created_at)} · SLA due {dt(complaintDetail.sla_due_at)}</div>
        <div className="space-y-2"><div className="font-semibold text-sm">Conversation</div><div className="max-h-56 overflow-auto space-y-2">{(complaintDetail.comments || []).map((c:any)=><div key={c.id} className="p-2.5 rounded-xl border border-border bg-muted/20"><div className="text-[11px] text-muted-foreground">{c.author_role} · {c.author_name} · {dt(c.created_at)}</div><div className="text-sm mt-0.5">{c.body}</div></div>)}{!(complaintDetail.comments || []).length && <div className="text-xs text-muted-foreground py-3 text-center">No comments yet.</div>}</div>
          <div className="flex gap-2"><input className="flex-1 p-2 rounded-xl border border-border bg-background text-sm" placeholder="Add a comment..." value={complaintComment} onChange={e=>setComplaintComment(e.target.value)} /><button disabled={complaintBusy || !complaintComment.trim()} onClick={addComplaintComment} className="btn btn-outline btn-sm"><Send className="w-3.5 h-3.5" />Send</button></div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><button disabled={complaintBusy} onClick={()=>updateComplaintStatus('IN_PROGRESS')} className="btn btn-outline btn-sm">In Progress</button><button disabled={complaintBusy} onClick={()=>updateComplaintStatus('RESOLVED')} className="btn btn-primary btn-sm">Mark Resolved</button><button disabled={complaintBusy} onClick={()=>updateComplaintStatus('OPEN')} className="btn btn-outline btn-sm">Reopen</button></div>
      </div></div>)}

      {parityKeys.has(tab) && <ResellerParityPanel tab={tab as ParityTab} resellerId={resellerId} />}

      {wizard && (
        <SubscriberFormWizard
          initial={wizard.initial || null}
          showExtraFields={!!wizard.initial}
          lockedResellerId={resellerId}
          lockedResellerName={reseller?.name || reseller?.company_name || 'My Reseller Account'}
          token={token}
          onCancel={() => setWizard(null)}
          onSaved={(r: any) => {
            setMsg(wizard.initial
              ? `Updated ${r?.full_name || wizard.initial?.full_name || wizard.initial?.username || 'subscriber'}.`
              : `Subscriber created: ${r?.client_code || r?.username || 'successfully'}`);
            setWizard(null);
            Promise.all([loadUsers().catch(()=>{}), loadDashboard().catch(()=>{})]);
          }}
        />
      )}

      {viewUser && (<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setViewUser(null)}><div className="w-full max-w-5xl card p-4 space-y-3 max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Eye className="w-4 h-4 text-primary" />Customer 360° — {viewUser.full_name || viewUser.username}</h3><div className="flex items-center gap-2"><button onClick={()=>{ setPayMode('ADD'); setPayOpen(true); }} className="btn btn-outline btn-sm">Add Money</button><button onClick={()=>{ setPayMode('PAY'); setPayOpen(true); }} className="btn btn-primary btn-sm"><CreditCard className="w-3.5 h-3.5" />Pay Now</button><button onClick={()=>setViewUser(null)} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button></div></div>
        <div className="text-xs text-muted-foreground">{viewUser.client_code || viewUser.username} • {statusBadge(viewUser.status)} • {detailLoading ? 'Loading full detail…' : customerDetail ? 'Live scoped data' : 'Basic detail (extended data unavailable)'}</div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">{['basic','online','onu','renewal','traffic','sessions','finance','documents','logs'].map(k=><button key={k} onClick={()=>setDetailTab(k)} className={`shrink-0 px-2.5 py-1.5 rounded-lg border text-xs capitalize ${detailTab===k?'bg-primary text-primary-foreground border-primary':'border-border text-muted-foreground'}`}>{k}</button>)}</div>
        <div className="min-h-[220px] text-sm">
          {detailTab === 'basic' && <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {[
              ['Full Name',viewUser.full_name], ['Username',viewUser.username], ['Status',viewUser.status],
              ['Connection',viewUser.connection_type || viewUser.provisioning_mode], ['Package',viewUser.package_name], ['Bandwidth',viewUser.bandwidth_mbps ? `${viewUser.bandwidth_mbps} Mbps` : '-'],
              ['Monthly Bill',money(viewUser.monthly_bill)], ['Due',money(viewUser.current_due)], ['Excess',money(customerDetail?.basic?.excess_amount)],
              ['Expiry',viewUser.expiry_date ? String(viewUser.expiry_date).slice(0,10) : '-'], ['Old Expiry',customerDetail?.basic?.old_expiry_date ? String(customerDetail.basic.old_expiry_date).slice(0,10) : '-'],
              ['IPv4',customerDetail?.basic?.ip_address], ['IPv6',customerDetail?.basic?.ipv6_address], ['IPv6 Prefix',customerDetail?.basic?.ipv6_prefix],
              ['Phone',viewUser.phone], ['Alt Phone',customerDetail?.basic?.alt_phone], ['Email',viewUser.email], ['Alt Email',customerDetail?.basic?.alt_email],
              ['Address',viewUser.address], ['Division',customerDetail?.basic?.division], ['District',customerDetail?.basic?.district], ['Thana',customerDetail?.basic?.thana], ['Block',customerDetail?.basic?.block_no],
              ['MAC Lock',customerDetail?.basic?.mac_lock?'Yes':'No'], ['Static IP',customerDetail?.basic?.static_ip?'Yes':'No'], ['Notes',viewUser.notes],
            ].map(([k,v]: any) => <div key={k} className="flex justify-between gap-3 border-b border-border/40 py-1.5"><span className="text-muted-foreground">{k}</span><span className="font-medium text-right break-all">{String(v ?? '-')}</span></div>)}
          </div>}
          {detailTab === 'online' && <SimpleTable rows={customerDetail?.online || []} cols={[['Status','status'],['IP','ip_address'],['MAC','mac_address'],['Rx bps','rx_bps'],['Tx bps','tx_bps'],['Uptime','uptime_sec'],['Updated','updated_at']]} empty="No active sessions." />}
          {detailTab === 'onu' && <SimpleTable rows={customerDetail?.onu || []} cols={[['ONU','name'],['Serial','serial_number'],['Vendor','vendor'],['Model','model'],['RX dBm','rx_power_dbm'],['Distance','distance_m'],['Status','status']]} empty="No ONU linked." />}
          {detailTab === 'renewal' && <SimpleTable rows={customerDetail?.renewal || []} cols={[['Invoice','invoice_number'],['Status','status'],['Renewal','paid_at'],['Old Expiry','period_start'],['New Expiry','period_end'],['Total','total_amount'],['Paid','paid_amount'],['Due','due_amount']]} empty="No renewals/invoices yet." />}
          {detailTab === 'traffic' && <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{(customerDetail?.traffic || []).map((t:any)=><div key={t.month} className="card p-3"><div className="text-xs text-muted-foreground">{t.month}</div><div className="font-semibold">↓ {gb(t.download_bytes)}</div><div className="font-semibold">↑ {gb(t.upload_bytes)}</div></div>)}</div>}
          {detailTab === 'sessions' && <SimpleTable rows={customerDetail?.sessions || []} cols={[['Start','acctstarttime'],['Stop','acctstoptime'],['IP','ip'],['Download','acctinputoctets'],['Upload','acctoutputoctets'],['Cause','acctterminatecause']]} empty="No RADIUS sessions." />}
          {detailTab === 'finance' && <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><div className="card p-3"><div className="text-xs text-muted-foreground">Total Invoiced</div><div className="font-bold">{money(customerDetail?.finance?.total_invoiced)}</div></div><div className="card p-3"><div className="text-xs text-muted-foreground">Total Paid</div><div className="font-bold text-success">{money(customerDetail?.finance?.total_paid)}</div></div></div><SimpleTable rows={customerDetail?.finance?.payments || []} cols={[['Ref','payment_ref'],['Date','verified_at'],['Type','payment_type'],['Amount','amount'],['Status','status'],['Trx','trx_id']]} empty="No payments yet." />{!!(customerDetail?.finance?.invoices || []).length && <div className="flex flex-wrap gap-2">{(customerDetail?.finance?.invoices || []).map((inv:any)=><button key={inv.id} onClick={()=>printInvoice(inv.id)} className="btn btn-outline btn-sm"><FileText className="w-3 h-3" />Print {inv.invoice_number}</button>)}</div>}</div>}
          {detailTab === 'documents' && <div className="space-y-2">{(customerDetail?.documents || []).map((doc:any)=><div key={doc.id} className="flex items-center justify-between border-b border-border/40 py-2"><span>{doc.doc_type} — {doc.file_name}</span><span className="text-xs text-muted-foreground">{dt(doc.uploaded_at)}</span></div>)}{!(customerDetail?.documents || []).length && <div className="text-muted-foreground text-xs">No KYC documents uploaded.</div>}</div>}
          {detailTab === 'logs' && <SimpleTable rows={customerDetail?.logs || []} cols={[['Time','created_at'],['Action','action'],['Actor','actor_name']]} empty="No audit records." />}
        </div>
        <div className="flex justify-end gap-2"><button onClick={()=>setViewUser(null)} className="px-3 py-2 rounded-xl border border-border text-sm">Close</button>{canAddSubscriber && <button onClick={()=>{ openEdit(viewUser); setViewUser(null); }} className="btn btn-primary"><Edit3 className="w-4 h-4" />Edit</button>}</div>
      </div></div>)}

      {topupOpen && (<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setTopupOpen(false)}><div className="w-full max-w-lg card p-4 space-y-3" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />Request Wallet Top-up</h3><button onClick={()=>setTopupOpen(false)} className="p-1 rounded"><X className="w-4 h-4" /></button></div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Amount (BDT)</div><input type="number" className="form-control" value={topupForm.amount} onChange={e=>setTopupForm(f=>({...f,amount:e.target.value}))} /></label>
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Gateway</div><select className="form-select" value={topupForm.gateway} onChange={e=>setTopupForm(f=>({...f,gateway:e.target.value}))}>{['bKash','Nagad','Rocket','Bank Transfer','SSLCOMMERZ','Other'].map(g=><option key={g}>{g}</option>)}</select></label>
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Method</div><input className="form-control" value={topupForm.method} onChange={e=>setTopupForm(f=>({...f,method:e.target.value}))} placeholder="Billpay / Send Money…" /></label>
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Transaction ID</div><input className="form-control" value={topupForm.trx_id} onChange={e=>setTopupForm(f=>({...f,trx_id:e.target.value}))} /></label>
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Payer Number</div><input className="form-control" value={topupForm.payer_number} onChange={e=>setTopupForm(f=>({...f,payer_number:e.target.value}))} /></label>
          <label className="block"><div className="text-xs text-muted-foreground mb-1">Notes</div><input className="form-control" value={topupForm.notes} onChange={e=>setTopupForm(f=>({...f,notes:e.target.value}))} /></label>
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={!!topupForm.terms_accepted} onChange={e=>setTopupForm(f=>({...f,terms_accepted:e.target.checked}))} /><span>I confirm the payment details are correct and agree to the Terms &amp; Conditions, Privacy Policy and Refund Policy.</span></label>
        <div className="flex justify-end gap-2"><button onClick={()=>setTopupOpen(false)} className="px-3 py-2 rounded-xl border border-border text-sm">Cancel</button><button disabled={topupBusy} onClick={submitTopup} className="btn btn-primary">{topupBusy?'Submitting…':'Submit Request'}</button></div>
      </div></div>)}

      {payOpen && viewUser && (<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setPayOpen(false)}><div className="w-full max-w-md card p-4 space-y-3" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold">{payMode === 'ADD' ? 'Add Money' : 'Pay Now'} — {viewUser.full_name || viewUser.username}</h3><button onClick={()=>setPayOpen(false)} className="p-1 rounded"><X className="w-4 h-4" /></button></div>
        <p className="text-xs text-muted-foreground">Deducted from your prepaid wallet and applied to this subscriber&apos;s invoices (Pay) or excess balance (Add).</p>
        <div className="grid grid-cols-2 gap-3"><label className="block"><div className="text-xs text-muted-foreground mb-1">Amount (BDT)</div><input type="number" className="form-control" value={payForm.amount} onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))} /></label><label className="block"><div className="text-xs text-muted-foreground mb-1">Payment Type</div><input className="form-control" value={payForm.payment_type} onChange={e=>setPayForm(f=>({...f,payment_type:e.target.value}))} placeholder="CASH, bKash…" /></label><label className="block"><div className="text-xs text-muted-foreground mb-1">Transaction Ref</div><input className="form-control" value={payForm.trx_id} onChange={e=>setPayForm(f=>({...f,trx_id:e.target.value}))} /></label><label className="block md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Notes</div><input className="form-control" value={payForm.notes} onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))} /></label></div>
        <div className="flex justify-end gap-2"><button onClick={()=>setPayOpen(false)} className="px-3 py-2 rounded-xl border border-border text-sm">Cancel</button><button disabled={payBusy} onClick={submitCustomerPayment} className="btn btn-primary">{payBusy?'Processing…':'Confirm'}</button></div>
      </div></div>)}

      {deleteTarget && (<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setDeleteTarget(null)}><div className="w-full max-w-md card p-4 space-y-3" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2 text-danger"><Trash2 className="w-4 h-4" />Delete Subscriber</h3><button onClick={()=>setDeleteTarget(null)} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button></div>
        <p className="text-sm">Delete <b>{deleteTarget.full_name || deleteTarget.username}</b> ({deleteTarget.client_code || deleteTarget.username})? This cannot be undone.</p>
        <p className="text-xs text-muted-foreground">Subscribers with invoices or payments cannot be deleted — set them to TERMINATED instead.</p>
        <div className="flex justify-end gap-2"><button onClick={()=>setDeleteTarget(null)} className="px-3 py-2 rounded-xl border border-border text-sm">Cancel</button><button disabled={deleting} onClick={deleteSubscriber} className="btn btn-danger">{deleting ? 'Deleting...' : 'Delete'}</button></div>
      </div></div>)}

      {profileOpen && (<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setProfileOpen(false)}><div className="w-full max-w-xl card p-4 space-y-3 max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />My Profile</h3><button onClick={()=>setProfileOpen(false)} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4" /></button></div>
        <div className="text-xs text-muted-foreground">Update your partner contact details and white-label branding. Wallet balance, tier and margins are managed by the ISP admin.</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {[['Company', 'company_name'], ['Email', 'email'], ['Phone', 'phone'], ['Address', 'address'], ['Brand Name', 'brand_name'], ['Portal Title', 'portal_title']].map(([label, key]: any) => (
            <label key={key} className="block"><div className="text-xs text-muted-foreground mb-1">{label}</div><input className="form-control" value={profileForm[key] || ''} onChange={e=>setProfileForm(f=>({...f,[key]:e.target.value}))} /></label>
          ))}
          {[['Logo URL', 'logo_url'], ['Primary Color', 'primary_color'], ['Secondary Color', 'secondary_color']].map(([label, key]: any) => (
            <label key={key} className="block"><div className="text-xs text-muted-foreground mb-1">{label}</div><input className="form-control" value={profileForm[key] || ''} onChange={e=>setProfileForm(f=>({...f,[key]:e.target.value}))} /></label>
          ))}
          <label className="block md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Profile Photo</div><div className="flex items-center gap-3">{profileForm.avatar_url ? /* eslint-disable-line @next/next/no-img-element */ <img src={profileForm.avatar_url} alt="avatar" className="w-12 h-12 rounded-full object-cover border border-border" /> : <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg">{user?.name?.charAt(0)}</div>}<input type="file" accept="image/*" className="text-xs" onChange={e=>{ const f=e.target.files?.[0]; if(!f) return; const reader=new FileReader(); reader.onload=()=>setProfileForm((p:any)=>({...p,avatar_url:String(reader.result)})); reader.readAsDataURL(f); }} /></div></label>
          <div className="md:col-span-2 flex flex-wrap gap-4 text-xs">{([['notify_expiry','Expiry alerts'],['notify_payment','Payment alerts'],['notify_system','System alerts']] as [string,string][]).map(([key,label])=><label key={key} className="flex items-center gap-2"><input type="checkbox" checked={!!profileForm[key]} onChange={e=>setProfileForm((p:any)=>({...p,[key]:e.target.checked}))} />{label}</label>)}</div>
          <label className="block md:col-span-2"><div className="text-xs text-muted-foreground mb-1">Notes</div><textarea className="form-control min-h-[70px]" value={profileForm.notes || ''} onChange={e=>setProfileForm(f=>({...f,notes:e.target.value}))} /></label>
        </div>
        <div className="flex justify-end gap-2"><button onClick={()=>setProfileOpen(false)} className="px-3 py-2 rounded-xl border border-border text-sm">Cancel</button><button disabled={profileSaving} onClick={saveProfile} className="btn btn-primary">{profileSaving ? 'Saving...' : 'Save Profile'}</button></div>
      </div></div>)}
    </div>
  );
}
