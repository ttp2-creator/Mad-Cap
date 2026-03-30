import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "d7282upr01qqkte01e60d7282upr01qqkte01e6g";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for stock data using Finnhub
  app.get("/api/stock/", (req, res) => {
    res.status(400).json({ error: "Ticker is required" });
  });

  app.get("/api/stock/:ticker", async (req, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      
      // Finnhub Quote endpoint: https://finnhub.io/api/v1/quote?symbol=AAPL&token=...
      const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`);
      
      if (!response.ok) {
        throw new Error(`Finnhub API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Finnhub returns 0 for price if symbol not found
      if (data.c === 0 && data.pc === 0) {
        return res.status(404).json({ error: "Stock not found or no data available" });
      }

      // Map Finnhub response to our app's format
      // c: Current price, d: Change, dp: Percent change, h: High, l: Low, o: Open, pc: Previous close
      res.json({
        ticker: ticker,
        name: ticker, // Finnhub quote doesn't return company name, would need another endpoint
        price: data.c,
        change: data.d,
        changePercent: data.dp,
        previousClose: data.pc,
        high: data.h,
        low: data.l,
        open: data.o,
        currency: "USD", // Defaulting to USD for now
      });
    } catch (error) {
      console.error(`Error fetching stock ${req.params.ticker}:`, error);
      res.status(500).json({ error: "Failed to fetch stock data" });
    }
  });

  // API Route for stock search
  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) return res.status(400).json({ error: "Query is required" });
      
      const response = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`);
      
      if (!response.ok) {
        throw new Error(`Finnhub API error: ${response.statusText}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error(`Error searching for ${req.query.q}:`, error);
      res.status(500).json({ error: "Failed to search for stocks" });
    }
  });

  // API Route for company profile (to get name)
  app.get("/api/stock/:ticker/profile", async (req, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      const response = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_API_KEY}`);
      
      if (!response.ok) {
        throw new Error(`Finnhub API error: ${response.statusText}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error(`Error fetching profile for ${req.params.ticker}:`, error);
      res.status(500).json({ error: "Failed to fetch company profile" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
