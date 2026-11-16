/* Trip X of Y on God board cards, and holder vs teen tracking links. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function el() {
  return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {}, closest: function () { return null; } };
}
function loadGod() {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent, btoa: function () { return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", clipboard: null },
    location: { search: "", hostname: "localhost", href: "http://localhost/god/", protocol: "http:", hash: "", pathname: "/god/", replace: function () {}, origin: "http://localhost" },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve("null"); }, json: function () { return Promise.resolve(null); } }); },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: function () { return el(); },
      body: el(), head: el(), documentElement: el()
    },
    window: null
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/god.js"), "utf8"), sandbox, { filename: "god.js" });
  } catch (e) {
    sandbox.__loadError = e;
  }
  return sandbox;
}

const g = loadGod();

test("God trip helpers: #000600 Mon 7:45 AM is trip 3 of 5 (cancelled trips ignored)", function () {
  if (g.__loadError) { assert.fail("god.js failed to load: " + g.__loadError.message); }
  const api = g.__pcsGodV20a;
  assert.ok(api, "god trip API is exported");
  const rows = [
    { id: "1", prepaidInvoiceNo: "000600", start: "2026-11-15T11:45:00-06:00", status: "assigned" },
    { id: "2", prepaidInvoiceNo: "000600", start: "2026-11-15T18:30:00-06:00", status: "assigned" },
    { id: "3", prepaidInvoiceNo: "000600", start: "2026-11-16T07:45:00-06:00", status: "assigned" },
    { id: "4", prepaidInvoiceNo: "000600", start: "2026-11-17T07:45:00-06:00", status: "assigned" },
    { id: "5", prepaidInvoiceNo: "000600", start: "2026-11-18T07:45:00-06:00", status: "cancelled" },
  ];
  assert.deepEqual(api.tripOf(rows, rows[2]), { n: 3, of: 4 });
  assert.equal(api.tripLabel(3, 5), "Trip 3 of 5");
  assert.equal(api.tripLabel(1, 1), "");
  const info = api.info({ prepaidInvoiceNo: "000600", id: "3", start: "2026-11-16T07:45:00-06:00", status: "assigned", tripN: 3, tripOf: 5 });
  assert.equal(info.trip, "Trip 3 of 5");
  assert.ok(api.badge(info).indexOf("Trip 3 of 5") >= 0);
});

test("God copy link is the holder link; Copy teen link appears only when Teen rider is on", function () {
  if (g.__loadError) { assert.fail("god.js failed to load: " + g.__loadError.message); }
  const fol = g.__pcsGodFollow;
  assert.ok(fol && fol.html);
  const base = { id: "c1", assignedDriverId: "drv", assignedDriverName: "Matthew Wragge", status: "assigned", riderPhone: "+18105551000", prepaidInvoiceNo: "000600" };
  fol.state.map.c1 = { t: "L".repeat(32), holderT: "H".repeat(32), teenT: "N".repeat(32) };
  const off = fol.html(base);
  assert.ok(off.indexOf("Copy link") >= 0);
  assert.equal(off.indexOf("Copy teen link"), -1);
  const on = fol.html(Object.assign({}, base, { teenRider: true, teenPhone: "+18105552000" }));
  assert.ok(on.indexOf("Copy link") >= 0);
  assert.ok(on.indexOf("Copy teen link") >= 0);
  assert.ok(on.indexOf("teen tracking link") >= 0);
  assert.equal(fol.holderTok(fol.state.map.c1, Object.assign({}, base, { teenRider: true, teenPhone: "+18105552000" })), "H".repeat(32));
  assert.equal(fol.holderTok(fol.state.map.c1, base), "L".repeat(32), "teen off: untagged live token is the holder link");
});
test("God copy link on a linked ride is the account holder's own holder link, even with Teen rider off", function () {
  const fol = g.__pcsGodFollow;
  const base = { id: "c1", assignedDriverId: "drv", assignedDriverName: "Matthew Wragge", status: "assigned", riderPhone: "+18105551000", prepaidInvoiceNo: "000600", linkGroup: "lk_sample01", linkedIds: ["c2"] };
  fol.state.map.c1 = { t: "L".repeat(32), holderT: "H".repeat(32) };
  assert.equal(fol.holderTok(fol.state.map.c1, base), "H".repeat(32));
  assert.equal(fol.holderTok({ t: "L".repeat(32) }, base), "L".repeat(32), "no holder token yet: the live link");
  const h = fol.html(base); assert.ok(h.indexOf("Copy link") >= 0 && h.indexOf("Copy teen link") === -1);
});

test("the God invoice line never has a dangling or doubled separator", function () {
  const g = loadGod();
  if (g.__loadError) { assert.fail("god.js failed to load: " + g.__loadError); }
  const api = g.__pcsGodV20a;
  assert.equal(api.barJoin(["#000600", "", "PAID", " \u00b7 "]), "#000600 \u00b7 PAID");
  assert.equal(api.barJoin(["#000600", ""]), "#000600");
  const src = fs.readFileSync(path.join(__dirname, "../god/god.js"), "utf8");
  const at = src.indexOf('class="day-line db-sqinv"');
  assert.ok(at >= 0, "day card invoice line is present");
  const inv = src.slice(at, at + 500);
  assert.ok(inv.indexOf("barJoin") >= 0, "invoice line uses a clean join");
  assert.equal(inv.indexOf("tripLabel"), -1, "the invoice line must not repeat Trip X of Y; the gold TRIP line already has it");
  assert.ok(src.indexOf('class="day-line db-trip"') >= 0);
  const badge = api.badge({ label: "Invoice #000600", paid: true, word: "Paid", trip: "Trip 3 of 5" });
  const vis = badge.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.ok(vis.indexOf("Invoice #000600") >= 0 && vis.indexOf("Trip 3 of 5") >= 0);
  assert.equal(vis.indexOf("\u00b7 \u00b7"), -1, badge);
  assert.doesNotMatch(vis.replace(/Paid\s*$/, "").trim(), /\u00b7\s*$/);
});
