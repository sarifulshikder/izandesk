'use client';

import React, { useState } from 'react';
import {
  Boxes,
  PackagePlus,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  HardDrive,
  Radio,
  Warehouse,
  Truck,
  FileSpreadsheet,
  X,
  Zap,
} from 'lucide-react';

interface InventoryItem {
  id: string;
  serialNumber: string;
  category: 'ONT' | 'ROUTER' | 'CABLE' | 'SPLICER';
  modelName: string;
  warehouse: string;
  assignedClient?: string;
  assignedTechnician?: string;
  status: 'IN_STOCK' | 'ASSIGNED_CLIENT' | 'DEFECTIVE_RMA' | 'TRANSIT';
  warrantyUntil: string;
}

const initialInventory: InventoryItem[] = [
  {
    id: 'inv-01',
    serialNumber: 'HWTC-8921B-4091',
    category: 'ONT',
    modelName: 'Huawei EchoLife HG8310M GPON',
    warehouse: 'Central Warehouse (Mirpur)',
    assignedClient: 'Rohit Sharma (IZN-MIR-00142)',
    status: 'ASSIGNED_CLIENT',
    warrantyUntil: '2027-01-15',
  },
  {
    id: 'inv-02',
    serialNumber: 'BDCM-3600-9912',
    category: 'ONT',
    modelName: 'BDCOM GPON ONU 1GE',
    warehouse: 'Central Warehouse (Mirpur)',
    status: 'IN_STOCK',
    warrantyUntil: '2026-12-31',
  },
  {
    id: 'inv-03',
    serialNumber: 'VSOL-V2801-1102',
    category: 'ONT',
    modelName: 'VSOL EPON/GPON XPON Hybrid',
    warehouse: 'Mobile Van #1 (Field Team)',
    assignedTechnician: 'Kamrul Hasan (Field Lead)',
    status: 'IN_STOCK',
    warrantyUntil: '2027-04-10',
  },
  {
    id: 'inv-04',
    serialNumber: 'MK-CCR-2004-8991',
    category: 'ROUTER',
    modelName: 'MikroTik CCR2004-16G-2S+',
    warehouse: 'Central Warehouse (Mirpur)',
    status: 'IN_STOCK',
    warrantyUntil: '2027-08-20',
  },
  {
    id: 'inv-05',
    serialNumber: 'FBR-DRUM-1000M-04',
    category: 'CABLE',
    modelName: '2-Core FTTH Drop Cable (1,000m Drum)',
    warehouse: 'Central Warehouse (Mirpur)',
    status: 'IN_STOCK',
    warrantyUntil: 'Lifetime',
  },
  {
    id: 'inv-06',
    serialNumber: 'HWTC-7712A-1004',
    category: 'ONT',
    modelName: 'Huawei HG8245H5 Dual-Band WiFi',
    warehouse: 'Dhanmondi Branch',
    status: 'DEFECTIVE_RMA',
    warrantyUntil: '2026-11-30',
  },
];

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [warehouseFilter, setWarehouseFilter] = useState('ALL');

  // Add Item Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [actionAlert, setActionAlert] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({
    serialNumber: 'HWTC-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    category: 'ONT' as any,
    modelName: 'Huawei EchoLife HG8310M GPON',
    warehouse: 'Central Warehouse (Mirpur)',
  });

  const showNotification = (msg: string) => {
    setActionAlert(msg);
    setTimeout(() => setActionAlert(null), 3000);
  };

  const filteredInventory = inventory.filter((item) => {
    const matchesSearch =
      item.serialNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.modelName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.assignedClient && item.assignedClient.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    const matchesCategory = categoryFilter === 'ALL' || item.category === categoryFilter;
    const matchesWarehouse = warehouseFilter === 'ALL' || item.warehouse === warehouseFilter;

    return matchesSearch && matchesStatus && matchesCategory && matchesWarehouse;
  });

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    const created: InventoryItem = {
      id: 'inv-' + Date.now(),
      serialNumber: newItem.serialNumber,
      category: newItem.category,
      modelName: newItem.modelName,
      warehouse: newItem.warehouse,
      status: 'IN_STOCK',
      warrantyUntil: '2027-11-12',
    };

    setInventory([created, ...inventory]);
    setIsAddModalOpen(false);
    showNotification(`Added ${created.modelName} (SN: ${created.serialNumber}) to inventory!`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-card border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
              Hardware Inventory & Asset Serials
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {inventory.length} Tracked Units
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            Multi-Warehouse Tracking, ONT Serial Barcodes, Routers & Fiber Drums
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-md shadow-primary/20"
        >
          <PackagePlus className="w-4 h-4" />
          <span>Add Stock Batch</span>
        </button>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-card border border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>ONTs in Stock</span>
            <HardDrive className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-black text-foreground">142 Units</div>
          <span className="text-[11px] text-emerald-400 font-medium">92% Ready for Dispatch</span>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Core Routers</span>
            <Radio className="w-4 h-4 text-secondary" />
          </div>
          <div className="text-2xl font-black text-foreground">6 Units</div>
          <span className="text-[11px] text-muted-foreground">CCR2004 & CHR Standby</span>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Fiber Drop Cable</span>
            <Boxes className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-foreground">4,850 Meters</div>
          <span className="text-[11px] text-muted-foreground">5 Drums in Central Hub</span>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Defective / RMA</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-black text-rose-400">1 Unit</div>
          <span className="text-[11px] text-rose-400 font-medium">Ready for Supplier Claim</span>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="p-4 rounded-2xl bg-card border border-border shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search serial number, model, or assigned customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
          >
            <option value="ALL">All Categories</option>
            <option value="ONT">ONTs & ONUs</option>
            <option value="ROUTER">Core Routers</option>
            <option value="CABLE">Fiber Cables</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
          >
            <option value="ALL">All Statuses</option>
            <option value="IN_STOCK">In Stock</option>
            <option value="ASSIGNED_CLIENT">Assigned to Client</option>
            <option value="DEFECTIVE_RMA">Defective RMA</option>
          </select>
        </div>
      </div>

      {/* Inventory Data Table */}
      <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider bg-muted/40">
                <th className="py-3 px-4">Serial / Barcode</th>
                <th className="py-3 px-4">Category & Model</th>
                <th className="py-3 px-4">Warehouse Location</th>
                <th className="py-3 px-4">Assigned To</th>
                <th className="py-3 px-4">Warranty</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredInventory.map((item) => (
                <tr key={item.id} className="hover:bg-muted/40 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-primary flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{item.serialNumber}</span>
                  </td>

                  <td className="py-3 px-4">
                    <div className="font-bold text-foreground">{item.modelName}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{item.category}</div>
                  </td>

                  <td className="py-3 px-4 text-foreground">
                    {item.warehouse}
                  </td>

                  <td className="py-3 px-4">
                    {item.assignedClient ? (
                      <span className="font-semibold text-foreground">{item.assignedClient}</span>
                    ) : item.assignedTechnician ? (
                      <span className="font-medium text-indigo-400">{item.assignedTechnician}</span>
                    ) : (
                      <span className="text-muted-foreground">Unassigned (Free Stock)</span>
                    )}
                  </td>

                  <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground">
                    {item.warrantyUntil}
                  </td>

                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === 'IN_STOCK'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : item.status === 'ASSIGNED_CLIENT'
                          ? 'bg-primary/10 text-primary border border-primary/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {item.status === 'IN_STOCK' && <CheckCircle2 className="w-3 h-3" />}
                      {item.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Stock Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <PackagePlus className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Add Hardware Item</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Serial Number (Barcode) *
                </label>
                <input
                  type="text"
                  required
                  value={newItem.serialNumber}
                  onChange={(e) => setNewItem({ ...newItem, serialNumber: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground font-mono font-bold outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Category</label>
                <select
                  value={newItem.category}
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                >
                  <option value="ONT">ONT / ONU</option>
                  <option value="ROUTER">Core Router</option>
                  <option value="CABLE">Fiber Cable</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Model Name *</label>
                <input
                  type="text"
                  required
                  value={newItem.modelName}
                  onChange={(e) => setNewItem({ ...newItem, modelName: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Storage Warehouse</label>
                <select
                  value={newItem.warehouse}
                  onChange={(e) => setNewItem({ ...newItem, warehouse: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border text-foreground outline-none focus:border-primary"
                >
                  <option value="Central Warehouse (Mirpur)">Central Warehouse (Mirpur)</option>
                  <option value="Dhanmondi Branch">Dhanmondi Branch</option>
                  <option value="Mobile Van #1 (Field Team)">Mobile Van #1 (Field Team)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-muted hover:bg-muted/80 text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
