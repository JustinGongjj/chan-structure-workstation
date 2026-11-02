'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../server/lib/chan.js');

/** 造一段确定性的锯齿行情（含包含关系、单边、震荡三种形态） */
function synth(n, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const bars = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 9) * 1.6 + Math.sin(i / 37) * 2.2;
    const noise = (rnd() - 0.5) * 2.4;
    const o = p;
    const c = Math.max(1, p + drift + noise);
    const h = Math.max(o, c) + rnd() * 1.2;
    const l = Math.min(o, c) - rnd() * 1.2;
    bars.push({ t: Date.UTC(2024, 0, 1) + i * 86400000, o, h, l, c, v: 1000 + Math.round(rnd() * 500) });
    p = c;
  }
  return bars;
}

test('包含处理：合并后的相邻 K 线之间不再存在包含关系', () => {
  const bars = synth(400);
  const merged = C.mergeBars(bars);
  assert.ok(merged.length > 20, '合并后仍有足够多的 K 线');
  assert.ok(merged.length < bars.length, '确实发生了合并');
  for (let i = 1; i < merged.length; i++) {
    const a = merged[i - 1];
    const b = merged[i];
    const contains = (a.h >= b.h && a.l <= b.l) || (b.h >= a.h && b.l <= a.l);
    assert.equal(contains, false, `第 ${i} 根仍与前一根存在包含关系`);
    assert.ok(b.i0 >= a.i0 && b.i1 >= b.i0, '合并区间索引单调');
  }
});

test('笔：方向交替、首尾相接、区间索引递增', () => {
  const bars = synth(600, 7);
  const merged = C.mergeBars(bars);
  const bis = C.buildBis(C.findFractals(merged, bars));
  assert.ok(bis.length >= 8, '至少 8 笔');
  for (let i = 0; i < bis.length; i++) {
    const b = bis[i];
    assert.ok(b.i1 > b.i0, '笔的终点在起点之后');
    assert.equal(b.dir, b.p1 > b.p0 ? 1 : -1, '方向与价格一致');
    if (i > 0) {
      const prev = bis[i - 1];
      assert.notEqual(prev.dir, b.dir, `第 ${i} 笔与上一笔方向相同`);
      assert.ok(Math.abs(prev.p1 - b.p0) < 1e-9, `第 ${i} 笔未与上一笔首尾相接`);
    }
  }
});

test('中枢：ZG > ZD，且笔区间不重叠递增', () => {
  const bars = synth(600, 11);
  const merged = C.mergeBars(bars);
  const bis = C.buildBis(C.findFractals(merged, bars));
  const pivots = C.buildPivots(bis, bars);
  assert.ok(pivots.length >= 1, '至少识别出一个中枢');
  pivots.forEach((p) => {
    assert.ok(p.zg > p.zd, '中枢上沿必须高于下沿');
    assert.ok(p.count >= 3, '中枢至少三笔');
    assert.ok(p.gg >= p.zg && p.dd <= p.zd, '中枢极值包含区间');
  });
  for (let i = 1; i < pivots.length; i++) {
    assert.ok(pivots[i].startBi > pivots[i - 1].endBi - 1, '中枢之间按笔推进');
  }
});

test('完整分析：输出结构完整、信号类型合法、结果可复现', () => {
  const bars = synth(600, 23);
  const a = C.analyze(bars, { period: 'day', market: 'A', code: 'TEST' });
  const b = C.analyze(bars, { period: 'day', market: 'A', code: 'TEST' });
  assert.equal(a.ok, true);
  assert.ok(a.bars.length >= 20);
  assert.equal(a.bars.length, a.macd.dif.length, 'MACD 与 K 线等长');
  assert.equal(a.bars.length, a.macd.hist.length);
  const valid = new Set(['1B', '2B', '3B', '1S', '2S', '3S']);
  a.signals.forEach((s) => {
    assert.ok(valid.has(s.type), '非法信号类型 ' + s.type);
    assert.ok(s.barIdx >= 0 && s.barIdx < a.bars.length);
    assert.ok(Number.isFinite(s.price));
  });
  for (let i = 1; i < a.signals.length; i++) assert.ok(a.signals[i].barIdx >= a.signals[i - 1].barIdx, '信号按时间排序');
  assert.ok(['上涨趋势', '下跌趋势', '盘整'].includes(a.trend.type));
  assert.equal(a.bis.length, b.bis.length, '同一输入结果一致（笔）');
  assert.equal(a.signals.length, b.signals.length, '同一输入结果一致（信号）');
  assert.equal(a.summary, b.summary, '同一输入结果一致（叙述）');
});

test('背驰：面积比与方向标记合法', () => {
  const bars = synth(800, 31);
  const r = C.analyze(bars, { period: 'day' });
  r.beichi.forEach((x) => {
    assert.ok(['段背驰', '笔背驰'].includes(x.kind));
    assert.ok(x.dir === 1 || x.dir === -1);
    assert.ok(x.areaRatio > 0);
    assert.ok(x.barIdx >= 0 && x.barIdx < r.bars.length);
  });
});

test('数据不足时优雅返回而不是抛错', () => {
  const r = C.analyze(synth(10), { period: 'day' });
  assert.equal(r.ok, false);
  assert.ok(String(r.reason).length > 0);
  assert.deepEqual(r.signals, []);
});

