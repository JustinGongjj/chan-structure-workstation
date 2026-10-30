'use strict';
/**
 * 行情适配层：把四个市场的免费数据源统一成一种结构。
 *
 *  市场     日/周/月K              分钟K                        实时报价
 *  A股      腾讯 fqkline(前复权)   新浪 KLineData → 腾讯 mkline   腾讯 qt.gtimg.cn
 *  港股     腾讯 fqkline            暂无（降级：日线）             腾讯 qt.gtimg.cn
 *  美股     纳斯达克 historical → 新浪 US_MinKService → 东财      腾讯 qt.gtimg.cn
 *  加密     币安 klines           币安 klines(1m-4h)            币安 ticker/24hr
 */

const { request, getJSON, cached, sleep } = require('./http');

/* 期货主力连续合约：国内用 RB0/AU0/IF0 这类，美期货用 ES/NQ/GC/CL 这类 */
const CNF_LIST = ['RB0', 'AU0', 'AG0', 'CU0', 'IF0', 'IC0', 'IH0', 'IM0', 'TA0', 'MA0', 'M0', 'P0', 'Y0', 'SR0', 'CF0', 'SC0', 'FG0', 'RM0', 'OI0', 'SA0'];
const USF_LIST = ['ES', 'NQ', 'YM', 'RTY', 'GC', 'SI', 'CL', 'NG', 'HG', 'ZC', 'ZS', 'ZW', '6E', '6J'];

const MARKETS = {
  A: { key: 'A', name: 'A股', currency: 'CNY', tz: 8, intraday: true, periods: ['1m', '5m', '15m', '30m', '60m', 'day', 'week', 'month'] },
  HK: { key: 'HK', name: '港股', currency: 'HKD', tz: 8, intraday: false, periods: ['day', 'week', 'month'] },
  US: { key: 'US', name: '美股', currency: 'USD', tz: -4, intraday: false, periods: ['day', 'week', 'month'] },
  CR: { key: 'CR', name: '加密', currency: 'USDT', tz: 0, intraday: true, periods: ['1m', '5m', '15m', '30m', '60m', '4h', 'day', 'week'] },
  CNF: { key: 'CNF', name: '国内期货', currency: 'CNY', tz: 8, intraday: false, periods: ['day', 'week', 'month'] },
  USF: { key: 'USF', name: '美期货', currency: 'USD', tz: -5, intraday: false, periods: ['day', 'week', 'month'] },
};

const PERIOD_NAME = {
  '1m': '1分钟', '5m': '5分钟', '15m': '15分钟', '30m': '30分钟', '60m': '60分钟',
  '1h': '1小时', '4h': '4小时', day: '日线', week: '周线', month: '月线',
};
const PERIOD_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1h': 60, '4h': 240, day: 1440, week: 10080, month: 30240 };

const A_SH_PREFIX = /^(60|68|9|5|11|13|50|51|58)/;
const A_SZ_PREFIX = /^(00|30|20|15|16|12|39)/;

/** 统一成内部代码：A股保留 sh/sz 前缀（指数需要），港股 5 位或指数代码，美股大写 */
function normCode(market, raw) {
  let c = String(raw || '').trim().toUpperCase();
  if (market === 'A') {
    if (/^(SH|SZ|BJ)/.test(c)) return c.toLowerCase();
    return c.replace(/\.(SH|SZ|BJ)$/, '');
  }
  if (market === 'HK') {
    if (/^HK[0-9]/.test(c)) return c.slice(2).padStart(5, '0');
    if (/^HK[A-Z]+$/.test(c)) return c.slice(2);
    if (/^[A-Z]{2,6}$/.test(c)) return c;
    return c.replace(/\.HK$/, '').padStart(5, '0');
  }
  if (market === 'US') return c.replace(/^US\.?/, '').replace(/\.(OQ|N|US)$/, '');
  if (market === 'CNF') return c.replace(/^CNF\.?/, '').replace(/[^A-Z0-9]/g, '');
  if (market === 'USF') return c.replace(/^USF\.?/, '').replace(/[^A-Z0-9]/g, '');
  return c.replace(/[-/_]/g, '');
}

