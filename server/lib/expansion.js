'use strict';
/**
 * 中枢扩张 / 扩展（缠论里争议最大的部分之一）
 * =====================================================================
 * 两种形态必须分清，混为一谈是"千人千缠"的主要来源：
 *
 *  ▍中枢扩展（extension）
 *    中枢形成后，走出离开段并出现三类买卖点，**又很快回到原中枢区间内部**。
 *    表现：中枢被"重新震荡"，原区间继续有效。
 *    判据：离开段之后，有一笔的**终点重新回到 [ZD, ZG] 内**。
 *
 *  ▍中枢扩张（expansion）
 *    两个**同级别同向**中枢，各自的**波动区间（DD~GG）**发生重叠，
 *    按"走势级别延续定理二"意味着更高级别中枢产生。
 *    注意：用的是 **波动区间 dd~gg**，不是中枢区间 zd~zg —— 这是最容易搞错的地方。
 *
 *  ▍9 段升级（upgrade）
 *    单个中枢内延伸达到 9 段（3 段 × 3），级别升一级。
 *
 *  ⚠️ 业界争议（如实记录）：
 *    · 扩张升级后的"大中枢区间"没有唯一答案（取相邻 dd/gg 还是取上下沿，两种画法都有人用）；
 *    · 因此本项目**不自动合成大中枢区间**，只做检测与提示，把选择权留给用户；
 *    · 依据：缠师 2007-04-09 回复"扩展后的划分和一般中枢正常的划分没什么区别"，
 *      即扩张后在更高级别上按原始定义重新划分，而不是在低级别硬拼一个区间。
 */

const { } = require('./chan');

const OVERLAP_TOL = 0; // 波动区间重叠的判定容差（0 = 严格大于）

/** 中枢扩展：离开后又回到原区间内 */
function detectExtension(pivots, bis) {
  const out = [];
  for (let i = 0; i < pivots.length; i++) {
    const p = pivots[i];
    if (p.leaveBi == null) continue;
    // 找离开段之后、下一个中枢开始之前，是否有笔的终点回到 [zd, zg]
    const nextStart = i + 1 < pivots.length ? pivots[i + 1].startBi : bis.length;
    let backBi = null;
    for (let b = p.leaveBi + 1; b < nextStart; b++) {
      const bi = bis[b];
      if (bi.p1 <= p.zg && bi.p1 >= p.zd) { backBi = b; break; }
    }
    if (backBi != null) {
      out.push({
        type: 'extension',
        pivotIdx: i,
        zd: p.zd,
        zg: p.zg,
        leaveBi: p.leaveBi,
        backBi,
        backTime: bis[backBi].i1,
        text: '离开后又回到中枢区间内 = 中枢扩展（第三个买卖点失败）',
      });
    }
  }
  return out;
}

/**
 * 中枢扩张：相邻两个同向中枢，波动区间 dd~gg 重叠
 * @returns 每对相邻中枢的判定
 */
function detectExpansion(pivots) {
  const out = [];
  for (let i = 1; i < pivots.length; i++) {
    const a = pivots[i - 1];
    const b = pivots[i];
    if (!(b.gg != null && a.gg != null)) continue;
    // 波动区间重叠量
    const lo = Math.max(a.dd, b.dd);
    const hi = Math.min(a.gg, b.gg);
    const waveOverlap = hi - lo;
    // 中枢区间重叠量（仅用于对比展示，不参与扩张判定）
    const zgLo = Math.max(a.zd, b.zd);
    const zgHi = Math.min(a.zg, b.zg);
    const zoneOverlap = zgHi - zgLo;

    const expanded = waveOverlap > OVERLAP_TOL;
    const trendLike = !expanded; // 不重叠 = 趋势
    out.push({
      type: expanded ? 'expansion' : 'trend',
      pair: [i - 1, i],
      a: { zd: +a.zd.toFixed(4), zg: +a.zg.toFixed(4), dd: +a.dd.toFixed(4), gg: +a.gg.toFixed(4) },
      b: { zd: +b.zd.toFixed(4), zg: +b.zg.toFixed(4), dd: +b.dd.toFixed(4), gg: +b.gg.toFixed(4) },
      waveOverlap: +waveOverlap.toFixed(4),
      zoneOverlap: +zoneOverlap.toFixed(4),
      /* 关键提示：波动重叠但中枢区间不重叠 = 典型的"扩张而非扩展" */
      onlyWaveOverlap: expanded && zoneOverlap <= 0,
      text: expanded
        ? (zoneOverlap > 0
            ? '两中枢波动区间与中枢区间均重叠 → 中枢扩张（区间重叠型）'
            : '两中枢**仅波动区间**重叠、中枢区间不重叠 → 中枢扩张（波动重叠型，最易被误判）')
        : '两中枢波动区间不重叠 → 构成趋势（不是扩张）',
    });
  }
  return { pairs: out, lastExpansion: out.filter((o) => o.type === 'expansion').slice(-1)[0] || null };
}

/** 9 段升级检测 */
function detectUpgrade(pivots) {
  return pivots
    .map((p, i) => ({ pivotIdx: i, count: p.count, upgraded: p.count >= 9 }))
    .filter((x) => x.upgraded);
}

/** 汇总 */
function analyzeStructure(analysis) {
  const pivots = analysis.pivots || [];
  const bis = analysis.bis || [];
  const ext = detectExtension(pivots, bis);
  const exp = detectExpansion(pivots);
  const up = detectUpgrade(pivots);
  return {
    extension: ext,
    expansion: exp.pairs,
    lastExpansion: exp.lastExpansion,
    upgrade: up,
    /* 一句话结论 */
    summary: [
      ext.length ? `中枢扩展 ${ext.length} 处` : '',
      exp.pairs.filter((o) => o.type === 'expansion').length
        ? `中枢扩张 ${exp.pairs.filter((o) => o.type === 'expansion').length} 处`
        : '',
      up.length ? `9 段升级 ${up.length} 处` : '',
    ].filter(Boolean).join(' · ') || '未出现中枢扩展/扩张/升级',
    caveat: '扩张后的大中枢区间业界无唯一画法，本实现只检测不合成（缠师回复：扩展后按原始定义重新划分）',
  };
}

module.exports = { analyzeStructure, detectExtension, detectExpansion, detectUpgrade };
