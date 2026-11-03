/* 缠论因子回测页 */
(function () {
  'use strict';
  const { U, API, App } = window;
  let curveChart = null;
  let lastBatch = null;

  const P = () => ({
    symbols: (U.$('#btSymbols')?.value || '').trim(),
    markets: (U.$('#btMarkets')?.value || '').trim(),
    period: U.$('#btPeriod')?.value || 'day',
    entry: U.$('#btEntry')?.value || 'both',
    signalTypes: (U.$('#btSignals')?.value || '').trim(),
    biStyle: U.$('#btBiStyle')?.value || 'new',
    stopPct: Number(U.$('#btStop')?.value || 0),
    takePct: Number(U.$('#btTake')?.value || 0),
    feeBps: Number(U.$('#btFee')?.value || 8),
    slipBps: Number(U.$('#btSlip')?.value || 4),
    maxConfirmLag: Number(U.$('#btLag')?.value || 3),
  });

  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  function statRow(label, value, cls) {
    return `<div class="kv-row"><span>${label}</span><b class="${cls || ''}">${value}</b></div>`;
  }

  /* ---------------- 判定横幅 ---------------- */
  function renderVerdict(v) {
    const box = U.$('#btVerdict');
    if (!box) return;
    if (!v) { box.innerHTML = ''; return; }
    const lv = v.level || 'inconclusive';
    const map = { effective: ['up', '有效'], ineffective: ['down', '无效'], marginal: ['gold', '边缘'], insufficient: ['muted', '样本不足'] };
    const [cls, txt] = map[lv] || ['muted', '待定'];
    box.innerHTML = `<div class="bt-verdict ${cls}">
      <div class="btv-head"><b>因子判定：${txt}</b><span>${U.esc(v.text || '')}</span></div>
      <ul>${(v.reasons || []).map((r) => `<li>${U.esc(r)}</li>`).join('')}</ul>
    </div>`;
  }

  /* ---------------- 单标的 ---------------- */
  async function runSingle() {
    const p = P();
    const first = (p.symbols.split(',')[0] || 'A:600519').split(':');
    const market = (first[0] || 'A').toUpperCase();
    const code = first[1] || '600519';
    U.$('#btStats').innerHTML = '<div class="loading">回测中…</div>';
    try {
      const r = await API.get(`/api/bt/run?market=${market}&code=${encodeURIComponent(code)}&${qs(p)}`);
      if (!r.ok) { U.$('#btStats').innerHTML = `<div class="loading">${U.esc(r.error || '失败')}</div>`; return; }
      renderVerdict(null);
      renderStats(r);
      drawCurve(r.equity, r.stats.benchmarkPct);
      renderTrades(r.trades, r.signals);
      U.$('#btRows').innerHTML = '';
      U.$('#btTypes').innerHTML = typeTable(r.stats.typeStats);
      U.$('#btRowsHint').textContent = '单标的模式';
      U.$('#btTradesHint').textContent = `${r.trades.length} 笔 · 信号 ${r.signals.total} 个（成交 ${r.signals.acted}，平均确认延迟 ${r.signals.avgLag} 根）`;
    } catch (e) {
      U.$('#btStats').innerHTML = `<div class="loading">${U.esc(e.message)}</div>`;
    }
  }

  /* ---------------- 批量 ---------------- */
  async function runBatch() {
    const p = P();
    U.$('#btStats').innerHTML = '<div class="loading">批量回测中（多标的，可能需 1-2 分钟）…</div>';
    try {
      const q2 = { ...p };
      if (q2.symbols) delete q2.markets;   // 手填标的优先于市场池
      const r = await API.get(`/api/bt/batch?${qs(q2)}`);
      if (!r.ok) { U.$('#btStats').innerHTML = `<div class="loading">${U.esc(r.error || '失败')}</div>`; return; }
      lastBatch = r;
      renderVerdict(r.summary.verdict);
      const s = r.summary;
      U.$('#btStats').innerHTML = [
        statRow('标的数', `${s.symbols}（失败 ${s.failed}）`),
        statRow('总交易', `${s.totalTrades} 笔`),
        statRow('胜率', `${s.winRate}%`, s.winRate >= 50 ? 'up' : 'down'),
        statRow('平均单笔', `${s.avgNetPct}%`, s.avgNetPct > 0 ? 'up' : 'down'),
        statRow('中位单笔', `${s.medianNetPct}%`),
        statRow('盈利因子', s.profitFactor == null ? '—' : s.profitFactor),
        statRow('平均持仓', `${s.avgHoldBars} 根`),
      ...(s.utilizationPct != null ? [statRow('资金利用率', `${s.utilizationPct}%`, s.utilizationPct >= 60 ? 'up' : 'down')] : []),
      ...(s.basePosition != null ? [statRow('底仓比例', `${Math.round(s.basePosition * 100)}%`)] : []),
      ...(s.mtfMode ? [statRow('多级别过滤', `${s.mtfMode}（否决 ${s.mtfBlocked}）`)] : []),
        statRow('跑赢基准', `${s.beatBenchmark}/${s.symbols} = ${s.beatRate}%`, s.beatRate >= 50 ? 'up' : 'down'),
        statRow('中位超额', `${s.medianExcessPct}%`, s.medianExcessPct > 0 ? 'up' : 'down'),
        statRow('中位回撤', `${s.medianDrawdownPct}%`),
        statRow('最差回撤', `${s.worstDrawdownPct}%`),
      ].join('');
      U.$('#btTypes').innerHTML = typeTable(s.typeStats) + peerTable(s.peer);
      renderRows(r.rows);
      renderTrades(r.trades, null);
      drawCurve(null);
      U.$('#btCurveHint').textContent = '批量模式不画资金曲线（各标的资金独立）';
      U.$('#btRowsHint').textContent = `${s.symbols} 个标的`;
      U.$('#btTradesHint').textContent = `${r.trades.length} 笔（跨标的合并）`;
    } catch (e) {
      U.$('#btStats').innerHTML = `<div class="loading">${U.esc(e.message)}</div>`;
    }
  }

  /* ---------------- 参数扫描 ---------------- */
  async function runSweep() {
    const p = P();
    U.$('#btStats').innerHTML = '<div class="loading">参数扫描中（可能需 2-4 分钟）…</div>';
    try {
      const r = await API.get(`/api/bt/sweep?${qs(p)}`);
      if (!r.ok) { U.$('#btStats').innerHTML = `<div class="loading">${U.esc(r.error || '失败')}</div>`; return; }
      renderVerdict(null);
      U.$('#btStats').innerHTML = statRow('扫描组合', `${r.rows.length} 组 / ${r.symbols} 标的`);
      // 稳健候选：验证期表现最好的那组（常与训练期第 1 名不同）
      if (r.robustPick && r.robustPick !== r.best) {
        const q = r.robustPick.params;
        U.$('#btTypes').innerHTML = `<div class="bt-verdict up"><div class="btv-head"><b>稳健候选</b><span>${U.esc((q.signalTypes || ['全部']).join('+'))} 止损${q.stopPct}% 止盈${q.takePct}%</span></div>
          <ul><li>训练期 ${r.robustPick.inSample.avgPct}%（${r.robustPick.inSample.trades} 笔）→ 验证期 <b>${r.robustPick.outSample.avgPct}%</b>（${r.robustPick.outSample.trades} 笔）</li>
          <li>这组在训练期不是第 1 名，但验证期最稳 —— 少加参数比调参更可靠</li></ul></div>`;
      } else {
        U.$('#btTypes').innerHTML = '';
      }
      U.$('#btRows').innerHTML = `<table class="bt-tbl"><thead><tr><th>#</th><th>信号</th><th>止损</th><th>止盈</th><th>笔数</th><th>胜率</th><th>平均</th><th>跑赢</th></tr></thead><tbody>${
        r.rows.map((x, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${i + 1}</td><td>${U.esc(x.signals)}</td><td>${x.stopPct}%</td><td>${x.takePct}%</td><td>${x.trades}</td><td>${x.winRate}%</td><td class="${x.avgNetPct > 0 ? 'up' : 'down'}">${x.avgNetPct}%</td><td>${x.beat}/${r.symbols}</td></tr>`).join('')
      }</tbody></table>`;
      U.$('#btRowsHint').textContent = '按平均单笔收益排序';
      U.$('#btTrades').innerHTML = '';
      drawCurve(null);
      U.$('#btCurveHint').textContent = '扫描模式不画资金曲线';
    } catch (e) {
      U.$('#btStats').innerHTML = `<div class="loading">${U.esc(e.message)}</div>`;
    }
  }

  /* ---------------- 样本外验证 ---------------- */
  async function runOos() {
    const p = P();
    U.$('#btStats').innerHTML = '<div class="loading">样本外验证中（训练期扫参数 + 验证期检验，约需 5-10 分钟）…</div>';
    U.$('#btVerdict').innerHTML = '<div class="bt-verdict gold"><div class="btv-head"><b>样本外验证</b><span>正在切分训练/验证期并扫描参数…</span></div></div>';
    try {
      const q2 = { ...p };
      if (q2.symbols) delete q2.markets;
      const r = await API.get(`/api/bt/oos?${qs(q2)}`);
      if (!r.ok) { U.$('#btStats').innerHTML = `<div class="loading">${U.esc(r.error || '失败')}</div>`; renderVerdict(null); return; }
      const map = { robust: ['up', '样本外有效'], partial: ['gold', '信号有效·参数不重要'], decayed: ['gold', '衰减明显'], overfit: ['down', '过拟合'], insufficient: ['muted', '样本不足'] };
      const [cls, txt] = map[r.verdict.level] || ['muted', '待定'];
      U.$('#btVerdict').innerHTML = `<div class="bt-verdict ${cls}">
        <div class="btv-head"><b>样本外验证：${txt}</b><span>${U.esc(r.verdict.text || '')}</span></div>
        <ul>${(r.verdict.reasons || []).map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul>
      </div>`;
      const fd = (t) => new Date(t).toISOString().slice(0, 10);
      U.$('#btStats').innerHTML = [
        statRow('标的数', r.symbols),
        statRow('参数组合', r.combos),
        statRow('训练/验证', `${Math.round(r.ratio * 100)}% / ${Math.round((1 - r.ratio) * 100)}%`),
        statRow('训练期', `${fd(r.inRange[0])} ~ ${fd(r.inRange[1])}`),
        statRow('验证期', `${fd(r.outRange[0])} ~ ${fd(r.outRange[1])}`),
        statRow('最优参数交易(训练)', `${r.best.inSample.trades} 笔`),
        statRow('最优参数交易(验证)', `${r.best.outSample.trades} 笔`),
        statRow('训练期平均', `${r.best.inSample.avgPct}%`),
        statRow('验证期平均', `${r.best.outSample.avgPct}%`, r.best.outSample.avgPct > 0 ? 'up' : 'down'),
        statRow('衰减', r.best.decayPct == null ? '—' : `${r.best.decayPct}%`, (r.best.decayPct || 0) > -50 ? 'up' : 'down'),
      ].join('');
      // 稳健候选：验证期表现最好的那组（常与训练期第 1 名不同）
      if (r.robustPick && r.robustPick !== r.best) {
        const q = r.robustPick.params;
        U.$('#btTypes').innerHTML = `<div class="bt-verdict up"><div class="btv-head"><b>稳健候选</b><span>${U.esc((q.signalTypes || ['全部']).join('+'))} 止损${q.stopPct}% 止盈${q.takePct}%</span></div>
          <ul><li>训练期 ${r.robustPick.inSample.avgPct}%（${r.robustPick.inSample.trades} 笔）→ 验证期 <b>${r.robustPick.outSample.avgPct}%</b>（${r.robustPick.outSample.trades} 笔）</li>
          <li>这组在训练期不是第 1 名，但验证期最稳 —— 少加参数比调参更可靠</li></ul></div>`;
      } else {
        U.$('#btTypes').innerHTML = '';
      }
      U.$('#btRows').innerHTML = `<table class="bt-tbl"><thead><tr><th>#</th><th>信号</th><th>止损</th><th>止盈</th><th>训练期</th><th>验证期</th><th>衰减</th></tr></thead><tbody>${
        r.tested.map((t, i) => {
          const q = t.params;
          return `<tr class="${i === 0 ? 'best' : ''}"><td>${i + 1}</td><td>${(q.signalTypes || ['全部']).join('+')}</td><td>${q.stopPct}%</td><td>${q.takePct}%</td>
            <td>${t.inSample.avgPct}% <span class="sq2">(${t.inSample.trades}笔)</span></td>
            <td class="${t.outSample.avgPct > 0 ? 'up' : 'down'}">${t.outSample.avgPct}% <span class="sq2">(${t.outSample.trades}笔)</span></td>
            <td class="${(t.decayPct || 0) > -50 ? 'up' : 'down'}">${t.decayPct}%</td></tr>`;
        }).join('')
      }</tbody></table>`;
      U.$('#btRowsHint').textContent = '训练期 vs 验证期对比';
      U.$('#btTrades').innerHTML = '';
      drawCurve(null);
      U.$('#btCurveHint').textContent = '样本外模式不画资金曲线';
    } catch (e) {
      U.$('#btStats').innerHTML = `<div class="loading">${U.esc(e.message)}</div>`;
      renderVerdict(null);
    }
  }

  /* ---------------- 滚动 walk-forward ---------------- */
  async function runRolling() {
    const p = P();
    U.$('#btStats').innerHTML = '<div class="loading">滚动验证中（多折训练+验证，约 2-5 分钟）…</div>';
    U.$('#btVerdict').innerHTML = '<div class="bt-verdict gold"><div class="btv-head"><b>滚动验证</b><span>把历史切成多折，每折单独调参再验证</span></div></div>';
    try {
      const q2 = { ...p, folds: 3, maxSymbols: 40 };
      if (q2.symbols) delete q2.markets;
      const r = await API.get(`/api/bt/rolling?${qs(q2)}`);
      if (!r.ok) { U.$('#btStats').innerHTML = `<div class="loading">${U.esc(r.error || '失败')}</div>`; return; }
      const map = { robust: ['up', '多折一致为正'], mixed: ['gold', '部分折为正'], unstable: ['down', '多数折为负'], insufficient: ['muted', '样本不足'] };
      const [cls, txt] = map[r.verdict.level] || ['muted', '待定'];
      U.$('#btVerdict').innerHTML = `<div class="bt-verdict ${cls}">
        <div class="btv-head"><b>滚动验证：${txt}</b><span>${U.esc(r.verdict.text || '')}</span></div>
        <ul>${(r.verdict.reasons || []).map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul>
      </div>`;
      U.$('#btStats').innerHTML = [
        statRow('标的数', r.fetched),
        statRow('折数', r.folds),
        statRow('验证期总交易', `${r.totalTrades} 笔`),
        statRow('为正的折', `${r.verdict.positives}/${r.verdict.total}`, r.verdict.positives / r.verdict.total >= 0.8 ? 'up' : 'down'),
        statRow('验证均值', `${r.verdict.avgOos}%`, r.verdict.avgOos > 0 ? 'up' : 'down'),
        statRow('最好一折', `${r.verdict.best}%`),
        statRow('最差一折', `${r.verdict.worst}%`, 'down'),
      ].join('');
      U.$('#btTypes').innerHTML = '';
      U.$('#btRows').innerHTML = `<table class="bt-tbl"><thead><tr><th>折</th><th>选中参数</th><th>训练期</th><th>验证期</th><th>验证笔数</th><th>验证胜率</th></tr></thead><tbody>${
        r.folds_detail.map((f) => {
          const q = f.params;
          return `<tr><td>${f.fold}</td><td>${(q.signalTypes || ['全部']).join('+')} 止损${q.stopPct}% 止盈${q.takePct}%</td>
            <td>${f.inAvg}%</td><td class="${f.oosAvg > 0 ? 'up' : 'down'}">${f.oosAvg}%</td>
            <td>${f.oosTrades}</td><td>${f.oosWin}%</td></tr>`;
        }).join('')
      }</tbody></table>`;
      U.$('#btRowsHint').textContent = '各折独立调参后验证';
      U.$('#btTrades').innerHTML = '';
      drawCurve(null);
      U.$('#btCurveHint').textContent = '滚动模式不画资金曲线';
    } catch (e) {
      U.$('#btStats').innerHTML = `<div class="loading">${U.esc(e.message)}</div>`;
    }
  }

  /* ---------------- 渲染子块 ---------------- */
  function renderStats(r) {
    const s = r.stats;
    U.$('#btStats').innerHTML = [
      statRow('标的', `${r.market}:${r.code} · ${r.period}`),
      statRow('区间', `${s.years} 年（${s.spanDays} 天）`),
      statRow('交易', `${s.trades} 笔`),
      statRow('胜率', `${s.winRate}%`, s.winRate >= 50 ? 'up' : 'down'),
      statRow('总收益', `${s.totalReturnPct}%`, s.totalReturnPct > 0 ? 'up' : 'down'),
      statRow('基准(买入持有)', `${s.benchmarkPct}%`),
      statRow('超额', `${s.excessPct}%`, s.excessPct > 0 ? 'up' : 'down'),
      statRow('年化', `${s.annualReturnPct}%`),
      statRow('最大回撤', `${s.maxDrawdownPct}%`, 'down'),
      statRow('夏普', s.sharpe),
      statRow('盈亏比', s.payoff == null ? '—' : s.payoff),
      statRow('盈利因子', s.profitFactor == null ? '—' : s.profitFactor),
      statRow('平均持仓', `${s.avgHoldBars} 根`),
      ...(s.utilizationPct != null ? [statRow('资金利用率', `${s.utilizationPct}%`, s.utilizationPct >= 60 ? 'up' : 'down')] : []),
      ...(s.basePosition != null ? [statRow('底仓比例', `${Math.round(s.basePosition * 100)}%`)] : []),
      ...(s.mtfMode ? [statRow('多级别过滤', `${s.mtfMode}（否决 ${s.mtfBlocked}）`)] : []),
      statRow('期末权益', U.fmt(s.finalValue)),
      `<div class="bt-caveats">${(r.caveats || []).map((c) => `<div>⚠ ${U.esc(c)}</div>`).join('')}</div>`,
    ].join('');
  }

  /**
   * 同类资产基准：策略中位 vs 同市场买入持有中位。
   * 单看"跑赢率"会掩盖结构差异——实测期货 +24%、港股 +13%，A股 −18%、美股 −91%。
   */
  function peerTable(peer) {
    if (!peer || !peer.byMarket) return '';
    const rows = Object.entries(peer.byMarket).map(([m, v]) => `<tr>
      <td><b>${U.esc(m)}</b></td><td>${v.symbols}</td>
      <td class="${v.stratMedian > 0 ? 'up' : 'down'}">${v.stratMedian}%</td>
      <td>${v.benchMedian}%</td>
      <td class="${v.diff > 0 ? 'up' : 'down'}">${v.diff > 0 ? '+' : ''}${v.diff}%</td>
      <td class="${v.better ? 'up' : ''}">${v.better ? '胜' : '—'}</td></tr>`).join('');
    return `<div class="peer-box"><div class="peer-head">同类资产基准 · ${peer.marketsBetter}/${peer.marketsTotal} 个市场跑赢本市场买入持有</div>
      <table class="bt-tbl"><thead><tr><th>市场</th><th>标的</th><th>策略中位</th><th>本市场买入持有</th><th>差</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function typeTable(list) {
    if (!list || !list.length) return '<div class="empty">无交易</div>';
    return `<table class="bt-tbl"><thead><tr><th>信号</th><th>笔数</th><th>胜率</th><th>平均收益</th><th>占比</th></tr></thead><tbody>${
      list.map((t) => `<tr><td><b>${U.esc(t.type)}</b></td><td>${t.n}</td><td class="${t.winRate >= 50 ? 'up' : 'down'}">${t.winRate}%</td><td class="${t.avgPct > 0 ? 'up' : 'down'}">${t.avgPct}%</td><td>${t.share != null ? t.share + '%' : '—'}</td></tr>`).join('')
    }</tbody></table>`;
  }

  function renderRows(rows) {
    if (!rows || !rows.length) { U.$('#btRows').innerHTML = '<div class="empty">无数据</div>'; return; }
    const ok = rows.filter((r) => r.ok).sort((a, b) => b.excessPct - a.excessPct);
    U.$('#btRows').innerHTML = `<table class="bt-tbl"><thead><tr><th>标的</th><th>笔数</th><th>胜率</th><th>收益</th><th>基准</th><th>超额</th><th>回撤</th><th>夏普</th></tr></thead><tbody>${
      ok.map((r) => `<tr><td>${r.market}:${r.code}</td><td>${r.trades}</td><td>${r.winRate}%</td><td class="${r.totalReturnPct > 0 ? 'up' : 'down'}">${r.totalReturnPct}%</td><td>${r.benchmarkPct}%</td><td class="${r.excessPct > 0 ? 'up' : 'down'}">${r.excessPct}%</td><td class="down">${r.maxDrawdownPct}%</td><td>${r.sharpe}</td></tr>`).join('')
    }</tbody></table>`;
  }

  function renderTrades(trades, signals) {
    const box = U.$('#btTrades');
    if (!box) return;
    if (!trades || !trades.length) { box.innerHTML = '<div class="empty">无成交</div>'; return; }
    const list = trades.slice(-60).reverse();
    box.innerHTML = `<table class="bt-tbl"><thead><tr><th>标的</th><th>信号</th><th>方向</th><th>开仓</th><th>平仓</th><th>收益</th><th>持仓</th><th>原因</th></tr></thead><tbody>${
      list.map((t) => `<tr>
        <td>${t.market ? t.market + ':' + t.code : ''}</td>
        <td>${U.esc(t.signalType || '')}</td>
        <td class="${t.dir > 0 ? 'up' : 'down'}">${t.dir > 0 ? '多' : '空'}</td>
        <td>${t.entryPrice}</td><td>${t.exitPrice}</td>
        <td class="${t.netPct > 0 ? 'up' : 'down'}">${t.netPct}%</td>
        <td>${t.bars}</td><td>${U.esc(t.exitWhy || '')}</td>
      </tr>`).join('')
    }</tbody></table>`;
  }

  /* ---------------- 资金曲线 ---------------- */
  function drawCurve(equity, benchPct) {
    const cv = U.$('#btCurve');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 600, h = cv.clientHeight || 220;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!equity || !equity.length) {
      g.fillStyle = 'rgba(150,160,180,.5)';
      g.font = '12px system-ui,sans-serif';
      g.fillText('跑单标的或批量后显示', 12, h / 2);
      return;
    }
    const vals = equity.map((e) => e.v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = 26, iw = w - pad * 2, ih = h - pad * 1.6;
    const x = (i) => pad + (i / (vals.length - 1 || 1)) * iw;
    const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * ih;
    // 基线（初始资金）
    g.strokeStyle = 'rgba(150,160,180,.25)';
    g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(pad, y(vals[0])); g.lineTo(w - pad, y(vals[0])); g.stroke();
    g.setLineDash([]);
    // 曲线
    const up = vals[vals.length - 1] >= vals[0];
    g.strokeStyle = up ? '#22b884' : '#f0544f';
    g.lineWidth = 1.6;
    g.beginPath();
    vals.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.stroke();
    // 填充
    g.lineTo(x(vals.length - 1), h - pad * 0.6);
    g.lineTo(x(0), h - pad * 0.6);
    g.closePath();
    g.fillStyle = up ? 'rgba(34,184,132,.12)' : 'rgba(240,84,79,.12)';
    g.fill();
    // 标注
    g.fillStyle = 'rgba(150,160,180,.8)';
    g.font = '10.5px system-ui,sans-serif';
    g.fillText(U.fmt(max), 4, pad - 6);
    g.fillText(U.fmt(min), 4, h - 8);
    U.$('#btCurveHint').textContent = `期末 ${U.fmt(vals[vals.length - 1])} · 基准 ${benchPct != null ? benchPct + '%' : '—'}`;
  }

  /* ---------------- 路由 ---------------- */
  async function renderPage() {
    const b1 = U.$('#btRun'), b2 = U.$('#btBatch'), b3 = U.$('#btSweep');
    if (b1 && !b1._bound) { b1._bound = 1; b1.addEventListener('click', runSingle); }
    if (b2 && !b2._bound) { b2._bound = 1; b2.addEventListener('click', runBatch); }
    if (b3 && !b3._bound) { b3._bound = 1; b3.addEventListener('click', runSweep); }
    if (!lastBatch && !U.$('#btStats').innerHTML.trim()) {
      U.$('#btStats').innerHTML = '<div class="loading">点上方按钮开始回测</div>';
    }
    if (lastBatch) drawCurve(null);
  }

  window.PageBacktest = { renderPage, runSingle, runBatch, runSweep, runOos, runRolling };
})();
