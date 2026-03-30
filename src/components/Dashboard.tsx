import React from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell 
} from "recharts";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Asset, Fund, Investor } from "@/src/types";
import { doc, updateDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/src/firebase";

interface DashboardProps {
  fund?: Fund;
  investors: Investor[];
  assets: Asset[];
  userRole: 'admin' | 'investor' | 'public';
}

export default function Dashboard({ fund, investors, assets, userRole }: DashboardProps) {
  if (!fund) return <div className="p-10 text-center opacity-50">Loading fund data...</div>;

  const isPublic = userRole === 'public';

  const totalAssetMarketValue = assets.reduce((sum, asset) => sum + (asset.amount * asset.price), 0);
  const totalValue = totalAssetMarketValue + fund.cashBalance;
  
  // NAV Calculation: (Assets + Cash) / Total Units
  const calculatedNav = fund.totalUnits > 0 ? totalValue / fund.totalUnits : 10;

  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const handleRefreshAllPrices = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      for (const asset of assets) {
        if (asset.type === "stock") {
          const response = await fetch(`/api/stock/${asset.ticker}`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.price) {
              await updateDoc(doc(db, "assets", asset.id), {
                price: data.price,
                updatedAt: Date.now()
              });
            }
          }
        }
      }
      // After refreshing all prices, revalue the fund
      await handleRevalue();
    } catch (error) {
      console.error("Error refreshing all prices:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRevalue = async () => {
    try {
      await updateDoc(doc(db, "funds", fund.id), {
        totalAum: totalValue,
        navPerUnit: calculatedNav,
        updatedAt: Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "funds");
    }
  };

  // Mock performance data (in a real app, this would be from a history collection)
  const performanceData = [
    { name: "Jan", value: calculatedNav * 0.95 },
    { name: "Feb", value: calculatedNav * 0.98 },
    { name: "Mar", value: calculatedNav * 0.97 },
    { name: "Apr", value: calculatedNav * 1.02 },
    { name: "May", value: calculatedNav * 1.05 },
    { name: "Jun", value: calculatedNav },
  ];

  const assetAllocation = [
    { name: "Equities", value: totalAssetMarketValue, color: "#141414" },
    { name: "Cash", value: fund.cashBalance, color: "#5A5A40" },
  ].filter(item => item.value > 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold italic serif">Mad Capital Overview: {fund.name}</h2>
        <button 
          onClick={handleRevalue}
          className="flex items-center gap-2 text-xs font-mono bg-[#141414]/5 hover:bg-[#141414]/10 px-3 py-2 rounded-xl transition-colors"
        >
          <RefreshCw size={14} />
          Revalue Mad Capital
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Fund AUM", value: isPublic ? "---" : `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, change: "+2.4%", positive: true },
          { label: "NAV Per Unit", value: isPublic ? "---" : `$${calculatedNav.toFixed(4)}`, change: "+1.2%", positive: true },
          { label: "Total Units", value: isPublic ? "---" : fund.totalUnits.toLocaleString(undefined, { maximumFractionDigits: 2 }), change: "0.0%", positive: true },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-[#141414]/5">
            <p className="text-[10px] opacity-50 uppercase tracking-widest mb-1 font-bold">{stat.label}</p>
            <div className="flex items-end justify-between">
              <h2 className="text-3xl font-mono font-bold">{stat.value}</h2>
              <div className={cn(
                "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                stat.positive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              )}>
                {stat.positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {stat.change}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-[#141414]/5">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold italic serif">NAV Performance</h3>
            <div className="flex gap-2">
              {["1M", "3M", "6M", "1Y", "ALL"].map((p) => (
                <button key={p} className="text-[10px] font-mono px-2 py-1 rounded border border-[#141414]/10 hover:bg-[#141414] hover:text-white transition-colors">
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performanceData}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#141414" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#141414" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#14141410" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: "#14141450" }} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: "#14141450" }}
                  domain={['auto', 'auto']}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "#141414", 
                    border: "none", 
                    borderRadius: "8px",
                    color: "#E4E3E0",
                    fontSize: "12px",
                    fontFamily: "monospace"
                  }}
                  itemStyle={{ color: "#E4E3E0" }}
                />
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#141414" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorValue)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#141414]/5">
          <h3 className="text-lg font-bold italic serif mb-6">Fund Allocation</h3>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={assetAllocation}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {assetAllocation.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3 mt-4">
            {assetAllocation.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm font-medium">{item.name}</span>
                </div>
                <span className="text-sm font-mono opacity-50">
                  {((item.value / totalValue) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Positions */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#141414]/5">
        <h3 className="text-lg font-bold italic serif mb-6">Top Positions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#141414]/5">
                <th className="pb-4 text-[10px] opacity-50 uppercase tracking-widest">Ticker</th>
                <th className="pb-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Shares</th>
                <th className="pb-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Price</th>
                <th className="pb-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Market Value</th>
                <th className="pb-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/5">
              {assets.sort((a, b) => (b.amount * b.price) - (a.amount * a.price)).slice(0, 5).map((asset) => (
                <tr key={asset.id} className="group hover:bg-[#141414]/5 transition-colors">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#141414]/5 flex items-center justify-center font-bold text-[10px]">
                        {asset.ticker.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-sm font-bold">{asset.ticker}</span>
                    </div>
                  </td>
                  <td className="py-4 text-right font-mono text-sm">{asset.amount.toLocaleString()}</td>
                  <td className="py-4 text-right font-mono text-sm">${asset.price.toLocaleString()}</td>
                  <td className="py-4 text-right font-mono text-sm">${(asset.amount * asset.price).toLocaleString()}</td>
                  <td className="py-4 text-right font-mono text-sm opacity-50">
                    {(((asset.amount * asset.price) / totalValue) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-xs opacity-50 font-mono uppercase tracking-widest">
                    No positions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

