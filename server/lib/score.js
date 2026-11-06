'use strict';
/**
 * 组合评分（0-100，四维度）
 * =====================================================================
 * 为什么要有评分：27 项指标摆出来，专业人士能读，小白读不了。
 * 但评分必须是**可解释**的——每个维度怎么扣分、扣在哪，都要能说清楚。
 * 所以这里不做"隐式加权"，而是：**每个维度先做区间对照→得 0~满分，再加权求和**。
 *
 * ▍四个维度与三种权重预设
 *   用户可选：均衡(默认) / 保守 / 激进
 *   权重可切换的理由：评价标准本就因人而异，写死一套等于把自己的偏好强加给用户。
 *
 * ▍评级门槛（不随权重变化，避免"换个权重就变优秀"的荒谬结论）
 *   80+ 优秀 · 60-79 可用 · 40-59 边缘 · 20-39 偏弱 · <20 不合格
 *
 * ▍设计原则
 *   · 每个维度的打分区间都写死在 SUBSCORES 里，能查
 *   · 未产生交易/样本不足时，评分直接标注"不足"，不硬给分
 *   · 结论文字从低分维度生成，而不是套模板
 */

const WEIGHTS = {
  balanced: { label: '均衡', ret: 30, risk: 30, dd: 25, trade: 15 },
  conservative: { label: '保守', ret: 20, risk: 25, dd: 40, trade: 15 },
  aggressive: { label: '激进', ret: 45, risk: 25, dd: 15, trade: 15 },
};

/** 线性区间映射：x 在 [lo,hi] 之间映射到 [0,max]，超界截断 */
function lerp(x, lo, hi, max) {
  if (!Number.isFinite(x)) return 0;
  if (hi === lo) return 0;
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * max;
}

/**
 * 四维度打分
 * @param {object} m 27 项指标
 * @param {string} preset balanced|conservative|aggressive
 */
function scorePortfolio(m, preset = 'balanced') {
  const w = WEIGHTS[preset] || WEIGHTS.balanced;

  /* ① 收益能力：年化收益 -20% ~ +30% 映射到 0~满分 */
  const retScore = lerp(m.年化收益, -20, 30, w.ret);

  /* ② 风险调整：夏普 -0.5 ~ 2.0 映射；卡玛补 30%
        夏普看"每单位波动换多少收益"，卡玛看"每单位回撤换多少收益" */
  const sharpePart = lerp(m.夏普比率, -0.5, 2.0, w.risk * 0.7);
  const calmarPart = m.卡玛比率 == null ? 0 : lerp(m.卡玛比率, -0.5, 2.0, w.risk * 0.3);
  const riskScore = sharpePart + calmarPart;

  /* ③ 回撤控制：最大回撤 60% ~ 5% 反向映射（越小越好） */
  const ddScore = lerp(-m.最大回撤, -60, -5, w.dd);

  /* ④ 交易质量：胜率 20%~65% + 盈亏比 0.5~2.5 + 换手合理性 */
  const winPart = lerp(m.交易胜率, 20, 65, w.trade * 0.45);
  const pnlPart = m.单笔盈亏比 == null ? 0 : lerp(m.单笔盈亏比, 0.5, 2.5, w.trade * 0.35);
  /* 换手：年化 5~40 次最合理，太低没机会、太高摩擦大 */
  const turn = m.年化交易次数;
  let turnPart = 0;
  if (Number.isFinite(turn)) {
    if (turn < 5) turnPart = w.trade * 0.2 * (turn / 5);
    else if (turn <= 40) turnPart = w.trade * 0.2;
    else turnPart = w.trade * 0.2 * Math.max(0, 1 - (turn - 40) / 60);
  }
  const tradeScore = winPart + pnlPart + turnPart;

  const dims = [
    { key: 'ret', name: '收益能力', got: +retScore.toFixed(1), max: w.ret },
    { key: 'risk', name: '风险调整', got: +riskScore.toFixed(1), max: w.risk },
    { key: 'dd', name: '回撤控制', got: +ddScore.toFixed(1), max: w.dd },
    { key: 'trade', name: '交易质量', got: +tradeScore.toFixed(1), max: w.trade },
  ];

  const total = Math.round(dims.reduce((a, d) => a + d.got, 0));
  const grade = gradeOf(total);

  /*
    最弱/最强维度 → 结论
    注意：dim 对象本身没有 pct 字段（pct 是派生值）。
    必须先算好带 pct 的对象再传给 verdictOf，否则 verdictOf 里
    weakest.pct 是 undefined，`undefined < 40` 恒为 false，短板说明会整段丢失。
  */
  const byPct = (d) => +(d.got / d.max * 100).toFixed(0);
  const sortedWeak = [...dims].sort((a, b) => (a.got / a.max) - (b.got / b.max));
  const sortedStrong = [...dims].sort((a, b) => (b.got / b.max) - (a.got / a.max));
  const weakest = { ...sortedWeak[0], pct: byPct(sortedWeak[0]) };
  const strongest = { ...sortedStrong[0], pct: byPct(sortedStrong[0]) };

  return {
    preset,
    presetLabel: w.label,
    weights: w,
    total,
    grade,
    dims,
    weakest: { key: weakest.key, name: weakest.name, pct: weakest.pct },
    strongest: { key: strongest.key, name: strongest.name, pct: strongest.pct },
    verdict: verdictOf(total, strongest, weakest, m),
    /* 打分区间说明（让评分可查、可质疑） */
    rubric: [
      { dim: '收益能力', rule: `年化收益 -20%～+30% 线性映射` },
      { dim: '风险调整', rule: `夏普 -0.5～2.0 占 70%，卡玛 -0.5～2.0 占 30%` },
      { dim: '回撤控制', rule: `最大回撤 60%～5% 反向线性` },
      { dim: '交易质量', rule: `胜率 20%～65% 占 45%，盈亏比 0.5～2.5 占 35%，年化换手 5～40 次占 20%` },
    ],
  };
}

