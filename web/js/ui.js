/* 通用工具 */
(function () {
  const MK = { A: 'A股', HK: '港股', US: '美股', CR: '加密' };

  function fmt(v, d) {
    if (v == null || v === '' || !Number.isFinite(+v)) return '—';
    const n = +v;
    const digits = d != null ? d : Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 10 ? 2 : Math.abs(n) >= 1 ? 3 : 5;
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function pct(v) {
    if (v == null || !Number.isFinite(+v)) return '—';
    const n = +v;
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function cls(v) {
    if (v == null || !Number.isFinite(+v)) return 'flat';
    return +v > 0 ? 'up' : +v < 0 ? 'down' : 'flat';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const isDaily = (period) => period === 'day' || period === 'week' || period === 'month';
  function ts(t, period) {
    const d = new Date(isDaily(period) ? t : t + 8 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    if (isDaily(period)) {
      const ymd = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
      return period === 'month' ? ymd.slice(0, 7) : period === 'week' ? ymd : ymd.slice(5);
    }
    return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  function tsFull(t, period) {
    const intraday = period && !isDaily(period);
    const d = new Date(intraday ? t + 8 * 3600000 : t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  function timeShort(t) {
    const s = String(t || '');
    const m14 = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (m14) return `${m14[4]}:${m14[5]}:${m14[6]}`;
    const m2 = s.match(/(\d{1,2}:\d{2}:\d{2})/);
    if (m2) return m2[1];
    const m3 = s.match(/(\d{1,2}:\d{2})/);
    return m3 ? m3[1] : s.slice(-8);
  }
  function stamp(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const d = new Date(Date.now() + 8 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    el.innerHTML = `<i></i>${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} 更新`;
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }
  function money(v, market) {
    if (v == null || !Number.isFinite(+v)) return '—';
    const n = +v;
    if (market === 'CR' && n > 1000) return (n / 1000).toFixed(2) + 'K';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
    return n.toFixed(0);
  }
  const SIG_CLS = { '1B': 'buy', '2B': 'buy', '3B': 'buy', '1S': 'sell', '2S': 'sell', '3S': 'sell' };
  const SIG_SHORT = { '1B': '一买', '2B': '二买', '3B': '三买', '1S': '一卖', '2S': '二卖', '3S': '三卖' };
  const POS_TXT = { above: '中枢上方', below: '中枢下方', inside: '中枢内部', none: '无中枢' };

  /* ---------------- 主题 ---------------- */
  const THEME_KEY = 'chan-theme';
  function getTheme() {
    return document.documentElement.dataset.theme || 'dark';
  }
  function syncToggle() {
    const b = document.getElementById('themeToggle');
    if (!b) return;
    const t = getTheme();
    b.textContent = t === 'dark' ? '☀' : '☾';
    b.title = t === 'dark' ? '切换为浅色主题（Ctrl/⌘ + J）' : '切换为深色主题（Ctrl/⌘ + J）';
    b.setAttribute('aria-label', b.title);
  }
  function setTheme(t) {
    const theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
    syncToggle();
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }
  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }
  const theme = { get: getTheme, set: setTheme, toggle: toggleTheme, sync: syncToggle };

  window.U = { MK, fmt, pct, cls, esc, ts, tsFull, timeShort, stamp, toast, theme, debounce, $, $$, money, SIG_CLS, SIG_SHORT, POS_TXT };
})();
