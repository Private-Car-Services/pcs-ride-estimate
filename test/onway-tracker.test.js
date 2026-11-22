/* v2.0m-bz1 regression (Matthew 11/16 5:20 PM): tapping On my way must reach the customer tracker as on_way / arrived.
   v2.0m-bz shadowed the active ride ("var trip") inside folDriverCtxs, so every board ride stayed "assigned" with no car or
   ETA until the meter started. Covers one ride and several rides (active ride first, middle and last). Sample data; no network. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(root, "app/app.js"), "utf8");

function el() {
  return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {} };
}
function loadApp(src, seed) {
  const store = Object.assign({}, seed || {});
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    btoa: btoa, crypto: require("crypto").webcrypto, Uint8Array: Uint8Array,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.reject(new Error("no network in tests")); },
    PCS_SYNC: { databaseURL: "https://example.test" },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: el,
      body: { getAttribute: function (n) { return n === "data-app" ? "driver" : ""; }, style: {}, appendChild: function () {} },
      head: el(), documentElement: el()
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "app.js" });
  return Object.assign(sandbox.__pcsFollow, { __win: sandbox });
}

function ride(id, minsFromNow) {
  return { id: id, assignedDriverId: "driver", status: "assigned", rider: "Sample rider", riderPhone: "555-0100",
    start: new Date(Date.now() + minsFromNow * 60000).toISOString(), pickup: "100 Sample Ln, Spring, TX", pickupLat: 30.12, pickupLng: -95.45,
    dropoff: "Sample School, Spring, TX", dropoffLat: 30.19, dropoffLng: -95.52 };
}
function statuses(rides, activeId, phase) {
  const seed = {}; seed["pcs-sched-trip-v1-driver"] = JSON.stringify({ id: activeId, phase: phase });
  const app = loadApp(appSrc, seed);
  assert.ok(app && typeof app.publish === "function", "tracker test hooks present");
  const S = app.__win.__pcsSchedMeter.state();
  S.hereLat = 30.10; S.hereLng = -95.40; S.gpsAt = Date.now(); /* a fresh GPS fix, as on the iPad */
  const pub = app.publish(rides);
  assert.equal(pub.length, rides.length, "one tracker copy per ride");
  const out = {};
  app.ctxs().forEach(function (c, i) { if (c && c.key) out[c.key] = { status: c.status, pub: pub[i] }; });
  return out;
}
function liveCheck(c, label) {
  assert.ok(c.pub && c.pub.pos && isFinite(c.pub.pos.lat) && isFinite(c.pub.pos.lng), label + ": the tracker copy carries the car location");
  assert.equal(c.pub.status, c.status, label + ": the tracker copy carries the same status");
}
const ONE = function () { return [ride("s-1", 25)]; };
const MANY = function () { return [ride("s-1", 25), ride("s-2", 90), ride("s-3", 110)]; };

test("one ride: On my way reaches the tracker as on_way", function () {
  const st = statuses(ONE(), "s-1", "pickup");
  assert.equal(st["c_s-1"].status, "on_way");
  liveCheck(st["c_s-1"], "on_way");
  assert.ok(st["c_s-1"].pub.eta && st["c_s-1"].pub.eta.to === "pickup" && st["c_s-1"].pub.eta.min > 0, "on_way: the tracker copy has an ETA to the pickup");
});
test("one ride: I'm at the pickup reaches the tracker as arrived", function () {
  const st = statuses(ONE(), "s-1", "arrived");
  assert.equal(st["c_s-1"].status, "arrived");
  liveCheck(st["c_s-1"], "arrived");
});
["s-1", "s-2", "s-3"].forEach(function (id) {
  test("several rides: On my way to " + id + " shows on_way for that ride only", function () {
    const st = statuses(MANY(), id, "pickup");
    Object.keys(st).forEach(function (k) {
      assert.equal(st[k].status, k === "c_" + id ? "on_way" : "assigned", k);
      if (k !== "c_" + id) { assert.ok(!st[k].pub.pos, k + ": no car location on a ride that isn't active"); assert.ok(!st[k].pub.eta, k + ": no ETA on a ride that isn't active"); }
    });
    liveCheck(st["c_" + id], id);
    assert.ok(st["c_" + id].pub.eta && st["c_" + id].pub.eta.min > 0, id + ": ETA on the active ride");
  });
});
test("source guard: folDriverCtxs never redeclares the outer active-ride variable", function () {
  const s = appSrc.indexOf("function folDriverCtxs()"), e = appSrc.indexOf("folLinkMerge(out, M);", s);
  assert.ok(s > 0 && e > s);
  const body = appSrc.slice(s, e).replace(/\/\*[\s\S]*?\*\//g, ""), inner = body.slice(body.indexOf(".forEach(function (r)"));
  assert.equal(/\bvar\s+(?:[^;]*,\s*)?trip\b(?!Info)/.test(inner), false, "a var named trip inside the ride loop hides schedTripNow()");
});
