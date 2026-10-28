/**
 * 「缠关 · 108」闯关小游戏 · 关卡引擎（服务端）
 *
 * 设计要点
 *   1. 关卡由 **真实最新行情** 生成：每次取现在能拿到的最新 K 线，随机截断到某个位置，
 *      让玩家判断"接下来会怎么走 / 买卖点在哪 / 中枢在哪"。
 *   2. 答案绝不下发给客户端：出题只给截断前的 K 线 + 一张 token；
 *      判分时服务端用同一份数据重算答案（同一 code/period/cutoff 数据稳定），再比对。
 *   3. 完全确定性：level = f(no, cutoff, data)，同样的输入永远同样的题与分。
 *
 * 关卡结构：108 关，按 14 个主题分章，难度分四档（青铜/白银/黄金/王者），
 * 题型按主题分配：看未来（predict）/ 找买卖点（signal）/ 框中枢（pivot）/ 判背驰（beichi）。
 */
'use strict';

const crypto = require('crypto');
const S = require('./sources');
const C = require('./chan');

const SECRET = process.env.GAME_SECRET || 'chan-game-2026';
const HIDDEN = 12; // 每关隐藏 12 根 K 线等着玩家判断

/* 题库素材：四市场轮换，保证"最新行情"覆盖各市场 */
const POOL = {
  A: ['600519', '300750', '000001', '601899', '002594', '688981', '600036', '601318', '000858', '002415'],
  HK: ['00700', '09988', '03690', '01810', '00981', '02318'],
  US: ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META'],
  CR: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
};

const RANKS = [
  { key: 'bronze', name: '青铜', range: [1, 27], color: '#b08d57' },
  { key: 'silver', name: '白银', range: [28, 54], color: '#9aa7b8' },
  { key: 'gold', name: '黄金', range: [55, 81], color: '#e0b15a' },
  { key: 'king', name: '王者', range: [82, 108], color: '#a78bfa' }
];

/* 主题 id → 题型（chan-lessons 的 14 个主题） */
const THEME_MECHANIC = {
  guide: 'predict',
  basics: 'predict',
  pivot: 'pivot',
  signal: 'signal',
  beichi: 'beichi',
  multi: 'pivot',
  zhongyin: 'predict',
  macro: 'predict',
  money: 'predict',
  daily: 'signal',
  mind: 'predict',
  art: 'predict',
  misc: 'signal',
  early: 'predict'
};

const hash = (s) => crypto.createHash('sha1').update(s + SECRET).digest('hex');
const pick = (arr, seed) => arr[parseInt(seed.slice(0, 8), 16) % arr.length];

function rankOf(no) {
  return RANKS.find((r) => no >= r.range[0] && no <= r.range[1]) || RANKS[0];
}

/**
 * 关卡地图：108 关，每关绑定一课（来自 chan-lessons 的课程索引）
 */
function buildMap(K) {
  const themes = (K.THEMES || []).slice(0, 14);
  const lessons = (K.LESSONS || []).slice(0, 108);
  const byTheme = new Map(themes.map((t) => [t.id, { idx: themes.indexOf(t) + 1, id: t.id, name: t.name, desc: t.desc, mechanic: THEME_MECHANIC[t.id] || 'predict', levels: [] }]));
  const chapters = [...byTheme.values()];
  for (let no = 1; no <= 108; no++) {
    const lesson = lessons[no - 1] || {};
    const ch = byTheme.get(lesson.theme) || chapters[0];
    ch.levels.push({
      no,
      rank: rankOf(no).key,
      mechanic: ch.mechanic,
      title: lesson.title || `${ch.name} · 第 ${no} 关`,
      theme: ch.id,
      themeName: ch.name,
      gist: lesson.gist || '',
      confirmed: !!lesson.confirmed
    });
  }
  return { chapters, ranks: RANKS, total: 108, hiddenBars: HIDDEN };
}

