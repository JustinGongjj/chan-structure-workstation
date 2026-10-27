'use strict';
/**
 * 信号与择时方法的历史检验（不是承诺胜率，而是把"准不准"变成可测量的数字）
 *
 * 两个能力：
 *  1) signalStats —— 缠论买卖点在**同一标的、同一级别**上的历史表现
 *     （命中率 / 平均前向收益 / 最大不利偏移 / 盈亏比 / 样本数）
 *  2) timingStats —— 任一择时方法的每日评分与次日涨跌的相关性检验
 *
 * 全部基于已有 K 线，不发新请求；交易成本按 bps 计。
 */

/* ------------------------------------------------------------------ */
/* 1. 买卖点历史表现                                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {Array} bars      与分析结果同序的 K 线
 * @param {Array} signals   analyze() 输出的 signals
 * @param {Object} opts     { horizon=5, feeBps=8, stopAtr? }
 */
function signalStats(bars, signals, opts = {}) {
  const horizon = Math.max(1, Math.min(60, opts.horizon || 5));
  const feeBps = Number.isFinite(opts.feeBps) ? opts.feeBps : 8;
  const byType = {};
  const rows = [];

  for (const s of signals || []) {
    const entryIdx = s.barIdx;
    const exitIdx = entryIdx + horizon;
    if (exitIdx >= bars.length) continue; // 还没走完的样本不计入
    const isBuy = s.type.endsWith('B');
    const entry = bars[entryIdx].c;
    const exit = bars[exitIdx].c;
    // 买入：涨为赢；卖出（做空/离场）：跌为赢
    const raw = isBuy ? (exit - entry) / entry : (entry - exit) / entry;
    const net = raw - feeBps / 10000;
    // 最不利偏移（买入看最低价，卖出看最高价）
    let mae = 0;
    for (let i = entryIdx + 1; i <= exitIdx; i++) {
      const b = bars[i];
      const adv = isBuy ? (b.l - entry) / entry : (entry - b.h) / entry;
      if (adv < mae) mae = adv;
    }
    const row = {
      type: s.type,
      barIdx: entryIdx,
      t: bars[entryIdx].t,
      entry,
      exit,
      ret: +net.toFixed(5),
      mae: +mae.toFixed(5),
      win: net > 0,
      horizon,
    };
    rows.push(row);
    const cur = byType[s.type] || (byType[s.type] = { type: s.type, n: 0, wins: 0, sumRet: 0, sumWin: 0, sumLoss: 0, worst: 0, best: 0 });
    cur.n++;
    if (row.win) {
      cur.wins++;
      cur.sumWin += net;
    } else {
      cur.sumLoss += Math.abs(net);
    }
    cur.sumRet += net;
    cur.worst = Math.min(cur.worst, net);
    cur.best = Math.max(cur.best, net);
  }

  const summary = {};
  for (const [type, r] of Object.entries(byType)) {
    const avg = r.sumRet / r.n;
    const pf = r.sumLoss > 0 ? r.sumWin / r.sumLoss : r.sumWin > 0 ? Infinity : 0;
    summary[type] = {
      type,
      n: r.n,
      winRate: +(r.wins / r.n).toFixed(4),
      avgRet: +avg.toFixed(5),
      profitFactor: Number.isFinite(pf) ? +pf.toFixed(2) : null,
      best: +r.best.toFixed(5),
      worst: +r.worst.toFixed(5),
      expectancy: +avg.toFixed(5),
    };
  }
  const all = rows.length
    ? {
        n: rows.length,
        winRate: +(rows.filter((r) => r.win).length / rows.length).toFixed(4),
        avgRet: +(rows.reduce((a, b) => a + b.ret, 0) / rows.length).toFixed(5),
      }
    : { n: 0, winRate: null, avgRet: null };

  // 基线：同级别随机持有 horizon 根的平均收益，用于判断信号是否有超额
  const baseline = baselineReturn(bars, horizon, feeBps);

  return {
    horizon,
    feeBps,
    byType: summary,
    overall: all,
    baseline,
    edge: all.avgRet != null && baseline.avgRet != null ? +(all.avgRet - baseline.avgRet).toFixed(5) : null,
    samples: rows.slice(-40),
  };
}

function baselineReturn(bars, horizon, feeBps) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + horizon < bars.length; i++) {
    const a = bars[i].c;
    const b = bars[i + horizon].c;
    sum += (b - a) / a - feeBps / 10000;
    n++;
  }
  return { n, avgRet: n ? +(sum / n).toFixed(5) : null };
}

/* ------------------------------------------------------------------ */
/* 2. 择时方法的历史检验                                                */
/* ------------------------------------------------------------------ */

/**
 * 对过去 days 个交易日逐日打分，检验"高分日次日是否更容易涨"。
 * @param {Array} bars         日线（或任意级别）K 线
 * @param {Function} scoreFn   (ts) => { composite: 0..100, methods: {...} }
 * @param {Object} opts        { days=120, horizon=1, feeBps=0, threshold=60 }
 */
