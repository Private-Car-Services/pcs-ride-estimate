/* Private Car Services — PCS God mode (Matthew only). v25/v45: day board from PCS calendar + assign/commission.
   v57: visual pop-ups for every new ride request and every accept; safety alerts (police assist red banner +
   pop-up, soft not-OK notes). No sound in God mode.
   v58: Square LIVE. Payments panel (card saved / charged $X / failed / refunded / deposit / cancel fee + receipts),
   Refund button (God password re-checked by the pcs-pay Worker, never stored), Charge fare now (no tip) for a
   completed ride the rider didn't pay, Charge cancel fee. Mark card OK stays as the override.
   v59: cancel fee only when the driver was within 1 mile of pickup (the pcs-pay Worker decides). Each cancelled ride
   shows "cancel fee $X" or "free cancel (driver X.X mi away)"; Charge cancel fee is hidden for free cancels and the
   Worker refuses it (409 CANCEL_FREE) if the driver was farther than 1 mile or his location wasn't current.
   v62: rides with internationalArrival show "International arrival +$15 service fee (taxed, in the fare)".
   v64g: a ride waiting for Matthew's OK pops up AND rings the driver-app bell chime until tapped; live REQUESTS
   stream (~1 s); waiting rides re-pop on every open / return to the foreground; Home Screen app + phone alerts
   (Web Push via the pcs-pay Worker) for when God mode is closed.
   v70: METERED rides from the driver app (PAYMENTS rows with rideType "metered"): a red "Unpaid metered rides" flag at the
   top of Payments (time ended + pickup spot + fare + driver) until paid by the Square QR link or marked paid another way;
   "Paid another way" (cash / card machine / other, driver-reported) is shown in gold as not checked by Square. Metered
   refunds are done in the Square Dashboard (the Worker's /refund matches card-on-file payments only). Driver history
   shows metered rides and tips (100% to the driver). */
