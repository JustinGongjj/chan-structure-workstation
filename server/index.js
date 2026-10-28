'use strict';
/**
 * 缠论工作站 —— 零依赖 HTTP 服务
 * 静态站点（web/） + JSON API（行情 / 缠论结构 / 雷达 / 干支算卦 / 数据源探测）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');

const S = require('./lib/sources');
const C = require('./lib/chan');
const V = require('./lib/divination');
const TIMING = require('./lib/timing');
const BT = require('./lib/backtest');
const META = require('./lib/metaphysics');
const K = require('./lib/chan-lessons');
const DRAW = require('./lib/drawing');
const GAME = require('./lib/game');
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
  return out; // 空列表也是合法状态（用户可能全删了），不要回退成默认
}

function loadWatchlist() {
  if (WL) return WL;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(WL_FILE, 'utf8'));
  } catch (e) {
    // 文件不存在 → 用默认；文件损坏 → 不要静默当成默认（先备份再说）
    if (e.code !== 'ENOENT') {
      try { fs.copyFileSync(WL_FILE, WL_FILE + '.corrupt-' + Date.now()); } catch (e2) {}
      console.error('[watchlist] 文件损坏，已备份：', e.message);
    }
  }
  WL = raw ? normalizeWatchlist(raw) : defaultWatchlist();
  return WL;
}

function saveWatchlist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = WL_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(WL, null, 2));
  fs.renameSync(tmp, WL_FILE); // 原子替换：进程被杀也不会留下半个文件
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
  '.zip': 'application/zip',
  '.bundle': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.zip': 'application/zip',
  '.bundle': 'application/octet-stream',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const GZIP_EXT = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.svg', '.md', '.txt']);

function sendBuffer(req, res, buf, ext, extra = {}) {
  const ver = assetVersion();
  const etag = 'W/"' + buf.length.toString(16) + '-' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) + '"';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': GZIP_EXT.has(ext) ? 'no-cache' : 'public, max-age=300',
    ETag: etag,
    'X-Asset-Version': ver,
    Vary: 'Accept-Encoding',
    ...extra,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  const gz = GZIP_EXT.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '') && buf.length > 1024;
  if (gz) {
    const z = zlib.gzipSync(buf, { level: 6 });
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': z.length });
    res.end(z);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': buf.length });
  res.end(buf);
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/* ---------------- 构建指纹 ----------------
   手机端"改了却还是旧的"绝大多数是缓存：Service Worker + HTTP 缓存叠加。
   把 web/ 下代码资源的 mtime+size 汇总成一个指纹，HTML 里的 __ASSET_V__ 会被替换成它，
   于是每次部署 CSS/JS 的 URL 都会变，任何缓存层都不可能再拿旧文件糊弄用户。 */
/* 只统计 mtime+size，不读内容：便宜到可以每 1.5 秒重算，
   这样"改完文件不重启"也能立刻换 URL（否则哈希会停在启动那一刻）。 */
let _vCache = { at: 0, v: 'dev' };
function assetVersion() {
  const now = Date.now();
  if (now - _vCache.at < 1500) return _vCache.v;
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    let list = [];
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return list; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['downloads', 'node_modules'].includes(e.name)) continue;
        list = list.concat(walk(p));
      } else if (/\.(js|css|html|webmanifest)$/.test(e.name)) {
        try { const st = fs.statSync(p); h.update(path.relative(WEB_ROOT, p) + ':' + st.size + ':' + st.mtimeMs + ';'); } catch (e2) {}
      }
    }
    return list;
  };
  walk(WEB_ROOT);
  _vCache = { at: now, v: h.digest('hex').slice(0, 10) };
  return _vCache.v;
}
const ASSET_V = assetVersion(); // 仅用于日志/兼容，取值为启动瞬间

const MOBILE_UA = /Android|iPhone|iPod|iPad|Mobile|HarmonyOS|MicroMessenger/i;

