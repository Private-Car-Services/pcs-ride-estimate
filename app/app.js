/* Private Car Services starter. Preview only: no texts, no charges, no API key. Shared rides use Firebase REST when PCS_SYNC.databaseURL is set.
   v47 (Oct 6): structured addresses + stops, nearest-first place search, card step before PIN, working rider cancel,
   driver online time + screen wake lock. */
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
  var CALENDAR_HUB = "PCSCALND"; /* God day board: PCS-titled calendar rides */
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
    return "Today: " + n.toFixed(1) + " mi · " + fmtOnline(onlineMsToday());
  }

  function refreshMilesTodayDom() {
    if (ROLE !== "driver") return;
    var label = milesTodayLabel();
    Array.prototype.forEach.call(document.querySelectorAll("#miles-today"), function (el) {
      if (el.textContent !== label) el.textContent = label;
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
      sandbox: String(c.environment || "").toLowerCase() === "sandbox"
    };
  }

  function squareConfigured() {
    var c = squareCfg();
    return !!(c.appId && c.locationId && /^https:\/\//i.test(c.endpoint));
  }

  function cardStatusOk(st) {
    return st === "on_file" || st === "owner_ok" || st === "test_skip";
  }

  /* PIN only after the card step is done (or TEST ride / testing skip). */
  function rideCardReady() {
    if (state.isTest || isTestRide(currentRide())) return true;
    if (state.paymentSkipped && testSkipPayEnabled()) return true;
    return cardStatusOk(String(state.cardStatus || ""));
  }

  function paymentInfoCopy() {
    return (
      '<div class="card payment-card">' +
      '<p class="tag">Payment</p>' +
      '<p class="lede">After you request, you add your card for this ride on a secure Square form. You are not charged until after drop-off, so you can add a tip.</p>' +
      '<p class="fine">Your pickup PIN shows once your card is on file. This app never sees or stores your card number.</p>' +
      "</div>"
    );
  }

  function cardNeededHtml() {
    var requested = String(state.cardStatus || "") === "link_requested";
    var testing = testSkipPayEnabled();
    return (
      '<div class="card card-needed" id="card-needed">' +
      '<p class="tag">Add your card to confirm your ride</p>' +
      '<p class="lede">' + (requested
        ? "We will text a secure Square card link to " + esc(state.phone || "your phone") + ". Your pickup PIN shows here as soon as your card is confirmed."
        : "Your pickup PIN shows here after your card is on file. You are not charged until after drop-off, so you can add a tip.") + "</p>" +
      '<button class="btn" type="button" id="square-hold-btn">' + (requested ? "Card link requested &#10003;" : "Add card for this ride") + "</button>" +
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
        '<p class="lede">Card setup inside the app is being finalized. Private Car Services will text a secure Square payment link to ' +
        esc(state.phone || "your phone") + " for this ride.</p>" +
        '<p class="fine">Your pickup PIN appears on the ride screen as soon as your card is confirmed. Questions? Call <a href="tel:' +
        BUSINESS_PHONE + '">' + esc(BUSINESS_PHONE) + "</a>.</p>" +
        '<p class="error" id="sq-card-error" role="alert"></p>' +
        (requested
          ? '<p class="fine"><strong>Link requested.</strong> Watch for a text from Private Car Services.</p>'
          : '<button class="btn" type="button" id="card-link-request">Text me the secure link</button>') +
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

  function mountSquareCard() {
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
        var saveBtn = document.getElementById("sq-card-save");
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

  function requestCardLink() {
    var btn = document.getElementById("card-link-request");
    var code = state.code || "";
    var patch = { cardStatus: "link_requested", cardRequestedAt: Date.now() };
    function done() {
      state.cardStatus = "link_requested";
      saveRide(state.rideStatus || "pending_owner");
      closeCardSheet();
      render();
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Sending request…";
    }
    if (!syncOn() || !code) {
      done();
      return;
    }
    patchRide(code, patch).then(done).catch(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Text me the secure link";
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
      field(prefix + "-zip", "ZIP", val("Zip"), 'inputmode="numeric" maxlength="10" placeholder="ZIP"') +
      "</div></div></div>"
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
        });
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

  function wireSearch(prefix) {
    var input = document.getElementById(prefix + "-street");
    var box = document.getElementById(prefix + "-results");
    if (!input || !box) return;
    var timer = 0;
    var seq = 0;
    input.addEventListener("focus", primeSearchOrigin);
    input.addEventListener("blur", function () {
      setTimeout(function () { box.hidden = true; }, 350);
    });
    input.addEventListener("input", function () {
      var q = input.value.trim();
      addrSet(prefix, "Street", input.value);
      addrSet(prefix, "Lat", null);
      addrSet(prefix, "Lng", null);
      addrSet(prefix, "Pinned", false);
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
        var origin = searchOrigin(prefix);
        findPlaces(q, origin).then(function (items) {
          if (mine !== seq || input.value.trim() !== q) return;
          var num = (q.match(/^(\d+[A-Za-z]?)\s+/) || [])[1];
          items = items.slice(0, 6).map(function (it) {
            var pl = it.place;
            if (!num || pl.category || /^\d/.test(String(pl.line1 || ""))) return it;
            /* Typed "1099 McCaleb" but the map only knows the street: keep the house number. */
            return Object.assign({}, it, { place: Object.assign({}, pl, { line1: num + " " + pl.line1, approx: true }) });
          });
          box._places = items;
          box.innerHTML = items.length
            ? suggestNoteHtml(origin) + items.map(suggestItemHtml).join("")
            : '<p class="suggest-note">No matches yet. Keep typing, or fill in line 1, city and ZIP yourself.</p>';
          box.hidden = false;
        }).catch(function () { box.hidden = true; });
      }, 300);
    });
    box.addEventListener("click", function (event) {
      var btn = event.target.closest ? event.target.closest(".suggest-item") : null;
      if (!btn || !box._places) return;
      var item = box._places[Number(btn.getAttribute("data-i"))];
      if (!item) return;
      var place = item.place;
      /* House number on a street-only match: the request step finds that exact house
         (instead of pinning the middle of a long road). */
      if (place.approx) place = Object.assign({}, place, { lat: null, lng: null });
      applyPlace(prefix, place);
      box.hidden = true;
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
      onlineMinutesToday: Math.floor(onlineMsToday() / 60000),
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
    remote.cardStatus = remote.isTest ? "test_skip" : (remote.cardStatus && remote.cardStatus !== "" ? remote.cardStatus : "none");
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
    if (!rideCardReady()) return cardNeededHtml();
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
      '<div class="route-line"><p>' + esc(pickupLine()) + "</p>" + stopsSummaryHtml() + "<p>" + esc(dropLine()) + "</p></div>" +
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
    var cardChanged = (ride.cardStatus || "") !== (state.cardStatus || "");
    if (!statusChanged && !placesChanged && !driverChanged && !codeChanged && !identityChanged && !cardChanged) return;
    var screen = state.screen;
    applyRide(ride);
    if (screen === "waiting" && (ride.status === "accepted" || ride.status === "started" || ride.status === "completed")) state.screen = "trip";
    if ((ride.status === "accepted" || ride.status === "started" || ride.status === "completed") && state.screen !== "trip") state.screen = "trip";
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
      '<a class="btn secondary" href="signup/?v=22">Create an account</a>'
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
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      (completed
        ? '<div class="status"><i></i><span>Ride complete</span></div>'
        : (started
          ? '<div class="status"><i></i><span>Ride started</span></div>'
          : waitingStatusBlock(near || state.driverName ? "Driver on the way" : "Drivers are available"))) +
      driverIdentityLine() +
      driverEtaLine() +
      routeLedeHtml() +
      (started || completed ? "" : riderPinBanner()) +
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
      ? "This ride was cancelled. Tap ← Request to book a new ride, or call " + BUSINESS_PHONE + "."
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
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      statusHtml +
      driverIdentityLine() +
      driverEtaLine() +
      routeLedeHtml() +
      testTop + (live ? riderPinBanner() : "") +
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
    state.stopList = normalizeStops(ride.stopList);
    state.cardStatus = ride.cardStatus || "";
    state.cardLast4 = ride.cardLast4 || "";
    state.cardBrand = ride.cardBrand || "";
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
      pickupLine2: state.pickupLine2 || "",
      pickupZip: state.pickupZip || "",
      pickupAddress: pickupLine(),
      pickupPinned: !!state.pickupPinned,
      dropLine2: state.dropLine2 || "",
      dropZip: state.dropZip || "",
      dropAddress: dropLine(),
      dropPinned: !!state.dropPinned,
      stopList: compactStops(),
      cardStatus: state.cardStatus || "",
      cardLast4: state.cardLast4 || "",
      cardBrand: state.cardBrand || "",
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
    state.pickupLine2 = "";
    state.pickupZip = "";
    state.pickupPinned = false;
    state.dropLine2 = "";
    state.dropZip = "";
    state.dropPinned = false;
    state.stopList = [];
    state.cardStatus = "";
    state.cardLast4 = "";
    state.cardBrand = "";
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
            return;
          }
          maybeRestoreCustomerRide();
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
          var hasLocal = !!(account && (account.email || account.username) && account.passwordHash);
          var emailMatches = hasLocal && account.email && loginEmail === String(account.email).trim().toLowerCase();
          var legacyUsernameMatches = hasLocal && account.username && loginEmail === String(account.username).trim().toLowerCase();
          if (!hasLocal || (!emailMatches && !legacyUsernameMatches)) {
            /* v46: account not in this app's storage (iOS Home Screen app has separate storage from
               Safari, or another phone). Fall back to the driver roster record. */
            tryRosterLogin(null);
            return;
          }
          sha256Hex(password).then(function (hex) {
            if (hex !== account.passwordHash) {
              /* Password may have been set on another device: check the roster hash if one exists. */
              tryRosterLogin(account);
              return;
            }
            if (ROLE === "driver") backfillRosterPassword(loginEmail, password);
            afterLocalLogin(account);
          });
        }
        function tryRosterLogin(localSame) {
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
                return saveRosterAccountLocally(row, password, localSame).then(afterLocalLogin);
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
              return saveRosterAccountLocally(row, password, null).then(afterLocalLogin);
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
          state.cancelConfirm = false;
          state.cancelBusy = false;
          state.cancelError = "";
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
        if (String(state.rideStatus || "").toLowerCase() === "cancelled") discardStoredRide();
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


  function geocodeQuery(text, city, stateName, zip, prefix) {
    var base = String(text || "").trim();
    if (!base) return Promise.resolve(null);
    var low = base.toLowerCase();
    var parts = [base];
    if (city && low.indexOf(String(city).toLowerCase()) === -1) parts.push(city);
    var st = String(stateName || "TX").trim();
    if (st && low.indexOf(" " + st.toLowerCase()) === -1) parts.push(st);
    if (zip && low.indexOf(String(zip)) === -1) parts.push(zip);
    var q = parts.join(", ");
    function viaPhoton() {
      return findPlaces(q, searchOrigin(prefix || "drop"), { city: city || "", zip: zip || "" }).then(function (items) {
        return items[0] ? items[0].feature : null;
      }).catch(function () { return null; });
    }
    /* House-number addresses: OpenStreetMap's Nominatim knows exact houses; Photon often only the street. */
    if (!/^\d+[A-Za-z]?\s/.test(base)) return viaPhoton();
    return withTimeout(fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" + encodeURIComponent(q), {
      headers: { "Accept": "application/json" }
    }).then(function (res) {
      if (!res.ok) throw new Error("nominatim");
      return res.json();
    }), 7000).then(function (list) {
      var hit = list && list[0];
      if (!hit || !isCoord(+hit.lat) || !isCoord(+hit.lon)) return viaPhoton();
      return { type: "Feature", geometry: { type: "Point", coordinates: [+hit.lon, +hit.lat] }, properties: { name: base, source: "nominatim" } };
    }).catch(viaPhoton);
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
    /* Picked from the list / current location: keep that exact pin (never swap to another store). */
    var pickupPinned = !!state.pickupPinned && !!placeCoords("pickup");
    var dropPinned = !!state.dropPinned && !!placeCoords("drop");
    (state.stopList || []).forEach(function (s, i) {
      if (!s || !String(s.street || "").trim()) return;
      if (s.pinned && isCoord(s.lat) && isCoord(s.lng)) return;
      jobs.push(geocodeQuery(s.street, s.city, s.state, s.zip, "stop" + i).then(function (feature) {
        var pt = featurePoint(feature);
        if (!pt || !state.stopList[i]) return;
        state.stopList[i].lat = pt.lat;
        state.stopList[i].lng = pt.lng;
      }));
    });
    if (state.pickupStreet && !state.pickupFromHere && !pickupPinned) {
      jobs.push(geocodeQuery(state.pickupStreet, state.pickupCity, state.pickupState, state.pickupZip, "pickup").then(function (feature) {
        if (!feature) return;
        var saved = placeCoords("pickup");
        if (!saved || placeLooksWeak(saved, feature, state.pickupStreet, state.pickupCity)) setCoords("pickup", feature);
      }));
    }
    if (state.dropStreet && !dropPinned) {
      jobs.push(geocodeQuery(state.dropStreet, state.dropCity, state.dropState, state.dropZip, "drop").then(function (feature) {
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
    setInterval(pollDriverRideCancel, 5000);
    setInterval(function () {
      if (ROLE === "driver" && signedIn() && state.screen === "home" && canGoOnline() && !state.hubOpen) refreshOpenRides();
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