function levelPlan(no) {
  const seed = hash('level:' + no);
  const markets = ['A', 'A', 'HK', 'US', 'CR'];
  const market = markets[parseInt(seed.slice(0, 2), 16) % markets.length];
  const code = pick(POOL[market], seed.slice(2));
  // 难度越高：截断点越靠前（留更长的历史）、隐藏段越长
  const rank = rankOf(no).key;
  const hidden = rank === 'king' ? 20 : rank === 'gold' ? 16 : rank === 'silver' ? 14 : 12;
  return { seed, market, code, hidden, rank };
}

async function fetchBars(market, code) {
  const kl = await S.klines({ market, code, period: 'day', limit: 320 });
  if (!kl || !kl.bars || kl.bars.length < 120) throw new Error('行情样本不足，暂时开不了这一关');
  return kl;
}

/** 从 K 线里算这一关的"正确答案"（服务端专用） */
function computeAnswer(plan, bars) {
  const cutoff = bars.length - plan.hidden; // 隐藏起点
  const a = C.analyze(bars.slice(0, cutoff), { period: 'day', market: plan.market, code: plan.code });
  const future = bars.slice(cutoff, cutoff + plan.hidden);
  const firstClose = bars[cutoff - 1].c;
  const lastClose = future[future.length - 1].c;
  const ret = (lastClose - firstClose) / firstClose;
  const hi = Math.max(...future.map((b) => b.h));
  const lo = Math.min(...future.map((b) => b.l));
  const amp = (hi - lo) / firstClose;
  const dir = ret > 0.015 ? 'up' : ret < -0.015 ? 'down' : 'flat';
  // 截断处最近的结构信号（用于讲解 + 加分）
  const lastSignal = (a.signals || []).slice(-1)[0] || null;
  const lastPivot = (a.pivots || []).filter((p) => p.i1 <= cutoff - 1).slice(-1)[0] || null;
  const lastBi = (a.bis || []).slice(-1)[0] || null;
  return { cutoff, future, ret, amp, dir, hi, lo, analysis: a, lastSignal, lastPivot, lastBi, firstClose, lastClose };
}

function tokenFor(no, market, code, cutoff) {
  return crypto.createHmac('sha256', SECRET).update(`${no}|${market}|${code}|${cutoff}`).digest('hex').slice(0, 24);
}

/**
 * 出一关：只返回截断前可见的数据 + 题目 + token
 */
async function makeLevel(K, no) {
  if (!(no >= 1 && no <= 108)) throw new Error('关卡号需在 1–108 之间');
  const plan = levelPlan(no);
  const kl = await fetchBars(plan.market, plan.code);
  const bars = kl.bars;
  const ans = computeAnswer(plan, bars);
  const visible = bars.slice(0, ans.cutoff);
  const map = buildMap(K);
  const level = map.chapters.flatMap((c) => c.levels).find((l) => l.no === no) || {};

  const base = {
    ok: true,
    no,
    rank: plan.rank,
    rankName: rankOf(no).name,
    mechanic: level.mechanic,
    theme: level.theme,
    title: level.title,
    gist: level.gist,
    market: plan.market,
    code: plan.code,
    name: kl.name || '',
    period: 'day',
    source: kl.source,
    visibleBars: visible,
    hidden: plan.hidden,
    token: tokenFor(no, plan.market, plan.code, ans.cutoff),
    cutoff: ans.cutoff
  };

  if (level.mechanic === 'predict') {
    base.question = {
      type: 'predict',
      text: `接下来 ${plan.hidden} 根日线（已隐藏），你判断怎么走？`,
      options: [
        { k: 'up', label: '看涨 ↑', desc: '向上突破 / 延续上涨' },
        { k: 'down', label: '看跌 ↓', desc: '向下破位 / 转跌' },
        { k: 'flat', label: '震荡 →', desc: '区间内震荡，方向不明' }
      ]
    };
  } else if (level.mechanic === 'signal') {
    base.question = { type: 'signal', text: '在这张图上点出你觉得的「买卖点」所在 K 线（点最近的一根）' };
  } else if (level.mechanic === 'pivot') {
    base.question = { type: 'pivot', text: '拖一个框，把这段走势里的「中枢」框出来' };
  } else {
    base.question = {
      type: 'beichi',
      text: '这段走势的最后一段，出现了背驰吗？',
      options: [
        { k: 'yes', label: '有背驰', desc: '力度衰减，趋势可能结束' },
        { k: 'no', label: '没有背驰', desc: '力度延续，趋势未完' }
      ]
    };
  }
  return base;
}

