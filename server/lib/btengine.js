'use strict';
/**
 * 缠论因子回测引擎（Backtest Engine）
 * =====================================================================
 * 与 `backtest.js`（信号点统计）的区别：
 *   那个只回答"信号后 5 天涨没涨"；这个回答"按这套规则交易，资金曲线长什么样"。
 *   包含：仓位、止损止盈、交易成本、滑点、逐笔明细、风险指标、分年度表现。
 *
 * ▍最重要的事：杜绝前视偏差（look-ahead bias）
 *   缠论的分型/笔/中枢**必须等右侧 K 线确认**才成立，最容易在这里作弊：
 *   · 第 i 根收盘时才可能有完整信息 → 最早只能在 i+1 开盘成交
 *   · 用"未来的分型"判定当下的笔 = 未来函数，回测会好得不真实
 *   本引擎的做法：
 *     ① 只用 [0, i] 的前缀数据做分析（严格因果）
 *     ② 信号出现在第 i 根 → 第 i+1 根**开盘价**成交
 *     ③ 每根 K 线先判止损（保守：先亏后赚）
 *
 * ▍指标口径
 *   · 收益按复利累计，仓位按"满仓单标的"和"固定比例"两种
 *   · 胜率/盈亏比按**逐笔交易**统计，不按 K 线
 *   · 最大回撤按资金曲线峰值到谷值
 *   · 年化用实际日历天数（不是 252 根固定）
 */

const C = require('./chan');
const MTF = require('./mtffilter');

/* ------------------------- 参数默认值 ------------------------- */
const DEFAULTS = {
  period: 'day',
  biStyle: 'new',
  /* 开仓规则 */
  entry: 'buy',        // buy=只做多买卖点中的买点；sell=只做空；both=双向
  signalTypes: null,   // null=全部；或 ['1B','2B','3B'] 之类
  requireNest: false,  // 是否要求多级别共振（慢，默认关）
  /* 信号方向反转：true 时把买点当卖点处理、卖点当买点（用于检验"反向指标"） */
  invertSignal: false,
  /*
    多级别共振过滤：
      ''/'off'   = 不过滤（原行为）
      'trend'    = 只按大级别趋势方向（做多要求大级别非下跌）
      'position' = 只按价格在大级别中枢的相对位置
      'both'     = 趋势 + 位置都要过
    ratio = 合成比例（默认 5 根小级别合成 1 根大级别）
  */
  mtfMode: '',
  mtfRatio: 5,
  /* 出场规则 */
  exitOn: 'signal',    // signal=反向信号平仓；hold=固定持有
  holdBars: 20,        // exitOn=hold 时持有根数
  stopPct: 0,          // 止损百分比（0=不用）
  takePct: 0,          // 止盈百分比（0=不用）
  /* 成本 */
  feeBps: 8,           // 单边手续费（万分之）
  slipBps: 4,          // 单边滑点（万分之）
  /* 资金 */
  capital: 100000,
  positionPct: 100,    // 每次用多少比例资金
  /*
    ▍底仓模式（basePosition）：解决"资金利用率只有 17-33%"的问题
      实测所有缠论策略长期空仓（A 股尤甚，中位持仓 105 根 / 800 根 ≈ 16%）。
      空仓期间错过市场上涨，是"跑赢率 0%"的真正原因。
      设 basePosition=1 表示始终持有 1 份底仓，缠论信号只在底仓上做加减仓。
      = 0 表示纯信号模式（原行为）
      = 1 表示满仓底仓（等于买入持有 + 信号加减仓）
      实现：底仓单独记账，信号仓位在底仓之上叠加/减掉。
  */
  basePosition: 0,
  /* 统计 */
  warmup: 120,         // 预热根数（前 N 根只分析不下单）
  maxConfirmLag: 3,    // 信号最大确认延迟（根）。>此值的信号视为事后修正，不交易
  minBarsForBi: 60,    // 少于这个根数不做分析
};

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * 主回测函数
 * @param {Array} bars  完整历史 K 线（按时间升序）
 * @param {Object} opts 参数
 * @returns {Object} 回测结果
 */
