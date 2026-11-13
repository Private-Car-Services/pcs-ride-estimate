"use strict";
/* The customer tracking text is the tracker URL alone, so iMessage/RCS can show the link card. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const TOKEN = "abcdefghij1234567890ABCDEFGHIJ12";
const RIDE = "c_rideMatthew";
const LINK = "https://private-car-services.github.io/pcs-ride-estimate/follow/?t=" + TOKEN;

function assertUrlOnly(body, url) {
  assert.equal(body, url);
  assert.equal(body.indexOf("Follow"), -1);
  assert.equal(body.indexOf("on the way"), -1);
  assert.equal(body.indexOf("PCSrides"), -1);
  assert.equal(body.indexOf(" - "), -1);
  assert.equal(/\s/.test(body), false);
}

function loadApp() {
  const store = {
    "pcs-driver-qtoken-driver": "t." + (Date.now() + 3600000) + ".sig"
  };
  const posts = [];
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise, URL: URL,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    btoa: function (s) { return Buffer.from(s, "binary").toString("base64"); },
    atob: function (s) { return Buffer.from(s, "base64").toString("binary"); },
    crypto: { getRandomValues: function (buf) { for (let i = 0; i < buf.length; i++) buf[i] = i + 1; return buf; }, subtle: { digest: function () { return Promise.resolve(new Uint8Array(32).buffer); } } },
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "private-car-services.github.io", href: "https://private-car-services.github.io/pcs-ride-estimate/app/driver/", protocol: "https:", hash: "", pathname: "/pcs-ride-estimate/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: {
      getItem: function (k) { return store[k] == null ? null : store[k]; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function (url, opts) {
      const u = String(url || "");
      let body = {};
      try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) { body = {}; }
      if (u.indexOf("/sms/tracker") >= 0 || u.indexOf("/notify/onway") >= 0) posts.push({ url: u, body: body });
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve(u.indexOf("/sms/tracker") >= 0 ? { ok: true, sent: true } : null); },
        text: function () { return Promise.resolve("null"); }
      });
    },
    PCS_SYNC: { databaseURL: "https://example.test" },
    document: {
      readyState: "complete", currentScript: { src: "https://private-car-services.github.io/pcs-ride-estimate/app/app.js?v=2.0m-ax" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; },
      body: { getAttribute: function () { return "driver"; }, style: {}, appendChild: function () {} },
      head: { appendChild: function () {} }, documentElement: {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app.js" });
  return { follow: sandbox.__pcsFollow, posts: posts };
}

function loadGod() {
  const el = function () { return { style: {}, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {} }; };
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Number: Number, String: String, Object: Object, Array: Array,
    Promise: Promise, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, Symbol: Symbol, URL: URL,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: {
      currentScript: null, readyState: "complete",
      createElement: el, getElementById: function () { return null; }, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, addEventListener: function () {},
      head: { appendChild: function () {} }, body: { appendChild: function () {} }, documentElement: { appendChild: function () {} }
    },
    location: { search: "", hostname: "private-car-services.github.io", href: "https://private-car-services.github.io/pcs-ride-estimate/god/" },
    navigator: { userAgent: "test" }, localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.reject(new Error("no")); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/god.js"), "utf8"), sandbox, { filename: "god.js" });
  return sandbox.__pcsGodFollow;
}

function loadMeter() {
  const app = { innerHTML: "" };
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Number: Number, String: String, Object: Object, Array: Array,
    Promise: Promise, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, URL: URL,
    encodeURIComponent: encodeURIComponent, setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    document: {
      title: "", readyState: "complete", visibilityState: "visible",
      getElementById: function (id) { return id === "app" ? app : null; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      createElement: function () { return { style: {}, setAttribute: function () {} }; },
      addEventListener: function () {}, body: { appendChild: function () {} }
    },
    location: { search: "", href: "https://private-car-services.github.io/pcs-ride-estimate/meter/", hostname: "private-car-services.github.io" },
    navigator: {}, sessionStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return new Promise(function () {}); },
    addEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../meter/meter.js"), "utf8"), sandbox, { filename: "meter.js" });
  return sandbox.__pcsMeterShare;
}

test("driver, rider, and God tracking texts are the tracker URL only", function () {
  const app = loadApp();
  const link = app.follow.link(TOKEN);
  assert.equal(link, LINK);
  assertUrlOnly(app.follow.msg(link, "Matthew"), link);
  assertUrlOnly(app.follow.riderMsg(link), link);
  assert.equal(app.follow.sms("9362617878", app.follow.riderMsg(link)), "sms:+19362617878?&body=" + encodeURIComponent(link));

  const god = loadGod();
  const ride = { id: "ride1", assignedDriverId: "matthew", assignedDriverName: "Matthew Ragge", riderPhone: "9362617878", status: "assigned" };
  const godUrl = god.msg(ride, TOKEN);
  assertUrlOnly(godUrl, "https://private-car-services.github.io/pcs-ride-estimate/follow/?t=" + TOKEN);
  god.state.map.ride1 = { t: TOKEN };
  const html = god.html(ride);
  assert.ok(html.indexOf("Open Messages") >= 0);
  assert.ok(html.indexOf(": tracking link</a>") >= 0);
  const encoded = html.match(/body=([^"']+)/);
  assert.ok(encoded, html);
  assertUrlOnly(decodeURIComponent(encoded[1]), godUrl);
  const label = god.html({ id: "ride2", assignedDriverId: "matthew", status: "assigned" });
  assert.ok(label.indexOf("Text my client a tracking link") >= 0);

  const meter = loadMeter();
  assertUrlOnly(meter.text(LINK), LINK);
});

test("Text my client posts /sms/tracker with the URL as the body", async function () {
  const app = loadApp();
  const res = await app.follow.bizSend(RIDE, TOKEN);
  assert.equal(res && res.sent, true);
  assert.equal(app.posts.length, 1);
  assert.ok(app.posts[0].url.indexOf("/sms/tracker") >= 0);
  assert.equal(app.posts[0].body.rideId, "rideMatthew");
  assertUrlOnly(app.posts[0].body.body, app.follow.link(TOKEN));
});

test("tracking message sources no longer add a sentence or a site suffix", function () {
  const app = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  const god = fs.readFileSync(path.join(__dirname, "../god/god.js"), "utf8");
  const meter = fs.readFileSync(path.join(__dirname, "../meter/meter.js"), "utf8");
  ["Follow along live:", "Follow my PCS ride live:", " - www.PCSrides.com"].forEach(function (s) {
    assert.equal(app.indexOf(s), -1, s);
    assert.equal(god.indexOf(s), -1, s);
  });
  assert.equal(meter.indexOf("Follow my Private Car Services ride live:"), -1);
  assert.ok(app.indexOf('"/sms/tracker", { token: tk, rideId: id, body: folDriverMsg(link) }') >= 0);
  assert.ok(app.indexOf('"/notify/onway", { token: tk, rideId: schedId, link: link, body: folDriverMsg(link) }') >= 0);
  assert.ok(app.indexOf("Text my client a tracking link") >= 0);
  assert.ok(god.indexOf("Text my client a tracking link") >= 0);
  assert.ok(meter.indexOf('meter.js?v=') === -1);
  const meterHtml = fs.readFileSync(path.join(__dirname, "../meter/index.html"), "utf8");
  assert.ok(meterHtml.indexOf("meter.js?v=2.0m-ax") >= 0);
  assert.ok(meterHtml.indexOf("version.js?v=2.0m-bq") >= 0);
});
