/* v2.0m-bz6 (Matthew 11/20): the Driver's Log Logs/History rows said "No Inspections" on every day, even with saved pre/post-trips.
   Fixtures = presence of Anson's and Matthew's real saved inspections (rides/DRVRHSLG/<driver>/dvir, read-only 11/20; only the
   day, pre/post and "at" kept). The hours text before the " · " is unchanged. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

function load() {
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, addEventListener() {}, setAttribute() {}, getAttribute() { return ""; } });
  const box = { console, Date, Math, Intl, JSON, Promise, Number, String, Object, Array, RegExp, Error, isFinite, parseInt, parseFloat,
    setTimeout() { return 0; }, clearTimeout() {}, requestAnimationFrame() { return 0; }, addEventListener() {}, history: { pushState() {}, state: null },
    document: { getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, createElement: el, body: el(), head: el() } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/driverlog.js"), "utf8"), box, { filename: "app/driverlog.js" });
  return box.PCSDriverLog;
}
const NOW = Date.UTC(2026, 10, 20, 18, 0); /* Nov 20, 2026 12:00 PM CST */
function labels(file) {
  const DL = load(), dv = JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
  /* same rule as app.js / god.js dvirOf: a God-deleted record does not count */
  const meta = { now: NOW, dvirOf(d, k) { const r = (dv[d] || {})[k] || null; return r && r.deleted ? null : r; } };
  const days = DL.build({ now: NOW, days: 15 });
  const html = DL.listHtml(days, meta) + DL.historyHtml(days, 14, meta), out = {};
  const re = /data-open-day="(\d{4}-\d{2}-\d{2})"[\s\S]*?<div class="dl-item-hrs"[^>]*>([^<]*)<\/div>/g;
  let m; while ((m = re.exec(html))) out[m[1]] = m[2];
  return out;
}
const after = (s) => s.slice(s.indexOf(" \u00b7 ") + 3);

test("Anson: History rows show his real saved inspections", function () {
  const L = labels("dvir-label-anson-1120.json");
  assert.strictEqual(after(L["2026-11-17"]), "Post only");
  ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-18", "2026-11-19"].forEach(function (d) {
    assert.strictEqual(after(L[d]), "Pre \u2713 \u00b7 Post \u2713", d);
  });
  assert.strictEqual(after(L["2026-11-14"]), "No Inspections");
  assert.strictEqual(after(L["2026-11-15"]), "No Inspections");
});

test("Matthew: pre only, post only and both read from his saved inspections", function () {
  const L = labels("dvir-label-matthew-1120.json");
  assert.strictEqual(after(L["2026-11-13"]), "Pre only");
  assert.strictEqual(after(L["2026-11-14"]), "Post only");
  assert.strictEqual(after(L["2026-11-20"]), "Pre only"); /* today row (Logs list) */
  assert.strictEqual(after(L["2026-11-19"]), "Pre \u2713 \u00b7 Post \u2713");
});

test("hours text is unchanged and no meta still reads No Inspections (original wording)", function () {
  const DL = load(), days = DL.build({ now: NOW, days: 3 });
  const h = DL.historyHtml(days, 2);
  assert.ok(/\u23f1 [^<]* \u00b7 No Inspections<\/div>/.test(h));
  assert.strictEqual(h.indexOf("No inspections"), -1);
});
