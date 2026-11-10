/* God mode 9-key pad: a tap must type when the browser delivers pointerup without a click. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function loadGoal(opts) {
  const nodes = {};
  function el(tag) {
    const node = {
      tag: tag, style: {}, className: "", attrs: {}, children: [], parentNode: null,
      value: "", type: tag === "button" ? "button" : "text", selectionStart: null, selectionEnd: null,
      classList: { add(c) { node.className += " " + c; }, remove() {}, toggle(c, on) { if (on) node.className += " " + c; } },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      addEventListener(t, fn) { this._l = this._l || {}; (this._l[t] = this._l[t] || []).push(fn); },
      dispatchEvent(ev) { ev.target = ev.target || this; (this._l && this._l[ev.type] || []).forEach(function (fn) { fn(ev); }); return true; },
      querySelector(sel) { return walk(this, sel); },
      querySelectorAll(sel) {
        const out = [];
        (function visit(n) {
          if (n !== node && sel === "input" && n.tag === "input") out.push(n);
          (n.children || []).forEach(visit);
        })(node);
        return out;
      },
      closest(sel) { let n = this; while (n) { if (match(n, sel)) return n; n = n.parentNode; } return null; },
      contains(n) { let x = n; while (x) { if (x === this) return true; x = x.parentNode; } return false; },
      focus() { this._focusCalls = (this._focusCalls || 0) + 1; if (opts && opts.suppressFocus) return; let n = this; const ev = { type: "focusin", target: this }; while (n) { (n._l && n._l.focusin || []).forEach(function (fn) { fn(ev); }); n = n.parentNode; } },
      blur() {}, setSelectionRange() {}, remove() {},
      getBoundingClientRect() { return { top: 700, bottom: 760, left: 0, right: 80, width: 80, height: 60 }; }
    };
    Object.defineProperty(node, "id", { get() { return node._id || ""; }, set(v) { node._id = String(v); nodes[node._id] = node; } });
    Object.defineProperty(node, "innerHTML", { set(html) { node._html = html; parseButtons(node, html); }, get() { return node._html || ""; } });
    return node;
  }
  function match(n, sel) {
    if (!n || !n.tag) return false;
    if (sel === "button[data-k]") return n.tag === "button" && n.attrs["data-k"];
    if (sel === "button") return n.tag === "button";
    if (sel.charAt(0) === "#") return n.id === sel.slice(1);
    return false;
  }
  function walk(n, sel) {
    if (match(n, sel)) return n;
    for (let i = 0; i < (n.children || []).length; i++) { const f = walk(n.children[i], sel); if (f) return f; }
    return null;
  }
  function attr(text, name) { const m = new RegExp("\\b" + name + '="([^"]*)"').exec(text || ""); return m ? m[1] : ""; }
  function parseButtons(node, html) {
    node.children = [];
    const re = /<(button|input|main|form)\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
      const child = el(m[1].toLowerCase());
      const id = attr(m[2], "id"), type = attr(m[2], "type"), im = attr(m[2], "inputmode"), ml = attr(m[2], "maxlength"), ph = attr(m[2], "placeholder"), dk = attr(m[2], "data-k");
      if (id) child.id = id;
      if (type) child.type = type;
      if (im) child.setAttribute("inputmode", im);
      if (ml) child.setAttribute("maxlength", ml);
      if (ph) child.setAttribute("placeholder", ph);
      if (dk) child.setAttribute("data-k", dk);
      const fuel = attr(m[2], "data-fuel");
      if (fuel) child.setAttribute("data-fuel", fuel);
      const label = attr(m[2], "aria-label");
      if (label) child.setAttribute("aria-label", label);
      child.parentNode = node;
      node.children.push(child);
    }
  }
  const doc = {
    readyState: "complete",
    body: el("body"), head: el("head"), documentElement: el("html"),
    addEventListener() {},
    getElementById(id) { if (!nodes[id]) { const n = el("div"); n.id = id; } return nodes[id]; },
    createElement: el,
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const timers = [];
  const frames = [];
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, Promise, RegExp, Error, parseInt, isFinite,
    Event: function Event(type) { this.type = type; },
    setTimeout(fn) { if (opts && opts.queueTimers && typeof fn === "function") { timers.push(fn); return timers.length; } return 0; },
    clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame(fn) { if (opts && opts.queueTimers && typeof fn === "function") { frames.push(fn); return frames.length; } return 0; },
    cancelAnimationFrame() {},
    document: doc, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    module: { exports: {} },
    location: { search: "", hostname: "localhost", href: "http://localhost/god/" },
    navigator: { userAgent: "test" },
    indexedDB: { open() { throw new Error("no-idb"); } },
    crypto: { getRandomValues(a) { return a; }, subtle: {} },
    fetch() { return Promise.reject(new Error("no")); },
    TextEncoder, TextDecoder, Uint8Array
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), sandbox, { filename: "god/goal.js" });
  async function flush() {
    await Promise.resolve();
    frames.splice(0).forEach(function (fn) { fn(0); });
    timers.splice(0).forEach(function (fn) { fn(); });
    await Promise.resolve();
  }
  return { sandbox, doc, nodes, flush };
}

function openPad(box, kind) {
  const { sandbox, doc } = loadGoal();
  sandbox.__pcsGoalOpen();
  const ov = doc.getElementById("gl-screen");
  const input = doc.createElement("input");
  input.id = "field";
  input.type = kind === "pin" ? "password" : "text";
  input.setAttribute("data-kp", kind === "pin" ? "w" : "d");
  if (kind === "price") input.setAttribute("data-reg", "1");
  if (kind === "pin") input.setAttribute("maxlength", "4");
  ov.appendChild(input);
  input.focus();
  const pad = doc.getElementById("gl-kp");
  assert.ok(pad, "pad opens");
  assert.equal(pad.style.display, "block");
  return { input, pad };
}

function press(pad, key, how) {
  let btn = null;
  (function walk(n) {
    if (n && n.attrs && n.attrs["data-k"] === key) btn = n;
    (n.children || []).forEach(walk);
  })(pad);
  assert.ok(btn, key);
  const ev = { target: btn, pointerType: "touch", button: 0, preventDefault() {} };
  if (how === "up") {
    (pad._l.pointerdown || []).forEach(function (fn) { fn(ev); });
    (pad._l.pointerup || []).forEach(function (fn) { fn(ev); });
  }
  if (how === "click") (pad._l.click || []).forEach(function (fn) { fn(ev); });
}

test("a price tap types from the cents when only pointerup arrives", function () {
  const { input, pad } = openPad(null, "price");
  press(pad, "9", "up");
  press(pad, "9", "click");
  assert.equal(input.value, "0.09");
  press(pad, "6", "up");
  press(pad, "2", "up");
  press(pad, "5", "up");
  assert.equal(input.value, "96.25");
});

test("releasing the mouse on the pad after pressing a box does not type", function () {
  const { sandbox, doc } = loadGoal();
  sandbox.__pcsGoalOpen();
  const ov = doc.getElementById("gl-screen");
  const input = doc.createElement("input");
  input.id = "gl-fuel-price";
  input.setAttribute("data-kp", "d");
  input.setAttribute("data-reg", "1");
  ov.appendChild(input);
  webkitTap(ov, input);
  const pad = doc.getElementById("gl-kp");
  let btn = null;
  (function walk(n) { if (n && n.attrs && n.attrs["data-k"] === "9") btn = n; (n.children || []).forEach(walk); })(pad);
  (pad._l.pointerup || []).forEach(function (fn) { fn({ target: btn, pointerType: "mouse", button: 0, preventDefault() {} }); });
  (pad._l.click || []).forEach(function (fn) { fn({ target: btn, preventDefault() {} }); });
  assert.equal(input.value, "");
  press(pad, "9", "up");
  assert.equal(input.value, "0.09");
});

test("Done stays closed when the same touch's click lands on the fuel box", function () {
  const { sandbox, doc } = loadGoal();
  sandbox.localStorage.getItem = function (k) {
    if (k === "pcs-god-keep-v1") return JSON.stringify({ email: "mwragge78@gmail.com" });
    return null;
  };
  sandbox.__pcsGoalOpen();
  sandbox.module.exports._set({ settings: {}, entries: {}, fuel: { seed: { odo: 100000, at: 1 } } });
  sandbox.module.exports.paint();
  const ov = doc.getElementById("gl-screen");
  const price = doc.getElementById("gl-fuel-price");
  webkitTap(ov, price);
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  press(pad, "4", "up");
  press(pad, "0", "up");
  press(pad, "done", "up");
  assert.equal(pad.style.display, "none");
  (ov._l.click || []).forEach(function (fn) { fn({ target: price }); });
  (ov._l.focusin || []).forEach(function (fn) { fn({ target: price }); });
  assert.equal(pad.style.display, "none");
  assert.equal(price.value, "0.40");
  webkitTap(ov, price);
  assert.equal(pad.style.display, "block");
  press(pad, "done", "up");
  assert.equal(pad.style.display, "none");
});

test("a click without pointerup still types one price digit", function () {
  const { input, pad } = openPad(null, "price");
  press(pad, "4", "click");
  assert.equal(input.value, "0.04");
});

test("a PIN tap types one digit and does not double it", function () {
  const { input, pad } = openPad(null, "pin");
  ["1", "2", "3", "4"].forEach(function (k) { press(pad, k, "up"); press(pad, k, "click"); });
  assert.equal(input.value, "1234");
  press(pad, "5", "up");
  assert.equal(input.value, "1234");
});

test("v2.0m-bc is what a phone on v2.0m-az is offered", function () {
  const { sandbox } = loadGoal();
  const version = fs.readFileSync(path.join(__dirname, "../app/version.js"), "utf8");
  assert.ok(version.indexOf('var APP_VERSION = "v2.0m-bc"') >= 0);
  const pages = {
    "app/driver/index.html": "version.js?v=2.0m-ba",
    "app/index.html": "version.js?v=2.0m-ba",
    "god/index.html": "goal.js?v=2.0m-ax",
    "meter/index.html": "version.js?v=2.0m-ba"
  };
  Object.keys(pages).forEach(function (rel) {
    const html = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    assert.ok(html.indexOf(pages[rel]) >= 0, rel);
  });
  assert.equal(typeof sandbox.__pcsKpBtn, "function");
  const text = { parentElement: null, closest: null };
  const btn = { tag: "button", attrs: { "data-k": "1" }, closest(sel) { return sel.indexOf("button") >= 0 ? btn : null; } };
  text.parentElement = btn;
  assert.equal(sandbox.__pcsKpBtn({ target: text }).attrs["data-k"], "1");
});

test("stored-ledger pinScreen shows the pad when focus is suppressed", function () {
  const { sandbox, doc } = loadGoal({ suppressFocus: true });
  sandbox.__pcsGoalOpen();
  sandbox.__pcsGoalPinScreen({ fails: 0, exp: Date.now() + 3600000 });
  const pin = doc.getElementById("gl-pin");
  assert.equal(pin.tag, "input");
  assert.equal(pin.getAttribute("inputmode"), "none");
  assert.equal(pin.getAttribute("data-kp"), "w");
  assert.equal(pin.getAttribute("maxlength"), "4");
  assert.equal(pin._focusCalls || 0, 0);
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") >= 0);
});

test("first-run PIN boxes show the pad when focus is suppressed", function () {
  const { sandbox, doc } = loadGoal({ suppressFocus: true });
  sandbox.__pcsGoalOpen();
  sandbox.__pcsGoalFirstRun();
  const pin1 = doc.getElementById("gl-pin1");
  const pin2 = doc.getElementById("gl-pin2");
  const pw = doc.getElementById("gl-pw1");
  assert.equal(pin1.tag, "input");
  assert.equal(pin2.tag, "input");
  assert.equal(pin1.getAttribute("inputmode"), "none");
  assert.equal(pin2.getAttribute("inputmode"), "none");
  assert.equal(pin1.getAttribute("data-kp"), "w");
  assert.equal(pin2.getAttribute("data-kp"), "w");
  assert.equal(pin1.getAttribute("maxlength"), "4");
  assert.equal(pw.getAttribute("data-kp"), null);
  assert.equal(pin1._focusCalls || 0, 0);
  assert.equal(pin2._focusCalls || 0, 0);
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") >= 0);
  ["1", "2", "3", "4"].forEach(function (k) { press(pad, k, "up"); press(pad, k, "click"); });
  assert.equal(pin1.value, "1234");
  press(pad, "5", "up");
  assert.equal(pin1.value, "1234");
  const ov = doc.getElementById("gl-screen");
  ov._l.pointerdown.forEach(function (fn) { fn({ target: pin2, preventDefault: function () {} }); });
  assert.equal(doc.getElementById("gl-kp").style.display, "block");
  press(pad, "9", "up");
  assert.equal(pin2.value, "9");
});

test("tapping the PIN opens the pad when focus never arrived", function () {
  const { sandbox, doc } = loadGoal();
  sandbox.__pcsGoalOpen();
  const ov = doc.getElementById("gl-screen");
  const pin = doc.createElement("input");
  pin.id = "gl-pin";
  pin.type = "password";
  pin.setAttribute("inputmode", "numeric");
  ov.appendChild(pin);
  sandbox.__pcsNumPad(ov);
  assert.ok(ov._l && ov._l.pointerdown && ov._l.pointerdown.length);
  ov._l.pointerdown.forEach(function (fn) { fn({ target: pin, preventDefault: function () {} }); });
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") >= 0);
});

test("a price box stays closed until it is tapped", function () {
  const { sandbox, doc } = loadGoal();
  sandbox.__pcsGoalOpen();
  const ov = doc.getElementById("gl-screen");
  const price = doc.createElement("input");
  price.id = "gl-q-amt";
  price.type = "text";
  price.setAttribute("inputmode", "decimal");
  ov.appendChild(price);
  sandbox.__pcsNumPad(ov);
  assert.equal(price.getAttribute("data-kp"), "d");
  assert.equal(price.getAttribute("data-reg"), "1");
  const before = doc.getElementById("gl-kp");
  assert.ok(!before || before.style.display !== "block");
  ov._l.pointerdown.forEach(function (fn) { fn({ target: price, preventDefault: function () {} }); });
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") < 0);
});

/* WebKit order on iPad: touchstart, pointerdown, focusin, then pointerup on a key. */
function webkitTap(ov, el) {
  const ev = { target: el, cancelable: true, pointerType: "touch", button: 0, prevented: false, preventDefault() { this.prevented = true; } };
  (ov._l.touchstart || []).forEach(function (fn) { fn(ev); });
  (ov._l.pointerdown || []).forEach(function (fn) { fn(ev); });
  (ov._l.focusin || []).forEach(function (fn) { fn({ target: el }); });
  return ev;
}

