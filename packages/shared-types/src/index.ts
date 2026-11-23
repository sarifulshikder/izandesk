/**
 * IzanDesk ERP — Shared TypeScript Type Definitions
 */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'NOC_ENGINEER'
  | 'BILLING_OPERATOR'
  | 'TECHNICIAN'
  | 'RESELLER';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  resellerId?: string;
  permissions: string[];
  avatarUrl?: string;
}

export type SubscriberStatus =
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'PENDING'
  | 'TERMINATED';

export type SuspensionStage = 'NONE' | 'WARNING' | 'GRACE' | 'SUSPENDED' | 'ISOLATED' | 'WALLED_GARDEN' | 'REACTIVATED';

export type ConnectionType =
  | 'PPPOE'
  | 'STATIC_IP'
  | 'HOTSPOT'
  | 'LEASED_LINE_CIR';

export interface Subscriber {
  id: string;
  clientCode: string;
  fullName: string;
  username: string;
  phone: string;
  email?: string;
  connectionType: ConnectionType;
  ipAddress?: string;
  macAddress?: string;
  packageId: string;
  packageName: string;
  monthlyBill: number;
  currentDue: number;
  expiryDate: string;
  status: SubscriberStatus;
  zone: string;
  area: string;
  distributionBox?: string;
  onuOpticalPower?: number; // dBm
  resellerId?: string;
  createdAt: string;
  suspensionStage?: SuspensionStage;
  graceUntil?: string;
  walledGarden?: boolean;
}

/** KYC / subscriber identity compliance types. Field names mirror the API's
 *  snake_case rows so the same DTO can be used by staff, portal and reports. */
export type KycDocType = 'NID' | 'PASSPORT' | 'CONTRACT' | 'PHOTO' | 'UTILITY_BILL' | 'TRADE_LICENSE' | 'OTHER';

export type KycStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMISSION_REQUIRED'
  | 'EXPIRED'
  | 'NOT_APPLICABLE';

export type KycServiceType =
  | 'FIXED_BROADBAND'
  | 'WIRELESS_BROADBAND'
  | 'HOTSPOT'
  | 'CYBER_CAFE'
  | 'LEASED_LINE';

export type KycIdentityType = 'INDIVIDUAL' | 'BUSINESS';

export type KycOverallStatus = 'INCOMPLETE' | 'PENDING' | 'UNDER_REVIEW' | 'COMPLETE' | 'ATTENTION';

export type KycReviewDecision =
  | 'MARK_UNDER_REVIEW'
  | 'APPROVE'
  | 'REJECT'
  | 'REQUEST_RESUBMISSION'
  | 'MARK_EXPIRED';

export interface KycDocument {
  id: string;
  subscriber_id: string;
  doc_type: KycDocType;
  file_name: string;
  mime_type: string | null;
  uploaded_at: string;
  status: KycStatus;
  document_number_masked: string | null;
  issuer: string | null;
  issue_date: string | null;
  expires_at: string | null;
  checksum: string | null;
  scan_status: 'PENDING' | 'CLEAN' | 'FLAGGED' | 'NOT_SCANNED';
  source: 'STAFF' | 'PORTAL' | 'MCP' | 'IMPORT';
  verification_method: string | null;
  verification_reference: string | null;
  privacy_notice_version: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  reupload_of: string | null;
  retention_until: string | null;
  legal_hold_until: string | null;
  last_reminder_at: string | null;
  updated_at: string;
}

