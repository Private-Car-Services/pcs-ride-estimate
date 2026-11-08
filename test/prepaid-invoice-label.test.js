/* Display-only: "Prepaid ride" gains " Invoice #<number>" when that trip has an invoice number. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function el() {
  return {
    style: {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    appendChild: function () {},
    addEventListener: function () {},
    setAttribute: function () {},
    getAttribute: function () { return ""; },
    removeAttribute: function () {}
  };
}

function loadApp() {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", share: null, geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {},
    removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: false, status: 0, text: function () { return Promise.resolve(""); }, json: function () { return Promise.resolve(null); } }); },
    document: {
      readyState: "complete",
      currentScript: { src: "" },
      visibilityState: "visible",
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      createElement: el,
      body: el(),
      head: el(),
      documentElement: el()
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app/app.js" });
  return sandbox.__pcsV20lBill;
}

const bill = loadApp();

test("prepaid ride with an invoice number appends Invoice # and keeps leading zeros", function () {
  assert.equal(bill.text("prepaid", "000555"), "Prepaid ride Invoice #000555");
  assert.equal(bill.text("prepaid", "#000555"), "Prepaid ride Invoice #000555");
  assert.equal(bill.text("prepaid", "Invoice #000555"), "Prepaid ride Invoice #000555");
  assert.equal(bill.text("prepaid", "Invoice 000555"), "Prepaid ride Invoice #000555");
  assert.equal(bill.text("prepaid", "  Invoice #  000555  "), "Prepaid ride Invoice #000555");
  const row = { prepaid: true, prepaidInvoiceNo: "000555" };
  assert.equal(bill.from(row, null), "000555");
  assert.equal(bill.text("prepaid", bill.from(row, null)), "Prepaid ride Invoice #000555");
  const html = bill.label("prepaid", "rfs-bill-label", "000555");
  assert.ok(html.indexOf("Prepaid ride Invoice #000555") >= 0);
  assert.equal(html.indexOf("Invoice #Invoice"), -1);
  assert.equal(html.indexOf("##"), -1);
  assert.ok(html.indexOf('id="rfs-bill-label"') >= 0);
});

test("invoice number is read from ride metadata and escaped on the same line", function () {
  assert.equal(bill.from({ invoiceNo: "000555" }, null), "000555");
  assert.equal(bill.from({ sqInvoice: { invoiceNumber: "000210" } }, null), "000210");
  assert.equal(bill.from({ sqInvoice: { number: "000210" } }, null), "000210");
  assert.equal(bill.from({}, { prepaid: { invoiceNo: "000088" } }), "000088");
  assert.equal(bill.from({ prepaidInvoiceNo: "000555", invoiceNo: "999" }, null), "000555");
  const html = bill.label("prepaid", "meter-bill-label", "000555<script>");
  assert.ok(html.indexOf("Prepaid ride Invoice #000555&lt;script&gt;") >= 0);
  assert.equal(html.indexOf("<script>"), -1);
  assert.equal((html.match(/<p /g) || []).length, 1);
});

test("missing or uninvoiced prepaid rides stay Prepaid ride with no invoice suffix", function () {
  ["", "   ", "#", "Invoice #", "Invoice #   ", null, undefined].forEach(function (raw) {
    assert.equal(bill.invoiceNo(raw), "");
    assert.equal(bill.text("prepaid", raw), "Prepaid ride");
    const html = bill.label("prepaid", "meter-bill-label", raw);
    assert.ok(html.indexOf(">Prepaid ride</p>") >= 0);
    assert.equal(html.indexOf("Invoice"), -1);
  });
  assert.equal(bill.from({}, null), "");
  assert.equal(bill.from({ prepaid: true }, null), "");
  assert.equal(bill.text("invoiced", ""), "Invoiced ride");
  assert.equal(bill.text("", "000555"), "");
  assert.equal(bill.label("invoiced", "ride-bill-label", "").indexOf("Invoice #"), -1);
});

test("invoiced and prepaid rides both show the saved number on the same green line", function () {
  const row = { prepaid: false, prepaidInvoiceNo: "000573", prepaidVia: "square_invoice" };
  assert.equal(bill.kind(row, null), "invoiced");
  assert.equal(bill.from(row, null), "000573");
  assert.equal(bill.text("invoiced", "000573"), "Invoiced ride Invoice #000573");
  assert.equal(bill.text("prepaid", "000573"), "Prepaid ride Invoice #000573");
  const invoiced = bill.label("invoiced", "sched-bill-label", "000573");
  const prepaid = bill.label("prepaid", "meter-bill-label", "000573");
  assert.ok(invoiced.indexOf("Invoiced ride Invoice #000573") >= 0);
  assert.ok(prepaid.indexOf("Prepaid ride Invoice #000573") >= 0);
  assert.ok(invoiced.indexOf("text-align:center") >= 0);
  assert.equal(invoiced.indexOf("prepaid:true"), -1);
  const map = bill.map(row);
  assert.ok(map.indexOf('id="sched-bill-label"') >= 0);
  assert.ok(map.indexOf("Invoiced ride Invoice #000573") >= 0);
  assert.equal(bill.map({ prepaid: true, prepaidInvoiceNo: "" }).indexOf("Invoice #"), -1);
  assert.ok(bill.map({ prepaid: true }).indexOf(">Prepaid ride</p>") >= 0);
  assert.equal(bill.kind(row, null), "invoiced");
});

test("the pickup status keeps Invoice #000574 on the same line and does not add a map row", function () {
  const row = { prepaid: true, prepaidInvoiceNo: "000574" };
  assert.equal(bill.pickupLine(row), "I\u2019m at the pickup \u00b7 Invoice #000574 \u2013 unpaid");
  assert.equal(bill.pickupLine({ prepaidInvoiceNo: "000574" }), "I\u2019m at the pickup \u00b7 Invoice #000574");
  assert.equal(bill.pickupLine({ prepaid: true }), "I\u2019m at the pickup \u00b7 Prepaid ride");
  assert.equal(bill.pickupLine({}), "I\u2019m at the pickup");
  assert.equal(bill.pay({ prepaidInvoiceNo: "000554" }), "");
  assert.equal(bill.bar({ prepaidInvoiceNo: "000554" }), "Invoice #000554");
  const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  const place = src.slice(src.indexOf("function schedMapBillPlace"), src.indexOf("function schedFsMeasure"));
  assert.match(place, /host\.remove/);
  assert.doesNotMatch(place, /insertBefore/);
  assert.match(place, /sched-fs-arrived/);
  assert.match(src, /nav-toggle\{bottom:calc\(var\(--pcs-safe-bottom/);
  assert.match(src, /leaflet-top\.leaflet-left\{top:calc\(var\(--pcs-safe-top/);
  assert.doesNotMatch(src.slice(src.indexOf("function schedFullStyle"), src.indexOf("function schedFullResize")), /nav-toggle\{bottom:172px/);
});

test("invoice line stays one centered line without clipping", function () {
  const css = bill.fit();
  const html = bill.label("prepaid", "meter-bill-label", "000555");
  assert.equal((html.match(/<p /g) || []).length, 1);
  assert.ok(html.indexOf("Prepaid ride Invoice #000555") >= 0);
  assert.ok(html.indexOf("text-align:center") >= 0);
  assert.equal(html.indexOf("font-size:22px"), -1);
  assert.equal(html.indexOf("white-space:nowrap"), -1);
  assert.equal(html.indexOf("overflow:hidden"), -1);
  assert.equal(html.indexOf("text-overflow"), -1);
  assert.ok(css.indexOf("clamp(16px,calc(6.35cqw - 1px),22px)") >= 0);
  assert.ok(css.indexOf("#rfs-bar") >= 0 && css.indexOf("#meter-running") >= 0);
  assert.equal(css.indexOf("nowrap"), -1);
  assert.equal(css.indexOf("overflow"), -1);
});
