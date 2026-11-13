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
