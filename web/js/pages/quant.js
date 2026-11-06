/* 量化组合 · 绩效归因页 */
(function () {
  'use strict';
  const { U, API } = window;
  let lastResult = null;

  /*
    27 项指标分组展示。
    wbt 的口径是"组合层绩效归因"，所以按语义分成 6 组，而不是平铺：
    收益 / 风险调整 / 回撤 / 波动 / 交易行为 / 胜率分布
    这样一眼能看出"这个策略强在收益还是强在控回撤"。
  */
  const GROUPS = [
    {
      title: '收益', hint: '赚了多少',
      items: [['绝对收益', '%', 1], ['年化收益', '%', 1]],
    },
    {
      title: '风险调整', hint: '性价比',
      items: [['夏普比率', '', 1], ['卡玛比率', '', 1]],
    },
    {
      title: '回撤与新高', hint: '抗压能力',
      items: [['最大回撤', '%', -1], ['新高占比', '%', 1], ['新高间隔', '日', -1]],
    },
    {
      title: '波动', hint: '净值抖动',
      items: [['年化波动率', '%', -1], ['下行波动率', '%', -1]],
    },
    {
      title: '交易行为', hint: '怎么做的',
      items: [['交易次数', '次', 0], ['年化交易次数', '次/年', 0], ['持仓K线数', '根', 1]],
    },
    {
      title: '单笔与胜率', hint: '每笔质量',
      items: [['交易胜率', '%', 1], ['单笔盈亏比', '', 1], ['单笔收益(BP)', 'BP', 1]],
    },
    {
      title: '周期胜率', hint: '各周期为正的比例',
      items: [['日胜率', '%', 1], ['周胜率', '%', 1], ['月胜率', '%', 1], ['季胜率', '%', 1], ['年胜率', '%', 1]],
    },
    {
      title: '持仓方向', hint: '多空分布',
      items: [['多头占比', '%', 0], ['空头占比', '%', 0]],
    },
    {
      title: '回测范围', hint: '数据区间',
      items: [['开始日期', 'date', 0], ['结束日期', 'date', 0], ['品种数量', '个', 0]],
    },
  ];

  /* 越小越好的指标的分档阈值（低于 good=绿，高于 bad=红，之间中性） */
  const INV_GOOD = { 最大回撤: 15, 年化波动率: 15, 下行波动率: 10, 新高间隔: 60 };
  const INV_BAD = { 最大回撤: 30, 年化波动率: 30, 下行波动率: 20, 新高间隔: 120 };

  let picker = null;
  let scoringPreset = 'balanced';   // 评分权重预设

  const p = () => ({
    markets: U.$('#qMarkets')?.value || 'A',
    maxSymbols: Number(U.$('#qMax')?.value || 12),
    period: U.$('#qPeriod')?.value || 'day',
    biStyle: U.$('#qBiStyle')?.value || 'new',
    maxWeightPerSymbol: U.$('#qMaxW')?.value || '1',
    feeBps: Number(U.$('#qFee')?.value || 8),
    slipBps: Number(U.$('#qSlip')?.value || 4),
    symbols: (U.$('#qSymbols')?.value || '').trim(),
  });

  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  function fmtVal(m, unit) {
    if (m == null) return '—';
    if (unit === 'date') {
      const d = new Date(Number(m));
      return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '—';
    }
    if (typeof m === 'number') {
      if (unit === '日' || unit === '次' || unit === '次/年' || unit === '根' || unit === '个') return String(Math.round(m));
      return (Math.abs(m) >= 100 ? m.toFixed(1) : m.toFixed(2)) + (unit || '');
    }
    return String(m);
  }

  function renderMetrics(metrics, inverted) {
    const box = U.$('#qMetrics');
    if (!box) return;
    const inv = new Set(inverted || []);
    box.innerHTML = GROUPS.map((g) => {
      const cells = g.items.map(([name, unit, dir]) => {
        const v = metrics[name];
        /*
          好坏色与涨跌色解耦：A 股配色 --up 是红、--down 是绿，
          直接用会语义混乱（回撤大反而绿）。用 q-good / q-bad。
        */
        let cls = '';
        if (typeof v === 'number' && dir !== 0 && !['多头占比', '空头占比', '品种数量', '交易次数', '持仓K线数', '年化交易次数'].includes(name)) {
          if (inv.has(name)) {
            // 越小越好的指标（回撤/波动/新高间隔）：0 最好，越大越差——不能简单用正负判断
            cls = v <= INV_GOOD[name] ? 'q-good' : v >= INV_BAD[name] ? 'q-bad' : 'q-neutral';
          } else {
            cls = v > 0 ? 'q-good' : 'q-bad';
          }
        }
        return `<div class="q-cell"><div class="q-k">${U.esc(name)}</div><div class="q-v ${cls}">${fmtVal(v, unit)}</div></div>`;
      }).join('');
      return `<div class="q-group"><div class="q-gt">${U.esc(g.title)}<span>${U.esc(g.hint)}</span></div><div class="q-cells">${cells}</div></div>`;
    }).join('');
  }

  function renderGlossary() {
    U.$('#qGlossary').innerHTML = [
      ['年化', '按 252 个交易日折算（不是 365 日历天）'],
      ['卡玛比率', '年化收益 ÷ |最大回撤|'],
      ['单笔收益', '单位 BP（万分之一），不是 %'],
      ['新高间隔', '两次净值新高之间的最大交易日数'],
      ['交易次数', '品种权重发生变化的次数（按品种分别计）'],
      ['组合收益', 'Σ(品种日收益 × 权重) ÷ Σ|权重|，避免少数品种自动放大仓位'],
    ].map(([k, v]) => `<div class="q-gloss-row"><b>${U.esc(k)}</b><span>${U.esc(v)}</span></div>`).join('');
  }

  function drawCurve(daily) {
    const cv = U.$('#qCurve');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 600, h = cv.clientHeight || 220;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!daily || !daily.length) {
      g.fillStyle = 'rgba(150,160,180,.5)';
      g.font = '12px system-ui,sans-serif';
      g.fillText('跑组合回测后显示', 12, h / 2);
      return;
    }
    const nav = [];
    let v = 1;
    for (const d of daily) { v *= (1 + d.ret); nav.push(v); }
    const min = Math.min(...nav), max = Math.max(...nav);
    const pad = 26, iw = w - pad * 2, ih = h - pad * 1.6;
    const x = (i) => pad + (i / (nav.length - 1 || 1)) * iw;
    const y = (val) => pad + (1 - (val - min) / (max - min || 1)) * ih;
    g.strokeStyle = 'rgba(150,160,180,.25)';
    g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(pad, y(1)); g.lineTo(w - pad, y(1)); g.stroke();
    g.setLineDash([]);
    const up = nav[nav.length - 1] >= 1;
    g.strokeStyle = up ? '#22b884' : '#f0544f';
    g.lineWidth = 1.6;
    g.beginPath();
    nav.forEach((val, i) => (i ? g.lineTo(x(i), y(val)) : g.moveTo(x(i), y(val))));
    g.stroke();
    g.lineTo(x(nav.length - 1), h - pad * 0.6);
    g.lineTo(x(0), h - pad * 0.6);
    g.closePath();
    g.fillStyle = up ? 'rgba(34,184,132,.12)' : 'rgba(240,84,79,.12)';
    g.fill();
    g.fillStyle = 'rgba(150,160,180,.8)';
    g.font = '10.5px system-ui,sans-serif';
    g.fillText(max.toFixed(2), 4, pad - 6);
    g.fillText(min.toFixed(2), 4, h - 8);
    U.$('#qCurveHint').textContent = `期末净值 ${nav[nav.length - 1].toFixed(3)} · ${daily.length} 个交易日`;
  }

  /* ---------- ③ 品种贡献排行条 ---------- */
  function renderBySymbol(list) {
    const box = U.$('#qBySymbol');
    if (!box) return;
    if (!list || !list.length) { box.innerHTML = '<div class="empty">无数据</div>'; return; }
    const maxAbs = Math.max(...list.map((x) => Math.abs(x.totalPct)), 1);
    box.innerHTML = `<div class="q-rank">${list.map((x, i) => {
      const up = x.totalPct > 0;
      const w = Math.max(2, Math.abs(x.totalPct) / maxAbs * 100);
      const name = x.name && x.name !== x.code ? x.name : x.symbol;
      const cd = x.name && x.name !== x.code ? x.code : '';
      return `<div class="r">
        <span class="idx">${i + 1}</span>
        <span class="nm">${U.esc(name)}${cd ? `<span class="cd">${U.esc(cd)}</span>` : ''}</span>
        <span class="track"><i style="width:${w.toFixed(1)}%;background:${up ? '#22b884' : '#f0544f'}"></i></span>
        <span class="val ${up ? 'q-good' : 'q-bad'}">${up ? '+' : ''}${x.totalPct}%</span>
      </div>`;
    }).join('')}</div>`;
    U.$('#qByHint').textContent = `${list.length} 个品种 · 按合计收益排序 · 绿色贡献、红色拖累`;
  }

  /* ---------- ① 评分仪表盘 + ② 大数字卡（共享组件 ScoreWidget） ---------- */
  function renderScore(score) {
    window.ScoreWidget.render(U.$('#qScore'), score, {
      onPreset: (pr) => { scoringPreset = pr; run(); },
    });
  }

  function renderHero(m, daily) {
    const nav = window.ScoreWidget.navSeries(daily);
    const cUp = '#22b884', cDn = '#f0544f';
    window.ScoreWidget.hero(U.$('#qHero'), [
      { k: '年化收益', v: (m.年化收益 > 0 ? '+' : '') + m.年化收益 + '%', d: `绝对 ${m.绝对收益}%`, good: m.年化收益 > 0, spark: nav, sc: m.年化收益 > 0 ? cUp : cDn },
      { k: '夏普比率', v: m.夏普比率, d: `卡玛 ${m.卡玛比率 ?? '—'}`, good: m.夏普比率 > 0, spark: nav, sc: m.夏普比率 > 0 ? cUp : cDn },
      { k: '最大回撤', v: m.最大回撤 + '%', d: `新高间隔 ${Math.round(m.新高间隔)} 日`, good: m.最大回撤 <= 15, spark: window.ScoreWidget.drawdownSeries(nav), sc: cDn },
      { k: '交易胜率', v: m.交易胜率 + '%', d: `${Math.round(m.交易次数)} 笔 · 盈亏比 ${m.单笔盈亏比 ?? '—'}`, good: m.交易胜率 >= 50, spark: nav, sc: m.交易胜率 >= 50 ? cUp : '#9aa7b8' },
    ]);
  }


  /* ---------- 并排对比 ---------- */
  /*
    交互设计：点「与上次参数对比」→ 打开一个表单，让你改一两个参数（默认只改止损），
    右侧实时显示改后的参数摘要 → 点「开始对比」跑两组，并排显示分数与维度差异。
    为什么不做成"自动对比上次"：用户往往想比较的是"如果我加止损会怎样"，
    而不是"上次跑的是什么"。
  */
  function openCompare() {
    const box = U.$('#qCompareBox');
    if (!box) return;
    if (box.innerHTML.trim()) { box.innerHTML = ''; return; }  // 再点一次收起
    const cur = p();
    box.innerHTML = `<div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="card-head" style="margin-bottom:8px"><h3>并排对比</h3><span class="hint">同一套标的，改一两个参数，看分数差多少</span></div>
      <div class="bt-row">
        <label>改动项
          <select id="cmpWhat" class="inp">
            <!-- 量化组合是"信号→权重聚合"，没有止损止盈概念，只能比这几项 -->
            <option value="biStyle">换笔标准</option>
            <option value="maxWeightPerSymbol">单品种仓位上限</option>
            <option value="feeBps">手续费</option>
            <option value="maxSymbols">品种数</option>
          </select>
        </label>
        <label>新值 <select id="cmpVal" class="inp"></select></label>
        <button class="btn sm primary" id="cmpRun">开始对比</button>
        <span class="hint" id="cmpHint"></span>
      </div>
      <div id="cmpResult"></div>
    </div>`;

    const what = U.$('#cmpWhat');
    const val = U.$('#cmpVal');
    const OPTS = {
      biStyle: [['new', '新笔'], ['old', '老笔']],
      maxWeightPerSymbol: [['1', '100%'], ['0.5', '50%'], ['0.3', '30%']],
      feeBps: [['8', '8bps'], ['15', '15bps'], ['30', '30bps']],
      maxSymbols: [['6', '6 个'], ['12', '12 个'], ['20', '20 个']],
    };
    const fillVal = () => {
      val.innerHTML = (OPTS[what.value] || []).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    };
    fillVal();
    what.addEventListener('change', fillVal);

    U.$('#cmpRun').addEventListener('click', async () => {
      const base = p();
      const cfgA = { kind: 'quant', markets: base.markets, maxSymbols: base.maxSymbols, period: base.period, biStyle: base.biStyle, feeBps: base.feeBps, slipBps: base.slipBps, symbols: base.symbols, scoring: scoringPreset };
      const NUMERIC = ['maxWeightPerSymbol', 'feeBps', 'maxSymbols'];
      const cfgB = { ...cfgA, [what.value]: NUMERIC.includes(what.value) ? Number(val.value) : val.value };
      U.$('#cmpHint').textContent = '跑两组，约 1-2 分钟…';
      const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try {
        const r = await API.get(`/api/bt/compare?a=${enc(cfgA)}&b=${enc(cfgB)}&scoring=${scoringPreset}`);
        if (!r.ok) { U.$('#cmpHint').textContent = r.error || '失败'; return; }
        U.$('#cmpHint').textContent = '';
        renderCompare(r);
      } catch (e) {
        U.$('#cmpHint').textContent = e.message;
      }
    });
  }

  function renderCompare(r) {
    const box = U.$('#cmpResult');
    if (!box) return;
    const A = r.a, B = r.b;
    if (!A.ok || !B.ok) { box.innerHTML = `<div class="empty">有一组失败：${U.esc((A.error || '') + ' / ' + (B.error || ''))}</div>`; return; }
    const d = r.diff || {};
    const better = d.better;
    const cls = (v) => (v > 0 ? 'q-good' : v < 0 ? 'q-bad' : '');
    const dimRows = (d.dims || []).map((x) => `<div class="cmp-row">
      <span class="n">${U.esc(x.name)}</span>
      <span class="a">${x.a}</span>
      <span class="arrow">→</span>
      <span class="b">${x.b}</span>
      <span class="d ${cls(x.diff)}">${x.diff > 0 ? '+' : ''}${x.diff}</span>
    </div>`).join('');
    box.innerHTML = `<div class="cmp-grid">
      <div class="cmp-side ${better === 'a' ? 'win' : ''}">
        <div class="cmp-lb">A · 原始</div>
        <div class="cmp-sc">${A.score.total}</div>
        <div class="cmp-gd">${U.esc(A.score.grade.text)}</div>
        <div class="cmp-cf">${U.esc(A.label)}</div>
      </div>
      <div class="cmp-mid">
        <div class="cmp-sd ${cls(d.scoreDiff)}">${d.scoreDiff > 0 ? '+' : ''}${d.scoreDiff} 分</div>
        <div class="cmp-wn">${better === 'b' ? 'B 更好' : better === 'a' ? 'A 更好' : '持平'}</div>
      </div>
      <div class="cmp-side ${better === 'b' ? 'win' : ''}">
        <div class="cmp-lb">B · 新参数</div>
        <div class="cmp-sc">${B.score.total}</div>
        <div class="cmp-gd">${U.esc(B.score.grade.text)}</div>
        <div class="cmp-cf">${U.esc(B.label)}</div>
      </div>
    </div>
    <div class="cmp-dims">${dimRows}</div>`;
  }

  /* ---------- 历史存档 ---------- */
  async function openHistory() {
    const box = U.$('#qHistoryBox');
    if (!box) return;
    if (box.innerHTML.trim()) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card" style="padding:12px 14px;margin-bottom:12px"><div class="loading">读取历史…</div></div>';
    try {
      const r = await API.get('/api/bt/history?all=1&limit=30');
      const items = r.items || [];
      if (!items.length) {
        box.innerHTML = '<div class="card" style="padding:12px 14px;margin-bottom:12px"><div class="empty">还没有存档。每跑一次回测会自动记一条。</div></div>';
        return;
      }
      const rows = items.map((x) => {
        const d = new Date(x.lastAt);
        const ts = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const trend = x.trend == null ? '' : `<span class="${x.trend > 0 ? 'q-good' : x.trend < 0 ? 'q-bad' : ''}">${x.trend > 0 ? '+' : ''}${x.trend}</span>`;
        return `<div class="hist-row">
          <div class="hist-lb">${U.esc(x.label || x.key)}</div>
          <div class="hist-meta">${ts} · ${x.runs} 次${trend ? ' · 较首次 ' + trend : ''}</div>
          <div class="hist-sc">${x.lastScore != null ? x.lastScore : '—'}</div>
        </div>`;
      }).join('');
      box.innerHTML = `<div class="card" style="padding:12px 14px;margin-bottom:12px">
        <div class="card-head" style="margin-bottom:8px"><h3>历史存档</h3><span class="hint">${items.length} 套配置 · 每跑一次自动记录</span></div>
        <div class="hist-list">${rows}</div>
      </div>`;
    } catch (e) {
      box.innerHTML = `<div class="card" style="padding:12px 14px"><div class="empty">${U.esc(e.message)}</div></div>`;
    }
  }

  async function run() {
    const cfg = p();
    U.$('#qMetrics').innerHTML = '<div class="loading">组合回测中（多品种，约 1-3 分钟）…</div>';
    try {
      const q2 = { ...cfg };
      if (q2.symbols) delete q2.markets;
      const r = await API.get(`/api/quant/portfolio?${qs(q2)}`);
      if (!r.ok) {
        U.$('#qMetrics').innerHTML = `<div class="loading">${U.esc(r.error || '失败')}</div>`;
        return;
      }
      lastResult = r;
      renderScore(r.score);
      renderHero(r.metrics, r.daily);
      renderMetrics(r.metrics, r.inverted);
      drawCurve(r.daily);
      renderBySymbol(r.bySymbol);
      U.$('#qByHint').textContent = `${r.symbols} 个品种（请求 ${r.requested}）`;
    } catch (e) {
      U.$('#qMetrics').innerHTML = `<div class="loading">${U.esc(e.message)}</div>`;
    }
  }

  async function renderPage() {
    /* 表驱动绑定：新增按钮只要加一行 */
    const bindings = [
      ['#qRun', run],
      ['#qCompare', openCompare],
      ['#qHistory', openHistory],
    ];
    for (const [sel, fn] of bindings) {
      const el = U.$(sel);
      if (el && !el._bound) { el._bound = 1; el.addEventListener('click', fn); }
    }
    // 初始化选标的器（方向 B · 卡片选择式）
    if (!picker && window.SymbolPicker) {
      const host = U.$('#qPicker');
      if (host) {
        picker = window.SymbolPicker.create(host, { multiple: true, maxSelect: 40 });
        picker.bindSearch(U.$('#qSearch'));
        await picker.load();
      }
    }
    renderGlossary();
    if (!lastResult && !U.$('#qMetrics').innerHTML.trim()) {
      U.$('#qMetrics').innerHTML = '<div class="loading">点右上角「跑组合回测」开始</div>';
      drawCurve(null);
    }
  }

  /* 窗口变化重绘净值曲线（canvas 缓冲不跟着变会拉伸变形） */
  let _rzTimer = null;
  window.addEventListener('resize', () => {
    if (_rzTimer) clearTimeout(_rzTimer);
    _rzTimer = setTimeout(() => drawCurve(lastResult ? lastResult.daily : null), 150);
  });

  window.PageQuant = { renderPage, run };
})();
