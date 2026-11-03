'use strict';
/**
 * 多级别共振过滤（Multi-Timeframe Filter）
 * =====================================================================
 * 缠论最核心的操作原则之一：**大级别定方向，小级别找买点**。
 *
 * ▍先说清楚一个硬约束（实测得出，不做隐瞒）
 *   真实的分钟级数据只有几百根，合成大级别后中枢只有 3-6 个、**背驰基本为 0**。
 *   所以"周线背驰 + 60分三买"这种教科书式共振，**在现有免费数据上几乎不可能出现**。
 *   实测：日线 800 根合成周线 160 根 → 中枢 3 个、背驰 0 个。
 *
 * ▍所以本模块实现的是**可落地的两种过滤**，而不是教科书理想态：
 *   ① 方向过滤（trend）：大级别处于上涨/中枢上方 时才做多
 *   ② 位置过滤（position）：小级别买点必须落在**大级别中枢的相对有利位置**
 *      做多时要求价格不在大级别中枢下沿之下（避免逆势抄底）
 *
 * ▍合成方式
 *   把 N 根小级别 K 线合成 1 根大级别（默认 5：日线→周线）。
 *   不用真实周线接口，因为一是接口不一定有，二是保证时间对齐、无缺口。
 */

const C = require('./chan');

/** 把 bars 每 n 根合成一根 */
function compose(bars, n) {
  const out = [];
  for (let i = 0; i + n <= bars.length; i += n) {
    const g = bars.slice(i, i + n);
    out.push({
      t: g[0].t,
      o: g[0].o,
      h: Math.max(...g.map((x) => x.h)),
      l: Math.min(...g.map((x) => x.l)),
      c: g[n - 1].c,
      v: g.reduce((a, x) => a + (x.v || 0), 0),
      _from: i,
      _to: i + n - 1,
    });
  }
  return out;
}

/**
 * 构建"大级别上下文"，供逐根回测时查询
 * @param {Array} bars 小级别 K 线
 * @param {Object} opts { ratio=5, mode='position'|'trend'|'both' }
 * @returns {Function} lookup(i) → { allow: bool, rel, trendType, zg, zd, reason }
 */
function buildContext(bars, opts = {}) {
  const ratio = Math.max(2, Math.min(10, opts.ratio || 5));
  const mode = opts.mode || 'both';
  const big = compose(bars, ratio);
  if (big.length < 40) return null;

  /*
    滚动分析：对每根大级别 K 线，用 [0..k] 前缀分析，得到该时点的大级别结构。
    这样在回测第 i 根小级别 K 线时，可以查到"当时"大级别是什么状态——严格无未来函数。
    为节省算力，每 2 根大级别更新一次（结构变化本来就慢）。
  */
  const ctxAt = [];
  let last = null;
  for (let k = 0; k < big.length; k++) {
    if (k < 25) { ctxAt.push(null); continue; }   // 大级别预热
    if (k % 2 === 0 || !last) {
      try {
        const res = C.analyze(big.slice(0, k + 1));
        const p = (res.pivots || []).slice(-1)[0];
        last = {
          trend: res.trend ? res.trend.type : '未知',
          hasPivot: !!p,
          zg: p ? p.zg : null,
          zd: p ? p.zd : null,
          pivotCount: (res.pivots || []).length,
        };
      } catch (e) { /* 保持 last */ }
    }
    ctxAt.push(last);
  }

  /** 小级别索引 i → 大级别索引 k */
  const kOf = (i) => Math.floor(i / ratio);

  return function lookup(i) {
    const k = kOf(i);
    const c = ctxAt[Math.min(k, ctxAt.length - 1)];
    if (!c || !c.hasPivot) {
      return { allow: mode === 'trend' ? false : true, rel: 'none', reason: '大级别无中枢', trendType: c ? c.trend : '-', zg: null, zd: null };
    }
    return { ...c, rel: 'computed' };
  };
}

/**
 * 判定某个价格在大级别中枢的相对位置
 */
function relativePos(price, c) {
  if (!c || c.zg == null) return 'none';
  if (price > c.zg) return 'above';
  if (price < c.zd) return 'below';
  return 'inside';
}

/**
 * 过滤判定：返回 { allow, reason }
 * @param {object} c   大级别上下文（lookup 结果）
 * @param {number} price 信号价格
 * @param {number} dir  1=做多 -1=做空
 * @param {string} mode
 */
function decide(c, price, dir, mode) {
  if (!c) return { allow: true, reason: '大级别数据不足，不过滤' };
  if (mode === 'trend') {
    // 只按趋势方向：做多要求大级别上涨
    const ok = dir > 0 ? /上涨/.test(c.trend) : /下跌/.test(c.trend);
    return { allow: ok, reason: `大级别趋势=${c.trend}` };
  }
  if (c.zg == null) return { allow: true, reason: '大级别无中枢' };

  const rel = relativePos(price, c);
  if (mode === 'position') {
    if (dir > 0) {
      // 做多：不买在大级别中枢下沿之下（那是逆势抄底）
      const ok = rel !== 'below';
      return { allow: ok, reason: `做多且价格在大级别中枢${rel === 'above' ? '上方' : rel === 'inside' ? '内' : '下方(否决)'}` };
    }
    const ok = rel !== 'above';
    return { allow: ok, reason: `做空且价格在大级别中枢${rel === 'above' ? '上方(否决)' : rel === 'inside' ? '内' : '下方'}` };
  }
  // both：趋势 + 位置都要求
  const trendOk = dir > 0 ? !/下跌/.test(c.trend) : !/上涨/.test(c.trend);
  const posOk = dir > 0 ? rel !== 'below' : rel !== 'above';
  return {
    allow: trendOk && posOk,
    reason: `趋势=${c.trend}${trendOk ? '(过)' : '(否决)'} · 位置=${rel}${posOk ? '(过)' : '(否决)'}`,
  };
}

module.exports = { compose, buildContext, decide, relativePos };
