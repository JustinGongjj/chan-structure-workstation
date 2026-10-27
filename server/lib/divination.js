'use strict';
/**
 * 算卦择时引擎：干支历 → 梅花易数起卦 → 六爻纳甲排盘 → 期市解读
 *
 * 纯娱乐与文化向模块：所有结论仅作「择时冥想」，不构成任何投资建议。
 */

const G = require('./ganzhi');
const D = require('./gua-data');

const WX_SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }; // 我生
const WX_KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }; // 我克
const WX_BY_SHENG = { 火: '木', 土: '火', 金: '土', 水: '金', 木: '水' }; // 生我
const WX_BY_KE = { 土: '木', 水: '土', 火: '水', 金: '火', 木: '金' }; // 克我

function trigramByNum(n) {
  const i = ((n - 1) % 8 + 8) % 8;
  return D.TRIGRAMS[i];
}
function trigramByName(name) {
  return D.TRIGRAMS.find((t) => t.name === name) || D.TRIGRAMS[0];
}
function trigramByLines(lines) {
  const key = lines.join('');
  return D.TRIGRAMS.find((t) => t.lines.join('') === key) || D.TRIGRAMS[0];
}
function findHex(upper, lower) {
  return D.HEXAGRAMS.find((h) => h.upper === upper && h.lower === lower) || D.HEXAGRAMS[0];
}
function hexLines(hex) {
  const u = trigramByName(hex.upper);
  const l = trigramByName(hex.lower);
  return [...l.lines, ...u.lines]; // 自下而上 6 爻
}
function hexFromLines(lines) {
  const lower = trigramByLines(lines.slice(0, 3));
  const upper = trigramByLines(lines.slice(3, 6));
  return findHex(upper.name, lower.name);
}

function relation(selfEl, otherEl) {
  if (selfEl === otherEl) return { key: 'same', text: '比和', level: '平', score: 0.5 };
  if (WX_SHENG[selfEl] === otherEl) return { key: 'selfSheng', text: `体（${selfEl}）生用（${otherEl}）`, level: '泄', score: 0.35 };
  if (WX_SHENG[otherEl] === selfEl) return { key: 'otherSheng', text: `用（${otherEl}）生体（${selfEl}）`, level: '吉', score: 0.8 };
  if (WX_KE[selfEl] === otherEl) return { key: 'selfKe', text: `体（${selfEl}）克用（${otherEl}）`, level: '吉', score: 0.7 };
  if (WX_KE[otherEl] === selfEl) return { key: 'otherKe', text: `用（${otherEl}）克体（${selfEl}）`, level: '凶', score: 0.2 };
  return { key: 'unknown', text: '关系未定', level: '平', score: 0.5 };
}

const JIANCHU_ADVICE = {
  建: { good: ['开市', '试仓'], bad: ['重仓'], note: '万物始建，宜小仓试探，忌一次压满' },
  除: { good: ['止损', '换股', '调仓'], bad: ['追涨'], note: '除旧布新，适合清掉走坏的仓位' },
  满: { good: ['减仓', '止盈'], bad: ['加仓'], note: '圆满则溢，宜落袋为安' },
  平: { good: ['观察', '复盘'], bad: ['开新仓'], note: '平常之日，行情多为无序震荡，守拙为上' },
  定: { good: ['定投', '持仓'], bad: ['频繁交易'], note: '宜定不宜动，让仓位安静待着' },
  执: { good: ['持有'], bad: ['割肉'], note: '执持之日，趋势仓位宜守，不必被日内波动惊出' },
  破: { good: ['空仓', '休息'], bad: ['开仓', '加杠杆'], note: '破日易生意外，最好不交易' },
  危: { good: ['观望', '风控'], bad: ['追高', '抄底'], note: '危日多陷阱，等结构走完再说' },
  成: { good: ['建仓', '加仓'], bad: ['犹豫'], note: '成日利于成事，结构确认后可果断' },
  收: { good: ['收线', '减仓'], bad: ['追单'], note: '收日宜收不宜放，逐步落袋' },
  开: { good: ['新开仓', '布局'], bad: ['满仓'], note: '开日适合开新方向，但留足后手' },
  闭: { good: ['空仓', '学习', '等信号'], bad: ['开仓'], note: '闭日主闭塞，交易信号易失真' },
};

