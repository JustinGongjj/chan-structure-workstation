/* 应用外壳：路由、全局状态、搜索、时钟 */
(function () {
  const App = {
    state: {
      page: 'overview',
      market: 'A',
      period: 'day',
      hl: null, // 教学标注：理论 → 图上位置
      live: false, // 实时刷新
      symbol: { A: '600519', HK: '00700', US: 'NVDA', CR: 'BTCUSDT', CNF: 'RB0', USF: 'ES' },
      pickedSymbol: false,
    },
    pages: {},
    go(page, opts) {
      if (!['overview', 'structure', 'radar', 'theory', 'divination', 'sources'].includes(page)) page = 'overview';
      this.state.page = page;
      U.$$('.page').forEach((el) => el.classList.toggle('active', el.id === 'page-' + page));
      U.$$('#nav .nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
      if (!opts || opts.silent !== true) this.syncURL();
      this.render();
    },
    syncURL() {
      const q = new URLSearchParams();
      q.set('m', this.state.market);
      q.set('c', this.state.symbol[this.state.market] || '');
      q.set('p', this.state.period);
      if (this.state.hl) q.set('hl', this.state.hl);
      const url = `?${q.toString()}#${this.state.page}`;
      if (location.search + location.hash !== url) history.replaceState(null, '', url);
    },
    openStructure(market, code, period, opts) {
      this.state.market = market || this.state.market;
      this.state.symbol[this.state.market] = code || this.state.symbol[this.state.market];
      if (code) this.state.pickedSymbol = true;
      if (period) this.state.period = period;
      // 只有显式带上 hl 才保留标注；从雷达/总览点进来默认清空
      this.state.hl = (opts && opts.hl) || null;
      U.$$('#marketTabs .mtab').forEach((b) => b.classList.toggle('active', b.dataset.market === this.state.market));
      this.go('structure');
    },
    async render() {
      const page = this.state.page;
      try {
        if (page === 'overview') await PageOverview.render();
        else if (page === 'structure') await PageStructure.render();
        else if (page === 'radar') await PageRadar.render();
        else if (page === 'theory') PageTheory.render();
        else if (page === 'divination') await PageDivination.render();
        else if (page === 'sources') await PageSources.render();
      } catch (e) {
        U.toast('加载失败：' + e.message);
      }
    },
  };
  window.App = App;

  /* ---------- 导航 ---------- */
  U.$$('#nav .nav-item').forEach((el) =>
    el.addEventListener('click', () => App.go(el.dataset.page))
  );
  window.addEventListener('hashchange', () => {
    const p = location.hash.replace('#', '');
    if (p && p !== App.state.page) App.go(p, { silent: true });
  });

  /* ---------- 市场 tab ---------- */
  U.$$('#marketTabs .mtab').forEach((b) =>
    b.addEventListener('click', () => {
      U.$$('#marketTabs .mtab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      App.state.market = b.dataset.market;
      if (App.state.page === 'structure') App.render();
      else App.go('structure');
    })
  );

  /* ---------- 实时刷新 ---------- */
  const Live = {
    timer: null,
    n: 0,
    init() {
      const qp = new URLSearchParams(location.search);
      App.state.live = qp.get('live') === '1' || localStorage.getItem('chan-live') === '1';
      this.sync();
      if (App.state.live) this.start();
    },
    sync() {
      const b = U.$('#liveBtn');
      if (!b) return;
      b.classList.toggle('on', App.state.live);
      b.innerHTML = App.state.live ? '<i></i>实时开 · 10s' : '实时 · 关';
    },
    set(on) {
      App.state.live = on;
      try {
        localStorage.setItem('chan-live', on ? '1' : '0');
      } catch (e) {}
      this.sync();
      if (on) {
        this.start();
        this.tick(true);
        U.toast('已开启实时刷新：行情每 10 秒、结构每 20 秒、雷达每 30 秒');
      } else {
        this.stop();
        U.toast('已关闭实时刷新');
      }
    },
    start() {
      this.stop();
      this.timer = setInterval(() => this.tick(false), 10000);
    },
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    },
    async tick(force) {
      this.n++;
      const page = App.state.page;
      try {
        if (page === 'overview' && window.PageOverview && PageOverview.tick) await PageOverview.tick();
        if (page === 'structure' && window.PageStructure && PageStructure.tick && (force || this.n % 2 === 0)) await PageStructure.tick();
        if (page === 'radar' && window.PageRadar && PageRadar.tick && (force || this.n % 3 === 0)) await PageRadar.tick();
      } catch (e) {
        /* 静默：单次刷新失败不影响下一次 */
      }
    },
  };
  window.Live = Live;
  Live.init();
  const liveBtn = U.$('#liveBtn');
  if (liveBtn) liveBtn.addEventListener('click', () => Live.set(!App.state.live));

  /* ---------- 主题切换 ---------- */
  U.theme.sync();
  const themeBtn = U.$('#themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', () => U.theme.toggle());
  window.addEventListener('themechange', () => {
    const c = window.PageStructure && window.PageStructure.getChart && window.PageStructure.getChart();
    if (c) c.draw();
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      U.theme.toggle();
    }
  });

  /* ---------- 全局刷新 ---------- */
  U.$('#refreshBtn').addEventListener('click', async () => {
    U.toast('刷新中…');
    await App.render();
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'refresh-overview' || a === 'radar' || a === 'probe') App.render();
  });

  /* ---------- 搜索 ---------- */
  const pop = U.$('#searchPop');
  const input = U.$('#globalSearch');
  const doSearch = U.debounce(async () => {
    const q = input.value.trim();
    if (q.length < 1) {
      pop.classList.remove('show');
      return;
    }
    try {
      const res = await API.search(q);
      if (!res.items.length) {
        pop.innerHTML = '<div class="search-item">没有匹配结果</div>';
      } else {
        pop.innerHTML = res.items
          .map(
            (it) => `<div class="search-item" data-m="${it.market}" data-c="${it.code}">
          <span class="mk">${U.MK[it.market] || it.market}</span><span>${U.esc(it.name)}</span><span class="cd">${U.esc(it.code)}</span>
        </div>`
          )
          .join('');
        U.$$('.search-item', pop).forEach((el) =>
          el.addEventListener('click', () => {
            pop.classList.remove('show');
            App.openStructure(el.dataset.m, el.dataset.c, 'day');
          })
        );
      }
      pop.classList.add('show');
    } catch (e) {
      pop.innerHTML = '<div class="search-item">搜索失败：' + U.esc(e.message) + '</div>';
      pop.classList.add('show');
    }
  }, 260);
  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = pop.querySelector('.search-item[data-m]');
      if (first) first.click();
    }
    if (e.key === 'Escape') pop.classList.remove('show');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) pop.classList.remove('show');
  });

  /* ---------- 时钟 & 干支 ---------- */
  function tick() {
    const d = new Date(Date.now() + 8 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    const wd = '日一二三四五六'[d.getUTCDay()];
    U.$('#clock').textContent = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} 北京 · 周${wd}`;
  }
  tick();
  setInterval(tick, 1000);

  async function loadDaily() {
    try {
      const d = await API.daily();
      const badge = U.$('#calBadge');
      badge.textContent = `${d.pillars.day.text}日 · ${d.jianchu}`;
      badge.title = `${d.pillars.year.text}年 ${d.pillars.month.text}月 ${d.pillars.day.text}日 ${d.pillars.hour.text}时｜${d.advice.tip}`;
      badge.addEventListener('click', () => App.go('divination'));
      U.$('#sideDaily').innerHTML = `
        <div class="side-card-t">今日干支</div>
        <div class="side-date">${d.beijingTime.slice(0, 10)} 周${'日一二三四五六'[new Date(d.beijingTime.slice(0, 10)).getDay()]} · ${d.jianchu}日</div>
        <div class="side-pillars">${d.pillars.year.text} ${d.pillars.month.text} ${d.pillars.day.text}</div>
        <div class="hint" style="margin-top:6px">${d.pillars.hour.name} ${d.pillars.hour.text} · 冲${d.chong.animal}</div>`;
    } catch (e) {
      /* 静默 */
    }
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    try {
      await API.health();
      U.$('#apiDot').className = 'dot ok';
      U.$('#apiText').textContent = '数据服务正常';
    } catch (e) {
      U.$('#apiDot').className = 'dot bad';
      U.$('#apiText').textContent = '服务异常';
    }
    // 深链：?m=HK&c=00700&p=week#structure
    const q = new URLSearchParams(location.search);
    if (q.get('m') && ['A', 'HK', 'US', 'CR', 'CNF', 'USF'].includes(q.get('m').toUpperCase())) App.state.market = q.get('m').toUpperCase();
    if (q.get('c')) {
      App.state.symbol[App.state.market] = q.get('c');
      App.state.hl = q.get('hl') || null; // 带标的进入 = 显式指定
      App.state.pickedSymbol = true;
    }
    if (q.get('p')) App.state.period = q.get('p');
    if (q.get('hl')) App.state.hl = q.get('hl');
    U.$$('#marketTabs .mtab').forEach((b) => b.classList.toggle('active', b.dataset.market === App.state.market));
    loadDaily();
    const h = location.hash.replace('#', '');
    App.go(h || 'overview', { silent: true });
  }
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