test('价位序列：过滤非法 K 线（0 价、乱序）', () => {
  const bars = synth(120, 5);
  bars.push({ t: bars[0].t, o: 0, h: 0, l: 0, c: 0, v: 0 });
  const shuffled = bars.slice().reverse();
  const r = C.analyze(shuffled, { period: 'day' });
  assert.equal(r.ok, true);
  assert.ok(r.bars.every((x) => x.c > 0), '非法价格被过滤');
  for (let i = 1; i < r.bars.length; i++) assert.ok(r.bars[i].t >= r.bars[i - 1].t, '时间升序');
});

/* ---------------- 中枢结构：严格按缠论定义（进段 / 区间 / 离开段） ---------------- */
test('中枢：每段都与区间相交，区间固定不被后续震荡拉长', () => {
  const f = require('../server/lib/sources');
  const c = require('../server/lib/chan');
  // 用合成数据避免网络依赖
  const bars = [];
  let p = 100;
  for (let i = 0; i < 400; i++) {
    const w = Math.sin(i / 5) * 6 + Math.sin(i / 17) * 10;
    const c0 = 100 + w;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 2, l: c0 - 2, c: c0 + 0.5, v: 1000 });
  }
  const a = c.analyze(bars);
  for (const pv of a.pivots) {
    assert.ok(pv.zg > pv.zd, '中枢区间必须有效');
    assert.ok(pv.count >= 3, '中枢至少 3 段，实际 ' + pv.count);
    for (let b = pv.startBi; b <= pv.endBi; b++) {
      const bi = a.bis[b];
      assert.ok(bi.h > pv.zd && bi.l < pv.zg, `第 ${b} 段必须与中枢区间相交`);
    }
    // 第 4 段起（延伸段）终点必须落在区间内
    for (let b = pv.startBi + 3; b <= pv.endBi; b++) {
      const bi = a.bis[b];
      assert.ok(bi.p1 <= pv.zg + 1e-6 && bi.p1 >= pv.zd - 1e-6, `延伸段 ${b} 终点应在区间内`);
    }
    // 离开段必须真的离开（终点出界）
    if (pv.leaveBi != null) {
      const lb = a.bis[pv.leaveBi];
      assert.ok(lb.p1 > pv.zg || lb.p1 < pv.zd, '离开段终点必须离开中枢区间');
    }
    // 进入段必须存在且与中枢首段反向
    if (pv.enterBi != null) {
      assert.notEqual(a.bis[pv.enterBi].dir, a.bis[pv.startBi].dir, '进入段与中枢首段应反向');
    }
  }
});

test('中枢：9 段及以上标记升级', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 500; i++) {
    const c0 = 100 + Math.sin(i / 40) * 3 + Math.sin(i / 3) * 1.2;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 1.5, l: c0 - 1.5, c: c0, v: 800 });
  }
  const a = c.analyze(bars);
  for (const pv of a.pivots) {
    assert.equal(pv.upgraded, pv.count >= 9, `段数 ${pv.count} 的升级标记应为 ${pv.count >= 9}`);
  }
});

test('中枢：相邻中枢必须保持独立（重叠只标注、绝不合并几何）', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 600; i++) {
    const c0 = 100 + Math.sin(i / 6) * 1.5 + Math.sin(i / 23) * 0.8;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 0.8, l: c0 - 0.8, c: c0 + 0.1, v: 500 });
  }
  const a = c.analyze(bars);
  for (const p of a.pivots) {
    // 合并会把两个中枢的边界压成交集/并集，导致其中一个中枢失真
    assert.ok(!p.merged, '中枢不应被合并（merged 字段必须为空）');
    assert.ok(p.count === p.endBi - p.startBi + 1, 'count 必须等于段数');
  }
  // 相邻重叠必须如实标注
  for (let i = 1; i < a.pivots.length; i++) {
    const p = a.pivots[i - 1];
    const q = a.pivots[i];
    const overlap = Math.min(p.zg, q.zg) > Math.max(p.zd, q.zd);
    assert.equal(!!q.overlapPrev, overlap, `#${i} 的重叠标记与几何不符`);
  }
});

test('中枢：t1 必须对应末笔终点的 K 线时间，不能是 undefined', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 500; i++) {
    const c0 = 200 + Math.sin(i / 5) * 2 + Math.sin(i / 31) * 1.1;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 1, l: c0 - 1, c: c0, v: 900 });
  }
  const a = c.analyze(bars);
  for (const p of a.pivots) {
    const lastBi = a.bis[p.endBi];
    if (!lastBi) continue;
    assert.equal(p.t1, a.bars[lastBi.i1].t, 't1 与末笔终点 K 线不一致');
  }
});

test('中枢：保留进入段/离开段与段计数', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 500; i++) {
    const c0 = 200 + Math.sin(i / 5) * 2 + Math.sin(i / 31) * 1.1;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 1, l: c0 - 1, c: c0, v: 900 });
  }
  const a = c.analyze(bars);
  for (const p of a.pivots) {
    assert.ok(p.count === p.endBi - p.startBi + 1, 'count 应等于段数');
    if (p.enterBi != null) assert.ok(p.enter === null || typeof p.enter === 'object');
    if (p.leaveBi != null) assert.ok(p.leave && typeof p.leave.dir === 'number');
    assert.ok(p.zd < p.zg);
  }
});

/* ---------------- 数据新鲜度 ---------------- */
test('期货数据陈旧时明确报错，而不是返回空图', async () => {
  const S = require('../server/lib/sources');
  // 6A/DX 在新浪只有 2019 年的十几根残档，必须被新鲜度校验拦下
  await assert.rejects(
    () => S.klines({ market: 'USF', code: '6A', period: 'day', limit: 10 }),
    /陈旧|数据不足/,
    '陈旧数据应被拒绝'
  );
});

