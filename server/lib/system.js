'use strict';
/**
 * 缠论理论—实践完整链路（Systematic Pipeline）
 * =====================================================================
 * 把分散的能力组织成一条可解释、可复核的链路，每一步都回答一个具体问题：
 *
 *   ① 数据是否可信？      → 新鲜度、K线数、数据源
 *   ② 划分是否可靠？      → 笔标准（新/老）、分型通过率、密度、两标准差异率
 *   ③ 结构是什么？        → 笔 → 线段 → 中枢 → 趋势类型
 *   ④ 结构在演化吗？      → 中枢扩展 / 扩张 / 9段升级
 *   ⑤ 走势完成了吗？      → 走势必完美（a+A+b+B+c 结构）
 *   ⑥ 操作级别清楚吗？    → 同级别分解（唯一性校验）
 *   ⑦ 有买点吗？          → 背驰 → 一类/二类/三类买卖点
 *   ⑧ 多级别共振吗？      → 区间套递归 + 背驰段精确定位
 *   ⑨ 结论可复核吗？      → 每步给出证据与"不确定度"提示
 *
 * 设计原则（对应学习缠论最常见的困难）：
 *   · 缠论最大的痛点是"主观、不可复核"→ 每步都输出量化证据
 *   · 不同软件画法不同 → 明确标注所用标准（新笔/老笔），并给出差异率
 *   · 区间套在实盘很少完美出现 → 如实报告"未形成"，不硬凑
 *   · 多级别容易把人绕晕 → 固定"操作级别 + 最多一个次级别"的建议
 */

const C = require('./chan');
const EXP = require('./expansion');
const DEC = require('./decomposition');

/** 学习/实践中的常见坑，按场景给出提示（来自社群讨论与实盘反馈） */
const PITFALLS = [
  { id: 'style', when: (x) => x.audit.styleDivergence >= 10, text: '本级别的笔在新/老标准下差异 ≥10%：不同软件画法会不一样，跨软件对照时要先统一标准' },
  { id: 'dense', when: (x) => x.audit.biDensityPer100 > 14, text: '笔密度过高（>14 笔/100根），可能是标准过松或级别选得太小，容易频繁假信号' },
  { id: 'sparse', when: (x) => x.audit.biDensityPer100 < 4, text: '笔密度过低（<4 笔/100根），趋势单边行情或标准过严，中枢会很少' },
  { id: 'nopivot', when: (x) => x.pivots === 0, text: '尚无中枢：此时谈买卖点没有依据，只能等结构成形' },
  { id: 'expansion', when: (x) => x.expansion.some((e) => e.onlyWaveOverlap), text: '存在"仅波动区间重叠"的扩张形态：最容易被误判成趋势延续，注意级别可能升级' },
  { id: 'incomplete', when: (x) => !x.perfection.complete, text: '当前走势未完成：可以跟踪，但不要当作已完成走势来下操作结论' },
  { id: 'noresonance', when: (x) => x.resonance && !x.resonance.nested, text: '多级别未形成区间套共振：单级别信号可靠性下降，需降低仓位或等待' },
  { id: 'stale', when: (x) => x.dataStale, text: '数据陈旧：结论可能已过时，先刷新数据再判断' },
];

/**
 * @param {object} analysis  chan.analyze 结果
 * @param {object} opts
 * @param {object} [opts.resonance] 区间套结果（可选）
 * @param {boolean} [opts.dataStale]
 */
