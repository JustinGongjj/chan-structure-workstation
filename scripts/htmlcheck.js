#!/usr/bin/env node
/**
 * HTML 结构体检（不联网、不需要浏览器）
 *   node scripts/htmlcheck.js
 * 检查：标签配平、重复 id、script/link 引用是否存在、必填 meta
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['web/index.html', 'web/m/index.html', 'web/game/index.html'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

let fails = 0;
const bad = (f, msg) => { fails++; console.error(`  ✗ ${f}: ${msg}`); };

for (const rel of PAGES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { bad(rel, '文件不存在'); continue; }
  const html = fs.readFileSync(file, 'utf8');
  console.log(`\n${rel}  (${(html.length / 1024).toFixed(1)} KB)`);

  // 1) 标签配平（忽略注释 / script / style 内容）
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(stripped))) {
    const [, closing, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (VOID.has(tag) || selfClose === '/') continue;
    if (!closing) { stack.push({ tag, at: m.index }); continue; }
    const top = stack.pop();
    if (!top) { bad(rel, `多余的闭合标签 </${tag}>`); break; }
    if (top.tag !== tag) { bad(rel, `标签不配平：<${top.tag}> 被 </${tag}> 关闭`); break; }
  }
  if (stack.length) bad(rel, `未闭合标签：${stack.map((s) => '<' + s.tag + '>').slice(0, 5).join(' ')}`);

  // 2) 重复 id
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) bad(rel, `重复 id：${[...new Set(dup)].slice(0, 5).join(', ')}`);

  // 3) 资源引用存在性（只查本地相对路径）
  const refs = [
    ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]+href="([^"]+)"/g),
  ].map((x) => x[1]).filter((u) => u.startsWith('/') && !u.startsWith('//'));
  for (const u of refs) {
    const p = path.join(ROOT, 'web', u.split('?')[0].replace(/^\//, ''));
    if (!fs.existsSync(p)) bad(rel, `引用的资源不存在：${u}`);
  }

  // 4) 必填 meta
  if (!/<meta[^>]+name="viewport"/i.test(html)) bad(rel, '缺 viewport');
  if (!/<meta[^>]+charset=/i.test(html)) bad(rel, '缺 charset');
  if (!/<title>[^<]+<\/title>/i.test(html)) bad(rel, '缺 title');

  console.log(`  id ${ids.length} 个 · 本地资源 ${refs.length} 个`);
}

console.log(fails ? `\n❌ ${fails} 处问题` : '\n✅ HTML 结构检查通过');
process.exitCode = fails ? 1 : 0;
