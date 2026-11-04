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

  function renderBySymbol(list) {
    if (!list || !list.length) { U.$('#qBySymbol').innerHTML = '<div class="empty">无数据</div>'; return; }
    U.$('#qBySymbol').innerHTML = `<table class="bt-tbl"><thead><tr><th>品种</th><th>交易</th><th>胜率</th><th>平均单笔</th><th>合计</th></tr></thead><tbody>${
      list.map((x) => `<tr><td>${U.esc(x.symbol)}</td><td>${x.trades}</td><td class="${x.tradeWinRate >= 50 ? 'q-good' : 'q-bad'}">${x.tradeWinRate}%</td><td class="${x.avgNetPct > 0 ? 'q-good' : 'q-bad'}">${x.avgNetPct}%</td><td class="${x.totalPct > 0 ? 'q-good' : 'q-bad'}">${x.totalPct}%</td></tr>`).join('')
    }</tbody></table>`;
    U.$('#qByHint').textContent = `${list.length} 个品种，按合计收益排序`;
  }

  function renderVerdict(m) {
    const box = U.$('#qVerdict');
    if (!box) return;
    const pos = m.年化收益 > 0;
    const goodSharpe = m.夏普比率 > 1;
    const goodCalmar = m.卡玛比率 != null && m.卡玛比率 > 0.5;
    const lowTurn = m.年化交易次数 < 30;
    box.innerHTML = `<div class="bt-verdict ${pos ? (goodSharpe ? 'up' : 'gold') : 'down'}">
      <div class="btv-head"><b>组合表现：${pos ? '正收益' : '负收益'} · 夏普 ${m.夏普比率}</b>
      <span>年化 ${m.年化收益}% · 最大回撤 ${m.最大回撤}% · 卡玛 ${m.卡玛比率 ?? '—'}</span></div>
      <ul>
        <li>${goodSharpe ? '夏普 > 1，风险调整后表现不错' : '夏普 ≤ 1，承担的风险没有得到足够补偿'}</li>
        <li>${goodCalmar ? '卡玛 > 0.5，回撤控制相对合理' : '卡玛偏低，回撤相对收益过大'}</li>
        <li>${lowTurn ? `年化交易 ${m.年化交易次数} 次，换手低、摩擦小` : `年化交易 ${m.年化交易次数} 次，换手偏高，注意摩擦成本`}</li>
        <li>持仓方向：多头 ${m.多头占比}% / 空头 ${m.空头占比}%（${m.空头占比 === 0 ? '纯多头策略' : '含做空'}）</li>
      </ul></div>`;
  }

  async function run() {
    const cfg = p();
    U.$('#qMetrics').innerHTML = '<div class="loading">组合回测中（多品种，约 1-3 分钟）…</div>';
    U.$('#qVerdict').innerHTML = '';
    try {
      const q2 = { ...cfg };
      if (q2.symbols) delete q2.markets;
      const r = await API.get(`/api/quant/portfolio?${qs(q2)}`);
      if (!r.ok) {
        U.$('#qMetrics').innerHTML = `<div class="loading">${U.esc(r.error || '失败')}</div>`;
        return;
      }
      lastResult = r;
      renderVerdict(r.metrics);
      renderMetrics(r.metrics, r.inverted);
      drawCurve(r.daily);
      renderBySymbol(r.bySymbol);
      U.$('#qByHint').textContent = `${r.symbols} 个品种（请求 ${r.requested}）`;
    } catch (e) {
      U.$('#qMetrics').innerHTML = `<div class="loading">${U.esc(e.message)}</div>`;
    }
  }

  async function renderPage() {
    const btn = U.$('#qRun');
    if (btn && !btn._bound) { btn._bound = 1; btn.addEventListener('click', run); }
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
