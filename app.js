import {
  renderKlineChart,
  renderDcaChart,
  renderChipsFlowChart,
  renderFuturesMarginChart
} from "./charts.js";
import {
  getIndices,
  getSummary,
  getChips,
  searchTickers,
  getStockPayload,
  addCustomOpinion,
  deleteCustomOpinion
} from "./dataClient.js";

const state = {
  symbol: "2330.TW",
  activeTab: "decision",
  klineDays: 120,
  subMode: "volume",
  showMA: { ma5: true, ma20: true, ma60: true, ma240: true },
  chipsDays: 60,
  screenerMode: "turnover",
  stockPayload: null,
  summaryData: null,
  chipsData: null,
  indicesData: null,
  searchTimer: null,
  searchResults: [],
  searchIndex: -1
};

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "--";
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtSigned(v, digits = 2, suffix = "") {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "--";
  const n = Number(v);
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtNum(n, digits)}${suffix}`;
}

function fmtVol(v, market = "TW") {
  if (!Number.isFinite(Number(v))) return "--";
  const n = Number(v);
  if (market === "TW") {
    const lots = n / 1000;
    if (lots >= 10000) return `${(lots / 10000).toFixed(2)}萬張`;
    return `${Math.round(lots).toLocaleString()}張`;
  }
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function chgClass(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "text-flat";
  return n > 0 ? "text-up" : "text-down";
}

function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ==========================================================================
   Global Indices Ticker Strip
   ========================================================================== */
async function loadIndices(force = false) {
  try {
    const data = await getIndices(force);
    state.indicesData = data.items || [];
    renderIndices();
  } catch (err) {
    $("indices-strip-inner").innerHTML = `<div class="index-chip text-muted">大盤指數載入失敗：${escapeHtml(err.message)}</div>`;
  }
}

function renderIndices() {
  const wrap = $("indices-strip-inner");
  if (!state.indicesData?.length) return;
  wrap.innerHTML = state.indicesData
    .map((idx) => {
      const m = idx.metrics || {};
      const cls = chgClass(m.changePct);
      return `
        <div class="index-chip" title="${escapeHtml(idx.name)} (${escapeHtml(m.date || "")})">
          <span class="index-chip-name">${escapeHtml(idx.nameEn || idx.symbol)}</span>
          <span class="index-chip-val">${fmtNum(m.close, 2)}</span>
          <span class="mono ${cls}" style="font-weight:600;">${fmtSigned(m.changePct, 2, "%")}</span>
        </div>
      `;
    })
    .join("");
}

/* ==========================================================================
   Individual Stock + Committee Decision Loader
   ========================================================================== */
async function loadStock(symbol, force = false) {
  const target = (symbol || "00631L.TW").trim();
  state.symbol = target;
  window.history.replaceState(null, "", `#${encodeURIComponent(target)}`);
  updateWatchlistActive(target);

  $("leader-verdict").textContent = `正在即時擷取 ${target} 歷史行情與多角色分析...`;
  try {
    const payload = await getStockPayload(target, force);
    state.stockPayload = payload;
    state.symbol = payload.stock.symbol;
    updateWatchlistActive(payload.stock.symbol);
    saveRecentQuery(payload.stock.symbol, payload.stock.code, payload.stock.name);

    renderStockHero(payload.stock);
    renderDecision(payload.decision, payload.stock);
    renderMainKline();
    renderReturns(payload.stock);
    renderDca();
    renderRoles(payload.decision);
    renderPeers(payload.peers || []);

    if (payload.stock.metrics?.date) {
      $("latest-date-label").textContent = payload.stock.metrics.date;
    }
  } catch (err) {
    showToast(`無法載入 ${target}：${err.message}`);
    $("leader-verdict").textContent = `查詢失敗：${err.message}`;
  }
}

function updateWatchlistActive(sym) {
  document.querySelectorAll(".watch-pill").forEach((btn) => {
    const s = btn.dataset.symbol;
    btn.classList.toggle("active", s && s.toUpperCase() === sym.toUpperCase());
  });
}

