'use strict';
/**
 * 择时方法实验室
 *
 * 设计原则（重要）：
 *  1. 每个方法只输出 0-100 的「顺逆分」+ 可读理由，**不做买卖结论**；
 *  2. 标的对分数的影响来自确定性哈希（同标的同日同分，可复现），不来自"玄学直觉"；
 *  3. 所有方法都能被 backtest.timingStats 逐日检验 —— 有本事就用数据证明，没本事就诚实说没有；
 *  4. 组合分（composite）只是加权平均 + 一致性，不代表统计显著的胜率。
 */

const G = require('./ganzhi');
const V = require('./divination');
const ZW = require('./ziwei');
const QM = require('./qimen');
const { hash32 } = require('./divination');

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, Math.round(v)));

/** 方法注册表：权重可在 /api/timing?weights=... 覆盖 */
const METHODS = [
  {
    id: 'ganzhi',
    name: '四柱·节气五行',
    school: '干支历法',
    weight: 0.2,
    desc: '以当日四柱与月令五行的生克、节气过渡期的稳定性打分',
  },
  {
    id: 'meihua',
    name: '梅花易数',
    school: '卦象',
    weight: 0.25,
    desc: '以四柱支序＋标的哈希起卦，按体用生克与卦象吉凶打分',
  },
  {
    id: 'liuyao',
    name: '六爻纳甲',
    school: '卦象',
    weight: 0.2,
    desc: '看动爻六亲、世应、空亡与六神，给出当日进退分',
  },
  {
    id: 'jianchu',
    name: '建除十二神',
    school: '黄历',
    weight: 0.15,
    desc: '按建除值日（建/除/满/平/定/执/破/危/成/收/开/闭）打分',
  },
  {
    id: 'cycle',
    name: '日历周期因子',
    school: '量化',
    weight: 0.2,
    desc: '节气窗口、月初月末、周内效应等可回测的日历因子（作为对照组）',
  },
  {
    id: 'ziwei',
    name: '紫微斗数·流日',
    school: '星曜',
    weight: 0.15,
    desc: '以当日农历排紫微命盘（十二宫＋十四主星＋四化），按命宫主星与四化打分',
  },
  {
    id: 'qimen',
    name: '奇门遁甲·时家',
    school: '历法',
    weight: 0.15,
    desc: '按节气三元起阴阳遁局数，排地盘三奇六仪、天盘九星、八门八神，取时干宫打分',
  },
];

const JIANCHU_SCORE = {
  建: 52, 除: 54, 满: 46, 平: 49, 定: 56, 执: 53,
  破: 26, 危: 34, 成: 70, 收: 52, 开: 64, 闭: 30,
};

const WX_SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const WX_KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

function methodById(id) {
  return METHODS.find((m) => m.id === id) || null;
}

/** 标的哈希抖动：确定性、可复现，幅度 ±5 分，避免所有标的同分 */
function symbolJitter(market, code, salt = '') {
  const h = hash32(`${market || 'A'}:${String(code || '').toUpperCase()}|${salt}`);
  return (h % 11) - 5;
}

/* ------------------------------------------------------------------ */
/* 各方法打分                                                          */
/* ------------------------------------------------------------------ */

