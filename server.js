import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCommitteeDecision } from "./lib/decisionEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const FUNSTX_BASE = "https://data.funstx.com/data";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const CURATED_FILE = path.join(DATA_DIR, "committee_reports.json");
const CUSTOM_FILE = path.join(DATA_DIR, "custom_opinions.json");

const INDEX_SYMBOLS = ["TAIEX", "TWOII", "SOX", "IXIC", "SPX", "DJI", "N225", "KOSPI", "NIFTY"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// In-memory TTL cache for FunSTX live data
const cache = new Map();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile(filepath, fallback) {
  try {
    if (!fs.existsSync(filepath)) return fallback;
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filepath, data) {
  ensureDataDir();
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

async function fetchFunstx(endpoint, forceRefresh = false) {
  const key = endpoint;
  const now = Date.now();
  const cached = cache.get(key);
  if (!forceRefresh && cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${FUNSTX_BASE}/${endpoint.replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "StockT-BI-Proxy/1.0",
      Origin: "https://funstx.com",
      Referer: "https://funstx.com/"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const err = new Error(`找不到標的資料或行情暫時無法取得 (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }

  const data = await res.json();
  cache.set(key, { ts: now, data });
  return data;
}

async function resolveSymbol(rawInput, forceRefresh = false) {
  const raw = decodeURIComponent(rawInput || "").trim();
  if (!raw) return "2330.TW";
  const upper = raw.toUpperCase();

  try {
    const tickers = await fetchFunstx("tickers.json", forceRefresh);
    const exact = tickers.find(
      (t) =>
        t.symbol.toUpperCase() === upper ||
        t.code.toUpperCase() === upper ||
        t.name.toUpperCase() === upper ||
        (t.nameEn || "").toUpperCase() === upper
    );
    if (exact) return exact.symbol;

    // Secondary fuzzy match for partial name or symbol
    const partial = tickers.find(
      (t) =>
        t.code.toUpperCase().startsWith(upper) ||
        t.name.toUpperCase().includes(upper)
    );
    if (partial) return partial.symbol;
  } catch {
    // fallback below
  }

  if (upper.includes(".")) return upper;
  return /^\d/.test(upper) ? `${upper}.TW` : upper;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(reqPath, res) {
  const cleanPath = reqPath === "/" ? "/index.html" : reqPath;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA fallback to index.html
      const fallback = path.join(PUBLIC_DIR, "index.html");
      if (fs.existsSync(fallback)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(fallback).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(fullPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const forceRefresh = parsedUrl.searchParams.get("refresh") === "1";

  // CORS headers for API convenience
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (pathname === "/api/health") {
      return sendJson(res, 200, {
        status: "ok",
        cachedKeys: cache.size,
        serverTime: new Date().toISOString()
      });
    }

    if (pathname === "/api/tickers" && req.method === "GET") {
      const tickers = await fetchFunstx("tickers.json", forceRefresh);
      const q = (parsedUrl.searchParams.get("q") || "").trim().toLowerCase();
      const market = (parsedUrl.searchParams.get("market") || "").trim().toUpperCase();
      const assetType = (parsedUrl.searchParams.get("assetType") || "").trim().toUpperCase();
      const limit = Math.min(Number(parsedUrl.searchParams.get("limit") || 40), 2500);

      let list = tickers;
      if (market) list = list.filter((t) => (t.market || "").toUpperCase() === market);
      if (assetType) list = list.filter((t) => (t.assetType || "").toUpperCase() === assetType);

      if (q) {
        const scored = list
          .map((t) => {
            const code = (t.code || "").toLowerCase();
            const sym = (t.symbol || "").toLowerCase();
            const name = (t.name || "").toLowerCase();
            const nameEn = (t.nameEn || "").toLowerCase();
            const cat = (t.category || "").toLowerCase();
            let s = 0;
            if (code === q || sym === q) s = 100;
            else if (code.startsWith(q) || sym.startsWith(q)) s = 80;
            else if (name.startsWith(q) || nameEn.startsWith(q)) s = 65;
            else if (code.includes(q) || sym.includes(q) || name.includes(q) || nameEn.includes(q) || cat.includes(q)) s = 30;
            return { item: t, s };
          })
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, limit)
          .map((x) => x.item);
        return sendJson(res, 200, { total: tickers.length, count: scored.length, items: scored });
      }

      return sendJson(res, 200, {
        total: tickers.length,
        count: Math.min(list.length, limit),
        items: list.slice(0, limit)
      });
    }

    if (pathname === "/api/summary" && req.method === "GET") {
      const summary = await fetchFunstx("summary.json", forceRefresh);
      const { site: _ignoredSite, ...cleanSummary } = summary;
      return sendJson(res, 200, cleanSummary);
    }

    if (pathname === "/api/indices" && req.method === "GET") {
      const results = await Promise.allSettled(
        INDEX_SYMBOLS.map((sym) => fetchFunstx(`indices/${encodeURIComponent(sym)}.json`, forceRefresh))
      );
      const items = results
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
      return sendJson(res, 200, { count: items.length, items });
    }

    if (pathname === "/api/chips" && req.method === "GET") {
      const chips = await fetchFunstx("chips_history.json", forceRefresh);
      const days = Math.min(Number(parsedUrl.searchParams.get("days") || 180), 600);
      return sendJson(res, 200, {
        generatedAt: chips.generatedAt,
        totalCount: chips.count,
        history: (chips.history || []).slice(-days)
      });
    }

    if (pathname.startsWith("/api/stock/") && req.method === "GET") {
      const rawSym = pathname.slice("/api/stock/".length);
      let symbol = await resolveSymbol(rawSym, forceRefresh);

      let stockRaw;
      try {
        stockRaw = await fetchFunstx(`stocks/${encodeURIComponent(symbol)}.json`, forceRefresh);
      } catch (e) {
        if (symbol.endsWith(".TW") && e.statusCode === 404) {
          symbol = symbol.replace(/\.TW$/, ".TWO");
          stockRaw = await fetchFunstx(`stocks/${encodeURIComponent(symbol)}.json`, forceRefresh);
        } else {
          const notFoundErr = new Error(`查無股票代號「${decodeURIComponent(rawSym)}」，請確認輸入正確的台股或美股代號`);
          notFoundErr.statusCode = 404;
          throw notFoundErr;
        }
      }

      const { source: _ignoredSource, priceBasis: _ignoredBasis, ...stock } = stockRaw;

      const [summary, chips] = await Promise.all([
        fetchFunstx("summary.json", forceRefresh).catch(() => null),
        fetchFunstx("chips_history.json", forceRefresh).catch(() => null)
      ]);

      const curatedAll = readJsonFile(CURATED_FILE, {});
      const customAll = readJsonFile(CUSTOM_FILE, {});
      const curated = curatedAll[symbol] || null;
      const customList = customAll[symbol] || [];

      const decision = buildCommitteeDecision(
        stock,
        summary,
        chips?.history || [],
        curated,
        customList
      );

      // Find peers in the same category from summary.json
      const peers = (summary?.items || [])
        .filter((it) => it.category === stock.category && it.symbol !== stock.symbol)
        .sort((a, b) => (b.turnover || 0) - (a.turnover || 0))
        .slice(0, 8);

      return sendJson(res, 200, {
        stock,
        decision,
        peers,
        latestChip: chips?.history?.length ? chips.history[chips.history.length - 1] : null,
        marketBreadth: summary?.breadth || null
      });
    }

    // Add a custom role opinion for a stock
    const opinionMatch = pathname.match(/^\/api\/committee\/([^/]+)\/opinion(?:\/([^/]+))?$/);
    if (opinionMatch) {
      const symbol = await resolveSymbol(opinionMatch[1]);
      const opinionId = opinionMatch[2] ? decodeURIComponent(opinionMatch[2]) : null;

      if (req.method === "POST") {
        const body = await readRequestBody(req);
        const role = String(body.role || "").trim();
        const summaryText = String(body.summary || "").trim();
        const score = Number(body.score);
        if (!role || !summaryText || !Number.isFinite(score)) {
          return sendJson(res, 400, { error: "請填寫角色名稱、評分 (0-100) 與核心意見內容" });
        }

        const customAll = readJsonFile(CUSTOM_FILE, {});
        const list = customAll[symbol] || [];
        const newOp = {
          id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          role,
          roleEn: String(body.roleEn || "Project Role").trim(),
          author: String(body.author || "專案團隊成員").trim(),
          score: Math.max(0, Math.min(100, Math.round(score))),
          confidence: Math.max(0, Math.min(100, Math.round(Number(body.confidence) || 80))),
          stance: String(body.stance || "").trim() || undefined,
          keySignals: Array.isArray(body.keySignals)
            ? body.keySignals.map((s) => String(s).trim()).filter(Boolean)
            : summaryText
                .split(/[；;\n]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 4),
          summary: summaryText,
          createdAt: new Date().toISOString()
        };
        list.push(newOp);
        customAll[symbol] = list;
        writeJsonFile(CUSTOM_FILE, customAll);

        const [stock, summary, chips] = await Promise.all([
          fetchFunstx(`stocks/${encodeURIComponent(symbol)}.json`),
          fetchFunstx("summary.json").catch(() => null),
          fetchFunstx("chips_history.json").catch(() => null)
        ]);
        const curatedAll = readJsonFile(CURATED_FILE, {});
        const decision = buildCommitteeDecision(stock, summary, chips?.history || [], curatedAll[symbol] || null, list);
        return sendJson(res, 201, { opinion: newOp, decision });
      }

      if (req.method === "DELETE" && opinionId) {
        const customAll = readJsonFile(CUSTOM_FILE, {});
        const list = (customAll[symbol] || []).filter((o) => o.id !== opinionId);
        customAll[symbol] = list;
        writeJsonFile(CUSTOM_FILE, customAll);

        const [stock, summary, chips] = await Promise.all([
          fetchFunstx(`stocks/${encodeURIComponent(symbol)}.json`),
          fetchFunstx("summary.json").catch(() => null),
          fetchFunstx("chips_history.json").catch(() => null)
        ]);
        const curatedAll = readJsonFile(CURATED_FILE, {});
        const decision = buildCommitteeDecision(stock, summary, chips?.history || [], curatedAll[symbol] || null, list);
        return sendJson(res, 200, { deleted: opinionId, decision });
      }
    }

    // Serve static frontend assets
    if (req.method === "GET") {
      return serveStatic(pathname, res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    sendJson(res, status, { error: err.message || "Internal Server Error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`StockT BI Server listening on http://0.0.0.0:${PORT}`);
});
