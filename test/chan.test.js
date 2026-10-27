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
