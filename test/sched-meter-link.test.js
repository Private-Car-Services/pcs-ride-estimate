/* v2.0m-bm (Matthew/Harry 11/11, Mike Black 6 PM): while a scheduled ride is headed / at the pickup the standalone
   Metered ride Start is blocked; a "(Metered ride)" booking runs the visible meter on that same ride from
   "Rider is in - start the ride", and once paid that one ride is completed and the driver is free (one session, no $0 step).
   Firebase is a test double: every write is recorded, nothing leaves this process. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const SRC = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
const DB = "https://example.test";

function el() {
  return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {}, remove: function () {} };
}
function loadApp() {
  const store = {
    "pcs-driver-session": "mwragge@privatetaxiservices.net",
    "pcs-driver-account": JSON.stringify({ carYear: 2022, carSeats: 6, carMake: "Chevrolet", carModel: "Suburban", carPlate: "ABC1234", carColor: "Black", carPhoto: "data:image/jpeg;base64,/9j/4AAQSkZJRg==", name: "Matthew Wragge" })
  };
  const writes = [];
  const appEl = Object.assign(el(), { innerHTML: "", querySelector: function () { return null; }, querySelectorAll: function () { return []; }, contains: function () { return false; }, children: [], firstChild: null });
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function (url, opts) {
      const m = (opts && opts.method) || "GET";
      if (m !== "GET") writes.push({ url: String(url), method: m, body: opts && opts.body ? JSON.parse(opts.body) : null });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(null); }, text: function () { return Promise.resolve("null"); } });
    },
    PCS_SYNC: { databaseURL: DB },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function (id) { return id === "app" ? appEl : null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: el,
      body: { getAttribute: function (n) { return n === "data-app" ? "driver" : ""; }, style: {}, appendChild: function () {}, classList: el().classList },
      head: el(), documentElement: el()
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "app.js" });
  const h = sandbox.__pcsSchedMeter;
  const st = h.state();
  st.rosterStatus = "approved"; st.milesNeedStart = false;
  return { h: h, st: st, writes: writes, store: store };
}
function mike(extra) {
  const now = Date.now();
  return Object.assign({ id: "icloud_test_mike", title: "PCS Pick up Mike Black (Metered ride)", rider: "Pick up Mike Black (Metered ride)", riderPhone: "+15555550100",
    pickup: "2025 Hughes Landing Blvd, Spring, TX", dropoff: "", start: new Date(now + 10 * 60000).toISOString(), end: new Date(now + 40 * 60000).toISOString(),
    status: "assigned", assignedDriverId: "mwragge_privatetaxiservices_net", assignedDriverName: "Matthew Wragge", prepaid: false, fixedFare: false, source: "icloud" }, extra || {});
}
function setup(row) {
  const a = loadApp();
  a.st.scheduledRides = [row];
  a.st.scheduledLoadedAt = Date.now(); a.st.scheduledError = "";
  a.h.tripSave({ id: row.id, phase: "arrived", at: Date.now() });
  return a;
}
function tick() { return new Promise(function (r) { setImmediate(r); }); }
/* ride-session codes written: /rides/<CODE>.json, /rides/PAYMENTS/<CODE>.json */
function sessionCodes(a) {
  const c = {};
  a.writes.forEach(function (w) { const m = /\/rides\/(?:PAYMENTS\/)?([A-Z0-9]{8})\.json$/.exec(w.url); if (m) c[m[1]] = 1; });
  return Object.keys(c);
}
function writesTo(a, frag) { return a.writes.filter(function (w) { return w.url.indexOf(frag) >= 0; }); }

test("a (Metered ride) booking is recognized from the calendar title / rider; others are not", function () {
  const { h } = loadApp();
  assert.equal(h.job(mike()), true);
  assert.equal(h.job({ title: "PCS – Jadynce", rider: "Jadynce" }), false);
  assert.equal(h.job({ title: "PCS Airport run", notes: "metered ride please" }), true);
  assert.equal(h.job(null), false);
});

