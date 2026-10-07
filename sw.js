// Service worker ЭлектроПлан: после первой загрузки приложение работает без интернета.
// Все файлы (в том числе Three.js и шрифты) лежат на своём origin: сеть с таймаутом 3 с (если есть кеш), иначе кеш.
// Меняете файлы приложения — увеличьте VERSION, чтобы старый кеш удалился.
const PREFIX = 'ep-',
  VERSION = PREFIX + 'v17';
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-180.png',
  'js/app.js',
  'js/model.js',
  'js/storage.js',
  'js/templates.js',
  'js/plan2d.js',
  'js/view3d.js',
  'js/room.js',
  'js/rules.js',
  'js/calc.js',
  'js/check.js',
  'js/estimate.js',
  'js/util.js',
  'js/calc/route.js',
  'js/calc/groups.js',
  'js/calc/panel.js',
  'js/calc/net.js',
  'js/plan2d/geometry.js',
  'js/plan2d/gestures.js',
  'js/plan2d/draw.js',
  'js/plan2d/panel.js',
  'js/view3d/walls.js',
  'js/view3d/electric.js',
  'js/view3d/light.js',
  'js/view3d/camera.js',
  'js/view3d/pick.js',
  'js/view3d/frame.js',
  'js/view3d/scene.js',
  'js/view3d/card.js',
  'js/view3d/loop.js',
  'js/plan2d/buttons.js',
  'js/plan2d/context.js',
  'js/estimate/export.js',
  'js/room/consts.js',
  'js/room/state.js',
  'js/room/views.js',
  'js/room/panel.js',
  'js/room/handlers.js',
  'js/view3d/state.js',
  'js/view3d/shell.js',
  'js/view3d/actions.js',
  'fonts/manrope-cyrillic.woff2',
  'fonts/manrope-latin.woff2',
  'vendor/three/three.module.js',
  'vendor/three/addons/controls/OrbitControls.js',
];
self.addEventListener('install', e =>
  e.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))); // свои файлы обязательны, в обход HTTP-кеша
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener('activate', e =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== VERSION) await caches.delete(k);
      await self.clients.claim();
      for (const c of await self.clients.matchAll({ includeUncontrolled: true }))
        c.postMessage({ type: 'offline-ready', three: true });
    })(),
  ),
);
self.addEventListener('fetch', e => {
  const req = e.request,
    url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    e.respondWith(
      (async () => {
        const own = await caches.open(VERSION),
          hit = await own.match(req, { ignoreSearch: true });
        try {
          const r = await (hit ? Promise.race([fetch(req), new Promise((_, no) => setTimeout(no, 3000))]) : fetch(req));
          if (r.ok) {
            const copy = r.clone();
            e.waitUntil(own.put(req, copy));
          }
          return r;
        } catch {
          return hit || (req.mode === 'navigate' ? own.match('index.html') : Response.error());
        }
      })(),
    );
  }
});
