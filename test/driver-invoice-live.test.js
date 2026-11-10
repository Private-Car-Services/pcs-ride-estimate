/* Staged Worker read. Not deployed. Confirms a live Square GET and a 45s cache. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const live = require("../worker/driver-invoice-live.js");

const src = fs.readFileSync(path.join(__dirname, "../worker/driver-invoice-live.js"), "utf8");

test("the staged file names the Square secret and does not contain a token value", function () {
  assert.ok(src.indexOf("SQUARE_ACCESS_TOKEN") >= 0);
  assert.ok(src.indexOf("https://connect.squareup.com/v2/invoices/") >= 0);
  assert.equal(live.CACHE_MS, 45000);
  assert.equal(src.indexOf("EAAA"), -1);
  assert.equal(src.indexOf("sq0atp"), -1);
  assert.equal(src.indexOf("Bearer sq"), -1);
});

test("a DRAFT invoice becomes unpaid and a PAID invoice keeps the receipt url", function () {
  const now = Date.now();
  const draft = live.squareToRow({ id: "inv:1", invoice_number: "000562", status: "DRAFT", public_url: "" }, now);
  assert.equal(draft.number, "000562");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.paid, false);
  assert.equal(draft.payUrl, "");
  assert.equal(draft.receiptUrl, "");
  assert.equal(draft.checkedAt, now);
  const paid = live.squareToRow({
    id: "inv:2", invoice_number: "000562", status: "PAID", public_url: "https://squareup.com/pay-invoice/old",
    payments: [{ status: "COMPLETED", receipt_url: "https://squareup.com/receipt/preview/rcpt-562" }]
  }, now);
  assert.equal(paid.paid, true);
  assert.equal(paid.receiptUrl, "https://squareup.com/receipt/preview/rcpt-562");
  assert.equal(paid.payUrl, "https://squareup.com/pay-invoice/old");
});

test("POST /driver/invoice shape GETs Square once, then serves the 45s cache", async function () {
  const store = {};
  const env = {
    SQUARE_ACCESS_TOKEN: "test-token-not-a-real-secret",
    INVOICE_KV: {
      get: async function (key) { return store[key] ? JSON.parse(store[key]) : null; },
      put: async function (key, val) { store[key] = val; }
    }
  };
  const calls = [];
  const fetchImpl = async function (url) {
    calls.push(url);
    return { ok: true, json: async function () { return { invoice: { id: "inv:562", invoice_number: "000562", status: "UNPAID", public_url: "https://squareup.com/pay-invoice/inv-562" } }; } };
  };
  const first = await live.liveDriverInvoice(env, { rideIds: ["ride-562", "ride-562"] }, function () { return "inv:562"; }, fetchImpl);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].indexOf("/v2/invoices/inv%3A562") >= 0);
  assert.equal(first.invoices["ride-562"].number, "000562");
  assert.equal(first.invoices["ride-562"].status, "UNPAID");
  assert.equal(first.invoices["ride-562"].paid, false);
  assert.equal(first.invoices["ride-562"].payUrl, "https://squareup.com/pay-invoice/inv-562");
  assert.ok(first.invoices["ride-562"].checkedAt > 0);
  const second = await live.liveDriverInvoice(env, { rideIds: ["ride-562"] }, function () { return "inv:562"; }, fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(second.invoices["ride-562"].status, "UNPAID");
});
