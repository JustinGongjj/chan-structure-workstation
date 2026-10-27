'use strict';
/**
 * 缠论炒股工作站 —— 零依赖 HTTP 服务
 * 静态站点（web/） + JSON API（行情 / 缠论结构 / 雷达 / 干支算卦 / 数据源探测）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const S = require('./lib/sources');
const C = require('./lib/chan');
const V = require('./lib/divination');
const { cached, mapPool, cacheStats } = require('./lib/http');

const PORT = Number(process.env.PORT || 8931);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_ROOT = path.join(__dirname, '..', 'web');
const START = Date.now();

/* ------------------------------------------------------------------ */
/* 默认自选池                                                          */
/* ------------------------------------------------------------------ */

const WATCHLIST = {
  A: [
    { code: '600519', name: '贵州茅台' },
    { code: '300750', name: '宁德时代' },
    { code: '000001', name: '平安银行' },
    { code: '601899', name: '紫金矿业' },
    { code: '002594', name: '比亚迪' },
    { code: '688981', name: '中芯国际' },
  ],
  HK: [
    { code: '00700', name: '腾讯控股' },
    { code: '09988', name: '阿里巴巴-W' },
    { code: '03690', name: '美团-W' },
    { code: '01810', name: '小米集团-W' },
  ],
  US: [
    { code: 'NVDA', name: '英伟达' },
    { code: 'AAPL', name: '苹果' },
    { code: 'TSLA', name: '特斯拉' },
    { code: 'MSFT', name: '微软' },
  ],
  CR: [
    { code: 'BTCUSDT', name: 'BTC/USDT' },
    { code: 'ETHUSDT', name: 'ETH/USDT' },
    { code: 'SOLUSDT', name: 'SOL/USDT' },
    { code: 'BNBUSDT', name: 'BNB/USDT' },
  ],
};

const DATA_DIR = path.join(__dirname, '..', 'data');
const WL_FILE = path.join(DATA_DIR, 'watchlist.json');
let WL = null;

function defaultWatchlist() {
  return JSON.parse(JSON.stringify(WATCHLIST));
}

function normalizeWatchlist(raw) {
  const out = { A: [], HK: [], US: [], CR: [] };
  for (const m of ['A', 'HK', 'US', 'CR']) {
    const list = Array.isArray(raw && raw[m]) ? raw[m] : [];
    const seen = new Set();
    for (const it of list) {
      if (!it || !it.code) continue;
      const code = S.normCode(m, it.code);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out[m].push({ code, name: String(it.name || code).slice(0, 28) });
      if (out[m].length >= 60) break;
    }
  }
  const total = out.A.length + out.HK.length + out.US.length + out.CR.length;
  return total ? out : defaultWatchlist();
}

function loadWatchlist() {
  if (WL) return WL;
  try {
    WL = normalizeWatchlist(JSON.parse(fs.readFileSync(WL_FILE, 'utf8')));
  } catch (e) {
    WL = defaultWatchlist();
  }
  return WL;
}

function saveWatchlist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WL_FILE, JSON.stringify(WL, null, 2));
  } catch (e) {
    console.error('[watchlist] save failed:', e.message);
  }
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

const INDEX_BOARD = [
  { market: 'A', code: 'sh000001', name: '上证指数' },
  { market: 'A', code: 'sz399001', name: '深证成指' },
  { market: 'A', code: 'sz399006', name: '创业板指' },
  { market: 'HK', code: 'hkHSI', name: '恒生指数' },
  { market: 'HK', code: 'hkHSCEI', name: '国企指数' },
  { market: 'US', code: 'usDJI', name: '道琼斯' },
  { market: 'US', code: 'usIXIC', name: '纳斯达克' },
  { market: 'US', code: 'usINX', name: '标普500' },
  { market: 'CR', code: 'BTCUSDT', name: 'BTC' },
  { market: 'CR', code: 'ETHUSDT', name: 'ETH' },
];

/* 区间套用的级别顺序（大 → 小） */
const SUITE_PERIODS = {
  A: ['day', '60m', '30m', '15m', '5m', '1m'],
  HK: ['day', 'week'],
  US: ['day', 'week'],
  CR: ['day', '4h', '60m', '15m', '5m', '1m'],
};

const SIGNAL_WEIGHT = { '1B': 100, '2B': 92, '3B': 86, '1S': 100, '2S': 92, '3S': 86 };

/* ------------------------------------------------------------------ */
/* 业务组合                                                            */
/* ------------------------------------------------------------------ */

