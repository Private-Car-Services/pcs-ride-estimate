/* PCS v76b (Matthew 10/17): "Follow my ride" / driver tracking link. /follow/?t=<32-character token>.
   Read-only. Reads ONE small public copy: /rides/FLWSHARE/<token> (written by the rider / driver / God apps, see app.js
   folClean). Shows: status, driver first name, car + plate, the car on a map with the route, pickup + drop-off, ETA and
   the PCS phone. Never the fare, payment, card or the rider's phone / email (they are never in the copy). Everything read
   is treated as untrusted text (escaped, numbers checked). 30 min after the ride is completed / cancelled, when sharing
   stops, or after 24 h, the page shows "This ride has ended" with no map. No buttons here change anything. */
(function () {
  "use strict";
  var q = String(window.location.search || "").match(/[?&]t=([A-Za-z0-9_-]{32})(?:&|#|$)/);
  if (!q) return; /* the older 22-character links (rider meter "Share this ride") run follow.js */
  var token = q[1];
  var DB = "https://pts-maps-rides-default-rtdb.firebaseio.com";
  var POLL_MS = 5000, END_SHOW_MS = 30 * 60000, MAX_AGE_MS = 24 * 3600000, STALE_MS = 6 * 3600000;
  var PCS_PHONE = "936-261-7878", PCS_TEL = "tel:+19362617878";
  var app = document.getElementById("app");
  var S = { d: null, map: null, layers: null, fitted: false, timer: 0, ended: false, misses: 0, lastKey: "" };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function txt(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var el = $(id); if (el && el.textContent !== t) el.textContent = t; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function pt(p) { if (!p || typeof p !== "object") return null; var a = num(p.lat), b = num(p.lng); return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0) ? [a, b] : null; }
  function style() {
    if ($("fl-style")) return;
    var st = document.createElement("style"); st.id = "fl-style";
    st.textContent = "#fl-live{background:#f0fdf4;color:#0b3d23;border:3px solid #2e9d4f;border-radius:16px;padding:12px}" +
      "#fl-live p{color:#0b3d23}.fl-status{display:block;margin:0 0 8px;padding:10px 12px;border-radius:12px;background:#0b6b3a;color:#fff !important;font-size:21px;font-weight:900;text-align:center}" +
      ".fl-who{font-size:18px;font-weight:800;margin:4px 0}.fl-car{font-size:16px;font-weight:700;margin:2px 0 8px}.fl-plate{display:inline-block;background:#fff;border:2px solid #0b3d23;border-radius:8px;padding:0 8px;margin-left:4px;font-weight:900;letter-spacing:.06em}" +
      "#fl-map{height:46vh;min-height:260px;border-radius:14px;margin:6px 0 10px;border:2px solid #0b3d23}" +
      ".fl-eta{font-size:19px;font-weight:900;text-align:center;margin:6px 0}.fl-row{margin:3px 0;font-size:16px}.fl-row b{display:inline-block;min-width:44px}" +
      ".fl-upd{font-size:13px;text-align:center;margin:6px 0 0}.fl-call{display:block;margin:10px 0 0;min-height:52px;line-height:52px;text-align:center;border-radius:12px;background:#bef1c6;color:#0b3d23 !important;border:3px solid #2e9d4f;font-size:19px;font-weight:900;text-decoration:none}" +
      ".fl-msg{background:#f0fdf4;color:#0b3d23;border:3px solid #2e9d4f;border-radius:16px;padding:14px}.fl-msg p{color:#0b3d23}.fl-msg .tag{color:#0b3d23;font-weight:900;font-size:20px}";
    document.head.appendChild(st);
  }
  function message(title, body, final) {
    style();
    if (final) { S.ended = true; if (S.map) { try { S.map.remove(); } catch (e) {} S.map = null; } }
    app.innerHTML = '<div class="card fl-msg" id="fl-msg"><p class="tag">' + esc(title) + '</p><p class="lede">' + esc(body) + "</p>" +
      '<a class="fl-call" id="fl-call" href="' + PCS_TEL + '">Call PCS ' + PCS_PHONE + "</a>" +
      '<p class="fine">Need a ride of your own? Visit <a href="https://www.PCSrides.com" style="color:#0b3d23;font-weight:800">www.PCSrides.com</a>.</p></div>';
  }
  function statusText(d) {
    var st = d.status, e = d.eta, to = e && e.to;
    if (st === "assigned") return "Your PCS driver will head your way soon";
    if (st === "on_way") return e && num(e.miles) !== null && num(e.miles) <= 0.1 ? "Your driver is arriving now" : "Your driver is on the way";
    if (st === "arrived") return "Your driver is at the pickup";
    if (st === "picked_up") return "Picked up \u00b7 on the way" + (to === "dest" || d.dest ? " to the drop-off" : "");
    if (st === "completed") return "Ride completed";
    if (st === "cancelled") return "This ride was cancelled";
    return "Following the ride";
  }
  function carText(c) {
    if (!c || typeof c !== "object") return "";
    return [txt(c.color, 20), txt(c.year, 4), txt(c.make, 30), txt(c.model, 30)].filter(Boolean).join(" ");
  }
  function shell() {
    style();
    app.innerHTML = '<div class="card" id="fl-live"><p class="fl-status" id="fl-status" role="status" aria-live="polite"></p>' +
      '<p class="fl-who" id="fl-who"></p><p class="fl-car" id="fl-car"></p>' +
      '<p class="fl-eta" id="fl-eta"></p>' +
      '<div id="fl-map" role="img" aria-label="Map with the car, the pickup and the drop-off"></div>' +
      '<p class="fl-row" id="fl-from"></p><p class="fl-row" id="fl-to"></p>' +
      '<p class="fl-upd" id="fl-upd"></p><p class="error" id="fl-net" role="status"></p>' +
      '<a class="fl-call" id="fl-call" href="' + PCS_TEL + '">Questions? Call PCS ' + PCS_PHONE + "</a></div>";
    if (window.L) {
      S.map = window.L.map("fl-map", { zoomControl: true, attributionControl: true }).setView([29.76, -95.37], 11);
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(S.map);
      S.layers = window.L.layerGroup().addTo(S.map);
    }
  }
  function draw(d, showCar) {
    if (!S.map || !S.layers) return;
    var L = window.L, pts = [], route = [];
    S.layers.clearLayers();
    if (Array.isArray(d.route)) d.route.slice(0, 120).forEach(function (p) { var a = Array.isArray(p) ? pt({ lat: p[0], lng: p[1] }) : null; if (a) route.push(a); });
    if (route.length > 1 && d.status !== "completed" && d.status !== "cancelled") {
      L.polyline(route, { color: "#0B3D91", weight: 9, opacity: 0.85, interactive: false }).addTo(S.layers);
      L.polyline(route, { color: "#1E88FF", weight: 5, opacity: 1, interactive: false }).addTo(S.layers);
    }
    function dot(p, color, title) { var a = pt(p); if (!a) return; pts.push(a); L.circleMarker(a, { radius: 9, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(title).addTo(S.layers); }
    dot(d.pickup, "#2e9d4f", "Pickup");
    dot(d.dest, "#c0392b", "Drop-off");
    var car = showCar ? pt(d.pos) : null;
    if (car) { pts.push(car); L.circleMarker(car, { radius: 12, color: "#fff", weight: 4, fillColor: "#0b3d23", fillOpacity: 1 }).bindTooltip("Your PCS car", { permanent: false }).addTo(S.layers); }
    var key = (d.status || "") + (car ? "c" : "");
    if (!S.fitted || S.lastKey !== key) { S.fitted = true; S.lastKey = key; if (pts.length === 1) S.map.setView(pts[0], 15); else if (pts.length) S.map.fitBounds(pts, { padding: [36, 36], maxZoom: 16 }); }
    else if (car) S.map.panTo(car);
  }
  function update(d) {
    if (!$("fl-live")) shell();
    var now = Date.now();
    setText("fl-status", statusText(d));
    var who = txt(d.driverFirst, 31);
    setText("fl-who", who ? "Your PCS driver: " + who : "Your PCS driver");
    var car = $("fl-car"), ct = carText(d.car), plate = d.car && typeof d.car === "object" ? txt(d.car.plate, 12) : "";
    var ch = (ct ? esc(ct) : "") + (plate ? ' <span class="fl-plate" aria-label="License plate">' + esc(plate) + "</span>" : "");
    if (car && car.__h !== ch) { car.innerHTML = ch; car.__h = ch; }
    var live = d.status === "on_way" || d.status === "arrived" || d.status === "picked_up";
    var done = d.status === "completed" || d.status === "cancelled";
    var e = d.eta, etaOk = live && e && num(e.min) !== null && num(e.miles) !== null && (!num(d.etaAt) || now - num(d.etaAt) <= 180000);
    var at = "";
    if (etaOk) { try { at = new Date(now + Math.max(0, num(e.min)) * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (x) {} }
    setText("fl-eta", etaOk ? "About " + Math.max(1, Math.round(num(e.min))) + " min \u00b7 " + Math.max(0, num(e.miles)).toFixed(1) + " mi to the " + (e.to === "dest" ? "drop-off" : "pickup") + (at ? " \u00b7 about " + at : "") : "");
    var pk = d.pickup && typeof d.pickup === "object" ? txt(d.pickup.label, 120) : "", dr = d.dest && typeof d.dest === "object" ? txt(d.dest.label, 120) : "";
    setText("fl-from", pk ? "From: " + pk : "");
    setText("fl-to", dr ? "To: " + dr : "");
    var pAt = d.pos && num(d.pos.at), age = pAt ? Math.round((now - pAt) / 1000) : -1;
    var showCar = (live || d.status === "completed") && !!pt(d.pos);
    setText("fl-upd", !live ? (done ? "The car stopped sharing its location at the end of the ride." : "The car shows on the map once your driver heads out.")
      : age < 0 ? "Waiting for the first update from the car\u2026" : age <= 20 ? "Live \u00b7 updated just now" : "Last update " + (age < 60 ? age + " s" : Math.floor(age / 60) + " min") + " ago");
    draw(d, showCar);
  }
  function over(d, now) {
    if (!d || typeof d !== "object") return "";
    var st = String(d.status || "");
    if (st === "stopped") return "Sharing for this ride was turned off.";
    if (st === "ended") return "This ride has ended. Thanks for following along with PCS.";
    var end = num(d.endedAt), upd = num(d.updatedAt), made = num(d.createdAt);
    if ((st === "completed" || st === "cancelled") && end && now - end > END_SHOW_MS) return "This ride has ended. Thanks for following along with PCS.";
    if ((made && now - made > MAX_AGE_MS) || (upd && now - upd > STALE_MS)) return "This follow link has expired. Thanks for following along with PCS.";
    return "";
  }
  function poll() {
    S.timer = 0;
    if (S.ended) return;
    if (document.visibilityState === "hidden") { S.timer = setTimeout(poll, POLL_MS); return; }
    fetch(DB + "/rides/FLWSHARE/" + token + ".json", { cache: "no-store" }).then(function (r) {
      if (r.status === 401 || r.status === 403) { var e = new Error("denied"); e.denied = true; throw e; }
      if (!r.ok) throw new Error("net");
      return r.json();
    }).then(function (d) {
      var now = Date.now();
      if (!d || typeof d !== "object") {
        S.misses += 1;
        if (S.misses >= 12) { message("Follow the ride", "This follow link isn\u2019t active. Ask for a new link, or call PCS.", true); return; }
        if (!$("fl-live")) message("Follow the ride", "Getting the ride ready\u2026");
        S.timer = setTimeout(poll, POLL_MS); return;
      }
      S.misses = 0;
      var why = over(d, now);
      if (why) { message("Ride ended", why, true); return; }
      S.d = d; update(d);
      if ($("fl-net")) setText("fl-net", "");
      S.timer = setTimeout(poll, POLL_MS);
    }).catch(function (e) {
      if (e && e.denied) { message("Follow the ride", "This follow link can\u2019t be opened right now. Please call PCS.", true); return; }
      if ($("fl-net")) setText("fl-net", "Signal dropped for a moment. This page catches up when you\u2019re back online.");
      else message("Follow the ride", "Loading the ride\u2026 trying again.");
      S.timer = setTimeout(poll, POLL_MS * 2);
    });
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && !S.ended && !S.timer) poll(); });
  (function qr() { var el = $("fw-qr"); if (!el || typeof window.qrcode !== "function") return; try { var x = window.qrcode(0, "M"); x.addData("https://www.PCSrides.com"); x.make(); el.innerHTML = x.createSvgTag(4, 0); } catch (e) {} })();
  window.__pcsFollowLive = { state: S, over: over, statusText: statusText };
  poll();
})();
