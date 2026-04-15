import React from "react";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from "firebase/auth";
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  doc,
  setDoc,
  addDoc
} from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType } from "./firebase";

import Layout from "./components/Layout";
import Dashboard from "./components/Dashboard";
import Portfolio from "./components/Portfolio";
import Investors from "./components/Investors";
import Ledger from "./components/Ledger";
import Trades from "./components/Trades";
import Settings from "./components/Settings";
import Auth from "./components/Auth";
import History from "./components/History";
import Performance from "./components/Performance";
import { Fund, Investor, LedgerEntry, Trade, Asset, FundSnapshot } from "./types";

export default function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState("dashboard");
  const [isAuthReady, setIsAuthReady] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem("mad-capital-theme");
      return (saved as "light" | "dark") || "light";
    }
    return "light";
  });

  // Apply theme
  React.useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("mad-capital-theme", theme);
  }, [theme]);


  // Data state
  const [funds, setFunds] = React.useState<Fund[]>([]);
  const [investors, setInvestors] = React.useState<Investor[]>([]);
  const [ledger, setLedger] = React.useState<LedgerEntry[]>([]);
  const [trades, setTrades] = React.useState<Trade[]>([]);
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [snapshots, setSnapshots] = React.useState<FundSnapshot[]>([]);

  const activeFund = React.useMemo(() => {
    // Prioritize fund administered by ttp2@fordham.edu
    const pmFund = funds.find(f => f.sharedWith?.pm?.includes("ttp2@fordham.edu"));
    return pmFund || funds[0];
  }, [funds]);

  const userRole = React.useMemo(() => {
    if (!user) return null;
    if (user.email === "ttp2@fordham.edu") return 'PM';
    if (!activeFund) return null;
    if (activeFund.userId === user.uid) return 'PM';
    if (activeFund.sharedWith?.pm?.includes(user.email || "")) return 'PM';
    if (activeFund.sharedWith?.analyst?.includes(user.email || "")) return 'Analyst';
    if (activeFund.sharedWith?.public?.includes(user.email || "")) return 'Public';
    return null;
  }, [user, activeFund]);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Real-time data listeners
  React.useEffect(() => {
    if (!user || !isAuthReady) return;

    const fundQuery = query(collection(db, "funds"));

    const unsubFunds = onSnapshot(fundQuery, (snapshot) => {
      const fetchedFunds = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Fund))
        .filter(fund => {
          const isOwner = fund.userId === user.uid;
          const isPM = fund.sharedWith?.pm?.includes(user.email || "");
          const isAnalyst = fund.sharedWith?.analyst?.includes(user.email || "");
          const isPublic = fund.sharedWith?.public?.includes(user.email || "");
          console.log("Checking fund:", fund.name, "Owner:", isOwner, "PM:", isPM, "Analyst:", isAnalyst, "Public:", isPublic, "User Email:", user.email);
          return isOwner || isPM || isAnalyst || isPublic;
        });
      console.log("Fetched funds:", fetchedFunds);
      setFunds(fetchedFunds);
    }, (error) => handleFirestoreError(error, OperationType.LIST, "funds"));

    return () => {
      unsubFunds();
    };
  }, [user, isAuthReady]);

  // Data listeners for active fund
  React.useEffect(() => {
    if (!user || !isAuthReady || !activeFund) return;

    const investorQuery = query(collection(db, "investors"), where("fundId", "==", activeFund.id));
    const ledgerQuery = query(collection(db, "ledger"), where("fundId", "==", activeFund.id));
    const tradeQuery = query(collection(db, "trades"), where("fundId", "==", activeFund.id));
    const assetQuery = query(collection(db, "assets"), where("fundId", "==", activeFund.id));
    const snapshotQuery = query(collection(db, "fund_snapshots"), where("fundId", "==", activeFund.id));

    const unsubInvestors = onSnapshot(investorQuery, (snapshot) => {
      setInvestors(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Investor)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "investors"));

    const unsubLedger = onSnapshot(ledgerQuery, (snapshot) => {
      setLedger(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as LedgerEntry)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "ledger"));

    const unsubTrades = onSnapshot(tradeQuery, (snapshot) => {
      setTrades(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Trade)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "trades"));

    const unsubAssets = onSnapshot(assetQuery, (snapshot) => {
      setAssets(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Asset)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "assets"));

    const unsubSnapshots = onSnapshot(snapshotQuery, (snapshot) => {
      setSnapshots(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as FundSnapshot)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "snapshots"));

    return () => {
      unsubInvestors();
      unsubLedger();
      unsubTrades();
      unsubAssets();
      unsubSnapshots();
    };
  }, [user, isAuthReady, activeFund]);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      
      if (result.user) {
        const userDocRef = doc(db, "users", result.user.uid);
        await setDoc(userDocRef, {
          uid: result.user.uid,
          email: result.user.email,
          displayName: result.user.displayName,
          role: 'user',
          createdAt: Date.now()
        }, { merge: true });
      }
    } catch (error) {
      console.error("Login failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center font-sans text-xs text-text-muted animate-pulse px-10 text-center">
        Establishing secure connection to MAD Capital...
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  if (userRole === null) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center font-sans text-sm text-text-muted">
        <p className="mb-8 border border-border bg-surface px-8 py-4 text-text-primary font-medium rounded-sm">Account access restricted. Please contact your administrator.</p>
        <button 
          onClick={handleLogout}
          className="bg-accent text-white px-8 py-2 font-bold text-xs hover:bg-accent-hover transition-all rounded-sm uppercase tracking-wider"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab} 
      onLogout={handleLogout}
      userEmail={user.email}
      fund={activeFund}
      userRole={userRole}
    >
      {activeTab === "dashboard" && (
        <Dashboard 
          fund={activeFund}
          investors={investors}
          assets={assets}
          ledger={ledger}
          trades={trades}
          snapshots={snapshots}
          userRole={userRole}
        />
      )}
      {activeTab === "performance" && userRole && (
        <Performance 
          fund={activeFund}
          snapshots={snapshots}
          assets={assets}
          ledger={ledger}
        />
      )}
      {activeTab === "portfolio" && userRole && (
        <Portfolio 
          assets={assets} 
          fund={activeFund}
          userRole={userRole}
        />
      )}
      {activeTab === "investors" && userRole && (
        <Investors 
          investors={investors} 
          fund={activeFund}
          userRole={userRole}
        />
      )}
      {activeTab === "ledger" && userRole && (
        <Ledger 
          ledger={ledger} 
          fund={activeFund}
          investors={investors}
          userRole={userRole}
        />
      )}
      {activeTab === "trades" && userRole && (
        <Trades 
          trades={trades} 
          assets={assets}
          fund={activeFund}
          userRole={userRole}
        />
      )}
      {activeTab === "history" && userRole && (
        <History
          fund={activeFund}
          snapshots={snapshots}
          userRole={userRole}
        />
      )}
      {activeTab === "settings" && (
        <Settings 
          fund={activeFund}
          userId={user.uid}
          theme={theme}
          onThemeChange={setTheme}
        />
      )}
    </Layout>
  );
}
