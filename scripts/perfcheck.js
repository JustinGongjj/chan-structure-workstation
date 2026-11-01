#!/usr/bin/env node
/**
 * 首屏性能基线：真实浏览器 + CDP 的 Network 统计。
 *
 *   node scripts/perfcheck.js                 # 打印表格
 *   node scripts/perfcheck.js --json          # 机读
 *   node scripts/perfcheck.js --budget 400    # 移动端总传输预算(KB)，超出即失败
 *
 * 统计口径：压缩后传输字节（Content-Encoding: gzip 生效值），
 * 这才是手机 4G/5G 上真正要下载的量，也是对"换掉 Framework7 能省多少"的唯一诚实依据。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME_BIN ||
  '/home/node/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const ENV = {
  ...process.env,
  LD_LIBRARY_PATH: '/home/node/default/.chrome-deps/usr/lib/x86_64-linux-gnu:/home/node/default/.chrome-deps/usr/lib:/home/node/default/.chrome-deps/lib/x86_64-linux-gnu',
  FONTCONFIG_FILE: '/home/node/fontconfig.conf'
};
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:8931');
const BUDGET = Number(arg('budget', '420')); // KB，移动端首屏（不含行情接口后的二次渲染）
const PORT = 9500 + Math.floor(Math.random() * 90);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function measure({ url, w, h, ua, mobile }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, `--window-size=${w},${h}`, 'about:blank'
  ], { stdio: 'ignore', env: ENV });
  let list;
  for (let i = 0; i < 120; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(100); }
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const pending = new Map();
  const reqs = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
    if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, { url: m.params.request.url, type: m.params.type });
    if (m.method === 'Network.responseReceived') {
      const r = reqs.get(m.params.requestId);
      if (r) { r.status = m.params.response.status; r.type = m.params.type; r.mime = m.params.response.mimeType; }
    }
    if (m.method === 'Network.loadingFinished') {
      const r = reqs.get(m.params.requestId);
      if (r) r.bytes = m.params.encodedDataLength || 0;
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)); } }, 30000);
  });
  await send('Network.enable');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.setUserAgentOverride', { userAgent: ua });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile });
  await send('Page.navigate', { url });
  await sleep(6500);
  const timing = await send('Runtime.evaluate', {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]));
      return {
        dcl: Math.round(nav.domContentLoadedEventEnd || 0),
        load: Math.round(nav.loadEventEnd || 0),
        ttfb: Math.round(nav.responseStart || 0),
        fcp: paints['first-contentful-paint'] || null,
        domNodes: document.getElementsByTagName('*').length,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
      };
    })()`, returnByValue: true
  });
  try { ws.close(); } catch {}
  proc.kill('SIGKILL');

  const list2 = [...reqs.values()].filter(r => r.url.startsWith(BASE) || r.url.startsWith('/'));
  const byType = {};
  let total = 0;
  for (const r of list2) {
    const b = r.bytes || 0;
    total += b;
    const t = r.type || 'Other';
    byType[t] = (byType[t] || 0) + b;
  }
  return {
    url, requests: list2.length, totalKB: +(total / 1024).toFixed(1),
    byTypeKB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
    ...timing.result.value,
    big: list2.filter(r => (r.bytes || 0) > 20000).map(r => ({
      path: r.url.replace(BASE, '').split('?')[0], kb: +((r.bytes || 0) / 1024).toFixed(1), type: r.type
    })).sort((a, b) => b.kb - a.kb)
  };
}

(async () => {
  const cases = [
    { name: '手机版 /m/ (iPhone 390×844)', url: `${BASE}/m/?skin=ios&theme=dark`, w: 390, h: 844, ua: UA_IOS, mobile: true },
    { name: '手机版 /m/ (Android 412×915)', url: `${BASE}/m/?skin=android&theme=dark`, w: 412, h: 915, ua: UA_IOS, mobile: true },
    { name: '电脑版 / (1440×900)', url: `${BASE}/?desktop=1`, w: 1440, h: 900, ua: UA_DESK, mobile: false }
  ];
  const out = [];
  for (const c of cases) out.push({ name: c.name, ...(await measure(c)) });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('首屏传输基线（gzip 后字节，真实浏览器统计）\n');
    for (const r of out) {
      console.log(`${r.name}`);
      console.log(`  传输 ${r.totalKB} KB / ${r.requests} 请求 · DOM ${r.domNodes} 节点 · heap ${r.heapMB ?? '-'} MB`);
      console.log(`  分类型：${Object.entries(r.byTypeKB).map(([k, v]) => `${k} ${v}KB`).join(' · ')}`);
      console.log(`  时间：TTFB ${r.ttfb}ms · FCP ${r.fcp ?? '-'}ms · DCL ${r.dcl}ms · load ${r.load}ms`);
      if (r.big.length) console.log(`  大头：${r.big.slice(0, 4).map(b => `${b.path} ${b.kb}KB`).join(' · ')}`);
      console.log('');
    }
  }
  const over = out.filter(r => r.totalKB > BUDGET);
  if (over.length) {
    console.log(`❌ 超出预算 ${BUDGET}KB：` + over.map(r => `${r.name} ${r.totalKB}KB`).join('、'));
    process.exit(1);
  }
  console.log(`✅ 全部页面首屏传输 ≤ ${BUDGET}KB`);
})();
