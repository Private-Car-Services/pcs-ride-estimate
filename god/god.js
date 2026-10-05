/* Private Car Services — PCS God mode (Matthew only). Local preview. Do not publish. */
(function () {
  "use strict";

  var DATABASE_URL = "https://pts-maps-rides-default-rtdb.firebaseio.com";
  var PRESENCE_HUB = "AVLBLDRV";
  var OPEN_HUB = "REQUESTS";
  /* Roster + commission hub: 8-char ride-code alphabet (no I/O/0/1). DRVRCOMM has O — use DRVRCMMS. */
  var ROSTER_HUB = "DRVRCMMS";
  /* Miles hub: 8-char alphabet (no I/O). DRVRMILZ wrongly contained I — use DRVRMLES. */
  var MILES_HUB = "DRVRMLES";
  var HISTORY_HUB = "DRVRHSTY"; /* completed ride logs; 8-char no I/O */
  var DEFAULT_COMMISSION_PCT = 70;
  var SESSION_KEY = "pcs-god-session";
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
    pendingBanner: ""
  };

  var map = null;
  var markerLayer = null;
  var routeLayer = null;
  var pollTimer = null;
  var mapReady = false;

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
    entries.forEach(function (e) {
      rideTotal += Number(e.fareTotal) || 0;
      commissionTotal += Number(e.commissionCents) || 0;
    });
    return { rideTotal: rideTotal, commissionTotal: commissionTotal, count: entries.length };
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

  function sessionStore() {
    try { return window.sessionStorage; } catch (err) { return null; }
  }

  function readSession() {
    try {
      var store = sessionStore();
      if (!store) return null;
      var raw = store.getItem(SESSION_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || normalizeEmail(data.email) !== OWNER_EMAIL) return null;
      if (!data.authOk) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function writeSession(email) {
    try {
      var store = sessionStore();
      if (!store) return;
      store.setItem(SESSION_KEY, JSON.stringify({
        email: normalizeEmail(email),
        authOk: true,
        at: Date.now()
      }));
    } catch (err) {}
  }

  function clearSession() {
    try {
      var store = sessionStore();
      if (store) store.removeItem(SESSION_KEY);
    } catch (err) {}
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
      writeSession(e);
      state.sessionEmail = e;
      state.screen = "board";
      state.loginError = "";
      return true;
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
    stopPoll();
    tearMap();
    render();
  }

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
        var cutoff = Date.now() - ONLINE_MS;
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

  function approveBooking(code) {
    code = String(code || "").toUpperCase();
    if (!code) return Promise.resolve(false);
    return getRide(code).then(function (ride) {
      if (!ride) throw new Error("missing");
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
        return putOpenSummary(code, next);
      }).then(function () {
        state.actionNotice = "Approved booking " + code + " — drivers can accept it now.";
        state.pendingBanner = "";
        return true;
      });
    }).catch(function () {
      state.actionNotice = "Could not approve booking " + code + ".";
      return false;
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
      if (Notification.permission === "granted") show();
      else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(function (p) { if (p === "granted") show(); });
      }
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
    return (
      '<div class="card booking-alert" id="booking-alert" style="border:2px solid var(--gold);margin:0 0 12px;padding:12px;background:#1a2e1a">' +
      '<p class="tag">New booking needs your OK</p>' +
      '<p class="lede"><strong>' + esc(String(pending.length)) + '</strong> pending · ' + esc(label) + "</p>" +
      '<p class="fine">Approve so drivers can see it. Deny notifies the rider in-app.</p>' +
      '<div class="row-actions" style="display:flex;flex-wrap:wrap;gap:8px">' +
      '<a class="btn btn-ghost" href="' + mail + '">Email me a reminder</a>' +
      '<a class="btn btn-ghost" href="' + sms + '">Text reminder</a>' +
      '<button type="button" class="btn btn-ghost" id="enable-booking-notify">Enable browser alerts</button>' +
      "</div></div>"
    );
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
    /* Commission of fare before tax when known. Never invent a fare. */
    var ride = matchDriverToRide(driver, rides);
    if (!ride) return { label: "No trip revenue recorded yet", amount: null };
    var fare = ride.fareBeforeTax;
    if (fare === null || fare === undefined || fare === "" || !isFinite(+fare)) {
      /* Fall back to estimatedTotal only for display note — commission still needs before-tax. */
      var totalOnly = fmtMoney(ride.estimatedTotal);
      if (totalOnly) {
        return { label: totalOnly + " trip total (no before-tax fare yet)", amount: null };
      }
      return { label: "No trip revenue recorded yet", amount: null };
    }
    var pct = commissionPctFor(driver.id);
    var share = Number(fare) * (pct / 100);
    var money = fmtMoney(share);
    if (!money) return { label: "No trip revenue recorded yet", amount: null };
    return {
      label: money + " · " + pct + "% of " + fmtMoney(fare) + " before tax",
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

    Promise.all([rosterP, driversP, ridesP, milesP, historyP]).then(function () {
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
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll() {
    stopPoll();
    refresh();
    pollTimer = setInterval(refresh, POLL_MS);
  }

  function tearMap() {
    if (map) {
      try { map.remove(); } catch (e) {}
    }
    map = null;
    markerLayer = null;
    routeLayer = null;
    mapReady = false;
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

  function markerIcon(kind, label) {
    var svg = kind === "car" ? CAR_SVG : kind === "paired" ? PAIRED_SVG : PERSON_SVG;
    var cls = "god-marker" + (kind === "paired" ? " paired" : "");
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

  function syncMap() {
    if (!ensureMap()) return;
    markerLayer.clearLayers();
    routeLayer.clearLayers();

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
        window.L.marker([lat, lng], {
          icon: markerIcon("paired", label),
          zIndexOffset: 700
        }).addTo(markerLayer);
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
      window.L.marker(here, {
        icon: markerIcon("car", freeLabel),
        zIndexOffset: 500
      }).addTo(markerLayer);
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

    if (bounds.length >= 2) {
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
    entries.forEach(function (e) {
      dayRide += Number(e.fareTotal) || 0;
      dayComm += Number(e.commissionCents) || 0;
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
          "<h3>" + esc(e.code || "Ride") + "</h3>" +
          '<p class="meta">' +
          "<strong>Rider</strong> " + esc(e.riderName || "—") + "<br>" +
          "<strong>Route</strong> " + esc(e.pickup || "") + " → " + esc(e.drop || "") + "<br>" +
          "<strong>Ride total</strong> " + esc(fmtCents(e.fareTotal)) + "<br>" +
          "<strong>Commission</strong> " + esc(fmtCents(e.commissionCents)) +
          " (" + esc(String(e.commissionPct || "")) + "%)" +
          (e.billedMiles != null ? "<br><strong>Miles</strong> " + esc(String(e.billedMiles)) : "") +
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
      "<strong>Pay week</strong> Mon–Sun · " + esc(monday) + " → " + esc(addDaysYmd(monday, 6)) +
      "</p>" +
      '<div class="cal-week">' +
      '<button type="button" class="btn btn-ghost" id="detail-week-prev">←</button>' +
      cal +
      '<button type="button" class="btn btn-ghost" id="detail-week-next">→</button>' +
      "</div>" +
      '<p class="meta"><strong>' + esc(day) + "</strong> · ride " + esc(fmtCents(dayRide)) +
      " · commission " + esc(fmtCents(dayComm)) + "</p>" +
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
        else if (trip) badge = '<span class="badge on-trip">On trip</span>';
        else if (d.online) badge = '<span class="badge">Online · free</span>';
        else badge = '<span class="badge off">Approved · offline</span>';
        var where = isCoord(d.lat) && isCoord(d.lng)
          ? (+d.lat).toFixed(4) + ", " + (+d.lng).toFixed(4)
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
            " · GPS " + esc(gps) + " mi · end " + esc(end) + "</li>";
        }).filter(Boolean);
        var cardClass = "card";
        if (trip) cardClass += " paired";
        if (!d.active) cardClass += " fired";
        return (
          '<article class="' + cardClass + '" data-driver-id="' + esc(d.id) + '">' +
            "<h3>" + esc(displayName(d.name, "Driver")) + badge + "</h3>" +
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
          "</article>"
        );
      }).join(""));
    }
    parts.push('<p class="action-notice" id="drivers-action-notice">' + esc(state.actionNotice) + "</p>");
    return parts.join("");
  }

  function ridesPanelHtml() {
    if (state.ridesError === "denied") {
      return '<p class="empty">Open ride requests cannot be read (permission denied). No riders invented.</p>';
    }
    if (state.ridesError) {
      return '<p class="empty">Could not load ride requests. Showing none.</p>';
    }
    if (!state.rides.length) {
      return bookingAlertBannerHtml() + '<p class="empty">No riders requesting a ride right now.</p>';
    }
    var cards = state.rides.map(function (r) {
      var active = isActiveTrip(r);
      var pending = isPendingOwner(r);
      var denied = String(r.status || "").toLowerCase() === "denied";
      var requestAt = r.updatedAt || r.requestedAt || r.createdAt || null;
      var pickupWhen = fmtWhen(r.date, r.time, r);
      var dropWhen = r.dropTime || r.dropoffTime || r.etaDrop || null;
      if (!dropWhen) dropWhen = "—";
      var badge = active
        ? '<span class="badge on-trip">' + esc(r.status || "on trip") + "</span>"
        : (pending
          ? '<span class="badge pending">Needs your OK</span>'
          : (denied
            ? '<span class="badge">Denied</span>'
            : '<span class="badge">Open to drivers</span>'));
      var actions = pending
        ? ('<div class="commission-row" style="margin-top:8px">' +
          '<button type="button" class="btn btn-gold btn-approve-booking" data-ride-code="' + esc(r.code || "") + '">Approve booking</button>' +
          '<button type="button" class="btn btn-fire btn-deny-booking" data-ride-code="' + esc(r.code || "") + '">Deny</button>' +
          "</div>")
        : "";
      return (
        '<article class="card' + (active ? " paired" : "") + (pending ? " pending-booking" : "") + '">' +
          "<h3>" + esc(displayName(r.name, "Rider")) + badge + "</h3>" +
          '<p class="meta">' +
          "<strong>Code</strong> " + esc(r.code || "—") + "<br>" +
          "<strong>Request time</strong> " + esc(fmtClock(requestAt)) + "<br>" +
          "<strong>Wait time</strong> " + esc(waitLabel(requestAt)) + "<br>" +
          "<strong>Pickup time</strong> " + esc(pickupWhen) + "<br>" +
          "<strong>Drop-off time</strong> " + esc(String(dropWhen)) + "<br>" +
          "<strong>Pickup</strong> " + esc([r.pickupStreet, r.pickupCity, r.pickupState].filter(Boolean).join(", ") || "—") + "<br>" +
          "<strong>Drop-off</strong> " + esc([r.dropStreet, r.dropCity, r.dropState].filter(Boolean).join(", ") || "—") +
          (r.phone ? "<br><strong>Phone</strong> " + esc(r.phone) : "") +
          (active && r.driverName ? "<br><strong>Driver</strong> " + esc(r.driverName) : "") +
          "</p>" +
          actions +
        "</article>"
      );
    }).join("");
    return bookingAlertBannerHtml() + cards;
  }

  function renderBoardLists() {
    var d = document.getElementById("drivers-list");
    var r = document.getElementById("rides-list");
    if (d) d.innerHTML = driversPanelHtml();
    if (r) r.innerHTML = ridesPanelHtml();
    bindDriverActions();
    bindBookingActions();
  }

  function bindBookingActions() {
    var list = document.getElementById("rides-list");
    if (!list) return;
    Array.prototype.forEach.call(list.querySelectorAll(".btn-approve-booking"), function (btn) {
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
    Array.prototype.forEach.call(list.querySelectorAll(".btn-deny-booking"), function (btn) {
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
            '<button type="button" class="btn btn-ghost" id="god-logout">Sign out</button>' +
          "</div>" +
        "</header>" +
        '<div class="workspace">' +
          '<aside class="side">' +
            '<section class="side-section">' +
              "<h2>Drivers</h2>" +
              hireFormHtml() +
              '<div id="drivers-list">' + driversPanelHtml() + "</div>" +
            "</section>" +
            '<section class="side-section">' +
              "<h2>Riders &amp; trips</h2>" +
              '<div id="rides-list">' + ridesPanelHtml() + "</div>" +
            "</section>" +
          "</aside>" +
          '<div class="map-pane">' +
            '<div id="god-map" role="presentation"></div>' +
            '<p class="map-hint">Car = free driver · Person = requesting rider · Car+person = on a trip (route highlighted)</p>' +
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

  function bindHireForm() {
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
          /* Re-render hire form cleared + list */
          var side = form.parentNode;
          if (side) {
            var fresh = document.createElement("div");
            fresh.innerHTML = hireFormHtml();
            var newForm = fresh.firstChild;
            side.replaceChild(newForm, form);
            bindHireForm();
          }
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
    bindHireForm();
    bindDriverActions();
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
  }

  function boot() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {} /* drop pre-hash sessions */
    var session = readSession();
    if (session && session.email) {
      state.sessionEmail = normalizeEmail(session.email);
      state.screen = "board";
      render();
      startPoll();
      return;
    }
    state.screen = "login";
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
