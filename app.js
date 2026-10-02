/**
 * Private Car Services — Ride Fare Estimator
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
      label: 'Mon–Fri daytime (6:00 am–5:59 pm)',
      perMile: 1.1,
      airportDrop: 15.5,
      airportPick: 25,
    },
    weekendNight: {
      label: 'Nights, holidays & weekends (6:00–9:59 pm band / weekend daytime)',
      perMile: 1.38,
      airportDrop: 20,
      airportPick: 30,
    },
    late: {
      label: 'Late nights (10:00 pm–5:59 am)',
      perMile: 1.43,
      airportDrop: 30,
      airportPick: 50,
    },
  };

  const els = {
    form: document.getElementById('estimate-form'),
    pickup: document.getElementById('pickup'),
    dropoff: document.getElementById('dropoff'),
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
  let pickupAutocomplete = null;
  let dropoffAutocomplete = null;
  let lastDrivingMiles = null;
  let mapsReady = false;

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
   * 1) hour 22:00–05:59 → late
   * 2) weekend OR holiday OR hour 18:00–21:59 → weekend/night ($1.38)
   * 3) else → weekday daytime ($1.10)
   */
  function resolveTier(dateStr, timeStr, isHoliday) {
    if (!dateStr || !timeStr) return RATES.daytime;

    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const date = new Date(y, m - 1, d, hh, mm || 0, 0, 0);
    const day = date.getDay(); // 0 Sun … 6 Sat
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
      label: `Mileage (${mi.toFixed(1)} mi × $${tier.perMile.toFixed(2)})`,
      amount: mileage,
    });
    subtotal += mileage;

    const extraPax = Math.max(0, pax - 2);
    if (extraPax > 0) {
      const amt = extraPax * RATES.extraPassenger;
      items.push({
        label: `Extra passengers (${extraPax} × $${RATES.extraPassenger})`,
        amount: amt,
      });
      subtotal += amt;
    }

    if (extraStops > 0) {
      const amt = extraStops * RATES.extraStop;
      items.push({
        label: `Extra stops (${extraStops} × $${RATES.extraStop})`,
        amount: amt,
      });
      subtotal += amt;
    }

    let total = subtotal;
    if (shortNotice) {
      const surcharge = subtotal * RATES.shortNoticePct;
      items.push({
        label: 'Less than 24 hours’ notice (+25%)',
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

  function renderEstimate(result) {
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

  async function fetchDrivingMiles() {
    if (!mapsReady || !directionsService) return null;

    const origin = els.pickup.value.trim();
    const destination = els.dropoff.value.trim();
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
      renderEstimate({ callForQuote: true, tripType });
      return;
    }

    let miles = null;

    if (mapsReady) {
      miles = await fetchDrivingMiles();
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

        const acOpts = {
          fields: ['formatted_address', 'geometry', 'name'],
          componentRestrictions: { country: 'us' },
        };
        pickupAutocomplete = new google.maps.places.Autocomplete(els.pickup, acOpts);
        dropoffAutocomplete = new google.maps.places.Autocomplete(els.dropoff, acOpts);

        mapsReady = true;
        els.apiBanner.hidden = true;
        // Keep manual miles available as fallback
        els.manualMilesField.hidden = false;
        showRouteStatus('Address suggestions enabled — pick pickup & drop-off, then Get estimate.');
      } catch (err) {
        console.error(err);
        initManualMode();
      }
    };
    document.head.appendChild(script);
  }

  function init() {
    if (els.year) els.year.textContent = String(new Date().getFullYear());
    setDefaultDateTime();
    els.form.addEventListener('submit', onSubmit);

    if (hasApiKey()) {
      initMaps();
    } else {
      initManualMode();
    }
  }

  // Expose for optional testing
  window.PCS_computeEstimate = computeEstimate;
  window.PCS_resolveTier = resolveTier;

  init();
})();
