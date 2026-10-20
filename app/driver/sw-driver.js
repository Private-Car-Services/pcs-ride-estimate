/* PCS driver app service worker (v77.10): only shows the dispatch ping ("PCS: please open your driver app so dispatch can see you.")
   and opens the driver app when tapped. No caching, no network interception. */
self.addEventListener("push", function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  e.waitUntil(self.registration.showNotification(String(d.title || "PCS dispatch").slice(0, 60), { body: String(d.body || "PCS: please open your driver app so dispatch can see you.").slice(0, 200), tag: "pcs-ping", renotify: true, requireInteraction: true }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if (cs[i].url.indexOf("/app/driver/") >= 0 && "focus" in cs[i]) return cs[i].focus(); }
    return self.clients.openWindow ? self.clients.openWindow("./") : null;
  }));
});
