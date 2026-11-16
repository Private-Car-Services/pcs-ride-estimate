/* v2.0m-by (Matthew 11/15): rides linked by hand on the God board share ONE tracker. The shared copy carries each invoice
   number with paid / unpaid ONLY: no amounts, no receipt link, no pay link, no bill word. Unlinked rides publish exactly the
   same tracker copy as v2.0m-bx (f325a59), byte for byte. Sample data only; no network.
   v2.0m-by2 (Harry hold): two rides at most; Unlink starts a fresh tracker (the shared token never serves an unlinked ride);
   Link ends any old solo tracker at once; plain bar words. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const BASE = "f325a59";
const PAY = "https://app.squareup.com/pay-invoice/invtmp:sample-unpaid";
const RECEIPT = "https://squareup.com/receipt/preview/SAMPLE";

function el() {
  return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {} };
}
function loadApp(src) {
  const store = {};
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
  return sandbox.__pcsFollow;
}
function loadFollow(src) {
  const nodes = {};
  function make(id) {
    return nodes[id] || (nodes[id] = { id: id, hidden: true, textContent: "", innerHTML: "", src: "", style: {},
      setAttribute: function () {}, addEventListener: function () {}, querySelector: function () { return null; } });
  }
  ["app", "fl-live", "fl-photo", "fl-status", "fl-call", "fl-who", "fl-car", "fl-eta", "fl-from", "fl-to", "fl-upd", "fl-net", "fl-stops", "fl-big", "fl-map"].forEach(make);
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object,
    Array: Array, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: { visibilityState: "visible", getElementById: function (id) { return nodes[id] || null; }, querySelector: function () { return null; }, createElement: function () { return make("made"); }, addEventListener: function () {}, head: { appendChild: function () {} }, body: { appendChild: function () {} } },
    location: { search: "?t=" + "d".repeat(32) },
    fetch: function () { return new Promise(function () {}); },
    navigator: {}, addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "follow-live.js" });
  return { api: sandbox.__pcsFollowLive, nodes: nodes };
}
function loadGod() {
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Number: Number, String: String, Object: Object, Array: Array, Intl: Intl,
    Promise: Promise, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, Symbol: Symbol, URL: URL, Uint8Array: Uint8Array,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: {
      currentScript: null, readyState: "complete",
      createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {} }; }, getElementById: function () { return null; }, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, addEventListener: function () {},
      head: { appendChild: function () {} }, body: { appendChild: function () {} }, documentElement: { appendChild: function () {} }
    },
    location: { search: "", hostname: "private-car-services.github.io", href: "https://private-car-services.github.io/pcs-ride-estimate/god/" },
    navigator: { userAgent: "test" }, localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.reject(new Error("no")); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "god/god.js"), "utf8"), sandbox, { filename: "god.js" });
  return sandbox.__pcsGodLink;
}
function baseSrc(rel) {
  try { return execFileSync("git", ["show", BASE + ":" + rel], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); }
  catch (e) { return ""; }
}
function noMoney(json) { /* nothing from an invoice beyond its number and paid / unpaid */
  assert.equal(/https?:/i.test(json), false, "no URL: " + json);
  assert.equal(/squareup|square\.link/i.test(json), false, "no Square link");
  assert.equal(/cents|amount|total|subtotal|tax|price|fare/i.test(json), false, "no amounts: " + json);
  assert.equal(/receipt|payUrl|public_url|"bill"/i.test(json), false, "no receipt / pay / bill: " + json);
}
function strip(o) { const c = JSON.parse(JSON.stringify(o)); delete c.updatedAt; delete c.etaAt; if (typeof c.endedAt === "number") c.endedAt = "now"; return c; } /* clock fields only */

const appSrc = fs.readFileSync(path.join(root, "app/app.js"), "utf8");
const app = loadApp(appSrc);