/** 腾讯代码 */
function tcCode(market, code) {
  const c = normCode(market, code);
  if (market === 'A') {
    if (/^(sh|sz|bj)/.test(c)) return c;
    const p = A_SH_PREFIX.test(c) ? 'sh' : 'sz';
    return p + c;
  }
  if (market === 'HK') return 'hk' + c;
  if (market === 'US') return 'us' + c;
  return null;
}

/* ---------------- 期货（新浪） ---------------- */
function sinaFuturesUrl(market, code) {
  return market === 'USF'
    ? `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_x=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${code}&_=${Date.now()}`
    : `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_x=/InnerFuturesNewService.getDailyKLine?symbol=${code}`;
}

async function sinaFuturesDaily(market, code) {
  const txt = await request(sinaFuturesUrl(market, code), {
    timeout: 9000,
    referer: 'https://finance.sina.com.cn',
  });
  const body = (txt.match(/=(\([\s\S]*\))\s*;?\s*$/) || [])[1] || txt;
  let arr;
  try { arr = JSON.parse(body.replace(/^[\s(]+|[\s)]+$/g, '')); } catch (e) { throw new Error('期货K线解析失败'); }
  if (!Array.isArray(arr) || !arr.length) throw new Error('期货K线为空');
  const bars = arr
    .map((k) => {
      const t = Date.parse(((k.date || k.d) || '') + 'T00:00:00Z');
      return { t, o: num(k.open ?? k.o), h: num(k.high ?? k.h), l: num(k.low ?? k.l), c: num(k.close ?? k.c), v: num(k.volume ?? k.v) };
    })
    .filter((b) => b.t && Number.isFinite(b.c) && b.c > 0)
    .sort((a, b) => a.t - b.t);
  return { bars, source: 'sina-futures' };
}

/** 期货实时报价（国内期货的快照接口常年僵死，必须用 K 线兜底） */
async function fetchFuturesQuotes(items) {
  const map = new Map();
  if (!items.length) return map;
  const list = items.map((i) => (i.market === 'USF' ? 'hf_' + i.code : i.code));
  const txt = await request('https://hq.sinajs.cn/list=' + list.join(','), {
    encoding: 'gbk', timeout: 8000, referer: 'https://finance.sina.com.cn',
  });
  for (const line of txt.split('\n')) {
    const m = line.match(/var hq_str_([^=]+)="([^"]*)"/);
    if (!m) continue;
    const key = m[1];
    const f = m[2].split(',');
    const it = items.find((i) => (i.market === 'USF' ? 'hf_' + i.code : i.code) === key);
    if (!it) continue;
    let price = 0, prevClose = 0, name = '';
    if (it.market === 'USF') {
      // hf_XXX: 0 最新价, 7 昨收? 新浪外盘期货字段: 0现价 2买价 3卖价 4最高 5最低 6时间 7昨结 8今开 ... 13名称
      price = num(f[0]);
      prevClose = num(f[7]) || num(f[8]) || price;
      name = f[13] || it.code;
    } else {
      // 国内期货: 0名称 1时间 2开 3高 4低 5昨收 6买 7卖 8最新 9结算 10昨结 11买量 12卖量 13持仓 14成交量
      name = f[0];
      price = num(f[8]) || num(f[2]);
      prevClose = num(f[5]) || num(f[10]) || price;
    }
    if (!price) continue;
    const pct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    map.set(it.market + ':' + it.code, {
      market: it.market, code: it.code, name: name.trim() || it.code,
      price, prevClose, pct: +pct.toFixed(2), source: 'sina-futures', staleSnapshot: it.market === 'CNF',
    });
  }
  return map;
}

/** 币安交易对 */
function bnSymbol(code) {
  const c = String(code || '').toUpperCase().replace(/[-/_]/g, '');
  if (/(USDT|USDC|BTC|ETH|BUSD)$/.test(c)) return c;
  return c + 'USDT';
}

