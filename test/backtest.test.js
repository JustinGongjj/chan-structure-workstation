'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* ---------------- 止损话术与实测一致（与星图同步） ---------------- */
test('止损提示：不应把"未设止损"说成风险（实测不止损胜率更高）', () => {
  const BT = require('../server/lib/btengine.js');
  const S = require('../server/lib/sources.js');
  return S.klines({ market: 'A', code: '600519', period: 'day', limit: 800 }).then((k) => {
    const r0 = BT.runBacktest(k.bars, { period: 'day', exitOn: 'signal', entry: 'buy', stopPct: 0, takePct: 0, maxConfirmLag: 3 });
    const c0 = (r0.caveats || []).join(' ');
    // 旧文案「未设置止损：单笔风险不可控」与实际实测相反，不得再出现
    assert.ok(!/未设置止损：单笔风险不可控/.test(c0), '不应再出现旧的止损警示');
    assert.ok(/未设止损/.test(c0), '应说明本次未设止损');

    const r5 = BT.runBacktest(k.bars, { period: 'day', exitOn: 'signal', entry: 'buy', stopPct: 5, takePct: 0, maxConfirmLag: 3 });
    const c5 = (r5.caveats || []).join(' ');
    assert.ok(/已设 5% 止损/.test(c5), '设了止损应给出对照提示');
    // 每档引用自己的数据，不能张冠李戴
    const r8 = BT.runBacktest(k.bars, { period: 'day', exitOn: 'signal', entry: 'buy', stopPct: 8, takePct: 0, maxConfirmLag: 3 });
    const c8 = (r8.caveats || []).join(' ');
    assert.ok(/8% 止损 44\.2%/.test(c8), '8% 档应引用 44.2%');
    assert.ok(!/8% 止损 32\.8%/.test(c8), '8% 档不应引用 5% 的数据');
  });
});
