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
      var edits = editsOf(row).concat((data.overrides || []).filter(function (o) { var t = Number(o.at || o.grantedAt) || 0; return t >= t0 && t < t1; }).map(function (o) {
        return { at: Number(o.at || o.grantedAt), what: (o.auto ? "" : "God mode ") + (o.kind || "override") + (o.hours ? " (" + o.hours + " h)" : ""), by: o.by || "God mode", reason: o.reason || "" };
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
      if (x.editedBy || x.editReason || x.godEdit) out.push({ at: Number(x.editedAt || k) || 0, what: "Shift edited in God mode", by: x.editedBy || "God mode", reason: x.editReason || x.reason || "" });
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
    var ss = sigState(day, meta), r = ss.r;
    return '<div class="dl-sign" style="background:#fff;padding:16px;text-align:center;color:#444">' +
      '<p class="dl-cert" style="margin:0 0 12px">' + CERT + "</p>" +
      (r && !ss.stale ? '<img class="dl-sig-img" alt="Signature" src="' + esc(r.img) + '" style="max-width:100%;height:160px;object-fit:contain"><div style="border-top:1px solid #333;margin:0 0 8px"></div>' +
          '<p class="dl-signed" style="font-size:13px">Signed by ' + esc(meta.driver || "") + " on " + esc(clock(r.at)) + "</p>"
        : (ss.stale ? '<p class="dl-resign" style="color:#b91c1c;font-weight:700">This day was edited after it was signed. Please sign again.</p>' : "") +
          (meta.canSign ? '<canvas id="dl-sig-pad" width="680" height="170" style="width:100%;height:170px;touch-action:none;display:block"></canvas><div style="border-top:1px solid #333"></div>' +
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
    ch("oil", "Oil", LF, "Fluids", { block: true }), ch("coolant", "Coolant", LF, "Fluids", { block: true }), ch("washer", "Washer fluid", LF, "Fluids", { block: true }), /* block = blocks while the fluids check is overdue; a Low answer only flags */
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
  function items(meta) { var c = meta && meta.dvirItems; return (Array.isArray(c) && c.length ? c : DVIR).map(norm1).filter(Boolean); }
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
  function listHtml(days, meta) {
    return currentStatus(meta) + "<p " + SEC + ">TODAY</p>" + (days[0] ? listItem(days[0], true) : "") +
      '<button type="button" id="dl-history" style="display:block;width:calc(100% - 24px);margin:12px;padding:12px;border:1px solid #2f6fe0;border-radius:8px;background:#fff;color:#2f6fe0;font-weight:700">History</button>';
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
        if (typeof meta.odoCheck === "function") { var oErr = ""; try { oErr = meta.odoCheck(f.getAttribute("data-kind"), odo) || ""; } catch (eO) {} if (oErr) { err.textContent = oErr; return; } } /* v75u: same floor rule as the shift odometer */
        if (!pad || !pad.__ink) { err.textContent = "Sign with your finger to submit."; return; }
        t.disabled = true;
        var mo = f.__motion || {}; if (mo.moving) { err.textContent = "Stop the vehicle to complete inspection"; t.disabled = false; return; }
        readDvir(f, meta).then(function (r) { r.motion = mo.seen ? "verified" : "unverified"; if (f.__startedAt) { r.startedAt = f.__startedAt; r.finishedAt = Date.now(); r.durationSec = Math.round((r.finishedAt - r.startedAt) / 1000); } if (mo.seen) r.maxMph = Math.round(mo.max); if (r.error) { err.textContent = r.error; t.disabled = false; return; }
          var ft = r.items && r.items.fulltank; /* v74b (Matthew): tank not full at post-trip -> reminder pop-up, OK acknowledged + logged */
          if (ft && ft.noteFlag && ft.fuel) { if (!f.__fuelAck) { t.disabled = false; fuelPopup(function () { f.__fuelAck = Date.now(); t.click(); }); return; } ft.fuelAckAt = f.__fuelAck; ft.fuelMsg = FUEL_MSG; }
          var kind = f.getAttribute("data-kind"); meta.onDvir(day.day, kind, Object.assign(r, { kind: kind, day: day.day, at: Date.now(), odometer: odo, sig: pad.toDataURL("image/png"), driver: meta.driver || "", vehicle: meta.vehicle || {} }));
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
  function close(fromPop) { var o = document.getElementById("dl-overlay"); if (o) o.remove();
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
  window.PCSDriverLog = { newerWash: newerWash, washWarnText: washWarnText, washLastText: washLastText, WASH_WARN: WASH_WARN, recView: recView, washLine: washLine, minTimeGate: minTimeGate, fmtDur: fmtDur, motionGate: motionGate, fluidsDue: fluidsDue, readDvir: readDvir, parseMdy: parseMdy, expiryState: expiryState, washState: washState, EXTRAS: DVIR_EXTRAS, items: items, DVIR: DVIR, CERT: CERT, dayHash: dayHash, snapshot: snapshot, historyHtml: historyHtml, build: build, html: html, gridSvg: gridSvg, listHtml: listHtml, detailHtml: detailHtml, csv: csv, open: open, close: close, download: download, midnight: midnight, CARRIER: CARRIER };
})();