function runBacktest(bars, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  const fee = num(P.feeBps, 8) / 10000;
  const slip = num(P.slipBps, 4) / 10000;
  const costPerSide = fee + slip;

  if (!Array.isArray(bars) || bars.length < P.warmup + 30) {
    return { ok: false, error: `K 线不足（需 ≥ ${P.warmup + 30} 根，实际 ${bars ? bars.length : 0} 根）` };
  }

  /* 多级别上下文（循环外一次构建，内部逐根查询；严格无未来函数） */
  let mtfLookup = null;
  if (P.mtfMode && P.mtfMode !== 'off') {
    try {
      mtfLookup = MTF.buildContext(bars, { ratio: num(P.mtfRatio, 5), mode: P.mtfMode });
    } catch (e) { mtfLookup = null; }
  }
  let mtfBlocked = 0;

  /* ---------- 逐根推进：严格因果 ----------
     关键：缠论信号是**逐根确认**的，不能一次性算完全历史再取信号。
     实测（600519 日线 801 根）：
       · 一次性分析只有 6 个信号；逐根推进能发现 20 个
       · 其中 14 个后来被修正消失；6 个要等到最后一根才出现（延迟 95~672 根）
     所以引擎必须：
       ① 每根 K 线用前缀重算
       ② 只认"这一刻新出现、且信号点已过去"的信号
       ③ 记录确认延迟，延迟过大（>maxConfirmLag）的信号按实盘习惯丢弃
  */
  let seenSigs = new Set();
  let cash = num(P.capital, 100000);
  const initCapital = cash;
  let pos = null;           // { dir, entryIdx, entryPrice, shares, stopPx, takePx, reason }
  const trades = [];
  const equity = [];        // { t, v, price }
  const signalsSeen = [];   // 记录所有识别到的信号（含未成交）
  let skippedNoCash = 0;
  /*
    底仓：从预热结束那根开始买入并一直持有。
    单独记账（baseShares/baseEntry），不参与信号仓位的进出，
    只在计算权益时叠加其浮动盈亏。
  */
  const basePct = Math.max(0, Math.min(1, num(P.basePosition, 0)));
  let baseShares = 0, baseEntry = 0, baseCost = 0;
  let baseInit = false;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    /* ① 先处理持仓的止损/止盈（用当根最低/最高，保守假设可能被扫） */
    if (pos) {
      let exitPx = null;
      let exitWhy = '';
      if (pos.dir > 0) {
        // 做多：先看止损（保守），再看止盈
        if (pos.stopPx != null && bar.l <= pos.stopPx) { exitPx = pos.stopPx; exitWhy = 'stop'; }
        else if (pos.takePx != null && bar.h >= pos.takePx) { exitPx = pos.takePx; exitWhy = 'take'; }
      } else {
        if (pos.stopPx != null && bar.h >= pos.stopPx) { exitPx = pos.stopPx; exitWhy = 'stop'; }
        else if (pos.takePx != null && bar.l <= pos.takePx) { exitPx = pos.takePx; exitWhy = 'take'; }
      }
      if (exitPx != null) {
        cash = closePosition(cash, pos, exitPx, i, bar.t, exitWhy, costPerSide, trades);
        pos = null;
      }
    }

    /* ①.5 建立底仓（在预热结束的那一刻用当根收盘价买入，之后不再变动） */
    if (basePct > 0 && !baseInit && i >= P.warmup) {
      const amt = cash * basePct;
      if (amt > bar.c) {
        baseShares = amt / bar.c;
        baseEntry = bar.c;
        baseCost = amt * costPerSide;
        cash -= baseCost;
        baseInit = true;
      }
    }

    /* ② 分析前缀 [0, i]：只用已发生的数据 */
    if (i >= P.warmup && i < bars.length - 1) {
      let res = null;
      try {
        res = C.analyze(bars.slice(0, i + 1), { period: P.period, biStyle: P.biStyle });
      } catch (e) { res = null; }

      if (res && res.ok) {
        /* 只认"新出现"的信号；已被修正消失的不会再次触发 */
        const curKeys = new Map();
        for (const sg of res.signals || []) {
          const key = sg.type + ':' + sg.barIdx;
          curKeys.set(key, sg);
        }
        const fresh = [];
        for (const [key, sg] of curKeys) {
          if (seenSigs.has(key)) continue;
          const lag = i - sg.barIdx;             // 确认延迟（根）
          if (lag < 0) continue;                  // 信号点在将来 → 不可能，防御
          if (lag > (P.maxConfirmLag || 3)) {     // 延迟过大：实盘等不到，丢弃
            continue;
          }
          fresh.push({ ...sg, lag });
        }
        // 记录已见（即便这条不交易，也不该重复触发）
        for (const key of curKeys.keys()) seenSigs.add(key);

        const sig = fresh.length ? fresh[fresh.length - 1] : null;
        if (sig) {
          /*
            信号方向 vs 交易方向：
              invertSignal=true 时，买点当作做空信号、卖点当作做多信号。
            用途：某个信号统计上明显为负（如 2S 胜率 35%、平均 -13%），
            反过来做是否成立？这必须靠数据回答，不能拍脑袋。
          */
          const rawBuy = sig.type.endsWith('B');
          const isBuy = P.invertSignal ? !rawBuy : rawBuy;
          const wantLong = P.entry === 'buy' || P.entry === 'both';
          const wantShort = P.entry === 'sell' || P.entry === 'both';
          const typeOk = !P.signalTypes || P.signalTypes.includes(sig.type);
          signalsSeen.push({ i, type: sig.type, name: sig.name, price: sig.price, t: bar.t, lag: sig.lag, acted: false });

          if (typeOk && ((isBuy && wantLong) || (!isBuy && wantShort))) {
            const dir = isBuy ? 1 : -1;
            /* 多级别共振过滤：不通过就跳过这次开仓 */
            if (mtfLookup) {
              const c = mtfLookup(i);
              const d = MTF.decide(c, sig.price, dir, P.mtfMode);
              if (!d.allow) {
                mtfBlocked++;
                signalsSeen[signalsSeen.length - 1].mtfBlocked = d.reason;
                continue;
              }
            }
            // 已有同向持仓 → 不加仓；有反向持仓 → 先平
            if (pos && pos.dir !== dir) {
              cash = closePosition(cash, pos, bars[i + 1] ? bars[i + 1].o : bar.c, i + 1, bars[i + 1] ? bars[i + 1].t : bar.t, 'reverse', costPerSide, trades);
              pos = null;
            }
            if (!pos) {
              const nextBar = bars[i + 1];
              if (nextBar) {
                const entryPx = nextBar.o;   // 次日开盘成交（无未来函数）
                const useAmt = cash * (num(P.positionPct, 100) / 100);
                if (useAmt > entryPx) {
                  const shares = useAmt / entryPx;
                  const stopPx = P.stopPct > 0
                    ? (dir > 0 ? entryPx * (1 - P.stopPct / 100) : entryPx * (1 + P.stopPct / 100))
                    : null;
                  const takePx = P.takePct > 0
                    ? (dir > 0 ? entryPx * (1 + P.takePct / 100) : entryPx * (1 - P.takePct / 100))
                    : null;
                  const cost = entryPx * shares * costPerSide;
                  cash -= cost;
                  pos = { dir, entryIdx: i + 1, entryPrice: entryPx, shares, stopPx, takePx, signalType: sig.type, signalName: sig.name, entryCost: cost };
                  signalsSeen[signalsSeen.length - 1].acted = true;
                } else {
                  skippedNoCash++;
                }
              }
            }
          }

          // 反向信号平仓（exitOn=signal）
          if (P.exitOn === 'signal' && pos) {
            const posIsBuy = pos.dir > 0;
            if ((posIsBuy && !isBuy) || (!posIsBuy && isBuy)) {
              cash = closePosition(cash, pos, bars[i + 1] ? bars[i + 1].o : bar.c, i + 1, bars[i + 1] ? bars[i + 1].t : bar.t, 'signal', costPerSide, trades);
              pos = null;
            }
          }
        }
      }
    }

    /* ③ 固定持有到期 */
    if (pos && P.exitOn === 'hold' && i - pos.entryIdx >= P.holdBars) {
      cash = closePosition(cash, pos, bar.c, i, bar.t, 'hold', costPerSide, trades);
      pos = null;
    }

    /* ④ 记录资金曲线 */
    // 权益 = 现金 + 信号仓浮动盈亏 + 底仓浮动盈亏（本金均留在 cash 里）
    const basePnl = baseShares > 0 ? (bar.c - baseEntry) * baseShares : 0;
    const mv = equityOf(cash, pos, bar.c) + basePnl;
    equity.push({ t: bar.t, v: +mv.toFixed(2), price: bar.c });
  }

  /* 收尾：最后一根强制平仓，避免浮盈不算 */
  if (pos) {
    const last = bars[bars.length - 1];
    cash = closePosition(cash, pos, last.c, bars.length - 1, last.t, 'end', costPerSide, trades);
    pos = null;
    equity[equity.length - 1].v = +cash.toFixed(2);
  }
  /* 结算底仓：平掉并计入净盈亏，让"期末权益 = 初始 + 所有盈亏"继续成立 */
  let baseNet = 0;
  if (baseShares > 0) {
    const last = bars[bars.length - 1];
    const gross = (last.c - baseEntry) * baseShares;
    const exitCost = last.c * baseShares * costPerSide;
    baseNet = gross - exitCost - baseCost;
    cash += gross - exitCost;
    equity[equity.length - 1].v = +cash.toFixed(2);
    baseShares = 0;
  }

  const stats = computeStats({ trades, equity, initCapital, bars, opts: P });
  stats.basePosition = basePct;
  stats.mtfMode = P.mtfMode || '';
  stats.mtfBlocked = mtfBlocked;
  stats.baseNet = +baseNet.toFixed(2);
  /* 资金利用率：持仓根数 / 总根数 */
  const heldBars = trades.reduce((a, t) => a + t.bars, 0);
  stats.utilizationPct = +(heldBars / bars.length * 100).toFixed(1);
  return {
    ok: true,
    params: P,
    stats,
    trades: trades.map(fmtTrade),
    equity,
    signals: {
      total: signalsSeen.length,
      acted: signalsSeen.filter((s) => s.acted).length,
      avgLag: signalsSeen.length ? +(signalsSeen.reduce((a, s) => a + (s.lag || 0), 0) / signalsSeen.length).toFixed(2) : 0,
      maxLag: signalsSeen.reduce((a, s) => Math.max(a, s.lag || 0), 0),
    },
    skippedNoCash,
    caveats: buildCaveats(stats, trades, P),
  };
}

