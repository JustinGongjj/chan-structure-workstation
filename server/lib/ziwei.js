'use strict';
/**
 * 紫微斗数排盘（本命盘 / 当日盘）
 *
 * 规则来源：传统安星诀，并用 iztro（MIT）公开实现中的公式交叉核对：
 *  - 命宫：寅起正月顺数至生月，再逆数生时；身宫：顺数生时
 *  - 命宫天干：五虎遁（甲己丙寅、乙庚戊寅、丙辛庚寅、丁壬壬寅、戊癸甲寅）
 *  - 五行局：纳音巧记（干数＋支数，过五减五；木1金2水3火4土5）
 *  - 紫微星：起紫微星诀（局数除日数，商数宫前走；奇偶定进退）
 *  - 天府星：与紫微相对；紫微诸星逆行、天府诸星顺行
 *  - 四化：南派口诀（甲廉破武阳…癸破巨阴贪）
 *
 * 简化声明：不做大限/流年四化、不再安辅曜（左辅右弼文昌文曲等）——四化若落在未安放的
 * 星曜上会以"未安此星"标注。这套盘用于**结构化择时打分**，不是命理定论。
 */

const L = require('./lunar');
const G = require('./ganzhi');

const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const PALACE_NAMES = ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '仆役', '官禄', '田宅', '福德', '父母'];

/** 寅宫（index 0）天干：五虎遁 */
const TIGER = { 甲: 2, 己: 2, 乙: 4, 庚: 4, 丙: 6, 辛: 6, 丁: 8, 壬: 8, 戊: 0, 癸: 0 };

/** 四化（南派） */
const SIHUA = {
  甲: { 禄: '廉贞', 权: '破军', 科: '武曲', 忌: '太阳' },
  乙: { 禄: '天机', 权: '天梁', 科: '紫微', 忌: '太阴' },
  丙: { 禄: '天同', 权: '天机', 科: '文昌', 忌: '廉贞' },
  丁: { 禄: '太阴', 权: '天同', 科: '天机', 忌: '巨门' },
  戊: { 禄: '贪狼', 权: '太阴', 科: '右弼', 忌: '天机' },
  己: { 禄: '武曲', 权: '贪狼', 科: '天梁', 忌: '文曲' },
  庚: { 禄: '太阳', 权: '武曲', 科: '太阴', 忌: '天同' },
  辛: { 禄: '巨门', 权: '太阳', 科: '文曲', 忌: '文昌' },
  壬: { 禄: '天梁', 权: '紫微', 科: '左辅', 忌: '武曲' },
  癸: { 禄: '破军', 权: '巨门', 科: '太阴', 忌: '贪狼' },
};

