#!/usr/bin/env node
/**
 * 一键发布到 GitHub —— 走 GitHub REST API（不需要 git push，因此在只放行
 * api.github.com 的网络里也能用）。
 *
 * 用法：
 *   GH_TOKEN=ghp_xxx node scripts/publish-github.js
 *   GH_TOKEN=ghp_xxx node scripts/publish-github.js --repo chan-structure --private --dry
 *   GH_TOKEN=ghp_xxx node scripts/publish-github.js --description "..." --homepage "..."
 *
 * Token 权限（二选一）：
 *   · classic PAT：勾选  repo        （要上传 .github/workflows 还需 workflow）
 *   · fine-grained：Contents=Read/Write、Administration=Read/Write、Workflows=Read/Write
 *
 * 幂等：重复执行会对比远端 git blob sha，只上传变化的文件，并删除本地已不存在的文件。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://api.github.com';
const OWNER_OVERRIDE = argOf('--owner');
const REPO = argOf('--repo') || 'chan-structure-workstation';
const BRANCH = argOf('--branch') || 'main';
const PRIVATE = hasFlag('--private');
const DRY = hasFlag('--dry');
const TAG = argOf('--tag') || 'v1.0.0';
const DESC =
  argOf('--description') ||
  'Deterministic, dependency-free Chan-theory (缠论) structure engine: fractals, strokes, pivots, divergence, 1B/2B/3B signals + multi-market workstation (A-shares/HK/US/crypto). Zero runtime dependencies.';

const IGNORE = [
  '.git',
  'node_modules',
  '.chrome-deps',
  'coverage',
  '.DS_Store',
  'scripts/shot.sh',
  'scripts/restart.sh',
  'scripts/publish-github.js',
];

function hasFlag(name) {
  return process.argv.includes(name);
}
function argOf(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function log(...a) {
  console.log(...a);
}
function die(msg) {
  console.error('\n✖ ' + msg + '\n');
  process.exit(1);
}

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_PAT;
if (!TOKEN) {
  die(
    '缺少 GH_TOKEN。\n\n  创建一个有 repo(或 Contents write + Administration write) 权限的 Token：\n' +
      '  https://github.com/settings/tokens/new?scopes=repo,workflow&description=chan-station-publish\n\n' +
      '  然后：GH_TOKEN=ghp_xxx node scripts/publish-github.js'
  );
}

async function api(method, url, body, retry = 0) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'chan-structure-workstation-publisher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = { raw: text };
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (retry < 3) {
      const wait = res.headers.get('retry-after') ? Number(res.headers.get('retry-after')) * 1000 : 4000;
      log(`   … 触发限流（remaining=${remaining}），${Math.round(wait / 1000)}s 后重试`);
      await new Promise((r) => setTimeout(r, wait));
      return api(method, url, body, retry + 1);
    }
  }
  return { status: res.status, ok: res.ok, json };
}

/* ---------------- 本地文件清单（含 git blob sha） ---------------- */
function blobSha(buf) {
  return crypto
    .createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest('hex');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (IGNORE.some((ig) => rel === ig || rel.startsWith(ig + '/'))) continue;
    if (entry.isDirectory()) walk(abs, out);
    else out.push(rel);
  }
  return out;
}

