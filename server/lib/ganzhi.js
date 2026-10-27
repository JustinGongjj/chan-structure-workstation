'use strict';
/**
 * 干支历 / 节气 / 建除 / 旬空（零依赖，天文算法自洽）
 *
 * 说明：
 * - 节气用 Meeus 低精度太阳视黄经算法反解（误差约 15 分钟），用于判定年、月边界；
 * - 年柱以「立春」换年，月柱以「节」换月，日柱按儒略日推算（锚点 2000-01-01 = 戊午日）；
 * - 时辰以北京时间（UTC+8）为准，子时 23:00 起。
 */

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const GAN_WUXING = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
const ZHI_WUXING = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
};
const ZHI_ANIMAL = { 子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇', 午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪' };
const SHICHEN_NAME = ['子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时'];
const SHICHEN_RANGE = ['23:00-01:00', '01:00-03:00', '03:00-05:00', '05:00-07:00', '07:00-09:00', '09:00-11:00', '11:00-13:00', '13:00-15:00', '15:00-17:00', '17:00-19:00', '19:00-21:00', '21:00-23:00'];
const JIANCHU = ['建', '除', '满', '平', '定', '执', '破', '危', '成', '收', '开', '闭'];

// 24 节气：名字 → 太阳视黄经
const TERMS = [
  { name: '春分', lon: 0 }, { name: '清明', lon: 15 }, { name: '谷雨', lon: 30 },
  { name: '立夏', lon: 45 }, { name: '小满', lon: 60 }, { name: '芒种', lon: 75 },
  { name: '夏至', lon: 90 }, { name: '小暑', lon: 105 }, { name: '大暑', lon: 120 },
  { name: '立秋', lon: 135 }, { name: '处暑', lon: 150 }, { name: '白露', lon: 165 },
  { name: '秋分', lon: 180 }, { name: '寒露', lon: 195 }, { name: '霜降', lon: 210 },
  { name: '立冬', lon: 225 }, { name: '小雪', lon: 240 }, { name: '大雪', lon: 255 },
  { name: '冬至', lon: 270 }, { name: '小寒', lon: 285 }, { name: '大寒', lon: 300 },
  { name: '立春', lon: 315 }, { name: '雨水', lon: 330 }, { name: '惊蛰', lon: 345 },
];
// 「节」：月首边界（立春、惊蛰、清明……）
const JIE_LONS = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285];

function julianDay(date) {
  let y = date.getUTCFullYear();
  let m = date.getUTCMonth() + 1;
  const d = date.getUTCDate() + (date.getUTCHours() + date.getUTCMinutes() / 60) / 24;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

function jdToDate(jd) {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  const dayInt = Math.floor(day);
  const frac = day - dayInt;
  return new Date(Date.UTC(year, month - 1, dayInt) + Math.round(frac * 86400000));
}

/** 太阳视黄经（度，0-360） */
function sunLongitude(jd) {
  const T = (jd - 2451545.0) / 36525;
  const rad = Math.PI / 180;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * rad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M * rad) +
    0.000289 * Math.sin(3 * M * rad);
  const omega = 125.04 - 1934.136 * T;
  let lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  lambda = ((lambda % 360) + 360) % 360;
  return lambda;
}

const termCache = new Map();

/** 某公历年的 24 节气（北京时间 Date） */
function solarTerms(year) {
  if (termCache.has(year)) return termCache.get(year);
  const start = julianDay(new Date(Date.UTC(year, 0, 1) - 8 * 3600000));
  const out = [];
  for (const t of TERMS) {
    // 找到从年初起第一次经过该黄经的时刻
    let lo = start;
    let hi = start + 370;
    const at = (jd) => {
      let d = sunLongitude(jd) - t.lon;
      d = ((d + 180) % 360 + 360) % 360 - 180;
      return d; // 负数表示还没到
    };
    // 粗扫
    let found = null;
    for (let jd = lo; jd < hi; jd += 1) {
      if (at(jd) >= 0 && at(jd - 1) < 0) {
        found = [jd - 1, jd];
        break;
      }
    }
    if (!found) continue;
    let a = found[0];
    let b = found[1];
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (at(m) >= 0) b = m;
      else a = m;
    }
    const utcMs = (b - 2440587.5) * 86400000;
    out.push({ name: t.name, lon: t.lon, date: new Date(utcMs + 8 * 3600000), jie: JIE_LONS.includes(t.lon) });
  }
  out.sort((x, y) => x.date - y.date);
  termCache.set(year, out);
  return out;
}

/** 附近三年节气合并列表（按时间升序） */
function termWindow(year) {
  const list = [];
  for (const y of [year - 1, year, year + 1]) list.push(...solarTerms(y));
  return list.sort((a, b) => a.date - b.date);
}

function beijingParts(date) {
  const bj = new Date(date.getTime() + 8 * 3600000);
  return {
    y: bj.getUTCFullYear(),
    m: bj.getUTCMonth() + 1,
    d: bj.getUTCDate(),
    hh: bj.getUTCHours(),
    mm: bj.getUTCMinutes(),
    ss: bj.getUTCSeconds(),
  };
}

function ganzhiOf(index) {
  const i = ((index % 60) + 60) % 60;
  return { gan: GAN[i % 10], zhi: ZHI[i % 12], index: i, text: GAN[i % 10] + ZHI[i % 12] };
}

/** 日柱：JD(当天正午) + 49 对 60 取模（锚点 2000-01-01 戊午日） */
function dayGanzhi(date) {
  const p = beijingParts(date);
  const jd = julianDay(new Date(Date.UTC(p.y, p.m - 1, p.d, 12)));
  const idx = (Math.floor(jd + 0.5) + 49) % 60;
  return ganzhiOf(idx);
}

