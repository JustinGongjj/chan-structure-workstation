/* 手机版 Service Worker：只接管 /m/ 范围，接口一律走网络 */
const VER = 'chan-m-v2';
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

/* 代码资产（html/css/js）用"网络优先"：在线时永远拿到最新版本，
   避免改了样式手机上还是旧缓存；离线才回落到缓存。 */
const CODE = /\.(?:html|css|js|webmanifest)$/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 行情实时，绝不缓存

  if (url.pathname === '/m/' || CODE.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(VER).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/m/')))
    );
    return;
  }

  // 图片等静态资源：缓存优先 + 后台更新
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
