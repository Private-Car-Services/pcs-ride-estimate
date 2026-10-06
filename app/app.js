/* Private Car Services starter. Preview only: no texts, no charges, no API key. Shared rides use Firebase REST when PCS_SYNC.databaseURL is set.
   v47 (Oct 6): structured addresses + stops, nearest-first place search, card step before PIN, working rider cancel,
   driver online time + screen wake lock.
   v50 (Oct 6): driver profile (car details + profile photo + car photo) is saved on the server under
   /rides/DRVRPRFL/{driverId} (driverId = email-based roster id), loaded at every login, and never wiped by
   logout or a roster-password login. Only the opening odometer is asked after login.
   v54: louder looping ride siren, rider↔driver chat (en route to pickup), rider History, God banner actions + pop-ups. */
(function () {
  var BUSINESS_PHONE = "936-261-7878";
  var DRIVER_COMMISSION_RATE = 0.7;
  var EXTRA_FEE = 0;
  var BASE_CENTS = 1100;
  var EXTRA_PAX_CENTS = 500;
  var EXTRA_STOP_CENTS = 1100;
  var DAY_MILE_CENTS = 110;
  var NIGHT_MILE_CENTS = 138;
  var LATE_MILE_CENTS = 143;
  var SHORT_NOTICE_PCT = 0.25;
  var TAX_RATE = 0.0825;
  /* Airport bases = estimator app.js RATES (dollars→cents). Local base remains BASE_CENTS ($11). */
  var AIRPORT = {
    daytime: { drop: 1550, pick: 2500 },
    weekendNight: { drop: 2000, pick: 3000 },
    late: { drop: 3000, pick: 5000 }
  };
  var ASAP_EXPIRE_MS = 20 * 60 * 1000;

  var TEST_PIN = "0001";

  function pcsAuth() {
    return window.PCS_AUTH || null;
  }

  function authFetch(url, opts) {
    var a = pcsAuth();
    /* Auth not on this device yet: fall back to plain REST so roster/presence still work. */
    if (!a || !a.authFetch || (a.hasConfig && !a.hasConfig())) {
      return fetch(url, opts || {});
    }
    return a.authFetch(url, opts || {}).catch(function (err) {
      if (err && err.authRequired) return fetch(url, opts || {});
      throw err;
    });
  }

  function firebaseUid() {
    var a = pcsAuth();
    var u = a && a.currentUser ? a.currentUser() : null;
    return u && u.uid ? u.uid : "";
  }

  function firebaseEmail() {
    var a = pcsAuth();
    var u = a && a.currentUser ? a.currentUser() : null;
    return u && u.email ? String(u.email).trim().toLowerCase() : "";
  }

  /* Owner (Matthew) emails. Used only for TEST ride mode while Firebase Auth is not live yet. */
  var OWNER_EMAILS = ["mwragge78@gmail.com", "mwragge@privatetaxiservices.net"];

  function isOwnerSession() {
    var a = pcsAuth();
    if (a && a.hasConfig && a.hasConfig()) {
      return !!(a.isOwnerSignedIn && a.isOwnerSignedIn());
    }
    /* Firebase Auth keys not added yet: fall back to the email this app is logged in with. */
    var s = String(readSession() || "").trim().toLowerCase();
    return !!s && OWNER_EMAILS.indexOf(s) !== -1;
  }

  function testModeAvailable() {
    return isOwnerSession();
  }

  function isTestRide(ride) {
    if (ride && (ride.isTest === true || ride.isTest === 1 || String(ride.isTest).toLowerCase() === "true")) return true;
    return !!state.isTest;
  }

  function testBannerHtml() {
    if (!isTestRide(state) && !(state.rideStatus && state.isTest)) return "";
    if (!state.isTest && !isTestRide(currentRide())) return "";
    return '<p class="tag" style="background:#7a1f1f;color:#fff;">TEST RIDE — practice only · no charge · PIN 0001</p>';
  }

  var openRideAlertTimer = null;
  var openRideAudioUnlocked = false;
  var openRideAudioCtx = null;
  var openRideSirenNodes = [];

  function openRideAlertMuted() {
    try { return localStorage.getItem("pcs-driver-alert-mute") === "1"; } catch (err) { return false; }
  }

  function setOpenRideAlertMuted(on) {
    try { localStorage.setItem("pcs-driver-alert-mute", on ? "1" : "0"); } catch (err) {}
  }

  /* v53/v54: iOS 17+ silent-switch ignore; playback ducks/interrupts other audio when possible. */
  function setPlaybackAudioSession() {
    try {
      if (!navigator.audioSession) return;
      var t = navigator.audioSession.type;
      if (t === "playback" || t === "playAndRecord") return;
      try { navigator.audioSession.type = "playback"; } catch (e1) {}
      try {
        if (navigator.audioSession.type !== "playback") navigator.audioSession.type = "playAndRecord";
      } catch (e2) {}
    } catch (err) {}
  }

  /* v53: big gold "Tap to turn on ride alert sound" bar on each fresh open until tapped (iOS needs a tap first). */
  function rideSoundRunning() {
    return !!openRideAudioCtx && openRideAudioCtx.state === "running";
  }

  function hideRideSoundBar() {
    var bar = document.getElementById("ride-sound-bar");
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  function showRideSoundBar() {
    if (ROLE !== "driver" || rideSoundRunning() || document.getElementById("ride-sound-bar") || !document.body) return;
    var bar = document.createElement("button");
    bar.type = "button";
    bar.id = "ride-sound-bar";
    bar.textContent = "\uD83D\uDD14 Tap to turn on ride alert sound";
    bar.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:10050;width:100%;margin:0;border:0;border-radius:0;" +
      "padding:calc(16px + env(safe-area-inset-top)) 14px 16px;background:#e3b341;color:#0b1c33;font-size:20px;font-weight:800;" +
      "text-align:center;box-shadow:0 3px 12px rgba(0,0,0,.45);cursor:pointer");
    bar.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      keepRideAudioAwake();
      playRideChime(true); /* short test chime so the driver hears it works */
      hideRideSoundBar();
    });
    document.body.appendChild(bar);
  }

  function unlockOpenRideAudio() {
    keepRideAudioAwake();
    openRideAudioUnlocked = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !openRideAudioCtx) openRideAudioCtx = new AC();
      if (openRideAudioCtx && openRideAudioCtx.state === "suspended") openRideAudioCtx.resume();
    } catch (err) {}
    try {
      if (navigator.vibrate) navigator.vibrate(30);
    } catch (err2) {}
  }

  function beepOpenRideOnce() {
    /* v54: one loud siren burst; the loop interval keeps it repeating until Accept/Deny. */
    if (openRideAlertMuted() || !openRideAudioUnlocked) return;
    playRideSiren(false);
  }

  function stopRideSirenNodes() {
    openRideSirenNodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (e) {}
      try { if (n.disconnect) n.disconnect(); } catch (e2) {}
    });
    openRideSirenNodes = [];
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e3) {}
  }

  /* Unlock-bar test chime (short). Full alert uses playRideSiren. */
  function playRideChime(isTest) {
    setPlaybackAudioSession();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!openRideAudioCtx) openRideAudioCtx = new AC();
      var ctx = openRideAudioCtx;
      if (ctx.state === "suspended") ctx.resume();
      var now = ctx.currentTime;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 980;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.exponentialRampToValueAtTime(isTest ? 0.45 : 0.7, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      o.start(now);
      o.stop(now + 0.32);
    } catch (err) {}
    try {
      if (navigator.vibrate) navigator.vibrate(isTest ? 60 : [200, 80, 200]);
    } catch (err2) {}
  }

  /* v54: loud alternating high/low sweeps so the alert cuts through music in the car. */
  function playRideSiren(isTest) {
    setPlaybackAudioSession();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!openRideAudioCtx) openRideAudioCtx = new AC();
      var ctx = openRideAudioCtx;
      if (ctx.state === "suspended") ctx.resume();
      var now = ctx.currentTime;
      var peak = isTest ? 0.55 : 0.95;
      [[880, 0, 0.18], [1400, 0.18, 0.18], [880, 0.36, 0.18], [1400, 0.54, 0.18], [980, 0.72, 0.22]].forEach(function (t) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(t[0], now + t[1]);
        o.frequency.linearRampToValueAtTime(t[0] * (t[0] < 1000 ? 1.35 : 0.72), now + t[1] + t[2]);
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.exponentialRampToValueAtTime(peak, now + t[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t[1] + t[2]);
        o.start(now + t[1]);
        o.stop(now + t[1] + t[2] + 0.03);
        openRideSirenNodes.push(o);
        openRideSirenNodes.push(g);
      });
    } catch (err) {}
    try {
      if (navigator.vibrate) navigator.vibrate(isTest ? 80 : [220, 60, 220, 60, 220, 60, 320]);
    } catch (err2) {}
  }

  function countAlertableOpenRides() {
    /* v51: skips rides this driver denied; TEST rides only reach the owner's login (listOpenRides filters them). */
    return alertableOpenRides().length;
  }

  function stopOpenRideAlert() {
    if (openRideAlertTimer) {
      clearInterval(openRideAlertTimer);
      openRideAlertTimer = null;
    }
    stopRideSirenNodes();
  }

  function syncOpenRideAlert() {
    if (ROLE === "driver" && signedIn()) showRideSoundBar(); /* v53: until sound is on */
    if (ROLE !== "driver" || !signedIn() || !canGoOnline() || !driverCanTakeNew()) {
      stopOpenRideAlert();
      closeRidePopup();
      return;
    }
    /* v51/v54: pop-up + looping siren on every driver page until Accept/Deny. */
    syncRidePopup();
    var n = countAlertableOpenRides();
    if (!n || openRideAlertMuted()) {
      stopOpenRideAlert();
      return;
    }
    if (openRideAlertTimer) return;
    beepOpenRideOnce();
    openRideAlertTimer = setInterval(function () {
      if (!countAlertableOpenRides() || openRideAlertMuted() || !driverCanTakeNew()) {
        stopOpenRideAlert();
        return;
      }
      beepOpenRideOnce();
    }, 1400);
  }

  function openRideAlertToggleHtml() {
    if (ROLE !== "driver" || !signedIn()) return "";
    var muted = openRideAlertMuted();
    return '<button class="btn ghost" type="button" id="toggle-ride-alert">' +
      (muted ? "Unmute ride alert" : "Mute ride alert") + "</button>";
  }

  /* ================= v51 (Oct 6 test-ride fixes) ================= */

  /* ---- 3. Ride alert on every driver page + full-screen "Ride requested" pop-up ---- */
  var DISMISS_KEY = "pcs-driver-dismissed-rides"; /* shared with driver/ride-alert.js (Profile page) */
  var DISMISS_MS = 12 * 3600000;
  var openRideAudioPrimed = false;

  function readDismissed() {
    try {
      var m = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
      return m && typeof m === "object" ? m : {};
    } catch (e) { return {}; }
  }

  function rideDismissed(code) {
    var t = Number(readDismissed()[code]) || 0;
    return t > 0 && Date.now() - t < DISMISS_MS;
  }

  function dismissRideCode(code) {
    if (!code) return;
    var m = readDismissed();
    var now = Date.now();
    Object.keys(m).forEach(function (k) { if (!(now - Number(m[k]) < DISMISS_MS)) delete m[k]; });
    m[code] = now;
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(m)); } catch (e) {}
  }

  /* Free for a new ride: map board, Home menu pages, or a finished trip. Never mid-ride (one ride at a time). */
  function driverCanTakeNew() {
    if (ROLE !== "driver" || !signedIn()) return false;
    if (state.screen === "home") return true;
    return state.screen === "trip" && state.rideStatus === "completed";
  }

  function alertableOpenRides() {
    return (state.openRides || []).filter(function (r) {
      if (!r || !r.code) return false;
      if (r.isTest && !isOwnerSession()) return false;
      if (String(r.status || "requested") !== "requested") return false;
      return !rideDismissed(r.code);
    });
  }

  /* iOS: keep Web Audio alive. Any tap resumes it (iOS suspends it after the app is hidden). */
  function keepRideAudioAwake() {
    if (ROLE !== "driver") return;
    openRideAudioUnlocked = true;
    setPlaybackAudioSession();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !openRideAudioCtx) openRideAudioCtx = new AC();
      var ctx = openRideAudioCtx;
      if (!ctx) return;
      if (ctx.state !== "running" && ctx.resume) {
        var r = ctx.resume();
        if (r && r.then) r.then(function () { if (rideSoundRunning()) hideRideSoundBar(); }).catch(function () {});
      } else if (ctx.state === "running") hideRideSoundBar();
      if (!openRideAudioPrimed) {
        var src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
        openRideAudioPrimed = true;
      }
    } catch (err) {}
  }

  var ridePopupCode = "";
  var ridePopupInfo = {}; /* code -> { photo, fareCents, road } */
  var ridePopupBusy = {};
  var ridePopupHtmlKey = "";

  function closeRidePopup() {
    ridePopupCode = "";
    ridePopupHtmlKey = "";
    stopRideSirenNodes();
    var el = document.getElementById("ride-popup");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function rowAddress(row, prefix) {
    if (!row) return "";
    return row[prefix + "Address"] ||
      addressLine(row[prefix + "Street"], row[prefix + "City"], row[prefix + "State"], row[prefix + "Line2"], row[prefix + "Zip"]);
  }

  /* Fare for a ride that is not on screen: run the normal estimate() on a copy of the state, then put everything back. */
  function estimateForRide(ride, roadMiles) {
    var keep = Object.assign({}, state);
    var keepDriving = driving;
    var out = null;
    try {
      applyRide(ride);
      state.rideStatus = "requested";
      state.tripPath = [];
      state.useDrivenMiles = false;
      state.tripType = "auto";
      var a = placeCoords("pickup");
      var b = placeCoords("drop");
      if (a && b) {
        var miles = roadMiles != null && !viaPoints().length ? roadMiles : Math.round(straightChainMiles(a, b) * 1.3 * 100) / 100;
        driving = { key: routeKey(a, b), pending: "", done: true, miles: miles, line: null };
        var est = estimate();
        if (est.ready) out = est;
      }
    } catch (e) {
      out = null;
    }
    driving = keepDriving;
    Object.keys(state).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(keep, k)) delete state[k]; });
    Object.assign(state, keep);
    return out;
  }

  function loadRidePopupInfo(code) {
    if (ridePopupBusy[code] || ridePopupInfo[code]) return;
    ridePopupBusy[code] = true;
    getRide(code).then(function (ride) {
      if (!ride) return;
      if (!ride.code) ride.code = code;
      var info = { photo: safePhoto(ride.riderPhoto), fareCents: null, commCents: null, passengers: ride.passengers };
      var est = estimateForRide(ride, null);
      if (est) { info.fareCents = est.total; info.commCents = commissionCentsFor(est); }
      ridePopupInfo[code] = info;
      syncRidePopup();
      var a = pointFrom(ride.pickupLat, ride.pickupLng);
      var b = pointFrom(ride.dropLat, ride.dropLng);
      if (!a || !b) return;
      return osrmLeg(a, b).then(function (leg) {
        if (!leg) return;
        var est2 = estimateForRide(ride, Math.round(leg.miles * 100) / 100);
        if (est2) { info.fareCents = est2.total; info.commCents = commissionCentsFor(est2); }
        syncRidePopup();
      });
    }).catch(function () {}).then(function () { ridePopupBusy[code] = false; });
  }

  function syncRidePopup() {
    if (ROLE !== "driver") return;
    if (!driverCanTakeNew() || !canGoOnline() || state.acceptBusy) {
      closeRidePopup();
      return;
    }
    var list = alertableOpenRides();
    var row = null;
    list.forEach(function (r) { if (r.code === ridePopupCode) row = r; });
    if (!row) row = list[0] || null;
    if (!row) {
      closeRidePopup();
      return;
    }
    showRidePopup(row);
  }

  function showRidePopup(row) {
    var code = row.code;
    var info = ridePopupInfo[code];
    if (!info) loadRidePopupInfo(code);
    var me = pointFrom(state.hereLat, state.hereLng);
    var away = me && isCoord(row.pickupLat) ? haversine(me, { lat: +row.pickupLat, lng: +row.pickupLng }) : null;
    var when = rideIsAsap(row) ? "ASAP" : (row.when || [row.date, row.time].filter(Boolean).join(" "));
    var fare = info && info.commCents != null ? "Est. commission " + money(info.commCents) : (info ? "Commission figured at drop-off" : "Est. commission: figuring\u2026");
    var photo = info && info.photo ? '<img class="rp-photo" alt="Rider" src="' + info.photo + '">' : '<div class="rp-photo rp-nophoto">&#128100;</div>';
    var key = code + "|" + fare + "|" + (info && info.photo ? 1 : 0) + "|" + (away != null ? away.toFixed(1) : "");
    var el = document.getElementById("ride-popup");
    if (el && ridePopupCode === code && ridePopupHtmlKey === key) return;
    ridePopupCode = code;
    ridePopupHtmlKey = key;
    if (!el) {
      el = document.createElement("div");
      el.id = "ride-popup";
      document.body.appendChild(el);
      el.addEventListener("click", function (event) {
        var t = event.target;
        if (!t || !t.id) return;
        if (t.id === "rp-accept") popupAccept(ridePopupCode);
        else if (t.id === "rp-deny") popupDeny(ridePopupCode);
      });
    }
    el.innerHTML =
      '<div class="rp-card" role="dialog" aria-modal="true" aria-labelledby="rp-title">' +
      '<p class="rp-title" id="rp-title">Ride requested</p>' +
      (row.isTest ? '<p class="tag" style="background:#7a1f1f;color:#fff;">TEST — owner practice only</p>' : "") +
      '<div class="rp-who">' + photo + "<div>" +
      '<div class="rp-name">' + esc(row.name || "Rider") + "</div>" +
      '<div class="rp-sub">' + esc(when || "") + (info && info.passengers ? " · " + esc(String(info.passengers)) + " passengers" : "") + "</div>" +
      "</div></div>" +
      '<div class="rp-row"><b>Pickup</b>' + esc(rowAddress(row, "pickup") || "On the map") +
      (away != null ? '<span class="rp-sub"> · ' + esc(fmtMiles(away)) + " from you</span>" : "") + "</div>" +
      '<div class="rp-row"><b>Drop-off</b>' + esc(rowAddress(row, "drop") || "Ask the rider") + "</div>" +
      '<div class="rp-fare">' + esc(fare) + "</div>" +
      '<div class="rp-actions">' +
      '<button type="button" class="rp-accept" id="rp-accept">Accept</button>' +
      '<button type="button" class="rp-deny" id="rp-deny">Deny</button>' +
      "</div></div>";
  }

  /* Accept from the pop-up: same path as the map card (v49 conditional write in acceptRideOnce). */
  function popupAccept(code) {
    if (!code) return;
    keepRideAudioAwake();
    closeRidePopup();
    stopOpenRideAlert();
    if (state.screen === "trip" && state.rideStatus === "completed") {
      clearRideFields();
      writeDriverCode("");
      state.driverCode = "";
    }
    state.hubOpen = false;
    state.hubView = "menu";
    state.mode = "driver";
    state.screen = "home";
    state.selectedOpenCode = code;
    state.openListError = "";
    setAcceptNotice("Accepting\u2026", "busy");
    state.acceptBusy = true; /* keeps the pop-up closed while the ride loads */
    render();
    getRide(code).then(function (ride) {
      state.acceptBusy = false;
      if (!ride) {
        state.selectedOpenCode = "";
        setAcceptNotice("This ride is no longer in the system.");
        state.openListError = state.acceptNotice;
        render();
        refreshOpenRides(true);
        return;
      }
      if (!ride.code) ride.code = code;
      rememberRemote(ride);
      state.code = code;
      state.driverCode = code;
      writeDriverCode(code);
      state.selectedOpenCode = code;
      acceptSelectedOpenRide();
    }).catch(function () {
      state.acceptBusy = false;
      state.selectedOpenCode = "";
      setAcceptNotice("");
      state.openListError = "Could not reach the server to accept this ride. Check your signal and try again.";
      render();
    });
  }

  function popupDeny(code) {
    if (!code) return;
    keepRideAudioAwake();
    dismissRideCode(code);
    closeRidePopup();
    if (state.selectedOpenCode === code && state.screen === "home") {
      denySelectedOpenRide();
    } else {
      var row = null;
      (state.openRides || []).forEach(function (r) { if (r.code === code) row = r; });
      try {
        var rec = buildRefusalRecord(row || { code: code }, readDriverAccount());
        rec.rideCode = code;
        if (row) {
          rec.customerName = row.name || "";
          rec.customerPhone = row.phone || "";
          rec.pickup = rowAddress(row, "pickup");
          rec.dropoff = rowAddress(row, "drop");
        }
        postRefusal(rec).catch(function () {});
      } catch (e) {}
    }
    syncOpenRideAlert();
  }

  /* ---- 2. Navigate button (Apple Maps on iPhone/iPad = CarPlay; Google Maps elsewhere) ---- */
  function isAppleTouchDevice() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    /* iPadOS Safari says "Macintosh" (desktop mode). v50 missed this, so the iPad got the Google Maps web page. */
    return /Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  }

  function navAddressText(prefix) {
    var st = String(state[prefix + "State"] || "").trim();
    var zip = String(state[prefix + "Zip"] || "").trim();
    return [state[prefix + "Street"], state[prefix + "City"], [st, zip].filter(Boolean).join(" ")]
      .map(function (p) { return String(p || "").trim(); })
      .filter(Boolean).join(", ");
  }

  function navTarget() {
    if (ROLE !== "driver") return null;
    var started = state.rideStatus === "started";
    if (state.rideStatus !== "accepted" && !started) return null;
    var prefix = started ? "drop" : "pickup";
    var pt = placeCoords(prefix);
    var approx = started ? state.dropApprox : state.pickupApprox;
    /* Real pin = rider's GPS / picked from list / found to the house. City- or street-level guesses use the address text. */
    var exact = !!pt && (!approx || (!started && state.pickupFromHere));
    var text = navAddressText(prefix);
    var dest = exact ? pt.lat.toFixed(6) + "," + pt.lng.toFixed(6) : text;
    if (!dest && pt) dest = pt.lat.toFixed(6) + "," + pt.lng.toFixed(6);
    if (!dest) return null;
    var url = isAppleTouchDevice()
      ? "https://maps.apple.com/?daddr=" + encodeURIComponent(dest) + "&dirflg=d"
      : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest) + "&travelmode=driving";
    return { url: url, label: started ? "drop-off" : "pickup", dest: dest, exact: exact };
  }

  function navButtonHtml() {
    if (state.rideStatus !== "accepted" && state.rideStatus !== "started") return "";
    var t = navTarget();
    if (!t) {
      return '<p class="note">Directions are not ready yet: the ' +
        (state.rideStatus === "started" ? "drop-off" : "pickup") + " address is missing.</p>";
    }
    return '<a class="nav-btn-big" id="open-nav" href="' + esc(t.url) + '" target="_blank" rel="noopener">' +
      "&#10148; Navigate to " + esc(t.label) + "</a>" +
      '<p class="trip-eta" id="trip-eta">' + esc(tripEtaText()) + "</p>";
  }

  /* ---- 6. Live distance + ETA (OSRM every 30 s at most; straight line x1.3 at 30 mph fallback) ---- */
  var etaRoad = { key: "", at: 0, pending: false, miles: null, minutes: null, straight: null };

  function osrmLeg(a, b) {
    var url = "https://router.project-osrm.org/route/v1/driving/" +
      a.lng + "," + a.lat + ";" + b.lng + "," + b.lat + "?overview=false";
    return fetch(url).then(function (res) { return res.json(); }).then(function (d) {
      var r = d && d.routes && d.routes[0];
      if (!r || !isFinite(+r.distance) || !isFinite(+r.duration)) return null;
      return { miles: +r.distance / 1609.344, minutes: +r.duration / 60 };
    }).catch(function () { return null; });
  }

  function etaPoints() {
    var started = state.rideStatus === "started";
    if (state.rideStatus !== "accepted" && !started) return null;
    var from = ROLE === "driver" ? pointFrom(state.hereLat, state.hereLng) : savedDriverPoint();
    var to = started ? placeCoords("drop") : placeCoords("pickup");
    if (!from || !to) return null;
    return { from: from, to: to, kind: started ? "drop-off" : "pickup" };
  }

  function liveEta() {
    var p = etaPoints();
    if (!p) return null;
    var straight = haversine(p.from, p.to);
    var key = p.kind + "|" + p.to.lat.toFixed(3) + "," + p.to.lng.toFixed(3);
    var miles;
    var minutes;
    if (etaRoad.key === key && etaRoad.miles != null && etaRoad.straight > 0.05 && straight > 0.05) {
      var f = straight / etaRoad.straight;
      miles = etaRoad.miles * f;
      minutes = etaRoad.minutes * f;
    } else {
      miles = straight * 1.3;
      minutes = (miles / 30) * 60;
    }
    var now = Date.now();
    if (!etaRoad.pending && now - etaRoad.at > 10000 && (etaRoad.key !== key || now - etaRoad.at > 30000)) {
      etaRoad.pending = true;
      etaRoad.at = now;
      if (etaRoad.key !== key) { etaRoad.key = key; etaRoad.miles = null; }
      osrmLeg(p.from, p.to).then(function (leg) {
        etaRoad.pending = false;
        if (!leg || etaRoad.key !== key) return;
        etaRoad.miles = leg.miles;
        etaRoad.minutes = leg.minutes;
        etaRoad.straight = straight;
        refreshEtaDoms();
      });
    }
    return { miles: miles, minutes: Math.max(1, Math.round(minutes)), kind: p.kind, arriving: straight <= 0.06 };
  }

  function arriveClock(minutes) {
    try {
      return new Date(Date.now() + minutes * 60000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    } catch (e) { return ""; }
  }

  function tripEtaText() {
    var e = liveEta();
    if (!e) return state.rideStatus === "started" ? "" : "Distance shows once your location is on.";
    if (e.arriving) return "Arriving at " + e.kind;
    return "To " + e.kind + ": " + e.miles.toFixed(1) + " mi · ~" + e.minutes + " min · arrive " + arriveClock(e.minutes);
  }

  function refreshEtaDoms() {
    if (ROLE === "customer") {
      refreshDriverEtaDom();
      return;
    }
    var el = document.getElementById("trip-eta");
    if (el) {
      var t = tripEtaText();
      if (el.textContent !== t) el.textContent = t;
    }
  }

  /* ---- 5. Rider live location (only while the driver is on the way) + photo pin on the driver map ---- */
  var riderShare = { watch: null, code: "", lastAt: 0, lastLat: null, lastLng: null, sent: false };

  function stopRiderShare() {
    if (riderShare.watch != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(riderShare.watch); } catch (e) {}
    }
    if (riderShare.sent && riderShare.code && syncOn()) {
      /* After pickup / cancel: take the rider's position back off the ride record. */
      patchRide(riderShare.code, { riderLat: null, riderLng: null, riderLocAt: null }).catch(function () {});
    }
    riderShare = { watch: null, code: "", lastAt: 0, lastLat: null, lastLng: null, sent: false };
  }

  function riderSharing() {
    return ROLE === "customer" && signedIn() && syncOn() && !!state.code &&
      state.screen === "trip" && state.rideStatus === "accepted" && !!navigator.geolocation;
  }

  function syncRiderLocationShare() {
    if (ROLE !== "customer") return;
    if (!riderSharing()) {
      if (riderShare.watch != null || riderShare.sent) stopRiderShare();
      return;
    }
    if (riderShare.watch != null && riderShare.code === state.code) return;
    stopRiderShare();
    riderShare.code = state.code;
    try {
      riderShare.watch = navigator.geolocation.watchPosition(onRiderFix, function () {}, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000
      });
    } catch (e) {}
  }

  function onRiderFix(pos) {
    if (!pos || !pos.coords || !riderSharing() || riderShare.code !== state.code) return;
    var lat = +pos.coords.latitude;
    var lng = +pos.coords.longitude;
    if (!isFinite(lat) || !isFinite(lng)) return;
    var now = Date.now();
    if (now - riderShare.lastAt < 10000) return;
    var moved = riderShare.lastLat == null ? 1 : haversine({ lat: riderShare.lastLat, lng: riderShare.lastLng }, { lat: lat, lng: lng });
    if (moved < 0.006 && now - riderShare.lastAt < 30000) return;
    riderShare.lastAt = now;
    riderShare.lastLat = lat;
    riderShare.lastLng = lng;
    riderShare.sent = true;
    patchRide(riderShare.code, {
      riderLat: Math.round(lat * 1e6) / 1e6,
      riderLng: Math.round(lng * 1e6) / 1e6,
      riderLocAt: now,
      riderLocAcc: Math.round(Number(pos.coords.accuracy) || 0)
    }).catch(function () {});
  }

  var riderMarker = null;
  var nearZoomDone = "";

  function noteRiderLive(ride) {
    if (!ride || ROLE !== "driver") return;
    if (!isCoord(ride.riderLat) || !isCoord(ride.riderLng)) {
      state.riderLiveLat = null;
      state.riderLiveLng = null;
      return;
    }
    state.riderLiveLat = +ride.riderLat;
    state.riderLiveLng = +ride.riderLng;
    state.riderLiveAt = Number(ride.riderLocAt) || 0;
    var p = riderLivePoint();
    if (riderMarker && p) riderMarker.setLatLng([p.lat, p.lng]);
    nearPickupZoom(false);
  }

  /* Rider's phone GPS if fresh (3 min) and near the pickup (0.5 mi); otherwise null (use the pickup pin). */
  function riderLivePoint() {
    var p = pointFrom(state.riderLiveLat, state.riderLiveLng);
    if (!p) return null;
    if (!(Date.now() - (Number(state.riderLiveAt) || 0) < 3 * 60000)) return null;
    var pick = placeCoords("pickup");
    if (pick && haversine(p, pick) > 0.5) return null;
    return p;
  }

  function riderPhotoIcon() {
    var photo = safePhoto(state.riderPhoto);
    if (!photo) return pinIcon(state.name ? String(state.name).split(" ")[0] : "Rider", "pin-you");
    return window.L.divIcon({
      className: "pin-icon",
      html: '<img class="rider-photo-pin" alt="Rider" src="' + photo + '">',
      iconSize: [56, 56],
      iconAnchor: [28, 28]
    });
  }

  /* One simple zoom: when the driver is within ~0.2 mi of the rider, zoom in tight on them. */
  function nearPickupZoom(force) {
    if (ROLE !== "driver" || state.screen !== "trip" || state.rideStatus !== "accepted" || !liveMap) return;
    var here = pointFrom(state.hereLat, state.hereLng);
    var target = riderLivePoint() || placeCoords("pickup");
    if (!here || !target) return;
    if (haversine(here, target) > 0.2) return;
    var code = state.driverCode || state.code || "ride";
    if (!force && nearZoomDone === code) return;
    nearZoomDone = code;
    try {
      liveMap.fitBounds(window.L.latLngBounds([[here.lat, here.lng], [target.lat, target.lng]]), { padding: [40, 40], maxZoom: 18 });
    } catch (e) {}
  }

  /* ---- 7. Speed (mph) + ride counts ---- */
  var speedTrack = { lat: null, lng: null, at: 0 };

  function noteSpeed(pos) {
    if (!pos || !pos.coords) return;
    var now = Date.now();
    var lat = +pos.coords.latitude;
    var lng = +pos.coords.longitude;
    var mph = null;
    var s = pos.coords.speed;
    if (s != null && isFinite(s) && s >= 0) {
      mph = s * 2.23694;
    } else if (speedTrack.at && now - speedTrack.at >= 1500) {
      var d = haversine({ lat: speedTrack.lat, lng: speedTrack.lng }, { lat: lat, lng: lng });
      mph = d < 0.005 ? 0 : d / ((now - speedTrack.at) / 3600000);
    }
    if (!speedTrack.at || now - speedTrack.at >= 1500) speedTrack = { lat: lat, lng: lng, at: now };
    if (mph != null && isFinite(mph) && mph < 130) {
      state.speedMph = mph < 1 ? 0 : mph;
      state.speedAt = now;
    }
  }

  function speedLabel() {
    if (!state.speedAt) return "";
    if (Date.now() - state.speedAt > 20000) return "0 mph";
    return Math.round(state.speedMph || 0) + " mph";
  }

  var rideHistoryServer = null;

  function loadRideHistory() {
    if (ROLE !== "driver" || !signedIn() || !syncOn()) return Promise.resolve();
    return authFetch(historyUrl(driverPresenceId())).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      rideHistoryServer = data && typeof data === "object" ? data : {};
      refreshMilesTodayDom();
    }).catch(function () {});
  }

  function rideCounts() {
    var byCode = {};
    if (rideHistoryServer) {
      Object.keys(rideHistoryServer).forEach(function (c) {
        var e = rideHistoryServer[c];
        if (e && e.day) byCode[c] = String(e.day);
      });
    }
    readRideLog().forEach(function (e) { if (e && e.code && e.day) byCode[e.code] = String(e.day); });
    var today = chicagoToday();
    var monday = mondayOfWeek(today);
    var out = { today: 0, week: 0, all: 0 };
    Object.keys(byCode).forEach(function (c) {
      var d = byCode[c];
      out.all += 1;
      if (d === today) out.today += 1;
      if (d >= monday && d <= today) out.week += 1;
    });
    return out;
  }

  function ridesCountLabel() {
    var c = rideCounts();
    return "Rides: " + c.today + " today · " + c.week + " this week · " + c.all + " all-time";
  }

  function v51Styles() {
    if (document.getElementById("v51-style")) return;
    var s = document.createElement("style");
    s.id = "v51-style";
    s.textContent =
      "#ride-popup{position:fixed;inset:0;z-index:9999;background:rgba(5,14,28,.93);display:flex;align-items:center;justify-content:center;padding:16px}" +
      "#ride-popup .rp-card{background:#0b1c33;color:#fff;border:2px solid #f0d48a;border-radius:20px;max-width:460px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.5);max-height:92vh;overflow:auto}" +
      "#ride-popup .rp-title{font-size:30px;font-weight:800;color:#f0d48a;margin:0 0 14px;text-align:center}" +
      "#ride-popup .rp-who{display:flex;gap:14px;align-items:center;margin-bottom:12px}" +
      "#ride-popup .rp-photo{width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid #f0d48a;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:36px;background:#14304f}" +
      "#ride-popup .rp-name{font-size:22px;font-weight:700}" +
      "#ride-popup .rp-sub{color:#c9d3e0;font-size:14px}" +
      "#ride-popup .rp-row{margin:10px 0;font-size:17px;line-height:1.35}" +
      "#ride-popup .rp-row b{display:block;color:#f0d48a;font-size:12px;letter-spacing:.08em;text-transform:uppercase}" +
      "#ride-popup .rp-fare{font-size:24px;font-weight:800;margin:14px 0 4px}" +
      "#ride-popup .rp-actions{display:flex;gap:12px;margin-top:16px}" +
      "#ride-popup .rp-actions button{flex:1;font-size:24px;font-weight:800;padding:20px 10px;border-radius:14px;border:0;color:#fff;cursor:pointer}" +
      "#ride-popup .rp-accept{background:#2e9d4f}#ride-popup .rp-deny{background:#8a2323}" +
      ".nav-btn-big{display:block;text-align:center;font-size:24px;font-weight:800;padding:18px 12px;margin:10px 0 6px;background:#1f6fd1;color:#fff !important;border-radius:14px;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25)}" +
      ".trip-eta{font-size:18px;font-weight:700;margin:4px 0 10px}" +
      ".rider-photo-pin{width:52px;height:52px;border-radius:50%;object-fit:cover;border:3px solid #f0d48a;box-shadow:0 0 0 3px rgba(11,28,51,.65),0 4px 10px rgba(0,0,0,.45);background:#0b1c33;display:block}" +
      ".chat-box .chat-bubble{background:#14304f;border-radius:12px;padding:10px 12px;margin:8px 0;font-size:18px}" +
      ".chat-box .chat-bubble.mine{background:#1a3d24}" +
      ".chat-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}" +
      ".chat-chips .chat-chip{font-size:16px;font-weight:700;padding:12px 14px}";
    document.head.appendChild(s);
  }

  /* ================= v52: active-ride recovery, no duplicate requests, clear PIN status ================= */
  var ACTIVE_KEY = "pcs-rider-active-ride"; /* survives a new request overwriting the ride store */
  var PINS_KEY = "pcs-rider-pins"; /* PIN per ride code, so a PIN is never lost on this phone */
  var activeRefreshAt = 0;

  function isActiveStatus(st) {
    st = String(st || "").toLowerCase();
    return st === "requested" || st === "pending_owner" || st === "pending-owner" || st === "accepted" || st === "started";
  }

  function activeRiderRide() {
    if (ROLE !== "customer" || !signedIn()) return null;
    var r = currentRide();
    if (!r || !r.pickupStreet || !rideBelongsToSession(r) || !isActiveStatus(r.status)) return null;
    return r;
  }

  function readActiveMark() {
    try {
      var m = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
      return m && m.code ? m : null;
    } catch (e) { return null; }
  }

  function rememberActiveRide(code) {
    if (!code) return;
    try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ code: code, session: readSession(), at: Date.now() })); } catch (e) {}
  }

  function clearActiveMark(code) {
    var m = readActiveMark();
    if (m && (!code || m.code === code)) {
      try { localStorage.removeItem(ACTIVE_KEY); } catch (e) {}
    }
  }

  function rememberPin(code, pin) {
    pin = normalizeStoredPin(pin);
    if (!code || !pin) return;
    try {
      var m = JSON.parse(localStorage.getItem(PINS_KEY) || "{}") || {};
      m[code] = { pin: pin, at: Date.now() };
      var keys = Object.keys(m).sort(function (a, b) { return (m[b].at || 0) - (m[a].at || 0); });
      keys.slice(20).forEach(function (k) { delete m[k]; });
      localStorage.setItem(PINS_KEY, JSON.stringify(m));
    } catch (e) {}
  }

  function recalledPin(code) {
    if (!code) return "";
    try {
      var m = JSON.parse(localStorage.getItem(PINS_KEY) || "{}") || {};
      return normalizeStoredPin(m[code] && m[code].pin);
    } catch (e) { return ""; }
  }

  /* Open the rider's in-progress ride screen (used by Back to my ride / Cancel that ride / reload). */
  function goToActiveRide(ride) {
    if (!ride) return false;
    applyRide(ride);
    if (!normalizeStoredPin(state.pin)) {
      var p = recalledPin(ride.code);
      if (p) state.pin = p;
    }
    state.error = "";
    state.cancelError = "";
    state.cancelConfirm = false;
    state.customerGeocodeTried = false;
    var st = String(ride.status || "").toLowerCase();
    state.screen = (st === "accepted" || st === "started") ? "trip" : "waiting";
    return true;
  }

  /* Reload with the ride store gone/overwritten but a remembered active code: pull it back from the server. */
  function restoreFromActiveMark() {
    if (ROLE !== "customer" || !signedIn() || !syncOn()) return;
    if (activeRiderRide()) return;
    var mark = readActiveMark();
    if (!mark || (mark.session && mark.session !== readSession())) return;
    getRide(mark.code).then(function (ride) {
      if (!ride || !isActiveStatus(ride.status)) {
        clearActiveMark(mark.code);
        return;
      }
      if (activeRiderRide()) return;
      if (!ride.code) ride.code = mark.code;
      ride.pin = recalledPin(mark.code) || null;
      try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (e) {}
      writeRideOwner(readSession());
      goToActiveRide(ride);
      render();
    }).catch(function () {});
  }

  /* While the "already have a ride" card is up, check the server so a cancelled/denied ride unblocks booking. */
  function refreshActiveRideStatus(code) {
    if (!syncOn() || !code || Date.now() - activeRefreshAt < 5000) return;
    activeRefreshAt = Date.now();
    getRide(code).then(function (ride) {
      if (!ride) return;
      var local = currentRide();
      if (!local || local.code !== code) return;
      if (String(ride.status || "") === String(local.status || "")) return;
      ride.pin = normalizeStoredPin(local.pin) || recalledPin(code) || null;
      if (!ride.code) ride.code = code;
      try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (e) {}
      if (!isActiveStatus(ride.status)) clearActiveMark(code);
      if (state.screen === "home") render();
    }).catch(function () {});
  }

  /* Before a new request: if this phone remembers an open ride but the local copy is gone, ask the server first. */
  function checkMarkBeforeRequest(form) {
    if (ROLE !== "customer" || !syncOn()) return false;
    var mark = readActiveMark();
    if (!mark || (mark.session && mark.session !== readSession())) return false;
    var errEl = document.getElementById("form-error");
    if (errEl) errEl.textContent = "Checking your current ride\u2026";
    function proceed() {
      state.error = "";
      form.dataset.markChecked = "1";
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
    getRide(mark.code).then(function (ride) {
      if (ride && isActiveStatus(ride.status)) {
        if (!ride.code) ride.code = mark.code;
        ride.pin = recalledPin(mark.code) || null;
        try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (e) {}
        writeRideOwner(readSession());
        state.error = "";
        state.screen = "home";
        render(); /* shows "You already have a ride requested" */
        return;
      }
      clearActiveMark(mark.code);
      proceed();
    }).catch(function () {
      /* Offline: don't risk a duplicate. Keep what they typed; just say why. */
      var el = document.getElementById("form-error");
      if (el) el.textContent = "Couldn't check your current ride. Check your signal and try again.";
    });
    return true;
  }

  function rideStatusWords(st) {
    st = String(st || "").toLowerCase();
    if (st === "pending_owner" || st === "pending-owner") return "waiting for Private Car Services to approve it";
    if (st === "requested") return "approved, waiting for a driver";
    if (st === "accepted") return "your driver is on the way";
    if (st === "started") return "your ride is in progress";
    return st;
  }

  function activeRideHomeCard(r) {
    refreshActiveRideStatus(r.code);
    return (
      '<div class="app-nav">' + logoutLine() + "</div>" +
      '<div class="card active-ride-card" id="active-ride-card">' +
      '<p class="tag">Ride in progress</p>' +
      "<h2>You already have a ride requested</h2>" +
      '<p class="lede">Ride ' + esc(r.code || "") + " · " + esc(rideStatusWords(r.status)) + ".<br>" +
      esc(r.pickupAddress || r.pickupStreet || "") + " → " + esc(r.dropAddress || r.dropStreet || "") + "</p>" +
      '<p class="fine">So drivers never get two requests, a new ride can be booked once this one is finished or cancelled.</p>' +
      '<button class="btn" type="button" id="back-to-ride">Back to my ride</button>' +
      (riderCanCancel(r.status) ? '<button class="btn secondary" type="button" id="cancel-that-ride">Cancel that ride</button>' : "") +
      "</div>"
    );
  }

  /* Ride screens: "← Request" only once the ride is over (otherwise it led to a fresh form = duplicate requests). */
  function riderBackButton() {
    if (isActiveStatus(state.rideStatus)) return "";
    return '<button class="btn ghost" type="button" id="back-home">← Book a new ride</button>';
  }

  /* One plain line that says where things stand and when the PIN appears.
     v53 rule: the PIN shows as soon as a driver accepts, card or no card (earlier if the card is already OK). */
  function riderStageNote() {
    var st = String(state.rideStatus || "").toLowerCase();
    if (!isActiveStatus(st) || st === "started") return "";
    var pinNow = riderPinReady();
    var msg;
    if (st === "pending_owner" || st === "pending-owner") {
      msg = "Step 1: waiting for Private Car Services to approve your ride. " +
        (pinNow ? "Your pickup PIN is below." : "Your pickup PIN shows as soon as a driver accepts.");
    } else if (st === "requested") {
      msg = pinNow ? "Approved. Waiting for a driver to accept. Your pickup PIN is below."
        : "Approved. Waiting for a driver to accept. Your pickup PIN shows as soon as a driver accepts.";
    } else {
      msg = "Your driver is on the way. Give them the PIN below when they arrive.";
    }
    return '<p class="note" id="rider-stage" role="status">' + esc(msg) + "</p>";
  }

  var SAMPLE = {
    name: "",
    phone: "",
    pickupStreet: "",
    pickupCity: "",
    pickupState: "TX",
    dropStreet: "",
    dropCity: "",
    dropState: "TX",
    time: ""
  };

  var GEO = {
    pickup: { lat: 30.4234, lng: -95.4808 },
    dropoff: { lat: 30.455, lng: -95.451 },
    driver: { lat: 30.4, lng: -95.505 }
  };

  var BOUNDS = {
    minLat: 30.395,
    maxLat: 30.465,
    minLng: -95.515,
    maxLng: -95.44
  };

  var ROLE = document.body && document.body.getAttribute("data-app") === "driver" ? "driver" : "customer";
  var STORE = "pcs-beta-ride";
  var RIDE_OWNER = "pcs-beta-ride-owner";
  var DRIVER_CODE = "pcs-driver-code";
  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Presence + open-request indexes live under fixed ride codes so current Firebase
  // /rides/{8-char} rules work without /open or /drivers paths.
  var PRESENCE_HUB = "AVLBLDRV";
  var OPEN_HUB = "REQUESTS";
  var MILES_HUB = "DRVRMLES"; /* 8-char hub (no I/O); DRVRMILZ wrongly had I */
  var ROSTER_HUB = "DRVRCMMS"; /* hire / approve / commission */
  var HISTORY_HUB = "DRVRHSTY"; /* completed ride history per driver */
  var RIDER_HISTORY_HUB = "RDRHSTRY"; /* v54: completed ride history per rider */
  var CALENDAR_HUB = "PCSCALND"; /* God day board: PCS-titled calendar rides */
  var PROFILE_HUB = "DRVRPRFL"; /* v50: permanent driver profile (car + photos) per driver id */
  var lastDriverPatchAt = 0;
  var lastDriverPatchLat = null;
  var lastDriverPatchLng = null;
  var lastTripMilesUiAt = 0;
  var lastGpsPollAt = 0;
  var accountSyncTried = false;
  var rideLookup = 0;
  var openListSeq = 0;
  var driving = { key: "", pending: "", done: false, miles: null, line: null };

  var state = {
    mode: ROLE,
    screen: "home",
    name: SAMPLE.name,
    phone: SAMPLE.phone,
    pickupStreet: SAMPLE.pickupStreet,
    pickupCity: SAMPLE.pickupCity,
    pickupState: SAMPLE.pickupState,
    pickupLine2: "",
    pickupZip: "",
    pickupPinned: false,
    dropStreet: SAMPLE.dropStreet,
    dropCity: SAMPLE.dropCity,
    dropState: SAMPLE.dropState,
    dropLine2: "",
    dropZip: "",
    dropPinned: false,
    stopList: [],
    hereFix: null,
    notice: "",
    cardStatus: "",
    cardLast4: "",
    cardBrand: "",
    paymentStatus: "",
    paidCents: 0,
    receiptUrl: "",
    cancelConfirm: false,
    cancelBusy: false,
    cancelError: "",
    driverNotice: "",
    date: "",
    time: SAMPLE.time,
    asap: true,
    tripType: "auto",
    error: "",
    passengers: 2,
    stops: 0,
    holiday: false,
    driverLat: null,
    driverLng: null,
    driverName: "",
    driverPhone: "",
    riderPhoto: "",
    driverPhoto: "",
    driverCarYear: "",
    driverCarMake: "",
    driverCarModel: "",
    driverCarPlate: "",
    driverCarSeats: "",
    driverCarPhoto: "",
    milesToday: 0,
    milesStartOdo: null,
    milesNeedStart: false,
    milesOdoDraft: "",
    milesOdoError: "",
    milesEndPrompt: false,
    milesEndDraft: "",
    milesEndError: "",
    milesTrackLat: null,
    milesTrackLng: null,
    milesTrackAt: 0,
    code: "",
    driverCode: "",
    codeError: "",
    codeDraft: "",
    pin: "",
    pinDraft: "",
    pinError: "",
    tripPath: [],
    useDrivenMiles: false,
    endedEarly: false,
    remoteLoading: false,
    dropFix: null,
    pickupFromHere: false,
    loginError: "",
    loginSetupEmail: "",
    loginSetupDraft: "",
    gateStep: "",
    isTest: false,
    openRides: [],
    selectedOpenCode: "",
    openListError: "",
    openListLoading: false,
    openListStamp: "",
    onlineDrivers: [],
    onlineStamp: "",
    boardMarkers: null,
    hubOpen: false,
    hubView: "menu",
    chatMessages: [],
    chatDraft: "",
    chatError: "",
    chatBusy: false,
    chatStamp: "",
    historyRows: [],
    historyLoading: false,
    historyError: "",
    historyReceipt: null,
    riderHistoryView: "",
    hubDay: "",
    commHidden: false,
    paymentSkipped: false,
    rosterStatus: "",
    rosterPct: Math.round(DRIVER_COMMISSION_RATE * 100),
    dayRequested: 0,
    scheduledRides: [],
    scheduledError: "",
    scheduledStamp: ""
  };

  var rafId = 0;
  var motionStart = 0;
  var liveMap = null;
  var carMarker = null;
  var tilesOk = false;
  var tileTimer = 0;

  var CAR_SVG =
    '<svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="30" fill="#0b1c33" stroke="#f0d48a" stroke-width="2"/>' +
    '<rect x="22" y="12" width="20" height="38" rx="9" fill="#f0d48a"/>' +
    '<rect x="25" y="18" width="14" height="10" rx="3" fill="#0b1c33"/>' +
    '<rect x="25" y="33" width="14" height="8" rx="2" fill="#14304f"/>' +
    '<rect x="17" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="42" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="17" y="36" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="42" y="36" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    "</svg>";

  function tomorrowISO() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    var z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  function chicagoParts(when) {
    var parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(when || new Date()).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    var hour = parts.hour === "24" ? "00" : parts.hour;
    return {
      date: parts.year + "-" + parts.month + "-" + parts.day,
      time: hour + ":" + parts.minute
    };
  }

  function pickupStamp(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    var ymd = String(dateStr).split("-");
    var hm = String(timeStr).split(":");
    if (ymd.length !== 3 || hm.length < 2) return null;
    var y = Number(ymd[0]);
    var m = Number(ymd[1]);
    var d = Number(ymd[2]);
    var h = Number(hm[0]);
    var min = Number(hm[1]);
    if (![y, m, d, h, min].every(function (n) { return isFinite(n); })) return null;
    return y * 100000000 + m * 1000000 + d * 10000 + h * 100 + min;
  }

  function chicagoNowStamp() {
    var now = chicagoParts(new Date());
    return pickupStamp(now.date, now.time);
  }

  function isPickupInPast(dateStr, timeStr) {
    var want = pickupStamp(dateStr, timeStr);
    var now = chicagoNowStamp();
    if (want == null || now == null) return false;
    return want < now;
  }

  function isAsapValue(v) {
    if (v === true || v === 1) return true;
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "asap" || s === "true" || s === "1";
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** Interpret YYYY-MM-DD + HH:MM as America/Chicago wall time → UTC ms. */
  function chicagoWallToMs(dateStr, timeStr) {
    if (!dateStr || !timeStr) return NaN;
    var wantDate = String(dateStr);
    var hm = String(timeStr).split(":");
    var wantTime = pad2(Number(hm[0]) || 0) + ":" + pad2(Number(hm[1]) || 0);
    var offsets = ["-05:00", "-06:00"];
    var i;
    for (i = 0; i < offsets.length; i += 1) {
      var iso = wantDate + "T" + wantTime + ":00" + offsets[i];
      var ms = Date.parse(iso);
      if (!isFinite(ms)) continue;
      var parts = chicagoParts(new Date(ms));
      if (parts.date === wantDate && parts.time === wantTime) return ms;
    }
    return Date.parse(wantDate + "T" + wantTime + ":00-05:00");
  }

  function chicagoWeekday(dateStr) {
    var ms = chicagoWallToMs(dateStr, "12:00");
    if (!isFinite(ms)) return -1;
    var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    var wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(new Date(ms));
    return map[wd] != null ? map[wd] : -1;
  }

  function normalizePhoneDigits(raw) {
    return String(raw || "").replace(/\D/g, "");
  }

  function phoneLooksValid(raw) {
    var d = normalizePhoneDigits(raw);
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d.length === 10;
  }

  function addressLooksAirport(text) {
    var s = String(text || "").toLowerCase();
    /* Houston-area airports + common terminal street names (matches estimator intent). */
    if (/\b(iah|hou|ews|ellington)\b/.test(s)) return true;
    if (/\b(hobby|william\s*p\.?\s*hobby)\b/.test(s)) return true;
    if (/\b(bush\s*intercontinental|george\s*bush|intercontinental)\b/.test(s)) return true;
    if (/\bairport\b/.test(s)) return true;
    if (/\b(n\s*terminal|terminal\s*rd|terminal\s*road|airport\s*blvd|airport\s*boulevard|airport\s*rd|airport\s*road)\b/.test(s)) return true;
    if (/\b(jfk\s*blvd|world\s*way|terminal\s*[a-z0-9])\b/.test(s)) return true;
    return false;
  }

  function detectAirportKind() {
    /* Explicit trip type (estimator-style) wins; otherwise infer from addresses. */
    var forced = String(state.tripType || "auto").toLowerCase();
    if (forced === "airport-drop" || forced === "airport-pick" || forced === "local") return forced;
    var pick = [state.pickupStreet, state.pickupCity, state.pickupState].join(" ");
    var drop = [state.dropStreet, state.dropCity, state.dropState].join(" ");
    var pickAir = addressLooksAirport(pick);
    var dropAir = addressLooksAirport(drop);
    if (pickAir && !dropAir) return "airport-pick";
    if (dropAir && !pickAir) return "airport-drop";
    if (pickAir && dropAir) return "airport-pick";
    return "local";
  }

  function validateScheduleRules() {
    if (state.asap || isAsapValue(state.time)) return "";
    if (!state.date || !state.time) return "Add a date and time.";
    var ms = chicagoWallToMs(state.date, state.time);
    if (!isFinite(ms)) return "That date or time is not valid.";
    var nowParts = chicagoParts(new Date());
    var nowMs = chicagoWallToMs(nowParts.date, nowParts.time);
    if (isFinite(nowMs) && ms < nowMs) return "Pick a date and time that have not passed yet.";
    var dow = chicagoWeekday(state.date);
    var hm = String(state.time).split(":");
    var hour = Number(hm[0]);
    var minute = Number(hm[1] || 0);
    var mins = hour * 60 + minute;
    if (dow === 0 || dow === 6) {
      if (!isFinite(nowMs) || ms - nowMs < 48 * 60 * 60 * 1000) {
        return "Weekend rides need at least 48 hours' notice (America/Chicago), or choose ASAP.";
      }
      return "";
    }
    if (dow < 1 || dow > 5) return "Could not check the weekday for that date.";
    if (mins < 8 * 60 || mins > 18 * 60) {
      return "Weekday scheduled rides are Mon–Fri 8:00 am–6:00 pm America/Chicago. Use ASAP for other hours, or call " + BUSINESS_PHONE + ".";
    }
    return "";
  }

  function bookingWebhookUrl() {
    try {
      if (window.PCS_SYNC && window.PCS_SYNC.bookingWebhook) return String(window.PCS_SYNC.bookingWebhook).trim();
      if (window.PCS_BOOKING_WEBHOOK) return String(window.PCS_BOOKING_WEBHOOK).trim();
    } catch (err) {}
    return "";
  }

  function webhookSecret() {
    try {
      if (window.PCS_SYNC && window.PCS_SYNC.webhookSecret) return String(window.PCS_SYNC.webhookSecret).trim();
    } catch (err) {}
    return "";
  }

  function notifyOwnerNewBooking(ride) {
    if (!ride || !ride.code) return;
    if (ride.isTest) return; /* never spam Matthew / Zapier for TEST rides */
    var hook = bookingWebhookUrl();
    if (!hook) return;
    /* Only after an authenticated Firebase save succeeded (caller must invoke post-save). */
    var secret = webhookSecret();
    if (!secret) {
      /* Require shared secret so unauthenticated POSTs cannot be faked usefully once Zapier checks it. */
      return;
    }
    try {
      fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "pcs_booking_pending_owner",
          code: ride.code,
          name: ride.name || "",
          phone: ride.phone || "",
          when: ride.when || "",
          date: ride.date || "",
          time: ride.time || "",
          asap: !!ride.asap,
          pickup: [ride.pickupStreet, ride.pickupCity, ride.pickupState].filter(Boolean).join(", "),
          dropoff: [ride.dropStreet, ride.dropCity, ride.dropState].filter(Boolean).join(", "),
          status: ride.status || "pending_owner",
          secret: secret,
          webhookSecret: secret
        })
      }).catch(function () {});
    } catch (err) {}
  }


  function rideIsAsap(ride) {
    if (!ride) return !!state.asap;
    if (isAsapValue(ride.asap)) return true;
    if (isAsapValue(ride.when)) return true;
    if (String(ride.time || "").trim().toLowerCase() === "asap") return true;
    return false;
  }

  function stampAsapNow() {
    var now = chicagoParts(new Date());
    state.date = now.date;
    state.time = now.time;
    state.asap = true;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function money(cents) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function readRiderAccount() {
    try {
      var raw = localStorage.getItem("pcs-rider-account");
      if (!raw) return null;
      var account = JSON.parse(raw);
      if (!account || typeof account !== "object") return null;
      return account;
    } catch (err) {
      return null;
    }
  }

  function safePhoto(value) {
    if (typeof value !== "string") return "";
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)) return "";
    if (value.length > 120000) return "";
    return value;
  }

  function photoImg(value) {
    var photo = safePhoto(value);
    if (!photo) return "";
    return '<img class="avatar" alt="" src="' + photo + '">';
  }

  function readDriverAccount() {
    try {
      var raw = localStorage.getItem("pcs-driver-account");
      if (!raw) return null;
      var account = JSON.parse(raw);
      if (!account || typeof account !== "object") return null;
      return account;
    } catch (err) {
      return null;
    }
  }


  function normalizePlate(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  }

  function hasCompleteCar(account) {
    if (!account) return false;
    var year = Number(account.carYear);
    var seats = Number(account.carSeats);
    return year >= 1980 && year <= 2100 &&
      String(account.carMake || "").trim() &&
      String(account.carModel || "").trim() &&
      normalizePlate(account.carPlate) &&
      seats >= 1 && seats <= 7 &&
      !!safePhoto(account.carPhoto);
  }

  function carLineFrom(accountOrRide) {
    if (!accountOrRide) return "";
    return [accountOrRide.carYear || accountOrRide.driverCarYear,
      accountOrRide.carMake || accountOrRide.driverCarMake,
      accountOrRide.carModel || accountOrRide.driverCarModel].filter(Boolean).join(" ");
  }

  function carPhotoImg(value) {
    var photo = safePhoto(value);
    if (!photo) return "";
    return '<img class="car-thumb" alt="Driver car" src="' + photo + '">';
  }

  function driverMidRide() {
    return ROLE === "driver" && state.screen === "trip" &&
      (state.rideStatus === "accepted" || state.rideStatus === "started");
  }

  function chicagoToday() {
    return chicagoParts(new Date()).date;
  }

  function milesStoreKey() {
    return "pcs-driver-miles-" + driverPresenceId();
  }

  function readMilesLocal() {
    try {
      var raw = localStorage.getItem(milesStoreKey());
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      return {};
    }
  }

  function writeMilesLocal(map) {
    try {
      localStorage.setItem(milesStoreKey(), JSON.stringify(map || {}));
    } catch (err) {}
  }

  function todayMilesRow() {
    var map = readMilesLocal();
    var day = chicagoToday();
    var row = map[day];
    if (!row || typeof row !== "object") return null;
    return row;
  }

  function milesUrl(driverId, day) {
    var root = databaseURL() + "/rides/" + encodeURIComponent(MILES_HUB);
    if (driverId && day) {
      return root + "/" + encodeURIComponent(driverId) + "/" + encodeURIComponent(day) + ".json";
    }
    if (driverId) {
      return root + "/" + encodeURIComponent(driverId) + ".json";
    }
    return root + ".json";
  }

  function persistMilesRow(row) {
    if (!row) return Promise.resolve();
    var day = chicagoToday();
    var map = readMilesLocal();
    map[day] = row;
    writeMilesLocal(map);
    state.milesToday = Number(row.gpsMiles) || 0;
    state.milesStartOdo = row.startOdometer != null ? Number(row.startOdometer) : null;
    if (!syncOn()) return Promise.resolve();
    return authFetch(milesUrl(driverPresenceId(), day), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) throw new Error("miles");
      return res.text().then(function () {});
    }).catch(function () {});
  }

  function shiftClosed(row) {
    if (!row || typeof row !== "object") return false;
    if (row.shiftClosed) return true;
    return row.endOdometer != null && isFinite(Number(row.endOdometer));
  }

  function ensureMilesDayReady() {
    if (ROLE !== "driver" || !signedIn()) return;
    var row = todayMilesRow();
    /*
      After logout (ending odo or skip) the shift is closed. Next login must enter a
      NEW opening odometer before GPS miles count again — miles while logged out stay
      personal. Keep showing today's gpsMiles so the counter never looks "stuck at 0"
      from a closed shift wiping the day total.
    */
    if (shiftClosed(row)) {
      if (driverMidRide()) {
        state.milesNeedStart = false;
        state.milesToday = Number(row && row.gpsMiles) || 0;
        state.milesStartOdo = row && row.startOdometer != null ? Number(row.startOdometer) : null;
        return;
      }
      state.milesNeedStart = true;
      state.milesToday = Number(row && row.gpsMiles) || 0;
      state.milesStartOdo = null;
      return;
    }
    if (row && row.startOdometer != null && isFinite(Number(row.startOdometer))) {
      state.milesNeedStart = false;
      state.milesToday = Number(row.gpsMiles) || 0;
      state.milesStartOdo = Number(row.startOdometer);
      ensureOnlineClock();
      return;
    }
    if (driverMidRide()) {
      state.milesNeedStart = false;
      state.milesToday = Number(row && row.gpsMiles) || 0;
      return;
    }
    state.milesNeedStart = true;
    state.milesToday = 0;
    state.milesStartOdo = null;
  }

  function canGoOnline() {
    if (ROLE !== "driver" || !signedIn()) return false;
    if (driverMidRide()) return true;
    return hasCompleteCar(readDriverAccount()) && !state.milesNeedStart && isDriverApproved();
  }

  function isDriverApproved() {
    if (!syncOn()) return true;
    if (state.rosterStatus === "approved") return true;
    /* Legacy hired rows with active:true and no approvalStatus count as approved. */
    return false;
  }

  function approvalGateCard() {
    if (ROLE !== "driver" || !signedIn() || driverMidRide()) return "";
    if (!syncOn()) return "";
    if (isDriverApproved()) return "";
    var st = state.rosterStatus || "pending";
    var title = st === "rejected" ? "Application rejected" : (st === "fired" ? "Account inactive" : "Waiting for approval");
    var body = st === "rejected"
      ? "Matthew declined this driver account. You cannot go online or accept rides."
      : (st === "fired"
        ? "This driver account was fired. Contact Private Car Services to be rehired."
        : "Your sign-up is pending. Matthew must Approve you in God mode before you can see open rides or go online.");
    return (
      '<div class="card approval-gate">' +
      '<p class="tag">' + esc(title) + "</p>" +
      '<p class="lede">' + esc(body) + "</p>" +
      '<p class="fine">Status: ' + esc(st || "pending") + "</p></div>"
    );
  }

  function trackDailyMiles(pos) {
    if (ROLE !== "driver" || !signedIn() || state.milesNeedStart) return;
    var lat;
    var lng;
    if (pos && pos.coords) {
      lat = Number(pos.coords.latitude);
      lng = Number(pos.coords.longitude);
    } else {
      lat = Number(state.hereLat);
      lng = Number(state.hereLng);
    }
    if (!isFinite(lat) || !isFinite(lng)) return;
    var now = Date.now();
    var prevLat = state.milesTrackLat;
    var prevLng = state.milesTrackLng;
    var prevAt = state.milesTrackAt || 0;
    if (!isFinite(prevLat) || !isFinite(prevLng) || !prevAt) {
      state.milesTrackLat = lat;
      state.milesTrackLng = lng;
      state.milesTrackAt = now;
      return;
    }
    var dist = haversine({ lat: prevLat, lng: prevLng }, { lat: lat, lng: lng });
    /* ~3 m — same points that already moved the map icon. */
    if (!(dist >= 0.002)) return;
    var hours = (now - prevAt) / 3600000;
    if (!(hours > 0)) return;
    var mph = dist / hours;
    var MAX_MPH = 100;
    if (mph > MAX_MPH) {
      if (hours < 1 / 3600) return;
      dist = MAX_MPH * hours;
    }
    state.milesTrackLat = lat;
    state.milesTrackLng = lng;
    state.milesTrackAt = now;
    var row = todayMilesRow() || {
      startOdometer: state.milesStartOdo,
      gpsMiles: 0,
      startedAt: now,
      lastUpdate: now
    };
    if (row.startOdometer == null || !isFinite(Number(row.startOdometer))) {
      if (state.milesStartOdo != null && isFinite(Number(state.milesStartOdo))) {
        row.startOdometer = Number(state.milesStartOdo);
      } else {
        return;
      }
    }
    if (row.endOdometer != null) delete row.endOdometer;
    if (row.shiftClosed) delete row.shiftClosed;
    row.gpsMiles = Math.round(((Number(row.gpsMiles) || 0) + dist) * 100) / 100;
    row.lastUpdate = now;
    if (!row.startedAt) row.startedAt = now;
    if (!(Number(row.shiftStartAt) > 0)) row.shiftStartAt = now;
    persistMilesRow(row);
    state.milesToday = Number(row.gpsMiles) || 0;
    refreshMilesTodayDom();
    if (syncOn()) publishDriverPresence();
  }

  /* ---------- Time online today (login/shift open -> logout), stored on the same miles row ---------- */

  function shiftOpen(row) {
    return !!(row && !shiftClosed(row) && row.startOdometer != null && isFinite(Number(row.startOdometer)));
  }

  function onlineMsToday() {
    var row = todayMilesRow();
    if (!row) return 0;
    var ms = Number(row.onlineMs) || 0;
    var start = Number(row.shiftStartAt) || 0;
    if (start > 0 && shiftOpen(row)) ms += Math.max(0, Date.now() - start);
    return ms;
  }

  function fmtOnline(ms) {
    var mins = Math.floor((Number(ms) || 0) / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return (h ? h + "h " : "") + m + "m online";
  }

  /* Start the online clock for an open shift (also covers shifts opened before this update). */
  function ensureOnlineClock() {
    if (ROLE !== "driver" || !signedIn()) return;
    var row = todayMilesRow();
    if (!shiftOpen(row) || Number(row.shiftStartAt) > 0) return;
    row.shiftStartAt = Date.now();
    if (row.onlineMs == null) row.onlineMs = 0;
    persistMilesRow(row);
  }

  /* Close the running segment into onlineMs (mutates row; caller persists). */
  function closeOnlineSegment(row, now) {
    if (!row) return row;
    var start = Number(row.shiftStartAt) || 0;
    if (start > 0) row.onlineMs = (Number(row.onlineMs) || 0) + Math.max(0, (now || Date.now()) - start);
    row.shiftStartAt = null;
    return row;
  }

  function milesTodayLabel() {
    var n = Number(state.milesToday) || 0;
    var spd = speedLabel();
    return "Today: " + n.toFixed(1) + " mi · " + fmtOnline(onlineMsToday()) + (spd ? " · " + spd : "");
  }

  function refreshMilesTodayDom() {
    if (ROLE !== "driver") return;
    var label = milesTodayLabel();
    Array.prototype.forEach.call(document.querySelectorAll("#miles-today"), function (el) {
      if (el.textContent !== label) el.textContent = label;
    });
    var rides = ridesCountLabel();
    Array.prototype.forEach.call(document.querySelectorAll("#rides-count"), function (el) {
      if (el.textContent !== rides) el.textContent = rides;
    });
  }

  /* ---------- Keep the screen awake while logged in (Screen Wake Lock API) ---------- */

  var wakeLockSentinel = null;
  var wakeLockPending = false;

  function wantWakeLock() {
    return ROLE === "driver" && signedIn();
  }

  function acquireWakeLock() {
    if (!wantWakeLock()) return;
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== "function") return;
    if (document.visibilityState !== "visible") return;
    if (wakeLockPending || (wakeLockSentinel && !wakeLockSentinel.released)) return;
    wakeLockPending = true;
    try {
      navigator.wakeLock.request("screen").then(function (sentinel) {
        wakeLockPending = false;
        wakeLockSentinel = sentinel;
        try {
          sentinel.addEventListener("release", function () {
            if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
          });
        } catch (err) {}
        if (!wantWakeLock()) releaseWakeLock();
      }).catch(function () { wakeLockPending = false; });
    } catch (err) {
      wakeLockPending = false;
    }
  }

  function releaseWakeLock() {
    var s = wakeLockSentinel;
    wakeLockSentinel = null;
    if (s && !s.released) {
      try { s.release().catch(function () {}); } catch (err) {}
    }
  }

  function vehicleNeededCard() {
    if (ROLE !== "driver" || !signedIn() || driverMidRide()) return "";
    if (hasCompleteCar(readDriverAccount())) return "";
    if (state.profileSyncing) {
      return '<div class="card vehicle-needed"><p class="tag">One moment</p>' +
        '<p class="lede">Loading your driver profile…</p></div>';
    }
    return (
      '<div class="card vehicle-needed">' +
      '<p class="tag">Car details required</p>' +
      '<p class="lede">Add your car year, make, model, plate, seats, and a front-right photo before going online.</p>' +
      '<a class="btn" href="signup/?v=24">Complete vehicle profile</a>' +
      "</div>"
    );
  }

  function milesStartCard() {
    if (ROLE !== "driver" || !signedIn() || !state.milesNeedStart) return "";
    if (!hasCompleteCar(readDriverAccount())) return "";
    if (driverMidRide()) return "";
    var closed = shiftClosed(todayMilesRow());
    var tag = closed ? "New shift — opening odometer" : "Starting mileage";
    var lede = closed
      ? "You logged out and closed the last shift. Enter a new opening odometer before miles count again. Miles while logged out stay personal (not counted). Today's GPS total so far stays on screen."
      : "Enter the starting odometer for today before you go online. Chicago calendar day.";
    return (
      '<div class="card miles-gate" id="miles-gate">' +
      '<p class="tag">' + esc(tag) + "</p>" +
      '<p class="lede">' + esc(lede) + "</p>" +
      (closed && Number(state.milesToday) > 0
        ? '<p class="fine">Today so far (before this shift): ' + Number(state.milesToday).toFixed(1) + " mi</p>"
        : "") +
      '<form id="miles-start-form" autocomplete="off">' +
      '<label for="miles-start-odo">Opening odometer</label>' +
      '<input id="miles-start-odo" name="odo" type="number" inputmode="decimal" min="0" step="0.1" required value="' +
      esc(state.milesOdoDraft || "") + '">' +
      '<p class="error" id="miles-odo-error" role="alert">' + esc(state.milesOdoError || "") + "</p>" +
      '<button class="btn" type="submit">Save and go online</button>' +
      "</form></div>"
    );
  }

  function milesEndCard() {
    if (!state.milesEndPrompt) return "";
    return (
      '<div class="card miles-gate" id="miles-end-gate">' +
      '<p class="tag">Ending mileage (optional)</p>' +
      '<p class="lede">You can save the ending odometer for today, or skip.</p>' +
      '<form id="miles-end-form" autocomplete="off">' +
      '<label for="miles-end-odo">Ending odometer</label>' +
      '<input id="miles-end-odo" name="odo" type="number" inputmode="decimal" min="0" step="0.1" value="' +
      esc(state.milesEndDraft || "") + '">' +
      '<p class="error" id="miles-end-error" role="alert">' + esc(state.milesEndError || "") + "</p>" +
      '<div class="row-actions">' +
      '<button class="btn" type="submit">Save and log out</button>' +
      '<button class="btn secondary" type="button" id="miles-end-skip">Skip</button>' +
      "</div></form></div>"
    );
  }

  function seatsWarningForRide(ride, account) {
    if (!ride || !account) return "";
    var seats = Number(account.carSeats);
    var pax = Number(ride.passengers);
    if (!(seats >= 1) || !(pax >= 1)) return "";
    if (pax <= seats) return "";
    return '<p class="note seats-warn">This request lists ' + esc(String(pax)) +
      " passengers; your car seats " + esc(String(seats)) + ". You can still accept.</p>";
  }


  /* v53: drivers see their own commission, not the rider fare. Same formula as the earnings log
     (appendCompletedRideLog): fare before tax (minus EXTRA_FEE) x this driver's % from /rides/DRVRCMMS/{driverId};
     70% (God mode DEFAULT_COMMISSION_PCT) when no rate is set. */
  function driverCommissionPct() {
    var pct = state.rosterPct != null ? Number(state.rosterPct) : Math.round(DRIVER_COMMISSION_RATE * 100);
    if (!isFinite(pct) || pct < 0 || pct > 100) pct = 70;
    return pct;
  }

  function commissionCentsFor(est) {
    if (!est || est.sub == null || !isFinite(Number(est.sub))) return null;
    var base = Number(est.sub) - EXTRA_FEE;
    if (base < 0) base = 0;
    return Math.round(base * (driverCommissionPct() / 100));
  }

  function commissionLine() {
    var pct = state.rosterPct != null ? Number(state.rosterPct) : Math.round(DRIVER_COMMISSION_RATE * 100);
    if (!isFinite(pct)) pct = Math.round(DRIVER_COMMISSION_RATE * 100);
    var rate = pct / 100;
    if (rate == null || typeof rate !== "number" || rate < 0 || rate > 1) {
      return '<p class="fine">Commission: rate not set yet</p>';
    }
    var est = estimate();
    if (!est.ready) {
      return '<p class="fine">Your commission is ' + pct + '% of the fare before tax and fees. Estimate only · not a payout.</p>';
    }
    var base = est.sub - EXTRA_FEE;
    if (base < 0) base = 0;
    var cents = Math.round(base * rate);
    return '<p><strong>Est. commission</strong> ' + money(cents) + '</p>' +
      '<p class="fine">' + pct + '% of the fare before tax and fees. Estimate only · not a payout.</p>';
  }

  function driverIdentityLine() {
    var img = photoImg(state.driverPhoto);
    var carImg = carPhotoImg(state.driverCarPhoto);
    if (!state.driverName && !img && !carImg && !state.driverCarPlate) return "";
    var phone = ""; /* v51: riders never see the driver's phone number */
    var who = state.driverName ? esc(state.driverName) : "your driver";
    var carBits = [];
    var carName = carLineFrom({
      carYear: state.driverCarYear,
      carMake: state.driverCarMake,
      carModel: state.driverCarModel
    });
    if (carName) carBits.push(esc(carName));
    if (state.driverCarPlate) carBits.push("Plate " + esc(normalizePlate(state.driverCarPlate)));
    if (state.driverCarSeats) carBits.push(esc(String(state.driverCarSeats)) + " seats");
    var carHtml = carBits.length
      ? '<p class="fine driver-car-line">' + carBits.join(" · ") + "</p>"
      : "";
    return '<div class="who driver-identity">' + img +
      "<div>" +
      '<p class="lede">Your driver is ' + who + "." + phone + "</p>" +
      carHtml +
      carImg +
      "</div></div>";
  }

  function haversine(a, b) {
    var R = 3958.7613;
    var p1 = (a.lat * Math.PI) / 180;
    var p2 = (b.lat * Math.PI) / 180;
    var dPhi = ((b.lat - a.lat) * Math.PI) / 180;
    var dL = ((b.lng - a.lng) * Math.PI) / 180;
    var h = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dL / 2) * Math.sin(dL / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function isCoord(v) {
    return v != null && v !== "" && isFinite(+v);
  }

  function pointFrom(lat, lng) {
    if (!isCoord(lat) || !isCoord(lng)) return null;
    return { lat: +lat, lng: +lng };
  }

  function placeCoords(prefix) {
    return pointFrom(state[prefix + "Lat"], state[prefix + "Lng"]);
  }

  function savedDriverPoint() {
    return pointFrom(state.driverLat, state.driverLng);
  }

  function driverNearPickup() {
    var driver = savedDriverPoint();
    var pickup = placeCoords("pickup");
    if (!driver || !pickup) return false;
    return haversine(driver, pickup) <= 20;
  }

  /* City driving ETA to pickup: haversine miles at ~22 mph, floor 2 min. */
  var CITY_DRIVE_MPH = 22;
  var ETA_FLOOR_MIN = 2;

  function driverPickupEta() {
    var driver = savedDriverPoint();
    var pickup = placeCoords("pickup");
    if (!driver || !pickup) return null;
    var miles = haversine(driver, pickup);
    if (!isFinite(miles) || miles < 0) return null;
    var minutes = Math.max(ETA_FLOOR_MIN, Math.round((miles / CITY_DRIVE_MPH) * 60));
    if (miles <= 0.08) minutes = 1;
    return { miles: miles, minutes: minutes };
  }

  function driverEtaText() {
    if (state.rideStatus !== "accepted" && state.rideStatus !== "started") return "";
    var eta = liveEta();
    if (!eta) return "";
    if (state.rideStatus === "started") {
      if (eta.arriving) return "Arriving at your drop-off";
      return "To drop-off: " + eta.miles.toFixed(1) + " mi · ~" + eta.minutes + " min · arrive " + arriveClock(eta.minutes);
    }
    if (eta.arriving) return "Driver is arriving";
    return "Driver is " + eta.miles.toFixed(1) + " mi away · ~" + eta.minutes + " min · arrives " + arriveClock(eta.minutes);
  }

  function driverEtaLine() {
    var label = driverEtaText();
    if (!label) return "";
    return '<p class="driver-eta" id="driver-eta">' + esc(label) + "</p>";
  }

  function refreshDriverEtaDom() {
    var el = document.getElementById("driver-eta");
    var label = driverEtaText();
    if (!label) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    if (el) {
      el.textContent = label;
      return;
    }
    var host = document.querySelector(".driver-identity") || document.querySelector(".status");
    if (!host || !host.parentNode) return;
    var p = document.createElement("p");
    p.className = "driver-eta";
    p.id = "driver-eta";
    p.textContent = label;
    if (host.nextSibling) host.parentNode.insertBefore(p, host.nextSibling);
    else host.parentNode.appendChild(p);
  }

  function unavailableCall() {
    return (
      '<div class="status"><i></i><span>No one is available</span></div>' +
      '<p class="lede">No one is available. Please call <a href="tel:' + BUSINESS_PHONE + '">' + esc(BUSINESS_PHONE) + "</a> directly.</p>"
    );
  }

  function driversOnlineNow() {
    var cutoff = Date.now() - 2 * 60 * 1000;
    return (state.onlineDrivers || []).filter(function (d) {
      return d && d.online !== false && Number(d.at || 0) >= cutoff;
    });
  }

  function someoneAvailable() {
    if (driversOnlineNow().length) return true;
    if (state.rideStatus === "accepted" || state.rideStatus === "started") return true;
    if (driverNearPickup()) return true;
    if (state.driverName) return true;
    return false;
  }

  function waitingStatusBlock(onTheWayLabel) {
    if (someoneAvailable()) {
      return '<div class="status"><i></i><span>' + esc(onTheWayLabel) + "</span></div>";
    }
    return unavailableCall();
  }

  function routePoints() {
    var pickup = placeCoords("pickup") || GEO.pickup;
    var dropoff = placeCoords("drop") || GEO.dropoff;
    var live = !!(placeCoords("pickup") && placeCoords("drop"));
    var here = pointFrom(state.hereLat, state.hereLng);
    var driver = here || (live
      ? {
          lat: pickup.lat - (dropoff.lat - pickup.lat) * 0.3 - 0.008,
          lng: pickup.lng - (dropoff.lng - pickup.lng) * 0.3 - 0.008
        }
      : GEO.driver);
    return { pickup: pickup, dropoff: dropoff, driver: driver, live: live };
  }

  /* Stops with a map pin, in order. Route + miles go pickup -> stops -> drop-off. */
  function viaPoints() {
    return (state.stopList || []).map(function (s) {
      return s && String(s.street || "").trim() ? pointFrom(s.lat, s.lng) : null;
    }).filter(Boolean);
  }

  function routeKey(a, b) {
    var key = a.lat.toFixed(5) + "," + a.lng.toFixed(5) + ">" + b.lat.toFixed(5) + "," + b.lng.toFixed(5);
    var via = viaPoints();
    if (via.length) {
      key += "|" + via.map(function (p) { return p.lat.toFixed(5) + "," + p.lng.toFixed(5); }).join(";");
    }
    return key;
  }

  function routeStillOnScreen() {
    if (ROLE === "customer") return state.screen === "waiting" || state.screen === "trip";
    return state.screen === "trip" || (state.screen === "home" && !!state.pickupStreet);
  }

  function ensureDrivingRoute(a, b) {
    if (!a || !b) return;
    var key = routeKey(a, b);
    if (driving.key === key && driving.done) return;
    if (driving.pending === key) return;
    driving.pending = key;
    var chain = [a].concat(viaPoints(), [b]);
    var url = "https://router.project-osrm.org/route/v1/driving/" +
      chain.map(function (p) { return p.lng + "," + p.lat; }).join(";") +
      "?overview=full&geometries=geojson";
    fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      var route = data && data.routes && data.routes[0];
      var coords = route && route.geometry && route.geometry.coordinates;
      if (!route || !coords || !coords.length || !isFinite(+route.distance)) throw new Error("osrm");
      if (driving.pending !== key && driving.key !== key) return;
      driving.key = key;
      driving.pending = "";
      driving.done = true;
      driving.miles = Math.round((+route.distance / 1609.344) * 100) / 100;
      driving.line = coords.map(function (pair) { return [pair[1], pair[0]]; });
      var pickup = placeCoords("pickup");
      var dropoff = placeCoords("drop");
      if (routeStillOnScreen() && pickup && dropoff && routeKey(pickup, dropoff) === key) render();
    }).catch(function () {
      if (driving.pending !== key && driving.key !== key) return;
      driving.key = key;
      driving.pending = "";
      driving.done = true;
      driving.miles = null;
      driving.line = null;
    });
  }

  function routeLatLngs(a, b) {
    if (!a || !b) return [];
    ensureDrivingRoute(a, b);
    var key = routeKey(a, b);
    if (driving.key === key && driving.line && driving.line.length > 1) return driving.line;
    return [a].concat(viaPoints(), [b]).map(function (p) { return [p.lat, p.lng]; });
  }

  function straightChainMiles(a, b) {
    var chain = [a].concat(viaPoints(), [b]);
    var sum = 0;
    var i;
    for (i = 1; i < chain.length; i += 1) sum += haversine(chain[i - 1], chain[i]);
    return sum;
  }

  function drivenPathMiles() {
    var path = state.tripPath || [];
    if (path.length < 2) return null;
    var sum = 0;
    var i;
    for (i = 1; i < path.length; i += 1) {
      sum += haversine(path[i - 1], path[i]);
    }
    return Math.round(sum * 100) / 100;
  }

  function recordTripPoint(lat, lng) {
    if (!isCoord(lat) || !isCoord(lng)) return;
    if (state.rideStatus !== "started") return;
    var point = { lat: +lat, lng: +lng };
    var path = state.tripPath || [];
    var last = path.length ? path[path.length - 1] : null;
    if (last && haversine(last, point) < 0.008) return; /* ~13 m */
    path.push(point);
    if (path.length > 400) path = path.slice(path.length - 400);
    state.tripPath = path;
  }

  function tripMiles() {
    var pickup = placeCoords("pickup");
    var dropoff = placeCoords("drop");
    if (!pickup || !dropoff) return { raw: 0, billed: 0, ready: false };
    var driven = drivenPathMiles();
    var hundredths;
    if (state.useDrivenMiles && driven != null) {
      hundredths = driven;
    } else {
      var key = routeKey(pickup, dropoff);
      if (driving.key === key && driving.done && driving.miles != null) hundredths = driving.miles;
      else {
        hundredths = Math.round(straightChainMiles(pickup, dropoff) * 100) / 100;
        if (!(driving.key === key && driving.done)) ensureDrivingRoute(pickup, dropoff);
      }
      /* Live trip: once we have a GPS path, bill the greater of planned vs driven. */
      if ((state.rideStatus === "started" || state.rideStatus === "completed") && driven != null && driven > hundredths) {
        hundredths = driven;
      }
    }
    var billed = Math.ceil(hundredths);
    if (billed < 1) billed = 1;
    return { raw: hundredths, billed: billed, ready: true };
  }

  function resolveTier(dateStr, timeStr, isHoliday) {
    var daytime = { cents: DAY_MILE_CENTS, label: "Weekday daytime", airportDrop: AIRPORT.daytime.drop, airportPick: AIRPORT.daytime.pick };
    var weekendNight = { cents: NIGHT_MILE_CENTS, label: "Nights, weekends & holidays", airportDrop: AIRPORT.weekendNight.drop, airportPick: AIRPORT.weekendNight.pick };
    var late = { cents: LATE_MILE_CENTS, label: "Late night", airportDrop: AIRPORT.late.drop, airportPick: AIRPORT.late.pick };
    if (!dateStr || !timeStr) return daytime;
    var hm = timeStr.split(":");
    var hour = Number(hm[0]);
    var day = chicagoWeekday(dateStr);
    if (day < 0) {
      var ymd = dateStr.split("-");
      var date = new Date(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]), Number(hm[0]), Number(hm[1] || 0), 0, 0);
      day = date.getDay();
    }
    if (hour >= 22 || hour < 6) return late;
    if (day === 0 || day === 6 || isHoliday || (hour >= 18 && hour <= 21)) return weekendNight;
    return daytime;
  }

  function ridePassengers() {
    var n = Number(state.passengers);
    return n >= 1 ? n : 2;
  }

  function rideStops() {
    var n = Number(state.stops);
    return n > 0 ? n : 0;
  }

  function isShortNotice() {
    if (state.asap || isAsapValue(state.time)) return true;
    if (!state.date || !state.time) return false;
    var whenMs = chicagoWallToMs(state.date, state.time);
    if (!isFinite(whenMs)) return false;
    return whenMs - Date.now() < 24 * 60 * 60 * 1000;
  }

  var busyCache = null;

  function pickupInstant() {
    if (state.asap || isAsapValue(state.time)) return new Date();
    var ms = chicagoWallToMs(state.date, state.time);
    if (!isFinite(ms)) return new Date(NaN);
    return new Date(ms);
  }

  function rideHitsBusy(windows) {
    var start = pickupInstant().getTime();
    var end = start + 60 * 60 * 1000;
    if (!windows || isNaN(start)) return false;
    for (var i = 0; i < windows.length; i++) {
      var win = windows[i] || {};
      var winStart = new Date(win.start).getTime();
      var winEnd = new Date(win.end).getTime();
      if (isNaN(winStart) || isNaN(winEnd)) continue;
      if (start < winEnd && winStart < end) return true;
    }
    return false;
  }

  function loadBusyWindows() {
    if (busyCache) return Promise.resolve(busyCache);
    return fetch("busy.json").then(function (res) {
      if (!res.ok) throw new Error("busy");
      return res.json();
    }).then(function (data) {
      busyCache = data && data.windows ? data.windows : [];
      return busyCache;
    });
  }

  function estimate() {
    var miles = tripMiles();
    var tierDate = state.date;
    var tierTime = state.time;
    if (state.asap || isAsapValue(state.time) || !tierDate || !tierTime || String(tierTime).toLowerCase() === "asap") {
      var nowParts = chicagoParts(new Date());
      tierDate = nowParts.date;
      tierTime = nowParts.time;
    }
    var tier = resolveTier(tierDate, tierTime, !!state.holiday);
    var extraPax = Math.max(0, ridePassengers() - 2);
    var extraStops = rideStops();
    var mileage = miles.ready ? miles.billed * tier.cents : 0;
    var paxCents = extraPax * EXTRA_PAX_CENTS;
    var stopCents = extraStops * EXTRA_STOP_CENTS;
    var kind = detectAirportKind();
    var baseCents = BASE_CENTS;
    var baseLabel = "Local base";
    if (kind === "airport-drop") {
      baseCents = tier.airportDrop || BASE_CENTS;
      baseLabel = "Airport drop-off base";
    } else if (kind === "airport-pick") {
      baseCents = tier.airportPick || BASE_CENTS;
      baseLabel = "Airport pick-up base";
    }
    var beforeNotice = baseCents + mileage + paxCents + stopCents;
    var notice = miles.ready && isShortNotice() ? Math.round(beforeNotice * SHORT_NOTICE_PCT) : 0;
    var sub = beforeNotice + notice;
    var tax = Math.round(sub * TAX_RATE);
    return {
      ready: miles.ready,
      raw: miles.raw,
      billed: miles.billed,
      perMileCents: tier.cents,
      tierLabel: tier.label,
      mileage: mileage,
      base: baseCents,
      baseLabel: baseLabel,
      tripKind: kind,
      extraPax: extraPax,
      paxCents: paxCents,
      stopCents: stopCents,
      notice: notice,
      sub: sub,
      tax: tax,
      total: sub + tax
    };
  }

  function fareSnapshot() {
    var est = estimate();
    if (!est.ready) return null;
    return {
      billedMiles: est.billed,
      rawMiles: est.raw,
      fareSub: est.sub,
      fareTax: est.tax,
      fareTotal: est.total
    };
  }

  function cancelFeeCents() {
    var est = estimate();
    var pct = est.ready ? Math.round(est.total * 0.25) : 0;
    var floor = 1000; // $10.00
    return Math.max(pct, floor);
  }

  function testSkipPayEnabled() {
    if (state.isTest || isTestRide(currentRide())) return true; /* TEST rides never charge */
    try {
      var v = localStorage.getItem("PCS_TEST_SKIP_PAY");
      return v === "true" || v === "1" || v === "yes";
    } catch (err) {
      return false;
    }
  }

  /* ---------- Card step (Square), tied to this ride ---------- */

  /*
    Live card entry needs window.PCS_SQUARE (app/square-config.js): applicationId, locationId,
    cardOnFileUrl (Matthew's small server that saves the card with Square). Without all three the
    app shows the interim "we'll text you a secure link" step. It never opens the booking website.
  */
  function squareCfg() {
    var c = window.PCS_SQUARE || {};
    return {
      appId: String(c.applicationId || "").trim(),
      locationId: String(c.locationId || "").trim(),
      endpoint: String(c.cardOnFileUrl || "").trim(),
      chargeUrl: String(c.paymentUrl || "").trim(),
      sandbox: String(c.environment || "").toLowerCase() === "sandbox",
      testMode: c.testMode === true
    };
  }

  /* Square TEST MODE (app/square-config.js, ?squaretest=1 only): the card step charges the 25% deposit or the
     full estimate through the pcs-pay Worker (POST /charge). Off for real customers. */
  function squareChargeOn() {
    var c = squareCfg();
    return squareConfigured() && /^https:\/\//i.test(c.chargeUrl);
  }

  function ridePaid() {
    var p = String(state.paymentStatus || "");
    return p === "deposit_paid" || p === "paid_in_full";
  }

  function squareConfigured() {
    var c = squareCfg();
    return !!(c.appId && c.locationId && /^https:\/\//i.test(c.endpoint));
  }

  function cardStatusOk(st) {
    return st === "on_file" || st === "owner_ok" || st === "test_skip";
  }

  /* Card step done (or TEST ride / testing skip). v53: no longer gates the PIN once a driver accepts. */
  function rideCardReady() {
    if (state.isTest || isTestRide(currentRide())) return true;
    if (state.paymentSkipped && testSkipPayEnabled()) return true;
    return cardStatusOk(String(state.cardStatus || ""));
  }

  /* v53: PIN shows when a driver accepts (accepted/started), or earlier if the card is already OK. */
  function riderPinReady() {
    var st = String(state.rideStatus || "").toLowerCase();
    return st === "accepted" || st === "started" || rideCardReady();
  }

  function paymentInfoCopy() {
    return (
      '<div class="card payment-card">' +
      '<p class="tag">Payment</p>' +
      '<p class="lede">After you request, you add your card for this ride on a secure Square form. You are not charged until after drop-off, so you can add a tip.</p>' +
      '<p class="fine">Your pickup PIN shows as soon as a driver accepts your ride. This app never sees or stores your card number.</p>' +
      "</div>"
    );
  }

  function cardNeededHtml() {
    var requested = String(state.cardStatus || "") === "link_requested";
    var testing = testSkipPayEnabled();
    return (
      '<div class="card card-needed" id="card-needed">' +
      '<p class="tag">' + (squareChargeOn() ? "Pay for your ride" : "Add card for this ride") + '</p>' +
      (squareChargeOn() && squareCfg().testMode ? '<p class="fine" style="background:#c9a227;color:#0b1f3a;font-weight:700;padding:4px 8px;border-radius:8px">TEST MODE · Square sandbox · no real charge</p>' : "") +
      '<p class="lede">' + (squareChargeOn() ? "Pay the 25% deposit or the full estimate on a secure Square form." : (requested
        ? "Got it \u2014 we'll send your secure card link shortly. The Private Car Services office was notified about this ride."
        : "Add your card so you can pay and tip after drop-off. You are not charged until the ride is done.")) + "</p>" +
      '<button class="btn" type="button" id="square-hold-btn">' + (squareChargeOn() ? "Pay for this ride" : (requested ? "Card link requested &#10003;" : "Add card for this ride")) + "</button>" +
      (testing
        ? '<button class="btn ghost" type="button" id="skip-pay-btn">Skip for testing</button>' +
          '<p class="fine">Testing only · no real Square charge.</p>'
        : "") +
      '<p class="fine">Questions? Call <a href="tel:' + BUSINESS_PHONE + '">' + esc(BUSINESS_PHONE) + "</a>.</p>" +
      "</div>"
    );
  }

  function paymentStatusCard() {
    if (!rideCardReady()) return "";
    var st = String(state.cardStatus || "");
    var line;
    if (ridePaid()) {
      return '<div class="card payment-card" id="payment-received"><p class="tag">Payment</p>' +
        (squareCfg().testMode ? '<p class="fine" style="font-weight:700">TEST MODE · Square sandbox</p>' : "") +
        '<p class="lede"><strong>You\u2019re booked, payment received.</strong> ' + esc(money(state.paidCents || 0)) +
        (state.paymentStatus === "paid_in_full" ? " (paid in full)" : " (25% deposit)") +
        (state.cardLast4 ? " · " + esc(state.cardBrand || "card") + " ending " + esc(state.cardLast4) : "") + ".</p>" +
        (/^https:\/\//i.test(state.receiptUrl || "") ? '<p class="fine"><a id="rider-receipt-link" href="' + esc(state.receiptUrl) + '" target="_blank" rel="noopener">View your receipt</a></p>' : "") +
        "</div>";
    }
    if (state.isTest || st === "test_skip" || state.paymentSkipped) line = "Test ride: no card needed, no charge.";
    else if (st === "owner_ok") line = "Payment confirmed by Private Car Services.";
    else {
      line = "Card on file" +
        (state.cardLast4 ? " (" + (state.cardBrand || "card") + " ending " + state.cardLast4 + ")" : "") +
        ". You are charged after drop-off, so you can add a tip.";
    }
    return '<div class="card payment-card"><p class="tag">Payment</p><p class="lede">' + esc(line) + "</p></div>";
  }

  var sqCard = null;
  var sqLoading = null;

  function loadSquareSdk(sandbox) {
    if (window.Square && window.Square.payments) return Promise.resolve();
    if (sqLoading) return sqLoading;
    sqLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = sandbox ? "https://sandbox.web.squarecdn.com/v1/square.js" : "https://web.squarecdn.com/v1/square.js";
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { sqLoading = null; reject(new Error("square-sdk")); };
      document.head.appendChild(s);
    });
    return sqLoading;
  }

  function cardSheetEl() {
    var el = document.getElementById("card-sheet");
    if (el) return el;
    el = document.createElement("div");
    el.id = "card-sheet";
    el.className = "sheet-back card-sheet-back";
    document.body.appendChild(el);
    el.addEventListener("click", function (event) {
      if (event.target === el) closeCardSheet();
    });
    return el;
  }

  function closeCardSheet() {
    var el = document.getElementById("card-sheet");
    if (el) {
      el.classList.remove("open");
      el.innerHTML = "";
    }
    if (sqCard && sqCard.destroy) {
      try { sqCard.destroy(); } catch (err) {}
    }
    sqCard = null;
  }

  function cardSheetError(msg) {
    var e = document.getElementById("sq-card-error");
    if (e) e.textContent = msg || "";
  }

  function openCardStep() {
    if (ROLE !== "customer") return;
    var code = state.code || "";
    var est = estimate();
    var el = cardSheetEl();
    var head = '<p class="tag">' + (code ? "Ride " + esc(code) : "This ride") +
      (est.ready ? " · est. " + money(est.total) : "") + "</p>";
    if (squareChargeOn() && est.ready && code) {
      var depCents = Math.round(est.total * 0.25);
      el.innerHTML =
        '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="card-title">' + head +
        (squareCfg().testMode ? '<p class="fine" style="background:#c9a227;color:#0b1f3a;font-weight:700;padding:4px 8px;border-radius:8px">TEST MODE · card 4111 1111 1111 1111 · CVV 111 · ZIP 77042</p>' : "") +
        '<h3 id="card-title">Pay for this ride</h3>' +
        '<label class="check" style="display:flex;align-items:center;gap:10px;margin:10px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;color:var(--ink);font-size:15px;letter-spacing:0;text-transform:none;cursor:pointer"><input type="radio" name="sq-pay-choice" value="deposit" checked style="width:20px;height:20px;margin:0;padding:0;flex:0 0 auto;accent-color:#c9a227"> 25% deposit now \u2014 <strong>' + money(depCents) + "</strong></label>" +
        '<label class="check" style="display:flex;align-items:center;gap:10px;margin:10px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;color:var(--ink);font-size:15px;letter-spacing:0;text-transform:none;cursor:pointer"><input type="radio" name="sq-pay-choice" value="full" style="width:20px;height:20px;margin:0;padding:0;flex:0 0 auto;accent-color:#c9a227"> Pay in full \u2014 <strong>' + money(est.total) + "</strong></label>" +
        '<p class="fine">Square keeps your card; this app never sees the number.</p>' +
        '<div id="sq-card-container" class="sq-card"><p class="fine">Loading the secure card form\u2026</p></div>' +
        '<p class="error" id="sq-card-error" role="alert"></p>' +
        '<button class="btn" type="button" id="sq-pay-btn" disabled>Pay ' + money(depCents) + "</button>" +
        '<button class="btn secondary" type="button" id="card-sheet-close">Not now</button>' +
        "</div>";
      el.classList.add("open");
      var closeC = document.getElementById("card-sheet-close");
      if (closeC) closeC.addEventListener("click", closeCardSheet);
      var payBtn = document.getElementById("sq-pay-btn");
      var amountFor = function () {
        var pick = el.querySelector('input[name="sq-pay-choice"]:checked');
        return pick && pick.value === "full" ? { cents: est.total, choice: "full" } : { cents: depCents, choice: "deposit" };
      };
      Array.prototype.forEach.call(el.querySelectorAll('input[name="sq-pay-choice"]'), function (r) {
        r.addEventListener("change", function () {
          if (payBtn && payBtn.dataset.busy !== "1") payBtn.textContent = "Pay " + money(amountFor().cents);
        });
      });
      if (payBtn) {
        payBtn.addEventListener("click", function () { chargeSquareCard(amountFor()); });
        mountSquareCard("sq-pay-btn");
      }
      return;
    }
    if (squareConfigured()) {
      el.innerHTML =
        '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="card-title">' + head +
        '<h3 id="card-title">Add your card</h3>' +
        '<p class="lede">Square keeps your card; this app never sees the number. You are charged after drop-off (plus any tip you add).</p>' +
        '<div id="sq-card-container" class="sq-card"><p class="fine">Loading the secure card form…</p></div>' +
        '<p class="error" id="sq-card-error" role="alert"></p>' +
        '<button class="btn" type="button" id="sq-card-save" disabled>Save card</button>' +
        '<button class="btn secondary" type="button" id="card-sheet-close">Not now</button>' +
        "</div>";
    } else {
      var requested = String(state.cardStatus || "") === "link_requested";
      el.innerHTML =
        '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="card-title">' + head +
        '<h3 id="card-title">Card setup</h3>' +
        '<p class="lede">Card setup inside the app is being finalized. Tap below and the Private Car Services office will send you a secure Square card link for this ride.</p>' +
        '<p class="fine">Add your card so you can pay and tip after drop-off. Questions? Call <a href="tel:' +
        BUSINESS_PHONE + '">' + esc(BUSINESS_PHONE) + "</a>.</p>" +
        '<p class="error" id="sq-card-error" role="alert"></p>' +
        (requested
          ? '<p class="fine"><strong>Got it \u2014 we\u2019ll send your secure card link shortly.</strong> The office was notified. Questions? Call ' + esc(BUSINESS_PHONE) + ".</p>"
          : '<button class="btn" type="button" id="card-link-request">Send me the secure card link</button>') +
        '<button class="btn secondary" type="button" id="card-sheet-close">Close</button>' +
        "</div>";
    }
    el.classList.add("open");
    var closeBtn = document.getElementById("card-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", closeCardSheet);
    var linkBtn = document.getElementById("card-link-request");
    if (linkBtn) linkBtn.addEventListener("click", requestCardLink);
    var saveBtn = document.getElementById("sq-card-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", saveSquareCard);
      mountSquareCard();
    }
  }

  function mountSquareCard(buttonId) {
    var cfg = squareCfg();
    loadSquareSdk(cfg.sandbox).then(function () {
      /* Square.payments() returns the Payments object directly; Promise.resolve keeps this safe either way. */
      return Promise.resolve(window.Square.payments(cfg.appId, cfg.locationId)).then(function (payments) {
        return payments.card();
      });
    }).then(function (card) {
      if (!document.getElementById("sq-card-container")) {
        try { card.destroy(); } catch (e) {}
        return;
      }
      sqCard = card;
      document.getElementById("sq-card-container").innerHTML = "";
      return card.attach("#sq-card-container").then(function () {
        var saveBtn = document.getElementById(buttonId || "sq-card-save");
        if (saveBtn) saveBtn.disabled = false;
      });
    }).catch(function () {
      cardSheetError("The secure card form did not load. Check your signal and try again, or call " + BUSINESS_PHONE + ".");
    });
  }

  function saveSquareCard() {
    var saveBtn = document.getElementById("sq-card-save");
    if (!sqCard || !saveBtn) return;
    var cfg = squareCfg();
    var code = state.code || "";
    var est = estimate();
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    cardSheetError("");
    sqCard.tokenize().then(function (result) {
      if (!result || result.status !== "OK" || !result.token) {
        var first = result && result.errors && result.errors[0];
        throw new Error((first && first.message) || "Check the card details and try again.");
      }
      return fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rideCode: code,
          sourceId: result.token,
          name: state.name || "",
          phone: state.phone || "",
          email: firebaseEmail() || readSession() || "",
          estimateCents: est.ready ? est.total : null,
          isTest: !!state.isTest
        })
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || "Square did not save the card. Try again.");
        return data;
      });
    }).then(function (data) {
      var patch = {
        cardStatus: "on_file",
        cardOnFileAt: Date.now(),
        cardLast4: String(data.last4 || ""),
        cardBrand: String(data.brand || ""),
        squareCardId: String(data.cardId || ""),
        squareCustomerId: String(data.customerId || "")
      };
      function done() {
        state.cardStatus = "on_file";
        state.cardLast4 = patch.cardLast4;
        state.cardBrand = patch.cardBrand;
        saveRide(state.rideStatus || "pending_owner");
        closeCardSheet();
        render();
      }
      if (syncOn() && code) {
        return patchRide(code, patch).then(done, function () {
          throw new Error("Square saved your card, but the ride did not update. Call " + BUSINESS_PHONE + " and we will confirm it.");
        });
      }
      done();
    }).catch(function (err) {
      var btn = document.getElementById("sq-card-save");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save card";
      }
      cardSheetError((err && err.message) || "Could not save the card. Try again.");
    });
  }

  var sqChargeAttempt = 0;

  /* TEST MODE charge: Square token -> pcs-pay /charge -> paymentId/paid status on /rides/{code} and the REQUESTS row. */
  function chargeSquareCard(amount) {
    var payBtn = document.getElementById("sq-pay-btn");
    if (!sqCard || !payBtn || payBtn.dataset.busy === "1") return;
    var cfg = squareCfg();
    var code = state.code || "";
    if (!code) {
      cardSheetError("This ride has no booking code yet. Request the ride first.");
      return;
    }
    payBtn.dataset.busy = "1";
    payBtn.disabled = true;
    payBtn.textContent = "Paying\u2026";
    cardSheetError("");
    sqChargeAttempt += 1;
    var idem = ("ra-" + code + "-" + sqChargeAttempt + "-" + makeRideCode()).slice(0, 45);
    var email = firebaseEmail() || "";
    sqCard.tokenize().then(function (result) {
      if (!result || result.status !== "OK" || !result.token) {
        var first = result && result.errors && result.errors[0];
        throw new Error((first && first.message) || "Check the card details and try again.");
      }
      return fetch(cfg.chargeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: result.token,
          amountCents: amount.cents,
          bookingCode: code,
          buyerEmail: /@/.test(email) ? email : undefined,
          note: "Rider app \u00b7 " + (amount.choice === "full" ? "paid in full" : "25% deposit") + (cfg.testMode ? " \u00b7 TEST" : ""),
          idempotencyKey: idem
        })
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !data.ok || !data.paymentId) throw new Error((data && data.error) || "The payment didn't go through. Try again.");
        return data;
      });
    }).then(function (data) {
      var now = Date.now();
      var patch = {
        cardStatus: "on_file",
        cardOnFileAt: now,
        cardLast4: String(data.last4 || ""),
        cardBrand: String(data.brand || ""),
        paymentStatus: amount.choice === "full" ? "paid_in_full" : "deposit_paid",
        paidCents: Number(data.amountCents) || amount.cents,
        squarePaymentId: String(data.paymentId),
        squarePaymentStatus: String(data.status || ""),
        receiptUrl: /^https:\/\//i.test(data.receiptUrl || "") ? String(data.receiptUrl) : "",
        paymentEnv: cfg.sandbox ? "sandbox" : "production",
        paidAt: now,
        updatedAt: now
      };
      function done() {
        state.cardStatus = "on_file";
        state.cardLast4 = patch.cardLast4;
        state.cardBrand = patch.cardBrand;
        state.paymentStatus = patch.paymentStatus;
        state.paidCents = patch.paidCents;
        state.receiptUrl = patch.receiptUrl;
        saveRide(state.rideStatus || "pending_owner");
        closeCardSheet();
        render();
      }
      if (!syncOn()) { done(); return; }
      var rowPatch = authFetch(openIndexUrl(code), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardStatus: patch.cardStatus, paymentStatus: patch.paymentStatus, paidCents: patch.paidCents,
          squarePaymentId: patch.squarePaymentId, paymentEnv: patch.paymentEnv, updatedAt: now })
      }).catch(function () {});
      /* Paid either way: show it even if the ride record update fails (Matthew can match the Square payment by code). */
      return Promise.all([patchRide(code, patch).catch(function () {}), rowPatch]).then(done);
    }).catch(function (err) {
      var btn = document.getElementById("sq-pay-btn");
      if (btn) {
        btn.dataset.busy = "";
        btn.disabled = false;
        btn.textContent = "Pay " + money(amount.cents);
      }
      cardSheetError((err && err.message) || "The payment didn't go through. Try again.");
    });
  }

  function requestCardLink() {
    var btn = document.getElementById("card-link-request");
    var code = state.code || "";
    if (cardStatusOk(String(state.cardStatus || ""))) { closeCardSheet(); render(); return; } /* v52: never undo a card OK */
    var patch = { cardStatus: "link_requested", cardRequestedAt: Date.now() };
    function done() {
      state.cardStatus = "link_requested";
      saveRide(state.rideStatus || "pending_owner");
      closeCardSheet();
      render();
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Notifying the office…";
    }
    if (!syncOn() || !code) {
      done();
      return;
    }
    patchRide(code, patch).then(done).catch(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Send me the secure card link";
      }
      cardSheetError("That did not go through. Check your signal and try again, or call " + BUSINESS_PHONE + ".");
    });
  }

  function cancelWarningCopy() {
    var fee = cancelFeeCents();
    return (
      "If you cancel before pickup, a cancel fee of " + money(fee) +
      " may apply (25% of the estimate or $10, whichever is more). " +
      "Automatic card charges are not live yet — if you cancel, we will follow up about any fee."
    );
  }

  function completeActiveRide(opts) {
    opts = opts || {};
    if (ROLE !== "driver") return;
    if (state.rideStatus !== "started" && state.rideStatus !== "accepted") return;
    if (opts.endHere && isCoord(state.hereLat) && isCoord(state.hereLng)) {
      recordTripPoint(state.hereLat, state.hereLng);
      state.dropLat = +state.hereLat;
      state.dropLng = +state.hereLng;
      state.dropFix = { lat: +state.hereLat, lng: +state.hereLng };
      if (!state.dropStreet) state.dropStreet = "Ended at current location";
      state.endedEarly = true;
      state.useDrivenMiles = true;
      driving.key = "";
      driving.done = false;
      driving.miles = null;
      driving.line = null;
    }
    state.rideStatus = "completed";
    syncActiveTripFare({ status: "completed" });
    try { appendCompletedRideLog(); } catch (logErr) {}
    var code = state.driverCode || state.code || readDriverCode();
    if (syncOn() && code) deleteOpenRide(code).catch(function () {});
    state.screen = "trip";
    render();
  }

  function riderCanCancel(st) {
    st = String(st || "").toLowerCase();
    return st === "pending_owner" || st === "pending-owner" || st === "requested" || st === "accepted";
  }

  function cancelBlockHtml() {
    if (!riderCanCancel(state.rideStatus)) return "";
    var err = '<p class="error" role="alert">' + esc(state.cancelError || "") + "</p>";
    if (state.cancelConfirm) {
      var busy = !!state.cancelBusy;
      return (
        '<div class="card cancel-card" id="cancel-card">' +
        '<p class="tag">Cancel this ride?</p>' +
        '<p class="lede">' + esc(cancelWarningCopy()) + "</p>" +
        err +
        '<button class="btn danger" type="button" id="cancel-ride-yes"' + (busy ? " disabled" : "") + ">" +
        (busy ? "Cancelling…" : "Yes, cancel this ride") + "</button>" +
        '<button class="btn secondary" type="button" id="cancel-ride-no"' + (busy ? " disabled" : "") + ">Keep my ride</button>" +
        "</div>"
      );
    }
    return (
      '<div class="card" id="cancel-card">' +
      '<p class="tag">Cancel before pickup</p>' +
      '<p class="lede">' + esc(cancelWarningCopy()) + "</p>" +
      err +
      '<button class="btn secondary" type="button" id="cancel-ride">Cancel ride</button>' +
      "</div>"
    );
  }

  /*
    Old bug: this returned early unless status was "requested"/"accepted", but every new booking
    starts as "pending_owner" (waiting for Matthew's OK), so the Cancel button silently did nothing.
  */
  function cancelRiderRide() {
    if (ROLE !== "customer" || state.cancelBusy) return;
    var st = String(state.rideStatus || "").toLowerCase();
    if (!riderCanCancel(st)) {
      state.cancelError = st === "started"
        ? "This ride has started, so it cannot be cancelled in the app. Call " + BUSINESS_PHONE + "."
        : "This ride cannot be cancelled in the app. Call " + BUSINESS_PHONE + ".";
      render();
      return;
    }
    var fee = cancelFeeCents();
    var code = state.code;
    var now = Date.now();
    state.cancelBusy = true;
    state.cancelError = "";
    render();
    function finish() {
      try { localStorage.removeItem(STORE); } catch (err) {}
      writeRideOwner("");
      clearActiveMark(code); /* v52: a cancelled ride frees the rider to book again */
      clearRideFields();
      state.cancelBusy = false;
      state.cancelConfirm = false;
      state.screen = "home";
      state.notice = "Your ride " + (code ? code + " " : "") + "was cancelled. If a cancel fee applies, Private Car Services will follow up.";
      render();
    }
    function fail(err) {
      state.cancelBusy = false;
      state.cancelConfirm = true;
      state.cancelError = err && err.started
        ? "Your driver already started this ride, so it cannot be cancelled in the app. Call " + BUSINESS_PHONE + "."
        : "Could not cancel. Check your signal and try again, or call " + BUSINESS_PHONE + ".";
      render();
    }
    if (!syncOn() || !code) {
      finish();
      return;
    }
    getRide(code).catch(function () { return null; }).then(function (remote) {
      var rst = String((remote && remote.status) || st).toLowerCase();
      if (rst === "started" || rst === "completed") {
        var e = new Error("started");
        e.started = true;
        throw e;
      }
      var patch = { status: "cancelled", cancelledAt: now, cancelledBy: "rider", cancelFeeCents: fee, updatedAt: now };
      return patchRide(code, patch).then(function () {
        /* Keep the row on the REQUESTS hub as "cancelled": drivers only list "requested" rows (so it leaves
           their map at once) and God mode shows it as cancelled. */
        var summary = openSummaryFromRide(code, Object.assign({}, currentRide() || {}, remote || {}, patch));
        summary.status = "cancelled";
        summary.cancelledAt = now;
        summary.cancelledBy = "rider";
        summary.cancelFeeCents = fee;
        return authFetch(openIndexUrl(code), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(summary)
        }).then(function (res) {
          if (!res.ok) throw new Error("open");
        }).catch(function () {
          return deleteOpenRide(code).catch(function () {});
        });
      });
    }).then(finish, fail);
  }

  /* Driver side: if the rider cancels after you accepted, drop the trip and say so. */
  var driverCancelPollBusy = false;

  function pollDriverRideCancel() {
    if (ROLE !== "driver" || !signedIn() || !syncOn() || state.screen !== "trip") return;
    if (state.rideStatus !== "accepted" || driverCancelPollBusy) return;
    var code = state.driverCode || state.code || readDriverCode();
    if (!code) return;
    driverCancelPollBusy = true;
    getRide(code).then(function (ride) {
      driverCancelPollBusy = false;
      if (ride) noteRiderLive(ride);
      if (!ride || String(ride.status || "").toLowerCase() !== "cancelled") return;
      var now = state.driverCode || state.code || readDriverCode();
      if (state.screen !== "trip" || now !== code) return;
      state.driverNotice = (state.name ? state.name + " cancelled" : "The rider cancelled") +
        " ride " + code + ". It is off your map, and you can take another ride.";
      writeDriverCode("");
      state.driverCode = "";
      state.selectedOpenCode = "";
      try { localStorage.removeItem(STORE); } catch (err) {}
      clearRideFields();
      state.screen = "home";
      render();
      refreshOpenRides(true);
    }).catch(function () { driverCancelPollBusy = false; });
  }

  function routeLedeHtml() {
    var n = filledStops().length;
    return "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) +
      (n ? " (" + n + (n === 1 ? " stop" : " stops") + " on the way)" : "") +
      "<br>" + esc(prettyWhen()) + "</p>";
  }

  function syncActiveTripFare(extra) {
    if (ROLE !== "driver") return;
    if (state.rideStatus !== "started" && state.rideStatus !== "completed") return;
    var status = state.rideStatus;
    saveRide(status);
    var code = state.driverCode || state.code || readDriverCode();
    if (!syncOn() || !code) return;
    var patch = {
      status: status,
      dropStreet: state.dropStreet,
      dropCity: state.dropCity,
      dropState: state.dropState,
      dropLat: state.dropLat,
      dropLng: state.dropLng
    };
    var snap = fareSnapshot();
    if (snap) {
      patch.billedMiles = snap.billedMiles;
      patch.rawMiles = snap.rawMiles;
      patch.fareSub = snap.fareSub;
      patch.fareTax = snap.fareTax;
      patch.fareTotal = snap.fareTotal;
    }
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (k) { patch[k] = extra[k]; });
    }
    patchRide(code, patch).catch(function () {});
  }

  /* "Line 1, Line 2, City, ST ZIP" — line 2 and ZIP only when filled in (older rides have neither). */
  function addressLine(street, city, stateName, line2, zip) {
    var stZip = [stateName, zip].filter(Boolean).join(" ");
    return [street, line2, city, stZip].filter(function (part) {
      return part != null && String(part).trim() !== "";
    }).join(", ");
  }

  function pickupLine() {
    return addressLine(state.pickupStreet, state.pickupCity, state.pickupState, state.pickupLine2, state.pickupZip);
  }

  function dropLine() {
    return addressLine(state.dropStreet, state.dropCity, state.dropState, state.dropLine2, state.dropZip);
  }

  function stopLine(stop) {
    if (!stop) return "";
    return addressLine(stop.street, stop.city, stop.state, stop.line2, stop.zip);
  }

  function filledStops() {
    return (state.stopList || []).filter(function (s) { return s && String(s.street || "").trim(); });
  }

  function stopsSummaryHtml() {
    var list = filledStops();
    if (!list.length) return "";
    return list.map(function (s, i) {
      return "<p><strong>Stop " + (i + 1) + "</strong><br>" + esc(stopLine(s)) + "</p>";
    }).join("");
  }

  function prettyWhen() {
    if (state.asap || isAsapValue(state.time)) return "ASAP";
    if (!state.date || !state.time) return "";
    var parts = state.date.split("-");
    var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var day = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    var hm = state.time.split(":");
    var hh = Number(hm[0]);
    var mm = hm[1] || "00";
    if (!isFinite(hh)) return "";
    var suffix = hh >= 12 ? "PM" : "AM";
    var h12 = hh % 12 || 12;
    return day + " at " + h12 + ":" + mm + " " + suffix;
  }

  function project(point) {
    var route = routePoints();
    var minLat = BOUNDS.minLat, maxLat = BOUNDS.maxLat, minLng = BOUNDS.minLng, maxLng = BOUNDS.maxLng;
    if (route.live) {
      var lats = [route.pickup.lat, route.dropoff.lat, route.driver.lat];
      var lngs = [route.pickup.lng, route.dropoff.lng, route.driver.lng];
      routeLatLngs(route.pickup, route.dropoff).forEach(function (ll) {
        lats.push(ll[0]);
        lngs.push(ll[1]);
      });
      minLat = Math.min.apply(null, lats);
      maxLat = Math.max.apply(null, lats);
      minLng = Math.min.apply(null, lngs);
      maxLng = Math.max.apply(null, lngs);
      var padLat = Math.max((maxLat - minLat) * 0.35, 0.01);
      var padLng = Math.max((maxLng - minLng) * 0.35, 0.01);
      minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
    }
    return {
      x: ((point.lng - minLng) / (maxLng - minLng)) * 100,
      y: ((maxLat - point.lat) / (maxLat - minLat)) * 100
    };
  }

  function bearing(a, b) {
    var y = Math.sin(((b.lng - a.lng) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
    var x = Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
      Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) *
      Math.cos(((b.lng - a.lng) * Math.PI) / 180);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function stopMotion() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    motionStart = 0;
    if (tileTimer) clearTimeout(tileTimer);
    tileTimer = 0;
    tilesOk = false;
    if (liveMap) {
      liveMap.remove();
      liveMap = null;
    }
    carMarker = null;
    riderMarker = null;
  }

  function modeSwitch(active) {
    return (
      '<div class="modes" role="tablist" aria-label="App mode">' +
      '<button type="button" role="tab" id="mode-customer" aria-selected="' + (active === "customer" ? "true" : "false") + '">Customer</button>' +
      '<button type="button" role="tab" id="mode-driver" aria-selected="' + (active === "driver" ? "true" : "false") + '">Driver</button>' +
      "</div>"
    );
  }

  function field(id, label, value, extra) {
    return (
      "<label for=\"" + id + "\">" + label + "</label>" +
      "<input id=\"" + id + "\" name=\"" + id + "\" value=\"" + esc(value) + "\" autocomplete=\"off\" " + (extra || "") + ">"
    );
  }


  function locateField(id, label, value, resultsId, locateId) {
    return (
      '<div class="locate">' +
      field(id, label, value, 'required placeholder="Search a place" autocomplete="off"') +
      (locateId ? '<button class="btn ghost locate-btn" type="button" id="' + locateId + '">Use current location</button>' : "") +
      '<div class="suggest" id="' + resultsId + '" hidden></div>' +
      "</div>"
    );
  }

  /* ---------- Structured addresses (From / To / stops), same layout as the quote page ---------- */

  var MAX_STOPS = 5;

  function blankStop() {
    return { street: "", line2: "", city: "", state: "TX", zip: "", lat: null, lng: null, pinned: false };
  }

  function stopIndex(prefix) {
    var m = /^stop(\d+)$/.exec(String(prefix || ""));
    return m ? Number(m[1]) : -1;
  }

  /* prefix: "pickup" | "drop" | "stop0".."stop4"; key: Street, Line2, City, State, Zip, Lat, Lng, Pinned */
  function addrGet(prefix, key) {
    var i = stopIndex(prefix);
    if (i >= 0) {
      var s = (state.stopList || [])[i];
      return s ? s[key.toLowerCase()] : undefined;
    }
    return state[prefix + key];
  }

  function addrSet(prefix, key, value) {
    var i = stopIndex(prefix);
    if (i >= 0) {
      if (!state.stopList) state.stopList = [];
      if (!state.stopList[i]) state.stopList[i] = blankStop();
      state.stopList[i][key.toLowerCase()] = value;
      return;
    }
    state[prefix + key] = value;
  }

  function normalizeStops(raw) {
    var list = [];
    if (Array.isArray(raw)) list = raw.slice();
    else if (raw && typeof raw === "object") {
      list = Object.keys(raw).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return raw[k]; });
    }
    return list.filter(function (s) { return s && typeof s === "object"; }).slice(0, MAX_STOPS).map(function (s) {
      return {
        street: String(s.street || ""),
        line2: String(s.line2 || ""),
        city: String(s.city || ""),
        state: String(s.state || "TX"),
        zip: String(s.zip || ""),
        lat: isCoord(s.lat) ? +s.lat : null,
        lng: isCoord(s.lng) ? +s.lng : null,
        pinned: !!s.pinned
      };
    });
  }

  function compactStops() {
    return filledStops().map(function (s) {
      return {
        street: String(s.street || "").trim(),
        line2: String(s.line2 || "").trim(),
        city: String(s.city || "").trim(),
        state: String(s.state || "TX").trim().toUpperCase(),
        zip: String(s.zip || "").trim(),
        lat: isCoord(s.lat) ? +s.lat : null,
        lng: isCoord(s.lng) ? +s.lng : null,
        pinned: !!s.pinned,
        address: stopLine(s)
      };
    });
  }

  function addrBlockHtml(prefix, title, opts) {
    opts = opts || {};
    var val = function (key) { var v = addrGet(prefix, key); return v == null ? "" : String(v); };
    return (
      '<div class="group addr-block" data-prefix="' + prefix + '">' +
      '<div class="addr-head"><p class="group-title">' + esc(title) + "</p>" +
      (opts.remove ? '<button type="button" class="link-btn remove-stop" data-stop-remove="' + opts.index + '">Remove</button>' : "") +
      "</div>" +
      '<div class="locate addr-line1">' +
      '<div class="label-row"><label for="' + prefix + '-street">Address line 1</label>' +
      (opts.locate ? '<button class="locate-mini" type="button" id="use-location">&#128205; Use current location</button>' : "") +
      "</div>" +
      '<input id="' + prefix + '-street" name="' + prefix + '-street" value="' + esc(val("Street")) +
      '" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="140" placeholder="Search a place or street address"' +
      (opts.required ? " required" : "") + ">" +
      '<div class="suggest" id="' + prefix + '-results" hidden></div>' +
      "</div>" +
      field(prefix + "-line2", 'Address line 2 <span class="optional-tag">optional</span>', val("Line2"), 'maxlength="80" placeholder="Apt, suite, gate, terminal"') +
      '<div class="row three"><div class="city">' +
      field(prefix + "-city", "City", val("City"), 'maxlength="80" placeholder="City"' + (opts.required ? " required" : "")) +
      '</div><div class="state">' +
      field(prefix + "-state", "State", val("State") || "TX", 'maxlength="2" placeholder="TX"' + (opts.required ? " required" : "")) +
      '</div><div class="zip">' +
      field(prefix + "-zip", 'ZIP <span class="optional-tag">optional</span>', val("Zip"), 'inputmode="numeric" maxlength="10" placeholder="Auto"') +
      "</div></div>" +
      '<p class="' + (addrGet(prefix, "Approx") === "missing" ? "error" : (addrGet(prefix, "Approx") ? "note" : "fine")) + ' addr-found" id="' + prefix + '-found" role="status">' + esc(foundNoteText(prefix)) + "</p>" +
      "</div>"
    );
  }

  function stopsHtml() {
    var list = state.stopList || [];
    var blocks = list.map(function (s, i) {
      return addrBlockHtml("stop" + i, "Stop " + (i + 1), { remove: true, index: i });
    }).join("");
    return (
      '<div class="stops-block">' + blocks +
      (list.length < MAX_STOPS
        ? '<button type="button" class="link-add-stop" id="add-stop">' + (list.length ? "+ Add another stop" : "+ Add a stop") + "</button>"
        : "") +
      '<p class="fine">Only if you need to stop on the way. Each stop adds ' + money(EXTRA_STOP_CENTS) +
      ". Stops happen in order between From and To.</p></div>"
    );
  }

  function addrPrefixes() {
    var out = ["pickup", "drop"];
    (state.stopList || []).forEach(function (s, i) { out.push("stop" + i); });
    return out;
  }

  function readAddr(prefix) {
    var el = function (part) { return document.getElementById(prefix + "-" + part); };
    if (!el("street")) return;
    addrSet(prefix, "Street", el("street").value.trim());
    if (el("line2")) addrSet(prefix, "Line2", el("line2").value.trim());
    if (el("city")) addrSet(prefix, "City", el("city").value.trim());
    if (el("state")) addrSet(prefix, "State", (el("state").value.trim() || "TX").toUpperCase());
    if (el("zip")) addrSet(prefix, "Zip", el("zip").value.trim());
  }

  function wireAddressInputs() {
    addrPrefixes().forEach(function (prefix) {
      [["line2", "Line2"], ["city", "City"], ["state", "State"], ["zip", "Zip"]].forEach(function (pair) {
        var el = document.getElementById(prefix + "-" + pair[0]);
        if (!el) return;
        el.addEventListener("input", function () {
          addrSet(prefix, pair[1], pair[0] === "state" ? el.value.toUpperCase() : el.value);
          if (pair[0] === "city" || pair[0] === "state") {
            /* City changed after a typed (not picked) address: look it up again. */
            if (!addrGet(prefix, "Pinned") || addrGet(prefix, "Approx")) {
              addrSet(prefix, "Lat", null);
              addrSet(prefix, "Lng", null);
              addrSet(prefix, "Approx", "");
              addrSet(prefix, "Found", "");
            }
          }
        });
        if (pair[0] === "city" || pair[0] === "state" || pair[0] === "zip") {
          el.addEventListener("blur", function () {
            setTimeout(function () { autoResolveField(prefix); }, 150);
          });
        }
      });
    });
  }

  var US_STATES = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
    connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
    louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
    mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY"
  };

  function stateCode(name) {
    if (!name) return "TX";
    var n = String(name).trim();
    var iso = /^US-([A-Za-z]{2})$/.exec(n);
    if (iso) return iso[1].toUpperCase();
    if (n.length === 2) return n.toUpperCase();
    return US_STATES[n.toLowerCase()] || n;
  }

  function placeLine(p) {
    var street = [p.housenumber, p.street].filter(Boolean).join(" ");
    if (p.name && street && p.name.toLowerCase() !== street.toLowerCase()) return p.name + ", " + street;
    return p.name || street || "";
  }

  function setCoords(prefix, feature) {
    var coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords) return;
    addrSet(prefix, "Lng", coords[0]);
    addrSet(prefix, "Lat", coords[1]);
  }

  function resetDrivingRoute() {
    driving.key = "";
    driving.done = false;
    driving.miles = null;
    driving.line = null;
  }

  /* place: { line1, city, state, zip, lat, lng, fromHere } */
  function applyPlace(prefix, place) {
    if (!place) return;
    function put(key, part, value) {
      var el = document.getElementById(prefix + "-" + part);
      if (el) el.value = value;
      addrSet(prefix, key, value);
    }
    put("Street", "street", place.line1 || "");
    put("City", "city", place.city || "");
    put("State", "state", place.state || "TX");
    put("Zip", "zip", place.zip || "");
    var hasPoint = isCoord(place.lat) && isCoord(place.lng);
    addrSet(prefix, "Lat", hasPoint ? +place.lat : null);
    addrSet(prefix, "Lng", hasPoint ? +place.lng : null);
    addrSet(prefix, "Pinned", hasPoint);
    if (prefix === "pickup") state.pickupFromHere = !!place.fromHere;
    resetDrivingRoute();
    if (prefix === "drop") {
      state.dropFix = pointFrom(state.dropLat, state.dropLng);
      state.useDrivenMiles = false;
      state.endedEarly = false;
      if (ROLE === "driver" && state.rideStatus === "started") {
        syncActiveTripFare();
        render();
      }
    }
  }

  function normText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function hasWord(text, word) {
    if (!word) return false;
    return (" " + normText(text) + " ").indexOf(" " + word + " ") !== -1;
  }

  /* Word starts with the typed piece ("krog" matches "Kroger"). */
  function wordStarts(text, piece) {
    if (!piece) return false;
    return (" " + normText(text)).indexOf(" " + piece) !== -1;
  }

  function focusTokens(text, city) {
    var skip = {
      on: 1, the: 1, a: 1, an: 1, at: 1, in: 1, of: 1, and: 1, near: 1, to: 1,
      tx: 1, texas: 1, rd: 1, road: 1, st: 1, street: 1, dr: 1, drive: 1,
      ln: 1, lane: 1, ave: 1, avenue: 1, blvd: 1, boulevard: 1, ct: 1, court: 1,
      cir: 1, circle: 1, pkwy: 1, parkway: 1, hwy: 1, highway: 1, fwy: 1,
      freeway: 1, way: 1, trl: 1, trail: 1, loop: 1
    };
    normText(city).split(" ").forEach(function (w) { if (w) skip[w] = 1; });
    return normText(text).split(" ").filter(function (w) {
      return w.length > 2 && !skip[w];
    });
  }

  function looksLikeAddress(text) {
    return /^\s*\d+\s+/.test(String(text || ""));
  }

  function sameCity(props, city) {
    var want = normText(city);
    var got = normText(props.city || props.town || props.village || "");
    return !!want && !!got && got === want;
  }

  function featurePoint(feature) {
    var coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords || !isCoord(coords[0]) || !isCoord(coords[1])) return null;
    return { lat: +coords[1], lng: +coords[0] };
  }

  function placeLooksWeak(saved, feature, text, city) {
    var next = featurePoint(feature);
    if (!saved || !next) return false;
    if (haversine(saved, next) < 0.35) return false;
    var props = feature.properties || {};
    var tokens = focusTokens(text, city);
    var name = props.name || "";
    var osmValue = String(props.osm_value || "").toLowerCase();
    var q = normText(text);
    if (q.indexOf("walmart") !== -1) {
      return (osmValue === "supermarket" || hasWord(name, "walmart")) && (!city || sameCity(props, city));
    }
    if (city && normText(props.city || props.town || props.village || "") && !sameCity(props, city)) return false;
    return tokens.some(function (word) { return hasWord(name, word) || hasWord(props.street, word); });
  }

  /* ---------- Place search: nearest first, from the rider's location ---------- */

  /* Lake Conroe / Conroe service area. Used only when we have no location and no From pin yet. */
  var DEFAULT_SEARCH_CENTER = { lat: 30.33, lng: -95.52 };
  var SEARCH_RADIUS_MI = 40;

  /* Local ZIP -> city, only used when map data has no city (unincorporated areas). */
  var ZIP_CITY = {
    "77301": "Conroe", "77302": "Conroe", "77303": "Conroe", "77304": "Conroe", "77306": "Conroe",
    "77384": "Conroe", "77385": "Conroe",
    "77316": "Montgomery", "77356": "Montgomery",
    "77380": "The Woodlands", "77381": "The Woodlands", "77382": "The Woodlands",
    "77354": "Magnolia", "77355": "Magnolia",
    "77375": "Tomball", "77377": "Tomball",
    "77357": "New Caney", "77365": "Porter", "77372": "Splendora",
    "77373": "Spring", "77379": "Spring", "77386": "Spring", "77388": "Spring", "77389": "Spring",
    "77338": "Humble", "77346": "Humble",
    "77868": "Navasota", "77320": "Huntsville", "77340": "Huntsville"
  };

  var POI_KINDS = {
    supermarket: "Grocery store", convenience: "Convenience store", fuel: "Gas station",
    restaurant: "Restaurant", fast_food: "Fast food", cafe: "Cafe", bar: "Bar", pub: "Bar",
    pharmacy: "Pharmacy", hospital: "Hospital", clinic: "Clinic", doctors: "Doctor", dentist: "Dentist",
    aerodrome: "Airport", terminal: "Airport terminal", hotel: "Hotel", motel: "Motel",
    school: "School", college: "College", university: "University", place_of_worship: "Church",
    bank: "Bank", department_store: "Department store", mall: "Mall", car_repair: "Auto repair",
    parking: "Parking", bus_station: "Bus station", station: "Station", cinema: "Movie theater",
    post_office: "Post office", library: "Library", townhall: "City hall", courthouse: "Courthouse",
    hardware: "Hardware store", doityourself: "Hardware store", variety_store: "Store", general: "Store"
  };

  function cityFromProps(p) {
    p = p || {};
    var poi = normText(p.name);
    var picks = [p.city, p.town, p.village, p.hamlet];
    var i;
    for (i = 0; i < picks.length; i += 1) {
      var c = String(picks[i] || "").trim();
      if (c && normText(c) !== poi) return c;
    }
    var zip = String(p.postcode || "").slice(0, 5);
    if (ZIP_CITY[zip]) return ZIP_CITY[zip];
    var county = String(p.county || "").trim();
    if (county) return /county$/i.test(county) ? county : county + " County";
    var district = String(p.district || "").trim();
    if (district && normText(district) !== poi) return district;
    return "";
  }

  function photonIsPoi(p) {
    if (!p || !p.name) return false;
    var key = String(p.osm_key || "");
    return ["highway", "place", "boundary", "landuse", "natural", "waterway"].indexOf(key) === -1;
  }

  function photonPlace(feature) {
    var p = (feature && feature.properties) || {};
    var c = (feature && feature.geometry && feature.geometry.coordinates) || [];
    var street = [p.housenumber, p.street].filter(Boolean).join(" ");
    var poi = photonIsPoi(p);
    var line1;
    if (poi) line1 = street && normText(p.name) !== normText(street) ? p.name + ", " + street : p.name;
    else line1 = street || p.name || "";
    return {
      line1: line1,
      city: cityFromProps(p),
      state: stateCode(p.state),
      zip: String(p.postcode || "").slice(0, 10),
      lat: isCoord(c[1]) ? +c[1] : null,
      lng: isCoord(c[0]) ? +c[0] : null,
      category: poi ? (POI_KINDS[String(p.osm_value || "")] || "") : ""
    };
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function photonFetch(params) {
    return withTimeout(fetch("https://photon.komoot.io/api/?" + params).then(function (res) {
      if (!res.ok) throw new Error("photon");
      return res.json();
    }), 8000).then(function (data) {
      return (data && data.features) || [];
    }).catch(function () { return []; });
  }

  function hereFresh() {
    var h = state.hereFix;
    if (!h || !isCoord(h.lat) || !isCoord(h.lng)) return null;
    if (Date.now() - Number(h.at || 0) > 30 * 60 * 1000) return null;
    return { lat: +h.lat, lng: +h.lng };
  }

  /* Where "nearest" is measured from: your location -> From pin -> service area. */
  function searchOrigin(prefix) {
    var here = hereFresh();
    if (here) return { point: here, from: "you" };
    if (ROLE === "driver" && isCoord(state.hereLat) && isCoord(state.hereLng)) {
      return { point: { lat: +state.hereLat, lng: +state.hereLng }, from: "you" };
    }
    var pick = placeCoords("pickup");
    if (pick && prefix !== "pickup") return { point: pick, from: "pickup" };
    return { point: DEFAULT_SEARCH_CENTER, from: "" };
  }

  var originPriming = false;

  /* If location is already allowed, grab it quietly so "nearest" means nearest to you. Never prompts. */
  function primeSearchOrigin() {
    if (ROLE !== "customer" || hereFresh() || originPriming) return;
    if (!navigator.geolocation || !navigator.permissions || !navigator.permissions.query) return;
    originPriming = true;
    navigator.permissions.query({ name: "geolocation" }).then(function (status) {
      if (!status || status.state !== "granted") { originPriming = false; return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        originPriming = false;
        state.hereFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
      }, function () { originPriming = false; }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
    }).catch(function () { originPriming = false; });
  }

  function searchWords(q) {
    var skip = { tx: 1, texas: 1, usa: 1, us: 1, the: 1, of: 1, and: 1, at: 1, near: 1 };
    return normText(q).split(" ").filter(function (w) { return w.length >= 2 && !skip[w]; });
  }

  /* 0 = name/address matches what was typed, 1 = partial match, 2 = loose match. */
  function placeTier(p, q) {
    var words = searchWords(q);
    var num = looksLikeAddress(q) ? (normText(q).split(" ")[0] || "") : "";
    var text = words.filter(function (w) { return !/^\d+$/.test(w); });
    var name = p.name || "";
    var street = p.street || "";
    if (num) {
      var streetHit = !text.length || text.some(function (w) { return wordStarts(street, w) || wordStarts(name, w); });
      if (normText(p.housenumber) === num && streetHit) return 0;
      return streetHit ? 1 : 2;
    }
    if (!text.length) return 1;
    if (text.every(function (w) { return wordStarts(name, w); })) return 0;
    if (text.some(function (w) { return wordStarts(name, w) || wordStarts(street, w); })) return 1;
    return 2;
  }

  /*
    Rank Photon results: best text match first, then (when geocoding a typed address) same city/ZIP,
    then real distance from the origin. Fuel pumps next to the same store are folded into the store.
  */
  function rankPlaces(features, q, origin, want) {
    var seen = {};
    var wantGas = /\b(gas|fuel|station|pump)\b/.test(normText(q));
    var items = [];
    (features || []).forEach(function (f) {
      var p = (f && f.properties) || {};
      if (p.countrycode && String(p.countrycode).toUpperCase() !== "US") return;
      var place = photonPlace(f);
      if (!isCoord(place.lat) || !isCoord(place.lng) || !place.line1) return;
      var idA = String(p.osm_type || "") + String(p.osm_id || "");
      var idB = normText(place.line1) + "|" + place.zip;
      if ((idA && seen[idA]) || seen[idB]) return;
      if (idA) seen[idA] = 1;
      seen[idB] = 1;
      var cityKey = 0;
      if (want && (want.city || want.zip)) {
        var cityOk = want.city && normText(cityFromProps(p)) === normText(want.city);
        var zipOk = want.zip && String(p.postcode || "").slice(0, 5) === String(want.zip).slice(0, 5);
        cityKey = cityOk || zipOk ? 0 : 1;
      }
      items.push({
        feature: f,
        place: place,
        tier: placeTier(p, q),
        cityKey: cityKey,
        fuel: String(p.osm_value || "") === "fuel",
        nameKey: normText(p.name),
        dist: haversine(origin, { lat: place.lat, lng: place.lng })
      });
    });
    /* Nobody books a Lake Conroe car to another state: drop matches more than 300 miles away. */
    items = items.filter(function (it) { return !(it.dist > 300); });
    if (!wantGas) {
      items = items.filter(function (it) {
        if (!it.fuel || !it.nameKey) return true;
        return !items.some(function (other) {
          return other !== it && !other.fuel && other.nameKey === it.nameKey &&
            haversine({ lat: other.place.lat, lng: other.place.lng }, { lat: it.place.lat, lng: it.place.lng }) < 0.5;
        });
      });
    }
    items.sort(function (a, b) {
      return (a.tier - b.tier) || (a.cityKey - b.cityKey) || (a.dist - b.dist);
    });
    return items;
  }

  function findPlaces(q, origin, want) {
    var o = (origin && origin.point) || DEFAULT_SEARCH_CENTER;
    var lat = o.lat.toFixed(5);
    var lon = o.lng.toFixed(5);
    var dLat = SEARCH_RADIUS_MI / 69;
    var dLon = SEARCH_RADIUS_MI / (69 * Math.cos((o.lat * Math.PI) / 180));
    var bbox = [o.lng - dLon, o.lat - dLat, o.lng + dLon, o.lat + dLat].map(function (n) { return n.toFixed(4); }).join(",");
    /* location_bias_scale low = distance matters more than how "famous" a place is. */
    var common = "lang=en&lat=" + lat + "&lon=" + lon + "&location_bias_scale=0.1&zoom=12&q=" + encodeURIComponent(q);
    var calls = [
      photonFetch("limit=15&bbox=" + bbox + "&" + common), /* nearby (about 40 mi around you) */
      photonFetch("limit=8&" + common) /* farther places (airports, other cities) still show */
    ];
    var streetOnly = looksLikeAddress(q) ? String(q).replace(/^\s*\d+[A-Za-z]?\s+/, "") : "";
    if (streetOnly.length >= 3) {
      /* Map data often has the street but not each house number: also look up the street by itself. */
      calls.push(photonFetch("limit=8&bbox=" + bbox + "&" + common.replace(/&q=.*$/, "&q=" + encodeURIComponent(streetOnly))).catch(function () { return []; }));
    }
    return Promise.all(calls).then(function (lists) {
      return rankPlaces([].concat.apply([], lists), q, o, want);
    });
  }

  function fmtMiles(d) {
    if (!isFinite(d)) return "";
    return (d < 10 ? d.toFixed(1) : String(Math.round(d))) + " mi";
  }

  function suggestNoteHtml(origin) {
    if (origin && origin.from === "you") return '<p class="suggest-note">Closest to you first</p>';
    if (origin && origin.from === "pickup") return '<p class="suggest-note">Closest to your pickup first</p>';
    return '<p class="suggest-note">Tip: tap Use current location for the closest places</p>';
  }

  function suggestItemHtml(item, i) {
    var pl = item.place;
    var sub = [pl.city, [pl.state, pl.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (pl.category) sub = sub ? sub + " · " + pl.category : pl.category;
    return (
      '<button type="button" class="suggest-item" data-i="' + i + '">' +
      '<span class="suggest-main"><strong>' + esc(pl.line1) + "</strong>" +
      '<em class="suggest-dist">' + esc(fmtMiles(item.dist)) + "</em></span>" +
      "<span>" + esc(sub) + "</span></button>"
    );
  }

  /*
    v53: dropdown suggestions (From, To, stops; rider and driver). Before v53 the list was ranked by
    "name matches what you typed" first and distance second, so a far "QuickTrip" (exact spelling) beat a
    near "QuikTrip" (real brand spelling). Now: search about 60 mi around you first, merge with a wider
    search, drop duplicates, then sort ONLY by distance. Matches over 100 mi stay behind "Show farther results".
  */
  var HOUSTON_CENTER = { lat: 29.7604, lng: -95.3698 };
  var SUGGEST_LOCAL_MI = 60;
  var SUGGEST_HIDE_MI = 100;
  var SUGGEST_MIN_LOCAL = 3;
  var SUGGEST_SHOW = 6;
  var SUGGEST_MAX = 15;
  var SUGGEST_DUP_MI = 0.031; /* about 50 m */

  /* Distance is measured from: your location -> From/pickup point -> Houston (last resort, sorting only). */
  function suggestOrigin(prefix) {
    var origin = searchOrigin(prefix);
    if (origin && origin.from) return origin;
    return { point: HOUSTON_CENTER, from: "houston" };
  }

  function bboxAround(o, miles) {
    var dLat = miles / 69;
    var dLon = miles / (69 * Math.cos((o.lat * Math.PI) / 180));
    return [o.lng - dLon, o.lat - dLat, o.lng + dLon, o.lat + dLat].map(function (n) { return n.toFixed(4); }).join(",");
  }

  function suggestProps(it) { return (it && it.feature && it.feature.properties) || {}; }

  function suggestAddrKey(it) {
    var p = suggestProps(it);
    if (!p.housenumber || !p.street) return "";
    return normText(p.housenumber + " " + p.street);
  }

  function suggestPt(it) { return { lat: it.place.lat, lng: it.place.lng }; }

  /* Same place listed twice (store + its fuel pumps, or a bare "1224 Wilson Road" under the store at 1224 Wilson Road). */
  function dedupeSuggestions(items) {
    var ordered = items.map(function (it, i) {
      var p = suggestProps(it);
      var poi = photonIsPoi(p);
      var pref = (poi ? 0 : 4) + (suggestAddrKey(it) ? 0 : 2) + (String(p.osm_key || "") === "highway" || it.fuel ? 1 : 0);
      return { it: it, i: i, poi: poi, pref: pref, addr: suggestAddrKey(it), line: normText(it.place.line1) + "|" + normText(it.place.city) };
    }).sort(function (a, b) { return (a.pref - b.pref) || (a.it.dist - b.it.dist) || (a.i - b.i); });
    var kept = [];
    ordered.forEach(function (c) {
      var dup = kept.some(function (k) {
        if (c.line === k.line) return true;
        var d = haversine(suggestPt(c.it), suggestPt(k.it));
        if (c.poi && k.poi) {
          var sameName = c.it.nameKey && c.it.nameKey === k.it.nameKey;
          return !!sameName && (d < 0.15 || (!!c.addr && c.addr === k.addr));
        }
        if (!c.poi && c.addr && c.addr === k.addr && d < 0.25) return true;
        return !c.poi && k.poi && !!c.addr && d < SUGGEST_DUP_MI && (!k.addr || k.addr === c.addr);
      });
      if (!dup) kept.push(c);
    });
    return kept.sort(function (a, b) { return (a.it.dist - b.it.dist) || (a.i - b.i); }).map(function (c) { return c.it; });
  }

  /* items must already be sorted nearest first. */
  function splitSuggestions(items) {
    var local = items.filter(function (it) { return it.dist <= SUGGEST_LOCAL_MI; });
    var shown = local.length >= SUGGEST_MIN_LOCAL ? local : items.filter(function (it) { return it.dist <= SUGGEST_HIDE_MI; });
    if (!shown.length) shown = items.slice(); /* nothing closer exists: show what we have */
    var more = items.filter(function (it) { return shown.indexOf(it) === -1; });
    more = shown.slice(SUGGEST_SHOW).concat(more).sort(function (a, b) { return a.dist - b.dist; });
    return { shown: shown.slice(0, SUGGEST_SHOW), more: more.slice(0, SUGGEST_MAX - Math.min(shown.length, SUGGEST_SHOW)) };
  }

  function suggestPlaces(q, origin) {
    var o = (origin && origin.point) || HOUSTON_CENTER;
    var bbox = bboxAround(o, SUGGEST_LOCAL_MI);
    /* location_bias_scale low = distance matters more than how "famous" a place is. */
    var common = "lang=en&lat=" + o.lat.toFixed(5) + "&lon=" + o.lng.toFixed(5) + "&location_bias_scale=0.1&zoom=12&q=";
    var calls = [
      photonFetch("limit=30&bbox=" + bbox + "&" + common + encodeURIComponent(q)), /* local: about 60 mi around you */
      photonFetch("limit=10&" + common + encodeURIComponent(q)) /* wider: used only if few local, or behind "Show farther results" */
    ];
    var streetOnly = looksLikeAddress(q) ? String(q).replace(/^\s*\d+[A-Za-z]?\s+/, "") : "";
    if (streetOnly.length >= 3) {
      /* Map data often has the street but not each house number: also look up the street by itself. */
      calls.push(photonFetch("limit=8&bbox=" + bbox + "&" + common + encodeURIComponent(streetOnly)));
    }
    return Promise.all(calls).then(function (lists) {
      var merged = rankPlaces([].concat.apply([], lists), q, o);
      merged = dedupeSuggestions(merged); /* final sort: nearest first, whatever source or query it came from */
      return splitSuggestions(merged);
    });
  }

  function suggestHeadHtml(origin) {
    if (origin && origin.from === "houston") return '<p class="suggest-note">Closest to Houston first. Tap Use current location for places near you.</p>';
    return suggestNoteHtml(origin);
  }

  function renderSuggestions(box, origin, shown, more, expanded) {
    var list = expanded ? shown.concat(more) : shown;
    box._places = list;
    box._shown = shown;
    box._more = more;
    box._origin = origin;
    var moreBtn = !expanded && more.length
      ? '<button type="button" class="suggest-more" style="display:block;width:100%;text-align:center;background:transparent;border:0;padding:10px 12px;color:var(--gold-2,#e3c77d);font-weight:700;font-size:14px;cursor:pointer">Show farther results (' + more.length + ")</button>"
      : "";
    box.innerHTML = list.length
      ? suggestHeadHtml(origin) + list.map(suggestItemHtml).join("") + moreBtn
      : '<p class="suggest-note">No matches yet. Keep typing, or fill in line 1, city and ZIP yourself.</p>';
    box.hidden = false;
  }

  function wireSearch(prefix) {
    var input = document.getElementById(prefix + "-street");
    var box = document.getElementById(prefix + "-results");
    if (!input || !box) return;
    var timer = 0;
    var seq = 0;
    input.addEventListener("focus", primeSearchOrigin);
    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (box._keepUntil && box._keepUntil > Date.now()) return; /* tapped "Show farther results" */
        closeBox();
      }, 450);
    });
    function closeBox() {
      box.hidden = true;
      /* No suggestion picked: find what was typed (street + city, ZIP optional). */
      if (!isCoord(addrGet(prefix, "Lat")) && String(addrGet(prefix, "City") || "").trim()) autoResolveField(prefix);
    }
    /* List left open after "Show farther results": close it on a tap anywhere else. */
    function outsideTap(event) {
      if (!document.body.contains(box)) { document.removeEventListener("pointerdown", outsideTap, true); return; }
      if (box.hidden || box.contains(event.target) || event.target === input || document.activeElement === input) return;
      closeBox();
    }
    document.addEventListener("pointerdown", outsideTap, true);
    input.addEventListener("input", function () {
      var q = input.value.trim();
      addrSet(prefix, "Street", input.value);
      addrSet(prefix, "Lat", null);
      addrSet(prefix, "Lng", null);
      addrSet(prefix, "Pinned", false);
      addrSet(prefix, "Approx", "");
      addrSet(prefix, "Found", "");
      autoResolveSeq[prefix] = "";
      var foundEl = document.getElementById(prefix + "-found");
      if (foundEl) foundEl.textContent = "";
      if (prefix === "drop") state.dropFix = null;
      if (prefix === "pickup") state.pickupFromHere = false;
      clearTimeout(timer);
      if (q.length < 3) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      var mine = ++seq;
      timer = setTimeout(function () {
        var origin = suggestOrigin(prefix);
        suggestPlaces(q, origin).then(function (res) {
          if (mine !== seq || input.value.trim() !== q) return;
          var num = (q.match(/^(\d+[A-Za-z]?)\s+/) || [])[1];
          function keepNum(it) {
            var pl = it.place;
            if (!num || pl.category || /^\d/.test(String(pl.line1 || ""))) return it;
            /* Typed "1099 McCaleb" but the map only knows the street: keep the house number. */
            return Object.assign({}, it, { place: Object.assign({}, pl, { line1: num + " " + pl.line1, approx: true }) });
          }
          renderSuggestions(box, origin, res.shown.map(keepNum), res.more.map(keepNum), false);
        }).catch(function () { box.hidden = true; });
      }, 300);
    });
    box.addEventListener("mousedown", function (event) {
      /* Keep the keyboard/focus on line 1 when tapping "Show farther results". */
      if (event.target.closest && event.target.closest(".suggest-more")) event.preventDefault();
    });
    box.addEventListener("click", function (event) {
      var moreBtn = event.target.closest ? event.target.closest(".suggest-more") : null;
      if (moreBtn) {
        box._keepUntil = Date.now() + 1500;
        renderSuggestions(box, box._origin, box._shown || [], box._more || [], true);
        return;
      }
      var btn = event.target.closest ? event.target.closest(".suggest-item") : null;
      if (!btn || !box._places) return;
      var item = box._places[Number(btn.getAttribute("data-i"))];
      if (!item) return;
      var place = item.place;
      /* House number on a street-only match: the request step finds that exact house
         (instead of pinning the middle of a long road). */
      applyPlace(prefix, place);
      if (place.approx && isCoord(place.lat)) {
        addrSet(prefix, "Pinned", false);
        addrSet(prefix, "Approx", "street");
        addrSet(prefix, "Found", [place.line1, place.city, place.state, String(place.zip || "").slice(0, 5)].filter(Boolean).join(", "));
      } else {
        addrSet(prefix, "Approx", "");
        addrSet(prefix, "Found", [place.line1, place.city, place.state, String(place.zip || "").slice(0, 5)].filter(Boolean).join(", "));
      }
      var fEl = document.getElementById(prefix + "-found");
      if (fEl) { fEl.textContent = foundNoteText(prefix); fEl.className = (place.approx ? "note" : "fine") + " addr-found"; }
      autoResolveSeq[prefix] = "";
      box.hidden = true;
      if (place.approx) autoResolveField(prefix); /* try for the exact house in the background */
    });
  }

  /* ---------- Current location -> line 1 / city / state / ZIP ---------- */

  function nominatimPlace(data) {
    var a = data && data.address;
    if (!a || !a.road) return null;
    var zip = String(a.postcode || "").slice(0, 10);
    var city = a.city || a.town || a.village || a.hamlet || ZIP_CITY[zip.slice(0, 5)] || a.county || "";
    return {
      line1: [a.house_number, a.road].filter(Boolean).join(" "),
      city: String(city),
      state: stateCode(a["ISO3166-2-lvl4"] || a.state),
      zip: zip
    };
  }

  function photonReversePlace(features) {
    var list = (features || []).filter(function (f) { return f && f.properties; });
    if (!list.length) return null;
    function rank(f) {
      var p = f.properties;
      if (p.housenumber && p.street) return 0;
      if (p.osm_key === "highway" || p.type === "street") return 1;
      if (p.street) return 2;
      return 3;
    }
    list.sort(function (a, b) { return rank(a) - rank(b); });
    var p = list[0].properties;
    var street = [p.housenumber, p.street].filter(Boolean).join(" ");
    var line1 = street || (p.osm_key === "highway" || p.type === "street" ? p.name : "") || p.name || "";
    if (!line1) return null;
    return { line1: line1, city: cityFromProps(p), state: stateCode(p.state), zip: String(p.postcode || "").slice(0, 10) };
  }

  /* Never rejects. Nominatim first (it often has the house number), Photon reverse as backup. */
  function reverseGeocode(lat, lng) {
    var q = "lat=" + encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lng);
    return withTimeout(fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&" + q).then(function (res) {
      if (!res.ok) throw new Error("nominatim");
      return res.json();
    }), 6000).then(function (data) {
      var place = nominatimPlace(data);
      if (!place) throw new Error("nominatim-empty");
      return place;
    }).catch(function () {
      return withTimeout(fetch("https://photon.komoot.io/reverse?limit=5&lang=en&" + q).then(function (res) {
        if (!res.ok) throw new Error("photon");
        return res.json();
      }), 6000).then(function (data) {
        return photonReversePlace(data && data.features);
      }).catch(function () { return null; });
    }).then(function (place) {
      return place || {
        line1: "Current location (" + Number(lat).toFixed(5) + ", " + Number(lng).toFixed(5) + ")",
        city: "",
        state: "TX",
        zip: ""
      };
    });
  }

  function wireLocation() {
    var locBtn = document.getElementById("use-location");
    if (!locBtn) return;
    locBtn.addEventListener("click", function () {
      if (!navigator.geolocation) {
        locBtn.textContent = "Location not available";
        return;
      }
      locBtn.disabled = true;
      locBtn.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        state.hereFix = { lat: lat, lng: lng, at: Date.now() };
        reverseGeocode(lat, lng).then(function (place) {
          place.lat = lat;
          place.lng = lng;
          place.fromHere = true;
          applyPlace("pickup", place);
          locBtn.disabled = false;
          locBtn.innerHTML = "&#128205; Use current location";
          var cityEl = document.getElementById("pickup-city");
          if (cityEl && !cityEl.value.trim()) cityEl.focus();
        });
      }, function () {
        locBtn.disabled = false;
        locBtn.textContent = "Location blocked — type the address";
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }


  function databaseURL() {
    var cfg = window.PCS_SYNC || {};
    var url = cfg.databaseURL ? String(cfg.databaseURL).trim() : "";
    return url.replace(/\/+$/, "");
  }

  function syncOn() {
    return !!databaseURL();
  }

  function makeRideCode() {
    var out = "";
    var i;
    var buf;
    if (window.crypto && window.crypto.getRandomValues) {
      buf = new Uint8Array(8);
      window.crypto.getRandomValues(buf);
      for (i = 0; i < 8; i += 1) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
      return out;
    }
    for (i = 0; i < 8; i += 1) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  function makeRidePin() {
    var n;
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint16Array(1);
      window.crypto.getRandomValues(buf);
      n = buf[0] % 10000;
    } else {
      n = Math.floor(Math.random() * 10000);
    }
    return String(n).padStart(4, "0");
  }

  function normalizeStoredPin(value) {
    var digits = String(value == null ? "" : value).replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length > 4) digits = digits.slice(-4);
    return digits.padStart(4, "0");
  }

  function ensureRidePin() {
    var pin = normalizeStoredPin(state.pin);
    if (pin) {
      state.pin = pin;
      return pin;
    }
    var local = currentRide();
    pin = normalizeStoredPin(local && local.pin) || (ROLE === "customer" ? recalledPin(state.code) : "");
    if (!pin) {
      pin = (state.isTest || isTestRide(local)) ? TEST_PIN : makeRidePin();
    }
    state.pin = pin;
    if (state.rideStatus === "requested" || state.rideStatus === "pending_owner" || state.rideStatus === "accepted" || state.rideStatus === "started") {
      saveRide(state.rideStatus || "pending_owner");
      if (syncOn() && state.code && !(state.isTest || isTestRide(local))) {
        pinHashFor(pin, state.code).then(function (h) {
          state.pinHash = h;
          putRideSecrets(state.code, { pinHash: h }).catch(function () {});
        }).catch(function () {});
      }
    }
    return pin;
  }

  function normalizeCode(raw) {
    return String(raw || "").toUpperCase().replace(/\s+/g, "");
  }

  function normalizePin(raw) {
    return String(raw || "").replace(/\D/g, "").slice(0, 4);
  }

  function pinHashFor(pin, code) {
    var normalized = normalizeStoredPin(pin);
    var c = normalizeCode(code || state.code || "");
    return sha256Hex(normalized + "|" + c);
  }

  function pinAcceptedAsync(entered) {
    var e = normalizeStoredPin(entered);
    if (!e || e.length !== 4) return Promise.resolve(false);
    var ride = currentRide() || {};
    var testRide = isTestRide(ride) || !!state.isTest;
    /* TEST PIN 0001 works ONLY on rides flagged isTest. Never on real rides. */
    if (testRide && e === TEST_PIN) return Promise.resolve(true);
    if (!testRide && e === TEST_PIN) {
      /* explicitly reject universal test pin on real rides */
    }
    var local = normalizeStoredPin(state.pin);
    if (local && e === local) return Promise.resolve(true);
    var code = state.code || state.driverCode || readDriverCode();
    function checkHash(hash) {
      if (!hash) return Promise.resolve(false);
      return pinHashFor(e, code).then(function (got) {
        return got === String(hash).toLowerCase();
      }).catch(function () { return false; });
    }
    var mem = state.pinHash || ride.pinHash || "";
    if (mem) return checkHash(mem);
    if (!syncOn() || !code) return Promise.resolve(false);
    return getRideSecrets(code).then(function (secrets) {
      var h = secrets && secrets.pinHash ? secrets.pinHash : "";
      if (h) state.pinHash = h;
      return checkHash(h);
    });
  }

  function rideUrl(code) {
    return databaseURL() + "/rides/" + encodeURIComponent(code) + ".json";
  }

  function rideSecretsUrl(code) {
    return databaseURL() + "/rides/" + encodeURIComponent(code) + "/secrets.json";
  }

  function putRideSecrets(code, secrets) {
    if (!syncOn() || !code) return Promise.resolve();
    return authFetch(rideSecretsUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(secrets || {})
    }).then(function (res) {
      if (!res.ok) throw new Error("secrets");
      return res.text().then(function () {});
    });
  }

  function getRideSecrets(code) {
    if (!syncOn() || !code) return Promise.resolve(null);
    return authFetch(rideSecretsUrl(code)).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("secrets");
      return res.text().then(function (text) {
        if (!text || text === "null") return null;
        try { return JSON.parse(text); } catch (e) { return null; }
      });
    }).catch(function () { return null; });
  }

  function coordNum(v) {
    return isCoord(v) ? +v : null;
  }

  function asRide(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data;
  }

  function getRide(code) {
    return authFetch(rideUrl(code)).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("ride");
      return res.text().then(function (text) {
        if (!text) return null;
        try { return asRide(JSON.parse(text)); } catch (err) { return null; }
      });
    });
  }

  function getRideWithEtag(code) {
    return authFetch(rideUrl(code), {
      headers: { "X-Firebase-ETag": "true" }
    }).then(function (res) {
      if (res.status === 404) return { ride: null, etag: "" };
      if (!res.ok) throw new Error("ride");
      var etag = res.headers.get("ETag") || res.headers.get("etag") || "";
      return res.text().then(function (text) {
        var ride = null;
        if (text && text !== "null") {
          try { ride = asRide(JSON.parse(text)); } catch (err) { ride = null; }
        }
        return { ride: ride, etag: etag };
      });
    });
  }

  function putRide(code, ride) {
    var payload = ride && typeof ride === "object" ? Object.assign({}, ride) : ride;
    var secretHash = "";
    if (payload && typeof payload === "object") {
      delete payload.pin; /* never store plaintext PIN remotely */
      if (payload.pinHash) {
        secretHash = payload.pinHash;
        delete payload.pinHash; /* pinHash lives only under /secrets */
      }
      if (payload.secrets) delete payload.secrets;
    }
    return authFetch(rideUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error("ride");
      return res.text().then(function () {});
    }).then(function () {
      if (!secretHash) return;
      return putRideSecrets(code, { pinHash: secretHash });
    });
  }

  function patchRide(code, partial) {
    var body = partial && typeof partial === "object" ? Object.assign({}, partial) : partial;
    var secretHash = "";
    if (body && typeof body === "object") {
      if (Object.prototype.hasOwnProperty.call(body, "pin")) body.pin = null;
      if (body.pinHash) {
        secretHash = body.pinHash;
        delete body.pinHash;
      }
      if (body.secrets) delete body.secrets;
    }
    return authFetch(rideUrl(code), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("ride");
      return res.text().then(function () {});
    }).then(function () {
      if (!secretHash) return;
      return putRideSecrets(code, { pinHash: secretHash });
    });
  }

  /*
    v48: Firebase REST does NOT allow "if-match" on PATCH (always 400 "not supported").
    That made every live driver Accept fail. Conditional writes must be PUT: when we have the
    ETag and the full ride we just read (including /secrets, so the PIN is kept), PUT the merged
    ride with if-match (412 = someone else changed it first). Otherwise fall back to a plain PATCH.
  */
  function rideWriteError(res, tag) {
    var err = new Error(tag || "ride");
    err.status = res ? res.status : 0;
    if (res && (res.status === 401 || res.status === 403)) err.denied = true;
    return err;
  }

  function patchRideIfMatch(code, partial, etag, baseRide) {
    var canPut = !!(etag && baseRide && typeof baseRide === "object" && baseRide.secrets && typeof baseRide.secrets === "object");
    if (!canPut) {
      return authFetch(rideUrl(code), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial)
      }).then(function (res) {
        if (!res.ok) throw rideWriteError(res, "ride");
        return res.text().then(function () {});
      });
    }
    var merged = Object.assign({}, baseRide, partial);
    delete merged.pin;
    delete merged.pinHash;
    return authFetch(rideUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "if-match": etag },
      body: JSON.stringify(merged)
    }).then(function (res) {
      if (res.status === 412) {
        var err = new Error("precondition");
        err.conflict = true;
        throw err;
      }
      if (res.status === 400) {
        /* Safety net: conditional write not accepted here -> plain PATCH (status was just checked). */
        return authFetch(rideUrl(code), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial)
        }).then(function (res2) {
          if (!res2.ok) throw rideWriteError(res2, "ride");
          return res2.text().then(function () {});
        });
      }
      if (!res.ok) throw rideWriteError(res, "ride");
      return res.text().then(function () {});
    });
  }

  function openIndexUrl(code) {
    if (code) {
      return databaseURL() + "/rides/" + encodeURIComponent(OPEN_HUB) + "/" + encodeURIComponent(code) + ".json";
    }
    return databaseURL() + "/rides/" + encodeURIComponent(OPEN_HUB) + ".json";
  }

  function driversUrl(id) {
    if (id) {
      return databaseURL() + "/rides/" + encodeURIComponent(PRESENCE_HUB) + "/drivers/" + encodeURIComponent(id) + ".json";
    }
    return databaseURL() + "/rides/" + encodeURIComponent(PRESENCE_HUB) + "/drivers.json";
  }

  function driverPresenceId() {
    var session = readSession() || "driver";
    var id = String(session).toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "");
    return (id || "driver").slice(0, 48);
  }

  function rosterUrl(id) {
    var base = databaseURL() + "/rides/" + encodeURIComponent(ROSTER_HUB);
    if (id) return base + "/" + encodeURIComponent(id) + ".json";
    return base + ".json";
  }

  function historyUrl(driverId, rideCode) {
    var base = databaseURL() + "/rides/" + encodeURIComponent(HISTORY_HUB) + "/" + encodeURIComponent(driverId);
    if (rideCode) return base + "/" + encodeURIComponent(rideCode) + ".json";
    return base + ".json";
  }

  function riderHistoryKey() {
    var uid = firebaseUid();
    if (uid) return String(uid).slice(0, 48);
    var email = (firebaseEmail() || readSession() || "").trim().toLowerCase();
    if (!email) {
      try {
        var acct = JSON.parse(localStorage.getItem("pcs-rider-account") || "null");
        email = acct && acct.email ? String(acct.email).trim().toLowerCase() : "";
      } catch (e) { email = ""; }
    }
    var id = email.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return (id || "rider").slice(0, 48);
  }

  function riderHistoryUrl(rideCode) {
    var base = databaseURL() + "/rides/" + encodeURIComponent(RIDER_HISTORY_HUB) + "/" + encodeURIComponent(riderHistoryKey());
    if (rideCode) return base + "/" + encodeURIComponent(rideCode) + ".json";
    return base + ".json";
  }

  function chatUrl(code, pushId) {
    var base = databaseURL() + "/rides/" + encodeURIComponent(code) + "/chat";
    if (pushId) return base + "/" + encodeURIComponent(pushId) + ".json";
    return base + ".json";
  }

  function chatOpenForRole() {
    var st = String(state.rideStatus || "").toLowerCase();
    if (st !== "accepted") return false;
    if (ROLE === "customer") return state.screen === "trip" || state.screen === "waiting";
    if (ROLE === "driver") return state.screen === "trip";
    return false;
  }

  function activeChatCode() {
    if (ROLE === "driver") return state.driverCode || readDriverCode() || state.code || "";
    return state.code || "";
  }

  function chatQuickReplies() {
    return ["Here", "5 min away", "Looking for you", "Traffic — running late"];
  }

  function loadChatMessages() {
    if (!syncOn() || !chatOpenForRole()) return;
    var code = activeChatCode();
    if (!code) return;
    authFetch(chatUrl(code)).then(function (res) {
      if (!res.ok) return null;
      return res.text().then(function (t) {
        if (!t || t === "null") return {};
        try { return JSON.parse(t); } catch (e) { return {}; }
      });
    }).then(function (data) {
      if (!data || typeof data !== "object") data = {};
      var rows = Object.keys(data).map(function (id) {
        var m = data[id] || {};
        return {
          id: id,
          from: String(m.from || ""),
          text: String(m.text || ""),
          at: Number(m.at) || 0,
          name: String(m.name || "")
        };
      }).filter(function (m) { return m.text; });
      rows.sort(function (a, b) { return a.at - b.at; });
      var stamp = rows.map(function (m) { return m.id + ":" + m.at; }).join("|");
      if (stamp === state.chatStamp) return;
      state.chatStamp = stamp;
      state.chatMessages = rows;
      if (chatOpenForRole()) render();
    }).catch(function () {});
  }

  function sendChatMessage(textMsg, fromRole) {
    var code = activeChatCode();
    var msg = String(textMsg || "").trim().slice(0, 280);
    if (!code || !msg || !syncOn()) return Promise.resolve(false);
    if (!chatOpenForRole()) {
      state.chatError = "Chat is only open until the ride starts.";
      render();
      return Promise.resolve(false);
    }
    if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(msg)) {
      state.chatError = "Please do not share phone numbers in chat.";
      render();
      return Promise.resolve(false);
    }
    state.chatBusy = true;
    state.chatError = "";
    var name = "";
    if (fromRole === "driver") {
      var acct = readDriverAccount() || {};
      name = acct.name || state.driverName || "Driver";
    } else {
      name = state.name || "Rider";
    }
    var body = { from: fromRole, text: msg, at: Date.now(), name: name };
    return authFetch(chatUrl(code), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      state.chatBusy = false;
      if (!res.ok) throw new Error("chat");
      state.chatDraft = "";
      loadChatMessages();
      return true;
    }).catch(function () {
      state.chatBusy = false;
      state.chatError = "Message did not send. Try again.";
      render();
      return false;
    });
  }

  function chatBoxHtml() {
    if (!chatOpenForRole()) return "";
    var rows = state.chatMessages || [];
    var list = rows.length
      ? rows.map(function (m) {
          var mine = (ROLE === "driver" && m.from === "driver") || (ROLE === "customer" && m.from === "rider");
          return '<div class="chat-bubble' + (mine ? " mine" : "") + '"><strong>' +
            esc(m.from === "driver" ? (m.name || "Driver") : (m.name || "Rider")) +
            "</strong><br>" + esc(m.text) + "</div>";
        }).join("")
      : '<p class="fine">No messages yet. Say hello.</p>';
    var chips = "";
    if (ROLE === "driver") {
      chips = '<div class="chat-chips">' + chatQuickReplies().map(function (q) {
        return '<button type="button" class="btn ghost chat-chip" data-chat-quick="' + esc(q) + '">' + esc(q) + "</button>";
      }).join("") + "</div>";
    }
    return (
      '<div class="card chat-box" id="ride-chat">' +
      '<p class="tag">Chat · before pickup</p>' +
      '<p class="fine">In-app only. No phone numbers.</p>' +
      '<div class="chat-list" id="chat-list" style="max-height:180px;overflow:auto;font-size:18px;line-height:1.35">' + list + "</div>" +
      chips +
      '<form id="chat-form" autocomplete="off">' +
      '<label for="chat-input">Message</label>' +
      '<input id="chat-input" name="chat" type="text" maxlength="280" value="' + esc(state.chatDraft || "") + '" placeholder="Type a message" style="font-size:18px">' +
      (state.chatError ? '<p class="error" role="alert">' + esc(state.chatError) + "</p>" : "") +
      '<button class="btn" type="submit"' + (state.chatBusy ? " disabled" : "") + ">" + (state.chatBusy ? "Sending…" : "Send") + "</button>" +
      "</form></div>"
    );
  }

  function rememberRiderHistoryEntry(ride) {
    if (!ride || !ride.code) return;
    var st = String(ride.status || "").toLowerCase();
    if (st !== "completed" && st !== "cancelled" && st !== "denied") return;
    var entry = {
      code: String(ride.code),
      at: Number(ride.completedAt || ride.cancelledAt || ride.updatedAt || ride.acceptedAt || ride.requestedAt || Date.now()),
      status: st,
      pickup: ride.pickupAddress || [ride.pickupStreet, ride.pickupCity, ride.pickupState].filter(Boolean).join(", "),
      drop: ride.dropAddress || [ride.dropStreet, ride.dropCity, ride.dropState].filter(Boolean).join(", "),
      amountCents: ride.estimatedTotal != null && isFinite(+ride.estimatedTotal) ? Math.round(+ride.estimatedTotal) : null,
      fareBeforeTax: ride.fareBeforeTax != null && isFinite(+ride.fareBeforeTax) ? Math.round(+ride.fareBeforeTax) : null,
      when: ride.when || [ride.date, ride.time].filter(Boolean).join(" "),
      name: ride.name || ""
    };
    try {
      var key = "pcs-rider-history";
      var list = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (e) { return e && e.code !== entry.code; });
      list.unshift(entry);
      if (list.length > 80) list = list.slice(0, 80);
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {}
    if (syncOn() && ROLE === "customer") {
      authFetch(riderHistoryUrl(entry.code), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      }).catch(function () {});
    }
    if (syncOn() && ROLE === "driver") {
      var rid = "";
      if (ride.riderUid) rid = String(ride.riderUid).slice(0, 48);
      else if (ride.riderEmail) {
        rid = String(ride.riderEmail).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
      }
      if (rid) {
        var url = databaseURL() + "/rides/" + encodeURIComponent(RIDER_HISTORY_HUB) + "/" + encodeURIComponent(rid) + "/" + encodeURIComponent(entry.code) + ".json";
        authFetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry)
        }).catch(function () {});
      }
    }
  }

  function loadRiderHistory() {
    if (ROLE !== "customer" || !signedIn()) return Promise.resolve([]);
    state.historyLoading = true;
    var local = [];
    try {
      local = JSON.parse(localStorage.getItem("pcs-rider-history") || "[]");
      if (!Array.isArray(local)) local = [];
    } catch (e) { local = []; }
    var remoteP = syncOn()
      ? authFetch(riderHistoryUrl()).then(function (res) {
          if (!res.ok) return {};
          return res.text().then(function (t) {
            if (!t || t === "null") return {};
            try { return JSON.parse(t); } catch (e) { return {}; }
          });
        }).catch(function () { return {}; })
      : Promise.resolve({});
    return remoteP.then(function (data) {
      var byCode = {};
      local.forEach(function (e) { if (e && e.code) byCode[e.code] = e; });
      Object.keys(data || {}).forEach(function (code) {
        var e = data[code];
        if (!e || typeof e !== "object") return;
        if (!e.code) e.code = code;
        byCode[code] = Object.assign({}, byCode[code] || {}, e);
      });
      var rows = Object.keys(byCode).map(function (c) { return byCode[c]; });
      rows.sort(function (a, b) { return (Number(b.at) || 0) - (Number(a.at) || 0); });
      state.historyRows = rows;
      state.historyLoading = false;
      state.historyError = "";
      return rows;
    }).catch(function () {
      state.historyRows = local;
      state.historyLoading = false;
      state.historyError = "Could not load history.";
      return local;
    });
  }

  function fmtHistoryWhen(at) {
    if (!at) return "";
    try {
      return new Date(Number(at)).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  function customerHistoryList() {
    var rows = state.historyRows || [];
    var body = "";
    if (state.historyLoading) body = '<p class="lede">Loading…</p>';
    else if (!rows.length) body = '<p class="lede">No rides yet.</p>';
    else {
      body = rows.map(function (r) {
        var amt = r.amountCents != null ? money(r.amountCents) : "";
        return (
          '<button type="button" class="card history-row" data-history-code="' + esc(r.code || "") + '" style="text-align:left;width:100%;cursor:pointer">' +
          '<p class="tag">' + esc(String(r.status || "").toUpperCase()) + (amt ? " · " + esc(amt) : "") + "</p>" +
          '<p class="lede">' + esc(fmtHistoryWhen(r.at) || r.when || "") + "</p>" +
          "<p>" + esc(r.pickup || "—") + " → " + esc(r.drop || "—") + "</p>" +
          '<p class="fine">Code ' + esc(r.code || "") + "</p></button>"
        );
      }).join("");
    }
    return (
      '<div class="app-nav"><button class="btn ghost" type="button" id="history-back">← Back</button></div>' +
      "<h2>History</h2>" +
      '<p class="lede">Past rides and receipts.</p>' +
      (state.historyError ? '<p class="error">' + esc(state.historyError) + "</p>" : "") +
      body
    );
  }

  function customerHistoryReceipt() {
    var r = state.historyReceipt || {};
    var amt = r.amountCents != null ? money(r.amountCents) : "—";
    var fare = r.fareBeforeTax != null ? money(r.fareBeforeTax) : "";
    return (
      '<div class="app-nav"><button class="btn ghost" type="button" id="receipt-back">← History</button></div>' +
      "<h2>Receipt</h2>" +
      '<div class="card">' +
      '<p class="tag">' + esc(String(r.status || "").toUpperCase()) + "</p>" +
      '<p class="lede">' + esc(fmtHistoryWhen(r.at) || r.when || "") + "</p>" +
      "<p><strong>From</strong><br>" + esc(r.pickup || "—") + "</p>" +
      "<p><strong>To</strong><br>" + esc(r.drop || "—") + "</p>" +
      (fare ? "<p><strong>Fare before tax</strong> " + esc(fare) + "</p>" : "") +
      "<p><strong>Total</strong> " + esc(amt) + "</p>" +
      '<p class="fine">Ride code ' + esc(r.code || "") + "</p>" +
      '<p class="fine">Amounts shown are what was stored for this ride. Not a new charge.</p>' +
      "</div>"
    );
  }

  function calendarHubUrl(eventId) {
    var base = databaseURL() + "/rides/" + encodeURIComponent(CALENDAR_HUB);
    if (eventId) return base + "/" + encodeURIComponent(eventId) + ".json";
    return base + ".json";
  }

  function riderNameFromPcsTitle(title) {
    var t = String(title || "").trim();
    t = t.replace(/^pcs\b[\s\u2013\u2014\-:|]*/i, "").trim();
    return t || "Scheduled rider";
  }

  function dropoffFromNotes(notes) {
    var text = String(notes || "").replace(/\r/g, "");
    var lines = text.split("\n");
    var i;
    for (i = 0; i < lines.length; i += 1) {
      var line = String(lines[i] || "").trim();
      var m = line.match(/^(?:drop[\s-]?off|to)\s*:\s*(.+)$/i);
      if (m && m[1]) return String(m[1]).trim();
    }
    return text.trim();
  }

  function prettyScheduleWhen(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (!isFinite(d.getTime())) return String(iso);
      return d.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (err) {
      return String(iso);
    }
  }

  function normalizeScheduleRow(id, raw) {
    if (!raw || typeof raw !== "object") return null;
    var title = String(raw.title || raw.summary || "").trim();
    var status = String(raw.status || "open").toLowerCase();
    return {
      id: String(raw.id || id || ""),
      title: title,
      rider: String(raw.rider || riderNameFromPcsTitle(title)),
      pickup: String(raw.pickup || raw.location || ""),
      dropoff: String(raw.dropoff || dropoffFromNotes(raw.description || raw.notes || "")),
      start: String(raw.start || ""),
      end: String(raw.end || ""),
      description: String(raw.description || raw.notes || ""),
      assignedDriverId: String(raw.assignedDriverId || ""),
      assignedDriverName: String(raw.assignedDriverName || ""),
      status: status,
      code: String(raw.code || ""),
      fareBeforeTax: raw.fareBeforeTax != null ? Number(raw.fareBeforeTax) : null,
      commissionCents: raw.commissionCents != null ? Number(raw.commissionCents) : null,
      completedAt: raw.completedAt || null
    };
  }

  function listScheduledRides() {
    if (!syncOn()) return Promise.resolve([]);
    return authFetch(calendarHubUrl()).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("calendar-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("calendar");
      return res.text().then(function (text) {
        if (!text || text === "null") return [];
        try {
          var data = JSON.parse(text);
          if (!data || typeof data !== "object") return [];
          return Object.keys(data).map(function (id) {
            return normalizeScheduleRow(id, data[id]);
          }).filter(Boolean);
        } catch (e) {
          return [];
        }
      });
    });
  }

  function myAssignedScheduled() {
    var me = driverPresenceId();
    if (!me) return [];
    return (state.scheduledRides || []).filter(function (r) {
      if (!r || r.status === "completed" || r.status === "cancelled") return false;
      return String(r.assignedDriverId || "") === me;
    }).sort(function (a, b) {
      return String(a.start || "").localeCompare(String(b.start || ""));
    });
  }

  function refreshScheduledRides(force) {
    if (ROLE !== "driver" || !signedIn() || !syncOn()) return Promise.resolve();
    return listScheduledRides().then(function (rows) {
      state.scheduledRides = rows || [];
      state.scheduledError = "";
      state.scheduledStamp = String(Date.now());
      if (force) render();
    }).catch(function (err) {
      state.scheduledError = err && err.denied ? "denied" : "error";
      if (force) render();
    });
  }

  function scheduledRidesCard() {
    if (ROLE !== "driver" || !signedIn() || state.milesEndPrompt || state.hubOpen) return "";
    var mine = myAssignedScheduled();
    if (!mine.length) {
      if (state.scheduledError === "denied") {
        return '<p class="fine">Scheduled rides could not load (permission).</p>';
      }
      return "";
    }
    var cards = mine.map(function (r) {
      return (
        '<article class="card scheduled-ride-card" data-schedule-id="' + esc(r.id) + '">' +
        '<p class="tag">Assigned scheduled ride</p>' +
        "<h3>" + esc(r.rider) + "</h3>" +
        '<p class="lede">' + esc(prettyScheduleWhen(r.start)) + "</p>" +
        "<p><strong>Pickup</strong><br>" + esc(r.pickup || "—") + "</p>" +
        "<p><strong>Drop-off</strong><br>" + esc(r.dropoff || "—") + "</p>" +
        '<div class="row-actions">' +
        '<button class="btn" type="button" data-complete-schedule="' + esc(r.id) + '">Mark complete</button>' +
        "</div>" +
        '<p class="fine">Matthew assigned this from the God day board. Completing credits your Mon–Sun commission week.</p>' +
        "</article>"
      );
    }).join("");
    return "<h2>Scheduled for you</h2>" + cards;
  }

  function completeScheduledRide(eventId) {
    var row = null;
    var i;
    for (i = 0; i < (state.scheduledRides || []).length; i += 1) {
      if (state.scheduledRides[i] && state.scheduledRides[i].id === eventId) {
        row = state.scheduledRides[i];
        break;
      }
    }
    if (!row) return Promise.resolve();
    var pct = state.rosterPct != null ? Number(state.rosterPct) : Math.round(DRIVER_COMMISSION_RATE * 100);
    if (!isFinite(pct)) pct = 70;
    var fareBefore = row.fareBeforeTax != null && isFinite(Number(row.fareBeforeTax))
      ? Number(row.fareBeforeTax)
      : 0;
    var commissionCents = Math.round(fareBefore * (pct / 100));
    var day = chicagoToday();
    var code = row.code || ("PCS" + String(eventId).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5));
    if (code.length < 8) {
      while (code.length < 8) code += CODE_ALPHABET[code.length % CODE_ALPHABET.length];
      code = code.slice(0, 8);
    }
    var entry = {
      code: code,
      day: day,
      completedAt: Date.now(),
      when: prettyScheduleWhen(row.start),
      pickup: row.pickup || "",
      drop: row.dropoff || "",
      rawMiles: null,
      billedMiles: null,
      fareSub: fareBefore,
      fareTax: 0,
      fareTotal: fareBefore,
      commissionPct: pct,
      commissionCents: commissionCents,
      riderName: row.rider || "",
      source: "calendar"
    };
    var list = readRideLog().filter(function (e) { return !e || e.code !== code; });
    list.unshift(entry);
    writeRideLog(list);
    var stats = readDayStats(day);
    stats.completed += 1;
    stats.commissionCents += commissionCents;
    stats.rideTotalCents += Math.round(fareBefore);
    writeDayStats(day, stats);
    var next = Object.assign({}, row, {
      status: "completed",
      completedAt: Date.now(),
      code: code,
      commissionCents: commissionCents,
      assignedDriverId: driverPresenceId(),
      assignedDriverName: (readDriverAccount() && readDriverAccount().name) || ""
    });
    var puts = [];
    if (syncOn()) {
      puts.push(authFetch(calendarHubUrl(eventId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      }));
      puts.push(authFetch(historyUrl(driverPresenceId(), code), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      }));
    }
    return Promise.all(puts).then(function () {
      return refreshScheduledRides(true);
    }).catch(function () {
      return refreshScheduledRides(true);
    });
  }


  function applyRosterRow(row) {
    if (!row || typeof row !== "object") {
      state.rosterStatus = syncOn() ? "pending" : "approved";
      return;
    }
    if (row.commissionPct != null && isFinite(+row.commissionPct)) {
      state.rosterPct = Math.round(+row.commissionPct);
      DRIVER_COMMISSION_RATE = state.rosterPct / 100;
    }
    var approval = String(row.approvalStatus || "").toLowerCase();
    if (approval === "pending") state.rosterStatus = "pending";
    else if (approval === "rejected") state.rosterStatus = "rejected";
    else if (row.active === false) state.rosterStatus = "fired";
    else state.rosterStatus = "approved";
  }

  function refreshRosterStatus() {
    if (ROLE !== "driver" || !signedIn() || !syncOn()) {
      if (!syncOn()) state.rosterStatus = "approved";
      return Promise.resolve();
    }
    function loadRow(res) {
      if (res.status === 404) {
        applyRosterRow(null);
        return null;
      }
      if (!res.ok) throw new Error("roster");
      return res.text().then(function (text) {
        if (!text || text === "null") {
          applyRosterRow(null);
          return null;
        }
        try { return JSON.parse(text); } catch (e) { return null; }
      });
    }
    var id = driverPresenceId();
    return authFetch(rosterUrl(id)).then(loadRow).catch(function () {
      return fetch(rosterUrl(id)).then(loadRow);
    }).then(function (row) {
      if (row !== undefined) applyRosterRow(row);
    }).catch(function () {});
  }

  function publishPendingSignup(account) {
    if (!syncOn() || !account || !account.email) return Promise.resolve();
    var id = String(account.email).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    if (!id) return Promise.resolve();
    return authFetch(rosterUrl(id)).then(function (res) {
      return res.text().then(function (text) {
        var existing = null;
        if (text && text !== "null") {
          try { existing = JSON.parse(text); } catch (e) { existing = null; }
        }
        if (existing && existing.active === true) return existing;
        if (existing && String(existing.approvalStatus || "").toLowerCase() === "approved") return existing;
        if (existing && String(existing.approvalStatus || "").toLowerCase() === "fired") return existing;
        if (existing && String(existing.approvalStatus || "").toLowerCase() === "rejected") return existing;
        /* Drivers may only create/update a pending signup row — never self-approve. */
        var row = {
          name: account.name || "",
          phone: account.phone || "",
          email: String(account.email || "").toLowerCase(),
          uid: firebaseUid() || account.uid || "",
          commissionPct: (existing && existing.commissionPct != null) ? existing.commissionPct : Math.round(DRIVER_COMMISSION_RATE * 100),
          active: false,
          approvalStatus: "pending",
          signedUpAt: (existing && existing.signedUpAt) || Date.now(),
          updatedAt: Date.now(),
          carYear: account.carYear || "",
          carMake: account.carMake || "",
          carModel: account.carModel || "",
          carPlate: normalizePlate(account.carPlate),
          carSeats: account.carSeats || ""
        };
        var method = existing ? "PATCH" : "PUT";
        var body = existing
          ? {
              name: row.name,
              phone: row.phone,
              email: row.email,
              carYear: row.carYear,
              carMake: row.carMake,
              carModel: row.carModel,
              carPlate: row.carPlate,
              carSeats: row.carSeats,
              updatedAt: row.updatedAt
            }
          : row;
        return authFetch(rosterUrl(id), {
          method: method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }).then(function () { return row; });
      });
    }).catch(function () {});
  }

  function accountsHubUrl(id) {
    var base = databaseURL() + "/rides/" + encodeURIComponent("USRACCTS");
    if (id) return base + "/" + encodeURIComponent(id) + ".json";
    return base + ".json";
  }

  function syncAccountProfile(role, account) {
    /* Profile under /rides/USRACCTS/{uid}. Password lives only in Firebase Auth. */
    if (!syncOn() || !account) return Promise.resolve();
    var uid = firebaseUid() || account.uid || "";
    if (!uid) return Promise.resolve();
    var row = {
      uid: uid,
      role: role || "",
      name: account.name || "",
      phone: account.phone || "",
      email: String(account.email || firebaseEmail() || "").toLowerCase(),
      updatedAt: Date.now()
    };
    return authFetch(accountsHubUrl(uid), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) throw new Error("account");
      return res.text().then(function () {});
    }).catch(function () {});
  }

  /* ---- v50: permanent driver profile on the server ----
     Before v50 the car details and both photos lived only in this device's localStorage. A roster-password
     login (any time the saved account had no passwordHash, e.g. after using the Profile page) replaced the
     saved account with just name/phone/email, so the driver had to redo the whole vehicle profile.
     Now: /rides/DRVRPRFL/{driverId} holds the profile, keyed by the stable email-based roster id. */
  var PROFILE_FIELDS = ["name", "phone", "photo", "carYear", "carMake", "carModel", "carPlate", "carSeats", "carColor", "carPhoto"];
  var PROFILE_PHOTO_FIELDS = { photo: 1, carPhoto: 1 };
  var profileSyncPromise = null;

  function driverIdForEmail(email) {
    var e = String(email || "").trim().toLowerCase();
    return e.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  }

  function profileUrl(id) {
    return databaseURL() + "/rides/" + encodeURIComponent(PROFILE_HUB) + "/" + encodeURIComponent(id) + ".json";
  }

  function profileValue(key, value) {
    if (PROFILE_PHOTO_FIELDS[key]) return safePhoto(value);
    if (value == null) return "";
    if (key === "carPlate") return normalizePlate(value);
    return value;
  }

  function hasProfileValue(key, value) {
    var v = profileValue(key, value);
    return v !== "" && v != null;
  }

  function mergeDriverProfile(local, remote) {
    /* Returns { account, changed, needPush }. Never drops a field that either side has. */
    var acc = Object.assign({}, local || {});
    var localAt = Number(acc.profileUpdatedAt) || 0;
    var remoteAt = remote ? (Number(remote.updatedAt) || 0) : 0;
    var remoteNewer = !!remote && remoteAt > localAt;
    var changed = false;
    var needPush = false;
    PROFILE_FIELDS.forEach(function (k) {
      var lv = hasProfileValue(k, acc[k]);
      var rv = remote ? hasProfileValue(k, remote[k]) : false;
      if (rv && (!lv || (remoteNewer && profileValue(k, remote[k]) !== profileValue(k, acc[k])))) {
        acc[k] = profileValue(k, remote[k]);
        changed = true;
      } else if (lv && (!rv || (!remoteNewer && localAt > remoteAt && profileValue(k, remote[k]) !== profileValue(k, acc[k])))) {
        needPush = true;
      }
    });
    if (remoteNewer) {
      acc.profileUpdatedAt = remoteAt;
      changed = true;
    }
    return { account: acc, changed: changed, needPush: needPush };
  }

  function writeDriverAccountLocal(account) {
    try { localStorage.setItem("pcs-driver-account", JSON.stringify(account)); return true; } catch (err) { return false; }
  }

  function pushDriverProfile(account) {
    /* PUT the full profile (only profile fields; never passwords). Also copy the car text onto the roster row
       (never approvalStatus / active / commissionPct) so God mode sees it. */
    if (!syncOn() || !account || !account.email) return Promise.resolve(false);
    var id = driverIdForEmail(account.email);
    if (!id) return Promise.resolve(false);
    var at = Number(account.profileUpdatedAt) || Date.now();
    var row = { email: String(account.email).trim().toLowerCase(), driverId: id, updatedAt: at };
    var uid = firebaseUid() || account.uid || "";
    if (uid) row.uid = uid;
    PROFILE_FIELDS.forEach(function (k) {
      if (hasProfileValue(k, account[k])) row[k] = profileValue(k, account[k]);
    });
    return authFetch(profileUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) throw new Error("profile " + res.status);
      return res.text();
    }).then(function () {
      if (!(Number(account.profileUpdatedAt) > 0)) {
        var cur = readDriverAccount();
        if (cur && String(cur.email || "").toLowerCase() === row.email) {
          cur.profileUpdatedAt = at;
          writeDriverAccountLocal(cur);
        }
      }
      /* Roster car text: only PATCH an existing roster row (PATCH would create a half row otherwise). */
      return authFetch(rosterUrl(id)).then(function (res) {
        if (!res.ok) return "";
        return res.text();
      }).then(function (text) {
        if (!text || text === "null") return;
        var car = {};
        ["carYear", "carMake", "carModel", "carPlate", "carSeats"].forEach(function (k) {
          if (hasProfileValue(k, row[k])) car[k] = row[k];
        });
        if (!Object.keys(car).length) return;
        car.profileUpdatedAt = at;
        return authFetch(rosterUrl(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(car)
        });
      }).catch(function () {});
    }).then(function () { return true; });
  }

  function fetchDriverProfile(email) {
    var id = driverIdForEmail(email);
    if (!syncOn() || !id) return Promise.resolve(null);
    return authFetch(profileUrl(id)).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("profile " + res.status);
      return res.text().then(function (text) {
        if (!text || text === "null") return null;
        var row = null;
        try { row = JSON.parse(text); } catch (e) { row = null; }
        if (!row || typeof row !== "object") return null;
        if (row.email && String(row.email).trim().toLowerCase() !== String(email).trim().toLowerCase()) return null;
        return row;
      });
    });
  }

  function syncDriverProfile() {
    /* Load the saved profile from the server into this device, and back up anything only this device has.
       Resolves (never rejects) within ~8s so login is never stuck. */
    if (ROLE !== "driver") return Promise.resolve();
    if (profileSyncPromise) return profileSyncPromise;
    var local = readDriverAccount();
    var email = local && local.email ? String(local.email).trim().toLowerCase() : String(readSession() || "").trim().toLowerCase();
    if (!syncOn() || !email || email.indexOf("@") < 0) return Promise.resolve();
    state.profileSyncing = true;
    var work = fetchDriverProfile(email).then(function (remote) {
      var cur = readDriverAccount() || {};
      if (cur.email && String(cur.email).trim().toLowerCase() !== email) return;
      if (!cur.email) cur.email = email;
      var merged = mergeDriverProfile(cur, remote);
      if (merged.changed) writeDriverAccountLocal(merged.account);
      if (merged.needPush) return pushDriverProfile(merged.account).catch(function () {});
    }).catch(function () {
      state.profileSyncError = true;
    });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 8000); });
    profileSyncPromise = Promise.race([work, timeout]).then(function () {
      state.profileSyncing = false;
      profileSyncPromise = null;
    });
    return profileSyncPromise;
  }

  function rideLogStorageKey() {
    return "pcs-driver-ride-log-" + driverPresenceId();
  }

  function dayStatStorageKey(day) {
    return "pcs-driver-day-stats-" + driverPresenceId() + "-" + (day || chicagoToday());
  }

  function readRideLog() {
    try {
      var raw = localStorage.getItem(rideLogStorageKey());
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function writeRideLog(list) {
    try {
      localStorage.setItem(rideLogStorageKey(), JSON.stringify(list.slice(0, 500)));
    } catch (err) {}
  }

  function readDayStats(day) {
    try {
      var raw = localStorage.getItem(dayStatStorageKey(day));
      var row = raw ? JSON.parse(raw) : null;
      if (!row || typeof row !== "object") return { requested: 0, completed: 0, commissionCents: 0, rideTotalCents: 0 };
      return {
        requested: Number(row.requested) || 0,
        completed: Number(row.completed) || 0,
        commissionCents: Number(row.commissionCents) || 0,
        rideTotalCents: Number(row.rideTotalCents) || 0
      };
    } catch (err) {
      return { requested: 0, completed: 0, commissionCents: 0, rideTotalCents: 0 };
    }
  }

  function writeDayStats(day, row) {
    try {
      localStorage.setItem(dayStatStorageKey(day), JSON.stringify(row));
    } catch (err) {}
  }

  function bumpDayRequested() {
    var day = chicagoToday();
    var row = readDayStats(day);
    row.requested += 1;
    writeDayStats(day, row);
    state.dayRequested = row.requested;
  }

  function mondayOfWeek(ymd) {
    var parts = String(ymd || chicagoToday()).split("-");
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return chicagoToday();
    var dt = new Date(y, m - 1, d);
    var dow = dt.getDay();
    var offset = dow === 0 ? -6 : 1 - dow;
    dt.setDate(dt.getDate() + offset);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }

  function addDaysYmd(ymd, n) {
    var parts = String(ymd).split("-");
    var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    dt.setDate(dt.getDate() + n);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }

  function ridesForDay(day) {
    return readRideLog().filter(function (e) { return e && e.day === day; });
  }

  function appendCompletedRideLog() {
    var snap = fareSnapshot();
    var pct = state.rosterPct != null ? Number(state.rosterPct) : Math.round(DRIVER_COMMISSION_RATE * 100);
    if (!isFinite(pct)) pct = 70;
    var fareSub = snap ? Number(snap.fareSub) || 0 : 0;
    var fareTotal = snap ? Number(snap.fareTotal) || 0 : 0;
    var base = fareSub - EXTRA_FEE;
    if (base < 0) base = 0;
    var commissionCents = Math.round(base * (pct / 100));
    var day = chicagoToday();
    var code = state.driverCode || state.code || readDriverCode() || ("LOCAL" + Date.now());
    var entry = {
      code: code,
      day: day,
      completedAt: Date.now(),
      when: prettyWhen(),
      pickup: pickupLine(),
      drop: dropLine(),
      rawMiles: snap ? snap.rawMiles : null,
      billedMiles: snap ? snap.billedMiles : null,
      fareSub: fareSub,
      fareTax: snap ? snap.fareTax : 0,
      fareTotal: fareTotal,
      commissionPct: pct,
      commissionCents: commissionCents,
      riderName: state.name || ""
    };
    var list = readRideLog().filter(function (e) { return !e || e.code !== code; });
    list.unshift(entry);
    writeRideLog(list);
    var stats = readDayStats(day);
    stats.completed += 1;
    stats.commissionCents += commissionCents;
    stats.rideTotalCents += fareTotal;
    writeDayStats(day, stats);
    if (syncOn()) {
      authFetch(historyUrl(driverPresenceId(), code), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      }).catch(function () {});
    }
    rememberRiderHistoryEntry({
      code: code,
      status: "completed",
      completedAt: entry.completedAt,
      pickupStreet: state.pickupStreet,
      pickupCity: state.pickupCity,
      pickupState: state.pickupState,
      dropStreet: state.dropStreet,
      dropCity: state.dropCity,
      dropState: state.dropState,
      pickupAddress: entry.pickup,
      dropAddress: entry.drop,
      estimatedTotal: entry.fareTotal,
      fareBeforeTax: entry.fareSub,
      name: state.name,
      riderEmail: state.riderEmail || (currentRide() && currentRide().riderEmail),
      riderUid: state.riderUid || (currentRide() && currentRide().riderUid)
    });
    return entry;
  }


  function refusalUrl(id) {
    return databaseURL() + "/refusals/" + encodeURIComponent(id) + ".json";
  }

  function openSummaryFromRide(code, ride) {
    return {
      code: code,
      status: (ride && ride.status) || "requested",
      name: (ride && ride.name) || "",
      phone: (ride && ride.phone) || "",
      pickupStreet: (ride && ride.pickupStreet) || "",
      pickupCity: (ride && ride.pickupCity) || "",
      pickupState: (ride && ride.pickupState) || "TX",
      dropStreet: (ride && ride.dropStreet) || "",
      dropCity: (ride && ride.dropCity) || "",
      dropState: (ride && ride.dropState) || "TX",
      pickupLine2: (ride && ride.pickupLine2) || "",
      pickupZip: (ride && ride.pickupZip) || "",
      pickupAddress: (ride && ride.pickupAddress) || "",
      dropLine2: (ride && ride.dropLine2) || "",
      dropZip: (ride && ride.dropZip) || "",
      dropAddress: (ride && ride.dropAddress) || "",
      stops: ride && ride.stops != null ? Number(ride.stops) || 0 : 0,
      stopAddresses: normalizeStops(ride && ride.stopList).map(stopLine),
      cardStatus: (ride && ride.cardStatus) || "",
      date: (ride && ride.date) || "",
      time: (ride && ride.time) || "",
      asap: !!(ride && rideIsAsap(ride)),
      when: (ride && rideIsAsap(ride)) ? "asap" : ((ride && ride.when) || ""),
      pickupLat: ride ? ride.pickupLat : null,
      pickupLng: ride ? ride.pickupLng : null,
      dropLat: ride ? ride.dropLat : null,
      dropLng: ride ? ride.dropLng : null,
      isTest: !!(ride && ride.isTest),
      updatedAt: Date.now()
    };
  }

  function putOpenRide(code, ride) {
    if (!syncOn() || !code) return Promise.resolve();
    return authFetch(openIndexUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(openSummaryFromRide(code, ride))
    }).then(function (res) {
      if (!res.ok) throw new Error("open");
      return res.text().then(function () {});
    });
  }

  function deleteOpenRide(code) {
    if (!syncOn() || !code) return Promise.resolve();
    return authFetch(openIndexUrl(code), { method: "DELETE" }).then(function (res) {
      if (!res.ok && res.status !== 404) throw new Error("open");
      return res.text().then(function () {});
    });
  }

  function listOpenSummariesRaw() {
    if (!syncOn()) return Promise.resolve([]);
    return authFetch(openIndexUrl()).then(function (res) {
      if (!res.ok) return [];
      return res.text().then(function (text) {
        if (!text || text === "null") return [];
        var data;
        try { data = JSON.parse(text); } catch (e) { return []; }
        if (!data || typeof data !== "object") return [];
        var out = [];
        Object.keys(data).forEach(function (code) {
          var row = data[code];
          if (!row || typeof row !== "object") return;
          if (row.kind === "driver" || row.kind === "driverPresence") return;
          if (code === "drivers") return;
          if (!row.code) row.code = code;
          out.push(row);
        });
        return out;
      });
    }).catch(function () { return []; });
  }

  function listOpenRides() {
    if (!syncOn()) return Promise.resolve([]);
    return authFetch(openIndexUrl()).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("open-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("open");
      return res.text().then(function (text) {
        if (!text || text === "null") return [];
        var data;
        try { data = JSON.parse(text); } catch (e) { return []; }
        if (!data || typeof data !== "object") return [];
        var out = [];
        Object.keys(data).forEach(function (code) {
          var row = data[code];
          if (!row || typeof row !== "object") return;
          if (row.kind === "driver" || row.kind === "driverPresence") return;
          if (code === "drivers") return;
          if ((row.status || "requested") !== "requested") return;
          if (row.isTest && !isOwnerSession()) return; /* TEST rides never on other drivers\' boards */
          if (!isCoord(row.pickupLat) || !isCoord(row.pickupLng)) return;
          var asapRow = !!(row.asap === true || String(row.asap || "").toLowerCase() === "true" ||
            String(row.when || "").toLowerCase() === "asap" || String(row.time || "").toLowerCase() === "asap");
          if (asapRow) {
            var age = Date.now() - Number(row.updatedAt || row.requestedAt || row.createdAt || 0);
            if (Number(row.updatedAt || row.requestedAt || row.createdAt || 0) > 0 && age > ASAP_EXPIRE_MS) {
              deleteOpenRide(code).catch(function () {});
              return;
            }
          }
          if (!row.code) row.code = code;
          out.push(row);
        });
        var me = isCoord(state.hereLat) && isCoord(state.hereLng) ? { lat: +state.hereLat, lng: +state.hereLng } : null;
        out.forEach(function (r) {
          r._distMi = me ? haversine(me, { lat: +r.pickupLat, lng: +r.pickupLng }) : null;
        });
        out.sort(function (a, b) {
          var aa = rideIsAsap(a) ? 0 : 1, bb = rideIsAsap(b) ? 0 : 1;
          if (aa !== bb) return aa - bb;
          if (aa === 0 && a._distMi != null && b._distMi != null && a._distMi !== b._distMi) return a._distMi - b._distMi;
          return String(a.date || "").localeCompare(String(b.date || "")) ||
            String(a.time || "").localeCompare(String(b.time || "")) ||
            ((a._distMi || 0) - (b._distMi || 0));
        });
        return out;
      });
    });
  }

  function makeRefusalId() {
    var t = Date.now().toString(36).toUpperCase();
    var rand = "";
    var i;
    for (i = 0; i < 4; i += 1) rand += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return t + rand;
  }

  function buildRefusalRecord(ride, driverAccount) {
    var est = estimate();
    return {
      deniedAt: new Date().toISOString(),
      notifyEmail: "mwragge@privatetaxiservices.net",
      situation: "Driver denied this open ride request",
      rideCode: (ride && ride.code) || state.code || state.selectedOpenCode || "",
      driverName: (driverAccount && driverAccount.name) || state.driverName || "",
      driverPhone: (driverAccount && driverAccount.phone) || state.driverPhone || "",
      driverEmail: (driverAccount && driverAccount.email) || "",
      customerName: (ride && ride.name) || state.name || "",
      customerPhone: (ride && ride.phone) || state.phone || "",
      pickup: pickupLine(),
      dropoff: dropLine(),
      when: prettyWhen(),
      date: state.date || (ride && ride.date) || "",
      time: state.time || (ride && ride.time) || "",
      miles: est.ready ? est.raw : null,
      billedMiles: est.ready ? est.billed : null,
      fareBeforeTax: est.ready ? est.sub : null,
      estimatedTotal: est.ready ? est.total : null,
      needsEmail: true
    };
  }

  function postRefusal(record) {
    if (!syncOn() || !record) return Promise.resolve({ ok: false, reason: "no-sync" });
    var id = makeRefusalId();
    return authFetch(refusalUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record)
    }).then(function (res) {
      if (!res.ok) throw new Error("refusal");
      return res.text().then(function () { return { ok: true, id: id }; });
    });
  }

  function publishDriverPresence() {
    if (!syncOn() || ROLE !== "driver" || !signedIn()) return Promise.resolve();
    if (state.milesEndPrompt) return Promise.resolve();
    if (!canGoOnline()) return Promise.resolve();
    var account = readDriverAccount() || {};
    var speedFresh = !!(state.speedAt && (Date.now() - state.speedAt <= 20000));
    var body = {
      online: true,
      at: Date.now(),
      name: account.name || state.driverName || "",
      phone: account.phone || state.driverPhone || "",
      lat: isCoord(state.hereLat) ? +state.hereLat : null,
      lng: isCoord(state.hereLng) ? +state.hereLng : null,
      carYear: account.carYear || "",
      carMake: account.carMake || "",
      carModel: account.carModel || "",
      carPlate: normalizePlate(account.carPlate),
      carSeats: account.carSeats || "",
      gpsMilesToday: Number(state.milesToday) || 0,
      onlineMinutesToday: Math.floor(onlineMsToday() / 60000),
      startOdometer: state.milesStartOdo,
      speedMph: speedFresh ? Math.round(state.speedMph || 0) : 0,
      speedAt: state.speedAt || null
    };
    return authFetch(driversUrl(driverPresenceId()), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("presence");
      return res.text().then(function () {});
    }).catch(function () {});
  }

  function clearDriverPresence() {
    if (!syncOn() || ROLE !== "driver") return Promise.resolve();
    return authFetch(driversUrl(driverPresenceId()), { method: "DELETE" }).catch(function () {});
  }

  function listOnlineDrivers() {
    if (!syncOn()) return Promise.resolve([]);
    return authFetch(driversUrl()).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("drivers-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("drivers");
      return res.text().then(function (text) {
        if (!text || text === "null") return [];
        var data;
        try { data = JSON.parse(text); } catch (e) { return []; }
        if (!data || typeof data !== "object") return [];
        var cutoff = Date.now() - 2 * 60 * 1000;
        var out = [];
        Object.keys(data).forEach(function (id) {
          var row = data[id];
          if (!row || typeof row !== "object") return;
          if (row.online === false) return;
          if (Number(row.at || 0) < cutoff) return;
          row.id = id;
          out.push(row);
        });
        return out;
      });
    });
  }

  function refreshOnlineDrivers() {
    if (ROLE !== "customer" || !signedIn()) return;
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    listOnlineDrivers().then(function (drivers) {
      var stamp = drivers.map(function (d) { return (d.id || "") + ":" + (d.at || ""); }).join("|");
      var changed = stamp !== state.onlineStamp;
      state.onlineStamp = stamp;
      state.onlineDrivers = drivers;
      if (changed) render();
    }).catch(function () {
      /* presence index may be blocked until rules allow /drivers */
    });
  }

  function readDriverCode() {
    try { return localStorage.getItem(DRIVER_CODE) || ""; } catch (err) { return ""; }
  }

  function writeDriverCode(code) {
    try {
      if (code) localStorage.setItem(DRIVER_CODE, code);
      else localStorage.removeItem(DRIVER_CODE);
    } catch (err) {}
  }

  function rememberRemote(ride) {
    if (!ride || typeof ride !== "object") return;
    try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (err) {}
    applyRide(ride);
  }

  function publishRide(code, created) {
    var remote = Object.assign({}, created || {});
    remote.status = "pending_owner";
    remote.requestedAt = Date.now();
    remote.createdAt = remote.requestedAt;
    remote.updatedAt = remote.requestedAt;
    remote.isTest = !!state.isTest && testModeAvailable();
    remote.cardStatus = remote.isTest ? "test_skip" : (remote.cardStatus && remote.cardStatus !== "" ? remote.cardStatus : "none");
    if (squareChargeOn() && squareCfg().testMode) remote.squareSandbox = true; /* Square TEST MODE (?squaretest=1): flags the ride so it is easy to spot and delete */
    var uid = firebaseUid();
    if (uid) remote.riderUid = uid;
    if (firebaseEmail()) remote.riderEmail = firebaseEmail();
    delete remote.pin; /* plaintext PIN stays on the rider device only */
    delete remote.pinHash;
    var pin = state.pin || makeRidePin();
    if (remote.isTest) {
      pin = TEST_PIN;
      state.pin = TEST_PIN;
    } else {
      state.pin = normalizeStoredPin(pin) || makeRidePin();
      pin = state.pin;
    }
    var pinPromise = remote.isTest
      ? Promise.resolve(remote)
      : pinHashFor(pin, code).then(function (h) {
          remote.pinHash = h; /* putRide moves this under /secrets */
          state.pinHash = h;
          return remote;
        });
    return pinPromise.then(function (payload) {
      return putRide(code, payload).then(function () {
        /* TEST rides go on REQUESTS with isTest so owner driver session can see them; listOpenRides hides them from everyone else. */
        var openPromise = putOpenRide(code, Object.assign({}, payload, { status: "pending_owner", isTest: !!payload.isTest }));
        return openPromise.then(function () {
          notifyOwnerNewBooking(payload);
          state.rideStatus = "pending_owner";
          state.isTest = !!payload.isTest;
          saveRide("pending_owner");
          return payload;
        });
      });
    });
  }

  function pushPlaceCoords() {
    if (!syncOn() || ROLE !== "customer" || !state.code) return;
    var patch = {};
    if (isCoord(state.pickupLat) && isCoord(state.pickupLng)) {
      patch.pickupLat = +state.pickupLat;
      patch.pickupLng = +state.pickupLng;
    }
    if (isCoord(state.dropLat) && isCoord(state.dropLng)) {
      patch.dropLat = +state.dropLat;
      patch.dropLng = +state.dropLng;
    }
    if (!isCoord(patch.pickupLat) && !isCoord(patch.dropLat)) return;
    patchRide(state.code, patch).then(function () {
      var latest = currentRide() || {};
      Object.keys(patch).forEach(function (k) { latest[k] = patch[k]; });
      if (!latest.code) latest.code = state.code;
      putOpenRide(state.code, latest).catch(function () {});
    }).catch(function () {});
  }

  function maybePatchDriverLocation() {
    if (!syncOn() || ROLE !== "driver" || state.screen !== "trip") return;
    if (state.rideStatus === "completed" || state.rideStatus === "cancelled") return;
    var code = state.driverCode || readDriverCode();
    if (!code) return;
    if (!isCoord(state.hereLat) || !isCoord(state.hereLng)) return;
    var lat = +state.hereLat;
    var lng = +state.hereLng;
    if (lastDriverPatchLat === lat && lastDriverPatchLng === lng) return;
    var now = Date.now();
    if (now - lastDriverPatchAt < 3000) return;
    lastDriverPatchAt = now;
    lastDriverPatchLat = lat;
    lastDriverPatchLng = lng;
    patchRide(code, { driverLat: lat, driverLng: lng }).catch(function () {
      if (lastDriverPatchLat === lat && lastDriverPatchLng === lng) {
        lastDriverPatchLat = null;
        lastDriverPatchLng = null;
      }
    });
  }

  function riderPinBanner() {
    var pin = ensureRidePin();
    var cardBox = rideCardReady() ? "" : cardNeededHtml(); /* "Add card for this ride" box stays until the card is OK */
    if (!riderPinReady() || !pin) return cardBox;
    return (
      '<div class="pin-box">' +
      '<p class="ride-pin-label">Give your driver this PIN when they arrive</p>' +
      '<p class="ride-pin">' + esc(pin) + "</p>" +
      '<p class="fine">They find your ride on the map. This PIN only starts the trip.</p>' +
      "</div>" + cardBox
    );
  }

  function driverProfileLink() {
    return '<a class="nav-link" href="signup/?v=24">Profile</a>';
  }

  function selectedOpenRide() {
    var code = state.selectedOpenCode;
    if (!code) return null;
    var i;
    for (i = 0; i < state.openRides.length; i += 1) {
      if (state.openRides[i].code === code) return state.openRides[i];
    }
    return null;
  }

  function driverPickupDistanceLine() {
    var me = isCoord(state.hereLat) && isCoord(state.hereLng) ? { lat: +state.hereLat, lng: +state.hereLng } : null;
    var pick = placeCoords("pickup");
    if (!me || !pick) return "";
    return '<p class="fine">Pickup is about ' + esc(fmtMiles(haversine(me, pick))) + " from you (straight line).</p>";
  }

  function openRideCard() {
    if (!state.selectedOpenCode || !state.pickupStreet) return "";
    var est = estimate();
    return (
      '<article class="card open-ride-card" id="open-ride-card">' +
      '<p class="tag">' + (state.isTest ? "TEST request" : "Open request") + "</p>" +
      (state.isTest ? '<p class="tag" style="background:#7a1f1f;color:#fff;">TEST — owner practice only</p>' : "") +
      '<div class="who">' + photoImg(state.riderPhoto) +
      "<div>" +
      '<h2 style="font-size:18px">' + esc(state.name || "Rider") + "</h2>" +
      '<p class="fine">' + esc(prettyWhen()) + (state.phone ? " · " + esc(state.phone) : "") + "</p>" +
      "</div></div>" +
      '<div class="route-line"><p>' + esc(pickupLine()) + "</p>" + stopsSummaryHtml() + "<p>" + esc(dropLine()) + "</p></div>" +
      driverPickupDistanceLine() +
      '<p class="fine">' + (est.ready
        ? est.raw.toFixed(2) + " mi, billed as " + est.billed +
          (state.dropApprox ? " (drop-off is approximate)" : "")
        : (state.dropLookup === "looking"
          ? "Finding the drop-off on the map…"
          : "Drop-off isn't on the map yet. You can still accept and use the address above; your commission is figured at drop-off.")) + "</p>" +
      commissionLine() +
      seatsWarningForRide(state, readDriverAccount()) +
      (state.acceptNotice
        ? '<p class="' + (state.acceptNoticeKind === "busy" ? "note" : "error") + ' accept-notice" id="accept-notice" role="alert">' + esc(state.acceptNotice) + "</p>"
        : "") +
      '<div class="row-actions">' +
      '<button class="btn" type="button" id="accept-ride"' + (state.acceptBusy ? " disabled" : "") + ">" + (state.acceptBusy ? "Accepting…" : "Accept") + "</button>" +
      '<button class="btn secondary" type="button" id="deny-ride"' + (state.acceptBusy ? " disabled" : "") + ">Deny</button>" +
      "</div></article>"
    );
  }

  function driverBoardStatusInner() {
    if (state.openListLoading && !state.openRides.length) {
      return "Looking for open rides…";
    }
    if (state.openListError === "open-denied") {
      return "Open rides could not load. The map still shows your area.";
    }
    if (state.openListError === "pending-approval") {
      return "Your account is pending owner approval before you can accept rides.";
    }
    if (state.openListError) {
      return String(state.openListError);
    }
    if (state.acceptNotice && !state.selectedOpenCode && state.acceptNoticeKind !== "busy") {
      return state.acceptNotice + (state.openRides.length ? " " + state.openRides.length + (state.openRides.length === 1 ? " open ride." : " open rides.") : "");
    }
    if (!state.openRides.length) {
      return "No open rides right now. New rider requests show up on this map.";
    }
    return state.openRides.length +
      (state.openRides.length === 1 ? " open ride" : " open rides") +
      ". Tap a rider pin to review.";
  }

  function driverBoardStatus() {
    return '<p class="lede" id="board-status">' + esc(driverBoardStatusInner()) + "</p>";
  }

  function ingestCustomerRide(ride) {
    if (!ride) return;
    var statusChanged = (ride.status || "") !== (state.rideStatus || "");
    var nextDrop = keptDropFromRide(ride);
    var placesChanged = coordNum(ride.pickupLat) !== coordNum(state.pickupLat) ||
      coordNum(ride.pickupLng) !== coordNum(state.pickupLng) ||
      coordNum(nextDrop && nextDrop.lat) !== coordNum(state.dropLat) ||
      coordNum(nextDrop && nextDrop.lng) !== coordNum(state.dropLng);
    var driverChanged = coordNum(ride.driverLat) !== coordNum(state.driverLat) ||
      coordNum(ride.driverLng) !== coordNum(state.driverLng);
    var codeChanged = !!(ride.code && ride.code !== state.code);
    var identityChanged = (ride.driverName || "") !== (state.driverName || "") ||
      safePhoto(ride.driverPhoto) !== safePhoto(state.driverPhoto) ||
      (ride.driverCarPlate || "") !== (state.driverCarPlate || "") ||
      safePhoto(ride.driverCarPhoto) !== safePhoto(state.driverCarPhoto) ||
      String(ride.driverCarYear || "") !== String(state.driverCarYear || "") ||
      String(ride.driverCarMake || "") !== String(state.driverCarMake || "") ||
      String(ride.driverCarModel || "") !== String(state.driverCarModel || "") ||
      String(ride.driverCarSeats || "") !== String(state.driverCarSeats || "");
    var cardChanged = (ride.cardStatus || "") !== (state.cardStatus || "");
    if (!statusChanged && !placesChanged && !driverChanged && !codeChanged && !identityChanged && !cardChanged) return;
    var screen = state.screen;
    applyRide(ride);
    if (screen === "waiting" && (ride.status === "accepted" || ride.status === "started" || ride.status === "completed")) state.screen = "trip";
    if ((ride.status === "accepted" || ride.status === "started" || ride.status === "completed") && state.screen !== "trip") state.screen = "trip";
    if (String(ride.status || "").toLowerCase() === "completed" || String(ride.status || "").toLowerCase() === "cancelled" || String(ride.status || "").toLowerCase() === "denied") {
      rememberRiderHistoryEntry(ride);
    }
    if (String(ride.status || "").toLowerCase() === "accepted") loadChatMessages();
    var onlyDriver = !statusChanged && !placesChanged && !identityChanged && !cardChanged && driverChanged && state.screen === screen;
    if (onlyDriver && carMarker && isCoord(state.driverLat) && isCoord(state.driverLng)) {
      carMarker.setLatLng([+state.driverLat, +state.driverLng]);
      refreshDriverEtaDom();
      return;
    }
    render();
  }

  function pullRemoteRide() {
    if (!syncOn() || ROLE !== "customer") return;
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    var code = state.code;
    if (!code) {
      var local = currentRide();
      code = local && local.code;
    }
    if (!code) return;
    getRide(code).then(function (ride) {
      if (!ride) return;
      if (ROLE !== "customer") return;
      if (state.screen !== "waiting" && state.screen !== "trip") return;
      if ((state.screen === "waiting" || state.screen === "trip") && state.code && ride.code && ride.code !== state.code) return;
      var local = currentRide() || {};
      var localPin = normalizeStoredPin(local.pin) || normalizeStoredPin(state.pin) || recalledPin(ride.code || code);
      if (localPin) ride.pin = localPin; /* keep local-only; do not push plaintext pin */
      if (ride.pinHash) state.pinHash = ride.pinHash;
      /* v52: no longer pre-set state.rideStatus = "denied" here; that hid the change from ingestCustomerRide,
         so the rider screen never refreshed to "denied" (stuck on the old Cancel ride card until a reload). */
      try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (err) {}
      if (!isActiveStatus(ride.status)) clearActiveMark(ride.code || code);
      ingestCustomerRide(ride);
    }).catch(function () {});
  }

  function openDriverCode(code, opts) {
    var keepOnMiss = opts && opts.keepLocal;
    var seq = ++rideLookup;
    state.remoteLoading = true;
    state.codeError = "";
    getRide(code).then(function (ride) {
      if (seq !== rideLookup) return;
      state.remoteLoading = false;
      if (!ride) {
        writeDriverCode("");
        state.driverCode = "";
        state.codeDraft = code;
        state.codeError = "That code was not found.";
        clearRideFields();
        state.screen = "home";
        render();
        return;
      }
      if (!ride.code) ride.code = code;
      writeDriverCode(code);
      state.driverCode = code;
      state.codeDraft = code;
      state.codeError = "";
      rememberRemote(ride);
      state.screen = "home";
      render();
    }).catch(function () {
      if (seq !== rideLookup) return;
      state.remoteLoading = false;
      if (!keepOnMiss) {
        render();
        return;
      }
      var local = currentRide();
      if (local && (!local.code || local.code === code)) {
        if (!local.code) local.code = code;
        writeDriverCode(code);
        state.driverCode = code;
        state.codeDraft = code;
        rememberRemote(local);
      }
      render();
    });
  }


  function sessionKey() {
    return ROLE === "driver" ? "pcs-driver-session" : "pcs-rider-session";
  }

  function readSession() {
    try { return localStorage.getItem(sessionKey()) || ""; } catch (err) { return ""; }
  }

  function writeSession(username) {
    try {
      if (username) localStorage.setItem(sessionKey(), username);
      else localStorage.removeItem(sessionKey());
    } catch (err) {}
  }

  function signedIn() {
    var a = pcsAuth();
    if (a && a.hasConfig && a.hasConfig()) {
      return !!(a.currentUser && a.currentUser());
    }
    return !!readSession();
  }

  function readRideOwner() {
    try { return localStorage.getItem(RIDE_OWNER) || ""; } catch (err) { return ""; }
  }

  function writeRideOwner(key) {
    try {
      if (key) localStorage.setItem(RIDE_OWNER, key);
      else localStorage.removeItem(RIDE_OWNER);
    } catch (err) {}
  }

  function rideBelongsToSession(ride) {
    if (!ride) return false;
    var session = readSession();
    if (!session) return false;
    var owner = readRideOwner();
    if (owner) return owner === session;
    // Legacy rides saved before owner stamping stay on this phone for the current session.
    return true;
  }

  function discardStoredRide() {
    try { localStorage.removeItem(STORE); } catch (err) {}
    writeRideOwner("");
    clearRideFields();
  }

  function maybeRestoreCustomerRide() {
    if (ROLE === "driver" || !signedIn()) return false;
    var savedRide = currentRide();
    if (!savedRide) return false;
    if (!rideBelongsToSession(savedRide)) {
      discardStoredRide();
      return false;
    }
    if (savedRide.pickupStreet && savedRide.dropStreet &&
        (savedRide.status === "requested" || savedRide.status === "pending_owner" ||
         savedRide.status === "denied" || savedRide.status === "accepted" ||
         savedRide.status === "started" || savedRide.status === "completed")) {
      if ((savedRide.status === "requested" || savedRide.status === "pending_owner" || savedRide.status === "denied") &&
          !rideIsAsap(savedRide) && isPickupInPast(savedRide.date, savedRide.time) && !readActiveMark()) {
        discardStoredRide();
        state.screen = "home";
        return false;
      }
      applyRide(savedRide);
      ensureRidePin();
      if (savedRide.status === "completed" || savedRide.status === "accepted" || savedRide.status === "started") {
        state.screen = "trip";
      } else {
        state.screen = "waiting";
      }
      return true;
    }
    return false;
  }

  function accountForRole() {
    return ROLE === "driver" ? readDriverAccount() : readRiderAccount();
  }

  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  /* ---- v46: roster-backed driver login (temporary, until Firebase Auth keys are set) ---- */
  function rosterIdsForEmail(email) {
    var e = String(email || "").trim().toLowerCase();
    var a = e.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    var b = e.replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    return a === b ? [a] : [a, b];
  }

  function fetchRosterByEmail(email) {
    var ids = rosterIdsForEmail(email).filter(Boolean);
    var e = String(email || "").trim().toLowerCase();
    function next(i) {
      if (i >= ids.length) return Promise.resolve(null);
      return authFetch(rosterUrl(ids[i])).then(function (res) {
        if (res.status === 404) return "";
        if (!res.ok) throw new Error("roster");
        return res.text();
      }).then(function (text) {
        var row = null;
        if (text && text !== "null") { try { row = JSON.parse(text); } catch (err) { row = null; } }
        if (row && typeof row === "object" && (!row.email || String(row.email).trim().toLowerCase() === e)) {
          if (!row.email) row.email = e;
          return { id: ids[i], row: row };
        }
        return next(i + 1);
      });
    }
    return next(0);
  }

  function bytesToHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function hexToBytes(hex) {
    hex = String(hex || "");
    var out = new Uint8Array(Math.floor(hex.length / 2));
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  var ROSTER_PW_ITER = 100000;

  function pbkdf2Hex(password, saltHex, iter) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]).then(function (key) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: iter || ROSTER_PW_ITER }, key, 256);
    }).then(bytesToHex);
  }

  function rosterPasswordOk(row, password) {
    if (row && row.pwHash && row.pwSalt) {
      return pbkdf2Hex(password, row.pwSalt, Number(row.pwIter) || ROSTER_PW_ITER).then(function (hex) { return hex === row.pwHash; });
    }
    if (row && row.passwordHash) {
      return sha256Hex(password).then(function (hex) { return hex === row.passwordHash; });
    }
    return Promise.resolve(false);
  }

  function writeRosterPassword(id, password) {
    /* Password fields only: never approvalStatus / active / commissionPct. Salted PBKDF2, never plain. */
    var salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    var saltHex = bytesToHex(salt);
    return pbkdf2Hex(password, saltHex, ROSTER_PW_ITER).then(function (hex) {
      return authFetch(rosterUrl(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pwHash: hex, pwSalt: saltHex, pwIter: ROSTER_PW_ITER, pwAlgo: "pbkdf2-sha256", pwSetAt: Date.now() })
      });
    }).then(function (res) {
      if (res && !res.ok) throw new Error("roster-pw");
    });
  }

  function backfillRosterPassword(email, password) {
    /* After a good on-phone login, store a salted hash on the roster row if none exists yet,
       so the same driver can log in from the Home Screen app or another phone. */
    if (ROLE !== "driver" || !syncOn()) return;
    fetchRosterByEmail(email).then(function (found) {
      if (!found || found.row.pwHash || found.row.passwordHash) return;
      return writeRosterPassword(found.id, password);
    }).catch(function () {});
  }

  function saveRosterAccountLocally(row, password, prev) {
    return sha256Hex(password).then(function (hex) {
      var email = String(row.email || "").trim().toLowerCase();
      var keep = prev && String(prev.email || "").trim().toLowerCase() === email ? prev : {};
      var account = Object.assign({}, keep, {
        name: row.name || keep.name || "",
        phone: row.phone || keep.phone || "",
        email: email,
        passwordHash: hex
      });
      ["carYear", "carMake", "carModel", "carPlate", "carSeats"].forEach(function (k) {
        if (row[k] != null && row[k] !== "" && (account[k] == null || account[k] === "")) account[k] = row[k];
      });
      /* v50: never drop the saved car details / photos here (keep = same-email account on this device). */
      try { localStorage.setItem("pcs-driver-account", JSON.stringify(account)); } catch (err) {}
      return account;
    });
  }

  function welcomeSrc(file) {
    return (ROLE === "driver" ? "../" : "") + file;
  }

  function accountGate() {
    return (
      '<img class="welcome-logo" alt="Private Car Services" src="' + welcomeSrc(ROLE === "driver" ? "welcome-logo-driver.png" : "welcome-logo.png") + '">' +
      '<form id="login-form" autocomplete="off" novalidate>' +
      '<label for="login-email">Email</label>' +
      '<input id="login-email" name="email" type="email" autocapitalize="none" autocomplete="email" spellcheck="false" required value="' + esc(state.loginSetupDraft || "") + '">' +
      '<label for="login-pass">Password</label>' +
      '<input id="login-pass" name="password" type="password" autocomplete="current-password" required>' +
      (state.loginSetupEmail
        ? '<label for="login-confirm">Confirm password</label>' +
          '<input id="login-confirm" name="confirm" type="password" autocomplete="new-password">'
        : "") +
      '<p class="error" id="login-error" role="alert">' + esc(state.loginError || "") + "</p>" +
      '<p class="fine">' + (function () {
        var a = pcsAuth();
        if (a && a.hasConfig && a.hasConfig()) {
          return "Accounts use Firebase Auth (email + password).";
        }
        return "Temporary login: uses the account saved on this phone, or your driver roster record, until Firebase Auth keys are finished.";
      })() + "</p>" +
      '<button class="btn" type="submit">Log in</button>' +
      "</form>" +
      '<a class="btn secondary" href="signup/?v=24">Create an account</a>'
    );
  }

  function logoutLine() {
    return '<button class="btn ghost" type="button" id="log-out">Log out</button>';
  }

  function accountNav() {
    if (ROLE === "driver") {
      return (
        '<div class="app-nav">' +
        '<button class="btn ghost home-btn" type="button" id="open-hub" aria-label="Home menu">Home</button>' +
        "</div>"
      );
    }
    return '<div class="app-nav">' + logoutLine() + "</div>";
  }

  function customerHome() {
    var openRide = activeRiderRide();
    if (openRide) return activeRideHomeCard(openRide);
    if (!state.asap && isPickupInPast(state.date, state.time)) {
      state.date = "";
      state.time = "";
    }
    var whenSchedule = !state.asap;
    var scheduleFields = whenSchedule
      ? ('<div class="row when-schedule-fields" id="when-schedule-fields"><div class="city">' +
        field("ride-date", "Date", state.date, 'type="date" min="' + chicagoParts(new Date()).date + '"') +
        '</div><div class="city">' +
        field("ride-time", "Time", state.time, 'type="time"') +
        "</div></div>")
      : "";
    return (
      '<div class="app-nav">' +
      '<button class="btn ghost" type="button" id="open-history">History</button>' +
      logoutLine() + "</div>" +
      (state.notice ? '<p class="note notice-ok" role="status">' + esc(state.notice) + "</p>" : "") +
      "<h2>Request a ride</h2>" +
      "<p class=\"lede\">Request goes to Private Car Services for confirmation. Card charges are not taken on this screen.</p>" +
      (testModeAvailable()
        ? ('<div class="card" style="border:1px solid #7a1f1f;">' +
           '<label><input type="checkbox" id="test-ride-toggle"' + (state.isTest ? " checked" : "") + '> <strong>TEST MODE</strong> — practice only, PIN 0001, no charge, not shown to other drivers</label></div>')
        : "") +
      (state.isTest ? testBannerHtml() : "") +
      "<form id=\"ride-form\" autocomplete=\"off\">" +
      addrBlockHtml("pickup", "From", { locate: true, required: true }) +
      addrBlockHtml("drop", "To", { required: true }) +
      stopsHtml() +
      '<div class="group"><p class="group-title">When</p>' +
      '<div class="when-modes" role="tablist" aria-label="Pickup time">' +
      '<button type="button" role="tab" id="when-asap" aria-selected="' + (state.asap ? "true" : "false") + '">ASAP</button>' +
      '<button type="button" role="tab" id="when-schedule" aria-selected="' + (whenSchedule ? "true" : "false") + '">Schedule</button>' +
      "</div>" +
      (state.asap ? '<p class="fine when-asap-hint">Pickup as soon as a driver accepts.</p>' : "") +
      scheduleFields +
      "</div>" +
      '<div class="group"><p class="group-title">Trip type</p>' +
      '<label for="trip-type">Base fare</label>' +
      '<select id="trip-type" name="trip-type">' +
      '<option value="auto"' + (state.tripType === "auto" || !state.tripType ? " selected" : "") + ">Auto (detect airport from addresses)</option>" +
      '<option value="local"' + (state.tripType === "local" ? " selected" : "") + ">Local</option>" +
      '<option value="airport-drop"' + (state.tripType === "airport-drop" ? " selected" : "") + ">Airport drop-off</option>" +
      '<option value="airport-pick"' + (state.tripType === "airport-pick" ? " selected" : "") + ">Airport pick-up</option>" +
      "</select>" +
      '<p class="fine">Airport bases match the estimator: pick-up and drop-off differ by time of day.</p>' +
      "</div>" +
      '<div class="group"><p class="group-title">Rider</p>' +
      field("rider-name", "Name", state.name, "required") +
      field("rider-phone", "Phone", state.phone, 'type="tel" inputmode="tel" required') +
      "</div>" +
      '<p class="note">Miles round up to the next whole mile. Texas tax is 8.25% and is estimate-only, not a charge.</p>' +
      paymentInfoCopy() +
      '<p class="fine">Cancel before pickup: a fee of 25% of the estimate or $10 (whichever is more) may apply. Automatic charging is not live yet.</p>' +
      '<p class="error" id="form-error" role="alert">' + esc(state.error) + "</p>" +
      '<button class="btn" type="submit">Request this ride</button>' +
      "</form>" +
      '<p class="fine">After you request, the owner confirms the booking before drivers see it. Call 936-261-7878 if you need help.</p>'
    );
  }

  function moneyCard() {
    var est = estimate();
    if (!est.ready) {
      return (
        '<div class="card">' +
        '<p class="tag">Estimate only · not a charge</p>' +
        '<p class="fine">Not a charge. Miles and the fare show when both places are found.</p>' +
        "</div>"
      );
    }
    var noticeNote = est.notice
      ? " Includes 25% for under 24 hours' notice."
      : "";
    var baseName = est.baseLabel || "Local base";
    return (
      '<div class="card">' +
      '<p class="tag">' + (state.rideStatus === "completed" ? "Final fare · not a charge" : "Estimate only · not a charge") + "</p>" +
      '<div class="money-row"><span>' + esc(baseName) + "</span><span>" + money(est.base) + "</span></div>" +
      '<div class="money-row"><span>Mileage (' + est.billed + " mi × " + money(est.perMileCents) + ")</span><span>" + money(est.mileage) + "</span></div>" +
      (est.notice ? '<div class="money-row"><span>Under 24 hours notice (+25%)</span><span>' + money(est.notice) + "</span></div>" : "") +
      '<div class="money-row"><span>Miles</span><span>' + est.raw.toFixed(2) + " mi, billed as " + est.billed + " (rounded up)</span></div>" +
      '<div class="money-row"><span>Fare before tax</span><span>' + money(est.sub) + "</span></div>" +
      '<div class="money-row"><span>Texas tax 8.25%</span><span>' + money(est.tax) + "</span></div>" +
      '<div class="total-row"><span>' + (state.rideStatus === "completed" ? "Final total" : "Estimated total") + "</span><span>" + money(est.total) + "</span></div>" +
      '<p class="fine">Not a charge. ' + esc(est.tierLabel) + " · " + esc(baseName) + " " + money(est.base) +
      " (includes 2 passengers)." + noticeNote + "</p>" +
      "</div>"
    );
  }

  function mapBlock(youLabel) {
    var route = routePoints();
    var pickup = project(route.pickup);
    var drop = project(route.dropoff);
    var start = project(route.driver);
    var roadAttr = "";
    if (route.live) {
      roadAttr = routeLatLngs(route.pickup, route.dropoff).map(function (ll) {
        var pt = project({ lat: ll[0], lng: ll[1] });
        return pt.x + "," + pt.y;
      }).join(" ");
      if (roadAttr) roadAttr = start.x + "," + start.y + " " + roadAttr;
    }
    return (
      '<div class="map-stage">' +
      '<div id="live-map" role="img" aria-label="' + (route.live ? "Route map" : "Sample map") + '"></div>' +
      '<div class="illus" id="illus">' +
      illustratedMap(start, pickup, drop, roadAttr) +
      pin("pin-pickup", "pin-you", youLabel, pickup) +
      pin("pin-drop", "pin-drop", "Drop-off", drop) +
      '<div class="pin pin-car" id="pin-car" style="left:' + start.x + '%;top:' + start.y + '%"><div class="car-face" id="illus-car">' + CAR_SVG + "</div></div>" +
      "</div>" +
      '<p class="map-caption">' + (isFinite(state.hereLat) && route.live ? "You, pickup, and drop-off" : (route.live ? "Your route" : "Sample map")) + "</p>" +
      "</div>" +
      '<p class="legend"><span><i class="swatch"></i> ' + (isFinite(state.hereLat) ? "You" : "Sample car") + "</span>" +
      '<span><i class="swatch you"></i> ' + esc(youLabel) + "</span>" +
      '<span><i class="swatch drop"></i> Drop-off</span></p>'
    );
  }

  function pin(id, kind, label, point) {
    return (
      '<div class="pin ' + kind + '" id="' + id + '" style="left:' + point.x + "%;top:" + point.y + '%">' +
      '<span class="pin-label">' + esc(label) + "</span>" +
      '<span class="pin-head"></span></div>'
    );
  }

  function illustratedMap(start, pickup, drop, roadAttr) {
    var grid = "";
    var i;
    for (i = 1; i < 8; i += 1) {
      var p = i * 12.5;
      grid += '<line x1="' + p + '" y1="0" x2="' + p + '" y2="100" stroke="#2a5278" stroke-width="0.35"/>';
      grid += '<line x1="0" y1="' + p + '" x2="100" y2="' + p + '" stroke="#2a5278" stroke-width="0.35"/>';
    }
    return (
      '<svg class="illus-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="100" height="100" fill="#163455"/>' +
      '<path d="M0 22 C 18 18, 28 32, 46 28 S 78 18, 100 26 L 100 34 C 76 28, 62 40, 44 36 S 16 30, 0 32 Z" fill="#1d4d66"/>' +
      '<circle cx="72" cy="78" r="10" fill="#1c4a38"/>' +
      grid +
      '<polyline points="' + (roadAttr || (start.x + "," + start.y + " " + pickup.x + "," + pickup.y + " " + drop.x + "," + drop.y)) +
      '" fill="none" stroke="#e7c56a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>"
    );
  }

  function fitProject(point, points) {
    var lats = points.map(function (p) { return p.lat; });
    var lngs = points.map(function (p) { return p.lng; });
    var minLat = Math.min.apply(null, lats);
    var maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs);
    var maxLng = Math.max.apply(null, lngs);
    var padLat = Math.max((maxLat - minLat) * 0.35, 0.01);
    var padLng = Math.max((maxLng - minLng) * 0.35, 0.01);
    minLat -= padLat;
    maxLat += padLat;
    minLng -= padLng;
    maxLng += padLng;
    return {
      x: ((point.lng - minLng) / (maxLng - minLng)) * 100,
      y: ((maxLat - point.lat) / (maxLat - minLat)) * 100
    };
  }

  function customerMapBlock(caption, driverPoint) {
    var pickup = placeCoords("pickup");
    var drop = placeCoords("drop");
    var both = !!(pickup && drop);
    var points = [];
    if (pickup) points.push(pickup);
    if (drop) points.push(drop);
    if (driverPoint) points.push(driverPoint);
    var road = both ? routeLatLngs(pickup, drop) : [];
    road.forEach(function (ll) { points.push({ lat: ll[0], lng: ll[1] }); });
    var illus = "";
    if (both) {
      var a = fitProject(pickup, points);
      var b = fitProject(drop, points);
      var poly = road.map(function (ll) {
        var pt = fitProject({ lat: ll[0], lng: ll[1] }, points);
        return pt.x + "," + pt.y;
      }).join(" ");
      var car = "";
      if (driverPoint) {
        var c = fitProject(driverPoint, points);
        car = '<div class="pin pin-car" id="pin-car" style="left:' + c.x + '%;top:' + c.y + '%"><div class="car-face" id="illus-car">' + CAR_SVG + "</div></div>";
      }
      illus = (
        '<div class="illus" id="illus">' +
        '<svg class="illus-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
        '<rect width="100" height="100" fill="#163455"/>' +
        '<polyline points="' + poly +
        '" fill="none" stroke="#e7c56a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>" +
        pin("pin-pickup", "pin-you", "Pickup", a) +
        pin("pin-drop", "pin-drop", "Drop-off", b) +
        car +
        "</div>"
      );
    }
    var legend = both
      ? '<p class="legend"><span><i class="swatch you"></i> Pickup</span><span><i class="swatch drop"></i> Drop-off</span>' +
        (driverPoint ? '<span><i class="swatch"></i> Your driver</span>' : "") + "</p>"
      : "";
    return (
      '<div class="map-stage">' +
      '<div id="live-map" role="img" aria-label="' + (both ? "Route map" : "Sample map") + '"></div>' +
      illus +
      '<p class="map-caption">' + esc(caption) + "</p>" +
      "</div>" +
      legend
    );
  }

  function customerTrip() {
    var testTop = testBannerHtml();
    var both = !!(placeCoords("pickup") && placeCoords("drop"));
    var driver = savedDriverPoint();
    var caption = !both
      ? "Your route"
      : (driver ? "Your driver" : "Driver location shows once they accept on a linked phone.");
    var near = driverNearPickup();
    var started = state.rideStatus === "started";
    var completed = state.rideStatus === "completed";
    return (
      testTop +
      riderBackButton() +
      (completed
        ? '<div class="status"><i></i><span>Ride complete</span></div>'
        : (started
          ? '<div class="status"><i></i><span>Ride started</span></div>'
          : waitingStatusBlock(near || state.driverName ? "Driver on the way" : "Drivers are available"))) +
      driverIdentityLine() +
      driverEtaLine() +
      (state.rideStatus === "accepted" && syncOn() && navigator.geolocation
        ? '<p class="fine" id="rider-share-note">&#128205; Sharing your location with your driver until pickup so they can find you.</p>'
        : "") +
      routeLedeHtml() +
      (started || completed ? "" : riderStageNote() + riderPinBanner()) +
      (started || completed ? "" : chatBoxHtml()) +
      customerMapBlock(caption, driver) +
      moneyCard() +
      (completed
        ? '<div class="card payment-card"><p class="tag">Pay after the ride</p>' +
          '<p class="lede">' + esc(state.isTest || state.cardStatus === "test_skip" || state.paymentSkipped
            ? "Test ride: no charge."
            : (state.cardStatus === "on_file"
              ? "Your card on file is charged after drop-off, so you can add a tip."
              : "Private Car Services will text your receipt and a secure payment link.")) + "</p>" +
          "</div>"
        : "") +
      (started || completed ? "" : paymentStatusCard()) +
      cancelBlockHtml() +
      (started
        ? '<p class="fine">This ride has started. Only your driver can complete or end it.</p>'
        : "") +
      '<p class="note">A live request would text ' + BUSINESS_PHONE + ". This button does not open Messages and does not send anything.</p>" +
      '<button class="btn" type="button" id="preview-only">Preview only</button>'
    );
  }

  function customerWaiting() {
    var testTop = testBannerHtml();
    var both = !!(placeCoords("pickup") && placeCoords("drop"));
    var driver = savedDriverPoint();
    var caption = !both ? "Your route" : (driver ? "Your driver" : "Your route");
    var st = String(state.rideStatus || "").toLowerCase();
    var note = st === "cancelled"
      ? "This ride was cancelled. Tap ← Book a new ride to request again, or call " + BUSINESS_PHONE + "."
      : st === "pending_owner"
      ? "Your request was saved. Private Car Services must confirm it before drivers can accept."
      : (st === "denied"
        ? "This booking was declined. Call " + BUSINESS_PHONE + " or request a different time."
        : (syncOn()
          ? "This screen changes when a driver accepts."
          : "Open the driver app and accept this ride. This screen changes when a driver accepts."));
    var near = driverNearPickup();
    var waitLabel = st === "denied"
      ? "Booking declined"
      : (st === "pending_owner"
        ? "Waiting for confirmation"
        : (near ? "Waiting for a driver" : (driversOnlineNow().length ? "Drivers are available" : "Waiting for a driver")));
    var statusHtml = st === "denied"
      ? '<div class="status"><i></i><span>Booking declined</span></div>'
      : (st === "cancelled"
        ? '<div class="status"><i></i><span>Ride cancelled</span></div>'
        : waitingStatusBlock(waitLabel));
    var live = st !== "denied" && st !== "cancelled";
    return (
      riderBackButton() +
      statusHtml +
      driverIdentityLine() +
      driverEtaLine() +
      routeLedeHtml() +
      testTop + (live ? riderStageNote() + riderPinBanner() : "") +
      customerMapBlock(caption, driver) +
      moneyCard() +
      (live ? paymentStatusCard() : "") +
      '<p class="note">' + esc(note) + "</p>" +
      cancelBlockHtml()
    );
  }

  function applyRide(ride) {
    if (!ride) return;
    state.name = ride.name || "";
    state.phone = ride.phone || "";
    state.pickupStreet = ride.pickupStreet || "";
    state.pickupCity = ride.pickupCity || "";
    state.pickupState = ride.pickupState || "TX";
    state.dropStreet = ride.dropStreet || "";
    state.dropCity = ride.dropCity || "";
    state.dropState = ride.dropState || "TX";
    state.pickupLine2 = ride.pickupLine2 || "";
    state.pickupZip = ride.pickupZip || "";
    state.pickupPinned = !!ride.pickupPinned;
    state.dropLine2 = ride.dropLine2 || "";
    state.dropZip = ride.dropZip || "";
    state.dropPinned = !!ride.dropPinned;
    state.dropApprox = ride.dropApprox || "";
    state.dropFound = ride.dropFound || "";
    state.stopList = normalizeStops(ride.stopList);
    state.cardStatus = ride.cardStatus || "";
    state.cardLast4 = ride.cardLast4 || "";
    state.cardBrand = ride.cardBrand || "";
    state.paymentStatus = ride.paymentStatus || "";
    state.paidCents = Number(ride.paidCents) || 0;
    state.receiptUrl = ride.receiptUrl || "";
    if (state.cardStatus === "test_skip") state.paymentSkipped = true;
    state.asap = rideIsAsap(ride);
    if (!state.asap && ride.date && ride.time && isPickupInPast(ride.date, ride.time)) {
      state.date = "";
      state.time = "";
    } else {
      state.date = ride.date || state.date;
      state.time = (state.asap && String(ride.time || "").toLowerCase() === "asap") ? "" : (ride.time || state.time);
      if (state.asap && (!state.date || !state.time || String(state.time).toLowerCase() === "asap")) {
        var nowAsap = chicagoParts(new Date());
        if (!state.date) state.date = nowAsap.date;
        if (!state.time || String(state.time).toLowerCase() === "asap") state.time = nowAsap.time;
      }
    }
    state.rideStatus = ride.status || "";
    state.pickupLat = ride.pickupLat;
    state.pickupLng = ride.pickupLng;
    var keptDrop = keptDropFromRide(ride);
    state.dropLat = keptDrop ? keptDrop.lat : ride.dropLat;
    state.dropLng = keptDrop ? keptDrop.lng : ride.dropLng;
    state.driverLat = isCoord(ride.driverLat) ? +ride.driverLat : null;
    state.driverLng = isCoord(ride.driverLng) ? +ride.driverLng : null;
    state.driverName = ride.driverName || "";
    state.driverPhone = ROLE === "driver" ? (ride.driverPhone || "") : ""; /* v51: never kept on the rider app */
    state.riderPhoto = safePhoto(ride.riderPhoto);
    state.driverPhoto = safePhoto(ride.driverPhoto);
    state.driverCarYear = ride.driverCarYear || "";
    state.driverCarMake = ride.driverCarMake || "";
    state.driverCarModel = ride.driverCarModel || "";
    state.driverCarPlate = normalizePlate(ride.driverCarPlate || "");
    state.driverCarSeats = ride.driverCarSeats || "";
    state.driverCarPhoto = safePhoto(ride.driverCarPhoto);
    if (ride.passengers != null) state.passengers = ride.passengers;
    if (ride.stops != null) state.stops = ride.stops;
    state.holiday = !!ride.holiday;
    if (ride.code) state.code = ride.code;
    var incomingPin = normalizeStoredPin(ride.pin);
    if (incomingPin) state.pin = incomingPin;
    if (ride.pinHash) state.pinHash = ride.pinHash;
    state.isTest = !!ride.isTest;
    if (state.isTest) {
      state.pin = TEST_PIN;
      state.paymentSkipped = true;
    }
  }

  function currentRide() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "null");
    } catch (err) {
      return null;
    }
  }

  function saveRide(status, opts) {
    state.rideStatus = status;
    var prev = currentRide() || {};
    var clearDriver = opts && opts.clearDriver;
    var driverLat = isCoord(state.driverLat) ? +state.driverLat : null;
    var driverLng = isCoord(state.driverLng) ? +state.driverLng : null;
    var driverName = state.driverName || "";
    var driverPhone = state.driverPhone || "";
    var driverPhoto = safePhoto(state.driverPhoto);
    var driverCarYear = state.driverCarYear || "";
    var driverCarMake = state.driverCarMake || "";
    var driverCarModel = state.driverCarModel || "";
    var driverCarPlate = normalizePlate(state.driverCarPlate || "");
    var driverCarSeats = state.driverCarSeats || "";
    var driverCarPhoto = safePhoto(state.driverCarPhoto);
    var riderPhoto = safePhoto(state.riderPhoto);
    if (clearDriver) {
      driverName = "";
      driverPhone = "";
      driverPhoto = "";
      driverCarYear = "";
      driverCarMake = "";
      driverCarModel = "";
      driverCarPlate = "";
      driverCarSeats = "";
      driverCarPhoto = "";
    } else {
      if (!driverName && prev.driverName) driverName = prev.driverName;
      if (!driverPhone && prev.driverPhone) driverPhone = prev.driverPhone;
      if (ROLE === "customer") driverPhone = "";
      if (!driverPhoto) driverPhoto = safePhoto(prev.driverPhoto);
      if (!driverCarYear && prev.driverCarYear) driverCarYear = prev.driverCarYear;
      if (!driverCarMake && prev.driverCarMake) driverCarMake = prev.driverCarMake;
      if (!driverCarModel && prev.driverCarModel) driverCarModel = prev.driverCarModel;
      if (!driverCarPlate && prev.driverCarPlate) driverCarPlate = normalizePlate(prev.driverCarPlate);
      if (!driverCarSeats && prev.driverCarSeats) driverCarSeats = prev.driverCarSeats;
      if (!driverCarPhoto) driverCarPhoto = safePhoto(prev.driverCarPhoto);
    }
    if (ROLE === "customer") {
      var riderAccount = readRiderAccount();
      var fromAccount = safePhoto(riderAccount && riderAccount.photo);
      if (fromAccount) riderPhoto = fromAccount;
    } else if (!riderPhoto) {
      riderPhoto = safePhoto(prev.riderPhoto);
    }
    state.driverName = driverName;
    state.driverPhone = driverPhone;
    state.driverPhoto = driverPhoto;
    state.driverCarYear = driverCarYear;
    state.driverCarMake = driverCarMake;
    state.driverCarModel = driverCarModel;
    state.driverCarPlate = driverCarPlate;
    state.driverCarSeats = driverCarSeats;
    state.driverCarPhoto = driverCarPhoto;
    state.riderPhoto = riderPhoto;
    if (!clearDriver) {
      if (!isCoord(driverLat) && isCoord(prev.driverLat)) driverLat = +prev.driverLat;
      if (!isCoord(driverLng) && isCoord(prev.driverLng)) driverLng = +prev.driverLng;
    }
    var rideOut = {
      name: state.name,
      phone: state.phone,
      pickupStreet: state.pickupStreet,
      pickupCity: state.pickupCity,
      pickupState: state.pickupState,
      dropStreet: state.dropStreet,
      dropCity: state.dropCity,
      dropState: state.dropState,
      pickupLine2: state.pickupLine2 || "",
      pickupZip: state.pickupZip || "",
      pickupAddress: pickupLine(),
      pickupPinned: !!state.pickupPinned,
      dropLine2: state.dropLine2 || "",
      dropZip: state.dropZip || "",
      dropAddress: dropLine(),
      dropPinned: !!state.dropPinned,
      dropApprox: state.dropApprox && state.dropApprox !== "missing" ? state.dropApprox : "",
      dropFound: state.dropFound || "",
      stopList: compactStops(),
      cardStatus: state.cardStatus || "",
      cardLast4: state.cardLast4 || "",
      cardBrand: state.cardBrand || "",
      paymentStatus: state.paymentStatus || "",
      paidCents: state.paidCents || 0,
      receiptUrl: state.receiptUrl || "",
      date: state.date,
      time: state.time,
      asap: !!state.asap,
      when: state.asap ? "asap" : prettyWhen(),
      status: status,
      pickupLat: state.pickupLat,
      pickupLng: state.pickupLng,
      dropLat: state.dropLat,
      dropLng: state.dropLng,
      driverLat: driverLat,
      driverLng: driverLng,
      driverName: driverName,
      driverPhone: driverPhone,
      driverPhoto: driverPhoto,
      driverCarYear: driverCarYear,
      driverCarMake: driverCarMake,
      driverCarModel: driverCarModel,
      driverCarPlate: driverCarPlate,
      driverCarSeats: driverCarSeats,
      driverCarPhoto: driverCarPhoto,
      riderPhoto: riderPhoto,
      passengers: ridePassengers(),
      stops: rideStops(),
      holiday: !!state.holiday
    };
    if (state.code) rideOut.code = state.code;
    var pinOut = normalizeStoredPin(state.pin);
    if (pinOut) {
      state.pin = pinOut;
      rideOut.pin = pinOut;
    }
    if (state.pinHash) rideOut.pinHash = state.pinHash;
    rideOut.isTest = !!state.isTest;
    if (rideOut.isTest) {
      rideOut.pin = TEST_PIN;
      delete rideOut.pinHash;
    }
    localStorage.setItem(STORE, JSON.stringify(rideOut));
    if (ROLE === "customer") writeRideOwner(readSession());
    if (ROLE === "customer" && rideOut.code) {
      if (rideOut.pin) rememberPin(rideOut.code, rideOut.pin);
      if (isActiveStatus(status)) rememberActiveRide(rideOut.code);
      else clearActiveMark(rideOut.code);
    }
  }

  function clearRideFields() {
    state.name = "";
    state.phone = "";
    state.pickupStreet = "";
    state.pickupCity = "";
    state.dropStreet = "";
    state.dropCity = "";
    state.pickupLine2 = "";
    state.pickupZip = "";
    state.pickupPinned = false;
    state.dropLine2 = "";
    state.dropZip = "";
    state.dropPinned = false;
    state.dropApprox = "";
    state.dropFound = "";
    state.stopList = [];
    state.cardStatus = "";
    state.cardLast4 = "";
    state.cardBrand = "";
    state.paymentStatus = "";
    state.paidCents = 0;
    state.receiptUrl = "";
    state.cancelConfirm = false;
    state.cancelBusy = false;
    state.cancelError = "";
    state.date = "";
    state.time = "";
    state.asap = true;
    state.tripType = "auto";
    state.rideStatus = "";
    state.pickupLat = null;
    state.pickupLng = null;
    state.dropLat = null;
    state.dropLng = null;
    state.driverLat = null;
    state.driverLng = null;
    state.driverName = "";
    state.driverPhone = "";
    state.driverPhoto = "";
    state.driverCarYear = "";
    state.driverCarMake = "";
    state.driverCarModel = "";
    state.driverCarPlate = "";
    state.driverCarSeats = "";
    state.driverCarPhoto = "";
    state.riderPhoto = "";
    state.riderLiveLat = null;
    state.riderLiveLng = null;
    state.riderLiveAt = 0;
    state.passengers = 2;
    state.stops = 0;
    state.holiday = false;
    state.code = "";
    state.pin = "";
    state.pinHash = "";
    state.pinDraft = "";
    state.pinError = "";
    state.isTest = false;
    state.dropFix = null;
    state.pickupFromHere = false;
    state.tripPath = [];
    state.useDrivenMiles = false;
    state.endedEarly = false;
  }

  function keptDropFromRide(ride) {
    var incoming = pointFrom(ride && ride.dropLat, ride && ride.dropLng);
    if (state.dropFix && incoming && haversine(state.dropFix, incoming) > 0.25) return state.dropFix;
    return incoming;
  }

  function driverHubMenu() {
    return (
      '<button class="btn ghost" type="button" id="close-hub">← Back to map</button>' +
      "<h2>Home</h2>" +
      '<p class="lede">Keep the map clean. Open today\'s numbers, history, or profile here.</p>' +
      '<button class="btn" type="button" id="hub-today">Today</button>' +
      '<button class="btn secondary" type="button" id="hub-history">Earnings & history</button>' +
      '<a class="btn secondary" href="signup/?v=24">Profile</a>' +
      logoutLine()
    );
  }

  function driverHubToday() {
    var day = chicagoToday();
    var stats = readDayStats(day);
    var comm = state.commHidden ? "••••" : money(stats.commissionCents);
    return (
      '<button class="btn ghost" type="button" id="hub-back-menu">← Home menu</button>' +
      "<h2>Today</h2>" +
      '<p class="fine">' + esc(day) + " · Chicago · pay week Mon–Sun</p>" +
      '<div class="card hub-stats">' +
      '<div class="money-row"><span>Rides requested</span><span>' + esc(String(stats.requested)) + "</span></div>" +
      '<div class="money-row"><span>Rides completed</span><span>' + esc(String(stats.completed)) + "</span></div>" +
      '<div class="money-row"><span>Daily commission</span><span id="hub-comm-value">' + comm + "</span></div>" +
      '<button class="btn ghost" type="button" id="toggle-comm-hide">' +
      (state.commHidden ? "Show commission" : "Hide commission") +
      "</button>" +
      '<p class="fine">Hide when a client is in the car.</p>' +
      "</div>"
    );
  }

  function driverHubHistory() {
    var today = chicagoToday();
    var monday = mondayOfWeek(state.hubDay || today);
    var days = [];
    var i;
    for (i = 0; i < 7; i += 1) days.push(addDaysYmd(monday, i));
    var weekTotalComm = 0;
    var weekTotalRide = 0;
    var cards = days.map(function (d) {
      var stats = readDayStats(d);
      var rides = ridesForDay(d);
      weekTotalComm += stats.commissionCents;
      weekTotalRide += stats.rideTotalCents;
      var label = d === today ? d + " · today" : d;
      return (
        '<button class="btn secondary hub-day-btn" type="button" data-hub-day="' + esc(d) + '">' +
        esc(label) + " · " + rides.length + " rides · " + money(stats.commissionCents) +
        "</button>"
      );
    }).join("");
    return (
      '<button class="btn ghost" type="button" id="hub-back-menu">← Home menu</button>' +
      "<h2>Earnings & history</h2>" +
      '<p class="lede">Pay week ' + esc(monday) + " → " + esc(addDaysYmd(monday, 6)) + " (Mon–Sun)</p>" +
      '<div class="card">' +
      '<div class="money-row"><span>Week ride total</span><span>' + money(weekTotalRide) + "</span></div>" +
      '<div class="money-row"><span>Week commission</span><span>' + money(weekTotalComm) + "</span></div>" +
      "</div>" +
      '<div class="hub-week">' + cards + "</div>" +
      '<div class="row hub-week-nav">' +
      '<button class="btn ghost" type="button" id="hub-week-prev">← Prev week</button>' +
      '<button class="btn ghost" type="button" id="hub-week-next">Next week →</button>' +
      "</div>"
    );
  }

  function driverHubDay() {
    var day = state.hubDay || chicagoToday();
    var rides = ridesForDay(day);
    var stats = readDayStats(day);
    var list;
    if (!rides.length) {
      list = '<p class="fine">No completed rides logged this day.</p>';
    } else {
      list = rides.map(function (r) {
        return (
          '<article class="card">' +
          "<p class=\"tag\">" + esc(r.code || "Ride") + "</p>" +
          "<p><strong>" + esc(r.riderName || "Rider") + "</strong></p>" +
          "<p class=\"fine\">" + esc(r.pickup || "") + " → " + esc(r.drop || "") + "</p>" +
          '<div class="money-row"><span>Ride total</span><span>' + money(r.fareTotal || 0) + "</span></div>" +
          '<div class="money-row"><span>Commission (' + esc(String(r.commissionPct || "")) + "%)</span><span>" +
          money(r.commissionCents || 0) + "</span></div>" +
          (r.billedMiles != null ? '<p class="fine">' + esc(String(r.billedMiles)) + " billed mi</p>" : "") +
          "</article>"
        );
      }).join("");
    }
    return (
      '<button class="btn ghost" type="button" id="hub-back-history">← Week</button>' +
      "<h2>" + esc(day) + "</h2>" +
      '<div class="card">' +
      '<div class="money-row"><span>Ride total</span><span>' + money(stats.rideTotalCents) + "</span></div>" +
      '<div class="money-row"><span>Commission total</span><span>' + money(stats.commissionCents) + "</span></div>" +
      '<div class="money-row"><span>Completed</span><span>' + esc(String(stats.completed)) + "</span></div>" +
      "</div>" + list
    );
  }

  function driverHub() {
    if (state.hubView === "today") return driverHubToday();
    if (state.hubView === "history") return driverHubHistory();
    if (state.hubView === "day") return driverHubDay();
    return driverHubMenu();
  }

  function driverHome() {
    if (state.milesEndPrompt) {
      return (
        '<p class="fine" id="miles-today">' + esc(milesTodayLabel()) + "</p>" +
        milesEndCard()
      );
    }
    if (state.hubOpen) return driverHub();
    var gated = !canGoOnline();
    return (
      accountNav() +
      '<p class="fine" id="miles-today">' + esc(milesTodayLabel()) + "</p>" +
      '<p class="fine" id="rides-count">' + esc(ridesCountLabel()) + "</p>" +
      (state.driverNotice
        ? '<div class="card notice-card" role="status"><p class="lede">' + esc(state.driverNotice) + "</p>" +
          '<button class="btn ghost" type="button" id="dismiss-driver-notice">OK</button></div>'
        : "") +
      approvalGateCard() +
      vehicleNeededCard() +
      milesStartCard() +
      (gated
        ? '<p class="lede">Finish the steps above to go online and see open requests.</p>'
        : (
          "<h2>Open requests</h2>" +
          driverBoardStatus() +
          openRideAlertToggleHtml() +
          '<div class="map-stage board-map">' +
          '<div id="live-map" role="img" aria-label="Open ride requests map"></div>' +
          '<p class="map-caption">You and open rider pickups</p>' +
          "</div>" +
          (isFinite(state.hereLat) ? "" : '<p class="fine">Allow location so the map can show where you are.</p>') +
          '<p class="legend"><span><i class="swatch"></i> You</span>' +
          '<span><i class="swatch you"></i> Rider pickup</span></p>' +
          openRideCard()
        ))
    );
  }

  function driverFareCard(finalLabel) {
    var est = estimate();
    if (!est.ready) {
      return (
        '<div class="card" id="driver-fare-card">' +
        '<p class="tag">' + (finalLabel || "Live commission") + "</p>" +
        '<p class="fine">Miles and commission update when the route is ready.</p></div>'
      );
    }
    /* v53: drivers see miles + their commission (not the rider fare/tax/total). */
    return (
      '<div class="card" id="driver-fare-card">' +
      '<p class="tag">' + (finalLabel || "Live commission · updates with the trip") + "</p>" +
      '<div class="money-row"><span>Miles</span><span data-live-miles>' + est.raw.toFixed(2) + " mi, billed as " + est.billed + "</span></div>" +
      '<div class="total-row"><span>' + (finalLabel ? "Commission" : "Est. commission") + "</span><span data-live-comm>" + money(commissionCentsFor(est) || 0) + "</span></div>" +
      '<p class="fine">' + driverCommissionPct() + "% of the fare before tax and fees. Miles round up. Estimate only · not a payout.</p></div>"
    );
  }

  function driverTrip() {
    var started = state.rideStatus === "started";
    var completed = state.rideStatus === "completed";
    var testTop = testBannerHtml();
    var pinGate = "";
    var dropEditor = "";
    var completeBtn = "";
    var doneBlock = "";
    if (!started && !completed) {
      pinGate = (
        '<div class="card pin-gate">' +
        '<p class="tag">Start the ride</p>' +
        '<p class="lede">' + (state.isTest
          ? "TEST ride — use PIN 0001 to start."
          : "Ask the rider for their 4-digit PIN, then enter it here.") + "</p>" +
        '<form id="start-pin-form" autocomplete="off">' +
        '<label for="start-pin">PIN</label>' +
        '<input id="start-pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" value="' +
        esc(state.pinDraft || "") + '">' +
        '<p class="error" id="pin-error" role="alert">' + esc(state.pinError || "") + "</p>" +
        '<button class="btn" type="submit">Start ride</button>' +
        "</form></div>"
      );
    }
    if (started) {
      dropEditor = (
        '<div class="card">' +
        '<p class="tag">Change drop-off</p>' +
        '<p class="lede">If the rider extends the trip or changes destination, update it here. Fare updates automatically.</p>' +
        locateField("drop-street", "Street", state.dropStreet, "drop-results", "") +
        '<div class="row"><div class="city">' +
        field("drop-city", "City", state.dropCity, "") +
        '</div><div class="state">' +
        field("drop-state", "State", state.dropState || "TX", 'maxlength="2"') +
        "</div></div>" +
        '<button class="btn secondary" type="button" id="end-here">End ride here</button>' +
        '<p class="fine">End ride here uses your current location as the final drop-off and recalculates the fare.</p>' +
        "</div>"
      );
      completeBtn = (
        '<button class="btn" type="button" id="complete-ride">Ride complete</button>'
      );
    }
    if (completed) {
      doneBlock = (
        '<div class="card">' +
        '<p class="tag">Ride complete</p>' +
        '<p class="lede">This trip is finished. Location updates have stopped.</p>' +
        "<p><strong>Final drop-off</strong><br>" + esc(dropLine()) + "</p>" +
        "</div>" +
        driverFareCard("Final commission") +
        '<button class="btn secondary" type="button" id="back-driver">Back to requests</button>'
      );
    }
    var statusLabel = completed ? "Ride complete" : (started ? "Ride started" : "Heading to pickup");
    return (
      testTop +
      (completed ? "" : '<button class="btn ghost" type="button" id="back-driver">← Requests</button>') +
      '<p class="fine" id="miles-today">' + esc(milesTodayLabel()) + "</p>" +
      '<p class="fine" id="rides-count">' + esc(ridesCountLabel()) + "</p>" +
      '<div class="status"><i></i><span>' + statusLabel + "</span></div>" +
      (completed ? "" : navButtonHtml()) +
      '<div class="who">' + photoImg(state.riderPhoto) +
      "<p class=\"lede\">" + esc(state.name || "Rider") +
      (completed ? " · trip finished." : (started ? " · en route." : " is at " + esc(pickupLine()) + ".")) +
      "</p></div>" +
      (completed ? "" : mapBlock("Customer")) +
      pinGate +
      (started || completed ? "" : chatBoxHtml()) +
      (started || completed ? "" : (
        '<div class="card"><p class="tag">This ride</p>' +
        stopsSummaryHtml() +
        "<p><strong>Drop-off</strong><br>" + esc(dropLine()) + "</p>" +
        commissionLine() +
        "<p class=\"fine\">" + esc(prettyWhen()) + ". Miles round up. Texas tax 8.25% stays estimate-only.</p></div>"
      )) +
      (started ? (
        '<div class="card"><p class="tag">This ride</p>' +
        "<p><strong>Pickup</strong><br>" + esc(pickupLine()) + "</p>" +
        stopsSummaryHtml() +
        "<p><strong>Drop-off</strong><br>" + esc(dropLine()) + "</p>" +
        "<p class=\"fine\">" + esc(prettyWhen()) + "</p></div>" +
        driverFareCard("") +
        dropEditor +
        completeBtn
      ) : "") +
      doneBlock
    );
  }

  function render() {
    var stayOnBoard = ROLE === "driver" && state.screen === "home" && signedIn() && !state.hubOpen;
    var keptBoard = null;
    if (stayOnBoard && boardMapStillMounted()) {
      keptBoard = document.querySelector(".map-stage.board-map");
      if (keptBoard && keptBoard.parentNode) {
        keptBoard.parentNode.removeChild(keptBoard);
      } else {
        keptBoard = null;
      }
    }
    if (keptBoard) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      motionStart = 0;
      if (tileTimer) clearTimeout(tileTimer);
      tileTimer = 0;
    } else {
      stopMotion();
      boardMapEl = null;
      state.boardMarkers = null;
    }
    var app = document.getElementById("app");
    var html = "";
    if (!signedIn()) html = accountGate();
    else if (ROLE === "driver" && state.screen === "home") html = driverHome();
    else if (ROLE === "driver") html = driverTrip();
    else if (ROLE === "customer" && state.riderHistoryView === "receipt") html = customerHistoryReceipt();
    else if (ROLE === "customer" && state.riderHistoryView === "list") html = customerHistoryList();
    else if (state.screen === "waiting") html = customerWaiting();
    else if (state.screen === "trip") html = customerTrip();
    else html = customerHome();
    app.innerHTML = html;
    if (keptBoard) {
      var slot = app.querySelector(".map-stage.board-map");
      if (slot && slot.parentNode) {
        slot.parentNode.replaceChild(keptBoard, slot);
        setTimeout(function () {
          if (liveMap) liveMap.invalidateSize();
          syncDriverBoardMarkers();
        }, 60);
      } else {
        try { if (liveMap) liveMap.remove(); } catch (e) {}
        liveMap = null;
        carMarker = null;
        boardMapEl = null;
        state.boardMarkers = null;
        if (keptBoard.parentNode) keptBoard.parentNode.removeChild(keptBoard);
      }
    }
    bind();
    var customerRide = signedIn() && ROLE === "customer" && (state.screen === "waiting" || state.screen === "trip");
    if (!signedIn()) {
      /* stay on the login page */
    } else if (customerRide) {
      startCustomerMap();
      ensureCustomerCoords();
      refreshOnlineDrivers();
    } else if (ROLE === "driver" && state.screen === "home" && !state.hubOpen) {
      startDriverBoardMap();
    } else if (ROLE === "driver" && state.screen === "trip") {
      startMap();
    }
    if (ROLE === "driver" && !driverCanTakeNew()) closeRidePopup();
    if (ROLE === "customer") syncRiderLocationShare();
    if (ROLE === "driver" && state.screen === "trip" && state.pickupStreet) {
      var repairKey = (state.driverCode || state.code || "") + "|" + state.dropStreet;
      if (state.geocodeKey !== repairKey) {
        state.geocodeKey = repairKey;
        var beforeDrop = placeCoords("drop");
        var beforePick = placeCoords("pickup");
        geocodeMissing().then(function () {
          var after = placeCoords("drop");
          var moved = !!(after && beforeDrop && haversine(beforeDrop, after) >= 0.05);
          var filled = !!(!beforeDrop && after) || !!(!beforePick && placeCoords("pickup"));
          if (moved) {
            state.dropFix = { lat: +after.lat, lng: +after.lng };
            saveRide(state.rideStatus || "requested");
            var code = state.driverCode || state.code || readDriverCode();
            if (syncOn() && code) patchRide(code, { dropLat: +after.lat, dropLng: +after.lng }).catch(function () {});
          }
          if (moved || filled) render();
        });
      }
    }
  }

  function readForm() {
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : "";
    }
    addrPrefixes().forEach(readAddr);
    state.stops = filledStops().length;
    if (state.asap) {
      stampAsapNow();
    } else {
      state.date = val("ride-date");
      state.time = val("ride-time");
      state.asap = false;
    }
    state.name = val("rider-name");
    state.phone = val("rider-phone");
    var tripEl = document.getElementById("trip-type");
    if (tripEl) state.tripType = tripEl.value || "auto";
  }

  function formComplete() {
    var whenOk = state.asap || (state.date && state.time);
    if (filledStops().some(function (s) { return !String(s.city || "").trim() || !String(s.state || "").trim(); })) return false;
    return state.pickupStreet && state.pickupCity && state.pickupState &&
      state.dropStreet && state.dropCity && state.dropState &&
      whenOk && state.name && state.phone;
  }

  function bind() {
    var showLogin = document.getElementById("show-login");
    if (showLogin) {
      showLogin.addEventListener("click", function () {
        state.gateStep = "login";
        state.loginError = "";
        render();
      });
    }
    var gateBack = document.getElementById("gate-back");
    if (gateBack) {
      gateBack.addEventListener("click", function () {
        state.gateStep = "";
        state.loginError = "";
        render();
      });
    }
    var loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        state.loginError = "";
        var emailEl = document.getElementById("login-email");
        var passEl = document.getElementById("login-pass");
        var loginEmail = emailEl ? emailEl.value.trim().toLowerCase() : "";
        var password = passEl ? passEl.value : "";
        var a = pcsAuth();
        if (!loginEmail || !password) {
          state.loginError = "Enter email and password.";
          render();
          return;
        }
        function afterLocalLogin(account) {
          writeSession(account.email || account.username || loginEmail);
          state.loginError = "";
          state.gateStep = "";
          state.screen = "home";
          accountSyncTried = true;
          syncAccountProfile(ROLE === "driver" ? "driver" : "rider", account);
          if (ROLE === "driver") {
            /* v50: pull the saved car details + photos from the server (or back them up if only here). */
            syncDriverProfile().then(function () { render(); });
            ensureMilesDayReady();
            followGps();
            loadRideHistory();
            acquireWakeLock();
            refreshRosterStatus().then(function () {
              if (canGoOnline()) {
                refreshOpenRides(true);
                publishDriverPresence();
              }
              refreshScheduledRides(true);
              render();
            });
            return;
          }
          maybeRestoreCustomerRide();
          restoreFromActiveMark();
          render();
        }
        function loginFail(msg) {
          state.loginError = msg;
          render();
        }
        function tryLocalLogin() {
          if (!window.crypto || !crypto.subtle) {
            loginFail("This browser cannot check the password. Try Safari or Chrome.");
            return;
          }
          var account = accountForRole();
          var emailMatches = !!(account && account.email && loginEmail === String(account.email).trim().toLowerCase());
          var legacyUsernameMatches = !!(account && account.username && loginEmail === String(account.username).trim().toLowerCase());
          /* v50: same-email account on this device (kept even if it has no passwordHash, e.g. after the
             Profile page saved it) so a roster login never wipes the car details and photos. */
          var sameAccount = (emailMatches || legacyUsernameMatches) ? account : null;
          var hasLocal = !!(sameAccount && sameAccount.passwordHash);
          if (!hasLocal) {
            /* v46: account not in this app's storage (iOS Home Screen app has separate storage from
               Safari, or another phone). Fall back to the driver roster record. */
            tryRosterLogin(null, sameAccount);
            return;
          }
          sha256Hex(password).then(function (hex) {
            if (hex !== account.passwordHash) {
              /* Password may have been set on another device: check the roster hash if one exists. */
              tryRosterLogin(account, account);
              return;
            }
            if (ROLE === "driver") backfillRosterPassword(loginEmail, password);
            afterLocalLogin(account);
          });
        }
        function tryRosterLogin(localSame, keepAccount) {
          var keep = keepAccount || localSame || null;
          var noAccountMsg = "No driver account found for that email. Tap Create an account first.";
          var mismatchMsg = "That email or password does not match your driver account.";
          if (ROLE !== "driver" || !syncOn()) {
            loginFail(localSame ? "That email or password does not match the account on this phone." : "No account on this phone yet. Create one first (or finish Firebase Auth keys).");
            return;
          }
          fetchRosterByEmail(loginEmail).then(function (found) {
            if (!found) {
              loginFail(localSame ? mismatchMsg : noAccountMsg);
              return;
            }
            var row = found.row;
            var hasHash = !!((row.pwHash && row.pwSalt) || row.passwordHash);
            if (hasHash) {
              return rosterPasswordOk(row, password).then(function (ok) {
                if (!ok) {
                  loginFail(mismatchMsg);
                  return;
                }
                state.loginSetupEmail = "";
                state.loginSetupDraft = "";
                return saveRosterAccountLocally(row, password, keep).then(afterLocalLogin);
              });
            }
            if (localSame) {
              /* Local account exists for this email; roster has no password to override it. */
              loginFail(mismatchMsg);
              return;
            }
            /* First login in this app for a roster driver with no password stored yet:
               confirm the password, then save it on this phone + (salted) to the roster. */
            if (password.length < 8) {
              loginFail("Password must be at least 8 characters.");
              return;
            }
            var confirmEl = document.getElementById("login-confirm");
            var confirmPw = confirmEl ? confirmEl.value : "";
            if (state.loginSetupEmail !== loginEmail || !confirmEl) {
              state.loginSetupEmail = loginEmail;
              state.loginSetupDraft = loginEmail;
              loginFail("Found your driver account" + (row.name ? " (" + row.name + ")" : "") + ". Set your password for this app: type it in Password and again in Confirm password, then tap Log in.");
              return;
            }
            if (confirmPw !== password) {
              loginFail("Password and confirm password must match.");
              return;
            }
            return writeRosterPassword(found.id, password).catch(function () {}).then(function () {
              state.loginSetupEmail = "";
              state.loginSetupDraft = "";
              return saveRosterAccountLocally(row, password, keep).then(afterLocalLogin);
            });
          }).catch(function () {
            loginFail("Could not reach the driver roster. Check signal and try again.");
          });
        }
        if (!a || !a.hasConfig || !a.hasConfig()) {
          tryLocalLogin();
          return;
        }
        a.signInEmailPassword(loginEmail, password).then(function () {
          var account = accountForRole() || {};
          account.email = loginEmail;
          account.uid = firebaseUid();
          if (!account.name) account.name = loginEmail.split("@")[0];
          /* Keep profile cache on device (no passwordHash authority). */
          try {
            var key = ROLE === "driver" ? "pcs-driver-account" : "pcs-rider-account";
            var prev = accountForRole() || {};
            /* v50: another driver's saved account on this device is not merged into this one. */
            if (prev.email && String(prev.email).trim().toLowerCase() !== loginEmail) prev = {};
            var next = Object.assign({}, prev, { email: loginEmail, uid: firebaseUid() });
            delete next.passwordHash;
            localStorage.setItem(key, JSON.stringify(next));
            account = next;
          } catch (err) {}
          writeSession(loginEmail);
          state.loginError = "";
          state.gateStep = "";
          state.screen = "home";
          accountSyncTried = true;
          syncAccountProfile(ROLE === "driver" ? "driver" : "rider", account);
          if (ROLE === "driver") {
            /* v50: pull the saved car details + photos from the server (or back them up if only here). */
            syncDriverProfile().then(function () { render(); });
            ensureMilesDayReady();
            followGps();
            loadRideHistory();
            acquireWakeLock();
            refreshRosterStatus().then(function () {
              if (canGoOnline()) {
                refreshOpenRides(true);
                publishDriverPresence();
              }
              refreshScheduledRides(true);
              render();
            });
            return;
          }
          maybeRestoreCustomerRide();
          restoreFromActiveMark();
          render();
        }).catch(function (err) {
          var msg = a.authErrorMessage ? a.authErrorMessage(err) : "Sign-in failed.";
          var local = accountForRole();
          if (local && local.passwordHash && !local.uid) {
            msg = "This phone has an old on-device account. Create a Firebase account (same email) under Create an account, then log in.";
          }
          state.loginError = msg;
          render();
        });
      });
    }
    var alertToggle = document.getElementById("toggle-ride-alert");
    if (alertToggle) {
      alertToggle.addEventListener("click", function () {
        unlockOpenRideAudio();
        setOpenRideAlertMuted(!openRideAlertMuted());
        syncOpenRideAlert();
        render();
      });
    }
    /* First tap unlocks Web Audio for ride alerts (browser autoplay policy). */
    if (ROLE === "driver") {
      ["accept-ride", "deny-ride", "open-hub", "miles-start-form", "log-out"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener("click", unlockOpenRideAudio, { once: false });
      });
      document.addEventListener("pointerdown", unlockOpenRideAudio, { once: true });
    }
    var testToggle = document.getElementById("test-ride-toggle");
    if (testToggle) {
      testToggle.addEventListener("change", function () {
        if (!testModeAvailable()) {
          state.isTest = false;
          render();
          return;
        }
        if (document.getElementById("ride-form")) readForm();
        state.isTest = !!testToggle.checked;
        if (state.isTest) {
          state.paymentSkipped = true;
          state.pin = TEST_PIN;
        }
        render();
      });
    }
    var logout = document.getElementById("log-out");
    if (logout) {
      logout.addEventListener("click", function () {
        if (ROLE === "driver" && !state.milesNeedStart && todayMilesRow() && !state.milesEndPrompt) {
          clearDriverPresence();
          state.milesEndPrompt = true;
          state.milesEndDraft = "";
          state.milesEndError = "";
          render();
          return;
        }
        finishDriverLogout();
      });
    }
    function finishDriverLogout() {
      stopOpenRideAlert();
      if (ROLE === "driver") {
        var openRow = todayMilesRow();
        if (openRow && Number(openRow.shiftStartAt) > 0) {
          closeOnlineSegment(openRow, Date.now());
          openRow.lastUpdate = Date.now();
          persistMilesRow(openRow);
        }
        releaseWakeLock();
        clearDriverPresence();
        state.milesEndPrompt = false;
        state.milesTrackLat = null;
        state.milesTrackLng = null;
        state.milesTrackAt = 0;
      }
      writeSession("");
      var a = pcsAuth();
      if (a && a.signOut) a.signOut();
      state.loginError = "";
      state.gateStep = "";
      state.screen = "home";
      state.isTest = false;
      state.onlineDrivers = [];
      state.onlineStamp = "";
      render();
    }
    var milesStartForm = document.getElementById("miles-start-form");
    if (milesStartForm) {
      milesStartForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var raw = document.getElementById("miles-start-odo").value;
        var odo = Number(raw);
        if (!isFinite(odo) || odo < 0 || String(raw).trim() === "") {
          state.milesOdoError = "Enter the starting odometer for today.";
          state.milesOdoDraft = raw;
          render();
          return;
        }
        var now = Date.now();
        var prev = todayMilesRow() || {};
        var keepMiles = Number(prev.gpsMiles) || 0;
        var row = {
          startOdometer: odo,
          /* Same Chicago day: keep prior GPS total; only logged-out miles were skipped. */
          gpsMiles: keepMiles,
          startedAt: prev.startedAt || now,
          lastUpdate: now,
          shiftClosed: false,
          /* Online time: earlier shifts today + this shift from now. */
          onlineMs: Number(closeOnlineSegment(Object.assign({}, prev), now).onlineMs) || 0,
          shiftStartAt: now
        };
        if (prev.endOdometer != null) row.priorEndOdometer = prev.endOdometer;
        /* Explicitly reopen: no endOdometer / shiftClosed on the new shift row. */
        state.milesOdoError = "";
        state.milesOdoDraft = "";
        state.milesNeedStart = false;
        state.milesStartOdo = odo;
        state.milesToday = keepMiles;
        /* Fresh GPS anchor so the first post-login jump is not counted as a teleport. */
        state.milesTrackLat = null;
        state.milesTrackLng = null;
        state.milesTrackAt = 0;
        persistMilesRow(row).then(function () {
          followGps();
          acquireWakeLock();
          refreshOpenRides(true);
          publishDriverPresence();
          render();
        });
      });
    }
    var milesEndForm = document.getElementById("miles-end-form");
    if (milesEndForm) {
      milesEndForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var raw = document.getElementById("miles-end-odo").value;
        if (String(raw).trim() !== "") {
          var odo = Number(raw);
          if (!isFinite(odo) || odo < 0) {
            state.milesEndError = "Enter a valid ending odometer, or skip.";
            state.milesEndDraft = raw;
            render();
            return;
          }
          var row = todayMilesRow() || {
            startOdometer: state.milesStartOdo,
            gpsMiles: Number(state.milesToday) || 0,
            startedAt: Date.now(),
            lastUpdate: Date.now()
          };
          closeOnlineSegment(row, Date.now());
          row.endOdometer = odo;
          row.shiftClosed = true;
          row.lastUpdate = Date.now();
          persistMilesRow(row);
        } else {
          var closed = todayMilesRow();
          if (closed) {
            closeOnlineSegment(closed, Date.now());
            closed.shiftClosed = true;
            closed.lastUpdate = Date.now();
            persistMilesRow(closed);
          }
        }
        finishDriverLogout();
      });
    }
    var milesEndSkip = document.getElementById("miles-end-skip");
    if (milesEndSkip) {
      milesEndSkip.addEventListener("click", function () {
        var closed = todayMilesRow();
        if (closed) {
          closeOnlineSegment(closed, Date.now());
          closed.shiftClosed = true;
          closed.lastUpdate = Date.now();
          persistMilesRow(closed);
        }
        finishDriverLogout();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-complete-schedule]"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-complete-schedule");
        if (!id) return;
        if (!window.confirm("Mark this scheduled ride complete and credit commission for your pay week?")) return;
        btn.disabled = true;
        completeScheduledRide(id).then(function () {
          btn.disabled = false;
          render();
        });
      });
    });
    var customerBtn = document.getElementById("mode-customer");
    var driverBtn = document.getElementById("mode-driver");
    if (customerBtn) {
      customerBtn.addEventListener("click", function () {
        state.mode = "customer";
        state.screen = "home";
        state.error = "";
        render();
      });
    }
    if (driverBtn) {
      driverBtn.addEventListener("click", function () {
        if (document.getElementById("ride-form")) readForm();
        state.mode = "driver";
        state.screen = "home";
        state.error = "";
        render();
      });
    }
    addrPrefixes().forEach(function (prefix) { wireSearch(prefix); });
    wireAddressInputs();
    wireLocation();
    var addStopBtn = document.getElementById("add-stop");
    if (addStopBtn) {
      addStopBtn.addEventListener("click", function () {
        if (document.getElementById("ride-form")) readForm();
        if (!state.stopList) state.stopList = [];
        if (state.stopList.length >= MAX_STOPS) return;
        state.stopList.push(blankStop());
        var idx = state.stopList.length - 1;
        render();
        var first = document.getElementById("stop" + idx + "-street");
        if (first) first.focus();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-stop-remove]"), function (btn) {
      btn.addEventListener("click", function () {
        if (document.getElementById("ride-form")) readForm();
        var i = Number(btn.getAttribute("data-stop-remove"));
        if (isFinite(i) && state.stopList && state.stopList[i]) state.stopList.splice(i, 1);
        state.stops = filledStops().length;
        resetDrivingRoute();
        render();
      });
    });
    var whenAsapBtn = document.getElementById("when-asap");
    var whenSchedBtn = document.getElementById("when-schedule");
    if (whenAsapBtn) {
      whenAsapBtn.addEventListener("click", function () {
        state.asap = false; /* temporarily so readForm keeps addresses without stamping */
        if (document.getElementById("ride-form")) readForm();
        state.asap = true;
        stampAsapNow();
        state.error = "";
        render();
      });
    }
    if (whenSchedBtn) {
      whenSchedBtn.addEventListener("click", function () {
        state.asap = false;
        if (document.getElementById("ride-form")) readForm();
        if (!state.date) state.date = chicagoParts(new Date()).date;
        state.error = "";
        render();
      });
    }
    var form = document.getElementById("ride-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (activeRiderRide()) { render(); return; } /* v52: never a second request while one is open */
        if (!form.dataset.markChecked && checkMarkBeforeRequest(form)) return;
        delete form.dataset.markChecked;
        readForm();
        state.notice = "";
        state.stopList = (state.stopList || []).filter(function (s) { return s && String(s.street || "").trim(); });
        state.stops = state.stopList.length;
        var badStop = -1;
        state.stopList.forEach(function (s, i) {
          if (badStop < 0 && (!String(s.city || "").trim() || !String(s.state || "").trim())) badStop = i;
        });
        if (badStop >= 0) {
          state.error = "Finish Stop " + (badStop + 1) + " (address line 1, city and state), or remove it.";
          render();
          return;
        }
        if (!formComplete()) {
          state.error = state.asap
            ? "Add From and To (address line 1, city, state), plus your name and phone."
            : "Add From and To (address line 1, city, state), date, time, name, and phone.";
          render();
          return;
        }
        if (!phoneLooksValid(state.phone)) {
          state.error = "Enter a valid 10-digit US phone number.";
          render();
          return;
        }
        if (!state.asap && isPickupInPast(state.date, state.time)) {
          state.error = "Pick a date and time that have not passed yet.";
          render();
          return;
        }
        var scheduleErr = validateScheduleRules();
        if (scheduleErr) {
          state.error = scheduleErr;
          render();
          return;
        }
        function requestRide() {
          state.error = "";
          state.customerGeocodeTried = false;
          state.dropFix = null;
          state.driverLat = null;
          state.driverLng = null;
          state.code = syncOn() ? makeRideCode() : "";
          if (state.isTest && !testModeAvailable()) state.isTest = false;
          state.pin = (state.isTest ? TEST_PIN : makeRidePin());
          state.pinHash = "";
          state.pinDraft = "";
          state.pinError = "";
          state.paymentSkipped = !!state.isTest; /* TEST rides never charge / never open Square */
          state.cardStatus = state.isTest ? "test_skip" : "none";
          state.cardLast4 = "";
          state.cardBrand = "";
          state.paymentStatus = "";
          state.paidCents = 0;
          state.receiptUrl = "";
          state.cancelConfirm = false;
          state.cancelBusy = false;
          state.cancelError = "";
          var submitBtn = document.querySelector("#ride-form button[type=submit]");
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Finding addresses…"; }
          geocodeMissing().then(function () {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Request this ride"; }
            var dropKey = [state.dropStreet, state.dropCity, state.dropState].join("|");
            if (!placeCoords("drop") && state.dropMissingAck !== dropKey) {
              state.dropMissingAck = dropKey;
              state.dropApprox = "missing";
              state.error = "We couldn't find the To address \"" + dropLine() + "\" on the map, so miles and fare can't be figured yet. " +
                "Check the street name and city (no ZIP needed), or pick it from the suggestions. Tap Request this ride again to send it anyway.";
              render();
              return;
            }
            if (placeCoords("drop") && state.dropApprox === "city" && state.dropMissingAck !== dropKey) {
              state.dropMissingAck = dropKey;
              state.error = "We could only place the To address at the " + (state.dropCity || "city") + " city center, so miles and fare are rough. " +
                "Check the street name (no ZIP needed), or tap Request this ride again to send it anyway.";
              render();
              return;
            }
            if (!placeCoords("pickup") && state.pickupMissingAck !== state.pickupStreet) {
              state.pickupMissingAck = state.pickupStreet;
              state.error = "We couldn't find the From address on the map. Check the street and city, or tap Use current location. Tap Request this ride again to send it anyway.";
              render();
              return;
            }
            saveRide("pending_owner", { clearDriver: true });
            var created = currentRide();
            state.customerGeocodeTried = true;
            if (!syncOn()) {
              state.screen = "waiting";
              state.rideStatus = "pending_owner";
              render();
              return;
            }
            if (!state.code || !created) {
              state.error = "Could not create a ride code. Try again.";
              state.screen = "home";
              render();
              return;
            }
            state.screen = "waiting";
            state.remoteLoading = true;
            render();
            publishRide(state.code, created).then(function () {
              state.remoteLoading = false;
              state.error = "";
              render();
            }).catch(function () {
              state.remoteLoading = false;
              state.screen = "home";
              state.rideStatus = "";
              state.error = "Your request did not save. Check your connection and try again — you are not waiting for a driver yet.";
              try { localStorage.removeItem(STORE); } catch (e) {}
              render();
            });
          });
        }
        loadBusyWindows().then(function (windows) {
          if (rideHitsBusy(windows)) {
            state.error = "That time is already taken. Pick another time, or call " + BUSINESS_PHONE + ".";
            render();
            return;
          }
          if (!syncOn()) {
            requestRide();
            return;
          }
          listOpenSummariesRaw().then(function (open) {
            var startMs = pickupInstant().getTime();
            var endMs = startMs + 60 * 60 * 1000;
            var clash = (open || []).some(function (row) {
              if (!row || rideIsAsap(row)) return false;
              var st = String(row.status || "requested").toLowerCase();
              if (st === "denied" || st === "cancelled" || st === "completed") return false;
              if (!row.date || !row.time) return false;
              var other = chicagoWallToMs(row.date, row.time);
              if (!isFinite(other) || !isFinite(startMs)) return false;
              return other < endMs && startMs < other + 60 * 60 * 1000;
            });
            if (clash) {
              state.error = "That time overlaps another booking. Pick another time, or call " + BUSINESS_PHONE + ".";
              render();
              return;
            }
            requestRide();
          }).catch(function () {
            requestRide();
          });
        }).catch(function () {
          state.error = "Could not check the busy schedule (busy.json). Try again, or call " + BUSINESS_PHONE + ".";
          render();
        });
      });
    }

    var backToRide = document.getElementById("back-to-ride");
    if (backToRide) {
      backToRide.addEventListener("click", function () {
        if (goToActiveRide(activeRiderRide())) render();
      });
    }
    var cancelThat = document.getElementById("cancel-that-ride");
    if (cancelThat) {
      cancelThat.addEventListener("click", function () {
        if (!goToActiveRide(activeRiderRide())) return;
        state.cancelConfirm = true;
        render();
        var card = document.getElementById("cancel-card");
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
      });
    }
    var backHome = document.getElementById("back-home");
    if (backHome) {
      backHome.addEventListener("click", function () {
        var endedSt = String(state.rideStatus || "").toLowerCase();
        if (endedSt === "cancelled" || endedSt === "denied") { clearActiveMark(state.code); discardStoredRide(); }
        state.mode = "customer";
        state.screen = "home";
        render();
      });
    }
    /* v54: rider History + in-app chat */
    var openHist = document.getElementById("open-history");
    if (openHist) {
      openHist.addEventListener("click", function () {
        state.riderHistoryView = "list";
        state.historyReceipt = null;
        render();
        loadRiderHistory().then(function () { render(); });
      });
    }
    var histBack = document.getElementById("history-back");
    if (histBack) {
      histBack.addEventListener("click", function () {
        state.riderHistoryView = "";
        state.historyReceipt = null;
        render();
      });
    }
    var receiptBack = document.getElementById("receipt-back");
    if (receiptBack) {
      receiptBack.addEventListener("click", function () {
        state.riderHistoryView = "list";
        state.historyReceipt = null;
        render();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-history-code]"), function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-history-code");
        var row = null;
        (state.historyRows || []).forEach(function (r) { if (r && r.code === code) row = r; });
        if (!row) return;
        state.historyReceipt = row;
        state.riderHistoryView = "receipt";
        render();
      });
    });
    var chatForm = document.getElementById("chat-form");
    if (chatForm) {
      chatForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var inp = document.getElementById("chat-input");
        var msg = inp ? inp.value : state.chatDraft;
        state.chatDraft = msg || "";
        sendChatMessage(msg, ROLE === "driver" ? "driver" : "rider").then(function () { render(); });
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-chat-quick]"), function (btn) {
      btn.addEventListener("click", function () {
        var q = btn.getAttribute("data-chat-quick") || "";
        sendChatMessage(q, "driver").then(function () { render(); });
      });
    });
    var backDriver = document.getElementById("back-driver");
    if (backDriver) {
      backDriver.addEventListener("click", function () {
        state.mode = "driver";
        state.screen = "home";
        state.selectedOpenCode = "";
        clearRideFields();
        writeDriverCode("");
        state.driverCode = "";
        render();
      });
    }
    var accept = document.getElementById("accept-ride");
    if (accept) {
      accept.addEventListener("click", function () {
        acceptSelectedOpenRide();
      });
    }
    var deny = document.getElementById("deny-ride");
    if (deny) {
      deny.addEventListener("click", function () {
        denySelectedOpenRide();
      });
    }
    var pinForm = document.getElementById("start-pin-form");
    if (pinForm) {
      pinForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = document.getElementById("start-pin");
        var entered = normalizePin(input ? input.value : "");
        state.pinDraft = entered;
        state.pinError = "";
        if (entered.length !== 4) {
          state.pinError = "Enter the 4-digit PIN from the rider.";
          render();
          return;
        }
        pinAcceptedAsync(entered).then(function (ok) {
          if (!ok) {
            state.pinError = "That PIN does not match. Ask the rider again.";
            render();
            return;
          }
          state.tripPath = [];
          state.useDrivenMiles = false;
          state.endedEarly = false;
          if (isCoord(state.hereLat) && isCoord(state.hereLng)) {
            recordTripPoint(state.hereLat, state.hereLng);
          }
          saveRide("started");
          var code = state.driverCode || state.code || readDriverCode();
          if (syncOn() && code) {
            syncActiveTripFare({ status: "started" });
          }
          state.pinDraft = "";
          state.pinError = "";
          state.screen = "trip";
          render(); /* v51: the big Navigate button at the top now points at the drop-off (iPad blocks auto-open) */
        });
      });
    }
    var completeRide = document.getElementById("complete-ride");
    if (completeRide) {
      completeRide.addEventListener("click", function () {
        completeActiveRide();
      });
    }
    var endHere = document.getElementById("end-here");
    if (endHere) {
      endHere.addEventListener("click", function () {
        if (!isCoord(state.hereLat) || !isCoord(state.hereLng)) {
          state.error = "Allow location to end the ride here.";
          render();
          return;
        }
        completeActiveRide({ endHere: true });
      });
    }
    var openNav = document.getElementById("open-nav");
    if (openNav) {
      openNav.addEventListener("click", function () {
        /* Real link (works in the iPad/iPhone home-screen app); refresh it in case the pin moved. */
        var t = navTarget();
        if (t) openNav.setAttribute("href", t.url);
      });
    }
    var cancelRide = document.getElementById("cancel-ride");
    if (cancelRide) {
      cancelRide.addEventListener("click", function () {
        state.cancelConfirm = true;
        state.cancelError = "";
        render();
        var card = document.getElementById("cancel-card");
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
      });
    }
    var cancelYes = document.getElementById("cancel-ride-yes");
    if (cancelYes) {
      cancelYes.addEventListener("click", function () {
        cancelRiderRide();
      });
    }
    var cancelNo = document.getElementById("cancel-ride-no");
    if (cancelNo) {
      cancelNo.addEventListener("click", function () {
        state.cancelConfirm = false;
        state.cancelError = "";
        render();
      });
    }
    var squareHold = document.getElementById("square-hold-btn");
    if (squareHold) {
      squareHold.addEventListener("click", function () {
        openCardStep();
      });
    }
    var skipPay = document.getElementById("skip-pay-btn");
    if (skipPay) {
      skipPay.addEventListener("click", function () {
        state.paymentSkipped = true;
        state.cardStatus = "test_skip";
        try { localStorage.setItem("PCS_TEST_SKIP_PAY", "true"); } catch (e) {}
        if (state.code && state.rideStatus) {
          saveRide(state.rideStatus);
          if (syncOn()) patchRide(state.code, { cardStatus: "test_skip", cardSkippedAt: Date.now() }).catch(function () {});
        }
        render();
      });
    }
    var dismissNotice = document.getElementById("dismiss-driver-notice");
    if (dismissNotice) {
      dismissNotice.addEventListener("click", function () {
        state.driverNotice = "";
        render();
      });
    }
    var openHub = document.getElementById("open-hub");
    if (openHub) {
      openHub.addEventListener("click", function () {
        state.hubOpen = true;
        state.hubView = "menu";
        render();
      });
    }
    var closeHub = document.getElementById("close-hub");
    if (closeHub) {
      closeHub.addEventListener("click", function () {
        state.hubOpen = false;
        state.hubView = "menu";
        render();
      });
    }
    var hubToday = document.getElementById("hub-today");
    if (hubToday) {
      hubToday.addEventListener("click", function () {
        state.hubView = "today";
        render();
      });
    }
    var hubHistory = document.getElementById("hub-history");
    if (hubHistory) {
      hubHistory.addEventListener("click", function () {
        state.hubView = "history";
        state.hubDay = mondayOfWeek(chicagoToday());
        render();
      });
    }
    var hubBackMenu = document.getElementById("hub-back-menu");
    if (hubBackMenu) {
      hubBackMenu.addEventListener("click", function () {
        state.hubView = "menu";
        render();
      });
    }
    var hubBackHistory = document.getElementById("hub-back-history");
    if (hubBackHistory) {
      hubBackHistory.addEventListener("click", function () {
        state.hubView = "history";
        render();
      });
    }
    var toggleComm = document.getElementById("toggle-comm-hide");
    if (toggleComm) {
      toggleComm.addEventListener("click", function () {
        state.commHidden = !state.commHidden;
        render();
      });
    }
    var hubWeekPrev = document.getElementById("hub-week-prev");
    if (hubWeekPrev) {
      hubWeekPrev.addEventListener("click", function () {
        var mon = mondayOfWeek(state.hubDay || chicagoToday());
        state.hubDay = addDaysYmd(mon, -7);
        state.hubView = "history";
        render();
      });
    }
    var hubWeekNext = document.getElementById("hub-week-next");
    if (hubWeekNext) {
      hubWeekNext.addEventListener("click", function () {
        var mon = mondayOfWeek(state.hubDay || chicagoToday());
        state.hubDay = addDaysYmd(mon, 7);
        state.hubView = "history";
        render();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-hub-day]"), function (btn) {
      btn.addEventListener("click", function () {
        state.hubDay = btn.getAttribute("data-hub-day") || chicagoToday();
        state.hubView = "day";
        render();
      });
    });
    var preview = document.getElementById("preview-only");
    if (preview) preview.addEventListener("click", openPreview);
  }


  /*
    v48 address resolver. Riders do NOT know ZIP codes, so a ZIP is never needed:
      1. OpenStreetMap Nominatim, structured (street + city + state [+ ZIP if given])  -> exact house
      2. Nominatim free text                                                          -> exact house / street
      3. Photon (nearest first around the rider / From pin), street words must match  -> house or street
      4. Street name alone near the trip ("veilwood" -> Veilwood Cir, The Woodlands)  -> approximate (street)
      5. City + state center                                                          -> approximate (city)
    Returns a GeoJSON-like feature; properties.level = "exact" | "street" | "city",
    properties.postcode / city / label are used to auto-fill the ZIP and show "Found: ...".
  */
  var GEO_LEVEL_RANK = { exact: 0, street: 1, city: 2 };
  var STREET_MATCH_MAX_MI = 60;

  function geoFeature(lat, lng, props) {
    return { type: "Feature", geometry: { type: "Point", coordinates: [+lng, +lat] }, properties: props || {} };
  }

  function streetCoreTokens(street, city) {
    var t = String(street || "").replace(/^\s*\d+[A-Za-z]?\s+/, "");
    return focusTokens(t, city).filter(function (w) { return !/^\d+$/.test(w) && ["north", "south", "east", "west", "n", "s", "e", "w"].indexOf(w) === -1; });
  }

  function coreMatches(tokens, text) {
    if (!tokens.length) return false;
    return tokens.every(function (w) { return wordStarts(text, w); });
  }

  function nominatimHits(params, origin) {
    return withTimeout(fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&" + params, {
      headers: { "Accept": "application/json" }
    }).then(function (res) {
      if (!res.ok) throw new Error("nominatim");
      return res.json();
    }), 7000).then(function (list) {
      return (Array.isArray(list) ? list : []).map(function (hit) {
        var lat = +hit.lat, lng = +hit.lon;
        if (!isCoord(lat) || !isCoord(lng)) return null;
        var a = hit.address || {};
        return {
          lat: lat, lng: lng,
          house: a.house_number || "",
          road: a.road || "",
          city: a.city || a.town || a.village || a.hamlet || a.suburb || "",
          state: stateCode(a.state || ""),
          zip: String(a.postcode || "").slice(0, 5),
          dist: haversine(origin, { lat: lat, lng: lng })
        };
      }).filter(function (h) { return h && !(h.dist > 300); }).sort(function (x, y) { return x.dist - y.dist; });
    }).catch(function () { return []; });
  }

  function resolveAddress(text, city, stateName, zip, prefix) {
    var base = String(text || "").trim();
    if (!base) return Promise.resolve(null);
    var st = String(stateName || "TX").trim() || "TX";
    var low = base.toLowerCase();
    var parts = [base];
    if (city && low.indexOf(String(city).toLowerCase()) === -1) parts.push(city);
    if (st && low.indexOf(" " + st.toLowerCase()) === -1) parts.push(st);
    if (zip && low.indexOf(String(zip)) === -1) parts.push(zip);
    var q = parts.join(", ");
    var origin = searchOrigin(prefix || "drop");
    var o = (origin && origin.point) || DEFAULT_SEARCH_CENTER;
    var isAddr = /^\d+[A-Za-z]?\s/.test(base);
    var num = isAddr ? (base.match(/^(\d+[A-Za-z]?)\s/) || [])[1] : "";
    var core = streetCoreTokens(base, city);

    function fromHit(h, level) {
      var label = [[h.house, h.road].filter(Boolean).join(" ") || base, h.city, h.state, h.zip].filter(Boolean).join(", ");
      return geoFeature(h.lat, h.lng, { name: base, source: "nominatim", level: level, postcode: h.zip, city: h.city, label: label });
    }
    function fromPhoton(it, level) {
      var pl = it.place;
      var line = pl.line1 || "";
      if (level !== "exact" && num && !/^\d/.test(line)) line = "near " + line;
      var label = [line, pl.city, pl.state, String(pl.zip || "").slice(0, 5)].filter(Boolean).join(", ");
      return geoFeature(pl.lat, pl.lng, { name: base, source: "photon", level: level, postcode: String(pl.zip || "").slice(0, 5), city: pl.city, label: label });
    }
    function pickNominatim(hits) {
      if (!hits.length) return null;
      if (num) {
        var exact = hits.filter(function (h) { return normText(h.house) === normText(num); })[0];
        if (exact) return fromHit(exact, "exact");
        var street = hits.filter(function (h) { return h.road && coreMatches(core, h.road); })[0];
        return street ? fromHit(street, "street") : null;
      }
      return fromHit(hits[0], "exact");
    }
    function cityCenter() {
      if (!city) return Promise.resolve(null);
      return nominatimHits("city=" + encodeURIComponent(city) + "&state=" + encodeURIComponent(st), o).then(function (hits) {
        var h = hits[0];
        if (!h) return null;
        return geoFeature(h.lat, h.lng, { name: base, source: "nominatim", level: "city", postcode: "", city: city, label: city + ", " + st + " (city center)" });
      });
    }
    function viaPhoton() {
      return findPlaces(q, origin, { city: city || "", zip: zip || "" }).then(function (items) {
        var best = null;
        items.some(function (it) {
          var p = (it.feature && it.feature.properties) || {};
          if (num) {
            if (!coreMatches(core, p.street || p.name || "")) return false;
            best = fromPhoton(it, normText(p.housenumber) === normText(num) ? "exact" : "street");
            return true;
          }
          if (it.tier <= 1) { best = fromPhoton(it, "exact"); return true; }
          return false;
        });
        return best;
      }).catch(function () { return null; });
    }
    function viaStreetName() {
      if (!core.length) return Promise.resolve(null);
      var common = "lang=en&limit=10&lat=" + o.lat.toFixed(5) + "&lon=" + o.lng.toFixed(5) + "&location_bias_scale=0.1&q=";
      return Promise.all([
        photonFetch(common + encodeURIComponent(core.join(" ") + (city ? " " + city : ""))),
        photonFetch(common + encodeURIComponent(core.join(" ")))
      ]).then(function (lists) {
        var items = rankPlaces([].concat(lists[0], lists[1]), core.join(" "), o, { city: city || "" }).filter(function (it) {
          var p = (it.feature && it.feature.properties) || {};
          return coreMatches(core, p.street || p.name || "") && it.dist <= STREET_MATCH_MAX_MI;
        });
        items.sort(function (x, y) {
          var xs = (x.feature.properties || {}).osm_key === "highway" ? 0 : 1;
          var ys = (y.feature.properties || {}).osm_key === "highway" ? 0 : 1;
          return (x.cityKey - y.cityKey) || (xs - ys) || (x.dist - y.dist);
        });
        return items[0] ? fromPhoton(items[0], "street") : null;
      });
    }

    var chain;
    if (isAddr) {
      var structured = "street=" + encodeURIComponent(base) + (city ? "&city=" + encodeURIComponent(city) : "") +
        "&state=" + encodeURIComponent(st) + (zip ? "&postalcode=" + encodeURIComponent(zip) : "");
      chain = nominatimHits(structured, o).then(pickNominatim).then(function (f) {
        if (f && f.properties.level === "exact") return f;
        return nominatimHits("q=" + encodeURIComponent(q), o).then(pickNominatim).then(function (g) {
          var cand = [f, g].filter(Boolean);
          var ex = cand.filter(function (c) { return c.properties.level === "exact"; })[0];
          return ex || cand[0] || null;
        });
      }).then(function (f) {
        if (f && f.properties.level === "exact") return f;
        return viaPhoton().then(function (g) {
          if (g && (!f || g.properties.level === "exact")) return g;
          return f;
        });
      });
    } else {
      chain = viaPhoton();
    }
    return chain.then(function (f) {
      return f || viaStreetName();
    }).then(function (f) {
      return f || cityCenter();
    }).then(function (f) {
      /* Map hit without a ZIP (common for streets/neighborhoods): look the ZIP up at that point. */
      if (!f || f.properties.level === "city" || f.properties.postcode) return f;
      var pt = featurePoint(f);
      return withTimeout(fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=" + pt.lat + "&lon=" + pt.lng, {
        headers: { "Accept": "application/json" }
      }).then(function (res) { return res.ok ? res.json() : null; }), 6000).then(function (data) {
        var a = (data && data.address) || {};
        var z = String(a.postcode || "").slice(0, 5);
        if (/^\d{5}$/.test(z)) {
          f.properties.postcode = z;
          if (!f.properties.city) f.properties.city = a.city || a.town || a.village || "";
          if (f.properties.label && f.properties.label.indexOf(z) === -1) f.properties.label += " " + z;
        }
        return f;
      }).catch(function () { return f; });
    }).catch(function () { return null; });
  }

  function geocodeQuery(text, city, stateName, zip, prefix) {
    return resolveAddress(text, city, stateName, zip, prefix);
  }

  /* Put a resolved place on the ride: pin + auto-filled ZIP / city + "Found:" label. */
  function applyResolved(prefix, feature) {
    var pt = featurePoint(feature);
    if (!pt) return false;
    var props = feature.properties || {};
    addrSet(prefix, "Lat", pt.lat);
    addrSet(prefix, "Lng", pt.lng);
    var level = props.level || "exact";
    addrSet(prefix, "Approx", level === "exact" ? "" : level);
    addrSet(prefix, "Found", props.label || "");
    if (level !== "city" && props.postcode && !String(addrGet(prefix, "Zip") || "").trim()) addrSet(prefix, "Zip", props.postcode);
    if (props.city && !String(addrGet(prefix, "City") || "").trim()) addrSet(prefix, "City", props.city);
    if (prefix === "drop") state.dropFix = pt;
    resetDrivingRoute();
    return true;
  }

  function levelRank(v) {
    return v ? (GEO_LEVEL_RANK[v] != null ? GEO_LEVEL_RANK[v] : 3) : 0;
  }

  function ensureCustomerCoords() {
    if (ROLE !== "customer") return;
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    if (state.customerGeocodeTried) return;
    state.customerGeocodeTried = true;
    var beforeDrop = placeCoords("drop");
    var beforePick = placeCoords("pickup");
    geocodeMissing().then(function () {
      if (ROLE !== "customer") return;
      if (state.screen !== "waiting" && state.screen !== "trip") return;
      var after = placeCoords("drop");
      var moved = !!(after && (!beforeDrop || haversine(beforeDrop, after) >= 0.05));
      var filledPick = !!(!beforePick && placeCoords("pickup"));
      if (!moved && !filledPick) return;
      if (moved && after) state.dropFix = { lat: +after.lat, lng: +after.lng };
      saveRide(state.rideStatus || (state.screen === "trip" ? "accepted" : "requested"));
      if (moved && after && syncOn() && state.code) {
        var dropPatch = { dropLat: +after.lat, dropLng: +after.lng, dropApprox: state.dropApprox && state.dropApprox !== "missing" ? state.dropApprox : "", dropFound: state.dropFound || "" };
        if (state.dropZip) dropPatch.dropZip = state.dropZip;
        patchRide(state.code, dropPatch).then(function () {
          var latest = currentRide() || {};
          Object.keys(dropPatch).forEach(function (k) { latest[k] = dropPatch[k]; });
          if (!latest.code) latest.code = state.code;
          if (String(latest.status || state.rideStatus || "") === "requested") putOpenRide(state.code, latest).catch(function () {});
        }).catch(function () {});
      } else if (filledPick) {
        pushPlaceCoords();
      }
      render();
    });
  }

  function geocodeMissing() {
    var jobs = [];
    /* Picked from the list / current location: keep that exact pin (never swap to another store). */
    var pickupPinned = !!state.pickupPinned && !!placeCoords("pickup") && !state.pickupApprox;
    var dropPinned = !!state.dropPinned && !!placeCoords("drop") && !state.dropApprox;
    (state.stopList || []).forEach(function (s, i) {
      if (!s || !String(s.street || "").trim()) return;
      if (s.pinned && isCoord(s.lat) && isCoord(s.lng) && !s.approx) return;
      jobs.push(geocodeQuery(s.street, s.city, s.state, s.zip, "stop" + i).then(function (feature) {
        if (!feature || !state.stopList[i]) return;
        var had = isCoord(state.stopList[i].lat) && isCoord(state.stopList[i].lng);
        if (had && levelRank((feature.properties || {}).level) > levelRank(state.stopList[i].approx)) return;
        applyResolved("stop" + i, feature);
      }));
    });
    if (state.pickupStreet && !state.pickupFromHere && !pickupPinned) {
      jobs.push(geocodeQuery(state.pickupStreet, state.pickupCity, state.pickupState, state.pickupZip, "pickup").then(function (feature) {
        if (!feature) return;
        var saved = placeCoords("pickup");
        var lvl = (feature.properties || {}).level;
        if (!saved || (state.pickupApprox && levelRank(lvl) <= levelRank(state.pickupApprox)) ||
            placeLooksWeak(saved, feature, state.pickupStreet, state.pickupCity)) applyResolved("pickup", feature);
      }));
    }
    if (state.dropStreet && !dropPinned) {
      jobs.push(geocodeQuery(state.dropStreet, state.dropCity, state.dropState, state.dropZip, "drop").then(function (feature) {
        if (!feature) return;
        var saved = placeCoords("drop");
        var lvl = (feature.properties || {}).level;
        if (!saved || (state.dropApprox && levelRank(lvl) <= levelRank(state.dropApprox)) ||
            placeLooksWeak(saved, feature, state.dropStreet, state.dropCity)) {
          applyResolved("drop", feature);
          if (lvl === "exact") state.dropPinned = true;
        }
      }));
    }
    return Promise.all(jobs);
  }

  /* Rider form: find the address as soon as street + city are typed (no ZIP needed). */
  var autoResolveSeq = {};
  function autoResolveField(prefix) {
    if (ROLE !== "customer" || state.screen !== "home") return;
    var street = String(addrGet(prefix, "Street") || "").trim();
    var city = String(addrGet(prefix, "City") || "").trim();
    if (street.length < 3) return;
    if (addrGet(prefix, "Pinned") && isCoord(addrGet(prefix, "Lat")) && !addrGet(prefix, "Approx")) return;
    if (prefix === "pickup" && state.pickupFromHere) return;
    var key = street + "|" + city + "|" + (addrGet(prefix, "State") || "") + "|" + (addrGet(prefix, "Zip") || "");
    if (autoResolveSeq[prefix] === key) return;
    autoResolveSeq[prefix] = key;
    var note = document.getElementById(prefix + "-found");
    if (note) { note.textContent = "Finding this address…"; note.className = "fine addr-found"; }
    resolveAddress(street, city, addrGet(prefix, "State"), addrGet(prefix, "Zip"), prefix).then(function (feature) {
      if (autoResolveSeq[prefix] !== key) return;
      var stillStreet = String(addrGet(prefix, "Street") || "").trim();
      if (stillStreet !== street) return;
      var el = document.getElementById(prefix + "-found");
      if (!feature) {
        addrSet(prefix, "Found", "");
        addrSet(prefix, "Approx", "missing");
        if (el) { el.textContent = "We couldn't find this address yet. Check the street name and city, or pick it from the list."; el.className = "error addr-found"; }
        return;
      }
      applyResolved(prefix, feature);
      var lvl = (feature.properties || {}).level;
      if (lvl === "exact") addrSet(prefix, "Pinned", true);
      var zipEl = document.getElementById(prefix + "-zip");
      if (zipEl && !zipEl.value.trim() && addrGet(prefix, "Zip")) zipEl.value = addrGet(prefix, "Zip");
      var cityEl = document.getElementById(prefix + "-city");
      if (cityEl && !cityEl.value.trim() && addrGet(prefix, "City")) cityEl.value = addrGet(prefix, "City");
      if (el) {
        el.textContent = foundNoteText(prefix);
        el.className = (lvl === "exact" ? "fine" : "note") + " addr-found";
      }
    });
  }

  function foundNoteText(prefix) {
    var found = addrGet(prefix, "Found");
    var lvl = addrGet(prefix, "Approx");
    if (!found) return lvl === "missing" ? "We couldn't find this address yet. Check the street name and city, or pick it from the list." : "";
    if (lvl === "city") return "Pinned at " + found + ". We couldn't find the exact street, so miles are approximate.";
    if (lvl === "street") return "Pinned near " + String(found).replace(/^near\s+/i, "") + ". Exact house isn't on the map, so miles are close.";
    return "\u2713 Found: " + found;
  }

  function draftText() {
    var est = estimate();
    return [
      "Private Car Services ride request",
      "10% website booking. Please apply the discount.",
      "",
      "Name: " + state.name,
      "Phone: " + state.phone,
      "Pickup: " + pickupLine(),
      "Drop-off: " + dropLine(),
      "When: " + prettyWhen(),
      "Billed miles: " + est.billed + " (rounded up from " + est.raw.toFixed(2) + ")",
      "Preview total: " + money(est.total),
      "Texas tax 8.25% is estimate-only, not a charge."
    ].join("\n");
  }

  function openPreview() {
    var sheet = document.getElementById("sheet");
    var draft = document.getElementById("draft");
    if (!sheet || !draft) return;
    draft.textContent = draftText();
    sheet.classList.add("open");
    var close = document.getElementById("close-sheet");
    if (close) close.focus();
  }

  function closePreview() {
    var sheet = document.getElementById("sheet");
    if (sheet) sheet.classList.remove("open");
  }

  function placeCar(lat, lng, deg) {
    var point = project({ lat: lat, lng: lng });
    var pinCar = document.getElementById("pin-car");
    if (pinCar) {
      pinCar.style.left = point.x + "%";
      pinCar.style.top = point.y + "%";
    }
    document.querySelectorAll(".car-face").forEach(function (el) {
      el.style.transform = "rotate(" + deg + "deg)";
    });
    if (carMarker) carMarker.setLatLng([lat, lng]);
  }

  function refreshOpenRides(force) {
    if (ROLE !== "driver" || !signedIn() || !driverCanTakeNew()) return;
    if (!syncOn()) {
      state.openRides = [];
      state.openListError = "";
      state.openListLoading = false;
      stopOpenRideAlert();
      var statusOff = document.getElementById("board-status");
      if (statusOff) statusOff.textContent = driverBoardStatusInner();
      syncDriverBoardMarkers();
      return;
    }
    var seq = ++openListSeq;
    state.openListLoading = true;
    listOpenRides().then(function (rides) {
      if (seq !== openListSeq) return;
      state.openListLoading = false;
      var prevError = state.openListError;
      state.openListError = "";
      var stamp = rides.map(function (r) {
        return (r.code || "") + ":" + (r.updatedAt || "") + ":" + (r.pickupLat || "") + "," + (r.pickupLng || "");
      }).join("|");
      var changed = stamp !== state.openListStamp || !!prevError;
      state.openListStamp = stamp;
      state.openRides = rides;
      syncOpenRideAlert();
      var selectionCleared = false;
      if (state.selectedOpenCode) {
        var still = rides.some(function (r) { return r.code === state.selectedOpenCode; });
        if (!still) {
          state.selectedOpenCode = "";
          clearRideFields();
          selectionCleared = true;
          changed = true;
        }
      }
      // Full render only when forced or the Accept/Deny card must rebuild.
      // Routine polls update the status line + map markers in place (map stays alive).
      if (force || selectionCleared) {
        render();
        return;
      }
      if (changed || prevError) {
        var status = document.getElementById("board-status");
        if (status) status.textContent = driverBoardStatusInner();
        syncDriverBoardMarkers();
      }
    }).catch(function (err) {
      if (seq !== openListSeq) return;
      state.openListLoading = false;
      var next = err && err.denied ? "open-denied" : "open-error";
      var changed = state.openListError !== next;
      state.openListError = next;
      stopOpenRideAlert();
      if (force) {
        render();
        return;
      }
      if (changed) {
        var statusErr = document.getElementById("board-status");
        if (statusErr) statusErr.textContent = driverBoardStatusInner();
      }
    });
  }

  function selectOpenRide(code) {
    code = normalizeCode(code);
    if (!code) return;
    if (state.selectedOpenCode !== code) setAcceptNotice("");
    state.selectedOpenCode = code;
    state.remoteLoading = true;
    getRide(code).then(function (ride) {
      state.remoteLoading = false;
      if (!ride) {
        state.selectedOpenCode = "";
        clearRideFields();
        render();
        return;
      }
      if (!ride.code) ride.code = code;
      applyRide(ride);
      state.code = code;
      state.driverCode = code;
      writeDriverCode(code);
      rememberRemote(ride);
      state.dropLookup = "";
      if (state.dropStreet && !placeCoords("drop")) {
        state.dropLookup = "looking";
        resolveAddress(state.dropStreet, state.dropCity, state.dropState, state.dropZip, "drop").then(function (feature) {
          if (state.selectedOpenCode !== code) return;
          state.dropLookup = feature ? "found" : "missing";
          if (feature) applyResolved("drop", feature);
          render();
        });
      }
      render();
    }).catch(function () {
      state.remoteLoading = false;
      state.selectedOpenCode = "";
      render();
    });
  }

  /* v48: Accept feedback lives on the ride card itself (the 3-second board poll no longer wipes it). */
  function setAcceptNotice(msg, kind) {
    state.acceptNotice = msg || "";
    state.acceptNoticeKind = kind || (msg ? "error" : "");
  }

  function acceptRideOnce(code, account, attempt) {
    return getRideWithEtag(code).then(function (pack) {
      var ride = pack && pack.ride;
      var etag = pack && pack.etag;
      var st = String((ride && ride.status) || "").toLowerCase();
      if (!ride) {
        var err = new Error("missing");
        err.missing = true;
        throw err;
      }
      if (st === "accepted" || st === "started" || st === "completed") {
        var mine = ride.driverId && ride.driverId === driverPresenceId();
        var taken = new Error(mine ? "mine" : "taken");
        if (mine) taken.mine = true; else taken.taken = true;
        throw taken;
      }
      if (st === "cancelled" || st === "denied") {
        var gone = new Error("cancelled");
        gone.cancelled = st;
        throw gone;
      }
      if (st === "pending_owner" || st === "pending-owner") {
        var wait = new Error("pending-owner");
        wait.pendingOwner = true;
        throw wait;
      }
      if (st && st !== "requested") {
        var bad = new Error("bad-status");
        bad.badStatus = st;
        throw bad;
      }
      if (ride.isTest && !isOwnerSession()) {
        var notest = new Error("test-ride");
        notest.testRide = true;
        throw notest;
      }
      if (ride.isTest) state.isTest = true;
      if (ride.pinHash) state.pinHash = ride.pinHash;
      var now = Date.now();
      var patch = {
        status: "accepted",
        acceptedAt: now,
        driverId: driverPresenceId(),
        driverUid: firebaseUid() || "",
        updatedAt: now
      };
      if (ride.isTest) patch.isTest = true;
      if (state.driverName) patch.driverName = state.driverName;
      /* v51: driverPhone is no longer written on the ride record (riders can read it). */
      if (safePhoto(state.driverPhoto)) patch.driverPhoto = safePhoto(state.driverPhoto);
      if (state.driverCarYear) patch.driverCarYear = state.driverCarYear;
      if (state.driverCarMake) patch.driverCarMake = state.driverCarMake;
      if (state.driverCarModel) patch.driverCarModel = state.driverCarModel;
      if (state.driverCarPlate) patch.driverCarPlate = state.driverCarPlate;
      if (state.driverCarSeats) patch.driverCarSeats = state.driverCarSeats;
      if (safePhoto(state.driverCarPhoto)) patch.driverCarPhoto = safePhoto(state.driverCarPhoto);
      if (account && account.email) patch.driverEmail = String(account.email).toLowerCase();
      /* Drop-off was never pinned (no ZIP etc.): the driver app found it, save it on the ride. */
      if (!isCoord(ride.dropLat) && isCoord(state.dropLat) && isCoord(state.dropLng)) {
        patch.dropLat = +state.dropLat;
        patch.dropLng = +state.dropLng;
        if (state.dropZip && !ride.dropZip) patch.dropZip = state.dropZip;
        patch.dropApprox = !!state.dropApprox;
      }
      return patchRideIfMatch(code, patch, etag, ride).catch(function (e) {
        if (e && e.conflict && attempt < 2) return acceptRideOnce(code, account, attempt + 1).then(function () { return "retried"; });
        throw e;
      }).then(function (r) {
        if (r === "retried") return;
        return deleteOpenRide(code).catch(function () {});
      });
    });
  }

  function acceptSelectedOpenRide() {
    stopOpenRideAlert();
    if (state.acceptBusy) return;
    if (!state.selectedOpenCode && !state.code) {
      setAcceptNotice("Tap the rider's pin on the map first, then tap Accept.");
      render();
      return;
    }
    if (!isDriverApproved()) {
      state.openListError = "pending-approval";
      setAcceptNotice("Your driver account is still waiting for owner approval, so you can't accept rides yet.");
      render();
      return;
    }
    var account = readDriverAccount();
    if (account && account.name) state.driverName = account.name;
    if (account && account.phone) state.driverPhone = account.phone;
    if (account && safePhoto(account.photo)) state.driverPhoto = safePhoto(account.photo);
    if (account) {
      state.driverCarYear = account.carYear || "";
      state.driverCarMake = account.carMake || "";
      state.driverCarModel = account.carModel || "";
      state.driverCarPlate = normalizePlate(account.carPlate);
      state.driverCarSeats = account.carSeats || "";
      if (safePhoto(account.carPhoto)) state.driverCarPhoto = safePhoto(account.carPhoto);
    }
    var code = state.selectedOpenCode || state.driverCode || state.code || readDriverCode();
    if (code) {
      state.code = code;
      state.driverCode = code;
      writeDriverCode(code);
    }
    function finishLocalAccept() {
      saveRide("accepted");
      try { bumpDayRequested(); } catch (e) {}
      state.selectedOpenCode = "";
      state.mode = "driver";
      state.screen = "trip";
      state.openListError = "";
      setAcceptNotice("");
      render();
    }
    if (!syncOn() || !code) {
      finishLocalAccept();
      return;
    }
    state.openListError = "";
    state.acceptBusy = true;
    setAcceptNotice("Accepting…", "busy");
    state.remoteLoading = true;
    render();
    acceptRideOnce(code, account, 0).then(function () {
      state.remoteLoading = false;
      state.acceptBusy = false;
      finishLocalAccept();
    }).catch(function (err) {
      state.remoteLoading = false;
      state.acceptBusy = false;
      var clear = false;
      if (err && err.mine) {
        /* Already ours (e.g. double tap): just open the trip. */
        finishLocalAccept();
        return;
      } else if (err && err.pendingOwner) {
        setAcceptNotice("This booking is still waiting for the owner to approve it in God mode.");
      } else if (err && (err.conflict || err.taken)) {
        setAcceptNotice("That ride was already taken by another driver.");
        clear = true;
      } else if (err && err.cancelled) {
        setAcceptNotice(err.cancelled === "denied" ? "The owner denied this booking." : "The rider cancelled this ride.");
        clear = true;
      } else if (err && err.missing) {
        setAcceptNotice("This ride is no longer in the system.");
        clear = true;
      } else if (err && err.testRide) {
        setAcceptNotice("This is an owner TEST ride. Only the owner's driver login can accept it.");
      } else if (err && err.badStatus) {
        setAcceptNotice("This ride can't be accepted right now (status: " + err.badStatus + ").");
      } else if (err && err.denied) {
        setAcceptNotice("The database blocked this accept (permission " + (err.status || "") + "). Log out and back in, then try again. If it keeps happening, call the office.");
      } else if (err && err.status) {
        setAcceptNotice("Could not accept this ride (server error " + err.status + "). Tap Accept again.");
      } else {
        setAcceptNotice("Could not reach the server to accept this ride. Check your signal and tap Accept again.");
      }
      if (clear) {
        state.selectedOpenCode = "";
        clearRideFields();
        writeDriverCode("");
        state.driverCode = "";
        try { localStorage.removeItem(STORE); } catch (e2) {}
        state.openListError = state.acceptNotice;
        refreshOpenRides(true);
      }
      render();
    });
  }

  function denySelectedOpenRide() {
    stopOpenRideAlert();
    var code = state.selectedOpenCode || state.code || "";
    var account = readDriverAccount();
    var record = buildRefusalRecord(currentRide() || selectedOpenRide(), account);
    postRefusal(record).catch(function () {});
    state.selectedOpenCode = "";
    clearRideFields();
    writeDriverCode("");
    state.driverCode = "";
    try { localStorage.removeItem(STORE); } catch (err) {}
    render();
    refreshOpenRides(true);
  }

  var BOARD_CENTER = { lat: 30.39, lng: -95.65 };
  var boardMapEl = null;

  function boardMapStillMounted() {
    var el = document.getElementById("live-map");
    return !!(liveMap && el && boardMapEl === el && el._leaflet_id);
  }

  function fitDriverBoard(bounds) {
    if (!liveMap) return;
    if (bounds.length >= 2) {
      liveMap.fitBounds(window.L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 13 });
    } else if (bounds.length === 1) {
      liveMap.setView(bounds[0], 12);
    } else if (isFinite(state.hereLat) && isFinite(state.hereLng)) {
      liveMap.setView([+state.hereLat, +state.hereLng], 12);
    } else {
      liveMap.setView([BOARD_CENTER.lat, BOARD_CENTER.lng], 11);
    }
  }

  function syncDriverBoardMarkers() {
    if (!boardMapStillMounted()) return;
    if (state.boardMarkers) {
      state.boardMarkers.clearLayers();
    } else {
      state.boardMarkers = window.L.layerGroup().addTo(liveMap);
    }
    var bounds = [];
    if (isFinite(state.hereLat) && isFinite(state.hereLng)) {
      var here = [+state.hereLat, +state.hereLng];
      if (carMarker) {
        carMarker.setLatLng(here);
      } else {
        carMarker = window.L.marker(here, {
          icon: window.L.divIcon({
            className: "pin-icon",
            html: '<div class="car-face">' + CAR_SVG + "</div>",
            iconSize: [44, 44],
            iconAnchor: [22, 22]
          }),
          zIndexOffset: 600
        }).addTo(liveMap);
      }
      bounds.push(here);
    }
    (state.openRides || []).forEach(function (ride) {
      if (!isCoord(ride.pickupLat) || !isCoord(ride.pickupLng)) return;
      var selected = ride.code === state.selectedOpenCode;
      var marker = window.L.marker([+ride.pickupLat, +ride.pickupLng], {
        icon: pinIcon(selected ? "Selected" : "Rider", "pin-you"),
        zIndexOffset: selected ? 500 : 200
      });
      marker.on("click", function () {
        selectOpenRide(ride.code);
      });
      state.boardMarkers.addLayer(marker);
      bounds.push([+ride.pickupLat, +ride.pickupLng]);
    });
    fitDriverBoard(bounds);
    setTimeout(function () {
      if (liveMap) liveMap.invalidateSize();
    }, 80);
  }

  function startDriverBoardMap() {
    if (!window.L) return;
    var el = document.getElementById("live-map");
    if (!el) return;
    if (boardMapStillMounted()) {
      syncDriverBoardMarkers();
      return;
    }
    try {
      if (liveMap) {
        try { liveMap.remove(); } catch (e1) {}
        liveMap = null;
        carMarker = null;
        state.boardMarkers = null;
      }
      boardMapEl = el;
      tilesOk = false;
      liveMap = window.L.map(el, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true
      });
      var layer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(liveMap);
      state.boardMarkers = window.L.layerGroup().addTo(liveMap);
      var boardTileErrors = 0;
      var boardFallbackTiles = false;
      layer.on("tileload", function () {
        tilesOk = true;
        if (liveMap) liveMap.invalidateSize();
      });
      layer.on("tileerror", function () {
        boardTileErrors += 1;
        if (boardFallbackTiles || boardTileErrors < 4 || !liveMap) return;
        boardFallbackTiles = true;
        window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
          maxZoom: 19,
          subdomains: "abcd",
          attribution: "&copy; OpenStreetMap &copy; CARTO"
        }).addTo(liveMap);
      });
      // Never tear down the board map on slow tiles — empty navy box is worse than waiting.
      setTimeout(function () {
        if (liveMap) liveMap.invalidateSize();
      }, 100);
      setTimeout(function () {
        if (liveMap) liveMap.invalidateSize();
      }, 500);
      syncDriverBoardMarkers();
    } catch (err) {
      boardMapEl = null;
      // Keep the container; do not call fallbackMap (that deletes the map with no illus on the board).
    }
  }

  function startCustomerMap() {
    if (!placeCoords("pickup") || !placeCoords("drop")) return;
    if (!window.L || !document.getElementById("live-map")) return;
    var pickup = placeCoords("pickup");
    var drop = placeCoords("drop");
    var driver = state.screen === "trip" ? savedDriverPoint() : null;
    try {
      liveMap = window.L.map("live-map", {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true
      });
      var layer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(liveMap);
      var road = routeLatLngs(pickup, drop);
      var bounds = road.slice();
      if (driver) bounds.push([driver.lat, driver.lng]);
      window.L.polyline(road, { color: "#d4b15a", weight: 4, opacity: 0.9 }).addTo(liveMap);
      if (driver) {
        window.L.polyline([[driver.lat, driver.lng], [pickup.lat, pickup.lng]], {
          color: "#d4b15a", weight: 3, opacity: 0.45, dashArray: "6 8"
        }).addTo(liveMap);
      }
      window.L.marker([pickup.lat, pickup.lng], { icon: pinIcon("Pickup", "pin-you") }).addTo(liveMap);
      window.L.marker([drop.lat, drop.lng], { icon: pinIcon("Drop-off", "pin-drop") }).addTo(liveMap);
      viaPoints().forEach(function (p, i) {
        window.L.marker([p.lat, p.lng], { icon: pinIcon("Stop " + (i + 1), "pin-drop") }).addTo(liveMap);
      });
      if (driver) {
        carMarker = window.L.marker([driver.lat, driver.lng], {
          icon: window.L.divIcon({
            className: "pin-icon",
            html: '<div class="car-face">' + CAR_SVG + "</div>",
            iconSize: [44, 44],
            iconAnchor: [22, 22]
          }),
          zIndexOffset: 500
        }).addTo(liveMap);
      }
      liveMap.fitBounds(window.L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
      layer.on("tileload", function () {
        if (tilesOk) return;
        tilesOk = true;
        var illus = document.getElementById("illus");
        if (illus) illus.classList.add("is-hidden");
        setTimeout(function () {
          if (liveMap) liveMap.invalidateSize();
        }, 60);
      });
      var tileErrors = 0;
      layer.on("tileerror", function () {
        tileErrors += 1;
        if (tileErrors >= 6 && !tilesOk) fallbackMap();
      });
      tileTimer = setTimeout(function () {
        if (!tilesOk) fallbackMap();
      }, 5000);
    } catch (err) {
      fallbackMap();
    }
  }

  function startMap() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var route = routePoints();
    var origin = route.driver;
    var dest = route.pickup;

    function frame(now) {
      if (!motionStart) motionStart = now;
      var duration = 22000;
      var hold = 2800;
      var elapsed = (now - motionStart) % (duration + hold);
      var t = Math.min(elapsed / duration, 1);
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      var along = eased * 0.9;
      var lat = origin.lat + (dest.lat - origin.lat) * along;
      var lng = origin.lng + (dest.lng - origin.lng) * along;
      var here = { lat: lat, lng: lng };
      placeCar(lat, lng, bearing(here, dest));
      rafId = requestAnimationFrame(frame);
    }

    var startPoint = project(origin);
    var pinCar = document.getElementById("pin-car");
    if (pinCar) {
      pinCar.style.left = startPoint.x + "%";
      pinCar.style.top = startPoint.y + "%";
    }

    tryLiveMap();

    if (isFinite(state.hereLat)) {
      placeCar(+state.hereLat, +state.hereLng, bearing({ lat: +state.hereLat, lng: +state.hereLng }, dest));
    } else if (reduce) {
      var midLat = origin.lat + (dest.lat - origin.lat) * 0.45;
      var midLng = origin.lng + (dest.lng - origin.lng) * 0.45;
      placeCar(midLat, midLng, bearing({ lat: midLat, lng: midLng }, dest));
    } else {
      rafId = requestAnimationFrame(frame);
    }
  }

  function pinIcon(label, kind) {
    return window.L.divIcon({
      className: "pin-icon",
      html: '<div class="pin-float ' + kind + '"><span class="pin-label">' + esc(label) + '</span><span class="pin-head"></span></div>',
      iconSize: [88, 46],
      iconAnchor: [44, 44]
    });
  }

  function tryLiveMap() {
    if (!window.L || !document.getElementById("live-map")) return;
    try {
      liveMap = window.L.map("live-map", {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true
      });
      var layer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(liveMap);
      var route = routePoints();
      var road = route.live
        ? routeLatLngs(route.pickup, route.dropoff)
        : [[route.driver.lat, route.driver.lng], [route.pickup.lat, route.pickup.lng], [route.dropoff.lat, route.dropoff.lng]];
      window.L.polyline(road, { color: "#d4b15a", weight: 4, opacity: 0.9 }).addTo(liveMap);
      var youLabel = state.mode === "driver" ? "Customer" : "You";
      riderMarker = null;
      var beforePickup = ROLE === "driver" && state.rideStatus !== "started" && state.rideStatus !== "completed";
      if (beforePickup && placeCoords("pickup")) {
        /* v51: rider's photo as a round pin at their live phone location (or the pickup point). */
        var riderAt = riderLivePoint();
        if (riderAt) window.L.marker([route.pickup.lat, route.pickup.lng], { icon: pinIcon("Pickup", "pin-you") }).addTo(liveMap);
        var riderPt = riderAt || route.pickup;
        riderMarker = window.L.marker([riderPt.lat, riderPt.lng], { icon: riderPhotoIcon(), zIndexOffset: 700 }).addTo(liveMap);
      } else {
        window.L.marker([route.pickup.lat, route.pickup.lng], { icon: pinIcon(youLabel, "pin-you") }).addTo(liveMap);
      }
      window.L.marker([route.dropoff.lat, route.dropoff.lng], { icon: pinIcon("Drop-off", "pin-drop") }).addTo(liveMap);
      carMarker = window.L.marker([route.driver.lat, route.driver.lng], {
        icon: window.L.divIcon({
          className: "pin-icon",
          html: '<div class="car-face">' + CAR_SVG + "</div>",
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }),
        zIndexOffset: 500
      }).addTo(liveMap);
      var boundPts = road.slice();
      boundPts.push([route.driver.lat, route.driver.lng]);
      liveMap.fitBounds(window.L.latLngBounds(boundPts), { padding: [28, 28], maxZoom: 14 });
      nearPickupZoom(true);
      layer.on("tileload", function () {
        if (tilesOk) return;
        tilesOk = true;
        var illus = document.getElementById("illus");
        if (illus) illus.classList.add("is-hidden");
        setTimeout(function () {
          if (liveMap) liveMap.invalidateSize();
        }, 60);
      });
      var tileErrors = 0;
      layer.on("tileerror", function () {
        tileErrors += 1;
        if (tileErrors >= 6 && !tilesOk) fallbackMap();
      });
      tileTimer = setTimeout(function () {
        if (!tilesOk) fallbackMap();
      }, 5000);
    } catch (err) {
      fallbackMap();
    }
  }

  function fallbackMap() {
    tilesOk = false;
    if (liveMap) {
      liveMap.remove();
      liveMap = null;
    }
    carMarker = null;
    riderMarker = null;
    var illus = document.getElementById("illus");
    if (illus) illus.classList.remove("is-hidden");
  }

  function refreshLiveTripMilesUi(force) {
    if (ROLE !== "driver" || state.rideStatus !== "started") return;
    var now = Date.now();
    if (!force && now - lastTripMilesUiAt < 1500) return;
    lastTripMilesUiAt = now;
    var card = document.getElementById("driver-fare-card");
    if (!card) return;
    var est = estimate();
    if (!est.ready) return;
    var milesEl = card.querySelector("[data-live-miles]");
    var subEl = card.querySelector("[data-live-sub]");
    var taxEl = card.querySelector("[data-live-tax]");
    var totalEl = card.querySelector("[data-live-total]");
    if (milesEl) milesEl.textContent = est.raw.toFixed(2) + " mi, billed as " + est.billed;
    if (subEl) subEl.textContent = money(est.sub);
    if (taxEl) taxEl.textContent = money(est.tax);
    if (totalEl) totalEl.textContent = money(est.total);
    var commEl = card.querySelector("[data-live-comm]");
    if (commEl) commEl.textContent = money(commissionCentsFor(est) || 0);
  }

  function onGpsFix(pos) {
    if (!pos || !pos.coords) return;
    var first = !isFinite(state.hereLat);
    state.hereLat = pos.coords.latitude;
    state.hereLng = pos.coords.longitude;
    state.driverLat = state.hereLat;
    state.driverLng = state.hereLng;
    if (ROLE === "driver") {
      noteSpeed(pos);
      trackDailyMiles(pos);
      refreshMilesTodayDom();
    }
    var ride = currentRide();
    if (syncOn()) {
      var driverCode = state.driverCode || readDriverCode();
      if (!ride || !driverCode || ride.code !== driverCode) ride = null;
    }
    if (ride && (ride.driverLat !== state.hereLat || ride.driverLng !== state.hereLng)) {
      ride.driverLat = state.hereLat;
      ride.driverLng = state.hereLng;
      localStorage.setItem(STORE, JSON.stringify(ride));
    }
    var pathBefore = (state.tripPath || []).length;
    recordTripPoint(state.hereLat, state.hereLng);
    var pathGrew = (state.tripPath || []).length > pathBefore;
    maybePatchDriverLocation();
    if (pathGrew || state.rideStatus === "started") refreshLiveTripMilesUi(pathGrew);
    if (ROLE === "driver" && state.screen === "trip") {
      refreshEtaDoms();
      nearPickupZoom(false);
    }
    if (ROLE === "driver" && state.screen === "home" && boardMapStillMounted()) {
      syncDriverBoardMarkers();
      publishDriverPresence();
    } else if (carMarker) {
      var dest;
      if (state.screen === "home") {
        dest = { lat: state.hereLat, lng: state.hereLng };
      } else if (state.rideStatus === "started" && placeCoords("drop")) {
        dest = placeCoords("drop");
      } else {
        dest = routePoints().pickup;
      }
      placeCar(state.hereLat, state.hereLng, bearing(
        { lat: state.hereLat, lng: state.hereLng },
        dest
      ));
      if (ROLE === "driver") publishDriverPresence();
    } else if (first) {
      render();
      if (ROLE === "driver") publishDriverPresence();
    } else if (ROLE === "driver") {
      publishDriverPresence();
    }
  }

  function nudgeGps() {
    if (!navigator.geolocation || ROLE !== "driver" || !signedIn()) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    var now = Date.now();
    if (now - lastGpsPollAt < 3500) return;
    lastGpsPollAt = now;
    navigator.geolocation.getCurrentPosition(onGpsFix, function () {}, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 8000
    });
  }

  function followGps() {
    if (!navigator.geolocation) return;
    if (!state.gpsWatch) {
      state.gpsWatch = navigator.geolocation.watchPosition(onGpsFix, function () {}, {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000
      });
    }
    nudgeGps();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var sheetHost = document.createElement("div");
    sheetHost.id = "sheet";
    sheetHost.className = "sheet-back";
    sheetHost.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<p class="tag">Preview only</p>' +
      '<h3 id="sheet-title">Preview message</h3>' +
      "<p class=\"lede\">This preview does not send a text. For real help call " + BUSINESS_PHONE + ".</p>" +
      '<pre class="draft" id="draft"></pre>' +
      '<button class="btn" type="button" id="close-sheet">Close</button>' +
      "</div>";
    document.body.appendChild(sheetHost);
    sheetHost.addEventListener("click", function (event) {
      if (event.target === sheetHost) closePreview();
    });
    document.getElementById("close-sheet").addEventListener("click", closePreview);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closePreview();
    });
    v51Styles();
    if (ROLE === "driver") {
      /* iOS only lets sound play after a tap; every tap re-arms it (it is suspended after the app was hidden). */
      setPlaybackAudioSession();
      document.addEventListener("touchstart", keepRideAudioAwake, true);
      document.addEventListener("pointerdown", keepRideAudioAwake, true);
      document.addEventListener("touchend", keepRideAudioAwake, true);
      document.addEventListener("click", keepRideAudioAwake, true);
      if (signedIn()) showRideSoundBar();
      document.addEventListener("visibilitychange", function () {
        /* iOS suspends sound while the app is hidden: ask for a tap again if it did not come back on its own. */
        if (document.visibilityState !== "visible") return;
        setTimeout(function () { if (!rideSoundRunning() && signedIn()) showRideSoundBar(); }, 800);
      });
    }
    setInterval(refreshEtaDoms, 5000);
    if (ROLE === "driver" && signedIn()) {
      loadRideHistory();
      ensureMilesDayReady();
      followGps();
      acquireWakeLock();
      refreshRosterStatus().then(function () {
        if (canGoOnline()) {
          refreshOpenRides(true);
          publishDriverPresence();
        }
        refreshScheduledRides(true);
        render();
      });
    }
    window.addEventListener("storage", function (event) {
      if (event.key !== STORE) return;
      syncRide();
    });
    setInterval(function () {
      syncRide();
    }, 1000);
    setInterval(pullRemoteRide, 3000);
    setInterval(function () { if (chatOpenForRole()) loadChatMessages(); }, 3000);
    setInterval(pollDriverRideCancel, 5000);
    setInterval(function () {
      if (ROLE === "driver" && signedIn() && canGoOnline() && driverCanTakeNew()) refreshOpenRides();
    }, 3000);
    setInterval(function () {
      if (ROLE === "driver" && signedIn() && !state.hubOpen) refreshScheduledRides(false);
    }, 20000);
    setInterval(function () {
      if (ROLE === "driver" && signedIn()) publishDriverPresence();
    }, 20000);
    setInterval(function () {
      if (ROLE === "driver" && signedIn()) {
        var prev = state.rosterStatus;
        refreshRosterStatus().then(function () {
          if (state.rosterStatus !== prev) render();
        });
      }
    }, 15000);
    setInterval(function () {
      if (ROLE === "customer" && signedIn()) refreshOnlineDrivers();
    }, 5000);
    window.addEventListener("pagehide", function () {
      if (ROLE === "driver" && signedIn()) clearDriverPresence();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (ROLE === "driver" && signedIn()) {
        nudgeGps();
        acquireWakeLock(); /* the browser drops the lock when the app is hidden */
        refreshMilesTodayDom();
      }
    });
    if (ROLE === "driver") {
      /* Some browsers only grant the lock after a tap. */
      document.addEventListener("pointerdown", function () { acquireWakeLock(); }, true);
      setInterval(refreshMilesTodayDom, 30000);
    }
    setInterval(function () {
      if (ROLE !== "driver" || !signedIn()) return;
      if (document.visibilityState === "hidden") return;
      /* Backup when watchPosition goes quiet in foreground (Safari quirk). */
      if (state.screen === "home" || driverMidRide()) nudgeGps();
    }, 4000);
    if (ROLE !== "driver" && signedIn()) {
      maybeRestoreCustomerRide();
      restoreFromActiveMark();
    }
    if (signedIn() && !accountSyncTried) {
      accountSyncTried = true;
      syncAccountProfile(ROLE === "driver" ? "driver" : "rider", accountForRole());
    }
    if (ROLE === "driver" && signedIn()) {
      syncDriverProfile().then(function () { render(); });
    }
    render();
  });

  function syncRide() {
    if (!signedIn()) return;
    var ride = currentRide();
    if (ROLE === "driver") {
      if (state.screen === "home") return;
      if (syncOn()) {
        if (state.remoteLoading) return;
        var want = state.driverCode || readDriverCode();
        if (!want) return;
        if (!ride || ride.code !== want) return;
      }
      var stamp = ride ? ride.status + "|" + ride.pickupStreet + "|" + ride.name + "|" + (ride.code || "") : "";
      if (stamp === state.syncStamp) return;
      state.syncStamp = stamp;
      if (!ride || !ride.pickupStreet) clearRideFields();
      else applyRide(ride);
      if (state.screen === "trip" && ride && (ride.status === "accepted" || ride.status === "started" || ride.status === "completed")) return;
      if (state.screen !== "home" && (!ride || (ride.status !== "accepted" && ride.status !== "started" && ride.status !== "completed"))) state.screen = "home";
      render();
      return;
    }
    if (state.screen === "home") {
      /* v52: if a ride is open (another tab, reopened app), swap the request form for "Back to my ride", and back again once it ends. */
      var open = activeRiderRide();
      var showing = !!document.getElementById("active-ride-card");
      if (!!open !== showing) render();
      else if (open) refreshActiveRideStatus(open.code);
      return;
    }
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    if (!ride) return;
    ingestCustomerRide(ride);
  }

  /* v54 test hooks (no UI). */
  window.__pcsApp = {
    playRideSiren: playRideSiren,
    playRideChime: playRideChime,
    stopOpenRideAlert: stopOpenRideAlert,
    showRideSoundBar: showRideSoundBar,
    chatOpenForRole: chatOpenForRole,
    sendChatMessage: sendChatMessage,
    loadChatMessages: loadChatMessages,
    loadRiderHistory: loadRiderHistory,
    rememberRiderHistoryEntry: rememberRiderHistoryEntry
  };

})();
