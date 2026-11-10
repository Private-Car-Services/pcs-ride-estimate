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
    document: { visibilityState: "visible", getElementById: function (id) { return nodes[id] || null; }, querySelector: function () { return null; }, createElement: function () { return make("made"); }, addEventListener: function () {}, head: { appendChild: function () {} }, body: { appendChild: function () {} } },
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

test("the status line is only the ride sentence, and Paid or Unpaid needs fresh Square truth", function () {
  const now = Date.now();
  const onWay = { status: "on_way", invoiceNo: "000562" };
  assert.equal(live.statusLine(onWay), "Your driver is on the way");
  assert.equal(live.statusLine(onWay).indexOf("Invoice"), -1);
  assert.equal(live.bill(onWay).show, true);
  assert.equal(live.bill(onWay).label, "Invoice #000562");
  assert.equal(live.bill(onWay).word, "");
  const draft = { status: "on_way", invoiceNo: "000562", sqInvoice: { status: "DRAFT", paid: false, checkedAt: now } };
  assert.equal(live.statusLine(draft), "Your driver is on the way");
  assert.equal(live.bill(draft).label, "Invoice #000562 · Unpaid");
  assert.equal(live.bill(draft).word, "Unpaid");
  assert.equal(live.bill(draft).show, true);
  assert.equal(live.bill(draft).link, null);
  const sent = { status: "on_way", invoiceNo: "000562", sqInvoice: { status: "SENT", paid: false, checkedAt: now }, payUrl: PAY };
  assert.equal(live.bill(sent).word, "Unpaid");
  assert.equal(live.bill(sent).link.href, PAY);
  assert.equal(live.bill(sent).link.text, "Pay invoice");
  const paid = { status: "picked_up", invoiceNo: "000554", sqInvoice: { status: "PAID", paid: true, checkedAt: now }, receiptUrl: RECEIPT };
  assert.equal(live.statusLine(paid).indexOf("Invoice"), -1);
  assert.ok(live.bill(paid).label.indexOf("Invoice #000554 · Paid") >= 0);
  assert.equal(live.bill(paid).word, "Paid");
  assert.equal(live.bill(paid).link.href, RECEIPT);
  const stale = { invoiceNo: "000562", sqInvoice: { status: "UNPAID", paid: false, checkedAt: Date.parse("2026-11-03T15:00:00Z") }, payUrl: PAY };
  assert.equal(live.bill(stale).word, "");
  assert.equal(live.bill(stale).show, true);
  assert.equal(live.bill(stale).label, "Invoice #000562");
  assert.equal(live.bill(stale).gap, "stale");
  assert.equal(live.statusLine(Object.assign({ status: "on_way" }, stale)), "Your driver is on the way");
  assert.equal(live.statusLine(Object.assign({ status: "on_way" }, stale)).indexOf("Invoice"), -1);
  assert.equal(live.bill({ bill: "invoiced" }).show, false);
  assert.equal(live.bill({ bill: "invoiced" }).word, "");
  const src = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../follow/index.html"), "utf8");
  assert.equal(src.indexOf('classList.add("fl-has-bill")'), -1);
  assert.equal(html.indexOf("fl-has-bill"), -1);
  assert.ok(html.indexOf("viewport-fit=cover") >= 0);
  assert.ok(html.indexOf("follow-live.js?v=2.0m-bc") >= 0);
  assert.ok(src.indexOf("top:max(6px, env(safe-area-inset-top, 0px))") >= 0);
  assert.ok(src.indexOf("right:max(6px, env(safe-area-inset-right, 0px))") >= 0);
  assert.ok(fs.readFileSync(path.join(__dirname, "../app/version.js"), "utf8").indexOf('var APP_VERSION = "v2.0m-bc"') >= 0);
});

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
  const paidPub = follow.clean({ status: "picked_up", bill: "invoiced", pay: "paid", invoiceNo: paid.invoiceNo, receiptUrl: RECEIPT, payUrl: PAY, checkedAt: now, sqStatus: "PAID" }, now);
  assert.equal(paidPub.receiptUrl, RECEIPT);
  assert.equal(paidPub.payUrl, undefined);
  assert.equal(paidPub.sqInvoice.paid, true);
  const shown = live.bill(paidPub);
  assert.equal(shown.word, "Paid");
  assert.equal(shown.link.href, RECEIPT);
  assert.equal(shown.link.text, "View receipt");
  assert.equal(live.statusLine(paidPub).indexOf("Invoice"), -1);
  assert.ok(live.bill(paidPub).label.indexOf("Invoice #000210 · Paid") >= 0);
  const owed = follow.share({ paid: true, fetchedAt: now, square: { invoiceNumber: "000574", status: "UNPAID", public_url: PAY, payments: [] } });
  assert.equal(owed.pay, "unpaid");
  const owedPub = follow.clean({ status: "on_way", bill: "invoiced", pay: "unpaid", invoiceNo: "000574", payUrl: PAY, receiptUrl: RECEIPT, checkedAt: now, sqStatus: "UNPAID" }, now);
  assert.equal(owedPub.payUrl, PAY);
  assert.equal(owedPub.receiptUrl, undefined);
  const owedShown = live.bill(owedPub);
  assert.equal(owedShown.word, "Unpaid");
  assert.equal(owedShown.link.href, PAY);
  assert.equal(owedShown.link.text, "Pay invoice");
  assert.equal(live.statusLine(owedPub).indexOf("Invoice"), -1);
  assert.ok(live.bill(owedPub).label.indexOf("Invoice #000574 · Unpaid") >= 0);
  const noCheck = follow.clean({ status: "on_way", pay: "unpaid", invoiceNo: "000574", payUrl: PAY }, now);
  assert.equal(noCheck.pay, undefined);
  assert.equal(noCheck.payUrl, undefined);
  assert.equal(noCheck.invoiceNo, "000574");
  const noLink = live.bill({ bill: "invoiced", pay: "unpaid", invoiceNo: "000574" });
  assert.equal(noLink.word, "");
  assert.equal(noLink.show, true);
  assert.equal(noLink.label, "Invoice #000574");
  assert.equal(noLink.link, null);
  assert.equal(noLink.gap, "number-only");
  const draftOnly = live.bill({ invoiceNo: "000562", sqInvoice: { status: "DRAFT", paid: false, checkedAt: now } });
  assert.equal(draftOnly.word, "Unpaid");
  assert.equal(draftOnly.link, null);
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
  assert.equal(script.label, "Invoice #000574");
  assert.equal(script.label.indexOf("unpaid"), -1);
});
