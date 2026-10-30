/* 结构分析页：K线 + 笔 + 线段 + 中枢 + 买卖点 + 区间套 */
(function () {
  const PERIODS = {
    A: ['day', 'week', 'month', '60m', '30m', '15m', '5m', '1m'],
    HK: ['day', 'week', 'month'],
    US: ['day', 'week', 'month'],
    CR: ['day', 'week', '4h', '60m', '15m', '5m', '1m'],
    CNF: ['day', 'week', 'month'],
    USF: ['day', 'week', 'month'],
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

  async function refresh(opts) {
    bindPickerOnce();
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
      // 每次都重新载入：renderStructure 会重建 canvas，只在 key 变化时载入会让已有线消失
      loadDrawings();
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

  let teachState = { spec: null, step: 1, keepView: false };

  /** 把标注裁剪成「第 k 步」：先逐条显带，再显参考线，最后显关键点 */
  function partialSpec(spec, step) {
    const bands = spec.bands || [];
    const hlines = spec.hlines || [];
    const marks = spec.marks || [];
    const nb = Math.min(bands.length, Math.max(1, step));
    const showH = step > bands.length;
    const showM = step > bands.length + 1;
    return {
      ...spec,
      bands: bands.slice(0, nb),
      hlines: showH ? hlines : [],
      marks: showM ? marks : marks.slice(0, Math.max(0, step - 1)),
      range: spec.range,
    };
  }

  function paintTeachStep() {
    const { spec, step } = teachState;
    const ch = PageStructure.getChart();
    if (!ch || !spec) return;
    const st = Math.min(Math.max(1, step), spec.steps.length);
    teachState.step = st;
    ch.setHighlight(partialSpec(spec, st), { keepView: true });
    const stepsEl = U.$('#teachSteps');
    if (stepsEl)
      Array.from(stepsEl.children).forEach((li, i) => {
        li.style.opacity = i + 1 === st ? '1' : i + 1 < st ? '.55' : '.4';
        li.style.fontWeight = i + 1 === st ? '650' : '400';
      });
    const lab = U.$('#teachStepLabel');
    if (lab) lab.textContent = `第 ${st} / ${spec.steps.length} 步`;
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
    teachState = { spec, step: 1, keepView: !!keepView };
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
    const foot = U.$('#teachFoot');
    if (foot && spec.steps.length > 1) {
      foot.insertAdjacentHTML(
        'afterend',
        `<div class="teach-stepbar" id="teachStepBar">
          <button class="btn ghost sm" id="teachPrev" title="上一步">‹ 上一步</button>
          <span class="teach-stepLabel" id="teachStepLabel">第 1 / ${spec.steps.length} 步</span>
          <button class="btn ghost sm" id="teachNext" title="下一步">下一步 ›</button>
          <span class="hint">按步骤看：图上会一步步把对应结构点亮</span>
        </div>`
      );
      U.$('#teachPrev').addEventListener('click', () => {
        teachState.step = Math.max(1, teachState.step - 1);
        paintTeachStep();
      });
      U.$('#teachNext').addEventListener('click', () => {
        teachState.step = Math.min(spec.steps.length, teachState.step + 1);
        paintTeachStep();
      });
    }
    paintTeachStep();
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

  /* ---------------- 标的选择器 ---------------- */
  const HOT = [
    ['A', '热门 A 股', [['600519', '贵州茅台'], ['300750', '宁德时代'], ['000001', '平安银行'], ['601899', '紫金矿业'], ['002594', '比亚迪']]],
    ['CNF', '国内期货', [['IF0', '沪深300主连'], ['RB0', '螺纹钢主连'], ['AU0', '沪金主连'], ['CU0', '沪铜主连'], ['M0', '豆粕主连'], ['SC0', '原油主连']]],
    ['USF', '美期货', [['ES', '标普500'], ['NQ', '纳指100'], ['GC', '黄金'], ['CL', '原油'], ['SI', '白银']]],
    ['CR', '加密', [['BTCUSDT', 'BTC'], ['ETHUSDT', 'ETH'], ['SOLUSDT', 'SOL'], ['BNBUSDT', 'BNB'], ['XRPUSDT', 'XRP'], ['DOGEUSDT', 'DOGE']]],
    ['US', '热门美股', [['NVDA', '英伟达'], ['AAPL', '苹果'], ['TSLA', '特斯拉'], ['MSFT', '微软']]],
    ['HK', '热门港股', [['00700', '腾讯控股'], ['09988', '阿里巴巴'], ['03690', '美团']]]
  ];

  let pickerBound = false;

  function renderPicker() {
    const box = U.$('#pickerHot');
    if (!box) return;
    box.innerHTML = HOT.map(
      ([mk, title, items]) => `<div class="picker-group">
        <div class="pg-title">${title}</div>
        <div class="picker-chips">${items
          .map(([code, name]) => `<button class="picker-chip" data-m="${mk}" data-c="${code}">${U.esc(name)}<span class="mk">${U.MK[mk]}</span></button>`)
          .join('')}</div>
      </div>`
    ).join('');
    U.$$('#pickerHot .picker-chip').forEach((b) =>
      b.addEventListener('click', () => {
        App.state.market = b.dataset.m;
        App.state.symbol[b.dataset.m] = b.dataset.c;
        hidePicker();
        refresh();
      })
    );
  }

  function hidePicker() {
    const p = U.$('#symbolPicker');
    if (p) p.style.display = 'none';
  }

  function showPicker() {
    const p = U.$('#symbolPicker');
    if (p) p.style.display = '';
  }

  function bindPickerOnce() {
    if (pickerBound) return;
    pickerBound = true;
    renderPicker();
    const inp = U.$('#pickerSearch');
    const box = U.$('#pickerResults');
    if (!inp || !box) return;
    const run = U.debounce(async () => {
      const q = inp.value.trim();
      if (q.length < 1) { box.style.display = 'none'; return; }
      try {
        const res = await API.search(q);
        box.innerHTML = res.items.length
          ? res.items.map((it) => `<div class="list-item" data-m="${it.market}" data-c="${it.code}">
              <span class="chip">${U.MK[it.market] || it.market}</span>
              <div class="mid"><div class="nm">${U.esc(it.name)}</div><div class="cd">${U.esc(it.code)}</div></div>
            </div>`).join('')
          : '<div class="list-item">没有匹配的标的</div>';
        box.style.display = '';
        U.$$('.list-item[data-c]', box).forEach((el) =>
          el.addEventListener('click', () => {
            App.state.market = el.dataset.m;
            App.state.symbol[el.dataset.m] = el.dataset.c;
            box.style.display = 'none';
            inp.value = '';
            hidePicker();
            refresh();
          })
        );
      } catch (e) {
        box.innerHTML = '<div class="list-item">搜索失败：' + U.esc(e.message) + '</div>';
        box.style.display = '';
      }
    }, 260);
    inp.addEventListener('input', run);
  }

  /* ---------------- 手绘线 ---------------- */
  let drawingKey = '';
  let drawingList = [];
  let saveTimer = null;

  function currentKey() {
    const st = App.state;
    return { market: st.market, code: st.symbol ? st.symbol[st.market] : st.code, period: st.period };
  }

  let drawSeq = 0;

  async function loadDrawings() {
    const k = currentKey();
    const key = `${k.market}:${k.code}:${k.period}`;
    const seq = ++drawSeq;
    drawingKey = key;
    try {
      const res = await API.drawings(k);
      if (seq !== drawSeq) return; // 乱序返回：丢掉，否则会把别的标的的线套上来
      drawingList = res.drawings || [];
    } catch (e) {
      if (seq !== drawSeq) return;
      drawingList = [];
    }
    chart.setDrawings(drawingList);
    updateDrawHint();
  }

  function persistDrawings(list) {
    drawingList = list;
    const k = currentKey();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      API.drawingsSave({ ...k, drawings: list })
        .then((r) => updateDrawHint(r && r.dropped ? `已保存（丢弃最早 ${r.dropped} 条）` : '已保存'))
        .catch((e) => updateDrawHint('保存失败：' + e.message));
    }, 350);
  }

  function updateDrawHint(msg) {
    const el = U.$('#drawHint');
    if (!el) return;
    const n = drawingList.length;
    el.textContent =
      (msg ? msg + ' · ' : '') +
      `当前 ${n} 条手绘线 · 点「趋势线」后点两下（自动吸附笔端点）· 点线选中后 Delete 删除`;
  }

  function bindDrawing() {
    const setBtn = (id, mode) => {
      const b = U.$('#' + id);
      if (!b) return;
      b.addEventListener('click', () => {
        const on = chart.drawMode === mode;
        chart.setDrawMode(on ? 'none' : mode);
        ['drawTrend', 'drawLevel', 'drawRect'].forEach((bid) => {
          const el = U.$('#' + bid);
          if (!el) return;
          el.classList.toggle('primary', false);
          el.setAttribute('aria-pressed', 'false');
        });
        if (!on) {
          b.classList.add('primary');
          b.setAttribute('aria-pressed', 'true');
        }
        updateDrawHint(on ? '已退出画线' : mode === 'trend' ? '点两下画线' : mode === 'rect' ? '拖出一个框' : '点一下画水平线');
      });
    };
    setBtn('drawTrend', 'trend');
    setBtn('drawLevel', 'hline');
    setBtn('drawRect', 'rect');
    U.$('#drawDel')?.addEventListener('click', () => {
      if (!chart.deleteSelected()) U.toast('先点一条线选中它');
    });
    U.$('#drawClear')?.addEventListener('click', () => {
      if (confirm('清空当前标的的全部手绘线？')) chart.clearDrawings();
    });
    U.$('#drawVerify')?.addEventListener('click', runDrawVerify);
    U.$('#drawModalClose')?.addEventListener('click', closeDrawModal);
    U.$('#drawModalAgain')?.addEventListener('click', runDrawVerify);
    U.$('#drawModal')?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'drawModal') closeDrawModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && U.$('#drawModal')?.classList.contains('show')) closeDrawModal();
    });
    document.addEventListener('keydown', (e) => {
      const typing = (() => {
        const a = document.activeElement;
        return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
      })();
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        if (chart.deleteSelected()) e.preventDefault();
      }
      if (e.key === 'Escape') chart.setDrawMode('none');
    });
    chart.onDraws = (list) => {
      persistDrawings(list);
      updateDrawHint('已保存');
    };
  }

  function openDrawModal() {
    const m = U.$('#drawModal');
    if (!m) return;
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    U.$('#drawModalClose')?.focus();
  }

  function closeDrawModal() {
    const m = U.$('#drawModal');
    if (!m) return;
    m.classList.remove('show');
    m.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  async function runDrawVerify() {
    const k = currentKey();
    if (U.$('#drawScore')) U.$('#drawScore').textContent = '复核中…';
    if (U.$('#drawVerdict')) U.$('#drawVerdict').innerHTML = '<div class="loading">正在把线和笔/中枢/买卖点对齐…</div>';
    if (U.$('#drawFindings')) U.$('#drawFindings').innerHTML = '';
    if (U.$('#drawMethod')) U.$('#drawMethod').textContent = '';
    openDrawModal(); // 结果直接在弹窗里出来，而不是塞在页面底部
    try {
      const res = await API.drawingsVerify({ ...k, drawings: chart.getDrawings() });
      renderDrawVerify(res);
    } catch (e) {
      if (U.$('#drawVerdict')) U.$('#drawVerdict').innerHTML = '<div class="loading">复核失败：' + U.esc(e.message) + '</div>';
      if (U.$('#drawScore')) U.$('#drawScore').textContent = '失败';
    }
  }

  function renderDrawVerify(res) {
    const lv = { ok: 'ok', warn: 'warn', fail: 'fail' }[res.verdict.level] || 'warn';
    if (U.$('#drawScore')) U.$('#drawScore').innerHTML = `一致度 <b>${res.score}</b> / 100`;
    if (U.$('#drawVerdict')) U.$('#drawVerdict').innerHTML = `<div class="dv ${lv}">${U.esc(res.verdict.text)}</div>`;
    if (U.$('#drawFindings')) {
      U.$('#drawFindings').innerHTML = (res.lines || [])
        .map((ln) => {
          const tag = ln.type === 'hline' ? '水平线' : ln.type === 'rect' ? '矩形' : '趋势线';
          return `<div class="dv-line"><div class="dv-h">${tag} · ${ln.score} 分</div>${ln.findings
            .map((f) => `<div class="dv-f ${f.level}">${f.level === 'ok' ? '✓' : f.level === 'warn' ? '!' : '✗'} ${U.esc(f.text)}</div>`)
            .join('')}</div>`;
        })
        .join('') || '<div class="hint">还没有画线</div>';
    }
    if (U.$('#drawMethod'))
      U.$('#drawMethod').innerHTML =
        U.esc((res.method && res.method.steps || []).join(' · ')) +
        `<br><span style="opacity:.75">引擎：${U.esc(res.engine || 'rule-based')}（确定性规则，非大模型）· ${U.esc(res.disclaimer || '')}</span>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    initChart();
    U.$('#zoomIn').addEventListener('click', () => chart.zoom(1 / 1.25));
    U.$('#zoomOut').addEventListener('click', () => chart.zoom(1.25));
    U.$('#zoomReset').addEventListener('click', () => chart.resetView());
    bindDrawing();
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
        const bar = U.$('#teachStepBar');
        if (bar) bar.remove();
      });
    window.addEventListener('resize', U.debounce(() => chart && chart.draw(), 120));
  });

  function renderPage() {
    bindPickerOnce();
    // 从 URL / 搜索 / 雷达带进来的标的：直接出图；裸进菜单：先让用户选
    const explicit = !!(App.state.pickedSymbol);
    if (explicit) hidePicker();
    else showPicker();
    return refresh();
  }

  window.PageStructure = {
    render: renderPage,
    tick,
    getChart: () => chart,
    showPicker,
    hidePicker,
  };
})();
