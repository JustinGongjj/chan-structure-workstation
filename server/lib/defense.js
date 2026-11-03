'use strict';
/**
 * 防守型策略回测（Defensive Mode）
 * =====================================================================
 * 前面所有回测都是"开仓模式"：出现买点就进场，出现卖点就平仓。
 * 结论是缠论信号作为独立策略不赚钱（资金利用率仅 16-33%）。
 *
 * 但数据给出的方向是：**它的价值在"少亏"**。
 * 所以这里换一个完全不同的模型 —— **减仓模式**：
 *
 *   始终持有 100% 底仓（等于买入持有）
 *   → 出现卖点信号时，把仓位从 100% 降到 (100 - cutPct)%
 *   → 出现买点信号时，恢复到 100%
 *   → 若之后触发回撤条件，进一步降到底仓下限
 *
 * 这样做的意义：买入持有是"一直扛着"，减仓是"该走时少扛一点"。
 * 评价标准也随之改变 —— 不看收益绝对值，而看：
 *   · 最大回撤减少多少
 *   · 为减少回撤付出的收益代价
 *   · Calmar 比率（年化收益 / 最大回撤）是否提升
 *
 * ▍为什么这个模型更符合缠论的原始意图
 *   缠师反复强调"不预测，只应对""走势终完美"。
 *   减仓模型正是"应对"：不猜顶，只是在结构走坏时降低暴露。
 */

const C = require('./chan');

const DEFAULTS = {
  period: 'day',
  biStyle: 'new',
  /* 触发减仓的卖点类型 */
  sellSignals: ['2S', '1S', '3S'],
  /* 触发加回的买点类型 */
  buySignals: ['1B', '2B', '3B'],
  /* 减仓后保留的仓位比例（0 = 清仓，0.5 = 减半） */
  keepPct: 0.5,
  /* 减仓后再次触发卖点是否继续减（递减到底仓） */
  cumulative: false,
  /* 保底仓位（永不低于这个比例） */
  floorPct: 0,
  /* 减仓后多少根内若无新信号则自动恢复（0 = 不自动恢复） */
  autoRestoreBars: 0,
  feeBps: 8,
  slipBps: 4,
  warmup: 120,
  maxConfirmLag: 3,
};

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/**
 * @param {Array} bars
 * @param {Object} opts
 */
function runDefense(bars, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  const fee = num(P.feeBps, 8) / 10000;
  const slip = num(P.slipBps, 4) / 10000;
  const costPerSide = fee + slip;

  if (!Array.isArray(bars) || bars.length < P.warmup + 30) {
    return { ok: false, error: `K 线不足（需 ≥ ${P.warmup + 30}）` };
  }

  let cash = 100000;
  const initCapital = cash;
  let heldPct = 0;          // 当前仓位比例 0~1
  let shares = 0;           // 当前持股数
  let lastAdjustIdx = -1;
  let lastAdjustWhy = '';
  const actions = [];       // 每次调仓
  const equity = [];
  let seen = new Set();
  let blockedNoSignal = 0;

  const keep = Math.max(0, Math.min(1, num(P.keepPct, 0.5)));
  const floor = Math.max(0, Math.min(1, num(P.floorPct, 0)));

  /* 建立满仓（预热结束后） */
  let inited = false;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    /* 自动恢复 */
    if (P.autoRestoreBars > 0 && heldPct < 1 && lastAdjustIdx >= 0 && i - lastAdjustIdx >= P.autoRestoreBars) {
      const target = 1;
      const adj = adjustTo(target, bar.o, i, bar.t, 'auto-restore', costPerSide, { cash, shares, heldPct, equityValue: cash + shares * bar.o });
      cash = adj.cash; shares = adj.shares; heldPct = adj.heldPct;
      actions.push(adj.action);
      lastAdjustIdx = i;
      lastAdjustWhy = 'auto-restore';
    }

    /* 预热结束后满仓入场 */
    if (!inited && i >= P.warmup) {
      const amt = cash;
      if (amt > bar.c) {
        /*
          买入股票必须从 cash 里扣掉本金，否则 cash 与持仓同时计入权益 → 权益直接翻倍。
          之前这里只扣了手续费，导致"收益 88% 而标的 −2%"的荒谬结果。
        */
        shares = amt / (bar.c * (1 + costPerSide));
        cash -= amt;               // 本金全额转成持仓
        heldPct = 1;
        inited = true;
        actions.push({ i, t: bar.t, from: 0, to: 1, price: bar.c, why: 'init-full', type: 'init' });
      }
    }

    /* 信号驱动调仓 */
    if (inited && i >= P.warmup && i < bars.length - 1) {
      let res = null;
      try {
        res = C.analyze(bars.slice(0, i + 1), { period: P.period, biStyle: P.biStyle });
      } catch (e) { res = null; }

      if (res && res.ok) {
        /* 只认新出现、且延迟可接受的信号（防前视偏差） */
        const cur = new Map();
        for (const s of res.signals || []) cur.set(s.type + ':' + s.barIdx, s);
        const fresh = [];
        for (const [k, s] of cur) {
          if (seen.has(k)) continue;
          const lag = i - s.barIdx;
          if (lag >= 0 && lag <= (P.maxConfirmLag || 3)) fresh.push(s);
        }
        for (const k of cur.keys()) seen.add(k);

        for (const s of fresh) {
          const isSell = s.type.endsWith('S');
          const isSellTrigger = isSell && (P.sellSignals || []).includes(s.type);
          const isBuyTrigger = !isSell && (P.buySignals || []).includes(s.type);
          if (!isSellTrigger && !isBuyTrigger) continue;

          const nextOpen = bars[i + 1] ? bars[i + 1].o : bar.c;
          const nextT = bars[i + 1] ? bars[i + 1].t : bar.t;
          let target = heldPct;
          if (isSellTrigger) {
            target = P.cumulative ? Math.max(floor, heldPct * keep) : Math.max(floor, keep === 0 ? 0 : keep);
            if (P.cumulative) target = Math.max(floor, heldPct - (1 - keep));
          } else {
            target = 1; // 买点恢复满仓
          }
          if (Math.abs(target - heldPct) < 0.02) continue;

          const adj = adjustTo(target, nextOpen, i + 1, nextT, (isSellTrigger ? 'sell:' : 'buy:') + s.type, costPerSide, { cash, shares, heldPct, equityValue: cash + shares * nextOpen });
          cash = adj.cash; shares = adj.shares; heldPct = adj.heldPct;
          actions.push(adj.action);
          lastAdjustIdx = i + 1;
          lastAdjustWhy = s.type;
        }
      }
    }

    equity.push({ t: bar.t, v: +(cash + shares * bar.c).toFixed(2), price: bar.c, pos: +heldPct.toFixed(2) });
  }

  /* 收尾 */
  const last = bars[bars.length - 1];
  const finalV = cash + shares * last.c - shares * last.c * costPerSide;
  equity[equity.length - 1].v = +finalV.toFixed(2);

  return {
    ok: true,
    params: P,
    stats: computeDefenseStats({ equity, actions, initCapital, finalV, bars }),
    actions: actions.map((a) => ({
      ...a,
      price: +a.price.toFixed(4),
      fromPct: +(a.from * 100).toFixed(0),
      toPct: +(a.to * 100).toFixed(0),
    })),
  };
}

