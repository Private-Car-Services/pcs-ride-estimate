/* PCS app version: the ONE place to change it each release (v72s). Loaded by rider, driver, God mode and meter. */
(function () {
  var APP_VERSION = "v72s";
  window.PCS_APP_VERSION = APP_VERSION;
  /* "v72r" -> [72, "r"]; returns <0 if a is older than b. Unknown/missing counts as oldest. */
  window.pcsVersionCmp = function (a, b) {
    function p(v) { var m = /^v?(\d+)([a-z]*)/i.exec(String(v || "")); return m ? [Number(m[1]), m[2].toLowerCase()] : [-1, ""]; }
    var x = p(a), y = p(b);
    if (x[0] !== y[0]) return x[0] - y[0];
    if (x[1].length !== y[1].length) return x[1].length - y[1].length;
    return x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0;
  };
  function addFooter() {
    if (!document.body || document.getElementById("pcs-app-version")) return;
    var el = document.createElement("div");
    el.id = "pcs-app-version";
    el.setAttribute("aria-hidden", "true");
    el.textContent = APP_VERSION;
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;bottom:env(safe-area-inset-bottom,0);text-align:center;" +
      "font:10px/14px system-ui,-apple-system,sans-serif;color:rgba(128,128,128,.45);pointer-events:none;z-index:2147483000;user-select:none;";
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
      var m = /var APP_VERSION = "([^"]+)"/.exec(t || "");
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
})();
