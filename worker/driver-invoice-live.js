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
 * Secret name only (no value is in this file):
 *   SQUARE_ACCESS_TOKEN
 *     Bearer token for connect.squareup.com. POST /sq/invoice already talks to
 *     Square, so reuse that route's existing token binding if its name differs.
 * Optional binding:
 *   INVOICE_KV
 *     ride-invoice:{rideId} -> { squareInvoiceId } when lookup is not passed.
 *     driver-invoice-live:{rideId} -> the 45s status cache this file writes.
 */
var SQUARE_VERSION = "2024-12-18";
var CACHE_MS = 45000;

function receiptUrlOf(invoice) {
  var url = "";
  var payments = invoice && Array.isArray(invoice.payments) ? invoice.payments : [];
  payments.forEach(function (p) {
    if (!p) return;
    var st = String(p.status || "").toUpperCase();
    if ((st === "COMPLETED" || st === "APPROVED" || !st) && p.receipt_url) url = String(p.receipt_url);
  });
  return url;
}

function squareToRow(invoice, checkedAt) {
  var status = String(invoice && invoice.status || "").toUpperCase();
  return {
    number: String(invoice && (invoice.invoice_number || invoice.invoiceNumber) || "").replace(/^#/, ""),
    status: status,
    paid: status === "PAID",
    payUrl: String(invoice && (invoice.public_url || invoice.publicUrl) || ""),
    receiptUrl: receiptUrlOf(invoice),
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

async function fetchSquareInvoice(env, invoiceId, fetchImpl) {
  var token = env && env.SQUARE_ACCESS_TOKEN;
  if (!token) { var err = new Error("SQUARE_ACCESS_TOKEN is not set"); err.code = "no-secret"; throw err; }
  var go = fetchImpl || fetch;
  var res = await go("https://connect.squareup.com/v2/invoices/" + encodeURIComponent(invoiceId), {
    method: "GET",
    headers: { Authorization: "Bearer " + token, "Square-Version": SQUARE_VERSION, Accept: "application/json" }
  });
  var body = await res.json().catch(function () { return {}; });
  if (!res.ok || !body || !body.invoice) {
    var fail = new Error("Square invoice GET failed");
    fail.status = res.status;
    throw fail;
  }
  return body.invoice;
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
    var live = await fetchSquareInvoice(env, squareId, fetchImpl);
    var row = squareToRow(live, now);
    if (!row.squareInvoiceId) row.squareInvoiceId = squareId;
    await writeCached(env, rideId, row);
    invoices[rideId] = row;
  }
  return { ok: true, invoices: invoices };
}

if (typeof module !== "undefined") module.exports = { liveDriverInvoice: liveDriverInvoice, squareToRow: squareToRow, CACHE_MS: CACHE_MS };
