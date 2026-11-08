/* Fuel math on Matthew's Goal page. It is not part of the driver app. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function loadGoal() {
  const nodes = {};
  function el(tag) {
    const node = {
      tag: tag, style: {}, attrs: {}, children: [], parentNode: null, value: "", type: "text",
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      addEventListener(t, fn) { this._l = this._l || {}; (this._l[t] = this._l[t] || []).push(fn); },
      dispatchEvent(ev) { (this._l && this._l[ev.type] || []).forEach(function (fn) { fn(ev); }); return true; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      closest(sel) { let n = this; while (n) { if (n.tag === "button" && sel === "button[data-k]" && n.attrs["data-k"]) return n; n = n.parentNode; } return null; },
      contains() { return false; }, focus() { let n = this; const ev = { type: "focusin", target: this }; while (n) { (n._l && n._l.focusin || []).forEach(function (fn) { fn(ev); }); n = n.parentNode; } }, blur() {}, setSelectionRange() {}, remove() {},
      getBoundingClientRect() { return { top: 10, bottom: 40, left: 0, right: 40, width: 40, height: 30 }; }
    };
    Object.defineProperty(node, "id", { get() { return node._id || ""; }, set(v) { node._id = String(v); nodes[node._id] = node; } });
    Object.defineProperty(node, "innerHTML", {
      set(html) {
        node._html = html; node.children = [];
        const re = /<([a-z0-9]+)\b[^>]*\bid="([^"]+)"/gi;
        let m;
        while ((m = re.exec(html))) {
          const child = el(m[1]);
          child.id = m[2];
          child.parentNode = node;
          node.children.push(child);
        }
      },
      get() { return node._html || ""; }
    });
    return node;
  }
  const doc = { readyState: "complete", body: el("body"), head: el("head"), documentElement: el("html"), addEventListener() {}, createElement: el, querySelector() { return null; }, getElementById(id) { return nodes[id] || null; } };
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
    TextEncoder, TextDecoder, Uint8Array, alert() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), sandbox, { filename: "god/goal.js" });
  return sandbox;
}

const fuel = loadGoal().__pcsGoalFuel;
const appSrc = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

test("a fill figures miles, mpg, tank, and price per mile", function () {
  assert.equal(appSrc.indexOf("gl-fuel"), -1);
  const m = fuel.math(1000, 1220, 10, 40);
  assert.equal(m.ok, true);
  assert.equal(m.miles, 220);
  assert.equal(m.mpg, 22);
  assert.equal(m.tank, 484);
  assert.equal(m.ppm, 0.18);
  assert.equal(fuel.fmt(m).mpg, "22.00");
  assert.equal(fuel.fmt(m).tank, "484.00");
  assert.equal(fuel.fmt(m).ppm, "$0.18");
  assert.equal(fuel.math(1000, 1000, 10, 40).ok, false);
  assert.equal(fuel.math(null, 10, 1, 1).ok, false);
  const book = { seed: { odo: 500, at: 1 } };
  assert.equal(fuel.prev(book), 500);
  book.log_2 = { at: 2, odo: 700, gallons: 8, price: 30, prev: 500 };
  assert.equal(fuel.prev(book), 700);
  assert.equal(fuel.rows(book).length, 1);
  const when = fuel.when(Date.parse("2026-11-08T14:55:00Z"));
  assert.equal(when.date, "11/8/26");
  assert.equal(when.time, "0855");
  assert.equal(fuel.when(Date.parse("2026-11-08T21:40:00Z")).time, "1540");
  assert.equal(fuel.owner(), false);
});

test("gallons keep three decimals and a price stays at cents", function () {
  const sandbox = loadGoal();
  sandbox.__pcsGoalOpen();
  const ov = sandbox.document.getElementById("gl-screen");
  function field(kp) {
    const input = sandbox.document.createElement("input");
    input.type = "text";
    input.setAttribute("data-kp", kp);
    if (kp === "d") input.setAttribute("data-reg", "1");
    ov.appendChild(input);
    input.focus();
    return input;
  }
  function press(key) {
    const pad = sandbox.document.getElementById("gl-kp");
    let btn = null;
    const html = pad.innerHTML;
    assert.ok(html.indexOf('data-k="' + key + '"') >= 0);
    const node = { tag: "button", attrs: { "data-k": key }, parentNode: pad, getAttribute(k) { return this.attrs[k] || null; }, closest() { return node; } };
    (pad._l.pointerup || []).forEach(function (fn) { fn({ target: node, pointerType: "touch", button: 0, preventDefault() {} }); });
  }
  const gal = field("g");
  ["1", ".", "2", "3", "4", "5"].forEach(press);
  assert.equal(gal.value, "1.234");
  const price = field("d");
  ["1", "2", "3", "4"].forEach(press);
  assert.equal(price.value, "12.34");
});
