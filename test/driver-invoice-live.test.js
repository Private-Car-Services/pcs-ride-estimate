/* Staged Worker read. Not deployed. Square bodies match the published examples. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const live = require("../worker/driver-invoice-live.js");

const src = fs.readFileSync(path.join(__dirname, "../worker/driver-invoice-live.js"), "utf8");
const RECEIPT = "https://squareup.com/receipt/preview/bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY";
const ORDER_ID = "CAISENgvlJ6jLWAzERDzjyHVybY";
const PAYMENT_ID = "bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY";

/* Get invoice example, status flipped to PAID. No payments array: Invoice has none.
   https://developer.squareup.com/reference/square/invoices-api/get-invoice */
function paidInvoice() {
  return {
    id: "inv:0-ChCHu2mZEabLeeHahQnXDjZQECY",
    version: 1,
    location_id: "ES0RJRZYEC39A",
    order_id: ORDER_ID,
    payment_requests: [{
      uid: "2da7964f-f3d2-4f43-81e8-5aa220bf3355",
      request_type: "BALANCE",
      due_date: "2030-01-24",
      computed_amount_money: { amount: 10000, currency: "USD" },
      total_completed_amount_money: { amount: 10000, currency: "USD" }
    }],
    invoice_number: "000562",
    public_url: "https://squareup.com/pay-invoice/inv-should-not-be-used",
    status: "PAID",
    timezone: "America/Los_Angeles",
    created_at: "2020-06-18T17:45:13Z",
    updated_at: "2020-06-18T17:45:13Z"
  };
}

/* Official DRAFT example, plus a stray public_url the code must ignore.
   https://developer.squareup.com/reference/square/enums/InvoiceStatus */
function draftInvoice() {
  return {
    id: "inv:0-ChCHu2mZEabLeeHahQnXDjZQECY",
    version: 0,
    location_id: "ES0RJRZYEC39A",
    order_id: ORDER_ID,
    payment_requests: [{
      uid: "2da7964f-f3d2-4f43-81e8-5aa220bf3355",
      request_type: "BALANCE",
      due_date: "2030-01-24",
      computed_amount_money: { amount: 10000, currency: "USD" },
      total_completed_amount_money: { amount: 0, currency: "USD" }
    }],
    invoice_number: "000562",
    public_url: "https://squareup.com/pay-invoice/draft-must-not-leak",
    status: "DRAFT",
    timezone: "America/Los_Angeles",
    created_at: "2020-06-18T17:45:13Z",
    updated_at: "2020-06-18T17:45:13Z",
    primary_recipient: { customer_id: "JDKYHBWT1D4F8MFH63DBMEN8Y4", given_name: "Amelia", family_name: "Earhart" },
    delivery_method: "EMAIL"
  };
}

/* Tender.payment_id is the v2 Payment id. Tender.id is the same id when payment_id is absent.
   https://developer.squareup.com/reference/square/objects/Tender */
function paidOrder() {
  return {
    id: ORDER_ID,
    location_id: "ES0RJRZYEC39A",
    state: "COMPLETED",
    tenders: [{
      id: PAYMENT_ID,
      location_id: "ES0RJRZYEC39A",
      transaction_id: ORDER_ID,
      created_at: "2021-10-13T19:34:33.524Z",
      amount_money: { amount: 10000, currency: "USD" },
      type: "CARD",
      payment_id: PAYMENT_ID
    }]
  };
}

/* Get payment example. receipt_url is set only for COMPLETED payments.
   https://developer.squareup.com/reference/square/payments-api/get-payment */
function paidPayment() {
  return {
    id: PAYMENT_ID,
    created_at: "2021-10-13T19:34:33.524Z",
    updated_at: "2021-10-13T19:34:34.339Z",
    amount_money: { amount: 10000, currency: "USD" },
    status: "COMPLETED",
    source_type: "CARD",
    order_id: ORDER_ID,
    location_id: "L88917AVBK2S5",
    receipt_number: "bP9m",
    receipt_url: RECEIPT,
    total_money: { amount: 10000, currency: "USD" }
  };
}

function kvEnv() {
  const store = {};
  return {
    SQUARE_ACCESS_TOKEN: "test-token-not-a-real-secret",
    INVOICE_KV: {
      get: async function (key) { return store[key] ? JSON.parse(store[key]) : null; },
      put: async function (key, val) { store[key] = val; }
    }
  };
}

test("the staged file names the Square secret and does not read invoice.payments", function () {
  assert.ok(src.indexOf("SQUARE_ACCESS_TOKEN") >= 0);
  assert.ok(src.indexOf("https://connect.squareup.com") >= 0);
  assert.ok(src.indexOf("/v2/orders/") >= 0);
  assert.ok(src.indexOf("/v2/payments/") >= 0);
  assert.equal(src.indexOf("invoice.payments"), -1);
  assert.equal(live.CACHE_MS, 45000);
  assert.equal(src.indexOf("EAAA"), -1);
  assert.equal(src.indexOf("sq0atp"), -1);
  assert.equal(src.indexOf("Bearer sq"), -1);
});