const PERIOD_SCALE = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1h': 60 };
const BINANCE_INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '1h', '1h': '1h', '4h': '4h', day: '1d', week: '1w', month: '1M' };
const NC_MKLINE = { '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30', '60m': 'm60' };

const unescapeUnicode = (s) => String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const num = (v) => {
  const n = parseFloat(String(v).replace(/[$,%]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/* ------------------------------------------------------------------ */
/* 实时报价                                                            */
/* ------------------------------------------------------------------ */

function parseTencentQuote(line, market, wantCode) {
  const m = line.match(/^v_([a-zA-Z0-9]+)="([^"]*)"/);
  if (!m) return null;
  const f = m[2].split('~');
  if (f.length < 40) return null;
  const price = num(f[3]);
  const prev = num(f[4]);
  if (!price && !prev) return null;
  const pct = num(f[32]);
  const chg = num(f[31]) || (prev ? price - prev : 0);
  const tsRaw = String(f[30] || '');
  let ts = 0;
  const d1 = tsRaw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  const d2 = tsRaw.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (d1) ts = Date.UTC(+d1[1], +d1[2] - 1, +d1[3], +d1[4] - 8, +d1[5], +d1[6]);
  else if (d2) ts = Date.UTC(+d2[1], +d2[2] - 1, +d2[3], +d2[4] - 8, +d2[5], +d2[6]);
  return {
    market,
    code: normCode(market, wantCode || f[2] || m[1].replace(/^[a-z]{2}/, '')),
    name: f[1] || f[2] || m[1],
    price,
    prevClose: prev,
    open: num(f[5]),
    high: num(f[33]),
    low: num(f[34]),
    change: chg,
    pct,
    volume: num(f[6]),
    amount: num(f[37]),
    ts,
    timeText: tsRaw,
    source: 'tencent',
  };
}

async function fetchTencentQuotes(items) {
  const map = new Map();
  const valid = items.filter((it) => it.market !== 'CR');
  if (!valid.length) return map;
  const tcs = valid.map((it) => tcCode(it.market, it.code));
  const url = 'https://qt.gtimg.cn/q=' + tcs.join(',');
  const txt = await request(url, { encoding: 'gbk', retries: 2, timeout: 8000, referer: 'https://gu.qq.com/' });
  const lines = txt.split('\n');
  const byTc = new Map(valid.map((it, i) => [tcs[i], it]));
  for (const line of lines) {
    const m = line.match(/^v_([a-zA-Z0-9]+)=/);
    if (!m) continue;
    const it = byTc.get(m[1]);
    if (!it) continue;
    const q = parseTencentQuote(line, it.market, normCode(it.market, it.code));
    if (q) map.set(it.market + ':' + normCode(it.market, it.code), q);
  }
  return map;
}

async function fetchCryptoQuotes(items) {
  const map = new Map();
  if (!items.length) return map;
  const symbols = items.map((it) => bnSymbol(it.code));
  const url =
    'https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symbols));
  const arr = await getJSON(url, { retries: 2, timeout: 9000 });
  const list = Array.isArray(arr) ? arr : [arr];
  for (const t of list) {
    const code = String(t.symbol || '').toUpperCase();
    const price = num(t.lastPrice);
    const open = num(t.openPrice);
    const prev = open || price - num(t.priceChange);
    const pct = num(t.priceChangePercent) || (open ? ((price - open) / open) * 100 : 0);
    const chg = num(t.priceChange) || price - prev;
    map.set('CR:' + code, {
      market: 'CR',
      code,
      name: code.replace(/USDT$/, '') + '/USDT',
      price,
      prevClose: prev,
      open,
      high: num(t.highPrice),
      low: num(t.lowPrice),
      change: chg,
      pct,
      volume: num(t.volume),
      amount: num(t.quoteVolume),
      ts: num(t.closeTime) || Date.now(),
      timeText: new Date(num(t.closeTime) || Date.now()).toISOString().slice(0, 16).replace('T', ' '),
      source: 'binance',
    });
  }
  return map;
}

/** 批量报价：tencent 请求按 60 个一批 */
async function quotes(items) {
  const uniq = [];
  const seen = new Set();
  for (const it of items) {
    const k = it.market + ':' + normCode(it.market, it.code);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ market: it.market, code: normCode(it.market, it.code) });
  }
  const key = 'quotes:' + uniq.map((i) => i.market + i.code).join(',');
  const res = await cached(key, 4000, async () => {
    const out = {};
    const plain = uniq.filter((i) => i.market !== 'CR' && i.market !== 'CNF' && i.market !== 'USF');
    const crypto = uniq.filter((i) => i.market === 'CR');
    const futures = uniq.filter((i) => i.market === 'CNF' || i.market === 'USF');
    const jobs = [];
    if (futures.length) jobs.push(fetchFuturesQuotes(futures));
    for (let i = 0; i < plain.length; i += 50) jobs.push(fetchTencentQuotes(plain.slice(i, i + 50)));
    jobs.push(fetchCryptoQuotes(crypto));
    const maps = await Promise.allSettled(jobs);
    for (const r of maps) {
      if (r.status === 'fulfilled') for (const [k, v] of r.value) out[k] = v;
    }
    // 国内期货快照经常是几个月前的僵死值：统一用日线最新收盘重算
    if (uniq.some((i) => i.market === 'CNF')) {
      await Promise.allSettled(
        uniq.filter((i) => i.market === 'CNF').map(async (i) => {
          try {
            const k = await klines({ market: 'CNF', code: i.code, period: 'day', limit: 3 });
            const bars = k.bars;
            if (bars.length) {
              const last = bars[bars.length - 1];
              const prev = bars.length > 1 ? bars[bars.length - 2] : last;
              const pct = prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0;
              const had = out[i.market + ':' + i.code];
              out[i.market + ':' + i.code] = {
                market: 'CNF', code: i.code, name: (had && had.name) || i.code,
                price: last.c, prevClose: prev.c, pct: +pct.toFixed(2), source: 'sina-futures+day',
              };
            }
          } catch (e) { /* 保底用快照 */ }
        })
      );
    }

    // 缺失项回退：东方财富单点补
    const missing = uniq.filter((i) => !out[i.market + ':' + i.code]);
    if (missing.length) {
      await Promise.allSettled(
        missing.map(async (i) => {
          const q = await fallbackQuote(i.market, i.code).catch(() => null);
          if (q) out[i.market + ':' + i.code] = q;
        })
      );
    }
    return out;
  });
  const data = res.value;
  return uniq.map((i) => data[i.market + ':' + i.code] || { market: i.market, code: i.code, name: i.code, price: 0, pct: 0, error: '无报价' });
}

