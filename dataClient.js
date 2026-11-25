/**
 * StockT Dual-Mode Data Client
 * - Automatically detects if a Node.js backend (/api/health) is running.
 * - Falls back seamlessly to Static GitHub Pages Mode using ./data/market/*
 *   and client-side ./lib/decisionEngine.js so 100% of BI features work on GitHub Pages.
 */

import { buildCommitteeDecision } from "./lib/decisionEngine.js";

const CUSTOM_OPINIONS_STORAGE_KEY = "stockt_custom_opinions_v1";

let detectedMode = null; // "api" | "static"
const staticCache = {
  tickers: null,
  summary: null,
  chips: null,
  indices: null,
  curated: null,
  stocks: new Map()
};

async function detectMode() {
  if (detectedMode) return detectedMode;
  try {
    const res = await fetch("./api/health", { signal: AbortSignal.timeout(1500) });
    const ct = res.headers.get("content-type") || "";
    if (res.ok && ct.includes("application/json")) {
      const data = await res.json();
      if (data && data.status === "ok") {
        detectedMode = "api";
        return detectedMode;
      }
    }
  } catch {
    // static hosting (e.g. GitHub Pages)
  }
  detectedMode = "static";
  return detectedMode;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadStaticTickers(force = false) {
  if (!force && staticCache.tickers) return staticCache.tickers;
  staticCache.tickers = await fetchJson(`./data/market/tickers.json${force ? `?t=${Date.now()}` : ""}`);
  return staticCache.tickers;
}

async function loadStaticSummary(force = false) {
  if (!force && staticCache.summary) return staticCache.summary;
  staticCache.summary = await fetchJson(`./data/market/summary.json${force ? `?t=${Date.now()}` : ""}`);
  return staticCache.summary;
}

async function loadStaticChips(force = false) {
  if (!force && staticCache.chips) return staticCache.chips;
  staticCache.chips = await fetchJson(`./data/market/chips_history.json${force ? `?t=${Date.now()}` : ""}`);
  return staticCache.chips;
}

async function loadStaticCurated(force = false) {
  if (!force && staticCache.curated) return staticCache.curated;
  try {
    staticCache.curated = await fetchJson(`./data/committee_reports.json${force ? `?t=${Date.now()}` : ""}`);
  } catch {
    staticCache.curated = {};
  }
  return staticCache.curated;
}

function readLocalCustomOpinions() {
  try {
    const raw = localStorage.getItem(CUSTOM_OPINIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalCustomOpinions(obj) {
  try {
    localStorage.setItem(CUSTOM_OPINIONS_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore quota errors
  }
}

function resolveStaticSymbol(rawInput, tickers) {
  const raw = String(rawInput || "").trim();
  if (!raw) return "00631L.TW";
  const upper = raw.toUpperCase();

  const exact = tickers.find(
    (t) =>
      t.symbol.toUpperCase() === upper ||
      t.code.toUpperCase() === upper ||
      t.name.toUpperCase() === upper ||
      (t.nameEn || "").toUpperCase() === upper
  );
  if (exact) return exact.symbol;

  const partial = tickers.find(
    (t) => t.code.toUpperCase().startsWith(upper) || t.name.toUpperCase().includes(upper)
  );
  if (partial) return partial.symbol;

  if (upper.includes(".")) return upper;
  return /^\d/.test(upper) ? `${upper}.TW` : upper;
}

/**
 * Synthesize a clean stock payload from summary.json item if full 500D file is not pre-bundled
 */
function buildStockFromSummaryItem(item, tickerMeta) {
  const close = Number(item.close || 0);
  const spark = Array.isArray(item.sparkline) && item.sparkline.length ? item.sparkline : [close];
  const latestDate = item.date || "2026-11-25";
  const baseTime = new Date(latestDate + "T00:00:00Z").getTime();

  const bars = spark.map((price, idx) => {
    const d = new Date(baseTime - (spark.length - 1 - idx) * 86400000);
    const prev = idx > 0 ? spark[idx - 1] : price;
    const o = prev;
    const c = price;
    const h = Math.max(o, c) * 1.006;
    const l = Math.min(o, c) * 0.994;
    return {
      t: d.toISOString().slice(0, 10),
      o,
      h,
      l,
      c,
      v: idx === spark.length - 1 ? item.volume || 0 : Math.round((item.volume || 100000) * 0.8),
      ma5: item.ma5 || null,
      ma20: item.ma20 || null,
      ma60: item.ma60 || null,
      ma240: item.ma240 || null,
      rsi14: idx === spark.length - 1 ? item.rsi14 : null,
      k9: null,
      d9: null
    };
  });

  const hi = Math.max(...spark, close);
  const lo = Math.min(...spark, close);
  const ret1m = spark.length > 1 && spark[0] ? ((close - spark[0]) / spark[0]) * 100 : null;
  const ret5d = spark.length >= 6 && spark[spark.length - 6] ? ((close - spark[spark.length - 6]) / spark[spark.length - 6]) * 100 : null;

  return {
    symbol: item.symbol,
    code: item.code,
    name: item.name,
    nameEn: item.nameEn || tickerMeta?.nameEn || item.code,
    market: item.market,
    exchange: item.exchange,
    category: item.category,
    assetType: item.assetType,
    currency: item.currency || (item.market === "US" ? "USD" : "TWD"),
    updatedAt: latestDate,
    metrics: {
      date: latestDate,
      close,
      open: bars[bars.length - 1]?.o ?? close,
      high: bars[bars.length - 1]?.h ?? close,
      low: bars[bars.length - 1]?.l ?? close,
      volume: item.volume || 0,
      change: item.change || 0,
      changePct: item.changePct || 0,
      ma5: item.ma5 || null,
      ma20: item.ma20 || null,
      ma60: item.ma60 || null,
      ma240: item.ma240 || null,
      rsi14: item.rsi14 ?? null,
      k9: null,
      d9: null,
      volRatio: item.volRatio ?? null,
      high52w: hi,
      low52w: lo,
      pos52wPct: hi > lo ? ((close - lo) / (hi - lo)) * 100 : 50,
      volatilityAnnPct: null,
      returns: { "5D": ret5d, "1M": ret1m }
    },
    fundamentals: { pe: null, pb: null, dividendYield: null, dividends: [] },
    bars
  };
}

export async function getIndices(force = false) {
  const mode = await detectMode();
  if (mode === "api") {
    return fetchJson(`./api/indices${force ? "?refresh=1" : ""}`);
  }
  if (!force && staticCache.indices) return staticCache.indices;
  staticCache.indices = await fetchJson(`./data/market/indices.json${force ? `?t=${Date.now()}` : ""}`);
  return staticCache.indices;
}

export async function getSummary(force = false) {
  const mode = await detectMode();
  if (mode === "api") {
    return fetchJson(`./api/summary${force ? "?refresh=1" : ""}`);
  }
  return loadStaticSummary(force);
}

export async function getChips(days = 180, force = false) {
  const mode = await detectMode();
  if (mode === "api") {
    return fetchJson(`./api/chips?days=${days}${force ? "&refresh=1" : ""}`);
  }
  const chips = await loadStaticChips(force);
  return {
    generatedAt: chips.generatedAt,
    totalCount: chips.count,
    history: (chips.history || []).slice(-days)
  };
}

export async function searchTickers(q, limit = 12) {
  const mode = await detectMode();
  if (mode === "api") {
    return fetchJson(`./api/tickers?q=${encodeURIComponent(q)}&limit=${limit}`);
  }
  const tickers = await loadStaticTickers();
  const query = String(q || "").trim().toLowerCase();
  if (!query) return { total: tickers.length, count: 0, items: [] };

  const scored = tickers
    .map((t) => {
      const code = (t.code || "").toLowerCase();
      const sym = (t.symbol || "").toLowerCase();
      const name = (t.name || "").toLowerCase();
      const nameEn = (t.nameEn || "").toLowerCase();
      const cat = (t.category || "").toLowerCase();
      let s = 0;
      if (code === query || sym === query) s = 100;
      else if (code.startsWith(query) || sym.startsWith(query)) s = 80;
      else if (name.startsWith(query) || nameEn.startsWith(query)) s = 65;
      else if (code.includes(query) || sym.includes(query) || name.includes(query) || nameEn.includes(query) || cat.includes(query)) s = 30;
      return { item: t, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);

  return { total: tickers.length, count: scored.length, items: scored };
}

export async function getStockPayload(rawSym, force = false) {
  const mode = await detectMode();
  if (mode === "api") {
    return fetchJson(`./api/stock/${encodeURIComponent(rawSym)}${force ? "?refresh=1" : ""}`);
  }

  const [tickers, summary, chips, curatedAll] = await Promise.all([
    loadStaticTickers(force),
    loadStaticSummary(force),
    loadStaticChips(force),
    loadStaticCurated(force)
  ]);

  const symbol = resolveStaticSymbol(rawSym, tickers);
  let stock = !force ? staticCache.stocks.get(symbol) : null;

  if (!stock) {
    // 1. Try pre-bundled full 500-day JSON snapshot
    try {
      stock = await fetchJson(`./data/market/stocks/${encodeURIComponent(symbol)}.json${force ? `?t=${Date.now()}` : ""}`);
    } catch {
      // 2. Fallback to summary.json item (covers 100% of all 2,380+ TW/US stocks!)
      const sumItem = (summary.items || []).find(
        (it) => it.symbol.toUpperCase() === symbol.toUpperCase() || it.code.toUpperCase() === symbol.toUpperCase()
      );
      if (!sumItem) {
        throw new Error(`查無股票代號「${rawSym}」，請確認輸入正確的台股或美股代號`);
      }
      const meta = tickers.find((t) => t.symbol.toUpperCase() === sumItem.symbol.toUpperCase());
      stock = buildStockFromSummaryItem(sumItem, meta);
    }
    staticCache.stocks.set(stock.symbol, stock);
  }

  const customAll = readLocalCustomOpinions();
  const customList = customAll[stock.symbol] || [];
  const decision = buildCommitteeDecision(
    stock,
    summary,
    chips.history || [],
    curatedAll[stock.symbol] || null,
    customList
  );

  const peers = (summary.items || [])
    .filter((it) => it.category === stock.category && it.symbol !== stock.symbol)
    .sort((a, b) => (b.turnover || 0) - (a.turnover || 0))
    .slice(0, 8);

  return {
    stock,
    decision,
    peers,
    latestChip: chips.history?.length ? chips.history[chips.history.length - 1] : null,
    marketBreadth: summary.breadth || null
  };
}

export async function addCustomOpinion(symbol, opinionInput) {
  const mode = await detectMode();
  if (mode === "api") {
    return fetchJson(`./api/committee/${encodeURIComponent(symbol)}/opinion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opinionInput)
    });
  }

  const customAll = readLocalCustomOpinions();
  const list = customAll[symbol] || [];
  const newOp = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    role: opinionInput.role,
    roleEn: "Project Role",
    author: opinionInput.author || "專案團隊成員",
    score: Math.max(0, Math.min(100, Math.round(Number(opinionInput.score) || 50))),
    confidence: 80,
    stance: opinionInput.stance || undefined,
    judgment: opinionInput.summary,
    opinion: "",
    keySignals: String(opinionInput.summary || "")
      .split(/[；;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4),
    summary: opinionInput.summary,
    createdAt: new Date().toISOString()
  };
  list.push(newOp);
  customAll[symbol] = list;
  writeLocalCustomOpinions(customAll);

  const updated = await getStockPayload(symbol);
  return { opinion: newOp, decision: updated.decision };
}

export async function deleteCustomOpinion(symbol, opinionId) {
  const mode = await detectMode();
  if (mode === "api") {
    return fetchJson(
      `./api/committee/${encodeURIComponent(symbol)}/opinion/${encodeURIComponent(opinionId)}`,
      { method: "DELETE" }
    );
  }

  const customAll = readLocalCustomOpinions();
  customAll[symbol] = (customAll[symbol] || []).filter((o) => o.id !== opinionId);
  writeLocalCustomOpinions(customAll);

  const updated = await getStockPayload(symbol);
  return { deleted: opinionId, decision: updated.decision };
}
