import React from "react";
import { Plus, Search, Filter, MoreVertical, Trash2, Edit2, TrendingUp, TrendingDown, X, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Asset, Fund } from "@/src/types";
import { collection, addDoc, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/src/firebase";
import TickerSearch from "./TickerSearch";
import ConfirmationModal from "./ConfirmationModal";

interface PortfolioProps {
  assets: Asset[];
  fund?: Fund;
  userId: string;
  userRole: 'admin' | 'investor' | 'public';
}

export default function Portfolio({ assets, fund, userId, userRole }: PortfolioProps) {
  const isAdmin = userRole === 'admin';
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isAdding, setIsAdding] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [editingAsset, setEditingAsset] = React.useState<Asset | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [newAsset, setNewAsset] = React.useState<{
    ticker: string;
    name: string;
    type: string;
    amount: number;
    price: number;
    costBasis: number;
    date: string;
  }>({
    ticker: "",
    name: "",
    type: "stock",
    amount: 0,
    price: 0,
    costBasis: 0,
    date: new Date().toISOString().split('T')[0]
  });

  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const fetchStockData = async (ticker: string) => {
    const trimmedTicker = ticker.trim();
    if (!trimmedTicker) return null;
    try {
      const response = await fetch(`/api/stock/${encodeURIComponent(trimmedTicker)}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch");
      }
      return await response.json();
    } catch (error) {
      console.error("Error fetching stock:", error);
      return null;
    }
  };

  const handleRefreshPrices = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      for (const asset of assets) {
        if (asset.type === "stock") {
          const data = await fetchStockData(asset.ticker);
          if (data && data.price) {
            const assetRef = doc(db, "assets", asset.id);
            await updateDoc(assetRef, {
              price: data.price,
              updatedAt: Date.now()
            });
          }
        }
      }
    } catch (error) {
      console.error("Error refreshing prices:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTickerSelect = async (ticker: string, name: string) => {
    setNewAsset(prev => ({ ...prev, ticker: ticker, name: name }));
    const data = await fetchStockData(ticker);
    if (data) {
      setNewAsset(prev => ({
        ...prev,
        name: data.name || prev.name,
        price: data.price || prev.price
      }));
    }
  };

  const filteredAssets = assets.filter(a => 
    a.ticker.toLowerCase().includes(searchQuery.toLowerCase()) || 
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDeleteAsset = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(doc(db, "assets", deleteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "assets");
    }
  };

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      if (editingAsset) {
        const assetRef = doc(db, "assets", editingAsset.id);
        await updateDoc(assetRef, {
          ...newAsset,
          ticker: newAsset.ticker.toUpperCase(),
          date: new Date(newAsset.date).getTime(),
          updatedAt: Date.now()
        });
        setEditingAsset(null);
      } else {
        const assetData = {
          ...newAsset,
          ticker: newAsset.ticker.toUpperCase(),
          fundId: fund.id,
          userId,
          date: new Date(newAsset.date).getTime(),
          createdAt: Date.now()
        };
        await addDoc(collection(db, "assets"), assetData);
      }
      setIsAdding(false);
      setNewAsset({ ticker: "", name: "", type: "stock", amount: 0, price: 0, costBasis: 0, date: new Date().toISOString().split('T')[0] });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "assets");
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (asset: Asset) => {
    setEditingAsset(asset);
    setNewAsset({
      ticker: asset.ticker,
      name: asset.name,
      type: asset.type,
      amount: asset.amount,
      price: asset.price,
      costBasis: asset.costBasis,
      date: asset.date ? new Date(asset.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    });
    setIsAdding(true);
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold italic serif tracking-tight">Portfolio</h2>
          {fund && (
            <p className="text-sm font-mono opacity-50">
              Remaining Cash: ${fund.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#141414]/30" size={16} />
            <input 
              type="text" 
              placeholder="Search assets..." 
              className="w-full bg-white border border-[#141414]/10 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20 transition-all font-mono"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={handleRefreshPrices}
            disabled={isRefreshing}
            className="p-2 bg-white border border-[#141414]/10 rounded-xl text-[#141414] hover:bg-[#141414]/5 transition-colors disabled:opacity-50"
            title="Refresh all stock prices"
          >
            <RefreshCw size={18} className={cn(isRefreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold italic serif">{editingAsset ? "Edit Position" : "Add New Position"}</h3>
              <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddAsset} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Ticker</label>
                  <TickerSearch 
                    onSelect={handleTickerSelect}
                    initialValue={newAsset.ticker}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Asset Name</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-2 text-sm font-mono" 
                    placeholder="Apple Inc."
                    value={newAsset.name}
                    onChange={e => setNewAsset({...newAsset, name: e.target.value})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Shares</label>
                  <input 
                    required
                    type="number" 
                    step="any"
                    className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-2 text-sm font-mono"
                    value={newAsset.amount}
                    onChange={e => setNewAsset({...newAsset, amount: parseFloat(e.target.value)})}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Total Cost Basis ($)</label>
                <input 
                  required
                  type="number" 
                  step="any"
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-2 text-sm font-mono"
                  value={newAsset.costBasis}
                  onChange={e => setNewAsset({...newAsset, costBasis: parseFloat(e.target.value)})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Date</label>
                <input 
                  required
                  type="date" 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-2 text-sm font-mono"
                  value={newAsset.date}
                  onChange={e => setNewAsset({...newAsset, date: e.target.value})}
                />
              </div>
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold mt-4 disabled:opacity-50"
              >
                {isSubmitting ? "Processing..." : (editingAsset ? "Update Position" : "Save Position")}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-[#141414]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#141414]/5">
                <th className="px-6 py-4 text-[10px] opacity-50 uppercase tracking-widest">Ticker</th>
                <th className="px-6 py-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Shares</th>
                <th className="px-6 py-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Avg Cost</th>
                <th className="px-6 py-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Price</th>
                <th className="px-6 py-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Market Value</th>
                <th className="px-6 py-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Gain/Loss</th>
                <th className="px-6 py-4 text-[10px] opacity-50 uppercase tracking-widest text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/5">
              {filteredAssets.length > 0 ? filteredAssets.map((asset) => {
                const avgCost = asset.amount > 0 ? asset.costBasis / asset.amount : 0;
                const marketValue = asset.amount * asset.price;
                const gainLoss = marketValue - asset.costBasis;
                const gainLossPct = asset.costBasis > 0 ? (gainLoss / asset.costBasis) * 100 : 0;

                return (
                  <tr key={asset.id} className="group hover:bg-[#141414]/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#141414]/5 flex items-center justify-center font-bold text-xs">
                          {asset.ticker}
                        </div>
                        <div>
                          <p className="text-sm font-bold">{asset.ticker}</p>
                          <p className="text-[10px] opacity-50">{asset.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm text-right">{asset.amount.toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono text-sm text-right">${avgCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 font-mono text-sm text-right">${asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 font-mono text-sm font-bold text-right">
                      ${marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={cn(
                      "px-6 py-4 font-mono text-sm text-right",
                      gainLoss >= 0 ? "text-green-600" : "text-red-600"
                    )}>
                      <div>${gainLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="text-[10px] opacity-70">{gainLossPct >= 0 ? "+" : ""}{gainLossPct.toFixed(2)}%</div>
                    </td>
                    <td className={cn("px-6 py-4", !isAdmin && "hidden")}>
                      <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => startEdit(asset)}
                          className="p-2 hover:bg-[#141414]/10 rounded-lg transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          onClick={() => {
                            setDeleteId(asset.id);
                            setIsDeleteModalOpen(true);
                          }}
                          className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-xs opacity-50 font-mono uppercase tracking-widest">
                    No positions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmationModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteAsset}
        title="Delete Position"
        message="Are you sure you want to delete this position? This will NOT automatically adjust the fund's cash balance. You should manually adjust the cash balance via a trade or ledger entry if needed."
      />
    </div>
  );
}
