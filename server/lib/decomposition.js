'use strict';
/**
 * 同级别分解 & 走势必完美
 * =====================================================================
 * 这两条是缠论的"操作系统骨架"，也是学习中最难落地的部分：
 *
 * ▍同级别分解
 *    把走势按**同一操作级别**切成互不重叠的走势类型（上涨/下跌/盘整）的序列。
 *    关键：相邻两个走势类型**不能同向**（同向就该合并），
 *    且分割点必须是完成点（有明确的结束信号）。
 *    缠师强调"分解的唯一性"——按规则这个序列应该唯一。
 *
 * ▍走势必完美
 *    任何走势类型必然完成（a+A+b+B+c 结构走完），
 *    没走完的走势只是"未完成"，不能当作已完成的走势来操作。
 *    实操意义：给出"当前走势是否完成、还差什么"的判断。
 */
const { } = require('./chan');

/* ------------------------- 同级别分解 ------------------------- */

/**
 * 基于中枢序列做同级别分解：
 *   相邻中枢若**波动区间不重叠** → 构成趋势（上涨/下跌），两个中枢分属同一段趋势；
 *   相邻中枢若**波动区间重叠** → 构成盘整（中枢扩张/延伸），归为一段盘整。
 * 输出：走势段序列 [{type:'up'|'down'|'consolidation', fromPivot, toPivot, t0, t1, zd, zg}]
 *
 * 注意：这是"按中枢重叠关系"的分解，也是实盘最可操作的一种；
 * 严格的走势类型分解需要级别递归，本项目在多级别(区间套)层面给出补充。
 */
function decomposeByPivots(pivots) {
  if (!pivots.length) return { segments: [], note: '无中枢，无法分解' };

  const segs = [];
  let cur = null;
  for (let i = 0; i < pivots.length; i++) {
    const p = pivots[i];
    if (!cur) {
      cur = { fromPivot: i, toPivot: i, type: 'consolidation', t0: p.t0, t1: p.t1, zd: p.zd, zg: p.zg, pivots: [i] };
      continue;
    }
    const prev = pivots[i - 1];
    const waveLo = Math.max(prev.dd, p.dd);
    const waveHi = Math.min(prev.gg, p.gg);
    const overlap = waveHi - waveLo > 0;

    if (overlap) {
      // 波动重叠 → 同一段盘整（中枢扩张/延伸）
      cur.toPivot = i;
      cur.t1 = p.t1;
      cur.zd = Math.min(cur.zd, p.zd);
      cur.zg = Math.max(cur.zg, p.zg);
      cur.pivots.push(i);
      if (cur.type !== 'consolidation') cur.type = 'consolidation';
    } else {
      // 不重叠 → 方向由两中枢高低决定，新的趋势段
      const up = p.zd > prev.gg || p.zg > prev.zg;
      const dir = up ? 'up' : 'down';
      if (!cur || cur.type === 'consolidation') {
        /*
          前一段若是"只含单个中枢"的盘整，不要单独成段——
          一个孤立中枢只是走势的起点，把它当独立走势段会多出一个假段。
          正确做法：把它并入紧随其后的趋势段（起点取这个中枢）。
        */
        if (cur && cur.type === 'consolidation' && cur.pivots.length <= 1) {
          const start = cur.fromPivot;
          cur = { fromPivot: start, toPivot: i, type: dir, t0: cur.t0, t1: p.t1, zd: p.zd, zg: p.zg, pivots: [start, i] };
          continue;
        }
        segs.push(cur);
        cur = { fromPivot: i - 1, toPivot: i, type: dir, t0: prev.t0, t1: p.t1, zd: p.zd, zg: p.zg, pivots: [i - 1, i] };
      } else if (cur.type === dir) {
        // 同向趋势延续 → 合并（同向不能分成两段）
        cur.toPivot = i;
        cur.t1 = p.t1;
        cur.pivots.push(i);
      } else {
        segs.push(cur);
        cur = { fromPivot: i - 1, toPivot: i, type: dir, t0: prev.t0, t1: p.t1, zd: p.zd, zg: p.zg, pivots: [i - 1, i] };
      }
    }
  }
  // 末尾若只剩一个孤立中枢的盘整段，并入前一段（不单独成段）
  if (cur && cur.type === 'consolidation' && cur.pivots.length <= 1 && segs.length) {
    const last = segs[segs.length - 1];
    last.toPivot = cur.toPivot;
    last.t1 = cur.t1;
    last.pivots.push(...cur.pivots);
  } else if (cur) {
    segs.push(cur);
  }

  // 校验"相邻不同向"这一唯一性要求
  const violations = [];
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].type === segs[i - 1].type && segs[i].type !== 'consolidation') {
      violations.push(i);
    }
  }
  return {
    segments: segs,
    violations,
    unique: violations.length === 0,
    note: violations.length ? '存在相邻同向走势段（应按规则合并），分解可能不唯一' : '同向不重复，分解满足唯一性要求',
  };
}

