/* v2.0m-s (Matthew 11/4): God mode "Driver day map". Read-only. Pick a driver + day (default today) and see the same map,
   ride list (PCS/Uber/Lyft/Other), tap info and per-status totals as the driver's Logs screen (driverlog.js renders it).
   Reads rides/DRVRMLES/{id}/{day} (track + rideSegments). Writes nothing. */
(function () {
  var DB = "https://pts-maps-rides-default-rtdb.firebaseio.com", HUB = "DRVRMLES", TZ = "America/Chicago";
  var WORKER = ((typeof window !== "undefined" && window.PCS_PAY_WORKER) || "https://pcs-pay.pcsrides.workers.dev").replace(/\/+$/, "");
  function ymd(ms) { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
  /* first minute of the day in Chicago (same t0 the driver app uses) */
  function dayStart(day) {
    var base = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
    for (var h = 3; h <= 8; h++) { var t = base + h * 3600000; if (ymd(t) === day && ymd(t - 60000) !== day) return t; }
    return base + 6 * 3600000;
  }
  /* track/<sec> = "sec,lat,lng,s;..." -> { t0, pts: [[sec,lat,lng,s]] } sorted, no duplicates */
  function trackOf(raw, day) {
    var seen = {}, pts = [];
    Object.keys((raw && typeof raw === "object") ? raw : {}).forEach(function (k) {
      String(raw[k] || "").split(";").forEach(function (q) {
        var p = q.split(","); if (p.length < 4) return;
        var a = [Number(p[0]), Number(p[1]), Number(p[2]), String(p[3])];
        if (!isFinite(a[0]) || !isFinite(a[1]) || !isFinite(a[2]) || "arbo".indexOf(a[3]) < 0 || a[3].length !== 1 || seen[a[0]]) return;
        seen[a[0]] = 1; pts.push(a);
      });
    });
    pts.sort(function (x, y) { return x[0] - y[0]; });
    return { t0: dayStart(day), pts: pts, personal: false, canToggle: false };
  }
  function ridesOf(raw) {
    var list = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.keys(raw).map(function (k) { return raw[k]; }) : []);
    return list.filter(function (x) { return x && Number(x.start) > 0; }).map(function (x) {
      return { type: String(x.type || "Other"), start: Number(x.start), end: Number(x.end) || 0, minutes: Number(x.minutes) || 0, miles: Number(x.miles) || 0 };
    }).sort(function (a, b) { return a.start - b.start; });
  }
  function metaOf(row, day, now) { row = row || {}; return { now: now || Date.now(), track: trackOf(row.track, day), rides: ridesOf(row.rideSegments) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function bodyHtml(meta, day) {
    var DL = window.PCSDriverLog, today = day === ymd(Date.now());
    var r = DL.ridesHtml(meta) || '<p style="margin:8px 12px;color:#666">No rides this day.</p>';
    var m = DL.mapHtml(meta);
    if (!today) { r = r.replace(">RIDES TODAY<", ">RIDES<"); m = m.replace(">TODAY'S MAP<", ">MAP<").replace("No driving yet today.", "No driving this day."); }
    return r + m;
  }
  function tok() { try { var t = localStorage.getItem("pcs-god-queue-token") || ""; return (Number(t.split(".")[1]) || 0) > Date.now() + 60000 ? t : ""; } catch (e) { return ""; } }
  function driverIds() { /* hub listing needs God auth: the same Worker /god/read God mode already uses */
    var t = tok(); if (!t) return Promise.resolve([]);
    return fetch(WORKER + "/god/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hub: HUB, query: { shallow: "true" }, godToken: t }) })
      .then(function (r) { return r.json(); }).then(function (d) { return d && d.ok && d.value ? Object.keys(d.value).sort() : []; }).catch(function () { return []; });
  }
  function load(id, day) {
    return fetch(DB + "/rides/" + HUB + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(day) + ".json").then(function (r) { return r.ok ? r.json() : Promise.reject(); }).catch(function () {
      var t = tok(); if (!t) return null; /* rules refuse the direct read: same God read God mode uses */
      return fetch(WORKER + "/god/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hub: HUB, sub: [id, day], godToken: t }) })
        .then(function (r) { return r.json(); }).then(function (d) { return d && d.ok ? d.value : null; }).catch(function () { return null; });
    });
  }
  var ov = null;
  function show(id, day) {
    var out = ov.querySelector("#gm-out"); out.innerHTML = "Loading\u2026";
    if (out._dlMap) { try { out._dlMap.remove(); } catch (e) {} out._dlMap = null; }
    return load(id, day).then(function (row) {
      var meta = metaOf(row, day); window.PCSDriverLog.mapReset();
      out.innerHTML = bodyHtml(meta, day); window.PCSDriverLog.drawMap(out, meta);
    });
  }
  function open() {
    if (ov) return;
    ov = document.createElement("div"); ov.id = "gm-overlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:#f4f4f4;color:#111;overflow:auto";
    ov.innerHTML = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:#193819;color:#fff">' +
      '<b style="flex:1 1 100%">Driver day map (view only)</b>' +
      '<select id="gm-driver" style="flex:1;min-height:40px;color:#111;background:#fff"><option value="">Loading drivers\u2026</option></select>' +
      '<input id="gm-day" type="date" value="' + ymd(Date.now()) + '" style="min-height:40px;color:#111;background:#fff">' +
      '<button type="button" id="gm-close" style="min-height:40px">Close</button></div><div id="gm-out" style="padding-bottom:20px"></div>';
    document.body.appendChild(ov);
    var sel = ov.querySelector("#gm-driver"), dayEl = ov.querySelector("#gm-day"), go = function () { if (sel.value && dayEl.value) show(sel.value, dayEl.value); };
    driverIds().then(function (ids) {
      sel.innerHTML = ids.length ? '<option value="">Pick a driver</option>' + ids.map(function (i) { return '<option value="' + esc(i) + '">' + esc(i) + "</option>"; }).join("")
        : '<option value="">Sign in to God mode first</option>';
    });
    sel.addEventListener("change", go); dayEl.addEventListener("change", go);
    ov.querySelector("#gm-close").addEventListener("click", function () { var o = ov.querySelector("#gm-out"); if (o._dlMap) try { o._dlMap.remove(); } catch (e) {} ov.remove(); ov = null; window.PCSDriverLog.mapReset(); });
  }
  if (typeof document !== "undefined" && document.body) {
    var b = document.createElement("button"); b.type = "button"; b.id = "gm-open"; b.textContent = "Driver day map";
    b.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:99990;min-height:40px;padding:0 12px;border-radius:8px;border:1px solid #193819;background:#fff;color:#193819;font-weight:700";
    b.addEventListener("click", open); document.body.appendChild(b);
  }
  if (typeof window !== "undefined") window.__pcsGodMap = { trackOf: trackOf, ridesOf: ridesOf, metaOf: metaOf, dayStart: dayStart, bodyHtml: bodyHtml }; /* test hook */
})();