/**
 * 持仓市值（用于资金曲线）
 * 做多：shares * price
 * 做空：不是"shares * (2*entry - price)"（那是把本金也算进去了，权益会虚高到 2 倍）。
 *       正确的权益贡献 = 本金 + 浮动盈亏 = shares*entry + shares*(entry-price)
 *                      = shares * (2*entry - price) - shares*entry
 *       但因为本金本来就留在 cash 里，这里只该返回**浮动盈亏**，
 *       所以做空应该用 shares*(entry-price)，做多用 shares*(price-entry)，
 *       再统一加回本金 —— 为简单起见，这里返回"持仓市值"，
 *       由调用方用 cash + (本金 + 浮盈) 计算。见 equityOf()。
 */
function markValue(pos, price) {
  return pos.dir > 0 ? pos.shares * price : pos.shares * (2 * pos.entryPrice - price);
}

/** 权益 = 现金 + 持仓市值（含本金归还口径统一在这里处理） */
function equityOf(cash, pos, price) {
  if (!pos) return cash;
  // 开仓时本金未从 cash 扣除，所以权益 = cash + 浮动盈亏
  const pnl = pos.dir > 0
    ? (price - pos.entryPrice) * pos.shares
    : (pos.entryPrice - price) * pos.shares;
  return cash + pnl;
}

