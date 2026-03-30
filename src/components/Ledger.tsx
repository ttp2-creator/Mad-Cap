import React from "react";
import { BookOpen, Plus, Search, ArrowUpRight, ArrowDownRight, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { CapitalTransaction, Fund, Investor, Asset } from "@/src/types";
import { collection, addDoc, doc, updateDoc, runTransaction, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/src/firebase";
import ConfirmationModal from "./ConfirmationModal";

interface LedgerProps {
  ledger: CapitalTransaction[];
  investors: Investor[];
  assets: Asset[];
  fund?: Fund;
  userId: string;
  userRole: 'admin' | 'investor' | 'public';
}

export default function Ledger({ ledger, investors, assets, fund, userId, userRole }: LedgerProps) {
  const isAdmin = userRole === 'admin';
  const [isAdding, setIsAdding] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [newTx, setNewTx] = React.useState({
    investorId: "",
    type: "deposit" as "deposit" | "withdrawal" | "reval",
    amount: 0,
    notes: "",
    date: new Date().toISOString().split('T')[0]
  });

  const handleDeleteEntry = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(doc(db, "ledger", deleteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "ledger");
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund || isSubmitting) return;

    if (isNaN(newTx.amount) || newTx.amount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    setIsSubmitting(true);
    try {
      await runTransaction(db, async (transaction) => {
        const fundRef = doc(db, "funds", fund.id);
        const fundSnap = await transaction.get(fundRef);
        if (!fundSnap.exists()) throw "Fund does not exist!";
        
        const currentFund = fundSnap.data() as Fund;
        
        // Calculate CURRENT NAV based on current asset prices
        const totalAssetMarketValue = assets.reduce((sum, asset) => sum + (asset.amount * asset.price), 0);
        const currentTotalValue = totalAssetMarketValue + currentFund.cashBalance;
        
        const preNav = currentTotalValue;
        const preUnits = currentFund.totalUnits;
        
        // Use current NAV for unit issuance, default to 10 if no units exist
        const currentNavPerUnit = preUnits > 0 ? currentTotalValue / preUnits : 10;
        const unitPrice = currentNavPerUnit;

        let unitsIssued = 0;
        let postUnits = preUnits;
        let postNav = preNav;

        if (newTx.type === "deposit") {
          unitsIssued = newTx.amount / unitPrice;
          postUnits = preUnits + unitsIssued;
          postNav = preNav + newTx.amount;
        } else if (newTx.type === "withdrawal") {
          if (currentFund.cashBalance < newTx.amount) throw "Insufficient cash for withdrawal!";
          
          const withdrawalUnits = newTx.amount / unitPrice;
          const investor = investors.find(i => i.id === newTx.investorId);
          if (investor && investor.unitsOwned < withdrawalUnits) throw "Investor has insufficient units for withdrawal!";
          
          unitsIssued = -withdrawalUnits;
          postUnits = preUnits + unitsIssued;
          postNav = preNav - newTx.amount;
        }

        const investor = investors.find(i => i.id === newTx.investorId);
        if (!investor && newTx.type !== "reval") throw "Investor not found!";

        // Create Ledger Entry
        const ledgerRef = doc(collection(db, "ledger"));
        const ledgerData: Omit<CapitalTransaction, 'id'> = {
          fundId: fund.id,
          investorId: newTx.investorId,
          investorName: investor?.name || "System",
          type: newTx.type,
          amount: newTx.amount,
          preNav,
          preUnits,
          unitPrice,
          unitsIssued,
          postUnits,
          postNav,
          date: new Date(newTx.date).getTime(),
          notes: newTx.notes,
          userId,
          createdAt: Date.now()
        };
        transaction.set(ledgerRef, ledgerData);

        // Update Fund
        transaction.update(fundRef, {
          totalAum: postNav,
          totalUnits: postUnits,
          navPerUnit: postUnits > 0 ? postNav / postUnits : 10,
          cashBalance: currentFund.cashBalance + (newTx.type === "deposit" ? newTx.amount : -newTx.amount),
          updatedAt: Date.now()
        });

        // Update Investor
        if (investor) {
          const investorRef = doc(db, "investors", investor.id);
          transaction.update(investorRef, {
            capitalInvested: investor.capitalInvested + (newTx.type === "deposit" ? newTx.amount : -newTx.amount),
            unitsOwned: investor.unitsOwned + unitsIssued,
            updatedAt: Date.now()
          });
        }
      });

      setIsAdding(false);
      setNewTx({ investorId: "", type: "deposit", amount: 0, notes: "", date: new Date().toISOString().split('T')[0] });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "ledger");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold italic serif">Capital Ledger</h2>
        <button 
          onClick={() => setIsAdding(true)}
          className={cn(
            "bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:scale-105 transition-transform",
            !isAdmin && "hidden"
          )}
        >
          <Plus size={18} />
          New Entry
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-2xl border border-[#141414]/10 shadow-sm animate-in fade-in zoom-in-95 duration-200">
          <form onSubmit={handleAddTransaction} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Investor</label>
                <select 
                  required
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20"
                  value={newTx.investorId}
                  onChange={(e) => setNewTx({ ...newTx, investorId: e.target.value })}
                >
                  <option value="">Select Investor</option>
                  {investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Type</label>
                <select 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20"
                  value={newTx.type}
                  onChange={(e) => setNewTx({ ...newTx, type: e.target.value as any })}
                >
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Amount ($)</label>
                <input 
                  required
                  type="number" 
                  step="0.01"
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  placeholder="0.00"
                  value={isNaN(newTx.amount) ? "" : newTx.amount}
                  onChange={(e) => setNewTx({ ...newTx, amount: e.target.value === "" ? NaN : parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Date</label>
                <input 
                  required
                  type="date" 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  value={newTx.date}
                  onChange={(e) => setNewTx({ ...newTx, date: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Notes</label>
                <input 
                  type="text" 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  placeholder="Optional notes..."
                  value={newTx.notes}
                  onChange={(e) => setNewTx({ ...newTx, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold text-sm disabled:opacity-50"
              >
                {isSubmitting ? "Processing..." : "Post Entry"}
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
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest">Member</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest">Type</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Amount</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Unit Price</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Units Issued</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Post Units</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Post NAV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/5">
              {ledger.sort((a, b) => b.date - a.date).map((tx) => (
                <tr key={tx.id} className="group hover:bg-[#141414]/5 transition-colors">
                  <td className="p-4 text-sm font-mono opacity-50">{new Date(tx.date).toLocaleDateString()}</td>
                  <td className="p-4 text-sm font-bold">{tx.investorName}</td>
                  <td className="p-4">
                    <span className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full",
                      tx.type === "deposit" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    )}>
                      {tx.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4 text-right font-mono text-sm">${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-4 text-right font-mono text-sm">${tx.unitPrice.toFixed(2)}</td>
                  <td className="p-4 text-right font-mono text-sm">{tx.unitsIssued.toFixed(2)}</td>
                  <td className="p-4 text-right font-mono text-sm">{tx.postUnits.toFixed(2)}</td>
                  <td className="p-4 text-right font-mono text-sm">${tx.postNav.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className={cn("p-4 text-right", !isAdmin && "hidden")}>
                    <button 
                      onClick={() => {
                        setDeleteId(tx.id);
                        setIsDeleteModalOpen(true);
                      }}
                      className="text-red-500 hover:text-red-700 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-xs opacity-50 font-mono uppercase tracking-widest">
                    No ledger entries found
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
        onConfirm={handleDeleteEntry}
        title="Delete Ledger Entry"
        message="Are you sure you want to delete this ledger entry? This will NOT automatically reverse the impact on fund AUM, units, or investor balances. You should manually adjust those if needed."
      />
    </div>
  );
}
