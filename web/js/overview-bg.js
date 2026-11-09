/* 总览页动态背景
   =====================================================================
   借鉴 Duodecimal 首页的做法：一个 position:fixed 的全屏 canvas，
   内容滚动时背景形态跟随变化。

   但做了三处**刻意的克制**（因为我们是工具站，不是门户站）：
     ① 只在总览页启用——结构分析/回测/量化页必须纯暗色，看盘不能被干扰
     ② 极低亮度：实测 Duodecimal 的 canvas 是 90% 暗区 + 0.25% 亮点，
        这里同样只画稀疏光点，不做满屏炫彩（满屏亮色会让 K 线看不清）
     ③ 尊重 prefers-reduced-motion：系统开了减少动效就画静态帧

   形态随滚动变化（对应 Duodecimal 的"散景 → 环流"）：
     0%   → 自由漂浮的光点（散景）
     50%  → 开始向中心聚拢
     100% → 同心环流旋转
*/
(function () {
  'use strict';

  const COLORS = ['34,211,238', '34,197,94', '249,115,22'];  // 青蓝 / 绿 / 橙
  let canvas = null, ctx = null, raf = null;
  let W = 0, H = 0, dpr = 1;
  let particles = [];
  let scrollPhase = 0;
  let running = false;
  let reduced = false;

  function initParticles() {
    const n = Math.min(160, Math.round((W * H) / 14000));
    particles = [];
    for (let i = 0; i < n; i++) {
      const c = COLORS[i % COLORS.length];
      particles.push({
        baseX: Math.random(),
        baseY: Math.random(),
        r: 1.6 + Math.random() * 4.2,          // 半径（模拟失焦光斑大小）
        /*
          透明度：第一版压到 0.06~0.28，实测画布只有底色、一个亮点都没有
          （maxLum=25，和底色一样）。这里提到 0.16~0.55 —— 仍然克制，
          但要能看见。参考 Duodecimal 实测 0.25% 亮点，90% 暗区。
        */
        a: 0.16 + Math.random() * 0.39,
        vx: (Math.random() - 0.5) * 0.00012,   // 缓慢漂移
        vy: (Math.random() - 0.5) * 0.00012,
        orbR: 0.12 + Math.random() * 0.34,     // 环流半径
        orbA: Math.random() * Math.PI * 2,     // 环流初始角
        orbV: (Math.random() - 0.5) * 0.004,   // 环流角速度
        color: c,
        blur: 0.45 + Math.random() * 0.55,     // 模糊程度
      });
    }
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }

  function updateScrollPhase() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scrollPhase = Math.min(1, window.scrollY / max);
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    /* 底色：极暗的青黑，和 Duodecimal 的 rgb(10,10,10) 接近但偏一点点青 */
    ctx.fillStyle = 'rgb(9,12,13)';
    ctx.fillRect(0, 0, W, H);

    const cx = W * 0.5, cy = H * 0.46;
    /* 滚动进度驱动的形态插值：0=散景漂浮，1=同心环流 */
    const t = scrollPhase;

    for (const p of particles) {
      /* 漂浮位移 */
      p.baseX += p.vx;
      p.baseY += p.vy;
      if (p.baseX < -0.05) p.baseX = 1.05;
      if (p.baseX > 1.05) p.baseX = -0.05;
      if (p.baseY < -0.05) p.baseY = 1.05;
      if (p.baseY > 1.05) p.baseY = -0.05;

      /* 环流位置 */
      p.orbA += p.orbV * (0.6 + t);
      const orbX = cx + Math.cos(p.orbA) * p.orbR * W;
      const orbY = cy + Math.sin(p.orbA) * p.orbR * H * 0.8;

      /* 在"自由漂浮"与"环流"之间插值 */
      const freeX = p.baseX * W;
      const freeY = p.baseY * H;
      const x = freeX * (1 - t) + orbX * t;
      const y = freeY * (1 - t) + orbY * t;

      /* 环流时粒子拉长成短弧（对应 Duodecimal 的长条粒子） */
      const stretch = 1 + t * 3.2;
      const angle = t > 0.35 ? p.orbA + Math.PI / 2 : 0;

      ctx.save();
      ctx.globalAlpha = p.a * (0.8 + t * 0.6);
      ctx.fillStyle = `rgb(${p.color})`;
      /* 用 shadowBlur 模拟"失焦光斑"的柔和边缘 */
      ctx.shadowColor = `rgba(${p.color},0.85)`;
      ctx.shadowBlur = p.r * 4 * p.blur;
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * stretch, p.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function loop() {
    if (!running) return;
    updateScrollPhase();
    draw();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    if (reduced) { updateScrollPhase(); draw(); running = false; return; }
    loop();
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (ctx && canvas) ctx.clearRect(0, 0, W, H);
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'overview-underlay';
    canvas.className = 'overview-underlay';
    canvas.setAttribute('aria-hidden', 'true');
    const page = document.getElementById('page-overview');
    (page || document.body).insertBefore(canvas, (page || document.body).firstChild);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize, { passive: true });
  }

  /** 由 app.js 在切页时调用 */
  function setActive(on) {
    if (on) {
      ensureCanvas();
      if (canvas) canvas.style.display = '';
      start();
    } else {
      if (canvas) canvas.style.display = 'none';
      stop();
    }
  }

  try {
    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { reduced = false; }

  window.OverviewBg = { setActive, stop };
})();
