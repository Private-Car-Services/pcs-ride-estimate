/* Private Car Services starter. Preview only: no texts, no charges, no API key. Shared rides use Firebase REST when PCS_SYNC.databaseURL is set. */
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

  function isOwnerSession() {
    var a = pcsAuth();
    return !!(a && a.isOwnerSignedIn && a.isOwnerSignedIn());
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

  function openRideAlertMuted() {
    try { return localStorage.getItem("pcs-driver-alert-mute") === "1"; } catch (err) { return false; }
  }

  function setOpenRideAlertMuted(on) {
    try { localStorage.setItem("pcs-driver-alert-mute", on ? "1" : "0"); } catch (err) {}
  }

  function unlockOpenRideAudio() {
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
    /* Default: short doorbell-style chime (ding–dong). Mute toggle still available. */
    if (openRideAlertMuted() || !openRideAudioUnlocked) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!openRideAudioCtx) openRideAudioCtx = new AC();
      var ctx = openRideAudioCtx;
      if (ctx.state === "suspended") ctx.resume();
      function tone(freq, start, dur, peak) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.exponentialRampToValueAtTime(peak || 0.2, start + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.start(start);
        o.stop(start + dur + 0.02);
      }
      var now = ctx.currentTime;
      tone(880, now, 0.22, 0.55); /* louder ding */          /* ding */
      tone(659.25, now + 0.28, 0.5, 0.5); /* louder dong */ /* dong */
    } catch (err) {}
    try {
      if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
    } catch (err2) {}
  }

  function countAlertableOpenRides() {
    var list = state.openRides || [];
    var n = 0;
    list.forEach(function (r) {
      if (!r) return;
      if (r.isTest) return; /* never alert other drivers for TEST */
      if (String(r.status || "requested") !== "requested") return;
      n += 1;
    });
    return n;
  }

  function stopOpenRideAlert() {
    if (openRideAlertTimer) {
      clearInterval(openRideAlertTimer);
      openRideAlertTimer = null;
    }
  }

  function syncOpenRideAlert() {
    if (ROLE !== "driver" || !signedIn() || !canGoOnline()) {
      stopOpenRideAlert();
      return;
    }
    if (state.screen === "trip") {
      stopOpenRideAlert();
      return;
    }
    var n = countAlertableOpenRides();
    if (!n || openRideAlertMuted()) {
      stopOpenRideAlert();
      return;
    }
    if (openRideAlertTimer) return;
    beepOpenRideOnce();
    openRideAlertTimer = setInterval(function () {
      if (!countAlertableOpenRides() || openRideAlertMuted() || state.screen === "trip") {
        stopOpenRideAlert();
        return;
      }
      beepOpenRideOnce();
    }, 4000);
  }

  function openRideAlertToggleHtml() {
    if (ROLE !== "driver" || !signedIn()) return "";
    var muted = openRideAlertMuted();
    return '<button class="btn ghost" type="button" id="toggle-ride-alert">' +
      (muted ? "Unmute ride alert" : "Mute ride alert") + "</button>";
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
    dropStreet: SAMPLE.dropStreet,
    dropCity: SAMPLE.dropCity,
    dropState: SAMPLE.dropState,
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
    hubDay: "",
    commHidden: false,
    paymentSkipped: false,
    rosterStatus: "",
    rosterPct: Math.round(DRIVER_COMMISSION_RATE * 100),
    dayRequested: 0
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

  function ensureMilesDayReady() {
    if (ROLE !== "driver" || !signedIn()) return;
    var row = todayMilesRow();
    if (row && row.startOdometer != null && isFinite(Number(row.startOdometer))) {
      state.milesNeedStart = false;
      state.milesToday = Number(row.gpsMiles) || 0;
      state.milesStartOdo = Number(row.startOdometer);
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
    if (!pos || !pos.coords) return;
    var acc = Number(pos.coords.accuracy);
    /* City / pocket GPS often reports 40–70 m; 50 was dropping real fixes. */
    if (isFinite(acc) && acc > 85) return;
    var lat = Number(pos.coords.latitude);
    var lng = Number(pos.coords.longitude);
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
    /* Keep the previous anchor until we see real movement (~8 m). */
    if (!(dist >= 0.005)) return;
    var hours = (now - prevAt) / 3600000;
    if (!(hours > 0)) return;
    var mph = dist / hours;
    var MAX_MPH = 90;
    /*
      Old bug: we advanced the GPS anchor, then discarded the segment when
      mph > 100. After iOS throttled watchPosition (Maps / locked screen),
      the next jump looked "too fast" and those miles were permanently lost —
      counter frozen while the car kept driving.
      Cap credit at MAX_MPH instead of dropping the segment.
    */
    if (mph > MAX_MPH) {
      if (hours < 1 / 3600) return; /* sub-second spike — ignore, keep anchor */
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
    if (row.startOdometer == null || !isFinite(Number(row.startOdometer))) return;
    row.gpsMiles = Math.round(((Number(row.gpsMiles) || 0) + dist) * 10) / 10;
    row.lastUpdate = now;
    if (!row.startedAt) row.startedAt = now;
    persistMilesRow(row);
    var el = document.getElementById("miles-today");
    if (el) el.textContent = "Today: " + row.gpsMiles.toFixed(1) + " mi";
  }

  function milesTodayLabel() {
    var n = Number(state.milesToday) || 0;
    return "Today: " + n.toFixed(1) + " mi";
  }

  function vehicleNeededCard() {
    if (ROLE !== "driver" || !signedIn() || driverMidRide()) return "";
    if (hasCompleteCar(readDriverAccount())) return "";
    return (
      '<div class="card vehicle-needed">' +
      '<p class="tag">Car details required</p>' +
      '<p class="lede">Add your car year, make, model, plate, seats, and a front-right photo before going online.</p>' +
      '<a class="btn" href="signup/?v=21">Complete vehicle profile</a>' +
      "</div>"
    );
  }

  function milesStartCard() {
    if (ROLE !== "driver" || !signedIn() || !state.milesNeedStart) return "";
    if (!hasCompleteCar(readDriverAccount())) return "";
    if (driverMidRide()) return "";
    return (
      '<div class="card miles-gate" id="miles-gate">' +
      '<p class="tag">Starting mileage</p>' +
      '<p class="lede">Enter the starting odometer for today before you go online. Chicago calendar day.</p>' +
      '<form id="miles-start-form" autocomplete="off">' +
      '<label for="miles-start-odo">Starting odometer</label>' +
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
    return '<p><strong>Your commission</strong> ' + money(cents) + '</p>' +
      '<p class="fine">' + pct + '% of the fare before tax and fees. Estimate only · not a payout.</p>';
  }

  function driverIdentityLine() {
    var img = photoImg(state.driverPhoto);
    var carImg = carPhotoImg(state.driverCarPhoto);
    if (!state.driverName && !img && !carImg && !state.driverCarPlate) return "";
    var phone = "";
    if (state.driverPhone) {
      var tel = String(state.driverPhone).replace(/[^\d+]/g, "");
      phone = ' <a href="tel:' + esc(tel) + '">' + esc(state.driverPhone) + "</a>";
    }
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
    if (state.rideStatus !== "accepted") return "";
    var eta = driverPickupEta();
    if (!eta) return "";
    if (eta.miles <= 0.08) return "Driver is arriving";
    return "Driver is " + eta.miles.toFixed(1) + " mi away · ~" + eta.minutes + " min";
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

  function routeKey(a, b) {
    return a.lat.toFixed(5) + "," + a.lng.toFixed(5) + ">" + b.lat.toFixed(5) + "," + b.lng.toFixed(5);
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
    var url = "https://router.project-osrm.org/route/v1/driving/" +
      a.lng + "," + a.lat + ";" + b.lng + "," + b.lat +
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
    return [[a.lat, a.lng], [b.lat, b.lng]];
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
        hundredths = Math.round(haversine(pickup, dropoff) * 100) / 100;
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

  function paymentHoldCopy() {
    var testing = testSkipPayEnabled();
    var skipped = !!state.paymentSkipped;
    var skipBlock = "";
    if (testing) {
      skipBlock = skipped
        ? '<p class="fine" id="pay-skip-status">Testing: payment skipped — no charge.</p>'
        : ('<button class="btn ghost" type="button" id="skip-pay-btn">Skip for testing</button>' +
          '<p class="fine">Testing only · payment not required · no real Square charge.</p>');
    }
    return (
      '<div class="card payment-card">' +
      '<p class="tag">Payment' + (testing ? " · testing" : "") + "</p>" +
      '<p class="lede">Add your card before the ride. You are not charged until after drop-off, so you can add a tip.</p>' +
      '<p class="fine">A real card hold uses Square on a secure server. This screen never stores a card number or Square secret.</p>' +
      '<button class="btn secondary" type="button" id="square-hold-btn">Continue to Square (card setup)</button>' +
      '<p class="fine" id="square-hold-help"></p>' +
      skipBlock +
      "</div>"
    );
  }

  function cancelWarningCopy() {
    var fee = cancelFeeCents();
    return (
      "If you cancel before pickup, a cancel fee of " + money(fee) +
      " may apply (25% of the estimate or $10, whichever is more). " +
      "Automatic card charges are not live yet — if you cancel, we will follow up about any fee."
    );
  }

  var SQUARE_CARD_SETUP_URL = "https://squareup.com/appointments/book/L077DQHSNJAG6";

  function openSquareCardSetup() {
    var help = document.getElementById("square-hold-help");
    if (!SQUARE_CARD_SETUP_URL) {
      if (help) help.textContent = "Square card setup link is not configured yet. A real hold needs a server or Square payment link.";
      return;
    }
    if (help) help.textContent = "Opening Square for card setup. You are not charged until after the ride.";
    window.open(SQUARE_CARD_SETUP_URL, "_blank", "noopener,noreferrer");
  }

  function openTurnByTurnToDrop() {
    var drop = placeCoords("drop");
    if (!drop) return false;
    var dest = (+drop.lat) + "," + (+drop.lng);
    var ua = navigator.userAgent || "";
    var ios = /iPhone|iPad|iPod/i.test(ua);
    var url = ios
      ? "https://maps.apple.com/?daddr=" + encodeURIComponent(dest) + "&dirflg=d"
      : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest) + "&travelmode=driving";
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
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

  function cancelRiderRide() {
    if (ROLE !== "customer") return;
    if (state.rideStatus === "started" || state.rideStatus === "completed") return;
    if (state.rideStatus !== "requested" && state.rideStatus !== "accepted") return;
    var msg = cancelWarningCopy() + "\n\nCancel this ride?";
    if (!window.confirm(msg)) return;
    var fee = cancelFeeCents();
    var code = state.code;
    if (syncOn() && code) {
      patchRide(code, { status: "cancelled", cancelFeeCents: fee, cancelledBy: "rider" }).catch(function () {});
      deleteOpenRide(code).catch(function () {});
    }
    try { localStorage.removeItem(STORE); } catch (err) {}
    writeRideOwner("");
    clearRideFields();
    state.screen = "home";
    render();
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

  function addressLine(street, city, stateName) {
    var cityState = [city, stateName].filter(Boolean).join(", ");
    return [street, cityState].filter(Boolean).join(", ");
  }

  function pickupLine() {
    return addressLine(state.pickupStreet, state.pickupCity, state.pickupState);
  }

  function dropLine() {
    return addressLine(state.dropStreet, state.dropCity, state.dropState);
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

  function stateCode(name) {
    var known = { texas: "TX", louisiana: "LA", oklahoma: "OK", arkansas: "AR" };
    if (!name) return "TX";
    var n = String(name).trim();
    if (n.length === 2) return n.toUpperCase();
    return known[n.toLowerCase()] || "TX";
  }

  function placeLine(p) {
    var street = [p.housenumber, p.street].filter(Boolean).join(" ");
    if (p.name && street && p.name.toLowerCase() !== street.toLowerCase()) return p.name + ", " + street;
    return p.name || street || "";
  }

  function setCoords(prefix, feature) {
    var coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords) return;
    state[prefix + "Lng"] = coords[0];
    state[prefix + "Lat"] = coords[1];
  }

  function applyPlace(prefix, feature) {
    var p = feature.properties || feature;
    var streetEl = document.getElementById(prefix + "-street");
    var cityEl = document.getElementById(prefix + "-city");
    var stateEl = document.getElementById(prefix + "-state");
    if (streetEl) streetEl.value = placeLine(p);
    if (cityEl && (p.city || p.county)) cityEl.value = p.city || p.county;
    if (stateEl) stateEl.value = stateCode(p.state);
    state[prefix + "Street"] = streetEl ? streetEl.value : placeLine(p);
    if (cityEl) state[prefix + "City"] = cityEl.value;
    if (stateEl) state[prefix + "State"] = stateEl.value;
    setCoords(prefix, feature);
    if (prefix === "drop") {
      state.dropFix = pointFrom(state.dropLat, state.dropLng);
      state.useDrivenMiles = false;
      state.endedEarly = false;
      driving.key = "";
      driving.done = false;
      driving.miles = null;
      driving.line = null;
      if (ROLE === "driver" && state.rideStatus === "started") {
        syncActiveTripFare();
        render();
      }
    }
  }


  var CITY_BIAS = {
    montgomery: { lat: 30.39, lon: -95.70 },
    conroe: { lat: 30.31, lon: -95.46 },
    "the woodlands": { lat: 30.17, lon: -95.46 },
    woodlands: { lat: 30.17, lon: -95.46 },
    magnolia: { lat: 30.21, lon: -95.75 },
    tomball: { lat: 30.10, lon: -95.62 },
    spring: { lat: 30.08, lon: -95.42 },
    humble: { lat: 30.00, lon: -95.26 },
    "new caney": { lat: 30.15, lon: -95.22 },
    porter: { lat: 30.11, lon: -95.23 },
    navasota: { lat: 30.39, lon: -96.09 }
  };
  var FALLBACK_BIAS = { lat: 30.05, lon: -95.4 };
  var KNOWN_CITIES = [
    "the woodlands", "new caney", "montgomery", "conroe", "magnolia", "tomball",
    "spring", "humble", "porter", "navasota", "willis", "houston"
  ];

  function normText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function hasWord(text, word) {
    if (!word) return false;
    return (" " + normText(text) + " ").indexOf(" " + word + " ") !== -1;
  }

  function biasFor(city) {
    var key = normText(city);
    if (CITY_BIAS[key]) return CITY_BIAS[key];
    return FALLBACK_BIAS;
  }

  function cityFromText(text) {
    var hay = " " + normText(text) + " ";
    var found = "";
    var i;
    for (i = 0; i < KNOWN_CITIES.length; i += 1) {
      if (hay.indexOf(" " + KNOWN_CITIES[i] + " ") !== -1 && KNOWN_CITIES[i].length > found.length) found = KNOWN_CITIES[i];
    }
    return found;
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

  function scoreFeature(feature, text, city) {
    var props = feature.properties || {};
    var tokens = focusTokens(text, city);
    var name = props.name || "";
    var street = [props.housenumber, props.street].filter(Boolean).join(" ");
    var osmValue = String(props.osm_value || "").toLowerCase();
    var osmKey = String(props.osm_key || "").toLowerCase();
    var score = 0;
    var i;
    for (i = 0; i < tokens.length; i += 1) {
      var weight = i === 0 ? 14 : 6;
      if (hasWord(name, tokens[i])) score += weight;
      if (hasWord(street, tokens[i])) score += 4;
    }
    if (city) {
      if (sameCity(props, city)) score += 12;
      else if (normText(props.city || props.town || props.village || "")) score -= 10;
      else score -= 3;
    }
    var q = normText(text);
    var inCity = !city || sameCity(props, city);
    if (q.indexOf("walmart") !== -1) {
      if (inCity && (osmValue === "supermarket" || hasWord(name, "walmart"))) score += 28;
      if (osmValue === "golf_course" || osmKey === "leisure") score -= 36;
      if (osmKey === "highway" || osmValue === "residential" || osmValue === "neighbourhood" || osmValue === "neighborhood" || osmValue === "suburb") score -= 24;
    }
    if (tokens.length && hasWord(name, tokens[0])) {
      if (osmValue === "supermarket" || osmValue === "department_store" || osmValue === "mall") score += 8;
      if (osmValue === "fuel" && q.indexOf("gas") === -1 && q.indexOf("fuel") === -1) score -= 4;
    }
    if (tokens.length && !hasWord(name, tokens[0]) && !hasWord(street, tokens[0])) {
      if (osmKey === "leisure" || osmKey === "highway" || osmKey === "place") score -= 16;
    }
    var point = featurePoint(feature);
    if (point) {
      var bias = biasFor(city);
      score -= Math.min(haversine(point, { lat: bias.lat, lng: bias.lon }), 80) * 0.2;
    }
    return score;
  }

  function rankFeatures(features, text, city) {
    var seen = {};
    var ranked = [];
    (features || []).forEach(function (feature) {
      var props = feature.properties || {};
      var point = featurePoint(feature);
      var id = String(props.osm_id || "") + "|" + normText(props.name) + "|" +
        (point ? point.lat.toFixed(5) + "," + point.lng.toFixed(5) : "");
      if (seen[id]) return;
      seen[id] = 1;
      ranked.push(feature);
      feature._score = scoreFeature(feature, text, city);
    });
    ranked.sort(function (a, b) { return b._score - a._score; });
    return ranked;
  }

  function composeQuery(text, city, stateName) {
    var parts = [];
    var base = String(text || "").trim();
    if (base) parts.push(base);
    var low = base.toLowerCase();
    if (city && low.indexOf(String(city).toLowerCase()) === -1) parts.push(city);
    var st = String(stateName || "TX").trim();
    if (st && low.indexOf(st.toLowerCase()) === -1) parts.push(st);
    if (low.indexOf("texas") === -1 && st.toUpperCase() === "TX") parts.push("Texas");
    return parts.filter(Boolean).join(", ");
  }

  function photonSearch(q, bias) {
    var url = "https://photon.komoot.io/api/?limit=8&lat=" + bias.lat + "&lon=" + bias.lon + "&q=" + encodeURIComponent(q);
    return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      return (data && data.features) || [];
    }).catch(function () { return []; });
  }

  function placeQueryCity(text, city) {
    return city || cityFromText(text) || "";
  }

  function collectPlaces(text, city, stateName) {
    var usedCity = placeQueryCity(text, city);
    var bias = biasFor(usedCity);
    var query = composeQuery(text, usedCity, stateName || "TX");
    return photonSearch(query, bias).then(function (features) {
      var tokens = focusTokens(text, usedCity);
      var first = tokens[0];
      if (!first || looksLikeAddress(text)) return features;
      var named = features.some(function (feature) {
        var props = feature.properties || {};
        return hasWord(props.name, first) || hasWord(props.street, first);
      });
      if (named) return features;
      return photonSearch(composeQuery(first, usedCity, stateName || "TX"), bias).then(function (more) {
        return features.concat(more);
      });
    });
  }

  function typedCity(prefix) {
    var el = document.getElementById(prefix + "-city");
    if (el && el.value.trim()) return el.value.trim();
    return state[prefix + "City"] || "";
  }

  function typedState(prefix) {
    var el = document.getElementById(prefix + "-state");
    if (el && el.value.trim()) return el.value.trim();
    return state[prefix + "State"] || "TX";
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

  function wireSearch(inputId, resultsId, prefix) {
    var input = document.getElementById(inputId);
    var box = document.getElementById(resultsId);
    if (!input || !box) return;
    var timer = 0;
    input.addEventListener("input", function () {
      var q = input.value.trim();
      state[prefix + "Lat"] = null;
      state[prefix + "Lng"] = null;
      if (prefix === "drop") state.dropFix = null;
      if (prefix === "pickup") state.pickupFromHere = false;
      clearTimeout(timer);
      if (q.length < 3) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      timer = setTimeout(function () {
        var city = typedCity(prefix);
        var stateName = typedState(prefix);
        collectPlaces(q, city, stateName).then(function (features) {
          var ranked = rankFeatures(features, q, placeQueryCity(q, city)).slice(0, 5);
          if (input.value.trim() !== q || !ranked.length) {
            box.hidden = true;
            return;
          }
          box._places = ranked;
          box.innerHTML = ranked.map(function (f, i) {
            var p = f.properties || {};
            var sub = [p.city || p.county, stateCode(p.state)].filter(Boolean).join(", ");
            return '<button type="button" class="suggest-item" data-i="' + i + '"><strong>' + esc(placeLine(p)) + "</strong><span>" + esc(sub) + "</span></button>";
          }).join("");
          box.hidden = false;
        }).catch(function () { box.hidden = true; });
      }, 350);
    });
    box.addEventListener("click", function (event) {
      var btn = event.target.closest ? event.target.closest(".suggest-item") : null;
      if (!btn || !box._places) return;
      var feature = box._places[Number(btn.getAttribute("data-i"))];
      if (!feature) return;
      applyPlace(prefix, feature);
      box.hidden = true;
    });
  }

  function wireLocation() {
    var locBtn = document.getElementById("use-location");
    if (!locBtn || !navigator.geolocation) return;
    locBtn.addEventListener("click", function () {
      locBtn.disabled = true;
      locBtn.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(function (pos) {
        var url = "https://photon.komoot.io/reverse?limit=1&lat=" + pos.coords.latitude + "&lon=" + pos.coords.longitude;
        fetch(url).then(function (res) { return res.json(); }).then(function (data) {
          var feature = data.features && data.features[0];
          if (feature) applyPlace("pickup", feature);
          state.pickupLat = pos.coords.latitude;
          state.pickupLng = pos.coords.longitude;
          state.pickupFromHere = true;
          locBtn.disabled = false;
          locBtn.textContent = "Use current location";
        }).catch(function () {
          locBtn.disabled = false;
          locBtn.textContent = "Could not find that place";
        });
      }, function () {
        locBtn.disabled = false;
        locBtn.textContent = "Location unavailable";
      }, { enableHighAccuracy: true, timeout: 10000 });
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
    pin = normalizeStoredPin(local && local.pin);
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

  function patchRideIfMatch(code, partial, etag) {
    var headers = { "Content-Type": "application/json" };
    if (etag) headers["if-match"] = etag;
    return authFetch(rideUrl(code), {
      method: "PATCH",
      headers: headers,
      body: JSON.stringify(partial)
    }).then(function (res) {
      if (res.status === 412) {
        var err = new Error("precondition");
        err.conflict = true;
        throw err;
      }
      if (!res.ok) throw new Error("ride");
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
        out.sort(function (a, b) {
          return String(a.date || "").localeCompare(String(b.date || "")) ||
            String(a.time || "").localeCompare(String(b.time || ""));
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
      startOdometer: state.milesStartOdo
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
    if (!pin) return "";
    return (
      '<div class="pin-box">' +
      '<p class="ride-pin-label">Give your driver this PIN when they arrive</p>' +
      '<p class="ride-pin">' + esc(pin) + "</p>" +
      '<p class="fine">They find your ride on the map. This PIN only starts the trip.</p>' +
      "</div>"
    );
  }

  function driverProfileLink() {
    return '<a class="nav-link" href="signup/?v=21">Profile</a>';
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
      '<div class="route-line"><p>' + esc(pickupLine()) + "</p><p>" + esc(dropLine()) + "</p></div>" +
      '<p class="fine">' + (est.ready
        ? est.raw.toFixed(2) + " mi, billed as " + est.billed + " · about " + money(est.total)
        : "Miles and fare show when both places are found.") + "</p>" +
      commissionLine() +
      seatsWarningForRide(state, readDriverAccount()) +
      '<div class="row-actions">' +
      '<button class="btn" type="button" id="accept-ride">Accept</button>' +
      '<button class="btn secondary" type="button" id="deny-ride">Deny</button>' +
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
      (ride.driverPhone || "") !== (state.driverPhone || "") ||
      safePhoto(ride.driverPhoto) !== safePhoto(state.driverPhoto) ||
      (ride.driverCarPlate || "") !== (state.driverCarPlate || "") ||
      safePhoto(ride.driverCarPhoto) !== safePhoto(state.driverCarPhoto) ||
      String(ride.driverCarYear || "") !== String(state.driverCarYear || "") ||
      String(ride.driverCarMake || "") !== String(state.driverCarMake || "") ||
      String(ride.driverCarModel || "") !== String(state.driverCarModel || "") ||
      String(ride.driverCarSeats || "") !== String(state.driverCarSeats || "");
    if (!statusChanged && !placesChanged && !driverChanged && !codeChanged && !identityChanged) return;
    var screen = state.screen;
    applyRide(ride);
    if (screen === "waiting" && (ride.status === "accepted" || ride.status === "started" || ride.status === "completed")) state.screen = "trip";
    if ((ride.status === "accepted" || ride.status === "started" || ride.status === "completed") && state.screen !== "trip") state.screen = "trip";
    var onlyDriver = !statusChanged && !placesChanged && !identityChanged && driverChanged && state.screen === screen;
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
      var localPin = normalizeStoredPin(local.pin) || normalizeStoredPin(state.pin);
      if (localPin) ride.pin = localPin; /* keep local-only; do not push plaintext pin */
      if (ride.pinHash) state.pinHash = ride.pinHash;
      if (String(ride.status || "").toLowerCase() === "denied") {
        state.rideStatus = "denied";
      }
      try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (err) {}
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
      if (savedRide.status !== "completed" && !rideIsAsap(savedRide) && isPickupInPast(savedRide.date, savedRide.time)) {
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

  function welcomeSrc(file) {
    return (ROLE === "driver" ? "../" : "") + file;
  }

  function accountGate() {
    return (
      '<img class="welcome-logo" alt="Private Car Services" src="' + welcomeSrc(ROLE === "driver" ? "welcome-logo-driver.png" : "welcome-logo.png") + '">' +
      '<form id="login-form" autocomplete="off" novalidate>' +
      '<label for="login-email">Email</label>' +
      '<input id="login-email" name="email" type="email" autocapitalize="none" autocomplete="email" spellcheck="false" required>' +
      '<label for="login-pass">Password</label>' +
      '<input id="login-pass" name="password" type="password" autocomplete="current-password" required>' +
      '<p class="error" id="login-error" role="alert">' + esc(state.loginError || "") + "</p>" +
      '<p class="fine">Accounts use Firebase Auth (email + password). Old phone-only passwords no longer work — create an account again if needed.</p>' +
      '<button class="btn" type="submit">Log in</button>' +
      "</form>" +
      '<a class="btn secondary" href="signup/?v=21">Create an account</a>'
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
      '<div class="app-nav">' + logoutLine() + "</div>" +
      "<h2>Request a ride</h2>" +
      "<p class=\"lede\">Request goes to Private Car Services for confirmation. Card charges are not taken on this screen.</p>" +
      (testModeAvailable()
        ? ('<div class="card" style="border:1px solid #7a1f1f;">' +
           '<label><input type="checkbox" id="test-ride-toggle"' + (state.isTest ? " checked" : "") + '> <strong>TEST MODE</strong> — practice only, PIN 0001, no charge, not shown to other drivers</label></div>')
        : "") +
      (state.isTest ? testBannerHtml() : "") +
      "<form id=\"ride-form\" autocomplete=\"off\">" +
      '<div class="group"><p class="group-title">Pickup</p>' +
      locateField("pickup-street", "Street", state.pickupStreet, "pickup-results", "use-location") +
      '<div class="row"><div class="city">' +
      field("pickup-city", "City", state.pickupCity, "required") +
      '</div><div class="state">' +
      field("pickup-state", "State", state.pickupState, 'required maxlength="2"') +
      "</div></div></div>" +
      '<div class="group"><p class="group-title">Drop-off</p>' +
      locateField("drop-street", "Street", state.dropStreet, "drop-results", "") +
      '<div class="row"><div class="city">' +
      field("drop-city", "City", state.dropCity, "required") +
      '</div><div class="state">' +
      field("drop-state", "State", state.dropState, 'required maxlength="2"') +
      "</div></div></div>" +
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
      paymentHoldCopy() +
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
      '<p class="map-caption">' + (isFinite(state.hereLat) && route.live ? "You, pickup, and drop-off" : (route.live ? "Your route" : "Sample map · Willis")) + "</p>" +
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
      '<text x="50" y="48" text-anchor="middle" fill="#f0d48a" font-size="5" font-family="Georgia, serif">WILLIS</text>' +
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
      ? "Sample map · Willis"
      : (driver ? "Your driver" : "Driver location shows once they accept on a linked phone.");
    var near = driverNearPickup();
    var started = state.rideStatus === "started";
    var completed = state.rideStatus === "completed";
    return (
      testTop +
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      (completed
        ? '<div class="status"><i></i><span>Ride complete</span></div>'
        : (started
          ? '<div class="status"><i></i><span>Ride started</span></div>'
          : waitingStatusBlock(near || state.driverName ? "Driver on the way" : "Drivers are available"))) +
      driverIdentityLine() +
      driverEtaLine() +
      "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) + "<br>" + esc(prettyWhen()) + "</p>" +
      (started || completed ? "" : riderPinBanner()) +
      customerMapBlock(caption, driver) +
      moneyCard() +
      (completed
        ? '<div class="card payment-card"><p class="tag">Pay after the ride' + (testSkipPayEnabled() ? " · testing" : "") + "</p>" +
          '<p class="lede">Your card on file is charged after drop-off so you can add a tip.</p>' +
          (state.paymentSkipped || testSkipPayEnabled()
            ? '<p class="fine">Testing: no real Square charge on this screen.</p>' +
              (state.paymentSkipped ? "" : '<button class="btn ghost" type="button" id="skip-pay-btn">Skip for testing</button>')
            : '<button class="btn secondary" type="button" id="square-hold-btn">Continue to Square</button>') +
          "</div>"
        : "") +
      (state.rideStatus === "accepted"
        ? '<div class="card">' +
          '<p class="tag">Cancel before pickup</p>' +
          '<p class="lede">' + esc(cancelWarningCopy()) + "</p>" +
          '<button class="btn secondary" type="button" id="cancel-ride">Cancel ride</button>' +
          "</div>"
        : "") +
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
    var caption = !both ? "Sample map · Willis" : (driver ? "Your driver" : "Your route");
    var st = String(state.rideStatus || "").toLowerCase();
    var note = st === "pending_owner"
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
    var canCancel = st === "requested" || st === "accepted" || st === "pending_owner";
    var statusHtml = st === "denied"
      ? '<div class="status"><i></i><span>Booking declined</span></div>'
      : waitingStatusBlock(waitLabel);
    return (
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      statusHtml +
      driverIdentityLine() +
      driverEtaLine() +
      "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) + "<br>" + esc(prettyWhen()) + "</p>" +
      testTop + riderPinBanner() +
      customerMapBlock(caption, driver) +
      moneyCard() +
      paymentHoldCopy() +
      '<p class="note">' + note + "</p>" +
      (canCancel
        ? '<div class="card">' +
          '<p class="tag">Cancel before pickup</p>' +
          '<p class="lede">' + esc(cancelWarningCopy()) + "</p>" +
          '<button class="btn secondary" type="button" id="cancel-ride">Cancel ride</button>' +
          "</div>"
        : "")
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
    state.driverPhone = ride.driverPhone || "";
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
  }

  function clearRideFields() {
    state.name = "";
    state.phone = "";
    state.pickupStreet = "";
    state.pickupCity = "";
    state.dropStreet = "";
    state.dropCity = "";
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
      '<a class="btn secondary" href="signup/?v=21">Profile</a>' +
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
        '<p class="tag">' + (finalLabel || "Live fare") + "</p>" +
        '<p class="fine">Miles and fare update when the route is ready.</p></div>'
      );
    }
    return (
      '<div class="card" id="driver-fare-card">' +
      '<p class="tag">' + (finalLabel || "Live fare · updates with the trip") + "</p>" +
      '<div class="money-row"><span>Miles</span><span data-live-miles>' + est.raw.toFixed(2) + " mi, billed as " + est.billed + "</span></div>" +
      '<div class="money-row"><span>Fare before tax</span><span data-live-sub>' + money(est.sub) + "</span></div>" +
      '<div class="money-row"><span>Texas tax 8.25%</span><span data-live-tax>' + money(est.tax) + "</span></div>" +
      '<div class="total-row"><span>' + (finalLabel ? "Final total" : "Estimated total") + "</span><span data-live-total>" + money(est.total) + "</span></div>" +
      commissionLine() +
      '<p class="fine">Miles round up. Tax is estimate-only, not a charge.</p></div>'
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
        '<button class="btn secondary" type="button" id="open-nav">Open turn-by-turn to drop-off</button>' +
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
        driverFareCard("Final fare") +
        '<button class="btn secondary" type="button" id="back-driver">Back to requests</button>'
      );
    }
    var statusLabel = completed ? "Ride complete" : (started ? "Ride started" : "Heading to pickup");
    return (
      testTop +
      (completed ? "" : '<button class="btn ghost" type="button" id="back-driver">← Requests</button>') +
      '<p class="fine" id="miles-today">' + esc(milesTodayLabel()) + "</p>" +
      '<div class="status"><i></i><span>' + statusLabel + "</span></div>" +
      '<div class="who">' + photoImg(state.riderPhoto) +
      "<p class=\"lede\">" + esc(state.name || "Rider") +
      (completed ? " · trip finished." : (started ? " · en route." : " is at " + esc(pickupLine()) + ".")) +
      "</p></div>" +
      (completed ? "" : mapBlock("Customer")) +
      pinGate +
      (started || completed ? "" : (
        '<div class="card"><p class="tag">This ride</p>' +
        "<p><strong>Drop-off</strong><br>" + esc(dropLine()) + "</p>" +
        commissionLine() +
        "<p class=\"fine\">" + esc(prettyWhen()) + ". Miles round up. Texas tax 8.25% stays estimate-only.</p></div>"
      )) +
      (started ? (
        '<div class="card"><p class="tag">This ride</p>' +
        "<p><strong>Pickup</strong><br>" + esc(pickupLine()) + "</p>" +
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
    state.pickupStreet = val("pickup-street");
    state.pickupCity = val("pickup-city");
    state.pickupState = val("pickup-state").toUpperCase();
    state.dropStreet = val("drop-street");
    state.dropCity = val("drop-city");
    state.dropState = val("drop-state").toUpperCase();
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
        if (!a || !a.hasConfig || !a.hasConfig()) {
          state.loginError = (a && a.initError && a.initError()) || "Firebase Auth is not configured yet. Create a Firebase account after Matthew finishes Auth setup — local-only passwords no longer sign you in.";
          render();
          return;
        }
        if (!loginEmail || !password) {
          state.loginError = "Enter email and password.";
          render();
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
            ensureMilesDayReady();
            followGps();
            refreshRosterStatus().then(function () {
              if (canGoOnline()) {
                refreshOpenRides(true);
                publishDriverPresence();
              }
              render();
            });
            return;
          }
          maybeRestoreCustomerRide();
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
        var row = {
          startOdometer: odo,
          gpsMiles: 0,
          startedAt: now,
          lastUpdate: now
        };
        state.milesOdoError = "";
        state.milesOdoDraft = "";
        state.milesNeedStart = false;
        state.milesStartOdo = odo;
        state.milesToday = 0;
        persistMilesRow(row).then(function () {
          followGps();
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
          row.endOdometer = odo;
          row.lastUpdate = Date.now();
          persistMilesRow(row);
        }
        finishDriverLogout();
      });
    }
    var milesEndSkip = document.getElementById("miles-end-skip");
    if (milesEndSkip) {
      milesEndSkip.addEventListener("click", function () {
        finishDriverLogout();
      });
    }
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
    wireSearch("pickup-street", "pickup-results", "pickup");
    wireSearch("drop-street", "drop-results", "drop");
    wireLocation();
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
        readForm();
        if (!formComplete()) {
          state.error = state.asap
            ? "Add pickup, drop-off, name, and phone."
            : "Add pickup, drop-off, date, time, name, and phone.";
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
          geocodeMissing().then(function () {
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

    var backHome = document.getElementById("back-home");
    if (backHome) {
      backHome.addEventListener("click", function () {
        state.mode = "customer";
        state.screen = "home";
        render();
      });
    }
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
          render();
          openTurnByTurnToDrop();
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
        if (!openTurnByTurnToDrop()) {
          state.error = "Drop-off location is not ready yet.";
          render();
        }
      });
    }
    var cancelRide = document.getElementById("cancel-ride");
    if (cancelRide) {
      cancelRide.addEventListener("click", function () {
        cancelRiderRide();
      });
    }
    var squareHold = document.getElementById("square-hold-btn");
    if (squareHold) {
      squareHold.addEventListener("click", function () {
        openSquareCardSetup();
      });
    }
    var skipPay = document.getElementById("skip-pay-btn");
    if (skipPay) {
      skipPay.addEventListener("click", function () {
        state.paymentSkipped = true;
        try { localStorage.setItem("PCS_TEST_SKIP_PAY", "true"); } catch (e) {}
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


  function geocodeQuery(text, city, stateName) {
    var usedCity = placeQueryCity(text, city);
    return collectPlaces(text, usedCity, stateName || "TX").then(function (features) {
      var ranked = rankFeatures(features, text, usedCity);
      return ranked[0] || null;
    }).catch(function () { return null; });
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
        patchRide(state.code, { dropLat: +after.lat, dropLng: +after.lng }).catch(function () {});
      } else if (filledPick) {
        pushPlaceCoords();
      }
      render();
    });
  }

  function geocodeMissing() {
    var jobs = [];
    if (state.pickupStreet && !state.pickupFromHere) {
      jobs.push(geocodeQuery(state.pickupStreet, state.pickupCity, state.pickupState).then(function (feature) {
        if (!feature) return;
        var saved = placeCoords("pickup");
        if (!saved || placeLooksWeak(saved, feature, state.pickupStreet, state.pickupCity)) setCoords("pickup", feature);
      }));
    }
    if (state.dropStreet) {
      jobs.push(geocodeQuery(state.dropStreet, state.dropCity, state.dropState).then(function (feature) {
        if (!feature) return;
        var saved = placeCoords("drop");
        if (!saved || placeLooksWeak(saved, feature, state.dropStreet, state.dropCity)) {
          setCoords("drop", feature);
          if (saved) state.dropFix = featurePoint(feature);
        }
      }));
    }
    return Promise.all(jobs);
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
    if (ROLE !== "driver" || !signedIn() || state.screen !== "home") return;
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
      render();
    }).catch(function () {
      state.remoteLoading = false;
      state.selectedOpenCode = "";
      render();
    });
  }

  function acceptSelectedOpenRide() {
    stopOpenRideAlert();
    if (!state.selectedOpenCode && !state.code) return;
    if (!isDriverApproved()) {
      state.openListError = "pending-approval";
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
    var code = state.driverCode || state.code || state.selectedOpenCode || readDriverCode();
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
      render();
    }
    if (!syncOn() || !code) {
      finishLocalAccept();
      return;
    }
    state.openListError = "";
    state.remoteLoading = true;
    render();
    getRideWithEtag(code).then(function (pack) {
      var ride = pack && pack.ride;
      var etag = pack && pack.etag;
      var st = String((ride && ride.status) || "").toLowerCase();
      if (!ride) {
        var err = new Error("missing");
        err.taken = true;
        throw err;
      }
      if (st === "accepted" || st === "started" || st === "completed" || st === "cancelled" || st === "denied") {
        var taken = new Error("taken");
        taken.taken = true;
        throw taken;
      }
      if (st === "pending_owner" || st === "pending-owner") {
        var wait = new Error("pending-owner");
        wait.pendingOwner = true;
        throw wait;
      }
      if (st && st !== "requested") {
        var bad = new Error("bad-status");
        bad.taken = true;
        throw bad;
      }
      if (ride.isTest && !isOwnerSession()) {
        var notest = new Error("test-ride");
        notest.taken = true;
        throw notest;
      }
      if (ride.isTest) state.isTest = true;
      if (ride.pinHash) state.pinHash = ride.pinHash;
      var patch = {
        status: "accepted",
        acceptedAt: Date.now(),
        driverId: driverPresenceId(),
        driverUid: firebaseUid() || "",
        updatedAt: Date.now()
      };
      if (ride.isTest) patch.isTest = true;
      if (state.driverName) patch.driverName = state.driverName;
      if (state.driverPhone) patch.driverPhone = state.driverPhone;
      if (safePhoto(state.driverPhoto)) patch.driverPhoto = safePhoto(state.driverPhoto);
      if (state.driverCarYear) patch.driverCarYear = state.driverCarYear;
      if (state.driverCarMake) patch.driverCarMake = state.driverCarMake;
      if (state.driverCarModel) patch.driverCarModel = state.driverCarModel;
      if (state.driverCarPlate) patch.driverCarPlate = state.driverCarPlate;
      if (state.driverCarSeats) patch.driverCarSeats = state.driverCarSeats;
      if (safePhoto(state.driverCarPhoto)) patch.driverCarPhoto = safePhoto(state.driverCarPhoto);
      if (account && account.email) patch.driverEmail = String(account.email).toLowerCase();
      return patchRideIfMatch(code, patch, etag).then(function () {
        return deleteOpenRide(code).catch(function () {});
      });
    }).then(function () {
      state.remoteLoading = false;
      finishLocalAccept();
    }).catch(function (err) {
      state.remoteLoading = false;
      if (err && err.pendingOwner) {
        state.openListError = "This booking is still waiting for owner approval.";
      } else if (err && (err.conflict || err.taken)) {
        state.openListError = "That ride was already taken by another driver.";
        state.selectedOpenCode = "";
        clearRideFields();
        writeDriverCode("");
        state.driverCode = "";
        try { localStorage.removeItem(STORE); } catch (e2) {}
        refreshOpenRides(true);
      } else {
        state.openListError = "Could not accept this ride. Try again.";
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
      window.L.marker([route.pickup.lat, route.pickup.lng], { icon: pinIcon(youLabel, "pin-you") }).addTo(liveMap);
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
  }

  function onGpsFix(pos) {
    if (!pos || !pos.coords) return;
    var first = !isFinite(state.hereLat);
    state.hereLat = pos.coords.latitude;
    state.hereLng = pos.coords.longitude;
    state.driverLat = state.hereLat;
    state.driverLng = state.hereLng;
    if (ROLE === "driver") trackDailyMiles(pos);
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
    if (ROLE === "driver" && signedIn()) {
      ensureMilesDayReady();
      followGps();
      refreshRosterStatus().then(function () {
        if (canGoOnline()) {
          refreshOpenRides(true);
          publishDriverPresence();
        }
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
    setInterval(function () {
      if (ROLE === "driver" && signedIn() && state.screen === "home" && canGoOnline() && !state.hubOpen) refreshOpenRides();
    }, 3000);
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
      if (ROLE === "driver" && signedIn()) nudgeGps();
    });
    setInterval(function () {
      if (ROLE !== "driver" || !signedIn()) return;
      if (document.visibilityState === "hidden") return;
      /* Backup when watchPosition goes quiet in foreground (Safari quirk). */
      if (state.screen === "home" || driverMidRide()) nudgeGps();
    }, 4000);
    if (ROLE !== "driver" && signedIn()) {
      maybeRestoreCustomerRide();
    }
    if (signedIn() && !accountSyncTried) {
      accountSyncTried = true;
      syncAccountProfile(ROLE === "driver" ? "driver" : "rider", accountForRole());
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
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    if (!ride) return;
    ingestCustomerRide(ride);
  }
})();
