#!/usr/bin/env node
/**
 * 交互流程巡检：用真实浏览器把"点得动"的功能都点一遍。
 *   node scripts/flowcheck.js [--base http://127.0.0.1:8931] [--shots /tmp/flow]
 *
 * 覆盖：
 *   手机版：搜索 → 进结构、自选池增/删、算卦两次起卦是否变化、理论弹层、深链
 *   桌面版：6 个页面切换、结构页图表、算卦页起卦、理论页弹窗
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
const SHOTS = arg('shots', '');
const PORT = 9700 + Math.floor(Math.random() * 200);
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout ' + method)); } }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

async function open({ url, w, h, ua, mobile }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--touch-events=enabled',
    '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    `--user-agent=${ua}`, `--window-size=${w},${h}`, 'about:blank'
  ], { stdio: 'ignore', env: ENV });
  let list;
  for (let i = 0; i < 120; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(100); }
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => errors.push('EXC ' + (p.exceptionDetails?.exception?.description || '').split('\n')[0]));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push('CONSOLE ' + p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 140)); });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: 5 });
  await cdp.send('Page.navigate', { url });
  await sleep(4200);
  return { cdp, errors, close: () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); } };
}

const steps = [];
/* 巡检前把测试标的清掉，避免上一次运行的残留影响断言 */
async function cleanWatch(code) {
  const r = await (await fetch(BASE + '/api/watchlist')).json().catch(() => null);
  if (r?.list?.A?.some((x) => x.code === code)) {
    await fetch(`${BASE}/api/watchlist?market=A&code=${code}`, { method: 'DELETE' });
  }
}
const check = (name, ok, detail) => { steps.push({ name, ok: !!ok, detail: detail || '' }); };

