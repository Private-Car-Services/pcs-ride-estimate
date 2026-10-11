/* PCS app version: the ONE place to change it each release (v72r). Loaded by rider, driver, God mode and meter. */
(function () {
  var APP_VERSION = "v72r";
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
})();
