/* v2.0m-bq (Matthew 11/12: "I need to be able to edit the drivers log. But only me."): God-mode-only Driver's Log edits.
   Edit / soft delete keep the original + an audit record, any change clears the day's signature (kept in prevSigns + the audit),
   writes go only through the Worker's /god/db (God password / token), and the driver app reads the edits into the hours. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function loadGE() {
  const box = { window: {}, console, Intl, Date, JSON, Math, Number, String, Object, Array, isFinite };
  box.window.window = box.window;
  vm.createContext(box);
  vm.runInContext(read("app/driverlog.js"), box);
  return box.window.PCSDriverLog.godEdit;
}
const DAY = "2026-11-12", T0 = Date.UTC(2026, 10, 12, 6, 0); /* Nov 12 midnight CST */
const H = 3600000;
function sample() {
  const hl = {
    dvir: { [DAY]: { pre: { at: T0 + 7 * H, plate: "DV10S12", odometer: 244250, items: { horn: { answer: "Yes" } }, sig: "data:image/png;base64,AAA" },
      post: { at: T0 + 15 * H, plate: "DV10S12", odometer: 244529 }, earlier: { "pre-123": { at: T0 + 5 * H, plate: "DV10S12", odometer: 244200 } } } },
    drive: { [T0 + 8 * H]: { s: T0 + 8 * H, e: T0 + 9 * H } },
    breaks: { [T0 + 10 * H]: { s: T0 + 10 * H, e: T0 + 11 * H, open: false } },
    offline: { [T0 + 12 * H]: { s: T0 + 12 * H, e: T0 + 13 * H, open: false }, [T0 + 23 * H]: { s: T0 + 23 * H, e: 0, open: true } }
  };
  const row = { shifts: { [T0 + 6 * H]: { shiftStartedAt: T0 + 6 * H, shiftEndedAt: T0 + 14 * H, trackedMiles: 100 } } };
  const sign = { img: "data:image/png;base64,SIG", at: T0 + 20 * H, hash: "123", cert: "I hereby certify" };
  return { hl, row, sign };
}
const pick = (list, key) => list.filter((e) => e.key === key)[0];

test("entries: one day's inspections, shifts, Driving, Break and Offline (open ones can't be edited)", () => {
  const GE = loadGE(), s = sample(), list = GE.entries(DAY, s.hl, s.row);
  const keys = list.map((e) => e.key);
  ["dvir:pre", "dvir:post", "dvir:earlier/pre-123", "shift:" + (T0 + 6 * H), "drive:" + (T0 + 8 * H), "breaks:" + (T0 + 10 * H), "offline:" + (T0 + 12 * H), "offline:" + (T0 + 23 * H)].forEach((k) => assert.ok(keys.includes(k), k));
  assert.equal(pick(list, "dvir:pre").vals.plate, "DV10S12");
  assert.equal(pick(list, "offline:" + (T0 + 23 * H)).open, true);
});

test("edit keeps the original (godOrig + audit), stamps editedBy / editedAt, and clears the day's signature (old one kept)", () => {
  const GE = loadGE(), s = sample(), ent = pick(GE.entries(DAY, s.hl, s.row), "dvir:pre"), now = T0 + 21 * H;
  const r = GE.editOps("drv1", DAY, ent, { at: T0 + 6.5 * H, odometer: "244240" }, "mwragge78@gmail.com", "typo", now, s.hl, s.sign);
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.ops.map((o) => o.method + " " + o.path), ["PATCH /rides/DRVRHSLG/drv1/dvir/" + DAY, "PUT /rides/DRVRHSLG/drv1/overrides/" + now, "PUT /rides/DRVRHSLG/drv1/signs/" + DAY]);
  const p = r.ops[0].value;
  assert.equal(p["pre/at"], T0 + 6.5 * H); assert.equal(p["pre/odometer"], 244240);
  assert.equal(p["pre/godOrig/at"], T0 + 7 * H); assert.equal(p["pre/godOrig/odometer"], 244250);
  assert.equal(p["pre/editedBy"], "mwragge78@gmail.com"); assert.equal(p["pre/editedAt"], now); assert.equal(p["pre/editReason"], "typo");
  assert.ok(!("pre/items" in p) && !("pre/sig" in p), "nothing else on the inspection is touched");
  const a = r.ops[1].value;
  assert.equal(a.kind, "log edit"); assert.equal(a.by, "mwragge78@gmail.com"); assert.equal(a.at, now); assert.equal(a.reason, "typo"); assert.equal(a.logDay, DAY);
  assert.equal(a.from.at, T0 + 7 * H); assert.equal(a.to.at, T0 + 6.5 * H); assert.equal(a.oldSign.img, s.sign.img);
  const sg = r.ops[2].value;
  assert.equal(sg.needsSign, true); assert.ok(!sg.img, "unsigned until signed again");
  assert.equal(sg.prevSigns[String(s.sign.at)].img, s.sign.img, "old signature kept");
});