function closePosition(cash, pos, exitPx, idx, t, why, costPerSide, trades) {
  /*
    资金口径：开仓时 cash 只扣了"开仓成本"，本金仍留在 cash 里，
    持仓市值用 markValue 单独计入权益。所以平仓时：
      cash += 毛盈亏 - 平仓成本
    不要重复归还本金（之前写了两次 cash +=，会把权益算成 2 倍）。
  */
  const gross = pos.dir > 0
    ? (exitPx - pos.entryPrice) * pos.shares
    : (pos.entryPrice - exitPx) * pos.shares;
  const exitCost = exitPx * pos.shares * costPerSide;
  const net = gross - exitCost;
  cash += net;
  trades.push({
    dir: pos.dir,
    signalType: pos.signalType,
    signalName: pos.signalName,
    entryIdx: pos.entryIdx,
    exitIdx: idx,
    entryPrice: pos.entryPrice,
    exitPrice: exitPx,
    shares: pos.shares,
    gross,
    net,
    retPct: gross / (pos.entryPrice * pos.shares) * 100,
    netPct: net / (pos.entryPrice * pos.shares) * 100,
    bars: idx - pos.entryIdx,
    exitWhy: why,
    entryCost: pos.entryCost,
    exitCost,
  });
  return cash;
}