test("the real PIN screen blocks the iPad keyboard and keeps a leading zero", function () {
  const { sandbox, doc } = loadGoal();
  const saved = [];
  sandbox.localStorage.setItem = function () { saved.push("set"); };
  sandbox.__pcsGoalOpen();
  sandbox.__pcsGoalPinScreen({ fails: 0, exp: Date.now() + 3600000 });
  const app = doc.getElementById("gl-app");
  assert.equal(String(app._html).indexOf("autofocus"), -1);
  const pin = doc.getElementById("gl-pin");
  assert.equal(String(app._html).indexOf('id="gl-pw"'), -1);
  assert.equal(pin.readOnly, true);
  assert.equal(pin.getAttribute("inputmode"), "none");
  assert.equal(pin.getAttribute("data-kp"), "w");
  assert.equal(pin.getAttribute("data-reg"), null);
  assert.equal(pin.getAttribute("maxlength"), "4");
  const ov = doc.getElementById("gl-screen");
  const ev = webkitTap(ov, pin);
  assert.equal(ev.prevented, true);
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") >= 0);
  assert.ok(String(pad.className).indexOf("hold") >= 0);
  ["0", "1", "2", "3"].forEach(function (k) { press(pad, k, "up"); press(pad, k, "click"); });
  assert.equal(pin.value, "0123");
  press(pad, "9", "up");
  assert.equal(pin.value, "0123");
  press(pad, "sys", "up");
  assert.equal(pad.style.display, "block");
  assert.equal(saved.length, 0);
  assert.equal(pin.readOnly, true);
  assert.equal(pin.getAttribute("inputmode"), "none");
});

