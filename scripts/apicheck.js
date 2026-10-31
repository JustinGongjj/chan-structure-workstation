#!/usr/bin/env node
/**
 * 接口全量巡检：把每个 API 真跑一遍，校验结构与非空。
 *   node scripts/apicheck.js [--base http://127.0.0.1:8931]
 * 退出码 0 = 全通；1 = 有失败项。
 */
'use strict';
const argv = process.argv.slice(2);
const i = argv.indexOf('--base');
const BASE = i >= 0 ? argv[i + 1] : 'http://127.0.0.1:8931';

const results = [];
async function hit(name, path, check, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const ms = Date.now() - t0;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    if (json === null) throw new Error('响应不是 JSON');
    const problem = check ? check(json) : null;
    if (problem) throw new Error(problem);
    results.push({ name, path, ms, ok: true, note: opts.note || '' });
    return json;
  } catch (e) {
    results.push({ name, path, ms: Date.now() - t0, ok: false, error: e.message });
    return null;
  }
}
const need = (cond, msg) => (cond ? null : msg);

/* 期望被服务端拒绝（用于重复添加这类校验） */
async function expectFail(name, path, status, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    if (res.status !== status) throw new Error(`期望 ${status}，实际 ${res.status} ${text.slice(0, 80)}`);
    results.push({ name, path, ms: Date.now() - t0, ok: true, note: `已正确拒绝 ${status}` });
  } catch (e) {
    results.push({ name, path, ms: Date.now() - t0, ok: false, error: e.message });
  }
}

