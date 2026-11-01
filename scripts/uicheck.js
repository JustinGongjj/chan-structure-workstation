#!/usr/bin/env node
/**
 * UI 冒烟巡检（真实浏览器 + CDP，无第三方依赖）
 *
 *   node scripts/uicheck.js                 # 巡检默认矩阵
 *   node scripts/uicheck.js --shots /tmp    # 同时截图
 *   node scripts/uicheck.js --base http://127.0.0.1:8931
 *
 * 检查项：
 *   1. 页面报错（JS 异常 / console.error / 资源 4xx-5xx）
 *   2. 横向溢出（scrollWidth > innerWidth）
 *   3. 纵向滚动（真实滚动手势后 scrollTop 是否变化）—— 手机"上下滑死机"的回归项
 *   4. 轮询不打断滚动（12s 后 scrollTop 不被重置）
 *   5. 5 个 Tab 都能渲染出内容
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME_BIN ||
  '/home/node/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:8931');
const SHOTS = arg('shots', '');
const PORT = 9400 + Math.floor(Math.random() * 200);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 最小 CDP 客户端 ---------- */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach(fn => fn(msg.params));
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function launchChrome(ua, w, h) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uicheck-'));
  const env = { ...process.env,
    LD_LIBRARY_PATH: '/home/node/default/.chrome-deps/usr/lib/x86_64-linux-gnu:/home/node/default/.chrome-deps/usr/lib:/home/node/default/.chrome-deps/lib/x86_64-linux-gnu',
    FONTCONFIG_FILE: '/home/node/fontconfig.conf' };
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--touch-events=enabled',
    '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    `--user-agent=${ua}`, `--window-size=${w},${h}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], env });
  let errBuf = '';
  proc.stderr.on('data', d => { errBuf += d.toString(); });
  for (let i = 0; i < 100; i++) {
    try { await fetchJson(`http://127.0.0.1:${PORT}/json/version`); return { proc, dir }; }
    catch { await sleep(100); }
  }
  throw new Error('chrome 未启动: ' + errBuf.slice(0, 400));
}

async function connect() {
  const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p =>
    errors.push('EXC ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').split('\n')[0]));
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push('CONSOLE ' + p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  });
  cdp.on('Log.entryAdded', p => {
    // 浏览器自身的策略提示（震动需用户手势、autoplay 等）不算应用错误
    const noise = /navigator\.vibrate|favicon|Autoplay|third-party cookie/i;
    if (p.entry.level === "error" && !noise.test(p.entry.text || '')) errors.push('LOG ' + (p.entry.text || '').slice(0, 160));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  return { cdp, errors };
}

/* ---------- 页面级检测 ---------- */
async function metrics(cdp) {
  return cdp.eval(`(() => {
    const v = document.getElementById('view');
    const de = document.documentElement;
    const near = (el) => { let n = el; while (n && n !== de) { const s = getComputedStyle(n); if (/auto|scroll/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n; n = n.parentElement; } return null; };
    const sc = (v && near(v)) || (de.scrollHeight > window.innerHeight + 4 ? de : null);
    const tb = document.querySelector('.tabbar');
    return {
      hOverflow: de.scrollWidth - window.innerWidth,
      docH: de.scrollHeight,
      winH: window.innerHeight,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      bodyHeight: getComputedStyle(document.body).height,
      scroller: sc ? (sc === de ? 'document' : (sc.id || sc.className)) : 'none',
      scrollRoom: sc ? sc.scrollHeight - sc.clientHeight : 0,
      tabbarFixed: tb ? getComputedStyle(tb).position : 'n/a',
      viewChildren: v ? v.children.length : -1,
      contentNeeded: v ? Math.ceil(v.scrollHeight + (v.getBoundingClientRect().top || 0)) : de.scrollHeight,
      available: window.innerHeight,
      scrollable: (de.scrollHeight > window.innerHeight + 4) || !!sc
    };
  })()`);
}

async function swipe(cdp, x, y, dy) {
  // headless shell 不做合成器触摸滚动，用滚轮验证"文档滚动链"（等价于手指滑动时浏览器要走的那条链）
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse'
  });
  await sleep(600);
}

