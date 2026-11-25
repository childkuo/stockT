/**
 * StockT Investment Committee Decision Engine (6-Role Independent Cross-Review)
 * Roles:
 *   1. 總體經濟分析師 (Macroeconomic Analyst)
 *   2. 技術分析師 (Technical Analyst)
 *   3. 基本面分析師 (Fundamental Analyst)
 *   4. 籌碼分析師 (Chips & Flow Analyst)
 *   5. 風險管理師 (Risk Manager)
 *   6. 交易策略師 (Trading Strategist)
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round1(v) {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

function round2(v) {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

export function scoreToStance(score) {
  if (score >= 76) return { label: "積極偏多", code: "STRONG_BUY", tone: "bull" };
  if (score >= 62) return { label: "謹慎偏多・分批佈局", code: "BUY", tone: "bull" };
  if (score >= 48) return { label: "中性觀望・等待確認", code: "HOLD_WAIT", tone: "neutral" };
  if (score >= 35) return { label: "保守觀望・嚴控部位", code: "CAUTIOUS", tone: "warn" };
  return { label: "偏空保守・暫勿接刀", code: "BEARISH_DEFENSIVE", tone: "bear" };
}

function isLeveragedEtf(stock) {
  const code = (stock.code || "").toUpperCase();
  const name = stock.name || "";
  return (
    stock.assetType === "ETF" &&
    (/L$|R$/.test(code) || /正2|反1|槓桿|反向|2X/i.test(name))
  );
}

/**
 * 角色 1｜總體經濟分析師
 */
function evaluateMacro(stock, summary, chipsHistory) {
  const breadth = summary?.breadth || {};
  const latestChip = Array.isArray(chipsHistory) && chipsHistory.length ? chipsHistory[chipsHistory.length - 1] : null;
  let score = 52;
  const signals = [];

  const declRatio = breadth.total ? (breadth.decliners / breadth.total) * 100 : 50;
  const taiexChg = Number(latestChip?.taiex?.changePct ?? 0);

  if (declRatio >= 75) {
    score -= 22;
    signals.push(`全市場下跌家數佔比達 ${round1(declRatio)}%（上漲 ${breadth.advancers} / 下跌 ${breadth.decliners}），風險資產全面重定價`);
  } else if (declRatio >= 60) {
    score -= 10;
    signals.push(`全市場下跌家數佔比 ${round1(declRatio)}%，資金風險偏好轉弱`);
  } else if (declRatio <= 35) {
    score += 14;
    signals.push(`市場寬度健康（下跌佔比僅 ${round1(declRatio)}%），風險偏好回溫`);
  } else {
    signals.push(`市場寬度中性（下跌佔比 ${round1(declRatio)}%），大盤震盪整理`);
  }

  if (taiexChg <= -3) {
    score -= 10;
    signals.push(`加權指數單日重挫 ${round2(taiexChg)}%，系統性賣壓主導盤面`);
  } else if (taiexChg >= 2) {
    score += 8;
    signals.push(`加權指數單日強漲 +${round2(taiexChg)}%，短線風險情緒改善`);
  }

  const m = stock.metrics || {};
  if (Number(m.returns?.["1M"] || 0) <= -15) {
    signals.push(`近一個月重挫 ${round1(m.returns["1M"])}%，屬系統性評價下修期`);
  }

  score = Math.round(clamp(score, 15, 90));
  const stanceLabel = score < 40 ? "偏空" : score < 55 ? "中性偏保守" : "偏多";
  const tone = score < 40 ? "bear" : score < 55 ? "neutral" : "bull";

  return {
    id: "macro",
    roleIndex: 1,
    role: "總體經濟分析師",
    roleEn: "Macroeconomic Analyst",
    score,
    confidence: 80,
    stance: stanceLabel,
    tone,
    judgment:
      score < 40
        ? `市場正處於風險資產重新定價階段，大盤重挫且下跌家數佔比高達 ${round1(declRatio)}%，短期資金風險偏好明顯下降。`
        : score < 55
          ? `總體環境仍處震盪消化期（下跌佔比 ${round1(declRatio)}%），資金尚未形成全面風險偏好擴張。`
          : `大盤結構與市場寬度正向支撐，風險資產定價環境相對友善。`,
    opinion:
      score < 40
        ? "不要只因跌幅大就認定已經觸底，須等待系統性賣壓與宏觀風險溢價收斂。"
        : score < 55
          ? "維持中性配置節奏，密切追蹤大盤寬度與國際股市連動。"
          : "總經順風環境下可維持核心部位，順勢追蹤景氣動能。",
    keySignals: signals.slice(0, 3)
  };
}