test("ride total and tip total use the cents pad after an iPad tap even if the alphabet keyboard was chosen before", function () {
  const { sandbox, doc } = loadGoal();
  sandbox.localStorage.getItem = function (k) { return k === "pcsGoalSysKb" ? "1" : null; };
  const saved = [];
  sandbox.localStorage.setItem = function () { saved.push("set"); };
  sandbox.__pcsGoalOpen();
  const ov = doc.getElementById("gl-screen");
  function field(id, mode, label) {
    const el = doc.createElement("input");
    el.id = id;
    el.type = "text";
    if (mode) el.setAttribute("inputmode", mode);
    if (label) el.setAttribute("aria-label", label);
    ov.appendChild(el);
    return el;
  }
  const ride = field("gl-q-amt", "decimal", "Ride amount");
  const tip = field("gl-q-tip", "decimal", "Tip (optional)");
  const note = field("gl-q-note", "", "Note (optional)");
  const god = doc.createElement("input");
  god.id = "gl-gpin";
  god.type = "password";
  god.setAttribute("inputmode", "numeric");
  ov.appendChild(god);
  sandbox.__pcsNumPad(ov);
  assert.equal(ride.readOnly, true);
  assert.equal(tip.readOnly, true);
  assert.equal(ride.getAttribute("inputmode"), "none");
  assert.equal(tip.getAttribute("inputmode"), "none");
  assert.equal(ride.getAttribute("data-kp"), "d");
  assert.equal(ride.getAttribute("data-reg"), "1");
  assert.equal(tip.getAttribute("data-reg"), "1");
  assert.equal(note.getAttribute("data-kp"), null);
  assert.notEqual(note.readOnly, true);
  assert.notEqual(god.readOnly, true);
  const rideTap = webkitTap(ov, ride);
  assert.equal(rideTap.prevented, true);
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") < 0);
  assert.ok(String(pad.className).indexOf("hold") >= 0);
  ["9", "6", "2", "5"].forEach(function (k) { press(pad, k, "up"); press(pad, k, "click"); });
  assert.equal(ride.value, "96.25");
  press(pad, ".", "up");
  assert.equal(ride.value, "96.25");
  webkitTap(ov, tip);
  ["1", "0", "0"].forEach(function (k) { press(pad, k, "up"); });
  assert.equal(tip.value, "1.00");
  assert.equal(ride.value, "96.25");
  press(pad, "sys", "up");
  assert.equal(pad.style.display, "block");
  assert.equal(saved.length, 0);
  assert.equal(tip.readOnly, true);
  const noteTap = { target: note, cancelable: true, prevented: false, preventDefault() { this.prevented = true; } };
  (ov._l.touchstart || []).forEach(function (fn) { fn(noteTap); });
  assert.equal(noteTap.prevented, false);
});

