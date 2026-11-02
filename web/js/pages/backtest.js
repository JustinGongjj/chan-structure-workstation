/* 缠论因子回测页 */
(function () {
  'use strict';
  const { U, API, App } = window;
  let curveChart = null;
  let lastBatch = null;

  const P = () => ({
    symbols: (U.$('#btSymbols')?.value || '').trim(),
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
      const r = await API.get(`/api/bt/batch?${qs(p)}`);
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
        statRow('跑赢基准', `${s.beatBenchmark}/${s.symbols} = ${s.beatRate}%`, s.beatRate >= 50 ? 'up' : 'down'),
        statRow('中位超额', `${s.medianExcessPct}%`, s.medianExcessPct > 0 ? 'up' : 'down'),
        statRow('中位回撤', `${s.medianDrawdownPct}%`),
        statRow('最差回撤', `${s.worstDrawdownPct}%`),
      ].join('');
      U.$('#btTypes').innerHTML = typeTable(s.typeStats);
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
      U.$('#btTypes').innerHTML = '';
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
      statRow('期末权益', U.fmt(s.finalValue)),
      `<div class="bt-caveats">${(r.caveats || []).map((c) => `<div>⚠ ${U.esc(c)}</div>`).join('')}</div>`,
    ].join('');
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

  window.PageBacktest = { renderPage, runSingle, runBatch, runSweep };
})();