function renderStockHero(stock) {
  const m = stock.metrics || {};
  const f = stock.fundamentals || {};
  const close = Number(m.close || 0);

  $("stock-heading").textContent = `${stock.code} ${stock.name}`;
  $("stock-symbol-badge").textContent = stock.symbol;
  $("stock-category-badge").textContent = stock.category || stock.assetType || "STOCK";
  $("stock-exchange-badge").textContent = `${stock.exchange || stock.market}`;
  $("stock-currency").textContent = stock.currency || "TWD";

  const priceEl = $("stock-price");
  priceEl.textContent = fmtNum(close, close >= 1000 ? 1 : 2);
  priceEl.className = `stock-price mono ${chgClass(m.change)}`;

  const chgEl = $("stock-change");
  chgEl.textContent = `${fmtSigned(m.change, 2)} (${fmtSigned(m.changePct, 2, "%")})`;
  chgEl.className = `stock-change mono ${chgClass(m.change)}`;

  // 52W Range
  const pos52 = Math.max(0, Math.min(100, Number(m.pos52wPct ?? 50)));
  $("low-52w").textContent = fmtNum(m.low52w, 2);
  $("high-52w").textContent = fmtNum(m.high52w, 2);
  $("pos-52w").textContent = `${pos52.toFixed(1)}%`;
  $("range-52w-fill").style.width = `${pos52}%`;
  $("range-52w-dot").style.left = `${pos52}%`;

  // KPI Grid
  $("kpi-vol").textContent = fmtVol(m.volume, stock.market);
  $("kpi-volratio").textContent = `量比 ${m.volRatio != null ? Number(m.volRatio).toFixed(2) + "x" : "--"}`;

  $("kpi-pe").textContent = f.pe ? `${fmtNum(f.pe, 2)}x` : "N/A";
  $("kpi-pb").textContent = f.pb ? `P/B ${fmtNum(f.pb, 2)}x` : "P/B --";

  $("kpi-dy").textContent = f.dividendYield ? `${fmtNum(f.dividendYield, 2)}%` : "--";
  $("kpi-volann").textContent = `年化波動 ${m.volatilityAnnPct != null ? fmtNum(m.volatilityAnnPct, 1) + "%" : "--"}`;

  $("kpi-rsi").textContent = m.rsi14 != null ? fmtNum(m.rsi14, 1) : "--";
  $("kpi-kd").textContent = m.k9 != null ? `K ${fmtNum(m.k9, 1)} / D ${fmtNum(m.d9, 1)}` : "K/D --";

  const maList = [
    ["ma5", m.ma5],
    ["ma20", m.ma20],
    ["ma60", m.ma60],
    ["ma240", m.ma240]
  ];
  for (const [k, val] of maList) {
    $(`kpi-${k}`).textContent = val ? fmtNum(val, val >= 1000 ? 1 : 2) : "--";
    const diffEl = $(`kpi-${k}-diff`);
    if (val && close) {
      const diffPct = ((close - val) / val) * 100;
      diffEl.textContent = `乖離 ${fmtSigned(diffPct, 2, "%")}`;
      diffEl.className = `kpi-sub mono ${chgClass(diffPct)}`;
    } else {
      diffEl.textContent = "--";
      diffEl.className = "kpi-sub mono";
    }
  }
}

function renderDecision(decision, stock) {
  const score = Number(decision.compositeScore || 50);
  const circum = 2 * Math.PI * 56;
  const offset = circum * (1 - score / 100);
  const arc = $("gauge-arc");
  arc.style.strokeDasharray = String(circum.toFixed(2));
  arc.style.strokeDashoffset = String(offset.toFixed(2));
  arc.style.stroke =
    score >= 62 ? "var(--up)" : score >= 48 ? "var(--accent)" : score >= 35 ? "var(--warn)" : "var(--down)";

  $("gauge-score-text").textContent = String(score);
  $("leader-headline").textContent = decision.leader?.headline || `${stock.code} ${stock.name} 團隊決策`;
  $("leader-meta").textContent = `基準日 ${decision.evaluatedDate} · 參與匯總角色共 ${decision.roles.length} 位${
    decision.customOpinionCount ? `（含 ${decision.customOpinionCount} 筆專案自訂意見）` : ""
  }`;

  const modeBadge = $("decision-mode-badge");
  modeBadge.textContent = decision.isCuratedTeamReport
    ? "六角色獨立交叉審查報告"
    : "六角色量化即時審查模型";

  const stanceBadge = $("leader-stance-badge");
  stanceBadge.textContent = decision.stance;
  stanceBadge.className = `badge ${
    decision.tone === "bull"
      ? "badge-up"
      : decision.tone === "bear"
        ? "badge-down"
        : decision.tone === "warn"
          ? "badge-warn"
          : "badge-accent"
  }`;

  $("leader-verdict").textContent = decision.leader?.verdict || "";
  $("leader-actions").innerHTML = (decision.leader?.actionSteps || [])
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("");
  $("leader-dissent").innerHTML = `<strong>班長分歧調解備註：</strong>${escapeHtml(decision.leader?.dissentNote || "")}`;

  const tp = decision.tradePlan || {};
  $("tp-maxpos").textContent = tp.maxPositionPct != null ? `${tp.maxPositionPct}% 總資金` : "--";
  $("tp-entry").textContent = tp.entryLow && tp.entryHigh ? `${fmtNum(tp.entryLow, 0)} – ${fmtNum(tp.entryHigh, 0)}` : "--";
  $("tp-stop").textContent = tp.stopLoss ? fmtNum(tp.stopLoss, 0) : "--";
  $("tp-t1").textContent = tp.target1 ? fmtNum(tp.target1, 0) : "--";
  $("tp-t2").textContent = tp.target2 ? fmtNum(tp.target2, 0) : "--";
}

