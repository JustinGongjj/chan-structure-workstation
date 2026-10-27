/* =========================================================
   缠论炒股工作站 · 手机版（iOS / Android 双皮肤）
   复用 PC 端 API、格式化、图表与教学标注模块
   ========================================================= */
(function () {
  const U = window.U;
  const $ = (s) => document.querySelector(s);
  const view = $('#view');

  const state = {
    tab: 'overview',
    market: 'A',
    symbol: { A: '600519', HK: '00700', US: 'NVDA', CR: 'BTCUSDT' },
    period: 'day',
    hl: null,
    live: localStorage.getItem('chan-live') === '1',
    chart: null,
    radarScope: 'all',
    radarRows: null,
    theoryTab: 'concepts',
    theoryKw: '',
    div: { mode: 'price', nonce: 0, code: '600519', market: 'A', live: false, timer: null, last: null },
    timer: null,
    tickN: 0,
  };

  const PNAME = { '1m': '1分', '5m': '5分', '15m': '15分', '30m': '30分', '60m': '60分', '1h': '1时', '4h': '4时', day: '日线', week: '周线', month: '月线' };
  const PERIODS = { A: ['day', 'week', '60m', '30m', '15m', '5m'], HK: ['day', 'week'], US: ['day', 'week'], CR: ['day', '4h', '60m', '15m', '5m'] };
  const HL_CHOICES = [
    ['', '不标注'],
    ['fenxing', '分型'],
    ['bi', '笔'],
    ['zhongshu', '中枢'],
    ['a_A_b', 'a+A+b'],
    ['beichi', '背驰'],
    ['buy1', '一买'],
    ['buy3', '三买'],
  ];

  const BUILD = 'v1.1 · 2026-10-27';

  /* ---------------- 基础 ---------------- */
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2000);
  }
  function bjNow() {
    const d = new Date(Date.now() + 8 * 3600000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  function stampHtml() {
    const d = new Date(Date.now() + 8 * 3600000);
    const t = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
    return `<span class="hint mono">${t} 更新</span>`;
  }
  function skeleton(h) {
    return `<div class="card"><div class="skel" style="width:60%;margin-bottom:8px"></div><div class="skel" style="width:85%;height:10px"></div></div>`;
  }

  /* ---------------- 路由 ---------------- */
  async function go(tab, opts) {
    if (!['overview', 'radar', 'structure', 'theory', 'divination'].includes(tab)) tab = 'overview';
    if (state.tab === 'divination' && tab !== 'divination') {
      clearInterval(state.div && state.div.timer);
      if (state.div) { state.div.timer = null; state.div.live = false; }
    }
    closeSheet();
    const token = (state.renderToken = (state.renderToken || 0) + 1);
    state.tab = tab;
    U.$$('#tabbar .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#appTitle').textContent = { overview: '总览', radar: '买卖点雷达', structure: '结构分析', theory: '缠论理论', divination: '算卦择时' }[tab];
    if (!(opts && opts.silent)) {
      const q = `?tab=${tab}${location.search.includes('skin=') ? '&skin=' + document.documentElement.dataset.skin : ''}#${tab}`;
      try { history.pushState({ tab }, '', q); } catch (e) { history.replaceState(null, '', q); }
    }
    view.innerHTML = skeleton();
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    try {
      if (tab === 'overview') await renderOverview();
      else if (tab === 'radar') await renderRadar();
      else if (tab === 'structure') await renderStructure();
      else if (tab === 'theory') renderTheory();
      else await renderDivination();
    } catch (e) {
      view.innerHTML = `<div class="empty">加载失败：${U.esc(e.message)}<br><button class="btn button sm" id="retryBtn" style="margin-top:12px">重试</button></div>`;
      const b = $('#retryBtn');
      if (b) b.addEventListener('click', () => go(state.tab));
    }
  }

  /* 防串页：异步渲染落地前再确认一次当前 Tab（用户可能已经切走了） */
  const stale = (t) => state.tab !== t;

  /* ---------------- 总览 ---------------- */
  async function renderOverview() {
    const ov = await API.overview();
    const daily = await API.daily().catch(() => null);
    const p = ov.pulse;
    const pulseCards = [
      ['A', 'A股'], ['HK', '港股'], ['US', '美股'], ['CR', '加密'],
    ]
      .map(([m, name]) => {
        const x = p[m] || { avgPct: 0, up: 0, down: 0, heat: 50 };
        return `<div class="pulse" data-pulse="${m}">
        <div class="n"><span>${name} · 自选均涨</span><span class="chip">${U.MK[m]}</span></div>
        <div class="v ${U.cls(x.avgPct)}">${U.pct(x.avgPct)}</div>
        <div class="s">涨 ${x.up} · 跌 ${x.down}</div>
        <div class="heat"><i style="width:${x.heat}%"></i></div>
      </div>`;
      })
      .join('');

    const idx = ov.indices
      .map(
        (r) => `<div class="idx-chip" data-m="${r.market}" data-c="${r.code}">
      <div class="n">${U.esc(r.name)}</div>
      <div class="p ${U.cls(r.pct)}">${U.fmt(r.price, 2)}</div>
      <div class="c ${U.cls(r.pct)}">${U.pct(r.pct)}</div>
    </div>`
      )
      .join('');

    const watch = ov.watch
      .map(
        (r) => `<div class="list-item" data-m="${r.market}" data-c="${r.code}">
      <div class="mid"><div class="nm">${U.esc(r.name)}</div><div class="cd">${U.esc(r.code)} · ${U.MK[r.market]}</div></div>
      <div><div class="px ${U.cls(r.pct)}">${U.fmt(r.price)}</div><div class="dt ${U.cls(r.pct)}">${U.pct(r.pct)}</div></div>
    </div>`
      )
      .join('');

    const dailyCard = daily
      ? `<div class="card">
      <div class="row between" style="margin-bottom:8px"><h3 style="font-size:14px">今日干支</h3><span class="chip gold">${daily.pillars.day.text}日 · ${daily.jianchu}</span></div>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <span class="gold" style="font-family:'Songti SC',serif;font-size:16px;letter-spacing:2px">${daily.pillars.year.text} ${daily.pillars.month.text} ${daily.pillars.day.text}</span>
        <span class="hint">${daily.pillars.hour.name} ${daily.pillars.hour.text} · 冲${daily.chong.animal} · 旬空 ${daily.kong.join(' ')}</span>
      </div>
      <div class="hint" style="margin-top:8px">${U.esc(daily.advice.tip)}</div>
    </div>`
      : '';

    if (stale('overview')) return;
    view.innerHTML = `
      <h1 class="page-title">总览 <span id="ovStamp">${stampHtml()}</span></h1>
      <div class="page-sub">四市场自选池 · 点击任意标的进入结构分析</div>
      <div class="pulse-grid section">${pulseCards}</div>
      <div class="section">
        <div class="section-head"><h3>指数</h3><span class="hint">左右滑动</span></div>
        <div class="hscroll">${idx}</div>
      </div>
      <div class="section">
        <div class="section-head"><h3>自选池</h3><button class="chip" id="ovEdit">管理</button></div>
        <div class="list">${watch || '<div class="empty">自选池为空</div>'}</div>
      </div>
      <div class="section">
        <div class="section-head"><h3>今日结构信号</h3><button class="chip" id="ovRadar">全部</button></div>
        <div id="ovSignals" class="list"><div class="empty">扫描中…</div></div>
      </div>
      ${dailyCard}
      <div class="hint" style="text-align:center;padding:6px 0 20px">缠论工作站 · 手机版 · 娱乐与学习用途</div>`;

    U.$$('#view .list-item[data-c]').forEach((el) => el.addEventListener('click', () => openStructure(el.dataset.m, el.dataset.c)));
    U.$$('#view .idx-chip').forEach((el) => el.addEventListener('click', () => openStructure(el.dataset.m, el.dataset.c)));
    const ed = $('#ovEdit');
    if (ed) ed.addEventListener('click', openWatchlist);
    const rd = $('#ovRadar');
    if (rd) rd.addEventListener('click', () => go('radar'));

    // 信号异步加载
    API.radar({ scope: 'all', period: 'day' })
      .then((res) => {
        const rows = res.rows.filter((r) => r.last && !r.error).slice(0, 8);
        const box = $('#ovSignals');
        if (!box) return;
        box.innerHTML = rows.length
          ? rows
              .map((r) => {
                const s = r.last;
                const buy = s.type.endsWith('B');
                return `<div class="list-item" data-m="${r.market}" data-c="${r.code}">
              <span class="badge ${buy ? 'buy' : 'sell'}">${U.SIG_SHORT[s.type]}</span>
              <div class="mid"><div class="nm">${U.esc(r.name)}</div><div class="cd">${U.MK[r.market]} · ${U.POS_TXT[r.position] || ''}</div></div>
              <div><div class="px">${U.fmt(s.price)}</div><div class="dt">${U.ts(s.t, 'day')}</div></div>
            </div>`;
              })
              .join('')
          : '<div class="empty">近 90 根 K 线内暂无买卖点</div>';
        U.$$('#ovSignals .list-item[data-c]').forEach((el) => el.addEventListener('click', () => openStructure(el.dataset.m, el.dataset.c)));
      })
      .catch(() => {
        const box = $('#ovSignals');
        if (box) box.innerHTML = '<div class="empty">雷达暂不可用</div>';
      });
  }

  /* 实时增量刷新总览：只更新文本节点，绝不重建 DOM —— 重建会把用户的滚动位置弹回顶部 */
  function patchOverview(ov) {
    if (!ov) return;
    const p = ov.pulse || {};
    ['A', 'HK', 'US', 'CR'].forEach((m) => {
      const card = document.querySelector(`.pulse[data-pulse="${m}"]`);
      if (!card) return;
      const x = p[m] || { avgPct: 0, up: 0, down: 0, heat: 50 };
      const v = card.querySelector('.v');
      if (v) { v.className = 'v ' + U.cls(x.avgPct); v.textContent = U.pct(x.avgPct); }
      const sm = card.querySelector('.s');
      if (sm) sm.textContent = `涨 ${x.up} · 跌 ${x.down}`;
      const heat = card.querySelector('.heat i');
      if (heat) heat.style.width = x.heat + '%';
    });
    (ov.indices || []).forEach((r) => {
      const el = document.querySelector(`.idx-chip[data-m="${r.market}"][data-c="${r.code}"]`);
      if (!el) return;
      const pEl = el.querySelector('.p');
      if (pEl) { pEl.className = 'p ' + U.cls(r.pct); pEl.textContent = U.fmt(r.price, 2); }
      const cEl = el.querySelector('.c');
      if (cEl) { cEl.className = 'c ' + U.cls(r.pct); cEl.textContent = U.pct(r.pct); }
    });
    (ov.watch || []).forEach((r) => {
      const el = document.querySelector(`#view .list-item[data-m="${r.market}"][data-c="${r.code}"]`);
      if (!el) return;
      const px = el.querySelector('.px');
      if (px) { px.className = 'px ' + U.cls(r.pct); px.textContent = U.fmt(r.price); }
      const dt = el.querySelector('.dt');
      if (dt) { dt.className = 'dt ' + U.cls(r.pct); dt.textContent = U.pct(r.pct); }
    });
    const st = document.querySelector('#ovStamp');
    if (st) st.innerHTML = stampHtml();
  }

  /* ---------------- 雷达 ---------------- */
  async function renderRadar() {
    if (stale('radar')) return;
    view.innerHTML = `
      <h1 class="page-title">买卖点雷达 ${stampHtml()}</h1>
      <div class="page-sub">按「信号新鲜度 × 类型权重」排序，点击进入结构分析</div>
      <div class="section">
        <div class="seg segmented" id="rScope">
          ${[['all', '全部'], ['A', 'A股'], ['HK', '港股'], ['US', '美股'], ['CR', '加密']]
            .map(([k, n]) => `<button class="sq button ${state.radarScope === k ? 'active' : ''}" data-k="${k}">${n}</button>`)
            .join('')}
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h3>扫描结果</h3><button class="chip" id="rEdit">＋ 自选</button></div>
        <div id="rList" class="list"><div class="empty">扫描中…</div></div>
      </div>`;
    U.$$('#rScope .sq').forEach((b) =>
      b.addEventListener('click', () => {
        state.radarScope = b.dataset.k;
        renderRadar();
      })
    );
    const ed = $('#rEdit');
    if (ed) ed.addEventListener('click', openWatchlist);

    try {
      const res = await API.radar({ scope: state.radarScope, period: 'day', nocache: '1' });
      state.radarRows = res.rows;
      paintRadar(res.rows);
    } catch (e) {
      $('#rList').innerHTML = `<div class="empty">扫描失败：${U.esc(e.message)}</div>`;
    }
  }

  function paintRadar(rows) {
    const box = $('#rList');
    if (!box) return;
    // 已有的行顺序一致时，只更新数字，不重建 DOM（否则排序抖动会让用户点错标的）
    const existing = [...box.querySelectorAll('.list-item[data-c]')].map((el) => el.dataset.m + ':' + el.dataset.c);
    const incoming = rows.filter((r) => !r.error).map((r) => r.market + ':' + r.code);
    if (existing.length && existing.join() === incoming.join()) {
      rows.filter((r) => !r.error).forEach((r, i) => {
        const el = box.querySelectorAll('.list-item[data-c]')[i];
        const px = el.querySelector('.px');
        if (px && r.price != null) { px.className = 'px ' + U.cls(r.pct); px.textContent = U.fmt(r.price); }
        const dt = el.querySelector('.dt');
        if (dt) { dt.className = 'dt ' + U.cls(r.pct); dt.textContent = U.pct(r.pct); }
      });
      return;
    }
    if (!rows.length) {
      box.innerHTML = '<div class="empty">自选池为空，点右上「＋ 自选」添加</div>';
      return;
    }
    box.innerHTML = rows
      .map((r, i) => {
        if (r.error) return `<div class="list-item"><div class="mid"><div class="nm">${U.esc(r.name || r.code)}</div><div class="cd">数据获取失败</div></div></div>`;
        const s = r.last;
        const buy = s && s.type.endsWith('B');
        return `<div class="list-item" data-m="${r.market}" data-c="${r.code}">
        <span class="hint mono" style="width:16px">${i + 1}</span>
        <div class="mid">
          <div class="nm">${U.esc(r.name)} ${s ? `<span class="badge ${buy ? 'buy' : 'sell'}">${U.SIG_SHORT[s.type]}</span>` : ''}</div>
          <div class="cd">${U.MK[r.market]} · ${r.trend} · ${U.POS_TXT[r.position] || ''}</div>
        </div>
        <div><div class="px ${U.cls(r.pct)}">${U.fmt(r.price)}</div><div class="dt ${U.cls(r.pct)}">${U.pct(r.pct)}</div></div>
      </div>`;
      })
      .join('');
    U.$$('#rList .list-item[data-c]').forEach((el) => el.addEventListener('click', () => openStructure(el.dataset.m, el.dataset.c)));
  }

  /* ---------------- 结构分析 ---------------- */
  function openStructure(market, code) {
    state.market = market;
    state.symbol[market] = code;
    if (!PERIODS[market].includes(state.period)) state.period = 'day';
    go('structure');
  }

  async function renderStructure() {
    const market = state.market;
    const code = state.symbol[market];
    const periods = PERIODS[market];
    view.innerHTML = `
      <h1 class="page-title">结构分析 ${stampHtml()}</h1>
      <div class="page-sub">${U.MK[market]} · ${U.esc(code)} · ${PNAME[state.period]}</div>
      <div class="section">
        <div class="seg segmented" id="sMarket">
          ${['A', 'HK', 'US', 'CR'].map((m) => `<button class="sq button ${m === market ? 'active' : ''}" data-m="${m}">${U.MK[m]}</button>`).join('')}
          <button class="sq button" id="sSearch">搜索</button>
        </div>
      </div>
      <div class="section">
        <div class="seg segmented" id="sPeriod">
          ${periods.map((p) => `<button class="sq button ${p === state.period ? 'active' : ''}" data-p="${p}">${PNAME[p]}</button>`).join('')}
        </div>
      </div>
      <div class="card chart-card">
        <div class="chart-legend">
          <span><i style="background:var(--bi)"></i>笔</span>
          <span><i style="background:var(--seg)"></i>线段</span>
          <span><i style="background:var(--pivot-line)"></i>中枢</span>
          <span><i style="background:var(--candle-down)"></i>买点</span>
          <span><i style="background:var(--candle-up)"></i>卖点</span>
        </div>
        <div class="chart-wrap"><canvas id="mChart"></canvas><div class="crosshair-tip" id="mTip"></div></div>
        <div class="hint" style="padding:4px 2px 2px">单指拖动平移 · 双指捏合缩放</div>
      </div>
      <div class="section">
        <div class="section-head"><h3>教学标注</h3><span class="hint">在图上圈出对应结构</span></div>
        <div class="hscroll">
          ${HL_CHOICES.map(
            ([k, n]) => `<button class="chip ${(state.hl || '') === k ? 'gold' : ''}" data-hl="${k}" style="padding:6px 12px;font-size:12px">${n}</button>`
          ).join('')}
        </div>
      </div>
      <div id="teachBox"></div>
      <div class="section"><div class="section-head"><h3>结构状态</h3><span class="hint" id="sLevel"></span></div><div class="card kv" id="sState"><div class="empty">加载中…</div></div></div>
      <div class="section"><div class="section-head"><h3>信号</h3><span class="hint">近 160 根</span></div><div id="sSignals" class="list"><div class="empty">加载中…</div></div></div>
      <div class="section"><div class="section-head"><h3>信号历史表现</h3><span class="hint" id="mBtHint">回测中…</span></div><div id="mBt" class="card bt-body" style="font-size:12px">计算中…</div></div>`;

    U.$$('#sMarket .sq[data-m]').forEach((b) =>
      b.addEventListener('click', () => {
        state.market = b.dataset.m;
        renderStructure();
      })
    );
    const ss = $('#sSearch');
    if (ss) ss.addEventListener('click', openSearch);
    U.$$('#sPeriod .sq').forEach((b) =>
      b.addEventListener('click', () => {
        state.period = b.dataset.p;
        renderStructure();
      })
    );
    U.$$('#view .chip[data-hl]').forEach((b) =>
      b.addEventListener('click', () => {
        state.hl = b.dataset.hl || null;
        renderStructure();
      })
    );

    const cv = $('#mChart');
    if (state.chart) state.chart.destroy();
    state.chart = new ChanChart(cv, $('#mTip'));
    try {
      const res = await API.chan({ market, code, period: state.period, limit: 600 });
      if (!res.ok) {
        $('#sState').innerHTML = `<div class="empty">${U.esc(res.reason || '数据不足')}</div>`;
        return;
      }
      state.lastChan = res;
      state.chart.setData(res);
      paintStructure(res);
      loadMobileBacktest(market, code, state.period);
    } catch (e) {
      $('#sState').innerHTML = `<div class="empty">加载失败：${U.esc(e.message)}</div>`;
    }
  }

  async function loadMobileBacktest(market, code, period) {
    const box = $('#mBt');
    const hint = $('#mBtHint');
    if (!box) return;
    try {
      const bt = await API.backtest({ market, code, period, horizon: 5 });
      if (hint) hint.textContent = `后 ${bt.horizon} 根 · n=${bt.overall.n || 0}`;
      if (!bt.overall.n) {
        box.innerHTML = '<span class="hint">本级历史信号样本不足（需信号后已走完 5 根），暂不统计。</span>';
        return;
      }
      const rows = Object.entries(bt.byType)
        .sort((a, b) => b[1].n - a[1].n)
        .map(([t, v]) => `<tr><td style="font-family:inherit">${U.SIG_SHORT[t] || t}</td><td>${v.n}</td><td style="color:${v.winRate >= 0.5 ? 'var(--down-text)' : 'var(--up-text)'}">${(v.winRate * 100).toFixed(0)}%</td><td style="color:${v.avgRet >= 0 ? 'var(--down-text)' : 'var(--up-text)'}">${(v.avgRet * 100).toFixed(2)}%</td></tr>`)
        .join('');
      box.innerHTML = `<div>命中 <b style="color:${bt.overall.winRate >= 0.5 ? 'var(--down-text)' : 'var(--up-text)'}">${(bt.overall.winRate * 100).toFixed(1)}%</b>（n=${bt.overall.n}），均值 ${(bt.overall.avgRet * 100).toFixed(2)}%，超额 ${(bt.edge * 100).toFixed(2)}pp</div>
        <table class="bt-table" style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px"><thead><tr><th style="text-align:left;color:var(--faint)">信号</th><th style="text-align:left;color:var(--faint)">次数</th><th style="text-align:left;color:var(--faint)">命中</th><th style="text-align:left;color:var(--faint)">均值</th></tr></thead><tbody>${rows}</tbody></table>
        ${bt.overall.n < 10 ? '<div class="hint" style="color:var(--up-text);margin-top:6px">样本 <10，只能参考，不能当胜率承诺。</div>' : ''}`;
    } catch (e) {
      box.innerHTML = '<span class="hint">回测失败</span>';
      if (hint) hint.textContent = '失败';
    }
  }

  function paintStructure(res) {
    const st = res.stats;
    const q = res.quote || {};
    const pv = st.activePivot;
    const lv = $('#sLevel');
    if (lv) lv.textContent = res.level.levelName;
    $('#sState').innerHTML = `
      <div class="kv-row"><span class="k">现价</span><span class="v ${U.cls(q.pct)}">${U.fmt(st.price)}（${U.pct(q.pct)}）</span></div>
      <div class="kv-row"><span class="k">走势类型</span><span class="v">${res.trend.type}</span></div>
      <div class="kv-row"><span class="k">当前中枢</span><span class="v">${pv ? U.fmt(pv.zd) + ' ~ ' + U.fmt(pv.zg) + '（' + pv.count + '笔）' : '未形成'}</span></div>
      <div class="kv-row"><span class="k">现价位置</span><span class="v">${U.POS_TXT[st.position] || '—'}</span></div>
      <div class="kv-row"><span class="k">笔 / 线段 / 中枢</span><span class="v">${st.bis} / ${st.segments} / ${st.pivots}</span></div>
      <div class="kv-row"><span class="k">最近信号</span><span class="v">${st.lastSignal ? st.lastSignal.name + ' @ ' + U.fmt(st.lastSignal.price) : '近期无'}</span></div>
      <div class="kv-row"><span class="k">数据源</span><span class="v">${U.esc(res.source || '—')}</span></div>`;

    const list = res.signals.filter((s) => s.barIdx >= res.bars.length - 160).reverse().slice(0, 8);
    $('#sSignals').innerHTML = list.length
      ? list
          .map((s) => {
            const buy = s.type.endsWith('B');
            return `<div class="list-item">
          <span class="badge ${buy ? 'buy' : 'sell'}">${U.SIG_SHORT[s.type]}</span>
          <div class="mid"><div class="nm">${U.fmt(s.price)}</div><div class="cd">${U.esc(s.beichi || s.note || '')}</div></div>
          <div class="dt">${U.ts(s.t, res.period)}</div>
        </div>`;
          })
          .join('')
      : '<div class="empty">近 160 根内暂无买卖点</div>';

    applyTeach(res);
  }

  function applyTeach(res) {
    const box = $('#teachBox');
    if (!state.hl) {
      box.innerHTML = '';
      if (state.chart) state.chart.setHighlight(null);
      return;
    }
    const spec = window.CHAN_HL.buildHighlight(state.hl, res);
    if (!spec) {
      box.innerHTML = '';
      if (state.chart) state.chart.setHighlight(null);
      return;
    }
    if (state.chart) state.chart.setHighlight(spec.bands.length ? spec : null, { keepView: true });
    box.innerHTML = `<div class="card">
      <div class="row between" style="margin-bottom:6px"><h3 style="font-size:14px">${U.esc(spec.title)}</h3><span class="chip gold">教学标注</span></div>
      <ol class="teach-steps">${spec.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
    </div>`;
  }

  /* ---------------- 理论 ---------------- */
  function renderTheory() {
    const T = window.CHAN_THEORY || { concepts: [], questions: [], lessons: [], practices: [] };
    const tabs = [['concepts', '概念'], ['questions', '问缠'], ['lessons', '108课'], ['methods', '择时'], ['practices', '实战']];
    let body = '';
    if (state.theoryTab === 'concepts') {
      body = T.concepts
        .filter((c) => !state.theoryKw || JSON.stringify(c).includes(state.theoryKw))
        .map(
          (c, i) => `<div class="concept" data-type="c" data-i="${i}">
        <h4>${U.esc(c.name)} <span class="lv">${U.esc(c.level)}</span></h4>
        <div class="ol">${U.esc(c.oneLine)}</div>
      </div>`
        )
        .join('');
    } else if (state.theoryTab === 'questions') {
      body = T.questions
        .map((q, i) => `<div class="concept" data-type="q" data-i="${i}"><h4>${U.esc(q.q)}</h4><div class="ol">${U.esc(q.short)}</div></div>`)
        .join('');
    } else if (state.theoryTab === 'methods') {
      body = (T.timingMethods || [])
        .map(
          (m, i) => `<div class="concept" data-type="m" data-i="${i}">
        <h4>${U.esc(m.name)} <span class="lv">${U.esc(m.base)}</span></h4>
        <div class="ol">${U.esc(m.scoreLaw)}</div>
      </div>`
        )
        .join('');
    } else if (state.theoryTab === 'lessons') {
      body = T.lessons
        .map(
          (l, i) => `<div class="concept" data-type="l" data-i="${i}"><h4>${U.esc(l.range)} ${U.esc(l.theme)}</h4><div class="ol">${U.esc((l.points || [])[0] || '')}…</div></div>`
        )
        .join('');
    } else {
      body = T.practices
        .map((p, i) => `<div class="concept" data-type="p" data-i="${i}"><h4>${i + 1}. ${U.esc(p.title)}</h4><div class="ol">${U.esc((p.steps || [])[0] || '')}</div></div>`)
        .join('');
    }
    view.innerHTML = `
      <h1 class="page-title">缠论理论</h1>
      <div class="page-sub">点开任意条目看完整内容，可一键在图上标注</div>
      <div class="theory-tabs">${tabs.map(([k, n]) => `<button class="sq button ${state.theoryTab === k ? 'active' : ''}" data-t="${k}">${n}</button>`).join('')}</div>
      <div style="margin-top:6px">${body}</div>`;
    U.$$('.theory-tabs .sq').forEach((b) =>
      b.addEventListener('click', () => {
        state.theoryTab = b.dataset.t;
        renderTheory();
      })
    );
    U.$$('#view .concept[data-type]').forEach((el) =>
      el.addEventListener('click', () => openTheory(el.dataset.type, Number(el.dataset.i)))
    );
  }

  function openTheory(type, i) {
    const T = window.CHAN_THEORY;
    if (!T) return;
    let html = '';
    if (type === 'c') {
      const c = T.concepts[i];
      const key = c.id;
      html = `<div class="md-lead">${U.esc(c.oneLine)}</div>
      <div class="md-sec"><h4>操作化定义</h4><p>${U.esc(c.definition)}</p></div>
      <div class="md-sec"><h4>原文要义</h4><p>${U.esc(c.original)}</p></div>
      <div class="md-sec"><h4>识别步骤</h4><ol class="md-steps">${(c.howTo || []).map((x) => `<li>${U.esc(x)}</li>`).join('')}</ol></div>
      <div class="md-sec"><h4>常见误区</h4><ol class="md-steps">${(c.mistakes || []).map((x) => `<li>${U.esc(x)}</li>`).join('')}</ol></div>
      <div class="md-sec"><h4>在图上对应</h4><p>${U.esc(c.station)}</p></div>
      <button class="btn button primary block" id="goChart" data-hl="${U.esc(key)}">在结构图上标注它 →</button>`;
      openSheet(c.name, html, () => {
        const b = $('#goChart');
        if (b) b.addEventListener('click', () => {
          state.hl = b.dataset.hl;
          closeSheet();
          go('structure');
        });
      });
    } else if (type === 'q') {
      const q = T.questions[i];
      html = `<div class="md-lead">${U.esc(q.short)}</div>
      <div class="md-sec"><h4>在图上怎么找</h4><p>${U.esc(q.answer)}</p></div>
      <div class="md-sec"><h4>操作步骤</h4><ol class="md-steps">${(q.steps || []).map((s) => `<li>${U.esc(s)}</li>`).join('')}</ol></div>
      ${q.pitfalls ? `<div class="md-pit">易错：${U.esc(q.pitfalls)}</div>` : ''}`;
      openSheet(q.q, html);
    } else if (type === 'm') {
      const m = (T.timingMethods || [])[i];
      if (!m) return;
      html = `<div class="md-lead">${U.esc(m.scoreLaw)}</div>
        <div class="md-sec"><h4>优势</h4><ol class="md-steps">${(m.strengths || []).map((x) => `<li>${U.esc(x)}</li>`).join('')}</ol></div>
        ${(m.weaknesses || []).length ? `<div class="md-pit">局限：${m.weaknesses.map(U.esc).join('；')}</div>` : ''}
        ${m.honest ? `<div class="md-pit" style="margin-top:10px">${U.esc(m.honest)}</div>` : ''}`;
      openSheet(m.name, html);
    } else if (type === 'l') {
      const l = T.lessons[i];
      html = `<div class="md-sec"><h4>${U.esc(l.range)}</h4><ol class="md-steps">${(l.points || []).map((p) => `<li>${U.esc(p)}</li>`).join('')}</ol></div>`;
      openSheet(l.theme, html);
    } else {
      const p = T.practices[i];
      html = `<ol class="md-steps">${(p.steps || []).map((s) => `<li>${U.esc(s)}</li>`).join('')}</ol>
      ${p.risk ? `<div class="md-pit" style="margin-top:10px">风险点：${U.esc(p.risk)}</div>` : ''}`;
      openSheet(p.title, html);
    }
  }

  /* ---------------- 算卦 ---------------- */
  function renderDivination() {
    if (stale('divination')) return;
    const d = state.div;
    view.innerHTML = `
      <h1 class="page-title">算卦择时</h1>
      <div class="page-sub">代码 + 实时价 + 时辰起卦；娱乐向，不构成投资建议</div>
      <div class="card">
        <div class="form-row"><div class="hint" style="margin-bottom:6px">市场</div>
          <div class="seg segmented" id="dMarket">${['A', 'HK', 'US', 'CR'].map((m) => `<button class="sq button ${d.market === m ? 'active' : ''}" data-m="${m}">${U.MK[m]}</button>`).join('')}</div>
        </div>
        <div class="form-row" style="margin-top:10px"><div class="hint" style="margin-bottom:6px">标的代码</div><input class="input" id="dCode" value="${U.esc(d.code)}" placeholder="600519 / NVDA / BTCUSDT" autocomplete="off"></div>
        <div class="form-row" style="margin-top:10px"><div class="hint" style="margin-bottom:6px">起卦方式</div>
          <div class="seg segmented" id="dMode">
            <button class="sq button ${d.mode === 'price' ? 'active' : ''}" data-k="price">随市（+现价）</button>
            <button class="sq button ${d.mode === 'time' ? 'active' : ''}" data-k="time">时辰（稳定）</button>
          </div>
        </div>
        <div class="row" style="gap:8px;margin-top:12px">
          <button class="btn button primary" id="dCast" style="flex:1">起 卦</button>
          <button class="btn button ${d.live ? 'primary' : ''}" id="dLive" style="flex:0 0 auto">${d.live ? '跟随中' : '跟随'}</button>
        </div>
      </div>
      <div id="dResult">${state.div.last ? '' : '<div class="card empty">点上面的「起卦」开始</div>'}</div>
      <div class="card" id="dTiming"><div class="empty">择时方法计算中…</div></div>`;

    U.$$('#dMarket .sq').forEach((b) =>
      b.addEventListener('click', () => {
        d.market = b.dataset.m;
        d.code = { A: '600519', HK: '00700', US: 'NVDA', CR: 'BTCUSDT' }[b.dataset.m];
        d.nonce = 0;
        $('#dCode').value = d.code;
        U.$$('#dMarket .sq').forEach((x) => x.classList.toggle('active', x === b));
      })
    );
    U.$$('#dMode .sq').forEach((b) =>
      b.addEventListener('click', () => {
        d.mode = b.dataset.k;
        U.$$('#dMode .sq').forEach((x) => x.classList.toggle('active', x === b));
        castDiv(true);
      })
    );
    const inp = $('#dCode');
    inp.addEventListener('input', () => (d.code = inp.value.trim()));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') castDiv(true);
    });
    $('#dCast').addEventListener('click', () => castDiv(true));
    $('#dLive').addEventListener('click', () => {
      d.live = !d.live;
      $('#dLive').classList.toggle('primary', d.live);
      $('#dLive').textContent = d.live ? '跟随中' : '跟随';
      clearInterval(d.timer);
      if (d.live) {
        castDiv(false);
        d.timer = setInterval(() => castDiv(false), 12000);
      }
      toast(d.live ? '已开启 12 秒跟随' : '已关闭跟随');
    });
    if (state.div.last) paintDiv(state.div.last);
    else castDiv(false);
    loadMobileTiming();
  }

  async function loadMobileTiming() {
    const box = $('#dTiming');
    if (!box) return;
    try {
      const res = await API.timing({ market: state.div.market, code: state.div.code });
      const c = res.composite;
      const color = c >= 58 ? 'var(--down-text)' : c <= 42 ? 'var(--up-text)' : 'var(--gold)';
      const rows = Object.values(res.methods)
        .map((m) => `<div class="tm-row"><span class="nm">${U.esc(m.name)}</span><span class="sc" style="color:${m.score >= 58 ? 'var(--down-text)' : m.score <= 42 ? 'var(--up-text)' : 'var(--gold)'}">${m.score}</span><span class="chip">${U.esc(m.label)}</span></div>`)
        .join('');
      box.innerHTML = `
        <div class="card-head"><h3>择时方法实验室</h3><span class="hint">一致性 ${(res.agreement * 100).toFixed(0)}%</span></div>
        <div class="row between" style="margin-bottom:6px"><span class="hint">加权综合分</span><span style="font-size:22px;font-weight:800;color:${color}">${c.toFixed(1)}</span></div>
        ${rows}
        <div class="hint" style="margin-top:8px">${U.esc(res.verdict.text)}</div>
        <div class="hint" style="margin-top:6px">${U.esc(res.disclaimer)}</div>`;
    } catch (e) {
      box.innerHTML = '<div class="hint">择时计算失败</div>';
    }
  }

  async function castDiv(advance) {
    const d = state.div;
    if (advance) d.nonce += 1;
    const btn = $('#dCast');
    if (btn) btn.textContent = '起卦中…';
    try {
      const res = await API.divination({ market: d.market, code: d.code, mode: d.mode, nonce: d.nonce });
      d.last = res;
      paintDiv(res);
    } catch (e) {
      toast('起卦失败：' + e.message);
    } finally {
      if (btn) btn.textContent = '起 卦';
    }
  }

  function paintDiv(res) {
    const h = res.hexagram;
    const q = res.quote || {};
    const score = Math.max(0, Math.min(100, h.score || 0));
    const lines = h.lines
      .map((v, i) => {
        const pos = i + 1;
        return `<div class="${v === 1 ? 'line' : 'line yin'} ${pos === h.dong ? 'dong' : ''}"></div>`;
      })
      .reverse()
      .join('');
    const yaos = res.liuyao.yaos
      .map(
        (y) => `<tr class="${y.dong ? 'dong' : ''} ${y.kong ? 'kong' : ''}">
        <td>${y.pos}</td><td>${y.liushen}</td><td>${y.liuqin}</td><td>${U.esc(y.zhi + y.element)}</td>
        <td>${y.yin}${y.dong ? '●' : ''}</td><td style="color:var(--gold)">${y.shi ? '世' : y.ying ? '应' : ''}</td><td>${y.kong ? '空' : ''}</td>
      </tr>`
      )
      .join('');
    const sc = res.shichen
      .map((s) => `<div class="sc ${s.active ? 'now' : ''}"><div class="hint">${s.name}</div><div class="j" style="color:${s.label === '吉' ? 'var(--down-text)' : s.label === '凶' ? 'var(--up-text)' : 'var(--faint)'}">${s.label}</div></div>`)
      .join('');
    const basis = (res.seed && res.seed.parts ? res.seed.parts : [])
      .slice(0, 4)
      .map((p) => `<span class="chip">${U.esc(p.label)} ${U.esc(String(p.value))}</span>`)
      .join('');
    $('#dResult').innerHTML = `
      <div class="card">
        <div class="hex-head">
          <div class="hex-sym">${lines}</div>
          <div style="flex:1;min-width:0">
            <div class="hex-name">${U.esc(h.ben.name)}</div>
            <div class="hex-meta">第 ${h.ben.id} 卦 · 第 ${res.seed ? res.seed.nonce + 1 : 1} 占 · 动爻第 ${h.dong} 爻</div>
            <div class="hex-meta ${U.cls(q.pct)}">现价 ${q.price != null ? U.fmt(q.price) : '—'} ${q.price != null ? U.pct(q.pct) : ''} · ${U.MK[res.target.market] || ''} ${U.esc(res.target.symbol || '')}</div>
            <div class="row between" style="margin-top:6px"><span class="hint">体用生克</span><span style="font-weight:700" class="${score >= 60 ? 'up' : score <= 40 ? 'down' : ''}">${score}</span></div>
            <div class="meter"><i style="width:${score}%"></i></div>
            <div class="hint" style="margin-top:4px">${U.esc(h.relation.text)} · ${U.esc(h.relation.level)}</div>
          </div>
        </div>
        <div class="row" style="gap:8px;margin-top:12px">
          <div class="card" style="flex:1;margin:0;padding:9px"><div class="hint">本卦</div><div style="font-family:'Songti SC',serif;font-size:14px" class="gold">${U.esc(h.ben.name)}</div></div>
          <div class="card" style="flex:1;margin:0;padding:9px"><div class="hint">互卦</div><div style="font-family:'Songti SC',serif;font-size:14px" class="gold">${U.esc(h.hu.name)}</div></div>
          <div class="card" style="flex:1;margin:0;padding:9px"><div class="hint">变卦</div><div style="font-family:'Songti SC',serif;font-size:14px" class="gold">${U.esc(h.bian.name)}</div></div>
        </div>
        <div class="hint" style="margin-top:10px;line-height:1.8">卦辞：${U.esc(h.ben.guaCi)}<br>象曰：${U.esc(h.ben.baiHua)}</div>
      </div>
      <div class="card">
        <div class="section-head"><h3>六爻排盘</h3><span class="hint">${U.esc(res.liuyao.palace)}宫 · 世${res.liuyao.shi}应${res.liuyao.ying}</span></div>
        <table class="yao"><thead><tr><th>爻</th><th>六神</th><th>六亲</th><th>纳甲</th><th>阴阳</th><th>世应</th><th>空</th></tr></thead><tbody>${yaos}</tbody></table>
      </div>
      <div class="card">
        <div class="section-head"><h3>十二时辰</h3><span class="hint">当前高亮</span></div>
        <div class="sc-grid">${sc}</div>
      </div>
      <div class="card">
        <div class="section-head"><h3>取数依据</h3><span class="hint">${U.esc(res.methodLabel || '')}</span></div>
        <div class="row" style="flex-wrap:wrap;gap:6px">${basis}</div>
        <div class="hint" style="margin-top:8px">${U.esc(res.basisText || '')}</div>
      </div>
      <div class="card">
        <div class="section-head"><h3>卦象解读</h3></div>
        ${res.narrative.map((p) => `<p style="font-size:12.5px;line-height:1.9;color:var(--muted);margin-bottom:8px">${U.esc(p)}</p>`).join('')}
        <div class="hint">${U.esc(res.disclaimer)}</div>
      </div>`;
  }

  /* ---------------- 弹层 ---------------- */
  function openSheet(title, html, after) {
    const mask = $('#sheetMask');
    const sheet = $('#sheet');
    sheet.innerHTML = `<div class="sheet-head"><h3>${U.esc(title)}</h3><button class="sheet-close" id="sheetClose" aria-label="关闭"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>${html}`;
    mask.classList.add('show');
    document.documentElement.classList.add('sheet-open');
    const close = () => closeSheet();
    $('#sheetClose').addEventListener('click', close);
    mask.onclick = (e) => {
      if (e.target === mask) close();
    };
    if (after) after();
  }
  function closeSheet() {
    $('#sheetMask').classList.remove('show');
    document.documentElement.classList.remove('sheet-open');
  }

  async function openSearch() {
    openSheet(
      '切换标的',
      `<div class="form-row"><input class="input" id="qInput" placeholder="代码 / 名称：茅台、NVDA、00700、BTC" autocomplete="off"></div>
       <div id="qList" class="list"><div class="empty">输入关键字开始搜索</div></div>`,
      () => {
        const inp = $('#qInput');
        const list = $('#qList');
        const run = U.debounce(async () => {
          const q = inp.value.trim();
          if (q.length < 1) return;
          try {
            const r = await API.search(q);
            list.innerHTML = r.items.length
              ? r.items
                  .map(
                    (it) => `<div class="list-item" data-m="${it.market}" data-c="${it.code}">
                <span class="chip">${U.MK[it.market]}</span>
                <div class="mid"><div class="nm">${U.esc(it.name)}</div><div class="cd">${U.esc(it.code)}</div></div>
              </div>`
                  )
                  .join('')
              : '<div class="empty">没有匹配结果</div>';
            U.$$('#qList .list-item[data-c]').forEach((el) =>
              el.addEventListener('click', () => {
                closeSheet();
                openStructure(el.dataset.m, el.dataset.c);
              })
            );
          } catch (e) {
            list.innerHTML = `<div class="empty">搜索失败：${U.esc(e.message)}</div>`;
          }
        }, 250);
        inp.addEventListener('input', run);
        inp.focus();
      }
    );
  }

  async function openWatchlist() {
    const SK = { market: state.market };
    const render = async () => {
      let data;
      try {
        data = (await API.watchlist()).list;
      } catch (e) {
        toast('读取自选池失败');
        return;
      }
      const list = data[SK.market] || [];
      openSheet(
        '管理自选',
        `<div class="seg segmented" id="wMarket">${['A', 'HK', 'US', 'CR'].map((m) => `<button class="sq button ${m === SK.market ? 'active' : ''}" data-m="${m}">${U.MK[m]} ${data[m].length}</button>`).join('')}</div>
         <div class="form-row" style="margin-top:12px"><input class="input" id="wCode" placeholder="输入代码，如 600519 / NVDA / BTCUSDT"></div>
         <button class="btn button primary block" id="wAdd">添加</button>
         <div class="list" style="margin-top:12px">
           ${list.length
             ? list
                 .map(
                   (it) => `<div class="list-item"><div class="mid"><div class="nm">${U.esc(it.name)}</div><div class="cd">${U.esc(it.code)}</div></div><button class="chip red" data-del="${U.esc(it.code)}">删除</button></div>`
                 )
                 .join('')
             : '<div class="empty">该市场暂无自选</div>'}
         </div>
         <button class="btn button block" id="wReset" style="margin-top:10px">恢复默认自选池</button>`,
        () => {
          U.$$('#wMarket .sq').forEach((b) =>
            b.addEventListener('click', () => {
              SK.market = b.dataset.m;
              render();
            })
          );
          U.$$('#sheet [data-del]').forEach((b) =>
            b.addEventListener('click', async () => {
              try {
                await API.watchDel({ market: SK.market, code: b.dataset.del });
                render();
                toast('已删除');
              } catch (e) {
                toast('删除失败');
              }
            })
          );
          $('#wAdd').addEventListener('click', async () => {
            const code = ($('#wCode').value || '').trim();
            if (!code) return toast('请输入代码');
            try {
              const r = await API.watchAdd({ market: SK.market, code });
              toast('已添加 ' + (r.added.name || r.added.code));
              render();
            } catch (e) {
              toast(e.message);
            }
          });
          $('#wReset').addEventListener('click', async () => {
            if (!confirm('恢复默认自选池？')) return;
            try {
              await API.watchReset();
              toast('已恢复默认');
              render();
            } catch (e) {
              toast('恢复失败');
            }
          });
        }
      );
    };
    await render();
  }

  async function openMore() {
    const skin = document.documentElement.dataset.skin;
    const theme = document.documentElement.dataset.theme;
    openSheet(
      '更多设置',
      `<div class="section-head"><h3>界面皮肤</h3></div>
       <div class="seg segmented" id="mSkin"><button class="sq button ${skin === 'ios' ? 'active' : ''}" data-k="ios">iOS 风格</button><button class="sq button ${skin === 'android' ? 'active' : ''}" data-k="android">Android 风格</button></div>
       <div class="section-head" style="margin-top:14px"><h3>主题</h3></div>
       <div class="seg segmented" id="mTheme"><button class="sq button ${theme === 'dark' ? 'active' : ''}" data-k="dark">深色</button><button class="sq button ${theme === 'light' ? 'active' : ''}" data-k="light">浅色</button></div>
       <div class="section-head" style="margin-top:14px"><h3>实时刷新</h3></div>
       <div class="seg segmented" id="mLive"><button class="sq button ${state.live ? 'active' : ''}" data-k="on">开启（10s）</button><button class="sq button ${!state.live ? 'active' : ''}" data-k="off">关闭</button></div>
       <div class="section-head" style="margin-top:14px"><h3>数据源</h3></div>
       <div id="mSources" class="hint">检测中…</div>
       <div class="section-head" style="margin-top:14px"><h3>版本</h3></div>
       <div class="row between" style="gap:8px">
         <span class="hint" id="mVer">手机版 ${BUILD} · 资源 ${(window.__ASSET_V__ || 'dev')}</span>
         <button class="btn button sm" id="mReload">强制刷新</button>
       </div>
       <div class="hint" style="margin-top:16px;line-height:1.8">缠论工作站 · 手机版 ${BUILD}<br>PC 版：<a href="/?desktop=1" style="color:var(--accent)">/?desktop=1</a> · iOS 皮肤 <a href="?skin=ios" style="color:var(--accent)">?skin=ios</a> · Android 皮肤 <a href="?skin=android" style="color:var(--accent)">?skin=android</a></div>`,
      () => {
        const rb = $('#mReload');
        if (rb) rb.addEventListener('click', async () => {
          try {
            const regs = await navigator.serviceWorker?.getRegistrations?.();
            if (regs) await Promise.all(regs.map((r) => r.unregister()));
            if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
          } catch (e) {}
          location.reload();
        });
        U.$$('#mSkin .sq').forEach((b) =>
          b.addEventListener('click', () => {
            document.documentElement.dataset.skin = b.dataset.k;
            localStorage.setItem('chan-skin', b.dataset.k);
            U.$$('#mSkin .sq').forEach((x) => x.classList.toggle('active', x === b));
            toast('已切换为 ' + (b.dataset.k === 'ios' ? 'iOS' : 'Android') + ' 风格');
          })
        );
        U.$$('#mTheme .sq').forEach((b) =>
          b.addEventListener('click', () => {
            document.documentElement.dataset.theme = b.dataset.k;
            localStorage.setItem('chan-theme', b.dataset.k);
            document.querySelector('meta[name="theme-color"]').setAttribute('content', b.dataset.k === 'light' ? '#f2f5f9' : '#0a0d13');
            U.$$('#mTheme .sq').forEach((x) => x.classList.toggle('active', x === b));
          })
        );
        U.$$('#mLive .sq').forEach((b) =>
          b.addEventListener('click', () => {
            setLive(b.dataset.k === 'on');
            U.$$('#mLive .sq').forEach((x) => x.classList.toggle('active', x === b));
          })
        );
        API.sources()
          .then((r) => {
            const box = $('#mSources');
            if (box)
              box.innerHTML = r.sources
                .map((s) => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${U.esc(s.name)}</span><span style="color:${s.ok ? 'var(--down-text)' : 'var(--up-text)'}">${s.ok ? s.ms + 'ms' : '不可用'}</span></div>`)
                .join('');
          })
          .catch(() => {
            const box = $('#mSources');
            if (box) box.textContent = '探测失败';
          });
      }
    );
  }

  /* ---------------- 实时 ---------------- */
  function setLive(on) {
    state.live = on;
    localStorage.setItem('chan-live', on ? '1' : '0');
    clearInterval(state.timer);
    state.timer = null;
    if (on) {
      state.timer = setInterval(async () => {
        state.tickN++;
        try {
          if (document.querySelector('.sheet-mask.show')) return; // 弹层打开时不刷，免得打断输入
          if (state.tab === 'overview') {
            const ov = await API.overview();
            patchOverview(ov);
          }
          else if (state.tab === 'structure' && state.tickN % 2 === 0 && state.lastChan) {
            const res = await API.chan({ market: state.market, code: state.symbol[state.market], period: state.period, limit: 600 });
            if (res.ok) {
              state.lastChan = res;
              if (state.chart) state.chart.setData(res, { keepView: true });
              paintStructure(res);
            }
          } else if (state.tab === 'radar' && state.tickN % 3 === 0) {
            const res = await API.radar({ scope: state.radarScope, period: 'day', nocache: '1' });
            paintRadar(res.rows);
          }
        } catch (e) {}
      }, 10000);
      toast('已开启实时刷新');
    } else {
      toast('已关闭实时刷新');
    }
  }

  /* 有新版本部署时提示（不打断当前操作） */
  function watchUpdate() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const t = document.getElementById('toast');
      if (t && !t._updateShown) {
        t._updateShown = true;
        toast('已更新到新版本，可下拉刷新');
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    U.$$('#tabbar .tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
    const sb = $('#searchBtn');
    if (sb) sb.addEventListener('click', openSearch);
    const mb = $('#moreBtn');
    if (mb) mb.addEventListener('click', openMore);
    const qp = new URLSearchParams(location.search);
    const t = qp.get('tab');
    if (qp.get('hl')) state.hl = qp.get('hl');
    if (state.live) setLive(true);
    go(t || 'overview', { silent: true });
    // 深链：?sheet=more|search|watch|theory （便于分享/调试）
    const sh = qp.get('sheet');
    if (sh) setTimeout(() => {
      if (sh === 'more') openMore();
      else if (sh === 'search') openSearch();
      else if (sh === 'watch') openWatchlist();
      else if (sh === 'theory') openTheory('c', 0);
    }, 700);
    watchUpdate();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/m/sw.js?v=' + (window.__ASSET_V__ || 'dev'), { scope: '/m/' }).catch(() => {});
    }
  }
  /* 安卓返回键 / iOS 手势返回：先关弹层，再回上一个 Tab，最后才退出 */
  window.addEventListener('popstate', (e) => {
    if (document.documentElement.classList.contains('sheet-open')) {
      closeSheet();
      history.pushState(e.state || {}, '', location.href);
      return;
    }
    const t = (e.state && e.state.tab) || new URLSearchParams(location.search).get('tab') || 'overview';
    if (t !== state.tab) go(t, { silent: true });
  });

  /* 全局兜底：任何未捕获异常都给出可见提示，而不是白屏 */
  window.addEventListener('error', (e) => {
    if (e && e.message && /Script error/.test(e.message)) return;
    const v = document.getElementById('view');
    if (v && !v.children.length) v.innerHTML = '<div class="card empty">页面出错了：' + (e.message || '未知错误') + '<br><button class="btn sm" onclick="location.reload()" style="margin-top:10px">重新加载</button></div>';
  });
  window.addEventListener('unhandledrejection', () => {});

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
