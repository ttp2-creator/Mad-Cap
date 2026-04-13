import React from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell 
} from "recharts";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, RefreshCw, Database, Layers, Activity } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Asset, Fund, Investor, LedgerEntry, FundSnapshot } from "@/src/types";
import { doc, updateDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/src/firebase";
import { fetchStockQuote, fetchCompanyProfile } from "@/src/lib/finnhub";

interface DashboardProps {
  fund?: Fund;
  investors: Investor[];
  assets: Asset[];
  ledger: LedgerEntry[];
  snapshots: FundSnapshot[];
  userRole: 'PM' | 'Analyst' | 'Public';
}

export default function Dashboard({ fund, investors, assets, ledger, snapshots, userRole }: DashboardProps) {
  const isAnalystOrAbove = userRole === 'PM' || userRole === 'Analyst';
  if (!fund) return <div className="p-10 text-center text-text-secondary animate-pulse uppercase tracking-widest text-xs">LOADING...</div>;

  const isPublic = userRole === 'Public';
  const totalAssetMarketValue = assets.reduce((sum, asset) => sum + (asset.amount * asset.price), 0);
  const totalValue = totalAssetMarketValue + fund.cashBalance;
  const calculatedNav = fund.totalUnits > 0 ? totalValue / fund.totalUnits : 10;
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [tickerLogos, setTickerLogos] = React.useState<Record<string, string>>({});
  
  const [spyData, setSpyData] = React.useState<{date: string, timestamp: number, value: number}[]>([]);
  const [compareEnabled, setCompareEnabled] = React.useState(false);
  const [timeHorizon, setTimeHorizon] = React.useState('ALL');

  React.useEffect(() => {
    // Fetch SPY historical data for comparison
    const fetchSPY = async () => {
      try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=2y`);
        const data = await res.json();
        const timestamps = data.chart.result[0].timestamp;
        const closes = data.chart.result[0].indicators.quote[0].close;
        const history = timestamps.map((t: number, i: number) => ({
          date: new Date(t * 1000).toLocaleDateString([], { month: 'short', day: '2-digit' }),
          timestamp: t * 1000,
          value: closes[i]
        })).filter((x: any) => x.value !== null);
        setSpyData(history);
      } catch (e) {
        console.error("Failed to fetch SPY benchmark", e);
      }
    };
    fetchSPY();
  }, []);

  // Fetch logos
  React.useEffect(() => {
    const fetchLogos = async () => {
      const logos: Record<string, string> = {};
      for (const asset of assets) {
        if (asset.ticker && !tickerLogos[asset.ticker]) {
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

  const handleRevalue = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      let updatedTotalAssetValue = 0;
      
      // 1. Fetch fresh quotes for all assets
      for (const asset of assets) {
        if (asset.ticker && asset.ticker !== 'CASH') {
          const quote = await fetchStockQuote(asset.ticker);
          if (quote) {
            const assetRef = doc(db, "assets", asset.id);
            await updateDoc(assetRef, { 
              price: quote.price, 
              updatedAt: Date.now() 
            });
            updatedTotalAssetValue += (asset.amount * quote.price);
          } else {
            updatedTotalAssetValue += (asset.amount * asset.price);
          }
        }
      }

      const newTotalValue = updatedTotalAssetValue + fund.cashBalance;
      const newNav = fund.totalUnits > 0 ? newTotalValue / fund.totalUnits : 10;

      // 2. Update Fund
      await updateDoc(doc(db, "funds", fund.id), { 
        totalAum: newTotalValue, 
        navPerUnit: newNav, 
        updatedAt: Date.now() 
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "funds");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Real Performance Data from Snapshots
  const performanceData = React.useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];

    let startDate = 0;
    const now = Date.now();
    if (timeHorizon === '1M') startDate = now - 30 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === '3M') startDate = now - 90 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === '6M') startDate = now - 180 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === 'YTD') startDate = new Date(new Date().getFullYear(), 0, 1).getTime();

    const sortedSnapshots = [...snapshots].sort((a, b) => a.date - b.date);

    if (timeHorizon === 'ALL' || !startDate) {
      startDate = sortedSnapshots[0].date;
    }

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    let startOfDay = new Date(startDate).setHours(0,0,0,0);
    const endOfDay = new Date(now).setHours(0,0,0,0);
    
    // Fallback if the selected timeframe has no snapshots at all
    const entriesInTimeframe = sortedSnapshots.filter(e => e.date >= startOfDay);
    if (entriesInTimeframe.length === 0 && sortedSnapshots.length > 0) {
       startOfDay = new Date(sortedSnapshots[sortedSnapshots.length - 1].date).setHours(0,0,0,0);
    }

    const dataPoints = [];
    let currentNav = sortedSnapshots[0]?.navPerUnit || 10;
    
    let lastSpy = 0;
    const baseSpyItem = [...spyData].reverse().find(s => s.timestamp <= startOfDay) || spyData[0];
    const baseSpy = baseSpyItem ? baseSpyItem.value : 0;
    lastSpy = baseSpy;

    let snapIdx = 0;
    for (let t = startOfDay; t <= endOfDay; t += MS_PER_DAY) {
       while(snapIdx < sortedSnapshots.length && sortedSnapshots[snapIdx].date <= t + MS_PER_DAY - 1) {
          currentNav = sortedSnapshots[snapIdx].navPerUnit;
          snapIdx++;
       }

       const daySpy = spyData.find(s => {
          const sDate = new Date(s.timestamp).setHours(0,0,0,0);
          return sDate === t;
       });
       if (daySpy) {
          lastSpy = daySpy.value;
       }

       let spyVal = undefined;
       const bn = dataPoints.length > 0 ? dataPoints[0].value : currentNav;
       if (compareEnabled && baseSpy > 0 && lastSpy > 0) {
          const pctChange = (lastSpy - baseSpy) / baseSpy;
          spyVal = bn * (1 + pctChange);
       }

       dataPoints.push({
         name: new Date(t).toLocaleDateString([], { month: 'short', day: '2-digit' }),
         timestamp: t,
         value: Number(currentNav || 0),
         spy: spyVal
       });
    }

    return dataPoints;
  }, [snapshots, timeHorizon, spyData, compareEnabled]);

  const previousSnapshot = React.useMemo(() => {
     if (!snapshots || snapshots.length === 0) return null;
     const sorted = [...snapshots].sort((a, b) => b.date - a.date);
     const todayStr = new Date().toLocaleDateString();
     return sorted.find(e => new Date(e.date).toLocaleDateString() !== todayStr) || sorted[0];
  }, [snapshots]);

  const yesterdayNav = previousSnapshot ? previousSnapshot.navPerUnit : calculatedNav;
  const yesterdayAUM = previousSnapshot ? previousSnapshot.totalAum : totalValue;
  
  const dailyPnlDollar = (calculatedNav - yesterdayNav) * (fund.totalUnits || 0);
  const dailyPnlPercent = yesterdayNav > 0 ? ((calculatedNav - yesterdayNav) / yesterdayNav) * 100 : 0;
  
  const aumPercent = yesterdayAUM > 0 ? ((totalValue - yesterdayAUM) / yesterdayAUM) * 100 : 0;

  // Individual Equities Allocation
  const assetAllocation = React.useMemo(() => {
    const COLORS = [
      "var(--color-accent)", "#6366f1", "#8b5cf6", "#ec4899", 
      "#f97316", "#eab308", "#10b981", "#06b6d4"
    ];
    
    const equityItems = assets
      .filter(a => a.ticker !== 'CASH' && a.amount > 0)
      .map((a, i) => ({
        name: a.ticker,
        value: a.amount * a.price,
        color: COLORS[i % COLORS.length]
      }));
    
    if (fund.cashBalance > 0) {
      equityItems.push({
        name: "CASH",
        value: fund.cashBalance,
        color: "#10b981"
      });
    }
    
    return equityItems.sort((a, b) => b.value - a.value);
  }, [assets, fund.cashBalance]);

  const topPositions = assets
    .filter(a => a.ticker !== 'CASH' && a.amount > 0)
    .sort((a, b) => (b.amount * b.price) - (a.amount * a.price))
    .slice(0, 6);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Revised Institutional Header */}
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div className="text-left">
          <h2 className="text-xl font-bold tracking-tight text-text-primary mb-1 uppercase">DASHBOARD</h2>
          <p className="text-[10px] text-text-secondary uppercase tracking-[0.2em] font-medium">MAD CAPITAL | RECONCILED</p>
        </div>
        <div className="flex gap-2">
          {userRole === 'PM' && (
            <button 
              onClick={handleRevalue}
              title="EXECUTE GLOBAL REVALUATION"
              className="flex items-center justify-center bg-surface hover:bg-surface/80 border border-border w-8 h-8 transition-all text-text-primary uppercase tracking-widest shrink-0 shadow-inner"
            >
              <RefreshCw size={14} className={cn(isRefreshing && "animate-spin")} />
            </button>
          )}
        </div>
      </div>

      {/* High-Density Stats Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "AUM", value: `$${(totalValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, change: `${aumPercent >= 0 ? '+' : ''}${aumPercent.toFixed(2)}%`, status: aumPercent >= 0 ? "success" : "danger" },
          { label: "NAV", value: `$${(Number(calculatedNav) || 0).toFixed(4)}`, change: `${dailyPnlPercent >= 0 ? '+' : ''}${dailyPnlPercent.toFixed(2)}%`, status: dailyPnlPercent >= 0 ? "success" : "danger" },
          { label: "DAILY P&L", value: `${dailyPnlDollar >= 0 ? '+' : ''}$${Math.abs(dailyPnlDollar).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, change: `${dailyPnlPercent >= 0 ? '+' : ''}${dailyPnlPercent.toFixed(2)}%`, status: dailyPnlPercent >= 0 ? "success" : "danger" },
          { label: "BUYING POWER", value: `$${(fund.cashBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, change: "---", status: "neutral" },
        ].map((stat, i) => (
          <div key={i} className="bg-bg-secondary p-4 border border-border relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-1 h-full bg-border group-hover:bg-accent transition-colors" />
            <p className="text-[9px] text-text-secondary uppercase tracking-[0.15em] mb-2 font-bold text-left">{stat.label}</p>
            <div className="flex items-end justify-between">
              <h2 className="text-xl font-mono font-bold leading-none tracking-tight">{stat.value}</h2>
              <span className={cn(
                "text-[10px] font-mono px-1",
                stat.status === "success" ? "text-success" : (stat.status === "danger" ? "text-danger" : "text-text-secondary")
              )}>
                {stat.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Grid: Performance & Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Real Performance Chart */}
        <div className="lg:col-span-8 bg-bg-secondary p-5 border border-border flex flex-col">
          <div className="flex items-center justify-between mb-8 border-b border-border/50 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary flex items-center gap-2">
              <TrendingUp size={14} className="text-accent" />
              NAV PERFORMANCE (IRR)
            </h3>
            <div className="flex gap-1 items-center">
              <label className="flex items-center gap-1 mr-4 cursor-pointer text-[9px] font-mono text-text-secondary uppercase select-none">
                <input 
                  type="checkbox" 
                  checked={compareEnabled} 
                  onChange={(e) => setCompareEnabled(e.target.checked)}
                  className="accent-accent"
                />
                VS SPY
              </label>
              {["1M", "3M", "6M", "YTD", "ALL"].map((p) => (
                <button 
                  key={p} 
                  onClick={() => setTimeHorizon(p)}
                  className={cn(
                    "text-[9px] font-mono px-2 py-0.5 border transition-all",
                    timeHorizon === p 
                      ? "border-accent text-accent bg-accent/10" 
                      : "border-border hover:border-accent/50 text-text-secondary"
                  )}
                >
                  {p}
                </button>
              ))}
              {userRole === 'PM' && (
                <button className="p-1 px-2 border border-border hover:border-accent text-text-secondary transition-all" title="SYSTEM RECALC">
                  <div className="w-1.5 h-1.5 bg-accent" />
                </button>
              )}
            </div>
          </div>
          <div className="h-[280px] w-full pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performanceData}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--color-border)" strokeOpacity={0.3} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "var(--color-text-secondary)", fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "var(--color-text-secondary)", fontWeight: 600 }} domain={['auto', 'auto']} tickFormatter={(v) => `$${v}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: "0", fontSize: "10px", fontFamily: "var(--font-mono)" }}
                  cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1 }}
                />
                <Area type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                {compareEnabled && (
                  <Line type="monotone" dataKey="spy" stroke="#10b981" strokeWidth={1} dot={false} strokeDasharray="3 3" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Allocation Column */}
        <div className="lg:col-span-4 bg-bg-secondary p-5 border border-border flex flex-col">
          <div className="flex items-center justify-between mb-8 border-b border-border/50 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary flex items-center gap-2">
              <Layers size={14} className="text-accent" />
              ALLOCATION
            </h3>
          </div>
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={assetAllocation} innerRadius={55} outerRadius={70} paddingAngle={2} dataKey="value" stroke="none">
                  {assetAllocation.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                   contentStyle={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", fontSize: "10px" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-auto space-y-2 border-t border-border pt-4 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
            {assetAllocation.map((item) => (
              <div key={item.name} className="flex items-center justify-between group">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5" style={{ backgroundColor: item.color }} />
                  <span className="text-[10px] font-bold text-text-secondary group-hover:text-text-primary transition-colors uppercase tracking-wider">{item.name}</span>
                </div>
                <div className="flex items-center gap-3">
                   <span className="text-xs font-mono font-bold">${item.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                   <span className="text-[10px] font-mono text-text-secondary w-10 text-right">
                    {((item.value / totalValue) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Equities Book (Filtered CASH) */}
      <div className="bg-bg-secondary border border-border overflow-hidden text-left">
        <div className="bg-surface px-4 py-2 border-b border-border flex justify-between items-center text-left">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-primary text-left">TOP POSITIONS</h3>
            <span className="text-[9px] font-mono text-text-secondary uppercase">SETTLED</span>
        </div>
        <div className="overflow-x-auto overflow-y-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bg-primary/30 text-left">
                <th className="py-2 px-4 text-[9px] text-text-secondary uppercase tracking-widest text-left">TICKER</th>
                <th className="py-2 px-2 text-[9px] text-text-secondary uppercase tracking-widest text-right">UNITS</th>
                <th className="py-2 px-2 text-[9px] text-text-secondary uppercase tracking-widest text-right">MARK</th>
                <th className="py-2 px-2 text-[9px] text-text-secondary uppercase tracking-widest text-right">VALUE</th>
                <th className="py-2 px-4 text-[9px] text-text-secondary uppercase tracking-widest text-right">WEIGHT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {topPositions.map((asset) => (
                <tr key={asset.id} className="hover:bg-accent/5 transition-colors group cursor-default">
                  <td className="py-2 px-4 text-left">
                    <div className="flex items-center gap-3 text-left">
                       {tickerLogos[asset.ticker] ? (
                         <img src={tickerLogos[asset.ticker]} alt={asset.ticker} className="w-4 h-4 rounded-full" />
                       ) : (
                         <div className="w-4 h-4 bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">{asset.ticker?.[0]}</div>
                       )}
                       <span className="text-xs font-bold font-mono tracking-tight group-hover:text-accent transition-colors">{asset.ticker}</span>
                       <span className="text-[10px] text-text-secondary uppercase ml-2 opacity-0 group-hover:opacity-100 transition-opacity font-medium tracking-widest truncate max-w-[150px]">{asset.name || "STOCK"}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs tabular-nums text-text-primary">{(asset.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs tabular-nums text-text-secondary">${(asset.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs tabular-nums font-bold text-text-primary">
                    ${((asset.amount || 0) * (asset.price || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                       <div className="w-16 h-1 bg-surface rounded-none overflow-hidden hidden sm:block">
                          <div className="h-full bg-accent/40" style={{ width: `${(asset.amount * asset.price / totalValue * 100)}%` }} />
                       </div>
                       <span className="text-[10px] font-mono text-text-secondary w-10 text-right">
                        {((asset.amount * asset.price / totalValue) * 100).toFixed(1)}%
                       </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
