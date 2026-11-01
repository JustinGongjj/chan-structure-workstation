#!/usr/bin/env node
/**
 * CSS 冲突审计：确认 Framework7 的每条"危险规则"都被 f7-compat.css 处理过。
 *
 *   node scripts/cssaudit.js            # 人读报告
 *   node scripts/cssaudit.js --json     # 机读
 *
 * 背景：F7 是给"整站由 F7 布局"的场景写的，我们只借它的组件外观。
 * 每次新增页面/类名，都可能踩到一条从未被抵消的规则（height:100%、z-index:5000、
 * width:100%、overscroll-behavior…），这些属性一旦漏掉就是"手机上滑不动 / 弹层透明"。
 * 这个脚本把"漏掉"变成 CI 可见的失败，而不是等用户截图反馈。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const F7 = path.join(ROOT, 'web/vendor/f7/framework7-bundle.min.css');
const COMPAT = path.join(ROOT, 'web/m/css/f7-compat.css');
const SITE = path.join(ROOT, 'web/m/css/mobile.css');

/* 这些选择器在我们的 HTML/JS 里真实使用（含类名与元素），是必须审计的范围 */
const WATCH = [
  // 文档与排版
  'html', 'body', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'button', 'input',
  // 我们真正使用的布局/组件容器
  '.view', '.page', '.page-content', '.page-title', '.card', '.list', '.list-item',
  '.button', '.chip', '.badge', '.segmented', '.toast', '.input', '.sheet', '.tabbar'
];

/* 结构类属性：F7 一旦和我们的意图不一致，就是"滑不动 / 被裁 / 被盖住 / 撑满一行" */
const STRUCTURAL = new Set([
  'position', 'z-index', 'overflow', 'overflow-x', 'overflow-y', 'height', 'min-height',
  'width', 'min-width', 'display', 'align-self', 'flex-wrap', 'transform',
  'touch-action', 'overscroll-behavior', 'inset', 'top', 'left', 'right', 'bottom'
]);
/* 外观类属性：只有和我们的设计值不同才需要管 */
const APPEARANCE = new Set([
  'margin', 'margin-top', 'margin-bottom', 'padding', 'padding-left', 'padding-right',
  'font-size', 'line-height', 'color', 'background', 'background-color', 'border-radius',
  'box-shadow', 'text-transform', 'font-weight'
]);
const RISKY = new Set([...STRUCTURAL, ...APPEARANCE]);

/* 已人工确认无害的 (选择器, 属性)：写清理由，避免下次又被当成"漏了" */
const ACCEPTED = new Map([
  ['.page|width', '本项目不使用 .page 容器'],
  ['.page-title|width', '块级标题本就满宽，F7 的 100% 与设计一致'],
  ['.button|background', 'F7 置透明背景正是我们要的（背景由 .btn/.chip/.segmented 决定）']
]);
/* 结构属性的免检值：和默认行为一致、不会造成故障 */
const BENIGN = /^(|0|auto|initial|inherit|unset|none|static|visible|relative|inline|inline-block|flex|1|0px|translate3d\(0,?\s*0,?\s*0\)|translate\(0,?\s*0\))$/;

const norm = (sel) => sel.trim().replace(/\s+/g, ' ');

/* 预处理：剥掉 @keyframes（里面有 0%/100% 这种"选择器"），展开 @media 内部规则 */
function preprocess(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('@keyframes', i)) {
      let depth = 0, j = css.indexOf('{', i);
      for (let k = j; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}') { depth--; if (depth === 0) { i = k + 1; break; } }
      }
      continue;
    }
    if (css.startsWith('@media', i) || css.startsWith('@supports', i)) {
      const j = css.indexOf('{', i);
      let depth = 0, k = j;
      for (; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}') { depth--; if (depth === 0) break; }
      }
      out += preprocess(css.slice(j + 1, k));
      i = k + 1;
      continue;
    }
    if (css[i] === '@') { // 其它 at-rule（@font-face 等）：整块跳过
      const j = css.indexOf('{', i);
      if (j < 0) break;
      let depth = 0, k = j;
      for (; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}') { depth--; if (depth === 0) break; }
      }
      i = k + 1;
      continue;
    }
    out += css[i++];
  }
  return out;
}

