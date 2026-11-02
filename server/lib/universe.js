'use strict';
/**
 * 回测标的池（Universe）
 * =====================================================================
 * 为什么要 60-100 个标的：单标的日线 800 根只出 4-10 笔交易，
 * 21 个标的共 95 笔样本刚够看趋势、不够下结论。
 *
 * 选股原则（避免「挑好股票」的幸存者偏差）：
 *   · A 股：按行业分散的蓝筹 + 成长，覆盖银行/保险/消费/医药/科技/能源/地产/汽车
 *   · 美股：科技 + 传统行业 ETF 成分代表
 *   · 加密：主流 USDT 交易对（按市值排序）
 *   · 国内期货：按交易所和板块分散（黑色/有色/能化/农产品/贵金属）
 *   · 港股：主要指数成分
 * 所有标的是**按分类预设**列出的，不是按"回测表现好"挑出来的。
 */

const UNIVERSE = {
  A: [
    // 白酒/食品饮料
    '600519', '000858', '000568', '600887', '603288',
    // 金融（银行/保险/券商）
    '601318', '601398', '600036', '000001', '601166', '600016', '601988', '600030',
    // 医药
    '600276', '000538', '300760', '603259',
    // 科技/电子
    '002415', '002230', '000063', '300059', '002475', '603501',
    // 新能源/汽车
    '300750', '002594', '601012', '600104', '002460',
    // 消费/家电
    '000333', '000651', '002304', '600690',
    // 能源/资源
    '601899', '601088', '600028', '600900', '601857', '600019',
    // 地产/基建/其他
    '600048', '601668', '600585', '601888', '600309', '601601', '000725', '601390', '600050',
    // 券商
    '601688', '600999',
  ],
  US: [
    // Mega tech
    'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA',
    // Semis
    'AMD', 'INTC', 'AVGO', 'QCOM', 'MU',
    // 传统行业
    'JPM', 'V', 'WMT', 'DIS', 'BA', 'PFE', 'KO', 'XOM', 'CSCO', 'ORCL', 'JNJ', 'PG',
  ],
  CR: [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
    'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'ATOMUSDT',
    'LTCUSDT', 'TRXUSDT', 'UNIUSDT', 'NEARUSDT',
  ],
  CNF: [
    // 黑色
    'RB0', 'HC0', 'I0', 'J0', 'JM0', 'SF0', 'SM0',
    // 有色/贵金属
    'CU0', 'AL0', 'ZN0', 'NI0', 'AU0', 'AG0', 'SN0',
    // 能化
    'TA0', 'MA0', 'PP0', 'L0', 'V0', 'EG0', 'FU0', 'BU0', 'RU0', 'SC0',
    // 农产品
    'M0', 'Y0', 'P0', 'SR0', 'CF0', 'AP0', 'OI0', 'RM0',
    // 金融期货
    'IF0', 'IC0', 'IH0',
  ],
  HK: [
    '00700', '09988', '03690', '00939', '01299', '02318',
    '00388', '00883', '01810', '09618', '02020', '01088',
  ],
};

/** 拍平为 [{market, code}] */
function flatUniverse(markets) {
  const ms = markets && markets.length ? markets : Object.keys(UNIVERSE);
  const out = [];
  for (const m of ms) {
    for (const c of UNIVERSE[m] || []) out.push({ market: m, code: c });
  }
  return out;
}

function universeStats() {
  return Object.entries(UNIVERSE).map(([m, list]) => ({ market: m, count: list.length }));
}

module.exports = { UNIVERSE, flatUniverse, universeStats };
