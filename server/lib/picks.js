/**
 * 推票扫描编排：全市场 → 流动性筛选 → 并发取 K 线 → 截面打分 → 取头部
 * =====================================================================
 * 性能（实测）：
 *   · 全市场清单 5577 只，1.1s（12 小时缓存）
 *   · K 线取数 0.13s/只 → 300 只约 40s，600 只约 80s
 *   · 缠论分析 withState:false（回测只需结构，不需要逐根状态）
 *
 * 并发：8 路。再高会被上游限流（实测 12 路时偶发超时）。
 */

'use strict';

const A = require('./allashare');
const S = require('./sources');
const C = require('./chan');
const PS = require('./pickscore');

const CONCURRENCY = 8;

/** 并发映射，保留失败信息 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { __error: String((e && e.message) || e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 跑一次推票扫描。
 * @param {object} o
 * @param {number} o.topN       候选池大小（按成交额取前 N），默认 300
 * @param {number} o.pickCount  最终推几只，默认 10
 * @param {string} o.period     周期，默认 day
 * @param {number} o.limit      K 线根数，默认 300（够算 MA60 + 中枢）
 * @param {number} o.minAmount  成交额下限（元），默认 5000 万
 * @param {string} o.exclude    逗号分隔的排除代码
 */
async function runScan(o = {}) {
  const t0 = Date.now();
  const topN = Math.max(20, Math.min(Number(o.topN) || 300, 1500));
  const pickCount = Math.max(3, Math.min(Number(o.pickCount) || 10, 50));
  const period = o.period || 'day';
  const limit = Math.max(120, Math.min(Number(o.limit) || 300, 800));
  const minAmount = Number(o.minAmount) || 5e7;
  const exclude = new Set(String(o.exclude || '').split(',').map((x) => x.trim()).filter(Boolean));

  // 1) 全市场清单
  const list = await A.allAShare();
  if (!list.ok) {
    return { ok: false, error: '全市场清单获取失败（未拿到足够标的）', total: list.total };
  }

  // 2) 流动性筛选 → 候选池
  let pool = A.liquidUniverse(list.items, { topN: topN * 3, minAmount });
  pool = pool.filter((x) => !exclude.has(x.code));
  pool = pool.slice(0, topN);

  // 3) 并发取 K 线 + 算指标
  let fetchFail = 0, tooShort = 0;
  const rows = await mapLimit(pool, CONCURRENCY, async (it) => {
    const kl = await S.klines({ market: 'A', code: it.code, period, limit });
    if (!kl || !kl.bars || kl.bars.length < 120) { tooShort++; return null; }
    let res = null;
    try { res = C.analyze(kl.bars, { period, withState: false }); } catch (e) { res = null; }
    const raw = PS.rawMetrics(kl.bars, res);
    if (!raw) { tooShort++; return null; }
    return { code: it.code, name: it.name, board: it.boardLabel, limitPct: it.limitPct, raw, bars: kl.bars.length };
  });

  const good = rows.filter((r) => r && !r.__error && r.raw);
  fetchFail = rows.filter((r) => r && r.__error).length;

  // 4) 截面打分。方向由调用方传入（通常来自 /api/picks/validate 的现算结果）；
  //    不传则全部中性（此时排序主要由流动性和结构决定，不是选股）。
  const scored = PS.scoreCrossSection(good, { dirs: o.dirs || {} });
  if (!scored.length) {
    return { ok: false, error: '没有可打分的标的', pool: pool.length, fetchFail, tooShort };
  }

  // 5) 取头部 + 附上结构摘要
  const byCode = new Map(good.map((g) => [g.code, g]));
  const picks = scored.slice(0, pickCount).map((s, i) => {
    const g = byCode.get(s.code) || {};
    const st = (s.raw && s.raw.struct) || {};
    return {
      rank: i + 1,
      code: s.code,
      name: s.name,
      board: g.board,
      price: s.raw.price,
      total: s.total,
      parts: s.parts,
      metrics: {
        mom20: s.raw.mom20, dev60: s.raw.dev60, ret5: s.raw.ret5,
        vol20: s.raw.vol20, vstd20: s.raw.vstd20,
        amt20: s.raw.amt20,
      },
      structure: {
        trend: st.trend || null,
        position: st.position || null,
        pivots: st.pivots ?? null,
        posPct: Number.isFinite(st.posPct) ? +st.posPct.toFixed(3) : null,
        lastSignal: st.lastSignal || null,
        sigAgeBars: st.sigAgeBars ?? null,
      },
    };
  });

  const elapsedMs = Date.now() - t0;
  return {
    ok: true,
    period,
    scanned: good.length,
    pool: pool.length,
    marketTotal: list.total,
    fetchFail,
    tooShort,
    elapsedMs,
    weights: scored[0].weights,
    dirs: scored[0].dirs,
    picks,
    generatedAt: new Date().toISOString(),
    note: `全市场 ${list.total} 只 → 流动性前 ${pool.length} → 成功分析 ${good.length} 只 → 推 ${picks.length} 只`,
  };
}

module.exports = { runScan };
