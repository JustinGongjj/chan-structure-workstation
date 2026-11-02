'use strict';
/**
 * 递归区间套（Interval Nesting）—— 缠论"区间套"的真实递归实现
 * =====================================================================
 * 缠论原文的区间套判定逻辑：
 *   ① 本级别出现**背驰**（趋势力度衰竭）→ 该背驰所在的走势段就是"候选段"；
 *   ② 到这个候选段的**时间范围**里，去次级别找**中枢**；
 *   ③ 次级别中枢里若出现**买卖点**，且该买卖点与大级别背驰同向 → 区间套成立；
 *   ④ 若不成立，可在次级别的这个中枢里继续下钻（递归），直到最小级别。
 *
 * 关键设计（相比此前的实现）：
 *   · 窗口不再取"最近一个中枢"，而是取**背驰段 / 最后一个未完成走势**的真实范围；
 *   · 窗内中枢用"重心落在窗内"判定，而不是"有交集"（避免把跨窗的大中枢误纳）；
 *   · 每下降一级，窗口收紧到**该级窗内中枢的时间范围**，逐层收窄；
 *   · 数据覆盖不足时尝试**降级到更粗的级别**，而不是直接失败；
 *   · 每层都记录"为什么下降 / 为什么停止"，可解释、可追溯。
 */

const C = require('./chan');

/** 级别链：从大到小。只列数据源确实提供的级别。 */
const LEVEL_CHAIN = {
  A: ['month', 'week', 'day', '60m', '30m'],
  HK: ['week', 'day'],
  US: ['week', 'day'],
  CR: ['week', 'day', '60m', '30m'],
  CNF: ['week', 'day', '60m', '30m'],
  USF: ['week', 'day', '60m', '30m'],
};

const MAX_DEPTH = 4;
/** 窗口内中枢的"重心"必须落在此区间内才算属于该窗口 */
const CENTER_TOL = 0.15;
/** 数据覆盖率阈值 */
const COVER_OK = 0.95;
const COVER_PARTIAL = 0.5;
/*
  背驰/信号的"新鲜度"按**时间**判定而不是按根数。
  按根数的坑：周线 18 根≈4 个月，用"6 根"去卡会把 4 个月前的有效背驰判成过期；
  而 30 分钟的 40 根只有 3 天。同一个数字在不同级别含义完全不同。
  这里统一用"最多多久以前算当前有效"，各级别语义一致。
*/
const FRESH_DAYS = { month: 400, week: 150, day: 45, '60m': 14, '30m': 7 };

function freshCutoff(res, period) {
  const days = FRESH_DAYS[period] || 45;
  const lastT = res.bars[res.bars.length - 1].t;
  return lastT - days * 86400000;
}

/**
 * @param {object} opts
 * @param {(period:string)=>Promise<{bars:Array,source:string}>} opts.fetchLevel
 * @param {string} opts.market
 * @param {string} opts.code
 */