function scoreGanzhi(ctx) {
  const p = ctx.agenda.pillars;
  const dayEl = p.day.wuxing; // 如 "水金"
  const monthEl = p.month.wuxing;
  const dayGanEl = dayEl[0];
  const dayZhiEl = dayEl[1];
  const monthGanEl = monthEl[0];
  const monthZhiEl = monthEl[1];
  const reasons = [];
  let score = 50;

  // 日支 vs 月令：相生为顺，相克为逆
  if (WX_SHENG[dayZhiEl] === monthZhiEl) {
    score += 10;
    reasons.push(`日支${dayZhiEl}生月令${monthZhiEl}，气势顺`);
  } else if (WX_SHENG[monthZhiEl] === dayZhiEl) {
    score += 6;
    reasons.push(`月令${monthZhiEl}生日支${dayZhiEl}，有外援`);
  } else if (WX_KE[dayZhiEl] === monthZhiEl) {
    score -= 10;
    reasons.push(`日支${dayZhiEl}克月令${monthZhiEl}，易犯冲`);
  } else if (WX_KE[monthZhiEl] === dayZhiEl) {
    score -= 12;
    reasons.push(`月令${monthZhiEl}克日支${dayZhiEl}，受制`);
  } else {
    reasons.push(`日支与月令${dayZhiEl === monthZhiEl ? '比和' : '无直接生克'}，中性`);
  }

  // 节气过渡期（±1 天）不确定性高
  const toTerm = ctx.agenda.terms.next ? ctx.agenda.terms.next.daysTo : null;
  const fromTerm = ctx.agenda.terms.prev ? ctx.agenda.terms.prev.daysAgo : null;
  if (toTerm != null && toTerm <= 1) {
    score -= 9;
    reasons.push(`距${ctx.agenda.terms.next.name}仅 ${toTerm} 天，节气换月窗口，结构易断`);
  } else if (fromTerm != null && fromTerm <= 1) {
    score += 4;
    reasons.push(`${ctx.agenda.terms.prev.name}刚过 ${fromTerm} 天，月令已定`);
  }

  score += symbolJitter(ctx.market, ctx.code, 'ganzhi');
  return { score: clamp(score), reasons };
}

function scoreMeihua(ctx) {
  const r = V.analyze({ market: ctx.market, code: ctx.code, mode: 'time', ts: ctx.ts });
  const rel = r.hexagram.relation;
  const reasons = [
    `本卦「${r.hexagram.ben.name}」动第 ${r.hexagram.dong} 爻，变「${r.hexagram.bian.name}」`,
    `${r.hexagram.ti.name}(${r.hexagram.ti.element}) 与 ${r.hexagram.yong.name}(${r.hexagram.yong.element})：${rel.text}（${rel.level}）`,
  ];
  let score = r.hexagram.score;
  if (rel.key === 'otherKe') reasons.push('用克体，今日不宜强攻');
  if (rel.key === 'otherSheng') reasons.push('用生体，有外部助力');
  return { score: clamp(score), reasons, detail: { ben: r.hexagram.ben.name, bian: r.hexagram.bian.name, dong: r.hexagram.dong } };
}

function scoreLiuyao(ctx) {
  const r = V.analyze({ market: ctx.market, code: ctx.code, mode: 'time', ts: ctx.ts });
  const ly = r.liuyao;
  const dong = ly.yaos.find((y) => y.dong);
  const reasons = [`${ly.palace}宫·${ly.gongEl}，世${ly.shi}应${ly.ying}`];
  let score = 50;
  const LQ = { 妻财: 14, 子孙: 12, 父母: -4, 兄弟: -8, 官鬼: -12 };
  if (dong) {
    score += LQ[dong.liuqin] || 0;
    reasons.push(`动爻第 ${dong.pos} 爻：${dong.liuqin}（${dong.zhi}${dong.element}），${dong.kong ? '逢空' : '不空'}`);
    if (dong.kong) {
      score -= 6;
      reasons.push('动爻逢空，信号易落空');
    }
    const LS = { 青龙: 4, 白虎: -4, 玄武: -3, 朱雀: -2, 勾陈: -1, 螣蛇: -1 };
    score += LS[dong.liushen] || 0;
    reasons.push(`六神：${dong.liushen}`);
  }
  const shi = ly.yaos.find((y) => y.shi);
  const ying = ly.yaos.find((y) => y.ying);
  if (shi && ying) {
    if (yinSheng(ying.element, shi.element)) {
      score += 3;
      reasons.push('应生世，外部条件配合');
    } else if (yinSheng(shi.element, ying.element)) {
      score -= 2;
      reasons.push('世生应，自身耗力');
    }
  }
  score += symbolJitter(ctx.market, ctx.code, 'liuyao');
  return { score: clamp(score), reasons, detail: { palace: ly.palace, dong: dong ? dong.liuqin : null } };
}

