import React from "react";
import { User as UserIcon, Bell, Shield, Database, Globe, Moon, LogOut, Users } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { User } from "firebase/auth";
import { auth, db } from "@/src/firebase";
import { signOut } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { Fund } from "@/src/types";

interface SettingsProps {
  user: User;
  fund?: Fund;
  userRole: 'admin' | 'investor' | 'public';
}

export default function Settings({ user, fund, userRole }: SettingsProps) {
  const [activeSection, setActiveSection] = React.useState("profile");
  const [shareEmail, setShareEmail] = React.useState("");
  const [shareRole, setShareRole] = React.useState<'admin' | 'investor' | 'public'>('investor');
  const isAdmin = userRole === 'admin';

  const sections = [
    { id: "profile", label: "Profile", icon: UserIcon },
    { id: "sharing", label: "Sharing", icon: Users },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
    { id: "data", label: "Data Management", icon: Database },
    { id: "preferences", label: "Preferences", icon: Globe },
  ];

  const handleShare = async () => {
    if (!fund || !shareEmail || !isAdmin) return;
    try {
      const fundRef = doc(db, "funds", fund.id);
      const currentSharedWith = fund.sharedWith || { admin: [], investor: [], public: [] };
      const updatedSharedWith = {
        ...currentSharedWith,
        [shareRole]: [...(currentSharedWith[shareRole] || []), shareEmail]
      };
      await updateDoc(fundRef, {
        sharedWith: updatedSharedWith
      });
      setShareEmail("");
      alert(`Shared with ${shareEmail} as ${shareRole}`);
    } catch (error) {
      console.error("Sharing failed:", error);
      alert("Sharing failed");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold italic serif">Settings</h2>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors font-bold text-sm"
        >
          <LogOut size={18} />
          <span>Sign Out</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Sidebar */}
        <div className="space-y-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-sm font-medium",
                activeSection === section.id 
                  ? "bg-[#141414] text-[#E4E3E0]" 
                  : "hover:bg-[#141414]/5"
              )}
            >
              <section.icon size={18} />
              {section.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="md:col-span-3 bg-white p-8 rounded-3xl shadow-sm border border-[#141414]/5 space-y-8">
          {activeSection === "profile" && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold italic serif border-b border-[#141414]/5 pb-4">Profile Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Display Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                    placeholder="John Doe" 
                    defaultValue={user.displayName || ""}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono opacity-50 cursor-not-allowed" 
                    value={user.email || ""} 
                    disabled 
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === "sharing" && isAdmin && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold italic serif border-b border-[#141414]/5 pb-4">Share Mad Capital</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 space-y-2">
                    <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Email Address</label>
                    <input 
                      type="email" 
                      className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20" 
                      placeholder="email@example.com"
                      value={shareEmail}
                      onChange={(e) => setShareEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Role</label>
                    <select 
                      className="w-full bg-[#141414]/5 border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[#141414]/20"
                      value={shareRole}
                      onChange={(e) => setShareRole(e.target.value as any)}
                    >
                      <option value="admin">Admin</option>
                      <option value="investor">Investor</option>
                      <option value="public">Public</option>
                    </select>
                  </div>
                </div>
                <button 
                  onClick={handleShare}
                  className="bg-[#141414] text-[#E4E3E0] px-6 py-3 rounded-xl font-bold text-sm hover:scale-105 transition-transform"
                >
                  Share Mad Capital
                </button>
              </div>
              
              {fund?.sharedWith && (
                <div className="pt-6 border-t border-[#141414]/5">
                  <h4 className="text-sm font-bold mb-4">Shared With</h4>
                  <div className="space-y-2">
                    {(['admin', 'investor', 'public'] as const).map(role => 
                      fund.sharedWith?.[role]?.map((email, index) => (
                        <div key={`${role}-${index}`} className="flex items-center justify-between p-3 bg-[#141414]/5 rounded-xl">
                          <span className="text-sm font-mono">{email}</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest bg-white px-2 py-1 rounded-lg">{role}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === "preferences" && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold italic serif border-b border-[#141414]/5 pb-4">App Preferences</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-[#141414]/5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
                      <Moon size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold">Dark Mode</p>
                      <p className="text-[10px] opacity-50">Toggle dark theme</p>
                    </div>
                  </div>
                  <button className="w-12 h-6 bg-[#141414]/20 rounded-full relative transition-colors">
                    <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm" />
                  </button>
                </div>
                <div className="flex items-center justify-between p-4 rounded-2xl bg-[#141414]/5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
                      <Globe size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold">Auto-Sync</p>
                      <p className="text-[10px] opacity-50">Sync data across devices</p>
                    </div>
                  </div>
                  <button className="w-12 h-6 bg-green-500 rounded-full relative transition-colors">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