/**
 * 角色 2｜技術分析師
 */
function evaluateTechnical(stock) {
  const m = stock.metrics || {};
  const bars = stock.bars || [];
  const last = bars[bars.length - 1] || {};
  let score = 50;
  const signals = [];

  const close = Number(m.close || last.c || 0);
  const ma5 = Number(m.ma5 || 0);
  const ma20 = Number(m.ma20 || 0);
  const ma60 = Number(m.ma60 || 0);
  const ma240 = Number(m.ma240 || 0);
  const rsi = Number(m.rsi14 ?? 50);
  const k9 = Number(m.k9 ?? 50);
  const d9 = Number(m.d9 ?? 50);
  const high52w = Number(m.high52w || close);
  const drawdownFromHigh = high52w ? ((close - high52w) / high52w) * 100 : 0;

  if (ma5 && close > ma5) score += 5;
  else if (ma5) score -= 6;

  if (ma20 && close > ma20) {
    score += 9;
    signals.push(`站穩月線 MA20 (${round2(ma20)}) 之上，短中期結構偏多`);
  } else if (ma20) {
    score -= 9;
    signals.push(`位於月線 MA20 (${round2(ma20)}) 下方，短線下跌趨勢反壓明確`);
  }

  if (ma60 && close > ma60) score += 8;
  else if (ma60) score -= 8;

  if (ma240 && close > ma240) {
    score += 10;
    signals.push(`力守年線 MA240 (${round2(ma240)})，長線多空生命線尚存`);
  } else if (ma240) {
    score -= 12;
    signals.push(`跌破年線 MA240 (${round2(ma240)})，中長期均線轉為空頭排列`);
  }

  if (drawdownFromHigh <= -25) {
    signals.push(`自 52 週高點 (${round2(high52w)}) 回撤達 ${round1(drawdownFromHigh)}%，套牢籌碼沉重`);
  }

  if (k9 > d9 && k9 < 55) {
    score += 5;
    signals.push(`KD(9,3,3) 低檔黃金交叉（K=${round1(k9)} > D=${round1(d9)}），醞釀短線止穩`);
  } else if (k9 < d9) {
    score -= 4;
    signals.push(`RSI(14)=${round1(rsi)}、KD 仍呈空頭排列（K=${round1(k9)} < D=${round1(d9)}），反轉尚未確認`);
  }

  score = Math.round(clamp(score, 15, 92));
  const stanceLabel = score < 40 ? "偏空" : score < 55 ? "中性震盪" : "偏多";
  const tone = score < 40 ? "bear" : score < 55 ? "neutral" : "bull";

  const low = Number(m.low || last.l || close);
  const supportCandidates = [low, ma240, ma5, Number(m.low52w || 0)].filter((v) => v > 0 && v <= close * 1.01);
  const resistCandidates = [ma20, ma240, ma60, Number(m.high52w || 0)].filter((v) => v > close);
  const supportLevels = [...new Set(supportCandidates.map((v) => round2(v)))].sort((a, b) => b - a).slice(0, 3);
  const resistanceLevels = [...new Set(resistCandidates.map((v) => round2(v)))].sort((a, b) => a - b).slice(0, 3);

  return {
    id: "technical",
    roleIndex: 2,
    role: "技術分析師",
    roleEn: "Technical Analyst",
    score,
    confidence: 80,
    stance: stanceLabel,
    tone,
    supportLevels,
    resistanceLevels,
    judgment:
      score < 40
        ? `價格自高點大幅回落（距 52 週高點 ${round1(drawdownFromHigh)}%），收盤 ${close} 受制於下彎均線，短線下跌趨勢尚未獲得反轉確認。`
        : score < 55
          ? `短線在關鍵支撐 ${supportLevels[0] ?? round2(close * 0.95)} 與上檔壓力 ${resistanceLevels[0] ?? round2(close * 1.05)} 間反覆築底測試。`
          : `均線多頭排列與動能結構支撐價格上行，趨勢維持正向。`,
    opinion:
      score < 40
        ? "等待低點縮量止穩、成交量結構轉健康及站回關鍵均線的右側反彈結構確認。"
        : score < 55
          ? "以區間支撐防守視角觀察，待帶量突破月線再確認波段轉強。"
          : "沿短期均線順勢操作，回測不破支撐可視為健康換手。",
    keySignals: signals.slice(0, 3)
  };
}

