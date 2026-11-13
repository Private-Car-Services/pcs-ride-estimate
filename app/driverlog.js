/* v73 (Matthew 10/13): PCS Driver's Log (RODS-style 24-hour duty-status grid). Shared by the driver app and God mode.
   Pure: builds days from HOS records; nothing here writes or deletes data. Older-than-10-day data stays on file. */
(function () {
  "use strict";
  var TZ = "America/Chicago", MIN = 60000, DAY_MIN = 1440;
  var CARRIER = { name: "Private Taxi Services LLC", office: "502 W. Montgomery St., Unit 121, Willis, TX 77378" };
  var ROWS = [["off", "OFF"], ["sb", "SB"], ["drv", "D"], ["on", "ON"]]; /* Motive-style; SB stays 0 for PCS; Break = OFF */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ymd(ms) { var p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); return p; }
  function addDays(d, n) { var t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
  /* Chicago midnight of a YYYY-MM-DD (DST-safe) */
  function midnight(d) {
    var base = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    for (var h = 4; h <= 7; h++) { var t = base + h * 3600000; if (ymd(t) === d && ymd(t - 3600000) !== d) return t; }
    return base + 5 * 3600000;
  }
  function norm(list) { return (list || []).map(function (x) { return Array.isArray(x) ? [Number(x[0]), Number(x[1])] : [Number(x.s), Number(x.e || x.s)]; }).filter(function (x) { return x[1] > x[0]; }); }
  function paint(arr, list, t0, code) {
    list.forEach(function (iv) {
      var a = Math.max(0, Math.floor((iv[0] - t0) / MIN)), b = Math.min(arr.length, Math.ceil((iv[1] - t0) / MIN));
      for (var i = a; i < b; i++) arr[i] = code;
    });
  }
  /* data: { duty, drive, breaks, offline (intervals [s,e] or {s,e}), rows: {day: miles row}, overrides: [{at, by, reason, kind}],
     driver, vehicle: {year, make, model, plate}, now, days (default 10) } */
  function build(data) {
    var now = Number(data.now) || Date.now(), n = data.days || 15, today = ymd(now), out = [];
    var duty = norm(data.duty), drive = norm(data.drive), brk = norm(data.breaks), off = norm(data.offline);
    for (var k = 0; k < n; k++) {
      var d = addDays(today, -k), t0 = midnight(d), t1 = midnight(addDays(d, 1));
      var len = Math.round((t1 - t0) / MIN), arr = new Array(len);
      for (var i = 0; i < len; i++) arr[i] = "off";
      paint(arr, duty, t0, "on"); paint(arr, drive, t0, "drv"); paint(arr, brk, t0, "off"); /* PCS: Break is off duty */ paint(arr, off, t0, "off");
      var future = d === today ? Math.max(0, Math.ceil((now - t0) / MIN)) : len; /* nothing logged after "now" */
      var tot = { off: 0, sb: 0, drv: 0, on: 0 }, segs = [], cur = null;
      var snap = (data.snapshots || {})[d];
      if (snap && Array.isArray(snap.segs) && !hasRaw(d, t0, t1, duty, drive, brk, off)) { /* saved day record (permanent) when the raw records are no longer here */
        for (i = 0; i < len; i++) arr[i] = "off";
        snap.segs.forEach(function (x) { for (var m = Math.max(0, x[1]); m < Math.min(len, x[2]); m++) arr[m] = x[0] === "brk" ? "off" : x[0]; });
      }
      for (i = 0; i < future; i++) { tot[arr[i]]++; if (!cur || cur.c !== arr[i]) { cur = { c: arr[i], a: i, b: i + 1 }; segs.push(cur); } else cur.b = i + 1; }
      /* totals always cover the full midnight-to-midnight day: the rest of today counts in the current status */
      var restC = data.currentStatus && tot[data.currentStatus] != null && data.currentStatus !== "sb" ? data.currentStatus : (cur ? cur.c : "off");
      tot[restC] += len - future;
      var row = (data.rows || {})[d] || null, odo = odoOf(row);
      var edits = editsOf(row).concat((data.overrides || []).filter(function (o) { var t = Number(o.at || o.grantedAt) || 0; return o.logDay ? o.logDay === d : t >= t0 && t < t1; }) /* v2.0m-bq: a God log edit shows on the day it changed */.map(function (o) {
        return { at: Number(o.at || o.grantedAt), what: (o.auto ? "" : "God mode ") + (o.kind || "override") + (o.logDay && o.what ? ": " + o.what : "") + (o.hours ? " (" + o.hours + " h)" : ""), by: o.by || "God mode", reason: o.reason || "" };
      }));
      out.push({ restCode: restC, day: d, start: t0, minutes: len, upTo: future, segs: segs, totals: tot, odo: odo, edits: edits });
    }
    return out;
  }
  function hasRaw(d, t0, t1) { for (var a = 3; a < arguments.length; a++) { if (arguments[a].some(function (x) { return x[0] < t1 && x[1] > t0; })) return true; } return false; }
  /* compact permanent record of a finished day: [[code, fromMin, toMin], ...] + totals */
  function snapshot(day) { return { day: day.day, segs: day.segs.map(function (x) { return [x.c, x.a, x.b]; }), totals: day.totals, odo: day.odo, savedAt: Date.now() }; }
  function odoOf(row) {
    if (!row || typeof row !== "object") return { start: null, end: null, miles: null };
    var s = num(row.startOdometer), e = num(row.endOdometer);
    var sh = row.shifts && typeof row.shifts === "object" ? row.shifts : {};
    Object.keys(sh).forEach(function (k) { var x = sh[k] || {}; var a = num(x.startOdometer), b = num(x.endOdometer); if (a != null && (s == null || a < s)) s = a; if (b != null && (e == null || b > e)) e = b; });
    var miles = s != null && e != null && e >= s ? Math.round((e - s) * 10) / 10 : (num(row.gpsMiles) != null ? num(row.gpsMiles) : null);
    return { start: s, end: e, miles: miles, gps: s != null && e == null };
  }
  function num(v) { return v != null && v !== "" && isFinite(Number(v)) ? Number(v) : null; }
  function editsOf(row) {
    var out = [];
    if (!row || typeof row !== "object") return out;
    if (row.odoRepaired) out.push({ at: Number(row.odoRepaired.at) || 0, what: "Opening odometer corrected " + row.odoRepaired.from + " \u2192 " + row.odoRepaired.to, by: row.odoRepaired.by || "app", reason: row.odoRepaired.why || row.odoRepaired.reason || "" });
    var sh = row.shifts && typeof row.shifts === "object" ? row.shifts : {};
    Object.keys(sh).forEach(function (k) {
      var x = sh[k] || {};
      if (x.hosExcluded) out.push({ at: Number(x.hosExcludedAt || k) || 0, what: "Shift excluded from HOS", by: x.hosExcludedBy || x.editedBy || "God mode", reason: x.hosExcludedReason || x.reason || x.editReason || "" });
      if ((x.editedBy || x.editReason || x.godEdit) && !x.godOrig && !x.deleted) out.push({ at: Number(x.editedAt || k) || 0, what: "Shift edited in God mode", by: x.editedBy || "God mode", reason: x.editReason || x.reason || "" });
      if (x.odoRepaired) out.push({ at: Number(x.odoRepaired.at) || 0, what: "Odometer corrected " + x.odoRepaired.from + " \u2192 " + x.odoRepaired.to, by: x.odoRepaired.by || "app", reason: x.odoRepaired.why || "" });
    });
    return out;
  }
  function hm(m) { return Math.floor(m / 60) + ":" + ("0" + (m % 60)).slice(-2); }
  function dec(m) { var v = (m / 60).toFixed(2); return v.length < 5 ? "0" + v : v; }
  function hrmin(m) { return Math.floor(m / 60) + " hr, " + (m % 60) + " min"; }
  function dur(m) { return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"; }
  function tzAbbr(ms) { try { return new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" }).formatToParts(new Date(ms)).filter(function (p) { return p.type === "timeZoneName"; })[0].value; } catch (e) { return "CT"; } }
  function tclock(ms) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) + " " + tzAbbr(ms); }
  function clock(ms) { try { return new Date(ms).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " " + tzAbbr(ms); } catch (e) { return ""; } }
  function wd(day, o) { return new Date(day.start + 12 * 3600000).toLocaleDateString("en-US", Object.assign({ timeZone: TZ }, o)).toUpperCase(); }
  var BADGE = { off: ["OFF", "#555"], sb: ["SB", "#8a6d3b"], drv: ["D", "#7cb342"], on: ["ON", "#5b8bd0"] };
  function badge(c) { var b = BADGE[c]; return '<span class="dl-badge dl-b-' + c + '" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:' + b[1] + ';color:#fff;font-size:10px;font-weight:700;flex:none">' + b[0] + "</span>"; }
  function onMin(d) { return d.totals.drv + d.totals.on; }
  /* Motive-style 24 h grid: OFF / SB / D / ON, M..N..M hour ticks, blue status line, decimal hour totals on the right */
  function gridSvg(day) {
    var W = 720, L = 40, R = 56, RH = 28, top = 18, gw = W - L - R, per = gw / day.minutes, y = {}, p = [];
    ROWS.forEach(function (r, i) { y[r[0]] = top + i * RH + RH / 2; });
    p.push('<svg class="dl-grid" viewBox="0 0 ' + W + " " + (top + 4 * RH + 4) + '" role="img" aria-label="Duty status grid ' + esc(day.day) + '" style="width:100%;display:block;background:#fff">');
    for (var h = 0; h <= 24; h++) {
      var x = L + h * 60 * per;
      p.push('<text x="' + x + '" y="12" font-size="10" fill="#666" text-anchor="middle">' + (h === 0 || h === 24 ? "M" : h === 12 ? "N" : h % 12) + "</text>");
      p.push('<line x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + (top + 4 * RH) + '" stroke="#999" stroke-width="0.8"/>');
      if (h < 24) ROWS.forEach(function (r, i) { for (var q = 1; q < 4; q++) { var xq = x + q * 15 * per, yb = top + (i + 1) * RH; p.push('<line x1="' + xq + '" y1="' + yb + '" x2="' + xq + '" y2="' + (yb - (q === 2 ? 10 : 6)) + '" stroke="#aaa" stroke-width="0.6"/>'); } });
    }
    ROWS.forEach(function (r, i) {
      p.push('<rect x="' + L + '" y="' + (top + i * RH) + '" width="' + gw + '" height="' + RH + '" fill="none" stroke="#999" stroke-width="0.8"/>');
      p.push('<text x="' + (L - 6) + '" y="' + (top + i * RH + 18) + '" font-size="12" fill="#333" text-anchor="end">' + r[1] + "</text>");
      p.push('<text class="dl-tot-' + r[0] + '" x="' + (W - 4) + '" y="' + (top + i * RH + 18) + '" font-size="12" fill="#333" text-anchor="end">' + dec(day.totals[r[0]]) + "</text>");
    });
    var path = "", started = false;
    day.segs.forEach(function (s) { var x1 = L + s.a * per, x2 = L + s.b * per, yy = y[s.c]; path += (started ? " L" : "M") + x1.toFixed(1) + " " + yy + " L" + x2.toFixed(1) + " " + yy; started = true; });
    if (path) p.push('<path class="dl-line" d="' + path + '" fill="none" stroke="#2f6fe0" stroke-width="2.6"/>');
    p.push("</svg>");
    return p.join("");
  }
  function events(day, meta) {
    return day.segs.map(function (s) { var t = day.start + s.a * MIN; var c = meta.cityAt ? meta.cityAt(t) : ""; return { c: s.c, at: t, min: s.b - s.a, city: c || "" }; });
  }
  function eventsHtml(day, meta) {
    return '<ul class="dl-events" style="list-style:none;margin:0;padding:0">' + events(day, meta).map(function (e) {
      return '<li class="dl-ev" style="display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid #ddd;background:#fff">' + badge(e.c) +
        '<div><div><span class="dl-ev-time">' + esc(tclock(e.at)) + '</span> <span style="color:#595959">|</span> <span class="dl-ev-dur">' + esc(dur(e.min)) + "</span></div>" +
        '<div class="dl-ev-city" style="color:#666;font-size:13px">' + esc(e.city || "Location not recorded") + "</div></div></li>";
    }).join("") + "</ul>";
  }
  function formHtml(day, meta) {
    var v = meta.vehicle || {}, o = day.odo;
    var veh = [v.year, v.make, v.model].filter(Boolean).join(" ") || "not on file";
    var row = function (k, val, cls) { return '<tr><th style="text-align:left;padding:6px;color:#666;font-weight:400;width:40%">' + esc(k) + '</th><td class="' + (cls || "") + '" style="padding:6px">' + val + "</td></tr>"; };
    return '<table class="dl-form" style="width:100%;border-collapse:collapse;background:#fff;font-size:14px">' +
      row("Driver", "<b>" + esc(meta.driver || "") + "</b>", "dl-f-driver") + row("Carrier", esc(CARRIER.name), "dl-f-carrier") + row("Main office", esc(CARRIER.office), "dl-f-office") +
      row("Vehicle", esc(veh), "dl-f-veh") + row("Plate", esc(v.plate || "not on file"), "dl-f-plate") + row("VIN", esc(v.vin || "not on file"), "dl-f-vin") +
      row("Odometer start", o.start != null ? o.start.toFixed(1) : "\u2014", "dl-odo-s") + row("Odometer end", o.end != null ? o.end.toFixed(1) : (o.start != null ? "open shift" : "\u2014"), "dl-odo-e") +
      row("Miles", o.miles != null ? String(o.miles) : "\u2014", "dl-miles") +
      row("Hours", "OFF " + dec(day.totals.off) + " \u00b7 SB " + dec(day.totals.sb) + " \u00b7 D " + dec(day.totals.drv) + " \u00b7 ON " + dec(day.totals.on) + " (Break counts as OFF)", "dl-totals") +
      row("24-hour period", "Midnight to midnight, Central time", "") +
      row("God-mode edits / overrides", day.edits.length ? '<ul class="dl-edits" style="margin:0;padding-left:18px">' + day.edits.map(function (e) { return "<li>" + esc(clock(e.at)) + ": " + esc(e.what) + " \u00b7 by " + esc(e.by) + " \u00b7 reason: " + esc(e.reason || "(none logged)") + "</li>"; }).join("") + "</ul>" : '<span class="dl-noedits">None</span>', "") +
      "</table>";
  }
  var CERT = "I hereby certify that my data entries and my record of duty status for this day are true and correct";
  function dayHash(day) { var t = JSON.stringify([day.segs.map(function (x) { return [x.c, x.a, x.b]; }), day.odo.start, day.odo.end, day.edits.length]), h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); }
  function sigState(day, meta) { var r = meta.signOf ? meta.signOf(day.day) : null; if (!r || !r.img) return { r: null, stale: false }; var live = day.upTo >= day.minutes ? dayHash(day) : r.hash; return { r: r, stale: r.hash !== live }; }
  function signHtml(day, meta) {
    var ss = sigState(day, meta), r = ss.r, raw = meta.signOf ? meta.signOf(day.day) : null, needs = !r && !!(raw && raw.needsSign); /* v2.0m-bq: a God edit cleared the signature */
    return '<div class="dl-sign" style="background:#fff;padding:16px;text-align:center;color:#444">' +
      '<p class="dl-cert" style="margin:0 0 12px">' + CERT + "</p>" +
      (r && !ss.stale ? '<img class="dl-sig-img" alt="Signature" src="' + esc(r.img) + '" style="max-width:100%;height:160px;object-fit:contain"><div style="border-top:1px solid #333;margin:0 0 8px"></div>' +
          '<p class="dl-signed" style="font-size:13px">Signed by ' + esc(meta.driver || "") + " on " + esc(clock(r.at)) + "</p>"
        : (needs ? '<p class="dl-resign dl-needs-sign" style="color:#b91c1c;font-weight:700">Edited, needs your signature.</p>' : ss.stale ? '<p class="dl-resign" style="color:#b91c1c;font-weight:700">This day was edited after it was signed. Please sign again.</p>' : "") +
          (meta.canSign || meta.godSign ? '<canvas id="dl-sig-pad" width="680" height="170" style="width:100%;height:170px;touch-action:none;display:block"></canvas><div style="border-top:1px solid #333"></div>' +
            '<p style="margin:10px 0"><a href="#" id="dl-sig-clear" style="color:#2f6fe0;text-decoration:none">Clear Signature</a></p>' +
            '<button type="button" id="dl-sig-save" data-day="' + esc(day.day) + '" style="background:#2f6fe0;color:#fff;border:0;border-radius:8px;padding:10px 18px">Save signature</button>'
            : '<p class="dl-unsigned">Not signed yet.</p>')) + "</div>";
  }
  /* DVIR (49 CFR 396.11 / 396.13) adapted for a passenger car / SUV */
  /* Matthew 10/13 FINAL checklist (default; God mode edits it at rides/DVIRCFG). A "bad" answer = defect (flagged in God mode,
     notes + photo; v74: safety items block until God clears, others flag only). Date items are remembered per vehicle and prefilled next time. */
  var WK = [["Working", 0], ["Not working", 1]], LF = [["Low", 1], ["Full", 0]], YN_NOBAD = [["Yes", 0], ["No", 1]], YN_YESBAD = [["Yes", 1], ["No", 0]];
  function ch(k, label, opts, group, extra) { return Object.assign({ k: k, label: label, group: group || "", type: "choice", opts: opts.map(function (o) { return { label: o[0], bad: !!o[1] }; }), required: true }, extra || {}); }
  /* v77.9 (Matthew 10/20): the car wash is a post-trip Yes/No question (removed from the pre-trip). Yes records today as the
     driver's last wash (per vehicle + per driver). The 3-day rule (block, God override) is unchanged. */
  var WASH_WARN = "Cars must be washed at least once every three days, or the account will not be able to go online.";
  var WASHQ = { k: "carwash", label: "Did you get your car washed today?", type: "choice", opts: [{ label: "Yes", bad: false }, { label: "No", bad: true }], required: true, kinds: ["post"], washQ: true, noteOnly: true, noPhoto: true, noCamera: true, vehicle: true, block: true, maxAgeDays: 3 };
  function washLastText(v) { var t = parseMdy(v); if (t == null) return "not recorded yet"; var d = ymd(t + 3 * 3600000); return d.slice(5, 7) + "/" + d.slice(8, 10) + "/" + d.slice(0, 4); }
  function washWarnText(last) { return WASH_WARN + " Last car wash: " + washLastText(last) + "."; }
  var DVIR = [
    ch("lowbeam", "Low beam", WK, "Headlights", { block: true }), ch("highbeam", "High beam", WK, "Headlights", { block: true }),
    ch("turn", "Turn signals and hazards", WK, "", { block: true }), ch("brakelights", "Brake lights", WK, "", { block: true }), ch("taillights", "Taillights", WK), ch("brakes", "Brakes", WK, "", { block: true }), ch("brakenoise", "Do the wheels make a scratching or grinding noise while driving at low speeds?", YN_YESBAD, "", { sub: true, noPhoto: true, noCamera: true, warn: "A brake job may be necessary before continuing operation." }), /* v74: flag + warning; blocking OFF until Matthew decides (God editor toggle) */ ch("ebrake", "Emergency / parking brake", WK, "", { block: true }),
    ch("oil", "Engine oil", LF, "Fluids", { block: true }), ch("brakefluid", "Brake fluid", LF, "Fluids", { block: true }), /* v2.0k r2 (Matthew 10/25): fluids = Engine oil + Brake fluid (coolant removed) */ /* block = blocks while the fluids check is overdue; a Low answer only flags */
    ch("tread", "Tread 3/32\u2033 minimum", YN_NOBAD, "Tires"), ch("pressure", "Pressure 32 psi minimum", YN_NOBAD, "Tires"), ch("tiredamage", "Damage", YN_YESBAD, "Tires"),
    ch("belts", "Seat belts", WK),
    ch("wscracks", "Cracks", YN_YESBAD, "Windshield", { block: true, photoApprove: true }), /* v74: blocked until God approves the live photo */
    ch("wipercracked", "Cracked", YN_YESBAD, "Wipers"), ch("wiperworking", "Working", YN_NOBAD, "Wipers"),
    ch("mirrorcracked", "Cracked", YN_YESBAD, "Mirrors"), ch("mirrorworking", "Working", YN_NOBAD, "Mirrors"),
    ch("horn", "Horn working", YN_NOBAD, "", { block: true }), ch("doors", "Doors and locks working", YN_NOBAD),
    ch("dash", "Dash warning lights on", YN_YESBAD, "", { text: true, textLabel: "Which warning lights?", noPhoto: true, noCamera: true }),
    ch("interior", "Interior clean", YN_NOBAD), ch("exterior", "Exterior clean", YN_NOBAD),
    ch("fulltank", "Full tank of gas", YN_NOBAD, "", { kinds: ["post"], noteOnly: true }), /* v74 (Matthew): post-trip only; No = a note in God mode, never unsafe */
    WASHQ, /* v77.9 (Matthew 10/20): post-trip only "Did you get your car washed today?" Yes = today becomes the last wash date */
    { k: "regexp", label: "Registration expiration (month/year)", type: "date", monthYear: true, required: true, vehicle: true, expiry: true },
    { k: "insexp", label: "Insurance card expiration date", type: "date", required: true, vehicle: true, expiry: true }
  ];
  var DVIR_EXTRAS = [];
  function norm1(x) {
    if (Array.isArray(x)) return ch(String(x[0]), String(x[1]), YN_NOBAD, "", { required: x[2] !== false }); /* old [key, label, required] -> OK/Defect style Yes/No */
    if (!x || !x.k || !x.label) return null;
    if (x.k === "carwash") return Object.assign({}, WASHQ, { block: x.block !== false, maxAgeDays: Number(x.maxAgeDays) > 0 ? Number(x.maxAgeDays) : 3 }); /* v77.9: an older God checklist (date item) reads as the post-trip question */
    var o = Object.assign({}, x); o.type = o.type === "date" ? "date" : "choice"; if (o.k === "regexp") o.monthYear = true; /* v75: MM/YYYY even with a God-edited checklist */ o.required = o.required !== false;
    if (o.type === "choice" && !(Array.isArray(o.opts) && o.opts.length)) o.opts = [{ label: "OK", bad: false }, { label: "Defect", bad: true }];
    return o;
  }
  /* v74 (Matthew): Fluids are NOT daily. Due on Sat/Sun if not done that weekend, any day once >= N days (default 7) since the last check, or never checked. */
  function addDays(ds, n) { var d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fluidsDue(last, now, days) {
    days = Math.max(1, Math.round(Number(days) || 7)); now = now || Date.now();
    var today = ymd(now), wd = new Date(today + "T12:00:00Z").getUTCDay(), lt = parseMdy(last);
    var md = function (ds) { return ds.slice(5, 7) + "/" + ds.slice(8, 10); };
    if (lt == null) return { due: true, why: "never", days: days };
    var lds = ymd(lt + 3600000), since = Math.round((new Date(today + "T12:00:00Z") - new Date(lds + "T12:00:00Z")) / 864e5);
    var lwd = new Date(lds + "T12:00:00Z").getUTCDay(), nextSat = addDays(lds, ((6 - lwd + 7) % 7) || 7), byDays = addDays(lds, days);
    var next = nextSat < byDays ? nextSat : byDays, res = { last: md(lds), lastDay: lds, next: md(next), nextDay: next, since: since, days: days, due: false };
    if (since >= days) { res.due = true; res.why = "interval"; }
    else if ((wd === 6 || wd === 0) && lds < addDays(today, wd === 6 ? 0 : -1)) { res.due = true; res.why = "weekend"; }
    return res;
  }
  function mdyOf(ds) { return ds.slice(5, 7) + "/" + ds.slice(8, 10) + "/" + ds.slice(0, 4); }
  /* v74 (Matthew): no inspection while the vehicle moves faster than 5 mph (GPS speed; walking never trips it).
     Locks the form; unlocks after ~5 s at <= 5 mph. No GPS -> allowed, but the record says motion "unverified". */
  var MOTION = { mph: 5, calmMs: 5000 };
  function motionGate(form) {
    var st = { moving: false, slowSince: 0, seen: false, wid: null, max: 0 };
    form.__motion = st;
    var banner = document.createElement("p"); banner.id = "dl-dvir-moving"; banner.hidden = true; banner.setAttribute("role", "alert");
    banner.style.cssText = "background:#b91c1c;color:#fff;padding:10px;border-radius:8px;font-weight:700;text-align:center;margin:0 0 8px";
    banner.textContent = "Stop the vehicle to complete inspection";
    form.insertBefore(banner, form.firstChild);
    var paint = function () { banner.hidden = !st.moving; Array.prototype.forEach.call(form.querySelectorAll("input,button,select,textarea"), function (el) { el.disabled = st.moving; }); form.setAttribute("data-moving", st.moving ? "1" : "0"); };
    st.feed = function (mph, t) { t = t || Date.now(); if (!document.body.contains(form)) { st.stop(); return; } if (mph == null || !isFinite(mph)) return; st.seen = true; if (mph > st.max) st.max = mph;
      if (mph > MOTION.mph) { st.slowSince = 0; if (!st.moving) { st.moving = true; paint(); } }
      else if (st.moving) { if (!st.slowSince) st.slowSince = t; if (t - st.slowSince >= MOTION.calmMs) { st.moving = false; paint(); } } };
    st.stop = function () { try { if (st.wid != null) navigator.geolocation.clearWatch(st.wid); } catch (e) {} clearInterval(st.tick); st.wid = null; };
    st.tick = setInterval(function () { if (!document.body.contains(form)) { st.stop(); return; } if (st.moving && st.slowSince && Date.now() - st.slowSince >= MOTION.calmMs) { st.moving = false; paint(); } }, 1000);
    try { if (navigator.geolocation && navigator.geolocation.watchPosition) st.wid = navigator.geolocation.watchPosition(function (pos) {
      var sp = pos && pos.coords && pos.coords.speed; if (sp == null || !isFinite(sp)) return; /* no speed reading: stays "unverified" */
      st.feed(sp * 2.23694, pos.timestamp || Date.now()); }, function () {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }); } catch (e) {}
    window.__pcsMotion = st; /* test hook: __pcsMotion.feed(mph) */
  }
  /* v74 (Matthew): an inspection can't be submitted until 60 s after it was opened; countdown on Submit. */
  function minTimeGate(form) {
    var minMs = Number(window.__pcsInspMinMs) > 0 ? Number(window.__pcsInspMinMs) : 60000; /* __pcsInspMinMs: test hook only */
    form.__startedAt = Date.now(); form.__minMs = minMs;
    var btn = form.querySelector("#dl-dvir-save"), base = btn ? btn.textContent : "Submit inspection";
    var tick = function () { if (!document.body.contains(form)) { clearInterval(iv); return; }
      var left = Math.ceil((form.__startedAt + minMs - Date.now()) / 1000);
      if (btn) { if (left > 0) { btn.textContent = base + " (" + left + " s)"; btn.disabled = true; btn.setAttribute("data-wait", String(left)); } else { btn.textContent = base; btn.removeAttribute("data-wait"); if (form.getAttribute("data-moving") !== "1") btn.disabled = false; clearInterval(iv); } } };
    var iv = setInterval(tick, 500); tick();
  }
  function fmtDur(sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); return Math.floor(sec / 60) + "m " + ("0" + (sec % 60)).slice(-2) + "s"; }
  var FLUID_DROP = { washer: 1, washerfluid: 1, coolant: 1, trans: 1, transmission: 1, ps: 1, powersteering: 1 }; /* v2.0k r2: also dropped from an older God-edited checklist */
  function items(meta) { var c = meta && meta.dvirItems, out = (Array.isArray(c) && c.length ? c : DVIR).map(norm1).filter(Boolean).filter(function (i) { return !FLUID_DROP[i.k]; });
    var oi = -1; out.forEach(function (i, n) { if (i.k === "oil") { oi = n; if (i.label === "Oil") i.label = "Engine oil"; } });
    if (!out.some(function (i) { return i.k === "brakefluid"; })) { var bf = ch("brakefluid", "Brake fluid", LF, "Fluids", { block: true }); if (oi >= 0) out.splice(oi + 1, 0, bf); else out.push(bf); }
    return out; }
  /* MM/DD/YYYY -> ms at Chicago midnight (null if invalid) */
  function parseMdy(v) { var my = /^(\d{4})-(\d{2})$/.exec(String(v || "").trim()) || (function (z) { return z ? [z[0], z[2], z[1]] : null; })(/^(\d{1,2})\/(\d{4})$/.exec(String(v || "").trim()));
    if (my) { var yy = +my[1], mm = +my[2]; if (mm < 1 || mm > 12) return null; var last = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); return parseMdy(mm + "/" + last + "/" + yy); } /* v75: YYYY-MM / MM/YYYY = end of that month */
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || "").trim()); if (!m) return null; var mo = +m[1], d = +m[2], y = +m[3]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var ds = y + "-" + ("0" + mo).slice(-2) + "-" + ("0" + d).slice(-2); var t = midnight(ds); return ymd(t + 3600000) === ds ? t : null; }
  /* v76d-pretrip (Matthew 10/18): car wash = a reminder for the first maxAgeDays (default 3) CALENDAR days after the last wash
     (America/Chicago dates, never hours); from the next calendar day on it blocks going online, only while the item's "Blocks"
     box is on in God mode. Wash 10/15 -> reminders 10/16, 10/17, 10/18 -> blocked from 10/19. Checked at Available / the
     inspection only, so it never interrupts a ride in progress. An old checklist with maxAgeHours: 48 reads as 3 days. */
  function washGraceDays(it) { var d = Number(it && it.maxAgeDays); return d > 0 ? Math.round(d) : 3; }
  function washState(v, now, it) {
    var t = parseMdy(v); if (t == null) return null; now = now || Date.now();
    var days = Math.round((midnight(ymd(now)) - t) / 86400000), g = washGraceDays(it);
    var bf = ymd(t + (g + 1) * 86400000 + 3 * 3600000), wb = ymd(t + g * 86400000 + 3 * 3600000), ld = ymd(t + 3 * 3600000);
    return { days: days, grace: g, block: !!(it && it.block) && days > g, remind: days >= 1 && days <= g, overdue: days > g, blockFrom: bf.slice(5, 7) + "/" + bf.slice(8, 10),
      washBy: wb.slice(5, 7) + "/" + wb.slice(8, 10), last: ld.slice(5, 7) + "/" + ld.slice(8, 10) }; /* v76g: "please wash by" = the last reminder day */
  }
  /* v76g (Matthew 10/18 "Fix this"): one wording for the car wash everywhere. Reminder days: a friendly line, never a defect,
     never "Blocked". POST-trip (end of shift): information only, never a block. PRE-trip / Available: blocks only after
     3 full calendar days. Returns { level: "remind" | "info" | "block", text } or null (washed today / date unreadable). */
  function washLine(ws, kind) {
    if (!ws || ws.days < 1) return null;
    if (ws.remind) return { level: "remind", text: "Car wash reminder: last wash " + ws.last + ", please wash by " + ws.washBy + "." };
    if (kind === "post" || !ws.block) return { level: "info", text: "Car wash due: last wash " + ws.last + ". Please wash the car before the next shift." };
    return { level: "block", text: "Car wash overdue: last wash " + ws.last + ", more than " + ws.grace + " full days ago. Going online is paused until the car is washed and PCS clears it." };
  }
  /* v76g: show any stored inspection by TODAY's car-wash rule (records saved under the old 48 h rule, or a post-trip that
     stored a car-wash block, stop showing "Blocked" + "1 defect(s)"). Display only; nothing is written back. The car wash is
     judged on the inspection's own date + the wash date in it. Everything that is not the car wash is left as stored. */
  /* v77.15 (Anson 10/20-21): pick the more recent of two wash dates (either may be blank/unreadable) */
  function newerWash(a, b) { var ta = parseMdy(a), tb = parseMdy(b); if (ta == null) return tb == null ? (a || b || "") : b; if (tb == null) return a; return tb > ta ? b : a; }
  function recView(rec, kind, meta, fallbackWash) {
    if (!rec || typeof rec !== "object") return rec;
    var cw = items(meta || {}).filter(function (i) { return i.k === "carwash"; })[0] || { k: "carwash", label: "Last date of car wash", block: true, maxAgeDays: 3 };
    var its = rec.items && typeof rec.items === "object" ? rec.items : {}, out = {}, wx = its.carwash;
    var date = newerWash((wx && wx.date) || "", fallbackWash || ""), at = Number(rec.at) || Date.now(); /* v77.15: a wash recorded after this inspection clears its car-wash block */
    var ws = date ? washState(date, at, cw) : null, wl = washLine(ws, kind), wBlock = kind !== "post" && !!(ws && ws.block);
    Object.keys(its).forEach(function (k) {
      var x = its[k];
      if (k === "carwash" && x && typeof x === "object") {
        x = Object.assign({}, x); delete x.stale; delete x.blocking; delete x.remind; delete x.blockFrom; delete x.washNote;
        x.bad = x.expiry === "expired";
        if (wBlock) { x.bad = true; x.blocking = true; x.stale = true; }
        else if (wl) x.washNote = wl.text;
      }
      out[k] = x;
    });
    var stored = rec.blocks || [], blocks = stored.filter(function (b) { return !(b && b.k === "carwash"); });
    var hadWash = stored.length !== blocks.length;
    if (wBlock) blocks.push({ k: "carwash", label: cw.label || "Last date of car wash", why: "more than " + ws.grace + " days since last wash" });
    else if (hadWash && !ws && kind !== "post") stored.forEach(function (b) { if (b && b.k === "carwash" && !/48\s*h/i.test(String(b.why || ""))) blocks.push(b); }); /* unknown date: keep, except the retired 48 h rule */
    var n = 0; Object.keys(out).forEach(function (k) { var x = out[k]; if (x && x.bad && !x.optional && !x.noteFlag && k !== "carwash") n++; });
    var defects = isFinite(Number(rec.defects)) ? Math.min(Number(rec.defects), n) : n;
    return Object.assign({}, rec, { items: out, blocks: blocks, unsafe: blocks.length > 0 || (!!rec.unsafe && !stored.length), defects: defects, noDefects: defects === 0, wash: wl });
  }
  function expiryState(v, now) { var t = parseMdy(v); if (t == null) return ""; now = now || Date.now(); var end = t + 86400000; if (end <= now) return "expired"; if (end - now <= 30 * 86400000) return "soon"; return "ok"; }
  function myShow(v) { v = String(v || ""); var a = /^(\d{4})-(\d{2})$/.exec(v); if (a) return a[2] + "/" + a[1]; var b = /^(\d{1,2})\/\d{1,2}\/(\d{4})$/.exec(v); return b ? ("0" + b[1]).slice(-2) + "/" + b[2] : v; }
  function ansText(it, x) { if (!x) return "\u2014"; if (it.type === "date") return (it.monthYear ? myShow(x.date) : x.date) || "\u2014"; return x.answer || "\u2014"; }
  /* v2.0m-t: "HH:MM" on shift day d (Chicago) -> ms. Before 6 AM = after midnight (next day). Never in the future. */
  function stopTimeAt(d, hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "")); if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    var h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return null;
    var ds = h < 6 ? addDays(d, 1) : d, base = Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10), h, mi), t = null;
    [5, 6].forEach(function (off) { var c = base + off * 3600000; if (t == null && ymd(c) === ds && new Date(c).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) === ("0" + h).slice(-2) + ":" + m[2]) t = c; });
    return t != null && t <= Date.now() ? t : null;
  }
  function inspHtml(day, meta, kind) {
    var DVIR = items(meta);
    kind = kind === "post" ? "post" : "pre";
    var rec = (meta.dvirOf && meta.dvirOf(day.day, kind)) || null, other = meta.dvirOf && meta.dvirOf(day.day, kind === "pre" ? "post" : "pre");
    var head = '<div style="display:flex;gap:6px;padding:8px;background:#fff">' + ["pre", "post"].map(function (k) { return '<button type="button" class="dl-dvir-kind" data-kind="' + k + '" style="flex:1;padding:8px;border-radius:8px;border:1px solid #2f6fe0;background:' + (k === kind ? "#2f6fe0;color:#fff" : "#fff;color:#2f6fe0") + '">' + (k === "pre" ? "Pre-trip" : "Post-trip") + ((k === kind ? rec : other) ? " \u2713" : "") + "</button>"; }).join("") + "</div>";
    var grp = function (it, prev) { return it.group && it.group !== prev ? '<div class="dl-dvir-group" style="font-weight:700;margin-top:10px">' + esc(it.group) + "</div>" : (!it.group && prev ? '<div class="dl-dvir-gap" style="border-top:2px solid #ccc;margin-top:8px"></div>' : ""); };
    if (rec) {
      rec = recView(rec, kind, meta); /* v76g: today's car-wash rule */
      var keys = Object.keys(rec.items || {}), prevG = "", WASH_CSS = { remind: "background:#e8f8ec;color:#0b3d23;border:2px solid #2e9d4f", info: "background:#fff4e0;color:#5c3a00;border:2px solid #d9a441", block: "background:#fde8e8;color:#8b1414;border:2px solid #b91c1c" };
      return head + '<div class="dl-dvir-done" style="background:#fff;padding:12px;font-size:14px;color:#222"><p><b>' + (kind === "pre" ? "Pre-trip" : "Post-trip") + " inspection</b> \u00b7 " + esc(clock(rec.at)) + " \u00b7 Odometer " + esc(rec.odometer) + "</p>" +
        (rec.late && rec.stoppedAt ? '<p class="dl-dvir-late" style="margin:4px 0;color:#8a4b00;font-weight:700">Late post-trip \u00b7 stopped driving at ' + esc(clock(rec.stoppedAt)) + "</p>" : "") + /* v2.0m-t */
        (rec.startedAt ? '<p class="dl-dvir-dur" style="margin:4px 0;color:#555">Started ' + esc(clock(rec.startedAt)) + " \u00b7 finished " + esc(clock(rec.finishedAt)) + " \u00b7 took " + fmtDur(rec.durationSec) + "</p>" : "") +
        (rec.wash ? '<p class="dl-dvir-wash dl-dvir-wash-' + rec.wash.level + '" style="' + WASH_CSS[rec.wash.level] + ';border-radius:8px;padding:6px 10px;font-weight:700">' + esc(rec.wash.text) + "</p>" : "") +
        ((rec.blocks || []).length ? '<p class="dl-dvir-blocks" style="color:#b91c1c;font-weight:700">' + (kind === "post" ? "For God mode before the next shift" + (rec.cleared ? " (cleared by " + esc(rec.cleared.by || "") + ")" : "") : "Blocked from Available until God mode " + (rec.cleared ? "cleared it (" + esc(rec.cleared.by || "") + ")" : "clears it")) + ": " + rec.blocks.map(function (b) { return esc(b.label) + (b.why === "photo" ? " (photo approval)" : b.why !== "defect" ? " (" + esc(b.why) + ")" : ""); }).join(", ") + "</p>" : "") +
        (rec.noDefects ? '<p class="dl-dvir-nodef" style="color:#2e7d32;font-weight:700">No defects</p>' : '<p class="dl-dvir-ndef" style="color:#b91c1c;font-weight:700">' + rec.defects + " defect(s)</p>") +
        '<div style="padding-left:4px">' + keys.map(function (k) { var x = rec.items[k] || {}, it = { k: k, label: x.label || k, group: x.group || "", type: x.type || "choice" };
          var h = grp(it, prevG); prevG = it.group;
          return h + '<div class="dl-dvir-row-' + esc(k) + '" style="padding:3px 0' + (it.group ? ";padding-left:12px" : "") + '">' + esc(it.label) + ': <b style="color:' + (x.noteFlag ? "#b45309" : x.bad ? (x.optional ? "#8a6d3b" : "#b91c1c") : "#2e7d32") + '">' + esc(ansText(it, x)) + "</b>" +
            (x.expiry === "expired" ? ' <b style="color:#b91c1c">EXPIRED</b>' : x.expiry === "soon" ? ' <b style="color:#b45309">expires within 30 days</b>' : "") +
            (x.blocking ? ' \u00b7 <b style="color:#b91c1c">' + (x.needsApproval ? "blocked until God approves the photo" : x.stale ? "over 3 days since last wash: blocks going online" : "blocks Available") + "</b>" : x.washNote ? ' \u00b7 <b class="dl-dvir-washnote" style="color:#0b6b3a">' + esc(x.washNote) + "</b>" : x.remind ? ' \u00b7 <b style="color:#7a4b00">Reminder: wash the car' + (x.blockFrom ? " before " + esc(x.blockFrom) : "") + "</b>" : x.bad && !x.optional ? " \u00b7 flagged to God (not blocking)" : "") + (x.bad && x.optional ? " (optional item, not a defect flag)" : "") + (x.noteFlag ? " (note for God mode, not a defect)" : "") +
            (x.note ? " \u00b7 " + esc(x.note) : "") + (x.warn && x.bad ? ' <b style="color:#b91c1c">' + esc(x.warn) + "</b>" : "") + (x.photos && x.photos.length ? "<br>" + x.photos.map(function (ph) { return '<img src="' + esc(ph) + '" style="height:70px;margin:3px;border-radius:4px">'; }).join("") : "") + "</div>"; }).join("") + "</div>" +
        (rec.unsafe ? '<p class="dl-dvir-unsafe" style="color:#b91c1c;font-weight:700">' + (rec.cleared ? "Unsafe defect cleared by " + esc(rec.cleared.by || "God mode") + " on " + esc(clock(rec.cleared.at)) + " \u00b7 reason: " + esc(rec.cleared.reason || "") : (kind === "post" ? "Unsafe defect: God mode clears it before the next shift." : "Unsafe defect: you can\u2019t go Available until God mode clears it.")) + "</p>" : "") +
        (rec.sig ? '<img alt="Driver signature" src="' + esc(rec.sig) + '" style="height:70px"><div style="border-top:1px solid #333;width:240px"></div><p style="font-size:12px">Driver signature</p>' : "") + "</div>";
    }
    if (!meta.canSign || (day.upTo >= day.minutes && meta.inspDay !== day.day)) return head + '<div class="dl-insp" style="background:#fff;padding:12px">No Inspections</div>';
    var vd = (meta.vehDates && meta.vehDates()) || {}, pg = "", fl = fluidsDue(vd.fluids, meta.now, meta.fluidsDays), flNote = false;
    return head + '<form id="dl-dvir-form" novalidate autocomplete="off" data-day="' + esc(day.day) + '" data-kind="' + kind + '" style="background:#fff;padding:10px;font-size:14px;color:#222">' +
      '<button type="button" id="dl-dvir-nodef" style="width:100%;padding:12px;margin-bottom:8px;border:0;border-radius:8px;background:#2e7d32;color:#fff;font-weight:700">No defects (mark all good)</button>' +
      DVIR.map(function (it) {
        if (Array.isArray(it.kinds) && it.kinds.length && it.kinds.indexOf(kind) < 0) return "";
        if (it.group === "Fluids" && !fl.due) { if (flNote) return ""; flNote = true; pg = it.group;
          return '<div class="dl-dvir-group" style="font-weight:700;margin-top:10px">Fluids</div><div class="dl-fluids-ok" style="padding:8px 0 8px 12px;color:#2e7d32;border-bottom:1px solid #eee">Fluids checked ' + esc(fl.last) + ", next due by " + esc(fl.next) + "</div>"; }
        var h = grp(it, pg) + (it.group === "Fluids" && it.group !== pg ? '<div class="dl-fluids-due" style="padding:2px 0 4px 12px;color:#b45309;font-size:13px">' + (fl.why === "never" ? "Fluids check due (no check on record)" : fl.why === "weekend" ? "Weekly fluids check due this weekend (last " + esc(fl.last) + ")" : "Fluids check due (last " + esc(fl.last) + ", " + fl.since + " days ago)") + "</div>" : ""); pg = it.group; var pad = it.group || it.sub ? "padding-left:12px;" : "";
        if (it.type === "date") return h + '<div class="dl-dvir-item" data-item="' + esc(it.k) + '" data-type="date" style="' + pad + 'border-bottom:1px solid #eee;padding-top:8px;padding-bottom:8px"><label style="display:flex;gap:6px;align-items:center"><span style="flex:1">' + esc(it.label) + (it.required ? "" : ' <small style="color:#595959">(optional)</small>') + '</span><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autocorrect="off" spellcheck="false" data-date-mask="' + (it.monthYear ? "my" : "mdy") + '" placeholder="' + (it.monthYear ? "MM/YYYY" : "MM/DD/YYYY") + '" maxlength="' + (it.monthYear ? 7 : 10) + '" name="date-' + esc(it.k) + '" value="' + esc(it.monthYear ? myShow(vd[it.k]) : (vd[it.k] || "")) + '" style="width:120px"></label></div>';
        if (it.washQ) return h + '<div class="dl-dvir-item dl-wash-q" data-item="carwash" data-note-only="1" style="' + pad + 'border-bottom:1px solid #eee;padding-top:10px;padding-bottom:10px"><div style="font-weight:700;font-size:17px;margin-bottom:8px">' + esc(it.label) + "</div>" +
          '<div style="display:flex;gap:10px">' + it.opts.map(function (o, i) { return '<label class="dl-wash-btn" style="flex:1;display:flex;align-items:center;justify-content:center;min-height:56px;border-radius:12px;font-size:20px;font-weight:800;cursor:pointer;border:3px solid ' + (o.bad ? "#2e7d32;background:#fff;color:#1b5e20" : "#2e7d32;background:#2e7d32;color:#fff") + '"><input type="radio" name="dv-carwash" value="' + i + '" data-bad="' + (o.bad ? "note" : 0) + '" style="width:22px;height:22px;margin-right:8px"> ' + esc(o.label) + "</label>"; }).join("") + "</div>" +
          '<p class="dl-wash-warn" role="alert" hidden data-last="' + esc(washLastText(vd.carwash)) + '" style="margin:10px 0 0;background:#fff4e0;color:#5c3a00;border:2px solid #d9a441;border-radius:10px;padding:10px;font-weight:700">' + esc(washWarnText(vd.carwash)) + "</p></div>";
        if (it.noteOnly) return h + '<div class="dl-dvir-item" data-item="' + esc(it.k) + '" data-note-only="1" style="' + pad + 'border-bottom:1px solid #eee;padding-top:8px;padding-bottom:8px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="flex:1">' + esc(it.label) + "</span>" +
          it.opts.map(function (o, i) { return '<label><input type="radio" name="dv-' + esc(it.k) + '" value="' + i + '" data-bad="' + (o.bad ? "note" : 0) + '"> ' + esc(o.label) + "</label>"; }).join(" ") + "</div>" +
          (it.k === "fulltank" ? '<div class="dl-fuel" hidden style="margin-top:6px"><label>Fuel level (required) <select name="fuel-fulltank" required><option value="">Pick\u2026</option>' + FUEL_LEVELS.map(function (v) { return '<option value="' + v + '">' + v + "</option>"; }).join("") + "</select></label></div>" : "") + /* v74b */
          "</div>";
        return h + '<div class="dl-dvir-item" data-item="' + esc(it.k) + '" data-required="' + it.required + '" style="' + pad + 'border-bottom:1px solid #eee;padding-top:8px;padding-bottom:8px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="flex:1">' + esc(it.label) + (it.required ? "" : ' <small style="color:#595959">(optional)</small>') + "</span>" +
          it.opts.map(function (o, i) { return '<label><input type="radio" name="dv-' + esc(it.k) + '" value="' + i + '" data-bad="' + (o.bad ? (it.noteOnly ? "note" : 1) : 0) + '"> ' + esc(o.label) + "</label>"; }).join(" ") + "</div>" +
          '<div class="dl-dvir-def" hidden style="margin-top:6px">' + (it.warn ? '<p class="dl-dvir-warn" style="margin:0 0 6px;color:#b91c1c;font-weight:700">' + esc(it.warn) + "</p>" : "") + (it.text ? '<input type="text" name="text-' + esc(it.k) + '" placeholder="' + esc(it.textLabel || "Explain") + ' (required)" maxlength="300" style="width:100%;margin-bottom:4px">' : "") +
          '<input type="text" name="note-' + esc(it.k) + '" placeholder="Notes' + ((it.noCamera || it.k === "brakenoise" || it.k === "dash") ? " (optional)" : "") + '" maxlength="300" style="width:100%">' +
          (!it.required ? '<div style="margin:4px 0;color:#595959">Optional item: noted only, never blocks.</div>' : it.block ? '<div style="margin:4px 0;color:#b91c1c;font-size:13px;font-weight:600">' + (it.photoApprove ? "Blocks going Available until God mode approves the photo." : "Safety item: blocks going Available until God mode clears it.") + "</div>" : '<div style="margin:4px 0;color:#555;font-size:13px">Flagged to God mode (does not block).</div>') +
          (it.required && !it.noPhoto && !(it.noCamera || it.k === "brakenoise" || it.k === "dash") ? '<div style="margin:4px 0;color:#b45309;font-size:13px">Photo required</div>' : "") +
          ((it.noCamera || it.k === "brakenoise" || it.k === "dash") ? "" : /* v74b (Matthew): never a photo for the grinding-noise question */
          '<label class="dl-photo-btn" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#374151;color:#fff;font-weight:600;cursor:pointer">\ud83d\udcf7 Take photo<input type="file" accept="image/*" capture="environment" name="photo-' + esc(it.k) + '" data-photo="' + esc(it.k) + '" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden"></label> <span class="dl-photo-count" data-photo-count="' + esc(it.k) + '" style="font-size:13px;color:#555"></span>' +
          '<div class="dl-photo-thumbs" data-photo-thumbs="' + esc(it.k) + '"></div>') + "</div></div>";
      }).join("") +
      (function () { var pv = String((meta.vehicle && meta.vehicle.plate) || ""), pls = (Array.isArray(meta.plates) ? meta.plates : []).concat(pv ? [pv] : []).filter(function (p, i, a) { return p && a.indexOf(p) === i; }); /* v2.0i (Harry r4 #2): the vehicle inspected is picked ON the form (default = profile plate; a rental can be entered) and stored on the row */
        return '<label style="display:block;margin-top:8px">Vehicle plate inspected <input type="text" name="plate" id="dl-dvir-plate" list="dl-dvir-plates" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" value="' + esc(pv) + '" style="width:140px;text-transform:uppercase"></label>' +
          '<datalist id="dl-dvir-plates">' + pls.map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") + "</datalist>" +
          '<p class="fine" style="margin:2px 0 0;font-size:12px;color:#555">Driving a different car (e.g. a rental)? Change the plate. That inspection then counts only for that plate.</p>'; })() +
      (kind === "post" && meta.inspDay === day.day ? '<label class="dl-stop-time" style="display:block;margin-top:8px;font-weight:700">What time did you stop driving last night? <input type="time" name="stopTime" id="dl-stop-time" required style="width:140px;min-height:40px;font-size:16px"></label>' : "") + /* v2.0m-t: late post-trip */
      '<label style="display:block;margin-top:8px">' + (kind === "pre" ? "Odometer (opening odometer for this shift)" : "Odometer (ending odometer for this shift)") + ' <input type="text" inputmode="none" pattern="[0-9]*" name="odometer" id="dl-dvir-odo" data-odopad-in="1" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="7" value="' + esc(kind === "pre" && meta.odoNow != null && isFinite(Number(meta.odoNow)) ? String(Math.floor(Number(meta.odoNow))) : "") + '" style="width:140px"></label>' +
      odoPadHtml() + /* v75z: big on-screen number pad (iPadOS ignores inputmode="numeric" and opens the full keyboard) */
      '<p style="margin:10px 0 4px">Driver signature</p><canvas id="dl-sig-pad" width="680" height="140" style="width:100%;height:140px;touch-action:none;display:block;background:#fafafa"></canvas><div style="border-top:1px solid #333"></div>' +
      '<p style="margin:8px 0;text-align:center"><a href="#" id="dl-sig-clear" style="color:#2f6fe0;text-decoration:none">Clear Signature</a></p>' +
      '<p id="dl-dvir-err" role="alert" style="color:#b91c1c"></p><button type="button" id="dl-dvir-save" style="width:100%;padding:12px;border:0;border-radius:8px;background:#2f6fe0;color:#fff;font-weight:700">Submit inspection</button></form>';
  }
  function padWire(w) {
    var c = w.querySelector("#dl-sig-pad"); if (!c) return;
    var g = c.getContext("2d"), down = false, last = null; c.__ink = false;
    g.lineWidth = 2.5; g.lineCap = "round"; g.strokeStyle = "#111";
    var pt = function (e) { var r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener("pointerdown", function (e) { down = true; last = pt(e); try { c.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
    c.addEventListener("pointermove", function (e) { if (!down) return; var p = pt(e); g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke(); last = p; c.__ink = true; e.preventDefault(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { c.addEventListener(n, function () { down = false; }); });
  }
  function shrink(file) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { var im = new Image(); im.onload = function () { var k = Math.min(1, 900 / Math.max(im.width, im.height)), cv = document.createElement("canvas"); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); res(cv.toDataURL("image/jpeg", 0.7)); }; im.onerror = function () { res(null); }; im.src = fr.result; }; fr.onerror = function () { res(null); }; fr.readAsDataURL(file); }); }
  /* returns a Promise of the record, or { error } when a required answer is missing */
  var FUEL_LEVELS = ["3/4", "1/2", "1/4", "Empty"];
  var FUEL_MSG = "Please end each day with a full tank. A ride may be requested first thing in the morning, and the car needs to be ready to go.";
  function fuelPopup(done) {
    var old = document.getElementById("dl-fuel-pop"); if (old) old.remove();
    var m = document.createElement("div"); m.id = "dl-fuel-pop"; m.setAttribute("role", "alertdialog"); m.setAttribute("aria-modal", "true");
    m.style.cssText = "position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    m.innerHTML = '<div style="background:#fff;color:#111;border-radius:12px;padding:18px;max-width:360px;width:100%;font-size:16px"><p id="dl-fuel-msg" style="margin:0 0 14px;font-weight:600">' + FUEL_MSG + '</p><button type="button" id="dl-fuel-ok" style="width:100%;min-height:44px;background:#111;color:#fff;border:0;border-radius:8px;font-weight:700;font-size:16px">OK</button></div>';
    document.body.appendChild(m);
    m.querySelector("#dl-fuel-ok").addEventListener("click", function () { m.remove(); done(); });
  }
  function readDvir(form, meta) {
    var out = {}, unsafe = false, defects = 0, jobs = [], err = "", vehDates = {}, now = Date.now(), fluidsSeen = false, notes = 0, blocks = [];
    items(meta).forEach(function (it) {
      var x = { label: it.label, group: it.group || "", type: it.type, required: it.required };
      if (it.type === "date") {
        var v = String((form.querySelector('input[name="date-' + it.k + '"]') || {}).value || "").trim();
        if (it.monthYear && v) { var mym = /^(\d{1,2})\/(\d{4})$/.exec(v); v = mym && +mym[1] >= 1 && +mym[1] <= 12 ? mym[2] + "-" + ("0" + mym[1]).slice(-2) : "bad"; } /* stored YYYY-MM */
        if (!v) { if (it.required && !err) err = "Enter " + it.label + (it.monthYear ? " (MM/YYYY)." : " (MM/DD/YYYY)."); }
        else if (parseMdy(v) == null) { if (!err) err = it.label + (it.monthYear ? ": use MM/YYYY with a month 01-12 (e.g. 06/2027)." : ": use MM/DD/YYYY."); }
        else { x.date = v; if (it.vehicle) vehDates[it.k] = v;
          if (it.maxAgeHours || it.maxAgeDays) { var ws = washState(v, now, it), dk = form.getAttribute("data-kind") === "post" ? "post" : "pre"; /* v76d-pretrip: calendar days, not 48 h */
            if (ws && (ws.days < 0 || ws.days > 366) && !err) err = it.label + ": " + v + " looks off. Check the month, day and year (MM/DD/YYYY)."; /* v76g: e.g. 10/18/2016 typed for 10/18/2026 */
            var wl = washLine(ws, dk); if (wl && wl.level !== "block") x.washNote = wl.text;
            if (dk === "post") { if (ws && (ws.remind || ws.overdue)) { x.remind = true; x.blockFrom = ws.blockFrom; } } /* v76g: end of shift = information only */
            else if (ws && ws.block) { x.stale = true; x.bad = true; x.blocking = true; unsafe = true; blocks.push({ k: it.k, label: it.label, why: "more than " + ws.grace + " days since last wash" }); } else if (ws && (ws.remind || ws.overdue)) { x.remind = true; x.blockFrom = ws.blockFrom; } } if (it.expiry) { x.expiry = expiryState(v, now); if (x.expiry === "expired") { x.bad = true; if (it.required) defects++; else x.optional = true; } } }
        out[it.k] = x; return;
      }
      var fk = form.getAttribute("data-kind"); if (Array.isArray(it.kinds) && it.kinds.length && it.kinds.indexOf(fk) < 0) return;
      if (it.group === "Fluids" && !form.querySelector('input[name="dv-' + it.k + '"]')) { x.skipped = true; x.answer = "Not due"; out[it.k] = x; return; }
      if (it.group === "Fluids") fluidsSeen = true;
      var r = form.querySelector('input[name="dv-' + it.k + '"]:checked');
      if (!r) { if (it.required && !err) err = "Answer: " + (it.group ? it.group + " \u2013 " : "") + it.label; out[it.k] = x; return; }
      var o = it.opts[+r.value] || {}; x.answer = o.label; x.bad = !!o.bad;
      if (it.washQ) { x.bad = false; x.washQ = true;
        if (!o.bad) { x.date = mdyOf(ymd(now)); x.washedAt = now; vehDates.carwash = x.date; }
        else { var lw = (meta && meta.vehDates && meta.vehDates() || {}).carwash; x.noteFlag = true; notes++; x.lastWash = washLastText(lw); x.note = "Car wash: last " + x.lastWash; x.washNote = washWarnText(lw); if (lw) x.date = lw; }
        out[it.k] = x; return; } /* v77.9: Yes = washed today; No = a God note + the 3-day warning, never a defect */
      if (it.noteOnly) { x.bad = false; if (o.bad) { x.noteFlag = true; notes++;
          if (it.k === "fulltank") { x.fuel = String((form.querySelector('select[name="fuel-fulltank"]') || {}).value || ""); /* v74b: required fuel level when the tank isn't full */
            if (FUEL_LEVELS.indexOf(x.fuel) < 0) { if (!err) err = "Pick the fuel level (Full tank of gas = No)."; } else { x.answer = o.label + " \u00b7 fuel level " + x.fuel; x.note = "Fuel level " + x.fuel; } } }
        out[it.k] = x; return; } /* v74: e.g. post-trip "Full tank of gas = No" -> God note, never a defect */
      if (x.bad) {
        x.note = (form.querySelector('input[name="note-' + it.k + '"]') || {}).value || "";
        if (it.text) { x.text = String((form.querySelector('input[name="text-' + it.k + '"]') || {}).value || "").trim(); if (!x.text && !err) err = (it.textLabel || "Explain") + " (" + it.label + ")"; if (x.text) x.note = x.text + (x.note ? " \u00b7 " + x.note : ""); }
        if (!it.required) x.optional = true;
        else { defects++; if (it.block) { x.blocking = true; x.safe = false; unsafe = true; blocks.push({ k: it.k, label: (it.group ? it.group + " " : "") + it.label, why: it.photoApprove ? "photo" : "defect" }); if (it.photoApprove) x.needsApproval = true; } if (it.warn) x.warn = it.warn; }
        var shots = (form.__photos && form.__photos[it.k]) || []; x.photos = [];
        if (it.required && !it.noPhoto && !(it.noCamera || it.k === "brakenoise" || it.k === "dash") && !shots.length && !err) err = "Take a photo of the defect (" + (it.group ? it.group + " \u2013 " : "") + it.label + ").";
        shots.slice(0, 4).forEach(function (file) { jobs.push(shrink(file).then(function (dd) { if (dd) x.photos.push(dd); })); });
      }
      out[it.k] = x;
    });
    if (err) return Promise.resolve({ error: err });
    if (fluidsSeen) vehDates.fluids = mdyOf(ymd(now));
    else { var fit = items(meta).filter(function (i) { return i.group === "Fluids" && i.block; }); var fd = fluidsDue((meta.vehDates && meta.vehDates() || {}).fluids, now, meta.fluidsDays);
      if (fit.length && fd.due && fd.why !== "weekend") { unsafe = true; blocks.push({ k: "fluids", label: "Fluids check", why: fd.why === "never" ? "never checked" : "not checked in " + fd.days + " days" }); } } /* v74: weekly fluids check done today (remembered per vehicle) */
    return Promise.all(jobs).then(function () { return { items: out, defects: defects, notes: notes, unsafe: unsafe, blocks: blocks, noDefects: defects === 0, vehDates: vehDates }; });
  }
  function detailHtml(day, meta, tab) {
    tab = tab || "log";
    var tabs = [["log", "Log"], ["form", "Form"], ["sign", "Sign"], ["insp", "Inspection"]];
    return '<div class="dl-detail" data-day="' + esc(day.day) + '">' +
      '<div class="dl-tabs" role="tablist" style="display:flex;background:#fff;border-bottom:1px solid #ddd">' + tabs.map(function (t) {
        return '<button type="button" role="tab" class="dl-tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab.slice(0, 4)) + '" style="flex:1;border:0;background:none;padding:10px;color:' + (t[0] === tab.slice(0, 4) ? "#2f6fe0;border-bottom:2px solid #2f6fe0" : "#555") + '">' + t[1] + "</button>";
      }).join("") + "</div>" +
      (tab === "log" ? '<div style="background:#fff;padding:8px">' + gridSvg(day) + "</div>" + eventsHtml(day, meta)
        : tab === "form" ? formHtml(day, meta) : tab === "sign" ? signHtml(day, meta)
        : inspHtml(day, meta, tab === "insp-post" ? "post" : "pre")) + "</div>";
  }
  function listItem(day, withGrid) {
    return '<button type="button" class="dl-item" data-open-day="' + esc(day.day) + '" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #ddd;background:#fff;padding:10px 12px;color:#222">' +
      '<div><b>' + esc(wd(day, { weekday: "long" })) + "</b> " + esc(wd(day, { month: "short", day: "2-digit" })) + '<span style="float:right;color:#595959">\u203a</span></div>' +
      '<div class="dl-item-hrs" style="color:#666;font-size:13px">\u23f1 ' + esc(hrmin(onMin(day))) + " \u00b7 No Inspections</div>" +
      (withGrid ? '<div style="margin-top:6px">' + gridSvg(day) + "</div>" : "") + "</button>";
  }
  function currentStatus(meta) { var c = (meta.currentStatus || "off"), lab = { off: "OFF DUTY", drv: "DRIVING", on: "ON DUTY", sb: "SLEEPER" }[c] || "OFF DUTY";
    return '<div class="dl-current" style="display:flex;gap:10px;align-items:center;background:#fff;padding:10px 12px;border-bottom:1px solid #ddd">' + badge(c in BADGE ? c : "off") + '<div><b class="dl-current-lab">' + lab + '</b><div style="font-size:12px;color:#666">Current Status' + (meta.currentNote ? " \u00b7 " + esc(meta.currentNote) : "") + "</div></div></div>"; }
  var SEC = 'style="background:#eee;color:#666;font-size:12px;padding:6px 12px;margin:0"';
  /* v2.0m-q: today's rides, one per row: type, start-end, minutes, miles */
  function ridesHtml(meta) {
    var r = (meta && meta.rides) || []; if (!r.length) return "";
    var now = Number(meta.now) || Date.now();
    var t = function (ms) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); };
    return "<p " + SEC + ">RIDES TODAY</p>" + '<ul class="dl-rides" style="list-style:none;margin:0;padding:0;background:#fff">' + r.map(function (x) {
      var mins = x.end ? x.minutes : Math.round((now - x.start) / 60000);
      return '<li class="dl-ride" style="padding:10px 12px;border-bottom:1px solid #ddd"><b>' + esc(rideDisplay(x.type)) + "</b> \u00b7 " + esc(t(x.start)) + " \u2013 " + (x.end ? esc(t(x.end)) : "now") + " \u00b7 " + mins + " min" + (x.end ? " \u00b7 " + Number(x.miles || 0).toFixed(1) + " mi" : "") + "</li>";
    }).join("") + "</ul>";
  }
  function listHtml(days, meta) { meta = meta || {};
    return currentStatus(meta) + "<p " + SEC + ">TODAY</p>" + (days[0] ? listItem(days[0], true) : "") + ridesHtml(meta) +
      '<button type="button" id="dl-history" style="display:block;width:calc(100% - 24px);margin:12px;padding:12px;border:1px solid #2f6fe0;border-radius:8px;background:#fff;color:#2f6fe0;font-weight:700">History</button>' + mapHtml(meta);
  }
  /* v2.0m-s: today's map under History. Blue = Available, green = On a ride, yellow pin = Break, gray = Off duty / en route.
     v2.0m-ac: a stored ride segment recolors only the On a ride points it covers (PCS blue, Uber/Lyft green, Other amber).
     A green track with no stored PCS/Uber/Lyft/Other type stays "On a ride". Nothing here invents a type from the track. */
  var TRK_COL = { a: "#1e63d6", r: "#1f9d3a", b: "#e0b000", o: "#8a8a8a" }, TRK_NAME = { a: "Available", r: "On a ride", b: "Break", o: "Off duty / en route" };
  var TRIP_COL = { PCS: "#1e63d6", Uber: "#1f9d3a", Lyft: "#1f9d3a", Other: "#c27a12" };
  var TRIP_PX = 6, TRIP_UNDER_PX = 8; /* approved 6px stroke; white underlay is width + 2 */
  function rideTypeCanon(raw) {
    var s = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (s === "pcs") return "PCS";
    if (s === "uber") return "Uber";
    if (s === "lyft") return "Lyft";
    if (s === "other") return "Other";
    return "";
  }
  /* List and tap share this label. Empty stored type stays "On a ride" (not PCS, not invented Other). */
  function rideDisplay(raw) { return rideTypeCanon(raw) || (String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "") || "On a ride"); }
  /* Assigned PCS records once while a live assigned ride id is active. An open PCS segment is left alone.
     The same ride id, after that assigned segment has already been closed, does not start another.
     Never reads track colors. Boolean form pcsAutoRecord(true, openSeg) remains for callers without a ride id. */
  function pcsAutoRecord(autoBusy, openSeg) {
    var autoLive = !!autoBusy, rideId = "", closedRideId = "";
    if (autoBusy && typeof autoBusy === "object") {
      openSeg = autoBusy.openSeg;
      autoLive = !!autoBusy.autoLive;
      rideId = String(autoBusy.rideId || "");
      closedRideId = String(autoBusy.closedRideId || "");
    }
    if (!autoLive) return false;
    if (rideId && closedRideId && rideId === closedRideId) return false;
    if (openSeg && !openSeg.end && rideTypeCanon(openSeg.type) === "PCS") return false;
    return true;
  }
  /* Manual Uber/Lyft/Other/PCS stays open only while that manual choice is still on.
     A live assigned PCS ride stays open through Break, Offline / en route, and Available.
     After that ride id ends, the assigned segment closes. A stale auto-busy flag must not
     keep a manual timer running, and a leftover manual-busy flag must not keep assigned PCS open. */
  function rideSegmentStaysOpen(o) {
    o = o || {};
    if (o.force || !o.sameDay) return false;
    if (o.assigned && o.autoLive) return true;
    if (o.onBreak || o.offline) return false;
    if (o.assigned) return false;
    return !!o.manualBusy;
  }
  /* GPS status letter. A live assigned ride is On a ride even if the slider still says
     Break, Offline / en route, or Available. Stored letters are not rewritten. */
  function trackLetter(f) {
    f = f || {};
    if (!f.signedIn) return "o";
    if (f.assignedLive) return "r";
    if (f.offline) return f.shiftOpen ? "a" : "o";
    if (f.onBreak) return "b";
    if (f.manualBusy || f.autoBusy) return "r";
    return f.shiftOpen ? "a" : "o";
  }
  /* Today's segment list: close when the open segment should end, then start assigned PCS when a new live ride needs it.
     force only closes. Starting assigned PCS also closes a still-open manual Uber/Lyft/Other at that instant. */
  function foldRideSegments(list, flags, now) {
    list = (list || []).slice();
    flags = flags || {};
    now = Number(now) || 0;
    function closeAt(i) {
      var open = list[i];
      var mi = (Number(flags.miles) || 0) - (Number(open.startMiles) || 0);
      list[i] = Object.assign({}, open, {
        end: now,
        minutes: Math.max(0, Math.round((now - open.start) / 60000)),
        miles: Math.max(0, Math.round(mi * 10) / 10)
      });
    }
    var last = list[list.length - 1];
    var open = last && !last.end ? last : null;
    if (open && !rideSegmentStaysOpen({
      force: !!flags.force, manualBusy: !!flags.manualBusy, autoBusy: !!flags.autoBusy, autoLive: !!flags.autoLive,
      assigned: !!open.assigned, type: open.type, onBreak: !!flags.onBreak, offline: !!flags.offline, sameDay: flags.sameDay !== false
    })) {
      closeAt(list.length - 1);
      open = null;
    }
    if (flags.force) return list;
    var closed = list[list.length - 1];
    var closedRideId = closed && closed.end && closed.assigned ? String(closed.rideId || "") : "";
    if (!pcsAutoRecord({ autoLive: !!flags.autoLive, openSeg: open, rideId: flags.rideId || "", closedRideId: closedRideId })) return list;
    if (open) closeAt(list.length - 1);
    list.push({ type: "PCS", start: now, startMiles: Number(flags.miles) || 0, assigned: true, rideId: String(flags.rideId || "") });
    return list;
  }
  function trkPts(tr) { return ((tr && tr.pts) || []).map(function (p) { return { t: tr.t0 + p[0] * 1000, lat: p[1] / 1e5, lng: p[2] / 1e5, s: p[3] }; }); }
  function mi(a, b) { var R = 3958.8, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r, x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.sqrt(x)); }
  /* runs of the same status; a run ends at the first point of the next one (so the line has no gaps) */
  function trkRuns(pts) {
    var runs = [], cur = null;
    pts.forEach(function (p, i) {
      if (!cur || cur.s !== p.s) { if (cur) { cur.pts.push(p); cur.end = p.t; } cur = { s: p.s, start: p.t, end: p.t, pts: [p], miles: 0 }; runs.push(cur); }
      else { cur.pts.push(p); cur.end = p.t; }
    });
    runs.forEach(function (r) { var m = 0; for (var i = 1; i < r.pts.length; i++) { var gap = r.pts[i].t - r.pts[i - 1].t; if (gap <= 600000) m += mi(r.pts[i - 1], r.pts[i]); } r.miles = r.s === "b" ? 0 : m; });
    return runs;
  }
  function rideCovering(rides, t) {
    var hit = null;
    (rides || []).forEach(function (x) {
      if (!x || !(Number(x.start) > 0)) return;
      var end = Number(x.end) > 0 ? Number(x.end) : Infinity;
      if (Number(x.start) <= t && t <= end) hit = x;
    });
    return hit;
  }
  /* On a ride points pick up a stored segment. Other statuses stay themselves. No stored type -> no trip color. */
  function trkDisplayRuns(pts, rides) {
    var runs = [], cur = null;
    function cls(p) {
      var ride = p.s === "r" ? rideCovering(rides, p.t) : null;
      var type = ride ? rideTypeCanon(ride.type) : "";
      return { s: p.s, type: type, ride: ride, key: p.s + "|" + type + "|" + (ride ? ride.start : "") };
    }
    (pts || []).forEach(function (p) {
      var k = cls(p);
      if (!cur || cur.key !== k.key) {
        if (cur) { cur.pts.push(p); cur.end = p.t; }
        cur = { s: k.s, type: k.type, ride: k.ride, key: k.key, start: p.t, end: p.t, pts: [p], miles: 0 };
        runs.push(cur);
      } else { cur.pts.push(p); cur.end = p.t; }
    });
    runs.forEach(function (r) { var m = 0; for (var i = 1; i < r.pts.length; i++) { var gap = r.pts[i].t - r.pts[i - 1].t; if (gap <= 600000) m += mi(r.pts[i - 1], r.pts[i]); } r.miles = r.s === "b" ? 0 : m; });
    return runs;
  }
  function runColor(run) { return (run && run.type && TRIP_COL[run.type]) || TRK_COL[run.s] || TRK_COL.o; }
  function runLabel(run, fmt) {
    fmt = fmt || function (ms) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); };
    if (!run) return "";
    if (run.s === "b") return "Break \u00b7 " + fmt(run.start) + " \u2013 " + fmt(run.end) + " \u00b7 0 mi";
    if (run.ride) {
      var hit = run.ride, miles = hit.end ? Number(hit.miles || 0) : run.miles;
      return rideDisplay(hit.type) + " \u00b7 " + fmt(hit.start) + " \u2013 " + (hit.end ? fmt(hit.end) : "now") + " \u00b7 " + miles.toFixed(1) + " mi";
    }
    return (TRK_NAME[run.s] || "On a ride") + " \u00b7 " + fmt(run.start) + " \u2013 " + fmt(run.end) + " \u00b7 " + run.miles.toFixed(1) + " mi";
  }
  function thinPx(stops) { var e = ["interpolate", ["linear"], ["zoom"]]; stops.forEach(function (s) { e.push(s[0], s[1]); }); return e; }
  /* Daily history basemap only. Real OpenStreetMap vector streets, no live-traffic raster, no Google tile swap. */
  function historyMapSpec() {
    return {
      maxZoom: 19, minZoom: 3, traffic: false, provider: "openfreemap",
      background: "#fbfbfb", roadColor: "#111111", roadMaxPx: 1.5,
      streetLabelMinZoom: 14, streetLabelColor: "#222222",
      tripPx: TRIP_PX, underlayPx: TRIP_UNDER_PX, underlayColor: "#ffffff",
      tiles: "https://tiles.openfreemap.org/planet",
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      colors: { PCS: TRIP_COL.PCS, Uber: TRIP_COL.Uber, Lyft: TRIP_COL.Lyft, Other: TRIP_COL.Other, a: TRK_COL.a, r: TRK_COL.r, b: TRK_COL.b, o: TRK_COL.o }
    };
  }
  function historyMapStyle() {
    var spec = historyMapSpec(), road = spec.roadColor, line = ["LineString", "MultiLineString"];
    var roads = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "busway"];
    var geom = ["match", ["geometry-type"], line, true, false];
    function roadLayer(id, classes, width, minzoom) {
      return { id: id, type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: minzoom,
        filter: ["all", geom, ["match", ["get", "class"], classes, true, false]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": road, "line-width": thinPx(width), "line-opacity": 1 } };
    }
    return {
      version: 8,
      sources: { openmaptiles: { type: "vector", url: spec.tiles } },
      glyphs: spec.glyphs,
      layers: [
        { id: "background", type: "background", paint: { "background-color": spec.background } },
        { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#e7eef2" } },
        { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": "#f4f5f3" } },
        { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 15, paint: { "fill-color": "#f7f7f5", "fill-outline-color": "#e4e4e2" } },
        roadLayer("road-major", ["motorway", "trunk", "primary", "secondary", "tertiary"], [[6, 0.45], [12, 0.8], [16, 1.1], [19, 1.45]], 6),
        roadLayer("road-minor", ["minor", "service", "busway"], [[13, 0.35], [16, 0.7], [19, 1.15]], 13),
        { id: "road-name", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", minzoom: spec.streetLabelMinZoom,
          filter: ["all", geom, ["match", ["get", "class"], roads, true, false]],
          layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 14, 12, 17, 15, 19, 16] },
          paint: { "text-color": spec.streetLabelColor, "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
        { id: "place-name", type: "symbol", source: "openmaptiles", "source-layer": "place", minzoom: 8,
          filter: ["match", ["get", "class"], ["city", "town", "village"], true, false],
          layout: { "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 13 },
          paint: { "text-color": "#222222", "text-halo-color": "#ffffff", "text-halo-width": 1.4 } }
      ]
    };
  }
  function trackLayers() {
    var round = { "line-cap": "round", "line-join": "round" };
    return [
      { id: "dl-under", type: "line", source: "dl-track", layout: round, paint: { "line-color": "#ffffff", "line-width": TRIP_UNDER_PX, "line-opacity": 1 } },
      { id: "dl-stroke", type: "line", source: "dl-track", layout: round, paint: { "line-color": ["get", "color"], "line-width": TRIP_PX, "line-opacity": 1 } },
      { id: "dl-break", type: "circle", source: "dl-break", paint: { "circle-radius": 9, "circle-color": TRK_COL.b, "circle-stroke-color": "#7a5d00", "circle-stroke-width": 2 } }
    ];
  }
  function trkTotals(runs) { var t = {}; runs.forEach(function (r) { var x = t[r.s] = t[r.s] || { miles: 0, min: 0 }; x.miles += r.miles; x.min += Math.max(0, Math.round((r.end - r.start) / 60000)); }); return t; }
  function hmin(m) { return m >= 60 ? Math.floor(m / 60) + " hr " + (m % 60) + " min" : m + " min"; }
  function mapHtml(meta) {
    var tr = meta && meta.track; if (!tr) return "";
    var runs = trkRuns(trkPts(tr)), tot = trkTotals(runs);
    var dot = function (c, pin) { return '<span style="display:inline-block;width:' + (pin ? 10 : 16) + 'px;height:' + (pin ? 10 : 4) + 'px;border-radius:' + (pin ? "50%" : "2px") + ';background:' + c + ';vertical-align:middle;margin:0 4px 0 8px"></span>'; };
    return "<p " + SEC + ">TODAY'S MAP</p>" +
      '<div id="dl-map" style="height:300px;margin:0 12px;border:1px solid #bbb;border-radius:8px;background:#fbfbfb"></div>' +
      (runs.length ? "" : '<p class="dl-map-empty" style="margin:6px 12px;color:#666;font-size:13px">No driving yet today.</p>') +
      '<p class="dl-legend" style="margin:6px 4px;font-size:13px">' + dot(TRIP_COL.PCS) + "PCS" + dot(TRIP_COL.Uber) + "Uber/Lyft" + dot(TRIP_COL.Other) + "Other" + dot(TRK_COL.a) + "Available" + dot(TRK_COL.b, true) + "Break" + dot(TRK_COL.o) + "Off duty / en route</p>" +
      '<p id="dl-map-tap" style="margin:4px 12px;font-size:14px;font-weight:700;min-height:18px"></p>' +
      '<ul class="dl-map-tot" style="list-style:none;margin:0 12px;padding:0;font-size:14px">' + ["a", "r", "b", "o"].filter(function (k) { return tot[k] || k !== "o"; }).map(function (k) {
        var x = tot[k] || { miles: 0, min: 0 };
        return '<li style="padding:4px 0;border-bottom:1px solid #ddd">' + dot(TRK_COL[k], k === "b") + "<b>" + TRK_NAME[k] + "</b>: " + x.miles.toFixed(1) + " mi \u00b7 " + hmin(x.min) + "</li>";
      }).join("") + "</ul>" +
      (tr.canToggle ? '<label style="display:flex;gap:8px;align-items:center;margin:10px 12px;font-size:14px"><input type="checkbox" id="dl-personal"' + (tr.personal ? " checked" : "") + '> Track off-duty / en route miles (gray line)</label>' : "");
  }
  var mapView = null;
  function ensureMapLibre() {
    var d = document;
    if (!d.getElementById("dl-maplibre-css")) {
      var css = d.createElement("link"); css.id = "dl-maplibre-css"; css.rel = "stylesheet";
      css.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
      (d.head || d.documentElement).appendChild(css);
    }
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (window.__dlMlPromise) return window.__dlMlPromise;
    window.__dlMlPromise = new Promise(function (res, rej) {
      var s = d.createElement("script");
      s.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
      s.onload = function () { window.maplibregl ? res(window.maplibregl) : rej(new Error("map")); };
      s.onerror = function () { rej(new Error("map")); };
      (d.head || d.documentElement).appendChild(s);
    });
    return window.__dlMlPromise;
  }
  function trackGeo(runs) {
    var lines = [], breaks = [], bounds = [];
    runs.forEach(function (r) {
      var label = runLabel(r);
      if (r.s === "b") {
        var p = r.pts[0]; if (!p) return;
        breaks.push({ type: "Feature", properties: { label: label }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } });
        bounds.push([p.lng, p.lat]);
        return;
      }
      if (r.pts.length < 2) return;
      lines.push({ type: "Feature", properties: { label: label, color: runColor(r) }, geometry: { type: "LineString", coordinates: r.pts.map(function (p) { bounds.push([p.lng, p.lat]); return [p.lng, p.lat]; }) } });
    });
    return { lines: { type: "FeatureCollection", features: lines }, breaks: { type: "FeatureCollection", features: breaks }, bounds: bounds };
  }
  function drawMap(w, meta) {
    var el = w.querySelector("#dl-map"); if (!el || !meta || !meta.track || typeof document === "undefined") return;
    if (w._dlMap && w._dlMap.remove) { try { w._dlMap.remove(); } catch (e0) {} }
    var hold = { map: null, dead: false };
    w._dlMap = { remove: function () { hold.dead = true; if (hold.map) { try { hold.map.remove(); } catch (e1) {} hold.map = null; } }, getMap: function () { return hold.map; } };
    var runs = trkDisplayRuns(trkPts(meta.track), meta.rides || []), geo = trackGeo(runs), spec = historyMapSpec(), tap = w.querySelector("#dl-map-tap");
    ensureMapLibre().then(function (ml) {
      if (hold.dead || !document.body || !document.body.contains(el)) return;
      var map = new ml.Map({ container: el, style: historyMapStyle(), minZoom: spec.minZoom, maxZoom: spec.maxZoom, attributionControl: true, fadeDuration: 0 });
      hold.map = map;
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", function () {
        if (hold.dead) return;
        map.addSource("dl-track", { type: "geojson", data: geo.lines });
        map.addSource("dl-break", { type: "geojson", data: geo.breaks });
        trackLayers().forEach(function (layer) { map.addLayer(layer); });
        var showTap = function (e) { var f = e.features && e.features[0]; if (tap && f && f.properties) tap.textContent = f.properties.label || ""; };
        map.on("click", "dl-stroke", showTap);
        map.on("click", "dl-break", showTap);
        if (mapView) map.jumpTo({ center: mapView.c, zoom: mapView.z });
        else if (geo.bounds.length > 1) {
          var b = geo.bounds.reduce(function (a, p) { return [[Math.min(a[0][0], p[0]), Math.min(a[0][1], p[1])], [Math.max(a[1][0], p[0]), Math.max(a[1][1], p[1])]]; }, [[geo.bounds[0][0], geo.bounds[0][1]], [geo.bounds[0][0], geo.bounds[0][1]]]);
          if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) map.jumpTo({ center: b[0], zoom: 16 });
          else map.fitBounds(b, { padding: 20, maxZoom: 16, duration: 0 });
        } else if (geo.bounds.length === 1) map.jumpTo({ center: geo.bounds[0], zoom: 16 });
        else map.jumpTo({ center: [-95.48, 30.33], zoom: 10 });
        map.on("moveend", function () { var c = map.getCenter(); mapView = { c: [c.lng, c.lat], z: map.getZoom() }; });
        map.once("idle", function () { try { el.dispatchEvent(new CustomEvent("dl-map-ready")); } catch (eR) {} });
      });
    }).catch(function () {});
    var cb = w.querySelector("#dl-personal"); if (cb && meta.onPersonal) cb.addEventListener("change", function () { meta.onPersonal(cb.checked); });
  }
  function historyHtml(days, shown) {
    var past = days.slice(1, 1 + shown);
    return "<p " + SEC + ">LAST " + past.length + " DAYS</p>" + past.map(function (d) { return listItem(d, false); }).join("") +
      '<button type="button" id="dl-older" style="display:block;width:calc(100% - 24px);margin:12px;padding:12px;border:1px solid #999;border-radius:8px;background:#fff;color:#333">Show older days</button>';
  }
  /* printable / inspector page: every day with its grid, form and events */
  function html(days, meta) { meta = meta || {}; return days.map(function (d) {
    return '<section class="dl-day" data-day="' + esc(d.day) + '" style="background:#fff;color:#111;border:1px solid #bbb;margin:8px 0;page-break-inside:avoid">' +
      '<h3 style="margin:0;padding:8px 12px;background:#2b2b2b;color:#fff">' + esc(wd(d, { weekday: "short" }) + " | " + wd(d, { month: "short", day: "2-digit" })) + "</h3>" +
      '<div style="padding:8px">' + gridSvg(d) + "</div>" + formHtml(d, meta) + eventsHtml(d, meta) + "</section>"; }).join(""); }
  function csv(days, meta) {
    var q = function (s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; };
    var v = (meta && meta.vehicle) || {}, lab = { off: "OFF", sb: "SB", drv: "D", on: "ON" };
    var lines = [["Date", "Driver", "Carrier", "Main office", "Vehicle", "Plate", "Status", "Start", "Duration min", "City", "OFF h", "SB h", "D h", "ON h", "Odo start", "Odo end", "Miles", "Edits / overrides"].map(q).join(",")];
    days.forEach(function (d) {
      var ed = d.edits.map(function (e) { return clock(e.at) + " " + e.what + " by " + e.by + " (" + (e.reason || "no reason") + ")"; }).join(" | ");
      var evs = events(d, meta || {}); if (!evs.length) evs = [{ c: "off", at: d.start, min: 0, city: "" }];
      evs.forEach(function (e) {
        lines.push([d.day, meta.driver || "", CARRIER.name, CARRIER.office, [v.year, v.make, v.model].filter(Boolean).join(" "), v.plate || "", lab[e.c], tclock(e.at), e.min, e.city,
          dec(d.totals.off), dec(d.totals.sb), dec(d.totals.drv), dec(d.totals.on), d.odo.start != null ? d.odo.start : "", d.odo.end != null ? d.odo.end : "", d.odo.miles != null ? d.odo.miles : "", ed].map(q).join(","));
      });
    });
    return lines.join("\r\n") + "\r\n";
  }
  /* full-screen viewer. mode: "all" (Logs list, 14 days) | "inspector" (today + previous day) | "day:YYYY-MM-DD[:tab]" */
  function open(days, meta, mode) {
    var o0 = document.getElementById("dl-overlay"); if (o0) o0.remove(); /* switching views keeps the one history entry */
    meta = meta || {};
    var w = document.createElement("div");
    w.id = "dl-overlay"; w.setAttribute("role", "dialog"); w.setAttribute("aria-label", "Driver's Log");
    w.style.cssText = "position:fixed;inset:0;z-index:100000;background:#f2f2f2;color:#222;overflow:auto;-webkit-overflow-scrolling:touch;font-family:-apple-system,system-ui,sans-serif";
    var hm2 = /^history(?::(\d+))?$/.exec(mode || ""), shown = hm2 ? Number(hm2[1]) || 14 : 0;
    if (hm2 && days.length < 1 + shown && meta.more) { meta.more(1 + shown); return null; } /* host rebuilds with more days and reopens */
    var m = /^day:(\d{4}-\d{2}-\d{2})(?::([\w-]+))?$/.exec(mode || ""), day = m && days.filter(function (d) { return d.day === m[1]; })[0];
    if (m && !day && /^insp/.test(m[2] || "") && days[0]) day = days[0]; /* v74e: an inspection request never lands on the Logs graph list */
    /* v74e hotfix (iPad Stage Manager, Oct 14 3:30 AM): the bar now clears the status bar / window controls (viewport-fit=cover had
       put it under them), wraps on narrow windows, and the close/back button is a 44 px target labeled for touch */
    var bar = function (title, back) { return '<div class="dl-bar" style="position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:6px;background:#2b2b2b;color:#fff;padding:10px;padding-top:max(36px, calc(10px + env(safe-area-inset-top)));padding-left:max(10px, calc(10px + env(safe-area-inset-left)));padding-right:max(10px, calc(10px + env(safe-area-inset-right)))">' + /* top 36 px clear: iPadOS Stage Manager window dots sit over the top-left corner */
      '<b style="flex:1 1 100%;min-width:0;text-align:left;font-size:17px">' + title + "</b>" +
      (mode === "inspector" ? "" : '<button type="button" id="dl-inspector" style="background:#2f6fe0;color:#fff;border:0;border-radius:6px;padding:6px 8px;min-height:44px">Show inspector</button>') +
      '<button type="button" id="dl-print" style="background:#444;color:#fff;border:0;border-radius:6px;padding:6px 8px;min-height:44px">Print</button><button type="button" id="dl-csv" style="background:#444;color:#fff;border:0;border-radius:6px;padding:6px 8px;min-height:44px">Export</button>' +
      '<button type="button" id="' + (back ? "dl-back" : "dl-close") + '" aria-label="' + (back ? "Back" : "Close") + '" style="margin-left:auto;min-width:88px;min-height:44px;background:#2e7d32;border:0;border-radius:10px;color:#fff;font-size:17px;font-weight:800;padding:6px 14px">' + (back ? "\u2190 Back" : "Close \u2715") + "</button></div>"; }; /* v74e: Close/Back on the RIGHT, 44 px+ */
    if (day) w.innerHTML = bar(esc(wd(day, { weekday: "short" }) + " | " + wd(day, { month: "short", day: "2-digit" })), true) + detailHtml(day, meta, m[2] || "log");
    else if (mode === "inspector") w.innerHTML = bar("Inspector view \u00b7 today + previous day", false) + '<div class="dl-insp-days" style="padding:6px">' + html(days.slice(0, 2), meta) + "</div>";
    else if (hm2) w.innerHTML = bar("History", true) + historyHtml(days, shown);
    else w.innerHTML = bar("Logs", false) + listHtml(days, meta);
    w.setAttribute("data-mode", mode || "all");
    document.body.appendChild(w);
    if (!day && !hm2 && mode !== "inspector") { try { drawMap(w, meta); } catch (eM) {} } /* v2.0m-s */
    try { if (!(history.state && history.state.dlOverlay)) history.pushState({ dlOverlay: 1 }, ""); } catch (eH) {} /* v74e: back gesture / button closes */
    padWire(w);
    var dform = w.querySelector("#dl-dvir-form");
    if (dform) { motionGate(dform); minTimeGate(dform); }
    if (dform) { /* v74 (Matthew): live camera captures only; each "Take photo" tap adds one shot */
      dform.__photos = {};
      dform.addEventListener("change", function (e) {
        var k = e.target.getAttribute && e.target.getAttribute("data-photo"); if (!k) return;
        var arr = dform.__photos[k] = dform.__photos[k] || [];
        Array.prototype.forEach.call(e.target.files || [], function (fl) { if (arr.length < 4) arr.push(fl); });
        try { e.target.value = ""; } catch (eV) {}
        var c = dform.querySelector('[data-photo-count="' + k + '"]'); if (c) c.textContent = arr.length ? arr.length + " photo" + (arr.length > 1 ? "s" : "") + " taken" : "";
      });
      var oi = dform.querySelector("#dl-dvir-odo"); if (oi) oi.addEventListener("input", function () { var v = oi.value.replace(/\..*$/, "").replace(/\D/g, ""); if (v !== oi.value) oi.value = v; });
    }
    if (dform) dform.addEventListener("change", function (e) { if (e.target.name === "dv-carwash") { var ww = dform.querySelector(".dl-wash-warn"); if (ww) ww.hidden = e.target.getAttribute("data-bad") !== "note"; } }); /* v77.9 */
    if (dform) dform.addEventListener("change", function (e) { if (e.target.name === "dv-fulltank") { var fu = dform.querySelector(".dl-fuel"); if (fu) fu.hidden = e.target.getAttribute("data-bad") !== "note"; } }); /* v74b */
    if (dform) dform.addEventListener("change", function (e) { var it = e.target.closest(".dl-dvir-item"); if (it && /^dv-/.test(e.target.name)) { var dd = it.querySelector(".dl-dvir-def"); if (dd) dd.hidden = e.target.getAttribute("data-bad") !== "1"; } });
    var st = document.getElementById("dl-print-style");
    if (!st) { st = document.createElement("style"); st.id = "dl-print-style"; st.textContent = "@media print{body>*:not(#dl-overlay){display:none!important}#dl-overlay{position:static!important;overflow:visible!important;background:#fff!important}#dl-overlay .dl-bar{display:none!important}}"; document.head.appendChild(st); }
    w.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("button,#dl-sig-clear") : null; if (!t) return;
      var id = t.id, pad = w.querySelector("#dl-sig-pad");
      if (id === "dl-sig-clear") { e.preventDefault(); if (pad) { pad.getContext("2d").clearRect(0, 0, pad.width, pad.height); pad.__ink = false; } return; }
      if (id === "dl-sig-save") { if (!pad || !pad.__ink) { window.alert("Sign with your finger first."); return; }
        meta.onSign(day.day, { img: pad.toDataURL("image/png"), at: Date.now(), hash: dayHash(day), cert: CERT }); open(days, meta, "day:" + day.day + ":sign"); return; }
      if (t.classList.contains("dl-dvir-kind")) { open(days, meta, "day:" + day.day + ":insp" + (t.getAttribute("data-kind") === "post" ? "-post" : "")); return; }
      if (id === "dl-dvir-nodef") { Array.prototype.forEach.call(w.querySelectorAll('#dl-dvir-form input[data-bad="0"]:not([name="dv-carwash"])'), function (r) { r.checked = true; }); Array.prototype.forEach.call(w.querySelectorAll(".dl-dvir-def"), function (d) { d.hidden = true; }); return; }
      if (id === "dl-dvir-save") {
        var f = w.querySelector("#dl-dvir-form"), err = w.querySelector("#dl-dvir-err"), odoRaw = String(f.odometer.value).replace(/[,\s]/g, ""), odo = Number(odoRaw);
        if (f.__startedAt && Date.now() - f.__startedAt < f.__minMs) { err.textContent = "Take at least " + Math.round(f.__minMs / 1000) + " seconds to inspect the vehicle (" + Math.ceil((f.__startedAt + f.__minMs - Date.now()) / 1000) + " s left)."; return; }
        if (odoRaw && !/^\d+$/.test(odoRaw)) { err.textContent = "Odometer: whole miles only (no decimal point)."; return; } /* v74 */
        if (!(odo > 0)) { err.textContent = "Enter the odometer reading."; return; }
        var stopIn = f.querySelector("#dl-stop-time"), stopAt = null; /* v2.0m-t: late post-trip needs the stop time */
        if (stopIn) { stopAt = stopTimeAt(day.day, stopIn.value); if (stopAt == null) { err.textContent = "Enter the time you stopped driving."; return; } }
        var dvPlate = f.plate ? String(f.plate.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "") : String((meta.vehicle && meta.vehicle.plate) || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); /* v2.0i */
        if (!dvPlate) { err.textContent = "Enter the plate of the vehicle you inspected."; return; }
        if (typeof meta.odoCheck === "function") { var oErr = ""; try { oErr = meta.odoCheck(f.getAttribute("data-kind"), odo, dvPlate) || ""; } catch (eO) {} if (oErr) { err.textContent = oErr; return; } } /* v75u: same floor rule as the shift odometer */
        if (!pad || !pad.__ink) { err.textContent = "Sign with your finger to submit."; return; }
        t.disabled = true;
        var mo = f.__motion || {}; if (mo.moving) { err.textContent = "Stop the vehicle to complete inspection"; t.disabled = false; return; }
        readDvir(f, meta).then(function (r) { r.motion = mo.seen ? "verified" : "unverified"; if (f.__startedAt) { r.startedAt = f.__startedAt; r.finishedAt = Date.now(); r.durationSec = Math.round((r.finishedAt - r.startedAt) / 1000); } if (mo.seen) r.maxMph = Math.round(mo.max); if (r.error) { err.textContent = r.error; t.disabled = false; return; }
          var ft = r.items && r.items.fulltank; /* v74b (Matthew): tank not full at post-trip -> reminder pop-up, OK acknowledged + logged */
          if (ft && ft.noteFlag && ft.fuel) { if (!f.__fuelAck) { t.disabled = false; fuelPopup(function () { f.__fuelAck = Date.now(); t.click(); }); return; } ft.fuelAckAt = f.__fuelAck; ft.fuelMsg = FUEL_MSG; }
          var kind = f.getAttribute("data-kind"); meta.onDvir(day.day, kind, Object.assign(r, stopAt != null ? { late: true, stopTime: stopIn.value, stoppedAt: stopAt } : {}, { kind: kind, day: day.day, at: Date.now(), odometer: odo, plate: dvPlate, sig: pad.toDataURL("image/png"), driver: meta.driver || "", vehicle: meta.vehicle || {} }));
          open(days, meta, "day:" + day.day + ":insp" + (kind === "post" ? "-post" : "")); });
        return;
      }
      if (id === "dl-close") close();
      else if (id === "dl-back") open(days, meta, hm2 || !day || day === days[0] ? "all" : "history:" + Math.max(14, days.indexOf(day)));
      else if (id === "dl-history") open(days, meta, "history:14");
      else if (id === "dl-older") open(days, meta, "history:" + (shown + 14));
      else if (id === "dl-inspector") open(days, meta, "inspector");
      else if (id === "dl-print") { open(days, meta, "print"); var o = document.getElementById("dl-overlay"); o.innerHTML = bar("Driver\u2019s Log \u00b7 " + days.length + " days", false) + html(days, meta); try { window.print(); } catch (x) {} }
      else if (id === "dl-csv") download(days, meta);
      else if (t.getAttribute("data-open-day")) open(days, meta, "day:" + t.getAttribute("data-open-day"));
      else if (t.getAttribute("data-tab") && day) open(days, meta, "day:" + day.day + ":" + t.getAttribute("data-tab"));
    });
    return w;
  }
  function download(days, meta) {
    var blob = new Blob([csv(days, meta)], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "drivers-log-" + String(meta.driver || "driver").replace(/[^a-z0-9]+/gi, "-") + "-" + (days[days.length - 1] || {}).day + "-to-" + (days[0] || {}).day + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return a.download;
  }
  function close(fromPop) { var o = document.getElementById("dl-overlay"); if (o) o.remove(); mapView = null;
    if (!fromPop) { try { if (history.state && history.state.dlOverlay) { closing = true; history.back(); } } catch (e) {} } }
  var closing = false;
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("popstate", function () { if (closing) { closing = false; return; } if (document.getElementById("dl-overlay")) close(true); });
    document.addEventListener("keydown", function (e) { if ((e.key === "Escape" || e.key === "Esc") && document.getElementById("dl-overlay") && !document.getElementById("dl-fuel-pop")) close(); });
  }
  /* v75z (Matthew 10/16, iPad screenshot): odometer boxes get a big 9-key number pad on screen. iPadOS has no number-only
     keyboard: inputmode="numeric" still opens the full keyboard (numbers + symbols row). The box uses inputmode="none" so the
     system keyboard stays down while the pad is on screen; a physical keyboard still types (digits only, filtered below).
     Whole miles, up to 7 digits (8 with data-odopad-max). Shared with God mode (odometer override box) via window.pcsOdoPadHtml. */
  function odoPadHtml() {
    var key = "min-height:56px;font-size:24px;font-weight:800;border-radius:10px;border:2px solid #0b3d23;background:#e8f5ec;color:#0b3d23;cursor:pointer;touch-action:manipulation";
    return '<div class="pcs-odopad" data-odopad="1" role="group" aria-label="Number pad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:340px;margin:8px 0 4px">' +
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clr", "0", "back"].map(function (k) {
        var lbl = k === "back" ? "\u232b" : k === "clr" ? "Clear" : k;
        return '<button type="button" data-odopad-key="' + k + '" aria-label="' + (k === "back" ? "Delete" : k === "clr" ? "Clear" : k) + '" style="' + key + (k === "clr" ? ";font-size:17px" : "") + '">' + lbl + "</button>";
      }).join("") + "</div>";
  }
  /* the box a pad types into: the [data-odopad-in] input in the pad's nearest form / [data-odopad-box] container */
  function odoPadTarget(pad) {
    var box = pad && pad.closest ? (pad.closest("[data-odopad-box]") || pad.closest("form")) : null;
    return box ? box.querySelector("input[data-odopad-in]") : null;
  }
  function odoPadPress(inp, k) {
    var max = Math.max(1, Math.min(8, Number(inp.getAttribute("data-odopad-max")) || Number(inp.getAttribute("maxlength")) || 7));
    var v = String(inp.value || "").replace(/\D/g, "");
    if (k === "back") v = v.slice(0, -1);
    else if (k === "clr") v = "";
    else if (/^\d$/.test(k) && v.length < max) v = (v === "0" ? "" : v) + k;
    inp.value = v;
    try { inp.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    return v;
  }
  if (typeof window !== "undefined") { window.pcsOdoPadHtml = odoPadHtml; window.pcsOdoPadPress = odoPadPress; }
  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", function (e) { var b = e.target && e.target.closest ? e.target.closest("[data-odopad-key]") : null; if (b) e.preventDefault(); }); /* keep focus / caret in the box */
    document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-odopad-key]") : null;
      if (!b) return;
      e.preventDefault();
      var inp = odoPadTarget(b.closest("[data-odopad]"));
      if (inp) odoPadPress(inp, b.getAttribute("data-odopad-key"));
    });
  }
  /* v75: auto-insert slashes while typing a DVIR date (numeric keypad has no "/"); odometer = digits only */
  if (typeof document !== "undefined") document.addEventListener("input", function (e) {
    var t = e.target; if (!t || !t.getAttribute) return;
    if (t.id === "dl-dvir-odo") { var o = t.value.replace(/\D/g, "").slice(0, 7); if (o !== t.value) t.value = o; return; }
    var mk = t.getAttribute("data-date-mask"); if (!mk) return;
    var del = e.inputType && e.inputType.indexOf("delete") === 0, d = t.value.replace(/\D/g, "").slice(0, mk === "my" ? 6 : 8), out = d;
    if (d.length > 2 || (d.length === 2 && !del)) out = d.slice(0, 2) + "/" + d.slice(2);
    if (mk === "mdy" && (d.length > 4 || (d.length === 4 && !del))) out = d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
    if (out !== t.value) t.value = out;
  }, true);
  window.PCSDriverLog = { newerWash: newerWash, washWarnText: washWarnText, washLastText: washLastText, WASH_WARN: WASH_WARN, recView: recView, washLine: washLine, minTimeGate: minTimeGate, fmtDur: fmtDur, motionGate: motionGate, fluidsDue: fluidsDue, readDvir: readDvir, parseMdy: parseMdy, expiryState: expiryState, washState: washState, EXTRAS: DVIR_EXTRAS, items: items, DVIR: DVIR, CERT: CERT, dayHash: dayHash, snapshot: snapshot, historyHtml: historyHtml, build: build, html: html, gridSvg: gridSvg, listHtml: listHtml, mapHtml: mapHtml, drawMap: drawMap, ridesHtml: ridesHtml, mapReset: function () { mapView = null; }, stopTimeAt: function (d, v) { return stopTimeAt(d, v); }, /* v2.0m-s: God day map */ trkRuns: trkRuns, trkTotals: trkTotals, trkPts: trkPts, trkDisplayRuns: trkDisplayRuns, runColor: runColor, runLabel: runLabel, rideTypeCanon: rideTypeCanon, rideDisplay: rideDisplay, pcsAutoRecord: pcsAutoRecord, rideSegmentStaysOpen: rideSegmentStaysOpen, foldRideSegments: foldRideSegments, trackLetter: trackLetter, historyMapSpec: historyMapSpec, historyMapStyle: historyMapStyle, trackLayers: trackLayers, trackGeo: trackGeo, detailHtml: detailHtml, csv: csv, open: open, close: close, download: download, midnight: midnight, CARRIER: CARRIER };
})();
/* v2.0m-bq (Matthew 11/12: "I need to be able to edit the drivers log. But only me."): God-mode Driver's Log edits.
   Pure helpers shared by God mode (the editor) and the driver app (reads the edits). Nothing here writes: God mode sends the
   ops through the Worker (/god/db, God password / token), which is the only owner-only write path.
   No edit loses data: each changed field keeps its FIRST value in godOrig/{field}, editedBy / editedAt / editReason say who,
   when and why, and an audit record goes to rides/DRVRHSLG/{id}/overrides/{at} (shown in the day's "God-mode edits / overrides").
   A delete is soft: deleted:true + deletedBy / deletedAt / deleteReason; the record stays in storage and drops out of the hour
   totals (70 h Cycle, Shift, Drive) and the driver's view. Edited values are written in place, so every reader (God view,
   driver Driver's Log, hosStatus) uses them; mask() tells the driver app which of its own local copies the edit replaced. */
