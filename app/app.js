/* Private Car Services starter. Preview only: no texts, no charges, no API key. Shared rides use Firebase REST when PCS_SYNC.databaseURL is set. */
(function () {
  var BUSINESS_PHONE = "936-261-7878";
  var DRIVER_COMMISSION_RATE = 0.7;
  var EXTRA_FEE = 0;
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
    time: ""
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
  var RIDE_OWNER = "pcs-beta-ride-owner";
  var DRIVER_CODE = "pcs-driver-code";
  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Presence + open-request indexes live under fixed ride codes so current Firebase
  // /rides/{8-char} rules work without /open or /drivers paths.
  var PRESENCE_HUB = "AVLBLDRV";
  var OPEN_HUB = "REQUESTS";
  var lastDriverPatchAt = 0;
  var lastDriverPatchLat = null;
  var lastDriverPatchLng = null;
  var rideLookup = 0;
  var openListSeq = 0;
  var driving = { key: "", pending: "", done: false, miles: null, line: null };

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
    date: "",
    time: SAMPLE.time,
    error: "",
    passengers: 2,
    stops: 0,
    holiday: false,
    driverLat: null,
    driverLng: null,
    driverName: "",
    driverPhone: "",
    riderPhoto: "",
    driverPhoto: "",
    code: "",
    driverCode: "",
    codeError: "",
    codeDraft: "",
    pin: "",
    pinDraft: "",
    pinError: "",
    tripPath: [],
    useDrivenMiles: false,
    endedEarly: false,
    remoteLoading: false,
    dropFix: null,
    pickupFromHere: false,
    loginError: "",
    gateStep: "",
    openRides: [],
    selectedOpenCode: "",
    openListError: "",
    openListLoading: false,
    openListStamp: "",
    onlineDrivers: [],
    onlineStamp: "",
    boardMarkers: null
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

  function chicagoParts(when) {
    var parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(when || new Date()).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    var hour = parts.hour === "24" ? "00" : parts.hour;
    return {
      date: parts.year + "-" + parts.month + "-" + parts.day,
      time: hour + ":" + parts.minute
    };
  }

  function pickupStamp(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    var ymd = String(dateStr).split("-");
    var hm = String(timeStr).split(":");
    if (ymd.length !== 3 || hm.length < 2) return null;
    var y = Number(ymd[0]);
    var m = Number(ymd[1]);
    var d = Number(ymd[2]);
    var h = Number(hm[0]);
    var min = Number(hm[1]);
    if (![y, m, d, h, min].every(function (n) { return isFinite(n); })) return null;
    return y * 100000000 + m * 1000000 + d * 10000 + h * 100 + min;
  }

  function chicagoNowStamp() {
    var now = chicagoParts(new Date());
    return pickupStamp(now.date, now.time);
  }

  function isPickupInPast(dateStr, timeStr) {
    var want = pickupStamp(dateStr, timeStr);
    var now = chicagoNowStamp();
    if (want == null || now == null) return false;
    return want < now;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function money(cents) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function readRiderAccount() {
    try {
      var raw = localStorage.getItem("pcs-rider-account");
      if (!raw) return null;
      var account = JSON.parse(raw);
      if (!account || typeof account !== "object") return null;
      return account;
    } catch (err) {
      return null;
    }
  }

  function safePhoto(value) {
    if (typeof value !== "string") return "";
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)) return "";
    if (value.length > 120000) return "";
    return value;
  }

  function photoImg(value) {
    var photo = safePhoto(value);
    if (!photo) return "";
    return '<img class="avatar" alt="" src="' + photo + '">';
  }

  function readDriverAccount() {
    try {
      var raw = localStorage.getItem("pcs-driver-account");
      if (!raw) return null;
      var account = JSON.parse(raw);
      if (!account || typeof account !== "object") return null;
      return account;
    } catch (err) {
      return null;
    }
  }

  function commissionLine() {
    var rate = DRIVER_COMMISSION_RATE;
    if (rate == null || typeof rate !== "number" || rate < 0 || rate > 1) {
      return '<p class="fine">Commission: rate not set yet</p>';
    }
    var pct = Math.round(rate * 100);
    var est = estimate();
    if (!est.ready) {
      return '<p class="fine">Your commission is ' + pct + '% of the fare before tax and fees. Estimate only · not a payout.</p>';
    }
    var base = est.sub - EXTRA_FEE;
    if (base < 0) base = 0;
    var cents = Math.round(base * rate);
    return '<p><strong>Your commission</strong> ' + money(cents) + '</p>' +
      '<p class="fine">' + pct + '% of the fare before tax and fees. Estimate only · not a payout.</p>';
  }

  function driverIdentityLine() {
    var img = photoImg(state.driverPhoto);
    if (!state.driverName && !img) return "";
    var phone = "";
    if (state.driverPhone) {
      var tel = String(state.driverPhone).replace(/[^\d+]/g, "");
      phone = ' <a href="tel:' + esc(tel) + '">' + esc(state.driverPhone) + "</a>";
    }
    var who = state.driverName ? esc(state.driverName) : "your driver";
    return '<div class="who">' + img +
      '<p class="lede">Your driver is ' + who + "." + phone + "</p></div>";
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

  function driverNearPickup() {
    var driver = savedDriverPoint();
    var pickup = placeCoords("pickup");
    if (!driver || !pickup) return false;
    return haversine(driver, pickup) <= 20;
  }

  function unavailableCall() {
    return (
      '<div class="status"><i></i><span>No one is available</span></div>' +
      '<p class="lede">No one is available. Please call <a href="tel:' + BUSINESS_PHONE + '">' + esc(BUSINESS_PHONE) + "</a> directly.</p>"
    );
  }

  function driversOnlineNow() {
    var cutoff = Date.now() - 2 * 60 * 1000;
    return (state.onlineDrivers || []).filter(function (d) {
      return d && d.online !== false && Number(d.at || 0) >= cutoff;
    });
  }

  function someoneAvailable() {
    if (driversOnlineNow().length) return true;
    if (state.rideStatus === "accepted" || state.rideStatus === "started") return true;
    if (driverNearPickup()) return true;
    if (state.driverName) return true;
    return false;
  }

  function waitingStatusBlock(onTheWayLabel) {
    if (someoneAvailable()) {
      return '<div class="status"><i></i><span>' + esc(onTheWayLabel) + "</span></div>";
    }
    return unavailableCall();
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

  function routeKey(a, b) {
    return a.lat.toFixed(5) + "," + a.lng.toFixed(5) + ">" + b.lat.toFixed(5) + "," + b.lng.toFixed(5);
  }

  function routeStillOnScreen() {
    if (ROLE === "customer") return state.screen === "waiting" || state.screen === "trip";
    return state.screen === "trip" || (state.screen === "home" && !!state.pickupStreet);
  }

  function ensureDrivingRoute(a, b) {
    if (!a || !b) return;
    var key = routeKey(a, b);
    if (driving.key === key && driving.done) return;
    if (driving.pending === key) return;
    driving.pending = key;
    var url = "https://router.project-osrm.org/route/v1/driving/" +
      a.lng + "," + a.lat + ";" + b.lng + "," + b.lat +
      "?overview=full&geometries=geojson";
    fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      var route = data && data.routes && data.routes[0];
      var coords = route && route.geometry && route.geometry.coordinates;
      if (!route || !coords || !coords.length || !isFinite(+route.distance)) throw new Error("osrm");
      if (driving.pending !== key && driving.key !== key) return;
      driving.key = key;
      driving.pending = "";
      driving.done = true;
      driving.miles = Math.round((+route.distance / 1609.344) * 100) / 100;
      driving.line = coords.map(function (pair) { return [pair[1], pair[0]]; });
      var pickup = placeCoords("pickup");
      var dropoff = placeCoords("drop");
      if (routeStillOnScreen() && pickup && dropoff && routeKey(pickup, dropoff) === key) render();
    }).catch(function () {
      if (driving.pending !== key && driving.key !== key) return;
      driving.key = key;
      driving.pending = "";
      driving.done = true;
      driving.miles = null;
      driving.line = null;
    });
  }

  function routeLatLngs(a, b) {
    if (!a || !b) return [];
    ensureDrivingRoute(a, b);
    var key = routeKey(a, b);
    if (driving.key === key && driving.line && driving.line.length > 1) return driving.line;
    return [[a.lat, a.lng], [b.lat, b.lng]];
  }

  function drivenPathMiles() {
    var path = state.tripPath || [];
    if (path.length < 2) return null;
    var sum = 0;
    var i;
    for (i = 1; i < path.length; i += 1) {
      sum += haversine(path[i - 1], path[i]);
    }
    return Math.round(sum * 100) / 100;
  }

  function recordTripPoint(lat, lng) {
    if (!isCoord(lat) || !isCoord(lng)) return;
    if (state.rideStatus !== "started") return;
    var point = { lat: +lat, lng: +lng };
    var path = state.tripPath || [];
    var last = path.length ? path[path.length - 1] : null;
    if (last && haversine(last, point) < 0.03) return;
    path.push(point);
    if (path.length > 400) path = path.slice(path.length - 400);
    state.tripPath = path;
  }

  function tripMiles() {
    var pickup = placeCoords("pickup");
    var dropoff = placeCoords("drop");
    if (!pickup || !dropoff) return { raw: 0, billed: 0, ready: false };
    var driven = drivenPathMiles();
    var hundredths;
    if (state.useDrivenMiles && driven != null) {
      hundredths = driven;
    } else {
      var key = routeKey(pickup, dropoff);
      if (driving.key === key && driving.done && driving.miles != null) hundredths = driving.miles;
      else {
        hundredths = Math.round(haversine(pickup, dropoff) * 100) / 100;
        if (!(driving.key === key && driving.done)) ensureDrivingRoute(pickup, dropoff);
      }
      // If the car drove farther than the planned route (extension / detour), bill the driven path.
      if ((state.rideStatus === "started" || state.rideStatus === "completed") && driven != null && driven > hundredths) {
        hundredths = driven;
      }
    }
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

  var busyCache = null;

  function pickupInstant() {
    var ymd = (state.date || "").split("-");
    var hm = (state.time || "").split(":");
    return new Date(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]), Number(hm[0]), Number(hm[1] || 0), 0, 0);
  }

  function rideHitsBusy(windows) {
    var start = pickupInstant().getTime();
    var end = start + 60 * 60 * 1000;
    if (!windows || isNaN(start)) return false;
    for (var i = 0; i < windows.length; i++) {
      var win = windows[i] || {};
      var winStart = new Date(win.start).getTime();
      var winEnd = new Date(win.end).getTime();
      if (isNaN(winStart) || isNaN(winEnd)) continue;
      if (start < winEnd && winStart < end) return true;
    }
    return false;
  }

  function loadBusyWindows() {
    if (busyCache) return Promise.resolve(busyCache);
    return fetch("busy.json").then(function (res) {
      if (!res.ok) throw new Error("busy");
      return res.json();
    }).then(function (data) {
      busyCache = data && data.windows ? data.windows : [];
      return busyCache;
    });
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

  function fareSnapshot() {
    var est = estimate();
    if (!est.ready) return null;
    return {
      billedMiles: est.billed,
      rawMiles: est.raw,
      fareSub: est.sub,
      fareTax: est.tax,
      fareTotal: est.total
    };
  }

  function cancelFeeCents() {
    var est = estimate();
    var pct = est.ready ? Math.round(est.total * 0.25) : 0;
    var floor = 1000; // $10.00
    return Math.max(pct, floor);
  }

  function paymentHoldCopy() {
    return (
      '<div class="card">' +
      '<p class="tag">Card on file · charged after the ride</p>' +
      '<p class="lede">Add your card before the ride. You are not charged until after drop-off, so you can add a tip.</p>' +
      '<p class="fine">A real card hold uses Square on a secure server or Square payment link. This starter never stores a card number or Square secret.</p>' +
      '<button class="btn secondary" type="button" id="square-hold-btn">Continue to Square (card setup)</button>' +
      '<p class="fine" id="square-hold-help"></p>' +
      "</div>"
    );
  }

  function cancelWarningCopy() {
    var fee = cancelFeeCents();
    return (
      "If you cancel before pickup, you will be charged " + money(fee) +
      " (25% of the estimate or $10, whichever is more)."
    );
  }

  var SQUARE_CARD_SETUP_URL = "https://squareup.com/appointments/book/L077DQHSNJAG6";

  function openSquareCardSetup() {
    var help = document.getElementById("square-hold-help");
    if (!SQUARE_CARD_SETUP_URL) {
      if (help) help.textContent = "Square card setup link is not configured yet. A real hold needs a server or Square payment link.";
      return;
    }
    if (help) help.textContent = "Opening Square for card setup. You are not charged until after the ride.";
    window.open(SQUARE_CARD_SETUP_URL, "_blank", "noopener,noreferrer");
  }

  function openTurnByTurnToDrop() {
    var drop = placeCoords("drop");
    if (!drop) return false;
    var dest = (+drop.lat) + "," + (+drop.lng);
    var ua = navigator.userAgent || "";
    var ios = /iPhone|iPad|iPod/i.test(ua);
    var url = ios
      ? "https://maps.apple.com/?daddr=" + encodeURIComponent(dest) + "&dirflg=d"
      : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest) + "&travelmode=driving";
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  function completeActiveRide(opts) {
    opts = opts || {};
    if (ROLE !== "driver") return;
    if (state.rideStatus !== "started" && state.rideStatus !== "accepted") return;
    if (opts.endHere && isCoord(state.hereLat) && isCoord(state.hereLng)) {
      recordTripPoint(state.hereLat, state.hereLng);
      state.dropLat = +state.hereLat;
      state.dropLng = +state.hereLng;
      state.dropFix = { lat: +state.hereLat, lng: +state.hereLng };
      if (!state.dropStreet) state.dropStreet = "Ended at current location";
      state.endedEarly = true;
      state.useDrivenMiles = true;
      driving.key = "";
      driving.done = false;
      driving.miles = null;
      driving.line = null;
    }
    state.rideStatus = "completed";
    syncActiveTripFare({ status: "completed" });
    var code = state.driverCode || state.code || readDriverCode();
    if (syncOn() && code) deleteOpenRide(code).catch(function () {});
    state.screen = "trip";
    render();
  }

  function cancelRiderRide() {
    if (ROLE !== "customer") return;
    if (state.rideStatus === "started" || state.rideStatus === "completed") return;
    if (state.rideStatus !== "requested" && state.rideStatus !== "accepted") return;
    var msg = cancelWarningCopy() + "\n\nCancel this ride?";
    if (!window.confirm(msg)) return;
    var fee = cancelFeeCents();
    var code = state.code;
    if (syncOn() && code) {
      patchRide(code, { status: "cancelled", cancelFeeCents: fee, cancelledBy: "rider" }).catch(function () {});
      deleteOpenRide(code).catch(function () {});
    }
    try { localStorage.removeItem(STORE); } catch (err) {}
    writeRideOwner("");
    clearRideFields();
    state.screen = "home";
    render();
  }

  function syncActiveTripFare(extra) {
    if (ROLE !== "driver") return;
    if (state.rideStatus !== "started" && state.rideStatus !== "completed") return;
    var status = state.rideStatus;
    saveRide(status);
    var code = state.driverCode || state.code || readDriverCode();
    if (!syncOn() || !code) return;
    var patch = {
      status: status,
      dropStreet: state.dropStreet,
      dropCity: state.dropCity,
      dropState: state.dropState,
      dropLat: state.dropLat,
      dropLng: state.dropLng
    };
    var snap = fareSnapshot();
    if (snap) {
      patch.billedMiles = snap.billedMiles;
      patch.rawMiles = snap.rawMiles;
      patch.fareSub = snap.fareSub;
      patch.fareTax = snap.fareTax;
      patch.fareTotal = snap.fareTotal;
    }
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (k) { patch[k] = extra[k]; });
    }
    patchRide(code, patch).catch(function () {});
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
      routeLatLngs(route.pickup, route.dropoff).forEach(function (ll) {
        lats.push(ll[0]);
        lngs.push(ll[1]);
      });
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
    state[prefix + "Street"] = streetEl ? streetEl.value : placeLine(p);
    if (cityEl) state[prefix + "City"] = cityEl.value;
    if (stateEl) state[prefix + "State"] = stateEl.value;
    setCoords(prefix, feature);
    if (prefix === "drop") {
      state.dropFix = pointFrom(state.dropLat, state.dropLng);
      state.useDrivenMiles = false;
      state.endedEarly = false;
      driving.key = "";
      driving.done = false;
      driving.miles = null;
      driving.line = null;
      if (ROLE === "driver" && state.rideStatus === "started") {
        syncActiveTripFare();
        render();
      }
    }
  }


  var CITY_BIAS = {
    montgomery: { lat: 30.39, lon: -95.70 },
    conroe: { lat: 30.31, lon: -95.46 },
    "the woodlands": { lat: 30.17, lon: -95.46 },
    woodlands: { lat: 30.17, lon: -95.46 },
    magnolia: { lat: 30.21, lon: -95.75 },
    tomball: { lat: 30.10, lon: -95.62 },
    spring: { lat: 30.08, lon: -95.42 },
    humble: { lat: 30.00, lon: -95.26 },
    "new caney": { lat: 30.15, lon: -95.22 },
    porter: { lat: 30.11, lon: -95.23 },
    navasota: { lat: 30.39, lon: -96.09 }
  };
  var FALLBACK_BIAS = { lat: 30.05, lon: -95.4 };
  var KNOWN_CITIES = [
    "the woodlands", "new caney", "montgomery", "conroe", "magnolia", "tomball",
    "spring", "humble", "porter", "navasota", "willis", "houston"
  ];

  function normText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function hasWord(text, word) {
    if (!word) return false;
    return (" " + normText(text) + " ").indexOf(" " + word + " ") !== -1;
  }

  function biasFor(city) {
    var key = normText(city);
    if (CITY_BIAS[key]) return CITY_BIAS[key];
    return FALLBACK_BIAS;
  }

  function cityFromText(text) {
    var hay = " " + normText(text) + " ";
    var found = "";
    var i;
    for (i = 0; i < KNOWN_CITIES.length; i += 1) {
      if (hay.indexOf(" " + KNOWN_CITIES[i] + " ") !== -1 && KNOWN_CITIES[i].length > found.length) found = KNOWN_CITIES[i];
    }
    return found;
  }

  function focusTokens(text, city) {
    var skip = {
      on: 1, the: 1, a: 1, an: 1, at: 1, in: 1, of: 1, and: 1, near: 1, to: 1,
      tx: 1, texas: 1, rd: 1, road: 1, st: 1, street: 1, dr: 1, drive: 1,
      ln: 1, lane: 1, ave: 1, avenue: 1, blvd: 1, boulevard: 1, ct: 1, court: 1,
      cir: 1, circle: 1, pkwy: 1, parkway: 1, hwy: 1, highway: 1, fwy: 1,
      freeway: 1, way: 1, trl: 1, trail: 1, loop: 1
    };
    normText(city).split(" ").forEach(function (w) { if (w) skip[w] = 1; });
    return normText(text).split(" ").filter(function (w) {
      return w.length > 2 && !skip[w];
    });
  }

  function looksLikeAddress(text) {
    return /^\s*\d+\s+/.test(String(text || ""));
  }

  function sameCity(props, city) {
    var want = normText(city);
    var got = normText(props.city || props.town || props.village || "");
    return !!want && !!got && got === want;
  }

  function featurePoint(feature) {
    var coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords || !isCoord(coords[0]) || !isCoord(coords[1])) return null;
    return { lat: +coords[1], lng: +coords[0] };
  }

  function scoreFeature(feature, text, city) {
    var props = feature.properties || {};
    var tokens = focusTokens(text, city);
    var name = props.name || "";
    var street = [props.housenumber, props.street].filter(Boolean).join(" ");
    var osmValue = String(props.osm_value || "").toLowerCase();
    var osmKey = String(props.osm_key || "").toLowerCase();
    var score = 0;
    var i;
    for (i = 0; i < tokens.length; i += 1) {
      var weight = i === 0 ? 14 : 6;
      if (hasWord(name, tokens[i])) score += weight;
      if (hasWord(street, tokens[i])) score += 4;
    }
    if (city) {
      if (sameCity(props, city)) score += 12;
      else if (normText(props.city || props.town || props.village || "")) score -= 10;
      else score -= 3;
    }
    var q = normText(text);
    var inCity = !city || sameCity(props, city);
    if (q.indexOf("walmart") !== -1) {
      if (inCity && (osmValue === "supermarket" || hasWord(name, "walmart"))) score += 28;
      if (osmValue === "golf_course" || osmKey === "leisure") score -= 36;
      if (osmKey === "highway" || osmValue === "residential" || osmValue === "neighbourhood" || osmValue === "neighborhood" || osmValue === "suburb") score -= 24;
    }
    if (tokens.length && hasWord(name, tokens[0])) {
      if (osmValue === "supermarket" || osmValue === "department_store" || osmValue === "mall") score += 8;
      if (osmValue === "fuel" && q.indexOf("gas") === -1 && q.indexOf("fuel") === -1) score -= 4;
    }
    if (tokens.length && !hasWord(name, tokens[0]) && !hasWord(street, tokens[0])) {
      if (osmKey === "leisure" || osmKey === "highway" || osmKey === "place") score -= 16;
    }
    var point = featurePoint(feature);
    if (point) {
      var bias = biasFor(city);
      score -= Math.min(haversine(point, { lat: bias.lat, lng: bias.lon }), 80) * 0.2;
    }
    return score;
  }

  function rankFeatures(features, text, city) {
    var seen = {};
    var ranked = [];
    (features || []).forEach(function (feature) {
      var props = feature.properties || {};
      var point = featurePoint(feature);
      var id = String(props.osm_id || "") + "|" + normText(props.name) + "|" +
        (point ? point.lat.toFixed(5) + "," + point.lng.toFixed(5) : "");
      if (seen[id]) return;
      seen[id] = 1;
      ranked.push(feature);
      feature._score = scoreFeature(feature, text, city);
    });
    ranked.sort(function (a, b) { return b._score - a._score; });
    return ranked;
  }

  function composeQuery(text, city, stateName) {
    var parts = [];
    var base = String(text || "").trim();
    if (base) parts.push(base);
    var low = base.toLowerCase();
    if (city && low.indexOf(String(city).toLowerCase()) === -1) parts.push(city);
    var st = String(stateName || "TX").trim();
    if (st && low.indexOf(st.toLowerCase()) === -1) parts.push(st);
    if (low.indexOf("texas") === -1 && st.toUpperCase() === "TX") parts.push("Texas");
    return parts.filter(Boolean).join(", ");
  }

  function photonSearch(q, bias) {
    var url = "https://photon.komoot.io/api/?limit=8&lat=" + bias.lat + "&lon=" + bias.lon + "&q=" + encodeURIComponent(q);
    return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      return (data && data.features) || [];
    }).catch(function () { return []; });
  }

  function placeQueryCity(text, city) {
    return city || cityFromText(text) || "";
  }

  function collectPlaces(text, city, stateName) {
    var usedCity = placeQueryCity(text, city);
    var bias = biasFor(usedCity);
    var query = composeQuery(text, usedCity, stateName || "TX");
    return photonSearch(query, bias).then(function (features) {
      var tokens = focusTokens(text, usedCity);
      var first = tokens[0];
      if (!first || looksLikeAddress(text)) return features;
      var named = features.some(function (feature) {
        var props = feature.properties || {};
        return hasWord(props.name, first) || hasWord(props.street, first);
      });
      if (named) return features;
      return photonSearch(composeQuery(first, usedCity, stateName || "TX"), bias).then(function (more) {
        return features.concat(more);
      });
    });
  }

  function typedCity(prefix) {
    var el = document.getElementById(prefix + "-city");
    if (el && el.value.trim()) return el.value.trim();
    return state[prefix + "City"] || "";
  }

  function typedState(prefix) {
    var el = document.getElementById(prefix + "-state");
    if (el && el.value.trim()) return el.value.trim();
    return state[prefix + "State"] || "TX";
  }

  function placeLooksWeak(saved, feature, text, city) {
    var next = featurePoint(feature);
    if (!saved || !next) return false;
    if (haversine(saved, next) < 0.35) return false;
    var props = feature.properties || {};
    var tokens = focusTokens(text, city);
    var name = props.name || "";
    var osmValue = String(props.osm_value || "").toLowerCase();
    var q = normText(text);
    if (q.indexOf("walmart") !== -1) {
      return (osmValue === "supermarket" || hasWord(name, "walmart")) && (!city || sameCity(props, city));
    }
    if (city && normText(props.city || props.town || props.village || "") && !sameCity(props, city)) return false;
    return tokens.some(function (word) { return hasWord(name, word) || hasWord(props.street, word); });
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
      if (prefix === "drop") state.dropFix = null;
      if (prefix === "pickup") state.pickupFromHere = false;
      clearTimeout(timer);
      if (q.length < 3) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      timer = setTimeout(function () {
        var city = typedCity(prefix);
        var stateName = typedState(prefix);
        collectPlaces(q, city, stateName).then(function (features) {
          var ranked = rankFeatures(features, q, placeQueryCity(q, city)).slice(0, 5);
          if (input.value.trim() !== q || !ranked.length) {
            box.hidden = true;
            return;
          }
          box._places = ranked;
          box.innerHTML = ranked.map(function (f, i) {
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
          state.pickupLat = pos.coords.latitude;
          state.pickupLng = pos.coords.longitude;
          state.pickupFromHere = true;
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

  function makeRidePin() {
    var n;
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint16Array(1);
      window.crypto.getRandomValues(buf);
      n = buf[0] % 10000;
    } else {
      n = Math.floor(Math.random() * 10000);
    }
    return String(n).padStart(4, "0");
  }

  function normalizeStoredPin(value) {
    var digits = String(value == null ? "" : value).replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length > 4) digits = digits.slice(-4);
    return digits.padStart(4, "0");
  }

  function ensureRidePin() {
    var pin = normalizeStoredPin(state.pin);
    if (pin) {
      state.pin = pin;
      return pin;
    }
    var local = currentRide();
    pin = normalizeStoredPin(local && local.pin);
    if (!pin) pin = makeRidePin();
    state.pin = pin;
    if (state.rideStatus === "requested" || state.rideStatus === "accepted" || state.rideStatus === "started") {
      saveRide(state.rideStatus || "requested");
      if (syncOn() && state.code) {
        patchRide(state.code, { pin: pin }).catch(function () {});
      }
    }
    return pin;
  }

  function normalizeCode(raw) {
    return String(raw || "").toUpperCase().replace(/\s+/g, "");
  }

  function normalizePin(raw) {
    return String(raw || "").replace(/\D/g, "").slice(0, 4);
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

  function openIndexUrl(code) {
    if (code) {
      return databaseURL() + "/rides/" + encodeURIComponent(OPEN_HUB) + "/" + encodeURIComponent(code) + ".json";
    }
    return databaseURL() + "/rides/" + encodeURIComponent(OPEN_HUB) + ".json";
  }

  function driversUrl(id) {
    if (id) {
      return databaseURL() + "/rides/" + encodeURIComponent(PRESENCE_HUB) + "/drivers/" + encodeURIComponent(id) + ".json";
    }
    return databaseURL() + "/rides/" + encodeURIComponent(PRESENCE_HUB) + "/drivers.json";
  }

  function driverPresenceId() {
    var session = readSession() || "driver";
    var id = String(session).toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "");
    return (id || "driver").slice(0, 48);
  }

  function refusalUrl(id) {
    return databaseURL() + "/refusals/" + encodeURIComponent(id) + ".json";
  }

  function openSummaryFromRide(code, ride) {
    return {
      code: code,
      status: (ride && ride.status) || "requested",
      name: (ride && ride.name) || "",
      phone: (ride && ride.phone) || "",
      pickupStreet: (ride && ride.pickupStreet) || "",
      pickupCity: (ride && ride.pickupCity) || "",
      pickupState: (ride && ride.pickupState) || "TX",
      dropStreet: (ride && ride.dropStreet) || "",
      dropCity: (ride && ride.dropCity) || "",
      dropState: (ride && ride.dropState) || "TX",
      date: (ride && ride.date) || "",
      time: (ride && ride.time) || "",
      pickupLat: ride ? ride.pickupLat : null,
      pickupLng: ride ? ride.pickupLng : null,
      dropLat: ride ? ride.dropLat : null,
      dropLng: ride ? ride.dropLng : null,
      updatedAt: Date.now()
    };
  }

  function putOpenRide(code, ride) {
    if (!syncOn() || !code) return Promise.resolve();
    return fetch(openIndexUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(openSummaryFromRide(code, ride))
    }).then(function (res) {
      if (!res.ok) throw new Error("open");
      return res.text().then(function () {});
    });
  }

  function deleteOpenRide(code) {
    if (!syncOn() || !code) return Promise.resolve();
    return fetch(openIndexUrl(code), { method: "DELETE" }).then(function (res) {
      if (!res.ok && res.status !== 404) throw new Error("open");
      return res.text().then(function () {});
    });
  }

  function listOpenRides() {
    if (!syncOn()) return Promise.resolve([]);
    return fetch(openIndexUrl()).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("open-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("open");
      return res.text().then(function (text) {
        if (!text || text === "null") return [];
        var data;
        try { data = JSON.parse(text); } catch (e) { return []; }
        if (!data || typeof data !== "object") return [];
        var out = [];
        Object.keys(data).forEach(function (code) {
          var row = data[code];
          if (!row || typeof row !== "object") return;
          if (row.kind === "driver" || row.kind === "driverPresence") return;
          if (code === "drivers") return;
          if ((row.status || "requested") !== "requested") return;
          if (!isCoord(row.pickupLat) || !isCoord(row.pickupLng)) return;
          if (!row.code) row.code = code;
          out.push(row);
        });
        out.sort(function (a, b) {
          return String(a.date || "").localeCompare(String(b.date || "")) ||
            String(a.time || "").localeCompare(String(b.time || ""));
        });
        return out;
      });
    });
  }

  function makeRefusalId() {
    var t = Date.now().toString(36).toUpperCase();
    var rand = "";
    var i;
    for (i = 0; i < 4; i += 1) rand += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return t + rand;
  }

  function buildRefusalRecord(ride, driverAccount) {
    var est = estimate();
    return {
      deniedAt: new Date().toISOString(),
      notifyEmail: "mwragge@privatetaxiservices.net",
      situation: "Driver denied this open ride request",
      rideCode: (ride && ride.code) || state.code || state.selectedOpenCode || "",
      driverName: (driverAccount && driverAccount.name) || state.driverName || "",
      driverPhone: (driverAccount && driverAccount.phone) || state.driverPhone || "",
      driverEmail: (driverAccount && driverAccount.email) || "",
      customerName: (ride && ride.name) || state.name || "",
      customerPhone: (ride && ride.phone) || state.phone || "",
      pickup: pickupLine(),
      dropoff: dropLine(),
      when: prettyWhen(),
      date: state.date || (ride && ride.date) || "",
      time: state.time || (ride && ride.time) || "",
      miles: est.ready ? est.raw : null,
      billedMiles: est.ready ? est.billed : null,
      fareBeforeTax: est.ready ? est.sub : null,
      estimatedTotal: est.ready ? est.total : null,
      needsEmail: true
    };
  }

  function postRefusal(record) {
    if (!syncOn() || !record) return Promise.resolve({ ok: false, reason: "no-sync" });
    var id = makeRefusalId();
    return fetch(refusalUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record)
    }).then(function (res) {
      if (!res.ok) throw new Error("refusal");
      return res.text().then(function () { return { ok: true, id: id }; });
    });
  }

  function publishDriverPresence() {
    if (!syncOn() || ROLE !== "driver" || !signedIn()) return Promise.resolve();
    var account = readDriverAccount() || {};
    var body = {
      online: true,
      at: Date.now(),
      name: account.name || state.driverName || "",
      phone: account.phone || state.driverPhone || "",
      lat: isCoord(state.hereLat) ? +state.hereLat : null,
      lng: isCoord(state.hereLng) ? +state.hereLng : null
    };
    return fetch(driversUrl(driverPresenceId()), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("presence");
      return res.text().then(function () {});
    }).catch(function () {});
  }

  function clearDriverPresence() {
    if (!syncOn() || ROLE !== "driver") return Promise.resolve();
    return fetch(driversUrl(driverPresenceId()), { method: "DELETE" }).catch(function () {});
  }

  function listOnlineDrivers() {
    if (!syncOn()) return Promise.resolve([]);
    return fetch(driversUrl()).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error("drivers-denied");
        err.denied = true;
        throw err;
      }
      if (!res.ok) throw new Error("drivers");
      return res.text().then(function (text) {
        if (!text || text === "null") return [];
        var data;
        try { data = JSON.parse(text); } catch (e) { return []; }
        if (!data || typeof data !== "object") return [];
        var cutoff = Date.now() - 2 * 60 * 1000;
        var out = [];
        Object.keys(data).forEach(function (id) {
          var row = data[id];
          if (!row || typeof row !== "object") return;
          if (row.online === false) return;
          if (Number(row.at || 0) < cutoff) return;
          row.id = id;
          out.push(row);
        });
        return out;
      });
    });
  }

  function refreshOnlineDrivers() {
    if (ROLE !== "customer" || !signedIn()) return;
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    listOnlineDrivers().then(function (drivers) {
      var stamp = drivers.map(function (d) { return (d.id || "") + ":" + (d.at || ""); }).join("|");
      var changed = stamp !== state.onlineStamp;
      state.onlineStamp = stamp;
      state.onlineDrivers = drivers;
      if (changed) render();
    }).catch(function () {
      /* presence index may be blocked until rules allow /drivers */
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
      var openSource = latest && latest.code === code ? latest : created;
      putOpenRide(code, openSource).catch(function () {});
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
    patchRide(state.code, patch).then(function () {
      var latest = currentRide() || {};
      Object.keys(patch).forEach(function (k) { latest[k] = patch[k]; });
      if (!latest.code) latest.code = state.code;
      putOpenRide(state.code, latest).catch(function () {});
    }).catch(function () {});
  }

  function maybePatchDriverLocation() {
    if (!syncOn() || ROLE !== "driver" || state.screen !== "trip") return;
    if (state.rideStatus === "completed" || state.rideStatus === "cancelled") return;
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

  function riderPinBanner() {
    var pin = ensureRidePin();
    if (!pin) return "";
    return (
      '<div class="pin-box">' +
      '<p class="ride-pin-label">Give your driver this PIN when they arrive</p>' +
      '<p class="ride-pin">' + esc(pin) + "</p>" +
      '<p class="fine">They find your ride on the map. This PIN only starts the trip.</p>' +
      "</div>"
    );
  }

  function driverProfileLink() {
    return '<p class="fine"><a href="signup/">Profile</a></p>';
  }

  function selectedOpenRide() {
    var code = state.selectedOpenCode;
    if (!code) return null;
    var i;
    for (i = 0; i < state.openRides.length; i += 1) {
      if (state.openRides[i].code === code) return state.openRides[i];
    }
    return null;
  }

  function openRideCard() {
    if (!state.selectedOpenCode || !state.pickupStreet) return "";
    var est = estimate();
    return (
      '<article class="card open-ride-card" id="open-ride-card">' +
      '<p class="tag">Open request</p>' +
      '<div class="who">' + photoImg(state.riderPhoto) +
      "<div>" +
      '<h2 style="font-size:18px">' + esc(state.name || "Rider") + "</h2>" +
      '<p class="fine">' + esc(prettyWhen()) + (state.phone ? " · " + esc(state.phone) : "") + "</p>" +
      "</div></div>" +
      '<div class="route-line"><p>' + esc(pickupLine()) + "</p><p>" + esc(dropLine()) + "</p></div>" +
      '<p class="fine">' + (est.ready
        ? est.raw.toFixed(2) + " mi, billed as " + est.billed + " · about " + money(est.total)
        : "Miles and fare show when both places are found.") + "</p>" +
      commissionLine() +
      '<div class="row-actions">' +
      '<button class="btn" type="button" id="accept-ride">Accept</button>' +
      '<button class="btn secondary" type="button" id="deny-ride">Deny</button>' +
      "</div></article>"
    );
  }

  function driverBoardStatusInner() {
    if (state.openListLoading && !state.openRides.length) {
      return "Looking for open rides…";
    }
    if (state.openListError === "open-denied") {
      return "Open rides could not load. The map still shows your area.";
    }
    if (state.openListError) {
      return "Could not load open rides right now. Trying again…";
    }
    if (!state.openRides.length) {
      return "No open rides right now. New rider requests show up on this map.";
    }
    return state.openRides.length +
      (state.openRides.length === 1 ? " open ride" : " open rides") +
      ". Tap a rider pin to review.";
  }

  function driverBoardStatus() {
    return '<p class="lede" id="board-status">' + esc(driverBoardStatusInner()) + "</p>";
  }

  function ingestCustomerRide(ride) {
    if (!ride) return;
    var statusChanged = (ride.status || "") !== (state.rideStatus || "");
    var nextDrop = keptDropFromRide(ride);
    var placesChanged = coordNum(ride.pickupLat) !== coordNum(state.pickupLat) ||
      coordNum(ride.pickupLng) !== coordNum(state.pickupLng) ||
      coordNum(nextDrop && nextDrop.lat) !== coordNum(state.dropLat) ||
      coordNum(nextDrop && nextDrop.lng) !== coordNum(state.dropLng);
    var driverChanged = coordNum(ride.driverLat) !== coordNum(state.driverLat) ||
      coordNum(ride.driverLng) !== coordNum(state.driverLng);
    var codeChanged = !!(ride.code && ride.code !== state.code);
    var identityChanged = (ride.driverName || "") !== (state.driverName || "") ||
      (ride.driverPhone || "") !== (state.driverPhone || "") ||
      safePhoto(ride.driverPhoto) !== safePhoto(state.driverPhoto);
    if (!statusChanged && !placesChanged && !driverChanged && !codeChanged && !identityChanged) return;
    var screen = state.screen;
    applyRide(ride);
    if (screen === "waiting" && (ride.status === "accepted" || ride.status === "started" || ride.status === "completed")) state.screen = "trip";
    if ((ride.status === "accepted" || ride.status === "started" || ride.status === "completed") && state.screen !== "trip") state.screen = "trip";
    var onlyDriver = !statusChanged && !placesChanged && !identityChanged && driverChanged && state.screen === screen;
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
      var local = currentRide() || {};
      var localPin = normalizeStoredPin(local.pin) || normalizeStoredPin(state.pin);
      if (localPin && !normalizeStoredPin(ride.pin)) ride.pin = localPin;
      if (!normalizeStoredPin(ride.pin)) {
        ride.pin = makeRidePin();
        if (syncOn() && code) patchRide(code, { pin: ride.pin }).catch(function () {});
      }
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


  function sessionKey() {
    return ROLE === "driver" ? "pcs-driver-session" : "pcs-rider-session";
  }

  function readSession() {
    try { return localStorage.getItem(sessionKey()) || ""; } catch (err) { return ""; }
  }

  function writeSession(username) {
    try {
      if (username) localStorage.setItem(sessionKey(), username);
      else localStorage.removeItem(sessionKey());
    } catch (err) {}
  }

  function signedIn() {
    return !!readSession();
  }

  function readRideOwner() {
    try { return localStorage.getItem(RIDE_OWNER) || ""; } catch (err) { return ""; }
  }

  function writeRideOwner(key) {
    try {
      if (key) localStorage.setItem(RIDE_OWNER, key);
      else localStorage.removeItem(RIDE_OWNER);
    } catch (err) {}
  }

  function rideBelongsToSession(ride) {
    if (!ride) return false;
    var session = readSession();
    if (!session) return false;
    var owner = readRideOwner();
    if (owner) return owner === session;
    // Legacy rides saved before owner stamping stay on this phone for the current session.
    return true;
  }

  function discardStoredRide() {
    try { localStorage.removeItem(STORE); } catch (err) {}
    writeRideOwner("");
    clearRideFields();
  }

  function maybeRestoreCustomerRide() {
    if (ROLE === "driver" || !signedIn()) return false;
    var savedRide = currentRide();
    if (!savedRide) return false;
    if (!rideBelongsToSession(savedRide)) {
      discardStoredRide();
      return false;
    }
    if (savedRide.pickupStreet && savedRide.dropStreet &&
        (savedRide.status === "requested" || savedRide.status === "accepted" ||
         savedRide.status === "started" || savedRide.status === "completed")) {
      if (savedRide.status !== "completed" && isPickupInPast(savedRide.date, savedRide.time)) {
        discardStoredRide();
        state.screen = "home";
        return false;
      }
      applyRide(savedRide);
      ensureRidePin();
      if (savedRide.status === "completed" || savedRide.status === "accepted" || savedRide.status === "started") {
        state.screen = "trip";
      } else {
        state.screen = "waiting";
      }
      return true;
    }
    return false;
  }

  function accountForRole() {
    return ROLE === "driver" ? readDriverAccount() : readRiderAccount();
  }

  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function welcomeSrc(file) {
    return (ROLE === "driver" ? "../" : "") + file;
  }

  function accountGate() {
    return (
      '<img class="welcome-logo" alt="Private Car Services" src="' + welcomeSrc(ROLE === "driver" ? "welcome-logo-driver.png" : "welcome-logo.png") + '">' +
      '<form id="login-form" autocomplete="off" novalidate>' +
      '<label for="login-email">Email</label>' +
      '<input id="login-email" name="email" type="email" autocapitalize="none" autocomplete="email" spellcheck="false" required>' +
      '<label for="login-pass">Password</label>' +
      '<input id="login-pass" name="password" type="password" autocomplete="current-password" required>' +
      '<p class="error" id="login-error" role="alert">' + esc(state.loginError || "") + "</p>" +
      '<button class="btn" type="submit">Log in</button>' +
      "</form>" +
      '<a class="btn secondary" href="signup/">Create an account</a>'
    );
  }

  function logoutLine() {
    return '<p class="fine"><button class="btn ghost" type="button" id="log-out">Log out</button></p>';
  }

  function customerHome() {
    if (isPickupInPast(state.date, state.time)) {
      state.date = "";
      state.time = "";
    }
    return (
      logoutLine() +
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
      field("ride-date", "Date", state.date, 'type="date" required min="' + chicagoParts(new Date()).date + '"') +
      '</div><div class="city">' +
      field("ride-time", "Time", state.time, 'type="time" required') +
      "</div></div></div>" +
      '<div class="group"><p class="group-title">Rider</p>' +
      field("rider-name", "Name", state.name, "required") +
      field("rider-phone", "Phone", state.phone, 'type="tel" inputmode="tel" required') +
      "</div>" +
      '<p class="note">Miles round up to the next whole mile. Texas tax is 8.25% and is estimate-only, not a charge.</p>' +
      paymentHoldCopy() +
      '<p class="fine">Cancel before pickup: you will be charged 25% of the estimate or $10, whichever is more.</p>' +
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
      '<p class="tag">' + (state.rideStatus === "completed" ? "Final fare · not a charge" : "Estimate only · not a charge") + "</p>" +
      '<div class="money-row"><span>Miles</span><span>' + est.raw.toFixed(2) + " mi, billed as " + est.billed + " (rounded up)</span></div>" +
      '<div class="money-row"><span>Fare before tax</span><span>' + money(est.sub) + "</span></div>" +
      '<div class="money-row"><span>Texas tax 8.25%</span><span>' + money(est.tax) + "</span></div>" +
      '<div class="total-row"><span>' + (state.rideStatus === "completed" ? "Final total" : "Estimated total") + "</span><span>" + money(est.total) + "</span></div>" +
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
    var roadAttr = "";
    if (route.live) {
      roadAttr = routeLatLngs(route.pickup, route.dropoff).map(function (ll) {
        var pt = project({ lat: ll[0], lng: ll[1] });
        return pt.x + "," + pt.y;
      }).join(" ");
      if (roadAttr) roadAttr = start.x + "," + start.y + " " + roadAttr;
    }
    return (
      '<div class="map-stage">' +
      '<div id="live-map" role="img" aria-label="' + (route.live ? "Route map" : "Sample map") + '"></div>' +
      '<div class="illus" id="illus">' +
      illustratedMap(start, pickup, drop, roadAttr) +
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

  function illustratedMap(start, pickup, drop, roadAttr) {
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
      '<polyline points="' + (roadAttr || (start.x + "," + start.y + " " + pickup.x + "," + pickup.y + " " + drop.x + "," + drop.y)) +
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
    var road = both ? routeLatLngs(pickup, drop) : [];
    road.forEach(function (ll) { points.push({ lat: ll[0], lng: ll[1] }); });
    var illus = "";
    if (both) {
      var a = fitProject(pickup, points);
      var b = fitProject(drop, points);
      var poly = road.map(function (ll) {
        var pt = fitProject({ lat: ll[0], lng: ll[1] }, points);
        return pt.x + "," + pt.y;
      }).join(" ");
      var car = "";
      if (driverPoint) {
        var c = fitProject(driverPoint, points);
        car = '<div class="pin pin-car" id="pin-car" style="left:' + c.x + '%;top:' + c.y + '%"><div class="car-face" id="illus-car">' + CAR_SVG + "</div></div>";
      }
      illus = (
        '<div class="illus" id="illus">' +
        '<svg class="illus-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
        '<rect width="100" height="100" fill="#163455"/>' +
        '<polyline points="' + poly +
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
    var near = driverNearPickup();
    var started = state.rideStatus === "started";
    var completed = state.rideStatus === "completed";
    return (
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      (completed
        ? '<div class="status"><i></i><span>Ride complete</span></div>'
        : (started
          ? '<div class="status"><i></i><span>Ride started</span></div>'
          : waitingStatusBlock(near || state.driverName ? "Driver on the way" : "Drivers are available"))) +
      driverIdentityLine() +
      "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) + "<br>" + esc(prettyWhen()) + "</p>" +
      (started || completed ? "" : riderPinBanner()) +
      customerMapBlock(caption, driver) +
      moneyCard() +
      (completed
        ? '<div class="card"><p class="tag">Pay after the ride</p>' +
          '<p class="lede">Your card on file is charged after drop-off so you can add a tip. Nothing is charged on this starter screen.</p></div>'
        : "") +
      (state.rideStatus === "accepted"
        ? '<div class="card">' +
          '<p class="tag">Cancel before pickup</p>' +
          '<p class="lede">' + esc(cancelWarningCopy()) + "</p>" +
          '<button class="btn secondary" type="button" id="cancel-ride">Cancel ride</button>' +
          "</div>"
        : "") +
      (started
        ? '<p class="fine">This ride has started. Only your driver can complete or end it.</p>'
        : "") +
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
    var near = driverNearPickup();
    var waitLabel = near ? "Waiting for a driver" : (driversOnlineNow().length ? "Drivers are available" : "Waiting for a driver");
    var canCancel = state.rideStatus === "requested" || state.rideStatus === "accepted";
    return (
      '<button class="btn ghost" type="button" id="back-home">← Request</button>' +
      waitingStatusBlock(waitLabel) +
      driverIdentityLine() +
      "<p class=\"lede\">" + esc(pickupLine()) + " → " + esc(dropLine()) + "<br>" + esc(prettyWhen()) + "</p>" +
      riderPinBanner() +
      customerMapBlock(caption, driver) +
      moneyCard() +
      paymentHoldCopy() +
      '<p class="note">' + note + "</p>" +
      (canCancel
        ? '<div class="card">' +
          '<p class="tag">Cancel before pickup</p>' +
          '<p class="lede">' + esc(cancelWarningCopy()) + "</p>" +
          '<button class="btn secondary" type="button" id="cancel-ride">Cancel ride</button>' +
          "</div>"
        : "")
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
    if (ride.date && ride.time && isPickupInPast(ride.date, ride.time)) {
      state.date = "";
      state.time = "";
    } else {
      state.date = ride.date || state.date;
      state.time = ride.time || state.time;
    }
    state.rideStatus = ride.status || "";
    state.pickupLat = ride.pickupLat;
    state.pickupLng = ride.pickupLng;
    var keptDrop = keptDropFromRide(ride);
    state.dropLat = keptDrop ? keptDrop.lat : ride.dropLat;
    state.dropLng = keptDrop ? keptDrop.lng : ride.dropLng;
    state.driverLat = isCoord(ride.driverLat) ? +ride.driverLat : null;
    state.driverLng = isCoord(ride.driverLng) ? +ride.driverLng : null;
    state.driverName = ride.driverName || "";
    state.driverPhone = ride.driverPhone || "";
    state.riderPhoto = safePhoto(ride.riderPhoto);
    state.driverPhoto = safePhoto(ride.driverPhoto);
    if (ride.passengers != null) state.passengers = ride.passengers;
    if (ride.stops != null) state.stops = ride.stops;
    state.holiday = !!ride.holiday;
    if (ride.code) state.code = ride.code;
    var incomingPin = normalizeStoredPin(ride.pin);
    if (incomingPin) state.pin = incomingPin;
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
    var driverName = state.driverName || "";
    var driverPhone = state.driverPhone || "";
    var driverPhoto = safePhoto(state.driverPhoto);
    var riderPhoto = safePhoto(state.riderPhoto);
    if (clearDriver) {
      driverName = "";
      driverPhone = "";
      driverPhoto = "";
    } else {
      if (!driverName && prev.driverName) driverName = prev.driverName;
      if (!driverPhone && prev.driverPhone) driverPhone = prev.driverPhone;
      if (!driverPhoto) driverPhoto = safePhoto(prev.driverPhoto);
    }
    if (ROLE === "customer") {
      var riderAccount = readRiderAccount();
      var fromAccount = safePhoto(riderAccount && riderAccount.photo);
      if (fromAccount) riderPhoto = fromAccount;
    } else if (!riderPhoto) {
      riderPhoto = safePhoto(prev.riderPhoto);
    }
    state.driverName = driverName;
    state.driverPhone = driverPhone;
    state.driverPhoto = driverPhoto;
    state.riderPhoto = riderPhoto;
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
      driverName: driverName,
      driverPhone: driverPhone,
      driverPhoto: driverPhoto,
      riderPhoto: riderPhoto,
      passengers: ridePassengers(),
      stops: rideStops(),
      holiday: !!state.holiday
    };
    if (state.code) rideOut.code = state.code;
    var pinOut = normalizeStoredPin(state.pin);
    if (pinOut) {
      state.pin = pinOut;
      rideOut.pin = pinOut;
    }
    localStorage.setItem(STORE, JSON.stringify(rideOut));
    if (ROLE === "customer") writeRideOwner(readSession());
  }

  function clearRideFields() {
    state.name = "";
    state.phone = "";
    state.pickupStreet = "";
    state.pickupCity = "";
    state.dropStreet = "";
    state.dropCity = "";
    state.date = "";
    state.time = "";
    state.rideStatus = "";
    state.pickupLat = null;
    state.pickupLng = null;
    state.dropLat = null;
    state.dropLng = null;
    state.driverLat = null;
    state.driverLng = null;
    state.driverName = "";
    state.driverPhone = "";
    state.driverPhoto = "";
    state.riderPhoto = "";
    state.passengers = 2;
    state.stops = 0;
    state.holiday = false;
    state.code = "";
    state.pin = "";
    state.pinDraft = "";
    state.pinError = "";
    state.dropFix = null;
    state.pickupFromHere = false;
    state.tripPath = [];
    state.useDrivenMiles = false;
    state.endedEarly = false;
  }

  function keptDropFromRide(ride) {
    var incoming = pointFrom(ride && ride.dropLat, ride && ride.dropLng);
    if (state.dropFix && incoming && haversine(state.dropFix, incoming) > 0.25) return state.dropFix;
    return incoming;
  }

  function driverHome() {
    return (
      driverProfileLink() +
      logoutLine() +
      "<h2>Open requests</h2>" +
      driverBoardStatus() +
      '<div class="map-stage board-map">' +
      '<div id="live-map" role="img" aria-label="Open ride requests map"></div>' +
      '<p class="map-caption">You and open rider pickups</p>' +
      "</div>" +
      (isFinite(state.hereLat) ? "" : '<p class="fine">Allow location so the map can show where you are.</p>') +
      '<p class="legend"><span><i class="swatch"></i> You</span>' +
      '<span><i class="swatch you"></i> Rider pickup</span></p>' +
      openRideCard()
    );
  }

  function driverFareCard(finalLabel) {
    var est = estimate();
    if (!est.ready) {
      return (
        '<div class="card" id="driver-fare-card">' +
        '<p class="tag">' + (finalLabel || "Live fare") + "</p>" +
        '<p class="fine">Miles and fare update when the route is ready.</p></div>'
      );
    }
    return (
      '<div class="card" id="driver-fare-card">' +
      '<p class="tag">' + (finalLabel || "Live fare · updates with the trip") + "</p>" +
      '<div class="money-row"><span>Miles</span><span>' + est.raw.toFixed(2) + " mi, billed as " + est.billed + "</span></div>" +
      '<div class="money-row"><span>Fare before tax</span><span>' + money(est.sub) + "</span></div>" +
      '<div class="money-row"><span>Texas tax 8.25%</span><span>' + money(est.tax) + "</span></div>" +
      '<div class="total-row"><span>' + (finalLabel ? "Final total" : "Estimated total") + "</span><span>" + money(est.total) + "</span></div>" +
      commissionLine() +
      '<p class="fine">Miles round up. Tax is estimate-only, not a charge.</p></div>'
    );
  }

  function driverTrip() {
    var started = state.rideStatus === "started";
    var completed = state.rideStatus === "completed";
    var pinGate = "";
    var dropEditor = "";
    var completeBtn = "";
    var doneBlock = "";
    if (!started && !completed) {
      pinGate = (
        '<div class="card pin-gate">' +
        '<p class="tag">Start the ride</p>' +
        '<p class="lede">Ask the rider for their 4-digit PIN, then enter it here.</p>' +
        '<form id="start-pin-form" autocomplete="off">' +
        '<label for="start-pin">PIN</label>' +
        '<input id="start-pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" value="' +
        esc(state.pinDraft || "") + '">' +
        '<p class="error" id="pin-error" role="alert">' + esc(state.pinError || "") + "</p>" +
        '<button class="btn" type="submit">Start ride</button>' +
        "</form></div>"
      );
    }
    if (started) {
      dropEditor = (
        '<div class="card">' +
        '<p class="tag">Change drop-off</p>' +
        '<p class="lede">If the rider extends the trip or changes destination, update it here. Fare updates automatically.</p>' +
        locateField("drop-street", "Street", state.dropStreet, "drop-results", "") +
        '<div class="row"><div class="city">' +
        field("drop-city", "City", state.dropCity, "") +
        '</div><div class="state">' +
        field("drop-state", "State", state.dropState || "TX", 'maxlength="2"') +
        "</div></div>" +
        '<button class="btn secondary" type="button" id="end-here">End ride here</button>' +
        '<p class="fine">End ride here uses your current location as the final drop-off and recalculates the fare.</p>' +
        "</div>"
      );
      completeBtn = (
        '<button class="btn secondary" type="button" id="open-nav">Open turn-by-turn to drop-off</button>' +
        '<button class="btn" type="button" id="complete-ride">Ride complete</button>'
      );
    }
    if (completed) {
      doneBlock = (
        '<div class="card">' +
        '<p class="tag">Ride complete</p>' +
        '<p class="lede">This trip is finished. Location updates have stopped.</p>' +
        "<p><strong>Final drop-off</strong><br>" + esc(dropLine()) + "</p>" +
        "</div>" +
        driverFareCard("Final fare") +
        '<button class="btn secondary" type="button" id="back-driver">Back to requests</button>'
      );
    }
    var statusLabel = completed ? "Ride complete" : (started ? "Ride started" : "Heading to pickup");
    return (
      (completed ? "" : '<button class="btn ghost" type="button" id="back-driver">← Requests</button>') +
      '<div class="status"><i></i><span>' + statusLabel + "</span></div>" +
      '<div class="who">' + photoImg(state.riderPhoto) +
      "<p class=\"lede\">" + esc(state.name || "Rider") +
      (completed ? " · trip finished." : (started ? " · en route." : " is at " + esc(pickupLine()) + ".")) +
      "</p></div>" +
      (completed ? "" : mapBlock("Customer")) +
      pinGate +
      (started || completed ? "" : (
        '<div class="card"><p class="tag">This ride</p>' +
        "<p><strong>Drop-off</strong><br>" + esc(dropLine()) + "</p>" +
        commissionLine() +
        "<p class=\"fine\">" + esc(prettyWhen()) + ". Miles round up. Texas tax 8.25% stays estimate-only.</p></div>"
      )) +
      (started ? (
        '<div class="card"><p class="tag">This ride</p>' +
        "<p><strong>Pickup</strong><br>" + esc(pickupLine()) + "</p>" +
        "<p><strong>Drop-off</strong><br>" + esc(dropLine()) + "</p>" +
        "<p class=\"fine\">" + esc(prettyWhen()) + "</p></div>" +
        driverFareCard("") +
        dropEditor +
        completeBtn
      ) : "") +
      doneBlock
    );
  }

  function render() {
    var stayOnBoard = ROLE === "driver" && state.screen === "home" && signedIn();
    var keptBoard = null;
    if (stayOnBoard && boardMapStillMounted()) {
      keptBoard = document.querySelector(".map-stage.board-map");
      if (keptBoard && keptBoard.parentNode) {
        keptBoard.parentNode.removeChild(keptBoard);
      } else {
        keptBoard = null;
      }
    }
    if (keptBoard) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      motionStart = 0;
      if (tileTimer) clearTimeout(tileTimer);
      tileTimer = 0;
    } else {
      stopMotion();
      boardMapEl = null;
      state.boardMarkers = null;
    }
    var app = document.getElementById("app");
    var html = "";
    if (!signedIn()) html = accountGate();
    else if (ROLE === "driver" && state.screen === "home") html = driverHome();
    else if (ROLE === "driver") html = driverTrip();
    else if (state.screen === "waiting") html = customerWaiting();
    else if (state.screen === "trip") html = customerTrip();
    else html = customerHome();
    app.innerHTML = html;
    if (keptBoard) {
      var slot = app.querySelector(".map-stage.board-map");
      if (slot && slot.parentNode) {
        slot.parentNode.replaceChild(keptBoard, slot);
        setTimeout(function () {
          if (liveMap) liveMap.invalidateSize();
          syncDriverBoardMarkers();
        }, 60);
      } else {
        try { if (liveMap) liveMap.remove(); } catch (e) {}
        liveMap = null;
        carMarker = null;
        boardMapEl = null;
        state.boardMarkers = null;
        if (keptBoard.parentNode) keptBoard.parentNode.removeChild(keptBoard);
      }
    }
    bind();
    var customerRide = signedIn() && ROLE === "customer" && (state.screen === "waiting" || state.screen === "trip");
    if (!signedIn()) {
      /* stay on the login page */
    } else if (customerRide) {
      startCustomerMap();
      ensureCustomerCoords();
      refreshOnlineDrivers();
    } else if (ROLE === "driver" && state.screen === "home") {
      startDriverBoardMap();
    } else if (ROLE === "driver" && state.screen === "trip") {
      startMap();
    }
    if (ROLE === "driver" && state.screen === "trip" && state.pickupStreet) {
      var repairKey = (state.driverCode || state.code || "") + "|" + state.dropStreet;
      if (state.geocodeKey !== repairKey) {
        state.geocodeKey = repairKey;
        var beforeDrop = placeCoords("drop");
        var beforePick = placeCoords("pickup");
        geocodeMissing().then(function () {
          var after = placeCoords("drop");
          var moved = !!(after && beforeDrop && haversine(beforeDrop, after) >= 0.05);
          var filled = !!(!beforeDrop && after) || !!(!beforePick && placeCoords("pickup"));
          if (moved) {
            state.dropFix = { lat: +after.lat, lng: +after.lng };
            saveRide(state.rideStatus || "requested");
            var code = state.driverCode || state.code || readDriverCode();
            if (syncOn() && code) patchRide(code, { dropLat: +after.lat, dropLng: +after.lng }).catch(function () {});
          }
          if (moved || filled) render();
        });
      }
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
    var showLogin = document.getElementById("show-login");
    if (showLogin) {
      showLogin.addEventListener("click", function () {
        state.gateStep = "login";
        state.loginError = "";
        render();
      });
    }
    var gateBack = document.getElementById("gate-back");
    if (gateBack) {
      gateBack.addEventListener("click", function () {
        state.gateStep = "";
        state.loginError = "";
        render();
      });
    }
    var loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        state.loginError = "";
        var emailEl = document.getElementById("login-email");
        var passEl = document.getElementById("login-pass");
        var loginValue = emailEl ? emailEl.value.trim() : "";
        var loginEmail = loginValue.toLowerCase();
        var password = passEl ? passEl.value : "";
        var account = accountForRole();
        if (!account || (!account.email && !account.username) || !account.passwordHash) {
          state.loginError = "No account on this phone yet. Create one first.";
          render();
          return;
        }
        var emailMatches = account.email && loginEmail === String(account.email).trim().toLowerCase();
        var legacyUsernameMatches = account.username && loginEmail === String(account.username).trim().toLowerCase();
        if (!emailMatches && !legacyUsernameMatches) {
          state.loginError = "That email or password does not match the account on this phone.";
          render();
          return;
        }
        if (!window.crypto || !crypto.subtle) {
          state.loginError = "This browser cannot check the password. Try Safari or Chrome.";
          render();
          return;
        }
        sha256Hex(password).then(function (hex) {
          if (hex !== account.passwordHash) {
            state.loginError = "That email or password does not match the account on this phone.";
            render();
            return;
          }
          writeSession(account.email || account.username);
          state.loginError = "";
          state.gateStep = "";
          state.screen = "home";
          if (ROLE === "driver") {
            followGps();
            refreshOpenRides(true);
            publishDriverPresence();
          } else {
            maybeRestoreCustomerRide();
          }
          render();
        }).catch(function () {
          state.loginError = "Could not check the password on this phone.";
          render();
        });
      });
    }
    var logout = document.getElementById("log-out");
    if (logout) {
      logout.addEventListener("click", function () {
        if (ROLE === "driver") clearDriverPresence();
        writeSession("");
        state.loginError = "";
        state.gateStep = "";
        state.screen = "home";
        state.onlineDrivers = [];
        state.onlineStamp = "";
        render();
      });
    }
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
        if (isPickupInPast(state.date, state.time)) {
          state.error = "Pick a date and time that have not passed yet.";
          render();
          return;
        }
        function requestRide() {
          state.error = "";
          state.customerGeocodeTried = false;
          state.dropFix = null;
          state.driverLat = null;
          state.driverLng = null;
          state.code = syncOn() ? makeRideCode() : "";
          state.pin = makeRidePin();
          state.pinDraft = "";
          state.pinError = "";
          geocodeMissing().then(function () {
            saveRide("requested", { clearDriver: true });
            var created = currentRide();
            state.customerGeocodeTried = true;
            state.screen = "waiting";
            render();
            if (syncOn() && state.code && created) publishRide(state.code, created).catch(function () {});
          });
        }
        loadBusyWindows().then(function (windows) {
          if (rideHitsBusy(windows)) {
            state.error = "That time is already taken. Pick another time, or call 936-261-7878.";
            render();
            return;
          }
          requestRide();
        }).catch(function () {
          requestRide();
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
        state.selectedOpenCode = "";
        clearRideFields();
        writeDriverCode("");
        state.driverCode = "";
        render();
      });
    }
    var accept = document.getElementById("accept-ride");
    if (accept) {
      accept.addEventListener("click", function () {
        acceptSelectedOpenRide();
      });
    }
    var deny = document.getElementById("deny-ride");
    if (deny) {
      deny.addEventListener("click", function () {
        denySelectedOpenRide();
      });
    }
    var pinForm = document.getElementById("start-pin-form");
    if (pinForm) {
      pinForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = document.getElementById("start-pin");
        var entered = normalizePin(input ? input.value : "");
        state.pinDraft = entered;
        state.pinError = "";
        if (entered.length !== 4) {
          state.pinError = "Enter the 4-digit PIN from the rider.";
          render();
          return;
        }
        if (entered !== normalizeStoredPin(state.pin)) {
          state.pinError = "That PIN does not match. Ask the rider again.";
          render();
          return;
        }
        state.tripPath = [];
        state.useDrivenMiles = false;
        state.endedEarly = false;
        if (isCoord(state.hereLat) && isCoord(state.hereLng)) {
          recordTripPoint(state.hereLat, state.hereLng);
        }
        saveRide("started");
        var code = state.driverCode || state.code || readDriverCode();
        if (syncOn() && code) {
          syncActiveTripFare({ status: "started" });
        }
        state.pinDraft = "";
        state.pinError = "";
        state.screen = "trip";
        render();
        openTurnByTurnToDrop();
      });
    }
    var completeRide = document.getElementById("complete-ride");
    if (completeRide) {
      completeRide.addEventListener("click", function () {
        completeActiveRide();
      });
    }
    var endHere = document.getElementById("end-here");
    if (endHere) {
      endHere.addEventListener("click", function () {
        if (!isCoord(state.hereLat) || !isCoord(state.hereLng)) {
          state.error = "Allow location to end the ride here.";
          render();
          return;
        }
        completeActiveRide({ endHere: true });
      });
    }
    var openNav = document.getElementById("open-nav");
    if (openNav) {
      openNav.addEventListener("click", function () {
        if (!openTurnByTurnToDrop()) {
          state.error = "Drop-off location is not ready yet.";
          render();
        }
      });
    }
    var cancelRide = document.getElementById("cancel-ride");
    if (cancelRide) {
      cancelRide.addEventListener("click", function () {
        cancelRiderRide();
      });
    }
    var squareHold = document.getElementById("square-hold-btn");
    if (squareHold) {
      squareHold.addEventListener("click", function () {
        openSquareCardSetup();
      });
    }
    var preview = document.getElementById("preview-only");
    if (preview) preview.addEventListener("click", openPreview);
  }


  function geocodeQuery(text, city, stateName) {
    var usedCity = placeQueryCity(text, city);
    return collectPlaces(text, usedCity, stateName || "TX").then(function (features) {
      var ranked = rankFeatures(features, text, usedCity);
      return ranked[0] || null;
    }).catch(function () { return null; });
  }

  function ensureCustomerCoords() {
    if (ROLE !== "customer") return;
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    if (state.customerGeocodeTried) return;
    state.customerGeocodeTried = true;
    var beforeDrop = placeCoords("drop");
    var beforePick = placeCoords("pickup");
    geocodeMissing().then(function () {
      if (ROLE !== "customer") return;
      if (state.screen !== "waiting" && state.screen !== "trip") return;
      var after = placeCoords("drop");
      var moved = !!(after && (!beforeDrop || haversine(beforeDrop, after) >= 0.05));
      var filledPick = !!(!beforePick && placeCoords("pickup"));
      if (!moved && !filledPick) return;
      if (moved && after) state.dropFix = { lat: +after.lat, lng: +after.lng };
      saveRide(state.rideStatus || (state.screen === "trip" ? "accepted" : "requested"));
      if (moved && after && syncOn() && state.code) {
        patchRide(state.code, { dropLat: +after.lat, dropLng: +after.lng }).catch(function () {});
      } else if (filledPick) {
        pushPlaceCoords();
      }
      render();
    });
  }

  function geocodeMissing() {
    var jobs = [];
    if (state.pickupStreet && !state.pickupFromHere) {
      jobs.push(geocodeQuery(state.pickupStreet, state.pickupCity, state.pickupState).then(function (feature) {
        if (!feature) return;
        var saved = placeCoords("pickup");
        if (!saved || placeLooksWeak(saved, feature, state.pickupStreet, state.pickupCity)) setCoords("pickup", feature);
      }));
    }
    if (state.dropStreet) {
      jobs.push(geocodeQuery(state.dropStreet, state.dropCity, state.dropState).then(function (feature) {
        if (!feature) return;
        var saved = placeCoords("drop");
        if (!saved || placeLooksWeak(saved, feature, state.dropStreet, state.dropCity)) {
          setCoords("drop", feature);
          if (saved) state.dropFix = featurePoint(feature);
        }
      }));
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

  function refreshOpenRides(force) {
    if (ROLE !== "driver" || !signedIn() || state.screen !== "home") return;
    if (!syncOn()) {
      state.openRides = [];
      state.openListError = "";
      state.openListLoading = false;
      var statusOff = document.getElementById("board-status");
      if (statusOff) statusOff.textContent = driverBoardStatusInner();
      syncDriverBoardMarkers();
      return;
    }
    var seq = ++openListSeq;
    state.openListLoading = true;
    listOpenRides().then(function (rides) {
      if (seq !== openListSeq) return;
      state.openListLoading = false;
      var prevError = state.openListError;
      state.openListError = "";
      var stamp = rides.map(function (r) {
        return (r.code || "") + ":" + (r.updatedAt || "") + ":" + (r.pickupLat || "") + "," + (r.pickupLng || "");
      }).join("|");
      var changed = stamp !== state.openListStamp || !!prevError;
      state.openListStamp = stamp;
      state.openRides = rides;
      var selectionCleared = false;
      if (state.selectedOpenCode) {
        var still = rides.some(function (r) { return r.code === state.selectedOpenCode; });
        if (!still) {
          state.selectedOpenCode = "";
          clearRideFields();
          selectionCleared = true;
          changed = true;
        }
      }
      // Full render only when forced or the Accept/Deny card must rebuild.
      // Routine polls update the status line + map markers in place (map stays alive).
      if (force || selectionCleared) {
        render();
        return;
      }
      if (changed || prevError) {
        var status = document.getElementById("board-status");
        if (status) status.textContent = driverBoardStatusInner();
        syncDriverBoardMarkers();
      }
    }).catch(function (err) {
      if (seq !== openListSeq) return;
      state.openListLoading = false;
      var next = err && err.denied ? "open-denied" : "open-error";
      var changed = state.openListError !== next;
      state.openListError = next;
      if (force) {
        render();
        return;
      }
      if (changed) {
        var statusErr = document.getElementById("board-status");
        if (statusErr) statusErr.textContent = driverBoardStatusInner();
      }
    });
  }

  function selectOpenRide(code) {
    code = normalizeCode(code);
    if (!code) return;
    state.selectedOpenCode = code;
    state.remoteLoading = true;
    getRide(code).then(function (ride) {
      state.remoteLoading = false;
      if (!ride) {
        state.selectedOpenCode = "";
        clearRideFields();
        render();
        return;
      }
      if (!ride.code) ride.code = code;
      applyRide(ride);
      state.code = code;
      state.driverCode = code;
      writeDriverCode(code);
      rememberRemote(ride);
      render();
    }).catch(function () {
      state.remoteLoading = false;
      state.selectedOpenCode = "";
      render();
    });
  }

  function acceptSelectedOpenRide() {
    if (!state.selectedOpenCode && !state.code) return;
    var account = readDriverAccount();
    if (account && account.name) state.driverName = account.name;
    if (account && account.phone) state.driverPhone = account.phone;
    if (account && safePhoto(account.photo)) state.driverPhoto = safePhoto(account.photo);
    var code = state.driverCode || state.code || state.selectedOpenCode || readDriverCode();
    if (code) {
      state.code = code;
      state.driverCode = code;
      writeDriverCode(code);
    }
    saveRide("accepted");
    if (syncOn() && code) {
      var patch = { status: "accepted" };
      if (state.driverName) patch.driverName = state.driverName;
      if (state.driverPhone) patch.driverPhone = state.driverPhone;
      if (safePhoto(state.driverPhoto)) patch.driverPhoto = safePhoto(state.driverPhoto);
      patchRide(code, patch).catch(function () {});
      deleteOpenRide(code).catch(function () {});
    }
    state.selectedOpenCode = "";
    state.mode = "driver";
    state.screen = "trip";
    render();
  }

  function denySelectedOpenRide() {
    var code = state.selectedOpenCode || state.code || "";
    var account = readDriverAccount();
    var record = buildRefusalRecord(currentRide() || selectedOpenRide(), account);
    postRefusal(record).catch(function () {});
    state.selectedOpenCode = "";
    clearRideFields();
    writeDriverCode("");
    state.driverCode = "";
    try { localStorage.removeItem(STORE); } catch (err) {}
    render();
    refreshOpenRides(true);
  }

  var BOARD_CENTER = { lat: 30.39, lng: -95.65 };
  var boardMapEl = null;

  function boardMapStillMounted() {
    var el = document.getElementById("live-map");
    return !!(liveMap && el && boardMapEl === el && el._leaflet_id);
  }

  function fitDriverBoard(bounds) {
    if (!liveMap) return;
    if (bounds.length >= 2) {
      liveMap.fitBounds(window.L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 13 });
    } else if (bounds.length === 1) {
      liveMap.setView(bounds[0], 12);
    } else if (isFinite(state.hereLat) && isFinite(state.hereLng)) {
      liveMap.setView([+state.hereLat, +state.hereLng], 12);
    } else {
      liveMap.setView([BOARD_CENTER.lat, BOARD_CENTER.lng], 11);
    }
  }

  function syncDriverBoardMarkers() {
    if (!boardMapStillMounted()) return;
    if (state.boardMarkers) {
      state.boardMarkers.clearLayers();
    } else {
      state.boardMarkers = window.L.layerGroup().addTo(liveMap);
    }
    var bounds = [];
    if (isFinite(state.hereLat) && isFinite(state.hereLng)) {
      var here = [+state.hereLat, +state.hereLng];
      if (carMarker) {
        carMarker.setLatLng(here);
      } else {
        carMarker = window.L.marker(here, {
          icon: window.L.divIcon({
            className: "pin-icon",
            html: '<div class="car-face">' + CAR_SVG + "</div>",
            iconSize: [44, 44],
            iconAnchor: [22, 22]
          }),
          zIndexOffset: 600
        }).addTo(liveMap);
      }
      bounds.push(here);
    }
    (state.openRides || []).forEach(function (ride) {
      if (!isCoord(ride.pickupLat) || !isCoord(ride.pickupLng)) return;
      var selected = ride.code === state.selectedOpenCode;
      var marker = window.L.marker([+ride.pickupLat, +ride.pickupLng], {
        icon: pinIcon(selected ? "Selected" : "Rider", "pin-you"),
        zIndexOffset: selected ? 500 : 200
      });
      marker.on("click", function () {
        selectOpenRide(ride.code);
      });
      state.boardMarkers.addLayer(marker);
      bounds.push([+ride.pickupLat, +ride.pickupLng]);
    });
    fitDriverBoard(bounds);
    setTimeout(function () {
      if (liveMap) liveMap.invalidateSize();
    }, 80);
  }

  function startDriverBoardMap() {
    if (!window.L) return;
    var el = document.getElementById("live-map");
    if (!el) return;
    if (boardMapStillMounted()) {
      syncDriverBoardMarkers();
      return;
    }
    try {
      if (liveMap) {
        try { liveMap.remove(); } catch (e1) {}
        liveMap = null;
        carMarker = null;
        state.boardMarkers = null;
      }
      boardMapEl = el;
      tilesOk = false;
      liveMap = window.L.map(el, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true
      });
      var layer = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(liveMap);
      state.boardMarkers = window.L.layerGroup().addTo(liveMap);
      var boardTileErrors = 0;
      var boardFallbackTiles = false;
      layer.on("tileload", function () {
        tilesOk = true;
        if (liveMap) liveMap.invalidateSize();
      });
      layer.on("tileerror", function () {
        boardTileErrors += 1;
        if (boardFallbackTiles || boardTileErrors < 4 || !liveMap) return;
        boardFallbackTiles = true;
        window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
          maxZoom: 19,
          subdomains: "abcd",
          attribution: "&copy; OpenStreetMap &copy; CARTO"
        }).addTo(liveMap);
      });
      // Never tear down the board map on slow tiles — empty navy box is worse than waiting.
      setTimeout(function () {
        if (liveMap) liveMap.invalidateSize();
      }, 100);
      setTimeout(function () {
        if (liveMap) liveMap.invalidateSize();
      }, 500);
      syncDriverBoardMarkers();
    } catch (err) {
      boardMapEl = null;
      // Keep the container; do not call fallbackMap (that deletes the map with no illus on the board).
    }
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
      var road = routeLatLngs(pickup, drop);
      var bounds = road.slice();
      if (driver) bounds.push([driver.lat, driver.lng]);
      window.L.polyline(road, { color: "#d4b15a", weight: 4, opacity: 0.9 }).addTo(liveMap);
      if (driver) {
        window.L.polyline([[driver.lat, driver.lng], [pickup.lat, pickup.lng]], {
          color: "#d4b15a", weight: 3, opacity: 0.45, dashArray: "6 8"
        }).addTo(liveMap);
      }
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
      var road = route.live
        ? routeLatLngs(route.pickup, route.dropoff)
        : [[route.driver.lat, route.driver.lng], [route.pickup.lat, route.pickup.lng], [route.dropoff.lat, route.dropoff.lng]];
      window.L.polyline(road, { color: "#d4b15a", weight: 4, opacity: 0.9 }).addTo(liveMap);
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
      var boundPts = road.slice();
      boundPts.push([route.driver.lat, route.driver.lng]);
      liveMap.fitBounds(window.L.latLngBounds(boundPts), { padding: [28, 28], maxZoom: 14 });
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
      recordTripPoint(state.hereLat, state.hereLng);
      maybePatchDriverLocation();
      if (ROLE === "driver" && state.screen === "home" && boardMapStillMounted()) {
        syncDriverBoardMarkers();
        publishDriverPresence();
      } else if (carMarker) {
        var dest;
        if (state.screen === "home") {
          dest = { lat: state.hereLat, lng: state.hereLng };
        } else if (state.rideStatus === "started" && placeCoords("drop")) {
          dest = placeCoords("drop");
        } else {
          dest = routePoints().pickup;
        }
        placeCar(state.hereLat, state.hereLng, bearing(
          { lat: state.hereLat, lng: state.hereLng },
          dest
        ));
        if (ROLE === "driver") publishDriverPresence();
      } else if (first) {
        render();
        if (ROLE === "driver") publishDriverPresence();
      } else if (ROLE === "driver") {
        publishDriverPresence();
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
    if (ROLE === "driver" && signedIn()) {
      followGps();
      refreshOpenRides(true);
      publishDriverPresence();
    }
    window.addEventListener("storage", function (event) {
      if (event.key !== STORE) return;
      syncRide();
    });
    setInterval(function () {
      syncRide();
    }, 1000);
    setInterval(pullRemoteRide, 3000);
    setInterval(function () {
      if (ROLE === "driver" && signedIn() && state.screen === "home") refreshOpenRides();
    }, 3000);
    setInterval(function () {
      if (ROLE === "driver" && signedIn()) publishDriverPresence();
    }, 20000);
    setInterval(function () {
      if (ROLE === "customer" && signedIn()) refreshOnlineDrivers();
    }, 5000);
    window.addEventListener("pagehide", function () {
      if (ROLE === "driver" && signedIn()) clearDriverPresence();
    });
    if (ROLE !== "driver" && signedIn()) {
      maybeRestoreCustomerRide();
    }
    render();
  });

  function syncRide() {
    if (!signedIn()) return;
    var ride = currentRide();
    if (ROLE === "driver") {
      if (state.screen === "home") return;
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
      if (state.screen === "trip" && ride && (ride.status === "accepted" || ride.status === "started" || ride.status === "completed")) return;
      if (state.screen !== "home" && (!ride || (ride.status !== "accepted" && ride.status !== "started" && ride.status !== "completed"))) state.screen = "home";
      render();
      return;
    }
    if (state.screen !== "waiting" && state.screen !== "trip") return;
    if (!ride) return;
    ingestCustomerRide(ride);
  }
})();
