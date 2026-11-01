/* 手机版 Service Worker：只接管 /m/ 范围，接口一律走网络
   策略：导航（HTML）网络优先 —— 保证部署后立刻拿到新外壳；
       带 ?v= 的代码资源视为不可变，缓存优先；
       其余静态资源缓存优先 + 后台更新。 */
const VER = 'chan-m-v3';
const CORE = ['/m/', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(CORE)).catch(() => {}) .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chan-m-') && k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 行情实时，绝不缓存

  // 1) 导航：网络优先，失败回落缓存（离线可用）
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(VER).then((c) => c.put(req, res.clone())).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/m/')))
    );
    return;
  }

  // 2) 带版本号的代码资源：URL 每次部署都会变，直接缓存优先
  if (url.searchParams.has('v')) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.ok) caches.open(VER).then((c) => c.put(req, res.clone())).catch(() => {});
            return res;
          })
      )
    );
    return;
  }

  // 3) 未带版本号的其它静态资源：网络优先（避免长期陈旧）
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) caches.open(VER).then((c) => c.put(req, res.clone())).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
