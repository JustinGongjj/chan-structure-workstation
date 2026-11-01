#!/usr/bin/env node
/**
 * 轻量截图工具：node scripts/shot.js <url> <out.png> [w] [h] [--mobile] [--wait=ms] [--click=selector]
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

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const [url, out, w = '1440', h = '900'] = pos;
if (!url || !out) { console.error('用法: node scripts/shot.js <url> <out.png> [w] [h] [--mobile] [--wait=ms] [--click=sel]'); process.exit(2); }

const mobile = flag('mobile');
const wait = Number(opt('wait', 5000));
const click = opt('click', '');
const PORT = 9100 + Math.floor(Math.random() * 700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    `--user-agent=${mobile ? UA_IOS : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36'}`,
    `--window-size=${w},${h}`, 'about:blank'
  ], { stdio: 'ignore', env: ENV });

  let list;
  for (let i = 0; i < 150; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(100); }
  }
  if (!list) { console.error('chrome 启动失败'); proc.kill('SIGKILL'); process.exit(1); }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let id = 0;
  const pend = new Map();
  const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url });
  await sleep(wait);
  if (click) { await evaluate(`document.querySelector(${JSON.stringify(click)})?.click()`); await sleep(3000); }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out, fs.statSync(out).size + 'B', errs.length ? ('errors: ' + errs.slice(0, 2).join(' | ')) : '');
  try { ws.close(); } catch {}
  proc.kill('SIGKILL');
  process.exit(0);
})();
