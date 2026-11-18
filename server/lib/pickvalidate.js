/**
 * 推票打分的历史检验：分组回测
 * =====================================================================
 * 回答一个问题：**这套打分在历史上真的有区分度吗？**
 *
 * 方法（与前文所有检验保持同一口径）
 * ----------------------------------
 *   在若干个历史时点 t，用 t 及之前的数据打分，
 *   然后看之后 H 日的实际收益，按分数分组比较。
 *
 * 关键纪律（踩过的坑，见 docs/QUANT-SYNC.md）：
 *   1. **前视偏差**：t 日打分只能用 <= t 的 K 线（这里靠截断实现）
 *   2. **去重叠**：相邻抽样点间隔 >= H，避免同一波行情重复计入
 *   3. **多种子/多时点**：单一时点的结论不可信
 *   4. **样本量**：< 30 个截面不给结论
 *
 * 输出：每个时点的分组收益 + 汇总的 IC / 单调性
 */

'use strict';

const A = require('./allashare');
const S = require('./sources');
const C = require('./chan');
const PS = require('./pickscore');

/**
 * 在指定时点做一次截面打分，返回 [{code, total, fwd}]
 * @param {number} cutIdx 用 bars[0..cutIdx] 打分
 * @param {number} horizon 之后看多少根
 */
async function oneCrossSection(codes, period, cutIdx, horizon, concurrency = 8) {
  const rows = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, codes.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= codes.length) return;
      const it = codes[i];
      try {
        // 多取 horizon 根，用于计算未来收益
        const kl = await S.klines({ market: 'A', code: it.code, period, limit: cutIdx + horizon + 10 });
        if (!kl || !kl.bars || kl.bars.length < cutIdx + 2) continue;
        const bars = kl.bars;
        // 截止到 cutIdx 的切片（保证无前视）
        const hist = bars.slice(0, cutIdx + 1);
        const last = hist[hist.length - 1];
        const future = bars[Math.min(cutIdx + horizon, bars.length - 1)];
        if (!last || !future || !(last.c > 0)) continue;
        let res = null;
        try { res = C.analyze(hist, { period, withState: false }); } catch (e) { res = null; }
        const raw = PS.rawMetrics(hist, res);
        if (!raw) continue;
        rows.push({
          code: it.code,
          name: it.name,
          raw,
          fwd: future.c / last.c - 1,
          date: last.t,
        });
      } catch (e) { /* 单只失败不影响整体 */ }
    }
  });
  await Promise.all(workers);
  if (rows.length < 30) return null;

  const scored = PS.scoreCrossSection(rows, {});
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return scored.map((s) => ({
    code: s.code,
    name: s.name,
    total: s.total,
    parts: s.parts,
    raw: s.raw,                    // 原始因子值，供 estimateDirections 用
    fwd: byCode.get(s.code).fwd,
  }));
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 10) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * 跑多时点检验。
 * @param {object} o
 * @param {number} o.topN      候选池大小
 * @param {number} o.horizon   未来多少根（默认 10）
 * @param {number} o.cuts      抽样几个时点（默认 6）
 * @param {number} o.cutStep   时点间隔（根，默认 40 >= horizon 保证去重叠）
 * @param {number} o.groups    分几组（默认 5）
 */
