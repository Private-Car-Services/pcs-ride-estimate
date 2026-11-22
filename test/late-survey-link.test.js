/* v2.0m-bz-ls1 (Matthew 3:27 PM 11/19): a past ride's survey link (Worker /god/survey/reopen) keeps the tracker page open until
   lateUntil so the after-ride stars / tip / survey can show. Everything else ends exactly as before. Sample data only; no network. */
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
  return sandbox.__pcsFollowLive;
}
const F = loadFollow();
const DAY = 86400000, now = Date.now(), old = now - 2 * DAY - 3600000;
const ENDED = "This ride has ended. Thanks for following along with PCS.";

test("late survey link: completed + lateUntil ahead keeps the page open (no 'ended', no 'expired')", () => {
  assert.equal(F.over({ status: "completed", endedAt: old, createdAt: now - 7 * 3600000, updatedAt: now - 7 * 3600000, lateUntil: now + 7 * DAY, role: "holder" }, now), "");
});
test("unchanged: without lateUntil an old completed ride still says ended; old link still expires", () => {
  assert.equal(F.over({ status: "completed", endedAt: old }, now), ENDED);
  assert.match(F.over({ status: "assigned", createdAt: now - 25 * 3600000 }, now), /expired/);
  assert.equal(F.over({ status: "completed", endedAt: now - 60000 }, now), "", "fresh completed ride: page open as before");
});
test("lateUntil is ignored when passed, more than 8 days ahead, on a shared copy, or on a non-completed status", () => {
  assert.equal(F.over({ status: "completed", endedAt: old, lateUntil: now - 1 }, now), ENDED);
  assert.equal(F.over({ status: "completed", endedAt: old, lateUntil: now + 9 * DAY }, now), ENDED);
  assert.equal(F.over({ status: "completed", endedAt: old, lateUntil: now + DAY, shared: true }, now), ENDED);
  assert.equal(F.over({ status: "cancelled", endedAt: old, lateUntil: now + DAY }, now), ENDED);
  assert.equal(F.over({ status: "ended", lateUntil: now + DAY }, now), ENDED);
  assert.equal(F.over({ status: "stopped", lateUntil: now + DAY }, now), "Sharing for this ride was turned off.");
});
test("tracker page loads the new follow-live.js build", () => {
  assert.match(fs.readFileSync(path.join(__dirname, "../follow/index.html"), "utf8"), /follow-live\.js\?v=2\.0m-ca2/ /* ca2: follow-live.js changed again (48 h after-ride), was ls1 */);
});
