/* PCS v2.0m-ca (Matthew 3:35 PM 11/16: "I want to see everything"): God mode "Ratings & surveys" section.
   Everything riders sent from the tracker after a ride, newest first, scrollable: date / time (CST), rider name or
   "Anonymous" (Stay anonymous on the survey hides the name; the Worker does not even send it), invoice #, driver, fare,
   the 1-5 driver stars + star comment, the tip, the five 1-10 survey answers, the grade (average of the five), the survey
   comment, the anonymous / name choice and website permission Yes / No. Read-only: POST /god/ratings (God sign-in) through god.js; nothing here writes. */
(function (root) {
  "use strict";
  var Q = [["car1", "(1) Cleanliness of the car"], ["car2", "(2) Comfort of the car"], ["drv1", "(3) Driver's safe driving"],
    ["drv2", "(4) Driver's courtesy and professionalism"], ["trk1", "(5) Ride tracker"]];
  var TZ = "America/Chicago";
  var S = { open: false, loading: false, err: "", rows: null, at: 0, scroll: 0, sample: false, load: null };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(c) { var n = Number(c); return n > 0 ? "$" + (n / 100).toFixed(2) : ""; }
  function score(v) { var n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null; }
  function stars5(v) { var n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; }
  function grade(sv) { /* the stored grade, else the average of the answered items (one decimal) */
    if (!sv) return null;
    var g = Number(sv.grade); if (isFinite(g) && g >= 1 && g <= 10 && sv.grade !== null && sv.grade !== "") return Math.round(g * 10) / 10;
    var a = Q.map(function (q) { return score(sv[q[0]]); }).filter(function (x) { return x != null; });
    return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length * 10) / 10 : null;
  }
  function parts(ms) {
    var o = {}; new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", weekday: "short", hour12: true, timeZoneName: "short" })
      .formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; }); return o;
  }
  function when(ms) { if (!(Number(ms) > 0)) return "Time not on the ride"; var p = parts(Number(ms)); return p.weekday + " " + p.month + "/" + p.day + "/" + p.year + " " + p.hour + ":" + p.minute + " " + p.dayPeriod + " " + (p.timeZoneName || "CT"); }
  function rowTime(r) { return Number(r && (r.rideAt || r.at)) || 0; }
  function displayName(r) { /* pure (tested) */
    var sv = r && r.survey;
    if (sv && sv.anon !== false) return "Anonymous";
    if (sv && sv.anon === false && sv.name) return String(sv.name);
    return r && r.rider ? String(r.rider) : "Rider name not on the ride";
  }
  function drivers(r) { var n = (r && r.driverNames) || []; return n.length ? n : ((r && r.driverIds) || []).length ? r.driverIds : ["Driver not on the ride"]; }
  function sortRows(rows) { return (rows || []).slice().sort(function (a, b) { return rowTime(b) - rowTime(a); }); }
  function starStr(n) { return n ? "\u2605\u2605\u2605\u2605\u2605".slice(0, n) + "\u2606\u2606\u2606\u2606\u2606".slice(0, 5 - n) : ""; }
  function rowHtml(r) {
    var sv = r.survey, st = stars5(r.stars), g = grade(sv);
    var tip = r.tipPaidCents > 0 ? money(r.tipPaidCents) + " (card, paid)" : r.tipOpenCents > 0 ? money(r.tipOpenCents) + " tip link opened, not paid" : "No tip from the tracker";
    if (r.rideTipCents > 0 && r.rideTipCents !== r.tipPaidCents) tip += " \u00b7 ride tip total " + money(r.rideTipCents);
    var fare = r.fareCents > 0 ? money(r.fareCents) + " pre-tax" : "Fare not on the ride";
    if (r.invoiceTotalCents > 0) fare += " \u00b7 invoice total " + money(r.invoiceTotalCents);
    var h = '<article class="gr-row" data-gr-id="' + esc(r.id) + '" style="border:2px solid #0b6b3a;border-radius:10px;padding:8px 10px;margin:6px 0;background:#fff;color:#0b3d23">' +
      '<p style="margin:0 0 4px;font-weight:900">' + esc(when(rowTime(r))) + " \u00b7 " + '<span class="gr-name">' + esc(displayName(r)) + "</span>" + (r.invoiceNo ? " \u00b7 Invoice #" + esc(r.invoiceNo) : "") + "</p>" +
      '<p style="margin:2px 0">Driver: ' + esc(drivers(r).join(", ")) + " \u00b7 Fare: " + esc(fare) + (r.linked ? " \u00b7 Linked ride" : "") + "</p>" +
      '<p style="margin:2px 0"><b>Driver stars:</b> ' + (st ? '<span style="color:#b8860b;font-size:18px">' + starStr(st) + "</span> " + st + " of 5" : "Not rated") +
      (r.starComment ? '<br><b>Star comment:</b> \u201c' + esc(r.starComment) + "\u201d" : "") + "</p>" +
      '<p style="margin:2px 0"><b>Tip:</b> ' + esc(tip) + "</p>";
    if (sv) {
      h += '<table class="gr-sv" style="border-collapse:collapse;margin:4px 0;width:100%;font-size:15px">' + Q.map(function (q) { var v = score(sv[q[0]]);
        return '<tr><td style="padding:1px 6px 1px 0">' + esc(q[1]) + '</td><td style="text-align:right;font-weight:900;white-space:nowrap">' + (v != null ? v + " / 10" : "Skipped") + "</td></tr>"; }).join("") +
        '<tr><td style="padding:2px 6px 1px 0;font-weight:900">Grade (average of the five)</td><td style="text-align:right;font-weight:900">' + (g != null ? g + " / 10" : "\u2014") + "</td></tr></table>" +
        (sv.comment ? '<p style="margin:2px 0"><b>Survey comment:</b> \u201c' + esc(sv.comment) + "\u201d</p>" : '<p style="margin:2px 0"><b>Survey comment:</b> none</p>') +
        '<p style="margin:2px 0"><b>Name choice:</b> ' + (sv.anon !== false ? "Stay anonymous" : "Use my name" + (sv.name ? " (" + esc(sv.name) + (sv.publicName ? ", website shows " + esc(sv.publicName) : "") + ")" : "")) +
        " \u00b7 <b>Website OK:</b> " + (sv.web === true ? "Yes" : sv.web === false ? "No" : "Not answered") + "</p>";
    } else h += '<p style="margin:2px 0" class="muted">' + (r.closed ? "Rider closed the pop-up without answering." : "No survey.") + "</p>";
    return h + "</article>";
  }
  function inner() {
    var rows = S.rows || [], list = sortRows(rows);
    var h = '<details class="gr-panel" id="god-ratings" style="margin:6px 0;border:2px solid #0b6b3a;border-radius:10px;padding:6px 8px"' + (S.open ? " open" : "") + '><summary style="cursor:pointer;font-weight:800">Ratings & surveys' + (S.rows ? " (" + rows.length + ")" : "") + "</summary>";
    if (!S.open) return h + "</details>";
    if (S.sample) h += '<p style="background:#fff3cd;color:#5c4400;border:2px solid #d4b15a;border-radius:8px;padding:6px;font-weight:900">SAMPLE DATA (made up for this preview, not real riders)</p>';
    h += '<p class="fine">Everything riders sent from their tracker after a ride. Newest first. Times are CST.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0">' +
      '<button type="button" class="btn btn-ghost" id="gr-refresh"' + (S.loading ? " disabled" : "") + ">" + (S.loading ? "Loading\u2026" : "Refresh") + "</button></div>";
    if (S.err) h += '<p class="error" role="alert">' + esc(S.err) + "</p>";
    if (!S.rows) return h + (S.loading ? '<p class="muted">Loading\u2026</p>' : "") + "</details>";
    h += '<div id="gr-list" style="max-height:60vh;overflow:auto;-webkit-overflow-scrolling:touch;margin-top:6px">' + (list.length ? list.map(rowHtml).join("") : '<p class="muted" id="gr-empty">' + "No ratings yet." + "</p>") + "</div>";
    return h + "</details>";
  }
  function panelHtml() { return '<div id="gr-wrap">' + inner() + "</div>"; }
  function repaint() { var w = document.getElementById("gr-wrap"); if (w) { w.innerHTML = inner(); after(); } }
  function after() { var l = document.getElementById("gr-list"); if (l && S.scroll) l.scrollTop = S.scroll; }
  function load() {
    if (!S.load || S.loading) return;
    S.loading = true; S.err = ""; repaint();
    Promise.resolve().then(S.load).then(function (d) { S.loading = false; S.rows = (d && Array.isArray(d.rows)) ? d.rows : []; S.at = Date.now(); S.sample = false; repaint(); },
      function (e) { S.loading = false; S.err = (e && e.message) || "Couldn't load the ratings. Try again."; repaint(); });
  }
  function wire() {
    if (typeof document === "undefined" || root.__pcsGrWired) return; root.__pcsGrWired = true;
    document.addEventListener("toggle", function (e) { var t = e.target; if (!t || t.id !== "god-ratings") return; var was = S.open; S.open = t.open; if (S.open && !was) { if (!S.rows || Date.now() - S.at > 60000) load(); else repaint(); } }, true);
    document.addEventListener("click", function (e) { var t = e.target; if (t && t.id === "gr-refresh") { e.preventDefault(); load(); } });
    document.addEventListener("scroll", function (e) { var t = e.target; if (t && t.id === "gr-list") S.scroll = t.scrollTop; }, true);
  }
  var api = { init: function (o) { if (o && typeof o.load === "function") S.load = o.load; wire(); }, panelHtml: panelHtml, after: after, state: S, questions: Q,
    displayName: displayName, grade: grade, when: when, rowHtml: rowHtml, inner: inner,
    _sample: function (rows) { S.rows = rows; S.sample = true; S.open = true; S.at = Date.now(); } /* previews / tests only */ };
  root.PCSGodRatings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
