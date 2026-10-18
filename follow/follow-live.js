/* PCS v76f: 2.5 s updates, GPS speed/heading when shared, gliding arrow. v76e: big live speed + ETA + heading arrow (computed here). v76b (Matthew 10/17): "Follow my ride" / driver tracking link. /follow/?t=<32-character token>.
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
  var POLL_MS = 1000, END_SHOW_MS = 30 * 60000, MAX_AGE_MS = 24 * 3600000, STALE_MS = 6 * 3600000;
  var PCS_PHONE = "936-261-7878", PCS_TEL = "tel:+19362617878";
  var app = document.getElementById("app");
  var S = { trk: [], mph: null, brg: null, d: null, map: null, layers: null, fitted: false, timer: 0, ended: false, misses: 0, lastKey: "" };
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
      "#fl-map{height:62vh;min-height:340px;border-radius:14px;margin:6px 0 10px;border:2px solid #0b3d23}" +
      ".fl-eta{font-size:19px;font-weight:900;text-align:center;margin:6px 0}.fl-row{margin:3px 0;font-size:16px}.fl-row b{display:inline-block;min-width:44px}" +
      ".fl-upd{font-size:13px;text-align:center;margin:6px 0 0}.fl-call{display:block;margin:10px 0 0;min-height:52px;line-height:52px;text-align:center;border-radius:12px;background:#bef1c6;color:#0b3d23 !important;border:3px solid #2e9d4f;font-size:19px;font-weight:900;text-decoration:none}" +
      ".fl-big{display:grid;grid-template-columns:1fr 1.4fr;gap:8px;margin:8px 0}.fl-spd,.fl-arr{background:#fff;border:3px solid #2e9d4f;border-radius:14px;padding:8px;text-align:center;color:#0b3d23}" +
      ".fl-spd b{display:block;font-size:46px;line-height:1.05;font-weight:900;font-variant-numeric:tabular-nums}.fl-spd span{display:block;font-size:15px;font-weight:800}.fl-spd small{display:block;font-size:12px;font-weight:700}" +
      ".fl-arr .k{display:block;font-size:15px;font-weight:800}.fl-arr b{display:block;font-size:34px;line-height:1.1;font-weight:900}.fl-arr span{display:block;font-size:16px;font-weight:800}.fl-arr small{display:block;font-size:13px;font-weight:700}" +
      ".fl-carico{background:none;border:0}" +
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
      '<div class="fl-big" id="fl-big" hidden><div class="fl-spd" id="fl-spd"><b id="fl-mph">--</b><span id="fl-mph-l">mph</span><small id="fl-mph-n"></small></div>' +
      '<div class="fl-arr" id="fl-arr"><span class="k" id="fl-arr-k"></span><b id="fl-arr-t"></b><span id="fl-arr-m"></span><small id="fl-arr-to"></small></div></div>' +
      '<p class="fl-eta" id="fl-eta"></p>' +
      '<div id="fl-map" role="img" aria-label="Map with the car, the pickup and the drop-off"></div>' +
      '<p class="fl-row" id="fl-from"></p><p class="fl-row" id="fl-to"></p>' +
      '<p class="fl-upd" id="fl-upd"></p><p class="error" id="fl-net" role="status"></p>' +
      '<a class="fl-call" id="fl-call" href="' + PCS_TEL + '">Questions? Call PCS ' + PCS_PHONE + "</a></div>";
    if (window.L) {
      S.map = window.L.map("fl-map", { zoomControl: true, attributionControl: true }).setView([29.76, -95.37], 11);
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(S.map);
      S.layers = window.L.layerGroup().addTo(S.map);
      window.addEventListener("resize", function () { try { S.map.invalidateSize(); } catch (e) {} });
      setTimeout(function () { try { S.map.invalidateSize(); } catch (e) {} }, 300);
      try { /* v76e: fixed north indicator, top-right (the map is always north-up) */
        var N = window.L.control({ position: "topright" });
        N.onAdd = function () { var el = window.L.DomUtil.create("div", "fl-north"); el.id = "fl-north"; el.setAttribute("aria-label", "North is up");
          el.innerHTML = '<svg width="40" height="48" viewBox="0 0 40 48"><circle cx="20" cy="28" r="18" fill="#fff" stroke="#0b3d23" stroke-width="3"/><path d="M20 12 L27 32 L20 28 L13 32 Z" fill="#0b3d23"/><text x="20" y="10" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="900" fill="#0b3d23" stroke="#fff" stroke-width="3" paint-order="stroke">N</text></svg>';
          el.style.cssText = "line-height:0;pointer-events:none"; return el; };
        N.addTo(S.map);
      } catch (e) {}
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
    if (car) pts.push(car);
    carMove(car);
    var key = (d.status || "") + (car ? "c" : "");
    if (!S.fitted || S.lastKey !== key) { S.fitted = true; S.lastKey = key; if (pts.length === 1) S.map.setView(pts[0], 15); else if (pts.length) S.map.fitBounds(pts, { padding: [36, 36], maxZoom: 16 }); }
    else if (car && !S.map.getBounds().pad(-0.15).contains(car)) S.map.panTo(car);
  }
  /* v76f: ONE car marker, painted at 60 fps (requestAnimationFrame). Between fixes (~1 s apart) it keeps rolling along
     the heading at the current speed for up to 2 s (dead reckoning), easing toward each new fix; turns take the short way. */
  var ARROW = '<svg id="fl-arrow" width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(0deg)"><circle cx="22" cy="22" r="20" fill="#0b3d23" stroke="#fff" stroke-width="3"/><path d="M22 7 L33 33 L22 27 L11 33 Z" fill="#bef1c6" stroke="#fff" stroke-width="1.5"/></svg>';
  var DR_MS = 2000;
  function carMove(car) {
    var L = window.L;
    if (!car) { if (S.car) { try { S.car.remove(); } catch (e) {} S.car = null; } S.fix = null; return; }
    if (!S.fix || S.fix.p[0] !== car[0] || S.fix.p[1] !== car[1]) S.fix = { p: car, t: Date.now() };
    if (!S.car) {
      S.car = L.marker(car, { icon: L.divIcon({ className: "fl-carico", iconSize: [44, 44], iconAnchor: [22, 22], html: ARROW }), keyboard: false, zIndexOffset: 1000 }).bindTooltip("Your PCS car").addTo(S.map);
      S.carAt = car; S.carDeg = S.brg !== null ? S.brg : 0; carPaint(car, S.carDeg);
    }
    if (!S.loop) { S.loop = 1; S.lastFrame = Date.now(); (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(frame); }
  }
  function ahead(p, deg, mi) { /* point mi miles from p along deg (flat-earth, fine for a few metres) */
    var r = Math.PI / 180, dLat = (mi / 69.0) * Math.cos(deg * r), dLng = (mi / (69.0 * Math.cos(p[0] * r))) * Math.sin(deg * r);
    return [p[0] + dLat, p[1] + dLng];
  }
  function target(now) {
    if (!S.fix) return null;
    var dt = Math.min(DR_MS, Math.max(0, now - S.fix.t)), mph = S.spdLive && S.mph !== null ? S.mph : 0;
    return mph >= 2 && S.brg !== null ? ahead(S.fix.p, S.brg, mph * dt / 3600000) : S.fix.p;
  }
  function frame() {
    if (!S.car || S.ended) { S.loop = 0; return; }
    var now = Date.now(), dt = Math.min(200, now - (S.lastFrame || now)); S.lastFrame = now;
    var k = 1 - Math.exp(-dt / 250), tg = target(now), at = S.carAt || tg;
    if (tg) {
      if (hav(at, tg) > 0.3) at = tg; /* big jump (GPS reset / page woke up): snap */
      else at = [at[0] + (tg[0] - at[0]) * k, at[1] + (tg[1] - at[1]) * k];
    }
    if (S.brg !== null) { var dd = ((S.brg - S.carDeg + 540) % 360) - 180; S.carDeg = Math.abs(dd) < 0.5 ? S.brg : (S.carDeg + dd * k + 360) % 360; }
    S.carAt = at; carPaint(at, S.carDeg);
    if (S.spdLive && S.mph !== null) { /* speed number glides too */
      S.mphShown = S.mphShown == null ? S.mph : S.mphShown + (S.mph - S.mphShown) * k;
      var m = Math.round(S.mphShown); setText("fl-mph", m < 2 ? "0" : String(m)); setText("fl-mph-l", m < 2 ? "mph \u00b7 Stopped" : "mph");
    }
    (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(frame);
  }
  function carPaint(at, deg) {
    try { S.car.setLatLng(at); } catch (e) {}
    var el = document.getElementById("fl-arrow"); if (!el) return;
    el.style.transform = "rotate(" + Math.round(deg) + "deg)";
    var path = el.querySelector("path"); if (path) path.style.display = S.brg === null ? "none" : ""; /* until a heading is known: a round dot */
  }
  /* v76e (parents 10/18): speed + heading worked out ON THIS PAGE from the car points the driver app already shares
     (pos.lat/lng/at, ~every 8 s). Nothing new is read or written. mph = distance / time between fresh points, smoothed;
     heading = bearing between the last two points that moved 15 m+. Hidden when the car point is over 60 s old. */
  function hav(a, b) { var R = 3958.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function bearing(a, b) { var r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r),
    x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  function track(d) {
    var p = pt(d.pos), at = d.pos && num(d.pos.at); if (!p || !at) return;
    var T = S.trk, last = T[T.length - 1];
    if (last && at <= last.at) return;
    if (last && at - last.at > 90000) { T.length = 0; S.mph = null; last = null; } /* gap: start fresh */
    T.push({ p: p, at: at }); if (T.length > 12) T.shift();
    var gm = num(d.pos.mph), gh = num(d.pos.hdg);
    if (gm !== null && gm >= 0 && gm < 130) S.mph = gm; /* v76f: the phone's own GPS speed */
    else if (last) { /* fallback: distance / time over the last 6-20 s of points */
      var b = null; for (var k = T.length - 2; k >= 0; k -= 1) { if (at - T[k].at >= 6000) { b = T[k]; break; } }
      if (b && at - b.at <= 20000) {
        var mi = hav(b.p, p), v = mi < 0.005 ? 0 : mi / ((at - b.at) / 3600000); /* under ~8 m counts as standing still */
        if (v <= 110) S.mph = S.mph === null || v === 0 ? v : S.mph * 0.4 + v * 0.6;
      }
    }
    if (gh !== null && gh >= 0 && gh <= 360) S.brg = gh;
    else for (var i = T.length - 2; i >= 0; i -= 1) { if (hav(T[i].p, p) >= 0.0093) { S.brg = bearing(T[i].p, p); break; } }
  }
  function placeName(o) { var l = o && typeof o === "object" ? txt(o.label, 120) : ""; return l.split(",")[0].trim(); }
  function bigBox(d, now, live) {
    var big = $("fl-big"); if (!big) return;
    var pAt = d.pos && num(d.pos.at), fresh = live && pAt && now - pAt <= 60000;
    var e = d.eta, eAt = num(d.etaAt) || num(d.updatedAt) || now;
    var etaOk = live && e && num(e.min) !== null && num(e.miles) !== null && now - eAt <= 180000;
    big.hidden = !live;
    if (!live) return;
    S.spdLive = !!(fresh && S.mph !== null); if (!S.spdLive) S.mphShown = null;
    if (fresh && S.mph !== null) { var m = Math.round(S.mphShown != null ? S.mphShown : S.mph); setText("fl-mph", m < 2 ? "0" : String(m)); setText("fl-mph-l", m < 2 ? "mph \u00b7 Stopped" : "mph"); setText("fl-mph-n", "Live speed"); }
    else { setText("fl-mph", "--"); setText("fl-mph-l", "mph"); setText("fl-mph-n", pAt ? "Last updated " + Math.max(1, Math.round((now - pAt) / 60000)) + " min ago" : "Waiting for the car"); }
    var dest = e && e.to === "dest";
    var nm = dest ? placeName(d.dest) : placeName(d.pickup);
    setText("fl-arr-k", dest ? "Arriving at the drop-off" : "Arriving at the pickup");
    if (etaOk) {
      var arr = eAt + Math.max(0, num(e.min)) * 60000, left = Math.max(1, Math.round((arr - now) / 60000)), t = "";
      if (arr < now) arr = now + 60000;
      try { t = new Date(arr).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (x) {}
      setText("fl-arr-t", "about " + t);
      setText("fl-arr-m", left + " min \u00b7 " + Math.max(0, num(e.miles)).toFixed(1) + " mi");
    } else { setText("fl-arr-t", "Updating\u2026"); setText("fl-arr-m", ""); }
    setText("fl-arr-to", nm);
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
    setText("fl-eta", $("fl-big") ? "" : etaOk ? "About " + Math.max(1, Math.round(num(e.min))) + " min \u00b7 " + Math.max(0, num(e.miles)).toFixed(1) + " mi to the " + (e.to === "dest" ? "drop-off" : "pickup") + (at ? " \u00b7 about " + at : "") : "");
    var pk = d.pickup && typeof d.pickup === "object" ? txt(d.pickup.label, 120) : "", dr = d.dest && typeof d.dest === "object" ? txt(d.dest.label, 120) : "";
    setText("fl-from", pk ? "From: " + pk : "");
    setText("fl-to", dr ? "To: " + dr : "");
    var pAt = d.pos && num(d.pos.at), age = pAt ? Math.round((now - pAt) / 1000) : -1;
    var showCar = (live || d.status === "completed") && !!pt(d.pos);
    setText("fl-upd", !live ? (done ? "The car stopped sharing its location at the end of the ride." : "The car shows on the map once your driver heads out.")
      : age < 0 ? "Waiting for the first update from the car\u2026" : age <= 20 ? "Live \u00b7 updated just now" : "Last update " + (age < 60 ? age + " s" : Math.floor(age / 60) + " min") + " ago");
    track(d); bigBox(d, now, live);
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
  /* v76f: live stream. Firebase REST streaming (EventSource on the SAME public .json read the poll uses; nothing new is
     opened up). Each "put" / "patch" lands in about a second. If the stream errors 3 times, or the browser lacks
     EventSource, the page falls back to reading every 1 s. While the stream is healthy the poll only checks on it. */
  function setPath(root, path, data, merge) {
    var segs = String(path || "/").split("/").filter(Boolean);
    if (!segs.length) { if (!merge) return data; var o = root && typeof root === "object" ? Object.assign({}, root) : {}; Object.keys(data || {}).forEach(function (k) { if (data[k] === null) delete o[k]; else o[k] = data[k]; }); return o; }
    var top = root && typeof root === "object" ? Object.assign({}, root) : {}, cur = top;
    for (var i = 0; i < segs.length - 1; i += 1) { cur[segs[i]] = cur[segs[i]] && typeof cur[segs[i]] === "object" ? Object.assign({}, cur[segs[i]]) : {}; cur = cur[segs[i]]; }
    var last = segs[segs.length - 1];
    var v = merge ? setPath(cur[last], "/", data, true) : data;
    if (v === null) delete cur[last]; else cur[last] = v;
    return top;
  }
  function streamStop() { if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; } }
  function streamGot() {
    S.streamAt = Date.now();
    var d = S.raw, now = Date.now();
    if (!d || typeof d !== "object") return;
    var why = over(d, now);
    if (why) { streamStop(); message("Ride ended", why, true); return; }
    S.misses = 0; S.d = d; update(d);
    if ($("fl-net")) setText("fl-net", "");
  }
  function stream() {
    if (S.es || S.ended || S.noStream || typeof window.EventSource !== "function") return;
    var es;
    try { es = new window.EventSource(DB + "/rides/FLWSHARE/" + token + ".json"); } catch (e) { S.noStream = true; return; }
    S.es = es;
    function ev(merge) { return function (m) { try { var x = JSON.parse(m.data); if (!x || typeof x !== "object") return; S.raw = setPath(S.raw, x.path, x.data, merge); S.sErr = 0; streamGot(); } catch (e) {} }; }
    es.addEventListener("put", ev(false));
    es.addEventListener("patch", ev(true));
    es.addEventListener("keep-alive", function () { S.streamAt = Date.now(); });
    es.addEventListener("cancel", function () { S.noStream = true; streamStop(); });
    es.addEventListener("auth_revoked", function () { S.noStream = true; streamStop(); });
    es.onerror = function () { streamStop(); S.streamAt = 0; S.sErr = (S.sErr || 0) + 1; if (S.sErr >= 3) S.noStream = true; };
  }
  function poll() {
    S.timer = 0;
    if (S.ended) return;
    if (S.es && S.streamAt && Date.now() - S.streamAt < 40000) { S.timer = setTimeout(poll, 3000); return; } /* stream is live */
    if (document.visibilityState === "hidden") { S.timer = setTimeout(poll, POLL_MS); return; }
    fetch(DB + "/rides/FLWSHARE/" + token + ".json", { cache: "no-store" }).then(function (r) {
      if (r.status === 401 || r.status === 403) { var e = new Error("denied"); e.denied = true; throw e; }
      if (!r.ok) throw new Error("net");
      return r.json();
    }).then(function (d) {
      var now = Date.now();
      if (!d || typeof d !== "object") {
        S.misses += 1;
        if (S.misses >= 60) { message("Follow the ride", "This follow link isn\u2019t active. Ask for a new link, or call PCS.", true); return; }
        if (!$("fl-live")) message("Follow the ride", "Getting the ride ready\u2026");
        S.timer = setTimeout(poll, POLL_MS); return;
      }
      S.misses = 0;
      var why = over(d, now);
      if (why) { message("Ride ended", why, true); return; }
      S.d = d; S.raw = d; update(d);
      if ($("fl-net")) setText("fl-net", "");
      stream();
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
  setInterval(function () { if (S.d && !S.ended && $("fl-live")) { try { bigBox(S.d, Date.now(), /^(on_way|arrived|picked_up)$/.test(String(S.d.status))); } catch (e) {} } }, 15000);
  window.__pcsFollowLive = { setPath: setPath, update: update, track: track, state: S, over: over, statusText: statusText };
  poll();
})();
