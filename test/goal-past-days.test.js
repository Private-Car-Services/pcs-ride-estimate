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
  assert.match(src, /#gl-screen #gl-past \.gl-past-scroll\{max-height:248px;overflow-y:auto/);
  assert.doesNotMatch(fn, /slice\(0, 7\)/);
  assert.doesNotMatch(fn, /addDays\(t, -7\)/);
  box.module.exports._set(ledger());
  const html = box.__pcsGoalHourly.pastDaysHtml(T);
  assert.match(html, /id="gl-past"/);
  assert.match(html, /<div id="gl-past"[^>]*>\s*<button type="button" class="btn" id="gl-b-return-today">Return to today<\/button><div class="gl-past-scroll" data-view-rows="7">/);
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

test("the shift fetch and the minute refresh keep Saturday's hourly line", async () => {
  const box = load();
  let paints = 0;
  const slot = { _html: "", set innerHTML(v) { this._html = v; paints += 1; }, get innerHTML() { return this._html; } };
  box.document.getElementById = function (id) { return id === "gl-hr" ? slot : null; };
  box.module.exports._set(ledger());
  let release;
  const gate = new Promise(function (resolve) { release = resolve; });
  box.fetch = function () {
    box.__fetches.push("fetch");
    return gate.then(function () { return { ok: true, json: function () { return Promise.resolve({ shiftStartAt: Date.now() - 3 * 3600000, shiftClosed: false }); } }; });
  };
  box.__pcsGoalHourly.hrPaint();
  assert.ok(box.__fetches.length >= 1);
  assert.match(slot.innerHTML, /first entry|Starts with/);
  assert.equal(box.__pcsGoalHourly.dayPick(SAT, T), SAT);
  const page = box.module.exports.topHtml(box.module.exports.calc(T));
  assert.match(page, /DAILY TOTAL[^<]*Sat 11\/7/);
  assert.match(page, /class="total">\$45\.00</);
  assert.match(page, /\+\$40\.00/);
  assert.match(page, /\+\$5\.00/);
  const duringFetch = box.__fetches.length;
  box.__pcsGoalHourly.hrPaint();
  assert.match(slot.innerHTML, /\$22\.50\/hr \u00b7 2h 0m on shift/);
  assert.doesNotMatch(slot.innerHTML, /first entry|Starts with/);
  assert.equal(box.__fetches.length, duringFetch);
  release();
  await gate;
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.ok(paints >= 3, "the shift fetch called the hourly refresh");
  assert.match(slot.innerHTML, /\$22\.50\/hr \u00b7 2h 0m on shift/);
  assert.doesNotMatch(slot.innerHTML, /first entry|Starts with/);
  const fetches = box.__fetches.length;
  box.__pcsGoalHourly.hrPaint();
  assert.match(slot.innerHTML, /\$22\.50\/hr \u00b7 2h 0m on shift/);
  assert.equal(box.__fetches.length, fetches);
  const still = box.module.exports.topHtml(box.module.exports.calc(T));
  assert.match(still, /Sat 11\/7/);
  assert.match(still, /\$45\.00/);
  assert.match(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), /D\.entries\[newId\(at\)\] = \{ date: today\(\)/);
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

function openLedger() {
  const data = ledger();
  data.settings = { fix76j: 1, daySnap: { date: T, goal: 1, weekly: 1, weekBeforeToday: 0, daysLeft: 1, sunWork: false, typed: false, at: 1, recalc: false } };
  return data;
}

function loadPanel() {
  const nodes = {};
  const voidTags = { input: 1, br: 1, img: 1, hr: 1, meta: 1, link: 1 };
  function matchSimple(node, part) {
    if (!node || !node.tag) return false;
    const attrs = [];
    const re = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
    let am;
    while ((am = re.exec(part))) attrs.push(am);
    const rest = part.replace(/\[[^\]]*\]/g, "");
    if (rest.charAt(0) === "#") { if (node.id !== rest.slice(1)) return false; }
    else if (rest.charAt(0) === ".") { if ((" " + (node.className || "") + " ").indexOf(" " + rest.slice(1) + " ") < 0) return false; }
    else if (rest && node.tag !== rest) return false;
    for (let i = 0; i < attrs.length; i++) {
      const v = node.getAttribute(attrs[i][1]);
      if (attrs[i][2] == null) { if (v == null) return false; }
      else if (v !== attrs[i][2]) return false;
    }
    return true;
  }
  function matchesChain(node, parts) {
    if (!matchSimple(node, parts[parts.length - 1])) return false;
    let i = parts.length - 2, p = node.parentNode;
    while (i >= 0) {
      while (p && !matchSimple(p, parts[i])) p = p.parentNode;
      if (!p) return false;
      i -= 1; p = p.parentNode;
    }
    return true;
  }
  function allUnder(root, out) {
    (root.children || []).forEach(function (n) { out.push(n); allUnder(n, out); });
    return out;
  }
  function queryAll(sel, root) {
    const roots = !root || root === doc ? [doc.body, doc.head] : [root];
    const out = [];
    String(sel || "").split(",").forEach(function (group) {
      const parts = group.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return;
      roots.forEach(function (scope) {
        allUnder(scope, []).forEach(function (n) { if (matchesChain(n, parts)) out.push(n); });
      });
    });
    return out;
  }
  function el(tag) {
    const node = {
      tag: tag, style: {}, className: "", attrs: {}, children: [], parentNode: null, value: "",
      type: tag === "button" ? "button" : "text", textContent: "", readOnly: false, disabled: false, scrollTop: 0,
      onclick: null, onpointerup: null, ontouchend: null, onkeydown: null, onsubmit: null, oninput: null, onchange: null, ontoggle: null,
      classList: { add(c) { node.className += " " + c; }, remove() {}, toggle(c, on) { if (on) node.className += " " + c; }, contains() { return false; } },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) nodes[c.id] = c; return c; },
      addEventListener(type, fn) { this._l = this._l || {}; (this._l[type] = this._l[type] || []).push(fn); },
      querySelector(sel) { return queryAll(sel, this)[0] || null; },
      querySelectorAll(sel) { return queryAll(sel, this); },
      closest(sel) { let n = this; while (n) { if (matchSimple(n, sel)) return n; n = n.parentNode; } return null; },
      contains(n) { let x = n; while (x) { if (x === this) return true; x = x.parentNode; } return false; },
      focus() {}, blur() {}, setSelectionRange() {}, scrollIntoView() {},
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(function (c) { return c !== this; }, this); if (nodes[this.id] === this) delete nodes[this.id]; },
      getBoundingClientRect() { return { top: 0, bottom: 20, left: 0, right: 80, width: 80, height: 20 }; }
    };
    Object.defineProperty(node, "id", { get() { return node._id || ""; }, set(v) { if (node._id && nodes[node._id] === node) delete nodes[node._id]; node._id = String(v || ""); if (node._id) nodes[node._id] = node; } });
    Object.defineProperty(node, "innerHTML", { set(html) { parseInto(node, html); }, get() { return node._html || ""; } });
    return node;
  }
  function parseInto(root, html) {
    root._html = String(html);
    root.children = [];
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)([^>]*)>/g;
    let m;
    while ((m = re.exec(html))) {
      if (m[0].charAt(1) === "!") continue;
      if (m[0].charAt(1) === "/") {
        const name = m[1].toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === name) { stack.length = i; break; }
        continue;
      }
      const tag = m[2].toLowerCase();
      const node = el(tag);
      const attrs = m[3] || "";
      const ar = /([:@a-zA-Z0-9_-]+)(?:\s*=\s*"([^"]*)")?/g;
      let am;
      while ((am = ar.exec(attrs))) {
        const key = am[1].toLowerCase();
        if (key === "/") continue;
        const val = am[2] == null ? "" : am[2];
        if (key === "id") node.id = val;
        else if (key === "class") node.className = val;
        else if (key === "type") node.type = val;
        if (key !== "id") node.setAttribute(key, val);
      }
      stack[stack.length - 1].children.push(node);
      node.parentNode = stack[stack.length - 1];
      if (!voidTags[tag] && !/\/\s*$/.test(attrs)) stack.push(node);
    }
  }
  const doc = {
    readyState: "complete", hidden: false, visibilityState: "visible", activeElement: null,
    addEventListener() {},
    createElement: el,
    getElementById(id) { return nodes[id] || null; },
    querySelector(sel) { return queryAll(sel, null)[0] || null; },
    querySelectorAll(sel) { return queryAll(sel, null); }
  };
  doc.body = el("body");
  doc.head = el("head");
  const writes = [];
  const fetches = [];
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, Promise, RegExp, Error, parseInt, isNaN, isFinite, Uint8Array,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    alert() {}, confirm() { return false; },
    localStorage: { getItem() { return null; }, setItem() { writes.push("ls"); }, removeItem() {} },
    location: { search: "", hostname: "localhost", href: "http://localhost/god/" },
    indexedDB: { open() { return {}; } },
    crypto: { getRandomValues(a) { a.fill(1); return a; }, subtle: {} },
    TextEncoder: class { encode(s) { return Buffer.from(String(s)); } },
    TextDecoder: class { decode() { return "{}"; } },
    atob, btoa,
    fetch() { fetches.push("fetch"); return Promise.resolve({ ok: false, json() { return Promise.resolve(null); } }); },
    document: doc,
    module: { exports: {} },
    Event: function Event(type) { this.type = type; }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), sandbox, { filename: "goal.js" });
  sandbox.__writes = writes;
  sandbox.__fetches = fetches;
  sandbox.document = doc;
  return sandbox;
}

