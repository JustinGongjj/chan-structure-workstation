/**
 * 推票台账：记录 → 到期结算 → 累计战绩
 * =====================================================================
 * 为什么要有台账
 * -------------
 * 推票最大的问题是"推完就忘"——涨了归功于方法，跌了说"市场不好"。
 * 台账把每一条推票钉死在纸上：推票日、买入区间、止损、目标、结算日，
 * 到期用**真实行情**判胜负，不给自己留解释空间。
 *
 * 判定标准（事先写死，防止事后找理由）
 * ------------------------------------
 *   stopped    最低价 ≤ 止损        → 失败
 *   hit_target 最高价 ≥ 目标        → 成功
 *   expired    持有满 N 日未触发    → 按收盘价算，>0 为胜
 *   not_filled 价格从未进入买入区间  → 不计入胜率（没买到）
 *
 * 纪律
 * ----
 *   · 结算只用真实 K 线，不用回测
 *   · 同一天同一标的只记一条（去重键 = 推票日 + 代码）
 *   · **样本 < 30 条时不报胜率结论**——这是星图文档里定下的规矩，
 *     我们照做：小样本的胜率没有意义
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'picks-ledger.json');
const MAX_ENTRIES = 2000;       // 防无限增长
const MIN_SAMPLE = 30;          // 低于此数不报胜率结论

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* 已存在 */ }
}

function load() {
  ensureDir();
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.entries)) return d;
  } catch (e) { /* 首次运行或文件损坏 */ }
  return { version: 1, entries: [], updatedAt: null };
}

function save(d) {
  ensureDir();
  const tmp = FILE + '.tmp';
  d.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(d, null, 1), 'utf8');
  fs.renameSync(tmp, FILE);
}

