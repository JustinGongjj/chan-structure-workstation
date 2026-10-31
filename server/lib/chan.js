'use strict';
/**
 * 缠论结构引擎（零依赖）
 *
 * 处理链：原始K线 → 包含处理 → 分型 → 笔 → 线段(特征序列) → 中枢 → 走势类型
 *        → 背驰(MACD 面积/黄白线) → 一/二/三类买卖点 → 区间套与状态叙述
 *
 * 简化声明（诚实标注）：
 * 1) 线段用标准特征序列法判定，缺口（第二种情况）按简化处理，不做二次确认；
 * 2) 中枢以「笔中枢」为主（连续三笔重叠），线段中枢作为升级提示；
 * 3) 背驰用 MACD 红绿柱面积 + DIF 极值做同向两段力度比较，属于缠论标准做法的
 *    常用数值化近似，非唯一实现。
 */

const PERIOD_META = {
  '1m': { levelNo: 1, levelName: '1分钟级别', short: '1F' },
  '5m': { levelNo: 2, levelName: '5分钟级别', short: '5F' },
  '15m': { levelNo: 3, levelName: '15分钟级别', short: '15F' },
  '30m': { levelNo: 4, levelName: '30分钟级别', short: '30F' },
  '60m': { levelNo: 5, levelName: '60分钟级别', short: '60F' },
  '4h': { levelNo: 5, levelName: '4小时级别', short: '4H' },
  day: { levelNo: 6, levelName: '日线级别', short: 'D' },
  week: { levelNo: 7, levelName: '周线级别', short: 'W' },
  month: { levelNo: 8, levelName: '月线级别', short: 'M' },
};

const SIGNAL_NAME = {
  '1B': '第一类买点', '2B': '第二类买点', '3B': '第三类买点',
  '1S': '第一类卖点', '2S': '第二类卖点', '3S': '第三类卖点',
};

/* ------------------------------------------------------------------ */
/* 指标                                                                */
/* ------------------------------------------------------------------ */