test("(a) the standalone Metered ride Start is blocked while a scheduled ride is at the pickup", function () {
  const a = setup(mike());
  assert.equal(a.h.blocks(), true);
  a.st.meterKind = "meter";
  a.h.start();
  assert.equal(a.st.meter, null, "no unlinked meter session");
  assert.equal(a.st.meterError, a.h.msg);
  const html = a.h.screen();
  assert.ok(/id="meter-start" disabled/.test(html), "Start is disabled");
  assert.ok(html.indexOf(a.h.msg) >= 0, "short message shown");
  assert.deepEqual(sessionCodes(a), [], "no ride session written");
  assert.equal(writesTo(a, "PCSCALND").length, 0, "board untouched");
});

test("(a) heading to the pickup blocks it too; with no scheduled trip the Metered ride starts as before", function () {
  const a = setup(mike());
  a.h.tripSave({ id: "icloud_test_mike", phase: "pickup", at: Date.now() });
  assert.equal(a.h.blocks(), true);
  const b = loadApp();
  assert.equal(b.h.blocks(), false);
  b.st.meterKind = "meter";
  b.h.start();
  assert.ok(b.st.meter, "standalone meter starts");
  assert.equal(b.st.meter.schedId, undefined);
  assert.equal(b.h.shown(b.st.meter), true);
  assert.ok(!/id="meter-start" disabled/.test(loadApp().h.screen()));
});

test("(b) + close-out: Rider is in starts the visible meter on the SAME ride; paid -> completed, one session, driver free", async function () {
  const a = setup(mike());
  await a.h.begin("icloud_test_mike");
  const M = a.st.meter;
  assert.ok(M, "meter running");
  assert.equal(M.status, "running");
  assert.equal(M.schedId, "icloud_test_mike");
  assert.equal(M.metered, true);
  assert.equal(M.schedMeter, true);
  assert.equal(M.meterKind, "meter");
  assert.equal(a.h.shown(M), true, "the ticking meter is visible");
  await tick();
  const hub = writesTo(a, "/rides/PCSCALND/icloud_test_mike");
  assert.ok(hub.some(function (w) { return w.body && w.body.meterCode === M.code && w.body.pickedUpAt > 0; }), "board gets pickedUpAt + meterCode (tracker -> picked up)");
  const rideStart = writesTo(a, "/" + M.code).filter(function (w) { return w.body && w.body.status === "started"; });
  assert.ok(rideStart.length >= 1);
  assert.ok(rideStart.every(function (w) { return w.body.meterVisible === true && w.body.scheduleId === "icloud_test_mike"; }), "rider meter page shows the fare, linked to the ride");
  assert.equal(a.h.blocks(), false, "the pickup trip is closed");
  assert.equal(a.h.locked(), true, "on a ride");
  a.h.end();
  await tick();
  assert.equal(a.st.meter.status, "ended");
  assert.ok(writesTo(a, "/rides/PCSCALND/icloud_test_mike").some(function (w) { return w.body && w.body.status === "completed" && w.body.meterCode === M.code; }), "board ride completed in the same step");
  assert.equal(a.st.scheduledRides[0].status, "completed");
  a.h.paid({ totalCents: 5843, tipCents: 2000, fareCents: 3843, receiptUrl: "https://squareup.com/receipt/preview/X", paymentId: "p1" });
  assert.equal(a.st.meter.status, "paid");
  a.h.clear(); /* Done */
  await tick();
  assert.equal(a.st.meter, null);
  assert.equal(a.h.locked(), false, "back to Available: no ride lock, no $0 scheduled start needed");
  assert.deepEqual(sessionCodes(a), [M.code], "one ride session only");
  assert.equal(writesTo(a, "PCSCALND").filter(function (w) { return w.body && w.body.meterCode && w.body.meterCode !== M.code; }).length, 0);
});

test("non-metered scheduled rides behave exactly as before (meter hidden)", async function () {
  const a = setup(mike({ id: "icloud_test_plain", title: "PCS – Jadynce", rider: "Jadynce" }));
  await a.h.begin("icloud_test_plain");
  const M = a.st.meter;
  assert.ok(M);
  assert.equal(M.schedId, "icloud_test_plain");
  assert.equal(M.metered, false);
  assert.equal(M.schedMeter, undefined);
  assert.equal(a.h.shown(M), false);
  assert.equal(a.h.shown({ metered: true, schedId: "x" }), false, "old saved scheduled sessions stay hidden");
});
