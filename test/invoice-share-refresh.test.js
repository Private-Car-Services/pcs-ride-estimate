/* Driver refresh during a ride, then the existing follow share. The Worker is a test double.
   A live Worker is not deployed. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const PAY = "https://app.squareup.com/pay-invoice/invtmp:example-unpaid";
const RECEIPT = "https://squareup.com/receipt/preview/EXAMPLE";

function el() {
  return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {} };
}
function loadApp() {
  const store = {};
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.reject(new Error("no live worker")); },
    PCS_SYNC: { databaseURL: "https://example.test" },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: el,
      body: { getAttribute: function (n) { return n === "data-app" ? "driver" : ""; }, style: {}, appendChild: function () {} },
      head: el(), documentElement: el()
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
    return nodes[id] || (nodes[id] = { id: id, hidden: true, textContent: "", innerHTML: "", src: "", style: {},
      setAttribute: function () {}, addEventListener: function () {}, querySelector: function () { return null; } });
  }
  ["app", "fl-live", "fl-photo", "fl-status", "fl-bill", "fl-who", "fl-car", "fl-eta", "fl-from", "fl-to", "fl-upd", "fl-net", "fl-stops", "fl-big", "fl-map"].forEach(make);
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object,
    Array: Array, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: { visibilityState: "visible", getElementById: function (id) { return nodes[id] || null; }, createElement: function () { return make("made"); }, addEventListener: function () {}, head: { appendChild: function () {} }, body: {} },
    location: { search: "?t=" + "c".repeat(32) },
    fetch: function () { return new Promise(function () {}); },
    navigator: {}, addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8"), sandbox, { filename: "follow-live.js" });
  return sandbox.__pcsFollowLive;
}

function row(status) {
  var square = status === "PAID"
    ? { invoiceNumber: "000100", status: "PAID", public_url: PAY, payments: [{ status: "COMPLETED", refundedCents: 0, receipt_url: RECEIPT }] }
    : { invoiceNumber: "000100", status: "UNPAID", public_url: PAY, payments: [] };
  return { invoiceNo: "000100", amountCents: 7913, taxCents: 0, paid: status !== "PAID", at: 10, square: square };
}
function ride(id, extra) {
  return Object.assign({ id: id, assignedDriverId: "driver", status: "assigned", rider: "Rahual", riderPhone: "555-0100", receiptUrl: "https://evil.example/receipt", invoicePayUrl: "https://evil.example/pay", prepaidInvoiceNo: "000999", sqInvoice: { paid: true, status: "PAID" } }, extra || {});
}

const follow = loadApp();
const live = loadFollow();

test("an in-ride payment changes the authorized share from pay to receipt", async function () {
  const calls = [];
  const mine = ride("ride-a");
  let phase = "UNPAID";
  follow.publish([mine]);
  const before = follow.publish([mine])[0];
  assert.equal(before.pay, undefined);
  assert.equal(before.payUrl, undefined);
  assert.equal(before.receiptUrl, undefined);
  assert.equal(before.riderPhone, undefined);
  async function read() {
    return follow.refresh({
      rideId: "ride-a", token: "driver-token", driverId: "driver",
      post: function (path, body) {
        calls.push({ path: path, body: body });
        return Promise.resolve({ ok: true, invoices: { "ride-a": row(phase), "ride-b": row("PAID") } });
      }
    });
  }
  await read();
  assert.equal(calls[0].path, "/driver/invoice");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["rideIds", "token"]);
  assert.deepEqual(calls[0].body.rideIds, ["ride-a"]);
  let pub = follow.publish([mine])[0];
  assert.equal(pub.invoiceNo, "000100");
  assert.equal(pub.pay, "unpaid");
  assert.equal(pub.payUrl, PAY);
  assert.equal(pub.receiptUrl, undefined);
  assert.equal(pub.riderPhone, undefined);
  assert.equal(live.bill(pub).link.text, "Pay invoice");
  phase = "PAID";
  await read();
  pub = follow.publish([mine])[0];
  assert.equal(pub.pay, "paid");
  assert.equal(pub.receiptUrl, RECEIPT);
  assert.equal(pub.payUrl, undefined);
  assert.equal(live.bill(pub).link.text, "View receipt");
  assert.equal(live.bill(pub).link.href, RECEIPT);
  assert.equal(calls.length, 2);
});

test("a failed or stale read clears the link instead of keeping it", async function () {
  const mine = ride("ride-a");
  await follow.refresh({
    rideId: "ride-a", token: "driver-token", driverId: "driver",
    post: function () { return Promise.resolve({ ok: true, invoices: { "ride-a": row("PAID") } }); }
  });
  assert.equal(follow.publish([mine])[0].receiptUrl, RECEIPT);
  await follow.refresh({
    rideId: "ride-a", token: "driver-token", driverId: "driver",
    post: function () { return Promise.reject(new Error("square down")); }
  });
  const cleared = follow.publish([mine])[0];
  assert.equal(cleared.pay, undefined);
  assert.equal(cleared.receiptUrl, undefined);
  assert.equal(cleared.payUrl, undefined);
  assert.equal(follow.share({ paid: true, invoiceNo: "000100", receiptUrl: RECEIPT, fetchedAt: Date.now(), square: { invoiceNumber: "000100", status: "PAID", payments: [{ receipt_url: RECEIPT, status: "COMPLETED", refundedCents: 0 }] } }).pay, "paid");
  assert.equal(follow.share({ paid: true, fetchedAt: Date.now() - 60000, square: { invoiceNumber: "000100", status: "PAID", payments: [{ receipt_url: RECEIPT, status: "COMPLETED", refundedCents: 0 }] } }).pay, "");
});

test("another driver, another ride, a ride change, and a canceled ride do not leak", async function () {
  const posts = [];
  await follow.refresh({
    rideId: "ride-a", token: "driver-token", driverId: "driver",
    post: function (path, body) {
      posts.push(body.rideIds.slice());
      return Promise.resolve({ ok: true, invoices: { "ride-a": row("UNPAID") } });
    }
  });
  const other = ride("ride-b", { assignedDriverId: "someone_else" });
  follow.publish([other]);
  const asked = await follow.refresh({ rideId: "ride-b", token: "driver-token", driverId: "driver", post: function () { posts.push(["should-not"]); return Promise.resolve({ ok: true, invoices: {} }); } });
  assert.equal(asked, null);
  assert.equal(posts.some(function (ids) { return ids[0] === "should-not"; }), false);
  const replacement = ride("ride-c");
  const canceled = ride("ride-old", { status: "canceled", receiptUrl: RECEIPT });
  follow.publish([canceled, replacement, other]);
  await follow.refresh({
    rideId: "ride-c", token: "driver-token", driverId: "driver",
    post: function (path, body) {
      posts.push(body.rideIds.slice());
      return Promise.resolve({ ok: true, invoices: { "ride-old": row("PAID"), "ride-c": { invoiceNo: "000300", amountCents: 100, taxCents: 0, paid: false, at: 4, square: { invoiceNumber: "000300", status: "UNPAID", public_url: PAY, payments: [] } } } });
    }
  });
  const pubs = follow.publish([canceled, replacement, other]);
  const oldPub = pubs.filter(function (p) { return p.invoiceNo === "000100" || (p.receiptUrl === RECEIPT); });
  const next = pubs.filter(function (p) { return p.invoiceNo === "000300"; });
  assert.equal(oldPub.length, 0);
  assert.equal(next.length, 1);
  assert.equal(next[0].payUrl, PAY);
  assert.equal(JSON.stringify(pubs).indexOf("555-0100"), -1);
  assert.equal(JSON.stringify(pubs).indexOf("evil.example"), -1);
  assert.equal(posts[posts.length - 1][0], "ride-c");
});

test("a response that omits the ride drops the receipt it had", async function () {
  const mine = ride("ride-omit");
  follow.publish([mine]);
  await follow.refresh({
    rideId: "ride-omit", token: "driver-token", driverId: "driver",
    post: function () { return Promise.resolve({ ok: true, invoices: { "ride-omit": row("PAID") } }); }
  });
  assert.equal(follow.publish([mine])[0].receiptUrl, RECEIPT);
  await follow.refresh({
    rideId: "ride-omit", token: "driver-token", driverId: "driver",
    post: function () { return Promise.resolve({ ok: true, invoices: {} }); }
  });
  const pub = follow.publish([mine])[0];
  assert.equal(pub.receiptUrl, undefined);
  assert.equal(pub.payUrl, undefined);
  assert.equal(pub.pay, undefined);
});