/* two rides, same school drop-off, two pickups, two invoices (sample data) */
function sampleRide(id, extra) {
  return Object.assign({
    id: id, assignedDriverId: "driver", status: "assigned", rider: "Sample rider", riderPhone: "555-0100",
    start: "2026-11-17T07:45:00-06:00", pickup: "100 Sample Ln, The Woodlands, TX", pickupLat: 30.17, pickupLng: -95.5,
    dropoff: "Sample School, The Woodlands, TX", dropoffLat: 30.19, dropoffLng: -95.52,
    receiptUrl: RECEIPT, invoicePayUrl: PAY, fareBeforeTax: 27.39, prepaidAmountCents: 2739, prepaidTaxCents: 226
  }, extra || {});
}
function linkedPair(payA, payB) {
  return [
    sampleRide("sample-600", { prepaid: true, prepaidInvoiceNo: "000600", sqInvoice: payA === "paid" ? { paid: true, status: "PAID", number: "000600", totalCents: 2739, receipt_url: RECEIPT } : { status: "UNPAID", number: "000600", totalCents: 2739, public_url: PAY },
      linkGroup: "lk_sample01", linkedIds: ["sample-601"] }),
    sampleRide("sample-601", { start: "2026-11-17T08:00:00-06:00", pickup: "200 Sample Ct, Spring, TX", pickupLat: 30.12, pickupLng: -95.45, prepaid: true, prepaidInvoiceNo: "000601",
      sqInvoice: payB === "paid" ? { paid: true, status: "PAID", number: "000601", totalCents: 11204, receipt_url: RECEIPT } : { status: "UNPAID", number: "000601", totalCents: 11204, public_url: PAY },
      linkGroup: "lk_sample01", linkedIds: ["sample-600"] })
  ];
}

test("(a) folClean: a linked copy holds only invoice numbers and paid flags, never URLs or cents", function () {
  const out = app.clean({
    status: "on_way", kind: "sched", bill: "invoiced", pay: "unpaid", invoiceNo: "000600", receiptUrl: RECEIPT, payUrl: PAY,
    driverName: "Matthew", pickup: { lat: 30.17, lng: -95.5, label: "100 Sample Ln" }, dest: { lat: 30.19, lng: -95.52, label: "Sample School" },
    linked: [
      { invoiceNo: "#000600", pay: "paid", amountCents: 2739, totalCents: 2739, receiptUrl: RECEIPT, url: RECEIPT },
      { invoiceNo: "000601", pay: "maybe", payUrl: PAY, public_url: PAY, taxCents: 226 },
      { invoiceNo: "000601", pay: "paid" },
      { invoiceNo: "not-a-number", pay: "paid" },
      "junk"
    ]
  }, 1000);
  assert.deepEqual(JSON.parse(JSON.stringify(out.linked)), [{ invoiceNo: "000600", pay: "paid" }, { invoiceNo: "000601", pay: "unpaid" }]);
  ["bill", "pay", "invoiceNo", "receiptUrl", "payUrl"].forEach(function (k) { assert.equal(k in out, false, k + " must not be on a linked copy"); });
  out.linked.forEach(function (x) { assert.deepEqual(Object.keys(x).sort(), ["invoiceNo", "pay"]); });
  noMoney(JSON.stringify(out.linked));
  assert.equal(JSON.stringify(out).indexOf("squareup"), -1);
  assert.equal(out.status, "on_way");
  assert.equal(out.dest.label, "Sample School");
});

