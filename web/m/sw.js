/* 手机版 Service Worker：只接管 /m/ 范围，接口一律走网络 */
const VER = 'chan-m-v1';
const CORE = [
  '/m/',
  '/m/css/mobile.css',
  '/m/js/mobile.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/chart.js',
  '/js/highlight.js',
  '/js/theory-content.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VER && k.startsWith('chan-m-')).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 行情实时，绝不缓存
  if (url.pathname.endsWith('.html') || url.pathname === '/m/') {
    e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || caches.match('/m/'))));
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(VER).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
