'use strict';
/**
 * 组合层绩效归因指标（27 项）
 * =====================================================================
 * 借鉴自 czsc 的 auto-czsc-quant + wbt（权重回测）那套口径。
 *
 * ▍与本站原有回测（btengine）的区别
 *   btengine  = 单标的逐笔撮合，回答"按这套规则交易，资金曲线长什么样"
 *   本模块     = **组合层面绩效归因**，回答"这个策略在多个品种上整体表现如何"
 *   前者偏"交易层"，后者偏"组合层"。两套口径互补，不互相替代。
 *
 * ▍27 个指标口径（严格对齐 wbt，单位/方向都标注清楚）
 *   收益类：绝对收益 / 年化收益
 *   风险调整：夏普比率 / 卡玛比率
 *   回撤：最大回撤 / 新高占比 / 新高间隔
 *   波动：年化波动率 / 下行波动率
 *   交易：交易次数 / 年化交易次数 / 单笔盈亏比 / 单笔收益 / 交易胜率
 *   周期胜率：日胜率 / 周胜率 / 月胜率 / 季胜率 / 年胜率
 *   持仓：持仓K线数 / 多头占比 / 空头占比
 *   范围：品种数量 / 开始日期 / 结束日期
 *
 * ▍几个容易搞错的点（wbt 的实际口径）
 *   · 年化用 **252** 交易日折算（不是 365 日历天）
 *   · 卡玛 = 年化收益 / |最大回撤|
 *   · 单笔收益单位是 **BP（万分之一）**，不是 %
 *   · 新高间隔 = 两次新高之间的最大间隔（交易日）
 *   · 多头占比/空头占比按**持仓权重为正的 K 线数**占比
 */

const TRADING_DAYS = 252;

/* ------------------------- 基础工具 ------------------------- */