test("(a) publish: both linked rides send the SAME copy, each invoice # with paid / unpaid, no money", function () {
  const pub = app.publish(linkedPair("paid", "unpaid"));
  assert.equal(pub.length, 2);
  pub.forEach(function (c) {
    assert.deepEqual(JSON.parse(JSON.stringify(c.linked)), [{ invoiceNo: "000600", pay: "paid" }, { invoiceNo: "000601", pay: "unpaid" }]);
    const j = JSON.stringify(c);
    noMoney(j.replace(/"label":"[^"]*"/g, ""));
    ["bill", "pay", "invoiceNo", "receiptUrl", "payUrl"].forEach(function (k) { assert.equal(k in c, false, k); });
  });
  assert.deepEqual(strip(pub[0]), strip(pub[1]), "one tracker: both linked rides publish the same copy");
  const both = app.publish(linkedPair("paid", "paid"));
  assert.deepEqual(JSON.parse(JSON.stringify(both[0].linked)), [{ invoiceNo: "000600", pay: "paid" }, { invoiceNo: "000601", pay: "paid" }]);
  const keys = app.linkKeys("c_sample-600");
  assert.deepEqual(Array.from(keys), ["c_sample-601"]);
});

test("(a) the ride that is furthest along drives the shared map", function () {
  const rows = linkedPair("paid", "paid");
  rows[1].status = "completed";
  const pub = app.publish(rows);
  assert.equal(pub[0].status, "completed");
  assert.deepEqual(strip(pub[0]), strip(pub[1]));
});

test("(b) unlinked rides publish byte-for-byte the same tracker copy as v2.0m-bx", function (t) {
  const old = baseSrc("app/app.js");
  if (!old) { t.skip("base commit " + BASE + " not available"); return; }
  const base = loadApp(old);
  const fixtures = [
    [sampleRide("u-1", { prepaid: true, prepaidInvoiceNo: "000574", sqInvoice: { status: "UNPAID", number: "000574" }, payState: "unpaid" })],
    [sampleRide("u-2", { prepaid: true, prepaidInvoiceNo: "000554", sqInvoice: { paid: true, status: "PAID", number: "000554", receipt_url: RECEIPT } })],
    [sampleRide("u-3", { prepaidInvoiceNo: "", receiptUrl: "", invoicePayUrl: "" })],
    [sampleRide("u-4", { status: "cancelled" }), sampleRide("u-5", { stopsGeo: [{ address: "Stop 1", lat: 30.1, lng: -95.4 }] })],
    [sampleRide("u-6", { linkGroup: "bad group", linkedIds: ["u-7"], prepaid: true, prepaidInvoiceNo: "000610", sqInvoice: { paid: true, status: "PAID", number: "000610", receipt_url: RECEIPT } }),
      sampleRide("u-7", { linkGroup: "lk_onlyone", linkedIds: [], prepaid: true, prepaidInvoiceNo: "000611", sqInvoice: { status: "UNPAID", number: "000611" }, payState: "unpaid" })]
  ];
  fixtures.forEach(function (rows, i) {
    const a = base.publish(JSON.parse(JSON.stringify(rows))).map(strip);
    const b = app.publish(JSON.parse(JSON.stringify(rows))).map(strip);
    assert.equal(JSON.stringify(b), JSON.stringify(a), "fixture " + i);
  });
  const ctxs = [
    { status: "on_way", kind: "sched", bill: "invoiced", pay: "unpaid", invoiceNo: "000574", payUrl: PAY, pickup: { lat: 30.1, lng: -95.4, label: "A" }, dest: { label: "B" }, pos: { lat: 30.1, lng: -95.4, at: 5 }, eta: { min: 4, miles: 1.2, to: "pickup" } },
    { status: "completed", kind: "sched", bill: "prepaid", pay: "paid", invoiceNo: "#000554", receiptUrl: RECEIPT, endedAt: 9 },
    { status: "assigned", kind: "app", driverName: "matthew wragge", car: { carMake: "Chevy", carModel: "Tahoe", carPlate: "abc123", carYear: "2021" } }
  ];
  ctxs.forEach(function (c, i) {
    assert.equal(JSON.stringify(app.clean(c, 1234)), JSON.stringify(base.clean(c, 1234)), "clean " + i);
    assert.equal(app.sig(app.clean(c, 1234)), base.sig(base.clean(c, 1234)), "sig " + i);
  });
});

test("rows: link fields only on a real link; unlinked rows keep exactly their old keys", function () {
  const plain = app.normRow("r1", { title: "PCS Sample", start: "2026-11-17T07:45:00-06:00" });
  assert.equal("linkGroup" in plain, false);
  assert.equal("linkedIds" in plain, false);
  const lk = app.normRow("r1", { title: "PCS Sample", linkGroup: "lk_sample01", linkedIds: { 0: "r2", 1: "r1", 2: "r2", 3: "bad id!" } });
  assert.equal(lk.linkGroup, "lk_sample01");
  assert.deepEqual(Array.from(lk.linkedIds), ["r2"]);
  assert.equal("linkGroup" in app.normRow("r1", { linkGroup: "lk_sample01", linkedIds: ["r2", "r3"] }), false, "two rides at most");
  assert.equal("linkGroup" in app.normRow("r1", { linkGroup: "lk_sample01", linkedIds: [] }), false);
  assert.equal("linkGroup" in app.normRow("r1", { linkGroup: "nope", linkedIds: ["r2"] }), false);
});

test("tracker page: linked copy shows each invoice # with paid / unpaid (plain bar words) and no link, even if a URL sneaks in", function () {
  const live = loadFollow(fs.readFileSync(path.join(root, "follow/follow-live.js"), "utf8"));
  const m = live.api.bill({ linked: [{ invoiceNo: "000600", pay: "paid" }, { invoiceNo: "000601", pay: "unpaid" }], invoiceNo: "000600", pay: "paid", receiptUrl: RECEIPT, payUrl: PAY });
  assert.equal(m.show, true);
  assert.equal(m.link, null);
  assert.equal(m.label, "Invoice #000600 \u2013 paid \u00b7 Invoice #000601 \u2013 unpaid");
  assert.equal(live.api.bill({ linked: [{ invoiceNo: "1", pay: "paid" }, { invoiceNo: "2", pay: "paid" }, { invoiceNo: "3", pay: "paid" }] }).rows.length, 2, "two at most");
  assert.equal(JSON.stringify(m).indexOf("http"), -1);
  live.api.update({ status: "assigned", linked: [{ invoiceNo: "000600", pay: "paid" }, { invoiceNo: "000601", pay: "paid" }], receiptUrl: RECEIPT, pickup: { label: "A" }, dest: { label: "Sample School" } });
  const bar = live.nodes["fl-call"];
  assert.equal(bar.hidden, false);
  assert.ok(bar.innerHTML.indexOf("Invoice #000600 \u2013 paid") >= 0, bar.innerHTML);
  assert.ok(bar.innerHTML.indexOf("Invoice #000601 \u2013 paid") >= 0);
  assert.equal(/<b>|class=|background|PAID|UNPAID/.test(bar.innerHTML), false, "no badge styling: " + bar.innerHTML);
  assert.equal(/<a\b|href|http/i.test(bar.innerHTML), false, "no link on a linked tracker");
  assert.equal(live.api.bill({ linked: [] }).show, false);
});

test("tracker page: unlinked bill bar is unchanged from v2.0m-bx", function (t) {
  const old = baseSrc("follow/follow-live.js");
  if (!old) { t.skip("base commit not available"); return; }
  const a = loadFollow(old).api, b = loadFollow(fs.readFileSync(path.join(root, "follow/follow-live.js"), "utf8")).api;
  [{ invoiceNo: "000574", pay: "unpaid", payUrl: PAY }, { invoiceNo: "000554", pay: "paid", receiptUrl: RECEIPT }, { invoiceNo: "000560", bill: "invoiced" }, { pay: "paid" }, {}]
    .forEach(function (d) {
      const now = b.bill(d), then = a.bill(d);
      assert.equal(now.label, then.label);
      assert.equal(JSON.stringify(now.link || null), JSON.stringify(then.link || null));
      assert.equal(now.show, then.show);
      assert.equal(now.gap, then.gap);
      assert.equal(now.trip || "", "", "no Trip X of Y on a single-invoice bar");
    });
});

test("God board: Link / Unlink write only linkGroup + linkedIds, same-day open rides only", function () {
  const L = loadGod();
  const rows = [
    { id: "a", start: "2026-11-17T07:45:00-06:00", status: "assigned" },
    { id: "b", start: "2026-11-17T08:00:00-06:00", status: "assigned" },
    { id: "c", start: "2026-11-17T08:00:00-06:00", status: "open", linkGroup: "lk_other01", linkedIds: ["d"] },
    { id: "d", start: "2026-11-17T09:00:00-06:00", status: "open", linkGroup: "lk_other01", linkedIds: ["c"] }
  ];
  const p = JSON.parse(JSON.stringify(L.plan(rows, "a", "b", "lk_newgrp01")));
  assert.deepEqual(p, { a: { linkGroup: "lk_newgrp01", linkedIds: ["b"] }, b: { linkGroup: "lk_newgrp01", linkedIds: ["a"] } });
  Object.keys(p).forEach(function (id) { assert.deepEqual(Object.keys(p[id]).sort(), ["linkGroup", "linkedIds"]); });
  assert.equal(L.plan(rows, "a", "c", "lk_newgrp01"), null, "two rides at most: a linked ride can't take a third");
  assert.equal(L.plan(rows, "c", "a", "lk_newgrp01"), null);
  assert.equal(L.plan(rows, "a", "a", "lk_x00000"), null);
  const un = JSON.parse(JSON.stringify(L.unplan(rows, "c")));
  assert.deepEqual(un, { c: { linkGroup: null, linkedIds: null }, d: { linkGroup: null, linkedIds: null } });
  assert.equal(L.unplan(rows, "a"), null);
  const lk = L.of({ linkGroup: "lk_other01", linkedIds: { 0: "d", 1: "c" } }, "c");
  assert.deepEqual(JSON.parse(JSON.stringify(lk)), { linkGroup: "lk_other01", linkedIds: ["d"] });
  const god = fs.readFileSync(path.join(root, "god/god.js"), "utf8");
  const ui = god.slice(god.indexOf("function linkPatch"), god.indexOf("function linkSave"));
  assert.ok(ui.indexOf('method: "PATCH"') >= 0, "field-level PATCH");
  assert.equal(/putCalendarRide|fareBeforeTax|prepaidInvoiceNo|assignedDriver|start/.test(ui), false, "link never writes invoices, prices, times or assignment");
});

/* ---------- v2.0m-by2 (Harry hold) ---------- */
const SHARED = "S".repeat(32), SOLO = "O".repeat(32), SOLO2 = "P".repeat(32);
function unlinkedPair() { return linkedPair("paid", "unpaid").map(function (r) { const c = Object.assign({}, r); delete c.linkGroup; delete c.linkedIds; return c; }); }
function innerTok(k) { const m = /data-fol-tok="([^"]+)"/.exec(app.inner(k, "555-0100", "Matthew") || ""); return m ? m[1] : ""; }

