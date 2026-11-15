/* Add missing receipt: insert-in-the-middle math, validation, and per-key fuel sync. */
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
      closest() { return null; }, contains() { return false; }, focus() {}, blur() {},
      setSelectionRange() {}, remove() {},
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
    TextEncoder, TextDecoder, Uint8Array, alert() {},
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), sandbox, { filename: "god/goal.js" });
  return sandbox;
}

function bookWithTwoFills(fuelApi) {
  const a1 = Date.parse("2026-11-08T14:55:00Z"); /* 8:55 AM CT */
  const a3 = Date.parse("2026-11-14T16:00:00Z"); /* 10:00 AM CT */
  const w1 = fuelApi.when(a1), w3 = fuelApi.when(a3);
  return {
    seed: { odo: 100000, at: 1 },
    log_early: { at: a1, date: w1.date, time: w1.time, prev: 100000, odo: 100220, gallons: 10, price: 40 },
    log_late: { at: a3, date: w3.date, time: w3.time, prev: 100220, odo: 100640, gallons: 9.5, price: 36 }
  };
}

test("a missing receipt in the middle corrects miles and mpg in odometer order", function () {
  const sandbox = loadGoal();
  const fuel = sandbox.__pcsGoalFuel;
  const book = bookWithTwoFills(fuel);
  const laterPrevBefore = book.log_late.prev;
  assert.equal(fuel.prev(book), 100640);
  assert.equal(fuel.rows(book).map(function (r) { return r.odo; }).join(","), "100220,100640");

  const at = fuel.atFromInput("2026-11-13", "20:25");
  assert.ok(at);
  const when = fuel.when(at);
  assert.equal(when.date, "11/13/26");
  assert.equal(when.time, "2025");
  assert.equal(fuel.when(fuel.atFromInput("2026-11-13", "")).time, "1200");
  assert.equal(fuel.when(fuel.atFromInput("2026-11-13", "12:00")).time, "1200");

  const added = fuel.addMissing(book, { at: at, odo: 100400, gallons: 18.347, ppg: 4.539 }, 1700000000000);
  assert.equal(added.ok, true);
  assert.equal(added.entry.added, true);
  assert.equal(added.entry.addedAt, 1700000000000);
  assert.equal(added.entry.odo, 100400);
  assert.equal(added.entry.gallons, 18.347);
  assert.equal(added.entry.ppg, 4.539);
  assert.equal(added.entry.price, Math.round(18.347 * 4.539 * 100) / 100);
  assert.equal(added.entry.date, "11/13/26");
  assert.equal(added.entry.time, "2025");
  assert.equal(added.entry.prev, 100220);
  assert.ok(book[added.id]);
  assert.equal(book.log_late.prev, laterPrevBefore, "do not rewrite the later fill's stored prev");
  assert.equal(book.log_early.prev, 100000);
  assert.equal(book.log_early.odo, 100220);
  assert.equal(book.log_late.odo, 100640);

  const rows = fuel.displayRows(book);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(function (r) { return r.odo; }), [100220, 100400, 100640]);
  assert.equal(rows[0].displayPrev, 100000);
  assert.equal(rows[1].displayPrev, 100220);
  assert.equal(rows[2].displayPrev, 100400);
  const mid = fuel.math(rows[1].displayPrev, rows[1].odo, rows[1].gallons, rows[1].price);
  assert.equal(mid.ok, true);
  assert.equal(mid.miles, 180);
  const after = fuel.math(rows[2].displayPrev, rows[2].odo, rows[2].gallons, rows[2].price);
  assert.equal(after.ok, true);
  assert.equal(after.miles, 240);
  assert.equal(after.mpg, 240 / 9.5);
  const storedAfter = fuel.math(book.log_late.prev, book.log_late.odo, book.log_late.gallons, book.log_late.price);
  assert.equal(storedAfter.miles, 420, "stored prev still reflects the old gap; display uses the inserted odo");
  assert.equal(fuel.prev(book), 100640);
});

