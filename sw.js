// Offline support: the app works on stage even without Wi-Fi.
const CACHE = 'gift-of-tab-v15';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/ui.js', 'js/store.js', 'js/sync.js', 'js/model.js', 'js/theory.js',
  'js/importer.js', 'js/pdfimport.js', 'js/glyphs.js', 'js/versions.js', 'js/pickers.js', 'js/push.js', 'js/art.js', 'js/song.js', 'js/pages.js', 'js/score/glyphs.js', 'js/score/model.js', 'js/score/render.js', 'js/score/audio.js', 'js/score/screen.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.github.com' || url.hostname.endsWith('githubusercontent.com')) return;
  if (url.hostname.includes('fonts.g')) { // fonts: cache first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // app files: network first (so updates arrive), fall back to cache offline
  e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});

// ---- push notifications (sent by the scheduled GitHub job)
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'The Gift of Tab', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.id ? d.id.split(':')[0] : 'gotab', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
