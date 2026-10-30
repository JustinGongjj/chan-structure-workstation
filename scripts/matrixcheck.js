#!/usr/bin/env node
/**
 * 全链路矩阵巡检：市场 × 品种 × 接口
 *   node scripts/matrixcheck.js [--base http://127.0.0.1:8931]
 * 检查每个市场是否真的能：搜得到 → 报价有 → K线够 → 缠论结构出 → 图上能画
 */
'use strict';
const BASE = (() => { const i = process.argv.indexOf('--base'); return i >= 0 ? process.argv[i + 1] : 'http://127.0.0.1:8931'; })();

const CASES = [
  { m: 'A', codes: ['600519', '300750', '000001'] },
  { m: 'HK', codes: ['00700', '09988'] },
  { m: 'US', codes: ['NVDA', 'AAPL'] },
  { m: 'CR', codes: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'] },
  { m: 'CNF', codes: ['RB0', 'IF0', 'AU0', 'CU0', 'M0', 'I0', 'T0', 'AP0', 'SC0', 'JD0'] },
  { m: 'USF', codes: ['ES', 'NQ', 'GC', 'CL', 'SI', 'HG', 'LE', 'YM'] }
];

const SEARCH_CASES = ['黄金', '白银', '铜', '原油', '螺纹钢', '铁矿石', '沪深300', '国债', '苹果', '以太坊', '狗狗币', '标普', '纳指'];

async function j(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

(async () => {
  let pass = 0, fail = 0;
  const fails = [];
  const ok = (cond, name, detail) => {
    if (cond) { pass++; }
    else { fail++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); }
  };

  console.log('=== 1. 搜索覆盖 ===');
  for (const q of SEARCH_CASES) {
    try {
      const r = await j(`${BASE}/api/search?q=${encodeURIComponent(q)}`);
      const items = r.items || [];
      const fut = items.filter((x) => x.market === 'CNF' || x.market === 'USF');
      const cr = items.filter((x) => x.market === 'CR');
      const wantCommodity = !['以太坊', '狗狗币'].includes(q);
      const good = wantCommodity ? fut.length > 0 : cr.length > 0;
      ok(good, `搜索「${q}」`, `期货${fut.length} 加密${cr.length} 共${items.length}`);
      console.log(`  ${good ? '✓' : '✗'} ${q.padEnd(8)} ${items.slice(0, 4).map((x) => x.market + ':' + x.code).join(' ') || '(空)'}`);
    } catch (e) { ok(false, `搜索「${q}」`, e.message); }
  }

  console.log('\n=== 2. 品种全链路（报价 / K线 / 缠论） ===');
  for (const c of CASES) {
    for (const code of c.codes) {
      const tag = `${c.m}:${code}`;
      try {
        const k = await j(`${BASE}/api/kline?market=${c.m}&code=${code}&period=day&limit=300`);
        ok((k.bars || []).length >= 200, `${tag} K线`, `只有 ${(k.bars || []).length} 根`);
        const ch = await j(`${BASE}/api/chan?market=${c.m}&code=${code}&period=day&limit=400`);
        const pv = (ch.pivots || []).length;
        const bis = (ch.bis || []).length;
        ok(ch.ok && bis >= 5, `${tag} 缠论`, `笔${bis} 中枢${pv}`);
        // 中枢几何：每个中枢都要有进出段字段
        const noEnter = (ch.pivots || []).filter((p) => p.enterBi === undefined).length;
        ok(noEnter === 0, `${tag} 中枢字段`, `${noEnter} 个中枢缺 enterBi`);
        console.log(`  ✓ ${tag.padEnd(14)} bars=${(k.bars || []).length} 笔=${bis} 中枢=${pv} 源=${k.source}`);
      } catch (e) { ok(false, `${tag}`, e.message); console.log(`  ✗ ${tag.padEnd(14)} ${e.message}`); }
    }
  }

  console.log('\n=== 3. 报价（含贵金属现货交叉校验） ===');
  try {
    const q = await j(`${BASE}/api/quote?list=USF:GC,USF:SI,CNF:AU0,CNF:RB0`);
    for (const x of q.quotes) {
      ok(Number.isFinite(x.price) && x.price > 0, `报价 ${x.market}:${x.code}`, String(x.price));
      console.log(`  ✓ ${x.market}:${x.code} ${x.price} ${x.pct}% ${x.spotPrice ? '(现货 ' + x.spotPrice.toFixed(2) + ')' : ''}`);
    }
  } catch (e) { ok(false, '报价', e.message); }

  console.log('\n=== 4. 概览脉冲覆盖六个市场 ===');
  try {
    const ov = await j(`${BASE}/api/overview`);
    const keys = Object.keys(ov.pulse || {});
    ok(keys.length === 6, '概览市场数', keys.join(','));
    console.log(`  ${keys.length === 6 ? '✓' : '✗'} pulse: ${keys.join(',')}`);
  } catch (e) { ok(false, '概览', e.message); }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
