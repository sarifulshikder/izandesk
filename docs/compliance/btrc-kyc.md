# BTRC / KYC compliance pack for ISP broadband subscribers

IzanDesk's KYC workflow covers **fixed and wireless ISP broadband subscribers**. It is an internal
identity-verification and evidence system — **not** a SIM registration, IPTSP, cyber-cafe or
public Wi-Fi system. Those regimes have different legal bases and document sets and must not be
copied into ordinary broadband onboarding.

This document separates **confirmed obligations** from **best-practice controls** and from
**unverified claims**. Where a source could not be confirmed, the pack is deliberately conservative:
defaults are internal policy, not a representation of a BTRC requirement.

## 1. Evidence matrix

Confidence labels:

- **Confirmed** — stated in a primary source (BTRC guideline/notice, DIS/ISPMS portal, or an Act).
- **Best practice** — an IzanDesk control chosen for accountability/audit; not a published legal duty.
- **Unverified** — could not be confirmed from a primary public source; must be checked with counsel
  or the licence condition before being relied on.

| # | Obligation / control | Applies to | Confidence | Source | IzanDesk implementation |
|---|---|---|---|---|---|
| 1 | Maintain an authenticated subscriber database | All licensed ISPs | **Confirmed** | ISP Guideline 2020 cl. 37.6(ix) | `subscriber_kyc_profiles`, `kyc_documents`, review events, immutable audit log |
| 2 | Use the BTRC-prescribed **common Subscriber Registration Form** | All licensed ISPs | **Confirmed (existence)** / **Unverified (contents)** | ISP Guideline 2020 cl. 29.2 | Profile fields are configurable; `kyc.mandatory_doc_types` stays empty until the form is obtained. Do **not** assume an NID photocopy alone satisfies the form. |
| 3 | Preserve traffic/usage logs for 3 months; up to 6 months on request | All licensed ISPs | **Confirmed** | ISP Guideline 2020 cl. 25.4 | Existing RADIUS/log retention + `kyc_legal_holds` for preservation requests. KYC document retention is **separate** and not assumed to be 3/6 months. |
| 4 | Submit monthly and quarterly reports | All licensed ISPs | **Confirmed** | ISP Guideline 2020 cl. 25.5 | `compliance_submissions` records DIS/ISPMS/email/manual filing with acknowledgement reference and checksum |
| 5 | Submit an annual client list | All licensed ISPs | **Confirmed** | ISP Guideline 2020 cl. 25.8 | `compliance_submissions.report_type = ANNUAL_CLIENT_LIST`; use the redacted KYC CSV export as supporting evidence, not as the prescribed form |
| 6 | Lawful interception cooperation | All licensed ISPs | **Confirmed** | ISP Guideline 2020 cl. 33 | `kyc_legal_holds` supports authority preservation requests (default 90 days) with SUPER_ADMIN-only create/release |
| 7 | Cyber-cafe-specific registration/reporting | **Only** cyber-cafe licence holders | **Confirmed (scope)** | ISP Guideline 2020 cl. 38 | `service_type = CYBER_CAFE` is a distinct profile value; controls are not applied to FIXED_BROADBAND or WIRELESS_BROADBAND |
| 8 | Record the notice and lawful basis when collecting identity data | All operators | **Best practice** (PDPA 2026 accountability) | PDPA 2026 | `privacy_notice_version`, `lawful_basis`, `consent_at` / `consent_withdrawn_at` on the profile and document |
| 9 | Store only masked identity numbers; keep scans access-controlled | All operators | **Best practice** | Data minimisation principle | `document_number_masked`, SHA-256 checksums, ownership-checked downloads, `nosniff` + `sandbox` headers |
| 10 | Two-person-style review trail (who approved/rejected and why) | All operators | **Best practice** | Audit accountability | `kyc_review_events` plus `auditLog` entries; reviewer roles are SUPER_ADMIN / BILLING_OPERATOR / TECHNICIAN |
| 11 | Reject/resubmission with a visible reason and expiry re-verification | All operators | **Best practice** | Operational quality control | Statuses `REJECTED`, `RESUBMISSION_REQUIRED`, `EXPIRED`; portal displays reason and supports re-upload linked via `reupload_of` |
| 12 | NID-verification service / NID database access | ISPs | **Unverified and legally constrained** | NID Act / identity-access rules | Optional `verification_method` + `verification_reference` are recorded **only when an authorised check actually occurred**. No automatic NID lookup is implemented. |
| 13 | Maximum KYC document retention period for ordinary ISP broadband | ISPs | **Unverified** | No public ordinary-ISP KYC retention rule located | `kyc.document_retention_days = 0` (manual release). Legal holds always override retention sweeps. |
| 14 | Required document list for ordinary ISP broadband | ISPs | **Unverified** | Common form not publicly available | `kyc.allowed_doc_types` is a best-practice superset; `kyc.mandatory_doc_types` is empty by default. |
| 15 | Proposed 6+6 month log retention change | ISPs | **Unverified** | Proposed amendment, adoption not confirmed | No change to log retention; check the current licence condition before adopting. |
| 16 | Cyber Security Act 2026 preservation orders (default 90 days, extendable to 180) | All operators | **Confirmed** | Cyber Security Act 2026 | `kyc.legal_hold_days = 90`; hold API caps at 180 days and requires case reference/authority |

### What is deliberately **not** claimed

- There is **no public ordinary-ISP ID document list** that we could verify. Do not tell subscribers
  that a specific document is "BTRC mandatory" until the prescribed form is in hand.
