const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;
const POLYGON_KEY = process.env.POLYGON_KEY;

app.use(cors());
app.use(express.json());

// In-memory store for live TradingView data
let liveData = {};

// Health check
app.get("/", (req, res) => {
  res.json({ status: "COIL server running" });
});

// TradingView push endpoint — Claude Code posts data here
app.post("/tv-push", (req, res) => {
  const { ticker, rsi, bbw, bbwPercentile, ttmDot, ttmMomentum, price, change, changePct } = req.body;
  if (!ticker) return res.status(400).json({ error: "No ticker" });
  liveData[ticker.toUpperCase()] = {
    ticker: ticker.toUpperCase(),
    rsi, bbw, bbwPercentile, ttmDot, ttmMomentum,
    price, change, changePct,
    source: "tradingview",
    timestamp: Date.now()
  };
  res.json({ ok: true });
});

// Main quote endpoint — returns TradingView data if available, else Polygon
app.get("/quote/:ticker", async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();

  // Check for fresh TradingView data (less than 2 minutes old)
  const live = liveData[ticker];
  if (live && (Date.now() - live.timestamp) < 120000) {
    return res.json({ ...live, fromCache: true });
  }

  // Fall back to Polygon
  try {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 6);
    const fmt = d => d.toISOString().split("T")[0];

    const barsRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=150&apiKey=${POLYGON_KEY}`
    );
    const barsData = await barsRes.json();
    if (barsData.status === "ERROR" || !barsData.results?.length) {
      return res.status(404).json({ error: barsData.error || "Ticker not found" });
    }

    const prevRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`
    );
    const prevData = await prevRes.json();
    const prevBar = prevData.results?.[0];

    const bars = barsData.results;
    const closes = bars.map(b => b.c);
    const highs = bars.map(b => b.h);
    const lows = bars.map(b => b.l);
    const price = prevBar?.c ?? closes[closes.length - 1];
    const prevClose = closes[closes.length - 2] ?? closes[closes.length - 1];
    const change = price - prevClose;

    res.json({
      ticker, price, prevClose, change,
      changePct: (change / prevClose) * 100,
      closes, highs, lows,
      bars: bars.length,
      source: "polygon"
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`COIL server listening on port ${PORT}`));
