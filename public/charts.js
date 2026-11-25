/**
 * StockT High-DPI Financial BI Canvas Chart Engine
 * Crisp, theme-aware, TW/US color-mode-aware financial charts
 */

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue("--bg-surface").trim() || "#12161f",
    grid: s.getPropertyValue("--border-subtle").trim() || "rgba(255,255,255,0.08)",
    text: s.getPropertyValue("--text-muted").trim() || "#687385",
    textPrimary: s.getPropertyValue("--text-primary").trim() || "#f1f4f8",
    up: s.getPropertyValue("--up").trim() || "#ef4444",
    down: s.getPropertyValue("--down").trim() || "#10b981",
    accent: s.getPropertyValue("--accent").trim() || "#d4a853",
    ma5: s.getPropertyValue("--series-ma5").trim() || "#f59e0b",
    ma20: s.getPropertyValue("--series-ma20").trim() || "#38bdf8",
    ma60: s.getPropertyValue("--series-ma60").trim() || "#e879f9",
    ma240: s.getPropertyValue("--series-ma240").trim() || "#94a3b8",
    blue: s.getPropertyValue("--series-blue").trim() || "#3b82f6",
    teal: s.getPropertyValue("--series-teal").trim() || "#14b8a6",
    warn: s.getPropertyValue("--warn").trim() || "#f59e0b"
  };
}

function setupCanvas(canvas, cssHeight) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(300, Math.floor(rect.width));
  const h = cssHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "-";
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtCompact(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}億`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(1)}萬`;
  return n.toLocaleString("en-US");
}

/**
 * Interactive Candlestick + Moving Averages + Synchronized Sub-Chart (Volume / RSI / KD)
 */
