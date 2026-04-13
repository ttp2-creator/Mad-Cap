export type UserRole = "PM" | "Analyst" | "Public";

export type Fund = {
  id: string;
  name: string;
  totalAum: number;
  totalUnits: number;
  navPerUnit: number;
  cashBalance: number;
  userId: string;
  sharedWith?: { 
    pm: string[];       // Portfolio Managers
    analyst: string[];   // Analysts
    public: string[];    // Public Viewers
  };
  createdAt: number;
  updatedAt?: number;
};

export type Investor = {
  id: string;
  fundId: string;
  name: string;
  capitalInvested: number;
  unitsOwned: number;
  userId: string;
  date: number;
  createdAt: number;
};

export type CapitalTransactionType = "deposit" | "withdrawal" | "reval";

export type LedgerEntry = {
  id: string;
  fundId: string;
  investorId: string;
  investorName: string;
  type: CapitalTransactionType;
  amount: number;
  preNav: number;
  preUnits: number;
  unitPrice: number;
  unitsIssued: number;
  postUnits: number;
  postNav: number;
  date: number;
  notes?: string;
  userId: string;
  createdAt: number;
};

export type TradeSide = "buy" | "sell";

export type Trade = {
  id: string;
  fundId: string;
  ticker: string;
  side: TradeSide;
  amount: number;
  price: number;
  notional: number;
  cashImpact: number;
  realizedPnL: number;
  date: number;
  notes?: string;
  userId: string;
  createdAt: number;
};

export interface FundSnapshot {
  id: string;
  fundId: string;
  date: number; // Unix timestamp
  totalAum: number;
  totalUnits: number;
  navPerUnit: number;
  spyValue: number;
  dailyPnl: number;
  createdAt: number;
}

export type Asset = {
  id: string;
  fundId: string;
  ticker: string;
  name: string;
  type: string;
  amount: number;
  costBasis: number;
  price: number;
  userId: string;
  date?: number;
  createdAt: number;
  updatedAt?: number;
};