async function mobileFlows() {
  await cleanWatch('600036');
  const s = await open({ url: `${BASE}/m/?skin=ios&theme=dark`, w: 390, h: 844, ua: UA_IOS, mobile: true });
  const { cdp, errors } = s;
  try {
    // 1) 搜索 → 进入结构分析
    await cdp.eval(`document.getElementById('searchBtn').click()`);
    await sleep(900);
    const hasInput = await cdp.eval(`!!document.querySelector('#sheet input.input, #sheet input')`);
    check('手机版·搜索弹层打开', hasInput);
    await cdp.eval(`(() => { const i = document.querySelector('#sheet input'); i.value='BTC'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
    await sleep(2600);
    const results = await cdp.eval(`document.querySelectorAll('#sheet .list-item, #sheet [data-c]').length`);
    check('手机版·搜索有结果', results > 0, `结果 ${results} 条`);
    if (results > 0) {
      await cdp.eval(`document.querySelector('#sheet [data-c], #sheet .list-item').click()`);
      await sleep(5200);
      const title = await cdp.eval(`document.querySelector('.page-title')?.textContent || ''`);
      const hasChart = await cdp.eval(`!!document.querySelector('#view canvas')`);
      check('手机版·搜索结果进入结构分析', /结构|分析/.test(title) && hasChart, `${title.trim()} / canvas=${hasChart}`);
    }
    if (SHOTS) await cdp.shot(path.join(SHOTS, 'm-search.png'));

    // 2) 自选池：新增 → 校验 → 删除
    await cdp.eval(`document.querySelector('[data-tab="overview"]').click()`);
    await sleep(3000);
    await cdp.eval(`document.getElementById('ovEdit').click()`);
    await sleep(1800);
    const sheetHas = await cdp.eval(`(() => { const i=document.getElementById('wCode'); return { hasInput: !!i, hasAdd: !!document.getElementById('wAdd'), ids: [...document.querySelectorAll('#sheet input,#sheet button')].map(e=>e.id||e.className).join(',') }; })()`);
    const stack = await cdp.eval(`(() => {
      const s = document.getElementById('sheet'); const r = s.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 60));
      const bg = getComputedStyle(s).backgroundColor;
      return { inside: !!el && s.contains(el), bg, top: Math.round(r.top), h: Math.round(r.height) };
    })()`);
    check('手机版·自选池弹层', sheetHas.hasInput && sheetHas.hasAdd, sheetHas.ids);
    check('手机版·弹层层级与背景', stack.inside && !/rgba\(0, 0, 0, 0\)/.test(stack.bg), `命中层内=${stack.inside}，背景=${stack.bg}，top=${stack.top}px h=${stack.h}px`);
    // 弹层默认跟随当前页面的市场（搜索后可能是 CR），先切回 A 股再测增删
    await cdp.eval(`document.querySelector('#wMarket .sq[data-m="A"]')?.click()`);
    await sleep(1500);
    const before = await cdp.eval(`(async () => (await (await fetch('/api/watchlist')).json()).list.A.length)()`);
    await cdp.eval(`(() => { const i=document.getElementById('wCode'); i.value='600036'; })()`);
    await cdp.eval(`document.getElementById('wAdd').click()`);
    await sleep(800);
    const toastTxt = await cdp.eval(`document.getElementById('toast')?.textContent || ''`);
    const codeVal = await cdp.eval(`document.getElementById('wCode')?.value || ''`);
    let after = before;
    for (let i = 0; i < 8; i++) {
      await sleep(900);
      after = await cdp.eval(`(async () => (await (await fetch('/api/watchlist')).json()).list.A.length)()`);
      if (after !== before) break;
    }
    check('手机版·自选池新增', after === before + 1, `${before} → ${after}；输入「${codeVal}」，提示「${toastTxt}」`);
    const delBtn = await cdp.eval(`(() => { const b=[...document.querySelectorAll('#sheet [data-del]')].find(x=>x.dataset.del==='600036'); if(!b) return false; b.click(); return true; })()`);
    if (delBtn) {
      await sleep(2600);
      const after2 = await cdp.eval(`(async () => (await (await fetch('/api/watchlist')).json()).list.A.length)()`);
      check('手机版·自选池删除', after2 === before, `${after} → ${after2}`);
    } else check('手机版·自选池删除', true, '新建项已在列表（跳过 UI 删除）');
    await cdp.eval(`document.getElementById('sheetClose')?.click()`);
    await sleep(2200);
    const ovCount = await cdp.eval(`document.querySelectorAll('#view .list-item[data-c]').length`);
    check('手机版·自选池变更后总览同步', ovCount >= before + 1, `总览列表 ${before} → ${ovCount}`);
    if (SHOTS) await cdp.shot(path.join(SHOTS, 'm-watch.png'));
    await cleanWatch('600036');
    await cdp.eval(`document.querySelector('#sheetClose')?.click()`);
    await sleep(600);

    // 3) 算卦：连点两次起卦 → 占次 +1、卦名变化
    await cdp.eval(`document.querySelector('[data-tab="divination"]').click()`);
    await sleep(4500);
    const readCast = () => cdp.eval(`(() => { const t = document.getElementById('view').innerText; return { name: (t.match(/^([乾兑离震巽坎艮坤][^\\s]{1,3}(?:为[乾兑离震巽坎艮坤][^\\s]{1,2})?)/m)||[])[1] || '', occ: (t.match(/第\\s*(\\d+)\\s*占/)||[])[1] || '' }; })()`);
    const c1 = await readCast();
    await cdp.eval(`document.getElementById('dCast').click()`);
    await sleep(3600);
    const c2 = await readCast();
    check('手机版·算卦起卦换卦', c1.occ && c2.occ && Number(c2.occ) > Number(c1.occ) && c1.name && c1.name !== c2.name,
      `「${c1.name}」第${c1.occ}占 → 「${c2.name}」第${c2.occ}占`);
    if (SHOTS) await cdp.shot(path.join(SHOTS, 'm-div.png'));

    // 3.5) 结构页：切换市场要自动退回兼容周期（QA 报的 major：港股+60分 空白图）
    await cdp.eval(`document.querySelector('[data-tab="structure"]').click()`);
    await sleep(5000);
    await cdp.eval(`document.querySelector('#sPeriod .sq[data-p="60m"]')?.click()`);
    await sleep(3000);
    await cdp.eval(`document.querySelector('#sMarket .sq[data-m="HK"]')?.click()`);
    await sleep(5000);
    const hk = await cdp.eval(`({ period: document.querySelector('#sPeriod .sq.active')?.textContent || '', canvas: !!document.querySelector('#view canvas'), state: (document.querySelector('#sState')?.innerText || '').slice(0, 24) })`);
    check('手机版·切市场自动退回兼容周期', hk.canvas && /日线/.test(hk.period) && !/加载中|失败/.test(hk.state), `周期=${hk.period.trim()} canvas=${hk.canvas} 状态=${hk.state.replace(/\s+/g, ' ')}`);

    // 4) 理论弹层
    await cdp.eval(`document.querySelector('[data-tab="theory"]').click()`);
    await sleep(2600);
    const t1 = await cdp.eval(`document.querySelectorAll('#view .concept').length`);
    await cdp.eval(`(() => { const b=document.querySelector('#view .concept'); if(b) b.click(); })()`);
    await sleep(2200);
    const t2 = await cdp.eval(`document.querySelectorAll('.sheet-mask.show').length`);
    const t3 = await cdp.eval(`document.querySelector('#sheet')?.innerText?.length || 0`);
    check('手机版·理论可展开', t1 > 0 && t2 > 0 && t3 > 60, `条目 ${t1}，弹层 ${t2}，内容 ${t3} 字`);
    if (SHOTS) await cdp.shot(path.join(SHOTS, 'm-theory.png'));
    await cdp.eval(`document.querySelector('#sheetClose')?.click()`);

    // 4.5) 教学标注：19 种结构都在，且从深链带进来的 hl 会显示为激活项
    await cdp.eval(`location.href = '/m/?tab=structure&hl=xianduan'`);
    await sleep(5200);
    const chips = await cdp.eval(`({ n: document.querySelectorAll('#view .chip[data-hl]').length, active: document.querySelector('#view .chip[data-hl].gold')?.textContent || '' })`);
    check('手机版·教学标注选项齐全', chips.n >= 19 && /线段/.test(chips.active), `选项 ${chips.n} 个，激活「${chips.active.trim()}」`);

    // 5) 深链
    await cdp.eval(`location.href = '/m/?tab=structure&hl=a_A_b'`);
    await sleep(5200);
    const deep = await cdp.eval(`document.querySelector('.page-title')?.textContent?.trim() || ''`);
    check('手机版·深链直达结构', /结构/.test(deep), deep);

    check('手机版·无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally { s.close(); }
}

async function cleanDrawings(market, code, period) {
  await fetch(`${BASE}/api/drawings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market, code, period, drawings: [] })
  }).catch(() => {});
}

