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
      createElement: function () { return make("made"); },
      addEventListener: function () {},
      head: { appendChild: function () {} },
      body: {}
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
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: false, status: 0, text: function () { return Promise.resolve(""); }, json: function () { return Promise.resolve(null); } }); },
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
  return sandbox.__pcsFollow.clean;
}

test("tracker shows a stored card photo, an existing profile jpeg, and hides the rest", function () {
  const box = loadFollow();
  const card = box.live.photo({ cardKey: KEY, photo: JPEG });
  assert.equal(card, "https://pcs-pay.pcsrides.workers.dev/dcard/" + KEY + "-p.jpg");
  const shown = box.live.showPhoto(box.photo, { cardKey: KEY });
  assert.equal(shown, card);
  assert.equal(box.photo.hidden, false);
  assert.equal(box.photo.src, card);
  box.photo.onerror();
  assert.equal(box.photo.hidden, true);
  const again = box.live.showPhoto(box.photo, { photo: JPEG });
  assert.equal(again, JPEG);
  assert.equal(box.photo.hidden, false);
  assert.equal(box.photo.src, JPEG);
  box.live.showPhoto(box.photo, {});
  assert.equal(box.photo.hidden, true);
  assert.equal(box.photo.src, "");
  assert.equal(box.live.photo({ photo: "https://example.test/driver.jpg" }), "");
  assert.equal(box.live.photo({ photo: "data:image/jpeg;base64," + "A".repeat(120001) }), "");
  assert.equal(box.live.photo({ cardKey: "short", photo: JPEG }), JPEG);
});

test("tracking copy carries the profile jpeg without a text, and prefers a card key", function () {
  const clean = loadClean();
  const now = Date.now();
  const photoOnly = clean({ status: "on_way", driverName: "Pat Driver", photo: JPEG, cardKey: "" }, now);
  assert.equal(photoOnly.photo, JPEG);
  assert.equal(photoOnly.cardKey, undefined);
  assert.equal(photoOnly.bill, undefined);
  const card = clean({ status: "on_way", driverName: "Pat Driver", photo: JPEG, cardKey: KEY }, now);
  assert.equal(card.cardKey, KEY);
  assert.equal(card.photo, undefined);
  const bad = clean({ status: "on_way", photo: "https://example.test/a.jpg" }, now);
  assert.equal(bad.photo, undefined);
  const sms = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  assert.ok(sms.indexOf('qWorker("/sms/tracker"') >= 0);
  assert.equal(sms.indexOf("photo: safePhoto(acc.photo) || safePhoto(state.driverPhoto)"), sms.lastIndexOf("photo: safePhoto(acc.photo) || safePhoto(state.driverPhoto)"));
});