function toItem(raw) {
  const p = String(raw).split(':');
  if (p.length === 2) return { market: p[0].toUpperCase(), code: p[1] };
  return { market: 'A', code: raw };
}

async function getQuoteMap(items) {
  const list = await S.quotes(items.map((it) => ({ market: it.market, code: it.code })));
  const map = new Map();
  for (const q of list) map.set(q.market + ':' + S.normCode(q.market, q.code), q);
  return map;
}

async function analyzeOne({ market, code, period, limit, withQuote = true }) {
  const m = String(market || 'A').toUpperCase();
  const kl = await S.klines({ market: m, code, period: period || 'day', limit: limit || 600 });
  const res = C.analyze(kl.bars, { period: kl.period, market: m, code: S.normCode(m, code) });
  res.quote = null;
  res.source = kl.source;
  res.stale = !!kl.stale;
  if (withQuote) {
    try {
      const qs = await S.quotes([{ market: m, code }]);
      res.quote = qs[0] || null;
      if (res.quote && res.quote.name && !res.name) res.name = res.quote.name;
    } catch (e) {
      /* 报价失败不影响结构分析 */
    }
  }
  return res;
}

async function radarScan({ scope = 'all', period = 'day', limit = 480, nocache = false }) {
  const markets = scope === 'all' ? ['A', 'HK', 'US', 'CR'] : [scope.toUpperCase()];
  const wl = loadWatchlist();
  const items = [];
  for (const m of markets) for (const it of wl[m] || []) items.push({ market: m, ...it });

  const key = `radar:${markets.join(',')}:${period}:${limit}`;
  const run = async () => {
    const rows = await mapPool(items, 3, async (it) => {
      try {
        const r = await analyzeOne({ market: it.market, code: it.code, period, limit, withQuote: true });
        const bars = r.bars || [];
        const n = bars.length;
        const recent = (r.signals || []).filter((s) => s.barIdx >= n - 90);
        const last = recent[recent.length - 1] || null;
        const beichi = (r.beichi || []).filter((b) => b.barIdx >= n - 90);
        const score = last ? Math.max(0, SIGNAL_WEIGHT[last.type] + Math.max(-40, Math.round((last.barIdx - (n - 90)) / 3))) : 0;
        return {
          market: it.market,
          code: r.code || it.code,
          name: (r.quote && r.quote.name) || it.name,
          price: r.stats ? r.stats.price : null,
          pct: r.quote ? r.quote.pct : null,
          source: r.source,
          period,
          levelName: r.level.levelName,
          trend: r.trend.type,
          position: r.stats ? r.stats.position : 'none',
          pivot: r.stats && r.stats.activePivot ? r.stats.activePivot : null,
          signals: recent.slice(-3).map((s) => ({ type: s.type, name: s.name, price: s.price, barIdx: s.barIdx, t: s.t, note: s.note })),
          last,
          beichi: beichi.slice(-2).map((b) => ({ kind: b.kind, dir: b.dir, areaRatio: b.areaRatio, barIdx: b.barIdx, price: b.price })),
          summary: r.summary,
          score,
          bars: n,
        };
      } catch (e) {
        return { market: it.market, code: it.code, name: it.name, error: String(e.message || e), score: -1 };
      }
    });
    return rows.sort((a, b) => (b.score || 0) - (a.score || 0));
  };

  if (nocache) {
    return { period, scope, generatedAt: Date.now(), cached: false, stale: false, rows: await run() };
  }
  const res = await cached(key, 30000, run);
  return {
    period,
    scope,
    generatedAt: Date.now(),
    cached: !!res.cached,
    stale: !!res.stale,
    rows: res.value,
  };
}

async function suite({ market, code }) {
  const m = String(market || 'A').toUpperCase();
  const periods = SUITE_PERIODS[m] || ['day'];
  const results = await mapPool(periods, 3, async (p) => {
    try {
      const limit = ['day', 'week', 'month'].includes(p) ? 600 : 320;
      const kl = await S.klines({ market: m, code, period: p, limit });
      const res = C.analyze(kl.bars, { period: p, market: m, code });
      const sum = C.summarizeForSuite(res);
      return { ...sum, source: kl.source };
    } catch (e) {
      return { period: p, ok: false, error: String(e.message || e) };
    }
  });
  // 共振判断
  const ok = results.filter((r) => r.ok);
  const bullish = ok.filter((r) => r.beichi && r.beichi.dir < 0).length;
  const bearish = ok.filter((r) => r.beichi && r.beichi.dir > 0).length;
  const buySig = ok.filter((r) => r.signal && r.signal.type.endsWith('B')).length;
  const sellSig = ok.filter((r) => r.signal && r.signal.type.endsWith('S')).length;
  let resonance = '无多级别共振';
  if (buySig >= 2 || bullish >= 2) resonance = '多级别底部共振（买点窗口）';
  if (sellSig >= 2 || bearish >= 2) resonance = '多级别顶部共振（卖点窗口）';
  return { market: m, code: S.normCode(m, code), periods, levels: results, resonance };
}

