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
  status: 'UNPAID' | 'PAID' | 'PARTIAL' | 'OVERDUE';
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