async function buildNest({ fetchLevel, market, code }) {
  const chain = LEVEL_CHAIN[String(market || 'A').toUpperCase()] || ['day'];
  const cache = new Map();

  const load = async (period) => {
    if (cache.has(period)) return cache.get(period);
    let v;
    try {
      const raw = await fetchLevel(period);
      if (!raw || !raw.bars || raw.bars.length < 60) throw new Error(`数据不足（${raw && raw.bars ? raw.bars.length : 0} 根）`);
      const res = C.analyze(raw.bars, { period, market, code });
      v = { ok: true, res, source: raw.source };
    } catch (e) {
      v = { ok: false, error: String(e.message || e) };
    }
    cache.set(period, v);
    return v;
  };

  /**
   * 在某一级别里，为一个时间窗挑选"最该被递归的中枢"
   *
   * 优先级（这就是"区间套"的精髓：不是随便挑一个中枢）：
   *   ① 窗口内有未完成的走势（最后一个中枢延伸到末尾）→ 取它，因为区间套找的就是"正在走的这一段"
   *   ② 否则取重心最靠近窗口末尾的中枢
   *   ③ 若窗口内无中枢，退而取与窗口重叠最多的中枢（并标注它是"跨窗"的）
   */
  function pickFocus(res, window, period, childCover) {
    const pivots = res.pivots || [];
    if (!pivots.length) return { focus: null, reason: '本级无中枢' };

    /*
      核心约束：选出癿中枢必须**能被次级别数据覆盖**。
      否则会出现"月线挑了个 2022 年的中枢 → 日线只有 2024 年以后的数据 → 覆盖 0%"这种空递归。
      childCover = [次级别最早时间, 次级别最新时间]（未知则不限）
    */
    const usable = (p) => {
      if (!childCover) return true;
      const need = p.t1 - p.t0;
      const have = Math.min(p.t1, childCover[1]) - Math.max(p.t0, childCover[0]);
      return need > 0 && have / need >= COVER_PARTIAL;
    };

    const span = window ? Math.max(1, window[1] - window[0]) : null;
    const scored = pivots.map((p) => {
      const center = (p.t0 + p.t1) / 2;
      const inWin = !window || (center >= window[0] - span * CENTER_TOL && center <= window[1] + span * CENTER_TOL);
      const overlap = !window ? 1 : Math.max(0, Math.min(window[1], p.t1) - Math.max(window[0], p.t0)) / span;
      const distToEnd = window ? Math.abs(p.t1 - window[1]) / span : 0;
      // 正在延伸 = 中枢末端贴近本级最后一根 K 线
      const lastT = res.bars[res.bars.length - 1].t;
      const firstT = res.bars[0].t;
      const ongoing = p.t1 >= lastT - (lastT - firstT) * 0.05;
      return { p, inWin, overlap, distToEnd, ongoing, usable: usable(p) };
    });

    // 优先只在"次级别可覆盖"的中枢里挑
    const candidates = scored.filter((s) => (window ? s.inWin && s.overlap > 0 : true));
    const usableCands = candidates.filter((s) => s.usable);
    if (usableCands.length) {
      const ongoing = usableCands.filter((s) => s.ongoing);
      const pool = ongoing.length ? ongoing : usableCands;
      pool.sort((a, b) => a.distToEnd - b.distToEnd);
      return {
        focus: pool[0].p,
        reason: ongoing.length ? '窗内正在延伸、且次级别可覆盖的中枢' : '窗内最靠近末尾、且次级别可覆盖的中枢',
        inWindow: true,
      };
    }
    // 窗内有中枢但次级别覆盖不到 → 明确告知，不要硬递归
    if (candidates.length) {
      return { focus: candidates[candidates.length - 1].p, reason: '窗内有中枢但次级别数据覆盖不足（结果仅供参考）', inWindow: true, weak: true };
    }
    // 跨窗兜底
    scored.sort((a, b) => b.overlap - a.overlap);
    if (scored[0] && scored[0].overlap > 0) {
      return { focus: scored[0].p, reason: '窗口内无中枢，取与窗口重叠最多的（跨窗）', inWindow: false };
    }
    return { focus: null, reason: '窗口内无任何中枢' };
  }

  /** 计算某级别数据对窗口的覆盖率 */
  function coverageOf(res, window) {
    const bars = res.bars;
    const from = bars[0].t;
    const to = bars[bars.length - 1].t;
    if (!window) return { coverRatio: 1, coverage: 'full', coverRange: [from, to] };
    const need = window[1] - window[0];
    const have = Math.min(window[1], to) - Math.max(window[0], from);
    const ratio = need > 0 ? Math.max(0, Math.min(1, have / need)) : 1;
    return {
      coverRatio: +ratio.toFixed(3),
      coverage: ratio >= COVER_OK ? 'full' : ratio >= COVER_PARTIAL ? 'partial' : 'insufficient',
      coverRange: [from, to],
    };
  }

  /** 找本级"当前有效"的信号与背驰 */
  function recentSignal(res, period) {
    const n = res.bars.length;
    const cutoff = freshCutoff(res, period);
    const s = [...(res.signals || [])].reverse().find((x) => res.bars[x.barIdx].t >= cutoff);
    if (!s) return null;
    return {
      type: s.type, name: s.name, price: +s.price.toFixed(4),
      barIdx: s.barIdx, agoBars: n - 1 - s.barIdx, t: res.bars[s.barIdx].t,
      agoDays: Math.round((res.bars[n - 1].t - res.bars[s.barIdx].t) / 86400000),
    };
  }
  function recentBeichi(res, period) {
    const n = res.bars.length;
    const cutoff = freshCutoff(res, period);
    const b = [...(res.beichi || [])].reverse().find((x) => res.bars[x.barIdx].t >= cutoff);
    if (!b) return null;
    const pair = b.pair || null;
    /*
      背驰段的精确窗口：
        缠论里"背驰段"指的是**力度衰竭的那一段本身**（本段），
        前段只是参照物。所以窗口 = [本段起点, 本段终点(背驰确认点)]。
      若没有 pair（旧数据结构），退化为 [barIdx 往前推一段, barIdx]。
    */
    const span = pair && pair.cur ? pair.cur.t1 - pair.cur.t0 : 0;
    const t0 = pair && pair.cur ? pair.cur.t0 : res.bars[Math.max(0, b.barIdx - 20)].t;
    const t1 = pair && pair.cur ? pair.cur.t1 : res.bars[b.barIdx].t;
    return {
      kind: b.kind,
      dir: b.dir,
      areaRatio: b.areaRatio,
      barIdx: b.barIdx,
      agoBars: n - 1 - b.barIdx,
      agoDays: Math.round((res.bars[n - 1].t - res.bars[b.barIdx].t) / 86400000),
      t: res.bars[b.barIdx].t,
      /* 精确窗口：本段起止 */
      segment: { t0, t1, bars: span ? Math.round(span / Math.max(1, (res.bars[1].t - res.bars[0].t))) : null },
      /* 参照段：面积对比的另一段 */
      refSegment: pair && pair.prev ? { t0: pair.prev.t0, t1: pair.prev.t1, area: pair.prev.area } : null,
      cur: pair && pair.cur ? { area: pair.cur.area, t0: pair.cur.t0, t1: pair.cur.t1, p0: pair.cur.p0, p1: pair.cur.p1 } : null,
      prev: pair && pair.prev ? { area: pair.prev.area, t0: pair.prev.t0, t1: pair.prev.t1, p0: pair.prev.p0, p1: pair.prev.p1 } : null,
    };
  }

  /**
   * 递归核心
   * @param {number} depth      当前深度
   * @param {[number,number]|null} window 上一级给的时间窗
   * @param {object|null} parent 上一级节点（用于继承方向）
   */
  async function recurse(depth, window, parent) {
    if (depth >= chain.length || depth >= MAX_DEPTH) {
      return { stop: '已达最大递归深度', depth };
    }
    const period = chain[depth];
    const got = await load(period);
    if (!got.ok) {
      return { period, depth, ok: false, error: got.error, stop: got.error };
    }
    const { res } = got;
    const cov = coverageOf(res, window);
    const sig = recentSignal(res, period);
    const bei = recentBeichi(res, period);
    // 预先取次级别的数据范围，用于判断"这个中枢值不值得下钻"
    let childCover = null;
    if (depth + 1 < chain.length && depth + 1 < MAX_DEPTH) {
      const nxt = await load(chain[depth + 1]);
      if (nxt.ok) {
        const b2 = nxt.res.bars;
        childCover = [b2[0].t, b2[b2.length - 1].t];
      }
    }
    const { focus, reason, inWindow, weak } = pickFocus(res, window, period, childCover);

    const node = {
      period,
      depth,
      ok: true,
      levelName: (res.level && res.level.levelName) || period,
      bars: res.bars.length,
      source: got.source,
      ...cov,
      window: window ? [window[0], window[1]] : null,
      pivot: focus
        ? {
            zg: +focus.zg.toFixed(4),
            zd: +focus.zd.toFixed(4),
            count: focus.count,
            t0: focus.t0,
            t1: focus.t1,
            upgraded: !!focus.upgraded,
            overlapWithWindow: inWindow,
          }
        : null,
      pivotCount: (res.pivots || []).length,
      pivotReason: reason,
      weakFocus: !!weak,
      price: res.stats.price,
      position: focus ? (res.stats.price > focus.zg ? 'above' : res.stats.price < focus.zd ? 'below' : 'inside') : 'none',
      trend: res.trend && res.trend.type,
      signal: sig,
      beichi: bei,
      /* 与上级背驰是否同向 —— 区间套成立的必要条件 */
      agreeWithParent: parent && parent.beichi && bei ? Math.sign(parent.beichi.dir) === Math.sign(bei.dir) : null,
      children: [],
    };

    // 停止条件：数据不足 / 无中枢 / 到达最末级
    if (cov.coverage === 'insufficient') {
      const needFrom = new Date(window[0]).toISOString().slice(0, 10);
      const haveFrom = new Date(cov.coverRange[0]).toISOString().slice(0, 10);
      const haveTo = new Date(cov.coverRange[1]).toISOString().slice(0, 10);
      // 区分两种"覆盖不足"：完全不重叠 vs 只覆盖一部分，给的建议不同
      const disjoint = cov.coverRange[1] < window[0] || cov.coverRange[0] > window[1];
      node.descendBlocked = disjoint
        ? `数据源只提供 ${period} 级别近期的 ${haveFrom}~${haveTo}，与本窗（${needFrom} 起）无重叠，无法递归到该级别`
        : `次级别数据只覆盖本窗的 ${(cov.coverRatio * 100).toFixed(0)}%（本窗需覆盖 ${needFrom} 起，实际只有 ${haveFrom}~${haveTo}）`;
      node.descendBlockedHint = disjoint ? '可用更大周期（如日线/周线）看图，或换标的重试' : '结论仅供参考';
      node.stopReason = 'coverage';
      return node;
    }
    if (!focus) {
      node.descendBlocked = `本级窗口内没有中枢（${reason}），无需继续下钻`;
      node.stopReason = 'no-pivot';
      return node;
    }
    if (depth + 1 >= chain.length || depth + 1 >= MAX_DEPTH) {
      node.stopReason = 'max-depth';
      return node;
    }

    /*
      窗口收紧：从"本级中枢的完整范围"改为
        · 若本级出现了信号 → 收紧到信号附近（前后各 1/3 中枢跨度），更精准
        · 否则 → 收紧到本级中枢的完整范围
      这正是缠论"在背驰段里找次级别中枢"的做法。
    */
    /*
      下钻窗口的三级优先（这就是"背驰段精确定位"的落地）：
        ① 有背驰 → 用**背驰段的精确范围**（本段起点~背驰确认点），并与中枢范围取交集
        ② 否则有信号 → 用信号附近
        ③ 否则 → 用中枢范围
      缠论原文强调"背驰段的起点"，所以 ① 优先。
    */
    let childWindow = [focus.t0, focus.t1];
    let windowMode = 'pivot';
    let windowNote = '本级中枢范围';
    if (bei && bei.segment && bei.segment.t0 && bei.segment.t1) {
      // 与中枢范围取交集，避免背驰段跑到中枢之外
      const lo = Math.max(focus.t0, bei.segment.t0);
      const hi = Math.min(focus.t1 + (focus.t1 - focus.t0) * 0.5, bei.segment.t1);
      if (hi > lo) {
        childWindow = [lo, hi];
        windowMode = 'beichi';
        windowNote = `背驰段 ${new Date(lo).toISOString().slice(0, 10)} 起，至背驰确认点`;
      }
    }
    if (windowMode === 'pivot' && sig && sig.t >= focus.t0 && sig.t <= focus.t1) {
      const span = Math.max(1, focus.t1 - focus.t0);
      childWindow = [Math.max(focus.t0, sig.t - span / 3), Math.min(focus.t1, sig.t + span / 3)];
      windowMode = 'signal';
      windowNote = '信号发生位置附近';
    }
    /*
      窗口裁剪：若次级别数据覆盖不到整个窗口，就裁剪到**两者交集**。
      例如周线中枢 2019~2023，而日线只有 2024 年以后的数据 →
      与其报"覆盖 0%"直接停摆，不如在 2024 年以后这段里继续找次级别中枢，
      并明确标注"窗口已裁剪到次级别可覆盖范围"。
    */
    let clipped = false;
    if (childCover) {
      const [cFrom, cTo] = childCover;
      const lo = Math.max(childWindow[0], cFrom);
      const hi2 = Math.min(childWindow[1], cTo);
      const need = childWindow[1] - childWindow[0];
      const keep = hi2 - lo;
      // 至少保留 30% 才值得裁剪，否则说明是真的没数据
      if (keep > 0 && keep < need && need > 0 && keep / need >= 0.3) {
        childWindow = [lo, hi2];
        clipped = true;
        windowNote += '（已裁剪到次级别可覆盖范围）';
      }
    }
    node.childWindow = childWindow;
    node.childWindowMode = windowMode;
    node.childWindowNote = windowNote;
    node.childWindowClipped = clipped;

    const child = await recurse(depth + 1, childWindow, node);
    if (child && (child.ok || child.error)) node.children = [child];
    return node;
  }

  const root = await recurse(0, null, null);
  const tree = {
    market: String(market || 'A').toUpperCase(),
    code,
    chain,
    root,
    flat: flatten(root),
    verdict: '',
    nested: false,
  };
  const v = verdictOf(tree);
  tree.verdict = v.text;
  tree.verdictLevel = v.level;
  tree.nested = v.level === 'buy' || v.level === 'sell';
  tree.evidence = v.evidence;
  return tree;
}

