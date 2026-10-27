'use strict';
/**
 * 奇门遁甲 · 时家（简盘）
 *
 * 实现的规则（均为公开通行做法）：
 *  1. 阴阳遁：冬至后阳遁、夏至后阴遁；
 *  2. 局数：节气 × 三元（上/中/下元，由日干支的符头地支决定：子午卯酉上、寅申巳亥中、辰戌丑未下）；
 *  3. 地盘三奇六仪：戊己庚辛壬癸丁丙乙，阳遁顺布、阴遁逆布，起于局数宫；
 *  4. 值符 / 值使：时干支所在旬的旬首所遁之仪 → 其地盘宫之星为值符、之门为值使；
 *  5. 天盘九星随值符：值符星飞到时干所临之宫，其余按序跟转；
 *  6. 人盘八门随值使：值使门从旬首宫按时支数飞宫（阳遁顺、阴遁逆）；
 *  7. 八神：值符起于值符宫，阳遁顺排、阴遁逆排。
 *
 * 简化声明：不做拆补/置闰法、不做暗干、不做中宫寄宫的两套流派取舍（中宫不排门星神）。
 * 打分只用于"择时结构分"，不是吉凶定论。
 */

const G = require('./ganzhi');

/** 洛书九宫（1..9）→ 宫名与方位 */
const PALACE = {
  1: { name: '坎', dir: '北', star: '天蓬', door: '休门' },
  2: { name: '坤', dir: '西南', star: '天芮', door: '死门' },
  3: { name: '震', dir: '东', star: '天冲', door: '伤门' },
  4: { name: '巽', dir: '东南', star: '天辅', door: '杜门' },
  5: { name: '中', dir: '中', star: '天禽', door: null },
  6: { name: '乾', dir: '西北', star: '天心', door: '开门' },
  7: { name: '兑', dir: '西', star: '天柱', door: '惊门' },
  8: { name: '艮', dir: '东北', star: '天任', door: '生门' },
  9: { name: '离', dir: '南', star: '天英', door: '景门' },
};
const YI_ORDER = ['戊', '己', '庚', '辛', '壬', '癸', '丁', '丙', '乙']; // 六仪三奇
const DOOR_ORDER = ['休门', '生门', '伤门', '杜门', '景门', '死门', '惊门', '开门'];
const GOD_ORDER = ['值符', '腾蛇', '太阴', '六合', '白虎', '玄武', '九地', '九天'];
const XUN_YI = { 0: '戊', 10: '己', 20: '庚', 30: '辛', 40: '壬', 50: '癸' }; // 甲子/甲戌/甲申/甲午/甲辰/甲寅 旬首所遁

/** 节气 → 三元局数 [上,中,下] */
const JU_TABLE = {
  冬至: { dun: '阳', ju: [1, 7, 4] },
  小寒: { dun: '阳', ju: [2, 8, 5] },
  大寒: { dun: '阳', ju: [3, 9, 6] },
  立春: { dun: '阳', ju: [8, 5, 2] },
  雨水: { dun: '阳', ju: [9, 6, 3] },
  惊蛰: { dun: '阳', ju: [1, 7, 4] },
  春分: { dun: '阳', ju: [3, 9, 6] },
  清明: { dun: '阳', ju: [4, 1, 7] },
  谷雨: { dun: '阳', ju: [5, 2, 8] },
  立夏: { dun: '阳', ju: [4, 1, 7] },
  小满: { dun: '阳', ju: [5, 2, 8] },
  芒种: { dun: '阳', ju: [6, 3, 9] },
  夏至: { dun: '阴', ju: [9, 3, 6] },
  小暑: { dun: '阴', ju: [8, 2, 5] },
  大暑: { dun: '阴', ju: [7, 1, 4] },
  立秋: { dun: '阴', ju: [2, 5, 8] },
  处暑: { dun: '阴', ju: [1, 4, 7] },
  白露: { dun: '阴', ju: [9, 3, 6] },
  秋分: { dun: '阴', ju: [7, 1, 4] },
  寒露: { dun: '阴', ju: [6, 9, 3] },
  霜降: { dun: '阴', ju: [5, 8, 2] },
  立冬: { dun: '阴', ju: [6, 9, 3] },
  小雪: { dun: '阴', ju: [5, 8, 2] },
  大雪: { dun: '阴', ju: [4, 7, 1] },
};

const fix9 = (n) => ((((n - 1) % 9) + 9) % 9) + 1;
const step = (from, k, dir) => fix9(from + k * dir);

/** 由日干支确定三元（0=上元 1=中元 2=下元） */
function yuanOf(dayGanzhi) {
  const idx = G.GAN.indexOf(dayGanzhi.gan) >= 0 ? dayGanzhiIndex(dayGanzhi) : 0;
  return Math.floor((idx % 15) / 5);
}
function dayGanzhiIndex(gz) {
  // 由 干、支 反推 60 甲子序号
  const gi = G.GAN.indexOf(gz.gan);
  const zi = G.ZHI.indexOf(gz.zhi);
  for (let i = 0; i < 60; i++) if (i % 10 === gi && i % 12 === zi) return i;
  return 0;
}

/** 当前节气（最近一个"节/气"） */
function currentTerm(agenda) {
  const name = agenda.terms.prev ? agenda.terms.prev.name : '冬至';
  return JU_TABLE[name] ? name : '冬至';
}

/**
 * 排盘
 * @param {Date} date 真实时间戳
 */