async function hitTest(cdp, x, y) {
  return cdp.eval(`(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? (el.tagName + '.' + (el.className || '')) : 'null'; })()`);
}

async function scrollTop(cdp) {
  return cdp.eval(`(() => {
    const v = document.getElementById('view'), de = document.documentElement;
    const near = (el) => { let n = el; while (n && n !== de) { const s = getComputedStyle(n); if (/auto|scroll/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n; n = n.parentElement; } return null; };
    const sc = near(v);
    if (sc) return sc.scrollTop;
    return window.scrollY || de.scrollTop || document.body.scrollTop || 0;
  })()`);
}

async function runDesktopCase({ name, url, w, h, ua, shots }) {
  const { proc } = await launchChrome(ua, w, h);
  const { cdp, errors } = await connect();
  const out = { name, url, viewport: `${w}x${h}`, pass: true, issues: [], pages: {}, errors };
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    await sleep(4500);
    const m0 = await metrics(cdp);
    out.metrics = m0;
    if (m0.hOverflow > 1) out.issues.push(`横向溢出 ${m0.hOverflow}px`);
    // 滚动链
    const prog = await cdp.eval(`(() => { window.scrollTo(0, 200); const y = window.scrollY; window.scrollTo(0, 0); return y; })()`);
    out.programmatic = prog;
    if (m0.scrollRoom > 40 && prog < 100) out.issues.push(`window.scrollTo 无效（y=${prog}）`);

    for (const pg of ['overview', 'structure', 'radar', 'theory', 'divination', 'sources']) {
      const n0 = errors.length;
      await cdp.eval(`document.querySelector('[data-page="${pg}"]').click()`);
      await sleep(pg === 'structure' ? 7000 : 4500);
      const mm = await metrics(cdp);
      const t = { hOverflow: mm.hOverflow, newErrors: errors.slice(n0) };
      if (mm.hOverflow > 1) { t.fail = true; out.issues.push(`${pg}: 横向溢出 ${mm.hOverflow}px`); }
      if (t.newErrors.length) { t.fail = true; out.issues.push(`${pg}: 报错 ${t.newErrors[0]}`); }
      out.pages[pg] = t;
      if (shots) {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(shots, `${name}-${pg}.png`), Buffer.from(r.data, 'base64'));
      }
    }
  } catch (e) {
    out.issues.push('巡检异常：' + e.message);
  }
  out.pass = out.issues.length === 0;
  try { cdp.ws.close(); } catch {}
  proc.kill('SIGKILL');
  return out;
}