function parseRules(cssText) {
  const out = [];
  const clean = preprocess(cssText.replace(/\/\*[\s\S]*?\*\//g, ''));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const selectors = m[1].split(',').map(norm).filter(Boolean);
    const decls = {};
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const prop = part.slice(0, i).trim().toLowerCase();
      const val = part.slice(i + 1).trim();
      if (!prop) continue;
      decls[prop] = val;
    }
    for (const s of selectors) out.push({ selector: s, decls });
  }
  return out;
}

/* 选择器是否"无条件命中我们"：单复合选择器，或祖先只由 html/body/.ios/.md/.dark 组成。
   （诸如 body>.progressbar-infinite、.swipeout-actions-right>button 这种只在 F7 组件里出现，
     我们的 DOM 根本不会命中，纳入审计只会制造噪声。） */
const HARMLESS_ANCESTOR = /^(html|body|\.ios|\.md|\[data-theme[^\]]*\])$/;

function unconditional(selector) {
  const parts = selector.split(/\s+|>|\+|~/).map(norm).filter(Boolean);
  if (!parts.length) return false;
  if (parts.length === 1) return true;
  return parts.slice(0, -1).every((p) => HARMLESS_ANCESTOR.test(p));
}

function specificity(selector) {
  let ids = 0, cls = 0, els = 0;
  const s = selector.replace(/:not\(([^)]*)\)/g, '$1');
  ids += (s.match(/#[\w-]+/g) || []).length;
  cls += (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  els += (s.replace(/[#.][\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ').match(/[a-zA-Z][\w-]*/g) || []).length;
  return ids * 100 + cls * 10 + els;
}

/* 我们真正会出现在 DOM 上的"额外类名"（其余类名只属于 F7 组件，不可能命中） */
const ALLOWED_CLASSES = new Set([
  '.ios', '.md', '.sheet-open', '.view', '.btn', '.button', '.chip',
  '.badge', '.card', '.list', '.segmented', '.seg', '.toast', '.input', '.page-title',
  '.list-item', '.sheet', '.page', '.page-content', '.navbar', '.toolbar', '.tabbar'
]);

/* 复合片段是否可能命中我们：标签要一致，类名只能是 watched 自己或我们真的会挂的类 */
function compoundHits(compound, watched) {
  // 带伪类（:focus / :autofill / ::placeholder …）的规则只在特定状态下生效，不计入常驻冲突
  if (/:(?!not\()/.test(compound)) return false;
  const tokens = compound.split(/(?=[.#\[])/).filter(Boolean);
  const tag = tokens[0] && !/^[.#\[]/.test(tokens[0]) ? tokens[0] : null;
  const classes = tokens.filter((t) => t.startsWith('.'));
  const attrs = tokens.filter((t) => t.startsWith('['));
  const watchedIsClass = watched.startsWith('.');
  const watchedTag = watchedIsClass ? null : watched;
  if (watchedTag && tag && tag !== watchedTag) return false;
  if (watchedTag && !tag) return false;
  if (watchedIsClass && tag) return false; // 裸元素选择器不可能命中"类名"审计项
  const CO_APPLIED = new Set(['.button', '.btn', '.chip', '.badge', '.card', '.list-item', '.sheet', '.input']);
  const watchingThis = watchedIsClass && classes.includes(watched);
  for (const c of classes) {
    if (watchedIsClass && c === watched) continue;
    if (watchingThis && CO_APPLIED.has(c)) continue; // 同一个元素上同时挂了 .chip.button 这种组合
    return false;
  }
  if (attrs.length && !attrs.every((a) => /data-theme|data-skin|aria-|role/.test(a))) return false;
  return true;
}

/* 是否命中 watched：只看最后一个复合片段（真正的目标元素） */
function matches(watched, selector) {
  const sels = selector.split(',').map(norm);
  return sels.some((sel) => {
    if (!unconditional(sel)) return false;
    const last = sel.split(/\s+|>|\+|~/).map(norm).filter(Boolean).pop();
    return compoundHits(last, watched);
  });
}

function collect(watched, rules) {
  const map = {};
  for (const r of rules) {
    for (const sel of r.selector.split(',').map(norm)) {
      if (!matches(watched, sel)) continue;
      const spec = specificity(sel) + (/!important/.test(Object.values(r.decls).join(' ')) ? 1000 : 0);
      for (const [p, v] of Object.entries(r.decls)) {
        const prev = map[p];
        if (!prev || spec >= prev.spec) map[p] = { value: v, from: sel, spec, important: /!important/.test(v) };
      }
    }
  }
  return map;
}

function main() {
  for (const f of [F7, COMPAT, SITE]) {
    if (!fs.existsSync(f)) { console.error('缺少文件：' + f); process.exit(2); }
  }
  const f7Rules = parseRules(fs.readFileSync(F7, 'utf8'));
  const compatRules = parseRules(fs.readFileSync(COMPAT, 'utf8'));
  const siteRules = parseRules(fs.readFileSync(SITE, 'utf8'));

  const findings = [];
  const stats = { checked: 0, covered: 0, f7Rules: f7Rules.length };

  for (const sel of WATCH) {
    const f7 = collect(sel, f7Rules);
    const risky = Object.entries(f7).filter(([p]) => RISKY.has(p));
    if (!risky.length) continue;
    const site = collect(sel, siteRules);
    const compat = collect(sel, compatRules);
    const ours = { ...site, ...compat };
    for (const [prop, info] of risky) {
      stats.checked++;
      const mine = ours[prop] || (prop === 'overflow' ? (ours['overflow-y'] || ours['overflow-x']) : null)
        || ((prop === 'overflow-y' || prop === 'overflow-x') ? ours['overflow'] : null);
      // 我们的规则后加载：同特异性即可覆盖；F7 更具体时必须 !important 或同特异性 + !important
      const covered = mine && (mine.important || mine.spec >= info.spec);
      if (covered) { stats.covered++; continue; }
      // 结构属性遇到"无害取值"（visible/static/auto/flex…）不必抵消；外观属性则看值是否等价
      if (ACCEPTED.has(sel + '|' + prop)) { stats.covered++; continue; }
      const val = info.value.replace(/!important/, '').trim();
      const benign = STRUCTURAL.has(prop)
        ? BENIGN.test(val)
        : /^(0|0px|none|transparent|inherit|normal|400|initial)$/.test(val);
      if (benign && !mine) continue;
      const softVar = /var\(--f7-/.test(info.value) && !mine;
      findings.push({
        selector: sel,
        prop,
        f7: info.value.slice(0, 60),
        rule: info.from,
        f7Spec: info.spec,
        ours: mine ? mine.value.slice(0, 60) : '（未声明）',
        oursSpec: mine ? mine.spec : 0,
        level: softVar || /var\(--f7-/.test(info.value) ? 'info' : 'fail'
      });
    }
  }

  const fails = findings.filter((f) => f.level === 'fail');
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ stats, fails, info: findings.filter((f) => f.level === 'info') }, null, 2));
  } else {
    console.log(`F7 规则 ${stats.f7Rules} 条 · 审计属性 ${stats.checked} 项 · 已抵消 ${stats.covered} 项`);
    if (fails.length) {
      console.log(`\n❌ ${fails.length} 项危险属性未被 f7-compat.css 抵消：`);
      for (const f of fails) {
        console.log(`  ${f.selector} { ${f.prop}: ${f.f7} }   ← ${f.rule}`);
        console.log(`      我们：${f.ours}`);
      }
    } else {
      console.log('✅ 所有危险属性都有显式抵消');
    }
    const infos = findings.filter((f) => f.level === 'info');
    if (infos.length) {
      console.log(`\nℹ️ ${infos.length} 项为 F7 变量驱动（变量未定义时不生效），可忽略：`);
      for (const f of infos.slice(0, 8)) console.log(`  ${f.selector} { ${f.prop}: ${f.f7} }`);
      if (infos.length > 8) console.log(`  … 还有 ${infos.length - 8} 项`);
    }
  }
  process.exit(fails.length ? 1 : 0);
}

main();