test("a missing receipt is rejected when the odometer or amounts are not valid", function () {
  const fuel = loadGoal().__pcsGoalFuel;
  const book = bookWithTwoFills(fuel);
  const midAt = fuel.atFromInput("2026-11-13", "20:25");
  const copy = JSON.parse(JSON.stringify(book));

  function reject(rec, text) {
    const v = fuel.validateMissing(book, rec);
    assert.equal(v.ok, false, text);
    assert.ok(v.error, text);
    assert.equal(JSON.stringify(book), JSON.stringify(copy), "validation must not save");
  }

  reject({ at: midAt, odo: 100000, gallons: 18.347, ppg: 4.539 }, "equal to the seed");
  reject({ at: midAt, odo: 99999, gallons: 18.347, ppg: 4.539 }, "below the seed");
  reject({ at: midAt, odo: 100220, gallons: 18.347, ppg: 4.539 }, "equal to an existing reading");
  reject({ at: midAt, odo: 100700, gallons: 18.347, ppg: 4.539 }, "higher than a later date");
  reject({ at: midAt, odo: 100100, gallons: 18.347, ppg: 4.539 }, "lower than an earlier date");
  reject({ at: midAt, odo: 100400, gallons: 0, ppg: 4.539 }, "zero gallons");
  reject({ at: midAt, odo: 100400, gallons: 18.347, ppg: 0 }, "zero price");
  reject({ at: null, odo: 100400, gallons: 18.347, ppg: 4.539 }, "missing date");
  assert.equal(fuel.addMissing(book, { at: midAt, odo: 100700, gallons: 18.347, ppg: 4.539 }).ok, false);
  assert.equal(Object.keys(book).join(","), Object.keys(copy).join(","));
});

test("a new missing-receipt fuel key merges across devices and is not dropped", function () {
  const sandbox = loadGoal();
  const fuel = sandbox.__pcsGoalFuel;
  const merge = sandbox.module.exports.merge;
  const stamp = sandbox.module.exports.stamp;
  const phone = { settings: {}, entries: {}, fuel: bookWithTwoFills(fuel) };
  stamp(phone, 1000);
  const ipad = JSON.parse(JSON.stringify(phone));
  const at = fuel.atFromInput("2026-11-13", "20:25");
  const added = fuel.addMissing(ipad.fuel, { at: at, odo: 100400, gallons: 18.347, ppg: 4.539 }, 2000);
  assert.equal(added.ok, true);
  stamp(ipad, 2000);
  const out = merge(phone, ipad);
  assert.ok(out.fuel[added.id], "new log key from the iPad is in the merge");
  assert.equal(out.fuel[added.id].odo, 100400);
  assert.equal(out.fuel[added.id].gallons, 18.347);
  assert.equal(out.fuel[added.id].added, true);
  assert.equal(out.fuel.log_early.odo, 100220);
  assert.equal(out.fuel.log_late.odo, 100640);
  assert.equal(out.fuel.seed.odo, 100000);
  assert.equal(fuel.displayRows(out.fuel).length, 3);
  assert.equal(fuel.prev(out.fuel), 100640);

  const again = merge(out, phone);
  assert.ok(again.fuel[added.id], "a later sync from the phone that never had the key does not drop it");
  assert.equal(again.fuel[added.id].odo, 100400);
  assert.equal(fuel.rows(again.fuel).length, 3);

  const phoneOnly = { settings: {}, entries: {}, fuel: bookWithTwoFills(fuel) };
  stamp(phoneOnly, 3000);
  const other = { settings: {}, entries: {}, fuel: bookWithTwoFills(fuel) };
  stamp(other, 3000);
  const a = fuel.addMissing(phoneOnly.fuel, { at: fuel.atFromInput("2026-11-10", "09:00"), odo: 100300, gallons: 5, ppg: 3.5 }, 4000);
  const b = fuel.addMissing(other.fuel, { at: fuel.atFromInput("2026-11-12", "09:00"), odo: 100500, gallons: 6, ppg: 3.6 }, 4000);
  stamp(phoneOnly, 4000);
  stamp(other, 4000);
  const both = merge(phoneOnly, other);
  assert.ok(both.fuel[a.id]);
  assert.ok(both.fuel[b.id]);
  assert.equal(fuel.rows(both.fuel).length, 4);
});

