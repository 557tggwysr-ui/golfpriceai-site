/* GolfPrice AI service worker: live alerts only.
   It shows the alerts the alerts worker pushes during a live round (a new
   leader, birdies, the final result) and opens the leaderboard when one is
   tapped. It caches nothing and never touches page loads. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { b: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.t || 'GolfPrice AI', {
    body: d.b || 'There’s news on the leaderboard.',
    icon: '/assets/icons/app-192.png',
    data: { u: d.u || '/' },
    tag: d.g || undefined,
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.u) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.split('#')[0] === u && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(u);
  }));
});
