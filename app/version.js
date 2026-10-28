/* PCS app version: the ONE place to change it each release (v72x). Loaded by rider, driver, God mode and meter. */
/* v2.0b bridge for stale v77.x copies: their update check takes the FIRST var APP_VERSION match below and their old compare
   ranks "v2.0b" below "v77.x", so they never offered the update. This decoy reads newer to them (banner + reload); the v2+
   compare ranks every v7x/v9x below v2.x, so current copies ignore it. Not code, never runs: var APP_VERSION = "v99.0" */
(function () {
  var APP_VERSION = "v2.0m-j";
  window.PCS_APP_VERSION = APP_VERSION;
  /* "v72r" -> [72, "r"]; returns <0 if a is older than b. Unknown/missing counts as oldest. */
  /* v2.0a (Harry r2): a first number < 70 is the NEW v2+ line, newer than every v77.x.
     v2+: major, then minor, then letter (v2.0z < v2.1a < v3.0). v77-line: unchanged ("v72r" -> 72,"r", ".1" hotfix). */
  window.pcsVersionCmp = function (a, b) {
    function p(v) {
      var s = String(v || ""), n = /^v?(\d+)\.(\d+)([a-z]*)(?:\.(\d+))?/i.exec(s); /* v2.0d.2: hotfix number */
      if (n && Number(n[1]) < 70) return [1, Number(n[1]), Number(n[2]), n[3].toLowerCase(), Number(n[4] || 0)];
      var m = /^v?(\d+)([a-z]*)(?:\.(\d+))?/i.exec(s); if (!m) return [-1, 0, 0, ""];
      if (Number(m[1]) < 70) return [1, Number(m[1]), Number(m[3] || 0), m[2].toLowerCase()];
      return [0, Number(m[1]), m[2].toLowerCase(), Number(m[3] || 0)];
    }
    var x = p(a), y = p(b);
    if (x[0] !== y[0]) return x[0] - y[0];
    if (x[0] < 0) return 0;
    if (x[1] !== y[1]) return x[1] - y[1];
    if (x[0] === 1) { if (x[2] !== y[2]) return x[2] - y[2]; if (x[3] !== y[3]) return x[3] < y[3] ? -1 : 1; return (x[4] || 0) - (y[4] || 0); }
    if (x[2].length !== y[2].length) return x[2].length - y[2].length;
    if (x[2] !== y[2]) return x[2] < y[2] ? -1 : 1;
    return x[3] - y[3]; /* v72x.1: hotfix number */
  };
  function addFooter() {
    if (!document.body || document.getElementById("pcs-app-version")) return;
    var el = document.createElement("div");
    el.id = "pcs-app-version";
    el.setAttribute("aria-hidden", "true");
    el.textContent = APP_VERSION;
    /* v72u (Matthew): same 10px size, high contrast on every screen: mint text on a solid dark-green pill (~11:1, WCAG AA+). */
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;bottom:env(safe-area-inset-bottom,0);text-align:center;" +
      "font:10px/14px system-ui,-apple-system,sans-serif;pointer-events:none;z-index:2147483000;user-select:none;";
    var pill = document.createElement("span");
    pill.textContent = APP_VERSION;
    pill.style.cssText = "display:inline-block;padding:0 6px;border-radius:7px;background:#0b3d23;color:#b8f0c8;font-weight:600;";
    el.textContent = "";
    el.appendChild(pill);
    document.body.appendChild(el);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addFooter); else addFooter();
  /* v72s forced update check: on open and whenever the app comes back to the foreground, fetch version.js with no-store.
     If the server has a different APP_VERSION than this running copy (an old cached copy), show "Update available, tap to
     reload". It reloads by itself only when the app says it is idle (window.pcsIdleForReload(), e.g. not mid-ride or
     mid-payment); otherwise it waits for the tap. */
  var src = (document.currentScript && document.currentScript.src) || "";
  var newer = "", lastCheck = 0;
  function banner() {
    if (!document.body || document.getElementById("pcs-update-banner")) return;
    var b = document.createElement("button");
    b.id = "pcs-update-banner";
    b.type = "button";
    b.textContent = "Update available (" + newer + "), tap to reload";
    b.style.cssText = "position:fixed;left:8px;right:8px;top:8px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:2147483001;" +
      "background:#20371d;color:#bef1c6;border:1px solid #bef1c6;border-radius:10px;padding:12px;font:700 15px system-ui,-apple-system,sans-serif;";
    b.addEventListener("click", reload);
    document.body.appendChild(b);
  }
  function reload() {
    var u = location.href.replace(/([?&])pcsv=[^&#]*/, "$1").replace(/[?&]$/, "");
    location.replace(u + (u.indexOf("?") === -1 ? "?" : "&") + "pcsv=" + encodeURIComponent(newer));
  }
  function idle() { try { return typeof window.pcsIdleForReload === "function" && window.pcsIdleForReload() === true; } catch (e) { return false; } }
  function tryAuto() { if (newer && idle()) reload(); }
  function check() {
    if (!src || !window.fetch || Date.now() - lastCheck < 15000) { tryAuto(); return; }
    lastCheck = Date.now();
    fetch(src.replace(/\?.*$/, "") + "?nocache=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      var m = /^\s*var APP_VERSION = "([^"]+)"/m.exec(t || "");
      if (!m || m[1] === APP_VERSION) return;
      if (window.pcsVersionCmp(m[1], APP_VERSION) < 0) return; /* never "update" to an older copy from a stale CDN edge */
      newer = m[1];
      window.PCS_UPDATE_AVAILABLE = newer;
      banner();
      tryAuto();
    }).catch(function () {});
  }
  window.pcsUpdateCheck = function () { lastCheck = 0; check(); };
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
  setInterval(function () { if (newer) tryAuto(); else check(); }, 5 * 60000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check); else check();
  /* v72t: GOOGLE map display everywhere (rider, driver + meter, God). Every OpenStreetMap/CARTO tile layer the apps create is
     swapped for Google roadmap + live traffic tiles (Map Tiles API through the PCS Worker, same server key as Places; the
     key never reaches the browser). If Google tiles fail (API off, daily cap, offline) the layer switches back to the
     original OpenStreetMap URL by itself. Pins, routes and the heading/zoom follow are unchanged (still Leaflet). */
  var MAPS_BASE = window.PCS_MAPS_BASE || "https://pcs-pay.pcsrides.workers.dev";
  var PCSMaps = window.PCSMaps = { provider: "google", failed: false, layers: [], base: MAPS_BASE,
    googleUrl: MAPS_BASE + "/maps/tile/{z}/{x}/{y}",
    attribution: "Map data &copy;" + new Date().getFullYear() + " Google \u00b7 live traffic" };
  try { if (/[?&]osm=1\b/.test(location.search) || localStorage.getItem("pcs-maps-osm") === "1") PCSMaps.failed = true; } catch (e) {}
  /* local test / dev copies (127.0.0.1, localhost) stay on OpenStreetMap: the Worker only serves tiles to the PCS site */
  try { if (/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname) && !window.PCS_MAPS_FORCE && !/[?&]gmaps=1\b/.test(location.search)) PCSMaps.failed = true; } catch (e) {}
  PCSMaps.resize = function () { PCSMaps.layers.forEach(function (l) { try { if (l._map) l._map.invalidateSize(); } catch (e) {} }); };
  function patchLeaflet() {
    var L = window.L;
    if (!L || !L.tileLayer || L.tileLayer.__pcsGoogle) return;
    var orig = L.tileLayer;
    var wrapped = function (url, opts) {
      if (PCSMaps.failed || !/openstreetmap\.org|cartocdn\.com/.test(String(url))) return orig.apply(this, arguments);
      var osmOpts = opts || {};
      var g = orig(PCSMaps.googleUrl, { maxZoom: 20, maxNativeZoom: 20, attribution: PCSMaps.attribution, crossOrigin: false });
      var errs = 0, ok = 0, swapped = false;
      g.pcsProvider = "google";
      g.on("tileload", function () { ok += 1; });
      g.on("tileerror", function () {
        errs += 1;
        if (swapped || errs < 3 || errs <= ok) return;
        swapped = true; PCSMaps.failed = true; g.pcsProvider = "osm";
        var m = g._map;
        try { if (m && m.attributionControl) { m.attributionControl.removeAttribution(PCSMaps.attribution); m.attributionControl.addAttribution(osmOpts.attribution || "&copy; OpenStreetMap"); } } catch (e) {}
        g.options.attribution = osmOpts.attribution || "&copy; OpenStreetMap";
        g.options.maxNativeZoom = osmOpts.maxZoom || 19;
        if (osmOpts.subdomains) g.options.subdomains = osmOpts.subdomains;
        g.setUrl(url);
      });
      PCSMaps.layers.push(g);
      if (PCSMaps.layers.length > 20) PCSMaps.layers.shift();
      return g;
    };
    wrapped.__pcsGoogle = true;
    L.tileLayer = wrapped;
  }
  patchLeaflet();
  if (!window.L) document.addEventListener("DOMContentLoaded", patchLeaflet);
})();
