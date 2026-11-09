#!/usr/bin/env node
'use strict';
/**
 * 「改这个要动几处」查询工具
 * =====================================================================
 * 对应 docs/CHANGE-CHECKLIST.md 的问题 1-4。
 * 用法：
 *   node scripts/whereis.js 周期        # 列出所有涉及"周期"的文件与行号
 *   node scripts/whereis.js periods     # 同上，英文关键词
 *   node scripts/whereis.js --features  # 列出所有"前后端各一份"的功能点
 *
 * 为什么要有这个工具：
 * 本项目两次踩坑都是"只修了一半"（桌面修了手机没修）。
 * 靠人记清单不可靠，做成一条命令，改之前跑一下就知道该动哪几处。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['server/lib', 'server', 'web/js', 'web/m/js', 'scripts'];

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const name of fs.readdirSync(abs)) {
    const p = path.join(abs, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(path.join(dir, name), out);
    else if (/\.js$/.test(name)) out.push(path.join(dir, name));
  }
  return out;
}

const FILES = DIRS.flatMap((d) => walk(d));

/** 已知的功能点关键词（中文 → 用于搜索的关键词列表） */
const ALIASES = {
  周期: ['period', 'PERIOD', 'PERIODS', 'PERIOD_NAME', 'data-p="', 'day:', 'week:'],
  级别: ['period', 'PERIOD', 'level'],
  市场: ['MARKET', 'markets', 'marketLabel', "A:", "'A'"],
  信号: ['signal', 'SIGNAL', '1B', '2B', '3B', 'SIG_'],
  中枢: ['pivot', 'PIVOT', '中枢'],
  背驰: ['beichi', 'BEICHI', '背驰'],
  线段: ['segment', 'SEGMENT', '线段'],
  分型: ['fractal', 'FRACTAL', '分型'],
  评分: ['score', 'SCORE', '评分'],
  历史: ['history', 'HISTORY', '历史'],
};

/*
  只找「定义处」，不找「使用处」。
  命中 462 行里绝大多数是 period 参数传递，没有参考价值——
  真正要改的是"定义了一份列表/映射"的地方。
*/
const DEF_PATTERNS = [
  /const\s+\w*\s*=\s*[\[{]/,          // const XXX = [ / {
  /^\s*\w+:\s*[\[{]/,                   // key: [
  /\bMARKETS\s*[:=]/,                     // MARKETS = {
  /\bperiods:\s*\[/,                     // periods: [...]
  /const\s+\w+\s*=\s*\{/,                // const X = {
];

function isDefinition(line) {
  return DEF_PATTERNS.some((re) => re.test(line));
}

function search(keyword, opts = {}) {
  const kws = ALIASES[keyword] || [keyword];
  const hits = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!kws.some((k) => line.includes(k))) return;
      const def = isDefinition(line);
      if (opts.defsOnly && !def) return;
      hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 100), def });
    });
  }
  return hits;
}

/** 前端 / 后端分组统计 */
function group(hits) {
  const g = { 后端: [], 桌面: [], 手机: [], 脚本: [] };
  for (const h of hits) {
    if (h.file.startsWith('server/')) g.后端.push(h);
    else if (h.file.startsWith('web/m/')) g.手机.push(h);
    else if (h.file.startsWith('web/')) g.桌面.push(h);
    else g.脚本.push(h);
  }
  return g;
}

/** 列出所有"前后端各一份"的功能 */
const FEATURES = [
  ['周期列表', /day['"]?\s*,\s*['"]?week/],
  ['市场列表', /\[['"]A['"]\s*,/],
  ['信号类型', /['"]?3B['"]?.*['"]?2B['"]?|1B.*2B.*3B/],
  ['中枢渲染', /pivots/],
  ['背驰判断', /beichi/i],
];

function features() {
  const rows = [];
  for (const [name, re] of FEATURES) {
    const fe = [], be = [], mob = [];
    for (const f of FILES) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      if (!re.test(src)) continue;
      if (f.startsWith('server/')) be.push(f);
      else if (f.startsWith('web/m/')) mob.push(f);
      else if (f.startsWith('web/')) fe.push(f);
    }
    if (fe.length || be.length || mob.length) rows.push({ name, fe, be, mob });
  }
  console.log('\n功能点分布（⚠️ = 多处各存一份，改动必须同步）\n');
  console.log('功能        后端  桌面  手机   风险');
  for (const r of rows) {
    const risk = (r.be.length && r.fe.length) ? '⚠️ 前后端各一份' : (r.mob.length ? '⚠️ 手机有独立实现' : '✅');
    console.log(`${r.name.padEnd(10)} ${String(r.be.length).padStart(4)} ${String(r.fe.length).padStart(5)} ${String(r.mob.length).padStart(5)}   ${risk}`);
  }
  console.log('\n改动前请先看 docs/CHANGE-CHECKLIST.md');
}

const arg = process.argv[2];
if (!arg || arg === '--help' || arg === '-h') {
  console.log('用法：node scripts/whereis.js <关键词>');
  console.log('      node scripts/whereis.js --features   列出前后端各一份的功能点');
  console.log('关键词：', Object.keys(ALIASES).join('、'));
  process.exit(0);
}
if (arg === '--features') {
  features();
  process.exit(0);
}

/* --check <关键词>：只输出"必须一起改"的位置清单，供提交前自查 */
if (arg === '--check') {
  const kw = process.argv[3];
  if (!kw) { console.log('用法：node scripts/whereis.js --check <关键词>'); process.exit(1); }
  const all = search(kw);
  const defs = all.filter((h) => h.def);
  const g = group(defs.length ? defs : all);
  const must = [];
  if (g.后端.length) must.push(`后端 ${g.后端.length} 处`);
  if (g.桌面.length) must.push(`桌面 ${g.桌面.length} 处`);
  if (g.手机.length) must.push(`手机 ${g.手机.length} 处`);
  console.log(`\n「${kw}」改动自查清单`);
  console.log('─'.repeat(48));
  if (g.后端.length && (g.桌面.length || g.手机.length)) {
    console.log('⚠️  前后端都有实现，必须同步修改');
  }
  if (g.手机.length) {
    console.log('⚠️  手机版有独立实现（最容易漏）');
  }
  console.log('\n需检查：' + (must.join('、') || '无'));
  console.log('');
  for (const [name, list] of Object.entries(g)) {
    if (!list.length) continue;
    console.log(`【${name}】`);
    for (const h of list.slice(0, 8)) console.log(`  ☐ ${h.file}:${h.line}`);
    if (list.length > 8) console.log(`  ☐ …还有 ${list.length - 8} 处`);
  }
  console.log('\n完整清单见 docs/CHANGE-CHECKLIST.md');
  process.exit(0);
}

const all = search(arg);
const hits = all.filter((h) => h.def);
const g = group(hits.length ? hits : all);
console.log(`\n「${arg}」定义处 ${hits.length} 行（总命中 ${all.length} 行）\n`);
for (const [name, list] of Object.entries(g)) {
  if (!list.length) continue;
  console.log(`【${name}】${list.length} 行`);
  for (const h of list.slice(0, 20)) {
    console.log(`  ${h.file}:${h.line}  ${h.text}`);
  }
  if (list.length > 20) console.log(`  …还有 ${list.length - 20} 行`);
  console.log('');
}
if (g.手机.length) console.log('⚠️ 手机版也有实现，改动必须同步');
if (g.后端.length && g.桌面.length) console.log('⚠️ 前后端都有，改动必须同步');
