'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const LEDGER = require('../server/lib/picksledger');

function entry(overrides = {}) {
  return {
    pickDate: '2026-11-01',
    price: 100,
    buyLow: 97,
    buyHigh: 103,
    stop: 92,
    target: 112,
    holdDays: 10,
    ...overrides,
  };
}

function bar(day, fields = {}) {
  return {
    t: `${day}T00:00:00.000Z`,
    o: 100,
    h: 101,
    l: 99,
    c: 100.5,
    ...fields,
  };
}

test('台账：10 日持有期只有 1 根后续日线时不提前结算为盈利', () => {
  const result = LEDGER.settleOne(entry(), [bar('2026-11-01'), bar('2026-11-02')]);
  assert.equal(result, null, '行情不足时应保持未结算，不能按单日收益结论');
});

test('台账：持有期内触发止损或止盈仍可立即结算', () => {
  const stopped = LEDGER.settleOne(entry(), [bar('2026-11-02', { l: 91 })]);
  assert.equal(stopped.result, 'stopped');

  const targetHit = LEDGER.settleOne(entry(), [bar('2026-11-02', { h: 113 })]);
  assert.equal(targetHit.result, 'hit_target');
});

test('台账：完整持有 10 根日线后才按窗口末日收盘结算', () => {
  const bars = [bar('2026-11-01')];
  for (let i = 0; i < 10; i++) {
    const day = new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10);
    bars.push(bar(day, { c: i === 9 ? 101 : 100.5 }));
  }

  const result = LEDGER.settleOne(entry(), bars);
  assert.equal(result.status, 'settled');
  assert.equal(result.result, 'expired_win');
  assert.equal(result.settlePx, 101);
  assert.match(result.note, /持有 10 日到期/);
});