export interface KycReviewEvent {
  id: string;
  document_id: string;
  subscriber_id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: KycReviewDecision | 'UPLOADED' | 'METADATA_UPDATED' | 'DELETED' | 'AUTO_EXPIRED' | 'LEGAL_HOLD';
  from_status: KycStatus | null;
  to_status: KycStatus | null;
  reason: string | null;
  evidence_ref: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface KycProfile {
  subscriber_id: string;
  service_type: KycServiceType;
  identity_type: KycIdentityType;
  legal_name: string | null;
  date_of_birth: string | null;
  occupation: string | null;
  business_registration_number: string | null;
  tax_id: string | null;
  nid_number_masked: string | null;
  present_address: string | null;
  permanent_address: string | null;
  verified_mobile: string | null;
  email: string | null;
  privacy_notice_version: string | null;
  lawful_basis: 'CONTRACT' | 'LEGAL_OBLIGATION' | 'CONSENT' | 'VITAL_INTERESTS';
  consent_at: string | null;
  consent_withdrawn_at: string | null;
  overall_status: KycOverallStatus;
  last_reviewed_at: string | null;
  last_reviewed_by: string | null;
  risk_flags: string[];
  created_at: string;
  updated_at: string;
}

export interface KycQueueItem extends KycDocument {
  client_code: string | null;
  subscriber_name: string | null;
  subscriber_status: string | null;
  reseller_id: string | null;
  reseller_name: string | null;
  service_type: KycServiceType;
}

export interface ComplianceSubmission {
  id: string;
  portal: 'DIS' | 'ISPMS' | 'EMAIL' | 'MANUAL';
  report_type: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL_CLIENT_LIST' | 'KYC_PACK' | 'OTHER';
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  file_name: string | null;
  checksum: string | null;
  submitted_at: string | null;
  acknowledgement_ref: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'REJECTED';
  rejection_reason: string | null;
  submitted_by: string | null;
  created_at: string;
}

export interface RouterTelemetry {
  id: string;
  name: string;
  ipAddress: string;
  type: 'MIKROTIK_ROS7' | 'MIKROTIK_ROS6' | 'CISCO' | 'HUAWEI';
  isOnline: boolean;
  cpuLoad: number;
  ramUsagePercent: number;
  uptime: string;
  activePppoeCount: number;
  totalThroughputMbps: {
    download: number;
    upload: number;
  };
}

export interface OltTelemetry {
  id: string;
  name: string;
  vendor: 'HUAWEI' | 'BDCOM' | 'ZTE' | 'CDATA' | 'VSOL' | 'HSGQ';
  ipAddress: string;
  isOnline: boolean;
  totalPonPorts: number;
  connectedOnus: number;
  criticalPowerAlarms: number;
}

export type InvoiceStatus = 'UNPAID' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'CANCELLED' | 'DRAFT';

export interface InvoiceItem {
  id?: string;
  invoiceId?: string;
  description: string;
  itemType?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  metadata?: Record<string, any>;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  subscriberId: string;
  clientCode: string;
  subscriberName: string;
  amount: number;
  dueAmount: number;
  billMonth: string;
  dueDate: string;
  status: InvoiceStatus;
  issueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  totalAmount?: number;
  paidAmount?: number;
  prorated?: boolean;
  items?: InvoiceItem[];
}

export type PaymentStatus = 'PENDING' | 'INITIATED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'VERIFYING';

export interface PaymentRecord {
  id: string;
  paymentRef: string;
  invoiceId?: string;
  subscriberId?: string;
  gateway: string;
  method?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  trxId?: string;
  checkoutUrl?: string;
  clientSecret?: string;
  createdAt?: string;
  verifiedAt?: string;
  metadata?: Record<string, any>;
}

export interface BillingPolicy {
  id: string;
  name: string;
  graceDays: number;
  warningDays: number;
  autoSuspend: boolean;
  isolateOnSuspend: boolean;
  enableWalledGarden: boolean;
  walledGardenProfile?: string;
  lateFeeEnabled?: boolean;
  lateFeeAmount?: number;
  lateFeePercent?: number;
  currency?: string;
  isDefault?: boolean;
}

export type PluginType = 'PAYMENT_GATEWAY' | 'SMS_GATEWAY' | 'OLT_DRIVER' | 'CUSTOM_HOOK';
export type PluginStatus = 'OK' | 'ERROR' | 'RELOAD_PENDING';

export interface PluginMetadata {
  id: string;
  name: string;
  title: string;
  version: string;
  type: PluginType;
  isActive: boolean;
  lastReloadAt: string;
  status: PluginStatus;
  author?: string;
  description?: string;
  filePath?: string;
  lastError?: string;
  capabilities?: string[];
}

export interface PaymentCheckoutRequest {
  invoiceId?: string;
  paymentRef?: string;
  amount: number;
  currency?: string;
  subscriber?: Record<string, any>;
  invoice?: Record<string, any>;
  returnUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, any>;
  mode?: 'SANDBOX' | 'LIVE';
}

export interface PaymentCheckoutResult {
  ok: boolean;
  gateway: string;
  paymentUrl?: string;
  token?: string;
  clientSecret?: string;
  orderId?: string;
  approvalUrl?: string;
  sessionId?: string;
  raw?: any;
  message?: string;
}

export interface PaymentWebhookVerifyResult {
  ok: boolean;
  verified: boolean;
  status: PaymentStatus | string;
  trxId?: string;
  paymentRef?: string;
  invoiceId?: string;
  amount?: number;
  currency?: string;
  payer?: Record<string, any>;
  raw?: any;
  message?: string;
  eventId?: string;
}

export interface PaymentGatewayPlugin {
  id: string;
  name: string;
  version: string;
  type: 'PAYMENT_GATEWAY';
  capabilities?: string[];
  createCheckoutSession?: (req: PaymentCheckoutRequest) => Promise<PaymentCheckoutResult> | PaymentCheckoutResult;
  verifyWebhook?: (payload: any, headers?: Record<string, any>, config?: any) => Promise<PaymentWebhookVerifyResult> | PaymentWebhookVerifyResult;
  executePayment?: (req: any) => Promise<any> | any;
  queryPayment?: (req: any) => Promise<any> | any;
  refundPayment?: (req: any) => Promise<any> | any;
  onMfsSms?: (payload: any) => Promise<any> | any; // personal MFS SMS listener hook
}

export interface SmsGatewayPlugin {
  id: string;
  name: string;
  version: string;
  type: 'SMS_GATEWAY';
  sendSms?: (recipient: string, message: string, senderId?: string) => Promise<any> | any;
  onInboundSms?: (payload: any) => Promise<any> | any;
}

export interface PluginKernelEvent {
  type: 'loaded' | 'reloaded' | 'error' | 'removed';
  pluginId: string;
  timestamp: string;
  message?: string;
  plugin?: PluginMetadata;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserSession;
}

export interface ApiError {
  message: string;
}

export interface ExecutiveMetrics {
  totalSubscribers: number;
  activeOnlineNow: number;
  suspendedDue: number;
  expiredThisMonth: number;
  monthlyBillGenerated: number;
  todayCollections: number;
  thisMonthCollections: number;
  totalDueOutstanding: number;
  coreRoutersOnline: number;
  oltsOnline: number;
  activeTickets: number;
  criticalFiberAlarms: number;
}
