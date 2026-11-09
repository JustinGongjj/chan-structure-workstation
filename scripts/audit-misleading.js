#!/usr/bin/env node
'use strict';
/**
 * 误导性文案 / 信息丢失审计
 * =====================================================================
 * 起因：用户反馈"只有 1 个中枢却显示 a+A+b+B+c"。复盘发现这不是偶发笔误，
 * 而是三类可复现的结构性错误，而且都能被机器检测出来：
 *
 *   ① 删信息：前端用 replace(/（.*?）/) 把括号里的关键限定删掉
 *   ② 固定话术：文案里含结构术语，却不带任何变量插值（不随数据变化）
 *   ③ 括号承载关键信息：把"N 个中枢"这类核心语义塞进括号
 *
 * 这个脚本把三类都做成规则，加进 check:all，防止再犯。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = [path.join(ROOT, 'web', 'js'), path.join(ROOT, 'web', 'm', 'js')];
const EXTS = ['.js'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.includes(path.extname(p))) out.push(p);
  }
  return out;
}

const problems = [];

/** 判断某个位置是否在注释里（行注释或块注释） */
function inComment(src, index) {
  const before = src.slice(0, index);
  const lineStart = before.lastIndexOf('\n') + 1;
  const curLine = before.slice(lineStart);
  if (/(^|[^:])\/\//.test(curLine)) return true;
  const openBlock = before.lastIndexOf('/*');
  const closeBlock = before.lastIndexOf('*/');
  return openBlock > closeBlock;
}

/* 规则①：replace(/（...) 删除括号内容 —— 丢掉的不只是排版，可能是关键限定 */
function ruleStripParen(file, src) {
  const re = /\.replace\(\s*\/（[^/]*\/[gimsuy]*\s*,\s*''\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (inComment(src, m.index)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    problems.push({ file, line, rule: '删括号', text: m[0], why: '用 replace 删掉括号内容会丢失关键限定（如"N 个中枢"）' });
  }
}

/*
  规则②：固定话术 —— 含结构术语、无插值、且**不在任何 if 分支内**

  精度说明：条件分支里的文案（如"检测到盘整背驰 → 解释判定依据"）由数据触发，
  属于正确的教学解释，不算固定话术。真正的问题是**无条件执行**的那类，
  即无论数据如何都会显示的说法（本次 bug 正是如此）。

  判定方式（比统计花括号深度可靠）：
  向上找最近的 `if (` / `else if (` / `switch (`，检查该条件的括号在此 push 之前
  是否已闭合、且闭合后紧跟一个尚未闭合的 `{` —— 是则在分支体内，允许。
  不能用"花括号深度 > 1"判断：highlight.js 主逻辑本身就嵌套在 2-3 层函数里，
  那样会把所有固定话术都放过（实测漏判过）。
*/
const TERMS = ['a+A+b', 'a + A + b', '中枢', '背驰', '走势'];

function insideConditional(src, index) {
  const before = src.slice(0, index);
  const re = /\b(if|switch)\s*\(/g;
  let m;
  const conds = [];
  while ((m = re.exec(before))) conds.push(m.index);
  for (let i = conds.length - 1; i >= 0; i--) {
    let depth = 0, close = -1;
    for (let j = before.indexOf('(', conds[i]); j < before.length; j++) {
      if (before[j] === '(') depth++;
      else if (before[j] === ')') { depth--; if (depth === 0) { close = j; break; } }
    }
    if (close < 0) continue;
    // 条件闭合后到 push 之间是否有未闭合的 { —— 说明在分支体内
    let brace = 0;
    for (let k = close + 1; k < before.length; k++) {
      if (before[k] === '{') brace++;
      else if (before[k] === '}') brace--;
    }
    if (brace > 0) return true;
  }
  return false;
}

function ruleHardcoded(file, src) {
  if (!/highlight\.js$/.test(file)) return;
  const re = /steps\.push\(\s*'([^']*)'\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    const hasTerm = TERMS.some((t) => body.includes(t));
    if (!hasTerm || body.length <= 40) continue;
    if (/就是|指的是|定义|作用是|意味着|必须|最小|称之为/.test(body)) continue;
    if (insideConditional(src, m.index)) continue;
    problems.push({
      file, line, rule: '固定话术', text: body.slice(0, 40) + '…',
      why: '含结构术语、无插值、且不在 if 分支内——无论数据如何都会显示',
    });
  }
}

/* 规则③：把计数类核心信息放在括号里（只查字符串字面量，跳过注释） */
function ruleCountInParen(file, src) {
  const re = /(['"])([^'"\n]*?（\s*\d*\s*个中枢[^'"\n]*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    if (inComment(src, m.index)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    problems.push({
      file, line, rule: '计数在括号内', text: m[2].slice(0, 46),
      why: '中枢个数是结构式的核心语义，不能只放在括号里（前端可能删括号）',
    });
  }
}

/*
  规则④：前后端周期列表必须一致
  起因：用户反馈"缺少了月线"——前端 PERIODS.CR 漏了 month，后端却有数据；
  同时后端 MARKETS.CR.periods 也漏写 month，两处一起漏。
  这类"两边各维护一份列表"的结构必然漂移，做成规则长期盯住。
*/
const MARKETS_ALL = ['A', 'HK', 'US', 'CR', 'CNF', 'USF'];
function rulePeriodConsistency() {
  const bePath = path.join(ROOT, 'server', 'lib', 'sources.js');
  const fePath = path.join(ROOT, 'web', 'js', 'pages', 'structure.js');
  if (!fs.existsSync(bePath) || !fs.existsSync(fePath)) return;
  const be = fs.readFileSync(bePath, 'utf8');
  const fe = fs.readFileSync(fePath, 'utf8');
  const blk = fe.slice(fe.indexOf('const PERIODS'), fe.indexOf('const PNAME'));
  const parse = (src) => {
    const out = {};
    for (const m of MARKETS_ALL) {
      const re = new RegExp('\\b' + m + ':\\s*(?:\\{[^}]*periods:)?\\s*\\[([^\\]]+)\\]');
      const hit = src.match(re);
      if (hit) out[m] = hit[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    }
    return out;
  };
  const BE = parse(be), FE = parse(blk);
  for (const m of MARKETS_ALL) {
    if (!BE[m] || !FE[m]) continue;
    const onlyBE = BE[m].filter((x) => !FE[m].includes(x));
    const onlyFE = FE[m].filter((x) => !BE[m].includes(x));
    if (onlyBE.length) {
      problems.push({ file: fePath, line: 0, rule: '周期不一致', text: `${m} 缺少 ${onlyBE.join(',')}`, why: '后端支持但前端没有按钮' });
    }
    if (onlyFE.length) {
      problems.push({ file: bePath, line: 0, rule: '周期不一致', text: `${m} 后端未声明 ${onlyFE.join(',')}`, why: '前端有按钮但后端 periods 未声明' });
    }
  }
}

const files = SCAN_DIRS.flatMap((d) => walk(d));
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  ruleStripParen(f, src);
  ruleHardcoded(f, src);
  ruleCountInParen(f, src);
}

/*
  规则⑤：同一份配置不许多处各写一份（配置漂移）
  起因：市场名称映射在 5 个文件里各写一份，game.js 只写了 4 个市场（缺 CNF/USF）。
  现在统一到 server/lib/constants.js，其他文件只允许引用、不允许重新定义字面量。
*/
/*
  允许存在的"本地兜底"：
  - web/js/ui.js：前端启动后会从 /api/constants 同步覆盖，本地的只是 API 不可用时的兜底
  这类不算漂移，因为有一处会被权威值覆盖。
*/
const CANONICAL_SOURCES = ['server/lib/constants.js'];
const ALLOWED_FALLBACK = ['web/js/ui.js'];
const FORBIDDEN_LITERALS = [
  { name: '市场名称映射', re: /A:\s*['"]A股['"]/ },
  { name: '周期名称映射', re: /day:\s*['"]日线['"],\s*week/ },
  /* 信号中文名：chan.js 曾与 constants.js 各写一份，措辞不一致（第一类买点 vs 一类买点） */
  { name: '信号名称映射', re: /['"]1B['"]\s*:\s*['"][^'"]*买点['"]/ },
  /*
    市场全集子集：前端硬编码 ['A','HK','US','CR'] 会漏掉 CNF/USF。
    实测两个真 bug：雷达页看不到期货自选股、数据源表漏掉期货。
    注意只查"疑似全集"（4 个及以上连续市场代码），单个市场引用不算。
  */
  {
    name: '市场全集硬编码',
    re: /\[\s*['"]A['"]\s*,\s*['"]HK['"]\s*,\s*['"]US['"]\s*,\s*['"]CR['"]\s*\]/,
    allowFiles: ['server/lib/sources.js'],   // 数据源能力声明，本身只覆盖这 4 个市场
  },
];
function ruleConfigDrift() {
  const scan = [...SCAN_DIRS, path.join(ROOT, 'server', 'lib')].flatMap((d) => walk(d));
  for (const f of scan) {
    const relPath = path.relative(ROOT, f).split(path.sep).join('/');
    if (CANONICAL_SOURCES.includes(relPath)) continue;   // 唯一数据源允许定义
    if (ALLOWED_FALLBACK.includes(relPath)) continue;    // 前端兜底（会被 API 覆盖）
    const src = fs.readFileSync(f, 'utf8');
    for (const { name, re, allowFiles } of FORBIDDEN_LITERALS) {
      if (allowFiles && allowFiles.includes(relPath)) continue;
      if (re.test(src)) {
        const idx = src.search(re);
        const line = src.slice(0, idx).split('\n').length;
        problems.push({
          file: f, line, rule: '配置漂移',
          text: `${name} 在此重新定义`,
          why: '应改为引用 server/lib/constants.js，避免多处各写一份导致不一致',
        });
      }
    }
  }
}

rulePeriodConsistency();
ruleConfigDrift();

const rel = (p) => path.relative(ROOT, p);
if (!problems.length) {
  console.log(`✅ 误导性文案审计通过（扫描 ${files.length} 个文件，5 条规则）`);
  process.exit(0);
}
console.log(`❌ 发现 ${problems.length} 处可疑：`);
for (const p of problems) {
  console.log(`\n  ${rel(p.file)}:${p.line}  [${p.rule}]`);
  console.log(`    代码：${p.text}`);
  console.log(`    问题：${p.why}`);
}
process.exit(1);
