/* v2.0m-bz (Matthew 11/16): post-ride window on the rider tracker (stars, tip, optional survey) + the driver's tip pop-up.
   Sample data only; no network. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function loadFollow() {
  const nodes = {};
  function make(id) {
    return nodes[id] || (nodes[id] = { id: id, hidden: true, textContent: "", innerHTML: "", src: "", style: {}, children: [],
      appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {}, querySelector: function () { return null; } });
  }
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object,
    Array: Array, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: { visibilityState: "visible", getElementById: function (id) { return nodes[id] || null; }, querySelector: function () { return null; }, createElement: function () { return make("made"); }, addEventListener: function () {}, head: { appendChild: function () {} }, body: { appendChild: function () {} } },
    location: { search: "?t=" + "b".repeat(32) },
    fetch: function () { return new Promise(function () {}); },
    navigator: {}, addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8"), sandbox, { filename: "follow-live.js" });
  return sandbox.__pcsFollowLive.postRide;
}
const pr = loadFollow();

test("order: 1 stars, 2 tip, 3 survey; a linked (shared) tracker skips the tip", function () {
  assert.deepEqual(Array.from(pr.steps({ status: "completed" })), ["stars", "tip", "survey"]);
  assert.deepEqual(Array.from(pr.steps({ status: "completed", linked: [{ invoiceNo: "600", pay: "paid" }] })), ["stars", "survey"]);
});
test("stars: tapping star 3 fills stars 1-3; Send waits for a star; comment box is there", function () {
  const none = pr.html({ step: "stars" }, {});
  assert.ok(/Rate your driver/.test(none)); assert.ok(/id="fl-pr-send" disabled/.test(none)); assert.ok(/<textarea id="fl-pr-c"/.test(none));
  const h = pr.html({ step: "stars", stars: 3 }, {});
  assert.equal((h.match(/class="on"/g) || []).length, 3);
  assert.ok(!/id="fl-pr-send" disabled/.test(h));
});
test("tip: 15% / 18% / 20% of the pre-tax fare with the dollars under each, + Custom tip; the custom field opens; custom $1-$100", function () {
  const h = pr.html({ step: "tip", fareCents: 1775 }, {});
  ["15% ($2.66)", "18% ($3.20)", "20% ($3.55)", "Custom tip", "No tip"].forEach(function (w) { assert.ok(h.indexOf(w) >= 0, w); });
  assert.ok(h.indexOf("25%") < 0 && h.indexOf("$5<") < 0 && h.indexOf("$10<") < 0);
  assert.ok(h.indexOf('id="fl-pr-tip"') < 0);
  const sel = pr.html({ step: "tip", fareCents: 1775, tip: "p18" }, {});
  assert.ok(sel.indexOf("Tip $3.20") >= 0); assert.ok(/data-tip="p18" aria-pressed="true"/.test(sel));
  const c = pr.html({ step: "tip", fareCents: 1775, tip: "custom", custom: "12.50" }, {});
  assert.ok(c.indexOf('id="fl-pr-tip"') >= 0); assert.ok(c.indexOf("Tip $12.50") >= 0);
  assert.ok(c.indexOf('data-kind="$" aria-pressed="true"') >= 0 && c.indexOf('data-kind="%"') >= 0, "$ / % selector, default $");
  assert.ok(c.indexOf('placeholder="0.00"') >= 0);
  assert.deepEqual(["12.50", "1", "100", "0.99", "100.01", "abc", "$7"].map(pr.tipCents), [1250, 100, 10000, null, null, null, 700]);
  const p = pr.html({ step: "tip", tip: "p20", fareCents: 1775, payUrl: "https://square.link/u/sample", payCents: 355 }, {});
  assert.ok(p.indexOf('href="https://square.link/u/sample"') >= 0 && p.indexOf("Pay $3.55 tip") >= 0);
});
test("labels: \"15% ($15)\" on a $100 fare, cents only when needed", function () {
  const h = pr.html({ step: "tip", fareCents: 10000 }, {});
  ["15% ($15)", "18% ($18)", "20% ($20)"].forEach(function (w) { assert.ok(h.indexOf(w) >= 0, w); });
});
test("% math to the nearest cent; unknown or $0 fare shows only Custom tip; a % under $1 is hidden", function () {
  assert.deepEqual([15, 18, 20].map(function (x) { return pr.pctTip(1775, x); }), [266, 320, 355]);
  assert.equal(pr.pctTip(1775, 25), 0); assert.equal(pr.pctTip(0, 20), 0);
  assert.equal(pr.pctTip(1003, 15), 150, "150.45 -> 150");
  assert.equal(pr.pctList(0).length, 0); assert.equal(pr.pctList(undefined).length, 0);
  [{}, { fareCents: 0 }].forEach(function (P) {
    const h = pr.html(Object.assign({ step: "tip" }, P), {});
    assert.ok(h.indexOf("Custom tip") >= 0); assert.ok(h.indexOf("% (") < 0);
  });
  assert.deepEqual(Array.from(pr.pctList(600)).map(function (x) { return x.pct; }), [18, 20], "15% of $6 = $0.90 hidden");
});
test("presets on a $600 fare are $90 / $108 / $120 (the $100 cap is Custom only); 20% over $500 is hidden", function () {
  assert.deepEqual(Array.from(pr.pctList(60000)).map(function (x) { return [x.pct, x.cents]; }), [[15, 9000], [18, 10800], [20, 12000]]);
  const h = pr.html({ step: "tip", fareCents: 60000 }, {});
  ["15% ($90)", "18% ($108)", "20% ($120)", "Custom tip"].forEach(function (w) { assert.ok(h.indexOf(w) >= 0, w); });
  assert.deepEqual(Array.from(pr.pctList(250100)).map(function (x) { return x.pct; }), [15, 18], "20% of $2,501 = $500.20 hidden");
  const big = pr.html({ step: "tip", fareCents: 250100 }, {});
  assert.ok(big.indexOf("20%") < 0 && big.indexOf("15%") >= 0 && big.indexOf("18%") >= 0);
  assert.equal(pr.customPctCents(60000, 20), null, "custom 20% of $600 is $120, over $100");
  const c = pr.html({ step: "tip", fareCents: 60000, tip: "custom", customKind: "%", customPct: "20" }, {});
  assert.ok(/id="fl-pr-tipgo" disabled/.test(c) || /id="fl-pr-tipgo" disabled>Tip</.test(c));
  assert.ok(c.indexOf("Tip $120") < 0);
});
test("the tracker sends a % choice as percent only (the Worker works out the amount), custom $ as cents, custom % as percent", function () {
  const src = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");
  assert.ok(src.indexOf('prPost("/ride/tip", pm ? { percent: Number(pm[1]) } : (pct != null ? { percent: pct } : { tipCents: c }))') >= 0);
  assert.ok(src.indexOf("PR_PCTS = [15, 18, 20]") >= 0);
});
test("custom tip: $ / % selector (default $) with one input; % of the pre-tax fare; button shows dollars; % hidden when no fare", function () {
  assert.deepEqual(["22", "22.5", "1", "100", "0.9", "100.1", "22.55", "abc", "22%"].map(pr.customPct), [22, 22.5, 1, 100, null, null, null, null, 22]);
  assert.equal(pr.customPctCents(1775, 22), 391); assert.equal(pr.customPctCents(1775, 1), null, "1% of $17.75 is under $1");
  assert.equal(pr.customPctCents(0, 22), null); assert.equal(pr.customPctCents(15000, 100), null, "over $100");
  const d = pr.html({ step: "tip", fareCents: 1775, tip: "custom", customKind: "$", custom: "15" }, {});
  assert.ok(d.indexOf("Tip $15") >= 0); assert.ok(d.indexOf('data-kind="$" aria-pressed="true"') >= 0);
  const pct = pr.html({ step: "tip", fareCents: 1775, tip: "custom", customKind: "%", customPct: "22" }, {});
  assert.ok(pct.indexOf("Tip $3.91") >= 0, "22% of $17.75"); assert.ok(pct.indexOf('data-kind="%" aria-pressed="true"') >= 0);
  assert.ok(pct.indexOf('placeholder="0"') >= 0 && pct.indexOf('id="fl-pr-tip"') >= 0);
  const none = pr.html({ step: "tip", fareCents: 0, tip: "custom", customKind: "%", custom: "10" }, {});
  assert.ok(none.indexOf("data-kind") < 0, "no $ / % toggle when the fare is unknown");
  assert.ok(none.indexOf('placeholder="0.00"') >= 0); assert.ok(none.indexOf("Tip $10") >= 0);
});
test("survey: exactly 2 car, 2 driver, 1 ride tracker question, comment, anonymous or name, website Yes/No, Skip", function () {
  const keys = pr.questions.map(function (q) { return q[0]; });
  assert.deepEqual(Array.from(keys), ["car1", "car2", "drv1", "drv2", "trk1"]);
  const h = pr.html({ step: "survey" }, {});
  assert.equal((h.match(/data-q="(car|drv|trk)\d" data-v="1"/g) || []).length, 5);
  ["Comments (optional)", "Stay anonymous", "Add my name", "May we put your feedback on www.PCSrides.com?", ">Yes<", ">No<", ">Skip<"].forEach(function (w) { assert.ok(h.indexOf(w) >= 0, w); });
  assert.ok(h.indexOf('id="fl-pr-name"') < 0);
  assert.ok(pr.html({ step: "survey", sv: { anon: false } }, {}).indexOf('id="fl-pr-name"') >= 0);
});
test("the tracker never claims a tip was paid on its own: 'Tip received' only with the Worker's paid answer", function () {
  assert.ok(pr.html({ step: "done" }, {}).indexOf("Tip received") < 0);
  assert.ok(pr.html({ step: "done", tipPaid: 2000 }, {}).indexOf("Tip received: $20") >= 0);
});
test("the tracker writes nothing to the database: post-ride calls go only to the PCS Worker", function () {
  const src = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");
  const blk = src.slice(src.indexOf("v2.0m-bz (Matthew 11/16): post-ride window"), src.indexOf("window.__pcsFollowLive = {"));
  assert.ok(blk.indexOf('PR_WORKER = "https://pcs-pay.pcsrides.workers.dev"') >= 0);
  assert.equal(/firebaseio|DB \+|method: "(PUT|PATCH)"/.test(blk), false);
  ["/ride/rate", "/ride/tip", "/ride/tip/status", "/ride/post-status", "/ride/survey"].forEach(function (p) { assert.ok(blk.indexOf('"' + p + '"') >= 0, p); });
});

function loadApp() {
  const el = function () { return { style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }, appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {} }; };
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve("null"); }, json: function () { return Promise.resolve(null); } }); },
    PCS_SYNC: { databaseURL: "https://example.test" },
    document: { readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: function () { return el(); },
      body: { getAttribute: function () { return "driver"; }, style: {} }, head: { appendChild: function () {} }, documentElement: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app.js" });
  return sandbox.__pcsTipNote;
}
test("driver tip pop-up: big header with the amount, then ride, date/time, invoice #, customer name", function () {
  const tn = loadApp();
  const h = tn.html({ id: "c_ev1-1", tipCents: 2000, from: "100 Sample Ln, Waco", to: "Waco Regional Airport", when: Date.parse("2026-11-16T09:30:00-06:00"), invoiceNo: "000602", customer: "Jane Sample" });
  assert.ok(h.indexOf('>You received a <span class="drv-tip-amt">$20</span> tip<') >= 0);
  ["Ride: 100 Sample Ln, Waco \u2192 Waco Regional Airport", "Mon, Nov 16, 9:30 AM CT", "Invoice #000602", "Customer: Jane Sample"].forEach(function (w) { assert.ok(h.indexOf(w) >= 0, w); });
  const n = tn.html({ id: "x", tipCents: 750, from: "A", to: "B" });
  assert.ok(n.indexOf("$7.50</span> tip") >= 0); assert.ok(n.indexOf("Invoice #") < 0); assert.ok(n.indexOf("Customer:") < 0);
  const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  assert.ok(/#drv-tip-popup \.wa-title\{font-size:27px;font-weight:800;color:#fff;/.test(src), "20pt bold white header");
  assert.ok(/#drv-tip-popup \.drv-tip-amt\{color:#4ade80;font-weight:800\}/.test(src), "amount alone in bold green");
  assert.ok(/#drv-tip-popup \.wa-body\{font-size:15px[^}]*color:#fff\}/.test(src), "white body");
  assert.ok(/#drv-tip-popup \.wa-body\{font-size:15px/.test(src), "body about half the header");
});

/* ---------- Harry r1 (838e073) ---------- */
test("Not now on the stars goes on to the tip, then the survey; on a linked tracker straight to the survey", function () {
  const P = { step: "stars" };
  pr.next(P, { status: "completed" }); assert.equal(P.step, "tip");
  pr.next(P, { status: "completed" }); assert.equal(P.step, "survey");
  const L = { step: "stars" };
  pr.next(L, { status: "completed", linked: [{ invoiceNo: "600", pay: "paid" }] }); assert.equal(L.step, "survey");
  const src = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");
  assert.ok(/if \(id === "fl-pr-later"\) \{ prNext\(P, d\); prPaint\(\); return; \}/.test(src), "Not now advances, never closes for good");
  assert.ok(pr.html({ step: "stars" }, {}).indexOf('id="fl-pr-later">Not now<') >= 0);
});
test("driver tip pop-up: a calendar ride's prepaidInvoiceNo or sqInvoice.number shows as the invoice", function () {
  const tn = loadApp();
  assert.equal(tn.invoice({ prepaidInvoiceNo: "#000610" }), "000610");
  assert.equal(tn.invoice({ sqInvoice: { number: "000611" } }), "000611");
  assert.equal(tn.invoice({ invoiceNo: "000612", prepaidInvoiceNo: "000610" }), "000612");
  assert.equal(tn.invoice({ sqInvoice: { number: "INV-x" } }), "");
  assert.ok(tn.html({ id: "y", tipCents: 1000, from: "A", to: "B", sqInvoice: { number: "000611" } }).indexOf("Invoice #000611") >= 0);
});

