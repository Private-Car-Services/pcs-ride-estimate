/* v2.0m-bp (Matthew 11/12 9:29 PM): the 70 h cycle counts only recorded on-duty time (Available pieces + rides).
   A gap inside a shift with nothing recorded, Offline, Break, and pre-trip -> first Available never count. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function el() {
  return { style: { setProperty: function () {}, removeProperty: function () {}, getPropertyValue: function () { return ""; } },
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {} };
}
function loadApp(store) {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object, Array: Array,
    isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat, RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", share: null, geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: false, status: 0, text: function () { return Promise.resolve(""); }, json: function () { return Promise.resolve(null); } }); },
    document: { readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: el, body: Object.assign(el(), { getAttribute: function (k) { return k === "data-app" ? "driver" : ""; } }), head: el(), documentElement: el() }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app/app.js" });
  return sandbox;
}
const ID = "mwragge_privatetaxiservices_net", HIST = "pcs-driver-hos-" + ID + "-hist", H = 3600000;
const T = function (hh, mm) { return Date.UTC(2026, 10, 12, hh + 6, mm || 0); }; /* Nov 12 2026, Chicago (CST = UTC-6) */
const NOW = T(20);
/* One day: pre-trip opens the shift 6:00 while Offline (login lands Offline), first Available 7:00,
   Available 7:00-9:00, ride 9:00-9:30 with no heartbeat (app in background), NOTHING recorded 9:30-11:00,
   Offline 11:00-12:00, Available 12:00-14:00 with Break 13:00-13:30, nothing recorded 14:00-18:00, post-trip 18:00. */
const SPAN = [T(6), T(18), 120]; /* the miles row's whole shift (pre-trip -> post-trip) */
const PIECES = { [String(T(7))]: { s: T(7), e: T(9), day: "2026-11-12" }, [String(T(12))]: { s: T(12), e: T(14), day: "2026-11-12" }, hosReset: { at: 1 }, offline: {} };
const ROWS = [{ shifts: { [String(T(6))]: { shiftStartedAt: T(6), shiftEndedAt: T(18), trackedMiles: 120 } }, rideSegments: [{ start: T(9), end: T(9, 30), type: "PCS", miles: 12 }] }];
const OFF = [{ s: T(6), e: T(7), open: false }, { s: T(11), e: T(12), open: false }];
const BRK = [{ s: T(13), e: T(13, 30), open: false }];
function run(hist) {
  const store = { "pcs-driver-session": "mwragge@privatetaxiservices.net" };
  store[HIST] = JSON.stringify(hist);
  const box = loadApp(store);
  return box;
}
function histNew(extra) {
  const box0 = run({ segs: [], drv: [] });
  const duty = box0.__pcsHos70.fromRecords(PIECES, ROWS);
  return Object.assign({ segs: [SPAN], drv: [], brk: BRK, off: OFF, duty: JSON.parse(JSON.stringify(duty)), dutyOk: true }, extra || {});
}

test("record list: only numeric duty pieces and ride segments, merged", function () {
  const box = run({ segs: [], drv: [] });
  const d = JSON.parse(JSON.stringify(box.__pcsHos70.fromRecords(PIECES, ROWS)));
  assert.deepStrictEqual(d, [[T(7), T(9, 30)], [T(12), T(14)]]);
});

test("Available + ride counted; gap inside the shift, Offline, Break and pre-trip -> first Available not counted", function () {
  const box = run(histNew());
  const h = box.__pcsPretrip.hos(NOW);
  /* 7:00-9:00 Available (2 h) + 9:00-9:30 ride (0.5 h) + 12:00-14:00 Available (2 h) - Break 0.5 h = 4.0 h */
  assert.strictEqual(h.cycleMs, 4 * H);
});

test("a gap inside a shift with nothing recorded is not counted", function () {
  const box = run(histNew());
  const segs = JSON.parse(JSON.stringify(box.__pcsHos70.duty(NOW)));
  segs.forEach(function (g) { assert.ok(g[1] <= T(9, 30) || g[0] >= T(11), "9:30-11:00 gap counted: " + g); });
  segs.forEach(function (g) { assert.ok(g[0] >= T(12) || g[1] <= T(11) , "14:00-18:00 gap counted"); assert.ok(g[1] <= T(14) || g[0] >= T(18)); });
});

test("Offline is never counted, even when a recorded piece runs into it", function () {
  const extra = histNew(); extra.duty = extra.duty.concat([[T(10, 50), T(11, 30)]]); /* piece overlapping Offline 11:00-12:00 */
  const box = run(extra);
  /* adds only 10:50-11:00 */
  assert.strictEqual(box.__pcsPretrip.hos(NOW).cycleMs, 4 * H + 10 * 60000);
});

test("pre-trip to first Available (Offline 6:00-7:00) is not counted", function () {
  const box = run(histNew());
  const segs = JSON.parse(JSON.stringify(box.__pcsHos70.duty(NOW)));
  assert.ok(segs.every(function (g) { return g[0] >= T(7); }), JSON.stringify(segs));
});

test("old copy of the history (no record list) keeps the old whole-shift count", function () {
  const box = run({ segs: [SPAN], drv: [], brk: BRK, off: OFF });
  /* 12 h - Offline 2 h - Break 0.5 h = 9.5 h (the v2.0m-bo number) */
  assert.strictEqual(box.__pcsPretrip.hos(NOW).cycleMs, 9.5 * H);
});

test("a shift with no recorded piece or ride at all keeps its old count; a God-excluded shift stays zero", function () {
  const other = [T(-20), T(-14), 50]; /* Nov 11 2:00-8:00, nothing recorded */
  let box = run(histNew({ segs: [other, SPAN] }));
  assert.strictEqual(box.__pcsPretrip.hos(NOW).cycleMs, 4 * H + 6 * H);
  box = run(histNew({ segs: [[T(6), T(18), 0, 1]] }));
  assert.strictEqual(box.__pcsPretrip.hos(NOW).cycleMs, 0);
});

test("pre-trip opened the shift while still Offline: no on-duty time starts before the first Available", function () {
  const now = Date.now(), st = now - 40 * 60000;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const store = { "pcs-driver-session": "mwragge@privatetaxiservices.net" };
  store["pcs-driver-miles-" + ID] = JSON.stringify({ [day]: { day: day, startOdometer: 244529, shiftStartAt: st, startedAt: st, lastUpdate: st } });
  store["pcs-driver-onride-" + ID + "-offline"] = "1"; /* login lands Offline; no Offline interval saved yet */
  store[HIST] = JSON.stringify({ segs: [], drv: [], duty: [], dutyOk: true });
  const box = loadApp(store);
  assert.strictEqual(box.__pcsPretrip.hos(now).cycleMs, 0);
  delete store["pcs-driver-onride-" + ID + "-offline"]; /* he taps Available: the open shift counts again */
  assert.ok(box.__pcsPretrip.hos(now).cycleMs > 0);
});
