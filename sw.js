/* Service worker: deixa o app funcionar offline (cache do "casco" do app). */
const CACHE = 'escrita-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/base.css', 'css/style.css',
  'vendor/marked.umd.js', 'vendor/purify.min.js', 'vendor/jszip.min.js',
  'js/format.js', 'js/search.js', 'js/db.js', 'js/ui.js', 'js/markdown.js', 'js/sync.js', 'js/io.js',
  'js/app-core.js', 'js/app-import.js', 'js/app-sidebar.js', 'js/app-editor.js', 'js/app-topbar.js', 'js/app-main.js',
  'fonts/eb-garamond-latin-400-normal.woff2', 'fonts/eb-garamond-latin-400-italic.woff2',
  'fonts/eb-garamond-latin-600-normal.woff2', 'fonts/eb-garamond-latin-600-italic.woff2',
  'fonts/im-fell-english-latin-400-normal.woff2', 'fonts/im-fell-english-latin-400-italic.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Arquivos do app: responde do cache e atualiza em segundo plano. A API do GitHub nunca passa pelo cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