/**
 * 递归结论
 * 判定逻辑（按缠论）：
 *   · 区间套成立 = 相邻两层"方向一致"：大级别背驰（或买点） + 次级别同向买卖点
 *   · 只统计**覆盖充分**（coverage != insufficient）的层，避免拿 2 天数据代表 2 个月
 */
function verdictOf(tree) {
  const layers = tree.flat.filter((l) => l.ok && l.coverage !== 'insufficient');
  const dropped = tree.flat.filter((l) => l.ok && l.coverage === 'insufficient').map((l) => l.period);
  if (!layers.length) {
    return { level: 'none', text: '数据覆盖不足，无法做区间套判断', evidence: { dropped } };
  }

  const buys = layers.filter((l) => l.signal && l.signal.type.endsWith('B'));
  const sells = layers.filter((l) => l.signal && l.signal.type.endsWith('S'));
  const beiDown = layers.filter((l) => l.beichi && l.beichi.dir < 0);
  const beiUp = layers.filter((l) => l.beichi && l.beichi.dir > 0);

  const fmt = (l) => `${l.period}${l.signal ? '(' + l.signal.name + ')' : ''}`;
  const suffix = dropped.length ? `（${dropped.join('/')} 覆盖不足已排除）` : '';

  /*
    区间套成立必须满足"跨层"：
      · 两个不同层各自出现同向买卖点，或
      · 一层的买卖点 + **另一层**的同向背驰
    同一层既有信号又有背驰不算共振——那只是这一层自己在说话。
  */
  const crossLayer = (sigs, beis) => {
    if (sigs.length >= 2) return true;
    if (!sigs.length) return false;
    return beis.some((b) => !sigs.some((x) => x.period === b.period));
  };
  /* 文案：同一级别只提一次，避免出现 "week(二买) + week(底背驰)" 这种重复 */
  const summarize = (sigs, beis) => {
    const byPeriod = new Map();
    for (const l of sigs) byPeriod.set(l.period, l.signal.name);
    const extra = beis.filter((b) => !byPeriod.has(b.period)).map((b) => `${b.period}(背驰)`);
    const main = [...byPeriod.entries()].map(([p, n]) => `${p}(${n})`);
    return [...main, ...extra].join(' + ');
  };
  if (crossLayer(buys, beiDown)) {
    return {
      level: 'buy',
      text: `区间套买点：${summarize(buys, beiDown)} 同向共振${suffix}`,
      evidence: { buys: buys.map(pick), bei: beiDown.map(pick), dropped },
    };
  }
  if (crossLayer(sells, beiUp)) {
    return {
      level: 'sell',
      text: `区间套卖点：${summarize(sells, beiUp)} 同向共振${suffix}`,
      evidence: { sells: sells.map(pick), bei: beiUp.map(pick), dropped },
    };
  }
  if (buys.length || sells.length) {
    const l = (buys.length ? buys : sells).slice(-1)[0];
    const sameLayerBei = l.beichi ? `（同层另有${l.beichi.kind}，属该级别自身判断，不算跨层共振）` : '';
    return { level: 'single', text: `仅 ${fmt(l)} 出现${l.signal.name}${sameLayerBei}，未形成多级别共振${suffix}`, evidence: { single: pick(l), dropped } };
  }
  const withPivot = layers.filter((l) => l.pivot);
  if (withPivot.length) {
    const d = withPivot[withPivot.length - 1];
    const blocked = (tree.flat.find((l) => l.descendBlocked) || {}).descendBlocked;
    return {
      level: 'none',
      text: `各层无买卖点；递归到 ${d.period}（中枢 ${d.pivot.zd.toFixed(2)}~${d.pivot.zg.toFixed(2)}，${d.pivot.count} 笔）${blocked ? '；' + blocked : ''}${suffix}`,
      evidence: { dropped },
    };
  }
  return { level: 'none', text: '各层均未形成有效中枢，无区间套可言', evidence: { dropped } };
}

function pick(l) {
  return { period: l.period, signal: l.signal ? l.signal.name : null, beichi: l.beichi ? l.beichi.kind : null, price: l.price };
}

function flatten(node, out = []) {
  if (!node) return out;
  const { children, ...rest } = node;
  out.push(rest);
  (children || []).forEach((c) => flatten(c, out));
  return out;
}

module.exports = { buildNest, LEVEL_CHAIN, MAX_DEPTH };
