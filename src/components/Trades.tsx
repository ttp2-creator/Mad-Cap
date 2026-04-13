import React from "react";
import { 
  Repeat, ArrowUpRight, ArrowDownRight, 
  Search, Download, Plus, Filter,
  TrendingUp, Activity, PieChart,
  X, ChevronRight, RefreshCw, Trash2,
  Scan, AlertCircle, Info, Activity as QuoteIcon
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Trade, Asset, Fund } from "@/src/types";
import { collection, addDoc, doc, updateDoc, getDocs, query, where, setDoc, deleteDoc } from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType } from "@/src/firebase";
import { fetchStockQuote, searchStocks } from "@/src/lib/finnhub";

interface TradesProps {
  fund?: Fund;
  trades: Trade[];
  assets: Asset[];
  userRole: 'PM' | 'Analyst' | 'Public';
}

export default function Trades({ fund, trades, assets, userRole }: TradesProps) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  // Form State
  const [newTrade, setNewTrade] = React.useState({
    ticker: "",
    side: "buy" as "buy" | "sell",
    amount: 0,
    notional: 0,
    date: new Date().toISOString().split('T')[0],
    notes: ""
  });

  // Ticker Validation & Suggestions State
  const [currentPrice, setCurrentPrice] = React.useState<number | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);
  const [tickerError, setTickerError] = React.useState<string | null>(null);
  const [suggestions, setSuggestions] = React.useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);

  // Debounced Ticker Validation & Suggestions
  React.useEffect(() => {
    if (!newTrade.ticker || newTrade.ticker.length < 1) {
      setCurrentPrice(null);
      setTickerError(null);
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsValidating(true);
      
      try {
        // 1. Fetch search results for suggestions
        if (newTrade.ticker.length >= 1) {
          const searchData = await searchStocks(newTrade.ticker);
          setSuggestions(searchData.result?.slice(0, 8) || []);
        }

        // 2. Fetch quote if it looks like a ticker (no spaces, caps)
        const cleanTicker = newTrade.ticker.trim().toUpperCase();
        if (cleanTicker.length >= 1 && !cleanTicker.includes(" ")) {
          const quote = await fetchStockQuote(cleanTicker);
          if (quote && quote.price > 0) {
            setCurrentPrice(quote.price);
            setTickerError(null);
          } else {
            setCurrentPrice(null);
            // We only show error if search returns nothing found for precise match
          }
        }
      } catch (err) {
        console.error("Discovery error", err);
      } finally {
        setIsValidating(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [newTrade.ticker]);
  
  const filteredTrades = trades.filter(trade => 
    trade.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trade.side.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trade.notes?.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => b.date - a.date);

  const totalRealizedPnl = trades.reduce((sum, trade) => sum + (trade.realizedPnL || 0), 0);

  const handleDeleteTrade = async (trade: Trade) => {
    // Explicit Admin Guard & Confirmation
    const confirmMessage = `SAFE-DELETE PROTOCOL\n\nREVERT ${trade.side.toUpperCase()} ${trade.ticker}?\nAMOUNT: ${trade.amount}\nNOTIONAL: $${trade.notional.toLocaleString()}\n\nTHIS WILL REVERT CASH AND INVENTORY. PROCEED?`;
    
    if (!fund || !window.confirm(confirmMessage)) {
      console.log("Delete cancelled or fund missing", { fundPresent: !!fund });
      return;
    }

    setIsSaving(true);
    console.group(`ADMIN: VOID TRADE ${trade.id}`);
    console.log("Reversing trade impacts:", trade);

    try {
      const sideMultiplier = trade.side === 'buy' ? 1 : -1;
      const notional = trade.notional;
      const amount = trade.amount;
      const ticker = trade.ticker;

      // 1. Revert Fund Cash
      console.log("Step 1: Reverting Fund Cash", { from: fund.cashBalance, change: notional * sideMultiplier });
      await updateDoc(doc(db, "funds", fund.id), {
        cashBalance: fund.cashBalance + (notional * sideMultiplier),
        updatedAt: Date.now()
      });

      // 2. Revert Asset Inventory
      console.log("Step 2: Reverting Asset Inventory", { ticker });
      const assetQuery = query(collection(db, "assets"), where("fundId", "==", fund.id), where("ticker", "==", ticker));
      const assetSnapshot = await getDocs(assetQuery);
      
      if (!assetSnapshot.empty) {
        const assetRef = assetSnapshot.docs[0].ref;
        const currentAsset = assetSnapshot.docs[0].data() as Asset;
        console.log("Found asset, updating:", currentAsset);
        await updateDoc(assetRef, {
          amount: currentAsset.amount - (amount * sideMultiplier),
          costBasis: currentAsset.costBasis - (notional * sideMultiplier),
          updatedAt: Date.now()
        });
      } else {
        console.warn("Asset not found for reversal - check database integrity.");
      }

      // 3. Delete Trade
      console.log("Step 3: Deleting Trade Document");
      await deleteDoc(doc(db, "trades", trade.id));
      
      console.log("ADMIN SUCCESS: Trade voided and financial parity maintained.");
      window.alert("✅ TRADE VOIDED SUCCESSFULLY");
    } catch (error) {
      console.error("ADMIN CRITICAL FAILURE:", error);
      window.alert("❌ FAILED TO VOID TRADE: " + (error instanceof Error ? error.message : String(error)));
      handleFirestoreError(error, OperationType.DELETE, "trades");
    } finally {
      console.groupEnd();
      setIsSaving(false);
    }
  };

  const handleAddTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund || isSaving) return;
    setIsSaving(true);

    try {
      const ticker = newTrade.ticker.toUpperCase();
      const tradeAmount = newTrade.amount;
      const notional = newTrade.notional;
      const tradePrice = tradeAmount > 0 ? notional / tradeAmount : 0;
      const sideMultiplier = newTrade.side === 'buy' ? 1 : -1;
      const cashImpact = notional * sideMultiplier;
      
      // 1. Record Trade
      const tradeData: Omit<Trade, 'id'> = {
        fundId: fund.id,
        userId: auth.currentUser?.uid || "system",
        ticker: ticker,
        side: newTrade.side,
        amount: tradeAmount,
        price: tradePrice,
        notional: notional,
        cashImpact: -cashImpact,
        date: new Date(newTrade.date).getTime(),
        createdAt: Date.now(),
        realizedPnL: 0,
        notes: newTrade.notes
      };

      await addDoc(collection(db, "trades"), tradeData);

      // 2. Update Asset Inventory
      const assetQuery = query(collection(db, "assets"), where("fundId", "==", fund.id), where("ticker", "==", ticker));
      const assetSnapshot = await getDocs(assetQuery);
      
      if (assetSnapshot.empty) {
        if (newTrade.side === 'buy') {
          await addDoc(collection(db, "assets"), {
            fundId: fund.id,
            ticker: ticker,
            name: ticker,
            type: "equity",
            amount: tradeAmount,
            price: tradePrice,
            costBasis: notional,
            userId: auth.currentUser?.uid || "system",
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
        }
      } else {
        const assetRef = assetSnapshot.docs[0].ref;
        const currentAsset = assetSnapshot.docs[0].data() as Asset;
        const newAmount = currentAsset.amount + (tradeAmount * sideMultiplier);
        const newCostBasis = currentAsset.costBasis + (notional * sideMultiplier);
        
        await updateDoc(assetRef, {
          amount: newAmount,
          costBasis: newAmount > 0 ? newCostBasis : 0,
          price: tradePrice,
          updatedAt: Date.now()
        });
      }

      await updateDoc(doc(db, "funds", fund.id), {
        cashBalance: fund.cashBalance - cashImpact,
        updatedAt: Date.now()
      });

      setShowAddModal(false);
      setNewTrade({
        ticker: "",
        side: "buy",
        amount: 0,
        notional: 0,
        date: new Date().toISOString().split('T')[0],
        notes: ""
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "trades");
    } finally {
      setIsSaving(false);
    }
  };

  const isTradeBlocked = !newTrade.ticker || isValidating;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Trades Header */}
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div className="text-left">
          <h2 className="text-xl font-bold tracking-tight text-text-primary mb-1 uppercase text-left">TRADES</h2>
          <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] font-medium text-left">HISTORY</p>
        </div>
        <div className="flex gap-2">
          {userRole === 'PM' && (
            <button 
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 text-[10px] bg-accent hover:bg-accent-hover text-bg-primary font-bold px-4 py-1.5 transition-all uppercase tracking-widest"
            >
              <Plus size={14} />
              NEW TRADE
            </button>
          )}
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-accent transition-colors" size={14} />
            <input 
              type="text" 
              placeholder="SEARCH BY TICKER..." 
              className="bg-bg-secondary border border-border pl-9 pr-4 py-1.5 text-[11px] font-mono focus:outline-none focus:border-accent w-64 transition-all uppercase tracking-widest placeholder:opacity-30"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Summary Metrics (Execution Specific) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
        {[
          { label: "RPNL", value: `$${totalRealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, status: totalRealizedPnl >= 0 ? "success" : "danger", icon: TrendingUp },
          { label: "EXECUTIONS", value: trades.length.toString(), status: "neutral", icon: Activity },
          { label: "TURNOVER", value: `$${trades.reduce((sum, t) => sum + t.notional, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, status: "neutral", icon: PieChart },
        ].map((stat, i) => (
          <div key={i} className="bg-bg-secondary p-4 border border-border group relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-border group-hover:bg-accent transition-colors" />
            <div className="flex items-center justify-between mb-2">
               <p className="text-[9px] text-text-secondary uppercase tracking-[0.15em] font-bold text-left">{stat.label}</p>
               <stat.icon size={12} className="text-text-secondary group-hover:text-accent transition-colors" />
            </div>
            <h2 className={cn(
              "text-xl font-mono font-bold tracking-tighter tabular-nums",
              stat.status === "success" ? "text-success" : (stat.status === "danger" ? "text-danger" : "text-text-primary")
            )}>
              {stat.value}
            </h2>
          </div>
        ))}
      </div>

      {/* Trade History */}
      <div className="bg-bg-secondary border border-border overflow-hidden">
        <div className="bg-surface px-4 py-2 border-b border-border flex justify-between items-center text-left">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-primary">HISTORY</h3>
            <span className="text-[9px] font-mono text-text-secondary uppercase">ENTRIES: {filteredTrades.length}</span>
        </div>
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bg-primary/30 text-left">
                <th className="py-3 px-4 text-[9px] text-text-secondary uppercase tracking-widest font-bold">DATE</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold">TICKER / SIDE</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">UNITS</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">MARK</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">BASIS</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">RPNL</th>
                <th className="py-3 px-4 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-center w-10">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-left">
              {filteredTrades.map((trade) => (
                <tr key={trade.id} className="hover:bg-accent/5 transition-colors group cursor-default">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                       <div className="text-text-secondary group-hover:text-accent transition-colors"><Activity size={14} /></div>
                       <div>
                          <p className="text-xs font-mono font-bold tracking-tighter text-text-primary uppercase">{new Date(trade.date).toLocaleDateString([], {month: 'short', day: '2-digit', year: 'numeric'})}</p>
                          <p className="text-[9px] text-text-secondary uppercase tracking-widest font-medium opacity-50">{trade.id.slice(0, 8)}</p>
                       </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-left">
                    <div className="flex items-center gap-3 text-left">
                      <div className={cn(
                        "w-7 h-7 flex items-center justify-center text-[10px] font-bold border rounded-none transition-colors",
                        trade.side === 'buy' ? "bg-success/10 text-success border-success/30" : "bg-danger/10 text-danger border-danger/30"
                      )}>
                        {trade.side === 'buy' ? "B" : "S"}
                      </div>
                      <div className="text-left border-none">
                        <p className="text-xs font-bold text-text-primary tracking-tight group-hover:text-accent transition-colors uppercase font-mono">{trade.ticker}</p>
                        <p className={cn(
                          "text-[9px] uppercase tracking-widest font-bold",
                          trade.side === 'buy' ? "text-success" : "text-danger"
                        )}>{trade.side}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-xs tabular-nums text-text-primary border-none">
                    {trade.amount ? trade.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "-"}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-xs tabular-nums text-text-secondary border-none">
                    ${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-xs tabular-nums font-bold border-none">
                    ${trade.notional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right border-none">
                    <div className="flex items-center justify-end gap-3">
                      <div className="text-right">
                        <div className={cn(
                          "font-mono text-xs tabular-nums font-bold",
                          trade.realizedPnL > 0 ? "text-success" : (trade.realizedPnL < 0 ? "text-danger" : "text-text-secondary")
                        )}>
                          {trade.realizedPnL !== 0 ? (trade.realizedPnL > 0 ? "+" : "") + `$${trade.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "-"}
                        </div>
                        {trade.notes && (
                          <p className="text-[8px] text-text-secondary uppercase italic tracking-widest truncate max-w-[150px] ml-auto text-right" title={trade.notes}>
                            "{trade.notes}"
                          </p>
                        )}
                      </div>
                      {userRole === 'PM' && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteTrade(trade); }}
                          disabled={isSaving}
                          className={cn(
                            "p-1.5 text-text-secondary hover:text-danger hover:bg-danger/10 transition-all",
                            isSaving && "cursor-not-allowed animate-pulse"
                          )}
                          title="VOID ORDER"
                        >
                          <Trash2 size={14} className={cn(isSaving ? "opacity-50" : "opacity-70 grupo-hover:opacity-100")} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTrades.length === 0 && (
                <tr className="bg-bg-primary/20 text-center border-none">
                  <td colSpan={6} className="py-20 text-center border-none">
                     <p className="text-[10px] text-text-secondary uppercase tracking-[0.3em] font-bold italic animate-pulse text-center px-10">NO ORDERS RECORDED FOR THE SPECIFIED PARAMETERS</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Trade Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-bg-primary/90 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="bg-surface px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat size={14} className="text-accent" />
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">EXECUTE MARKET ORDER</h3>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleAddTrade} className="p-8 space-y-6">
              <div className="space-y-4 text-left">
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[9px] font-bold text-text-secondary uppercase tracking-[0.2em] text-left">Ticker</label>
                    {isValidating && (
                       <div className="flex items-center gap-1.5 animate-pulse">
                          <RefreshCw size={10} className="animate-spin text-accent" />
                          <span className="text-[8px] font-bold text-accent uppercase font-mono">SEARCHING...</span>
                       </div>
                    )}
                    {currentPrice && !isValidating && (
                       <div className="flex items-center gap-1.5 text-success animate-in fade-in slide-in-from-right-1">
                          <QuoteIcon size={10} />
                          <span className="text-[8px] font-bold uppercase font-mono">MARK: ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                       </div>
                    )}
                  </div>
                  <input 
                    type="text"
                    required
                    autoComplete="off"
                    placeholder="AAPL, BTC, etc."
                    className="w-full bg-bg-primary border border-border px-4 py-2 text-xs font-mono focus:outline-none focus:border-accent transition-all uppercase tracking-widest placeholder:opacity-30"
                    value={newTrade.ticker}
                    onChange={(e) => {
                      setNewTrade({...newTrade, ticker: e.target.value});
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  />
                  
                  {/* Custom Suggestions Dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-bg-secondary border border-border shadow-2xl max-h-48 overflow-y-auto">
                       {suggestions.map((s) => (
                         <button
                           key={s.symbol}
                           type="button"
                           onClick={() => {
                             setNewTrade({...newTrade, ticker: s.symbol});
                             setShowSuggestions(false);
                           }}
                           className="w-full px-4 py-2 text-left hover:bg-accent/10 flex items-center justify-between border-b border-border/50 last:border-0 group"
                         >
                           <div className="flex items-center gap-3">
                              <span className="text-[10px] font-mono font-bold text-text-primary group-hover:text-accent transition-colors">{s.symbol}</span>
                              <span className="text-[8px] text-text-secondary uppercase truncate max-w-[150px]">{s.description}</span>
                           </div>
                           <ChevronRight size={10} className="text-text-secondary group-hover:text-accent transition-all" />
                         </button>
                       ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold text-text-secondary uppercase tracking-[0.2em] mb-2 text-left">Order Side</label>
                    <div className="flex border border-border overflow-hidden">
                      <button 
                        type="button"
                        onClick={() => setNewTrade({...newTrade, side: 'buy'})}
                        className={cn(
                          "flex-1 py-2 text-[9px] font-bold transition-all uppercase tracking-widest",
                          newTrade.side === 'buy' ? "bg-success text-bg-primary" : "bg-bg-primary text-text-secondary hover:text-text-primary"
                        )}
                      >
                        BUY
                      </button>
                      <button 
                        type="button"
                        onClick={() => setNewTrade({...newTrade, side: 'sell'})}
                        className={cn(
                          "flex-1 py-2 text-[9px] font-bold transition-all uppercase tracking-widest",
                          newTrade.side === 'sell' ? "bg-danger text-bg-primary" : "bg-bg-primary text-text-secondary hover:text-text-primary"
                        )}
                      >
                        SELL
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-text-secondary uppercase tracking-[0.2em] mb-2 text-left">Cash Amount (Notional $)</label>
                    <input 
                      type="number"
                      required
                      placeholder="0.00"
                      className="w-full bg-bg-primary border border-border px-4 py-2 text-xs font-mono focus:outline-none focus:border-accent transition-all uppercase tracking-widest"
                      value={newTrade.notional || ""}
                      onChange={(e) => setNewTrade({...newTrade, notional: parseFloat(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold text-text-secondary uppercase tracking-[0.2em] mb-2 text-left">Quantity (Shares)</label>
                    <input 
                      type="number"
                      required
                      step="0.0001"
                      placeholder="0.00"
                      className="w-full bg-bg-primary border border-border px-4 py-2 text-xs font-mono focus:outline-none focus:border-accent transition-all uppercase tracking-widest"
                      value={newTrade.amount || ""}
                      onChange={(e) => setNewTrade({...newTrade, amount: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-text-secondary uppercase tracking-[0.2em] mb-2 text-left">Trade Date</label>
                    <input 
                      type="date"
                      required
                      className="w-full bg-bg-primary border border-border px-4 py-2 text-xs font-mono focus:outline-none focus:border-accent transition-all uppercase tracking-widest"
                      value={newTrade.date}
                      onChange={(e) => setNewTrade({...newTrade, date: e.target.value})}
                    />
                  </div>
                </div>

                <div className="mt-2 text-[10px] font-mono text-text-secondary flex justify-between uppercase">
                  <span>Price (Implied):</span>
                  <span className="text-accent">${(newTrade.amount > 0 ? newTrade.notional / newTrade.amount : 0).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-text-secondary uppercase tracking-[0.2em] mb-2 text-left">Execution Notes (Optional)</label>
                  <textarea 
                    placeholder="ENTER ORDER SPECIFICS..."
                    className="w-full bg-bg-primary border border-border px-4 py-2 text-xs font-mono focus:outline-none focus:border-accent transition-all uppercase tracking-widest min-h-[80px]"
                    value={newTrade.notes}
                    onChange={(e) => setNewTrade({...newTrade, notes: e.target.value})}
                  />
                </div>
              </div>

              <button 
                type="submit" 
                disabled={isSaving || isTradeBlocked}
                className={cn(
                  "w-full font-bold px-6 py-3 transition-all flex items-center justify-center gap-2 group",
                  isTradeBlocked ? "bg-bg-primary text-text-secondary cursor-not-allowed opacity-50" : "bg-accent hover:bg-accent-hover text-bg-primary"
                )}
              >
                {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <ChevronRight size={16} className={cn(!isTradeBlocked && "group-hover:translate-x-1 transition-transform")} />}
                <span className="text-[11px] uppercase tracking-[0.3em] font-black">
                  {isSaving ? "EXECUTING..." : "EXECUTE"}
                </span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
