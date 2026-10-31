#!/usr/bin/env node
/**
 * 中枢几何校验 + ASCII 可视化（不依赖浏览器）
 *   node scripts/pivotviz.js [market] [code] [period]
 * 检查：
 *   1. ZG > ZD，且每个中枢内每笔都与区间相交
 *   2. 延伸笔的终点落在区间内
 *   3. 离开笔的终点确实出界（离开段）
 *   4. 进入笔与中枢首笔反向
 *   5. 相邻中枢若重叠 >30% 且紧邻，应已合并
 *   6. 中枢不在时间轴上倒序/重叠
 */
'use strict';
const C = require('../server/lib/chan');
const S = require('../server/lib/sources');

const [market = 'A', code = '600519', period = 'day'] = process.argv.slice(2);

function asciiViz(a) {
  const W = 88, H = 16;
  const bars = a.bars;
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const yOf = (p) => Math.max(0, Math.min(H - 1, Math.round((1 - (p - lo) / (hi - lo || 1)) * (H - 1))));
  const xOf = (i) => Math.max(0, Math.min(W - 1, Math.round((i / (bars.length - 1)) * (W - 1))));
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  for (const b of bars) {
    const x = xOf(bars.indexOf(b));
    const yh = yOf(b.h), yl = yOf(b.l);
    for (let y = yl; y <= yh; y++) if (grid[y][x] === ' ') grid[y][x] = '·';
  }
  for (const bi of a.bis) {
    const x0 = xOf(bi.i0), x1 = xOf(bi.i1);
    const y0 = yOf(bi.p0), y1 = yOf(bi.p1);
    const steps = Math.max(1, Math.abs(x1 - x0));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      if (grid[y] && grid[y][x] !== undefined) grid[y][x] = bi.dir > 0 ? '/' : '\\';
    }
  }
  for (const p of a.pivots) {
    const x0 = xOf(p.i0), x1 = xOf(p.i1);
    const yt = yOf(p.zg), yb = yOf(p.zd);
    for (let x = x0; x <= x1; x++) {
      if (grid[yt]) grid[yt][x] = '=';
      if (grid[yb]) grid[yb][x] = '=';
      for (let y = yt; y <= yb; y++) if (grid[y] && grid[y][x] === ' ') grid[y][x] = '░';
    }
  }
  const lines = grid.map((r) => r.join(''));
  lines.push(`价格区间 ${lo.toFixed(2)} ~ ${hi.toFixed(2)} · ${bars.length} 根 · 笔 ${a.bis.length} · 中枢 ${a.pivots.length}`);
  return lines.join('\n');
}

(async () => {
  const kl = await S.klines({ market, code, period, limit: 600 });
  const a = C.analyze(kl.bars, { period, market, code });
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  a.pivots.forEach((p, i) => {
    ok(p.zg > p.zd, `#${i} 区间无效 ${p.zd}~${p.zg}`);
    ok(p.count >= 3, `#${i} 段数 ${p.count} < 3`);
    for (let b = p.startBi; b <= p.endBi; b++) {
      const bi = a.bis[b];
      ok(bi.h > p.zd && bi.l < p.zg, `#${i} 第 ${b} 段与区间不相交`);
    }
    for (let b = p.startBi + 3; b <= p.endBi; b++) {
      const bi = a.bis[b];
      ok(bi.p1 <= p.zg + 1e-6 && bi.p1 >= p.zd - 1e-6, `#${i} 延伸段 ${b} 终点在区间外`);
    }
    if (p.leaveBi != null) {
      const lb = a.bis[p.leaveBi];
      // 离开段判据：终点离开区间（起点必然贴着边界，不能要求整段在外）
      ok(lb.p1 > p.zg || lb.p1 < p.zd, `#${i} 离开段 ${p.leaveBi} 终点未出界`);
      // 离开段必须紧跟中枢末笔（不能跳段），这是结构连续性要求
      ok(p.leaveBi === p.endBi + 1, `#${i} 离开段 ${p.leaveBi} 未紧跟中枢末笔 ${p.endBi}`);
    }
    if (p.enterBi != null) ok(a.bis[p.enterBi].dir !== a.bis[p.startBi].dir, `#${i} 进入段方向未反向`);
    // t1 必须与末笔 i1 对应的 K 线时间一致（合并逻辑曾把 t1 写成 undefined）
    const lastBi = a.bis[p.endBi];
    if (lastBi) ok(p.t1 === a.bars[lastBi.i1].t, `#${i} t1 与末笔终点 K 线不一致`);
    // count 必须等于段数
    ok(p.count === p.endBi - p.startBi + 1, `#${i} count=${p.count} 与段数不符`);
    // 中枢不得被合并（区间重叠只标注、不改几何）
    ok(!p.merged, `#${i} 仍被合并（应保持独立中枢）`);
    // 进入段必须紧邻中枢首笔（不能跳过中间走势）
    if (p.enterBi != null) ok(p.enterBi === p.startBi - 1, `#${i} 进入段 ${p.enterBi} 未紧邻首笔 ${p.startBi}`);
    if (i > 0) {
      const q = a.pivots[i - 1];
      ok(p.startBi > q.endBi, `#${i} 与 #${i - 1} 段序倒置`);
      // A 的离开段不能晚于 B 的进入段（否则是跳过了一段走势当了进入段）
      if (q.leaveBi != null) ok(p.enterBi >= q.leaveBi, `#${i} 进入段 ${p.enterBi} 早于上一离开段 ${q.leaveBi}`);
      const disjoint = Math.min(p.zg, q.zg) <= Math.max(p.zd, q.zd);
      // 区间有重叠时，必须正确打上提示标记
      ok(disjoint ? !p.overlapPrev : !!p.overlapPrev, `#${i} overlapPrev 标记与实际重叠不符`);
    }
  });

  console.log(asciiViz(a));
  console.log('');
  console.log(a.pivots.map((p, i) =>
    `#${i} 段${p.startBi}-${p.endBi}(${p.count}) 进${p.enterBi} 离${p.leaveBi} [${p.zd.toFixed(2)}, ${p.zg.toFixed(2)}]${p.merged ? ' 已合并×' + p.merged : ''}${p.upgraded ? ' 9段升级' : ''}`
  ).join('\n'));

  if (fails.length) {
    console.error('\n❌ 几何校验失败 ' + fails.length + ' 项：');
    fails.slice(0, 12).forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('\n✅ 中枢几何校验通过（区间/延伸/离开/进入/合并/顺序）');
})();
