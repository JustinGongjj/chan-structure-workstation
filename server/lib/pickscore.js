/**
 * 量化推票引擎：缠论结构 + 量化因子混合打分
 * =====================================================================
 * 设计原则（全部有实测依据，见 docs/QUANT-SYNC.md）
 * ---------------------------------------------------------------------
 * 1. **不预测收益，只做排序**
 *    实测：加长窗口、加均线排列、缠论截面因子全部未达正交 IC 门槛 0.015。
 *    唯一达标的是「行业中性相对强弱」（ind_mom_20，正交后 IC −0.0198）。
 *    所以这里的任务是**在市场里排出相对顺序**，不是"预测哪只会涨"。
 *
 * 2. **方向不设死：默认等权中性，方向留给检验层决定**
 *
 *    这是一个被实测推翻过的决定，记录在此防止重新踩坑：
 *
 *    第一版按「反转 + 低波」设死了方向（跌得多的给高分），依据是星图的结论
 *    （mom20 的 Q5−Q1 = −1.03%，负向）。但在本站数据上实测：
 *
 *      cut260  动量 +0.77%      cut340  反转 −7.04%
 *      cut300  动量 +4.09%      cut380  反转 −4.35%
 *                          → 4 个时点，动量 2 次 / 反转 2 次
 *
 *    又试了「用上一期方向预测下一期」（滚动自适应）：命中 2/5，等于抛硬币。
 *
 *    结论：**在 10 日尺度上，动量/反转的方向本身不稳定。**
 *    任何固定方向的打分都是在赌某一段行情。
 *
 *    所以现在的做法是：
 *      · 打分默认用「中性方向」（各因子等权，方向记为 0，不假设正负）
 *      · 真实方向由 /api/picks/validate 用历史数据现算，并如实展示"是否显著"
 *      · 用户可以手动指定方向，但界面会同时显示"这个方向在历史上稳不稳" 
 *
 * 3. **缠论结构只提供量化因子给不了的信息**
 *    实测：缠论买卖点作为择时信号，在震荡市跑赢、趋势市跑输；
 *    加止损反而把胜率从 43.4% 打到 26.5%。所以结构不当作 buy/sell 触发器。
 *
 *    更关键的一条：第一版结构分用「中枢位置」，实测与 mom20 相关 0.587，
 *    等于同一件事计两次分，推出来结构分全是 100（无区分度）。
 *    现在改为用「中枢数量 + 信号新鲜度」——这两项量化三因子完全没有。
 *
 * 4. **打分可解释**：每一项都返回原始值 + 分位 + 权重 + 贡献，能复核。
 */

'use strict';

const C = require('./chan');
const S = require('./sources');

/** 分位归一化：把一组数映射到 0~1，方向和缺省值可指定 */
function pctRank(values, v, higherBetter) {
  const arr = values.filter((x) => Number.isFinite(x));
  if (!arr.length || !Number.isFinite(v)) return 0.5;
  const sorted = [...arr].sort((a, b) => a - b);
  // 二分求排名
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1; else hi = mid;
  }
  const p = sorted.length === 1 ? 0.5 : lo / (sorted.length - 1);
  return higherBetter ? p : 1 - p;
}

/** 简单滚动统计（不依赖外部库） */
function mean(a) {
  let s = 0, n = 0;
  for (const x of a) if (Number.isFinite(x)) { s += x; n++; }
  return n ? s / n : null;
}
function std(a) {
  const m = mean(a);
  if (m === null) return null;
  let s = 0, n = 0;
  for (const x of a) if (Number.isFinite(x)) { s += (x - m) ** 2; n++; }
  return n > 1 ? Math.sqrt(s / (n - 1)) : null;
}

/**
 * 计算单个标的的原始指标（不做截面比较）
 * @param {Array} bars 日线，升序
 * @param {object} chanRes C.analyze 的结果（withState:false）
 * @returns {object|null}
 */
function rawMetrics(bars, chanRes) {
  if (!bars || bars.length < 120) return null;
  const n = bars.length;
  const c = bars.map((b) => b.c);
  const v = bars.map((b) => b.v || 0);
  const last = c[n - 1];

  // 20 日动量（ind_mom_20 的个股部分）
  const mom20 = c[n - 21] > 0 ? last / c[n - 21] - 1 : null;
  // 60 日相对均线偏离（dev60）
  const ma60 = mean(c.slice(-60));
  const dev60 = ma60 && ma60 > 0 ? last / ma60 - 1 : null;
  // 20 日波动率
  const rets = [];
  for (let i = n - 20; i < n; i++) if (i > 0 && c[i - 1] > 0) rets.push(c[i] / c[i - 1] - 1);
  const vol20 = std(rets);
  // 量能波动（vstd20）
  const vr = [];
  for (let i = n - 20; i < n; i++) if (i > 0 && v[i - 1] > 0) vr.push(v[i] / v[i - 1] - 1);
  const vstd20 = std(vr);
  // 5 日收益
  const ret5 = c[n - 6] > 0 ? last / c[n - 6] - 1 : null;
  // 20 日日均成交额（流动性）
  let amtSum = 0, amtN = 0;
  for (let i = n - 20; i < n; i++) {
    const a = c[i] * v[i];
    if (Number.isFinite(a)) { amtSum += a; amtN++; }
  }
  const amt20 = amtN ? amtSum / amtN : null;

  // ---- 缠论结构：只取"位置"类信息 ----
  let struct = null;
  if (chanRes && chanRes.ok) {
    const st = chanRes.stats || {};
    const piv = chanRes.pivots && chanRes.pivots.length ? chanRes.pivots[chanRes.pivots.length - 1] : null;
    let posPct = null;
    if (piv && piv.zg != null && piv.zd != null) {
      const h = Math.max(piv.zg - piv.zd, 1e-9);
      posPct = (last - (piv.zd + h / 2)) / h;
    }
    struct = {
      trend: (chanRes.trend && chanRes.trend.type) || null,
      position: st.position || null,       // above / inside / below / none
      pivots: st.pivots || 0,
      posPct,                              // 相对最近中枢中轴的标准化位置
      lastSignal: (chanRes.signals && chanRes.signals.length)
        ? chanRes.signals[chanRes.signals.length - 1].type : null,
      sigAgeBars: (chanRes.signals && chanRes.signals.length)
        ? n - 1 - chanRes.signals[chanRes.signals.length - 1].barIdx : null,
    };
  }

  return { mom20, dev60, vol20, vstd20, ret5, amt20, struct, price: last };
}