test("a second edit never overwrites the first original", () => {
  const GE = loadGE(), s = sample();
  s.hl.breaks[T0 + 10 * H] = Object.assign({}, s.hl.breaks[T0 + 10 * H], { e: T0 + 10.5 * H, godOrig: { e: T0 + 11 * H }, editedBy: "God" });
  const ent = pick(GE.entries(DAY, s.hl, s.row), "breaks:" + (T0 + 10 * H));
  const r = GE.editOps("drv1", DAY, ent, { e: T0 + 10.75 * H }, "God", "", T0 + 22 * H, s.hl, null);
  assert.equal(r.ops[0].value.e, T0 + 10.75 * H);
  assert.ok(!("godOrig/e" in r.ops[0].value), "first original stays");
  assert.equal(r.ops[0].path, "/rides/DRVRHSLG/drv1/breaks/" + (T0 + 10 * H));
});

test("delete is soft: the record stays (deleted + who / when / why), no DELETE is ever sent", () => {
  const GE = loadGE(), s = sample(), list = GE.entries(DAY, s.hl, s.row), now = T0 + 21 * H;
  ["shift:" + (T0 + 6 * H), "offline:" + (T0 + 12 * H), "dvir:earlier/pre-123"].forEach((k) => {
    const r = GE.deleteOps("drv1", DAY, pick(list, k), "God", "duplicate", now, s.sign);
    assert.ok(r.ops.every((o) => o.method !== "DELETE"), k);
    const v = r.ops[0].value, pre = Object.keys(v)[0].replace(/deleted$/, "");
    assert.equal(v[pre + "deleted"], true); assert.equal(v[pre + "deletedBy"], "God"); assert.equal(v[pre + "deletedAt"], now); assert.equal(v[pre + "deleteReason"], "duplicate");
    assert.equal(r.ops[1].value.kind, "log delete"); assert.equal(r.ops[2].value.needsSign, true);
  });
  const sh = GE.deleteOps("drv1", DAY, pick(list, "shift:" + (T0 + 6 * H)), "God", "", now, null);
  assert.equal(sh.ops[0].path, "/rides/DRVRMLES/drv1/" + DAY);
  assert.ok(("shifts/" + (T0 + 6 * H) + "/deleted") in sh.ops[0].value);
});

test("status change: Break -> Offline soft-deletes the Break and adds the same span as Offline", () => {
  const GE = loadGE(), s = sample(), now = T0 + 21 * H, ent = pick(GE.entries(DAY, s.hl, s.row), "breaks:" + (T0 + 10 * H));
  const r = GE.editOps("drv1", DAY, ent, { status: "offline" }, "God", "", now, s.hl, null);
  assert.equal(r.ops[0].value.deleted, true);
  assert.equal(r.ops[1].method, "PUT"); assert.equal(r.ops[1].path, "/rides/DRVRHSLG/drv1/offline/" + (T0 + 10 * H));
  assert.equal(r.ops[1].value.godOrig.status, "breaks"); assert.equal(r.ops[1].value.s, T0 + 10 * H);
  assert.equal(r.audit.to.status, "offline");
});

