/* Historical /driver/invoice fields stay. The link comes only from a fresh Square read. */
const assert = require("assert");
const test = require("node:test");
const patch = require("../worker/driver-invoice-square");

const PAY = "https://app.squareup.com/pay-invoice/invtmp:example-unpaid";
const RECEIPT = "https://squareup.com/receipt/preview/EXAMPLE";
const KV = { invoiceNo: "000100", amountCents: 7913, amountTaxCents: 0, status: "UNPAID", paid: false, at: 10, by: "god", subtotalCents: 7913 };

function liveUnpaid(extra) {
  return Object.assign({ invoiceNumber: "000100", status: "UNPAID", public_url: PAY, payments: [], recipientName: "Hidden" }, extra || {});
}
function livePaid(extra) {
  return Object.assign({ invoiceNumber: "000100", status: "PAID", public_url: PAY, recipientName: "Hidden", payments: [{ status: "COMPLETED", refundedCents: 0, receipt_url: RECEIPT }] }, extra || {});
}
function owned(id) {
  return { ride: async function (x) { return x === id ? { id: id, assignedDriverId: "driver-a" } : { id: x, assignedDriverId: "driver-b" }; } };
}

test("existing fields stay, and the stored paid flag does not choose the link", function () {
  const stale = patch.driverInvoiceView(Object.assign({}, KV, { paid: true, status: "PAID" }), null);
  assert.equal(stale.invoiceNo, "000100");
  assert.equal(stale.amountCents, 7913);
  assert.equal(stale.taxCents, 0);
  assert.equal(stale.paid, true);
  assert.equal(stale.at, 10);
  assert.equal(stale.square, undefined);
  assert.equal(stale.by, undefined);
  assert.equal(stale.subtotalCents, undefined);
  assert.equal(patch.followShareInvoice(stale).pay, "");
  const unpaid = patch.driverInvoiceView(Object.assign({}, KV, { paid: true }), liveUnpaid());
  assert.equal(unpaid.paid, true);
  assert.equal(unpaid.square.status, "UNPAID");
  assert.equal(patch.followShareInvoice(unpaid).pay, "unpaid");
  assert.equal(patch.followShareInvoice(unpaid).url, PAY);
  const paid = patch.driverInvoiceView(Object.assign({}, KV, { paid: false }), livePaid());
  assert.equal(paid.paid, false);
  assert.equal(patch.followShareInvoice(paid).pay, "paid");
  assert.equal(patch.followShareInvoice(paid).url, RECEIPT);
  assert.equal(paid.square.public_url, "");
  assert.equal(JSON.stringify(paid.square).indexOf("Hidden"), -1);
});

test("unknown, mismatched, refunded, partial, and canceled Square results have no link", function () {
  assert.equal(patch.squareForLinkedInvoice("000100", { invoiceNumber: "000100", status: "", public_url: PAY }), null);
  const draft = patch.driverInvoiceView(KV, liveUnpaid({ status: "DRAFT" }));
  assert.equal(draft.square.status, "DRAFT");
  assert.equal(draft.square.public_url, "");
  assert.equal(patch.followShareInvoice(draft).pay, "");
  const pending = patch.driverInvoiceView(KV, livePaid({ payments: [{ status: "PENDING", refundedCents: 0, receipt_url: RECEIPT }] }));
  assert.equal(pending.square.payments.length, 0);
  assert.equal(patch.followShareInvoice(pending).pay, "");
  const unpaidButCompleted = patch.driverInvoiceView(KV, liveUnpaid({ payments: [{ status: "COMPLETED", refundedCents: 0, receipt_url: RECEIPT }] }));
  assert.equal(unpaidButCompleted.square.public_url, "");
  assert.equal(patch.followShareInvoice(unpaidButCompleted).pay, "");
  const refunded = patch.driverInvoiceView(KV, livePaid({ payments: [{ status: "COMPLETED", refundedCents: 100, receipt_url: RECEIPT }] }));
  assert.equal(refunded.square.payments.length, 0);
  const partial = patch.driverInvoiceView(KV, livePaid({ status: "PARTIALLY_PAID" }));
  assert.equal(partial.square.public_url, "");
  assert.equal(partial.square.payments.length, 0);
  const canceled = patch.driverInvoiceView(KV, livePaid({ status: "CANCELED" }));
  assert.equal(canceled.square.status, "CANCELED");
  assert.equal(patch.followShareInvoice(canceled).url, "");
  assert.equal(patch.squareForLinkedInvoice("000100", livePaid({ invoiceNumber: "000200" })), null);
  const otherPayment = patch.driverInvoiceView(KV, livePaid({ payments: [{ status: "COMPLETED", refundedCents: 0, receipt_url: RECEIPT, invoiceNumber: "000200" }] }));
  assert.equal(otherPayment.square.payments.length, 0);
});

