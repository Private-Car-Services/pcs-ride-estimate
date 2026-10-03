/**
 * Private Car Services â€” Ride Fare Estimator
 * Rates mirror ptstaxiservices.com (estimate only).
 */
(function () {
  'use strict';

  const PHONE = '9362617878';
  const RATES = {
    localBase: 11,
    extraPassenger: 5,
    extraStop: 11,
    shortNoticePct: 0.25,
    daytime: {
      label: 'Monâ€“Fri daytime (6:00 amâ€“5:59 pm)',
      perMile: 1.1,
      airportDrop: 15.5,
      airportPick: 25,
    },
    weekendNight: {
      label: 'Nights, holidays & weekends (6:00â€“9:59 pm band / weekend daytime)',
      perMile: 1.38,
      airportDrop: 20,
      airportPick: 30,
    },
    late: {
      label: 'Late nights (10:00 pmâ€“5:59 am)',
      perMile: 1.43,
      airportDrop: 30,
      airportPick: 50,
    },
  };

  const els = {
    form: document.getElementById('estimate-form'),
    pickupStreet: document.getElementById('pickup-street'),
    pickupCity: document.getElementById('pickup-city'),
    pickupState: document.getElementById('pickup-state'),
    dropoffStreet: document.getElementById('dropoff-street'),
    dropoffCity: document.getElementById('dropoff-city'),
    dropoffState: document.getElementById('dropoff-state'),
    contactName: document.getElementById('contact-name'),
    contactEmail: document.getElementById('contact-email'),
    contactPhone: document.getElementById('contact-phone'),
    flightDetails: document.getElementById('flight-details'),
    airline: document.getElementById('airline'),
    flightNumber: document.getElementById('flight-number'),
    flightDirection: document.getElementById('flight-direction'),
    textRequestButton: document.getElementById('text-request-btn'),
    textRequestNote: document.getElementById('text-request-note'),
    requestConfirm: document.getElementById('request-confirm'),
    smsLaunch: document.getElementById('sms-launch'),
    estimateButton: document.getElementById('estimate-btn'),
    manualMilesField: document.getElementById('manual-miles-field'),
    manualMiles: document.getElementById('manual-miles'),
    tripType: document.getElementById('trip-type'),
    passengers: document.getElementById('passengers'),
    stops: document.getElementById('stops'),
    rideDate: document.getElementById('ride-date'),
    rideTime: document.getElementById('ride-time'),
    holiday: document.getElementById('holiday'),
    shortNotice: document.getElementById('short-notice'),
    apiBanner: document.getElementById('api-banner'),
    map: document.getElementById('map'),
    routeStatus: document.getElementById('route-status'),
    resultsEmpty: document.getElementById('results-empty'),
    resultsBody: document.getElementById('results-body'),
    milesLine: document.getElementById('miles-line'),
    tierLine: document.getElementById('tier-line'),
    lineItems: document.getElementById('line-items'),
    totalAmount: document.getElementById('total-amount'),
    returnNote: document.getElementById('return-note'),
    callQuote: document.getElementById('call-quote'),
    year: document.getElementById('year'),
  };

  let map = null;
  let directionsService = null;
  let directionsRenderer = null;
  let distanceMatrixService = null;
  let lastDrivingMiles = null;
  let mapsReady = false;
  let lastEstimate = null;

  function money(n) {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function hasApiKey() {
    return typeof window.PCS_GOOGLE_MAPS_API_KEY === 'string' &&
      window.PCS_GOOGLE_MAPS_API_KEY.trim().length > 0;
  }

  function setDefaultDateTime() {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    els.rideDate.value = `${yyyy}-${mm}-${dd}`;
    els.rideTime.value = '10:00';
  }

  /**
   * Tier selection (per product requirements):
   * 1) hour 22:00â€“05:59 â†’ late
   * 2) weekend OR holiday OR hour 18:00â€“21:59 â†’ weekend/night ($1.38)
   * 3) else â†’ weekday daytime ($1.10)
   */
  function resolveTier(dateStr, timeStr, isHoliday) {
    if (!dateStr || !timeStr) return RATES.daytime;

    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const date = new Date(y, m - 1, d, hh, mm || 0, 0, 0);
    const day = date.getDay(); // 0 Sun â€¦ 6 Sat
    const isWeekend = day === 0 || day === 6;
    const hour = hh;

    const isLate = hour >= 22 || hour < 6;
    if (isLate) return RATES.late;

    const isEveningBand = hour >= 18 && hour <= 21;
    if (isWeekend || isHoliday || isEveningBand) return RATES.weekendNight;

    return RATES.daytime;
  }

  function computeEstimate({ miles, tripType, passengers, stops, dateStr, timeStr, isHoliday, shortNotice }) {
    if (tripType === 'hourly' || tripType === 'van') {
      return { callForQuote: true, tripType };
    }

    const tier = resolveTier(dateStr, timeStr, isHoliday);
    const pax = Math.max(1, Number(passengers) || 1);
    const extraStops = Math.max(0, Number(stops) || 0);
    const mi = Math.max(0, Number(miles) || 0);

    const items = [];
    let subtotal = 0;

    let base = RATES.localBase;
    let baseLabel = 'Local base (includes 2 passengers)';

    if (tripType === 'airport-drop') {
      base = tier.airportDrop;
      baseLabel = 'Airport drop-off base';
    } else if (tripType === 'airport-pick') {
      base = tier.airportPick;
      baseLabel = 'Airport pick-up base';
    }

    items.push({ label: baseLabel, amount: base });
    subtotal += base;

    const mileage = mi * tier.perMile;
    items.push({
      label: `Mileage (${mi.toFixed(1)} mi Ã— $${tier.perMile.toFixed(2)})`,
      amount: mileage,
    });
    subtotal += mileage;

    const extraPax = Math.max(0, pax - 2);
    if (extraPax > 0) {
      const amt = extraPax * RATES.extraPassenger;
      items.push({
        label: `Extra passengers (${extraPax} Ã— $${RATES.extraPassenger})`,
        amount: amt,
      });
      subtotal += amt;
    }

    if (extraStops > 0) {
      const amt = extraStops * RATES.extraStop;
      items.push({
        label: `Extra stops (${extraStops} Ã— $${RATES.extraStop})`,
        amount: amt,
      });
      subtotal += amt;
    }

    let total = subtotal;
    if (shortNotice) {
      const surcharge = subtotal * RATES.shortNoticePct;
      items.push({
        label: 'Less than 24 hoursâ€™ notice (+25%)',
        amount: surcharge,
      });
      total += surcharge;
    }

    return {
      callForQuote: false,
      tier,
      miles: mi,
      items,
      total,
      over75: mi > 75,
    };
  }

  function composeAddress(streetEl, cityEl, stateEl) {
    return [streetEl.value.trim(), cityEl.value.trim(), stateEl.value.trim()].filter(Boolean).join(', ');
  }

  function pickupAddress() {
    return composeAddress(els.pickupStreet, els.pickupCity, els.pickupState);
  }

  function dropoffAddress() {
    return composeAddress(els.dropoffStreet, els.dropoffCity, els.dropoffState);
  }

  function isAppleSmsDevice() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad/i.test(ua)) return true;
    // iPadOS 13+ identifies as Macintosh, but still needs the iOS sms separator.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function smsUrl(body) {
    const separator = isAppleSmsDevice() ? '&' : '?';
    return 'sms:9362617878' + separator + 'body=' + encodeURIComponent(body);
  }

  function needsFlightDetails() {
    const type = els.tripType.value;
    if (type === 'airport-pick' || type === 'airport-drop') return true;
    return /\bairport\b/i.test(pickupAddress() + ' ' + dropoffAddress());
  }

  function updateFlightDetails() {
    const required = needsFlightDetails();
    els.flightDetails.hidden = !required;
    [els.airline, els.flightNumber, els.flightDirection].forEach((field) => {
      field.required = required;
    });
  }

  function rideRequestBody(result) {
    const lines = [
      'Hello,',
      '',
      'I would like to request a ride. Please confirm availability and the final fare.',
      '',
      'Name: ' + els.contactName.value.trim(),
      'Phone: ' + els.contactPhone.value.trim(),
    ];
    const email = els.contactEmail.value.trim();
    if (email) lines.push('Email: ' + email);
    lines.push(
      'Pickup: ' + pickupAddress(),
      'Drop-off: ' + dropoffAddress(),
      'Date: ' + els.rideDate.value,
      'Time: ' + els.rideTime.value,
      'Passengers: ' + els.passengers.value,
      'Stops: ' + els.stops.value,
      'Trip type: ' + els.tripType.options[els.tripType.selectedIndex].text
    );
    if (needsFlightDetails()) {
      lines.push(
        'Airline: ' + els.airline.value.trim(),
        'Flight number: ' + els.flightNumber.value.trim(),
        'Arrival or departure: ' + els.flightDirection.value
      );
    }
    if (result && !result.callForQuote && typeof result.total === 'number') {
      lines.push('Estimated total: ' + money(result.total));
    }
    lines.push('', 'This is a ride request only, not a booking confirmation.');
    return lines.join('\n');
  }

  function saveDraft() {
    const data = {};
    els.form.querySelectorAll('input, select, textarea').forEach((field) => {
      if (!field.id) return;
      data[field.id] = field.type === 'checkbox' ? field.checked : field.value;
    });
    try { sessionStorage.setItem('pcs-quote', JSON.stringify(data)); } catch (err) {}
  }

  function restoreDraft() {
    let data;
    try { data = JSON.parse(sessionStorage.getItem('pcs-quote') || 'null'); } catch (err) { data = null; }
    if (!data) return;
    Object.keys(data).forEach((id) => {
      const field = document.getElementById(id);
      if (!field) return;
      if (field.type === 'checkbox') field.checked = !!data[id];
      else field.value = data[id];
    });
  }

  function showConfirmation() {
    if (!els.requestConfirm) return;
    els.requestConfirm.hidden = false;
    els.requestConfirm.textContent = 'Request ready. Send the text to 936-261-7878. Your details stay on this page.';
  }

  function openRideText(event, result) {
    updateFlightDetails();
    if (!els.form.reportValidity()) {
      if (event) event.preventDefault();
      const bad = els.form.querySelector(':invalid');
      if (bad && bad.scrollIntoView) bad.scrollIntoView({ block: 'center' });
      if (els.textRequestNote) {
        els.textRequestNote.hidden = false;
        els.textRequestNote.textContent = 'Fill the highlighted field, then tap again.';
      }
      return false;
    }
    if (els.textRequestNote) els.textRequestNote.hidden = true;
    saveDraft();
    const url = smsUrl(rideRequestBody(result));
    if (els.textRequestButton) els.textRequestButton.href = url;
    if (els.smsLaunch) els.smsLaunch.href = url;
    showConfirmation();
    if (event && event.currentTarget === els.textRequestButton) return true;
    if (els.smsLaunch) els.smsLaunch.click();
    return true;
  }

  function renderEstimate(result) {
    lastEstimate = result;
    els.resultsEmpty.hidden = true;
    els.resultsBody.hidden = false;

    if (result.callForQuote) {
      els.milesLine.textContent = '';
      els.tierLine.textContent = '';
      els.lineItems.innerHTML = '';
      els.totalAmount.textContent = 'Call for quote';
      els.returnNote.hidden = true;
      els.callQuote.hidden = false;
      return;
    }

    els.callQuote.hidden = true;
    els.milesLine.textContent = `One-way driving distance: ${result.miles.toFixed(1)} miles`;
    els.tierLine.textContent = `Rate tier: ${result.tier.label}`;
    els.lineItems.innerHTML = result.items
      .map(
        (item) =>
          `<li><span class="label">${escapeHtml(item.label)}</span><span class="amount">${money(item.amount)}</span></li>`
      )
      .join('');
    els.totalAmount.textContent = money(result.total);
    els.returnNote.hidden = !result.over75;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showRouteStatus(msg, isError) {
    els.routeStatus.hidden = !msg;
    els.routeStatus.textContent = msg || '';
    els.routeStatus.classList.toggle('error', !!isError);
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 12000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function geocodeAddress(address) {
    const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(address) + '&limit=1';
    const data = await fetchJson(url);
    const feature = data && data.features && data.features[0];
    const coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lon: lon, lat: lat };
  }

  async function fetchOsrmMiles(origin, destination) {
    const url = 'https://router.project-osrm.org/route/v1/driving/' +
      origin.lon + ',' + origin.lat + ';' +
      destination.lon + ',' + destination.lat +
      '?overview=false';
    const data = await fetchJson(url);
    const route = data && data.code === 'Ok' && data.routes && data.routes[0];
    const meters = route && route.distance;
    if (!Number.isFinite(meters) || meters <= 0) return null;
    return meters / 1609.344;
  }

  async function fetchPublicDrivingMiles() {
    const originAddress = pickupAddress();
    const destinationAddress = dropoffAddress();
    if (!originAddress || !destinationAddress) return null;

    const origin = await geocodeAddress(originAddress);
    const destination = await geocodeAddress(destinationAddress);
    if (!origin || !destination) return null;

    const miles = await fetchOsrmMiles(origin, destination);
    if (miles == null) return null;
    lastDrivingMiles = miles;
    showRouteStatus('Route found: ' + miles.toFixed(1) + ' miles driving');
    return miles;
  }

  async function fetchDrivingMiles() {
    if (!mapsReady || !directionsService) return null;

    const origin = pickupAddress();
    const destination = dropoffAddress();
    if (!origin || !destination) return null;

    return new Promise((resolve) => {
      directionsService.route(
        {
          origin,
          destination,
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
        },
        (response, status) => {
          if (status === 'OK' && response.routes && response.routes[0]) {
            directionsRenderer.setDirections(response);
            els.map.hidden = false;
            const route = response.routes[0];
            let meters = 0;
            route.legs.forEach((leg) => {
              meters += leg.distance.value;
            });
            const miles = meters / 1609.344;
            lastDrivingMiles = miles;
            showRouteStatus(`Route found: ${miles.toFixed(1)} miles driving`);
            resolve(miles);
          } else {
            showRouteStatus('Could not find a driving route. Check addresses or enter miles.', true);
            resolve(null);
          }
        }
      );
    });
  }

  async function onSubmit(e) {
    e.preventDefault();

    const tripType = els.tripType.value;
    if (tripType === 'hourly' || tripType === 'van') {
      const quote = { callForQuote: true, tripType };
      renderEstimate(quote);
      return quote;
    }

    let miles = null;

    if (mapsReady) {
      miles = await fetchDrivingMiles();
    } else if (!hasApiKey()) {
      showRouteStatus('Looking up driving milesâ€¦');
      miles = await fetchPublicDrivingMiles();
    }

    if (miles == null) {
      const manual = parseFloat(els.manualMiles.value);
      if (!manual || manual <= 0) {
        showRouteStatus('Enter pickup & drop-off (with map) or type driving miles.', true);
        els.manualMilesField.hidden = false;
        els.manualMiles.focus();
        return;
      }
      miles = manual;
      showRouteStatus(`Using manual miles: ${miles.toFixed(1)}`);
    }

    const result = computeEstimate({
      miles,
      tripType,
      passengers: els.passengers.value,
      stops: els.stops.value,
      dateStr: els.rideDate.value,
      timeStr: els.rideTime.value,
      isHoliday: els.holiday.checked,
      shortNotice: els.shortNotice.checked,
    });

    renderEstimate(result);
    return result;
  }

  function initManualMode() {
    els.apiBanner.hidden = false;
    els.manualMilesField.hidden = false;
    mapsReady = false;
  }

  function initMaps() {
    const key = window.PCS_GOOGLE_MAPS_API_KEY.trim();
    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(key) +
      '&libraries=places&callback=PCS_initMaps';
    script.async = true;
    script.defer = true;
    script.onerror = function () {
      initManualMode();
      showRouteStatus('Maps failed to load. Enter miles manually.', true);
    };
    window.PCS_initMaps = function () {
      try {
        map = new google.maps.Map(els.map, {
          center: { lat: 30.0, lng: -95.4 },
          zoom: 9,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: false,
        });
        distanceMatrixService = new google.maps.DistanceMatrixService();

        mapsReady = true;
        els.apiBanner.hidden = true;
        // Keep manual miles available as fallback
        els.manualMilesField.hidden = false;
        showRouteStatus('Map ready â€” enter pickup and drop-off, then Get estimate.');
      } catch (err) {
        console.error(err);
        initManualMode();
      }
    };
    document.head.appendChild(script);
  }

  function init() {
    if (els.year) els.year.textContent = String(new Date().getFullYear());
    restoreDraft();
    if (!els.rideDate.value || !els.rideTime.value) setDefaultDateTime();
    if (sessionStorage.getItem('pcs-quote')) showConfirmation();
    els.form.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    els.form.addEventListener('input', saveDraft);
    els.form.addEventListener('change', saveDraft);
    els.estimateButton.addEventListener('click', async (event) => {
      event.preventDefault();
      const result = await onSubmit(event);
      if (result) openRideText(null, result);
    });
    els.textRequestButton.addEventListener('click', (event) => {
      if (!openRideText(event, lastEstimate)) event.preventDefault();
    });
    els.tripType.addEventListener('change', updateFlightDetails);
    [
      els.pickupStreet, els.pickupCity, els.pickupState,
      els.dropoffStreet, els.dropoffCity, els.dropoffState,
    ].forEach((field) => field.addEventListener('input', updateFlightDetails));
    updateFlightDetails();

    if (hasApiKey()) {
      initMaps();
    } else {
      initManualMode();
    }
  }

  // Expose for optional testing
  window.PCS_computeEstimate = computeEstimate;
  window.PCS_resolveTier = resolveTier;
  window.PCS_composeAddress = composeAddress;
  window.PCS_smsUrl = smsUrl;

  init();
})();