test("by2 Unlink: the shared token never serves the unlinked ride again; it gets a FRESH token", function () {
  const F = app.state, now = Date.now();
  app.publish(linkedPair("paid", "unpaid"));
  ["c_sample-600", "c_sample-601"].forEach(function (k) { F.map[k] = { t: SHARED, at: now, lk: "lk_sample01" }; F.mapAt[k] = now; });
  assert.equal(app.liveTok("c_sample-600"), SHARED, "linked: both rides on the shared token");
  assert.equal(innerTok("c_sample-601"), SHARED, "linked: the text button sends the shared link");
  F.lastPush = {}; F.lastSig = {}; F.lastSt = {};
  app.tickNow();
  assert.ok(F.lastPush[SHARED], "linked rides push the (money-free) shared copy");
  /* Unlink: the rows lose linkGroup / linkedIds; this phone still holds the old shared map rows */
  app.publish(unlinkedPair());
  ["c_sample-600", "c_sample-601"].forEach(function (k) {
    assert.equal(app.liveTok(k), "", k + ": shared token refused after unlink");
    assert.equal(app.linkTok(k), "", k + ": no sibling token after unlink");
    const t = innerTok(k);
    assert.ok(/^[A-Za-z0-9_-]{32}$/.test(t), k + ": a fresh token is ready");
    assert.notEqual(t, SHARED, k + ": never the shared token");
  });
  F.lastPush = {}; F.lastSig = {}; F.lastSt = {}; F.live = {};
  app.tickNow();
  assert.equal(F.lastPush[SHARED], undefined, "nothing (bill, receipt or pay link) is pushed to the shared link after unlink");
  assert.equal(F.live[SHARED], undefined);
  /* the unlinked ride's own fresh tracker carries its own bill again, exactly like bx; untagged map row */
  app.commit("c_sample-600", SOLO2, "driver", app.ctxs().filter(function (c) { return c.key === "c_sample-600"; })[0]);
  assert.equal(F.map["c_sample-600"].t, SOLO2);
  assert.equal("lk" in F.map["c_sample-600"], false);
  assert.equal(app.liveTok("c_sample-600"), SOLO2);
});