function yinSheng(a, b) {
  return WX_SHENG[a] === b; // a 生 b
}

function scoreJianchu(ctx) {
  const jc = ctx.agenda.jianchu;
  const base = JIANCHU_SCORE[jc] != null ? JIANCHU_SCORE[jc] : 50;
  const reasons = [`建除值日：${jc}`, jcNote(jc)];
  return { score: clamp(base + symbolJitter(ctx.market, ctx.code, 'jianchu') / 2), reasons, detail: { jianchu: jc } };
}

function jcNote(jc) {
  const map = {
    建: '万物始建，宜小仓试探',
    除: '除旧布新，宜调仓',
    满: '圆满则溢，宜减不宜加',
    平: '平常之日，多为无序震荡',
    定: '宜定不宜动',
    执: '宜守持仓',
    破: '易生意外，最好不交易',
    危: '多陷阱，等结构走完',
    成: '利于成事，结构确认可执行',
    收: '宜收不宜放',
    开: '适合开新方向，留后手',
    闭: '主闭塞，信号易失真',
  };
  return map[jc] || '';
}

function scoreCycle(ctx) {
  const d = new Date(ctx.ts);
  const dow = new Date(d.getTime() + 8 * 3600000).getUTCDay(); // 0=周日
  const p = ctx.agenda.pillars;
  let score = 50;
  const reasons = [];
  const toTerm = ctx.agenda.terms.next ? ctx.agenda.terms.next.daysTo : null;
  const fromTerm = ctx.agenda.terms.prev ? ctx.agenda.terms.prev.daysAgo : null;
  if (toTerm != null && toTerm <= 2) {
    score -= 6;
    reasons.push(`距下一节气 ${toTerm} 天，换月窗口波动放大`);
  }
  if (fromTerm != null && fromTerm <= 2) {
    score += 3;
    reasons.push(`节气后 ${fromTerm} 天，方向常延续`);
  }
  if (dow === 1) {
    score -= 2;
    reasons.push('周一，隔夜跳空风险偏高');
  } else if (dow === 5) {
    score += 1;
    reasons.push('周五，持仓过周末需控风险');
  }
  // 月相：农历日近似用朔望周期（只在研究层面使用，标注为近似）
  const phase = ((ctx.ts / 86400000 + 8) % 29.53) / 29.53;
  if (phase < 0.05 || phase > 0.95) {
    score -= 3;
    reasons.push('朔日附近（近似），历史上波动略高');
  }
  reasons.push(`四柱 ${p.year.text} ${p.month.text} ${p.day.text}，周${'日一二三四五六'[dow]}`);
  score += symbolJitter(ctx.market, ctx.code, 'cycle') / 2;
  return { score: clamp(score), reasons };
}

function scoreZiwei(ctx) {
  const d = new Date(ctx.ts + 8 * 3600000);
  const hourIdx = Math.floor((((d.getUTCHours() + 1) % 24) / 2));
  const r = ZW.score(new Date(ctx.ts), hourIdx, symbolJitter(ctx.market, ctx.code, 'ziwei'));
  const c = r.chart;
  return {
    score: clamp(r.score),
    reasons: r.reasons,
    detail: {
      lunar: `${c.lunar.year}年${c.lunar.isLeap ? '闰' : ''}${c.lunar.month}月${c.lunar.day}日`,
      hour: c.hour.name,
      soul: { branch: c.soul.branch, stem: c.soul.stem, stars: c.soul.stars, hua: c.soul.hua },
      body: { branch: c.body.branch, stars: c.body.stars },
      fiveElements: c.fiveElements,
      ziwei: c.ziwei.branch,
      palaces: c.palaces.map((p) => ({ name: p.name, stem: p.stem, branch: p.branch, stars: p.starsHua })),
      sihua: c.sihua,
    },
  };
}