test("first-run and unlock PIN screens open the pad before any tap when the iPad keyboard was saved", async function () {
  const { sandbox, doc, flush } = loadGoal({ queueTimers: true });
  sandbox.localStorage.getItem = function (k) { return k === "pcsGoalSysKb" ? "1" : null; };
  sandbox.__pcsGoalOpen();
  sandbox.__pcsGoalFirstRun();
  const pin1 = doc.getElementById("gl-pin1");
  const pin2 = doc.getElementById("gl-pin2");
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") >= 0);
  assert.ok(String(pad.className).indexOf("hold") >= 0);
  assert.equal(pin1.readOnly, true);
  assert.equal(pin2.readOnly, true);
  assert.equal(pin1.getAttribute("inputmode"), "none");
  assert.equal(pin2.getAttribute("inputmode"), "none");
  assert.equal(doc.getElementById("gl-pw1").getAttribute("data-kp"), null);
  await flush();
  assert.equal(pin1._focusCalls || 0, 0);
  assert.equal(pin2._focusCalls || 0, 0);
  assert.equal(pad.style.display, "block");
  ["0", "1", "2", "3"].forEach(function (k) { press(pad, k, "up"); press(pad, k, "click"); });
  assert.equal(pin1.value, "0123");
  const ov = doc.getElementById("gl-screen");
  ov._l.pointerdown.forEach(function (fn) { fn({ target: pin2, cancelable: true, pointerType: "touch", button: 0, preventDefault() {} }); });
  await flush();
  assert.equal(pin2._focusCalls || 0, 0);
  assert.equal(pad.style.display, "block");
  press(pad, "9", "up");
  assert.equal(pin2.value, "9");
  assert.equal(pin1.value, "0123");
  sandbox.__pcsGoalPinScreen({ fails: 0, exp: Date.now() + 3600000 });
  const pin = doc.getElementById("gl-pin");
  const unlock = doc.getElementById("gl-kp");
  assert.equal(unlock.style.display, "block");
  assert.ok(String(unlock.className).indexOf("whole") >= 0);
  assert.equal(pin.readOnly, true);
  assert.equal(pin.getAttribute("inputmode"), "none");
  assert.equal(pin.getAttribute("maxlength"), "4");
  await flush();
  assert.equal(pin._focusCalls || 0, 0);
  assert.equal(unlock.style.display, "block");
  ["0", "1", "2", "3"].forEach(function (k) { press(unlock, k, "up"); press(unlock, k, "click"); });
  assert.equal(pin.value, "0123");
  press(unlock, "9", "up");
  assert.equal(pin.value, "0123");
});