test("refused: open entries, end before start, future times, already deleted", () => {
  const GE = loadGE(), s = sample(), list = GE.entries(DAY, s.hl, s.row), now = T0 + 21 * H;
  assert.ok(GE.editOps("d", DAY, pick(list, "offline:" + (T0 + 23 * H)), { s: T0 + 22 * H }, "G", "", now).error);
  assert.ok(GE.editOps("d", DAY, pick(list, "drive:" + (T0 + 8 * H)), { e: T0 + 7 * H }, "G", "", now).error);
  assert.ok(GE.editOps("d", DAY, pick(list, "drive:" + (T0 + 8 * H)), { e: now + 2 * H }, "G", "", now).error);
  s.hl.drive[T0 + 8 * H].deleted = true;
  assert.ok(GE.deleteOps("d", DAY, pick(GE.entries(DAY, s.hl, s.row), "drive:" + (T0 + 8 * H)), "G", "", now).error);
});

test("every write path fits the Worker's /god/db limits (rides/<hub>/... at most 5 parts, safe characters)", () => {
  const GE = loadGE(), s = sample(), list = GE.entries(DAY, s.hl, s.row), now = T0 + 21 * H, ops = [];
  list.filter((e) => !e.open).forEach((e) => { ops.push(...GE.deleteOps("mwragge_privatetaxiservices_net", DAY, e, "G", "", now, s.sign).ops); });
  ops.forEach((o) => { const segs = o.path.split("/").filter(Boolean); assert.ok(segs.length <= 5 && segs[0] === "rides" && segs.every((x) => /^[A-Za-z0-9_-]{1,80}$/.test(x)), o.path); });
});

test("driver hours: deleted records leave the totals, God edits replace the phone's own copies", () => {
  const GE = loadGE(), s = sample();
  s.hl.drive[T0 + 8 * H] = { s: T0 + 8 * H, e: T0 + 8.5 * H, godOrig: { e: T0 + 9 * H }, editedBy: "G" };
  s.hl.offline[T0 + 12 * H].deleted = true;
  const m = GE.mask(s.hl);
  assert.deepEqual(m.drv, [[T0 + 8 * H, T0 + 9 * H]]);
  assert.ok(m.off[String(T0 + 12 * H)]);
  assert.ok(!(String(T0 + 12 * H) in GE.live(s.hl.offline)));
  const row = { shifts: { a: { shiftStartedAt: T0 + 7 * H, shiftEndedAt: T0 + 13 * H, godOrig: { shiftStartedAt: T0 + 6 * H, shiftEndedAt: T0 + 14 * H } }, b: { shiftStartedAt: T0 + 15 * H, shiftEndedAt: T0 + 16 * H, deleted: true } } };
  const cuts = GE.shiftCuts([row]).map((c) => c.join("-")).sort();
  assert.deepEqual(cuts, [[T0 + 13 * H, T0 + 14 * H], [T0 + 15 * H, T0 + 16 * H], [T0 + 6 * H, T0 + 7 * H]].map((c) => c.join("-")).sort());
});