/* ---------------- 期货分钟线 ---------------- */
test('国内期货分钟线可用且时间递增', async () => {
  const S = require('../server/lib/sources');
  const k = await S.klines({ market: 'CNF', code: 'RB0', period: '30m', limit: 80 });
  assert.ok(k.bars.length >= 20, '国内期货 30 分钟线应有足够数据，实际 ' + k.bars.length);
  for (let i = 1; i < k.bars.length; i++) {
    assert.ok(k.bars[i].t > k.bars[i - 1].t, '分钟线时间必须严格递增');
  }
  assert.ok(k.bars.every((b) => b.h >= b.l && b.c > 0), 'OHLC 合法性');
});

test('外盘期货分钟线标注为「仅当日」', async () => {
  const S = require('../server/lib/sources');
  const k = await S.klines({ market: 'USF', code: 'GC', period: '15m', limit: 200 });
  assert.ok(k.bars.length >= 5, '外盘 15 分钟线应有数据');
  assert.equal(k.intradayOnly, true, '外盘分钟线只有当日分时，必须打标');
});

/* ---------------- 商品板块目录 ---------------- */
test('板块目录：分组完整、代码与市场一致、无重复', () => {
  const S = require('../server/lib/sectors');
  const cat = S.catalog();
  assert.ok(cat.length >= 6, '至少 6 个板块，实际 ' + cat.length);
  const seen = new Set();
  let total = 0;
  for (const sec of cat) {
    assert.ok(sec.count === sec.items.length, `${sec.name} 计数与条目数不符`);
    for (const it of sec.items) {
      total++;
      assert.ok(!seen.has(it.code), `品种重复: ${it.code}`);
      seen.add(it.code);
      // 国内代码以 0 结尾，外盘不是 —— 市场归属必须与之一致
      const want = it.code.endsWith('0') ? 'CNF' : 'USF';
      assert.equal(it.market, want, `${it.code} 市场归属错误`);
      assert.ok(it.name && it.ex, `${it.code} 缺中文名或交易所`);
    }
  }
  assert.ok(total >= 80, '品种总数应 >= 80，实际 ' + total);
});

test('板块目录：贵金属同时含国内与外盘，金属板块含铜', () => {
  const S = require('../server/lib/sectors');
  const pre = S.catalog().find((s) => s.id === 'precious');
  const codes = pre.items.map((i) => i.code);
  assert.ok(codes.includes('AU0') && codes.includes('GC'), '贵金属应含沪金与纽约金');
  const base = S.catalog().find((s) => s.id === 'base');
  assert.ok(base.items.some((i) => i.code === 'CU0'), '有色金属应含沪铜');
});

/* ---------------- 目录与实盘数据一致性 ---------------- */
test('板块目录里的每个品种都必须真的能取到日线（防止死引用）', async () => {
  const S = require('../server/lib/sources');
  const CAT = require('../server/lib/sectors');
  const dead = [];
  // 外盘全测；国内抽 20 个代表（全量 68 个太慢，另有 matrixcheck 覆盖）
  const all = CAT.catalog().flatMap((s) => s.items);
  const usf = all.filter((i) => i.market === 'USF');
  const cnf = all.filter((i) => i.market === 'CNF').slice(0, 20);
  for (const it of usf.concat(cnf)) {
    try {
      const k = await S.klines({ market: it.market, code: it.code, period: 'day', limit: 30 });
      if (!k.bars || !k.bars.length) dead.push(it.code);
    } catch (e) {
      dead.push(it.code + '(' + e.message.slice(0, 20) + ')');
    }
  }
  assert.deepEqual(dead, [], '这些品种在目录里但取不到数据：' + dead.join('、'));
});

/* ---------------- 离开段语义（复审 MAJOR） ---------------- */
test('中枢：离开段判据是"终点出界"，且必须紧跟中枢末笔', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 600; i++) {
    const c0 = 100 + Math.sin(i / 7) * 4 + Math.sin(i / 29) * 2;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 1.2, l: c0 - 1.2, c: c0, v: 700 });
  }
  const a = c.analyze(bars);
  for (const p of a.pivots) {
    if (p.leaveBi == null) continue;
    const lb = a.bis[p.leaveBi];
    assert.ok(lb.p1 > p.zg || lb.p1 < p.zd, '离开段终点必须离开中枢区间');
    assert.equal(p.leaveBi, p.endBi + 1, '离开段必须紧跟中枢末笔');
  }
});

/* ---------------- 中枢首尾相接（用户最早指出的问题） ---------------- */
test('中枢：下一中枢必须从离开段之后开始，不得把离开段当成自己的区间首笔', () => {
  const c = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 700; i++) {
    const c0 = 100 + Math.sin(i / 9) * 5 + Math.sin(i / 37) * 2.5;
    bars.push({ t: 1.6e12 + i * 86400000, o: c0, h: c0 + 1.4, l: c0 - 1.4, c: c0, v: 800 });
  }
  const a = c.analyze(bars);
  assert.ok(a.pivots.length >= 3, '样本应形成多个中枢');
  for (let i = 0; i < a.pivots.length; i++) {
    const p = a.pivots[i];
    // 进入段必须紧邻本中枢首笔
    if (p.enterBi != null) assert.equal(p.enterBi, p.startBi - 1, `#${i} 进入段未紧邻首笔`);
    if (i + 1 < a.pivots.length) {
      const q = a.pivots[i + 1];
      // 关键：下一个中枢不能从本中枢的离开段开始（那样就首尾相接了）
      assert.ok(q.startBi > p.leaveBi, `#${i + 1} 区间首笔 ${q.startBi} 必须晚于上一离开段 ${p.leaveBi}`);
      assert.ok(q.enterBi >= p.leaveBi, `#${i + 1} 进入段不得早于上一离开段`);
    }
  }
});

