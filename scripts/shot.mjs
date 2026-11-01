#!/usr/bin/env node
// 截图工具（用平台内置 Playwright + Chromium）
// node scripts/shot.mjs <url> <out.png> [w] [h] [--mobile] [--wait=ms] [--click=selector]
import { chromium } from '/opt/dsh-browser/playwright.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const [url, out, w = '1440', h = '900'] = pos;
if (!url || !out) { console.error('用法: node scripts/shot.mjs <url> <out.png> [w] [h] [--mobile] [--wait=ms] [--click=sel]'); process.exit(2); }

const browser = await chromium.launch({
  executablePath: process.env.DSH_BROWSER_EXECUTABLE_PATH || '/opt/dsh-browser/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
  isMobile: flag('mobile'),
  hasTouch: flag('mobile'),
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.error('goto:', e.message));
await page.waitForTimeout(Number(opt('wait', 6000)));
const click = opt('click', '');
if (click) { await page.click(click).catch(() => {}); await page.waitForTimeout(3000); }
await page.screenshot({ path: out });
console.log('saved', out, errs.length ? 'errors: ' + errs.slice(0, 2).join(' | ') : 'no errors');
await browser.close();