const ZIWEI_GROUP = ['紫微', '天机', '', '太阳', '武曲', '天同', '', '', '廉贞'];
const TIANFU_GROUP = ['天府', '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '', '', '', '破军'];

const fix12 = (n) => ((n % 12) + 12) % 12;
const fix10 = (n) => ((n % 10) + 10) % 10;

/** 纳音巧记 → 五行局 */
function fiveElementsClass(stem, branch) {
  const hs = Math.floor(STEMS.indexOf(stem) / 2) + 1;
  const eb = Math.floor((BRANCHES.indexOf(branch) % 6) / 2) + 1;
  let sum = hs + eb;
  while (sum > 5) sum -= 5;
  return ['木三局', '金四局', '水二局', '火六局', '土五局'][sum - 1];
}

const CLASS_N = { 水二局: 2, 木三局: 3, 金四局: 4, 土五局: 5, 火六局: 6 };

/**
 * 起紫微星诀
 * @param {number} fiveN 局数 2..6
 * @param {number} day 农历日 1..30
 * @returns {{ziweiIndex:number, tianfuIndex:number, steps:number}}
 */
function ziweiIndex(fiveN, day) {
  let offset = 0;
  while ((day + offset) % fiveN !== 0) offset++;
  const q = (day + offset) / fiveN;
  let idx = fix12(q % 12 - 1 + (offset % 2 === 0 ? offset : -offset));
  return { ziweiIndex: idx, tianfuIndex: fix12(12 - idx), steps: offset };
}

/**
 * 排盘
 * @param {Date} date 真实时间戳（北京时间）
 * @param {number} hourIndex 时辰索引 0=子 … 11=亥
 */
function chart(date, hourIndex) {
  const lunar = L.solarToLunar(date);
  const hIdx = fix12(hourIndex == null ? new Date(date.getTime() + 8 * 3600000).getUTCHours() : hourIndex);
  const yearGz = G.ganzhiOf ? null : null;
  // 年干支按农历年（春节换年）
  const idx = ((((lunar.year - 4) % 60) + 60) % 60);
  const yearStem = STEMS[idx % 10];
  const yearBranch = BRANCHES[idx % 12];

  const monthIdx = lunar.month - 1;
  const soulIndex = fix12(monthIdx - hIdx);
  const bodyIndex = fix12(monthIdx + hIdx);

  const stemStart = TIGER[yearStem];
  const soulStem = STEMS[fix10(stemStart + soulIndex)];
  const soulBranch = BRANCHES[fix12(soulIndex + 2)];

  const cls = fiveElementsClass(soulStem, soulBranch);
  const n = CLASS_N[cls];
  const dayForZiwei = lunar.day;
  const { ziweiIndex: zw, tianfuIndex: tf } = ziweiIndex(n, dayForZiwei);

  // 12 宫：index 0 = 寅
  const palaces = [];
  for (let i = 0; i < 12; i++) {
    palaces.push({
      index: i,
      branch: BRANCHES[fix12(i + 2)],
      stem: STEMS[fix10(stemStart + i)],
      name: PALACE_NAMES[fix12(soulIndex - i)], // 命宫起逆时针
      stars: [],
      isSoul: i === soulIndex,
      isBody: i === bodyIndex,
    });
  }

  ZIWEI_GROUP.forEach((s, i) => {
    if (s) palaces[fix12(zw - i)].stars.push(s);
  });
  TIANFU_GROUP.forEach((s, i) => {
    if (s) palaces[fix12(tf + i)].stars.push(s);
  });

  const hua = SIHUA[yearStem] || {};
  const huaByStar = {};
  for (const [k, v] of Object.entries(hua)) huaByStar[v] = k;

  // 命宫 / 身宫 摘要
  const soul = palaces[soulIndex];
  const body = palaces[bodyIndex];
  const soulHua = soul.stars.map((s) => huaByStar[s]).filter(Boolean);
  const bodyHua = body.stars.map((s) => huaByStar[s]).filter(Boolean);

  return {
    lunar: { year: lunar.year, month: lunar.month, day: lunar.day, isLeap: lunar.isLeap },
    yearGanZhi: yearStem + yearBranch,
    hour: { index: hIdx, branch: BRANCHES[hIdx], name: BRANCHES[hIdx] + '时' },
    soul: { index: soulIndex, branch: soulBranch, stem: soulStem, stars: soul.stars, hua: soulHua },
    body: { index: bodyIndex, branch: BRANCHES[fix12(bodyIndex + 2)], stars: body.stars, hua: bodyHua },
    fiveElements: cls,
    fiveN: n,
    ziwei: { index: zw, branch: BRANCHES[fix12(zw + 2)], tianfu: BRANCHES[fix12(tf + 2)] },
    sihua: hua,
    palaces: palaces.map((p) => ({
      ...p,
      hua: p.stars.map((s) => huaByStar[s]).filter(Boolean),
      starsHua: p.stars.map((s) => (huaByStar[s] ? `${s}化${huaByStar[s]}` : s)),
    })),
    missingHua: Object.values(hua).filter((s) => !['文昌', '文曲', '左辅', '右弼'].includes(s) && !ZIWEI_GROUP.includes(s) && !TIANFU_GROUP.includes(s)),
  };
}

/** 吉凶权重（用于择时打分，非命理定论） */
const STAR_SCORE = {
  紫微: 8, 天府: 8, 太阳: 6, 太阴: 6, 天同: 5, 天梁: 5, 天相: 5, 天机: 4, 武曲: 4, 贪狼: 1, 廉贞: -2, 巨门: -4, 七杀: -5, 破军: -6,
};
const HUA_SCORE = { 禄: 10, 权: 6, 科: 5, 忌: -12 };

/**
 * 择时打分：0-100
 * 取命宫主星、四化、身宫同宫情况；不含大限流年
 */
function score(date, hourIndex, jitter = 0) {
  const c = chart(date, hourIndex);
  const reasons = [];
  let s = 50;
  const starSum = c.soul.stars.reduce((a, x) => a + (STAR_SCORE[x] || 0), 0);
  s += starSum;
  reasons.push(`命宫在${c.soul.branch}（${c.soul.stem}${c.soul.branch}），主星：${c.soul.stars.join('、') || '无'}`);
  if (c.soul.hua.length) {
    for (const h of c.soul.hua) {
      s += HUA_SCORE[h] || 0;
      reasons.push(`命宫${h}（${c.sihua[h]}化${h}）`);
    }
  }
  if (c.body.index === c.soul.index) {
    s += 4;
    reasons.push('命身同宫，意志集中');
  } else {
    const bodyStar = c.body.stars.reduce((a, x) => a + (STAR_SCORE[x] || 0), 0);
    s += Math.round(bodyStar / 2);
    reasons.push(`身宫在${c.body.branch}：${c.body.stars.join('、') || '无主星'}`);
  }
  s += jitter;
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons, chart: c };
}

module.exports = { chart, score, fiveElementsClass, ziweiIndex, SIHUA, PALACE_NAMES, BRANCHES, STAR_SCORE };
