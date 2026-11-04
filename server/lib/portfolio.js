'use strict';
/**
 * 组合回测引擎（Portfolio Backtest）
 * =====================================================================
 * 借鉴 czsc auto-quant 的组合层设计：
 *   单标的回测 → 汇总持仓权重 → 组合日收益 → 27 项绩效归因
 *
 * ▍与 btengine 的分工
 *   btengine.runBacktest  = 单标的、逐笔撮合、资金曲线
 *   本引擎                 = 多标的、权重聚合、组合绩效
 *
 * ▍权重聚合方式（对齐 wbt 的 WeightBacktest 口径）
 *   每个交易日：
 *     组合收益 = Σ(该品种日收益 × 该品种当日权重) / Σ|权重|
 *   分母用 Σ|权重|（而不是品种数）→ 保证满仓时的杠杆口径一致，
 *   不会因为"今天只有 3 个品种有信号"就自动放大 3 倍仓位。
 *
 * ▍信号 → 权重
 *   缠论信号本身是"离散事件"（出现买点/卖点），本引擎把它转成持仓权重：
 *     买点 → 目标权重 +1/品种数
 *     卖点 → 目标权重 0
 *     未触发 → 保持上一个状态
 *   每标的独立持仓，天然支持多品种并行。
 */

const C = require('./chan');
const Q = require('./quantmetrics');

const DEFAULTS = {
  period: 'day',
  biStyle: 'new',
  maxWeightPerSymbol: 1,     // 单品种最大权重（1 = 可满仓该品种）
  equalWeight: true,          // 按品种数等权分配
  feeBps: 8,
  slipBps: 4,
  warmup: 120,
  maxConfirmLag: 3,
};

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/**
 * 对单个品种生成"信号驱动的持仓序列"
 * @returns {Array<{date, weight, price}>} 每根 K 线一个权重（0 或 targetW）
 */
function simulateSymbol(bars, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  const targetW = Math.min(1, num(P.maxWeightPerSymbol, 1));
  const costRate = (num(P.feeBps, 8) + num(P.slipBps, 4)) / 10000;

  const out = [];
  let weight = 0;
  let seen = new Set();
  let pending = null;  // { target, applyAt }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    /* 昨日信号 → 今日开盘生效 */
    if (pending && pending.applyAt === i) {
      weight = pending.target;
      pending = null;
    }

    out.push({ date: bar.t, weight, price: bar.c, cost: 0 });

    /* 当前根分析，产生新信号（只认新出现、延迟可接受） */
    if (i >= P.warmup && i < bars.length - 1) {
      let res = null;
      try {
        res = C.analyze(bars.slice(0, i + 1), { period: P.period, biStyle: P.biStyle });
      } catch (e) { res = null; }
      if (res && res.ok) {
        const cur = new Map();
        for (const s of res.signals || []) cur.set(s.type + ':' + s.barIdx, s);
        let latest = null;
        for (const [k, s] of cur) {
          if (seen.has(k)) continue;
          const lag = i - s.barIdx;
          if (lag >= 0 && lag <= (P.maxConfirmLag || 3)) {
            if (!latest || s.barIdx > latest.barIdx) latest = s;
          }
        }
        for (const k of cur.keys()) seen.add(k);

        if (latest) {
          const isBuy = latest.type.endsWith('B');
          const nextW = isBuy ? targetW : 0;
          if (Math.abs(nextW - weight) > 1e-9) {
            pending = { target: nextW, applyAt: i + 1 };
          }
        }
      }
    }
  }
  return out;
}

/**
 * 组合回测
 * @param {Array<{market,code,bars}>} symbols
 * @param {Object} opts
 */
