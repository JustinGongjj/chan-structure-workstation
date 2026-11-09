'use strict';
/**
 * 回测历史存档
 * =====================================================================
 * 解决什么问题：每次跑完回测，结果看完就没了。
 * 想知道"这套参数上周 46 分、这周多少"，或者"换个参数后是不是真变好了"，
 * 没有历史就无从对比。
 *
 * ▍存储设计
 *   单个 JSON 文件（data/backtest-history.json），按"指纹"分组。
 *   指纹 = 回测类型 + 标的列表 + 关键参数（不含打分权重，因为权重只影响评分口径，
 *   不影响回测结果本身——同一份回测用不同权重应该能对比）。
 *
 *   结构：
 *     {
 *       "kinds": {
 *         "quant:CNF:6:day": {
 *           "label": "量化组合 · 期货 · 6品种 · 日线",
 *           "entries": [ { id, at, metrics, score, input, ... } ]   // 最近 N 条
 *         }
 *       }
 *     }
 *
 * ▍为什么按指纹分组而不是平铺
 *   平铺的话，10 套参数 × 20 次执行 = 200 条混在一起，看不出趋势。
 *   分组后每个配置有自己的时间序列，才能算"较上次变化"。
 *
 * ▍容量
 *   每个指纹最多留 30 条，总量上限 200 个指纹。超出淘汰最旧的。
 *   文件很小（每条只存指标摘要，不存逐笔明细），不做压缩。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ENTRIES_PER_KEY = 30;
const MAX_KEYS = 200;

function makeStore(file) {
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const j = JSON.parse(raw);
      cache = j && j.kinds ? j : { kinds: {} };
    } catch (e) {
      cache = { kinds: {} };
    }
    return cache;
  }

  function save() {
    const dir = path.dirname(file);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 已存在 */ }
    // 原子写：先写临时文件再改名，避免进程被杀留下半个文件
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 1), 'utf8');
    fs.renameSync(tmp, file);
  }

  /*
    生成指纹：只含影响回测结果的参数，且**先归一化默认值**。
    为什么必须先归一化：同一组参数，一次带 entry:'both'、一次不带，
    指纹就不同 → 历史被拆成两组，趋势图永远是单点。
    （实测踩到：手工造的数据与真实调用分成两组，各 1 条）
    归一化规则：所有字段填上默认值，数值统一转 Number，空串统一为 ''。
  */
  function normalize(input) {
    const n = (v, d) => {
      if (v === undefined || v === null || v === '') return d;
      const x = Number(v);
      return Number.isFinite(x) ? x : d;
    };
    const s = (v, d) => (v === undefined || v === null ? d : String(v));
    return {
      mk: s(input.markets, ''),
      sym: s(input.symbols, ''),
      mc: input.market && input.code ? input.market.toUpperCase() + ':' + String(input.code) : '',
      p: s(input.period, 'day'),
      e: s(input.entry, 'both'),
      sig: s(input.signalTypes, ''),
      st: n(input.stopPct, 0),
      tk: n(input.takePct, 0),
      bs: s(input.biStyle, 'new'),
      ex: s(input.exitOn, 'signal'),
      mtf: s(input.mtfMode, ''),
      rm: s(input.restoreMode, 'price'),
      mw: n(input.maxWeightPerSymbol, 1),
      fee: n(input.feeBps, 8),
      slip: n(input.slipBps, 4),
      ms: n(input.maxSymbols, 0),
    };
  }

  function fingerprint(kind, input) {
    const key = JSON.stringify({ k: kind, ...normalize(input) });
    return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  }

  function labelOf(kind, input) {
    const MK = require('./constants').MARKETS;
    const parts = [];
    if (kind === 'quant') parts.push('量化组合');
    else if (kind === 'batch') parts.push('因子回测·批量');
    else if (kind === 'single') parts.push('因子回测·单标的');
    else if (kind === 'defense') parts.push('防守回测');
    else parts.push(kind);

    if (input.symbols) parts.push(input.symbols.split(',').slice(0, 3).join('/') + (input.symbols.split(',').length > 3 ? '…' : ''));
    else if (input.markets) parts.push(input.markets.split(',').map((m) => MK[m.trim()] || m).join('+'));
    else parts.push('全部');
    if (input.market && input.code) parts.push(input.market + ':' + input.code);
    if (input.signalTypes) parts.push(input.signalTypes);
    if (input.period && input.period !== 'day') parts.push(input.period);
    if (input.stopPct > 0) parts.push(`止损${input.stopPct}%`);
    if (input.takePct > 0) parts.push(`止盈${input.takePct}%`);
    return parts.join(' · ');
  }

  /**
   * 记录一次回测
   * @param {string} kind  quant | batch | single | defense
   * @param {object} input 回测输入参数
   * @param {object} payload { score, metrics, summary }
   */
  function record(kind, input, payload) {
    const st = load();
    const key = kind + ':' + fingerprint(kind, input);
    if (!st.kinds[key]) {
      st.kinds[key] = { label: labelOf(kind, input), kind, createdAt: Date.now(), entries: [] };
    }
    const bucket = st.kinds[key];
    bucket.label = labelOf(kind, input); // 标签随参数更新
    // 同一秒内重复执行：覆盖而不是追加（避免刷新页面刷出一堆）
    const now = Date.now();
    const last = bucket.entries[bucket.entries.length - 1];
    const entry = {
      id: key + ':' + now,
      at: now,
      score: payload.score ? payload.score.total : null,
      grade: payload.score ? payload.score.grade.text : null,
      metrics: payload.metrics || null,
      summary: payload.summary || null,
    };
    if (last && now - last.at < 1000) bucket.entries[bucket.entries.length - 1] = entry;
    else bucket.entries.push(entry);
    if (bucket.entries.length > MAX_ENTRIES_PER_KEY) {
      bucket.entries = bucket.entries.slice(-MAX_ENTRIES_PER_KEY);
    }

    // 总量控制
    const keys = Object.keys(st.kinds);
    if (keys.length > MAX_KEYS) {
      keys.sort((a, b) => (st.kinds[a].createdAt || 0) - (st.kinds[b].createdAt || 0));
      for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete st.kinds[k];
    }
    save();
    return entry;
  }

  /** 取某个指纹的历史（含"较上次变化"） */
  function series(kind, input) {
    const st = load();
    const key = kind + ':' + fingerprint(kind, input);
    const b = st.kinds[key];
    if (!b) return { ok: true, key, label: labelOf(kind, input), entries: [], delta: null };
    const es = b.entries.slice();
    const prev = es.length >= 2 ? es[es.length - 2] : null;
    const cur = es.length ? es[es.length - 1] : null;
    return {
      ok: true,
      key,
      label: b.label,
      entries: es,
      delta: prev && cur && prev.score != null && cur.score != null
        ? { score: cur.score - prev.score, at: prev.at } : null,
    };
  }

  /** 列出所有存档（按最近更新排序） */
  function listAll(limit = 50) {
    const st = load();
    const rows = Object.entries(st.kinds).map(([key, b]) => {
      const es = b.entries || [];
      const cur = es[es.length - 1];
      return {
        key,
        label: b.label,
        kind: b.kind,
        runs: es.length,
        lastAt: cur ? cur.at : null,
        lastScore: cur ? cur.score : null,
        lastGrade: cur ? cur.grade : null,
        /* 趋势图用：完整分数序列（时间 + 分数），最多 30 点 */
        points: es.map((e) => ({ at: e.at, score: e.score })).filter((pt) => pt.score != null),
        /* 首末对比：这笔配置从第一次跑到现在变了多少 */
        trend: es.length >= 2 && es[0].score != null && cur.score != null
          ? cur.score - es[0].score : null,
      };
    }).filter((x) => x.lastAt);
    rows.sort((a, b) => b.lastAt - a.lastAt);
    return rows.slice(0, limit);
  }

  function remove(key) {
    const st = load();
    if (!st.kinds[key]) return false;
    delete st.kinds[key];
    save();
    return true;
  }

  function clear() {
    cache = { kinds: {} };
    save();
  }

  return { record, series, listAll, remove, clear, fingerprint, normalize, _load: load };
}

module.exports = { makeStore, MAX_ENTRIES_PER_KEY, MAX_KEYS };
