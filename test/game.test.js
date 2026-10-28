/* 闯关引擎：题目生成、判分、答案保密、确定性 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../server/lib/game');
const K = require('../server/lib/chan-lessons');

/* 用真实课程索引，但要避免网络：这里只测不依赖行情的纯逻辑 + 用假行情注入判分 */
test('地图正好 108 关，且每关都有章节/题型/难度', () => {
  const m = G.buildMap(K);
  assert.equal(m.total, 108);
  const levels = m.chapters.flatMap((c) => c.levels);
  assert.equal(levels.length, 108);
  const seen = new Set();
  for (const l of levels) {
    assert.ok(l.no >= 1 && l.no <= 108);
    assert.ok(['predict', 'signal', 'pivot', 'beichi'].includes(l.mechanic), '未知题型 ' + l.mechanic);
    assert.ok(['bronze', 'silver', 'gold', 'king'].includes(l.rank));
    assert.ok(l.title && l.title.length > 0);
    seen.add(l.no);
  }
  assert.equal(seen.size, 108, '关卡号不能重复');
});

test('难度分档：1-27 青铜 / 28-54 白银 / 55-81 黄金 / 82-108 王者', () => {
  const m = G.buildMap(K);
  const lv = m.chapters.flatMap((c) => c.levels);
  const rank = (no) => lv.find((l) => l.no === no).rank;
  assert.equal(rank(1), 'bronze');
  assert.equal(rank(27), 'bronze');
  assert.equal(rank(28), 'silver');
  assert.equal(rank(54), 'silver');
  assert.equal(rank(55), 'gold');
  assert.equal(rank(81), 'gold');
  assert.equal(rank(82), 'king');
  assert.equal(rank(108), 'king');
});

test('关卡规划是确定性的：同一关永远同一个市场/标的', () => {
  for (const no of [1, 42, 77, 108]) {
    const a = G.levelPlan(no);
    const b = G.levelPlan(no);
    assert.equal(a.market, b.market);
    assert.equal(a.code, b.code);
    assert.equal(a.hidden, b.hidden);
  }
});

test('不同关卡会分到不同标的（题目不能全一样）', () => {
  const keys = new Set();
  for (let no = 1; no <= 30; no++) {
    const p = G.levelPlan(no);
    keys.add(p.market + ':' + p.code);
  }
  assert.ok(keys.size >= 8, '30 关里至少应有 8 个不同标的，实际 ' + keys.size);
});

test('难度越高隐藏的 K 线越多', () => {
  const b = G.levelPlan(1).hidden;
  const g = G.levelPlan(60).hidden;
  const k = G.levelPlan(100).hidden;
  assert.ok(g >= b && k >= g, `隐藏根数应随难度不减：${b} / ${g} / ${k}`);
});