const LIUQIN_TRADE = {
  妻财: '妻财持世/发动：主财利与盈亏线，财动则仓位变，宜算清赔率再动',
  官鬼: '官鬼主压力与主力：官鬼发动多为消息面冲击或主力洗盘，忌勉强追单',
  子孙: '子孙为福神：子孙旺相多助，适合持有与等待，忌被短线噪音打乱',
  父母: '父母主文书消息：父母发动提示消息面驱动，宜先核事实再做决定',
  兄弟: '兄弟主劫财竞争：兄弟发动多为震荡消耗，宜减频、缩仓、看结构',
};

function liuQin(gongEl, yaoEl) {
  if (yaoEl === gongEl) return '兄弟';
  if (WX_BY_SHENG[gongEl] === yaoEl) return '父母'; // 生我者父母
  if (WX_SHENG[gongEl] === yaoEl) return '子孙'; // 我生者子孙
  if (WX_BY_KE[gongEl] === yaoEl) return '官鬼'; // 克我者官鬼
  if (WX_KE[gongEl] === yaoEl) return '妻财'; // 我克者妻财
  return '兄弟';
}

const LIUSHEN_QIDIAN = { 甲: 0, 乙: 0, 丙: 1, 丁: 1, 戊: 2, 己: 3, 庚: 4, 辛: 4, 壬: 5, 癸: 5 };

function palaceOf(hexName) {
  for (const [palace, list] of Object.entries(D.PALACES)) {
    const i = list.indexOf(hexName);
    if (i >= 0) return { palace, index: i };
  }
  return { palace: '乾', index: 0 };
}

/** FNV-1a 32 位哈希：让标的代码真正参与起卦（数字/字母代码都能区分，且不会撞卦） */
function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function fmtP(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(1);
  if (Math.abs(n) >= 10) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(3);
  return n.toFixed(5);
}

/**
 * 起卦取数（梅花易数的「以时起卦 + 以数起卦」通用化）
 *  - mode='price'（默认，随市）：四柱支序 + 标的哈希 + 现价分桶 + 涨跌基点 + 占次
 *      → 同标的重复点击必变；价格变动到 0.05% 档位也会变卦
 *  - mode='time'（稳定）：四柱支序 + 标的哈希 → 同一时辰内同一标的固定一卦
 */
