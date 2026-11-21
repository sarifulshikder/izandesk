'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import {
  AlertTriangle, BadgeCheck, Building2, CheckCircle2, ClipboardCheck, Clock3,
  Download, ExternalLink, FileText, Filter, Landmark, RefreshCw, ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

const REVIEW_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'TECHNICIAN'];
const DOC_TYPES = ['NID', 'PASSPORT', 'CONTRACT', 'PHOTO', 'UTILITY_BILL', 'TRADE_LICENSE', 'OTHER'];
const DECISIONS = [
  { value: 'MARK_UNDER_REVIEW', label: 'Under review' },
  { value: 'APPROVE', label: 'Approve' },
  { value: 'REQUEST_RESUBMISSION', label: 'Request resubmission' },
  { value: 'REJECT', label: 'Reject' },
  { value: 'MARK_EXPIRED', label: 'Mark expired' },
];

const STATUS_TONE: Record<string, string> = {
  APPROVED: 'badge-success',
  PENDING: 'badge-warning',
  UNDER_REVIEW: 'badge-info',
  REJECTED: 'badge-danger',
  RESUBMISSION_REQUIRED: 'badge-warning',
  EXPIRED: 'badge-secondary',
  NOT_APPLICABLE: 'badge-outline',
};

function dateLabel(value: any) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function timeLabel(value: any) {
  return value ? new Date(value).toLocaleString() : '—';
}