(async () => {
  await hit('健康检查', '/api/health', j => need(j.ok && j.node, '缺 ok/node'));
  await hit('市场定义', '/api/markets', j => need(Object.keys(j.markets || {}).length >= 4, '市场不足 4 个'));
  await hit('总览聚合', '/api/overview', j => need(j.pulse && j.watch && j.indices, '缺 pulse/watch/indices'));
  await hit('数据源探测', '/api/sources', j => need(Array.isArray(j.sources) && j.sources.length, '无数据源'));
  await hit('搜索', '/api/search?q=茅台', j => need(Array.isArray(j.items) && j.items.length, '搜索无结果'));

  for (const [mk, code] of [['A', '600519'], ['HK', '00700'], ['US', 'NVDA'], ['CR', 'BTCUSDT'], ['CNF', 'RB0'], ['USF', 'ES']]) {
    await hit(`报价 ${mk}`, `/api/quote?list=${mk}:${code}`, j => need(j.quotes?.[0]?.price > 0, '报价为空'));
    await hit(`K线 ${mk}`, `/api/kline?market=${mk}&code=${code}&period=day&limit=120`, j => need(j.bars?.length > 50, 'K 线不足'));
    await hit(`缠论 ${mk}`, `/api/chan?market=${mk}&code=${code}&period=day&limit=400`, j =>
      need(j.ok && j.bars?.length > 100 && Array.isArray(j.bis) && Array.isArray(j.pivots), '缠论结构缺失'));
  }
  await hit('周期 60分', '/api/kline?market=A&code=600519&period=60m&limit=200', j => need(j.bars?.length > 30, '60 分 K 线不足'));
  await hit('多级别', '/api/suite?market=A&code=600519', j => need(j.levels && Object.keys(j.levels).length >= 2, '多级别缺失'));
  await hit('雷达扫描', '/api/radar?scope=all&period=day', j => need(Array.isArray(j.rows) && j.rows.length >= 4, '雷达行数不足'));
  await hit('干支日课', '/api/daily', j => need(j.pillars?.day?.text && j.jianchu, '缺干支/建除'));
  await hit('择时七法', '/api/timing?market=A&code=600519', j => need(j.composite !== undefined && j.methods, '缺 composite/methods'));
  await hit('择时验证', '/api/timing/validate?market=A&code=600519', j => need(j.verdict || j.corr !== undefined, '缺验证结论'), { note: '较慢' });
  await hit('信号回测', '/api/backtest?market=A&code=600519', j => need(j.overall && j.overall.n >= 0, '缺 overall'));
  await hit('算卦', '/api/divination?market=A&code=600519', j =>
    need(j.hexagram?.ben?.name && j.hexagram?.hu?.name && j.liuyao && Array.isArray(j.narrative), '缺卦象/纳甲/断语'));
  await hit('手绘线读取', '/api/drawings?market=A&code=600519&period=day', j => need(Array.isArray(j.drawings), '缺 drawings'));
  await hit('手绘线保存', '/api/drawings', j => need(j.count === 1 && j.drawings[0].type === 'hline', '保存失败'), { method: 'POST', body: { market: 'A', code: '600519', period: 'day', drawings: [{ type: 'hline', x1: 10, y1: 1355.9 }] } });
  await hit('手绘线校验', '/api/drawings/verify', j => need(typeof j.score === 'number' && Array.isArray(j.lines) && j.verdict, '缺 score/lines/verdict'), { method: 'POST', body: { market: 'A', code: '600519', period: 'day', drawings: [{ type: 'hline', x1: 10, y1: 1355.9 }, { type: 'trend', x1: 2, y1: 1362, x2: 32, y2: 1486 }] } });
  await hit('手绘线清空', '/api/drawings', j => need(j.count === 0, '清空失败'), { method: 'POST', body: { market: 'A', code: '600519', period: 'day', drawings: [] } });
  await hit('商品板块目录', '/api/sectors', j => need(j.total >= 80 && j.sectors.length >= 6, `板块 ${j.sectors.length} / 品种 ${j.total}`));
  for (const sid of ['base', 'precious', 'ferrous', 'energy', 'agri', 'fin']) {
    await hit(`板块快照 ${sid}`, '/api/sector?id=' + sid, j => need(j.items.length > 0 && j.items.every(i => 'price' in i), '板块为空或缺 price 字段'));
  }
  await expectFail('未知板块应报错', '/api/sector?id=nope', 400);
  await hit('闯关地图', '/api/game/map', j => need(j.total === 108 && j.chapters.length >= 10, '关卡总数/章节不对'));
  const lv = await hit('闯关出题', '/api/game/level?no=7', j => need(j.visibleBars?.length > 80 && j.token && j.attemptId && j.question, '缺 K 线/token/attemptId/题目'));
  if (lv) {
    // 出题阶段不能泄露任何可反查的东西：标的代码、真实时间轴、截断点、数据源
    const leakFields = ['code', 'cutoff', 'name', 'source'].filter((k) => k in lv);
    const realTime = (lv.visibleBars[0] || {}).t !== Date.UTC(2020, 0, 1);
    const answerish = JSON.stringify(lv).includes('revealedBars') || JSON.stringify(lv).includes('"dir"');
    results.push({
      name: '闯关不泄题', path: 'level payload', ms: 0,
      ok: !leakFields.length && !realTime && !answerish,
      note: !leakFields.length && !realTime ? '无标的/切点/真实时间轴' : '',
      error: `泄露字段[${leakFields.join(',')}] 真实时间轴=${realTime} 含答案=${answerish}`
    });
    const answer = lv.mechanic === 'predict' ? 'up' : lv.mechanic === 'signal' ? { idx: lv.cutoff - 2 } : lv.mechanic === 'pivot' ? { box: { x1: lv.cutoff - 20, y1: 1, x2: lv.cutoff - 5, y2: 2 } } : 'yes';
    const graded = await hit('闯关判分', '/api/game/answer', j => need(typeof j.score === 'number' && j.stars >= 0 && j.explain?.length && j.revealedBars?.length && j.target?.code, '判分结构不全'), { method: 'POST', body: { no: 7, token: lv.token, attemptId: lv.attemptId, answer } });
    // 同一题不能重复提交（否则"三选一"试三次必中）
    await expectFail('闯关不可重放', '/api/game/answer', 400, { method: 'POST', body: { no: 7, token: lv.token, attemptId: lv.attemptId, answer: 'down' } });
    await expectFail('闯关防伪造 token', '/api/game/answer', 400, { method: 'POST', body: { no: 7, token: 'deadbeef', attemptId: 'nope', answer } });
    if (graded) {
      results.push({
        name: '闯关判分有界', path: 'score range', ms: 0,
        ok: graded.score >= 0 && graded.score <= 100 && graded.stars >= 0 && graded.stars <= 3,
        note: `${graded.score} 分 / ${graded.stars} 星`,
        error: `分数越界 ${graded.score}`
      });
    }
  }
  await hit('108 课', '/api/chan-lessons', j => need(j.lessons?.length === 108, '课数不是 108'));
  await hit('天涯言论集', '/api/chan-lore', j => need(j.lore?.length > 10, '言论集过少'));
  await hit('形而上索引', '/api/metaphysics', j => need(Object.keys(j.systems || {}).length >= 5 || j.books, '缺系统/书目'));
  const dn = await hit('算卦可变性', '/api/divination?market=CR&code=BTCUSDT&nonce=7', j => need(j.hexagram?.ben?.id > 0, '缺卦象'));
  const dn2 = await hit('算卦可变性2', '/api/divination?market=CR&code=BTCUSDT&nonce=99', j => need(j.hexagram?.ben?.id > 0, '缺卦象'));
  if (dn && dn2 && dn.hexagram.ben.id === dn2.hexagram.ben.id && dn.liuyao?.dongYao === dn2.liuyao?.dongYao)
    results.push({ name: '算卦可变性', path: 'nonce 7 vs 99', ms: 0, ok: false, error: '不同占次得到同一卦——起卦没真正变化' });

  // 自选池写操作
  const before = await hit('自选池读取', '/api/watchlist', j => need(j.list && typeof j.list === 'object' && Array.isArray(j.list.A), '缺 list.A'));
  const n0 = before ? before.list.A.length : -1;
  await hit('自选池新增', '/api/watchlist', j => need(j.list?.A?.some((x) => x.code === '600036'), '新增未生效'), { method: 'POST', body: { market: 'A', code: '600036', name: '招商银行' } });
  await expectFail('自选池去重', '/api/watchlist', 400, { method: 'POST', body: { market: 'A', code: '600036' } });
  await hit('自选池删除', '/api/watchlist', j => need(!j.list?.A?.some((x) => x.code === '600036') && j.list.A.length <= n0, '删除未生效'), { method: 'DELETE', body: { market: 'A', code: '600036' } });

  // 静态与移动端入口
  for (const [name, path, mime] of [
    ['手机版外壳', '/m/', 'text/html'],
    ['手机版样式', '/m/css/mobile.css', 'text/css'],
    ['Framework7', '/vendor/f7/framework7-bundle.min.css', 'text/css'],
    ['桌面版外壳', '/?desktop=1', 'text/html'],
    ['PWA 清单', '/manifest.webmanifest', 'json']
  ]) {
    const t0 = Date.now();
    try {
      const res = await fetch(BASE + path);
      const buf = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (!/text\/html|text\/css|json/.test(res.headers.get('content-type') || '')) throw new Error('content-type 异常: ' + res.headers.get('content-type'));
      results.push({ name, path, ms: Date.now() - t0, ok: true, note: `${(buf.length / 1024).toFixed(0)}KB` });
    } catch (e) {
      results.push({ name, path, ms: Date.now() - t0, ok: false, error: e.message });
    }
  }

  // 输出
  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad++;
    const tag = r.ok ? '✓' : '✗';
    const extra = r.ok ? (r.note || '') : r.error;
    console.log(`${tag} ${r.name.padEnd(12, '　')} ${String(r.ms).padStart(5)}ms  ${extra}`);
  }
  console.log(`\n${results.length - bad}/${results.length} 通过`);
  process.exit(bad ? 1 : 0);
})();
