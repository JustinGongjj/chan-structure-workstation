'use strict';
/**
 * 滚动 walk-forward 验证（Rolling Walk-Forward）
 * =====================================================================
 * 单次切分（oos.js）只能验证"一次"，容易受特定切点影响。
 * 滚动 walk-forward 把它做成多段：
 *
 *   [训练1][验证1]
 *          [训练2][验证2]
 *                 [训练3][验证3]
 *
 * 每段单独用训练期挑参数、验证期检验，最后看**各段验证期结果的分布**。
 * 比单次切分可信得多：一次好可能是运气，多次都好才是真稳。
 *
 * 效率考虑：
 *   · 标的数多时很慢（段数 × 组合数 × 标的数 次回测）
 *   · 默认 3 段、每段训练占 60%
 */

const { splitBars } = require('./oos');
const OOS = require('./oos');

/**
 * @param {Array} symbols [{market, code, bars}]
 * @param {Object} baseOpts
 * @param {Object} grid
 * @param {Object} cfg { folds=3, trainRatio=0.6 }
 */
function rollingWalkForward(symbols, baseOpts, grid, cfg = {}) {
  const folds = Math.max(2, Math.min(6, cfg.folds || 3));
  const trainRatio = cfg.trainRatio != null ? cfg.trainRatio : 0.6;

  const prepared = symbols.filter((s) => s.bars && s.bars.length >= 500);
  if (prepared.length < 3) return { ok: false, error: `有效标的仅 ${prepared.length} 个` };

  // 生成参数组合
  const keys = Object.keys(grid || {});
  let combos = [{}];
  for (const k of keys) {
    const next = [];
    for (const c of combos) for (const v of grid[k]) next.push({ ...c, [k]: v });
    combos = next;
  }
  if (combos.length > 40) return { ok: false, error: `参数组合过多（${combos.length}）` };

  /*
    滚动窗口：把整段历史切成 folds+1 块，
    第 i 折用 [i*step, i*step+win] 训练，[i*step+win, i*step+win+step] 验证。
    用每只标的自己的长度，按比例切，保证不同标的可比。
  */
  const foldResults = [];

  for (let f = 0; f < folds; f++) {
    const sliceKey = 'f' + f;
    // 为每个标的构造这一折的训练/验证片段
    const foldSymbols = [];
    for (const s of prepared) {
      const n = s.bars.length;
      // 每折覆盖一段连续历史：总区间去掉最开始一块
      const blockSize = Math.floor(n / (folds + 1));
      const start = f * blockSize;
      const trainEnd = start + Math.floor(blockSize * trainRatio * 2);
      const valStart = trainEnd;
      const valEnd = Math.min(n, start + blockSize * 2);
      if (valEnd - valStart < 120 || trainEnd - start < 200) continue;
      foldSymbols.push({
        market: s.market,
        code: s.code,
        inSample: s.bars.slice(start, trainEnd),
        outSample: s.bars.slice(Math.max(start, valStart - 60), valEnd), // 留预热
      });
    }
    if (foldSymbols.length < 3) continue;

    // 训练期挑最优
    const inRes = combos.map((c) => ({
      params: c,
      ...OOS.evalCombo(foldSymbols, { ...baseOpts, ...c }, 'inSample'),
    })).filter((x) => x.trades > 0).sort((a, b) => b.avgPct - a.avgPct);

    if (!inRes.length) continue;
    const bestIn = inRes[0];
    const oos = OOS.evalCombo(foldSymbols, { ...baseOpts, ...bestIn.params }, 'outSample');

    foldResults.push({
      fold: f + 1,
      symbols: foldSymbols.length,
      params: bestIn.params,
      inAvg: bestIn.avgPct,
      inTrades: bestIn.trades,
      oosAvg: oos.avgPct,
      oosTrades: oos.trades,
      oosWin: oos.winRate,
      oosBeat: oos.beatRate,
      decay: bestIn.avgPct !== 0 ? +(((oos.avgPct - bestIn.avgPct) / Math.abs(bestIn.avgPct)) * 100).toFixed(1) : null,
    });
  }

  if (!foldResults.length) return { ok: false, error: '没有足够的折可用于验证（数据太短）' };

  return {
    ok: true,
    folds: foldResults.length,
    totalTrades: foldResults.reduce((a, f) => a + f.oosTrades, 0),
    folds_detail: foldResults,
    verdict: judgeRolling(foldResults),
  };
}

/** 看各折验证期是否**一致为正** */
function judgeRolling(rows) {
  const oos = rows.map((r) => r.oosAvg);
  const positives = oos.filter((v) => v > 0).length;
  const avg = oos.reduce((a, b) => a + b, 0) / oos.length;
  const worst = Math.min(...oos);
  const best = Math.max(...oos);
  const trades = rows.reduce((a, r) => a + r.oosTrades, 0);

  const reasons = [];
  if (trades < 30) {
    reasons.push(`验证期总交易 ${trades} 笔不足 30`);
    return { level: 'insufficient', text: '样本不足', reasons, positives, total: rows.length, avgOos: +avg.toFixed(2), worst: +worst.toFixed(2), best: +best.toFixed(2) };
  }

  const rate = positives / rows.length;
  let level, text;
  if (rate >= 0.8 && avg > 0) {
    level = 'robust'; text = '多折验证一致为正：稳健';
    reasons.push(`${positives}/${rows.length} 折验证期为正（≥80%）`);
  } else if (rate >= 0.5 && avg > 0) {
    level = 'mixed'; text = '部分折为正：不稳定';
    reasons.push(`${positives}/${rows.length} 折为正，均值 ${avg.toFixed(2)}% 但波动大`);
  } else {
    level = 'unstable'; text = '多数折为负：不稳定';
    reasons.push(`仅 ${positives}/${rows.length} 折为正`);
  }
  reasons.push(`各折验证期平均：最好 ${best.toFixed(2)}%，最差 ${worst.toFixed(2)}%`);
  return { level, text, reasons, positives, total: rows.length, avgOos: +avg.toFixed(2), worst: +worst.toFixed(2), best: +best.toFixed(2) };
}

module.exports = { rollingWalkForward };
