/* v2.0m-bq on v2.0m-bp (Harry hold 11/12 9:37 PM): God Driver's Log edits flow into v2.0m-bp's hours (recorded duty pieces +
   ride segments). Uses the REAL app.js (bp's hosDutyFromRecords / hosHistFromRows / hosDutySegs / hosStatus) with driverlog.js. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function el() {
  return { style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } }, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, setAttribute() {}, getAttribute() { return ""; }, removeAttribute() {} };
}
function loadApp(store) {
  const sandbox = {
    console, Date, Math, Intl, JSON, Promise, Number, String, Object, Array, isFinite, parseInt, parseFloat, RegExp, Error, encodeURIComponent, decodeURIComponent,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {}, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    navigator: { userAgent: "test", share: null, geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace() {} },
    history: { pushState() {}, replaceState() {}, back() {}, state: null },
    localStorage: { getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
    fetch() { return Promise.resolve({ ok: false, status: 0, text() { return Promise.resolve(""); }, json() { return Promise.resolve(null); } }); },
    document: { readyState: "complete", currentScript: { src: "" }, visibilityState: "visible", getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {}, createElement: el, body: Object.assign(el(), { getAttribute(k) { return k === "data-app" ? "driver" : ""; } }), head: el(), documentElement: el() }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/driverlog.js"), "utf8"), sandbox, { filename: "app/driverlog.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app/app.js" });
  return sandbox;
}
const ID = "mwragge_privatetaxiservices_net", HIST = "pcs-driver-hos-" + ID + "-hist", H = 3600000, M = 60000;
const T = (hh, mm) => Date.UTC(2026, 10, 12, hh + 6, mm || 0); /* Nov 12 2026 Chicago (CST) */
const NOW = T(20);
const J = (x) => JSON.parse(JSON.stringify(x));
/* Shift 6:00-18:00 (pre-trip -> post-trip). Server duty pieces 7:00-9:00 and 12:00-14:00; rides 9:00-9:30 and 15:00-15:30;
   Offline 6:00-7:00 and 11:00-12:00; Break 13:00-13:30. */
function day() {
  return {
    pieces: { [String(T(7))]: { s: T(7), e: T(9), day: "2026-11-12" }, [String(T(12))]: { s: T(12), e: T(14), day: "2026-11-12" } },
    rows: [{ shifts: { [String(T(6))]: { shiftStartedAt: T(6), shiftEndedAt: T(18), trackedMiles: 120 } }, rideSegments: [{ start: T(9), end: T(9, 30), type: "PCS" }, { start: T(15), end: T(15, 30), type: "PCS" }] }],
    off: { [String(T(6))]: { s: T(6), e: T(7), open: false }, [String(T(11))]: { s: T(11), e: T(12), open: false } },
    brk: { [String(T(13))]: { s: T(13), e: T(13, 30), open: false } },
    drv: {}
  };
}
/* the same steps hosPullHistory runs: godLogApply (v2.0m-bq) -> bp's records -> godLogTrim (v2.0m-bq) -> stored history */
function pull(box, store, d) {
  const g = box.__pcsGodLog.apply(d.rows, d.drv, d.brk, d.off, d.pieces);
  const list = (o) => Object.keys(o || {}).map((k) => o[k]).filter((v) => v && Number(v.s) > 0).map((v) => ({ s: Number(v.s), e: Number(v.e) || Number(v.s), open: !!v.open }));
  const h = { segs: J(box.__pcsHos70.fromRows(d.rows)), duty: J(box.__pcsHos70.fromRecords(g.pieces, d.rows)), dutyOk: true, drv: [], brk: list(g.breaks), off: list(g.offline) };
  box.__pcsGodLog.trim(h, d.rows);
  store[HIST] = JSON.stringify(h);
  return box.__pcsPretrip.hos(NOW).cycleMs;
}
function fresh() { const store = { "pcs-driver-session": "mwragge@privatetaxiservices.net" }; store[HIST] = JSON.stringify({ segs: [], drv: [] }); return { store, box: loadApp(store) }; }

test("baseline (no God edit): bp counts recorded pieces + rides minus Break = 4.5 h", () => {
  const { store, box } = fresh();
  assert.strictEqual(pull(box, store, day()), 4.5 * H);
});

