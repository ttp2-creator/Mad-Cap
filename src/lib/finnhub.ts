const FINNHUB_API_KEY = "d7282upr01qqkte01e60d7282upr01qqkte01e6g";
const BASE_URL = "https://finnhub.io/api/v1";

export interface StockQuote {
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  ticker: string;
}

export async function fetchStockQuote(ticker: string): Promise<StockQuote | null> {
  try {
    const symbol = ticker.toUpperCase();
    const response = await fetch(`${BASE_URL}/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`);
    
    if (!response.ok) {
      throw new Error(`Finnhub error: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Finnhub returns 0 for price if symbol not found
    if (data.c === 0 && data.pc === 0) {
      return null;
    }

    return {
      ticker: symbol,
      price: data.c,
      change: data.d,
      changePercent: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc
    };
  } catch (error) {
    console.error(`Error fetching quote for ${ticker}:`, error);
    return null;
  }
}

export async function searchStocks(query: string) {
  try {
    const response = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`);
    if (!response.ok) throw new Error("Search failed");
    return await response.json();
  } catch (error) {
    console.error("Search error:", error);
    return { result: [] };
  }
}

export async function fetchCompanyProfile(ticker: string) {
  try {
    const response = await fetch(`${BASE_URL}/stock/profile2?symbol=${ticker.toUpperCase()}&token=${FINNHUB_API_KEY}`);
    if (!response.ok) throw new Error("Profile fetch failed");
    return await response.json();
  } catch (error) {
    console.error("Profile error:", error);
    return null;
  }
}
