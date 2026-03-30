import React from "react";
import { LogIn, ShieldCheck, PieChart, TrendingUp } from "lucide-react";

interface AuthProps {
  onLogin: () => void;
  isLoading: boolean;
}

export default function Auth({ onLogin, isLoading }: AuthProps) {
  return (
    <div className="min-h-screen bg-sg-bg flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-4">
          <div className="w-20 h-20 bg-sg-red rounded-none flex items-center justify-center mx-auto shadow-2xl">
            <PieChart size={40} className="text-sg-white" />
          </div>
          <h1 className="text-5xl font-bold tracking-tighter text-sg-black">
            MAD CAPITAL
          </h1>
          <p className="text-sg-black/60 text-lg max-w-xs mx-auto">
            Private Investment Portal.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 py-8">
          {[
            { icon: ShieldCheck, label: "Secure Access", desc: "Institutional-grade security." },
            { icon: TrendingUp, label: "Performance Overview", desc: "Real-time portfolio insights." },
          ].map((feature, i) => (
            <div key={i} className="flex items-start gap-4 text-left p-4 rounded-none bg-sg-white border border-sg-black/10">
              <div className="w-10 h-10 rounded-none bg-sg-red flex items-center justify-center shrink-0">
                <feature.icon size={20} className="text-sg-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-sg-black">{feature.label}</h3>
                <p className="text-xs opacity-60 text-sg-black">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onLogin}
          disabled={isLoading}
          className="w-full bg-sg-red text-sg-white py-4 rounded-none font-bold flex items-center justify-center gap-3 hover:bg-sg-red/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-sg-white/30 border-t-sg-white rounded-full animate-spin" />
          ) : (
            <>
              <LogIn size={20} />
              <span>Continue with Google</span>
            </>
          )}
        </button>

        <p className="text-[10px] opacity-40 uppercase tracking-widest">
          By continuing, you agree to our Terms of Service.
        </p>
      </div>
    </div>
  );
}