function buildSystem(analysis, opts = {}) {
  const a = analysis;
  const audit = a.audit || {};
  const structure = EXP.analyzeStructure(a);
  const flow = DEC.analyzeFlow(a);
  const ctx = {
    audit,
    pivots: (a.pivots || []).length,
    expansion: structure.expansion,
    perfection: flow.perfection,
    resonance: opts.resonance,
    dataStale: !!opts.dataStale,
  };

  /* -------- 九个步骤，每步：问题 / 答案 / 证据 / 置信度 -------- */
  const steps = [];

  // ① 数据
  const bars = (a.bars || []).length;
  steps.push({
    step: 1,
    name: '数据可信度',
    question: '数据够用吗？新鲜吗？',
    answer: bars >= 200 ? `可用（${bars} 根）` : `偏少（${bars} 根）`,
    evidence: { bars, stale: !!opts.dataStale, source: opts.source || '-' },
    confidence: opts.dataStale ? 'low' : bars >= 200 ? 'high' : 'medium',
    advice: opts.dataStale ? '先刷新数据' : bars < 200 ? '增加历史数据再判断' : '',
  });

  // ② 划分可靠度
  const diverge = audit.styleDivergence || 0;
  steps.push({
    step: 2,
    name: '划分可靠度',
    question: '这套笔是怎么画出来的？换个标准会变吗？',
    answer: `使用「${audit.style === 'old' ? '老笔（108课早期定义）' : '新笔（2007-09 博文修订）'}」：${audit.biCount?.active ?? '-'} 笔`,
    evidence: {
      style: audit.style,
      oldBi: audit.biCount?.old,
      newBi: audit.biCount?.new,
      divergencePct: diverge,
      fractals: audit.fractals,
      fractalGaps: audit.fractalGaps,
      biDensityPer100: audit.biDensityPer100,
    },
    confidence: diverge >= 15 ? 'low' : diverge >= 8 ? 'medium' : 'high',
    advice: diverge >= 10 ? `两种标准差 ${diverge}%，跨软件对照前先统一标准` : '',
  });

  // ③ 结构
  const lastPivot = (a.pivots || []).slice(-1)[0];
  steps.push({
    step: 3,
    name: '结构识别',
    question: '现在是什么结构？',
    answer: `${audit.biCount?.active ?? 0} 笔 · ${a.segments?.length ?? 0} 线段 · ${(a.pivots || []).length} 中枢 · ${a.trend?.type || '-'}`,
    evidence: {
      trend: a.trend,
      lastPivot: lastPivot ? { zd: +lastPivot.zd.toFixed(4), zg: +lastPivot.zg.toFixed(4), count: lastPivot.count, dd: +lastPivot.dd.toFixed(4), gg: +lastPivot.gg.toFixed(4) } : null,
      position: a.stats?.price == null || !lastPivot ? 'none' : a.stats.price > lastPivot.zg ? 'above' : a.stats.price < lastPivot.zd ? 'below' : 'inside',
    },
    confidence: (a.pivots || []).length ? 'high' : 'low',
    advice: (a.pivots || []).length ? '' : '还没有中枢，先等结构成形',
  });

  // ④ 演化
  steps.push({
    step: 4,
    name: '结构演化',
    question: '中枢在扩展、扩张还是升级？',
    answer: structure.summary,
    evidence: {
      extension: structure.extension.slice(-3),
      expansion: structure.expansion.filter((e) => e.type === 'expansion').slice(-3),
      upgrade: structure.upgrade,
    },
    confidence: 'medium',
    advice: structure.lastExpansion && structure.lastExpansion.onlyWaveOverlap
      ? '存在"仅波动重叠"的扩张，级别可能已升级，注意操作级别是否还合适'
      : '',
    caveat: structure.caveat,
  });

  // ⑤ 完美度
  steps.push({
    step: 5,
    name: '走势完美度',
    question: '这段走势走完了吗？',
    answer: flow.perfection.complete ? '已完成' : `未完成：${flow.perfection.reason}`,
    evidence: flow.perfection,
    confidence: flow.perfection.complete ? 'high' : 'medium',
    advice: flow.perfection.complete ? '' : '未完成的走势只做跟踪，不下操作结论',
  });

  // ⑥ 操作级别
  const segs = flow.decomposition.segments;
  steps.push({
    step: 6,
    name: '同级别分解',
    question: '应该按哪个级别操作？',
    answer: `${segs.length} 段走势${flow.decomposition.unique ? '（唯一）' : '（存在同向未合并）'}`,
    evidence: { segments: segs.slice(-4), unique: flow.decomposition.unique, violations: flow.decomposition.violations },
    confidence: flow.decomposition.unique ? 'high' : 'low',
    advice: flow.decomposition.unique ? '' : '分解不唯一：先按规则合并相邻同向段，再定操作级别',
  });

  // ⑦ 买卖点
  const sig = (a.signals || []).slice(-3);
  steps.push({
    step: 7,
    name: '买卖点',
    question: '有可操作的买卖点吗？',
    answer: sig.length ? `最近：${sig.map((s) => `${s.name}@${s.price}`).join('、')}` : '近期无买卖点',
    evidence: { recent: sig, beichi: (a.beichi || []).slice(-2) },
    confidence: sig.length ? 'high' : 'medium',
    advice: sig.length ? '买卖点必须配合级别与背驰一起看，不可孤立使用' : '无信号时不动',
  });

  // ⑧ 多级别共振
  if (opts.resonance) {
    const r = opts.resonance;
    steps.push({
      step: 8,
      name: '多级别区间套',
      question: '大小级别共振了吗？',
      answer: r.verdict,
      evidence: { nested: r.nested, level: r.verdictLevel, layers: (r.flat || []).map((l) => ({ period: l.period, coverage: l.coverage, signal: l.signal?.name || null, beichi: !!l.beichi })) },
      confidence: r.nested ? 'high' : 'medium',
      advice: r.nested ? '区间套成立：这是缠论里可靠度最高的信号类型' : '未共振：单级别信号可靠性下降',
    });
  }

  // ⑨ 复核
  steps.push({
    step: 9,
    name: '可复核性',
    question: '这个结论别人能复现吗？',
    answer: `笔标准=${audit.style}，中枢=${(a.pivots || []).length}，数据=${bars} 根`,
    evidence: {
      reproducible: true,
      note: '本实现全部为确定性规则，同样数据同样参数必得同样结果',
      params: { biStyle: audit.style || 'new' },
    },
    confidence: 'high',
    advice: '换人复核时只需要对齐"笔标准 + 数据区间"两项即可',
  });

  const pitfalls = PITFALLS.filter((p) => { try { return p.when(ctx); } catch (e) { return false; } }).map((p) => ({ id: p.id, text: p.text }));

  return {
    ok: true,
    steps,
    pitfalls,
    /* 一句话总览 */
    headline: `${audit.style === 'old' ? '老笔' : '新笔'} · ${(a.pivots || []).length}中枢 · ${flow.perfection.complete ? '走势已完成' : '走势未完成'}${opts.resonance && opts.resonance.nested ? ' · 区间套成立' : ''}`,
    disclaimers: [
      '缠论的分型/笔/线段/中枢均为基于规则的实现，不同软件与不同标准下结果会有差异',
      '中枢扩张后的大中枢区间业界无唯一画法，本实现只检测不合成',
      '本工具用于学习与研究，不构成投资建议',
    ],
  };
}

module.exports = { buildSystem, PITFALLS };