test("by2 Link: a ride's old solo token is refused at once (it may hold a pay / receipt link); the pair shares a tagged token", function () {
  const F = app.state, now = Date.now();
  app.publish(unlinkedPair());
  F.map["c_sample-600"] = { t: SOLO, at: now }; F.mapAt["c_sample-600"] = now;
  F.map["c_sample-601"] = { t: "" }; F.mapAt["c_sample-601"] = now;
  assert.equal(app.liveTok("c_sample-600"), SOLO, "unlinked: its own solo tracker, as in bx");
  app.publish(linkedPair("paid", "unpaid"));
  assert.equal(app.liveTok("c_sample-600"), "", "linked: old solo token refused");
  assert.equal(app.linkTok("c_sample-601"), "", "a solo token is never the shared one");
  assert.notEqual(innerTok("c_sample-601"), SOLO);
  F.lastPush = {}; F.lastSig = {}; F.lastSt = {};
  app.tickNow();
  assert.equal(F.lastPush[SOLO], undefined, "old solo tracker gets nothing more");
  /* the first text commits a token tagged with the group; the other ride joins that same token */
  const ctx = app.ctxs().filter(function (c) { return c.key === "c_sample-600"; })[0];
  assert.equal(ctx.linkGroup, "lk_sample01");
  app.commit("c_sample-600", SHARED, "driver", ctx);
  assert.equal(F.map["c_sample-600"].lk, "lk_sample01");
  assert.equal(app.linkTok("c_sample-601"), SHARED);
  assert.equal(innerTok("c_sample-601"), SHARED);
  assert.equal("linkGroup" in app.clean(ctx, 1), false, "the group id never reaches the public copy");
});

