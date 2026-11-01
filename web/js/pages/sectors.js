/* 商品板块页：按产业链分组浏览期货品种，点卡片直达结构分析 */
(function () {
  let curId = null;
  let catalog = null;
  let seq = 0;

  function pctCls(v) {
    if (!Number.isFinite(v)) return 'flat-c';
    return v > 0 ? 'up-c' : v < 0 ? 'down-c' : 'flat-c';
  }
  function fmtPct(v) {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function fmtP(p, code) {
    if (!Number.isFinite(p)) return '—';
    // 国债期货价格带小数，商品整数为主
    if (/^T[FSL]?0$/.test(code)) return p.toFixed(3);
    return p >= 1000 ? p.toFixed(1) : p.toFixed(2);
  }

  async function render() {
    const tabs = U.$('#sectorTabs');
    const grid = U.$('#sectorGrid');
    const head = U.$('#sectorHead');
    if (!tabs || !grid) return;

    if (!catalog) {
      try {
        const r = await API.get('/api/sectors');
        catalog = r.sectors || [];
      } catch (e) {
        grid.innerHTML = `<div class="empty">板块目录加载失败：${U.esc(e.message)}</div>`;
        return;
      }
    }
    if (!catalog.length) {
      grid.innerHTML = '<div class="empty">暂无板块数据</div>';
      return;
    }
    // 优先回到用户上次看过的板块；没有就用第一个（不硬编码 id，跨部署不会漂）
    let saved = null;
    try { saved = localStorage.getItem('chan-sector'); } catch (e) {}
    if (!curId || !catalog.some((s) => s.id === curId)) {
      curId = saved && catalog.some((s) => s.id === saved) ? saved : catalog[0].id;
    }

    tabs.innerHTML = catalog
      .map(
        (s) => `<button class="sector-tab ${s.id === curId ? 'active' : ''}" data-sid="${s.id}">
          <span class="dot" style="background:${s.color}"></span>${U.esc(s.name)}<span class="n">${s.count}</span>
        </button>`
      )
      .join('');
    U.$$('.sector-tab', tabs).forEach((b) =>
      b.addEventListener('click', () => {
        curId = b.dataset.sid;
        try { localStorage.setItem('chan-sector', curId); } catch (e) {}
        render();
      })
    );

    const my = ++seq;
    const sec = catalog.find((s) => s.id === curId);
    head.innerHTML = `${U.esc(sec.desc)} · 共 ${sec.count} 个品种 · 点卡片打开结构分析`;
    // 先用目录占位，再补实时价
    grid.innerHTML = sec.items
      .map(
        (it) => `<div class="sector-card" data-m="${it.market}" data-c="${it.code}">
          <div class="top"><span class="nm">${U.esc(it.name)}</span><span class="cd">${U.esc(it.code)}</span></div>
          <div class="px flat-c" data-px="${it.code}">—</div>
          <div class="chg flat-c" data-chg="${it.code}">加载中…</div>
          <span class="ex">${U.esc(it.ex)}</span>
        </div>`
      )
      .join('');

    U.$$('.sector-card', grid).forEach((el) =>
      el.addEventListener('click', () => {
        App.openStructure(el.dataset.m, el.dataset.c, 'day');
      })
    );

    try {
      const r = await API.get('/api/sector?id=' + encodeURIComponent(curId));
      if (my !== seq) return; // 用户已切到别的板块
      for (const it of r.items || []) {
        const px = grid.querySelector(`[data-px="${it.code}"]`);
        const chg = grid.querySelector(`[data-chg="${it.code}"]`);
        if (!px || !chg) continue;
        const cls = pctCls(it.pct);
        px.textContent = fmtP(it.price, it.code);
        px.className = 'px ' + cls;
        chg.textContent = it.pct == null ? '暂无报价' : `${fmtPct(it.pct)}　${Number.isFinite(it.change) ? (it.change > 0 ? '+' : '') + fmtP(it.change, it.code) : ''}`;
        chg.className = 'chg ' + cls;
      }
    } catch (e) {
      if (my !== seq) return;
      // 不能停在"加载中…"：明确标成"暂无报价"，卡片仍可点进结构分析
      for (const it of sec.items) {
        const chg = grid.querySelector(`[data-chg="${it.code}"]`);
        if (chg) { chg.textContent = '暂无报价'; chg.className = 'chg flat-c'; }
      }
      head.innerHTML = U.esc(sec.desc) + ' · 实时行情拉取失败（' + U.esc(e.message) + '），可点卡片直接看图';
    }
  }

  window.PageSectors = { render };
})();
