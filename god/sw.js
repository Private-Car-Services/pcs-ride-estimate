/* PCS God mode service worker (v64g): shows phone alerts (Web Push) from the pcs-pay Worker when God mode is
   closed, e.g. "New ride request - needs your OK". No page caching (God mode always loads fresh from the site).
   Tapping the alert opens God mode on that ride. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { try { d = { body: e.data.text() }; } catch (y) { d = {}; } }
  var code = String(d.code || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  var title = d.title || "PCS: New ride request";
  var opts = {
    body: d.body || "A ride needs your OK. Tap to open God mode.",
    tag: d.tag || (code ? "pcs-ride-" + code : "pcs-ride"),
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [300, 120, 300, 120, 300],
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: code ? "./?ride=" + encodeURIComponent(code) : "./", code: code },
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    /* an open God mode page refreshes right away */
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      list.forEach(function (c) { try { c.postMessage({ type: "pcs-push", code: code }); } catch (x) {} });
    }).catch(function () {}),
  ]));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var data = e.notification.data || {};
  var url = new URL(data.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i += 1) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) {
        try { c.postMessage({ type: "pcs-open-ride", code: data.code || "" }); } catch (x) {}
        return c.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});
