/* 量化推票页：全市场扫描 + 因子方向 + 历史检验 */
(function () {
  'use strict';
  const { U, API } = window;

  let lastScan = null;
  let lastDirs = null;

  const fmtPct = (v, d = 2) => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '—');
  const dirText = (d) => (d > 0 ? '正向' : d < 0 ? '反向' : '不用');
  const dirClass = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'muted');

  const qs = (o) => Object.entries(o)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`)
    .join('&');

  /* ---------- 因子方向表 ---------- */
  function renderDirs(d) {
    const box = U.$('#pkDirs');
    if (!box) return;
    if (!d || !d.ok) {
      box.innerHTML = `<div class="loading">${U.esc((d && d.error) || '方向估计失败')}</div>`;
      return;
    }
    const names = {
      mom20: '20日动量', dev60: '相对MA60', ret5: '5日收益',
      vstd20: '量能波动', vol20: '价格波动', pivots: '中枢数量', posPct: '中枢位置',
    };
    const rows = Object.entries(d.factors).map(([k, v]) => {
      const conf = v.confidence || (Math.abs(v.t) >= 3 ? 'ok' : Math.abs(v.t) >= 2 ? 'borderline' : 'none');
      const badge = conf === 'ok' ? '<span class="pk-badge ok">可用</span>'
        : conf === 'borderline' ? '<span class="pk-badge warn">边界</span>' : '';
      return `<tr>
        <td>${U.esc(names[k] || k)}</td>
        <td class="${v.spread > 0 ? 'up' : v.spread < 0 ? 'down' : ''}">${v.spread > 0 ? '+' : ''}${v.spread}%</td>
        <td class="${conf === 'none' ? 'muted' : ''}">${v.t}</td>
        <td class="${dirClass(v.dir)}">${dirText(v.dir)} ${badge}</td>
        <td>${v.stable}%</td>
        <td class="muted tiny">${(v.perCut || []).join(' / ')}</td>
      </tr>`;
    }).join('');
    const usable = Object.values(d.factors).filter((v) => v.dir !== 0).length;
    box.innerHTML = `
      <div class="pk-note${usable === 0 ? ' warn' : ''}">
        ${d.nCuts} 个截面 · 未来 ${d.horizon} 日 ·
        <b>${usable}</b> / ${Object.keys(d.factors).length} 个因子达到 |t|≥2
        ${usable === 0 ? '—— <b>当前没有可靠方向，推票会失去区分度</b>' : ''}
      </div>
      <table class="pk-table">
        <thead><tr><th>因子</th><th>Q5−Q1</th><th>t 值</th><th>方向</th><th>一致度</th><th>各期价差(%)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="pk-hint">
        判定：|t| ≥ 3 标「可用」；2 ≤ |t| < 3 标「边界」——<b>边界档的方向随时可能翻转</b>
        （实测同一因子换池子大小就从 −3.14 翻到 +2.04）。一致度 = 同向截面占比。
      </div>`;
  }

  /* ---------- 推票结果 ---------- */
  function renderPicks(r) {
    const box = U.$('#pkResult');
    if (!box) return;
    if (!r || !r.ok) {
      box.innerHTML = `<div class="loading">${U.esc((r && r.error) || '扫描失败')}</div>`;
      return;
    }
    const rows = r.picks.map((p) => {
      const st = p.structure || {};
      const stTxt = [
        st.position ? ({ above: '中枢上方', inside: '中枢内', below: '中枢下方' }[st.position] || st.position) : '',
        Number.isFinite(st.pivots) ? `${st.pivots} 个中枢` : '',
        st.lastSignal ? `${st.lastSignal}${Number.isFinite(st.sigAgeBars) ? `(${st.sigAgeBars}根前)` : ''}` : '',
      ].filter(Boolean).join(' · ');
      return `<tr>
        <td class="pk-rank">${p.rank}</td>
        <td><b>${U.esc(p.name || '')}</b><div class="muted tiny">${U.esc(p.code)} · ${U.esc(p.board || '')}</div></td>
        <td class="pk-total">${p.total}</td>
        <td class="muted tiny">${fmtPct(p.metrics.mom20, 1)} / ${fmtPct(p.metrics.dev60, 1)} / ${fmtPct(p.metrics.ret5, 1)}</td>
        <td class="muted tiny">${fmtPct(p.metrics.vol20, 1)} / ${fmtPct(p.metrics.vstd20, 1)}</td>
        <td class="muted tiny">${Number.isFinite(p.metrics.amt20) ? (p.metrics.amt20 / 1e8).toFixed(1) + '亿' : '—'}</td>
        <td class="muted tiny">${U.esc(stTxt || '—')}</td>
      </tr>`;
    }).join('');

    const dirKeys = Object.entries(r.dirs || {}).filter(([, v]) => v !== null && v !== undefined);
    box.innerHTML = `
      <div class="pk-note">
        ${U.esc(r.note || '')} · 耗时 ${(r.elapsedMs / 1000).toFixed(1)}s
        ${dirKeys.length ? `<br>生效方向：${dirKeys.map(([k, v]) => `${k}=${dirText(v)}`).join('，')}` : '<br><b>未指定方向</b>：排序主要由流动性与结构决定，不代表选股观点'}
      </div>
      <table class="pk-table">
        <thead><tr>
          <th>#</th><th>标的</th><th>总分</th>
          <th>动量/偏离/5日</th><th>波动/量波动</th><th>日均成交</th><th>缠论结构</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="pk-hint">
        分数是**截面分位**加权（0–100），只表示"在这批候选里的相对位置"，不是收益预测。
        实测这批因子在 10 日尺度上方向不稳，请结合上面的方向表一起看。
      </div>`;
  }

  /* ---------- 历史检验 ---------- */
  function renderValidate(v) {
    const box = U.$('#pkValidate');
    if (!box) return;
    if (!v || !v.ok) {
      box.innerHTML = `<div class="loading">${U.esc((v && v.error) || '检验失败')}</div>`;
      return;
    }
    const s = v.summary;
    const g = s.groupAvg.map((x, i) => `<span class="pk-gc">Q${i + 1}<b class="${x > 0 ? 'up' : 'down'}">${x == null ? '—' : x + '%'}</b></span>`).join('');
    const sig = s.tIc !== null && Math.abs(s.tIc) >= 2;
    box.innerHTML = `
      <div class="pk-note${sig ? '' : ' warn'}">
        ${s.nSections} 个截面 · 池 ${v.poolSize} 只 ·
        IC 均值 <b>${s.meanIc ?? '—'}</b> · t = <b>${s.tIc ?? '—'}</b> ·
        多空价差 <b>${s.meanSpread ?? '—'}%</b> · 单调性 <b>${s.monotonicity ?? '—'}</b>
        ${sig ? '' : '—— <b>不显著</b>，不能据此认为打分有效'}
      </div>
      <div class="pk-groups">${g}</div>
      ${v.caveat ? `<div class="pk-hint warn">⚠ ${U.esc(v.caveat)}</div>` : ''}
      <table class="pk-table">
        <thead><tr><th>截面</th><th>样本</th><th>IC</th><th>多空价差</th><th>分组收益</th></tr></thead>
        <tbody>${v.sections.map((x) => `<tr>
          <td>${x.cut}</td><td>${x.n}</td>
          <td class="${x.ic > 0 ? 'up' : x.ic < 0 ? 'down' : ''}">${x.ic ?? '—'}</td>
          <td>${x.spread ?? '—'}%</td>
          <td class="muted tiny">${(x.groups || []).join(' / ')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  /* ---------- 动作 ---------- */
  async function loadDirs() {
    const box = U.$('#pkDirs');
    if (box) box.innerHTML = '<div class="loading">估计因子方向（约 30–60 秒）…</div>';
    try {
      const d = await API.get('/api/picks/directions?' + qs({
        topN: Number(U.$('#pkPool')?.value || 150),
        cuts: Number(U.$('#pkCuts')?.value || 6),
        horizon: Number(U.$('#pkHorizon')?.value || 10),
      }));
      lastDirs = d;
      renderDirs(d);
      // 把显著方向回填到输入框
      const usable = Object.entries(d.factors || {}).filter(([, v]) => v.dir !== 0)
        .reduce((acc, [k, v]) => { acc[k] = v.dir; return acc; }, {});
      const inp = U.$('#pkDirsJson');
      if (inp) inp.value = Object.keys(usable).length ? JSON.stringify(usable) : '';
      return usable;
    } catch (e) {
      renderDirs({ ok: false, error: String(e.message || e) });
      return {};
    }
  }

  async function runScan() {
    const box = U.$('#pkResult');
    if (box) box.innerHTML = '<div class="loading">扫描全市场…</div>';
    let dirs = null;
    const raw = (U.$('#pkDirsJson')?.value || '').trim();
    if (raw) { try { dirs = JSON.parse(raw); } catch (e) { dirs = null; } }
    try {
      const r = await API.get('/api/picks?' + qs({
        topN: Number(U.$('#pkPool')?.value || 300),
        pickCount: Number(U.$('#pkCount')?.value || 10),
        dirs: dirs || '',
      }));
      lastScan = r;
      renderPicks(r);
    } catch (e) {
      renderPicks({ ok: false, error: String(e.message || e) });
    }
  }

  async function runValidate() {
    const box = U.$('#pkValidate');
    if (box) box.innerHTML = '<div class="loading">跑历史检验（约 20–40 秒）…</div>';
    try {
      const v = await API.get('/api/picks/validate?' + qs({
        topN: Number(U.$('#pkPool')?.value || 150),
        cuts: Number(U.$('#pkCuts')?.value || 6),
        horizon: Number(U.$('#pkHorizon')?.value || 10),
      }));
      renderValidate(v);
    } catch (e) {
      renderValidate({ ok: false, error: String(e.message || e) });
    }
  }

  function bind() {
    U.$('#pkBtnDirs')?.addEventListener('click', loadDirs);
    U.$('#pkBtnScan')?.addEventListener('click', runScan);
    U.$('#pkBtnValidate')?.addEventListener('click', runValidate);
    U.$('#pkBtnRecord')?.addEventListener('click', recordPicks);
    U.$('#pkBtnSettle')?.addEventListener('click', settleLedger);
    U.$('#pkBtnRefresh')?.addEventListener('click', loadLedger);
  }

  /* ---------- 台账 ---------- */
  function renderLedgerStats(s) {
    const box = U.$('#pkLedgerStats');
    if (!box) return;
    if (!s || !s.ok) { box.innerHTML = `<div class="loading">${U.esc((s && s.error) || '读取失败')}</div>`; return; }
    const bad = !s.conclusive;
    const winRate = s.winRate === null ? '—' : s.winRate + '%';
    box.innerHTML = `
      <div class="pk-note${bad ? ' warn' : ''}">
        台账 <b>${s.total}</b> 条 · 未结算 <b>${s.open}</b> · 已结算 <b>${s.settled}</b>
        （成交 ${s.filled} / 未成交 ${s.notFilled}）<br>
        胜率 <b>${winRate}</b> · 平均收益 <b>${s.avgRetPct ?? '—'}%</b> ·
        胜 ${s.wins} / 负 ${s.losses}
        <br><b>${U.esc(s.verdict || '')}</b>
      </div>
      <div class="pk-groups">
        <span class="pk-gc">达标<b class="up">${s.byResult.hit_target}</b></span>
        <span class="pk-gc">到期盈<b class="up">${s.byResult.expired_win}</b></span>
        <span class="pk-gc">到期亏<b class="down">${s.byResult.expired_loss}</b></span>
        <span class="pk-gc">止损<b class="down">${s.byResult.stopped}</b></span>
        <span class="pk-gc">未成交<b>${s.byResult.not_filled}</b></span>
      </div>`;
  }

  function renderLedgerList(d) {
    const box = U.$('#pkLedgerList');
    if (!box) return;
    if (!d || !d.ok) { box.innerHTML = `<div class="loading">${U.esc((d && d.error) || '读取失败')}</div>`; return; }
    if (!d.entries.length) { box.innerHTML = '<div class="empty">台账为空，点「记录当前推票」开始积累</div>'; return; }
    const resMap = {
      hit_target: '达标', expired_win: '到期盈', expired_loss: '到期亏',
      stopped: '止损', not_filled: '未成交',
    };
    const rows = d.entries.map((e) => {
      const cls = /hit_target|expired_win/.test(e.result) ? 'up' : /stopped|expired_loss/.test(e.result) ? 'down' : 'muted';
      return `<tr>
        <td>${U.esc(e.pickDate)}</td>
        <td><b>${U.esc(e.name || '')}</b><div class="muted tiny">${U.esc(e.code)}</div></td>
        <td class="muted tiny">${e.buyLow}~${e.buyHigh}</td>
        <td class="muted tiny">${e.stop} / ${e.target}</td>
        <td class="${cls}">${e.status === 'settled' ? (resMap[e.result] || e.result) : '持有中'}</td>
        <td class="muted tiny">${Number.isFinite(e.retPct) ? e.retPct + '%' : (e.settlePx ? '—' : '—')}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table class="pk-table">
      <thead><tr><th>推票日</th><th>标的</th><th>买入区间</th><th>止损/目标</th><th>结果</th><th>收益</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="pk-hint">共 ${d.total} 条，显示最近 ${d.entries.length} 条。结算口径：T 日推票 → T+1 开盘价成交 → 持有 N 日或触及止损/目标。</div>`;
  }

  async function loadLedger() {
    try {
      const [s, d] = await Promise.all([
        API.get('/api/picks/ledger/stats'),
        API.get('/api/picks/ledger?limit=60'),
      ]);
      renderLedgerStats(s);
      renderLedgerList(d);
    } catch (e) {
      renderLedgerStats({ ok: false, error: String(e.message || e) });
    }
  }

  async function recordPicks() {
    const box = U.$('#pkLedgerStats');
    if (box) box.innerHTML = '<div class="loading">扫描并记录（约 40 秒）…</div>';
    let dirs = null;
    const raw = (U.$('#pkDirsJson')?.value || '').trim();
    if (raw) { try { dirs = JSON.parse(raw); } catch (e) { dirs = null; } }
    try {
      const r = await API.get('/api/picks/ledger/record?' + qs({
        topN: Number(U.$('#pkPool')?.value || 200),
        pickCount: Number(U.$('#pkCount')?.value || 10),
        holdDays: Number(U.$('#pkHorizon')?.value || 10),
        dirs: dirs || '',
      }));
      if (!r.ok) { U.toast('记录失败：' + (r.error || '')); return; }
      U.toast(`已记录：新增 ${r.added} 条，重复跳过 ${r.duplicates} 条`);
      await loadLedger();
    } catch (e) {
      U.toast('记录失败：' + (e.message || e));
    }
  }

  async function settleLedger() {
    const box = U.$('#pkLedgerStats');
    if (box) box.innerHTML = '<div class="loading">结算未到期条目…</div>';
    try {
      const r = await API.get('/api/picks/ledger/settle');
      U.toast(`结算完成：${r.settled} 条，失败 ${r.failed} 条`);
      await loadLedger();
    } catch (e) {
      U.toast('结算失败：' + (e.message || e));
    }
  }

  /* 与其它页面统一：router 调 render() */
  let bound = false;
  async function render() {
    if (!bound) { bind(); bound = true; }
    // 首次进入先跑方向估计，让用户立刻看到"当前有没有可靠方向"
    if (!lastDirs) await loadDirs();
    await loadLedger();
  }

  window.PagePicks = { render, runScan, runValidate, loadDirs, loadLedger, recordPicks, settleLedger };
})();