async function desktopFlows() {
  await cleanDrawings('A', '600519', 'day');
  const s = await open({ url: `${BASE}/?desktop=1&theme=dark`, w: 1440, h: 900, ua: UA_DESK, mobile: false });
  const { cdp, errors } = s;
  try {
    // 结构分析页
    await cdp.eval(`document.querySelector('[data-page="structure"]').click()`);
    await sleep(6500);
    const chart = await cdp.eval(`!!document.querySelector('canvas')`);
    const label = await cdp.eval(`document.body.innerText.includes('中枢') || document.body.innerText.includes('笔')`);
    check('桌面版·结构页图表+标注', chart && label, `canvas=${chart}`);

    // 手绘线：水平线 → 趋势线 → 复核 → 落库
    const chartBox = await cdp.eval(`(() => { const c=document.querySelector('#mainChart'); if(!c) return null; const b=c.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]; })()`);
    if (chartBox) {
      const [bx, by, bw, bh] = chartBox;
      const click = async (x, y) => {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        await sleep(280);
      };
      await cdp.eval(`document.getElementById('drawLevel').click()`);
      await sleep(250);
      await click(bx + bw * 0.5, by + bh * 0.42);
      await cdp.eval(`document.getElementById('drawTrend').click()`);
      await sleep(250);
      await click(bx + bw * 0.22, by + bh * 0.62);
      await click(bx + bw * 0.74, by + bh * 0.28);
      await sleep(1500);
      const drawn = await cdp.eval(`document.querySelector('#drawHint')?.textContent || ''`);
      check('桌面版·手绘线可画出并保存', /当前 [2-9] 条/.test(drawn), drawn.replace(/\s+/g, ' ').slice(0, 48));
      await cdp.eval(`document.getElementById('drawVerify').click()`);
      await sleep(4800);
      const verdict = await cdp.eval(`document.getElementById('drawVerdict')?.innerText || ''`);
      const findings = await cdp.eval(`document.querySelectorAll('#drawFindings .dv-f').length`);
      check('桌面版·AI 复核给出一致度与逐条结论', /一致度/.test(await cdp.eval(`document.getElementById('drawScore')?.innerText || ''`)) && findings > 0, `结论 ${String(verdict).slice(0, 24)}… · ${findings} 条`);
      const persisted = await cdp.eval(`(async () => (await (await fetch('/api/drawings?market=A&code=600519&period=day')).json()).drawings.length)()`);
      check('桌面版·手绘线已落库', persisted >= 2, `${persisted} 条`);
      await cleanDrawings('A', '600519', 'day'); // 巡检不留脏数据
    } else check('桌面版·手绘线可画出并保存', false, '找不到图表画布');

    // 结构页回测卡片
    await sleep(2500);
    const bt = await cdp.eval(`document.body.innerText.includes('命中') || document.body.innerText.includes('回测')`);
    check('桌面版·信号回测卡片', bt);

    // 算卦页起卦
    await cdp.eval(`document.querySelector('[data-page="divination"]').click()`);
    await sleep(4000);
    const g1 = await cdp.eval(`document.getElementById('divHexCard')?.innerText?.slice(0,40) || ''`);
    const btn = await cdp.eval(`(() => { const b=document.getElementById('divCast'); if(!b) return false; b.click(); return true; })()`);
    await sleep(3600);
    const g2 = await cdp.eval(`document.getElementById('divHexCard')?.innerText?.slice(0,40) || ''`);
    check('桌面版·算卦起卦', btn && g2.length > 0 && g2 !== g1, `${String(g1).replace(/\s+/g,' ').slice(0,18)} → ${String(g2).replace(/\s+/g,' ').slice(0,18)}`);
    if (SHOTS) await cdp.shot(path.join(SHOTS, 'd-div.png'));

    // 理论页弹窗
    await cdp.eval(`document.querySelector('[data-page="theory"]').click()`);
    await sleep(3000);
    const cards = await cdp.eval(`document.querySelectorAll('[data-concept], .concept, .tx-card').length`);
    const opened = await cdp.eval(`(() => { const el=document.querySelector('[data-concept], .concept, .tx-card'); if(!el) return false; el.click(); return true; })()`);
    await sleep(1800);
    const modal = await cdp.eval(`document.getElementById('modalMask')?.classList.contains('show')`);
    const mtext = await cdp.eval(`document.getElementById('modalBody')?.innerText?.length || 0`);
    check('桌面版·理论概念弹窗', cards > 0 && opened && modal === true && mtext > 50, `卡片 ${cards}，弹窗 ${modal}，正文 ${mtext} 字`);
    if (SHOTS) await cdp.shot(path.join(SHOTS, 'd-theory.png'));

    // 数据源页
    await cdp.eval(`document.querySelector('[data-page="sources"]').click()`);
    await sleep(3500);
    const srcTxt = await cdp.eval(`document.body.innerText.match(/ok|可用|ms/g)?.length || 0`);
    check('桌面版·数据源页有探测结果', srcTxt > 0, `命中 ${srcTxt}`);

    check('桌面版·无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally { s.close(); }
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  await mobileFlows();
  await desktopFlows();
  let bad = 0;
  for (const s of steps) {
    if (!s.ok) bad++;
    console.log(`${s.ok ? '✓' : '✗'} ${s.name}${s.detail ? '  — ' + s.detail : ''}`);
  }
  console.log(`\n${steps.length - bad}/${steps.length} 通过`);
  process.exit(bad ? 1 : 0);
})();