const RING = [1, 2, 3, 4, 6, 7, 8, 9]; // 八宫环（中宫 5 不排门/星/神，寄坤二宫）
function ringStep(from, k, dir) {
  let start = from;
  if (!RING.includes(start)) start = 2; // 5 中宫 → 寄坤
  const i = RING.indexOf(start);
  return RING[(((i + k * dir) % 8) + 8) % 8];
}

/**
 * 排盘
 * @param {Date} date 真实时间戳
 */
function chart(date) {
  const ag = G.agenda(date);
  const term = currentTerm(ag);
  const { dun, ju } = JU_TABLE[term];
  const dir = dun === '阳' ? 1 : -1;

  const dgz = ag.pillars.day;
  const yuan = yuanOf(dgz);
  const juNo = ju[yuan];

  // 地盘三奇六仪（含中宫）
  const diPan = {};
  for (let i = 0; i < 9; i++) diPan[step(juNo, i, dir)] = YI_ORDER[i];

  const hgz = ag.pillars.hour;
  const hIdx = dayGanzhiIndex(hgz);
  const xunStart = Math.floor(hIdx / 10) * 10;
  const xunYi = XUN_YI[xunStart];
  const xunPalace = Number(Object.keys(diPan).find((k) => diPan[k] === xunYi));

  // 旬首落中宫时，天禽寄坤二宫：值符取天禽、值使取坤宫死门
  const xunIsCenter = xunPalace === 5;
  const zhiFuStar = xunIsCenter ? '天禽' : PALACE[xunPalace].star;
  const zhiShiDoor = xunIsCenter ? '死门' : PALACE[xunPalace].door;

  const hourStemPalaceRaw = Number(Object.keys(diPan).find((k) => diPan[k] === hgz.gan)) || xunPalace;
  const hourStemPalace = RING.includes(hourStemPalaceRaw) ? hourStemPalaceRaw : 2;

  // 天盘九星：值符星加时干宫，其余八星按九星序跟转（天禽寄坤，不参与飞布）
  const STAR8 = ['天蓬', '天芮', '天冲', '天辅', '天心', '天柱', '天任', '天英'];
  const fillStar = zhiFuStar === '天禽' ? '天芮' : zhiFuStar;
  const startIdx = Math.max(0, STAR8.indexOf(fillStar));
  const tianPan = {};
  for (let i = 0; i < 8; i++) tianPan[ringStep(hourStemPalace, i, dir)] = STAR8[(startIdx + i) % 8];

  // 人盘八门：值使门从（旬首宫寄坤）起，按时支数飞宫
  const hourZhiIdx = G.ZHI.indexOf(hgz.zhi);
  const doorStart = ringStep(xunPalace, hourZhiIdx, dir);
  const menPan = {};
  const doorIdx = DOOR_ORDER.indexOf(zhiShiDoor || '休门');
  for (let i = 0; i < 8; i++) menPan[ringStep(doorStart, i, dir)] = DOOR_ORDER[(doorIdx + i) % 8];

  // 八神：值符起于值符宫，阳遁顺、阴遁逆
  const shenPan = {};
  for (let i = 0; i < 8; i++) shenPan[ringStep(xunPalace, i, dir)] = GOD_ORDER[i];

  const cells = [];
  for (let p = 1; p <= 9; p++) {
    cells.push({
      palace: p,
      name: PALACE[p].name,
      dir: PALACE[p].dir,
      yi: diPan[p] || null,
      star: p === 5 ? '天禽' : tianPan[p] || null,
      door: p === 5 ? null : menPan[p] || null,
      god: p === 5 ? null : shenPan[p] || null,
      hourStem: p === hourStemPalace,
      tianqin: p === 2,
    });
  }

  return {
    term,
    dun,
    ju: juNo,
    yuan: ['上元', '中元', '下元'][yuan],
    hourGanZhi: hgz.text,
    dayGanZhi: dgz.text,
    xun: G.GAN[xunStart % 10] + G.ZHI[xunStart % 12] + '旬',
    xunYi,
    zhiFu: { star: zhiFuStar, palace: xunPalace },
    zhiShi: { door: zhiShiDoor, palace: doorStart },
    hourStemPalace,
    cells,
    layout: [4, 9, 2, 3, 5, 7, 8, 1, 6],
  };
}

/** 门/星/神 吉凶权重（用于打分） */
const DOOR_SCORE = { 开门: 12, 休门: 8, 生门: 10, 景门: 2, 杜门: -2, 伤门: -10, 惊门: -8, 死门: -12 };
const STAR_SCORE = { 天心: 6, 天任: 5, 天辅: 5, 天禽: 4, 天冲: 2, 天英: -2, 天柱: -5, 天蓬: -6, 天芮: -6 };
const GOD_SCORE = { 值符: 8, 九地: 5, 九天: 5, 太阴: 4, 六合: 3, 腾蛇: -5, 白虎: -6, 玄武: -6 };

function score(date, jitter = 0) {
  const c = chart(date);
  const cell = c.cells.find((x) => x.hourStem) || c.cells[0];
  let s = 50;
  const reasons = [
    `${c.dun}遁${c.ju}局（${c.term}·${c.yuan}），值符${c.zhiFu.star}、值使${c.zhiShi.door}`,
    `时干落${cell.name}宫（${cell.dir}）：门${cell.door || '—'}、星${cell.star}、神${cell.god || '—'}`,
  ];
  s += DOOR_SCORE[cell.door] || 0;
  s += STAR_SCORE[cell.star] || 0;
  s += GOD_SCORE[cell.god] || 0;
  s += jitter;
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons, chart: c };
}

module.exports = { chart, score, JU_TABLE, DOOR_SCORE, STAR_SCORE, GOD_SCORE };
