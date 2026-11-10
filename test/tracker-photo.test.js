"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const KEY = "abcdefghij1234567890ABCD";
const JPEG = "data:image/jpeg;base64," + "Qk".repeat(20);

function loadFollow() {
  const nodes = {};
  function make(id) {
    const node = { id: id, hidden: true, textContent: "", innerHTML: "", src: "", style: {}, className: "", children: [],
      appendChild: function (c) { this.children.push(c); }, setAttribute: function () {}, addEventListener: function () {},
      querySelector: function () { return null; }, parentNode: { removeChild: function () {} } };
    nodes[id] = node;
    return node;
  }
  ["app", "fl-live", "fl-photo", "fl-status", "fl-bill", "fl-who", "fl-car", "fl-eta", "fl-from", "fl-to", "fl-upd", "fl-net", "fl-stops", "fl-big", "fl-map"].forEach(make);
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object,
    Array: Array, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: {
      visibilityState: "visible",
      getElementById: function (id) { return nodes[id] || null; },
      querySelector: function () { return null; },
      createElement: function () { return make("made"); },
      addEventListener: function () {},
      head: { appendChild: function () {} },
      body: { appendChild: function () {} }
    },
    location: { search: "?t=" + "a".repeat(32) },
    fetch: function () { return new Promise(function () {}); },
    navigator: {},
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8"), sandbox, { filename: "follow-live.js" });
  return { live: sandbox.__pcsFollowLive, photo: nodes["fl-photo"] };
}

function loadClean() {
  const store = {};
  const pending = [];
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: {
      getItem: function (k) { return store[k] == null ? null : store[k]; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function (url) {
      const u = String(url || "");
      if (u.indexOf("DRVRPRFL") >= 0) {
        return new Promise(function (resolve) { pending.push({ url: u, resolve: resolve }); });
      }
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve("null"); }, json: function () { return Promise.resolve(null); } });
    },
    PCS_SYNC: { databaseURL: "https://example.test" },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; },
      body: { getAttribute: function () { return "driver"; }, style: {} }, head: { appendChild: function () {} }, documentElement: {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app.js" });
  return { clean: sandbox.__pcsFollow.clean, photoPick: sandbox.__pcsFollow.photoPick, follow: sandbox.__pcsFollow, store: store, pending: pending };
}

test("a valid card image stays ahead of the profile jpeg", function () {
  const box = loadFollow();
  const card = "https://pcs-pay.pcsrides.workers.dev/dcard/" + KEY + "-p.jpg";
  assert.equal(box.live.photo({ cardKey: KEY, photo: JPEG }), card);
  assert.equal(box.live.showPhoto(box.photo, { cardKey: KEY, photo: JPEG }), card);
  assert.equal(box.photo.hidden, false);
  assert.equal(box.photo.src, card);
});

test("a failed card image falls back to the same driver's jpeg", function () {
  const box = loadFollow();
  const card = "https://pcs-pay.pcsrides.workers.dev/dcard/" + KEY + "-p.jpg";
  box.live.showPhoto(box.photo, { cardKey: KEY, photo: JPEG });
  box.photo.onerror();
  assert.equal(box.photo.hidden, false);
  assert.equal(box.photo.src, JPEG);
  assert.notEqual(box.photo.src, card);
});

test("a failed image with no valid jpeg stays hidden", function () {
  const box = loadFollow();
  box.live.showPhoto(box.photo, { cardKey: KEY, photo: "https://example.test/driver.jpg" });
  box.photo.onerror();
  assert.equal(box.photo.hidden, true);
  const jpegOnly = loadFollow();
  jpegOnly.live.showPhoto(jpegOnly.photo, { photo: JPEG });
  jpegOnly.photo.onerror();
  assert.equal(jpegOnly.photo.hidden, true);
  assert.equal(jpegOnly.live.photo({ photo: "data:image/jpeg;base64," + "A".repeat(120001) }), "");
  assert.equal(jpegOnly.live.photo({}), "");
});