(function () {
  "use strict";
  var GOD_SCRIPT_SRC = (document.currentScript && document.currentScript.src) || ""; /* v64g: chime URL base */

  var DATABASE_URL = "https://pts-maps-rides-default-rtdb.firebaseio.com";
  var PRESENCE_HUB = "AVLBLDRV";
  var OPEN_HUB = "REQUESTS";
  /* Roster + commission hub: 8-char ride-code alphabet (no I/O/0/1). DRVRCOMM has O — use DRVRCMMS. */
  var ROSTER_HUB = "DRVRCMMS";
  /* Miles hub: 8-char alphabet (no I/O). DRVRMILZ wrongly contained I — use DRVRMLES. */
  var MILES_HUB = "DRVRMLES";
  var HISTORY_HUB = "DRVRHSTY"; /* completed ride logs; 8-char no I/O */
  var SAFETY_HUB = "SAFETY"; /* v57: driver safety / police-assist alerts from the driver app */
  var CALENDAR_HUB = "PCSCALND"; /* scheduled PCS calendar rides for day board */
  /* v58: payments index written by the pcs-pay Worker (completed rides leave REQUESTS, this keeps them listed). */
  var PAY_HUB = "PAYMENTS";
  var PAY_WORKER = (window.PCS_PAY_WORKER || "https://pcs-pay.pcsrides.workers.dev").replace(/\/+$/, "");
  var PAY_SHOW_DAYS = 30;
  var DEFAULT_COMMISSION_PCT = 70;
  var SESSION_KEY = "pcs-god-session"; /* legacy pre-v24 key — cleared, never trusted */
  /* v24: owner sign-in survives iOS app switching (localStorage) until Sign out. */
  var KEEP_KEY = "pcs-god-keep-v1";
  var FOCUS_ZOOM = 15;
  /* Allowed owner email only. A real private password comes next — do not store one in this file. */
  var OWNER_EMAIL = "mwragge78@gmail.com";
  var ONLINE_MS = 2 * 60 * 1000;
  var POLL_MS = 5000;
  var BOARD_CENTER = { lat: 30.39, lng: -95.65 };

  var CAR_SVG =
    '<svg viewBox="0 0 64 64" width="36" height="36" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="30" fill="#193819" stroke="#f0d48a" stroke-width="2"/>' +
    '<rect x="22" y="12" width="20" height="38" rx="9" fill="#f0d48a"/>' +
    '<rect x="25" y="18" width="14" height="10" rx="3" fill="#193819"/>' +
    '<rect x="25" y="33" width="14" height="8" rx="2" fill="#0f2810"/>' +
    '<rect x="17" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="42" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="17" y="36" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="42" y="36" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    "</svg>";

  var PERSON_SVG =
    '<svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="30" fill="#193819" stroke="#f0d48a" stroke-width="2"/>' +
    '<circle cx="32" cy="20" r="8" fill="#f0d48a"/>' +
    '<path d="M20 48c2-10 8-14 12-14s10 4 12 14" fill="none" stroke="#f0d48a" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M24 34 L32 40 L40 34" fill="none" stroke="#c6a04a" stroke-width="3" stroke-linecap="round"/>' +
    "</svg>";

  var PAIRED_SVG =
    '<svg viewBox="0 0 72 64" width="44" height="40" aria-hidden="true">' +
    '<rect x="2" y="2" width="68" height="60" rx="14" fill="#193819" stroke="#f0d48a" stroke-width="2"/>' +
    '<g transform="translate(2,2) scale(0.72)">' +
    '<rect x="22" y="12" width="20" height="38" rx="9" fill="#f0d48a"/>' +
    '<rect x="25" y="18" width="14" height="10" rx="3" fill="#193819"/>' +
    '<rect x="17" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="42" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    "</g>" +
    '<g transform="translate(34,8) scale(0.55)">' +
    '<circle cx="32" cy="20" r="8" fill="#f0d48a"/>' +
    '<path d="M20 48c2-10 8-14 12-14s10 4 12 14" fill="none" stroke="#f0d48a" stroke-width="5" stroke-linecap="round"/>' +
    "</g>" +
    "</svg>";

  var state = {
    payments: {},
    paymentsError: "",
    payRides: {},
    payBusy: {},
    payNotice: "",
    screen: "login",
    emailInput: "",
    passwordInput: "",
    loginError: "",
    sessionEmail: "",
    drivers: [],
    rides: [],
    roster: {},
    driversError: "",
    ridesError: "",
    rosterError: "",
    loading: false,
    lastRefreshAt: 0,
    commissionDrafts: {},
    hireName: "",
    hirePhone: "",
    hireEmail: "",
    hirePct: String(DEFAULT_COMMISSION_PCT),
    hireError: "",
    hireNotice: "",
    actionNotice: "",
    miles: {},
    milesError: "",
    history: {},
    historyError: "",
    selectedDriverId: "",
    driverDetailDay: "",
    pendingAlertCodes: {},
    pendingBanner: "",
    trackedRideCodes: {},
    shownPendingPopup: {},
    shownOpenPopup: {},
    shownWaiting: {},
    wasPending: {},
    forceRideCode: "",
    pushOn: false,
    shownAcceptPopup: {},
    safetyAlerts: {},
    shownSafetyPopup: {},
    safetyError: "",
    focusDriverId: "",
    focusNote: "",
    calendar: [],
    calendarError: "",
    calendarUpdated: "",
    assignDrafts: {},
    fareDrafts: {},
    boardNotice: "",
    expandedDrivers: {},
    showHireForm: false,
    showBoardHow: false
  };

  var map = null;
  var markerLayer = null;
  var routeLayer = null;
  var pollTimer = null;
  var mapReady = false;
  var driverMarkers = {}; /* driverId -> Leaflet marker (rebuilt every syncMap) */
  var focusFlyPending = false; /* animate once on tap; later polls just follow */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function baseUrl() {
    return DATABASE_URL.replace(/\/+$/, "");
  }

  function driversUrl() {
    return baseUrl() + "/rides/" + encodeURIComponent(PRESENCE_HUB) + "/drivers.json";
  }

  function openUrl() {
    return baseUrl() + "/rides/" + encodeURIComponent(OPEN_HUB) + ".json";
  }

  function rideUrl(code) {
    return baseUrl() + "/rides/" + encodeURIComponent(code) + ".json";
  }

  function safetyUrl(id) {
    var root = baseUrl() + "/rides/" + encodeURIComponent(SAFETY_HUB);
    return id ? root + "/" + encodeURIComponent(id) + ".json" : root + ".json";
  }

  function rosterUrl(id) {
    var root = baseUrl() + "/rides/" + encodeURIComponent(ROSTER_HUB);
    if (id) return root + "/" + encodeURIComponent(id) + ".json";
    return root + ".json";
  }

  function presenceDriverUrl(id) {
    return baseUrl() + "/rides/" + encodeURIComponent(PRESENCE_HUB) + "/drivers/" + encodeURIComponent(id) + ".json";
  }

  function milesUrl(driverId) {
    var root = baseUrl() + "/rides/" + encodeURIComponent(MILES_HUB);
    if (driverId) return root + "/" + encodeURIComponent(driverId) + ".json";
    return root + ".json";
  }

  function calendarUrl(eventId) {
    var root = baseUrl() + "/rides/" + encodeURIComponent(CALENDAR_HUB);
    if (eventId) return root + "/" + encodeURIComponent(eventId) + ".json";
    return root + ".json";
  }

  function riderFromPcsTitle(title) {
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

  function normalizeCalendarRow(id, raw) {
    if (!raw || typeof raw !== "object") return null;
    var title = String(raw.title || raw.summary || "").trim();
    return {
      id: String(raw.id || id || ""),
      title: title,
      rider: String(raw.rider || riderFromPcsTitle(title)),
      pickup: String(raw.pickup || raw.location || ""),
      dropoff: String(raw.dropoff || dropoffFromNotes(raw.description || raw.notes || "")),
      start: String(raw.start || ""),
      end: String(raw.end || ""),
      description: String(raw.description || raw.notes || ""),
      assignedDriverId: String(raw.assignedDriverId || ""),
      assignedDriverName: String(raw.assignedDriverName || ""),
      status: String(raw.status || "open").toLowerCase(),
      code: String(raw.code || ""),
      fareBeforeTax: raw.fareBeforeTax != null ? Number(raw.fareBeforeTax) : null,
      commissionCents: raw.commissionCents != null ? Number(raw.commissionCents) : null,
      completedAt: raw.completedAt || null
    };
  }

  function listCalendarRides() {
    return fetch(calendarUrl()).then(function (res) {
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
            return normalizeCalendarRow(id, data[id]);
          }).filter(Boolean);
        } catch (e) {
          return [];
        }
      });
    });
  }

  function putCalendarRide(row) {
    if (!row || !row.id) return Promise.reject(new Error("calendar-id"));
    return fetch(calendarUrl(row.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) throw new Error("calendar-put");
      return res.text().then(function () { return row; });
    });
  }

  function fmtBoardWhen(iso) {
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

  function boardDayKey(iso) {
    if (!iso) return "";
    try {
      var parts = {};
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date(iso)).forEach(function (part) {
        if (part.type !== "literal") parts[part.type] = part.value;
      });
      return parts.year + "-" + parts.month + "-" + parts.day;
    } catch (err) {
      return "";
    }
  }

  function upcomingCalendarRides() {
    var today = chicagoToday();
    return (state.calendar || []).filter(function (r) {
      if (!r) return false;
      if (r.status === "cancelled") return false;
      var day = boardDayKey(r.start) || today;
      return day >= today;
    }).sort(function (a, b) {
      return String(a.start || "").localeCompare(String(b.start || ""));
    });
  }

  function approvedDriversForAssign() {
    return knownDriverRows().filter(function (d) {
      return d && d.active !== false && approvalOf(d) === "approved";
    });
  }

  function makeScheduleCode(eventId) {
    var raw = "PCS" + String(eventId || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var out = "";
    var i;
    for (i = 0; i < raw.length && out.length < 8; i += 1) {
      var ch = raw.charAt(i);
      if (alphabet.indexOf(ch) >= 0) out += ch;
    }
    i = 0;
    while (out.length < 8) {
      out += alphabet[i % alphabet.length];
      i += 1;
    }
    return out.slice(0, 8);
  }

  function assignCalendarRide(eventId, driverId) {
    var row = null;
    (state.calendar || []).forEach(function (r) {
      if (r && r.id === eventId) row = r;
    });
    if (!row) return Promise.reject(new Error("missing"));
    var driver = null;
    approvedDriversForAssign().forEach(function (d) {
      if (d.id === driverId) driver = d;
    });
    if (!driver) return Promise.reject(new Error("driver"));
    var next = Object.assign({}, row, {
      assignedDriverId: driver.id,
      assignedDriverName: driver.name || driver.id,
      status: row.status === "completed" ? "completed" : "assigned",
      code: row.code || makeScheduleCode(eventId),
      updatedAt: Date.now()
    });
    return putCalendarRide(next).then(function () {
      state.boardNotice = "Assigned " + (next.rider || "ride") + " → " + (driver.name || driver.id);
      return refresh();
    });
  }

  function completeCalendarRide(eventId, fareBeforeTax) {
    var row = null;
    (state.calendar || []).forEach(function (r) {
      if (r && r.id === eventId) row = r;
    });
    if (!row) return Promise.reject(new Error("missing"));
    if (!row.assignedDriverId) return Promise.reject(new Error("unassigned"));
    var fare = Number(fareBeforeTax);
    if (!isFinite(fare) || fare < 0) fare = Number(row.fareBeforeTax) || 0;
    var pct = commissionPctFor(row.assignedDriverId);
    var commissionCents = Math.round(fare * (pct / 100));
    var day = boardDayKey(row.start) || chicagoToday();
    var code = row.code || makeScheduleCode(eventId);
    var entry = {
      code: code,
      day: day,
      completedAt: Date.now(),
      when: fmtBoardWhen(row.start),
      pickup: row.pickup || "",
      drop: row.dropoff || "",
      rawMiles: null,
      billedMiles: null,
      fareSub: fare,
      fareTax: 0,
      fareTotal: fare,
      commissionPct: pct,
      commissionCents: commissionCents,
      riderName: row.rider || "",
      source: "calendar"
    };
    var next = Object.assign({}, row, {
      status: "completed",
      completedAt: Date.now(),
      code: code,
      fareBeforeTax: fare,
      commissionCents: commissionCents,
      updatedAt: Date.now()
    });
    return putCalendarRide(next).then(function () {
      return fetch(historyUrl(row.assignedDriverId, code), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      });
    }).then(function (res) {
      if (res && !res.ok) throw new Error("history");
      state.boardNotice = "Completed · " + fmtCents(commissionCents) + " commission to " + (row.assignedDriverName || row.assignedDriverId);
      return refresh();
    });
  }


  function chicagoToday() {
    var parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date()).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  function carLabel(row) {
    if (!row) return "";
    return [row.carYear, row.carMake, row.carModel].filter(Boolean).join(" ");
  }

  function listDriverMiles(driverId) {
    if (!driverId) return Promise.resolve({});
    return fetch(milesUrl(driverId)).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("miles-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("miles");
      return res.text().then(function (text) {
        if (!text || text === "null") return {};
        try {
          var data = JSON.parse(text);
          return data && typeof data === "object" ? data : {};
        } catch (e) {
          return {};
        }
      });
    });
  }

  function last14Days() {
    var out = [];
    var now = new Date();
    var i;
    for (i = 0; i < 14; i += 1) {
      var d = new Date(now.getTime() - i * 86400000);
      var parts = {};
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(d).forEach(function (part) {
        if (part.type !== "literal") parts[part.type] = part.value;
      });
      out.push(parts.year + "-" + parts.month + "-" + parts.day);
    }
    return out;
  }

  function sanitizeDriverId(email) {
    return String(email || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
  }

  function clampPct(raw) {
    var n = Number(raw);
    if (!isFinite(n)) return null;
    n = Math.round(n);
    if (n < 0 || n > 100) return null;
    return n;
  }

  function commissionPctFor(driverId) {
    if (state.commissionDrafts && state.commissionDrafts[driverId] != null && state.commissionDrafts[driverId] !== "") {
      var draft = clampPct(state.commissionDrafts[driverId]);
      if (draft != null) return draft;
    }
    var row = state.roster && state.roster[driverId];
    if (row && row.commissionPct != null && isFinite(+row.commissionPct)) {
      return clampPct(row.commissionPct) != null ? clampPct(row.commissionPct) : DEFAULT_COMMISSION_PCT;
    }
    return DEFAULT_COMMISSION_PCT;
  }

  function isRosterActive(driverId) {
    var row = state.roster && state.roster[driverId];
    if (!row) return true; /* unknown online driver: treat as active until hired/fired */
    return row.active !== false;
  }

  function approvalOf(row) {
    if (!row) return "unknown";
    var a = String(row.approvalStatus || "").toLowerCase();
    if (a === "pending") return "pending";
    if (a === "rejected") return "rejected";
    if (row.active === false) return "fired";
    return "approved";
  }

  function historyUrl(driverId, rideCode) {
    var base = baseUrl() + "/rides/" + encodeURIComponent(HISTORY_HUB) + "/" + encodeURIComponent(driverId);
    if (rideCode) return base + "/" + encodeURIComponent(rideCode) + ".json";
    return base + ".json";
  }

  function listDriverHistory(driverId) {
    return fetch(historyUrl(driverId)).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("history-denied");
        err.denied = true;
        throw err;
      }
      if (res.status === 404) return {};
      if (!res.ok) throw new Error("history");
      return res.text().then(function (text) {
        if (!text || text === "null") return {};
        try {
          var data = JSON.parse(text);
          return data && typeof data === "object" ? data : {};
        } catch (e) { return {}; }
      });
    });
  }

  function historyEntries(driverId) {
    var raw = (state.history && state.history[driverId]) || {};
    return Object.keys(raw).map(function (code) {
      var row = raw[code] || {};
      row.code = row.code || code;
      return row;
    }).sort(function (a, b) {
      return Number(b.completedAt || 0) - Number(a.completedAt || 0);
    });
  }

  function totalsForDriver(driverId) {
    var entries = historyEntries(driverId);
    var rideTotal = 0;
    var commissionTotal = 0;
    var tipTotal = 0;
    entries.forEach(function (e) {
      rideTotal += Number(e.fareTotal) || 0;
      commissionTotal += Number(e.commissionCents) || 0;
      tipTotal += Number(e.tipCents) || 0; /* v70: tips go 100% to the driver */
    });
    return { rideTotal: rideTotal, commissionTotal: commissionTotal, tipTotal: tipTotal, count: entries.length };
  }

  function mondayOfWeek(ymd) {
    var parts = String(ymd || chicagoToday()).split("-");
    var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
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

  function isCoord(v) {
    return v !== null && v !== undefined && v !== "" && isFinite(+v);
  }

  function normalizeEmail(raw) {
    return String(raw || "").trim().toLowerCase();
  }

  function storeOf(kind) {
    try { return kind === "local" ? window.localStorage : window.sessionStorage; } catch (err) { return null; }
  }

  /* Session tag is bound to the current password hash + owner email.
     Changing the God password (new hash in god-auth.js) invalidates every kept sign-in. */
  function keepTag(email) {
    var h = expectedGodHash();
    if (!h || !window.crypto || !window.crypto.subtle) return Promise.resolve("");
    return sha256Hex("pcs-god-keep|" + h + "|" + normalizeEmail(email));
  }

  function readKeepRaw() {
    var kinds = ["local", "session"];
    for (var i = 0; i < kinds.length; i += 1) {
      try {
        var store = storeOf(kinds[i]);
        if (!store) continue;
        var raw = store.getItem(KEEP_KEY);
        if (!raw) continue;
        var data = JSON.parse(raw);
        if (!data || normalizeEmail(data.email) !== OWNER_EMAIL) continue;
        if (!/^[a-f0-9]{64}$/.test(String(data.tag || ""))) continue;
        return data;
      } catch (err) {}
    }
    return null;
  }

  /* Resolves to the owner email when a kept sign-in is valid for the current hash, else "". */
  function restoreSession() {
    var data = readKeepRaw();
    if (!data) return Promise.resolve("");
    return keepTag(data.email).then(function (tag) {
      if (tag && tag === data.tag) return OWNER_EMAIL;
      clearSession();
      return "";
    }).catch(function () { return ""; });
  }

  function writeSession(email) {
    return keepTag(email).then(function (tag) {
      if (!tag) return;
      var payload = JSON.stringify({ email: normalizeEmail(email), tag: tag, at: Date.now() });
      ["local", "session"].forEach(function (kind) {
        try {
          var store = storeOf(kind);
          if (store) store.setItem(KEEP_KEY, payload);
        } catch (err) {}
      });
    }).catch(function () {});
  }

  function clearLegacySession() {
    ["local", "session"].forEach(function (kind) {
      try {
        var store = storeOf(kind);
        if (store) store.removeItem(SESSION_KEY);
      } catch (err) {}
    });
  }

  /* Only called from Sign out (or when a kept tag no longer matches the hash). */
  function clearSession() {
    ["local", "session"].forEach(function (kind) {
      try {
        var store = storeOf(kind);
        if (store) store.removeItem(KEEP_KEY);
      } catch (err) {}
    });
    clearLegacySession();
  }

  function sha256Hex(text) {
    var data = new TextEncoder().encode(String(text || ""));
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function expectedGodHash() {
    var h = "";
    try { h = String(window.PCS_GOD_PASSWORD_HASH || "").trim().toLowerCase(); } catch (err) { h = ""; }
    if (!/^[a-f0-9]{64}$/.test(h)) return "";
    return h;
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || n === "" || !isFinite(+n)) return null;
    return "$" + Number(n).toFixed(2);
  }

  function fmtCents(cents) {
    if (cents === null || cents === undefined || cents === "" || !isFinite(+cents)) return "$0.00";
    return "$" + (Number(cents) / 100).toFixed(2);
  }

  /* v59: "cancel fee $X" / "free cancel (driver X.X mi away)" for a cancelled ride. Server (Worker) answer wins:
     ride.cancelPolicy / PAYMENTS cancelPolicy|cancel; the rider app's own reading (cancelDriverMiles) is the fallback. */
  function cancelFeeText(r, pay) {
    r = r || {};
    pay = pay || {};
    var pol = r.cancelPolicy && typeof r.cancelPolicy === "object" ? r.cancelPolicy : null;
    var payPol = pay.cancelPolicy && typeof pay.cancelPolicy === "object" ? pay.cancelPolicy : null;
    var cf = String(r.cancelFeeStatus || "").toLowerCase();
    var miles = pol && pol.miles != null ? pol.miles : (payPol && payPol.miles != null ? payPol.miles
      : (pay.cancel && pay.cancel.miles != null ? pay.cancel.miles : r.cancelDriverMiles));
    var mi = miles != null && miles !== "" && isFinite(+miles) ? (Math.round(+miles * 10) / 10).toFixed(1) : "";
    var reason = String((pol && pol.reason) || (payPol && payPol.reason) || r.cancelFreeReason || r.cancelClientReason || "");
    var paid = pay.cancel && String(pay.cancel.status || "").toUpperCase() === "COMPLETED";
    if (cf === "charged" || paid) {
      return "cancel fee " + fmtCents(paid ? pay.cancel.amountCents : r.cancelFeeCents) + (mi ? " (driver " + mi + " mi away)" : "");
    }
    if (cf === "refunded") return "cancel fee refunded";
    if (cf === "failed") return "cancel fee failed" + (mi ? " (driver " + mi + " mi away)" : "");
    var accepted = !!(r.acceptedAt || r.driverId || r.driverUid || r.driverName);
    if (cf === "free" || (pol && pol.charge === false) || payPol || (accepted && !(Number(r.cancelFeeCents) > 0))) {
      if (reason === "driver_location_stale" || reason === "driver_location_missing") return "free cancel (driver location not current)";
      if (reason === "not_accepted") return "free cancel (before a driver accepted)";
      if (reason === "decision_window_passed") return "free cancel (too late to check distance)";
      return "free cancel" + (mi ? " (driver " + mi + " mi away)" : "");
    }
    if (!accepted) return "free cancel (before a driver accepted)";
    if (Number(r.cancelFeeCents) > 0) return "cancel fee " + fmtCents(r.cancelFeeCents) + " due" + (mi ? " (driver " + mi + " mi away)" : "");
    return "";
  }

  function fmtClock(ms) {
    if (!ms || !isFinite(+ms)) return "—";
    try {
      return new Date(+ms).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }) + " CT";
    } catch (err) {
      return "—";
    }
  }

  function fmtWhen(dateStr, timeStr, ride) {
    if (ride) {
      var asapFlag = ride.asap === true || ride.asap === 1 ||
        String(ride.asap || "").toLowerCase() === "true" ||
        String(ride.when || "").toLowerCase() === "asap" ||
        String(ride.time || "").toLowerCase() === "asap";
      if (asapFlag) return "ASAP";
    }
    var d = String(dateStr || "").trim();
    var t = String(timeStr || "").trim();
    if (t.toLowerCase() === "asap") return "ASAP";
    if (!d && !t) return "—";
    if (d && t) return d + " · " + t;
    return d || t;
  }

  function waitLabel(fromMs) {
    if (!fromMs || !isFinite(+fromMs)) return "—";
    var sec = Math.max(0, Math.floor((Date.now() - +fromMs) / 1000));
    if (sec < 60) return sec + "s";
    var min = Math.floor(sec / 60);
    if (min < 60) return min + "m";
    var hr = Math.floor(min / 60);
    return hr + "h " + (min % 60) + "m";
  }

  function displayName(raw, fallback) {
    var n = String(raw || "").trim();
    return n || fallback || "Unknown";
  }

  function shortName(raw, fallback) {
    var n = displayName(raw, fallback);
    if (n.length <= 18) return n;
    return n.slice(0, 16) + "…";
  }

  /* Never hardcode or promote the personal line; business line only if a call link is needed. */
  function businessCallHref() {
    return "tel:+19362617878";
  }

  function tryLogin(email, password) {
    var e = normalizeEmail(email);
    state.loginError = "";
    if (!e) {
      state.loginError = "Enter your email.";
      return Promise.resolve(false);
    }
    if (e !== OWNER_EMAIL) {
      state.loginError = "This console is for the owner account only.";
      return Promise.resolve(false);
    }
    if (!String(password || "").length) {
      state.loginError = "Enter your password.";
      return Promise.resolve(false);
    }
    var expected = expectedGodHash();
    if (!expected) {
      state.loginError = "God login is not configured (missing password hash). See DEPLOY-NOTES.md.";
      return Promise.resolve(false);
    }
    if (!window.crypto || !window.crypto.subtle) {
      state.loginError = "This browser cannot verify the password securely.";
      return Promise.resolve(false);
    }
    return sha256Hex(password).then(function (got) {
      if (got !== expected) {
        state.loginError = "Wrong email or password.";
        return false;
      }
      return writeSession(e).then(function () {
        state.sessionEmail = e;
        state.screen = "board";
        state.loginError = "";
        return true;
      });
    }).catch(function () {
      state.loginError = "Could not verify password.";
      return false;
    });
  }

  function logout() {
    clearSession();
    state.sessionEmail = "";
    state.screen = "login";
    state.drivers = [];
    state.rides = [];
    state.roster = {};
    state.driversError = "";
    state.ridesError = "";
    state.rosterError = "";
    state.commissionDrafts = {};
    state.hireName = "";
    state.hirePhone = "";
    state.hireEmail = "";
    state.hirePct = String(DEFAULT_COMMISSION_PCT);
    state.hireError = "";
    state.hireNotice = "";
    state.actionNotice = "";
    state.focusDriverId = "";
    state.focusNote = "";
    stopPoll();
    tearMap();
    render();
  }

  /* v64g: driver presence. iPhone stops the driver app's GPS + timers while another app (e.g. Lyft) is in front, so
     /rides/AVLBLDRV/drivers/{id}.at goes stale although the driver is still on shift. The driver app only writes this
     row while a shift is open (publishDriverPresence needs canGoOnline: start odometer entered) and DELETEs it on
     Log out / end of shift / page close. So a row that still says online:true (or shiftOnline:true from the newer
     driver app, or a start odometer) = on shift. v64 driver contract: shiftOnline, appState foreground|background|closed,
     foregroundAt / backgroundedAt, lastLat/lastLng; pagehide writes appState "closed" + online:false (shift still open). live = update in the last 2 min and not backgrounded;
     background = on shift but quiet (or backgroundedAt newer than foregroundAt), up to 12 h; then offline. */
  var BACKGROUND_MAX_MS = 12 * 3600000;
  function presenceOf(row, now) {
    now = now || Date.now();
    var rowAt = Number(row.at) || 0;
    var bg = Number(row.backgroundedAt) || 0;
    var fg = Number(row.foregroundAt) || 0;
    /* last seen = newest of at / gpsAt / foregroundAt / backgroundedAt (v64 driver contract) */
    var at = Math.max(rowAt, Number(row.gpsAt) || 0, fg, bg, Number(row.heartbeatAt) || 0);
    var shift = row.shiftOnline === true;
    if (row.shiftOnline === false) return { state: "offline", lastSeenAt: at };      /* v64: shift ended */
    if (row.online === false && !shift) return { state: "offline", lastSeenAt: at };   /* v63 / explicit off */
    var fresh = !!rowAt && now - rowAt <= ONLINE_MS;
    var app = String(row.appState || "").toLowerCase();
    var backgrounded = app === "background" || app === "closed" || row.online === false ||
      (bg > 0 && bg > fg && bg >= rowAt - 5000);
    var odo = row.startOdometer;
    var onShift = shift || row.online === true || (odo != null && odo !== "" && isFinite(Number(odo)));
    if (!onShift) return { state: fresh ? "live" : "offline", lastSeenAt: at };
    var since = at || Number(row.shiftStartedAt) || 0;
    if (!since || now - since > BACKGROUND_MAX_MS) return { state: "offline", lastSeenAt: since };
    return { state: fresh && !backgrounded ? "live" : "background", lastSeenAt: since };
  }
  function agoText(ts) {
    var m = Math.round((Date.now() - (Number(ts) || 0)) / 60000);
    if (!(Number(ts) > 0)) return "unknown";
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60);
    return h + " h " + (m % 60) + " min ago";
  }
  function isBackgroundDriver(d) { return !!(d && d.online && d.presence === "background"); }

  function listOnlineDrivers() {
    return fetch(driversUrl()).then(function (res) {
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
        var now = Date.now();
        var out = [];
        Object.keys(data).forEach(function (id) {
          var row = data[id];
          if (!row || typeof row !== "object") return;
          var pres = presenceOf(row, now); /* v64g: background drivers stay listed */
          if (pres.state === "offline") return;
          row.id = id;
          /* v64 driver: last known spot when lat/lng are empty */
          if (!(isCoord(row.lat) && isCoord(row.lng)) && isCoord(row.lastLat) && isCoord(row.lastLng)) { row.lat = row.lastLat; row.lng = row.lastLng; }
          row.presence = pres.state;
          row.lastSeenAt = pres.lastSeenAt;
          row.rawOnline = row.online;
          row.online = true; /* listed = on shift (v64 pagehide writes online:false while the shift stays open) */
          out.push(row);
        });
        return out;
      });
    });
  }

  function listRoster() {
    return fetch(rosterUrl()).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("roster-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("roster");
      return res.text().then(function (text) {
        if (!text || text === "null") return {};
        var data;
        try { data = JSON.parse(text); } catch (e) { return {}; }
        if (!data || typeof data !== "object") return {};
        var out = {};
        Object.keys(data).forEach(function (id) {
          var row = data[id];
          if (!row || typeof row !== "object") return;
          row.id = id;
          out[id] = row;
        });
        return out;
      });
    });
  }

  function putRosterRow(id, row) {
    /* v46: keep the driver's roster login password (salted hash) when God mode rewrites the row. */
    var prevRow = (state.roster && state.roster[id]) || {};
    ["pwHash", "pwSalt", "pwIter", "pwAlgo", "pwSetAt"].forEach(function (k) {
      if (row[k] == null && prevRow[k] != null) row[k] = prevRow[k];
    });
    return fetch(rosterUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("roster-write-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("roster-write");
      return row;
    });
  }

  function clearPresence(id) {
    if (!id) return Promise.resolve();
    return fetch(presenceDriverUrl(id), { method: "DELETE" }).catch(function () {});
  }

  function saveCommission(driverId, pctRaw) {
    var pct = clampPct(pctRaw);
    if (pct == null) {
      state.actionNotice = "Commission must be a whole number from 0 to 100.";
      return Promise.resolve(false);
    }
    var existing = (state.roster && state.roster[driverId]) || {};
    var online = null;
    (state.drivers || []).forEach(function (d) {
      if (d && d.id === driverId) online = d;
    });
    var row = {
      name: existing.name || (online && online.name) || driverId,
      phone: existing.phone || (online && online.phone) || "",
      email: existing.email || (online && online.email) || "",
      commissionPct: pct,
      active: existing.active !== false,
      approvalStatus: existing.approvalStatus || (existing.active === false ? "fired" : "approved"),
      hiredAt: existing.hiredAt || Date.now(),
      updatedAt: Date.now()
    };
    if (!row.email && driverId.indexOf("_") >= 0) {
      /* id is sanitized email; keep blank email if unknown */
    }
    return putRosterRow(driverId, row).then(function () {
      state.roster[driverId] = Object.assign({ id: driverId }, row);
      delete state.commissionDrafts[driverId];
      state.actionNotice = "Saved " + pct + "% commission for " + (row.name || driverId) + ".";
      return true;
    }).catch(function (err) {
      state.actionNotice = err && err.denied
        ? "Cannot save commission (Firebase permission denied on /rides/" + ROSTER_HUB + ")."
        : "Could not save commission.";
      return false;
    });
  }

  function hireDriver() {
    state.hireError = "";
    state.hireNotice = "";
    var name = String(state.hireName || "").trim();
    var phone = String(state.hirePhone || "").trim();
    var email = normalizeEmail(state.hireEmail);
    var pct = clampPct(state.hirePct);
    if (!name) {
      state.hireError = "Enter the driver’s name.";
      return Promise.resolve(false);
    }
    if (!email || email.indexOf("@") < 1) {
      state.hireError = "Enter a valid driver email.";
      return Promise.resolve(false);
    }
    if (pct == null) {
      state.hireError = "Commission must be 0–100.";
      return Promise.resolve(false);
    }
    var id = sanitizeDriverId(email);
    if (!id) {
      state.hireError = "Email could not be used as a driver id.";
      return Promise.resolve(false);
    }
    var existing = state.roster[id];
    var row = {
      name: name,
      phone: phone,
      email: email,
      commissionPct: pct,
      active: true,
      approvalStatus: "approved",
      hiredAt: (existing && existing.hiredAt) || Date.now(),
      updatedAt: Date.now(),
      rehiredAt: existing && existing.active === false ? Date.now() : undefined
    };
    if (!row.rehiredAt) delete row.rehiredAt;
    return putRosterRow(id, row).then(function () {
      state.roster[id] = Object.assign({ id: id }, row);
      state.hireName = "";
      state.hirePhone = "";
      state.hireEmail = "";
      state.hirePct = String(DEFAULT_COMMISSION_PCT);
      state.hireNotice = "Hired " + name + " at " + pct + "%.";
      state.actionNotice = state.hireNotice;
      return true;
    }).catch(function (err) {
      state.hireError = err && err.denied
        ? "Cannot hire (Firebase permission denied on /rides/" + ROSTER_HUB + ")."
        : "Could not save hire.";
      return false;
    });
  }

  function fireDriver(driverId) {
    var existing = (state.roster && state.roster[driverId]) || {};
    var online = null;
    (state.drivers || []).forEach(function (d) {
      if (d && d.id === driverId) online = d;
    });
    var row = {
      name: existing.name || (online && online.name) || driverId,
      phone: existing.phone || (online && online.phone) || "",
      email: existing.email || (online && online.email) || "",
      commissionPct: existing.commissionPct != null ? clampPct(existing.commissionPct) : DEFAULT_COMMISSION_PCT,
      active: false,
      approvalStatus: "fired",
      hiredAt: existing.hiredAt || Date.now(),
      firedAt: Date.now(),
      updatedAt: Date.now()
    };
    if (row.commissionPct == null) row.commissionPct = DEFAULT_COMMISSION_PCT;
    return putRosterRow(driverId, row).then(function () {
      state.roster[driverId] = Object.assign({ id: driverId }, row);
      return clearPresence(driverId).then(function () {
        state.actionNotice = "Fired " + (row.name || driverId) + ". Marked inactive and cleared live presence.";
        /* Drop from online list locally until next poll. */
        state.drivers = (state.drivers || []).filter(function (d) { return !d || d.id !== driverId; });
        return true;
      });
    }).catch(function (err) {
      state.actionNotice = err && err.denied
        ? "Cannot fire (Firebase permission denied on /rides/" + ROSTER_HUB + ")."
        : "Could not fire driver.";
      return false;
    });
  }

  function rehireDriver(driverId) {
    var existing = (state.roster && state.roster[driverId]) || {};
    var pct = existing.commissionPct != null ? clampPct(existing.commissionPct) : DEFAULT_COMMISSION_PCT;
    if (pct == null) pct = DEFAULT_COMMISSION_PCT;
    var row = {
      name: existing.name || driverId,
      phone: existing.phone || "",
      email: existing.email || "",
      commissionPct: pct,
      active: true,
      approvalStatus: "approved",
      hiredAt: existing.hiredAt || Date.now(),
      rehiredAt: Date.now(),
      updatedAt: Date.now()
    };
    return putRosterRow(driverId, row).then(function () {
      state.roster[driverId] = Object.assign({ id: driverId }, row);
      state.actionNotice = "Rehired " + (row.name || driverId) + " at " + pct + "%.";
      return true;
    }).catch(function (err) {
      state.actionNotice = err && err.denied
        ? "Cannot rehire (Firebase permission denied on /rides/" + ROSTER_HUB + ")."
        : "Could not rehire driver.";
      return false;
    });
  }

  function approveDriver(driverId) {
    var existing = (state.roster && state.roster[driverId]) || {};
    var pct = existing.commissionPct != null ? clampPct(existing.commissionPct) : DEFAULT_COMMISSION_PCT;
    if (pct == null) pct = DEFAULT_COMMISSION_PCT;
    var row = {
      name: existing.name || driverId,
      phone: existing.phone || "",
      email: existing.email || "",
      commissionPct: pct,
      active: true,
      approvalStatus: "approved",
      hiredAt: existing.hiredAt || existing.signedUpAt || Date.now(),
      approvedAt: Date.now(),
      updatedAt: Date.now(),
      carYear: existing.carYear || "",
      carMake: existing.carMake || "",
      carModel: existing.carModel || "",
      carPlate: existing.carPlate || "",
      carSeats: existing.carSeats || ""
    };
    return putRosterRow(driverId, row).then(function () {
      state.roster[driverId] = Object.assign({ id: driverId }, row);
      state.actionNotice = "Approved " + (row.name || driverId) + ". They can go online.";
      return true;
    }).catch(function (err) {
      state.actionNotice = err && err.denied
        ? "Cannot approve (Firebase permission denied on /rides/" + ROSTER_HUB + ")."
        : "Could not approve driver.";
      return false;
    });
  }

  function rejectDriver(driverId) {
    var existing = (state.roster && state.roster[driverId]) || {};
    var pct = existing.commissionPct != null ? clampPct(existing.commissionPct) : DEFAULT_COMMISSION_PCT;
    if (pct == null) pct = DEFAULT_COMMISSION_PCT;
    var row = {
      name: existing.name || driverId,
      phone: existing.phone || "",
      email: existing.email || "",
      commissionPct: pct,
      active: false,
      approvalStatus: "rejected",
      hiredAt: existing.hiredAt || existing.signedUpAt || Date.now(),
      rejectedAt: Date.now(),
      updatedAt: Date.now()
    };
    return putRosterRow(driverId, row).then(function () {
      state.roster[driverId] = Object.assign({ id: driverId }, row);
      return clearPresence(driverId).then(function () {
        state.actionNotice = "Rejected " + (row.name || driverId) + ".";
        state.drivers = (state.drivers || []).filter(function (d) { return !d || d.id !== driverId; });
        return true;
      });
    }).catch(function (err) {
      state.actionNotice = err && err.denied
        ? "Cannot reject (Firebase permission denied on /rides/" + ROSTER_HUB + ")."
        : "Could not reject driver.";
      return false;
    });
  }

  function isPendingOwner(ride) {
    var st = String((ride && ride.status) || "").toLowerCase();
    return st === "pending_owner" || st === "pending-owner";
  }

  function patchRide(code, partial) {
    if (!code) return Promise.reject(new Error("code"));
    return fetch(rideUrl(code), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial)
    }).then(function (res) {
      if (!res.ok) throw new Error("ride");
      return res.text().then(function () {});
    });
  }

  function putOpenSummary(code, ride) {
    if (!code) return Promise.resolve();
    var summary = {
      code: code,
      kind: "ride",
      name: (ride && ride.name) || "",
      phone: (ride && ride.phone) || "",
      pickupStreet: (ride && ride.pickupStreet) || "",
      pickupCity: (ride && ride.pickupCity) || "",
      pickupState: (ride && ride.pickupState) || "",
      dropStreet: (ride && ride.dropStreet) || "",
      dropCity: (ride && ride.dropCity) || "",
      dropState: (ride && ride.dropState) || "",
      date: (ride && ride.date) || "",
      time: (ride && ride.time) || "",
      asap: !!(ride && (ride.asap === true || String(ride.asap).toLowerCase() === "true" || String(ride.when || "").toLowerCase() === "asap")),
      when: (ride && ride.when) || "",
      status: (ride && ride.status) || "requested",
      pickupLat: ride ? ride.pickupLat : null,
      pickupLng: ride ? ride.pickupLng : null,
      dropLat: ride ? ride.dropLat : null,
      dropLng: ride ? ride.dropLng : null,
      /* v48: keep the fields the driver app filters/shows on (TEST rides must stay hidden from other drivers). */
      isTest: !!(ride && (ride.isTest === true || String(ride.isTest).toLowerCase() === "true")),
      cardStatus: (ride && ride.cardStatus) || "",
      pickupZip: (ride && ride.pickupZip) || "",
      dropZip: (ride && ride.dropZip) || "",
      pickupAddress: (ride && ride.pickupAddress) || "",
      dropAddress: (ride && ride.dropAddress) || "",
      pickupLine2: (ride && ride.pickupLine2) || "",
      dropLine2: (ride && ride.dropLine2) || "",
      stops: ride && ride.stops != null ? Number(ride.stops) || 0 : 0,
      updatedAt: Date.now(),
      requestedAt: (ride && (ride.requestedAt || ride.createdAt)) || Date.now()
    };
    return fetch(openUrl().replace(/\.json$/, "/") + encodeURIComponent(code) + ".json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summary)
    }).then(function (res) {
      if (!res.ok) throw new Error("open");
      return res.text().then(function () {});
    });
  }

  function godIsCoord(n) { return typeof n === "number" && isFinite(n) && Math.abs(n) <= 180; }

  function godMiles(a, b) {
    var R = 3958.8, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function godTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  /* street + city + state (ZIP optional) -> { lat, lng, zip, level, label } nearest the pickup. */
  function findDropForRide(ride) {
    var street = String((ride && ride.dropStreet) || "").trim();
    var city = String((ride && ride.dropCity) || "").trim();
    var st = String((ride && ride.dropState) || "TX").trim() || "TX";
    var zip = String((ride && ride.dropZip) || "").trim();
    if (!street) return Promise.resolve(null);
    var near = godIsCoord(ride.pickupLat) && godIsCoord(ride.pickupLng) ? { lat: +ride.pickupLat, lng: +ride.pickupLng } : { lat: 30.33, lng: -95.52 };
    var num = (street.match(/^(\d+[A-Za-z]?)\s/) || [])[1] || "";
    var skip = { dr: 1, drive: 1, st: 1, street: 1, rd: 1, road: 1, ln: 1, lane: 1, ave: 1, avenue: 1, blvd: 1, ct: 1, court: 1, cir: 1, circle: 1, way: 1, trl: 1, trail: 1, pkwy: 1, loop: 1, n: 1, s: 1, e: 1, w: 1, north: 1, south: 1, east: 1, west: 1 };
    var core = street.replace(/^\s*\d+[A-Za-z]?\s+/, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && !skip[w]; });
    function coreOk(text) {
      var t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
      return core.length && core.every(function (w) { return t.indexOf(" " + w) !== -1; });
    }
    function nominatim(params) {
      return godTimeout(fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&" + params).then(function (r) {
        if (!r.ok) throw new Error("nominatim");
        return r.json();
      }), 7000).then(function (list) {
        return (Array.isArray(list) ? list : []).map(function (h) {
          var a = h.address || {};
          var pt = { lat: +h.lat, lng: +h.lon };
          return { lat: pt.lat, lng: pt.lng, house: a.house_number || "", road: a.road || "", city: a.city || a.town || a.village || "", zip: String(a.postcode || "").slice(0, 5), dist: godMiles(near, pt) };
        }).filter(function (h) { return godIsCoord(h.lat) && h.dist < 300; }).sort(function (a, b) { return a.dist - b.dist; });
      }).catch(function () { return []; });
    }
    function label(h) { return [[h.house, h.road].filter(Boolean).join(" "), h.city, st, h.zip].filter(Boolean).join(", "); }
    var structured = "street=" + encodeURIComponent(street) + (city ? "&city=" + encodeURIComponent(city) : "") + "&state=" + encodeURIComponent(st) + (zip ? "&postalcode=" + encodeURIComponent(zip) : "");
    return nominatim(structured).then(function (hits) {
      var exact = hits.filter(function (h) { return num && h.house === num; })[0];
      if (exact) return { lat: exact.lat, lng: exact.lng, zip: exact.zip, level: "exact", label: label(exact) };
      var road = hits.filter(function (h) { return coreOk(h.road); })[0];
      if (road) return { lat: road.lat, lng: road.lng, zip: road.zip, level: "street", label: "near " + label(road) };
      /* Street name alone, nearest the pickup (e.g. "Veilwood" -> Veilwood Cir, The Woodlands). */
      return godTimeout(fetch("https://photon.komoot.io/api/?limit=10&lang=en&location_bias_scale=0.1&lat=" + near.lat + "&lon=" + near.lng + "&q=" + encodeURIComponent(core.join(" "))).then(function (r) { return r.json(); }), 8000).then(function (data) {
        var best = null;
        ((data && data.features) || []).forEach(function (f) {
          var pr = f.properties || {};
          var c = (f.geometry && f.geometry.coordinates) || [];
          var pt = { lat: +c[1], lng: +c[0] };
          if (!godIsCoord(pt.lat) || !coreOk(pr.street || pr.name)) return;
          if (pr.countrycode && String(pr.countrycode).toUpperCase() !== "US") return;
          var d = godMiles(near, pt);
          if (d > 60) return;
          if (!best || d < best.dist) best = { lat: pt.lat, lng: pt.lng, zip: String(pr.postcode || "").slice(0, 5), level: "street", dist: d, label: "near " + [pr.name || pr.street, pr.city, st, String(pr.postcode || "").slice(0, 5)].filter(Boolean).join(", ") };
        });
        return best;
      }).catch(function () { return null; });
    }).then(function (found) {
      if (found || !city) return found;
      return nominatim("city=" + encodeURIComponent(city) + "&state=" + encodeURIComponent(st)).then(function (hits) {
        var h = hits[0];
        return h ? { lat: h.lat, lng: h.lng, zip: "", level: "city", label: city + ", " + st + " (city center)" } : null;
      });
    });
  }

  /* Approve / Mark card OK: if the To place was never pinned, find it now and save it on the ride. */
  function fillMissingDrop(code, ride) {
    if (!ride || (godIsCoord(ride.dropLat) && godIsCoord(ride.dropLng)) || !ride.dropStreet) return Promise.resolve(ride);
    return findDropForRide(ride).then(function (f) {
      if (!f) return ride;
      var patch = { dropLat: f.lat, dropLng: f.lng, dropApprox: f.level === "exact" ? "" : f.level, dropFound: f.label || "" };
      if (f.zip && !ride.dropZip && f.level !== "city") patch.dropZip = f.zip;
      return patchRide(code, patch).then(function () {
        return Object.assign({}, ride, patch);
      }).catch(function () { return ride; });
    }).catch(function () { return ride; });
  }

  function approveBooking(code) {
    code = String(code || "").toUpperCase();
    if (!code) return Promise.resolve(false);
    return getRide(code).then(function (ride) {
      if (!ride) throw new Error("missing");
      if (String(ride.status || "").toLowerCase() === "cancelled") {
        state.actionNotice = "Booking " + code + " was already cancelled by the rider.";
        return false;
      }
      var next = Object.assign({}, ride, {
        status: "requested",
        ownerApprovedAt: Date.now(),
        updatedAt: Date.now()
      });
      delete next.ownerDeniedAt;
      delete next.denyReason;
      return patchRide(code, {
        status: "requested",
        ownerApprovedAt: next.ownerApprovedAt,
        updatedAt: next.updatedAt
      }).then(function () {
        return fillMissingDrop(code, next);
      }).then(function (filled) {
        next = filled || next;
        return putOpenSummary(code, next);
      }).then(function () {
        state.actionNotice = "Approved booking " + code + " — drivers can accept it now." +
          (godIsCoord(next.dropLat) ? (next.dropApprox ? " Drop-off pinned approximately (" + (next.dropFound || "") + ")." : "") : " Drop-off address isn't on the map; drivers can still accept and see the address.");
        state.pendingBanner = "";
        return true;
      });
    }).catch(function () {
      state.actionNotice = "Could not approve booking " + code + ".";
      return false;
    });
  }

  function markCardOk(code) {
    var now = Date.now();
    return getRide(code).then(function (ride) {
      if (!ride) throw new Error("missing");
      var st = String(ride.status || "").toLowerCase();
      var wasPending = st === "pending_owner" || st === "pending-owner";
      var patch = { cardStatus: "owner_ok", cardOwnerOkAt: now, updatedAt: now };
      if (wasPending) {
        patch.status = "requested";
        patch.ownerApprovedAt = now;
      }
      return patchRide(code, patch).then(function () {
        var next = Object.assign({}, ride, patch);
        if (next.status !== "requested") return wasPending;
        return fillMissingDrop(code, next).then(function (filled) {
          return putOpenSummary(code, filled || next);
        }).then(function () { return wasPending; });
      });
    });
  }

  function denyBooking(code) {
    code = String(code || "").toUpperCase();
    if (!code) return Promise.resolve(false);
    return getRide(code).then(function (ride) {
      if (!ride) throw new Error("missing");
      var when = Date.now();
      return patchRide(code, {
        status: "denied",
        ownerDeniedAt: when,
        updatedAt: when,
        denyReason: "Owner declined this booking"
      }).then(function () {
        return fetch(openUrl().replace(/\.json$/, "/") + encodeURIComponent(code) + ".json", { method: "DELETE" }).catch(function () {});
      }).then(function () {
        state.actionNotice = "Denied booking " + code + ". Rider will see it in-app.";
        return true;
      });
    }).catch(function () {
      state.actionNotice = "Could not deny booking " + code + ".";
      return false;
    });
  }

  function pendingBookings() {
    return (state.rides || []).filter(isPendingOwner);
  }

  function requestDesktopNotify(title, body) {
    try {
      if (!("Notification" in window)) return;
      var show = function () {
        try { new Notification(title, { body: body || "", tag: "pcs-booking" }); } catch (e) {}
      };
      if (document.visibilityState === "visible") return; /* v64g: on screen = pop-up + alarm */
      if (Notification.permission === "granted") show();
    } catch (err) {}
  }

  function bookingAlertBannerHtml() {
    var pending = pendingBookings();
    if (!pending.length) return "";
    var first = pending[0];
    var label = displayName(first.name, "Rider") + " · " + (fmtWhen(first.date, first.time, first));
    var mail = "mailto:mwragge78@gmail.com?subject=" + encodeURIComponent("PCS booking pending " + (first.code || "")) +
      "&body=" + encodeURIComponent("Pending booking " + (first.code || "") + " from " + label);
    var sms = "sms:9362617878?&body=" + encodeURIComponent("PCS pending booking " + (first.code || "") + " " + label);
    var actionRows = pending.map(function (r) {
      var code = String(r.code || "");
      var who = displayName(r.name, "Rider") + " · " + fmtWhen(r.date, r.time, r);
      return (
        '<div class="banner-ride" style="margin:10px 0;padding:10px;border:1px solid rgba(240,212,138,.35);border-radius:12px">' +
        '<p class="lede" style="margin:0 0 8px"><strong>' + esc(who) + "</strong> · " + esc(code) + "</p>" +
        '<p class="fine" style="margin:0 0 8px">' + esc(rideAddressText(r, "pickup") || "Pickup") + " → " + esc(rideAddressText(r, "drop") || "Drop-off") + "</p>" +
        '<div class="row-actions" style="display:flex;flex-wrap:wrap;gap:8px">' +
        '<button type="button" class="btn btn-gold btn-approve-booking" data-ride-code="' + esc(code) + '">Approve booking</button>' +
        '<button type="button" class="btn btn-fire btn-deny-booking" data-ride-code="' + esc(code) + '">Deny</button>' +
        '<button type="button" class="btn btn-ghost btn-card-ok" data-ride-code="' + esc(code) + '">Mark card OK</button>' +
        "</div></div>"
      );
    }).join("");
    return (
      '<div class="card booking-alert" id="booking-alert" style="border:2px solid var(--gold);margin:0 0 12px;padding:12px;background:#1a2e1a">' +
      '<p class="tag">New booking needs your OK</p>' +
      '<p class="lede"><strong>' + esc(String(pending.length)) + '</strong> pending · ' + esc(label) + "</p>" +
      '<p class="fine">Approve so drivers can see it. Deny notifies the rider in-app.</p>' +
      actionRows +
      '<div class="row-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' +
      '<a class="btn btn-ghost" href="' + mail + '">Email me a reminder</a>' +
      '<a class="btn btn-ghost" href="' + sms + '">Text reminder</a>' +
      '<button type="button" class="btn btn-ghost" id="enable-booking-notify">Enable browser alerts</button>' +
      "</div></div>"
    );
  }

  /* v57: God-mode pop-ups are visual only (Matthew: no sound in God mode). The old softGodChime is removed.
     Pop-ups queue up (one at a time, none replaces another) and stay until dismissed. */
  var godPopupQueue = [];

  function ensureGodPopupStyle() {
    if (document.getElementById("god-popup-style")) return;
    var s = document.createElement("style");
    s.id = "god-popup-style";
    s.textContent =
      "#god-ride-popup{position:fixed;inset:0;z-index:12000;background:rgba(5,14,28,.92);display:flex;align-items:center;justify-content:center;padding:16px}" +
      "#god-ride-popup .gp-card{background:#0b1c33;color:#fff;border:2px solid #f0d48a;border-radius:18px;max-width:520px;width:100%;padding:20px;max-height:92vh;overflow:auto}" +
      "#god-ride-popup .gp-title{font-size:28px;font-weight:800;color:#f0d48a;margin:0 0 12px;text-align:center}" +
      "#god-ride-popup.gp-accepted .gp-card{border-color:#2e9d4f}#god-ride-popup.gp-accepted .gp-title{color:#7fe09a}" +
      "#god-ride-popup .gp-row{margin:10px 0;font-size:17px;line-height:1.35}" +
      "#god-ride-popup .gp-row b{display:block;color:#f0d48a;font-size:12px;letter-spacing:.08em;text-transform:uppercase}" +
      "#god-ride-popup .gp-more{font-size:13px;color:#c9d3e0;text-align:center;margin-top:10px}" +
      "#god-ride-popup .gp-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}" +
      "#god-ride-popup .gp-actions button{flex:1;min-width:120px;font-size:18px;font-weight:800;padding:16px 10px;border-radius:12px;border:0;color:#fff;cursor:pointer}" +
      "#god-ride-popup.gp-waiting .gp-card{border:4px solid #f0d48a;animation:gpPulse 1s ease-in-out infinite}" +
      "@keyframes gpPulse{0%,100%{box-shadow:0 0 0 0 rgba(240,212,138,.75)}50%{box-shadow:0 0 0 14px rgba(240,212,138,0)}}" +
      "#god-ride-popup .gp-ok{background:#2e9d4f}#god-ride-popup .gp-deny{background:#8a2323}#god-ride-popup .gp-ghost{background:#345}";
    document.head.appendChild(s);
  }

  function hideGodRidePopup(key) {
    var el = document.getElementById("god-ride-popup");
    var shown = el ? el.getAttribute("data-key") : "";
    if (!key) key = shown || (godPopupQueue[0] && godPopupQueue[0].key);
    godPopupQueue = godPopupQueue.filter(function (it) { return it.key !== key; });
    if (el && el.parentNode && (!shown || shown === key)) el.parentNode.removeChild(el);
    syncGodAlarm();
    showNextGodPopup();
  }

  function queueGodPopup(kind, ride) {
    if (!ride || !ride.code) return;
    var key = kind + ":" + String(ride.code);
    for (var i = 0; i < godPopupQueue.length; i += 1) if (godPopupQueue[i].key === key) return;
    godPopupQueue.push({ key: key, kind: kind, ride: ride });
    if (godPopupQueue.length === 1 || !document.getElementById("god-ride-popup")) showNextGodPopup();
    else {
      var more = document.getElementById("gp-more");
      if (more) more.textContent = (godPopupQueue.length - 1) + " more waiting";
    }
  }

  function showNextGodPopup() {
    if (document.getElementById("god-ride-popup")) return;
    var item = godPopupQueue[0];
    if (!item) return;
    try {
      if (item.kind === "accept") renderGodAcceptPopup(item.ride);
      else renderGodRequestPopup(item.ride);
    } catch (e) {
      godPopupQueue.shift();
      showNextGodPopup();
    }
    syncGodAlarm();
  }

  function godPopupShell(cls, inner) {
    ensureGodPopupStyle();
    var el = document.createElement("div");
    el.id = "god-ride-popup";
    if (cls) el.className = cls;
    if (godPopupQueue[0]) el.setAttribute("data-key", godPopupQueue[0].key);
    var more = godPopupQueue.length > 1 ? (godPopupQueue.length - 1) + " more waiting" : "";
    el.innerHTML = '<div class="gp-card" role="dialog" aria-modal="true">' + inner +
      '<p class="gp-more" id="gp-more">' + esc(more) + "</p></div>";
    document.body.appendChild(el);
    return el;
  }

  /* "New ride request": rider, pickup, ASAP or time. Approve/Deny/Card OK only while it still needs Matthew's OK. */
  function renderGodRequestPopup(ride) {
    var code = String(ride.code);
    var needsOk = isPendingOwner(ride);
    var when = fmtWhen(ride.date, ride.time, ride);
    var key = "request:" + code;
    var el = godPopupShell(needsOk ? "gp-request gp-waiting" : "gp-request",
      '<p class="gp-title">' + (needsOk ? "Ride waiting for your OK" : "New ride request") + "</p>" +
      (ride.isTest ? '<p class="gp-row" style="background:#7a1f1f;padding:6px 10px;border-radius:8px;text-align:center">TEST ride</p>' : "") +
      '<div class="gp-row"><b>Rider</b>' + esc(displayName(ride.name, "Rider")) + "</div>" +
      '<div class="gp-row"><b>Pickup</b>' + esc(rideAddressText(ride, "pickup") || "—") + "</div>" +
      '<div class="gp-row"><b>When</b>' + esc(when === "—" ? "Time not set" : when) + "</div>" +
      '<div class="gp-row"><b>Drop-off</b>' + esc(rideAddressText(ride, "drop") || "—") + "</div>" +
      '<div class="gp-row"><b>Code</b>' + esc(code) + (needsOk ? " · needs your OK" : " · open for drivers") + "</div>" +
      '<div class="gp-actions">' +
      (needsOk
        ? '<button type="button" class="gp-ok" id="gp-approve" data-ride-code="' + esc(code) + '">Approve</button>' +
          '<button type="button" class="gp-deny" id="gp-deny" data-ride-code="' + esc(code) + '">Deny</button>' +
          '<button type="button" class="gp-ghost" id="gp-cardok" data-ride-code="' + esc(code) + '">Mark card OK</button>'
        : "") +
      '<button type="button" class="gp-deny" id="gp-cancelride" data-ride-code="' + esc(code) + '">Cancel ride</button>' +
      '<button type="button" class="gp-ghost" id="gp-dismiss">' + (needsOk ? "Dismiss" : "OK") + "</button>" +
      "</div>");
    el.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.id) return;
      var c = t.getAttribute("data-ride-code") || code;
      if (t.id === "gp-dismiss") { silenceRide(code); hideGodRidePopup(key); return; }
      if (t.id === "gp-cancelride") {
        silenceRide(code);
        syncGodAlarm();
        ownerCancelTap(c, t, function (ok) { if (ok) hideGodRidePopup(key); });
        return;
      }
      if (t.id === "gp-approve") {
        t.disabled = true;
        silenceRide(code);
        syncGodAlarm();
        approveBooking(c).then(function () { hideGodRidePopup(key); refresh(); });
      } else if (t.id === "gp-deny") {
        silenceRide(code); /* the alarm stops as soon as he taps Deny, even before he confirms */
        syncGodAlarm();
        if (!window.confirm("Deny booking " + c + "?")) return;
        t.disabled = true;
        denyBooking(c).then(function () { hideGodRidePopup(key); refresh(); });
      } else if (t.id === "gp-cardok") {
        silenceRide(code);
        syncGodAlarm();
        if (!window.confirm("Mark the card OK for ride " + c + "?")) return;
        t.disabled = true;
        markCardOk(String(c).toUpperCase()).then(function () {
          state.actionNotice = "Card marked OK for " + c + ".";
          hideGodRidePopup(key);
          refresh();
        });
      }
    });
  }

  function acceptDriverName(ride) {
    var n = String((ride && ride.driverName) || "").trim();
    if (n) return n;
    var e = String((ride && ride.driverEmail) || "").trim();
    if (e) return e;
    return "a driver";
  }

  /* "Accepted by <driver name>" */
  function renderGodAcceptPopup(ride) {
    var code = String(ride.code);
    var el = godPopupShell("gp-accepted",
      '<p class="gp-title">Accepted by ' + esc(acceptDriverName(ride)) + "</p>" +
      '<div class="gp-row"><b>Rider</b>' + esc(displayName(ride.name, "Rider")) + "</div>" +
      '<div class="gp-row"><b>Pickup</b>' + esc(rideAddressText(ride, "pickup") || "—") + "</div>" +
      '<div class="gp-row"><b>When</b>' + esc(fmtWhen(ride.date, ride.time, ride)) + "</div>" +
      '<div class="gp-row"><b>Ride code</b>' + esc(code) + "</div>" +
      '<div class="gp-actions"><button type="button" class="gp-ok" id="gp-dismiss">OK</button></div>');
    el.addEventListener("click", function (ev) {
      if (ev.target && ev.target.id === "gp-dismiss") hideGodRidePopup("accept:" + code);
    });
  }

  /* Old names kept for test hooks. */
  function showGodPendingPopup(ride) { queueGodPopup("request", ride); }
  function showGodAcceptPopup(ride) { queueGodPopup("accept", ride); }

  /* v57: why v54-v56 showed nothing on the device:
     - the request pop-up only fired for status "pending_owner"; anything already "requested" (approved, or approved
       from the banner before the next 5 s poll) never popped, and
     - the accept pop-up only fired for codes this page had already tracked while open; it also replaced (hid) any
       pop-up already on screen.
     Now: any open request (pending_owner OR requested) pops "New ride request" once per page session; any
     accepted/started ride (on REQUESTS, or a tracked code that left REQUESTS) pops "Accepted by <driver>" once.
     Tracked codes are remembered for the browser session so a reload does not lose them. */
  var TRACK_KEY = "pcs-god-tracked-rides";
  function loadTracked() {
    try {
      var m = JSON.parse(window.sessionStorage.getItem(TRACK_KEY) || "{}");
      if (m && typeof m === "object") {
        Object.keys(m).forEach(function (c) { if (!state.trackedRideCodes[c]) state.trackedRideCodes[c] = m[c]; });
      }
    } catch (e) {}
  }
  function saveTracked() {
    try { window.sessionStorage.setItem(TRACK_KEY, JSON.stringify(state.trackedRideCodes)); } catch (e) {}
  }

  /* Each pop-up shows once per ride per device (24 h), so reopening God mode does not replay old ones;
     a NEW request or accept always pops. */
  var SHOWN_KEY = "pcs-god-shown-popups";
  var shownLoaded = false;
  function loadShown() {
    if (shownLoaded) return;
    shownLoaded = true;
    try {
      var m = JSON.parse(window.localStorage.getItem(SHOWN_KEY) || "{}") || {};
      var now = Date.now();
      Object.keys(m).forEach(function (k) {
        if (!(now - Number(m[k]) < 24 * 3600000)) return;
        var i = k.indexOf(":");
        var kind = k.slice(0, i), code = k.slice(i + 1);
        if (kind === "request") state.shownOpenPopup[code] = true; /* v64g: open rides only, never waiting ones */
        if (kind === "accept") state.shownAcceptPopup[code] = true;
      });
    } catch (e) {}
  }
  function rememberShown(kind, code) {
    try {
      var m = JSON.parse(window.localStorage.getItem(SHOWN_KEY) || "{}") || {};
      var now = Date.now();
      Object.keys(m).forEach(function (k) { if (!(now - Number(m[k]) < 24 * 3600000)) delete m[k]; });
      m[kind + ":" + code] = now;
      window.localStorage.setItem(SHOWN_KEY, JSON.stringify(m));
    } catch (e) {}
  }


  function listSafetyAlerts() {
    return fetch(safetyUrl()).then(function (res) {
      if (!res.ok) return {};
      return res.text().then(function (text) {
        if (!text || text === "null") return {};
        try { return JSON.parse(text) || {}; } catch (e) { return {}; }
      });
    }).catch(function () { return {}; });
  }

  function safetyAlertList() {
    var raw = state.safetyAlerts || {};
    var out = [];
    Object.keys(raw).forEach(function (id) {
      var a = raw[id];
      if (!a || typeof a !== "object") return;
      if (a.dismissed) return;
      a.id = a.id || id;
      out.push(a);
    });
    out.sort(function (a, b) { return (Number(b.at) || 0) - (Number(a.at) || 0); });
    return out;
  }

  function highSafetyAlerts() {
    return safetyAlertList().filter(function (a) { return a.priority === "high" || a.kind === "police_assist"; });
  }

  function softSafetyNotes() {
    return safetyAlertList().filter(function (a) { return a.kind === "not_ok_soft" || a.priority === "note"; });
  }

  function safetyBannerHtml() {
    var high = highSafetyAlerts();
    var soft = softSafetyNotes();
    if (!high.length && !soft.length) return "";
    var rows = high.map(function (a) {
      var role = String(a.role || (a.source === "sos_button" && !a.driverId ? "rider" : "driver")).toLowerCase();
      var roleLabel = role === "rider" ? "RIDER" : "DRIVER";
      var who = displayName(a.name, role === "rider" ? "Rider" : "Driver");
      var phone = a.phone ? esc(a.phone) : "no phone on file";
      var loc = (isCoord(a.lat) && isCoord(a.lng)) ? (+a.lat).toFixed(5) + ", " + (+a.lng).toFixed(5) : "no location";
      return (
        '<div class="banner-ride" style="margin:10px 0;padding:12px;border:2px solid #c0161b;border-radius:12px;background:#3a1010">' +
        '<p class="lede" style="margin:0 0 6px;color:#ffb4b4"><strong>POLICE ASSIST · ' + roleLabel + "</strong> · " + esc(who) + "</p>" +
        '<p class="fine" style="margin:0 0 6px">Phone ' + phone + " · " + esc(loc) +
        (a.rideCode ? " · ride " + esc(a.rideCode) : "") + "</p>" +
        '<p class="fine" style="margin:0 0 8px">' + esc(a.message || "Driver requested police assistance.") + "</p>" +
        '<div class="row-actions" style="display:flex;flex-wrap:wrap;gap:8px">' +
        (a.phone ? '<a class="btn btn-fire" href="tel:' + esc(String(a.phone).replace(/[^\d+]/g, "")) + '">Call driver</a>' : "") +
        '<a class="btn btn-ghost" href="tel:911">Call 911</a>' +
        (isCoord(a.lat) && isCoord(a.lng)
          ? '<a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' +
            encodeURIComponent((+a.lat) + "," + (+a.lng)) + '">Map pin</a>'
          : "") +
        '<button type="button" class="btn btn-ghost btn-dismiss-safety" data-safety-id="' + esc(a.id) + '">Dismiss</button>' +
        "</div></div>"
      );
    }).join("");
    var softRows = soft.slice(0, 3).map(function (a) {
      return (
        '<p class="fine" style="margin:6px 0;padding:8px;border:1px solid rgba(240,212,138,.35);border-radius:8px">' +
        "Note · " + esc(String(a.role || "driver").toUpperCase()) + " · " + esc(displayName(a.name, a.role === "rider" ? "Rider" : "Driver")) + ": " + esc(a.message || "Said not OK, declined police.") +
        ' <button type="button" class="btn btn-ghost btn-dismiss-safety" data-safety-id="' + esc(a.id) + '" style="padding:4px 8px;font-size:12px">Dismiss</button></p>'
      );
    }).join("");
    return (
      '<div class="card safety-alert" id="safety-alert" style="border:3px solid #c0161b;margin:0 0 12px;padding:12px;background:#2a0c0c">' +
      (high.length
        ? '<p class="tag" style="background:#c0161b;color:#fff">Driver needs help — police assist</p>' +
          '<p class="lede" style="color:#ffb4b4"><strong>' + esc(String(high.length)) + "</strong> high-priority alert" + (high.length > 1 ? "s" : "") +
          ". Call police / the driver if they cannot. This app does not auto-dial 911.</p>" + rows
        : "") +
      (softRows ? '<p class="tag">Driver wellbeing notes</p>' + softRows : "") +
      "</div>"
    );
  }

  function showSafetyPopup(alert) {
    if (!alert || !alert.id) return;
    if (document.getElementById("god-safety-popup")) return;
    ensureGodPopupStyle();
    var role = String(alert.role || "driver").toLowerCase();
    var who = displayName(alert.name, role === "rider" ? "Rider" : "Driver");
    var el = document.createElement("div");
    el.id = "god-safety-popup";
    el.setAttribute("style", "position:fixed;inset:0;z-index:13000;background:rgba(40,0,0,.94);display:flex;align-items:center;justify-content:center;padding:16px");
    var loc = (isCoord(alert.lat) && isCoord(alert.lng)) ? (+alert.lat).toFixed(6) + ", " + (+alert.lng).toFixed(6) : "—";
    el.innerHTML =
      '<div class="gp-card" style="border-color:#c0161b;max-width:520px;background:#1a0505;color:#fff;border:2px solid #c0161b;border-radius:18px;padding:20px;width:100%">' +
      '<p class="gp-title" style="color:#ff6b6b;font-size:28px;font-weight:800;text-align:center;margin:0 0 12px">Police assist · ' +
      esc(role === "rider" ? "RIDER" : "DRIVER") + "</p>" +
      '<div class="gp-row"><b style="color:#f0d48a">' + (role === "rider" ? "Rider" : "Driver") + "</b>" + esc(who) + "</div>" +
      '<div class="gp-row"><b style="color:#f0d48a">Phone</b>' + esc(alert.phone || "not on file") + "</div>" +
      '<div class="gp-row"><b style="color:#f0d48a">Location</b>' + esc(loc) + "</div>" +
      (alert.rideCode ? '<div class="gp-row"><b style="color:#f0d48a">Ride</b>' + esc(alert.rideCode) + "</div>" : "") +
      '<p style="color:#ffb4b4;margin:12px 0">' + esc(alert.message || "") + "</p>" +
      (alert.source === "sos_button" ? '<p style="color:#f0d48a;font-size:14px;text-align:center">Pressed from Alert / SOS button</p>' : "") +
      '<p style="color:#c9d3e0;font-size:14px">God mode cannot auto-dial 911. Call police or the driver yourself if needed.</p>' +
      '<div class="gp-actions" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">' +
      (alert.phone ? '<a class="gp-ok" style="flex:1;text-align:center;background:#2e9d4f;color:#fff;padding:16px;border-radius:12px;text-decoration:none;font-weight:800" href="tel:' + esc(String(alert.phone).replace(/[^\d+]/g, "")) + '">Call driver</a>' : "") +
      '<a class="gp-deny" style="flex:1;text-align:center;background:#c0161b;color:#fff;padding:16px;border-radius:12px;text-decoration:none;font-weight:800" href="tel:911">Call 911</a>' +
      (isCoord(alert.lat) && isCoord(alert.lng)
        ? '<a class="gp-ghost" style="flex:1;text-align:center;background:#345;color:#fff;padding:16px;border-radius:12px;text-decoration:none;font-weight:800" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' +
          encodeURIComponent((+alert.lat) + "," + (+alert.lng)) + '">Open map pin</a>'
        : "") +
      '<button type="button" class="gp-ghost" id="gs-dismiss" style="flex:1;background:#345;color:#fff;padding:16px;border-radius:12px;border:0;font-weight:800;font-size:18px">Dismiss</button>' +
      "</div></div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (ev) {
      if (ev.target && ev.target.id === "gs-dismiss") {
        dismissSafetyAlert(alert.id);
        if (el.parentNode) el.parentNode.removeChild(el);
        maybeShowNextSafetyPopup();
      }
    });
  }

  function dismissSafetyAlert(id) {
    if (!id) return Promise.resolve();
    if (state.safetyAlerts[id]) state.safetyAlerts[id].dismissed = true;
    state.shownSafetyPopup[id] = true;
    return fetch(safetyUrl(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissed: true, dismissedAt: Date.now() })
    }).catch(function () {});
  }

  function maybeShowNextSafetyPopup() {
    if (document.getElementById("god-safety-popup")) return;
    var high = highSafetyAlerts().filter(function (a) { return !state.shownSafetyPopup[a.id]; });
    if (!high.length) return;
    var a = high[0];
    state.shownSafetyPopup[a.id] = true;
    showSafetyPopup(a);
  }


  /* ===== v64g: ride-waiting ALARM + live ride stream + phone (push) alerts =====
     Why Matthew got no pop-up (Oct 7): God mode only checks for rides while it is on screen (iPhone/iPad stop a
     page's timers the moment another app or tab is in front), and v57 made God mode silent. Now:
       - A ride that needs Matthew's OK (status pending_owner) pops "Ride waiting for your OK" AND rings the driver
         app's approved bell chime (app/driver/ride-chime.mp3, same v57 sound engine + iOS unlock) on a loop until
         he taps Approve / Deny / Mark card OK / Dismiss, or the ride stops waiting (cancelled, approved elsewhere).
       - Live: a Firebase stream (EventSource on /rides/REQUESTS) refreshes the board within ~1 s of any change;
         the 5 s poll stays as the backup. Coming back to God mode (visibilitychange / focus / pageshow) re-checks
         at once and re-shows any waiting ride.
       - A waiting ride pops on every fresh open of God mode until it is handled (no 24 h "already shown" memory
         for waiting rides). Dismiss only silences it for this open + its alarm for 24 h.
       - Phone alerts (Web Push) for when God mode is closed: Home Screen app (iOS/iPadOS 16.4+) + "Phone alerts"
         button. The pcs-pay Worker sends "New ride request - needs your OK". */
  var GOD_CHIME_URL = (function () {
    try { if (GOD_SCRIPT_SRC) return new URL("../app/driver/ride-chime.mp3", GOD_SCRIPT_SRC).href; } catch (e) {}
    return "../app/driver/ride-chime.mp3";
  })();

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
        addBar("ride-sound-blocked", "\uD83D\uDD0A Tap here to hear the ride alarm", "#c0161b", "#fff", 12650, function () {
          unlock({ noPrime: true });
          if (!alerting) { test(); return; }
          playEl(false);
          startCtxLoop();
        });
      } else {
        removeEl("ride-sound-blocked");
      }
      if (ready()) removeEl("ride-sound-bar");
      else addBar("ride-sound-bar", "\uD83D\uDD14 Tap to turn on the God mode ride alarm", "#e3b341", "#0b1c33", 12600, test);
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


  var godAlarm = pcsAlertAudio({
    url: GOD_CHIME_URL,
    muted: function () { return false; },
    wantBar: function () { return state.screen === "board"; }
  });
  var godAlarmInstalled = false;
  function installGodAlarm() {
    if (godAlarmInstalled) return;
    godAlarmInstalled = true;
    try { godAlarm.install(); } catch (e) {}
  }

  /* Alarm silenced per ride (24 h) once Matthew taps a button on its pop-up. */
  var SILENCE_KEY = "pcs-god-alarm-silenced-v64";
  function silencedMap() {
    try {
      var m = JSON.parse(window.localStorage.getItem(SILENCE_KEY) || "{}") || {};
      var now = Date.now(), out = {};
      Object.keys(m).forEach(function (k) { if (now - Number(m[k]) < 24 * 3600000) out[k] = m[k]; });
      return out;
    } catch (e) { return {}; }
  }
  function silenceRide(code) {
    if (!code) return;
    try { var m = silencedMap(); m[String(code)] = Date.now(); window.localStorage.setItem(SILENCE_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function unsilenceRide(code) {
    try { var m = silencedMap(); if (m[code]) { delete m[code]; window.localStorage.setItem(SILENCE_KEY, JSON.stringify(m)); } } catch (e) {}
  }
  function freshRide(r) {
    var code = String((r && r.code) || "");
    var list = state.rides || [];
    for (var i = 0; i < list.length; i += 1) if (list[i] && String(list[i].code) === code) return list[i];
    return r;
  }
  function alarmWanted() {
    var sil = silencedMap();
    for (var i = 0; i < godPopupQueue.length; i += 1) {
      var it = godPopupQueue[i];
      if (it.kind === "request" && isPendingOwner(freshRide(it.ride)) && !sil[String(it.ride.code)]) return true;
    }
    return false;
  }
  function syncGodAlarm() {
    try {
      if (alarmWanted()) godAlarm.startAlert();
      else godAlarm.stopAlert();
    } catch (e) {}
  }

  /* Drop request pop-ups whose ride no longer waits (cancelled / approved / taken / gone from REQUESTS). */
  function pruneGodPopups(merged) {
    var byCode = {};
    (merged || []).forEach(function (r) { if (r && r.code) byCode[String(r.code)] = r; });
    var shownKey = (function () { var el = document.getElementById("god-ride-popup"); return el ? el.getAttribute("data-key") : ""; })();
    var removedShown = false;
    godPopupQueue = godPopupQueue.filter(function (it) {
      if (it.kind !== "request") return true;
      var code = String(it.ride.code);
      var r = byCode[code];
      var st = String((r && r.status) || "").toLowerCase();
      var keep = !!r && (isPendingOwner(r) || isOpenRequest(r)) && !isActiveTrip(r) && st !== "cancelled" && st !== "denied" && st !== "completed";
      /* a waiting pop-up whose ride was approved elsewhere (now "requested") is done too */
      if (keep && isPendingOwner(it.ride) && !isPendingOwner(r)) keep = false;
      if (!keep) {
        delete state.shownPendingPopup[code];
        if (!r || !isPendingOwner(r)) delete state.shownWaiting[code];
        if (it.key === shownKey) removedShown = true;
      } else {
        it.ride = r;
      }
      return keep;
    });
    if (removedShown) {
      var el = document.getElementById("god-ride-popup");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      showNextGodPopup();
    } else {
      var more = document.getElementById("gp-more");
      if (more) more.textContent = godPopupQueue.length > 1 ? (godPopupQueue.length - 1) + " more waiting" : "";
    }
    syncGodAlarm();
  }

  /* ---- live stream: Firebase REST EventSource on /rides/REQUESTS (public read, same as the poll) ---- */
  var rideStream = null;
  var streamKickTimer = null;
  var streamRetryTimer = null;
  var lastStreamEventAt = 0;
  function stopRideStream() {
    if (rideStream) { try { rideStream.close(); } catch (e) {} }
    rideStream = null;
    if (streamRetryTimer) { clearTimeout(streamRetryTimer); streamRetryTimer = null; }
  }
  function startRideStream() {
    stopRideStream();
    if (typeof window.EventSource !== "function" || state.screen !== "board") return;
    var es;
    try { es = new window.EventSource(openUrl()); } catch (e) { return; }
    rideStream = es;
    var kick = function () {
      if (rideStream !== es) return;
      lastStreamEventAt = Date.now();
      if (streamKickTimer) return;
      streamKickTimer = setTimeout(function () {
        streamKickTimer = null;
        if (state.screen === "board") refresh();
      }, 250);
    };
    es.addEventListener("put", kick);
    es.addEventListener("patch", kick);
    es.addEventListener("cancel", function () { if (rideStream === es) stopRideStream(); });
    es.onerror = function () {
      if (es.readyState !== 2) return; /* 0 = the browser is reconnecting by itself */
      if (rideStream === es) rideStream = null;
      if (streamRetryTimer) clearTimeout(streamRetryTimer);
      streamRetryTimer = setTimeout(function () {
        streamRetryTimer = null;
        if (state.screen === "board" && !rideStream && document.visibilityState !== "hidden") startRideStream();
      }, 10000);
    };
  }

  /* ---- Phone alerts (Web Push) ---- */
  var swReg = null;
  function isIOSDevice() {
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isStandaloneApp() {
    try { return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches; } catch (e) { return false; }
  }
  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function registerGodSW() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    if (swReg) return Promise.resolve(swReg);
    return navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(function (r) { swReg = r; return r; }, function () { return null; });
  }
  function b64uToBytes(s) {
    var b = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = window.atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sameBytes(a, b) {
    if (!a || !b) return false;
    a = new Uint8Array(a); b = new Uint8Array(b);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }
  function deviceLabel() {
    var ua = navigator.userAgent || "";
    if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/Android/.test(ua)) return "Android";
    return "Computer";
  }
  function workerJson(path, body) {
    return fetch(PAY_WORKER + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (!res.ok || !d || d.ok === false) {
            var e = new Error((d && d.error) || ("Server answered " + res.status));
            e.status = res.status;
            throw e;
          }
          return d;
        });
      });
  }
  function checkPushOn() {
    if (!pushSupported() || Notification.permission !== "granted" || !navigator.serviceWorker) { state.pushOn = false; paintPushBtn(); return Promise.resolve(false); }
    return navigator.serviceWorker.getRegistration("./").then(function (reg) {
      if (!reg) return null;
      swReg = reg;
      return reg.pushManager.getSubscription();
    }).then(function (sub) { state.pushOn = !!sub; paintPushBtn(); return !!sub; }, function () { state.pushOn = false; paintPushBtn(); return false; });
  }
  function paintPushBtn() {
    var b = document.getElementById("god-push-btn");
    if (b) b.textContent = state.pushOn ? "\uD83D\uDD14 Phone alerts: ON" : "\uD83D\uDD14 Turn on phone alerts";
  }
  /* Must start inside the tap: iOS only shows the Allow prompt from a user gesture. */
  function turnOnPush(pw) {
    var permP;
    try { permP = Notification.requestPermission(); } catch (e) { permP = null; }
    if (!permP || typeof permP.then !== "function") permP = Promise.resolve(Notification.permission);
    return permP.then(function (perm) {
      if (perm !== "granted") {
        throw new Error(perm === "denied"
          ? "Notifications are blocked for PCS God. Open Settings > Notifications > PCS God, turn on Allow Notifications, then try again."
          : "Notifications were not allowed. Tap the button again and choose Allow.");
      }
      return registerGodSW();
    }).then(function (reg) {
      if (!reg) throw new Error("This device could not start the alert service.");
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return workerJson("/push/key").catch(function (e) {
        if (e && (e.status === 404 || e.status === 503)) throw new Error("Phone alerts are not switched on at the server yet. The pop-up and alarm in God mode already work.");
        throw e;
      }).then(function (k) {
        if (!k.publicKey) throw new Error("Phone alerts are not set up on the server yet.");
        var key = b64uToBytes(k.publicKey);
        return reg.pushManager.getSubscription().then(function (old) {
          var oldKey = old && old.options && old.options.applicationServerKey;
          if (old && (!oldKey || sameBytes(oldKey, key))) return old;
          return (old ? old.unsubscribe().catch(function () {}) : Promise.resolve()).then(function () {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          });
        });
      });
    }).then(function (sub) {
      var j = sub.toJSON ? sub.toJSON() : sub;
      return workerJson("/push/subscribe", { subscription: { endpoint: j.endpoint, keys: j.keys || {} }, godPassword: pw, device: deviceLabel() });
    }).then(function (d) {
      state.pushOn = true;
      paintPushBtn();
      return d;
    });
  }
  function closePushPopup() {
    var el = document.getElementById("god-push-popup");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function ensurePushPopupStyle() {
    if (document.getElementById("god-push-style")) return;
    var s = document.createElement("style");
    s.id = "god-push-style";
    s.textContent =
      "#god-push-popup .gp-card{background:#0b1c33;color:#fff;border:2px solid #f0d48a;border-radius:18px;max-width:520px;width:100%;padding:20px;max-height:92vh;overflow:auto;box-sizing:border-box}" +
      "#god-push-popup .gp-title{font-size:26px;font-weight:800;color:#f0d48a;margin:0 0 12px;text-align:center}" +
      "#god-push-popup .gp-row{margin:10px 0;font-size:17px;line-height:1.35}" +
      "#god-push-popup .gp-row>b{display:block;color:#f0d48a;font-size:12px;letter-spacing:.08em;text-transform:uppercase}" +
      "#god-push-popup .gp-more{font-size:13px;color:#c9d3e0;text-align:center;margin-top:10px}" +
      "#god-push-popup .gp-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}" +
      "#god-push-popup .gp-actions button{flex:1;min-width:120px;font-size:18px;font-weight:800;padding:16px 10px;border-radius:12px;border:0;color:#fff;cursor:pointer}" +
      "#god-push-popup .gp-ok{background:#2e9d4f}#god-push-popup .gp-ghost{background:#345}" +
      "#god-push-popup input{box-sizing:border-box;color:#0b1c33;background:#fff}";
    document.head.appendChild(s);
  }
  function openPushPopup() {
    closePushPopup();
    ensurePushPopupStyle();
    var el = document.createElement("div");
    el.id = "god-push-popup";
    el.setAttribute("style", "position:fixed;inset:0;z-index:12200;background:rgba(5,14,28,.92);display:flex;align-items:center;justify-content:center;padding:16px");
    var steps;
    var canPush = pushSupported() && (!isIOSDevice() || isStandaloneApp());
    if (!canPush && isIOSDevice()) {
      steps =
        '<p class="gp-row">To get an alert when God mode is <b style="display:inline;color:#f0d48a;font-size:inherit;letter-spacing:0;text-transform:none">closed</b>, God mode has to be on your Home Screen:</p>' +
        '<ol style="font-size:17px;line-height:1.45;padding-left:22px">' +
        "<li>In Safari, tap the <b style=\"display:inline;color:#f0d48a;font-size:inherit;letter-spacing:0;text-transform:none\">Share</b> button (square with an arrow; on iPad it is at the top right).</li>" +
        "<li>Tap <b style=\"display:inline;color:#f0d48a;font-size:inherit;letter-spacing:0;text-transform:none\">Add to Home Screen</b>, then <b style=\"display:inline;color:#f0d48a;font-size:inherit;letter-spacing:0;text-transform:none\">Add</b>.</li>" +
        "<li>Open <b style=\"display:inline;color:#f0d48a;font-size:inherit;letter-spacing:0;text-transform:none\">PCS God</b> from the Home Screen and sign in.</li>" +
        "<li>Tap <b style=\"display:inline;color:#f0d48a;font-size:inherit;letter-spacing:0;text-transform:none\">Turn on phone alerts</b> again.</li></ol>" +
        '<p class="gp-more">Needs iOS / iPadOS 16.4 or newer.</p>' +
        '<div class="gp-actions"><button type="button" class="gp-ghost" id="gpp-close">OK</button></div>';
    } else if (!canPush) {
      steps = '<p class="gp-row">This browser cannot receive phone alerts. Use God mode from the Home Screen on your iPhone or iPad.</p>' +
        '<div class="gp-actions"><button type="button" class="gp-ghost" id="gpp-close">OK</button></div>';
    } else {
      steps =
        '<p class="gp-row">Get "New ride request - needs your OK" on this ' + esc(deviceLabel()) + " even when God mode is closed.</p>" +
        '<label class="gp-row" style="display:block"><b>God password</b>' +
        '<input id="gpp-password" type="password" autocomplete="current-password" style="width:100%;font-size:18px;padding:12px;border-radius:10px;border:1px solid #567;margin-top:6px"></label>' +
        '<p class="gp-row" id="gpp-msg" style="min-height:1.4em;color:#f0d48a"></p>' +
        '<div class="gp-actions"><button type="button" class="gp-ok" id="gpp-on">Turn on alerts</button>' +
        '<button type="button" class="gp-ghost" id="gpp-close">Close</button></div>' +
        '<p class="gp-more">Then tap Allow. A test alert arrives right away. Sound: Settings &gt; Notifications &gt; PCS God &gt; Sounds on.</p>';
    }
    el.innerHTML = '<div class="gp-card" role="dialog" aria-modal="true"><p class="gp-title">Phone alerts</p>' + steps + "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.id) return;
      if (t.id === "gpp-close") { closePushPopup(); return; }
      if (t.id === "gpp-on") {
        var pwEl = document.getElementById("gpp-password");
        var msg = document.getElementById("gpp-msg");
        var pw = pwEl ? pwEl.value : "";
        if (!pw) { if (msg) msg.textContent = "Type your God password first."; return; }
        t.disabled = true;
        if (msg) msg.textContent = "Turning on…";
        turnOnPush(pw).then(function (d) {
          if (pwEl) pwEl.value = "";
          if (msg) msg.textContent = "Phone alerts are ON for this " + deviceLabel() + "." + (d && d.testSent ? " A test alert is on its way." : "");
          t.textContent = "Done";
          t.disabled = false;
          t.id = "gpp-close";
        }).catch(function (err) {
          if (pwEl) pwEl.value = "";
          t.disabled = false;
          if (msg) msg.textContent = (err && err.message) || "Could not turn on alerts.";
        });
      }
    });
  }
  /* Notification tap (service worker) -> open that ride's pop-up. */
  function openRideFromAlert(code) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!code) return;
    state.forceRideCode = code;
    delete state.shownPendingPopup[code];
    delete state.shownWaiting[code];
    if (state.screen === "board") startPoll();
  }
  (function readRideParam() {
    try {
      var c = new URLSearchParams(window.location.search).get("ride");
      if (c) state.forceRideCode = String(c).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    } catch (e) {}
  })();
  if ("serviceWorker" in navigator) {
    try {
      navigator.serviceWorker.addEventListener("message", function (ev) {
        var d = ev && ev.data;
        if (!d || typeof d !== "object") return;
        if (d.type === "pcs-open-ride") openRideFromAlert(d.code);
        else if (d.type === "pcs-push" && state.screen === "board") startPoll();
      });
    } catch (e) {}
  }
  /* ===== end v64g ===== */

  function maybeShowGodPopups(merged) {
    var list = merged || [];
    var openCodes = {};
    loadShown();
    loadTracked();
    list.forEach(function (r) {
      try {
        if (!r || !r.code) return;
        var code = String(r.code);
        openCodes[code] = true;
        var st = String(r.status || "requested").toLowerCase();
        if (st === "cancelled" || st === "denied" || st === "completed") return;
        state.trackedRideCodes[code] = {
          name: r.name || "",
          date: r.date || "",
          time: r.time || "",
          asap: r.asap || false,
          pickup: rideAddressText(r, "pickup"),
          drop: rideAddressText(r, "drop"),
          at: Date.now()
        };
        /* v64g: a ride waiting for the OK pops on every open of God mode (and after it comes back to waiting,
           e.g. a driver declined); an already-approved open request pops once per device like before. */
        var waiting = isPendingOwner(r) && !isActiveTrip(r);
        if (!waiting && state.wasPending[code]) { delete state.shownWaiting[code]; unsilenceRide(code); }
        state.wasPending[code] = waiting;
        if (state.forceRideCode && state.forceRideCode === code) {
          state.forceRideCode = "";
          delete state.shownWaiting[code];
          delete state.shownPendingPopup[code];
          unsilenceRide(code);
        }
        if (waiting && !state.shownWaiting[code]) {
          state.shownWaiting[code] = true;
          state.shownPendingPopup[code] = true;
          /* an "open for drivers" pop-up for the same ride is replaced by the waiting one (Approve/Deny) */
          for (var qi = 0; qi < godPopupQueue.length; qi += 1) {
            if (godPopupQueue[qi].key === "request:" + code) { hideGodRidePopup("request:" + code); break; }
          }
          queueGodPopup("request", r);
        } else if (!waiting && isOpenRequest(r) && !isActiveTrip(r) && !state.shownPendingPopup[code] && !state.shownOpenPopup[code]) {
          state.shownPendingPopup[code] = true;
          state.shownOpenPopup[code] = true;
          rememberShown("request", code);
          queueGodPopup("request", r);
        }
        if (isActiveTrip(r) && !state.shownAcceptPopup[code]) {
          state.shownAcceptPopup[code] = true;
          rememberShown("accept", code);
          queueGodPopup("accept", r);
        }
      } catch (e) {}
    });
    saveTracked();
    Object.keys(state.trackedRideCodes).forEach(function (code) {
      if (openCodes[code] || state.shownAcceptPopup[code]) return;
      var t = state.trackedRideCodes[code] || {};
      if (t.at && Date.now() - t.at > 12 * 3600000) { delete state.trackedRideCodes[code]; saveTracked(); return; }
      getRide(code).then(function (ride) {
        if (!ride) return;
        if (!ride.code) ride.code = code;
        var st = String(ride.status || "").toLowerCase();
        if ((st === "accepted" || st === "started") && !state.shownAcceptPopup[code]) {
          state.shownAcceptPopup[code] = true;
          rememberShown("accept", code);
          queueGodPopup("accept", ride);
        }
        if (st === "accepted" || st === "started" || st === "completed" || st === "cancelled" || st === "denied") {
          delete state.trackedRideCodes[code];
          saveTracked();
        }
      });
    });
  }

  function listOpenRides() {
    return fetch(openUrl()).then(function (res) {
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
          if (!row.code) row.code = code;
          out.push(row);
        });
        return out;
      });
    });
  }

  function getRide(code) {
    if (!code) return Promise.resolve(null);
    return fetch(rideUrl(code)).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.text().then(function (text) {
        if (!text || text === "null") return null;
        try { return JSON.parse(text); } catch (e) { return null; }
      });
    }).catch(function () { return null; });
  }

  function enrichPairedRides(openRows) {
    /* Open hub only holds requested pickups. Accepted/started trips live under /rides/{code}.
       We only fetch codes we already see on REQUESTS or that drivers might reference — no inventing.
       For now, treat open rows with status accepted/started (if any) as active, and also
       look for status on the open summary itself. Full trip enrichment needs more data later. */
    var codes = [];
    openRows.forEach(function (r) {
      if (r && r.code) codes.push(r.code);
    });
    if (!codes.length) return Promise.resolve(openRows);

    return Promise.all(codes.map(function (code) {
      return getRide(code).then(function (full) {
        if (!full || typeof full !== "object") return null;
        if (!full.code) full.code = code;
        return full;
      });
    })).then(function (fulls) {
      var byCode = {};
      fulls.forEach(function (f) {
        if (f && f.code) byCode[f.code] = f;
      });
      return openRows.map(function (row) {
        var full = byCode[row.code];
        if (!full) return row;
        var merged = Object.assign({}, row, full);
        if (!merged.code) merged.code = row.code;
        return merged;
      });
    });
  }

  function isActiveTrip(ride) {
    var st = String((ride && ride.status) || "requested").toLowerCase();
    return st === "accepted" || st === "started";
  }

  function isOpenRequest(ride) {
    var st = String((ride && ride.status) || "requested").toLowerCase();
    return st === "requested" || st === "waiting" || st === "pending_owner" || st === "pending-owner" || !st;
  }

  function driverOnTripId(ride) {
    if (!ride) return "";
    if (ride.driverId) return String(ride.driverId);
    var email = String(ride.driverEmail || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return email.slice(0, 48);
  }

  function matchDriverToRide(driver, rides) {
    if (!driver) return null;
    var id = String(driver.id || "");
    var name = String(driver.name || "").trim().toLowerCase();
    for (var i = 0; i < rides.length; i += 1) {
      var ride = rides[i];
      if (!isActiveTrip(ride)) continue;
      var rid = driverOnTripId(ride);
      if (rid && rid === id) return ride;
      var dName = String(ride.driverName || "").trim().toLowerCase();
      if (name && dName && name === dName) return ride;
    }
    return null;
  }

  function revenueForDriver(driver, rides) {
    /* Commission of fare before tax when known. Never invent a fare. v57: fareSub may include confirmed wait ($0.40/min). */
    var ride = matchDriverToRide(driver, rides);
    if (!ride) return { label: "No trip revenue recorded yet", amount: null };
    var fare = ride.fareSub != null ? ride.fareSub : ride.fareBeforeTax;
    if (fare === null || fare === undefined || fare === "" || !isFinite(+fare)) {
      var totalOnly = fmtMoney(ride.estimatedTotal || ride.fareTotal);
      if (totalOnly) {
        return { label: totalOnly + " trip total (no before-tax fare yet)", amount: null };
      }
      return { label: "No trip revenue recorded yet", amount: null };
    }
    var pct = commissionPctFor(driver.id);
    var share = Number(fare) * (pct / 100);
    var money = fmtMoney(share);
    if (!money) return { label: "No trip revenue recorded yet", amount: null };
    var waitNote = "";
    var wc = Number(ride.waitCents) || 0;
    if (wc > 0) waitNote = " · wait " + fmtCents(wc);
    return {
      label: money + " · " + pct + "% of " + fmtMoney(fare) + " before tax" + waitNote,
      amount: money,
      pct: pct
    };
  }

  function refresh() {
    if (state.screen !== "board") return;
    state.loading = true;

    var rosterP = listRoster().then(function (rows) {
      state.rosterError = "";
      state.roster = rows || {};
    }).catch(function (err) {
      /* Keep prior roster in memory if a poll fails; mark error for UI. */
      state.rosterError = err && err.denied ? "denied" : "error";
    });

    var safetyP = listSafetyAlerts().then(function (rows) {
      state.safetyError = "";
      state.safetyAlerts = rows || {};
      maybeShowNextSafetyPopup();
    }).catch(function () { state.safetyError = "error"; });

    var ridesP = listOpenRides().then(function (rows) {
      state.ridesError = "";
      return enrichPairedRides(rows).then(function (merged) {
        state.rides = merged;
        var pending = (merged || []).filter(isPendingOwner);
        pending.forEach(function (r) {
          var code = String((r && r.code) || "");
          if (!code || state.pendingAlertCodes[code]) return;
          state.pendingAlertCodes[code] = true;
          requestDesktopNotify(
            "PCS: booking needs approval",
            (r.name || "Rider") + " · " + fmtWhen(r.date, r.time, r)
          );
        });
        if (pending.length) {
          state.pendingBanner = pending.length + " booking(s) waiting for your OK";
        }
        try { pruneGodPopups(merged || []); } catch (pruneErr) {}
        try { maybeShowGodPopups(merged || []); } catch (popupErr) {}
        syncGodAlarm();
      });
    }).catch(function (err) {
      state.rides = [];
      state.ridesError = err && err.denied ? "denied" : "error";
    });

    /* Presence after roster so fired drivers are filtered with current active flags. */
    var driversP = rosterP.then(function () {
      return listOnlineDrivers().then(function (rows) {
        state.driversError = "";
        state.drivers = (rows || []).filter(function (d) {
          return d && isRosterActive(d.id);
        });
      }).catch(function (err) {
        state.drivers = [];
        state.driversError = err && err.denied ? "denied" : "error";
      });
    });

    var milesP = driversP.then(function () {
      var ids = {};
      Object.keys(state.roster || {}).forEach(function (id) { ids[id] = true; });
      (state.drivers || []).forEach(function (d) { if (d && d.id) ids[d.id] = true; });
      var list = Object.keys(ids);
      return Promise.all(list.map(function (id) {
        return listDriverMiles(id).then(function (days) {
          return { id: id, days: days };
        }).catch(function () {
          return { id: id, days: state.miles[id] || {} };
        });
      })).then(function (rows) {
        var next = {};
        rows.forEach(function (row) {
          if (row && row.id) next[row.id] = row.days || {};
        });
        state.miles = next;
        state.milesError = "";
      }).catch(function (err) {
        state.milesError = err && err.denied ? "denied" : "error";
      });
    });

    var historyP = driversP.then(function () {
      var ids = {};
      Object.keys(state.roster || {}).forEach(function (id) { ids[id] = true; });
      (state.drivers || []).forEach(function (d) { if (d && d.id) ids[d.id] = true; });
      var list = Object.keys(ids);
      return Promise.all(list.map(function (id) {
        return listDriverHistory(id).then(function (rows) {
          return { id: id, rows: rows };
        }).catch(function () {
          return { id: id, rows: state.history[id] || {} };
        });
      })).then(function (rows) {
        var next = {};
        rows.forEach(function (row) {
          if (row && row.id) next[row.id] = row.rows || {};
        });
        state.history = next;
        state.historyError = "";
      }).catch(function (err) {
        state.historyError = err && err.denied ? "denied" : "error";
      });
    });

    var calendarP = listCalendarRides().then(function (rows) {
      state.calendar = rows || [];
      state.calendarError = "";
      state.calendarUpdated = new Date().toISOString();
    }).catch(function (err) {
      state.calendarError = err && err.denied ? "denied" : "error";
    });

    var paymentsP = listPayments().then(function (rows) {
      state.paymentsError = "";
      state.payments = rows || {};
      return refreshPayRides();
    }).catch(function (err) {
      state.paymentsError = err && err.denied ? "denied" : "error";
    });

    Promise.all([rosterP, driversP, ridesP, milesP, historyP, calendarP, safetyP, paymentsP]).then(function () {
      state.loading = false;
      state.lastRefreshAt = Date.now();
      renderBoardLists();
      syncMap();
      var pill = document.getElementById("refresh-pill");
      if (pill) pill.textContent = statusPillText();
      var notice = document.getElementById("drivers-action-notice");
      if (notice && state.actionNotice) notice.textContent = state.actionNotice;
    });
  }

  function statusPillText() {
    if (state.loading) return "Refreshing…";
    if (state.lastRefreshAt) return "Live · " + fmtClock(state.lastRefreshAt);
    return "Live";
  }

  function stopPoll() {
    stopRideStream();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll() {
    stopPoll();
    refresh();
    pollTimer = setInterval(refresh, POLL_MS);
    startRideStream(); /* v64g: live changes within ~1 s */
  }

  function tearMap() {
    if (map) {
      try { map.remove(); } catch (e) {}
    }
    map = null;
    markerLayer = null;
    routeLayer = null;
    mapReady = false;
    driverMarkers = {};
  }

  function ensureMap() {
    if (!window.L) return false;
    var el = document.getElementById("god-map");
    if (!el) return false;
    if (map && el._leaflet_id) return true;
    try {
      tearMap();
      map = window.L.map(el, {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: true
      });
      var layer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);
      var tileErrors = 0;
      var fallback = false;
      layer.on("tileerror", function () {
        tileErrors += 1;
        if (fallback || tileErrors < 4 || !map) return;
        fallback = true;
        window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
          maxZoom: 19,
          subdomains: "abcd",
          attribution: "&copy; OpenStreetMap &copy; CARTO"
        }).addTo(map);
      });
      markerLayer = window.L.layerGroup().addTo(map);
      routeLayer = window.L.layerGroup().addTo(map);
      map.setView([BOARD_CENTER.lat, BOARD_CENTER.lng], 11);
      mapReady = true;
      setTimeout(function () { if (map) map.invalidateSize(); }, 80);
      setTimeout(function () { if (map) map.invalidateSize(); }, 400);
      return true;
    } catch (err) {
      tearMap();
      return false;
    }
  }

  function markerIcon(kind, label, focused) {
    var svg = kind === "car" ? CAR_SVG : kind === "paired" ? PAIRED_SVG : PERSON_SVG;
    var cls = "god-marker" + (kind === "paired" ? " paired" : "") + (focused ? " focused" : "");
    return window.L.divIcon({
      className: "god-pin",
      html:
        '<div class="' + cls + '">' +
          '<div class="face">' + svg + "</div>" +
          '<div class="name-tag">' + esc(label) + "</div>" +
        "</div>",
      iconSize: kind === "paired" ? [140, 70] : [110, 64],
      iconAnchor: kind === "paired" ? [70, 58] : [55, 54]
    });
  }

  /* Where a driver is on the map right now (presence lat/lng, else on-trip ride driverLat/Lng). */
  function focusTarget(driverId) {
    if (!driverId) return null;
    var drivers = state.drivers || [];
    var d = null;
    for (var i = 0; i < drivers.length; i += 1) {
      if (drivers[i] && drivers[i].id === driverId) { d = drivers[i]; break; }
    }
    if (!d) return null;
    if (isCoord(d.lat) && isCoord(d.lng)) {
      return { latlng: [+d.lat, +d.lng], name: displayName(d.name, "Driver") };
    }
    var ride = matchDriverToRide(d, state.rides || []);
    if (ride && isCoord(ride.driverLat) && isCoord(ride.driverLng)) {
      return { latlng: [+ride.driverLat, +ride.driverLng], name: displayName(d.name, "Driver") };
    }
    return null;
  }

  function driverNameById(driverId) {
    var rows = knownDriverRows();
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].id === driverId) return displayName(rows[i].name, "Driver");
    }
    return "That driver";
  }

  function bindMarkerFocus(marker, driverId) {
    marker.on("click", function () { focusDriver(driverId); });
  }

  function setFocusBar() {
    var bar = document.getElementById("map-focus-bar");
    if (!bar) return;
    var label = document.getElementById("map-focus-label");
    if (state.focusDriverId) {
      bar.hidden = false;
      if (label) label.textContent = "Following " + driverNameById(state.focusDriverId);
    } else if (state.focusNote) {
      bar.hidden = false;
      if (label) label.textContent = state.focusNote;
    } else {
      bar.hidden = true;
    }
    var allBtn = document.getElementById("map-show-all");
    if (allBtn) allBtn.hidden = !state.focusDriverId;
  }

  function flashFocusNote(msg) {
    state.focusNote = msg;
    setFocusBar();
    setTimeout(function () {
      if (state.focusNote === msg) {
        state.focusNote = "";
        setFocusBar();
      }
    }, 4500);
  }

  function scrollMapIntoViewIfStacked() {
    var pane = document.querySelector(".map-pane");
    if (!pane || !pane.getBoundingClientRect) return;
    var r = pane.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    /* Only scroll when the map is essentially off-screen (stacked phone layout scrolled down/up). */
    if (r.bottom < 120 || r.top > vh - 120) {
      try { pane.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { pane.scrollIntoView(); }
    }
  }

  /* Tap a driver name / Locate → pan + zoom the map to them and keep following on refresh. */
  function focusDriver(driverId) {
    if (!driverId) return;
    var target = focusTarget(driverId);
    if (!target) {
      state.focusDriverId = "";
      focusFlyPending = false;
      flashFocusNote(driverNameById(driverId) + " is not sharing a location right now (offline or GPS off).");
      return;
    }
    state.focusDriverId = driverId;
    state.focusNote = "";
    focusFlyPending = true;
    setFocusBar();
    scrollMapIntoViewIfStacked();
    if (ensureMap()) {
      setTimeout(function () { if (map) map.invalidateSize(); }, 50);
      syncMap();
    }
    renderBoardLists();
  }

  function clearFocus() {
    state.focusDriverId = "";
    state.focusNote = "";
    focusFlyPending = false;
    setFocusBar();
    syncMap();
    renderBoardLists();
  }

  function syncMap() {
    if (!ensureMap()) return;
    markerLayer.clearLayers();
    routeLayer.clearLayers();
    driverMarkers = {};

    var bounds = [];
    var drivers = state.drivers || [];
    var rides = state.rides || [];
    var pairedDriverIds = {};

    /* Active trips: combined marker + highlighted route. */
    rides.forEach(function (ride) {
      if (!isActiveTrip(ride)) return;
      var driver = null;
      for (var i = 0; i < drivers.length; i += 1) {
        if (matchDriverToRide(drivers[i], [ride])) {
          driver = drivers[i];
          break;
        }
      }
      if (driver) pairedDriverIds[driver.id] = true;

      var dName = shortName((driver && driver.name) || ride.driverName, "Driver");
      var rName = shortName(ride.name, "Rider");
      var plateBit = (driver && driver.carPlate) || ride.driverCarPlate || "";
      var label = dName + (plateBit ? " (" + String(plateBit) + ")" : "") + " + " + rName;

      var lat = null;
      var lng = null;
      if (driver && isCoord(driver.lat) && isCoord(driver.lng)) {
        lat = +driver.lat;
        lng = +driver.lng;
      } else if (isCoord(ride.driverLat) && isCoord(ride.driverLng)) {
        lat = +ride.driverLat;
        lng = +ride.driverLng;
      } else if (isCoord(ride.pickupLat) && isCoord(ride.pickupLng)) {
        lat = +ride.pickupLat;
        lng = +ride.pickupLng;
      }
      if (lat != null) {
        var pairedFocused = !!(driver && state.focusDriverId && driver.id === state.focusDriverId);
        var pairedBg = isBackgroundDriver(driver);
        var pairedMarker = window.L.marker([lat, lng], {
          icon: markerIcon("paired", label + (pairedBg ? " · app in background, seen " + agoText(driver.lastSeenAt) : ""), pairedFocused),
          zIndexOffset: pairedFocused ? 1000 : 700,
          opacity: pairedBg ? 0.5 : 1
        }).addTo(markerLayer);
        if (driver && driver.id) {
          driverMarkers[driver.id] = pairedMarker;
          bindMarkerFocus(pairedMarker, driver.id);
        }
        bounds.push([lat, lng]);
      }

      if (isCoord(ride.pickupLat) && isCoord(ride.pickupLng) && isCoord(ride.dropLat) && isCoord(ride.dropLng)) {
        var pts = [[+ride.pickupLat, +ride.pickupLng], [+ride.dropLat, +ride.dropLng]];
        if (lat != null) pts.unshift([lat, lng]);
        window.L.polyline(pts, {
          color: "#d4b15a",
          weight: 5,
          opacity: 0.95
        }).addTo(routeLayer);
        pts.forEach(function (p) { bounds.push(p); });
      }
    });

    /* Free online drivers (no rider): car + name. */
    drivers.forEach(function (driver) {
      if (pairedDriverIds[driver.id]) return;
      if (matchDriverToRide(driver, rides)) return;
      if (!isCoord(driver.lat) || !isCoord(driver.lng)) return;
      var here = [+driver.lat, +driver.lng];
      var freeLabel = shortName(driver.name, "Driver");
      var freeCar = carLabel(driver);
      if (freeCar) freeLabel += " · " + freeCar;
      if (driver.carPlate) freeLabel += " · " + String(driver.carPlate);
      var freeFocused = !!(state.focusDriverId && driver.id === state.focusDriverId);
      var freeBg = isBackgroundDriver(driver);
      if (freeBg) freeLabel += " · app in background, seen " + agoText(driver.lastSeenAt);
      var freeMarker = window.L.marker(here, {
        icon: markerIcon("car", freeLabel, freeFocused),
        zIndexOffset: freeFocused ? 1000 : (freeBg ? 300 : 500),
        opacity: freeBg ? 0.5 : 1
      }).addTo(markerLayer);
      if (driver.id) {
        driverMarkers[driver.id] = freeMarker;
        bindMarkerFocus(freeMarker, driver.id);
      }
      bounds.push(here);
    });

    /* Requesting / waiting riders: person + name. */
    rides.forEach(function (ride) {
      if (!isOpenRequest(ride)) return;
      if (!isCoord(ride.pickupLat) || !isCoord(ride.pickupLng)) return;
      var here = [+ride.pickupLat, +ride.pickupLng];
      window.L.marker(here, {
        icon: markerIcon("person", shortName(ride.name, "Rider")),
        zIndexOffset: 400
      }).addTo(markerLayer);
      bounds.push(here);
    });

    var focused = state.focusDriverId ? focusTarget(state.focusDriverId) : null;
    if (state.focusDriverId && focused && focused.latlng) {
      /* Follow the tapped driver; do not snap back to the whole-board view on each 5s poll. */
      var z = Math.max(map.getZoom() || 0, FOCUS_ZOOM);
      if (focusFlyPending && map.flyTo) {
        focusFlyPending = false;
        map.flyTo(focused.latlng, z, { duration: 0.8 });
      } else {
        map.setView(focused.latlng, map.getZoom() >= 12 ? map.getZoom() : z, { animate: false });
      }
    } else if (state.focusDriverId && !focused) {
      /* Driver went offline or stopped sharing — fall back to the full board. */
      state.focusDriverId = "";
      focusFlyPending = false;
      flashFocusNote("That driver is no longer sharing a location. Showing everyone.");
      if (bounds.length >= 2) {
        map.fitBounds(window.L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 13 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 12);
      } else {
        map.setView([BOARD_CENTER.lat, BOARD_CENTER.lng], 11);
      }
    } else if (bounds.length >= 2) {
      map.fitBounds(window.L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 13 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 12);
    } else {
      map.setView([BOARD_CENTER.lat, BOARD_CENTER.lng], 11);
    }
    setTimeout(function () { if (map) map.invalidateSize(); }, 60);
  }

  function knownDriverRows() {
    /* Merge roster (hired / fired) with currently online presence. */
    var byId = {};
    var roster = state.roster || {};
    Object.keys(roster).forEach(function (id) {
      var row = roster[id];
      if (!row) return;
      byId[id] = {
        id: id,
        name: row.name || id,
        phone: row.phone || "",
        email: row.email || "",
        online: false,
        at: row.updatedAt || row.hiredAt || null,
        lat: null,
        lng: null,
        fromRoster: true,
        active: row.active !== false,
        approvalStatus: row.approvalStatus || (row.active === false ? "fired" : "approved"),
        commissionPct: row.commissionPct,
        carYear: row.carYear || "",
        carMake: row.carMake || "",
        carModel: row.carModel || "",
        carPlate: row.carPlate || "",
        carSeats: row.carSeats || ""
      };
    });
    (state.drivers || []).forEach(function (d) {
      if (!d || !d.id) return;
      if (!isRosterActive(d.id) && byId[d.id] && byId[d.id].active === false) return;
      var prev = byId[d.id] || {
        id: d.id,
        name: d.name || d.id,
        phone: d.phone || "",
        email: d.email || "",
        fromRoster: false,
        active: true,
        commissionPct: null,
        carYear: "",
        carMake: "",
        carModel: "",
        carPlate: "",
        carSeats: ""
      };
      prev.online = true;
      prev.at = d.at || prev.at;
      prev.lat = d.lat;
      prev.lng = d.lng;
      if (d.name) prev.name = d.name;
      if (d.phone) prev.phone = d.phone;
      if (d.carYear) prev.carYear = d.carYear;
      if (d.carMake) prev.carMake = d.carMake;
      if (d.carModel) prev.carModel = d.carModel;
      if (d.carPlate) prev.carPlate = d.carPlate;
      if (d.carSeats) prev.carSeats = d.carSeats;
      if (d.gpsMilesToday != null) prev.gpsMilesToday = d.gpsMilesToday;
      if (d.startOdometer != null) prev.startOdometer = d.startOdometer;
      if (d.speedMph != null) prev.speedMph = d.speedMph;
      if (d.speedAt != null) prev.speedAt = d.speedAt;
      prev.presence = d.presence || "live"; /* v64g */
      prev.lastSeenAt = d.lastSeenAt || d.at || 0;
      if (!prev.active && prev.fromRoster) {
        /* Fired: do not treat as online in the panel. */
        prev.online = false;
      }
      byId[d.id] = prev;
    });
    return Object.keys(byId).map(function (id) { return byId[id]; }).sort(function (a, b) {
      var aa = approvalOf(a);
      var ba = approvalOf(b);
      if (aa === "pending" && ba !== "pending") return -1;
      if (ba === "pending" && aa !== "pending") return 1;
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  /* v64g: per-shift odometer vs app miles (driver v64 writes DRVRMLES/{id}/{day}/shifts/{shiftStartedAt}). */
  function milesNum(v) { return v != null && v !== "" && isFinite(Number(v)) ? Number(v) : null; }
  function shiftLinesHtml(row) {
    var sh = row && row.shifts;
    if (!sh || typeof sh !== "object") return "";
    var list = Object.keys(sh).map(function (k) { return sh[k]; }).filter(function (x) { return x && typeof x === "object"; });
    if (!list.length) return "";
    list.sort(function (a, b) { return (Number(a.shiftStartedAt) || 0) - (Number(b.shiftStartedAt) || 0); });
    return '<ul class="shift-lines" style="margin:4px 0 6px 14px;padding:0">' + list.map(function (x) {
      var so = milesNum(x.startOdo), eo = milesNum(x.endOdo);
      var odoMi = milesNum(x.odoMiles);
      if (odoMi == null && so != null && eo != null) odoMi = eo - so;
      var tracked = milesNum(x.trackedMiles), filled = milesNum(x.filledInMiles);
      var appMi = (tracked || 0) + (filled || 0);
      var when = (Number(x.shiftStartedAt) ? fmtClock(x.shiftStartedAt) : "?") + "–" + (Number(x.shiftEndedAt) ? fmtClock(x.shiftEndedAt) : "open");
      var gap = odoMi != null && (tracked != null || filled != null) ? odoMi - appMi : null;
      var warn = !!x.odoWarned || (gap != null && Math.abs(gap) > Math.max(5, odoMi * 0.15));
      return '<li style="list-style:disc;' + (warn ? "color:#ffc96b" : "") + '">Shift ' + esc(when) +
        " · start odo " + esc(so != null ? String(so) : "—") + " · end odo " + esc(eo != null ? String(eo) : "—") +
        " · odometer " + esc(odoMi != null ? odoMi.toFixed(1) + " mi" : "—") +
        " vs app " + esc(tracked != null ? tracked.toFixed(1) : "—") + " mi tracked" +
        (filled ? " + " + esc(filled.toFixed(1)) + " filled in" : "") +
        (gap != null ? " (" + (gap >= 0 ? "+" : "") + esc(gap.toFixed(1)) + " mi " + (gap >= 0 ? "more on odometer" : "more in app") + ")" : "") +
        (warn ? " ⚠" : "") + "</li>";
    }).join("") + "</ul>";
  }

  function driverSpeedLabel(d) {
    if (!d || !d.online) return "—";
    if (isBackgroundDriver(d)) return "— (app in background)";
    if (d.speedMph == null) return "—";
    if (d.speedAt && (Date.now() - Number(d.speedAt) > 20000)) return "—";
    return Math.round(Number(d.speedMph) || 0) + " mph";
  }

  function hireBlockHtml() {
    return (
      '<div class="hire-tuck" id="hire-tuck">' +
        '<button type="button" class="tuck-link" id="toggle-hire">' +
          (state.showHireForm ? "− Hide hire form" : "+ Hire a driver") +
        "</button>" +
        (state.showHireForm ? hireFormHtml() : "") +
      "</div>"
    );
  }

  function hireFormHtml() {
    return (
      '<form class="hire-form" id="hire-form" autocomplete="off">' +
        "<h3>Hire a driver</h3>" +
        '<div class="hire-grid">' +
          '<div class="field">' +
            '<label for="hire-name">Name</label>' +
            '<input id="hire-name" name="name" type="text" required value="' + esc(state.hireName) + '">' +
          "</div>" +
          '<div class="field">' +
            '<label for="hire-phone">Phone</label>' +
            '<input id="hire-phone" name="phone" type="tel" value="' + esc(state.hirePhone) + '">' +
          "</div>" +
          '<div class="field">' +
            '<label for="hire-email">Email</label>' +
            '<input id="hire-email" name="email" type="email" required value="' + esc(state.hireEmail) + '">' +
          "</div>" +
          '<div class="field">' +
            '<label for="hire-pct">Commission %</label>' +
            '<input id="hire-pct" name="pct" type="number" min="0" max="100" step="1" required value="' + esc(state.hirePct) + '">' +
          "</div>" +
        "</div>" +
        '<p class="hire-error" id="hire-error">' + esc(state.hireError) + "</p>" +
        '<p class="hire-notice" id="hire-notice">' + esc(state.hireNotice) + "</p>" +
        '<button class="btn btn-gold hire-btn" type="submit">Hire driver</button>' +
      "</form>"
    );
  }

  function driverDetailHtml(driverId) {
    var rows = knownDriverRows();
    var d = null;
    rows.forEach(function (row) { if (row.id === driverId) d = row; });
    if (!d) {
      return '<p class="empty">Driver not found.</p><button type="button" class="btn btn-ghost" id="close-driver-detail">← Drivers</button>';
    }
    var totals = totalsForDriver(driverId);
    var day = state.driverDetailDay || chicagoToday();
    var monday = mondayOfWeek(day);
    var weekDays = [];
    var i;
    for (i = 0; i < 7; i += 1) weekDays.push(addDaysYmd(monday, i));
    var entries = historyEntries(driverId).filter(function (e) { return e.day === day; });
    var dayRide = 0;
    var dayComm = 0;
    var dayTips = 0;
    entries.forEach(function (e) {
      dayRide += Number(e.fareTotal) || 0;
      dayComm += Number(e.commissionCents) || 0;
      dayTips += Number(e.tipCents) || 0;
    });
    var cal = weekDays.map(function (ymd) {
      var count = historyEntries(driverId).filter(function (e) { return e.day === ymd; }).length;
      var selected = ymd === day ? " selected" : "";
      return '<button type="button" class="btn btn-ghost cal-day' + selected + '" data-detail-day="' + esc(ymd) + '">' +
        esc(ymd.slice(5)) + (count ? " · " + count : "") + "</button>";
    }).join("");
    var list;
    if (!entries.length) {
      list = '<p class="fine">No completed rides on ' + esc(day) + ".</p>";
    } else {
      list = entries.map(function (e) {
        return (
          '<article class="card">' +
          "<h3>" + esc(e.code || "Ride") + (String(e.rideType || "") === "metered" ? ' <span class="badge" style="background:#4a3d12;color:#f0d48a;border:1px solid #f0d48a">Metered</span>' : "") + "</h3>" +
          '<p class="meta">' +
          "<strong>Rider</strong> " + esc(e.riderName || "—") + "<br>" +
          "<strong>Route</strong> " + esc(e.pickup || "") + " → " + esc(e.drop || "") + "<br>" +
          "<strong>Ride total</strong> " + esc(fmtCents(e.fareTotal)) + "<br>" +
          "<strong>Commission</strong> " + esc(fmtCents(e.commissionCents)) +
          " (" + esc(String(e.commissionPct || "")) + "%)" +
          (e.billedMiles != null ? "<br><strong>Miles</strong> " + esc(String(e.billedMiles)) : "") +
          (Number(e.tipCents) > 0 ? "<br><strong>Tip</strong> " + esc(fmtCents(e.tipCents)) + " (100% to driver)" : "") +
          (String(e.rideType || "") === "metered" && e.paymentStatus ? "<br><strong>Payment</strong> " + esc(meterPayWord(e.paymentStatus, e.paidVia)) : "") +
          "</p></article>"
        );
      }).join("");
    }
    return (
      '<button type="button" class="btn btn-ghost" id="close-driver-detail">← Drivers</button>' +
      "<h3>" + esc(displayName(d.name, "Driver")) + " · history</h3>" +
      '<p class="meta">' +
      "<strong>All-time ride total</strong> " + esc(fmtCents(totals.rideTotal)) + "<br>" +
      "<strong>All-time commission total</strong> " + esc(fmtCents(totals.commissionTotal)) + "<br>" +
      (totals.tipTotal ? "<strong>All-time tips (100% to driver)</strong> " + esc(fmtCents(totals.tipTotal)) + "<br>" : "") +
      "<strong>Pay week</strong> Mon–Sun · " + esc(monday) + " → " + esc(addDaysYmd(monday, 6)) +
      "</p>" +
      '<div class="cal-week">' +
      '<button type="button" class="btn btn-ghost" id="detail-week-prev">←</button>' +
      cal +
      '<button type="button" class="btn btn-ghost" id="detail-week-next">→</button>' +
      "</div>" +
      '<p class="meta"><strong>' + esc(day) + "</strong> · ride " + esc(fmtCents(dayRide)) +
      " · commission " + esc(fmtCents(dayComm)) + (dayTips ? " · tips " + esc(fmtCents(dayTips)) : "") + "</p>" +
      list
    );
  }

  function driversPanelHtml() {
    if (state.selectedDriverId) {
      return driverDetailHtml(state.selectedDriverId);
    }
    var parts = [];
    if (state.rosterError === "denied") {
      parts.push('<p class="empty">Driver roster cannot be read (permission denied on /rides/' + esc(ROSTER_HUB) + '). Hire/Fire/commission saves need that path writable.</p>');
    } else if (state.rosterError) {
      parts.push('<p class="empty">Could not refresh the driver roster. Showing last known list.</p>');
    }
    if (state.driversError === "denied") {
      parts.push('<p class="empty">Driver presence cannot be read (permission denied). Online status may be incomplete.</p>');
    } else if (state.driversError) {
      parts.push('<p class="empty">Could not load online drivers. Presence may be incomplete.</p>');
    }

    var rows = knownDriverRows();
    if (!rows.length) {
      parts.push('<p class="empty">No drivers hired or online yet. Use Hire below.</p>');
    } else {
      parts.push(rows.map(function (d) {
        var trip = d.online ? matchDriverToRide(d, state.rides) : null;
        var rev = d.online ? revenueForDriver(d, state.rides) : { label: "—" };
        var pct = commissionPctFor(d.id);
        var approval = approvalOf(d);
        var totals = totalsForDriver(d.id);
        var badge;
        if (approval === "pending") badge = '<span class="badge pending">Pending</span>';
        else if (approval === "rejected") badge = '<span class="badge fired">Rejected</span>';
        else if (approval === "fired" || !d.active) badge = '<span class="badge fired">Fired</span>';
        else if (trip) badge = '<span class="badge on-trip">On trip' + (isBackgroundDriver(d) ? " · app in background" : "") + "</span>";
        else if (isBackgroundDriver(d)) badge = '<span class="badge bg-app" style="background:#4a3d12;color:#f0d48a;border:1px solid #f0d48a">Online · app in background · seen ' + esc(agoText(d.lastSeenAt)) + "</span>";
        else if (d.online) badge = '<span class="badge">Online · free</span>';
        else badge = '<span class="badge off">Approved · offline</span>';
        var statusShort;
        if (approval === "pending") statusShort = '<span class="badge pending">Pending</span>';
        else if (approval === "rejected") statusShort = '<span class="badge fired">Rejected</span>';
        else if (approval === "fired" || !d.active) statusShort = '<span class="badge fired">Fired</span>';
        else if (isBackgroundDriver(d)) statusShort = '<span class="badge bg-app" style="background:#4a3d12;color:#f0d48a;border:1px solid #f0d48a">Online · app in background · seen ' + esc(agoText(d.lastSeenAt)) + "</span>";
        else if (d.online) statusShort = '<span class="badge">Online</span>';
        else statusShort = '<span class="badge off">Offline</span>';
        var speedTxt = driverSpeedLabel(d);
        var where = isCoord(d.lat) && isCoord(d.lng)
          ? (isBackgroundDriver(d) ? "Last known spot " : "") + (+d.lat).toFixed(4) + ", " + (+d.lng).toFixed(4) +
            (isBackgroundDriver(d) ? " (seen " + agoText(d.lastSeenAt) + ")" : "")
          : (d.online ? "Location not shared" : "Not on the map");
        var contact = [];
        if (d.phone) contact.push(esc(d.phone));
        if (d.email) contact.push(esc(d.email));
        var car = carLabel(d);
        var plate = d.carPlate ? String(d.carPlate) : "";
        var day = chicagoToday();
        var mileDays = (state.miles && state.miles[d.id]) || {};
        var todayMiles = mileDays[day] || {};
        var startOdo = todayMiles.startOdometer != null ? todayMiles.startOdometer : d.startOdometer;
        var gpsToday = todayMiles.gpsMiles != null ? todayMiles.gpsMiles : d.gpsMilesToday;
        var hist = last14Days().map(function (ymd) {
          var row = mileDays[ymd];
          if (!row) return null;
          var gps = row.gpsMiles != null ? Number(row.gpsMiles).toFixed(1) : "0.0";
          var start = row.startOdometer != null ? String(row.startOdometer) : "—";
          var end = row.endOdometer != null ? String(row.endOdometer) : "—";
          return "<li><strong>" + esc(ymd) + "</strong> start " + esc(start) +
            " · GPS " + esc(gps) + " mi · end " + esc(end) + shiftLinesHtml(row) + "</li>";
        }).filter(Boolean);
        var cardClass = "card";
        if (trip) cardClass += " paired";
        if (!d.active) cardClass += " fired";
        if (state.focusDriverId && state.focusDriverId === d.id) cardClass += " focused";
        var canLocate = d.online && !!focusTarget(d.id);
        var locateBtn = d.online
          ? '<button type="button" class="btn btn-ghost btn-locate btn-locate-driver" data-driver-id="' + esc(d.id) + '"' +
            (canLocate ? "" : ' aria-disabled="true"') + ">" +
            (canLocate ? "&#128205; Locate on map" : "No live location") + "</button>"
          : "";
        var openAttr = state.expandedDrivers[d.id] ? " open" : "";
        return (
          '<details class="' + cardClass + ' driver-card"' + openAttr + ' data-driver-id="' + esc(d.id) + '">' +
            '<summary class="driver-card-summary">' +
              '<span class="driver-card-name">' + esc(displayName(d.name, "Driver")) + "</span>" +
              statusShort +
            "</summary>" +
            '<div class="driver-card-body">' +
              locateBtn +
              '<p class="driver-speed"><strong>Speed</strong> ' + esc(speedTxt) + "</p>" +
              '<h3 class="driver-card-status">' + badge + "</h3>" +
              '<p class="meta">' +
              (contact.length ? contact.join(" · ") + "<br>" : "") +
              (car || plate
                ? "<strong>Car</strong> " + esc(car || "—") +
                  (plate ? " · Plate " + esc(plate) : "") +
                  (d.carSeats ? " · " + esc(String(d.carSeats)) + " seats" : "") + "<br>"
                : "") +
              "<strong>Last seen</strong> " + esc(fmtClock(d.at)) + "<br>" +
              "<strong>Map</strong> " + esc(where) + "<br>" +
              "<strong>Today start odo</strong> " + esc(startOdo != null ? String(startOdo) : "—") + "<br>" +
              "<strong>GPS miles today</strong> " + esc(gpsToday != null ? Number(gpsToday).toFixed(1) + " mi" : "—") + "<br>" +
              "<strong>Live trip revenue</strong> " + esc(rev.label) +
              (trip ? "<br><strong>With</strong> " + esc(displayName(trip.name, "Rider")) : "") + "<br>" +
              "<strong>Ride total</strong> " + esc(fmtCents(totals.rideTotal)) + "<br>" +
              "<strong>Commission total</strong> " + esc(fmtCents(totals.commissionTotal)) +
              " · " + esc(String(totals.count)) + " logged rides" +
              "</p>" +
              (hist.length
                ? '<details class="miles-history"><summary>Last 14 days miles</summary><ul>' + hist.join("") + "</ul></details>"
                : '<p class="fine">No mileage days saved yet.</p>') +
              '<button type="button" class="btn btn-ghost btn-open-driver" data-driver-id="' + esc(d.id) + '">Calendar & history</button>' +
              '<div class="commission-row">' +
                '<label class="commission-label" for="comm-' + esc(d.id) + '">Commission %</label>' +
                '<input class="commission-input" id="comm-' + esc(d.id) + '" data-driver-id="' + esc(d.id) + '" type="number" min="0" max="100" step="1" value="' + esc(String(pct)) + '"' + (approval === "approved" ? "" : " disabled") + ">" +
                '<button type="button" class="btn btn-ghost btn-save-comm" data-driver-id="' + esc(d.id) + '"' + (approval === "approved" ? "" : " disabled") + ">Save</button>" +
                (approval === "pending"
                  ? '<button type="button" class="btn btn-gold btn-approve" data-driver-id="' + esc(d.id) + '">Approve</button>' +
                    '<button type="button" class="btn btn-fire btn-reject" data-driver-id="' + esc(d.id) + '">Reject</button>'
                  : (d.active
                    ? '<button type="button" class="btn btn-fire" data-driver-id="' + esc(d.id) + '">Fire</button>'
                    : '<button type="button" class="btn btn-ghost btn-rehire" data-driver-id="' + esc(d.id) + '">Rehire</button>')) +
              "</div>" +
            "</div>" +
          "</details>"
        );
      }).join(""));
    }
    parts.push('<p class="action-notice" id="drivers-action-notice">' + esc(state.actionNotice) + "</p>");
    return parts.join("");
  }

  function rideDriverNameHtml(ride) {
    var drivers = state.drivers || [];
    for (var i = 0; i < drivers.length; i += 1) {
      if (matchDriverToRide(drivers[i], [ride]) && focusTarget(drivers[i].id)) {
        return '<button type="button" class="driver-name-btn btn-locate-driver" data-driver-id="' + esc(drivers[i].id) + '" title="Show on map">' +
          esc(ride.driverName) + "</button>";
      }
    }
    return esc(ride.driverName);
  }

  function rideAddressText(r, which) {
    var full = r && r[which + "Address"];
    if (full) return String(full);
    return [r[which + "Street"], r[which + "Line2"], r[which + "City"],
      [r[which + "State"], r[which + "Zip"]].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }

  function rideStopsText(r) {
    var list = Array.isArray(r && r.stopAddresses) ? r.stopAddresses : [];
    if (!list.length && Array.isArray(r && r.stopList)) {
      list = r.stopList.map(function (s) {
        return s && (s.address || [s.street, s.line2, s.city, [s.state, s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "));
      });
    }
    return list.filter(Boolean);
  }

  function isCancelledRide(r) {
    return String((r && r.status) || "").toLowerCase() === "cancelled";
  }

  /* Hide cancelled rows after 12 hours so the board stays clean. */
  function showOnRidesPanel(r) {
    if (!isCancelledRide(r)) return true;
    var at = Number(r.cancelledAt || r.updatedAt) || 0;
    return !at || Date.now() - at < 12 * 3600 * 1000;
  }

  function cardStatusHtml(r) {
    var st = String((r && r.cardStatus) || "").toLowerCase();
    if (st === "on_file") {
      return "<strong>Card</strong> On file" + (r.cardLast4 ? " (" + esc(r.cardBrand || "card") + " •••• " + esc(r.cardLast4) + ")" : "");
    }
    if (st === "owner_ok") return "<strong>Card</strong> OK'd by you";
    if (st === "test_skip") return "<strong>Card</strong> Skipped (TEST ride)";
    if (st === "link_requested") return '<strong>Card</strong> <span style="color:#ffc96b">Needs payment link — text the rider a Square link</span>';
    if (st === "none") return "<strong>Card</strong> Not added yet";
    return "";
  }

  /* v58: one-line payment status for a ride (rides panel). */

  /* ===== v64g: owner Cancel ride + Refund on ride cards =====
     Cancel ride = the same fields the rider app's Cancel writes (status "cancelled", cancelledAt, cancelledBy,
     cancelFeeCents), cancelledBy "owner", never a cancel fee (cancelFeeStatus "free"). The REQUESTS row stays as
     "cancelled" (drivers only list "requested" rows, so it leaves their map at once; God mode shows it greyed).
     A driver who already accepted is released by the driver app's cancel check (it drops the trip and says so).
     Saved cards have no hold to void (Square card on file only; nothing is charged until drop-off). A quote-page
     deposit is NOT refunded automatically: the card then shows "Refund…" (pcs-pay /refund, God password). */
  function openRowUrl(code) {
    return openUrl().replace(/\.json$/, "/") + encodeURIComponent(code) + ".json";
  }
  function rideStatusOf(r) { return String((r && r.status) || "requested").toLowerCase(); }
  function canOwnerCancel(r) {
    var st = rideStatusOf(r);
    return st === "pending_owner" || st === "pending-owner" || st === "requested" || st === "waiting" || st === "accepted";
  }
  function paidCentsOf(code) {
    var p = (state.payments || {})[code];
    if (!p) return 0;
    var paid = (payRecOk(p.full) ? Number(p.full.amountCents) || 0 : 0) || (payRecOk(p.deposit) ? Number(p.deposit.amountCents) || 0 : 0) ||
      (payRecOk(p.final) ? Number(p.final.amountCents) || 0 : 0);
    return Math.max(0, paid - refundedOf(p, "refund"));
  }
  /* Same rules as the Payments panel's Refund… buttons. */
  function refundChoices(code) {
    var p = (state.payments || {})[code];
    if (!p) return [];
    var out = [];
    var f = p.final;
    var mainPaid = (payRecOk(f) ? Number(f.amountCents) || 0 : 0) || (payRecOk(p.full) ? Number(p.full.amountCents) || 0 : 0) ||
      (payRecOk(p.deposit) ? Number(p.deposit.amountCents) || 0 : 0);
    var mainLeft = mainPaid - refundedOf(p, "refund");
    if (mainPaid > 0 && mainLeft > 0) {
      var purpose = payRecOk(f) ? "final" : payRecOk(p.full) ? "full" : "deposit";
      out.push({ purpose: purpose, left: mainLeft, label: "Refund " + (purpose === "deposit" ? "deposit" : "payment") + "… (" + fmtCents(mainLeft) + ")" });
    }
    var c = p.cancel;
    var cancelPaid = payRecOk(c) ? Number(c.amountCents) || 0 : 0;
    var cancelLeft = cancelPaid - refundedOf(p, "cancelRefund");
    if (cancelPaid > 0 && cancelLeft > 0) out.push({ purpose: "cancel", left: cancelLeft, label: "Refund cancel fee… (" + fmtCents(cancelLeft) + ")" });
    return out;
  }
  function ownerRideButtonsHtml(r) {
    var code = String((r && r.code) || "");
    if (!code) return "";
    var btns = [];
    if (canOwnerCancel(r)) {
      btns.push('<button type="button" class="btn btn-fire btn-owner-cancel" data-ride-code="' + esc(code) + '">Cancel ride</button>');
    } else if (rideStatusOf(r) === "started") {
      btns.push('<span class="meta" style="opacity:.8">Trip in progress: the driver ends it in the driver app.</span>');
    }
    var busy = !!(state.payBusy || {})[code];
    refundChoices(code).forEach(function (c) {
      btns.push('<button type="button" class="btn btn-ghost btn-ride-refund" data-ride-code="' + esc(code) + '" data-purpose="' + esc(c.purpose) +
        '" data-left="' + esc(String(c.left)) + '"' + (busy ? " disabled" : "") + ">" + esc(c.label) + "</button>");
    });
    return btns.join("");
  }
  function cancelConfirmText(code, ride) {
    var who = displayName(ride && ride.name, "the rider");
    var lines = ["Cancel ride " + code + " for " + who + "?", "", "No cancel fee will be charged."];
    if (ride && rideStatusOf(ride) === "accepted") lines.push((ride.driverName ? ride.driverName : "The driver") + " will be told and released.");
    var paid = paidCentsOf(code);
    if (paid > 0) lines.push("", fmtCents(paid) + " was already paid. It is NOT refunded automatically: tap Refund… on this ride after cancelling.");
    return lines.join("\n");
  }
  function cancelRideByOwner(code) {
    code = String(code || "").toUpperCase();
    if (!code) return Promise.resolve(false);
    var full = null, row = null;
    return Promise.all([
      getRide(code),
      fetch(openRowUrl(code)).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; })
    ]).then(function (got) {
      full = got[0] && typeof got[0] === "object" ? got[0] : null;
      row = got[1] && typeof got[1] === "object" ? got[1] : null;
      var cur = full || row;
      if (!cur) throw new Error("missing");
      var st = rideStatusOf(cur);
      if (st === "cancelled") { state.actionNotice = "Ride " + code + " was already cancelled."; return false; }
      if (st === "started") { state.actionNotice = "Ride " + code + " is already in progress. The driver ends it in the driver app."; return false; }
      if (st === "completed" || st === "denied") { state.actionNotice = "Ride " + code + " is already " + st + "."; return false; }
      var now = Date.now();
      var patch = { status: "cancelled", cancelledAt: now, cancelledBy: "owner", cancelFeeCents: 0, cancelFeeStatus: "free",
        cancelClientReason: "owner_cancelled", ownerCancelledAt: now, updatedAt: now };
      return (full ? patchRide(code, patch) : Promise.resolve()).then(function () {
        if (!row) return null;
        return fetch(openRowUrl(code), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
          .then(function (res) { if (!res.ok) throw new Error("open"); });
      }).then(function () {
        silenceRide(code);
        var paid = paidCentsOf(code);
        state.actionNotice = "Cancelled ride " + code + ". No cancel fee." + (st === "accepted" ? " The driver was released." : "") +
          (paid > 0 ? " " + fmtCents(paid) + " was paid: tap Refund… on the ride to give it back." : "");
        return true;
      });
    }).catch(function () {
      state.actionNotice = "Could not cancel ride " + code + ". Check the connection and try again.";
      return false;
    });
  }
  function ownerCancelTap(code, btn, after) {
    var ride = freshRide({ code: code });
    if (!window.confirm(cancelConfirmText(code, ride))) return;
    if (btn) btn.disabled = true;
    cancelRideByOwner(code).then(function (ok) {
      if (btn) btn.disabled = false;
      var n = document.getElementById("drivers-action-notice");
      if (n && state.actionNotice) n.textContent = state.actionNotice;
      if (!ok && state.actionNotice) window.alert(state.actionNotice);
      if (after) after(ok);
      refresh();
    });
  }
  function bindOwnerRideActions() {
    var root = document.getElementById("rides-list");
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".btn-owner-cancel"), function (btn) {
      if (btn.getAttribute("data-bound") === "1") return;
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function () { ownerCancelTap(btn.getAttribute("data-ride-code"), btn); });
    });
    Array.prototype.forEach.call(root.querySelectorAll(".btn-ride-refund"), function (btn) {
      if (btn.getAttribute("data-bound") === "1") return;
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function () {
        openRefundPopup(btn.getAttribute("data-ride-code"), btn.getAttribute("data-purpose"), Number(btn.getAttribute("data-left")) || 0);
      });
    });
  }
  /* ===== end v64g cancel/refund ===== */

  function ridePayLineHtml(r) {
    if (!r) return "";
    var ps = String(r.paymentStatus || "").toLowerCase();
    var bits = [];
    if (ps === "charged") {
      bits.push('<span style="color:#7fe09a">Charged ' + esc(fmtCents(r.chargedCents)) +
        (Number(r.tipCents) > 0 ? " (tip " + esc(fmtCents(r.tipCents)) + ")" : "") + "</span>");
    } else if (ps === "charge_failed") {
      bits.push('<span style="color:#ff8a8a">Charge failed' + (r.payError ? ": " + esc(String(r.payError).slice(0, 80)) : "") + "</span>");
    } else if (ps === "refunded") {
      bits.push('<span style="color:#ffc96b">Refunded ' + esc(fmtCents(r.refundedCents)) + "</span>");
    } else if (ps === "partially_refunded") {
      bits.push('<span style="color:#ffc96b">Part refunded ' + esc(fmtCents(r.refundedCents)) + "</span>");
    } else if (ps === "deposit_paid") {
      bits.push("Deposit paid " + esc(fmtCents(r.paidCents)));
    } else if (ps === "paid_in_full") {
      bits.push("Paid in full " + esc(fmtCents(r.paidCents)));
    } else if (String(r.status || "").toLowerCase() === "completed" && r.squareCardId) {
      bits.push('<span style="color:#ffc96b">Not charged yet</span>');
    }
    var cf = String(r.cancelFeeStatus || "").toLowerCase();
    if (cf === "charged") bits.push("Cancel fee " + esc(fmtCents(r.cancelFeeCents)));
    else if (cf === "failed") bits.push('<span style="color:#ff8a8a">Cancel fee failed</span>');
    else if (cf === "refunded") bits.push("Cancel fee refunded");
    else if (cf === "free") bits.push('<span style="color:#7fe09a">No cancel fee</span>');
    if (!bits.length) return "";
    return "<strong>Payment</strong> " + bits.join(" · ");
  }

  function cardNeedsOk(r) {
    var st = String((r && r.cardStatus) || "").toLowerCase();
    return (st === "none" || st === "link_requested") && !isCancelledRide(r) && String(r.status || "").toLowerCase() !== "denied";
  }

  function ridesPanelHtml() {
    if (state.ridesError === "denied") {
      return '<p class="empty">Open ride requests cannot be read (permission denied). No riders invented.</p>';
    }
    if (state.ridesError) {
      return '<p class="empty">Could not load ride requests. Showing none.</p>';
    }
    var shown = (state.rides || []).filter(showOnRidesPanel);
    if (!shown.length) {
      return safetyBannerHtml() + bookingAlertBannerHtml() + '<p class="empty">No riders requesting a ride right now.</p>';
    }
    var cards = shown.map(function (r) {
      var active = isActiveTrip(r);
      var pending = isPendingOwner(r);
      var denied = String(r.status || "").toLowerCase() === "denied";
      var cancelled = isCancelledRide(r);
      var stops = rideStopsText(r);
      var cardLine = cardStatusHtml(r);
      var payLine = ridePayLineHtml(r);
      if (payLine) cardLine = cardLine ? cardLine + "<br>" + payLine : payLine;
      var requestAt = r.updatedAt || r.requestedAt || r.createdAt || null;
      var pickupWhen = fmtWhen(r.date, r.time, r);
      var dropWhen = r.dropTime || r.dropoffTime || r.etaDrop || null;
      if (!dropWhen) dropWhen = "—";
      var badge = active
        ? '<span class="badge on-trip">' + esc(r.status || "on trip") + "</span>"
        : (pending
          ? '<span class="badge pending">Needs your OK</span>'
          : (cancelled
            ? '<span class="badge">Cancelled' + (r.cancelledBy === "rider" ? " by rider" : (r.cancelledBy === "owner" ? " by PCS" : "")) + "</span>"
            : (denied
              ? '<span class="badge">Denied</span>'
              : '<span class="badge">Open to drivers</span>')));
      var okCardBtn = cardNeedsOk(r)
        ? '<button type="button" class="btn btn-ghost btn-card-ok" data-ride-code="' + esc(r.code || "") + '">Mark card OK</button>'
        : "";
      var actions = pending
        ? ('<div class="commission-row" style="margin-top:8px">' +
          '<button type="button" class="btn btn-gold btn-approve-booking" data-ride-code="' + esc(r.code || "") + '">Approve booking</button>' +
          '<button type="button" class="btn btn-fire btn-deny-booking" data-ride-code="' + esc(r.code || "") + '">Deny</button>' +
          okCardBtn +
          "</div>")
        : (okCardBtn ? '<div class="commission-row" style="margin-top:8px">' + okCardBtn + "</div>" : "");
      var ownerBtns = ownerRideButtonsHtml(r); /* v64g: Cancel ride + Refund… */
      if (ownerBtns) actions += '<div class="commission-row owner-ride-actions" style="margin-top:8px">' + ownerBtns + "</div>";
      var cancelTxt = cancelled ? cancelFeeText(r, (state.payments || {})[r.code] || null) : "";
      var cancelLine = cancelled
        ? "<br><strong>Cancelled</strong> " + esc(fmtClock(r.cancelledAt || r.updatedAt)) +
          (cancelTxt ? ' · <span class="cancel-fee-line">' + esc(cancelTxt) + "</span>" : "")
        : "";
      return (
        '<article class="card' + (active ? " paired" : "") + (pending ? " pending-booking" : "") + '"' + (cancelled ? ' style="opacity:0.65"' : "") + ">" +
          "<h3>" + esc(displayName(r.name, "Rider")) + badge + "</h3>" +
          '<p class="meta">' +
          "<strong>Code</strong> " + esc(r.code || "—") + "<br>" +
          "<strong>Request time</strong> " + esc(fmtClock(requestAt)) + "<br>" +
          "<strong>Wait time</strong> " + esc(waitLabel(requestAt)) + "<br>" +
          "<strong>Pickup time</strong> " + esc(pickupWhen) + "<br>" +
          "<strong>Drop-off time</strong> " + esc(String(dropWhen)) + "<br>" +
          "<strong>Pickup</strong> " + esc(rideAddressText(r, "pickup") || "—") + "<br>" +
          stops.map(function (s, i) { return "<strong>Stop " + (i + 1) + "</strong> " + esc(s) + "<br>"; }).join("") +
          "<strong>Drop-off</strong> " + esc(rideAddressText(r, "drop") || "—") +
          (r.internationalArrival ? '<br><strong class="intl-arrival-tag">International arrival</strong> +$15 service fee (taxed, in the fare)' : "") +
          (r.phone ? "<br><strong>Phone</strong> " + esc(r.phone) : "") +
          (cardLine ? "<br>" + cardLine : "") +
          cancelLine +
          (active && r.driverName ? "<br><strong>Driver</strong> " + rideDriverNameHtml(r) : "") +
          "</p>" +
          actions +
        "</article>"
      );
    }).join("");
    return safetyBannerHtml() + bookingAlertBannerHtml() + cards;
  }

  function renderBoardLists() {
    var d = document.getElementById("drivers-list");
    var r = document.getElementById("rides-list");
    var b = document.getElementById("day-board");
    if (d) d.innerHTML = driversPanelHtml();
    if (r) r.innerHTML = ridesPanelHtml();
    var pl = document.getElementById("payments-list");
    if (pl) {
      /* v58: only redraw when something changed, so a Refund / Charge tap is never lost to the 5 s poll. */
      var payHtml = paymentsPanelHtml();
      if (pl.getAttribute("data-html-sig") !== String(payHtml.length) + ":" + hashStr(payHtml)) {
        pl.innerHTML = payHtml;
        pl.setAttribute("data-html-sig", String(payHtml.length) + ":" + hashStr(payHtml));
        pl.removeAttribute("data-bound");
      }
    }
    if (b) {
      var wrap = document.createElement("div");
      wrap.innerHTML = dayBoardHtml();
      var next = wrap.firstChild;
      if (next) b.replaceWith(next);
    }
    bindDriverActions();
    bindBookingActions();
    bindPaymentActions();
    bindSafetyActions();
    bindLocateActions();
    bindDayBoardActions();
    bindOwnerRideActions();
    setFocusBar();
  }

  function bindDayBoardActions() {
    var board = document.getElementById("day-board");
    if (!board) return;
    var how = document.getElementById("board-how");
    if (how) {
      how.addEventListener("toggle", function () {
        state.showBoardHow = !!how.open;
      });
    }
    Array.prototype.forEach.call(board.querySelectorAll(".day-fare"), function (input) {
      input.addEventListener("input", function () {
        var id = input.getAttribute("data-event-id");
        if (!id) return;
        state.fareDrafts[id] = input.value;
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-assign-ride"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id");
        if (!id) return;
        var sel = document.getElementById("assign-" + id);
        var driverId = sel ? sel.value : "";
        if (!driverId) {
          state.boardNotice = "Pick an approved driver first.";
          renderBoardLists();
          return;
        }
        btn.disabled = true;
        assignCalendarRide(id, driverId).then(function () {
          btn.disabled = false;
        }).catch(function () {
          btn.disabled = false;
          state.boardNotice = "Could not assign that ride.";
          renderBoardLists();
        });
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-complete-ride"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id");
        if (!id) return;
        var fareInput = document.getElementById("fare-" + id);
        var fare = fareInput ? fareInput.value : state.fareDrafts[id];
        if (!window.confirm("Mark complete and credit commission into this driver's Mon–Sun pay week?")) return;
        btn.disabled = true;
        completeCalendarRide(id, fare).then(function () {
          btn.disabled = false;
        }).catch(function (err) {
          btn.disabled = false;
          state.boardNotice = err && err.message === "unassigned"
            ? "Assign a driver before completing."
            : "Could not complete / credit that ride.";
          renderBoardLists();
        });
      });
    });
  }

  function bindSafetyActions() {
    document.querySelectorAll(".btn-dismiss-safety").forEach(function (btn) {
      btn.addEventListener("click", function () {
        dismissSafetyAlert(btn.getAttribute("data-safety-id")).then(function () { refresh(); });
      });
    });
  }

  function bindLocateActions() {
    ["drivers-list", "rides-list"].forEach(function (listId) {
      var list = document.getElementById(listId);
      if (!list) return;
      Array.prototype.forEach.call(list.querySelectorAll(".btn-locate-driver"), function (btn) {
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          focusDriver(btn.getAttribute("data-driver-id"));
        });
      });
    });
  }


  /* ---------------- v58 Payments (pcs-pay Worker) ---------------- */
  function paymentsUrl() {
    return baseUrl() + "/rides/" + PAY_HUB + ".json";
  }

  function listPayments() {
    return fetch(paymentsUrl(), { cache: "no-store" }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var e = new Error("denied");
        e.denied = true;
        throw e;
      }
      if (!res.ok) throw new Error("payments " + res.status);
      return res.text().then(function (text) {
        if (!text || text === "null") return {};
        try { return JSON.parse(text) || {}; } catch (err) { return {}; }
      });
    });
  }

  function payRecOk(rec) {
    return !!(rec && typeof rec === "object" && String(rec.status || "").toUpperCase() === "COMPLETED");
  }

  function payEntries() {
    var raw = state.payments || {};
    var cutoff = Date.now() - PAY_SHOW_DAYS * 86400000;
    var out = [];
    Object.keys(raw).forEach(function (code) {
      var p = raw[code];
      if (!p || typeof p !== "object") return;
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return;
      p.code = code;
      if ((Number(p.updatedAt) || 0) < cutoff) return;
      out.push(p);
    });
    out.sort(function (a, b) { return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0); });
    return out.slice(0, 40);
  }

  /* Rides that still might need a God-mode charge: re-read them (max every 30s each) to know completed/cancelled. */
  function refreshPayRides() {
    var now = Date.now();
    var want = payEntries().filter(function (p) {
      var metered = isMeteredPay(p); /* v70: metered rides: the rider's optional info lives on the ride (God mode only) */
      if (!metered && (payRecOk(p.final) || payRecOk(p.cancel))) return false;
      if (!metered && !p.card) return false;
      if (now - (Number(p.updatedAt) || 0) > 3 * 86400000) return false;
      var c = state.payRides[p.code];
      return !c || now - c.at > (metered && payRecOk(p.final) ? 300000 : 30000);
    }).slice(0, 20);
    return Promise.all(want.map(function (p) {
      return fetch(rideUrl(p.code), { cache: "no-store" }).then(function (res) {
        if (!res.ok) return null;
        return res.json();
      }).then(function (ride) {
        state.payRides[p.code] = { at: Date.now(), ride: ride && typeof ride === "object" ? ride : null };
      }).catch(function () {});
    }));
  }

  function payRideOf(code) {
    var c = state.payRides[code];
    return c && c.ride ? c.ride : null;
  }

  function receiptLink(url, label) {
    var u = String(url || "");
    if (!/^https:\/\/[a-z0-9.-]*squareup(sandbox)?\.com\//i.test(u)) return "";
    return ' <a href="' + esc(u) + '" target="_blank" rel="noopener" style="color:#f0d48a">' + esc(label || "Receipt") + "</a>";
  }

  function refundedOf(p, key) {
    var r = p && p[key];
    return r && typeof r === "object" ? Number(r.totalRefundedCents) || 0 : 0;
  }

  function canChargeFare(p, ride) {
    if (!ride || payRecOk(p.final)) return false;
    if (!p.card || String(p.card.status || "").toUpperCase() !== "SAVED") return false;
    if (String(ride.status || "").toLowerCase() !== "completed") return false;
    if (ride.isTest === true || ride.testRide === true) return false;
    if (String(ride.paymentStatus || "").toLowerCase() === "paid_in_full") return false;
    return fareDueOf(ride) > 0;
  }

  /* Same math as the Worker: driver's final fare minus a quote-page deposit already paid. */
  function fareDueOf(ride) {
    var fare = Number(ride && ride.fareTotal) || 0;
    var dep = String(ride && ride.paymentStatus || "").toLowerCase() === "deposit_paid" ? Number(ride.paidCents) || 0 : 0;
    return Math.max(0, fare - dep);
  }

  function canChargeCancel(p, ride) {
    if (!ride || payRecOk(p.cancel)) return false;
    if (!p.card || String(p.card.status || "").toUpperCase() !== "SAVED") return false;
    var st = String(ride.status || "").toLowerCase();
    if (st !== "cancelled" && st !== "canceled") return false;
    if (String(ride.cancelledBy || "rider").toLowerCase() !== "rider") return false;
    /* v59: a free cancel (driver over 1 mile away / location not current) can't be charged */
    if (String(ride.cancelFeeStatus || "").toLowerCase() === "free") return false;
    if (ride.cancelPolicy && typeof ride.cancelPolicy === "object" && ride.cancelPolicy.charge === false) return false;
    if (p && p.cancelPolicy) return false;
    return !!(ride.acceptedAt || ride.driverId || ride.driverUid);
  }

  /* ---------------- v70: metered rides (driver app) ---------------- */
  function isMeteredPay(p) {
    return !!p && (String(p.rideType || "").toLowerCase() === "metered" || !!(p.meter && typeof p.meter === "object"));
  }
  function meterStatusOf(p) {
    var m = (p && p.meter) || {};
    var ms = String(m.status || "").toLowerCase();
    if (payRecOk(p.final)) return "paid";
    if (p.paidOther || ms === "paid_other") return "paid_other";
    if (ms === "paid") return "paid";
    if (ms === "running") return "running";
    return "unpaid"; /* ended (waiting for the QR payment) or finished unpaid */
  }
  function meterPayWord(ps, via) {
    ps = String(ps || "").toLowerCase();
    if (ps === "charged") return "Paid (Square)";
    if (ps === "paid_other") return "Paid another way" + (via ? " (" + String(via).replace("_", " ") + ")" : "");
    return "NOT PAID";
  }
  function meterSpotHtml(m, which) {
    var addr = String(m[which + "Address"] || "");
    var lat = m[which + "Lat"], lng = m[which + "Lng"];
    var coords = isCoord(lat) && isCoord(lng) ? (+lat).toFixed(5) + ", " + (+lng).toFixed(5) : "";
    var link = coords ? ' <a href="https://maps.apple.com/?q=' + encodeURIComponent(coords) + '" target="_blank" rel="noopener" style="color:#f0d48a">map</a>' : "";
    return esc(addr || coords || "spot not recorded") + link;
  }
  function meterUnpaidFlagHtml(list) {
    var rows = list.filter(function (p) { return isMeteredPay(p) && meterStatusOf(p) === "unpaid"; });
    if (!rows.length) return "";
    return '<div class="card" id="meter-unpaid-flag" style="border:2px solid #ff6b6b;background:#3a1212">' +
      '<h3 style="color:#ff8a8a;margin-top:0"><span class="badge" style="background:#c62828;color:#fff">' + rows.length + "</span> Unpaid metered ride" + (rows.length === 1 ? "" : "s") + "</h3>" +
      rows.map(function (p) {
        var m = p.meter || {};
        var finished = String(m.status || "").toLowerCase() === "unpaid" || !!p.unpaidFinishedAt;
        return '<p class="meta meter-unpaid-row" data-code="' + esc(p.code) + '" style="margin:6px 0;border-top:1px solid rgba(255,138,138,.35);padding-top:6px">' +
          "<strong>" + esc(p.code) + "</strong> · " + esc(fmtCents(m.fareTotal)) + " · ended " + esc(m.endedAt ? fmtClock(m.endedAt) : "—") +
          " · " + esc(m.driverName || "driver") + "<br>" +
          "<strong>Pickup</strong> " + meterSpotHtml(m, "pickup") + "<br>" +
          '<span style="color:#ff8a8a">' + (finished ? "Driver finished without payment" : "Waiting for the rider to pay (QR)") + "</span></p>";
      }).join("") + "</div>";
  }
  function meterPayLines(p) {
    var m = p.meter || {};
    var st = meterStatusOf(p);
    var lines = [];
    lines.push("<strong>Metered</strong> " + esc(m.miles != null ? Number(m.miles).toFixed(2) + " mi" : "—") +
      (m.minutes ? " · " + esc(String(m.minutes)) + " min" : "") + (m.waitMinutes ? " (" + esc(String(m.waitMinutes)) + " slow)" : "") +
      " · " + esc(m.tierLabel || "") + " · driver " + esc(m.driverName || "—"));
    lines.push("<strong>Pickup</strong> " + meterSpotHtml(m, "pickup") + (m.startedAt ? " · " + esc(fmtClock(m.startedAt)) : ""));
    if (m.endedAt) lines.push("<strong>Drop-off</strong> " + meterSpotHtml(m, "drop") + " · " + esc(fmtClock(m.endedAt)));
    if (m.fareTotal != null) lines.push("<strong>Fare</strong> " + esc(fmtCents(m.fareTotal)));
    if (st === "running") lines.push('<span style="color:#f0d48a">Ride in progress</span>');
    else if (st === "paid_other") {
      var o = p.paidOther || {};
      lines.push('<span style="color:#ffc96b">Paid another way · ' + esc(String(o.method || "other").replace("_", " ")) + " · " + esc(fmtCents(o.amountCents)) +
        (Number(o.tipCents) > 0 ? " + tip " + esc(fmtCents(o.tipCents)) : "") + " · reported by " + esc(o.by || m.driverName || "driver") + " · not checked by Square</span>");
    } else if (st === "unpaid") lines.push('<span style="color:#ff8a8a"><strong>NOT PAID</strong></span>');
    if (p.meterLink && !payRecOk(p.final)) lines.push('<span style="opacity:.8">QR link ' + esc(String(p.meterLink.status || "").toLowerCase()) + "</span>");
    var rr = payRideOf(p.code) || {};
    var who = rr.meterRider && typeof rr.meterRider === "object" ? rr.meterRider : null;
    if (who && (who.name || who.phone || who.email)) {
      var tel = String(who.phone || "").replace(/[^0-9+]/g, "");
      lines.push('<span class="meter-rider-info"><strong>Rider (optional, from the meter page)</strong> ' + esc(who.name || "\u2014") +
        (who.phone ? ' · <a href="tel:' + esc(tel) + '" style="color:#f0d48a">' + esc(who.phone) + "</a>" : "") +
        (who.email ? ' · <a href="mailto:' + esc(who.email) + '" style="color:#f0d48a">' + esc(who.email) + "</a>" : "") + "</span>");      var inv = who.invite && typeof who.invite === "object" ? who.invite : null; /* v71: welcome invite status */
      var invWord = function (st) { return ({ sent: "sent", already_sent: "already invited before", not_configured: "not sent (sender not set up yet)", sms_not_wired: "not sent (texting not set up yet)", skipped_test: "not sent (test ride)", failed: "send failed" })[st] || ""; };
      if (inv && (invWord(inv.email) || invWord(inv.sms))) lines.push('<span class="meter-rider-invite" style="opacity:.85">Welcome note: ' +
        [inv.email && invWord(inv.email) ? "email " + invWord(inv.email) : "", inv.sms && invWord(inv.sms) ? "text " + invWord(inv.sms) : ""].filter(Boolean).join(" · ") + "</span>");
    }
    if (rr.cardStatus === "on_file" && !payRecOk(p.final)) lines.push('<span style="color:#8fd0a8">Rider saved a card on the meter page' + (rr.cardLast4 ? " (" + esc(rr.cardBrand || "card") + " " + esc(rr.cardLast4) + ")" : "") + "</span>");
    if (rr.paidVia === "meter_card" || (p.final && p.final.via === "meter_card")) lines.push('<span style="color:#8fd0a8">Paid on the rider\u2019s meter page (saved card)</span>');
    return lines;
  }

  function paymentsPanelHtml() {
    if (state.paymentsError === "denied") return '<p class="empty">Payments cannot be read (permission denied).</p>';
    if (state.paymentsError) return '<p class="empty">Could not load payments. Trying again…</p>';
    var list = payEntries();
    var notice = state.payNotice ? '<p class="meta" id="pay-notice" style="color:#f0d48a">' + esc(state.payNotice) + "</p>" : "";
    notice = meterUnpaidFlagHtml(list) + notice; /* v70 */
    if (!list.length) return notice + '<p class="empty">No card payments in the last ' + PAY_SHOW_DAYS + " days.</p>";
    return notice + list.map(function (p) {
      var code = String(p.code);
      var test = String(p.env || "").toLowerCase() === "sandbox";
      var lines = [];
      var card = p.card;
      if (card) {
        lines.push("<strong>Card</strong> " + (String(card.status || "").toUpperCase() === "SAVED" ? "Saved" : esc(card.status || "")) +
          (card.last4 ? " (" + esc(card.brand || "card") + " •••• " + esc(card.last4) + ")" : ""));
      }
      ["deposit", "full"].forEach(function (k) {
        var d = p[k];
        if (!d) return;
        lines.push("<strong>" + (k === "full" ? "Paid in full" : "Deposit") + "</strong> " +
          (payRecOk(d) ? '<span style="color:#7fe09a">Charged ' + esc(fmtCents(d.amountCents)) + "</span>" + receiptLink(d.receiptUrl)
            : '<span style="color:#ff8a8a">Failed' + (d.error ? ": " + esc(String(d.error).slice(0, 90)) : "") + "</span>"));
      });
      var f = p.final;
      if (f) {
        if (payRecOk(f)) {
          lines.push("<strong>Ride</strong> " + '<span style="color:#7fe09a">Charged ' + esc(fmtCents(f.amountCents)) + "</span>" +
            " (fare " + esc(fmtCents(f.fareCents)) + " + tip " + esc(fmtCents(f.tipCents)) + ")" + receiptLink(f.receiptUrl));
        } else {
          lines.push("<strong>Ride</strong> " + '<span style="color:#ff8a8a">Charge failed' +
            (f.error ? ": " + esc(String(f.error).slice(0, 90)) : "") + "</span>");
        }
      }
      var rf = p.refund;
      if (rf) {
        lines.push("<strong>Refund</strong> " + '<span style="color:#ffc96b">Refunded ' + esc(fmtCents(rf.totalRefundedCents || rf.amountCents)) +
          "</span> (" + esc(String(rf.status || "PENDING").toLowerCase()) + ")");
      }
      var metered = isMeteredPay(p); /* v70 */
      if (metered) lines = lines.concat(meterPayLines(p));
      var c = p.cancel;
      if (c) {
        lines.push("<strong>Cancel fee</strong> " + (payRecOk(c) ? '<span style="color:#7fe09a">Charged ' + esc(fmtCents(c.amountCents)) + "</span>" + receiptLink(c.receiptUrl)
          : '<span style="color:#ff8a8a">Failed' + (c.error ? ": " + esc(String(c.error).slice(0, 90)) : "") + "</span>"));
      }
      if (!c && p.cancelPolicy) {
        lines.push('<strong>Cancel fee</strong> <span style="color:#7fe09a">' + esc(cancelFeeText(payRideOf(code) || { cancelFeeStatus: "free" }, p)) + "</span>");
      } else if (c) {
        var cMi = c.miles != null && isFinite(+c.miles) ? (Math.round(+c.miles * 10) / 10).toFixed(1) : "";
        if (cMi) lines.push('<span style="opacity:.8">Driver was ' + esc(cMi) + " mi from pickup when the rider cancelled</span>");
      }
      var cr = p.cancelRefund;
      if (cr) lines.push("<strong>Cancel fee refund</strong> " + esc(fmtCents(cr.totalRefundedCents || cr.amountCents)) + " (" + esc(String(cr.status || "").toLowerCase()) + ")");
      var ride = payRideOf(code);
      if (ride && !payRecOk(f)) {
        var st = String(ride.status || "").toLowerCase();
        if (st === "completed") lines.push("<strong>Ride</strong> Completed · fare " + esc(fmtCents(ride.fareTotal)) + ' · <span style="color:#ffc96b">rider has not paid yet</span>');
        else if (st) lines.push("<strong>Ride</strong> " + esc(st));
      }

      var btns = [];
      var busy = !!state.payBusy[code];
      var dis = busy ? " disabled" : "";
      var mainPaid = (payRecOk(f) ? Number(f.amountCents) || 0 : 0) || (payRecOk(p.full) ? Number(p.full.amountCents) || 0 : 0) ||
        (payRecOk(p.deposit) ? Number(p.deposit.amountCents) || 0 : 0);
      var mainLeft = mainPaid - refundedOf(p, "refund");
      if (metered && mainPaid > 0) lines.push('<span style="opacity:.8">Refunds for metered rides: Square Dashboard</span>');
      if (!metered && mainPaid > 0 && mainLeft > 0) {
        btns.push('<button type="button" class="btn btn-ghost pay-refund-btn" data-code="' + esc(code) + '" data-purpose="' +
          (payRecOk(f) ? "final" : payRecOk(p.full) ? "full" : "deposit") + '" data-left="' + mainLeft + '"' + dis + ">Refund…</button>");
      }
      var cancelPaid = payRecOk(c) ? Number(c.amountCents) || 0 : 0;
      var cancelLeft = cancelPaid - refundedOf(p, "cancelRefund");
      if (cancelPaid > 0 && cancelLeft > 0) {
        btns.push('<button type="button" class="btn btn-ghost pay-refund-btn" data-code="' + esc(code) + '" data-purpose="cancel" data-left="' +
          cancelLeft + '"' + dis + ">Refund cancel fee…</button>");
      }
      if (canChargeFare(p, ride)) {
        btns.push('<button type="button" class="btn btn-gold pay-charge-btn" data-code="' + esc(code) + '" data-cents="' +
          fareDueOf(ride) + '"' + dis + ">Charge " + esc(fmtCents(fareDueOf(ride))) + " now (no tip)</button>");
      }
      if (canChargeCancel(p, ride)) {
        btns.push('<button type="button" class="btn btn-ghost pay-cancelfee-btn" data-code="' + esc(code) + '"' + dis + ">Charge cancel fee</button>");
      }
      return '<div class="card pay-card' + (metered ? " meter-pay-card" : "") + '" data-code="' + esc(code) + '">' +
        "<h3>" + esc(p.name || "Rider") + ' <span style="font-weight:500;opacity:.75">' + esc(code) + "</span>" +
        (metered ? ' <span class="badge" style="background:#4a3d12;color:#f0d48a;border:1px solid #f0d48a">METERED</span>' : "") +
        (metered && meterStatusOf(p) === "unpaid" ? ' <span class="badge" style="background:#c62828;color:#fff">UNPAID</span>' : "") +
        (test ? ' <span style="background:#c9a227;color:#0b1f3a;border-radius:6px;padding:1px 6px;font-size:12px">TEST</span>' : "") + "</h3>" +
        '<p class="meta">' + lines.join("<br>") + (p.updatedAt ? '<br><span style="opacity:.7">Updated ' + esc(fmtClock(p.updatedAt)) + "</span>" : "") + "</p>" +
        (btns.length ? '<div class="pay-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' + btns.join("") + "</div>" : "") +
        "</div>";
    }).join("");
  }

  function payWorkerPost(path, body) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
    return fetch(PAY_WORKER + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (timer) clearTimeout(timer);
        if (!res.ok || !data || data.ok === false) {
          var e = new Error((data && data.error) || ("Payment server error " + res.status));
          e.status = res.status;
          throw e;
        }
        return data;
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw new Error(err && err.name === "AbortError" ? "Payment server timed out" : "Payment server unreachable");
    });
  }

  function isSandboxPay(code) {
    var p = (state.payments || {})[code];
    return !!(p && String(p.env || "").toLowerCase() === "sandbox");
  }

  function setPayNotice(text) {
    state.payNotice = text || "";
    var pl = document.getElementById("payments-list");
    if (pl) {
      var html = paymentsPanelHtml();
      pl.innerHTML = html;
      pl.setAttribute("data-html-sig", String(html.length) + ":" + hashStr(html));
      pl.removeAttribute("data-bound");
      bindPaymentActions();
    }
  }

  function afterPayAction(code, msg) {
    delete state.payBusy[code];
    delete state.payRides[code];
    setPayNotice(msg);
    refresh();
  }

  function chargeFareNow(code, cents) {
    if (!code || state.payBusy[code]) return;
    var p = (state.payments || {})[code] || {};
    if (!window.confirm("Charge " + (p.name || "the rider") + "'s saved card " + fmtCents(cents) + " now (fare, no tip)?")) return;
    state.payBusy[code] = true;
    setPayNotice("Charging " + code + "…");
    var body = { rideCode: code, tipCents: 0, expectedCents: Number(cents) || 0, by: "god" };
    if (isSandboxPay(code)) body.sandbox = true;
    payWorkerPost("/charge", body).then(function (d) {
      afterPayAction(code, d.already ? code + ": already paid." : code + ": charged " + fmtCents(d.totalCents || d.amountCents || cents) + ".");
    }).catch(function (err) {
      afterPayAction(code, code + ": charge failed — " + ((err && err.message) || "error"));
    });
  }

  function chargeCancelFeeNow(code) {
    if (!code || state.payBusy[code]) return;
    if (!window.confirm("Charge the cancel fee for " + code + " to the saved card?\n\nOnly allowed if the driver was within 1 mile of the pickup when the rider cancelled. The payment server checks this.")) return;
    state.payBusy[code] = true;
    setPayNotice("Charging cancel fee " + code + "…");
    var body = { rideCode: code, by: "god", requireFee: true };
    if (isSandboxPay(code)) body.sandbox = true;
    payWorkerPost("/cancel-fee", body).then(function (d) {
      afterPayAction(code, code + ": cancel fee " + (d.already ? "already charged." : "charged " + fmtCents(d.amountCents) + "."));
    }).catch(function (err) {
      var msg = (err && err.message) || "error";
      afterPayAction(code, code + (/^Free cancel/i.test(msg) ? ": not charged — " : ": cancel fee failed — ") + msg);
    });
  }

  function ensurePayPopupStyle() {
    if (document.getElementById("god-pay-popup-style")) return;
    var st = document.createElement("style");
    st.id = "god-pay-popup-style";
    st.textContent =
      "#god-pay-popup{position:fixed;inset:0;z-index:12500;background:rgba(5,14,28,.92);display:flex;align-items:center;justify-content:center;padding:16px}" +
      "#god-pay-popup .pp-card{background:#0b1c33;color:#fff;border:2px solid #f0d48a;border-radius:18px;max-width:440px;width:100%;padding:20px}" +
      "#god-pay-popup h2{color:#f0d48a;margin:0 0 10px;font-size:22px}" +
      "#god-pay-popup label{display:block;margin:12px 0 4px;color:#f0d48a;font-size:12px;letter-spacing:.08em;text-transform:uppercase}" +
      "#god-pay-popup input{width:100%;box-sizing:border-box;font-size:18px;padding:10px;border-radius:10px;border:1px solid #4a5d78;background:#071426;color:#fff}" +
      "#god-pay-popup .pp-actions{display:flex;gap:10px;margin-top:16px}" +
      "#god-pay-popup .pp-actions button{flex:1;font-size:17px;font-weight:800;padding:14px 10px;border-radius:12px;border:0;color:#fff;cursor:pointer}" +
      "#god-pay-popup .pp-go{background:#8a2323}#god-pay-popup .pp-cancel{background:#345}" +
      "#god-pay-popup .pp-err{color:#ff8a8a;min-height:1.2em;margin:10px 0 0}";
    document.head.appendChild(st);
  }

  function closeRefundPopup() {
    var el = document.getElementById("god-pay-popup");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* Refund: amount (default = everything not yet refunded) + God password. The Worker hashes the password and
     compares it with its secret; nothing is saved here. */
  function openRefundPopup(code, purpose, leftCents) {
    closeRefundPopup();
    ensurePayPopupStyle();
    var p = (state.payments || {})[code] || {};
    var left = Number(leftCents) || 0;
    var el = document.createElement("div");
    el.id = "god-pay-popup";
    el.innerHTML = '<div class="pp-card" role="dialog" aria-modal="true" aria-labelledby="pp-title">' +
      '<h2 id="pp-title">Refund ' + esc(purpose === "cancel" ? "cancel fee" : "payment") + " · " + esc(code) + "</h2>" +
      '<p class="meta">' + esc(p.name || "Rider") + " · up to " + esc(fmtCents(left)) + " can be refunded" +
      (String(p.env || "") === "sandbox" ? " (TEST)" : "") + ".</p>" +
      '<label for="pp-amount">Amount ($)</label>' +
      '<input id="pp-amount" type="text" inputmode="decimal" autocomplete="off" value="' + esc((left / 100).toFixed(2)) + '">' +
      '<label for="pp-password">God password</label>' +
      '<input id="pp-password" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<p class="pp-err" id="pp-err" role="alert"></p>' +
      '<div class="pp-actions"><button type="button" class="pp-cancel" id="pp-cancel">Cancel</button>' +
      '<button type="button" class="pp-go" id="pp-go">Refund</button></div></div>';
    document.body.appendChild(el);
    var pw = document.getElementById("pp-password");
    if (pw) pw.focus();
    document.getElementById("pp-cancel").addEventListener("click", closeRefundPopup);
    function go() {
      var errEl = document.getElementById("pp-err");
      var amtRaw = String((document.getElementById("pp-amount") || {}).value || "").replace(/[$,\s]/g, "");
      var pwd = String((document.getElementById("pp-password") || {}).value || "");
      var cents = Math.round(parseFloat(amtRaw) * 100);
      if (!isFinite(cents) || cents <= 0) { errEl.textContent = "Enter an amount."; return; }
      if (cents > left) { errEl.textContent = "Most you can refund is " + fmtCents(left) + "."; return; }
      if (!pwd) { errEl.textContent = "Enter the God password."; return; }
      var btn = document.getElementById("pp-go");
      btn.disabled = true;
      btn.textContent = "Refunding…";
      errEl.textContent = "";
      state.payBusy[code] = true;
      var body = { rideCode: code, purpose: purpose, amountCents: cents, godPassword: pwd, reason: "PCS God mode refund" };
      if (isSandboxPay(code)) body.sandbox = true;
      payWorkerPost("/refund", body).then(function (d) {
        closeRefundPopup();
        afterPayAction(code, code + ": refunded " + fmtCents(d.amountCents) + " (" + String(d.status || "pending").toLowerCase() + ").");
      }).catch(function (err) {
        delete state.payBusy[code];
        btn.disabled = false;
        btn.textContent = "Refund";
        errEl.textContent = err && err.status === 403 ? "Wrong God password." : (err && err.message) || "Refund failed.";
      });
    }
    document.getElementById("pp-go").addEventListener("click", go);
    pw.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  function hashStr(t) {
    var h = 0;
    for (var i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
    return h;
  }

  function bindPaymentActions() {
    var root = document.getElementById("payments-list");
    if (!root || root.getAttribute("data-bound") === "1") return;
    root.setAttribute("data-bound", "1");
    Array.prototype.forEach.call(root.querySelectorAll(".pay-refund-btn"), function (btn) {
      btn.addEventListener("click", function () {
        openRefundPopup(btn.getAttribute("data-code"), btn.getAttribute("data-purpose"), Number(btn.getAttribute("data-left")) || 0);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll(".pay-charge-btn"), function (btn) {
      btn.addEventListener("click", function () {
        chargeFareNow(btn.getAttribute("data-code"), Number(btn.getAttribute("data-cents")) || 0);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll(".pay-cancelfee-btn"), function (btn) {
      btn.addEventListener("click", function () { chargeCancelFeeNow(btn.getAttribute("data-code")); });
    });
  }

  function bindBookingActions() {
    var roots = [document.getElementById("rides-list"), document.getElementById("booking-alert"), document.getElementById("root")].filter(Boolean);
    function eachBtn(sel, fn) {
      var seen = {};
      roots.forEach(function (root) {
        Array.prototype.forEach.call(root.querySelectorAll(sel), function (btn) {
          var code = btn.getAttribute("data-ride-code") || btn.id || Math.random();
          var key = sel + "|" + code + "|" + (btn.textContent || "");
          if (seen[key]) return;
          seen[key] = true;
          fn(btn);
        });
      });
    }
    eachBtn(".btn-approve-booking", function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-ride-code");
        if (!code) return;
        btn.disabled = true;
        approveBooking(code).then(function () {
          btn.disabled = false;
          refresh();
        });
      });
    });
    eachBtn(".btn-deny-booking", function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-ride-code");
        if (!code) return;
        if (!window.confirm("Deny booking " + code + "? The rider will see it as denied.")) return;
        btn.disabled = true;
        denyBooking(code).then(function () {
          btn.disabled = false;
          refresh();
        });
      });
    });
    eachBtn(".btn-card-ok", function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-ride-code");
        if (!code) return;
        if (!window.confirm("Mark the card OK for ride " + code + "? Do this after the rider pays or adds a card through your Square link.")) return;
        btn.disabled = true;
        markCardOk(String(code).toUpperCase()).then(function (wasPending) {
          state.actionNotice = "Card marked OK for " + code + " — the rider now gets their PIN." +
            (wasPending ? " Booking approved too, so drivers can accept it now." : "");
        }).catch(function () {
          state.actionNotice = "Could not update the card status for " + code + ".";
        }).then(function () {
          btn.disabled = false;
          refresh();
        });
      });
    });
    var notifyBtn = document.getElementById("enable-booking-notify");
    if (notifyBtn) {
      notifyBtn.addEventListener("click", function () {
        requestDesktopNotify("PCS bookings", "Browser alerts enabled for pending bookings.");
      });
    }
  }

  function renderLogin() {
    return (
      '<div class="login-wrap">' +
        '<form class="login-card" id="god-login" autocomplete="username">' +
          '<p class="eyebrow">Private Car Services</p>' +
          "<h1>PCS God mode</h1>" +
          '<p class="lede">Owner console. Drivers, riders, and live trips — for you only.</p>' +
          '<div class="field">' +
            '<label for="god-email">Email</label>' +
            '<input id="god-email" name="email" type="email" inputmode="email" autocomplete="username" required value="' + esc(state.emailInput) + '">' +
          "</div>" +
          '<div class="field">' +
            '<label for="god-password">Password</label>' +
            /* Real private password comes next — nothing secret is stored in this file. */
            '<input id="god-password" name="password" type="password" autocomplete="current-password" required value="">' +
          "</div>" +
          '<p class="login-error" id="god-login-error">' + esc(state.loginError) + "</p>" +
          '<button class="btn btn-gold" type="submit">Enter God mode</button>' +
          '<p class="login-note">Business line: <a href="' + businessCallHref() + '" style="color:var(--gold-2)">936-261-7878</a></p>' +
        "</form>" +
      "</div>"
    );
  }


  function dayBoardHtml() {
    var rows = upcomingCalendarRides();
    var drivers = approvedDriversForAssign();
    var notice = state.boardNotice
      ? '<p class="board-notice">' + esc(state.boardNotice) + "</p>"
      : "";
    var err = "";
    if (state.calendarError === "denied") {
      err = '<p class="empty">Calendar hub /rides/' + esc(CALENDAR_HUB) + " cannot be read (permission denied). Sync routine + rules needed.</p>";
    } else if (state.calendarError) {
      err = '<p class="empty">Could not load scheduled rides.</p>';
    }
    var hintBody = (
      '<p class="day-board-hint">Shows Google Calendar events whose <strong>title starts with PCS</strong> (example: <em>PCS – John Smith</em>). ' +
      "Pickup = event Location. Drop-off = a <code>Drop-off:</code> or <code>To:</code> line in the notes, else the whole notes. " +
      "Wall-TV friendly. Assign an approved driver; they see it on their app. Completing credits Mon–Sun commission.</p>"
    );
    var emptyNote = (!rows.length && !err)
      ? '<p class="empty">No upcoming PCS-titled rides in the hub yet. Title calendar events with <strong>PCS</strong> and run the calendar sync routine.</p>'
      : "";
    var howBlock = (
      '<details class="board-how"' + (state.showBoardHow ? " open" : "") + ' id="board-how">' +
        "<summary>How this works</summary>" +
        hintBody +
        emptyNote +
      "</details>"
    );
    if (!rows.length && !err) {
      return (
        '<section class="day-board" id="day-board">' +
        "<h2>Scheduled rides</h2>" +
        howBlock + notice +
        "</section>"
      );
    }
    var cards = rows.map(function (r) {
      var st = r.status || "open";
      var badge = st === "completed"
        ? '<span class="badge">Done</span>'
        : (st === "assigned"
          ? '<span class="badge online">Assigned</span>'
          : '<span class="badge pending">Open</span>');
      var options = ['<option value="">Assign driver…</option>'].concat(drivers.map(function (d) {
        var sel = d.id === r.assignedDriverId ? " selected" : "";
        return '<option value="' + esc(d.id) + '"' + sel + ">" + esc(d.name || d.id) + "</option>";
      }));
      var fareVal = state.fareDrafts[r.id] != null
        ? state.fareDrafts[r.id]
        : (r.fareBeforeTax != null ? String(r.fareBeforeTax) : "");
      var assignDisabled = st === "completed" ? " disabled" : "";
      var completeDisabled = (st === "completed" || !r.assignedDriverId) ? " disabled" : "";
      return (
        '<article class="day-card status-' + esc(st) + '">' +
          '<div class="day-card-top">' +
            '<p class="day-time">' + esc(fmtBoardWhen(r.start)) + "</p>" +
            badge +
          "</div>" +
          '<h3 class="day-rider">' + esc(r.rider) + "</h3>" +
          '<p class="day-line"><span>Pickup</span> ' + esc(r.pickup || "—") + "</p>" +
          '<p class="day-line"><span>Drop-off</span> ' + esc(r.dropoff || "—") + "</p>" +
          (r.assignedDriverName
            ? '<p class="day-line"><span>Driver</span> ' + esc(r.assignedDriverName) + "</p>"
            : "") +
          (st === "completed"
            ? '<p class="day-line"><span>Commission</span> ' + esc(fmtCents(r.commissionCents)) + "</p>"
            : (
              '<div class="day-actions">' +
                '<label class="sr-only" for="assign-' + esc(r.id) + '">Assign driver</label>' +
                '<select id="assign-' + esc(r.id) + '" class="day-assign" data-event-id="' + esc(r.id) + '"' + assignDisabled + ">" +
                  options.join("") +
                "</select>" +
                '<button type="button" class="btn btn-gold btn-assign-ride" data-event-id="' + esc(r.id) + '"' + assignDisabled + ">Assign</button>" +
                '<label class="fare-label" for="fare-' + esc(r.id) + '">Fare before tax $</label>' +
                '<input id="fare-' + esc(r.id) + '" class="day-fare" data-event-id="' + esc(r.id) + '" type="number" min="0" step="0.01" value="' + esc(fareVal) + '"' + completeDisabled + ">" +
                '<button type="button" class="btn btn-ghost btn-complete-ride" data-event-id="' + esc(r.id) + '"' + completeDisabled + ">Complete + credit</button>" +
              "</div>"
            )) +
        "</article>"
      );
    }).join("");
    return (
      '<section class="day-board" id="day-board">' +
        "<h2>Scheduled rides</h2>" +
        howBlock + notice + err +
        '<div class="day-grid">' + cards + "</div>" +
      "</section>"
    );
  }

  function renderBoard() {
    return (
      '<div class="shell">' +
        '<header class="topbar">' +
          "<div>" +
            '<p class="eyebrow">Private Car Services</p>' +
            "<h1>PCS God mode</h1>" +
            '<p class="who">' + esc(state.sessionEmail) + "</p>" +
          "</div>" +
          '<div class="top-actions">' +
            '<p class="status-pill" id="refresh-pill">' + esc(statusPillText()) + "</p>" +
            '<button type="button" class="btn btn-gold" id="god-push-btn">' + (state.pushOn ? "\uD83D\uDD14 Phone alerts: ON" : "\uD83D\uDD14 Turn on phone alerts") + "</button>" +
            '<button type="button" class="btn btn-ghost" id="god-logout">Sign out</button>' +
          "</div>" +
        "</header>" +
        dayBoardHtml() +
        '<div class="workspace">' +
          '<aside class="side">' +
            '<section class="side-section">' +
              "<h2>Drivers</h2>" +
              hireBlockHtml() +
              '<div id="drivers-list">' + driversPanelHtml() + "</div>" +
            "</section>" +
            '<section class="side-section">' +
              "<h2>Riders &amp; trips</h2>" +
              '<div id="rides-list">' + ridesPanelHtml() + "</div>" +
            "</section>" +
            '<section class="side-section" id="payments-section">' +
              "<h2>Payments</h2>" +
              '<div id="payments-list">' + paymentsPanelHtml() + "</div>" +
            "</section>" +
          "</aside>" +
          '<div class="map-pane">' +
            '<div id="god-map" role="presentation"></div>' +
            '<div class="map-focus-bar" id="map-focus-bar" hidden>' +
              '<span id="map-focus-label"></span>' +
              '<button type="button" class="btn btn-ghost" id="map-show-all" hidden>Show everyone</button>' +
            "</div>" +
            '<p class="map-hint">Car = free driver · Person = requesting rider · Car+person = on a trip (route highlighted) · Tap a driver name to find them</p>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function bindDriverActions() {
    var list = document.getElementById("drivers-list");
    if (!list || list.dataset.bound === "1") {
      /* Always rebind fresh nodes after innerHTML replace. */
    }
    if (!list) return;

    Array.prototype.forEach.call(list.querySelectorAll("details.driver-card"), function (el) {
      el.addEventListener("toggle", function () {
        var id = el.getAttribute("data-driver-id");
        if (!id) return;
        if (el.open) state.expandedDrivers[id] = true;
        else delete state.expandedDrivers[id];
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".commission-input"), function (input) {
      input.addEventListener("input", function () {
        var id = input.getAttribute("data-driver-id");
        if (!id) return;
        state.commissionDrafts[id] = input.value;
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".btn-save-comm"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-driver-id");
        if (!id) return;
        var input = document.getElementById("comm-" + id);
        var raw = input ? input.value : state.commissionDrafts[id];
        btn.disabled = true;
        saveCommission(id, raw).then(function () {
          btn.disabled = false;
          renderBoardLists();
          syncMap();
        });
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".btn-fire"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-driver-id");
        if (!id) return;
        var name = (state.roster[id] && state.roster[id].name) || id;
        if (!window.confirm("Fire " + name + "? They will be marked inactive and removed from live presence.")) return;
        btn.disabled = true;
        fireDriver(id).then(function () {
          btn.disabled = false;
          renderBoardLists();
          syncMap();
        });
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".btn-rehire"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-driver-id");
        if (!id) return;
        btn.disabled = true;
        rehireDriver(id).then(function () {
          btn.disabled = false;
          renderBoardLists();
          syncMap();
        });
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".btn-approve"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-driver-id");
        if (!id) return;
        btn.disabled = true;
        approveDriver(id).then(function () {
          btn.disabled = false;
          renderBoardLists();
          syncMap();
        });
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".btn-reject"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-driver-id");
        if (!id) return;
        var name = (state.roster[id] && state.roster[id].name) || id;
        if (!window.confirm("Reject " + name + "? They will stay locked out until approved.")) return;
        btn.disabled = true;
        rejectDriver(id).then(function () {
          btn.disabled = false;
          renderBoardLists();
          syncMap();
        });
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".btn-open-driver"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-driver-id");
        if (!id) return;
        state.selectedDriverId = id;
        state.driverDetailDay = chicagoToday();
        renderBoardLists();
      });
    });

    var closeDetail = document.getElementById("close-driver-detail");
    if (closeDetail) {
      closeDetail.addEventListener("click", function () {
        state.selectedDriverId = "";
        state.driverDetailDay = "";
        renderBoardLists();
      });
    }
    var weekPrev = document.getElementById("detail-week-prev");
    if (weekPrev) {
      weekPrev.addEventListener("click", function () {
        var mon = mondayOfWeek(state.driverDetailDay || chicagoToday());
        state.driverDetailDay = addDaysYmd(mon, -7);
        renderBoardLists();
      });
    }
    var weekNext = document.getElementById("detail-week-next");
    if (weekNext) {
      weekNext.addEventListener("click", function () {
        var mon = mondayOfWeek(state.driverDetailDay || chicagoToday());
        state.driverDetailDay = addDaysYmd(mon, 7);
        renderBoardLists();
      });
    }
    Array.prototype.forEach.call(list.querySelectorAll("[data-detail-day]"), function (btn) {
      btn.addEventListener("click", function () {
        state.driverDetailDay = btn.getAttribute("data-detail-day") || chicagoToday();
        renderBoardLists();
      });
    });
  }

  function refreshHireBlock() {
    var tuck = document.getElementById("hire-tuck");
    if (!tuck) return;
    var fresh = document.createElement("div");
    fresh.innerHTML = hireBlockHtml();
    var next = fresh.firstChild;
    if (next) {
      tuck.replaceWith(next);
      bindHireForm();
    }
  }

  function bindHireForm() {
    var toggle = document.getElementById("toggle-hire");
    if (toggle) {
      toggle.addEventListener("click", function () {
        state.showHireForm = !state.showHireForm;
        refreshHireBlock();
      });
    }
    var form = document.getElementById("hire-form");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var nameEl = document.getElementById("hire-name");
      var phoneEl = document.getElementById("hire-phone");
      var emailEl = document.getElementById("hire-email");
      var pctEl = document.getElementById("hire-pct");
      state.hireName = nameEl ? nameEl.value : "";
      state.hirePhone = phoneEl ? phoneEl.value : "";
      state.hireEmail = emailEl ? emailEl.value : "";
      state.hirePct = pctEl ? pctEl.value : String(DEFAULT_COMMISSION_PCT);
      hireDriver().then(function (ok) {
        if (ok) {
          state.showHireForm = false;
          refreshHireBlock();
          renderBoardLists();
        } else {
          var err = document.getElementById("hire-error");
          if (err) err.textContent = state.hireError;
        }
      });
    });
  }

  function bind() {
    var form = document.getElementById("god-login");
    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var emailEl = document.getElementById("god-email");
        var passEl = document.getElementById("god-password");
        state.emailInput = emailEl ? emailEl.value : "";
        state.passwordInput = passEl ? passEl.value : "";
        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        tryLogin(state.emailInput, state.passwordInput).then(function (ok) {
          if (submitBtn) submitBtn.disabled = false;
          if (ok) {
            render();
            startPoll();
          } else {
            var err = document.getElementById("god-login-error");
            if (err) err.textContent = state.loginError;
          }
        });
      });
    }
    var out = document.getElementById("god-logout");
    if (out) {
      out.addEventListener("click", function () { logout(); });
    }
    var pushBtn = document.getElementById("god-push-btn");
    if (pushBtn) pushBtn.addEventListener("click", function () { openPushPopup(); });
    var showAll = document.getElementById("map-show-all");
    if (showAll) {
      showAll.addEventListener("click", function () { clearFocus(); });
    }
    bindHireForm();
    bindDriverActions();
    bindBookingActions();
    bindPaymentActions();
    bindSafetyActions();
    bindLocateActions();
    bindDayBoardActions();
    bindOwnerRideActions();
  }

  function render() {
    var root = document.getElementById("root");
    if (!root) return;
    if (state.screen === "login") {
      stopPoll();
      tearMap();
      root.innerHTML = renderLogin();
      bind();
      return;
    }
    root.innerHTML = renderBoard();
    bind();
    ensureMap();
    syncMap();
    setFocusBar();
  }

  function boot() {
    installGodAlarm(); /* v64g: every tap unlocks sound (iOS); gold bar until the alarm really played once */
    if (isStandaloneApp() || (pushSupported() && Notification.permission === "granted")) registerGodSW().then(checkPushOn);
    clearLegacySession(); /* drop pre-v24 sessionStorage/localStorage authOk junk */
    state.screen = "login";
    restoreSession().then(function (email) {
      if (email) {
        state.sessionEmail = email;
        state.screen = "board";
        render();
        startPoll();
        return;
      }
      render();
    });

    /* Coming back from another app (iOS PWA): refresh immediately instead of showing stale data. */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || state.screen !== "board") return;
      if (map) setTimeout(function () { if (map) map.invalidateSize(); }, 60);
      startPoll();
    });
    window.addEventListener("pageshow", function (ev) {
      if (ev && ev.persisted && state.screen === "board") startPoll();
    });
    /* v64g: iPad split view / window focus and network back also re-check at once (not more than every 2 s). */
    var lastKick = 0;
    function foregroundKick() {
      if (state.screen !== "board" || document.visibilityState === "hidden") return;
      if (Date.now() - lastKick < 2000) return;
      lastKick = Date.now();
      startPoll();
    }
    window.addEventListener("focus", foregroundKick);
    window.addEventListener("online", foregroundKick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.__pcsGod = {
    showGodPendingPopup: showGodPendingPopup,
    showGodAcceptPopup: showGodAcceptPopup,
    maybeShowGodPopups: maybeShowGodPopups,
    pruneGodPopups: pruneGodPopups,
    alarmInfo: function () { return godAlarm.info(); },
    alarmWanted: alarmWanted,
    popupQueue: function () { return godPopupQueue.map(function (it) { return it.key; }); },
    streamState: function () { return rideStream ? rideStream.readyState : -1; },
    lastStreamEventAt: function () { return lastStreamEventAt; },
    chimeUrl: function () { return GOD_CHIME_URL; },
    openPushPopup: openPushPopup,
    turnOnPush: turnOnPush,
    openRideFromAlert: openRideFromAlert,
    cancelRideByOwner: cancelRideByOwner,
    presenceOf: presenceOf,
    shiftLinesHtml: shiftLinesHtml,
    drivers: function () { return (state.drivers || []).map(function (d) { return { id: d.id, presence: d.presence, lastSeenAt: d.lastSeenAt }; }); },
    refundChoices: refundChoices,
    listSafetyAlerts: listSafetyAlerts,
    showSafetyPopup: showSafetyPopup,
    safetyBannerHtml: safetyBannerHtml,
    highSafetyAlerts: highSafetyAlerts,
    bookingAlertBannerHtml: bookingAlertBannerHtml,
    approveBooking: approveBooking,
    denyBooking: denyBooking,
    markCardOk: markCardOk,
    paymentsPanelHtml: paymentsPanelHtml,
    ridePayLineHtml: ridePayLineHtml,
    openRefundPopup: openRefundPopup,
    chargeFareNow: chargeFareNow,
    payState: state
  };
})();
