"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const T = "2026-11-08";
const SAT = "2026-11-07";
const OLD = "2026-10-01";
const EMPTY = "2026-09-15";

function load() {
  const fetches = [];
  const writes = [];
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, Promise, RegExp, Error, parseInt, isNaN, isFinite, Uint8Array,
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    localStorage: { getItem() { return null; }, setItem() { writes.push("ls"); }, removeItem() {} },
    location: { search: "" },
    indexedDB: { open() { writes.push("idb"); return {}; } },
    crypto: { getRandomValues(a) { a.fill(1); return a; }, subtle: {} },
    TextEncoder: class { encode(s) { return Buffer.from(String(s)); } },
    TextDecoder: class { decode() { return "{}"; } },
    atob, btoa,
    fetch() { fetches.push("fetch"); return Promise.resolve({ ok: false, json() { return Promise.resolve(null); } }); },
    module: { exports: {} },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
      createElement() { return { style: {}, appendChild() {} }; },
      head: { appendChild() {} },
      body: { appendChild() {} }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), sandbox, { filename: "goal.js" });
  sandbox.__fetches = fetches;
  sandbox.__writes = writes;
  return sandbox;
}

function entry(date, line, amount, extra) {
  return Object.assign({ date: date, line: line, amount: amount, note: "", at: Date.parse(date + "T18:00:00Z"), source: "manual" }, extra || {});
}

function ledger() {
  const entries = {
    today: entry(T, "pcs", 3),
    satRide: entry(SAT, "pcs", 40, { at: Date.parse(SAT + "T16:00:00Z") }),
    satTip: entry(SAT, "pcs", 5, { tip: true, at: Date.parse(SAT + "T16:05:00Z") }),
    satExp: entry(SAT, "exp", 99),
    old: entry(OLD, "pcs", 7)
  };
  const dayHrs = {
    [SAT]: { mins: 120, rate: 22.5, sum: 45, open: false },
    [OLD]: { mins: 120, rate: 3.5, sum: 7, open: false },
    [EMPTY]: { mins: 0, rate: null, sum: 0, open: false }
  };
  ["2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02", "2026-11-01", "2026-10-28"].forEach(function (d, i) {
    const amt = 11 + i;
    entries["e" + d] = entry(d, i % 2 ? "uber" : "lyft", amt);
    dayHrs[d] = { mins: 120, rate: Math.round(amt / 2 * 100) / 100, sum: amt, open: false };
  });
  return { entries: entries, dayHrs: dayHrs, settings: {}, adj: {} };
}

test("past days keep a 7-row window and include dates older than 7 days", () => {
  const box = load();
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  const fn = src.slice(src.indexOf("function pastDaysHtml"), src.indexOf("function hrPastHtml"));
  assert.match(src, /#gl-screen #gl-past\{max-height:248px;overflow-y:auto/);
  assert.doesNotMatch(fn, /slice\(0, 7\)/);
  assert.doesNotMatch(fn, /addDays\(t, -7\)/);
  box.module.exports._set(ledger());
  const html = box.__pcsGoalHourly.pastDaysHtml(T);
  assert.match(html, /id="gl-past"/);
  assert.match(html, /data-view-rows="7"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /data-day="2026-11-07"/);
  assert.match(html, />Sat 11\/7</);
  assert.match(html, /data-day="2026-10-01"/);
  assert.match(html, /data-day="2026-09-15"/);
  const days = html.match(/data-day="/g);
  assert.ok(days.length > 7, "scroll list is longer than the 7 visible rows");
  assert.equal(box.__writes.length, 0);
  assert.equal(box.__fetches.length, 0);
});

test("choosing Saturday 11/7 filters the existing daily tape and total", () => {
  const box = load();
  const data = ledger();
  const before = JSON.stringify(data);
  box.module.exports._set(data);
  assert.equal(box.__pcsGoalHourly.dayPick(SAT, T), SAT);
  const html = box.module.exports.topHtml(box.module.exports.calc(T));
  assert.match(html, /data-day="2026-11-07"/);
  assert.match(html, /DAILY TOTAL[^<]*Sat 11\/7/);
  assert.match(html, /class="total">\$45\.00</);
  assert.match(html, /id="gl-day-tape"/);
  assert.match(html, /\+\$40\.00/);
  assert.match(html, /\+\$5\.00/);
  assert.doesNotMatch(html, /\+\$99\.00/);
  assert.doesNotMatch(html, /\+\$3\.00/);
  assert.doesNotMatch(html, /\+\$7\.00/);
  assert.equal(html.match(/id="gl-day-tape"/g).length, 1);
  assert.equal(box.__fetches.length, 0);
  assert.equal(JSON.stringify(box.module.exports._get()), before);
});

test("an empty past day uses the same details section and shows no rides", () => {
  const box = load();
  box.module.exports._set(ledger());
  assert.equal(box.__pcsGoalHourly.dayPick(EMPTY, T), EMPTY);
  const html = box.module.exports.topHtml(box.module.exports.calc(T));
  assert.match(html, /data-day="2026-09-15"/);
  assert.match(html, /class="total">\$0\.00</);
  assert.doesNotMatch(html, /id="gl-day-tape"/);
  assert.equal(box.__writes.length, 0);
});

test("no selection keeps today's tape, and the manual past-entry date field stays", () => {
  const box = load();
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  box.module.exports._set(ledger());
  assert.equal(box.__pcsGoalHourly.dayPick("", T), "");
  const html = box.module.exports.topHtml(box.module.exports.calc(T));
  assert.match(html, /class="card day" data-day="2026-11-08"/);
  assert.match(html, /\+\$3\.00/);
  assert.doesNotMatch(html, /\+\$40\.00/);
  assert.match(src, /id="gl-a-date" type="date"/);
  assert.match(src, /D\.entries\[newId\(at\)\] = \{ date: today\(\)/);
  assert.equal(box.__pcsGoalHourly.dayPick(SAT, T), SAT);
  assert.equal(box.__pcsGoalHourly.dayPick(SAT, T), "");
});

test("date buttons are real buttons so touch and keyboard can activate them", () => {
  const box = load();
  box.module.exports._set(ledger());
  const html = box.__pcsGoalHourly.pastDaysHtml(T);
  assert.match(html, /<button type="button" class="gl-pastday" data-day="2026-11-07" aria-pressed="false">Sat 11\/7<\/button>/);
  box.__pcsGoalHourly.dayPick(SAT, T);
  const on = box.__pcsGoalHourly.pastDaysHtml(T);
  assert.match(on, /data-day="2026-11-07" aria-pressed="true"/);
  assert.match(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), /box.onkeydown = function \(e\)/);
});
