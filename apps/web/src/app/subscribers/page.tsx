'use client';

import React, { useState } from 'react';
import { Subscriber, ConnectionType, SubscriberStatus } from '@izandesk/shared-types';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Radio,
  Power,
  RefreshCw,
  Eye,
  X,
  FileSpreadsheet,
  Download,
  ShieldAlert,
  Zap,
  MapPin,
  HardDrive,
  Check,
} from 'lucide-react';

const initialSubscribers: Subscriber[] = [
  {
    id: 'sub-01',
    clientCode: 'IZN-MIR-00142',
    fullName: 'Rohit Sharma',
    username: 'rohit5656',
    phone: '+8801711223344',
    email: 'rohit@gmail.com',
    connectionType: 'PPPOE',
    packageId: 'pkg-50m',
    packageName: '50 Mbps Gaming Pro',
    monthlyBill: 1200,
    currentDue: 0,
    expiryDate: '2026-11-30',
    status: 'ACTIVE',
    zone: 'Mirpur',
    area: 'Block C, Section 10',
    distributionBox: 'TJ-MIR-04 (Port 7)',
    onuOpticalPower: -19.4,
    createdAt: '2026-01-15',
  },
  {
    id: 'sub-02',
    clientCode: 'IZN-DHN-00109',
    fullName: 'Rahim Chowdhury',
    username: 'rahim01',
    phone: '+8801819887766',
    email: 'rahim@yahoo.com',
    connectionType: 'PPPOE',
    packageId: 'pkg-30m',
    packageName: '30 Mbps Home Ultra',
    monthlyBill: 800,
    currentDue: 800,
    expiryDate: '2026-11-10',
    status: 'SUSPENDED',
    zone: 'Dhanmondi',
    area: 'Road 27',
    distributionBox: 'TJ-DHN-02 (Port 3)',
    onuOpticalPower: -21.8,
    createdAt: '2026-03-20',
  },
  {
    id: 'sub-03',
    clientCode: 'IZN-GUL-00088',
    fullName: 'Apex Footwear Ltd (HQ)',
    username: 'apex_cir_100m',
    phone: '+8801912345678',
    email: 'it@apexfootwear.com',
    connectionType: 'LEASED_LINE_CIR',
    packageId: 'pkg-cir-100m',
    packageName: '100 Mbps Dedicated CIR',
    monthlyBill: 25000,
    currentDue: 0,
    expiryDate: '2026-12-31',
    status: 'ACTIVE',
    zone: 'Gulshan',
    area: 'Gulshan Avenue',
    distributionBox: 'ODB-GUL-01 (Direct Core)',
    onuOpticalPower: -17.2,
    createdAt: '2025-08-10',
  },
  {
    id: 'sub-04',
    clientCode: 'IZN-UTT-00195',
    fullName: 'Tanvir Ahmed',
    username: 'tanvir_wifi',
    phone: '+8801552233445',
    email: 'tanvir@outlook.com',
    connectionType: 'HOTSPOT',
    packageId: 'pkg-hotspot-7d',
    packageName: '7-Day Unlimited Voucher',
    monthlyBill: 350,
    currentDue: 0,
    expiryDate: '2026-11-18',
    status: 'ACTIVE',
    zone: 'Uttara',
    area: 'Sector 4',
    distributionBox: 'TJ-UTT-09 (Port 1)',
    onuOpticalPower: -20.1,
    createdAt: '2026-11-11',
  },
  {
    id: 'sub-05',
    clientCode: 'IZN-MIR-00214',
    fullName: 'Fatema Tuz Zohra',
    username: 'fatema_mirpur',
    phone: '+8801612445566',
    email: 'fatema@gmail.com',
    connectionType: 'PPPOE',
    packageId: 'pkg-40m',
    packageName: '40 Mbps Streamer',
    monthlyBill: 1000,
    currentDue: 1000,
    expiryDate: '2026-11-05',
    status: 'EXPIRED',
    zone: 'Mirpur',
    area: 'Section 2, Block D',
    distributionBox: 'TJ-MIR-02 (Port 11)',
    onuOpticalPower: -26.9,
    createdAt: '2026-04-12',
  },
];

