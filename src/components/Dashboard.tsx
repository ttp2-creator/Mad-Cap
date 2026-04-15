import React from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell, ReferenceLine 
} from "recharts";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, RefreshCw, Database, Layers, Activity } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Asset, Fund, Investor, LedgerEntry, FundSnapshot, Trade } from "@/src/types";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/src/firebase";
import { StockQuote, fetchStockQuote, fetchCompanyProfile } from "@/src/lib/finnhub";
import { fetchBenchmarkData } from "@/src/lib/yahoo";
import { DashboardCard } from "./DashboardCard";
import { AllocationDonuts } from "./AllocationDonuts";
import { HoldingsTable } from "./HoldingsTable";
import { PortfolioMovers } from "./PortfolioMovers";
import { formatCurrency, formatCompact, formatPrice } from "../lib/NumberUtils";
import { ProjectedIncome } from "./ProjectedIncome";
import { InvestmentThemes } from "./InvestmentThemes";

interface DashboardProps {
  fund?: Fund;
  investors: Investor[];
  assets: Asset[];
  ledger: LedgerEntry[];
  trades?: Trade[];
  snapshots: FundSnapshot[];
  userRole: 'PM' | 'Analyst' | 'Public';
}

const CustomTooltip = ({ active, payload, label, benchmarkTicker, chartView }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isPerf = chartView === 'performance';
    
    return (
      <div className="bg-white border border-border p-3 rounded-lg shadow-xl text-[10px] min-w-[150px] animate-in fade-in zoom-in-95 duration-200">
        <p className="font-bold text-text-primary mb-2 pb-1 border-b border-border">{label}</p>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center gap-4">
            <span className="text-text-secondary font-medium uppercase tracking-tighter">Fund</span> 
            <span className="font-bold text-text-primary tabular-nums">
              {isPerf 
                ? `${(data.cumReturn >= 0 ? '+' : '')}${data.cumReturn.toFixed(2)}%`
                : `$${Number(data.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            </span>
          </div>
          
          {data.spy !== undefined && (
            <div className="flex justify-between items-center gap-4 pt-1.5 border-t border-border/50">
              <span className="text-purple-600 font-medium uppercase tracking-tighter">{benchmarkTicker}</span>
              <span className="font-bold text-purple-700 tabular-nums">
                {isPerf
                  ? `${(data.spy >= 0 ? '+' : '')}${Number(data.spy).toFixed(2)}%`
                  : `$${Number(data.spy).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                }
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export default function Dashboard({ fund, investors, assets, ledger, trades = [], snapshots, userRole }: DashboardProps) {
  const isAnalystOrAbove = userRole === 'PM' || userRole === 'Analyst';
  if (!fund) return <div className="p-10 text-center text-text-secondary animate-pulse uppercase tracking-widest text-xs">LOADING...</div>;

  const isPublic = userRole === 'Public';
  
  // Enrich assets for DEMO if data is missing
  const enrichedAssets = React.useMemo(() => {
    return assets.map(asset => {
      const a = { ...asset };
      if (!a.dividendYield) {
        if (["SPY", "IVV", "VOO"].includes(a.ticker)) { a.dividendYield = 0.013; a.dividendMonths = [2, 5, 8, 11]; }
        if (["SCHD", "VYM"].includes(a.ticker)) { a.dividendYield = 0.035; a.dividendMonths = [2, 5, 8, 11]; }
        if (["AAPL", "MSFT"].includes(a.ticker)) { a.dividendYield = 0.006; a.dividendMonths = [1, 4, 7, 10]; }
        if (["JPM", "BAC"].includes(a.ticker)) { a.dividendYield = 0.025; a.dividendMonths = [0, 3, 6, 9]; }
      }
      if (!a.themes || a.themes.length === 0) {
        if (["AAPL", "MSFT", "NVDA"].includes(a.ticker)) a.themes = ["MegaCap Tech", "AI Infrastructure"];
        if (["SPY", "VTI"].includes(a.ticker)) a.themes = ["Broad Market", "Value Investing"];
        if (["GLD", "SLV"].includes(a.ticker)) a.themes = ["Gold/Commodities", "Inflation Hedge"];
        if (["TSLA"].includes(a.ticker)) a.themes = ["EV/Growth", "Automation"];
      }
      return a;
    });
  }, [assets]);

  const totalAssetMarketValue = enrichedAssets.reduce((sum, asset) => sum + (asset.amount * asset.price), 0);
  const totalValue = totalAssetMarketValue + fund.cashBalance;
  const calculatedNav = fund.totalUnits > 0 ? totalValue / fund.totalUnits : 10;
  
  const unrealizedPnL = assets.reduce((sum, asset) => sum + ((asset.amount * (asset.price || 0)) - (asset.costBasis || 0)), 0);
  const realizedPnL = trades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [tickerLogos, setTickerLogos] = React.useState<Record<string, string>>({});
  const [tickerNames, setTickerNames] = React.useState<Record<string, string>>({});
  const [stockQuotes, setStockQuotes] = React.useState<Record<string, StockQuote>>({});
  
  const [spyData, setSpyData] = React.useState<{date: string, timestamp: number, value: number}[]>([]);
  const [compareEnabled, setCompareEnabled] = React.useState(false);
  const [benchmarkTicker, setBenchmarkTicker] = React.useState("SPY");
  const [timeHorizon, setTimeHorizon] = React.useState('1M');
  const [chartView, setChartView] = React.useState<'performance' | 'value'>('performance');
  const [calcMethod, setCalcMethod] = React.useState<'TWR'|'MWR'>('TWR');
  const activeAssets = React.useMemo(() => assets.filter(a => a.ticker !== 'CASH' && a.amount > 0.000001), [assets]);

  React.useEffect(() => {
    const loadBenchmark = async () => {
      const history = await fetchBenchmarkData(benchmarkTicker, '2y');
      setSpyData(history);
    };
    if (benchmarkTicker && compareEnabled) {
      loadBenchmark();
    }
  }, [benchmarkTicker, compareEnabled]);

  React.useEffect(() => {
    let active = true;
    const fetchLogosQuotes = async () => {
      const logos: Record<string, string> = {};
      const names: Record<string, string> = {};
      const quotes: Record<string, StockQuote> = {};
      
      const settledAssets = assets.filter(a => a.ticker !== 'CASH' && a.amount > 0);
      
      for (const asset of settledAssets) {
        if (!active) break;
        if (!tickerLogos[asset.ticker]) {
           try {
             const profile = await fetchCompanyProfile(asset.ticker);
             if (profile?.logo) logos[asset.ticker] = profile.logo;
             if (profile?.name) names[asset.ticker] = profile.name;
             
             const q = await fetchStockQuote(asset.ticker);
             if (q) quotes[asset.ticker] = q;
             
             // Throttle Finnhub requests
             await new Promise(r => setTimeout(r, 100));
           } catch(e) {}
        }
      }
      if (active) {
        if (Object.keys(logos).length > 0) setTickerLogos(prev => ({ ...prev, ...logos }));
        if (Object.keys(names).length > 0) setTickerNames(prev => ({ ...prev, ...names }));
        if (Object.keys(quotes).length > 0) setStockQuotes(prev => ({ ...prev, ...quotes }));
      }
    };
    fetchLogosQuotes();
    return () => { active = false; };
  }, [assets]);

  const handleRevalue = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      let updatedTotalAssetValue = 0;
      
      // 1. Fetch fresh quotes for all assets
      for (const asset of assets) {
        if (asset.ticker && asset.ticker !== 'CASH') {
          if (asset.amount <= 0.000001) {
             try {
                await deleteDoc(doc(db, "assets", asset.id));
             } catch(e) { console.error("Error sweeping zero asset", e); }
             continue;
          }
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
    if (!snapshots || snapshots.length === 0) return { dataPoints: [], baseNav: 10 };

    let startDate = 0;
    const now = Date.now();
    if (timeHorizon === '7D') startDate = now - 7 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === '1M') startDate = now - 30 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === '3M') startDate = now - 90 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === '6M') startDate = now - 180 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === 'YTD') startDate = new Date(new Date().getFullYear(), 0, 1).getTime();
    else if (timeHorizon === '1Y') startDate = now - 365 * 24 * 60 * 60 * 1000;
    else if (timeHorizon === 'MTD') startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

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
    const baseNav = entriesInTimeframe.length > 0 ? entriesInTimeframe[0].navPerUnit : (sortedSnapshots.length > 0 ? sortedSnapshots[sortedSnapshots.length - 1].navPerUnit : 10);

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
        let spyPercent = undefined;
        
        if (compareEnabled && baseSpy > 0 && lastSpy > 0) {
           const pctChange = (lastSpy - baseSpy) / baseSpy;
           spyPercent = pctChange * 100;
           // If we're in 'value' mode, we index SPY to the Fund's baseNav
           spyVal = baseNav * (1 + pctChange);
        }

        dataPoints.push({
          name: new Date(t).toLocaleDateString([], { month: 'short', day: '2-digit' }),
          timestamp: t,
          value: Number(currentNav || 0),
          spy: chartView === 'performance' ? spyPercent : spyVal,
          cumReturn: ((Number(currentNav || 0) - baseNav) / baseNav) * 100
        });
     }

    return { dataPoints, baseNav };
  }, [snapshots, timeHorizon, spyData, compareEnabled, benchmarkTicker]);

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

  // Advanced NAV Metrics
  const advancedNavMetrics = React.useMemo(() => {
    const data = performanceData.dataPoints;
    if (!data.length) return { bestDay: {date:'', return:0}, worstDay: {date:'', return:0}, netCapitalFlow: 0, changeAmount: 0, changePercent: 0, beginNav: 0, endNav: 0, label: "" };
    
    const beginNav = performanceData.baseNav;
    const endNav = data[data.length - 1].value;
    const changeAmount = endNav - beginNav;
    const changePercent = beginNav > 0 ? (changeAmount / beginNav) * 100 : 0;
    
    let bestDay = { date: '', return: -Infinity };
    let worstDay = { date: '', return: Infinity };
    
    // Calculate daily ranges
    let prevVal = beginNav;
    for (let i = 0; i < data.length; i++) {
       const dailyRet = prevVal > 0 ? ((data[i].value - prevVal) / prevVal) * 100 : 0;
       if (dailyRet > bestDay.return) bestDay = { date: data[i].name, return: dailyRet };
       if (dailyRet < worstDay.return) worstDay = { date: data[i].name, return: dailyRet };
       prevVal = data[i].value;
    }
    if (bestDay.return === -Infinity) bestDay.return = 0;
    if (worstDay.return === Infinity) worstDay.return = 0;
    
    // Ledger Deposits and Withdrawals for the timeframe
    const startTimeStamp = data[0].timestamp;
    const dwFlows = ledger.filter(l => l.date >= startTimeStamp && (l.type === 'deposit' || l.type === 'withdrawal'));
    const netCapitalFlow = dwFlows.reduce((sum, item) => sum + (item.type === 'deposit' ? item.amount : -item.amount), 0);
    
    const label = `${data[0].name} – ${data[data.length - 1].name}`;

    return {
       bestDay, worstDay, netCapitalFlow, changeAmount, changePercent, beginNav, endNav, label
    };
  }, [performanceData, ledger]);

  // Removed old Individual Equities Allocation logic and TopPositions logic

  return (
    <div className="flex flex-col xl:flex-row gap-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      
      {/* Primary Content Column */}
      <div className="flex-1 space-y-10 min-w-0">
        
        {/* Functional Actions Row */}
        <div className="flex justify-end border-b border-border pb-6">
           {userRole === 'PM' && (
             <button 
               onClick={handleRevalue}
               className="px-6 py-2 bg-accent text-white text-[11px] font-black hover:bg-accent-hover transition-all rounded-sm shadow-sm flex items-center gap-2 uppercase tracking-widest"
             >
               <RefreshCw size={12} className={cn(isRefreshing && "animate-spin")} />
               {isRefreshing ? 'SYNCING...' : 'SYNC ALL QUOTES'}
             </button>
           )}
        </div>

        {/* High-Density Stats Bar: Primary Focus Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { label: "AUM", value: formatCompact(totalValue), change: `${aumPercent >= 0 ? '+' : ''}${aumPercent.toFixed(2)}%`, status: aumPercent >= 0 ? "success" : "danger" },
            { label: "NAV", value: formatPrice(Number(calculatedNav)), change: `${dailyPnlPercent >= 0 ? '+' : ''}${dailyPnlPercent.toFixed(2)}%`, status: dailyPnlPercent >= 0 ? "success" : "danger" },
            { label: "Day P&L", value: `${dailyPnlDollar >= 0 ? '+' : ''}${formatCompact(Math.abs(dailyPnlDollar))}`, change: `${dailyPnlPercent >= 0 ? '+' : ''}${dailyPnlPercent.toFixed(2)}%`, status: dailyPnlPercent >= 0 ? "success" : "danger" },
          ].map((stat, i) => (
            <DashboardCard key={i} className="border-border/60 hover:shadow-md transition-shadow" bodyClassName="p-5">
              <div className="flex flex-col h-full justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2 leading-none">{stat.label}</div>
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-2xl font-black tracking-tight text-text-primary tabular-nums">{stat.value}</h2>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                   {stat.status !== "neutral" && stat.change !== "---" ? (
                      <div className={cn("text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-sm", stat.status === 'success' ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
                        {stat.change}
                      </div>
                   ) : <div className="text-[10px] text-text-muted font-medium italic">---</div>}
                </div>
              </div>
            </DashboardCard>
          ))}
        </div>

        {/* Main Grid: Performance & Advanced Panel */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Real Performance Chart */}
          <DashboardCard 
            className="md:col-span-8" 
            bodyClassName="p-0"
          >
            <div className="px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-start gap-8">
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] text-text-muted font-bold uppercase truncate tracking-tight">
                    {chartView === 'performance' ? 'Cumulative Return' : 'Net Asset Value'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-3xl font-black text-text-primary tracking-tighter">
                      {chartView === 'performance' 
                        ? `${(performanceData.dataPoints[performanceData.dataPoints.length - 1]?.cumReturn >= 0 ? '+' : '')}${performanceData.dataPoints[performanceData.dataPoints.length - 1]?.cumReturn.toFixed(2)}%`
                        : formatPrice(performanceData.dataPoints[performanceData.dataPoints.length - 1]?.value || 0)
                      }
                    </span>
                    {chartView === 'value' && (
                      <div className={cn(
                        "flex items-center font-bold text-lg",
                        (performanceData.dataPoints[performanceData.dataPoints.length - 1]?.cumReturn >= 0) ? "text-success" : "text-danger"
                      )}>
                        {performanceData.dataPoints[performanceData.dataPoints.length - 1]?.cumReturn >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                        <span>{Math.abs(performanceData.dataPoints[performanceData.dataPoints.length - 1]?.cumReturn || 0).toFixed(2)}%</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted font-bold uppercase mt-1">
                    {chartView === 'performance' ? 'Time-Weighted Returns' : 'Market Value'} ({timeHorizon})
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-0.5 bg-success" />
                    <span>Performance TWR</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-text-muted">
                    <div className="w-3 h-0.5 bg-purple-500" />
                    <span>{benchmarkTicker}</span>
                  </div>
                </div>
                <div className="flex bg-surface p-1 rounded-sm gap-1">
                  <button 
                    onClick={() => setChartView('performance')}
                    className={cn(
                      "px-3 py-1 text-[10px] font-bold rounded-sm transition-all",
                      chartView === 'performance' ? "bg-white shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
                    )}
                  >
                    Performance
                  </button>
                  <button 
                    onClick={() => setChartView('value')}
                    className={cn(
                      "px-3 py-1 text-[10px] font-bold rounded-sm transition-all",
                      chartView === 'value' ? "bg-white shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
                    )}
                  >
                    Value
                  </button>
                </div>
              </div>
            </div>

            <div className="h-[260px] w-full px-2 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={performanceData.dataPoints} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.1}/>
                      <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="0 0" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" hide />
                  <YAxis 
                    orientation="right" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 9, fill: "var(--color-text-muted)", fontWeight: 600 }} 
                    domain={['auto', 'auto']}
                    tickFormatter={(val) => chartView === 'performance' ? `${val}%` : `$${formatCompact(val)}`}
                  />
                  <Tooltip 
                    content={<CustomTooltip benchmarkTicker={benchmarkTicker} chartView={chartView} />}
                    cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey={chartView === 'performance' ? "cumReturn" : "value"} 
                    stroke="var(--color-success)" 
                    strokeWidth={2} 
                    fillOpacity={1} 
                    fill="url(#colorValue)" 
                    dot={false} 
                  />
                  {compareEnabled && (
                    <Line 
                      type="monotone" 
                      dataKey="spy" 
                      stroke="#8b5cf6" 
                      strokeWidth={2} 
                      dot={false} 
                      strokeDasharray="5 5"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Time Horizons at bottom */}
            <div className="px-6 py-3 border-t border-border flex justify-center md:justify-end gap-2 overflow-x-auto no-scrollbar">
              {["7D", "MTD", "YTD", "1Y", "ALL"].map((p) => (
                <button 
                  key={p} 
                  onClick={() => setTimeHorizon(p)}
                  className={cn(
                    "text-[10px] font-bold px-3 py-1 rounded-sm transition-all",
                    timeHorizon === p 
                      ? "bg-surface text-accent" 
                      : "text-text-muted hover:text-text-primary"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </DashboardCard>

          {/* Change in NAV Panel */}
          <DashboardCard
            title="Change in NAV"
            subtitle={advancedNavMetrics.label}
            className="md:col-span-4" 
          >
            <div className="flex flex-col gap-4 mt-4 h-[280px] justify-between">
               <div className="p-3 bg-surface border border-border rounded-lg text-center">
                  <div className="flex items-center justify-center gap-3">
                     <span className="text-gray-500 font-mono text-sm">${advancedNavMetrics.beginNav.toFixed(2)}</span>
                     <ArrowUpRight size={16} className="text-gray-400" />
                     <span className="font-semibold font-mono text-lg">${advancedNavMetrics.endNav.toFixed(2)}</span>
                  </div>
                  <div className={cn(
                    "mt-2 text-sm font-bold flex items-center justify-center gap-2", 
                    advancedNavMetrics.changeAmount >= 0 ? "text-success" : "text-danger"
                  )}>
                     <span>{advancedNavMetrics.changeAmount >= 0 ? '+' : ''}${advancedNavMetrics.changeAmount.toFixed(2)}</span>
                     <span className={cn("px-1.5 py-0.5 rounded text-[10px]", advancedNavMetrics.changeAmount >= 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
                       {advancedNavMetrics.changePercent >= 0 ? '+' : ''}{advancedNavMetrics.changePercent.toFixed(2)}%
                     </span>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                     <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Best Day</p>
                     <p className="text-sm font-semibold text-gray-800">{advancedNavMetrics.bestDay.date || '---'}</p>
                     <p className="text-xs text-success font-medium">+{advancedNavMetrics.bestDay.return.toFixed(2)}%</p>
                  </div>
                  <div className="space-y-1">
                     <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Worst Day</p>
                     <p className="text-sm font-semibold text-gray-800">{advancedNavMetrics.worstDay.date || '---'}</p>
                     <p className="text-xs text-danger font-medium">{advancedNavMetrics.worstDay.return.toFixed(2)}%</p>
                  </div>
               </div>

               <div className="pt-3 border-t border-border mt-auto">
                 <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Net Capital Flow</span>
                    <span className={cn("text-sm font-semibold", advancedNavMetrics.netCapitalFlow >= 0 ? "text-success" : "text-danger")}>
                       {advancedNavMetrics.netCapitalFlow >= 0 ? '+' : ''}${Math.abs(advancedNavMetrics.netCapitalFlow).toLocaleString()}
                    </span>
                 </div>
               </div>
            </div>
          </DashboardCard>
        </div>

        {/* Row 3: Allocation Charts */}
        <AllocationDonuts assets={enrichedAssets} cashBalance={fund.cashBalance} />

        {/* Row 4: Forward Looking Panels */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
           <ProjectedIncome assets={enrichedAssets} />
           <InvestmentThemes assets={enrichedAssets} />
        </div>

        {/* Row 5: Movers and Table Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
           <div className="md:col-span-12 xl:col-span-12">
             <PortfolioMovers assets={enrichedAssets} quotes={stockQuotes} totalMarketValue={totalAssetMarketValue} />
           </div>
           <div className="md:col-span-12">
             <HoldingsTable assets={enrichedAssets} cashBalance={fund.cashBalance} quotes={stockQuotes} logos={tickerLogos} names={tickerNames} />
           </div>
        </div>
      </div>
      {/* Right Sidebar: Account Summary */}
      <div className="w-full xl:w-[320px] shrink-0">
         <div className="bg-bg-secondary border border-border rounded-sm overflow-hidden sticky top-6">
            <div className="p-4 border-b border-border bg-surface/50 flex items-center justify-between">
               <div>
                 <h3 className="text-sm font-bold tracking-tight text-text-primary uppercase">Summary</h3>
                 <p className="text-[10px] text-text-muted font-medium uppercase tracking-wider">{fund.id.split('-').slice(0, 2).join(' ')}</p>
               </div>
               {userRole === 'PM' && (
                 <button 
                   onClick={handleRevalue}
                   className="p-1.5 hover:bg-white bg-surface border border-border rounded shadow-sm text-text-secondary hover:text-text-primary transition-colors"
                   title="Refresh Market Data"
                 >
                   <RefreshCw size={14} className={cn(isRefreshing && "animate-spin")} />
                 </button>
               )}
            </div>
            
            <div className="p-5 flex flex-col gap-4">
               <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">NAV Per Unit</div>
                  <div className="text-3xl font-black text-text-primary tracking-tight">
                    {formatPrice(Number(calculatedNav))}
                  </div>
               </div>
               
                <div className="flex flex-col gap-0 border-t border-gray-100">
                    <SummaryRow label="NAV" value={formatCurrency(totalValue)} />
                    <SummaryRow label="Cash" value={formatCurrency(fund.cashBalance)} />
                    <SummaryRow 
                      label="UP&L" 
                      value={`${unrealizedPnL >= 0 ? '+' : ''}${formatCurrency(Math.abs(unrealizedPnL))}`} 
                      colorClass={unrealizedPnL >= 0 ? 'text-success' : 'text-danger'}
                    />
                    <SummaryRow 
                      label="RP&L" 
                      value={`${realizedPnL >= 0 ? '+' : ''}${formatCurrency(Math.abs(realizedPnL))}`} 
                      colorClass={realizedPnL >= 0 ? 'text-success' : 'text-danger'}
                    />
                    <SummaryRow label="Mkt Value" value={formatCurrency(totalAssetMarketValue)} />
                    <SummaryRow 
                      label="Holdings" 
                      value={activeAssets.length.toString()} 
                    />
                </div>
               
               <div className="mt-2 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between text-xs text-text-muted">
                     <span>Last Reconciled</span>
                     <span className="font-mono">{(new Date(fund.updatedAt)).toLocaleTimeString()}</span>
                  </div>
               </div>
            </div>
         </div>
      </div>

    </div>
  );
}

function SummaryRow({ label, value, colorClass }: { label: string, value: string | React.ReactNode, colorClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0 hover:bg-surface/20 transition-colors px-1">
      <span className="text-[11px] font-medium text-text-secondary uppercase tracking-tight">{label}</span>
      <span className={cn("text-xs font-bold text-text-primary tabular-nums", colorClass)}>
        {value}
      </span>
    </div>
  );
}