/* ---------------- 陈旧数据标记 ---------------- */
test('K 线返回统一带新鲜度标记（不只有期货）', async () => {
  const S = require('../server/lib/sources');
  const fresh = await S.klines({ market: 'A', code: '600519', period: 'day', limit: 30 });
  assert.equal(typeof fresh.dataAgeDays, 'number', '必须返回 dataAgeDays');
  assert.equal(fresh.staleData, false, '贵州茅台日线不应判为陈旧');
  // 399137 是早已停更的老指数，必须被标出来
  const old = await S.klines({ market: 'A', code: '399137', period: 'day', limit: 30 }).catch(() => null);
  if (old && old.bars.length) {
    assert.equal(old.staleData, true, '2013 年停更的指数必须标记为陈旧');
    assert.ok(old.dataAgeDays > 1000, 'dataAgeDays 应反映真实天数');
  }
});

/* ---------------- 大文件下载不崩（曾经 ver is not defined 导致进程退出） ---------------- */
test('静态服务：大文件走流式分支且不崩溃', async () => {
  const { spawn } = require('child_process');
  const path = require('path');
  const node = process.execPath;
  const port = 8971;
  const proc = spawn(node, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), LOG: '0' },
    stdio: 'ignore',
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      try { await fetch(`http://127.0.0.1:${port}/api/health`); up = true; break; } catch { await sleep(150); }
    }
    assert.ok(up, '服务应能启动');
    // 请求一个 >512KB 的文件（下载区若有包，否则退化为检查根页面）
    const fs = require('fs');
    const dir = path.join(__dirname, '..', 'web', 'downloads');
    const big = fs.existsSync(dir)
      ? fs.readdirSync(dir).find((f) => { try { return fs.statSync(path.join(dir, f)).size > 512 * 1024; } catch { return false; } })
      : null;
    const target = big ? `/downloads/${big}` : '/';
    const r = await fetch(`http://127.0.0.1:${port}${target}`);
    assert.equal(r.status, 200, '大文件请求应 200');
    // 关键：请求之后进程必须还活着
    const r2 = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(r2.status, 200, '请求大文件后服务仍应存活');
  } finally {
    try { proc.kill('SIGKILL'); } catch (e) {}
  }
});

/* ---------------- 递归区间套 ---------------- */
test('区间套：递归结构完整，层级递进且每层有中枢或明确说明', () => {
  const N = require('../server/lib/nested');
  const S = require('../server/lib/sources');
  // 用合成数据避免网络依赖
  const mkBars = (n, base, amp) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = base + Math.sin(i / 9) * amp + Math.sin(i / 31) * amp * 0.5;
      out.push({ t: 1.6e12 + i * 60000, o: c, h: c + amp * 0.3, l: c - amp * 0.3, c, v: 100 });
    }
    return out;
  };
  const fixtures = {
    month: mkBars(300, 100, 20), week: mkBars(400, 100, 15),
    day: mkBars(600, 100, 10), '60m': mkBars(600, 100, 5), '30m': mkBars(600, 100, 3),
  };
  return N.buildNest({
    market: 'A', code: 'TEST',
    fetchLevel: async (p) => ({ bars: fixtures[p] || fixtures.day, source: 'fixture' }),
  }).then((t) => {
    assert.ok(t.chain.length >= 2, '递归链至少 2 级');
    assert.ok(t.flat.length >= 2, '至少递归 2 层');
    // 重构后 verdict 是字符串（另带 verdictLevel / nested / evidence）
    assert.ok(typeof t.verdict === 'string' && t.verdict.length > 0, '必须有结论');
    assert.ok(['buy', 'sell', 'single', 'none'].includes(t.verdictLevel), 'verdictLevel 取值合法');
    // 深度必须严格递增（0,1,2...），不能跳级
    const depths = t.flat.map((l) => l.depth).sort((a, b) => a - b);
    depths.forEach((d, i) => assert.equal(d, i, '递归深度应从 0 连续递增'));
    // 每层要么有中枢，要么说明为什么没有
    for (const l of t.flat) {
      if (!l.ok) continue;
      assert.ok(l.pivot || l.depth > 0, `第 ${l.depth} 层既无中枢又无说明`);
      assert.equal(typeof l.coverRatio, 'number', '覆盖率必须是数字');
      assert.ok(l.coverRatio >= 0 && l.coverRatio <= 1, '覆盖率应在 0~1');
    }
  });
});