test("a tender uses payment_id and falls back to id", function () {
  assert.deepEqual(live.paymentIdsOf(paidOrder()), [PAYMENT_ID]);
  assert.deepEqual(live.paymentIdsOf({ tenders: [{ id: "only-tender-id", type: "CARD" }] }), ["only-tender-id"]);
});

test("DRAFT has no payUrl and PAID does not keep public_url", function () {
  const now = Date.now();
  const draft = live.squareToRow(draftInvoice(), now, RECEIPT);
  assert.equal(draft.number, "000562");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.paid, false);
  assert.equal(draft.payUrl, "");
  assert.equal(draft.receiptUrl, "");
  const paid = live.squareToRow(paidInvoice(), now, RECEIPT);
  assert.equal(paid.paid, true);
  assert.equal(paid.payUrl, "");
  assert.equal(paid.receiptUrl, RECEIPT);
  const owed = live.squareToRow({ id: "inv:3", invoice_number: "000562", status: "UNPAID", public_url: "https://app.squareup.com/pay-invoice/invtmp:example" }, now, "");
  assert.equal(owed.paid, false);
  assert.equal(owed.payUrl, "https://app.squareup.com/pay-invoice/invtmp:example");
  assert.equal(owed.receiptUrl, "");
});

test("a paid invoice walks order tender to payment.receipt_url and caches it", async function () {
  const env = kvEnv();
  const calls = [];
  const fetchImpl = async function (url) {
    calls.push(url);
    if (url.indexOf("/v2/invoices/") >= 0) return { ok: true, json: async function () { return { invoice: paidInvoice() }; } };
    if (url.indexOf("/v2/orders/") >= 0) return { ok: true, json: async function () { return { order: paidOrder() }; } };
    if (url.indexOf("/v2/payments/") >= 0) return { ok: true, json: async function () { return { payment: paidPayment() }; } };
    return { ok: false, status: 404, json: async function () { return { errors: [{ code: "NOT_FOUND" }] }; } };
  };
  const first = await live.liveDriverInvoice(env, { rideIds: ["ride-562"] }, function () { return "inv:0-ChCHu2mZEabLeeHahQnXDjZQECY"; }, fetchImpl);
  assert.deepEqual(calls, [
    "https://connect.squareup.com/v2/invoices/" + encodeURIComponent("inv:0-ChCHu2mZEabLeeHahQnXDjZQECY"),
    "https://connect.squareup.com/v2/orders/" + encodeURIComponent(ORDER_ID),
    "https://connect.squareup.com/v2/payments/" + encodeURIComponent(PAYMENT_ID)
  ]);
  const row = first.invoices["ride-562"];
  assert.equal(row.number, "000562");
  assert.equal(row.status, "PAID");
  assert.equal(row.paid, true);
  assert.equal(row.payUrl, "");
  assert.equal(row.receiptUrl, RECEIPT);
  assert.ok(row.checkedAt > 0);
  const second = await live.liveDriverInvoice(env, { rideIds: ["ride-562"] }, function () { return "inv:0-ChCHu2mZEabLeeHahQnXDjZQECY"; }, fetchImpl);
  assert.equal(calls.length, 3);
  assert.equal(second.invoices["ride-562"].receiptUrl, RECEIPT);
  assert.equal(second.invoices["ride-562"].payUrl, "");
});

test("a DRAFT invoice does not fetch the order and returns no payUrl", async function () {
  const env = kvEnv();
  const calls = [];
  const fetchImpl = async function (url) {
    calls.push(url);
    return { ok: true, json: async function () { return { invoice: draftInvoice() }; } };
  };
  const out = await live.liveDriverInvoice(env, { rideIds: ["ride-draft"] }, function () { return "inv:0-ChCHu2mZEabLeeHahQnXDjZQECY"; }, fetchImpl);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].indexOf("/v2/invoices/") >= 0);
  assert.equal(calls.some(function (url) { return url.indexOf("/v2/orders/") >= 0 || url.indexOf("/v2/payments/") >= 0; }), false);
  assert.equal(out.invoices["ride-draft"].status, "DRAFT");
  assert.equal(out.invoices["ride-draft"].paid, false);
  assert.equal(out.invoices["ride-draft"].payUrl, "");
  assert.equal(out.invoices["ride-draft"].receiptUrl, "");
});

test("an UNPAID invoice uses public_url and does not fetch a payment", async function () {
  const env = kvEnv();
  const calls = [];
  const fetchImpl = async function (url) {
    calls.push(url);
    return { ok: true, json: async function () { return { invoice: { id: "inv:unpaid", invoice_number: "000562", status: "UNPAID", order_id: ORDER_ID, public_url: "https://squareup.com/pay-invoice/inv-562" } }; } };
  };
  const out = await live.liveDriverInvoice(env, { rideIds: ["ride-owed"] }, function () { return "inv:unpaid"; }, fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(out.invoices["ride-owed"].payUrl, "https://squareup.com/pay-invoice/inv-562");
  assert.equal(out.invoices["ride-owed"].paid, false);
  assert.equal(out.invoices["ride-owed"].receiptUrl, "");
});
