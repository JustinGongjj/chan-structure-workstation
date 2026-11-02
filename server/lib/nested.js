'use strict';
/**
 * 递归区间套（Interval Nesting / 区间套的递归实现）
 * ==================================================================
 * 缠论原文的"区间套"是三段递归：
 *   ① 大级别进入背驰段 →
 *   ② 在该段的**时间范围**里，到次级别去找对应的中枢/背驰 →
 *   ③ 次级别里再找更次级别……
 * 直到最小级别出现明确买卖点。这才是"精确制导"，而不是把 6 个周期各算一遍再数个数。
 *
 * 本模块的递归定义：
 *   nest(level i) = {
 *     period, pivot(s),   // 本级中枢
 *     zone: [t0, t1],     // 本级中枢/背驰段的时间窗
 *     children: [ nest(level i+1) 限制在 zone 内 ]   ← 递归
 *   }
 *
 * 关键约束（也是之前实现失败的原因）：
 *   小级别必须覆盖到大级别的时间窗。600 根 5 分钟线只有 2~18 天，
 *   根本盖不住一个日线中枢（几十天）。所以这里会**如实报告截断**，
 *   而不是假装递归成功。
 */

const C = require('./chan');

/* 级别从大到小，用于递归下降 */
const LEVEL_CHAIN = {
  A: ['month', 'week', 'day', '60m', '30m'],
  HK: ['week', 'day'],
  US: ['week', 'day'],
  CR: ['week', 'day', '60m', '30m'],
  CNF: ['week', 'day', '60m', '30m'],
  USF: ['week', 'day', '60m', '30m'],
};

const MAX_DEPTH = 4;

/**
 * @param {object} opts
 * @param {function} opts.fetchLevel  async (period) => { bars, source }
 * @param {string}   opts.market
 * @param {string}   opts.code
 * @returns {Promise<object>} 递归树
 */
async function buildNest({ fetchLevel, market, code }) {
  const chain = LEVEL_CHAIN[String(market || 'A').toUpperCase()] || ['day'];
  const cache = new Map();
  const load = async (period) => {
    if (cache.has(period)) return cache.get(period);
    let v;
    try {
      const raw = await fetchLevel(period);
      if (!raw || !raw.bars || raw.bars.length < 60) throw new Error('数据不足（<60 根）');
      const res = C.analyze(raw.bars, { period, market, code });
      v = { ok: true, res, source: raw.source };
    } catch (e) {
      v = { ok: false, error: String(e.message || e) };
    }
    cache.set(period, v);
    return v;
  };

  /*
    递归：在 [t0, t1] 时间窗内，用 period 级别找中枢
    depth 防止无限递归；每下降一级就把窗口收紧到"最近一个中枢"
  */
  async function recurse(depth, window) {
    if (depth >= chain.length || depth >= MAX_DEPTH) return null;
    const period = chain[depth];
    const got = await load(period);
    if (!got.ok) {
      return { period, depth, ok: false, error: got.error };
    }
    const { res } = got;
    const bars = res.bars;

    // 数据能否覆盖上级给的时间窗？覆盖不到就要如实标注
    const coverFrom = bars[0].t;
    const coverTo = bars[bars.length - 1].t;
    let coverage = 'full';
    let coverRatio = 1;
    if (window) {
      const need = window[1] - window[0];
      const have = Math.min(window[1], coverTo) - Math.max(window[0], coverFrom);
      coverRatio = need > 0 ? Math.max(0, Math.min(1, have / need)) : 1;
      if (coverRatio < 0.5) coverage = 'insufficient';
      else if (coverRatio < 0.95) coverage = 'partial';
    }

    // 本级中枢：落在时间窗内的那些（没有窗口就取最近一个）
    const inWindow = (p) => !window || (p.t1 >= window[0] && p.t0 <= window[1]);
    const pivots = (res.pivots || []).filter(inWindow);
    const focus = pivots.length ? pivots[pivots.length - 1] : null;

    const node = {
      period,
      depth,
      ok: true,
      levelName: res.level && res.level.levelName,
      bars: bars.length,
      source: got.source,
      coverage,
      coverRatio: +coverRatio.toFixed(3),
      window: window ? [window[0], window[1]] : null,
      coverRange: [coverFrom, coverTo],
      pivot: focus
        ? { zg: focus.zg, zd: focus.zd, count: focus.count, t0: focus.t0, t1: focus.t1, upgraded: !!focus.upgraded }
        : null,
      pivotCount: pivots.length,
      price: res.stats.price,
      position: focus ? (res.stats.price > focus.zg ? 'above' : res.stats.price < focus.zd ? 'below' : 'inside') : 'none',
      trend: res.trend && res.trend.type,
      signal: pickRecentSignal(res),
      beichi: pickRecentBeichi(res),
      children: [],
    };

    /*
      递归下降条件（严格）：
        ① 本级确实有中枢（没中枢就没有区间套的意义）
        ② 数据覆盖足够（<50% 就别硬递归，会给出错误结论）
        ③ 还有更小级别
      窗口收紧到本级中枢的时间范围——这正是缠论"在背驰段里找次级别中枢"的做法
    */
    const canDescend = focus && coverage !== 'insufficient' && depth + 1 < chain.length && depth + 1 < MAX_DEPTH;
    if (canDescend) {
      const child = await recurse(depth + 1, [focus.t0, focus.t1]);
      if (child) node.children = [child];
    } else if (focus && coverage === 'insufficient') {
      node.descendBlocked = `次级别数据只覆盖本级的 ${(coverRatio * 100).toFixed(0)}%，无法递归`;
    }
    return node;
  }

  const root = await recurse(0, null);
  const tree = {
    market: String(market || 'A').toUpperCase(),
    code,
    chain,
    root,
    /* 递归结论：从最深层往回汇集 */
    verdict: verdictOf(root),
    flat: flatten(root),
  };
  return tree;
}