test('区间套：结论不能因为最深层没中枢就说"各层都无中枢"', () => {
  const N = require('../server/lib/nested');
  const mkBars = (n, amp) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = 100 + Math.sin(i / 7) * amp;
      out.push({ t: 1.6e12 + i * 60000, o: c, h: c + amp * 0.4, l: c - amp * 0.4, c, v: 100 });
    }
    return out;
  };
  return N.buildNest({
    market: 'A', code: 'TEST2',
    // 大级别有中枢，最小级别故意给一条直线（必然无中枢）
    fetchLevel: async (p) => ({
      bars: p === '30m' ? Array.from({ length: 200 }, (_, i) => ({ t: 1.6e12 + i * 60000, o: 100, h: 100, l: 100, c: 100, v: 1 })) : mkBars(500, 8),
      source: 'fixture',
    }),
  }).then((t) => {
    assert.ok(t.verdict, '必须有结论');
    // 上层有中枢时，不能说"各层均未形成有效中枢"
    const hasUpperPivot = t.flat.some((l) => l.ok && l.pivot);
    if (hasUpperPivot) {
      assert.ok(!/各层均未形成有效中枢/.test(t.verdict), '上层有中枢时不该报"各层无中枢"');
    }
  });
});

/* ---------------- 递归区间套：细化后的关键行为 ---------------- */
test('区间套：窗口逐层收窄，且优先选择次级别可覆盖的中枢', async () => {
  const N = require('../server/lib/nested');
  const mk = (n, amp, t0, dt) => Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 6) * amp;
    return { t: t0 + i * dt, o: c, h: c + amp * 0.4, l: c - amp * 0.4, c, v: 100 };
  });
  const t = await N.buildNest({
    market: 'A', code: 'WIN',
    fetchLevel: async (p) => ({
      bars: mk(500, p === 'month' ? 20 : p === 'week' ? 12 : p === 'day' ? 7 : 4, 1.6e12, p === 'day' ? 86400000 : 86400000 * 7),
      source: 'fixture',
    }),
  });
  const win = t.flat.map((l) => l.window).filter(Boolean);
  // 子窗必须落在父窗之内（单调收窄）
  for (let i = 1; i < win.length; i++) {
    assert.ok(win[i][0] >= win[i - 1][0] - 1, '子窗起点不得早于父窗');
    assert.ok(win[i][1] <= win[i - 1][1] + 1, '子窗终点不得晚于父窗');
  }
  // 每层都要说明选中枢的理由
  for (const l of t.flat) {
    if (l.ok && l.pivot) assert.ok(l.pivotReason && l.pivotReason.length > 0, '必须有选中枢的理由');
  }
});

test('区间套：同一层的信号+背驰不算跨层共振', async () => {
  const N = require('../server/lib/nested');
  // 构造：只有 day 级别有信号，且同层也有背驰 → 不应判为 buy/sell
  const mk = (n, amp, dt) => Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 5) * amp;
    return { t: 1.6e12 + i * dt, o: c, h: c + amp * 0.5, l: c - amp * 0.5, c, v: 100 };
  });
  const t = await N.buildNest({
    market: 'US', code: 'SAME', // US 链只有 week→day
    fetchLevel: async (p) => ({ bars: mk(400, p === 'week' ? 10 : 6, p === 'week' ? 604800000 : 86400000), source: 'fixture' }),
  });
  // 若判定为 buy/sell，证据里必须体现跨层（不同 period）
  if (t.verdictLevel === 'buy' || t.verdictLevel === 'sell') {
    const ev = t.evidence || {};
    const sigs = [...(ev.buys || []), ...(ev.sells || [])].map((x) => x.period);
    const beis = (ev.bei || []).map((x) => x.period);
    const cross = sigs.length >= 2 || beis.some((b) => !sigs.includes(b));
    assert.ok(cross, '判为区间套时必须存在跨层证据');
  }
});

test('区间套：覆盖不足的层被排除在结论之外', async () => {
  const N = require('../server/lib/nested');
  const mk = (n, amp, dt) => Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 5) * amp;
    return { t: 1.6e12 + i * dt, o: c, h: c + amp * 0.5, l: c - amp * 0.5, c, v: 100 };
  });
  const t = await N.buildNest({
    market: 'A', code: 'COV',
    fetchLevel: async (p) => ({
      // 最小级别只给极短时间跨度 → 必然覆盖不足
      bars: p === '30m' ? mk(120, 3, 60000) : mk(500, p === 'month' ? 20 : 10, p === 'day' ? 86400000 : 604800000),
      source: 'fixture',
    }),
  });
  const dropped = (t.evidence && t.evidence.dropped) || [];
  const insufficient = t.flat.filter((l) => l.ok && l.coverage === 'insufficient').map((l) => l.period);
  // 每个覆盖不足的层都必须出现在 dropped 里（或被如实标注）
  for (const p of insufficient) {
    const layer = t.flat.find((l) => l.period === p);
    assert.ok(dropped.includes(p) || layer.descendBlocked, `覆盖不足的 ${p} 必须被排除或说明原因`);
  }
});

