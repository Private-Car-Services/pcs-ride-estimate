/* PCS driver: new-ride alert for the Profile page (v51; v53: iOS silent-mode + tap-to-enable sound bar;
   v54: loud looping alert that ducks other audio until Accept/Deny;
   v56: the harsh siren is replaced by the approved bell chime (ride-chime.mp3, C6-E6-G6-E6) on a ~1.4 s loop;
   v57: iPhone sound fix: unlock on every tap, primed <audio> + Web Audio both play, gold bar until a chime really
   played, red "Tap here to hear ride alerts" banner when blocked, resume after app switch, old mute cleared once).
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
  var sirenTimer = null;
  var shownCode = "";
  /* v57: approved chime file; played by the shared sound engine below (Web Audio buffer + primed <audio>). */
  var CHIME_URL = chimeUrl();

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

  /* ===== v57 ride-alert sound engine (same code in app.js and driver/ride-alert.js) =====
     iPhone/iPad home-screen app: sound only works after a real tap, and iOS can silently drop Web Audio after an
     app switch or screen lock. So, belt and suspenders:
       - EVERY touch / click / key (not only the gold bar) synchronously creates/resumes the AudioContext, plays a
         1-sample silent buffer, and primes an HTMLAudioElement (muted play, then pause + rewind) inside the gesture.
         iOS then lets that same element play later with no tap.
       - A ride alert plays through BOTH: the decoded chime buffer looping on the AudioContext AND the primed
         <audio> element (loop, volume 1). Stop both on Accept / Deny / hide.
       - If play is blocked (NotAllowedError), a big red "Tap here to hear ride alerts" banner shows; tapping it
         unlocks and plays the chime right away.
       - The gold "Tap to turn on ride alert sound" bar stays at the top until a chime has really played in THIS
         page session (AudioContext running AND <audio>.play() resolved). Nothing is saved: iOS forgets the unlock on
         every reopen. It comes back after an app switch if the AudioContext did not come back.
     o = { url, muted(), wantBar(), onUi() } */
  function pcsAlertAudio(o) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null;
    var el = null;
    var elPrimed = false;   /* <audio> was play()-ed inside a gesture without NotAllowedError */
    var elHeard = false;    /* <audio>.play() of the real (unmuted) chime resolved in this page session */
    var buf = null;
    var loading = null;
    var failedAt = 0;
    var alerting = false;
    var alertGen = 0;
    var loopSrc = null;
    var loopStartedRunning = false; /* a loop started while suspended/interrupted is restarted once the context runs */
    var loopNodes = [];
    var oscNodes = [];
    var watch = null;
    var buzzing = false;
    var blocked = false;
    var testing = false;
    var testTimer = null;
    var stats = { unlocks: 0, elPlays: 0, bufStarts: 0, oscBursts: 0, blocked: 0 };
    function noop() {}
    function isMuted() { try { return !!(o.muted && o.muted()); } catch (e) { return false; } }
    /* audioSession first (before any AudioContext), only if the API exists. Never playAndRecord (earpiece on iPhone). */
    function setSession() {
      try {
        var s = navigator.audioSession;
        if (s && s.type !== "playback") s.type = "playback";
      } catch (e) {}
    }
    function makeCtx() {
      if (ctx || !AC) return ctx;
      setSession();
      try {
        ctx = new AC();
        try { ctx.onstatechange = function () { if (alerting) startCtxLoop(); ui(); }; } catch (e1) {}
      } catch (e) { ctx = null; }
      return ctx;
    }
    function makeEl() {
      if (el) return el;
      if (typeof Audio !== "function") return null;
      try {
        el = new Audio();
        el.preload = "auto";
        el.setAttribute("playsinline", "");
        el.setAttribute("webkit-playsinline", "");
        try { el.playsInline = true; } catch (e1) {}
        el.src = o.url;
        try { el.load(); } catch (e2) {}
      } catch (e) { el = null; }
      return el;
    }
    function ctxRunning() { return !!ctx && ctx.state === "running"; }
    /* "Really heard": AudioContext running AND the <audio> element's play() resolved. */
    function ready() { return ctxRunning() && elHeard; }
    function resumeCtx() {
      if (!ctx || ctx.state === "running" || ctx.state === "closed" || !ctx.resume) return;
      try {
        var p = ctx.resume();
        if (p && p.then) p.then(function () { ui(); if (alerting) startCtxLoop(); }, noop);
      } catch (e) {}
    }
    function load() {
      if (buf) return Promise.resolve(buf);
      if (loading) return loading;
      if (!ctx || typeof fetch !== "function" || !ctx.decodeAudioData) return Promise.resolve(null);
      if (failedAt && Date.now() - failedAt < 15000) return Promise.resolve(null);
      var c = ctx;
      loading = fetch(o.url).then(function (res) {
        if (!res || !res.ok) throw new Error("ride-chime " + (res && res.status));
        return res.arrayBuffer();
      }).then(function (ab) {
        return new Promise(function (resolve, reject) {
          var p = c.decodeAudioData(ab, resolve, reject); /* callback form for older iOS Safari */
          if (p && p.then) p.then(resolve, reject);
        });
      }).then(function (b) {
        if (!b) throw new Error("ride-chime decode");
        buf = b;
        failedAt = 0;
        loading = null;
        if (alerting) startCtxLoop();
        return b;
      }).catch(function () {
        failedAt = Date.now();
        loading = null;
        return null;
      });
      return loading;
    }
    function primeEl() {
      var e = el;
      if (!e || alerting || testing || !e.paused) return;
      var p = null;
      e.muted = true;
      try { p = e.play(); } catch (x) { p = null; }
      try { e.pause(); } catch (x2) {}
      try { e.currentTime = 0; } catch (x3) {}
      e.muted = false;
      try { e.volume = 1; } catch (x4) {}
      if (p && p.then) {
        p.then(function () {
          elPrimed = true;
          if (!alerting && !testing) { try { e.pause(); e.currentTime = 0; } catch (x5) {} }
        }, function (err) {
          /* AbortError = our own pause() won the race: the gesture was accepted. NotAllowedError = not a real gesture. */
          if (err && err.name === "NotAllowedError") return;
          elPrimed = true;
        });
      } else {
        elPrimed = true;
      }
    }
    /* Runs synchronously inside every user gesture. opts.noPrime: caller plays the element itself right after. */
    function unlock(opts) {
      stats.unlocks++;
      setSession();
      makeCtx();
      if (ctx) {
        resumeCtx();
        try {
          var s = ctx.createBufferSource();
          s.buffer = ctx.createBuffer(1, 1, 22050);
          s.connect(ctx.destination);
          s.start(0);
        } catch (e) {}
        load();
      }
      makeEl();
      if (alerting) {
        /* a ride is ringing: this tap makes it audible right now */
        if (el && (el.paused || blocked)) playEl(false);
        startCtxLoop();
      } else if (!(opts && opts.noPrime)) {
        primeEl();
      }
    }
    function onBlocked() {
      blocked = true;
      stats.blocked++;
      ui();
    }
    function playEl(isTest) {
      var e = makeEl();
      if (!e) return null;
      var gen = alertGen;
      e.loop = !isTest;
      e.muted = false;
      try { e.volume = 1; } catch (x0) {}
      try { e.currentTime = 0; } catch (x1) {}
      var p = null;
      try { p = e.play(); } catch (x2) { onBlocked(); return null; }
      stats.elPlays++;
      if (p && p.then) {
        p.then(function () {
          elPrimed = true;
          elHeard = true;
          blocked = false;
          if (!isTest && (!alerting || gen !== alertGen)) { try { e.pause(); e.currentTime = 0; } catch (x3) {} }
          ui();
        }, function (err) {
          if (err && err.name === "AbortError") return;
          if (!isTest && (!alerting || gen !== alertGen)) return;
          onBlocked();
        });
      } else {
        elHeard = true;
        ui();
      }
      return p;
    }
    function trackOsc(nodes, last) {
      nodes.forEach(function (n) { oscNodes.push(n); });
      try {
        last.onended = function () {
          oscNodes = oscNodes.filter(function (n) { return nodes.indexOf(n) === -1; });
          nodes.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
        };
      } catch (e) {}
    }
    /* Fallback (file not decoded yet / failed): same four bell notes from oscillators. Never the old sawtooth siren. */
    function oscBurst(isTest) {
      if (!ctx) return;
      try {
        var notes = [[1046.5, 0], [1318.5, 0.18], [1568, 0.36], [1318.5, 0.58]];
        var now = ctx.currentTime + 0.01;
        var master = ctx.createGain();
        master.gain.value = 0.95;
        master.connect(ctx.destination);
        var nodes = [master];
        var last = null;
        notes.forEach(function (n, i) {
          var len = i === notes.length - 1 ? 0.67 : 0.5;
          [[1, 0.85], [2, 0.12]].forEach(function (pt) {
            var osc = ctx.createOscillator();
            var g = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = n[0] * pt[0];
            g.gain.setValueAtTime(0.0001, now + n[1]);
            g.gain.exponentialRampToValueAtTime(pt[1], now + n[1] + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, now + n[1] + len);
            osc.connect(g);
            g.connect(master);
            osc.start(now + n[1]);
            osc.stop(now + n[1] + len + 0.02);
            nodes.push(osc, g);
            last = osc;
          });
        });
        stats.oscBursts++;
        if (!isTest) trackOsc(nodes, last);
      } catch (e) {}
    }
    /* Decoded chime looping on the AudioContext (gain 1.0). Same period as the looping <audio> element. */
    function startCtxLoop() {
      if (!alerting || !ctx || !buf) return;
      if (loopSrc && (loopStartedRunning || ctx.state !== "running")) return;
      if (loopSrc) { /* started while the context was not running: restart now that it is */
        loopNodes.forEach(function (n) { try { if (n.stop) n.stop(); } catch (e0) {} try { n.disconnect(); } catch (e1) {} });
        loopNodes = [];
        loopSrc = null;
      }
      try {
        var src = ctx.createBufferSource();
        var g = ctx.createGain();
        src.buffer = buf;
        src.loop = true;
        g.gain.value = 1.0;
        src.connect(g);
        g.connect(ctx.destination);
        src.start(0);
        loopSrc = src;
        loopStartedRunning = ctx.state === "running";
        loopNodes = [src, g];
        stats.bufStarts++;
      } catch (e) { loopSrc = null; }
    }
    function vibrate(p) {
      try { if (navigator.vibrate && (navigator.userActivation ? navigator.userActivation.hasBeenActive : true)) navigator.vibrate(p); } catch (e) {}
    }
    function tickAlert() {
      if (!alerting) return;
      if (isMuted()) { stopAlert(); return; }
      vibrate([220, 60, 220, 60, 220, 60, 320]);
      buzzing = true;
      resumeCtx();
      if (el && el.paused && !blocked) playEl(false);
      if (!buf) { load(); oscBurst(false); }
      else startCtxLoop();
    }
    /* Ride arrived: both paths at once, until stopAlert(). Idempotent while ringing. */
    function startAlert() {
      if (isMuted()) { stopAlert(); return; }
      if (alerting) return;
      alerting = true;
      alertGen++;
      testing = false;
      setSession();
      makeCtx();
      makeEl();
      resumeCtx();
      playEl(false);
      startCtxLoop();
      tickAlert();
      watch = setInterval(tickAlert, 1400);
      ui();
    }
    function stopAlert() {
      var was = alerting;
      alerting = false;
      alertGen++;
      if (watch) { clearInterval(watch); watch = null; }
      loopNodes.concat(oscNodes).forEach(function (n) {
        try { if (n.stop) n.stop(); } catch (e) {}
        try { if (n.disconnect) n.disconnect(); } catch (e2) {}
      });
      loopNodes = [];
      oscNodes = [];
      loopSrc = null;
      if (el && !testing) {
        try { el.pause(); } catch (e3) {}
        try { el.currentTime = 0; } catch (e4) {}
        el.loop = false;
      }
      if (buzzing) { buzzing = false; vibrate(0); }
      if (blocked || was) { blocked = false; ui(); }
    }
    /* Gold-bar test: plays NOW inside the tap via the primed element (works before the buffer is decoded). */
    function test() {
      unlock({ noPrime: true });
      if (alerting) return;
      testing = true;
      vibrate(60);
      var p = playEl(true);
      if (!el || !p) oscBurst(true); /* no <audio> support: Web Audio only */
      if (testTimer) clearTimeout(testTimer);
      testTimer = setTimeout(function () { testing = false; }, 1600);
      ui();
    }
    /* ---- UI: gold bar (until really heard) + red banner (blocked while ringing) ---- */
    function barStyle(bg, fg, z) {
      return "position:fixed;top:0;left:0;right:0;z-index:" + z + ";width:100%;margin:0;border:0;border-radius:0;" +
        "padding:calc(16px + env(safe-area-inset-top)) 14px 16px;background:" + bg + ";color:" + fg + ";font-size:20px;font-weight:800;" +
        "text-align:center;box-shadow:0 3px 12px rgba(0,0,0,.45);cursor:pointer;font-family:inherit;display:block;" +
        "-webkit-tap-highlight-color:transparent;touch-action:manipulation";
    }
    function addBar(id, text, bg, fg, z, onTap) {
      var b = document.getElementById(id);
      if (b) return b;
      b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.textContent = text;
      b.setAttribute("style", barStyle(bg, fg, z));
      var last = 0;
      function tap(ev) {
        if (ev && ev.type === "click") { try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {} }
        var now = Date.now();
        if (now - last < 700) return; /* touchend + click of one tap */
        last = now;
        onTap();
      }
      b.addEventListener("touchend", tap);
      b.addEventListener("click", tap);
      document.body.appendChild(b);
      return b;
    }
    function removeEl(id) {
      var b = document.getElementById(id);
      if (b && b.parentNode) b.parentNode.removeChild(b);
    }
    function wantBar() { try { return o.wantBar ? !!o.wantBar() : true; } catch (e) { return true; } }
    function ui() {
      if (!document.body) return;
      if (!wantBar()) { removeEl("ride-sound-bar"); removeEl("ride-sound-blocked"); return; }
      if (blocked && alerting) {
        addBar("ride-sound-blocked", "\uD83D\uDD0A Tap here to hear ride alerts", "#c0161b", "#fff", 11050, function () {
          unlock({ noPrime: true });
          if (!alerting) { test(); return; }
          playEl(false);
          startCtxLoop();
        });
      } else {
        removeEl("ride-sound-blocked");
      }
      if (ready()) removeEl("ride-sound-bar");
      else addBar("ride-sound-bar", "\uD83D\uDD14 Tap to turn on ride alert sound", "#e3b341", "#0b1c33", 10050, test);
      try { if (o.onUi) o.onUi(); } catch (e) {}
    }
    /* App switch / screen lock: iOS leaves the context suspended or "interrupted". Try to resume; if it does not
       come back, the gold bar returns so the next tap fixes it. */
    function onReturn() {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      resumeCtx();
      if (alerting && el && el.paused) playEl(false);
      ui();
      setTimeout(ui, 700);
    }
    function onGesture(ev) {
      var t = ev && ev.target;
      var id = t && t.id;
      /* bar / banner taps run their own handler (they play right away); still unlock the context here */
      if (id === "ride-sound-bar" || id === "ride-sound-blocked") { unlock({ noPrime: true }); return; }
      unlock();
    }
    function install() {
      setSession();
      ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "click", "keydown"].forEach(function (t) {
        document.addEventListener(t, onGesture, true);
      });
      document.addEventListener("visibilitychange", onReturn);
      window.addEventListener("pageshow", onReturn);
      window.addEventListener("focus", onReturn);
      if (document.body) ui(); else document.addEventListener("DOMContentLoaded", ui);
      setInterval(ui, 2000); /* nothing can quietly remove the bar */
    }
    return {
      install: install,
      unlock: unlock,
      test: test,
      startAlert: startAlert,
      stopAlert: stopAlert,
      load: load,
      ui: ui,
      ready: ready,
      onReturn: onReturn,
      info: function () {
        return {
          ctxState: ctx ? ctx.state : "none", elPrimed: elPrimed, elHeard: elHeard, alerting: alerting, blocked: blocked,
          bufReady: !!buf, elPaused: el ? el.paused : null, elLoop: el ? el.loop : null, elMuted: el ? el.muted : null,
          elSrc: el ? el.src : "", stats: stats
        };
      },
      url: function () { return o.url; },
      bufReady: function () { return !!buf; }
    };
  }
  /* ===== end v57 engine ===== */


  /* v57: mute defaults to OFF; a mute saved by an older version is cleared once (shared key with app.js). */
  (function resetOldMute() {
    try {
      if (localStorage.getItem("pcs-driver-alert-mute-v57") !== "1") {
        localStorage.removeItem(MUTE);
        localStorage.setItem("pcs-driver-alert-mute-v57", "1");
      }
    } catch (e) {}
  })();
  function muted() { return ls(MUTE) === "1"; }
  var audio = pcsAlertAudio({ url: CHIME_URL, muted: muted, wantBar: function () { return !!session(); } });
  function stopSiren() {
    if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
    audio.stopAlert();
  }
  function startSirenLoop() {
    if (muted()) { stopSiren(); return; }
    audio.startAlert();
    if (sirenTimer) return;
    sirenTimer = setInterval(function () {
      if (!shownCode || muted() || !document.getElementById("ride-popup")) { stopSiren(); return; }
      audio.startAlert(); /* idempotent while ringing */
    }, 1400);
  }
  function playChime(isTest) {
    if (isTest) audio.test();
    else startSirenLoop();
  }
  function chime(isTest) { playChime(isTest !== false); }
  function playSirenBurst(isTest) { playChime(!!isTest); }
  function showBar() { audio.ui(); }

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

  audio.install(); /* v57: unlock on every tap; gold bar until a chime really played; resume after app switch */

  /* v57: Alert/SOS on Profile page too (same police-help flow as app.js). */
  function ensureSosButton() {
    if (document.getElementById("pcs-sos-btn")) return;
    if (!document.getElementById("pcs-sos-style")) {
      var st = document.createElement("style");
      st.id = "pcs-sos-style";
      st.textContent =
        "#pcs-sos-btn{position:fixed;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:10040;" +
        "width:64px;height:64px;border-radius:50%;border:3px solid #fff;background:#c0161b;color:#fff;" +
        "font-size:13px;font-weight:900;line-height:1.05;box-shadow:0 4px 16px rgba(0,0,0,.45);" +
        "cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}" +
        "#pcs-sos-overlay{position:fixed;inset:0;z-index:11500;background:rgba(5,14,28,.94);display:flex;align-items:center;justify-content:center;padding:16px}" +
        "#pcs-sos-overlay .box{background:#0b1c33;color:#fff;border:2px solid #c0161b;border-radius:18px;max-width:420px;width:100%;padding:20px;text-align:center}" +
        "#pcs-sos-overlay h2{color:#ff6b6b;margin:0 0 10px;font-size:24px}" +
        "#pcs-sos-overlay .row{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}" +
        "#pcs-sos-overlay .row a,#pcs-sos-overlay .row button{flex:1;min-width:110px;padding:16px 8px;border:0;border-radius:12px;font-size:18px;font-weight:800;color:#fff;text-decoration:none;cursor:pointer}" +
        "#pcs-sos-overlay .yes{background:#2e9d4f}#pcs-sos-overlay .no{background:#8a2323}" +
        "#pcs-sos-overlay .call{background:#c0161b}#pcs-sos-overlay .ghost{background:#345}";
      document.head.appendChild(st);
    }
    var b = document.createElement("button");
    b.type = "button";
    b.id = "pcs-sos-btn";
    b.setAttribute("aria-label", "Alert SOS");
    b.innerHTML = "ALERT<br>SOS";
    b.addEventListener("click", function (ev) {
      try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
      openSosFlow();
    });
    (document.body || document.documentElement).appendChild(b);
  }
  function sosCoords(cb) {
    if (!navigator.geolocation) { cb(null, null); return; }
    try {
      navigator.geolocation.getCurrentPosition(
        function (p) { cb(+p.coords.latitude, +p.coords.longitude); },
        function () { cb(null, null); },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
      );
    } catch (e) { cb(null, null); }
  }
  function openSosFlow() {
    if (document.getElementById("pcs-sos-overlay")) return;
    var ov = document.createElement("div");
    ov.id = "pcs-sos-overlay";
    ov.innerHTML =
      '<div class="box" role="dialog" aria-modal="true"><h2>Alert / SOS</h2>' +
      "<p>Request police help? We open the 911 dialer and show your location. Matthew gets a red God-mode alert. This app cannot call 911 by itself.</p>" +
      '<div class="row"><button type="button" class="yes" id="sos-yes">Yes</button>' +
      '<button type="button" class="no" id="sos-no">No</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.id) return;
      if (t.id === "sos-no") { ov.parentNode.removeChild(ov); return; }
      if (t.id !== "sos-yes") return;
      ov.parentNode.removeChild(ov);
      sosCoords(function (lat, lng) {
        var name = "";
        var phone = "";
        var email = session();
        try {
          var acc = JSON.parse(ls("pcs-driver-account") || "{}") || {};
          name = acc.name || "";
          phone = acc.phone || "";
        } catch (e) {}
        var id = "police_driver_" + driverId() + "_" + Date.now();
        var body = {
          kind: "police_assist", priority: "high", at: Date.now(), role: "driver",
          driverId: driverId(), personId: driverId(), name: name || "Driver", phone: phone,
          email: email, rideCode: ls(CODE) || "", lat: lat, lng: lng,
          message: "Driver requested police assistance (Alert / SOS button). Call 911 / them if they cannot.",
          source: "sos_button"
        };
        try {
          if (db()) fetch(db() + "/rides/SAFETY/" + encodeURIComponent(id) + ".json", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
          }).catch(function () {});
        } catch (e2) {}
        try { location.href = "tel:911"; } catch (e3) {}
        var loc = (lat != null && lng != null) ? (+lat).toFixed(6) + ", " + (+lng).toFixed(6) : "Location unavailable";
        var sc = document.createElement("div");
        sc.id = "pcs-sos-overlay";
        sc.innerHTML =
          '<div class="box"><h2>Police assistance</h2>' +
          "<p>Tap Call 911 to open the dialer. Copy your location for the operator.</p>" +
          '<p style="font-size:20px;font-weight:800;word-break:break-all">' + esc(loc) + "</p>" +
          '<div class="row"><a class="call" href="tel:911">Call 911</a>' +
          '<button type="button" class="ghost" id="sos-copy">Copy location</button>' +
          (lat != null ? '<a class="yes" href="https://www.google.com/maps?q=' + encodeURIComponent((+lat) + "," + (+lng)) + '">Open in Maps</a>' : "") +
          '<button type="button" class="no" id="sos-close">Close</button></div></div>';
        document.body.appendChild(sc);
        sc.addEventListener("click", function (ev2) {
          var t2 = ev2.target;
          if (!t2 || !t2.id) return;
          if (t2.id === "sos-close") sc.parentNode.removeChild(sc);
          if (t2.id === "sos-copy") {
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(loc);
              t2.textContent = "Copied";
            } catch (e4) {}
          }
        });
      });
    });
  }
  if (document.body) ensureSosButton(); else document.addEventListener("DOMContentLoaded", ensureSosButton);
  setInterval(tick, 4000);
  setTimeout(tick, 800);
  /* Test hooks (no UI). */
  window.__pcsRideAlert = {
    playChime: playChime,
    loadChime: audio.load,
    chimeUrl: function () { return CHIME_URL; },
    chimeReady: function () { return audio.bufReady(); },
    audio: audio,
    playSirenBurst: playSirenBurst,
    startSirenLoop: startSirenLoop,
    stopSiren: stopSiren,
    showBar: showBar,
    hide: hide,
    chime: chime,
    ensureSosButton: ensureSosButton,
    openSosFlow: openSosFlow
  };
})();