function renderMainKline() {
  if (!state.stockPayload?.stock) return;
  const { stock, decision } = state.stockPayload;
  const tp = decision?.tradePlan || {};
  const style = getComputedStyle(document.documentElement);
  const refLines = [];
  if (tp.stopLoss) refLines.push({ price: tp.stopLoss, label: "停損", color: style.getPropertyValue("--down").trim() });
  if (tp.target1) refLines.push({ price: tp.target1, label: "壓力1", color: style.getPropertyValue("--up").trim() });
  if (tp.entryLow) refLines.push({ price: tp.entryLow, label: "支撐", color: style.getPropertyValue("--accent").trim() });

  renderKlineChart($("kline-canvas"), $("kline-tooltip"), stock.bars || [], {
    days: state.klineDays,
    subMode: state.subMode,
    showMA: state.showMA,
    refLines
  });
}

function renderReturns(stock) {
  const ret = stock.metrics?.returns || {};
  const keys = ["5D", "1M", "3M", "6M", "YTD", "1Y"];
  $("returns-grid").innerHTML = keys
    .map((k) => {
      const val = ret[k];
      return `
        <div class="return-tile">
          <div class="return-tile-period">${k}</div>
          <div class="return-tile-val mono ${chgClass(val)}">${val != null ? fmtSigned(val, 2, "%") : "--"}</div>
        </div>
      `;
    })
    .join("");
}

function renderDca() {
  const bars = state.stockPayload?.stock?.bars || [];
  if (bars.length < 5) return;
  const amount = Math.max(100, Number($("dca-amount").value || 10000));
  const step = Math.max(1, Number($("dca-freq").value || 21));

  let invested = 0;
  let shares = 0;
  const points = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i % step === 0 && b.c > 0) {
      invested += amount;
      shares += amount / b.c;
    }
    points.push({ date: b.t, invested, value: shares * b.c });
  }

  renderDcaChart($("dca-canvas"), points);

  const last = points[points.length - 1];
  const profit = last.value - last.invested;
  const roi = last.invested ? (profit / last.invested) * 100 : 0;
  const avgCost = shares ? last.invested / shares : 0;

  $("dca-stats").innerHTML = `
    <div class="dca-stat">
      <div class="kpi-label">累積投入本金</div>
      <div class="mono" style="font-weight:700;">${fmtNum(last.invested, 0)}</div>
    </div>
    <div class="dca-stat">
      <div class="kpi-label">期末資產市值</div>
      <div class="mono ${chgClass(profit)}" style="font-weight:700;">${fmtNum(last.value, 0)}</div>
    </div>
    <div class="dca-stat">
      <div class="kpi-label">累積報酬率</div>
      <div class="mono ${chgClass(roi)}" style="font-weight:700;">${fmtSigned(roi, 2, "%")}</div>
    </div>
    <div class="dca-stat">
      <div class="kpi-label">平均持股成本</div>
      <div class="mono" style="font-weight:700;">${fmtNum(avgCost, 2)}</div>
    </div>
  `;
}

