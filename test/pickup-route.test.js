/* Pickup route: same tile-safe layer as the meter line, and a failed geocode is not remembered. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function el() {
  return {
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, setAttribute() {}, getAttribute() { return ""; }, removeAttribute() {}
  };
}

function loadApp() {
  const calls = [];
  const sandbox = {
    console, Date, Math, Intl, JSON, Promise, Number, String, Object, Array, isFinite, parseInt,
    RegExp, Error, encodeURIComponent, decodeURIComponent,
    setTimeout() { return 0; },
    clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace() {} },
    history: { pushState() {}, replaceState() {}, back() {}, state: null },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {}, createElement: el, body: el(), head: el(), documentElement: el()
    }
  };
  sandbox.fetch = function (url, opts) {
    calls.push(String(url));
    const next = sandbox.__geo;
    return Promise.resolve({
      ok: true, status: 200,
      json() { return Promise.resolve(next); },
      text() { return Promise.resolve(JSON.stringify(next)); }
    });
  };
  sandbox.__geo = { ok: false };
  sandbox.__calls = calls;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app/app.js" });
  return sandbox;
}

test("pickup route uses the meter route pane and does not clip", function () {
  const app = loadApp();
  const opts = app.__pcsPickupRoute.lineOpts(false, { name: "svg" });
  assert.equal(opts.casing.pane, "pcsRoute");
  assert.equal(opts.line.pane, "pcsRoute");
  assert.equal(opts.casing.renderer, opts.line.renderer);
  assert.equal(opts.line.interactive, false);
  assert.equal(opts.line.dashArray, null);
  assert.equal(opts.line.className, "sched-route");
  const dashed = app.__pcsPickupRoute.lineOpts(true, null);
  assert.equal(dashed.line.dashArray, "8 10");
  assert.equal(dashed.line.pane, "pcsRoute");
});

test("a failed pickup geocode is retried; a found point is kept", async function () {
  const app = loadApp();
  const addr = "Example Airport Terminal, Houston, TX";
  app.__geo = { ok: false, error: "temporary" };
  const first = await app.__pcsPickupRoute.geocode(addr);
  assert.equal(first, null);
  assert.equal(app.__pcsPickupRoute.hit(addr), null);
  const callsAfterFail = app.__calls.length;
  app.__geo = { ok: true, place: { lat: 29.9844, lng: -95.3414 } };
  const second = await app.__pcsPickupRoute.geocode(addr);
  assert.deepEqual(second, { lat: 29.9844, lng: -95.3414 });
  assert.ok(app.__calls.length > callsAfterFail);
  const before = app.__calls.length;
  const third = await app.__pcsPickupRoute.geocode(addr);
  assert.deepEqual(third, { lat: 29.9844, lng: -95.3414 });
  assert.equal(app.__calls.length, before);
});
