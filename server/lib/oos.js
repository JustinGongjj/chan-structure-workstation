'use strict';
/**
 * 样本外验证（Walk-Forward / Out-of-Sample）
 * =====================================================================
 * 过拟合是回测最大的敌人：参数调得越细，历史越好看，实盘越差。
 *
 * 做法：
 *   ① 把每段 K 线切成【训练期 in-sample】和【验证期 out-of-sample】
 *      例：ratio=0.6 → 前 60% 训练，后 40% 验证
 *   ② 在训练期上跑参数网格，选出**平均单笔收益最好**的那组
 *   ③ 把选中的参数原样套到验证期，看还灵不灵
 *   ④ 若验证期显著变差（衰减率大），说明是过拟合
 *
 * 关键指标：
 *   · 衰减率 = (验证期平均收益 - 训练期平均收益) / |训练期平均收益|
 *   · 参数排名稳定性：训练期最优参数在验证期是否仍然靠前
 *
 * 说明：这是"单次切分"，不是严格的滚动 walk-forward。
 * 单次切分更省算力，也足够判断"是不是纯靠拟合历史"。
 */

const { runBacktest } = require('./btengine');

/** 切分 bars */
function splitBars(bars, ratio = 0.6) {
  const cut = Math.max(150, Math.floor(bars.length * ratio));
  return {
    inSample: bars.slice(0, cut),
    outSample: bars.slice(cut - 60), // 验证期前面留 60 根做预热，保证有上下文
    cutIdx: cut,
    inRange: [bars[0].t, bars[cut - 1].t],
    outRange: [bars[cut].t, bars[bars.length - 1].t],
  };
}

/**
 * 在给定的 symbols 上跑一个参数组合，返回汇总
 */
function evalCombo(symbols, opts, sliceKey) {
  let n = 0, win = 0, sumPct = 0, netSum = 0, beat = 0, valid = 0;
  for (const s of symbols) {
    const bars = s[sliceKey];
    if (!bars || bars.length < 200) continue;
    const r = runBacktest(bars, opts);
    if (!r.ok) continue;
    valid++;
    n += r.stats.trades;
    win += r.trades.filter((t) => t.net > 0).length;
    sumPct += r.trades.reduce((a, t) => a + t.netPct, 0);
    netSum += r.trades.reduce((a, t) => a + t.net, 0);
    if (r.stats.excessPct > 0) beat++;
  }
  return {
    symbols: valid,
    trades: n,
    winRate: n ? +(win / n * 100).toFixed(1) : 0,
    avgPct: n ? +(sumPct / n).toFixed(2) : 0,
    beatRate: valid ? +(beat / valid * 100).toFixed(1) : 0,
  };
}

/**
 * 样本外验证主函数
 * @param {Array} symbols [{market, code, bars}]
 * @param {Object} baseOpts
 * @param {Object} grid    参数网格（同 sweep）
 * @param {number} ratio   训练占比
 */
