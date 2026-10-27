'use strict';
/**
 * 农历（天文算法，零依赖）
 *
 * 规则：
 *  1. 朔（新月）用 Meeus 第 49 章均朔 + 主要摄动项，精度约分钟级；
 *  2. 日期一律按北京时间（UTC+8）切日；
 *  3. 以「含冬至之月为十一月」定月序；一个"岁"（冬至月 → 下一个冬至月）若有 13 个月，
 *     其中第一个**无中气**的月为闰月，沿用上一月序号；
 *  4. 农历年 = 正月初一所在公历年；十一月/十二月属上一农历年。
 *
 * 校验：测试里用 2023–2027 的春节（正月初一）与 2025 年闰六月做锚点。
 */

const G = require('./ganzhi');

const RAD = Math.PI / 180;
const TZ = 8 / 24; // 北京时间相对 UTC 的日偏移

/** ΔT（TT-UT，秒），2005–2050 Espenak-Meeus 多项式 */
function deltaT(year) {
  const t = year - 2000;
  return 62.92 + 0.32217 * t + 0.005589 * t * t;
}

const toJD = (date) => date.getTime() / 86400000 + 2440587.5;
const fromJD = (jd) => new Date((jd - 2440587.5) * 86400000);
const bjDateOfJD = (jd) => new Date((jd - 2440587.5) * 86400000 + 8 * 3600000);
/** JD（UT）→ 北京时间日期序号（整数，按 UTC+8 切日） */
const bjDayNumber = (jd) => Math.floor(jd + 0.5 + TZ);

/** 第 k 个朔的 JD（UT） */
function newMoonJD(k) {
  const year = 2000 + (k * 29.530588861) / 365.25;
  const T = (year - 2000) / 100;
  const jde0 = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T ** 3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4) * RAD;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4) * RAD;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3) * RAD;
  const s = Math.sin;
  const corr =
    -0.4072 * s(Mp) +
    0.17241 * E * s(M) +
    0.01608 * s(2 * Mp) +
    0.01039 * s(2 * F) +
    0.00739 * E * s(Mp - M) -
    0.00514 * E * s(Mp + M) +
    0.00208 * E * E * s(2 * M) -
    0.00111 * s(Mp - 2 * F) -
    0.00057 * s(Mp + 2 * F) +
    0.00056 * E * s(2 * Mp + M) -
    0.00042 * s(3 * Mp) +
    0.00042 * E * s(M + 2 * F) +
    0.00038 * E * s(M - 2 * F) -
    0.00024 * E * s(2 * Mp - M) -
    0.00017 * s(Om) -
    0.00007 * s(Mp + 2 * M) +
    0.00004 * s(2 * Mp - 2 * F) +
    0.00004 * s(3 * M) +
    0.00003 * s(Mp + M - 2 * F) +
    0.00003 * s(2 * Mp + 2 * F) -
    0.00003 * s(Mp + M + 2 * F) +
    0.00003 * s(Mp - M + 2 * F) -
    0.00002 * s(Mp - M - 2 * F) -
    0.00002 * s(3 * Mp + M) +
    0.00002 * s(4 * Mp);
  return jde0 + corr - deltaT(year) / 86400;
}

