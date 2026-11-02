'use strict';
/**
 * 批量回测（多标的 × 多参数）
 * =====================================================================
 * 为什么必须批量：缠论信号天生稀疏。
 * 实测 600519 日线 801 根只有 6 个信号、2 个背驰；15 个中枢里只有 1 个满足三买。
 * 单标的回测的样本量永远不够，结论不可信。
 *
 * 所以正确做法是：
 *   ① 同一套规则套到 N 个标的上，汇总所有交易 → 用汇总样本判断因子有效性
 *   ② 再看**分布**：多少标的跑赢、多少跑输（不能只看平均值，个别标的暴利会骗人）
 *
 * ▍关键统计口径
 *   · 汇总胜率 / 期望 = 所有标的的交易合并统计（不是各标的平均）
 *   · 标的层面胜率 = 跑赢基准的标的占比（衡量"普适性"）
 *   · 中位数优先于均值：极值会让均值失真
 */

const { runBacktest } = require('./btengine');

/**
 * @param {Array} symbols  [{ market, code, bars }]
 * @param {Object} opts    回测参数
 * @returns 汇总结果
 */
function runBatch(symbols, opts = {}) {
  const rows = [];
  const allTrades = [];

  for (const s of symbols) {
    const r = runBacktest(s.bars, opts);
    if (!r.ok) {
      rows.push({ market: s.market, code: s.code, ok: false, error: r.error });
      continue;
    }
    for (const t of r.trades) {
      allTrades.push({ ...t, market: s.market, code: s.code });
    }
    rows.push({
      market: s.market,
      code: s.code,
      ok: true,
      trades: r.stats.trades,
      winRate: r.stats.winRate,
      totalReturnPct: r.stats.totalReturnPct,
      benchmarkPct: r.stats.benchmarkPct,
      excessPct: r.stats.excessPct,
      maxDrawdownPct: r.stats.maxDrawdownPct,
      sharpe: r.stats.sharpe,
      profitFactor: r.stats.profitFactor,
      avgHoldBars: r.stats.avgHoldBars,
      years: r.stats.years,
    });
  }

  const okRows = rows.filter((r) => r.ok);
  const summary = summarize(rows, okRows, allTrades, opts);
  return { ok: true, summary, rows, trades: allTrades, params: opts };
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarize(rows, okRows, allTrades, opts) {
  const n = okRows.length;
  if (!n) return { symbols: 0, note: '没有任何标的回测成功' };

  const wins = allTrades.filter((t) => t.net > 0);
  const losses = allTrades.filter((t) => t.net <= 0);
  const grossWin = wins.reduce((a, t) => a + t.net, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.net, 0));

  const excesses = okRows.map((r) => r.excessPct);
  const beat = okRows.filter((r) => r.excessPct > 0).length;
  const dds = okRows.map((r) => r.maxDrawdownPct);

  // 按信号类型汇总（跨标的）
  const byType = {};
  for (const t of allTrades) {
    const k = t.signalType || '?';
    if (!byType[k]) byType[k] = { n: 0, win: 0, sumPct: 0, sumNet: 0 };
    byType[k].n++;
    if (t.net > 0) byType[k].win++;
    byType[k].sumPct += t.netPct;
    byType[k].sumNet += t.net;
  }
  const typeStats = Object.entries(byType).map(([type, v]) => ({
    type,
    n: v.n,
    winRate: +(v.win / v.n * 100).toFixed(1),
    avgPct: +(v.sumPct / v.n).toFixed(2),
    totalNet: +v.sumNet.toFixed(2),
    share: +(v.n / allTrades.length * 100).toFixed(1),
  })).sort((a, b) => b.n - a.n);

  // 按市场汇总
  const byMarket = {};
  for (const r of okRows) {
    if (!byMarket[r.market]) byMarket[r.market] = { n: 0, beat: 0, excess: [], trades: 0 };
    byMarket[r.market].n++;
    if (r.excessPct > 0) byMarket[r.market].beat++;
    byMarket[r.market].excess.push(r.excessPct);
    byMarket[r.market].trades += r.trades;
  }
  const marketStats = Object.entries(byMarket).map(([m, v]) => ({
    market: m,
    symbols: v.n,
    beatRate: +(v.beat / v.n * 100).toFixed(1),
    medianExcess: +median(v.excess).toFixed(2),
    trades: v.trades,
  }));

  return {
    symbols: n,
    failed: rows.length - n,
    totalTrades: allTrades.length,
    /* 汇总口径（所有交易合并） */
    winRate: allTrades.length ? +(wins.length / allTrades.length * 100).toFixed(1) : 0,
    avgNetPct: allTrades.length ? +(allTrades.reduce((a, t) => a + t.netPct, 0) / allTrades.length).toFixed(2) : 0,
    medianNetPct: median(allTrades.map((t) => t.netPct)) != null ? +median(allTrades.map((t) => t.netPct)).toFixed(2) : null,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : null,
    avgHoldBars: allTrades.length ? +(allTrades.reduce((a, t) => a + t.bars, 0) / allTrades.length).toFixed(1) : 0,
    /* 标的层面（衡量普适性，比均值可靠） */
    beatBenchmark: beat,
    beatRate: +(beat / n * 100).toFixed(1),
    medianExcessPct: +median(excesses).toFixed(2),
    meanExcessPct: +(excesses.reduce((a, b) => a + b, 0) / n).toFixed(2),
    medianDrawdownPct: +median(dds).toFixed(2),
    worstDrawdownPct: +Math.max(...dds).toFixed(2),
    typeStats,
    marketStats,
    verdict: verdictOf(beat, n, allTrades, median(excesses)),
  };
}

/** 因子有效性判定：样本量、普适性、期望值三条线 */
function verdictOf(beat, n, trades, medExcess) {
  const reasons = [];
  let level = 'inconclusive';

  if (trades.length < 30) {
    reasons.push(`样本 ${trades.length} 笔不足 30，无法下结论`);
    return { level: 'insufficient', text: '样本不足：需要更多标的或更长区间', reasons };
  }
  const beatRate = beat / n * 100;
  if (beatRate >= 60 && medExcess > 0 && trades.length >= 100) {
    level = 'effective';
    reasons.push(`${beatRate.toFixed(0)}% 的标的跑赢基准（≥60%），中位超额 ${medExcess.toFixed(2)}%，样本 ${trades.length} 笔`);
  } else if (beatRate <= 40 || medExcess < 0) {
    level = 'ineffective';
    reasons.push(`仅 ${beatRate.toFixed(0)}% 标的跑赢，中位超额 ${medExcess.toFixed(2)}% → 该参数下没有稳定优势`);
  } else {
    level = 'marginal';
    reasons.push(`${beatRate.toFixed(0)}% 标的跑赢，中位超额 ${medExcess.toFixed(2)}%：边缘有效，需更大样本确认`);
  }
  if (trades.length < 100) reasons.push(`样本 ${trades.length} 笔（<100），结论偏弱`);
  return {
    level,
    text: level === 'effective' ? '具备稳定超额（仍需样本外验证）'
      : level === 'ineffective' ? '未见稳定优势'
      : level === 'marginal' ? '边缘有效，证据不足' : '样本不足',
    reasons,
  };
}

module.exports = { runBatch, summarize };
