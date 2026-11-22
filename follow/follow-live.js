/* PCS v76g (Matthew 10/18): the ride's stops on the map (numbered) + in the From / To list; the map zooms in on the car and
   its next target as it gets closer (pauses 25 s after the viewer pans or zooms the map); a slide-down pop-up across the top
   when the driver is about 1 minute from the pickup and again from the drop-off (once per leg, plus a short vibration
   where the phone supports it; silent, no sound).
   v2.0m-bz2: before pickup, frame the car and the pickup only (never the drop-off). If the pickup has no coordinates,
   follow the car at street zoom (16). After pickup, frame the car and the drop-off the same way. Re-fits as the gap shrinks
   (max zoom 17, padded). A manual pan or zoom pauses auto-fit for 25 s.
   v2.0m-bz3: driver's average stars under the photo (or next to the name if there is no photo), and Share my ride — a
   separate public copy with its own token, no invoice / pay / receipt / tip / original token.
   v76f: 2.5 s updates, GPS speed/heading when shared, gliding arrow. v76e: big live speed + ETA + heading arrow (computed here). v76b (Matthew 10/17): "Follow my ride" / driver tracking link. /follow/?t=<32-character token>.
   Read-only. Reads ONE small public copy: /rides/FLWSHARE/<token> (written by the rider / driver / God apps, see app.js
   folClean). Shows: status, driver first name + photo (v77.3b, from the picture card), car + plate, the car on a map with the route, pickup + drop-off, ETA and
   the PCS phone. Never the fare, payment, card or the rider's phone / email (they are never in the copy). Everything read
   is treated as untrusted text (escaped, numbers checked). 30 min after the ride is completed / cancelled, when sharing
   stops, or after 24 h, the page shows "This ride has ended" with no map. No buttons here change anything.
   v2.0m-ca (Matthew 3:35 PM 11/16): a COMPLETED ride's page still shows "This ride has ended" (no map, no live stream) after
   30 min, but keeps the after-ride stars / tip / survey for up to 48 h after the ride ended (the Worker's PR_WINDOW_MS).
   Stopped and cancelled links are unchanged. */
