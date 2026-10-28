/* 极简 API 客户端 */
(function () {
  const TIMEOUT = 20000;

  async function get(path, params) {
    const u = new URL(path, location.origin);
    if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(u.toString(), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || res.status + '');
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method, path, params) {
    const u = new URL(path, location.origin);
    if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(u.toString(), {
        method,
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(params || {}),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || res.status + '');
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
  const post = (path, params) => request('POST', path, params);

  window.API = {
    get,
    post,
    health: () => get('/api/health'),
    markets: () => get('/api/markets'),
    overview: () => get('/api/overview'),
    sources: () => get('/api/sources'),
    search: (q) => get('/api/search', { q }),
    kline: (p) => get('/api/kline', p),
    chan: (p) => get('/api/chan', p),
    suite: (p) => get('/api/suite', p),
    radar: (p) => get('/api/radar', p),
    daily: () => get('/api/daily'),
    divination: (p) => get('/api/divination', p),
    watchlist: () => get('/api/watchlist'),
    watchAdd: (p) => post('/api/watchlist', p),
    watchDel: (p) => request('DELETE', '/api/watchlist', p),
    watchReset: () => request('POST', '/api/watchlist/reset', {}),
    drawings: (p) => get('/api/drawings', p),
    drawingsSave: (p) => post('/api/drawings', p),
    drawingsVerify: (p) => post('/api/drawings/verify', p),
    backtest: (p) => get('/api/backtest', p),
    timing: (p) => get('/api/timing', p),
    timingValidate: (p) => get('/api/timing/validate', p),
  };
})();
