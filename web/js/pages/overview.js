/* 总览页 */
(function () {
  let radarRows = null;

  async function tick() {
    const ov = await API.overview();
    renderPulse(ov.pulse);
    renderIndices(ov.indices);
    renderWatch(ov.watch);
    U.stamp('liveStampOverview');
  }

  async function render() {
    const [ov, daily] = await Promise.all([API.overview(), API.daily().catch(() => null)]);
    renderPulse(ov.pulse);
    renderIndices(ov.indices);
    renderWatch(ov.watch);
    if (daily) renderCal(daily);
    U.$('#idxAsof').textContent = '更新于 ' + new Date(ov.asof).toLocaleTimeString('zh-CN', { hour12: false });
    U.stamp('liveStampOverview');

    try {
      const rd = await API.radar({ scope: 'all', period: 'day' });
      radarRows = rd.rows;
      renderSignals(rd.rows);
    } catch (e) {
      U.$('#overviewSignals').innerHTML = '<div class="loading">雷达暂不可用：' + U.esc(e.message) + '</div>';
    }
  }

  function renderPulse(pulse) {
    const cards = [
      { m: 'A', name: 'A股', sub: '沪深 · 交易中' },
      { m: 'HK', name: '港股', sub: 'HKEX' },
      { m: 'US', name: '美股', sub: 'NASDAQ/NYSE' },
      { m: 'CR', name: '加密', sub: 'Binance 现货' },
    ];
    U.$('#pulseCards').innerHTML = cards
      .map((c) => {
        const p = pulse[c.m] || { avgPct: 0, up: 0, down: 0, count: 0, heat: 50 };
        return `<div class="pulse">
        <div class="pulse-top"><span class="pulse-name">${c.name} · 自选池均涨</span><span class="chip">${c.sub}</span></div>
        <div class="pulse-val ${U.cls(p.avgPct)}">${U.pct(p.avgPct)}</div>
        <div class="pulse-sub"><span>涨 ${p.up} / 跌 ${p.down} / 平 ${p.flat}</span><span>热度 ${p.heat}</span></div>
        <div class="heatbar"><i style="width:${p.heat}%"></i></div>
      </div>`;
      })
      .join('');
  }

  function renderIndices(rows) {
    U.$('#indexGrid').innerHTML = rows
      .map(
        (r) => `<div class="idx" data-m="${r.market}" data-c="${r.code}">
        <div class="n"><span>${U.esc(r.name)}</span><span class="chip">${U.MK[r.market]}</span></div>
        <div class="p ${U.cls(r.pct)}">${U.fmt(r.price, r.price > 1000 ? 2 : 2)}</div>
        <div class="c ${U.cls(r.pct)}">${U.pct(r.pct)}</div>
      </div>`
      )
      .join('');
    U.$$('#indexGrid .idx').forEach((el) =>
      el.addEventListener('click', () => App.openStructure(el.dataset.m, el.dataset.c, 'day'))
    );
  }

  function renderWatch(rows) {
    const head = `<thead><tr><th>标的</th><th>市场</th><th style="text-align:right">现价</th><th style="text-align:right">涨跌</th><th style="text-align:right">高/低</th><th>时间</th></tr></thead>`;
    const body = rows
      .map(
        (r) => `<tr class="rowlink" data-m="${r.market}" data-c="${r.code}">
      <td><div class="sym"><b>${U.esc(r.name)}</b><span>${U.esc(r.code)}</span></div></td>
      <td><span class="chip">${U.MK[r.market]}</span></td>
      <td style="text-align:right" class="mono ${U.cls(r.pct)}">${U.fmt(r.price)}</td>
      <td style="text-align:right" class="${U.cls(r.pct)}">${U.pct(r.pct)}</td>
      <td style="text-align:right" class="mono hint">${U.fmt(r.high)} / ${U.fmt(r.low)}</td>
      <td class="hint">${U.esc(U.timeShort(r.timeText))}</td>
    </tr>`
      )
      .join('');
    U.$('#watchTbl').innerHTML = head + '<tbody>' + body + '</tbody>';
    U.$$('#watchTbl .rowlink').forEach((el) =>
      el.addEventListener('click', () => App.openStructure(el.dataset.m, el.dataset.c, 'day'))
    );
  }

  function renderSignals(rows) {
    const withSig = rows.filter((r) => r.last && !r.error).slice(0, 8);
    if (!withSig.length) {
      U.$('#overviewSignals').innerHTML = '<div class="loading">近 90 根 K 线内暂无买卖点信号</div>';
      return;
    }
    U.$('#overviewSignals').innerHTML = withSig
      .map((r) => {
        const s = r.last;
        const buy = s.type.endsWith('B');
        return `<div class="sig-item" data-m="${r.market}" data-c="${r.code}">
        <span class="badge ${buy ? 'buy' : 'sell'}">${s.name}</span>
        <span class="nm">${U.esc(r.name)} <span class="hint">${U.MK[r.market]} · ${U.POS_TXT[r.position] || ''}</span></span>
        <span class="px">${U.fmt(s.price)}</span>
        <span class="dt">${U.ts(s.t, 'day')}</span>
      </div>`;
      })
      .join('');
    U.$$('#overviewSignals .sig-item').forEach((el) =>
      el.addEventListener('click', () => App.openStructure(el.dataset.m, el.dataset.c, 'day'))
    );
  }

  function renderCal(d) {
    const p = d.pillars;
    U.$('#overviewCal').innerHTML = `
      <div class="ci"><span class="lab">北京时间</span><span class="val mono" style="font-family:ui-monospace,monospace;font-size:12.5px">${U.esc(d.beijingTime)}</span></div>
      <div class="ci"><span class="lab">四柱</span><span class="val">${p.year.text} ${p.month.text} ${p.day.text} ${p.hour.text}</span></div>
      <div class="ci"><span class="lab">日主</span><span class="val">${p.day.gan}${p.day.animal}</span></div>
      <div class="ci"><span class="lab">建除</span><span class="val">${d.jianchu}</span></div>
      <div class="ci"><span class="lab">冲</span><span class="val">${d.chong.animal}</span></div>
      <div class="ci"><span class="lab">旬空</span><span class="val">${d.kong.join(' ')}</span></div>
      <div class="ci"><span class="lab">节气</span><span class="val" style="font-size:12.5px">${d.terms.prev ? d.terms.prev.name + '（' + d.terms.prev.daysAgo + '天前）' : '—'} → ${d.terms.next ? d.terms.next.name + '（' + d.terms.next.daysTo + '天后）' : '—'}</span></div>
      <div class="ci tip">${U.esc(d.advice.tip)}　<span class="hint">（点右侧「算卦择时」看完整卦象）</span></div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const b = U.$('#ovWlOpen');
    if (b)
      b.addEventListener('click', () => {
        if (window.PageRadar && PageRadar.openEditor) PageRadar.openEditor();
        else App.go('radar');
      });
  });

  window.PageOverview = { render, tick };
})();
