/**
 * Offline copy of the page. Bump CACHE on every release: the version string is
 * what makes a browser notice there is something new (the Pic-to-PDF pattern).
 * Only the page's own files are cached - never a statement or a result.
 */
const CACHE = 'statement-to-express-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/view.js',
  './src/engine/batch.js',
  './src/engine/daily.js',
  './src/engine/dates.js',
  './src/engine/errors.js',
  './src/engine/extract.js',
  './src/engine/general.js',
  './src/engine/header.js',
  './src/engine/money.js',
  './src/engine/profiles.js',
  './src/engine/rows.js',
  './src/engine/statement.js',
  './src/engine/verify.js',
  './src/engine/words.js',
  './src/engine/output/express.js',
  './src/engine/output/review.js',
  './src/engine/output/xlsx.js',
  './src/engine/output/zip.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for this when the user taps "Reload" on the update bar.
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  // Navigations: network first so a new version is picked up promptly, the
  // cached page when there is no signal.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  // Everything else: cache first, which is what makes the page work offline.
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res && res.ok && new URL(request.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })),
  );
});
