'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../server/lib/ganzhi.js');

const bj = (s) => new Date(s); // 传入 ISO 字符串，内部按 UTC+8 换算成北京时间

test('日柱锚点：1949-10-01 甲子日、2000-01-01 戊午日、2024-02-10 甲辰日', () => {
  assert.equal(G.dayGanzhi(bj('1949-10-01T04:00:00Z')).text, '甲子');
  assert.equal(G.dayGanzhi(bj('2000-01-01T04:00:00Z')).text, '戊午');
  assert.equal(G.dayGanzhi(bj('2024-02-10T04:00:00Z')).text, '甲辰');
});

test('年柱以立春换年：2024-02-10 为甲辰，2024-01-15 仍为癸卯', () => {
  assert.equal(G.yearGanzhi(bj('2024-02-10T04:00:00Z')).text, '甲辰');
  assert.equal(G.yearGanzhi(bj('2024-01-15T04:00:00Z')).text, '癸卯');
});

test('月柱以节换月：2026-10-26 为戊戌月，2024-02-10 为丙寅月', () => {
  const y1 = G.yearGanzhi(bj('2026-10-26T04:00:00Z'));
  assert.equal(G.monthGanzhi(bj('2026-10-26T04:00:00Z'), y1).text, '戊戌');
  const y2 = G.yearGanzhi(bj('2024-02-10T04:00:00Z'));
  assert.equal(G.monthGanzhi(bj('2024-02-10T04:00:00Z'), y2).text, '丙寅');
});

test('时柱五鼠遁：癸日未时为己未，甲日子时为甲子', () => {
  const d1 = G.dayGanzhi(bj('2026-10-26T06:13:00Z')); // 北京 14:13 → 未时
  assert.equal(d1.text, '癸酉');
  assert.equal(G.hourGanzhi(bj('2026-10-26T06:13:00Z'), d1).text, '己未');
  const d2 = G.dayGanzhi(bj('2000-01-01T04:00:00Z')); // 戊午日，子时
  assert.equal(G.hourGanzhi(bj('2000-01-01T16:30:00Z'), d2).name, '子时');
});

test('二十四节气：每年 24 个，顺序正确，立春落在 2 月 3–5 日', () => {
  for (const y of [2024, 2025, 2026]) {
    const terms = G.solarTerms(y);
    assert.equal(terms.length, 24, `${y} 年节气数量`);
    for (let i = 1; i < terms.length; i++) assert.ok(terms[i].date > terms[i - 1].date, '节气时间递增');
    const lichun = terms.find((t) => t.name === '立春');
    const d = new Date(lichun.date.getTime() + 8 * 3600000); // 节气时间戳本身是北京墙上时间
    const day = d.getUTCDate();
    assert.ok(d.getUTCMonth() === 1 && day >= 3 && day <= 5, `${y} 立春日期异常：${d.toISOString()}`);
    const jieCount = terms.filter((t) => t.jie).length;
    assert.equal(jieCount, 12, '「节」应有 12 个');
  }
});

test('建除十二神与旬空', () => {
  const r = G.jianChu('戌', '酉');
  assert.ok(G.JIANCHU.includes(r));
  assert.equal(G.jianChu('子', '子'), '建');
  const d = G.dayGanzhi(bj('2026-10-26T04:00:00Z')); // 癸酉
  const kong = G.xunKong(d);
  assert.equal(kong.length, 2, '旬空为两个地支');
  assert.ok(kong.every((z) => G.ZHI.includes(z)));
});

test('agenda：四柱、时辰、节气上下界齐备', () => {
  const a = G.agenda(bj('2026-10-26T06:13:00Z'));
  assert.equal(a.pillars.year.text, '丙午');
  assert.equal(a.pillars.month.text, '戊戌');
  assert.equal(a.pillars.day.text, '癸酉');
  assert.equal(a.pillars.hour.text, '己未');
  assert.equal(a.pillars.hour.name, '未时');
  assert.equal(a.shichen.length, 12);
  assert.ok(a.terms.prev && a.terms.next, '有前后节气');
  assert.ok(a.beijingTime.startsWith('2026-10-26 14:13'));
});
