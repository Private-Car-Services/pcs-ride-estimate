/* PCS v73: read-only "follow the ride" page for family. /follow/?t=<share token>. Polls the Worker /share/view, which
   answers ONLY a whitelisted public view (car position, pickup / destination addresses, ETA, meter, speed, time, status, first names). No buttons here
   change anything: the share token can't control the meter. */
(function () {
  "use strict";
  var WORKER = "https://pcs-pay.pcsrides.workers.dev";
  var POLL_MS = 5000;
  var app = document.getElementById("app");
  var m = String(window.location.search || "").match(/[?&]t=([A-Za-z0-9_-]{22})(?:&|#|$)/);
  if (/[?&]t=[A-Za-z0-9_-]{32}(?:&|#|$)/.test(String(window.location.search || ""))) return; /* v76b: a 32-character link is a "Follow my ride" link (follow-live.js) */
  var token = m ? m[1] : "";
  var S = { d: null, off: 0, map: null, layers: null, fitted: false, timer: 0, ended: false };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(c) { return "$" + ((Number(c) || 0) / 100).toFixed(2); }
  function clock(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ":" + String(mm).padStart(2, "0") : mm) + ":" + String(ss).padStart(2, "0"); }
  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var el = $(id); if (el && el.textContent !== t) el.textContent = t; }
  function message(title, body) {
    app.innerHTML = '<div class="card" id="fw-msg"><p class="tag">' + esc(title) + '</p><p class="lede">' + esc(body) + "</p>" +
      '<p class="fine">Need a ride of your own? Visit <a href="https://www.PCSrides.com" style="color:#f0d48a">www.PCSrides.com</a>.</p></div>';
  }
  function post(body) {
    return fetch(WORKER + "/share/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.ok) { var e = new Error(d.error || "Please try again in a moment."); e.status = r.status; throw e; } return d; }); });
  }
  function shell(d) {
    var who = d.firstName ? esc(d.firstName) + "\u2019s ride" : "The ride";
    app.innerHTML = '<div class="card" id="fw-live"><p class="tag" id="fw-title">' + who + " · live</p>" +
      (d.driverFirstName ? '<p class="fw-row fw-c" id="fw-driver">Driver: ' + esc(d.driverFirstName) + "</p>" : "") +
      '<div id="fw-map"></div>' +
      '<p class="fw-big" id="fw-price"></p><p class="fw-c fine" id="fw-price-label"></p>' +
      '<div class="fw-grid"><div><b id="fw-time">0:00</b><span>Time</span></div><div><b id="fw-mph">--</b><span>MPH</span></div><div><b id="fw-miles">0.0</b><span>Miles</span></div></div>' +
      '<p class="fw-row" id="fw-from"></p><p class="fw-row" id="fw-stops"></p><p class="fw-row" id="fw-to"></p>' +
      '<p class="fw-row fw-c" id="fw-eta" style="font-weight:700;color:#f0d48a"></p>' +
      '<p class="fw-c fine" id="fw-updated"></p><p class="error" id="fw-net" role="status"></p></div>';
    if (window.L) {
      S.map = window.L.map("fw-map", { zoomControl: true, attributionControl: true }).setView([29.76, -95.37], 11);
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(S.map);
      S.layers = window.L.layerGroup().addTo(S.map);
    }
  }
  function drawMap(d) {
    if (!S.map) return;
    var L = window.L, pts = [];
    S.layers.clearLayers();
    function dot(p, color, title) { if (!p) return; pts.push([p.lat, p.lng]); L.circleMarker([p.lat, p.lng], { radius: 8, color: color, fillColor: color, fillOpacity: .9 }).bindTooltip(title).addTo(S.layers); }
    dot(d.pickup, "#2e9b5f", "Pickup");
    (d.stops || []).forEach(function (p, i) { dot(p, "#c9a227", "Stop " + (i + 1)); });
    dot(d.dest, "#c0392b", "Destination");
    if (d.car) { pts.push([d.car.lat, d.car.lng]); L.circleMarker([d.car.lat, d.car.lng], { radius: 10, color: "#fff", weight: 3, fillColor: "#1e66f5", fillOpacity: 1 }).bindTooltip("Car").addTo(S.layers); }
    if (!S.fitted && pts.length) { S.fitted = true; if (pts.length === 1) S.map.setView(pts[0], 15); else S.map.fitBounds(pts, { padding: [30, 30] }); }
    else if (d.car) S.map.panTo([d.car.lat, d.car.lng]);
  }
  function update(d) {
    if (!$("fw-live")) shell(d);
    var p = d.price || {};
    if (p.cents == null) { setText("fw-price", "Fare"); setText("fw-price-label", "Set by the account"); }
    else { setText("fw-price", money(p.cents)); setText("fw-price-label", "Meter so far" + (p.estimateCents ? " · estimated total about " + money(p.estimateCents) + " before tax" : "")); }
    setText("fw-time", clock(Date.now() + S.off - d.startedAt));
    setText("fw-mph", d.mph == null ? "--" : String(d.mph));
    setText("fw-miles", Number(d.miles || 0).toFixed(1));
    setText("fw-from", d.pickup ? "From: " + (d.pickup.label || "pickup on the map") : "");
    setText("fw-stops", (d.stops || []).length ? "Stops: " + d.stops.map(function (s) { return s.label || "on the map"; }).join(" \u2192 ") : "");
    setText("fw-to", d.dest ? "To: " + (d.dest.label || "destination on the map") : "");
    var e = d.eta, at = "";
    if (e) { try { at = new Date(Date.now() + e.min * 60000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CT" /* v2.0l item 7 */; } catch (x) {} }
    setText("fw-eta", e ? "About " + Math.max(1, e.min) + " min · " + Number(e.miles).toFixed(1) + " mi left" + (at ? " · arrive about " + at : "") : "");
    var age = d.at ? Math.round((Date.now() + S.off - d.at) / 1000) : -1;
    setText("fw-updated", age < 0 ? "Waiting for the first update from the car…" : age <= 15 ? "Live · updated just now" : "Last update " + (age < 60 ? age + " s" : Math.floor(age / 60) + " min") + " ago");
    drawMap(d);
  }
  function poll() {
    S.timer = 0;
    if (document.visibilityState === "hidden") { S.timer = setTimeout(poll, POLL_MS); return; }
    post({ s: token }).then(function (d) {
      if (d.status === "ended") { S.ended = true; message("Ride ended", d.message || "This ride has ended. Thanks for following along."); return; }
      S.off = (Number(d.now) || Date.now()) - Date.now(); S.d = d; update(d);
      S.timer = setTimeout(poll, POLL_MS);
    }).catch(function (e) {
      if (e.status === 404) { message("Follow the ride", e.message); return; }
      if ($("fw-net")) setText("fw-net", e.status === 429 ? "Busy right now. Updating again shortly." : "Signal dropped for a moment. This page catches up when you're back online.");
      else message("Follow the ride", "We couldn\u2019t load the ride just yet. Trying again\u2026");
      S.timer = setTimeout(poll, POLL_MS * 2);
    });
  }
  setInterval(function () { if (S.d && !S.ended) setText("fw-time", clock(Date.now() + S.off - S.d.startedAt)); }, 1000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && !S.ended && !S.timer) poll(); });
  (function qr() { /* QR -> www.PCSrides.com so family can book PCS too */
    var el = $("fw-qr");
    if (!el || typeof window.qrcode !== "function") return;
    try { var q = window.qrcode(0, "M"); q.addData("https://www.PCSrides.com"); q.make(); el.innerHTML = q.createSvgTag(4, 0); } catch (e) {}
  })();
  window.__pcsFollowTest = { state: S };
  if (!token) message("Follow the ride", "This follow link isn\u2019t complete. Ask the rider to send it again.");
  else poll();
})();
