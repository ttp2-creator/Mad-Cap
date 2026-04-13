import React from "react";
import { Fund, FundSnapshot } from "../types";
import { collection, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { fetchStockQuote } from "../lib/finnhub";

interface HistoryProps {
  fund: Fund;
  snapshots: FundSnapshot[];
  userRole: 'PM' | 'Analyst' | 'Public';
}

export default function History({ fund, snapshots, userRole }: HistoryProps) {
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [status, setStatus] = React.useState<{type: 'success' | 'error', msg: string} | null>(null);

  const handleCaptureSnapshot = async () => {
    if (userRole !== 'PM') return;
    setIsCapturing(true);
    setStatus(null);
    try {
      const now = Date.now();
      const totalAum = fund.totalUnits * fund.navPerUnit;
      
      let currentSpy = 0;
      try {
        const spyQuote = await fetchStockQuote("SPY");
        if (spyQuote) {
          currentSpy = spyQuote.price;
        }
      } catch (err) {
        console.warn("Failed to fetch SPY for manual snapshot, using 0:", err);
      }

      const sortedSnapshots = [...snapshots].sort((a, b) => b.date - a.date);
      const lastSnapshot = sortedSnapshots.length > 0 ? sortedSnapshots[0] : null;
      let dailyPnl = 0;
      if (lastSnapshot) {
        dailyPnl = (fund.navPerUnit - lastSnapshot.navPerUnit) * fund.totalUnits;
      }

      const snapshotData: Omit<FundSnapshot, 'id'> = {
        fundId: fund.id,
        date: now,
        totalAum,
        totalUnits: fund.totalUnits,
        navPerUnit: fund.navPerUnit,
        spyValue: currentSpy,
        dailyPnl,
        createdAt: now,
      };

      await addDoc(collection(db, "fund_snapshots"), snapshotData);
      setStatus({ type: 'success', msg: 'Snapshot synchronized successfully.' });
      setTimeout(() => setStatus(null), 3000);
    } catch (error: any) {
      console.error("Failed to capture snapshot:", error);
      setStatus({ type: 'error', msg: `Protocol error: ${error.message || 'Unknown'}` });
    } finally {
      setIsCapturing(false);
    }
  };

  const sortedSnapshots = [...snapshots].sort((a, b) => b.date - a.date);

  return (
    <div className="space-y-6">
      {status && (
        <div className={`p-3 text-[10px] font-black uppercase tracking-[0.2em] border ${
          status.type === 'success' ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'
        } animate-in fade-in slide-in-from-top-2 duration-300`}>
          {status.type === 'success' ? 'SYSTEM_SYNC: ' : 'FATAL_ERROR: '}
          {status.msg}
        </div>
      )}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-widest text-text-primary flex items-center gap-2">
            <Database size={20} className="text-accent" />
            Historical Performance
          </h2>
          <p className="text-xs font-mono text-text-secondary mt-1 tracking-wider">
            END OF DAY SYSTEM SNAPSHOTS
          </p>
        </div>
        {userRole === 'PM' && (
          <button
            onClick={handleCaptureSnapshot}
            disabled={isCapturing}
            className="flex items-center gap-2 bg-surface/50 border border-accent/30 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
          >
            <Plus size={14} />
            {isCapturing ? "CAPTURING..." : "CAPTURE SNAPSHOT"}
          </button>
        )}
      </div>

      <div className="bg-bg-secondary border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-[10px] uppercase font-black tracking-widest text-text-secondary">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Fund AUM</th>
                <th className="px-4 py-3 text-right">Total Units</th>
                <th className="px-4 py-3 text-right">NAV per Unit</th>
                <th className="px-4 py-3 text-right">S&P 500</th>
                <th className="px-4 py-3 text-right">Daily P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono text-xs">
              {sortedSnapshots.map((snapshot) => (
                <tr key={snapshot.id} className="hover:bg-surface/30 transition-colors cursor-pointer group">
                  <td className="px-4 py-3 text-text-primary">
                    {new Date(snapshot.date).toLocaleString([], { 
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit', second: '2-digit'
                    })}
                  </td>
                  <td className="px-4 py-3 text-right text-text-primary">
                    ${snapshot.totalAum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">
                    {snapshot.totalUnits.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 7 })}
                  </td>
                  <td className="px-4 py-3 text-right text-text-primary">
                    ${snapshot.navPerUnit.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">
                    {snapshot.spyValue ? `$${snapshot.spyValue.toFixed(2)}` : '---'}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${snapshot.dailyPnl >= 0 ? "text-success" : "text-danger"}`}>
                    {snapshot.dailyPnl >= 0 ? '+' : ''}
                    ${Math.abs(snapshot.dailyPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {sortedSnapshots.length === 0 && (
                <tr className="border-b border-border group opacity-50">
                  <td colSpan={6} className="px-6 py-6 text-center text-[10px] uppercase tracking-widest text-text-secondary font-mono">
                    NO HISTORICAL SNAPSHOTS FOUND
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
