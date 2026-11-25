import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MARKET_DIR = path.join(ROOT, "data", "market");
const STOCKS_DIR = path.join(MARKET_DIR, "stocks");

const UPSTREAM = "https://data.funstx.com/data";
const INDEX_SYMBOLS = ["TAIEX", "TWOII", "SOX", "IXIC", "SPX", "DJI", "N225", "KOSPI", "NIFTY"];

fs.mkdirSync(STOCKS_DIR, { recursive: true });

async function fetchJson(endpoint) {
  const res = await fetch(`${UPSTREAM}/${endpoint}`, {
    headers: {
      "User-Agent": "StockT-Sync/1.0",
      Origin: "https://funstx.com",
      Referer: "https://funstx.com/"
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
  return res.json();
}

function writeJson(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data), "utf-8");
}

async function run() {
  console.log("Syncing market index, breadth, chips, and ticker lists...");
  const [tickers, summaryRaw, chips] = await Promise.all([
    fetchJson("tickers.json"),
    fetchJson("summary.json"),
    fetchJson("chips_history.json")
  ]);

  const { site: _ignoredSite, ...summary } = summaryRaw;
  writeJson(path.join(MARKET_DIR, "tickers.json"), tickers);
  writeJson(path.join(MARKET_DIR, "summary.json"), summary);
  writeJson(path.join(MARKET_DIR, "chips_history.json"), {
    generatedAt: chips.generatedAt,
    count: chips.count,
    history: (chips.history || []).slice(-180)
  });

  // Fetch all 9 global indices
  const idxResults = await Promise.allSettled(
    INDEX_SYMBOLS.map((sym) => fetchJson(`indices/${encodeURIComponent(sym)}.json`))
  );
  const indices = idxResults
    .filter((r) => r.status === "fulfilled")
    .map((r) => {
      const d = r.value;
      return {
        symbol: d.symbol,
        code: d.code,
        name: d.name,
        nameEn: d.nameEn,
        market: d.market,
        exchange: d.exchange,
        updatedAt: d.updatedAt,
        metrics: d.metrics,
        recentBars: (d.bars || []).slice(-30)
      };
    });
  writeJson(path.join(MARKET_DIR, "indices.json"), { count: indices.length, items: indices });

  // Select top popular TW/US stocks & ETFs for instant full 500-day K-line snapshot
  const items = summary.items || [];
  const mustHave = [
    "00631L.TW", "2330.TW", "0050.TW", "0056.TW", "00632R.TW", "00675L.TW", "00685L.TW",
    "2454.TW", "2317.TW", "2308.TW", "2303.TW", "2382.TW", "3231.TW", "6488.TWO",
    "2881.TW", "2882.TW", "2891.TW", "2603.TW", "3008.TW",
    "NVDA", "TSM", "AAPL", "MSFT", "TSLA", "AMD", "MU", "AVGO", "AMZN", "GOOG",
    "SPY", "QQQ", "VOO", "SOXX", "DIA", "VT"
  ];
  const topTwTurnover = items
    .filter((x) => x.market === "TW" && x.assetType === "STOCK")
    .sort((a, b) => (b.turnover || 0) - (a.turnover || 0))
    .slice(0, 40)
    .map((x) => x.symbol);
  const topTwEtf = items
    .filter((x) => x.market === "TW" && x.assetType === "ETF")
    .sort((a, b) => (b.turnover || 0) - (a.turnover || 0))
    .slice(0, 12)
    .map((x) => x.symbol);
  const allUs = items.filter((x) => x.market === "US").map((x) => x.symbol);

  const symbolSet = [...new Set([...mustHave, ...topTwTurnover, ...topTwEtf, ...allUs])];
  console.log(`Syncing full 500-day history for ${symbolSet.length} core tickers...`);

  let okCount = 0;
  const concurrency = 10;
  for (let i = 0; i < symbolSet.length; i += concurrency) {
    const batch = symbolSet.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        const raw = await fetchJson(`stocks/${encodeURIComponent(sym)}.json`);
        const { source: _s, priceBasis: _p, ...clean } = raw;
        writeJson(path.join(STOCKS_DIR, `${sym}.json`), clean);
      })
    );
    okCount += results.filter((r) => r.status === "fulfilled").length;
  }

  console.log(`Sync complete! Saved ${okCount}/${symbolSet.length} full stock files + indices + summary + chips.`);
}

run().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