export function renderKlineChart(canvas, tooltipEl, allBars, options = {}) {
  const {
    days = 120,
    subMode = "volume", // "volume" | "rsi" | "kd"
    showMA = { ma5: true, ma20: true, ma60: true, ma240: true },
    refLines = [] // [{ price, label, color }]
  } = options;

  const bars = (allBars || []).slice(-days);
  const { ctx, w, h } = setupCanvas(canvas, 420);
  const c = getThemeColors();

  if (!bars.length) {
    ctx.fillStyle = c.text;
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("暫無歷史 K 線資料", 20, 40);
    return;
  }

  const pad = { top: 18, right: 64, bottom: 26, left: 12 };
  const mainH = 264;
  const gapH = 18;
  const subTop = pad.top + mainH + gapH;
  const subH = h - subTop - pad.bottom;
  const plotW = w - pad.left - pad.right;

  // Price bounds
  let minP = Infinity;
  let maxP = -Infinity;
  for (const b of bars) {
    if (b.l < minP) minP = b.l;
    if (b.h > maxP) maxP = b.h;
    if (showMA.ma240 && b.ma240) {
      if (b.ma240 < minP) minP = b.ma240;
      if (b.ma240 > maxP) maxP = b.ma240;
    }
  }
  for (const rl of refLines) {
    if (rl.price > minP * 0.88 && rl.price < maxP * 1.12) {
      minP = Math.min(minP, rl.price);
      maxP = Math.max(maxP, rl.price);
    }
  }
  const pMargin = (maxP - minP) * 0.06 || 1;
  minP -= pMargin;
  maxP += pMargin;

  const xStep = plotW / bars.length;
  const xAt = (i) => pad.left + (i + 0.5) * xStep;
  const yPrice = (p) => pad.top + ((maxP - p) / (maxP - minP)) * mainH;

  let maxVol = 1;
  for (const b of bars) maxVol = Math.max(maxVol, b.v || 0);

  function drawBase(hoverIdx = -1) {
    ctx.clearRect(0, 0, w, h);

    // Horizontal gridlines (Main)
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.fillStyle = c.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const priceTicks = 5;
    for (let i = 0; i <= priceTicks; i++) {
      const y = pad.top + (mainH / priceTicks) * i;
      const val = maxP - ((maxP - minP) / priceTicks) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillText(fmtNum(val, val >= 1000 ? 0 : 2), w - pad.right + 6, y);
    }

    // Reference price lines (Support / Resistance / Stop-Loss)
    for (const rl of refLines) {
      if (!rl.price || rl.price < minP || rl.price > maxP) continue;
      const y = yPrice(rl.price);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = rl.color || c.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rl.color || c.accent;
      ctx.font = "10.5px 'JetBrains Mono', monospace";
      ctx.fillText(`${rl.label} ${fmtNum(rl.price, rl.price >= 100 ? 0 : 2)}`, pad.left + 6, y - 7);
      ctx.restore();
    }

    // Candlesticks
    const bodyW = Math.max(1.5, Math.min(10, xStep * 0.64));
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const cx = xAt(i);
      const isUp = b.c >= b.o;
      const col = isUp ? c.up : c.down;

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx, yPrice(b.h));
      ctx.lineTo(cx, yPrice(b.l));
      ctx.stroke();

      const yO = yPrice(b.o);
      const yC = yPrice(b.c);
      const top = Math.min(yO, yC);
      const bh = Math.max(1.4, Math.abs(yC - yO));
      ctx.fillStyle = col;
      ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    }

    // MA Lines
    const maConfigs = [
      { key: "ma5", color: c.ma5 },
      { key: "ma20", color: c.ma20 },
      { key: "ma60", color: c.ma60 },
      { key: "ma240", color: c.ma240 }
    ];
    for (const mc of maConfigs) {
      if (!showMA[mc.key]) continue;
      ctx.strokeStyle = mc.color;
      ctx.lineWidth = mc.key === "ma240" ? 1.6 : 1.3;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < bars.length; i++) {
        const val = bars[i][mc.key];
        if (!val) continue;
        const x = xAt(i);
        const y = yPrice(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Sub-chart separator & header
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, subTop);
    ctx.lineTo(w - pad.right, subTop);
    ctx.stroke();

    ctx.fillStyle = c.text;
    ctx.font = "11px 'JetBrains Mono', monospace";
    const subLabel = subMode === "volume" ? "VOLUME 成交量" : subMode === "rsi" ? "RSI(14)" : "KD(9,3,3)";
    ctx.fillText(subLabel, pad.left + 4, subTop - 8);

    if (subMode === "volume") {
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const vh = ((b.v || 0) / maxVol) * (subH - 4);
        ctx.fillStyle = b.c >= b.o ? c.up + "88" : c.down + "88";
        ctx.fillRect(xAt(i) - bodyW / 2, subTop + subH - vh, bodyW, vh);
      }
      ctx.fillStyle = c.text;
      ctx.fillText(fmtCompact(maxVol), w - pad.right + 6, subTop + 8);
      ctx.fillText("0", w - pad.right + 6, subTop + subH - 2);
    } else if (subMode === "rsi") {
      const yOsc = (v) => subTop + ((100 - v) / 100) * subH;
      for (const lv of [70, 50, 30]) {
        const y = yOsc(lv);
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = c.grid;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = c.text;
        ctx.fillText(String(lv), w - pad.right + 6, y);
      }
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let st = false;
      for (let i = 0; i < bars.length; i++) {
        if (bars[i].rsi14 == null) continue;
        const x = xAt(i);
        const y = yOsc(bars[i].rsi14);
        if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else {
      const yOsc = (v) => subTop + ((100 - v) / 100) * subH;
      for (const lv of [80, 50, 20]) {
        const y = yOsc(lv);
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = c.grid;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = c.text;
        ctx.fillText(String(lv), w - pad.right + 6, y);
      }
      for (const line of [{ k: "k9", col: c.ma20 }, { k: "d9", col: c.ma5 }]) {
        ctx.strokeStyle = line.col;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let st = false;
        for (let i = 0; i < bars.length; i++) {
          if (bars[i][line.k] == null) continue;
          const x = xAt(i);
          const y = yOsc(bars[i][line.k]);
          if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // X-Axis Date Labels
    ctx.fillStyle = c.text;
    ctx.textAlign = "center";
    const xTicks = Math.min(6, bars.length);
    for (let i = 0; i < xTicks; i++) {
      const idx = Math.floor((i * (bars.length - 1)) / Math.max(1, xTicks - 1));
      ctx.fillText(bars[idx].t.slice(2), xAt(idx), h - 10);
    }

    // Hover Crosshair
    if (hoverIdx >= 0 && hoverIdx < bars.length) {
      const b = bars[hoverIdx];
      const cx = xAt(hoverIdx);
      const cy = yPrice(b.c);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = c.textPrimary + "66";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, pad.top);
      ctx.lineTo(cx, subTop + subH);
      ctx.moveTo(pad.left, cy);
      ctx.lineTo(w - pad.right, cy);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawBase(-1);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.floor((mx - pad.left) / xStep);
    if (idx < 0 || idx >= bars.length) {
      drawBase(-1);
      tooltipEl.classList.remove("visible");
      return;
    }
    drawBase(idx);
    const b = bars[idx];
    const prev = idx > 0 ? bars[idx - 1].c : b.o;
    const chgPct = prev ? ((b.c - prev) / prev) * 100 : 0;
    const pctClass = chgPct > 0 ? "text-up" : chgPct < 0 ? "text-down" : "text-flat";
    tooltipEl.innerHTML = `
      <div class="mono" style="font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between;gap:12px;">
        <span>${b.t}</span>
        <span class="${pctClass}">${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%</span>
      </div>
      <div class="mono" style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;font-size:11.5px;">
        <span class="text-muted">開 ${fmtNum(b.o, 2)}</span>
        <span class="text-muted">高 ${fmtNum(b.h, 2)}</span>
        <span class="text-muted">低 ${fmtNum(b.l, 2)}</span>
        <span style="font-weight:700;">收 ${fmtNum(b.c, 2)}</span>
        <span class="text-muted">量 ${fmtCompact(b.v)}</span>
        <span class="text-muted">RSI ${b.rsi14 != null ? b.rsi14.toFixed(1) : "-"}</span>
        <span style="color:${c.ma5}">MA5 ${b.ma5 ? fmtNum(b.ma5, 1) : "-"}</span>
        <span style="color:${c.ma20}">MA20 ${b.ma20 ? fmtNum(b.ma20, 1) : "-"}</span>
        <span style="color:${c.ma60}">MA60 ${b.ma60 ? fmtNum(b.ma60, 1) : "-"}</span>
        <span style="color:${c.ma240}">MA240 ${b.ma240 ? fmtNum(b.ma240, 1) : "-"}</span>
      </div>
    `;
    tooltipEl.classList.add("visible");
    // Position tooltip intelligently left or right
    if (mx > w * 0.55) {
      tooltipEl.style.left = "14px";
      tooltipEl.style.right = "auto";
    } else {
      tooltipEl.style.left = "auto";
      tooltipEl.style.right = "74px";
    }
  };

  canvas.onmouseleave = () => {
    drawBase(-1);
    tooltipEl.classList.remove("visible");
  };
}

/**
 * DCA Backtest Equity Curve (Invested Principal vs Portfolio Value)
 */
export function renderDcaChart(canvas, points) {
  const { ctx, w, h } = setupCanvas(canvas, 170);
  const c = getThemeColors();
  if (!points || points.length < 2) return;

  const pad = { top: 12, right: 56, bottom: 22, left: 10 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  let maxV = 0;
  for (const p of points) {
    maxV = Math.max(maxV, p.invested, p.value);
  }
  maxV = maxV * 1.08 || 1;

  const xAt = (i) => pad.left + (i / (points.length - 1)) * plotW;
  const yAt = (v) => pad.top + ((maxV - v) / maxV) * plotH;

  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.font = "10.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = c.text;
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + (plotH / 3) * i;
    const val = maxV - (maxV / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(fmtCompact(val), w - pad.right + 5, y + 3);
  }

  // Area under market value
  const last = points[points.length - 1];
  const valCol = last.value >= last.invested ? c.up : c.down;
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(0));
  for (let i = 0; i < points.length; i++) ctx.lineTo(xAt(i), yAt(points[i].value));
  ctx.lineTo(xAt(points.length - 1), yAt(0));
  ctx.closePath();
  ctx.fillStyle = valCol + "22";
  ctx.fill();

  // Invested principal dashed line
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = c.text;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = xAt(i), y = yAt(points[i].invested);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Portfolio value line
  ctx.strokeStyle = valCol;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = xAt(i), y = yAt(points[i].value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = c.text;
  ctx.fillText(points[0].date.slice(2), pad.left, h - 6);
  ctx.textAlign = "right";
  ctx.fillText(last.date.slice(2), w - pad.right, h - 6);
}

/**
 * Chips BI Chart 1: TAIEX Index + Institutional Spot Flow Bars
 */
export function renderChipsFlowChart(canvas, history) {
  const { ctx, w, h } = setupCanvas(canvas, 300);
  const c = getThemeColors();
  if (!history || !history.length) return;

  const pad = { top: 20, right: 62, bottom: 26, left: 54 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  let minIdx = Infinity, maxIdx = -Infinity, maxAbsFlow = 1;
  for (const r of history) {
    const tc = r.taiex?.close;
    if (tc) { minIdx = Math.min(minIdx, tc); maxIdx = Math.max(maxIdx, tc); }
    maxAbsFlow = Math.max(maxAbsFlow, Math.abs(r.inst?.total || 0), Math.abs(r.inst?.foreign || 0));
  }
  const idxMargin = (maxIdx - minIdx) * 0.08 || 100;
  minIdx -= idxMargin;
  maxIdx += idxMargin;

  const xStep = plotW / history.length;
  const xAt = (i) => pad.left + (i + 0.5) * xStep;
  const yIdx = (v) => pad.top + ((maxIdx - v) / (maxIdx - minIdx)) * plotH;
  const yFlowZero = pad.top + plotH * 0.5;
  const yFlow = (v) => yFlowZero - (v / (maxAbsFlow * 1.15)) * (plotH * 0.46);

  // Grid
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.font = "10.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = c.text;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    const idxVal = maxIdx - ((maxIdx - minIdx) / 4) * i;
    ctx.textAlign = "left";
    ctx.fillText(Math.round(idxVal).toLocaleString(), w - pad.right + 6, y + 3);
  }

  // Left axis labels (Flow 億)
  ctx.textAlign = "right";
  ctx.fillText(`+${Math.round(maxAbsFlow)}億`, pad.left - 6, pad.top + 8);
  ctx.fillText("0億", pad.left - 6, yFlowZero + 3);
  ctx.fillText(`-${Math.round(maxAbsFlow)}億`, pad.left - 6, pad.top + plotH - 2);

  // Total Institutional Bars
  const barW = Math.max(2, Math.min(9, xStep * 0.65));
  for (let i = 0; i < history.length; i++) {
    const val = history[i].inst?.total || 0;
    const y = yFlow(val);
    ctx.fillStyle = val >= 0 ? c.up + "aa" : c.down + "aa";
    ctx.fillRect(xAt(i) - barW / 2, Math.min(y, yFlowZero), barW, Math.max(1, Math.abs(y - yFlowZero)));
  }

  // TAIEX Line Overlay
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let st = false;
  for (let i = 0; i < history.length; i++) {
    const tc = history[i].taiex?.close;
    if (!tc) continue;
    const x = xAt(i), y = yIdx(tc);
    if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Dates
  ctx.fillStyle = c.text;
  ctx.textAlign = "center";
  const ticks = Math.min(5, history.length);
  for (let i = 0; i < ticks; i++) {
    const idx = Math.floor((i * (history.length - 1)) / Math.max(1, ticks - 1));
    ctx.fillText(history[idx].date.slice(5), xAt(idx), h - 8);
  }
}

/**
 * Chips BI Chart 2: Margin Maintenance Ratio (with 160%/150% alert lines) & Foreign Futures OI
 */
export function renderFuturesMarginChart(canvas, history) {
  const { ctx, w, h } = setupCanvas(canvas, 300);
  const c = getThemeColors();
  if (!history || !history.length) return;

  const pad = { top: 20, right: 62, bottom: 26, left: 56 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  let minM = 135, maxM = 185;
  let minF = Infinity, maxF = -Infinity;
  for (const r of history) {
    const mr = r.margin?.maintRatio;
    if (mr) { minM = Math.min(minM, mr - 4); maxM = Math.max(maxM, mr + 4); }
    const fn = r.futures?.foreignNet;
    if (fn != null) { minF = Math.min(minF, fn); maxF = Math.max(maxF, fn); }
  }
  const fPad = (maxF - minF) * 0.1 || 5000;
  minF -= fPad;
  maxF += fPad;

  const xStep = plotW / history.length;
  const xAt = (i) => pad.left + (i + 0.5) * xStep;
  const yM = (v) => pad.top + ((maxM - v) / (maxM - minM)) * plotH;
  const yF = (v) => pad.top + ((maxF - v) / (maxF - minF)) * plotH;

  // Grid & Left Margin Ratio labels
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.font = "10.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = c.text;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    const mv = maxM - ((maxM - minM) / 4) * i;
    ctx.textAlign = "right";
    ctx.fillText(`${mv.toFixed(0)}%`, pad.left - 6, y + 3);

    const fv = maxF - ((maxF - minF) / 4) * i;
    ctx.textAlign = "left";
    ctx.fillText(`${(fv / 1000).toFixed(0)}k`, w - pad.right + 6, y + 3);
  }

  // 160% Warning & 150% Liquidation thresholds
  for (const ref of [{ val: 160, col: c.warn, txt: "160% 警戒" }, { val: 150, col: c.up, txt: "150% 追繳紅線" }]) {
    if (ref.val < minM || ref.val > maxM) continue;
    const y = yM(ref.val);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = ref.col;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = ref.col;
    ctx.textAlign = "left";
    ctx.fillText(ref.txt, pad.left + 6, y - 5);
  }

  // Foreign Futures Net OI Line (Right Axis)
  ctx.strokeStyle = c.ma20;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  let st = false;
  for (let i = 0; i < history.length; i++) {
    const fn = history[i].futures?.foreignNet;
    if (fn == null) continue;
    const x = xAt(i), y = yF(fn);
    if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Margin Maintenance Ratio Line (Left Axis)
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  st = false;
  for (let i = 0; i < history.length; i++) {
    const mr = history[i].margin?.maintRatio;
    if (!mr) continue;
    const x = xAt(i), y = yM(mr);
    if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = c.text;
  ctx.textAlign = "center";
  const ticks = Math.min(5, history.length);
  for (let i = 0; i < ticks; i++) {
    const idx = Math.floor((i * (history.length - 1)) / Math.max(1, ticks - 1));
    ctx.fillText(history[idx].date.slice(5), xAt(idx), h - 8);
  }
}
