/* Proposed response for the existing POST /driver/invoice handler.
   This is not a Worker and it is not a deploy. The only Worker text available
   is a sanitized historical v2.0m-t staged copy. It is not proven to be live.
   Do not ship that copy. Apply this only after the current Worker source is identified.

   Historical handler, after driverFromToken and the assigned-driver check:
     out[id] = k ? { invoiceNo, amountCents, taxCents: k.amountTaxCents, paid: k.paid === true, at: k.at } : null
   That KV row is a snapshot from the God link. It has a paid boolean and a status
   string, and it has no public_url and no payment receipt. /sq/invoice is God-only
   and returns godToken. This response does not call it and does not copy paid.
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

/* live is one Square invoice read for the KV invoice number. A different number is ignored. */
function squareForLinkedInvoice(wantNo, live) {
  wantNo = invoiceNoOf(wantNo);
  if (!/^\d{1,20}$/.test(wantNo) || !live || typeof live !== "object") return null;
  var no = invoiceNoOf(live.invoiceNumber || live.invoice_number || live.number);
  if (no !== wantNo) return null;
  var status = String(live.status || "").toUpperCase();
  if (!/^(PAID|UNPAID|PARTIALLY_PAID|REFUNDED|CANCELED|CANCELLED)$/.test(status)) return null;
  var payments = Array.isArray(live.payments) ? live.payments : [];
  var refunded = /PARTIAL|REFUND|CANCEL/.test(status) || payments.some(function (p) {
    return p && (refundedCents(p) > 0 || /REFUND/.test(String(p.status || "")));
  });
  var completed = payments.filter(function (p) {
    return p && String(p.status || "").toUpperCase() === "COMPLETED" && !(refundedCents(p) > 0);
  });
  var receipt = "";
  completed.forEach(function (p) { var u = squareHostOk(p.receipt_url || p.receiptUrl); if (u) receipt = u; });
  var payUrl = squareHostOk(live.public_url || live.publicUrl);
  var square = { invoiceNumber: wantNo, status: status, public_url: "", payments: [] };
  if (!refunded && status === "PAID" && completed.length && receipt) square.payments = [{ status: "COMPLETED", refundedCents: 0, receipt_url: receipt }];
  else if (!refunded && status === "UNPAID" && !completed.length && payUrl) square.public_url = payUrl;
  return square;
}

/* Keeps the amount fields the driver app already reads. Drops the stored paid flag. */
function driverInvoiceView(kv, live) {
  if (!kv || typeof kv !== "object") return null;
  var no = invoiceNoOf(kv.invoiceNo);
  if (!/^\d{1,20}$/.test(no)) return null;
  var out = {
    invoiceNo: no,
    amountCents: isFinite(+kv.amountCents) ? Math.round(+kv.amountCents) : null,
    taxCents: isFinite(+kv.amountTaxCents) ? Math.round(+kv.amountTaxCents) : (isFinite(+kv.taxCents) ? Math.round(+kv.taxCents) : null),
    at: isFinite(+kv.at) ? Math.round(+kv.at) : 0
  };
  var square = squareForLinkedInvoice(no, live);
  if (square) out.square = square;
  return out;
}

/* Fields the driver may place on the existing unguessable follow share. Not a lookup. */
function followShareInvoice(view) {
  var sq = view && view.square;
  var no = invoiceNoOf((sq && sq.invoiceNumber) || (view && view.invoiceNo));
  if (!/^\d{1,20}$/.test(no)) return { invoiceNo: "", pay: "", url: "" };
  var receipt = sq && sq.payments && sq.payments[0] && squareHostOk(sq.payments[0].receipt_url);
  if (sq && sq.status === "PAID" && receipt) return { invoiceNo: no, pay: "paid", url: receipt };
  if (sq && sq.status === "UNPAID" && squareHostOk(sq.public_url)) return { invoiceNo: no, pay: "unpaid", url: sq.public_url };
  return { invoiceNo: no, pay: "", url: "" };
}

/* Same loop as the historical handler. Deps are injected. input.invoiceNo is never read. */
async function driverInvoiceBody(input, driverId, deps) {
  if (!driverId) { var err = new Error("driver token required"); err.status = 401; throw err; }
  if (input && (Object.prototype.hasOwnProperty.call(input, "godToken") || Object.prototype.hasOwnProperty.call(input, "godPassword"))) {
    var denied = new Error("god auth is not accepted on /driver/invoice"); denied.status = 400; throw denied;
  }
  var ids = (Array.isArray(input && input.rideIds) ? input.rideIds : []).map(String).slice(0, 30);
  var invoices = {};
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var row = await deps.ride(id);
    if (!row || String(row.assignedDriverId || "") !== String(driverId)) continue;
    var kv = await deps.kv(id);
    if (!kv) { invoices[id] = null; continue; }
    var live = null;
    try { live = await deps.square(invoiceNoOf(kv.invoiceNo)); } catch (e) { live = null; }
    invoices[id] = driverInvoiceView(kv, live);
  }
  return { ok: true, invoices: invoices };
}

module.exports = {
  squareHostOk: squareHostOk,
  squareForLinkedInvoice: squareForLinkedInvoice,
  driverInvoiceView: driverInvoiceView,
  followShareInvoice: followShareInvoice,
  driverInvoiceBody: driverInvoiceBody
};
