/* v2.0m-bn (Matthew 11/12: "fix my damn green bar" / "all to look exactly alike"): the ride (meter) full map carries the SAME
   solid dark green bar as the pickup full map, and waiting at the pickup keeps that same full map. Invoice fields are the live
   board rows read Nov 12 4:08 PM CT: Derek Means #000570 (PAID) and Rahual #000587 (UNPAID). */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const DEREK = { id: "icloud_9a8b615fc435a4eea898", status: "assigned", assignedDriverId: "mwragge_privatetaxiservices_net", prepaid: false, prepaidInvoiceNo: "000570", prepaidVia: "square_invoice",
  receiptUrl: "https://squareup.com/receipt/preview/wJ5IG1LBUjKu3hydKKtgyfJj9HeZY",
  sqInvoice: { number: "000570", paid: true, status: "PAID", source: "square", public_url: "https://app.squareup.com/pay-invoice/invtmp:9037ec7f-acaf-45c8-acaf-66586951e68e", receipt_url: "https://squareup.com/receipt/preview/wJ5IG1LBUjKu3hydKKtgyfJj9HeZY", subtotalCents: 6375, taxCents: 526, totalCents: 6901 } };
const RAHUAL = { id: "icloud_02ad9a255c520d271a1d", status: "assigned", assignedDriverId: "mwragge_privatetaxiservices_net", prepaidInvoiceNo: "000587",
  sqInvoice: { number: "000587", paid: false, status: "UNPAID", source: "square", public_url: "https://app.squareup.com/pay-invoice/invtmp:95a58e9c-5700-4c" } };

function el() {
  return { style: { setProperty: function () {}, removeProperty: function () {}, getPropertyValue: function () { return ""; } },
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {} };
}
function loadApp() {
  const store = { "pcs-driver-session": "mwragge@privatetaxiservices.net" };
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
const box = loadApp();
const S = box.__pcsSchedMeter.state();
S.scheduledRides = [DEREK, RAHUAL];
const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

test("ride map green bar: Derek #000570 Paid + View receipt (his real receipt link)", function () {
  const h = box.__pcsRideFull.green({ status: "running", schedId: DEREK.id });
  assert.ok(h.indexOf('class="pcs-map-green has-inv"') >= 0, h);
  assert.ok(h.indexOf('id="sched-fs-inv"') >= 0);
  assert.ok(h.indexOf("Invoice #000570 \u00b7 Paid \u00b7 ") >= 0, h);
  assert.ok(h.indexOf('href="https://squareup.com/receipt/preview/wJ5IG1LBUjKu3hydKKtgyfJj9HeZY"') >= 0, h);
  assert.ok(h.indexOf(">View receipt</a>") >= 0);
  assert.equal(h.indexOf("pay-invoice"), -1, "a paid ride never links the pay page");
});

test("ride map green bar: Rahual #000587 Unpaid + Pay invoice", function () {
  const h = box.__pcsRideFull.green({ status: "running", schedId: RAHUAL.id });
  assert.ok(h.indexOf("Invoice #000587 \u00b7 Unpaid \u00b7 ") >= 0, h);
  assert.ok(h.indexOf('href="https://app.squareup.com/pay-invoice/invtmp:95a58e9c-5700-4c"') >= 0, h);
  assert.ok(h.indexOf(">Pay invoice</a>") >= 0);
});

test("ride map green bar uses the very same invoice line as the pickup map", function () {
  [DEREK, RAHUAL].forEach(function (r) {
    const pick = box.__pcsV20lBill.fsInv(r);
    const ride = box.__pcsRideFull.green({ status: "running", schedId: r.id });
    assert.ok(pick && ride.indexOf(pick) >= 0, r.id);
  });
});

test("no linked board ride, no invoice number, or a cancelled ride: no bar (nothing invented)", function () {
  assert.equal(box.__pcsRideFull.green({ status: "running" }), "");
  assert.equal(box.__pcsRideFull.green({ status: "running", schedId: "nope" }), "");
  S.scheduledRides = [DEREK, RAHUAL, { id: "x1", status: "assigned" }, Object.assign({}, RAHUAL, { id: "x2", status: "cancelled" })];
  assert.equal(box.__pcsRideFull.green({ status: "running", schedId: "x1" }), "");
  assert.equal(box.__pcsRideFull.green({ status: "running", schedId: "x2" }), "");
  S.scheduledRides = [DEREK, RAHUAL];
});

test("waiting at the pickup keeps the same full map; the ride and no trip do not", function () {
  S.meter = null;
  box.__pcsSchedMeter.tripSave({ id: DEREK.id, phase: "pickup", at: 1 });
  assert.ok(box.__pcsRideFull.fsTrip());
  box.__pcsSchedMeter.tripSave({ id: DEREK.id, phase: "arrived", at: 1, arrivedAt: Date.now() });
  assert.ok(box.__pcsRideFull.fsTrip(), "arrived keeps the full map");
  S.meter = { status: "running", schedId: DEREK.id };
  assert.equal(box.__pcsRideFull.fsTrip(), null, "the meter map takes over once the ride starts");
  S.meter = null;
  box.__pcsSchedMeter.tripSave(null);
  assert.equal(box.__pcsRideFull.fsTrip(), null);
});

test("each screen keeps its own buttons: End ride / Add toll only on the ride map, Close map on both", function () {
  const pickupBot = /bot\.innerHTML = '([^']|\\')*sched-fs-close[^\n]*/.exec(src)[0];
  assert.equal(pickupBot.indexOf("rfs-end"), -1);
  assert.equal(pickupBot.indexOf("toll"), -1);
  assert.ok(src.indexOf('id="rfs-end" data-rfs="end"') >= 0);
  assert.ok(src.indexOf('id="rfs-toll-add"') >= 0);
  assert.ok(src.indexOf("html += rfsGreenHtml(M);") >= 0 && src.indexOf("html += rfsGreenHtml(M);") < src.indexOf('id="rfs-end" data-rfs="end"'), "green bar sits right above End ride / Close map");
  assert.ok(/SCHED_RIDER_IN_TEXT = "Rider is in \\u2013 start the ride"/.test(src), "the waiting action is the card's own Rider is in text");
});

test("the customer tracker is untouched by this change", function () {
  const follow = path.join(__dirname, "../follow");
  assert.ok(fs.existsSync(follow));
  assert.equal(src.indexOf("rfsGreenHtml", src.indexOf("v76b (Matthew 10/17): \"Follow my ride\"")), -1);
});