/* app.js: run the real godLogApply + hours functions (hosHistFromRows / hosDutySegs unchanged) on a fake phone */
function fnSrc(src, name) {
  const i = src.indexOf("function " + name + "("); assert.ok(i >= 0, name);
  let j = src.indexOf("{", i), d = 0;
  for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
test("70 h inputs: after a pull, a God-deleted shift, a shortened shift and a deleted Offline / edited drive flow into the hours code", () => {
  const app = read("app/app.js");
  const names = ["godLogApply", "hosSubtract", "hosMerge", "hosReadDrv", "hosWriteDrv", "hosReadBrk", "hosWriteBrk", "hosReadOff", "hosOffKey", "hosReadLog", "hosWriteLog", "hosHistFromRows", "hosDutySegs", "hosReadHist", "hosHistKey"];
  const store = {};
  const box = { window: {}, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, Intl, Date, JSON, Math, Number, String, Object, Array, isFinite, console };
  box.window.window = box.window; vm.createContext(box);
  vm.runInContext(read("app/driverlog.js"), box);
  vm.runInContext("var HOS_MIN_PIECE_MS = 120000, HOS_HEARTBEAT_GAP_MS = 1800000; function hosKey(){return 'k';} function hosDrvKey(){return 'kd';} function hosBrkKey(){return 'kb';} function hosShiftStart(){return 0;}\n" + names.map((n) => fnSrc(app, n)).join("\n"), box);
  /* phone's own copies */
  store.k = JSON.stringify({ [T0 + 6 * H]: { s: T0 + 6 * H, e: T0 + 14 * H, shift: T0 + 6 * H }, [T0 + 15 * H]: { s: T0 + 15 * H, e: T0 + 16 * H, shift: T0 + 15 * H } });
  store.kd = JSON.stringify([[T0 + 8 * H, T0 + 9 * H]]);
  store["k-off"] = JSON.stringify({ [T0 + 12 * H]: { s: T0 + 12 * H, e: T0 + 13 * H } });
  const rows = [{ shifts: { [T0 + 6 * H]: { shiftStartedAt: T0 + 7 * H, shiftEndedAt: T0 + 13 * H, godOrig: { shiftStartedAt: T0 + 6 * H, shiftEndedAt: T0 + 14 * H } }, [T0 + 15 * H]: { shiftStartedAt: T0 + 15 * H, shiftEndedAt: T0 + 16 * H, deleted: true } } }];
  const drv = { [T0 + 8 * H]: { s: T0 + 8 * H, e: T0 + 8.5 * H, godOrig: { e: T0 + 9 * H } } }, off = { [T0 + 12 * H]: { s: T0 + 12 * H, e: T0 + 13 * H, deleted: true } };
  const gx = box.godLogApply(rows, drv, {}, off);
  assert.deepEqual(Object.keys(gx.offline), [], "deleted Offline left out");
  assert.deepEqual(JSON.parse(store.kd), [], "phone's original driving span replaced by the server's edited one");
  assert.deepEqual(Object.keys(JSON.parse(store["k-off"])), [], "phone's copy of the deleted Offline dropped");
  const segs = box.hosHistFromRows(rows);
  store["k-hist"] = JSON.stringify({ segs: segs, drv: [] });
  const duty = box.hosDutySegs(T0 + 22 * H);
  assert.deepEqual(JSON.parse(JSON.stringify(duty)), [[T0 + 7 * H, T0 + 13 * H]], "only the edited 7 AM-1 PM shift is on duty (deleted 3-4 PM shift and cut hours gone)");
});

test("owner-only: the editor lives only in God mode and writes only through the Worker's /god/db with the God password / token", () => {
  const god = read("god/god.js"), app = read("app/app.js");
  const a = god.indexOf("var dle = {"), b = god.indexOf("window.__pcsGodLogEdit");
  assert.ok(a > 0 && b > a);
  const blk = god.slice(a, b);
  assert.ok(/fetch\(PAY_WORKER \+ "\/god\/db"/.test(blk), "writes go to /god/db");
  assert.ok(/godWriteAuth\(\)/.test(blk), "God password / token on every write");
  assert.equal((blk.match(/method: "(PUT|PATCH|DELETE)"/g) || []).length, 1, "the only write is the /god/db sign PUT op (inside ops)");
  assert.ok(!/baseUrl\(\)[^;]*method:/.test(blk), "no direct database write");
  assert.ok(god.indexOf('data-dl-edit="') > 0, "God driver card has the button");
  assert.equal(app.indexOf("data-dl-edit"), -1, "no editor in the driver app");
  assert.equal(app.indexOf("editOps("), -1);
  assert.equal(app.indexOf("deleteOps("), -1);
});

test("the day reads 'Edited, needs your signature' until it is signed again; God mode reuses the signature pad", () => {
  const dl = read("app/driverlog.js");
  assert.ok(dl.indexOf("Edited, needs your signature.") > 0);
  assert.ok(/meta\.canSign \|\| meta\.godSign/.test(dl));
});
