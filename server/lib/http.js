'use strict';
/**
 * 极简 HTTP 客户端 + 缓存层（零依赖，Node 18+）
 * 所有外部行情请求都从这里走：超时、重试、编码、缓存、并发去重。
 */

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
  'Cache-Control': 'no-cache',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 原始请求，返回文本；encoding 支持 'gbk'（腾讯/新浪部分接口） */
async function request(url, opts = {}) {
  const { timeout = 9000, headers = {}, retries = 1, encoding = 'utf-8', referer } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const h = { ...DEFAULT_HEADERS, ...headers };
      if (referer) h.Referer = referer;
      const res = await fetch(url, { signal: ctrl.signal, headers: h, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const text = new TextDecoder(encoding).decode(buf);
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** JSON 请求（自动去掉 jsonp 包裹） */
async function getJSON(url, opts = {}) {
  const txt = await request(url, opts);
  const cleaned = String(txt)
    .replace(/^\uFEFF/, '')
    .replace(/^[^{[]*?[;)]\s*$/, '')
    .trim();
  // 处理形如 var hq_str_xx="..." 的裹层
  const m = cleaned.match(/^[\w$.]+\s*=\s*([\s\S]*?);?\s*$/);
  const body = m && !/^[\[{]/.test(cleaned) ? m[1] : cleaned;
  try {
    return JSON.parse(body);
  } catch (e) {
    const start = Math.min(...[body.indexOf('{'), body.indexOf('[')].filter((i) => i >= 0));
    const slice = body.slice(start).replace(/;\s*$/, '');
    return JSON.parse(slice);
  }
}

/* ------------------------------------------------------------------ */
/* 缓存：TTL + 并发去重 + 失败回退旧值                                 */
/* ------------------------------------------------------------------ */
const cache = new Map(); // key -> { exp, val }
const inflight = new Map(); // key -> Promise

async function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return { value: hit.val, cached: true, stale: false };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const val = await fn();
      cache.set(key, { exp: Date.now() + ttlMs, val });
      return { value: val, cached: false, stale: false };
    } catch (e) {
      if (hit) return { value: hit.val, cached: true, stale: true, error: String(e.message || e) };
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** 简单并发池 */
async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        out[idx] = await worker(items[idx], idx);
      } catch (e) {
        out[idx] = { error: String(e.message || e) };
      }
    }
  });
  await Promise.all(runners);
  return out;
}

function cacheStats() {
  return { entries: cache.size, inflight: inflight.size };
}

module.exports = { request, getJSON, cached, mapPool, sleep, cacheStats };
