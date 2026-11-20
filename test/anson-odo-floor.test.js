/* v2.0m-bz4 (Matthew 11/17 8:48 AM): Anson keeps being told to put a 2 in front of his mileage to go online.
   Fixture = Anson's real Firebase miles rows (rides/DRVRMLES/<Anson>, odometer fields only, read 11/17; email left out).
   Oct 15 opened at 1,477,223 (extra digit on 147,723); that cluster then set the floor, so he typed 2,153,263 on Nov 10
   and 215xxxx since. Matthew corrected today's opening to 155,735 in God mode at 8:27 AM CT; the phone then put
   2,155,735 back and the floor stayed at 2.15 million. */
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
const ID = "anson_example_com";
const ROWS = JSON.parse(fs.readFileSync(path.join(__dirname, "anson-odo-1117.json"), "utf8"));
const clone = function (o) { return JSON.parse(JSON.stringify(o)); };
/* Anson's phone: all his rows, plus the highs the app keeps on the phone (last typed, server max) */
function ansonPhone(rows, extra) {
  const store = Object.assign({ "pcs-driver-session": "anson@example.com" }, extra || {});
  store["pcs-driver-miles-" + ID] = JSON.stringify(rows);
  store["pcs-driver-lastodo-" + ID] = "2155735";
  store["pcs-driver-srvodo-" + ID] = "2155735";
  return loadApp(store);
}

test("the God correction made this morning reaches Anson's phone over its stale 2,155,735 opening", function () {
  const box = ansonPhone({});
  const phoneToday = { startOdometer: 2155735, priorEndOdometer: 2155439, shiftStartAt: 1794921910247, shiftClosed: false };
  const serverToday = clone(ROWS["2026-11-17"]); /* server row as read: startOdometer 2155735 put back, odoRepaired.to 155735 */
  const m = box.__pcsOdo.merge(phoneToday, serverToday);
  assert.strictEqual(Number(m.startOdometer), 155735);
  assert.strictEqual(Number(m.odoCorrectedAt), 1794925646119);
});

test("after the correction, Anson's floor is 155,735, not 2.15 million", function () {
  const box = ansonPhone(clone(ROWS));
  assert.ok(box.__pcsOdo.last, "lastKnownOdometer test hook");
  assert.strictEqual(box.__pcsOdo.last(), 155735);
});

test("saving the corrected row does not put 2,155,735 back (the phone's PATCH re-sent it this morning)", function () {
  const rows = clone(ROWS);
  rows["2026-11-17"].priorEndOdometer = 2155439; /* phone's local copy */
  const box = ansonPhone(rows);
  const r = box.__pcsOdo.sanitize(rows["2026-11-17"]);
  assert.strictEqual(Number(r.startOdometer), 155735);
  assert.ok(!(Number(r.priorEndOdometer) > 156735));
  assert.strictEqual(r.odoRepaired.why, "Corrected in God mode");
});

test("later days count normally from the corrected reading", function () {
  const rows = clone(ROWS);
  rows["2026-11-17"].endOdometer = 155900; rows["2026-11-17"].shiftClosed = true;
  rows["2026-11-18"] = { startOdometer: 155950, shiftStartAt: 1795000000000, shiftClosed: false };
  const box = ansonPhone(rows);
  assert.strictEqual(box.__pcsOdo.last(), 155950);
});

test("no God correction on file: the rule is unchanged (still the highest believable reading)", function () {
  const rows = clone(ROWS); delete rows["2026-11-17"];
  const box = ansonPhone(rows);
  assert.strictEqual(box.__pcsOdo.last(), 2155735);
  const box2 = loadApp({ "pcs-driver-session": "mwragge@privatetaxiservices.net", "pcs-driver-miles-mwragge_privatetaxiservices_net": JSON.stringify({ "2026-11-16": { startOdometer: 241500, endOdometer: 241767, shiftClosed: true } }) });
  assert.strictEqual(box2.__pcsOdo.last(), 241767);
});
