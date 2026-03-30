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
import { Fund, Investor, CapitalTransaction, Trade, Asset } from "./types";

export default function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState("dashboard");
  const [isAuthReady, setIsAuthReady] = React.useState(false);

  // Data state
  const [funds, setFunds] = React.useState<Fund[]>([]);
  const [investors, setInvestors] = React.useState<Investor[]>([]);
  const [ledger, setLedger] = React.useState<CapitalTransaction[]>([]);
  const [trades, setTrades] = React.useState<Trade[]>([]);
  const [assets, setAssets] = React.useState<Asset[]>([]);

  const activeFund = React.useMemo(() => {
    // Prioritize fund administered by ttp2@fordham.edu
    const adminFund = funds.find(f => f.sharedWith?.admin?.includes("ttp2@fordham.edu"));
    return adminFund || funds[0];
  }, [funds]);

  const userRole = React.useMemo(() => {
    if (!user) return null;
    if (user.email === "ttp2@fordham.edu") return 'admin';
    if (!activeFund) return null;
    if (activeFund.userId === user.uid) return 'admin';
    if (activeFund.sharedWith?.admin?.includes(user.email || "")) return 'admin';
    if (activeFund.sharedWith?.investor?.includes(user.email || "")) return 'investor';
    if (activeFund.sharedWith?.public?.includes(user.email || "")) return 'public';
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
          const isAdmin = fund.sharedWith?.admin?.includes(user.email || "");
          const isInvestor = fund.sharedWith?.investor?.includes(user.email || "");
          const isPublic = fund.sharedWith?.public?.includes(user.email || "");
          console.log("Checking fund:", fund.name, "Owner:", isOwner, "Admin:", isAdmin, "Investor:", isInvestor, "Public:", isPublic, "User Email:", user.email);
          return isOwner || isAdmin || isInvestor || isPublic;
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

    const unsubInvestors = onSnapshot(investorQuery, (snapshot) => {
      setInvestors(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Investor)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "investors"));

    const unsubLedger = onSnapshot(ledgerQuery, (snapshot) => {
      setLedger(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CapitalTransaction)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "ledger"));

    const unsubTrades = onSnapshot(tradeQuery, (snapshot) => {
      setTrades(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Trade)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "trades"));

    const unsubAssets = onSnapshot(assetQuery, (snapshot) => {
      setAssets(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Asset)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "assets"));

    return () => {
      unsubInvestors();
      unsubLedger();
      unsubTrades();
      unsubAssets();
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
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center font-mono text-sm uppercase tracking-widest animate-pulse">
        Initializing Mad Capital...
      </div>
    );
  }

  if (!user) {
    return <Auth onLogin={handleLogin} isLoading={isLoading} />;
  }

  if (userRole === null) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center font-mono text-sm uppercase tracking-widest">
        <p className="mb-4">Access Denied</p>
        <button 
          onClick={handleLogout}
          className="bg-[#141414] text-[#E4E3E0] px-6 py-3 rounded-xl font-bold text-sm hover:scale-105 transition-transform"
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
          userRole={userRole}
        />
      )}
      {activeTab === "portfolio" && userRole && (
        <Portfolio 
          assets={assets} 
          fund={activeFund}
          userId={user.uid}
          userRole={userRole}
        />
      )}
      {activeTab === "investors" && userRole && (
        <Investors 
          investors={investors} 
          fund={activeFund}
          userId={user.uid}
          userRole={userRole}
        />
      )}
      {activeTab === "ledger" && userRole && (
        <Ledger 
          ledger={ledger} 
          investors={investors}
          assets={assets}
          fund={activeFund}
          userId={user.uid}
          userRole={userRole}
        />
      )}
      {activeTab === "trades" && userRole && (
        <Trades 
          trades={trades} 
          assets={assets}
          fund={activeFund}
          userId={user.uid}
          userRole={userRole}
        />
      )}
      {activeTab === "settings" && (
        <Settings 
          user={user}
          fund={activeFund}
          userRole={userRole}
        />
      )}
    </Layout>
  );
}