test("shorten the shift to 8:00-12:30: server pieces and the 3 PM ride outside the span drop; 70 h falls by exactly the trimmed time", () => {
  const { store, box } = fresh();
  const before = pull(box, store, day());
  const d = day(), x = d.rows[0].shifts[String(T(6))];
  Object.assign(x, { shiftStartedAt: T(8), shiftEndedAt: T(12, 30), godOrig: { shiftStartedAt: T(6), shiftEndedAt: T(18) }, editedBy: "God", editedAt: NOW });
  const after = pull(box, store, d);
  /* trimmed on-duty time: piece 7:00-8:00 (1 h) + piece 12:30-14:00 less Break 13:00-13:30 (1 h) + ride 15:00-15:30 (0.5 h) = 2.5 h */
  const trimmed = 1 * H + (1.5 * H - 30 * M) + 30 * M;
  console.log("70 h cycle before " + before / H + " h, after " + after / H + " h, trimmed " + trimmed / H + " h");
  assert.strictEqual(before - after, trimmed);
  assert.strictEqual(after, 2 * H);
  const duty = J(box.__pcsHos70.duty(NOW));
  assert.ok(duty.every((g) => g[0] >= T(8) && g[1] <= T(12, 30)), JSON.stringify(duty));
  assert.strictEqual(Object.keys(d.pieces).length, 2, "server pieces are not changed");
  assert.strictEqual(d.rows[0].rideSegments.length, 2, "ride records are not changed");
});

test("move the start only (6:00 -> 8:30): the 7:00-8:30 piece time drops (1.5 h)", () => {
  const { store, box } = fresh();
  const d = day(); Object.assign(d.rows[0].shifts[String(T(6))], { shiftStartedAt: T(8, 30), godOrig: { shiftStartedAt: T(6) } });
  assert.strictEqual(pull(box, store, d), 4.5 * H - 1.5 * H);
});

test("deleting the whole shift still zeroes it", () => {
  const { store, box } = fresh();
  const d = day(); Object.assign(d.rows[0].shifts[String(T(6))], { deleted: true, deletedBy: "God", deletedAt: NOW });
  assert.strictEqual(pull(box, store, d), 0);
});

test("status changes still flow through: Break -> Offline keeps 4.5 h; deleting the Break adds its 30 min back", () => {
  let { store, box } = fresh();
  const d = day();
  d.brk[String(T(13))] = Object.assign({}, d.brk[String(T(13))], { deleted: true, movedTo: "/rides/DRVRHSLG/{id}/offline/" + T(13) });
  d.off[String(T(13))] = { s: T(13), e: T(13, 30), open: false, movedFrom: "/rides/DRVRHSLG/{id}/breaks/" + T(13), godOrig: { status: "breaks", s: T(13), e: T(13, 30) } };
  assert.strictEqual(pull(box, store, d), 4.5 * H);
  ({ store, box } = fresh());
  const d2 = day(); d2.brk[String(T(13))].deleted = true;
  assert.strictEqual(pull(box, store, d2), 5 * H);
});

test("a Driving piece changed to Offline takes that time off duty", () => {
  const { store, box } = fresh();
  const d = day();
  d.off[String(T(7))] = { s: T(7), e: T(8), open: false, movedFrom: "/rides/DRVRHSLG/{id}/drive/" + T(7), godOrig: { status: "drive", s: T(7), e: T(8) } };
  assert.strictEqual(pull(box, store, d), 3.5 * H);
});

test("the phone's own copy of a God-edited Break is replaced by the server's edited one", () => {
  const { store, box } = fresh();
  store["pcs-driver-hos-" + ID + "-brk"] = JSON.stringify({ [String(T(13))]: { s: T(13), e: T(13, 30), open: false } });
  const d = day(); d.brk[String(T(13))] = { s: T(13), e: T(13, 10), open: false, godOrig: { e: T(13, 30) }, editedBy: "God" };
  assert.strictEqual(pull(box, store, d), 4.5 * H + 20 * M);
  assert.deepStrictEqual(Object.keys(JSON.parse(store["pcs-driver-hos-" + ID + "-brk"])), []);
});
