'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../server/lib/lunar.js');
const Z = require('../server/lib/ziwei.js');
const Q = require('../server/lib/qimen.js');

const bj = (s) => new Date(s); // ISO 字符串，内含 +08:00 的换算在库内做

test('农历：春节/中秋/闰月锚点', () => {
  const cases = [
    ['2023-01-22T04:00:00Z', 2023, 1, 1, false],
    ['2024-02-10T04:00:00Z', 2024, 1, 1, false],
    ['2025-01-29T04:00:00Z', 2025, 1, 1, false],
    ['2026-02-17T04:00:00Z', 2026, 1, 1, false],
    ['2024-09-17T04:00:00Z', 2024, 8, 15, false],
    ['2025-10-06T04:00:00Z', 2025, 8, 15, false],
    ['2023-03-22T04:00:00Z', 2023, 2, 1, true],
    ['2025-07-25T04:00:00Z', 2025, 6, 1, true],
  ];
  for (const [d, y, m, day, leap] of cases) {
    const r = L.solarToLunar(bj(d));
    assert.equal(r.year, y, d + ' 年');
    assert.equal(r.month, m, d + ' 月');
    assert.equal(r.day, day, d + ' 日');
    assert.equal(r.isLeap, leap, d + ' 闰月');
  }
});

test('农历：逐日连续（跨 1100 天无跳变）', () => {
  let prev = null;
  for (let i = 0; i < 1100; i++) {
    const d = new Date(Date.UTC(2023, 0, 1) - 8 * 3600000 + i * 86400000);
    const r = L.solarToLunar(d);
    if (prev) {
      const ok = r.day === prev.day + 1 || (r.day === 1 && prev.day >= 28);
      assert.ok(ok, `第 ${i} 天不连续：${prev.day} → ${r.day}`);
    }
    prev = r;
  }
});

test('紫微：起紫微星诀三个经典例子', () => {
  assert.equal(Z.ziweiIndex(3, 27).ziweiIndex, 8, '27日木三局 → 戌');
  assert.equal(Z.ziweiIndex(6, 13).ziweiIndex, 9, '13日火六局 → 亥');
  assert.equal(Z.ziweiIndex(5, 6).ziweiIndex, 5, '6日土五局 → 未');
});

test('紫微：五行局纳音巧记三例', () => {
  assert.equal(Z.fiveElementsClass('丙', '子'), '水二局');
  assert.equal(Z.fiveElementsClass('辛', '未'), '土五局');
  assert.equal(Z.fiveElementsClass('庚', '申'), '木三局');
});

test('紫微：整盘结构不变量', () => {
  const c = Z.chart(new Date('2026-10-26T04:00:00Z'), 7);
  assert.equal(c.palaces.length, 12);
  const names = c.palaces.map((p) => p.name).sort();
  assert.deepEqual(names, ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '仆役', '官禄', '田宅', '福德', '父母'].sort());
  const stars = c.palaces.flatMap((p) => p.stars);
  assert.equal(stars.length, 14, '十四主星各一');
  assert.equal(new Set(stars).size, 14);
  assert.ok(c.soul.branch && c.body.branch);
  assert.equal(c.palaces.filter((p) => p.isSoul).length, 1);
  assert.equal(c.palaces.filter((p) => p.isBody).length, 1);
  assert.equal(Object.keys(c.sihua).length, 4, '四化四种');
  assert.ok(['水二局', '木三局', '金四局', '土五局', '火六局'].includes(c.fiveElements));
});

test('奇门：九宫结构不变量（8门/9星/8神，中宫不排门神）', () => {
  for (const d of ['2026-10-26T06:13:00Z', '2026-01-15T02:00:00Z', '2026-07-01T06:00:00Z']) {
    const c = Q.chart(new Date(d));
    assert.equal(c.cells.length, 9);
    assert.equal(c.cells.filter((x) => x.door).length, 8, d + ' 门数');
    assert.equal(c.cells.filter((x) => x.star).length, 9, d + ' 星数');
    assert.equal(c.cells.filter((x) => x.god).length, 8, d + ' 神数');
    assert.equal(new Set(c.cells.map((x) => x.door).filter(Boolean)).size, 8, '门不重复');
    assert.equal(new Set(c.cells.map((x) => x.star)).size, 9, '星不重复');
    const center = c.cells.find((x) => x.palace === 5);
    assert.equal(center.door, null);
    assert.equal(center.god, null);
    assert.ok(['阴', '阳'].includes(c.dun));
    assert.ok(c.ju >= 1 && c.ju <= 9);
  }
});

test('奇门：冬至后阳遁、夏至后阴遁', () => {
  assert.equal(Q.chart(new Date('2026-01-15T02:00:00Z')).dun, '阳');
  assert.equal(Q.chart(new Date('2026-07-01T06:00:00Z')).dun, '阴');
});

test('两个方法都确定性可复现', () => {
  const a = Z.chart(new Date('2026-10-26T04:00:00Z'), 7);
  const b = Z.chart(new Date('2026-10-26T04:00:00Z'), 7);
  assert.deepEqual(a.palaces, b.palaces);
  const q1 = Q.chart(new Date('2026-10-26T06:13:00Z'));
  const q2 = Q.chart(new Date('2026-10-26T06:13:00Z'));
  assert.deepEqual(q1.cells, q2.cells);
});
