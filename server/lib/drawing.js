/**
 * 用户手绘线 · 校验引擎（AI 辅助纠错的"规则层"）
 *
 * 输入：手绘线 [{type,x1,y1,x2,y2,label}]（x = K 线序号，y = 价格）+ 缠论分析结果
 * 输出：{score, verdict, findings[], stats} —— 完全确定，可复现，可单测
 *
 * 设计取向（重要）：
 *   缠论不靠趋势线交易，判的是"笔/线段/中枢/背驰/买卖点"。所以这里不是"猜你想画什么"，
 *   而是把用户画的线放到结构坐标里对齐：端点是否落在笔的端点上、平线是否就是中枢上下沿、
 *   框是否框住了中枢、线是否穿中枢（震荡而非趋势）、端点是否贴着买卖点……
 *   每条结论都给出可核对的数值，不做玄学解释。
 */
'use strict';

const TOL_PRICE = 0.004; // 价格容差 0.4%（吸附判定）
const TOL_BAR = 2; // K 线序号容差

const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const pct = (a, b) => (b ? (a - b) / b : 0);

function nearestBiEndpoint(bis, idx, price) {
  let best = null;
  for (const bi of bis) {
    for (const [i, p] of [
      [bi.i0, bi.p0],
      [bi.i1, bi.p1]
    ]) {
      const dIdx = Math.abs(i - idx);
      const dPrice = Math.abs(pct(price, p));
      const score = dIdx + dPrice * 200; // 序号差 + 价格差加权
      if (!best || score < best.score) best = { score, idx: i, price: p, dIdx, dPrice, dir: bi.dir, bi };
    }
  }
  return best;
}

function nearestSignal(signals, idx, price) {
  let best = null;
  for (const s of signals) {
    const dIdx = Math.abs(s.barIdx - idx);
    const dPrice = Math.abs(pct(price, s.price));
    const score = dIdx + dPrice * 200;
    if (!best || score < best.score) best = { score, s, dIdx, dPrice };
  }
  return best;
}

function pivotAt(pivots, idx) {
  return pivots.find((p) => idx >= p.i0 && idx <= p.i1) || null;
}

/**
 * @param {{type:string,x1:number,y1:number,x2?:number,y2?:number,label?:string,id?:string}} line
 * @param {object} a  analyze() 的结果
 * @param {{bars?:number}} [opts]
 */
