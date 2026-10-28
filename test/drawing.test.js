/* 手绘线校验引擎：确定性、可复现，因此可以像缠论引擎一样单测 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../server/lib/drawing');

/* 造一个可控的"结构"：一段上涨 + 一个中枢 + 一个下跌段 + 一个二买 */
function fakeAnalysis() {
  const bars = [];
  for (let i = 0; i < 200; i++) {
    const base = 10 + Math.sin(i / 9) * 1.2 + i * 0.02;
    bars.push({ t: 1700000000000 + i * 86400000, o: base, h: base + 0.3, l: base - 0.3, c: base, v: 1000 });
  }
  return {
    bars,
    bis: [
      { dir: 1, i0: 5, p0: bars[5].c, i1: 40, p1: bars[40].c },
      { dir: -1, i0: 40, p0: bars[40].c, i1: 70, p1: bars[70].c },
      { dir: 1, i0: 70, p0: bars[70].c, i1: 120, p1: bars[120].c }
    ],
    segments: [{ i0: 5, i1: 120 }],
    pivots: [{ idx: 0, zg: bars[60].c + 0.5, zd: bars[60].c - 0.5, gg: bars[40].c, dd: bars[70].c, height: 1, count: 3, i0: 30, i1: 90, active: false }],
    signals: [{ type: '2B', name: '第二类买点', barIdx: 120, price: bars[120].c }],
    trend: { type: '上涨趋势' },
    level: { levelName: '日线级别', short: 'D' }
  };
}

test('端点落在笔端点上会被识别并加分', () => {
  const a = fakeAnalysis();
  const bi = a.bis[0];
  const r = D.verify({ drawings: [{ type: 'trend', x1: bi.i0, y1: bi.p0, x2: bi.i1, y2: bi.p1 }], analysis: a });
  const codes = r.lines[0].findings.map((f) => f.code);
  assert.ok(codes.includes('snap-bi'), '应识别起点吸附');
  assert.ok(codes.includes('snap-bi-end'), '应识别终点吸附');
  assert.ok(r.score > 60, '该线应有较高分，实际 ' + r.score);
});

test('随意画的线会被打回并给出对齐建议', () => {
  const a = fakeAnalysis();
  const r = D.verify({ drawings: [{ type: 'trend', x1: 12, y1: a.bars[12].c * 1.06, x2: 150, y2: a.bars[150].c * 1.1 }], analysis: a });
  const codes = r.lines[0].findings.map((f) => f.code);
  assert.ok(codes.includes('off-bi') || codes.includes('off-bi-end'), '应提示端点未吸附');
  assert.ok(r.score < 80, '分数应明显低于吸附线，实际 ' + r.score);
});

test('水平线贴中枢上沿被判为有结构含义', () => {
  const a = fakeAnalysis();
  const p = a.pivots[0];
  const r = D.verify({ drawings: [{ type: 'hline', x1: p.i0, y1: p.zg }], analysis: a });
  const f = r.lines[0].findings;
  assert.ok(f.some((x) => x.code === 'pivot-edge' && x.level === 'ok'), '应命中中枢上沿');
  assert.ok(!f.some((x) => x.code === 'off-bi'), '水平线不做笔端点判定');
});

test('悬空水平线被判为无结构意义', () => {
  const a = fakeAnalysis();
  const far = Math.max(...a.bars.map((b) => b.h)) * 1.5; // 远离整个价格区间
  const r = D.verify({ drawings: [{ type: 'hline', x1: 50, y1: far }], analysis: a });
  assert.ok(r.lines[0].findings.some((x) => x.code === 'floating-level'), '应提示悬空');
});

test('矩形框住中枢得分最高', () => {
  const a = fakeAnalysis();
  const p = a.pivots[0];
  const r = D.verify({ drawings: [{ type: 'rect', x1: p.i0 - 1, y1: p.zd, x2: p.i1 + 1, y2: p.zg }], analysis: a });
  assert.ok(r.lines[0].findings.some((x) => x.code === 'box-pivot' && x.level === 'ok'));
  assert.ok(r.lines[0].score >= 80);
});

test('端点贴着买卖点会加分并指出类型', () => {
  const a = fakeAnalysis();
  const s = a.signals[0];
  const r = D.verify({ drawings: [{ type: 'trend', x1: 70, y1: a.bars[70].c, x2: s.barIdx, y2: s.price }], analysis: a });
  assert.ok(r.lines[0].findings.some((x) => x.code === 'near-signal' && /第二类买点/.test(x.text)));
});

test('数据太少时给降级提示', () => {
  const a = fakeAnalysis();
  a.bars = a.bars.slice(0, 40);
  const r = D.verify({ drawings: [{ type: 'trend', x1: 5, y1: a.bars[5].c, x2: 20, y2: a.bars[20].c }], analysis: a });
  assert.ok(r.lines[0].findings.some((x) => x.code === 'few-bars'));
});

test('空列表给出引导而不是报错', () => {
  const a = fakeAnalysis();
  const r = D.verify({ drawings: [], analysis: a });
  assert.equal(r.score, 0);
  assert.ok(/还没有画线/.test(r.verdict.text));
});

test('非法坐标被当作硬错误', () => {
  const a = fakeAnalysis();
  const r = D.verify({ drawings: [{ type: 'trend', x1: 10, y1: 'abc', x2: 20, y2: 5 }], analysis: a });
  assert.ok(r.lines[0].findings.some((x) => x.level === 'fail' && x.code === 'bad-value'));
  assert.equal(r.score, 0);
});

test('同一组输入结果完全可复现', () => {
  const a = fakeAnalysis();
  const input = [{ type: 'trend', x1: 5, y1: a.bars[5].c, x2: 40, y2: a.bars[40].c }];
  const r1 = D.verify({ drawings: input, analysis: a });
  const r2 = D.verify({ drawings: input, analysis: a });
  assert.deepEqual(r1.lines, r2.lines);
  assert.equal(r1.score, r2.score);
});