function emaSeries(vals, n) {
  const k = 2 / (n + 1);
  const out = new Array(vals.length);
  let prev = vals[0] || 0;
  for (let i = 0; i < vals.length; i++) {
    prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function macd(closes, fast = 12, slow = 26, sig = 9) {
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const dif = closes.map((_, i) => ef[i] - es[i]);
  const dea = emaSeries(dif, sig);
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, hist };
}

/* ------------------------------------------------------------------ */
/* 1. 包含处理                                                         */
/* ------------------------------------------------------------------ */

function mergeBars(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!out.length) {
      out.push({ h: b.h, l: b.l, i0: i, i1: i, dir: 1, c: b.c });
      continue;
    }
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    let dir = last.dir;
    if (prev) {
      if (last.h > prev.h && last.l > prev.l) dir = 1;
      else if (last.h < prev.h && last.l < prev.l) dir = -1;
    }
    const includes = (last.h >= b.h && last.l <= b.l) || (b.h >= last.h && b.l <= last.l);
    if (includes) {
      if (dir > 0) {
        last.h = Math.max(last.h, b.h);
        last.l = Math.max(last.l, b.l);
      } else {
        last.h = Math.min(last.h, b.h);
        last.l = Math.min(last.l, b.l);
      }
      last.i1 = i;
      last.c = b.c;
      last.dir = dir;
    } else {
      out.push({ h: b.h, l: b.l, i0: i, i1: i, dir, c: b.c });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. 分型                                                             */
/* ------------------------------------------------------------------ */

function findFractals(merged, bars) {
  const list = [];
  for (let i = 1; i < merged.length - 1; i++) {
    const a = merged[i - 1];
    const b = merged[i];
    const c = merged[i + 1];
    const isTop = b.h > a.h && b.h > c.h && b.l > a.l && b.l > c.l;
    const isBottom = b.l < a.l && b.l < c.l && b.h < a.h && b.h < c.h;
    if (!isTop && !isBottom) continue;
    let extremeIdx = b.i0;
    let extreme = bars[b.i0].h;
    for (let k = b.i0; k <= b.i1; k++) {
      if (isTop ? bars[k].h > extreme : bars[k].l < extreme) {
        extreme = isTop ? bars[k].h : bars[k].l;
        extremeIdx = k;
      }
    }
    list.push({
      type: isTop ? 'top' : 'bottom',
      mi: i,
      price: isTop ? bars[extremeIdx].h : bars[extremeIdx].l,
      barIdx: extremeIdx,
      h: b.h,
      l: b.l,
    });
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* 3. 笔                                                               */
/* ------------------------------------------------------------------ */

function buildBis(fractals) {
  const bis = [];
  if (fractals.length < 2) return bis;
  let cur = fractals[0];
  for (let i = 1; i < fractals.length; i++) {
    const f = fractals[i];
    if (f.type === cur.type) {
      const better = cur.type === 'top' ? f.price > cur.price : f.price < cur.price;
      if (better) {
        // 同类型更极端的分型 → 延长最后一笔（保持笔首尾相连）
        const lastBi = bis[bis.length - 1];
        if (lastBi && lastBi._e === cur) {
          lastBi.p1 = f.price;
          lastBi.i1 = f.barIdx;
          lastBi.endBar = f.barIdx;
          lastBi.h = Math.max(lastBi.p0, f.price);
          lastBi.l = Math.min(lastBi.p0, f.price);
          lastBi.len = f.barIdx - lastBi.startBar;
          lastBi._e = f;
        } else if (!bis.length) {
          cur = f;
          continue;
        }
        cur = f;
      }
      continue;
    }
    // 严格笔：顶底之间至少间隔一根独立K线（合并后索引差 >= 4）
    if (f.mi - cur.mi < 4) continue;
    const p0 = cur.price;
    const p1 = f.price;
    const dir = f.type === 'top' ? 1 : -1;
    const bar0 = bis.length ? bis[bis.length - 1].i1 : cur.barIdx;
    bis.push({
      dir, // 1 向上笔, -1 向下笔
      i0: cur.barIdx,
      i1: f.barIdx,
      p0,
      p1,
      h: Math.max(p0, p1),
      l: Math.min(p0, p1),
      from: cur.type,
      to: f.type,
      startBar: cur.barIdx,
      endBar: f.barIdx,
      len: f.barIdx - cur.barIdx,
      _bar0: bar0,
      _s: cur,
      _e: f,
    });
    cur = f;
  }
  return bis;
}

/* ------------------------------------------------------------------ */
/* 4. 线段（特征序列法）                                                */
/* ------------------------------------------------------------------ */

/**
 * 线段（近似划分：把「笔」当作 K 线，做包含处理 + 分型，端点交替取极值）
 *
 * 严格的特征序列法需要处理缺口第二种情况与二次确认，实盘软件多数采用本近似：
 * 线段至少包含 3 笔；相邻线段首尾相接；端点取该区间内同向笔的极值。
 */
function buildSegments(bis) {
  const segs = [];
  if (bis.length < 4) return segs;
  // 线段分型：连续三笔中，第三笔未能创新高/新低 → 前一笔的极值为线段端点
  const cands = [];
  for (let i = 0; i + 2 < bis.length; i++) {
    if (bis[i].dir === 1 && bis[i + 2].dir === 1 && bis[i].p1 > bis[i + 2].p1) {
      cands.push({ type: 'top', bi: i, price: bis[i].p1, bar: bis[i].i1 });
    } else if (bis[i].dir === -1 && bis[i + 2].dir === -1 && bis[i].p1 < bis[i + 2].p1) {
      cands.push({ type: 'bottom', bi: i, price: bis[i].p1, bar: bis[i].i1 });
    }
  }
  const pts = [];
  for (const f of cands) {
    const last = pts[pts.length - 1];
    if (!last) {
      pts.push(f);
      continue;
    }
    if (f.type === last.type) {
      const better = f.type === 'top' ? f.price > last.price : f.price < last.price;
      if (better) pts[pts.length - 1] = f;
      continue;
    }
    if (f.bi - last.bi < 2) continue;
    pts.push(f);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    segs.push(makeSegment(bis, a.bi, b.bi, a.type === 'bottom' ? 1 : -1, true));
  }
  const lastPt = pts[pts.length - 1];
  const startBi = lastPt ? lastPt.bi : 0;
  if (startBi < bis.length - 1) {
    segs.push(makeSegment(bis, startBi, bis.length - 1, bis[startBi].dir, false));
  }
  return segs;
}

function makeSegment(bis, a, b, dir, done) {
  if (b < a) {
    const t = a;
    a = b;
    b = t;
  }
  const slice = bis.slice(a, b + 1);
  return {
    dir,
    startBi: a,
    endBi: b,
    i0: bis[a].i0,
    i1: bis[b].i1,
    p0: bis[a].p0,
    p1: bis[b].p1,
    h: Math.max(...slice.map((x) => x.h)),
    l: Math.min(...slice.map((x) => x.l)),
    bars: bis[b].i1 - bis[a].i0,
    done,
  };
}

/* ------------------------------------------------------------------ */
/* 5. 中枢                                                             */
/* ------------------------------------------------------------------ */

function buildPivots(bis, bars) {
  /*
    缠论中枢定义（严格版）：
      ① 中枢本体由「至少三段次级别走势」相互重叠构成；
      ② 区间 ZG = min(各段高点)，ZD = max(各段低点)，且要求 ZG > ZD；
      ③ 区间在**形成那一刻就固定**：之后的震荡只要不完全离开，就只是"延伸"，
         不得扩大/收缩 ZG、ZD（这是最常见的画错点）；
      ④ 中枢之前与中枢首段反向的那一段是「进入段」；
         中枢之后第一条**终点离开中枢区间**（p1 > ZG 或 p1 < ZD）的笔是「离开段」。
         注意：离开段的**起点必然贴着中枢边界**（走势从中枢里走出来），所以不能要求
         "整段都在区间外"——那是自相矛盾（实测 600519 的 12 个中枢全部不满足）。
         判据只看终点，这与"延伸=终点仍在内"互为补集；
      ⑤ 中枢内段数 ≥ 9 时升级为高一级别中枢。
  */
  const out = [];
  let i = 1; // 从第 1 段开始：需要前面有段可以当"进入段"
  let guard = 0;
  while (i + 2 < bis.length && guard++ < 500) {
    const tri = [bis[i], bis[i + 1], bis[i + 2]];
    const zg = Math.min(...tri.map((b) => b.h));
    const zd = Math.max(...tri.map((b) => b.l));
    if (!(zg > zd)) {
      i += 1;
      continue;
    }
    let gg = Math.max(...tri.map((b) => b.h));
    let dd = Math.min(...tri.map((b) => b.l));

    // —— 延伸：后续段的**终点**仍落在中枢区间内 = 还在中枢里震荡（不是离开）
    //    判据必须看端点而不是"整段是否与区间相交"：像 1142→1806 这种整段穿越中枢的，
    //    是典型的「离开段」，绝不能被吞进中枢（否则中枢会被拉成长条，画面全错）。
    let j = i + 3;
    while (j < bis.length) {
      const b = bis[j];
      const endsInside = b.p1 <= zg && b.p1 >= zd;
      if (!endsInside) break;
      gg = Math.max(gg, b.h);
      dd = Math.min(dd, b.l);
      j++;
    }

    const endBi = j - 1; // 中枢内最后一段
    const innerCount = endBi - i + 1;
    const enterBi = i - 1 >= 0 ? i - 1 : null;
    const leaveBi = j < bis.length ? j : null;
    out.push({
      idx: out.length,
      startBi: i,
      endBi,
      enterBi,
      leaveBi,
      zg,
      zd,
      gg,
      dd,
      height: zg - zd,
      count: innerCount,
      i0: bis[i].i0,
      i1: bis[endBi].i1,
      t0: bars[bis[i].i0].t,
      t1: bars[bis[endBi].i1].t,
      // 进/离段的极值，画图时用来标注进入段、离开段
      enter: enterBi != null ? { bi: enterBi, i0: bis[enterBi].i0, i1: bis[enterBi].i1, p0: bis[enterBi].p0, p1: bis[enterBi].p1, dir: bis[enterBi].dir } : null,
      leave: leaveBi != null ? { bi: leaveBi, i0: bis[leaveBi].i0, i1: bis[leaveBi].i1, p0: bis[leaveBi].p0, p1: bis[leaveBi].p1, dir: bis[leaveBi].dir } : null,
      upgraded: innerCount >= 9,
      status: leaveBi != null ? 'done' : 'ongoing',
    });
    i = Math.max(i + 1, j); // 从中枢结束后继续找下一个
  }
  return mergeAdjacent(out, bis);
}

/*
  中枢扩展 / 合并（缠论）
  ------------------------------------------------------------------
  **不合并**。两个中枢就是两个中枢——哪怕区间有重叠。
  理由：
    ① 每个中枢的 ZG/ZD 是它自己前三段的重叠区，合并后无论取交集还是并集，
       都会让**其中一个中枢的边界失真**（取交集变窄→把震荡区划到中枢外；
       取并集变宽→把不属于它的走势吞进来）；
    ② 缠论里"中枢扩展/升级"是**级别**概念，不是把两个中枢压成一个；
    ③ 图上并排画两个中枢 + 各自的进/离段，才是真实的走势结构。

  这里只做一件轻量的事：给相邻且区间重叠的中枢打上 `overlapPrev: true`，
  让前端可以提示"这两个中枢有重叠，属于中枢扩展形态"，但**不改几何**。
*/
function mergeAdjacent(pivots, bis) {
  if (pivots.length < 2) return pivots.map((p, idx) => annotate(p, idx, bis, null));
  const out = [];
  for (let k = 0; k < pivots.length; k++) {
    const prev = k > 0 ? pivots[k - 1] : null;
    out.push(annotate(pivots[k], k, bis, prev));
  }
  return out;
}

/** 补 enter/leave 细节 + 相邻重叠提示（不改几何） */
function annotate(p, idx, bis, prev) {
  const overlapPrev = !!prev && Math.min(p.zg, prev.zg) > Math.max(p.zd, prev.zd);
  return {
    ...p,
    idx,
    enter: p.enterBi != null ? { bi: p.enterBi, i0: bis[p.enterBi].i0, i1: bis[p.enterBi].i1, p0: bis[p.enterBi].p0, p1: bis[p.enterBi].p1, dir: bis[p.enterBi].dir } : null,
    leave: p.leaveBi != null ? { bi: p.leaveBi, i0: bis[p.leaveBi].i0, i1: bis[p.leaveBi].i1, p0: bis[p.leaveBi].p0, p1: bis[p.leaveBi].p1, dir: bis[p.leaveBi].dir } : null,
    overlapPrev,
  };
}

function classifyTrend(pivots) {
  const rels = [];
  for (let i = 1; i < pivots.length; i++) {
    const a = pivots[i - 1];
    const b = pivots[i];
    if (b.zd > a.zg) rels.push('up');
    else if (b.zg < a.zd) rels.push('down');
    else rels.push('overlap');
  }
  let dir = null;
  let run = 0;
  for (let i = rels.length - 1; i >= 0; i--) {
    if (rels[i] === 'overlap') break;
    if (dir == null) {
      dir = rels[i];
      run = 1;
    } else if (rels[i] === dir) run++;
    else break;
  }
  let type = '盘整';
  let sub = '中枢震荡';
  if (pivots.length < 2) {
    type = '盘整';
    sub = '单一中枢的盘整走势';
  } else if (dir === 'up') {
    type = '上涨趋势';
    sub = run >= 2 ? `连续 ${run + 1} 个中枢依次抬高` : '两个中枢不重叠且依次抬高';
  } else if (dir === 'down') {
    type = '下跌趋势';
    sub = run >= 2 ? `连续 ${run + 1} 个中枢依次降低` : '两个中枢不重叠且依次降低';
  } else if (pivots.length >= 2) {
    type = '盘整';
    sub = '中枢重叠扩展/升级中';
  }
  return { type, sub, relations: rels };
}

/* ------------------------------------------------------------------ */
/* 6. 力度比较与背驰                                                    */
/* ------------------------------------------------------------------ */

function moveEnergy(from, to, dir, macdData) {
  const { dif, hist } = macdData;
  let area = 0;
  let peak = dir > 0 ? -Infinity : Infinity;
  for (let k = from; k <= to; k++) {
    const h = hist[k] || 0;
    area += dir > 0 ? Math.max(0, h) : Math.max(0, -h);
    if (dir > 0) peak = Math.max(peak, dif[k] || 0);
    else peak = Math.min(peak, dif[k] || 0);
  }
  return { area, peak };
}

/**
 * 背驰判定
 * 1) 段背驰（主）：相邻同向线段比较，价格创新高/新低但 MACD 面积缩小 → 背驰
 * 2) 笔背驰（辅）：两个中枢之间的同向笔比较，同样以面积缩小 + 极值创新为准
 * 都是「同向、同级别、后一段力度明显弱于前一段」这一条缠论核心规则的数值化近似。
 */
function detectBeichi(bis, segs, pivots, macdData, bars) {
  const out = [];
  const segE = (s) => moveEnergy(s.i0, s.i1, s.dir, macdData);
  const biE = (b) => moveEnergy(b.i0, b.i1, b.dir, macdData);
  const push = (o) => {
    if (out.some((x) => x.barIdx === o.barIdx && x.kind === o.kind)) return;
    const bi = bis.find((b) => b.i1 === o.barIdx);
    out.push({ ...o, biIdx: bi ? bis.indexOf(bi) : null });
  };

  // 段背驰：线段方向天然交替，只能与「同向的前一段」比较（相隔一段）
  for (let i = 2; i < segs.length; i++) {
    const a = segs[i - 2];
    const b = segs[i];
    if (a.dir !== b.dir) continue;
    const newExtreme = b.dir > 0 ? b.p1 > a.p1 : b.p1 < a.p1;
    if (!newExtreme) continue;
    const ea = segE(a);
    const eb = segE(b);
    if (!(ea.area > 0)) continue;
    const areaRatio = +(eb.area / ea.area).toFixed(3);
    const peakRatio = +(Math.abs(eb.peak) / Math.max(1e-9, Math.abs(ea.peak))).toFixed(3);
    if (areaRatio >= 0.92) continue;
    push({
      kind: '段背驰',
      dir: b.dir,
      barIdx: b.i1,
      price: b.p1,
      t: bars[b.i1].t,
      areaRatio,
      peakRatio,
      segIdx: i,
      note: `前段面积 ${ea.area.toFixed(1)} → 本段 ${eb.area.toFixed(1)}`,
    });
  }

  // 笔背驰（跨中枢）
  for (let i = 1; i < bis.length; i++) {
    const b = bis[i];
    let j = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (bis[k].dir === b.dir) {
        j = k;
        break;
      }
    }
    if (j < 0) continue;
    const a = bis[j];
    const between = pivots.filter((p) => p.startBi > j && p.endBi < i);
    if (!between.length) continue;
    const newExtreme = b.dir > 0 ? b.p1 > a.p1 : b.p1 < a.p1;
    if (!newExtreme) continue;
    const ea = biE(a);
    const eb = biE(b);
    if (!(ea.area > 0)) continue;
    const areaRatio = +(eb.area / ea.area).toFixed(3);
    const peakRatio = +(Math.abs(eb.peak) / Math.max(1e-9, Math.abs(ea.peak))).toFixed(3);
    if (areaRatio >= 0.85) continue;
    push({
      kind: '笔背驰',
      dir: b.dir,
      barIdx: b.i1,
      price: b.p1,
      t: bars[b.i1].t,
      areaRatio,
      peakRatio,
      segIdx: null,
      note: `跨中枢力度衰减（面积比 ${areaRatio}）`,
    });
  }
  return out.sort((x, y) => x.barIdx - y.barIdx);
}

/* ------------------------------------------------------------------ */
/* 7. 买卖点                                                           */
/* ------------------------------------------------------------------ */

function detectSignals(bis, segs, pivots, beichi, bars) {
  const sigs = [];
  const seen = new Set();
  const add = (type, barIdx, price, extra = {}) => {
    const key = type + ':' + barIdx;
    if (seen.has(key)) return;
    seen.add(key);
    sigs.push({
      type,
      name: SIGNAL_NAME[type],
      barIdx,
      price,
      t: bars[barIdx].t,
      ...extra,
    });
  };

  // 一类买卖点：段背驰 / 笔背驰 的终点
  const firsts = [];
  for (const b of beichi) {
    const type = b.dir < 0 ? '1B' : '1S';
    add(type, b.barIdx, b.price, {
      beichi: b.kind,
      areaRatio: b.areaRatio,
      note: `${b.kind}（同向力度比 ${b.areaRatio}）`,
    });
    if (b.kind === '段背驰' || b.kind === '笔背驰') firsts.push({ type, barIdx: b.barIdx, price: b.price });
  }

  // 二类买卖点：一类点之后的第一次反向次级别回抽不破前低/不过前高
  for (const f of firsts) {
    for (let i = 0; i < bis.length; i++) {
      if (bis[i].i1 <= f.barIdx) continue;
      if (f.type === '1B' && bis[i].dir === -1 && bis[i].p1 > f.price) {
        add('2B', bis[i].i1, bis[i].p1, { refBar: f.barIdx, note: '一买后回抽不破前低 ' + fmt(f.price) });
        break;
      }
      if (f.type === '1S' && bis[i].dir === 1 && bis[i].p1 < f.price) {
        add('2S', bis[i].i1, bis[i].p1, { refBar: f.barIdx, note: '一卖后反抽不过前高 ' + fmt(f.price) });
        break;
      }
    }
  }

  // 三类买卖点：离开中枢后回抽不回中枢
  for (const p of pivots) {
    if (p.leaveBi == null) continue;
    const leave = bis[p.leaveBi];
    const pull = p.leaveBi + 1 < bis.length ? bis[p.leaveBi + 1] : null;
    if (!leave || !pull) continue;
    if (leave.dir === 1 && pull.dir === -1 && pull.l > p.zg) {
      add('3B', pull.i1, pull.l, { pivot: p.idx, note: '回抽低点 ' + fmt(pull.l) + ' 未跌破中枢上沿 ' + fmt(p.zg) });
    }
    if (leave.dir === -1 && pull.dir === 1 && pull.h < p.zd) {
      add('3S', pull.i1, pull.h, { pivot: p.idx, note: '反抽高点 ' + fmt(pull.h) + ' 未回到中枢下沿 ' + fmt(p.zd) });
    }
  }

  return sigs.sort((a, b) => a.barIdx - b.barIdx);
}

function fmt(v) {
  if (v == null || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(2);
  if (a >= 10) return v.toFixed(2);
  if (a >= 1) return v.toFixed(3);
  return v.toFixed(5);
}

/* ------------------------------------------------------------------ */
/* 8. 状态叙述                                                         */
/* ------------------------------------------------------------------ */

function describe({ bars, bis, segs, pivots, trend, beichi, signals, period }) {
  const meta = PERIOD_META[period] || PERIOD_META.day;
  const last = bars[bars.length - 1];
  const price = last.c;
  const parts = [];
  const lastPivot = pivots[pivots.length - 1] || null;
  const pos = lastPivot
    ? price > lastPivot.zg
      ? '中枢上方'
      : price < lastPivot.zd
      ? '中枢下方'
      : '中枢内部'
    : '尚未形成有效中枢';
  parts.push(
    `${meta.levelName}：当前价 ${fmt(price)}，${pos}` +
      (lastPivot
        ? `（最近中枢 [${fmt(lastPivot.zd)}, ${fmt(lastPivot.zg)}]，${lastPivot.count} 笔，${lastPivot.upgraded ? '已达九笔升级条件' : '未升级'}）`
        : '')
  );
  parts.push(`走势类型：${trend.type}（${trend.sub}）`);
  const lastBi = bis[bis.length - 1];
  if (lastBi) {
    parts.push(
      `最后一笔：${lastBi.dir > 0 ? '向上' : '向下'}笔 ${fmt(lastBi.p0)} → ${fmt(lastBi.p1)}，含 ${lastBi.i1 - lastBi.i0 + 1} 根K线`
    );
  }
  const lastSeg = segs[segs.length - 1];
  if (lastSeg) parts.push(`最后线段：${lastSeg.dir > 0 ? '向上' : '向下'}${lastSeg.done ? '（已完成）' : '（未完成）'}`);
  const recent = signals.filter((s) => s.barIdx >= bars.length - 60);
  if (recent.length) {
    parts.push('近 60 根K线内买卖点：' + recent.map((s) => `${s.name}@${fmt(s.price)}`).join('、'));
  } else {
    parts.push('近 60 根K线内无有效买卖点信号（等待中枢完成或背驰确认）');
  }
  const lb = beichi.filter((b) => b.barIdx >= bars.length - 120);
  if (lb.length) {
    const b = lb[lb.length - 1];
    parts.push(`最近背驰：${b.kind}（${b.dir > 0 ? '顶部' : '底部'}，${new Date(b.t).toISOString().slice(0, 10)}，力度比 ${b.areaRatio}）`);
  }
  return parts.join('｜');
}

function structureLabel(pivots) {
  const n = pivots.length;
  if (n === 0) return '无线段中枢结构（可能处于单边延伸或数据不足）';
  if (n === 1) return 'a + A + b（一个中枢的盘整结构）';
  return 'a + A + b + B + c …（' + n + ' 个中枢的走势连接）';
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

function analyze(rawBars, opts = {}) {
  const period = opts.period || 'day';
  const limit = opts.limit || 800;
  const bars = (rawBars || [])
    .filter((b) => b && Number.isFinite(b.c) && b.c > 0 && Number.isFinite(b.t))
    .sort((a, b) => a.t - b.t)
    .slice(-limit);
  const meta = PERIOD_META[period] || PERIOD_META.day;
  if (bars.length < 20) {
    return {
      period,
      level: meta,
      ok: false,
      reason: 'K线数量不足（至少 20 根）',
      bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
      macd: { dif: [], dea: [], hist: [] },
      bis: [], segments: [], pivots: [], beichi: [], signals: [], fractals: [],
    };
  }
  const md = macd(bars.map((b) => b.c));
  const merged = mergeBars(bars);
  const frx = findFractals(merged, bars);
  const bis = buildBis(frx);
  const segments = buildSegments(bis);
  const pivots = buildPivots(bis, bars);
  const trend = classifyTrend(pivots);
  const beichi = detectBeichi(bis, segments, pivots, md, bars);
  const signals = detectSignals(bis, segments, pivots, beichi, bars);
  const summary = describe({ bars, bis, segs: segments, pivots, trend, beichi, signals, period });
  const lastPivot = pivots[pivots.length - 1] || null;
  const price = bars[bars.length - 1].c;

  return {
    ok: true,
    period,
    level: meta,
    market: opts.market || '',
    code: opts.code || '',
    name: opts.name || '',
    bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
    macd: {
      dif: md.dif.map((v) => +v.toFixed(4)),
      dea: md.dea.map((v) => +v.toFixed(4)),
      hist: md.hist.map((v) => +v.toFixed(4)),
    },
    fractals: frx.map((f) => ({ type: f.type, barIdx: f.barIdx, price: f.price, mi: f.mi })),
    bis: bis.map((b) => ({
      dir: b.dir,
      i0: b.i0,
      i1: b.i1,
      p0: b.p0,
      p1: b.p1,
      h: b.h,
      l: b.l,
      startBar: b.startBar,
      endBar: b.endBar,
    })),
    segments: segments.map((s) => ({ dir: s.dir, i0: s.i0, i1: s.i1, p0: s.p0, p1: s.p1, done: s.done, startBi: s.startBi, endBi: s.endBi })),
    // 保留全部字段（enter/leave/status 等新增信息不能被白名单吃掉）
    pivots: pivots.map((p) => ({ ...p, active: p === lastPivot })),
    beichi: beichi.map((b) => ({ ...b })),
    signals: signals.map((s) => ({ ...s, typeName: s.name })),
    trend,
    structure: structureLabel(pivots),
    summary,
    stats: {
      bars: bars.length,
      mergedBars: merged.length,
      bis: bis.length,
      segments: segments.length,
      pivots: pivots.length,
      trend: trend.type,
      position: lastPivot ? (price > lastPivot.zg ? 'above' : price < lastPivot.zd ? 'below' : 'inside') : 'none',
      price,
      lastSignal: signals.length ? signals[signals.length - 1] : null,
      activePivot: lastPivot
        ? { zg: lastPivot.zg, zd: lastPivot.zd, count: lastPivot.count, upgraded: lastPivot.upgraded }
        : null,
    },
  };
}

/** 把一段级别结果压缩成「区间套」用的一行摘要 */
function summarizeForSuite(res) {
  if (!res || !res.ok) return { period: res && res.period, ok: false };
  const lastBi = res.bis[res.bis.length - 1];
  const p = res.pivots[res.pivots.length - 1];
  const price = res.stats.price;
  const pos = !p ? 'none' : price > p.zg ? 'above' : price < p.zd ? 'below' : 'inside';
  const recentSig = [...res.signals].reverse().find((s) => s.barIdx >= res.bars.length - 40) || null;
  const recentBei = [...res.beichi].reverse().find((b) => b.barIdx >= res.bars.length - 40) || null;
  return {
    period: res.period,
    levelName: res.level.levelName,
    ok: true,
    price,
    trend: res.trend.type,
    position: pos,
    pivot: p ? { zg: p.zg, zd: p.zd, count: p.count } : null,
    lastBiDir: lastBi ? lastBi.dir : 0,
    signal: recentSig ? { type: recentSig.type, name: recentSig.name, price: recentSig.price, barIdx: recentSig.barIdx } : null,
    beichi: recentBei ? { kind: recentBei.kind, dir: recentBei.dir, areaRatio: recentBei.areaRatio } : null,
    bars: res.bars.length,
  };
}

module.exports = { analyze, summarizeForSuite, macd, PERIOD_META, SIGNAL_NAME, mergeBars, findFractals, buildBis, buildSegments, buildPivots };