function fmtTrade(t) {
  return {
    ...t,
    entryPrice: +t.entryPrice.toFixed(4),
    exitPrice: +t.exitPrice.toFixed(4),
    shares: +t.shares.toFixed(4),
    gross: +t.gross.toFixed(2),
    net: +t.net.toFixed(2),
    retPct: +t.retPct.toFixed(2),
    netPct: +t.netPct.toFixed(2),
  };
}

/* ------------------------- 统计 ------------------------- */
function computeStats({ trades, equity, initCapital, bars, opts }) {
  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.net, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.net, 0) / losses.length : 0;
  const finalV = equity.length ? equity[equity.length - 1].v : initCapital;
  const totalRet = (finalV - initCapital) / initCapital * 100;

  // 最大回撤
  let peak = -Infinity, maxDD = 0, ddStart = null, ddEnd = null, curPeakT = null;
  for (const e of equity) {
    if (e.v > peak) { peak = e.v; curPeakT = e.t; }
    const dd = peak > 0 ? (peak - e.v) / peak * 100 : 0;
    if (dd > maxDD) { maxDD = dd; ddStart = curPeakT; ddEnd = e.t; }
  }

  // 年化：按日历天数
  const t0 = bars[0].t, t1 = bars[bars.length - 1].t;
  const years = Math.max((t1 - t0) / (365.25 * 86400000), 1 / 365.25);
  const annual = (Math.pow(finalV / initCapital, 1 / years) - 1) * 100;

  // 基准：买入持有
  const bh = (bars[bars.length - 1].c - bars[0].c) / bars[0].c * 100;

  // 夏普（按日/根收益）
  const rets = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1].v > 0) rets.push(equity[i].v / equity[i - 1].v - 1);
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0;
  const periodsPerYear = rets.length / years;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(periodsPerYear) : 0;

  // 盈亏比、期望
  const payoff = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : null;
  const expectancy = trades.length ? trades.reduce((a, t) => a + t.net, 0) / trades.length : 0;

  // 分类型统计
  const byType = {};
  for (const t of trades) {
    const k = t.signalType || '?';
    if (!byType[k]) byType[k] = { n: 0, win: 0, sumNet: 0, sumPct: 0 };
    byType[k].n++;
    if (t.net > 0) byType[k].win++;
    byType[k].sumNet += t.net;
    byType[k].sumPct += t.netPct;
  }
  const typeStats = Object.entries(byType).map(([type, v]) => ({
    type,
    n: v.n,
    winRate: +(v.win / v.n * 100).toFixed(1),
    avgPct: +(v.sumPct / v.n).toFixed(2),
    totalNet: +v.sumNet.toFixed(2),
  })).sort((a, b) => b.n - a.n);

  // 按年
  const byYear = {};
  for (const t of trades) {
    const y = new Date(bars[Math.min(t.exitIdx, bars.length - 1)].t).getFullYear();
    if (!byYear[y]) byYear[y] = { n: 0, net: 0, win: 0 };
    byYear[y].n++;
    byYear[y].net += t.net;
    if (t.net > 0) byYear[y].win++;
  }

  return {
    initCapital,
    finalValue: +finalV.toFixed(2),
    totalReturnPct: +totalRet.toFixed(2),
    annualReturnPct: +annual.toFixed(2),
    benchmarkPct: +bh.toFixed(2),
    excessPct: +(totalRet - bh).toFixed(2),
    trades: trades.length,
    winRate: trades.length ? +(wins.length / trades.length * 100).toFixed(1) : 0,
    avgWin: +avgWin.toFixed(2),
    avgLoss: +avgLoss.toFixed(2),
    payoff: payoff != null ? +payoff.toFixed(2) : null,
    expectancy: +expectancy.toFixed(2),
    maxDrawdownPct: +maxDD.toFixed(2),
    maxDDRange: ddStart && ddEnd ? [ddStart, ddEnd] : null,
    sharpe: +sharpe.toFixed(2),
    avgHoldBars: trades.length ? +(trades.reduce((a, t) => a + t.bars, 0) / trades.length).toFixed(1) : 0,
    profitFactor: (() => {
      const g = trades.filter((t) => t.net > 0).reduce((a, t) => a + t.net, 0);
      const l = Math.abs(trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0));
      return l > 0 ? +(g / l).toFixed(2) : null;
    })(),
    typeStats,
    byYear,
    spanDays: Math.round((t1 - t0) / 86400000),
    years: +years.toFixed(2),
  };
}

