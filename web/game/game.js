/* 缠关 · 108 —— 独立闯关小游戏
   玩法：每关用实时行情生成一道题（看下一段走势 / 找买卖点 / 框中枢 / 判背驰），
   交卷后服务端判分，给出讲解与缠论要点。进度存本地。 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const app = $('#app');
  const KEY = 'changuan-progress-v1';
  const MECH_NAME = { predict: '看走势', signal: '找买卖点', pivot: '框中枢', beichi: '判背驰' };
  const MECH_HINT = {
    predict: '根据当前走势判断接下来 12~20 根日线的方向',
    signal: '在图上点出买卖点所在的 K 线',
    pivot: '拖一个框，把中枢框出来',
    beichi: '判断最后一段有没有背驰'
  };

  let map = null;
  let chart = null;
  let level = null;
  let picked = null;     // predict/beichi 的选择
  let pickedIdx = null;  // signal 点的 K 线
  let pickMode = false;
  let graded = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw || typeof raw !== 'object' || typeof raw.levels !== 'object' || raw.levels === null) throw new Error('bad shape');
      return { levels: raw.levels, streak: Number(raw.streak) || 0, best: Number(raw.best) || 0 };
    } catch (e) {
      try { localStorage.removeItem(KEY); } catch (e2) {}
      return { levels: {}, streak: 0, best: 0 };
    }
  }
  function save(p) { localStorage.setItem(KEY, JSON.stringify(p)); }
  let prog = load();

  const stats = () => {
    const vals = Object.values(prog.levels);
    const done = vals.length;
    const stars = vals.reduce((s, v) => s + (v.stars || 0), 0);
    const acc = done ? Math.round(vals.reduce((s, v) => s + (v.score || 0), 0) / done) : 0;
    const nextNo = (() => { for (let i = 1; i <= 108; i++) if (!prog.levels[i]) return i; return 108; })();
    return { done, stars, acc, nextNo };
  };
  const rankOf = (no) => (no <= 27 ? '青铜' : no <= 54 ? '白银' : no <= 81 ? '黄金' : '王者');

  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------------- 首页：地图 ---------------- */
  async function renderHome() {
    destroyChart();
    const s = stats();
    const unlockedMax = s.done ? Math.max(...Object.keys(prog.levels).map(Number)) + 1 : 1;
    $('#rankPill').textContent = rankOf(Math.min(108, Math.max(1, s.nextNo)));
    app.innerHTML = `
      <section class="hero">
        <h1>缠关 · 108</h1>
        <p>每一关都是一张<b>真实行情</b>图：判断接下来怎么走、找出买卖点、框住中枢。答完立刻判分并讲解结构。</p>
        <div class="stats">
          <div class="stat"><b>${s.done}</b><span>已通关</span></div>
          <div class="stat"><b>${s.stars}</b><span>星星</span></div>
          <div class="stat"><b>${s.acc}</b><span>平均分</span></div>
          <div class="stat"><b>${s.nextNo}</b><span>下一关</span></div>
        </div>
        <div class="actions">
          <button class="btn primary" id="goNext">继续第 ${s.nextNo} 关 →</button>
          <button class="btn" id="goRandom">随机挑战</button>
        </div>
      </section>
      <div id="chapters"></div>`;
    $('#goNext').addEventListener('click', () => openLevel(s.nextNo));
    $('#goRandom').addEventListener('click', () => openLevel(1 + Math.floor(Math.random() * 108)));

    const wrap = $('#chapters');
    // 章节按"最小关号"排序：下一关所在的章节排在最前，避免一屏全是锁住的关卡
    const chapters = [...map.chapters].sort((a, b) => {
      const ma = Math.min(...a.levels.map((l) => l.no));
      const mb = Math.min(...b.levels.map((l) => l.no));
      return ma - mb;
    });
    wrap.innerHTML = chapters
      .map((c) => {
        const lv = c.levels
          .map((l) => {
            const rec = prog.levels[l.no];
            const locked = l.no > unlockedMax;
            const cls = ['lv'];
            if (rec) cls.push('done');
            if (locked) cls.push('locked');
            if (l.no === s.nextNo) cls.push('next');
            if (l.rank === 'king') cls.push('king');
            const stars = rec ? '★'.repeat(rec.stars) : '';
            return `<button class="${cls.join(' ')}" data-no="${l.no}" ${locked ? 'disabled' : ''} title="${l.title}">${l.no}${stars ? `<span class="star">${stars}</span>` : ''}</button>`;
          })
          .join('');
        return `<section class="chapter">
          <header><h3>${c.name}</h3><span class="mech">${MECH_NAME[c.mechanic] || '看走势'}</span><span class="cnt">${c.levels.length} 关</span></header>
          <div class="chart-note" style="padding:8px 13px 0">关号按 108 课的主题分组，所以同一个章节里会跳号（章节内也是连续进阶）</div>
          <div class="levels">${lv}</div>
        </section>`;
      })
      .join('');
    $$('.lv', wrap).forEach((b) =>
      b.addEventListener('click', () => {
        if (b.disabled) return toast('先把前面的关卡打通');
        openLevel(Number(b.dataset.no));
      })
    );
  }

  /* ---------------- 关卡页 ---------------- */
  function destroyChart() {
    if (chart) { try { chart.destroy(); } catch (e) {} chart = null; }
  }

  async function openLevel(no) {
    destroyChart();
    graded = null; picked = null; pickedIdx = null; pickMode = false;
    app.innerHTML = `<section class="card"><div class="q-text">正在用最新行情出题…</div></section>`;
    try {
      level = await API.get('/api/game/level', { no });
    } catch (e) {
      app.innerHTML = `<section class="card"><div class="q-text">出题失败：${e.message}（可能是行情源暂时不可用，稍后再试）</div>
        <div class="row"><button class="btn" id="back2">返回地图</button></div></section>`;
      $('#back2').addEventListener('click', renderHome);
      return;
    }
    renderLevel();
  }

  function renderLevel() {
    const l = level;
    destroyChart();
    $('#rankPill').textContent = l.rankName || rankOf(l.no);
    app.innerHTML = `
      <section class="card">
        <div class="q-head">
          <h2>第 ${l.no} 关 · ${escapeHtml(l.title || '')}</h2>
          <span class="tag mech">${MECH_NAME[l.mechanic]}</span>
          <span class="tag">${l.rankName}</span>
        </div>
        <div class="q-text">${escapeHtml(l.question.text)}</div>
        <div class="q-text" style="opacity:.8">${escapeHtml(l.marketLabel || l.market)} · 日线 · 已隐藏后 ${l.hidden} 根（答完才揭晓标的）</div>
        <div class="chart-wrap"><canvas id="gchart"></canvas></div>
        <div class="chart-note" id="chartNote">${MECH_HINT[l.mechanic] || ''}</div>
        <div id="answerArea"></div>
        <div class="row"><button class="btn" id="back">← 返回地图</button><button class="btn primary" id="submit" disabled>交卷</button></div>
      </section>`;
    $('#back').addEventListener('click', renderHome);

    const cv = $('#gchart');
    chart = new ChanChart(cv, null);
    chart.toggles = { bi: false, seg: false, pivot: false, signal: false, beichi: false, vol: false, macd: false, fractal: false };
    chart.setData({ bars: l.visibleBars, period: l.period, bis: [], segments: [], pivots: [], signals: [], beichi: [] });

    const area = $('#answerArea');
    if (l.question.type === 'predict' || l.question.type === 'beichi') {
      area.innerHTML = `<div class="opts">${l.question.options
        .map((o) => `<button class="opt" data-k="${o.k}"><b>${o.label}</b><span>${o.desc}</span></button>`)
        .join('')}</div>`;
      $$('.opt', area).forEach((b) =>
        b.addEventListener('click', () => {
          picked = b.dataset.k;
          $$('.opt', area).forEach((x) => x.classList.toggle('sel', x === b));
          $('#submit').disabled = false;
        })
      );
    } else if (l.question.type === 'signal') {
      area.innerHTML = `<div class="tools"><button class="tool on" id="pickBtn">点图选 K 线</button><span class="q-text" id="pickInfo" style="align-self:center">在图上点最近的 K 线</span></div>`;
      pickMode = true;
      bindPick();
    } else {
      area.innerHTML = `<div class="tools"><button class="tool on" id="rectBtn">拖框选中中枢</button><button class="tool" id="clearBtn">清空重画</button></div>`;
      chart.setDrawMode('rect');
      chart.onDraws = (list) => {
        pickedIdx = list.length ? list[list.length - 1] : null;
        const sb = $('#submit');
        if (sb) sb.disabled = !pickedIdx;
        $('#chartNote').textContent = pickedIdx ? '已框选：确认后交卷（不满意点"清空重画"）' : MECH_HINT.pivot;
      };
      $('#rectBtn').addEventListener('click', () => { chart.setDrawMode('rect'); toast('在图上拖出一个框'); });
      $('#clearBtn').addEventListener('click', () => { chart.clearDrawings(); pickedIdx = null; const sb = $('#submit'); if (sb) sb.disabled = true; chart.setDrawMode('rect'); });
    }
    $('#submit').addEventListener('click', doSubmit);
  }

  function bindPick() {
    const cv = $('#gchart');
    let downX = 0, downY = 0, moved = false;
    cv.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; moved = false; });
    cv.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) moved = true; });
    cv.addEventListener('pointerup', (e) => {
      if (!pickMode || moved || graded || !chart || !chart.data) return;
      const p = chart.dataAt(e.clientX, e.clientY);
      if (!p) return;
      pickedIdx = p.idx;
      chart.setHighlight({ title: `第 ${p.idx} 根`, marks: [{ idx: p.idx, type: 'pick' }] });
      const info = $('#pickInfo');
      if (info) info.textContent = `已选第 ${p.idx} 根（${chart.data.bars[p.idx] ? chart.data.bars[p.idx].c.toFixed(2) : ''}）`;
      const sb = $('#submit');
      if (sb) sb.disabled = false;
    });
  }

  async function doSubmit() {
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = '判分中…';
    try {
      const payload = { no: level.no, token: level.token, attemptId: level.attemptId };
      if (level.mechanic === 'predict' || level.mechanic === 'beichi') payload.answer = picked;
      else if (level.mechanic === 'signal') payload.answer = { idx: pickedIdx };
      else payload.answer = { box: pickedIdx };
      const res = await API.post('/api/game/answer', payload);
      graded = res;
      btn.textContent = '已判分';
      btn.disabled = true;
      $('#answerArea').innerHTML = '<div class="chart-note">已提交，答案见下方</div>';
      showResult(res);
    } catch (e) {
      toast('判分失败：' + e.message);
      btn.disabled = false;
      btn.textContent = '交卷';
    }
  }

  function showResult(res) {
    const prev = prog.levels[res.no] || null;
    const better = !!prev && res.score > prev.score;
    if (res.score > 0) prog.levels[res.no] = { score: Math.max(prev ? prev.score : 0, res.score), stars: Math.max(prev ? prev.stars : 0, res.stars) };
    prog.streak = res.stars >= 2 ? (prog.streak || 0) + 1 : 0;
    prog.best = Math.max(prog.best || 0, prog.streak);
    save(prog);

    const cls = res.score >= 70 ? 'ok' : res.score >= 45 ? 'mid' : 'bad';
    // 揭示答案：把完整数据画出来，并标出正确答案
    chart.toggles = { bi: true, seg: true, pivot: true, signal: true, beichi: true, vol: false, macd: false, fractal: false };
    const st = res.revealedStructure || {};
    const full = {
      bars: res.revealedBars, period: level.period,
      bis: st.bis || [], segments: st.segments || [], pivots: st.pivots || [],
      signals: st.signals || [], beichi: st.beichi || []
    };
    chart.setData(full, { keepView: false });
    if (res.answer.signal) chart.setHighlight({ title: res.answer.signal.name, marks: [{ idx: res.answer.signal.barIdx - res.revealedFrom, type: 'signal' }] });
    else if (res.answer.pivot) chart.setHighlight({ title: '中枢', bands: [{ from: res.answer.pivot.i0 - res.revealedFrom, to: res.answer.pivot.i1 - res.revealedFrom, zg: res.answer.pivot.zg, zd: res.answer.pivot.zd }] });

    const nextNo = Math.min(108, res.no + 1);
    const box = document.createElement('section');
    box.className = 'card result';
    box.innerHTML = `
      <div class="score"><b style="color:${cls === 'ok' ? 'var(--ok)' : cls === 'mid' ? 'var(--warn)' : 'var(--bad)'}">${res.score}</b>
        <span class="stars">${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}</span>
        <span class="tag">${better ? '新纪录' : (prev ? '保留最高分' : '首通')}</span>
        ${prog.streak > 1 ? `<span class="tag">连击 ${prog.streak}</span>` : ''}</div>
      <div class="verdict ${cls}">${escapeHtml(res.verdict)}</div>
      <div class="chart-note">${res.target ? `本关标的：${escapeHtml(res.target.market)} · ${escapeHtml(res.target.code)}${res.target.name ? ' · ' + escapeHtml(res.target.name) : ''}` : ''}</div>
      <ul class="explain">${res.explain.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      ${res.gist ? `<div class="gist"><b>本关要点：</b>${escapeHtml(res.gist)}</div>` : ''}
      <div class="row">
        <button class="btn" id="again">再来一次</button>
        <button class="btn primary" id="next">下一关 ${nextNo > res.no ? '→' : '（已是最后一关）'}</button>
      </div>
      <div class="row"><button class="btn" id="home2">返回地图</button></div>`;
    app.appendChild(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#again').addEventListener('click', () => openLevel(res.no));
    $('#next').addEventListener('click', () => openLevel(nextNo));
    $('#home2').addEventListener('click', renderHome);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  $('#btnHome').addEventListener('click', renderHome);

  (async function boot() {
    try {
      map = await API.get('/api/game/map');
      renderHome();
    } catch (e) {
      app.innerHTML = `<section class="card"><div class="q-text">加载失败：${escapeHtml(e.message)}</div></section>`;
    }
  })();
})();