function castSeed({ market, code, pillars, price, pct, nonce = 0, mode = 'price' }) {
  const n = (z) => G.ZHI.indexOf(z) + 1;
  const yz = n(pillars.year.zhi);
  const mz = n(pillars.month.zhi);
  const dz = n(pillars.day.zhi);
  const hz = n(pillars.hour.zhi);
  const symbolKey = `${market || 'A'}:${String(code || '').toUpperCase()}`;
  const symHash = hash32(symbolKey);
  const hasPrice = Number.isFinite(price) && price > 0;
  // 价格按「量级 1%」分档：茅台约 10 元一档、BTC 约 100 一档，避免每个 tick 都跳卦
  const priceStep = hasPrice ? Math.pow(10, Math.floor(Math.log10(price)) - 2) : 1;
  const priceBucket = hasPrice ? Math.round(price / priceStep) : 0;
  const pctBp = Number.isFinite(pct) ? Math.round(pct * 100) : 0;
  const timeSum = yz + mz + dz + hz;

  // 摇卦数：标的 + 现价档 + 涨跌 + 时辰 + 占次 一次性混合，保证「换标的必换卦、再起必换卦」
  const seedStr =
    mode === 'time'
      ? `${symbolKey}|${timeSum}`
      : `${symbolKey}|${priceBucket}|${pctBp}|${timeSum}|${nonce}`;
  const R = hash32(seedStr);

  const up = (timeSum + (R % 97)) % 8 || 8;
  const down = (timeSum + ((R >>> 8) % 89) + hz) % 8 || 8;
  const dong = (timeSum + ((R >>> 16) % 7)) % 6 || 6;

  const parts = [
    { label: '四柱支序', value: timeSum, detail: `${pillars.year.zhi}${pillars.month.zhi}${pillars.day.zhi}${pillars.hour.zhi}` },
    { label: '标的哈希', value: symHash % 1000000, detail: symbolKey },
    { label: '摇卦数', value: R % 1000000, detail: seedStr },
  ];
  if (mode !== 'time') {
    parts.push(
      {
        label: '价格档',
        value: priceBucket,
        detail: hasPrice ? `${fmtP(price)}，换档区间 ${fmtP((priceBucket - 0.5) * priceStep)} ~ ${fmtP((priceBucket + 0.5) * priceStep)}` : '未取到实时价',
      },
      { label: '涨跌基点', value: pctBp, detail: Number.isFinite(pct) ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '—' },
      { label: '占次', value: nonce, detail: `第 ${nonce + 1} 次起卦` }
    );
  }

  return {
    upperNum: up,
    lowerNum: down,
    dong,
    parts,
    mode,
    symbolHash: symHash,
    symbolKey,
    priceBucket,
    priceStep,
    bucketLow: hasPrice ? (priceBucket - 0.5) * priceStep : null,
    bucketHigh: hasPrice ? (priceBucket + 0.5) * priceStep : null,
    pctBp,
    nonce,
    timeSum,
    shakeNo: R,
    seedStr,
  };
}

function buildChart({ upper, lower, dong, dayG }) {
  const ben = findHex(upper.name, lower.name);
  const lines = hexLines(ben);
  // 互卦：二三四爻为下卦，三四五爻为上卦
  const hu = hexFromLines([lines[1], lines[2], lines[3], lines[2], lines[3], lines[4]]);
  // 变卦：动爻阴阳互变
  const changedLines = lines.slice();
  changedLines[dong - 1] = changedLines[dong - 1] === 1 ? 0 : 1;
  const bian = hexFromLines(changedLines);
  // 体用：动爻所在之卦为用
  const useIsLower = dong <= 3;
  const tiTri = useIsLower ? upper : lower;
  const yongTri = useIsLower ? lower : upper;
  const rel = relation(tiTri.element, yongTri.element);
  return { ben, hu, bian, lines, changedLines, dong, useIsLower, tiTri, yongTri, rel };
}

function liuYaoChart(hex, { dong, dayG, kong }) {
  const { palace, index } = palaceOf(hex.name);
  const gongEl = D.PALACE_ELEMENT[palace];
  const upperT = trigramByName(hex.upper);
  const lowerT = trigramByName(hex.lower);
  const nj = D.NAJIA;
  const upperNa = nj[upperT.name];
  const lowerNa = nj[lowerT.name];
  const shi = D.SHI_YING[index];
  const ying = shi > 3 ? shi - 3 : shi + 3;
  const shenStart = LIUSHEN_QIDIAN[dayG.gan] ?? 0;
  const yaos = [];
  for (let i = 0; i < 6; i++) {
    const isLower = i < 3;
    const zhi = isLower ? lowerNa.inner[i] : upperNa.outer[i - 3];
    const el = G.ZHI_WUXING[zhi];
    const pos = i + 1;
    yaos.push({
      pos,
      yin: hexLines(hex)[i] === 1 ? '阳' : '阴',
      zhi,
      element: el,
      liuqin: liuQin(gongEl, el),
      liushen: D.LIU_SHEN[(shenStart + i) % 6],
      shi: pos === shi,
      ying: pos === ying,
      dong: pos === dong,
      kong: kong.includes(zhi),
    });
  }
  yaos.sort((a, b) => b.pos - a.pos); // 上爻在前，便于阅读
  return { palace, gongEl, shi, ying, yaos };
}

