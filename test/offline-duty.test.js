/* Recorded Offline intervals stay off the driver's own log: map runs, online time, and owner miles corrections. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const root = path.join(__dirname, "..");

function loadScript(rel) {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    encodeURIComponent: encodeURIComponent, Number: Number, String: String, Object: Object, Array: Array,
    isFinite: isFinite, parseInt: parseInt, RegExp: RegExp, Error: Error, CustomEvent: function CustomEvent() {},
    document: {
      readyState: "complete", getElementById: function () { return null; }, addEventListener: function () {},
      createElement: function () { return { style: {}, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {} }; },
      body: { appendChild: function () {} }, head: { appendChild: function () {} }, documentElement: { appendChild: function () {} }
    },
    location: { search: "", hostname: "pcs.example", href: "https://pcs.example/driver/" },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function () { return Promise.resolve({ ok: false, text: function () { return Promise.resolve(""); } }); },
    navigator: { userAgent: "test" }, addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), sandbox, { filename: rel });
  return sandbox;
}

const MORNING = 1794235414035; /* 8:43:34 AM CST */
const OFF_S = 1794243600000; /* 11:00 AM CST */
const OFF_E = 1794258000000; /* 3:00 PM CST */
const BACK = 1794259119289; /* 3:18:39 PM CST */
const NOW = 1794261600000; /* 4:00 PM CST */
const BANKED = 8185965;
const OFF = [[OFF_S, OFF_E]];

function overlaps(run, a, b) { return Math.min(run.end, b) - Math.max(run.start, a) > 0; }

test("Nov 9 11:00 AM–3:00 PM is Off on today's map, and morning plus the return stay", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const t0 = DL.midnight("2026-11-09");
  assert.equal(t0 + 11 * 3600000, OFF_S);
  const lat = 30.1, lng = -95.4;
  const pts = [
    { t: MORNING, lat: lat, lng: lng, s: "a" },
    { t: OFF_S - 38 * 60000, lat: lat, lng: lng, s: "a" }, /* 10:22 AM */
    { t: BACK, lat: lat + 0.01, lng: lng, s: "a" },
    { t: NOW, lat: lat + 0.02, lng: lng, s: "a" }
  ];
  const runs = DL.trkRuns(pts, OFF);
  const avail = runs.filter(function (r) { return r.s === "a"; });
  const off = runs.filter(function (r) { return r.s === "o"; });
  assert.ok(off.length >= 1);
  assert.ok(off.some(function (r) { return r.start <= OFF_S + 1000 && r.end >= OFF_E - 1000; }));
  avail.forEach(function (r) { assert.equal(overlaps(r, OFF_S, OFF_E), false); });
  assert.ok(avail.some(function (r) { return r.start <= MORNING && r.end <= OFF_S; }));
  assert.ok(avail.some(function (r) { return r.start >= BACK - 1000 && r.end >= NOW; }));
  const oRun = off[0];
  const label = DL.runLabel(oRun, function (ms) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }); });
  assert.ok(label.indexOf("Off duty") >= 0);
  assert.equal(label.indexOf("Available"), -1);
  const shown = DL.trkDisplayRuns(pts, [], OFF);
  const tap = DL.runLabel(shown.filter(function (r) { return r.s === "o"; })[0]);
  assert.ok(tap.indexOf("Off duty") >= 0);
  shown.filter(function (r) { return r.s === "a"; }).forEach(function (r) { assert.equal(overlaps(r, OFF_S, OFF_E), false); });
  const tot = DL.trkTotals(runs);
  assert.ok(tot.o && tot.o.min >= 239 && tot.o.min <= 241);
  assert.ok(!tot.a || tot.a.min < 200);
  const sec = function (ms) { return Math.round((ms - t0) / 1000); };
  const html = DL.mapHtml({ track: { t0: t0, offline: OFF, pts: pts.map(function (p) { return [sec(p.t), Math.round(p.lat * 1e5), Math.round(p.lng * 1e5), p.s]; }) } });
  assert.ok(html.indexOf("Off duty / en route") >= 0);
  assert.ok(html.indexOf("4 hr 0 min") >= 0);
});

test("a long same-status gap with no Offline record stays one run", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const a = { t: 1000, lat: 30, lng: -95, s: "a" };
  const b = { t: 1000 + 5 * 3600000, lat: 30.2, lng: -95.2, s: "a" };
  const runs = DL.trkRuns([a, b]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].s, "a");
  assert.equal(runs[0].end, b.t);
  const flip = DL.trkRuns([a, { t: b.t, lat: b.lat, lng: b.lng, s: "r" }]);
  assert.equal(flip[0].end, b.t);
});

test("the duty grid paints the recorded Offline window Off and leaves the open afternoon On", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const day = DL.build({ now: NOW, days: 1, duty: [[MORNING, NOW]], offline: OFF, currentStatus: "on" })[0];
  function at(ms) {
    const m = Math.floor((ms - day.start) / 60000);
    const s = day.segs.filter(function (x) { return x.a <= m && m < x.b; })[0];
    return s && s.c;
  }
  assert.equal(at(MORNING + 60000), "on");
  assert.equal(at(OFF_S + 60000), "off");
  assert.equal(at(OFF_E - 60000), "off");
  assert.equal(at(BACK), "on");
});

