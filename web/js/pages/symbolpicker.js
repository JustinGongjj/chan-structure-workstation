/* 选标的器（可复用组件）
   =====================================================================
   方向 B · 卡片选择式（用户选定）
   解决的问题：原来要手输 "A:600519,CNF:RB0"，小白不知道代码是什么。
   现在：市场横条 → 摘要数字 → 大卡片多选 → 底部固定条。

   用法：
     const picker = SymbolPicker.create(containerEl, {
       multiple: true,
       onChange: (keys) => {...},
     });
     await picker.load();          // 拉标的池
     picker.getSelected();         // ['A:600519', ...]
     picker.setSelected(keys);
*/
(function () {
  'use strict';
  const { U, API } = window;

  const MARKETS = [
    ['A', 'A股'], ['CNF', '国内期货'], ['US', '美股'], ['CR', '加密'], ['HK', '港股'],
  ];

  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function create(host, opts = {}) {
    const cfg = {
      multiple: opts.multiple !== false,
      maxSelect: opts.maxSelect || 40,
      onChange: opts.onChange || null,
      defaultMarkets: opts.defaultMarkets || ['A'],
    };

    let pool = [];          // 全部标的（带标签）
    let selected = new Set();
    let activeMarket = cfg.defaultMarkets[0] || 'A';
    let keyword = '';
    let loaded = false;

    host.classList.add('sp-root');
    host.innerHTML = `
      <div class="sp-mktabs" role="tablist"></div>
      <div class="sp-summary"></div>
      <div class="sp-grid"></div>
      <div class="sp-empty" style="display:none"></div>
      <div class="sp-dock">
        <button class="sp-btn" data-act="clear">清空</button>
        <button class="sp-btn" data-act="all">全选本市场</button>
        <div class="sp-info"></div>
      </div>`;

    const $tabs = host.querySelector('.sp-mktabs');
    const $sum = host.querySelector('.sp-summary');
    const $grid = host.querySelector('.sp-grid');
    const $empty = host.querySelector('.sp-empty');
    const $info = host.querySelector('.sp-info');

    /* ---------- 渲染 ---------- */
    function countByMarket() {
      const m = {};
      for (const it of pool) m[it.market] = (m[it.market] || 0) + 1;
      return m;
    }

    function renderTabs() {
      const cnt = countByMarket();
      $tabs.innerHTML = MARKETS.filter(([k]) => cnt[k]).map(([k, label]) => {
        const on = k === activeMarket ? ' sp-on' : '';
        const selN = [...selected].filter((x) => x.startsWith(k + ':')).length;
        return `<button class="sp-mk${on}" data-mk="${k}" role="tab">
          ${U.esc(label)} <span class="sp-n">${cnt[k]}</span>${selN ? `<span class="sp-badge">${selN}</span>` : ''}
        </button>`;
      }).join('');
      U.$$('.sp-mk', $tabs).forEach((b) =>
        b.addEventListener('click', () => { activeMarket = b.dataset.mk; renderAll(); })
      );
    }

    function renderSummary() {
      const markets = new Set([...selected].map((x) => x.split(':')[0]));
      const n = selected.size;
      // 粗估耗时：每标的约 2.5 秒
      const secs = Math.max(3, Math.round(n * 2.5));
      $sum.innerHTML = `
        <div class="sp-sm"><div class="sp-k">已选标的</div><div class="sp-v">${n} <span style="font-size:11px;color:var(--faint)">个</span></div></div>
        <div class="sp-sm"><div class="sp-k">覆盖市场</div><div class="sp-v">${markets.size} <span style="font-size:11px;color:var(--faint)">个</span></div></div>
        <div class="sp-sm"><div class="sp-k">预计耗时</div><div class="sp-v">~${secs < 60 ? secs + ' 秒' : Math.round(secs / 60) + ' 分'}</div></div>`;
    }

    function filtered() {
      const kw = keyword.trim().toLowerCase();
      let list = pool.filter((x) => (kw ? true : x.market === activeMarket));
      if (kw) {
        list = pool.filter((x) =>
          x.code.toLowerCase().includes(kw) ||
          (x.name || '').toLowerCase().includes(kw) ||
          (x.sector || '').toLowerCase().includes(kw) ||
          x.marketLabel.includes(kw)
        );
      }
      return list;
    }

    function renderGrid() {
      const list = filtered();
      if (!list.length) {
        $grid.innerHTML = '';
        $empty.style.display = '';
        $empty.innerHTML = keyword
          ? `没有匹配「${U.esc(keyword)}」的标的`
          : '这个市场暂无标的';
        return;
      }
      $empty.style.display = 'none';
      $grid.innerHTML = list.slice(0, 200).map((x) => {
        const on = selected.has(x.key) ? ' sp-on' : '';
        return `<button class="sp-card${on}" data-key="${U.esc(x.key)}">
          <span class="sp-chk">✓</span>
          <span class="sp-name">${U.esc(x.name)}</span>
          <span class="sp-code">${U.esc(x.code)} · ${U.esc(x.marketLabel)}</span>
          <span class="sp-meta"><span class="sp-sector">${U.esc(x.sector)}</span>${x.style ? `<span class="sp-pill">${U.esc(x.style)}</span>` : ''}</span>
        </button>`;
      }).join('');

      U.$$('.sp-card', $grid).forEach((b) =>
        b.addEventListener('click', () => toggle(b.dataset.key))
      );
    }

    function renderInfo() {
      const names = [...selected].slice(0, 4).map((k) => {
        const it = pool.find((x) => x.key === k);
        return it ? it.name : k;
      });
      const more = selected.size > 4 ? ` 等 ${selected.size} 个` : '';
      $info.innerHTML = selected.size
        ? `已选 <b>${selected.size}</b> 个标的<br><span style="font-size:11px;color:var(--faint)">${U.esc(names.join('、'))}${more}</span>`
        : '<span style="color:var(--faint)">还没选标的</span>';
    }

    function renderAll() {
      renderTabs(); renderSummary(); renderGrid(); renderInfo();
    }

    /* ---------- 交互 ---------- */
    function toggle(key) {
      if (selected.has(key)) selected.delete(key);
      else {
        if (!cfg.multiple) selected.clear();
        if (selected.size >= cfg.maxSelect) {
          if (window.toast) toast(`最多选 ${cfg.maxSelect} 个`);
          return;
        }
        selected.add(key);
      }
      renderAll();
      if (cfg.onChange) cfg.onChange(getSelected());
    }

    host.querySelector('[data-act="clear"]').addEventListener('click', () => {
      selected.clear();
      renderAll();
      if (cfg.onChange) cfg.onChange(getSelected());
    });

    host.querySelector('[data-act="all"]').addEventListener('click', () => {
      const list = filtered().slice(0, cfg.maxSelect);
      let hitMax = false;
      for (const it of list) {
        if (selected.size >= cfg.maxSelect) { hitMax = true; break; }
        selected.add(it.key);
      }
      renderAll();
      if (hitMax && window.toast) toast(`已达上限 ${cfg.maxSelect} 个`);
      if (cfg.onChange) cfg.onChange(getSelected());
    });

    /* ---------- 对外 ---------- */
    function getSelected() {
      return [...selected];
    }

    function setSelected(keys) {
      selected = new Set(keys || []);
      if (!loaded) return; // 加载完成后再渲染
      renderAll();
    }

    async function load() {
      if (loaded) { renderAll(); return; }
      $grid.innerHTML = '<div class="sp-loading">加载标的池…</div>';
      try {
        const r = await API.get('/api/universe');
        pool = r.items || [];
        loaded = true;
        renderAll();
      } catch (e) {
        $grid.innerHTML = `<div class="sp-empty">标的池加载失败：${U.esc(e.message)}</div>`;
      }
    }

    /* 搜索框由外部塞进来（放在 tabs 上方），这里只暴露绑定 */
    function bindSearch(input) {
      if (!input || input._spBound) return;
      input._spBound = 1;
      let t = null;
      input.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => { keyword = input.value || ''; renderGrid(); renderInfo(); }, 120);
      });
    }

    // 初始骨架（避免空白）
    renderSummary();
    $grid.innerHTML = '<div class="sp-loading">加载标的池…</div>';

    return { load, getSelected, setSelected, bindSearch, renderAll, get pool() { return pool; } };
  }

  window.SymbolPicker = { create, MARKETS };
})();
