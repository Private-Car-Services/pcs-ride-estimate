/* v2.0m-ca (Matthew 3:35 PM 11/16 "I want to see everything"): God mode Ratings & surveys section + the tracker keeps the
   after-ride stars / tip / survey for 48 h. SAMPLE DATA ONLY (made-up riders, drivers and answers); no network. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const GR = require("../god/god-ratings.js");

const H = 3600000, NOV16_230 = Date.parse("2026-11-16T14:30:00-06:00"), OCT20_9 = Date.parse("2026-10-20T09:00:00-05:00");
function sampleRows() {
  return [
    { id: "pr1", rideAt: NOV16_230, at: NOV16_230 + 2 * H, rider: "Sample Rider Alpha", invoiceNo: "000901", driverNames: ["Sample Driver One"], fareCents: 4500, invoiceTotalCents: 4871,
      stars: 5, starComment: "SAMPLE: very smooth", tipPaidCents: 900, tipOpenCents: 0, rideTipCents: 900,
      survey: { car1: 10, car2: 9, drv1: 10, drv2: 10, trk1: 8, grade: 9.4, comment: "SAMPLE survey comment", anon: false, name: "Sample Rider Alpha", publicName: "Sample A.", web: true } },
    { id: "pr2", rideAt: NOV16_230 - 5 * H, at: NOV16_230, rider: null, invoiceNo: "000902", driverNames: ["Sample Driver One"], fareCents: 2000,
      stars: 3, starComment: null, tipPaidCents: 0, tipOpenCents: 500,
      survey: { car1: 6, car2: 7, drv1: 5, drv2: 6, trk1: 6, grade: 6, comment: null, anon: true, name: null, publicName: null, web: false } },
    { id: "pr3", rideAt: OCT20_9, at: OCT20_9 + H, rider: "Sample Rider Gamma", invoiceNo: null, driverNames: ["Sample Driver Two"], fareCents: null,
      stars: 4, starComment: "SAMPLE: on time", tipPaidCents: 0, tipOpenCents: 0, survey: null },
    { id: "pr4", rideAt: OCT20_9 - 24 * H, at: OCT20_9, rider: "Sample Rider Delta", invoiceNo: "000880", driverNames: ["Sample Driver Two"], fareCents: 3000,
      stars: null, tipPaidCents: 0, tipOpenCents: 0, survey: { car1: 8, car2: null, drv1: 9, drv2: 7, trk1: null, grade: null, comment: null, anon: false, name: "Sample Rider Delta", web: true } }
  ];
}

test("ratings render from sample records: every field, the five questions labeled exactly, the grade, newest first", function () {
  GR._sample(sampleRows());
  const h = GR.inner();
  assert.ok(h.indexOf("SAMPLE DATA") >= 0, "preview is labeled sample");
  ["(1) Cleanliness of the car", "(2) Comfort of the car", "(3) Driver's safe driving", "(4) Driver's courtesy and professionalism", "(5) Ride tracker"].forEach(function (q) {
    assert.ok(h.indexOf(q.replace("'", "&#39;")) >= 0, q);
  });
  ["Invoice #000901", "Sample Driver One", "$45.00 pre-tax", "invoice total $48.71", "5 of 5", "SAMPLE: very smooth", "$9.00 (card, paid)", "9.4 / 10",
    "SAMPLE survey comment", "Use my name (Sample Rider Alpha, website shows Sample A.)", "Website OK:</b> Yes", "$5.00 tip link opened, not paid", "Website OK:</b> No", "No survey.", "Not rated"].forEach(function (w) {
    assert.ok(h.indexOf(w) >= 0, w);
  });
  assert.ok(/Mon 11\/16\/2026 2:30 PM CST/.test(h), "Chicago time with zone");
  const order = Array.from(h.matchAll(/data-gr-id="(pr\d)"/g)).map(function (m) { return m[1]; });
  assert.deepEqual(order, ["pr1", "pr2", "pr3", "pr4"]);
  assert.ok(/id="gr-list" style="max-height:60vh;overflow:auto/.test(h), "scrollable list");
});
test("grade: the stored grade, else the average of the answered items (one decimal)", function () {
  assert.equal(GR.grade({ car1: 8, car2: null, drv1: 9, drv2: 7, trk1: null, grade: null }), 8);
  assert.equal(GR.grade({ car1: 10, car2: 9, drv1: 10, drv2: 10, trk1: 8 }), 9.4);
});
test("Stay anonymous hides the name (even the booking name); a named survey shows the typed name", function () {
  const rows = sampleRows();
  assert.equal(GR.displayName(rows[1]), "Anonymous");
  assert.equal(GR.displayName(Object.assign({}, rows[1], { rider: "Sample Booker" })), "Anonymous", "anon wins over a booking name");
  assert.equal(GR.displayName(rows[0]), "Sample Rider Alpha");
  assert.equal(GR.displayName(rows[2]), "Sample Rider Gamma", "stars only, no survey: the booking name");
  const h = GR.rowHtml(Object.assign({}, rows[1], { rider: "Sample Booker" }));
  assert.ok(h.indexOf("Anonymous") >= 0 && h.indexOf("Sample Booker") < 0 && h.indexOf("Stay anonymous") >= 0);
});
test("God mode wires the section read-only through /god/ratings and loads god-ratings.js with ?v=2.0m-ca2", function () {
  const god = fs.readFileSync(path.join(__dirname, "../god/god.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "../god/index.html"), "utf8");
  assert.ok(god.indexOf('atxPost("/god/ratings", {})') >= 0);
  assert.ok(/god\\\/\(\?:discounts\|ratings\|/.test(god), "a read: no slowKick");
  assert.ok(html.indexOf('./god-ratings.js?v=2.0m-ca2') >= 0 && html.indexOf('./god.js?v=2.0m-ca2') >= 0);
  assert.ok(html.indexOf("god-ratings.js") < html.indexOf("./god.js?"), "loads before god.js");
  const src = fs.readFileSync(path.join(__dirname, "../god/god-ratings.js"), "utf8");
  assert.equal(/firebaseio|fetch\(|\.put\(|PATCH|DELETE/.test(src), false, "no direct database calls");
});

/* ---------- tracker: completed ride keeps the after-ride flow for 48 h ---------- */
function runTracker(share) {
  const nodes = {}, calls = [];
  function make() { return { id: "", hidden: true, textContent: "", innerHTML: "", className: "", src: "", style: {}, parentNode: null, children: [],
    appendChild: function (c) { c.parentNode = this; this.children.push(c); if (c.id) nodes[c.id] = c; }, removeChild: function (c) { if (nodes[c.id] === c) delete nodes[c.id]; c.parentNode = null; },
    setAttribute: function () {}, getAttribute: function () { return null; }, addEventListener: function () {}, querySelector: function () { return null; } }; }
  const body = make(); body.id = "body";
  nodes.app = make(); nodes.app.id = "app";
  const resp = function (o) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(o); } }); };
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object, Array: Array, RegExp: RegExp, Error: Error,
    parseInt: parseInt, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: { visibilityState: "visible", head: make(), body: body, documentElement: body, addEventListener: function () {}, querySelector: function () { return null; }, createElement: make,
      getElementById: function (id) { if (id === "fl-pr-box" && nodes["fl-pr"] && !nodes[id]) { nodes[id] = make(); nodes[id].id = id; } return nodes[id] || null; } },
    location: { search: "?t=" + "S".repeat(32) }, navigator: {}, addEventListener: function () {}, removeEventListener: function () {},
    fetch: function (url, opt) { calls.push(String(url)); if (/firebaseio\.com/.test(url)) return resp(share); if (/\/ride\/post-status$/.test(url)) return resp({ ok: true, show: true, fareCents: 4500 }); return resp({ ok: true }); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8"), sandbox, { filename: "follow-live.js" });
  return new Promise(function (r) { setTimeout(r, 30); }).then(function () { return { nodes: nodes, calls: calls, S: sandbox.__pcsFollowLive.state, api: sandbox.__pcsFollowLive }; });
}
const now = Date.now(), MIN = 60000;
function share(status, agoMs) { return { v: 1, status: status, endedAt: now - agoMs, updatedAt: now - agoMs, createdAt: now - agoMs - 2 * H, driverFirst: "Sample", car: { make: "Sample", plate: "SAMPLE1" } }; }
function asked(calls) { return calls.some(function (u) { return /\/ride\/post-status$/.test(u); }); }

