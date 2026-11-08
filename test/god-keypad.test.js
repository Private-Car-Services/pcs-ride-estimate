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
    querySelector() { return null; }
  };
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, Promise, RegExp, Error, parseInt, isFinite,
    Event: function Event(type) { this.type = type; },
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    document: doc, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
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
  return { sandbox, doc, nodes };
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
  if (how === "up") (pad._l.pointerup || []).forEach(function (fn) { fn(ev); });
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

test("v2.0m-ai is what a phone on v2.0m-ag is offered", function () {
  const { sandbox } = loadGoal();
  const version = fs.readFileSync(path.join(__dirname, "../app/version.js"), "utf8");
  assert.ok(version.indexOf('var APP_VERSION = "v2.0m-ai"') >= 0);
  const pages = {
    "app/driver/index.html": "version.js?v=2.0m-ai",
    "app/index.html": "version.js?v=2.0m-ai",
    "god/index.html": "goal.js?v=2.0m-ag",
    "meter/index.html": "version.js?v=2.0m-ai"
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