test("every typed fuel box uses the nine-key pad after the iPad keyboard was saved", function () {
  const { sandbox, doc } = loadGoal();
  const saved = [];
  sandbox.localStorage.getItem = function (k) {
    if (k === "pcsGoalSysKb") return "1";
    if (k === "pcs-god-keep-v1") return JSON.stringify({ email: "mwragge78@gmail.com" });
    return null;
  };
  sandbox.localStorage.setItem = function () { saved.push("set"); };
  sandbox.__pcsGoalOpen();
  sandbox.module.exports._set({ settings: {}, entries: {} });
  sandbox.module.exports.paint();
  const ov = doc.getElementById("gl-screen");
  const html = doc.getElementById("gl-app")._html;
  assert.ok(html.indexOf("Date and time are saved automatically.") >= 0);
  assert.equal(html.indexOf('<input id="gl-fuel-prev"'), -1);
  assert.equal(html.indexOf('<input id="gl-fuel-miles"'), -1);
  const seed = doc.getElementById("gl-fuel-odo");
  assert.equal(seed.readOnly, true);
  assert.equal(seed.getAttribute("data-kp"), "w");
  assert.equal(seed.getAttribute("data-reg"), null);
  assert.equal(seed.getAttribute("inputmode"), "none");
  const seedTap = webkitTap(ov, seed);
  assert.equal(seedTap.prevented, true);
  (ov._l.click || []).forEach(function (fn) { fn({ target: seed }); });
  const pad = doc.getElementById("gl-kp");
  assert.equal(pad.style.display, "block");
  assert.ok(String(pad.className).indexOf("whole") >= 0);
  assert.ok(String(pad.className).indexOf("hold") >= 0);
  press(pad, "0", "up");
  assert.equal(seed.value, "0");
  press(pad, ".", "up");
  assert.equal(seed.value, "0");
  press(pad, "clr", "up");
  ["1", "0", "0", "0", "0", "0"].forEach(function (k) { press(pad, k, "up"); press(pad, k, "click"); });
  assert.equal(seed.value, "100000");
  assert.equal(seed.value.indexOf("."), -1);
  press(pad, "sys", "up");
  assert.equal(pad.style.display, "block");
  assert.equal(saved.length, 0);
  assert.equal(seed.readOnly, true);
  doc.getElementById("gl-fuel-seed").onclick();
  sandbox.module.exports.paint();
  const again = doc.getElementById("gl-app")._html;
  assert.ok(again.indexOf("Previous odometer") >= 0);
  assert.ok(again.indexOf(">100000<") >= 0);
  assert.equal(again.indexOf('<input id="gl-fuel-prev"'), -1);
  const price = doc.getElementById("gl-fuel-price");
  const odo = doc.getElementById("gl-fuel-odo");
  const gal = doc.getElementById("gl-fuel-gal");
  const year = doc.getElementById("gl-s-year");
  assert.equal(price.getAttribute("data-kp"), "d");
  assert.equal(price.getAttribute("data-reg"), "1");
  assert.equal(odo.getAttribute("data-kp"), "w");
  assert.equal(gal.getAttribute("data-kp"), "g");
  assert.equal(gal.getAttribute("data-reg"), null);
  [price, odo, gal].forEach(function (el) {
    assert.equal(el.readOnly, true, el.id);
    assert.equal(el.getAttribute("inputmode"), "none", el.id);
    const tap = webkitTap(ov, el);
    assert.equal(tap.prevented, true, el.id);
    assert.equal(doc.getElementById("gl-kp").style.display, "block");
  });
  assert.notEqual(year.readOnly, true);
  assert.equal(year.getAttribute("inputmode"), "decimal");
  const yearTap = webkitTap(ov, year);
  assert.equal(yearTap.prevented, false);
  webkitTap(ov, price);
  press(doc.getElementById("gl-kp"), "0", "up");
  assert.equal(price.value, "0.00");
  press(doc.getElementById("gl-kp"), "bs", "up");
  assert.equal(price.value, "");
  press(doc.getElementById("gl-kp"), "0", "up");
  assert.equal(price.value, "0.00");
  press(doc.getElementById("gl-kp"), "5", "up");
  assert.equal(price.value, "0.05");
  price.__regFresh = true;
  ["4", "0", "5", "0"].forEach(function (k) { press(doc.getElementById("gl-kp"), k, "up"); press(doc.getElementById("gl-kp"), k, "click"); });
  assert.equal(price.value, "40.50");
  press(doc.getElementById("gl-kp"), ".", "up");
  assert.equal(price.value, "40.50");
  webkitTap(ov, gal);
  ["1", "8", ".", "1", "5", "7"].forEach(function (k) { press(doc.getElementById("gl-kp"), k, "up"); press(doc.getElementById("gl-kp"), k, "click"); });
  assert.equal(gal.value, "18.157");
  press(doc.getElementById("gl-kp"), "9", "up");
  assert.equal(gal.value, "18.157");
  press(doc.getElementById("gl-kp"), "bs", "up");
  assert.equal(gal.value, "18.15");
  press(doc.getElementById("gl-kp"), "clr", "up");
  assert.equal(gal.value, "");
  ["1", "8", ".", "1", "5", "7"].forEach(function (k) { press(doc.getElementById("gl-kp"), k, "up"); });
  assert.equal(gal.value, "18.157");
  webkitTap(ov, gal);
  assert.equal(gal.value, "18.157");
  assert.notEqual(gal.value, "181.57");
  assert.notEqual(gal.value, "18.16");
  webkitTap(ov, odo);
  ["1", "0", "0", "3", "7", "9"].forEach(function (k) { press(doc.getElementById("gl-kp"), k, "up"); });
  press(doc.getElementById("gl-kp"), ".", "up");
  assert.equal(odo.value, "100379");
  press(doc.getElementById("gl-kp"), "sys", "up");
  assert.equal(doc.getElementById("gl-kp").style.display, "block");
  assert.equal(saved.length, 0);
  doc.getElementById("gl-fuel-save").onclick();
  const book = sandbox.module.exports._get().fuel;
  const logs = Object.keys(book).filter(function (k) { return k.indexOf("log_") === 0; });
  assert.equal(logs.length, 1);
  assert.equal(book[logs[0]].prev, 100000);
  assert.equal(book[logs[0]].odo, 100379);
  assert.equal(book[logs[0]].gallons, 18.157);
  assert.notEqual(book[logs[0]].gallons, 181.57);
  assert.notEqual(book[logs[0]].gallons, 18.16);
  assert.equal(book[logs[0]].price, 40.5);
  const mpg = 379 / 18.157;
  sandbox.module.exports.paint();
  const locked = doc.getElementById("gl-app")._html;
  assert.ok(locked.indexOf(">100379<") >= 0);
  assert.ok(locked.indexOf("18.157 gal") >= 0);
  assert.ok(locked.indexOf(mpg.toFixed(2) + " mpg") >= 0);
  assert.ok(locked.indexOf((mpg * 22).toFixed(2)) >= 0);
  assert.equal(locked.indexOf("459.14"), -1);
  assert.equal(locked.indexOf('<input id="gl-fuel-miles"'), -1);
  assert.equal(locked.indexOf('<input id="gl-fuel-mpg"'), -1);
  const price2 = doc.getElementById("gl-fuel-price");
  const odo2 = doc.getElementById("gl-fuel-odo");
  const gal2 = doc.getElementById("gl-fuel-gal");
  webkitTap(ov, price2);
  price2.__regFresh = true;
  press(doc.getElementById("gl-kp"), "0", "up");
  assert.equal(price2.value, "0.00");
  webkitTap(ov, odo2);
  ["1", "0", "0", "4", "0", "0"].forEach(function (k) { press(doc.getElementById("gl-kp"), k, "up"); });
  webkitTap(ov, gal2);
  ["1", ".", "0", "0", "0"].forEach(function (k) { press(doc.getElementById("gl-kp"), k, "up"); });
  assert.equal(gal2.value, "1.000");
  doc.getElementById("gl-fuel-save").onclick();
  const zeroRows = Object.keys(sandbox.module.exports._get().fuel).filter(function (k) { return k.indexOf("log_") === 0; }).map(function (k) { return sandbox.module.exports._get().fuel[k]; });
  const kept = zeroRows.filter(function (r) { return r.odo === 100379; })[0];
  const zero = zeroRows.filter(function (r) { return r.odo === 100400; })[0];
  assert.equal(zeroRows.length, 2);
  assert.ok(kept);
  assert.equal(kept.gallons, 18.157);
  assert.equal(kept.price, 40.5);
  assert.equal(kept.prev, 100000);
  assert.ok(zero);
  assert.equal(zero.prev, 100379);
  assert.equal(zero.price, 0);
  assert.equal(zero.gallons, 1);
  const later = Date.parse("2027-01-15T18:40:00Z");
  const laterWhen = sandbox.__pcsGoalFuel.when(later);
  sandbox.Date.now = function () { return later; };
  doc.getElementById("gl-fuel-price").value = "30.00";
  doc.getElementById("gl-fuel-odo").value = "100510";
  doc.getElementById("gl-fuel-gal").value = "8.500";
  doc.getElementById("gl-fuel-save").onclick();
  const all = Object.keys(sandbox.module.exports._get().fuel).filter(function (k) { return k.indexOf("log_") === 0; }).map(function (k) { return sandbox.module.exports._get().fuel[k]; });
  assert.equal(all.length, 3);
  assert.equal(all.filter(function (r) { return r.odo === 100379; })[0].gallons, 18.157);
  const third = all.filter(function (r) { return r.odo === 100510; })[0];
  assert.equal(third.prev, 100400);
  assert.equal(third.date, laterWhen.date);
  assert.notEqual(third.date, kept.date);
  assert.equal(third.gallons, 8.5);
  assert.equal(third.price, 30);
  sandbox.module.exports.paint();
  const hist = doc.getElementById("gl-app")._html;
  assert.ok(hist.indexOf('id="gl-fuel-log"') >= 0);
  function row(odo) {
    const hit = hist.split("<li>").filter(function (p) { return p.indexOf("odo " + odo + " ") >= 0; });
    assert.equal(hit.length, 1, String(odo));
    return hit[0];
  }
  const morning = row(100379);
  const noon = row(100400);
  const next = row(100510);
  assert.ok(morning.indexOf("18.157 gal") >= 0);
  assert.ok(morning.indexOf((mpg * 22).toFixed(2) + " mi/tank") >= 0);
  assert.ok(morning.indexOf(mpg.toFixed(2) + " mpg") >= 0);
  assert.ok(morning.indexOf("$" + (40.5 / 18.157).toFixed(3) + "/gal") >= 0);
  assert.ok(morning.indexOf("$40.50 total") >= 0);
  assert.ok(morning.indexOf("$" + (40.5 / 379).toFixed(2) + "/mi") >= 0);
  assert.ok(noon.indexOf("1.000 gal") >= 0);
  assert.ok(noon.indexOf("$0.00 total") >= 0);
  assert.ok(noon.indexOf("$0.000/gal") >= 0);
  assert.ok(next.indexOf(laterWhen.date) >= 0);
  assert.ok(next.indexOf("8.500 gal") >= 0);
  assert.ok(next.indexOf("$30.00 total") >= 0);
  assert.ok(next.indexOf(" mi/tank") >= 0);
  assert.equal(sandbox.module.exports._get().fuel && Object.keys(sandbox.module.exports._get().fuel).filter(function (k) { return k.indexOf("log_") === 0; }).length, 3);
  assert.equal(year.getAttribute("data-kp"), "d");
  assert.notEqual(year.readOnly, true);
});