function analyze({ symbol, market, code, name, ts, method, price, pct, nonce = 0, mode } = {}) {
  const whenMs = Number(ts);
  const when = Number.isFinite(whenMs) && whenMs > 0 ? new Date(whenMs) : new Date();
  const ag = G.agenda(when);
  const m = mode || (method === 'time' ? 'time' : 'price');
  const targetCode = code || symbol || '';
  const nums = castSeed({
    market: market || 'A',
    code: targetCode,
    pillars: ag.pillars,
    price,
    pct,
    nonce: Math.max(0, Math.trunc(Number(nonce) || 0)),
    mode: m,
  });
  const upper = trigramByNum(nums.upperNum);
  const lower = trigramByNum(nums.lowerNum);
  const chart = buildChart({ upper, lower, dong: nums.dong, dayG: ag.pillars.day });
  const ly = liuYaoChart(chart.ben, { dong: nums.dong, dayG: ag.pillars.day, kong: ag.kong });
  const lyBian = liuYaoChart(chart.bian, { dong: -1, dayG: ag.pillars.day, kong: ag.kong });
  const dongYao = ly.yaos.find((y) => y.dong) || null;
  const advice = JIANCHU_ADVICE[ag.jianchu] || JIANCHU_ADVICE.平;

  // 体用解读
  const rel = chart.rel;
  const tiEl = chart.tiTri.element;
  const yongEl = chart.yongTri.element;
  const score = Math.round(
    (rel.score * 0.5 +
      (chart.ben.id ? 0.5 : 0.5) * 0.1 +
      (dongYao && dongYao.liuqin === '妻财' ? 0.85 : 0.5) * 0.2 +
      (dongYao && dongYao.liuqin === '子孙' ? 0.75 : 0.5) * 0.1 +
      (dongYao && dongYao.liuqin === '官鬼' ? 0.3 : 0.5) * 0.1) *
      100
  );

  const shichenAdvice = ag.shichen.map((s) => {
    const r2 = relation(tiEl, s.wuxing);
    return {
      ...s,
      relation: r2.text,
      label: r2.level,
      score: r2.score,
      hint:
        r2.level === '吉'
          ? '顺体之时的窗口，宜处理既定计划'
          : r2.level === '凶'
          ? '逆体之时，少动多看'
          : r2.level === '泄'
          ? '泄体之时，容易手痒，慎开新仓'
          : '比和之时，结构没走完就等',
    };
  });

  const narrative = [];
  const basisTitle =
    m === 'time'
      ? `以四柱支序＋标的哈希起卦（${nums.symbolKey}，${ag.pillars.day.text}日${ag.pillars.hour.name}）`
      : `以四柱支序＋标的哈希＋现价起卦（${nums.symbolKey}${Number.isFinite(price) && price > 0 ? `，现价 ${fmtP(price)}` : ''}${Number.isFinite(pct) ? `，${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : ''}，第 ${nums.nonce + 1} 占）`;
  narrative.push(`${basisTitle}，得上卦「${upper.name}」下卦「${lower.name}」，成卦「${chart.ben.name}」（第 ${chart.ben.id} 卦，${chart.ben.dun}）。`);
  narrative.push(`卦辞：「${chart.ben.guaCi}」。象义：${chart.ben.baiHua}`);
  narrative.push(`动爻在第 ${nums.dong} 爻（${dongYao ? dongYao.liuqin + '·' + dongYao.zhi + dongYao.element : '-'}），变卦「${chart.bian.name}」，互卦「${chart.hu.name}」——内里（互卦）与结果（变卦）合看，是「${chart.ben.trade} → ${chart.bian.trade}」的路径。`);
  narrative.push(`体卦「${chart.tiTri.name}·${tiEl}」，用卦「${chart.yongTri.name}·${yongEl}」，${rel.text}，属「${rel.level}」。${rel.level === '吉' ? '体得用助，盘中若有结构好的位置，可按计划执行。' : rel.level === '凶' ? '用克体，今日易被行情反制，仓位优先于点位。' : rel.level === '泄' ? '体生用，是花钱买教训的配置，宜小仓、短打、不恋战。' : '比和之象，多是区间震荡，宜以缠论中枢上下沿做高抛低吸。'}`);
  if (dongYao) narrative.push(`${LIUQIN_TRADE[dongYao.liuqin] || ''}（动爻六亲：${dongYao.liuqin}）。${dongYao.kong ? '动爻逢空，信号容易落空，等填实再动。' : ''}`);
  narrative.push(`今日${ag.pillars.day.text}日，建除十二神为「${ag.jianchu}」：${advice.note}。冲${ag.chong.animal}（${ag.chong.zhi}），旬空 ${ag.kong.join('、') || '无'}。`);

  return {
    ok: true,
    when: ag.beijingTime,
    weekday: ag.weekday,
    target: { symbol: targetCode, market: market || 'A', name: name || '' },
    method: m,
    methodLabel: m === 'time' ? '四柱·时辰起卦（同时辰稳定）' : '四柱·随市起卦（代码＋现价＋占次）',
    seed: {
      mode: m,
      symbolKey: nums.symbolKey,
      symbolHash: nums.symbolHash,
      priceBucket: nums.priceBucket,
      priceStep: nums.priceStep,
      bucketLow: nums.bucketLow,
      bucketHigh: nums.bucketHigh,
      pctBp: nums.pctBp,
      nonce: nums.nonce,
      timeSum: nums.timeSum,
      parts: nums.parts,
      shakeNo: nums.shakeNo,
      seedStr: nums.seedStr,
    },
    quote: {
      price: Number.isFinite(price) && price > 0 ? price : null,
      pct: Number.isFinite(pct) ? pct : null,
      name: name || '',
    },
    basisText: nums.parts.map((x) => `${x.label} ${x.value}`).join(' · '),
    pillars: ag.pillars,
    jianchu: ag.jianchu,
    chong: ag.chong,
    kong: ag.kong,
    terms: ag.terms,
    hexagram: {
      ben: { ...chart.ben },
      hu: { ...chart.hu },
      bian: { ...chart.bian },
      upper: { name: upper.name, element: upper.element, nature: upper.nature, lines: upper.lines },
      lower: { name: lower.name, element: lower.element, nature: lower.nature, lines: lower.lines },
      lines: chart.lines,
      dong: nums.dong,
      ti: { name: chart.tiTri.name, element: tiEl, nature: chart.tiTri.nature },
      yong: { name: chart.yongTri.name, element: yongEl, nature: chart.yongTri.nature },
      relation: rel,
      score,
    },
    liuyao: ly,
    liuyaoChanged: lyBian,
    dongYao,
    shichen: shichenAdvice,
    narrative,
    advice: { tip: advice.note, good: advice.good, bad: advice.bad },
    disclaimer: '本模块为传统文化娱乐，起卦结果不构成任何投资建议，也不可用于实盘决策依据。',
  };
}

/** 今日黄历简报（首页 / 算卦页头部使用） */
function daily() {
  const ag = G.agenda(new Date());
  const advice = JIANCHU_ADVICE[ag.jianchu] || JIANCHU_ADVICE.平;
  return {
    ...ag,
    advice: { tip: advice.note, good: advice.good, bad: advice.bad },
    disclaimer: '传统文化娱乐，不构成投资建议。',
  };
}

module.exports = { analyze, daily, castSeed, hash32, buildChart, liuYaoChart, relation, trigramByNum };
