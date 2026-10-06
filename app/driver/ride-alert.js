/* PCS driver: new-ride alert for the Profile page (v51; v53: iOS silent-mode + tap-to-enable sound bar;
   v54: loud looping alert that ducks other audio until Accept/Deny;
   v56: the harsh siren is replaced by the approved bell chime (ride-chime.mp3, C6-E6-G6-E6) on a ~1.4 s loop).
   The main driver app (app.js) has its own pop-up; this small script makes the Profile page alert too.
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
  var sirenTimer = null;
  var sirenNodes = [];
  /* v56: approved chime file, fetched + decoded once (after the unlock tap) on the same AudioContext. */
  var CHIME_URL = chimeUrl();
  var CHIME_NOTES = [[1046.5, 0], [1318.5, 0.18], [1568, 0.36], [1318.5, 0.58]]; /* C6 E6 G6 E6 (fallback only) */
  var chimeBuf = null;
  var chimeLoad = null;
  var chimeFailedAt = 0;
  var chimeWaiting = false;
  var alertGen = 0; /* bumps on stop so a burst still waiting on the file never plays late */
  var buzzing = false; /* vibrate(0) only after an alert buzz (avoids Chrome's pre-tap vibrate warning) */

  /* ride-chime.mp3 sits next to this script in app/driver/. document.currentScript gives
     /pcs-ride-estimate/app/driver/ride-alert.js on GitHub Pages (and /app/driver/ride-alert.js locally),
     so the file resolves the same from /app/driver/, /app/driver/signup/ and /app/. */
  function chimeUrl() {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return new URL("ride-chime.mp3", src).href;
    } catch (e) {}
    try {
      var m = String(location.pathname || "").match(/^(.*?)\/app(?:\/|$)/);
      return new URL("ride-chime.mp3", location.origin + (m ? m[1] : "") + "/app/driver/").href;
    } catch (e2) {}
    return "ride-chime.mp3";
  }

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

  /* v53/v54: iOS 17+ silent-switch ignore; prefer playback so the alert ducks/interrupts other audio. */
  function playbackSession() {
    try {
      if (!navigator.audioSession) return;
      var t = navigator.audioSession.type;
      if (t !== "playback" && t !== "playAndRecord") {
        try { navigator.audioSession.type = "playback"; } catch (e1) {}
        try { if (navigator.audioSession.type !== "playback") navigator.audioSession.type = "playAndRecord"; } catch (e2) {}
      }
    } catch (e) {}
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
    /* v56: test sound = one burst of the ride chime. touchend as well as click: on phones the bar used to vanish
       (sound came on during the touch) before its click fired, so the test sound never played. */
    var done = false;
    function onTap(ev) {
      if (ev && ev.type === "click") { ev.preventDefault(); ev.stopPropagation(); }
      if (done) return;
      done = true;
      wake();
      chime(true);
      hideBar();
    }
    b.addEventListener("touchend", onTap);
    b.addEventListener("click", onTap);
    document.body.appendChild(b);
  }

  function wake(ev) {
    /* a tap on the gold bar itself leaves the bar for its own handler (it plays the test chime, then hides) */
    var onBar = !!(ev && ev.target && ev.target.id === "ride-sound-bar");
    playbackSession();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !ctx) ctx = new AC();
      if (!ctx) return;
      if (ctx.state !== "running" && ctx.resume) {
        var r = ctx.resume();
        if (r && r.then) r.then(function () { if (running() && !onBar) hideBar(); }).catch(function () {});
      } else if (ctx.state === "running" && !onBar) hideBar();
      if (!primed) {
        var s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
        primed = true;
      }
      loadChime();
    } catch (e) {}
  }
  function stopSiren() {
    alertGen++;
    if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
    sirenNodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (e) {}
      try { if (n.disconnect) n.disconnect(); } catch (e2) {}
    });
    sirenNodes = [];
    if (buzzing) {
      buzzing = false;
      try { if (navigator.vibrate) navigator.vibrate(0); } catch (e3) {}
    }
  }
  function beep() {
    if (ls(MUTE) === "1" || !ctx) return;
    playChime(false);
  }

  /* v56: fetch + decode ride-chime.mp3 once into an AudioBuffer. Resolves null on failure (fallback tones play);
     a failed load is retried on a later tap, at most every 15 s. */
  function loadChime() {
    if (chimeBuf) return Promise.resolve(chimeBuf);
    if (chimeLoad) return chimeLoad;
    if (!ctx || typeof fetch !== "function" || !ctx.decodeAudioData) return Promise.resolve(null);
    if (chimeFailedAt && Date.now() - chimeFailedAt < 15000) return Promise.resolve(null);
    var c = ctx;
    chimeLoad = fetch(CHIME_URL).then(function (res) {
      if (!res || !res.ok) throw new Error("ride-chime " + (res && res.status));
      return res.arrayBuffer();
    }).then(function (ab) {
      return new Promise(function (resolve, reject) {
        var p = c.decodeAudioData(ab, resolve, reject); /* callback form for older iOS Safari */
        if (p && p.then) p.then(resolve, reject);
      });
    }).then(function (buf) {
      if (!buf) throw new Error("ride-chime decode");
      chimeBuf = buf;
      chimeFailedAt = 0;
      chimeLoad = null;
      return buf;
    }).catch(function () {
      chimeFailedAt = Date.now();
      chimeLoad = null;
      return null;
    });
    return chimeLoad;
  }
  /* Alert nodes are tracked so Deny / hide cuts the sound off; they drop out of the list when finished. */
  function track(nodes, endNode) {
    nodes.forEach(function (n) { sirenNodes.push(n); });
    try {
      endNode.onended = function () {
        sirenNodes = sirenNodes.filter(function (n) { return nodes.indexOf(n) === -1; });
        nodes.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
      };
    } catch (e) {}
  }
  /* The approved chime file at full level (GainNode 1.0, no extra quieting). */
  function chimeFromBuffer(isTest) {
    var src = ctx.createBufferSource();
    var g = ctx.createGain();
    src.buffer = chimeBuf;
    g.gain.value = 1.0;
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0);
    if (!isTest) track([src, g], src);
  }
  /* Fallback if the file cannot be fetched/decoded: the same four bell notes from oscillators
     (sine + quiet 2x partial, master gain 0.95). Never the old sawtooth siren. */
  function chimeFallback(isTest) {
    try {
      var now = ctx.currentTime + 0.01;
      var master = ctx.createGain();
      master.gain.value = 0.95;
      master.connect(ctx.destination);
      var nodes = [master];
      var last = null;
      CHIME_NOTES.forEach(function (n, i) {
        var len = i === CHIME_NOTES.length - 1 ? 0.67 : 0.5;
        [[1, 0.85], [2, 0.12]].forEach(function (pt) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = n[0] * pt[0];
          g.gain.setValueAtTime(0.0001, now + n[1]);
          g.gain.exponentialRampToValueAtTime(pt[1], now + n[1] + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, now + n[1] + len);
          o.connect(g);
          g.connect(master);
          o.start(now + n[1]);
          o.stop(now + n[1] + len + 0.02);
          nodes.push(o, g);
          last = o;
        });
      });
      if (!isTest) track(nodes, last);
    } catch (e) {}
  }
  /* v56: one burst of the ride chime (~1.25 s). isTest = the unlock-bar test (ignores mute, not cut by stop). */
  function playChime(isTest) {
    if (!ctx) return;
    if (!isTest && ls(MUTE) === "1") return;
    playbackSession();
    try { if (ctx.state === "suspended") ctx.resume(); } catch (e) {}
    try {
      if (navigator.vibrate) navigator.vibrate(isTest ? 60 : [220, 60, 220, 60, 220, 60, 320]);
      if (!isTest) buzzing = true;
    } catch (e2) {}
    if (chimeBuf) {
      try { chimeFromBuffer(isTest); } catch (e3) { chimeFallback(isTest); }
      return;
    }
    if (chimeWaiting) return; /* a burst is already waiting for the file */
    chimeWaiting = true;
    var gen = alertGen;
    var done = false;
    function go() {
      if (done) return;
      done = true;
      chimeWaiting = false;
      if (!isTest && (gen !== alertGen || ls(MUTE) === "1")) return;
      if (chimeBuf) {
        try { chimeFromBuffer(isTest); return; } catch (e4) {}
      }
      chimeFallback(isTest);
    }
    loadChime().then(go, go);
    setTimeout(go, 2500); /* slow network: do not stay silent, play the fallback tones */
  }
  /* Unlock-bar test sound: one burst of the new chime. */
  function chime(isTest) {
    playChime(isTest !== false);
  }
  function playSirenBurst(isTest) { /* v54 name kept for test hooks; now the chime */
    if (!ctx || ls(MUTE) === "1") return;
    playChime(!!isTest);
  }
  function startSirenLoop() {
    if (ls(MUTE) === "1") { stopSiren(); return; }
    if (sirenTimer) return;
    playChime(false);
    sirenTimer = setInterval(function () {
      if (!shownCode || ls(MUTE) === "1" || !document.getElementById("ride-popup")) { stopSiren(); return; }
      playChime(false);
    }, 1400);
  }

  function hide() {
    stopSiren();
    shownCode = "";
    var el = document.getElementById("ride-popup");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show(r) {
    if (!document.getElementById("ride-alert-style")) {
      var st = document.createElement("style");
      st.id = "ride-alert-style";
      st.textContent =
        "#ride-popup{position:fixed;inset:0;z-index:11000;background:rgba(5,14,28,.93);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit}" +
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
        startSirenLoop();
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
  /* Test hooks (no UI). */
  window.__pcsRideAlert = {
    playChime: playChime,
    loadChime: loadChime,
    chimeUrl: function () { return CHIME_URL; },
    chimeReady: function () { return !!chimeBuf; },
    playSirenBurst: playSirenBurst,
    startSirenLoop: startSirenLoop,
    stopSiren: stopSiren,
    showBar: showBar,
    hide: hide,
    chime: chime
  };
})();
