/* Customer tracker white bar: invoice number plus a real paid/unpaid link, or the old words when truth is missing. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const PAY = "https://squareup.com/pay-invoice/inv-real";
const RECEIPT = "https://squareup.com/receipt/preview/rcpt-real";

function el() {
  return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; } };
}
function loadApp() {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve("null"); }, json: function () { return Promise.resolve(null); } }); },
    PCS_SYNC: { databaseURL: "https://example.test" },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: function () { return el(); },
      body: { getAttribute: function () { return "driver"; }, style: {} }, head: { appendChild: function () {} }, documentElement: {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app.js" });
  return sandbox.__pcsFollow;
}
function loadFollow() {
  const nodes = {};
  function make(id) {
    return nodes[id] || (nodes[id] = { id: id, hidden: true, textContent: "", innerHTML: "", src: "", style: {}, children: [],
      appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {}, querySelector: function () { return null; } });
  }
  ["app", "fl-live", "fl-photo", "fl-status", "fl-bill", "fl-who", "fl-car", "fl-eta", "fl-from", "fl-to", "fl-upd", "fl-net", "fl-stops", "fl-big", "fl-map"].forEach(make);
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object,
    Array: Array, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: { visibilityState: "visible", getElementById: function (id) { return nodes[id] || null; }, createElement: function () { return make("made"); }, addEventListener: function () {}, head: { appendChild: function () {} }, body: {} },
    location: { search: "?t=" + "b".repeat(32) },
    fetch: function () { return new Promise(function () {}); },
    navigator: {}, addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8"), sandbox, { filename: "follow-live.js" });
  return sandbox.__pcsFollowLive;
}

const follow = loadApp();
const live = loadFollow();
const now = Date.now();

test("a bare invoice number is not labeled paid or unpaid and gets no link", function () {
  const bare = { prepaidInvoiceNo: "000554", status: "assigned", sqInvoice: { paid: true, status: "PAID" }, receiptUrl: RECEIPT };
  const via = { prepaidInvoiceNo: "000574", prepaid: false, prepaidVia: "square_invoice", prepaidAmountCents: 2066, payState: "invoice_pending", invoicePayUrl: PAY };
  assert.equal(follow.share(bare).pay, "");
  assert.equal(follow.share(via).url, "");
  assert.equal(follow.share(bare).invoiceNo, "");
  const pub = follow.clean({ status: "picked_up", bill: "invoiced", invoiceNo: "000554", payUrl: PAY, receiptUrl: RECEIPT }, now);
  assert.equal(pub.pay, undefined);
  assert.equal(pub.payUrl, undefined);
  assert.equal(pub.receiptUrl, undefined);
  assert.equal(pub.invoiceNo, "000554");
  const shown = live.bill({ status: "picked_up", bill: "invoiced", invoiceNo: "000554" });
  assert.equal(shown.label, "Invoice #000554");
  assert.equal(shown.link, null);
  assert.equal(shown.gap, "number-only");
  assert.equal(shown.label.indexOf("paid"), -1);
  assert.equal(shown.label.indexOf("unpaid"), -1);
});

test("verified paid and unpaid rows publish only a matching Square link", function () {
  const paid = follow.share({ paid: false, fetchedAt: now, square: { invoiceNumber: "000210", status: "PAID", public_url: PAY, payments: [{ status: "COMPLETED", refundedCents: 0, receipt_url: RECEIPT }] } });
  assert.equal(paid.pay, "paid");
  assert.equal(paid.invoiceNo, "000210");
  const paidPub = follow.clean({ status: "picked_up", bill: "invoiced", pay: "paid", invoiceNo: paid.invoiceNo, receiptUrl: RECEIPT, payUrl: PAY }, now);
  assert.equal(paidPub.receiptUrl, RECEIPT);
  assert.equal(paidPub.payUrl, undefined);
  const shown = live.bill(paidPub);
  assert.equal(shown.label, "Invoice #000210 – paid");
  assert.equal(shown.link.href, RECEIPT);
  assert.equal(shown.link.text, "View receipt");
  const owed = follow.share({ paid: true, fetchedAt: now, square: { invoiceNumber: "000574", status: "UNPAID", public_url: PAY, payments: [] } });
  assert.equal(owed.pay, "unpaid");
  const owedPub = follow.clean({ status: "on_way", bill: "invoiced", pay: "unpaid", invoiceNo: "000574", payUrl: PAY, receiptUrl: RECEIPT }, now);
  assert.equal(owedPub.payUrl, PAY);
  assert.equal(owedPub.receiptUrl, undefined);
  const owedShown = live.bill(owedPub);
  assert.equal(owedShown.label, "Invoice #000574 – unpaid");
  assert.equal(owedShown.link.href, PAY);
  assert.equal(owedShown.link.text, "Pay invoice");
  const noLink = live.bill({ bill: "invoiced", pay: "unpaid", invoiceNo: "000574" });
  assert.equal(noLink.label, "Invoice #000574 \u2013 unpaid");
  assert.equal(noLink.link, null);
  assert.equal(noLink.show, true);
  const noReceipt = live.bill({ bill: "invoiced", pay: "paid", invoiceNo: "000210" });
  assert.equal(noReceipt.label, "Invoice #000210 \u2013 paid");
  assert.equal(noReceipt.link, null);
  assert.equal(noReceipt.show, true);
});

test("partial, refund, and non-Square links are not a paid or unpaid href", function () {
  assert.equal(follow.share({ fetchedAt: now, square: { invoiceNumber: "000300", status: "PARTIALLY_PAID", public_url: PAY, payments: [] } }).pay, "");
  assert.equal(follow.share({ fetchedAt: now, square: { invoiceNumber: "000301", status: "REFUNDED", payments: [] } }).pay, "");
  assert.equal(follow.share({ paid: true, invoiceNo: "000302", receiptUrl: RECEIPT }).pay, "");
  assert.equal(follow.share({ invoiceStatus: "PARTIALLY_REFUNDED", prepaidInvoiceNo: "000303" }).pay, "");
  const evil = follow.clean({ status: "picked_up", bill: "invoiced", pay: "unpaid", invoiceNo: "000574", payUrl: "https://evil.example/pay" }, now);
  assert.equal(evil.payUrl, undefined);
  const script = live.bill({ bill: "invoiced", pay: "unpaid", invoiceNo: "000574", payUrl: "javascript:alert(1)" });
  assert.equal(script.link, null);
  assert.equal(script.label, "Invoice #000574 \u2013 unpaid");
});
