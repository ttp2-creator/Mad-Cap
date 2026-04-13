import { collection, query, where, getDocs, doc, writeBatch } from "firebase/firestore";
import { db } from "@/src/firebase";
import { Fund, Trade, Asset, LedgerEntry, Investor } from "@/src/types";

/**
 * Replays all ledger entries and trades to calculate the ground-truth state of a fund.
 * Updates the fund's totalAum, totalUnits, and cashBalance, and corrects all asset and investor states.
 */
export async function syncFundState(fundId: string) {
  const fundRef = doc(db, "funds", fundId);
  const ledgerQuery = query(collection(db, "ledger"), where("fundId", "==", fundId));
  const tradesQuery = query(collection(db, "trades"), where("fundId", "==", fundId));
  const assetsQuery = query(collection(db, "assets"), where("fundId", "==", fundId));
  const investorsQuery = query(collection(db, "investors"), where("fundId", "==", fundId));

  const [ledgerSnap, tradesSnap, assetsSnap, investorsSnap] = await Promise.all([
    getDocs(ledgerQuery),
    getDocs(tradesQuery),
    getDocs(assetsQuery),
    getDocs(investorsQuery)
  ]);

  const rawLedger = ledgerSnap.docs.map(d => ({ ...d.data(), id: d.id } as LedgerEntry));
  const rawTrades = tradesSnap.docs.map(d => ({ ...d.data(), id: d.id } as Trade));
  const currentAssets = assetsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Asset));
  const currentInvestors = investorsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Investor));

  // 1. Create a Unified Timeline
  type TimelineEvent = {
    type: 'ledger' | 'trade';
    date: number;
    data: any;
  };

  const timeline: TimelineEvent[] = [
    ...rawLedger.map(l => ({ type: 'ledger' as const, date: l.date, createdAt: l.createdAt || 0, data: l })),
    ...rawTrades.map(t => ({ type: 'trade' as const, date: t.date, createdAt: t.createdAt || 0, data: t }))
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date - b.date;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  // 2. Replay History
  let cashBalance = 0;
  let totalUnits = 0;
  const assetQuantities: { [ticker: string]: { amount: number; costBasis: number; lastPrice: number } } = {};
  const investorMetrics: { [id: string]: { units: number; capital: number } } = {};
  const ledgerUpdates: { id: string; data: any }[] = [];

  timeline.forEach(event => {
    if (event.type === 'trade') {
      const trade = event.data as Trade;
      cashBalance += (trade.cashImpact || 0);
      
      if (!assetQuantities[trade.ticker]) {
        assetQuantities[trade.ticker] = { amount: 0, costBasis: 0, lastPrice: trade.price };
      }
      
      const asset = assetQuantities[trade.ticker];
      asset.lastPrice = trade.price; // Update last known price for NAV calculation

      if (trade.side === "buy") {
        asset.amount += (trade.amount || 0);
        asset.costBasis += (trade.notional || 0);
      } else {
        const prevAmount = asset.amount;
        if (prevAmount > 0) {
          const avgCost = asset.costBasis / prevAmount;
          asset.costBasis -= avgCost * (trade.amount || 0);
        }
        asset.amount -= (trade.amount || 0);
      }
      
      // Safety threshold to clean up floating point "phantom" shares
      if (Math.abs(asset.amount) < 0.05) {
        asset.amount = 0;
        asset.costBasis = 0;
      }
    } else {
      const entry = event.data as LedgerEntry;
      
      // Calculate current AUM for unit pricing
      const currentAssetValue = Object.values(assetQuantities).reduce((sum, a) => sum + (a.amount * a.lastPrice), 0);
      const currentAum = cashBalance + currentAssetValue;

      const unitPrice = totalUnits > 0 ? (currentAum / totalUnits) : 10.00;
      const amount = entry.type === 'deposit' ? entry.amount : -entry.amount;
      
      // Use existing unitsIssued if available to preserve historical ground truth
      const unitsIssued = (entry.unitsIssued && entry.unitsIssued !== 0) 
        ? entry.unitsIssued 
        : (amount / unitPrice);

      // Update globals
      cashBalance += amount;
      totalUnits += unitsIssued;

      if (entry.investorId) {
        if (!investorMetrics[entry.investorId]) {
          investorMetrics[entry.investorId] = { units: 0, capital: 0 };
        }
        investorMetrics[entry.investorId].units += unitsIssued;
        investorMetrics[entry.investorId].capital += amount;
      }

      // Record update for ledger entry
      ledgerUpdates.push({
        id: entry.id,
        data: {
          unitPrice,
          unitsIssued,
          preNav: currentAum,
          preUnits: totalUnits - unitsIssued,
          postUnits: totalUnits,
          postNav: currentAum + amount,
          updatedAt: Date.now()
        }
      });
    }
  });

  // 3. Prepare Batch Update
  const batch = writeBatch(db);

  // A. Update Ledger Entries
  ledgerUpdates.forEach(update => {
    batch.update(doc(db, "ledger", update.id), update.data);
  });

  // B. Update Investors
  currentInvestors.forEach(investor => {
    const metrics = investorMetrics[investor.id] || { units: 0, capital: 0 };
    batch.update(doc(db, "investors", investor.id), {
      unitsOwned: metrics.units,
      capitalInvested: metrics.capital,
      updatedAt: Date.now()
    });
  });

  // C. Update/Reconcile Assets
  // We iterate over assetQuantities instead of currentAssets to handle new/deleted positions correctly
  const assetKeys = new Set([...currentAssets.map(a => a.ticker), ...Object.keys(assetQuantities)]);
  
  assetKeys.forEach(ticker => {
    const calc = assetQuantities[ticker];
    const existing = currentAssets.find(a => a.ticker === ticker);
    
    if (!calc || calc.amount <= 0.00000001) {
      if (existing) {
        batch.delete(doc(db, "assets", existing.id));
      }
    } else {
      const data = {
        amount: calc.amount,
        costBasis: calc.costBasis,
        price: calc.lastPrice,
        updatedAt: Date.now(),
        fundId: fundId, // Ensure fundId is set
        ticker: ticker,
        type: 'equity'
      };
      
      if (existing) {
        batch.update(doc(db, "assets", existing.id), data);
      } else {
        const newAssetRef = doc(collection(db, "assets"));
        batch.set(newAssetRef, { ...data, createdAt: Date.now() });
      }
    }
  });

  // D. Final Fund Update
  // Re-calculate final AUM with updated prices isn't possible yet (async), so we use the best estimate from the replay
  const finalAssetValue = Object.values(assetQuantities).reduce((sum, a) => sum + (a.amount * a.lastPrice), 0);
  const totalAum = cashBalance + finalAssetValue;
  const navPerUnit = totalUnits > 0 ? (totalAum / totalUnits) : 10.00;

  batch.update(fundRef, {
    cashBalance,
    totalUnits,
    totalAum,
    navPerUnit,
    updatedAt: Date.now()
  });

  await batch.commit();
}