/**
 * 角色 3｜基本面分析師
 */
function evaluateFundamental(stock) {
  const m = stock.metrics || {};
  const f = stock.fundamentals || {};
  const ret = m.returns || {};
  const lev = isLeveragedEtf(stock);
  let score = 55;
  const signals = [];

  const pe = Number(f.pe);
  const pb = Number(f.pb);
  const dy = Number(f.dividendYield);
  const pos52w = Number(m.pos52wPct ?? 50);

  if (lev) {
    score = 56;
    signals.push(`屬槓桿／反向型 ETF（${stock.code} ${stock.name}），追蹤標的指數單日倍數報酬`);
    if (Number.isFinite(ret["1Y"])) {
      signals.push(`近一年累積報酬 ${ret["1Y"] >= 0 ? "+" : ""}${round1(ret["1Y"])}%（YTD ${ret.YTD >= 0 ? "+" : ""}${round1(ret.YTD)}%），長期多頭行情具備放大效果`);
    }
    signals.push(`近一月大幅修正 ${round1(ret["1M"])}%，顯示高估值與位階切入時點極為關鍵`);
  } else {
    if (Number.isFinite(pe) && pe > 0) {
      if (pe <= 15) {
        score += 14;
        signals.push(`本益比 P/E ${round2(pe)}x 處於低估區間，安全邊際充足`);
      } else if (pe <= 25) {
        score += 8;
        signals.push(`本益比 P/E ${round2(pe)}x 落於成長合理估值帶`);
      } else if (pe <= 40) {
        score -= 2;
        signals.push(`本益比 P/E ${round2(pe)}x 估值偏高，需仰賴獲利持續成長`);
      } else {
        score -= 10;
        signals.push(`本益比 P/E ${round2(pe)}x 明顯偏貴，估值回修壓力大`);
      }
    } else {
      signals.push(stock.assetType === "ETF" ? "ETF 標的以指數成分股長期獲利成長與分散配置為核心評估" : "暫無公開本益比數據，改以 52 週位階與中長期動能推估");
    }

    if (Number.isFinite(pb) && pb > 0) signals.push(`股價淨值比 P/B ${round2(pb)}x`);
    if (Number.isFinite(dy) && dy > 0) {
      if (dy >= 4) score += 8;
      else if (dy >= 2) score += 3;
      signals.push(`現金殖利率 ${round2(dy)}%`);
    }
    if (Number.isFinite(ret["1Y"]) && ret["1Y"] > 20 && Number(ret["1M"] || 0) < -5) {
      score += 5;
      signals.push(`近一年 +${round1(ret["1Y"])}% 但近月修正 ${round1(ret["1M"])}%，屬長多下的評價調整`);
    }
  }

  score = Math.round(clamp(score, 22, 90));
  const stanceLabel = lev ? "長期中性偏多" : score >= 62 ? "長期偏多" : score >= 48 ? "長期中性偏多" : "基本面偏弱";
  const tone = score >= 60 ? "bull" : score >= 48 ? "neutral" : "bear";

  return {
    id: "fundamental",
    roleIndex: 3,
    role: "基本面分析師",
    roleEn: "Fundamental Analyst",
    score,
    confidence: 75,
    stance: stanceLabel,
    tone,
    judgment: lev
      ? `${stock.code} ${stock.name} 追蹤大盤權值指數之單日倍數報酬，長期績效有機會受惠於核心權值企業成長，但價格高度依賴進場位階。`
      : `${stock.name} (${stock.code}) 屬「${stock.category || stock.assetType}」板塊，目前 52 週位階 ${round1(pos52w)}%${
          Number.isFinite(pe) && pe > 0 ? `，P/E ${round2(pe)}x` : ""
        }，中長期基本面體質評定為「${stanceLabel}」。`,
    opinion: lev
      ? "看好大盤權值長期成長，不等於任何價格與波動環境都適合直接買進槓桿型標的。"
      : score >= 55
        ? "具中長期配置價值，但仍須搭配估值安全邊際與大盤節奏分批切入。"
        : "基本面動能尚待財報與獲利預期重新確認，不宜單憑跌深貿然重壓。",
    keySignals: signals.slice(0, 3)
  };
}