async function overview() {
  const items = INDEX_BOARD.map((x) => ({ market: x.market, code: x.code }));
  const qm = await getQuoteMap(items);
  const indices = INDEX_BOARD.map((x) => {
    const q = qm.get(x.market + ':' + S.normCode(x.market, x.code));
    return {
      market: x.market,
      code: x.code,
      name: x.name,
      price: q ? q.price : null,
      pct: q ? q.pct : null,
      change: q ? q.change : null,
      high: q ? q.high : null,
      low: q ? q.low : null,
      timeText: q ? q.timeText : '',
    };
  });
  const wl = loadWatchlist();
  const watchItems = [];
  for (const m of ['A', 'HK', 'US', 'CR']) for (const it of wl[m] || []) watchItems.push({ market: m, ...it });
  const wm = await getQuoteMap(watchItems);
  const watch = watchItems.map((it) => {
    const q = wm.get(it.market + ':' + S.normCode(it.market, it.code));
    return {
      market: it.market,
      code: it.code,
      name: (q && q.name) || it.name,
      price: q ? q.price : null,
      pct: q ? q.pct : null,
      change: q ? q.change : null,
      high: q ? q.high : null,
      low: q ? q.low : null,
      prevClose: q ? q.prevClose : null,
      timeText: q ? q.timeText : '',
    };
  });
  const pulse = {};
  for (const m of ['A', 'HK', 'US', 'CR']) {
    const rows = watch.filter((w) => w.market === m && Number.isFinite(w.pct));
    const avg = rows.length ? rows.reduce((a, b) => a + b.pct, 0) / rows.length : 0;
    pulse[m] = {
      avgPct: +avg.toFixed(2),
      up: rows.filter((r) => r.pct > 0).length,
      down: rows.filter((r) => r.pct < 0).length,
      flat: rows.filter((r) => r.pct === 0).length,
      count: rows.length,
      heat: Math.max(0, Math.min(100, Math.round(50 + avg * 12))),
    };
  }
  return { asof: Date.now(), indices, watch, pulse };
}