async function runCase({ name, url, w, h, ua, shots }) {
  const { proc, dir } = await launchChrome(ua, w, h);
  const { cdp, errors } = await connect();
  const out = { name, url, viewport: `${w}x${h}`, pass: true, issues: [], tabs: {}, errors };
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.navigate', { url });
    await sleep(4500);
    const m0 = await metrics(cdp);
    out.metrics = m0;
    if (m0.hOverflow > 1) out.issues.push(`横向溢出 ${m0.hOverflow}px`);
    if (m0.viewChildren < 1) out.issues.push('#view 无内容');

    // 编程滚动：验证文档本身是否可滚（排除手势模拟问题）
    const prog = await cdp.eval(`(() => { window.scrollTo(0, 200); const y = window.scrollY; window.scrollTo(0, 0); return y; })()`);
    out.programmatic = prog;
    if (m0.scrollRoom > 40 && prog < 100) out.issues.push(`window.scrollTo 无效（y=${prog}）——文档滚动被锁`);

    // 纵向滚动：滚一次看是否真的动了
    const before = await scrollTop(cdp);
    const gx = Math.round(w / 2), gy = Math.round(h * 0.62);
    out.hit = await hitTest(cdp, gx, gy);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await swipe(cdp, gx, gy, Math.round(h * 0.6));
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const after = await scrollTop(cdp);
    out.scroll = { scroller: m0.scroller, room: m0.scrollRoom, before, after };
    if (m0.scrollRoom > 40 && after - before < 20) {
      out.issues.push(`手势滑动无效（可滚 ${m0.scrollRoom}px，位移 ${(after - before).toFixed(0)}px）`);
    }
    if (!m0.scrollable && m0.contentNeeded > m0.available + 24) {
      out.issues.push(`内容需要 ${m0.contentNeeded}px 但屏幕只有 ${m0.available}px，页面却不可滚动（滚动被锁死）`);
    }
    // 轮询是否把滚动位置重置
    if (after > 40) {
      await sleep(13000);
      const later = await scrollTop(cdp);
      out.scroll.afterPoll = later;
      if (Math.abs(later - after) > 40) out.issues.push(`轮询把滚动位置从 ${after.toFixed(0)} 改到 ${later.toFixed(0)}`);
    }

    // 每个 Tab：点进去 → 等渲染 → 检查内容与报错
    for (const tab of ['overview', 'radar', 'structure', 'theory', 'divination']) {
      const n0 = errors.length;
      await cdp.eval(`document.querySelector('[data-tab="${tab}"]').click()`);
      await sleep(tab === 'structure' ? 6000 : 4000);
      const mm = await metrics(cdp);
      const t = { children: mm.viewChildren, hOverflow: mm.hOverflow, newErrors: errors.slice(n0) };
      if (mm.viewChildren < 1) { t.fail = true; out.issues.push(`${tab}: 页面空白`); }
      if (mm.hOverflow > 1) { t.fail = true; out.issues.push(`${tab}: 横向溢出 ${mm.hOverflow}px`); }
      if (t.newErrors.length) { t.fail = true; out.issues.push(`${tab}: 报错 ${t.newErrors[0]}`); }
      out.tabs[tab] = t;
      if (shots) {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(shots, `${name}-${tab}.png`), Buffer.from(r.data, 'base64'));
      }
    }
  } catch (e) {
    out.issues.push('巡检异常：' + e.message);
  }
  out.pass = out.issues.length === 0;
  try { cdp.ws.close(); } catch {}
  proc.kill('SIGKILL');
  return out;
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const cases = [
    { name: 'ios-dark', url: `${BASE}/m/?skin=ios&theme=dark`, w: 390, h: 844, ua: UA_IOS },
    { name: 'ios-light', url: `${BASE}/m/?skin=ios&theme=light`, w: 390, h: 844, ua: UA_IOS },
    { name: 'android-dark', url: `${BASE}/m/?skin=android&theme=dark`, w: 412, h: 915, ua: UA_AND },
    { name: 'android-light', url: `${BASE}/m/?skin=android&theme=light`, w: 412, h: 915, ua: UA_AND }
  ];
  const desktopCases = [
    { name: 'desktop-dark', url: `${BASE}/?desktop=1&theme=dark`, w: 1440, h: 900, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
    { name: 'desktop-light-narrow', url: `${BASE}/?desktop=1&theme=light`, w: 1024, h: 768, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' }
  ];
  const results = [];
  for (const c of desktopCases) {
    const r = await runDesktopCase({ ...c, shots: SHOTS });
    results.push(r);
    console.log(`\n${r.pass ? '✅' : '❌'} ${r.name}  ${r.viewport}  横向溢出=${r.metrics?.hOverflow}px  页面=${Object.keys(r.pages).length}`);
    r.issues.forEach(i => console.log('   ⚠ ' + i));
    if (r.errors.length) console.log('   ✖ 报错: ' + r.errors.slice(0, 3).join(' | '));
  }
  for (const c of cases) {
    const r = await runCase({ ...c, shots: SHOTS });
    results.push(r);
    console.log(`\n${r.pass ? '✅' : '❌'} ${r.name}  ${r.viewport}  滚动容器=${r.scroll?.scroller} 可滚=${r.scroll?.room}px 手势位移=${(r.scroll?.after - r.scroll?.before).toFixed(0)}px 横向溢出=${r.metrics?.hOverflow}px`);
    r.issues.forEach(i => console.log('   ⚠ ' + i));
    if (r.errors.length) console.log('   ✖ 报错: ' + r.errors.slice(0, 3).join(' | '));
  }
  const bad = results.filter(r => !r.pass);
  fs.writeFileSync('/tmp/uicheck.json', JSON.stringify(results, null, 2));
  console.log(`\n结果：${results.length - bad.length}/${results.length} 通过（明细 /tmp/uicheck.json）`);
  process.exit(bad.length ? 1 : 0);
})();