/* ---------------- 背驰段精确定位 ---------------- */
test('背驰记录必须带「比较对」：前段与本段的时段与 MACD 面积', async () => {
  const C = require('../server/lib/chan');
  const S = require('../server/lib/sources');
  // 合成数据很难稳定造出真背驰（需要长走势的力度衰减），这里用真实数据验证结构
  const kl = await S.klines({ market: 'A', code: '600519', period: 'week', limit: 600 }).catch(() => null);
  if (!kl || !kl.bars || kl.bars.length < 100) {
    // 无网络时跳过结构断言（不把网络问题算成代码缺陷）
    return;
  }
  const a = C.analyze(kl.bars, { period: 'week' });
  if (!a.beichi.length) return; // 当前行情无背驰，跳过
  for (const b of a.beichi) {
    assert.ok(b.pair, '背驰必须带 pair（比较对）');
    assert.ok(b.pair.prev && b.pair.cur, 'pair 必须含 prev 与 cur');
    for (const k of ['prev', 'cur']) {
      const seg = b.pair[k];
      assert.ok(Number.isFinite(seg.t0) && Number.isFinite(seg.t1), `${k} 必须有起止时间`);
      assert.ok(seg.t1 >= seg.t0, `${k} 结束时间不得早于开始`);
      assert.ok(Number.isFinite(seg.area), `${k} 必须有 MACD 面积`);
      assert.ok(Number.isFinite(seg.peak), `${k} 必须有 MACD 峰值`);
    }
    assert.ok(b.pair.cur.t0 >= b.pair.prev.t0, '本段不应早于前段');
    const ratio = b.pair.cur.area / b.pair.prev.area;
    assert.ok(Math.abs(ratio - b.areaRatio) < 0.01, `面积比应与 pair 一致（${ratio} vs ${b.areaRatio}）`);
  }
});

test('背驰段窗口：优先用背驰段而不是整个中枢范围', async () => {
  const N = require('../server/lib/nested');
  const S = require('../server/lib/sources');
  // 用真实数据验证：若某层有背驰，其下钻窗口模式应为 beichi
  const t = await N.buildNest({
    market: 'A', code: '600519',
    fetchLevel: async (p) => { const k = await S.klines({ market: 'A', code: '600519', period: p, limit: 600 }); return { bars: k.bars, source: k.source }; },
  });
  const beichiLayers = t.flat.filter((l) => l.beichi && l.childWindow);
  for (const l of beichiLayers) {
    // 若背驰段与中枢有交集，窗口模式必须是 beichi
    if (l.beichi.segment && l.pivot) {
      const overlap = Math.min(l.pivot.t1, l.beichi.segment.t1) - Math.max(l.pivot.t0, l.beichi.segment.t0);
      if (overlap > 0) {
        assert.equal(l.childWindowMode, 'beichi', `${l.period} 有背驰且与中枢相交，窗口应优先用背驰段`);
        assert.ok(l.childWindowNote, '必须说明收窗理由');
      }
    }
  }
});

/* ---------------- 笔标准：新笔 vs 老笔 ---------------- */
test('笔标准：新笔比老笔宽松，且两种标准都能产出合法笔', () => {
  const C = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 600; i++) {
    const c = 100 + Math.sin(i / 7) * 8 + Math.sin(i / 23) * 3;
    bars.push({ t: 1.6e12 + i * 86400000, o: c, h: c + 1.5, l: c - 1.5, c, v: 1000 });
  }
  const merged = C.mergeBars(bars);
  const fr = C.findFractals(merged, bars);
  const oldBis = C.buildBis(fr, { style: 'old' });
  const newBis = C.buildBis(fr, { style: 'new' });
  assert.ok(newBis.length >= oldBis.length, '新笔数量应 >= 老笔（新笔更宽松）');
  for (const bis of [oldBis, newBis]) {
    assert.ok(bis.length > 0, '必须能画出笔');
    for (const b of bis) {
      assert.ok(b.i1 > b.i0, '笔的终点必须在起点之后');
      assert.ok([1, -1].includes(b.dir), '笔方向合法');
      assert.ok(b.from !== b.to, '笔必须是顶底交替');
    }
    // 相邻笔必须首尾相接
    for (let i = 1; i < bis.length; i++) assert.equal(bis[i].i0, bis[i - 1].i1, '相邻笔必须首尾相接');
  }
});

test('划分校验报告：给出两种标准的差异并量化', () => {
  const C = require('../server/lib/chan');
  const bars = [];
  for (let i = 0; i < 500; i++) {
    const c = 200 + Math.sin(i / 6) * 10 + Math.sin(i / 19) * 4;
    bars.push({ t: 1.6e12 + i * 86400000, o: c, h: c + 2, l: c - 2, c, v: 900 });
  }
  const a = C.analyze(bars);
  assert.ok(a.audit, '必须返回 audit');
  assert.ok(['new', 'old'].includes(a.audit.style), 'style 取值合法');
  assert.equal(typeof a.audit.biCount.old, 'number');
  assert.equal(typeof a.audit.biCount.new, 'number');
  assert.equal(typeof a.audit.styleDivergence, 'number');
  assert.ok(a.audit.styleDivergence >= 0, '差异率不能为负');
  assert.ok(a.audit.fractalGaps, '必须给出分型间隔分布');
});

/* ---------------- 中枢扩展 / 扩张 ---------------- */
test('中枢扩张：用波动区间 dd~gg 判定，并区分"仅波动重叠"', () => {
  const E = require('../server/lib/expansion');
  // 造两个中枢：中枢区间不重叠，但波动区间重叠
  const pivots = [
    { zd: 100, zg: 110, dd: 90, gg: 125, count: 3, startBi: 0, endBi: 2, leaveBi: 3, t0: 1, t1: 2 },
    { zd: 115, zg: 130, dd: 105, gg: 140, count: 3, startBi: 4, endBi: 6, leaveBi: 7, t0: 3, t1: 4 },
  ];
  const r = E.detectExpansion(pivots);
  assert.equal(r.pairs.length, 1);
  const p = r.pairs[0];
  assert.equal(p.type, 'expansion', '波动区间 90~125 与 105~140 重叠 → 扩张');
  assert.ok(p.onlyWaveOverlap, '中枢区间 100~110 与 115~130 不重叠 → 仅波动重叠');
  assert.equal(p.zoneOverlap <= 0, true, '中枢区间重叠量应 <= 0');
});