/**
 * 角色 4｜籌碼分析師
 */
function evaluateChips(stock, chipsHistory) {
  const m = stock.metrics || {};
  const latestChip = Array.isArray(chipsHistory) && chipsHistory.length ? chipsHistory[chipsHistory.length - 1] : null;
  let score = 50;
  const signals = [];

  const volRatio = Number(m.volRatio ?? 1);
  const changePct = Number(m.changePct ?? 0);

  if (stock.market === "TW" && latestChip) {
    const foreign = Number(latestChip.inst?.foreign ?? 0);
    const trust = Number(latestChip.inst?.trust ?? 0);
    const total = Number(latestChip.inst?.total ?? 0);
    const futNet = Number(latestChip.futures?.foreignNet ?? 0);
    const maint = Number(latestChip.margin?.maintRatio ?? 165);
    const marginChg = Number(latestChip.margin?.change100m ?? 0);

    if (total < -500) {
      score -= 16;
      signals.push(`三大法人現貨賣超 ${round1(total)} 億（外資 ${round1(foreign)} 億），大規模賣壓與提款未止`);
    } else if (total > 200) {
      score += 12;
      signals.push(`三大法人現貨買超 +${round1(total)} 億，法人資金回補`);
    }

    if (trust > 100 && foreign < -300) {
      signals.push(`投信逆勢買超 +${round1(trust)} 億，呈現土洋對作格局`);
    }

    if (futNet < -50000) {
      score -= 10;
      signals.push(`外資台指期淨空單達 ${futNet.toLocaleString()} 口，空方避險與壓盤壓力沉重`);
    }

    if (maint < 156) {
      score -= 4;
      signals.push(`融資維持率降至 ${round2(maint)}%（單日融資 ${round1(marginChg)} 億），市場處於劇烈去槓桿階段`);
    }
  } else {
    signals.push(`最新成交量比 ${round2(volRatio)}x，最新漲跌 ${round2(changePct)}%`);
  }

  if (volRatio >= 1.8 && changePct < -3) {
    score -= 6;
    signals.push(`標的爆量重挫（量比 ${round2(volRatio)}x、跌幅 ${round2(changePct)}%），籌碼激烈換手尚未沉澱`);
  } else if (volRatio >= 1.5 && changePct > 2) {
    score += 10;
    signals.push(`標的帶量轉強（量比 ${round2(volRatio)}x、漲幅 +${round2(changePct)}%），主力資金進駐`);
  }

  score = Math.round(clamp(score, 15, 90));
  const stanceLabel = score < 40 ? "偏空" : score < 56 ? "籌碼觀望" : "籌碼偏多";
  const tone = score < 40 ? "bear" : score < 56 ? "neutral" : "bull";

  return {
    id: "chips",
    roleIndex: 4,
    role: "籌碼分析師",
    roleEn: "Chips & Flow Analyst",
    score,
    confidence: 82,
    stance: stanceLabel,
    tone,
    judgment:
      score < 40
        ? "本週市場出現大規模法人賣壓與融資去槓桿，外資期現貨同步偏空，資金流向仍處震盪流出階段。"
        : score < 56
          ? "籌碼多空換手頻繁，法人與散戶流向分歧，尚未形成一致的淨流入趨勢。"
          : "法人買盤與量能結構同步配合，籌碼流向具備推升動能。",
    opinion:
      score < 40
        ? "等待外資現貨賣壓明顯減輕、期貨空單回補，以及融資餘額下降趨勢趨於穩定後再行動。"
        : score < 56
          ? "持續追蹤三大法人連續買賣超轉折與量縮沉澱訊號。"
          : "順應法人籌碼集中方向操作，留意高檔爆量換手風險。",
    keySignals: signals.slice(0, 3)
  };
}

