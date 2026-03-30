import React from "react";
import { LayoutDashboard, PieChart, Users, BookOpen, Repeat, Settings, LogOut, Menu, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Fund } from "@/src/types";

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  userEmail?: string | null;
  fund?: Fund;
  userRole: 'admin' | 'investor' | 'public';
}

export default function Layout({ children, activeTab, setActiveTab, onLogout, userEmail, fund, userRole }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "portfolio", label: "Portfolio", icon: PieChart },
    { id: "investors", label: "Investors", icon: Users },
    { id: "ledger", label: "Ledger", icon: BookOpen },
    { id: "trades", label: "Trades", icon: Repeat },
    { id: "settings", label: "Settings", icon: Settings },
  ].filter(item => {
    if (userRole === 'admin') return true;
    if (userRole === 'investor') return ['dashboard', 'portfolio'].includes(item.id);
    if (userRole === 'public') return ['dashboard'].includes(item.id);
    return false;
  });

  return (
    <div className="min-h-screen bg-sg-bg text-sg-black font-sans">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-sg-black/50 z-40 md:hidden" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed top-0 left-0 h-full w-64 bg-sg-black text-sg-white z-50 transition-transform duration-300 md:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 border-b border-sg-white/10 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tighter uppercase">MAD CAPITAL</h1>
          <button className="md:hidden" onClick={() => setIsSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="p-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setIsSidebarOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-none transition-colors",
                activeTab === item.id 
                  ? "bg-sg-red text-sg-white" 
                  : "hover:bg-sg-white/10"
              )}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 w-full p-4 border-t border-sg-white/10">
          <div className="px-4 py-3 mb-4">
            <p className="text-xs opacity-50 uppercase tracking-widest mb-1">Account</p>
            <p className="text-sm font-mono truncate">{userEmail || "Guest User"}</p>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-none hover:bg-sg-red/20 text-sg-red transition-colors"
          >
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="md:ml-64 min-h-screen">
        {/* Header */}
        <header className="h-16 border-b border-sg-black/10 bg-sg-white/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-6">
          <button className="md:hidden" onClick={() => setIsSidebarOpen(true)}>
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-4 ml-auto">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] opacity-50 uppercase tracking-widest">Total AUM</p>
              <p className="text-lg font-mono font-bold">
                {fund ? (userRole === 'public' ? "---" : `$${(fund.totalUnits * fund.navPerUnit).toLocaleString(undefined, { minimumFractionDigits: 2 })}`) : "---"}
              </p>
            </div>
          </div>
        </header>

        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}