export default function KycReviewPage() {
  const { token, user } = useAuth();
  const canReview = REVIEW_ROLES.includes(String(user?.role));
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ by_status: {}, total: 0, attention_profiles: 0 });
  const [events, setEvents] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [holds, setHolds] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [docType, setDocType] = useState('');
  const [expiring, setExpiring] = useState('');
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdForm, setHoldForm] = useState({ case_reference: '', authority: '', requested_by: '', days: '90', subscriber_id: '' });
  const [submissionForm, setSubmissionForm] = useState({ portal: 'DIS', report_type: 'MONTHLY', period_label: '', acknowledgement_ref: '' });

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (docType) p.set('doc_type', docType);
    if (expiring) p.set('expiring_days', expiring);
    if (q.trim()) p.set('q', q.trim());
    p.set('limit', '100');
    return p.toString();
  }, [status, docType, expiring, q]);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const [queue, stats, subs, legal] = await Promise.all([
        apiFetch<any>(`/api/kyc/queue?${query}`, {}, token),
        apiFetch<any>('/api/kyc/summary', {}, token),
        apiFetch<any>('/api/compliance/submissions', {}, token).catch(() => ({ data: [] })),
        apiFetch<any>('/api/kyc/legal-holds', {}, token).catch(() => ({ data: [] })),
      ]);
      setRows(queue.data || []);
      setSummary(stats);
      setSubmissions((subs.data || []).slice(0, 8));
      setHolds((legal.data || []).slice(0, 8));
    } catch (e: any) {
      setError(e?.message || 'Could not load the KYC queue');
    } finally {
      setBusy(false);
    }
  }, [token, query]);

  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async (docId: string) => {
    if (!token) return;
    setSelected(docId); setReason(''); setEvidenceRef('');
    try {
      const detail = await apiFetch<any>(`/api/kyc/documents/${docId}`, {}, token);
      setEvents(detail.events || []);
      if (detail.data?.subscriber_id) {
        const p = await apiFetch<any>(`/api/kyc/profiles/${detail.data.subscriber_id}`, {}, token).catch(() => ({ data: null }));
        setProfile(p.data || null);
      } else setProfile(null);
    } catch (e: any) { setError(e?.message || 'Could not load document detail'); }
  }, [token]);

  const decide = async (decision: string) => {
    if (!selected || !token) return;
    if (['REJECT', 'REQUEST_RESUBMISSION'].includes(decision) && !reason.trim()) {
      setError('A reason is required for this decision'); return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      await apiFetch(`/api/kyc/documents/${selected}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: reason.trim() || null, evidence_ref: evidenceRef.trim() || null }),
      }, token);
      setNotice(`Document ${decision.toLowerCase().replaceAll('_', ' ')} and audit entry recorded`);
      await Promise.all([load(), loadDetail(selected)]);
    } catch (e: any) { setError(e?.message || 'Decision failed'); } finally { setBusy(false); }
  };

  const saveMetadata = async () => {
    if (!selected || !token) return;
    const row = rows.find((r) => r.id === selected);
    if (!row) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await apiFetch(`/api/kyc/documents/${selected}`, {
        method: 'PATCH',
        body: JSON.stringify({
          issuer: row.issuer || null,
          expires_at: row.expires_at || null,
          verification_method: row.verification_method || null,
          verification_reference: row.verification_reference || null,
          document_number: row.document_number_masked || null,
          reason: reason.trim() || null,
        }),
      }, token);
      setNotice('Review metadata saved (identity numbers stay masked)');
      await load();
    } catch (e: any) { setError(e?.message || 'Metadata update failed'); } finally { setBusy(false); }
  };

  const createHold = async () => {
    if (!token || !holdForm.case_reference || !holdForm.authority || !holdForm.requested_by) {
      setError('Case reference, authority and requester are required'); return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      await apiFetch('/api/kyc/legal-holds', { method: 'POST', body: JSON.stringify({
        ...holdForm, days: Number(holdForm.days), subscriber_id: holdForm.subscriber_id || null,
        document_id: selected || null,
      }) }, token);
      setNotice('Legal hold recorded — automatic retention is blocked for this document');
      setHoldForm({ ...holdForm, case_reference: '', authority: '', requested_by: '' });
      await load();
    } catch (e: any) { setError(e?.message || 'Could not create legal hold'); } finally { setBusy(false); }
  };

  const createSubmission = async () => {
    if (!token || !submissionForm.period_label.trim()) { setError('period_label is required'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await apiFetch('/api/compliance/submissions', { method: 'POST', body: JSON.stringify(submissionForm) }, token);
      setNotice('Submission record created. Attach the original acknowledgement in Compliance settings.');
      setSubmissionForm({ ...submissionForm, period_label: '', acknowledgement_ref: '' });
      await load();
    } catch (e: any) { setError(e?.message || 'Could not record submission'); } finally { setBusy(false); }
  };

  const exportCsv = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/kyc/export.csv?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `Export failed: ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'izandesk-kyc-compliance.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e?.message || 'Export failed'); }
  };

  const detail = rows.find((r) => r.id === selected);
  const statusCounts = summary.by_status || {};

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Governance · BTRC / PDPA subscriber identity</span>
          <h1 className="page-title"><ClipboardCheck className="w-6 h-6 text-primary"/>KYC Review Queue</h1>
          <p className="page-subtitle">Scoped review of ISP broadband identity documents, re-verification and filing evidence. Resellers never review identity.</p>
        </div>
        <div className="page-actions">
          <Link href="/audit?entity_type=kyc_document" className="btn btn-outline"><ExternalLink className="w-4 h-4"/>Audit trail</Link>
          <button onClick={() => void exportCsv()} className="btn btn-outline" data-testid="kyc-export"><Download className="w-4 h-4"/>Redacted CSV</button>
          <button onClick={() => void load()} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`}/>Refresh</button>
        </div>
      </div>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <div className="stat-grid-5">
        {[
          { label: 'Pending', value: statusCounts.PENDING || 0, tone: 'dash-stat-warning', icon: Clock3 },
          { label: 'Under review', value: statusCounts.UNDER_REVIEW || 0, tone: 'dash-stat-info', icon: ClipboardCheck },
          { label: 'Approved', value: statusCounts.APPROVED || 0, tone: 'dash-stat-success', icon: BadgeCheck },
          { label: 'Needs attention', value: summary.attention_profiles || 0, tone: 'dash-stat-danger', icon: ShieldAlert },
          { label: 'Total documents', value: summary.total || 0, tone: 'dash-stat-primary', icon: FileText },
        ].map((s) => (
          <div className={`dash-stat ${s.tone}`} key={s.label}>
            <div className="dash-stat-body">
              <div className="dash-stat-label"><s.icon className="w-3.5 h-3.5"/>{s.label}</div>
              <div className="dash-stat-value tabular-nums">{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="toolbar">
          <div className="filter-bar">
            <Filter className="w-4 h-4 text-muted-foreground"/>
            <input className="form-control !w-auto min-w-[190px] !h-9" placeholder="Client, name or masked ID" value={q} onChange={(e) => setQ(e.target.value)} data-testid="kyc-search"/>
            <select className="form-select !w-auto min-w-[145px] !h-9" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="kyc-status-filter">
              <option value="">All statuses</option>
              {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
            </select>
            <select className="form-select !w-auto min-w-[145px] !h-9" value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="">All document types</option>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="form-select !w-auto min-w-[155px] !h-9" value={expiring} onChange={(e) => setExpiring(e.target.value)}>
              <option value="">Any expiry</option>
              <option value="7">Expiring in 7 days</option>
              <option value="30">Expiring in 30 days</option>
              <option value="90">Expiring in 90 days</option>
            </select>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{rows.length} document{rows.length === 1 ? '' : 's'}</span>
        </div>

        <div className="table-wrap overflow-auto max-h-[520px]">
          <table className="table table-hover min-w-[960px]" data-testid="kyc-queue-table">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border">
                <th className="px-3 py-2.5">Subscriber</th><th className="px-3 py-2.5">Document</th>
                <th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Identity no.</th>
                <th className="px-3 py-2.5">Expires</th><th className="px-3 py-2.5">Uploaded</th>
                <th className="px-3 py-2.5">Reviewer</th><th className="px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className={`border-b border-border/50 ${selected === d.id ? 'bg-muted/30' : ''}`}>
                  <td className="px-3 py-2.5 text-[11px]">
                    <div className="font-semibold">{d.subscriber_name || d.client_code || '—'}</div>
                    <div className="text-muted-foreground">{d.client_code || ''} · {String(d.service_type || '').replaceAll('_', ' ')}</div>
                    {d.rejection_reason && <div className="text-danger mt-0.5" title={d.rejection_reason}>Reason: {d.rejection_reason.slice(0, 60)}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]"><div className="font-medium">{d.doc_type}</div><div className="text-muted-foreground truncate max-w-[180px]" title={d.file_name}>{d.file_name}</div></td>
                  <td className="px-3 py-2.5 text-[11px]"><span className={`badge ${STATUS_TONE[d.status] || 'badge-secondary'}`}>{String(d.status || '').replaceAll('_', ' ')}</span></td>
                  <td className="px-3 py-2.5 text-[11px] mono">{d.document_number_masked || '—'}</td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums">{dateLabel(d.expires_at)}</td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums">{timeLabel(d.uploaded_at)}</td>
                  <td className="px-3 py-2.5 text-[11px]">{d.reviewed_by_name || '—'}<div className="text-muted-foreground">{timeLabel(d.reviewed_at)}</div></td>
                  <td className="px-3 py-2.5 text-[11px]"><button className="btn btn-outline btn-sm" onClick={() => void loadDetail(d.id)} data-testid={`kyc-review-${d.id}`}>Review</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No KYC documents match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="card p-4" data-testid="kyc-review-detail">
            <h2 className="card-title mb-3 flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-primary"/>Decision panel</h2>
            {!selected && <div className="empty-state">Choose a document from the queue to review its evidence and history.</div>}
            {selected && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                  <div><div className="text-muted-foreground">Document</div><div className="font-semibold">{detail?.doc_type || '—'}</div></div>
                  <div><div className="text-muted-foreground">Service</div><div className="font-semibold">{String(detail?.service_type || '').replaceAll('_', ' ')}</div></div>
                  <div><div className="text-muted-foreground">Source</div><div className="font-semibold">{detail?.source || '—'}</div></div>
                  <div><div className="text-muted-foreground">Scan</div><div className="font-semibold">{detail?.scan_status || '—'}</div></div>
                  <div><div className="text-muted-foreground">Issuer / method</div><div className="font-semibold">{detail?.issuer || detail?.verification_method || '—'}</div></div>
                  <div><div className="text-muted-foreground">Verification ref</div><div className="mono">{detail?.verification_reference || '—'}</div></div>
                  <div><div className="text-muted-foreground">Masked number</div><div className="mono">{detail?.document_number_masked || '—'}</div></div>
                  <div><div className="text-muted-foreground">Checksum</div><div className="mono truncate" title={detail?.checksum}>{detail?.checksum ? `${String(detail.checksum).slice(0, 12)}…` : '—'}</div></div>
                </div>
                {profile && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 text-[11px] space-y-1">
                    <div className="font-semibold">Subscriber profile · {String(profile.overall_status || '').replaceAll('_', ' ')}</div>
                    <div className="text-muted-foreground">{profile.legal_name || detail?.subscriber_name || '—'} · {profile.identity_type || 'INDIVIDUAL'} · lawful basis {profile.lawful_basis || '—'} · notice {profile.privacy_notice_version || '—'}</div>
                    {Array.isArray(profile.risk_flags) && profile.risk_flags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">{profile.risk_flags.map((f: string) => <span key={f} className="badge badge-warning">{f}</span>)}</div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                  <input className="form-control" placeholder="Reason (required to reject/resubmit)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="kyc-reason"/>
                  <input className="form-control" placeholder="Evidence reference (optional)" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)}/>
                  <input className="form-control" type="date" value={detail?.expires_at || ''} onChange={(e) => setRows((prev) => prev.map((r) => r.id === selected ? { ...r, expires_at: e.target.value || null } : r))} title="Document expiry"/>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {DECISIONS.map((d) => (
                    <button key={d.value} disabled={!canReview || busy} onClick={() => void decide(d.value)} className={`btn btn-sm ${d.value === 'APPROVE' ? 'btn-success' : d.value === 'REJECT' || d.value === 'MARK_EXPIRED' ? 'btn-danger' : 'btn-outline'}`} data-testid={`kyc-decision-${d.value}`}>{d.label}</button>
                  ))}
                  {canReview && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void saveMetadata()}>Save metadata</button>}
                  {!canReview && <span className="text-xs text-muted-foreground self-center">Your role can view but not decide KYC reviews.</span>}
                </div>
                <div className="divider"/>
                <div className="text-xs font-semibold">Review history</div>
                <div className="space-y-1.5 max-h-[180px] overflow-auto">
                  {events.map((ev) => (
                    <div key={ev.id} className="rounded-lg border border-border bg-muted/20 p-2 text-[11px] flex items-start justify-between gap-2">
                      <div><span className="font-semibold">{String(ev.action).replaceAll('_', ' ')}</span> · {ev.from_status || '—'} → {ev.to_status || '—'}<div className="text-muted-foreground">{ev.reason || ev.evidence_ref || ''}</div></div>
                      <div className="text-muted-foreground whitespace-nowrap">{ev.actor_name || ev.actor_role || 'SYSTEM'} · {timeLabel(ev.created_at)}</div>
                    </div>
                  ))}
                  {!events.length && <div className="text-xs text-muted-foreground">No review events yet.</div>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="card-title mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary"/>Legal hold</h2>
            <p className="text-xs text-muted-foreground mb-3">Authority preservation requests block retention sweeps. SUPER_ADMIN only, capped at 180 days.</p>
            <div className="space-y-2">
              <input className="form-control" placeholder="Case reference" value={holdForm.case_reference} onChange={(e) => setHoldForm({ ...holdForm, case_reference: e.target.value })}/>
              <input className="form-control" placeholder="Authority" value={holdForm.authority} onChange={(e) => setHoldForm({ ...holdForm, authority: e.target.value })}/>
              <input className="form-control" placeholder="Requested by" value={holdForm.requested_by} onChange={(e) => setHoldForm({ ...holdForm, requested_by: e.target.value })}/>
              <input className="form-control" type="number" min={1} max={180} value={holdForm.days} onChange={(e) => setHoldForm({ ...holdForm, days: e.target.value })}/>
              <button className="btn btn-outline w-full" disabled={!isAdmin || busy || !selected} onClick={() => void createHold()} data-testid="kyc-legal-hold">Place hold on selected document</button>
            </div>
            <div className="divider"/>
            <div className="text-xs font-semibold mb-1">Active / recent holds</div>
            {holds.map((h) => <div key={h.id} className="text-[11px] py-1 border-b border-border/50"><span className="font-semibold">{h.authority}</span> · {h.case_reference}<div className="text-muted-foreground">until {dateLabel(h.end_at)}{h.released_at ? ' · released' : ''}</div></div>)}
            {!holds.length && <div className="text-xs text-muted-foreground">No legal holds recorded.</div>}
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-2 flex items-center gap-2"><Landmark className="w-4 h-4 text-primary"/>BTRC submission evidence</h2>
            <p className="text-xs text-muted-foreground mb-3">Record what was filed in DIS/ISPMS. This does not generate a DIS payload.</p>
            <div className="space-y-2">
              <select className="form-select" value={submissionForm.portal} onChange={(e) => setSubmissionForm({ ...submissionForm, portal: e.target.value })}><option>DIS</option><option>ISPMS</option><option>EMAIL</option><option>MANUAL</option></select>
              <select className="form-select" value={submissionForm.report_type} onChange={(e) => setSubmissionForm({ ...submissionForm, report_type: e.target.value })}><option>MONTHLY</option><option>QUARTERLY</option><option>ANNUAL_CLIENT_LIST</option><option>KYC_PACK</option><option>OTHER</option></select>
              <input className="form-control" placeholder="Period label (e.g. 2026-11)" value={submissionForm.period_label} onChange={(e) => setSubmissionForm({ ...submissionForm, period_label: e.target.value })}/>
              <input className="form-control" placeholder="Acknowledgement reference" value={submissionForm.acknowledgement_ref} onChange={(e) => setSubmissionForm({ ...submissionForm, acknowledgement_ref: e.target.value })}/>
              <button className="btn btn-outline w-full" disabled={!['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role)) || busy} onClick={() => void createSubmission()} data-testid="kyc-submission">Record submission</button>
            </div>
            <div className="divider"/>
            {submissions.map((s) => <div key={s.id} className="text-[11px] py-1 border-b border-border/50"><span className="font-semibold">{s.portal} · {String(s.report_type).replaceAll('_', ' ')}</span> · {s.period_label}<div className="text-muted-foreground">{s.status}{s.acknowledgement_ref ? ` · ${s.acknowledgement_ref}` : ''}</div></div>)}
            {!submissions.length && <div className="text-xs text-muted-foreground">No submissions recorded yet.</div>}
          </div>

          <div className="card p-4 space-y-2">
            <h2 className="card-title flex items-center gap-2"><Building2 className="w-4 h-4 text-primary"/>Policy notes</h2>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Identity document lists, retention periods and DIS schemas are <strong>not</strong> confirmed for ordinary ISP broadband.
              Defaults remain manual-release and redacted. Configure policy in Settings → KYC &amp; Compliance.
            </div>
            <div className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3.5 h-3.5 text-success"/>SIM / IPTSP / cyber-cafe rules are excluded from this workflow.</div>
            <div className="flex items-center gap-2 text-xs"><AlertTriangle className="w-3.5 h-3.5 text-warning"/>Legal holds always override retention.</div>
            <Link href="/settings?tab=kyc" className="btn btn-outline btn-sm w-full">Open KYC settings</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