/**
 * 角色 5｜風險管理師
 */
function evaluateRiskManager(stock, summary, chipsHistory) {
  const m = stock.metrics || {};
  const lev = isLeveragedEtf(stock);
  const volAnn = Number(m.volatilityAnnPct ?? 35);
  const latestChip = Array.isArray(chipsHistory) && chipsHistory.length ? chipsHistory[chipsHistory.length - 1] : null;
  const maint = Number(latestChip?.margin?.maintRatio ?? 168);
  const close = Number(m.close || 0);

  let score = 55;
  const signals = [];

  if (lev) {
    score -= 22;
    signals.push(`槓桿型 ETF 每日重設機制在高震盪盤面會顯著放大損益並產生「波動耗損 (Volatility Drag)」`);
  }

  if (volAnn >= 80) {
    score -= 20;
    signals.push(`年化波動率高達 ${round1(volAnn)}%，屬極端劇烈波動區間，單日淨值回撤風險極大`);
  } else if (volAnn >= 50) {
    score -= 14;
    signals.push(`年化波動率達 ${round1(volAnn)}%，遠高於常態水準，必須大幅壓縮倉位`);
  } else if (volAnn >= 35) {
    score -= 6;
    signals.push(`年化波動率 ${round1(volAnn)}%，須嚴控單一標的資金權重`);
  } else {
    score += 8;
    signals.push(`年化波動率 ${round1(volAnn)}% 處於相對可控範圍`);
  }

  if (stock.market === "TW" && maint < 155) {
    score -= 8;
    signals.push(`大盤融資維持率 ${round2(maint)}% 逼近 150% 警戒線，慎防連鎖追繳多殺多`);
  }

  const maxPositionPct = lev || volAnn >= 80 ? 5 : volAnn >= 55 ? 10 : volAnn >= 35 ? 20 : 30;
  const stopLoss = round2(close * (lev || volAnn >= 80 ? 0.88 : volAnn >= 50 ? 0.92 : 0.94));
  signals.push(`風控底線：單一部位上限 ${maxPositionPct}%，防守停損參考價 ${stopLoss}`);

  score = Math.round(clamp(score, 15, 88));
  const stanceLabel = score <= 30 ? "強烈保守" : score < 48 ? "高度防禦" : "審慎控管";
  const tone = score <= 30 ? "bear" : score < 48 ? "warn" : "neutral";

  return {
    id: "risk",
    roleIndex: 5,
    role: "風險管理師",
    roleEn: "Risk Manager",
    score,
    confidence: 88,
    stance: stanceLabel,
    tone,
    maxPositionPct,
    stopLoss,
    judgment: lev
      ? `每日槓桿重設會成倍放大損益，目前年化波動率達 ${round1(volAnn)}%，在震盪下跌市場極易產生不可逆的波動耗損。`
      : `當前標的年化波動率 ${round1(volAnn)}%，系統性波動風險偏高，任何無紀律的攤平都可能導致淨值大幅回撤。`,
    opinion: lev
      ? `禁止無限攤平，絕不宜把槓桿型 ETF 當成退休存股工具；最大部位嚴限總資金 ${maxPositionPct}% 以內。`
      : `嚴禁融資或無限攤平，初始試單壓縮至總資金 ${maxPositionPct}% 以內並落實 ${stopLoss} 硬性停損。`,
    keySignals: signals.slice(0, 3)
  };
}

/**
 * 角色 6｜交易策略師
 */