const ZHONGQI = new Set([330, 0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);

const termCache = new Map();
function termsOf(year) {
  if (!termCache.has(year)) {
    termCache.set(
      year,
      G.solarTerms(year).map((t) => ({ name: t.name, lon: t.lon, jd: toJD(new Date(t.date.getTime() - 8 * 3600000)) }))
    );
  }
  return termCache.get(year);
}

/** 冬至的 JD（UT） */
function winterSolsticeJD(year) {
  const t = termsOf(year).find((x) => x.name === '冬至');
  return t.jd;
}

function newMoonIndexNear(jd) {
  return Math.round((jd - 2451550.1) / 29.530588861);
}

/** 所有覆盖 [startJD, endJD] 的朔月 */
function monthsBetween(startJD, endJD) {
  let k = newMoonIndexNear(startJD) - 1;
  while (newMoonJD(k) >= startJD) k--;
  const out = [];
  const guard = Math.ceil((endJD - startJD) / 29) + 4;
  while (out.length < guard) {
    const a = newMoonJD(k);
    const b = newMoonJD(k + 1);
    if (a > endJD) break;
    if (b > startJD) out.push({ k, start: a, end: b });
    k++;
  }
  return out;
}

/**
 * 公历 → 农历
 * @param {Date} date 真实时间戳
 */
function solarToLunar(date) {
  const jd = toJD(date);
  const dayNum = bjDayNumber(jd);
  const gYear = new Date((dayNum - 2440587.5) * 86400000).getUTCFullYear();

  const months = monthsBetween(jd - 800, jd + 800);
  const monthOf = (x) => months.find((m) => bjDayNumber(m.start) <= bjDayNumber(x) && bjDayNumber(x) < bjDayNumber(m.end));

  // 岁：从「含冬至之月」的初一，到下一个「含冬至之月」的初一（不含）
  let sy = gYear - 1;
  for (let y = gYear - 2; y <= gYear + 1; y++) {
    const a = monthOf(winterSolsticeJD(y));
    const b = monthOf(winterSolsticeJD(y + 1));
    if (!a || !b) continue;
    if (bjDayNumber(a.start) <= dayNum && dayNum < bjDayNumber(b.start)) {
      sy = y;
      break;
    }
  }
  const dzStartMonth = monthOf(winterSolsticeJD(sy));
  const dzNextMonth = monthOf(winterSolsticeJD(sy + 1));
  if (process.env.LUNAR_DEBUG) {
    const f = (m) => (m ? new Date((m.start - 2440587.5) * 86400000 + 8 * 3600000).toISOString().slice(0, 10) : 'undef');
    console.error('[lunar] sy', sy, 'months', months.length, 'dza', f(dzStartMonth), 'dzb', f(dzNextMonth), 'si', months.indexOf(dzStartMonth), 'ei', months.indexOf(dzNextMonth));
  }
  if (!dzStartMonth || !dzNextMonth) throw new Error('岁边界定位失败');

  const si = months.indexOf(dzStartMonth);
  const ei = months.indexOf(dzNextMonth);
  const scope = months.slice(si, ei); // 下一个十一月之前（不含）

  const target = monthOf(jd);
  if (!target) throw new Error('农历定位失败');

  // 中气按北京日期归属
  const terms = [...termsOf(sy), ...termsOf(sy + 1)].filter((t) => ZHONGQI.has(t.lon));
  const hasZhongqi = (m) =>
    terms.some((t) => {
      const d = bjDayNumber(t.jd);
      return d >= bjDayNumber(m.start) && d < bjDayNumber(m.end);
    });

  // 闰月：岁内 13 个月时，第一个无中气者
  let leapPos = -1;
  if (scope.length === 13) leapPos = scope.findIndex((m) => !hasZhongqi(m));

  // 逐月编号：scope[0] = 十一月
  let no = 0;
  let monthNo = 11;
  let isLeap = false;
  let yearFlag = 1;
  for (let i = 0; i < scope.length; i++) {
    const m = scope[i];
    const isThis = m.k === target.k;
    if (i === leapPos) {
      if (isThis) {
        isLeap = true;
        monthNo = ((no + 9) % 12) + 1;
        yearFlag = no;
        break;
      }
      continue;
    }
    no++;
    if (isThis) {
      monthNo = ((no + 9) % 12) + 1;
      yearFlag = no;
      break;
    }
  }

  const day = dayNum - bjDayNumber(target.start) + 1;
  const lunarYear = yearFlag <= 2 ? sy : sy + 1;

  return {
    year: lunarYear,
    month: monthNo,
    day,
    isLeap,
    monthDays: bjDayNumber(target.end) - bjDayNumber(target.start),
    dayIndex: day - 1,
    gregorian: new Date((dayNum - 2440587.5) * 86400000).toISOString().slice(0, 10),
  };
}

module.exports = { solarToLunar, newMoonJD, deltaT, toJD, fromJD, bjDayNumber, winterSolsticeJD };
