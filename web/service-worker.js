const CACHE_NAME = 'senlings-v0.11.0';

const PRECACHE_URLS = [
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  '../src/pwa/storage.js',
  '../src/pwa/state.js',
  '../src/pwa/work.js',
  '../src/pwa/expense.js',
  '../src/pwa/expenseQuery.js',
  '../src/pwa/invoice.js',
  '../src/pwa/project.js',
  '../src/pwa/contact.js',
  '../src/pwa/photo.js',
];

// インストール時に全アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// 古いキャッシュを削除してアクティブ化
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Network First: まずネットワークを試み、失敗時だけキャッシュを返す
self.addEventListener('fetch', (event) => {
  // chrome-extension など非 http スキームはスキップ
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功したレスポンスをキャッシュに更新してそのまま返す
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