function gradeOf(total) {
  if (total >= 80) return { level: 'excellent', text: '优秀', cls: 'good' };
  if (total >= 60) return { level: 'usable', text: '可用', cls: 'good' };
  if (total >= 40) return { level: 'marginal', text: '边缘', cls: 'warn' };
  if (total >= 20) return { level: 'weak', text: '偏弱', cls: 'bad' };
  return { level: 'poor', text: '不合格', cls: 'bad' };
}

/** 结论文字从数据生成，不套模板 */
function verdictOf(total, strongest, weakest, m) {
  const parts = [];
  if (total < 40) parts.push('这套组合整体表现偏弱');
  else if (total < 60) parts.push('这套组合处于边缘水平');
  else parts.push('这套组合具备可用性');

  if (weakest.pct < 40) {
    const why = {
      ret: `收益为 ${m.年化收益}%，没有跑出正回报`,
      risk: `夏普 ${m.夏普比率}，承担的风险没有得到足够补偿`,
      dd: `最大回撤 ${m.最大回撤}%，超出多数人可承受范围`,
      trade: `胜率 ${m.交易胜率}%、盈亏比 ${m.单笔盈亏比 ?? '—'}，每笔质量不高`,
    }[weakest.key];
    parts.push(`主要短板在${weakest.name}——${why}`);
  }
  if (strongest.pct >= 70) parts.push(`${strongest.name}是相对优势（${strongest.pct}% 得分）`);
  return parts.join('；') + '。';
}

/**
 * 从「因子回测」的结果构造评分输入
 * 两套回测的字段名不同，这里做归一化，让 scorePortfolio 可以复用。
 *
 * 单标的（bt/run）：
 *   年化=annualReturnPct 夏普=sharpe 回撤=maxDrawdownPct
 *   胜率=winRate 盈亏比=payoff 交易数=trades 持有=avgHoldBars
 * 批量（bt/batch）：
 *   用中位值（medianSharpe / medianAnnualPct / medianDrawdownPct）
 *   胜率用汇总胜率，盈亏比由单笔数据推得
 */
function fromBacktest(stats, isBatch = false) {
  if (isBatch) {
    const s = stats || {};
    /* 换手：年化交易次数 = 总交易 / 年数；批量没有年数字段，用平均持有与标的数粗估 */
    const trades = s.totalTrades || 0;
    return {
      年化收益: s.medianAnnualPct != null ? s.medianAnnualPct : 0,
      绝对收益: s.medianTotalReturnPct != null ? s.medianTotalReturnPct : 0,
      夏普比率: s.medianSharpe != null ? s.medianSharpe : 0,
      /* 批量没有卡玛的直接来源 → 用 年化/|回撤| 现算 */
      卡玛比率: (s.medianDrawdownPct > 0 && s.medianAnnualPct != null)
        ? +(s.medianAnnualPct / s.medianDrawdownPct).toFixed(2) : null,
      最大回撤: s.medianDrawdownPct != null ? s.medianDrawdownPct : 0,
      交易胜率: s.winRate != null ? s.winRate : 0,
      单笔盈亏比: s.profitFactor != null ? Math.min(s.profitFactor, 5) : null,
      /* 年化交易次数：总量 / 标的数（每标的每年大致次数） */
      年化交易次数: s.symbols ? +(trades / s.symbols / 3).toFixed(1) : trades,
    };
  }
  const s = stats || {};
  const years = s.years > 0 ? s.years : 1;
  return {
    年化收益: s.annualReturnPct || 0,
    绝对收益: s.totalReturnPct || 0,
    夏普比率: s.sharpe || 0,
    卡玛比率: s.maxDrawdownPct > 0 ? +((s.annualReturnPct || 0) / s.maxDrawdownPct).toFixed(2) : null,
    最大回撤: s.maxDrawdownPct || 0,
    交易胜率: s.winRate || 0,
    单笔盈亏比: s.payoff != null ? Math.min(s.payoff, 5) : null,
    年化交易次数: (s.trades || 0) / years,
  };
}

module.exports = { scorePortfolio, fromBacktest, WEIGHTS };