test("cross-driver, id mismatch, no auth, and a canceled ride do not leak another invoice", async function () {
  const body = await patch.driverInvoiceBody({
    token: "driver-token",
    rideIds: ["mine", "theirs", "replacement"],
    invoiceNo: "000999"
  }, "driver-a", {
    ride: async function (id) {
      if (id === "mine") return { id: "mine", assignedDriverId: "driver-a", status: "canceled" };
      if (id === "replacement") return { id: "not-replacement", assignedDriverId: "driver-a" };
      return { id: "theirs", assignedDriverId: "driver-b" };
    },
    kv: async function (id) { return id === "mine" ? KV : { invoiceNo: "000200", amountCents: 1, amountTaxCents: 0, paid: true, at: 2 }; },
    square: async function (no) { return no === "000100" ? liveUnpaid() : livePaid({ invoiceNumber: "000200" }); }
  });
  assert.deepEqual(Object.keys(body.invoices), ["mine"]);
  assert.equal(body.invoices.mine.paid, false);
  assert.equal(body.invoices.mine.square.public_url, PAY);
  assert.equal(JSON.stringify(body).indexOf("000200"), -1);
  assert.equal(JSON.stringify(body).indexOf("theirs"), -1);
  assert.equal(body.godToken, undefined);
  await assert.rejects(function () { return patch.driverInvoiceBody({ godToken: "x", token: "t", rideIds: ["mine"] }, "driver-a", {}); }, /god auth/);
  await assert.rejects(function () { return patch.driverInvoiceBody({ rideIds: ["mine"] }, "driver-a", {}); }, /driver token/);
  await assert.rejects(function () { return patch.driverInvoiceBody({ token: "t", rideIds: ["mine"] }, "", {}); }, /driver token/);
});

test("a shared invoice returns this ride's amounts only", function () {
  const mine = patch.driverInvoiceView({
    invoiceNo: "000100", amountCents: 2000, amountTaxCents: 100, paid: false, at: 3, shared: true, by: "god", subtotalCents: 7913
  }, liveUnpaid({ otherRideIds: ["ride-b"], otherDriverId: "driver-b", otherAmountCents: 5913 }));
  assert.equal(mine.amountCents, 2000);
  assert.equal(mine.taxCents, 100);
  assert.equal(mine.paid, false);
  assert.equal(mine.square.public_url, PAY);
  const text = JSON.stringify(mine);
  assert.equal(text.indexOf("ride-b"), -1);
  assert.equal(text.indexOf("driver-b"), -1);
  assert.equal(text.indexOf("5913"), -1);
  assert.equal(text.indexOf("7913"), -1);
  assert.equal(mine.shared, undefined);
  assert.equal(mine.by, undefined);
});

test("a payment during the ride is seen on the next fresh read", async function () {
  var phase = "unpaid";
  var calls = 0;
  const deps = {
    ride: async function () { return { id: "mine", assignedDriverId: "driver-a", status: "picked_up" }; },
    kv: async function () { return Object.assign({}, KV, { paid: false }); },
    square: async function (no) {
      calls += 1;
      assert.equal(no, "000100");
      return phase === "unpaid" ? liveUnpaid() : livePaid();
    }
  };
  const input = { token: "driver-token", rideIds: ["mine"] };
  const first = await patch.refreshAuthorizedShare(input, "driver-a", deps);
  assert.equal(first.shares.mine.pay, "unpaid");
  assert.equal(first.shares.mine.url, PAY);
  assert.equal(first.body.invoices.mine.paid, false);
  phase = "paid";
  const second = await patch.refreshAuthorizedShare(input, "driver-a", deps);
  assert.equal(calls, 2);
  assert.equal(second.shares.mine.pay, "paid");
  assert.equal(second.shares.mine.url, RECEIPT);
  assert.equal(second.body.invoices.mine.paid, false);
  assert.equal(patch.squareHostOk("http://evil.example/pay"), "");
});
