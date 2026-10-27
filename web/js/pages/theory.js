/* 缠论理论库 · 卡片列表 + 详情弹窗 */
(function () {
  const T = () => window.CHAN_THEORY || { concepts: [], questions: [], lessons: [], practices: [], meta: {} };
  const KIND = {
    concepts: '核心概念',
    questions: '问缠 · 在哪里',
    lessons: '108 课导读',
    practices: '实战流程',
  };
  // 问答 → 图上标注 key
  const Q2HL = {
    '分型在哪里？': 'fenxing',
    '笔在哪里？': 'bi',
    '线段在哪里？': 'xianduan',
    '中枢在哪里？': 'zhongshu',
    'a+A+b 在哪里？': 'a_A_b',
    'a+A+b+B+c 在哪里？': 'a_A_b',
    '走势终完美在哪里？': 'zoushi_wanmei',
    '一买二买三买在哪里？': 'buy3',
    '二买是次级别一买在哪里？': 'buy2',
    '盘整背驰在哪里？': 'panzheng_beichi',
    '趋势背驰在哪里？': 'beichi',
    '中阴阶段在哪里？': 'zhongyin',
    '区间套在哪里？': 'qujian_tao',
    '级别在哪里？': 'zoushi_jibie',
  };

  let tab = 'concepts';
  let kw = '';
  let list = []; // 当前弹窗所在列表
  let idx = -1; // 当前弹窗索引
  let kind = 'concepts';

  /* ---------------- 过滤与渲染 ---------------- */
  function filtered(k, theory) {
    const t = theory || T();
    const src = t[k] || [];
    if (!kw) return src;
    const q = kw.toLowerCase();
    const hit = (o) => JSON.stringify(o).toLowerCase().includes(q);
    return src.filter(hit);
  }

  function render() {
    U.$$('#theoryTabs .sq').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const theory = T();
    const body = U.$('#theoryBody');
    if (tab === 'concepts') body.innerHTML = renderConcepts(theory);
    else if (tab === 'questions') body.innerHTML = renderQuestions(theory);
    else if (tab === 'lessons') body.innerHTML = renderLessons(theory);
    else body.innerHTML = renderPractices(theory);

    U.$$('#theoryBody [data-item]').forEach((el) =>
      el.addEventListener('click', () => open(tab, Number(el.dataset.item)))
    );
    applyDeepLink();
  }

  /* ?tx=名称 可直接打开某条详情（也用于分享链接） */
  let deepLinkDone = false;
  function applyDeepLink() {
    if (deepLinkDone) return;
    const q = new URLSearchParams(location.search);
    const tx = q.get('tx');
    if (!tx) return;
    deepLinkDone = true;
    const key = tx.trim();
    const t = T();
    const tryTabs = [
      ['concepts', (t.concepts || []).findIndex((c) => c.name === key || c.id === key)],
      ['questions', (t.questions || []).findIndex((x) => x.q.includes(key))],
      ['lessons', (t.lessons || []).findIndex((x) => (x.range + x.theme).includes(key))],
      ['practices', (t.practices || []).findIndex((x) => x.title.includes(key))],
    ];
    const hit = tryTabs.find(([, i]) => i >= 0);
    if (!hit) return;
    tab = hit[0];
    U.$$('#theoryTabs .sq').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
    kw = '';
    const inp = U.$('#theorySearch');
    if (inp) inp.value = '';
    render();
    open(hit[0], hit[1]);
    q.delete('tx');
    const url = location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash;
    history.replaceState(null, '', url);
  }

  function renderConcepts(t) {
    const items = filtered('concepts', t);
    if (!items.length) return '<div class="loading">没有匹配的概念</div>';
    return (
      `<div class="concept-grid">` +
      items
        .map(
          (c, i) => `<div class="concept" data-item="${i}" tabindex="0" role="button">
        <div class="ch-top"><h4>${U.esc(c.name)}</h4><span class="lv ${U.esc(c.level)}">${U.esc(c.level)}</span><span class="hint">${U.esc(c.alias || '')}</span></div>
        <div class="ol">${U.esc(c.oneLine)}</div>
      </div>`
        )
        .join('') +
      `</div>` +
      `<div class="card" style="margin-top:14px"><div class="hint">${U.esc((t.meta && t.meta.note) || '')}<span style="margin-left:8px">点击任意卡片查看完整原文要义与识别步骤。</span></div></div>`
    );
  }

  function renderQuestions(t) {
    const items = filtered('questions', t);
    if (!items.length) return '<div class="loading">没有匹配的问题</div>';
    return `<div class="q-list">` + items
      .map(
        (q, i) => `<div class="q-item" data-item="${i}" tabindex="0" role="button">
      <div class="q">${U.esc(q.q)}</div>
      <div class="a" style="color:var(--muted)">${U.esc(q.short)}</div>
    </div>`
      )
      .join('') + `</div>`;
  }

  function renderLessons(t) {
    const items = filtered('lessons', t);
    if (!items.length) return '<div class="loading">没有匹配的课段</div>';
    return (
      `<div class="card" style="margin-bottom:14px"><div class="hint">${U.esc((t.meta && t.meta.note) || '')}</div></div><div class="lesson-list">` +
      items
        .map(
          (l, i) => `<div class="lesson-card" data-item="${i}" tabindex="0" role="button">
        <h4>${U.esc(l.range)}　${U.esc(l.theme)}</h4>
        <ul>${(l.points || []).slice(0, 2).map((p) => `<li>${U.esc(p)}</li>`).join('')}</ul>
        <div class="more">展开全部 ${(l.points || []).length} 条要点 ›</div>
      </div>`
        )
        .join('') + `</div>`
    );
  }

  function renderPractices(t) {
    const items = filtered('practices', t);
    if (!items.length) return '<div class="loading">没有匹配的流程</div>';
    return items
      .map(
        (p, i) => `<div class="practice-card card" data-item="${i}" tabindex="0" role="button">
      <div class="card-head"><h3>${i + 1}. ${U.esc(p.title)}</h3><span class="hint">共 ${(p.steps || []).length} 步</span></div>
      <ol class="md-steps" style="padding-left:20px;line-height:1.95">${(p.steps || []).slice(0, 1).map((s) => `<li>${U.esc(s)}</li>`).join('')}</ol>
      ${p.risk ? `<div class="hint" style="margin-top:8px;color:var(--up-text)">风险点：${U.esc(p.risk)}</div>` : ''}
    </div>`
      )
      .join('');
  }

  /* ---------------- 弹窗 ---------------- */
  const mask = () => U.$('#modalMask');

  function open(k, i) {
    kind = k;
    list = filtered(k);
    if (!list.length) return;
    idx = Math.max(0, Math.min(list.length - 1, i));
    paint();
    const m = mask();
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    U.$('#modalClose').focus();
  }

  function close() {
    const m = mask();
    m.classList.remove('show');
    m.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function step(d) {
    if (idx < 0 || !list.length) return;
    idx = (idx + d + list.length) % list.length;
    paint();
    U.$('#modalBody').scrollTop = 0;
  }

  function paint() {
    const item = list[idx];
    if (!item) return;
    const T0 = T();
    U.$('#modalKind').textContent = KIND[kind] || '详情';
    U.$('#modalCount').textContent = `${idx + 1} / ${list.length}`;
    U.$('#modalPrev').disabled = list.length < 2;
    U.$('#modalNext').disabled = list.length < 2;

    let title = '';
    let body = '';
    if (kind === 'concepts') {
      title = item.name;
      body = conceptHTML(item);
      U.$('#modalJump').style.display = '';
    } else if (kind === 'questions') {
      title = item.q;
      body = questionHTML(item, T0);
      U.$('#modalJump').style.display = '';
    } else if (kind === 'lessons') {
      title = `${item.range}　${item.theme}`;
      body = lessonHTML(item);
      U.$('#modalJump').style.display = 'none';
    } else {
      title = item.title;
      body = practiceHTML(item);
      U.$('#modalJump').style.display = '';
    }
    U.$('#modalTitle').textContent = title;
    const bodyEl = U.$('#modalBody');
    bodyEl.innerHTML = body;
    bodyEl.scrollTop = 0;
    // 关联概念跳转
    U.$$('.md-jump', bodyEl).forEach((b) =>
      b.addEventListener('click', () => {
        const name = b.dataset.cname;
        const all = T().concepts || [];
        const i2 = all.findIndex((c) => c.name === name);
        if (i2 < 0) return;
        kw = '';
        const inp = U.$('#theorySearch');
        if (inp) inp.value = '';
        tab = 'concepts';
        U.$$('#theoryTabs .sq').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'concepts'));
        render();
        kind = 'concepts';
        list = all;
        idx = i2;
        paint();
      })
    );
  }

  function conceptHTML(c) {
    return `
    <div class="md-tags"><span class="lv ${U.esc(c.level)}">${U.esc(c.level)}</span>${c.alias ? `<span class="chip">${U.esc(c.alias)}</span>` : ''}</div>
    <p class="md-lead">${U.esc(c.oneLine)}</p>
    <section class="md-sec"><h4>操作化定义</h4><p>${U.esc(c.definition)}</p></section>
    <section class="md-sec"><h4>原文要义</h4><p>${U.esc(c.original)}</p></section>
    <section class="md-sec"><h4>识别步骤</h4><ol class="md-steps">${(c.howTo || []).map((x) => `<li>${U.esc(x)}</li>`).join('')}</ol></section>
    <section class="md-sec"><h4>常见误区</h4><ul class="md-warn">${(c.mistakes || []).map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul></section>
    <section class="md-sec"><h4>在图上对应</h4><div class="md-station">${U.esc(c.station)}</div></section>`;
  }

  function questionHTML(q) {
    const chips = (q.related || [])
      .map((n) => `<button class="chip md-jump" data-cname="${U.esc(n)}">${U.esc(n)} ›</button>`)
      .join('');
    return `
    <p class="md-lead">${U.esc(q.short)}</p>
    <section class="md-sec"><h4>在图上怎么找</h4><p>${U.esc(q.answer)}</p></section>
    <section class="md-sec"><h4>操作步骤</h4><ol class="md-steps">${(q.steps || []).map((s) => `<li>${U.esc(s)}</li>`).join('')}</ol></section>
    ${q.pitfalls ? `<div class="md-pit"><b>易错</b>${U.esc(q.pitfalls)}</div>` : ''}
    ${chips ? `<section class="md-sec"><h4>关联概念</h4><div class="md-chips">${chips}</div></section>` : ''}`;
  }

  function lessonHTML(l) {
    return `
    <p class="md-lead">${U.esc(l.theme)}</p>
    <section class="md-sec"><h4>本段要点（${(l.points || []).length} 条）</h4><ol class="md-steps">${(l.points || []).map((p) => `<li>${U.esc(p)}</li>`).join('')}</ol></section>`;
  }

  function practiceHTML(p) {
    return `
    <p class="md-lead">${U.esc(p.title)}</p>
    <section class="md-sec"><h4>执行步骤</h4><ol class="md-steps">${(p.steps || []).map((s) => `<li>${U.esc(s)}</li>`).join('')}</ol></section>
    ${p.risk ? `<div class="md-pit"><b>风险点</b>${U.esc(p.risk)}</div>` : ''}
    <section class="md-sec"><h4>提醒</h4><p>流程只是框架，具体到每个标的仍要回到「结构分析」里逐笔核对：中枢在哪、背驰有没有、级别对不对得上。</p></section>`;
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    const qt = new URLSearchParams(location.search).get('tab');
    if (qt && KIND[qt]) tab = qt;
    U.$$('#theoryTabs .sq').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.tab;
        render();
      })
    );
    const inp = U.$('#theorySearch');
    if (inp) {
      inp.addEventListener(
        'input',
        U.debounce(() => {
          kw = inp.value.trim();
          render();
        }, 200)
      );
    }

    const m = U.$('#modalMask');
    U.$('#modalClose').addEventListener('click', close);
    U.$('#modalPrev').addEventListener('click', () => step(-1));
    U.$('#modalNext').addEventListener('click', () => step(1));
    m.addEventListener('click', (e) => {
      if (e.target === m) close();
    });
    U.$('#modalJump').addEventListener('click', () => {
      const item = list[idx] || {};
      const hlKey = kind === 'concepts' ? item.id : kind === 'questions' ? Q2HL[item.q] || null : null;
      close();
      const st = (window.App && App.state) || { market: 'A', symbol: { A: '600519' } };
      App.openStructure(st.market, st.symbol[st.market], st.period || 'day', { hl: hlKey });
      if (hlKey) U.toast('已切到结构分析并标注：' + (KIND[kind] === '问缠 · 在哪里' ? item.q : item.name));
      else U.toast('已切到结构分析（无对应标注）');
    });
    document.addEventListener('keydown', (e) => {
      if (!m.classList.contains('show')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      }
    });
    // 切换页面时自动关闭弹窗
    window.addEventListener('hashchange', () => {
      if (m.classList.contains('show')) close();
    });
    // 卡片键盘可达
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const el = document.activeElement;
      if (!el || !el.matches('#theoryBody [data-item]')) return;
      e.preventDefault();
      open(tab, Number(el.dataset.item));
    });
  });

  window.PageTheory = { render, open };
})();
