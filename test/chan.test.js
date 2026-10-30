'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../server/lib/chan.js');

/** 造一段确定性的锯齿行情（含包含关系、单边、震荡三种形态） */
function synth(n, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const bars = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 9) * 1.6 + Math.sin(i / 37) * 2.2;
    const noise = (rnd() - 0.5) * 2.4;
    const o = p;
    const c = Math.max(1, p + drift + noise);
    const h = Math.max(o, c) + rnd() * 1.2;
    const l = Math.min(o, c) - rnd() * 1.2;
    bars.push({ t: Date.UTC(2024, 0, 1) + i * 86400000, o, h, l, c, v: 1000 + Math.round(rnd() * 500) });
    p = c;
  }
  return bars;
}

test('包含处理：合并后的相邻 K 线之间不再存在包含关系', () => {
  const bars = synth(400);
  const merged = C.mergeBars(bars);
  assert.ok(merged.length > 20, '合并后仍有足够多的 K 线');
  assert.ok(merged.length < bars.length, '确实发生了合并');
  for (let i = 1; i < merged.length; i++) {
    const a = merged[i - 1];
    const b = merged[i];
    const contains = (a.h >= b.h && a.l <= b.l) || (b.h >= a.h && b.l <= a.l);
    assert.equal(contains, false, `第 ${i} 根仍与前一根存在包含关系`);
    assert.ok(b.i0 >= a.i0 && b.i1 >= b.i0, '合并区间索引单调');
  }
});

test('笔：方向交替、首尾相接、区间索引递增', () => {
  const bars = synth(600, 7);
  const merged = C.mergeBars(bars);
  const bis = C.buildBis(C.findFractals(merged, bars));
  assert.ok(bis.length >= 8, '至少 8 笔');
  for (let i = 0; i < bis.length; i++) {
    const b = bis[i];
    assert.ok(b.i1 > b.i0, '笔的终点在起点之后');
    assert.equal(b.dir, b.p1 > b.p0 ? 1 : -1, '方向与价格一致');
    if (i > 0) {
      const prev = bis[i - 1];
      assert.notEqual(prev.dir, b.dir, `第 ${i} 笔与上一笔方向相同`);
      assert.ok(Math.abs(prev.p1 - b.p0) < 1e-9, `第 ${i} 笔未与上一笔首尾相接`);
    }
  }
});

test('中枢：ZG > ZD，且笔区间不重叠递增', () => {
  const bars = synth(600, 11);
  const merged = C.mergeBars(bars);
  const bis = C.buildBis(C.findFractals(merged, bars));
  const pivots = C.buildPivots(bis, bars);
  assert.ok(pivots.length >= 1, '至少识别出一个中枢');
  pivots.forEach((p) => {
    assert.ok(p.zg > p.zd, '中枢上沿必须高于下沿');
    assert.ok(p.count >= 3, '中枢至少三笔');
    assert.ok(p.gg >= p.zg && p.dd <= p.zd, '中枢极值包含区间');
  });
  for (let i = 1; i < pivots.length; i++) {
    assert.ok(pivots[i].startBi > pivots[i - 1].endBi - 1, '中枢之间按笔推进');
  }
});

test('完整分析：输出结构完整、信号类型合法、结果可复现', () => {
  const bars = synth(600, 23);
  const a = C.analyze(bars, { period: 'day', market: 'A', code: 'TEST' });
  const b = C.analyze(bars, { period: 'day', market: 'A', code: 'TEST' });
  assert.equal(a.ok, true);
  assert.ok(a.bars.length >= 20);
  assert.equal(a.bars.length, a.macd.dif.length, 'MACD 与 K 线等长');
  assert.equal(a.bars.length, a.macd.hist.length);
  const valid = new Set(['1B', '2B', '3B', '1S', '2S', '3S']);
  a.signals.forEach((s) => {
    assert.ok(valid.has(s.type), '非法信号类型 ' + s.type);
    assert.ok(s.barIdx >= 0 && s.barIdx < a.bars.length);
    assert.ok(Number.isFinite(s.price));
  });
  for (let i = 1; i < a.signals.length; i++) assert.ok(a.signals[i].barIdx >= a.signals[i - 1].barIdx, '信号按时间排序');
  assert.ok(['上涨趋势', '下跌趋势', '盘整'].includes(a.trend.type));
  assert.equal(a.bis.length, b.bis.length, '同一输入结果一致（笔）');
  assert.equal(a.signals.length, b.signals.length, '同一输入结果一致（信号）');
  assert.equal(a.summary, b.summary, '同一输入结果一致（叙述）');
});

test('背驰：面积比与方向标记合法', () => {
  const bars = synth(800, 31);
  const r = C.analyze(bars, { period: 'day' });
  r.beichi.forEach((x) => {
    assert.ok(['段背驰', '笔背驰'].includes(x.kind));
    assert.ok(x.dir === 1 || x.dir === -1);
    assert.ok(x.areaRatio > 0);
    assert.ok(x.barIdx >= 0 && x.barIdx < r.bars.length);
  });
});

test('数据不足时优雅返回而不是抛错', () => {
  const r = C.analyze(synth(10), { period: 'day' });
  assert.equal(r.ok, false);
  assert.ok(String(r.reason).length > 0);
  assert.deepEqual(r.signals, []);
});

