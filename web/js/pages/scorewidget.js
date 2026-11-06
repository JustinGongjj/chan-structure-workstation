/* 评分仪表盘（可复用组件）
   =====================================================================
   量化组合页与因子回测页共用。
   用法：
     ScoreWidget.render(hostEl, score, { onPreset: (p) => {...} })
     ScoreWidget.hero(heroEl, cards)      // 四个大数字卡
     ScoreWidget.sparkline(vals, color)   // 迷你走势 SVG
*/
(function () {
  'use strict';
  const { U } = window;

  const GRADE_COLOR = { good: '#22b884', warn: '#d9a441', bad: '#f0544f' };
  const PRESETS = [['balanced', '均衡'], ['conservative', '保守'], ['aggressive', '激进']];

  /** 渲染评分仪表盘（含权重切换） */
  function render(host, score, opts = {}) {
    if (!host) return;
    if (!score) { host.innerHTML = ''; return; }
    const col = GRADE_COLOR[score.grade.cls] || '#9aa7b8';
    const R = 56, C = 2 * Math.PI * R;
    const off = C * (1 - score.total / 100);

    const dimRows = score.dims.map((d) => {
      const pct = Math.round(d.got / d.max * 100);
      const c = pct >= 60 ? '#22b884' : pct >= 35 ? '#d9a441' : '#f0544f';
      return `<div class="q-dim">
        <span class="n">${U.esc(d.name)}</span>
        <span class="q-track"><i style="width:${pct}%;background:${c}"></i></span>
        <span class="s" style="color:${c}">${d.got} / ${d.max}</span>
      </div>`;
    }).join('');

    host.innerHTML = `
      <div class="q-preset">
        <span class="lbl">评分标准</span>
        ${PRESETS.map(([k, lb]) => `<button data-preset="${k}" class="${k === score.preset ? 'on' : ''}">${lb}</button>`).join('')}
        <span class="hint" style="margin-left:6px">评级：80+ 优秀 · 60 可用 · 40 边缘 · 20 偏弱</span>
      </div>
      <div class="q-score">
        <div class="q-ring">
          <svg width="132" height="132">
            <circle cx="66" cy="66" r="${R}" fill="none" stroke="#1c2230" stroke-width="10"/>
            <circle cx="66" cy="66" r="${R}" fill="none" stroke="${col}" stroke-width="10"
              stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round"/>
          </svg>
          <div class="num"><b style="color:${col}">${score.total}</b><span>${U.esc(score.grade.text)}</span></div>
        </div>
        <div class="q-dims">
          ${dimRows}
          <div class="q-verdict">${U.esc(score.verdict)}</div>
        </div>
      </div>`;

    U.$$('[data-preset]', host).forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.preset === score.preset) return;
        if (opts.onPreset) opts.onPreset(b.dataset.preset);
      })
    );
  }

  /** 渲染四个大数字卡 */
  function hero(host, cards) {
    if (!host) return;
    host.innerHTML = (cards || []).map((c) => `
      <div class="q-hc">
        <div class="k">${U.esc(c.k)}</div>
        <div class="v ${c.good ? 'q-good' : 'q-bad'}">${U.esc(String(c.v))}</div>
        <div class="d">${U.esc(c.d)}</div>
        ${sparkline(c.spark, c.sc)}
      </div>`).join('');
  }

  /** 迷你走势 */
  function sparkline(vals, color) {
    if (!vals || vals.length < 2) return '';
    const w = 100, h = 30;
    const min = Math.min(...vals), max = Math.max(...vals);
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
  }

  /** 净值 → 回撤序列 */
  function drawdownSeries(nav) {
    let peak = -Infinity;
    return nav.map((v) => { if (v > peak) peak = v; return (v / peak - 1) * 100; });
  }

  /** 日收益数组 → 净值 */
  function navSeries(daily) {
    let v = 1;
    return (daily || []).map((d) => (v *= (1 + d.ret)));
  }

  window.ScoreWidget = { render, hero, sparkline, drawdownSeries, navSeries };
})();