function renderRoles(decision) {
  const tallyEl = $("cross-review-tally");
  if (tallyEl && decision.crossReviewTally) {
    const t = decision.crossReviewTally;
    tallyEl.innerHTML = `
      <span class="badge badge-up mono">偏多 ${t.bull} 位</span>
      <span class="badge badge-warn mono">中性／等待 ${t.neutral + t.warn} 位</span>
      <span class="badge badge-down mono">偏空／保守 ${t.bear} 位</span>
    `;
  }

  const grid = $("roles-grid");
  grid.innerHTML = (decision.roles || [])
    .map((r, idx) => {
      const scoreCol =
        r.score >= 62 ? "var(--up)" : r.score >= 48 ? "var(--accent)" : r.score >= 35 ? "var(--warn)" : "var(--down)";
      const badgeCls =
        r.tone === "bull" ? "badge-up" : r.tone === "bear" ? "badge-down" : r.tone === "warn" ? "badge-warn" : "badge-accent";
      const roleNum = r.roleIndex || idx + 1;
      const sourceLabel =
        r.sourceType === "CURATED_COMMITTEE"
          ? "獨立交叉審查立場"
          : r.sourceType === "USER_TEAM_INPUT"
            ? `專案自訂 (${escapeHtml(r.author || "成員")})`
            : "量化即時審查";
      const delBtn =
        r.sourceType === "USER_TEAM_INPUT"
          ? `<button type="button" class="btn btn-sm btn-danger" data-delete-opinion="${escapeHtml(r.id)}">移除</button>`
          : "";

      const judgmentText = r.judgment || r.summary || "";
      const opinionText = r.opinion || "";

      return `
        <article class="role-card">
          <div class="role-head">
            <div>
              <div class="role-index-tag">角色 ${roleNum}</div>
              <h3 class="role-name">${escapeHtml(r.role)}</h3>
              <div class="role-en">${escapeHtml(r.roleEn || "")} · ${sourceLabel}</div>
            </div>
            <div class="role-score-box">
              <div class="role-score-num mono" style="color:${scoreCol};">${r.score}<span style="font-size:11.5px;color:var(--text-muted);font-weight:500;">/100</span></div>
              <div style="margin-top:5px;display:flex;gap:6px;justify-content:flex-end;align-items:center;">
                <span class="badge ${badgeCls}">${escapeHtml(r.stance)}</span>
                ${delBtn}
              </div>
            </div>
          </div>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width:${r.score}%;background:${scoreCol};"></div>
          </div>
          <div class="role-kv">
            ${judgmentText ? `<p class="role-judgment"><span class="role-kv-label">判斷</span>${escapeHtml(judgmentText)}</p>` : ""}
            ${opinionText ? `<p class="role-opinion"><span class="role-kv-label">意見</span>${escapeHtml(opinionText)}</p>` : ""}
          </div>
          <ul class="signal-list">
            ${(r.keySignals || []).map((sig) => `<li>${escapeHtml(sig)}</li>`).join("")}
          </ul>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-delete-opinion]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteOpinion;
      try {
        const res = await deleteCustomOpinion(state.symbol, id);
        state.stockPayload.decision = res.decision;
        renderDecision(res.decision, state.stockPayload.stock);
        renderRoles(res.decision);
        renderMainKline();
        showToast("已移除該角色意見並重算班長決策");
      } catch (err) {
        showToast(`移除失敗：${err.message}`);
      }
    });
  });
}

function renderPeers(peers) {
  const tbody = $("peers-tbody");
  if (!peers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center;">暫無同板塊比較資料</td></tr>`;
    return;
  }
  tbody.innerHTML = peers
    .map((p) => {
      const ma240Diff = p.ma240 ? ((p.close - p.ma240) / p.ma240) * 100 : null;
      return `
        <tr data-jump-symbol="${escapeHtml(p.symbol)}">
          <td class="mono" style="font-weight:700;">${escapeHtml(p.code)}</td>
          <td>${escapeHtml(p.name)}</td>
          <td class="num">${fmtNum(p.close, 2)}</td>
          <td class="num ${chgClass(p.changePct)}" style="font-weight:700;">${fmtSigned(p.changePct, 2, "%")}</td>
          <td class="num">${p.volRatio != null ? fmtNum(p.volRatio, 2) + "x" : "--"}</td>
          <td class="num">${p.rsi14 != null ? fmtNum(p.rsi14, 1) : "--"}</td>
          <td class="num ${chgClass(ma240Diff)}">${ma240Diff != null ? fmtSigned(ma240Diff, 2, "%") : "--"}</td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-jump-symbol]").forEach((tr) => {
    tr.addEventListener("click", () => {
      loadStock(tr.dataset.jumpSymbol);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ==========================================================================
   View 2: Market Chips BI
   ========================================================================== */
async function loadChips(force = false) {
  try {
    const data = await getChips(180, force);
    state.chipsData = data.history || [];
    renderChipsView();
  } catch (err) {
    showToast(`籌碼資料載入失敗：${err.message}`);
  }
}

function renderChipsView() {
  const hist = state.chipsData || [];
  if (!hist.length) return;
  const last = hist[hist.length - 1];
  const slice = hist.slice(-state.chipsDays);

  const maintColor = last.margin.maintRatio < 155 ? "text-up" : last.margin.maintRatio < 166 ? "text-warn" : "text-down";
  $("chips-kpi-row").innerHTML = `
    <div class="card">
      <div class="kpi-label">三大法人現貨合計 (${escapeHtml(last.date)})</div>
      <div class="mono ${chgClass(last.inst.total)}" style="font-size:22px;font-weight:800;margin-top:4px;">${fmtSigned(last.inst.total, 2, " 億")}</div>
      <div class="kpi-sub mono">自營商 ${fmtSigned(last.inst.dealer, 1, " 億")}</div>
    </div>
    <div class="card">
      <div class="kpi-label">外資現貨買賣超</div>
      <div class="mono ${chgClass(last.inst.foreign)}" style="font-size:22px;font-weight:800;margin-top:4px;">${fmtSigned(last.inst.foreign, 2, " 億")}</div>
      <div class="kpi-sub mono">加權 ${fmtNum(last.taiex.close, 0)} (${fmtSigned(last.taiex.changePct, 2, "%")})</div>
    </div>
    <div class="card">
      <div class="kpi-label">投信現貨買賣超</div>
      <div class="mono ${chgClass(last.inst.trust)}" style="font-size:22px;font-weight:800;margin-top:4px;">${fmtSigned(last.inst.trust, 2, " 億")}</div>
      <div class="kpi-sub mono">內資護盤動向</div>
    </div>
    <div class="card">
      <div class="kpi-label">外資台指期未平倉淨口數</div>
      <div class="mono ${chgClass(last.futures.foreignNet)}" style="font-size:22px;font-weight:800;margin-top:4px;">${last.futures.foreignNet.toLocaleString()} 口</div>
      <div class="kpi-sub mono">單日變動 ${fmtSigned(last.futures.foreignChg, 0, " 口")}</div>
    </div>
    <div class="card">
      <div class="kpi-label">上市融資維持率</div>
      <div class="mono ${maintColor}" style="font-size:22px;font-weight:800;margin-top:4px;">${fmtNum(last.margin.maintRatio, 2)}%</div>
      <div class="kpi-sub mono">融資 ${fmtNum(last.margin.balance100m, 1)}億 (${fmtSigned(last.margin.change100m, 1)})</div>
    </div>
  `;

  if (state.activeTab === "chips") {
    renderChipsFlowChart($("chips-flow-canvas"), slice);
    renderFuturesMarginChart($("chips-margin-canvas"), slice);
  }

  const recent15 = hist.slice(-15).reverse();
  $("chips-tbody").innerHTML = recent15
    .map(
      (r) => `
      <tr>
        <td class="mono">${escapeHtml(r.date)}</td>
        <td class="num">${fmtNum(r.taiex.close, 2)}</td>
        <td class="num ${chgClass(r.taiex.changePct)}" style="font-weight:700;">${fmtSigned(r.taiex.changePct, 2, "%")}</td>
        <td class="num ${chgClass(r.inst.foreign)}">${fmtSigned(r.inst.foreign, 2)}</td>
        <td class="num ${chgClass(r.inst.trust)}">${fmtSigned(r.inst.trust, 2)}</td>
        <td class="num ${chgClass(r.inst.dealer)}">${fmtSigned(r.inst.dealer, 2)}</td>
        <td class="num ${chgClass(r.inst.total)}" style="font-weight:700;">${fmtSigned(r.inst.total, 2)}</td>
        <td class="num ${chgClass(r.futures.foreignNet)}">${r.futures.foreignNet.toLocaleString()}</td>
        <td class="num">${fmtNum(r.margin.balance100m, 2)}</td>
        <td class="num ${r.margin.maintRatio < 155 ? "text-up" : r.margin.maintRatio < 165 ? "text-warn" : ""}" style="font-weight:700;">${fmtNum(r.margin.maintRatio, 2)}%</td>
      </tr>
    `
    )
    .join("");
}

/* ==========================================================================
   View 3: Market Breadth, Heatmap & Multi-Mode Screener
   ========================================================================== */
async function loadSummary(force = false) {
  try {
    state.summaryData = await getSummary(force);
    if (state.summaryData.latestTradingDate) {
      $("latest-date-label").textContent = state.summaryData.latestTradingDate;
    }
    renderMarketView();
  } catch (err) {
    showToast(`全市場資料載入失敗：${err.message}`);
  }
}

function heatBgColor(pct) {
  const isUs = document.documentElement.dataset.colorMode === "us";
  const intensity = Math.min(1, Math.abs(pct) / 7);
  const alpha = (0.18 + intensity * 0.52).toFixed(2);
  if (pct === 0) return "rgba(148, 163, 184, 0.16)";
  const upRgb = isUs ? "16, 185, 129" : "239, 68, 68";
  const dnRgb = isUs ? "239, 68, 68" : "16, 185, 129";
  return `rgba(${pct > 0 ? upRgb : dnRgb}, ${alpha})`;
}

function renderMarketView() {
  const s = state.summaryData;
  if (!s) return;
  const b = s.breadth || {};
  const total = b.total || 1;
  const upPct = ((b.advancers || 0) / total) * 100;
  const flatPct = ((b.flat || 0) / total) * 100;
  const dnPct = ((b.decliners || 0) / total) * 100;

  $("breadth-subtitle").textContent = `資料基準日 ${s.latestTradingDate || "--"} · 統計總標的 ${total.toLocaleString()} 檔（台股 ${b.twCount || 0} · 美股 ${b.usCount || 0}）`;
  $("breadth-badges").innerHTML = `
    <span class="badge badge-up mono">上漲 ${b.advancers} (${upPct.toFixed(1)}%)</span>
    <span class="badge badge-neutral mono">平盤 ${b.flat} (${flatPct.toFixed(1)}%)</span>
    <span class="badge badge-down mono">下跌 ${b.decliners} (${dnPct.toFixed(1)}%)</span>
  `;
  $("breadth-bar").innerHTML = `
    <div style="width:${upPct}%;background:var(--up);" title="上漲 ${upPct.toFixed(1)}%"></div>
    <div style="width:${flatPct}%;background:var(--flat);" title="平盤 ${flatPct.toFixed(1)}%"></div>
    <div style="width:${dnPct}%;background:var(--down);" title="下跌 ${dnPct.toFixed(1)}%"></div>
  `;

  // Heatmap Top 36 TW stocks by turnover
  const twStocks = (s.items || []).filter((x) => x.market === "TW" && x.assetType === "STOCK");
  const topHeat = [...twStocks].sort((a, b) => (b.turnover || 0) - (a.turnover || 0)).slice(0, 36);
  $("heatmap-grid").innerHTML = topHeat
    .map(
      (it) => `
      <div class="heat-tile" data-jump-symbol="${escapeHtml(it.symbol)}" style="background:${heatBgColor(it.changePct || 0)};">
        <div class="heat-tile-top">
          <span class="heat-code">${escapeHtml(it.code)}</span>
          <span class="mono" style="font-size:11px;opacity:0.85;">${it.turnover ? (it.turnover / 1e8).toFixed(0) + "億" : ""}</span>
        </div>
        <div class="heat-name">${escapeHtml(it.name)}</div>
        <div class="heat-pct">${fmtSigned(it.changePct, 2, "%")}</div>
      </div>
    `
    )
    .join("");

  $("heatmap-grid").querySelectorAll("[data-jump-symbol]").forEach((el) => {
    el.addEventListener("click", () => jumpToStock(el.dataset.jumpSymbol));
  });

  renderScreener();
}

function renderScreener() {
  const items = state.summaryData?.items || [];
  let list = [];
  switch (state.screenerMode) {
    case "turnover":
      list = items.filter((x) => x.market === "TW" && x.assetType === "STOCK").sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
      break;
    case "volRatio":
      list = items.filter((x) => x.market === "TW" && x.assetType === "STOCK" && (x.volume || 0) >= 1000000).sort((a, b) => (b.volRatio || 0) - (a.volRatio || 0));
      break;
    case "gainers":
      list = items.filter((x) => x.market === "TW" && x.assetType === "STOCK" && (x.volume || 0) >= 1000000).sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
      break;
    case "losers":
      list = items.filter((x) => x.market === "TW" && x.assetType === "STOCK" && (x.volume || 0) >= 1000000).sort((a, b) => (a.changePct || 0) - (b.changePct || 0));
      break;
    case "bullMA":
      list = items
        .filter((x) => x.market === "TW" && x.assetType === "STOCK" && (x.volume || 0) >= 1000000 && x.ma20 && x.ma60 && x.ma240 && x.close > x.ma20 && x.ma20 > x.ma60 && x.ma60 > x.ma240)
        .sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
      break;
    case "semi":
      list = items.filter((x) => x.category === "半導體業").sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
      break;
    case "etf":
      list = items.filter((x) => x.market === "TW" && x.assetType === "ETF").sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
      break;
    case "us":
      list = items.filter((x) => x.market === "US").sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
      break;
  }

  const top = list.slice(0, 25);
  $("screener-tbody").innerHTML = top
    .map(
      (it, idx) => `
      <tr data-jump-symbol="${escapeHtml(it.symbol)}">
        <td class="mono text-muted">${idx + 1}</td>
        <td class="mono" style="font-weight:700;">${escapeHtml(it.code)}</td>
        <td>${escapeHtml(it.name)}</td>
        <td><span class="badge badge-neutral">${escapeHtml(it.category || it.market)}</span></td>
        <td class="num">${fmtNum(it.close, 2)}</td>
        <td class="num ${chgClass(it.changePct)}" style="font-weight:700;">${fmtSigned(it.changePct, 2, "%")}</td>
        <td class="num">${it.volRatio != null ? fmtNum(it.volRatio, 2) + "x" : "--"}</td>
        <td class="num">${it.turnover ? fmtNum(it.turnover / 1e8, 1) : "--"}</td>
        <td class="num">${it.rsi14 != null ? fmtNum(it.rsi14, 1) : "--"}</td>
      </tr>
    `
    )
    .join("");

  $("screener-tbody").querySelectorAll("tr[data-jump-symbol]").forEach((tr) => {
    tr.addEventListener("click", () => jumpToStock(tr.dataset.jumpSymbol));
  });
}

function jumpToStock(symbol) {
  switchTab("decision");
  loadStock(symbol);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ==========================================================================
   Dynamic Stock Ticker Query (Topbar + Dedicated Direct Query Bar + Recent)
   ========================================================================== */
const RECENT_KEY = "stockt_recent_queries";

function getRecentQueries() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRecentQuery(symbol, code, name) {
  try {
    const cur = getRecentQueries().filter((x) => x.symbol !== symbol);
    const next = [{ symbol, code: code || symbol, name: name || "" }, ...cur].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    renderRecentQueries();
  } catch {
    // ignore storage errors
  }
}

function renderRecentQueries() {
  const wrap = $("recent-queries-wrap");
  const listEl = $("recent-queries");
  if (!wrap || !listEl) return;
  const list = getRecentQueries();
  if (!list.length) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "flex";
  listEl.innerHTML = list
    .map(
      (item) => `
      <button type="button" class="watch-pill ${item.symbol.toUpperCase() === state.symbol.toUpperCase() ? "active" : ""}" data-recent-symbol="${escapeHtml(item.symbol)}">
        <span class="mono">${escapeHtml(item.code)}</span> ${escapeHtml(item.name)}
      </button>
    `
    )
    .join("");
  listEl.querySelectorAll("[data-recent-symbol]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToStock(btn.dataset.recentSymbol));
  });
}

function attachTickerSearch({ formEl, inputEl, dropdownEl, containerEl }) {
  let timer = null;
  let results = [];
  let activeIdx = -1;

  async function queryTickers(q) {
    try {
      const res = await searchTickers(q, 12);
      results = res.items || [];
      activeIdx = results.length ? 0 : -1;
      renderDropdown();
    } catch {
      dropdownEl.classList.remove("open");
    }
  }

  function submitQuery() {
    const raw = inputEl.value.trim();
    if (!raw) return;
    const exactMatch = results.find(
      (t) =>
        t.code.toLowerCase() === raw.toLowerCase() ||
        t.symbol.toLowerCase() === raw.toLowerCase() ||
        t.name.toLowerCase() === raw.toLowerCase()
    );
    const picked = exactMatch || (activeIdx >= 0 ? results[activeIdx] : null);
    const target = picked ? picked.symbol : raw;
    dropdownEl.classList.remove("open");
    inputEl.value = "";
    results = [];
    activeIdx = -1;
    jumpToStock(target);
  }

  function renderDropdown() {
    if (!results.length) {
      dropdownEl.innerHTML = `<div class="search-item text-muted">找不到相符股票，請直接按「查詢」或確認代號（如 2330、2317、NVDA）</div>`;
      dropdownEl.classList.add("open");
      return;
    }
    dropdownEl.innerHTML = results
      .map(
        (t, i) => `
        <button type="button" class="search-item ${i === activeIdx ? "active" : ""}" data-idx="${i}">
          <div class="search-item-main">
            <span class="search-item-code">${escapeHtml(t.code)}</span>
            <span class="search-item-name">${escapeHtml(t.name)}</span>
          </div>
          <div class="search-item-meta">
            <span class="badge badge-neutral">${escapeHtml(t.category || t.assetType)}</span>
            <span class="badge badge-accent mono">${escapeHtml(t.market)}</span>
          </div>
        </button>
      `
      )
      .join("");
    dropdownEl.classList.add("open");

    dropdownEl.querySelectorAll(".search-item[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = results[Number(btn.dataset.idx)];
        if (item) {
          dropdownEl.classList.remove("open");
          inputEl.value = "";
          results = [];
          activeIdx = -1;
          jumpToStock(item.symbol);
        }
      });
    });
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    submitQuery();
  });

  inputEl.addEventListener("input", () => {
    clearTimeout(timer);
    const q = inputEl.value.trim();
    if (!q) {
      results = [];
      activeIdx = -1;
      dropdownEl.classList.remove("open");
      return;
    }
    timer = setTimeout(() => queryTickers(q), 130);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) {
        activeIdx = Math.min(results.length - 1, activeIdx + 1);
        renderDropdown();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) {
        activeIdx = Math.max(0, activeIdx - 1);
        renderDropdown();
      }
    } else if (e.key === "Escape") {
      dropdownEl.classList.remove("open");
      inputEl.blur();
    }
  });

  document.addEventListener("click", (e) => {
    if (!containerEl.contains(e.target)) dropdownEl.classList.remove("open");
  });
}

function initSearch() {
  attachTickerSearch({
    formEl: $("topbar-search-form"),
    inputEl: $("stock-search-input"),
    dropdownEl: $("search-dropdown"),
    containerEl: $("search-wrap")
  });

  attachTickerSearch({
    formEl: $("direct-ticker-form"),
    inputEl: $("direct-ticker-input"),
    dropdownEl: $("direct-ticker-dropdown"),
    containerEl: $("direct-ticker-form")
  });

  renderRecentQueries();

  document.addEventListener("keydown", (e) => {
    if (
      ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") ||
      (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName))
    ) {
      e.preventDefault();
      const input = $("direct-ticker-input") && state.activeTab === "decision"
        ? $("direct-ticker-input")
        : $("stock-search-input");
      input.focus();
      input.select();
    }
  });
}

/* ==========================================================================
   Tabs, Controls & Custom Opinion Submission
   ========================================================================== */
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".view-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `view-${tab}`);
  });
  if (tab === "chips") renderChipsView();
  if (tab === "market") renderMarketView();
  if (tab === "decision") {
    renderMainKline();
    renderDca();
  }
}

function redrawAllCharts() {
  if (state.activeTab === "decision") {
    renderMainKline();
    renderDca();
  } else if (state.activeTab === "chips") {
    renderChipsView();
  } else if (state.activeTab === "market") {
    renderMarketView();
  }
}

function initEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll(".watch-pill").forEach((btn) => {
    btn.addEventListener("click", () => jumpToStock(btn.dataset.symbol));
  });

  $("range-selector").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.klineDays = Number(btn.dataset.days);
    $("range-selector").querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderMainKline();
  });

  $("subchart-selector").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.subMode = btn.dataset.sub;
    $("subchart-selector").querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderMainKline();
  });

  for (const ma of ["ma5", "ma20", "ma60", "ma240"]) {
    $(`chk-${ma}`).addEventListener("change", (e) => {
      state.showMA[ma] = e.target.checked;
      renderMainKline();
    });
  }

  $("dca-amount").addEventListener("input", renderDca);
  $("dca-freq").addEventListener("change", renderDca);

  $("chips-days-selector").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.chipsDays = Number(btn.dataset.cdays);
    $("chips-days-selector").querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderChipsView();
  });

  $("screener-mode-group").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.screenerMode = btn.dataset.mode;
    $("screener-mode-group").querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderScreener();
  });

  // Theme & Color Mode toggles
  $("btn-theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    $("btn-theme").textContent = next === "dark" ? "淺色模式" : "深色模式";
    redrawAllCharts();
  });

  $("btn-color-mode").addEventListener("click", () => {
    const cur = document.documentElement.dataset.colorMode;
    const next = cur === "tw" ? "us" : "tw";
    document.documentElement.dataset.colorMode = next;
    $("btn-color-mode").textContent = next === "tw" ? "紅漲綠跌" : "綠漲紅跌";
    redrawAllCharts();
    if (state.summaryData) renderMarketView();
  });

  // Force refresh latest data
  $("btn-refresh").addEventListener("click", async () => {
    showToast("正在重新同步最新行情與籌碼資料...");
    await Promise.all([loadIndices(true), loadStock(state.symbol, true), loadSummary(true), loadChips(true)]);
    showToast("最新市場資料同步完成");
  });

  // Custom Team Opinion Submission
  $("custom-opinion-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = $("op-role").value.trim();
    const author = $("op-author").value.trim();
    const stance = $("op-stance").value;
    const score = Number($("op-score").value);
    const summary = $("op-summary").value.trim();
    if (!role || !summary) return;

    try {
      const res = await addCustomOpinion(state.symbol, { role, author, stance, score, summary });
      state.stockPayload.decision = res.decision;
      renderDecision(res.decision, state.stockPayload.stock);
      renderRoles(res.decision);
      renderMainKline();
      $("op-role").value = "";
      $("op-summary").value = "";
      showToast(`已納入「${role}」意見，班長綜合評分更新為 ${res.decision.compositeScore} 分`);
    } catch (err) {
      showToast(`送出失敗：${err.message}`);
    }
  });

  window.addEventListener("resize", () => {
    clearTimeout(initEvents._rt);
    initEvents._rt = setTimeout(redrawAllCharts, 150);
  });
}

async function bootstrap() {
  initSearch();
  initEvents();
  const initialSym = decodeURIComponent(window.location.hash.replace(/^#/, "")) || "00631L.TW";
  await Promise.all([loadIndices(), loadStock(initialSym), loadSummary(), loadChips()]);
}

bootstrap();