function collectFiles() {
  const files = walk(ROOT)
    .filter((rel) => !/\.(bundle|zip|log)$/.test(rel))
    .map((rel) => {
      const buf = fs.readFileSync(path.join(ROOT, rel));
      return { rel, buf, sha: blobSha(buf) };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

/* ---------------- 主流程 ---------------- */
(async () => {
  log('\n▸ 校验 Token');
  const me = await api('GET', '/user');
  if (!me.ok) die(`Token 无效或权限不足（HTTP ${me.status}）：${JSON.stringify(me.json).slice(0, 200)}`);
  const owner = OWNER_OVERRIDE || me.json.login;
  log(`  已认证：@${owner}（${me.json.type}）`);

  log(`\n▸ 确认仓库 ${owner}/${REPO}`);
  let repoRes = await api('GET', `/repos/${owner}/${REPO}`);
  if (repoRes.status === 404) {
    if (DRY) {
      log('   [dry-run] 将创建仓库');
      repoRes = { ok: true, json: { full_name: `${owner}/${REPO}`, html_url: `https://github.com/${owner}/${REPO}` } };
    } else {
      repoRes = await api('POST', '/user/repos', {
        name: REPO,
        description: DESC.slice(0, 300),
        homepage: `https://github.com/${owner}/${REPO}`,
        private: PRIVATE,
        has_issues: true,
        has_discussions: true,
        has_wiki: false,
        has_projects: false,
        auto_init: false,
      });
      if (!repoRes.ok) die(`创建仓库失败（HTTP ${repoRes.status}）：${JSON.stringify(repoRes.json).slice(0, 300)}`);
      log(`   ✓ 已创建 ${repoRes.json.full_name}`);
      await new Promise((r) => setTimeout(r, 1200));
    }
  } else if (repoRes.ok) {
    log(`   仓库已存在：${repoRes.json.full_name}（将增量更新）`);
  } else {
    die(`读取仓库失败（HTTP ${repoRes.status}）：${JSON.stringify(repoRes.json).slice(0, 200)}`);
  }

  const files = collectFiles();
  log(`\n▸ 收集到 ${files.length} 个文件`);

  // 远端现有文件 sha（用于增量）
  let remote = new Map();
  const tree = await api('GET', `/repos/${owner}/${REPO}/git/trees/${BRANCH}?recursive=1`);
  if (tree.ok && Array.isArray(tree.json.tree)) {
    for (const t of tree.json.tree) if (t.type === 'blob') remote.set(t.path, t.sha);
    log(`   远端已有 ${remote.size} 个文件（分支 ${BRANCH}）`);
  } else {
    log('   远端为空（首次发布）');
  }

  let uploaded = 0;
  let skipped = 0;
  const failed = [];
  for (const f of files) {
    if (remote.get(f.rel) === f.sha) {
      skipped++;
      continue;
    }
    if (DRY) {
      log(`   [dry-run] 上传 ${f.rel} (${f.buf.length}B)`);
      uploaded++;
      continue;
    }
    if (f.buf.length > 45 * 1024 * 1024) {
      failed.push({ rel: f.rel, why: '文件超过 45MB，请用 git push' });
      continue;
    }
    const payload = {
      message: `add ${f.rel}`,
      content: f.buf.toString('base64'),
      branch: BRANCH,
    };
    let r = await api('PUT', `/repos/${owner}/${REPO}/contents/${encodeURI(f.rel)}`, payload);
    if (!r.ok && r.status === 422) {
      // 空仓库时指定 branch 可能失败：去掉 branch 重试
      delete payload.branch;
      r = await api('PUT', `/repos/${owner}/${REPO}/contents/${encodeURI(f.rel)}`, payload);
    }
    if (!r.ok) {
      const msg = JSON.stringify(r.json).slice(0, 220);
      if (/workflow/i.test(msg)) failed.push({ rel: f.rel, why: '缺少 workflow 权限（给 Token 勾选 workflow 或 fine-grained 的 Workflows write）' });
      else failed.push({ rel: f.rel, why: `HTTP ${r.status} ${msg}` });
      continue;
    }
    uploaded++;
    if (uploaded % 15 === 0) log(`   … 已上传 ${uploaded} 个文件`);
  }
  log(`   上传 ${uploaded} · 跳过 ${skipped} · 失败 ${failed.length}`);

  // 删除远端多余文件
  if (!DRY && remote.size) {
    const localSet = new Set(files.map((f) => f.rel));
    const extra = [...remote.keys()].filter((p) => !localSet.has(p));
    for (const p of extra) {
      const r = await api('DELETE', `/repos/${owner}/${REPO}/contents/${encodeURI(p)}`, {
        message: `remove ${p}`,
        branch: BRANCH,
      });
      log(`   − 删除远端多余文件 ${p}${r.ok ? '' : '（失败 ' + r.status + '）'}`);
    }
  }

  if (!DRY) {
    log('\n▸ 设置仓库信息');
    const topics = [
      'chan-theory', 'chang-lun', '缠论', 'technical-analysis', 'quantitative-finance',
      'trading', 'stock-analysis', 'crypto', 'pivot-detection', 'divergence',
      'canvas', 'pwa', 'zero-dependency', 'nodejs', 'a-shares',
    ];
    const t = await api('PUT', `/repos/${owner}/${REPO}/topics`, { names: topics });
    log(t.ok ? `   ✓ topics ${topics.length} 个` : `   ! topics 失败 ${t.status}`);

    const p = await api('PATCH', `/repos/${owner}/${REPO}`, {
      description: DESC.slice(0, 300),
      homepage: `https://github.com/${owner}/${REPO}`,
      has_discussions: true,
      has_issues: true,
      allow_squash_merge: true,
      delete_branch_on_merge: true,
    });
    log(p.ok ? '   ✓ description / homepage / discussions' : `   ! PATCH 失败 ${p.status}`);

    log('\n▸ 创建 Release');
    const notes = [
      '**v1.0.0 — first public release**',
      '',
      '- Deterministic Chan-theory engine: inclusion merge → fractal → stroke → segment → pivot → trend → divergence → 1B/2B/3B',
      '- Multi-market adapters with fallback chains (A-shares / HK / US / crypto), zero API keys',
      '- Teaching annotations: every concept can be highlighted on the chart with real dates, prices and MACD areas',
      '- Desktop workstation + mobile PWA (iOS / Android skins, touch chart, installable)',
      '- I Ching timing module with reproducible seeds (entertainment only)',
      '- 22 unit tests (node:test), CI on Node 18/20/22, Dockerfile + one-click Hugging Face Space',
      '',
      '📖 See README for quickstart, API and the honest list of documented simplifications.',
      '',
      '> Not investment advice.',
    ].join('\n');
    const rel = await api('POST', `/repos/${owner}/${REPO}/releases`, {
      tag_name: TAG,
      name: `v1.0.0 — Chan Structure Workstation`,
      body: notes,
      draft: false,
      prerelease: false,
    });
    log(rel.ok ? `   ✓ Release ${TAG}` : `   ! Release 失败 ${rel.status}：${JSON.stringify(rel.json).slice(0, 160)}`);
  }

  const url = `https://github.com/${owner}/${REPO}`;
  log('\n──────────────────────────────────────────────');
  log(`  ✓ 发布完成：${url}`);
  log(`    · 演示页（部署后）：<你的域名>/  手机版：<你的域名>/m/`);
  log('    · 仍需手动完成：Settings → Social preview 上传 docs/assets/og.png');
  log('    · 可选：Settings → Topics 已自动设置；Discussions 已开启');
  log('──────────────────────────────────────────────\n');

  if (failed.length) {
    log('⚠ 以下文件未能上传：');
    for (const f of failed) log(`   - ${f.rel}: ${f.why}`);
    log('');
    process.exitCode = 2;
  }
})().catch((e) => die(e.stack || String(e)));