test("the tracker asks the Worker before painting the after-ride window, and never shows it on a linked share", function () {
  const src = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");
  assert.ok(src.indexOf('prPost("/ride/post-status", {})') >= 0);
  assert.ok(src.indexOf("j.show !== true") >= 0);
  assert.ok(src.indexOf("only after the Worker says this invoice's last trip is done") >= 0);
});

/* ---------- Matthew 1:51 PM 11/16 ---------- */
test("tip step says \"Your driver keeps 100% of tips\" right under the heading (presets and Custom only)", function () {
  [pr.html({ step: "tip", fareCents: 1775 }, {}), pr.html({ step: "tip", fareCents: 0 }, {})].forEach(function (h) {
    const a = h.indexOf("Tip your driver"), b = h.indexOf("Your driver keeps 100% of tips"), c = h.indexOf('role="group" aria-label="Tip"');
    assert.ok(a >= 0 && b > a && c > b, "heading, then the line, then the buttons");
  });
  assert.equal(pr.html({ step: "stars" }, {}).indexOf("100% of tips"), -1);
  assert.equal(pr.html({ step: "survey" }, {}).indexOf("100% of tips"), -1);
});
test("linked run: the shared tracker skips the tip; the account holder's own link (Worker own: true) gets stars, tip, survey", function () {
  const d = { status: "completed", linked: [{ invoiceNo: "600", pay: "paid" }, { invoiceNo: "601", pay: "unpaid" }] };
  assert.deepEqual(Array.from(pr.steps(d, {})), ["stars", "survey"]);
  assert.deepEqual(Array.from(pr.steps(d, { own: "yes" })), ["stars", "survey"], "only a real true");
  assert.deepEqual(Array.from(pr.steps(d, { own: true })), ["stars", "tip", "survey"]);
  const P = { step: "stars", own: true };
  pr.next(P, d); assert.equal(P.step, "tip");
  pr.next(P, d); assert.equal(P.step, "survey");
  const src = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");
  assert.ok(src.indexOf("if (j.own === true) S.pr.own = true;") >= 0, "own comes from the Worker's answer only");
});