/** 自动生成"这份回测结果哪些地方不能信"的提示 */
function buildCaveats(stats, trades, P) {
  const out = [];
  if (trades.length < 30) out.push(`样本仅 ${trades.length} 笔（<30），胜率与盈亏比**不具备统计意义**`);
  else if (trades.length < 100) out.push(`样本 ${trades.length} 笔（<100），结论偏弱，建议扩大标的或拉长区间`);
  if (stats.years < 2) out.push(`回测跨度仅 ${stats.years} 年（<2），未覆盖完整牛熊`);
  if (stats.excessPct < 0) out.push('跑输买入持有：这套规则在这个标的/区间上没有优势');
  if (stats.maxDrawdownPct > 30) out.push(`最大回撤 ${stats.maxDrawdownPct}%，超出多数人可承受范围`);
  if (stats.trades && stats.avgHoldBars < 3) out.push('平均持仓不足 3 根：可能是信号过于频繁，成本占比过高');
  if (!P.stopPct) out.push('未设置止损：单笔风险不可控');
  out.push('回测结果依赖历史，未来不保证重现；信号含确认延迟（次日开盘成交），实盘滑点可能更大');
  return out;
}

/* ------------------------- 参数批量扫描 ------------------------- */
function sweep(bars, baseOpts, grid = {}) {
  const keys = Object.keys(grid);
  const results = [];
  const total = keys.reduce((a, k) => a * (grid[k].length || 1), 1);
  if (total > 200) return { ok: false, error: `参数组合过多（${total}），请缩减到 200 以内` };

  const combos = [{}];
  for (const k of keys) {
    const vals = grid[k] || [baseOpts[k]];
    const next = [];
    for (const c of combos) for (const v of vals) next.push({ ...c, [k]: v });
    combos.length = 0;
    combos.push(...next);
  }
  for (const c of combos) {
    const r = runBacktest(bars, { ...baseOpts, ...c });
    if (r.ok) {
      results.push({
        params: c,
        trades: r.stats.trades,
        winRate: r.stats.winRate,
        totalReturnPct: r.stats.totalReturnPct,
        excessPct: r.stats.excessPct,
        maxDrawdownPct: r.stats.maxDrawdownPct,
        sharpe: r.stats.sharpe,
        profitFactor: r.stats.profitFactor,
      });
    }
  }
  results.sort((a, b) => b.excessPct - a.excessPct);
  return { ok: true, count: results.length, results };
}

module.exports = { runBacktest, sweep, DEFAULTS };