function scoreQimen(ctx) {
  const r = QM.score(new Date(ctx.ts), symbolJitter(ctx.market, ctx.code, 'qimen'));
  const c = r.chart;
  return {
    score: clamp(r.score),
    reasons: r.reasons,
    detail: {
      dun: c.dun,
      ju: c.ju,
      term: c.term,
      yuan: c.yuan,
      xun: c.xun,
      zhiFu: c.zhiFu,
      zhiShi: c.zhiShi,
      cells: c.cells.map((x) => ({ palace: x.palace, name: x.name, dir: x.dir, yi: x.yi, star: x.star, door: x.door, god: x.god, hourStem: x.hourStem })),
      layout: c.layout,
    },
  };
}

const SCORERS = { ganzhi: scoreGanzhi, meihua: scoreMeihua, liuyao: scoreLiuyao, jianchu: scoreJianchu, cycle: scoreCycle, ziwei: scoreZiwei, qimen: scoreQimen };

function labelOf(score) {
  if (score >= 68) return '顺';
  if (score >= 58) return '偏顺';
  if (score > 42) return '中性';
  if (score > 32) return '偏逆';
  return '逆';
}

/**
 * 综合评估
 * @param {Object} o { market, code, ts=Date.now(), methods?:string[], weights?:{} }
 */
function evaluate(o = {}) {
  const ts = Number.isFinite(o.ts) && o.ts > 0 ? o.ts : Date.now();
  const market = (o.market || 'A').toUpperCase();
  const code = o.code || '';
  const ids = Array.isArray(o.methods) && o.methods.length ? o.methods.filter((x) => SCORERS[x]) : METHODS.map((m) => m.id);
  const ctx = { ts, market, code, agenda: G.agenda(new Date(ts)) };
  const weights = { ...Object.fromEntries(METHODS.map((m) => [m.id, m.weight])), ...(o.weights || {}) };

  const methods = {};
  let wsum = 0;
  let acc = 0;
  for (const id of ids) {
    const meta = methodById(id);
    const r = SCORERS[id](ctx);
    methods[id] = {
      id,
      name: meta.name,
      school: meta.school,
      desc: meta.desc,
      weight: weights[id] || 0,
      score: r.score,
      label: labelOf(r.score),
      reasons: r.reasons,
      detail: r.detail || null,
    };
    if (weights[id] > 0) {
      acc += r.score * weights[id];
      wsum += weights[id];
    }
  }
  const composite = wsum > 0 ? +(acc / wsum).toFixed(1) : 0;
  const scores = Object.values(methods).map((m) => m.score);
  const above = scores.filter((s) => s > 50).length;
  const below = scores.filter((s) => s < 50).length;
  const agreement = scores.length ? +(Math.max(above, below) / scores.length).toFixed(2) : 0;
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;

  return {
    ts,
    beijingTime: ctx.agenda.beijingTime,
    pillars: ctx.agenda.pillars,
    jianchu: ctx.agenda.jianchu,
    target: { market, code },
    methods,
    composite,
    label: labelOf(composite),
    agreement,
    spread,
    weights,
    verdict: buildVerdict(composite, agreement, spread, methods),
    disclaimer: '择时分数是传统历法/卦象方法的结构化表达，没有任何统计证据表明可稳定提高胜率；请把它当纪律与观察工具，不是信号源。',
  };
}

function buildVerdict(composite, agreement, spread, methods) {
  const detail = Object.values(methods)
    .sort((a, b) => b.weight * (b.score - 50) - a.weight * (a.score - 50))
    .slice(0, 2)
    .map((m) => `${m.name} ${m.score}（${m.label}）`)
    .join(' · ');
  if (agreement >= 0.8 && spread <= 25) {
    return { level: 'consistent', text: `多数方法方向一致（一致性 ${(agreement * 100).toFixed(0)}%），分差仅 ${Math.round(spread)}；越一致越可能只是日历效应，别当成信号：${detail}` };
  }
  if (spread >= 45) {
    return { level: 'conflict', text: `方法间分歧极大（${Math.round(spread)} 分），今日更适合观望或降仓位：${detail}` };
  }
  return { level: 'mixed', text: `方法间部分一致（一致性 ${(agreement * 100).toFixed(0)}%）：${detail}` };
}

module.exports = { METHODS, evaluate, labelOf, SCORERS };
