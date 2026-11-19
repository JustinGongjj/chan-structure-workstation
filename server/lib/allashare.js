/**
 * 全市场标的清单
 * =====================================================================
 * 为什么需要：工作站原有的 UNIVERSE 只有 136 个精选标的（A 股 49 只），
 * 做「推票」时选股范围太小，选出来的票没有代表性。
 *
 * 数据源：新浪行情中心 hs_a 节点，分页 100 条/页，实测全 A 股 5579 只
 * （55 页 × 100 + 79）。约 56 次请求，全部走 cached() 12 小时缓存。
 *
 * 纪律：
 *   · 只取清单（代码/名称/现价/涨跌幅/成交额），不取 K 线
 *   · K 线按需再取，避免一次拉 5579 只 × 800 根把内存打爆
 *   · 任何一页失败不影响其他页，返回里带 failedPages 让调用方知道覆盖面
 */
'use strict';

const { getJSON, cached } = require('./http');

const SINA_HQ = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const NODE = 'hs_a';          // 沪深 A 股（含北交所）
const PAGE_SIZE = 100;
const MAX_PAGE = 60;          // 防御：正常 56 页
const TTL = 12 * 3600 * 1000; // 12 小时

/** 判断代码是否属于可交易的 A 股主板/创业板/科创板/北交所 */
function isTradableA(code) {
  const c = String(code || '').padStart(6, '0');
  // 排除：B股(900/200)、退市整理、指数
  if (/^(900|200)/.test(c)) return false;
  // 北交所 4/8/920 开头；其余 00/30/60/68 正常
  return /^(0|3|6|4|8|9)/.test(c);
}

/** 板块（用于涨跌停幅度判定与行业分组） */
function boardOf(code) {
  const c = String(code || '').padStart(6, '0');
  if (/^(688|689)/.test(c)) return { board: 'STAR', label: '科创板', limitPct: 20 };
  if (/^(300|301)/.test(c)) return { board: 'GEM', label: '创业板', limitPct: 20 };
  if (/^(4|8|920)/.test(c)) return { board: 'BSE', label: '北交所', limitPct: 30 };
  return { board: 'MAIN', label: '主板', limitPct: 10 };
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchPage(page) {
  const url = `${SINA_HQ}?page=${page}&num=${PAGE_SIZE}&sort=symbol&asc=1&node=${NODE}`;
  const d = await getJSON(url, { timeout: 20000 });
  return Array.isArray(d) ? d : [];
}

/**
 * 拉取全市场清单。
 * @param {object} opts
 * @param {boolean} opts.nocache 跳缓存（调试用）
 * @returns {{ok:boolean, items:Array, total:number, pages:number, failedPages:number[], cached:boolean}}
 */
async function allAShare(opts = {}) {
  const run = async () => {
    const pages = Math.ceil(MAX_PAGE);
    const results = await Promise.allSettled(
      Array.from({ length: pages }, (_, i) => fetchPage(i + 1))
    );
    const items = [];
    const failedPages = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        for (const x of r.value) {
          const code = String(x.code || '').padStart(6, '0');
          const price = toNum(x.trade);
          if (!isTradableA(code)) continue;
          if (price === null || price <= 0) continue;   // 停牌/无价格
          const b = boardOf(code);
          items.push({
            market: 'A',
            code,
            name: String(x.name || '').trim(),
            price,
            pct: toNum(x.changepercent),
            amount: toNum(x.amount) || 0,
            volume: toNum(x.volume) || 0,
            board: b.board,
            boardLabel: b.label,
            limitPct: b.limitPct,
          });
        }
      } else {
        failedPages.push(i + 1);
      }
    });
    // 去重（分页边界可能重复）
    const seen = new Map();
    for (const it of items) if (!seen.has(it.code)) seen.set(it.code, it);
    const list = [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
    return { ok: list.length > 1000, items: list, total: list.length, failedPages };
  };

  if (opts.nocache) {
    const r = await run();
    return { ...r, cached: false };
  }
  // cached() 返回的是 { value, cached, stale } —— 必须取 .value，
  // 直接把返回值当结果用会得到 undefined（实测踩过）。
  const wrap = await cached('allashare:v1', TTL, run);
  const r = (wrap && wrap.value) || { ok: false, items: [], total: 0, failedPages: [] };
  return { ...r, cached: !!(wrap && wrap.cached) };
}

/**
 * 按流动性筛选。默认取成交额前 N 只，避免选到僵尸股。
 * @param {Array} items allAShare().items
 * @param {object} o
 */
function liquidUniverse(items, o = {}) {
  const topN = Math.max(50, Math.min(Number(o.topN) || 1200, 5000));
  const minAmount = Number(o.minAmount) || 2e7;      // 2000 万
  const minPrice = Number(o.minPrice) || 2.0;
  const maxPrice = Number(o.maxPrice) || 2000;
  const arr = (items || []).filter(
    (x) => x.amount >= minAmount && x.price >= minPrice && x.price <= maxPrice
  );
  arr.sort((a, b) => b.amount - a.amount);
  return arr.slice(0, topN);
}

module.exports = { allAShare, liquidUniverse, isTradableA, boardOf };