test("a changed card key or jpeg is shown on the next refresh", function () {
  const box = loadFollow();
  const card = "https://pcs-pay.pcsrides.workers.dev/dcard/" + KEY + "-p.jpg";
  const nextKey = "zzzzzzzzzz1234567890WXYZ";
  const nextJpeg = "data:image/jpeg;base64," + "Zm".repeat(20);
  box.live.showPhoto(box.photo, { cardKey: KEY, photo: JPEG });
  box.photo.onerror();
  assert.equal(box.photo.src, JPEG);
  assert.equal(box.live.showPhoto(box.photo, { cardKey: nextKey, photo: JPEG }), "https://pcs-pay.pcsrides.workers.dev/dcard/" + nextKey + "-p.jpg");
  assert.equal(box.photo.src, "https://pcs-pay.pcsrides.workers.dev/dcard/" + nextKey + "-p.jpg");
  assert.notEqual(box.photo.src, card);
  box.photo.onerror();
  assert.equal(box.live.showPhoto(box.photo, { cardKey: nextKey, photo: nextJpeg }), nextJpeg);
  assert.equal(box.photo.src, nextJpeg);
  assert.equal(box.photo.hidden, false);
});

function sign(app, email, photo) {
  app.store["pcs-driver-session"] = email;
  app.store["pcs-driver-account"] = JSON.stringify({ email: email, name: email.split("@")[0], photo: photo || "" });
}
function rideFor(email) {
  const id = email.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return [{ id: "ride1", assignedDriverId: id, status: "open", pickup: "A", dropoff: "B" }];
}
function published(app, email) {
  const rows = app.follow.publish(rideFor(email));
  assert.equal(rows.length, 1);
  return rows[0];
}

test("tracking copy keeps the profile jpeg beside a card key and ignores another driver", function () {
  const app = loadClean();
  const now = Date.now();
  const photoOnly = app.clean({ status: "on_way", driverName: "Pat Driver", photo: JPEG, cardKey: "" }, now);
  assert.equal(photoOnly.photo, JPEG);
  assert.equal(photoOnly.cardKey, undefined);
  const both = app.clean({ status: "on_way", driverName: "Pat Driver", photo: JPEG, cardKey: KEY }, now);
  assert.equal(both.cardKey, KEY);
  assert.equal(both.photo, JPEG);
  const bad = app.clean({ status: "on_way", photo: "https://example.test/a.jpg", cardKey: KEY }, now);
  assert.equal(bad.cardKey, KEY);
  assert.equal(bad.photo, undefined);
  assert.equal(app.photoPick(JPEG, { email: "other@example.test", photo: JPEG }, "self@example.test"), JPEG);
  assert.equal(app.photoPick("", { email: "other@example.test", photo: JPEG }, "self@example.test"), "");
  assert.equal(app.photoPick("", { email: "self@example.test", photo: JPEG }, "self@example.test"), JPEG);
  assert.equal(app.photoPick("", { email: "self@example.test", photo: "https://example.test/a.jpg" }, "self@example.test"), "");
  const other = "data:image/jpeg;base64," + "Zm".repeat(20);
  assert.notEqual(app.follow.sig({ photo: JPEG }), app.follow.sig({ photo: other }));
  assert.equal(JPEG.length, other.length);
});

function reply(row) {
  return { ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(row)); } };
}
async function flush() { for (var i = 0; i < 8; i += 1) await Promise.resolve(); }

test("publishing after an account switch does not keep the previous driver's jpeg", async function () {
  const primed = loadClean();
  const ada = "ada@example.test";
  const beau = "beau@example.test";
  const beauJpeg = "data:image/jpeg;base64," + "Qm".repeat(24);
  sign(primed, ada, JPEG);
  primed.follow.holdPhoto(JPEG);
  assert.equal(published(primed, ada).photo, JPEG);
  sign(primed, beau, "");
  primed.follow.holdPhoto(JPEG);
  assert.equal(published(primed, beau).photo, undefined);
  const app = loadClean();
  sign(app, ada, "");
  app.follow.holdPhoto(JPEG);
  assert.equal(published(app, ada).photo, undefined);
  const adaReq = app.pending.filter(function (p) { return p.url.indexOf("ada_example_test") >= 0; });
  assert.equal(adaReq.length, 1);
  sign(app, beau, "");
  app.follow.holdPhoto(JPEG);
  assert.equal(published(app, beau).photo, undefined);
  const beauReq = app.pending.filter(function (p) { return p.url.indexOf("beau_example_test") >= 0; });
  assert.equal(beauReq.length, 1);
  adaReq[0].resolve(reply({ email: ada, photo: JPEG }));
  await flush();
  assert.equal(published(app, beau).photo, undefined);
  beauReq[0].resolve(reply({ email: beau, photo: "" }));
  await flush();
  assert.equal(published(app, beau).photo, undefined);
  sign(app, beau, beauJpeg);
  app.follow.holdPhoto(JPEG);
  const own = published(app, beau);
  assert.equal(own.photo, beauJpeg);
  assert.notEqual(own.photo, JPEG);
});
