import React from "react";
import { ShoppingCart, Plus, Search, ArrowUpRight, ArrowDownRight, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Trade, Fund, Asset } from "@/src/types";
import { collection, addDoc, doc, updateDoc, runTransaction, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/src/firebase";
import TickerSearch from "./TickerSearch";
import ConfirmationModal from "./ConfirmationModal";

interface TradesProps {
  trades: Trade[];
  assets: Asset[];
  fund?: Fund;
  userId: string;
  userRole: 'admin' | 'investor' | 'public';
}

export default function Trades({ trades, assets, fund, userId, userRole }: TradesProps) {
  const isAdmin = userRole === 'admin';
  const [isAdding, setIsAdding] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [newTrade, setNewTrade] = React.useState({
    ticker: "",
    side: "buy" as "buy" | "sell",
    shares: 0,
    totalCost: 0,
    notes: "",
    date: new Date().toISOString().split('T')[0]
  });

  const handleTickerSelect = async (ticker: string, name: string) => {
    setNewTrade(prev => ({ ...prev, ticker: ticker }));
    try {
      const response = await fetch(`/api/stock/${encodeURIComponent(ticker)}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.price) {
          // Auto-calculate total cost if shares are already entered
          setNewTrade(prev => ({ 
            ...prev, 
            ticker: ticker,
            totalCost: prev.shares > 0 ? data.price * prev.shares : prev.totalCost 
          }));
        }
      }
    } catch (error) {
      console.error("Error fetching price for selected ticker:", error);
    }
  };

  const handleDeleteTrade = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(doc(db, "trades", deleteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "trades");
    }
  };

  const handleAddTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund || isSubmitting) return;

    setIsSubmitting(true);
    
    if (isNaN(newTrade.shares) || newTrade.shares <= 0) {
      alert("Please enter a valid number of shares.");
      setIsSubmitting(false);
      return;
    }

    if (isNaN(newTrade.totalCost) || newTrade.totalCost <= 0) {
      alert("Please enter a valid total cost.");
      setIsSubmitting(false);
      return;
    }

    const price = newTrade.totalCost / newTrade.shares;
    const notional = newTrade.totalCost;
    const cashImpact = newTrade.side === "buy" ? -notional : notional;

    if (isNaN(price) || !isFinite(price)) {
      alert("Invalid price calculation. Please check shares and total cost.");
      setIsSubmitting(false);
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const fundRef = doc(db, "funds", fund.id);
        const fundSnap = await transaction.get(fundRef);
        if (!fundSnap.exists()) throw "Fund does not exist!";
        const currentFund = fundSnap.data() as Fund;

        // Validation: Insufficient Funds
        if (newTrade.side === "buy" && currentFund.cashBalance < notional) {
          throw "Insufficient cash balance for this trade!";
        }

        // Find or create asset
        const assetsRef = collection(db, "assets");
        const q = query(assetsRef, where("fundId", "==", fund.id), where("ticker", "==", newTrade.ticker.toUpperCase()));
        const assetSnap = await getDocs(q);
        
        let assetId = "";
        let currentShares = 0;
        let currentCostBasis = 0;
        let realizedPnL = 0;

        if (!assetSnap.empty) {
          const assetDoc = assetSnap.docs[0];
          assetId = assetDoc.id;
          const assetData = assetDoc.data() as Asset;
          currentShares = assetData.amount;
          currentCostBasis = assetData.costBasis;
        }

        if (newTrade.side === "sell") {
          if (currentShares < newTrade.shares) {
            console.error(`Insufficient shares to sell! currentShares: ${currentShares}, newTrade.shares: ${newTrade.shares}`);
            throw "Insufficient shares to sell!";
          }
          const avgCost = currentCostBasis / currentShares;
          realizedPnL = (price - avgCost) * newTrade.shares;
        } else if (newTrade.side === "buy") {
          if (currentFund.cashBalance < notional) throw "Insufficient cash to buy!";
        }

        // Create Trade Entry
        const tradeRef = doc(collection(db, "trades"));
        const tradeData: Omit<Trade, 'id'> = {
          fundId: fund.id,
          ticker: newTrade.ticker.toUpperCase(),
          side: newTrade.side,
          shares: newTrade.shares,
          price: price,
          notional,
          cashImpact,
          realizedPnL,
          date: new Date(newTrade.date).getTime(),
          notes: newTrade.notes,
          userId,
          createdAt: Date.now()
        };
        transaction.set(tradeRef, tradeData);

        // Update Fund Cash
        transaction.update(fundRef, {
          cashBalance: currentFund.cashBalance + cashImpact,
          updatedAt: Date.now()
        });

        // Update or Create Asset
        if (assetId) {
          const assetRef = doc(db, "assets", assetId);
          const newShares = currentShares + (newTrade.side === "buy" ? newTrade.shares : -newTrade.shares);
          const newCostBasis = newTrade.side === "buy" 
            ? currentCostBasis + notional 
            : currentCostBasis - (currentCostBasis / currentShares * newTrade.shares);
          
          if (newShares === 0) {
            transaction.delete(assetRef);
          } else {
            transaction.update(assetRef, {
              amount: newShares,
              costBasis: newCostBasis,
              price: price, // Update price to last trade price
              updatedAt: Date.now()
            });
          }
        } else if (newTrade.side === "buy") {
          const newAssetRef = doc(collection(db, "assets"));
          const newAssetData: Omit<Asset, 'id'> = {
            fundId: fund.id,
            ticker: newTrade.ticker.toUpperCase(),
            name: newTrade.ticker.toUpperCase(), // Placeholder
            type: "stock",
            amount: newTrade.shares,
            price: price,
            costBasis: notional,
            userId,
            date: new Date(newTrade.date).getTime(),
            createdAt: Date.now()
          };
          transaction.set(newAssetRef, newAssetData);
        }
      });

      setIsAdding(false);
      setNewTrade({ ticker: "", side: "buy", shares: 0, totalCost: 0, notes: "", date: new Date().toISOString().split('T')[0] });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "trades");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold italic serif">Trade Log</h2>
        <button 
          onClick={() => setIsAdding(true)}
          className={cn(
            "bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:scale-105 transition-transform",
            !isAdmin && "hidden"
          )}
        >
          <Plus size={18} />
          New Trade
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-2xl border border-[#141414]/10 shadow-sm animate-in fade-in zoom-in-95 duration-200">
          <form onSubmit={handleAddTrade} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Ticker</label>
                <TickerSearch 
                  onSelect={handleTickerSelect}
                  initialValue={newTrade.ticker}
                  placeholder="Search Ticker..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Side</label>
                <select 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20"
                  value={newTrade.side}
                  onChange={(e) => setNewTrade({ ...newTrade, side: e.target.value as any })}
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Shares</label>
                <input 
                  required
                  type="number" 
                  step="0.0001"
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  placeholder="0.00"
                  value={isNaN(newTrade.shares) ? "" : newTrade.shares}
                  onChange={(e) => setNewTrade({ ...newTrade, shares: e.target.value === "" ? NaN : parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Total Cost ($)</label>
                <input 
                  required
                  type="number" 
                  step="0.01"
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  placeholder="0.00"
                  value={isNaN(newTrade.totalCost) ? "" : newTrade.totalCost}
                  onChange={(e) => setNewTrade({ ...newTrade, totalCost: e.target.value === "" ? NaN : parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Date</label>
                <input 
                  required
                  type="date" 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  value={newTrade.date}
                  onChange={(e) => setNewTrade({ ...newTrade, date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold text-sm disabled:opacity-50"
              >
                {isSubmitting ? "Processing..." : "Execute Trade"}
              </button>
              <button type="button" onClick={() => setIsAdding(false)} className="flex-1 bg-[#141414]/5 py-3 rounded-xl font-bold text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-[#141414]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#141414]/5">
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest">Date</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest">Ticker</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest">Side</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Shares</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Price</th>
                 <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Notional</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Realized PnL</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/5">
              {trades.sort((a, b) => b.date - a.date).map((trade) => (
                <tr key={trade.id} className="group hover:bg-[#141414]/5 transition-colors">
                  <td className="p-4 text-sm font-mono opacity-50">{new Date(trade.date).toLocaleDateString()}</td>
                  <td className="p-4 text-sm font-bold">{trade.ticker}</td>
                  <td className="p-4">
                    <span className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full",
                      trade.side === "buy" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    )}>
                      {trade.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4 text-right font-mono text-sm">{trade.shares.toLocaleString()}</td>
                  <td className="p-4 text-right font-mono text-sm">${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-4 text-right font-mono text-sm">${trade.notional.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className={cn(
                    "p-4 text-right font-mono text-sm",
                    trade.realizedPnL > 0 ? "text-green-600" : trade.realizedPnL < 0 ? "text-red-600" : "opacity-50"
                  )}>
                    {trade.realizedPnL !== 0 ? `$${trade.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "-"}
                  </td>
                  <td className={cn("p-4 text-right", !isAdmin && "hidden")}>
                    <button 
                      onClick={() => {
                        setDeleteId(trade.id);
                        setIsDeleteModalOpen(true);
                      }}
                      className="text-red-500 hover:text-red-700 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-xs opacity-50 font-mono uppercase tracking-widest">
                    No trades found
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
        onConfirm={handleDeleteTrade}
        title="Delete Trade"
        message="Are you sure you want to delete this trade? This will NOT automatically reverse the portfolio impact. You should manually adjust positions if needed."
      />
    </div>
  );
}
