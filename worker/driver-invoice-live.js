"use strict";
/**
 * NOT DEPLOYED. Do not publish this file to Cloudflare from this repo.
 *
 * Staged Square read for POST /driver/invoice on https://pcs-pay.pcsrides.workers.dev.
 *
 * Finding (this repository only):
 * There is no Worker source and no worker/ directory besides this staged file.
 * Nothing here calls GET https://connect.squareup.com/v2/invoices/{id}.
 * app/app.js, the comment above verInvFetch, says the invoice used for pay
 * "comes ONLY from the Worker (KV, read from Square by the Worker)".
 * That is a cached KV read, not a live Square GET on each /driver/invoice call.
 *
 * How to use, when the real Worker repo is open:
 * Keep the existing driver-token check on POST /driver/invoice.
 * Replace the KV-only status return with liveDriverInvoice(env, body, lookup).
 * lookup(rideId) should return the Square invoice id the current handler already stores.
 *
 * Receipt path (Square Invoice has no payments field):
 *   GET /v2/invoices/{invoice_id}
 *   when status is PAID or PARTIALLY_PAID and order_id is set:
 *     GET /v2/orders/{order_id} -> tenders[].payment_id, else tenders[].id
 *     GET /v2/payments/{payment_id} -> payment.receipt_url
 *   The assembled row, including receiptUrl, is cached for 45 seconds.
 * payUrl is invoice.public_url only when status is UNPAID. DRAFT has no public_url.
 *
 * Field names checked against:
 *   https://developer.squareup.com/reference/square/objects/Invoice
 *   https://developer.squareup.com/reference/square/enums/InvoiceStatus
 *   https://developer.squareup.com/reference/square/invoices-api/get-invoice
 *   https://developer.squareup.com/reference/square/objects/Order
 *   https://developer.squareup.com/reference/square/orders-api/retrieve-order
 *   https://developer.squareup.com/reference/square/objects/Tender
 *   https://developer.squareup.com/reference/square/objects/Payment
 *   https://developer.squareup.com/reference/square/payments-api/get-payment
 *
 * Secret name only (no value is in this file):
 *   SQUARE_ACCESS_TOKEN
 *     Bearer token for connect.squareup.com. POST /sq/invoice already talks to
 *     Square, so reuse that route's existing token binding if its name differs.
 * Optional binding:
 *   INVOICE_KV
 *     ride-invoice:{rideId} -> { squareInvoiceId } when lookup is not passed.
 *     driver-invoice-live:{rideId} -> the 45s status cache this file writes.
 */
var SQUARE_VERSION = "2026-09-16";
var CACHE_MS = 45000;

function payUrlOf(invoice) {
  var status = String(invoice && invoice.status || "").toUpperCase();
  /* UNPAID is the published, not-yet-paid state. DRAFT has no public_url. */
  if (status !== "UNPAID") return "";
  return String(invoice && invoice.public_url || "");
}

function paymentIdsOf(order) {
  var tenders = order && Array.isArray(order.tenders) ? order.tenders : [];
  var ids = [];
  tenders.forEach(function (tender) {
    if (!tender) return;
    var id = tender.payment_id || tender.id;
    if (id) ids.push(String(id));
  });
  return ids;
}