async function fallbackQuote(market, code) {
  if (market === 'CR') {
    const arr = await getJSON('https://data-api.binance.vision/api/v3/ticker/price?symbol=' + bnSymbol(code));
    return { market, code, name: code, price: num(arr.price), pct: 0, source: 'binance' };
  }
  const secid = emSecid(market, code);
  const j = await getJSON(
    'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid + '&ut=fa5fd1943c7b386f172d6893dbfba10b&fields=f43,f44,f45,f46,f57,f58,f60,f169,f170',
    { timeout: 6000 }
  );
  if (!j || !j.data) throw new Error('empty');
  return {
    market,
    code,
    name: j.data.f58,
    price: num(j.data.f43) / 100,
    prevClose: num(j.data.f60) / 100,
    high: num(j.data.f44) / 100,
    low: num(j.data.f45) / 100,
    open: num(j.data.f46) / 100,
    change: num(j.data.f169) / 100,
    pct: num(j.data.f170) / 100,
    ts: Date.now(),
    source: 'eastmoney',
  };
}

function emSecid(market, code) {
  const c = normCode(market, code);
  if (market === 'A') {
    if (/^sh/.test(c)) return '1.' + c.slice(2);
    if (/^sz|^bj/.test(c)) return '0.' + c.slice(2);
    return (A_SH_PREFIX.test(c) ? '1.' : '0.') + c;
  }
  if (market === 'HK') return '116.' + c;
  return '105.' + c;
}