function loadGodNet(rows) {
  const db = Object.assign({}, rows), calls = [];
  const resp = function (v) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(v === undefined ? null : JSON.parse(JSON.stringify(v))); } }); };
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Number: Number, String: String, Object: Object, Array: Array, Intl: Intl,
    Promise: Promise, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, Symbol: Symbol, URL: URL, Uint8Array: Uint8Array, btoa: btoa,
    crypto: require("crypto").webcrypto,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: {
      currentScript: null, readyState: "complete",
      createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {} }; }, getElementById: function () { return null; }, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, addEventListener: function () {},
      head: { appendChild: function () {} }, body: { appendChild: function () {} }, documentElement: { appendChild: function () {} }
    },
    location: { search: "", hostname: "private-car-services.github.io", href: "https://private-car-services.github.io/pcs-ride-estimate/god/" },
    navigator: { userAgent: "test" }, localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function (url, o) {
      const m = /\/rides\/(FLWRDMAP|FLWSHARE)\/([^.]+)\.json/.exec(String(url));
      if (!m) return Promise.reject(new Error("no"));
      const key = m[1] + "/" + decodeURIComponent(m[2]), method = (o && o.method) || "GET";
      calls.push([method, key, o && o.body ? JSON.parse(o.body) : null]);
      if (method === "GET") return resp(db[key]);
      if (method === "DELETE") { delete db[key]; return resp(null); }
      db[key] = JSON.parse(o.body); return resp(null);
    },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "god/god.js"), "utf8"), sandbox, { filename: "god.js" });
  return { L: sandbox.__pcsGodLink, db: db, calls: calls };
}

test("by2 God Link: an old solo tracker is ended at once (PUT stopped wipes every field) and its row cleared", async function () {
  const n = loadGodNet({ "FLWRDMAP/c_a": { t: SOLO, at: 1, by: "god" }, ["FLWSHARE/" + SOLO]: { v: 1, status: "assigned", pay: "unpaid", invoiceNo: "000600", payUrl: PAY } });
  await n.L.end(["a", "b"], "lk_newgrp01");
  assert.deepEqual(Object.keys(n.db["FLWSHARE/" + SOLO]).sort(), ["endedAt", "status", "updatedAt", "v"]);
  assert.equal(n.db["FLWSHARE/" + SOLO].status, "stopped");
  assert.equal(JSON.stringify(n.db["FLWSHARE/" + SOLO]).indexOf("squareup"), -1, "pay link gone");
  assert.equal("FLWRDMAP/c_a" in n.db, false, "old solo row cleared: the pair starts on a fresh shared token");
  assert.equal(n.calls.filter(function (c) { return c[0] !== "GET"; }).length, 2, "nothing written for a ride with no tracker");
  /* a token already made for this same group is kept */
  assert.deepEqual(JSON.parse(JSON.stringify(n.L.endPlan({ a: { t: SHARED, lk: "lk_newgrp01" }, b: { t: SOLO, lk: "lk_oldgrp01" }, c: null }, "lk_newgrp01"))), [{ id: "b", t: SOLO }]);
});