function yearGanzhi(date) {
  const p = beijingParts(date);
  const terms = termWindow(p.y);
  const lichun = terms.find((t) => t.name === '立春' && beijingParts(t.date).y === p.y);
  const bj = new Date(date.getTime() + 8 * 3600000);
  let y = p.y;
  if (lichun && bj < new Date(lichun.date.getTime())) y -= 1;
  return ganzhiOf(y - 4);
}

function monthGanzhi(date, yearG) {
  const p = beijingParts(date);
  const terms = termWindow(p.y);
  const bj = new Date(date.getTime() + 8 * 3600000);
  const jies = terms.filter((t) => t.jie);
  let cur = jies[0];
  for (const j of jies) if (bj >= j.date) cur = j;
  // 月支：立春→寅、惊蛰→卯 …
  const order = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285];
  const seq = order.indexOf(cur.lon); // 0=寅月
  const zhiIdx = (2 + seq) % 12;
  const yearGanIdx = GAN.indexOf(yearG.gan);
  const ganIdx = ((yearGanIdx % 5) * 2 + 2 + seq) % 10;
  return { gan: GAN[ganIdx], zhi: ZHI[zhiIdx], text: GAN[ganIdx] + ZHI[zhiIdx], jie: cur.name, jieAt: cur.date };
}

function hourGanzhi(date, dayG) {
  const p = beijingParts(date);
  const zhiIdx = Math.floor(((p.hh + 1) % 24) / 2);
  const dayGanIdx = GAN.indexOf(dayG.gan);
  const ganIdx = ((dayGanIdx % 5) * 2 + zhiIdx) % 10;
  return {
    gan: GAN[ganIdx],
    zhi: ZHI[zhiIdx],
    text: GAN[ganIdx] + ZHI[zhiIdx],
    name: SHICHEN_NAME[zhiIdx],
    range: SHICHEN_RANGE[zhiIdx],
    index: zhiIdx,
  };
}

function xunKong(dayG) {
  const idx = dayG.index;
  const xunStart = Math.floor(idx / 10) * 10;
  const covered = new Set();
  for (let i = 0; i < 10; i++) covered.add((xunStart + i) % 12);
  const kong = [];
  for (let i = 0; i < 12; i++) if (!covered.has(i)) kong.push(ZHI[i]);
  return kong;
}

function jianChu(monthZ, dayZ) {
  const mi = ZHI.indexOf(monthZ);
  const di = ZHI.indexOf(dayZ);
  return JIANCHU[((di - mi) % 12 + 12) % 12];
}

function chong(dayZ) {
  const i = ZHI.indexOf(dayZ);
  const c = ZHI[(i + 6) % 12];
  return { zhi: c, animal: ZHI_ANIMAL[c] };
}

/** 完整四柱 + 当日信息 */
function agenda(date = new Date()) {
  const y = yearGanzhi(date);
  const m = monthGanzhi(date, y);
  const d = dayGanzhi(date);
  const h = hourGanzhi(date, d);
  const terms = termWindow(beijingParts(date).y);
  const bj = new Date(date.getTime() + 8 * 3600000);
  const nextTerm = terms.find((t) => t.date > bj) || null;
  const prevTerm = [...terms].reverse().find((t) => t.date <= bj) || null;
  const kong = xunKong(d);
  const jc = jianChu(m.zhi, d.zhi);
  const shichenList = [];
  for (let i = 0; i < 12; i++) {
    const ganIdx = ((GAN.indexOf(d.gan) % 5) * 2 + i) % 10;
    shichenList.push({
      name: SHICHEN_NAME[i],
      range: SHICHEN_RANGE[i],
      zhizhi: ZHI[i],
      gang: GAN[ganIdx],
      text: GAN[ganIdx] + ZHI[i],
      wuxing: ZHI_WUXING[ZHI[i]],
      jianchu: JIANCHU[((ZHI.indexOf(d.zhi) + i) % 12 + 12) % 12],
      active: i === h.index,
    });
  }
  return {
    timestamp: date.getTime(),
    beijingTime: `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`,
    weekday: '日一二三四五六'[new Date(date.getTime() + 8 * 3600000).getUTCDay()],
    pillars: {
      year: { ...y, wuxing: GAN_WUXING[GAN.indexOf(y.gan)] + ZHI_WUXING[y.zhi] },
      month: { ...m, wuxing: GAN_WUXING[GAN.indexOf(m.gan)] + ZHI_WUXING[m.zhi] },
      day: { ...d, wuxing: GAN_WUXING[GAN.indexOf(d.gan)] + ZHI_WUXING[d.zhi], animal: ZHI_ANIMAL[d.zhi] },
      hour: { ...h, wuxing: GAN_WUXING[GAN.indexOf(h.gan)] + ZHI_WUXING[h.zhi] },
    },
    kong,
    jianchu: jc,
    chong: chong(d.zhi),
    terms: {
      prev: prevTerm ? { name: prevTerm.name, at: prevTerm.date.toISOString(), daysAgo: daysBetween(prevTerm.date, bj) } : null,
      next: nextTerm ? { name: nextTerm.name, at: nextTerm.date.toISOString(), daysTo: daysBetween(bj, nextTerm.date) } : null,
    },
    shichen: shichenList,
    shichenNow: h,
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

module.exports = {
  GAN, ZHI, GAN_WUXING, ZHI_WUXING, ZHI_ANIMAL, SHICHEN_NAME, SHICHEN_RANGE, JIANCHU, TERMS,
  agenda, dayGanzhi, yearGanzhi, monthGanzhi, hourGanzhi, xunKong, jianChu, chong, solarTerms, sunLongitude, julianDay,
};
