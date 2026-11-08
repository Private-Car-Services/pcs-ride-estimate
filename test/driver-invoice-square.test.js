/* The historical /driver/invoice row is amounts plus a stored paid boolean.
   The proposed row adds a live Square object for that linked invoice only. */
const assert = require("assert");
const test = require("node:test");
const patch = require("../worker/driver-invoice-square");

const PAY = "https://app.squareup.com/pay-invoice/invtmp:example-unpaid";
const RECEIPT = "https://squareup.com/receipt/preview/EXAMPLE";
const KV = { invoiceNo: "000100", amountCents: 7913, amountTaxCents: 0, status: "UNPAID", paid: false, at: 10, by: "god" };

function liveUnpaid(extra) {
  return Object.assign({ invoiceNumber: "000100", status: "UNPAID", public_url: PAY, payments: [] }, extra || {});
}
function livePaid(extra) {
  return Object.assign({ invoiceNumber: "000100", status: "PAID", public_url: PAY, payments: [{ status: "COMPLETED", refundedCents: 0, receipt_url: RECEIPT }] }, extra || {});
}

test("the stored paid flag is not a link, and a live read is", function () {
  const stale = patch.driverInvoiceView(Object.assign({}, KV, { paid: true, status: "PAID" }), null);
  assert.equal(stale.paid, undefined);
  assert.equal(stale.square, undefined);
  assert.equal(stale.amountCents, 7913);
  const unpaid = patch.driverInvoiceView(Object.assign({}, KV, { paid: true }), liveUnpaid());
  assert.equal(unpaid.square.status, "UNPAID");
  assert.equal(unpaid.square.public_url, PAY);
  assert.equal(unpaid.square.payments.length, 0);
  const paid = patch.driverInvoiceView(KV, livePaid());
  assert.equal(paid.square.payments[0].receipt_url, RECEIPT);
  assert.equal(paid.square.public_url, "");
  assert.notEqual(paid.square.payments[0].receipt_url, PAY);
});

test("a different Square invoice and a refund produce no link", function () {
  assert.equal(patch.squareForLinkedInvoice("000100", livePaid({ invoiceNumber: "000200" })), null);
  const refunded = patch.driverInvoiceView(KV, livePaid({ payments: [{ status: "COMPLETED", refundedCents: 100, receipt_url: RECEIPT }] }));
  assert.equal(refunded.square.public_url, "");
  assert.equal(refunded.square.payments.length, 0);
  const share = patch.followShareInvoice(refunded);
  assert.equal(share.pay, "");
  assert.equal(share.url, "");
  assert.equal(patch.followShareInvoice(patch.driverInvoiceView(KV, liveUnpaid())).url, PAY);
  assert.equal(patch.followShareInvoice(patch.driverInvoiceView(KV, livePaid())).pay, "paid");
});

test("only the assigned ride is returned, and a God token is refused", async function () {
  const asked = [];
  const body = await patch.driverInvoiceBody({
    token: "driver-token",
    rideIds: ["mine", "theirs", "mine"],
    invoiceNo: "000999"
  }, "driver-a", {
    ride: async function (id) {
      if (id === "mine") return { assignedDriverId: "driver-a" };
      if (id === "theirs") return { assignedDriverId: "driver-b" };
      return null;
    },
    kv: async function () { return KV; },
    square: async function (no) { asked.push(no); return liveUnpaid(); }
  });
  assert.deepEqual(Object.keys(body.invoices), ["mine"]);
  assert.deepEqual(asked, ["000100", "000100"]);
  assert.equal(body.godToken, undefined);
  assert.equal(body.invoices.mine.square.invoiceNumber, "000100");
  await assert.rejects(function () { return patch.driverInvoiceBody({ godToken: "x", rideIds: ["mine"] }, "driver-a", {}); }, /god auth/);
  await assert.rejects(function () { return patch.driverInvoiceBody({ rideIds: ["mine"] }, "", {}); }, /driver token/);
});

test("a Square miss keeps the amounts and does not invent paid", async function () {
  const body = await patch.driverInvoiceBody({ rideIds: ["mine"] }, "driver-a", {
    ride: async function () { return { assignedDriverId: "driver-a" }; },
    kv: async function () { return Object.assign({}, KV, { paid: true }); },
    square: async function () { throw new Error("square down"); }
  });
  assert.equal(body.invoices.mine.amountCents, 7913);
  assert.equal(body.invoices.mine.square, undefined);
  assert.equal(body.invoices.mine.paid, undefined);
  assert.equal(patch.squareHostOk("http://evil.example/pay"), "");
  assert.equal(patch.squareHostOk("https://app.squareup.com/pay-invoice/invtmp:example"), "https://app.squareup.com/pay-invoice/invtmp:example");
});