async function runValidation(o = {}) {
  const t0 = Date.now();
  const topN = Math.max(60, Math.min(Number(o.topN) || 150, 400));
  const horizon = Math.max(3, Math.min(Number(o.horizon) || 10, 40));
  const nCuts = Math.max(2, Math.min(Number(o.cuts) || 6, 15));
  const cutStep = Math.max(horizon + 5, Number(o.cutStep) || 40);
  const groups = Math.max(3, Math.min(Number(o.groups) || 5, 10));
  const period = o.period || 'day';

  const list = await A.allAShare();
  if (!list.ok) return { ok: false, error: '全市场清单获取失败' };
  let pool = A.liquidUniverse(list.items, { topN: topN * 2, minAmount: Number(o.minAmount) || 5e7 });
  pool = pool.slice(0, topN);

  const cuts = [];
  // 逐步往前推 cutIdx（从足够长的历史开始）
  let base = 260;   // 至少要有 260 根才能算 MA60 + 若干中枢
  for (let k = 0; k < nCuts; k++) {
    cuts.push(base + k * cutStep);
  }

  const sections = [];
  for (const cut of cuts) {
    const sec = await oneCrossSection(pool, period, cut, horizon);
    if (sec && sec.length >= 30) sections.push({ cut, rows: sec });
  }

  if (!sections.length) {
    return { ok: false, error: '没有足够的有效截面（可能数据不足或标的太少）' };
  }

  // 每个截面：分组收益 + IC
  const perSection = sections.map(({ cut, rows }) => {
    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const per = Math.floor(sorted.length / groups);
    const gret = [];
    for (let g = 0; g < groups; g++) {
      const slice = sorted.slice(g * per, g === groups - 1 ? sorted.length : (g + 1) * per);
      const m = slice.length ? slice.reduce((a, x) => a + x.fwd, 0) / slice.length : null;
      gret.push(m);
    }
    const ic = spearman(sorted.map((x) => x.total), sorted.map((x) => x.fwd));
    return {
      cut,
      date: rows[0] && rows[0].date ? rows[0].date : null,
      n: sorted.length,
      groups: gret.map((x) => (x === null ? null : +(x * 100).toFixed(2))),
      spread: gret[0] !== null && gret[groups - 1] !== null ? +((gret[0] - gret[groups - 1]) * 100).toFixed(2) : null,
      ic: ic === null ? null : +ic.toFixed(4),
      topCodes: sorted.slice(0, 5).map((x) => x.code),
    };
  });

  const ics = perSection.map((s) => s.ic).filter((x) => x !== null);
  const spreads = perSection.map((s) => s.spread).filter((x) => x !== null);
  const meanIc = ics.length ? ics.reduce((a, b) => a + b, 0) / ics.length : null;
  let tIc = null;
  if (ics.length >= 3) {
    const m = meanIc;
    const sd = Math.sqrt(ics.reduce((a, b) => a + (b - m) ** 2, 0) / (ics.length - 1));
    tIc = sd > 0 ? m / (sd / Math.sqrt(ics.length)) : null;
  }

  // 汇总各组平均收益
  const groupAvg = Array.from({ length: groups }, (_, g) => {
    const vals = perSection.map((s) => s.groups[g]).filter((x) => x !== null);
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
  });
  // 单调性：组序号与组收益的秩相关
  const mono = (() => {
    const gs = [], rs = [];
    groupAvg.forEach((v, i) => { if (v !== null) { gs.push(i); rs.push(v); } });
    return gs.length >= 3 ? spearman(gs, rs) : null;
  })();

  return {
    ok: true,
    period,
    horizon,
    groups,
    poolSize: pool.length,
    sections: perSection,
    summary: {
      nSections: perSection.length,
      meanIc: meanIc === null ? null : +meanIc.toFixed(4),
      tIc: tIc === null ? null : +tIc.toFixed(2),
      meanSpread: spreads.length ? +(spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(2) : null,
      groupAvg,
      monotonicity: mono === null ? null : +mono.toFixed(2),
    },
    elapsedMs: Date.now() - t0,
    caveat: perSection.length < 5
      ? `只有 ${perSection.length} 个截面，统计力弱，结论仅供方向参考`
      : (tIc !== null && Math.abs(tIc) < 2 ? `t=${tIc.toFixed(2)} < 2，不显著，不能据此认为打分有效` : null),
  };
}

module.exports = { runValidation, spearman };

/**
 * 估算每个因子的方向与显著性（滚动历史）
 * =====================================================================
 * 为什么不写死方向：实测 4 个时点上动量 2 次、反转 2 次，
 * 滚动自适应命中 2/5（等于抛硬币）。所以方向必须现算 + 明示显著性。
 *
 * @returns {Object} { mom20: { spread, t, n, dir, stable }, ... }
 *   spread  Q5−Q1 的平均价差（百分点）
 *   t       价差的 t 统计量
 *   dir     建议方向：+1 正向 / -1 反向 / 0 不用（|t|<2）
 *   stable  方向一致的时点占比
 */
async function estimateDirections(o = {}) {
  const topN = Math.max(60, Math.min(Number(o.topN) || 200, 400));
  const horizon = Math.max(3, Math.min(Number(o.horizon) || 10, 40));
  const nCuts = Math.max(3, Math.min(Number(o.cuts) || 6, 12));
  const cutStep = Math.max(horizon + 5, Number(o.cutStep) || 30);
  const period = o.period || 'day';

  const list = await A.allAShare();
  if (!list.ok) return { ok: false, error: '全市场清单获取失败' };
  const pool = A.liquidUniverse(list.items, { topN: topN * 2, minAmount: Number(o.minAmount) || 5e7 })
    .slice(0, topN);

  const cutList = [];
  for (let k = 0; k < nCuts; k++) cutList.push(240 + k * cutStep);

  /* 性能：一次取数，所有截面复用
     -------------------------------
     第一版是「外层 6 个截面串行，内层每只股票并发」，等于同一只票取 6 次 K 线、
     再算 6 次 analyze，实测 167s。
     改成「每只票取一次最长序列，再对每个截面切前缀」，
     取数次数降到 1/6，实测降到 30s 以内。
     cutIdx 用「距末尾的相对位置」，保证同一只票的各个截面口径一致。 */
  const maxCut = Math.max(...cutList);
  const needLen = maxCut + horizon + 10;

  const FIELDS = ['mom20', 'dev60', 'ret5', 'vstd20', 'vol20', 'pivots', 'posPct'];
  const perCutSpreads = cutList.map(() => ({}));
  let usable = 0;

  let idx = 0;
  const workers = Array.from({ length: Math.min(8, pool.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= pool.length) return;
      const it = pool[i];
      try {
        const kl = await S.klines({ market: 'A', code: it.code, period, limit: needLen });
        if (!kl || !kl.bars || kl.bars.length < needLen) return;
        const bars = kl.bars;
        const n = bars.length;

        for (let ci = 0; ci < cutList.length; ci++) {
          // cut 是「距末尾相对位置」，统一换算成绝对索引
          const cutAbs = n - (needLen - cutList[ci]);
          if (cutAbs < 120 || cutAbs + horizon >= n) continue;
          const hist = bars.slice(0, cutAbs + 1);
          const lastC = bars[cutAbs].c;
          const futC = bars[Math.min(cutAbs + horizon, n - 1)].c;
          if (!(lastC > 0) || !Number.isFinite(futC)) continue;
          const fwd = futC / lastC - 1;
          if (Math.abs(fwd) > 0.5) continue;
          let res = null;
          try { res = C.analyze(hist, { period, withState: false }); } catch (e) { res = null; }
          const raw = PS.rawMetrics(hist, res);
          if (!raw) continue;
          const bucket = perCutSpreads[ci];
          for (const f of FIELDS) {
            const v = f === 'pivots' ? (raw.struct && raw.struct.pivots)
              : f === 'posPct' ? (raw.struct && raw.struct.posPct)
                : raw[f];
            if (!Number.isFinite(v)) continue;
            (bucket[f] = bucket[f] || []).push({ v, fwd });
          }
        }
        usable++;
      } catch (e) { /* 单只失败跳过 */ }
    }
  });
  await Promise.all(workers);

  if (!usable) return { ok: false, error: '没有标的可取到足够长度的 K 线' };

  // 每个截面每个因子算 Q5−Q1
  const perCut = [];
  for (let ci = 0; ci < cutList.length; ci++) {
    const got = {};
    for (const f of FIELDS) {
      const arr = (perCutSpreads[ci][f] || []);
      if (arr.length < 40) continue;
      arr.sort((a, b) => a.v - b.v);
      const g = 5;
      const per = Math.floor(arr.length / g);
      if (per < 5) continue;
      const q1 = arr.slice(0, per);
      const qN = arr.slice(arr.length - per);
      const m1 = q1.reduce((a, x) => a + x.fwd, 0) / q1.length;
      const mN = qN.reduce((a, x) => a + x.fwd, 0) / qN.length;
      got[f] = (mN - m1) * 100;
    }
    if (Object.keys(got).length) perCut.push({ cut: cutList[ci], spread: got });
  }

  if (!perCut.length) return { ok: false, error: '没有有效截面' };

  const out = {};
  for (const f of FIELDS) {
    const vals = perCut.map((p) => p.spread[f]).filter((x) => Number.isFinite(x));
    if (vals.length < 3) { out[f] = { spread: null, t: null, n: vals.length, dir: 0, stable: null, perCut: [] }; continue; }
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
    const t = sd > 0 ? m / (sd / Math.sqrt(vals.length)) : 0;
    const pos = vals.filter((x) => x > 0).length;
    const stable = Math.max(pos, vals.length - pos) / vals.length;
    /* 方向判定要分三档，不能只按 |t|≥2 一刀切。
       实测：ret5 在 topN=150 时 t=-3.14（反向），topN=200 时 t=+2.04（正向）——
       同一段历史、只改池子大小就翻向。所以：
         |t| >= 3  → usable  可用
         2 <= |t| < 3 → borderline 边界，方向随时可能翻，界面必须警示
         |t| < 2   → 不用
       方向本身在 borderline 档仍给出（便于观察），但 confidence 标为 low。 */
    const at = Math.abs(t);
    const dir = at < 2 ? 0 : t > 0 ? 1 : -1;
    const confidence = at >= 3 ? 'ok' : at >= 2 ? 'borderline' : 'none';
    out[f] = {
      spread: +m.toFixed(3), t: +t.toFixed(2), n: vals.length, dir, confidence,
      stable: +(stable * 100).toFixed(0), perCut: vals.map((x) => +x.toFixed(2)),
    };
  }

  return {
    ok: true, horizon, nCuts: perCut.length, symbolsUsed: usable,
    cuts: perCut.map((p) => p.cut),
    factors: out,
    note: 'dir=+1 正向(值越大越好) / -1 反向 / 0 不显著不用(|t|<2)',
  };
}

module.exports.estimateDirections = estimateDirections;
