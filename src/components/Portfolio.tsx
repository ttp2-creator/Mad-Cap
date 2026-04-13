import React from "react";
import { 
  Briefcase, TrendingUp, TrendingDown, 
  DollarSign, BarChart3, Search, 
  ArrowUpRight, ArrowDownRight, Activity,
  RefreshCw, Plus, X, ChevronRight, Repeat,
  AlertCircle, Activity as QuoteIcon
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Asset, Fund, Trade } from "@/src/types";
import { fetchCompanyProfile, fetchStockQuote, searchStocks } from "@/src/lib/finnhub";
import { doc, updateDoc, collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType } from "@/src/firebase";

interface PortfolioProps {
  fund?: Fund;
  assets: Asset[];
  userRole: 'PM' | 'Analyst' | 'Public';
}

export default function Portfolio({ fund, assets, userRole }: PortfolioProps) {
  const isAnalystOrAbove = userRole === 'PM' || userRole === 'Analyst';
  const [searchTerm, setSearchTerm] = React.useState("");
  const [tickerLogos, setTickerLogos] = React.useState<Record<string, string>>({});
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  
  // Trade Modal State
  const [showTradeModal, setShowTradeModal] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
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

        // 2. Fetch quote if it looks like a ticker
        const cleanTicker = newTrade.ticker.trim().toUpperCase();
        if (cleanTicker.length >= 1 && !cleanTicker.includes(" ")) {
          const quote = await fetchStockQuote(cleanTicker);
          if (quote && quote.price > 0) {
            setCurrentPrice(quote.price);
            setTickerError(null);
          } else {
            setCurrentPrice(null);
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

  const totalMarketValue = assets.reduce((sum, asset) => sum + (asset.amount * asset.price), 0);
  const totalCostBasis = assets.reduce((sum, asset) => sum + asset.costBasis, 0);
  const totalPnL = totalMarketValue - totalCostBasis;
  const pnlPercent = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0;

  // Fetch logos
  React.useEffect(() => {
    const fetchLogos = async () => {
      const logos: Record<string, string> = {};
      for (const asset of assets) {
        if (asset.ticker && asset.ticker !== 'CASH' && !tickerLogos[asset.ticker]) {
          const profile = await fetchCompanyProfile(asset.ticker);
          if (profile?.logo) logos[asset.ticker] = profile.logo;
        }
      }
      if (Object.keys(logos).length > 0) {
        setTickerLogos(prev => ({ ...prev, ...logos }));
      }
    };
    fetchLogos();
  }, [assets]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      for (const asset of assets) {
        if (asset.ticker && asset.ticker !== 'CASH') {
          const quote = await fetchStockQuote(asset.ticker);
          if (quote) {
            await updateDoc(doc(db, "assets", asset.id), {
              price: quote.price,
              updatedAt: Date.now()
            });
          }
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "assets");
    } finally {
      setIsRefreshing(false);
    }
  };

  const openTradeModal = (ticker: string, side: "buy" | "sell") => {
    const asset = assets.find(a => a.ticker === ticker);
    setNewTrade({
      ticker,
      side,
      amount: 0,
      notional: 0,
      date: new Date().toISOString().split('T')[0],
      notes: ""
    });
    setShowTradeModal(true);
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

      // 3. Update Fund Cash Balance
      await updateDoc(doc(db, "funds", fund.id), {
        cashBalance: fund.cashBalance - cashImpact,
        updatedAt: Date.now()
      });

      // 4. Reset & Close
      setNewTrade({
        ticker: "",
        side: "buy",
        amount: 0,
        notional: 0,
        date: new Date().toISOString().split('T')[0],
        notes: ""
      });
      setShowTradeModal(false);
      window.alert(`✅ ${newTrade.side.toUpperCase()} ORDER EXECUTED (PORTFOLIO): ${ticker}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "trades");
      window.alert("❌ EXECUTION FAILED: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsSaving(false);
    }
  };

  const isTradeBlocked = !newTrade.ticker || isValidating;

  const filteredAssets = assets.filter(asset => 
    asset.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
    asset.name.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => (b.amount * b.price) - (a.amount * a.price));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Portfolio Header */}
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div className="text-left">
          <h2 className="text-xl font-bold tracking-tight text-text-primary mb-1 uppercase text-left">PORTFOLIO</h2>
          <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] font-medium text-left">VALUATION</p>
        </div>
        <div className="flex items-center gap-3">
          {userRole === 'PM' && (
            <button 
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 text-[10px] font-bold bg-surface hover:bg-surface/80 border border-border px-3 py-1.5 transition-all text-text-primary uppercase tracking-widest min-w-[32px]"
            >
              <RefreshCw size={12} className={cn(isRefreshing && "animate-spin")} />
              {!isRefreshing && "REFRESH MARKET DATA"}
            </button>
          )}
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-accent transition-colors" size={14} />
            <input 
              type="text" 
              placeholder="FILTER BY TICKER..." 
              className="bg-bg-secondary border border-border pl-9 pr-4 py-1.5 text-[11px] font-mono focus:outline-none focus:border-accent w-64 transition-all uppercase tracking-widest placeholder:opacity-30"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-left">
        {[
          { label: "EXPOSURE", value: `$${totalMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: Briefcase },
          { label: "UPNL", value: `$${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: `${pnlPercent.toFixed(2)}%`, trend: totalPnL >= 0 ? 'up' : 'down' },
          { label: "BASIS", value: `$${totalCostBasis.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign },
          { label: "POSITIONS", value: assets.length.toString(), icon: BarChart3 },
        ].map((stat, i) => (
          <div key={i} className="bg-bg-secondary p-4 border border-border group relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-border group-hover:bg-accent transition-colors" />
            <div className="flex items-center justify-between mb-2">
               <p className="text-[9px] text-text-secondary uppercase tracking-[0.15em] font-bold text-left">{stat.label}</p>
               {stat.icon && <stat.icon size={12} className="text-text-secondary group-hover:text-accent transition-colors text-left" />}
            </div>
            <div className="flex items-center justify-between text-left">
              <h2 className="text-xl font-mono font-bold tracking-tighter tabular-nums text-left">{stat.value}</h2>
              {stat.sub && (
                <div className={cn(
                  "flex items-center gap-0.5 text-[10px] font-mono font-bold text-left",
                  stat.trend === 'up' ? "text-success" : "text-danger"
                )}>
                  {stat.trend === 'up' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                  {stat.sub}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Main Asset Table */}
      <div className="bg-bg-secondary border border-border overflow-hidden text-left">
        <div className="bg-surface px-4 py-2 border-b border-border flex justify-between items-center text-left">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-primary text-left">POSITIONS</h3>
            <span className="text-[9px] font-mono text-text-secondary uppercase">SETTLED</span>
        </div>
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bg-primary/30 text-left">
                <th className="py-3 px-4 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-left">TICKER</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">UNITS</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right" title="BASIS ($)">BASIS</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">MARK</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">VALUE</th>
                <th className="py-3 px-2 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">UPNL (%)</th>
                {userRole === 'PM' && <th className="py-3 px-4 text-[9px] text-text-secondary uppercase tracking-widest font-bold text-right">ACTIONS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-left">
              {filteredAssets.map((asset) => {
                const marketVal = asset.amount * asset.price;
                const assetPnl = marketVal - asset.costBasis;
                const assetPnlPct = asset.costBasis > 0 ? (assetPnl / asset.costBasis) * 100 : 0;
                
                return (
                  <tr key={asset.id} className="hover:bg-accent/5 transition-colors group cursor-default text-left">
                    <td className="py-3 px-4 text-left">
                      <div className="flex items-center gap-3 text-left">
                        {tickerLogos[asset.ticker] ? (
                          <img src={tickerLogos[asset.ticker]} alt={asset.ticker} className="w-6 h-6 rounded-none grayscale group-hover:grayscale-0 transition-all border border-border/50 p-0.5 bg-white" />
                        ) : (
                          <div className="w-6 h-6 bg-surface border border-border flex items-center justify-center text-[10px] font-bold text-text-secondary font-mono">{asset.ticker?.[0]}</div>
                        )}
                        <div className="text-left border-none">
                          <p className="text-xs font-bold font-mono tracking-tight text-text-primary group-hover:text-accent transition-colors">{asset.ticker}</p>
                          <p className="text-[8px] text-text-secondary uppercase tracking-widest font-medium overflow-hidden truncate max-w-[120px]">{asset.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs tabular-nums text-text-primary border-none">
                      {asset.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs tabular-nums text-text-secondary border-none">
                      ${asset.costBasis.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs tabular-nums group-hover:text-text-primary transition-colors border-none">
                      <div className="flex items-center justify-end gap-2 text-left">
                        <span className="text-emerald-400/80"><Activity size={10} /></span>
                        ${asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs tabular-nums font-bold text-text-primary border-none">
                      ${marketVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-2 text-right border-none">
                      <div className={cn(
                        "inline-flex flex-col items-end min-w-16 font-mono text-[10px] text-left",
                        assetPnl >= 0 ? "text-success" : "text-danger"
                      )}>
                        <div className="flex items-center gap-1 font-bold text-left">
                          {assetPnl >= 0 ? "+" : ""}${assetPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        <div className="opacity-70 text-[9px] font-medium leading-none text-left">
                          {assetPnl >= 0 ? "+" : ""}{assetPnlPct.toFixed(1)}%
                        </div>
                      </div>
                    </td>
                    {userRole === 'PM' && (
                      <td className="py-3 px-4 text-right border-none">
                        <div className="flex items-center justify-end gap-1.5 text-left">
                          <button 
                            onClick={(e) => { e.stopPropagation(); openTradeModal(asset.ticker, 'buy'); }}
                            className="w-6 h-6 flex items-center justify-center bg-success/10 hover:bg-success text-success hover:text-bg-primary text-[10px] font-bold border border-success/30 transition-all font-mono"
                            title="BUY MORE"
                          >
                            B
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); openTradeModal(asset.ticker, 'sell'); }}
                            className="w-6 h-6 flex items-center justify-center bg-danger/10 hover:bg-danger text-danger hover:text-bg-primary text-[10px] font-bold border border-danger/30 transition-all font-mono"
                            title="SELL POSITION"
                          >
                            S
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredAssets.length === 0 && (
                <tr className="bg-bg-primary/20 text-center text-left">
                  <td colSpan={7} className="py-16 text-center text-[10px] text-text-secondary uppercase tracking-[0.2em] font-bold italic animate-pulse px-10 text-center">
                    SEARCH PROTOCOL RETURNED ZERO MATCHES FOR SPECIFIED QUERY
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Local Trade Modal */}
      {showTradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-bg-primary/90 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="bg-surface px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat size={14} className="text-accent" />
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary uppercase">{newTrade.side} {newTrade.ticker}</h3>
              </div>
              <button 
                onClick={() => setShowTradeModal(false)}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleAddTrade} className="p-8 space-y-6">
              <div className="space-y-4 text-left">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 relative">
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
                      placeholder="TICKER..."
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
