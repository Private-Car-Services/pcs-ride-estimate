/* Daily history map: stored ride type, colors, tap/list agreement, basemap, other maps left on live traffic. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const root = path.join(__dirname, "..");

function loadScript(rel, extra) {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    encodeURIComponent: encodeURIComponent, Number: Number, String: String, Object: Object, Array: Array,
    isFinite: isFinite, parseInt: parseInt, RegExp: RegExp, Error: Error, CustomEvent: function CustomEvent() {},
    document: {
      readyState: "complete",
      currentScript: { src: "https://pcs.example/version.js?v=1" },
      getElementById: function () { return null; },
      addEventListener: function () {},
      createElement: function () { return { style: {}, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {} }; },
      body: { appendChild: function () {} },
      head: { appendChild: function () {} },
      documentElement: { appendChild: function () {} }
    },
    location: { search: "", hostname: "pcs.example", href: "https://pcs.example/driver/" },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(""); } }); },
    navigator: { userAgent: "test" },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  Object.keys(extra || {}).forEach(function (k) { sandbox[k] = extra[k]; });
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), sandbox, { filename: rel });
  return sandbox;
}

function widths(expr) {
  const out = [];
  if (!Array.isArray(expr)) return out;
  if (expr[0] === "interpolate") {
    for (let i = 4; i < expr.length; i += 2) if (typeof expr[i] === "number") out.push(expr[i]);
  }
  return out;
}

test("stored types canon and never invent PCS or Other", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  assert.equal(DL.rideTypeCanon("PCS"), "PCS");
  assert.equal(DL.rideTypeCanon(" pcs "), "PCS");
  assert.equal(DL.rideTypeCanon("uber"), "Uber");
  assert.equal(DL.rideTypeCanon("Lyft"), "Lyft");
  assert.equal(DL.rideTypeCanon("Other"), "Other");
  assert.equal(DL.rideTypeCanon(""), "");
  assert.equal(DL.rideTypeCanon("green"), "");
  assert.equal(DL.rideTypeCanon(null), "");
  assert.equal(DL.rideDisplay(""), "On a ride");
  assert.equal(DL.rideDisplay("green"), "green");
  assert.equal(DL.rideDisplay("pcs"), "PCS");
});

test("assigned PCS records itself; an open PCS segment is not started again", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  assert.equal(DL.pcsAutoRecord(true, null), true);
  assert.equal(DL.pcsAutoRecord(true, { type: "Uber" }), true);
  assert.equal(DL.pcsAutoRecord(true, { type: "Lyft" }), true);
  assert.equal(DL.pcsAutoRecord(true, { type: "" }), true);
  assert.equal(DL.pcsAutoRecord(true, { type: "PCS" }), false);
  assert.equal(DL.pcsAutoRecord(true, { type: "pcs" }), false);
  assert.equal(DL.pcsAutoRecord(true, { type: "PCS", end: 50 }), true);
  assert.equal(DL.pcsAutoRecord(false, null), false);
  assert.equal(DL.pcsAutoRecord(false, { type: "Uber" }), false);
});

test("a manual segment stays open only while that choice is on, and a live assigned PCS ride stays open through break and en route", function () {
  const stay = loadScript("app/driverlog.js").PCSDriverLog.rideSegmentStaysOpen;
  assert.equal(stay({ sameDay: true, manualBusy: true }), true);
  assert.equal(stay({ sameDay: true, autoBusy: true }), false);
  assert.equal(stay({ sameDay: true }), false);
  assert.equal(stay({ sameDay: true, manualBusy: true, onBreak: true }), false);
  assert.equal(stay({ sameDay: true, manualBusy: true, offline: true }), false);
  assert.equal(stay({ sameDay: false, manualBusy: true }), false);
  assert.equal(stay({ sameDay: true, manualBusy: true, force: true }), false);
  assert.equal(stay({ sameDay: true, assigned: true, autoLive: true, onBreak: true, offline: true, manualBusy: false }), true);
  assert.equal(stay({ sameDay: true, assigned: true, autoLive: false, manualBusy: true, autoBusy: true }), false);
});

test("legacy untagged green tracks are not classified PCS", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const t0 = 1_700_000_000_000;
  const pts = [];
  for (let i = 0; i < 6; i++) pts.push({ t: t0 + i * 60000, lat: 30.42 + i * 0.001, lng: -95.48, s: "r" });
  const runs = DL.trkDisplayRuns(pts, []);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].type, "");
  assert.equal(runs[0].ride, null);
  assert.equal(DL.runColor(runs[0]), "#1f9d3a");
  assert.ok(DL.runLabel(runs[0], function () { return "t"; }).indexOf("On a ride") === 0);
  assert.equal(DL.runLabel(runs[0], function () { return "t"; }).indexOf("PCS"), -1);
  const unknown = DL.trkDisplayRuns(pts, [{ type: "green", start: t0, end: t0 + 400000, miles: 1 }]);
  assert.equal(unknown[0].type, "");
  assert.equal(DL.runColor(unknown[0]), "#1f9d3a");
  assert.ok(DL.runLabel(unknown[0], function () { return "t"; }).indexOf("green") === 0);
  assert.equal(DL.runLabel(unknown[0], function () { return "t"; }).indexOf("PCS"), -1);
});

test("PCS is blue, Uber and Lyft are green, Other is neither, and list labels match tap labels", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const t0 = 1_700_000_000_000;
  const spec = [
    ["a", 0, 4, null],
    ["r", 4, 8, { type: "PCS", miles: 1.5 }],
    ["r", 8, 12, { type: "Uber", miles: 0.7 }],
    ["r", 12, 16, { type: "lyft", miles: 0.4 }],
    ["r", 16, 20, { type: "Other", miles: 0.2 }],
    ["b", 20, 22, null],
    ["o", 22, 26, null]
  ];
  const pts = [];
  const rides = [];
  spec.forEach(function (row) {
    const s = row[0], a = row[1], b = row[2], ride = row[3];
    if (ride) rides.push({ type: ride.type, start: t0 + a * 60000, end: t0 + (b - 1) * 60000, minutes: (b - a) , miles: ride.miles });
    for (let i = a; i < b; i++) pts.push({ t: t0 + i * 60000, lat: 30.42 + i * 0.0008, lng: -95.48 - i * 0.0005, s: s });
  });
  const runs = DL.trkDisplayRuns(pts, rides);
  const seen = {};
  runs.forEach(function (r) { r.pts.forEach(function (p) { assert.ok(pts.indexOf(p) >= 0); }); if (r.type) seen[r.type] = DL.runColor(r); });
  assert.equal(seen.PCS, "#1e63d6");
  assert.equal(seen.Uber, "#1f9d3a");
  assert.equal(seen.Lyft, "#1f9d3a");
  assert.equal(seen.Other, "#c27a12");
  assert.notEqual(seen.Other, seen.PCS);
  assert.notEqual(seen.Other, seen.Uber);
  const fmt = function () { return "t"; };
  const tap = runs.filter(function (r) { return r.ride; }).map(function (r) { return DL.runLabel(r, fmt).split(" \u00b7 ")[0]; });
  const listHtml = DL.ridesHtml({ now: t0 + 30 * 60000, rides: rides });
  const list = Array.from(listHtml.matchAll(/<b>([^<]+)<\/b>/g)).map(function (m) { return m[1]; });
  assert.deepEqual(tap, ["PCS", "Uber", "Lyft", "Other"]);
  assert.deepEqual(list, ["PCS", "Uber", "Lyft", "Other"]);
  assert.equal((listHtml.match(/<b>PCS<\/b>/g) || []).length, 1);
  const statuses = runs.map(function (r) { return r.s; });
  assert.ok(statuses.indexOf("a") >= 0 && statuses.indexOf("b") >= 0 && statuses.indexOf("o") >= 0);
  const br = runs.filter(function (r) { return r.s === "b"; })[0];
  const off = runs.filter(function (r) { return r.s === "o"; })[0];
  assert.equal(DL.runColor(br), "#e0b000");
  assert.equal(DL.runColor(off), "#8a8a8a");
  assert.ok(DL.runLabel(br, fmt).indexOf("Break") === 0);
  assert.ok(DL.runLabel(off, fmt).indexOf("Off duty / en route") === 0);
  const geo = DL.trackGeo(runs);
  const pcsLine = geo.lines.features.filter(function (f) { return String(f.properties.label).indexOf("PCS") === 0; });
  const availLine = geo.lines.features.filter(function (f) { return String(f.properties.label).indexOf("Available") === 0; });
  assert.equal(pcsLine.length, 1);
  assert.equal(pcsLine[0].properties.color, "#1e63d6");
  assert.equal(availLine.length, 1);
  assert.equal(availLine[0].properties.color, "#1e63d6");
  assert.ok(geo.lines.features.every(function (f) { return f.geometry.coordinates.length >= 2; }));
  assert.equal(geo.breaks.features.length, 1);
});

test("history basemap is near-white, thin black roads, named streets, street zoom, and no traffic", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const spec = DL.historyMapSpec();
  const style = DL.historyMapStyle();
  const layers = DL.trackLayers();
  assert.equal(spec.traffic, false);
  assert.equal(spec.maxZoom, 19);
  assert.ok(spec.maxZoom >= 18);
  assert.equal(spec.background, "#fbfbfb");
  assert.equal(spec.tripPx, 6);
  assert.equal(spec.underlayPx, 8);
  assert.equal(spec.underlayColor, "#ffffff");
  assert.ok(spec.tiles.indexOf("openfreemap.org") >= 0);
  assert.equal(JSON.stringify(style).indexOf("traffic"), -1);
  assert.equal(JSON.stringify(style).indexOf("openstreetmap.org"), -1);
  assert.equal(JSON.stringify(style).indexOf("/maps/tile/"), -1);
  assert.equal(style.layers[0].paint["background-color"], "#fbfbfb");
  const roads = style.layers.filter(function (l) { return l.id.indexOf("road-") === 0 && l.type === "line"; });
  assert.ok(roads.length >= 2);
  roads.forEach(function (l) {
    assert.equal(l.paint["line-color"], "#111111");
    widths(l.paint["line-width"]).forEach(function (w) { assert.ok(w <= spec.roadMaxPx, "road px " + w); });
  });
  const names = style.layers.filter(function (l) { return l["source-layer"] === "transportation_name"; })[0];
  assert.ok(names);
  assert.ok(names.minzoom <= 15);
  assert.equal(names.paint["text-color"], "#222222");
  assert.equal(layers[0].paint["line-width"], 8);
  assert.equal(layers[1].paint["line-width"], 6);
  assert.equal(layers[1].paint["line-color"][0], "get");
  const html = DL.mapHtml({ track: { t0: 0, pts: [[0, 3042000, -9548000, "a"]], personal: false, canToggle: false } });
  var legend = html.split('class="dl-legend"')[1].split("</p>")[0];
  assert.ok(legend.indexOf("PCS") >= 0 && legend.indexOf("PCS") < legend.indexOf("Available"));
  assert.ok(legend.indexOf("Uber/Lyft") >= 0);
  assert.ok(legend.indexOf("Other") >= 0);
  assert.ok(legend.indexOf("Available") >= 0);
  assert.ok(legend.indexOf("Break") >= 0);
  assert.ok(legend.indexOf("Off duty / en route") >= 0);
  assert.equal(legend.indexOf("On a ride"), -1);
  assert.ok(legend.indexOf(DL.historyMapSpec().colors.PCS) >= 0);
  assert.ok(legend.indexOf(DL.historyMapSpec().colors.Uber) >= 0);
  assert.ok(html.indexOf("Off duty / en route") >= 0);
  assert.ok(html.indexOf("openstreetmap.org") < 0);
  assert.ok(html.indexOf("live traffic") < 0);
});

test("manual Uber, Lyft, or Other then assigned PCS then end does not keep later points as PCS", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  ["Uber", "Lyft", "Other"].forEach(function (manual) {
    const t0 = 1_700_000_000_000;
    const tSwitch = t0 + 5 * 60000;
    const tEnd = t0 + 10 * 60000;
    const tLater = t0 + 14 * 60000;
    let list = [{ type: manual, start: t0, startMiles: 0 }];
    assert.equal(DL.rideSegmentStaysOpen({ sameDay: true, manualBusy: true, assigned: false, type: manual, autoLive: false }), true);
    list = DL.foldRideSegments(list, { manualBusy: true, autoBusy: true, autoLive: true, rideId: "ride:pcs-1", sameDay: true, miles: 1.2 }, tSwitch);
    assert.equal(list.length, 2);
    assert.equal(list[0].type, manual);
    assert.equal(list[0].end, tSwitch);
    assert.equal(list[1].type, "PCS");
    assert.equal(list[1].assigned, true);
    assert.equal(list[1].rideId, "ride:pcs-1");
    assert.ok(!list[1].end);
    list = DL.foldRideSegments(list, { manualBusy: true, autoBusy: false, autoLive: false, rideId: "", sameDay: true, miles: 2.4 }, tEnd);
    assert.equal(list.length, 2);
    assert.equal(list[1].end, tEnd);
    assert.equal(list[1].type, "PCS");
    const staleBusy = DL.foldRideSegments(list, { manualBusy: true, autoBusy: true, autoLive: false, rideId: "", sameDay: true, miles: 3 }, tLater);
    assert.equal(staleBusy.length, 2);
    assert.equal(staleBusy[1].end, tEnd);
    const staleSame = DL.foldRideSegments(list, { manualBusy: true, autoBusy: true, autoLive: true, rideId: "ride:pcs-1", sameDay: true, miles: 3 }, tLater);
    assert.equal(staleSame.length, 2);
    assert.ok(staleSame[1].end);
    const again = DL.foldRideSegments(list, { manualBusy: false, autoBusy: true, autoLive: true, rideId: "ride:pcs-2", sameDay: true, miles: 4 }, tLater);
    assert.equal(again.length, 3);
    assert.equal(again[2].type, "PCS");
    assert.equal(again[2].rideId, "ride:pcs-2");
    assert.ok(!again[2].end);
    const pts = [];
    for (let i = 0; i < 8; i++) pts.push({ t: t0 + i * 60000, lat: 30.42 + i * 0.001, lng: -95.48 - i * 0.001, s: "r" });
    pts.push({ t: tLater, lat: 30.43, lng: -95.49, s: "r" });
    const during = DL.trkDisplayRuns(pts.filter(function (p) { return p.t >= tSwitch && p.t <= tEnd; }), list);
    during.forEach(function (r) {
      assert.equal(r.type, "PCS");
      assert.equal(DL.runColor(r), "#1e63d6");
      assert.ok(DL.runLabel(r, function () { return "t"; }).indexOf("PCS") === 0);
    });
    const after = DL.trkDisplayRuns(pts.filter(function (p) { return p.t > tEnd; }), list);
    assert.equal(after.length, 1);
    assert.equal(after[0].type, "");
    assert.equal(after[0].ride, null);
    assert.equal(DL.runColor(after[0]), "#1f9d3a");
    assert.equal(DL.runLabel(after[0], function () { return "t"; }).indexOf("PCS"), -1);
    const listed = Array.from(DL.ridesHtml({ now: tLater, rides: list }).matchAll(/<b>([^<]+)<\/b>/g)).map(function (m) { return m[1]; });
    assert.deepEqual(listed, [manual, "PCS"]);
  });
  const DL2 = loadScript("app/driverlog.js").PCSDriverLog;
  const manualPcs = [{ type: "PCS", start: 10, startMiles: 0 }];
  const kept = DL2.foldRideSegments(manualPcs, { manualBusy: true, autoBusy: false, autoLive: false, rideId: "", sameDay: true, miles: 1 }, 20);
  assert.equal(kept.length, 1);
  assert.ok(!kept[0].end);
  assert.equal(DL2.rideSegmentStaysOpen({ sameDay: true, assigned: true, manualBusy: true, autoBusy: true, autoLive: false, type: "PCS" }), false);
});


test("Available closes an open Uber timer and does not invent PCS; a live PCS ride splits Uber then closes", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const t0 = 1700000000000;
  const tPcs = t0 + 60000;
  const tEnd = t0 + 120000;
  const avail = DL.foldRideSegments(
    [{ type: "Uber", start: t0, startMiles: 0 }],
    { manualBusy: false, autoBusy: true, autoLive: false, rideId: "", onBreak: false, offline: false, sameDay: true, miles: 1 },
    tPcs
  );
  assert.equal(avail.length, 1);
  assert.equal(avail[0].type, "Uber");
  assert.equal(avail[0].end, tPcs);
  assert.equal(avail.some(function (s) { return s.type === "PCS"; }), false);
  ["break", "offline", "available"].forEach(function (mode) {
    const started = DL.foldRideSegments(
      [{ type: "Uber", start: t0, startMiles: 0 }],
      { manualBusy: mode === "available" ? false : true, autoBusy: false, autoLive: true, rideId: "meter:723TJGU8", sameDay: true, miles: 2, onBreak: mode === "break", offline: mode === "offline" },
      tPcs
    );
    assert.equal(started[0].type, "Uber");
    assert.equal(started[0].end, tPcs);
    assert.equal(started[1].type, "PCS");
    assert.equal(started[1].assigned, true);
    assert.equal(started[1].rideId, "meter:723TJGU8");
    assert.ok(!started[1].end);
    const done = DL.foldRideSegments(started, { manualBusy: true, autoBusy: true, autoLive: false, rideId: "", onBreak: false, offline: false, sameDay: true, miles: 3 }, tEnd);
    assert.equal(done.length, 2);
    assert.equal(done[1].end, tEnd);
    assert.equal(done.filter(function (s) { return !s.end; }).length, 0);
  });
  const pts = [
    { t: tPcs, lat: 30.1, lng: -95.1, s: "b" },
    { t: tPcs + 1000, lat: 30.2, lng: -95.2, s: "o" },
    { t: tPcs + 2000, lat: 30.3, lng: -95.3, s: "r" }
  ];
  const runs = DL.trkDisplayRuns(pts, [{ type: "PCS", start: tPcs, end: tEnd, assigned: true, rideId: "meter:723TJGU8" }]);
  const by = {};
  runs.forEach(function (r) { by[r.s] = r; });
  assert.equal(by.b.type, "");
  assert.equal(DL.runColor(by.b), "#e0b000");
  assert.equal(by.o.type, "");
  assert.equal(DL.runColor(by.o), "#8a8a8a");
  assert.equal(by.r.type, "PCS");
  assert.equal(DL.runColor(by.r), "#1e63d6");
  const letter = DL.trackLetter;
  assert.equal(letter({ signedIn: true, assignedLive: true, onBreak: true, offline: true, shiftOpen: true, manualBusy: false }), "r");
  assert.equal(letter({ signedIn: true, assignedLive: false, onBreak: true, shiftOpen: true }), "b");
  assert.equal(letter({ signedIn: true, assignedLive: false, offline: true, shiftOpen: false }), "o");
  assert.equal(letter({ signedIn: true, assignedLive: false, shiftOpen: true }), "a");
});
test("God day view keeps a missing stored type blank and does not call it PCS", function () {
  const box = loadScript("app/driverlog.js");
  const god = loadScript("god/godmap.js");
  const rows = god.__pcsGodMap.ridesOf({ a: { type: "PCS", start: 10, end: 20, miles: 1 }, b: { start: 30, end: 40 }, c: { type: "Uber", start: 50 } });
  assert.deepEqual(rows.map(function (r) { return r.type; }), ["PCS", "", "Uber"]);
  const html = box.PCSDriverLog.ridesHtml({ now: 100, rides: rows });
  assert.ok(html.indexOf("<b>PCS</b>") >= 0);
  assert.ok(html.indexOf("<b>Uber</b>") >= 0);
  assert.ok(html.indexOf("<b>On a ride</b>") >= 0);
  assert.equal((html.match(/<b>PCS<\/b>/g) || []).length, 1);
});


test("v2.0m-ak is the update phones on v2.0m-ai will accept", function () {
  const box = loadScript("app/version.js");
  assert.equal(box.PCS_APP_VERSION, "v2.0m-ak");
  assert.ok(box.pcsVersionCmp("v2.0m-ak", "v2.0m-ai") >= 0);
  assert.ok(box.pcsVersionCmp("v2.0m-ak", "v2.0m-aj") >= 0);
  assert.notEqual(box.PCS_APP_VERSION, "v2.0m-ai");
  const pages = {
    "app/driver/index.html": ["../version.js?v=2.0m-ak", "../driverlog.js?v=2.0m-ad", "../app.js?v=2.0m-ak"],
    "app/index.html": ["version.js?v=2.0m-ak", "app.js?v=2.0m-ak"],
    "god/index.html": ["../app/version.js?v=2.0m-ak", "../app/driverlog.js?v=2.0m-ad", "./godmap.js?v=2.0m-ad", "./goal.js?v=2.0m-ak"]
  };
  Object.keys(pages).forEach(function (rel) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    pages[rel].forEach(function (src) { assert.ok(html.indexOf(src) >= 0, rel + " " + src); });
    assert.equal(html.indexOf("version.js?v=2.0m-ai"), -1, rel);
  });
  const driverSw = fs.readFileSync(path.join(root, "app/driver/sw-driver.js"), "utf8");
  const godSw = fs.readFileSync(path.join(root, "god/sw.js"), "utf8");
  assert.equal(driverSw.indexOf("caches"), -1);
  assert.ok(godSw.indexOf("No page caching") >= 0);
  assert.equal(godSw.indexOf("caches"), -1);
});
test("live navigation maps still swap to Google traffic; the history style does not", function () {
  const calls = [];
  const L = { tileLayer: function (url, opts) { calls.push(url); return { url: url, opts: opts || {}, on: function () { return this; }, setUrl: function () {} }; } };
  const box = loadScript("app/version.js", { L: L });
  box.L = L;
  const live = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
  assert.equal(live.url, box.PCSMaps.googleUrl);
  assert.ok(String(live.opts.attribution).indexOf("live traffic") >= 0);
  const carto = L.tileLayer("https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {});
  assert.equal(carto.url, box.PCSMaps.googleUrl);
  const history = L.tileLayer("https://tiles.openfreemap.org/planet", { maxZoom: 19 });
  assert.equal(history.url, "https://tiles.openfreemap.org/planet");
  const app = fs.readFileSync(path.join(root, "app/app.js"), "utf8");
  const god = fs.readFileSync(path.join(root, "god/god.js"), "utf8");
  const follow = fs.readFileSync(path.join(root, "follow/follow-live.js"), "utf8");
  assert.ok(app.indexOf("https://tile.openstreetmap.org/{z}/{x}/{y}.png") >= 0);
  assert.ok(god.indexOf("https://tile.openstreetmap.org/{z}/{x}/{y}.png") >= 0);
  assert.ok(follow.indexOf("https://tile.openstreetmap.org/{z}/{x}/{y}.png") >= 0);
  assert.ok(app.indexOf("foldRideSegments") >= 0);
  assert.ok(app.indexOf("function assignedRideId()") >= 0);
  assert.ok(app.indexOf("M.status === \"running\"") >= 0);
  assert.equal(app.indexOf("pcsAutoRecord(!!qAutoBusy()"), -1);
  assert.ok(app.indexOf("rideSegmentStaysOpen") >= 0);
  const log = fs.readFileSync(path.join(root, "app/driverlog.js"), "utf8");
  assert.ok(log.indexOf("Off duty / en route") >= 0);
  assert.ok(log.indexOf("Close \\u2715") >= 0);
  assert.ok(log.indexOf("background:#2e7d32") >= 0);
});
