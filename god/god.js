/* v75g (Matthew): no light-gold text on white. Secondary/ghost buttons inside any white or light card become real buttons: light fill, dark text, visible border. */
(function () { if (typeof document === "undefined") return; var st = document.createElement("style"); st.id = "pcs-v75g-contrast-god"; st.textContent = ".pcs-light-btn,[style*=\"background:#fff\"] .btn-ghost,[style*=\"background:#fff\"] .btn.ghost,[style*=\"background: #fff\"] .btn-ghost,[style*=\"background: #fff\"] .btn.ghost,[style*=\"background:#ffffff\"] .btn-ghost,[style*=\"background:#ffffff\"] .btn.ghost,[style*=\"background:white\"] .btn-ghost,[style*=\"background:white\"] .btn.ghost,.meter-qr .btn-ghost,.meter-rqr .btn-ghost"+"{background:#f3f4f6!important;color:#1a1a1a!important;-webkit-text-fill-color:#1a1a1a!important;border:2px solid #6b7280!important;border-radius:14px!important;padding:15px 16px!important;font-size:17px!important;font-weight:800!important;text-align:center!important;opacity:1}"+".pcs-light-btn:hover,.pcs-light-btn:focus-visible{background:#e5e7eb!important;color:#000!important}"; (document.head || document.documentElement).appendChild(st); })();
/* Private Car Services — PCS God mode (Matthew only). v25/v45: day board from PCS calendar + assign/commission.
   v57: visual pop-ups for every new ride request and every accept; safety alerts (police assist red banner +
   pop-up, soft not-OK notes). No sound in God mode.
   v58: Square LIVE. Payments panel (card saved / charged $X / failed / refunded / deposit / cancel fee + receipts),
   Refund button (God password re-checked by the pcs-pay Worker, never stored), Charge fare now (no tip) for a
   completed ride the rider didn't pay, Charge cancel fee. Mark card OK stays as the override.
   v72c (Oct 9): replaces v59 below: any rider cancel of a booked ride = max(25% of fare, $10); distance shown for info only.
   v59 (superseded): cancel fee only when the driver was within 1 mile of pickup (the pcs-pay Worker decides). Each cancelled ride
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
  var POLL_MS = 15000; /* v77.15: was 5 s; live changes still arrive via the ride stream (backup polls ~3x fewer) */
  var BOARD_CENTER = { lat: 30.39, lng: -95.65 };

  var CAR_SVG =
    '<svg class="nav-arrow" viewBox="0 0 40 40" width="36" height="36" aria-hidden="true">' +
    '<polygon points="20,3 34,35 20,27 6,35" fill="#2e9d4f" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>' +
    "</svg>"; /* v72u (Matthew): simple navigation arrow, PCS green + white outline, points the way the car is going */

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

  /* v73 / Worker v69.8: EVERY God-mode database write goes through the Worker (POST /god/db) with the God device token, like the
     HOS overrides: the live Firebase rules refuse unauthenticated writes. The Worker reads each write back; a refused write comes
     back as an error instead of looking saved. Older Worker without /god/db (404) -> the direct write, as before. */
  function godFakeRes(status, body) {
    return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(body == null ? "null" : JSON.stringify(body)); } };
  }
  function godWriteAuth() {
    var t = ""; try { t = gqTok(); } catch (e) {}
    if (t) return { godToken: t };
    if (typeof gq !== "undefined" && gq && gq.pw) return { godPassword: gq.pw };
    var pw = window.prompt("God password (asked once on this device) to save changes:", "");
    return pw ? { godPassword: pw } : null;
  }
  /* v77.15 (Harry must-fix): slow Worker lists (discounts, payout records, ride %, invoices, discount requests) at most
     every 60 s; any God write (godFetch non-GET) forces the next refresh to reload them. */
  var SLOW_MS = 60000, slowAt = {}, slowForce = {};
  function slowDue(k) { var n = Date.now(); if (slowForce[k] || !slowAt[k] || n - slowAt[k] >= SLOW_MS) { slowAt[k] = n; slowForce[k] = false; return true; } return false; }
  function slowKick() { slowForce.kv = true; slowForce.dr = true; slowForce.ro = true; }
  window.__pcsSlowDue = slowDue; /* test hook */
  function godFetch(url, opts) {
    opts = opts || {};
    var m = String(opts.method || "GET").toUpperCase(), root = baseUrl() + "/rides/";
    if (m !== "GET") slowKick();
    if (m === "GET" || String(url).indexOf(root) !== 0 || state.godDbOff) return fetch(url, opts);
    var path = "/rides/" + String(url).slice(root.length).split("?")[0].replace(/\.json$/, "").split("/").map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } }).join("/");
    var auth = godWriteAuth();
    if (!auth) { state.boardNotice = "Not saved: the God password is needed once on this device."; return Promise.resolve(godFakeRes(401, { ok: false, error: "God password needed." })); }
    var value; try { value = opts.body != null ? JSON.parse(opts.body) : undefined; } catch (e) { value = undefined; }
    return fetch(PAY_WORKER + "/god/db", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ ops: [{ method: m, path: path, value: value }] }, auth)) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (res.status === 404 && d && d.error === "Not found") { state.godDbOff = true; return fetch(url, opts); } /* Worker before v69.8 */
          if (d && d.godToken) { try { gqSetTok(d.godToken); gq.pw = ""; gq.tokOn = true; } catch (e) {} }
          if (res.status === 401) { try { gqSetTok(""); gq.pw = ""; } catch (e) {} }
          if (!res.ok || !d || d.ok !== true) {
            state.boardNotice = "Not saved: " + ((d && d.error) || ("server answered " + res.status));
            return godFakeRes(res.status || 502, d);
          }
          return godFakeRes(200, d.results && d.results[0] ? d.results[0].value : null);
        });
      });
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
    return ""; /* v75r: free calendar notes ("Take to Hotel Galvez") are never used as the drop-off */
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
      completedAt: raw.completedAt || null,
      source: String(raw.source || ""), sessionFlags: Array.isArray(raw.sessionFlags) ? raw.sessionFlags.map(String).slice(0, 8) : [], discountReview: "", /* r4 M4: from the Worker only (discOverlay) */ payMethod: String(raw.payMethod || ""), stops: Array.isArray(raw.stops) ? raw.stops : [], /* v72d */
      riderPhone: String(raw.riderPhone || ""), riderPhoneEdited: raw.riderPhoneEdited === true, riderPhoneSrc: String(raw.riderPhoneSrc || ""), autoText: raw.autoText !== false, /* v77.3 */ teenRider: raw.teenRider === true, teenPhone: String(raw.teenPhone || ""), extraPhoneOnce: String(raw.extraPhoneOnce || ""), /* v77.5 */ balance: raw.balance != null ? Number(raw.balance) : null,
      paidSquareCents: raw.paidSquareCents != null && isFinite(+raw.paidSquareCents) ? Math.round(+raw.paidSquareCents) : null, paidEdits: Array.isArray(raw.paidEdits) ? raw.paidEdits : [], /* v75w */
      tipCents: Number(raw.tipCents) || 0, tipVia: raw.tipVia ? String(raw.tipVia) : null, tipEdits: Array.isArray(raw.tipEdits) ? raw.tipEdits : [], /* v73 */
      cancelledAt: Number(raw.cancelledAt) || null, cancelledBy: raw.cancelledBy ? String(raw.cancelledBy) : null, cancelReason: raw.cancelReason ? String(raw.cancelReason) : null,
      cancelFee: raw.cancelFee ? String(raw.cancelFee) : null, cancelFeeStatus: raw.cancelFeeStatus ? String(raw.cancelFeeStatus) : null,
      fixedFare: raw.fixedFare === true, completedEarly: raw.completedEarly === true, /* v73 fare-save fix */
      meterReadingCents: raw.meterReadingCents != null ? Number(raw.meterReadingCents) : null, meterCode: raw.meterCode ? String(raw.meterCode) : "",
      stopsGeo: Array.isArray(raw.stopsGeo) ? raw.stopsGeo : [], dropoffEdited: raw.dropoffEdited === true, dropoffEditedBy: raw.dropoffEditedBy ? String(raw.dropoffEditedBy) : "", /* v75r */
      pickupLat: isFinite(+raw.pickupLat) && raw.pickupLat != null && raw.pickupLat !== "" ? +raw.pickupLat : null, pickupLng: isFinite(+raw.pickupLng) && raw.pickupLng != null && raw.pickupLng !== "" ? +raw.pickupLng : null,
      dropoffLat: isFinite(+raw.dropoffLat) && raw.dropoffLat != null && raw.dropoffLat !== "" ? +raw.dropoffLat : null, dropoffLng: isFinite(+raw.dropoffLng) && raw.dropoffLng != null && raw.dropoffLng !== "" ? +raw.dropoffLng : null,
      estKey: String(raw.estKey || ""), estText: String(raw.estText || ""), estLoCents: Number(raw.estLoCents) || 0, estHiCents: Number(raw.estHiCents) || 0, estBy: String(raw.estBy || ""), /* v75s */
      meterDiscount: null /* r4 M3: Firebase copy ignored; filled from the Worker (discOverlay) */, discountPct: Number(raw.discountPct) || 0,
      trip: raw.trip && typeof raw.trip === "object" ? raw.trip : null,
      prepaid: raw.prepaid === true, prepaidAmountCents: raw.prepaidAmountCents != null && isFinite(+raw.prepaidAmountCents) ? Math.round(+raw.prepaidAmountCents) : null, /* v75v prepaid (Square invoice) */
      prepaidTaxCents: raw.prepaidTaxCents != null && isFinite(+raw.prepaidTaxCents) ? Math.round(+raw.prepaidTaxCents) : null, prepaidInvoiceNo: String(raw.prepaidInvoiceNo || ""),
      rideCommissionPct: raw.rideCommissionPct != null && raw.rideCommissionPct !== "" && isFinite(+raw.rideCommissionPct) ? Math.round(+raw.rideCommissionPct) : null, /* v76d */
      sqInvoice: raw.sqInvoice && typeof raw.sqInvoice === "object" ? raw.sqInvoice : null, contractId: raw.contractId ? String(raw.contractId) : "",
      rateOverride: raw.rateOverride && typeof raw.rateOverride === "object" ? raw.rateOverride : null, rateOverrideCleared: raw.rateOverrideCleared === true /* v76j */,
      paidMark: raw.paidMark === "paid" || raw.paidMark === "unpaid" ? raw.paidMark : "", paidMarkBy: raw.paidMarkBy ? String(raw.paidMarkBy) : "", paidMarkAt: Number(raw.paidMarkAt) || null /* v77.15 Paid/Unpaid pill */
    };
  }

  /* ---------- v75v (Matthew 2026-10-16): Prepaid (Square invoice) ----------
     Matthew charges some rides ahead on a Square invoice. Saved on the board row with prepaidEdited:true so the calendar
     sync keeps it (same as edited pickups / drop-offs). Driver app: green PAID badge and End ride finishes with zero
     charge; the driver's pay week is credited from the invoice amount. Pure helper (tested): */
  /* v76d: what the card keeps from a Square lookup; "overridden" when Matthew changed the amounts */
  function sqInvoiceRecord(q, patch) {
    var rec = { number: String(q.number || patch.prepaidInvoiceNo || ""), subtotalCents: Math.round(+q.subtotalCents) || 0, taxCents: Math.round(+q.taxCents) || 0, totalCents: Math.round(+q.totalCents) || 0,
      status: String(q.status || ""), paid: q.paid === true, serviceDate: String(q.serviceDate || ""), source: String(q.source || "square"), fetchedAt: q.fetchedAt || Date.now() };
    rec.overridden = (patch.prepaidAmountCents != null && patch.prepaidAmountCents !== rec.subtotalCents) || (patch.prepaidTaxCents != null && patch.prepaidTaxCents !== rec.taxCents);
    return rec;
  }
  function sqInvoiceShared(rows, id, inv) { /* v76d: how many OTHER board rides carry this invoice number */
    var n = String(inv || "").replace(/^#/, "").replace(/^0+/, "");
    if (!n) return 0;
    return (rows || []).filter(function (x) { return x && x.id !== id && x.status !== "canceled" && String(x.prepaidInvoiceNo || (x.sqInvoice && x.sqInvoice.number) || "").replace(/^#/, "").replace(/^0+/, "") === n; }).length;
  }
  window.__pcsV76dSqRecord = sqInvoiceRecord;
  window.__pcsV76dSqShared = sqInvoiceShared;
  function prepaidPatch(on, amount, invoiceNo, now, by, taxText) {
    now = now || Date.now();
    if (!on) return { ok: true, patch: { prepaid: false, prepaidVia: null, prepaidAmountCents: null, prepaidTaxCents: null, prepaidInvoiceNo: "", payState: null, prepaidEdited: true, prepaidBy: by || "god", prepaidAt: now, updatedAt: now } };
    var raw = String(amount == null ? "" : amount).replace(/[$,\s]/g, ""), cents = null;
    if (raw !== "") {
      var n = Number(raw);
      if (!isFinite(n) || n < 0 || n > 100000) return { ok: false, error: "Enter the invoice amount as a number, like 26.81." };
      cents = Math.round(n * 100);
    }
    var inv = String(invoiceNo || "").replace(/^#/, "").trim().slice(0, 40);
    /* v77.26 (Matthew 10/22): this marks the ride as BILLED on a Square invoice (driver collects nothing, End ride = $0 charge).
       It never marks it paid: payState "invoice_pending" until Square shows a completed payment (invoice_sync / Square lookup). */
    var patch = { prepaid: true, prepaidVia: "square_invoice", prepaidAmountCents: cents, prepaidInvoiceNo: inv, prepaidEdited: true, prepaidBy: by || "god", prepaidAt: now,
      payState: "invoice_pending", updatedAt: now };
    if (taxText != null && String(taxText).trim() !== "") { /* v76d: invoice tax kept on the ride (never paid to the driver) */
      var tn = Number(String(taxText).replace(/[$,\s]/g, ""));
      if (!isFinite(tn) || tn < 0 || tn > 100000) return { ok: false, error: "Enter the tax as a number, like 4.67." };
      patch.prepaidTaxCents = Math.round(tn * 100);
    }
    return { ok: true, patch: patch };
  }
  function prepaidLabel(r) {
    if (!r || r.prepaid !== true) return "";
    return (paidSquare(r) ? "Paid: Square verified, invoice" : "Invoice sent, waiting on Square \u00b7 invoice") + (r.prepaidInvoiceNo ? " #" + r.prepaidInvoiceNo : "") + (r.prepaidAmountCents != null ? " \u00b7 " + fmtCents(r.prepaidAmountCents) : "");
  }
  /* v77.26 (Matthew 10/22): a ride is PAID only when
       (a) Square verifies a completed payment: sqInvoice.paid / status PAID (written from Square by invoice_sync or the
           Worker's Square lookup), or a Square card-charge record (state.payCharges), or
       (b) the ASSIGNED driver recorded cash collected in the driver app (row.paidCash: by "driver", driverId = assignedDriverId;
           Matthew counts when he is the assigned driver), or
       (c) God mode recorded cash as a logged override WITH a reason (row.paidCashOverride).
     Nothing else marks paid: the Prepaid (Square invoice) box, the old Paid pill tap (paidMark "paid"), a typed
     "Paid in Square $" amount and Zelle / Venmo / other reports are pending or "unverified", never paid. */
  /* v2.0a (Matthew 10/22): the running meter shows only on rides started as "Metered"; every other ride shows
     Invoice # (or No invoice) + Paid (green) / Unpaid (red), using paidSource (paid-truth). Pure (tested). */
  function godMeterShown(p) { var m = (p && p.meter) || {}; return !!(p && (p.meterVisible === true || m.meterVisible === true) && !(p.scheduleId || m.scheduleId)); }
  function godInvInfo(p) {
    var m = (p && p.meter) || {}, sid = (p && p.scheduleId) || m.scheduleId || "", row = null;
    if (sid) (state.calendar || []).forEach(function (r) { if (r && r.id === sid) row = r; });
    var src = row || p || {}, q = src.sqInvoice && typeof src.sqInvoice === "object" ? src.sqInvoice : null;
    var no = String(src.prepaidInvoiceNo || src.invoiceNo || (q && (q.invoiceNumber || q.number)) || "").replace(/^#/, "").trim();
    var paid = paidSource(src).paid;
    return { label: no ? "Invoice #" + no : "No invoice", paid: paid, word: paid ? "Paid" : "Unpaid" };
  }
  function godInvBadgeHtml(i) {
    return ' <span class="god-inv-badge" style="display:inline-block;font-size:18px;font-weight:900;color:#fff;margin-left:6px">' + esc(i.label) +
      ' <span class="badge" style="font-size:18px;padding:3px 12px;border-radius:999px;color:#fff;background:' + (i.paid ? "#1b9e4b" : "#d32f2f") + '">' + i.word + "</span></span>";
  }
  if (typeof window !== "undefined") window.__pcsGodV20a = { shown: godMeterShown, info: godInvInfo, badge: godInvBadgeHtml };
  function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || "driver"; }
  function paidSource(r) {
    if (!r) return { paid: false, kind: "unpaid", text: "Unpaid" };
    var q = r.sqInvoice;
    if (q && (q.paid === true || String(q.status || "").toUpperCase() === "PAID")) return { paid: true, kind: "square", text: "Paid: Square verified" };
    var ch = (typeof state !== "undefined" && state.payCharges) || {}, c = r.code && ch[r.code];
    if (c && typeof c === "object") return { paid: true, kind: "square", text: "Paid: Square verified" };
    var pc = r.paidCash;
    if (pc && typeof pc === "object" && pc.by === "driver" && pc.driverId && pc.driverId === r.assignedDriverId)
      return { paid: true, kind: "cash", text: "Paid: cash, collected by " + firstName(pc.driverName || r.assignedDriverName) };
    var ov = r.paidCashOverride;
    if (ov && typeof ov === "object" && String(ov.reason || "").trim()) return { paid: true, kind: "override", text: "Paid: cash (God override: " + String(ov.reason).trim().slice(0, 80) + ")" };
    if (r.payUnverified && typeof r.payUnverified === "object") return { paid: false, kind: "unverified", text: "Unverified: " + String(r.payUnverified.method || "other").replace(/_/g, " ") + " (not paid until Square or cash confirms)" };
    if (r.prepaid === true || r.payState === "invoice_pending") return { paid: false, kind: "pending", text: "Invoice sent, waiting on Square" };
    return { paid: false, kind: "unpaid", text: "Unpaid" };
  }
  function paidAuto(r) { return paidSource(r).paid; }
  function paidNow(r) { return paidAuto(r); } /* v77.26: paidMark no longer changes paid */
  function paidSquare(r) { var q = r && r.sqInvoice; return !!(q && (q.paid === true || String(q.status || "").toUpperCase() === "PAID")); }
  /* pure (tested): God cash override; a reason is required and every override is logged on the row */
  function cashOverridePatch(row, reason, cents, who, now) {
    reason = String(reason || "").trim();
    if (reason.length < 3) return { ok: false, error: "Type why you are recording cash (for example: driver handed me $20)." };
    var log = (Array.isArray(row && row.paidOverrideLog) ? row.paidOverrideLog.slice(-20) : []).concat([{ at: now, action: "cash_override", reason: reason.slice(0, 200), cents: cents != null ? cents : null, by: who || "god" }]);
    return { ok: true, patch: { paidCashOverride: { by: "god", who: who || "god", reason: reason.slice(0, 200), cents: cents != null ? cents : null, method: "cash", at: now }, paidOverrideLog: log, updatedAt: now } };
  }
  function cashOverrideClearPatch(row, who, now) {
    var log = (Array.isArray(row && row.paidOverrideLog) ? row.paidOverrideLog.slice(-20) : []).concat([{ at: now, action: "cash_override_removed", by: who || "god" }]);
    return { paidCashOverride: null, paidOverrideLog: log, updatedAt: now };
  }
  function paidPillHtml(r) {
    var src = paidSource(r), p = src.paid, by = " (" + src.text + ")";
    return '<button type="button" class="badge pcs-paid-pill ' + (p ? "is-paid" : "is-unpaid") + '" data-paid-toggle="' + esc(r.id) + '" aria-pressed="' + (p ? "true" : "false") + '" aria-label="' + (p ? "Paid" : "Unpaid") + esc(by) + '. Tap to record a cash override.">' + (p ? "PAID" : src.kind === "pending" ? "WAITING ON SQUARE" : src.kind === "unverified" ? "UNVERIFIED" : "UNPAID") + "</button>" +
      '<span class="fine pcs-paid-src" style="display:block;font-weight:700">' + esc(src.text) + "</span>";
  }
  function paidToggle(id, btn) { /* v77.26: the pill no longer marks paid; only a logged cash override with a reason */
    var r = dbDropRow(id); if (!r) return;
    var src = paidSource(r), now = Date.now(), patch = null;
    if (src.kind === "square") { window.alert("Square shows this ride as paid. Square is the record; change it in Square."); return; }
    if (src.kind === "cash") { window.alert(src.text + " in the driver app. That record stays."); return; }
    if (src.kind === "override") {
      if (!window.confirm("Remove the God cash override on " + (r.rider || "this ride") + "?")) return;
      patch = cashOverrideClearPatch(r, godWho(), now);
    } else {
      var why = window.prompt("Only Square or the driver's cash tap marks a ride paid.\nTo record CASH as a God override, type the reason (it is logged):", "");
      if (why == null) return;
      var out = cashOverridePatch(r, why, null, godWho(), now);
      if (!out.ok) { window.alert(out.error); return; }
      patch = out.patch;
    }
    if (btn) btn.disabled = true;
    godFetch(calendarUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("save");
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      state.boardNotice = paidSource(r).text + ": " + (r.rider || "ride") + ".";
      refresh();
    }).catch(function () { if (btn) btn.disabled = false; state.boardNotice = "Saving didn\u2019t finish. Check the connection and tap again."; try { renderBoardLists(); } catch (e) {} });
  }
  window.__pcsGodPaid = { auto: paidAuto, now: paidNow, source: paidSource, override: cashOverridePatch, html: function (r) { return paidPillHtml(r); } }; /* test hook */
  window.__pcsGodPrepaid = { patch: prepaidPatch, label: function (r) { return prepaidLabel(r); } }; /* test hook */
  function dbPrepaidClose() { var m = document.getElementById("db-prepaid-modal"); if (m) m.remove(); }
  function dbPrepaidOpen(id) {
    var r = dbDropRow(id); if (!r) return;
    dbPrepaidClose();
    var big = "display:block;width:100%;min-height:56px;font-size:20px;font-weight:800;border-radius:12px;margin:8px 0;cursor:pointer;";
    var m = document.createElement("div");
    m.id = "db-prepaid-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
    m.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:56px 12px 12px;overflow:auto";
    m.innerHTML = '<div style="background:#fff;color:#111;border:3px solid #0b6b3a;border-radius:16px;max-width:560px;width:100%;padding:16px">' +
      '<button type="button" id="db-prepaid-close" style="' + big + 'background:#0b3d23;color:#fff;border:0;margin-top:0">Close</button>' +
      '<h2 style="margin:4px 0 6px;color:#0b3d23">Prepaid (Square invoice) \u00b7 ' + esc(r.rider || "ride") + "</h2>" +
      '<label style="display:flex;gap:10px;align-items:center;font-size:20px;font-weight:800;color:#111;margin:8px 0"><input type="checkbox" id="db-prepaid-on" style="width:28px;height:28px"' + (r.prepaid ? " checked" : "") + "> Billed on a Square invoice (shows paid only after Square confirms payment)</label>" +
      '<label for="db-prepaid-amt" style="display:block;font-weight:800;color:#111;margin:8px 0 4px">Amount for this ride before tax (optional)</label>' +
      '<input id="db-prepaid-amt" type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" data-money-reg="1" value="' + esc(r.prepaidAmountCents != null ? (r.prepaidAmountCents / 100).toFixed(2) : "") + '" style="width:100%;font-size:20px;padding:10px;border:2px solid #0b3d23;border-radius:10px;background:#fff;color:#111">' +
      '<label for="db-prepaid-inv" style="display:block;font-weight:800;color:#111;margin:8px 0 4px">Invoice # (optional)</label>' +
      '<input id="db-prepaid-inv" type="text" autocomplete="off" value="' + esc(r.prepaidInvoiceNo || "") + '" style="width:100%;font-size:20px;padding:10px;border:2px solid #0b3d23;border-radius:10px;background:#fff;color:#111">' +
      '<button type="button" id="db-prepaid-lookup" style="' + big + 'background:#fff;color:#0b3d23;border:3px solid #0b6b3a">Look up in Square</button>' + /* v76d */
      '<label for="db-prepaid-tax" style="display:block;font-weight:800;color:#111;margin:8px 0 4px">Tax on the invoice (never paid to the driver)</label>' +
      '<input id="db-prepaid-tax" type="text" inputmode="decimal" autocomplete="off" data-money-reg="1" value="' + esc(r.prepaidTaxCents != null ? (r.prepaidTaxCents / 100).toFixed(2) : "") + '" style="width:100%;font-size:20px;padding:10px;border:2px solid #0b3d23;border-radius:10px;background:#fff;color:#111">' +
      '<p id="db-prepaid-sq" style="color:#0b3d23;font-weight:800;margin:6px 0">' + esc(r.sqInvoice ? sqInvoiceLine(r.sqInvoice) : "") + "</p>" +
      '<p id="db-prepaid-msg" role="status" style="color:#7c2d12;font-weight:700;margin:6px 0"></p>' +
      '<button type="button" id="db-prepaid-save" style="' + big + 'background:#0b6b3a;color:#fff;border:0">Save</button>' +
      '<p style="color:#374151;font-size:14px;margin:6px 0 0">The driver sees a green PAID badge and End ride finishes with a $0 balance. The driver\u2019s week is credited from this amount.</p>' +
      "</div>";
    document.body.appendChild(m);
    document.getElementById("db-prepaid-close").addEventListener("click", dbPrepaidClose);
    var sqGot = r.sqInvoice || null; /* v76d */
    document.getElementById("db-prepaid-lookup").addEventListener("click", function () {
      var msg = document.getElementById("db-prepaid-msg"), inv = document.getElementById("db-prepaid-inv").value;
      if (!String(inv).trim()) { msg.textContent = "Type the invoice number first."; return; }
      msg.textContent = "Looking up #" + String(inv).replace(/^#/, "") + " in Square\u2026";
      sqInvoiceLookup(inv).then(function (out) {
        if (!out.ok) { msg.textContent = out.error; return; }
        var q = out.invoice; sqGot = Object.assign({ source: "square", fetchedAt: Date.now() }, q);
        var shared = sqInvoiceShared(state.calendar, r.id, inv); /* v76d: one invoice split over several rides (e.g. #000513) */
        var amtEl = document.getElementById("db-prepaid-amt");
        if (shared && String(amtEl.value || "").trim()) {
          if (q.paid) document.getElementById("db-prepaid-on").checked = true;
          document.getElementById("db-prepaid-sq").textContent = sqInvoiceLine(sqGot);
          msg.textContent = "Invoice #" + q.number + " covers " + (shared + 1) + " rides, so this ride keeps its own share. Change it if needed, then tap Save.";
          return;
        }
        amtEl.value = (q.subtotalCents / 100).toFixed(2);
        document.getElementById("db-prepaid-tax").value = (q.taxCents / 100).toFixed(2);
        if (q.paid) document.getElementById("db-prepaid-on").checked = true;
        document.getElementById("db-prepaid-sq").textContent = sqInvoiceLine(sqGot);
        msg.textContent = q.paid ? "Found it. Check the amounts and tap Save (you can change them)." : "Found it, but Square says " + q.status + " (not paid yet).";
      });
    });
    document.getElementById("db-prepaid-save").addEventListener("click", function () {
      var out = prepaidPatch(document.getElementById("db-prepaid-on").checked, document.getElementById("db-prepaid-amt").value, document.getElementById("db-prepaid-inv").value, Date.now(), "god", document.getElementById("db-prepaid-tax").value);
      var msg = document.getElementById("db-prepaid-msg");
      if (!out.ok) { msg.textContent = out.error; return; }
      if (out.patch.prepaid && sqGot) { out.patch.sqInvoice = sqInvoiceRecord(sqGot, out.patch); if (out.patch.prepaidAmountCents != null) out.patch.fareBeforeTax = out.patch.prepaidAmountCents / 100; }
      msg.textContent = "Saving\u2026";
      godFetch(calendarUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(out.patch) }).then(function (res) {
        if (!res.ok) throw new Error("save");
        Object.keys(out.patch).forEach(function (k) { r[k] = out.patch[k]; });
        state.boardNotice = (r.prepaid ? prepaidLabel(r) + " saved for " : "Regular payment saved for ") + (r.rider || "ride") + ".";
        dbPrepaidClose();
        var shareV = r.prepaid && sqGot && r.prepaidAmountCents != null && r.prepaidAmountCents !== Math.round(+sqGot.subtotalCents) ? r.prepaidAmountCents : null; /* God-typed split of one invoice */
        return invLink(id, r.prepaid ? r.prepaidInvoiceNo : "", shareV, shareV != null ? r.prepaidTaxCents : null).catch(function () { state.boardNotice += " Invoice check with Square didn’t finish; open it and Save again."; }).then(refresh);
      }).catch(function () { msg.textContent = "Saving didn\u2019t finish. Check the connection and tap Save again."; });
    });
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
          state.calendarRaw = data; /* v73: full rows (manual-ride money fields) for the driver Earnings sheet */
          return Object.keys(data).map(function (id) {
            return normalizeCalendarRow(id, data[id]);
          }).filter(Boolean);
        } catch (e) {
          return [];
        }
      });
    });
  }

  /* r4 (Harry M3/M4): discounts + their review state come from the Worker (POST /god/discounts), never from Firebase. */
  function discOverlay(rows, kv, rev) { /* pure (tested) */
    kv = kv || {}; rev = rev || {};
    (rows || []).forEach(function (r) { if (!r || !r.id) return; var k = Object.prototype.hasOwnProperty.call(kv, r.id) ? kv[r.id] : null;
      r.meterDiscount = k && k.d && typeof k.d === "object" ? k.d : null; r.discountReview = r.meterDiscount && !Object.prototype.hasOwnProperty.call(rev, r.id) ? "pending" : ""; });
    return rows;
  }
  function entryNeedsReview(e, rev) { return !!e && Number(e.discountCents) > 0 && !Object.prototype.hasOwnProperty.call(rev || {}, "ride:" + String(e.code || "")); } /* pure (tested) */
  function presetAuditText(e, presets) { /* pure (tested): r5 driver self-applied preset, as the Worker recorded it */
    var p = presets && e && Object.prototype.hasOwnProperty.call(presets, String(e.code || "")) ? presets[String(e.code)] : null; if (!p || p.by !== "driver") return "";
    return ' <span class="fine">' + esc((p.preset === "military" ? "Military (10%)" : "Senior 65+ (10%)") + " applied by the driver after the ID check \u00b7 recorded " + ctClock(p.at)) + "</span>";
  }
  function discLoad() {
    return atxPost("/god/discounts", {}).then(function (d) { state.discKV = d.discounts || {}; state.discRev = d.reviewed || {}; state.discPresets = d.presets || {}; discOverlay(state.calendar, state.discKV, state.discRev); })
      .catch(function () { state.discKV = state.discKV || {}; state.discRev = state.discRev || {}; discOverlay(state.calendar, state.discKV, state.discRev); });
  }
  function discSave(id, d, msg) { /* field-level write only (the Worker mirrors just this into KV) */
    var url = calendarUrl(id).replace(/\.json$/, "/meterDiscount.json");
    return godFetch(url, d ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) } : { method: "DELETE" }).then(function (res) {
      if (!res.ok) throw new Error("save"); if (msg) state.boardNotice = msg; return discLoad().then(refresh);
    }).catch(function () { state.boardNotice = "NOT SAVED: try again."; renderBoardLists(); return false; });
  }
  function putCalendarRide(row) {
    if (!row || !row.id) return Promise.reject(new Error("calendar-id"));
    row = Object.assign({}, row); delete row.meterDiscount; delete row.discountReview; /* r4 M3: never re-send the discount with a whole row */
    /* v76d: PATCH, not PUT. The row here is the normalized copy, so a PUT erased every field it doesn't list
       (prepaidEdited, prepaidVia, stopsEdited, rideCommissionPctEdited, partial-paid notes ...) and the next calendar
       sync then dropped the prepaid mark. PATCH writes the listed fields and keeps the rest. */
    return godFetch(calendarUrl(row.id), {
      method: "PATCH",
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
      if (r.status === "cancelled" || r.status === "deleted") return false;
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

  /* v76d (Matthew 10/18): ride codes come from the FULL ride id. The old code kept only the first letters of the id, so every
     iCloud ride got "PCSCLUD" + one character and finished rides overwrote each other in the drivers' pay history.
     Same function in app/app.js and /workspace/v76d/tools/ridecode.py (tested to match). */
  var V76D_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function v76dFnv(s) { var h = 0x811c9dc5, i; for (i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rideCodeV76d(id, salt) {
    var s = String(id || "") + (salt ? "|" + salt : ""), h1 = v76dFnv(s), h2 = v76dFnv("#" + s), out = "P", i;
    for (i = 0; i < 4; i += 1) { out += V76D_ALPHA[h1 & 31]; h1 = h1 >>> 5; }
    for (i = 0; i < 3; i += 1) { out += V76D_ALPHA[h2 & 31]; h2 = h2 >>> 5; }
    return out;
  }
  function makeScheduleCode(eventId) {
    var taken = {};
    (state.calendar || []).forEach(function (r) { if (r && r.code && r.id !== eventId) taken[r.code] = 1; });
    var salt;
    for (salt = 0; salt < 50; salt += 1) { var c = rideCodeV76d(eventId, salt); if (!taken[c]) return c; }
    return rideCodeV76d(eventId + "|" + Date.now(), 0);
  }
  /* the ride's own code: keep it unless another board ride shares it (old PCSCLUD* codes), then give it a unique one */
  function ownCode(row) {
    if (!row) return "";
    var c = String(row.code || "");
    if (!c) return makeScheduleCode(row.id);
    var shared = (state.calendar || []).some(function (r) { return r && r.id !== row.id && r.code === c; });
    return shared ? makeScheduleCode(row.id) : c;
  }
  /* v76d: a pay-history write never overwrites a DIFFERENT ride's entry, and a canceled $0 never overwrites a finished one.
     Pure (tested): "write" | "skip" | "rekey" */
  function historyDecision(existing, entry) {
    if (!existing || typeof existing !== "object" || !Object.keys(existing).length) return "write";
    var finished = function (e) { return !e.canceled && String(e.status || "") !== "canceled" && ((Number(e.fareTotal) || 0) > 0 || (Number(e.commissionCents) || 0) > 0 || (Number(e.fareSub) || 0) > 0); };
    var same = (existing.scheduleId && entry.scheduleId) ? existing.scheduleId === entry.scheduleId
      : (String(existing.riderName || "") === String(entry.riderName || "") && String(existing.day || "") === String(entry.day || ""));
    if (entry.canceled && finished(existing)) return "skip";
    if (same) return "write";
    if (!existing.code && !existing.day && !existing.fareSub && !existing.riderName) return "write"; /* stray tip-only stub */
    return entry.canceled ? "skip" : "rekey";
  }
  function godHistoryGuard(driverId, code, entry) {
    var tries = 0;
    function look(c) {
      return fetch(historyUrl(driverId, c)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (ex) {
        var d = historyDecision(ex, entry);
        if (d !== "rekey" || tries > 6) return { code: c, skip: d === "skip" };
        tries += 1;
        return look(rideCodeV76d((entry.scheduleId || c) + "|h", tries));
      });
    }
    return look(code);
  }
  /* v76d: per-ride Commission % (God mode, this ride only) wins over the driver's own % */
  function ridePctOf(row) {
    var p = row && row.rideCommissionPct;
    if (p == null || p === "" || !isFinite(+p)) return null;
    p = Math.round(+p);
    return p >= 0 && p <= 100 ? p : null;
  }
  function ridePctFor(row) {
    var p = ridePctOf(row);
    if (p != null) return p;
    return row && row.assignedDriverId ? commissionPctFor(row.assignedDriverId) : DEFAULT_COMMISSION_PCT;
  }
  /* v76d: finishing with a $0 fare and nothing paid in Square / on an invoice / on the meter credits the driver $0 */
  function zeroFareWarn(row, fareText) {
    var n = Number(String(fareText == null ? "" : fareText).replace(/[$,\s]/g, ""));
    if (isFinite(n) && n > 0) return false;
    if (row && (row.paidSquareCents != null || (row.prepaid && row.prepaidAmountCents != null) || row.meterCode || (Number(row.fareBeforeTax) || 0) > 0)) return false;
    return true;
  }
  window.__pcsV76d = { rideCode: rideCodeV76d, historyDecision: historyDecision, ridePctOf: ridePctOf, zeroFareWarn: zeroFareWarn };

  /* v77.10 (Matthew 10/20): picking a driver in the card dropdown SAVES right away (the badge used to stay OPEN because the pick
     was only remembered on screen). The empty choice unassigns (status back to open). Only open / assigned cards change this way;
     a started or finished ride never does. Pure (tested). */
  function assignPickPatch(row, driver, now) {
    var st = String((row && row.status) || "open");
    if (st !== "open" && st !== "assigned") return { ok: false, error: "This ride is " + st + "; its driver stays as is." };
    if (!driver) return { ok: true, patch: { assignedDriverId: "", assignedDriverName: "", status: "open", updatedAt: now } };
    return { ok: true, patch: { assignedDriverId: driver.id, assignedDriverName: driver.name || driver.id, status: "assigned", updatedAt: now } };
  }
  /* v77.10 (Matthew 10/20): "Cash" checkbox on the ride card. Checked -> payMethod "cash" (driver collects at drop-off, owes PCS its
     share from the weekly balance, same as Add ride cash); unchecked -> payMethod "" (normal card / app pay). No discount is applied.
     Saved via cphSave = PATCH through the God-only Worker /god/db (PCSCALND), never a direct browser Firebase write. Pure (tested). */
  function cashPatch(on, now) { return { payMethod: on ? "cash" : "", payMethodBy: "god", payMethodAt: now, updatedAt: now }; }
  function cashBoxHtml(r) {
    var id = esc(r.id), on = String(r.payMethod || "") === "cash", dis = r.status === "completed" || r.prepaid ? " disabled" : "";
    return '<label class="db-cash" style="display:inline-flex;align-items:center;gap:10px;font-size:20px;font-weight:800;color:#fff;background:#2e7d32;border-radius:12px;padding:10px 16px;min-height:52px;margin:6px 0;cursor:pointer">' +
      '<input type="checkbox" class="db-cash-box" data-event-id="' + id + '"' + (on ? " checked" : "") + dis + ' style="width:30px;height:30px;accent-color:#9be7b0">Cash</label>';
  }
  /* v77.10 (Matthew 10/20): approve a discount case by case on ANY ride card (calendar or manual). Saved as the ride's one approved
     discount: meterDiscount {type "other", status "approved", pct | cents, by "god", at} via cphSave (God-only Worker /god/db PATCH).
     The driver's meter applies it as its own line (existing rule for owner-approved discounts); the sync keeps it. Never set by Cash.
     Pure (tested). */
  function godDiscPatch(mode, raw, now) {
    if (mode === "military" || mode === "senior") return { ok: true, patch: { meterDiscount: { type: mode, status: "applied", pct: 10, by: "god", at: now }, updatedAt: now } }; /* standing 10% presets; one discount per ride */
    var t = String(raw == null ? "" : raw).replace(/[$,%\s]/g, "");
    if (t === "") return { ok: true, patch: { meterDiscount: null, updatedAt: now } }; /* blank = remove */
    var n = Number(t); if (!isFinite(n) || n <= 0) return { ok: false, error: "Enter the discount as a number, like 10." };
    if (mode === "pct") { if (n > 100) return { ok: false, error: "A percent discount goes up to 100." }; return { ok: true, patch: { meterDiscount: { type: "other", status: "approved", pct: Math.round(n * 100) / 100, by: "god", at: now }, updatedAt: now } }; }
    if (n > 10000) return { ok: false, error: "That dollar amount looks too large." };
    return { ok: true, patch: { meterDiscount: { type: "other", status: "approved", cents: Math.round(n * 100), by: "god", at: now }, updatedAt: now } };
  }
  function godDiscText(d) { if (d && d.by === "god" && (d.type === "military" || d.type === "senior")) return d.type === "military" ? "Military discount (10%)" : "Senior discount, 65+ (10%)";
    if (!d || d.by !== "god" || d.status !== "approved") return ""; return Number(d.cents) > 0 ? "$" + (Number(d.cents) / 100).toFixed(2) : Number(d.pct) > 0 ? Number(d.pct) + "%" : ""; }
  function godDiscHtml(r) {
    var id = esc(r.id), cur = godDiscText(r.meterDiscount), d = r.meterDiscount || {}, dis = r.status === "completed" ? " disabled" : "";
    return '<div class="db-disc" style="border:2px solid #0b6b3a;background:#0b3d23;border-radius:10px;padding:8px;margin:6px 0">' +
      '<div style="font-weight:800;margin-bottom:4px">Discount' + (cur ? ' \u2713 <span class="fine db-disc-line">' + esc(/\(10%\)$/.test(cur) ? cur : cur + " off, approved by you") + "</span>" : "") + "</div>" +
      presetBoxesHtml(r, dis) + driverCoversHtml(r, dis) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><select id="disc-mode-' + id + '" style="font-size:18px;min-height:44px"' + dis + '><option value="pct"' + (Number(d.cents) > 0 ? "" : " selected") + '>%</option><option value="usd"' + (Number(d.cents) > 0 ? " selected" : "") + ">$</option></select>" +
      '<input id="disc-amt-' + id + '" inputmode="decimal" autocomplete="off" placeholder="10" value="' + esc(Number(d.cents) > 0 ? (Number(d.cents) / 100).toFixed(2) : Number(d.pct) > 0 ? String(d.pct) : "") + '" style="font-size:18px;min-height:44px;width:120px"' + dis + ">" +
      '<button type="button" class="btn btn-disc-apply" data-event-id="' + id + '" style="background:#2e7d32;color:#fff;border:0;border-radius:10px;font-weight:800;font-size:17px;min-height:48px;padding:8px 14px"' + dis + ">Apply discount</button>" +
      (cur ? '<button type="button" class="btn btn-disc-remove" data-event-id="' + id + '" style="min-height:48px"' + dis + ">Remove</button>" : "") + "</div>" +
      '<p class="fine" style="margin:4px 0 0">Shown as its own line on the fare. PCS covers it by default (driver % on the full fare). One discount per ride: a new one replaces the old.</p></div>';
  }
  function presetBoxesHtml(r, dis) { /* pure (tested): Military / Senior 65+ checkboxes; one checked = the other is disabled (grayed) */
    var d = r.meterDiscount || {}, cur = d.by === "god" && (d.type === "military" || d.type === "senior") ? d.type : "";
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0">' + [["military", "Military (10%)"], ["senior", "Senior 65+ (10%)"]].map(function (k) {
      var on = cur === k[0], off = dis || (cur && !on) ? " disabled" : "";
      return '<label class="db-disc-pre" style="display:inline-flex;align-items:center;gap:10px;font-size:19px;font-weight:800;color:#fff;background:' + (off ? "#6b7280;opacity:.6" : "#2e7d32") + ';border-radius:12px;padding:10px 14px;min-height:52px">' +
        '<input type="checkbox" class="db-disc-preset" data-disc-preset="' + k[0] + '" data-event-id="' + esc(r.id) + '"' + (on ? " checked" : "") + off + ' style="width:30px;height:30px">' + k[1] + "</label>"; }).join("") + "</div>";
  }
  function driverCoversHtml(r, dis) { /* v77.10: default unchecked = PCS absorbs the discount; only shown when a discount is on */
    var d = r.meterDiscount; if (!d || d.by !== "god") return "";
    return '<label class="db-disc-dc" style="display:inline-flex;align-items:center;gap:10px;font-size:18px;font-weight:800;color:#fff;background:#14532d;border:2px solid #2e7d32;border-radius:12px;padding:8px 14px;min-height:50px;margin:4px 0">' +
      '<input type="checkbox" class="db-disc-driver-covers" data-event-id="' + esc(r.id) + '"' + (d.driverCovers === true ? " checked" : "") + dis + ' style="width:28px;height:28px">Driver covers it</label>' +
      '<span class="fine" style="margin-left:6px">' + (d.driverCovers === true ? "The whole discount comes off the driver\u2019s share." : "PCS covers the discount; the driver\u2019s % is on the full fare.") + "</span>";
  }
  function driverCoversPatch(d, on, now) { /* pure (tested): same one discount, only the driverCovers flag changes */
    if (!d || typeof d !== "object") return null; var x = {}; Object.keys(d).forEach(function (k) { if (k !== "driverCovers") x[k] = d[k]; });
    if (on) x.driverCovers = true; return { meterDiscount: x, updatedAt: now };
  }
  function idVerifyGodPop(type) {
    var el = document.getElementById("god-idpop"); if (!el) { el = document.createElement("div"); el.id = "god-idpop"; document.body.appendChild(el); }
    el.innerHTML = '<div role="alertdialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px"><div style="background:#fff;color:#0b3d23;border:4px solid #2e7d32;border-radius:16px;max-width:420px;width:100%;padding:18px;text-align:center">' +
      '<p style="font-size:24px;font-weight:800;margin:0 0 8px">Verify with ID</p><p style="font-size:17px;margin:0 0 12px">' + (type === "military" ? "Military ID" : "ID showing age 65+") + ". The driver is asked to check it at Start too.</p>" +
      '<button type="button" id="god-idpop-ok" style="background:#2e7d32;color:#fff;border:0;border-radius:12px;font-weight:800;font-size:22px;min-height:60px;width:100%">OK</button></div></div>';
    document.getElementById("god-idpop-ok").addEventListener("click", function () { el.innerHTML = ""; });
  }
  /* v77.10: the driver app flags a start / completion made without an active session (stale GPS, under 1 min, same spot, 0 miles). */
  var SESSION_FLAG_TEXT = { stale_gps: "GPS over 2 min old at completion", under_1_min: "started and completed in under 1 min", same_spot: "started and completed at the same spot",
    zero_miles: "0 metered miles", app_hidden: "app was in the background", start_stale_gps: "GPS over 2 min old at Start", start_app_hidden: "app was in the background at Start" };
  function discReviewBtn(key) { return '<button type="button" class="btn-disc-reviewed" data-disc-review="' + esc(key) + '" style="background:#2e7d32;color:#fff;border:0;border-radius:10px;font-weight:800;font-size:16px;min-height:44px;padding:6px 14px">Mark reviewed</button>'; }
  if (typeof document !== "undefined") document.addEventListener("click", function (e) { var b = e.target && e.target.closest ? e.target.closest("[data-disc-review]") : null; if (!b) return; /* r4 M4: God-only Worker endpoint */
    b.disabled = true; atxPost("/god/discounts/review", { key: b.getAttribute("data-disc-review"), by: (typeof godWho === "function" ? godWho() : "god") }).then(function (d) { state.discRev = d.reviewed || {}; discOverlay(state.calendar, state.discKV, state.discRev); state.boardNotice = "Saved \u2713 Discount reviewed."; refresh(); })
      .catch(function (er) { b.disabled = false; window.alert("Couldn't save: " + String(er && er.message || er)); }); }, true);
  function sessionFlagHtml(r) { var f = (r && Array.isArray(r.sessionFlags)) ? r.sessionFlags : []; var rv = r && r.discountReview === "pending" ? ' <span class="badge db-disc-review" style="background:#b91c1c;color:#fff;font-weight:800">Discount: review before payout</span> ' + discReviewBtn(r.id) : "";
    if (!f.length) return rv;
    return ' <span class="badge db-session-flag" style="background:#b91c1c;color:#fff;font-weight:800">Check this ride: ' + esc(f.map(function (k) { return SESSION_FLAG_TEXT[k] || k; }).join("; ")) + "</span>" + rv; }
  function driverLineHtml(r) { /* pure (tested) */
    /* r2 (Matthew 3:35 PM): always visible under the title, also when the card is collapsed; SAVED assignment only (never the dropdown draft) */
    return '<p class="day-driver" style="margin:2px 0 4px;font-weight:700">' + (r && r.assignedDriverId ? "Assigned to " + esc(r.assignedDriverName || r.assignedDriverId) : '<span style="color:#f0d48a">Unassigned</span>') +
      sessionFlagHtml(r) +
      (r && String(r.payMethod || "") === "cash" ? ' <span class="badge db-cash-tag" style="background:#2e7d32;color:#fff;font-weight:800">Cash</span>' : "") + "</p>";
  }
  function assignPatchSave(row, patch) {
    if (!patch.code) patch = Object.assign({}, patch, { code: ownCode(row) });
    return godFetch(calendarUrl(row.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("NOT SAVED (server refused)"); Object.keys(patch).forEach(function (k) { row[k] = patch[k]; }); });
  }
  function unassignCalendarRide(eventId) {
    var row = null; (state.calendar || []).forEach(function (r) { if (r && r.id === eventId) row = r; });
    if (!row) return Promise.reject(new Error("missing"));
    var pp = assignPickPatch(row, null, Date.now()); if (!pp.ok) return Promise.reject(new Error(pp.error));
    return assignPatchSave(row, pp.patch).then(function () {
      state.boardNotice = "Saved: " + (row.rider || "ride") + " is unassigned (open)."; try { var p = refresh(); if (p && p.catch) p.catch(function () {}); } catch (e) {} renderBoardLists(); });
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
    /* v74: any roster driver (offline, logged out, or Matthew himself) can be assigned; only rejected/fired are refused. */
    if (!driver && state.roster && state.roster[driverId] && approvalOf(state.roster[driverId]) !== "rejected" && state.roster[driverId].active !== false) {
      driver = { id: driverId, name: state.roster[driverId].name || driverId };
    }
    if (!driver) return Promise.reject(new Error("driver"));
    var next = Object.assign({}, row, {
      assignedDriverId: driver.id,
      assignedDriverName: driver.name || driver.id,
      status: row.status === "completed" ? "completed" : "assigned",
      code: ownCode(row), /* v76d */
      updatedAt: Date.now()
    });
    /* r2 (Harry F7): PATCH only the driver fields (+ code/status), never the whole cached row, so a stale board can't undo a
       ride that just went started on the driver's phone. */
    return assignPatchSave(row, { assignedDriverId: next.assignedDriverId, assignedDriverName: next.assignedDriverName, status: next.status, code: next.code, updatedAt: next.updatedAt }).then(function () {
      state.boardNotice = "Assigned " + (next.rider || "ride") + " → " + (driver.name || driver.id);
      /* v74: the save already succeeded; a failed board reload must not show "Could not assign". */
      try { var p = refresh(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      renderBoardLists();
    });
  }

  /* v73 fix (Matthew 2026-10-12, Hector PCSCLUD9): saving the fare ONLY saves the fare. Status, driver, earnings untouched.
     PATCH through the God db (Worker read-back), so a refused save shows up instead of looking saved. fixedFare = account ride:
     the driver app charges this set fare instead of the meter price. */
  /* v77.6 (Matthew): Invoice # typed on the ride card -> prepaidInvoiceNo (the same field the Prepaid / Square invoice
     dialog, the Square invoice lookup and the shared-invoice check use). Leading zeros kept ("000519"). prepaidEdited:true
     so the calendar sync (calsync PREPAID_KEYS + Worker CAL_KEEP) keeps it. squareInvoiceId = Square's invoice id from the
     read-only God lookup (/sq/invoice), for the Dashboard link; cleared when the number changes. Pure (tested). */
  function invoiceNoPatch(text, prev, now, by) {
    if (text == null) return { ok: true, patch: null };
    var v = String(text).replace(/^\s*#/, "").replace(/\s+/g, "");
    if (v && !/^\d{1,20}$/.test(v)) return { ok: false };
    if (v === String(prev || "")) return { ok: true, patch: null };
    return { ok: true, patch: { prepaidInvoiceNo: v, squareInvoiceId: "", prepaidEdited: true, prepaidBy: by || "god", prepaidAt: now } };
  }
  var SQ_INV_RE = /^[A-Za-z0-9_:-]{6,64}$/;
  function sqInvoiceUrl(id) { return SQ_INV_RE.test(String(id || "")) ? "https://app.squareup.com/dashboard/invoices/" + String(id) /* Square ids look like inv:0-ChAbC...; ':' stays as is (allowed in a path; the regex allows only A-Z a-z 0-9 _ : -) */ : ""; }
  function invLinkHtml(r) {
    var n = String((r && r.prepaidInvoiceNo) || ""); if (!n) return "";
    var u = sqInvoiceUrl(r.squareInvoiceId), st = ' style="color:#f0d48a;font-weight:800;text-decoration:underline"';
    return '<span class="fine day-inv-saved" id="inv-saved-' + esc(r.id) + '">' + (u
      ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"' + st + ">Invoice #" + esc(n) + "</a>" + ' <button type="button" class="btn god-payqr-btn" data-payqr="' + esc(r.squareInvoiceId) + '" data-payqr-label="invoice #' + esc(n) + '" style="background:#2e7d32;color:#fff;border:0;border-radius:10px;font-weight:800;font-size:17px;min-height:48px;padding:8px 14px;margin:4px 0 0 6px">Show pay QR</button>' /* v77.10 */
      : "Invoice #" + esc(n) + ' <a href="https://app.squareup.com/dashboard/invoices" target="_blank" rel="noopener" style="font-size:12px;color:#f0d48a">Find in Square</a>') + "</span>";
  }
  /* v77.10 (Matthew 10/20): "Show pay QR": a big QR of the invoice's Square pay page, for the client to scan in the car.
     The Worker reads the pay URL from Square (read-only, /sq/invoice/payurl); the QR is drawn here (bundled qrcode.js, MIT,
     loaded only when needed). Square is never changed; no Square token in the browser. */
  function payQrHostOk(u) { var m = /^https:\/\/([^\/?#:]+)(?:[\/?#]|$)/i.exec(String(u || "")); return !!m && /(^|\.)squareup(sandbox)?\.com$|(^|\.)square\.link$/i.test(m[1]); } /* pure (tested) */
  function payQrSvg(url) { /* pure-ish (tested with the bundled library): SVG markup, "" for a bad URL */
    if (!payQrHostOk(url) || typeof qrcode !== "function") return ""; /* r2: same Square host allowlist as the Worker */
    var q = qrcode(0, "M"); q.addData(String(url)); q.make();
    return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
  }
  function payQrLib() {
    if (typeof qrcode === "function") return Promise.resolve();
    return new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = "qrcode.js?v=77.10"; s.onload = ok; s.onerror = function () { bad(new Error("The QR maker didn't load. Check the connection and try again.")); }; document.head.appendChild(s); });
  }
  function payQrShow(invoiceId, label) {
    var el = document.getElementById("god-payqr"); if (!el) { el = document.createElement("div"); el.id = "god-payqr"; document.body.appendChild(el); }
    var shell = function (inner) { el.innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:12px" role="dialog" aria-modal="true" aria-label="Pay QR">' +
      '<div style="background:#fff;color:#0b3d23;border:4px solid #2e7d32;border-radius:16px;max-width:520px;width:100%;padding:16px;text-align:center">' + inner +
      '<button type="button" class="btn god-payqr-close" style="background:#2e7d32;color:#fff;border:0;border-radius:12px;font-weight:800;font-size:20px;min-height:56px;width:100%;margin-top:12px">Close</button></div></div>'; };
    shell('<p style="font-size:20px;font-weight:800">Loading the pay page\u2026</p>');
    return Promise.all([atxPost("/sq/invoice/payurl", { invoiceId: invoiceId }), payQrLib()]).then(function (a) {
      var d = a[0], svg = payQrSvg(d.payUrl); if (!svg) throw new Error("Square doesn’t show a pay page for this invoice yet.");
      shell('<div style="font-size:22px;font-weight:800;margin-bottom:6px">Scan to pay ' + esc(label || ("invoice #" + (d.number || ""))) + "</div>" +
        (d.paid ? '<div style="background:#2e7d32;color:#fff;border-radius:8px;padding:6px;font-weight:800;margin-bottom:6px">Square shows this invoice as PAID</div>' : "") +
        '<div class="god-payqr-code" style="width:min(80vw,440px);margin:0 auto">' + svg + "</div>" +
        '<div style="font-size:14px;margin-top:6px">Opens Square\u2019s secure pay page \u00b7 www.PCSrides.com</div>');
    }).catch(function (e) { shell('<p style="font-size:18px;font-weight:800">' + esc(String(e && e.message || e)) + "</p>"); });
  }
  if (typeof document !== "undefined") document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".god-payqr-close,[data-payqr]") : null; if (!t) return;
    if (t.classList.contains("god-payqr-close")) { var el = document.getElementById("god-payqr"); if (el) el.innerHTML = ""; return; }
    e.preventDefault(); payQrShow(t.getAttribute("data-payqr"), t.getAttribute("data-payqr-label"));
  });
  function saveCalendarFare(eventId, fareBeforeTax, fixedFare, invoiceText) {
    var row = null;
    (state.calendar || []).forEach(function (r) { if (r && r.id === eventId) row = r; });
    if (!row) return Promise.reject(new Error("missing"));
    var fare = Number(fareBeforeTax);
    if (String(fareBeforeTax == null ? "" : fareBeforeTax).trim() === "" || !isFinite(fare) || fare < 0) return Promise.reject(new Error("fare"));
    fare = Math.round(fare * 100) / 100;
    var patch = { fareBeforeTax: fare, fixedFare: !!fixedFare, updatedAt: Date.now() };
    var ip = invoiceNoPatch(invoiceText, row.prepaidInvoiceNo, patch.updatedAt, "god");
    if (!ip.ok) return Promise.reject(new Error("invoice"));
    if (ip.patch) Object.assign(patch, ip.patch);
    var invNo = ip.patch ? ip.patch.prepaidInvoiceNo : String(row.prepaidInvoiceNo || "");
    var needId = !!invNo; /* Harry r3: look the id up again on every Save fare (never trust a stored one) */
    var look = needId ? sqInvoiceLookup(invNo).then(function (out) { /* read-only Square search; a miss just leaves the plain number */
      var iid = out && out.ok && out.invoice ? String(out.invoice.invoiceId || "") : "";
      patch.squareInvoiceId = SQ_INV_RE.test(iid) ? iid : ""; if (!ip.patch) patch.prepaidEdited = true; /* miss -> plain number + Find in Square */
    }, function () {}) : Promise.resolve();
    return look.then(function () { return godFetch(calendarUrl(eventId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }).then(function (res) {
      if (!res.ok) throw new Error("fare-save");
      return res.text().then(function (t) {
        var back = null; try { back = JSON.parse(t); } catch (e) {}
        if (back && typeof back === "object" && back.fareBeforeTax != null && Number(back.fareBeforeTax) !== fare) throw new Error("fare-readback");
        row.fareBeforeTax = fare; row.fixedFare = !!fixedFare;
        ["prepaidInvoiceNo", "squareInvoiceId", "prepaidEdited", "prepaidBy", "prepaidAt"].forEach(function (k) { if (k in patch) row[k] = patch[k]; });
        delete state.fareDrafts[eventId];
        if (ip.patch) invLink(eventId, invNo).catch(function () {}); /* v77.11 r2: Worker reads Square + mirrors the amount */
        state.boardNotice = "Fare saved · " + fmtCents(Math.round(fare * 100)) + " for " + (row.rider || "ride") + (fixedFare ? " · driver app charges this fare" : "") + (row.prepaidInvoiceNo ? " · Invoice #" + row.prepaidInvoiceNo : "");
        return refresh();
      });
    }); });
  }
  /* v75s: God-mode copy of the driver app's meter estimate math (generated from app/app.js by /workspace/pcs-sched-ride/v2/gen.py;
     keep in step: tests compare God and driver estimates for the same rides). Own scope, so no name clashes. */
  var GEST = (function () {
  var SCHED_EST_WORKER = PAY_WORKER;
    var EXTRA_FEE = 0;
    var INTL_ARRIVAL_CENTS = 1500;
    var INTL_ARRIVAL_LABEL = "International arrivals service fee";
    var BASE_CENTS = 1100;
    var METER_START_BASE = 11.00;
    var METER_PROFILES = {
    day:   { name: "Day Trip",   hours: "Mon–Fri 6:00 am–5:59 pm",                   perMile: 1.10, perMinute: 0.40, entry: null, includedMiles: 1, minimum: null, step: 0.25, slowMph: 10, freeWaitSec: 120 },
    night: { name: "Night Trip", hours: "6:00–9:59 pm, weekends and holidays",       perMile: 1.38, perMinute: 0.40, entry: null, includedMiles: 1, minimum: null, step: 0.25, slowMph: 10, freeWaitSec: 120 },
    late:  { name: "Late Night", hours: "10:00 pm–5:59 am, every day",               perMile: 1.43, perMinute: 0.40, entry: null, includedMiles: 1, minimum: null, step: 0.25, slowMph: 10, freeWaitSec: 120 }
  };
    var METER_TAX_RATE = 0.0825;
    var METER_HOLIDAY_RATE = true;
    var AIRPORT = {
    daytime: { drop: 1550, pick: 2500 },
    weekendNight: { drop: 2000, pick: 3000 },
    late: { drop: 3000, pick: 5000 }
  };
    var METER_DISC_PCT = { senior: 10, military: 10 };
    var METER_DISC_NAME = { senior: "Senior discount, 65+", military: "Military discount", other: "Discount" };
    var METER_AIRPORTS = [["IAH", "Bush Intercontinental (IAH)"], ["HOU", "Hobby (HOU)"], ["DFW", "Dallas Fort Worth (DFW)"], ["DAL", "Dallas Love Field (DAL)"]];
    var METER_TIER_AIRPORT = { day: "daytime", night: "weekendNight", late: "late" };
    function pad2(n) {
    return String(n).padStart(2, "0");
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
    function pcsHolidayName(ymd) {
    var p = String(ymd || "").split("-");
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    if (!y || !m || !d) return "";
    var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var nth = Math.floor((d - 1) / 7) + 1, last = d + 7 > dim;
    var fixed = function (mm, dd) { /* the date itself, plus the federal observed Fri/Mon */
      if (m === mm && d === dd) return true;
      var t = Date.UTC(y, mm - 1, dd), w = new Date(t).getUTCDay(), o = w === 6 ? t - 86400000 : w === 0 ? t + 86400000 : 0;
      if (!o) return false; var od = new Date(o); return od.getUTCFullYear() === y && od.getUTCMonth() + 1 === m && od.getUTCDate() === d;
    };
    if (fixed(1, 1) || (m === 12 && d === 31 && wd === 5)) return "New Year's Day";
    if (m === 1 && wd === 1 && nth === 3) return "Martin Luther King Jr. Day";
    if (m === 2 && wd === 1 && nth === 3) return "Presidents' Day";
    if (m === 5 && wd === 1 && last) return "Memorial Day";
    if (fixed(6, 19)) return "Juneteenth";
    if (fixed(7, 4)) return "Independence Day";
    if (m === 9 && wd === 1 && nth === 1) return "Labor Day";
    if (m === 10 && wd === 1 && nth === 2) return "Columbus Day / Indigenous Peoples' Day";
    if (fixed(11, 11)) return "Veterans Day";
    if (m === 11 && wd === 4 && nth === 4) return "Thanksgiving";
    if (fixed(12, 25)) return "Christmas Day";
    return "";
  }
    function meterIsHoliday(ymd) {
    if (!METER_HOLIDAY_RATE) return false;
    return !!pcsHolidayName(ymd);
  }
    function meterBand(when) {
    var parts = chicagoParts(when || new Date());
    var hour = Number(String(parts.time).split(":")[0]);
    var wd = chicagoWeekday(parts.date);
    var holiday = meterIsHoliday(parts.date);
    var key = hour >= 22 || hour < 6 ? "late" : (wd === 0 || wd === 6 || holiday || hour >= 18) ? "night" : "day";
    var why = key === "late" ? "" : holiday ? " · holiday" : (wd === 0 || wd === 6) ? " · weekend" : "";
    return meterProfileBand(key, why, holiday);
  }
    function meterProfileBand(key, why, holiday) {
    var P = METER_PROFILES[key] || METER_PROFILES.day;
    var c = function (d) { var n = Math.round(Number(d) * 100); return isFinite(n) && n > 0 ? n : 0; };
    var start = P.entry != null && P.entry !== "" ? Number(P.entry) : Number(METER_START_BASE) + Number(P.perMile);
    return {
      key: key, name: String(P.name || key), label: String(P.name || key) + (why || ""), hours: String(P.hours || ""), holiday: !!holiday,
      cents: c(P.perMile), perMinCents: c(P.perMinute), entryCents: c(start),
      includedMiles: P.includedMiles != null && P.includedMiles !== "" && isFinite(Number(P.includedMiles)) ? Math.max(0, Number(P.includedMiles)) : 1,
      minCents: c(P.minimum != null && P.minimum !== "" ? P.minimum : start), stepCents: c(P.step),
      slowMph: Number(P.slowMph) > 0 ? Number(P.slowMph) : 10, freeWaitSec: Math.max(0, Number(P.freeWaitSec) || 0)
    };
  }
    function meterDiscountCents(M, sub) {
    var d = M && M.discount;
    if (!d || !d.type) return { cents: 0, type: "", label: "" };
    var c = 0, lab = "";
    if (METER_DISC_PCT[d.type]) { c = Math.round(sub * METER_DISC_PCT[d.type] / 100); lab = METER_DISC_NAME[d.type] + " (" + METER_DISC_PCT[d.type] + "%)"; }
    else if (d.type === "other" && d.status === "approved") {
      if (Number(d.cents) > 0) { c = Math.round(Number(d.cents)); lab = "Discount (approved by owner)"; }
      else if (Number(d.pct) > 0) { c = Math.round(sub * Math.min(100, Number(d.pct)) / 100); lab = "Discount " + Number(d.pct) + "% (approved by owner)"; }
    }
    c = Math.max(0, Math.min(sub, c));
    return { cents: c, type: c > 0 ? d.type : "", label: lab };
  }
    function meterTripOf(M) {
    var t = (M && M.trip) || {};
    var kind = t.kind === "airport-drop" ? "airport-drop" : "local"; /* v72t (Matthew): one Airport toggle = to-airport pricing */
    var code = METER_AIRPORTS.some(function (a) { return a[0] === t.code; }) ? t.code : "IAH";
    return { kind: kind, code: code, intl: false, landedAt: 0 }; /* Matthew: no intl fee / airport wait rules on metered rides (curbside pickups) */
  }
    function meterAirportLines(M) {
    var t = meterTripOf(M), lines = [], airportCents = 0, intlCents = 0;
    if (t.kind !== "local") {
      var band = AIRPORT[METER_TIER_AIRPORT[M.tier] || "daytime"] || AIRPORT.daytime;
      var airBase = t.kind === "airport-drop" ? band.drop : band.pick;
      airportCents = Math.max(0, airBase - BASE_CENTS);
      if (airportCents) lines.push({ key: "airport", label: "Airport drop-off fee", cents: airportCents, taxed: true });
      if (t.intl) { intlCents = INTL_ARRIVAL_CENTS; lines.push({ key: "intl", label: INTL_ARRIVAL_LABEL, cents: intlCents, taxed: true }); }
    }
    return { lines: lines, cents: airportCents + intlCents, airportCents: airportCents, intlCents: intlCents };
  }
    function meterFare(M) {
    var miles = Math.max(0, Number(M && M.miles) || 0);
    var incl = M.includedMiles != null && isFinite(Number(M.includedMiles)) ? Math.max(0, Number(M.includedMiles)) : 0;
    var afterMiles = Math.max(0, miles - incl);
    var mileCents = Math.round(afterMiles * (Number(M.perMileCents) || 0));
    var waitMin = Math.max(0, Math.floor(Number(M.waitMin) || 0));
    var waitCents = waitMin * (Number(M.waitCentsPerMin) || 0);
    var base = Number(M.baseCents) || 0;
    var raw = base + mileCents + waitCents;
    var step = Math.max(0, Math.round(Number(M.stepCents) || 0));
    /* v71: clean quarter-dollar steps after the start (v70 counted the steps from the start: $12.10 -> $12.35 -> $12.60) */
    var stepped = raw <= base ? base : (step > 0 ? Math.max(base, Math.ceil(raw / step) * step) : raw);
    var min = Math.max(0, Math.round(Number(M.minCents) || 0));
    var final = !!M.status && M.status !== "running";
    var sub = final ? Math.max(min, stepped) : stepped;
    var air = meterAirportLines(M); /* v72t: airport fee + international arrival (taxed, like the quote page / app) */
    var meterSub = sub;
    sub += air.cents;
    var setFare = Math.round(Number(M && M.setFareCents) || 0) > 0 ? Math.round(Number(M.setFareCents)) : 0;
    var meterReadingCents = sub; /* v73: what the meter would have charged (kept for testing on set-fare rides) */
    if (setFare) sub = setFare; /* v73: PCS set the fare before the ride -> charge it, not the meter price */
    var disc = setFare ? { cents: 0, type: null, label: "" } : meterDiscountCents(M, sub); /* v73: Senior / Military 10% or an owner-approved Other discount, before tax */
    var grossSub = sub;
    sub = Math.max(0, sub - disc.cents);
    var bp = Math.round((Number(M.taxRate) || 0) * 1000000); /* rate in millionths: whole-number math, half-cent rounds up */
    var tax = bp > 0 ? Math.round(sub * bp / 1000000) : 0;
    return { grossSub: grossSub, discountCents: disc.cents, discountType: disc.type, discountLabel: disc.label, base: base, miles: Math.round(miles * 100) / 100, includedMiles: incl, afterMiles: Math.round(afterMiles * 100) / 100,
      mileCents: mileCents, waitMin: waitMin, waitCents: waitCents, raw: raw,
      roundCents: stepped - raw, meter: stepped, minAdd: meterSub - stepped, minApplied: meterSub > stepped, /* v73: meter vs minimum only (airport fee / discount are their own lines) */ minCents: min, freeMin: Math.max(0, Number(M.freeUsed) || 0),
      feeLines: air.lines, airportCents: air.airportCents, intlCents: air.intlCents, meterSub: meterSub,
      sub: sub, tax: tax, total: sub + tax, setFare: !!setFare, meterReadingCents: meterReadingCents };
  }
  /* ===== v75s SHARED scheduled-ride estimate (IDENTICAL text in app/app.js and god/god.js; tests compare them) =====
     Same meter rates as the driver meter for the PICKUP time (day / night / late, holidays = night rate), airport fee from
     row.trip when PCS set one, the ride's one discount (meterDiscount, or God's discountPct as an approved discount), tax.
     Range = road miles (low) .. +10 % miles and 20 % of the drive time as slow minutes (high), like the meter's estimate.
     Set-fare (account) rides show "Set fare $X". Saved on the ride row (est*) so the driver app and God mode show one number. */
  function schedEstDisc(r) {
    if (r && r.meterDiscount && typeof r.meterDiscount === "object" && r.meterDiscount.type) return r.meterDiscount; /* Worker copy (discOverlay) */
    var p = Number(r && r.discountPct);
    return p > 0 ? { type: "other", status: "approved", pct: Math.min(p, 50) } : null; /* r4: fallback capped at 50% */
  }
  function schedEstSetFare(r) { return !!r && r.fixedFare === true && r.fareBeforeTax != null && isFinite(Number(r.fareBeforeTax)) && Number(r.fareBeforeTax) > 0; }
  function schedEstKey(r) {
    var st = (r && r.stopsGeo || [])[0], d = schedEstDisc(r);
    return ["v1", r.pickup || "", r.pickupLat == null ? "" : r.pickupLat, r.dropoff || "", r.dropoffLat == null ? "" : r.dropoffLat, st ? st.address : "",
      r.start || "", schedEstSetFare(r) ? "F" + Number(r.fareBeforeTax) : "", d ? JSON.stringify(d) : "", r.trip ? JSON.stringify(r.trip) : ""].join("|");
  }
  function schedEstCalc(r, miles, minutes) {
    if (schedEstSetFare(r)) {
      var sc = Math.round(Number(r.fareBeforeTax) * 100);
      return { setFare: true, loCents: sc, hiCents: sc, miles: miles, minutes: minutes, text: "Set fare $" + (sc / 100).toFixed(2) };
    }
    var t = Date.parse(r.start || "");
    var band = meterBand(new Date(isFinite(t) ? t : Date.now()));
    var base = { baseCents: band.entryCents, includedMiles: band.includedMiles, perMileCents: band.cents, waitCentsPerMin: band.perMinCents, minCents: band.minCents,
      stepCents: band.stepCents, taxRate: Number(METER_TAX_RATE) > 0 && Number(METER_TAX_RATE) < 0.5 ? Number(METER_TAX_RATE) : 0, status: "ended", tier: band.key,
      trip: r.trip || null, discount: schedEstDisc(r) };
    var mi = Math.max(0, Number(miles) || 0), mn = Math.max(0, Number(minutes) || 0);
    var lo = meterFare(Object.assign({}, base, { miles: mi, waitMin: 0 }));
    var hi = meterFare(Object.assign({}, base, { miles: mi * 1.1, waitMin: Math.round(mn * 0.2) }));
    var loD = Math.floor(lo.total / 100), hiD = Math.max(loD + 1, Math.ceil(hi.total / 100));
    var extra = (lo.feeLines || []).map(function (f) { return f.label + " $" + (f.cents / 100).toFixed(2); });
    if (lo.discountCents > 0) extra.push(lo.discountLabel + " \u2212$" + (lo.discountCents / 100).toFixed(2));
    return { setFare: false, loCents: loD * 100, hiCents: hiD * 100, miles: Math.round(mi * 10) / 10, minutes: Math.round(mn), band: band.label,
      discountLabel: lo.discountCents > 0 ? lo.discountLabel : "", feeLines: lo.feeLines || [],
      text: "$" + loD + "\u2013$" + hiD + " (about " + (Math.round(mi * 10) / 10) + " mi, " + band.label + " rate, tax included" + (extra.length ? "; " + extra.join("; ") : "") + ")" };
  }
  /* road route: the Worker (/route, Google Routes) -> public OSRM -> straight line x1.3 at 30 mph, same order as the meter */
  function schedEstRoute(pts) {
    var to = function (p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]); };
    var straight = function () { var mi = 0, i; for (i = 1; i < pts.length; i += 1) mi += schedEstHav(pts[i - 1], pts[i]) * 1.3; return { miles: mi, minutes: mi * 2, approx: true }; };
    var pick = function (d) { var r = d && d.routes && d.routes[0]; return r && isFinite(+r.distance) && isFinite(+r.duration) ? { miles: +r.distance / 1609.344, minutes: +r.duration / 60, approx: false } : null; };
    if (typeof fetch !== "function") return Promise.resolve(straight());
    return to(fetch(SCHED_EST_WORKER + "/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: pts.map(function (p) { return { lat: +p.lat, lng: +p.lng }; }) }) })
      .then(function (x) { return x.json(); }), 6000).then(function (d) { return d && d.ok && !d.fallback ? pick(d) : null; }).catch(function () { return null; })
      .then(function (r) {
        if (r) return r;
        return to(fetch("https://router.project-osrm.org/route/v1/driving/" + pts.map(function (p) { return p.lng + "," + p.lat; }).join(";") + "?overview=false").then(function (x) { return x.json(); }), 9000)
          .then(pick).catch(function () { return null; });
      }).then(function (r) { return r || straight(); });
  }
  function schedEstHav(a, b) {
    var R = 3958.8, k = Math.PI / 180, dLa = (b.lat - a.lat) * k, dLo = (b.lng - a.lng) * k;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* the saved estimate when it was figured for these exact ride details */
  function schedEstSaved(r) { return r && r.estKey && r.estKey === schedEstKey(r) && r.estText ? { text: String(r.estText), loCents: Number(r.estLoCents), hiCents: Number(r.estHiCents) } : null; }
  function schedEstPatch(r, e, by) {
    return { estKey: schedEstKey(r), estText: e.text, estLoCents: e.loCents, estHiCents: e.hiCents, estMiles: e.miles == null ? null : Math.round(Number(e.miles) * 10) / 10,
      estMinutes: e.minutes == null ? null : Math.round(Number(e.minutes)), estAt: Date.now(), estBy: by };
  }
  /* ===== end shared estimate ===== */
  return { key: schedEstKey, calc: schedEstCalc, route: schedEstRoute, saved: schedEstSaved, patch: schedEstPatch, setFare: schedEstSetFare, band: meterBand, fare: meterFare };
  })();
  window.__pcsGodEst = GEST; /* test hook */
  /* ---------- v75r: change a scheduled ride's drop-off / stop from the board (Google Places search via the Worker) ----------
     Saved on /rides/PCSCALND/{id} with dropoffEdited:true so the calendar sync never overwrites it. The driver app picks it up
     on its next refresh: new route, turn-by-turn and estimate; the meter charges for where the rider actually gets out. */
  var dbDrop = { id: "", field: "drop", list: [], seq: 0, timer: 0, sess: "" };
  function dbDropRow(id) { var row = null; (state.calendar || []).forEach(function (r) { if (r && r.id === id) row = r; }); return row; }
  function dbDropClose() { var m = document.getElementById("db-drop-modal"); if (m) m.remove(); dbDrop.id = ""; }
  function dbDropOpen(id, field) {
    var r = dbDropRow(id); if (!r) return;
    dbDropClose();
    dbDrop.id = id; dbDrop.field = field === "stop" ? "stop" : field === "pick" ? "pick" : "drop"; /* v75t: pick = pickup */ dbDrop.list = [];
    var cur = dbDrop.field === "stop" ? ((r.stopsGeo && r.stopsGeo[0] && r.stopsGeo[0].address) || (r.stops && r.stops[0]) || "") : dbDrop.field === "pick" ? (r.pickup || "") : (r.dropoff || "");
    var big = "display:block;width:100%;min-height:56px;font-size:20px;font-weight:800;border-radius:12px;margin:8px 0;cursor:pointer;";
    var m = document.createElement("div");
    m.id = "db-drop-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
    m.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:56px 12px 12px;overflow:auto";
    m.innerHTML = '<div style="background:#fff;color:#111;border:3px solid #0b6b3a;border-radius:16px;max-width:560px;width:100%;padding:16px">' +
      '<button type="button" id="db-drop-close" style="' + big + 'background:#0b3d23;color:#fff;border:0;margin-top:0">Close</button>' +
      '<h2 style="margin:4px 0 6px;color:#0b3d23">' + (dbDrop.field === "stop" ? "Stop" : dbDrop.field === "pick" ? "Pickup" : "Drop-off") + " \u00b7 " + esc(r.rider || "ride") + "</h2>" +
      '<p style="margin:0 0 8px;color:#374151">Pickup: ' + esc(r.pickup || "") + "</p>" +
      '<label for="db-drop-q" style="display:block;font-weight:800;color:#111;margin:0 0 4px">Search a place or type the address</label>' +
      '<input id="db-drop-q" type="text" autocomplete="off" spellcheck="false" value="' + esc(cur) + '" style="width:100%;font-size:18px;padding:10px;border:2px solid #0b3d23;border-radius:10px;background:#fff;color:#111">' +
      '<div id="db-drop-list"></div>' +
      '<p id="db-drop-msg" role="status" style="color:#7c2d12;font-weight:700;margin:6px 0"></p>' +
      '<p id="db-drop-est" role="status" style="display:' + (GEST.saved(r) || GEST.setFare(r) ? "block" : "none") + ';color:#111;background:#ecfdf5;border:2px solid #0b6b3a;border-radius:10px;padding:10px;font-size:17px;font-weight:700;margin:6px 0">' + esc(GEST.setFare(r) ? "Price: " + GEST.calc(r, 0, 0).text : GEST.saved(r) ? "Current estimate: " + GEST.saved(r).text : "") + "</p>" +
      '<button type="button" id="db-drop-typed" style="' + big + 'background:#0b6b3a;color:#fff;border:0">Save as typed</button>' +
      (dbDrop.field === "stop" ? '<button type="button" id="db-drop-clear" style="' + big + 'background:#fff;color:#0b3d23;border:2px solid #0b3d23">Remove the stop</button>' : "") +
      '<p style="color:#374151;font-size:14px;margin:6px 0 0">The driver app updates the route and estimate. Metered rides charge for where the rider actually gets out; a set fare stays as saved in the Fare box.</p>' +
      "</div>";
    document.body.appendChild(m);
    var q = document.getElementById("db-drop-q");
    try { q.focus(); q.select(); } catch (e) {}
    document.getElementById("db-drop-close").addEventListener("click", dbDropClose);
    q.addEventListener("input", function () {
      clearTimeout(dbDrop.timer);
      var my = ++dbDrop.seq, text = String(q.value || "").trim();
      if (text.length < 3) { document.getElementById("db-drop-list").innerHTML = ""; return; }
      dbDrop.timer = setTimeout(function () {
        if (!dbDrop.sess) dbDrop.sess = "god-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        arPlacesPost("/autocomplete", { input: text, sessionToken: dbDrop.sess, lat: 29.7604, lng: -95.3698, radius: 80000 }).then(function (d) {
          if (my !== dbDrop.seq || !document.getElementById("db-drop-list")) return;
          dbDrop.list = d && Array.isArray(d.predictions) ? d.predictions.slice(0, 6) : [];
          var box = document.getElementById("db-drop-list");
          box.innerHTML = dbDrop.list.map(function (p, i) {
            return '<button type="button" class="db-drop-pick" data-i="' + i + '" style="display:block;width:100%;text-align:left;background:#fff;color:#111;border:1px solid #9ca3af;border-radius:10px;padding:10px;margin:6px 0;font-size:16px;min-height:48px"><strong style="color:#111">' + esc(p.main || "") + '</strong><br><span style="color:#374151;font-size:14px">' + esc(p.sub || "") + "</span></button>";
          }).join("") + (dbDrop.list.length ? '<p style="text-align:right;margin:0;font-size:12px;color:#374151">Powered by Google</p>' : "");
          Array.prototype.forEach.call(box.querySelectorAll(".db-drop-pick"), function (b) {
            b.addEventListener("click", function () {
              var p = dbDrop.list[+b.getAttribute("data-i")]; if (!p) return;
              arPlacesPost("/details", { placeId: p.placeId, sessionToken: dbDrop.sess }).then(function (dd) {
                dbDrop.sess = "";
                var pl = dd && dd.place;
                dbDropSave(pl && pl.formatted ? String(pl.formatted).replace(/,\s*(USA|United States)$/i, "") : [p.main, p.sub].filter(Boolean).join(", "), pl ? pl.lat : null, pl ? pl.lng : null);
              });
            });
          });
        });
      }, 250);
    });
    document.getElementById("db-drop-typed").addEventListener("click", function () {
      var text = String(q.value || "").trim(); if (!text) return;
      arPlacesPost("/geocode", { address: text.slice(0, 200) }).then(function (d) { var pl = d && d.place; dbDropSave(text, pl ? pl.lat : null, pl ? pl.lng : null); }); /* saved exactly as typed */
    });
    var clr = document.getElementById("db-drop-clear");
    if (clr) clr.addEventListener("click", function () { dbDropSave("", null, null); });
  }
  function dbDropPt(text, lat, lng) {
    if (lat != null && lng != null && isFinite(+lat) && isFinite(+lng)) return Promise.resolve({ lat: +lat, lng: +lng });
    text = String(text || "").trim();
    if (text.length < 5) return Promise.resolve(null);
    return arPlacesPost("/geocode", { address: text.slice(0, 200) }).then(function (d) { var p = d && d.place; return p && isFinite(+p.lat) && isFinite(+p.lng) && p.lat != null ? { lat: +p.lat, lng: +p.lng } : null; });
  }
  /* v75s: the new price with the driver app's math (GEST); resolves { text } or null */
  function dbDropEstimate(r) {
    if (GEST.setFare(r)) return Promise.resolve(GEST.calc(r, 0, 0));
    if (!r.dropoff) return Promise.resolve(null);
    var st = (r.stopsGeo || [])[0];
    var jobs = [dbDropPt(r.pickup, r.pickupLat, r.pickupLng)];
    if (st) jobs.push(dbDropPt(st.address, st.lat, st.lng));
    jobs.push(dbDropPt(r.dropoff, r.dropoffLat, r.dropoffLng));
    return Promise.all(jobs).then(function (pts) {
      if (pts.some(function (p) { return !p; })) return null;
      return GEST.route(pts).then(function (rt) { return GEST.calc(r, rt.miles, rt.minutes); });
    }).catch(function () { return null; });
  }
  function dbDropSave(text, lat, lng) {
    var id = dbDrop.id, field = dbDrop.field, r = dbDropRow(id); if (!id || !r) return Promise.resolve();
    var ok = function (v) { return v != null && v !== "" && isFinite(+v); };
    var now = Date.now(), t = String(text || "").trim().slice(0, 400), patch;
    var lbl = field === "stop" ? "Stop" : field === "pick" ? "Pickup" : "Drop-off";
    if (field === "pick") patch = { pickup: t, pickupLat: ok(lat) ? +lat : null, pickupLng: ok(lng) ? +lng : null, pickupEdited: true, pickupEditedBy: "god", pickupEditedAt: now, updatedAt: now }; /* v75t */
    else if (field === "stop") patch = { stops: t ? [t] : [], stopsGeo: t ? [{ address: t, lat: ok(lat) ? +lat : null, lng: ok(lng) ? +lng : null }] : [], stopsEdited: true, stopsEditedBy: "god", stopsEditedAt: now, updatedAt: now };
    else patch = { dropoff: t, dropoffLat: ok(lat) ? +lat : null, dropoffLng: ok(lng) ? +lng : null, dropoffEdited: true, dropoffEditedBy: "god", dropoffEditedAt: now, updatedAt: now };
    var msg = function (txt) { var m = document.getElementById("db-drop-msg"); if (m) m.textContent = txt; };
    var est = function (txt) { var m = document.getElementById("db-drop-est"); if (m) { m.style.display = "block"; m.textContent = txt; } };
    msg("Saving\u2026");
    return godFetch(calendarUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("save");
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      msg("");
      est(lbl + " saved. Figuring the new price\u2026");
      return dbDropEstimate(r).then(function (e) {
        var line = lbl + " saved for " + (r.rider || "ride") + (t ? ": " + t : "") + ".";
        if (!e) { est(line + " The price shows once the addresses are found on the map."); state.boardNotice = line; return refresh(); }
        est(line + " " + (e.setFare ? "Price: " : "New estimate: ") + e.text);
        state.boardNotice = line + " " + (e.setFare ? "Price: " : "New estimate: ") + e.text;
        if (e.setFare) return refresh();
        var ep = GEST.patch(r, e, "god");
        return godFetch(calendarUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ep) }).then(function (res2) {
          if (res2.ok) Object.keys(ep).forEach(function (k) { r[k] = ep[k]; });
          return refresh();
        });
      });
    }).catch(function () { msg(/^Not saved/.test(state.boardNotice || "") ? state.boardNotice : "Save did not go through. Check the signal and tap again."); });
  }
  function rideStartMs(row) { var t = Date.parse(row && row.start || ""); return isFinite(t) ? t : 0; }
  function completedEarly(row) { return !!row && row.status === "completed" && (row.completedEarly === true || (rideStartMs(row) && Number(row.completedAt) && Number(row.completedAt) < rideStartMs(row))); }
  /* v73: Undo an early completion: back to "assigned", the driver's earnings entry for this ride is removed. */
  function undoCalendarComplete(eventId) {
    var row = null;
    (state.calendar || []).forEach(function (r) { if (r && r.id === eventId) row = r; });
    if (!row) return Promise.reject(new Error("missing"));
    var drv = row.assignedDriverId, code = row.code;
    var patch = { status: drv ? "assigned" : "open", completedAt: null, commissionCents: null, completedEarly: null, updatedAt: Date.now() };
    return godFetch(calendarUrl(eventId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("undo");
      if (!drv || !code) return null;
      return godFetch(historyUrl(drv, code), { method: "DELETE" }).then(function (r2) { if (r2 && !r2.ok) throw new Error("undo-history"); });
    }).then(function () {
      state.boardNotice = "Undone · " + (row.rider || "ride") + " is back to assigned; the early earnings entry was removed.";
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
    if (ridePctOf(row) != null) pct = ridePctOf(row); /* v76d: per-ride % wins over the driver's own % */
    var fareCentsV72d = Math.round(fare * 100); /* v72d: fare box is dollars; history is cents */
    if (row.prepaid && row.prepaidAmountCents != null && row.paidSquareCents == null) { fareCentsV72d = Math.round(+row.prepaidAmountCents); } /* v76d: invoice (pre-tax) wins; tax never to the driver */
    var paidTaxV75w = 0;
    if (row.paidSquareCents != null) { var pm = paidSquareMath((row.paidSquareCents / 100).toFixed(2), "", pct, 0); fareCentsV72d = pm.preTaxCents; paidTaxV75w = pm.taxCents; } /* v75w: paid in Square (incl. tax) wins; driver % on the pre-tax part */
    var commissionCents = Math.round(fareCentsV72d * (pct / 100));
    var day = boardDayKey(row.start) || chicagoToday();
    var code = ownCode(row); /* v76d */
    var entry = {
      scheduleId: eventId, rideCommissionPct: ridePctOf(row),
      code: code,
      day: day,
      completedAt: Date.now(),
      when: fmtBoardWhen(row.start),
      pickup: row.pickup || "",
      drop: row.dropoff || "",
      rawMiles: null,
      billedMiles: null,
      fareSub: fareCentsV72d,
      fareTax: paidTaxV75w,
      fareTotal: fareCentsV72d + paidTaxV75w,
      commissionPct: pct,
      commissionCents: commissionCents,
      riderName: row.rider || "",
      source: row.source === "manual" ? "manual" : "calendar",
      tipCents: Number(row.tipCents) || 0, tipVia: Number(row.tipCents) > 0 ? "card" : null, cardTipCents: Number(row.tipCents) || 0, /* v73: 100% driver, not in commission */
      paidSquareCents: row.paidSquareCents != null ? row.paidSquareCents : null /* v75w */
    };
    var next = Object.assign({}, row, {
      status: "completed",
      completedAt: Date.now(),
      completedEarly: rideStartMs(row) > Date.now() ? true : null, /* v73: before its start time -> "Completed early – Undo" */
      code: code,
      fareBeforeTax: fare,
      commissionCents: commissionCents,
      updatedAt: Date.now()
    });
    return godHistoryGuard(row.assignedDriverId, code, entry).then(function (g) { /* v76d: never overwrite another ride's entry */
      entry.code = g.code; next.code = g.code;
      return putCalendarRide(next).then(function () {
        if (g.skip) return null;
        return godFetch(historyUrl(row.assignedDriverId, g.code), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry)
        });
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
    /* v76d (Matthew 10/18 "I reset it every day. It doesn't stay."): only the SAVED rate counts. A number typed in the
       box but not saved (or refused by the database) used to drive every God-mode calculation until the page reloaded. */
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
    var list = Object.keys(raw).map(function (code) {
      var row = raw[code] || {};
      row.code = row.code || code;
      return row;
    });
    /* v73: a completed God-added (manual) ride counts for its driver even if its pay-week entry never landed in DRVRHSTY */
    var have = {}; list.forEach(function (e) { have[e.code] = true; });
    var cal = state.calendarRaw || {};
    Object.keys(cal).forEach(function (id) {
      var r = cal[id];
      if (!r || r.source !== "manual" || r.status !== "completed" || r.assignedDriverId !== driverId || !r.code || have[r.code]) return;
      try { var e = addRideHistoryEntry(r, r.completedAt); e.fromCalendar = true; list.push(e); have[r.code] = true; } catch (x) {}
    });
    list = godDedupeEntries(list, chicagoToday()); /* v77.11: one row per real ride, no future rides */
    list.forEach(function (e) { invApply(e, state.invKV || {}, { driverId: driverId, card: e && e.scheduleId ? (state.calendarRaw || {})[e.scheduleId] : null, pctFor: commissionPctFor, kvPct: state.ridePctKV || {} }); }); /* r3: God-side % + one entry per card; r4 KV % */
    payBalance(list, { driverId: driverId, pctFor: commissionPctFor, kvPct: state.ridePctKV || {}, cards: state.calendarRaw || {}, charges: state.payCharges || {}, holds: state.payHolds || {}, kvDisc: state.discKV || {}, discPresets: state.discPresets || {} }); /* r5: normalize every entry (N1-N3) */
    return list.sort(function (a, b) {
      return Number(b.completedAt || 0) - Number(a.completedAt || 0);
    });
  }
  /* v77.11 r2 (Harry M1/M2): one row per real ride, never hiding money.
     Hide a card entry ONLY when it is $0 fare + $0 tip and its metered twin really exists (same scheduleId, or the code in its
     meterCode is in the list), or when it exactly duplicates the metered entry (same fare, tax, tip). A card entry with real
     money next to a metered entry stays and is flagged dupSuspect ("duplicate?"). Entries dated after today never count. (pure, tested) */
  function godDedupeEntries(list, today) {
    var metered = {}, codes = {}, gone = {};
    list.forEach(function (e) { if (!e) return; codes[e.code] = e; if (e.rideType === "metered" && e.scheduleId) metered[e.scheduleId] = e; });
    var zero = function (e) { return !(Number(e.fareSub) || 0) && !(Number(e.fareTotal) || 0) && !(Number(e.tipCents) || 0); };
    var same = function (a, b) { return (Number(a.fareSub) || 0) === (Number(b.fareSub) || 0) && (Number(a.fareTax) || 0) === (Number(b.fareTax) || 0) && (Number(a.tipCents) || 0) === (Number(b.tipCents) || 0); };
    list.forEach(function (e) {
      if (!e || e.rideType === "metered") return;
      var twin = (e.scheduleId && metered[e.scheduleId] && metered[e.scheduleId].code !== e.code) ? metered[e.scheduleId] : null;
      if (!twin && e.meterCode && e.meterCode !== e.code && codes[e.meterCode]) twin = codes[e.meterCode];
      if (!twin) return;
      if (zero(e) || same(e, twin)) gone[e.code] = 1; else e.dupSuspect = twin.code;
    });
    return list.filter(function (e) { return e && !gone[e.code] && !(today && e.day && String(e.day) > today); });
  }
  /* v77.11 r2 (Harry M3): pay uses the Worker-verified invoice amount (KV, read from Square by the Worker), never the open
     Firebase prepaidAmountCents. Mismatch -> the KV amount wins and the entry is flagged; no KV record -> flagged unverified. (pure, tested) */
  /* r3 (Harry r2 #2/#3): commission is ALWAYS re-figured from God-controlled data: the God-set per-ride % on the card
     (rideCommissionPctBy "god"), else the driver's saved rate (commissionPctFor). The entry's own commissionPct/commissionCents
     are never used. One entry per card: the first entry (by the card's assigned driver) claims it; any other entry pointing at
     the same card is flagged dupSuspect and not verified. opts = { driverId, card, pctFor } (God passes all three). (pure, tested) */
  function invApply(e, kv, opts) {
    if (!e) return e;
    opts = opts || {};
    var k = kv && e.scheduleId && Object.prototype.hasOwnProperty.call(kv, e.scheduleId) ? kv[e.scheduleId] : null;
    var claims = !!(e.prepaidInvoiceNo || e.fareSource === "square_invoice" || e.paidVia === "square_invoice");
    if (!k) { if (claims) e.invoiceUnverified = true; return e; }
    var card = opts.card || null;
    if (card && opts.driverId && String(card.assignedDriverId || "") !== String(opts.driverId)) { e.invoiceUnverified = true; e.invoiceWrongDriver = true; return e; }
    if (!Object.prototype.hasOwnProperty.call(kv, "__claims")) Object.defineProperty(kv, "__claims", { value: {}, enumerable: false });
    var owner = kv.__claims[e.scheduleId];
    if (owner && owner !== e.code) { e.dupSuspect = owner; e.invoiceUnverified = true; delete e.invoiceVerified; return e; }
    kv.__claims[e.scheduleId] = e.code;
    var sub = Math.round(Number(k.amountCents) || 0), tax = Math.round(Number(k.amountTaxCents != null ? k.amountTaxCents : k.taxCents) || 0);
    /* r4 (Harry r3): a % above 80 (policy max) is honored ONLY from the God-only Worker KV per-ride override (opts.kvPct);
       Firebase-sourced % (card rideCommissionPct, roster rate) is capped at 80 and the ride flagged. No caller info -> 70% + unverified. */
    var pct = null, kvp = opts.kvPct && e.scheduleId && Object.prototype.hasOwnProperty.call(opts.kvPct, e.scheduleId) ? opts.kvPct[e.scheduleId] : null;
    if (kvp && isFinite(+kvp.pct)) pct = Math.min(100, Math.max(0, Math.round(+kvp.pct)));
    else {
      if (card && card.rideCommissionPct != null && card.rideCommissionPctBy === "god" && isFinite(+card.rideCommissionPct)) pct = Math.round(+card.rideCommissionPct);
      else if (typeof opts.pctFor === "function" && opts.driverId) pct = Number(opts.pctFor(opts.driverId));
      if (pct == null || !isFinite(pct)) { pct = typeof DEFAULT_COMMISSION_PCT !== "undefined" ? DEFAULT_COMMISSION_PCT : 70; e.invoiceUnverified = true; }
      if (pct > 80) { e.pctCapped = { asked: pct }; pct = 80; }
      pct = Math.max(0, pct);
    }
    if ((Number(e.fareSub) || 0) !== sub || (Number(e.fareTax) || 0) !== tax) {
      e.invoiceMismatch = { appFareSub: Number(e.fareSub) || 0, appFareTax: Number(e.fareTax) || 0, appCommission: Number(e.commissionCents) || 0, invoiceNo: k.invoiceNo };
      e.fareSub = sub; e.fareTax = tax; e.fareTotal = sub + tax;
    }
    var com = Math.round(sub * pct / 100);
    if ((Number(e.commissionCents) || 0) !== com && !e.invoiceMismatch) e.invoiceMismatch = { appFareSub: sub, appFareTax: tax, appCommission: Number(e.commissionCents) || 0, invoiceNo: k.invoiceNo, commissionOnly: true };
    e.commissionCents = com; e.commissionPct = pct;
    if (e.invoiceUnverified) { delete e.invoiceVerified; return e; }
    if (typeof Symbol === "function") e[Symbol.for("pcsInvPct")] = pct; /* r5: trusted this load only (JSON can't forge a Symbol key) */
    e.invoiceVerified = String(k.invoiceNo || ""); return e;
  }
  function invFlagHtml(e) { /* r5: payout flags first, then the invoice flag */
    if (!e) return "";
    var r5 = (e.commissionAdjusted ? '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">Share re-figured: app said ' + esc(fmtCents(e.commissionAdjusted.app)) + ", paying " + esc(fmtCents(e.commissionAdjusted.now)) + " (" + esc(String(e.commissionPct)) + "%)</strong><br>" : "") +
      (e.owedAdjusted ? '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">Cash owed re-figured: app said ' + esc(fmtCents(e.owedAdjusted.app)) + ", owed " + esc(fmtCents(e.owedAdjusted.now)) + "</strong><br>" : "") +
      holdHtml(e) +
      (e.discountUnconfirmed ? '<strong style="background:#b45309;color:#fff;padding:2px 6px;border-radius:6px">Discount not confirmed by PCS: share on the discounted fare</strong><br>' : "") +
      (e.fareUnverified && !e.invoiceVerified ? '<span class="fine" style="color:#b45309">Fare not checked against a Square invoice (paid as logged).</span><br>' : "");
    return r5 + invFlagHtmlBase(e);
  }
  /* r6: held money + God-only "Approve hold" (Worker KV holdok; never written to Firebase) */
  function holdHtml(e) {
    var h = e && e.held; if (!h) return "";
    var key = typeof Symbol === "function" ? e[Symbol.for("pcsHoldKey")] : ""; if (!key) return "";
    var btn = function (kind, cents, label) { return ' <button type="button" class="btn-hold-ok" data-hold-key="' + esc(key) + '" data-hold-kind="' + kind + '" data-hold-cents="' + esc(String(cents)) + '" style="background:#2e7d32;color:#fff;border:0;border-radius:10px;font-weight:800;font-size:16px;min-height:44px;padding:6px 14px">' + label + "</button>"; };
    var red = function (t) { return '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">' + t + "</strong>"; };
    return (h.fare ? red("Fare over the limit: " + esc(fmtCents(h.fare)) + " held (no Square charge/invoice on file)") + btn("fare", h.fare, "Approve hold") + "<br>" : "") +
      (h.toll ? red("Tolls over $50: " + esc(fmtCents(h.toll)) + " held") + btn("toll", h.toll, "Approve hold") + "<br>" : "") +
      (h.collect ? red("No proof PCS was paid (no Square charge or invoice on file): counted as cash the driver owes") + btn("pcs_collected", 0, "Approve: PCS was paid (card / Zelle / check)") + "<br>" : "") +
      (h.driver ? red("Square charge on file, but the driver isn't confirmed yet: counted as cash owed") + ' <button type="button" class="btn-chg-driver" data-chg-key="' + esc(key) + '" style="background:#2e7d32;color:#fff;border:0;border-radius:10px;font-weight:800;font-size:16px;min-height:44px;padding:6px 14px">Confirm driver</button><br>' : "") +
      (h.dup ? red("Same Square charge as another ride (" + esc(String(e.dupSuspect || "")) + "): counted as cash owed until checked") + "<br>" : "");
  }
  if (typeof document !== "undefined") document.addEventListener("click", function (ev) { var b = ev.target && ev.target.closest ? ev.target.closest("[data-hold-key]") : null; if (!b) return;
    var kind = b.getAttribute("data-hold-kind"), cents = Number(b.getAttribute("data-hold-cents")) || 0;
    if (!window.confirm(kind === "pcs_collected" ? "Approve: PCS received the money for this ride (card, Zelle, check)?" : "Release " + fmtCents(cents) + " for this ride?")) return;
    b.disabled = true;
    atxPost("/god/hold/approve", { key: b.getAttribute("data-hold-key"), kind: kind, cents: cents, by: (typeof godWho === "function" ? godWho() : "god") }).then(function (d) {
      state.payHolds = state.payHolds || {}; if (d && d.approved) state.payHolds[d.approved.key + "|" + d.approved.kind] = d.approved;
      state.boardNotice = "Saved \u2713 Hold approved."; refresh();
    }).catch(function (er) { b.disabled = false; window.alert("Couldn't save: " + String(er && er.message || er)); }); }, true);
  if (typeof document !== "undefined") document.addEventListener("click", function (ev) { var b = ev.target && ev.target.closest ? ev.target.closest("[data-chg-key]") : null; if (!b) return; /* r8 */
    var k = String(b.getAttribute("data-chg-key") || ""), cut = k.lastIndexOf("|"), drv = k.slice(0, cut), code = k.slice(cut + 1);
    if (!drv || !code) return;
    b.disabled = true;
    /* r9: show every competing claim before confirming */
    atxPost("/god/charge/claims", { code: code }).then(function (r) {
      var c = (r && r.claims) || {}, nm = function (x) { return x ? String(x).split("_")[0] : "(none)"; };
      var lines = ["Who drove ride " + code + "?", "",
        "Signed fare (Worker): " + (c.signedFare ? nm(c.signedFare.driverId) + (c.signedFare.at ? " at " + new Date(c.signedFare.at).toLocaleString() : "") : "(none)"),
        "Firebase ride: " + (c.firebase ? nm(c.firebase.assignedDriverId || c.firebase.driverId) : "(none)"),
        "Square charge record: " + (c.charge ? nm(c.charge.driverId) : "(none)"),
        "Payout lists with this ride: " + ((c.payoutEntries || []).map(nm).join(", ") || "(none)")];
      var multi = (c.payoutEntries || []).length > 1 || (c.signedFare && c.signedFare.driverId && c.signedFare.driverId !== "god" && c.signedFare.driverId !== drv) || (c.firebase && c.firebase.assignedDriverId && c.firebase.assignedDriverId !== drv);
      if (multi) lines.push("", "\u26a0 These don\u2019t all agree. Check before confirming.");
      lines.push("", "Confirm " + nm(drv) + " drove this ride?");
      if (!window.confirm(lines.join("\n"))) { b.disabled = false; return null; }
      return atxPost("/god/charge/driver", { code: code, driverId: drv });
    }).then(function (d) { if (!d) return;
      state.payCharges = state.payCharges || {}; if (d && d.charge) state.payCharges[code] = d.charge;
      state.boardNotice = "Saved \u2713 Driver confirmed."; refresh();
    }).catch(function (er) { b.disabled = false; window.alert("Couldn't save: " + String(er && er.message || er)); }); }, true);
  function invFlagHtmlBase(e) {
    if (!e) return "";
    if (e.pctCapped) return '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">Asked for ' + esc(String(e.pctCapped.asked)) + "%: paid at 80% until PCS confirms the % on this ride in God mode</strong><br>";
    if (e.invoiceWrongDriver) return '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">Invoice ride belongs to another driver: check before payout</strong><br>';
    if (e.invoiceMismatch && e.invoiceMismatch.commissionOnly) return '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">Invoice #' + esc(e.invoiceMismatch.invoiceNo) + ": app share " + esc(fmtCents(e.invoiceMismatch.appCommission)) + ", re-figured " + esc(fmtCents(e.commissionCents)) + " (" + esc(String(e.commissionPct)) + "%)</strong><br>";
    if (e.invoiceMismatch) return '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">Invoice #' + esc(e.invoiceMismatch.invoiceNo) + ": app said " + esc(fmtCents(e.invoiceMismatch.appFareSub)) + ", Square " + esc(fmtCents(e.fareSub)) + " (Square used)</strong><br>";
    if (e.invoiceUnverified) return '<strong style="background:#b45309;color:#fff;padding:2px 6px;border-radius:6px">Invoice not verified by PCS: check before payout</strong><br>';
    if (e.dupSuspect) return '<strong style="background:#b45309;color:#fff;padding:2px 6px;border-radius:6px">Duplicate? Same ride as ' + esc(e.dupSuspect) + "</strong><br>";
    return "";
  }
  function invLoad() {
    atxPost("/god/payout/records", {}).then(function (d) { state.payCharges = (d && d.charges) || {}; state.payHolds = (d && d.holds) || {}; state.payRecLoaded = true; }) /* r6 */
      .catch(function () { state.payCharges = state.payCharges || {}; state.payHolds = state.payHolds || {}; state.payRecLoaded = "failed"; }).then(function () { try { renderBoardLists(); } catch (e) {} });
    var rp = atxPost("/god/ridepct/list", {}).then(function (d) { state.ridePctKV = (d && d.pcts) || {}; state.ridePctLoaded = true; }).catch(function () { state.ridePctKV = state.ridePctKV || {}; state.ridePctLoaded = "failed"; }); /* r4; r5: payouts wait for it */
    return Promise.all([rp, atxPost("/god/invoices", {}).then(function (d) { state.invKV = (d && d.invoices) || {}; })]) /* fresh object = fresh one-entry-per-card claims */.catch(function () { state.invKV = state.invKV || {}; });
  }
  function invLink(id, invoiceNo, shareCents, shareTaxCents) { /* God-only: the Worker reads Square itself and stores the numbers */
    var body = { cardId: id, invoiceNo: String(invoiceNo || "") };
    if (shareCents != null) { body.shareCents = shareCents; if (shareTaxCents != null) body.shareTaxCents = shareTaxCents; }
    return atxPost("/god/invoice/link", body).then(function (d) { if (d && d.ok) { state.invKV = state.invKV || {}; if (d.invoice) state.invKV[id] = d.invoice; else delete state.invKV[id]; } return d; });
  }
  if (typeof window !== "undefined") window.__pcsGodV7711r2 = { invApply: invApply };
  if (typeof window !== "undefined") window.__pcsGodV7711 = { dedupe: godDedupeEntries };

  function totalsForDriver(driverId) {
    var entries = historyEntries(driverId);
    var rideTotal = 0;
    var commissionTotal = 0;
    var tipTotal = 0, tollTotal = 0, tollFeeTotal = 0;
    entries = entries.filter(function (e) { return !isTestRide(e); }); /* v76d: test rides count for nothing */
    entries.forEach(function (e) {
      rideTotal += Number(e.fareTotal) || 0;
      commissionTotal += Number(e.commissionCents) || 0;
      tipTotal += Number(e.tipCents) || 0; /* v70: tips go 100% to the driver */
      tollTotal += tollReimbCents(e); tollFeeTotal += tollFeeCents(e); /* v76b */
    });
    return { rideTotal: rideTotal, commissionTotal: commissionTotal, tipTotal: tipTotal, tollTotal: tollTotal, tollFeeTotal: tollFeeTotal, count: entries.length };
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

  /* v77.4: God auth is Worker-only. A kept sign-in is just a marker; the real proof is the Worker God token,
     re-checked at /god/session on every open. Changing the password revokes every token (Worker side). */
  function keepTag() {
    try { var b = new Uint8Array(32); crypto.getRandomValues(b); return Promise.resolve(Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("")); } catch (e) { return Promise.resolve(""); }
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
    var tok = "";
    try { tok = gqTok(); } catch (e) { tok = ""; }
    if (!data || !tok) { clearSession(); return Promise.resolve(""); }
    return fetch(PAY_WORKER + "/god/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ godToken: tok }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { d = d || {}; d.httpStatus = res.status; return d; }); })
      .then(function (d) {
        if (d.ok) {
          if (d.godToken) gqSetTok(d.godToken);
          gq.tokOn = true; state.godPwMust = d.mustChange === true; state.godPwDays = d.days || 45;
          return OWNER_EMAIL;
        }
        if (d.httpStatus === 401 || d.httpStatus === 403 || d.httpStatus === 400) { gqSetTok(""); clearSession(); }
        return "";
      }).catch(function () { return ""; });
  }

  function writeSession(email) {
    return keepTag().then(function (tag) {
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
    if (r.cancelledBy === "rider" && cf !== "free" && Number(r.cancelFeeCents) > 0 && !(pol && pol.charge === false)) {
      return "cancel fee " + fmtCents(r.cancelFeeCents) + " due (25% / $10 min)" + (mi ? " (driver " + mi + " mi away)" : ""); /* v72c */
    }
    if (cf === "free" || (pol && pol.charge === false) || payPol || (accepted && !(Number(r.cancelFeeCents) > 0))) {
      if (reason === "driver_location_stale" || reason === "driver_location_missing") return "free cancel (driver location not current)";
      if (reason === "not_accepted") return "free cancel (before a driver accepted)";
      if (reason === "decision_window_passed") return "free cancel (too late to check distance)";
      if (reason === "test_ride") return "free cancel (test ride)";
      if (reason === "fee_below_minimum") return "free cancel (no fare on file)";
      if (reason === "kept_from_deposit") { var kd = (pol && pol.keptFromDepositCents) || (payPol && payPol.keptFromDepositCents) || 0; return "cancel fee " + (kd ? fmtCents(kd) + " " : "") + "kept from deposit (quote ride, 25%)"; }
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
    /* v77.4: the Worker is the only place the God password is checked (the old on-phone hash is gone). */
    return fetch(PAY_WORKER + "/god/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ godPassword: String(password) }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { d = d || {}; d.httpStatus = res.status; return d; }); })
      .catch(function () { return { httpStatus: 0 }; })
      .then(function (d) {
        if (d.ok && d.godToken) {
          try { gqSetTok(d.godToken); gq.tokOn = true; gq.pw = ""; } catch (e2) {}
          state.godPwMust = d.mustChange === true; state.godPwDays = d.days || 45;
          return writeSession(e).then(function () { state.sessionEmail = e; state.screen = "board"; state.loginError = ""; return true; });
        }
        if (d.httpStatus === 403) state.loginError = "Wrong email or password.";
        else if (d.httpStatus === 429) state.loginError = "Too many tries. Wait a minute.";
        else if (d.httpStatus === 0) state.loginError = "Couldn't reach PCS. Check signal and try again.";
        else state.loginError = d.error || "Sign-in isn't available right now. Try again in a minute.";
        return false;
      });
  }
  /* v77.1: God password change (forced after the limit, or any time from the Password button) + the days setting */
  function pwWeakMsg(np) { /* v77.4: same rule as the Worker */
    np = String(np || "");
    if (np.length < 12) return "Use at least 12 characters for the new password.";
    if (!/[A-Za-z]/.test(np) || !/[0-9]/.test(np)) return "Use letters and at least one number in the new password.";
    return "";
  }
  function godPwScreenHtml() {
    var big = "display:block;width:100%;min-height:58px;font-size:20px;font-weight:700;border-radius:12px;border:0;background:#1f7a3a;color:#fff;margin-top:14px";
    var box = "display:block;width:100%;min-height:50px;font-size:18px;padding:10px;border-radius:10px;border:2px solid #1f7a3a;margin:6px 0 10px;box-sizing:border-box";
    var forced = state.godPwMust === true;
    return '<div class="login-wrap"><section class="login-card" style="max-width:520px">' +
      '<h1 style="color:#1f7a3a;font-size:26px;margin:0 0 8px">' + (forced ? "Time to set a new password" : "Change God password") + '</h1>' +
      '<p style="font-size:17px">' + (forced ? "God mode asks for a fresh password every " + esc(String(state.godPwDays || 45)) + " days. Set a new one to continue." : "Your God password is changed here.") + '</p>' +
      '<form id="godpw-form" autocomplete="off" novalidate>' +
      '<label for="godpw-cur">Current password</label><input id="godpw-cur" type="password" autocomplete="current-password" style="' + box + '">' +
      '<label for="godpw-new">New password (12+ characters, letters and a number)</label><input id="godpw-new" type="password" autocomplete="new-password" style="' + box + '">' +
      '<label for="godpw-confirm">New password again</label><input id="godpw-confirm" type="password" autocomplete="new-password" style="' + box + '">' +
      '<p class="login-error" id="godpw-error" role="alert" style="font-size:17px">' + esc(state.godPwError || "") + '</p>' +
      '<button type="submit" style="' + big + '"' + (state.godPwBusy ? " disabled" : "") + '>' + (state.godPwBusy ? "Saving…" : "Save new password") + '</button></form>' +
      (forced ? "" :
        '<form id="godpw-days-form" style="margin-top:22px" novalidate><label for="godpw-days">Password change every (days)</label>' +
        '<input id="godpw-days" type="number" inputmode="numeric" min="1" max="365" value="' + esc(String(state.godPwDays || 45)) + '" style="' + box + '">' +
        '<p id="godpw-days-msg" style="font-size:16px">' + esc(state.godPwDaysMsg || "Applies to drivers and God mode.") + '</p>' +
        '<button type="submit" style="' + big + '">Save setting</button></form>' +
        '<button type="button" id="godpw-close" style="' + big + ';background:#4a5a4a">Back to the board</button>') +
      '</section></div>';
  }
  function godPwAuth() { var t = ""; try { t = gqTok(); } catch (e) {} return t ? { godToken: t } : (gq.pw ? { godPassword: gq.pw } : null); }
  function bindGodPw() {
    var f = document.getElementById("godpw-form");
    if (f) f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var g = function (id) { var el = document.getElementById(id); return el ? el.value : ""; };
      var cur = g("godpw-cur"), np = g("godpw-new"), cf = g("godpw-confirm");
      var fail = function (m) { state.godPwError = m; state.godPwBusy = false; render(); };
      if (!cur) return fail("Enter your current password.");
      var weak = pwWeakMsg(np); if (weak) return fail(weak);
      if (np !== cf) return fail("Passwords must match.");
      if (np === cur) return fail("Pick a new password that's different from the last one.");
      state.godPwBusy = true; state.godPwError = ""; render();
      fetch(PAY_WORKER + "/god/changepw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ godPassword: cur, newPassword: np }) })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (!d || !d.ok) return fail((d && d.error) || "Couldn't save the new password. Try again.");
          try { if (d.godToken) { gqSetTok(d.godToken); gq.tokOn = true; } gq.pw = ""; } catch (e) {}
          state.godPwMust = false; state.godPwOpen = false; state.godPwBusy = false; state.godPwError = "";
          state.actionNotice = "New God password saved. Use it next time you sign in.";
          render(); startPoll();
        }).catch(function () { fail("Couldn't reach PCS. Check signal and try again."); });
    });
    var df = document.getElementById("godpw-days-form");
    if (df) df.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var d0 = Math.round(Number((document.getElementById("godpw-days") || {}).value));
      if (!(d0 >= 1 && d0 <= 365)) { state.godPwDaysMsg = "Pick 1 to 365 days."; render(); return; }
      var auth = godPwAuth() || godWriteAuth();
      if (!auth) return;
      fetch(PAY_WORKER + "/god/pwpolicy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ days: d0 }, auth)) })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.godToken) { try { gqSetTok(d.godToken); } catch (e) {} }
          state.godPwDays = d && d.ok ? d.days : state.godPwDays;
          state.godPwDaysMsg = d && d.ok ? "Saved: every " + d.days + " days." : ((d && d.error) || "Couldn't save the setting.");
          render();
        }).catch(function () { state.godPwDaysMsg = "Couldn't reach PCS. Try again."; render(); });
    });
    var c = document.getElementById("godpw-close");
    if (c) c.addEventListener("click", function () { state.godPwOpen = false; render(); startPoll(); });
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
  /* v77.10 (Matthew 10/20, Anson audit): heartbeat age. >15 min = red "SIGNAL LOST"; >60 min = out of Online/Available counts and
     dispatch, gray pin with last-seen time. Pure (tested). */
  var SIGNAL_LOST_MS = 15 * 60000, SIGNAL_GONE_MS = 60 * 60000;
  function signalLevel(d, now) { var t = Number(d && d.lastSeenAt) || 0; if (!t) return "ok"; var a = (now || Date.now()) - t; return a > SIGNAL_GONE_MS ? "gone" : a > SIGNAL_LOST_MS ? "lost" : "ok"; }
  function ctClock(ts) { try { return new Date(Number(ts)).toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT"; } catch (e) { return ""; } }
  function signalBadgeHtml(d, now) { var lv = d && (d.signalLost ? "gone" : signalLevel(d, now)); if (!lv || lv === "ok") return "";
    return '<span class="badge signal-lost" style="background:#b91c1c;color:#fff;font-weight:800">SIGNAL LOST \u00b7 last seen ' + esc(ctClock(d.lastSeenAt)) + "</span>"; }

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
          if (row.driverOffline === true && row.loggedIn === true && now - (Number(row.at) || 0) <= 15 * 60000) { /* v73: Offline (logged in) */
            row.id = id; row.offlineLoggedIn = true; row.online = false; row.presence = "offline-loggedin"; row.lastSeenAt = Number(row.at) || 0; out.push(row); return;
          }
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

  /* v77.1 (Harry v77 #1): the driver roster is read through the Worker with the God token (password fields stripped there).
     A Worker without /god/roster (404 "Not found") falls back to the old direct read. Never prompts: no token yet = old read. */
  function godReadAuth() {
    var t = ""; try { t = gqTok(); } catch (e) {}
    if (t) return { godToken: t };
    if (typeof gq !== "undefined" && gq && gq.pw) return { godPassword: gq.pw };
    return null;
  }
  function godRosterApi(extra) {
    var auth = godReadAuth();
    if (!auth) return Promise.resolve({ noAuth: true });
    return fetch(PAY_WORKER + "/god/roster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, extra || {}, auth)) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          d = d || {}; d.httpStatus = res.status;
          if (res.status === 404 && d.error === "Not found") d.oldWorker = true;
          if (d.godToken) { try { gqSetTok(d.godToken); gq.pw = ""; gq.tokOn = true; } catch (e) {} }
          if (res.status === 401) { try { gqSetTok(""); gq.pw = ""; } catch (e) {} }
          return d;
        });
      });
  }
  function godRosterRow(id) {
    return godRosterApi({ driverId: id }).then(function (d) {
      if (d.ok) return d.row || null;
      if (d.oldWorker || d.noAuth) return fetch(rosterUrl(id)).then(function (r) { return r.ok ? r.json() : null; });
      return null;
    }).catch(function () { return null; });
  }
  function listRoster() {
    return godRosterApi().then(function (d) {
      if (d.ok && d.roster && typeof d.roster === "object") {
        var out0 = {};
        Object.keys(d.roster).forEach(function (id) { var row = d.roster[id]; if (row && typeof row === "object") { row.id = id; out0[id] = row; } });
        return out0;
      }
      if (!d.oldWorker && !d.noAuth) { var e0 = new Error("roster-denied"); e0.denied = d.httpStatus === 401 || d.httpStatus === 403; throw e0; }
      return listRosterDirect().catch(function (err) {
        /* roster closed to direct reads and this device has no God token yet: ask for the God password once, then use the Worker */
        if (!(err && err.denied) || !d.noAuth || state.rosterPwAsked) throw err;
        state.rosterPwAsked = true;
        var a = godWriteAuth();
        if (!a) throw err;
        if (a.godPassword) gq.pw = a.godPassword;
        return listRoster();
      });
    });
  }
  function listRosterDirect() {
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
    var existed = !!(state.roster && state.roster[id]); /* v76d: existing record -> PATCH the changed fields only, never the rate */
    var body = row;
    if (existed) { body = {}; Object.keys(row).forEach(function (k) { if (k !== "commissionPct" && ["pwHash", "pwSalt", "pwIter", "pwAlgo", "pwSetAt"].indexOf(k) < 0) body[k] = row[k]; }); }
    else body = Object.assign({}, row, { newDriver: true }); /* Worker v76d: a whole-record PUT is only for a brand-new driver */
    return godFetch(rosterUrl(id), {
      method: existed ? "PATCH" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
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
    return godFetch(presenceDriverUrl(id), { method: "DELETE" }).catch(function () {});
  }

  function saveCommission(driverId, pctRaw) {
    /* v76d: PATCH only the rate (never rewrite the whole driver record), read it back, clear the draft. Failure: red NOT SAVED and the box goes back. */
    state.commissionErrors = state.commissionErrors || {};
    var name = ((state.roster && state.roster[driverId]) || {}).name || driverId;
    var pct = clampPct(pctRaw);
    if (pct == null) {
      delete state.commissionDrafts[driverId];
      state.commissionErrors[driverId] = "NOT SAVED: commission must be a whole number from 0 to 100. Still " + commissionPctFor(driverId) + "%.";
      state.actionNotice = state.commissionErrors[driverId];
      return Promise.resolve(false);
    }
    var now = Date.now();
    var patch = { commissionPct: pct, commissionSetAt: now, commissionSetBy: "god", updatedAt: now };
    return godFetch(rosterUrl(driverId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res || !res.ok) { var e = new Error("roster-write"); e.denied = !!res && (res.status === 401 || res.status === 403); throw e; }
      return res.text().then(function (t) {
        var back = null; try { back = JSON.parse(t); } catch (e2) { back = null; }
        if (!back || Number(back.commissionPct) !== pct) throw new Error("readback");
        return back;
      });
    }).then(function (back) {
      state.roster[driverId] = Object.assign({}, state.roster[driverId] || {}, back, { id: driverId });
      delete state.commissionDrafts[driverId]; delete state.commissionErrors[driverId];
      state.actionNotice = "Saved " + pct + "% for " + name + ".";
      return true;
    }).catch(function (err) {
      delete state.commissionDrafts[driverId];
      state.commissionErrors[driverId] = "NOT SAVED: " + (err && err.denied ? "the God password is needed on this device." : "the database did not keep " + pct + "%.") + " Still " + commissionPctFor(driverId) + "%.";
      state.actionNotice = state.commissionErrors[driverId];
      return false;
    });
  }
  window.__pcsGodSaveCommission = saveCommission; /* test hook */
  function commissionUnsaved() {
    var d = state.commissionDrafts || {};
    return Object.keys(d).some(function (id) { return d[id] !== "" && d[id] != null && String(clampPct(d[id])) !== String(commissionPctFor(id)); });
  }
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("beforeunload", function (e) { if (commissionUnsaved()) { e.preventDefault(); e.returnValue = ""; } });

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

  /* v75o: amber "Time conflict" badge for bookings that hit busy.json / overlap another booking */
  function conflictBadgeHtml(r) {
    if (!r || !r.conflict) return "";
    var why = r.conflictReason || (r.conflict === "unchecked" ? "busy schedule could not be checked" : "time conflict");
    return ' <span class="badge time-conflict" style="background:#ffb020;color:#1a1200;border:1px solid #7a4d00;font-weight:700">\u26a0 Time conflict: ' + esc(why) + "</span>";
  }

  /* v75p: Resolve conflict (+ new agreed pickup time) and Send payment page (copy/share only, never auto-sent). */
  function conflictToolsHtml(r) {
    if (!r || !r.code) return "";
    var code = esc(r.code);
    if (r.conflict && !r.conflictResolvedAt) {
      return '<div class="commission-row conflict-tools" style="margin-top:8px;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<label class="fine" style="display:flex;gap:6px;align-items:center">New pickup date <input type="date" class="conflict-date" data-ride-code="' + code + '" value="' + esc(r.date || "") + '"></label>' +
        '<label class="fine" style="display:flex;gap:6px;align-items:center">time <input type="time" class="conflict-time" data-ride-code="' + code + '" value="' + esc(r.time || "") + '"></label>' +
        '<button type="button" class="btn btn-gold btn-resolve-conflict" data-ride-code="' + code + '">Resolve conflict</button>' +
        "</div>";
    }
    if (r.conflictResolvedAt) {
      var open = !!(state.payPageOpen && state.payPageOpen[r.code]);
      var url = payPageUrl(r.code);
      return '<div class="commission-row conflict-tools" style="margin-top:8px;flex-wrap:wrap;gap:8px">' +
        '<span class="fine">Conflict resolved ' + esc(new Date(r.conflictResolvedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })) + " CT by " + esc(r.conflictResolvedBy || "God mode") + "</span>" +
        '<button type="button" class="btn btn-ghost btn-send-paypage" data-ride-code="' + code + '">Send payment page</button>' +
        (open ? '<div class="paypage-box" style="width:100%;background:#fff;color:#111;padding:8px;border-radius:8px"><input readonly style="width:100%;color:#111" value="' + esc(url) + '">' +
          '<button type="button" class="btn btn-ghost btn-paypage-copy" style="color:#111;background:#e6e6e6" data-url="' + esc(url) + '">Copy</button> ' +
          '<button type="button" class="btn btn-ghost btn-paypage-share" style="color:#111;background:#e6e6e6" data-url="' + esc(url) + '">Share</button>' +
          '<p class="fine" style="color:#333">You send this yourself. Nothing is sent automatically.</p></div>' : "") +
        "</div>";
    }
    return "";
  }

  function payPageUrl(code) {
    return new URL("../app/?pay=" + encodeURIComponent(code), location.href).href;
  }

  function resolveConflict(code, date, time) {
    code = String(code || "").toUpperCase();
    return getRide(code).then(function (ride) {
      if (!ride) throw new Error("missing");
      var now = Date.now();
      var patch = {
        conflict: null,
        conflictResolvedAt: now,
        conflictResolvedBy: "Matthew (God mode)",
        conflictPrev: { conflict: ride.conflict || null, reason: ride.conflictReason || "", date: ride.date || "", time: ride.time || "" },
        updatedAt: now
      };
      if (date) patch.date = date;
      if (time) patch.time = time;
      return patchRide(code, patch).then(function () {
        var next = Object.assign({}, ride, patch);
        return putOpenSummary(code, next).catch(function () {});
      }).then(function () {
        state.payPageOpen = state.payPageOpen || {};
        state.payPageOpen[code] = true;
        state.actionNotice = "Conflict resolved for " + code + (time ? " (pickup " + (date || ride.date || "") + " " + time + ")" : "") + ". Payment is allowed now.";
        return true;
      });
    }).catch(function () {
      state.actionNotice = "Could not resolve the conflict for " + code + ".";
      return false;
    });
  }

  function isPendingOwner(ride) {
    var st = String((ride && ride.status) || "").toLowerCase();
    return st === "pending_owner" || st === "pending-owner";
  }

  function patchRide(code, partial) {
    if (!code) return Promise.reject(new Error("code"));
    return godFetch(rideUrl(code), {
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
      conflict: ride && ride.conflict && !ride.conflictResolvedAt ? ride.conflict : null, /* v75p */
      conflictResolvedAt: (ride && ride.conflictResolvedAt) || null,
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
    return godFetch(openUrl().replace(/\.json$/, "/") + encodeURIComponent(code) + ".json", {
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
        return godFetch(openUrl().replace(/\.json$/, "/") + encodeURIComponent(code) + ".json", { method: "DELETE" }).catch(function () {});
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
        '<p class="lede" style="margin:0 0 8px"><strong>' + esc(who) + "</strong> · " + esc(code) + conflictBadgeHtml(r) + "</p>" +
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
      if (item.kind === "dlw") renderGodDriverAlertPopup(item.ride); /* v74d */
      else if (item.kind === "accept") renderGodAcceptPopup(item.ride);
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
      (ride.conflict ? '<p class="gp-row">' + conflictBadgeHtml(ride) + "</p>" : "") +
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
    return godFetch(safetyUrl(id), {
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

  /* v72w (Matthew: God mode on iPhone stopped his music): Web Audio ONLY. No <audio> element (an HTMLAudioElement,
     even muted, takes the iPhone's media session and pauses Music/Spotify), no looping silent keep-alive, no Media
     Session. audioSession "ambient" always (mixes with other audio; never playback or transient).
     The AudioContext is suspended ~1 s after every chime / unlock tap so nothing holds audio between alerts.
     A waiting ride repeats a short one-shot chime every 2.8 s until stopAlert(). o = { url, muted(), wantBar(), onUi() } */
  function pcsAlertAudio(o) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, buf = null, loading = null, failedAt = 0;
    var alerting = false, testing = false, blocked = false, heard = false, unlockedOnce = false;
    var nodes = [], watch = null, idleTimer = null, testTimer = null, buzzing = false;
    var sessionMode = "ambient";
    var stats = { unlocks: 0, chimes: 0, oscBursts: 0, blocked: 0, suspends: 0 };
    function noop() {}
    function isMuted() { try { return !!(o.muted && o.muted()); } catch (e) { return false; } }
    function setSession(mode) {
      if (mode) sessionMode = mode;
      try { var s = navigator.audioSession; if (s && s.type !== sessionMode) s.type = sessionMode; } catch (e) {}
    }
    function makeCtx() {
      if (ctx || !AC) return ctx;
      setSession();
      try { ctx = new AC(); try { ctx.onstatechange = function () { ui(); }; } catch (e1) {} } catch (e) { ctx = null; }
      return ctx;
    }
    function running() { return !!ctx && ctx.state === "running"; }
    function ready() { return heard || (unlockedOnce && !!ctx && ctx.state !== "closed"); }
    function resumeCtx() {
      if (!ctx || ctx.state === "running" || ctx.state === "closed" || !ctx.resume) return null;
      try { var p = ctx.resume(); if (p && p.then) p.then(function () { ui(); }, noop); return p; } catch (e) { return null; }
    }
    function goIdle(delay) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        idleTimer = null;
        if (alerting || testing) return;
        try { if (ctx && ctx.state === "running" && ctx.suspend) { ctx.suspend(); stats.suspends++; } } catch (e) {}
        setSession("ambient");
      }, delay == null ? 1200 : delay);
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
        return new Promise(function (resolve, reject) { var p = c.decodeAudioData(ab, resolve, reject); if (p && p.then) p.then(resolve, reject); });
      }).then(function (b) { buf = b; failedAt = 0; loading = null; return b; })
        .catch(function () { failedAt = Date.now(); loading = null; return null; });
      return loading;
    }
    function track(list, last) {
      list.forEach(function (n) { nodes.push(n); });
      try { last.onended = function () { nodes = nodes.filter(function (n) { return list.indexOf(n) === -1; }); list.forEach(function (n) { try { n.disconnect(); } catch (e) {} }); }; } catch (e) {}
    }
    function oscBurst() {
      if (!ctx) return;
      try {
        var notes = [[1046.5, 0], [1318.5, 0.18], [1568, 0.36], [1318.5, 0.58]];
        var now = ctx.currentTime + 0.01, master = ctx.createGain(), list = [master], last = null;
        master.gain.value = 0.95; master.connect(ctx.destination);
        notes.forEach(function (n, i) {
          var len = i === notes.length - 1 ? 0.67 : 0.5;
          var osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = "sine"; osc.frequency.value = n[0];
          g.gain.setValueAtTime(0.0001, now + n[1]);
          g.gain.exponentialRampToValueAtTime(0.85, now + n[1] + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, now + n[1] + len);
          osc.connect(g); g.connect(master); osc.start(now + n[1]); osc.stop(now + n[1] + len + 0.02);
          list.push(osc, g); last = osc;
        });
        stats.oscBursts++; track(list, last);
      } catch (e) {}
    }
    /* one short chime (decoded file, or the same four notes from oscillators) */
    function chime() {
      if (!ctx) return;
      resumeCtx();
      if (!buf) { load(); oscBurst(); }
      else {
        try {
          var s = ctx.createBufferSource(), g = ctx.createGain();
          s.buffer = buf; s.loop = false; g.gain.value = 1;
          s.connect(g); g.connect(ctx.destination); s.start(0);
          stats.chimes++; track([s, g], s);
        } catch (e) {}
      }
      if (running()) { heard = true; blocked = false; }
      else if (alerting && ctx.state !== "running") {
        setTimeout(function () { if (alerting && !running()) { blocked = true; stats.blocked++; ui(); } }, 600);
      }
      ui();
    }
    function vibrate(p) {
      try { if (navigator.vibrate && (navigator.userActivation ? navigator.userActivation.hasBeenActive : true)) navigator.vibrate(p); } catch (e) {}
    }
    function tickAlert() {
      if (!alerting) return;
      if (isMuted()) { stopAlert(); return; }
      vibrate([220, 60, 220, 60, 320]); buzzing = true;
      chime();
    }
    function unlock() {
      stats.unlocks++;
      setSession("ambient");
      makeCtx();
      if (ctx) {
        resumeCtx(); unlockedOnce = true;
        try { var s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch (e) {}
        load();
      }
      if (alerting) chime();
      else if (!testing) goIdle();
    }
    function startAlert() {
      if (isMuted()) { stopAlert(); return; }
      if (alerting) return;
      alerting = true; testing = false;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      setSession("ambient");
      makeCtx(); tickAlert();
      watch = setInterval(tickAlert, 2800);
      ui();
    }
    function stopAlert() {
      var was = alerting;
      alerting = false;
      if (watch) { clearInterval(watch); watch = null; }
      nodes.forEach(function (n) { try { if (n.stop) n.stop(); } catch (e) {} try { n.disconnect(); } catch (e2) {} });
      nodes = [];
      if (buzzing) { buzzing = false; vibrate(0); }
      if (blocked || was) { blocked = false; ui(); }
      goIdle(400);
    }
    function test() {
      unlock();
      if (alerting) return;
      testing = true;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      setSession("ambient"); vibrate(60); chime();
      if (testTimer) clearTimeout(testTimer);
      testTimer = setTimeout(function () { testing = false; goIdle(300); }, 1600);
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
          chime();
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
      if (alerting) resumeCtx(); else if (ctx && ctx.state === "running") goIdle();
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
          ctxState: ctx ? ctx.state : "none", heard: heard, alerting: alerting, blocked: blocked,
          bufReady: !!buf, session: sessionMode, unlockedOnce: unlockedOnce, audioElements: 0, stats: stats
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
      if (it.kind === "dlw") return true; /* v74d: driver-fault alerts ring until OK is tapped */
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

    var rosterP = (slowDue("ro") ? listRoster() : Promise.resolve(state.roster)).then(function (rows) { /* v77.15 add2: roster every 60 s (or after a save) */
      state.rosterError = "";
      state.roster = rows || {};
      try { lastWashLoad(Object.keys(state.roster)); } catch (e) {} /* v77.17 */
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
        state.offlineDrivers = (rows || []).filter(function (d) { return d && d.offlineLoggedIn && isRosterActive(d.id); }); /* v73: shown, never dispatchable */
        var nowS = Date.now(); /* v77.10: >60 min since the last heartbeat = signal gone: off the Online/Available lists */
        state.lostDrivers = (rows || []).filter(function (d) { return d && !d.offlineLoggedIn && isRosterActive(d.id) && signalLevel(d, nowS) === "gone"; });
        state.drivers = (rows || []).filter(function (d) {
          return d && !d.offlineLoggedIn && isRosterActive(d.id) && signalLevel(d, nowS) !== "gone";
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
      state.calendar = discOverlay(rows || [], state.discKV, state.discRev); /* r4: last Worker copy at once */
      if (slowDue("kv")) { /* v77.15 (Harry): Worker KV lists every 60 s or right after a God save, not every refresh */
        discLoad().then(function () { try { renderBoardLists(); } catch (e) {} });
        invLoad().then(function () { try { renderBoardLists(); } catch (e) {} }); /* v77.11 r2 */
      } else discOverlay(state.calendar, state.discKV, state.discRev);
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

    var discP = slowDue("dr") ? listDiscReqs().then(function (d) { state.discReqs = d; }).catch(function () {}) : Promise.resolve(); /* v73; v77.15: 60 s */
    var rcP = listRateContracts().then(function (L) { state.rateContracts = L; }).catch(function () {}); /* v76j */
    Promise.all([rosterP, driversP, ridesP, milesP, historyP, calendarP, safetyP, paymentsP, discP, rcP]).then(function () {
      try { rovAutoApply(); } catch (e) {} /* v76j */
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
    pollTimer = setInterval(function () { if (document.visibilityState === "hidden") return; refresh(); }, POLL_MS); /* v77.15: paused when the tab is hidden */
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
      var layer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { referrerPolicy: "strict-origin-when-cross-origin",
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

  /* v72u: driver arrow points the way they're heading (bearing from their last two reported positions) */
  var godHead = {};
  /* v75w: hold the arrow while the driver is stopped (speed under 3 mph) or barely moved; ease toward new headings */
  function godHeading(d) {
    if (!d || !d.id || !isCoord(d.lat) || !isCoord(d.lng)) return 0;
    var h = godHead[d.id], p = { lat: +d.lat, lng: +d.lng };
    if (!h) { godHead[d.id] = { p: p, deg: d.heading != null && isFinite(+d.heading) ? +d.heading : 0 }; return godHead[d.id].deg; }
    var dLat = (p.lat - h.p.lat) * 111000, dLng = (p.lng - h.p.lng) * 111000 * Math.cos(p.lat * Math.PI / 180);
    var moved = Math.sqrt(dLat * dLat + dLng * dLng), slow = d.speedMph != null && isFinite(+d.speedMph) && +d.speedMph < 3;
    if (slow || moved < 6) return h.deg; /* stopped at a light: keep the last good heading */
    var raw = d.heading != null && isFinite(+d.heading) ? +d.heading : (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
    h.deg = ((h.deg + 0.5 * ((((raw - h.deg) % 360) + 540) % 360 - 180)) % 360 + 360) % 360; h.p = p;
    return h.deg;
  }
  window.__pcsGodHeading = godHeading; /* test hook */
  function markerIcon(kind, label, focused, deg) {
    var svg = kind === "car" ? CAR_SVG : kind === "paired" ? PAIRED_SVG : PERSON_SVG;
    var cls = "god-marker" + (kind === "paired" ? " paired" : "") + (focused ? " focused" : "");
    return window.L.divIcon({
      className: "god-pin",
      html:
        '<div class="' + cls + '">' +
          '<div class="face"' + (kind === "car" ? ' style="transform:rotate(' + Math.round(Number(deg) || 0) + 'deg)"' : "") + ">" + svg + "</div>" +
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

    /* v77.10: signal gone >60 min: gray pin at the last known spot, with the last-seen time */
    (state.lostDrivers || []).forEach(function (driver) {
      if (!isCoord(driver.lat) || !isCoord(driver.lng)) return;
      window.L.marker([+driver.lat, +driver.lng], { icon: markerIcon("car", shortName(driver.name, "Driver") + " \u00b7 SIGNAL LOST \u00b7 last seen " + ctClock(driver.lastSeenAt), false, null), zIndexOffset: 100, opacity: 0.4 }).addTo(markerLayer);
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
        icon: markerIcon("car", freeLabel, freeFocused, godHeading(driver)),
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
      prev.appVersion = d.appVersion || ""; /* v72r */
      prev.hosShiftMin = d.hosShiftMin; prev.hosWindowMin = d.hosWindowMin; prev.hosLevel = d.hosLevel || ""; /* v72r HOS */
      prev.gpsAt = d.gpsAt || prev.gpsAt; prev.gpsStaleMin = d.gpsStaleMin; /* v72r GPS health */
      prev.hosDriveMin = d.hosDriveMin; prev.hosBy = d.hosBy || ""; prev.hosCycleMin = d.hosCycleMin; prev.hosCfg = d.hosCfg || null;
      prev.hosBreakLeftMin = d.hosBreakLeftMin; prev.hosOnBreak = d.hosOnBreak; prev.hosBreakTakenMin = d.hosBreakTakenMin; prev.hosDriveLeftMin = d.hosDriveLeftMin; prev.hosShiftLeftMin = d.hosShiftLeftMin; prev.hosCycleLeftMin = d.hosCycleLeftMin;
      prev.presence = d.presence || "live"; /* v64g */
      prev.lastSeenAt = d.lastSeenAt || d.at || 0;
      if (!prev.active && prev.fromRoster) {
        /* Fired: do not treat as online in the panel. */
        prev.online = false;
      }
      byId[d.id] = prev;
    });
    (state.lostDrivers || []).forEach(function (d) { /* v77.10: signal gone >60 min: listed, not online, not dispatchable */
      if (!d || !d.id || (byId[d.id] && byId[d.id].online)) return;
      var prev = byId[d.id] || { id: d.id, name: d.name || d.id, phone: d.phone || "", email: "", fromRoster: false, active: true, online: false };
      prev.online = false; prev.signalLost = true; prev.lastSeenAt = d.lastSeenAt || 0; prev.lat = d.lat; prev.lng = d.lng;
      byId[d.id] = prev;
    });
    (state.offlineDrivers || []).forEach(function (d) { /* v73: logged in but Offline: not online, not dispatchable */
      if (!d || !d.id || (byId[d.id] && byId[d.id].online)) return;
      var prev = byId[d.id] || { id: d.id, name: d.name || d.id, phone: d.phone || "", email: "", fromRoster: false, active: true, online: false };
      prev.online = false; prev.offlineLoggedIn = true; prev.lastSeenAt = d.at || 0;
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

  /* v72r: the app version this driver's phone is running (from presence); amber if older than this God mode build. */
  function driverVersionHtml(d) {
    var cur = window.PCS_APP_VERSION || "";
    var v = d.appVersion || "";
    var old = !!cur && (!v || (window.pcsVersionCmp ? window.pcsVersionCmp(v, cur) < 0 : v !== cur));
    return '<p class="driver-app-version' + (old ? " is-old" : "") + '"' +
      (old ? ' style="color:#b45309;background:#fef3c7;border-radius:6px;padding:2px 6px;display:inline-block;font-weight:600"' : "") +
      "><strong>App</strong> " + esc(v || "older than v72r") + (old ? " (update needed, current " + esc(cur) + ")" : "") + "</p>";
  }
  /* ===== v72r hours of service: config (rides/HSLGLMTS) + per-driver driving / on-duty display + alerts =====
     Default = Houston Code Ch. 46 (limousine drivers): max 12 h DRIVING in any rolling 24 h. On-duty caps optional (0 = off). */
  /* PCS HOS policy (Matthew, CDL / Motive "USA Property 70 hour / 8 day"): 12 h drive, 14 h shift (v74b; was 11 h drive), 30-min break after 8 h
     driving, 70 h / 8 days; 10 h off resets drive + shift, 34 h off restarts ALL clocks incl. the cycle (Matthew). All editable here. */
  var HOS_DEF = { maxDriveHours: 12, shiftWindowHours: 14, breakAfterDriveHours: 8, breakMinutes: 30, cycleHours: 70, cycleDays: 8, resetHours: 6, restartHours: 34, breakAfterMin: 150, breakMinOnDutyHours: 3 }; /* v76d-pretrip (Matthew 10/18): 6 h off resets Drive + Shift */
  var HOS_FIELDS = [["hos-drive", "maxDriveHours", 0, 24, "DRIVE: max moving time (hours, 0 = off)"], ["hos-shift", "shiftWindowHours", 0, 24, "SHIFT: on-duty window (hours, 0 = off)"],
    ["hos-brkh", "breakAfterDriveHours", 0, 24, "BREAK: required after this many hours of driving (0 = off)"], ["hos-brkm", "breakMinutes", 5, 120, "BREAK length (minutes)"], ["hos-brkmin", "breakMinOnDutyHours", 0, 14, "BREAK counts as the 30-min break only if it starts this many hours on duty after shift start or the last qualifying break (0 = any time)"],
    ["hos-cyc", "cycleHours", 0, 200, "CYCLE: max on-duty hours (0 = off)"], ["hos-cycd", "cycleDays", 1, 14, "CYCLE rolling days"],
    ["hos-reset", "resetHours", 1, 48, "Off-duty hours in a row (Offline / logged out) that reset DRIVE + SHIFT and require a new pre-trip (never the 70 h CYCLE)"], ["hos-restart", "restartHours", 1, 96, "Consecutive off hours (Offline / logged out / off duty) that reset ALL clocks incl. the 70 h CYCLE"],
    ["hos-break", "breakAfterMin", 0, 600, "Soft take-a-break nudge after continuous driving (minutes, 0 = off)"]];
  /* v72r overrides: rides/HSLGVRDE/{driver} = { request, override, restUntil }; log at rides/DRVRHSLG/{driver}/overrides/{at} */
  state.hosOvr = {};
  state.hosOvrFor = "";
  state.hosOvrDraft = { hours: "2", reason: "" };
  /* v72v: Firebase rules refuse God mode's (unauthenticated) writes to HSLGVRDE, so overrides go through the Worker (KV),
     signed with the God-mode device token (same as the queue panel). Firebase is still read for old records. */
  function hosOvrLoad() {
    var fb = fetch(baseUrl() + "/rides/HSLGVRDE.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var wk = (gqTok() || gq.pw) ? workerJson("/hos/ovr/all", gqAuth()).then(function (d) { if (d && d.godToken) { gqSetTok(d.godToken); gq.tokOn = true; gq.pw = ""; } return d && d.records; }).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([fb, wk]).then(function (r) {
      var all = Object.assign({}, r[0] && typeof r[0] === "object" ? r[0] : {});
      var w = r[1] || {};
      Object.keys(w).forEach(function (id) { all[id] = Object.assign({}, all[id] || {}, w[id]); });
      state.hosOvr = all; hosPaint();
    });
  }
  function hosOvrSave(id, patch) {
    if (!gqTok() && !gq.pw) return Promise.reject(new Error("Enter the God-mode password in the Rider queue panel first (one time per device)."));
    return workerJson("/hos/ovr/god", Object.assign({ driverId: id, patch: patch }, gqAuth())).then(function (d) {
      if (d && d.godToken) { gqSetTok(d.godToken); gq.tokOn = true; gq.pw = ""; }
      return d;
    });
  }
  function godWho() {
    try { var k = JSON.parse(localStorage.getItem("pcs-god-keep-v1") || "null"); if (k && k.email) return String(k.email); } catch (e) {}
    return "God mode";
  }
  /* "until end of scheduled rides": the driver's last assigned, not-finished calendar ride ending in the next 24 h (+30 min) */
  function scheduledRidesEnd(id) {
    var now = Date.now(), best = 0;
    (state.calendar || []).forEach(function (r) {
      if (!r || r.assignedDriverId !== id || r.status === "completed" || r.status === "cancelled" || r.status === "deleted") return;
      var e = Date.parse(r.end) || (Date.parse(r.start) ? Date.parse(r.start) + 90 * 60000 : 0);
      if (e > now && e < now + 24 * 3600000 && e > best) best = e;
    });
    return best ? best + 30 * 60000 : 0;
  }
  function hosOvrRow(id) { var o = state.hosOvr && state.hosOvr[id]; return o && typeof o === "object" ? o : {}; }
  function hosNeedsGod(d) {
    var o = hosOvrRow(d.id), now = Date.now();
    var req = o.request && !(o.override && Number(o.override.grantedAt) >= Number(o.request.at)) ? o.request : null;
    var resting = Number(o.restUntil) > now;
    var ovrOn = o.override && Number(o.override.until) > now;
    return { req: req, resting: resting, restUntil: Number(o.restUntil) || 0, ovr: ovrOn ? o.override : null, limit: d.online && d.hosLevel === "limit" };
  }
  function ctClock(ms) { try { return new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }) + " CT"; } catch (e) { return String(ms); } }
  function hosOvrFormHtml() {
    var id = state.hosOvrFor;
    if (!id) return "";
    var d = (state.drivers || []).filter(function (x) { return x && x.id === id; })[0] || { id: id, name: (hosOvrRow(id).request || {}).name };
    var endR = scheduledRidesEnd(id), dr = state.hosOvrDraft;
    var opts = ["1", "2", "3", "4", "5", "6"].map(function (h) { return '<option value="' + h + '"' + (dr.hours === h ? " selected" : "") + ">" + h + " hour" + (h === "1" ? "" : "s") + "</option>"; }).join("") +
      (endR ? '<option value="rides"' + (dr.hours === "rides" ? " selected" : "") + ">Until end of scheduled rides (" + esc(ctClock(endR)) + ")</option>" : '<option value="rides" disabled>Until end of scheduled rides (none assigned)</option>');
    return '<div class="card" id="hos-ovr-form" style="border:2px solid #1e3a8a"><strong>Approve HOS override: ' + esc(displayName(d.name, "Driver")) + "</strong>" +
      (hosNeedsGod(d).resting ? '<p class="fine">This driver is in a mandatory rest; approving lets them go online again for the time below.</p>' : "") +
      '<label>Extension <select id="hos-ovr-hours">' + opts + "</select></label><br>" +
      '<label>Reason (required) <input id="hos-ovr-reason" type="text" maxlength="200" value="' + esc(dr.reason) + '" style="width:min(420px,90%)"></label><br>' +
      '<button type="button" class="btn btn-gold" id="hos-ovr-save" data-driver-id="' + esc(id) + '">Approve override</button> ' +
      '<button type="button" class="btn btn-ghost" id="hos-ovr-cancel">Cancel</button> <span class="fine" id="hos-ovr-msg"></span></div>';
  }
  document.addEventListener("input", function (e) {
    var id = e.target && e.target.id;
    if (id === "hos-ovr-reason") state.hosOvrDraft.reason = e.target.value;
    if (id === "hos-ovr-hours") state.hosOvrDraft.hours = e.target.value;
  });
  document.addEventListener("change", function (e) { if (e.target && e.target.id === "hos-ovr-hours") state.hosOvrDraft.hours = e.target.value; });
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var oo = t.closest("[data-odo-ovr]");
    var od = t.closest("[data-odo-dismiss]");
    var ofx = t.closest("[data-odo-fix]"), ofs = t.closest("[data-odo-fix-save]");
    if (ofx) { var ff = document.querySelector('[data-odo-fix-form="' + ofx.getAttribute("data-odo-fix") + '"]'); if (ff) { ff.hidden = !ff.hidden; var vi = ff.querySelector(".odo-fix-val"); if (vi && !ff.hidden) try { vi.focus(); vi.select(); } catch (eF) {} } return; }
    if (ofs) { /* v74b: God sets the correct reading: today's row opening odometer (day miles recalculated from it), logged, alert closed */
      var fid = ofs.getAttribute("data-odo-fix-save"), fv = String((document.querySelector('[data-odo-fix-val="' + fid + '"]') || {}).value || "").trim(), fw = String((document.querySelector('[data-odo-fix-why="' + fid + '"]') || {}).value || "").trim();
      var fe = document.querySelector('[data-odo-fix-err="' + fid + '"]');
      if (!/^\d+$/.test(fv) || Number(fv) <= 0) { if (fe) fe.textContent = "Enter the reading in whole miles (digits only, more than 0)."; return; }
      var frq = (hosOvrRow(fid).odoRequest) || {}, fnow = Date.now(), fday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(Number(frq.at) || fnow)), fval = Number(fv);
      var rowUrl = baseUrl() + "/rides/DRVRMLES/" + encodeURIComponent(fid) + "/" + fday + ".json";
      ofs.disabled = true;
      fetch(rowUrl).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (row) {
        var patch = { startOdometer: fval, odoRepaired: { at: fnow, from: Number(frq.entered) || 0, to: fval, by: godWho(), reason: fw || "Corrected in God mode", why: fw || "Corrected in God mode" }, odoCorrectedAt: fnow };
        var endO = row && Number(row.endOdometer); if (endO > 0 && endO >= fval) patch.odoMiles = endO - fval; /* recalc day miles */
        return fetch(rowUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      }).then(function () { return fetch(baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(fid) + "/overrides/" + fnow + ".json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "odometer corrected to " + fval, at: fnow, grantedAt: fnow, by: godWho(), reason: fw || "Corrected in God mode", from: Number(frq.entered) || 0, to: fval }) }); })
        .then(function () { return hosOvrSave(fid, { odoDismiss: { reason: ("Corrected to " + fval + (fw ? ": " + fw : "")).slice(0, 200), by: godWho() } }).catch(function () {}); })
        .then(hosOvrLoad).catch(function () { ofs.disabled = false; if (fe) fe.textContent = "Couldn't save. Try again."; });
      return;
    }
    if (od) { /* v74: Ignore / Dismiss the alert (logged with who / when / reason); nothing is reset */
      var did = od.getAttribute("data-odo-dismiss"), dr0 = (window.prompt("Reason for dismissing (logged, optional):") || "").trim() || "Dismissed";
      hosOvrSave(did, { odoDismiss: { reason: dr0.slice(0, 200), by: godWho() } }).then(hosOvrLoad).catch(function (er) { window.alert((er && er.message) || "Couldn't dismiss. Try again."); });
      return;
    }
    if (oo) { /* v72u: God-only override for a lower opening odometer, reason logged */
      var oid = oo.getAttribute("data-odo-ovr"), reason = (window.prompt("Reason for allowing a lower opening odometer (logged):") || "").trim();
      if (reason.length < 3) return;
      var onow = Date.now(), orq = (hosOvrRow(oid).odoRequest) || {};
      var orec = { grantedAt: onow, until: onow + 2 * 3600000, reason: reason, by: godWho(), entered: orq.entered, last: orq.last, kind: "odometer-lower" };
      hosOvrSave(oid, { odoOverride: orec }).then(hosOvrLoad).catch(function (er) { window.alert((er && er.message) || "Couldn't save the override. Try again."); });
      return;
    }
    var open = t.closest("[data-hos-ovr]");
    if (open) { state.hosOvrFor = open.getAttribute("data-hos-ovr"); state.hosOvrDraft = { hours: "2", reason: "" }; hosPaint(true); return; }
    if (t.id === "hos-ovr-cancel") { state.hosOvrFor = ""; hosPaint(true); return; }
    if (t.id !== "hos-ovr-save") return;
    var id = t.getAttribute("data-driver-id"), dr = state.hosOvrDraft, msg = document.getElementById("hos-ovr-msg");
    var reason = String(dr.reason || "").trim();
    if (reason.length < 3) { if (msg) msg.textContent = "Enter a reason."; return; }
    var now = Date.now(), until, hours;
    if (dr.hours === "rides") { until = scheduledRidesEnd(id); hours = until ? Math.round((until - now) / 360000) / 10 : 0; if (!until) { if (msg) msg.textContent = "No scheduled rides assigned to this driver."; return; } }
    else { hours = Math.max(1, Math.min(6, Number(dr.hours) || 1)); until = now + hours * 3600000; }
    var row = hosOvrRow(id);
    var kind = Number(row.restUntil) > now ? "rest" : "limit";
    var rec = { grantedAt: now, until: until, hours: hours, extension: dr.hours === "rides" ? "until end of scheduled rides" : hours + "h", reason: reason, by: godWho(), kind: kind, request: row.request || null };
    var patch = { override: rec, request: null };
    if (kind === "rest") { patch.restUntil = 0; patch.restWaivedAt = now; rec.kind = "rest-waived"; }
    hosOvrSave(id, patch).then(function () { /* v72v: Worker KV (logged there) */
      state.hosOvrFor = "";
      if (document.activeElement) try { document.activeElement.blur(); } catch (x) {}
      return hosOvrLoad();
    }).catch(function (er) { var m = document.getElementById("hos-ovr-msg"); if (m) m.textContent = (er && er.message) || "Could not save. Try again."; });
  });
  setTimeout(hosOvrLoad, 700);
  setInterval(function () { if (document.visibilityState !== "hidden") hosOvrLoad(); }, 30000); /* v77.15: was 10 s */
  state.hosCfg = Object.assign({}, HOS_DEF);
  state.hosDraft = null;
  function hosUrl() { return baseUrl() + "/rides/HSLGLMTS.json"; }
  function hosLoad() {
    /* v72v: Worker (KV) first; Firebase HSLGLMTS reads are refused for God mode now */
    return workerJson("/hos/limits/get", {}).then(function (d) { return d && d.limits; }).catch(function () { return null; }).then(function (w) {
      return w || fetch(hosUrl()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }).then(function (c) {
      state.hosLoaded = !!(c && typeof c === "object");
      if (c && typeof c === "object") {
        var n = {};
        HOS_FIELDS.forEach(function (f) { var v = Number(c[f[1]]); n[f[1]] = isFinite(v) && v >= f[2] && v <= f[3] ? v : HOS_DEF[f[1]]; });
        if (c.rule !== "v74b" && n.maxDriveHours === 11) n.maxDriveHours = 12; /* v74b (Matthew): old 11 h default -> 12 h */
        if (c.defaults) n.resetHours = HOS_DEF.resetHours; /* v76d-pretrip: nothing saved yet -> 6 h */
        state.hosCfg = n;
      }
      hosPaint();
    }).catch(function () {});
  }
  function hmFmt(min) { min = Math.max(0, Math.round(Number(min) || 0)); return Math.floor(min / 60) + "h " + String(min % 60).padStart(2, "0") + "m"; }
  function driverHosHtml(d) {
    if (d.hosDriveLeftMin === undefined && d.hosShiftLeftMin === undefined) return '<p class="driver-hos fine">HOS clocks: not reported (app older than v72r)</p>';
    var lv = d.hosLevel || "ok";
    var cell = function (k, lab) { /* v72t: logo colors; red in the last 45 min; "Break due in" / "On break" */
      var v = d["hos" + k + "LeftMin"];
      var off = v == null;
      var brk = k === "Break" && d.hosOnBreak;
      if (k === "Break") lab = brk ? "On break" : "Break due in";
      var red = !off && !brk && v <= 45;
      return '<span class="hos-clock hos-clock-' + k.toLowerCase() + (red ? " hos-red" : "") + '" style="display:inline-block;min-width:88px;border:1px solid ' + (red ? "#fca5a5" : "#3f6a3b") + ';border-radius:6px;padding:2px 6px;margin:2px;background:' + (red ? "#b91c1c" : "#20371d") + ";color:" + (red ? "#fff" : "#cdeccd") + ';font-weight:700">' +
        lab + " " + (off ? "off" : brk ? esc(String(d.hosBreakTakenMin || 0)) + "m / 30m" : esc(hmFmt(Math.max(0, v)))) + "</span>";
    };
    var tag = lv === "limit" ? (d.hosBy === "break" ? "BREAK REQUIRED" : "LIMIT REACHED") : lv === "override" ? "OVERRIDE" : lv === "30m" ? "30 min left" : lv === "1h" ? "1 hour left" : "";
    return '<div class="driver-hos hos-' + esc(lv) + '"><strong>HOS</strong> ' + (tag ? '<strong style="color:' + (lv === "limit" ? "#b91c1c" : lv === "override" ? "#1e3a8a" : "#b45309") + '">' + esc(tag) + "</strong>" : "") + "<br>" +
      cell("Break", "Break") + cell("Drive", "Drive") + cell("Shift", "Shift") + cell("Cycle", "Cycle") + "</div>";
  }
  /* v72r GPS health: red when a logged-in driver's GPS hasn't reported for > 5 min, or a recent shift's tracked miles are far
     below its odometer miles (tracked < 70% of odometer, odometer >= 5 mi): moving time may be undercounted. */
  function driverGpsHealthHtml(d, mileDays) {
    var why = [];
    if (d.online) {
      var gAt = Number(d.gpsAt) || 0;
      var staleMin = Math.max(Number(d.gpsStaleMin) || 0, gAt ? Math.floor((Date.now() - gAt) / 60000) : 0);
      if (staleMin > 5) why.push("no GPS fix for " + staleMin + " min");
    }
    var days = mileDays && typeof mileDays === "object" ? Object.keys(mileDays).sort().slice(-2) : [];
    days.forEach(function (ymd) {
      var sh = mileDays[ymd] && mileDays[ymd].shifts;
      if (!sh || typeof sh !== "object") return;
      Object.keys(sh).forEach(function (k) {
        var r = sh[k] || {};
        var odo = Number(r.odoMiles), tr = Number(r.trackedMiles);
        if (isFinite(odo) && odo >= 5 && isFinite(tr) && tr < 0.7 * odo) why.push(ymd + " shift: GPS " + tr.toFixed(1) + " mi vs odometer " + odo.toFixed(1) + " mi");
      });
    });
    if (!why.length) return "";
    return '<p class="driver-gps-bad" style="color:#fff;background:#b91c1c;font-weight:700;border-radius:6px;padding:4px 8px;display:inline-block">GPS not reporting: moving time may be undercounted (' + esc(why.join("; ")) + ")</p>";
  }
  function hosAlertsHtml() {
    var gpsBad = (state.drivers || []).filter(function (d) { return d && d.online && ((Number(d.gpsStaleMin) || 0) > 5 || (Number(d.gpsAt) && Date.now() - Number(d.gpsAt) > 5 * 60000)); });
    var gpsHtml = gpsBad.length ? '<div id="gps-alerts" role="alert" style="background:#b91c1c;color:#fff;border-radius:10px;padding:8px 10px;margin:8px 0;font-weight:700">GPS not reporting: moving time may be undercounted: ' +
      gpsBad.map(function (d) { return esc(displayName(d.name, "Driver")); }).join(", ") + "</div>" : "";
    var ids = {};
    (state.drivers || []).forEach(function (d) { if (d && d.id) ids[d.id] = d; });
    Object.keys(state.hosOvr || {}).forEach(function (id) { if (!ids[id]) ids[id] = { id: id, name: ((state.hosOvr[id] || {}).request || {}).name || id }; });
    /* v72u: lower-odometer requests (driver typed an opening odometer below the last reading) */
    var odoPad = typeof window !== "undefined" && typeof window.pcsOdoPadHtml === "function"; /* v75z: driverlog.js v75z+ */
    var odoHtml = Object.keys(state.hosOvr || {}).filter(function (id) { var o = state.hosOvr[id] || {}; return o.odoRequest && !(o.odoOverride && Number(o.odoOverride.grantedAt) >= Number(o.odoRequest.at)) && !(o.odoDismissed && Number(o.odoDismissed.at) >= Number(o.odoRequest.at)); }).map(function (id) {
      var r = state.hosOvr[id].odoRequest, zero = Number(r.entered) === 0;
      return '<div class="odo-req" style="background:#fee2e2;border:2px solid #b91c1c;border-radius:10px;padding:8px 10px;margin:8px 0;color:#7f1d1d">' + esc(displayName((ids[id] || {}).name || r.name || id, "Driver")) +
        (zero ? ": logged a <strong>zero</strong> opening odometer (refused by the app; day miles were NOT reset)" : ": opening odometer <strong>" + esc(String(r.entered)) + "</strong> is lower than the last reading <strong>" + esc(String(r.last)) + "</strong>") + " (" + esc(ctClock(Number(r.at))) + ") " +
        '<button type="button" class="btn btn-gold" data-odo-ovr="' + esc(id) + '">' + (zero ? "Allow (reset to this reading)" : "Allow lower odometer") + "</button> " +
        '<button type="button" class="btn btn-ghost" data-odo-fix="' + esc(id) + '">Correct mileage</button>' + /* v74b */
        '<div class="odo-fix-form" data-odo-fix-form="' + esc(id) + '" data-odopad-box="1" hidden style="margin-top:8px"><label style="display:block;font-weight:700">Correct odometer reading (whole miles)' +
        '<input type="text" inputmode="' + (odoPad ? "none" : "numeric") + '" pattern="[0-9]*" autocomplete="off" class="odo-fix-val" data-odo-fix-val="' + esc(id) + '" data-odopad-in="1" data-odopad-max="8" value="' + esc(String(Math.floor(Number(r.entered) || 0))) + '" style="display:block;width:100%;min-height:44px;font-size:18px;margin-top:4px"></label>' +
        (odoPad ? window.pcsOdoPadHtml() : "") + /* v75z: big number pad (iPad), from driverlog.js */
        '<label style="display:block;margin-top:6px">Reason (logged, optional)<input type="text" class="odo-fix-why" data-odo-fix-why="' + esc(id) + '" maxlength="200" style="display:block;width:100%;min-height:44px;margin-top:4px"></label>' +
        '<p class="odo-fix-err" data-odo-fix-err="' + esc(id) + '" role="alert" style="color:#7f1d1d;font-weight:700"></p>' +
        '<button type="button" class="btn btn-gold" data-odo-fix-save="' + esc(id) + '">Save corrected reading</button></div>' +
        '<button type="button" class="btn btn-ghost" data-odo-dismiss="' + esc(id) + '">Ignore / Dismiss</button></div>'; /* v74 */
    }).join("");
    gpsHtml = odoHtml + gpsHtml;
    var list = Object.keys(ids).map(function (k) { return ids[k]; }).filter(function (d) {
      var n = hosNeedsGod(d);
      return (d.online && (d.hosLevel === "limit" || d.hosLevel === "30m" || d.hosLevel === "1h" || d.hosLevel === "override")) || n.req || n.resting;
    });
    if (!list.length) return gpsHtml;
    return '<div id="hos-alerts" role="alert" style="background:#fef3c7;border:2px solid #b45309;border-radius:10px;padding:8px 10px;margin:8px 0;color:#7c2d12">' +
      "<strong>Hours-of-service alerts</strong><br>" + list.map(function (d) {
        var by = d.hosBy ? String(d.hosBy).toUpperCase() : "";
        var n = hosNeedsGod(d);
        var head = n.resting ? "<strong style=\"color:#b91c1c\">MANDATORY REST</strong> until " + esc(ctClock(n.restUntil))
          : d.hosLevel === "limit" ? "<strong style=\"color:#b91c1c\">LIMIT REACHED</strong>" : d.hosLevel === "override" || n.ovr ? "override until " + esc(ctClock(Number(n.ovr && n.ovr.until))) : d.hosLevel === "30m" ? "30 min left" : d.hosLevel === "1h" ? "1 hour left" : "";
        var btn = (n.req || n.resting || d.hosLevel === "limit") ? ' <button type="button" class="btn btn-gold hos-ovr-open" data-hos-ovr="' + esc(d.id) + '">Approve override</button>' : "";
        return esc(displayName(d.name, "Driver")) + ": " + head + (n.req ? " · <strong>override requested</strong> " + esc(ctClock(Number(n.req.at))) : "") +
          (by ? " (" + esc(by) + ")" : "") + (d.hosDriveLeftMin != null ? " · left: break " + esc(hmFmt(Math.max(0, d.hosBreakLeftMin))) + ", drive " + esc(hmFmt(Math.max(0, d.hosDriveLeftMin))) + ", shift " + esc(hmFmt(Math.max(0, d.hosShiftLeftMin))) + ", cycle " + esc(hmFmt(Math.max(0, d.hosCycleLeftMin))) : "") + btn;
      }).join("<br>") + "</div>" + gpsHtml;
  }
  function hosPanelHtml() {
    var c = state.hosDraft || state.hosCfg, k = state.hosCfg;
    var rows = HOS_FIELDS.map(function (f) {
      /* v72v (Matthew): readable inputs (dark text on white, 18px), one value per row */
      return '<label class="hos-row" for="' + f[0] + '" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0">' + '<span>' + esc(f[4]) + "</span>" +
        '<input id="' + f[0] + '" type="number" inputmode="decimal" min="' + f[2] + '" max="' + f[3] + '" step="' + (f[1] === "breakAfterMin" ? 15 : f[1] === "breakMinutes" || f[1] === "cycleDays" ? 1 : 0.5) + '" value="' + esc(String(c[f[1]])) + '" style="width:6em;flex:none;background:#ffffff;color:#111827;border:2px solid #3f6a3b;border-radius:8px;padding:6px 8px;font-size:18px;font-weight:700;-webkit-text-fill-color:#111827"></label>';
    }).join("");
    return '<details class="card" id="hos-config"' + (state.hosOpen ? " open" : "") + '><summary><strong>Hours of service (PCS policy)</strong> · drive ' + esc(String(k.maxDriveHours)) + "h · shift " + esc(String(k.shiftWindowHours)) +
      "h · break " + esc(String(k.breakMinutes)) + "m after " + esc(String(k.breakAfterDriveHours)) + "h · cycle " + esc(String(k.cycleHours)) + "h/" + esc(String(k.cycleDays)) + " days</summary>" +
      '<p class="fine">PCS company policy (Matthew\'s CDL / ELD "USA Property 70 hour / 8 day"). Drive time = vehicle moving (GPS over 3 mph) during a shift. ' + esc(String(k.resetHours)) + " h off resets Drive + Shift; " + esc(String(k.restartHours)) + " h off restarts the Cycle.</p>" +
      rows + '<button type="button" class="btn btn-gold" id="hos-save">Save limits</button> <span id="hos-msg" class="fine"></span>' +
      '<p class="fine">Drivers see four countdown clocks (Break, Drive, Shift, Cycle), get a banner + chime at 1 hour and 30 minutes left, and at a limit new ride offers stop (a ride in progress can finish) until the off-duty reset or a God override. Every shift, driving interval, alert and override is logged at /rides/DRVRHSLG.</p></details>';
  }
  function hosPaint() {
    var box = document.getElementById("hos-box-god");
    if (!box) return;
    var a = document.activeElement;
    if (a && /^hos-/.test(a.id || "")) { var al = document.getElementById("hos-alerts-wrap"); if (al) al.innerHTML = hosAlertsHtml(); return; } /* don't wipe typing */
    box.innerHTML = '<div id="hos-alerts-wrap">' + hosAlertsHtml() + "</div>" + '<div id="hos-ovr-wrap">' + hosOvrFormHtml() + "</div>" + hosPanelHtml();
  }
  document.addEventListener("toggle", function (e) { if (e.target && e.target.id === "hos-config") state.hosOpen = e.target.open; }, true);
  document.addEventListener("input", function (e) {
    var id = e.target && e.target.id;
    var f = HOS_FIELDS.filter(function (x) { return x[0] === id; })[0];
    if (!f) return;
    var d = state.hosDraft || Object.assign({}, state.hosCfg);
    d[f[1]] = e.target.value;
    state.hosDraft = d;
  });
  document.addEventListener("click", function (e) {
    if (!e.target || e.target.id !== "hos-save") return;
    var d = state.hosDraft || state.hosCfg;
    var cfg = {}, bad = false;
    HOS_FIELDS.forEach(function (f) { var v = Number(d[f[1]]); if (!(isFinite(v) && v >= f[2] && v <= f[3])) bad = true; cfg[f[1]] = v; });
    var msg = document.getElementById("hos-msg");
    if (bad) { if (msg) msg.textContent = "Check the numbers: " + HOS_FIELDS.map(function (f) { return f[4].split(":")[0] + " " + f[2] + "–" + f[3]; }).join("; "); return; }
    var body = Object.assign({ updatedAt: Date.now() }, cfg);
    if (!gqTok() && !gq.pw) { if (msg) msg.textContent = "Enter the God-mode password in the Rider queue panel first (one time per device)."; return; }
    try { fetch(hosUrl(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(function () {}); } catch (e0) {} /* legacy copy, best effort */
    workerJson("/hos/limits/set", Object.assign({ limits: cfg }, gqAuth())).then(function (d) {
      if (d && d.godToken) { gqSetTok(d.godToken); gq.tokOn = true; gq.pw = ""; }
      return workerJson("/hos/limits/get", {});
    }).then(function (d) {
      var got = d && d.limits || {};
      var same = HOS_FIELDS.every(function (f) { return Number(got[f[1]]) === Number(cfg[f[1]]); });
      if (!same) throw new Error("The server didn't keep the new limits. Try again.");
      state.hosCfg = cfg;
      state.hosDraft = null;
      if (document.activeElement) try { document.activeElement.blur(); } catch (x) {}
      hosPaint();
      var m2 = document.getElementById("hos-msg"); if (m2) m2.textContent = "Saved and verified on the server. Drivers pick it up within 10 minutes (or on next app open).";
    }).catch(function (er) { if (msg) msg.textContent = (er && er.message) || "Could not save. Try again."; });
  });
  setTimeout(hosLoad, 500);
  setInterval(hosPaint, 5000);
  /* ===== end v72r HOS ===== */

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
            '<input id="hire-pct" name="pct" type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" min="0" max="100" step="1" required value="' + esc(state.hirePct) + '">' +
          "</div>" +
        "</div>" +
        '<p class="hire-error" id="hire-error">' + esc(state.hireError) + "</p>" +
        '<p class="hire-notice" id="hire-notice">' + esc(state.hireNotice) + "</p>" +
        '<button class="btn btn-gold hire-btn" type="submit">Hire driver</button>' +
      "</form>"
    );
  }

  function discPaidByText(by) { return by === "driver" ? " (driver covers it: comes off the driver\u2019s share)" : " (PCS covers it: driver % on the full fare)"; } /* v77.10 pure (tested) */
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
    var dayTips = 0, dayTolls = 0, dayTollFees = 0;
    entries.forEach(function (e) {
      if (isTestRide(e)) return; /* v76d */
      dayRide += Number(e.fareTotal) || 0;
      dayComm += Number(e.commissionCents) || 0;
      dayTips += Number(e.tipCents) || 0;
      dayTolls += tollReimbCents(e); dayTollFees += tollFeeCents(e); /* v76b */
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
          "<h3>" + esc(e.code || "Ride") + (e.isTest === true || String(e.paidVia || "") === "test" ? ' <span class="badge" style="background:#7a1f1f;color:#fff;border:1px solid #fff">' + (String(e.paidVia || "") === "test" ? "Rate comparison" : "Test") + "</span>" : "") + (String(e.rideType || "") === "metered" ? ' <span class="badge" style="background:#4a3d12;color:#f0d48a;border:1px solid #f0d48a">Metered</span>' : "") + "</h3>" +
          '<p class="meta">' +
          "<strong>Rider</strong> " + esc(e.riderName || "—") + "<br>" +
          "<strong>Route</strong> " + esc(e.pickup || "") + " → " + esc(e.drop || "") + "<br>" +
          (e.canceled || e.status === "canceled" ? '<strong style="color:#ff9b9b">CANCELED</strong> ' + esc(e.cancelFee === "charge" ? "(cancellation fee to charge)" : "(fee waived, no earnings)") + (e.cancelReason ? " \u00b7 " + esc(e.cancelReason) : "") + "<br>" : "") + /* v73 */
          (Number(e.discountCents) > 0 ? '<strong style="color:#8fd0a8">' + (isCashEntry(e) && e.discountType !== "other" ? "Cash discount" : "Discount") + "</strong> " + /* v74b */ esc(({ senior: "Senior 65+ 10%", military: "Military 10%", other: "Other" })[e.discountType] || "Discount") + " \u2212" + esc(fmtCents(e.discountCents)) +
            (e.discountPaidBy ? discPaidByText(e.discountPaidBy) : /* v77.10; older entries keep the rule they were paid under */ e.discountType === "other" ? " (from the driver\u2019s portion; PCS share on the full fare" + (e.discountReason ? "; reason: " + esc(e.discountReason) : "") + (e.discountApprovedBy ? "; approved by " + esc(e.discountApprovedBy) : "") + ")" : isCashEntry(e) ? "" : " (PCS share reduced in proportion)") + "<br>" : "") +
          invFlagHtml(e) + (entryNeedsReview(e, state.discRev) ? '<strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">Discount: review before payout</strong> ' + discReviewBtn("ride:" + String(e.code || "")) + presetAuditText(e, state.discPresets) + "<br>" : "") + /* r4 M4: Worker review state; Firebase discountReview ignored */
          "<strong>Ride total</strong> " + esc(fmtCents(e.fareTotal)) + "<br>" +
          "<strong>Commission</strong> " + esc(fmtCents(e.commissionCents)) +
          " (" + esc(String(e.commissionPct || "")) + "%)" +
          (isCashEntry(e) ? '<br><strong style="color:#ffb35c">' + (isCardFailedCollect(e) ? "Card failed - collect - driver owes " : "cash - driver owes ") + esc(fmtCents(cashDriverOwesCents(e))) + "</strong>" : "") + /* v72d */
          (String(e.payMethod || "") !== "cash" && String(e.paidVia || "") !== "cash" && e.cashCollected !== true
            ? '<br><button type="button" class="btn btn-ghost" data-cardfail-toggle="' + esc(e.code || "") + '" data-driver="' + esc(driverId) + '" data-on="' + (isCardFailedCollect(e) ? "1" : "0") + '">' +
              (isCardFailedCollect(e) ? "Undo Card failed - collect" : "Mark Card failed - collect") + "</button>" : "") +
          (e.billedMiles != null ? "<br><strong>Miles</strong> " + esc(String(e.billedMiles)) : "") +
          (Number(e.tipCents) > 0 ? "<br><strong>" + (isCashEntry(e) ? "Cash tip" : e.tipVia === "card" ? "Card tip" : "Tip") + "</strong> " + esc(fmtCents(e.tipCents)) + (isCashEntry(e) ? " (driver kept it; not owed to PCS)" : " (100% to driver)") : "") +
          (tollReimbCents(e) ? '<br><strong class="toll-line">' + esc(e.tollLabel || "Tolls") + "</strong> " + esc(fmtCents(tollReimbCents(e))) + (isCashEntry(e) ? " (driver paid them and kept the cash; outside commission)" : " (paid back 100% to driver; outside commission)") : "") + /* v76b */
          (tollFeeCents(e) ? '<br><strong class="tollfee-line">' + esc(e.tollLabel || "Toll road fee") + "</strong> " + esc(fmtCents(tollFeeCents(e))) + " (fare income, in the commission split)" : "") +
          (e.cashReceivedCents != null ? "<br><strong>Cash received</strong> " + esc(fmtCents(e.cashReceivedCents)) + " · <strong>change</strong> " + esc(fmtCents(Number(e.changeCents) || 0)) : "") +
          (String(e.rideType || "") === "metered" && e.paymentStatus ? "<br><strong>Payment</strong> " + esc(meterPayWord(e.paymentStatus, e.paidVia)) : "") +
          "</p>" + (isTestRide(e) ? '<p class="fine" style="color:#ffb3b3;font-weight:700">' + esc(testRideLabel(e)) + " ride: counts for nothing" + (e.testFareCents ? " (meter read " + esc(fmtCents(e.testFareCents)) + ")" : "") + "</p>" : "") +
          rideNoteEditHtml(driverId, e.code || "", e.rideNote) + /* v76d */
          '<button type="button" class="btn btn-ghost" data-test-toggle="' + esc(e.code || "") + '" data-driver="' + esc(driverId) + '" data-on="' + (isTestRide(e) ? "1" : "0") + '">' + (isTestRide(e) ? "Make it a real ride" : "Mark as test ride") + "</button>" +
          "</article>"
        );
      }).join("");
    }
    return (
      '<button type="button" class="btn btn-ghost" id="close-driver-detail">← Drivers</button>' +
      "<h3>" + esc(displayName(d.name, "Driver")) + " · history</h3>" +
      '<button type="button" class="btn btn-gold" data-add-ride-driver="' + esc(driverId) + '" style="margin:4px 0 8px">+ Add ride for ' + esc(displayName(d.name, "driver")) + "</button>" + /* v72d */
      '<p class="meta">' +
      "<strong>All-time ride total</strong> " + esc(fmtCents(totals.rideTotal)) + "<br>" +
      "<strong>All-time commission total</strong> " + esc(fmtCents(totals.commissionTotal)) + "<br>" +
      (totals.tipTotal ? "<strong>All-time tips (100% to driver)</strong> " + esc(fmtCents(totals.tipTotal)) + "<br>" : "") +
      (totals.tollTotal ? "<strong>All-time tolls paid back (100% to driver)</strong> " + esc(fmtCents(totals.tollTotal)) + "<br>" : "") + /* v76b */
      (totals.tollFeeTotal ? "<strong>All-time toll road fees (fare)</strong> " + esc(fmtCents(totals.tollFeeTotal)) + "<br>" : "") +
      "<strong>Pay week</strong> Mon–Sun · " + esc(monday) + " → " + esc(addDaysYmd(monday, 6)) +
      (function () { /* v72d: net per driver for the pay week */
        var wk = payBalance(historyEntries(driverId).filter(function (e) { return weekDays.indexOf(e.day) >= 0; }), { driverId: driverId, pctFor: commissionPctFor, kvPct: state.ridePctKV || {}, cards: state.calendarRaw || {}, charges: state.payCharges || {}, holds: state.payHolds || {}, kvDisc: state.discKV || {}, discPresets: state.discPresets || {}, waitKv: true });
        return '<br><span class="pay-week-net"><strong>Week owed to driver</strong> ' + esc(fmtCents(wk.owedToDriver)) +
          " · <strong>owed by driver (cash)</strong> " + esc(fmtCents(wk.owedByDriver)) +
          " · <strong>Net</strong> " + esc(payNetText(wk)) + "</span>" +
          (wk.held ? '<br><strong style="background:#b91c1c;color:#fff;padding:2px 6px;border-radius:6px">' + wk.held + " ride" + (wk.held === 1 ? "" : "s") + " with held money (" + esc(fmtCents(wk.heldCents)) + "): open the rides to approve</strong>" : "") + /* r6 */
          '<br><span class="pay-week-cash-tips"><strong>Cash tips received</strong> ' + esc(fmtCents(wk.cashTips)) + " (driver keeps 100%; not owed to PCS, not fare; record only)</span>" +
          (wk.tolls ? '<br><span class="pay-week-tolls"><strong>Week tolls paid back</strong> ' + esc(fmtCents(wk.tolls)) + " (100% to driver, in the owed-to-driver total)</span>" : "") + /* v76b */
          (wk.tollRoadFees ? '<br><span class="pay-week-tollfees"><strong>Week toll road fees</strong> ' + esc(fmtCents(wk.tollRoadFees)) + " (fare income, in the commission)</span>" : "");
      })() +
      "</p>" +
      '<div class="cal-week">' +
      '<button type="button" class="btn btn-ghost" id="detail-week-prev">←</button>' +
      cal +
      '<button type="button" class="btn btn-ghost" id="detail-week-next">→</button>' +
      "</div>" +
      '<p class="meta"><strong>' + esc(day) + "</strong> · ride " + esc(fmtCents(dayRide)) +
      " · commission " + esc(fmtCents(dayComm)) + (dayTips ? " · tips " + esc(fmtCents(dayTips)) : "") +
      (dayTolls ? " · tolls " + esc(fmtCents(dayTolls)) : "") + (dayTollFees ? " · toll road fees " + esc(fmtCents(dayTollFees)) : "") + "</p>" + /* v76b */
      list
    );
  }

  /* v73: Earnings & history sheet for one driver, inline in the expanded driver card. Same layout as the driver app
     (pay week Mon-Sun, week ride total / commission / cash tips, per-day expandable rides, Prev / Next week) + Owed to PCS + ride details. */
  state.earnWeek = state.earnWeek || {};
  state.earnDayOpen = state.earnDayOpen || {};
  function earnIsTest(e) { return isTestRide(e); }
  /* v76d (Matthew 10/18): practice, test and rate comparison rides count for NOTHING: earnings, commission, pay week, tips,
     Penny's income and ride totals all skip them. They stay in the list with a badge so nothing is lost. */
  function isTestRide(e) { return !!e && (e.isTest === true || e.testRide === true || String(e.paidVia || "") === "test" || !!e.testKind); }
  function testRideLabel(e) { return String(e.testKind || "") === "practice" ? "Practice" : String(e.paidVia || "") === "test" && !e.testKind ? "Rate comparison" : "TEST"; }
  /* Pure: pay-week patch to mark / unmark a test ride. Marking keeps the real amounts in testOriginal so it can be undone. */
  var TEST_MONEY_KEYS = ["fareSub", "fareTax", "fareTotal", "commissionCents", "commissionPct", "tipCents", "tollCents", "tollRoadFeeCents", "discountCents", "paidVia", "riderName"];
  function testRidePatch(e, on, by, now) {
    e = e || {};
    if (on) {
      if (isTestRide(e) && e.testOriginal) return null; /* already a test ride */
      var orig = {}; TEST_MONEY_KEYS.forEach(function (k) { if (e[k] !== undefined) orig[k] = e[k]; });
      return { isTest: true, testRide: true, testKind: "practice", paidVia: "test", testFareCents: Number(e.fareTotal) || 0, testOriginal: orig,
        fareSub: 0, fareTax: 0, fareTotal: 0, commissionCents: 0, tipCents: 0, tollCents: 0, tollRoadFeeCents: 0, testMarkedAt: now, testMarkedBy: by || "god" };
    }
    var o = e.testOriginal;
    if (!o) return null; /* amounts were zeroed by the driver app (rate comparison): fix them by hand */
    var back = { isTest: false, testRide: false, testKind: null, testOriginal: null, testFareCents: null, testMarkedAt: null, testMarkedBy: null, testUnmarkedAt: now, testUnmarkedBy: by || "god" };
    TEST_MONEY_KEYS.forEach(function (k) { back[k] = o[k] !== undefined ? o[k] : null; });
    return back;
  }
  function godTestToggle(driverId, code, on) {
    var e = ((state.history && state.history[driverId]) || {})[code];
    if (!e) return;
    var now = Date.now(), patch = testRidePatch(e, on, state.sessionEmail || "god", now);
    if (!patch) { state.boardNotice = on ? code + " is already a test ride." : code + ": the real amounts were never saved, so enter them by hand in Add / edit ride."; render(); return; }
    if (!window.confirm(on ? "Mark " + code + " as a test ride? It will count for nothing (earnings, commission, pay week, tips, Penny's income). You can undo it." : "Make " + code + " a real ride again with its saved amounts?")) return;
    godFetch(historyUrl(driverId, code), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("x");
      return godFetch(rideUrl(code), { method: "GET" }).then(function (r) { return r.text(); }).then(function (t) {
        if (!t || t === "null") return null; /* calendar / manual rides have no ride record */
        return godFetch(rideUrl(code), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isTest: !!on, testRide: !!on, testKind: on ? "practice" : null, updatedAt: now }) });
      });
    }).then(function () {
      Object.assign(e, patch);
      state.boardNotice = on ? code + " marked as a test ride (counts for nothing)." : code + " is a real ride again.";
      return refresh();
    }).catch(function () { state.boardNotice = "NOT SAVED: could not update " + code + "."; render(); });
  }
  /* v76d: ride notes (Matthew keeps cash tips and other details here). Saved on the ride, payment and pay-week records. */
  var RIDE_NOTE_MAX = 500;
  function rideNoteClean(t) { return String(t == null ? "" : t).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, RIDE_NOTE_MAX); }
  function rideNotePatch(text, by, now) { var n = rideNoteClean(text); return { rideNote: n || null, rideNoteAt: n ? now : null, rideNoteBy: n ? (by || "god") : null }; }
  var RIDE_NOTE_STYLE = "display:block;width:100%;min-height:96px;font-size:20px;line-height:1.4;color:#111;background:#fff;font-weight:600;border:2px solid #333;border-radius:10px;padding:10px;box-sizing:border-box";
  function rideNoteShowHtml(n) { return n ? '<div class="ride-note" style="margin:6px 0;padding:8px 10px;background:#fff;color:#111;font-size:18px;font-weight:600;line-height:1.4;border-radius:8px;white-space:pre-wrap"><strong>Notes:</strong> ' + esc(n) + "</div>" : ""; }
  function rideNoteEditHtml(driverId, code, n) {
    var id = "god-note-" + String(code).replace(/[^A-Za-z0-9_-]/g, "");
    return '<label for="' + id + '" style="display:block;font-weight:800;font-size:18px;margin:8px 0 4px">Notes</label><textarea id="' + id + '" maxlength="500" rows="3" style="' + RIDE_NOTE_STYLE + '" placeholder="Anything to remember about this ride (optional)" data-note-code="' + esc(code) + '">' + esc(state.noteDrafts && state.noteDrafts[code] != null ? state.noteDrafts[code] : n || "") + "</textarea>" +
      (state.noteDrafts && state.noteDrafts[code] != null && state.noteDrafts[code] !== (n || "") ? '<p class="fine" style="color:#ffb35c;font-weight:700">Unsaved note</p>' : "") +
      '<button type="button" class="btn" data-note-save="' + esc(code) + '" data-driver="' + esc(driverId) + '" data-note-box="' + id + '">Save note</button>';
  }
  function godRideNoteSave(driverId, code, text) {
    var e = ((state.history && state.history[driverId]) || {})[code];
    var now = Date.now(), patch = rideNotePatch(text, state.sessionEmail || "god", now);
    var patchIfThere = function (url) { return godFetch(url, { method: "GET" }).then(function (r) { return r.text(); }).then(function (t) { if (!t || t === "null") return null; return godFetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); }); };
    godFetch(historyUrl(driverId, code), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("x");
      return Promise.all([patchIfThere(rideUrl(code)), patchIfThere(baseUrl() + "/rides/PAYMENTS/" + encodeURIComponent(code) + ".json")]);
    }).then(function () { if (e) Object.assign(e, patch); if (state.noteDrafts) delete state.noteDrafts[code]; state.boardNotice = "Note saved for " + code + "."; return refresh(); })
      .catch(function () { state.boardNotice = "NOT SAVED: note for " + code + " (check the connection and tap Save note again)."; render(); });
  }
  if (typeof document !== "undefined") document.addEventListener("input", function (ev) { /* v76d: keep a typed note across re-renders */
    var t = ev.target; if (!t || !t.getAttribute || !t.getAttribute("data-note-code")) return;
    state.noteDrafts = state.noteDrafts || {}; state.noteDrafts[t.getAttribute("data-note-code")] = t.value; }, true);
  if (typeof window !== "undefined") window.__pcsV76dTest = { isTestRide: isTestRide, testRidePatch: testRidePatch, rideNotePatch: rideNotePatch, rideNoteClean: rideNoteClean };
  function earnPayWord(e) {
    if (isCardFailedCollect(e)) return "Card failed - collect";
    if (isCashEntry(e)) return "Cash";
    var v = String(e.paidVia || e.payMethod || "").toLowerCase();
    return v === "test" ? "Rate comparison" : v === "card" || v === "square" || v === "charged" || !v ? "Card" : v.replace(/_/g, " ");
  }
  function earnRideHtml(e) {
    var cash = isCashEntry(e), tip = Number(e.tipCents) || 0;
    var fare = e.fareGrossSub != null ? Number(e.fareGrossSub) : (Number(e.fareSub) || 0) + (Number(e.discountCents) || 0);
    var row = function (k, v, cls) { return '<div class="money-row' + (cls ? " " + cls : "") + '" style="display:flex;justify-content:space-between;gap:8px"><span>' + k + "</span><span>" + v + "</span></div>"; };
    return '<article class="card earn-ride" data-code="' + esc(e.code || "") + '" style="margin:6px 0;padding:8px 10px' + (earnIsTest(e) ? ";opacity:.6" : "") + '">' +
      '<p class="tag" style="margin:0 0 2px">' + esc(e.code || "Ride") + (e.rideType === "metered" ? " · Metered" : "") + (e.source === "manual" ? " · Added in God mode" : "") +
      (earnIsTest(e) ? ' <span class="badge earn-test" style="background:#7a1f1f;color:#fff">' + esc(testRideLabel(e)) + " (not counted)</span>" : "") +
      (e.status === "canceled" ? ' <span class="badge" style="color:#ff9b9b">CANCELED</span>' : "") + "</p>" +
      "<p style=\"margin:0\"><strong>" + esc(e.riderName || "Rider") + "</strong> · " + esc(e.day || "") + "</p>" + rideNoteShowHtml(e.rideNote) + /* v76d */
      '<p class="fine" style="margin:0 0 4px">' + esc(e.pickup || "") + " \u2192 " + esc(e.drop || "") + "</p>" +
      row("Fare (before discount)", esc(fmtCents(fare))) +
      (Number(e.discountCents) > 0 ? row((cash && e.discountType !== "other" ? "Cash discount" : "Discount") + (e.discountType ? " (" + esc(({ senior: "Senior", military: "Military", other: "Other" })[e.discountType] || e.discountType) + ")" : ""), "\u2212" + esc(fmtCents(e.discountCents))) : "") +
      row("Tax / fees", esc(fmtCents(e.fareTax || 0))) +
      row("Ride total", esc(fmtCents(e.fareTotal || 0))) +
      (tip ? row(cash ? "Cash tip (driver keeps)" : "Card tip (100% driver)", esc(fmtCents(tip))) : "") +
      (tollReimbCents(e) ? row(esc(e.tollLabel || "Tolls") + (cash ? " (driver keeps, outside commission)" : " (paid back 100% driver)"), esc(fmtCents(tollReimbCents(e))), "earn-toll") : "") + /* v76b */
      (tollFeeCents(e) ? row(esc(e.tollLabel || "Toll road fee") + " (fare, in the split)", esc(fmtCents(tollFeeCents(e))), "earn-tollfee") : "") +
      row("Driver commission" + (e.commissionPct ? " (" + esc(String(e.commissionPct)) + "%)" : ""), esc(fmtCents(e.commissionCents || 0))) +
      row("Owed to PCS", esc(fmtCents(cashDriverOwesCents(e))), "earn-owed") +
      row("Payment", esc(earnPayWord(e))) + "</article>";
  }
  function earningsSheetHtml(driverId) {
    var today = chicagoToday();
    var monday = state.earnWeek[driverId] || mondayOfWeek(today);
    var days = []; for (var i = 0; i < 7; i += 1) days.push(addDaysYmd(monday, i));
    var all = historyEntries(driverId);
    var wk = { ride: 0, comm: 0, cashTips: 0, cardTips: 0, owed: 0, tests: 0, tolls: 0, tollFees: 0 };
    var cards = days.map(function (d) {
      var rides = all.filter(function (e) { return e.day === d; });
      var counted = rides.filter(function (e) { return !earnIsTest(e); });
      var dc = 0;
      counted.forEach(function (e) {
        var tip = Number(e.tipCents) || 0;
        wk.ride += Number(e.fareTotal) || 0; wk.comm += Number(e.commissionCents) || 0; dc += Number(e.commissionCents) || 0;
        if (isCashEntry(e)) wk.cashTips += tip; else wk.cardTips += tip;
        wk.tolls += tollReimbCents(e); wk.tollFees += tollFeeCents(e); /* v76b */
        wk.owed += cashDriverOwesCents(e);
      });
      wk.tests += rides.length - counted.length;
      var key = driverId + "|" + d, open = !!state.earnDayOpen[key];
      return '<button type="button" class="btn btn-ghost earn-day-btn" data-earn-day="' + esc(d) + '" data-driver-id="' + esc(driverId) + '" aria-expanded="' + open + '" style="display:block;width:100%;text-align:left;margin:4px 0;font-weight:700">' +
        esc(d === today ? d + " · today" : d) + " · " + counted.length + " rides · " + esc(fmtCents(dc)) + (rides.length > counted.length ? " (+" + (rides.length - counted.length) + " test)" : "") + "</button>" +
        (open ? '<div class="earn-day-body">' + (rides.length ? rides.map(earnRideHtml).join("") : '<p class="fine">No completed rides logged this day.</p>') + "</div>" : "");
    }).join("");
    var weeks = []; var m0 = mondayOfWeek(today); for (var w = 0; w < 12; w += 1) weeks.push(addDaysYmd(m0, -7 * w));
    if (weeks.indexOf(monday) < 0) weeks.push(monday);
    var mrow = function (k, v, id) { return '<div class="money-row" style="display:flex;justify-content:space-between"><span>' + k + "</span><span" + (id ? ' id="' + id + '"' : "") + ">" + v + "</span></div>"; };
    var did = esc(driverId);
    return '<section class="earn-sheet" id="earn-' + did + '" data-driver-id="' + did + '" style="margin:8px 0;padding:10px;border:1px solid rgba(212,177,90,.35);border-radius:12px">' +
      '<h4 style="margin:0 0 2px">Earnings &amp; history</h4>' +
      '<p class="fine" style="margin:0 0 6px">Pay week ' + esc(monday) + " \u2192 " + esc(addDaysYmd(monday, 6)) + " (Mon\u2013Sun) " +
      '<select class="earn-week-sel" data-driver-id="' + did + '" aria-label="Pay week">' + weeks.map(function (x) { return '<option value="' + esc(x) + '"' + (x === monday ? " selected" : "") + ">Week of " + esc(x) + "</option>"; }).join("") + "</select></p>" +
      '<div class="card" style="padding:8px 10px">' +
      mrow("Week ride total", esc(fmtCents(wk.ride)), "earn-wk-ride-" + did) +
      mrow("Week commission", esc(fmtCents(wk.comm)), "earn-wk-comm-" + did) +
      (wk.cardTips ? mrow("Card tips (100% driver)", esc(fmtCents(wk.cardTips))) : "") +
      mrow("Cash tips received", esc(fmtCents(wk.cashTips))) +
      (wk.tolls ? mrow("Tolls paid back (100% driver, outside commission)", esc(fmtCents(wk.tolls)), "earn-wk-tolls-" + did) : "") + /* v76b */
      (wk.tollFees ? mrow("Toll road fees (fare, in the commission)", esc(fmtCents(wk.tollFees)), "earn-wk-tollfees-" + did) : "") +
      mrow("<strong>Owes PCS</strong> (cash rides: company share)", "<strong>" + esc(fmtCents(wk.owed)) + "</strong>", "earn-wk-owed-" + did) +
      (function () { var b = payBalance(all.filter(function (e) { return days.indexOf(e.day) >= 0 && !earnIsTest(e); }), { driverId: driverId, pctFor: commissionPctFor, kvPct: state.ridePctKV || {}, cards: state.calendarRaw || {}, charges: state.payCharges || {}, holds: state.payHolds || {}, kvDisc: state.discKV || {}, discPresets: state.discPresets || {}, waitKv: true }); /* v74b: Owes PCS netted against the week payout */
        return mrow("<strong>Week payout (net)</strong>", "<strong>" + esc(payNetText(b)) + "</strong>", "earn-wk-net-" + did); })() +
      (wk.tests ? '<p class="fine" style="margin:4px 0 0">' + wk.tests + " rate comparison / test ride" + (wk.tests === 1 ? "" : "s") + " shown, not counted ($0).</p>" : "") +
      "</div>" +
      '<button type="button" class="btn btn-gold earn-add-past" data-add-past-ride="' + did + '" data-week="' + esc(monday) + '" style="margin:6px 0">+ Add past ride (this pay week)</button>' + /* v74b */
      cards +
      '<div style="display:flex;justify-content:space-between;margin-top:6px">' +
      '<button type="button" class="btn btn-ghost earn-prev" data-driver-id="' + did + '">\u2190 Prev week</button>' +
      '<button type="button" class="btn btn-ghost earn-next" data-driver-id="' + did + '">Next week \u2192</button></div></section>';
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest(".earn-day-btn,.earn-prev,.earn-next") : null;
      if (!t) return;
      ev.preventDefault();
      var id = t.getAttribute("data-driver-id");
      if (t.classList.contains("earn-day-btn")) { var k = id + "|" + t.getAttribute("data-earn-day"); if (state.earnDayOpen[k]) delete state.earnDayOpen[k]; else state.earnDayOpen[k] = 1; }
      else state.earnWeek[id] = addDaysYmd(state.earnWeek[id] || mondayOfWeek(chicagoToday()), t.classList.contains("earn-prev") ? -7 : 7);
      try { renderBoardLists(); } catch (e) {}
    });
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.classList || !t.classList.contains("earn-week-sel")) return;
      state.earnWeek[t.getAttribute("data-driver-id")] = t.value;
      try { renderBoardLists(); } catch (e) {}
    });
  }
  window.__pcsGodEarn = { html: earningsSheetHtml, ride: function (e) { return earnRideHtml(e); }, entries: historyEntries, pastCheck: function (f, w, t) { return pastRideCheck(f, w, t); }, openPast: function (d, w) { return addPastRideOpen(d, w); } };

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
        else if (signalBadgeHtml(d)) badge = signalBadgeHtml(d) + (trip ? ' <span class="badge on-trip">On trip</span>' : ""); /* v77.10 */
        else if (trip) badge = '<span class="badge on-trip">On trip' + (isBackgroundDriver(d) ? " · app in background" : "") + "</span>";
        else if (isBackgroundDriver(d)) badge = '<span class="badge bg-app" style="background:#4a3d12;color:#f0d48a;border:1px solid #f0d48a">Online · app in background · seen ' + esc(agoText(d.lastSeenAt)) + "</span>";
        else if (d.online && d.autoBreak) badge = '<span class="badge auto-break" style="background:#1f4d33;color:#bef1c6">Break (auto, available)</span>'; /* v74d */
        else if (d.online) badge = '<span class="badge">Online · free</span>';
        else if (d.offlineLoggedIn) badge = '<span class="badge off offline-loggedin">Offline (logged in) · not dispatchable</span>'; /* v73 */
        else badge = '<span class="badge off">Approved · offline</span>';
        var statusShort;
        if (approval === "pending") statusShort = '<span class="badge pending">Pending</span>';
        else if (approval === "rejected") statusShort = '<span class="badge fired">Rejected</span>';
        else if (approval === "fired" || !d.active) statusShort = '<span class="badge fired">Fired</span>';
        else if (signalBadgeHtml(d)) statusShort = signalBadgeHtml(d); /* v77.10 */
        else if (isBackgroundDriver(d)) statusShort = '<span class="badge bg-app" style="background:#4a3d12;color:#f0d48a;border:1px solid #f0d48a">Online · app in background · seen ' + esc(agoText(d.lastSeenAt)) + "</span>";
        else if (d.online && d.autoBreak) statusShort = '<span class="badge auto-break" style="background:#1f4d33;color:#bef1c6">Break (auto, available)</span>'; /* v74d */
        else if (d.online) statusShort = '<span class="badge">Online</span>';
        else if (d.offlineLoggedIn) statusShort = '<span class="badge off offline-loggedin">Offline (logged in)</span>'; /* v73 */
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
              '<button type="button" class="btn btn-gold" data-add-ride-driver="' + esc(d.id) + '">+ Add ride</button>' + /* v72d */
              '<button type="button" class="btn btn-ghost" data-driver-log="' + esc(d.id) + '">Driver\u2019s Log (14 days)</button>' + /* v73 */
              '<button type="button" class="btn btn-ping-driver" data-ping-driver="' + esc(d.id) + '" style="background:#2e7d32;color:#fff;border:0;border-radius:10px;font-weight:800;font-size:17px;min-height:48px;padding:8px 14px;margin:4px 6px 4px 0">Ping driver</button>' + /* v77.10 */
              '<button type="button" class="btn btn-ghost btn-force-logout" data-force-logout="' + esc(d.id) + '"' + (trip ? ' disabled title="Driver is on an active ride"' : "") + ">" + (trip ? "Log out driver (on a ride)" : "Log out driver") + "</button>" + /* v74b */
              '<p class="driver-speed"><strong>Speed</strong> ' + esc(speedTxt) + "</p>" +
              (d.online ? driverVersionHtml(d) : "") + /* v72r */
              (d.online ? driverHosHtml(d) : "") + /* v72r HOS */
              driverGpsHealthHtml(d, mileDays) + /* v72r GPS health */
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
              (function () { var wd = []; var m0 = mondayOfWeek(chicagoToday()); for (var k = 0; k < 7; k += 1) wd.push(addDaysYmd(m0, k));
                var wk = payBalance(historyEntries(d.id).filter(function (e) { return wd.indexOf(e.day) >= 0; }), { driverId: d.id, pctFor: commissionPctFor, kvPct: state.ridePctKV || {}, cards: state.calendarRaw || {}, charges: state.payCharges || {}, holds: state.payHolds || {}, kvDisc: state.discKV || {}, discPresets: state.discPresets || {}, waitKv: true });
                return '<br><strong>This week</strong> ' + esc(payNetText(wk)) + (wk.cashRides ? " (" + wk.cashRides + " cash ride" + (wk.cashRides === 1 ? "" : "s") + ", driver owes " + esc(fmtCents(wk.owedByDriver)) + ")" : "") +
                  (wk.cashTips ? '<br><span class="pay-week-cash-tips">Cash tips received ' + esc(fmtCents(wk.cashTips)) + " (driver's own, record only)</span>" : ""); })() + /* v72d */
              " · " + esc(String(totals.count)) + " logged rides" +
              "</p>" +
              (hist.length
                ? '<details class="miles-history"><summary>Last 14 days miles</summary><ul>' + hist.join("") + "</ul></details>"
                : '<p class="fine">No mileage days saved yet.</p>') +
              earningsSheetHtml(d.id) + /* v73: tap the driver's name -> this sheet, inline */
              '<button type="button" class="btn btn-ghost btn-open-driver" data-driver-id="' + esc(d.id) + '">Calendar & history</button>' +
              '<div class="commission-row">' +
                '<label class="commission-label" for="comm-' + esc(d.id) + '">Commission %</label>' +
                '<input class="commission-input" id="comm-' + esc(d.id) + '" data-driver-id="' + esc(d.id) + '" type="text" inputmode="decimal" pattern="[0-9]*" min="0" max="100" step="1" value="' + esc(String(state.commissionDrafts[d.id] != null && state.commissionDrafts[d.id] !== "" ? state.commissionDrafts[d.id] : pct)) + '"' + (approval === "approved" ? "" : " disabled") + ">" +
                '<button type="button" class="btn btn-ghost btn-save-comm" data-driver-id="' + esc(d.id) + '"' + (approval === "approved" ? "" : " disabled") + ">Save</button>" +
                '<span class="comm-unsaved" id="comm-unsaved-' + esc(d.id) + '" style="color:#ffb35c;font-weight:800;margin-left:6px">' + (state.commissionDrafts[d.id] != null && state.commissionDrafts[d.id] !== "" && String(state.commissionDrafts[d.id]) !== String(pct) ? "Unsaved (saved: " + esc(String(pct)) + "%)" : "") + "</span>" + /* v76d */
                ((state.commissionErrors || {})[d.id] ? '<p class="comm-error" role="alert" style="background:#b91c1c;color:#fff;font-weight:800;padding:6px 10px;border-radius:8px;margin:6px 0">' + esc(state.commissionErrors[d.id]) + "</p>" : "") +
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
        return godFetch(openRowUrl(code), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
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
          ? '<span class="badge pending">Needs your OK</span>' + conflictBadgeHtml(r)
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
      actions += conflictToolsHtml(r); /* v75p */
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

  /* ---------- v73 helpers ---------- */
  function godFocusIn(el) {
    var a = document.activeElement;
    return !!(el && a && a !== document.body && el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }
  function dbFlushLater() {
    setTimeout(function () {
      var b = document.getElementById("day-board");
      if (state.dbDirty && b && !godFocusIn(b) && !((state.dbHoldUntil || 0) > Date.now())) renderBoardLists();
    }, 400);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("focusout", function (e) { if (e.target && e.target.closest && e.target.closest("#day-board")) dbFlushLater(); });
    ["pointerdown", "touchstart", "mousedown"].forEach(function (ev) {
      document.addEventListener(ev, function (e) { if (e.target && e.target.closest && e.target.closest("#day-board select")) { state.dbHoldUntil = Date.now() + 20000; } }, { passive: true, capture: true });
    });
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("day-assign")) { /* v77.10: save the pick right away */
        var eid = t.getAttribute("data-event-id"), did = t.value, crow = null; (state.calendar || []).forEach(function (r) { if (r && r.id === eid) crow = r; });
        var chk = assignPickPatch(crow, did ? { id: did } : null, Date.now()); if (!chk.ok) { state.boardNotice = chk.error; renderBoardLists(); return; }
        state.assignDrafts[eid] = did; state.dbHoldUntil = 0; t.disabled = true;
        (did ? assignCalendarRide(eid, did) : unassignCalendarRide(eid)).then(function () {
          delete state.assignDrafts[eid]; if (did) state.boardNotice = "Saved \u2713 " + state.boardNotice; t.disabled = false; boardForceRebuild(); }) /* v77.12 */
          .catch(function (err) { delete state.assignDrafts[eid]; t.disabled = false;
            state.boardNotice = "NOT SAVED: " + (err && err.message === "driver" ? "that driver isn\u2019t on the roster." : err && err.message && err.message !== "missing" ? err.message : "try again."); renderBoardLists(); });
      }
    }, true);
  }
  /* v73 (Matthew): cash-register money boxes. Digit keypad (inputmode numeric), digits fill from the right:
     2,3,7,5 -> 23.75; backspace drops the last digit. Tapping the box selects it, so the first digit starts fresh. */
  function moneyRegFmt(v) {
    var dg = String(v == null ? "" : v).replace(/\D/g, "").replace(/^0+/, "");
    if (!dg) return "";
    if (dg.length > 7) dg = dg.slice(0, 7);
    return (Number(dg) / 100).toFixed(2);
  }
  /* v74b (Matthew): alert-card buttons readable: solid, high contrast, full width, 44 px+ (was faint gold-on-pink ghost) */
  (function () { if (typeof document === "undefined" || document.getElementById("god-alert-btn-css")) return; var st = document.createElement("style"); st.id = "god-alert-btn-css";
    st.textContent = ".odo-req .btn,.god-dvir-flag .btn,.god-dvir-missed .btn,.booking-alert .btn,#god-dvir-alerts .btn{display:block;width:100%;min-height:44px;margin:8px 0 0;font-weight:700;font-size:16px;border-radius:10px;opacity:1}" +
      ".odo-req .btn-ghost,.god-dvir-flag .btn-ghost,.god-dvir-missed .btn-ghost,.booking-alert .btn-ghost,#god-dvir-alerts .btn-ghost{background:#1f2937 !important;color:#fff !important;border:2px solid #fff !important;text-shadow:none}" +
      ".odo-req .btn-gold,#god-dvir-alerts .btn-gold,.booking-alert .btn-gold{background:#d4af37 !important;color:#111 !important;border:2px solid #111 !important}";
    (document.head || document.documentElement).appendChild(st); })();
  function moneyRegAttrs() { return ' type="text" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" data-money-reg="1"'; } /* v76j: digit pad, register style */ /* v74b: numeric keypad with a decimal point */
  function moneyRegVal(n) { var x = Number(n); return n === "" || n == null || !isFinite(x) ? "" : x.toFixed(2); }
  if (typeof document !== "undefined") {
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || t.getAttribute("data-money-reg") !== "1") return;
      var f = moneyRegFmt(t.value);
      if (t.value !== f) t.value = f;
      try { t.setSelectionRange(f.length, f.length); } catch (x) {}
    }, true);
    /* keyboard digits / Backspace: the register works on the digits itself (first key after focus starts a new amount),
       so a caret position or a click that drops the selection can't scramble it. Phones that send no key fall back to the input handler. */
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || t.getAttribute("data-money-reg") !== "1" || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (!/^[0-9]$/.test(k) && k !== "Backspace") return;
      e.preventDefault();
      var dg = t.__regFresh ? "" : String(t.value || "").replace(/\D/g, "").replace(/^0+/, "");
      t.__regFresh = false;
      dg = k === "Backspace" ? dg.slice(0, -1) : (dg.length < 7 ? dg + k : dg);
      t.value = moneyRegFmt(dg);
      try { t.setSelectionRange(t.value.length, t.value.length); } catch (x) {}
      t.dispatchEvent(new Event("input", { bubbles: true }));
    }, true);
    document.addEventListener("focusin", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || t.getAttribute("data-money-reg") !== "1") return;
      t.__regFresh = true;
      if (t.value && !/\.\d\d$/.test(t.value)) t.value = moneyRegVal(t.value);
      setTimeout(function () { try { t.setSelectionRange(0, t.value.length); } catch (x) {} }, 0);
    });
  }
  window.__pcsMoneyRegFmt = moneyRegFmt; /* test hook */

  /* ---------- v73 discount requests ("Other" discount from a driver): Matthew sets $ or % or declines ---------- */
  var DISC_HUB = "DSCNTRQS";
  function discUrl(code) { return baseUrl() + "/rides/" + DISC_HUB + (code ? "/" + encodeURIComponent(code) : "") + ".json"; }
  function listDiscReqs() {
    /* v69.8: requests live in the Worker (KV); God token reads them. No token yet / old Worker -> the Firebase hub (v73 first cut) */
    var t = ""; try { t = gqTok(); } catch (e) {}
    var fb = function () { return fetch(discUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { return d && typeof d === "object" ? d : {}; }).catch(function () { return {}; }); };
    if (!t || state.godDbOff) return fb();
    return workerJson("/disc/list", { godToken: t }).then(function (d) {
      if (d && d.godToken) gqSetTok(d.godToken);
      var out = {}; (d && d.requests || []).forEach(function (q) { if (q && q.code) out[q.code] = Object.assign({ via: "worker" }, q); });
      return fb().then(function (old) { Object.keys(old).forEach(function (k) { if (!out[k]) out[k] = old[k]; }); return out; });
    }).catch(function () { return fb(); });
  }
  function discReqSync() {
    var reqs = state.discReqs || {};
    var pend = Object.keys(reqs).map(function (k) { return Object.assign({ code: k }, reqs[k]); })
      .filter(function (q) { return q && q.status === "pending"; })
      .sort(function (a, b) { return (Number(a.requestedAt) || 0) - (Number(b.requestedAt) || 0); });
    var el = document.getElementById("god-disc-popup");
    if (!pend.length) { if (el && !godFocusIn(el)) el.remove(); return; }
    var q = pend[0];
    if (el && el.getAttribute("data-code") === q.code) return; /* already showing: keep what Matthew typed */
    if (el && godFocusIn(el)) return;
    if (el) el.remove();
    el = document.createElement("div");
    el.id = "god-disc-popup"; el.setAttribute("data-code", q.code);
    el.style.cssText = "position:fixed;inset:0;z-index:2147482500;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px";
    el.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="gd-title" style="background:#141414;color:#fff;border:2px solid #f0d48a;border-radius:16px;max-width:460px;width:100%;padding:16px">' +
      '<h2 id="gd-title" style="margin:0 0 6px">Discount request \u00b7 ' + esc(q.code) + "</h2>" +
      '<p class="meta" id="gd-who">' + esc(q.driverName || q.driverId || "Driver") + " \u00b7 fare " + esc(fmtCents(q.fareSubCents)) + " before tax" + (pend.length > 1 ? " \u00b7 " + (pend.length - 1) + " more waiting" : "") + "</p>" +
      '<p id="gd-reason" style="font-weight:700">Reason: ' + esc(q.reason || "") + "</p>" +
      (q.preset ? '<p style="font-weight:800;color:#9be7b0">' + (q.preset === "military" ? "Military discount (10%): check the military ID" : "Senior discount, 65+ (10%): check ID showing age 65+") + '</p><input id="gd-pct" type="hidden" value="10">' : /* r4 M5 */
      '<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><div><label for="gd-amount">Amount off ($)</label><input id="gd-amount"' + moneyRegAttrs() + ' style="width:120px"></div>' +
      '<div><label for="gd-pct">or percent off (%, up to 50)</label><input id="gd-pct" type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" autocomplete="off" style="width:90px"></div></div>') +
      '<p class="fine">PCS covers the discount: the driver\u2019s % stays on the full fare.</p>' +
      '<p class="error" id="gd-err" role="alert" style="color:#ff6b6b"></p>' +
      '<div style="display:flex;gap:8px"><button type="button" class="btn btn-gold" id="gd-approve">Approve</button><button type="button" class="btn btn-ghost" id="gd-decline">Decline</button></div></div>';
    document.body.appendChild(el);
    var go = function (status) {
      var amt = Math.round(Number(String((document.getElementById("gd-amount") || {}).value || "").replace(/[^0-9.]/g, "")) * 100) || 0;
      var pct = Math.round(Number(String((document.getElementById("gd-pct") || {}).value || "").replace(/\D/g, ""))) || 0;
      var err = document.getElementById("gd-err");
      if (status === "approved") {
        if ((amt > 0) === (pct > 0)) { if (err) err.textContent = "Enter a dollar amount OR a percent (one of them)."; return; }
        if (pct > 50 || (Number(q.fareSubCents) > 0 && amt > Number(q.fareSubCents))) { if (err) err.textContent = "That is more than the fare."; return; }
      }
      var now = Date.now();
      var patch = { status: status, amountCents: status === "approved" ? amt : 0, pct: status === "approved" ? pct : 0, decidedBy: "Matthew", decidedAt: now, updatedAt: now };
      var save = q.via === "worker"
        ? (function () { var a = godWriteAuth(); if (!a) return Promise.reject(new Error("God password needed.")); return workerJson("/disc/decide", Object.assign({ code: q.code, decision: status === "approved" ? "approve" : "decline", amountCents: amt, pct: pct }, a)).then(function (d) { if (d && d.godToken) gqSetTok(d.godToken); if (d && d.request) Object.assign(patch, { decidedAt: d.request.decidedAt }); return { ok: true }; }); })()
        : fetch(discUrl(q.code), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      save.then(function (r) {
        if (!r.ok) throw new Error("Could not save. Try again.");
        state.discReqs[q.code] = Object.assign({}, q, patch);
        el.remove();
        state.boardNotice = (status === "approved" ? "Approved discount " + (amt ? fmtCents(amt) : pct + "%") : "Declined discount") + " for " + q.code;
        discReqSync();
      }).catch(function (e) { if (err) err.textContent = (e && e.message && e.message !== "x" ? e.message : "Could not save. Try again."); });
    };
    document.getElementById("gd-approve").addEventListener("click", function () { go("approved"); });
    document.getElementById("gd-decline").addEventListener("click", function () { go("declined"); });
  }
  window.__pcsGodDisc = { sync: function () { discReqSync(); } };

  function renderBoardLists() {
    var d = document.getElementById("drivers-list");
    var r = document.getElementById("rides-list");
    var b = document.getElementById("day-board");
    if (d) d.innerHTML = driversPanelHtml();
    if (r) r.innerHTML = ridesPanelHtml();
    var pl = document.getElementById("payments-list");
    syncPayHead(); /* v75m */
    if (pl) {
      /* v58: only redraw when something changed, so a Refund / Charge tap is never lost to the 5 s poll. */
      var payHtml = paymentsPanelHtml();
      if (pl.getAttribute("data-html-sig") !== String(payHtml.length) + ":" + hashStr(payHtml)) {
        pl.innerHTML = payHtml;
        pl.setAttribute("data-html-sig", String(payHtml.length) + ":" + hashStr(payHtml));
        pl.removeAttribute("data-bound");
      }
    }
    var dbFresh = false;
    if (b && (godFocusIn(b) || (state.dbHoldUntil || 0) > Date.now())) state.dbDirty = true; /* v73: never rebuild under an open picker / typed box */
    else if (b) {
      var wrap = document.createElement("div");
      wrap.innerHTML = dayBoardHtml();
      var next = wrap.firstChild;
      if (next) { b.replaceWith(next); dbFresh = true; state.dbDirty = false; }
    }
    try { discReqSync(); } catch (eDisc) {}
    refreshDailyMiles(); /* v71m */
    mountAddRide(); /* v72d */
    bindDriverActions();
    bindBookingActions();
    bindPaymentActions();
    bindSafetyActions();
    bindLocateActions();
    if (dbFresh) bindDayBoardActions(); /* v73: a kept board keeps its listeners (no double binding) */
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
    state.tipDrafts = state.tipDrafts || {}; state.cancelOpen = state.cancelOpen || {};
    Array.prototype.forEach.call(board.querySelectorAll(".day-tip-in"), function (input) {
      input.addEventListener("input", function () { state.tipDrafts[input.getAttribute("data-event-id")] = input.value; });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".day-paid-in"), function (input) { /* v75w */
      input.addEventListener("input", function () { state.paidDrafts = state.paidDrafts || {}; var eid = input.getAttribute("data-event-id"); state.paidDrafts[eid] = input.value;
        var pl = document.getElementById("paid-pre-" + eid), row = arFindRow(eid), v = String(input.value || "").replace(/[$,\s]/g, "");
        if (pl) pl.textContent = paidSquareLine(v !== "" && isFinite(+v) ? Math.round(+v * 100) : null, row && row.assignedDriverId ? commissionPctFor(row.assignedDriverId) : null); }); /* each driver's own % */
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-save-tip"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id"), inp = document.getElementById("tip-" + id);
        btn.disabled = true;
        var pin = document.getElementById("paid-" + id);
        saveCalendarTip(id, inp ? inp.value : state.tipDrafts[id], pin ? pin.value : (state.paidDrafts || {})[id]).catch(function (e) { btn.disabled = false; state.boardNotice = (e && e.message && e.message !== "missing" ? e.message : "Saving didn\u2019t finish. Try again."); renderBoardLists(); });
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-cancel-open,.btn-cancel-close"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id");
        if (btn.classList.contains("btn-cancel-open")) state.cancelOpen[id] = { fee: "waive", reason: "" }; else delete state.cancelOpen[id];
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        state.dbHoldUntil = 0; renderBoardLists();
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".day-cancel-reason"), function (input) {
      input.addEventListener("input", function () { var o = state.cancelOpen[input.getAttribute("data-event-id")]; if (o) o.reason = input.value; });
    });
    Array.prototype.forEach.call(board.querySelectorAll('.day-cancel input[type="radio"]'), function (rb) {
      rb.addEventListener("change", function () { var id = rb.name.replace(/^cfee-/, ""); if (state.cancelOpen[id]) state.cancelOpen[id].fee = rb.value; });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-cancel-go"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id"), o = state.cancelOpen[id] || {};
        var ri = document.getElementById("creason-" + id), reason = String(ri ? ri.value : o.reason || "").trim();
        var ch = board.querySelector('input[name="cfee-' + id + '"]:checked'), fee = ch ? ch.value : (o.fee || "waive");
        var er = document.getElementById("cerr-" + id);
        if (reason.length < 3) { o.err = "Type a short reason."; if (er) er.textContent = o.err; return; }
        if (!window.confirm("Cancel this ride? " + (fee === "charge" ? "A cancellation fee will be charged." : "No fee (waived).") + " The driver is told and it leaves the board.")) return;
        btn.disabled = true;
        cancelCalendarRide(id, fee, reason.slice(0, 200)).catch(function () { btn.disabled = false; if (er) er.textContent = "Could not cancel. Try again."; });
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
        var cur = rovRow(id); /* v77.12: the pick already saved it (change handler) -> say so instead of looking dead */
        if (cur && cur.assignedDriverId === driverId && cur.status === "assigned") { state.boardNotice = "Saved \u2713 already assigned to " + (cur.assignedDriverName || driverId) + "."; boardForceRebuild(); return; }
        btn.disabled = true;
        state.dbHoldUntil = 0;
        assignCalendarRide(id, driverId).then(function () {
          delete state.assignDrafts[id];
          btn.disabled = false; boardForceRebuild(); /* v77.12 */
        }).catch(function (err) {
          btn.disabled = false;
          state.boardNotice = "Could not assign that ride" + (err && err.message === "driver" ? " (driver not on the roster)." : err && err.message ? " (" + err.message + ")." : ".");
          renderBoardLists();
        });
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-save-rcomm"), function (btn) { /* v76d */
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id"), inp = document.getElementById("rcomm-" + id);
        btn.disabled = true;
        saveRideCommission(id, inp ? inp.value : "").then(function () { btn.disabled = false; });
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-prepaid"), function (btn) { /* v75v */
      btn.addEventListener("click", function () { dbPrepaidOpen(btn.getAttribute("data-event-id")); });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-edit-drop"), function (btn) { /* v75r */
      btn.addEventListener("click", function () { dbDropOpen(btn.getAttribute("data-event-id"), btn.getAttribute("data-field")); });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-save-fare"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id");
        if (!id) return;
        var fi = document.getElementById("fare-" + id), fx = document.getElementById("fixed-" + id), iv = document.getElementById("inv-" + id);
        btn.disabled = true;
        saveCalendarFare(id, fi ? fi.value : state.fareDrafts[id], !!(fx && fx.checked), iv ? iv.value : null).then(function () { btn.disabled = false; }).catch(function (err) {
          btn.disabled = false;
          state.boardNotice = err && err.message === "fare" ? "Type the fare before tax first." : err && err.message === "invoice" ? "Invoice # takes digits only, like 000519." : "Fare NOT saved. Try again.";
          renderBoardLists();
        });
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-undo-complete"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id");
        if (!id || !window.confirm("Undo this completion? The ride goes back to assigned and the earnings entry is removed.")) return;
        btn.disabled = true;
        undoCalendarComplete(id).catch(function () { btn.disabled = false; state.boardNotice = "Could not undo that completion."; renderBoardLists(); });
      });
    });
    Array.prototype.forEach.call(board.querySelectorAll(".btn-complete-ride"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-event-id");
        if (!id) return;
        var fareInput = document.getElementById("fare-" + id);
        var fare = fareInput ? fareInput.value : state.fareDrafts[id];
        var crow = null; (state.calendar || []).forEach(function (r) { if (r && r.id === id) crow = r; });
        var startMs = rideStartMs(crow);
        if (startMs && startMs > Date.now()) {
          if (!window.confirm("This ride doesn't start until " + fmtBoardWhen(crow.start) + ". Completing it now hides it from the driver app. Complete it early anyway?")) return;
        }
        if (zeroFareWarn(crow, fare) && !window.confirm("This ride has a $0 fare and nothing paid in Square. The driver gets $0 for it. Finish it anyway?")) return; /* v76d */
        if (!window.confirm("Complete this ride and credit commission into this driver's Mon–Sun pay week?")) return;
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
    out.sort(function (a, b) { return payTimeOf(b) - payTimeOf(a); }); /* v75m: newest first by ended/updated */
    return out.slice(0, 40);
  }
  /* v75m: sort key = metered ended time, else updatedAt. */
  function payTimeOf(p) {
    var m = p && p.meter || {};
    return Number(m.endedAt) || Number(p && p.unpaidFinishedAt) || Number(p && p.updatedAt) || 0;
  }
  /* v75m: collapsible Payments header (collapsed by default, remembered). */
  var PAY_OPEN_KEY = "pcs_god_payments_open";
  function payOpen() { try { return localStorage.getItem(PAY_OPEN_KEY) === "1"; } catch (e) { return false; } }
  function payHeadHtml() {
    var n = 0, unpaid = 0;
    if (!state.paymentsError) {
      var l = payEntries(); n = l.length;
      unpaid = l.filter(function (p) { return isMeteredPay(p) && meterStatusOf(p) === "unpaid"; }).length;
    }
    return (payOpen() ? "▼" : "▶") + " Payments (" + n + ")" +
      (unpaid ? ' <span class="badge" style="background:#c62828;color:#fff">' + unpaid + " unpaid</span>" : "");
  }
  function syncPayHead() {
    var h = document.getElementById("payments-head");
    var pl = document.getElementById("payments-list");
    if (h) { var hh = payHeadHtml(); if (h.innerHTML !== hh) h.innerHTML = hh; h.setAttribute("aria-expanded", payOpen() ? "true" : "false"); }
    if (pl) pl.style.display = payOpen() ? "" : "none";
    if (h && !h.getAttribute("data-bound")) {
      h.setAttribute("data-bound", "1");
      h.addEventListener("click", function () {
        try { localStorage.setItem(PAY_OPEN_KEY, payOpen() ? "0" : "1"); } catch (e) {}
        syncPayHead();
      });
    }
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
    /* a cancel the Worker already decided free (test ride / old v59 rule) can't be charged */
    if (String(ride.cancelFeeStatus || "").toLowerCase() === "free") return false;
    if (ride.cancelPolicy && typeof ride.cancelPolicy === "object" && ride.cancelPolicy.charge === false) return false;
    if (p && p.cancelPolicy) return false;
    return true; /* v72c: any rider cancel of a booked ride owes the fee, accepted or not */
  }

  /* ---------------- v70: metered rides (driver app) ---------------- */
  function isMeteredPay(p) {
    return !!p && (String(p.rideType || "").toLowerCase() === "metered" || !!(p.meter && typeof p.meter === "object"));
  }
  function meterStatusOf(p) {
    var m = (p && p.meter) || {};
    var ms = String(m.status || "").toLowerCase();
    if (payRecOk(p.final)) return "paid";
    if (ms === "invoice_pending") return "invoice_pending"; /* v77.26 */
    if (p.paidOther || ms === "paid_other" || ms === "unverified") return payOtherVerdict(p); /* v77.26: cash by the driver / God override only */
    if (ms === "paid") return "paid";
    if (ms === "running") return "running";
    return "unpaid"; /* ended (waiting for the QR payment) or finished unpaid */
  }
  /* v77.26 (pure, tested): a "paid another way" record counts as PAID only for cash collected by the driver
     (paidOther.driverId set, not cleared in God) or a God cash clear WITH a reason; Square invoice records come from Square
     (invoice_sync). Zelle / Venmo / card machine / other -> "unverified". Tests ($0 rate comparison) and waived stay as is. */
  function payOtherVerdict(p) {
    var o = (p && p.paidOther) || {}, m = String(o.method || p.paidVia || "").toLowerCase();
    if (m === "test" || m === "waived") return "paid_other";
    if (m === "square_invoice") return String(p.invoiceStatus || "PAID").toUpperCase() === "PAID" ? "paid_other" : "invoice_pending";
    if (m === "cash" && o.clearedInGod) return String(o.reason || (p.godCleared && p.godCleared.reason) || "").trim() ? "paid_other" : "unverified";
    if (m === "cash" && (o.driverId || p.paidOtherByDriverId)) return "paid_other";
    return "unverified";
  }
  function meterPayWord(ps, via) {
    ps = String(ps || "").toLowerCase();
    if (ps === "invoice_pending") return "Invoice sent, waiting on Square";
    if (ps === "unverified") return "Unverified" + (via ? " (" + String(via).replace("_", " ") + ")" : "") + ": not paid until Square or cash confirms";
    if (ps === "charged") return "Paid (Square)";
    if (ps === "paid_other" && String(via || "") === "test") return "Rate comparison ($0)"; /* v72x.1; v73 label */
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
    rows.sort(function (a, b) { return payTimeOf(b) - payTimeOf(a); }); /* v75m */
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
          '<span style="color:#ff8a8a">' + (finished ? "Driver finished without payment" : "Waiting for the rider to pay (QR)") + "</span><br>" +
          /* v75m: clear this ride */
          '<select class="meter-clear-sel" data-code="' + esc(p.code) + '" style="margin-top:6px;padding:8px;font-size:15px">' +
            '<option value="">Clear this ride…</option><option value="cash">Paid in cash</option><option value="other">Rider says paid another way (unverified)</option>' +
            '<option value="waived">Waive it (no charge)</option><option value="link">Send rider a pay link</option><option value="test">Dismiss as test ride</option></select> ' +
          '<button type="button" class="btn meter-clear-apply" data-code="' + esc(p.code) + '" style="margin-top:6px">Apply</button>' +
          '<span class="meter-clear-link" data-code="' + esc(p.code) + '"></span></p>';
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
    if (Number(m.tollCents) > 0) lines.push("<strong>" + esc(m.tollLabel || (m.tollKind === "road_fee" ? "Toll road fee" : "Tolls")) + "</strong> " + esc(fmtCents(m.tollCents)) +
      (m.tollKind === "road_fee" ? " (fare income, in the split)" : " (paid back 100% to the driver)") + " · in the fare above"); /* v76b */
    if (st === "running") lines.push('<span style="color:#f0d48a">Ride in progress</span>' + (godMeterShown(p) ? "" : godInvBadgeHtml(godInvInfo(p)))); /* v2.0a */
    else if (st === "unverified" || st === "invoice_pending") lines.push('<span style="color:#ffc96b"><strong>' + esc(meterPayWord(st, (p.paidOther || {}).method || p.paidVia)) + "</strong></span>");
    else if (st === "paid_other") {
      var o = p.paidOther || {};
      lines.push('<span style="color:#ffc96b">Paid another way · ' + esc(String(o.method || "other").replace("_", " ")) + " · " + esc(fmtCents(o.amountCents)) +
        " · tip " + esc(fmtCents(Number(o.tipCents) || 0)) +
        (o.cashReceivedCents != null ? " · cash received " + esc(fmtCents(o.cashReceivedCents)) + " · change " + esc(fmtCents(Number(o.changeCents) || 0)) : "") + " · reported by " + esc(o.by || m.driverName || "driver") + " · not checked by Square</span>");
    } else if (st === "unpaid") lines.push('<span style="color:#ff8a8a"><strong>NOT PAID</strong></span>');
    if (p.rideNote) lines.push(rideNoteShowHtml(p.rideNote)); /* v76d */
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
    syncPayHead(); /* v75m */
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
    var auth = gqAuth(); /* v77: the Worker needs God sign-in to charge (and signs the fare shown here) */
    if (!auth.godPassword && !auth.godToken) { delete state.payBusy[code]; setPayNotice("Sign in to God mode first, then charge."); return; }
    var body = Object.assign({ rideCode: code, tipCents: 0, expectedCents: Number(cents) || 0, by: "god" }, auth);
    if (isSandboxPay(code)) body.sandbox = true;
    payWorkerPost("/charge", body).then(function (d) {
      afterPayAction(code, d.already ? code + ": already paid." : code + ": charged " + fmtCents(d.totalCents || d.amountCents || cents) + ".");
    }).catch(function (err) {
      afterPayAction(code, code + ": charge failed — " + ((err && err.message) || "error"));
    });
  }

  function chargeCancelFeeNow(code) {
    if (!code || state.payBusy[code]) return;
    if (!window.confirm("Charge the cancel fee for " + code + " to the saved card?\n\nFee = 25% of the fare or $10, whichever is higher (any rider cancel after booking). The payment server works out the amount.")) return;
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
      '<input id="pp-amount"' + moneyRegAttrs() + ' value="' + esc((left / 100).toFixed(2)) + '">' +
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

  /* v75m: clear an unpaid metered ride from God mode. Records who/how/when; never deletes. Writes only under /rides/. */
  var METER_CLEAR_WORD = { cash: "Paid in cash (God override)", other: "Unverified (paid another way)", waived: "Waive it (no charge)", test: "Dismiss as test ride" };
  function meterClearLinkUrl(code) {
    var p = (state.payments || {})[code] || {};
    var rr = payRideOf(code) || {};
    var u = String((p.meterLink && p.meterLink.url) || rr.meterLinkUrl || "");
    return /^https:\/\//i.test(u) && !rr.meterLinkVoidedAt ? u : "";
  }
  function meterClearShowLink(root, code) {
    var box = root.querySelector('.meter-clear-link[data-code="' + code + '"]');
    if (!box) return;
    var url = meterClearLinkUrl(code);
    if (!url) { box.innerHTML = '<br><span style="color:#ffc96b">No open pay link for this ride (the QR link was not created or was closed). Nothing was sent.</span>'; return; }
    box.innerHTML = '<br><input type="text" readonly value="' + esc(url) + '" style="width:100%;margin-top:6px;padding:6px;font-size:13px"> ' +
      '<button type="button" class="btn meter-link-copy">Copy</button> ' +
      (navigator.share ? '<button type="button" class="btn meter-link-share">Share</button>' : "") +
      '<br><span style="opacity:.85">Not sent automatically. Send it to the rider yourself.</span>';
    var inp = box.querySelector("input");
    var cp = box.querySelector(".meter-link-copy");
    cp.addEventListener("click", function () {
      var done = function () { cp.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { inp.select(); try { document.execCommand("copy"); done(); } catch (e) {} });
      else { inp.select(); try { document.execCommand("copy"); done(); } catch (e) {} }
    });
    var sh = box.querySelector(".meter-link-share");
    if (sh) sh.addEventListener("click", function () { navigator.share({ title: "PCS ride payment", text: "Pay for your PCS ride (" + code + "):", url: url }).catch(function () {}); });
  }
  function meterClearApply(code, how) {
    var p = (state.payments || {})[code] || {};
    var m = p.meter || {};
    var fare = Number(m.fareTotal) || 0;
    var now = Date.now(), who = godWho();
    var amount = how === "waived" || how === "test" ? 0 : fare;
    var reason = "";
    if (how === "cash") { reason = String(window.prompt("Cash override: type the reason (it is logged). Cash normally comes from the driver's Cash collected tap.", "") || "").trim();
      if (reason.length < 3) { setPayNotice(code + ": cash not recorded. A reason is required."); return Promise.resolve(); } }
    var cleared = { at: now, how: how, label: METER_CLEAR_WORD[how], by: who, fareCents: fare, reason: reason || null };
    var stV = how === "other" ? "unverified" : "paid_other"; /* v77.26 */
    var ridePatch = { paymentStatus: stV, paidVia: how, paidOtherCents: amount, tipCents: 0, paidAt: now,
      paidOtherBy: who, godCleared: cleared, updatedAt: now };
    if (how === "test") ridePatch.isTest = true;
    var idxPatch = { paymentStatus: stV, updatedAt: now, godCleared: cleared,
      paidOther: { at: now, method: how, amountCents: amount, tipCents: 0, by: who, clearedInGod: true, reason: reason || null, fareTotal: fare } };
    var j = function (o) { return { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }; };
    return godFetch(rideUrl(code), j(ridePatch)).then(function (res) {
      if (!res.ok) throw new Error("ride " + res.status);
      return godFetch(baseUrl() + "/rides/" + PAY_HUB + "/" + encodeURIComponent(code) + ".json", j(idxPatch));
    }).then(function (res) {
      if (!res.ok) throw new Error("payments " + res.status);
      var cur = state.payments[code] || {};
      state.payments[code] = Object.assign({}, cur, idxPatch, { meter: Object.assign({}, cur.meter || {}, { status: stV }) });
      setPayNotice(code + ": " + METER_CLEAR_WORD[how] + " (cleared by " + who + ").");
    }).catch(function (err) {
      setPayNotice("Couldn't clear " + code + ": " + ((err && err.message) || "error") + ". Nothing changed; try again.");
    });
  }
  function bindPaymentActions() {
    var root = document.getElementById("payments-list");
    if (!root || root.getAttribute("data-bound") === "1") return;
    root.setAttribute("data-bound", "1");
    Array.prototype.forEach.call(root.querySelectorAll(".meter-clear-apply"), function (btn) { /* v75m */
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-code");
        var sel = root.querySelector('.meter-clear-sel[data-code="' + code + '"]');
        var how = sel ? sel.value : "";
        if (!how) { window.alert("Pick an option first."); return; }
        if (how === "link") { meterClearShowLink(root, code); return; }
        var p = (state.payments || {})[code] || {};
        if (!window.confirm("Clear " + code + " (" + fmtCents((p.meter || {}).fareTotal) + ") as \"" + METER_CLEAR_WORD[how] + "\"? It leaves the unpaid alert and is recorded as cleared by you now.")) return;
        btn.disabled = true;
        meterClearApply(code, how);
      });
    });
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
    eachBtn(".btn-resolve-conflict", function (btn) { /* v75p */
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-ride-code");
        if (!code) return;
        var d = document.querySelector('.conflict-date[data-ride-code="' + code + '"]');
        var tm = document.querySelector('.conflict-time[data-ride-code="' + code + '"]');
        if (!window.confirm("Resolve the time conflict for " + code + (tm && tm.value ? " with pickup " + (d && d.value ? d.value + " " : "") + tm.value : "") + "? Payment will be allowed.")) return;
        btn.disabled = true;
        resolveConflict(code, d && d.value, tm && tm.value).then(function () { btn.disabled = false; refresh(); });
      });
    });
    eachBtn(".btn-send-paypage", function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.getAttribute("data-ride-code");
        state.payPageOpen = state.payPageOpen || {};
        state.payPageOpen[code] = !state.payPageOpen[code];
        refresh();
      });
    });
    eachBtn(".btn-paypage-copy", function (btn) {
      btn.addEventListener("click", function () {
        var u = btn.getAttribute("data-url");
        try { navigator.clipboard.writeText(u).then(function () { btn.textContent = "Copied"; }); } catch (e) { window.prompt("Copy this link", u); }
      });
    });
    eachBtn(".btn-paypage-share", function (btn) {
      btn.addEventListener("click", function () {
        var u = btn.getAttribute("data-url");
        if (navigator.share) navigator.share({ title: "PCS ride payment", url: u }).catch(function () {});
        else window.prompt("Copy this link", u);
      });
    });
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
          '<svg class="pcs-wm" viewBox="0 0 390 96" role="img" aria-label="Private Car Services God mode" style="display:block;width:100%;max-width:420px;height:auto;max-height:120px;border-radius:8px" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="wmg-gl" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="#2c4a2a" stroke-width=".6"/></pattern></defs><rect width="390" height="96" fill="#20371d"/><rect width="390" height="96" fill="url(#wmg-gl)"/><text class="pcs-wm-name" x="28" y="44" text-anchor="start" textLength="334" lengthAdjust="spacingAndGlyphs" font-family="Poppins,Montserrat,Helvetica,Arial,sans-serif" font-style="italic" font-size="21" font-weight="300" fill="#cdeccd">PRIVATE CAR SERVICES</text><path d="M28 54H350" stroke="#cdeccd" stroke-width="3"/><path d="M348 48L362 54L348 60Z" fill="#cdeccd"/><text x="195" y="76" text-anchor="middle" font-family="Poppins,Helvetica,Arial,sans-serif" font-style="italic" font-size="14" letter-spacing="1" fill="#a9c9a9">God mode</text></svg>' + /* v72e wordmark */
          '<h1 style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">PCS God mode</h1>' +
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


  /* v72f: collapsible Scheduled rides board + per-card collapse, remembered in localStorage */
  var DB_COLLAPSE_KEY = "pcs-god-dayboard-collapsed";
  var DB_CARDS_KEY = "pcs-god-daycards-collapsed";
  function dbBoardCollapsed() { try { return localStorage.getItem(DB_COLLAPSE_KEY) === "1"; } catch (e) { return false; } }
  function dbCardSet() { try { var o = JSON.parse(localStorage.getItem(DB_CARDS_KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function dbHeaderHtml(count) {
    var c = dbBoardCollapsed();
    return '<h2 class="day-board-h" style="margin:0;display:flex;align-items:center"><button type="button" id="day-board-toggle" aria-expanded="' + (c ? "false" : "true") + '" aria-controls="day-board-body"' +
      ' style="all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0">' +
      '<span class="db-caret" aria-hidden="true">' + (c ? "\u25B6" : "\u25BC") + "</span>Scheduled rides" +
      ' <span class="badge" id="day-board-count">' + count + "</span></button>" +
      '<button type="button" id="cal-sync-now" title="Pull new rides from your calendar now" style="flex:0 0 auto;margin-left:8px;padding:8px 12px;border-radius:12px;border:2px solid #c9a227;background:#1f2937;color:#fff;font-size:14px;font-weight:800;cursor:pointer;white-space:nowrap">\u27F3 Sync calendar now</button></h2>' +
      '<div id="cal-sync-msg" role="status" style="font-size:13px;opacity:.85;margin:2px 0 4px"></div>';
  }
  /* v75n (Matthew, Oct 14): "Sync calendar now". Asks the Worker (God token) to flag a sync; the calendar routine picks the flag up
     on its next check and copies new calendar rides to the board. Never touches the calendar from the browser. */
  function calSyncNow(btn) {
    var msg = document.getElementById("cal-sync-msg");
    var a = gqAuth();
    if (!a.godPassword && !a.godToken) { if (msg) msg.textContent = "Sign in to God mode first."; return; }
    btn.disabled = true; btn.textContent = "Requesting\u2026";
    workerJson("/cal/sync-request", a).then(function (d) {
      if (d && d.godToken) { gqSetTok(d.godToken); gq.tokOn = true; gq.pw = ""; }
      var last = d && d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      if (msg) msg.textContent = "Sync requested. New rides should appear within a few minutes." + (last ? " Last sync " + last + "." : "");
    }).catch(function (e) {
      if (msg) msg.textContent = "Couldn't request a sync: " + ((e && e.message) || "error");
    }).then(function () { setTimeout(function () { btn.disabled = false; btn.textContent = "\u27F3 Sync calendar now"; }, 30000); });
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest("#cal-sync-now");
    if (!b) return; ev.preventDefault(); ev.stopPropagation(); if (!b.disabled) calSyncNow(b);
  }, true);
  function dbBindOnce() {
    if (window.__pcsDbBound) return;
    window.__pcsDbBound = true;
    try { /* v73: collapsed Scheduled rides = a single ~44px header row, no empty body */
      var st = document.createElement("style"); st.id = "db-collapsed-css";
      st.textContent = ".day-board.db-collapsed{padding:0 14px!important;min-height:0!important;height:auto!important;max-height:none!important;flex:0 0 auto!important;align-self:start!important}" +
        ".day-board.db-collapsed h2{margin:0!important;font-size:20px!important;line-height:1!important}" +
        ".day-board.db-collapsed #day-board-toggle{min-height:44px!important;box-sizing:border-box}" +
        ".day-board.db-collapsed .board-notice,.day-board.db-collapsed #day-board-body{display:none!important}" +
        /* v73 layout: the day board was taking the shell's 1fr row (the "huge empty box"); give it auto height and let the page scroll */
        ".shell{grid-template-rows:auto auto 1fr!important;height:auto!important;min-height:100dvh}" +
        ".day-board.db-collapsed{margin:0 12px 8px!important}" +
        /* iPad / iPhone (one column): sections stack above, the map is at least half the screen; opening a section pushes it down */
        "@media (max-width:860px){.workspace{grid-template-rows:auto minmax(50vh,auto)!important}" +
        ".side{overflow:visible!important;padding:8px 12px 10px!important;border-right:0!important}" +
        ".side h2{margin:0 0 4px!important;font-size:13px!important}.side-section+.side-section{margin-top:8px!important}" +
        "#add-ride-box .fine{display:none}#add-ride-box .btn{min-height:36px!important;padding:6px 12px!important}" +
        "details.driver-card>summary.driver-card-summary{padding-top:3px!important;padding-bottom:3px!important;min-height:0!important}" +
        ".side .card,.side details{margin-top:4px!important;margin-bottom:4px!important}" +
        ".map-pane{min-height:50vh!important;height:50vh}" +
        /* map right under Add ride + Drivers; Riders, queue, payments, miles go below the map */
        ".workspace{display:flex!important;flex-direction:column}.side{display:contents!important}" +
        ".side>.side-section{order:4;padding:0 12px;margin:8px 0 0!important;background:var(--panel)}" +
        ".side>#add-ride-section{order:1}.side>.side-section.drivers-section{order:2}.map-pane{order:3;flex:0 0 auto;margin-top:8px}}" +
        /* legend: small and tucked in the corner so it covers little of the map */
        ".pcs-pill-row{display:inline-flex;gap:6px;align-items:center;margin-left:auto;white-space:nowrap}.pcs-pill-row>.badge{margin-left:0}" + /* v77.15; v77.16 */
        /* v77.16 (Matthew): same size as the Assigned/Open pill (.badge: 10px, 2px 7px, 999px, .06em); button defaults reset; invisible 44px hit area */
        ".pcs-paid-pill{position:relative;font:inherit;font-size:10px;line-height:normal;font-weight:inherit;padding:2px 7px;margin:0;min-height:0;min-width:0;border-radius:999px;letter-spacing:.06em;text-transform:uppercase;vertical-align:middle;cursor:pointer;-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
        ".pcs-paid-pill::after{content:\"\";position:absolute;left:-8px;right:-8px;top:50%;height:44px;transform:translateY(-50%)}" +
        ".pcs-paid-pill.is-paid{background:rgba(46,160,90,0.22);color:#7ee08f;border:1px solid rgba(126,224,143,0.65)}" +
        ".pcs-paid-pill.is-unpaid{background:rgba(240,212,138,0.2);color:#f0d48a;border:1px solid rgba(240,212,138,0.55)}" +
        ".pcs-paid-pill:disabled{opacity:.6}" +
        ".map-hint{max-width:min(240px,calc(100% - 24px))!important;font-size:10.5px!important;padding:4px 7px!important;opacity:.85;left:8px!important;bottom:22px!important}";
      document.head.appendChild(st);
    } catch (e) {}
    document.addEventListener("click", function (ev) { /* v77.23 r1b Texts ON/OFF pill */
      var sb = ev.target && ev.target.closest ? ev.target.closest("[data-sms-phone]") : null;
      if (!sb || sb.disabled) return; ev.preventDefault(); ev.stopPropagation(); smscToggle(sb);
    });
    document.addEventListener("click", function (ev) { /* v77.15 Paid/Unpaid pill */
      var pb = ev.target && ev.target.closest ? ev.target.closest("[data-paid-toggle]") : null;
      if (!pb || pb.disabled) return; ev.preventDefault(); ev.stopPropagation(); paidToggle(pb.getAttribute("data-paid-toggle"), pb);
    });
    document.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("#day-board-toggle,[data-day-card-toggle]") : null;
      if (!t) return;
      ev.preventDefault();
      if (t.id === "day-board-toggle") {
        var c = !dbBoardCollapsed();
        try { localStorage.setItem(DB_COLLAPSE_KEY, c ? "1" : "0"); } catch (e) {}
        var body = document.getElementById("day-board-body");
        if (body) body.style.display = c ? "none" : "";
        var sec = document.getElementById("day-board"); if (sec) sec.classList.toggle("db-collapsed", c); /* v73: compact one-row header when collapsed */
        t.setAttribute("aria-expanded", c ? "false" : "true");
        var car = t.querySelector(".db-caret"); if (car) car.textContent = c ? "\u25B6" : "\u25BC";
        return;
      }
      var id = t.getAttribute("data-day-card-toggle");
      var set = dbCardSet();
      if (set[id]) delete set[id]; else set[id] = 1;
      try { localStorage.setItem(DB_CARDS_KEY, JSON.stringify(set)); } catch (e) {}
      var card = t.closest(".day-card");
      var det = card && card.querySelector(".day-card-body");
      if (det) det.style.display = set[id] ? "none" : "";
      t.setAttribute("aria-expanded", set[id] ? "false" : "true");
      t.textContent = set[id] ? "\u25B6" : "\u25BC";
    });
  }
  window.__pcsGodDayBoard = { collapsed: dbBoardCollapsed, cards: dbCardSet };

  /* v73: Tip (paid in Square), 100% to the driver, never in the commission; editable before and after Complete; edits logged */
  /* v75w (Matthew 10/16): "Paid in Square $" next to the tip = what the client actually paid for the ride (before the tip).
     When it's filled in, the driver's commission (driver %), the pay-week record and the board use it. One Save button
     saves both boxes. Pure helper (tested): */
  var PAID_TAX_RATE = 0.0825; /* same Texas 8.25% as the fare code (METER_TAX_RATE) */
  function paidSquareMath(paidText, tipText, pct, fallbackFareCents) {
    var cents = function (v) { var t = String(v == null ? "" : v).replace(/[$,\s]/g, ""); if (t === "") return null; var n = Number(t); return isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) : NaN; };
    var paid = cents(paidText), tip = cents(tipText);
    if (isNaN(paid)) return { ok: false, error: "Enter the amount paid in Square as a number, like 42.50." };
    if (isNaN(tip)) return { ok: false, error: "Enter the tip as a number, like 5.00." };
    /* Matthew 10/16: the Square amount includes Texas tax; the driver % is on the pre-tax part: pre-tax = paid / (1 + rate) */
    var pre = paid != null ? Math.round(paid / (1 + PAID_TAX_RATE)) : null;
    var base = pre != null ? pre : (Number(fallbackFareCents) || 0);
    return { ok: true, paidCents: paid, tipCents: tip || 0, preTaxCents: pre, taxCents: paid != null ? paid - pre : null, baseCents: base, commissionCents: Math.round(base * (Number(pct) || 0) / 100) };
  }
  function paidSquareLine(paidCents, pct) {
    if (paidCents == null) return "";
    var m = paidSquareMath((paidCents / 100).toFixed(2), "", pct, 0);
    if (pct == null) return "before tax " + fmtCents(m.preTaxCents) + " (assign a driver to see their share)";
    return "before tax " + fmtCents(m.preTaxCents) + ", driver " + (Number(pct) || 0) + "% " + fmtCents(m.commissionCents);
  }
  window.__pcsGodPaidSquare = paidSquareMath; /* test hook */
  /* v76d: Commission % for THIS ride only (e.g. Anson 100% on Barbara Curry's DAL rides). Blank = the driver's own %. */
  function rideCommHtml(r) {
    var p = ridePctOf(r), own = commissionPctFor(r.assignedDriverId);
    return '<div class="db-ridecomm" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0">' +
      '<label for="rcomm-' + esc(r.id) + '">Commission % this ride</label>' +
      '<input id="rcomm-' + esc(r.id) + '" class="db-rcomm-in" data-event-id="' + esc(r.id) + '" type="text" inputmode="decimal" pattern="[0-9]*" placeholder="' + esc(String(own)) + '" value="' + esc(p != null ? String(p) : "") + '" style="width:80px">' +
      '<button type="button" class="btn btn-gold btn-save-rcomm" data-event-id="' + esc(r.id) + '">Save</button>' +
      '<span class="fine">' + (p != null ? esc(r.assignedDriverName || "Driver") + " gets " + p + "% on this ride (usual " + own + "%)" : "Blank = " + esc(r.assignedDriverName || "driver") + "'s usual " + own + "%") + "</span></div>";
  }
  function rideCommPatch(raw, now) { /* pure (tested) */
    var t = String(raw == null ? "" : raw).replace(/[%\s]/g, "");
    if (t === "") return { ok: true, patch: { rideCommissionPct: null, rideCommissionPctEdited: true, rideCommissionPctBy: "god", rideCommissionPctAt: now, updatedAt: now } };
    var n = Number(t);
    if (!isFinite(n) || n < 0 || n > 100 || Math.round(n) !== n) return { ok: false, error: "Enter a whole number from 0 to 100, or leave it blank." };
    return { ok: true, patch: { rideCommissionPct: n, rideCommissionPctEdited: true, rideCommissionPctBy: "god", rideCommissionPctAt: now, updatedAt: now } };
  }
  function saveRideCommission(eventId, raw) {
    var row = null; (state.calendar || []).forEach(function (r) { if (r && r.id === eventId) row = r; });
    if (!row) { state.boardNotice = "NOT SAVED: refresh the board, this ride is not loaded."; renderBoardLists(); return Promise.resolve(false); }
    state.boardNotice = "";
    var out = rideCommPatch(raw, Date.now());
    if (!out.ok) { state.boardNotice = "NOT SAVED: " + out.error; renderBoardLists(); return Promise.resolve(false); }
    return godFetch(calendarUrl(eventId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(out.patch) }).then(function (res) {
      if (!res.ok) throw new Error("save");
      return res.text().then(function (t) { var back = null; try { back = JSON.parse(t); } catch (e) {} if (back && typeof back === "object" && (back.rideCommissionPct == null ? null : Number(back.rideCommissionPct)) !== out.patch.rideCommissionPct) throw new Error("readback"); });
    }).then(function () {
      return atxPost("/god/ridepct/set", { cardId: eventId, pct: out.patch.rideCommissionPct == null ? "" : out.patch.rideCommissionPct }).then(function (d) { /* r4: the pay-trusted copy */
        state.ridePctKV = state.ridePctKV || {}; if (d && d.ok && d.pct != null) state.ridePctKV[eventId] = { pct: d.pct, by: "god", at: Date.now() }; else if (d && d.ok) delete state.ridePctKV[eventId];
      });
    }).then(function () {
      row.rideCommissionPct = out.patch.rideCommissionPct;
      state.boardNotice = "Saved: " + (row.assignedDriverName || "driver") + " gets " + ridePctFor(row) + "% on " + (row.rider || "this ride") + ".";
      return refresh();
    }).catch(function (err) { /* v77.7: keep the real reason (God sign-in needed, server error) instead of a bare "try again" */
      var why = rideCommFailText(state.boardNotice, err);
      state.boardNotice = "NOT SAVED: the ride commission % did not save" + (why ? " (" + why + ")" : "") + ". Try again."; renderBoardLists(); return false; });
  }
  function rideCommFailText(prev, err) { /* pure (tested) */
    var p = String(prev || "");
    if (/^not saved: /i.test(p)) return p.replace(/^not saved: /i, "").replace(/\.$/, "");
    if (err && err.message === "readback") return "the server kept a different value";
    if (err && err.message === "missing") return "refresh the board";
    return "";
  }
  window.__pcsV777RideComm = { fail: rideCommFailText };
  window.__pcsV76dRideComm = { patch: rideCommPatch };
  /* ---------- v76j (Matthew 10/19): RATE OVERRIDE / contract rates. God mode only.
     Per ride: rateOverride { base, perMile, flat, setBy, at } on the board row (flat wins). Per customer: saved list at
     /rides/RATECNTR (God-only by the rides/$code rule), auto-applied to a ride for that customer unless the ride has its own
     override or Matthew cleared it (rateOverrideCleared). The driver app / meter lock the fare and show "Contract rate set by PCS". */
  var RATE_PRESETS = [{ id: "corp-airport", name: "Corporate airport", base: 20, perMile: 1.25, flat: null }];
  function rovNum(v) { var t = String(v == null ? "" : v).replace(/[$,\s]/g, ""); if (t === "") return null; var n = Number(t); return isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : NaN; }
  function rateOvPatch(base, perMile, flat, now, setBy, extra) { /* pure (tested) */
    var b = rovNum(base), m = rovNum(perMile), f = rovNum(flat);
    if ([b, m, f].some(function (x) { return x !== null && isNaN(x); })) return { ok: false, error: "Enter dollar amounts (like 20 or 1.25)." };
    if (!(f > 0) && !(b > 0) && !(m > 0)) return { ok: false, error: "Enter a flat fare, or a base and/or per-mile price." };
    var o = Object.assign({ base: b || 0, perMile: m || 0, flat: f > 0 ? f : null, setBy: setBy || "god", at: now }, extra || {});
    return { ok: true, patch: { rateOverride: o, rateOverrideCleared: false, updatedAt: now } };
  }
  function rateOvClearPatch(now) { return { rateOverride: null, rateOverrideCleared: true, updatedAt: now }; }
  function rovDigits(v) { return String(v || "").replace(/\D/g, "").slice(-10); }
  function contractMatch(row, list) { /* pure (tested): phone (last 10 digits), then email, then exact name */
    var ph = rovDigits(row && row.riderPhone), em = String((row && (row.riderEmail || row.email)) || "").trim().toLowerCase(), nm = String((row && row.rider) || "").trim().toLowerCase();
    var L = (list || []).filter(function (c) { return c && c.on !== false; }), hit = null;
    if (ph.length === 10) hit = L.filter(function (c) { return rovDigits(c.phone) === ph; })[0];
    if (!hit && em) hit = L.filter(function (c) { return String(c.email || "").trim().toLowerCase() === em; })[0];
    if (!hit && nm) hit = L.filter(function (c) { return String(c.name || "").trim().toLowerCase() === nm; })[0];
    return hit || null;
  }
  function rateOvAutoPatch(row, list, now) { /* pure (tested): null when nothing to do */
    if (!row || row.rateOverride || row.rateOverrideCleared === true) return null;
    var st = String(row.status || "").toLowerCase(); if (st === "completed" || st === "cancelled" || st === "deleted") return null;
    var c = contractMatch(row, list); if (!c) return null;
    var out = rateOvPatch(c.base, c.perMile, c.flat, now, "contract", { contractRateId: String(c.id || ""), contractName: String(c.name || "") });
    return out.ok ? out.patch : null;
  }
  function rateContractsUrl(id) { return baseUrl() + "/rides/RATECNTR" + (id ? "/" + encodeURIComponent(id) : "") + ".json"; }
  function listRateContracts() { return godFetch(rateContractsUrl(), {}).then(function (res) { if (!res.ok) throw new Error("contracts"); return res.json(); })
    .then(function (d) { return Object.keys(d || {}).filter(function (k) { return d[k] && typeof d[k] === "object"; }).map(function (k) { return Object.assign({ id: k }, d[k]); }); }); }
  function rovFix(n) { return n > 0 ? Number(n).toFixed(2) : ""; }
  function rovMoney(n) { return n == null || n === "" ? "" : "$" + Number(n).toFixed(2); }
  function rovDesc(o) { return o.flat > 0 ? "flat " + rovMoney(o.flat) : rovMoney(o.base || 0) + " base + " + rovMoney(o.perMile || 0) + "/mi"; }
  function rovPresetOptions() {
    return '<option value="">Preset…</option>' + RATE_PRESETS.map(function (p) { return '<option value="p:' + esc(p.id) + '">' + esc(p.name) + " (" + esc(rovDesc(p)) + ")</option>"; }).join("") +
      (state.rateContracts || []).map(function (c) { return '<option value="c:' + esc(c.id) + '">' + esc(c.name || "Contract") + " (" + esc(rovDesc(c)) + ")</option>"; }).join("");
  }
  function rovPresetFind(v) { v = String(v || ""); if (v.indexOf("p:") === 0) return RATE_PRESETS.filter(function (p) { return p.id === v.slice(2); })[0] || null;
    if (v.indexOf("c:") === 0) return (state.rateContracts || []).filter(function (c) { return c.id === v.slice(2); })[0] || null; return null; }
  function rateOvHtml(r) {
    var o = r.rateOverride || null, id = esc(r.id), big = ' style="width:90px;font-size:18px;min-height:44px"';
    return '<div class="db-rov" style="border:2px solid #0b6b3a;background:#0b3d23;border-radius:10px;padding:8px;margin:6px 0">' +
      '<div style="font-weight:800;margin-bottom:4px">Rate override (God mode only)' + (o ? ' \u2713 <span class="fine">' + esc(rovDesc(o)) + (o.setBy === "contract" ? " \u00b7 contract " + esc(o.contractName || "") : "") + "</span>" : "") + "</div>" +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:end">' +
      '<select class="rov-preset" data-event-id="' + id + '" style="min-height:44px">' + rovPresetOptions() + "</select>" +
      '<label>Base / drop-off $<br><input id="rov-b-' + id + '" inputmode="decimal" data-money-reg="1" value="' + esc(o && o.base ? Number(o.base).toFixed(2) : "") + '"' + big + "></label>" +
      '<label>Per mile $<br><input id="rov-m-' + id + '" inputmode="decimal" data-money-reg="1" value="' + esc(o && o.perMile ? Number(o.perMile).toFixed(2) : "") + '"' + big + "></label>" +
      '<label>Flat fare $ (wins)<br><input id="rov-f-' + id + '" inputmode="decimal" data-money-reg="1" value="' + esc(o && o.flat ? Number(o.flat).toFixed(2) : "") + '"' + big + "></label>" +
      '<button type="button" class="btn btn-gold btn-rov-save" data-event-id="' + id + '" style="min-height:44px">Save rate</button>' +
      (o ? '<button type="button" class="btn btn-ghost btn-rov-clear" data-event-id="' + id + '" style="min-height:44px">Clear</button>' : "") +
      "</div></div>";
  }
  function rovRow(id) { var row = null; (state.calendar || []).forEach(function (r) { if (r && r.id === id) row = r; }); return row; }
  function rovSave(id, patch, msg) {
    var row = rovRow(id); if (!row) return Promise.resolve(false);
    return godFetch(calendarUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("save"); row.rateOverride = patch.rateOverride; row.rateOverrideCleared = patch.rateOverrideCleared;
      if (msg) state.boardNotice = msg; return refresh();
    }).catch(function () { state.boardNotice = "NOT SAVED: the rate override did not save. Try again."; renderBoardLists(); return false; });
  }
  function rateContractsHtml() {
    var L = state.rateContracts || [], big = ' style="font-size:17px;min-height:44px;width:100%"';
    return '<details class="rate-contracts" style="margin:6px 0;border:2px solid #0b6b3a;border-radius:10px;padding:6px 8px"' + (state.rcOpen ? " open" : "") + '><summary style="cursor:pointer;font-weight:800">Contract rates (God mode only) (' + L.length + ")</summary>" +
      '<p class="fine">Auto-applied to rides for these customers (match by phone, email, or exact name). A ride\u2019s own override wins.</p>' +
      L.map(function (c) { return '<div class="card" style="padding:6px 8px;margin:4px 0"><b>' + esc(c.name || "") + "</b> \u00b7 " + esc(rovDesc(c)) + '<br><span class="fine">' + esc([c.phone, c.email].filter(Boolean).join(" \u00b7 ")) +
        '</span> <button type="button" class="btn btn-ghost rc-del" data-rc-id="' + esc(c.id) + '">Delete</button></div>'; }).join("") +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      '<input id="rc-name" placeholder="Customer name"' + big + '><input id="rc-phone" type="tel" placeholder="Phone"' + big + ">" +
      '<input id="rc-email" type="email" placeholder="Email"' + big + '><select id="rc-preset"' + big + ">" + rovPresetOptions() + "</select>" +
      '<input id="rc-base" inputmode="decimal" data-money-reg="1" placeholder="Base / drop-off $"' + big + '><input id="rc-per" inputmode="decimal" data-money-reg="1" placeholder="Per mile $"' + big + ">" +
      '<input id="rc-flat" inputmode="decimal" data-money-reg="1" placeholder="Flat fare $ (optional)"' + big + '><button type="button" class="btn btn-gold" id="rc-save" style="min-height:44px">Save contract</button></div>' +
      '<p class="error" id="rc-err" role="alert">' + esc(state.rcErr || "") + "</p></details>";
  }
  function rovWire() {
    if (rovWire.done || typeof document === "undefined") return; rovWire.done = true;
    function v(id) { var el = document.getElementById(id); return el ? el.value : ""; }
    function setV(id, x) { var el = document.getElementById(id); if (el) el.value = x == null ? "" : String(x); }
    document.addEventListener("change", function (e) {
      var t = e.target; if (!t) return;
      if (t.classList && t.classList.contains("rov-preset")) { var p = rovPresetFind(t.value), id = t.getAttribute("data-event-id"); if (p) { setV("rov-b-" + id, rovFix(p.base)); setV("rov-m-" + id, rovFix(p.perMile)); setV("rov-f-" + id, rovFix(p.flat)); } }
      if (t.id === "rc-preset") { var q = rovPresetFind(t.value); if (q) { setV("rc-base", rovFix(q.base)); setV("rc-per", rovFix(q.perMile)); setV("rc-flat", rovFix(q.flat)); } }
      if (t.id === "ar-ovPreset") { var a = rovPresetFind(t.value); if (a) { ["ovBase", "ovPerMile", "ovFlat"].forEach(function (k, i) { var val = rovFix([a.base, a.perMile, a.flat][i]); setV("ar-" + k, val); state.addRideDraft = state.addRideDraft || {}; state.addRideDraft[k] = String(val); }); } }
    }, true);
    document.addEventListener("toggle", function (e) { if (e.target && e.target.classList && e.target.classList.contains("rate-contracts")) state.rcOpen = e.target.open; }, true);
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(".btn-rov-save,.btn-rov-clear,#rc-save,.rc-del") : null; if (!t) return;
      var id = t.getAttribute("data-event-id");
      if (t.classList.contains("btn-rov-save")) { var out = rateOvPatch(v("rov-b-" + id), v("rov-m-" + id), v("rov-f-" + id), Date.now(), "god");
        if (!out.ok) { state.boardNotice = "NOT SAVED: " + out.error; renderBoardLists(); return; } t.disabled = true; rovSave(id, out.patch, "Saved: contract rate " + rovDesc(out.patch.rateOverride) + " on this ride."); return; }
      if (t.classList.contains("btn-rov-clear")) { t.disabled = true; rovSave(id, rateOvClearPatch(Date.now()), "Rate override cleared; the regular meter rate applies."); return; }
      if (t.id === "rc-save") { var o = rateOvPatch(v("rc-base"), v("rc-per"), v("rc-flat"), Date.now(), "contract"), nm = v("rc-name").trim();
        state.rcErr = !nm ? "Enter the customer name." : !o.ok ? o.error : ""; if (state.rcErr) { renderBoardLists(); return; }
        var rec = { name: nm.slice(0, 120), phone: v("rc-phone").trim().slice(0, 40), email: v("rc-email").trim().toLowerCase().slice(0, 120), base: o.patch.rateOverride.base, perMile: o.patch.rateOverride.perMile, flat: o.patch.rateOverride.flat, on: true, at: Date.now() };
        var key = "c" + Date.now().toString(36); t.disabled = true;
        godFetch(rateContractsUrl(key), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) }).then(function (res) { if (!res.ok) throw new Error(); state.rcOpen = true; return refresh(); })
          .catch(function () { state.rcErr = "NOT SAVED: try again."; renderBoardLists(); }); return; }
      if (t.classList.contains("rc-del")) { if (typeof confirm === "function" && !confirm("Delete this contract rate? Rides that already have it keep it.")) return;
        godFetch(rateContractsUrl(t.getAttribute("data-rc-id")), { method: "DELETE" }).then(function () { return refresh(); }); }
    }, true);
  }
  function rovAutoApply() {
    var L = state.rateContracts || []; if (!L.length) return; state.rovAutoDone = state.rovAutoDone || {};
    (state.calendar || []).forEach(function (row) { var p = rateOvAutoPatch(row, L, Date.now()); if (!p || state.rovAutoDone[row.id]) return; state.rovAutoDone[row.id] = 1;
      godFetch(calendarUrl(row.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).then(function (res) { if (res.ok) { row.rateOverride = p.rateOverride; row.rateOverrideCleared = false; renderBoardLists(); } }).catch(function () {}); });
  }
  if (typeof window !== "undefined") window.__pcsGodRateOv = { patch: rateOvPatch, clear: rateOvClearPatch, match: contractMatch, auto: rateOvAutoPatch, presets: RATE_PRESETS, html: rateOvHtml };
  /* ---------- v77.3 (Matthew 10/20): CLIENT PHONE + AUTO "ON THE WAY" TEXT (God mode) ----------
     Client phone on any board row: saved as riderPhone (+ riderPhoneEdited, so the calendar sync never overwrites it).
     Per-ride "Auto text" switch: autoText false = this client is never auto-texted. Master switch + "Texts sent" log go through
     the pcs-pay Worker (/god/autotext, /god/smslog). Texts go out from the one PCS texting number (Twilio), never from 7878. */
  function cphNorm(raw) { /* pure (tested): US phone -> +1XXXXXXXXXX, "" = cleared, null = bad */
    var t = String(raw == null ? "" : raw).trim(); if (!t) return "";
    var d = t.replace(/\D/g, ""); if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d.length === 10 && /^[2-9]/.test(d) ? "+1" + d : null;
  }
  function cphShow(e) { var d = String(e || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6) : String(e || ""); } /* v77.12: 936-206-8840 */
  /* v77.12 (Matthew 10/20): typed phone boxes keep their digits across the 5 s board rebuild (state.phDrafts, keyed by box id),
     and a big green 0-9 keypad (iPad Safari has no web number pad: inputmode only gives the numbers/symbols keyboard). */
  function phDraftVal(boxId, saved) { var d = state.phDrafts && Object.prototype.hasOwnProperty.call(state.phDrafts, boxId) ? state.phDrafts[boxId] : null; return d != null ? d : saved; } /* pure-ish (tested) */
  function phPadKey(cur, key) { /* pure (tested): keypad -> 936-206-8840 as you type, max 10 digits */
    var d = String(cur || "").replace(/\D/g, ""); if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    if (key === "back") d = d.slice(0, -1); else if (key === "clear") d = ""; else if (/^[0-9]$/.test(key) && d.length < 10 && !(d === "" && (key === "0" || key === "1"))) d += key; /* US area codes never start with 0/1 */
    return d.length > 6 ? d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6) : d.length > 3 ? d.slice(0, 3) + "-" + d.slice(3) : d;
  }
  function phPadHtml(boxId) {
    var open = state.phPad === boxId, b = 'style="font-size:26px;font-weight:800;min-width:64px;min-height:56px;border-radius:12px;background:#2e7d32;color:#fff;border:0;margin:3px"';
    var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];
    return '<button type="button" class="btn btn-ghost btn-ph-pad" data-box="' + esc(boxId) + '" style="min-height:44px">' + (open ? "Hide keypad" : "Keypad 0-9") + "</button>" +
      (open ? '<div class="ph-pad" style="display:grid;grid-template-columns:repeat(3,72px);margin-top:4px">' + keys.map(function (k) {
        return '<button type="button" class="ph-pad-key" data-box="' + esc(boxId) + '" data-key="' + k + '" ' + b + ">" + (k === "back" ? "\u232b" : k === "clear" ? "C" : k) + "</button>"; }).join("") + "</div>" : "");
  }
  function phAttrs() { return ' type="tel" inputmode="numeric" pattern="[0-9]*" autocomplete="tel" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="14" '; }
  function clientPhonePatch(raw, now, by) { /* pure (tested) */
    var p = cphNorm(raw);
    if (p === null) return { ok: false, error: "Enter a 10-digit US phone, like 936-555-1212." };
    return { ok: true, patch: { riderPhone: p, riderPhoneEdited: true, riderPhoneBy: by || "god", riderPhoneAt: now, riderPhoneSrc: "god", updatedAt: now } };
  }
  /* v77.5 (Matthew 10/20): Teen rider + teen's phone (saved on the ride, survives the calendar sync like riderPhone) and a
     one-time Additional number (extraPhoneOnce: this ride's texts only, never saved to the client or the calendar;
     the Worker drops it when the ride is completed or cancelled). Inputs use the full letter keyboard (Matthew 10/20). */
  function teenPatch(on, raw, now, by) { /* pure (tested) */
    if (on !== true) return { ok: true, patch: { teenRider: false, teenRiderBy: by || "god", teenRiderAt: now, updatedAt: now } };
    var p = cphNorm(raw);
    if (!p) return { ok: false, error: "Enter the teen\u2019s 10-digit US phone, like 936-555-1212." };
    return { ok: true, patch: { teenRider: true, teenPhone: p, teenRiderBy: by || "god", teenRiderAt: now, updatedAt: now } };
  }
  function extraPhonePatch(raw, now) { /* pure (tested): "" clears it (null = Firebase delete) */
    var p = cphNorm(raw);
    if (p === null) return { ok: false, error: "Enter a 10-digit US phone, like 936-555-1212." };
    return { ok: true, patch: { extraPhoneOnce: p || null, updatedAt: now } };
  }
  /* ---------- v77.10 (Matthew 10/20): CLIENT PHONE DIRECTORY ----------
     A phone saved on a card or an Add ride is also saved for that client (Worker KV via /god/clients/put, never the open
     Firebase). Future rides: the calendar sync fills a card that has none (Worker v77.10), Add ride fills the phone box when
     the name matches, and a card without a phone shows the saved number ready to save. A phone already on a card is never
     replaced. Same name rule as the Worker (clientNameOf / clientKey are identical; tested). */
  function clientNameOf(raw) { /* pure (tested) */
    var s = String(raw == null ? "" : raw); try { s = s.normalize("NFKD"); } catch (e) {}
    s = s.replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019\u02bc`]/g, "'").trim();
    s = s.replace(/^pcs\b[\s\u2013\u2014\-:|]*/i, "").trim();
    if (/'s\b/i.test(s)) return "";
    var m = /^(?:pick(?:\s*-?\s*up)?|drop(?:\s*-?\s*off)?|ride\s+for)\s+(.+)$/i.exec(s); if (m) s = m[1];
    s = s.replace(/\s+(?:up|for|from|to|at|@|-|\u2013|\u2014)(?:\s.*)?$/i, "");
    s = s.replace(/\s*&\s*(?:his|her|their)\b.*$/i, "").replace(/\s*\(.*$/, "").trim();
    return s;
  }
  function clientKey(raw) { /* pure (tested) */
    var n = clientNameOf(raw).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!n || !/[a-z]/.test(n)) return "";
    return n.split(" ").join("_").slice(0, 80);
  }
  /* v77.21 (Matthew 10/21 "first AND last name always"): the client's FULL name for a card, in this order:
     1) the Square invoice customer on the card (sqInvoice.customer), 2) the pickup contact ("Vincent Anzelone PTS's Home, ..."),
     3) a "Name:" / "Client:" line in the notes, 4) the title only when it already holds a first and last name.
     A short title name alone ("Pick up Vincent") never names a client. Pure (tested); same code in God mode and the Worker. */
  function clientFull(s) { /* pure: "First Last" (2+ words, letters) or "" */
    var n = String(s == null ? "" : s).replace(/[\u2018\u2019\u02bc`]/g, "'").replace(/\s+/g, " ").trim();
    if (!/^[A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f.'-]*(?: [A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f.'-]*){1,3}$/.test(n)) return "";
    return n;
  }
  function clientFullName(row) { /* pure (tested) */
    if (!row || typeof row !== "object") return clientFull(clientNameOf(row));
    var sq = row.sqInvoice && typeof row.sqInvoice === "object" ? row.sqInvoice : {};
    var a = clientFull(sq.customer); if (a) return a;
    var pm = /^\s*([^,]+?)\s+(?:PTS|PCS)?\s*['\u2018\u2019]s\s+(?:home|house|work|office)\b/i.exec(String(row.pickup || "").replace(/\u2019/g, "'"));
    if (!pm) pm = /^\s*([^,]+?)\s+(?:PTS|PCS)['\u2018\u2019]s\b/i.exec(String(row.pickup || ""));
    a = pm ? clientFull(pm[1].replace(/\s+(?:PTS|PCS)$/i, "")) : ""; if (a) return a;
    var nm = /(?:^|\n)\s*(?:name|client|rider|passenger)\s*:\s*([^\n]+)/i.exec(String(row.description || row.notes || ""));
    a = nm ? clientFull(nm[1]) : ""; if (a) return a;
    return clientFull(clientNameOf(row.rider || row.title));
  }
  function clientRowKeys(row) { /* pure (tested): [full-name key, short title key (alias)] without repeats */
    var out = [], add = function (k) { if (k && out.indexOf(k) < 0) out.push(k); };
    add(clientKey(clientFullName(row)));
    if (row && typeof row === "object") add(clientKey(row.rider || row.title)); else add(clientKey(row));
    return out;
  }
  function clientDirFind(dir, keys) { /* pure (tested): entry by key, else an entry that lists the key as an alias (old short entries) */
    if (!dir || typeof dir !== "object") return null;
    var has = function (k) { return Object.prototype.hasOwnProperty.call(dir, k); }, i, k;
    for (i = 0; i < keys.length; i++) if (has(keys[i]) && dir[keys[i]]) return { key: keys[i], c: dir[keys[i]] };
    for (i = 0; i < keys.length; i++) { /* v77.21 r2 (Harry M2): an alias two entries share is ambiguous -> no match (no auto phone) */
      var hits = [];
      for (k in dir) if (has(k) && dir[k] && Array.isArray(dir[k].aliases) && dir[k].aliases.indexOf(keys[i]) >= 0) hits.push(k);
      if (hits.length === 1) return { key: hits[0], c: dir[hits[0]] };
      if (hits.length > 1) return null;
    }
    return null;
  }
  /* pure (tested): God-mode load migration. A one-word entry ("vincent") whose cards all give ONE full name starting with that
     same first name ("Vincent Anzelone") is renamed; the old key stays as an alias so its phone keeps matching. "Ted" vs a
     "Teddy Payz" pickup is not the same first name, so it is left for Matthew. */
  function clientMigrations(dir, rows) {
    var out = [];
    var CONFIRMED = { ted: "Teddy Payz" }; /* v77.21 delta (Matthew 10/21): short entries whose full name Matthew confirmed */
    Object.keys(dir || {}).forEach(function (k) {
      var c = dir[k] || {}; if (k.indexOf("_") >= 0) return;
      var fulls = {};
      (rows || []).forEach(function (r) {
        if (!r || clientKey(r.rider || r.title) !== k) return;
        var f = clientFullName(r), fk = clientKey(f);
        if (fk && fk !== k && fk.split("_")[0] === k) fulls[fk] = f;
      });
      if (Object.prototype.hasOwnProperty.call(CONFIRMED, k)) { fulls = {}; fulls[clientKey(CONFIRMED[k])] = CONFIRMED[k]; } /* Matthew confirmed */
      var fk = Object.keys(fulls); if (fk.length !== 1 || (dir && Object.prototype.hasOwnProperty.call(dir, fk[0]))) return;
      out.push({ name: fulls[fk[0]], phone: c.phone, src: c.src || "god", renameFrom: k });
    });
    return out.slice(0, 50);
  }
  /* pure (tested): saved number for this name: the directory first, then an app booking (rider account) with the same name */
  function clientPhoneFor(name, dir, appRides) { /* v77.21: name may be a card (full name first, short title key as alias) */
    var keys = clientRowKeys(name); if (!keys.length) return null;
    var f = clientDirFind(dir, keys), c = f && f.c; if (c && cphNorm(c.phone)) return { phone: cphNorm(c.phone), src: "saved" };
    var hit = null;
    (appRides || []).forEach(function (r) { if (!hit && r && keys.indexOf(clientKey(r.name || r.riderName)) >= 0 && cphNorm(r.phone)) hit = cphNorm(r.phone); });
    return hit ? { phone: hit, src: "app" } : null;
  }
  /* pure (tested): God-typed card phones the directory doesn't have yet (newest per client); never replaces a saved number */
  function clientSeedItems(rows, dir) {
    var best = {};
    (rows || []).forEach(function (r) {
      if (!r || r.riderPhoneEdited !== true || r.riderPhoneSrc !== "god") return;
      var full = clientFullName(r), p = cphNorm(r.riderPhone), k = clientKey(full); if (!p || !k || clientDirFind(dir, clientRowKeys(r))) return; /* v77.21: full name only */
      var al = clientKey(r.rider || r.title), at = Number(r.riderPhoneAt) || 0;
      if (!best[k] || at > best[k].at) best[k] = { name: full, phone: p, at: at, alias: al && al !== k ? al : "" };
    });
    return Object.keys(best).slice(0, 50).map(function (k) { var it = { name: best[k].name, phone: best[k].phone, src: "card", onlyIfMissing: true }; if (best[k].alias) it.alias = best[k].alias; return it; });
  }
  function clientWorkerOk(v) { /* pure (tested): Worker understands renameFrom / alias (v77.21+) */
    var m = /^v?(\d+)\.(\d+)/.exec(String(v || "")); if (!m) return false;
    var a = Number(m[1]), b = Number(m[2]); return (a >= 2 && a < 70) || a > 77 || (a === 77 && b >= 21); /* v2.0a: the v2.x line follows v77.25 */
  }
  function clientsLoad() {
    state.clients = state.clients || {};
    return atxPost("/god/clients/list", {}).then(function (d) {
      state.clients = d.clients || {}; state.clientsErr = "";
      if (!state.clientsSeeded) { state.clientsSeeded = true; var items = (clientWorkerOk(d.version) ? clientMigrations(state.clients, state.calendar) : []).concat(clientSeedItems(state.calendar, state.clients)).slice(0, 50); /* v77.21; r2 (Harry L1): migrations only to a v77.21+ Worker */
        if (items.length) return atxPost("/god/clients/put", { items: items }).then(function (d2) { state.clients = d2.clients || state.clients; }).catch(function () {}); }
    }).catch(function (e) { state.clientsErr = String(e && e.message || e); }).then(function () { renderBoardLists(); return smscLoad(); }); /* v77.23 r1b */
  }
  function clientRemember(name, phone) { /* after a phone is saved on a card / Add ride; v77.21: name may be the card */
    var full = clientFullName(name), p = cphNorm(phone), al = typeof name === "object" ? clientKey(name.rider || name.title) : "";
    if (p && !clientKey(full)) { state.boardNotice = "Phone saved on this ride only. Client phones needs the client's first and last name."; return Promise.resolve(); } /* r2 (Harry L4) */
    if (!p) return Promise.resolve(); /* never a short title name alone */
    var it = { name: full, phone: p, src: "god" }; if (al && al !== clientKey(full)) it.alias = al;
    return atxPost("/god/clients/put", it).then(function (d) { state.clients = d.clients || state.clients; }).catch(function () {});
  }
  function clientsPanelHtml() {
    var dir = state.clients || {}, keys = Object.keys(dir).sort(), big = ' style="font-size:18px;min-height:44px;width:200px"';
    return '<details class="clients-panel" style="margin:6px 0;border:2px solid #0b6b3a;border-radius:10px;padding:6px 8px"' + (state.clOpen ? " open" : "") + '><summary style="cursor:pointer;font-weight:800">Client phones (' + keys.length + ")</summary>" +
      '<p class="fine">Saved once, used on every future ride for that client. A phone already on a ride is never replaced.</p>' +
      (state.clientsErr ? '<p class="error" role="alert">' + esc(state.clientsErr) + "</p>" : "") +
      keys.map(function (k) { var c = dir[k] || {};
        var cp = typeof smscPillHtml === "function" ? cphNorm(c.phone) : ""; /* v77.23 r1b */
        return '<div class="card" style="padding:6px 8px;margin:4px 0"><b>' + esc(c.name || k) + '</b> ' + (cp ? smscPillHtml(cp, c.name || k) : "") + ' <span class="fine">' + esc(c.src === "card" ? "from a ride" : "saved in God mode") + "</span>" + (cp ? '<br><span class="fine">' + esc(smscWhy(state.smsc && state.smsc[cp])) + "</span>" : "") + "<br>" +
          '<input id="cl-' + esc(k) + '" type="tel" inputmode="tel" autocomplete="off" value="' + esc(cphShow(c.phone)) + '"' + big + "> " +
          '<button type="button" class="btn btn-gold btn-cl-save" data-cl-key="' + esc(k) + '" data-cl-name="' + esc(c.name || k) + '" style="min-height:44px">Save</button> ' +
          '<button type="button" class="btn btn-cl-del" data-cl-key="' + esc(k) + '" data-cl-name="' + esc(c.name || k) + '" style="min-height:44px">Remove</button></div>';
      }).join("") +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><input id="cl-new-name" placeholder="First and last name"' + big + '><input id="cl-new-phone" type="tel" inputmode="tel" placeholder="936-555-1212"' + big + '><button type="button" class="btn btn-gold btn-cl-add" style="min-height:44px">Add client</button></div></details>';
  }
  function clientsWire() {
    if (clientsWire.done || typeof document === "undefined") return; clientsWire.done = true;
    document.addEventListener("toggle", function (e) { if (e.target && e.target.classList && e.target.classList.contains("clients-panel")) state.clOpen = e.target.open; }, true);
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(".btn-cl-save,.btn-cl-del,.btn-cl-add") : null; if (!t) return;
      var name, phone;
      if (t.classList.contains("btn-cl-add")) { name = (document.getElementById("cl-new-name") || {}).value || ""; phone = (document.getElementById("cl-new-phone") || {}).value || ""; if (!clientFull(name)) { state.clientsErr = "Enter the client's first and last name."; renderBoardLists(); return; } }
      else { name = t.getAttribute("data-cl-name"); phone = t.classList.contains("btn-cl-del") ? "" : ((document.getElementById("cl-" + t.getAttribute("data-cl-key")) || {}).value || ""); }
      if (phone && cphNorm(phone) === null) { state.clientsErr = "Enter a 10-digit US phone, like 936-555-1212."; renderBoardLists(); return; }
      atxPost("/god/clients/put", { name: name, phone: phone ? cphNorm(phone) : "", src: "god" }).then(function (d) { state.clients = d.clients || {}; state.clientsErr = ""; state.boardNotice = phone ? "Saved " + clientNameOf(name) + "'s phone for future rides." : "Removed " + clientNameOf(name) + " from Client phones."; })
        .catch(function (er) { state.clientsErr = String(er && er.message || er); }).then(function () { renderBoardLists(); });
    });
  }
  /* v77.23 r1b (Matthew 10/21): "Client agreed to texts" switch. The Worker's per-phone record is the truth; never stored on rides,
     so calendar sync can't overwrite it. Same size as the Assigned pill. Never overrides an SMS STOP. */
  function smscPhoneOf(r) { var p = cphNorm(r && r.riderPhone); if (p) return p; var f = r ? clientPhoneFor(r, state.clients, state.rides) : null; return f && f.phone ? f.phone : ""; }
  function smscAsk(name) { return "Did " + String(name || "this client").replace(/\?/g, "").slice(0, 80) + " agree to receive ride update texts from Private Car Services? (Reply STOP to opt out, HELP for help, msg & data rates may apply)"; } /* pure (tested) */
  function smscWhen(ms) { try { return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", year: "numeric" }); } catch (e) { return ""; } }
  function smscWhy(v) { /* pure (tested): consent view line */
    if (!v) return "Texts: checking\u2026";
    if (v.optIn) return "Texts ON: " + (v.source === "god_verbal" ? (v.how === "written" ? "agreed in writing" : "agreed by phone") + ", recorded by " + (v.by || "God mode") : v.source === "sms-start" ? "client texted START" : "checked the box (" + (v.source || "web") + ")") + (v.at ? " on " + smscWhen(v.at) : "") + ".";
    return "Texts OFF: " + (v.why || "No consent on file.");
  }
  function smscPillHtml(phone, name) {
    if (!phone) return "";
    var v = state.smsc && state.smsc[phone], on = !!(v && v.optIn);
    return '<button type="button" class="badge pcs-paid-pill pcs-sms-pill ' + (on ? "is-paid" : "is-unpaid") + '" data-sms-phone="' + esc(phone) + '" data-sms-name="' + esc(name || "") + '" aria-pressed="' + (on ? "true" : "false") + '" title="' + esc(smscWhy(v)) + '" aria-label="' + esc(smscWhy(v)) + ' Tap to change.">' + (on ? "TEXTS ON" : "TEXTS OFF") + "</button>";
  }
  function smscLoad() {
    var ph = {};
    (state.calendar || []).forEach(function (r) { var p = smscPhoneOf(r); if (p) ph[p] = 1; });
    Object.keys(state.clients || {}).forEach(function (k) { var p = cphNorm((state.clients[k] || {}).phone); if (p) ph[p] = 1; });
    var list = Object.keys(ph); if (!list.length) return Promise.resolve();
    return atxPost("/god/sms/consent/list", { phones: list.slice(0, 300) }).then(function (d) { state.smsc = Object.assign(state.smsc || {}, d.consent || {}); renderBoardLists(); }).catch(function () {});
  }
  function smscToggle(btn) {
    var phone = btn.getAttribute("data-sms-phone"), name = btn.getAttribute("data-sms-name") || "this client", v = state.smsc && state.smsc[phone];
    var on = !(v && v.optIn), body;
    if (on) {
      if (v && v.stop) { window.alert(name + " texted STOP. Only the client can turn texts back on by texting START to (936) 236-4050."); return; }
      var ask = smscAsk(name); if (!window.confirm(ask)) return;
      var written = window.confirm("How did " + name + " agree?\nOK = in writing (text or email)\nCancel = by phone (verbal)");
      body = { phone: phone, optIn: true, how: written ? "written" : "verbal", by: godWho(), text: ask, name: name };
    } else {
      if (!window.confirm("Turn ride update texts OFF for " + name + "?")) return;
      body = { phone: phone, optIn: false, how: "verbal", by: godWho(), name: name };
    }
    btn.disabled = true;
    atxPost("/god/sms/consent/set", body).then(function (d) { state.smsc = state.smsc || {}; state.smsc[phone] = d.consent; state.boardNotice = smscWhy(d.consent).replace(/^Texts/, name + ": texts"); })
      .catch(function (e) { state.boardNotice = String(e && e.message || e); }).then(function () { renderBoardLists(); });
  }
  function autoTextPatch(on, now) { return { autoText: on !== false, updatedAt: now }; } /* pure (tested) */
  function cphHtml(r) {
    var id = esc(r.id), on = r.autoText !== false, big = ' style="font-size:18px;min-height:44px;width:220px"';
    var cphSaved = r.riderPhone ? null : clientPhoneFor(r, state.clients, state.rides); /* v77.10; v77.21 card */
    return cashBoxHtml(r) + godDiscHtml(r) + /* v77.10 */ '<div class="db-cph" style="border:2px solid #0b6b3a;background:#0b3d23;border-radius:10px;padding:8px;margin:6px 0">' +
      '<div style="font-weight:800;margin-bottom:4px">Client phone' + (r.riderPhone ? ' \u2713 <span class="fine">' + esc(cphShow(r.riderPhone)) + (r.riderPhoneSrc === "calendar" ? " \u00b7 from the calendar" : r.riderPhoneSrc === "client" ? " \u00b7 saved for this client" : "") + "</span>" : (cphSaved ? ' <span class="fine">\u00b7 saved for this client: ' + esc(cphShow(cphSaved.phone)) + " (tap Save phone)</span>" : "")) + "</div>" +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      '<input id="cph-' + id + '" class="ph-box"' + phAttrs() + 'placeholder="936-555-1212" value="' + esc(phDraftVal("cph-" + r.id, r.riderPhone ? cphShow(r.riderPhone) : cphSaved ? cphShow(cphSaved.phone) : "")) + '"' + big + ">" +
      '<button type="button" class="btn btn-gold btn-cph-save" data-event-id="' + id + '" style="min-height:44px">Save phone</button>' + phPadHtml("cph-" + r.id) +
      '<label style="font-weight:700;font-size:17px;min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" class="cph-auto" data-event-id="' + id + '"' + (on ? " checked" : "") + ' style="width:26px;height:26px"> Auto text the tracking link</label>' +
      "</div>" + teenHtml(r) + (typeof smscPhoneOf === "function" && smscPhoneOf(r) ? '<p class="fine db-smsc-why" style="margin:4px 0 0">' + esc(smscWhy(state.smsc && state.smsc[smscPhoneOf(r)])) + "</p>" : "") + "</div>"; /* v77.23 r1b (L4) */
  }
  function teenHtml(r) { /* v77.5 */
    var id = esc(r.id), teen = r.teenRider === true, big = ' style="font-size:18px;min-height:44px;width:220px"';
    return '<div class="db-teen" style="margin-top:8px;border-top:1px solid #c9a227;padding-top:6px">' +
      '<label style="font-weight:700;font-size:17px;min-height:44px;display:flex;align-items:center;gap:6px"><input type="checkbox" class="teen-on" data-event-id="' + id + '"' + (teen ? " checked" : "") + ' style="width:26px;height:26px"> Teen rider</label>' +
      '<div id="teenbox-' + id + '" style="display:' + (teen ? "block" : "none") + ';margin:4px 0 6px 32px">' +
      '<div style="font-weight:800;margin-bottom:4px">Teen\u2019s phone' + (teen && r.teenPhone ? ' \u2713 <span class="fine">' + esc(cphShow(r.teenPhone)) + "</span>" : "") + "</div>" +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input id="teenph-' + id + '" class="ph-box"' + phAttrs() + 'placeholder="936-555-1212" value="' + esc(phDraftVal("teenph-" + r.id, r.teenPhone ? cphShow(r.teenPhone) : "")) + '"' + big + ">" +
      '<button type="button" class="btn btn-gold btn-teen-save" data-event-id="' + id + '" style="min-height:44px">Save teen phone</button>' + phPadHtml("teenph-" + r.id) + '</div></div>' +
      '<div style="font-weight:800;margin:6px 0 4px">Additional number' + (r.extraPhoneOnce ? ' \u2713 <span class="fine">' + esc(cphShow(r.extraPhoneOnce)) + "</span>" : "") + ' <span class="fine">(this ride only, never saved to the client)</span></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input id="xph-' + id + '" class="ph-box"' + phAttrs() + 'placeholder="936-555-1212" value="' + esc(phDraftVal("xph-" + r.id, r.extraPhoneOnce ? cphShow(r.extraPhoneOnce) : "")) + '"' + big + ">" +
      '<button type="button" class="btn btn-gold btn-xph-save" data-event-id="' + id + '" style="min-height:44px">Use for this ride</button>' + phPadHtml("xph-" + r.id) + '</div>' +
      "</div>";
  }
  function boardForceRebuild(draftKeys) { /* v77.12: after a save the card must show what was saved (blur the box, drop drafts, rebuild now) */
    (draftKeys || []).forEach(function (k) { if (state.phDrafts) delete state.phDrafts[k]; }); state.phPad = "";
    try { var a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) {}
    state.dbHoldUntil = 0; renderBoardLists();
  }
  function cphSave(id, patch, msg) {
    var row = rovRow(id); if (!row) return Promise.resolve(false);
    return godFetch(calendarUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("save"); Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
      if (msg) state.boardNotice = msg; boardForceRebuild(["cph-", "teenph-", "xph-"].map(function (p) { return p + id; })); /* v77.12 */
      return (patch.riderPhone ? clientRemember(row, patch.riderPhone) : Promise.resolve()).then(refresh); /* v77.10 */
    }).catch(function () { state.boardNotice = "NOT SAVED: try again."; renderBoardLists(); return false; });
  }
  if (typeof document !== "undefined") { /* v77.12 phone drafts + keypad */
    document.addEventListener("input", function (e) { var t = e.target; if (t && t.classList && t.classList.contains("ph-box") && t.id) { state.phDrafts = state.phDrafts || {}; state.phDrafts[t.id] = t.value; } }, true);
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(".btn-ph-pad,.ph-pad-key") : null; if (!t) return;
      var box = t.getAttribute("data-box"); if (!box) return;
      if (t.classList.contains("btn-ph-pad")) { var el0 = document.getElementById(box); state.phDrafts = state.phDrafts || {}; if (el0 && state.phDrafts[box] == null) state.phDrafts[box] = el0.value;
        state.phPad = state.phPad === box ? "" : box; try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (x) {} state.dbHoldUntil = 0; renderBoardLists(); return; }
      var el = document.getElementById(box); state.phDrafts = state.phDrafts || {};
      var v = phPadKey(phDraftVal(box, el ? el.value : ""), t.getAttribute("data-key")); state.phDrafts[box] = v; if (el) el.value = v;
    }, true);
  }
  function atxPost(path, body) {
    if (!/^\/(?:god\/(?:discounts|payout\/records|ridepct\/list|invoices|roster|charge\/claims|dvir\/reviewed|clients\/list|sms\/consent\/list)|disc\/list)$/.test(String(path))) slowKick(); /* v77.15: a Worker write reloads the 60 s lists next refresh */
    var auth = godWriteAuth(); if (!auth) return Promise.reject(new Error("The God password is needed once on this device."));
    return fetch(PAY_WORKER + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, body || {}, auth)) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || !d.ok) throw new Error(d.error || "Server error " + res.status); return d; }); });
  }
  function atxWhy(w) { return ({ sent: "Sent", failed: "Did not send (texting service error)", no_phone: "Client phone missing", not_configured: "Texting number not set up yet", already_sent: "Already sent", ride_off: "Auto text off for this ride", paused: "Paused" })[w] || String(w || ""); }
  function autoTextPanelHtml() {
    var s = state.atx || {}, log = s.log || [];
    var status = s.configured === false ? "Texting number not set up yet (Twilio keys missing). Nothing is sent." : s.on ? "ON: clients get the tracking link when the driver taps Start, or 30 min before pickup." : "OFF: nothing is sent.";
    return '<details class="atx-panel" style="margin:6px 0;border:2px solid #0b6b3a;border-radius:10px;padding:6px 8px"' + (s.open ? " open" : "") + '><summary style="cursor:pointer;font-weight:800">Auto text the tracking link (' + (s.on ? "ON" : "OFF") + ")</summary>" +
      '<p class="fine">' + esc(status) + "</p>" +
      '<button type="button" class="btn ' + (s.on ? "btn-ghost" : "btn-gold") + '" id="atx-toggle" style="min-height:52px;font-size:18px"' + (s.configured === false ? " disabled" : "") + ">" + (s.on ? "Turn auto texts OFF" : "Turn auto texts ON") + "</button> " +
      '<button type="button" class="btn btn-ghost" id="atx-refresh" style="min-height:52px">Refresh log</button>' +
      '<p class="error" role="alert">' + esc(s.err || "") + "</p>" +
      "<b>Texts today (" + log.length + ")</b>" +
      (log.length ? log.slice().reverse().map(function (x) {
        var t = ""; try { t = new Date(x.at).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }); } catch (e) {}
        return '<div class="card" style="padding:4px 8px;margin:3px 0">' + esc(t) + " CT \u00b7 " + esc(atxWhy(x.why)) + (x.to4 ? " \u00b7 to \u2026" + esc(x.to4) : "") + " \u00b7 " + esc(x.rider || x.rideId || "") + " \u00b7 " + esc(x.by === "cron" ? "30-min backup" : x.by === "god" ? "God mode" : "driver tapped Start") + "</div>";
      }).join("") : '<p class="fine">Nothing yet today.</p>') + dcardPanelHtml() + "</details>";
  }
  function atxLoad() {
    state.atx = state.atx || {};
    return atxPost("/god/smslog", {}).then(function (d) { state.atx.on = !!d.on; state.atx.configured = d.configured !== false; state.atx.log = Array.isArray(d.log) ? d.log : []; state.atx.err = ""; })
      .catch(function (e) { state.atx.err = String(e && e.message || e); }).then(function () { renderBoardLists(); });
  }
  function cphWire() {
    if (cphWire.done || typeof document === "undefined") return; cphWire.done = true;
    document.addEventListener("click", function (e) { var b = e.target && e.target.closest ? e.target.closest(".btn-disc-apply,.btn-disc-remove") : null; if (!b) return; /* v77.10 discount */
      var id = b.getAttribute("data-event-id"), rm = b.classList.contains("btn-disc-remove");
      var mode = (document.getElementById("disc-mode-" + id) || {}).value || "pct", amt = rm ? "" : ((document.getElementById("disc-amt-" + id) || {}).value || "");
      if (!rm && !String(amt).trim()) { state.boardNotice = "Type the discount first."; renderBoardLists(); return; }
      var o = godDiscPatch(mode, amt, Date.now()); if (!o.ok) { state.boardNotice = o.error; renderBoardLists(); return; }
      b.disabled = true; discSave(id, o.patch.meterDiscount, rm ? "Saved \u2713 Discount removed." : "Saved \u2713 Discount " + godDiscText(o.patch.meterDiscount) + " approved for this ride."); }, true);
    document.addEventListener("change", function (e) { var t = e.target; if (!t || !t.classList || !t.classList.contains("db-disc-driver-covers")) return; /* v77.10 */
      var id = t.getAttribute("data-event-id"), row = rovRow(id), on = !!t.checked, pt = row && driverCoversPatch((state.discKV && state.discKV[id] && state.discKV[id].d) || null, on, Date.now()); if (!pt) return; t.disabled = true; /* r4: Worker copy */
      discSave(id, pt.meterDiscount, on ? "Saved \u2713 Driver covers this discount." : "Saved \u2713 PCS covers this discount."); }, true);
    document.addEventListener("change", function (e) { var t = e.target; if (!t || !t.classList || !t.classList.contains("db-disc-preset")) return; /* v77.10 Military / Senior 65+ */
      var id = t.getAttribute("data-event-id"), k = t.getAttribute("data-disc-preset"), on = !!t.checked;
      var o = on ? godDiscPatch(k, "", Date.now()) : godDiscPatch("pct", "", Date.now()); t.disabled = true;
      if (on) idVerifyGodPop(k);
      discSave(id, o.patch.meterDiscount, on ? "Saved \u2713 " + godDiscText(o.patch.meterDiscount) + " on this ride." : "Saved \u2713 Discount removed."); }, true);
    document.addEventListener("change", function (e) { var t = e.target; if (!t || !t.classList || !t.classList.contains("db-cash-box")) return; /* v77.10 Cash */
      var id = t.getAttribute("data-event-id"), on = !!t.checked; t.disabled = true;
      cphSave(id, cashPatch(on, Date.now()), on ? "Saved \u2713 Cash ride: the driver collects at drop-off." : "Saved \u2713 Cash removed.").then(function (ok) { if (ok === false) { t.checked = !on; } t.disabled = false; }); }, true);
    dcardWire(); /* v77.3b */
    document.addEventListener("toggle", function (e) { if (e.target && e.target.classList && e.target.classList.contains("atx-panel")) { state.atx = state.atx || {}; var was = state.atx.open; state.atx.open = e.target.open; if (e.target.open && !was) atxLoad(); } }, true);
    document.addEventListener("change", function (e) {
      var t = e.target; if (t && t.classList && t.classList.contains("teen-on")) { /* v77.5 */
        var tid = t.getAttribute("data-event-id"), box = document.getElementById("teenbox-" + tid); if (box) box.style.display = t.checked ? "block" : "none";
        if (t.checked) { var tel = document.getElementById("teenph-" + tid); if (tel) { if (!tel.value) { tel.focus(); return; } var tp = teenPatch(true, tel.value, Date.now(), "god"); if (tp.ok) cphSave(tid, tp.patch, "Teen rider ON: texts also go to " + cphShow(tp.patch.teenPhone) + "."); } return; }
        cphSave(tid, teenPatch(false, "", Date.now(), "god").patch, "Teen rider OFF for this ride."); return;
      }
      if (!t || !t.classList || !t.classList.contains("cph-auto")) return;
      var id = t.getAttribute("data-event-id"); cphSave(id, autoTextPatch(t.checked, Date.now()), t.checked ? "Auto text ON for this ride." : "Auto text OFF for this ride.");
    }, true);
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(".btn-cph-save,.btn-teen-save,.btn-xph-save,#atx-toggle,#atx-refresh") : null; if (!t) return;
      if (t.classList.contains("btn-teen-save") || t.classList.contains("btn-xph-save")) { /* v77.5 */
        var vid = t.getAttribute("data-event-id"), isTeen = t.classList.contains("btn-teen-save"), vel = document.getElementById((isTeen ? "teenph-" : "xph-") + vid), vtx = phDraftVal((isTeen ? "teenph-" : "xph-") + vid, vel ? vel.value : "");
        var vo = isTeen ? teenPatch(true, vtx, Date.now(), "god") : extraPhonePatch(vtx, Date.now());
        if (!vo.ok) { state.boardNotice = "NOT SAVED: " + vo.error; renderBoardLists(); return; }
        t.disabled = true;
        cphSave(vid, vo.patch, isTeen ? "Saved: teen\u2019s phone " + cphShow(vo.patch.teenPhone) + "." : (vo.patch.extraPhoneOnce ? "Additional number " + cphShow(vo.patch.extraPhoneOnce) + " gets this ride\u2019s texts." : "Additional number cleared.")); return;
      }
      if (t.id === "atx-refresh") { atxLoad(); return; }
      if (t.id === "atx-toggle") { var on = !(state.atx && state.atx.on); t.disabled = true;
        atxPost("/god/autotext", { on: on }).then(function (d) { state.atx.on = !!d.on; state.atx.err = ""; }).catch(function (er) { state.atx.err = "NOT SAVED: " + (er && er.message || er); }).then(function () { renderBoardLists(); }); return; }
      var id = t.getAttribute("data-event-id"), el = document.getElementById("cph-" + id), typed = phDraftVal("cph-" + id, el ? el.value : "");
      if (!String(typed || "").trim()) { var hadRow = rovRow(id); /* v77.12: a blank box never silently wipes a saved phone */
        if (!(hadRow && hadRow.riderPhone) || !window.confirm("Clear this client\u2019s phone?")) { state.boardNotice = "NOT SAVED: type the 10-digit phone first."; renderBoardLists(); return; } }
      var out = clientPhonePatch(typed, Date.now(), "god");
      if (!out.ok) { state.boardNotice = "NOT SAVED: " + out.error; renderBoardLists(); return; }
      t.disabled = true; cphSave(id, out.patch, out.patch.riderPhone ? "Saved: client phone " + cphShow(out.patch.riderPhone) + "." : "Client phone cleared.");
    }, true);
  }
  /* ---------- v77.3b (Matthew 10/20 "more professional"): DRIVER PICTURE CARDS for the "on the way" text ----------
     Each driver's card (1200x630 JPEG) is drawn HERE from their profile (first name + photo + car + plate ONLY), then stored
     by the Worker (POST /god/dcard/put) under a random key. The auto text then goes as a picture message (MMS) with the card;
     a driver without a card gets the plain text. Remake a card after a driver changes photo or car. */
  function dcardLines(p) { /* pure (tested): the words on the card */
    p = p || {}; var c = p.car || {};
    var car = [c.year, c.make, c.model].filter(Boolean).join(" ");
    return { top: "Your PCS driver is on the way", name: String(p.first || "Your driver"), car: car + (car && c.color ? " \u00b7 " + c.color : (!car ? c.color || "" : "")),
      plate: String(c.plate || ""), site: "www.PCSrides.com", brand: "PRIVATE CAR SERVICES" };
  }
  function dcardImg(src) {
    return new Promise(function (ok) { if (!src) return ok(null); var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src; });
  }
  function dcardDraw(p, img) { /* -> { card, photo } base64 JPEGs (no data: prefix) */
    var L = dcardLines(p), W = 1200, H = 630, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var x = cv.getContext("2d"), GOLD = "#d4b15a", CREAM = "#f3ead2", SERIF = "Georgia,'Times New Roman',serif", SANS = "Helvetica,Arial,sans-serif";
    var g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#0e4a2b"); g.addColorStop(1, "#0a2e1a"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    var rg = x.createRadialGradient(270, 300, 40, 270, 300, 420); rg.addColorStop(0, "rgba(212,177,90,.18)"); rg.addColorStop(1, "rgba(212,177,90,0)"); x.fillStyle = rg; x.fillRect(0, 0, W, H);
    x.strokeStyle = GOLD; x.lineWidth = 3; x.strokeRect(22, 22, W - 44, H - 44); x.lineWidth = 1; x.strokeRect(32, 32, W - 64, H - 64);
    var cx = 270, cy = 300, r = 175;
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
    if (img) { var s = Math.max(2 * r / img.width, 2 * r / img.height), w = img.width * s, h = img.height * s; x.drawImage(img, cx - w / 2, cy - h / 2, w, h); }
    else { x.fillStyle = "#20371d"; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); x.fillStyle = GOLD; x.font = "bold 170px " + SERIF; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(L.name.charAt(0).toUpperCase(), cx, cy + 8); }
    x.restore(); x.beginPath(); x.arc(cx, cy, r + 4, 0, Math.PI * 2); x.strokeStyle = GOLD; x.lineWidth = 8; x.stroke();
    var tx = 520, fit = function (t, px, font, max) { x.font = px + "px " + font; while (x.measureText(t).width > max && px > 18) { px -= 2; x.font = px + "px " + font; } return px; };
    x.textAlign = "left"; x.textBaseline = "alphabetic";
    x.fillStyle = GOLD; fit(L.top.toUpperCase(), 30, SANS, 620); x.font = "bold " + x.font; x.fillText(L.top.toUpperCase(), tx, 170);
    x.fillStyle = CREAM; x.font = "italic " + fit(L.name, 96, SERIF, 620) + "px " + SERIF; x.fillText(L.name, tx, 275);
    x.fillStyle = GOLD; x.fillRect(tx, 300, 120, 3);
    x.fillStyle = CREAM; fit(L.car, 40, SANS, 620); x.fillText(L.car, tx, 365);
    if (L.plate) { x.font = "bold 44px " + SANS; var pw = x.measureText(L.plate).width + 48; x.fillStyle = "#fff"; x.strokeStyle = GOLD; x.lineWidth = 4;
      x.beginPath(); if (x.roundRect) x.roundRect(tx, 395, pw, 70, 12); else x.rect(tx, 395, pw, 70); x.fill(); x.stroke();
      x.fillStyle = "#0b3d23"; x.fillText(L.plate, tx + 24, 446); x.font = "22px " + SANS; x.fillStyle = CREAM; x.fillText("PLATE", tx + pw + 16, 440); }
    x.fillStyle = GOLD; x.font = "bold 34px " + SANS; x.fillText(L.site, tx, 548);
    x.fillStyle = "rgba(243,234,210,.75)"; x.font = "italic 20px " + SANS; x.fillText(L.brand, tx, 578);
    var card = cv.toDataURL("image/jpeg", 0.86).split(",")[1], photo = "";
    if (img) { var pv = document.createElement("canvas"); pv.width = pv.height = 240; var px = pv.getContext("2d"), s2 = Math.max(240 / img.width, 240 / img.height);
      px.drawImage(img, 120 - img.width * s2 / 2, 120 - img.height * s2 / 2, img.width * s2, img.height * s2); photo = pv.toDataURL("image/jpeg", 0.85).split(",")[1]; }
    return { card: card, photo: photo };
  }
  function dcardPanelHtml() {
    var s = state.dcard || {}, list = s.drivers || [];
    return '<div class="dcard-panel" style="margin-top:10px;border-top:2px solid #0b6b3a;padding-top:8px"><b>Driver picture cards (sent with the text)</b>' +
      '<p class="fine">Shows ONLY first name, photo, car and plate. A driver without a card (or without a signup photo) gets the generic PCS card.</p>' +
      '<button type="button" class="btn btn-ghost" id="dcard-load" style="min-height:52px">' + (list.length ? "Reload drivers" : "Show drivers") + "</button>" +
      '<p class="error" role="alert">' + esc(s.err || "") + "</p>" +
      list.map(function (d) {
        var L = dcardLines(d), url = d.cardKey ? PAY_WORKER + "/dcard/" + d.cardKey + ".jpg?v=" + (d.cardAt || 0) : "";
        return '<div class="card" style="padding:6px 8px;margin:4px 0"><b>' + esc(L.name) + "</b> \u00b7 " + esc(L.car || "car missing") + (L.plate ? " \u00b7 " + esc(L.plate) : "") + (d.photo ? "" : ' <span class="fine">(photo missing: initial shown)</span>') +
          (url ? '<div><img src="' + esc(url) + '" alt="Card" style="width:100%;max-width:420px;border-radius:8px;margin:4px 0"></div>' : "") +
          '<button type="button" class="btn btn-gold dcard-make" data-driver="' + esc(d.driverId) + '" style="min-height:52px;font-size:18px">' + (url ? "Remake card" : "Make card") + "</button>" +
          (url ? ' <button type="button" class="btn btn-ghost dcard-del" data-driver="' + esc(d.driverId) + '" style="min-height:52px">Remove card</button>' : "") + "</div>";
      }).join("") + "</div>";
  }
  function dcardLoad() {
    state.dcard = state.dcard || {};
    return atxPost("/god/dcard/src", {}).then(function (d) { state.dcard.drivers = d.drivers || []; state.dcard.err = ""; })
      .catch(function (e) { state.dcard.err = String(e && e.message || e); }).then(function () { renderBoardLists(); });
  }
  function dcardMake(id) {
    var d = ((state.dcard || {}).drivers || []).filter(function (x) { return x.driverId === id; })[0]; if (!d) return Promise.resolve();
    if (!d.photo) { state.dcard.err = "NOT SAVED: " + dcardLines(d).name + " needs a signup photo first. Until then the generic PCS card is sent."; renderBoardLists(); return Promise.resolve(); } /* v77.8 Matthew: real photo only */
    return dcardImg(d.photo).then(function (img) { var out = dcardDraw(d, img); return atxPost("/god/dcard/put", { driverId: id, card: out.card, photo: out.photo }); })
      .then(function (r) { d.cardKey = r.cardKey; d.cardAt = r.cardAt; state.dcard.err = ""; state.boardNotice = "Card saved for " + dcardLines(d).name + "."; })
      .catch(function (e) { state.dcard.err = "NOT SAVED: " + (e && e.message || e); }).then(function () { renderBoardLists(); });
  }
  function dcardWire() {
    if (dcardWire.done || typeof document === "undefined") return; dcardWire.done = true;
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("#dcard-load,.dcard-make,.dcard-del") : null; if (!t) return;
      if (t.id === "dcard-load") { dcardLoad(); return; }
      var id = t.getAttribute("data-driver"); t.disabled = true;
      if (t.classList.contains("dcard-make")) { dcardMake(id); return; }
      atxPost("/god/dcard/del", { driverId: id }).then(function () { (state.dcard.drivers || []).forEach(function (x) { if (x.driverId === id) { delete x.cardKey; delete x.cardAt; } }); })
        .catch(function (er) { state.dcard.err = String(er && er.message || er); }).then(function () { renderBoardLists(); });
    }, true);
  }
  if (typeof window !== "undefined") window.__pcsGodAutoText = { norm: cphNorm, phonePatch: clientPhonePatch, autoPatch: autoTextPatch, teenPatch: teenPatch, extraPatch: extraPhonePatch, teenHtml: teenHtml, html: cphHtml, panel: autoTextPanelHtml, why: atxWhy };
  /* v76d: Square invoice lookup (read-only, through the Worker). Amounts are pre-tax subtotal / tax / total in cents. */
  function sqInvoiceLine(q) {
    if (!q) return "";
    return (q.source === "square" ? "From Square: " : "Typed in: ") + "before tax " + fmtCents(q.subtotalCents) + ", tax " + fmtCents(q.taxCents) + ", total " + fmtCents(q.totalCents) +
      (q.status ? " \u00b7 " + String(q.status) : "") + (q.serviceDate ? " \u00b7 service " + String(q.serviceDate) : "") + (q.overridden ? " \u00b7 changed by Matthew" : "");
  }
  function sqInvoiceLookup(invoiceNo) {
    var auth = godWriteAuth();
    if (!auth) return Promise.resolve({ ok: false, error: "The God password is needed once on this device." });
    return fetch(PAY_WORKER + "/sq/invoice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ invoiceNo: String(invoiceNo || "") }, auth)) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) {
        if (d && d.godToken) { try { gqSetTok(d.godToken); } catch (e) {} }
        if (res.status === 404) return { ok: false, error: "Square lookup isn\u2019t live yet (Worker v76d). Type the amounts from the invoice." };
        if (!res.ok || !d || d.ok !== true) return { ok: false, error: (d && d.error) || "Square lookup failed. Type the amounts from the invoice." };
        return { ok: true, invoice: d.invoice };
      }); }).catch(function () { return { ok: false, error: "Square lookup failed (connection). Type the amounts from the invoice." }; });
  }
  window.__pcsV76dSq = { line: sqInvoiceLine };
  function dbTipHtml(r) {
    var v = state.tipDrafts && state.tipDrafts[r.id] != null ? state.tipDrafts[r.id] : (Number(r.tipCents) > 0 ? (Number(r.tipCents) / 100).toFixed(2) : "");
    var pv = state.paidDrafts && state.paidDrafts[r.id] != null ? state.paidDrafts[r.id] : (r.paidSquareCents != null ? (r.paidSquareCents / 100).toFixed(2) : "");
    return '<div class="day-tip" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0">' +
      '<label for="paid-' + esc(r.id) + '">Invoice total $ (amount only; paid shows after Square confirms)</label>' +
      '<input id="paid-' + esc(r.id) + '" class="day-paid-in" data-event-id="' + esc(r.id) + '"' + moneyRegAttrs() + ' value="' + esc(pv) + '" style="width:110px">' +
      '<label for="tip-' + esc(r.id) + '">Tip (paid in Square) $</label>' +
      '<input id="tip-' + esc(r.id) + '" class="day-tip-in" data-event-id="' + esc(r.id) + '"' + moneyRegAttrs() + ' value="' + esc(v) + '" style="width:110px">' +
      '<button type="button" class="btn btn-gold btn-save-tip" data-event-id="' + esc(r.id) + '">Save</button>' +
      (r.paidSquareCents != null ? '<span class="fine" id="paid-saved-' + esc(r.id) + '">Invoice total ' + esc(fmtCents(r.paidSquareCents)) + " (not proof of payment)</span>" : "") +
      '<p class="fine day-paid-pre" id="paid-pre-' + esc(r.id) + '" style="flex-basis:100%;margin:0;font-weight:700">' + esc(paidSquareLine(pv !== "" && isFinite(+pv) ? Math.round(+pv * 100) : null, r.assignedDriverId ? ridePctFor(r) : null)) + "</p>" +
      (Number(r.tipCents) > 0 ? '<span class="fine" id="tip-saved-' + esc(r.id) + '">Saved ' + esc(fmtCents(r.tipCents)) + " card tip</span>" : "") + "</div>";
  }
  function saveCalendarTip(eventId, val, paidVal) {
    var row = null; (state.calendar || []).forEach(function (r) { if (r && r.id === eventId) row = r; });
    if (!row) return Promise.reject(new Error("missing"));
    var pct = row.assignedDriverId ? commissionPctFor(row.assignedDriverId) : DEFAULT_COMMISSION_PCT;
    if (ridePctOf(row) != null) pct = ridePctOf(row); /* v76d: per-ride % wins */
    var m = paidSquareMath(paidVal, val, pct, Math.round((Number(row.fareBeforeTax) || 0) * 100));
    if (!m.ok) return Promise.reject(new Error(m.error));
    var cents = m.tipCents, now = Date.now();
    var edits = Array.isArray(row.tipEdits) ? row.tipEdits.slice(-20) : [];
    if (cents !== (Number(row.tipCents) || 0)) edits.push({ at: now, cents: cents, prevCents: Number(row.tipCents) || 0, by: "Matthew" });
    var pEdits = Array.isArray(row.paidEdits) ? row.paidEdits.slice(-20) : [];
    if (m.paidCents !== row.paidSquareCents) pEdits.push({ at: now, cents: m.paidCents, prevCents: row.paidSquareCents, by: "Matthew" });
    var next = Object.assign({}, row, { tipCents: cents, tipVia: "card", tipEdits: edits, paidSquareCents: m.paidCents, paidEdits: pEdits, updatedAt: now });
    if (m.paidCents != null && row.status === "completed") next.commissionCents = m.commissionCents;
    return putCalendarRide(next).then(function () {
      if (row.status === "completed" && row.assignedDriverId) {
        var hp = { tipCents: cents, tipVia: "card", cardTipCents: cents, tipEditedAt: now };
        if (m.paidCents != null) Object.assign(hp, { paidSquareCents: m.paidCents, fareSub: m.preTaxCents, fareTax: m.taxCents, fareTotal: m.paidCents, commissionPct: pct, commissionCents: m.commissionCents, paidEditedAt: now });
        return godFetch(historyUrl(row.assignedDriverId, row.meterCode || next.code || ownCode(row)) /* v76d: a metered ride's earnings live under its meter code */, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hp) });
      }
    }).then(function () {
      if (state.tipDrafts) delete state.tipDrafts[eventId]; if (state.paidDrafts) delete state.paidDrafts[eventId];
      state.boardNotice = (m.paidCents != null ? "Invoice total " + fmtCents(m.paidCents) + " (" + paidSquareLine(m.paidCents, pct) + ")" + (row.status === "completed" ? " · commission " + fmtCents(m.commissionCents) : "") + " · " : "") + "Card tip " + fmtCents(cents) + " saved (100% to the driver)";
      return refresh();
    });
  }
  /* v73: Cancel ride from God mode: Waive fee (default) or Charge cancellation fee, required reason, confirm */
  function dbCancelHtml(r) {
    var o = (state.cancelOpen || {})[r.id];
    if (!o) return '<button type="button" class="btn btn-ghost btn-cancel-open" data-event-id="' + esc(r.id) + '" style="color:#ff9b9b">Cancel ride</button>';
    return '<div class="day-cancel" id="cancel-' + esc(r.id) + '" style="border:1px solid #ff9b9b;border-radius:10px;padding:8px;margin:6px 0">' +
      '<p style="margin:0 0 4px;font-weight:800">Cancel this ride</p>' +
      '<label><input type="radio" name="cfee-' + esc(r.id) + '" value="waive"' + (o.fee !== "charge" ? " checked" : "") + "> Waive fee (no charge)</label><br>" +
      '<label><input type="radio" name="cfee-' + esc(r.id) + '" value="charge"' + (o.fee === "charge" ? " checked" : "") + "> Charge cancellation fee</label><br>" +
      '<label for="creason-' + esc(r.id) + '">Reason (required)</label><input id="creason-' + esc(r.id) + '" class="day-cancel-reason" data-event-id="' + esc(r.id) + '" type="text" maxlength="200" value="' + esc(o.reason || "") + '">' +
      '<p class="error" id="cerr-' + esc(r.id) + '" style="color:#ff6b6b">' + esc(o.err || "") + "</p>" +
      '<button type="button" class="btn btn-gold btn-cancel-go" data-event-id="' + esc(r.id) + '">Cancel ride</button> <button type="button" class="btn btn-ghost btn-cancel-close" data-event-id="' + esc(r.id) + '">Keep ride</button></div>';
  }
  function cancelCalendarRide(eventId, fee, reason) {
    var row = null; (state.calendar || []).forEach(function (r) { if (r && r.id === eventId) row = r; });
    if (!row) return Promise.reject(new Error("missing"));
    var now = Date.now(), code = ownCode(row); /* v76d */
    var next = Object.assign({}, row, { status: "cancelled", cancelledAt: now, cancelledBy: "owner", cancelReason: reason, cancelFee: fee === "charge" ? "charge" : "waived",
      cancelFeeStatus: fee === "charge" ? "to_charge" : "waived", code: code, updatedAt: now });
    delete next.extraPhoneOnce; /* v77.5: one-time Additional number ends with the ride */
    return putCalendarRide(next).then(function () {
      if (!row.assignedDriverId) return null;
      var cEntry = { scheduleId: eventId, canceled: true, riderName: row.rider || "", day: boardDayKey(row.start) || chicagoToday() };
      return godHistoryGuard(row.assignedDriverId, code, cEntry).then(function (g) { if (g.skip) return null; /* v76d: a canceled $0 never overwrites a finished ride */
      return godFetch(historyUrl(row.assignedDriverId, g.code), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        scheduleId: eventId, code: g.code, day: boardDayKey(row.start) || chicagoToday(), completedAt: now, when: fmtBoardWhen(row.start), pickup: row.pickup || "", drop: row.dropoff || "",
        riderName: row.rider || "", status: "canceled", canceled: true, cancelReason: reason, cancelFee: next.cancelFee, fareSub: 0, fareTax: 0, fareTotal: 0,
        commissionPct: ridePctFor(row), commissionCents: 0, tipCents: 0, source: row.source === "manual" ? "manual" : "calendar" }) }); });
    }).then(function () {
      if (state.cancelOpen) delete state.cancelOpen[eventId];
      state.boardNotice = "Canceled " + (row.rider || "ride") + " (" + (fee === "charge" ? "cancellation fee to charge" : "fee waived") + ")" + (row.assignedDriverName ? "; " + row.assignedDriverName + " is notified" : "");
      return refresh();
    });
  }
  window.__pcsGodCancel = cancelCalendarRide;
  /* ---------- v76b (Matthew 10/17): "Text my client a tracking link" on assigned board rides ----------
     Same link as the driver app (app.js folClean / FLWSHARE / FLWRDMAP c_<row id>). First tap makes (or reuses) the link,
     second tap opens Messages to the rider's phone with the text filled in. Matthew presses Send; nothing is sent from here.
     The assigned driver's app keeps the map live once the driver heads out. Public copy = first name + addresses + status. */
  var GFOL = { map: {}, busy: {}, err: {} };
  var GFOL_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
  function gfolToken() {
    var c = window.crypto || window.msCrypto;
    if (!c || !c.getRandomValues) return "";
    var b = new Uint8Array(24), s = "", i;
    c.getRandomValues(b);
    for (i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function gfolUrl(hub, key) { return baseUrl() + "/rides/" + hub + "/" + encodeURIComponent(key) + ".json"; }
  function gfolLink(t) { try { return new URL("../follow/?t=" + t, window.location.href).href; } catch (e) { return ""; } }
  function gfolFirst(name) { var w = String(name || "").trim().split(/\s+/)[0] || ""; return /^[A-Za-z][A-Za-z'.-]{0,30}$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : ""; }
  function gfolE164(raw) { var d = String(raw || "").replace(/\D/g, ""); if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1); return d.length === 10 && /^[2-9]/.test(d) ? "+1" + d : ""; }
  function gfolMsg(r, t) { var f = gfolFirst(r.assignedDriverName); return "Your PCS driver " + (f ? f + " " : "") + "is on the way. Follow along live: " + gfolLink(t) + " - www.PCSrides.com"; }
  function gfolTxt(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function gfolPlace(text, lat, lng) {
    var p = {}, l = gfolTxt(text, 120);
    if (l) p.label = l;
    if (lat != null && lng != null && isFinite(+lat) && isFinite(+lng) && !(+lat === 0 && +lng === 0)) { p.lat = Math.round(+lat * 1e4) / 1e4; p.lng = Math.round(+lng * 1e4) / 1e4; }
    return p.label || p.lat != null ? p : null;
  }
  function gfolHtml(r) {
    if (!r || !r.assignedDriverId || r.status === "completed" || r.status === "cancelled" || r.status === "deleted") return "";
    var g = GFOL.map[r.id], e = gfolE164(r.riderPhone);
    if (g && g.t) {
      return '<div class="gfol" style="margin:6px 0"><a class="btn btn-gold gfol-sms" style="display:block;text-align:center;min-height:52px;font-size:18px;font-weight:800;text-decoration:none;padding:12px" href="' +
        esc("sms:" + e + "?&body=" + encodeURIComponent(gfolMsg(r, g.t))) + '">Open Messages' + (e ? " to " + esc(r.riderPhone) : "") + ": tracking link</a>" +
        '<p class="fine" style="margin:4px 0">You press Send. The client sees the car and ETA once ' + esc(gfolFirst(r.assignedDriverName) || "the driver") + " heads out; fare and payment stay private.</p>" +
        '<button type="button" class="btn btn-ghost gfol-stop" data-event-id="' + esc(r.id) + '" style="margin:2px 0">Stop the tracking link</button></div>';
    }
    return '<div class="gfol" style="margin:6px 0"><button type="button" class="btn btn-gold gfol-make" data-event-id="' + esc(r.id) + '" style="display:block;width:100%;min-height:52px;font-size:18px;font-weight:800"' + (GFOL.busy[r.id] ? " disabled" : "") + ">" +
      (GFOL.busy[r.id] ? "Getting the tracking link\u2026" : "Text my client a tracking link") + "</button>" +
      (GFOL.err[r.id] ? '<p class="fine" style="color:#ffb35c">' + esc(GFOL.err[r.id]) + "</p>" : "") + "</div>";
  }
  function gfolFind(id) { var rows = (state.calendar || []), i; for (i = 0; i < rows.length; i += 1) if (rows[i] && rows[i].id === id) return rows[i]; return null; }
  function gfolMake(id, r) {
    if (!r || GFOL.busy[id]) return;
    GFOL.busy[id] = true; GFOL.err[id] = ""; renderBoardLists();
    var key = "c_" + id, now = Date.now();
    fetch(gfolUrl("FLWRDMAP", key)).then(function (res) { if (!res.ok) throw new Error("read " + res.status); return res.json(); }).then(function (d) {
      if (d && GFOL_TOKEN_RE.test(String(d.t || ""))) return String(d.t);
      var t = gfolToken();
      if (!GFOL_TOKEN_RE.test(t)) throw new Error("token");
      var copy = { v: 1, status: "assigned", kind: "sched", createdAt: now, updatedAt: now };
      var df = gfolFirst(r.assignedDriverName); if (df) copy.driverFirst = df;
      var pk = gfolPlace(r.pickup, r.pickupLat, r.pickupLng); if (pk) copy.pickup = pk;
      var dr = gfolPlace(r.dropoff, r.dropoffLat, r.dropoffLng); if (dr) copy.dest = dr;
      var sx = (r.stopsGeo || []).slice(0, 5).map(function (x) { return x ? gfolPlace(x.address, x.lat, x.lng) : null; }).filter(Boolean); if (sx.length) copy.stops = sx; /* v76g: stops show on the tracker */
      var put = function (url, body) { return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (x) { if (!x.ok) throw new Error("save " + x.status); }); };
      return put(gfolUrl("FLWSHARE", t), copy).then(function () { return put(gfolUrl("FLWRDMAP", key), { t: t, at: now, by: "god" }); }).then(function () { return t; });
    }).then(function (t) { GFOL.busy[id] = false; GFOL.map[id] = { t: t }; renderBoardLists(); })
      .catch(function (e) { GFOL.busy[id] = false; GFOL.err[id] = "The tracking link could not be made right now (" + (e && e.message || "try again") + ")."; renderBoardLists(); });
  }
  function gfolStop(id) {
    var g = GFOL.map[id]; if (!g || !g.t) return;
    var now = Date.now();
    fetch(gfolUrl("FLWSHARE", g.t), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, status: "stopped", endedAt: now, updatedAt: now }) }).catch(function () {});
    fetch(gfolUrl("FLWRDMAP", "c_" + id), { method: "DELETE" }).catch(function () {});
    GFOL.map[id] = null; renderBoardLists();
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".gfol-make,.gfol-stop") : null;
    if (!b) return;
    e.preventDefault();
    var id = b.getAttribute("data-event-id"); if (!id) return;
    if (b.classList.contains("gfol-stop")) gfolStop(id); else gfolMake(id, gfolFind(id));
  });
  window.__pcsGodFollow = { html: gfolHtml, msg: gfolMsg, e164: gfolE164, state: GFOL, place: gfolPlace }; /* test hook */
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
    dbBindOnce();
    var dbBodyStyle = dbBoardCollapsed() ? ' style="display:none"' : "";
    if (!rows.length && !err) {
      return (
        '<section class="day-board' + (dbBoardCollapsed() ? " db-collapsed" : "") + '" id="day-board">' +
        dbHeaderHtml(0) +
        '<div id="day-board-body"' + dbBodyStyle + ">" + howBlock + "</div>" + notice +
        "</section>"
      );
    }
    var dbCards = dbCardSet();
    var cards = rows.map(function (r) {
      var st = r.status || "open";
      var badge = st === "completed"
        ? '<span class="badge">Done</span>'
        : (st === "assigned"
          ? '<span class="badge online">Assigned</span>'
          : '<span class="badge pending">Open</span>');
      var options = ['<option value="">' + (r.assignedDriverId ? "Unassign (open)" : "Assign driver\u2026") + "</option>"].concat(drivers.map(function (d) {
        var sel = d.id === (state.assignDrafts[r.id] != null ? state.assignDrafts[r.id] : r.assignedDriverId) ? " selected" : ""; /* v73: keep the picked name */
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
            '<button type="button" class="btn btn-ghost db-card-toggle" data-day-card-toggle="' + esc(r.id) + '" aria-expanded="' + (dbCards[r.id] ? "false" : "true") + '" aria-label="Collapse or expand this ride" style="padding:2px 8px;min-height:0">' + (dbCards[r.id] ? "\u25B6" : "\u25BC") + "</button>" +
            '<p class="day-time">' + esc(fmtBoardWhen(r.start)) + "</p>" +
            '<span class="pcs-pill-row">' + (st === "canceled" || st === "cancelled" ? "" : paidPillHtml(r) + (typeof smscPillHtml === "function" ? smscPillHtml(smscPhoneOf(r), clientFullName(r)) : "")) + badge + "</span>" + /* v77.15; v77.23 r1b texts pill */
          "</div>" +
          '<h3 class="day-rider">' + esc(r.rider) + "</h3>" + driverLineHtml(r) + /* v77.10 */
          '<div class="day-card-body"' + (dbCards[r.id] ? ' style="display:none"' : "") + ">" +
          '<p class="day-line"><span>Pickup</span> ' + esc(r.pickup || "—") + "</p>" +
          ((r.stopsGeo && r.stopsGeo[0] && r.stopsGeo[0].address) || (r.stops && r.stops[0]) ? '<p class="day-line"><span>Stop</span> ' + esc((r.stopsGeo && r.stopsGeo[0] && r.stopsGeo[0].address) || r.stops[0]) + "</p>" : "") +
          '<p class="day-line"><span>Drop-off</span> ' + esc(r.dropoff || "Add the drop-off") + (r.dropoffEdited ? ' <span class="fine">(set in ' + (r.dropoffEditedBy === "driver" ? "driver app" : "God mode") + ")</span>" : "") + "</p>" +
          (GEST.setFare(r) ? '<p class="day-line db-est" id="db-est-' + esc(r.id) + '"><span>Price</span> ' + esc(GEST.calc(r, 0, 0).text) + "</p>"
            : GEST.saved(r) ? '<p class="day-line db-est" id="db-est-' + esc(r.id) + '"><span>Estimate</span> ' + esc(GEST.saved(r).text) + "</p>" : "") + /* v75s */
          (r.description && r.description !== r.dropoff ? '<p class="day-line"><span>Calendar note</span> ' + esc(r.description) + "</p>" : "") +
          (st !== "completed" && st !== "cancelled" ? '<button type="button" class="btn btn-gold btn-edit-drop" data-event-id="' + esc(r.id) + '" data-field="pick" style="margin:4px 6px 4px 0">' + (r.pickup ? "Change pickup" : "Add pickup") + "</button>" + /* v75t */
            '<button type="button" class="btn btn-gold btn-edit-drop" data-event-id="' + esc(r.id) + '" data-field="drop" style="margin:4px 6px 4px 0">' + (r.dropoff ? "Change drop-off" : "Add drop-off") + "</button>" +
            '<button type="button" class="btn btn-ghost btn-edit-drop" data-event-id="' + esc(r.id) + '" data-field="stop" style="margin:4px 0">Stop…</button>' : "") +
          (r.prepaid ? '<p class="day-line db-prepaid" style="background:' + (paidSquare(r) ? "#0b6b3a" : "#7c4a03") + ';color:#fff;font-weight:800;border-radius:8px;padding:4px 8px">' + (paidSquare(r) ? "\u2713 " : "\u23f3 ") + esc(prepaidLabel(r)) + "</p>" : "") + /* v75v */
          (st !== "cancelled" ? '<button type="button" class="btn btn-ghost btn-prepaid" data-event-id="' + esc(r.id) + '" style="margin:4px 0">' + (r.prepaid ? "Prepaid (Square invoice) \u2713" : "Prepaid (Square invoice)") + "</button>" : "") +
          (r.assignedDriverName
            ? '<p class="day-line"><span>Driver</span> ' + esc(r.assignedDriverName) + "</p>"
            : "") +
          (r.assignedDriverId ? dbTipHtml(r) : "") + /* v73 Tip (paid in Square) */
          (r.assignedDriverId && st !== "cancelled" ? rideCommHtml(r) : "") + /* v76d per-ride Commission % */
          (st !== "cancelled" && st !== "completed" ? rateOvHtml(r) : "") + /* v76j rate override */
          (st !== "cancelled" && st !== "completed" ? cphHtml(r) : "") + /* v77.3 client phone + auto text */
          (r.sqInvoice ? '<p class="day-line db-sqinv"><span>Invoice</span> #' + esc(r.prepaidInvoiceNo || r.sqInvoice.number || "") + " \u00b7 " + esc(sqInvoiceLine(r.sqInvoice)) + "</p>" : "") +
          gfolHtml(r) + /* v76b: Text my client a tracking link */
          (st === "completed"
            ? '<p class="day-line"><span>Commission</span> ' + esc(fmtCents(r.commissionCents)) + "</p>" +
              (completedEarly(r) ? '<p class="day-line db-early" style="color:#ffb35c;font-weight:700">Completed early – <button type="button" class="btn btn-ghost btn-undo-complete" data-event-id="' + esc(r.id) + '" style="min-height:0;padding:2px 10px">Undo</button></p>' : "")
            : (
              '<div class="day-actions">' +
                '<label class="sr-only" for="assign-' + esc(r.id) + '">Assign driver</label>' +
                '<select id="assign-' + esc(r.id) + '" class="day-assign" data-event-id="' + esc(r.id) + '"' + assignDisabled + ">" +
                  options.join("") +
                "</select>" +
                '<button type="button" class="btn btn-gold btn-assign-ride" data-event-id="' + esc(r.id) + '"' + assignDisabled + ">Assign</button>" +
                '<div class="day-fare-row" style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;flex-basis:100%">' + /* v77.6 (Matthew): Invoice # beside the fare; Save fare saves both */
                  '<div style="display:flex;flex-direction:column;flex:1 1 140px;min-width:120px"><label class="fare-label fine" for="fare-' + esc(r.id) + '">Fare before tax $</label>' +
                  '<input id="fare-' + esc(r.id) + '" class="day-fare" data-event-id="' + esc(r.id) + '"' + moneyRegAttrs() + ' value="' + esc(moneyRegVal(fareVal)) + '"' + assignDisabled + "></div>" +
                  '<div style="display:flex;flex-direction:column;flex:1 1 140px;min-width:120px"><label class="inv-label fine" for="inv-' + esc(r.id) + '">Invoice #</label>' +
                  '<input id="inv-' + esc(r.id) + '" class="day-inv" data-event-id="' + esc(r.id) + '" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="000519" value="' + esc(r.prepaidInvoiceNo || "") + '"' + assignDisabled + "></div>" +
                "</div>" +
                '<label class="fine day-fixed-lbl" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" class="day-fixed" id="fixed-' + esc(r.id) + '" data-event-id="' + esc(r.id) + '"' + (r.fixedFare ? " checked" : "") + assignDisabled + "> Account ride: driver app charges this fare</label>" +
                '<button type="button" class="btn btn-gold btn-save-fare" data-event-id="' + esc(r.id) + '"' + assignDisabled + ">Save fare</button>" +
                (r.fareBeforeTax != null ? '<span class="fine" id="fare-saved-' + esc(r.id) + '">Saved ' + esc(fmtCents(Math.round(Number(r.fareBeforeTax) * 100))) + (r.fixedFare ? " · set fare" : "") + "</span>" : "") + invLinkHtml(r) +
                '<button type="button" class="btn btn-ghost btn-complete-ride" data-event-id="' + esc(r.id) + '"' + completeDisabled + ">Complete ride…</button>" +
              "</div>" + dbCancelHtml(r)
            )) +
          "</div>" +
        "</article>"
      );
    }).join("");
    return (
      '<section class="day-board' + (dbBoardCollapsed() ? " db-collapsed" : "") + '" id="day-board">' +
        dbHeaderHtml(rows.length) + notice +
        '<div id="day-board-body"' + dbBodyStyle + ">" +
        howBlock + err +
        '<div class="day-grid">' + cards + "</div>" +
        "</div>" +
      "</section>"
    );
  }

  /* ---------- v71m (Oct 9): Daily miles — per driver / vehicle / Chicago day ----------
     Source: rides/DRVRMLES/{driverId}/{YYYY-MM-DD} written by the driver app (v64+):
       day row: startOdometer (opening odo of the LATEST shift that day), endOdometer + shiftClosed (set at Log out),
                priorEndOdometer (ending odo of an earlier shift the same day), gpsMiles (app-tracked incl. filled-in),
                filledMiles, onlineMs (closed online time) + shiftStartAt (open segment start), lastUpdate
       shifts/{shiftStartedAt}: startOdo, endOdo, odoMiles, trackedMiles, filledInMiles, shiftStartedAt, shiftEndedAt
     Odometer miles = sum of (end - start) for each shift with both readings (miles between shifts = personal, excluded).
     Same logic as /workspace/pcs-mileage/export_daily_miles.py (Penny's CSV). */
  var DAILY_MILES_DAYS = 30;
  var DAILY_MILES_SKIP = { test_test_com: true }; /* test login, not a real vehicle */

  function dmNum(v) { return v != null && v !== "" && isFinite(Number(v)) ? Number(v) : null; }
  function dmRound1(n) { return Math.round(n * 10) / 10; }

  function dailyMilesCompute(milesByDriver, roster, drivers, nowMs, todayYmd) {
    var out = [];
    var presence = {};
    (drivers || []).forEach(function (d) { if (d && d.id) presence[d.id] = d; });
    Object.keys(milesByDriver || {}).forEach(function (id) {
      if (DAILY_MILES_SKIP[id]) return;
      var days = milesByDriver[id] || {};
      var r = (roster && roster[id]) || {};
      var p = presence[id] || {};
      var name = String(r.name || p.name || id);
      var carSrc = (r.carMake || r.carModel) ? r : p;
      var vehicle = [carSrc.carYear, carSrc.carMake, carSrc.carModel].filter(Boolean).join(" ");
      if (carSrc.carPlate) vehicle += (vehicle ? " · " : "") + String(carSrc.carPlate);
      var ymds = Object.keys(days).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k) && days[k] && typeof days[k] === "object"; }).sort();
      var seenShift = {}; /* v72u: a shift saved again on a later day (ended after midnight) counts once, on its start day */
      ymds.forEach(function (ymd, idx) {
        var row = days[ymd];
        var segs = [];
        var sh = row.shifts && typeof row.shifts === "object" ? row.shifts : {};
        Object.keys(sh).forEach(function (k) {
          var x = sh[k];
          if (!x || typeof x !== "object") return;
          var sk = String(dmNum(x.shiftStartedAt) || dmNum(k) || k);
          if (seenShift[sk]) return;
          seenShift[sk] = 1;
          segs.push({ start: dmNum(x.startOdo), end: dmNum(x.endOdo), at: dmNum(x.shiftStartedAt) || dmNum(k) || 0, open: false });
        });
        var rs = dmNum(row.startOdometer), re = dmNum(row.endOdometer);
        var closed = !!row.shiftClosed || re != null;
        var matchLast = segs.some(function (s) { return rs != null && s.start === rs; });
        if (rs != null && !matchLast) {
          segs.push({ start: rs, end: closed ? re : null, at: dmNum(row.shiftStartAt) || dmNum(row.startedAt) || 9e15, open: !closed });
        }
        var pe = dmNum(row.priorEndOdometer);
        var lost = false;
        if (pe != null && !segs.some(function (s) { return s.end === pe; })) {
          segs.push({ start: null, end: pe, at: 0, open: false, lost: true });
          lost = true;
        }
        segs.sort(function (a, b) { return a.at - b.at; });
        var starts = segs.map(function (s) { return s.start; }).filter(function (v) { return v != null; });
        var ends = segs.map(function (s) { return s.end; }).filter(function (v) { return v != null; });
        var last = segs.length ? segs[segs.length - 1] : null;
        var startOdo = starts.length ? Math.min.apply(null, starts) : null;
        var endOdo = last && last.end != null ? Math.max.apply(null, ends) : null;
        var odo = 0, odoCount = 0;
        segs.forEach(function (s) { if (s.start != null && s.end != null && s.end >= s.start) { odo += s.end - s.start; odoCount += 1; } });
        var odoMiles = odoCount ? dmRound1(odo) : null;
        var tracked = dmNum(row.gpsMiles);
        (function () { /* v72x: mileage-only shift entries (owner reset / split) count as tracked miles too */
          var sh0 = row.shifts && typeof row.shifts === "object" ? row.shifts : {}, add = 0;
          Object.keys(sh0).forEach(function (k) { var x = sh0[k]; if (x && (x.mileageOnly || x.hosOwnerReset)) add += dmNum(x.trackedMiles) || dmNum(x.odoMiles) || 0; });
          if (add) tracked = Math.round(((tracked || 0) + add) * 100) / 100;
        })();
        var filled = dmNum(row.filledMiles);
        var online = dmNum(row.onlineMs);
        var openStart = dmNum(row.shiftStartAt);
        var isToday = ymd === todayYmd;
        if (openStart && openStart > 0) {
          var until = isToday ? nowMs : (dmNum(row.lastUpdate) || openStart);
          online = (online || 0) + Math.max(0, until - openStart);
        }
        var flags = [];
        var missingEnd = !last || last.end == null;
        var nextStart = null, nextDay = "";
        if (missingEnd) {
          for (var j = idx + 1; j < ymds.length; j += 1) {
            var nr = days[ymds[j]] || {};
            var cand = [];
            var nsh = nr.shifts && typeof nr.shifts === "object" ? nr.shifts : {};
            Object.keys(nsh).forEach(function (k) { var v = dmNum(nsh[k] && nsh[k].startOdo); if (v != null) cand.push(v); });
            if (dmNum(nr.startOdometer) != null) cand.push(dmNum(nr.startOdometer));
            if (cand.length) { nextStart = Math.min.apply(null, cand); nextDay = ymds[j]; break; }
          }
          if (isToday && last && last.open) flags.push("On shift now (no ending odometer yet)");
          else flags.push("MISSING ending odometer" + (nextStart != null ? " · next opening odometer " + nextStart + " (" + nextDay + ")" : ""));
        }
        if (lost) flags.push("Earlier shift's opening odometer was overwritten by the app (it ended at " + pe + "); odometer total covers later shift(s) only");
        if (odoMiles != null && tracked != null && !lost && !missingEnd) {
          var gap = odoMiles - tracked;
          if (Math.abs(gap) > Math.max(5, odoMiles * 0.15)) flags.push("Odometer vs tracked differ by " + (gap >= 0 ? "+" : "") + dmRound1(gap) + " mi");
        }
        out.push({
          date: ymd, driverId: id, driver: name, vehicle: vehicle,
          startOdo: startOdo, endOdo: endOdo, odoMiles: odoMiles,
          trackedMiles: tracked != null ? Math.round(tracked * 100) / 100 : null,
          filledMiles: filled, onlineMs: online, shifts: segs.length,
          missingEnd: missingEnd && !(isToday && last && last.open),
          openNow: !!(isToday && last && last.open),
          incomplete: lost || missingEnd,
          nextStart: nextStart, nextDay: nextDay,
          flags: flags
        });
      });
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : a.driver.localeCompare(b.driver)); });
    return out;
  }

  function dmFmtOnline(ms) {
    if (ms == null) return "—";
    var m = Math.round(ms / 60000);
    return Math.floor(m / 60) + "h " + (m % 60 < 10 ? "0" : "") + (m % 60) + "m";
  }

  function dailyMilesRowsNow() {
    var all = dailyMilesCompute(state.miles || {}, state.roster || {}, state.drivers || [], Date.now(), chicagoToday());
    var keep = {};
    last14Days().forEach(function (d) { keep[d] = true; });
    var cutoff = new Date(Date.now() - DAILY_MILES_DAYS * 86400000).toISOString().slice(0, 10);
    return all.filter(function (r) { return r.date >= cutoff || keep[r.date]; });
  }

  function dailyMilesCsv(rows) {
    var q = function (v) { var s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = ["date,driver,vehicle,start_odo,end_odo,odometer_miles,tracked_miles,online_hours,status,notes"];
    rows.slice().reverse().forEach(function (r) {
      lines.push([r.date, r.driver, r.vehicle, r.startOdo, r.endOdo, r.odoMiles, r.trackedMiles,
        r.onlineMs != null ? (Math.round(r.onlineMs / 36000) / 100).toFixed(2) : "",
        r.openNow ? "open" : (r.incomplete ? "incomplete" : "complete"), r.flags.join("; ")].map(q).join(","));
    });
    return lines.join("\n") + "\n";
  }

  function dailyMilesPanelHtml() {
    if (state.milesError === "denied") return '<p class="fine">Mileage data: access denied by Firebase rules.</p>';
    var rows = dailyMilesRowsNow();
    if (!rows.length) return '<p class="fine">No mileage days saved yet.</p>';
    var missing = rows.filter(function (r) { return r.missingEnd; }).length;
    var head = '<p class="fine">Opening and ending odometer per driver and day (Chicago), last ' + DAILY_MILES_DAYS + " days. " +
      "Odometer miles = ending − opening for each shift. Tracked = the app's GPS miles (incl. filled-in). " +
      (missing ? '<strong style="color:#ff8a80">' + missing + " day(s) missing an ending odometer.</strong> " : "") +
      '<button type="button" class="btn btn-ghost" id="daily-miles-csv">Download CSV</button></p>';
    var byDate = {};
    var order = [];
    rows.forEach(function (r) { if (!byDate[r.date]) { byDate[r.date] = []; order.push(r.date); } byDate[r.date].push(r); });
    var n1 = function (v) { return v == null ? "—" : esc(Number(v).toLocaleString("en-US")); };
    var body = order.map(function (ymd) {
      return '<p class="dm-date" style="margin:10px 0 4px;color:#f0d48a;font-weight:700">' + esc(ymd) + "</p>" +
        byDate[ymd].map(function (r) {
          var border = r.missingEnd ? "#ff8a80" : (r.openNow ? "#9fd39f" : (r.flags.length ? "#ffc96b" : "rgba(240,212,138,.35)"));
          var endTxt = r.endOdo != null ? n1(r.endOdo)
            : '<strong style="color:' + (r.openNow ? "#9fd39f" : "#ff8a80") + '">' + (r.openNow ? "open" : "MISSING") + "</strong>";
          return '<div class="dm-row' + (r.missingEnd ? " dm-missing" : "") + '" data-date="' + esc(r.date) + '" data-driver-id="' + esc(r.driverId) + '"' +
            ' style="border-left:4px solid ' + border + ';padding:6px 8px;margin:0 0 6px;background:rgba(0,0,0,.18);border-radius:6px;font-size:13px;line-height:1.4">' +
            "<strong>" + esc(r.driver) + "</strong>" + (r.vehicle ? ' <span class="fine">· ' + esc(r.vehicle) + "</span>" : "") + "<br>" +
            "Start odo " + n1(r.startOdo) + " → End odo " + endTxt + "<br>" +
            "<strong>Odometer " + (r.odoMiles == null ? "—" : esc(r.odoMiles.toFixed(1)) + " mi") + "</strong>" +
            " · Tracked " + (r.trackedMiles == null ? "—" : esc(r.trackedMiles.toFixed(1)) + " mi") +
            " · Online " + esc(dmFmtOnline(r.onlineMs)) +
            (r.flags.length ? '<br><span style="color:' + (r.missingEnd ? "#ff8a80" : (r.openNow ? "#9fd39f" : "#ffc96b")) + '">' + (r.openNow ? "" : "⚠ ") + esc(r.flags.join(" · ")) + "</span>" : "") +
            "</div>";
        }).join("");
    }).join("");
    return head + '<div class="dm-list">' + body + "</div>";
  }

  /* ---------- v75 (Oct 13): God Home menu: Vehicle Maintenance + Monthly Goal (v75g: god/goal.js, own password, local only) ----------
     Data: rides/VHCLMNTC/{vehicleId} (God writes via Worker /god/db; hub added in Worker v69.14 draft)
       { year, make, model, plate, driverId, odoOverride:{miles,at,by}, oil:{lastMiles,lastDate,interval},
         rot:{lastMiles,lastDate,interval}, updatedAt }  +  /services/{at}: { kind:"oil"|"rot", date, miles, by, at }
     Current mileage = newest of (driver app shift odometers rides/DRVRMLES/{driverId}) and God override.
     Status: red = overdue, amber = <= 1,000 mi or <= 7 days left, green otherwise. */
  var VM_HUB = "VHCLMNTC", VM_FALLBACK_MPD = 2500 / 7;
  var vm = { list: {}, loaded: false, err: "", screen: "", editId: "" };
  function vmUrl(p) { return baseUrl() + "/rides/" + VM_HUB + (p ? "/" + p : "") + ".json"; }
  function vmLoad() {
    return Promise.race([fetch(vmUrl(""), { cache: "no-store" }), new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timed out after 15 s. Check the connection and tap Home, then reopen.")); }, 15000); })]).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
      .then(function (d) { vm.list = d || {}; vm.loaded = true; vm.err = ""; vmPaint(); })
      .catch(function (e) { vm.err = String(e && e.message || e); vmPaint(); });
  }
  function vmDayMs(ymd) { var p = String(ymd || "").split("-"); return p.length === 3 ? Date.UTC(+p[0], +p[1] - 1, +p[2], 18) : 0; }
  function vmParseDate(s) { /* "2025-11-08" or "11-8-25" / "11/8/2025" */
    s = String(s || "").trim(); if (!s) return 0; var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return Date.UTC(+m[1], +m[2] - 1, +m[3], 18);
    if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/))) { var y = +m[3]; if (y < 100) y += 2000; return Date.UTC(y, +m[1] - 1, +m[2], 18); }
    return 0;
  }
  function vmFmtDate(ms) { try { return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; } }
  function vmN(n) { return n == null || !isFinite(n) ? "\u2014" : Math.round(n).toLocaleString("en-US"); }
  function vmDriverFor(v) { /* assigned driver, else the roster driver whose car model matches */
    if (v.driverId) return String(v.driverId);
    var r = state.roster || {}, hit = "";
    Object.keys(r).forEach(function (id) { var x = r[id] || {}; if (!hit && v.model && String(x.carModel || "").toLowerCase() === String(v.model).toLowerCase() && (!v.make || String(x.carMake || "").toLowerCase() === String(v.make).toLowerCase())) hit = id; });
    return hit;
  }
  function vmOdoHistory(driverId) { /* [{at, odo}] from the driver app's shift odometers */
    var days = (state.miles || {})[driverId] || {}, out = [];
    Object.keys(days).forEach(function (ymd) {
      var row = days[ymd]; if (!row || typeof row !== "object") return; var base = vmDayMs(ymd);
      [row.startOdometer, row.endOdometer, row.priorEndOdometer].forEach(function (o, i) { if (dmNum(o) > 0) out.push({ at: base + i, odo: dmNum(o) }); });
      var sh = row.shifts && typeof row.shifts === "object" ? row.shifts : {};
      Object.keys(sh).forEach(function (k) { var x = sh[k] || {}, at = dmNum(x.shiftStartedAt) || dmNum(k) || base;
        if (dmNum(x.startOdo) > 0) out.push({ at: at, odo: dmNum(x.startOdo) }); if (dmNum(x.endOdo) > 0) out.push({ at: at + 1, odo: dmNum(x.endOdo) }); });
    });
    return out.sort(function (a, b) { return a.odo - b.odo; });
  }
  function vmCalc(v, now) {
    now = now || Date.now();
    var did = vmDriverFor(v), hist = did ? vmOdoHistory(did) : [], app = hist.length ? hist[hist.length - 1] : null;
    var ovr = v.odoOverride && dmNum(v.odoOverride.miles) > 0 ? v.odoOverride : null, cur = null, src = "";
    if (app && (!ovr || app.odo >= dmNum(ovr.miles))) { cur = app.odo; src = "driver app"; }
    else if (ovr) { cur = dmNum(ovr.miles); src = "entered in God mode"; }
    function one(s, defInt) {
      s = s || {}; var interval = dmNum(s.interval) || defInt, last = dmNum(s.lastMiles), lastAt = vmParseDate(s.lastDate);
      if (last == null) return { interval: interval, status: "unknown" };
      var due = last + interval, left = cur != null ? due - cur : null, mpd = null, mpdSrc = "";
      var days = lastAt ? (now - lastAt) / 86400000 : 0;
      if (cur != null && days >= 3 && cur > last) { mpd = (cur - last) / days; mpdSrc = "since last service"; }
      if (mpd == null && hist.length > 1) { var a = hist[0], b = hist[hist.length - 1], dd = Math.max(1, (b.at - a.at) / 86400000); if (b.odo > a.odo) { mpd = (b.odo - a.odo) / dd; mpdSrc = "odometer history"; } }
      if (mpd == null) { mpd = VM_FALLBACK_MPD; mpdSrc = "default 2,500 mi/week"; }
      var dLeft = left != null && mpd > 0 ? left / mpd : null, dueAt = dLeft != null ? now + dLeft * 86400000 : null;
      var status = left == null ? "unknown" : left <= 0 ? "red" : (left <= 1000 || dLeft <= 7) ? "amber" : "green";
      return { interval: interval, last: last, lastAt: lastAt, due: due, left: left, mpd: mpd, mpdSrc: mpdSrc, daysSince: lastAt ? days : null, sinceMiles: cur != null ? cur - last : null, dLeft: dLeft, dueAt: dueAt, status: status };
    }
    return { driverId: did, cur: cur, src: src, oil: one(v.oil, 25000), rot: one(v.rot, 10000) };
  }
  var VM_COL = { green: "#3fae5a", amber: "#f0b429", red: "#e5534b", unknown: "#8a9a8a" };
  function vmBlock(label, c) {
    if (c.status === "unknown") return '<div class="vm-blk"><b>' + label + '</b><div class="fine">No last-service miles yet. Tap Edit to enter them.</div></div>';
    var word = c.status === "red" ? "OVERDUE by " + vmN(-c.left) + " mi" : c.status === "amber" ? "DUE SOON" : "OK";
    return '<div class="vm-blk" style="border-left:6px solid ' + VM_COL[c.status] + ';padding-left:10px;margin:8px 0">' +
      '<b>' + label + '</b> <span style="background:' + VM_COL[c.status] + ';color:#0b1f0b;border-radius:10px;padding:1px 8px;font-weight:800;font-size:12px">' + word + "</span>" +
      '<div class="fine">Last ' + vmN(c.last) + " mi" + (c.lastAt ? " on " + esc(vmFmtDate(c.lastAt)) + " (" + vmN(c.daysSince) + " days ago)" : "") + " \u00b7 every " + vmN(c.interval) + " mi \u00b7 due at <b>" + vmN(c.due) + " mi</b></div>" +
      '<div class="fine">Miles left <b>' + vmN(c.left) + "</b> \u00b7 driven since " + vmN(c.sinceMiles) + " \u00b7 avg " + vmN(c.mpd) + " mi/day (" + esc(c.mpdSrc) + ")</div>" +
      '<div class="fine">Est. ' + (c.dLeft != null ? (c.dLeft <= 0 ? "now" : vmN(c.dLeft) + " days") : "\u2014") + " \u00b7 due date <b>" + (c.dueAt ? esc(vmFmtDate(c.dueAt)) : "\u2014") + "</b></div></div>";
  }
  function vmName(v) { return [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"; }
  function vmDriverName(id) { var r = (state.roster || {})[id] || {}; return r.name || id || ""; }
  function vmListHtml() {
    var ids = Object.keys(vm.list || {}).sort(function (a, b) { return vmName(vm.list[a]).localeCompare(vmName(vm.list[b])); });
    var h = '<p class="fine">Oil and tire rotation countdowns for every PCS vehicle. Current miles come from the driver app\'s shift odometer readings (or the miles you enter). Amber = 1,000 mi or 7 days left; red = overdue. The assigned driver sees a heads-up banner in the driver app at amber and red.</p>' +
      '<p><button type="button" class="btn btn-gold" data-vm-edit="__new">+ Add vehicle</button></p>';
    if (vm.err) h += '<p class="fine" style="color:#ff9b9b">Could not load vehicles: ' + esc(vm.err) + "</p>";
    if (!ids.length && vm.loaded) h += '<p class="fine">No vehicles yet.</p>';
    ids.forEach(function (id) {
      var v = vm.list[id] || {}, c = vmCalc(v), worst = [c.oil.status, c.rot.status].indexOf("red") >= 0 ? "red" : [c.oil.status, c.rot.status].indexOf("amber") >= 0 ? "amber" : "green";
      h += '<div class="vm-card" style="border:1px solid #2e5a2e;border-top:4px solid ' + VM_COL[worst] + ';border-radius:12px;padding:12px;margin:12px 0;background:#102810">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b style="font-size:17px">' + esc(vmName(v)) + "</b>" + (v.plate ? ' <span class="fine">\u00b7 ' + esc(v.plate) + "</span>" : "") +
        '<div class="fine">Driver: ' + esc(c.driverId ? vmDriverName(c.driverId) + (v.driverId ? "" : " (matched by car)") : "not assigned") + "</div>" +
        '<div>Current <b>' + vmN(c.cur) + " mi</b> " + (c.src ? '<span class="fine">(' + esc(c.src) + ")</span>" : "") + "</div></div>" +
        '<div><button type="button" class="btn btn-ghost" data-vm-edit="' + esc(id) + '">Edit</button></div></div>' +
        vmBlock("Oil change", c.oil) + '<button type="button" class="btn btn-gold" data-vm-done="oil" data-vm-id="' + esc(id) + '">Mark oil change done</button>' +
        vmBlock("Tire rotation", c.rot) + '<button type="button" class="btn btn-gold" data-vm-done="rot" data-vm-id="' + esc(id) + '">Mark rotation done</button>' +
        vmHistHtml(v) + "</div>";
    });
    return h;
  }
  function vmHistHtml(v) {
    var s = v.services || {}, ks = Object.keys(s).sort().reverse().slice(0, 6);
    if (!ks.length) return "";
    return '<details style="margin-top:8px"><summary class="fine">Service log (' + Object.keys(s).length + ")</summary>" + ks.map(function (k) { var x = s[k] || {};
      return '<div class="fine">' + esc(x.date || "") + " \u00b7 " + (x.kind === "oil" ? "Oil change" : "Tire rotation") + " at " + vmN(dmNum(x.miles)) + " mi" + (x.by ? " \u00b7 " + esc(x.by) : "") + "</div>"; }).join("") + "</details>";
  }
  function vmFormHtml(id) {
    var v = id === "__new" ? {} : (vm.list[id] || {}), o = v.oil || {}, r = v.rot || {}, ro = state.roster || {};
    function f(name, label, val, type) { return '<label style="display:block;margin:6px 0"><span class="fine">' + label + '</span><br><input name="' + name + '" type="' + (type === "number" ? "text" : (type || "text")) + '"' + (type === "number" ? ' inputmode="numeric" pattern="[0-9]*" autocomplete="off"' : "") + ' value="' + esc(val == null ? "" : val) + '" style="width:100%;max-width:260px"></label>'; }
    var opts = '<option value="">(match by car / none)</option>' + Object.keys(ro).map(function (k) { return '<option value="' + esc(k) + '"' + (v.driverId === k ? " selected" : "") + ">" + esc(ro[k].name || k) + "</option>"; }).join("");
    return '<form id="vm-form" data-vm-id="' + esc(id) + '"><h3 style="margin:4px 0">' + (id === "__new" ? "Add vehicle" : "Edit " + esc(vmName(v))) + "</h3>" +
      f("year", "Year", v.year) + f("make", "Make", v.make) + f("model", "Model", v.model) + f("plate", "Plate (optional)", v.plate) +
      '<label style="display:block;margin:6px 0"><span class="fine">Assigned driver</span><br><select name="driverId">' + opts + "</select></label>" +
      f("odo", "Current mileage override (leave blank to use the driver app)", v.odoOverride && v.odoOverride.miles, "number") +
      "<h4>Oil change</h4>" + f("oilMiles", "Last oil change miles", o.lastMiles, "number") + f("oilDate", "Last oil change date", o.lastDate, "date") + f("oilInt", "Interval (miles)", o.interval || 25000, "number") +
      "<h4>Tire rotation</h4>" + f("rotMiles", "Last rotation miles", r.lastMiles, "number") + f("rotDate", "Last rotation date", r.lastDate, "date") + f("rotInt", "Interval (miles)", r.interval || 10000, "number") +
      '<p><button type="submit" class="btn btn-gold">Save</button> <button type="button" class="btn btn-ghost" data-vm-cancel="1">Cancel</button></p><p class="fine" id="vm-form-err"></p></form>';
  }
  function vmNum(x) { x = String(x == null ? "" : x).replace(/[,\s]/g, ""); return x && isFinite(Number(x)) ? Math.round(Number(x)) : null; }
  function vmSave(id, rec) {
    return godFetch(vmUrl(encodeURIComponent(id)), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) })
      .then(function (res) { if (!res.ok) throw new Error(state.boardNotice || "Not saved"); return vmLoad(); });
  }
  function vmPaint() {
    var el = document.getElementById("vm-screen-body"); if (!el || vm.screen !== "maint") return;
    el.innerHTML = vm.editId ? vmFormHtml(vm.editId) : vmListHtml();
  }
  function vmOpen(which) {
    vm.screen = which; vm.editId = "";
    var ov = document.getElementById("vm-screen"); if (ov) ov.remove();
    ov = document.createElement("div"); ov.id = "vm-screen";
    ov.style.cssText = "position:fixed;inset:0;z-index:9000;background:#0b1f0b;color:#eef5ee;overflow:auto;padding:max(40px, calc(12px + env(safe-area-inset-top))) max(16px, env(safe-area-inset-right)) 60px max(16px, env(safe-area-inset-left));-webkit-overflow-scrolling:touch"; /* clear of iPad Stage Manager dots */
    ov.innerHTML = '<div style="max-width:760px;margin:0 auto"><p style="text-align:right"><button type="button" class="btn btn-ghost" data-vm-close="1" style="min-height:44px;min-width:88px">\u2190 Home</button></p>' +
      '<h2 style="margin:6px 0 10px;color:#f0d48a">' + "Vehicle Maintenance" + "</h2>" +
      '<div id="vm-screen-body">' + '<p class="fine">Loading\u2026</p>' + "</div></div>";
    document.body.appendChild(ov);
    if (which === "maint") { vmPaint(); vmLoad(); }
    ov.addEventListener("click", vmClick);
    ov.addEventListener("submit", vmSubmit);
  }
  function vmClick(e) {
    var t = e.target.closest ? e.target.closest("button") : null; if (!t) return;
    if (t.getAttribute("data-vm-close")) { vm.screen = ""; var ov = document.getElementById("vm-screen"); if (ov) ov.remove(); return; }
    if (t.getAttribute("data-vm-edit")) { vm.editId = t.getAttribute("data-vm-edit"); vmPaint(); return; }
    if (t.getAttribute("data-vm-cancel")) { vm.editId = ""; vmPaint(); return; }
    var kind = t.getAttribute("data-vm-done");
    if (kind) {
      var id = t.getAttribute("data-vm-id"), v = vm.list[id] || {}, c = vmCalc(v);
      var miles = vmNum(window.prompt((kind === "oil" ? "Oil change" : "Tire rotation") + " done at what mileage?", c.cur != null ? String(Math.round(c.cur)) : ""));
      if (!(miles > 0)) return;
      var date = (window.prompt("Date done (YYYY-MM-DD):", chicagoToday()) || "").trim(); if (!vmParseDate(date)) { alert("Date not recognized."); return; }
      var now = Date.now(), patch = {}, sv = v[kind] || {};
      patch[kind] = { lastMiles: miles, lastDate: date, interval: dmNum(sv.interval) || (kind === "oil" ? 25000 : 10000) };
      patch["services/" + now] = { kind: kind, date: date, miles: miles, by: godWho(), at: now };
      patch["alerts/" + kind] = null; patch.updatedAt = now;
      vmSave(id, patch).catch(function (er) { alert(String(er.message || er)); });
    }
  }
  function vmSubmit(e) {
    e.preventDefault(); var f = e.target, id = f.getAttribute("data-vm-id"), err = document.getElementById("vm-form-err");
    if (!f.model.value.trim()) { err.textContent = "Enter at least the model."; return; }
    if (id === "__new") id = ("v" + (f.year.value || "") + "-" + f.make.value + "-" + f.model.value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 60) + "-" + Date.now().toString(36);
    var old = vm.list[id] || {}, odo = vmNum(f.odo.value), now = Date.now();
    var rec = { year: f.year.value.trim(), make: f.make.value.trim(), model: f.model.value.trim(), plate: f.plate.value.trim(), driverId: f.driverId.value,
      oil: { lastMiles: vmNum(f.oilMiles.value), lastDate: f.oilDate.value || "", interval: vmNum(f.oilInt.value) || 25000 },
      rot: { lastMiles: vmNum(f.rotMiles.value), lastDate: f.rotDate.value || "", interval: vmNum(f.rotInt.value) || 10000 }, updatedAt: now };
    var prevO = old.odoOverride && dmNum(old.odoOverride.miles);
    rec.odoOverride = odo > 0 ? (odo === prevO ? old.odoOverride : { miles: odo, at: now, by: godWho() }) : null;
    err.textContent = "Saving\u2026";
    vmSave(id, rec).then(function () { vm.editId = ""; vmPaint(); }).catch(function (er) { err.textContent = String(er.message || er); });
  }
  function vmHomeMenuHtml() {
    var b = "display:block;width:100%;text-align:left;margin:6px 0;padding:12px 14px;border:2px solid #d4af37;border-radius:12px;background:transparent;color:#f0d48a;font-weight:800;font-size:16px;cursor:pointer";
    return '<section class="side-section" id="god-home-menu"><h2>Home</h2>' +
      '<button type="button" style="' + b + '" data-god-menu="maint">\uD83D\uDD27 Vehicle Maintenance</button>' +
      '<button type="button" style="' + b + '" data-god-menu="goal">\uD83D\uDCB0 Monthly Goal</button>' + /* v75g: goal.js, own password/PIN, local only */
      '</section>';
  }
  document.addEventListener("click", function (e) { var t = e.target.closest ? e.target.closest("[data-god-menu]") : null; if (!t) return;
    var which = t.getAttribute("data-god-menu");
    if (which === "goal") { /* v75i: Monthly Goal is goal.js's own panel, never the maintenance overlay */
      if (document.getElementById("gl-screen")) return;
      if (typeof window.__pcsGoalOpen === "function") window.__pcsGoalOpen(); else alert("Monthly Goal did not load. Close and reopen God mode.");
      return; }
    if (which === "maint") vmOpen("maint"); });
  window.__pcsVmCalc = vmCalc; /* test hook */
  window.__pcsVmOpen = vmOpen;

  function refreshDailyMiles() {
    var el = document.getElementById("daily-miles-list");
    if (!el) return;
    var html = dailyMilesPanelHtml();
    var sig = String(html.length) + ":" + hashStr(html);
    if (el.getAttribute("data-html-sig") === sig) return;
    el.innerHTML = html;
    el.setAttribute("data-html-sig", sig);
    var btn = document.getElementById("daily-miles-csv");
    if (btn) btn.addEventListener("click", function () {
      var csv = dailyMilesCsv(dailyMilesRowsNow());
      try {
        var blob = new Blob([csv], { type: "text/csv" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "pcs-daily-miles-" + chicagoToday() + ".csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      } catch (e) {}
    });
  }

  window.__pcsGodDailyMiles = { compute: dailyMilesCompute, csv: dailyMilesCsv };

  /* ---------- v72d: God-only "Add ride" manual entry (Oct 9) ----------
     FULL manual authority: every field is editable; calculations only PREFILL fields Matthew hasn't typed in.
     Saves a normal scheduled ride on /rides/PCSCALND/{id} (same hub + assign path as the day board), assigned to the
     chosen driver: driver app "Scheduled for you", God board, and when status = completed a /rides/DRVRHSTY/{driver}/{code}
     entry (cents) that counts toward commission and the Mon–Sun pay week. Edit / delete after saving, each with an audit note.
     Delete is a soft delete (status "deleted", kept for the audit trail; pay-week entry removed). */
  var ADD_RIDE_PAY = [["square", "Card (Square)"], ["cash", "Cash (driver collects)"], ["card_failed", "Card failed - collect"], ["prepaid", "Prepaid"], ["invoice", "Invoice"], ["account", "Account (billed to account)"]]; /* v74b: Account */
  function arCollects(pm) { return pm === "cash" || pm === "card_failed"; }
  var ADD_RIDE_STATUS = [["assigned", "Assigned (upcoming)"], ["completed", "Completed"], ["cancelled", "Cancelled"]];
  var AR_DERIVED = ["total", "commission", "balance"];

  /* v72d cash rule: on a CASH ride the driver holds the money, so the driver OWES Matthew everything except his
     commission: fare total (incl. taxes/fees) - commission (= 30% of the fare + taxes/fees at 70%). Card/other rides:
     Matthew owes the driver commission + tip. Net per driver = owed to driver - owed by driver. */
  /* Card failed - collect: a declined card flips the ride like cash (driver collects from the rider and owes PCS
     30% + taxes). Auto when the pay-week entry says paymentStatus failed; God's cardFailedCollect true/false overrides. */
  function isCardFailedCollect(e) {
    if (!e) return false;
    if (e.cardFailedCollect === true || e.cardFailedCollect === false) return e.cardFailedCollect;
    var pm = String(e.payMethod || "").toLowerCase();
    return pm === "card_failed" || String(e.paymentStatus || "").toLowerCase() === "failed";
  }
  function isCashEntry(e) {
    if (!e) return false;
    if (typeof Symbol === "function" && typeof e[Symbol.for("pcsAsCash")] === "boolean") return e[Symbol.for("pcsAsCash")]; /* r6: normalizer's Worker-checked answer */
    if (isCardFailedCollect(e)) return true;
    return String(e.payMethod || "").toLowerCase() === "cash" || String(e.paidVia || "").toLowerCase() === "cash" || e.cashCollected === true;
  }
  function cashDriverOwesCents(e) {
    if (!isCashEntry(e)) return 0;
    /* r5/r6 (Harry r4 N2, r5 F3): always computed from the fare the driver collected: max(fare total, fare + tax) minus the
       re-figured driver share minus tolls the driver paid. The entry's driverOwesCents is never trusted. */
    var o = (typeof payBalance === "function" && payBalance.__orig && payBalance.__orig.get(e)) || e;
    var tot = Math.max(Math.round(Number(o.fareTotal) || 0), Math.round(Number(o.fareSub) || 0) + Math.round(Number(o.fareTax) || 0));
    return Math.max(0, tot - Math.round(Number(e.commissionCents) || 0) - tollReimbCents(e)); /* v76b: the driver keeps the tolls he paid */
  }
  /* v76b: metered-ride tolls. tollCents = real tolls paid back 100% to the driver (outside commission); tollRoadFeeCents =
     "Toll road fee" in Matthew's DV-plate cars (fare income, already inside commissionCents). Shown as their own lines. */
  function tollReimbCents(e) { return e && !(e.isTest === true || String(e.paidVia || "") === "test") ? Math.max(0, Math.round(Number(e.tollCents) || 0)) : 0; }
  function tollFeeCents(e) { return e && !(e.isTest === true || String(e.paidVia || "") === "test") ? Math.max(0, Math.round(Number(e.tollRoadFeeCents) || 0)) : 0; }
  /* r5/r6 (Harry r4 N1-N3, r5 F1-F4/M1): EVERY entry is normalized here before any payout number is shown.
     Inputs are read ONCE per entry object (the first time it is seen) into a WeakMap snapshot; later calls never read the
     entry's own bookkeeping, so forged commissionAppCents / tollAskedCents / driverOwesAppCents etc. do nothing.
     % = Worker KV per-ride override (may exceed 80: Barbara Curry 100%) > Worker-verified invoice % (Symbol from invApply) >
         God per-ride % on the card (max 80) > driver's saved rate (max 80) > 70.
     Fare base = Worker-verified invoice amount, else capped at the Worker charge record (chg:<code>), else at God's set fare
         (fixedFare) or $300 (estimates are not used: too tight for real trips); anything over is HELD (red) until God approves it (KV holdok via the Worker).
     Discount: the pre-discount fare is used only when the discount is a God-set/KV discount or a Worker-recorded driver preset,
         capped at fare + discount; "Driver covers it" takes the discount off the share. Tips untouched (100% driver).
     Tolls paid back: up to $50 + any God-approved amount; the rest held.
     Card vs cash: a ride labelled card/app-paid with no Worker charge record (and no verified invoice) counts as cash owed and is
         red-flagged until God approves "card". Cash owed = max(fare total, fare + tax) - share - tolls paid.
     opts = { driverId, pctFor, kvPct, cards, waitKv, charges, holds, kvDisc, discPresets } */
  function payBalance(entries, opts) {
    opts = opts || {};
    var TOLL_CAP = 5000, FARE_CAP = 30000, TAX = 0.0825;
    var S = function (n) { return Symbol.for(n); }, INV = S("pcsInvPct"), ASCASH = S("pcsAsCash"), HKEY = S("pcsHoldKey");
    var ORIG = payBalance.__orig || (payBalance.__orig = new WeakMap()), used = {};
    function payNormalize(e) {
      if (!e || e.isTest === true || e.testRide === true || String(e.paidVia || "") === "test" || e.testKind) return e;
      var o = ORIG.get(e); if (!o) { o = Object.assign({}, e); ORIG.set(e, o); }
      var card = opts.cards && e.scheduleId ? opts.cards[e.scheduleId] : null;
      var key = String(opts.driverId || "") + "|" + String(o.code || e.code || ""); e[HKEY] = key;
      var ok = function (kind) { var h = opts.holds && opts.holds[key + "|" + kind]; return h && isFinite(+h.cents) ? Math.max(0, Math.round(+h.cents)) : null; };
      var kvp = opts.kvPct && e.scheduleId && Object.prototype.hasOwnProperty.call(opts.kvPct, e.scheduleId) ? opts.kvPct[e.scheduleId] : null;
      var pct = null, src = "";
      delete e.pctCapped;
      if (kvp && isFinite(+kvp.pct)) { pct = Math.min(100, Math.max(0, Math.round(+kvp.pct))); src = "kv"; }
      else if (e[INV] != null) { pct = e[INV]; src = "invoice"; }
      else {
        if (card && card.rideCommissionPct != null && card.rideCommissionPctBy === "god" && isFinite(+card.rideCommissionPct)) { pct = Math.round(+card.rideCommissionPct); src = "ride"; }
        else if (typeof opts.pctFor === "function" && opts.driverId) { pct = Number(opts.pctFor(opts.driverId)); src = "rate"; }
        if (pct == null || !isFinite(pct)) { pct = typeof DEFAULT_COMMISSION_PCT !== "undefined" ? DEFAULT_COMMISSION_PCT : 70; src = "default"; }
        if (pct > 80) { e.pctCapped = { asked: pct }; pct = 80; }
        pct = Math.max(0, pct);
      }
      /* charge record: bound to this driver, one entry per charge per payout list (r7) */
      var holds = {}, chg = opts.charges && o.code ? opts.charges[o.code] : null;
      if (chg && !chg.driverId) { holds.driver = true; chg = null; delete e.chargeWrongDriver; } /* r8: charge with no confirmed driver -> held until God confirms */
      else if (chg && !(opts.driverId && chg.driverId === opts.driverId)) { e.chargeWrongDriver = true; chg = null; } else delete e.chargeWrongDriver;
      if (chg) { if (used[o.code] && used[o.code] !== e) { e.dupSuspect = o.code; holds.dup = true; chg = null; } else used[o.code] = e; }
      /* discount: the AMOUNT comes only from the Worker (God KV discount or a Worker-recorded driver preset) (r7) */
      var sub0 = Math.max(0, Math.round(Number(e[INV] != null ? e.fareSub : o.fareSub) || 0)), disc = 0;
      var kd = opts.kvDisc && e.scheduleId ? opts.kvDisc[e.scheduleId] : null, pr = opts.discPresets && o.code ? opts.discPresets[o.code] : null, dd = kd && kd.d && typeof kd.d === "object" ? kd.d : null;
      if (dd) {
        var dp = dd.type === "military" || dd.type === "senior" ? 10 : (Number(dd.pct) > 0 && Number(dd.pct) <= 50 ? Number(dd.pct) : 0);
        if (Number(dd.cents) > 0) disc = Math.round(Number(dd.cents)); else if (dp) disc = Math.round(sub0 / (1 - dp / 100)) - sub0;
      } else if (pr && (pr.preset === "military" || pr.preset === "senior")) disc = Math.round(sub0 / 0.9) - sub0;
      if (Math.round(Number(o.discountCents) || 0) > 0 && !disc) e.discountUnconfirmed = true; else delete e.discountUnconfirmed;
      var driverCovers = !!(dd && dd.driverCovers === true);
      /* fare cap applies to the pre-discount fare (r7) */
      var grossAsk = sub0 + disc, gross = grossAsk, fareSrc = e[INV] != null ? "invoice" : "logged";
      if (e[INV] == null) {
        var cap = FARE_CAP;
        if (chg) { cap = Math.round((Number(chg.fareCents) || 0) / (1 + TAX)) + 1 + disc; fareSrc = "charge"; }
        else if (card && card.fixedFare === true && isFinite(+card.fareBeforeTax) && +card.fareBeforeTax > 0) { cap = Math.round(+card.fareBeforeTax * 100) + disc; fareSrc = "god_fare"; }
        if (grossAsk > cap) { var fo = ok("fare"), extra = Math.min(grossAsk - cap, fo || 0); gross = cap + extra; if (gross < grossAsk) holds.fare = grossAsk - gross; }
      }
      var sub = Math.max(0, gross - disc);
      e.fareSub = sub;
      /* tolls */
      var tollAsk = Math.max(0, Math.round(Number(o.tollCents) || 0)), tCap = TOLL_CAP + (ok("toll") || 0);
      e.tollCents = Math.min(tollAsk, tCap); if (tollAsk > tCap) holds.toll = tollAsk - tCap;
      var base = Math.max(0, gross - Math.min(tollAsk, gross));
      var com = Math.round(base * pct / 100);
      if (disc > 0 && driverCovers) com = Math.max(0, com - disc); /* "Driver covers it" from the Worker's discount record only */
      var appCom = Math.round(Number(o.commissionCents) || 0);
      if (Math.abs(appCom - com) > 1) e.commissionAdjusted = { app: appCom, now: com }; else delete e.commissionAdjusted;
      e.commissionCents = com; e.commissionPct = pct; e.pctSource = src; e.fareSource = fareSrc === "invoice" ? "square_invoice" : fareSrc;
      if (fareSrc === "logged" || fareSrc === "estimate") e.fareUnverified = true; else delete e.fareUnverified;
      /* PCS-collected only with proof (r7, fail closed): a Worker charge record for this driver, a Worker-verified invoice, or
         God's "pcs_collected" approval (Zelle / check / card / other paid to PCS; legacy "card" approval counts). Cash rides stay
         cash; everything else (blank, unknown words, "square_invoice" without the Worker record) = cash owed + red hold. */
      var asCash = isCashEntry(o);
      var proof = !!chg || e[INV] != null || ok("pcs_collected") != null || ok("card") != null;
      if (!asCash && !proof) { asCash = true; holds.collect = true; }
      if (holds.dup) asCash = true;
      e[ASCASH] = asCash;
      if (asCash) {
        var tot = Math.max(Math.round(Number(o.fareTotal) || 0), Math.round(Number(o.fareSub) || 0) + Math.round(Number(o.fareTax) || 0));
        var owe = Math.max(0, tot - com - e.tollCents);
        if (o.driverOwesCents != null && Math.abs(Math.round(Number(o.driverOwesCents) || 0) - owe) > 1) e.owedAdjusted = { app: Math.round(Number(o.driverOwesCents) || 0), now: owe }; else delete e.owedAdjusted;
        e.driverOwesCents = owe;
      }
      if (holds.fare || holds.toll || holds.collect || holds.dup || holds.driver) e.held = holds; else delete e.held;
      if (holds.toll) e.tollHeld = holds.toll; else delete e.tollHeld;
      return e;
    }
    var out = { owedToDriver: 0, owedByDriver: 0, net: 0, cashRides: 0, cashTips: 0, tolls: 0, tollRoadFees: 0, tollsHeld: 0, heldCents: 0, held: 0, flagged: 0, loading: false };
    if (opts.waitKv && typeof state !== "undefined" && (!state.ridePctLoaded || !state.payRecLoaded)) out.loading = true;
    (entries || []).forEach(function (e) {
      if (e && (e.isTest === true || e.testRide === true || String(e.paidVia || "") === "test" || e.testKind)) return; /* v76d: test rides count for nothing (same as isTestRide) */
      payNormalize(e);
      /* v72s: cash tips are the driver's own money (100% kept, not part of the 30% owed, not fare): record only */
      if (isCashEntry(e)) { out.owedByDriver += cashDriverOwesCents(e); out.cashRides += 1; out.cashTips += Number(e.tipCents) || 0; }
      else out.owedToDriver += (Number(e.commissionCents) || 0) + (Number(e.tipCents) || 0) + tollReimbCents(e); /* v76b: + tolls paid back */
      out.tolls += tollReimbCents(e); out.tollRoadFees += tollFeeCents(e); out.tollsHeld += Number(e.tollHeld) || 0;
      if (e.held) { out.held += 1; out.heldCents += (e.held.fare || 0) + (e.held.toll || 0); }
      if (e.pctCapped || e.commissionAdjusted || e.owedAdjusted || e.held || e.invoiceMismatch || e.dupSuspect || e.invoiceWrongDriver || e.discountUnconfirmed) out.flagged += 1;
    });
    out.net = out.owedToDriver - out.owedByDriver;
    return out;
  }
  function payNetText(b) {
    if (b && b.loading) return "Loading ride % and payment records… (payout shows when they are loaded)"; /* r5/r6 */
    return b.net >= 0 ? "PCS owes driver " + fmtCents(b.net) : "Driver owes PCS " + fmtCents(-b.net);
  }

  function addRideNewId(now) {
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var rnd = "";
    var i;
    for (i = 0; i < 6; i += 1) rnd += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return "manual-" + String(now || Date.now()) + "-" + rnd;
  }

  function addRideCode() {
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var out = "M";
    while (out.length < 8) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return out;
  }

  /* "2026-10-09" + "19:30" (Chicago wall time) -> ISO with the right offset (CDT -05:00 / CST -06:00). */
  function addRideChicagoIso(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^\d{2}:\d{2}$/.test(String(time || ""))) return "";
    var guess = new Date(date + "T" + time + ":00-06:00");
    var parts = {};
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(guess).forEach(function (p) { if (p.type !== "literal") parts[p.type] = p.value; });
    var hh = parts.hour === "24" ? "00" : parts.hour;
    var off = (hh + ":" + parts.minute) === time && (parts.year + "-" + parts.month + "-" + parts.day) === date ? "-06:00" : "-05:00";
    return date + "T" + time + ":00" + off;
  }

  function arNum(v) {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    var n = Number(String(v).replace(/[$,%\s]/g, ""));
    return isFinite(n) ? n : NaN;
  }
  function ar2(n) { return Math.round(n * 100) / 100; }

  /* Pure: fill the derived fields (total, commission, balance) from fare / discount / tax / % / payment, but ONLY the
     ones not in `touched` (Matthew's typed values always win). Returns a new draft. */
  function addRidePrefill(d, touched, defaultPct) {
    d = Object.assign({}, d || {});
    touched = touched || {};
    if (!touched.commissionPct && (d.commissionPct == null || d.commissionPct === "")) d.commissionPct = String(defaultPct != null ? defaultPct : 70);
    var fare0 = arNum(d.fare);
    if (fare0 != null && !isNaN(fare0) && fare0 > 0) { /* v73: Discount (%) <-> Discount ($), whichever Matthew typed last */
      if (touched.discMode === "pct") { var dp = arNum(d.discountPct); if (dp != null && !isNaN(dp)) d.discount = ar2(fare0 * Math.min(100, Math.max(0, dp)) / 100).toFixed(2); }
      else if (touched.discMode === "usd") { var du = arNum(d.discount); if (du != null && !isNaN(du)) d.discountPct = String(Math.round(du / fare0 * 10000) / 100); }
    }
    var fare = arNum(d.fare), disc = arNum(d.discount) || 0, tax = arNum(d.taxFees) || 0, pct = arNum(d.commissionPct);
    if (fare == null || isNaN(fare) || isNaN(disc) || isNaN(tax) || pct == null || isNaN(pct)) return d;
    var net = ar2(fare - disc);
    var total = ar2(net + tax);
    var commission = ar2(net * pct / 100);
    if (!touched.total) d.total = total.toFixed(2);
    if (!touched.commission) d.commission = commission.toFixed(2);
    var t = arNum(d.total), c = arNum(d.commission);
    /* collect (cash / card failed): PCS share = (100 - %) of the fare, rounded, + all taxes/fees (Brian example: 48.89 + 13.44 = 62.33).
       If Matthew typed his own total or commission, use total - commission instead. */
    var share = touched.total || touched.commission ? ar2((isNaN(t) ? total : t) - (isNaN(c) ? commission : c)) : ar2(ar2(net * (100 - pct) / 100) + tax);
    if (!touched.balance) d.balance = arCollects(d.payMethod) ? share.toFixed(2) : (isNaN(c) ? commission : c).toFixed(2);
    return d;
  }

  /* Pure: validate + build the PCSCALND row from Matthew's values (no recalculation). prev = row being edited. */
  function addRideBuild(f, drivers, now, prev) {
    f = f || {};
    now = now || Date.now();
    var driver = null;
    (drivers || []).forEach(function (d) { if (d && d.id === f.driverId) driver = d; });
    if (!driver && prev && prev.assignedDriverId === f.driverId) driver = { id: prev.assignedDriverId, name: prev.assignedDriverName };
    if (!driver) return { ok: false, error: "Pick a driver." };
    var name = String(f.name || "").trim().slice(0, 200);
    if (!name) return { ok: false, error: "Enter the client's name." };
    var phone = String(f.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
    if (phone && cphNorm(phone)) phone = cphNorm(phone); /* v77.3 */
    var pickup = String(f.pickup || "").trim().slice(0, 400);
    var dropoff = String(f.dropoff || "").trim().slice(0, 400);
    if (!pickup || !dropoff) return { ok: false, error: "Enter pickup and drop-off." };
    var stops = String(f.stops || "").split(/\n/).map(function (s) { return s.trim().slice(0, 400); }).filter(Boolean).slice(0, 5);
    var start = addRideChicagoIso(f.date, f.time);
    if (!start) return { ok: false, error: "Enter the date and time." };
    var pay = String(f.payMethod || "");
    if (!ADD_RIDE_PAY.some(function (p) { return p[0] === pay; })) return { ok: false, error: "Pick a payment method (cash or card)." };
    var status = String(f.status || "assigned");
    if (!ADD_RIDE_STATUS.some(function (p) { return p[0] === status; })) return { ok: false, error: "Pick a status." };
    var nums = {};
    var spec = [["fare", "Fare", true], ["discount", "Discount"], ["taxFees", "Tax / fees"], ["total", "Total", true],
      ["commissionPct", "Commission %", true], ["commission", "Driver commission", true], ["balance", arCollects(pay) ? "Driver owes" : "Owed to driver", true]];
    for (var i = 0; i < spec.length; i += 1) {
      var v = arNum(f[spec[i][0]]);
      if (v == null) { if (spec[i][2]) return { ok: false, error: spec[i][1] + " is empty." }; v = 0; }
      if (isNaN(v)) return { ok: false, error: spec[i][1] + " must be a number." };
      if (v < 0 || v > 100000) return { ok: false, error: spec[i][1] + " is out of range." };
      nums[spec[i][0]] = ar2(v);
    }
    var notes = String(f.notes || "").trim().slice(0, 2000);
    var pp = prepaidPatch(f.prepaid === true || f.prepaid === "true", f.prepaidAmount, f.prepaidInvoiceNo, now, "god"); /* v75v */
    if (!pp.ok) return { ok: false, error: pp.error };
    if (!pp.patch.prepaid && !(prev && prev.prepaid)) pp.patch = {};
    var row = Object.assign({}, prev || {}, pp.patch, {
      id: (prev && prev.id) || addRideNewId(now),
      source: "manual",
      title: "PCS – " + name,
      rider: name, riderPhone: phone, riderPhoneEdited: !!phone || !!(prev && prev.riderPhoneEdited), /* v77.3: sync never overwrites it */
      pickup: pickup, dropoff: dropoff, stops: stops,
      start: start, end: "",
      description: (stops.length ? "Stops: " + stops.join(" | ") + "\n" : "") + (notes ? "Notes: " + notes : ""),
      notes: notes,
      fareBeforeTax: ar2(nums.fare - nums.discount), /* day board / driver app read this */
      fare: nums.fare, discount: nums.discount, taxFees: nums.taxFees, total: nums.total,
      discountPct: nums.fare > 0 ? Math.round(nums.discount / nums.fare * 10000) / 100 : 0, /* v73 */
      pickupLat: isFinite(+f.pickupLat) && f.pickupLat !== "" && f.pickupLat != null ? +f.pickupLat : null, pickupLng: isFinite(+f.pickupLng) && f.pickupLng != null && f.pickupLng !== "" ? +f.pickupLng : null,
      dropoffLat: isFinite(+f.dropoffLat) && f.dropoffLat != null && f.dropoffLat !== "" ? +f.dropoffLat : null, dropoffLng: isFinite(+f.dropoffLng) && f.dropoffLng != null && f.dropoffLng !== "" ? +f.dropoffLng : null,
      stopsGeo: Array.isArray(f.stopsArr) ? f.stopsArr.filter(function (x) { return x && String(x.text || "").trim(); }).slice(0, 5).map(function (x) { return { address: String(x.text).trim().slice(0, 400), lat: isFinite(+x.lat) && x.lat != null ? +x.lat : null, lng: isFinite(+x.lng) && x.lng != null ? +x.lng : null }; }) : [],
      commissionPct: nums.commissionPct, commissionDollars: nums.commission,
      balance: nums.balance, balanceDir: arCollects(pay) ? "driver_owes" : "owed_to_driver",
      flatPrice: !!f.flat,
      payMethod: pay,
      assignedDriverId: driver.id, assignedDriverName: driver.name || driver.id,
      status: status,
      code: (prev && prev.code) || addRideCode(),
      createdBy: (prev && prev.createdBy) || "god",
      createdAt: (prev && prev.createdAt) || now,
      updatedAt: now
    });
    if ([f.ovBase, f.ovPerMile, f.ovFlat].some(function (x) { return String(x == null ? "" : x).trim() !== ""; })) { /* v76j */
      var rov = rateOvPatch(f.ovBase, f.ovPerMile, f.ovFlat, now, "god"); if (!rov.ok) return { ok: false, error: "Rate override: " + rov.error };
      row.rateOverride = rov.patch.rateOverride; row.rateOverrideCleared = false;
    } else if (prev && prev.rateOverride) { row.rateOverride = null; row.rateOverrideCleared = true; }
    if (status === "completed") {
      row.completedAt = (prev && prev.completedAt) || now;
      row.commissionCents = Math.round(nums.commission * 100);
    } else { delete row.completedAt; row.commissionCents = null; }
    return { ok: true, row: row };
  }

  /* Pure: the DRVRHSTY entry for a completed manual ride, straight from the row (cents, no recalculation). */
  function addRideHistoryEntry(row, now) {
    var cash = arCollects(row.payMethod);
    var c = Math.round((Number(row.commissionDollars) || 0) * 100);
    var bal = Math.round((Number(row.balance) || 0) * 100);
    return {
      code: row.code,
      day: boardDayKey(row.start) || chicagoToday(),
      completedAt: row.completedAt || now || Date.now(),
      when: fmtBoardWhen(row.start),
      pickup: row.pickup || "", drop: row.dropoff || "",
      rawMiles: null, billedMiles: null,
      fareSub: Math.round((Number(row.fareBeforeTax) || 0) * 100),
      discountCents: Math.round((Number(row.discount) || 0) * 100),
      fareTax: Math.round((Number(row.taxFees) || 0) * 100),
      fareTotal: Math.round((Number(row.total) || 0) * 100),
      commissionPct: Number(row.commissionPct) || 0,
      commissionCents: cash ? c : bal, /* card: Matthew's "owed to driver" value is what the week pays */
      riderName: row.rider || "",
      payMethod: row.payMethod || "",
      cashCollected: row.payMethod === "cash",
      cardFailedCollect: row.payMethod === "card_failed",
      driverOwesCents: cash ? bal : 0,
      manual: true,
      source: "manual"
    };
  }

  function arAudit(prev, note, action, now) {
    var log = Array.isArray(prev && prev.audit) ? prev.audit.slice(-49) : [];
    log.push({ at: now, by: state.sessionEmail || "god", action: action, note: String(note || "").slice(0, 500) });
    return log;
  }

  function arHistoryPut(driverId, code, entry) {
    return godFetch(historyUrl(driverId, code), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) })
      .then(function (res) { if (!res.ok) throw new Error("Saved the ride, but the pay-week entry failed."); });
  }
  function arHistoryDelete(driverId, code) {
    if (!driverId || !code) return Promise.resolve();
    return godFetch(historyUrl(driverId, code), { method: "DELETE" }).then(function (res) { if (!res.ok) throw new Error("Could not remove the old pay-week entry."); });
  }

  function arDriverChoices(includeId) {
    var list = approvedDriversForAssign().slice();
    if (includeId && !list.some(function (d) { return d.id === includeId; })) {
      knownDriverRows().forEach(function (d) { if (d && d.id === includeId) list.push(d); });
    }
    return list;
  }

  function arFindRow(id) {
    var row = null;
    (state.calendar || []).forEach(function (r) { if (r && r.id === id) row = r; });
    return row;
  }

  function addRideSave(f) {
    var editId = state.addRideEditId || "";
    var prevNorm = editId ? arFindRow(editId) : null;
    var prev = editId ? Object.assign({}, (state.addRideRaw && state.addRideRaw[editId]) || prevNorm || {}) : null;
    if (editId && !String(f.audit || "").trim()) return Promise.reject(new Error("Add an audit note saying what you changed and why."));
    var past = !editId && state.addRidePast ? state.addRidePast : "";
    if (past) { var pe = pastRideCheck(f, past, chicagoToday()); if (pe) return Promise.reject(new Error(pe)); f = Object.assign({}, f, { status: "completed" }); }
    var now = Date.now();
    var built = addRideBuild(f, arDriverChoices(f.driverId), now, prev);
    if (!built.ok) return Promise.reject(new Error(built.error));
    var row = built.row;
    if (past) { row.backdated = true; row.backdatedAt = now; row.payWeek = past; }
    row.audit = arAudit(prev, editId ? f.audit : past ? "Past ride added (backdated) to pay week " + past + (f.audit ? ": " + f.audit : "") : (f.audit || "created"), editId ? "edit" : past ? "backdate" : "create", now);
    var wasDone = prev && prev.status === "completed";
    var steps = Promise.resolve();
    if (wasDone && (row.status !== "completed" || prev.assignedDriverId !== row.assignedDriverId)) {
      steps = steps.then(function () { return arHistoryDelete(prev.assignedDriverId, prev.code); });
    }
    return steps.then(function () { return putCalendarRide(row); }).then(function () {
      /* v73: read it back; a refused write must not look saved (Brian Gipson Oct 9 never reached the database) */
      return fetch(calendarUrl(row.id), { cache: "no-store" }).then(function (res) { return res.ok ? res.json() : null; }).then(function (back) {
        if (!back || back.code !== row.code) throw new Error("Not saved: the database did not keep this ride. Nothing changed. Try again or tell support.");
      });
    }).then(function () {
      if (row.status !== "completed") return null;
      var he = addRideHistoryEntry(row, now); if (past) { he.backdated = true; he.payWeek = past; }
      return arHistoryPut(row.assignedDriverId, row.code, he);
    }).then(function () {
      if (!past) return null; /* v74b: Driver's Log entry for the backdated ride */
      var owes = arCollects(row.payMethod) ? Math.round(row.balance * 100) : 0;
      return fetch(baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(row.assignedDriverId) + "/overrides/" + now + ".json", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "past ride added", at: now, grantedAt: now, by: godWho(), code: row.code, day: f.date, time: f.time, payWeek: past, payMethod: row.payMethod, fare: row.fare,
          reason: "Past ride " + row.code + " on " + f.date + " " + f.time + " (" + row.payMethod + ")" + (owes ? ", driver owes PCS " + fmtCents(owes) : "") }) }).catch(function () {});
    }).then(function () {
      if (row.riderPhone) clientRemember(row, row.riderPhone); /* v77.10: saved for this client's future rides; r2 (Harry L4): the card */
      state.addRidePast = "";
      state.addRideDraft = null; state.addRideTouched = {}; state.addRideOpen = false; state.addRideEditId = "";
      var cash = arCollects(row.payMethod);
      state.boardNotice = (editId ? "Updated " : "Added ") + row.rider + " → " + row.assignedDriverName + " · " + row.status +
        (cash ? " · cash - driver owes " + fmtCents(Math.round(row.balance * 100)) : " · owed to driver " + fmtCents(Math.round(row.balance * 100))) + " (" + row.code + ")";
      return refresh();
    }).then(function () { return row; });
  }

  function addRideDelete(id, note) {
    var prev = Object.assign({}, (state.addRideRaw && state.addRideRaw[id]) || arFindRow(id) || {});
    if (!prev.id) return Promise.reject(new Error("Ride not found."));
    if (!String(note || "").trim()) return Promise.reject(new Error("An audit note is required to delete."));
    var now = Date.now();
    var next = Object.assign({}, prev, { status: "deleted", deletedAt: now, updatedAt: now, audit: arAudit(prev, note, "delete", now) });
    var steps = prev.status === "completed" ? arHistoryDelete(prev.assignedDriverId, prev.code) : Promise.resolve();
    return steps.then(function () { return putCalendarRide(next); }).then(function () {
      state.boardNotice = "Deleted manual ride " + (prev.rider || "") + " (" + (prev.code || "") + ") · audit note saved";
      return refresh();
    });
  }

  function arLoadRaw(id) {
    return fetch(calendarUrl(id)).then(function (res) { return res.ok ? res.json() : null; }).then(function (raw) {
      state.addRideRaw = state.addRideRaw || {};
      if (raw) state.addRideRaw[id] = raw;
      return raw;
    }).catch(function () { return null; });
  }

  function arDraftFromRow(r) {
    var parts = {};
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(r.start)).forEach(function (p) { if (p.type !== "literal") parts[p.type] = p.value; });
    } catch (e) {}
    var s2 = function (v) { return v == null || v === "" ? "" : Number(v).toFixed(2); };
    return { driverId: r.assignedDriverId, status: r.status === "deleted" ? "cancelled" : (r.status || "assigned"), name: r.rider || "", phone: r.riderPhone || "",
      pickup: r.pickup || "", stops: (r.stops || []).join("\n"), dropoff: r.dropoff || "",
      pickupLat: r.pickupLat, pickupLng: r.pickupLng, dropoffLat: r.dropoffLat, dropoffLng: r.dropoffLng, discountPct: r.discountPct != null ? String(r.discountPct) : "",
      stopsArr: (Array.isArray(r.stopsGeo) && r.stopsGeo.length ? r.stopsGeo.map(function (x) { return { text: x.address, lat: x.lat, lng: x.lng }; }) : (r.stops || []).map(function (t) { return { text: t }; })),
      date: parts.year ? parts.year + "-" + parts.month + "-" + parts.day : "", time: parts.hour ? (parts.hour === "24" ? "00" : parts.hour) + ":" + parts.minute : "",
      prepaid: r.prepaid === true, prepaidAmount: r.prepaidAmountCents != null ? (Number(r.prepaidAmountCents) / 100).toFixed(2) : "", prepaidInvoiceNo: r.prepaidInvoiceNo || "", /* v75v */
      fare: s2(r.fare != null ? r.fare : r.fareBeforeTax), discount: s2(r.discount || 0), taxFees: s2(r.taxFees || 0), total: s2(r.total),
      commissionPct: r.commissionPct != null ? String(r.commissionPct) : "", commission: s2(r.commissionDollars), balance: s2(r.balance),
      payMethod: r.payMethod || "", flat: !!r.flatPrice, notes: r.notes || "", audit: "",
      ovBase: rovFix(r.rateOverride && r.rateOverride.base), ovPerMile: rovFix(r.rateOverride && r.rateOverride.perMile), ovFlat: rovFix(r.rateOverride && r.rateOverride.flat) }; /* v76j */
  }

  /* v74b (Matthew): "Add past ride" (backdated) inside a driver's Mon-Sun pay week: date/time, pickup, drop-off, fare,
     Cash/Card/Account. Saved completed straight into that week; cash = driver owes PCS (100% - commission%) of the fare,
     netted against the week payout. Logged in the ride audit + the Driver's Log. */
  function pastRideCheck(f, week, today) {
    var d = String(f.date || ""), end = addDaysYmd(week, 6);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < week || d > end) return "Pick a date inside this pay week (" + week + " \u2192 " + end + ").";
    if (d > today) return "A past ride can\u2019t be in the future.";
    if (!/^\d{2}:\d{2}$/.test(String(f.time || ""))) return "Enter the time of the ride.";
    if (["cash", "square", "account"].indexOf(String(f.payMethod || "")) < 0) return "Pick Cash, Card or Account.";
    return "";
  }
  function addPastRideOpen(driverId, week) {
    var today = chicagoToday(), end = addDaysYmd(week, 6);
    state.addRidePast = week; state.addRideOpen = true; state.addRideError = ""; state.addRideEditId = ""; state.addRideTouched = {};
    state.addRideDraft = addRidePrefill({ driverId: driverId, status: "completed", date: end < today ? end : today, time: "", payMethod: "" }, {}, driverId ? commissionPctFor(driverId) : DEFAULT_COMMISSION_PCT);
    mountAddRideModal(true);
    return Promise.resolve();
  }
  function addRideOpenFor(driverId, editId) {
    state.addRidePast = "";
    state.addRideOpen = true; state.addRideError = ""; state.addRideEditId = editId || "";
    if (editId) {
      return arLoadRaw(editId).then(function (raw) {
        var r = raw || arFindRow(editId) || {};
        state.addRideDraft = arDraftFromRow(r);
        state.addRideTouched = { total: true, commission: true, balance: true, commissionPct: true }; /* keep saved overrides */
        mountAddRideModal(true);
      });
    }
    state.addRideTouched = {};
    state.addRideDraft = addRidePrefill({ driverId: driverId || "", status: "assigned", date: chicagoToday() }, {}, driverId ? commissionPctFor(driverId) : DEFAULT_COMMISSION_PCT);
    mountAddRideModal(true);
    return Promise.resolve();
  }

  /* v73: stops = one Google Places address search per stop, "+ Add a stop" (max 5) */
  function arStopsHtml(d) {
    var arr = Array.isArray(d.stopsArr) ? d.stopsArr : [];
    return '<label class="ar-l">Stops (optional)</label>' + arr.map(function (x, i) {
      return '<div style="position:relative;display:flex;gap:6px;margin:0 0 4px"><input id="ar-stop-' + i + '" class="ar-stop" data-stop-i="' + i + '" data-places="stop:' + i + '" type="text" autocomplete="off" placeholder="Stop ' + (i + 1) + ' address" value="' + esc(x.text || "") + '" style="flex:1">' +
        '<button type="button" class="btn btn-ghost ar-stop-x" data-stop-i="' + i + '" aria-label="Remove stop ' + (i + 1) + '" style="min-height:0;padding:4px 10px">\u00d7</button></div>';
    }).join("") + (arr.length < 5 ? '<button type="button" class="btn btn-ghost" id="ar-stop-add">+ Add a stop</button>' : "");
  }
  function arStopsToText() { var d = state.addRideDraft || {}; d.stops = (d.stopsArr || []).map(function (x) { return String(x.text || "").trim(); }).filter(Boolean).join("\n"); }
  var arPlaces = { sess: "", timer: 0, seq: 0 };
  function arPlacesPost(path, body) {
    return fetch(PAY_WORKER + "/places" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (d) { return d && d.ok && !d.capped && !d.fallback ? d : null; }).catch(function () { return null; });
  }
  function arPlacesClose() { var l = document.getElementById("ar-places-list"); if (l) l.remove(); }
  function arPlacesSet(field, text, lat, lng) {
    var d = state.addRideDraft = state.addRideDraft || {};
    if (field.indexOf("stop:") === 0) { var i = +field.slice(5); d.stopsArr = d.stopsArr || []; d.stopsArr[i] = { text: text, lat: lat, lng: lng }; arStopsToText(); }
    else { d[field] = text; d[field + "Lat"] = lat; d[field + "Lng"] = lng; }
  }
  function arPlacesSearch(input) {
    var field = input.getAttribute("data-places"), q = String(input.value || "").trim(), my = ++arPlaces.seq;
    if (q.length < 3) { arPlacesClose(); return; }
    if (!arPlaces.sess) arPlaces.sess = "god-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    arPlacesPost("/autocomplete", { input: q, sessionToken: arPlaces.sess, lat: 29.7604, lng: -95.3698, radius: 80000 }).then(function (d) { /* Houston-area bias, like the apps */
      if (my !== arPlaces.seq || document.activeElement !== input) return;
      var preds = d && Array.isArray(d.predictions) ? d.predictions.slice(0, 6) : [];
      arPlacesClose();
      if (!preds.length) return;
      var l = document.createElement("div");
      l.id = "ar-places-list"; l.setAttribute("role", "listbox");
      l.style.cssText = "position:absolute;left:0;right:0;top:100%;z-index:5;background:#1f1f1f;border:1px solid #f0d48a;border-radius:10px;max-height:240px;overflow:auto";
      preds.forEach(function (pr) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "ar-place-item"; b.setAttribute("role", "option");
        b.style.cssText = "display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #333;color:#fff;padding:8px 10px;min-height:0;margin:0";
        b.innerHTML = "<strong>" + esc(pr.main || "") + '</strong><br><span style="opacity:.75;font-size:13px">' + esc(pr.sub || "") + "</span>";
        b.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); /* keep focus in the box */
        b.addEventListener("click", function () {
          arPlacesPost("/details", { placeId: pr.placeId, sessionToken: arPlaces.sess }).then(function (dd) {
            arPlaces.sess = "";
            var pl = dd && dd.place;
            var text = pl && pl.formatted ? String(pl.formatted) : [pr.main, pr.sub].filter(Boolean).join(", ");
            var lat = pl && isFinite(+pl.lat) ? +pl.lat : null, lng = pl && isFinite(+pl.lng) ? +pl.lng : null;
            input.__placePicked = true; input.value = text; input.__pickedText = text; input.__placePicked = false;
            arPlacesSet(field, text, lat, lng);
            arPlacesClose();
          });
        });
        l.appendChild(b);
      });
      (input.parentNode).appendChild(l);
    });
  }
  if (typeof document !== "undefined") {
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || !t.getAttribute("data-places") || !t.closest("#add-ride-modal")) return;
      var f = t.getAttribute("data-places");
      if (f.indexOf("stop:") === 0) arPlacesSet(f, t.value, null, null);
      clearTimeout(arPlaces.timer);
      arPlaces.timer = setTimeout(function () { arPlacesSearch(t); }, 250);
    });
    document.addEventListener("focusout", function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute("data-places")) setTimeout(arPlacesClose, 200); });
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("#ar-stop-add,.ar-stop-x") : null;
      if (!t || !t.closest("#add-ride-modal")) return;
      var d = state.addRideDraft = state.addRideDraft || {};
      d.stopsArr = Array.isArray(d.stopsArr) ? d.stopsArr : [];
      if (t.id === "ar-stop-add") { if (d.stopsArr.length < 5) d.stopsArr.push({ text: "" }); }
      else d.stopsArr.splice(+t.getAttribute("data-stop-i"), 1);
      arStopsToText();
      var box = document.getElementById("ar-stops-box");
      if (box) { box.innerHTML = arStopsHtml(d); var last = box.querySelector(".ar-stop:last-of-type"); var ins = box.querySelectorAll(".ar-stop"); if (t.id === "ar-stop-add" && ins.length) ins[ins.length - 1].focus(); }
    });
  }
  function addRideFormHtml() {
    var d = state.addRideDraft || {};
    var drivers = arDriverChoices(d.driverId);
    var sel = function (id, list, ph) {
      return '<select id="ar-' + id + '" data-ar="' + id + '"><option value="">' + ph + "</option>" + list.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === d[id] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select>";
    };
    var inp = function (id, label, type, extra) {
      return '<label class="ar-l" for="ar-' + id + '">' + label + "</label>" +
        '<input id="ar-' + id + '" data-ar="' + id + '" type="' + (type || "text") + '" value="' + esc(d[id] == null ? "" : d[id]) + '"' + (extra || "") + ">";
    };
    var money = ' inputmode="numeric" pattern="[0-9.]*" autocomplete="off" data-money-reg="1"'; /* v76j: digit pad */ /* v73 cash-register entry */
    var cash = arCollects(d.payMethod);
    return (
      '<div class="add-ride-sheet" role="dialog" aria-modal="true" aria-labelledby="ar-title" style="background:#141414;color:#fff;border:2px solid #f0d48a;border-radius:16px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:16px 18px">' +
      '<h2 id="ar-title" style="margin:0 0 8px">' + (state.addRideEditId ? "Edit manual ride" : state.addRidePast ? "Add past ride (backdated)" : "Add ride") + "</h2>" +
      (state.addRidePast ? '<p class="fine ar-past-note" style="margin:0 0 8px">Pay week ' + esc(state.addRidePast) + " \u2192 " + esc(addDaysYmd(state.addRidePast, 6)) + ". Saved as completed in this week. Cash = the driver collected it and owes PCS the company share (100% \u2212 commission %).</p>" : "") +
      '<p class="fine" style="opacity:.8;margin:0 0 10px">Every field is yours to change. Totals only prefill boxes you haven\'t typed in.</p>' +
      '<div class="ar-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px">' +
      '<div><label class="ar-l" for="ar-driverId">Driver</label>' + sel("driverId", drivers.map(function (x) { return [x.id, x.name || x.id]; }), "Pick a driver…") + "</div>" +
      '<div><label class="ar-l" for="ar-status">Status</label>' + sel("status", ADD_RIDE_STATUS, "Status…") + "</div>" +
      "<div>" + inp("name", "Client name") + "</div><div>" + inp("phone", "Client phone", "tel") + "</div>" +
      '<div style="grid-column:1/3"><label style="display:inline-flex;align-items:center;gap:10px;font-size:20px;font-weight:800;color:#fff;background:#2e7d32;border-radius:12px;padding:10px 16px;min-height:52px"><input type="checkbox" id="ar-cashBox" class="ar-cash-box"' + (d.payMethod === "cash" ? " checked" : "") + ' style="width:30px;height:30px">Cash</label></div>' + /* v77.10 */
      '<div style="grid-column:1/3;position:relative">' + inp("pickup", "Pickup (search an address)", "text", ' autocomplete="off" data-places="pickup"') + "</div>" +
      '<div style="grid-column:1/3" id="ar-stops-box">' + arStopsHtml(d) + "</div>" + /* v73: one address search per stop */
      '<div style="grid-column:1/3;position:relative">' + inp("dropoff", "Drop-off (search an address)", "text", ' autocomplete="off" data-places="dropoff"') + "</div>" +
      "<div>" + inp("date", "Date", "date") + "</div><div>" + inp("time", "Time", "time") + "</div>" +
      '<div><label class="ar-l" for="ar-payMethod">Payment method</label>' + sel("payMethod", state.addRidePast ? ADD_RIDE_PAY.filter(function (p) { return ["cash", "square", "account"].indexOf(p[0]) >= 0; }) : ADD_RIDE_PAY, state.addRidePast ? "Cash, Card or Account…" : "Cash or card…") + "</div>" +
      '<div><label class="ar-c" style="display:block;margin-top:22px"><input type="checkbox" id="ar-flat" data-ar="flat"' + (d.flat ? " checked" : "") + "> Flat price</label></div>" +
      "<div>" + inp("fare", "Fare ($)", "text", money) + "</div><div>" + inp("discount", "Discount ($)", "text", money) + "</div>" +
      "<div>" + inp("discountPct", "Discount (%)", "text", ' inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" autocomplete="off"') + '</div><div class="fine" style="align-self:end;opacity:.8">% fills $ on the pretax fare, and $ fills %.</div>' + /* v73 */
      "<div>" + inp("taxFees", "Tax / fees ($)", "text", money) + "</div><div>" + inp("total", "Total charged ($)", "text", money) + "</div>" +
      "<div>" + inp("commissionPct", "Commission %", "text", ' inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" autocomplete="off"') + "</div><div>" + inp("commission", "Driver commission ($)", "text", money) + "</div>" +
      '<div style="grid-column:1/3">' + inp("balance", cash ? "Driver owes PCS ($) — driver collects" : "PCS owes driver ($)", "text", money + ' style="font-weight:800;font-size:18px"') + "</div>" +
      '<div style="grid-column:1/3;background:#0b3d23;border:2px solid #0b6b3a;border-radius:10px;padding:8px 10px"><label class="ar-c" style="display:block;font-weight:800;font-size:17px"><input type="checkbox" id="ar-prepaid" data-ar="prepaid"' + (d.prepaid ? " checked" : "") + "> Prepaid (Square invoice)</label>" + /* v75v */
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px">' + "<div>" + inp("prepaidAmount", "Invoice amount for this ride ($, optional)", "text", money) + "</div><div>" + inp("prepaidInvoiceNo", "Invoice # (optional)") + "</div></div></div>" +
      '<div style="grid-column:1/3;background:#0b3d23;border:2px solid #0b6b3a;border-radius:10px;padding:8px 10px"><b>Rate override (God mode only)</b> <select id="ar-ovPreset" style="min-height:40px">' + rovPresetOptions() + "</select>" + /* v76j */
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">' + "<div>" + inp("ovBase", "Base / drop-off ($)", "text", money) + "</div><div>" + inp("ovPerMile", "Per mile ($)", "text", money) + "</div><div>" + inp("ovFlat", "Flat fare ($, wins)", "text", money) + "</div></div></div>" +
      '<div style="grid-column:1/3"><label class="ar-l" for="ar-notes">Notes</label><textarea id="ar-notes" data-ar="notes" rows="2" style="width:100%">' + esc(d.notes || "") + "</textarea></div>" +
      '<div style="grid-column:1/3">' + inp("audit", state.addRideEditId ? "Audit note (required): what changed and why" : "Audit note (optional)") + "</div>" +
      "</div>" +
      '<p class="error" id="add-ride-error" role="alert" style="color:#ff6b6b">' + esc(state.addRideError || "") + "</p>" +
      '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-gold" id="add-ride-save"' + (state.addRideBusy ? " disabled" : "") + ">" + (state.addRideBusy ? "Saving…" : (state.addRideEditId ? "Save changes" : "Save ride")) + "</button>" +
      '<button type="button" class="btn btn-ghost" id="add-ride-recalc">Recalculate totals</button>' +
      '<button type="button" class="btn btn-ghost" id="add-ride-cancel">Close</button></div>' +
      "</div>"
    );
  }

  function arSyncDerivedDom() {
    AR_DERIVED.forEach(function (k) {
      var el = document.getElementById("ar-" + k);
      if (el && document.activeElement !== el && el.value !== String(state.addRideDraft[k] == null ? "" : state.addRideDraft[k])) el.value = state.addRideDraft[k];
    });
    var bl = document.querySelector('label[for="ar-balance"]');
    if (bl) bl.textContent = arCollects(state.addRideDraft.payMethod) ? "Driver owes PCS ($) — driver collects" : "PCS owes driver ($)";
    ["discount", "discountPct"].forEach(function (k) { var el = document.getElementById("ar-" + k); if (el && document.activeElement !== el && el.value !== String(state.addRideDraft[k] == null ? "" : state.addRideDraft[k])) el.value = state.addRideDraft[k] == null ? "" : state.addRideDraft[k]; });
    var pe = document.getElementById("ar-commissionPct");
    if (pe && document.activeElement !== pe && pe.value !== String(state.addRideDraft.commissionPct || "")) pe.value = state.addRideDraft.commissionPct || "";
  }

  function mountAddRideModal(force) {
    var host = document.getElementById("add-ride-modal");
    if (!state.addRideOpen) { if (host) host.remove(); return; }
    if (!host) {
      host = document.createElement("div");
      host.id = "add-ride-modal";
      host.setAttribute("style", "position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:12px");
      document.body.appendChild(host);
      force = true;
    }
    if (!force) return;
    host.innerHTML = addRideFormHtml();
    var arCash = host.querySelector("#ar-cashBox"); /* v77.10: Cash checkbox = Payment method Cash (unchecked clears it) */
    if (arCash) arCash.addEventListener("change", function () { var ps = host.querySelector("#ar-payMethod"); if (!ps) return; ps.value = arCash.checked ? "cash" : ""; ps.dispatchEvent(new Event("change")); });
    Array.prototype.forEach.call(host.querySelectorAll("[data-ar]"), function (el) {
      var key = el.getAttribute("data-ar");
      var save = function () {
        state.addRideDraft = state.addRideDraft || {};
        state.addRideDraft[key] = el.type === "checkbox" ? el.checked : el.value;
        if (key === "total" || key === "commission" || key === "balance" || key === "commissionPct") state.addRideTouched[key] = true;
        if (key === "discountPct") state.addRideTouched.discMode = "pct";
        if (key === "discount") state.addRideTouched.discMode = "usd";
        if ((key === "pickup" || key === "dropoff") && !el.__placePicked && el.value !== el.__pickedText) { delete state.addRideDraft[key + "Lat"]; delete state.addRideDraft[key + "Lng"]; } /* typed by hand: no pin */
        if (key === "driverId" && !state.addRideTouched.commissionPct && el.value) state.addRideDraft.commissionPct = String(commissionPctFor(el.value));
        if (key === "phone") state.addRideTouched.phone = !!el.value; /* v77.10 */
        if (key === "payMethod") { var cbx = document.getElementById("ar-cashBox"); if (cbx) cbx.checked = el.value === "cash"; }
        if (key === "name" && !state.addRideTouched.phone) { var hitP = clientPhoneFor(el.value, state.clients, state.rides), phEl = document.getElementById("ar-phone");
          var fillP = hitP ? cphShow(hitP.phone) : ""; if (phEl && (!phEl.value || phEl.__autoFilled)) { phEl.value = fillP; phEl.__autoFilled = !!fillP; state.addRideDraft.phone = fillP; } }
        if (["fare", "discount", "discountPct", "taxFees", "commissionPct", "payMethod", "driverId", "total", "commission"].indexOf(key) >= 0) {
          state.addRideDraft = addRidePrefill(state.addRideDraft, state.addRideTouched, DEFAULT_COMMISSION_PCT);
          arSyncDerivedDom();
        }
      };
      el.addEventListener("input", save);
      el.addEventListener("change", save);
    });
    document.getElementById("add-ride-cancel").addEventListener("click", function () { state.addRidePast = ""; state.addRideOpen = false; state.addRideEditId = ""; mountAddRideModal(); });
    document.getElementById("add-ride-recalc").addEventListener("click", function () {
      state.addRideTouched = {};
      state.addRideDraft = addRidePrefill(Object.assign({}, state.addRideDraft, { commissionPct: state.addRideDraft.driverId ? String(commissionPctFor(state.addRideDraft.driverId)) : state.addRideDraft.commissionPct }), { commissionPct: true }, DEFAULT_COMMISSION_PCT);
      mountAddRideModal(true);
    });
    document.getElementById("add-ride-save").addEventListener("click", function () {
      var f = state.addRideDraft || {};
      if (f.status === "completed" && !state.addRideEditId && !state.addRidePast && !window.confirm("Save as completed and put it in the driver's pay week now?")) return;
      state.addRideBusy = true; state.addRideError = ""; mountAddRideModal(true);
      addRideSave(f).then(function () {
        state.addRideBusy = false; mountAddRideModal();
      }).catch(function (err) {
        state.addRideBusy = false; state.addRideError = (err && err.message) || "Could not save the ride."; mountAddRideModal(true);
      });
    });
  }

  function manualRidesListHtml() {
    var rows = (state.calendar || []).filter(function (r) { return r && r.source === "manual" && r.status !== "deleted"; })
      .sort(function (a, b) { return String(b.start || "").localeCompare(String(a.start || "")); }).slice(0, 30);
    var head = '<button type="button" class="btn btn-gold" data-add-ride-driver="">+ Add ride</button>' +
      '<p class="fine" style="opacity:.75;margin:6px 0">Tip: open a driver and tap Add ride to pre-pick them.</p>';
    head += rateContractsHtml(); rovWire(); /* v76j */
    head += autoTextPanelHtml(); cphWire(); /* v77.3 */
    head += clientsPanelHtml(); clientsWire(); if (!state.clientsLoaded) { state.clientsLoaded = true; clientsLoad(); } /* v77.10 */
    if (!rows.length) return head;
    /* v73: the added-rides list folds into one row so the map stays in view on iPad / iPhone; remembers open / closed */
    return head + '<details class="manual-list"' + (state.manualListOpen ? " open" : "") + ' style="margin:4px 0"><summary style="cursor:pointer;padding:6px 0;font-weight:700">Added rides (' + rows.length + ")</summary>" + rows.map(function (r) {
      return '<article class="card manual-ride" data-manual-id="' + esc(r.id) + '" style="padding:8px 10px;margin:6px 0">' +
        "<strong>" + esc(r.rider) + "</strong> · " + esc(fmtBoardWhen(r.start)) + " · " + esc(r.assignedDriverName || "") + " · " + esc(r.status) + "<br>" +
        '<span class="fine">' + esc(r.pickup) + " → " + esc(r.dropoff) + "</span> " +
        '<button type="button" class="btn btn-ghost" data-ar-edit="' + esc(r.id) + '">Edit</button> ' +
        '<button type="button" class="btn btn-ghost" data-ar-delete="' + esc(r.id) + '">Delete</button></article>';
    }).join("") + "</details>";
  }
  if (typeof document !== "undefined") document.addEventListener("toggle", function (e) { if (e.target && e.target.classList && e.target.classList.contains("manual-list")) state.manualListOpen = e.target.open; }, true);

  /* Pure: patch for a pay-week entry when God sets / clears Card failed - collect (driver owes 30% + taxes = total - commission). */
  function cardFailPatch(e, on) {
    if (!on) return { cardFailedCollect: false, driverOwesCents: 0 };
    return { cardFailedCollect: true, driverOwesCents: Math.max(0, Math.round((Number(e.fareTotal) || 0) - (Number(e.commissionCents) || 0) - tollReimbCents(e))) }; /* v76b */
  }
  function cardFailToggle(driverId, code, on) {
    var e = ((state.history && state.history[driverId]) || {})[code];
    if (!e) return;
    var note = window.prompt((on ? "Mark Card failed - collect" : "Undo Card failed - collect") + " for " + code + "? Audit note:", "");
    if (note === null) return;
    var patch = cardFailPatch(e, on);
    patch.cardFailAudit = { at: Date.now(), by: state.sessionEmail || "god", on: on, note: String(note).slice(0, 500) };
    godFetch(historyUrl(driverId, code), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (res) {
      if (!res.ok) throw new Error("x");
      Object.assign(e, patch);
      state.boardNotice = on ? code + ": Card failed - collect · driver owes " + fmtCents(patch.driverOwesCents) : code + ": back to card (owed to driver)";
      return refresh();
    }).catch(function () { state.boardNotice = "Could not update " + code + "."; });
  }

  function mountAddRide() {
    var box = document.getElementById("add-ride-box");
    if (box) {
      var html = manualRidesListHtml();
      if (box.getAttribute("data-html") !== html) { box.innerHTML = html; box.setAttribute("data-html", html); }
    }
    mountAddRideModal(false);
    if (!window.__pcsArBound) {
      window.__pcsArBound = true;
      document.addEventListener("click", function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest("[data-add-ride-driver],[data-add-past-ride],[data-ar-edit],[data-ar-delete],[data-cardfail-toggle],[data-test-toggle],[data-note-save]") : null;
        if (!t) return;
        ev.preventDefault();
        if (t.hasAttribute("data-test-toggle")) { godTestToggle(t.getAttribute("data-driver"), t.getAttribute("data-test-toggle"), t.getAttribute("data-on") !== "1"); return; } /* v76d */
        if (t.hasAttribute("data-note-save")) { var nb = document.getElementById(t.getAttribute("data-note-box")); godRideNoteSave(t.getAttribute("data-driver"), t.getAttribute("data-note-save"), nb ? nb.value : ""); return; } /* v76d */
        if (t.hasAttribute("data-cardfail-toggle")) { cardFailToggle(t.getAttribute("data-driver"), t.getAttribute("data-cardfail-toggle"), t.getAttribute("data-on") !== "1"); return; }
        if (t.hasAttribute("data-add-ride-driver")) { addRideOpenFor(t.getAttribute("data-add-ride-driver") || ""); return; }
        if (t.hasAttribute("data-add-past-ride")) { addPastRideOpen(t.getAttribute("data-add-past-ride") || "", t.getAttribute("data-week") || ""); return; }
        if (t.hasAttribute("data-ar-edit")) { addRideOpenFor("", t.getAttribute("data-ar-edit")); return; }
        var id = t.getAttribute("data-ar-delete");
        var note = window.prompt("Delete this manual ride? Type an audit note (why):", "");
        if (note === null) return;
        arLoadRaw(id).then(function () { return addRideDelete(id, note); }).catch(function (err) {
          state.boardNotice = (err && err.message) || "Could not delete."; try { renderBoardLists(); } catch (e) {}
        });
      });
    }
  }

  window.__pcsGodAddRide = { build: addRideBuild, prefill: addRidePrefill, historyEntry: addRideHistoryEntry, chicagoIso: addRideChicagoIso,
    payBalance: payBalance, isCash: isCashEntry, cashOwes: cashDriverOwesCents, tollReimb: tollReimbCents, tollFee: tollFeeCents, totalsForDriver: totalsForDriver, cardFailPatch: cardFailPatch, isCardFailed: isCardFailedCollect, openFor: function (d, e) { return addRideOpenFor(d, e); } };

  function renderBoard() {
    return (
      '<div class="shell">' +
        '<header class="topbar">' +
          "<div>" +
            '<svg class="pcs-wm" viewBox="0 0 390 96" role="img" aria-label="Private Car Services God mode" style="display:block;width:100%;max-width:300px;height:auto;max-height:64px;border-radius:8px" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="wmg-gh" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="#2c4a2a" stroke-width=".6"/></pattern></defs><rect width="390" height="96" fill="#20371d"/><rect width="390" height="96" fill="url(#wmg-gh)"/><text class="pcs-wm-name" x="28" y="44" text-anchor="start" textLength="334" lengthAdjust="spacingAndGlyphs" font-family="Poppins,Montserrat,Helvetica,Arial,sans-serif" font-style="italic" font-size="21" font-weight="300" fill="#cdeccd">PRIVATE CAR SERVICES</text><path d="M28 54H350" stroke="#cdeccd" stroke-width="3"/><path d="M348 48L362 54L348 60Z" fill="#cdeccd"/><text x="195" y="76" text-anchor="middle" font-family="Poppins,Helvetica,Arial,sans-serif" font-style="italic" font-size="14" letter-spacing="1" fill="#a9c9a9">God mode</text></svg>' + /* v72e wordmark */
            '<h1 style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">PCS God mode</h1>' +
            '<p class="who">' + esc(state.sessionEmail) + "</p>" +
          "</div>" +
          '<div class="top-actions">' +
            '<p class="status-pill" id="refresh-pill">' + esc(statusPillText()) + "</p>" +
            '<button type="button" class="btn btn-gold" id="god-push-btn">' + (state.pushOn ? "\uD83D\uDD14 Phone alerts: ON" : "\uD83D\uDD14 Turn on phone alerts") + "</button>" +
            '<button type="button" class="btn btn-ghost" id="god-pw-btn">Password</button>' + /* v77.1 */
            '<button type="button" class="btn btn-ghost" id="god-logout">Sign out</button>' +
          "</div>" +
        "</header>" +
        dayBoardHtml() +
        '<div class="workspace">' +
          '<aside class="side">' +
            vmHomeMenuHtml() + /* v75 */
            '<section class="side-section" id="add-ride-section">' +
              "<h2>Add ride</h2>" +
              '<div id="add-ride-box"></div>' +
            "</section>" +
            '<section class="side-section drivers-section">' +
              "<h2>Drivers</h2>" +
              hireBlockHtml() +
              '<div id="hos-box-god"></div>' + /* v72r HOS */
              '<div id="drivers-list">' + driversPanelHtml() + "</div>" +
            "</section>" +
            '<section class="side-section">' +
              "<h2>Riders &amp; trips</h2>" +
              '<div id="rides-list">' + ridesPanelHtml() + "</div>" +
            "</section>" +
            '<section class="side-section" id="queue-section">' + /* v72q */
              "<h2>Rider queue</h2>" +
              '<div id="queue-list">' + gqPanelHtml() + "</div>" +
            "</section>" +
            '<section class="side-section" id="payments-section">' +
              '<h2 id="payments-head" role="button" tabindex="0" style="cursor:pointer;user-select:none">' + payHeadHtml() + "</h2>" + /* v75m */
              '<div id="payments-list" style="' + (payOpen() ? "" : "display:none") + '">' + paymentsPanelHtml() + "</div>" +
            "</section>" +
            '<section class="side-section" id="daily-miles-section">' +
              "<h2>Daily miles</h2>" +
              '<div id="daily-miles-list"></div>' +
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
        var u = document.getElementById("comm-unsaved-" + id); /* v76d */
        if (u) u.textContent = String(clampPct(input.value)) !== String(commissionPctFor(id)) ? "Unsaved (saved: " + commissionPctFor(id) + "%)" : "";
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
            /* v76h-test (only with ?goalsync=1): the good God PIN also links this device's Monthly Goal backup (30-day God device token; the PIN is never stored) */
            try { if (window.__pcsGoalSyncOn && window.__pcsGoalSyncOn() && window.__pcsGoalGodLink) window.__pcsGoalGodLink(state.passwordInput); } catch (e) {}
            /* v75x (Matthew): close the iPad number keypad on a good PIN sign-in: blur the PIN box + whatever has focus, clear and hide it before the board renders */
            try { if (passEl) { passEl.blur(); passEl.value = ""; passEl.style.display = "none"; } if (emailEl) emailEl.blur(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
            state.passwordInput = "";
            render();
            try { if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
            startPoll();
          } else {
            var err = document.getElementById("god-login-error");
            if (err) err.textContent = state.loginError;
          }
        });
      });
    }
    var pwb = document.getElementById("god-pw-btn");
    if (pwb) pwb.addEventListener("click", function () {
      state.godPwOpen = true; state.godPwError = ""; state.godPwDaysMsg = "";
      var a = godPwAuth();
      if (a) fetch(PAY_WORKER + "/god/pwpolicy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.ok) { state.godPwDays = d.days; render(); } }).catch(function () {});
      render();
    });
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
    refreshDailyMiles(); /* v71m */
    mountAddRide(); /* v72d */
    bindDriverActions();
    bindBookingActions();
    bindPaymentActions();
    bindSafetyActions();
    bindLocateActions();
    bindDayBoardActions();
    bindOwnerRideActions();
  }

  window.pcsIdleForReload = function () { var ae = document.activeElement; return !(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) && !document.querySelector("dialog[open], .modal.open"); };
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
    if (state.godPwMust || state.godPwOpen) { stopPoll(); tearMap(); root.innerHTML = godPwScreenHtml(); bindGodPw(); return; } /* v77.1 */
    var nae = document.activeElement, ncode = nae && nae.getAttribute ? nae.getAttribute("data-note-code") : null; /* v76d: keep typing in a note box */
    var nsel = ncode ? [nae.selectionStart, nae.selectionEnd] : null;
    root.innerHTML = renderBoard();
    bind();
    ensureMap();
    syncMap();
    setFocusBar();
    if (ncode) { var nel = Array.prototype.filter.call(document.querySelectorAll("[data-note-code]"), function (x) { return x.getAttribute("data-note-code") === ncode; })[0];
      if (nel) { try { nel.focus(); nel.setSelectionRange(nsel[0], nsel[1]); } catch (x) {} } }
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

  /* ================= v72q (Oct 10): rider queue + driver Available / On a ride in God mode (through the Worker) =================
     The queue and driver statuses are read ONLY from the Worker (POST /queue/state with the God password, kept in memory
     for this page only), which trusts only rows it signed. Names come from what God mode already loads. Also: "Confirm a
     driver's new password" (POST /driver/pin-reset) after a driver's roster password was changed. */
  var gq = { pw: "", data: null, err: "", busy: false, timer: 0, msg: "" };
  /* v72t: the Worker hands back a 30-day device token after the password once; kept on this device and renewed silently */
  var GQ_TOK_KEY = "pcs-god-queue-token";
  function gqTok() { try { var t = localStorage.getItem(GQ_TOK_KEY) || ""; var exp = Number(t.split(".")[1]) || 0; return exp > Date.now() + 60000 ? t : ""; } catch (e) { return ""; } }
  function gqSetTok(t) { try { if (t) localStorage.setItem(GQ_TOK_KEY, t); else localStorage.removeItem(GQ_TOK_KEY); } catch (e) {} }
  function gqAuth() { return gq.pw ? { godPassword: gq.pw } : { godToken: gqTok() }; }
  if (gqTok()) { gq.pw = ""; gq.tokOn = true; setTimeout(function () { gqLoad(); if (!gq.timer) gq.timer = setInterval(function () { if (document.visibilityState !== "hidden") gqLoad(); }, 20000); /* v77.15: was 6 s */ }, 0); }
  function gqMins(ms) { var m = Math.max(0, Math.round((Date.now() - (Number(ms) || Date.now())) / 60000)); return m < 1 ? "just now" : m + " min"; }
  function gqName(id) { var d = (state.drivers || []).concat(state.offlineDrivers || []).filter(function (x) { return x && x.id === id; })[0]; return (d && d.name) || ((state.roster || {})[id] || {}).name || id; }
  function gqRide(code) { return (state.rides || []).filter(function (r) { return r && String(r.code) === String(code); })[0] || {}; }
  function gqPanelHtml() {
    if (!gq.pw && !gq.tokOn) {
      return '<p class="muted">Enter the God-mode password to load the rider queue and driver statuses.</p>' +
        '<input type="password" id="gq-pw" autocomplete="current-password" aria-label="God-mode password">' +
        '<button type="button" class="btn btn-gold" id="gq-load"' + (gq.busy ? " disabled" : "") + ">" + (gq.busy ? "Loading\u2026" : "Show queue") + "</button>" +
        (gq.err ? '<p class="error" role="alert">' + esc(gq.err) + "</p>" : "");
    }
    var d = gq.data || { drivers: [], rows: [] };
    var drivers = d.drivers || [], rows = d.rows || [];
    var onRide = drivers.filter(function (x) { return x.onRide; });
    var onBrk = drivers.filter(function (x) { return x.onBreak; }); /* v72t */
    var head = '<p class="muted" id="gq-drivers">Drivers online: ' + drivers.length + " \u00b7 Available " + (drivers.length - onRide.length - onBrk.length) + " \u00b7 On a ride " + onRide.length + " \u00b7 On break " + onBrk.length + "</p>" +
      (onBrk.length ? '<ul class="gq-onbreak">' + onBrk.map(function (x) { return '<li data-driver-id="' + esc(x.id) + '">' + esc(gqName(x.id)) + " \u2014 On break" + (x.at ? " \u00b7 " + gqMins(x.at) : "") + "</li>"; }).join("") + "</ul>" : "") +
      (onRide.length ? '<ul class="gq-onride">' + onRide.map(function (x) {
        return '<li data-driver-id="' + esc(x.id) + '">' + esc(gqName(x.id)) + " \u2014 On a ride" + (x.onRideSource === "pcs" ? " (PCS ride)" : " (set by driver)") + (x.at ? " \u00b7 " + gqMins(x.at) : "") + "</li>";
      }).join("") + "</ul>" : "");
    var list = !rows.length ? '<p class="muted" id="gq-empty">No riders in the queue.</p>' : '<ol class="gq-list" id="gq-list">' + rows.map(function (r, i) {
      var ride = gqRide(r.code);
      return '<li class="gq-row" data-ride-code="' + esc(r.code) + '"><strong>#' + (i + 1) + " " + esc(ride.name || "Rider") + "</strong> \u00b7 " + esc(r.code) + " \u00b7 waiting " + gqMins(r.queueAt) + "<br>" +
        '<span class="gq-st">' + (r.status === "requested" ? "Open: offered to the next Available driver" : "Needs your OK (Approve booking)") + "</span></li>";
    }).join("") + "</ol>";
    return head + list + (gq.err ? '<p class="error">' + esc(gq.err) + "</p>" : "") +
      '<details class="gq-pin"><summary>Confirm a driver\u2019s new password</summary><p class="muted">Only after the driver really changed it (otherwise someone may have tampered with the roster).</p>' +
      '<input type="text" id="gq-pin-id" placeholder="driver id (e.g. name_example_com)" aria-label="Driver id"><button type="button" class="btn" id="gq-pin-go">Confirm new password</button>' +
      (gq.msg ? '<p class="muted" id="gq-pin-msg">' + esc(gq.msg) + "</p>" : "") + "</details>";
  }
  function gqRender() {
    var el = document.getElementById("queue-list");
    if (!el) return;
    var html = gqPanelHtml();
    if (el.__gqHtml === html) return;
    el.innerHTML = html;
    el.__gqHtml = html;
    var inp = document.getElementById("gq-pw"); if (inp && gq.typed) inp.value = gq.typed; /* the board redraws often: keep what was typed (memory only) */
  }
  document.addEventListener("input", function (ev) { if (ev.target && ev.target.id === "gq-pw") gq.typed = ev.target.value; });
  document.addEventListener("keydown", function (ev) { if (ev.target && ev.target.id === "gq-pw" && ev.key === "Enter") { var b = document.getElementById("gq-load"); if (b) b.click(); } });
  function gqLoad() {
    if (!gq.pw && !gq.tokOn) return Promise.resolve();
    return workerJson("/queue/state", gqAuth()).then(function (d) {
      gq.data = d; gq.err = "";
      if (d && d.godToken) { gqSetTok(d.godToken); gq.tokOn = true; gq.pw = ""; } /* password used once, then only the device token */
    }).catch(function (e) {
      if (e.status === 403 || e.status === 401) { gq.pw = ""; gq.tokOn = false; gqSetTok(""); gq.data = null; var el0 = document.getElementById("queue-list"); if (el0) el0.__gqHtml = ""; }
      gq.err = e.message || "Couldn't load the queue.";
    }).then(gqRender);
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("#gq-load,#gq-pin-go") : null;
    if (!t) return;
    if (t.id === "gq-load") {
      var pw = String((document.getElementById("gq-pw") || {}).value || gq.typed || "");
      if (!pw) return;
      gq.pw = pw; gq.typed = ""; gq.busy = true; gqRender();
      gqLoad().then(function () { gq.busy = false; gqRender(); });
      if (!gq.timer) gq.timer = setInterval(function () { if (document.visibilityState !== "hidden") gqLoad(); }, 20000); /* v77.15: was 6 s */
    }
    if (t.id === "gq-pin-go") {
      var id = String((document.getElementById("gq-pin-id") || {}).value || "").trim().toLowerCase();
      if (!id || (!gq.pw && !gq.tokOn)) return;
      workerJson("/driver/pin-reset", Object.assign(gqAuth(), { driverId: id })).then(function () { gq.msg = "Confirmed for " + id + ". They can log in again now."; })
        .catch(function (e) { gq.msg = e.message || "Couldn't confirm."; }).then(function () { gq.__force = 1; var el = document.getElementById("queue-list"); if (el) el.__gqHtml = ""; gqRender(); });
    }
  });
  setInterval(gqRender, 3000);

  window.__pcsQueueGod = { panel: gqPanelHtml, render: gqRender, state: function () { return gq; } };
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

  /* v73 (Matthew 10/13): God mode view of a driver's 14-day Driver's Log (read-only; nothing is deleted, older days stay on file) */
  function godDriverLogData(id, now) {
    now = now || Date.now();
    var j = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    return Promise.all([j(milesUrl(id)), j(baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(id) + ".json"), godRosterRow(id)]).then(function (res) {
      var miles = res[0] || {}, hl = res[1] || {}, ro = res[2] || {}, duty = [], drive = [], breaks = [], offline = [], overrides = [];
      var iv = function (o, arr) { if (o && typeof o === "object") Object.keys(o).forEach(function (k) { var v = o[k] || {}; var s0 = Number(v.s), e0 = Number(v.e) || s0; if (v.open && !(e0 > s0)) e0 = now; if (s0 > 0 && e0 > s0) arr.push([s0, e0]); }); };
      Object.keys(hl).forEach(function (k) { if (/^\d+$/.test(k)) { var v = hl[k] || {}; if (Number(v.s) > 0 && Number(v.e) > Number(v.s)) duty.push([Number(v.s), Number(v.e)]); } });
      iv(hl.drive, drive); iv(hl.breaks, breaks); iv(hl.offline, offline);
      if (hl.overrides && typeof hl.overrides === "object") Object.keys(hl.overrides).forEach(function (k) { var v = hl.overrides[k]; if (v && typeof v === "object") overrides.push(Object.assign({ at: Number(v.grantedAt || v.at || k) || 0 }, v)); });
      Object.keys(miles).forEach(function (d) { var r = miles[d] || {}, sh = r.shifts || {};
        Object.keys(sh).forEach(function (k) { var x = sh[k] || {}, a = Number(x.shiftStartedAt) || Number(k), b = Number(x.shiftEndedAt) || 0; if (!x.hosExcluded && a > 0 && b > a && !duty.some(function (g) { return g[0] < b && g[1] > a; })) duty.push([a, b]); }); });
      var pres = (state.drivers || []).concat(state.offlineDrivers || []).filter(function (x) { return x && x.id === id; })[0] || {};
      var sg = hl.signs || {}, dv = hl.dvir || {};
      return { signOf: function (d) { return sg[d] || null; }, dvirOf: function (d, k) { return (dv[d] || {})[k] || null; }, now: now, days: Math.max(15, Number(state.dlDays && state.dlDays[id]) || 15), snapshots: hl.days && typeof hl.days === "object" ? hl.days : {},
        more: function (n) { state.dlDays = state.dlDays || {}; state.dlDays[id] = n; godDriverLogData(id).then(function (d2) { window.PCSDriverLog.open(window.PCSDriverLog.build(d2), d2, "history:" + (n - 1)); }); },
        duty: duty, drive: drive, breaks: breaks, offline: offline, rows: miles, overrides: overrides,
        driver: ro.name || pres.name || id, vehicle: { year: ro.carYear || pres.carYear || "", make: ro.carMake || pres.carMake || "", model: ro.carModel || pres.carModel || "", plate: ro.carPlate || pres.carPlate || "" } };
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-driver-log]") : null;
    if (!b || !window.PCSDriverLog) return;
    e.preventDefault();
    godDriverLogData(b.getAttribute("data-driver-log")).then(function (d) { window.PCSDriverLog.open(window.PCSDriverLog.build(d), d, "all"); });
  });
  /* v73 DVIR: defects flagged in God mode; an "unsafe" defect blocks the driver from going Available until cleared here (reason logged) */
  state.dvirFlags = [];
  /* v77.17 (Matthew 6:20 AM "last car wash not recorded yet" for every driver): the wash dates were only fetched inside
     dvirLoad (1.5 s after open, then every 60 s while visible). If the roster wasn't loaded at 1.5 s (or the tab was hidden at
     each tick) nothing was fetched and the card said "not recorded yet". Now: fetched for any driver not yet tried as soon as
     the roster arrives, on return to the tab, and by dvirLoad; a fetch error keeps the last known date; and the card says
     "checking..." until the first answer. Read-only. */
  state.lastWashTried = state.lastWashTried || {};
  function lastWashLoad(list, all) {
    state.lastWash = state.lastWash || {};
    var want = (list || []).filter(function (id) { return id && (all || !state.lastWashTried[id]); });
    if (!want.length) return Promise.resolve();
    return Promise.all(want.map(function (id) {
      return fetch(baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(id) + "/lastWash.json").then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
        .then(function (w) { state.lastWashTried[id] = Date.now(); if (w && w.date) state.lastWash[id] = w; else delete state.lastWash[id]; })
        .catch(function () { if (!state.lastWashTried[id]) state.lastWashTried[id] = -1; }); /* keep the last known date on errors */
    })).then(function () { try { dvirPaint(); } catch (e) {} });
  }
  window.__pcsLastWashLoad = lastWashLoad; /* test hook */
  function dvirLoad() {
    var ids = {}; Object.keys(state.roster || {}).forEach(function (k) { ids[k] = 1; }); (state.drivers || []).concat(state.offlineDrivers || []).forEach(function (d) { if (d && d.id) ids[d.id] = 1; });
    var since = Date.now() - 15 * 86400000;
    var revP = dvirRevLoad(); /* r2 */
    state.lastWash = state.lastWash || {}; /* v77.9: last car wash per driver (post-trip Yes) */
    lastWashLoad(Object.keys(ids), true); /* v77.17: shared loader (also runs as soon as the roster arrives) */
    return Promise.all(Object.keys(ids).map(function (id) {
      return revP.then(function () { return fetch(baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(id) + "/dvir.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (o) {
        var out = [], L = window.PCSDriverLog, cp = 0; Object.keys(o || {}).forEach(function (d) { var p = o[d] && o[d].pre; if (p && !p.unsafe && Number(p.at) > cp) cp = Number(p.at); }); /* v77.15: newest clean pre-trip */ Object.keys(o || {}).forEach(function (d) { var ek = Object.keys((o[d] && o[d].earlier) || {}); ["pre", "post", "avail"].concat(ek).forEach(function (k0) { var k = String(k0).split("-")[0], r = o[d] && (k0 === k ? o[d][k] : o[d].earlier[k0]); /* v76h: earlier same-day inspections (other shifts) are checked too */
          var rpath = d + "/" + (k0 === k ? k : "earlier/" + k0); /* v77.10: Dismiss (reviewed, Worker KV) */
          if (r && L && L.recView) { var fw = "", fd = Infinity; ["pre", "post"].forEach(function (q) { var y = o[d][q], dt = y && y.items && y.items.carwash && y.items.carwash.date; if (dt && Math.abs(Number(y.at) - Number(r.at)) < fd) { fd = Math.abs(Number(y.at) - Number(r.at)); fw = dt; } }); if (L.newerWash && state.lastWash && state.lastWash[id] && state.lastWash[id].date) fw = L.newerWash(fw, state.lastWash[id].date); /* v77.15: a later recorded wash clears the car-wash block */ r = L.recView(r, k, { dvirItems: state.dvirCfg }, fw); if (r && r.unsafe && !r.cleared && cp && Number(r.at) > 0 && Number(r.at) < cp && (r.blocks || []).length && r.blocks.every(function (b) { return !!b && (b.k === "carwash" || /days since last wash|^not checked in|never checked/.test(String(b.why || ""))); })) r = Object.assign({}, r, { unsafe: false, superseded: true }); /* v77.15 (Harry): older wash/stale-only block (photo = Cracks, needs God approve) + newer clean pre-trip; real defects keep blocking */ } /* v76g: today's car-wash rule (old 48 h records, post-trips never block) */
          if (r && (r.unsafe || r.defects > 0 || r.notes > 0 || r.motion === "unverified") && (Number(r.at) > since || (r.unsafe && !r.cleared)) && !dvirHidden(r, (state.dvirRev || {})["dvir:" + id + ":" + rpath])) out.push({ id: id, day: d, kind: k, r: r, path: rpath }); }); });
        return out; }); });
    })).then(function (lists) { state.dvirFlags = [].concat.apply([], lists).sort(function (a, b) { return Number(b.r.at) - Number(a.r.at); });
      return fetch(baseUrl() + "/rides/DVRMSSNG.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }).then(function (m) {
      state.dvirMiss = Object.keys(m || {}).map(function (k) { return m[k] && typeof m[k] === "object" ? Object.assign({ key: k }, m[k]) : null; }).filter(function (x) { return x && x.driver && !x.resolvedAt && !(state.dvirRev || {})["miss:" + x.key]; }); dvirPaint(); }); /* v77.10: reviewed = dismissed */
  }
  state.dvirVeh = {};
  function dvirVehLoad() { return fetch(baseUrl() + "/rides/DVIRVEH.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (o) { state.dvirVeh = o || {}; dvirPaint(); }); }
  function dvirVehHtml() { /* registration / insurance: red when expired, amber within 30 days */
    var L = window.PCSDriverLog, rows = [];
    if (!L) return "";
    Object.keys(state.dvirVeh || {}).forEach(function (pl) { var v = state.dvirVeh[pl] || {}; [["regexp", "Registration"], ["insexp", "Insurance card"]].forEach(function (f) {
      var st = L.expiryState(v[f[0]]); if (st === "expired" || st === "soon") rows.push('<div class="god-dvir-exp god-dvir-exp-' + st + '" style="padding:4px 0;color:' + (st === "expired" ? "#ff9b9b" : "#f0d48a") + '">' + esc(pl) + (v.vehicle ? " (" + esc(v.vehicle) + ")" : "") + " \u00b7 " + f[1] + (st === "expired" ? " EXPIRED " : " expires ") + esc(v[f[0]]) + "</div>"); }); });
    return rows.length ? '<div class="card" style="border:2px solid #b45309;background:#2a2112;color:#fff;padding:10px;margin:8px 0"><b>Vehicle paperwork</b>' + rows.join("") + "</div>" : "";
  }
  function lastWashHtml() { /* v77.9 (Matthew 10/20): the date each driver last tapped Yes on "Did you get your car washed today?" */
    var L = window.PCSDriverLog, lw = state.lastWash || {}, ids = {}; Object.keys(state.roster || {}).forEach(function (k) { ids[k] = 1; }); Object.keys(lw).forEach(function (k) { ids[k] = 1; });
    var rows = Object.keys(ids).map(function (id) { var w = lw[id], ws = w && L && L.washState ? L.washState(w.date, Date.now(), { block: true, maxAgeDays: 3 }) : null;
      var col = !w ? "#f0d48a" : ws && ws.block ? "#ff9b9b" : "#9be7b0";
      return '<div class="god-last-wash" data-wash-driver="' + esc(id) + '" style="padding:4px 0;color:' + col + '">' + esc(gqName(id) || id) + " \u00b7 last car wash " + (w ? esc(L && L.washLastText ? L.washLastText(w.date) : w.date) + (w.plate ? " (" + esc(w.plate) + ")" : "") + (ws && ws.block ? " \u00b7 over 3 days: going online is paused (Clear (override) below)" : "") : (state.lastWashTried && state.lastWashTried[id] > 0 ? "not recorded yet" : "checking\u2026")) + "</div>"; }); /* v77.17 */
    return rows.length ? '<div class="card god-wash-card" style="border:2px solid #2e7d32;background:#12261a;color:#fff;padding:10px;margin:8px 0"><b>Car wash</b>' + rows.join("") + "</div>" : "";
  }
  /* v77.10 (Matthew 10/20): Dismiss reviewed notes. A note hides once God marks it reviewed {by, at}; the record stays in Firebase
     (history). An UNSAFE item that still blocks the driver can't be dismissed: it keeps Clear (override). Pure (tested). */
  function dvirDismissable(r) { return !!r && !(r.unsafe && !r.cleared); }
  function dvirHidden(r, rev) { return !!(r && rev && rev.at && dvirDismissable(r)); } /* r2: reviewed marks come ONLY from the Worker (KV), never Firebase */
  function dvirReviewedRec(who, now) { return { by: String(who || "God").slice(0, 60), at: now || Date.now() }; }
  var DSM_BTN = ' style="background:#2e7d32;color:#fff;border:0;border-radius:10px;font-weight:800;font-size:17px;min-height:48px;padding:10px 16px;margin:6px 6px 0 0"';
  function dvirRef(kind, item) { /* pure (tested): Worker reference for one note */
    return kind === "miss" ? "miss:" + String(item.key) : "dvir:" + String(item.id) + ":" + String(item.path);
  }
  function dvirDismissUrls(kind, item) { return [dvirRef(kind, item)]; } /* r2: kept name; now returns Worker refs */
  function dvirRevLoad() { return atxPost("/god/dvir/reviewed", {}).then(function (d) { state.dvirRev = d.reviewed || {}; }).catch(function () { state.dvirRev = state.dvirRev || {}; }); }
  function dvirDismiss(list) { /* r2 (Harry M2): God-only Worker endpoint, never a browser PUT to Firebase */
    var chunks = []; for (var i = 0; i < list.length; i += 100) chunks.push(list.slice(i, i + 100));
    return chunks.reduce(function (p, c) { return p.then(function () { return atxPost("/god/dvir/review", { refs: c, by: godWho() }).then(function (d) { state.dvirRev = d.reviewed || state.dvirRev; }); }); }, Promise.resolve())
      .then(dvirLoad).catch(function (e) { window.alert("Couldn't save: " + String(e && e.message || e)); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-dvir-dismiss],[data-dvir-dismiss-all]") : null; if (!b) return;
    var all = b.getAttribute("data-dvir-dismiss-all"), urls = [];
    if (all === "miss") (state.dvirMiss || []).forEach(function (x) { urls = urls.concat(dvirDismissUrls("miss", x)); });
    else if (all === "dvir") (state.dvirFlags || []).filter(function (x) { return dvirDismissable(x.r); }).forEach(function (x) { urls = urls.concat(dvirDismissUrls("dvir", x)); });
    else { var a = b.getAttribute("data-dvir-dismiss").split("|"); urls = a[0] === "miss" ? dvirDismissUrls("miss", { key: a[1] }) : dvirDismissUrls("dvir", { id: a[1], path: a[2] }); }
    if (!urls.length) return;
    if (all && !window.confirm("Mark all " + urls.length + " as reviewed? They stay in the history.")) return;
    b.disabled = true; dvirDismiss(urls);
  });
  function dvirPaint() {
    var host = document.getElementById("god-dvir-alerts");
    if (!host) { host = document.createElement("div"); host.id = "god-dvir-alerts"; var m = document.querySelector("main") || document.body; m.insertBefore(host, m.firstChild); }
    var f = state.dvirFlags || [];
    var mi = state.dvirMiss || [];
    host.innerHTML = (mi.length ? '<div class="card god-dvir-missed" style="border:2px solid #b91c1c;background:#2a1212;color:#fff;padding:10px;margin:8px 0"><b>Missed post-trip inspection</b>' + mi.map(function (x) {
        return '<div style="border-top:1px solid #733;padding:6px 0">' + esc(gqName(x.driver) || x.name || x.driver) + " \u00b7 shift " + esc(x.day) + " ended without a post-trip. Flag for review; the driver\u2019s next login still starts with a pre-trip." +
          '<br><button type="button" class="btn god-dvir-dismiss" data-dvir-dismiss="' + esc("miss|" + x.key) + '"' + DSM_BTN + ">Dismiss</button></div>"; }).join("") +
        (mi.length > 1 ? '<button type="button" class="btn god-dvir-dismiss-all" data-dvir-dismiss-all="miss"' + DSM_BTN + ">Clear all reviewed</button>" : "") + "</div>" : "") +
      dvirVehHtml() + lastWashHtml() + (!f.length ? "" : '<div class="card" style="border:2px solid #b91c1c;background:#2a1212;color:#fff;padding:10px;margin:8px 0"><b>Vehicle inspection defects (DVIR)</b>' + f.map(function (x) {
      var defs = Object.keys(x.r.items || {}).filter(function (k) { var it = x.r.items[k]; return ((it.bad || it.s === "defect") && !it.optional) || it.noteFlag; }).map(function (k) { var it = x.r.items[k]; return esc((it.group ? it.group + " " : "") + (it.label || k)) + (it.answer ? " = " + esc(it.answer) : "") + (it.expiry === "expired" ? " EXPIRED " + esc(it.date || "") : "") + (it.needsApproval ? " (photo needs approval)" : it.stale ? " (over 3 full days since last wash)" : it.blocking || it.safe === false ? " (NOT safe)" : "") + (it.noteFlag ? " (note, not unsafe)" : "") + (it.fuelAckAt ? " \u00b7 reminder acknowledged " + esc(new Date(it.fuelAckAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })) : "") + (it.warn ? ' <b style="color:#ff9b9b">\u26a0 ' + esc(it.warn) + "</b>" : "") + (it.note ? ": " + esc(it.note) : "") + ((it.photos || []).length ? " \u00b7 " + it.photos.length + " photo(s)" : ""); }).join("; ");
      return '<div class="god-dvir-flag" data-dvir-driver="' + esc(x.id) + '" style="border-top:1px solid #733;padding:6px 0">' + esc(gqName(x.id)) + " \u00b7 " + esc(x.day) + " " + (x.kind === "pre" ? "pre-trip" : x.kind === "avail" ? "Available check" : "post-trip") + (x.r.startedAt ? ' <span class="fine god-dvir-dur">(' + esc(new Date(x.r.startedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })) + "\u2013" + esc(new Date(x.r.finishedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })) + ", took " + Math.floor(x.r.durationSec / 60) + "m " + ("0" + (x.r.durationSec % 60)).slice(-2) + "s)</span>" : "") + (x.r.motion === "unverified" ? ' <span class="badge" style="background:#7c5c00">motion unverified (no GPS)</span>' : "") + " \u00b7 " + defs +
        (x.r.unsafe ? (x.r.cleared ? ' <span class="badge">Cleared by ' + esc(x.r.cleared.by) + ": " + esc(x.r.cleared.reason) + "</span>"
          : ' <b style="color:#ff9b9b">UNSAFE \u2013 driver blocked from Available</b>' + ((x.r.blocks || []).length ? ' <span class="fine">(' + x.r.blocks.map(function (b) { return esc(b.label) + (b.why === "photo" ? " photo" : b.why !== "defect" ? " " + esc(b.why) : ""); }).join(", ") + ")</span>" : "") +
            Object.keys(x.r.items || {}).filter(function (k) { return x.r.items[k].needsApproval; }).map(function (k) { return '<div class="god-dvir-photos">' + (x.r.items[k].photos || []).map(function (ph) { return /^data:image\//.test(ph) ? '<img src="' + esc(ph) + '" alt="Windshield photo" style="height:90px;margin:4px 4px 0 0;border-radius:4px">' : ""; }).join("") + "</div>"; }).join("") +
            (x.r.rejected ? ' <span class="badge">Photo rejected by ' + esc(x.r.rejected.by) + ": " + esc(x.r.rejected.reason) + "</span>" : "") +
            (Object.keys(x.r.items || {}).some(function (k) { return x.r.items[k].needsApproval; })
              ? ' <button type="button" class="btn btn-gold" data-dvir-approve="' + esc(x.id + "|" + x.day + "|" + x.kind + "|" + x.path) + '">Approve photo' + ((x.r.blocks || []).length > 1 ? " & clear" : "") + '</button> <button type="button" class="btn btn-ghost" data-dvir-reject="' + esc(x.id + "|" + x.day + "|" + x.kind + "|" + x.path) + '">Reject photo</button>'
              : ' <button type="button" class="btn btn-gold" data-dvir-clear="' + esc(x.id + "|" + x.day + "|" + x.kind + "|" + x.path) + '">Clear (override)</button>')) : "") +
        (dvirDismissable(x.r) ? '<br><button type="button" class="btn god-dvir-dismiss" data-dvir-dismiss="' + esc("dvir|" + x.id + "|" + x.path) + '"' + DSM_BTN + ">Dismiss</button>" : "") + "</div>";
    }).join("") + (f.filter(function (x) { return dvirDismissable(x.r); }).length > 1 ? '<button type="button" class="btn god-dvir-dismiss-all" data-dvir-dismiss-all="dvir"' + DSM_BTN + ">Clear all reviewed</button>" : "") + "</div>");
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-dvir-clear],[data-dvir-approve],[data-dvir-reject]") : null; if (!b) return;
    var ap = b.hasAttribute("data-dvir-approve"), rj = b.hasAttribute("data-dvir-reject");
    var a = b.getAttribute(ap ? "data-dvir-approve" : rj ? "data-dvir-reject" : "data-dvir-clear").split("|"), reason = (window.prompt(ap ? "Approve the windshield photo. Note (logged):" : rj ? "Reason for rejecting the photo (logged; the driver stays blocked):" : "Reason for clearing this unsafe defect (logged):", ap ? "Photo approved" : "") || "").trim();
    if (reason.length < 3) return;
    /* v77.15 (Anson 10/20): write to the EXACT record shown (earlier same-day pre-trips, Available checks), not always day/kind */
    var rp = a[3] && /^\d{4}-\d{2}-\d{2}\/(?:pre|post|avail|earlier\/[A-Za-z0-9_-]{1,40})$/.test(a[3]) ? a[3] : a[1] + "/" + a[2];
    if (!/^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_\/-]{1,60}$/.test(rp)) return;
    if (rj) { var rr = { by: godWho(), at: Date.now(), reason: reason.slice(0, 200) }, ub = baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(a[0]);
      fetch(ub + "/dvir/" + rp + "/rejected.json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rr) })
        .then(function () { return fetch(ub + "/overrides/" + rr.at + ".json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ kind: "dvir-photo-rejected", day: a[1], inspection: a[2], path: rp }, rr)) }); })
        .then(dvirLoad).catch(function () { window.alert("Couldn't save. Try again."); }); return; }
    var rec = { by: godWho(), at: Date.now(), reason: reason.slice(0, 200) }; if (ap) rec.photoApproved = true;
    var put = function (u, body) { return fetch(u, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); };
    put(baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(a[0]) + "/dvir/" + rp + "/cleared.json", rec)
      .then(function () { return put(baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(a[0]) + "/overrides/" + rec.at + ".json", Object.assign({ kind: ap ? "dvir-photo-approved" : "dvir-unsafe-cleared", day: a[1], inspection: a[2], path: rp, grantedAt: rec.at }, rec)); })
      .then(dvirLoad).catch(function () { window.alert("Couldn't clear it. Try again."); });
  });
  /* v77.10: God-only "Ping driver": the Worker sends "PCS: please open your driver app so dispatch can see you." to the driver's
     phone (driver-app alerts). Nothing else is sent; 1 ping per driver per minute. */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-ping-driver]") : null; if (!b || b.disabled) return;
    var id = b.getAttribute("data-ping-driver"); b.disabled = true;
    atxPost("/god/ping", { driverId: id }).then(function (d) {
      state.boardNotice = d.sent ? "Ping sent to " + gqName(id) + "." : "Ping didn\u2019t reach " + gqName(id) + ": " + (d.why === "no_device" ? "their app alerts aren\u2019t turned on yet. Call them instead." : d.why === "wait" ? "wait a minute between pings." : "alerts are off on the server.");
    }).catch(function (er) { state.boardNotice = "Ping didn\u2019t go out: " + String(er && er.message || er); }).then(function () { b.disabled = false; renderBoardLists(); try { render(); } catch (x) {} });
  });
  /* v74b (Matthew): God mode "Log out driver": ends the shift, Offline / logged out, reason + time in the Driver's Log
     (rides/DRVRHSLG/{id}/overrides/{at} kind "forced logout"); the driver app sees rides/DRVRHSLG/{id}/forceLogout on its next sync. */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-force-logout]") : null; if (!b || b.disabled) return;
    var id = b.getAttribute("data-force-logout"), reason = (window.prompt("Log out " + gqName(id) + "? Reason (logged in the Driver\u2019s Log):") || "").trim();
    if (reason.length < 3) return;
    var at = Date.now(), rec = { at: at, by: godWho(), reason: reason.slice(0, 200) }, ub = baseUrl() + "/rides/DRVRHSLG/" + encodeURIComponent(id);
    var send = function (u, m, body) { return fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); };
    b.disabled = true;
    send(ub + "/forceLogout.json", "PUT", rec)
      .then(function () { return send(ub + "/overrides/" + at + ".json", "PUT", Object.assign({ kind: "forced logout", grantedAt: at }, rec)); })
      .then(function () { return send(baseUrl() + "/rides/AVLBLDRV/drivers/" + encodeURIComponent(id) + ".json", "PATCH", { online: false, shiftOnline: false, driverOffline: false, loggedIn: false, forcedLogoutAt: at, updatedAt: at }); })
      .then(function () { b.textContent = "Logged out (driver app returns to login on next sync)"; })
      .catch(function () { b.disabled = false; window.alert("Couldn't log the driver out. Try again."); });
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { try { dvirLoad(); } catch (e) {} } }); /* v77.17 */
  setTimeout(dvirLoad, 1500); setInterval(function () { if (document.visibilityState !== "hidden") dvirLoad(); }, 60000); /* v77.15 */ setTimeout(dvirVehLoad, 1600); setInterval(dvirVehLoad, 60000);
  /* v73: God-editable DVIR checklist (rides/DVIRCFG = { items: [{k, label, required}], updatedAt, by }). Optional items never flag or block. */
  var DVIR_DEFAULT = window.PCSDriverLog ? window.PCSDriverLog.items({}) : [];
  state.dvirCfg = null;
  function dvirCfgLoad() { return fetch(baseUrl() + "/rides/DVIRCFG.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (o) {
    if (!state.dvirCfgEditing) { state.dvirCfg = o && Array.isArray(o.items) && o.items.length ? o.items : DVIR_DEFAULT.slice(); state.dvirFluidsDays = (o && Number(o.fluidsDays) > 0) ? Math.round(Number(o.fluidsDays)) : 7; } dvirCfgPaint(); }); }
  function dvirCfgPaint() {
    var host = document.getElementById("god-dvir-cfg");
    if (!host) { host = document.createElement("details"); host.id = "god-dvir-cfg"; host.className = "card"; var a = document.getElementById("god-dvir-alerts"); if (!a) { dvirPaint(); a = document.getElementById("god-dvir-alerts"); } a.parentNode.insertBefore(host, a.nextSibling); }
    var open = host.open, list = state.dvirCfg || [];
    host.innerHTML = "<summary><b>Vehicle inspection checklist (DVIR)</b> \u00b7 " + list.length + " items</summary>" +
      '<p class="fine">Required items can be marked unsafe (blocks Available until cleared). Optional items are noted only and never flag or block.</p>' +
      list.map(function (it, i) { return '<div class="dvir-cfg-row" data-i="' + i + '" style="display:flex;gap:6px;align-items:center;margin:4px 0">' + (it.group ? '<span class="fine" style="min-width:80px">' + esc(it.group) + "</span>" : "") + '<input type="text" class="dvir-cfg-label" data-i="' + i + '" value="' + esc(it.label) + '" maxlength="120" style="flex:1">' +
        '<span class="fine">' + esc(it.type === "date" ? (it.k === "regexp" ? "month/year MM/YYYY" : "date MM/DD/YYYY") + (it.expiry ? " (expiry)" : "") : (it.opts || []).map(function (o) { return o.label + (o.bad ? (it.noteOnly ? " (note)" : " (bad)") : ""); }).join(" / ") + (Array.isArray(it.kinds) && it.kinds.length === 1 ? " \u00b7 " + (it.kinds[0] === "post" ? "post-trip only" : "pre-trip only") : "")) + "</span>" +
        '<label><input type="checkbox" class="dvir-cfg-req" data-i="' + i + '"' + (it.required !== false ? " checked" : "") + "> Required</label>" +
        (it.noteOnly ? "" : '<label title="Driver can\u2019t go Available until God clears it"><input type="checkbox" class="dvir-cfg-block" data-i="' + i + '"' + (it.block ? " checked" : "") + "> Blocks</label>") +
        '<button type="button" class="btn btn-ghost dvir-cfg-del" data-i="' + i + '">Remove</button></div>'; }).join("") +
      ((window.PCSDriverLog && window.PCSDriverLog.EXTRAS) || []).filter(function (x) { return !list.some(function (it) { return it.k === x[0]; }); }).map(function (x) {
        return '<button type="button" class="btn btn-ghost dvir-cfg-extra" data-k="' + esc(x[0]) + '">+ ' + esc(x[1]) + " (optional)</button> "; }).join("") +
      '<p style="margin:8px 0"><label>Fluids check every <input type="number" id="dvir-cfg-fluids" min="1" max="60" step="1" inputmode="numeric" style="width:64px" value="' + esc(String(state.dvirFluidsDays || 7)) + '"> days</label> <span class="fine">(also due each Sat/Sun if not done that weekend)</span></p>' +
      '<button type="button" class="btn btn-ghost" id="dvir-cfg-add">+ Add item</button> <button type="button" class="btn btn-gold" id="dvir-cfg-save">Save checklist</button> <span id="dvir-cfg-msg" class="fine"></span>';
    host.open = open;
  }
  document.addEventListener("input", function (e) { var t = e.target; if (!t.classList) return;
    if (t.classList.contains("dvir-cfg-label")) { state.dvirCfgEditing = true; state.dvirCfg[+t.getAttribute("data-i")].label = t.value; }
    if (t.id === "dvir-cfg-fluids") { state.dvirCfgEditing = true; state.dvirFluidsDays = Math.max(1, Math.min(60, Math.round(Number(t.value) || 7))); }
    if (t.classList.contains("dvir-cfg-req")) { state.dvirCfgEditing = true; state.dvirCfg[+t.getAttribute("data-i")].required = t.checked; } });
  document.addEventListener("change", function (e) { var t = e.target; if (t.classList && t.classList.contains("dvir-cfg-block")) { state.dvirCfgEditing = true; state.dvirCfg[+t.getAttribute("data-i")].block = t.checked; } if (t.classList && t.classList.contains("dvir-cfg-req")) { state.dvirCfgEditing = true; state.dvirCfg[+t.getAttribute("data-i")].required = t.checked; } });
  document.addEventListener("click", function (e) { var t = e.target; if (!t || !t.closest) return;
    if (t.classList.contains("dvir-cfg-del")) { state.dvirCfgEditing = true; state.dvirCfg.splice(+t.getAttribute("data-i"), 1); dvirCfgPaint(); }
    else if (t.classList.contains("dvir-cfg-extra")) { var ex = (window.PCSDriverLog.EXTRAS || []).filter(function (x) { return x[0] === t.getAttribute("data-k"); })[0]; if (ex) { state.dvirCfgEditing = true; state.dvirCfg.push({ k: ex[0], label: ex[1], required: false }); dvirCfgPaint(); } }
    else if (t.id === "dvir-cfg-add") { state.dvirCfgEditing = true; state.dvirCfg.push({ k: "item" + Date.now().toString(36), label: "New item", type: "choice", opts: [{ label: "Yes", bad: false }, { label: "No", bad: true }], required: true }); dvirCfgPaint(); }
    else if (t.id === "dvir-cfg-save") {
      var items = state.dvirCfg.filter(function (x) { return x && String(x.label || "").trim(); }).map(function (x) { return Object.assign({}, x, { label: String(x.label).trim().slice(0, 120), required: x.required !== false }); });
      fetch(baseUrl() + "/rides/DVIRCFG.json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: items, fluidsDays: state.dvirFluidsDays || 7, updatedAt: Date.now(), by: godWho() }) })
        .then(function (r) { if (!r.ok) throw new Error(); state.dvirCfgEditing = false; return dvirCfgLoad(); }).then(function () { var m = document.getElementById("dvir-cfg-msg"); if (m) m.textContent = "Saved."; })
        .catch(function () { var m = document.getElementById("dvir-cfg-msg"); if (m) m.textContent = "Couldn't save. Try again."; });
    } });
  setTimeout(dvirCfgLoad, 1800);
  window.__godDvir = { cfgLoad: function () { return dvirCfgLoad(); }, load: dvirLoad, flags: function () { return state.dvirFlags; } };
  window.__godDriverLog = { data: godDriverLogData };

  /* ================= v74d (Matthew 10/13): driver-fault alerts (Worker v69.13) =================
     The Worker watches every accepted ride and flags: driver cancelled, driver un-accepted, or driver not at the pickup
     5 min after the ETA / scheduled time. Client or passenger no-shows / cancels never flag. Each alert also arrives as a
     phone push. Here: poll POST /god/driver-alerts (God token) every 15 s; each new alert pops an urgent pop-up with the
     ride chime that rings until OK (OK marks it seen on every device). */
  var DLW_SEEN_KEY = "pcs-god-dlw-seen";
  function dlwSeen() { try { return JSON.parse(localStorage.getItem(DLW_SEEN_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function dlwMarkSeen(id) { try { var m = dlwSeen(); m[id] = Date.now(); var ks = Object.keys(m); if (ks.length > 200) ks.sort(function (a, b) { return m[a] - m[b]; }).slice(0, ks.length - 200).forEach(function (k) { delete m[k]; }); localStorage.setItem(DLW_SEEN_KEY, JSON.stringify(m)); } catch (e) {} }
  var dlwBusy = false;
  function dlwLoad() {
    if (dlwBusy || !(gq.pw || gqTok())) return;
    dlwBusy = true;
    workerJson("/god/driver-alerts", gqAuth()).then(function (d) {
      dlwBusy = false;
      if (d && d.godToken) { gqSetTok(d.godToken); gq.tokOn = true; }
      state.driverAlerts = (d && d.alerts) || [];
      var seen = dlwSeen();
      state.driverAlerts.slice().reverse().forEach(function (a) {
        if (!a || !a.id || a.ackAt || seen[a.id] || Date.now() - Number(a.at || 0) > 12 * 3600000) return;
        queueGodPopup("dlw", { code: a.id, alert: a });
      });
      syncGodAlarm();
    }).catch(function () { dlwBusy = false; });
  }
  function dlwAck(id) {
    dlwMarkSeen(id);
    if (gq.pw || gqTok()) workerJson("/god/driver-alerts", Object.assign({ ack: id }, gqAuth())).catch(function () {});
  }
  function renderGodDriverAlertPopup(item) {
    var a = item.alert || {}, key = "dlw:" + item.code;
    var head = a.kind === "late" ? "Driver late to pickup" : (a.kind === "cancel" ? "Driver cancelled a ride" : "Driver dropped an accepted ride");
    var when = a.at ? new Date(Number(a.at)).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CT" : "";
    var el = godPopupShell("gp-request gp-waiting gp-dlw",
      '<p class="gp-title" style="color:#ff6b6b">&#9888;&#65039; URGENT: ' + esc(head) + "</p>" +
      '<div class="gp-row"><b>Driver</b>' + esc(a.driverName || a.driverId || "—") + "</div>" +
      '<div class="gp-row"><b>Ride code</b>' + esc(a.code || "") + "</div>" +
      '<div class="gp-row"><b>What happened</b>' + esc(a.body || a.reason || "") + "</div>" +
      (when ? '<div class="gp-row"><b>Flagged</b>' + esc(when) + "</div>" : "") +
      '<p class="gp-row" style="font-size:13px;opacity:.85">Logged on the ride and the driver\u2019s record. Client no-shows or cancels never trigger this.</p>' +
      '<div class="gp-actions"><button type="button" class="gp-ok" id="gp-dlw-ok">OK</button></div>');
    el.addEventListener("click", function (ev) {
      if (ev.target && ev.target.id === "gp-dlw-ok") { dlwAck(item.code); hideGodRidePopup(key); }
    });
  }
  setTimeout(dlwLoad, 2500); setInterval(function () { if (document.visibilityState !== "hidden") dlwLoad(); }, 30000); /* v77.15: was 15 s */
  window.pcsGodDriverAlerts = { load: dlwLoad, ack: dlwAck }; /* test hook */
})();
/* v75p+numpad (Matthew): every money/number box in God mode opens the number pad. decimal = dollars/percent/hours, numeric = whole counts (miles, days, PIN). Runs after every render. */
(function () { if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  function fix(el) { if (!el || el.tagName !== "INPUT" || el.readOnly || el.dataset.pcsPad) return;
    var t = el.type, im = el.getAttribute("inputmode"); if (t !== "number" && im !== "decimal" && im !== "numeric") return;
    var whole = im === "numeric" || (t === "number" && el.step && Number(el.step) % 1 === 0 && !/decimal/.test(im || ""));
    if (t === "number") el.type = "text";
    if (t === "password") { el.setAttribute("pattern", "[0-9]*"); el.dataset.pcsPad = "1"; return; }
    el.setAttribute("inputmode", whole ? "numeric" : "decimal");
    if (!el.getAttribute("pattern")) el.setAttribute("pattern", whole ? "[0-9]*" : "[0-9]*[.]?[0-9]*");
    el.setAttribute("autocomplete", "off"); el.setAttribute("autocorrect", "off"); el.setAttribute("spellcheck", "false"); el.dataset.pcsPad = "1"; }
  function scan(root) { if (!root || !root.querySelectorAll) return; if (root.tagName === "INPUT") fix(root); [].forEach.call(root.querySelectorAll("input"), fix); }
  function go() { scan(document.body); new MutationObserver(function (ms) { ms.forEach(function (m) { [].forEach.call(m.addedNodes, scan); }); }).observe(document.body, { childList: true, subtree: true }); }
  if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  window.pcsNumPad = scan; /* test hook */
})();