function checkLine(line, a, opts = {}) {
  const findings = [];
  const bars = a.bars || [];
  const bis = a.bis || [];
  const pivots = a.pivots || [];
  const signals = a.signals || [];
  const add = (level, code, text, extra) => findings.push({ level, code, text, ...extra });

  if (!bars.length) {
    add('fail', 'no-data', '没有 K 线数据，无法校验');
    return { findings, score: 0 };
  }
  const last = bars.length - 1;
  const clampIdx = (i) => Math.max(0, Math.min(last, Math.round(i)));
  const priceOf = (i) => bars[clampIdx(i)].c;
  let score = 70; // 基准分：一条合法但无特别含义的线
  const stats = {};

  if (!Number.isFinite(Number(line.x1)) || !Number.isFinite(Number(line.y1)) ||
      (line.type !== 'hline' && line.x2 != null && !Number.isFinite(Number(line.x2))) ||
      (line.type !== 'hline' && line.y2 != null && !Number.isFinite(Number(line.y2)))) {
    add('fail', 'bad-value', '坐标不是有效数值（可能画到画布外或数据未加载），这条线不计入结论');
    return { findings, score: 0, stats: {} };
  }
  const x1 = clampIdx(line.x1);
  const y1 = Number(line.y1);
  const isLevel = line.type === 'hline';
  const isRect = line.type === 'rect';
  const x2 = clampIdx(line.x2 != null ? line.x2 : x1);
  const y2 = Number(line.y2 != null ? line.y2 : y1);

  if (!Number.isFinite(y1) || !Number.isFinite(y2)) {
    add('fail', 'bad-value', '坐标不是有效数值，画线未保存成功');
    return { findings, score: 0 };
  }

  /* ---- 1. 端点是否落在笔的端点上（缠论里线段/笔的转折点才是"有效点位"） ---- */
  if (!isLevel && !isRect) {
  const ep1 = nearestBiEndpoint(bis, x1, y1);
  if (ep1 && ep1.dIdx <= TOL_BAR && ep1.dPrice <= TOL_PRICE) {
    score += 8;
    add('ok', 'snap-bi', `起点正好落在笔的端点（第 ${ep1.idx} 根，${round(ep1.price)}），这是结构里有效的转折点`, { bar: ep1.idx });
    stats.snapStart = true;
  } else if (ep1) {
    add(
      'warn',
      'off-bi',
      `起点离最近的笔端点有 ${ep1.dIdx} 根、${(ep1.dPrice * 100).toFixed(2)}% 的价格差——缠论的意义点位是笔的端点，建议吸附过去`,
      { bar: ep1.idx }
    );
    score -= 6;
    stats.snapStart = false;
  }
  }

  if (!isLevel && !isRect) {
    const ep2 = nearestBiEndpoint(bis, x2, y2);
    if (ep2 && ep2.dIdx <= TOL_BAR && ep2.dPrice <= TOL_PRICE) {
      score += 8;
      add('ok', 'snap-bi-end', `终点落在笔的端点（第 ${ep2.idx} 根，${round(ep2.price)}）`, { bar: ep2.idx });
      stats.snapEnd = true;
    } else if (ep2) {
      add('warn', 'off-bi-end', `终点离最近的笔端点有 ${ep2.dIdx} 根、${(ep2.dPrice * 100).toFixed(2)}% 的价格差`, { bar: ep2.idx });
      score -= 6;
      stats.snapEnd = false;
    }
    /* ---- 2. 方向与结构是否一致 ---- */
    const slope = y2 - y1;
    const spanBars = Math.max(1, x2 - x1);
    const dirWord = slope > 0 ? '向上' : '向下';
    const trendType = (a.trend && a.trend.type) || '';
    const isUp = /上涨/.test(trendType);
    const isDown = /下跌/.test(trendType);
    if (isUp && slope < 0) add('warn', 'against-trend', `当前走势是「${trendType}」，这条线却是${dirWord}的——逆势线在缠论里只能当"次级别回抽"看，不能当主趋势`);
    else if (isDown && slope > 0) add('warn', 'against-trend', `当前走势是「${trendType}」，这条线却是${dirWord}的——同上，只能算次级别反抽`);
    else if (isUp || isDown) add('ok', 'with-trend', `线的方向与「${trendType}」一致`);
    else add('info', 'trend-neutral', `当前是「${trendType || '走势未定'}」，没有明确方向可以对照——这类线只能当区间参考`);
    stats.slopePerBar = round(slope / spanBars, 4);

    /* ---- 3. 是否穿过中枢（穿中枢 = 中枢震荡，不是趋势） ---- */
    const mid = pivots.filter((p) => p.i1 >= Math.min(x1, x2) && p.i0 <= Math.max(x1, x2));
    const crossing = mid.filter((p) => {
      const pAtStart = y1;
      const pAtEnd = y2;
      const lowAt = Math.min(pAtStart, pAtEnd);
      const highAt = Math.max(pAtStart, pAtEnd);
      return !(highAt < p.zd || lowAt > p.zg);
    });
    if (crossing.length) {
      add('warn', 'cross-pivot', `这条线横穿了 ${crossing.length} 个中枢的价格带（${crossing.map((p) => `${round(p.zd)}~${round(p.zg)}`).join('、')}）——穿中枢的走势是中枢震荡，不是趋势，别当成趋势线用`);
      score -= 8;
    }
  }

  /* ---- 4. 水平线 vs 中枢边界 / 前高前低 ---- */
  if (isLevel) {
    const nearPivotEdge = pivots
      .map((p) => ({ p, d: Math.min(Math.abs(pct(y1, p.zg)), Math.abs(pct(y1, p.zd))), edge: Math.abs(pct(y1, p.zg)) < Math.abs(pct(y1, p.zd)) ? '上沿 ZG' : '下沿 ZD' }))
      .filter((x) => x.d <= TOL_PRICE)
      .sort((a2, b2) => a2.d - b2.d)[0];
    if (nearPivotEdge) {
      score += 10;
      add('ok', 'pivot-edge', `这条水平线就是第 ${nearPivotEdge.p.idx + 1} 个中枢的${nearPivotEdge.edge}（${round(nearPivotEdge.edge.includes('ZG') ? nearPivotEdge.p.zg : nearPivotEdge.p.zd)}），是有结构含义的支撑/压力`);
    } else {
      const highs = bars.map((b) => b.h);
      const lows = bars.map((b) => b.l);
      const nearHigh = Math.min(...highs.map((h) => Math.abs(pct(y1, h))));
      const nearLow = Math.min(...lows.map((l) => Math.abs(pct(y1, l))));
      if (Math.min(nearHigh, nearLow) <= TOL_PRICE / 3) {
        score += 4;
        add('ok', 'extreme', `水平线贴近区间${nearHigh < nearLow ? '最高价' : '最低价'}，可作前高/前低参考`);
      } else {
        add('warn', 'floating-level', '这条水平线既不贴中枢上下沿，也不贴前高前低——缠论里"任意价位"没有结构意义');
        score -= 5;
      }
    }
  }

  /* ---- 5. 矩形是否框住中枢 ---- */
  if (isRect) {
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    const i0 = Math.min(x1, x2);
    const i1 = Math.max(x1, x2);
    const inside = pivots.filter((p) => p.i0 >= i0 - TOL_BAR && p.i1 <= i1 + TOL_BAR && p.zd >= lo * (1 - 0.01) && p.zg <= hi * (1 + 0.01));
    if (inside.length) {
      score += 15;
      add('ok', 'box-pivot', `这个框正好圈住第 ${inside.map((p) => p.idx + 1).join('、')} 个中枢 —— 中枢是缠论的核心对象，框对了就抓住了结构`);
    } else {
      const overlap = pivots.filter((p) => p.i1 >= i0 && p.i0 <= i1);
      if (overlap.length) {
        score += 4;
        add('warn', 'box-partial', `框与 ${overlap.length} 个中枢有重叠但没对齐（中枢带是 ${overlap.map((p) => `${round(p.zd)}~${round(p.zg)}`).join('、')}）`, {});
      } else {
        add('warn', 'box-empty', '这个框里没有任何中枢，只是一段价格区间，参考价值有限');
        score -= 5;
      }
    }
  }

  /* ---- 6. 端点是否贴着买卖点 ---- */
  const epPairs = isLevel ? [[x1, y1, '价格']] : [[x1, y1, '起点'], [x2, y2, '终点']];
  for (const [idx, price, tag] of epPairs) {
    const ns = nearestSignal(signals, idx, price);
    if (ns && ns.dIdx <= TOL_BAR && ns.dPrice <= TOL_PRICE) {
      score += 12;
      add('ok', 'near-signal', `${tag}贴着「${ns.s.name}」（第 ${ns.s.barIdx} 根，${round(ns.s.price)}），这是缠论的买卖点，比趋势线更有操作意义`, { bar: ns.s.barIdx });
    }
  }

  /* ---- 7. 数据量兜底 ---- */
  if (bars.length < 60) {
    add('warn', 'few-bars', `当前只有 ${bars.length} 根 K 线，结构（笔/中枢）可能还在形成中，结论置信度下降`);
    score -= 8;
  }

  /* ---- 8. 常识性拐点识别 ---- */
  if (!isLevel && !isRect) {
    const between = bars.slice(Math.min(x1, x2), Math.max(x1, x2) + 1);
    if (between.length > 4) {
      const hi = Math.max(...between.map((b) => b.h));
      const lo = Math.min(...between.map((b) => b.l));
      const overshoot = Math.max(...between.map((b) => Math.max(b.h - Math.max(y1, y2), Math.min(y1, y2) - b.l)));
      const beyond = between.filter((b) => b.h > Math.max(y1, y2) + (hi - lo) * 0.05 || b.l < Math.min(y1, y2) - (hi - lo) * 0.05).length;
      if (hi > lo && beyond >= 3 && beyond / between.length > 0.25) {
        add('warn', 'cut-candles', `${beyond} 根 K 线穿到了线的另一侧（占这段 ${Math.round((beyond / between.length) * 100)}%），线没有贴着这波走势的边界`, {});
        score -= 4;
      }
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { findings, score, stats };
}

/**
 * 校验一整组手绘线
 * @param {{drawings:Array, analysis:object}} input
 */
function verify({ drawings = [], analysis, market, code, period }) {
  const a = analysis || {};
  const results = drawings.map((d, i) => {
    const r = checkLine(d, a, {});
    return {
      id: d.id || 'line-' + (i + 1),
      type: d.type,
      label: d.label || '',
      score: r.score,
      findings: r.findings,
      stats: r.stats
    };
  });

  const all = results.flatMap((r) => r.findings);
  const okN = all.filter((f) => f.level === 'ok').length;
  const warnN = all.filter((f) => f.level === 'warn').length;
  const failN = all.filter((f) => f.level === 'fail').length;
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;

  let verdict;
  if (!results.length) verdict = { level: 'info', text: '还没有画线。先用工具栏画一条趋势线或水平线，我再帮你和笔/中枢/买卖点对齐。' };
  else if (failN) verdict = { level: 'fail', text: `有 ${failN} 条硬错误（坐标无效等），先修掉再看结论。` };
  else if (avg >= 80) {
    const hitsPivot = all.some((f) => f.code === 'pivot-edge' || f.code === 'box-pivot');
    const hitsSignal = all.some((f) => f.code === 'near-signal');
    const snaps = all.filter((f) => f.code === 'snap-bi' || f.code === 'snap-bi-end').length;
    const facts = [
      snaps ? `有 ${snaps} 个端点落在笔端点上` : '',
      hitsPivot ? '有线的价位/框与中枢对齐' : '',
      hitsSignal ? '有端点贴着买卖点' : ''
    ].filter(Boolean);
    verdict = { level: 'ok', text: `画法与结构基本吻合（平均 ${avg} 分）：${facts.join('，') || '整体没有明显冲突'}。` };
  }
  else if (avg >= 60) verdict = { level: 'warn', text: `画法大致合理（平均 ${avg} 分），但还有 ${warnN} 处可以对齐：优先把端点吸到笔的端点、把水平线贴到中枢上下沿。` };
  else verdict = { level: 'warn', text: `画法与结构偏离较多（平均 ${avg} 分）：${warnN} 处提示。缠论不看趋势线，建议改用"框住中枢 + 标出买卖点"的方式。` };

  const method = {
    ok: okN,
    warn: warnN,
    fail: failN,
    steps: [
      '把每个端点吸附到最近的"笔端点"（缠论的有效转折点）',
      '把水平线贴到中枢的 ZG/ZD，而不是任意价位',
      '用它框住中枢，再在买卖点上标注，比画趋势线更接近缠论的用法',
      '穿中枢的线要当"中枢震荡"看，不要当趋势'
    ]
  };
  return {
    ok: true,
    market,
    code,
    period,
    level: a.level || period,
    lines: results,
    score: avg,
    verdict,
    method,
    engine: 'rule-based (deterministic)',
    disclaimer: '这是结构对齐检查，不是投资建议；缠论的买卖点结论以结构本身为准，手绘线只作辅助理解。'
  };
}

module.exports = { verify, checkLine, TOL_PRICE, TOL_BAR };