function panelHtml(box) {
  const app = box.document.getElementById("gl-app");
  return app ? app.innerHTML : "";
}

function shown(box) {
  const html = panelHtml(box);
  const hour = (box.document.getElementById("gl-hr") || {}).innerHTML || "";
  return html + "\n" + hour;
}

test("Return to today sits at the upper left of the date box and the 7-row window still scrolls", () => {
  const box = load();
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  box.module.exports._set(ledger());
  const html = box.__pcsGoalHourly.pastDaysHtml(T);
  const past = html.indexOf('id="gl-past"');
  const button = html.indexOf('id="gl-b-return-today"');
  const scroll = html.indexOf('class="gl-past-scroll"');
  assert.ok(past >= 0 && button > past && scroll > button, "the control is inside the date box, above the scrolling dates");
  assert.match(html, />Return to today</);
  assert.doesNotMatch(html.slice(scroll), /id="gl-b-return-today"/);
  assert.match(src, /#gl-screen #gl-past \.gl-past-scroll\{max-height:248px;overflow-y:auto;-webkit-overflow-scrolling:touch/);
  assert.doesNotMatch(src, /#gl-screen #gl-past\{max-height:248px/);
  assert.ok((html.match(/data-day="/g) || []).length > 7);
});

test("a click or a touch on Return to today restores today's total, tape, and hourly line", () => {
  const box = loadPanel();
  const before = JSON.stringify(openLedger());
  box.__pcsGoalOpen();
  box.module.exports._set(openLedger());
  box.module.exports._setApp(box.document.getElementById("gl-app"));
  box.__pcsGoalHourly.dayPick(SAT, T);
  box.module.exports.paint();
  assert.match(shown(box), /DAILY TOTAL[^<]*Sat 11\/7/);
  assert.match(shown(box), /class="total">\$45\.00</);
  assert.match(shown(box), /\+\$40\.00/);
  assert.match(shown(box), /\+\$5\.00/);
  assert.match(shown(box), /\$22\.50\/hr/);
  box.module.exports.paint();
  box.__pcsGoalHourly.hrPaint();
  assert.match(shown(box), /Sat 11\/7/);
  assert.match(shown(box), /\$22\.50\/hr/);
  const touched = box.document.getElementById("gl-b-return-today");
  touched.onpointerup({ button: 0, pointerType: "touch" });
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.match(shown(box), /class="total">\$3\.00</);
  assert.match(shown(box), /\+\$3\.00/);
  assert.doesNotMatch(shown(box), /\+\$40\.00/);
  assert.doesNotMatch(shown(box), /\$22\.50\/hr/);
  assert.match(shown(box), /id="gl-f-q"/);
  box.__pcsGoalHourly.dayPick(SAT, T);
  box.module.exports.paint();
  box.document.getElementById("gl-b-return-today").onclick({ button: 0 });
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.match(shown(box), /\+\$3\.00/);
  assert.doesNotMatch(shown(box), /\+\$40\.00/);
  box.document.getElementById("gl-b-return-today").onclick({ button: 0 });
  box.document.getElementById("gl-b-return-today").ontouchend({ button: 0 });
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.match(shown(box), /class="total">\$3\.00</);
  assert.equal(JSON.stringify(box.module.exports._get().entries), JSON.parse(before).entries && JSON.stringify(JSON.parse(before).entries));
  assert.equal(box.__writes.length, 0);
});

test("after the shift fetch and the minute refresh, Return to today stays on today", async () => {
  const box = loadPanel();
  box.__pcsGoalOpen();
  box.module.exports._set(openLedger());
  box.module.exports._setApp(box.document.getElementById("gl-app"));
  let release;
  const gate = new Promise(function (resolve) { release = resolve; });
  box.fetch = function () {
    box.__fetches.push("fetch");
    return gate.then(function () { return { ok: true, json: function () { return Promise.resolve({ shiftStartAt: Date.now() - 3 * 3600000, shiftClosed: false }); } }; });
  };
  box.__pcsGoalHourly.dayPick(SAT, T);
  box.module.exports.paint();
  box.document.getElementById("gl-b-return-today").onpointerup({ button: 0, pointerType: "touch" });
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.doesNotMatch(shown(box), /\$22\.50\/hr/);
  const during = box.__fetches.length;
  box.__pcsGoalHourly.hrPaint();
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.doesNotMatch(box.document.getElementById("gl-hr").innerHTML, /\$22\.50\/hr/);
  release();
  await gate;
  for (let i = 0; i < 12; i++) await Promise.resolve();
  box.__pcsGoalHourly.hrPaint();
  assert.ok(box.__fetches.length >= during);
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.match(shown(box), /\+\$3\.00/);
  assert.doesNotMatch(shown(box), /\+\$40\.00/);
  assert.doesNotMatch(box.document.getElementById("gl-hr").innerHTML, /\$22\.50\/hr · 2h 0m on shift/);
});

test("an empty today returns to a zero total with no ride tape", () => {
  const box = loadPanel();
  const data = openLedger();
  delete data.entries.today;
  box.__pcsGoalOpen();
  box.module.exports._set(data);
  box.module.exports._setApp(box.document.getElementById("gl-app"));
  box.__pcsGoalHourly.dayPick(SAT, T);
  box.module.exports.paint();
  box.document.getElementById("gl-b-return-today").onclick({});
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.match(shown(box), /class="total">\$0\.00</);
  assert.doesNotMatch(shown(box), /id="gl-day-tape"/);
  assert.doesNotMatch(shown(box), /\+\$40\.00/);
  assert.equal(box.__writes.length, 0);
});

test("choosing a past day keeps the date list's scroll position", () => {
  const box = loadPanel();
  box.__pcsGoalOpen();
  box.module.exports._set(openLedger());
  box.module.exports._setApp(box.document.getElementById("gl-app"));
  box.module.exports.paint();
  const scroller = box.document.querySelector("#gl-past .gl-past-scroll");
  scroller.scrollTop = 96;
  const sat = box.document.querySelector('#gl-past [data-day="2026-11-07"]');
  sat.onclick();
  const next = box.document.querySelector("#gl-past .gl-past-scroll");
  assert.equal(next.scrollTop, 96);
  assert.match(shown(box), /Sat 11\/7/);
  assert.match(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), /gl-past-scroll\{max-height:248px;overflow-y:auto/);
});

test("closing the goal panel and opening it again starts on today's total, tape, and hourly line", () => {
  const box = loadPanel();
  const data = openLedger();
  const entries = JSON.stringify(data.entries);
  box.__pcsGoalOpen();
  box.module.exports._set(data);
  box.module.exports._setApp(box.document.getElementById("gl-app"));
  box.__pcsGoalHourly.dayPick(SAT, T);
  box.module.exports.paint();
  assert.match(shown(box), /\$45\.00/);
  assert.match(shown(box), /\+\$40\.00/);
  assert.match(shown(box), /\$22\.50\/hr/);
  box.document.getElementById("gl-close").onclick();
  assert.equal(box.document.getElementById("gl-screen"), null);
  box.__pcsGoalOpen();
  const again = openLedger();
  box.module.exports._set(again);
  box.module.exports._setApp(box.document.getElementById("gl-app"));
  box.module.exports.paint();
  assert.match(shown(box), /data-day="2026-11-08"/);
  assert.match(shown(box), /class="total">\$3\.00</);
  assert.match(shown(box), /\+\$3\.00/);
  assert.doesNotMatch(shown(box), /\+\$40\.00/);
  assert.doesNotMatch(shown(box), /\$22\.50\/hr/);
  assert.match(shown(box), /aria-pressed="false"/);
  assert.equal(JSON.stringify(again.entries), entries);
  assert.equal(box.__writes.length, 0);
  const fresh = load();
  fresh.module.exports._set(openLedger());
  const html = fresh.module.exports.topHtml(fresh.module.exports.calc(T));
  assert.match(html, /data-day="2026-11-08"/);
  assert.doesNotMatch(html, /\+\$40\.00/);
});