test("daily total note closes the ride pad, and amount or tip blurs the note", function () {
  const { sandbox, doc } = loadGoal();
  sandbox.__pcsGoalOpen();
  const ov = doc.getElementById("gl-screen");
  function field(id, mode, label) {
    const el = doc.createElement("input");
    el.id = id;
    el.type = "text";
    if (mode) el.setAttribute("inputmode", mode);
    if (label) el.setAttribute("aria-label", label);
    ov.appendChild(el);
    return el;
  }
  const ride = field("gl-q-amt", "decimal", "Ride amount");
  const tip = field("gl-q-tip", "decimal", "Tip (optional)");
  const note = field("gl-q-note", "", "Note (optional)");
  sandbox.__pcsNumPad(ov);
  assert.equal(note.getAttribute("data-kp"), null);
  assert.notEqual(note.readOnly, true);
  assert.equal(ride.readOnly, true);
  assert.equal(tip.readOnly, true);
  assert.equal(ride.getAttribute("inputmode"), "none");
  assert.equal(tip.getAttribute("inputmode"), "none");
  note.blur = function () { note._blurred = (note._blurred || 0) + 1; if (doc.activeElement === note) doc.activeElement = doc.body; };
  ride.blur = function () { ride._blurred = (ride._blurred || 0) + 1; if (doc.activeElement === ride) doc.activeElement = doc.body; };
  tip.blur = function () { tip._blurred = (tip._blurred || 0) + 1; if (doc.activeElement === tip) doc.activeElement = doc.body; };
  function label() { const lb = doc.getElementById("gl-kp-lbl"); return lb ? lb.textContent : ""; }
  function pad() { return doc.getElementById("gl-kp"); }
  webkitTap(ov, ride);
  press(pad(), "1", "up");
  assert.equal(ride.value, "0.01");
  assert.equal(pad().style.display, "block");
  assert.equal(label(), "Ride amount");
  doc.activeElement = note;
  webkitTap(ov, tip);
  assert.equal(pad().style.display, "block");
  assert.equal(label(), "Tip (optional)");
  assert.ok(note._blurred >= 1);
  assert.notEqual(doc.activeElement, note);
  assert.equal(tip.readOnly, true);
  assert.equal(tip.getAttribute("inputmode"), "none");
  doc.activeElement = note;
  note.focus();
  assert.equal(pad().style.display, "none");
  assert.equal(note._focusCalls || 0, 1);
  assert.equal(doc.activeElement, note);
  doc.activeElement = note;
  webkitTap(ov, ride);
  assert.equal(pad().style.display, "block");
  assert.equal(label(), "Ride amount");
  assert.ok(note._blurred >= 2);
  assert.notEqual(doc.activeElement, note);
  assert.equal(ride.getAttribute("inputmode"), "none");
  press(pad(), "done", "up");
  assert.equal(pad().style.display, "none");
  (ov._l.focusin || []).forEach(function (fn) { fn({ target: ride }); });
  assert.equal(pad().style.display, "none");
  webkitTap(ov, ride);
  assert.equal(pad().style.display, "block");
  assert.equal(label(), "Ride amount");
});