test('价位序列：过滤非法 K 线（0 价、乱序）', () => {
  const bars = synth(120, 5);
  bars.push({ t: bars[0].t, o: 0, h: 0, l: 0, c: 0, v: 0 });
  const shuffled = bars.slice().reverse();
  const r = C.analyze(shuffled, { period: 'day' });
  assert.equal(r.ok, true);
  assert.ok(r.bars.every((x) => x.c > 0), '非法价格被过滤');
  for (let i = 1; i < r.bars.length; i++) assert.ok(r.bars[i].t >= r.bars[i - 1].t, '时间升序');
});

/* ---------------- 中枢结构：严格按缠论定义（进段 / 区间 / 离开段） ---------------- */
test('中枢：每段都与区间相交，区间固定不被后续震荡拉长', () => {
  const f = require('../server/lib/sources');
  const c = require('../server/lib/chan');
  // 用合成数据避免网络依赖
  const bars = [];
  let p = 100;
  for (let i = 0; i < 400; i++) {
    const w = Math.sin(i / 5) * 6 + Math.sin(i / 17) * 10;
    const c0 = 100 + w;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 2, l: c0 - 2, c: c0 + 0.5, v: 1000 });
  }
  const a = c.analyze(bars);
  for (const pv of a.pivots) {
    assert.ok(pv.zg > pv.zd, '中枢区间必须有效');
    assert.ok(pv.count >= 3, '中枢至少 3 段，实际 ' + pv.count);
    for (let b = pv.startBi; b <= pv.endBi; b++) {
      const bi = a.bis[b];
      assert.ok(bi.h > pv.zd && bi.l < pv.zg, `第 ${b} 段必须与中枢区间相交`);
    }
    // 第 4 段起（延伸段）终点必须落在区间内
    for (let b = pv.startBi + 3; b <= pv.endBi; b++) {
      const bi = a.bis[b];
      assert.ok(bi.p1 <= pv.zg + 1e-6 && bi.p1 >= pv.zd - 1e-6, `延伸段 ${b} 终点应在区间内`);
    }
    // 离开段必须真的离开（终点出界）
    if (pv.leaveBi != null) {
      const lb = a.bis[pv.leaveBi];
      assert.ok(lb.p1 > pv.zg || lb.p1 < pv.zd, '离开段终点必须离开中枢区间');
    }
    // 进入段必须存在且与中枢首段反向
    if (pv.enterBi != null) {
      assert.notEqual(a.bis[pv.enterBi].dir, a.bis[pv.startBi].dir, '进入段与中枢首段应反向');
    }
  }
});

test('中枢：9 段及以上标记升级', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 500; i++) {
    const c0 = 100 + Math.sin(i / 40) * 3 + Math.sin(i / 3) * 1.2;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 1.5, l: c0 - 1.5, c: c0, v: 800 });
  }
  const a = c.analyze(bars);
  for (const pv of a.pivots) {
    assert.equal(pv.upgraded, pv.count >= 9, `段数 ${pv.count} 的升级标记应为 ${pv.count >= 9}`);
  }
});

test('中枢：相邻中枢若区间高度重叠且紧邻，必须合并（否则图上一截一截首尾相接）', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 600; i++) {
    // 长期在 100 附近来回，制造连续重叠的中枢
    const c0 = 100 + Math.sin(i / 6) * 1.5 + Math.sin(i / 23) * 0.8;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 0.8, l: c0 - 0.8, c: c0 + 0.1, v: 500 });
  }
  const a = c.analyze(bars);
  for (let i = 1; i < a.pivots.length; i++) {
    const p = a.pivots[i - 1];
    const q = a.pivots[i];
    const lo = Math.max(p.zd, q.zd);
    const hi = Math.min(p.zg, q.zg);
    const overlap = hi > lo ? (hi - lo) / Math.min(p.zg - p.zd, q.zg - q.zd) : 0;
    const gap = q.startBi - p.endBi;
    if (overlap >= 0.5 && gap <= 2) {
      assert.fail(`中枢 ${i - 1} 与 ${i} 重叠 ${(overlap * 100).toFixed(0)}% 且只隔 ${gap} 段，应合并`);
    }
  }
});

test('中枢：合并后仍保留进入段/离开段与段计数', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 500; i++) {
    const c0 = 200 + Math.sin(i / 5) * 2 + Math.sin(i / 31) * 1.1;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 1, l: c0 - 1, c: c0, v: 900 });
  }
  const a = c.analyze(bars);
  for (const p of a.pivots) {
    assert.ok(p.count === p.endBi - p.startBi + 1, 'count 应等于段数');
    if (p.enterBi != null) assert.ok(p.enter === null || typeof p.enter === 'object');
    if (p.leaveBi != null) assert.ok(p.leave && typeof p.leave.dir === 'number');
    assert.ok(p.zd < p.zg);
  }
});

/* ---------------- 数据新鲜度 ---------------- */
test('期货数据陈旧时明确报错，而不是返回空图', async () => {
  const S = require('../server/lib/sources');
  // 6A/DX 在新浪只有 2019 年的十几根残档，必须被新鲜度校验拦下
  await assert.rejects(
    () => S.klines({ market: 'USF', code: '6A', period: 'day', limit: 10 }),
    /陈旧|数据不足/,
    '陈旧数据应被拒绝'
  );
});
