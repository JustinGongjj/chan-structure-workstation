#!/usr/bin/env node
/**
 * 数据源可达性巡检：把所有候选渠道（含竞品/商业 API）实测一遍，输出分级结论。
 *   node scripts/srcaudit.js [--json]
 *
 * 分级：
 *   ✅ available  当前运行时可直接用（免 key）
 *   🔑 gated      域名可达，但需要 API key / 账号 / 付费
 *   ⛔ blocked    域名层不可达（DNS/连接超时/被拦）
 *   ⚠️  guarded    有反爬校验（需绕过 JS 挑战，不采用）
 */
'use strict';

const SOURCES = [
  // —— 已接入 ——
  { id: 'tencent-quote', name: '腾讯行情', url: 'https://qt.gtimg.cn/q=sh000001', used: true, markets: ['A', 'HK', 'US'] },
  { id: 'tencent-kline', name: '腾讯K线', url: 'https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,5,qfq', used: true, markets: ['A', 'HK'] },
  { id: 'sina-quote', name: '新浪行情', url: 'https://hq.sinajs.cn/list=sh600519', used: true, markets: ['A', 'USF', 'CNF'] },
  { id: 'sina-minute', name: '新浪A股分钟', url: 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=5&datalen=5', used: true, markets: ['A'] },
  { id: 'sina-fut-daily', name: '新浪期货日线', url: 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_x=/InnerFuturesNewService.getDailyKLine?symbol=RB0', used: true, markets: ['CNF'] },
  { id: 'sina-fut-min', name: '新浪期货分钟', url: 'https://stock2.finance.sina.com.cn/futures/api/openapi.php/InnerFuturesNewService.getFewMinLine?symbol=RB0&type=5', used: false, markets: ['CNF'] },
  { id: 'sina-global-daily', name: '外盘期货日线', url: 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_x=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=GC&_=1', used: true, markets: ['USF'] },
  { id: 'sina-global-min', name: '外盘期货分时', url: 'https://stock2.finance.sina.com.cn/futures/api/openapi.php/GlobalFuturesService.getGlobalFuturesMinLine?symbol=GC', used: false, markets: ['USF'] },
  { id: 'nasdaq', name: '纳斯达克官方', url: 'https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&fromdate=2026-09-01&todate=2026-10-30&limit=5', used: true, markets: ['US'] },
  { id: 'binance-quote', name: 'Binance 行情', url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', used: true, markets: ['CR'] },
  { id: 'binance-kline', name: 'Binance K线', url: 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=5', used: true, markets: ['CR'] },
  { id: 'gold-api', name: 'Gold-API 现货', url: 'https://api.gold-api.com/price/XAU', used: true, markets: ['USF'] },
  { id: 'em-datacenter', name: '东财数据中心', url: 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_FUTU_POSITIONCODE', used: false, markets: ['A'] },
  { id: 'cninfo', name: '巨潮资讯', url: 'https://www.cninfo.com.cn', used: false, markets: ['A'] },
  { id: 'xueqiu', name: '雪球', url: 'https://xueqiu.com/statuses/hot/listV2.json', used: false, markets: ['A'] },

  // —— 竞品 / 商业 ——
  { id: 'tradingview-web', name: 'TradingView 主站', url: 'https://www.tradingview.com/' },
  { id: 'tradingview-data', name: 'TradingView 数据域', url: 'https://data.tradingview.com/' },
  { id: 'tradingview-scanner', name: 'TradingView Scanner', url: 'https://scanner.tradingview.com/symbol?symbol=NASDAQ%3AAAPL' },
  { id: 'yahoo', name: 'Yahoo Finance', url: 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d' },
  { id: 'stooq', name: 'Stooq', url: 'https://stooq.com/q/d/l/?s=aapl.us&i=d' },
  { id: 'alphavantage', name: 'Alpha Vantage', url: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=demo', note: 'demo key 可用于报价；K 线需正式 key（免费申请）' },
  { id: 'finnhub', name: 'Finnhub', url: 'https://finnhub.io/api/v1/quote?symbol=AAPL', note: '免费档 60 次/分' },
  { id: 'polygon', name: 'Polygon.io', url: 'https://api.polygon.io/v1/open-close/AAPL/2024-01-01' },
  { id: 'twelvedata', name: 'Twelve Data', url: 'https://api.twelvedata.com/quote?symbol=AAPL', note: '免费 800 次/日' },
  { id: 'marketstack', name: 'Marketstack', url: 'https://api.marketstack.com/v1/eod?access_key=demo&symbols=AAPL' },
  { id: 'fmp', name: 'Financial Modeling Prep', url: 'https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=demo' },
  { id: 'longport', name: '长桥 LongPort OpenAPI', url: 'https://openapi.longportapp.com', note: '需账户 + IP 白名单' },
  { id: 'ibkr', name: 'IBKR API', url: 'https://api.ibkr.com', note: '需 IB Gateway 常驻 + 盈透账户' },
  { id: 'eastmoney-push2', name: '东财 push2', url: 'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f58' },
  { id: 'eastmoney-kline', name: '东财 K线', url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&klt=101&lmt=5&fields1=f1&fields2=f51,f52' }
];

const TIMEOUT = 12000;

async function probe(src) {
  const t0 = Date.now();
  let status = 0;
  let err = '';
  let guarded = false;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), TIMEOUT);
    const r = await fetch(src.url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125', Referer: 'https://finance.sina.com.cn' }
    });
    clearTimeout(to);
    status = r.status;
    const text = (await r.text()).slice(0, 1200);
    // 反爬特征：JS 挑战 / 验证页
    if (/requires JavaScript to verify|__verify|Are you a robot|cf-challenge/i.test(text)) guarded = true;
  } catch (e) {
    err = e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.name || 'error');
  }
  let level = 'blocked';
  if (guarded) level = 'guarded';
  else if (status >= 200 && status < 400) level = 'available';
  else if (status === 401 || status === 403 || status === 402) level = 'gated';
  return { ...src, status, ms: Date.now() - t0, err, level };
}

(async () => {
  const results = [];
  for (const s of SOURCES) results.push(await probe(s));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const groups = {
    available: { icon: '✅', title: '可直接用（免 key）' },
    gated: { icon: '🔑', title: '域名可达，但需要 key / 账号 / 付费' },
    guarded: { icon: '⚠️ ', title: '有反爬校验（不采用，避免绕过防护）' },
    blocked: { icon: '⛔', title: '域名层不可达' }
  };
  for (const [k, g] of Object.entries(groups)) {
    const list = results.filter((r) => r.level === k);
    if (!list.length) continue;
    console.log(`${g.icon} ${g.title}（${list.length}）`);
    for (const r of list) {
      const extra = r.used ? '[已接入]' : '';
      const note = r.note ? ' · ' + r.note : '';
      console.log(`   ${(r.name + extra).padEnd(28)} ${r.status || r.err || ''} ${r.ms}ms${note}`);
    }
    console.log('');
  }
  const used = results.filter((r) => r.used);
  const usedDown = used.filter((r) => r.level !== 'available');
  console.log(`已接入 ${used.length} 个源，其中异常 ${usedDown.length} 个${usedDown.length ? '：' + usedDown.map((r) => r.name).join('、') : ''}`);
  process.exit(usedDown.length ? 1 : 0);
})();
