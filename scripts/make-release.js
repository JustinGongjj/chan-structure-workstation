#!/usr/bin/env node
'use strict';
/**
 * 打包发布物（源码 zip + git bundle + SHA256）
 * =====================================================================
 * 产出三个文件到 web/downloads/：
 *   chan-structure-workstation-vX.Y.Z-src.zip     纯源码（不含 .git / data/ / node_modules）
 *   chan-structure-workstation-vX.Y.Z-full.bundle 完整 git 历史（git clone 可得全部提交）
 *   SHA256SUMS.txt                                 校验和
 *
 * 不依赖外部 zip 命令（本环境没有 zip），用 Node 自带的 zlib 手写 zip。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'web', 'downloads');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const NAME = 'chan-structure-workstation';

/* 不打包的东西：运行时数据、依赖、临时文件、旧发布物 */
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'data', 'downloads', '.claude', '.vscode', '__pycache__']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'server-crash.log']);
const EXCLUDE_EXT = new Set(['.zip', '.bundle', '.log', '.tmp']);

function walk(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      out.push(...walk(abs, rel));
    } else {
      if (EXCLUDE_FILES.has(name)) continue;
      if (EXCLUDE_EXT.has(path.extname(name))) continue;
      out.push({ abs, rel, size: st.size });
    }
  }
  return out;
}

/* ---- 极简 zip 写入（store / deflate，UTF-8 文件名） ---- */
function makeZip(files, outPath) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const nameBuf = Buffer.from(f.rel, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);          // time
    local.writeUInt16LE(0x2821, 12);     // date (2020-01-01 便于复现)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x2821, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(outPath, Buffer.concat([...chunks, centralBuf, end]));
}

/* CRC32 查表 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---- 主流程 ---- */
fs.mkdirSync(OUT, { recursive: true });

const files = walk(ROOT);
const zipPath = path.join(OUT, `${NAME}-v${VERSION}-src.zip`);
makeZip(files, zipPath);
console.log(`✓ 源码包  ${path.basename(zipPath)}  ${(fs.statSync(zipPath).size / 1048576).toFixed(2)} MB  ${files.length} 个文件`);

const bundlePath = path.join(OUT, `${NAME}-v${VERSION}-full.bundle`);
try {
  execSync(`git bundle create "${bundlePath}" HEAD --all`, { cwd: ROOT, stdio: 'pipe' });
  const commits = execSync('git rev-list --count HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  console.log(`✓ 完整仓库 ${path.basename(bundlePath)}  ${(fs.statSync(bundlePath).size / 1048576).toFixed(2)} MB  ${commits} 次提交`);
} catch (e) {
  console.log('✗ bundle 生成失败：', e.message.slice(0, 100));
}

/* SHA256 */
const crypto = require('crypto');
const lines = [];
for (const f of [zipPath, bundlePath]) {
  if (!fs.existsSync(f)) continue;
  const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  lines.push(`${h}  ${path.basename(f)}`);
}
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
console.log(`✓ 校验和   SHA256SUMS.txt`);
console.log(`\n版本 v${VERSION}，输出目录 web/downloads/`);