function evaluateStrategy(stock, tech, risk) {
  const m = stock.metrics || {};
  const close = Number(m.close || 0);
  const rsi = Number(m.rsi14 ?? 50);
  const ma20 = Number(m.ma20 || 0);
  const low = Number(m.low || close);
  let score = 48;
  const signals = [];

  if (rsi <= 38) {
    signals.push(`RSI(14) 降至 ${round1(rsi)}，短線急跌後隨時可能出現技術性反彈，但須區分反彈與反轉`);
  } else {
    signals.push(`RSI(14) 為 ${round1(rsi)}，操作應依支撐壓力位設定進出場條件`);
  }

  if (ma20 && close < ma20) {
    score -= 10;
    signals.push(`未站回月線 (${round2(ma20)}) 前，右側趨勢確認訊號尚未觸發`);
  } else if (ma20 && close >= ma20) {
    score += 12;
    signals.push(`價格站上月線 (${round2(ma20)})，具備右側分批布局條件`);
  }

  const entryLow = round2(Math.min(low, close * 0.94));
  const entryHigh = round2(close * 0.99);
  const stopLoss = risk.stopLoss ?? round2(close * 0.9);
  const target1 = tech.resistanceLevels?.[0] ?? round2(close * 1.1);
  signals.push(`紀律規則：觀察區 ${entryLow}–${entryHigh}、停損 ${stopLoss}、反彈壓力 ${target1}`);

  score = Math.round(clamp(score, 22, 85));
  const stanceLabel = score < 46 ? "等待訊號" : score < 62 ? "分批試單" : "順勢操作";
  const tone = score < 46 ? "warn" : score < 62 ? "neutral" : "bull";

  return {
    id: "strategy",
    roleIndex: 6,
    role: "交易策略師",
    roleEn: "Trading Strategist",
    score,
    confidence: 80,
    stance: stanceLabel,
    tone,
    judgment:
      score < 46
        ? "急跌後雖隨時可能出現技術性反彈，但單日急彈不一定代表空頭趨勢反轉，現階段尚未出現高勝率右側訊號。"
        : score < 62
          ? "盤勢進入關鍵支撐攻防帶，可透過條件式分批機制控制成本，避免單筆押注。"
          : "趨勢與動能條件到位，可依既定倉位規則執行波段操作。",
    opinion:
      score < 46
        ? "嚴守「等待訊號」原則，未來若啟動進場務必採分階段建倉，並事前寫死停損點與資金配置上限。"
        : "嚴格分 3 批進場，每批皆需綁定明確停損與獲利減碼檢視點。",
    keySignals: signals.slice(0, 3)
  };
}

/**
 * Aggregate all 6 independent roles (+ curated reports + custom user team inputs)
 * into the Team Leader (班長) cross-review final decision.
 */