/* ------------------------- 走势必完美 ------------------------- */

/**
 * 判断当前走势是否"完美"（已完成）
 * 缠论：任何走势类型必然完成。未完成的走势给出"还差什么"。
 *
 * 判定要点（a+A+b+B+c 结构）：
 *   · 至少一个中枢 + 一个离开段 → 结构上具备完成条件
 *   · 最后一个中枢若仍在延伸（无离开段）→ 未完成
 *   · 末笔若刚形成且未回到中枢 → 可能正在走 c 段
 */
function perfection(analysis) {
  const pivots = analysis.pivots || [];
  const bis = analysis.bis || [];
  const signals = analysis.signals || [];
  const beichi = analysis.beichi || [];

  if (!pivots.length) {
    return {
      status: 'no-structure',
      complete: false,
      reason: '尚未形成中枢，走势结构未成形（a 段或更早）',
      missing: ['至少一个中枢'],
    };
  }

  const last = pivots[pivots.length - 1];
  const lastBi = bis[bis.length - 1];
  const hasLeave = last.leaveBi != null;
  const price = analysis.stats ? analysis.stats.price : null;
  const lastSignal = signals.slice(-1)[0] || null;
  const lastBei = beichi.slice(-1)[0] || null;

  const missing = [];
  if (!hasLeave) missing.push('离开段（中枢尚未走出）');
  if (!lastSignal) missing.push('明确的第一/二/三类买卖点');

  let status = 'in-progress';
  let reason = '';
  if (hasLeave && lastSignal) {
    status = 'complete';
    reason = '已有中枢 + 离开段 + 买卖点，走势结构完成';
  } else if (hasLeave && !lastSignal) {
    status = 'leaving';
    reason = '已走出离开段但未确认买卖点（可能正在形成 c 段）';
  } else {
    status = 'extending';
    reason = '最后一个中枢仍在延伸，走势未完成';
  }

  return {
    status,
    complete: status === 'complete',
    reason,
    missing,
    lastPivot: { zd: +last.zd.toFixed(4), zg: +last.zg.toFixed(4), count: last.count, hasLeave },
    lastBi: lastBi ? { dir: lastBi.dir, p1: +lastBi.p1.toFixed(4), i1: lastBi.i1 } : null,
    lastSignal: lastSignal ? { type: lastSignal.type, name: lastSignal.name, price: lastSignal.price } : null,
    lastBeichi: lastBei ? { kind: lastBei.kind, dir: lastBei.dir, areaRatio: lastBei.areaRatio } : null,
    price,
    position: price == null ? 'none' : price > last.zg ? 'above' : price < last.zd ? 'below' : 'inside',
    hint: '走势必完美 = 结构走完才有操作意义；未完成的走势只做跟踪，不当作已完成来下结论',
  };
}

/** 综合：分解 + 完美度 */
function analyzeFlow(analysis) {
  const dec = decomposeByPivots(analysis.pivots || []);
  const perf = perfection(analysis);
  return {
    decomposition: dec,
    perfection: perf,
    summary: `同级别分解 ${dec.segments.length} 段（${dec.unique ? '唯一' : '存在同向未合并'}）；走势${perf.complete ? '已完成' : '未完成'}：${perf.reason}`,
  };
}

module.exports = { decomposeByPivots, perfection, analyzeFlow };
