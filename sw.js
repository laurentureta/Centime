// Centime — service worker : l'appli marche hors connexion
const CACHE = 'centime-v12';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // l'API GitHub passe en direct
  // toujours revalider auprès du serveur (GitHub Pages met les pages en cache 10 min) : les mises à jour arrivent tout de suite
  const fresh = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
// Notifications : « ton salaire est tombé » (envoyées par le relais)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Centime', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Centime', {
    body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', tag: d.tag || 'centime',
    data: { url: d.url || './', net: d.net, le: d.le },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {}, url = new URL(d.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (c) { if (d.net) c.postMessage({ type: 'salaire', net: d.net, le: d.le }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