export function buildCommitteeDecision(stock, summary, chipsHistory, curatedReport = null, customOpinions = []) {
  const macro = evaluateMacro(stock, summary, chipsHistory);
  const tech = evaluateTechnical(stock);
  const fund = evaluateFundamental(stock);
  const chips = evaluateChips(stock, chipsHistory);
  const risk = evaluateRiskManager(stock, summary, chipsHistory);
  const strat = evaluateStrategy(stock, tech, risk);

  const dynamicRoles = [macro, tech, fund, chips, risk, strat];

  const baseRoles = dynamicRoles.map((dr) => {
    const match = curatedReport?.roles?.find((r) => r.id === dr.id);
    if (!match) return { ...dr, sourceType: "DYNAMIC_MODEL" };
    return {
      ...dr,
      ...match,
      sourceType: "CURATED_COMMITTEE"
    };
  });

  const extraRoles = (customOpinions || []).map((op, i) => ({
    id: op.id,
    roleIndex: baseRoles.length + i + 1,
    role: op.role,
    roleEn: op.roleEn || "Custom Team Role",
    score: clamp(Number(op.score) || 50, 0, 100),
    confidence: clamp(Number(op.confidence) || 75, 0, 100),
    stance: op.stance || scoreToStance(Number(op.score) || 50).label,
    tone: scoreToStance(Number(op.score) || 50).tone,
    judgment: op.judgment || op.summary,
    opinion: op.opinion || "",
    keySignals: Array.isArray(op.keySignals) ? op.keySignals : [op.summary],
    summary: op.summary,
    author: op.author || "專案團隊成員",
    createdAt: op.createdAt,
    sourceType: "USER_TEAM_INPUT"
  }));

  const allRoles = [...baseRoles, ...extraRoles];

  // Equalized 6-role cross-review weights (sum = 1.00)
  const defaultWeights = {
    macro: 0.16,
    technical: 0.18,
    fundamental: 0.18,
    chips: 0.16,
    risk: 0.16,
    strategy: 0.16
  };

  let totalW = 0;
  let weightedSum = 0;
  for (const r of allRoles) {
    const w = defaultWeights[r.id] ?? 0.15;
    weightedSum += r.score * w;
    totalW += w;
  }
  const compositeScore = Math.round(weightedSum / (totalW || 1));
  const consensus = scoreToStance(compositeScore);

  // Tally cross-review stances
  const tally = { bull: 0, neutral: 0, warn: 0, bear: 0 };
  for (const r of allRoles) {
    if (r.tone === "bull") tally.bull += 1;
    else if (r.tone === "bear") tally.bear += 1;
    else if (r.tone === "warn") tally.warn += 1;
    else tally.neutral += 1;
  }

  const m = stock.metrics || {};
  const close = Number(m.close || 0);
  const techRole = allRoles.find((r) => r.id === "technical");
  const riskRole = allRoles.find((r) => r.id === "risk");

  const entryLow = curatedReport?.tradePlan?.entryLow ?? round2(Math.min(close * 0.94, Number(m.low || close)));
  const entryHigh = curatedReport?.tradePlan?.entryHigh ?? round2(close * 0.99);
  const stopLoss = curatedReport?.tradePlan?.stopLoss ?? riskRole?.stopLoss ?? round2(close * 0.91);
  const target1 = curatedReport?.tradePlan?.target1 ?? techRole?.resistanceLevels?.[0] ?? round2(close * 1.08);
  const target2 = curatedReport?.tradePlan?.target2 ?? techRole?.resistanceLevels?.[1] ?? round2(close * 1.16);
  const maxPositionPct = curatedReport?.tradePlan?.maxPositionPct ?? riskRole?.maxPositionPct ?? 15;

  const hasCustom = extraRoles.length > 0;
  const leaderHeadline =
    curatedReport?.leader?.headline && !hasCustom
      ? curatedReport.leader.headline
      : `${stock.code} ${stock.name}｜六角色交叉審查 ${compositeScore} 分：${consensus.label}`;

  const leaderVerdict =
    curatedReport?.leader?.verdict && !hasCustom
      ? curatedReport.leader.verdict
      : `班長完成 ${allRoles.length} 個獨立角色交叉審查（偏多 ${tally.bull} · 中性/等待 ${tally.neutral + tally.warn} · 偏空/保守 ${tally.bear}），加權綜合評分 ${compositeScore}/100，最終裁決為「${consensus.label}」。建議單一倉位上限嚴控於 ${maxPositionPct}%，待價格於 ${entryLow}–${entryHigh} 出現止穩確認訊號後再分批執行，硬停損設於 ${stopLoss}，上檔壓力檢視 ${target1}／${target2}。`;

  const actionSteps =
    curatedReport?.leader?.actionSteps && !hasCustom
      ? curatedReport.leader.actionSteps
      : [
          `資金與倉位上限：單一標的嚴控在總資金 ${maxPositionPct}% 以內，禁止無上限攤平。`,
          `進場確認原則：先觀察 ${entryLow}–${entryHigh} 支撐帶是否縮量止穩，等待反彈結構與籌碼同步改善後再分階段進場。`,
          `防守硬停損點：若有效跌破 ${stopLoss} 立即執行停損紀律，防止回撤失控。`,
          `壓力檢視目標：反彈先看 ${target1}、波段目標 ${target2}，遇壓視量能決定減碼或續抱。`
        ];

  return {
    symbol: stock.symbol,
    code: stock.code,
    name: stock.name,
    evaluatedDate: m.date || summary?.latestTradingDate || new Date().toISOString().slice(0, 10),
    compositeScore,
    stance: consensus.label,
    stanceCode: consensus.code,
    tone: consensus.tone,
    isCuratedTeamReport: Boolean(curatedReport),
    customOpinionCount: extraRoles.length,
    crossReviewTally: tally,
    leader: {
      title: "投資團隊班長・六角色交叉審查最終決策",
      headline: leaderHeadline,
      verdict: leaderVerdict,
      actionSteps,
      dissentNote:
        curatedReport?.leader?.dissentNote ||
        `六大獨立角色交叉審查分歧摘要：偏多 ${tally.bull} 票、觀望／等待 ${tally.neutral + tally.warn} 票、偏空／保守 ${tally.bear} 票；班長採納風險管理師與交易策略師之紀律底線。`
    },
    tradePlan: {
      entryLow,
      entryHigh,
      stopLoss,
      target1,
      target2,
      maxPositionPct
    },
    roles: allRoles
  };
}