test("online time drops the Offline window and does not drop the banked morning plus the open return", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const split = DL.onlineMsCut(BANKED, BACK, NOW, true, OFF);
  assert.equal(split, BANKED + (NOW - BACK));
  const unsplit = DL.onlineMsCut(0, MORNING, NOW, true, OFF);
  assert.equal(unsplit, (OFF_S - MORNING) + (NOW - OFF_E));
  assert.ok(unsplit < NOW - MORNING);
  assert.equal(NOW - MORNING - unsplit, OFF_E - OFF_S);
});

test("an owner split is copied onto the open row and a stale patch cannot put it back", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const morningKey = String(MORNING);
  const loc = {
    shiftStartAt: MORNING, shiftClosed: false, startOdometer: 1000, onlineMs: 0,
    gpsMiles: 20.72, filledMiles: 10.72, lastUpdate: NOW,
    gapFills: [{ id: "va", from: OFF_S - 7 * 60000, at: BACK, mi: 10.72 }],
    shifts: {}
  };
  const srv = {
    shiftStartAt: BACK, shiftClosed: false, startOdometer: 1000, onlineMs: BANKED,
    gpsMiles: 10, filledMiles: 0, gapFills: [], lastUpdate: BACK,
    shifts: {}
  };
  srv.shifts[morningKey] = { shiftStartedAt: MORNING, shiftEndedAt: OFF_S };
  const next = DL.adoptDutyRow(loc, srv, OFF);
  assert.equal(next.shiftStartAt, BACK);
  assert.equal(next.onlineMs, BANKED);
  assert.equal(next.shiftClosed, false);
  assert.equal(next.endOdometer, undefined);
  assert.equal(next.gapFills.length, 0);
  assert.equal(next.gpsMiles, 10);
  assert.equal(next.filledMiles, 0);
  assert.equal(next.shifts[morningKey].shiftEndedAt, OFF_S);
  assert.equal(next.startOdometer, 1000);
  const kept = DL.adoptDutyRow({ shiftStartAt: BACK, shiftClosed: false, startOdometer: 1000, onlineMs: BANKED, gapFills: [] }, { shiftStartAt: MORNING, shiftClosed: true, endOdometer: 9, startOdometer: 1000 }, OFF);
  assert.equal(kept.shiftStartAt, BACK);
  assert.equal(kept.endOdometer, undefined);
  const patch = {};
  patch.shiftStartAt = MORNING;
  patch.onlineMs = 0;
  patch.gpsMiles = 20.72;
  patch.gapFills = loc.gapFills.slice();
  patch["shifts/" + morningKey + "/shiftEndedAt"] = NOW;
  DL.guardDutyPatch(patch, loc, srv, OFF);
  assert.equal(patch.shiftStartAt, undefined);
  assert.equal(patch.onlineMs, BANKED);
  assert.equal(patch.gapFills.length, 0);
  assert.equal(patch.gpsMiles, 10);
  assert.equal(patch["shifts/" + morningKey + "/shiftEndedAt"], OFF_S);
  const blind = { shiftStartAt: MORNING, onlineMs: 0, gapFills: loc.gapFills, gpsMiles: 20.72 };
  DL.guardDutyPatch(blind, loc, null, OFF);
  assert.equal(blind.shiftStartAt, undefined);
  assert.equal(blind.gapFills, undefined);
  assert.equal(blind.gpsMiles, undefined);
});

test("a track flush keeps owner off-status points", function () {
  const DL = loadScript("app/driverlog.js").PCSDriverLog;
  const local = [[37320, 3010000, -9540000, "a"], [55320, 3020000, -9550000, "a"]];
  const server = [[39600, 3010000, -9540000, "o"], [54000, 3010000, -9540000, "o"]];
  const merged = DL.trkMergePts(local, server);
  const secs = merged.map(function (p) { return p[0] + ":" + p[3]; });
  assert.deepEqual(secs, ["37320:a", "39600:o", "54000:o", "55320:a"]);
  const conflict = DL.trkMergePts([[39600, 3010000, -9540000, "a"]], [[39600, 3010000, -9540000, "o"]]);
  assert.equal(conflict[0][3], "o");
  const chunk = "39600,3010000,-9540000,o;54000,3010000,-9540000,o";
  const body = DL.trkEncode(DL.trkMergePts([[54100, 3020000, -9550000, "a"]], DL.trkDecodeRaw(chunk)));
  assert.ok(body.indexOf("39600,3010000,-9540000,o") >= 0);
  assert.ok(body.indexOf("54000,3010000,-9540000,o") >= 0);
  assert.ok(body.indexOf("54100,3020000,-9550000,a") >= 0);
});