function pickRecentSignal(res) {
  const bars = res.bars.length;
  const s = [...(res.signals || [])].reverse().find((x) => x.barIdx >= bars - 30);
  if (!s) return null;
  return { type: s.type, name: s.name, price: +s.price.toFixed(3), barIdx: s.barIdx, agoBars: bars - 1 - s.barIdx };
}

function pickRecentBeichi(res) {
  const bars = res.bars.length;
  const b = [...(res.beichi || [])].reverse().find((x) => x.barIdx >= bars - 30);
  if (!b) return null;
  return { kind: b.kind, dir: b.dir, areaRatio: b.areaRatio, barIdx: b.barIdx, agoBars: bars - 1 - b.barIdx };
}

/** 递归结论：把各层的信号/背驰/位置汇总成一句话 */
function verdictOf(node) {
  if (!node || !node.ok) return { level: 'none', text: '数据不足，无法做区间套' };
  const layers = [];
  (function walk(n) {
    if (!n || !n.ok) return;
    layers.push(n);
    (n.children || []).forEach(walk);
  })(node);

  const withSignal = layers.filter((l) => l.signal);
  const withBei = layers.filter((l) => l.beichi);
  const deepest = layers[layers.length - 1];

  const buyLayers = withSignal.filter((l) => l.signal.type.endsWith('B'));
  const sellLayers = withSignal.filter((l) => l.signal.type.endsWith('S'));

  // 缠论区间套的判定：小级别买点 + 大级别背驰段 = 精确买点
  if (buyLayers.length && (withBei.some((l) => l.beichi.dir < 0) || buyLayers.length >= 2)) {
    return {
      level: 'buy',
      text: `区间套买点：${buyLayers.map((l) => l.period).join(' + ')} 出现买点，且大级别处于背驰段`,
      layers: buyLayers.map((l) => ({ period: l.period, name: l.signal.name, price: l.signal.price })),
    };
  }
  if (sellLayers.length && (withBei.some((l) => l.beichi.dir > 0) || sellLayers.length >= 2)) {
    return {
      level: 'sell',
      text: `区间套卖点：${sellLayers.map((l) => l.period).join(' + ')} 出现卖点，且大级别处于背驰段`,
      layers: sellLayers.map((l) => ({ period: l.period, name: l.signal.name, price: l.signal.price })),
    };
  }
  if (withSignal.length) {
    const l = withSignal[withSignal.length - 1];
    return { level: 'single', text: `只有 ${l.period} 出现 ${l.signal.name}，未形成多级别区间套`, layers: [{ period: l.period, name: l.signal.name, price: l.signal.price }] };
  }
  // 注意：不能只看最深层——最深层常常因为数据覆盖不足而没有中枢，
  // 但上层确实有中枢。要报"最深的那个有中枢的层"。
  const withPivot = layers.filter((l) => l.pivot);
  if (withPivot.length) {
    const d = withPivot[withPivot.length - 1];
    const blocked = deepest && deepest.descendBlocked ? `；${deepest.descendBlocked}` : '';
    return {
      level: 'none',
      text: `各层均无买卖点；最深处到 ${d.period}（中枢 ${d.pivot.zd.toFixed(2)}~${d.pivot.zg.toFixed(2)}，${d.pivot.count} 笔）${blocked}`,
    };
  }
  return { level: 'none', text: '各层均未形成有效中枢，无区间套可言' };
}

/** 把树压平成数组，便于前端逐行展示 */
function flatten(node, out = []) {
  if (!node) return out;
  const { children, ...rest } = node;
  out.push(rest);
  (children || []).forEach((c) => flatten(c, out));
  return out;
}

module.exports = { buildNest, LEVEL_CHAIN, MAX_DEPTH };