/**
 * 截面打分。
 * @param {Array} rows [{code,name,raw}]
 * @param {object} o 选项
 * @returns {Array} 带总分的排序结果
 */
function scoreCrossSection(rows, o = {}) {
  const valid = rows.filter((r) => r.raw);
  if (!valid.length) return [];

  const cols = {
    mom20: valid.map((r) => r.raw.mom20),
    dev60: valid.map((r) => r.raw.dev60),
    vstd20: valid.map((r) => r.raw.vstd20),
    ret5: valid.map((r) => r.raw.ret5),
    vol20: valid.map((r) => r.raw.vol20),
    amt20: valid.map((r) => r.raw.amt20),
  };

  /* 权重来自实测（星图「反转+低波」体系，与本站独立验证一致）：
     四个方向全是负向 —— 跌得多、波动小的后续更好。
     这里把「负向」体现在 pctRank 的 higherBetter=false 上。 */
  const W = {
    mom20: 0.20, dev60: 0.18, ret5: 0.14, vstd20: 0.14,
    vol20: 0.12, struct: 0.12, amt20: 0.10,
  };

  /* 方向：默认全部 null（不假设正负）。
     传 dirs 可覆盖，例如 { mom20: -1 } 表示"动量越低越好"。
     只有 amt20（流动性）方向是确定的——越高越好交易，与收益预测无关。 */
  const DIR = Object.assign(
    { mom20: null, dev60: null, ret5: null, vstd20: null, vol20: null, struct: null, amt20: 1 },
    o.dirs || {}
  );

  /** 按方向取分位；方向为 null 时取 0.5（完全中性，不贡献区分度也不误导） */
  const pick = (col, v, dir) => {
    if (dir === null || dir === undefined) return 0.5;
    return pctRank(cols[col], v, dir > 0);
  };

  const out = valid.map((r) => {
    const x = r.raw;
    const parts = {};
    parts.mom20 = pick('mom20', x.mom20, DIR.mom20);
    parts.dev60 = pick('dev60', x.dev60, DIR.dev60);
    parts.ret5 = pick('ret5', x.ret5, DIR.ret5);
    parts.vstd20 = pick('vstd20', x.vstd20, DIR.vstd20);
    parts.vol20 = pick('vol20', x.vol20, DIR.vol20);
    parts.amt20 = pick('amt20', x.amt20, DIR.amt20);

    /* 缠论结构分：只取「量化因子给不了」的信息
       ------------------------------------------
       第一版用的是中枢位置（posPct），实测与 mom20 相关 0.587 ——
       两者都在测「跌了多少」，等于同一件事计了两次分，
       结果推出来的票结构分全是 100，这一项没有区分度。

       改为用**中枢数量 + 信号新鲜度**，这两项量化三因子完全没有：
         · 中枢越多 → 反复盘整 → 实测 cs_pivots 的 IC 为负（越多后续越弱）
         · 有新鲜买点信号 → 轻微加分（实测 cs_sig 的 IC +0.009，很弱但方向为正）
       位置信息已由 mom20/dev60 覆盖，不再重复计分。 */
    let structScore = 0.5;
    if (x.struct) {
      const np = Number.isFinite(x.struct.pivots) ? x.struct.pivots : null;
      // 中枢数 0~8 映射：少的得高分（0 个 → 1.0，8+ 个 → 0.0）
      const pivotScore = np === null ? 0.5 : Math.max(0, Math.min(1, 1 - np / 8));
      // 信号新鲜度：5 根内有买点 +0.15，10 根内 +0.08
      let sigBonus = 0;
      if (x.struct.lastSignal && /B$/.test(String(x.struct.lastSignal))) {
        const age = x.struct.sigAgeBars;
        if (Number.isFinite(age)) sigBonus = age <= 5 ? 0.15 : age <= 10 ? 0.08 : 0;
      }
      structScore = Math.max(0, Math.min(1, pivotScore * 0.85 + 0.15 * 0.5 + sigBonus));
    }
    parts.struct = structScore;

    let total = 0;
    for (const k of Object.keys(W)) total += W[k] * parts[k];

    return {
      code: r.code,
      name: r.name,
      total: +(total * 100).toFixed(2),
      parts: Object.fromEntries(Object.keys(W).map((k) => [k, +(parts[k] * 100).toFixed(1)])),
      weights: W,
      dirs: DIR,
      raw: x,
    };
  });

  out.sort((a, b) => b.total - a.total);
  return out;
}

module.exports = { rawMetrics, scoreCrossSection, pctRank };