/** 把仓位调整到 target（按当前价成交） */
function adjustTo(target, price, i, t, why, costPerSide, state) {
  const { cash, shares, heldPct, equityValue } = state;
  const from = heldPct;
  const deltaVal = (target - from) * equityValue;
  const deltaShares = deltaVal / price;
  const newShares = Math.max(0, shares + deltaShares);
  const cost = Math.abs(deltaVal) * costPerSide;
  const newCash = cash - deltaVal - cost;
  return {
    cash: newCash,
    shares: newShares,
    heldPct: target,
    action: { i, t, from, to: target, price, why, type: target > from ? 'add' : 'cut' },
  };
}

function computeDefenseStats({ equity, actions, initCapital, finalV, bars }) {
  /* 基准：买入持有（同样从预热结束开始） */
  const vals = equity.map((e) => e.v);
  const totalRet = (finalV - initCapital) / initCapital * 100;

  // 回撤
  let peak = -Infinity, maxDD = 0, ddStartT = null, ddEndT = null, curPeakT = null;
  for (const e of equity) {
    if (e.v > peak) { peak = e.v; curPeakT = e.t; }
    const dd = peak > 0 ? (peak - e.v) / peak * 100 : 0;
    if (dd > maxDD) { maxDD = dd; ddStartT = curPeakT; ddEndT = e.t; }
  }

  const t0 = bars[0].t, t1 = bars[bars.length - 1].t;
  const years = Math.max((t1 - t0) / (365.25 * 86400000), 1 / 365.25);
  const annual = (Math.pow(finalV / initCapital, 1 / years) - 1) * 100;

  // 买入持有基准（预热结束那根起）
  const warm = Math.min(bars.length - 1, 120);
  const bhRet = (bars[bars.length - 1].c - bars[warm].c) / bars[warm].c * 100;
  // 买入持有回撤
  let bhPeak = -Infinity, bhMaxDD = 0;
  for (let k = warm; k < bars.length; k++) {
    const v = bars[k].c;
    if (v > bhPeak) bhPeak = v;
    const dd = bhPeak > 0 ? (bhPeak - v) / bhPeak * 100 : 0;
    if (dd > bhMaxDD) bhMaxDD = dd;
  }

  const cuts = actions.filter((a) => a.type === 'cut').length;
  const adds = actions.filter((a) => a.type === 'add').length;
  const avgPos = equity.reduce((a, e) => a + e.pos, 0) / equity.length;

  const calmar = maxDD > 0 ? +(annual / maxDD).toFixed(2) : null;
  const bhCalmar = bhMaxDD > 0 ? +(bhRet / years / bhMaxDD).toFixed(2) : null;

  return {
    initCapital,
    finalValue: +finalV.toFixed(2),
    totalReturnPct: +totalRet.toFixed(2),
    annualReturnPct: +annual.toFixed(2),
    maxDrawdownPct: +maxDD.toFixed(2),
    maxDDRange: ddStartT && ddEndT ? [ddStartT, ddEndT] : null,
    calmar,
    /* 基准 */
    benchmarkPct: +bhRet.toFixed(2),
    benchmarkMaxDDPct: +bhMaxDD.toFixed(2),
    benchmarkCalmar: bhCalmar,
    /* 防守效果 */
    ddReductionPct: +(bhMaxDD - maxDD).toFixed(2),      // 回撤减少了多少个百分点
    returnCostPct: +(totalRet - bhRet).toFixed(2),      // 收益代价（负=少赚）
    /* 行为 */
    cuts,
    adds,
    avgPositionPct: +(avgPos * 100).toFixed(1),
    years: +years.toFixed(2),
  };
}

module.exports = { runDefense, DEFAULTS };