function squareToRow(invoice, checkedAt, receiptUrl) {
  var status = String(invoice && invoice.status || "").toUpperCase();
  var takeReceipt = status === "PAID" || status === "PARTIALLY_PAID";
  return {
    number: String(invoice && invoice.invoice_number || "").replace(/^#/, ""),
    status: status,
    paid: status === "PAID",
    payUrl: payUrlOf(invoice),
    receiptUrl: takeReceipt ? String(receiptUrl || "") : "",
    checkedAt: checkedAt,
    squareInvoiceId: String(invoice && invoice.id || "")
  };
}

async function readCached(env, rideId) {
  if (!env || !env.INVOICE_KV || typeof env.INVOICE_KV.get !== "function") return null;
  try {
    var raw = await env.INVOICE_KV.get("driver-invoice-live:" + rideId, "json");
    return raw && typeof raw === "object" ? raw : null;
  } catch (e) { return null; }
}

async function writeCached(env, rideId, row) {
  if (!env || !env.INVOICE_KV || typeof env.INVOICE_KV.put !== "function") return;
  try { await env.INVOICE_KV.put("driver-invoice-live:" + rideId, JSON.stringify(row), { expirationTtl: 120 }); } catch (e) {}
}

async function squareGet(env, path, fetchImpl) {
  var token = env && env.SQUARE_ACCESS_TOKEN;
  if (!token) { var err = new Error("SQUARE_ACCESS_TOKEN is not set"); err.code = "no-secret"; throw err; }
  var go = fetchImpl || fetch;
  var res = await go("https://connect.squareup.com" + path, {
    method: "GET",
    headers: { Authorization: "Bearer " + token, "Square-Version": SQUARE_VERSION, Accept: "application/json" }
  });
  var body = await res.json().catch(function () { return {}; });
  if (!res.ok || !body) {
    var fail = new Error("Square GET failed");
    fail.status = res.status;
    throw fail;
  }
  return body;
}

async function receiptUrlFor(env, invoice, fetchImpl) {
  var status = String(invoice && invoice.status || "").toUpperCase();
  if (status !== "PAID" && status !== "PARTIALLY_PAID") return "";
  if (!invoice.order_id) return "";
  var orderBody = await squareGet(env, "/v2/orders/" + encodeURIComponent(invoice.order_id), fetchImpl);
  var ids = paymentIdsOf(orderBody && orderBody.order);
  var url = "";
  for (var i = 0; i < ids.length; i += 1) {
    var payBody = await squareGet(env, "/v2/payments/" + encodeURIComponent(ids[i]), fetchImpl);
    var payment = payBody && payBody.payment;
    if (payment && payment.receipt_url) url = String(payment.receipt_url);
  }
  return url;
}

async function invoiceIdFor(env, rideId, lookup) {
  if (typeof lookup === "function") {
    var id = await lookup(rideId);
    if (id) return String(id);
  }
  if (!env || !env.INVOICE_KV || typeof env.INVOICE_KV.get !== "function") return "";
  var rec = await env.INVOICE_KV.get("ride-invoice:" + rideId, "json");
  return rec && (rec.squareInvoiceId || rec.id) ? String(rec.squareInvoiceId || rec.id) : "";
}

async function liveDriverInvoice(env, body, lookup, fetchImpl) {
  var ids = ((body && body.rideIds) || []).map(String).filter(Boolean).slice(0, 30);
  var invoices = {};
  var now = Date.now();
  for (var i = 0; i < ids.length; i += 1) {
    var rideId = ids[i];
    var cached = await readCached(env, rideId);
    if (cached && cached.checkedAt && now - Number(cached.checkedAt) < CACHE_MS && cached.status) {
      invoices[rideId] = cached;
      continue;
    }
    var squareId = await invoiceIdFor(env, rideId, lookup);
    if (!squareId) { invoices[rideId] = null; continue; }
    var invoiceBody = await squareGet(env, "/v2/invoices/" + encodeURIComponent(squareId), fetchImpl);
    var live = invoiceBody && invoiceBody.invoice;
    if (!live) { var missing = new Error("Square invoice GET failed"); missing.status = 502; throw missing; }
    var receiptUrl = await receiptUrlFor(env, live, fetchImpl);
    var row = squareToRow(live, now, receiptUrl);
    if (!row.squareInvoiceId) row.squareInvoiceId = squareId;
    await writeCached(env, rideId, row);
    invoices[rideId] = row;
  }
  return { ok: true, invoices: invoices };
}

if (typeof module !== "undefined") module.exports = { liveDriverInvoice: liveDriverInvoice, squareToRow: squareToRow, paymentIdsOf: paymentIdsOf, CACHE_MS: CACHE_MS };
