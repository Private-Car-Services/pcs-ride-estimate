/* v2.0m-bz7: Share my ride first name. Calendar rider titles start "Pick up …"; folFirst must skip that prefix. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function el() {
  return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {} };
}
function loadFollow() {
  const store = {};
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.reject(new Error("no live worker")); },
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app.js" });
  return sandbox.__pcsFollow;
}

function sharedBy(name) {
  const rec = loadFollow().cleanShared({ riderName: name });
  return rec.sharedBy || "";
}

test("Share my ride shows the rider's full name without Pick up / for ... (v2.0m-bz7)", function () {
  assert.equal(sharedBy("Pick up Casey Lewis for IAH"), "Casey Lewis");
  assert.equal(sharedBy("Casey Lewis"), "Casey Lewis");
  assert.equal(sharedBy("pickup ted payz"), "Ted payz");
  assert.equal(sharedBy(""), "");
  assert.equal(sharedBy("Pick up Ted Payz for IAH"), "Ted Payz");
  assert.equal(sharedBy("Pick-up Casey Lewis for IAH"), "Casey Lewis");
  assert.equal(sharedBy("Pick Shaye Smith from IAH"), "Shaye Smith");
  assert.equal(sharedBy("pick Hector"), "Hector");
  assert.equal(sharedBy("Pickett Jones"), "Pickett Jones");
  assert.equal(sharedBy("Pick up Mr. Mordas"), "Mr. Mordas");
  assert.equal(sharedBy("Pick up Rahual\u2019s daughter at U of H"), "Rahual's daughter");
  assert.equal(sharedBy("Pick up <b>x</b>"), "");
  assert.equal(sharedBy("Pick Shaye Camara up for school"), "Shaye Camara");
  assert.equal(sharedBy("Pick up Mr. & Mrs. Camara for date night"), "Mr. & Mrs. Camara");
  assert.equal(sharedBy("Pick up Mr. & Mrs. Fisher for Galveston"), "Mr. & Mrs. Fisher");
  assert.equal(sharedBy("Pick up Mr and Mrs Fisher from Galveston"), "Mr and Mrs Fisher");
  assert.equal(sharedBy("Pick up Mike Black (Metered ride)"), "Mike Black");
});