test("the Fuel card has Add missing receipt fields and the same gallons keypad", function () {
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  assert.ok(src.indexOf("Add missing receipt") >= 0);
  assert.ok(src.indexOf("Save missing receipt") >= 0);
  assert.ok(src.indexOf('id="gl-fuel-miss-date"') >= 0);
  assert.ok(src.indexOf('id="gl-fuel-miss-time"') >= 0);
  assert.ok(src.indexOf('value="12:00"') >= 0);
  assert.ok(src.indexOf('data-fuel="ppg"') >= 0);
  assert.ok(src.indexOf('id="gl-fuel-miss-odo"') >= 0);
  assert.ok(src.indexOf('id="gl-fuel-miss-gal"') >= 0);
  assert.ok(/data-fuel" === "gal" \|\| el.getAttribute\("data-fuel"\) === "ppg"/.test(src) || src.indexOf('data-fuel") === "ppg"') >= 0);
  const html = fs.readFileSync(path.join(__dirname, "../god/index.html"), "utf8");
  assert.ok(html.indexOf("goal.js?v=2.0m-bv") >= 0);
});

test("the fuel log keeps every fill and shows five at a time in a scroll box", function () {
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  assert.match(src, /#gl-screen #gl-fuel-log\{[^}]*overflow-y:auto/);
  assert.match(src, /#gl-screen #gl-fuel-log\{[^}]*-webkit-overflow-scrolling:touch/);
  assert.ok(src.indexOf('data-view-rows="5"') >= 0);
  assert.ok(src.indexOf("rows.slice().reverse().map") >= 0);
  assert.equal(src.indexOf("rows.slice(0, 5)"), -1);
  assert.equal(src.indexOf("rows.slice(-5)"), -1);

  const sandbox = loadGoal();
  const fuel = sandbox.__pcsGoalFuel;
  const book = { seed: { odo: 100000, at: 1 } };
  const odos = [100200, 100350, 100500, 100650, 100800, 100950, 101100, 101250];
  odos.forEach(function (odo, i) {
    const at = Date.parse("2026-11-0" + (1 + i) + "T15:00:00Z");
    const when = fuel.when(at);
    book["log_" + at] = { at: at, date: when.date, time: when.time, prev: i ? odos[i - 1] : 100000, odo: odo, gallons: 10 + i, price: 40 };
  });
  assert.equal(fuel.rows(book).length, 8);
  const newestFirst = fuel.displayRows(book).slice().reverse();
  assert.equal(newestFirst[0].odo, 101250);
  assert.equal(newestFirst[7].odo, 100200);

  const log = sandbox.document.createElement("ul");
  log.id = "gl-fuel-log";
  log.style = {};
  const lis = [];
  newestFirst.forEach(function (r, i) {
    const li = sandbox.document.createElement("li");
    li._html = fuel.hist(r);
    li.getBoundingClientRect = function () { return { top: 10 + i * 40, bottom: 10 + (i + 1) * 40, height: 40, left: 0, right: 40, width: 40 }; };
    log.appendChild(li);
    lis.push(li);
  });
  sandbox.document.getElementById = function (id) { return id === "gl-fuel-log" ? log : null; };
  sandbox.getComputedStyle = function () { return { paddingTop: "0", paddingBottom: "0" }; };
  fuel.logFit();
  assert.equal(log.children.length, 8, "every fill stays in the list");
  assert.equal(log.style.maxHeight, "200px");
  assert.equal(log.style.height, "200px");
  assert.ok(lis.every(function (li, i) { return li.parentNode === log && String(li._html).indexOf("odo " + newestFirst[i].odo) >= 0; }));

  const short = sandbox.document.createElement("ul");
  short.id = "gl-fuel-log";
  short.style = {};
  for (let i = 0; i < 3; i++) {
    const li = sandbox.document.createElement("li");
    li.getBoundingClientRect = function () { return { top: i * 40, bottom: (i + 1) * 40, height: 40, left: 0, right: 40, width: 40 }; };
    short.appendChild(li);
  }
  sandbox.document.getElementById = function (id) { return id === "gl-fuel-log" ? short : null; };
  fuel.logFit();
  assert.equal(short.children.length, 3);
  assert.equal(short.style.height, "");
  assert.equal(short.style.maxHeight, "");
});

test("the fuel log refits five rows on resize and orientation change, once", function () {
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  assert.match(src, /window\.addEventListener\("resize", fuelLogFitSoon\)/);
  assert.match(src, /window\.addEventListener\("orientationchange", fuelLogFitSoon\)/);
  const bindAt = src.indexOf("function bindFuel()");
  const resizeInBind = src.indexOf('addEventListener("resize"', bindAt);
  const orientInBind = src.indexOf('addEventListener("orientationchange"', bindAt);
  assert.equal(resizeInBind, -1, "bindFuel must not add a resize listener");
  assert.equal(orientInBind, -1, "bindFuel must not add an orientationchange listener");
  assert.ok(src.indexOf("fuelLogFitWatch();") >= 0);
  assert.ok(src.indexOf("if (fuelLogFitOn ||") >= 0);

  const timers = [];
  let tid = 0;
  const listeners = { resize: [], orientationchange: [] };
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, Promise, RegExp, Error, parseInt, isFinite,
    Event: function Event(type) { this.type = type; },
    setTimeout(fn, ms) { const id = ++tid; timers.push({ id, fn, ms: ms || 0 }); return id; },
    clearTimeout(id) { const i = timers.findIndex(function (t) { return t.id === id; }); if (i >= 0) timers.splice(i, 1); },
    setInterval() { return 0; }, clearInterval() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    document: {
      addEventListener() {}, getElementById() { return null; },
      createElement() { return { id: "", style: {}, appendChild() {}, setAttribute() {}, children: [] }; },
      head: { appendChild() {} }, body: { appendChild() {} }
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { search: "", hostname: "localhost", href: "http://localhost/god/" },
    navigator: { userAgent: "test" },
    indexedDB: { open() { throw new Error("no-idb"); } },
    crypto: { getRandomValues(a) { return a; }, subtle: {} },
    fetch() { return Promise.reject(new Error("no")); },
    TextEncoder, TextDecoder, Uint8Array, alert() {},
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), sandbox, { filename: "god/goal.js" });

  assert.equal(listeners.resize.length, 1);
  assert.equal(listeners.orientationchange.length, 1);
  assert.equal(listeners.resize[0], sandbox.__pcsGoalFuel.logFitSoon);
  assert.equal(listeners.orientationchange[0], sandbox.__pcsGoalFuel.logFitSoon);

  sandbox.__pcsGoalFuel.logFitWatch();
  sandbox.__pcsGoalFuel.logFitWatch();
  assert.equal(listeners.resize.length, 1, "watch is a no-op the second time");
  assert.equal(listeners.orientationchange.length, 1);

  let rowH = 40;
  const log = { style: {}, children: [] };
  for (let i = 0; i < 8; i++) {
    (function (i) {
      log.children.push({
        getBoundingClientRect() { return { top: 10 + i * rowH, bottom: 10 + (i + 1) * rowH, height: rowH, left: 0, right: 40, width: 40 }; }
      });
    })(i);
  }
  sandbox.document.getElementById = function (id) { return id === "gl-fuel-log" ? log : null; };
  sandbox.getComputedStyle = function () { return { paddingTop: "0", paddingBottom: "0" }; };

  sandbox.__pcsGoalFuel.logFit();
  assert.equal(log.style.height, "200px");

  rowH = 28;
  listeners.resize[0]({ type: "resize" });
  listeners.resize[0]({ type: "resize" });
  listeners.orientationchange[0]({ type: "orientationchange" });
  assert.equal(log.style.height, "200px", "height waits for the debounce");
  assert.equal(timers.length, 1, "bursts collapse to one timer");
  const wait = timers[0].ms;
  assert.ok(wait >= 40 && wait <= 200, "debounce " + wait);
  timers[0].fn();
  timers.splice(0, 1);
  assert.equal(log.style.height, "140px", "five rows at the new height");
  assert.equal(log.children.length, 8);

  sandbox.document.getElementById = function () { return null; };
  listeners.resize[0]({ type: "resize" });
  assert.equal(timers.length, 1);
  assert.doesNotThrow(function () { timers[0].fn(); });
});
