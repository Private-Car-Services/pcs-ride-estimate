/* Private Car Services starter. Preview only: no texts, no charges, no API key. */
(function () {
  var BUSINESS_PHONE = "936-261-7878";
  var BASE_CENTS = 1100;
  var PER_MILE_CENTS = 138;
  var TAX_RATE = 0.0825;

  var SAMPLE = {
    name: "Matthew",
    phone: "(936) 555-0148",
    pickupStreet: "502 W. Montgomery St",
    pickupCity: "Willis",
    pickupState: "TX",
    dropStreet: "3131 Canterbury Ln",
    dropCity: "Willis",
    dropState: "TX",
    time: "08:00"
  };

  var GEO = {
    pickup: { lat: 30.4234, lng: -95.4808 },
    dropoff: { lat: 30.455, lng: -95.451 },
    driver: { lat: 30.4, lng: -95.505 }
  };

  var BOUNDS = {
    minLat: 30.395,
    maxLat: 30.465,
    minLng: -95.515,
    maxLng: -95.44
  };

  var state = {
    mode: "customer",
    screen: "home",
    name: SAMPLE.name,
    phone: SAMPLE.phone,
    pickupStreet: SAMPLE.pickupStreet,
    pickupCity: SAMPLE.pickupCity,
    pickupState: SAMPLE.pickupState,
    dropStreet: SAMPLE.dropStreet,
    dropCity: SAMPLE.dropCity,
    dropState: SAMPLE.dropState,
    date: tomorrowISO(),
    time: SAMPLE.time,
    error: ""
  };

  var rafId = 0;
  var motionStart = 0;
  var liveMap = null;
  var carMarker = null;
  var tilesOk = false;
  var tileTimer = 0;

  var CAR_SVG =
    '<svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="30" fill="#0b1c33" stroke="#f0d48a" stroke-width="2"/>' +
    '<rect x="22" y="12" width="20" height="38" rx="9" fill="#f0d48a"/>' +
    '<rect x="25" y="18" width="14" height="10" rx="3" fill="#0b1c33"/>' +
    '<rect x="25" y="33" width="14" height="8" rx="2" fill="#14304f"/>' +
    '<rect x="17" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="42" y="22" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="17" y="36" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    '<rect x="42" y="36" width="5" height="8" rx="1.5" fill="#c6a04a"/>' +
    "</svg>";

  function tomorrowISO() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    var z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function money(cents) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function haversine(a, b) {
    var R = 3958.7613;
    var p1 = (a.lat * Math.PI) / 180;
    var p2 = (b.lat * Math.PI) / 180;
    var dPhi = ((b.lat - a.lat) * Math.PI) / 180;
    var dL = ((b.lng - a.lng) * Math.PI) / 180;
    var h = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dL / 2) * Math.sin(dL / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function tripMiles() {
    var hundredths = Math.round(haversine(GEO.pickup, GEO.dropoff) * 100) / 100;
    var billed = Math.ceil(hundredths);
    if (billed < 1) billed = 1;
    return { raw: hundredths, billed: billed };
  }

  function estimate() {
    var miles = tripMiles();
    var mileage = miles.billed * PER_MILE_CENTS;
    var sub = BASE_CENTS + mileage;
    var tax = Math.round(sub * TAX_RATE);
    return {
      raw: miles.raw,
      billed: miles.billed,
      mileage: mileage,
      sub: sub,
      tax: tax,
      total: sub + tax
    };
  }

  function addressLine(street, city, stateName) {
    var cityState = [city, stateName].filter(Boolean).join(", ");
    return [street, cityState].filter(Boolean).join(", ");
  }

  function pickupLine() {
    return addressLine(state.pickupStreet, state.pickupCity, state.pickupState);
  }

  function dropLine() {
    return addressLine(state.dropStreet, state.dropCity, state.dropState);
  }

  function prettyWhen() {
    if (!state.date || !state.time) return "";
    var parts = state.date.split("-");
    var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var day = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    var hm = state.time.split(":");
    var hh = Number(hm[0]);
    var mm = hm[1] || "00";
    var suffix = hh >= 12 ? "PM" : "AM";
    var h12 = hh % 12 || 12;
    return day + " at " + h12 + ":" + mm + " " + suffix;
  }

  function project(point) {
    return {
      x: ((point.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100,
      y: ((BOUNDS.maxLat - point.lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100
    };
  }

  function bearing(a, b) {
    var y = Math.sin(((b.lng - a.lng) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
    var x = Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
      Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) *
      Math.cos(((b.lng - a.lng) * Math.PI) / 180);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function stopMotion() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    motionStart = 0;
    if (tileTimer) clearTimeout(tileTimer);
    tileTimer = 0;
    tilesOk = false;
    if (liveMap) {
      liveMap.remove();
      liveMap = null;
    }
    carMarker = null;
  }

  function modeSwitch(active) {
    return (
      '<div class="modes" role="tablist" aria-label="App mode">' +
      '<button type="button" role="tab" id="mode-customer" aria-selected="' + (active === "customer" ? "true" : "false") + '">Customer</button>' +
      '<button type="button" role="tab" id="mode-driver" aria-selected="' + (active === "driver" ? "true" : "false") + '">Driver</button>' +
      "</div>"
    );
  }

  function field(id, label, value, extra) {
    return (
      "<label for=\"" + id + "\">" + label + "</label>" +
      "<input id=\"" + id + "\" name=\"" + id + "\" value=\"" + esc(value) + "\" autocomplete=\"off\" " + (extra || "") + ">"
    );
  }

  function customerHome() {
    return (
      modeSwitch("customer") +
      "<h2>Request a ride</h2>" +
      "<p class=\"lede\">Sample ride is filled in. Nothing is sent, and nothing is charged.</p>" +
      "<form id=\"ride-form\" autocomplete=\"off\">" +
      '<div class="group"><p class="group-title">Pickup</p>' +
      field("pickup-street", "Street", state.pickupStreet, 'required') +
      '<div class="row"><div class="city">' +
      field("pickup-city", "City", state.pickupCity, "required") +
      '</div><div class="state">' +
      field("pickup-state", "State", state.pickupState, 'required maxlength="2"') +
      "</div></div></div>" +
      '<div class="group"><p class="group-title">Drop-off</p>' +
      field("drop-street", "Street", state.dropStreet, "required") +
      '<div class="row"><div class="city">' +
      field("drop-city", "City", state.dropCity, "required") +
      '</div><div class="state">' +
      field("drop-state", "State", state.dropState, 'required maxlength="2"') +
      "</div></div></div>" +
      '<div class="group"><p class="group-title">When</p><div class="row"><div class="city">' +
      field("ride-date", "Date", state.date, 'type="date" required') +
      '</div><div class="city">' +
      field("ride-time", "Time", state.time, 'type="time" required') +
      "</div></div></div>" +
      '<div class="group"><p class="group-title">Rider</p>' +
      field("rider-name", "Name", state.name, "required") +
      field("rider-phone", "Phone", state.phone, 'type="tel" inputmode="tel" required') +
      "</div>" +
      '<p class="note">Miles round up to the next whole mile. Texas tax is 8.25% and is estimate-only, not a charge.</p>' +
      '<p class="error" id="form-error" role="alert">' + esc(state.error) + "</p>" +
      '<button class="btn" type="submit">Request this ride</button>' +
      "</form>" +
      '<p class="fine">Driver mode on this screen shows the same sample request. Live tracking and other drivers come next.</p>'
    );
  }

  function moneyCard() {
    var est = estimate();
    return (
      '<div class="card">' +
      '<p class="tag">Estimate only</p>' +
      '<div class="money-row"><span>Sample distance</span><span>' + est.raw.toFixed(2) + " miles</span></div>" +
      '<div class="money-row"><span>Billed miles</span><span>' + est.billed + " (rounded up)</span></div>" +
      '<div class="money-row"><span>Base</span><span>' + money(BASE_CENTS) + "</span></div>" +
      '<div class="money-row"><span>Mileage ' + est.billed + " × " + money(PER_MILE_CENTS) + "</span><span>" + money(est.mileage) + "</span></div>" +
      '<div class="money-row"><span>Texas tax 8.25%</span><span>' + money(est.tax) + "</span></div>" +
      '<div class="total-row"><span>Preview total</span><span>' + money(est.total) + "</span></div>" +
      '<p class="fine">Not a charge. Tax is shown so the estimate matches the quote page. The map uses sample positions around Willis, not a live lookup of the typed address.</p>' +
      "</div>"
    );
  }

  function mapBlock(youLabel) {
    var pickup = project(GEO.pickup);
    var drop = project(GEO.dropoff);
    var start = project(GEO.driver);
    return (
      '<div class="map-stage">' +
      '<div id="live-map" role="img" aria-label="Sample map around Willis"></div>' +
      '<div class="illus" id="illus">' +
      illustratedMap(start, pickup, drop) +
      pin("pin-pickup", "pin-you", youLabel, pickup) +
      pin("pin-drop", "pin-drop", "Drop-off", drop) +
      '<div class="pin pin-car" id="pin-car" style="left:' + start.x + '%;top:' + start.y + '%"><div class="car-face" id="illus-car">' + CAR_SVG + "</div></div>" +
      "</div>" +
      '<p class="map-caption">Sample map · Willis</p>' +
      "</div>" +
      '<p class="legend"><span><i class="swatch"></i> Sample car</span>' +
      '<span><i class="swatch you"></i> ' + esc(youLabel) + "</span>" +
      '<span><i class="swatch drop"></i> Drop-off</span></p>'
    );
  }

  function pin(id, kind, label, point) {
    return (
      '<div class="pin ' + kind + '" id="' + id + '" style="left:' + point.x + "%;top:" + point.y + '%">' +
      '<span class="pin-label">' + esc(label) + "</span>" +
      '<span class="pin-head"></span></div>'
    );
  }

  function illustratedMap(start, pickup, drop) {
    var grid = "";
    var i;
    for (i = 1; i < 8; i += 1) {
      var p = i * 12.5;
      grid += '<line x1="' + p + '" y1="0" x2="' + p + '" y2="100" stroke="#2a5278" stroke-width="0.35"/>';
      grid += '<line x1="0" y1="' + p + '" x2="100" y2="' + p + '" stroke="#2a5278" stroke-width="0.35"/>';
    }
    return (
      '<svg class="illus-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="100" height="100" fill="#163455"/>' +
      '<path d="M0 22 C 18 18, 28 32, 46 28 S 78 18, 100 26 L 100 34 C 76 28, 62 40, 44 36 S 16 30, 0 32 Z" fill="#1d4d66"/>' +
      '<circle cx="72" cy="78" r="10" fill="#1c4a38"/>' +
      grid +
      '<polyline points="' + start.x + "," + start.y + " " + pickup.x + "," + pickup.y + " " + drop.x + "," + drop.y +
      '" fill="none" stroke="#e7c56a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="50" y="48" text-anchor="middle" fill="#f0d48a" font-size="5" font-family="Georgia, serif">WILLIS</text>' +
      "</svg>"
    );
  }

  function customerTrip() {
    return (
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      '<div class="status"><i></i><span>Driver on the way</span></div>' +
      "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) + "<br>" + esc(prettyWhen()) + "</p>" +
      mapBlock("You") +
      moneyCard() +
      '<p class="note">A live request would text ' + BUSINESS_PHONE + ". This button does not open Messages and does not send anything.</p>" +
      '<button class="btn" type="button" id="preview-only">Preview only</button>'
    );
  }

  function driverHome() {
    var est = estimate();
    return (
      modeSwitch("driver") +
      "<h2>Open requests</h2>" +
      "<p class=\"lede\">One sample request. No other drivers are connected.</p>" +
      '<article class="card">' +
      '<p class="tag">Sample</p>' +
      "<h2 style=\"font-size:18px\">" + esc(state.name || "Rider") + "</h2>" +
      "<p class=\"fine\">" + esc(prettyWhen()) + " · " + esc(state.phone) + "</p>" +
      '<div class="route-line"><p>' + esc(pickupLine()) + "</p><p>" + esc(dropLine()) + "</p></div>" +
      "<p class=\"fine\">" + est.raw.toFixed(2) + " miles on the sample map, billed as " + est.billed + ".</p>" +
      '<button class="btn" type="button" id="accept-ride">Accept</button>' +
      "</article>"
    );
  }

  function driverTrip() {
    return (
      '<button class="btn ghost" type="button" id="back-driver">← Requests</button>' +
      '<div class="status"><i></i><span>Heading to pickup</span></div>' +
      "<p class=\"lede\">" + esc(state.name || "Rider") + " is at " + esc(pickupLine()) + ".</p>" +
      mapBlock("Customer") +
      '<div class="card"><p class="tag">This ride</p>' +
      "<p><strong>Drop-off</strong><br>" + esc(dropLine()) + "</p>" +
      "<p class=\"fine\">" + esc(prettyWhen()) + ". Miles round up. Texas tax 8.25% stays estimate-only.</p></div>"
    );
  }

  function render() {
    stopMotion();
    var app = document.getElementById("app");
    var html = "";
    if (state.mode === "customer" && state.screen === "home") html = customerHome();
    else if (state.mode === "customer" && state.screen === "trip") html = customerTrip();
    else if (state.mode === "driver" && state.screen === "home") html = driverHome();
    else html = driverTrip();
    app.innerHTML = html;
    bind();
    if (state.screen === "trip") startMap();
  }

  function readForm() {
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : "";
    }
    state.pickupStreet = val("pickup-street");
    state.pickupCity = val("pickup-city");
    state.pickupState = val("pickup-state").toUpperCase();
    state.dropStreet = val("drop-street");
    state.dropCity = val("drop-city");
    state.dropState = val("drop-state").toUpperCase();
    state.date = val("ride-date");
    state.time = val("ride-time");
    state.name = val("rider-name");
    state.phone = val("rider-phone");
  }

  function formComplete() {
    return state.pickupStreet && state.pickupCity && state.pickupState &&
      state.dropStreet && state.dropCity && state.dropState &&
      state.date && state.time && state.name && state.phone;
  }

  function bind() {
    var customerBtn = document.getElementById("mode-customer");
    var driverBtn = document.getElementById("mode-driver");
    if (customerBtn) {
      customerBtn.addEventListener("click", function () {
        state.mode = "customer";
        state.screen = "home";
        state.error = "";
        render();
      });
    }
    if (driverBtn) {
      driverBtn.addEventListener("click", function () {
        if (document.getElementById("ride-form")) readForm();
        state.mode = "driver";
        state.screen = "home";
        state.error = "";
        render();
      });
    }
    var form = document.getElementById("ride-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        readForm();
        if (!formComplete()) {
          state.error = "Add pickup, drop-off, date, time, name, and phone.";
          render();
          return;
        }
        state.error = "";
        state.screen = "trip";
        render();
      });
    }
    var backHome = document.getElementById("back-home");
    if (backHome) {
      backHome.addEventListener("click", function () {
        state.mode = "customer";
        state.screen = "home";
        render();
      });
    }
    var backDriver = document.getElementById("back-driver");
    if (backDriver) {
      backDriver.addEventListener("click", function () {
        state.mode = "driver";
        state.screen = "home";
        render();
      });
    }
    var accept = document.getElementById("accept-ride");
    if (accept) {
      accept.addEventListener("click", function () {
        state.mode = "driver";
        state.screen = "trip";
        render();
      });
    }
    var preview = document.getElementById("preview-only");
    if (preview) preview.addEventListener("click", openPreview);
  }

  function draftText() {
    var est = estimate();
    return [
      "Private Car Services ride request",
      "10% website booking. Please apply the discount.",
      "",
      "Name: " + state.name,
      "Phone: " + state.phone,
      "Pickup: " + pickupLine(),
      "Drop-off: " + dropLine(),
      "When: " + prettyWhen(),
      "Billed miles: " + est.billed + " (rounded up from " + est.raw.toFixed(2) + ")",
      "Preview total: " + money(est.total),
      "Texas tax 8.25% is estimate-only, not a charge."
    ].join("\n");
  }

  function openPreview() {
    var sheet = document.getElementById("sheet");
    var draft = document.getElementById("draft");
    if (!sheet || !draft) return;
    draft.textContent = draftText();
    sheet.classList.add("open");
    var close = document.getElementById("close-sheet");
    if (close) close.focus();
  }

  function closePreview() {
    var sheet = document.getElementById("sheet");
    if (sheet) sheet.classList.remove("open");
  }

  function placeCar(lat, lng, deg) {
    var point = project({ lat: lat, lng: lng });
    var pinCar = document.getElementById("pin-car");
    if (pinCar) {
      pinCar.style.left = point.x + "%";
      pinCar.style.top = point.y + "%";
    }
    document.querySelectorAll(".car-face").forEach(function (el) {
      el.style.transform = "rotate(" + deg + "deg)";
    });
    if (carMarker) carMarker.setLatLng([lat, lng]);
  }

  function startMap() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var origin = GEO.driver;
    var dest = GEO.pickup;

    function frame(now) {
      if (!motionStart) motionStart = now;
      var duration = 22000;
      var hold = 2800;
      var elapsed = (now - motionStart) % (duration + hold);
      var t = Math.min(elapsed / duration, 1);
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      var along = eased * 0.9;
      var lat = origin.lat + (dest.lat - origin.lat) * along;
      var lng = origin.lng + (dest.lng - origin.lng) * along;
      var here = { lat: lat, lng: lng };
      placeCar(lat, lng, bearing(here, dest));
      rafId = requestAnimationFrame(frame);
    }

    var startPoint = project(origin);
    var pinCar = document.getElementById("pin-car");
    if (pinCar) {
      pinCar.style.left = startPoint.x + "%";
      pinCar.style.top = startPoint.y + "%";
    }

    tryLiveMap();

    if (reduce) {
      var midLat = origin.lat + (dest.lat - origin.lat) * 0.45;
      var midLng = origin.lng + (dest.lng - origin.lng) * 0.45;
      placeCar(midLat, midLng, bearing({ lat: midLat, lng: midLng }, dest));
    } else {
      rafId = requestAnimationFrame(frame);
    }
  }

  function pinIcon(label, kind) {
    return window.L.divIcon({
      className: "pin-icon",
      html: '<div class="pin-float ' + kind + '"><span class="pin-label">' + esc(label) + '</span><span class="pin-head"></span></div>',
      iconSize: [88, 46],
      iconAnchor: [44, 44]
    });
  }

  function tryLiveMap() {
    if (!window.L || !document.getElementById("live-map")) return;
    try {
      liveMap = window.L.map("live-map", {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true
      });
      var layer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(liveMap);
      window.L.polyline(
        [[GEO.driver.lat, GEO.driver.lng], [GEO.pickup.lat, GEO.pickup.lng], [GEO.dropoff.lat, GEO.dropoff.lng]],
        { color: "#d4b15a", weight: 4, opacity: 0.9 }
      ).addTo(liveMap);
      var youLabel = state.mode === "driver" ? "Customer" : "You";
      window.L.marker([GEO.pickup.lat, GEO.pickup.lng], { icon: pinIcon(youLabel, "pin-you") }).addTo(liveMap);
      window.L.marker([GEO.dropoff.lat, GEO.dropoff.lng], { icon: pinIcon("Drop-off", "pin-drop") }).addTo(liveMap);
      carMarker = window.L.marker([GEO.driver.lat, GEO.driver.lng], {
        icon: window.L.divIcon({
          className: "pin-icon",
          html: '<div class="car-face">' + CAR_SVG + "</div>",
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }),
        zIndexOffset: 500
      }).addTo(liveMap);
      liveMap.fitBounds(
        window.L.latLngBounds([
          [GEO.driver.lat, GEO.driver.lng],
          [GEO.pickup.lat, GEO.pickup.lng],
          [GEO.dropoff.lat, GEO.dropoff.lng]
        ]),
        { padding: [28, 28], maxZoom: 14 }
      );
      layer.on("tileload", function () {
        if (tilesOk) return;
        tilesOk = true;
        var illus = document.getElementById("illus");
        if (illus) illus.classList.add("is-hidden");
        setTimeout(function () {
          if (liveMap) liveMap.invalidateSize();
        }, 60);
      });
      var tileErrors = 0;
      layer.on("tileerror", function () {
        tileErrors += 1;
        if (tileErrors >= 6 && !tilesOk) fallbackMap();
      });
      tileTimer = setTimeout(function () {
        if (!tilesOk) fallbackMap();
      }, 5000);
    } catch (err) {
      fallbackMap();
    }
  }

  function fallbackMap() {
    tilesOk = false;
    if (liveMap) {
      liveMap.remove();
      liveMap = null;
    }
    carMarker = null;
    var illus = document.getElementById("illus");
    if (illus) illus.classList.remove("is-hidden");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var sheetHost = document.createElement("div");
    sheetHost.id = "sheet";
    sheetHost.className = "sheet-back";
    sheetHost.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<p class="tag">Preview only</p>' +
      '<h3 id="sheet-title">Nothing was sent</h3>' +
      "<p class=\"lede\">This does not open Messages. On a live app, this request would text " + BUSINESS_PHONE + ".</p>" +
      '<pre class="draft" id="draft"></pre>' +
      '<button class="btn" type="button" id="close-sheet">Close</button>' +
      "</div>";
    document.body.appendChild(sheetHost);
    sheetHost.addEventListener("click", function (event) {
      if (event.target === sheetHost) closePreview();
    });
    document.getElementById("close-sheet").addEventListener("click", closePreview);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closePreview();
    });
    render();
  });
})();
