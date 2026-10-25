/* PCS native GPS bridge v2. Load BEFORE app.js. No-op outside the Capacitor app.
   Matthew's rule: driver location is shared the whole time a driver is logged in
   (Available, Offline, Break, between rides) so riders can follow pickups and God
   mode can see drivers. It stops only at logout (PCSNative.stop from app.js).
   - watchPosition/clearWatch: subscribers of the native background watcher.
     The native watcher runs only while started (login) AND at least one subscriber exists.
   - getCurrentPosition: one-shot, foreground WebView geolocation, timeout + error, never
     starts background tracking.
   - Fixes use the plugin's timestamp; out-of-order or >60 s old fixes are dropped. */
(function (w) {
  var C = w.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var BG = C.Plugins && C.Plugins.BackgroundGeolocation;
  if (!BG) return;
  var MAX_AGE_MS = 60000, DISCLOSE_KEY = "pcs-native-loc-disclosed-v1";
  var webGeo = w.navigator.geolocation || null;
  var started = false, watcherId = null, adding = null, last = null, lastTs = 0, subs = {}, nextId = 1;
  function now() { return Date.now(); }
  function nSubs() { return Object.keys(subs).length; }

  function toPos(l) {
    var ts = Number(l.time);
    return { timestamp: isFinite(ts) && ts > 0 ? ts : NaN, coords: {
      latitude: l.latitude, longitude: l.longitude, accuracy: l.accuracy,
      altitude: l.altitude == null ? null : l.altitude, altitudeAccuracy: l.altitudeAccuracy == null ? null : l.altitudeAccuracy,
      speed: l.speed == null ? null : l.speed, heading: l.bearing == null ? null : l.bearing } };
  }
  function accept(pos) {
    var ts = pos.timestamp;
    if (!isFinite(ts)) return false;
    if (ts <= lastTs) return false;              /* out of order / duplicate */
    if (now() - ts > MAX_AGE_MS) return false;   /* stale */
    lastTs = ts; last = pos; return true;
  }
  function fan(pos) {
    if (!accept(pos)) return;
    Object.keys(subs).forEach(function (k) { try { subs[k].ok(pos); } catch (e) {} });
    try { if (w.document && w.document.visibilityState === "hidden" && w.__pcsFollow && w.__pcsFollow.tick) w.__pcsFollow.tick(); } catch (e) {}
  }
  function disclose() { /* one-time prominent disclosure before the OS prompt */
    try { if (w.localStorage.getItem(DISCLOSE_KEY)) return Promise.resolve(); } catch (e) { return Promise.resolve(); }
    return new Promise(function (res) {
      var d = w.document, box = d.createElement("div");
      box.id = "pcs-loc-disclosure";
      box.setAttribute("role", "dialog");
      box.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px";
      box.innerHTML = '<div style="background:#fff;color:#111;max-width:380px;border-radius:14px;padding:20px;font:16px/1.4 -apple-system,sans-serif">' +
        '<h3 style="margin:0 0 8px">Location while you\u2019re logged in</h3>' +
        '<p>PCS Driver shares your location the whole time you\u2019re logged in \u2014 Available, Offline, on Break and between rides \u2014 even with the screen locked or another app open. Riders see your car during their ride; PCS dispatch sees it while you\u2019re logged in. It stops when you log out.</p>' +
        '<p>On the next screen choose <b>Allow While Using App</b>, then later <b>Change to Always Allow</b>.</p>' +
        '<button type="button" style="width:100%;padding:12px;font-size:16px;border-radius:10px;border:0;background:#111;color:#fff">Continue</button></div>';
      box.querySelector("button").onclick = function () { try { w.localStorage.setItem(DISCLOSE_KEY, String(now())); } catch (e) {} box.remove(); res(); };
      d.body.appendChild(box);
    });
  }
  function ensure() { /* reconcile native watcher with (started && subscribers) */
    if (started && nSubs() > 0) {
      if (watcherId || adding) return adding || Promise.resolve(watcherId);
      adding = disclose().then(function () {
        if (!(started && nSubs() > 0)) return null;
        return BG.addWatcher({
          backgroundTitle: "PCS Driver: sharing your location",
          backgroundMessage: "Riders see your car during their ride; PCS dispatch sees it while you're logged in.",
          requestPermissions: true, stale: false, distanceFilter: 15
        }, function (loc, err) {
          if (err) {
            if (err.code === "NOT_AUTHORIZED") Object.keys(subs).forEach(function (k) { try { subs[k].fail && subs[k].fail({ code: 1, message: "Location not authorized" }); } catch (e) {} });
            return;
          }
          if (loc) fan(toPos(loc));
        });
      }).then(function (id) {
        adding = null;
        if (id == null) return null;
        watcherId = id;
        if (!(started && nSubs() > 0)) return ensure();
        return id;
      }, function () { adding = null; });
      return adding;
    }
    var id = watcherId; watcherId = null;
    return id ? BG.removeWatcher({ id: id }) : Promise.resolve();
  }
  function start() { started = true; return ensure(); }
  function stop() { started = false; last = null; lastTs = 0; return ensure(); }

  var geo = {
    watchPosition: function (ok, fail) { var id = nextId++; subs[id] = { ok: ok, fail: fail }; ensure(); return id; },
    clearWatch: function (id) { if (subs[id]) { delete subs[id]; ensure(); } },
    getCurrentPosition: function (ok, fail, opts) {
      var o = opts || {}, maxAge = Number(o.maximumAge) || 0, to = Number(o.timeout) > 0 ? Number(o.timeout) : 10000, done = false;
      function err(e) { if (done) return; done = true; if (fail) try { fail(e); } catch (x) {} }
      if (last && now() - last.timestamp <= maxAge) { setTimeout(function () { if (!done) { done = true; ok(last); } }, 0); return; }
      var timer = setTimeout(function () { err({ code: 3, message: "Timeout" }); }, to);
      if (!webGeo || !webGeo.getCurrentPosition) { clearTimeout(timer); err({ code: 2, message: "Unavailable" }); return; }
      webGeo.getCurrentPosition(function (p) { if (done) return; done = true; clearTimeout(timer); ok(p); },
        function (e) { clearTimeout(timer); err(e); }, { enableHighAccuracy: !!o.enableHighAccuracy, maximumAge: maxAge, timeout: to });
    }
  };
  try { Object.defineProperty(w.navigator, "geolocation", { value: geo, configurable: true }); } catch (e) {}
  w.PCSNative = { start: start, stop: stop, isNative: true, last: function () { return last; },
    _debug: function () { return { started: started, watcherId: watcherId, subs: nSubs() }; } };
})(typeof window !== "undefined" ? window : this);
