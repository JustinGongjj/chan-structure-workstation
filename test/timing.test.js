'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../server/lib/timing.js');
const BT = require('../server/lib/backtest.js');

const TS = Date.UTC(2026, 9, 26, 6, 13); // 2026-10-26 14:13 北京

function bars(n, seed = 3) {
  let p = 100;
  const out = [];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(1, p + Math.sin(i / 8) * 1.4 + (rnd() - 0.5) * 1.2);
    out.push({ t: Date.UTC(2026, 0, 1) + i * 86400000, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 1000 });
    p = c;
  }
  return out;
}

test('择时：五个方法都能出分，且分数在 0-100', () => {
  const r = T.evaluate({ market: 'A', code: '600519', ts: TS });
  assert.deepEqual(Object.keys(r.methods).sort(), ['cycle', 'ganzhi', 'jianchu', 'liuyao', 'meihua']);
  for (const m of Object.values(r.methods)) {
    assert.ok(m.score >= 0 && m.score <= 100, m.id + ' 分数越界');
    assert.ok(Array.isArray(m.reasons) && m.reasons.length > 0, m.id + ' 缺少理由');
  }
  assert.ok(r.composite >= 0 && r.composite <= 100);
  assert.ok(['顺', '偏顺', '中性', '偏逆', '逆'].includes(r.label));
  assert.ok(r.verdict.text.length > 10);
});

test('择时：同输入确定性、换标的必换分', () => {
  const a = T.evaluate({ market: 'A', code: '600519', ts: TS });
  const b = T.evaluate({ market: 'A', code: '600519', ts: TS });
  assert.equal(a.composite, b.composite);
  const c = T.evaluate({ market: 'A', code: '000001', ts: TS });
  const diff = Object.keys(a.methods).filter((k) => a.methods[k].score !== c.methods[k].score);
  assert.ok(diff.length >= 3, '换标的至少 3 个方法分数应不同，实际 ' + diff.length);
});

test('择时：方法可裁剪，权重归一后综合分仍在区间内', () => {
  const r = T.evaluate({ market: 'CR', code: 'BTCUSDT', ts: TS, methods: ['meihua', 'liuyao'] });
  assert.deepEqual(Object.keys(r.methods).sort(), ['liuyao', 'meihua']);
  assert.ok(r.composite >= 0 && r.composite <= 100);
  const w = T.evaluate({ market: 'CR', code: 'BTCUSDT', ts: TS, weights: { meihua: 1, liuyao: 1 } });
  assert.ok(w.composite >= 0 && w.composite <= 100);
});

test('回测：信号统计字段完整、样本口径正确（未走完的信号不计入）', () => {
  const b = bars(120);
  const signals = [
    { type: '1B', barIdx: 10, price: 1 },
    { type: '3B', barIdx: 60, price: 1 },
    { type: '1S', barIdx: 50, price: 1 },
    { type: '2B', barIdx: 118, price: 1 }, // 不够 5 根，应被丢弃
  ];
  const st = BT.signalStats(b, signals, { horizon: 5 });
  assert.equal(st.horizon, 5);
  const total = Object.values(st.byType).reduce((a, x) => a + x.n, 0);
  assert.equal(total, 3, '未走完的信号应被排除');
  for (const v of Object.values(st.byType)) {
    assert.ok(v.winRate >= 0 && v.winRate <= 1);
    assert.ok(Number.isFinite(v.avgRet));
  }
  assert.ok(st.baseline.n > 0);
  assert.ok(Number.isFinite(st.edge));
});

test('回测：择时方法逐日检验返回相关系数与判定', () => {
  const b = bars(200);
  const res = BT.timingStats(b, (ts) => T.evaluate({ market: 'A', code: '600519', ts }), { days: 120, horizon: 1 });
  assert.ok(res.days >= 50, '有效样本 ' + res.days);
  assert.ok(res.methods.length === 5);
  for (const m of res.methods) {
    assert.ok(m.corr === null || Math.abs(m.corr) <= 1);
    assert.ok(m.n >= 1);
  }
  assert.ok(res.composite.high.n > 0);
  assert.ok(['positive', 'neutral', 'negative', 'insufficient'].includes(res.verdict.level));
  // 合成随机行情不应被吹成"有效"
  if (res.corr != null) assert.ok(Math.abs(res.corr) < 0.35);
});