function serveStatic(req, res, pathname) {
  // 手机浏览器访问桌面首页 → 直接给手机版（可用 ?desktop=1 留在桌面版）
  if (pathname === '/' && MOBILE_UA.test(req.headers['user-agent'] || '') && !/[?&]desktop=1/.test(req.url)) {
    res.writeHead(302, { Location: '/m/' }).end();
    return;
  }
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
    const noCache = ['.html', '.css', '.js', '.json', '.webmanifest'].includes(ext);
    if (ext === '.html') {
      // 注入构建指纹：?v=__ASSET_V__ → 每次部署都变，绕开一切缓存
      fs.readFile(file, 'utf8', (e2, html) => {
        if (e2) { res.writeHead(500).end('read error'); return; }
        const ver = assetVersion();
        const out = html
          .replace(/__ASSET_V__/g, ver)
          .replace('</head>', `<script>window.__ASSET_V__=${JSON.stringify(ver)};</script></head>`);
        sendBuffer(req, res, Buffer.from(out), '.html', { 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      });
      return;
    }
    if (GZIP_EXT.has(ext) || st.size < 512 * 1024) {
      fs.readFile(file, (e2, buf) => {
        if (e2) { res.writeHead(500).end('read error'); return; }
        sendBuffer(req, res, buf, ext);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=300',
      'X-Asset-Version': ver,
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- 手绘线存储 ----------------
   结构：{ "A:600519:day": { updatedAt, drawings: [...] } }
   用原子写，避免进程被杀造成半个文件；单文件够用（几 KB），不做数据库。 */
const DRAW_FILE = path.join(DATA_DIR, 'drawings.json');
let DRAW_STORE = null;

function loadDrawings() {
  if (DRAW_STORE) return DRAW_STORE;
  try {
    DRAW_STORE = JSON.parse(fs.readFileSync(DRAW_FILE, 'utf8')) || {};
  } catch (e) {
    DRAW_STORE = {};
  }
  return DRAW_STORE;
}

function saveDrawings() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DRAW_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DRAW_STORE, null, 2));
  fs.renameSync(tmp, DRAW_FILE);
}

const drawKey = (market, code, period) => {
  const m = String(market || 'A').toUpperCase();
  const norm = code ? S.normCode(m, code) || String(code).toUpperCase() : '';
  return `${m}:${norm}:${String(period || 'day')}`;
};

function sanitizeDrawing(d) {
  const type = ['trend', 'hline', 'rect', 'ray', 'note'].includes(d && d.type) ? d.type : 'trend';
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    id: String((d && d.id) || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    type,
    x1: num(d && d.x1),
    y1: num(d && d.y1),
    ...(type === 'hline' ? {} : { x2: num(d && d.x2), y2: num(d && d.y2) }),
    label: String((d && d.label) || '').slice(0, 40),
    color: String((d && d.color) || '').slice(0, 16)
  };
}

const routes = {
  '/api/health': async () => ({ ok: true, uptimeSec: Math.round((Date.now() - START) / 1000), cache: cacheStats(), node: process.version, assetVersion: assetVersion() }),
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
  '/api/game/map': async () => {
    const map = GAME.buildMap(K);
    return { ok: true, ...map, generatedAt: Date.now() };
  },
  '/api/game/level': async (u) => {
    const no = Number(u.searchParams.get('no') || 1);
    return await GAME.makeLevel(K, no);
  },
  '/api/drawings': async (u) => {
    const key = drawKey(u.searchParams.get('market'), u.searchParams.get('code'), u.searchParams.get('period'));
    const rec = loadDrawings()[key] || { drawings: [], updatedAt: null };
    return { ok: true, key, drawings: rec.drawings || [], updatedAt: rec.updatedAt || null };
  },
  '/api/daily': async () => V.daily(),
  '/api/chan-lessons': async () => ({
    themes: K.THEMES,
    lessons: K.LESSONS,
    coverage: K.COVERAGE,
  }),
  '/api/chan-lore': async () => ({ lore: K.LORE, meta: K.LORE_META }),
  '/api/metaphysics': async (u) => {
    const id = u.searchParams.get('id');
    return id ? META.get(id) || { error: '未知体系' } : META.list();
  },
  '/api/timing': async (u) => {
    const methods = (u.searchParams.get('methods') || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return TIMING.evaluate({
      market: (u.searchParams.get('market') || 'A').toUpperCase(),
      code: u.searchParams.get('code') || u.searchParams.get('symbol') || '',
      ts: u.searchParams.get('ts') ? Number(u.searchParams.get('ts')) : Date.now(),
      methods: methods.length ? methods : undefined,
      weights: u.searchParams.get('weights') ? JSON.parse(u.searchParams.get('weights')) : undefined,
    });
  },
  '/api/timing/validate': async (u) => {
    const market = (u.searchParams.get('market') || 'A').toUpperCase();
    const code = u.searchParams.get('code') || u.searchParams.get('symbol') || '';
    const period = u.searchParams.get('period') || 'day';
    const kl = await S.klines({ market, code, period, limit: 800 });
    const methods = (u.searchParams.get('methods') || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const stats = BT.timingStats(kl.bars, (ts) => TIMING.evaluate({ market, code, ts, methods: methods.length ? methods : undefined }), {
      days: Number(u.searchParams.get('days') || 160),
      horizon: Number(u.searchParams.get('horizon') || 1),
    });
    return {
      market,
      code: S.normCode(market, code),
      period,
      periodName: kl.periodName,
      source: kl.source,
      bars: kl.bars.length,
      methodMeta: TIMING.METHODS,
      ...stats,
    };
  },
  '/api/backtest': async (u) => {
    const market = (u.searchParams.get('market') || 'A').toUpperCase();
    const code = u.searchParams.get('code') || u.searchParams.get('symbol') || '';
    const period = u.searchParams.get('period') || 'day';
    const kl = await S.klines({ market, code, period, limit: 800 });
    const ana = C.analyze(kl.bars, { period, market, code });
    const stats = BT.signalStats(ana.bars, ana.signals, {
      horizon: Number(u.searchParams.get('horizon') || 5),
      feeBps: Number(u.searchParams.get('feeBps') || 8),
    });
    return {
      market,
      code: S.normCode(market, code),
      period,
      level: ana.level,
      source: kl.source,
      bars: ana.bars.length,
      signals: ana.signals.length,
      ...stats,
    };
  },
  '/api/drawings/verify': async (u, pre) => {
    const body = pre && pre.body ? pre.body : await readBody(u.__req);
    const market = String(body.market || 'A').toUpperCase();
    const code = body.code || '';
    const period = body.period || 'day';
    const drawings = Array.isArray(body.drawings) ? body.drawings.slice(0, 40) : [];
    const res = await analyzeOne({ market, code, period, limit: 600, withQuote: false });
    if (!res || !res.ok) throw new Error('行情不可用，暂时无法校验');
    const out = DRAW.verify({ drawings, analysis: res, market, code, period });
    out.target = { market, code, name: res.name || '', price: res.quote ? res.quote.price : null };
    out.analysisSummary = {
      trend: res.trend && res.trend.type,
      bis: (res.bis || []).length,
      pivots: (res.pivots || []).length,
      signals: (res.signals || []).slice(-3).map((s) => ({ type: s.type, name: s.name, barIdx: s.barIdx, price: s.price }))
    };
    return out;
  },
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
  // 闯关判分（POST）：答案只在服务端重算
  if (u.pathname === '/api/game/answer' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const out = await GAME.gradeLevel(K, { no: body.no, token: body.token, answer: body.answer });
      sendJSON(res, 200, out);
    } catch (e) {
      sendJSON(res, 400, { ok: false, error: e.message });
    }
    return;
  }
  // 手绘线保存（POST）与校验（POST /api/drawings/verify）
  if (u.pathname === '/api/drawings' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const key = drawKey(body.market, body.code, body.period);
      if (!body.code) throw new Error('缺少 code');
      const all = Array.isArray(body.drawings) ? body.drawings : [];
      // 超上限时保留最新的 40 条（之前是保留最旧的，等于把刚画的丢掉）
      const kept = all.length > 40 ? all.slice(-40) : all;
      const list = kept.map(sanitizeDrawing);
      loadDrawings()[key] = { drawings: list, updatedAt: Date.now() };
      saveDrawings();
      console.log(`[drawings] save ${key} · ${list.length} 条${all.length > 40 ? ` (丢弃最早 ${all.length - 40} 条)` : ''}`);
      sendJSON(res, 200, { ok: true, key, count: list.length, dropped: Math.max(0, all.length - 40), drawings: list });
    } catch (e) {
      sendJSON(res, 400, { ok: false, error: e.message });
    }
    return;
  }
  if (u.pathname === '/api/drawings/verify' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const out = await routes['/api/drawings/verify'](u, { body });
      sendJSON(res, 200, out);
    } catch (e) {
      sendJSON(res, 400, { ok: false, error: e.message });
    }
    return;
  }
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
        if (!norm) throw new Error('代码格式不正确');
        if (!wl[market]) wl[market] = [];
        if (wl[market].length >= 60) throw new Error('该市场自选已达 60 个上限');
        if (wl[market].some((x) => x.code === norm)) throw new Error('该标的已在自选池中');
        let name = String(body.name || '').trim();
        let quote = null;
        try {
          const qs = await S.quotes([{ market, code: norm }]);
          quote = qs && qs[0];
        } catch (e) { /* 网络异常时仍然允许添加，只是没名字 */ }
        if (quote && quote.price > 0) {
          if (!name) name = quote.name || norm;
        } else if (!name) {
          throw new Error('查不到该标的的行情，请检查代码');
        }
        // await 期间可能已有并发请求加过同一个，落库前再查一次
        if (wl[market].some((x) => x.code === norm)) throw new Error('该标的已在自选池中');
        wl[market].push({ code: norm, name: name || norm });
        saveWatchlist();
        sendJSON(res, 200, { ok: true, list: wl, added: { market, code: norm, name: name || norm } });
        return;
      }
      if (req.method === 'DELETE') {
        const dbody = await readBody(req).catch(() => ({}));
        const market = String(u.searchParams.get('market') || dbody.market || '').toUpperCase();
        const code = String(u.searchParams.get('code') || dbody.code || '');
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
  console.log(`\n  缠论工作站 · Chan Workstation`);
  console.log(`  http://127.0.0.1:${PORT}/  (bind ${HOST}:${PORT})\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