/** 结算日：推票日之后的 N 个交易日（自然日近似，按交易日历由调用方给） */
function addDays(iso, days) {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * 记录一批推票。
 * @param {Array} picks 来自 PICKS.runScan 的 picks
 * @param {object} meta { date, holdDays, source }
 * @returns {{added:number, skipped:number, duplicates:number}}
 */
function record(picks, meta = {}) {
  const d = load();
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const holdDays = Math.max(3, Math.min(Number(meta.holdDays) || 10, 60));
  const key = (x) => `${x.pickDate}|${x.code}`;
  const existing = new Set(d.entries.map(key));
  let added = 0, dups = 0, skipped = 0;

  for (const p of picks || []) {
    if (!p || !p.code || !Number.isFinite(p.price) || p.price <= 0) { skipped++; continue; }
    const e = {
      id: `${date}-${p.code}`,
      pickDate: date,
      code: p.code,
      name: p.name || '',
      rank: p.rank || null,
      score: p.total ?? null,
      parts: p.parts || null,
      price: p.price,
      /* 买入区间：以推票日收盘价为基准 ±3%（次日开盘可能跳空）
         止损 −8%，目标 +12%（与实测的「不止损/宽止损更优」一致，
         这里给一个较宽的止损只为台账可比，不作为交易建议） */
      buyLow: +(p.price * 0.97).toFixed(2),
      buyHigh: +(p.price * 1.03).toFixed(2),
      stop: +(p.price * 0.92).toFixed(2),
      target: +(p.price * 1.12).toFixed(2),
      holdDays,
      settleAfter: addDays(date, Math.ceil(holdDays * 1.45) + 3),
      structure: p.structure || null,
      status: 'open',
      result: null,
      settledAt: null,
      source: meta.source || 'manual',
    };
    if (existing.has(key(e))) { dups++; continue; }
    d.entries.push(e);
    existing.add(key(e));
    added++;
  }

  // 修剪最旧的
  if (d.entries.length > MAX_ENTRIES) d.entries = d.entries.slice(-MAX_ENTRIES);
  save(d);
  return { added, skipped, duplicates: dups, total: d.entries.length };
}

/**
 * 结算一条：用真实日线判断。
 * @param {object} e 台账条目
 * @param {Array} bars 推票日之后的日线（含推票日）
 */
function settleOne(e, bars) {
  if (!bars || !bars.length) return null;
  const after = bars.filter((b) => {
    const day = new Date(b.t).toISOString().slice(0, 10);
    return day > e.pickDate;
  });
  if (!after.length) return null;

  /* 成交口径：T 日推票 → **T+1 开盘价成交**（与回测引擎一致）。
     第一版用「此后任意一天进入区间」判定，等于允许无限期等回调，
     高估成交率；且用到收盘价而实际是开盘买。 */
  const first = after[0];
  const fillPx = first.o;
  if (!Number.isFinite(fillPx) || fillPx <= 0) {
    return { status: 'settled', result: 'not_filled', settlePx: null, note: '次日无有效开盘价' };
  }
  // 次日开盘价必须落在买入区间内（区间给的是 ±3%，容忍正常跳空）
  if (fillPx < e.buyLow || fillPx > e.buyHigh) {
    return {
      status: 'settled', result: 'not_filled', settlePx: null,
      note: `次日开盘 ${fillPx} 不在买入区间 [${e.buyLow}, ${e.buyHigh}]`,
    };
  }

  // 从成交日开始算持有窗口
  const window = after.slice(0, e.holdDays);
  for (const b of window) {
    if (b.l <= e.stop) {
      return { status: 'settled', result: 'stopped', fillPx, settlePx: e.stop, note: `触及止损 ${e.stop}` };
    }
    if (b.h >= e.target) {
      return { status: 'settled', result: 'hit_target', fillPx, settlePx: e.target, note: `触及目标 ${e.target}` };
    }
  }
  // 未触发止损/止盈时，必须等完整持有窗口；缺少后续行情则保持未结算。
  if (window.length < e.holdDays) return null;
  const last = window[window.length - 1];
  const ret = (last.c / fillPx - 1) * 100;
  return {
    status: 'settled',
    result: ret > 0 ? 'expired_win' : 'expired_loss',
    fillPx,
    settlePx: last.c,
    retPct: +ret.toFixed(2),
    note: `次日开盘 ${fillPx} 成交，持有 ${window.length} 日到期`,
  };
}

/** 未结算条目跑一遍结算（需要外部提供 K 线） */
async function settleAll(fetchBars) {
  const d = load();
  const open = d.entries.filter((e) => e.status !== 'settled');
  let settled = 0, failed = 0;
  for (const e of open) {
    try {
      const bars = await fetchBars(e.code, e.pickDate);
      const r = settleOne(e, bars);
      if (!r) { failed++; continue; }
      Object.assign(e, r, { settledAt: new Date().toISOString() });
      settled++;
    } catch (err) { failed++; }
  }
  if (settled) save(d);
  return { settled, failed, openLeft: open.length - settled };
}

/** 统计战绩 */
function stats() {
  const d = load();
  const all = d.entries;
  const settled = all.filter((e) => e.status === 'settled');
  const filled = settled.filter((e) => e.result !== 'not_filled');
  const wins = filled.filter((e) => e.result === 'hit_target' || e.result === 'expired_win');
  const losses = filled.filter((e) => e.result === 'stopped' || e.result === 'expired_loss');

  const rets = filled.map((e) => {
    if (e.result === 'hit_target') return (e.target / e.price - 1) * 100;
    if (e.result === 'stopped') return (e.stop / e.price - 1) * 100;
    if (Number.isFinite(e.retPct)) return e.retPct;
    return null;
  }).filter((x) => x !== null);

  const avg = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
  const winRate = filled.length ? (wins.length / filled.length) * 100 : null;

  return {
    total: all.length,
    open: all.filter((e) => e.status !== 'settled').length,
    settled: settled.length,
    filled: filled.length,
    notFilled: settled.filter((e) => e.result === 'not_filled').length,
    wins: wins.length,
    losses: losses.length,
    winRate: winRate === null ? null : +winRate.toFixed(1),
    avgRetPct: avg === null ? null : +avg.toFixed(2),
    /* 样本不足时不下结论——沿用星图文档的规矩 */
    conclusive: filled.length >= MIN_SAMPLE,
    minSample: MIN_SAMPLE,
    verdict: filled.length < MIN_SAMPLE
      ? `样本 ${filled.length} 条 < ${MIN_SAMPLE}，胜率与平均收益**不具备统计意义**，仅供过程跟踪`
      : winRate >= 55 && avg > 1 ? '有效（胜率≥55% 且平均超额>1%）'
        : winRate < 45 || avg < 0 ? '无效（胜率<45% 或平均收益<0）'
          : '存疑（处于 45%~55% 之间）',
    byResult: {
      hit_target: settled.filter((e) => e.result === 'hit_target').length,
      expired_win: settled.filter((e) => e.result === 'expired_win').length,
      expired_loss: settled.filter((e) => e.result === 'expired_loss').length,
      stopped: settled.filter((e) => e.result === 'stopped').length,
      not_filled: settled.filter((e) => e.result === 'not_filled').length,
    },
    updatedAt: d.updatedAt,
  };
}

function list(opts = {}) {
  const d = load();
  let arr = d.entries;
  if (opts.status === 'open') arr = arr.filter((e) => e.status !== 'settled');
  if (opts.status === 'settled') arr = arr.filter((e) => e.status === 'settled');
  arr = [...arr].sort((a, b) => (b.pickDate > a.pickDate ? 1 : -1));
  const limit = Math.max(1, Math.min(Number(opts.limit) || 100, 500));
  return { total: d.entries.length, entries: arr.slice(0, limit) };
}

function clear() {
  save({ version: 1, entries: [], updatedAt: null });
  return { ok: true };
}

module.exports = { record, settleAll, settleOne, stats, list, clear, load, MIN_SAMPLE };
