/* PCS driver: new-ride alert for the Profile page (v51; v53: iOS silent-mode + tap-to-enable sound bar).
   The main driver app (app.js) has its own pop-up; this small script makes the Profile page chime too.
   Accept happens in the driver app (same Accept code); Deny here is remembered there too. */
(function () {
  "use strict";
  var SESSION = "pcs-driver-session";
  var MUTE = "pcs-driver-alert-mute";
  var DISMISS = "pcs-driver-dismissed-rides";
  var CODE = "pcs-driver-code";
  var STORE = "pcs-beta-ride";
  var OWNER = ["mwragge78@gmail.com", "mwragge@privatetaxiservices.net"];
  var ASAP_EXPIRE_MS = 20 * 60 * 1000;
  var DISMISS_MS = 12 * 3600000;
  var approved = null;
  var ctx = null;
  var primed = false;
  var shownCode = "";
  var lastBeep = 0;

  function ls(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function db() { var c = window.PCS_SYNC || {}; return String(c.databaseURL || "").trim().replace(/\/+$/, ""); }
  function session() { return ls(SESSION).trim().toLowerCase(); }
  function driverId() {
    var id = session().replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "");
    return (id || "driver").slice(0, 48);
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function dismissed() { try { var m = JSON.parse(ls(DISMISS) || "{}"); return m && typeof m === "object" ? m : {}; } catch (e) { return {}; } }
  function isDismissed(code) { var t = Number(dismissed()[code]) || 0; return t > 0 && Date.now() - t < DISMISS_MS; }
  function dismiss(code) {
    var m = dismissed();
    m[code] = Date.now();
    try { localStorage.setItem(DISMISS, JSON.stringify(m)); } catch (e) {}
  }
  function midRide() {
    try {
      var r = JSON.parse(ls(STORE) || "null");
      var st = r && String(r.status || "");
      return !!ls(CODE) && (st === "accepted" || st === "started");
    } catch (e) { return false; }
  }
  function isAsap(r) {
    return r.asap === true || String(r.asap || "").toLowerCase() === "true" ||
      String(r.when || "").toLowerCase() === "asap" || String(r.time || "").toLowerCase() === "asap";
  }
  function addr(r, p) {
    if (r[p + "Address"]) return r[p + "Address"];
    return [r[p + "Street"], r[p + "City"], r[p + "State"]].filter(Boolean).join(", ");
  }

  /* v53: iOS 17+ plays the chime even with the silent switch on. */
  function playbackSession() {
    try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch (e) {}
  }
  function running() { return !!ctx && ctx.state === "running"; }
  function hideBar() {
    var b = document.getElementById("ride-sound-bar");
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }
  /* Big gold bar on each fresh open until tapped (iOS needs a tap before any sound). Nothing is remembered. */
  function showBar() {
    if (!session() || running() || document.getElementById("ride-sound-bar") || !document.body) return;
    var b = document.createElement("button");
    b.type = "button";
    b.id = "ride-sound-bar";
    b.textContent = "\uD83D\uDD14 Tap to turn on ride alert sound";
    b.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:10050;width:100%;margin:0;border:0;border-radius:0;" +
      "padding:calc(16px + env(safe-area-inset-top)) 14px 16px;background:#e3b341;color:#0b1c33;font-size:20px;font-weight:800;" +
      "text-align:center;box-shadow:0 3px 12px rgba(0,0,0,.45);cursor:pointer;font-family:inherit");
    b.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      wake();
      chime(true); /* short test chime */
      hideBar();
    });
    document.body.appendChild(b);
  }

  function wake() {
    playbackSession();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !ctx) ctx = new AC();
      if (!ctx) return;
      if (ctx.state !== "running" && ctx.resume) {
        var r = ctx.resume();
        if (r && r.then) r.then(function () { if (running()) hideBar(); }).catch(function () {});
      } else if (ctx.state === "running") hideBar();
      if (!primed) {
        var s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
        primed = true;
      }
    } catch (e) {}
  }
  function beep() {
    if (ls(MUTE) === "1" || !ctx) return;
    chime(false);
  }
  function chime(isTest) {
    if (!ctx) return;
    playbackSession();
    try {
      if (ctx.state === "suspended") ctx.resume();
      var now = ctx.currentTime;
      [[880, 0, 0.22, 0.55], [659.25, 0.28, 0.5, 0.5]].forEach(function (t) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = t[0];
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.exponentialRampToValueAtTime(t[3], now + t[1] + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t[1] + t[2]);
        o.start(now + t[1]);
        o.stop(now + t[1] + t[2] + 0.02);
      });
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(isTest ? 40 : [80, 40, 120]); } catch (e2) {}
  }

  function hide() {
    shownCode = "";
    var el = document.getElementById("ride-popup");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show(r) {
    if (!document.getElementById("ride-alert-style")) {
      var st = document.createElement("style");
      st.id = "ride-alert-style";
      st.textContent =
        "#ride-popup{position:fixed;inset:0;z-index:9999;background:rgba(5,14,28,.93);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit}" +
        "#ride-popup .rp-card{background:#0b1c33;color:#fff;border:2px solid #f0d48a;border-radius:20px;max-width:460px;width:100%;padding:20px}" +
        "#ride-popup .rp-title{font-size:30px;font-weight:800;color:#f0d48a;margin:0 0 14px;text-align:center}" +
        "#ride-popup .rp-name{font-size:22px;font-weight:700;margin-bottom:8px}" +
        "#ride-popup .rp-row{margin:10px 0;font-size:17px;line-height:1.35}" +
        "#ride-popup .rp-row b{display:block;color:#f0d48a;font-size:12px;letter-spacing:.08em;text-transform:uppercase}" +
        "#ride-popup .rp-actions{display:flex;gap:12px;margin-top:16px}" +
        "#ride-popup .rp-actions a,#ride-popup .rp-actions button{flex:1;font-size:22px;font-weight:800;padding:20px 10px;border-radius:14px;border:0;color:#fff;text-align:center;text-decoration:none}" +
        "#ride-popup .rp-accept{background:#2e9d4f}#ride-popup .rp-deny{background:#8a2323}";
      document.head.appendChild(st);
    }
    if (shownCode === r.code && document.getElementById("ride-popup")) return;
    shownCode = r.code;
    var el = document.getElementById("ride-popup");
    if (!el) {
      el = document.createElement("div");
      el.id = "ride-popup";
      document.body.appendChild(el);
      el.addEventListener("click", function (ev) {
        var t = ev.target;
        if (t && t.id === "rp-deny") {
          dismiss(shownCode);
          hide();
          tick();
        }
      });
    }
    el.innerHTML =
      '<div class="rp-card" role="dialog" aria-modal="true">' +
      '<p class="rp-title">Ride requested</p>' +
      '<div class="rp-name">' + esc(r.name || "Rider") + (isAsap(r) ? " · ASAP" : (r.when ? " · " + esc(r.when) : "")) + "</div>" +
      '<div class="rp-row"><b>Pickup</b>' + esc(addr(r, "pickup")) + "</div>" +
      '<div class="rp-row"><b>Drop-off</b>' + esc(addr(r, "drop")) + "</div>" +
      '<p style="color:#c9d3e0;font-size:14px">Fare and Accept are on the driver app screen.</p>' +
      '<div class="rp-actions"><a class="rp-accept" href="../">Open to accept</a>' +
      '<button type="button" class="rp-deny" id="rp-deny">Deny</button></div></div>';
  }

  function checkApproved() {
    if (approved !== null) return Promise.resolve(approved);
    return fetch(db() + "/rides/DRVRCMMS/" + encodeURIComponent(driverId()) + ".json").then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (row) {
      var a = row && String(row.approvalStatus || "").toLowerCase();
      approved = !!row && a !== "pending" && a !== "rejected" && a !== "fired" && row.active !== false;
      return approved;
    }).catch(function () { return false; });
  }

  function tick() {
    if (!session() || !db() || midRide()) { hide(); return; }
    checkApproved().then(function (ok) {
      if (!ok) { hide(); return; }
      return fetch(db() + "/rides/REQUESTS.json").then(function (res) { return res.ok ? res.json() : null; }).then(function (data) {
        var owner = OWNER.indexOf(session()) !== -1;
        var list = [];
        Object.keys(data && typeof data === "object" ? data : {}).forEach(function (code) {
          var r = data[code];
          if (!r || typeof r !== "object" || r.kind === "driver" || r.kind === "driverPresence" || code === "drivers") return;
          if ((r.status || "requested") !== "requested") return;
          if (r.isTest && !owner) return;
          if (r.pickupLat == null || r.pickupLng == null) return;
          var at = Number(r.updatedAt || r.requestedAt || r.createdAt || 0);
          if (isAsap(r) && at > 0 && Date.now() - at > ASAP_EXPIRE_MS) return;
          r.code = r.code || code;
          if (isDismissed(r.code)) return;
          list.push(r);
        });
        if (!list.length) { hide(); return; }
        var pick = list.filter(function (r) { return r.code === shownCode; })[0] || list[0];
        show(pick);
        if (Date.now() - lastBeep > 3500) { lastBeep = Date.now(); beep(); }
      });
    }).catch(function () {});
  }

  playbackSession();
  document.addEventListener("touchstart", wake, true);
  document.addEventListener("pointerdown", wake, true);
  document.addEventListener("touchend", wake, true);
  document.addEventListener("click", wake, true);
  if (document.body) showBar(); else document.addEventListener("DOMContentLoaded", showBar);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    setTimeout(function () { if (!running()) showBar(); }, 800);
  });
  setInterval(tick, 4000);
  setTimeout(tick, 800);
})();