/* ------------------------------------------------------------------ */
/* HTTP 基础设施                                                       */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(WEB_ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WEB_ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

const routes = {
  '/api/health': async () => ({ ok: true, uptimeSec: Math.round((Date.now() - START) / 1000), cache: cacheStats(), node: process.version }),
  '/api/markets': async () => ({
    markets: S.MARKETS,
    watchlist: WATCHLIST,
    indices: INDEX_BOARD,
    periods: S.PERIOD_NAME,
    suite: SUITE_PERIODS,
  }),
  '/api/overview': async () => overview(),
  '/api/watchlist': async () => ({ list: loadWatchlist(), defaults: WATCHLIST }),
  '/api/sources': async () => ({ probedAt: Date.now(), sources: await cached('probe', 60000, () => S.probe()).then((r) => r.value) }),
  '/api/search': async (u) => ({ q: u.searchParams.get('q') || '', items: await S.search(u.searchParams.get('q') || '') }),
  '/api/quote': async (u) => {
    const list = (u.searchParams.get('list') || '').split(',').filter(Boolean).map(toItem);
    if (!list.length) throw new Error('缺少 list 参数');
    return { quotes: await S.quotes(list) };
  },
  '/api/kline': async (u) => {
    const market = u.searchParams.get('market') || 'A';
    const code = u.searchParams.get('code') || u.searchParams.get('symbol');
    const period = u.searchParams.get('period') || 'day';
    const limit = Math.min(Number(u.searchParams.get('limit') || 600), 1000);
    return await S.klines({ market, code, period, limit });
  },
  '/api/chan': async (u) => {
    const market = u.searchParams.get('market') || 'A';
    const code = u.searchParams.get('code') || u.searchParams.get('symbol');
    const period = u.searchParams.get('period') || 'day';
    const limit = Math.min(Number(u.searchParams.get('limit') || 600), 1000);
    return await analyzeOne({ market, code, period, limit, withQuote: true });
  },
  '/api/suite': async (u) => suite({ market: u.searchParams.get('market'), code: u.searchParams.get('code') || u.searchParams.get('symbol') }),
  '/api/radar': async (u) =>
    radarScan({
      scope: u.searchParams.get('scope') || 'all',
      period: u.searchParams.get('period') || 'day',
      nocache: u.searchParams.get('nocache') === '1',
    }),
  '/api/daily': async () => V.daily(),
  '/api/divination': async (u) => {
    const market = (u.searchParams.get('market') || 'A').toUpperCase();
    const code = u.searchParams.get('code') || u.searchParams.get('symbol') || '';
    const mode = u.searchParams.get('mode') || (u.searchParams.get('method') === 'time' ? 'time' : 'price');
    const nonce = Math.max(0, Math.trunc(Number(u.searchParams.get('nonce') || 0)));
    const ts = u.searchParams.get('ts') ? Number(u.searchParams.get('ts')) : undefined;
    let price = null;
    let pct = null;
    let qName = u.searchParams.get('name') || '';
    if (code && mode !== 'time') {
      try {
        const qs = await S.quotes([{ market, code }]);
        const q = qs[0];
        if (q && Number.isFinite(q.price) && q.price > 0) {
          price = q.price;
          pct = q.pct;
          qName = qName || q.name || '';
        }
      } catch (e) {
        /* 取不到实时价时退回仅哈希/时间起卦 */
      }
    }
    return V.analyze({ market, code, name: qName, mode, nonce, ts, price, pct });
  },
};

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }).end();
    return;
  }
  // 自选池写操作
  if (u.pathname === '/api/watchlist' || u.pathname === '/api/watchlist/reset') {
    try {
      const wl = loadWatchlist();
      if (u.pathname === '/api/watchlist/reset' && req.method === 'POST') {
        WL = defaultWatchlist();
        saveWatchlist();
        sendJSON(res, 200, { ok: true, list: WL, message: '已恢复默认自选池' });
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const market = String(body.market || 'A').toUpperCase();
        const code = body.code != null ? String(body.code) : '';
        if (!['A', 'HK', 'US', 'CR'].includes(market)) throw new Error('不支持的市场');
        if (!code.trim()) throw new Error('请填写代码');
        const norm = S.normCode(market, code);
        if (!wl[market]) wl[market] = [];
        if (wl[market].some((x) => x.code === norm)) throw new Error('该标的已在自选池中');
        let name = String(body.name || '').trim();
        if (!name) {
          try {
            const qs = await S.quotes([{ market, code: norm }]);
            if (qs[0] && qs[0].name) name = qs[0].name;
          } catch (e) {
            /* 名字取不到就用代码 */
          }
        }
        wl[market].push({ code: norm, name: name || norm });
        saveWatchlist();
        sendJSON(res, 200, { ok: true, list: wl, added: { market, code: norm, name: name || norm } });
        return;
      }
      if (req.method === 'DELETE') {
        const market = String(u.searchParams.get('market') || '').toUpperCase();
        const code = String(u.searchParams.get('code') || '');
        if (!market || !code) throw new Error('缺少 market / code');
        const norm = S.normCode(market, code);
        if (wl[market]) wl[market] = wl[market].filter((x) => x.code !== norm);
        saveWatchlist();
        sendJSON(res, 200, { ok: true, list: wl, removed: { market, code: norm } });
        return;
      }
      if (req.method !== 'GET') {
        sendJSON(res, 405, { ok: false, error: '不支持的方法' });
        return;
      }
      sendJSON(res, 200, { ok: true, list: loadWatchlist(), defaults: WATCHLIST });
      return;
    } catch (e) {
      sendJSON(res, 400, { ok: false, error: String(e.message || e) });
      return;
    }
  }

  const handler = routes[u.pathname];
  if (!handler) {
    if (u.pathname.startsWith('/api/')) {
      sendJSON(res, 404, { ok: false, error: '未知接口: ' + u.pathname });
      return;
    }
    serveStatic(req, res, u.pathname);
    return;
  }
  try {
    const data = await handler(u);
    sendJSON(res, 200, { ok: true, ...data });
  } catch (e) {
    console.error('[api]', u.pathname, String(e.message || e));
    sendJSON(res, 500, { ok: false, error: String(e.message || e), path: u.pathname });
  } finally {
    if (process.env.LOG !== '0') console.log(`${req.method} ${u.pathname} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  缠论炒股工作站 · Chan Workstation`);
  console.log(`  http://127.0.0.1:${PORT}/  (bind ${HOST}:${PORT})\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