test("tracker 31 min after completion: 'This ride has ended' (no map) AND the stars / tip / survey pop-up", async function () {
  const r = await runTracker(share("completed", 31 * MIN));
  assert.ok(r.nodes.app.innerHTML.indexOf("This ride has ended") >= 0);
  assert.ok(r.nodes.app.innerHTML.indexOf('id="fl-map"') < 0, "no live map");
  assert.equal(r.S.ended, true); assert.equal(r.S.prKeep, true);
  assert.ok(asked(r.calls), "asked the Worker for the after-ride flow");
  assert.ok(r.nodes["fl-pr"], "pop-up on the page");
  assert.ok(r.nodes["fl-pr-box"].innerHTML.indexOf("Rate your driver") >= 0);
  assert.equal(r.calls.filter(function (u) { return /firebaseio/.test(u); }).length, 1, "one read, then no polling or stream");
});
test("tracker 47 h after completion (link older than 24 h, no update for 6 h+): still ended + after-ride flow", async function () {
  const r = await runTracker(share("completed", 47 * H));
  assert.ok(r.nodes.app.innerHTML.indexOf("This ride has ended") >= 0);
  assert.ok(asked(r.calls)); assert.ok(r.nodes["fl-pr"]);
});
test("tracker 49 h after completion: ended, no after-ride flow (matches the Worker's 48 h)", async function () {
  const r = await runTracker(share("completed", 49 * H));
  assert.ok(r.nodes.app.innerHTML.indexOf("This ride has ended") >= 0);
  assert.equal(asked(r.calls), false); assert.ok(!r.nodes["fl-pr"]); assert.equal(r.S.prKeep, false);
});
test("stopped and cancelled are unchanged: their own message, no after-ride flow", async function () {
  const s = await runTracker(share("stopped", 31 * MIN));
  assert.ok(s.nodes.app.innerHTML.indexOf("Sharing for this ride was turned off.") >= 0);
  assert.equal(asked(s.calls), false); assert.ok(!s.nodes["fl-pr"]);
  const s2 = await runTracker(share("stopped", 2 * MIN));
  assert.ok(s2.nodes.app.innerHTML.indexOf("Sharing for this ride was turned off.") >= 0); assert.equal(asked(s2.calls), false);
  const c = await runTracker(share("cancelled", 31 * MIN));
  assert.ok(c.nodes.app.innerHTML.indexOf("This ride has ended") >= 0);
  assert.equal(asked(c.calls), false); assert.ok(!c.nodes["fl-pr"]);
});
test("prLate: only completed, after 30 min, up to and including 48 h", async function () {
  const r = await runTracker(share("stopped", 1));
  const f = r.api.prLate;
  assert.equal(f({ status: "completed", endedAt: now - 29 * MIN }, now), false);
  assert.equal(f({ status: "completed", endedAt: now - 31 * MIN }, now), true);
  assert.equal(f({ status: "completed", endedAt: now - 48 * H }, now), true);
  assert.equal(f({ status: "completed", endedAt: now - 48 * H - 1 }, now), false);
  assert.equal(f({ status: "completed" }, now), false);
  assert.equal(f({ status: "cancelled", endedAt: now - H }, now), false);
  assert.equal(f({ status: "stopped", endedAt: now - H }, now), false);
});
