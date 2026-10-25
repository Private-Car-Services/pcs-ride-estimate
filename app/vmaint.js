/* v2.0f (Matthew 10/24; Harry r1 fixes): vehicle maintenance math shared by the driver app and God mode (rides/VHCLMNTC/{vehicleId}).
   Math is Matthew's "vehicle mileage" sheet, row for row:
     due = last + interval; miles left = due - current; days since = today - last date (calendar days, CT);
     avg mi/day = (current - last) / days since; days until = miles left / avg; projected date = today + days until.
   The date is a PROJECTION from the driver's average, never a fixed due date.
   Tire rotation interval is fixed at 10,000 mi (not editable). Oil interval is the driver's own (default 25,000).
   Flags: yellow when <= 1,000 mi left or <= 7 projected days; red when overdue.
   HARD BLOCK (no going online): oil more than 500 mi past its due mileage, or more than 11,000 mi since the last
   tire rotation. Cleared only by logging that service with an odometer >= the last one (and <= the current one).
   Harry r1: a record with a missing / blank / NaN oil.lastMiles or rot.lastMiles is INVALID and counts as blocked.
   A driver can't raise the oil interval while blocked or within 1,000 mi of due (God mode still can). */
(function (root) {
  var ROT_INTERVAL = 10000, OIL_DEFAULT = 25000, OIL_BLOCK_OVER = 500, ROT_BLOCK_SINCE = 11000, WARN_MI = 1000, WARN_DAYS = 7;
  /* PENDING MATTHEW: a driver with NO maintenance record at all. false = not blocked (default); true = blocked from going online. */
  var NO_RECORD_BLOCKS = false;
  var FLUIDS = [["oil", "Oil", "Oil"], ["coolant", "Coolant", "Coolant"], ["brake", "Brake", "Brake"], ["trans", "Transmission", "Trans"], ["ps", "Power steering", "P/S"]]; /* [key, long, short label] */
  var LEVELS = ["OK", "Low", "Topped off"];
  function num(x) { if (x == null || x === "") return null; x = Number(String(x).replace(/[,\s]/g, "")); return isFinite(x) ? x : null; }
  function ymdOk(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if (!m) return false; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; }
  function ymdToDay(s) { if (!ymdOk(s)) return null; var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function dayToYmd(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function ctToday(now) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now || Date.now())); }
  function oilInterval(v) { var i = num(v && v.oil && v.oil.interval); return i && i >= 1000 && i <= 50000 ? Math.round(i) : OIL_DEFAULT; }
  function one(s, interval, cur, today) {
    s = s || {}; var last = num(s.lastMiles), lastDay = ymdToDay(s.lastDate), tDay = ymdToDay(today);
    var o = { interval: interval, last: last, lastDate: ymdOk(s.lastDate) ? s.lastDate : "", cur: cur, due: null, left: null, since: null, daysSince: null, avg: null, daysUntil: null, projected: "", status: "unknown" };
    if (!(last > 0)) return o;
    o.due = last + interval;
    if (!(cur > 0)) return o;
    o.left = o.due - cur; o.since = cur - last;
    if (lastDay != null && tDay != null) o.daysSince = tDay - lastDay;
    if (o.daysSince > 0 && o.since > 0) { o.avg = o.since / o.daysSince; o.daysUntil = o.left / o.avg; o.projected = dayToYmd(tDay + Math.floor(o.daysUntil)); }
    o.status = o.left <= 0 ? "red" : (o.left <= WARN_MI || (o.daysUntil != null && o.daysUntil <= WARN_DAYS)) ? "yellow" : "green";
    return o;
  }
  function compute(v, cur, now) {
    v = v || {}; cur = num(cur); var today = ctToday(now);
    var oil = one(v.oil, oilInterval(v), cur, today), rot = one(v.rot, ROT_INTERVAL, cur, today), blocks = [];
    if (oil.left != null && oil.left < -OIL_BLOCK_OVER) blocks.push({ kind: "oil", why: "Oil change is " + Math.round(-oil.left).toLocaleString("en-US") + " mi past due (limit 500). Log the oil change to go online." });
    if (!(oil.last > 0)) blocks.push({ kind: "oil", invalid: true, why: "Oil change record is missing a valid last odometer. Log the oil change to go online." });
    if (!(rot.last > 0)) blocks.push({ kind: "rot", invalid: true, why: "Tire rotation record is missing a valid last odometer. Log the tire rotation and balance to go online." });
    if (rot.since != null && rot.since > ROT_BLOCK_SINCE) blocks.push({ kind: "rot", why: "Tires are " + Math.round(rot.since).toLocaleString("en-US") + " mi since the last rotation (limit 11,000). Log the tire rotation and balance to go online." });
    return { today: today, cur: cur, oil: oil, rot: rot, blocks: blocks, worst: [oil.status, rot.status].indexOf("red") >= 0 ? "red" : [oil.status, rot.status].indexOf("yellow") >= 0 ? "yellow" : "green" };
  }
  /* a new service entry: odometer >= the last one (and not above the current odometer + 50 typo slack); date a real day, not in the future */
  function checkService(v, kind, odo, date, cur, now) {
    var s = (v && v[kind]) || {}, last = num(s.lastMiles), o = num(odo);
    if (!(o > 0) || Math.round(o) !== o) return "Enter the odometer in whole miles.";
    if (last > 0 && o < last) return "Odometer must be at least the last " + (kind === "oil" ? "oil change" : "rotation") + " (" + last.toLocaleString("en-US") + ").";
    if (num(cur) > 0 && o > num(cur) + 50) return "Odometer is above your latest inspection odometer (" + num(cur).toLocaleString("en-US") + ").";
    if (!ymdOk(date)) return "Enter the date.";
    if (date > ctToday(now)) return "Date can't be in the future.";
    if (s.lastDate && ymdOk(s.lastDate) && date < s.lastDate) return "Date is before the last one (" + s.lastDate + ").";
    return "";
  }
  /* driver interval change: 1,000-50,000; an INCREASE is refused while blocked or within 1,000 mi of due (God mode is not limited) */
  function checkInterval(v, n, cur, now) {
    n = num(n); if (!(n >= 1000 && n <= 50000) || Math.round(n) !== n) return "Oil interval must be 1,000\u201350,000 mi.";
    if (n > oilInterval(v)) { var c = compute(v, cur, now); /* r2: no / NaN current odometer = can't prove it's safe, refused */
      if (!c.blocks.length && (!(c.cur > 0) || c.oil.left == null)) return "Can't confirm your current odometer yet. Finish a shift with an odometer reading, then raise the interval.";
      if (c.blocks.length || c.oil.status !== "green") return "You can't raise the oil interval while blocked or when the oil change is due soon (within 1,000 mi or about 7 days). Log the oil change first (God mode can change it)."; } /* v2.0i: same yellow rule as the card (1,000 mi OR 7 days) */
    return "";
  }
  var CUR_SKEW_MS = 600000, CUR_DAYS = 60, CUR_KEEP = 10;
  function curFrom(rec, days, now) { /* r3: the latest ENTERED odometer by time = Worker vmCurFrom (same rule; test asserts agreement).
     Day keys must be real YYYY-MM-DD dates in the last CUR_DAYS days (not after tomorrow); only the latest CUR_KEEP valid dates count,
     so a junk / 9999-12-31 key can't take a slot. A reading stamped after now + CUR_SKEW_MS is ignored. */
    now = Number(now) || Date.now(); var ents = [], lim = now + CUR_SKEW_MS;
    var add = function (o, at, src) { o = Number(o); at = Number(at); if (isFinite(o) && o > 0 && isFinite(at) && at > 0 && at <= lim) ents.push({ cur: o, at: at, src: src }); };
    var ov = rec && rec.odoOverride; if (ov) add(ov.miles, ov.at || ov.grantedAt, "God override");
    var lo = new Date(now - CUR_DAYS * 86400000).toISOString().slice(0, 10), hi = new Date(now + 86400000).toISOString().slice(0, 10), rows = [];
    Object.keys(days && typeof days === "object" ? days : {}).forEach(function (k) { var ymd = String(k).split("/").pop(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
      if (!m) return; var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3] || ymd < lo || ymd > hi) return;
      rows.push({ ymd: ymd, d: days[k] }); });
    var keep = rows.map(function (r) { return r.ymd; }).filter(function (y, i, a) { return a.indexOf(y) === i; }).sort().slice(-CUR_KEEP);
    rows.forEach(function (r) { var d = r.d; if (keep.indexOf(r.ymd) < 0 || !d || typeof d !== "object") return;
      if (!d.odoFromLastEnd) add(d.startOdometer, d.shiftStartAt || d.startedAt, "opening odometer"); /* odoFromLastEnd = copied, not entered */
      if (d.shiftClosed || d.endOdometer != null) add(d.endOdometer, d.closedAt || d.staleClosedAt || d.lastUpdate, "ending odometer");
      var sh = d.shifts && typeof d.shifts === "object" ? d.shifts : {};
      Object.keys(sh).forEach(function (k) { var x = sh[k]; if (!x || typeof x !== "object") return;
        add(x.startOdo, x.shiftStartedAt, "shift opening odometer"); if (!x.skippedEnd && !x.missingEnd) add(x.endOdo, x.shiftEndedAt, "shift ending odometer"); }); });
    ents.sort(function (a, b) { return a.at - b.at; });
    return ents.length ? ents[ents.length - 1] : { cur: null, at: 0, src: "" };
  }
  /* v2.0g (Matthew 10/24): the maintenance log is back-loaded from the driver's LATEST INSPECTION FORM (pre/post-trip DVIR).
     dvir = { "YYYY-MM-DD": { pre, post, earlier: {k: rec} } }; rec = { at, odometer, plate, items: { oil, coolant, tread, pressure, tiredamage: {v|value|answer} } }.
     Current miles = that inspection's odometer (driver-entered; never GPS / shift-tracked). A jump of more than 1,000 mi over the
     previous inspection is a WARNING only (never a block). The form has no brake / trans / P/S fluid and no tire-rotation field:
     those stay driver-entered in the log. plate: see the v2.0i rule below (only rows whose plate matches the vehicle count; a blank plate never matches). */
  var JUMP_WARN_MI = 1000;
  function ans(it) { if (it == null) return ""; if (typeof it !== "object") return String(it); return String(it.v != null ? it.v : it.value != null ? it.value : it.answer != null ? it.answer : it.choice != null ? it.choice : ""); }
  function normPlate(p) { return String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  /* v2.0i (Harry r4 #2/#3): ONE per-plate current-mileage rule, identical in the app, God mode, the Worker (vmInspCur), the cron and
     the heads-up bar. Source = inspection rows (pre / post / same-day earlier) of the vehicle's driver(s); NO date window (every valid
     YYYY-MM-DD key counts, e.g. 2025-01-01), a row stamped after now + CUR_SKEW_MS is ignored.
     - The vehicle's plate must be set AND equal the row's plate (normalized). A blank plate on either side never matches.
     - Rows are taken oldest-first; a reading LOWER than the previous accepted reading for that plate is ignored (not cur) unless
       God mode accepted that exact reading (accepts = rec.odoAccept: { key: { odo, at, by } }, logged).
     - A jump of more than JUMP_WARN_MI over the previous accepted reading is a warning only. */
  function inspRows(dvirs, plate, now) {
    var want = normPlate(plate), rows = [], seen = {}, hi = new Date(now + 86400000).toISOString().slice(0, 10); if (!want) return rows; /* no lower window; a key after tomorrow (e.g. 9999-12-31) never counts */
    (Array.isArray(dvirs) ? dvirs : [dvirs]).forEach(function (dvir) {
      Object.keys(dvir && typeof dvir === "object" ? dvir : {}).forEach(function (d) { var day = dvir[d]; if (!day || typeof day !== "object" || !ymdOk(d) || d > hi) return;
        var push = function (r) { if (!r || typeof r !== "object") return; var at = Number(r.at), o = Number(r.odometer);
          if (!(at > 0) || at > now + CUR_SKEW_MS || !(o > 0) || normPlate(r.plate) !== want) return;
          var k = at + ":" + o; if (seen[k]) return; seen[k] = 1; rows.push({ r: r, day: d, at: at, odo: o }); };
        push(day.pre); push(day.post); Object.keys(day.earlier && typeof day.earlier === "object" ? day.earlier : {}).sort().forEach(function (k) { push(day.earlier[k]); }); }); });
    rows.sort(function (a, b) { return a.at - b.at || a.odo - b.odo; });
    return rows;
  }
  function acceptedSet(accepts) { var m = {}; Object.keys(accepts && typeof accepts === "object" ? accepts : {}).forEach(function (k) { var x = accepts[k], o = Number(x && typeof x === "object" ? x.odo : x); if (o > 0) m[o] = 1; }); return m; }
  function fromInspection(dvirs, plate, now, accepts) {
    now = Number(now) || Date.now();
    var rows = inspRows(dvirs, plate, now), acc = acceptedSet(accepts), last = null, prev = null, ignored = [];
    rows.forEach(function (x) { if (last && x.odo < last.odo && !acc[x.odo]) { ignored.push({ odo: x.odo, at: x.at, day: x.day, below: last.odo }); return; } prev = last; last = x; });
    if (!last) return null;
    var r = last.r, it = r.items || {}, odo = last.odo, pv = prev ? prev.odo : null;
    var lvl = function (k) { var a = ans(it[k]); return a === "Full" ? "OK" : a === "Low" ? "Low" : ""; };
    var lateIgn = ignored.filter(function (g) { return g.at > last.at; });
    var out = { cur: odo, at: last.at, date: last.day, kind: r.kind || "", plate: normPlate(plate), src: (r.kind === "post" ? "post-trip" : "pre-trip") + " inspection", prev: pv,
      fluids: { oil: lvl("oil"), coolant: lvl("coolant") }, tires: { tread: ans(it.tread), pressure: ans(it.pressure), damage: ans(it.tiredamage) }, warn: "", ignored: lateIgn };
    if (pv > 0 && odo - pv > JUMP_WARN_MI) out.warn = "Odometer jumped " + Math.round(odo - pv).toLocaleString("en-US") + " mi since the previous inspection (" + pv.toLocaleString("en-US") + "). Check the reading.";
    if (lateIgn.length) { var g = lateIgn[lateIgn.length - 1]; out.warn = "Your latest inspection odometer (" + g.odo.toLocaleString("en-US") + ") is lower than the accepted reading (" + odo.toLocaleString("en-US") + ") for this plate, so it is not used. If it's right, ask God mode to accept it."; }
    return out;
  }
  function inspCur(dvirs, plate, now, accepts) { var i = fromInspection(dvirs, plate, now, accepts); return i ? i.cur : null; }

  /* r2: the NO_RECORD_BLOCKS rule (L15) as a block check. n = how many records this driver has (null = not loaded yet: no block) */
  function noRecordBlocks(n) { return NO_RECORD_BLOCKS && n === 0 ? [{ id: "", car: "", kind: "none", why: "No maintenance record is on file for your vehicle. Ask God mode to add it." }] : []; }
  function checkFluids(f, now) {
    if (!f || !ymdOk(f.date)) return "Enter the date.";
    if (f.date > ctToday(now)) return "Date can't be in the future.";
    for (var i = 0; i < FLUIDS.length; i++) if (LEVELS.indexOf(f[FLUIDS[i][0]]) < 0) return "Pick a level for " + FLUIDS[i][1] + ".";
    return "";
  }
  var api = { curFrom: curFrom, fromInspection: fromInspection, inspCur: inspCur, inspRows: inspRows, JUMP_WARN_MI: JUMP_WARN_MI, NO_RECORD_BLOCKS: NO_RECORD_BLOCKS, WARN_DAYS: WARN_DAYS, checkInterval: checkInterval, noRecordBlocks: noRecordBlocks, ROT_INTERVAL: ROT_INTERVAL, OIL_DEFAULT: OIL_DEFAULT, FLUIDS: FLUIDS, LEVELS: LEVELS, compute: compute, oilInterval: oilInterval, checkService: checkService, checkFluids: checkFluids, ctToday: ctToday, ymdOk: ymdOk };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCSVM = api;
})(typeof window !== "undefined" ? window : this);