(function () {
  "use strict";
  var q = String(window.location.search || "").match(/[?&]t=([A-Za-z0-9_-]{32})(?:&|#|$)/);
  if (!q) return; /* the older 22-character links (rider meter "Share this ride") run follow.js */
  var token = q[1];
  var DB = "https://pts-maps-rides-default-rtdb.firebaseio.com";
  var POLL_MS = 1000, END_SHOW_MS = 30 * 60000, PR_SHOW_MS = 48 * 3600000 /* v2.0m-ca: = Worker PR_WINDOW_MS */, MAX_AGE_MS = 24 * 3600000, STALE_MS = 6 * 3600000;
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
    ensureFlSos();
    if ($("fl-style")) return;
    var st = document.createElement("style"); st.id = "fl-style";
    st.textContent = "#fl-live{background:#f0fdf4;color:#0b3d23;border:3px solid #2e9d4f;border-radius:16px;padding:12px}" +
      "#fl-live p{color:#0b3d23}.fl-status{display:block;margin:0 0 8px;padding:10px 12px;border-radius:12px;background:#0b6b3a;color:#fff !important;font-size:21px;font-weight:900;text-align:center}" +
      ".fl-under{display:flex;align-items:flex-start;gap:8px;margin:0 0 6px}.fl-under-main{flex:1 1 auto;min-width:0}#fl-call a{color:#0b3d23;font-weight:900;text-decoration:underline}" +
      ".fl-drv{display:flex;align-items:center;gap:10px;background:#0b3d23;color:#f3ead2;border:2px solid #d4b15a;border-radius:14px;padding:6px 10px;margin:0}#fl-live .fl-drv .fl-who,#fl-live .fl-drv .fl-car{color:#f3ead2}.fl-photo{width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #d4b15a;flex:none;background:#20371d}.fl-drv-t{min-width:0}.fl-drv .fl-plate{color:#0b3d23}" +
      ".fl-who{font-size:18px;font-weight:800;margin:4px 0}.fl-car{font-size:16px;font-weight:700;margin:2px 0 8px}.fl-plate{display:inline-block;background:#fff;border:2px solid #0b3d23;border-radius:8px;padding:0 8px;margin-left:4px;font-weight:900;letter-spacing:.06em}" +
      "#fl-map{height:62vh;min-height:340px;border-radius:14px;margin:6px 0 10px;border:2px solid #0b3d23}" +
      ".fl-eta{font-size:19px;font-weight:900;text-align:center;margin:6px 0}.fl-row{margin:3px 0;font-size:16px}.fl-row b{display:inline-block;min-width:44px}" +
      ".fl-upd{font-size:13px;text-align:center;margin:6px 0 0}.fl-call{display:block;margin:10px 0 0;min-height:52px;line-height:52px;text-align:center;border-radius:12px;background:#bef1c6;color:#0b3d23 !important;border:3px solid #2e9d4f;font-size:19px;font-weight:900;text-decoration:none}#fl-call[hidden]{display:none}#fl-call{line-height:1.3;padding:10px 12px;box-sizing:border-box;height:auto}#fl-call .fl-bill-link{white-space:nowrap}" +
      ".fl-big{display:grid;grid-template-columns:1fr 1.4fr;gap:8px;margin:8px 0}.fl-spd,.fl-arr{background:#fff;border:3px solid #2e9d4f;border-radius:14px;padding:8px;text-align:center;color:#0b3d23}" +
      ".fl-spd b{display:block;font-size:46px;line-height:1.05;font-weight:900;font-variant-numeric:tabular-nums}.fl-spd span{display:block;font-size:15px;font-weight:800}.fl-spd small{display:block;font-size:12px;font-weight:700}" +
      ".fl-arr .k{display:block;font-size:15px;font-weight:800}.fl-arr b{display:block;font-size:34px;line-height:1.1;font-weight:900}.fl-arr span{display:block;font-size:16px;font-weight:800}.fl-arr small{display:block;font-size:13px;font-weight:700}" +
      ".fl-carico{background:none;border:0}" +
      ".fl-stopico{background:none;border:0}.fl-stopico div{width:26px;height:26px;border-radius:50%;background:#fff;border:3px solid #0b3d23;color:#0b3d23;font:900 15px/26px system-ui,-apple-system,sans-serif;text-align:center;box-sizing:content-box;box-shadow:0 1px 3px rgba(0,0,0,.35)}" +
      ".fl-stopico.done div{background:#d9e6dc;border-color:#6b8f78;color:#4a6656}" +
      "#fl-soon{position:fixed;left:6px;right:6px;top:4px;top:calc(env(safe-area-inset-top,0px) + 4px);z-index:2000;background:#bef1c6;color:#0b3d23;border:3px solid #2e9d4f;border-radius:14px;" +
      "padding:8px 12px;box-shadow:0 6px 18px rgba(11,61,35,.35);text-align:center;cursor:pointer;transform:translateY(-130%);opacity:0;transition:transform .45s ease,opacity .45s ease;-webkit-tap-highlight-color:transparent}" +
      "#fl-soon.in{transform:translateY(0);opacity:1}#fl-soon b{display:block;font-size:20px;line-height:1.2;font-weight:900}#fl-soon small{display:block;font-size:13px;font-weight:700;margin-top:1px}" +
      ".fl-msg{background:#f0fdf4;color:#0b3d23;border:3px solid #2e9d4f;border-radius:16px;padding:14px}.fl-msg p{color:#0b3d23}.fl-msg .tag{color:#0b3d23;font-weight:900;font-size:20px}" +
      ".fl-rate-col{display:flex;flex-direction:column;align-items:center;flex:none;max-width:48%}.fl-stars{margin:4px 0 0;font-size:14px;line-height:1.15;text-align:center;font-weight:800;color:#0b3d23;white-space:nowrap}.fl-star-empty{opacity:.3;filter:grayscale(1)}" +
      ".fl-share{display:block;width:auto;margin:12px auto 0;padding:8px 18px;min-height:44px;box-sizing:border-box;text-align:center;background:#bef1c6;border:2px solid #2e9d4f;border-radius:999px;color:#0b6b3a;font-size:19px;font-weight:900;text-decoration:none;cursor:pointer}#fl-share[hidden]{display:none}.fl-share-note{margin:6px 0 0;text-align:center;font-size:13px;font-weight:700;color:#e8f5ea}";
    document.head.appendChild(st);
  }
  function message(title, body, final, keepPr) {
    style();
    if (final) { S.ended = true; S.prKeep = !!keepPr; soonHide(true); } /* v2.0m-ca: keepPr = a completed ride still inside the 48 h after-ride window */
    if (final && S.map) { try { S.map.remove(); } catch (e) {} S.map = null; }
    if (final && !keepPr) { try { postRideEnd(); } catch (e) {} } /* v2.0m-bz */
    app.innerHTML = '<div class="card fl-msg" id="fl-msg"><p class="tag">' + esc(title) + '</p><p class="lede">' + esc(body) + "</p>" +
      '<a class="fl-call" id="fl-call" href="' + PCS_TEL + '">Call PCS ' + PCS_PHONE + "</a>" +
      '<p class="fine">Need a ride of your own? Visit <a href="https://www.PCSrides.com" style="color:#0b3d23;font-weight:800">www.PCSrides.com</a>.</p></div>';
    ensureFlSos();
  }
  function sosVehicle(d) {
    d = d || {};
    var name = txt(d.driverFirst, 40);
    var car = carText(d.car);
    var plate = d.car && typeof d.car === "object" ? txt(d.car.plate, 12) : "";
    return { name: name || "Driver name not shared", car: car || "Car not shared", plate: plate || "Plate not shared" };
  }
  function sosPoint(d) {
    var p = pt(d && d.pos);
    return p ? { lat: p[0], lng: p[1] } : null;
  }
  function sosReadout(d) {
    var v = sosVehicle(d), loc = sosPoint(d);
    return ["Driver: " + v.name, "Car: " + v.car, "Plate: " + v.plate, loc ? "Location: " + loc.lat.toFixed(6) + ", " + loc.lng.toFixed(6) : "Location unavailable"].join("\n");
  }
  function sosMapsHref(lat, lng) {
    var dest = (+lat).toFixed(6) + "," + (+lng).toFixed(6);
    var apple = false;
    try { apple = /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); } catch (e) {}
    return apple ? "maps://?ll=" + encodeURIComponent(dest) + "&q=" + encodeURIComponent(dest) : "https://www.google.com/maps?q=" + encodeURIComponent(dest);
  }
  function ensureFlSos() {
    if ($("fl-sos-btn")) return;
    if (!$("fl-sos-style")) {
      var st = document.createElement("style");
      st.id = "fl-sos-style";
      /* v2.0m-az: flush to the tracker corner. The old 64px inset sat on the driver photo. */
      st.textContent = "body[data-app=\"follow\"] .phone{position:relative}#fl-sos-btn{position:absolute;top:0;right:0;z-index:3000;width:64px;height:64px;border-radius:50%;border:3px solid #fff;background:#c0161b;color:#fff;font:900 13px/1.05 system-ui,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.45);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
        "#fl-sos-ask,#fl-sos-sheet{position:fixed;inset:0;z-index:4000;background:rgba(5,14,28,.94);display:flex;align-items:center;justify-content:center;padding:16px}" +
        "#fl-sos-ask .box,#fl-sos-sheet .box{background:#0b1c33;color:#fff;border:2px solid #c0161b;border-radius:18px;max-width:420px;width:100%;padding:20px;text-align:center}" +
        "#fl-sos-ask h2,#fl-sos-sheet h2{color:#ff6b6b;margin:0 0 10px;font-size:24px}" +
        "#fl-sos-ask p,#fl-sos-sheet p{color:#fff;font-size:16px}" +
        "#fl-sos-sheet pre{white-space:pre-wrap;text-align:left;background:#071426;border-radius:12px;padding:10px;font:700 16px/1.35 system-ui,sans-serif;color:#fff}" +
        "#fl-sos-ask .row,#fl-sos-sheet .row{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}" +
        "#fl-sos-ask .row a,#fl-sos-ask .row button,#fl-sos-sheet .row a,#fl-sos-sheet .row button{flex:1;min-width:110px;min-height:48px;padding:12px 8px;border:0;border-radius:12px;font-size:18px;font-weight:800;color:#fff;text-decoration:none;cursor:pointer}" +
        "#fl-sos-ask .yes,#fl-sos-sheet .yes{background:#2e9d4f}#fl-sos-ask .no,#fl-sos-sheet .no{background:#8a2323}#fl-sos-sheet .call{background:#c0161b}#fl-sos-sheet .ghost{background:#345}";
      document.head.appendChild(st);
    }
    var b = document.createElement("button");
    b.type = "button";
    b.id = "fl-sos-btn";
    b.setAttribute("aria-label", "SOS — request police help");
    b.textContent = "SOS";
    b.addEventListener("click", function (ev) { try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {} openFlSosAsk(); });
    (document.querySelector(".phone") || document.body || document.documentElement).appendChild(b);
  }
  function openFlSosAsk() {
    if ($("fl-sos-ask") || $("fl-sos-sheet")) return;
    ensureFlSos();
    var el = document.createElement("div");
    el.id = "fl-sos-ask";
    el.innerHTML = '<div class="box" role="dialog" aria-modal="true"><h2>SOS</h2>' +
      "<p>Request police help? We will show the 911 dialer link and your driver's name, car, plate, and live location for the operator. This app cannot call 911 by itself.</p>" +
      '<div class="row"><button type="button" class="yes" id="fl-sos-yes">Yes</button><button type="button" class="no" id="fl-sos-no">No</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.id) return;
      if (t.id === "fl-sos-no") { if (el.parentNode) el.parentNode.removeChild(el); return; }
      if (t.id !== "fl-sos-yes") return;
      if (el.parentNode) el.parentNode.removeChild(el);
      openFlSosSheet();
    });
  }
  function openFlSosSheet() {
    if ($("fl-sos-sheet")) return;
    var d = S.d || {}, text = sosReadout(d), loc = sosPoint(d);
    var el = document.createElement("div");
    el.id = "fl-sos-sheet";
    el.innerHTML = '<div class="box" role="dialog" aria-modal="true"><h2>Police assistance</h2>' +
      "<p>Tap Call 911 to open the dialer. Read this to the operator. This app cannot call 911 by itself.</p>" +
      '<pre id="fl-sos-read">' + esc(text) + "</pre>" +
      '<div class="row"><a class="call" id="fl-sos-911" href="tel:911">Call 911</a>' +
      (loc ? '<button type="button" class="ghost" id="fl-sos-copy">Copy</button>' +
      '<a class="yes" id="fl-sos-maps" href="' + esc(sosMapsHref(loc.lat, loc.lng)) + '">Open in Maps</a>' : "") +
      '<button type="button" class="no" id="fl-sos-close">Close</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.id) return;
      if (t.id === "fl-sos-close") { if (el.parentNode) el.parentNode.removeChild(el); return; }
      if (t.id !== "fl-sos-copy") return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { t.textContent = "Copied"; }).catch(function () { t.textContent = "Copied"; });
        else t.textContent = "Copied";
      } catch (e) { t.textContent = "Copied"; }
    });
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
  function photoSrc(k) { /* pure (tested): only a 24-char card key, only our Worker */
    return /^[A-Za-z0-9_-]{24}$/.test(String(k || "")) ? "https://pcs-pay.pcsrides.workers.dev/dcard/" + k + "-p.jpg" : "";
  }
  function profileJpeg(d) {
    var p = d && typeof d.photo === "string" ? d.photo : "";
    return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) && p.length <= 120000 ? p : "";
  }
  function trackerPhotoSrc(d) { /* card jpeg first; the profile jpeg is only the standby. No other addresses. */
    d = d || {};
    return photoSrc(d.cardKey) || profileJpeg(d);
  }
  function applyTrackerPhoto(ph, d) {
    if (!ph) return "";
    var card = photoSrc(d && d.cardKey), jpeg = profileJpeg(d);
    if (ph.__card !== card) { ph.__card = card; ph.__cardFailed = false; }
    var src = card && !ph.__cardFailed ? card : jpeg;
    if (ph.__s === src) return src;
    ph.__s = src;
    if (!src) { ph.src = ""; ph.hidden = true; return ""; }
    ph.onerror = function () {
      if (src === card && jpeg && !ph.__cardFailed) {
        ph.__cardFailed = true; ph.__s = jpeg;
        ph.onerror = function () { ph.hidden = true; };
        ph.src = jpeg; ph.hidden = false;
        return;
      }
      ph.hidden = true;
    };
    ph.src = src; ph.hidden = false;
    return src;
  }
  function carText(c) {
    if (!c || typeof c !== "object") return "";
    return [txt(c.color, 20), txt(c.year, 4), txt(c.make, 30), txt(c.model, 30)].filter(Boolean).join(" ");
  }
  function shell() {
    style();
    app.innerHTML = '<div class="card" id="fl-live"><p class="fl-status" id="fl-status" role="status" aria-live="polite"></p>' +
      '<div class="fl-under" id="fl-under"><div class="fl-under-main">' +
      '<div class="fl-drv" id="fl-drv"><div class="fl-drv-t"><p class="fl-who" id="fl-who"></p><p class="fl-car" id="fl-car"></p></div></div></div>' +
      '<div class="fl-rate-col" id="fl-rate-col"><img class="fl-photo" id="fl-photo" alt="Your PCS driver" hidden width="64" height="64"><p class="fl-stars" id="fl-stars" hidden></p></div></div>' +
      '<div class="fl-big" id="fl-big" hidden><div class="fl-spd" id="fl-spd"><b id="fl-mph">--</b><span id="fl-mph-l">mph</span><small id="fl-mph-n"></small></div>' +
      '<div class="fl-arr" id="fl-arr"><span class="k" id="fl-arr-k"></span><b id="fl-arr-t"></b><span id="fl-arr-m"></span><small id="fl-arr-to"></small></div></div>' +
      '<p class="fl-eta" id="fl-eta"></p>' +
      '<div id="fl-map" role="img" aria-label="Map with the car, the pickup and the drop-off"></div>' +
      '<p class="fl-row" id="fl-from"></p><div id="fl-stops"></div><p class="fl-row" id="fl-to"></p>' +
      '<p class="fl-upd" id="fl-upd"></p><p class="error" id="fl-net" role="status"></p>' +
      /* Bottom bar: a known invoice. With no invoice number the bar stays hidden. Shared copies replace this with the shared-by line. */
      '<p class="fl-call" id="fl-call" hidden></p></div>' +
      /* bz3: Share my ride is a text link just below the card, so the pinned invoice bar can never cover it */
      '<button type="button" class="fl-share" id="fl-share" hidden>Share my ride</button>' +
      '<p class="fl-share-note" id="fl-share-note" hidden></p>';
    if (window.L) {
      S.map = window.L.map("fl-map", { zoomControl: true, attributionControl: true, zoomSnap: 0.25, zoomDelta: 1 }).setView([29.76, -95.37], 11);
      /* v76g / v2.0m-bz2: the viewer touched the map (drag, pinch, wheel, the +/- buttons): auto-zoom waits 25 s, then picks up again */
      var mapEl = $("fl-map"), touched = function () { S.userUntil = Date.now() + USER_PAUSE_MS; };
      ["touchstart", "pointerdown", "mousedown", "wheel"].forEach(function (ev) { try { mapEl.addEventListener(ev, touched, { passive: true }); } catch (e) {} });
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { referrerPolicy: "strict-origin-when-cross-origin", maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(S.map);
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
    var sl = stopsOf(d);
    sl.forEach(function (s, i) { /* v76g: numbered stop pins, in driving order */
      if (!s.p) return;
      pts.push(s.p);
      L.marker(s.p, { icon: L.divIcon({ className: "fl-stopico" + (s.done ? " done" : ""), iconSize: [32, 32], iconAnchor: [16, 16], html: "<div>" + (i + 1) + "</div>" }), keyboard: false, zIndexOffset: 500 })
        .bindTooltip("Stop " + (sl.length > 1 ? (i + 1) + " " : "") + (s.done ? "(visited)" : "")).addTo(S.layers);
    });
    dot(d.dest, "#c0392b", "Drop-off");
    var car = showCar ? pt(d.pos) : null;
    if (car) pts.push(car);
    carMove(car);
    var key = (d.status || "") + (car ? "c" : ""), now = Date.now();
    var sz = S.map.getSize(), szKey = sz ? sz.x + "x" + sz.y : "";
    var refit = S.fitted && S.lastKey === key && now < (S.overviewUntil || 0) && S.fitSize !== szKey && now >= (S.userUntil || 0); /* the map settled to its real size */
    var liveFit = d.status === "on_way" || d.status === "arrived" || d.status === "picked_up";
    if (!S.fitted || S.lastKey !== key || refit) { /* first look (and each new phase) */
      if (!refit) S.overviewUntil = now + OVERVIEW_MS;
      S.fitted = true; S.lastKey = key; S.autoAt = now; S.fitSize = szKey;
      if (liveFit) fitTo(car, nextTarget(d, sl));
      else {
        var all = pts.concat(route);
        if (pts.length === 1 && route.length < 2) S.map.setView(pts[0], 15); else if (all.length) S.map.fitBounds(all, { padding: [36, 36], maxZoom: 16 });
      }
      return;
    }
    autoZoom(car, nextTarget(d, sl), now);
  }
  /* v76g: the stops in the copy (up to 5): map point when known, address, visited flag. */
  function stopsOf(d) {
    var out = [];
    if (d && Array.isArray(d.stops)) d.stops.slice(0, 5).forEach(function (s) {
      if (!s || typeof s !== "object") return;
      var p = pt(s), l = txt(s.label, 120);
      if (p || l) out.push({ p: p, label: l, done: s.done === true });
    });
    return out;
  }
  /* where the car is heading now: the pickup, else the next stop it has not reached, else the drop-off */
  function nextTarget(d, sl) {
    if (d.status === "on_way" || d.status === "arrived") return pt(d.pickup);
    if (d.status !== "picked_up") return null;
    for (var i = 0; i < sl.length; i += 1) if (!sl[i].done && sl[i].p) return sl[i].p;
    return pt(d.dest);
  }
  /* v76g / v2.0m-bz2 auto-zoom: fit the car + its next target with padding. It moves the map only when the right zoom is 3/4 of a
     level away or a point is off screen, at most every 2.5 s, so it does not jitter; it waits 25 s after a touch.
     Before pickup the target is the pickup only; after pickup, the drop-off (or the next stop). No target (no coordinates):
     follow the car at street zoom. Never fit the drop-off while still heading to the pickup. */
  var OVERVIEW_MS = 5000, USER_PAUSE_MS = 25000, AUTO_EVERY_MS = 2500, AUTO_MAX_Z = 17, AUTO_PAD = 56, STREET_Z = 16;
  function fitTo(car, tg) {
    var m = S.map, L = window.L; if (!m) return;
    if (car && tg) m.fitBounds(L.latLngBounds([car, tg]), { padding: [AUTO_PAD, AUTO_PAD], maxZoom: AUTO_MAX_Z });
    else if (car) m.setView(car, STREET_Z);
    else if (tg) m.setView(tg, STREET_Z);
  }
  function autoZoom(car, tg, now) {
    var m = S.map; if (!m || !car) return;
    if (now < (S.userUntil || 0)) return; /* the viewer is looking around */
    if (!tg) {
      if (now < (S.overviewUntil || 0)) return;
      var cz0 = m.getZoom ? m.getZoom() : 0;
      if (!cz0 || cz0 < STREET_Z - 1) { S.autoAt = now; m.setView(car, STREET_Z); return; }
      if (!m.getBounds().pad(-0.15).contains(car)) m.panTo(car);
      return;
    }
    if (now < (S.overviewUntil || 0) || now - (S.autoAt || 0) < AUTO_EVERY_MS) return;
    var L = window.L, b = L.latLngBounds([car, tg]), sz = m.getSize();
    if (!sz || sz.x < 50 || sz.y < 50) return;
    var z = Math.min(AUTO_MAX_Z, m.getBoundsZoom(b, false, L.point(AUTO_PAD * 2, AUTO_PAD * 2))), cz = m.getZoom();
    var inner = m.getBounds().pad(-0.08), off = !inner.contains(car) || !inner.contains(tg);
    if (!off && Math.abs(z - cz) < 0.75) return;
    if (!off && z < cz) return; /* both still on screen: only ever zoom IN by itself */
    S.autoAt = now; S.autoZ = z;
    m.fitBounds(b, { padding: [AUTO_PAD, AUTO_PAD], maxZoom: AUTO_MAX_Z, animate: true, duration: 0.8 });
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
    if (!S.loop) { S.loop = 1; S.gen = (S.gen || 0) + 1; S.lastFrame = Date.now(); var g = S.gen; (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { frame(g); }); } /* v2.0k r2: one generation per loop */
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
  function frame(g) {
    if (g !== S.gen) return; /* v2.0k r2 (Harry): a stale loop from before a re-init exits */
    if (!S.car || S.ended) { S.loop = 0; return; }
    var now = Date.now(), dt = Math.min(200, now - (S.lastFrame || now)); S.lastFrame = now;
    var k = 1 - Math.exp(-dt / 250), tg = target(now), at = S.carAt || tg;
    if (tg) {
      if (hav(at, tg) > 0.3) at = tg; /* big jump (GPS reset / page woke up): snap */
      else at = [at[0] + (tg[0] - at[0]) * k, at[1] + (tg[1] - at[1]) * k];
    }
    if (S.brg !== null) { var dd = ((S.brg - S.carDeg + 540) % 360) - 180; S.carDeg = Math.abs(dd) < 0.5 ? S.brg : (S.carDeg + dd * k + 360) % 360; }
    S.carAt = at; carPaint(at, S.carDeg);
    if (S.spdLive && !S.paused && S.mph !== null) { /* speed number glides too */
      S.mphShown = S.mphShown == null ? S.mph : S.mphShown + (S.mph - S.mphShown) * k;
      var m = Math.round(S.mphShown); setText("fl-mph", m < 2 ? "0" : String(m)); setText("fl-mph-l", m < 2 ? "mph \u00b7 Stopped" : "mph");
    }
    (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { frame(g); });
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
  function dest0(d) { return d && d.status === "picked_up"; }
  function placeName(o) { var l = o && typeof o === "object" ? txt(o.label, 120) : ""; return l.split(",")[0].trim(); }
  /* v2.0m-p (Matthew 11/1): when the driver opens Apple Maps the iPhone pauses the web driver app's GPS. After 20 s with no
     fresh point: keep the car at its last spot, hide the speed (never "0 mph Stopped"), say the driver is navigating, and
     estimate the arrival: the driver's last shared route ETA (from when it was sent), or straight-line at 35 mph from the
     last spot to the pickup / drop-off. Labeled "about". Fresh points bring the normal view back. */
  var PAUSE_MS = 20000, FALLBACK_MPH = 35;
  function staleEta(d, now) {
    var e = d && d.eta, to = e && (e.to === "dest" || e.to === "pickup") ? e.to : (d && d.status === "picked_up" ? "dest" : "pickup");
    var eAt = num(d && d.etaAt) || num(d && d.updatedAt), arr = null, miles = null, how = "";
    if (e && num(e.min) !== null && eAt && (e.to === to || !e.to)) { arr = eAt + Math.max(0, num(e.min)) * 60000; miles = num(e.miles); how = "route"; }
    if (arr === null || arr < now + 60000) {
      var car = pt(d && d.pos), tg = pt(to === "dest" ? d && d.dest : d && d.pickup);
      if (car && tg) { miles = hav(car, tg); var a2 = now + (miles / FALLBACK_MPH) * 3600000; if (arr === null || a2 > arr) { arr = a2; how = "line"; } }
    }
    if (arr === null) return null;
    if (arr < now + 60000) arr = now + 60000;
    return { to: to, arr: arr, min: Math.max(1, Math.round((arr - now) / 60000)), miles: miles, how: how };
  }
  if (typeof window !== "undefined") window.__pcsFollowStaleEta = staleEta;
  function bigBox(d, now, live) {
    var big = $("fl-big"); if (!big) return;
    var pAt = d.pos && num(d.pos.at), fresh = live && pAt && now - pAt <= 60000;
    var e = d.eta, eAt = num(d.etaAt) || num(d.updatedAt) || now;
    var etaOk = live && e && num(e.min) !== null && num(e.miles) !== null && now - eAt <= 180000;
    big.hidden = !live;
    if (!live) return;
    var paused = !!(pAt && now - pAt > PAUSE_MS); S.paused = paused;
    S.spdLive = !!(fresh && !paused && S.mph !== null); if (!S.spdLive) S.mphShown = null;
    if (paused) {
      setText("fl-mph", ""); setText("fl-mph-l", "Your driver is navigating."); setText("fl-mph-n", "Location updates shortly.");
      var se = staleEta(d, now), sd = se ? se.to === "dest" : !!dest0(d), st = "";
      setText("fl-arr-k", sd ? "Arriving at the drop-off" : "Arriving at the pickup");
      if (se) { try { st = ctTime(se.arr); } catch (x) {} }
      setText("fl-arr-t", se && st ? "about " + st : "Updating\u2026");
      setText("fl-arr-m", se ? (soonFired(sd ? "dest" : "pickup") && legOf(d) ? "Arriving shortly" : "about " + se.min + " min") + (se.miles !== null ? " \u00b7 " + Math.max(0, se.miles).toFixed(1) + " mi" : "") : "");
      setText("fl-arr-to", sd ? placeName(d.dest) : placeName(d.pickup));
      return;
    }
    if (fresh && S.mph !== null) { var m = Math.round(S.mphShown != null ? S.mphShown : S.mph); setText("fl-mph", m < 2 ? "0" : String(m)); setText("fl-mph-l", m < 2 ? "mph \u00b7 Stopped" : "mph"); setText("fl-mph-n", "Live speed"); }
    else { setText("fl-mph", "--"); setText("fl-mph-l", "mph"); setText("fl-mph-n", pAt ? "Last updated " + Math.max(1, Math.round((now - pAt) / 60000)) + " min ago" : "Waiting for the car"); }
    var dest = e && e.to === "dest";
    var nm = dest ? placeName(d.dest) : placeName(d.pickup);
    setText("fl-arr-k", dest ? "Arriving at the drop-off" : "Arriving at the pickup");
    if (etaOk) {
      var arr = eAt + Math.max(0, num(e.min)) * 60000, left = Math.max(1, Math.round((arr - now) / 60000)), t = "";
      if (arr < now) arr = now + 60000;
      try { t = ctTime(arr); } catch (x) {}
      setText("fl-arr-t", "about " + t);
      setText("fl-arr-m", (soonFired(dest ? "dest" : "pickup") && legOf(d) ? "Arriving shortly" : left + " min") + " \u00b7 " + Math.max(0, num(e.miles)).toFixed(1) + " mi");
    } else { setText("fl-arr-t", "Updating\u2026"); setText("fl-arr-m", soonFired(dest ? "dest" : "pickup") && legOf(d) ? "Arriving shortly" : ""); }
    setText("fl-arr-to", nm);
  }
  /* v2.0l item 7 (customer report 10/26): times are the ride's time (Central, the driver's zone), never the phone's zone, with "CT". */
  function ctTime(ms) { try { return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CT"; } catch (x) { return ""; } }
  if (typeof window !== "undefined") window.__pcsFollowCtTime = ctTime;
  function squareHttps(v) {
    var s = String(v || "").trim();
    if (!s || s.length > 300 || /[\s<>"']/.test(s)) return "";
    var m = /^https:\/\/([^\/?#:]+)(?:[\/?#]|$)/i.exec(s);
    if (!m || !/(^|\.)squareup(sandbox)?\.com$|(^|\.)square\.link$/i.test(m[1])) return "";
    return s;
  }
  /* v2.0m-by (Matthew 11/15): a linked ride (one tracker, two riders, two invoices) shows each invoice number with paid or
     unpaid beside it and nothing else: no bill, no receipt, no pay link, even if the copy held one. v2.0m-by2: same plain
     words as the normal bar ("Invoice #000600 – paid"), one line each, two at most. Pure (tested). */
  function tripLabel(n, of) { /* pure (tested): only when an invoice has more than one non-cancelled trip */
    n = Math.round(+n); of = Math.round(+of);
    return of > 1 && n >= 1 && n <= of ? "Trip " + n + " of " + of : "";
  }
  function barJoin(parts) { /* pure (tested): never a leading, trailing, or doubled mid-dot */
    var out = [];
    (parts || []).forEach(function (p) {
      p = String(p == null ? "" : p).replace(/^[\s\u00b7]+|[\s\u00b7]+$/g, "").trim();
      if (p) out.push(p);
    });
    return out.join(" \u00b7 ");
  }
  function ratingStarsModel(avg) { /* pure (tested): nearest whole number of filled stars, dimmed empties to five, average to two decimals, no count. Hidden when there is no average. */
    var a = Number(avg);
    if (!isFinite(a) || a < 1 || a > 5) return null;
    var n = Math.round(a);
    if (n < 0) n = 0; if (n > 5) n = 5;
    var star = "\u2B50\uFE0F";
    return { filled: n, empty: 5 - n, label: a.toFixed(2), text: star.repeat(n) + "\u2606".repeat(5 - n) + "(" + a.toFixed(2) + ")" };
  }
  function ratingStarsHtml(avg) {
    var m = ratingStarsModel(avg); if (!m) return "";
    var star = "\u2B50\uFE0F", i, h = "";
    for (i = 0; i < m.filled; i += 1) h += star;
    for (i = 0; i < m.empty; i += 1) h += '<span class="fl-star-empty" aria-hidden="true">' + star + "</span>";
    h += "(" + m.label + ")";
    return h;
  }
  function shareByText(d) {
    var name = txt(d && d.sharedBy, 31);
    return name ? "This ride was shared by " + name : "This ride was shared by a PCS rider";
  }
  function shareLinkOf(shareT) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(String(shareT || ""))) return "";
    try { return new URL("?t=" + shareT, window.location.href).href; } catch (e) { return ""; }
  }
  function billBarHtml(m) { /* painted bar: the mid-dot before a receipt/pay link stays with the link, so it does not dangle when the link wraps */
    if (!m || !m.show) return "";
    if (m.rows) return m.rows.map(function (r) { return '<span style="display:block;line-height:30px">' + esc(r.text) + "</span>"; }).join("");
    if (!m.link) return esc(m.label || "");
    var a = "<a id=\"" + esc(m.link.id) + "\" href=\"" + esc(m.link.href) + "\" target=\"_blank\" rel=\"noopener\">" + esc(m.link.text) + "</a>";
    if (!m.label) return a;
    return esc(m.label) + ' <span class="fl-bill-link">\u00b7 ' + a + "</span>";
  }
  function linkedModel(d) {
    var out = [], seen = {};
    (Array.isArray(d && d.linked) ? d.linked : []).slice(0, 2).forEach(function (x) {
      var no = x && typeof x === "object" ? String(x.invoiceNo || "").replace(/^#/, "").replace(/\s+/g, "") : "";
      if (!/^\d{1,20}$/.test(no) || seen[no]) return;
      seen[no] = 1;
      var text = barJoin(["Invoice #" + no + " \u2013 " + (x.pay === "paid" ? "paid" : "unpaid"), tripLabel(x.tripN, x.tripOf)]);
      out.push({ invoiceNo: no, pay: x.pay === "paid" ? "paid" : "unpaid", text: text });
    });
    return out;
  }
  function billBarModel(d) {
    d = d || {};
    if (d.shared === true) return { label: shareByText(d), link: null, show: true, gap: "shared", rows: null, shared: true };
    if (Array.isArray(d.linked)) {
      var rows = linkedModel(d);
      return { label: barJoin(rows.map(function (r) { return r.text; })), link: null, show: rows.length > 0, gap: "linked", rows: rows };
    }
    var no = String(d.invoiceNo || "").replace(/^#/, "").replace(/\s+/g, "");
    if (!/^\d{1,20}$/.test(no)) no = "";
    var pay = d.pay === "paid" || d.pay === "unpaid" ? d.pay : "";
    var receipt = squareHttps(d.receiptUrl), payUrl = squareHttps(d.payUrl);
    /* A known invoice number is enough to show the bar. A Square link is added only with a confirmed paid or unpaid word. Missing URLs and the old gap names never hide that number. */
    var link = null;
    if (no && pay === "paid" && receipt) link = { href: receipt, text: "View receipt", id: "fl-receipt" };
    else if (no && pay === "unpaid" && payUrl) link = { href: payUrl, text: "Pay invoice", id: "fl-pay" };
    if (no) {
      var lab = tripLabel(d.tripN, d.tripOf);
      var label = barJoin(["Invoice #" + no + (link ? (pay === "paid" ? " \u2013 paid" : " \u2013 unpaid") : ""), lab]);
      return { label: label, link: link, show: true, gap: link ? "" : "number-only", trip: lab };
    }
    var gap = "";
    if (pay === "paid" && !receipt) gap = "paid-without-receipt";
    else if (pay === "unpaid" && !payUrl) gap = "unpaid-without-pay-url";
    else if (d.bill === "invoiced" || d.bill === "prepaid") gap = "no-verified-payment";
    return { label: "", link: null, show: false, gap: gap };
  }
  function paintBill(d) {
    var el = $("fl-call"); if (!el) return;
    if (d && d.shared === true) {
      var text = shareByText(d);
      if (el.innerHTML !== esc(text)) { el.textContent = text; }
      el.hidden = false;
      var live = $("fl-live");
      if (live && live.classList) live.classList.remove("fl-has-bill");
      return;
    }
    var m = billBarModel(d);
    var live = $("fl-live");
    function mark(on) {
      if (!live || !live.classList) return;
      var had = live.classList.contains("fl-has-bill");
      if (on) live.classList.add("fl-has-bill"); else live.classList.remove("fl-has-bill");
      if (had !== on && S.map) { try { S.map.invalidateSize(); } catch (e) {} }
    }
    if (live && live.style && live.style.setProperty) { /* v2.0m-by: room above the taller linked bar (one line per invoice) */
      if (m.rows && m.show) live.style.setProperty("padding-bottom", (20 + 30 * m.rows.length) + "px", "important");
      else if (live.style.getPropertyValue && live.style.getPropertyValue("padding-bottom")) live.style.removeProperty("padding-bottom");
    }
    if (!m.show) { el.hidden = true; if (el.textContent) el.textContent = ""; mark(false); return; }
    var html = billBarHtml(m);
    if (m.rows || m.link) { if (el.innerHTML !== html) el.innerHTML = html; }
    else if (el.textContent !== m.label || (el.querySelector && el.querySelector("a"))) el.textContent = m.label;
    el.hidden = false;
    mark(true);
  }
  function ensureStarsEl() {
    var el = $("fl-stars"); if (el) return el;
    if (typeof document === "undefined" || !document.createElement) return null;
    try {
      el = document.createElement("p"); el.id = "fl-stars"; el.className = "fl-stars"; el.hidden = true;
      var photo = $("fl-photo"), col = $("fl-rate-col"), who = $("fl-who");
      if (col && typeof col.appendChild === "function") col.appendChild(el);
      else if (photo && photo.parentNode && typeof photo.parentNode.insertBefore === "function") photo.parentNode.insertBefore(el, photo.nextSibling);
      else if (who && who.parentNode && typeof who.parentNode.insertBefore === "function") who.parentNode.insertBefore(el, who.nextSibling);
      else return null;
      return el;
    } catch (e) { return $("fl-stars"); }
  }
  function paintStars(d) {
    var el = ensureStarsEl(); if (!el) return;
    var html = ratingStarsHtml(d && d.ratingAvg);
    if (!html) { el.hidden = true; if (el.innerHTML) el.innerHTML = ""; el.textContent = ""; return; }
    if (el.__h !== html) { el.innerHTML = html; el.__h = html; }
    el.hidden = false;
    el.setAttribute("aria-label", "Driver rating " + ratingStarsModel(d.ratingAvg).label + " out of 5");
  }
  function ensureShareBtn() {
    var btn = $("fl-share");
    if (btn) return btn;
    if (typeof document === "undefined" || !document.createElement) return null;
    try {
      btn = document.createElement("button"); btn.type = "button"; btn.id = "fl-share"; btn.className = "fl-share"; btn.hidden = true; btn.textContent = "Share my ride";
      var live = $("fl-live"), parent = live && live.parentNode; /* below the card, never inside it (the invoice bar is pinned inside) */
      if (parent && typeof parent.insertBefore === "function") parent.insertBefore(btn, live.nextSibling);
      else return null;
      if (typeof btn.addEventListener === "function") btn.addEventListener("click", onShareTap);
      return btn;
    } catch (e) { return $("fl-share"); }
  }
  function onShareTap() {
    var d = S.d, url = shareLinkOf(d && d.shareT); if (!url) return;
    var note = $("fl-share-note");
    function copied() { if (note) { note.hidden = false; note.textContent = "Link copied"; } }
    try {
      if (navigator.share) { navigator.share({ title: "PCS ride tracker", url: url }).catch(function () { copyShare(url, copied); }); return; }
    } catch (e) {}
    copyShare(url, copied);
  }
  function copyShare(url, done) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(done, done); return; }
    } catch (e) {}
    try { done(); } catch (e2) {}
  }
  function paintShare(d) {
    var btn = ensureShareBtn(); if (!btn) return;
    if (!btn.__bound) { try { btn.addEventListener("click", onShareTap); btn.__bound = true; } catch (e) {} }
    var note = $("fl-share-note");
    if (d && d.shared === true) { btn.hidden = true; if (note) { note.hidden = true; note.textContent = ""; } return; }
    var url = shareLinkOf(d && d.shareT);
    if (!url) { btn.hidden = true; if (note) note.hidden = true; return; }
    btn.hidden = false;
    btn.textContent = "Share my ride";
  }
  function update(d) {
    S.d = d;
    if (!$("fl-live")) shell();
    var now = Date.now();
    setText("fl-status", statusText(d));
    paintBill(d);
    var who = txt(d.driverFirst, 31);
    setText("fl-who", who ? "Your PCS driver: " + who : "Your PCS driver");
    var car = $("fl-car"), ct = carText(d.car), plate = d.car && typeof d.car === "object" ? txt(d.car.plate, 12) : "";
    var ch = (ct ? esc(ct) : "") + (plate ? ' <span class="fl-plate" aria-label="License plate">' + esc(plate) + "</span>" : "");
    if (car && car.__h !== ch) { car.innerHTML = ch; car.__h = ch; }
    applyTrackerPhoto($("fl-photo"), d);
    paintStars(d);
    paintShare(d);
    var live = d.status === "on_way" || d.status === "arrived" || d.status === "picked_up";
    var done = d.status === "completed" || d.status === "cancelled";
    var e = d.eta, etaOk = live && e && num(e.min) !== null && num(e.miles) !== null && (!num(d.etaAt) || now - num(d.etaAt) <= 180000);
    var at = "";
    if (etaOk) { try { at = ctTime(now + Math.max(0, num(e.min)) * 60000); } catch (x) {} }
    setText("fl-eta", $("fl-big") ? "" : etaOk ? "About " + Math.max(1, Math.round(num(e.min))) + " min \u00b7 " + Math.max(0, num(e.miles)).toFixed(1) + " mi to the " + (e.to === "dest" ? "drop-off" : "pickup") + (at ? " \u00b7 about " + at : "") : "");
    var pk = d.pickup && typeof d.pickup === "object" ? txt(d.pickup.label, 120) : "", dr = d.dest && typeof d.dest === "object" ? txt(d.dest.label, 120) : "";
    setText("fl-from", pk ? "From: " + pk : "");
    setText("fl-to", dr ? "To: " + dr : "");
    stopsList(d);
    var pAt = d.pos && num(d.pos.at), age = pAt ? Math.round((now - pAt) / 1000) : -1;
    var showCar = (live || d.status === "completed") && !!pt(d.pos);
    setText("fl-upd", !live ? (done ? "The car stopped sharing its location at the end of the ride." : "The car shows on the map once your driver heads out.")
      : age < 0 ? "Waiting for the first update from the car\u2026" : age <= 20 ? "Live \u00b7 updated just now" : age < 600 ? "Your driver is navigating. Location updates shortly." : "Last update " + (age < 60 ? age + " s" : Math.floor(age / 60) + " min") + " ago");
    track(d); soonCheck(d, now); bigBox(d, now, live);
    draw(d, showCar);
    try { postRide(d); } catch (e) {} /* v2.0m-bz */
  }
  function stopsList(d) { /* v76g: one line per stop between From and To, like the driver app */
    var box = $("fl-stops"); if (!box) return;
    var sl = stopsOf(d), h = sl.map(function (s, i) {
      return '<p class="fl-row fl-stop' + (s.done ? " done" : "") + '">' + "Stop" + (sl.length > 1 ? " " + (i + 1) : "") + ": " + esc(s.label || "On the map") + (s.done ? " \u2713" : "") + "</p>";
    }).join("");
    if (box.__h !== h) { box.innerHTML = h; box.__h = h; }
  }
  /* ---------- v76g (Matthew 10/18): "arriving shortly" pop-up ----------
     Pickup leg (on the way) and drop-off leg (on the ride). Fires when the shared ETA is 1 min or less, or (fallback) the
     ETA miles / the car's straight-line distance to the target is 0.25 mi or less. Once per leg per link: remembered in
     localStorage (sessionStorage if that is blocked) keyed by token + leg, so a reload or a jittery ETA never repeats it.
     Slides down across the top, over the map; tap closes it, it fades by itself after 15 s; the ETA box then keeps a
     small "Arriving shortly". A short vibration where the phone supports it (Android Chrome; iPhone Safari has none, so
     it is skipped). No sound. */
  var SOON_MIN = 1, SOON_MI = 0.25, SOON_SHOW_MS = 15000, SOON_KEY = "pcs-fl-soon-v1:";
  var SOON_TEXT = { pickup: "Your driver is arriving shortly", dest: "Arriving at drop-off shortly" };
  function legOf(d) { return d && d.status === "on_way" ? "pickup" : d && d.status === "picked_up" ? "dest" : ""; }
  function soonStore() { var w = window; try { if (w.localStorage) { w.localStorage.setItem(SOON_KEY + "t", "1"); w.localStorage.removeItem(SOON_KEY + "t"); return w.localStorage; } } catch (e) {}
    try { if (w.sessionStorage) return w.sessionStorage; } catch (e2) {} return null; }
  function soonFired(leg) {
    S.soon = S.soon || {};
    if (S.soon[leg]) return true;
    var st = soonStore(); try { if (st && st.getItem(SOON_KEY + token + ":" + leg)) { S.soon[leg] = true; return true; } } catch (e) {}
    return false;
  }
  function soonMark(leg) { S.soon = S.soon || {}; S.soon[leg] = true; var st = soonStore(); try { if (st) st.setItem(SOON_KEY + token + ":" + leg, String(Date.now())); } catch (e) {} }
  function soonDue(d, leg, now) {
    var e = d.eta, eAt = num(d.etaAt) || num(d.updatedAt) || now;
    if (e && typeof e === "object" && (e.to === "dest") === (leg === "dest") && now - eAt <= 180000) {
      var mn = num(e.min), mi = num(e.miles);
      if (mn !== null && mn - Math.max(0, now - eAt) / 60000 <= SOON_MIN) return true;
      if (mi !== null && mi <= SOON_MI) return true;
    }
    var car = pt(d.pos), pAt = d.pos && num(d.pos.at);
    if (!car || !pAt || now - pAt > 60000) return false;
    var tg = leg === "pickup" ? pt(d.pickup) : pt(d.dest);
    if (!tg) return false;
    if (leg === "dest" && stopsOf(d).some(function (s) { return !s.done && s.p; })) return false; /* a stop is still ahead: wait for the ETA */
    return hav(car, tg) <= SOON_MI;
  }
  function soonCheck(d, now) {
    var leg = legOf(d);
    if (!leg || soonFired(leg) || !soonDue(d, leg, now)) return;
    soonMark(leg); /* fired: stays fired for this leg */
    soonShow(leg);
  }
  function soonShow(leg) {
    style(); soonHide(true);
    var el = document.createElement("div");
    el.id = "fl-soon"; el.setAttribute("role", "alert"); el.setAttribute("aria-live", "assertive"); el.setAttribute("data-leg", leg);
    el.innerHTML = "<b>" + esc(SOON_TEXT[leg]) + "</b><small>Tap to close</small>";
    el.addEventListener("click", function () { soonHide(false); });
    document.body.appendChild(el);
    S.soonEl = el; S.soonShownAt = Date.now();
    void el.offsetHeight;
    el.className = "in";
    try { if (window.navigator && typeof window.navigator.vibrate === "function") window.navigator.vibrate([200, 100, 200]); } catch (e) {}
    clearTimeout(S.soonT); S.soonT = setTimeout(function () { soonHide(false); }, SOON_SHOW_MS);
  }
  function soonHide(now) {
    clearTimeout(S.soonT);
    var el = S.soonEl || $("fl-soon"); S.soonEl = null;
    if (!el) return;
    if (now) { if (el.parentNode) el.parentNode.removeChild(el); return; }
    el.className = ""; setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
  }
  function prLate(d, now) { /* v2.0m-ca pure (tested): completed, past the 30 min live view, still inside the 48 h after-ride window */
    if (!d || typeof d !== "object" || String(d.status || "") !== "completed") return false;
    var end = num(d.endedAt);
    return !!end && now - end > END_SHOW_MS && now - end <= PR_SHOW_MS;
  }
  function endNow(d, why, now) { /* v2.0m-ca: the ended page; on a completed ride inside 48 h the stars / tip / survey stay */
    var keep = prLate(d, now);
    if (keep) streamStop();
    message("Ride ended", why, true, keep);
    if (keep) { S.d = d; try { postRide(d); } catch (e) {} }
  }
  function over(d, now) {
    if (!d || typeof d !== "object") return "";
    var st = String(d.status || "");
    if (st === "stopped") return "Sharing for this ride was turned off.";
    if (st === "ended") return "This ride has ended. Thanks for following along with PCS.";
    var end = num(d.endedAt), upd = num(d.updatedAt), made = num(d.createdAt);
    /* v2.0m-bz-ls1 (Matthew 3:27 PM 11/19): a past ride's survey link from God mode (Worker /god/survey/reopen) stays open until
       lateUntil (at most 8 days ahead) so the client can still rate / tip / answer the survey. The Worker alone decides whether the
       stars / tip / survey show (its own KV record for this link); this only keeps the page from saying "ended". */
    var late = num(d.lateUntil);
    if (st === "completed" && d.shared !== true && late && late > now && late - now <= 8 * 86400000) return "";
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
    if (why) { streamStop(); endNow(d, why, now); return; }
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
    S.busy = true; /* v2.0k r2 (Harry): busy until this read has set its next timer; a hung read aborts after 10 s */
    var ac = typeof window.AbortController === "function" ? new window.AbortController() : null, abT = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, 10000) : 0;
    fetch(DB + "/rides/FLWSHARE/" + token + ".json", ac ? { cache: "no-store", signal: ac.signal } : { cache: "no-store" }).then(function (r) {
      if (r.status === 401 || r.status === 403) { var e = new Error("denied"); e.denied = true; throw e; }
      if (!r.ok) throw new Error("net");
      return r.json();
    }).then(function (d) {
      var now = Date.now();
      if (!d || typeof d !== "object") {
        S.misses += 1;
        if (S.misses >= 60) { message("Follow the ride", "This follow link isn\u2019t active. Ask for a new link, or call PCS.", true); return; }
        if (!$("fl-live")) message("Follow the ride", "Getting the ride ready\u2026");
        clearTimeout(S.timer); S.timer = setTimeout(poll, POLL_MS); return;
      }
      S.misses = 0;
      var why = over(d, now);
      if (why) { endNow(d, why, now); return; }
      S.d = d; S.raw = d; update(d);
      if ($("fl-net")) setText("fl-net", "");
      stream();
      clearTimeout(S.timer); S.timer = setTimeout(poll, POLL_MS);
    }).catch(function (e) {
      if (e && e.denied) { message("Follow the ride", "This follow link can\u2019t be opened right now. Please call PCS.", true); return; }
      if ($("fl-net")) setText("fl-net", "Signal dropped for a moment. This page catches up when you\u2019re back online.");
      else message("Follow the ride", "Loading the ride\u2026 trying again.");
      clearTimeout(S.timer); S.timer = setTimeout(poll, POLL_MS * 2);
    }).then(function () { clearTimeout(abT); S.busy = false; }, function () { clearTimeout(abT); S.busy = false; });
  }
  /* v2.0k: coming back to the page (app switch, Safari/Messages closed, iOS back-forward cache) must bring the map back.
     Before, only a poll was restarted, and only if no timer was pending (one nearly always was), so a map that iOS had
     left blank/0-size stayed blank, the dead live stream stayed dead, and nothing re-fit the view. */
  function resume() {
    if (document.visibilityState === "hidden" || S.ended) return;
    var el = $("fl-map");
    var blank = !el || !S.map || !el.querySelector(".leaflet-tile-pane") || el.clientWidth < 50 || el.clientHeight < 50 || !el.querySelector(".leaflet-tile-pane img");
    if (el && S.map && blank) { /* re-init: tear the old map down and let update() build a fresh shell + map */
      try { S.map.remove(); } catch (e) {}
      S.map = null; S.layers = null; S.car = null; S.loop = 0; S.gen = (S.gen || 0) + 1; /* r2: kills the old loop */
      var live = $("fl-live"); if (live && live.parentNode) live.parentNode.removeChild(live);
    } else if (S.map) { try { S.map.invalidateSize(false); } catch (e) {} }
    S.fitted = false; S.userUntil = 0; /* re-fit the route, then follow the car again */
    if (S.d) { try { update(S.d); } catch (e) {} }
    setTimeout(function () { try { if (S.map) S.map.invalidateSize(false); } catch (e) {} }, 300);
    if (S.es && !(S.streamAt && Date.now() - S.streamAt < 40000)) streamStop();
    S.noStream = false; S.sErr = 0; /* iOS kills the stream in the background: give it fresh tries */
    if (!S.busy) { clearTimeout(S.timer); S.timer = 0; poll(); } /* read now instead of waiting on a frozen timer */
  }
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", function (ev) { if (ev && ev.persisted) resume(); else if (S.map) try { S.map.invalidateSize(false); } catch (e) {} });
  window.addEventListener("focus", function () { try { if (S.map) S.map.invalidateSize(false); } catch (e) {} });
  (function qr() { var el = $("fw-qr"); if (!el || typeof window.qrcode !== "function") return; try { var x = window.qrcode(0, "M"); x.addData("https://www.PCSrides.com"); x.make(); el.innerHTML = x.createSvgTag(4, 0); } catch (e) {} })();
  setInterval(function () { if (S.d && !S.ended && $("fl-live")) { try { bigBox(S.d, Date.now(), /^(on_way|arrived|picked_up)$/.test(String(S.d.status))); } catch (e) {} } }, 15000);
  /* ---------- v2.0m-bz (Matthew 11/16): post-ride window ----------
     Once the top says "Ride completed": 1. Rate your driver (1-5 stars, tapping a star fills every star up to it, optional
     comment). 2. Tip (presets + Custom tip in $ or %; "Your driver keeps 100% of tips"; Square's page takes the payment; never on a
     linked / shared tracker, which stays money-free; on a linked run each account holder tips on their own holder link). 3. Optional survey (2 car, 2 driver, 1 ride tracker; one tap each on 1-10, 1 = Very unsatisfied, 10 = Very satisfied; comment; anonymous or name; website Yes / No).
     Everything goes to the PCS Worker with the link token only; nothing here writes to the database. Done / Not now is
     remembered per link on this phone. */
  var PR_WORKER = "https://pcs-pay.pcsrides.workers.dev", PR_KEY = "pcs-fl-post-v1:", PR_PCTS = [15, 18, 20], PR_PCT_MAX = 50000; /* Matthew 6:54 / 6:55: % of the pre-tax fare (car-service standard 15-20%). Presets cap at the $500 charge max; Custom stays $1-$100. */
  /* Matthew 11/16 (1:56 / 1:58 PM): each survey question is scored 1-10 (1 = Very unsatisfied, 10 = Very satisfied); no stars
     (stars are only the 1-5 driver rating). The Worker stores the ride grade = average of the answered items. */
  var PR_Q = [["car1", "How satisfied were you with the cleanliness of the car?"], ["car2", "How satisfied were you with the comfort of the car?"],
    ["drv1", "How satisfied were you with your driver's safe driving?"], ["drv2", "How satisfied were you with your driver's courtesy and professionalism?"],
    ["trk1", "How satisfied were you with the ride tracker?"]];
  var PR_SCALE_MAX = 10;
  function prLoad() { var st = soonStore(); try { var o = st && JSON.parse(st.getItem(PR_KEY + token) || "null"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function prSave(o) { var st = soonStore(); try { if (st) st.setItem(PR_KEY + token, JSON.stringify(o)); } catch (e) {} }
  /* pure (tested). Matthew 1:51 PM 11/16: on a linked run the shared tracker has no tip; an account holder's OWN holder link
     (the Worker answers own: true there) gets the tip step for their own invoice. */
  function prSteps(d, P) { return d && Array.isArray(d.linked) && !(P && P.own === true) ? ["stars", "survey"] : ["stars", "tip", "survey"]; }
  function prTipCents(s) { /* pure (tested): "12.5" -> 1250; $1 to $100 only */
    var t = String(s == null ? "" : s).replace(/[$,\s]/g, "");
    if (!/^\d{1,3}(\.\d{0,2})?$/.test(t)) return null;
    var c = Math.round(Number(t) * 100); return c >= 100 && c <= 10000 ? c : null;
  }
  function prPctTip(fare, pct) { return PR_PCTS.indexOf(pct) >= 0 && fare > 0 ? Math.round(fare * pct / 100) : 0; } /* pure (tested): nearest cent; the Worker does the same math */
  function prCustomPct(s) { /* pure (tested): "22" / "22.5" -> 22 / 22.5; 1-100, whole or one decimal */
    var t = String(s == null ? "" : s).replace(/[%\s]/g, "");
    if (!/^\d{1,3}(\.\d)?$/.test(t)) return null;
    var n = Number(t); return n >= 1 && n <= 100 ? n : null;
  }
  function prCustomPctCents(fare, pct) { /* pure (tested): dollars from the same pre-tax base; $1-$100 or null */
    if (!(fare > 0) || pct == null) return null;
    var c = Math.round(fare * pct / 100); return c >= 100 && c <= 10000 ? c : null;
  }
  function prCustomKind(P) { return (Number(P && P.fareCents) || 0) > 0 && P.customKind === "%" ? "%" : "$"; }
  function prCustomAmount(P) { /* cents for the Tip button / post; 0 if invalid */
    if (prCustomKind(P) === "%") { var pct = prCustomPct(P.customPct); return pct != null ? (prCustomPctCents(Number(P.fareCents) || 0, pct) || 0) : 0; }
    return prTipCents(P.custom) || 0;
  }
  function prPctList(fare, maxCents) { /* pure (tested): the % buttons, only with a known fare and a tip of $1+ up to the $500 charge max (not the $100 Custom cap); else Custom only */
    var max = Number(maxCents) > 0 ? Number(maxCents) : PR_PCT_MAX;
    return fare > 0 ? PR_PCTS.map(function (p) { return { pct: p, cents: prPctTip(fare, p) }; }).filter(function (x) { return x.cents >= 100 && x.cents <= max; }) : [];
  }
  function prMoney(c) { var v = c / 100; return "$" + (v % 1 ? v.toFixed(2) : String(v)); }
  function prPost(path, body) {
    return fetch(PR_WORKER + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ t: token }, body || {})) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j || j.ok === false) { var e = new Error((j && j.error) || "Try again."); e.status = r.status; throw e; } return j; }); });
  }
  function prStyle() {
    if ($("fl-pr-style")) return;
    var st = document.createElement("style"); st.id = "fl-pr-style";
    st.textContent = "#fl-pr{position:fixed;inset:0;z-index:3500;background:rgba(5,14,28,.94);display:flex;align-items:center;justify-content:center;padding:12px}" +
      "#fl-pr .box{background:#f0fdf4;color:#0b3d23;border:3px solid #2e9d4f;border-radius:16px;max-width:420px;width:100%;max-height:100%;overflow:auto;padding:14px;box-sizing:border-box}" +
      "#fl-pr .fl-status{margin:0 0 10px}#fl-pr p,#fl-pr label{color:#0b3d23;font-size:16px;font-weight:700;margin:8px 0 4px;display:block}" +
      "#fl-pr .stars{display:flex;justify-content:center;gap:4px}#fl-pr .stars.sm{justify-content:flex-start}" +
      "#fl-pr .stars button{background:none;border:0;padding:0 2px;font-size:44px;line-height:1;color:#b9c9bd;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
      "#fl-pr .stars.sm button{font-size:32px}#fl-pr .stars button.on{color:#d4b15a}" +
      "#fl-pr textarea,#fl-pr input[type=text]{width:100%;box-sizing:border-box;border:2px solid #2e9d4f;border-radius:10px;padding:8px;font-size:16px;color:#0b3d23;background:#fff}" +
      "#fl-pr textarea{height:60px;resize:none}" +
      "#fl-pr .seg{display:inline-flex;border:2px solid #2e9d4f;border-radius:10px;overflow:hidden;margin:8px 0 4px}" +
      "#fl-pr .seg button{background:#fff;border:0;min-width:52px;padding:8px 16px;font-size:18px;font-weight:800;color:#0b3d23;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
      "#fl-pr .seg button[aria-pressed=true]{background:#0b6b3a;color:#fff}" +
      "#fl-pr .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}#fl-pr .row button,#fl-pr .row a{flex:1;min-width:70px}" +
      "#fl-pr .fl-call{margin:8px 0 0;min-height:48px;line-height:48px;font-size:18px;cursor:pointer;width:100%;box-sizing:border-box}#fl-pr .row .fl-call{margin:0;line-height:1.2;padding:12px 4px;display:flex;align-items:center;justify-content:center}" +
      "#fl-pr .fl-call[aria-pressed=true]{background:#0b6b3a;color:#fff !important}#fl-pr .fl-call:disabled{opacity:.5}" +
      "#fl-pr .skip{background:none;border:0;color:#0b3d23;text-decoration:underline;font-size:16px;font-weight:800;display:block;margin:10px auto 0;cursor:pointer}" +
      "#fl-pr .error{color:#a61b1b;font-weight:800}" +
      "#fl-pr .scale{display:grid;grid-template-columns:repeat(10,1fr);gap:3px}" +
      "#fl-pr .scale button{background:#fff;border:2px solid #2e9d4f;border-radius:8px;padding:0;min-height:44px;font-size:17px;font-weight:900;color:#0b3d23;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
      "#fl-pr .scale-ends{display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#0b3d23;margin:3px 0 2px}" +
      "#fl-pr .scale button[aria-pressed=true]{background:#0b6b3a;border-color:#0b6b3a;color:#fff}" +
      "#fl-pr p.fl-pr-keeps{text-align:center;font-size:15px;font-weight:700;color:#0b6b3a;margin:-4px 0 6px}"; /* Matthew 1:51 PM 11/16 */
    document.head.appendChild(st);
  }
  function prStarsHtml(name, val, sm) {
    var h = '<div class="stars' + (sm ? " sm" : "") + '" role="group" data-q="' + name + '">';
    for (var i = 1; i <= 5; i += 1) h += '<button type="button" data-q="' + name + '" data-v="' + i + '" class="' + (val >= i ? "on" : "") + '" aria-label="' + i + " star" + (i > 1 ? "s" : "") + '" aria-pressed="' + (val === i ? "true" : "false") + '">\u2605</button>';
    return h + "</div>";
  }
  function prScaleHtml(name, val, label) { /* 1-10 tap buttons with the two end labels under them */
    var h = '<div class="scale" role="radiogroup" aria-labelledby="' + label + '" data-scale="' + name + '">';
    for (var i = 1; i <= PR_SCALE_MAX; i += 1) h += '<button type="button" data-q="' + name + '" data-v="' + i + '" role="radio" aria-label="' + i + (i === 1 ? " (Very unsatisfied)" : i === PR_SCALE_MAX ? " (Very satisfied)" : "") + '" aria-checked="' + (val === i ? "true" : "false") + '" aria-pressed="' + (val === i ? "true" : "false") + '">' + i + "</button>";
    return h + '</div><div class="scale-ends" aria-hidden="true"><span>1 = Very unsatisfied</span><span>10 = Very satisfied</span></div>';
  }
  function prHtml(P, d) {
    var err = P.err ? '<p class="error" role="alert">' + esc(P.err) + "</p>" : "", busy = P.busy ? " disabled" : "";
    if (P.step === "stars") return '<p class="fl-status">Rate your driver</p>' + prStarsHtml("stars", P.stars || 0) +
      '<label for="fl-pr-c">Comment (optional)</label><textarea id="fl-pr-c" maxlength="300">' + esc(P.comment || "") + "</textarea>" + err +
      '<button type="button" class="fl-call" id="fl-pr-send"' + (P.stars ? busy : " disabled") + ">Send</button>" +
      '<button type="button" class="skip" id="fl-pr-later">Not now</button>';
    if (P.step === "tip") {
      var pick = P.tip || "", pcts = prPctList(Number(P.fareCents) || 0), pp = /^p(\d+)$/.exec(pick), pc = pp ? pcts.filter(function (x) { return x.pct === Number(pp[1]); })[0] : null;
      var c = pick === "custom" ? prCustomAmount(P) : pc ? pc.cents : 0, kind = prCustomKind(P);
      var customIn = '<label for="fl-pr-tip">Custom tip</label>' +
        ((Number(P.fareCents) || 0) > 0 ? '<div class="seg" role="radiogroup" aria-label="Dollars or percent"><button type="button" data-kind="$" aria-pressed="' + (kind === "$" ? "true" : "false") + '">$</button><button type="button" data-kind="%" aria-pressed="' + (kind === "%" ? "true" : "false") + '">%</button></div>' : "") +
        '<input type="text" id="fl-pr-tip" inputmode="decimal" autocomplete="off" placeholder="' + (kind === "%" ? "0" : "0.00") + '" value="' + esc(kind === "%" ? (P.customPct || "") : (P.custom || "")) + '">';
      return '<p class="fl-status">Tip your driver</p><p class="fl-pr-keeps" id="fl-pr-keeps">Your driver keeps 100% of tips</p><div class="row" role="group" aria-label="Tip">' +
        pcts.map(function (x) { return '<button type="button" class="fl-call fl-pr-pct" data-tip="p' + x.pct + '" aria-pressed="' + ("p" + x.pct === pick ? "true" : "false") + '">' + x.pct + "% (" + esc(prMoney(x.cents)) + ")</button>"; }).join("") +
        '<button type="button" class="fl-call" data-tip="custom" aria-pressed="' + (pick === "custom" ? "true" : "false") + '">Custom tip</button></div>' +
        (pick === "custom" ? customIn : "") + err +
        (P.payUrl ? '<a class="fl-call" id="fl-pr-pay" href="' + esc(P.payUrl) + '" target="_blank" rel="noopener">Pay ' + esc(prMoney(P.payCents)) + " tip</a>" +
          '<button type="button" class="skip" id="fl-pr-next">Next</button>'
          : '<button type="button" class="fl-call" id="fl-pr-tipgo"' + (c ? busy : " disabled") + ">" + (c ? "Tip " + esc(prMoney(c)) : "Tip") + "</button>" +
          '<button type="button" class="skip" id="fl-pr-notip">No tip</button>');
    }
    if (P.step === "survey") {
      var S2 = P.sv || {};
      return '<p class="fl-status">Quick survey (optional)</p>' +
        PR_Q.map(function (q) { return '<p id="fl-pr-q-' + q[0] + '">' + esc(q[1]) + "</p>" + prScaleHtml(q[0], S2[q[0]] || 0, "fl-pr-q-" + q[0]); }).join("") +
        '<label for="fl-pr-sc">Comments (optional)</label><textarea id="fl-pr-sc" maxlength="300">' + esc(S2.comment || "") + "</textarea>" +
        '<div class="row" role="group" aria-label="Your name"><button type="button" class="fl-call" data-anon="1" aria-pressed="' + (S2.anon !== false ? "true" : "false") + '">Stay anonymous</button>' +
        '<button type="button" class="fl-call" data-anon="0" aria-pressed="' + (S2.anon === false ? "true" : "false") + '">Add my name</button></div>' +
        (S2.anon === false ? '<label for="fl-pr-name">Your name (shown as first name and last initial)</label><input type="text" id="fl-pr-name" maxlength="60" autocomplete="name" value="' + esc(S2.name || "") + '">' : "") +
        '<p id="fl-pr-webq">May we put your feedback on www.PCSrides.com?</p><div class="row" role="group" aria-label="Website"><button type="button" class="fl-call" data-web="1" aria-pressed="' + (S2.web === true ? "true" : "false") + '">Yes</button>' +
        '<button type="button" class="fl-call" data-web="0" aria-pressed="' + (S2.web === false ? "true" : "false") + '">No</button></div>' + err +
        '<button type="button" class="fl-call" id="fl-pr-svsend"' + busy + ">Send</button>" +
        '<button type="button" class="skip" id="fl-pr-svskip">Skip</button>';
    }
    return '<p class="fl-status">Thank you!</p>' + (P.tipPaid ? '<p style="text-align:center">Tip received: ' + esc(prMoney(P.tipPaid)) + "</p>" : "") +
      '<button type="button" class="fl-call" id="fl-pr-close">Close</button>';
  }
  function prNext(P, d) { var s = prSteps(d, P), i = s.indexOf(P.step); P.step = i >= 0 && i + 1 < s.length ? s[i + 1] : "done"; P.err = ""; P.busy = false; if (P.step === "done") prPost("/ride/post-status", { done: true }).catch(function () {}); }
  function prPaint() {
    var P = S.pr, d = S.d; if (!P) return;
    var el = $("fl-pr");
    if (!el) {
      prStyle(); el = document.createElement("div"); el.id = "fl-pr"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      el.innerHTML = '<div class="box" id="fl-pr-box"></div>'; document.body.appendChild(el);
      el.addEventListener("click", prClick); el.addEventListener("input", prInput);
    }
    if (P.step === "tip" && P.fareCents === undefined && !P.fareBusy) prFare();
    var box = $("fl-pr-box"), h = prHtml(P, d); if (box && box.__h !== h) { box.innerHTML = h; box.__h = h; }
    prSave({ step: P.step, tipOpen: P.tipOpen || 0, tipPaid: P.tipPaid || 0 });
  }
  function prInput(ev) {
    var t = ev.target, P = S.pr; if (!t || !P) return;
    if (t.id === "fl-pr-c") P.comment = t.value;
    else if (t.id === "fl-pr-sc") (P.sv = P.sv || {}).comment = t.value;
    else if (t.id === "fl-pr-name") (P.sv = P.sv || {}).name = t.value;
    else if (t.id === "fl-pr-tip") { if (prCustomKind(P) === "%") P.customPct = t.value; else P.custom = t.value; var b = $("fl-pr-tipgo"), c = prCustomAmount(P); if (b) { b.disabled = !c; b.textContent = c ? "Tip " + prMoney(c) : "Tip"; } }
  }
  function prClick(ev) {
    var t = ev.target, P = S.pr, d = S.d; if (!t || !P || P.busy) return;
    var q = t.getAttribute && t.getAttribute("data-q");
    if (q) { var v = Number(t.getAttribute("data-v")); if (q === "stars") P.stars = v; else (P.sv = P.sv || {})[q] = v; P.err = ""; prPaint(); return; }
    var kd = t.getAttribute && t.getAttribute("data-kind"); if (kd === "$" || kd === "%") { P.customKind = kd; P.payUrl = ""; P.err = ""; prPaint(); if ($("fl-pr-tip")) try { $("fl-pr-tip").focus(); } catch (e) {} return; }
    var tp = t.getAttribute && t.getAttribute("data-tip"); if (tp) { P.tip = tp; P.payUrl = ""; P.err = ""; prPaint(); if (tp === "custom" && $("fl-pr-tip")) try { $("fl-pr-tip").focus(); } catch (e) {} return; }
    var an = t.getAttribute && t.getAttribute("data-anon"); if (an) { (P.sv = P.sv || {}).anon = an === "1"; prPaint(); return; }
    var wb = t.getAttribute && t.getAttribute("data-web"); if (wb) { (P.sv = P.sv || {}).web = wb === "1"; P.err = ""; prPaint(); return; }
    var id = t.id;
    if (id === "fl-pr-later") { prNext(P, d); prPaint(); return; } /* Harry r1: Not now on the stars goes on to the tip (linked: the survey) */
    if (id === "fl-pr-close") { P.step = "done"; P.closed = true; prSave({ step: "done", tipOpen: P.tipOpen || 0, tipPaid: P.tipPaid || 0 }); prPost("/ride/post-status", { done: true }).catch(function () {}); var el = $("fl-pr"); if (el && el.parentNode) el.parentNode.removeChild(el); return; }
    if (id === "fl-pr-notip" || id === "fl-pr-next" || id === "fl-pr-svskip") { prNext(P, d); prPaint(); return; }
    if (id === "fl-pr-pay") { P.tipOpen = P.payCents; prSave({ step: P.step, tipOpen: P.tipOpen, tipPaid: P.tipPaid || 0 }); setTimeout(function () { prNext(P, d); prPaint(); }, 300); return; }
    if (id === "fl-pr-send") { if (!P.stars) return; P.busy = true; prPaint();
      prPost("/ride/rate", { stars: P.stars, comment: P.comment || "" }).then(function () { prNext(P, d); prPaint(); }, function (e) { P.busy = false; if (e.status === 409) { prNext(P, d); } else P.err = e.message; prPaint(); }); return; }
    if (id === "fl-pr-tipgo") { var pm = /^p(\d+)$/.exec(P.tip || ""), pct = P.tip === "custom" && prCustomKind(P) === "%" ? prCustomPct(P.customPct) : null, c = P.tip === "custom" ? prCustomAmount(P) : pm ? prPctTip(Number(P.fareCents) || 0, Number(pm[1])) : 0; if (!c) return; P.busy = true; prPaint();
      prPost("/ride/tip", pm ? { percent: Number(pm[1]) } : (pct != null ? { percent: pct } : { tipCents: c })).then(function (j) { P.busy = false; P.payUrl = String(j.url || ""); P.payCents = Number(j.tipCents) > 0 ? Number(j.tipCents) : c; /* the Worker's amount */ if (!/^https:\/\//.test(P.payUrl)) { P.payUrl = ""; P.err = "Try again."; } prPaint(); }, function (e) { P.busy = false; P.err = e.message; prPaint(); }); return; }
    if (id === "fl-pr-svsend") { var sv = P.sv || {}; if (sv.web !== true && sv.web !== false) { P.err = "Pick Yes or No for the website."; prPaint(); return; }
      var body = { comment: sv.comment || "", anon: sv.anon !== false, name: sv.anon === false ? sv.name || "" : "", web: sv.web };
      PR_Q.forEach(function (x) { if (sv[x[0]]) body[x[0]] = sv[x[0]]; });
      P.busy = true; prPaint();
      prPost("/ride/survey", body).then(function () { prNext(P, d); prPaint(); }, function (e) { P.busy = false; if (e.status === 409) prNext(P, d); else P.err = e.message; prPaint(); }); }
  }
  function prFare() { /* read-only: the ride's pre-tax fare from the Worker for the % buttons; unknown -> Custom tip only */
    var P = S.pr; if (!P) return; P.fareBusy = true;
    prPost("/ride/tip/status", {}).then(function (j) { P.fareCents = Number(j && j.fareCents) > 0 ? Math.round(Number(j.fareCents)) : 0; if (j && j.paid === true && P.tipOpen) P.tipPaid = P.tipOpen; if ($("fl-pr")) prPaint(); }, function () { P.fareCents = 0; if ($("fl-pr")) prPaint(); });
  }
  function prTipCheck() { /* Square's word only: "Tip received" shows after the Worker sees the payment */
    var P = S.pr; if (!P || !P.tipOpen || P.tipPaid || P.checking || (S.d && Array.isArray(S.d.linked) && P.own !== true)) return;
    P.checking = true;
    prPost("/ride/tip/status", {}).then(function (j) { P.checking = false; if (j && j.paid === true) { P.tipPaid = P.tipOpen; if ($("fl-pr")) prPaint(); else prSave({ step: P.step, tipOpen: P.tipOpen, tipPaid: P.tipPaid }); } }, function () { P.checking = false; });
  }
  function postRide(d) { /* only after the Worker says this invoice's last trip is done, and only on the account-holder tracker */
    if (d && d.shared === true) { S.pr = false; postRideEnd(); return; } /* v2.0m-bz3: shared copies have no rating / tip / survey */
    if (!d || d.status !== "completed" || (S.ended && !S.prKeep)) return; /* v2.0m-ca: S.prKeep = ended page inside the 48 h window */
    if (S.pr === false) { postRideEnd(); return; }
    if (S.pr) { prTipCheck(); if (!S.pr.closed) prPaint(); return; }
    if (S.prPending) return;
    S.prPending = true;
    prPost("/ride/post-status", {}).then(function (j) {
      S.prPending = false;
      if (!j || j.show !== true) { S.pr = false; postRideEnd(); return; }
      var o = prLoad();
      S.pr = { step: o.step && /^(stars|tip|survey|done)$/.test(o.step) ? o.step : "stars", tipOpen: Number(o.tipOpen) || 0, tipPaid: Number(o.tipPaid) || 0 };
      if (Number(j.fareCents) > 0) S.pr.fareCents = Math.round(Number(j.fareCents));
      if (j.tripOf) { S.pr.tripN = j.tripN; S.pr.tripOf = j.tripOf; }
      if (j.own === true) S.pr.own = true; /* a linked run's account holder on their own holder link */
      if (S.pr.step === "tip" && prSteps(d, S.pr).indexOf("tip") < 0) S.pr.step = "survey";
      if (S.pr.step === "done") { S.pr.closed = true; S.pr = false; postRideEnd(); return; }
      prTipCheck(); prPaint();
    }, function () { S.prPending = false; S.pr = false; postRideEnd(); });
  }
  function postRideEnd() { var el = $("fl-pr"); if (el && el.parentNode) el.parentNode.removeChild(el); }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState !== "hidden") { try { prTipCheck(); } catch (e) {} } });
  window.__pcsFollowLive = { resume: resume, setPath: setPath, update: update, track: track, state: S, over: over, statusText: statusText,
    stopsOf: stopsOf, nextTarget: nextTarget, soonDue: soonDue, soonText: SOON_TEXT, photo: trackerPhotoSrc, showPhoto: applyTrackerPhoto, bill: billBarModel, billHtml: function (d) { return billBarHtml(billBarModel(d)); }, barJoin: barJoin,
    sosText: sosReadout, notice: message, prLate: prLate, endNow: endNow, tripLabel: tripLabel, stars: ratingStarsModel, starsHtml: ratingStarsHtml, shareBy: shareByText, shareLink: shareLinkOf, postRide: { steps: prSteps, tipCents: prTipCents, pctTip: prPctTip, pctList: prPctList, customPct: prCustomPct, customPctCents: prCustomPctCents, customKind: prCustomKind, customAmount: prCustomAmount, html: prHtml, questions: PR_Q, next: prNext } };
  ensureFlSos();
  poll();
})();
