/* A paid Square invoice or a meter QR charge is not cash the driver owes. An unverified ride is not counted either way. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function loadGod() {
  const el = function () { return { style: {}, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {} }; };
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Number: Number, String: String, Object: Object, Array: Array,
    Promise: Promise, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, Symbol: Symbol,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: {
      currentScript: null, readyState: "complete",
      createElement: el, getElementById: function () { return null; }, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, addEventListener: function () {},
      head: { appendChild: function () {} }, body: { appendChild: function () {} }, documentElement: { appendChild: function () {} }
    },
    location: { search: "", hostname: "localhost", href: "http://localhost/god/" },
    navigator: { userAgent: "test" }, localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.reject(new Error("no")); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/god.js"), "utf8"), sandbox, { filename: "god.js" });
  return sandbox.__pcsPayBalance;
}

test("Square-paid and QR-paid rides are not counted as cash the driver owes", function () {
  const pay = loadGod();
  assert.equal(pay.cardProof({ paidVia: "square_invoice", paymentStatus: "paid_other" }), true);
  assert.equal(pay.cardProof({ paymentStatus: "charged", squarePaymentId: "pay_1", paidVia: "square_link" }), true);
  assert.equal(pay.cardProof({ paidVia: "square_invoice", paymentStatus: "invoice_pending" }), false);
  assert.equal(pay.cardProof({ paidVia: "other", paymentStatus: "unverified" }), false);
  assert.equal(pay.cardProof({ payMethod: "cash", paidVia: "cash", cashCollected: true }), false);
  const week = [
    { code: "CARD1", fareSub: 10000, fareTax: 825, fareTotal: 10825, commissionCents: 3000, tipCents: 500, paidVia: "square_invoice", paymentStatus: "paid_other", commissionPct: 30 },
    { code: "QR1", fareSub: 1475, fareTax: 122, fareTotal: 1597, commissionCents: 443, tipCents: 295, paymentStatus: "charged", paidVia: "square_link", squarePaymentId: "pay_qr", commissionPct: 30 },
    { code: "CASH1", fareSub: 10000, fareTax: 825, fareTotal: 10825, commissionCents: 3000, tipCents: 0, payMethod: "cash", paidVia: "cash", cashCollected: true, commissionPct: 30 },
    { code: "UNK1", fareSub: 2000, fareTax: 165, fareTotal: 2165, commissionCents: 600, tipCents: 0, paidVia: "other", paymentStatus: "unverified", commissionPct: 30 }
  ];
  const b = pay.balance(week, { driverId: "matthew", pctFor: function () { return 30; } });
  assert.equal(b.owedByDriver, 10825 - 3000);
  assert.equal(b.owedToDriver, 3000 + 500 + 443 + 295);
  assert.equal(b.net, b.owedToDriver - b.owedByDriver);
  assert.equal(b.unknown, 1);
  assert.equal(week[3].payUnknown, true);
  assert.notEqual(week[0][Symbol.for("pcsAsCash")], true);
});
