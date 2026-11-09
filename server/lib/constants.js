'use strict';
/**
 * 共享常量（单一数据源）
 * =====================================================================
 * 起因：市场名称映射在 5 个文件里各写一份，已经漂移——
 *   game.js 只写了 { A, HK, US, CR }，缺 CNF/USF；
 *   闯关题一旦用到期货标的，界面上会直接显示 "CNF" 而不是「国内期货」。
 *
 * 周期名称映射同样有 3 份（sources.js / structure.js / mobile.js）。
 *
 * 这里集中定义，其他模块一律从这里取。前端通过 /api/constants 获取，
 * 避免前后端再各维护一份。
 */

const MARKETS = {
  A: 'A股',
  HK: '港股',
  US: '美股',
  CR: '加密',
  CNF: '国内期货',
  USF: '美期货',
};

const MARKET_ORDER = ['A', 'HK', 'US', 'CR', 'CNF', 'USF'];

/*
  周期名称以「N分钟」完整措辞为准（与 sources.js 原有输出一致，
  避免统一时改动用户已经看到的文案）。
  注意前端 structure.js / mobile.js 的按钮用的是短名（1分/5分），
  由前端自己做短名映射，不在这里混用两套。
*/
const PERIODS = {
  '1m': '1分钟',
  '5m': '5分钟',
  '15m': '15分钟',
  '30m': '30分钟',
  '60m': '60分钟',
  '1h': '1小时',
  '4h': '4小时',
  day: '日线',
  week: '周线',
  month: '月线',
};

/** 信号类型中文名 */
const SIGNALS = {
  '1B': '一类买点',
  '2B': '二类买点',
  '3B': '三类买点',
  '1S': '一类卖点',
  '2S': '二类卖点',
  '3S': '三类卖点',
};

const SIGNAL_ORDER = ['1B', '2B', '3B', '1S', '2S', '3S'];

/** 市场中文名，未知则回退到代码本身 */
function marketLabel(m) {
  return MARKETS[String(m || '').toUpperCase()] || String(m || '');
}

/** 周期中文名 */
function periodLabel(p) {
  return PERIODS[String(p || '')] || String(p || '');
}

/** 信号中文名 */
function signalLabel(s) {
  return SIGNALS[String(s || '').toUpperCase()] || String(s || '');
}

module.exports = { MARKETS, MARKET_ORDER, PERIODS, SIGNALS, SIGNAL_ORDER, marketLabel, periodLabel, signalLabel };