test("by2 God Unlink: the shared tracker is ended and both rows cleared, so each ride starts fresh", async function () {
  const n = loadGodNet({ "FLWRDMAP/c_a": { t: SHARED, at: 1, lk: "lk_sample01" }, "FLWRDMAP/c_b": { t: SHARED, at: 1, lk: "lk_sample01" }, ["FLWSHARE/" + SHARED]: { v: 1, status: "on_way", linked: [{ invoiceNo: "000600", pay: "paid" }] } });
  await n.L.end(["a", "b"], "");
  assert.equal(n.db["FLWSHARE/" + SHARED].status, "stopped");
  assert.equal("linked" in n.db["FLWSHARE/" + SHARED], false);
  assert.equal("FLWRDMAP/c_a" in n.db, false); assert.equal("FLWRDMAP/c_b" in n.db, false);
  assert.equal(n.calls.filter(function (c) { return c[0] === "PUT"; }).length, 1, "the shared copy is ended once");
  const god = fs.readFileSync(path.join(root, "god/god.js"), "utf8"), save = god.slice(god.indexOf("function linkSave"), god.indexOf("function linkWho"));
  assert.ok(/unlink \? linkEndTrackers\(ids, ""\)\.then\(function \(\) \{ return linkPatch\(plan\); \}\)/.test(save), "unlink ends the shared tracker BEFORE the rows are unlinked");
});

test("by2 God tracking button: an unlinked ride never reuses a shared (lk) row; a linked ride never reuses a solo row", async function () {
  const n = loadGodNet({ "FLWRDMAP/c_a": { t: SHARED, at: 1, lk: "lk_sample01" }, ["FLWSHARE/" + SHARED]: { v: 1, status: "on_way" } });
  n.L.gfolMake("a", { id: "a", assignedDriverId: "d", assignedDriverName: "Matthew", pickup: "100 Sample Ln" });
  await new Promise(function (r) { setImmediate(r); }); await new Promise(function (r) { setImmediate(r); }); await new Promise(function (r) { setImmediate(r); });
  const row = n.db["FLWRDMAP/c_a"];
  assert.ok(row && /^[A-Za-z0-9_-]{32}$/.test(row.t));
  assert.notEqual(row.t, SHARED, "fresh token for the unlinked ride");
  assert.deepEqual(Object.keys(row).sort(), ["at", "by", "t"], "untagged, exactly like bx");
  const n2 = loadGodNet({ "FLWRDMAP/c_a": { t: SOLO, at: 1 }, ["FLWSHARE/" + SOLO]: { v: 1, status: "assigned", payUrl: PAY } });
  n2.L.gfolMake("a", { id: "a", assignedDriverId: "d", assignedDriverName: "Matthew", pickup: "100 Sample Ln", linkGroup: "lk_sample01", linkedIds: ["b"] });
  for (let i = 0; i < 6; i++) await new Promise(function (r) { setImmediate(r); });
  assert.notEqual(n2.db["FLWRDMAP/c_a"].t, SOLO, "linked ride does not reuse its solo token");
  assert.equal(n2.db["FLWRDMAP/c_a"].lk, "lk_sample01");
});

test("by2 extras removed: two-ride cap, no explanation text, no gold dashed box, no brown badge", function () {
  const god = fs.readFileSync(path.join(root, "god/god.js"), "utf8"), live = fs.readFileSync(path.join(root, "follow/follow-live.js"), "utf8");
  assert.equal(/dashed #d4b15a|6 rides at most|same drop-off, one tracker|The tracker shows each invoice number/.test(god), false);
  assert.equal(/#7c4a03|fl-linked|is-unpaid/.test(live), false);
  assert.equal(/Linked ride: every linked rider/.test(appSrc), false);
  const L = loadGod();
  const html = L.html({ id: "a", status: "assigned", start: "2026-11-17T07:45:00-06:00", rider: "Sample" });
  assert.ok(html.indexOf("Link ride") >= 0); assert.equal(/dashed|border:/.test(html), false);
});