/** 判分：答案由服务端重算，客户端只提交选择/点击位置 */
async function gradeLevel(K, { no, token, answer }) {
  const plan = levelPlan(Number(no));
  const kl = await fetchBars(plan.market, plan.code);
  const ans = computeAnswer(plan, kl.bars);
  const expect = tokenFor(Number(no), plan.market, plan.code, ans.cutoff);
  if (!token || token !== expect) throw new Error('这道题的数据已过期（行情刷新了），重新开一关吧');
  const map = buildMap(K);
  const level = map.chapters.flatMap((c) => c.levels).find((l) => l.no === Number(no)) || {};
  const revealed = kl.bars;
  let score = 0;
  let verdict = '';
  const explain = [];

  const sd = (ans.lastSignal && ans.lastSignal.name) || '暂无买卖点';
  const pv = ans.lastPivot ? `中枢 ${ans.lastPivot.zd.toFixed(2)}~${ans.lastPivot.zg.toFixed(2)}` : '尚无中枢形成';

  if (level.mechanic === 'predict') {
    const correct = answer === ans.dir;
    const agree = ans.lastSignal && ((ans.dir === 'up' && /B$/.test(ans.lastSignal.type)) || (ans.dir === 'down' && /S$/.test(ans.lastSignal.type)));
    if (correct) {
      score = 62 + Math.min(30, Math.round((Math.abs(ans.ret) / 0.06) * 30));
      if (agree) score = Math.min(100, score + 8); // 与结构信号一致，额外加分
      verdict = agree ? '方向对，而且还和缠论信号同向' : '方向判断正确';
    } else if (answer === 'flat' || ans.dir === 'flat') {
      score = 40; // 方向与震荡互判，算半对
      verdict = '方向把握偏了（震荡与趋势混淆）';
    } else {
      score = 8;
      verdict = '方向判断反了';
    }
    explain.push(`实际走势：${(ans.ret * 100).toFixed(2)}%（振幅 ${(ans.amp * 100).toFixed(1)}%），你判断为「${answer}」，正确答案是「${ans.dir}」。`);
    explain.push(`截断时的结构：${sd}；${pv}。`);
    if (ans.lastBi) explain.push(`最后一笔：${ans.lastBi.dir > 0 ? '向上' : '向下'}（${ans.lastBi.p0.toFixed(2)} → ${ans.lastBi.p1.toFixed(2)}）。`);
  } else if (level.mechanic === 'signal') {
    const target = ans.lastSignal;
    if (!target) {
      score = answer && answer.idx != null ? 40 : 0;
      verdict = '隐藏段里其实没有标准买卖点';
      explain.push('这段走势没有形成规范的 1/2/3 类买卖点，游戏不计较你点哪儿，记住"没有信号也是一种信号"。');
    } else {
      const d = Math.abs(Number(answer && answer.idx) - target.barIdx);
      score = d <= 1 ? 100 : Math.max(0, Math.round(96 - d * 6));
      verdict = d <= 1 ? '正中买卖点！' : d <= 4 ? '离得很近' : d <= 10 ? '有点偏' : '偏得比较远';
      explain.push(`标准答案是「${target.name}」在第 ${target.barIdx} 根（价格 ${target.price.toFixed(2)}），你点在第 ${answer && answer.idx} 根，差 ${d} 根。`);
      explain.push('提示：买卖点一定贴着笔的端点，而且三类买卖点各有前置条件（中枢位置）。');
    }
  } else if (level.mechanic === 'pivot') {
    const target = ans.lastPivot;
    if (!target) {
      score = 40;
      verdict = '这段走势还没形成中枢';
      explain.push('中枢需要至少三段次级别走势重叠，样本不足时不该硬框。');
    } else {
      const box = answer && answer.box;
      if (!box) {
        score = 0;
        verdict = '没有框';
      } else {
        const i0 = Math.min(box.x1, box.x2), i1 = Math.max(box.x1, box.x2);
        const lo = Math.min(box.y1, box.y2), hi = Math.max(box.y1, box.y2);
        const interI = Math.max(0, Math.min(i1, target.i1) - Math.max(i0, target.i0));
        const interP = Math.max(0, Math.min(hi, target.zg) - Math.max(lo, target.zd));
        const inter = interI * interP;
        const union = (i1 - i0) * (hi - lo) + (target.i1 - target.i0) * (target.zg - target.zd) - inter;
        const iou = union > 0 ? inter / union : 0;
        score = Math.round(Math.pow(iou, 0.55) * 100);
        verdict = iou > 0.6 ? '框得很准' : iou > 0.3 ? '大致框住了' : '没框到中枢';
        explain.push(`标准中枢：第 ${target.i0}~${target.i1} 根，价格 ${target.zd.toFixed(2)}~${target.zg.toFixed(2)}（${target.count} 笔）。你的框重叠度 IoU ${(iou * 100).toFixed(0)}%。`);
      }
    }
  } else {
    // beichi：以最后一笔与前一同向笔的 MACD 面积比判断
    const bis = ans.analysis.bis || [];
    const last = bis[bis.length - 1];
    const prevSame = bis.slice(0, -1).reverse().find((b) => b.dir === (last && last.dir));
    let isBeichi = false;
    if (last && prevSame) {
      const area = (b) => Math.abs((b.p1 - b.p0) * (b.i1 - b.i0));
      isBeichi = area(last) < area(prevSame) * 0.8 && Math.abs(last.p1 - last.p0) < Math.abs(prevSame.p1 - prevSame.p0) * 0.9;
    }
    const picked = answer === 'yes';
    score = picked === isBeichi ? 100 : 0;
    verdict = picked === isBeichi ? '判断正确' : '判断错了';
    explain.push(
      isBeichi
        ? '最后一笔的力度明显弱于前一同向笔（价格幅度与持续时间都缩小），符合背驰的直观特征。'
        : '最后一笔的力度没有明显衰减，按简化判据不算背驰（注意：严格背驰要比同级别两段，这里用的是简化判据）。'
    );
    if (prevSame && last) explain.push(`最后一笔：${last.p0.toFixed(2)} → ${last.p1.toFixed(2)}（${last.i1 - last.i0} 根）；前一同向笔：${prevSame.p0.toFixed(2)} → ${prevSame.p1.toFixed(2)}（${prevSame.i1 - prevSame.i0} 根）。`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const stars = score >= 90 ? 3 : score >= 70 ? 2 : score >= 45 ? 1 : 0;
  return {
    ok: true,
    no: Number(no),
    score,
    stars,
    verdict,
    explain,
    answer: {
      dir: ans.dir,
      ret: +(ans.ret * 100).toFixed(2),
      signal: ans.lastSignal ? { name: ans.lastSignal.name, barIdx: ans.lastSignal.barIdx, price: ans.lastSignal.price, type: ans.lastSignal.type } : null,
      pivot: ans.lastPivot ? { i0: ans.lastPivot.i0, i1: ans.lastPivot.i1, zd: ans.lastPivot.zd, zg: ans.lastPivot.zg } : null,
      cutoff: ans.cutoff
    },
    revealedBars: revealed.slice(Math.max(0, ans.cutoff - 60)),
    revealedFrom: Math.max(0, ans.cutoff - 60),
    gist: level.gist || '',
    note: '关卡由实时行情生成；同一关刷新行情后题目会变，这是有意的（练的是结构识别，不是背答案）。'
  };
}

module.exports = { buildMap, makeLevel, gradeLevel, levelPlan, RANKS, POOL };
