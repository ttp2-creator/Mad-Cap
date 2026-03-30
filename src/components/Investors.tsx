import React from "react";
import { Users, Plus, Search, ArrowUpRight, ArrowDownRight, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Investor, Fund } from "@/src/types";
import { collection, addDoc, deleteDoc, doc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/src/firebase";
import ConfirmationModal from "./ConfirmationModal";

interface InvestorsProps {
  investors: Investor[];
  fund?: Fund;
  userId: string;
  userRole: 'admin' | 'investor' | 'public';
}

export default function Investors({ investors, fund, userId, userRole }: InvestorsProps) {
  const isAdmin = userRole === 'admin';
  const [isAdding, setIsAdding] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [newInvestor, setNewInvestor] = React.useState({ 
    name: "",
    date: new Date().toISOString().split('T')[0]
  });

  const handleDeleteInvestor = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(doc(db, "investors", deleteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "investors");
    }
  };

  const handleAddInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      const investorData: Omit<Investor, 'id'> = {
        fundId: fund.id,
        name: newInvestor.name,
        capitalInvested: 0,
        unitsOwned: 0,
        userId,
        date: new Date(newInvestor.date).getTime(),
        createdAt: Date.now()
      };
      await addDoc(collection(db, "investors"), investorData);
      setIsAdding(false);
      setNewInvestor({ name: "", date: new Date().toISOString().split('T')[0] });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "investors");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalCapital = investors.reduce((sum, i) => sum + i.capitalInvested, 0);
  const totalUnits = investors.reduce((sum, i) => sum + i.unitsOwned, 0);

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold italic serif">Investors</h2>
        <button 
          onClick={() => setIsAdding(true)}
          className={cn(
            "bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:scale-105 transition-transform",
            !isAdmin && "hidden"
          )}
        >
          <Plus size={18} />
          Add Investor
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-2xl border border-[#141414]/10 shadow-sm animate-in fade-in zoom-in-95 duration-200">
          <form onSubmit={handleAddInvestor} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Investor Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  placeholder="e.g. John Doe"
                  value={newInvestor.name}
                  onChange={(e) => setNewInvestor({ ...newInvestor, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Join Date</label>
                <input 
                  required
                  type="date" 
                  className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                  value={newInvestor.date}
                  onChange={(e) => setNewInvestor({ ...newInvestor, date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold text-sm disabled:opacity-50"
              >
                {isSubmitting ? "Creating..." : "Create Investor"}
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
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest">Investor</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Capital Invested</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Units Owned</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Ownership %</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">Current Value</th>
                <th className="p-4 text-[10px] opacity-50 uppercase tracking-widest text-right">P&L ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/5">
              {investors.map((investor) => {
                const ownership = totalUnits > 0 ? (investor.unitsOwned / totalUnits) * 100 : 0;
                const currentValue = fund ? investor.unitsOwned * fund.navPerUnit : 0;
                const pnl = currentValue - investor.capitalInvested;
                
                return (
                  <tr key={investor.id} className="group hover:bg-[#141414]/5 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#141414]/5 flex items-center justify-center font-bold text-[10px]">
                          {investor.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-bold">{investor.name}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right font-mono text-sm">${investor.capitalInvested.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="p-4 text-right font-mono text-sm">{investor.unitsOwned.toFixed(2)}</td>
                    <td className="p-4 text-right font-mono text-sm">{ownership.toFixed(2)}%</td>
                    <td className="p-4 text-right font-mono text-sm">${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className={cn(
                      "p-4 text-right font-mono text-sm",
                      pnl >= 0 ? "text-green-600" : "text-red-600"
                    )}>
                      ${pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className={cn("p-4 text-right", !isAdmin && "hidden")}>
                      <button 
                        onClick={() => {
                          setDeleteId(investor.id);
                          setIsDeleteModalOpen(true);
                        }}
                        className="text-red-500 hover:text-red-700 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-[#141414]/5 font-bold">
                <td className="p-4 text-sm uppercase tracking-widest opacity-50">Total</td>
                <td className="p-4 text-right font-mono text-sm">${totalCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="p-4 text-right font-mono text-sm">{totalUnits.toFixed(2)}</td>
                <td className="p-4 text-right font-mono text-sm">100.00%</td>
                <td className="p-4 text-right font-mono text-sm">${(fund ? totalUnits * fund.navPerUnit : 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="p-4 text-right font-mono text-sm">
                  ${((fund ? totalUnits * fund.navPerUnit : 0) - totalCapital).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmationModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteInvestor}
        title="Delete Investor"
        message="Are you sure you want to delete this investor? This will NOT automatically adjust the fund's total units or capital. You should manually post a withdrawal in the ledger if needed."
      />
    </div>
  );
}
