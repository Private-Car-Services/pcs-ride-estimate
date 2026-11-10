/* Comparison ride end must put the driver back on Available, even if they open Goal immediately.
   Matthew: Available -> start comparison -> end -> Goal page -> return. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const PHOTO = "data:image/jpeg;base64,QUFBQQ==";

function chicagoDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms || Date.now()));
}
function driverId(email) {
  return String(email || "").toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

function seedStore(store, email) {
  const id = driverId(email);
  const day = chicagoDay();
  const now = Date.now();
  store["pcs-driver-session"] = email;
  store["pcs-driver-account"] = JSON.stringify({
    name: "Matthew", phone: "9365550100", email: email,
    carYear: "2020", carMake: "Ford", carModel: "Edge", carPlate: "ABC1234", carSeats: "4", carPhoto: PHOTO
  });
  store["pcs-driver-miles-" + id] = JSON.stringify({
    [day]: { gpsMiles: 12.4, startOdometer: 10000, shiftStartAt: now - 3600000, startedAt: now - 3600000, lastUpdate: now, onlineMs: 0, shiftClosed: false }
  });
  store["pcs-driver-qtoken-" + id] = "t." + (now + 86400000);
}

function createDom(store, log, errors) {
  const registry = Object.create(null);
  const docListeners = Object.create(null);
  const winListeners = Object.create(null);
  let gpsCbs = [];

  function El(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this._id = "";
    this.className = "";
    this.attrs = Object.create(null);
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = Object.create(null);
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.type = "";
    this._html = "";
  }
  Object.defineProperty(El.prototype, "id", {
    get: function () { return this._id; },
    set: function (v) {
      if (this._id && registry[this._id] === this) delete registry[this._id];
      this._id = String(v || "");
      if (this._id) registry[this._id] = this;
    }
  });
  El.prototype.setAttribute = function (k, v) {
    this.attrs[k] = String(v);
    if (k === "id") this.id = v;
    if (k === "class") this.className = String(v);
    if (k === "disabled") this.disabled = true;
  };
  El.prototype.getAttribute = function (k) {
    if (k === "id") return this._id || null;
    if (k === "class") return this.className || null;
    return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
  };
  El.prototype.removeAttribute = function (k) { delete this.attrs[k]; if (k === "disabled") this.disabled = false; };
  El.prototype.addEventListener = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
  El.prototype.removeEventListener = function () {};
  El.prototype.appendChild = function (ch) { if (!ch) return ch; ch.parentNode = this; this.children.push(ch); return ch; };
  El.prototype.insertBefore = function (n, ref) {
    if (!n) return n;
    n.parentNode = this;
    var i = this.children.indexOf(ref);
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  };
  El.prototype.removeChild = function (ch) { this.children = this.children.filter(function (c) { return c !== ch; }); if (ch) ch.parentNode = null; return ch; };
  El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  El.prototype.contains = function (n) { var p = n; while (p) { if (p === this) return true; p = p.parentNode; } return false; };
  El.prototype.focus = function () {};
  El.prototype.blur = function () {};
  El.prototype.setSelectionRange = function () {};
  El.prototype.scrollIntoView = function () {};
  El.prototype.replaceChild = function (n, o) {
    if (!n) return o || null;
    var i = this.children.indexOf(o);
    if (i >= 0) this.children[i] = n; else this.children.push(n);
    n.parentNode = this;
    if (o && o !== n) o.parentNode = null;
    return o;
  };
  Object.defineProperty(El.prototype, "childNodes", { get: function () { return this.children; } });
  Object.defineProperty(El.prototype, "attributes", { get: function () {
    var self = this, names = Object.keys(this.attrs);
    if (this._id) names.push("id");
    if (this.className) names.push("class");
    return names.map(function (name) { return { name: name, value: name === "id" ? self._id : (name === "class" ? self.className : self.attrs[name]) }; });
  } });
  El.prototype.hasAttribute = function (k) { return this.getAttribute(k) != null; };
  function classList(el) {
    return {
      contains: function (c) { return (" " + el.className + " ").indexOf(" " + c + " ") >= 0; },
      add: function (c) { if (!this.contains(c)) el.className = (el.className + " " + c).trim(); },
      remove: function (c) { el.className = el.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(" "); },
      toggle: function (c, on) { if (on === false) this.remove(c); else if (on === true) this.add(c); else if (this.contains(c)) this.remove(c); else this.add(c); }
    };
  }
  Object.defineProperty(El.prototype, "classList", { get: function () { return classList(this); } });
  function matches(el, sel) {
    sel = String(sel || "").trim();
    if (!sel) return false;
    if (sel.indexOf(",") >= 0) return sel.split(",").some(function (s) { return matches(el, s); });
    if (sel.charAt(0) === "#") return el._id === sel.slice(1);
    if (sel.charAt(0) === ".") {
      var parts = sel.split(".").filter(Boolean);
      return parts.every(function (c) { return classList(el).contains(c); });
    }
    var bits = sel.split(".");
    if (bits[0] && el.tagName !== bits[0].toUpperCase()) return false;
    return bits.slice(1).every(function (c) { return classList(el).contains(c); });
  }
  El.prototype.closest = function (sel) { var n = this; while (n && n.closest) { if (matches(n, sel)) return n; n = n.parentNode; } return null; };
  function walk(el, out) { out.push(el); (el.children || []).forEach(function (c) { walk(c, out); }); }
  function allUnder(el) { var out = []; if (el) walk(el, out); return out; }
  El.prototype.querySelector = function (sel) { var found = allUnder(this).filter(function (n) { return n !== this && matches(n, sel); }); return found[0] || null; };
  El.prototype.querySelectorAll = function (sel) { return allUnder(this).filter(function (n) { return n !== this && matches(n, sel); }); };
  function indexAttrs(el, attrs) {
    var re = /([:@a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g, m;
    while ((m = re.exec(attrs))) {
      var key = m[1];
      if (key === "style") continue;
      var val = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : ""));
      if (key === "id") el.id = val;
      else if (key === "class") el.className = val;
      else if (key === "disabled") el.disabled = true;
      else el.attrs[key] = val;
    }
  }
  function parseInto(el, html) {
    (el.children || []).forEach(function (c) { if (c._id && registry[c._id] === c) delete registry[c._id]; });
    el.children = [];
    var re = /<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, m;
    while ((m = re.exec(html))) {
      if (m[1].toLowerCase() === "br" || m[1].toLowerCase() === "img") continue;
      var child = new El(m[1]);
      indexAttrs(child, m[2] || "");
      child.parentNode = el;
      el.children.push(child);
    }
  }
  Object.defineProperty(El.prototype, "innerHTML", {
    get: function () { return this._html; },
    set: function (html) { this._html = String(html || ""); parseInto(this, this._html); }
  });
  Object.defineProperty(El.prototype, "outerHTML", {
    get: function () { return this._html; },
    set: function (html) { if (this.parentNode) this.parentNode.innerHTML = html; }
  });
  El.prototype.click = function () {
    var ev = { type: "click", target: this, currentTarget: this, preventDefault: function () {}, stopPropagation: function () { ev._stop = true; } };
    var n = this;
    while (n) {
      var ls = (n.listeners && n.listeners.click) || [];
      for (var i = 0; i < ls.length; i++) ls[i](ev);
      if (ev._stop) break;
      n = n.parentNode;
    }
  };
  El.prototype.dispatch = function (type) {
    var ev = { type: type, target: this, preventDefault: function () {}, stopPropagation: function () {} };
    var n = this;
    while (n) {
      var ls = (n.listeners && n.listeners[type]) || [];
      for (var i = 0; i < ls.length; i++) ls[i](ev);
      n = n.parentNode;
    }
  };

  const document = new El("document");
  document.readyState = "loading";
  document.visibilityState = "visible";
  document.nodeType = 9;
  const html = new El("html");
  const head = new El("head");
  const body = new El("body");
  const app = new El("div");
  app.id = "app";
  body.setAttribute("data-app", "driver");
  body.appendChild(app);
  html.appendChild(head);
  html.appendChild(body);
  body.parentNode = html;
  html.parentNode = document;
  document.body = body;
  document.head = head;
  document.documentElement = html;
  document.scrollingElement = html;
  document.activeElement = null;
  document.currentScript = { src: "https://pcs.example/app/app.js?v=1" };
  document.addEventListener = function (type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); document.listeners[type] = docListeners[type]; };
  document.removeEventListener = function () {};
  document.getElementById = function (id) { return registry[id] || null; };
  document.createElement = function (tag) { return new El(tag); };
  document.querySelector = function (sel) { return html.querySelector(sel); };
  document.querySelectorAll = function (sel) { return html.querySelectorAll(sel); };
  document.createTextNode = function (t) { var n = new El("#text"); n.textContent = t; return n; };
  document.execCommand = function () { return false; };

  const storageApi = function (bag) {
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(bag, k) ? String(bag[k]) : null; },
      setItem: function (k, v) { bag[k] = String(v); },
      removeItem: function (k) { delete bag[k]; },
      key: function (i) { return Object.keys(bag)[i] || null; },
      get length() { return Object.keys(bag).length; }
    };
  };

  function fetchImpl(url, opts) {
    opts = opts || {};
    const rec = { url: String(url), method: String(opts.method || "GET"), body: opts.body || "", keepalive: !!opts.keepalive, done: false, aborted: false };
    log.push(rec);
    return new Promise(function (resolve) {
      rec.finish = function () {
        if (rec.done || rec.aborted) return;
        rec.done = true;
        resolve({
          ok: true, status: 200,
          text: function () { return Promise.resolve("{}"); },
          json: function () { return Promise.resolve({ ok: true, token: "t." + (Date.now() + 86400000) }); }
        });
      };
      if (rec.keepalive || !/\/driver\/status/.test(rec.url)) queueMicrotask(function () { rec.finish(); });
    });
  }

  const navigator = {
    userAgent: "test", language: "en-US", maxTouchPoints: 0, onLine: true,
    geolocation: {
      getCurrentPosition: function (ok) { gpsCbs.push(ok); },
      watchPosition: function (ok) { gpsCbs.push(ok); return 1; },
      clearWatch: function () {}
    },
    sendBeacon: function (url, body) { log.push({ url: String(url), method: "BEACON", body: String(body || ""), keepalive: true, done: true, aborted: false, beacon: true }); return true; }
  };

  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, RegExp: RegExp, Error: Error,
    isFinite: isFinite, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    queueMicrotask: queueMicrotask, URL: URL, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    crypto: global.crypto, atob: atob, btoa: btoa, performance: { now: function () { return Date.now(); } },
    navigator: navigator, location: { search: "", hostname: "pcsrides.com", href: "https://pcsrides.com/app/driver/", protocol: "https:", hash: "", pathname: "/app/driver/", replace: function () {}, origin: "https://pcsrides.com" },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: storageApi(store), sessionStorage: storageApi(Object.create(null)),
    fetch: fetchImpl, document: document,
    addEventListener: function (type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
    removeEventListener: function () {},
    scrollTo: function () {}, getComputedStyle: function () { return { getPropertyValue: function () { return ""; } }; },
    matchMedia: function () { return { matches: false, addListener: function () {}, addEventListener: function () {} }; },
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    Image: function () {}, Audio: function () { this.play = function () { return Promise.resolve(); }; this.pause = function () {}; this.load = function () {}; },
    HTMLElement: function () {}, CustomEvent: function (type) { this.type = type; },
    alert: function () {}, confirm: function () { return false; },
    Map: Map, Set: Set, WeakMap: WeakMap, Symbol: Symbol, Proxy: Proxy, Reflect: Reflect
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  document.defaultView = sandbox;

  function fireWin(type) {
    (winListeners[type] || []).forEach(function (fn) {
      try { fn({ type: type, target: sandbox, persisted: false }); } catch (e) { errors.push(type + ": " + (e && e.stack || e)); }
    });
  }
  function fireDoc(type) {
    (docListeners[type] || []).forEach(function (fn) {
      try { fn({ type: type, target: document }); } catch (e) { errors.push(type + ": " + (e && e.stack || e)); }
    });
  }
  function fixGps() {
    const pos = { coords: { latitude: 29.7604, longitude: -95.3698, accuracy: 8, speed: 0, heading: 0 } };
    const cbs = gpsCbs.slice();
    gpsCbs = [];
    cbs.forEach(function (fn) { try { fn(pos); } catch (e) { errors.push("gps: " + (e && e.stack || e)); } });
  }
  function clickId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("missing #" + id + " html=" + String(app._html).slice(0, 240));
    el.click();
  }
  function boot() {
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, "app/driverlog.js"), "utf8"), sandbox, { filename: "app/driverlog.js" });
    vm.runInContext(fs.readFileSync(path.join(root, "app/app.js"), "utf8"), sandbox, { filename: "app/app.js" });
    fireDoc("DOMContentLoaded");
  }
  function gotoGoal() {
    document.visibilityState = "hidden";
    fireDoc("visibilitychange");
    log.forEach(function (rec) { if (!rec.done && !rec.keepalive) rec.aborted = true; });
    fireWin("pagehide");
  }

  return { sandbox: sandbox, document: document, app: app, boot: boot, fireDoc: fireDoc, gotoGoal: gotoGoal, fixGps: fixGps, clickId: clickId, registry: registry };
}

function statusPosts(log) {
  return log.filter(function (r) { return /\/driver\/status/.test(r.url); }).map(function (r) {
    var body = {};
    try { body = JSON.parse(r.body || "{}"); } catch (e) { body = {}; }
    return { onRide: body.onRide, onBreak: body.onBreak, source: body.source, keepalive: !!r.keepalive, beacon: !!r.beacon, aborted: !!r.aborted, done: !!r.done };
  });
}
function readJson(store, key) {
  try { return JSON.parse(store[key] || "null"); } catch (e) { return null; }
}
function snapshot(label, store, sandbox, log) {
  const email = store["pcs-driver-session"] || "";
  const id = driverId(email);
  const day = chicagoDay();
  const q = sandbox.__pcsQueue || {};
  const st = sandbox.__pcsApp && sandbox.__pcsApp.payState ? sandbox.__pcsApp.payState() : {};
  const M = st.meter || null;
  const segs = (readJson(store, "pcs-ride-segs-" + id) || {})[day] || [];
  const trk = (readJson(store, "pcs-trk-" + id) || {})[day] || [];
  const avail = sandbox.document.getElementById("q-set-available");
  const onride = sandbox.document.getElementById("q-set-onride");
  const posts = statusPosts(log);
  const lastPost = null;
  var survived = posts.filter(function (p) { return !p.aborted; });
  return {
    step: label,
    manual: !!(q.manualBusy && q.manualBusy()),
    auto: !!(q.autoBusy && q.autoBusy()),
    onBreak: !!(q.onBreak && q.onBreak()),
    offline: !!(q.offline && q.offline()),
    busyFlag: store["pcs-driver-onride-" + id] || "",
    meter: M ? (M.meterKind || "meter") + ":" + M.status : "",
    sliderAvailable: avail ? avail.getAttribute("aria-checked") : "",
    sliderOnRide: onride ? (onride.getAttribute("aria-checked") + " " + (onride.textContent || "").replace(/\s+/g, " ")) : "",
    segments: segs.map(function (s) { return { type: s.type, assigned: !!s.assigned, open: !s.end }; }),
    track: trk.map(function (p) { return p[3]; }).join(""),
    own: store["pcs-cmp-own-status-" + id] || "",
    pending: store["pcs-cmp-avail-pending-" + id] || "",
    statusPosts: survived.slice(-4),
    abortedStatus: posts.filter(function (p) { return p.aborted; }).length,
    lastSurvivedOnRide: survived.length ? survived[survived.length - 1].onRide : lastPost
  };
}

async function flush() {
  for (var i = 0; i < 40; i++) await Promise.resolve();
}

function bootDriver(store, log, errors) {
  const dom = createDom(store, log, errors);
  dom.boot();
  return dom;
}

async function startComparison(dom) {
  dom.clickId("open-meter-cmp");
  const svc = dom.document.getElementById("cmp-service");
  const typ = dom.document.getElementById("cmp-type");
  if (!svc || !typ) throw new Error("comparison pickers missing");
  svc.value = "uber";
  svc.dispatch("change");
  const typ2 = dom.document.getElementById("cmp-type");
  typ2.value = "UberX";
  typ2.dispatch("change");
  dom.clickId("meter-start");
  dom.fixGps();
  await flush();
}

test("ending a comparison ride returns Available even if Goal opens immediately", async function () {
  const store = Object.create(null);
  const log = [];
  const errors = [];
  seedStore(store, "mwragge78@gmail.com");
  let dom = bootDriver(store, log, errors);
  await flush();
  const trace = [];
  trace.push(snapshot("1 available", store, dom.sandbox, log));

  await startComparison(dom);
  trace.push(snapshot("2 comparison running", store, dom.sandbox, log));

  dom.clickId("meter-end");
  dom.clickId("meter-end-yes");
  await flush();
  trace.push(snapshot("3 end tapped", store, dom.sandbox, log));

  dom.gotoGoal();
  trace.push(snapshot("4 goal page (left the driver app)", store, dom.sandbox, log));

  dom = bootDriver(store, log, errors);
  await flush();
  dom.fixGps();
  await flush();
  trace.push(snapshot("5 back on the driver app", store, dom.sandbox, log));

  console.log("COMPARISON_RIDE_TRACE " + JSON.stringify(trace, null, 2));
  if (errors.length) console.log("HARNESS_ERRORS " + errors.slice(0, 6).join("\n---\n"));

  const back = trace[4];
  assert.equal(back.manual, false);
  assert.equal(back.auto, false);
  assert.equal(back.busyFlag, "");
  assert.equal(back.meter, "");
  assert.equal(back.sliderAvailable, "true");
  assert.equal(back.segments.some(function (s) { return s.open; }), false);
  assert.ok(/a$/.test(back.track), "track should end on Available (a), got " + back.track);
  assert.equal(back.lastSurvivedOnRide, false);
  assert.ok(trace[2].statusPosts.concat(trace[4].statusPosts).some(function (p) { return p.onRide === false && (p.keepalive || p.beacon); }));
  await flush();
});

test("an Uber ride already in progress is not cleared when a comparison ride ends", async function () {
  const store = Object.create(null);
  const log = [];
  const errors = [];
  seedStore(store, "mwragge78@gmail.com");
  let dom = bootDriver(store, log, errors);
  await flush();
  dom.clickId("q-set-onride");
  const pick = dom.document.querySelector(".q-rt-pick");
  assert.ok(pick, "ride type menu");
  const uber = dom.document.querySelectorAll(".q-rt-pick").filter(function (el) { return el.getAttribute("data-rt") === "Uber"; })[0];
  assert.ok(uber);
  uber.click();
  await flush();
  const before = snapshot("uber before comparison", store, dom.sandbox, log);
  assert.equal(before.manual, true);
  assert.ok(before.segments.some(function (s) { return s.type === "Uber" && s.open; }));

  await startComparison(dom);
  dom.clickId("meter-end");
  dom.clickId("meter-end-yes");
  await flush();
  dom.gotoGoal();
  dom = bootDriver(store, log, errors);
  await flush();
  const after = snapshot("after comparison", store, dom.sandbox, log);
  assert.equal(after.manual, true, "a real Uber ride stays On a ride");
  assert.equal(after.busyFlag, "1");
  assert.equal(after.meter, "");
  await flush();
});

test("reloading after a closed comparison ride rewrites a stuck On a ride track to Available", async function () {
  const store = Object.create(null);
  const log = [];
  const errors = [];
  const email = "mwragge78@gmail.com";
  seedStore(store, email);
  const id = driverId(email);
  const day = chicagoDay();
  store["pcs-meter-last-" + id] = JSON.stringify({ code: "CMPSTUCK", meterKind: "comparison", status: "paid", metered: true });
  store["pcs-trk-" + id] = JSON.stringify({ [day]: [[10, 2976040, -9536980, "r"]] });
  store["pcs-cmp-avail-pending-" + id] = JSON.stringify({ code: "CMPSTUCK", at: Date.now() });
  const dom = bootDriver(store, log, errors);
  await flush();
  const back = snapshot("reload stuck r", store, dom.sandbox, log);
  assert.equal(back.manual, false);
  assert.equal(back.auto, false);
  assert.equal(back.busyFlag, "");
  assert.ok(/a$/.test(back.track), back.track);
  assert.equal(back.lastSurvivedOnRide, false);
  assert.ok(back.statusPosts.some(function (p) { return p.onRide === false && p.keepalive && p.done; }));
  await flush();
});

test("a plain meter ride still waits to finish and does not take the comparison Available path", function () {
  const src = fs.readFileSync(path.join(root, "app/app.js"), "utf8");
  const end = src.slice(src.indexOf("function meterEnd()"), src.indexOf("function meterEnd()") + 900);
  assert.ok(end.indexOf("setTimeout(finish, 4000)") >= 0);
  assert.ok(end.indexOf('meterKindOf(M) === "comparison"') >= 0);
  const finish = src.slice(src.indexOf("function meterFinishEnd()"), src.indexOf("function meterFinishPrepaid"));
  assert.ok(finish.indexOf('meterKindOf(M) === "comparison"') >= 0);
  assert.equal((src.match(/function qReleaseToAvailable/g) || []).length, 1);
});
