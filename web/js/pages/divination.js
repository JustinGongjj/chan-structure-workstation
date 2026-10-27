/* 算卦择时 · 按标的代码 + 实时行情 + 时辰起卦 */
(function () {
  const state = {
    market: 'A',
    symbol: '600519',
    mode: 'price',
    time: '',
    timeFixed: false,
    nonce: 0,
    live: false,
    timer: null,
    last: null,
    history: [],
    busy: false,
    timing: { methods: ['ganzhi', 'meihua', 'liuyao', 'jianchu', 'cycle', 'ziwei', 'qimen'], data: null, valid: null },
  };

  /* ---------------- 工具 ---------------- */
  function nowLocal() {
    const d = new Date(Date.now() + 8 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }

  /** 根据输入自动识别市场：USDT→加密、纯字母→美股、5 位→港股、6 位→A股 */
  function guessMarket(raw) {
    const s = String(raw || '').trim().toUpperCase();
    if (!s) return state.market;
    const bare = s.replace(/^(SH|SZ|BJ)/, '');
    if (/USDT$/.test(s)) return 'CR';
    if (/^\d{6}$/.test(bare)) return 'A';
    if (/^\d{5}$/.test(bare)) return 'HK';
    if (/^[A-Z][A-Z.\-]{0,9}$/.test(s)) return 'US';
    if (/^\d+$/.test(bare)) return bare.length <= 5 ? 'HK' : 'A';
    return state.market;
  }

  function setMarket(m) {
    state.market = m;
    U.$$('#divMarket .sq').forEach((b) => b.classList.toggle('active', b.dataset.market === m));
  }

  /* ---------------- 起卦 ---------------- */
  async function cast({ advance = true, quiet = false } = {}) {
    if (state.busy) return;
    state.busy = true;
    const btn = U.$('#divCast');
    if (btn) btn.textContent = '起卦中…';

    const symInput = U.$('#divSymbol');
    const typed = (symInput.value || '').trim() || state.symbol;
    const guessed = guessMarket(typed);
    if (guessed !== state.market) {
      setMarket(guessed);
      if (!quiet) U.toast(`已识别为${U.MK[guessed]}标的：${typed}`);
    }
    state.symbol = typed;
    if (advance) state.nonce += 1;

    const params = {
      market: state.market,
      code: state.symbol,
      mode: state.mode,
      nonce: state.nonce,
    };
    const timeInput = U.$('#divTime');
    if (!state.timeFixed) {
      state.time = nowLocal();
      if (timeInput) timeInput.value = state.time;
    }
    if (state.timeFixed && state.time) {
      const ts = Date.parse(state.time + ':00+08:00');
      if (Number.isFinite(ts)) params.ts = ts;
    }

    try {
      const res = await API.divination(params);
      const sig = `${res.hexagram.ben.name}#${res.hexagram.dong}#${res.hexagram.bian.name}`;
      const prev = state.last;
      state.last = { sig, res };
      renderHex(res);
      renderLiuYao(res);
      renderTime(res);
      renderNarrative(res);
      renderAdvice(res);
      renderBasis(res);
      pushHistory(res, sig);
      if (prev && prev.sig !== sig) {
        U.toast(`卦变：${prev.res.hexagram.ben.name} → ${res.hexagram.ben.name}（动第 ${res.hexagram.dong} 爻）`);
      }
      loadTiming();
      U.$('#divLiveTag').innerHTML = state.live
        ? '<span class="live-dot"><i></i>实时跟随 · 12s</span>'
        : `<span class="hint">最后起卦 ${new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 19)}</span>`;
    } catch (e) {
      U.toast('起卦失败：' + e.message);
      U.$('#divHexCard').innerHTML = '<div class="loading">起卦失败：' + U.esc(e.message) + '</div>';
    } finally {
      state.busy = false;
      if (btn) btn.textContent = '起 卦';
    }
  }

  /* ---------------- 渲染：卦象 ---------------- */
  function hexSymbol(lines, dong) {
    return lines
      .map((v, i) => {
        const pos = i + 1;
        const cls = v === 1 ? 'line' : 'line yin';
        return `<div class="${cls} ${pos === dong ? 'dong' : ''}" title="第${pos}爻"></div>`;
      })
      .reverse()
      .join('');
  }

  function renderHex(res) {
    const h = res.hexagram;
    const p = res.pillars;
    const score = Math.max(0, Math.min(100, h.score || 0));
    const q = res.quote || {};
    const tgt = res.target || {};
    const quoteTxt =
      q.price != null
        ? `<div class="hex-quote">现价 <b class="${U.cls(q.pct)}">${U.fmt(q.price)}</b> <span class="${U.cls(q.pct)}">${U.pct(q.pct)}</span><span class="hint" style="margin-left:8px">${U.esc(U.MK[tgt.market] || tgt.market || '')} · ${U.esc(tgt.symbol || '')}${q.name ? ' · ' + U.esc(q.name) : ''}</span></div>`
        : `<div class="hex-quote hint">${U.esc(U.MK[tgt.market] || tgt.market || '')} · ${U.esc(tgt.symbol || '')}（时辰起卦，不取实时价）</div>`;

    U.$('#divHexCard').innerHTML = `
    <div class="hex-head">
      <div class="hex-sym">${hexSymbol(h.lines, h.dong)}</div>
      <div style="min-width:0">
        <div class="hex-title">${U.esc(h.ben.name)}</div>
        <div class="hint" style="margin-top:4px">第 ${h.ben.id} 卦 · ${U.esc(h.ben.dun)} · 第 ${res.seed ? res.seed.nonce + 1 : 1} 占 · 动爻第 ${h.dong} 爻</div>
        ${quoteTxt}
        <div style="margin-top:8px;font-size:12px;color:var(--muted);line-height:1.8">卦辞：${U.esc(h.ben.guaCi)}<br>象曰：${U.esc(h.ben.baiHua)}</div>
      </div>
      <div style="margin-left:auto;text-align:right;min-width:170px">
        <div class="hint">体用生克（交易倾向）</div>
        <div style="font-size:26px;font-weight:700" class="${score >= 60 ? 'up' : score <= 40 ? 'down' : ''}">${score}</div>
        <div class="meter"><i style="width:${score}%"></i></div>
        <div class="hint" style="margin-top:6px">${U.esc(h.relation.text)} · ${U.esc(h.relation.level)}</div>
        <div class="hex-live" style="margin-top:6px;justify-content:flex-end">${U.esc(res.methodLabel || '')}</div>
      </div>
    </div>
    <div class="hex-grid">
      <div class="hex-box"><div class="lb">本卦</div><div class="nm">${U.esc(h.ben.name)}</div><div class="ds">${U.esc(h.ben.trade)}</div></div>
      <div class="hex-box"><div class="lb">互卦（内里）</div><div class="nm">${U.esc(h.hu.name)}</div><div class="ds">${U.esc(h.hu.trade)}</div></div>
      <div class="hex-box"><div class="lb">变卦（去向）</div><div class="nm">${U.esc(h.bian.name)}</div><div class="ds">${U.esc(h.bian.trade)}</div></div>
    </div>
    <div class="cal-strip" style="margin-top:14px">
      <div class="ci"><span class="lab">上卦</span><span class="val">${U.esc(h.upper.name)}·${U.esc(h.upper.nature)}·${U.esc(h.upper.element)}</span></div>
      <div class="ci"><span class="lab">下卦</span><span class="val">${U.esc(h.lower.name)}·${U.esc(h.lower.nature)}·${U.esc(h.lower.element)}</span></div>
      <div class="ci"><span class="lab">体</span><span class="val">${U.esc(h.ti.name)}·${U.esc(h.ti.element)}</span></div>
      <div class="ci"><span class="lab">用</span><span class="val">${U.esc(h.yong.name)}·${U.esc(h.yong.element)}</span></div>
      <div class="ci"><span class="lab">四柱</span><span class="val" style="font-size:13px">${p.year.text} ${p.month.text} ${p.day.text} ${p.hour.text}</span></div>
      <div class="ci"><span class="lab">建除</span><span class="val">${res.jianchu}</span></div>
      <div class="ci"><span class="lab">冲</span><span class="val">${res.chong.animal}</span></div>
      <div class="ci"><span class="lab">旬空</span><span class="val">${res.kong.join(' ')}</span></div>
    </div>`;
  }

  /* ---------------- 渲染：六爻 / 时辰 / 解读 ---------------- */
  function renderLiuYao(res) {
    const ly = res.liuyao;
    const rows = ly.yaos
      .map(
        (y) => `<tr class="${y.dong ? 'dong' : ''} ${y.kong ? 'kong' : ''}">
      <td>${y.pos}</td><td>${y.liushen}</td><td>${y.liuqin}</td>
      <td>${U.esc(y.zhi + y.element)}</td>
      <td>${y.yin}${y.dong ? ' ●' : ''}</td>
      <td style="color:var(--gold)">${y.shi ? '世' : y.ying ? '应' : ''}</td>
      <td>${y.kong ? '空' : ''}</td>
    </tr>`
      )
      .join('');
    U.$('#divLiuyao').innerHTML = `
      <div class="card-head"><h3>六爻排盘</h3><span class="hint">${U.esc(ly.palace)}宫 · ${U.esc(ly.gongEl)} · 世${ly.shi}应${ly.ying}</span></div>
      <table class="yao-tbl">
        <thead><tr><th>爻</th><th>六神</th><th>六亲</th><th>纳甲</th><th>阴阳</th><th>世应</th><th>空</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="hint" style="margin-top:10px">变卦「${U.esc(res.hexagram.bian.name)}」对应动爻：${res.dongYao ? U.esc(res.dongYao.liuqin + '·' + res.dongYao.zhi + res.dongYao.element) : '—'}</div>`;
  }

  function renderTime(res) {
    const cells = res.shichen
      .map(
        (s) => `<div class="sc ${s.active ? 'now' : ''}">
      <div class="t">${s.name} <span class="hint">${s.range}</span></div>
      <div class="${s.label === '吉' ? 'j 吉' : s.label === '凶' ? 'j 凶' : s.label === '泄' ? 'j 泄' : 'j 平'}">${s.label} · ${s.text}</div>
    </div>`
      )
      .join('');
    U.$('#divTimeCard').innerHTML = `
      <div class="card-head"><h3>十二时辰 · 体卦生克</h3><span class="hint">当前时辰高亮</span></div>
      <div class="sc-grid">${cells}</div>
      <div class="hint" style="margin-top:10px">${U.esc((res.shichen.find((s) => s.active) || {}).hint || '')}</div>`;
  }

  function renderNarrative(res) {
    U.$('#divNarrative').innerHTML = `
      <div class="card-head"><h3>卦象解读</h3><span class="hint">与缠论结构并列参考</span></div>
      ${res.narrative.map((p) => `<p style="font-size:12px;line-height:2;color:var(--muted);margin-bottom:8px">${U.esc(p)}</p>`).join('')}
      <div class="hint" style="margin-top:8px">${U.esc(res.disclaimer)}</div>`;
  }

  function renderAdvice(res) {
    U.$('#divAdvice').innerHTML = `
      <div style="margin-bottom:6px;color:var(--ink-gold);font-size:12px">今日宜忌（建除法）</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${res.advice.good.map((g) => `<span class="chip green">宜 ${U.esc(g)}</span>`).join('')}
        ${res.advice.bad.map((g) => `<span class="chip red">忌 ${U.esc(g)}</span>`).join('')}
      </div>
      <div class="hint" style="margin-top:8px">${U.esc(res.advice.tip)}</div>`;
  }

  /* ---------------- 渲染：取数依据 + 历史 ---------------- */
  function renderBasis(res) {
    const seed = res.seed;
    if (!seed) {
      U.$('#divBasis').innerHTML = '';
      return;
    }
    const rows = seed.parts
      .map(
        (p) =>
          `<div class="basis-row"><span class="k">${U.esc(p.label)}</span><span class="v">${U.esc(String(p.value))}<small>${U.esc(p.detail || '')}</small></span></div>`
      )
      .join('');
    const q = res.quote || {};
    const qRow =
      q.price != null
        ? `<div class="basis-row"><span class="k">实时报价</span><span class="v" style="color:var(--muted)">${U.fmt(q.price)} / ${U.pct(q.pct)}</span></div>`
        : '';
    U.$('#divBasis').innerHTML = `<h5>本次取数依据</h5>${rows}${qRow}<div class="hint" style="margin-top:6px">${U.esc(res.methodLabel || '')}：${
      seed.mode === 'time' ? '同一时辰内同一标的固定一卦' : '代码 / 现价档 / 占次任一变化都会换卦'
    }</div>`;
  }

  function pushHistory(res, sig) {
    state.history.unshift({
      sig,
      name: res.hexagram.ben.name,
      dong: res.hexagram.dong,
      bian: res.hexagram.bian.name,
      price: (res.quote || {}).price,
      code: (res.target || {}).symbol,
      at: new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 19),
    });
    state.history = state.history.slice(0, 6);
    renderHistory();
  }

  function renderHistory() {
    if (!state.history.length) {
      U.$('#divHistory').innerHTML = '';
      return;
    }
    U.$('#divHistory').innerHTML =
      `<h5>最近起卦</h5>` +
      state.history
        .map(
          (h) => `<div class="hist-item">
        <span class="h1">${U.esc(h.name)}</span>
        <span class="h2">动${h.dong} → ${U.esc(h.bian)}${h.price != null ? ' · ' + U.fmt(h.price) : ''}</span>
        <span class="h2">${h.at}</span>
      </div>`
        )
        .join('');
  }

  /* ---------------- 择时方法实验室 ---------------- */
  const TM_META = [
    ['ganzhi', '四柱·节气五行'],
    ['meihua', '梅花易数'],
    ['liuyao', '六爻纳甲'],
    ['jianchu', '建除十二神'],
    ['cycle', '日历周期因子'],
    ['ziwei', '紫微斗数'],
    ['qimen', '奇门遁甲'],
  ];

  function renderTimingChips() {
    const box = U.$('#timingMethods');
    if (!box) return;
    box.innerHTML = TM_META.map(
      ([id, name]) =>
        `<button class="chip tm-chip ${state.timing.methods.includes(id) ? 'on' : ''}" data-tm="${id}">${name}</button>`
    ).join('');
    U.$$('#timingMethods .tm-chip').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.tm;
        const has = state.timing.methods.includes(id);
        if (has && state.timing.methods.length === 1) return U.toast('至少保留一个方法');
        state.timing.methods = has ? state.timing.methods.filter((x) => x !== id) : [...state.timing.methods, id];
        renderTimingChips();
        loadTiming();
      })
    );
  }

  async function loadTiming() {
    const box = U.$('#timingBody');
    if (!box) return;
    try {
      const res = await API.timing({ market: state.market, code: state.symbol, methods: state.timing.methods.join(',') });
      state.timing.data = res;
      renderTiming(res);
    } catch (e) {
      box.innerHTML = `<div class="hint">择时计算失败：${U.esc(e.message)}</div>`;
    }
  }

  function renderTiming(res) {
    const box = U.$('#timingBody');
    const comp = res.composite;
    const color = comp >= 58 ? 'var(--down)' : comp <= 42 ? 'var(--up)' : 'var(--gold)';
    const rows = Object.values(res.methods)
      .map((m) => {
        const c = m.score >= 58 ? 'var(--down)' : m.score <= 42 ? 'var(--up)' : 'var(--gold)';
        return `<div class="tm-row" title="${U.esc(m.reasons.slice(1).join('；'))}">
          <span class="nm">${U.esc(m.name)}</span>
          <span class="bar"><i style="width:${m.score}%;background:${c}"></i></span>
          <span class="sc" style="color:${c}">${m.score}</span>
          <span class="chip">${U.esc(m.label)}</span>
        </div>`;
      })
      .join('');
    box.innerHTML = `
      <div class="row between" style="margin-bottom:8px">
        <div>
          <div class="hint">加权综合分（${Object.keys(res.methods).length} 个方法 · 一致性 ${(res.agreement * 100).toFixed(0)}%）</div>
          <div style="font-size:26px;font-weight:800;color:${color}">${comp.toFixed(1)} <span style="font-size:13px;font-weight:500">${U.esc(res.label)}</span></div>
        </div>
        <div class="hint" style="text-align:right;max-width:220px">${U.esc(res.verdict.text)}</div>
      </div>
      ${rows}
      ${renderZiweiPlate(res)}
      ${renderQimenPlate(res)}
      <div class="hint" style="margin-top:8px">${U.esc(res.disclaimer)}</div>`;
  }

  function renderZiweiPlate(res) {
    const z = res.methods.ziwei && res.methods.ziwei.detail;
    if (!z || !z.palaces) return '';
    const cells = z.palaces
      .map(
        (p) => `<div class="zw-cell${p.name === '命宫' ? ' soul' : ''}">
        <div class="zw-h">${U.esc(p.stem + p.branch)} <span>${U.esc(p.name)}</span></div>
        <div class="zw-s">${p.stars.length ? p.stars.map((x) => U.esc(x)).join(' ') : '<span class="hint">空宫</span>'}</div>
      </div>`
      )
      .join('');
    return `<div class="tm-plate">
      <div class="tm-plate-h">紫微斗数 · 流日盘 <span class="hint">${U.esc(z.lunar)} · ${U.esc(z.hour)} · ${U.esc(z.fiveElements)} · 紫微在${U.esc(z.ziwei)}</span></div>
      <div class="zw-grid">${cells}</div>
      <div class="hint" style="margin-top:6px">命宫 ${U.esc(z.soul.stem + z.soul.branch)}：${z.soul.stars.map(U.esc).join('、') || '无主星'}${z.soul.hua.length ? '（' + z.soul.hua.map((h) => '化' + h).join('') + '）' : ''}</div>
    </div>`;
  }

  function renderQimenPlate(res) {
    const q = res.methods.qimen && res.methods.qimen.detail;
    if (!q || !q.cells) return '';
    const byPalace = Object.fromEntries(q.cells.map((c) => [c.palace, c]));
    const cells = (q.layout || [4, 9, 2, 3, 5, 7, 8, 1, 6])
      .map((p) => {
        const c = byPalace[p];
        return `<div class="qm-cell${c && c.hourStem ? ' hg' : ''}">
        <div class="qm-h">${U.esc(c.name)}<span>${U.esc(c.dir)}</span></div>
        <div class="qm-yi">${U.esc(c.yi || '')}</div>
        <div class="qm-s">${U.esc(c.door || '—')} · ${U.esc(c.star || '')} · ${U.esc(c.god || '—')}</div>
      </div>`;
      })
      .join('');
    return `<div class="tm-plate">
      <div class="tm-plate-h">奇门遁甲 · 时家 <span class="hint">${U.esc(q.dun)}遁${q.ju}局 · ${U.esc(q.term)}${U.esc(q.yuan)} · 值符${U.esc(q.zhiFu.star)} 值使${U.esc(q.zhiShi.door)}</span></div>
      <div class="qm-grid">${cells}</div>
      <div class="hint" style="margin-top:6px">高亮宫＝时干所临（用神宫）· 中宫不排门神，天禽寄坤</div>
    </div>`;
  }

  async function runTimingValidate() {
    const box = U.$('#timingValidateBody');
    const hint = U.$('#timingValidateHint');
    if (!box) return;
    box.innerHTML = '<div class="hint">检验中（逐日回算 120 天）…</div>';
    if (hint) hint.textContent = '检验中…';
    try {
      const res = await API.timingValidate({ market: state.market, code: state.symbol, days: 120, horizon: 1 });
      state.timing.valid = res;
      const rows = res.methods
        .map((m) => {
          const c = m.corr == null ? 'var(--faint)' : m.corr > 0.05 ? 'var(--down)' : m.corr < -0.05 ? 'var(--up)' : 'var(--faint)';
          return `<tr>
            <td class="name">${U.esc((TM_META.find(([id]) => id === m.id) || [, m.id])[1])}</td>
            <td style="color:${c}">${m.corr == null ? '—' : m.corr.toFixed(3)}</td>
            <td>${m.high.n ? (m.high.winRate * 100).toFixed(0) + '%' : '—'}</td>
            <td>${m.high.n || 0}</td>
            <td>${m.spread == null ? '—' : (m.spread * 100).toFixed(1) + 'pp'}</td>
          </tr>`;
        })
        .join('');
      const v = res.verdict;
      const cls = v.level === 'positive' ? 'bt-ok' : v.level === 'insufficient' ? '' : 'bt-warn';
      box.innerHTML = `
        <div class="hint">样本 ${res.days} 日 · 持有 ${res.horizon} 根 · 基线 ${(res.baseline.avgRet * 100).toFixed(3)}%/次 · 综合分与次日收益 r=${res.corr == null ? '—' : res.corr}</div>
        <table class="bt-table"><thead><tr><th>方法</th><th>相关系数 r</th><th>高分组命中</th><th>样本</th><th>高低差</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="${cls || 'hint'}" style="margin-top:8px">${U.esc(v.text)}</div>
        <div class="hint" style="margin-top:6px">口径：每天用当日数据算分，看次日收盘相对当日收盘的涨跌；相关系数接近 0 说明该方法对涨跌没有预测力。</div>`;
      if (hint) hint.textContent = `已检验 · n=${res.days}`;
    } catch (e) {
      box.innerHTML = `<div class="hint">检验失败：${U.esc(e.message)}</div>`;
      if (hint) hint.textContent = '失败';
    }
  }

  /* ---------------- 事件 ---------------- */
  function setLive(on) {
    state.live = on;
    const btn = U.$('#divLive');
    if (btn) {
      btn.classList.toggle('live-on', on);
      btn.textContent = on ? '实时跟随 · 开' : '实时跟随 · 关';
    }
    clearInterval(state.timer);
    state.timer = null;
    if (on) state.timer = setInterval(() => cast({ advance: false, quiet: true }), 12000);
    const tag = U.$('#divLiveTag');
    if (tag && !on) tag.innerHTML = '<span class="hint">实时跟随已关闭</span>';
  }

  document.addEventListener('DOMContentLoaded', () => {
    // 深链：?code=NVDA&mode=price&market=US 可直接带标的进来
    const qp = new URLSearchParams(location.search);
    const qCode = qp.get('code');
    if (qCode) {
      state.symbol = qCode.trim();
      U.$('#divSymbol').value = state.symbol;
      setMarket(guessMarket(state.symbol));
    }
    const qMode = qp.get('mode');
    if (qMode === 'time' || qMode === 'price') {
      state.mode = qMode;
      U.$$('#divMode .sq').forEach((x) => x.classList.toggle('active', x.dataset.mode === qMode));
    }
    U.$$('#divMarket .sq').forEach((b) =>
      b.addEventListener('click', () => {
        setMarket(b.dataset.market);
        const def = { A: '600519', HK: '00700', US: 'NVDA', CR: 'BTCUSDT' };
        state.symbol = def[b.dataset.market];
        U.$('#divSymbol').value = state.symbol;
        cast({ advance: true });
      })
    );
    U.$$('#divMode .sq').forEach((b) =>
      b.addEventListener('click', () => {
        U.$$('#divMode .sq').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        state.mode = b.dataset.mode;
        cast({ advance: true });
      })
    );
    const sym = U.$('#divSymbol');
    sym.addEventListener('input', () => {
      state.symbol = sym.value.trim();
    });
    sym.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        cast({ advance: true });
      }
    });
    const t = U.$('#divTime');
    t.value = nowLocal();
    state.time = t.value;
    t.addEventListener('input', () => {
      state.time = t.value;
      state.timeFixed = true;
      cast({ advance: true, quiet: true });
    });
    renderTimingChips();
    const tv = U.$('#timingValidate');
    if (tv) tv.addEventListener('click', runTimingValidate);
    U.$('#divCast').addEventListener('click', () => cast({ advance: true }));
    U.$('#divLive').addEventListener('click', () => setLive(!state.live));
    U.$('#castNow').addEventListener('click', () => {
      state.timeFixed = false;
      t.value = nowLocal();
      state.time = t.value;
      cast({ advance: true });
    });
  });

  window.PageDivination = {
    render: () => {
      renderTimingChips();
      return cast({ advance: false });
    },
  };
})();