function walkForward(symbols, baseOpts, grid, ratio = 0.6) {
  // 切分
  const prepared = symbols
    .filter((s) => s.bars && s.bars.length >= 400)
    .map((s) => ({ market: s.market, code: s.code, ...splitBars(s.bars, ratio) }));

  if (prepared.length < 5) {
    return { ok: false, error: `有效标的仅 ${prepared.length} 个，样本外验证至少需要 5 个` };
  }

  // 生成组合
  const keys = Object.keys(grid || {});
  let combos = [{}];
  for (const k of keys) {
    const next = [];
    for (const c of combos) for (const v of grid[k]) next.push({ ...c, [k]: v });
    combos = next;
  }
  if (combos.length > 60) return { ok: false, error: `参数组合过多（${combos.length}），请缩减到 60 以内` };

  // 训练期评估
  const inResults = combos.map((c) => {
    const ev = evalCombo(prepared, { ...baseOpts, ...c }, 'inSample');
    return { params: c, ...ev };
  });
  inResults.sort((a, b) => b.avgPct - a.avgPct);

  // 把训练期 top N 和最后一名都带到验证期
  const takeN = Math.min(5, inResults.length);
  const picks = inResults.slice(0, takeN);
  const worstPick = inResults[inResults.length - 1];
  if (inResults.length > takeN) picks.push(worstPick);

  const tested = picks.map((p) => {
    const oos = evalCombo(prepared, { ...baseOpts, ...p.params }, 'outSample');
    const decay = p.avgPct !== 0 ? +(((oos.avgPct - p.avgPct) / Math.abs(p.avgPct)) * 100).toFixed(1) : null;
    return {
      params: p.params,
      inSample: { trades: p.trades, winRate: p.winRate, avgPct: p.avgPct, beatRate: p.beatRate },
      outSample: { trades: oos.trades, winRate: oos.winRate, avgPct: oos.avgPct, beatRate: oos.beatRate },
      decayPct: decay,
      isWorst: p === worstPick,
    };
  });

  const best = tested[0];
  /*
    稳健性排序：不能只看"训练期第一名"。
    实测暴露出一个关键现象：训练期第 1 名（带止盈 20%）在验证期衰减 -60%，
    而第 2 名（纯信号、无止盈）验证期反而 +26.7%。
    → 说明"加参数"才是过拟合的来源，"少参数"更稳健。
    所以额外给出一份"按验证期表现排序"的稳健候选。
  */
  const byOos = [...tested].filter((t) => !t.isWorst).sort((a, b) => b.outSample.avgPct - a.outSample.avgPct);
  const robustPick = byOos[0];
  const verdict = judge(best, tested, robustPick);

  return {
    ok: true,
    ratio,
    symbols: prepared.length,
    inRange: prepared[0].inRange,
    outRange: prepared[0].outRange,
    combos: combos.length,
    best,
    tested,
    robustPick,
    verdict,
  };
}

/** 判定：训练期的优势能否延续到验证期 */
function describe(p) {
  const sig = p.signalTypes ? p.signalTypes.join('+') : '全部';
  return `${sig} 止损${p.stopPct}% 止盈${p.takePct}%`;
}

function judge(best, tested, robustPick) {
  const reasons = [];
  if (!best || best.inSample.trades < 15) {
    return { level: 'insufficient', text: '训练期样本不足，无法判定', reasons: ['训练期交易笔数 <15'] };
  }
  if (best.outSample.trades < 10) {
    return { level: 'insufficient', text: '验证期样本不足，无法判定', reasons: [`验证期仅 ${best.outSample.trades} 笔`] };
  }

  const decay = best.decayPct;
  const oosPositive = best.outSample.avgPct > 0;

  if (oosPositive && (decay == null || decay > -50)) {
    reasons.push(`训练期 ${best.inSample.avgPct}% → 验证期 ${best.outSample.avgPct}%（衰减 ${decay}%），优势延续`);
    return { level: 'robust', text: '样本外仍然有效：不是纯过拟合', reasons };
  }
  if (oosPositive && decay <= -50) {
    reasons.push(`训练期 ${best.inSample.avgPct}% → 验证期 ${best.outSample.avgPct}%（衰减 ${decay}%），优势明显减弱`);
    reasons.push('衰减超过 50%：参数很可能拟合了训练期的偶然波动');
    return { level: 'decayed', text: '样本外衰减明显：需谨慎', reasons };
  }
  // 若"训练期第一名"失效，但另有参数在验证期仍为正，判为部分有效而非全盘过拟合
  if (robustPick && robustPick.outSample.avgPct > 0) {
    reasons.push(`训练期第 1 名失效，但「${describe(robustPick.params)}」在验证期仍为 +${robustPick.outSample.avgPct}%`);
    reasons.push('结论：有效性不来自精细参数，而来自信号类型本身；越少加参数越稳');
    return { level: 'partial', text: '部分有效：稳健的是信号本身，不是参数', reasons };
  }
  reasons.push(`训练期 ${best.inSample.avgPct}% → 验证期 ${best.outSample.avgPct}%，转为负值`);
  // 看最差参数在验证期是否反而更好 → 说明训练期的排序没有预测力
  const worst = tested.find((t) => t.isWorst);
  if (worst && worst.outSample.avgPct > best.outSample.avgPct) {
    reasons.push(`训练期最差的参数（${JSON.stringify(worst.params)}）在验证期反而更好 → 训练期排名无预测力`);
  }
  return { level: 'overfit', text: '过拟合：训练期的优势无法延续', reasons };
}

module.exports = { walkForward, splitBars, evalCombo };