test("survey (Matthew 11/16): five full satisfaction questions, each 1-10 with end labels; no stars in the survey", function () {
  assert.deepEqual(Array.from(pr.questions.map(function (q) { return q[1]; })), [
    "How satisfied were you with the cleanliness of the car?", "How satisfied were you with the comfort of the car?",
    "How satisfied were you with your driver's safe driving?", "How satisfied were you with your driver's courtesy and professionalism?",
    "How satisfied were you with the ride tracker?"]);
  const h = pr.html({ step: "survey", sv: { drv1: 8 } }, {});
  assert.equal(h.indexOf('class="stars'), -1, "no stars in the survey");
  assert.equal(h.indexOf("\u2605"), -1);
  assert.equal((h.match(/class="scale"/g) || []).length, 5);
  pr.questions.forEach(function (q) {
    const n = (h.match(new RegExp('data-q="' + q[0] + '" data-v="\\d+"', "g")) || []).length;
    assert.equal(n, 10, q[0] + " has 1..10");
    assert.ok(h.indexOf('data-q="' + q[0] + '" data-v="10"') >= 0 && h.indexOf('data-q="' + q[0] + '" data-v="11"') < 0);
  });
  assert.equal(h.split("1 = Very unsatisfied").length - 1, 5); assert.equal(h.split("10 = Very satisfied").length - 1, 5);
  assert.ok(/data-q="drv1" data-v="8" role="radio" aria-label="8" aria-checked="true" aria-pressed="true"/.test(h), "the tapped answer is marked");
  assert.equal((h.match(/aria-pressed="true">\d+</g) || []).length, 1);
  assert.ok(/class="stars"/.test(pr.html({ step: "stars" }, {})), "stars stay on the driver rating");
  assert.equal((pr.html({ step: "stars" }, {}).match(/data-q="stars" data-v="\d"/g) || []).length, 5, "driver rating stays 1-5 stars");
});