(function () {
  "use strict";
  var L = typeof window !== "undefined" ? window.PCSDriverLog : null; if (!L) return;
  var TZ = "America/Chicago", IV = { drive: "Driving", breaks: "Break", offline: "Offline" };
  var FIELDS = { dvir: ["at", "plate", "odometer"], shift: ["shiftStartedAt", "shiftEndedAt", "startOdometer", "endOdometer"], iv: ["s", "e"] };
  var LABEL = { at: "time", plate: "plate", odometer: "odometer", shiftStartedAt: "start", shiftEndedAt: "end", startOdometer: "opening odometer", endOdometer: "ending odometer", s: "start", e: "end", status: "status" };
  var TIMEF = { at: 1, shiftStartedAt: 1, shiftEndedAt: 1, s: 1, e: 1 };
  function ymd(ms) { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
  function addDays(d, n) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10); }
  function tclock(ms) { try { return new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); } catch (e) { return String(ms); } }
  function show(f, v) { if (v == null || v === "") return "(none)"; return TIMEF[f] && Number(v) > 0 ? tclock(Number(v)) : f === "status" ? (IV[v] || v) : String(v); }
  function isDel(v) { return !!(v && typeof v === "object" && v.deleted === true); }
  function edited(v) { return !!(v && typeof v === "object" && (v.godOrig || v.editedBy)); }
  function n(v) { return v != null && v !== "" && isFinite(Number(v)) ? Number(v) : null; }
  /* every log entry of one Chicago day: hl = rides/DRVRHSLG/{id}, row = rides/DRVRMLES/{id}/{day} */
  function entries(day, hl, row) {
    hl = hl && typeof hl === "object" ? hl : {}; var t0 = L.midnight(day), t1 = L.midnight(addDays(day, 1)), out = [];
    var dv = (hl.dvir || {})[day] || {};
    var dvEnt = function (sub, kind, v) { out.push({ key: "dvir:" + sub, type: "dvir", kind: kind, label: (kind === "post" ? "Post-trip" : "Pre-trip") + " inspection", hub: "DRVRHSLG", base: "dvir/" + day, sub: sub + "/", t: n(v.at) || 0,
      vals: { at: n(v.at), plate: v.plate || "", odometer: v.odometer == null ? "" : v.odometer }, rec: v, deleted: isDel(v), edited: edited(v) }); };
    ["pre", "post"].forEach(function (k) { if (dv[k] && typeof dv[k] === "object") dvEnt(k, k, dv[k]); });
    Object.keys(dv.earlier || {}).forEach(function (ek) { var v = dv.earlier[ek]; if (v && typeof v === "object" && /^[A-Za-z0-9_-]{1,40}$/.test(ek)) dvEnt("earlier/" + ek, /^post/.test(ek) ? "post" : "pre", v); });
    var sh = row && row.shifts && typeof row.shifts === "object" ? row.shifts : {};
    Object.keys(sh).forEach(function (k) { var x = sh[k]; if (!x || typeof x !== "object" || !/^[A-Za-z0-9_-]{1,80}$/.test(k)) return;
      var today = ymd(Date.now());
      out.push({ open: day >= today && !(n(x.shiftEndedAt) > 0), key: "shift:" + k, type: "shift", label: "On duty (shift)", hub: "DRVRMLES", base: day, sub: "shifts/" + k + "/", t: n(x.shiftStartedAt) || n(k) || 0,
        vals: { shiftStartedAt: n(x.shiftStartedAt) || n(k), shiftEndedAt: n(x.shiftEndedAt), startOdometer: x.startOdometer == null ? "" : x.startOdometer, endOdometer: x.endOdometer == null ? "" : x.endOdometer },
        rec: x, deleted: isDel(x) || !!x.hosExcluded, excluded: !!x.hosExcluded && !isDel(x), edited: edited(x) }); });
    Object.keys(IV).forEach(function (c) { var o = hl[c] && typeof hl[c] === "object" ? hl[c] : {};
      Object.keys(o).forEach(function (k) { var v = o[k]; if (!v || typeof v !== "object" || !(n(v.s) > 0) || !/^[A-Za-z0-9_-]{1,80}$/.test(k)) return; var s = n(v.s), e = n(v.e) || s;
        if (!(s < t1 && e >= t0)) return;
        out.push({ key: c + ":" + k, type: "iv", coll: c, label: IV[c], hub: "DRVRHSLG", base: c + "/" + k, sub: "", t: s, vals: { s: s, e: n(v.e), status: c }, rec: v, open: !!v.open && !(n(v.e) > s), deleted: isDel(v), edited: edited(v) }); }); });
    out.sort(function (a, b) { return a.t - b.t || (a.key < b.key ? -1 : 1); });
    return out;
  }
  function audit(ent, kind, from, to, who, reason, now, day) {
    var what = ent.label + " " + show(ent.type === "dvir" ? "at" : ent.type === "shift" ? "shiftStartedAt" : "s", ent.type === "dvir" ? ent.vals.at : ent.type === "shift" ? ent.vals.shiftStartedAt : ent.vals.s) + ": " +
      (kind === "log delete" ? "deleted" : Object.keys(to).map(function (f) { return LABEL[f] + " " + show(f, from[f]) + " \u2192 " + show(f, to[f]); }).join(", "));
    return { kind: kind, what: what, entry: ent.key, path: "/rides/" + ent.hub + "/{id}/" + ent.base + (ent.sub ? "/" + ent.sub.replace(/\/$/, "") : ""), from: from, to: to, by: who, at: now, grantedAt: now, reason: reason, logDay: day };
  }
  /* changes: { field: new value } (times in ms; status = "drive" | "breaks" | "offline" for a Driving / Break / Offline entry).
     -> { ops: [...] for /god/db } or { error }. */
  function editOps(id, day, ent, changes, who, reason, now, hl, oldSign) {
    now = Number(now) || Date.now(); who = String(who || "God mode").slice(0, 80); reason = String(reason || "").trim().slice(0, 200);
    if (!ent || ent.deleted) return { error: "That entry is deleted." };
    if (ent.open) return { error: "That entry is still open on the driver's phone. Edit it after it ends." };
    var flds = ent.type === "dvir" ? FIELDS.dvir : ent.type === "shift" ? FIELDS.shift : FIELDS.iv, from = {}, to = {}, rec = ent.rec || {}, orig = rec.godOrig || {};
    Object.keys(changes || {}).forEach(function (f) {
      if (f === "status" || flds.indexOf(f) < 0) return; var nv = changes[f], ov = ent.vals[f];
      if (TIMEF[f] || f === "odometer" || /Odometer$/.test(f)) nv = nv === "" || nv == null ? null : Number(nv);
      if (f === "plate") nv = String(nv || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
      if ((nv === null || nv === "") && (ov === null || ov === "" || ov == null)) return;
      if (String(nv) === String(ov)) return;
      if (TIMEF[f] && !(nv > 0)) return; /* a time can't be blanked */
      if (nv !== null && typeof nv === "number" && !isFinite(nv)) return;
      from[f] = ov == null ? null : ov; to[f] = nv;
    });
    var s = to.s != null ? to.s : ent.vals.s, e = to.e != null ? to.e : ent.vals.e;
    if (ent.type === "iv" && e != null && s != null && e < s) return { error: "The end is before the start." };
    var ss = to.shiftStartedAt != null ? to.shiftStartedAt : ent.vals.shiftStartedAt, se = to.shiftEndedAt != null ? to.shiftEndedAt : ent.vals.shiftEndedAt;
    if (ent.type === "shift" && ss && se && se < ss) return { error: "The end is before the start." };
    var lim = now + 5 * 60000; if (Object.keys(to).some(function (f) { return TIMEF[f] && to[f] > lim; })) return { error: "A time can't be in the future." };
    var newSt = ent.type === "iv" && changes && changes.status && IV[changes.status] && changes.status !== ent.coll ? changes.status : "";
    if (!Object.keys(to).length && !newSt) return { error: "Nothing changed." };
    var stamp = { editedBy: who, editedAt: now, editReason: reason }, ops = [], base = "/rides/" + ent.hub + "/" + id + "/" + ent.base;
    if (newSt) { /* Driving / Break / Offline: soft-delete here, the same span is added under the new status (nothing is removed) */
      var nk = String(Math.round(s)); if (hl && hl[newSt] && hl[newSt][nk]) return { error: "There is already a " + IV[newSt] + " entry starting at that time." };
      var np = "/rides/DRVRHSLG/" + id + "/" + newSt + "/" + nk;
      ops.push({ method: "PATCH", path: base, value: { deleted: true, deletedBy: who, deletedAt: now, deleteReason: reason || "status changed to " + IV[newSt], movedTo: np.replace("/" + id + "/", "/{id}/") } });
      var nr = { s: s, e: e, open: false, movedFrom: base.replace("/" + id + "/", "/{id}/"), godOrig: Object.assign({}, orig, { status: orig.status || ent.coll, s: orig.s != null ? orig.s : ent.vals.s, e: orig.e != null ? orig.e : ent.vals.e }) };
      ops.push({ method: "PUT", path: np, value: Object.assign(nr, stamp) });
      from.status = ent.coll; to.status = newSt;
    } else {
      var p = {}; Object.keys(to).forEach(function (f) { p[ent.sub + f] = to[f]; if (orig[f] === undefined) p[ent.sub + "godOrig/" + f] = from[f] == null ? "(none)" : from[f]; });
      Object.keys(stamp).forEach(function (k) { p[ent.sub + k] = stamp[k]; });
      ops.push({ method: "PATCH", path: base, value: p });
    }
    var a = audit(ent, "log edit", from, to, who, reason, now, day); if (oldSign && oldSign.img) a.oldSign = { at: oldSign.at, hash: oldSign.hash || "", img: oldSign.img };
    ops.push({ method: "PUT", path: "/rides/DRVRHSLG/" + id + "/overrides/" + now, value: a });
    ops.push(unsignOp(id, day, oldSign, who, now));
    return { ops: ops, audit: a };
  }
  function deleteOps(id, day, ent, who, reason, now, oldSign) {
    now = Number(now) || Date.now(); who = String(who || "God mode").slice(0, 80); reason = String(reason || "").trim().slice(0, 200);
    if (!ent || ent.deleted) return { error: "That entry is already deleted." };
    if (ent.open) return { error: "That entry is still open on the driver's phone. Delete it after it ends." };
    var p = {}; p[ent.sub + "deleted"] = true; p[ent.sub + "deletedBy"] = who; p[ent.sub + "deletedAt"] = now; p[ent.sub + "deleteReason"] = reason;
    var a = audit(ent, "log delete", ent.vals, {}, who, reason, now, day); if (oldSign && oldSign.img) a.oldSign = { at: oldSign.at, hash: oldSign.hash || "", img: oldSign.img };
    return { ops: [{ method: "PATCH", path: "/rides/" + ent.hub + "/" + id + "/" + ent.base, value: p }, { method: "PUT", path: "/rides/DRVRHSLG/" + id + "/overrides/" + now, value: a }, unsignOp(id, day, oldSign, who, now)], audit: a };
  }
  /* driver app: which of its OWN local copies a God edit / delete replaced. drv = original driving spans to cut out of the local
     driving log; brk / off = keys (start ms) of local Break / Offline records to drop (the server copy, edited, is used instead). */
  function mask(h) {
    var m = { drv: [], brk: {}, off: {} };
    var each = function (o, fn) { if (o && typeof o === "object") Object.keys(o).forEach(function (k) { var v = o[k]; if (v && typeof v === "object" && (isDel(v) || v.godOrig)) fn(k, v); }); };
    each(h && h.drive, function (k, v) { var g = v.godOrig || {}, s = n(g.s) != null ? n(g.s) : n(v.s), e = n(g.e) != null ? n(g.e) : n(v.e); if (s > 0 && e > s) m.drv.push([s, e]); });
    each(h && h.breaks, function (k, v) { m.brk[k] = 1; var g = v.godOrig || {}; if (n(g.s) > 0) m.brk[String(n(g.s))] = 1; });
    each(h && h.offline, function (k, v) { m.off[k] = 1; var g = v.godOrig || {}; if (n(g.s) > 0) m.off[String(n(g.s))] = 1; });
    return m;
  }
  /* on-duty time a God edit / delete took OUT of a shift: original span minus the edited span (whole span when deleted).
     rows = DRVRMLES day rows (object or array). The edited span itself is counted from the shift record. */
  function shiftCuts(rows) {
    var cut = [], list = Array.isArray(rows) ? rows : Object.keys(rows || {}).map(function (k) { return rows[k]; });
    list.forEach(function (r) { var sh = r && r.shifts && typeof r.shifts === "object" ? r.shifts : {};
      Object.keys(sh).forEach(function (k) { var x = sh[k]; if (!x || typeof x !== "object" || !(isDel(x) || x.godOrig)) return; var g = x.godOrig || {};
        var os = n(g.shiftStartedAt) > 0 ? n(g.shiftStartedAt) : (n(x.shiftStartedAt) || n(k)), oe = g.shiftEndedAt === "(none)" ? null : (n(g.shiftEndedAt) > 0 ? n(g.shiftEndedAt) : n(x.shiftEndedAt));
        if (!(os > 0) || !(oe > os)) return;
        if (isDel(x)) { cut.push([os, oe]); return; }
        var ns = n(x.shiftStartedAt) || os, ne = n(x.shiftEndedAt) || oe;
        if (ns > os) cut.push([os, Math.min(ns, oe)]); if (ne < oe) cut.push([Math.max(ne, os), oe]); }); });
    return cut.filter(function (c) { return c[1] > c[0]; });
  }
  /* any edit / delete clears that day's signature: the old one is kept (prevSigns + the audit record); the day reads
     "Edited, needs your signature" until it is signed again (God mode reuses the Driver's Log signature pad). */
  function unsignOp(id, day, oldSign, who, now) {
    var prev = Object.assign({}, (oldSign && oldSign.prevSigns) || {});
    if (oldSign && oldSign.img) { var o = Object.assign({}, oldSign); delete o.prevSigns; delete o.needsSign; prev[String(Number(o.at) || now)] = o; }
    return { method: "PUT", path: "/rides/DRVRHSLG/" + id + "/signs/" + day, value: { needsSign: true, editedAt: now, editedBy: who, prevSigns: Object.keys(prev).length ? prev : null } };
  }
  function signRec(oldSign, rec, who) { var o = Object.assign({}, rec, { signedBy: who, signedIn: "God mode" }); var prev = oldSign && oldSign.prevSigns; if (prev) o.prevSigns = prev; return o; }
  function live(o) { var out = {}; if (o && typeof o === "object") Object.keys(o).forEach(function (k) { if (!isDel(o[k])) out[k] = o[k]; }); return out; }
  L.godEdit = { entries: entries, editOps: editOps, deleteOps: deleteOps, mask: mask, shiftCuts: shiftCuts, unsignOp: unsignOp, signRec: signRec, live: live, isDel: isDel, show: show, ymd: ymd, IV: IV, LABEL: LABEL };
})();