function mean(a) {
  if (!a.length) return 0;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function std(a, ddof = 1) {
  if (a.length < 2) return 0;
  const m = mean(a);
  const v = a.reduce((acc, x) => acc + (x - m) ** 2, 0) / (a.length - ddof);
  return Math.sqrt(Math.max(0, v));
}

/** 下行标准差：只统计低于目标的收益 */
function downsideStd(a, target = 0) {
  if (a.length < 2) return 0;
  const downs = a.map((x) => Math.min(0, x - target) ** 2);
  return Math.sqrt(downs.reduce((x, y) => x + y, 0) / a.length);
}

/* ------------------------- 日收益序列 → 各种统计 ------------------------- */

/**
 * 从日收益序列算绩效
 * @param {Array<{date:number, ret:number}>} daily 日收益（小数，0.01 = 1%）
 * @param {Object} opts { yearlyDays=252, rf=0 }
 */
function fromDailyReturns(daily, opts = {}) {
  const yearlyDays = opts.yearlyDays || TRADING_DAYS;
  const rf = opts.rf || 0;
  const rows = (daily || []).filter((d) => d && Number.isFinite(d.ret));
  if (rows.length < 2) {
    return { ok: false, error: `日收益样本不足（${rows.length} 条）` };
  }

  const rets = rows.map((d) => d.ret);
  const n = rets.length;

  /* 净值曲线（复利） */
  const nav = [];
  let v = 1;
  for (const r of rets) { v *= (1 + r); nav.push(v); }
  const finalNav = nav[nav.length - 1];

  /* 绝对收益 / 年化收益 */
  const absoluteReturn = (finalNav - 1) * 100;
  const years = n / yearlyDays;
  const annualReturn = (Math.pow(finalNav, 1 / Math.max(years, 1e-9)) - 1) * 100;

  /* 波动率 */
  const sd = std(rets);
  const annualVol = sd * Math.sqrt(yearlyDays) * 100;
  const dsd = downsideStd(rets, 0);
  const downVol = dsd * Math.sqrt(yearlyDays) * 100;

  /* 夏普 */
  const excess = mean(rets) - rf / yearlyDays;
  const sharpe = sd > 0 ? (excess / sd) * Math.sqrt(yearlyDays) : 0;

  /* 最大回撤 & 新高 */
  let peak = -Infinity, peakIdx = -1;
  let maxDD = 0, ddStart = -1, ddEnd = -1;
  let newHighCount = 0;
  let lastHighIdx = -1;
  let maxHighGap = 0;
  for (let i = 0; i < n; i++) {
    const nv = nav[i];
    if (nv > peak) {
      peak = nv;
      if (lastHighIdx >= 0) maxHighGap = Math.max(maxHighGap, i - lastHighIdx);
      lastHighIdx = i;
      newHighCount++;
      peakIdx = i;
    }
    const dd = peak > 0 ? (peak - nv) / peak : 0;
    if (dd > maxDD) { maxDD = dd; ddStart = peakIdx; ddEnd = i; }
  }
  const maxDrawdown = maxDD * 100;
  const newHighRatio = (newHighCount / n) * 100;

  /* 卡玛 */
  const calmar = maxDrawdown > 0 ? annualReturn / maxDrawdown : null;

  /* 周期胜率 */
  const bucketWin = (keyFn) => {
    const map = new Map();
    for (const d of rows) {
      const k = keyFn(new Date(d.date));
      map.set(k, (map.get(k) || 1) * (1 + d.ret));
    }
    const vals = [...map.values()].map((x) => x - 1);
    if (!vals.length) return { rate: 0, count: 0 };
    return { rate: (vals.filter((x) => x > 0).length / vals.length) * 100, count: vals.length };
  };
  const dayOfWeekKey = (dt) => `${dt.getFullYear()}-W${Math.floor(dt.getTime() / 604800000)}`;
  const monthKey = (dt) => `${dt.getFullYear()}-${dt.getMonth()}`;
  const quarterKey = (dt) => `${dt.getFullYear()}-Q${Math.floor(dt.getMonth() / 3)}`;
  const yearKey = (dt) => `${dt.getFullYear()}`;

  const dayWin = rets.filter((r) => r > 0).length / n * 100;
  const weekWin = bucketWin(dayOfWeekKey);
  const monthWin = bucketWin(monthKey);
  const quarterWin = bucketWin(quarterKey);
  const yearWin = bucketWin(yearKey);

  return {
    ok: true,
    /* 收益 */
    absoluteReturn: +absoluteReturn.toFixed(2),
    annualReturn: +annualReturn.toFixed(2),
    /* 风险调整 */
    sharpe: +sharpe.toFixed(2),
    calmar: calmar == null ? null : +calmar.toFixed(2),
    /* 回撤 */
    maxDrawdown: +maxDrawdown.toFixed(2),
    maxDrawdownRange: ddStart >= 0 && ddEnd >= 0 ? [rows[ddStart].date, rows[ddEnd].date] : null,
    newHighRatio: +newHighRatio.toFixed(2),
    /* 波动 */
    annualVolatility: +annualVol.toFixed(2),
    downsideVolatility: +downVol.toFixed(2),
    /* 周期胜率 */
    dayWinRate: +dayWin.toFixed(2),
    weekWinRate: +weekWin.rate.toFixed(2),
    monthWinRate: +monthWin.rate.toFixed(2),
    quarterWinRate: +quarterWin.rate.toFixed(2),
    yearWinRate: +yearWin.rate.toFixed(2),
    /* 新高间隔 */
    maxHighGap: maxHighGap,
    /* 范围 */
    startDate: rows[0].date,
    endDate: rows[n - 1].date,
    tradingDays: n,
    years: +years.toFixed(2),
  };
}

/**
 * 从持仓权重序列算组合层指标
 * @param {Array<{date:number, symbol:string, weight:number, price:number}>} weights
 * @param {Array<{date:number, ret:number}>} daily 日收益
 */
function fromWeights(weights, daily) {
  const w = weights || [];
  if (!w.length) return { tradeCount: 0, annualTradeCount: 0, longRatio: 0, shortRatio: 0, symbols: 0, avgHoldBars: 0 };

  const bySymbol = new Map();
  for (const x of w) {
    if (!bySymbol.has(x.symbol)) bySymbol.set(x.symbol, []);
    bySymbol.get(x.symbol).push(x);
  }

  /* 交易次数 = 权重发生变化的次数（按品种分别统计） */
  let tradeCount = 0;
  let heldBars = 0;
  let barsTotal = 0;
  for (const [, arr] of bySymbol) {
    arr.sort((a, b) => a.date - b.date);
    for (let i = 1; i < arr.length; i++) {
      if (Math.abs(arr[i].weight - arr[i - 1].weight) > 1e-12) tradeCount++;
    }
    for (const x of arr) {
      barsTotal++;
      if (Math.abs(x.weight) > 1e-12) heldBars++;
    }
  }

  const longBars = w.filter((x) => x.weight > 1e-12).length;
  const shortBars = w.filter((x) => x.weight < -1e-12).length;
  const nonFlat = longBars + shortBars;

  const days = (daily || []).length || 1;
  const years = days / TRADING_DAYS;

  return {
    tradeCount,
    annualTradeCount: years > 0 ? +(tradeCount / years).toFixed(1) : 0,
    longRatio: nonFlat ? +(longBars / nonFlat * 100).toFixed(2) : 0,
    shortRatio: nonFlat ? +(shortBars / nonFlat * 100).toFixed(2) : 0,
    symbols: bySymbol.size,
    avgHoldBars: barsTotal ? +(heldBars / bySymbol.size).toFixed(1) : 0,
    holdRatio: barsTotal ? +(heldBars / barsTotal * 100).toFixed(2) : 0,
  };
}

/**
 * 从逐笔交易算单笔指标
 * @param {Array<{netPct:number}>} trades 每笔的净收益百分比
 */
function fromTrades(trades) {
  const t = (trades || []).filter((x) => x && Number.isFinite(x.netPct));
  if (!t.length) return { tradeWinRate: 0, pnlRatio: null, avgTradeBP: 0, tradeCount: 0 };

  const wins = t.filter((x) => x.netPct > 0);
  const losses = t.filter((x) => x.netPct <= 0);
  const avgWin = wins.length ? mean(wins.map((x) => x.netPct)) : 0;
  const avgLoss = losses.length ? Math.abs(mean(losses.map((x) => x.netPct))) : 0;

  return {
    tradeWinRate: +(wins.length / t.length * 100).toFixed(2),
    /* 盈亏比 = 平均盈利 / 平均亏损 */
    pnlRatio: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : null,
    /* 单笔收益，BP（万分之一） */
    avgTradeBP: +(mean(t.map((x) => x.netPct)) * 100).toFixed(1),
    tradeCount: t.length,
  };
}

/**
 * 汇总成 27 项标准指标
 */
function buildAll27({ daily, weights, trades }) {
  const r = fromDailyReturns(daily);
  if (!r.ok) return r;
  const w = fromWeights(weights, daily);
  const t = fromTrades(trades);
  return {
    ok: true,
    /* 27 项，顺序与 wbt 报告一致 */
    metrics: {
      绝对收益: r.absoluteReturn,
      年化收益: r.annualReturn,
      夏普比率: r.sharpe,
      卡玛比率: r.calmar,
      新高占比: r.newHighRatio,
      '单笔盈亏比': t.pnlRatio,
      '单笔收益(BP)': t.avgTradeBP,
      日胜率: r.dayWinRate,
      周胜率: r.weekWinRate,
      月胜率: r.monthWinRate,
      季胜率: r.quarterWinRate,
      年胜率: r.yearWinRate,
      最大回撤: r.maxDrawdown,
      年化波动率: r.annualVolatility,
      下行波动率: r.downsideVolatility,
      新高间隔: r.maxHighGap,
      交易次数: w.tradeCount,
      年化交易次数: w.annualTradeCount,
      持仓K线数: w.avgHoldBars,
      交易胜率: t.tradeWinRate,
      多头占比: w.longRatio,
      空头占比: w.shortRatio,
      品种数量: w.symbols,
      开始日期: r.startDate,
      结束日期: r.endDate,
      /* 附：口径说明用的元信息（不计入 27 项） */
      _tradingDays: r.tradingDays,
      _years: r.years,
    },
    /* 方向标记：这些指标越小越好（用于前端配色） */
    inverted: ['最大回撤', '年化波动率', '下行波动率', '新高间隔'],
    detail: { daily: r, weights: w, trades: t },
  };
}

module.exports = { buildAll27, fromDailyReturns, fromWeights, fromTrades, TRADING_DAYS };
