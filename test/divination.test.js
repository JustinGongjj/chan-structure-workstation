'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../server/lib/divination.js');
const D = require('../server/lib/gua-data.js');

const FIXED_TS = Date.UTC(2026, 9, 26, 6, 13); // 2026-10-26 14:13 北京

test('卦象数据完整性：64 卦、8 宫、纳甲齐备', () => {
  assert.equal(D.TRIGRAMS.length, 8);
  assert.equal(D.HEXAGRAMS.length, 64);
  const names = new Set(D.HEXAGRAMS.map((h) => h.name));
  assert.equal(names.size, 64, '卦名不重复');
  const ids = new Set(D.HEXAGRAMS.map((h) => h.id));
  assert.equal(ids.size, 64);
  const palaceNames = Object.values(D.PALACES).flat();
  assert.equal(palaceNames.length, 64);
  palaceNames.forEach((n) => assert.ok(names.has(n), `八宫中的卦名不在 64 卦里：${n}`));
  Object.entries(D.NAJIA).forEach(([, v]) => {
    assert.equal(v.inner.length, 3);
    assert.equal(v.outer.length, 3);
    [...v.inner, ...v.outer].forEach((z) => assert.ok(Boolean(D.ZHI_ELEMENT[z]), '纳甲地支非法：' + z));
  });
});

test('起卦确定性：同输入必同卦', () => {
  const args = { market: 'A', code: '600519', price: 1345.9, pct: 1.12, nonce: 3, mode: 'price', ts: FIXED_TS };
  const a = V.analyze(args);
  const b = V.analyze(args);
  assert.equal(a.hexagram.ben.name, b.hexagram.ben.name);
  assert.equal(a.hexagram.dong, b.hexagram.dong);
  assert.equal(a.hexagram.bian.name, b.hexagram.bian.name);
  assert.equal(a.seed.shakeNo, b.seed.shakeNo, '摇卦数应可复现');
});

test('不同标的起卦不同（换代码必换卦）', () => {
  const base = { price: 100, pct: 0.5, nonce: 0, mode: 'price', ts: FIXED_TS };
  const a = V.analyze({ ...base, market: 'A', code: '600519' });
  const b = V.analyze({ ...base, market: 'A', code: '000001' });
  const c = V.analyze({ ...base, market: 'US', code: 'NVDA' });
  const sig = (x) => `${x.hexagram.ben.name}#${x.hexagram.dong}`;
  const set = new Set([sig(a), sig(b), sig(c)]);
  assert.equal(set.size, 3, '三个不同标的应得到三个不同卦象');
});

test('占次变化会产生新卦（连点必变）', () => {
  const sigs = new Set();
  for (let n = 0; n < 8; n++) {
    const r = V.analyze({ market: 'A', code: '600519', price: 1345.9, pct: 1.12, nonce: n, mode: 'price', ts: FIXED_TS });
    sigs.add(`${r.hexagram.ben.name}#${r.hexagram.dong}`);
  }
  assert.ok(sigs.size >= 4, `8 次起卦至少应出现 4 种不同卦象，实际 ${sigs.size}`);
});

test('时辰模式稳定：同标的同四柱只出一卦，且不受现价影响', () => {
  const a = V.analyze({ market: 'A', code: '600519', mode: 'time', ts: FIXED_TS });
  const b = V.analyze({ market: 'A', code: '600519', mode: 'time', ts: FIXED_TS });
  const c = V.analyze({ market: 'A', code: '600519', mode: 'time', price: 9999, pct: 9.9, nonce: 5, ts: FIXED_TS });
  assert.equal(a.hexagram.ben.name, b.hexagram.ben.name);
  assert.equal(a.hexagram.ben.name, c.hexagram.ben.name);
});

test('六爻排盘：六爻、世应、动爻位置', () => {
  const r = V.analyze({ market: 'A', code: '600519', mode: 'price', nonce: 1, price: 1345.9, pct: 1.12, ts: FIXED_TS });
  const ly = r.liuyao;
  assert.equal(ly.yaos.length, 6);
  assert.equal(ly.yaos.filter((y) => y.shi).length, 1, '恰好一个世爻');
  assert.equal(ly.yaos.filter((y) => y.ying).length, 1, '恰好一个应爻');
  const dong = ly.yaos.filter((y) => y.dong);
  assert.equal(dong.length, 1, '恰好一个动爻');
  assert.equal(dong[0].pos, r.hexagram.dong);
  ly.yaos.forEach((y) => {
    assert.ok(['阳', '阴'].includes(y.yin));
    assert.ok(D.LIU_SHEN.includes(y.liushen));
    assert.ok(['父母', '兄弟', '子孙', '妻财', '官鬼'].includes(y.liuqin));
  });
  assert.equal(r.hexagram.lines.length, 6);
  assert.ok(r.hexagram.lines.every((x) => x === 0 || x === 1));
});

test('变卦 = 动爻翻转；互卦由二三四 / 三四五爻组成', () => {
  for (let n = 0; n < 6; n++) {
    const r = V.analyze({ market: 'CR', code: 'BTCUSDT', mode: 'price', nonce: n, price: 80000, pct: -0.7, ts: FIXED_TS });
    const lines = r.hexagram.lines.slice();
    const flipped = lines.slice();
    flipped[r.hexagram.dong - 1] = flipped[r.hexagram.dong - 1] ? 0 : 1;
    const find = (ls) => {
      const tri = (a, b, c) => D.TRIGRAMS.find((t) => t.lines.join('') === [a, b, c].join('')).name;
      const lower = tri(ls[0], ls[1], ls[2]);
      const upper = tri(ls[3], ls[4], ls[5]);
      return D.HEXAGRAMS.find((h) => h.upper === upper && h.lower === lower).name;
    };
    assert.equal(r.hexagram.bian.name, find(flipped), '变卦不正确');
    assert.equal(r.hexagram.hu.name, find([lines[1], lines[2], lines[3], lines[2], lines[3], lines[4]]), '互卦不正确');
  }
});

test('时间参数非法时回退到当前时间且不抛错', () => {
  const r = V.analyze({ market: 'A', code: '600519', mode: 'price', ts: NaN });
  assert.ok(r.hexagram.ben.name);
  assert.ok(r.when);
});