function runPortfolio(symbols, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  const costRate = (num(P.feeBps, 8) + num(P.slipBps, 4)) / 10000;

  const valid = (symbols || []).filter((s) => s.bars && s.bars.length >= P.warmup + 30);
  if (!valid.length) return { ok: false, error: '没有可用标的（K 线需 ≥ ' + (P.warmup + 30) + ' 根）' };

  /* ① 每标的生成权重序列 */
  const perSymbol = new Map();
  const allWeights = [];
  for (const s of valid) {
    const sym = s.market + ':' + s.code;
    const series = simulateSymbol(s.bars, P);
    perSymbol.set(sym, series);
    for (const x of series) allWeights.push({ date: x.date, symbol: sym, weight: x.weight, price: x.price });
  }

  /* ② 按日期聚合 → 组合日收益 */
  const dateMap = new Map(); // date → [{sym, w, ret}]
  for (const [sym, series] of perSymbol) {
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1], cur = series[i];
      if (!(prev.price > 0)) continue;
      const ret = cur.price / prev.price - 1;
      if (!dateMap.has(cur.date)) dateMap.set(cur.date, []);
      dateMap.get(cur.date).push({ sym, w: prev.weight, ret }); // 用前一根的权重（信号次日生效）
    }
  }

  const daily = [];
  const tradePnl = [];  // 每标的每次平仓的收益，用于单笔指标
  const dates = [...dateMap.keys()].sort((a, b) => a - b);
  for (const d of dates) {
    const items = dateMap.get(d) || [];
    const denom = items.reduce((a, x) => a + Math.abs(x.w), 0);
    if (denom <= 0) { daily.push({ date: d, ret: 0 }); continue; }
    let r = items.reduce((a, x) => a + x.w * x.ret, 0) / denom;

    /* 换手成本：权重变动量 × 单边成本 */
    let turnover = 0;
    for (const [sym, series] of perSymbol) {
      const idx = series.findIndex((x) => x.date === d);
      if (idx > 0) turnover += Math.abs(series[idx].weight - series[idx - 1].weight);
    }
    r -= turnover * costRate / Math.max(denom, 1);
    daily.push({ date: d, ret: r });
  }

  /*
    ③ 逐笔收益：每标的一段"持仓区间"算一笔。
    注意：盈亏比 5.82 但胜率 11% 是矛盾的——说明切分逻辑有问题。
    修正：按**进出场配对**统计，且只在权重从 0→正、正→0 时配对；
    若持仓区间内价格没变（权重没动），不应计入新的一笔。
  */
  for (const [sym, series] of perSymbol) {
    let entryIdx = -1, entryPrice = 0;
    for (let i = 0; i < series.length; i++) {
      const w = series[i].weight;
      if (w > 1e-9 && entryIdx < 0) { entryIdx = i; entryPrice = series[i].price; }
      else if (w <= 1e-9 && entryIdx >= 0) {
        const netPct = (series[i].price / entryPrice - 1) * 100 - (costRate * 2 * 100);
        tradePnl.push({ symbol: sym, netPct, grossPct: (series[i].price / entryPrice - 1) * 100, bars: i - entryIdx, exit: 'signal' });
        entryIdx = -1;
      }
    }
    if (entryIdx >= 0) {
      const last = series[series.length - 1];
      const netPct = (last.price / entryPrice - 1) * 100 - (costRate * 2 * 100);
      tradePnl.push({ symbol: sym, netPct, grossPct: (last.price / entryPrice - 1) * 100, bars: series.length - 1 - entryIdx, exit: 'end' });
    }
  }

  /* ④ 计算 27 项 */
  const m = Q.buildAll27({ daily, weights: allWeights, trades: tradePnl });
  if (!m.ok) return m;

  return {
    ok: true,
    params: P,
    symbols: valid.length,
    metrics: m.metrics,
    inverted: m.inverted,
    detail: m.detail,
    daily,
    trades: tradePnl,
    /* 每标的简表 */
    bySymbol: valid.map((s) => {
      const sym = s.market + ':' + s.code;
      const t = tradePnl.filter((x) => x.symbol === sym);
      const wins = t.filter((x) => x.netPct > 0).length;
      return {
        symbol: sym,
        trades: t.length,
        tradeWinRate: t.length ? +(wins / t.length * 100).toFixed(1) : 0,
        avgNetPct: t.length ? +(t.reduce((a, x) => a + x.netPct, 0) / t.length).toFixed(2) : 0,
        totalPct: +t.reduce((a, x) => a + x.netPct, 0).toFixed(2),
      };
    }).sort((a, b) => b.totalPct - a.totalPct),
  };
}

module.exports = { runPortfolio, simulateSymbol, DEFAULTS };