export default function SubscribersPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>(initialSubscribers);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [zoneFilter, setZoneFilter] = useState<string>('ALL');
  const [connectionFilter, setConnectionFilter] = useState<string>('ALL');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedSubscriber, setSelectedSubscriber] = useState<Subscriber | null>(null);
  const [actionAlert, setActionAlert] = useState<string | null>(null);

  // New Subscriber Form State
  const [activeTab, setActiveTab] = useState<'kyc' | 'connection' | 'billing' | 'hardware'>('kyc');
  const [newClient, setNewClient] = useState({
    fullName: '',
    phone: '',
    email: '',
    nid: '',
    zone: 'Mirpur',
    area: 'Section 11',
    connectionType: 'PPPOE' as ConnectionType,
    username: '',
    password: '',
    packageName: '50 Mbps Gaming Pro',
    monthlyBill: 1200,
    router: 'MikroTik CCR2004 — Core BDIX',
    distributionBox: 'TJ-MIR-04 (Port 8)',
    ontSerial: 'HWTC-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    generateInvoice: true,
  });

  const showNotification = (msg: string) => {
    setActionAlert(msg);
    setTimeout(() => setActionAlert(null), 3500);
  };

  // Filter logic
  const filteredSubscribers = subscribers.filter((sub) => {
    const matchesSearch =
      sub.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.clientCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.phone.includes(searchQuery);

    const matchesStatus = statusFilter === 'ALL' || sub.status === statusFilter;
    const matchesZone = zoneFilter === 'ALL' || sub.zone === zoneFilter;
    const matchesConnection = connectionFilter === 'ALL' || sub.connectionType === connectionFilter;

    return matchesSearch && matchesStatus && matchesZone && matchesConnection;
  });

  const handleAddSubscriberSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClient.fullName || !newClient.username || !newClient.phone) {
      alert('Please fill out all required fields: Name, Phone, and PPPoE Username.');
      return;
    }

    const newSub: Subscriber = {
      id: 'sub-' + Date.now(),
      clientCode: `IZN-${newClient.zone.substring(0, 3).toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`,
      fullName: newClient.fullName,
      username: newClient.username,
      phone: newClient.phone,
      email: newClient.email,
      connectionType: newClient.connectionType,
      packageId: 'pkg-custom',
      packageName: newClient.packageName,
      monthlyBill: Number(newClient.monthlyBill),
      currentDue: newClient.generateInvoice ? Number(newClient.monthlyBill) : 0,
      expiryDate: '2026-12-15',
      status: 'ACTIVE',
      zone: newClient.zone,
      area: newClient.area,
      distributionBox: newClient.distributionBox,
      onuOpticalPower: -19.2,
      createdAt: new Date().toISOString().split('T')[0],
    };

    setSubscribers([newSub, ...subscribers]);
    setIsAddModalOpen(false);
    showNotification(`Subscriber ${newSub.fullName} (${newSub.clientCode}) created & provisioned to MikroTik!`);
  };

  const handleKick = (sub: Subscriber) => {
    showNotification(`RFC 3576 PoD Packet Sent: ${sub.username} session disconnected.`);
  };

  const handleRestore = (id: string) => {
    setSubscribers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'ACTIVE', currentDue: 0 } : s))
    );
    showNotification(`Account restored! Dynamic CoA pushed to MikroTik router.`);
  };

  const handleAutoGenerateCredentials = () => {
    const randomUser = 'user_' + Math.random().toString(36).substring(2, 7);
    const randomPass = Math.random().toString(36).substring(2, 10);
    setNewClient((prev) => ({
      ...prev,
      username: randomUser,
      password: randomPass,
    }));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-card border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
              Subscriber Management
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {subscribers.length} Registered
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            PPPoE Secrets, Static IPs, Hotspot Accounts & Optical Telemetry
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-md shadow-primary/20"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add New Subscriber</span>
          </button>
        </div>
      </div>

      {actionAlert && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span>{actionAlert}</span>
          </div>
          <button onClick={() => setActionAlert(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Quick Filter & Search Bar */}
      <div className="p-4 rounded-2xl bg-card border border-border shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search by Code, Name, PPPoE User, Phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended (Due)</option>
            <option value="EXPIRED">Expired</option>
          </select>

          {/* Zone Filter */}
          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
          >
            <option value="ALL">All Zones</option>
            <option value="Mirpur">Mirpur</option>
            <option value="Dhanmondi">Dhanmondi</option>
            <option value="Gulshan">Gulshan</option>
            <option value="Uttara">Uttara</option>
          </select>
        </div>
      </div>

      {/* Subscribers Table */}
      <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider bg-muted/40">
                <th className="py-3 px-4">Client ID / Code</th>
                <th className="py-3 px-4">Subscriber Name</th>
                <th className="py-3 px-4">Contact Phone</th>
                <th className="py-3 px-4">Package & Type</th>
                <th className="py-3 px-4">Distribution Box</th>
                <th className="py-3 px-4">Monthly Bill</th>
                <th className="py-3 px-4">Optical Rx</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredSubscribers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground text-xs">
                    No subscribers found matching your search and filter criteria.
                  </td>
                </tr>
              ) : (
                filteredSubscribers.map((sub) => (
                  <tr key={sub.id} className="hover:bg-muted/40 transition-colors group">
                    <td className="py-3 px-4 font-mono font-bold text-primary">
                      {sub.clientCode}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-foreground">{sub.fullName}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{sub.username}</div>
                    </td>

                    <td className="py-3 px-4 font-mono text-foreground">
                      {sub.phone}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-foreground">{sub.packageName}</div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono">{sub.connectionType}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-foreground">{sub.zone}</div>
                      <div className="text-[10px] text-muted-foreground">{sub.distributionBox || 'Direct'}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-foreground">BDT {sub.monthlyBill.toLocaleString()}</div>
                      <div className={`text-[10px] ${sub.currentDue > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}`}>
                        {sub.currentDue > 0 ? `Due: BDT ${sub.currentDue}` : 'Paid'}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono text-[11px]">
                      {sub.onuOpticalPower ? (
                        <span className={sub.onuOpticalPower < -25 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                          {sub.onuOpticalPower} dBm
                        </span>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          sub.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {sub.status === 'ACTIVE' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        {sub.status}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedSubscriber(sub)}
                          className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                          title="View Details & Telemetry"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {sub.status === 'ACTIVE' ? (
                          <button
                            onClick={() => handleKick(sub)}
                            className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Disconnect Session (PoD)"
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRestore(sub.id)}
                            className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-bold transition-colors"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Subscriber Wizard Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/40">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Add New Subscriber</h3>
                  <p className="text-[11px] text-muted-foreground">Provision PPPoE / Static IP Account</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step Navigation Tabs */}
            <div className="flex items-center border-b border-border bg-muted/20 px-6">
              {[
                { id: 'kyc', label: '1. KYC & Personal' },
                { id: 'connection', label: '2. Connection & AAA' },
                { id: 'billing', label: '3. Billing Setup' },
                { id: 'hardware', label: '4. FTTH & ONT' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleAddSubscriberSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
              {activeTab === 'kyc' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Full Customer Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Shakib Al Hasan"
                        value={newClient.fullName}
                        onChange={(e) => setNewClient({ ...newClient, fullName: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Primary Mobile Phone *
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="e.g. +8801700000000"
                        value={newClient.phone}
                        onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        placeholder="e.g. customer@gmail.com"
                        value={newClient.email}
                        onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        National ID / Passport Number
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 19902692510000"
                        value={newClient.nid}
                        onChange={(e) => setNewClient({ ...newClient, nid: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">Zone</label>
                      <select
                        value={newClient.zone}
                        onChange={(e) => setNewClient({ ...newClient, zone: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      >
                        <option value="Mirpur">Mirpur</option>
                        <option value="Dhanmondi">Dhanmondi</option>
                        <option value="Gulshan">Gulshan</option>
                        <option value="Uttara">Uttara</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">Area / Street</label>
                      <input
                        type="text"
                        placeholder="e.g. Road 4, House 12"
                        value={newClient.area}
                        onChange={(e) => setNewClient({ ...newClient, area: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'connection' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <span className="text-xs font-semibold text-foreground">AAA Credentials & Package</span>
                    <button
                      type="button"
                      onClick={handleAutoGenerateCredentials}
                      className="text-[11px] text-primary font-bold hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Auto-Generate
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Connection Protocol
                      </label>
                      <select
                        value={newClient.connectionType}
                        onChange={(e) => setNewClient({ ...newClient, connectionType: e.target.value as any })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      >
                        <option value="PPPOE">PPPoE (Recommended)</option>
                        <option value="STATIC_IP">Static IP (IPoE)</option>
                        <option value="HOTSPOT">Hotspot Voucher</option>
                        <option value="LEASED_LINE_CIR">Dedicated CIR Leased Line</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Assigned Core Router
                      </label>
                      <select
                        value={newClient.router}
                        onChange={(e) => setNewClient({ ...newClient, router: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      >
                        <option value="MikroTik CCR2004 — Core BDIX">MikroTik CCR2004 — Core BDIX</option>
                        <option value="MikroTik CHR — Cloud Gateway">MikroTik CHR — Cloud Gateway</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        PPPoE Username *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. rohit5656"
                        value={newClient.username}
                        onChange={(e) => setNewClient({ ...newClient, username: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground font-mono outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        PPPoE Password *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Pass1234"
                        value={newClient.password}
                        onChange={(e) => setNewClient({ ...newClient, password: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground font-mono outline-none focus:border-primary"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Bandwidth Speed Package
                      </label>
                      <select
                        value={newClient.packageName}
                        onChange={(e) => {
                          const val = e.target.value;
                          let price = 1000;
                          if (val.includes('30')) price = 800;
                          if (val.includes('50')) price = 1200;
                          if (val.includes('100')) price = 25000;
                          setNewClient({ ...newClient, packageName: val, monthlyBill: price });
                        }}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      >
                        <option value="30 Mbps Home Ultra">30 Mbps Home Ultra — BDT 800/mo</option>
                        <option value="50 Mbps Gaming Pro">50 Mbps Gaming Pro — BDT 1,200/mo</option>
                        <option value="100 Mbps Dedicated CIR">100 Mbps Dedicated CIR — BDT 25,000/mo</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'billing' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Monthly Bill Amount (BDT) *
                      </label>
                      <input
                        type="number"
                        required
                        value={newClient.monthlyBill}
                        onChange={(e) => setNewClient({ ...newClient, monthlyBill: Number(e.target.value) })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground font-bold outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Billing Model
                      </label>
                      <select className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary">
                        <option value="PREPAID">Prepaid (Auto-suspend on due)</option>
                        <option value="POSTPAID">Postpaid (Invoice on month end)</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2 p-3 rounded-xl bg-muted/40 border border-border flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-foreground">Generate 1st Month Invoice Now</div>
                        <div className="text-[11px] text-muted-foreground">Creates open invoice and sends payment link via SMS</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={newClient.generateInvoice}
                        onChange={(e) => setNewClient({ ...newClient, generateInvoice: e.target.checked })}
                        className="w-4 h-4 rounded text-primary"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'hardware' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Distribution Box (TJ Box)
                      </label>
                      <select
                        value={newClient.distributionBox}
                        onChange={(e) => setNewClient({ ...newClient, distributionBox: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                      >
                        <option value="TJ-MIR-04 (Port 8)">TJ-MIR-04 (Mirpur Sec 10 — Port 8 Available)</option>
                        <option value="TJ-DHN-02 (Port 4)">TJ-DHN-02 (Dhanmondi Rd 27 — Port 4 Available)</option>
                        <option value="TJ-UTT-09 (Port 2)">TJ-UTT-09 (Uttara Sec 4 — Port 2 Available)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        ONT / ONU Serial Number
                      </label>
                      <input
                        type="text"
                        value={newClient.ontSerial}
                        onChange={(e) => setNewClient({ ...newClient, ontSerial: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground font-mono outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Footer Controls */}
              <div className="pt-4 border-t border-border flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-muted hover:bg-muted/80 text-foreground"
                >
                  Cancel
                </button>

                <div className="flex items-center gap-2">
                  {activeTab !== 'hardware' ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (activeTab === 'kyc') setActiveTab('connection');
                        else if (activeTab === 'connection') setActiveTab('billing');
                        else if (activeTab === 'billing') setActiveTab('hardware');
                      }}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover"
                    >
                      Next Step
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="px-5 py-2 text-xs font-bold rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 shadow-md shadow-emerald-500/20"
                    >
                      Save & Provision Subscriber
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subscriber Detail Drawer Modal */}
      {selectedSubscriber && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="text-base font-bold text-foreground">{selectedSubscriber.fullName}</h3>
                <span className="font-mono text-xs text-primary">{selectedSubscriber.clientCode}</span>
              </div>
              <button
                onClick={() => setSelectedSubscriber(null)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-muted/40 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase block font-semibold">PPPoE User</span>
                <span className="font-mono font-bold text-foreground">{selectedSubscriber.username}</span>
              </div>
              <div className="p-3 rounded-xl bg-muted/40 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase block font-semibold">Optical Power</span>
                <span className="font-mono font-bold text-emerald-400">{selectedSubscriber.onuOpticalPower} dBm (Normal)</span>
              </div>
              <div className="p-3 rounded-xl bg-muted/40 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase block font-semibold">Assigned Box</span>
                <span className="font-semibold text-foreground">{selectedSubscriber.distributionBox}</span>
              </div>
              <div className="p-3 rounded-xl bg-muted/40 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase block font-semibold">Monthly Plan</span>
                <span className="font-bold text-foreground">BDT {selectedSubscriber.monthlyBill}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  handleKick(selectedSubscriber);
                  setSelectedSubscriber(null);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20"
              >
                PoD Session Kick
              </button>
              <button
                onClick={() => setSelectedSubscriber(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-primary text-primary-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
