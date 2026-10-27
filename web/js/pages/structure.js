/* 结构分析页：K线 + 笔 + 线段 + 中枢 + 买卖点 + 区间套 */
(function () {
  const PERIODS = {
    A: ['day', 'week', 'month', '60m', '30m', '15m', '5m', '1m'],
    HK: ['day', 'week', 'month'],
    US: ['day', 'week', 'month'],
    CR: ['day', 'week', '4h', '60m', '15m', '5m', '1m'],
  };
  const PNAME = { '1m': '1分', '5m': '5分', '15m': '15分', '30m': '30分', '60m': '60分', '1h': '1时', '4h': '4时', day: '日线', week: '周线', month: '月线' };
  let chart = null;
  let lastData = null;

  function initChart() {
    if (chart) return chart;
    const cv = U.$('#mainChart');
    chart = new ChanChart(cv, U.$('#crosshairTip'));
    renderLegend();
    return chart;
  }

  function renderLegend() {
    const items = [
      ['bi', '笔', '#e0b15a'],
      ['seg', '线段', '#a78bfa'],
      ['pivot', '中枢', '#5b8cff'],
      ['signal', '买卖点', '#22b884'],
      ['beichi', '背驰', '#e0b15a'],
      ['vol', '成交量', '#8a94a8'],
      ['macd', 'MACD', '#e8eef9'],
    ];
    U.$('#chartLegend').innerHTML = items
      .map(([k, n, c]) => `<span data-k="${k}" class="${chart && chart.toggles[k] === false ? 'off' : ''}"><i style="background:${c}"></i>${n}</span>`)
      .join('');
    U.$$('#chartLegend span').forEach((el) =>
      el.addEventListener('click', () => {
        const k = el.dataset.k;
        chart.setToggle(k, !chart.toggles[k]);
        el.classList.toggle('off', chart.toggles[k] === false);
      })
    );
  }

  function renderPeriods(market) {
    const list = PERIODS[market] || ['day'];
    if (!list.includes(App.state.period)) App.state.period = 'day';
    U.$('#periodSeg').innerHTML = list
      .map((p) => `<button class="sq ${p === App.state.period ? 'active' : ''}" data-p="${p}">${PNAME[p] || p}</button>`)
      .join('');
    U.$$('#periodSeg .sq').forEach((el) =>
      el.addEventListener('click', () => {
        App.state.period = el.dataset.p;
        renderPeriods(market);
        refresh();
      })
    );
  }

  async function refresh() {
    const market = App.state.market;
    const code = App.state.symbol[market];
    const period = App.state.period;
    initChart();
    renderPeriods(market);
    const sel = U.$('#teachSelect');
    if (sel) sel.value = App.state.hl || '';
    U.$('#structTitle').textContent = `${market} · ${code} · ${PNAME[period] || period}`;
    try {
      const res = await API.chan({ market, code, period, limit: 600 });
      lastData = res;
      if (!res.ok) {
        U.$('#chartNote').innerHTML = '<span style="color:var(--up)">' + U.esc(res.reason || '数据不足') + '</span>';
        return;
      }
      chart.setData(res);
      U.stamp('liveStampStruct');
      renderState(res);
      renderSignals(res);
      renderNarrative(res);
      U.$('#chartNote').innerHTML = [
        `数据源：${res.source || '—'}`,
        `K线 ${res.bars.length} 根 → 合并 ${res.stats.mergedBars}`,
        `笔 ${res.stats.bis} / 线段 ${res.stats.segments} / 中枢 ${res.stats.pivots}`,
        `级别：${res.level.levelName}`,
        '滚轮缩放 · 拖拽平移 · 双击复位',
      ]
        .map((t) => `<span>${t}</span>`)
        .join('');
      loadSuite(market, code);
      loadBacktest(market, code, period);
      applyHighlight(res);
    } catch (e) {
      U.$('#chartNote').innerHTML = '<span style="color:var(--up)">加载失败：' + U.esc(e.message) + '</span>';
    }
  }

  function renderState(res) {
    const st = res.stats;
    const q = res.quote || {};
    const pv = st.activePivot;
    U.$('#structLevel').textContent = res.level.levelName;
    const rows = [
      ['现价', `<span class="${U.cls(q.pct)}">${U.fmt(st.price)}（${U.pct(q.pct)}）</span>`],
      ['趋势类型', `${res.trend.type}<span class="hint">（${res.trend.sub}）</span>`],
      ['当前中枢', pv ? `[${U.fmt(pv.zd)}, ${U.fmt(pv.zg)}] · ${pv.count} 笔${pv.upgraded ? ' · 九笔升级' : ''}` : '尚未形成'],
      ['现价位置', U.POS_TXT[st.position] || '—'],
      ['最后一笔', res.bis.length ? `${res.bis[res.bis.length - 1].dir > 0 ? '向上' : '向下'} ${U.fmt(res.bis[res.bis.length - 1].p0)} → ${U.fmt(res.bis[res.bis.length - 1].p1)}` : '—'],
      ['结构', res.structure.replace(/（.*?）/, '')],
      ['最近信号', st.lastSignal ? `${st.lastSignal.name} @ ${U.fmt(st.lastSignal.price)}` : '近 90 根无'],
    ];
    U.$('#structState').innerHTML = rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  }

  function renderSignals(res) {
    const n = res.bars.length;
    const list = res.signals.filter((s) => s.barIdx >= n - 160).reverse();
    if (!list.length) {
      U.$('#structSignals').innerHTML = '<div class="loading" style="height:70px">近 160 根内暂无买卖点</div>';
      return;
    }
    U.$('#structSignals').innerHTML = list
      .slice(0, 10)
      .map((s) => {
        const buy = s.type.endsWith('B');
        return `<div class="sig-item" title="${U.esc(s.note || '')}">
        <span class="badge ${buy ? 'buy' : 'sell'}">${U.SIG_SHORT[s.type]}</span>
        <span class="nm">${U.fmt(s.price)} <span class="hint">${U.esc(s.beichi || '')}</span></span>
        <span class="dt">${U.ts(s.t, res.period)}</span>
      </div>`;
      })
      .join('');
  }

  function renderNarrative(res) {
    const parts = String(res.summary || '').split('｜').filter(Boolean);
    const html = parts.map((p) => `<p>${U.esc(p)}</p>`).join('');
    const extra = [];
    if (res.beichi && res.beichi.length) {
      const b = res.beichi[res.beichi.length - 1];
      extra.push(
        `<p><b>背驰</b>：${b.kind}，${b.dir > 0 ? '顶部' : '底部'}，价格 ${U.fmt(b.price)}，力度比 ${b.areaRatio}（${U.ts(b.t, res.period)}）</p>`
      );
    }
    if (res.pivots.length) {
      const last = res.pivots[res.pivots.length - 1];
      extra.push(
        `<p><b>最近中枢</b>：ZD ${U.fmt(last.zd)} / ZG ${U.fmt(last.zg)} / 区间高度 ${U.fmt(last.height)}，共 ${last.count} 笔${last.upgraded ? '，已满足九笔升级条件（可能升级为更高级别中枢）' : ''}。</p>`
      );
    }
    U.$('#structNarrative').innerHTML = html + extra.join('');
  }

  function applyHighlight(res, keepView) {
    const key = App.state.hl;
    const card = U.$('#teachCard');
    const chartEl = PageStructure.getChart();
    if (!key || !res || !res.ok) {
      if (card) card.style.display = 'none';
      if (chartEl) chartEl.setHighlight(null);
      return;
    }
    const spec = window.CHAN_HL.buildHighlight(key, res);
    if (!spec) {
      if (card) card.style.display = 'none';
      if (chartEl) chartEl.setHighlight(null);
      return;
    }
    if (chartEl) chartEl.setHighlight(spec.bands.length ? spec : null, { keepView: !!keepView });
    U.$('#teachTitle').innerHTML = `${U.esc(spec.title)} <span class="teach-tag">教学标注</span>`;
    U.$('#teachSub').textContent = `${res.level.levelName} · ${res.code || ''} · ${spec.period}`;
    U.$('#teachSteps').innerHTML = spec.steps.map((x) => `<li>${x}</li>`).join('');
    const legend = [
      ['accent', '进入段 / 前段', '#5b8cff'],
      ['gold', '中枢', '#e0b15a'],
      ['seg', '离开段 / 线段', '#a78bfa'],
      ['up', '上冲 / 卖侧', '#f0544f'],
      ['down', '下跌 / 买侧', '#22b884'],
    ];
    const LEVEL_KEYS = ['beichi', 'panzheng_beichi', 'buy1', 'buy2', 'buy3', 'qujian_tao', 'zoushi_jibie', 'zhongyin'];
    const levels = (PERIODS[App.state.market] || ['day']).slice(0, 4);
    const levelBtns = LEVEL_KEYS.includes(key)
      ? `<span class="teach-tip">换级别看同一结构：</span>` +
        levels
          .map((p) => `<button class="teach-pill teach-lv" data-p="${p}">${PNAME[p] || p}</button>`)
          .join('')
      : '';
    U.$('#teachFoot').innerHTML =
      `<span class="teach-tip">图上颜色对应：</span>` +
      legend
        .map(([, label, color]) => `<span class="teach-pill"><i style="background:${color}"></i>${label}</span>`)
        .join('') +
      levelBtns +
      `<span class="teach-tip">（区间外已压暗；滚轮缩放 / 拖拽平移）</span>`;
    U.$$('#teachFoot .teach-lv').forEach((b) =>
      b.addEventListener('click', () => {
        App.state.period = b.dataset.p;
        renderPeriods(App.state.market);
        refresh();
      })
    );
    const cardEl = U.$('#teachCard');
    cardEl.style.display = '';
    if (key === 'qujian_tao') {
      const suite = U.$('#suiteTbl');
      if (suite) suite.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  let liveN = 0;
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    const market = App.state.market;
    const code = App.state.symbol[market];
    const period = App.state.period;
    try {
      const res = await API.chan({ market, code, period, limit: 600 });
      if (!res.ok || !chart) return;
      lastData = res;
      chart.setData(res, { keepView: true });
      renderState(res);
      renderSignals(res);
      renderNarrative(res);
      applyHighlight(res, true);
      U.stamp('liveStampStruct');
      if (++liveN % 3 === 0) loadSuite(market, code);
    } catch (e) {
      /* 静默 */
    } finally {
      ticking = false;
    }
  }

  /* ---------- 信号历史表现（同标的同级别回测） ---------- */
  async function loadBacktest(market, code, period) {
    const box = U.$('#btBody');
    const hint = U.$('#btHint');
    if (!box) return;
    box.innerHTML = '<div class="loading" style="height:60px">回测中…</div>';
    try {
      const bt = await API.backtest({ market, code, period, horizon: 5 });
      if (hint) hint.textContent = `后 ${bt.horizon} 根 · 样本 ${bt.overall.n || 0}`;
      if (!bt.signals || !bt.overall.n) {
        box.innerHTML = '<div class="hint">本级历史买卖点样本不足（需信号出现在最近 ${bt.bars} 根内且已走完 ' + bt.horizon + ' 根），暂不给统计。</div>';
        return;
      }
      const small = bt.overall.n < 10;
      const rows = Object.entries(bt.byType)
        .sort((a, b) => b[1].n - a[1].n)
        .map(
          ([t, v]) =>
            `<tr><td class="name">${U.SIG_SHORT[t] || t}</td><td>${v.n}</td><td class="${v.winRate >= 0.5 ? 'up' : 'down'}">${(v.winRate * 100).toFixed(0)}%</td><td class="${v.avgRet >= 0 ? 'up' : 'down'}">${(v.avgRet * 100).toFixed(2)}%</td><td>${v.profitFactor == null ? '—' : v.profitFactor}</td></tr>`
        )
        .join('');
      box.innerHTML = `
        <div>总体：命中 <b class="${bt.overall.winRate >= 0.5 ? 'up' : 'down'}">${(bt.overall.winRate * 100).toFixed(1)}%</b>（n=${bt.overall.n}），均值 ${(bt.overall.avgRet * 100).toFixed(2)}%，基线 ${(bt.baseline.avgRet * 100).toFixed(3)}%，超额 ${(bt.edge * 100).toFixed(2)}pp</div>
        <table class="bt-table"><thead><tr><th>信号</th><th>次数</th><th>命中</th><th>均值</th><th>盈亏比</th></tr></thead><tbody>${rows}</tbody></table>
        ${small ? '<div class="bt-warn">样本太小（<10），只能当参考，不能当胜率承诺。</div>' : bt.edge > 0 ? '<div class="bt-ok">样本内优于基线，仍需样本外验证。</div>' : '<div class="bt-warn">样本内未跑赢基线，说明该级别信号在此标的上没有稳定优势。</div>'}
        <div class="hint" style="margin-top:6px">口径：信号当根收盘入场，持有 ${bt.horizon} 根，含 ${bt.feeBps}bp 成本；做空类信号按反向计。</div>`;
    } catch (e) {
      box.innerHTML = `<div class="hint">回测失败：${U.esc(e.message)}</div>`;
      if (hint) hint.textContent = '失败';
    }
  }

  async function loadSuite(market, code) {
    U.$('#suiteTbl').innerHTML = '<div class="loading" style="height:60px">计算多级别结构…</div>';
    try {
      const res = await API.suite({ market, code });
      const levels = res.levels || [];
      U.$('#suiteHint').textContent = res.resonance || '大级别定方向 → 小级别等买点';
      U.$('#suiteTbl').innerHTML = levels
        .map((l) => {
          if (!l.ok) return `<div class="suite-card"><div class="lv"><span>${PNAME[l.period] || l.period}</span><span class="chip red">无数据</span></div><div class="ds">${U.esc(l.error || '')}</div></div>`;
          const sig = l.signal ? `<span class="chip ${l.signal.type.endsWith('B') ? 'green' : 'red'}">${U.SIG_SHORT[l.signal.type]}</span>` : '';
          const bei = l.beichi ? `<span class="chip gold">${l.beichi.kind}${l.beichi.dir > 0 ? '·顶' : '·底'}</span>` : '';
          const hl = l.signal || l.beichi ? 'hl' : '';
          return `<div class="suite-card ${hl}">
          <div class="lv"><span>${l.levelName}</span>${sig}${bei}</div>
          <div class="st">${l.trend} · ${U.POS_TXT[l.position] || ''}</div>
          <div class="ds">${l.pivot ? `中枢 [${U.fmt(l.pivot.zd)}, ${U.fmt(l.pivot.zg)}]` : '无中枢'} · 末笔${l.lastBiDir > 0 ? '上' : '下'}</div>
        </div>`;
        })
        .join('');
    } catch (e) {
      U.$('#suiteTbl').innerHTML = '<div class="loading">' + U.esc(e.message) + '</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initChart();
    U.$('#zoomIn').addEventListener('click', () => chart.zoom(1 / 1.25));
    U.$('#zoomOut').addEventListener('click', () => chart.zoom(1.25));
    U.$('#zoomReset').addEventListener('click', () => chart.resetView());
    const sel = U.$('#teachSelect');
    if (sel)
      sel.addEventListener('change', () => {
        App.state.hl = sel.value || null;
        App.syncURL();
        refresh();
      });
    const tc = U.$('#teachClose');
    if (tc)
      tc.addEventListener('click', () => {
        App.state.hl = null;
        App.syncURL();
        if (U.$('#teachCard')) U.$('#teachCard').style.display = 'none';
        const sel2 = U.$('#teachSelect');
        if (sel2) sel2.value = '';
        const ch = PageStructure.getChart();
        if (ch) {
          ch.setHighlight(null);
          ch.resetView();
        }
      });
    window.addEventListener('resize', U.debounce(() => chart && chart.draw(), 120));
  });

  window.PageStructure = { render: refresh, tick, getChart: () => chart };
})();
