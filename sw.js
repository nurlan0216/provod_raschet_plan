// Service worker ЭлектроПлан: после первой загрузки приложение работает без интернета.
// Свои файлы: сначала сеть, при её отсутствии кеш. Three.js и шрифты: сначала кеш.
// Меняете файлы приложения — увеличьте VERSION, чтобы старый кеш удалился.
const VERSION = 'ep-v10';
const SHELL = ['./', 'index.html', 'manifest.json', 'css/style.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-180.png',
  'js/app.js', 'js/model.js', 'js/storage.js', 'js/templates.js', 'js/plan2d.js', 'js/view3d.js', 'js/room.js', 'js/rules.js', 'js/calc.js', 'js/check.js', 'js/estimate.js'];
// Адреса должны совпадать с importmap в index.html.
const CDN = ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js'];
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap';
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

async function cacheFonts(cache) {            // шрифты: CSS и файлы woff2, которые он назвал
  const r = await fetch(FONTS_CSS); const css = await r.clone().text();
  await cache.put(FONTS_CSS, r);
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
  await Promise.all(urls.map(u => fetch(u).then(x => x.ok && cache.put(u, x)).catch(() => {})));
}
self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL);                                     // свои файлы обязательны
  const res = await Promise.allSettled(CDN.map(u => fetch(u).then(x => { if (!x.ok) throw 0; return cache.put(u, x); })));
  await cacheFonts(cache).catch(() => {});                       // шрифты не критичны: есть запасные
  self.cdnOk = res.every(x => x.status === 'fulfilled');
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
  await self.clients.claim();
  const cache = await caches.open(VERSION), have = await Promise.all(CDN.map(u => cache.match(u)));
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ type: 'offline-ready', three: have.every(Boolean) });
})()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req); if (r.ok) { const c = await caches.open(VERSION); c.put(req, r.clone()); } return r;
      } catch {
        const hit = await caches.match(req, { ignoreSearch: true });
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
      }
    })());
  } else if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req); if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) { const c = await caches.open(VERSION); c.put(req, r.clone()); } return r; }
      catch { return Response.error(); }
    })());
  }
});