function timingStats(bars, scoreFn, opts = {}) {
  const days = Math.max(30, Math.min(750, opts.days || 160));
  const horizon = Math.max(1, Math.min(20, opts.horizon || 1));
  const start = Math.max(0, bars.length - days - horizon);
  const rows = []; // { score, fwd, methods: {id: score} }

  for (let i = start; i + horizon < bars.length; i++) {
    let res = null;
    try {
      res = scoreFn(bars[i].t);
    } catch (e) {
      continue;
    }
    if (!res || !Number.isFinite(res.composite)) continue;
    rows.push({
      t: bars[i].t,
      score: res.composite,
      fwd: (bars[i + horizon].c - bars[i].c) / bars[i].c,
      methods: Object.fromEntries(Object.entries(res.methods || {}).map(([id, m]) => [id, m.score])),
    });
  }

  const n = rows.length;
  const base = baselineReturn(bars.slice(start), horizon, 0);
  const q = (arr, p) => {
    if (!arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.floor((a.length - 1) * p)))];
  };
  const scores = rows.map((r) => r.score);
  const hiTh = Number.isFinite(opts.threshold) ? opts.threshold : q(scores, 0.7);
  const loTh = Number.isFinite(opts.lowThreshold) ? opts.lowThreshold : q(scores, 0.3);

  const bucket = (list, fn) => {
    const sel = list.filter(fn);
    if (!sel.length) return { n: 0, winRate: null, avgRet: null };
    const wins = sel.filter((r) => r.fwd > 0).length;
    return {
      n: sel.length,
      winRate: +(wins / sel.length).toFixed(4),
      avgRet: +(sel.reduce((a, b) => a + b.fwd, 0) / sel.length).toFixed(5),
    };
  };

  const corr = pearson(
    rows.map((r) => r.score),
    rows.map((r) => r.fwd)
  );

  const per = {};
  for (const id of Object.keys(rows[0] ? rows[0].methods : {})) {
    const rs = rows.filter((r) => Number.isFinite(r.methods[id]));
    per[id] = {
      id,
      corr: pearson(
        rs.map((r) => r.methods[id]),
        rs.map((r) => r.fwd)
      ),
      high: bucket(rs, (r) => r.methods[id] >= hiTh),
      low: bucket(rs, (r) => r.methods[id] <= loTh),
      n: rs.length,
    };
  }
  for (const m of Object.values(per)) {
    m.spread = m.high.winRate != null && m.low.winRate != null ? +(m.high.winRate - m.low.winRate).toFixed(4) : null;
    m.edge = m.high.avgRet != null && base.avgRet != null ? +(m.high.avgRet - base.avgRet).toFixed(5) : null;
  }

  const compositeStats = {
    high: bucket(rows, (r) => r.score >= hiTh),
    mid: bucket(rows, (r) => r.score > loTh && r.score < hiTh),
    low: bucket(rows, (r) => r.score <= loTh),
  };

  return {
    days: n,
    horizon,
    thresholds: { high: hiTh, low: loTh },
    baseline: base,
    corr,
    composite: compositeStats,
    methods: Object.values(per).sort((a, b) => Math.abs(b.corr || 0) - Math.abs(a.corr || 0)),
    verdict: buildVerdict(compositeStats, Object.values(per), base, corr, n),
  };
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 8) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return +(sxy / Math.sqrt(sxx * syy)).toFixed(4);
}

function buildVerdict(composite, methods, base, corr, n) {
  if (!n || n < 20) return { level: 'insufficient', text: `样本不足（${n || 0} 个交易日），不足以判断这个方法是否有效` };
  const best = methods.filter((m) => m.n >= 15).sort((a, b) => Math.abs(b.corr || 0) - Math.abs(a.corr || 0))[0];
  const hi = composite.high;
  const parts = [];
  parts.push(`样本 ${n} 日，综合分与次日收益相关系数 r=${corr == null ? '—' : corr}`);
  if (hi.n) parts.push(`高分组胜率 ${(hi.winRate * 100).toFixed(1)}%（n=${hi.n}），相对随机基线 ${((hi.avgRet - base.avgRet) * 100).toFixed(2)}pp/次`);
  if (best) parts.push(`分方法相关性最高：${best.id}（r=${best.corr == null ? '—' : best.corr}，n=${best.n}）`);
  let level = 'neutral';
  if (corr != null && corr >= 0.1) level = 'positive';
  else if (corr != null && corr <= -0.1) level = 'negative';
  parts.push(
    level === 'positive'
      ? '样本内呈现弱正相关，但很可能是多重比较的偶然结果——必须用样本外数据复验后才可参考'
      : level === 'negative'
      ? '分值越高反而越弱（负相关），本标的/本级别上不应据此择时'
      : '与随机无显著差异；把它当纪律工具，不要当信号源'
  );
  return { level, text: parts.join('；') };
}

module.exports = { signalStats, timingStats, baselineReturn };
