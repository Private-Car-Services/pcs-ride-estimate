/* Private Car Services starter. Preview only: no texts, no charges, no API key. Shared rides use Firebase REST when PCS_SYNC.databaseURL is set. */
(function () {
  var BUSINESS_PHONE = "936-261-7878";
  var BASE_CENTS = 1100;
  var EXTRA_PAX_CENTS = 500;
  var EXTRA_STOP_CENTS = 1100;
  var DAY_MILE_CENTS = 110;
  var NIGHT_MILE_CENTS = 138;
  var LATE_MILE_CENTS = 143;
  var SHORT_NOTICE_PCT = 0.25;
  var TAX_RATE = 0.0825;

  var SAMPLE = {
    name: "",
    phone: "",
    pickupStreet: "",
    pickupCity: "",
    pickupState: "TX",
    dropStreet: "",
    dropCity: "",
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

  var ROLE = document.body && document.body.getAttribute("data-app") === "driver" ? "driver" : "customer";
  var STORE = "pcs-beta-ride";
  var DRIVER_CODE = "pcs-driver-code";
  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var lastDriverPatchAt = 0;
  var lastDriverPatchLat = null;
  var lastDriverPatchLng = null;
  var rideLookup = 0;

  var state = {
    mode: ROLE,
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
    error: "",
    passengers: 2,
    stops: 0,
    holiday: false,
    driverLat: null,
    driverLng: null,
    code: "",
    driverCode: "",
    codeError: "",
    codeDraft: "",
    remoteLoading: false
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

  function isCoord(v) {
    return v != null && v !== "" && isFinite(+v);
  }

  function pointFrom(lat, lng) {
    if (!isCoord(lat) || !isCoord(lng)) return null;
    return { lat: +lat, lng: +lng };
  }

  function placeCoords(prefix) {
    return pointFrom(state[prefix + "Lat"], state[prefix + "Lng"]);
  }

  function savedDriverPoint() {
    return pointFrom(state.driverLat, state.driverLng);
  }

  function routePoints() {
    var pickup = placeCoords("pickup") || GEO.pickup;
    var dropoff = placeCoords("drop") || GEO.dropoff;
    var live = !!(placeCoords("pickup") && placeCoords("drop"));
    var here = pointFrom(state.hereLat, state.hereLng);
    var driver = here || (live
      ? {
          lat: pickup.lat - (dropoff.lat - pickup.lat) * 0.3 - 0.008,
          lng: pickup.lng - (dropoff.lng - pickup.lng) * 0.3 - 0.008
        }
      : GEO.driver);
    return { pickup: pickup, dropoff: dropoff, driver: driver, live: live };
  }

  function tripMiles() {
    var pickup = placeCoords("pickup");
    var dropoff = placeCoords("drop");
    if (!pickup || !dropoff) return { raw: 0, billed: 0, ready: false };
    var hundredths = Math.round(haversine(pickup, dropoff) * 100) / 100;
    var billed = Math.ceil(hundredths);
    if (billed < 1) billed = 1;
    return { raw: hundredths, billed: billed, ready: true };
  }

  function resolveTier(dateStr, timeStr, isHoliday) {
    var daytime = { cents: DAY_MILE_CENTS, label: "Weekday daytime" };
    var weekendNight = { cents: NIGHT_MILE_CENTS, label: "Nights, weekends & holidays" };
    var late = { cents: LATE_MILE_CENTS, label: "Late night" };
    if (!dateStr || !timeStr) return daytime;
    var ymd = dateStr.split("-");
    var hm = timeStr.split(":");
    var date = new Date(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]), Number(hm[0]), Number(hm[1] || 0), 0, 0);
    var day = date.getDay();
    var hour = Number(hm[0]);
    if (hour >= 22 || hour < 6) return late;
    if (day === 0 || day === 6 || isHoliday || (hour >= 18 && hour <= 21)) return weekendNight;
    return daytime;
  }

  function ridePassengers() {
    var n = Number(state.passengers);
    return n >= 1 ? n : 2;
  }

  function rideStops() {
    var n = Number(state.stops);
    return n > 0 ? n : 0;
  }

  function isShortNotice() {
    if (!state.date || !state.time) return false;
    var ymd = state.date.split("-");
    var hm = state.time.split(":");
    var when = new Date(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]), Number(hm[0]), Number(hm[1] || 0), 0, 0);
    return when.getTime() - Date.now() < 24 * 60 * 60 * 1000;
  }

  function estimate() {
    var miles = tripMiles();
    var tier = resolveTier(state.date, state.time, !!state.holiday);
    var extraPax = Math.max(0, ridePassengers() - 2);
    var extraStops = rideStops();
    var mileage = miles.ready ? miles.billed * tier.cents : 0;
    var paxCents = extraPax * EXTRA_PAX_CENTS;
    var stopCents = extraStops * EXTRA_STOP_CENTS;
    var beforeNotice = BASE_CENTS + mileage + paxCents + stopCents;
    var notice = miles.ready && isShortNotice() ? Math.round(beforeNotice * SHORT_NOTICE_PCT) : 0;
    var sub = beforeNotice + notice;
    var tax = Math.round(sub * TAX_RATE);
    return {
      ready: miles.ready,
      raw: miles.raw,
      billed: miles.billed,
      perMileCents: tier.cents,
      tierLabel: tier.label,
      mileage: mileage,
      base: BASE_CENTS,
      extraPax: extraPax,
      paxCents: paxCents,
      stopCents: stopCents,
      notice: notice,
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
    var route = routePoints();
    var minLat = BOUNDS.minLat, maxLat = BOUNDS.maxLat, minLng = BOUNDS.minLng, maxLng = BOUNDS.maxLng;
    if (route.live) {
      var lats = [route.pickup.lat, route.dropoff.lat, route.driver.lat];
      var lngs = [route.pickup.lng, route.dropoff.lng, route.driver.lng];
      minLat = Math.min.apply(null, lats);
      maxLat = Math.max.apply(null, lats);
      minLng = Math.min.apply(null, lngs);
      maxLng = Math.max.apply(null, lngs);
      var padLat = Math.max((maxLat - minLat) * 0.35, 0.01);
      var padLng = Math.max((maxLng - minLng) * 0.35, 0.01);
      minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
    }
    return {
      x: ((point.lng - minLng) / (maxLng - minLng)) * 100,
      y: ((maxLat - point.lat) / (maxLat - minLat)) * 100
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


  function locateField(id, label, value, resultsId, locateId) {
    return (
      '<div class="locate">' +
      field(id, label, value, 'required placeholder="Search a place" autocomplete="off"') +
      (locateId ? '<button class="btn ghost locate-btn" type="button" id="' + locateId + '">Use current location</button>' : "") +
      '<div class="suggest" id="' + resultsId + '" hidden></div>' +
      "</div>"
    );
  }

  function stateCode(name) {
    var known = { texas: "TX", louisiana: "LA", oklahoma: "OK", arkansas: "AR" };
    if (!name) return "TX";
    var n = String(name).trim();
    if (n.length === 2) return n.toUpperCase();
    return known[n.toLowerCase()] || "TX";
  }

  function placeLine(p) {
    var street = [p.housenumber, p.street].filter(Boolean).join(" ");
    if (p.name && street && p.name.toLowerCase() !== street.toLowerCase()) return p.name + ", " + street;
    return p.name || street || "";
  }

  function setCoords(prefix, feature) {
    var coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords) return;
    state[prefix + "Lng"] = coords[0];
    state[prefix + "Lat"] = coords[1];
  }

  function applyPlace(prefix, feature) {
    var p = feature.properties || feature;
    var streetEl = document.getElementById(prefix + "-street");
    var cityEl = document.getElementById(prefix + "-city");
    var stateEl = document.getElementById(prefix + "-state");
    if (streetEl) streetEl.value = placeLine(p);
    if (cityEl && (p.city || p.county)) cityEl.value = p.city || p.county;
    if (stateEl) stateEl.value = stateCode(p.state);
    setCoords(prefix, feature);
  }

  function wireSearch(inputId, resultsId, prefix) {
    var input = document.getElementById(inputId);
    var box = document.getElementById(resultsId);
    if (!input || !box) return;
    var timer = 0;
    input.addEventListener("input", function () {
      var q = input.value.trim();
      state[prefix + "Lat"] = null;
      state[prefix + "Lng"] = null;
      clearTimeout(timer);
      if (q.length < 3) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      timer = setTimeout(function () {
        var url = "https://photon.komoot.io/api/?limit=5&lat=30.05&lon=-95.4&q=" + encodeURIComponent(q + " Texas");
        fetch(url).then(function (res) { return res.json(); }).then(function (data) {
          var features = (data && data.features) || [];
          if (input.value.trim() !== q || !features.length) {
            box.hidden = true;
            return;
          }
          box._places = features;
          box.innerHTML = features.map(function (f, i) {
            var p = f.properties || {};
            var sub = [p.city || p.county, stateCode(p.state)].filter(Boolean).join(", ");
            return '<button type="button" class="suggest-item" data-i="' + i + '"><strong>' + esc(placeLine(p)) + "</strong><span>" + esc(sub) + "</span></button>";
          }).join("");
          box.hidden = false;
        }).catch(function () { box.hidden = true; });
      }, 350);
    });
    box.addEventListener("click", function (event) {
      var btn = event.target.closest ? event.target.closest(".suggest-item") : null;
      if (!btn || !box._places) return;
      var feature = box._places[Number(btn.getAttribute("data-i"))];
      if (!feature) return;
      applyPlace(prefix, feature);
      box.hidden = true;
    });
  }

  function wireLocation() {
    var locBtn = document.getElementById("use-location");
    if (!locBtn || !navigator.geolocation) return;
    locBtn.addEventListener("click", function () {
      locBtn.disabled = true;
      locBtn.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(function (pos) {
        var url = "https://photon.komoot.io/reverse?limit=1&lat=" + pos.coords.latitude + "&lon=" + pos.coords.longitude;
        fetch(url).then(function (res) { return res.json(); }).then(function (data) {
          var feature = data.features && data.features[0];
          if (feature) applyPlace("pickup", feature);
          locBtn.disabled = false;
          locBtn.textContent = "Use current location";
        }).catch(function () {
          locBtn.disabled = false;
          locBtn.textContent = "Could not find that place";
        });
      }, function () {
        locBtn.disabled = false;
        locBtn.textContent = "Location unavailable";
      }, { enableHighAccuracy: true, timeout: 10000 });
    });
  }


  function databaseURL() {
    var cfg = window.PCS_SYNC || {};
    var url = cfg.databaseURL ? String(cfg.databaseURL).trim() : "";
    return url.replace(/\/+$/, "");
  }

  function syncOn() {
    return !!databaseURL();
  }

  function makeRideCode() {
    var out = "";
    var i;
    var buf;
    if (window.crypto && window.crypto.getRandomValues) {
      buf = new Uint8Array(8);
      window.crypto.getRandomValues(buf);
      for (i = 0; i < 8; i += 1) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
      return out;
    }
    for (i = 0; i < 8; i += 1) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  function normalizeCode(raw) {
    return String(raw || "").toUpperCase().replace(/\s+/g, "");
  }

  function rideUrl(code) {
    return databaseURL() + "/rides/" + encodeURIComponent(code) + ".json";
  }

  function coordNum(v) {
    return isCoord(v) ? +v : null;
  }

  function asRide(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data;
  }

  function getRide(code) {
    return fetch(rideUrl(code)).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("ride");
      return res.text().then(function (text) {
        if (!text) return null;
        try { return asRide(JSON.parse(text)); } catch (err) { return null; }
      });
    });
  }

  function putRide(code, ride) {
    return fetch(rideUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ride)
    }).then(function (res) {
      if (!res.ok) throw new Error("ride");
      return res.text().then(function () {});
    });
  }

  function patchRide(code, partial) {
    return fetch(rideUrl(code), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial)
    }).then(function (res) {
      if (!res.ok) throw new Error("ride");
      return res.text().then(function () {});
    });
  }

  function readDriverCode() {
    try { return localStorage.getItem(DRIVER_CODE) || ""; } catch (err) { return ""; }
  }

  function writeDriverCode(code) {
    try {
      if (code) localStorage.setItem(DRIVER_CODE, code);
      else localStorage.removeItem(DRIVER_CODE);
    } catch (err) {}
  }

  function rememberRemote(ride) {
    if (!ride || typeof ride !== "object") return;
    try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (err) {}
    applyRide(ride);
  }

  function publishRide(code, created) {
    return putRide(code, created).then(function () {
      var latest = currentRide();
      var patch = {};
      if (latest && latest.code === code) {
        if (latest.status && latest.status !== created.status) patch.status = latest.status;
        if (isCoord(latest.driverLat) && coordNum(latest.driverLat) !== coordNum(created.driverLat)) {
          patch.driverLat = +latest.driverLat;
        }
        if (isCoord(latest.driverLng) && coordNum(latest.driverLng) !== coordNum(created.driverLng)) {
          patch.driverLng = +latest.driverLng;
        }
        if (isCoord(latest.pickupLat) && coordNum(latest.pickupLat) !== coordNum(created.pickupLat)) {
          patch.pickupLat = +latest.pickupLat;
          patch.pickupLng = +latest.pickupLng;
        }
        if (isCoord(latest.dropLat) && coordNum(latest.dropLat) !== coordNum(created.dropLat)) {
          patch.dropLat = +latest.dropLat;
          patch.dropLng = +latest.dropLng;
        }
      }
      if (!patch.status && !isCoord(patch.driverLat) && !isCoord(patch.driverLng) && !isCoord(patch.pickupLat) && !isCoord(patch.dropLat)) {
        return;
      }
      return patchRide(code, patch);
    });
  }

  function pushPlaceCoords() {
    if (!syncOn() || ROLE !== "customer" || !state.code) return;
    var patch = {};
    if (isCoord(state.pickupLat) && isCoord(state.pickupLng)) {
      patch.pickupLat = +state.pickupLat;
      patch.pickupLng = +state.pickupLng;
    }
    if (isCoord(state.dropLat) && isCoord(state.dropLng)) {
      patch.dropLat = +state.dropLat;
      patch.dropLng = +state.dropLng;
    }
    if (!isCoord(patch.pickupLat) && !isCoord(patch.dropLat)) return;
    patchRide(state.code, patch).catch(function () {});
  }

  function maybePatchDriverLocation() {
    if (!syncOn() || ROLE !== "driver" || state.screen !== "trip") return;
    var code = state.driverCode || readDriverCode();
    if (!code) return;
    if (!isCoord(state.hereLat) || !isCoord(state.hereLng)) return;
    var lat = +state.hereLat;
    var lng = +state.hereLng;
    if (lastDriverPatchLat === lat && lastDriverPatchLng === lng) return;
    var now = Date.now();
    if (now - lastDriverPatchAt < 3000) return;
    lastDriverPatchAt = now;
    lastDriverPatchLat = lat;
    lastDriverPatchLng = lng;
    patchRide(code, { driverLat: lat, driverLng: lng }).catch(function () {
      if (lastDriverPatchLat === lat && lastDriverPatchLng === lng) {
        lastDriverPatchLat = null;
        lastDriverPatchLng = null;
      }
    });
  }

  function rideCodeBanner() {
    if (!syncOn() || !state.code) return "";
    return '<p class="ride-code-label">Tell your driver this code</p>' +
      '<p class="ride-code">' + esc(state.code) + "</p>";
  }

  function differentCodeButton() {
    return '<button class="btn ghost" type="button" id="different-code">Different code</button>';
  }

  function driverCodeForm() {
    return (
      "<h2>Open requests</h2>" +
      '<form id="code-form" autocomplete="off">' +
      field("ride-code", "Ride code", state.codeDraft || "", 'autocapitalize="characters" autocomplete="off" spellcheck="false"') +
      '<p class="error" id="code-error" role="alert">' + esc(state.codeError || "") + "</p>" +
      '<button class="btn" type="submit"' + (state.remoteLoading ? " disabled" : "") + ">" +
      (state.remoteLoading ? "Opening ride…" : "Open ride") + "</button>" +
      "</form>"
    );
  }

  function ingestCustomerRide(ride) {
    if (!ride) return;
    var statusChanged = (ride.status || "") !== (state.rideStatus || "");
    var placesChanged = coordNum(ride.pickupLat) !== coordNum(state.pickupLat) ||
      coordNum(ride.pickupLng) !== coordNum(state.pickupLng) ||
      coordNum(ride.dropLat) !== coordNum(state.dropLat) ||
      coordNum(ride.dropLng) !== coordNum(state.dropLng);
    var driverChanged = coordNum(ride.driverLat) !== coordNum(state.driverLat) ||
      coordNum(ride.driverLng) !== coordNum(state.driverLng);
    var codeChanged = !!(ride.code && ride.code !== state.code);
    if (!statusChanged && !placesChanged && !driverChanged && !codeChanged) return;
    var screen = state.screen;
    applyRide(ride);
    if (screen === "waiting" && ride.status === "accepted") state.screen = "trip";
    var onlyDriver = !statusChanged && !placesChanged && driverChanged && state.screen === screen;
    if (onlyDriver && carMarker && isCoord(state.driverLat) && isCoord(state.driverLng)) {
      carMarker.setLatLng([+state.driverLat, +state.driverLng]);
      return;
    }
    render();
  }

  function pullRemoteRide() {
    if (!syncOn() || ROLE !== "customer") return;
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    var code = state.code;
    if (!code) {
      var local = currentRide();
      code = local && local.code;
    }
    if (!code) return;
    getRide(code).then(function (ride) {
      if (!ride) return;
      if (ROLE !== "customer") return;
      if (state.screen !== "waiting" && state.screen !== "trip") return;
      if ((state.screen === "waiting" || state.screen === "trip") && state.code && ride.code && ride.code !== state.code) return;
      try { localStorage.setItem(STORE, JSON.stringify(ride)); } catch (err) {}
      ingestCustomerRide(ride);
    }).catch(function () {});
  }

  function openDriverCode(code, opts) {
    var keepOnMiss = opts && opts.keepLocal;
    var seq = ++rideLookup;
    state.remoteLoading = true;
    state.codeError = "";
    getRide(code).then(function (ride) {
      if (seq !== rideLookup) return;
      state.remoteLoading = false;
      if (!ride) {
        writeDriverCode("");
        state.driverCode = "";
        state.codeDraft = code;
        state.codeError = "That code was not found.";
        clearRideFields();
        state.screen = "home";
        render();
        return;
      }
      if (!ride.code) ride.code = code;
      writeDriverCode(code);
      state.driverCode = code;
      state.codeDraft = code;
      state.codeError = "";
      rememberRemote(ride);
      state.screen = "home";
      render();
    }).catch(function () {
      if (seq !== rideLookup) return;
      state.remoteLoading = false;
      if (!keepOnMiss) {
        render();
        return;
      }
      var local = currentRide();
      if (local && (!local.code || local.code === code)) {
        if (!local.code) local.code = code;
        writeDriverCode(code);
        state.driverCode = code;
        state.codeDraft = code;
        rememberRemote(local);
      }
      render();
    });
  }

  function customerHome() {
    return (
      "<h2>Request a ride</h2>" +
      "<p class=\"lede\">Nothing is sent, and nothing is charged.</p>" +
      "<form id=\"ride-form\" autocomplete=\"off\">" +
      '<div class="group"><p class="group-title">Pickup</p>' +
      locateField("pickup-street", "Street", state.pickupStreet, "pickup-results", "use-location") +
      '<div class="row"><div class="city">' +
      field("pickup-city", "City", state.pickupCity, "required") +
      '</div><div class="state">' +
      field("pickup-state", "State", state.pickupState, 'required maxlength="2"') +
      "</div></div></div>" +
      '<div class="group"><p class="group-title">Drop-off</p>' +
      locateField("drop-street", "Street", state.dropStreet, "drop-results", "") +
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
      '<p class="fine">The driver uses a separate app. On this phone, that app sees this request. Nothing is texted.</p>'
    );
  }

  function moneyCard() {
    var est = estimate();
    if (!est.ready) {
      return (
        '<div class="card">' +
        '<p class="tag">Estimate only · not a charge</p>' +
        '<p class="fine">Not a charge. Miles and the fare show when both places are found.</p>' +
        "</div>"
      );
    }
    var noticeNote = est.notice
      ? " Includes 25% for under 24 hours' notice."
      : "";
    return (
      '<div class="card">' +
      '<p class="tag">Estimate only · not a charge</p>' +
      '<div class="money-row"><span>Miles</span><span>' + est.raw.toFixed(2) + " mi, billed as " + est.billed + " (rounded up)</span></div>" +
      '<div class="money-row"><span>Fare before tax</span><span>' + money(est.sub) + "</span></div>" +
      '<div class="money-row"><span>Texas tax 8.25%</span><span>' + money(est.tax) + "</span></div>" +
      '<div class="total-row"><span>Estimated total</span><span>' + money(est.total) + "</span></div>" +
      '<p class="fine">Not a charge. ' + esc(est.tierLabel) + " " + money(est.perMileCents) +
      "/mi, local base " + money(est.base) + " for 2 passengers." + noticeNote + "</p>" +
      "</div>"
    );
  }

  function mapBlock(youLabel) {
    var route = routePoints();
    var pickup = project(route.pickup);
    var drop = project(route.dropoff);
    var start = project(route.driver);
    return (
      '<div class="map-stage">' +
      '<div id="live-map" role="img" aria-label="' + (route.live ? "Route map" : "Sample map") + '"></div>' +
      '<div class="illus" id="illus">' +
      illustratedMap(start, pickup, drop) +
      pin("pin-pickup", "pin-you", youLabel, pickup) +
      pin("pin-drop", "pin-drop", "Drop-off", drop) +
      '<div class="pin pin-car" id="pin-car" style="left:' + start.x + '%;top:' + start.y + '%"><div class="car-face" id="illus-car">' + CAR_SVG + "</div></div>" +
      "</div>" +
      '<p class="map-caption">' + (isFinite(state.hereLat) && route.live ? "You, pickup, and drop-off" : (route.live ? "Your route" : "Sample map · Willis")) + "</p>" +
      "</div>" +
      '<p class="legend"><span><i class="swatch"></i> ' + (isFinite(state.hereLat) ? "You" : "Sample car") + "</span>" +
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

  function fitProject(point, points) {
    var lats = points.map(function (p) { return p.lat; });
    var lngs = points.map(function (p) { return p.lng; });
    var minLat = Math.min.apply(null, lats);
    var maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs);
    var maxLng = Math.max.apply(null, lngs);
    var padLat = Math.max((maxLat - minLat) * 0.35, 0.01);
    var padLng = Math.max((maxLng - minLng) * 0.35, 0.01);
    minLat -= padLat;
    maxLat += padLat;
    minLng -= padLng;
    maxLng += padLng;
    return {
      x: ((point.lng - minLng) / (maxLng - minLng)) * 100,
      y: ((maxLat - point.lat) / (maxLat - minLat)) * 100
    };
  }

  function customerMapBlock(caption, driverPoint) {
    var pickup = placeCoords("pickup");
    var drop = placeCoords("drop");
    var both = !!(pickup && drop);
    var points = [];
    if (pickup) points.push(pickup);
    if (drop) points.push(drop);
    if (driverPoint) points.push(driverPoint);
    var illus = "";
    if (both) {
      var a = fitProject(pickup, points);
      var b = fitProject(drop, points);
      var car = "";
      if (driverPoint) {
        var c = fitProject(driverPoint, points);
        car = '<div class="pin pin-car" id="pin-car" style="left:' + c.x + '%;top:' + c.y + '%"><div class="car-face" id="illus-car">' + CAR_SVG + "</div></div>";
      }
      illus = (
        '<div class="illus" id="illus">' +
        '<svg class="illus-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
        '<rect width="100" height="100" fill="#163455"/>' +
        '<polyline points="' + a.x + "," + a.y + " " + b.x + "," + b.y +
        '" fill="none" stroke="#e7c56a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>" +
        pin("pin-pickup", "pin-you", "Pickup", a) +
        pin("pin-drop", "pin-drop", "Drop-off", b) +
        car +
        "</div>"
      );
    }
    var legend = both
      ? '<p class="legend"><span><i class="swatch you"></i> Pickup</span><span><i class="swatch drop"></i> Drop-off</span>' +
        (driverPoint ? '<span><i class="swatch"></i> Your driver</span>' : "") + "</p>"
      : "";
    return (
      '<div class="map-stage">' +
      '<div id="live-map" role="img" aria-label="' + (both ? "Route map" : "Sample map") + '"></div>' +
      illus +
      '<p class="map-caption">' + esc(caption) + "</p>" +
      "</div>" +
      legend
    );
  }

  function customerTrip() {
    var both = !!(placeCoords("pickup") && placeCoords("drop"));
    var driver = savedDriverPoint();
    var caption = !both
      ? "Sample map · Willis"
      : (driver ? "Your driver" : "Driver location shows once they accept on a linked phone.");
    return (
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      '<div class="status"><i></i><span>Driver on the way</span></div>' +
      "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) + "<br>" + esc(prettyWhen()) + "</p>" +
      customerMapBlock(caption, driver) +
      moneyCard() +
      '<p class="note">A live request would text ' + BUSINESS_PHONE + ". This button does not open Messages and does not send anything.</p>" +
      '<button class="btn" type="button" id="preview-only">Preview only</button>'
    );
  }

  function customerWaiting() {
    var both = !!(placeCoords("pickup") && placeCoords("drop"));
    var driver = savedDriverPoint();
    var caption = !both ? "Sample map · Willis" : (driver ? "Your driver" : "Your route");
    var note = syncOn()
      ? "This screen changes when a driver accepts. Nothing is texted."
      : "Open the driver app and accept this ride. This screen changes when a driver accepts.";
    return (
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      '<div class="status"><i></i><span>Waiting for a driver</span></div>' +
      "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) + "<br>" + esc(prettyWhen()) + "</p>" +
      rideCodeBanner() +
      customerMapBlock(caption, driver) +
      moneyCard() +
      '<p class="note">' + note + "</p>"
    );
  }

  function applyRide(ride) {
    if (!ride) return;
    state.name = ride.name || "";
    state.phone = ride.phone || "";
    state.pickupStreet = ride.pickupStreet || "";
    state.pickupCity = ride.pickupCity || "";
    state.pickupState = ride.pickupState || "TX";
    state.dropStreet = ride.dropStreet || "";
    state.dropCity = ride.dropCity || "";
    state.dropState = ride.dropState || "TX";
    state.date = ride.date || state.date;
    state.time = ride.time || state.time;
    state.rideStatus = ride.status || "";
    state.pickupLat = ride.pickupLat;
    state.pickupLng = ride.pickupLng;
    state.dropLat = ride.dropLat;
    state.dropLng = ride.dropLng;
    state.driverLat = isCoord(ride.driverLat) ? +ride.driverLat : null;
    state.driverLng = isCoord(ride.driverLng) ? +ride.driverLng : null;
    if (ride.passengers != null) state.passengers = ride.passengers;
    if (ride.stops != null) state.stops = ride.stops;
    state.holiday = !!ride.holiday;
    if (ride.code) state.code = ride.code;
  }

  function currentRide() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "null");
    } catch (err) {
      return null;
    }
  }

  function saveRide(status, opts) {
    state.rideStatus = status;
    var prev = currentRide() || {};
    var clearDriver = opts && opts.clearDriver;
    var driverLat = isCoord(state.driverLat) ? +state.driverLat : null;
    var driverLng = isCoord(state.driverLng) ? +state.driverLng : null;
    if (!clearDriver) {
      if (!isCoord(driverLat) && isCoord(prev.driverLat)) driverLat = +prev.driverLat;
      if (!isCoord(driverLng) && isCoord(prev.driverLng)) driverLng = +prev.driverLng;
    }
    var rideOut = {
      name: state.name,
      phone: state.phone,
      pickupStreet: state.pickupStreet,
      pickupCity: state.pickupCity,
      pickupState: state.pickupState,
      dropStreet: state.dropStreet,
      dropCity: state.dropCity,
      dropState: state.dropState,
      date: state.date,
      time: state.time,
      status: status,
      pickupLat: state.pickupLat,
      pickupLng: state.pickupLng,
      dropLat: state.dropLat,
      dropLng: state.dropLng,
      driverLat: driverLat,
      driverLng: driverLng,
      passengers: ridePassengers(),
      stops: rideStops(),
      holiday: !!state.holiday
    };
    if (state.code) rideOut.code = state.code;
    localStorage.setItem(STORE, JSON.stringify(rideOut));
  }

  function clearRideFields() {
    state.name = "";
    state.phone = "";
    state.pickupStreet = "";
    state.pickupCity = "";
    state.dropStreet = "";
    state.dropCity = "";
    state.rideStatus = "";
    state.pickupLat = null;
    state.pickupLng = null;
    state.dropLat = null;
    state.dropLng = null;
    state.driverLat = null;
    state.driverLng = null;
    state.passengers = 2;
    state.stops = 0;
    state.holiday = false;
    state.code = "";
  }

  function driverHome() {
    if (syncOn() && state.remoteLoading && !state.pickupStreet) {
      return "<h2>Open requests</h2><p class=\"lede\">Opening ride…</p>" + differentCodeButton();
    }
    if (syncOn() && !state.pickupStreet) return driverCodeForm();
    var est = estimate();
    return (
      "<h2>Open requests</h2>" +
      (state.pickupStreet
        ? '<p class="lede">From the passenger app.</p>' +
          mapBlock("Pickup") +
          (isFinite(state.hereLat) ? "" : '<p class="fine">Allow location to put you on this map.</p>') +
          '<article class="card">' +
          '<p class="tag">' + (state.rideStatus === "accepted" ? "Accepted" : "New") + "</p>" +
          '<h2 style="font-size:18px">' + esc(state.name || "Rider") + "</h2>" +
          '<p class="fine">' + esc(prettyWhen()) + (state.phone ? " · " + esc(state.phone) : "") + "</p>" +
          '<div class="route-line"><p>' + esc(pickupLine()) + "</p><p>" + esc(dropLine()) + "</p></div>" +
          '<p class="fine">' + (est.ready ? est.raw.toFixed(2) + " miles, billed as " + est.billed + "." : "Miles appear when both places are found.") + "</p>" +
          '<button class="btn" type="button" id="accept-ride">' +
          (state.rideStatus === "accepted" ? "Open trip" : "Accept") + "</button></article>" +
          (syncOn() ? differentCodeButton() : "")
        : '<p class="lede">No open requests. A ride from the passenger app shows up here.</p>')
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
    if (ROLE === "driver" && state.screen === "home") html = driverHome();
    else if (ROLE === "driver") html = driverTrip();
    else if (state.screen === "waiting") html = customerWaiting();
    else if (state.screen === "trip") html = customerTrip();
    else html = customerHome();
    app.innerHTML = html;
    bind();
    var customerRide = ROLE === "customer" && (state.screen === "waiting" || state.screen === "trip");
    if (customerRide) {
      startCustomerMap();
      ensureCustomerCoords();
    } else if (ROLE === "driver" && (state.screen === "trip" || (state.screen === "home" && state.pickupStreet))) {
      startMap();
    }
    if (ROLE === "driver" && state.pickupStreet && !placeCoords("pickup") && !state.geocodeTried) {
      state.geocodeTried = true;
      geocodeMissing().then(function () { render(); });
    }
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
    wireSearch("pickup-street", "pickup-results", "pickup");
    wireSearch("drop-street", "drop-results", "drop");
    wireLocation();
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
        state.customerGeocodeTried = false;
        state.driverLat = null;
        state.driverLng = null;
        state.code = syncOn() ? makeRideCode() : "";
        geocodeMissing().then(function () {
          saveRide("requested", { clearDriver: true });
          var created = currentRide();
          state.screen = "waiting";
          render();
          if (syncOn() && state.code && created) publishRide(state.code, created).catch(function () {});
        });
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
        saveRide("accepted");
        var code = state.driverCode || state.code || readDriverCode();
        if (syncOn() && code) patchRide(code, { status: "accepted" }).catch(function () {});
        state.mode = "driver";
        state.screen = "trip";
        render();
      });
    }
    var codeForm = document.getElementById("code-form");
    if (codeForm) {
      codeForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = document.getElementById("ride-code");
        var code = normalizeCode(input ? input.value : "");
        state.codeDraft = code;
        if (!code) {
          state.codeError = "Enter the ride code.";
          render();
          return;
        }
        openDriverCode(code, { keepLocal: true });
        render();
      });
    }
    var different = document.getElementById("different-code");
    if (different) {
      different.addEventListener("click", function () {
        rideLookup += 1;
        writeDriverCode("");
        state.driverCode = "";
        state.codeDraft = "";
        state.codeError = "";
        state.remoteLoading = false;
        clearRideFields();
        state.screen = "home";
        render();
      });
    }
    var preview = document.getElementById("preview-only");
    if (preview) preview.addEventListener("click", openPreview);
  }


  function geocodeQuery(q) {
    var url = "https://photon.komoot.io/api/?limit=1&lat=30.05&lon=-95.4&q=" + encodeURIComponent(q + " Texas");
    return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      return data.features && data.features[0];
    }).catch(function () { return null; });
  }

  function ensureCustomerCoords() {
    if (ROLE !== "customer") return;
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    if (placeCoords("pickup") && placeCoords("drop")) return;
    if (state.customerGeocodeTried) return;
    state.customerGeocodeTried = true;
    geocodeMissing().then(function () {
      if (ROLE !== "customer") return;
      if (state.screen !== "waiting" && state.screen !== "trip") return;
      if (placeCoords("pickup") || placeCoords("drop")) {
        saveRide(state.rideStatus || (state.screen === "trip" ? "accepted" : "requested"));
        pushPlaceCoords();
      }
      render();
    });
  }

  function geocodeMissing() {
    var jobs = [];
    if (!placeCoords("pickup")) {
      jobs.push(geocodeQuery(pickupLine()).then(function (feature) { if (feature) setCoords("pickup", feature); }));
    }
    if (!placeCoords("drop")) {
      jobs.push(geocodeQuery(dropLine()).then(function (feature) { if (feature) setCoords("drop", feature); }));
    }
    return Promise.all(jobs);
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

  function startCustomerMap() {
    if (!placeCoords("pickup") || !placeCoords("drop")) return;
    if (!window.L || !document.getElementById("live-map")) return;
    var pickup = placeCoords("pickup");
    var drop = placeCoords("drop");
    var driver = state.screen === "trip" ? savedDriverPoint() : null;
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
      var line = [[pickup.lat, pickup.lng], [drop.lat, drop.lng]];
      var bounds = [[pickup.lat, pickup.lng], [drop.lat, drop.lng]];
      if (driver) {
        line = [[driver.lat, driver.lng], [pickup.lat, pickup.lng], [drop.lat, drop.lng]];
        bounds.push([driver.lat, driver.lng]);
      }
      window.L.polyline(line, { color: "#d4b15a", weight: 4, opacity: 0.9 }).addTo(liveMap);
      window.L.marker([pickup.lat, pickup.lng], { icon: pinIcon("Pickup", "pin-you") }).addTo(liveMap);
      window.L.marker([drop.lat, drop.lng], { icon: pinIcon("Drop-off", "pin-drop") }).addTo(liveMap);
      if (driver) {
        carMarker = window.L.marker([driver.lat, driver.lng], {
          icon: window.L.divIcon({
            className: "pin-icon",
            html: '<div class="car-face">' + CAR_SVG + "</div>",
            iconSize: [44, 44],
            iconAnchor: [22, 22]
          }),
          zIndexOffset: 500
        }).addTo(liveMap);
      }
      liveMap.fitBounds(window.L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
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

  function startMap() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var route = routePoints();
    var origin = route.driver;
    var dest = route.pickup;

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

    if (isFinite(state.hereLat)) {
      placeCar(+state.hereLat, +state.hereLng, bearing({ lat: +state.hereLat, lng: +state.hereLng }, dest));
    } else if (reduce) {
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
      var route = routePoints();
      window.L.polyline(
        [[route.driver.lat, route.driver.lng], [route.pickup.lat, route.pickup.lng], [route.dropoff.lat, route.dropoff.lng]],
        { color: "#d4b15a", weight: 4, opacity: 0.9 }
      ).addTo(liveMap);
      var youLabel = state.mode === "driver" ? "Customer" : "You";
      window.L.marker([route.pickup.lat, route.pickup.lng], { icon: pinIcon(youLabel, "pin-you") }).addTo(liveMap);
      window.L.marker([route.dropoff.lat, route.dropoff.lng], { icon: pinIcon("Drop-off", "pin-drop") }).addTo(liveMap);
      carMarker = window.L.marker([route.driver.lat, route.driver.lng], {
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
          [route.driver.lat, route.driver.lng],
          [route.pickup.lat, route.pickup.lng],
          [route.dropoff.lat, route.dropoff.lng]
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

  function followGps() {
    if (!navigator.geolocation || state.gpsWatch) return;
    state.gpsWatch = navigator.geolocation.watchPosition(function (pos) {
      var first = !isFinite(state.hereLat);
      state.hereLat = pos.coords.latitude;
      state.hereLng = pos.coords.longitude;
      state.driverLat = state.hereLat;
      state.driverLng = state.hereLng;
      var ride = currentRide();
      if (syncOn()) {
        var driverCode = state.driverCode || readDriverCode();
        if (!ride || !driverCode || ride.code !== driverCode) ride = null;
      }
      if (ride && (ride.driverLat !== state.hereLat || ride.driverLng !== state.hereLng)) {
        ride.driverLat = state.hereLat;
        ride.driverLng = state.hereLng;
        localStorage.setItem(STORE, JSON.stringify(ride));
      }
      maybePatchDriverLocation();
      if (carMarker) {
        placeCar(state.hereLat, state.hereLng, bearing(
          { lat: state.hereLat, lng: state.hereLng },
          routePoints().pickup
        ));
      } else if (first) {
        render();
      }
    }, function () {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
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
    if (ROLE === "driver") {
      if (syncOn()) {
        state.driverCode = readDriverCode();
        state.codeDraft = state.driverCode;
        if (state.driverCode) openDriverCode(state.driverCode, { keepLocal: true });
      } else {
        applyRide(currentRide());
      }
      followGps();
    }
    window.addEventListener("storage", function (event) {
      if (event.key !== STORE) return;
      syncRide();
    });
    setInterval(function () {
      syncRide();
    }, 1000);
    setInterval(pullRemoteRide, 3000);
    render();
  });

  function syncRide() {
    var ride = currentRide();
    if (ROLE === "driver") {
      if (syncOn()) {
        if (state.remoteLoading) return;
        var want = state.driverCode || readDriverCode();
        if (!want) return;
        if (!ride || ride.code !== want) return;
      }
      var stamp = ride ? ride.status + "|" + ride.pickupStreet + "|" + ride.name + "|" + (ride.code || "") : "";
      if (stamp === state.syncStamp) return;
      state.syncStamp = stamp;
      if (!ride || !ride.pickupStreet) clearRideFields();
      else applyRide(ride);
      if (state.screen === "trip" && ride && ride.status === "accepted") return;
      if (state.screen !== "home" && (!ride || ride.status !== "accepted")) state.screen = "home";
      render();
      return;
    }
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    if (!ride) return;
    ingestCustomerRide(ride);
  }
})();
