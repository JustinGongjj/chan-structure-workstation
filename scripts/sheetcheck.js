#!/usr/bin/env node
/**
 * 弹层矩阵巡检：5 个 Tab × 3 种弹层 × 2 皮肤 × 2 主题。
 * 专治"弹层透明 / 被页面压住 / 标题被挤成 0 宽 / 按钮撑满整行"这类框架冲突。
 *
 *   node scripts/sheetcheck.js [--base ...] [--shots /tmp/sheets]
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
const UA_AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:8931');
const SHOTS = arg('shots', '');
const PORT = 9600 + Math.floor(Math.random() * 90);
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) (this.handlers.get(m.method) || []).forEach(f => f(m.params));
    });
  }
  on(m, fn) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 25000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

const PROBE = `(() => {
  const mask = document.querySelector('.sheet-mask.show');
  const sheet = document.getElementById('sheet');
  if (!mask || !sheet) return { open: false };
  const r = sheet.getBoundingClientRect();
  const cx = Math.round(r.left + Math.min(r.width / 2, r.width - 8));
  const cy = Math.round(r.top + 40);
  const hit = document.elementFromPoint(cx, cy);
  const bg = getComputedStyle(sheet).backgroundColor;
  const zero = [...sheet.querySelectorAll('h1,h2,h3,h4,button,input,.chip')]
    .filter((e) => { const b = e.getBoundingClientRect(); return b.width < 1 && e.textContent.trim().length > 0; })
    .map((e) => (e.tagName + ':' + e.textContent.trim().slice(0, 12)));
  const overWide = [...sheet.querySelectorAll('*')]
    .filter((e) => e.getBoundingClientRect().width > window.innerWidth + 1)
    .slice(0, 3).map((e) => e.tagName + '.' + (e.className || ''));
  return {
    open: true,
    inside: !!hit && sheet.contains(hit),
    bg,
    top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
    zeroWidth: zero.slice(0, 3),
    overWide,
    title: (sheet.querySelector('h3,h2')?.textContent || '').trim().slice(0, 20)
  };
})()`;

async function openPage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--touch-events=enabled',
    '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank'
  ], { stdio: 'ignore', env: ENV });
  let list;
  for (let i = 0; i < 120; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(100); }
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => errors.push((p.exceptionDetails?.exception?.description || '').split('\n')[0]));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, errors, close: () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); } };
}

const SHEETS = {
  more: `document.getElementById('moreBtn').click()`,
  search: `document.getElementById('searchBtn').click()`,
  watch: `(() => { const b = document.getElementById('ovEdit') || document.getElementById('rEdit'); if (b) b.click(); })()`
};
const TABS = ['overview', 'radar', 'structure', 'theory', 'divination'];

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const envs = [
    { name: 'ios-dark', q: 'skin=ios&theme=dark', w: 390, h: 844, ua: UA_IOS },
    { name: 'ios-light', q: 'skin=ios&theme=light', w: 390, h: 844, ua: UA_IOS },
    { name: 'android-dark', q: 'skin=android&theme=dark', w: 412, h: 915, ua: UA_AND },
    { name: 'android-light', q: 'skin=android&theme=light', w: 412, h: 915, ua: UA_AND }
  ];
  const fails = [];
  let total = 0;
  for (const env of envs) {
    const { cdp, errors, close } = await openPage();
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: env.w, height: env.h, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Page.navigate', { url: `${BASE}/m/?${env.q}` });
      await sleep(4600);
      for (const tab of TABS) {
        await cdp.eval(`document.querySelector('[data-tab="${tab}"]').click()`);
        await sleep(tab === 'structure' ? 5200 : 2800);
        for (const [kind, opener] of Object.entries(SHEETS)) {
          // 「管理自选」只在总览/雷达有入口
          if (kind === 'watch') {
            const has = await cdp.eval(`!!(document.getElementById('ovEdit') || document.getElementById('rEdit'))`);
            if (!has) continue;
          }
          const opened = await cdp.eval(`(() => { try { ${opener}; return true; } catch (e) { return false; } })()`);
          await sleep(kind === 'search' ? 1400 : 1200);
          const probe = await cdp.eval(PROBE);
          total++;
          const bad = [];
          if (!opened || !probe.open) bad.push('弹层没打开');
          else {
            if (!probe.inside) bad.push('弹层被页面内容盖住（层级问题）');
            if (/rgba\(0, 0, 0, 0\)|transparent/.test(probe.bg)) bad.push(`弹层背景透明 ${probe.bg}`);
            if (probe.zeroWidth.length) bad.push('零宽元素: ' + probe.zeroWidth.join(','));
            if (probe.overWide.length) bad.push('超宽元素: ' + probe.overWide.join(','));
            if (probe.h < 120) bad.push(`弹层高度异常 ${probe.h}px`);
            if (probe.w > env.w) bad.push(`弹层宽 ${probe.w} > 视口 ${env.w}`);
          }
          if (bad.length) fails.push(`${env.name} / ${tab} / ${kind}${probe.title ? '（' + probe.title + '）' : ''}: ${bad.join('；')}`);
          if (SHOTS) {
            const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(SHOTS, `${env.name}-${tab}-${kind}.png`), Buffer.from(r.data, 'base64'));
          }
          await cdp.eval(`document.getElementById('sheetClose')?.click()`);
          await sleep(500);
        }
      }
      if (errors.length) fails.push(`${env.name}: JS 报错 ${errors.slice(0, 2).join(' | ')}`);
    } finally { close(); }
  }
  for (const f of fails) console.log('❌ ' + f);
  console.log(`\n弹层巡检：${total - fails.length}/${total} 通过`);
  process.exit(fails.length ? 1 : 0);
})();
