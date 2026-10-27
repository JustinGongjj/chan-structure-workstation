/* 买卖点雷达 */
(function () {
  let scope = 'all';

  let scanning = false;
  async function render() {
    if (scanning) return;
    scanning = true;
    U.$('#radarTbl').innerHTML = '<tbody><tr><td><div class="loading">扫描自选池（多市场 × 日线）…</div></td></tr></tbody>';
    try {
      const res = await API.radar({ scope, period: 'day', nocache: '1' });
      renderTable(res.rows);
      U.stamp('liveStampRadar');
    } catch (e) {
      U.$('#radarTbl').innerHTML = '<tbody><tr><td><div class="loading">扫描失败：' + U.esc(e.message) + '</div></td></tr></tbody>';
    } finally {
      scanning = false;
    }
  }

  async function tick() {
    if (scanning) return;
    if (U.$('#wlMask') && U.$('#wlMask').classList.contains('show')) return;
    scanning = true;
    try {
      const res = await API.radar({ scope, period: 'day', nocache: '1' });
      renderTable(res.rows);
      U.stamp('liveStampRadar');
    } catch (e) {
      /* 静默 */
    } finally {
      scanning = false;
    }
  }

  /* ---------------- 自选池管理 ---------------- */
  const WL = { data: null, market: 'A' };

  async function openWl() {
    try {
      const res = await API.watchlist();
      WL.data = res.list;
      WL.market = App.state.market || 'A';
      renderWl();
      const m = U.$('#wlMask');
      m.classList.add('show');
      m.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    } catch (e) {
      U.toast('读取自选池失败：' + e.message);
    }
  }

  function closeWl() {
    const m = U.$('#wlMask');
    if (m) {
      m.classList.remove('show');
      m.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
  }

  function renderWl() {
    const list = (WL.data && WL.data[WL.market]) || [];
    U.$('#wlCount').textContent = `共 ${['A', 'HK', 'US', 'CR'].reduce((a, m) => a + ((WL.data[m] || []).length), 0)} 只`;
    U.$('#wlBody').innerHTML = `
      <div class="wl-tabs">
        ${['A', 'HK', 'US', 'CR']
          .map(
            (m) =>
              `<button class="sq ${m === WL.market ? 'active' : ''}" data-m="${m}">${U.MK[m]} · ${((WL.data && WL.data[m]) || []).length}</button>`
          )
          .join('')}
      </div>
      <div class="wl-add">
        <input class="input" id="wlInput" placeholder="输入代码 / 名称，如 600519、腾讯、NVDA、BTCUSDT" autocomplete="off">
        <button class="btn primary sm" id="wlAdd">添加</button>
        <div class="wl-sug" id="wlSug"></div>
      </div>
      <div class="wl-list">
        ${
          list.length
            ? list
                .map(
                  (it) => `<div class="wl-row">
            <span class="chip">${U.MK[WL.market]}</span>
            <span class="nm">${U.esc(it.name)}</span>
            <span class="cd">${U.esc(it.code)}</span>
            <button class="del" data-c="${U.esc(it.code)}">删除</button>
          </div>`
                )
                .join('')
            : '<div class="wl-empty">这个市场还没有自选，先在上面添加一只</div>'
        }
      </div>`;

    U.$$('#wlBody .wl-tabs .sq').forEach((b) =>
      b.addEventListener('click', () => {
        WL.market = b.dataset.m;
        renderWl();
      })
    );
    U.$$('#wlBody .wl-row .del').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const res = await API.watchDel({ market: WL.market, code: b.dataset.c });
          WL.data = res.list;
          renderWl();
          U.toast('已删除 ' + b.dataset.c);
          refreshAll();
        } catch (e) {
          U.toast('删除失败：' + e.message);
        }
      })
    );

    const inp = U.$('#wlInput');
    const sug = U.$('#wlSug');
    const doSuggest = U.debounce(async () => {
      const q = inp.value.trim();
      if (q.length < 2) {
        sug.classList.remove('show');
        return;
      }
      try {
        const r = await API.search(q);
        if (!r.items.length) {
          sug.classList.remove('show');
          return;
        }
        sug.innerHTML = r.items
          .slice(0, 8)
          .map(
            (it) =>
              `<div data-m="${it.market}" data-c="${it.code}" data-n="${U.esc(it.name)}"><span class="mk">${U.MK[it.market] || it.market}</span>${U.esc(it.name)}<span class="cd">${U.esc(it.code)}</span></div>`
          )
          .join('');
        U.$$('#wlSug > div').forEach((d) =>
          d.addEventListener('click', () => {
            if (d.dataset.m !== WL.market) {
              WL.market = d.dataset.m;
              renderWl();
              setTimeout(() => {
                const i2 = U.$('#wlInput');
                i2.value = d.dataset.c;
                i2.focus();
              }, 0);
            } else {
              inp.value = d.dataset.c;
            }
            sug.classList.remove('show');
          })
        );
        sug.classList.add('show');
      } catch (e) {
        sug.classList.remove('show');
      }
    }, 240);
    inp.addEventListener('input', doSuggest);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addOne();
      }
    });
    U.$('#wlAdd').addEventListener('click', addOne);
    async function addOne() {
      const code = inp.value.trim();
      if (!code) {
        U.toast('请输入代码');
        return;
      }
      try {
        const res = await API.watchAdd({ market: WL.market, code });
        WL.data = res.list;
        renderWl();
        U.toast(`已添加 ${res.added.name || res.added.code}`);
        refreshAll();
      } catch (e) {
        U.toast('添加失败：' + e.message);
      }
    }
  }

  function refreshAll() {
    render();
    if (window.PageOverview && PageOverview.render) PageOverview.render().catch(() => {});
  }

  function renderTable(rows) {
    const head = `<thead><tr>
      <th>#</th><th>标的</th><th>市场</th><th style="text-align:right">现价</th><th style="text-align:right">涨跌</th>
      <th>最近信号</th><th>趋势</th><th>位置</th><th>中枢</th><th>背驰</th><th>强度</th><th>数据源</th>
    </tr></thead>`;
    const body = rows
      .map((r, i) => {
        if (r.error) {
          return `<tr><td class="rank">${i + 1}</td><td colspan="11" class="hint">${U.esc(r.name || r.code)} —— 数据获取失败（${U.esc(r.error)}）</td></tr>`;
        }
        const s = r.last;
        const sigHtml = s
          ? `<span class="badge ${s.type.endsWith('B') ? 'buy' : 'sell'}">${U.SIG_SHORT[s.type]}</span> <span class="mono hint">${U.fmt(s.price)}</span>`
          : '<span class="hint">近90根无</span>';
        const bei = r.beichi && r.beichi.length ? r.beichi.map((b) => `<span class="chip gold">${b.kind === '段背驰' ? '段' : '笔'}${b.dir > 0 ? '顶' : '底'}</span>`).join(' ') : '<span class="hint">—</span>';
        const bars = Math.max(0, Math.min(100, r.score || 0));
        return `<tr class="rowlink" data-m="${r.market}" data-c="${r.code}">
        <td class="rank">${i + 1}</td>
        <td><div class="sym"><b>${U.esc(r.name)}</b><span>${U.esc(r.code)}</span></div></td>
        <td><span class="chip">${U.MK[r.market]}</span></td>
        <td style="text-align:right" class="mono ${U.cls(r.pct)}">${U.fmt(r.price)}</td>
        <td style="text-align:right" class="${U.cls(r.pct)}">${U.pct(r.pct)}</td>
        <td>${sigHtml}</td>
        <td>${r.trend}</td>
        <td><span class="chip ${r.position === 'above' ? 'green' : r.position === 'below' ? 'red' : ''}">${U.POS_TXT[r.position]}</span></td>
        <td class="mono hint">${r.pivot ? U.fmt(r.pivot.zd) + '~' + U.fmt(r.pivot.zg) : '—'}</td>
        <td>${bei}</td>
        <td><span class="scorebar"><i style="width:${bars}%"></i></span></td>
        <td class="hint">${U.esc(r.source || '')}</td>
      </tr>`;
      })
      .join('');
    U.$('#radarTbl').innerHTML = head + '<tbody>' + body + '</tbody>';
    U.$$('#radarTbl .rowlink').forEach((el) =>
      el.addEventListener('click', () => App.openStructure(el.dataset.m, el.dataset.c, 'day'))
    );
  }

  document.addEventListener('DOMContentLoaded', () => {
    const openBtn = U.$('#wlOpen');
    if (openBtn) openBtn.addEventListener('click', openWl);
    const closeBtn = U.$('#wlClose');
    if (closeBtn) closeBtn.addEventListener('click', closeWl);
    const mask = U.$('#wlMask');
    if (mask)
      mask.addEventListener('click', (e) => {
        if (e.target === mask) closeWl();
      });
    const reset = U.$('#wlReset');
    if (reset)
      reset.addEventListener('click', async () => {
        if (!confirm('恢复默认自选池？当前自定义的增删会被覆盖。')) return;
        try {
          const res = await API.watchReset();
          WL.data = res.list;
          renderWl();
          U.toast('已恢复默认自选池');
          refreshAll();
        } catch (e) {
          U.toast('恢复失败：' + e.message);
        }
      });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mask && mask.classList.contains('show')) closeWl();
    });
    if (new URLSearchParams(location.search).get('wl') === '1') setTimeout(() => openWl(), 600);
    U.$$('#radarScope .sq').forEach((b) =>
      b.addEventListener('click', () => {
        U.$$('#radarScope .sq').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        scope = b.dataset.scope;
        render();
      })
    );
  });

  window.PageRadar = { render, tick, openEditor: openWl };
})();