/* ------------------------------------------------------------------ */
/* K线                                                                */
/* ------------------------------------------------------------------ */

function bar(t, o, h, l, c, v) {
  return { t, o, h, l, c, v };
}

function parseTencentDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + 'T00:00:00Z');
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Date.parse(s);
}

/** 腾讯 fqkline：A/港股 日周月（A股前复权）。web 前缀的域名有风控 501，故走 ifzq / proxy 两个入口 */
async function tencentFq(market, code, period, limit) {
  const tc = tcCode(market, code);
  const n = Math.min(Math.max(limit, 60), 800);
  const hosts = ['https://ifzq.gtimg.cn/appstock/app/fqkline/get', 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get'];
  const errs = [];
  for (const host of hosts) {
    try {
      const url = `${host}?param=${tc},${period},,,${n},qfq`;
      const j = await getJSON(url, { retries: 1, timeout: 10000, referer: 'https://gu.qq.com/' });
      const node = j && j.data && j.data[tc];
      if (!node) throw new Error('无数据节点');
      const arr = node[period] || node['qfq' + period] || node['hfq' + period];
      if (!Array.isArray(arr) || !arr.length) throw new Error('空数据');
      const bars = arr
        .filter((r) => Array.isArray(r) && r.length >= 6 && !isNaN(parseFloat(r[1])))
        .map((r) => bar(parseTencentDate(r[0]), num(r[1]), num(r[3]), num(r[4]), num(r[2]), num(r[5])));
      if (bars.length < 10) throw new Error('数据不足');
      return { bars, source: 'tencent' };
    } catch (e) {
      errs.push(String(e.message || e));
    }
  }
  throw new Error('tencent: ' + errs.join(' / '));
}

/** 腾讯分钟线（A股） */
async function tencentMinute(market, code, period, limit) {
  const tc = tcCode(market, code);
  const m = NC_MKLINE[period];
  const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${tc},${m},,${Math.min(limit, 640)}`;
  const j = await getJSON(url, { retries: 1, timeout: 9000, referer: 'https://gu.qq.com/' });
  const node = j && j.data && j.data[tc];
  const arr = node && node[m];
  if (!Array.isArray(arr) || !arr.length) throw new Error('tencent 分钟线无数据');
  // 行结构: [时间, 开, 收, 高, 低, 量]
  const bars = arr
    .filter((r) => Array.isArray(r) && r.length >= 5)
    .map((r) => bar(parseTencentDate(r[0]), num(r[1]), num(r[3]), num(r[4]), num(r[2]), num(r[5])))
    .sort((a, b) => a.t - b.t);
  return { bars, source: 'tencent-mkline' };
}

/** 新浪分钟线（A股，含 1 分钟） */
async function sinaMinute(market, code, period, limit) {
  const tc = tcCode(market, code);
  const scale = PERIOD_SCALE[period];
  const n = Math.min(limit, 1023);
  const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${tc}&scale=${scale}&ma=no&datalen=${n}`;
  const arr = await getJSON(url, { retries: 1, timeout: 9000, referer: 'https://finance.sina.com.cn' });
  if (!Array.isArray(arr) || !arr.length) throw new Error('sina 分钟线无数据');
  const bars = arr
    .map((r) => bar(Date.parse(String(r.day).replace(' ', 'T') + '+08:00'), num(r.open), num(r.high), num(r.low), num(r.close), num(r.volume)))
    .filter((b) => b.c > 0)
    .sort((a, b) => a.t - b.t);
  return { bars, source: 'sina' };
}

/** A股日线兜底：新浪 scale=240（日线） */
async function sinaDaily(market, code, limit) {
  const tc = tcCode(market, code);
  const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${tc}&scale=240&ma=no&datalen=${Math.min(limit, 1023)}`;
  const arr = await getJSON(url, { retries: 1, timeout: 9000, referer: 'https://finance.sina.com.cn' });
  if (!Array.isArray(arr) || !arr.length) throw new Error('sina 日线无数据');
  const bars = arr
    .map((r) => bar(Date.parse(String(r.day).slice(0, 10) + 'T00:00:00Z'), num(r.open), num(r.high), num(r.low), num(r.close), num(r.volume)))
    .filter((b) => b.c > 0)
    .sort((a, b) => a.t - b.t);
  if (bars.length < 10) throw new Error('sina 日线数据不足');
  return { bars, source: 'sina-daily' };
}

/** 美股日线：纳斯达克官方接口 */
async function nasdaqDaily(code, limit) {
  const to = new Date();
  const from = new Date(Date.now() - Math.min(Math.max(limit, 120) * 2.2, 8000) * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(code)}/historical?assetclass=stocks&fromdate=${iso(from)}&todate=${iso(to)}&limit=9999&random=1`;
  const j = await getJSON(url, {
    timeout: 12000,
    retries: 1,
    headers: { Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
    referer: 'https://www.nasdaq.com/',
  });
  const rows = j && j.data && j.data.tradesTable && j.data.tradesTable.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error('nasdaq 无数据');
  const bars = rows
    .map((r) => {
      const [m, d, y] = String(r.date).split('/').map(Number);
      return bar(Date.UTC(y, m - 1, d), num(r.open), num(r.high), num(r.low), num(r.close), num(r.volume));
    })
    .filter((b) => b.c > 0)
    .sort((a, b) => a.t - b.t);
  return { bars: bars.slice(-limit), source: 'nasdaq' };
}

/** 美股日线兜底：新浪（返回全历史，截取尾部） */
async function sinaUsDaily(code) {
  const url = `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/IO.XSRV2.CallbackList/US_MinKService.getDailyK?symbol=${code}`;
  const txt = await request(url, { timeout: 15000, retries: 0, referer: 'https://finance.sina.com.cn/' });
  const m = txt.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('sina-us 无数据');
  const arr = JSON.parse(m[0]);
  const bars = arr
    .map((r) => bar(Date.parse(String(r.d) + 'T00:00:00Z'), num(r.o), num(r.h), num(r.l), num(r.c), num(r.v)))
    .filter((b) => b.c > 0)
    .sort((a, b) => a.t - b.t);
  if (bars.length < 10) throw new Error('sina-us 数据不足');
  return { bars, source: 'sina-us' };
}

/** 东财 K线（通用兜底） */
async function emKline(market, code, period, limit) {
  const klt = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, day: 101, week: 102, month: 103 }[period];
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${emSecid(market, code)}&klt=${klt}&fqt=1&lmt=${limit}` +
    '&end=20500101&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57';
  const j = await getJSON(url, { timeout: 8000, retries: 1, referer: 'https://quote.eastmoney.com/' });
  const rows = j && j.data && j.data.klines;
  if (!Array.isArray(rows) || !rows.length) throw new Error('eastmoney 无数据');
  const bars = rows.map((r) => {
    const p = String(r).split(',');
    const t = p[0].length <= 10 ? Date.parse(p[0] + 'T00:00:00Z') : Date.parse(p[0].replace(' ', 'T') + '+08:00');
    return bar(t, num(p[1]), num(p[3]), num(p[4]), num(p[2]), num(p[5]));
  });
  return { bars, source: 'eastmoney' };
}

/** 币安 K线 */
async function binanceKline(code, period, limit) {
  const interval = BINANCE_INTERVAL[period] || '1d';
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${bnSymbol(code)}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
  const arr = await getJSON(url, { retries: 2, timeout: 10000 });
  if (!Array.isArray(arr) || !arr.length) throw new Error('binance 无数据');
  const bars = arr.map((r) => bar(Number(r[0]), num(r[1]), num(r[2]), num(r[3]), num(r[4]), num(r[5])));
  return { bars, source: 'binance' };
}

function aggBars(bars, keyFn) {
  const map = new Map();
  for (const b of bars) {
    const k = keyFn(b.t);
    const cur = map.get(k);
    if (!cur) map.set(k, { ...b, t: k });
    else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function weekKey(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
function monthKey(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** 统一 K 线入口 */
async function klines({ market, code, period = 'day', limit = 600 }) {
  const m = String(market || 'A').toUpperCase();
  const c = normCode(m, code);
  if (!PERIOD_MINUTES[period]) throw new Error('不支持的周期: ' + period);
  if (!MARKETS[m]) throw new Error('不支持的市场: ' + market);
  const key = `kl:${m}:${c}:${period}:${limit}`;
  const ttl = period === 'day' || period === 'week' || period === 'month' ? 60000 : 20000;
  const res = await cached(key, ttl, async () => {
    const errors = [];
    const tryEach = async (fns) => {
      for (const f of fns) {
        try {
          const r = await f();
          if (r && r.bars && r.bars.length >= 5) return r;
          errors.push('数据不足');
        } catch (e) {
          errors.push(String(e.message || e));
        }
      }
      throw new Error(errors.join(' | '));
    };

    if (m === 'CR') return tryEach([() => binanceKline(c, period, limit)]);

    if (m === 'CNF' || m === 'USF') {
      const daily = await tryEach([() => sinaFuturesDaily(m, c)]);
      if (period === 'day') return { ...daily, bars: daily.bars.slice(-limit) };
      const agg = period === 'week' ? aggBars(daily.bars, weekKey) : aggBars(daily.bars, monthKey);
      return { bars: agg.slice(-limit), source: daily.source + '+agg' };
    }

    if (period === 'day' || period === 'week' || period === 'month') {
      if (m === 'A') {
        try {
          return await tryEach([() => tencentFq(m, c, period, limit), () => emKline(m, c, period, limit)]);
        } catch (e) {
          // 兜底：新浪日线（scale=240）+ 周月聚合
          const daily = await tryEach([() => sinaDaily(m, c, Math.min(limit * 2, 1023))]);
          if (period === 'day') return { ...daily, bars: daily.bars.slice(-limit) };
          const agg = period === 'week' ? aggBars(daily.bars, weekKey) : aggBars(daily.bars, monthKey);
          return { bars: agg.slice(-limit), source: daily.source + '+agg' };
        }
      }
      if (m === 'US') {
        const daily = await tryEach([() => nasdaqDaily(c, Math.min(limit * 2 + 60, 1200)), () => sinaUsDaily(c), () => emKline(m, c, 'day', limit * 2)]);
        if (period === 'day') return { ...daily, bars: daily.bars.slice(-limit) };
        const agg = period === 'week' ? aggBars(daily.bars, weekKey) : aggBars(daily.bars, monthKey);
        return { bars: agg.slice(-limit), source: daily.source + '+agg' };
      }
      return tryEach([() => tencentFq(m, c, period, limit), () => emKline(m, c, period, limit)]);
    }

    // 分钟级
    if (m === 'A') {
      return tryEach([
        () => sinaMinute(m, c, period, limit),
        () => tencentMinute(m, c, period, limit),
        () => emKline(m, c, period, limit),
      ]);
    }
    return tryEach([() => emKline(m, c, period, limit)]);
  });

  const out = res.value;
  return {
    market: m,
    code: c,
    period,
    periodName: PERIOD_NAME[period],
    source: out.source,
    stale: !!res.stale,
    bars: out.bars,
  };
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */

const FUTURES_NAMES = {
  ES: '标普500期货', NQ: '纳指100期货', YM: '道指期货', RTY: '罗素2000期货',
  GC: '黄金期货', SI: '白银期货', CL: '原油期货', NG: '天然气期货', HG: '铜期货',
  ZC: '玉米期货', ZS: '大豆期货', ZW: '小麦期货', '6E': '欧元期货', '6J': '日元期货',
  RB0: '螺纹钢主力', AU0: '沪金主力', AG0: '沪银主力', CU0: '沪铜主力',
  IF0: '沪深300期货', IC0: '中证500期货', IH0: '上证50期货', IM0: '中证1000期货',
  TA0: 'PTA主力', MA0: '甲醇主力', M0: '豆粕主力', P0: '棕榈油主力', Y0: '豆油主力',
  SR0: '白糖主力', CF0: '棉花主力', SC0: '原油主力', FG0: '玻璃主力', RM0: '菜粕主力',
  OI0: '菜油主力', SA0: '纯碱主力',
};

function searchFutures(q) {
  const kw = String(q || '').trim().toUpperCase();
  if (!kw) return [];
  const out = [];
  for (const [code, name] of Object.entries(FUTURES_NAMES)) {
    if (code.includes(kw) || name.includes(q) || name.toUpperCase().includes(kw)) {
      out.push({
        market: code.endsWith('0') ? 'CNF' : 'USF',
        code,
        name,
        type: 'futures',
      });
    }
  }
  return out.slice(0, 8);
}

async function search(q) {
  const kw = String(q || '').trim();
  if (!kw) return [];
  const res = await cached('search:' + kw, 10 * 60 * 1000, async () => {
    const txt = await request('https://smartbox.gtimg.cn/s3/?v=2&q=' + encodeURIComponent(kw) + '&t=all', {
      encoding: 'gbk',
      timeout: 8000,
      referer: 'https://gu.qq.com/',
    });
    const body = unescapeUnicode((txt.match(/v_hint="([^"]*)"/) || [])[1] || '');
    const items = searchFutures(kw); // 期货合约优先（腾讯搜索不含期货）
    for (const seg of body.split('^')) {
      const p = seg.split('~');
      if (p.length < 4) continue;
      const [mkt, code, name, py] = p;
      let market = null;
      if (mkt === 'sh' || mkt === 'sz' || mkt === 'bj') market = 'A';
      else if (mkt === 'hk') market = 'HK';
      else if (mkt === 'us') market = 'US';
      else if (mkt === 'jj' || mkt === 'zs') market = 'A';
      if (!market) continue;
      items.push({ market, code, name, pinyin: py, kind: p[4] || '' });
    }
    return items.slice(0, 12);
  });
  return res.value;
}

/* ------------------------------------------------------------------ */
/* 数据源探测                                                          */
/* ------------------------------------------------------------------ */

const PROBES = [
  { id: 'tencent-quote', name: '腾讯行情（A/港/美 实时）', url: 'https://qt.gtimg.cn/q=sh000001', encoding: 'gbk', markets: ['A', 'HK', 'US'] },
  { id: 'tencent-kline', name: '腾讯K线（A/港股 日周月）', url: 'https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,5,qfq', markets: ['A', 'HK'] },
  { id: 'sina-minute', name: '新浪分钟线（A股 1/5/15/30/60）', url: 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=5&ma=no&datalen=5', markets: ['A'] },
  { id: 'nasdaq', name: '纳斯达克官方（美股日线）', url: 'https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&fromdate=2026-09-01&todate=2026-10-26&limit=5', markets: ['US'] },
  { id: 'binance', name: '币安公共行情（加密 现货）', url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', markets: ['CR'] },
  { id: 'eastmoney', name: '东方财富（通用兜底）', url: 'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f58', markets: ['A', 'HK', 'US'] },
];

async function probe() {
  return Promise.all(
    PROBES.map(async (p) => {
      const t0 = Date.now();
      try {
        const txt = await request(p.url, { encoding: p.encoding || 'utf-8', timeout: 9000, retries: 2, referer: 'https://gu.qq.com/' });
        const ok = txt && txt.length > 10;
        return { id: p.id, name: p.name, markets: p.markets, ok, ms: Date.now() - t0, note: ok ? '' : '返回为空' };
      } catch (e) {
        return { id: p.id, name: p.name, markets: p.markets, ok: false, ms: Date.now() - t0, note: String(e.message || e) };
      }
    })
  );
}

module.exports = {
  MARKETS,
  PERIOD_NAME,
  PERIOD_MINUTES,
  normCode,
  tcCode,
  bnSymbol,
  quotes,
  klines,
  search,
  probe,
  aggBars,
  weekKey,
  monthKey,
};