- SIM registration rules, IPTSP registration, cyber-cafe rules and free-Wi-Fi rules are **not**
  applied to general broadband subscribers here.
- The KYC CSV export is an internal evidence report; it is **not** a DIS/ISPMS upload format. The
  submission record stores the actual filed artefact and its checksum.

## 2. Roles and trust boundaries

| Action | Roles | Notes |
|---|---|---|
| Upload/view KYC for a subscriber | Staff with subscriber access; resellers scoped to **their own** subscribers | `assertSubscriberOwnership` + reseller scope; `kyc.allow_reseller_upload` gates reseller uploads |
| Review, approve, reject, request resubmission, mark expired | SUPER_ADMIN, BILLING_OPERATOR, TECHNICIAN | Resellers **never** review. Decisions require a reason for reject/resubmission and are written to `kyc_review_events`. |
| Update profile / masked metadata | Reviewer roles | Raw document numbers are masked on write; downloads remain file-based and audited. |
| Export redacted compliance CSV | KYC viewer roles | `kyc.redact_exports` on by default; SUPER_ADMIN may disable for an evidence pack, which is itself audited. |
| Create/release legal hold | SUPER_ADMIN only | Case reference, authority and requester are mandatory; sweeps skip held documents. |
| Run maintenance sweep | SUPER_ADMIN only | Manual endpoint plus once-daily scheduler. |
| Record DIS/ISPMS submission | SUPER_ADMIN, BILLING_OPERATOR | File type/checksum validated; acknowledgement tracked. |
| MCP AI tools | Inherit the connected account's role and tool allowlist | `izandesk_approve_kyc` / `izandesk_reject_kyc` route through the same decision service and require `confirm:true`. |

## 3. Status model

`PENDING → UNDER_REVIEW → APPROVED | REJECTED | RESUBMISSION_REQUIRED | EXPIRED`, plus
`NOT_APPLICABLE` for subscribers exempt by scope. Every transition writes a review event and an audit
entry. The subscriber profile's `overall_status` is derived from the configured mandatory document
set: `INCOMPLETE`, `PENDING`, `UNDER_REVIEW`, `COMPLETE`, `ATTENTION`.

The legacy `PUT /api/subscribers/:id/kyc/:docId/status` endpoint remains compatible with
`APPROVED`/`REJECTED` but now enforces reviewer roles and delegates to the decision service.
The richer endpoint is `POST /api/kyc/documents/:docId/decision`.

## 4. Retention and legal hold

- `kyc.document_retention_days = 0` means **manual release only** — the default. No public ordinary-ISP
  KYC retention period was confirmed, so nothing is deleted automatically out of the box.
- When an operator sets a positive retention period, the daily sweep deletes only documents whose
  `retention_until` has passed **and** which are not under `kyc_legal_holds`.
- Legal holds are SUPER_ADMIN-only, default 90 days, cap 180 days, and are released explicitly with
  an audit entry. Expiry reminders (`kyc.expiry_warning_days`, default 30) and auto-expiry of expired
  identity documents are part of the same sweep.
- Traffic/log preservation under cl. 25.4 is a separate concern from KYC document retention.

## 5. DIS / ISPMS submission evidence

`POST /api/compliance/submissions` records the portal (`DIS`, `ISPMS`, `EMAIL`, `MANUAL`), report type
(`MONTHLY`, `QUARTERLY`, `ANNUAL_CLIENT_LIST`, `KYC_PACK`, `OTHER`), period, uploaded artefact,
SHA-256 checksum, submission timestamp and acknowledgement reference. `GET /api/kyc/export.csv`
produces a redacted supporting extract. The DIS/API schema is **not** confirmed — this pack stores
evidence of what was filed; it does not generate a DIS payload.

## 6. Open questions before go-live

1. Obtain the BTRC **common Subscriber Registration Form** (cl. 29.2) for the exact licence category.
   Set `kyc.mandatory_doc_types` only from that form.
2. Confirm the DIS/ISPMS upload schema and whether an API is available; add a mapper if so.
3. Confirm the contents/status of BTRC ISP Instruction No. 402 (2016).
4. Confirm whether the proposed 6+6 month log retention amendment was adopted.
5. Confirm lawful NID-verification access and record the authorised method in
   `verification_method` / `verification_reference`; do not enable automatic lookups.
6. Have counsel confirm PDPA 2026 notice wording and lawful basis for each field collected.

## 7. Primary sources

- [BTRC Regulatory and Licensing Guideline for ISP in Bangladesh (2020)](https://lims.btrc.gov.bd/uploads/service_guideline/Regulatory%20and%20Licensing%20Guideline%20for%20Internet%20Service%20Provider%20(ISP)%20in%20Bangladesh.pdf) — cl. 25.4, 25.5, 25.8, 29.2, 33, 37.6(ix), 38.
- [BTRC notice portal](https://btrc.gov.bd/pages/notices/6922e94fdbfbab28ce0adc7f)
- [BTRC DIS](https://dis.btrc.gov.bd/) and [ISPMS/ISP portal](https://isp.btrc.gov.bd)
- [Bangladesh PDPA 2026 (BDLaws)](http://bdlaws.minlaw.gov.bd/act-print-1692.html)
- [Cyber Security Act 2026 (BDLaws)](https://bdlaws.minlaw.gov.bd/act-print-1710.html)

See also `docs/security-hardening.md` for auth/MFA/API-key controls and `docs/mcp-setup.md` for the
audited AI client surface.
