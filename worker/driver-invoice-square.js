/* Proposed addition to the existing POST /driver/invoice handler.
   Proposal only. Not a Worker and not a deploy. The sanitized historical
   v2.0m-t copy is not proven to be the live source.

   The historical object stays, including paid:
     { invoiceNo, amountCents, taxCents: amountTaxCents, paid: paid === true, at }
   verifiedPrepaid reads invoiceNo, amountCents, and taxCents. paid stays for
   any reader that already has it. The new paid/unpaid link reads only square,
   which is a fresh Square response for the invoice number stored on this ride.
   A stored paid flag never selects the link. There is no cache in this module:
   every call asks Square again, so a payment during the ride can replace the
   pay page with the receipt on the next authorized read.
*/
"use strict";

function squareHostOk(url) {
  var s = String(url || "").trim();
  if (!s || s.length > 300 || /[\s<>"']/.test(s)) return "";
  var m = /^https:\/\/([^\/?#:]+)(?:[\/?#]|$)/i.exec(s);
  if (!m || !/(^|\.)squareup(sandbox)?\.com$|(^|\.)square\.link$/i.test(m[1])) return "";
  return s;
}

function invoiceNoOf(v) {
  return String(v == null ? "" : v).replace(/^#/, "").replace(/\s+/g, "");
}

function refundedCents(p) {
  if (!p || typeof p !== "object") return 0;
  if (p.refundedCents != null && isFinite(+p.refundedCents)) return Math.round(+p.refundedCents);
  var money = p.refunded_money && p.refunded_money.amount;
  return isFinite(+money) ? Math.round(+money) : 0;
}

function paymentMatches(p, wantNo) {
  if (!p || typeof p !== "object") return false;
  var n = invoiceNoOf(p.invoiceNumber || p.invoice_number || "");
  return !n || n === wantNo;
}

/* Fresh Square invoice for the linked number only. Extra fields are not copied. */
function squareForLinkedInvoice(wantNo, live) {
  wantNo = invoiceNoOf(wantNo);
  if (!/^\d{1,20}$/.test(wantNo) || !live || typeof live !== "object") return null;
  var no = invoiceNoOf(live.invoiceNumber || live.invoice_number || live.number);
  if (no !== wantNo) return null;
  var status = String(live.status || "").toUpperCase();
  if (!status) return null;
  var payments = (Array.isArray(live.payments) ? live.payments : []).filter(function (p) { return paymentMatches(p, wantNo); });
  var blocked = /PARTIAL|REFUND|CANCEL|DRAFT|UNKNOWN|SCHEDULED/.test(status) || payments.some(function (p) {
    return refundedCents(p) > 0 || /REFUND/.test(String(p.status || ""));
  });
  var completed = payments.filter(function (p) {
    return String(p.status || "").toUpperCase() === "COMPLETED" && !(refundedCents(p) > 0);
  });
  var receipt = "";
  completed.forEach(function (p) { var u = squareHostOk(p.receipt_url || p.receiptUrl); if (u) receipt = u; });
  var payUrl = squareHostOk(live.public_url || live.publicUrl);
  var square = { invoiceNumber: wantNo, status: status, public_url: "", payments: [] };
  if (blocked) return square;
  if (status === "PAID" && completed.length === payments.length && completed.length && receipt) {
    square.payments = [{ status: "COMPLETED", refundedCents: 0, receipt_url: receipt }];
    return square;
  }
  if (status === "UNPAID" && !completed.length && payUrl) {
    square.public_url = payUrl;
    return square;
  }
  return square;
}

/* Original handler fields, unchanged, plus square when a fresh read matches. */
function driverInvoiceView(kv, live) {
  if (!kv || typeof kv !== "object") return null;
  var out = {
    invoiceNo: kv.invoiceNo,
    amountCents: kv.amountCents,
    taxCents: kv.amountTaxCents,
    paid: kv.paid === true,
    at: kv.at
  };
  var square = squareForLinkedInvoice(kv.invoiceNo, live);
  if (square) out.square = square;
  return out;
}

/* Link text for the new UI. view.paid is intentionally unread. */
function followShareInvoice(view) {
  var sq = view && view.square;
  var no = invoiceNoOf(sq && sq.invoiceNumber);
  if (!sq || !/^\d{1,20}$/.test(no)) return { invoiceNo: "", pay: "", url: "" };
  var receipt = sq.payments && sq.payments[0] && squareHostOk(sq.payments[0].receipt_url);
  if (sq.status === "PAID" && receipt) return { invoiceNo: no, pay: "paid", url: receipt };
  if (sq.status === "UNPAID" && squareHostOk(sq.public_url)) return { invoiceNo: no, pay: "unpaid", url: sq.public_url };
  return { invoiceNo: no, pay: "", url: "" };
}

/* Same ownership loop as the historical handler. Square is asked on every call. */
async function driverInvoiceBody(input, driverId, deps) {
  if (!input || !input.token || !driverId) { var err = new Error("driver token required"); err.status = 401; throw err; }
  if (Object.prototype.hasOwnProperty.call(input, "godToken") || Object.prototype.hasOwnProperty.call(input, "godPassword")) {
    var denied = new Error("god auth is not accepted on /driver/invoice"); denied.status = 400; throw denied;
  }
  var ids = (Array.isArray(input.rideIds) ? input.rideIds : []).map(String).slice(0, 30);
  var invoices = {};
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var row = await deps.ride(id);
    if (!row || String(row.assignedDriverId || "") !== String(driverId)) continue;
    if (row.id && String(row.id) !== id) continue;
    var kv = await deps.kv(id);
    if (!kv) { invoices[id] = null; continue; }
    var live = null;
    try { live = await deps.square(invoiceNoOf(kv.invoiceNo)); } catch (e) { live = null; }
    invoices[id] = driverInvoiceView(kv, live);
  }
  return { ok: true, invoices: invoices };
}

/* One fresh read for the rides in this request, then the share fields for each.
   Called again after the customer pays. Nothing is written here. */
async function refreshAuthorizedShare(input, driverId, deps) {
  var body = await driverInvoiceBody(input, driverId, deps);
  var shares = {};
  Object.keys(body.invoices).forEach(function (id) {
    if (body.invoices[id]) shares[id] = followShareInvoice(body.invoices[id]);
  });
  return { body: body, shares: shares };
}

module.exports = {
  squareHostOk: squareHostOk,
  squareForLinkedInvoice: squareForLinkedInvoice,
  driverInvoiceView: driverInvoiceView,
  followShareInvoice: followShareInvoice,
  driverInvoiceBody: driverInvoiceBody,
  refreshAuthorizedShare: refreshAuthorizedShare
};