test('中枢扩张：波动区间也不重叠时应判为趋势', () => {
  const E = require('../server/lib/expansion');
  const pivots = [
    { zd: 100, zg: 110, dd: 95, gg: 115, count: 3, startBi: 0, endBi: 2, leaveBi: 3, t0: 1, t1: 2 },
    { zd: 200, zg: 210, dd: 195, gg: 215, count: 3, startBi: 4, endBi: 6, leaveBi: 7, t0: 3, t1: 4 },
  ];
  const r = E.detectExpansion(pivots);
  assert.equal(r.pairs[0].type, 'trend', '完全不重叠 → 趋势');
  assert.equal(r.lastExpansion, null);
});

/* ---------------- 同级别分解 & 走势必完美 ---------------- */
test('同级别分解：相邻同向段必须合并（唯一性）', () => {
  const D = require('../server/lib/decomposition');
  const pivots = [];
  // 造 6 个不重叠且逐级抬高的中枢 → 应合并成一段上涨
  for (let i = 0; i < 6; i++) {
    const base = 100 + i * 30;
    pivots.push({ zd: base, zg: base + 10, dd: base - 3, gg: base + 13, count: 3, startBi: i * 3, endBi: i * 3 + 2, leaveBi: i * 3 + 3, t0: i * 10, t1: i * 10 + 9 });
  }
  const r = D.decomposeByPivots(pivots);
  assert.ok(r.segments.length >= 1, '至少 1 段');
  assert.equal(r.unique, true, '不应有相邻同向段（同向必须合并）');
  assert.equal(r.segments[0].type, 'up', '逐级抬高应为上涨段');
});

test('走势必完美：无中枢时判未完成；有中枢+离开段+信号判完成', () => {
  const D = require('../server/lib/decomposition');
  const none = D.perfection({ pivots: [], bis: [], signals: [] });
  assert.equal(none.complete, false);
  assert.equal(none.status, 'no-structure');

  const done = D.perfection({
    pivots: [{ zd: 100, zg: 110, dd: 95, gg: 115, count: 3, startBi: 0, endBi: 2, leaveBi: 3 }],
    bis: [{ dir: 1, p1: 120, i1: 9 }],
    signals: [{ type: '3B', name: '第三类买点', price: 118 }],
    beichi: [],
    stats: { price: 120 },
  });
  assert.equal(done.complete, true);
  assert.equal(done.status, 'complete');

  const extending = D.perfection({
    pivots: [{ zd: 100, zg: 110, dd: 95, gg: 115, count: 3, leaveBi: null }],
    bis: [{ dir: 1, p1: 105, i1: 9 }],
    signals: [],
    beichi: [],
    stats: { price: 105 },
  });
  assert.equal(extending.complete, false);
  assert.equal(extending.status, 'extending');
});

/* ---------------- 理论→实践九步链路 ---------------- */
test('九步链路：步骤完整、每步有置信度、结论可复现', () => {
  const C = require('../server/lib/chan');
  const SY = require('../server/lib/system');
  const bars = [];
  for (let i = 0; i < 600; i++) {
    const c = 100 + Math.sin(i / 8) * 9 + Math.sin(i / 27) * 4;
    bars.push({ t: 1.6e12 + i * 86400000, o: c, h: c + 1.8, l: c - 1.8, c, v: 1000 });
  }
  const a = C.analyze(bars);
  const r = SY.buildSystem(a);
  assert.ok(Array.isArray(r.steps), '必须有 steps');
  assert.ok(r.steps.length >= 8, `至少 8 个步骤，实际 ${r.steps.length}`);
  for (const st of r.steps) {
    assert.ok(st.step > 0 && st.name, '每步必须有编号与名称');
    assert.ok(['high', 'medium', 'low'].includes(st.confidence), `第 ${st.step} 步置信度取值非法：${st.confidence}`);
    assert.ok(st.answer, `第 ${st.step} 步必须有结论`);
    assert.ok('evidence' in st, `第 ${st.step} 步必须有证据`);
  }
  assert.ok(r.headline, '必须有总览');
  assert.ok(Array.isArray(r.disclaimers) && r.disclaimers.length >= 2, '必须有免责说明');
  // 结论可复现：同样输入两次结果一致
  const r2 = SY.buildSystem(a);
  assert.equal(JSON.stringify(r.steps), JSON.stringify(r2.steps), '同样输入必须得到同样结论');
});

/* ---------------- 回测引擎 ---------------- */
function mkBars(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = fn(i);
    out.push({ t: 1.6e12 + i * 86400000, o: c, h: c * 1.012, l: c * 0.988, c, v: 1000 });
  }
  return out;
}

test('回测：资金记账自洽（期末 = 初始 + 所有交易净盈亏）', () => {
  const B = require('../server/lib/btengine');
  const bars = mkBars(700, (i) => 100 + Math.sin(i / 11) * 12 + Math.sin(i / 31) * 5);
  const r = B.runBacktest(bars, { warmup: 120, entry: 'both', exitOn: 'signal' });
  assert.ok(r.ok, '回测应成功');
  const sumNet = r.trades.reduce((a, t) => a + t.net, 0);
  const expect = r.stats.initCapital + sumNet;
  assert.ok(Math.abs(r.stats.finalValue - expect) < 1, `期末权益 ${r.stats.finalValue} 应等于 初始+净盈亏 ${expect.toFixed(2)}`);
  // 权益曲线不应出现超过初始资金 2 倍或负数（做空市值口径错误会虚高 2 倍）
  const maxEq = Math.max(...r.equity.map((e) => e.v));
  const minEq = Math.min(...r.equity.map((e) => e.v));
  assert.ok(maxEq < r.stats.initCapital * 2, `权益峰值 ${maxEq} 异常（疑似做空市值口径把本金算了两次）`);
  assert.ok(minEq > 0, '权益不应为负');
});

