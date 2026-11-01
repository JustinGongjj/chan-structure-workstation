'use strict';
/**
 * 可选 API Key 注册表
 * ------------------------------------------------------------------
 * 本站默认全部走免 key 数据源；下面这些是"有 key 就更好"的增强源。
 * 把它们集中在一处，是为了让"贴一个 key 就生效"变成配置问题而不是改代码问题。
 *
 * 用法（任意一种）：
 *   1) 环境变量：FINNHUB_KEY=xxx node server/index.js
 *   2) 项目根目录 .env.local（gitignore 已忽略）：FINNHUB_KEY=xxx
 *   3) 管理页数据源面板里看到"未配置"提示
 *
 * 安全：key 只在服务端使用，绝不注入到前端 HTML/JS。
 */
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '..', '.env.local');

/* key 名 → 元信息（注册地址、免费额度、能换来什么） */
const PROVIDERS = {
  FINNHUB_KEY: {
    name: 'Finnhub',
    signup: 'https://finnhub.io/register',
    quota: '免费 60 次/分钟',
    gains: ['美股实时报价', '美股公司新闻', '市场状态'],
    note: '注册需 reCAPTCHA + 邮箱验证',
  },
  TWELVEDATA_KEY: {
    name: 'Twelve Data',
    signup: 'https://twelvedata.com/pricing',
    quota: '免费 800 次/日、8 次/分钟',
    gains: ['美股/港股/外汇 K 线', '技术指标'],
    note: '邮箱注册即可，无 captcha',
  },
  ALPHAVANTAGE_KEY: {
    name: 'Alpha Vantage',
    signup: 'https://www.alphavantage.co/support/#api-key',
    quota: '免费 25 次/日',
    gains: ['美股日线增强', '加密货币'],
    note: '只需邮箱，秒发 key（表单提交即可）',
  },
  POLYGON_KEY: {
    name: 'Polygon.io',
    signup: 'https://polygon.io/dashboard/signup',
    quota: '免费 5 次/分钟',
    gains: ['美股日线/分钟线', '参考数据'],
    note: '邮箱注册',
  },
  TIINGO_KEY: {
    name: 'Tiingo',
    signup: 'https://www.tiingo.com/account/api/token',
    quota: '免费 1000 次/日',
    gains: ['美股 EOD', '新闻情绪'],
    note: '邮箱注册',
  },
};

let cache = null;

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  try {
    const txt = fs.readFileSync(ENV_FILE, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* 读不到就当没有 */ }
}

/** 取某个 key（没有返回 null） */
function get(keyName) {
  if (cache === null) { loadEnvFile(); cache = true; }
  const v = process.env[keyName];
  return v && v.trim() ? v.trim() : null;
}

/** 是否配置了某个源 */
function has(keyName) { return !!get(keyName); }

/** 当前可用的增强源清单（不含 key 本身，可安全返回给前端） */
function status() {
  return Object.entries(PROVIDERS).map(([envName, meta]) => ({
    env: envName,
    name: meta.name,
    configured: has(envName),
    signup: meta.signup,
    quota: meta.quota,
    gains: meta.gains,
    note: meta.note,
  }));
}

module.exports = { PROVIDERS, get, has, status, ENV_FILE };
