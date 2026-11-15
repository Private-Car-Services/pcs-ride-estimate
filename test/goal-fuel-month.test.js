/* Current-month Fuel totals: dollars, gallons, receipt-row miles, avg MPG, price per mile. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function loadGoal(store) {
  store = store || {};
  const nodes = {};
  function el(tag) {
    const node = {
      tag: tag, style: {}, attrs: {}, children: [], parentNode: null, value: "", type: "text", textContent: "",
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); if (c._id) nodes[c._id] = c; return c; },
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
  const doc = { readyState: "complete", body: el("body"), head: el("head"), documentElement: el("html"), addEventListener() {}, createElement: el, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById(id) { return nodes[id] || null; } };
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, Promise, RegExp, Error, parseInt, isFinite, Intl,
    Event: function Event(type) { this.type = type; },
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    document: doc, localStorage: { getItem(k) { return store[k] == null ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
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

function entry(fuel, at, odo, gallons, price, prev) {
  const when = fuel.when(at);
  return { at: at, date: when.date, time: when.time, prev: prev, odo: odo, gallons: gallons, price: price };
}

function shotBook(fuel) {
  const oct = fuel.atFromInput("2026-10-31", "12:00");
  const fills = [
    [fuel.atFromInput("2026-11-10", "12:00"), 243871, 18.683, 85.74, 243466],
    [fuel.atFromInput("2026-11-11", "12:00"), 244246, 18.945, 86.18, 243871],
    [fuel.atFromInput("2026-11-12", "12:00"), 244627, 19.312, 83.02, 244246],
    [fuel.atFromInput("2026-11-13", "12:00"), 245022, 18.347, 78.69, 244627],
    [fuel.atFromInput("2026-11-15", "12:00"), 245393, 17.534, 79.76, 245022]
  ];
  const book = { seed: { odo: 243000, at: 1 }, ["log_" + oct]: entry(fuel, oct, 243466, 18.000, 80.00, 243000) };
  fills.forEach(function (row) {
    book["log_" + row[0]] = entry(fuel, row[0], row[1], row[2], row[3], row[4]);
  });
  return book;
}

test("a fill at 11:30 PM CT on Oct 31 counts in October, not November", function () {
  const fuel = loadGoal().__pcsGoalFuel;
  const lateOct = fuel.atFromInput("2026-10-31", "23:30");
  const earlyNov = fuel.atFromInput("2026-11-01", "00:05");
  const nowOct = fuel.atFromInput("2026-10-31", "23:45");
  const nowNov = fuel.atFromInput("2026-11-15", "12:00");
  assert.ok(lateOct && earlyNov && nowOct && nowNov);
  const book = {
    seed: { odo: 100000, at: 1 },
    log_oct: entry(fuel, lateOct, 100400, 10.5, 42.00, 100000),
    log_nov: entry(fuel, earlyNov, 100700, 8.25, 33.00, 100400)
  };
  const oct = fuel.monthStats(book, nowOct);
  assert.equal(oct.label, "October 2026");
  assert.equal(oct.spent, 42);
  assert.equal(oct.gallons, 10.5);
  assert.equal(oct.miles, 400);
  assert.equal(oct.mpg, 400 / 10.5);
  assert.equal(oct.ppm, 42 / 400);
  const nov = fuel.monthStats(book, nowNov);
  assert.equal(nov.label, "November 2026");
  assert.equal(nov.spent, 33);
  assert.equal(nov.gallons, 8.25);
  assert.equal(nov.miles, 300, "November miles are the Nov row's log mi, including miles since the Oct fill");
  assert.equal(nov.mpg, 300 / 8.25);
  assert.equal(nov.ppm, 33 / 300);
});

test("a missing-receipt fill is counted in the month of its receipt date", function () {
  const fuel = loadGoal().__pcsGoalFuel;
  const book = {
    seed: { odo: 100000, at: 1 },
    log_oct: entry(fuel, fuel.atFromInput("2026-10-20", "12:00"), 100200, 9, 36, 100000),
    log_late: entry(fuel, fuel.atFromInput("2026-11-14", "10:00"), 100640, 9.5, 36, 100200)
  };
  const added = fuel.addMissing(book, { at: fuel.atFromInput("2026-11-13", "20:25"), odo: 100400, gallons: 18.347, price: 83.28 }, 1700000000000);
  assert.equal(added.ok, true);
  const now = fuel.atFromInput("2026-11-15", "12:00");
  const s = fuel.monthStats(book, now);
  assert.equal(s.spent, 36 + 83.28);
  assert.equal(s.gallons, 9.5 + 18.347);
  const rows = fuel.displayRows(book);
  const nov = rows.filter(function (r) { return r.odo === 100400 || r.odo === 100640; });
  const miles = nov.reduce(function (n, r) { return n + (Math.round(Number(r.odo)) - r.displayPrev); }, 0);
  assert.equal(miles, 200 + 240);
  assert.equal(s.miles, 440);
  assert.equal(s.mpg, 440 / (18.347 + 9.5));
  assert.equal(s.ppm, (83.28 + 36) / 440);
  assert.equal(s.label, "November 2026");
});

test("month miles add each log row's mi, and mpg and price per mile use those same row miles", function () {
  const fuel = loadGoal().__pcsGoalFuel;
  const now = fuel.atFromInput("2026-11-15", "12:00");
  const book = shotBook(fuel);
  const s = fuel.monthStats(book, now);
  const spent = 85.74 + 86.18 + 83.02 + 78.69 + 79.76;
  const gallons = 18.683 + 18.945 + 19.312 + 18.347 + 17.534;
  const miles = 405 + 375 + 381 + 395 + 371;
  assert.equal(s.spent, Math.round(spent * 100) / 100);
  assert.equal(s.spent, 413.39);
  assert.equal(s.gallons, Math.round(gallons * 1000) / 1000);
  assert.equal(s.gallons, 92.821);
  assert.equal(s.miles, 1927);
  assert.notEqual(s.miles, 245393 - 243871, "miles are the sum of row mi, not last minus first November odometer");
  assert.equal(s.mpg, 1927 / 92.821);
  assert.equal(s.ppm, 413.39 / 1927);
  const f = fuel.monthFmt(s);
  assert.equal(f.spent, "$413.39");
  assert.equal(f.gallons, "92.821");
  assert.equal(f.miles, "1927");
  assert.equal(f.mpg, "20.76");
  assert.equal(f.ppm, "$0.21");
  assert.equal(f.label, "November 2026");
  assert.equal(s.spent === 80 || s.gallons === 18, false, "October receipt dollars and gallons stay out of November");
});

test("an empty month shows zeros and dashes", function () {
  const fuel = loadGoal().__pcsGoalFuel;
  const book = {
    seed: { odo: 100000, at: 1 },
    log_oct: entry(fuel, fuel.atFromInput("2026-10-31", "23:30"), 100400, 10, 40, 100000)
  };
  const s = fuel.monthStats(book, fuel.atFromInput("2026-11-15", "12:00"));
  assert.equal(s.spent, 0);
  assert.equal(s.gallons, 0);
  assert.equal(s.miles, 0);
  assert.equal(s.mpg, null);
  assert.equal(s.ppm, null);
  assert.equal(s.label, "November 2026");
  const f = fuel.monthFmt(s);
  assert.equal(f.spent, "$0.00");
  assert.equal(f.gallons, "0.000");
  assert.equal(f.miles, "0");
  assert.equal(f.mpg, "\u2014");
  assert.equal(f.ppm, "\u2014");
});

test("the Fuel card shows five month boxes above the date line, and paint refreshes them after a save", function () {
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  assert.ok(src.indexOf("function fuelMonthStats(book, nowMs)") >= 0);
  assert.ok(src.indexOf("monthStats: fuelMonthStats") >= 0);
  assert.ok(src.indexOf('id="gl-fuel-month"') >= 0);
  assert.ok(src.indexOf("$ This month") >= 0);
  assert.ok(src.indexOf("Avg price per mile") >= 0);
  assert.ok(src.indexOf("fuelMonthHtml(book) + whenLine") >= 0);
  const html = fs.readFileSync(path.join(__dirname, "../god/index.html"), "utf8");
  assert.ok(html.indexOf("goal.js?v=2.0m-bx") >= 0);

  const store = { "pcs-god-keep-v1": JSON.stringify({ email: "mwragge78@gmail.com" }) };
  const sandbox = loadGoal(store);
  const fuel = sandbox.__pcsGoalFuel;
  const now = fuel.atFromInput("2026-11-15", "12:00");
  fuel.monthNow(now);
  const book = {
    seed: { odo: 100000, at: 1 },
    log_one: entry(fuel, fuel.atFromInput("2026-11-10", "12:00"), 100400, 10, 40, 100000)
  };
  sandbox.module.exports._set({ settings: {}, entries: {}, fuel: book });
  const app = sandbox.document.createElement("div");
  app.id = "gl-app";
  sandbox.module.exports._setApp(app);
  sandbox.module.exports.paint();
  const card = app.innerHTML;
  assert.ok(card.indexOf('id="gl-fuel-month"') >= 0);
  const monthAt = card.indexOf('id="gl-fuel-month"');
  const whenAt = card.indexOf('id="gl-fuel-when"');
  assert.ok(monthAt > 0 && whenAt > monthAt, "boxes sit under the Fuel title and above the date line");
  assert.ok(sandbox.document.getElementById("gl-fuel-m-spent"), "spent box is in the painted card");
  function readBoxes() {
    const h = sandbox.document.getElementById("gl-app").innerHTML;
    function val(id) {
      const m = h.match(new RegExp('id="' + id + '"[\\s\\S]*?class="v">([^<]*)'));
      return m && m[1];
    }
    const label = (h.match(/id="gl-fuel-m-label">([^<]*)/) || [])[1];
    return { spent: val("gl-fuel-m-spent"), gal: val("gl-fuel-m-gal"), miles: val("gl-fuel-m-miles"), mpg: val("gl-fuel-m-mpg"), ppm: val("gl-fuel-m-ppm"), label: label };
  }
  let shown = readBoxes();
  assert.equal(shown.spent, "$40.00");
  assert.equal(shown.gal, "10.000");
  assert.equal(shown.miles, "400");
  assert.equal(shown.mpg, "40.00");
  assert.equal(shown.ppm, "$0.10");
  assert.equal(shown.label, "November 2026");

  const price = sandbox.document.getElementById("gl-fuel-price");
  const odo = sandbox.document.getElementById("gl-fuel-odo");
  const gal = sandbox.document.getElementById("gl-fuel-gal");
  price.value = "36.00";
  odo.value = "100700";
  gal.value = "8.000";
  const saveB = sandbox.document.getElementById("gl-fuel-save");
  assert.ok(saveB);
  saveB.onclick();
  shown = readBoxes();
  assert.equal(shown.spent, "$76.00");
  assert.equal(shown.gal, "18.000");
  assert.equal(shown.miles, "700");
  assert.equal(shown.mpg, (700 / 18).toFixed(2));
  assert.equal(shown.ppm, "$" + (76 / 700).toFixed(2));

  fuel.monthNow(now);
  sandbox.document.getElementById("gl-fuel-miss-open").onclick();
  sandbox.document.getElementById("gl-fuel-miss-date").value = "2026-11-12";
  sandbox.document.getElementById("gl-fuel-miss-time").value = "15:00";
  sandbox.document.getElementById("gl-fuel-miss-price").value = "20.00";
  sandbox.document.getElementById("gl-fuel-miss-odo").value = "100500";
  sandbox.document.getElementById("gl-fuel-miss-gal").value = "5.000";
  sandbox.document.getElementById("gl-fuel-miss-save").onclick();
  shown = readBoxes();
  assert.equal(shown.spent, "$96.00");
  assert.equal(shown.gal, "23.000");
  assert.equal(shown.miles, "700");
  assert.equal(shown.mpg, (700 / 23).toFixed(2));
  assert.equal(shown.ppm, "$" + (96 / 700).toFixed(2));

  const seedOnly = loadGoal(store);
  seedOnly.__pcsGoalFuel.monthNow(now);
  seedOnly.module.exports._set({ settings: {}, entries: {}, fuel: {} });
  const app2 = seedOnly.document.createElement("div");
  app2.id = "gl-app";
  seedOnly.module.exports._setApp(app2);
  seedOnly.module.exports.paint();
  assert.ok(app2.innerHTML.indexOf('id="gl-fuel-odo"') >= 0);
  assert.equal(app2.innerHTML.indexOf('id="gl-fuel-month"'), -1, "starting-odometer screen has no month boxes");
});