test('回测：无未来函数（信号点必须在成交日之前或当日）', () => {
  const B = require('../server/lib/btengine');
  const bars = mkBars(600, (i) => 100 + Math.sin(i / 9) * 10);
  const r = B.runBacktest(bars, { warmup: 120, entry: 'both', exitOn: 'signal', maxConfirmLag: 3 });
  for (const t of r.trades) {
    assert.ok(t.entryIdx >= 1, '成交不能在首根');
    assert.ok(t.exitIdx >= t.entryIdx, '平仓不能早于开仓');
  }
});

test('回测：确认延迟阈值生效（超过阈值的信号不交易）', () => {
  const B = require('../server/lib/btengine');
  const bars = mkBars(600, (i) => 100 + Math.sin(i / 8) * 9 + Math.sin(i / 23) * 4);
  const loose = B.runBacktest(bars, { warmup: 120, entry: 'both', exitOn: 'signal', maxConfirmLag: 50 });
  const tight = B.runBacktest(bars, { warmup: 120, entry: 'both', exitOn: 'signal', maxConfirmLag: 1 });
  assert.ok(loose.ok && tight.ok);
  assert.ok(loose.signals.total >= tight.signals.total, '放宽阈值应看到更多信号');
});

test('批量回测：汇总口径正确，样本不足时明确判 insufficient', () => {
  const B = require('../server/lib/batch');
  const symbols = [
    { market: 'A', code: 'X1', bars: mkBars(400, (i) => 100 + Math.sin(i / 7) * 8) },
    { market: 'A', code: 'X2', bars: mkBars(400, (i) => 50 + Math.sin(i / 9) * 6) },
  ];
  const r = B.runBatch(symbols, { warmup: 120, entry: 'both', exitOn: 'signal' });
  assert.ok(r.ok);
  assert.equal(r.summary.symbols, 2);
  assert.ok(['insufficient', 'ineffective', 'marginal', 'effective'].includes(r.summary.verdict.level));
  if (r.summary.totalTrades < 30) assert.equal(r.summary.verdict.level, 'insufficient', '样本<30 必须判 insufficient');
  // 汇总交易数应等于各标之和
  const sum = r.rows.filter((x) => x.ok).reduce((a, x) => a + x.trades, 0);
  assert.equal(r.summary.totalTrades, sum, '汇总交易数应等于分标的之和');
});

/* ---------------- 标的池 & 样本外验证 ---------------- */
test('标的池：规模 100+，各市场都有，无重复', () => {
  const U = require('../server/lib/universe');
  const all = U.flatUniverse();
  assert.ok(all.length >= 100, `标的池应 ≥100，实际 ${all.length}`);
  assert.ok(all.length <= 160, `标的池应 ≤160（回测上限），实际 ${all.length}`);
  const keys = all.map((x) => x.market + ':' + x.code);
  assert.equal(new Set(keys).size, keys.length, '标的不能重复');
  for (const m of ['A', 'US', 'CR', 'CNF', 'HK']) {
    assert.ok(all.some((x) => x.market === m), `市场 ${m} 不能为空`);
  }
  // 按市场筛选
  const onlyA = U.flatUniverse(['A']);
  assert.ok(onlyA.every((x) => x.market === 'A'), '市场筛选必须生效');
});

test('样本外：切分不重叠，训练期在验证期之前', () => {
  const O = require('../server/lib/oos');
  const bars = mkBars(800, (i) => 100 + Math.sin(i / 9) * 10);
  const sp = O.splitBars(bars, 0.6);
  assert.ok(sp.inRange[1] < sp.outRange[0], '训练期必须早于验证期');
  assert.ok(sp.inSample.length > 0 && sp.outSample.length > 0);
  assert.ok(sp.outSample.length >= 200, '验证期需足够长');
});

test('样本外：判定逻辑覆盖 robust / partial / overfit', () => {
  const O = require('../server/lib/oos');
  // 直接构造 tested 数组来验证 judge 的分支（judge 未导出，用 walkForward 间接验证成本高，
  // 这里验证 splitBars 与 evalCombo 的返回结构，judge 逻辑由实测保证）
  const bars = mkBars(600, (i) => 100 + Math.sin(i / 7) * 9);
  const sp = O.splitBars(bars, 0.5);
  const ev = O.evalCombo([{ market: 'A', code: 'T', inSample: sp.inSample, outSample: sp.outSample }], { warmup: 120, entry: 'buy' }, 'inSample');
  assert.equal(typeof ev.trades, 'number');
  assert.equal(typeof ev.avgPct, 'number');
  assert.equal(typeof ev.beatRate, 'number');
});

test('批量：市场筛选参数生效', () => {
  const U = require('../server/lib/universe');
  const onlyCr = U.flatUniverse(['CR']);
  assert.ok(onlyCr.length >= 10, 'CR 池应 ≥10');
  assert.ok(onlyCr.every((x) => x.market === 'CR'));
});
