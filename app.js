/**
 * Private Car Services — Ride Fare Estimator
 * Rates mirror ptstaxiservices.com (estimate only).
 * v15: From / To / "+ Add a stop" address blocks (Line 1 with suggestions, Line 2, City, State, ZIP),
 * automatic rate tier + holiday + short notice from pickup date/time, automatic airport fee from addresses,
 * billed miles always rounded UP to the next whole mile.
 * v16 hotfix: texts go to the business line only; Get estimate never opens Messages; current location fills a real
 * street / city / ZIP (GPS point kept for routing); driving miles always come from a real route (Google Directions,
 * else OSRM) and are recalculated when From / To / stops change; route map (Leaflet / OpenStreetMap);
 * nearest-first place suggestions with distances (same search as the rider app).
 * v18 (Oct 6, 2026): Square LIVE. Book it charges the 25% deposit (or pay in full) through the pcs-pay Worker
 * POST /deposit; the Worker re-reads this booking from Firebase and only charges 25% of its estimate (or the full
 * estimate). Sandbox only with ?squaretest=1.
 * v19 (PCS v60, Oct 7, 2026): Address line 1 suggestions come from Google Places through the pcs-pay Worker
 * (POST /places/autocomplete + /places/details; the key is a Worker secret, daily-capped). If the Worker says capped /
 * fallback or is slow, the v18 search (free map data, then the Maps JS key if loaded) runs as before. Picking a Google
 * suggestion fills line 1, city, state, ZIP (overwritten) and the exact pin. "Powered by Google" under the list.
 * v20 (PCS v61, Oct 7, 2026): "+ Add a stop" and stop blocks sit between From and To. Google suggestions with no
 * current location / From pin are biased to the chosen service area (Greater Houston 29.76,-95.37 or Waco
 * 31.55,-97.15; no area picked = Greater Houston) instead of all of Texas; no distance is shown for that default bias,
 * and matches within 50 mi (~80 km) of the area center are listed first (Google's order kept inside each group).
 */
(function () {
  'use strict';

  // Business line shown to customers on the page.
  const PHONE = '9362617878';
  // Lead SMS recipients: the business line only.
  const LEAD_SMS_NUMBERS = ['9362617878'];
  // Waco-area leads also go to Anson. Greater Houston leads do not.
  const WACO_EXTRA_SMS_NUMBERS = ['2544981335'];
  // —— Book it (25% deposit or pay in full) ——
  // v16: Book it never leaves this page. No Square booking link, no Messages. The booking is written to the same
  // Firebase hub God mode reads (app/sync-config.js), status "pending_owner", so Matthew sees "New booking needs your OK".
  // Payment: the Square Web Payments card form appears on this page only once app/square-config.js is filled in
  // (same gating as the rider app). Until then the customer sees "we'll send your secure payment link".
  // No Square secrets/API keys ever go on this site.
  const DEPOSIT_PCT = 0.25;
  const RIDE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const OPEN_HUB = 'REQUESTS';
  // Auto "Book it" only for Greater Houston, Mon–Fri 8:00 am–6:00 pm America/Chicago (same hours as the rider app).
  // Waco always stays pending — Anson's calendar is not connected.
  const BOOK_START_MIN = 8 * 60;
  const BOOK_END_MIN = 18 * 60;
  // Matthew's calendar must be clear this many minutes before pickup and after the estimated drop-off.
  const BUSY_BUFFER_MIN = 30;
  const BUSY_URL = 'app/busy.json';
  // v16: new key so an old v15 draft (which could hold stale auto-filled miles) is never restored.
  const DRAFT_KEY = 'pcs-quote-v16';
  const MAX_STOPS = 5;

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

  // Known airports (offered first in suggestions and used for airport-fee detection).
  // Any other place whose map type is an airport (or whose name says "Airport") also counts.
  const AIRPORTS = [
    { code: 'IAH', name: 'George Bush Intercontinental Airport', line1: '2800 N Terminal Rd', city: 'Houston', state: 'TX', zip: '77032', lat: 29.9902, lng: -95.3368, keys: ['bush intercontinental', 'bush airport', 'iah airport'] },
    { code: 'HOU', name: 'William P. Hobby Airport', line1: '7800 Airport Blvd', city: 'Houston', state: 'TX', zip: '77061', lat: 29.6454, lng: -95.2789, keys: ['hobby airport', 'william p hobby', 'hobby field'] },
    { code: 'EFD', name: 'Ellington Airport', line1: '11602 Aerospace Ave', city: 'Houston', state: 'TX', zip: '77034', lat: 29.6073, lng: -95.1588, keys: ['ellington airport', 'ellington field'] },
    { code: 'CXO', name: 'Conroe-North Houston Regional Airport', line1: '9001 Airport Rd', city: 'Conroe', state: 'TX', zip: '77303', lat: 30.3518, lng: -95.4145, keys: ['conroe airport', 'conroe regional', 'north houston regional'] },
    { code: 'DWH', name: 'David Wayne Hooks Memorial Airport', line1: '20803 Stuebner Airline Rd', city: 'Spring', state: 'TX', zip: '77379', lat: 30.0618, lng: -95.5528, keys: ['hooks airport', 'hooks memorial', 'david wayne hooks'] },
    { code: 'ACT', name: 'Waco Regional Airport', line1: '7909 Karl May Dr', city: 'Waco', state: 'TX', zip: '76708', lat: 31.6113, lng: -97.2305, keys: ['waco airport', 'waco regional'] },
    { code: 'CLL', name: 'Easterwood Airport', line1: '1 McKenzie Terminal Blvd', city: 'College Station', state: 'TX', zip: '77845', lat: 30.5886, lng: -96.3638, keys: ['easterwood airport', 'easterwood field', 'college station airport'] },
    { code: 'GRK', name: 'Killeen Regional Airport', line1: '8101 S Clear Creek Rd', city: 'Killeen', state: 'TX', zip: '76549', lat: 31.0672, lng: -97.8289, keys: ['killeen airport', 'killeen regional'] },
    { code: 'AUS', name: 'Austin-Bergstrom International Airport', line1: '3600 Presidential Blvd', city: 'Austin', state: 'TX', zip: '78719', lat: 30.1975, lng: -97.6664, keys: ['bergstrom airport', 'austin bergstrom', 'austin airport'] },
    { code: 'SAT', name: 'San Antonio International Airport', line1: '9800 Airport Blvd', city: 'San Antonio', state: 'TX', zip: '78216', lat: 29.5337, lng: -98.4698, keys: ['san antonio airport', 'san antonio international'] },
    { code: 'DFW', name: 'Dallas Fort Worth International Airport', line1: '2400 Aviation Dr', city: 'DFW Airport', state: 'TX', zip: '75261', lat: 32.8998, lng: -97.0403, keys: ['dfw airport', 'dallas fort worth airport', 'dallas fort worth international'] },
    { code: 'DAL', name: 'Dallas Love Field', line1: '8008 Herb Kelleher Way', city: 'Dallas', state: 'TX', zip: '75235', lat: 32.8471, lng: -96.8518, keys: ['love field', 'dallas love'] },
  ];

  const AREA_BIAS = {
    'Greater Houston area': { lat: 29.95, lng: -95.4 },
    'Waco area': { lat: 31.55, lng: -97.15 },
  };
  const DEFAULT_BIAS = { lat: 30.05, lng: -95.4 };
  // Nearby search radius for place suggestions (same as the rider app).
  const SEARCH_RADIUS_MI = 40;

  // Local ZIP -> city, only used when map data has no city (unincorporated areas). Same list as the rider app.
  const ZIP_CITY = {
    '77301': 'Conroe', '77302': 'Conroe', '77303': 'Conroe', '77304': 'Conroe', '77306': 'Conroe',
    '77384': 'Conroe', '77385': 'Conroe',
    '77316': 'Montgomery', '77356': 'Montgomery',
    '77380': 'The Woodlands', '77381': 'The Woodlands', '77382': 'The Woodlands',
    '77354': 'Magnolia', '77355': 'Magnolia',
    '77375': 'Tomball', '77377': 'Tomball',
    '77357': 'New Caney', '77365': 'Porter', '77372': 'Splendora',
    '77373': 'Spring', '77379': 'Spring', '77386': 'Spring', '77388': 'Spring', '77389': 'Spring',
    '77338': 'Humble', '77346': 'Humble',
    '77868': 'Navasota', '77320': 'Huntsville', '77340': 'Huntsville',
  };

  const POI_KINDS = {
    supermarket: 'Grocery store', convenience: 'Convenience store', fuel: 'Gas station',
    restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Cafe', bar: 'Bar', pub: 'Bar',
    pharmacy: 'Pharmacy', hospital: 'Hospital', clinic: 'Clinic', doctors: 'Doctor', dentist: 'Dentist',
    aerodrome: 'Airport', terminal: 'Airport terminal', hotel: 'Hotel', motel: 'Motel',
    school: 'School', college: 'College', university: 'University', place_of_worship: 'Church',
    bank: 'Bank', department_store: 'Department store', mall: 'Mall', car_repair: 'Auto repair',
    parking: 'Parking', bus_station: 'Bus station', station: 'Station', cinema: 'Movie theater',
    post_office: 'Post office', library: 'Library', townhall: 'City hall', courthouse: 'Courthouse',
    hardware: 'Hardware store', doityourself: 'Hardware store', variety_store: 'Store', general: 'Store',
  };

  const STATE_CODES = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
    delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
    kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
    minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
    'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
    'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  };

  const els = {
    form: document.getElementById('estimate-form'),
    contactName: document.getElementById('contact-name'),
    contactEmail: document.getElementById('contact-email'),
    contactPhone: document.getElementById('contact-phone'),
    flightDetails: document.getElementById('flight-details'),
    airline: document.getElementById('airline'),
    flightNumber: document.getElementById('flight-number'),
    flightDirection: document.getElementById('flight-direction'),
    textRequestButton: document.getElementById('text-request-btn'),
    promoBookButton: document.getElementById('promo-book-btn'),
    textRequestNote: document.getElementById('text-request-note'),
    requestConfirm: document.getElementById('request-confirm'),
    requestFine: document.getElementById('request-fine'),
    estimateButton: document.getElementById('estimate-btn'),
    manualMilesField: document.getElementById('manual-miles-field'),
    manualMiles: document.getElementById('manual-miles'),
    serviceType: document.getElementById('service-type'),
    passengers: document.getElementById('passengers'),
    stopsList: document.getElementById('stops-list'),
    addStopButton: document.getElementById('add-stop-btn'),
    stopsPrice: document.getElementById('stops-price'),
    useLocation: document.getElementById('use-location'),
    ratePreview: document.getElementById('rate-preview'),
    rideDate: document.getElementById('ride-date'),
    rideTime: document.getElementById('ride-time'),
    apiBanner: document.getElementById('api-banner'),
    map: document.getElementById('map'),
    routeStatus: document.getElementById('route-status'),
    resultsCard: document.getElementById('results'),
    resultsEmpty: document.getElementById('results-empty'),
    resultsBody: document.getElementById('results-body'),
    milesLine: document.getElementById('miles-line'),
    tierLine: document.getElementById('tier-line'),
    airportLine: document.getElementById('airport-line'),
    lineItems: document.getElementById('line-items'),
    totalAmount: document.getElementById('total-amount'),
    returnNote: document.getElementById('return-note'),
    callQuote: document.getElementById('call-quote'),
    year: document.getElementById('year'),
    areaGroup: document.getElementById('service-area-group'),
    bookingPanel: document.getElementById('booking-panel'),
    areaLine: document.getElementById('area-line'),
  };

  let directionsService = null;
  let mapsReady = false;
  let lastEstimate = null;
  let bookingToken = 0;
  let hereBias = null; // { lat, lng, at } from "Use current location" (or quietly if location is already allowed)

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

  /** Billing miles: always round UP to the next whole mile (10.01 → 11). Exact whole miles stay as-is. */
  function billedMiles(miles) {
    const m = Math.max(0, Number(miles) || 0);
    // Trim floating-point noise (e.g. 12.0000000001) before rounding up.
    return Math.ceil(Math.round(m * 1000) / 1000);
  }

  /**
   * Tier selection (from the requested pickup date + time, Central):
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

  /** True when the requested pickup is less than 24 hours from now (and not already past). */
  function isShortNotice(dateStr, timeStr, nowMs) {
    const start = chicagoWallToMs(dateStr, timeStr);
    if (!isFinite(start)) return false;
    const diff = start - (nowMs == null ? Date.now() : nowMs);
    return diff >= 0 && diff < 24 * 60 * 60 * 1000;
  }

  function computeEstimate({ miles, serviceType, passengers, stops, dateStr, timeStr, isHoliday, shortNotice, airport }) {
    if (serviceType === 'hourly' || serviceType === 'van') {
      return { callForQuote: true, serviceType };
    }

    const tier = resolveTier(dateStr, timeStr, isHoliday);
    const pax = Math.max(1, Number(passengers) || 1);
    const extraStops = Math.max(0, Number(stops) || 0);
    const actualMiles = Math.max(0, Number(miles) || 0);
    const shownMiles = Math.round(actualMiles * 10) / 10;
    const mi = billedMiles(actualMiles);

    const items = [];
    let subtotal = 0;

    let base = RATES.localBase;
    let baseLabel = 'Local base (includes 2 passengers)';
    const kind = airport && airport.kind;
    const where = airport && airport.label ? ' — ' + airport.label : '';

    if (kind === 'airport-drop') {
      base = tier.airportDrop;
      baseLabel = 'Airport drop-off base' + where;
    } else if (kind === 'airport-pick') {
      base = tier.airportPick;
      baseLabel = 'Airport pick-up base' + where;
    }

    items.push({ label: baseLabel, amount: base });
    subtotal += base;

    const mileage = mi * tier.perMile;
    items.push({
      label: `Mileage (${mi} mi × $${tier.perMile.toFixed(2)})`,
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

    const stateTax = Math.round(total * 0.0825 * 100) / 100;
    items.push({
      label: 'Texas tax (8.25%)',
      amount: stateTax,
    });
    total = Math.round((total + stateTax) * 100) / 100;

    return {
      callForQuote: false,
      tier,
      miles: mi,
      actualMiles: shownMiles,
      items,
      total,
      over75: mi > 75,
      airport: airport || null,
      holiday: !!isHoliday,
      shortNotice: !!shortNotice,
    };
  }

  function serviceArea() {
    const picked = els.form.querySelector('input[name="service-area"]:checked');
    return picked ? picked.value : '';
  }

  function updateAreaLine() {
    if (!els.areaLine) return;
    const area = serviceArea();
    els.areaLine.hidden = !area;
    els.areaLine.textContent = area ? 'Service area: ' + area : '';
  }

  function requireServiceArea() {
    if (serviceArea()) return true;
    const first = document.getElementById('service-area-houston');
    if (els.areaGroup && els.areaGroup.scrollIntoView) els.areaGroup.scrollIntoView({ block: 'center' });
    if (first && first.reportValidity) first.reportValidity();
    showRouteStatus('Choose Greater Houston area or Waco area.', true);
    return false;
  }

  /* ---------- Address blocks: From, To, and optional stops ---------- */

  const PARTS = ['line1', 'line2', 'city', 'state', 'zip'];

  function blockByKey(key) {
    return els.form.querySelector('.addr-block[data-addr="' + key + '"]');
  }

  function partEl(block, part) {
    return block ? block.querySelector('[data-part="' + part + '"]') : null;
  }

  function partVal(block, part) {
    const el = partEl(block, part);
    return el ? el.value.trim() : '';
  }

  function stopBlocks() {
    if (!els.stopsList) return [];
    return Array.from(els.stopsList.querySelectorAll('.addr-block'));
  }

  function routeBlocks() {
    return [blockByKey('pickup')].concat(stopBlocks(), [blockByKey('dropoff')]).filter(Boolean);
  }

  /**
   * A stop is usable for routing when Line 1 is filled and either City + State are filled or the block has a map point
   * (picked suggestion / current location). A missing city never blocks a GPS pickup.
   */
  function blockComplete(block) {
    if (!partVal(block, 'line1')) return false;
    if (blockPoint(block)) return true;
    return !!(partVal(block, 'city') && partVal(block, 'state'));
  }

  function blockTouched(block) {
    return ['line1', 'city', 'zip'].some((p) => !!partVal(block, p));
  }

  /** City is only required when there is no map point for the address. */
  function syncCityRequired(block) {
    const city = partEl(block, 'city');
    if (city) city.required = !blockPoint(block);
  }

  /** Full address for the text message: Line 1, Line 2, City, ST ZIP. */
  function composeAddress(block, opts) {
    if (!block) return '';
    const withLine2 = !opts || opts.line2 !== false;
    const stZip = [partVal(block, 'state'), partVal(block, 'zip')].filter(Boolean).join(' ');
    return [
      partVal(block, 'line1'),
      withLine2 ? partVal(block, 'line2') : '',
      partVal(block, 'city'),
      stZip,
    ].filter(Boolean).join(', ');
  }

  /** Address used for map lookups (Line 2 like "Apt 4" confuses route lookups, so it is left out). */
  function routeQuery(block) {
    return composeAddress(block, { line2: false });
  }

  function pickupAddress() {
    return composeAddress(blockByKey('pickup'));
  }

  function dropoffAddress() {
    return composeAddress(blockByKey('dropoff'));
  }

  function stopAddresses() {
    return stopBlocks().filter(blockComplete).map((b) => composeAddress(b));
  }

  function routeAddresses() {
    return [pickupAddress(), ...stopAddresses(), dropoffAddress()].filter(Boolean);
  }

  function blockPoint(block) {
    if (!block) return null;
    const lat = parseFloat(block.dataset.lat);
    const lng = parseFloat(block.dataset.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng };
  }

  function clearBlockPlace(block) {
    if (!block) return;
    delete block.dataset.lat;
    delete block.dataset.lng;
    delete block.dataset.kind;
    delete block.dataset.code;
    syncCityRequired(block);
  }

  function addressFieldsHtml(key) {
    const field = (part, label, attrs) =>
      '<div class="field">' +
        '<label for="' + key + '-' + part + '" data-for-part="' + part + '">' + label + '</label>' +
        '<input type="text" id="' + key + '-' + part + '" data-part="' + part + '" name="pcs-' + key + '-' + part + '" autocomplete="off" readonly ' + attrs + ' />' +
      '</div>';
    return (
      '<div class="field addr-line1">' +
        '<div class="label-row"><label for="' + key + '-line1" data-for-part="line1">Address line 1</label></div>' +
        '<input type="text" id="' + key + '-line1" data-part="line1" name="pcs-' + key + '-line1" autocomplete="off" autocorrect="off" spellcheck="false" readonly required maxlength="140" placeholder="Search a place or street address" aria-autocomplete="list" aria-controls="' + key + '-suggest" />' +
        '<div class="suggest" id="' + key + '-suggest" role="listbox" hidden></div>' +
      '</div>' +
      field('line2', 'Address line 2 <span class="optional-tag">optional</span>', 'maxlength="80" placeholder="Apt, suite, gate, terminal"') +
      '<div class="row three">' +
        field('city', 'City', 'required maxlength="80" placeholder="City"') +
        field('state', 'State', 'required maxlength="30" value="TX" placeholder="TX"') +
        field('zip', 'ZIP', 'inputmode="numeric" maxlength="10" pattern="\\d{5}(-\\d{4})?" placeholder="ZIP"') +
      '</div>'
    );
  }

  function renumberStops() {
    stopBlocks().forEach((block, index) => {
      const n = index + 1;
      const key = 'stop-' + n;
      block.dataset.addr = key;
      const title = block.querySelector('.stop-label');
      if (title) title.textContent = 'Stop ' + n;
      block.setAttribute('aria-label', 'Stop ' + n);
      PARTS.forEach((part) => {
        const input = partEl(block, part);
        const label = block.querySelector('label[data-for-part="' + part + '"]');
        if (input) {
          input.id = key + '-' + part;
          input.name = 'pcs-' + key + '-' + part;
        }
        if (label) label.htmlFor = key + '-' + part;
      });
      const box = block.querySelector('.suggest');
      if (box) box.id = key + '-suggest';
      const line1 = partEl(block, 'line1');
      if (line1) line1.setAttribute('aria-controls', key + '-suggest');
    });
    updateStopsUi();
  }

  function updateStopsUi() {
    const count = stopBlocks().length;
    if (els.addStopButton) {
      els.addStopButton.hidden = count >= MAX_STOPS;
      els.addStopButton.textContent = count ? '+ Add another stop' : '+ Add a stop';
    }
  }

  function addStop(options) {
    if (!els.stopsList || stopBlocks().length >= MAX_STOPS) return null;
    const n = stopBlocks().length + 1;
    const key = 'stop-' + n;
    const block = document.createElement('div');
    block.className = 'addr-block stop-block';
    block.setAttribute('role', 'group');
    block.dataset.addr = key;
    block.innerHTML =
      '<div class="stop-card-head">' +
        '<p class="stop-label">Stop ' + n + '</p>' +
        '<button type="button" class="btn-remove-stop">Remove</button>' +
      '</div>' +
      addressFieldsHtml(key);
    els.stopsList.appendChild(block);
    renumberStops();
    if (!options || options.save !== false) {
      saveDraft();
      const first = partEl(block, 'line1');
      if (first && (!options || options.focus !== false)) {
        first.removeAttribute('readonly');
        first.focus();
      }
    }
    return block;
  }

  function incompleteStopBlock() {
    return stopBlocks().find((block) => !blockComplete(block)) || null;
  }

  /* ---------- Airport detection (automatic airport fee) ---------- */

  function normText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function airportByCode(code) {
    const c = String(code || '').toUpperCase();
    return AIRPORTS.find((a) => a.code === c) || null;
  }

  /** Known airport referenced by text: "IAH", "Hobby", "2800 N Terminal Rd", "Waco Regional Airport"… */
  function knownAirportInText(text) {
    const raw = String(text || '');
    const norm = ' ' + normText(raw) + ' ';
    for (let i = 0; i < AIRPORTS.length; i += 1) {
      const a = AIRPORTS[i];
      // IATA code typed as its own word in capitals (IAH, HOU, ACT …) or "xxx airport".
      if (new RegExp('(^|[^A-Za-z])' + a.code + '([^A-Za-z]|$)').test(raw)) return a;
      if (norm.indexOf(' ' + a.code.toLowerCase() + ' airport ') !== -1) return a;
      if (norm.indexOf(' ' + normText(a.name) + ' ') !== -1) return a;
      if (a.keys.some((k) => norm.indexOf(' ' + k + ' ') !== -1)) return a;
      if (norm.indexOf(' ' + normText(a.line1) + ' ') !== -1 &&
        norm.indexOf(' ' + normText(a.city) + ' ') !== -1) return a;
    }
    return null;
  }

  /** Generic "… Airport" place names (any airport), ignoring streets like "Airport Blvd" and nearby hotels. */
  function genericAirportText(text) {
    const s = normText(text);
    if (!/\b(airport|intl airport|international airport|regional airport|aerodrome|airfield)\b/.test(s)) return false;
    if (/\b(hotel|inn|suites|motel|lodge|resort|apartments?|rv park|storage)\b/.test(s)) return false;
    const withoutStreets = s.replace(/\bairport (rd|road|blvd|boulevard|dr|drive|way|ln|lane|st|street|pkwy|parkway|fwy|freeway|hwy|highway|ave|avenue|loop|cir|circle|ct|court|plaza)\b/g, ' ');
    return /\b(airport|aerodrome|airfield)\b/.test(withoutStreets);
  }

  /** Airport info for one address block: { code, name } or null. */
  function blockAirport(block) {
    if (!block) return null;
    const kind = block.dataset.kind;
    const code = block.dataset.code;
    if (kind === 'airport') {
      const known = airportByCode(code);
      return { code: known ? known.code : (code || ''), name: known ? known.name : partVal(block, 'line1') };
    }
    const text = [partVal(block, 'line1'), partVal(block, 'line2'), partVal(block, 'city')].join(' ');
    if (kind === 'place') {
      // A picked non-airport place: only a typed IATA code / known airport name still counts.
      const known = knownAirportInText(partVal(block, 'line1'));
      return known ? { code: known.code, name: known.name } : null;
    }
    const known = knownAirportInText(text);
    if (known) return { code: known.code, name: known.name };
    if (genericAirportText(partVal(block, 'line1'))) return { code: '', name: partVal(block, 'line1') };
    return null;
  }

  /**
   * Airport fee kind from the route:
   * - From is an airport → airport pick-up base (also when both ends are airports)
   * - To (or a stop) is an airport → airport drop-off base
   */
  function detectAirport() {
    const pick = blockAirport(blockByKey('pickup'));
    const drop = blockAirport(blockByKey('dropoff'));
    let stop = null;
    stopBlocks().forEach((b) => { if (!stop && blockComplete(b)) stop = blockAirport(b); });
    const label = (a) => (a.code ? a.code : (a.name || 'airport'));
    if (pick) return { kind: 'airport-pick', code: pick.code, label: label(pick), where: 'pickup' };
    if (drop) return { kind: 'airport-drop', code: drop.code, label: label(drop), where: 'dropoff' };
    if (stop) return { kind: 'airport-drop', code: stop.code, label: label(stop), where: 'stop' };
    return null;
  }

  function airportSummary(airport) {
    if (!airport) return '';
    const kind = airport.kind === 'airport-pick' ? 'Airport pick-up' : 'Airport drop-off';
    return kind + (airport.label ? ' (' + airport.label + ')' : '');
  }

  /* ---------- Place suggestions (Address line 1) ---------- */
  // v16: same search as the rider app: built-in airports, then OpenStreetMap places (Photon) ranked by
  // best text match, then real distance from you (current location) → your From pin → the service area.
  // Each suggestion shows its distance.

  let suggestTimer = 0;
  let suggestSeq = 0;
  let originPriming = false;

  function stateCode(name) {
    if (!name) return '';
    const n = String(name).trim();
    if (n.length === 2) return n.toUpperCase();
    return STATE_CODES[n.toLowerCase()] || n;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  function haversineMiles(a, b) {
    const R = 3958.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function isCoord(n) {
    return n !== null && n !== '' && isFinite(Number(n));
  }

  function hereFresh() {
    const h = hereBias;
    if (!h || !isCoord(h.lat) || !isCoord(h.lng)) return null;
    if (Date.now() - Number(h.at || 0) > 30 * 60 * 1000) return null;
    return { lat: +h.lat, lng: +h.lng };
  }

  /** Where "nearest" is measured from: your location → From pin → service area. */
  function searchOrigin(block) {
    const here = hereFresh();
    if (here) return { point: here, from: 'you' };
    const from = blockPoint(blockByKey('pickup'));
    if (from && block && block.dataset.addr !== 'pickup') return { point: from, from: 'pickup' };
    return { point: AREA_BIAS[serviceArea()] || DEFAULT_BIAS, from: '' };
  }

  /** If location is already allowed, grab it quietly so "nearest" means nearest to you. Never prompts. */
  function primeSearchOrigin() {
    if (hereFresh() || originPriming) return;
    if (!navigator.geolocation || !navigator.permissions || !navigator.permissions.query) return;
    originPriming = true;
    navigator.permissions.query({ name: 'geolocation' }).then((status) => {
      if (!status || status.state !== 'granted') { originPriming = false; return; }
      navigator.geolocation.getCurrentPosition((pos) => {
        originPriming = false;
        hereBias = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
      }, () => { originPriming = false; }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
    }).catch(() => { originPriming = false; });
  }

  function fmtMiles(d) {
    if (!isFinite(d)) return '';
    return (d < 10 ? d.toFixed(1) : String(Math.round(d))) + ' mi';
  }

  function suggestNoteHtml(origin) {
    if (origin && origin.from === 'you') return '<p class="suggest-note">Closest to you first</p>';
    if (origin && origin.from === 'pickup') return '<p class="suggest-note">Closest to your pickup first</p>';
    return '<p class="suggest-note">Tip: tap Use current location for the closest places</p>';
  }

  function airportMatches(q, originPoint) {
    const raw = String(q || '').trim();
    if (raw.length < 2) return [];
    const norm = normText(raw);
    const out = [];
    AIRPORTS.forEach((a) => {
      const code = a.code.toLowerCase();
      const tokens = norm.split(' ');
      const hit = tokens.indexOf(code) !== -1 ||
        (norm.length >= 3 && normText(a.name).indexOf(norm) === 0) ||
        (norm.length >= 4 && normText(a.name).indexOf(norm) !== -1) ||
        a.keys.some((k) => (norm.length >= 3 && k.indexOf(norm) === 0) || norm.indexOf(k) !== -1);
      if (hit) out.push(a);
    });
    return out.slice(0, 3).map((a) => ({
      main: a.name + ' (' + a.code + ')',
      sub: a.line1 + ', ' + a.city + ', ' + a.state + ' ' + a.zip,
      dist: originPoint ? fmtMiles(haversineMiles(originPoint, a)) : '',
      resolve: () => Promise.resolve({
        line1: a.name + ' (' + a.code + '), ' + a.line1,
        city: a.city, state: a.state, zip: a.zip, lat: a.lat, lng: a.lng,
        kind: 'airport', code: a.code,
      }),
    }));
  }

  /** City from OpenStreetMap properties: city/town/village, then local ZIP list, then county (never a POI name). */
  function cityFromProps(p) {
    p = p || {};
    const poi = normText(p.name);
    const picks = [p.city, p.town, p.village, p.hamlet];
    for (let i = 0; i < picks.length; i += 1) {
      const c = String(picks[i] || '').trim();
      if (c && normText(c) !== poi) return c;
    }
    const zip = String(p.postcode || '').slice(0, 5);
    if (ZIP_CITY[zip]) return ZIP_CITY[zip];
    const county = String(p.county || '').trim();
    if (county) return /county$/i.test(county) ? county : county + ' County';
    const district = String(p.district || '').trim();
    if (district && normText(district) !== poi) return district;
    return '';
  }

  function photonIsPoi(p) {
    if (!p || !p.name) return false;
    const key = String(p.osm_key || '');
    return ['highway', 'place', 'boundary', 'landuse', 'natural', 'waterway'].indexOf(key) === -1;
  }

  function photonPlace(feature) {
    const p = (feature && feature.properties) || {};
    const c = (feature && feature.geometry && feature.geometry.coordinates) || [];
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const poi = photonIsPoi(p);
    const isAirport = p.osm_key === 'aeroway' && /^(aerodrome|terminal)$/.test(String(p.osm_value || ''));
    const known = isAirport ? knownAirportInText(p.name) : null;
    let name = p.name || '';
    if (known && name.indexOf('(' + known.code + ')') === -1) name += ' (' + known.code + ')';
    let line1;
    if (poi) line1 = street && normText(name) !== normText(street) ? name + ', ' + street : name;
    else line1 = street || name || '';
    return {
      line1,
      city: cityFromProps(p),
      state: stateCode(p.state),
      zip: String(p.postcode || '').slice(0, 10),
      lat: isCoord(c[1]) ? +c[1] : NaN,
      lng: isCoord(c[0]) ? +c[0] : NaN,
      kind: isAirport ? 'airport' : (poi ? 'place' : 'address'),
      code: known ? known.code : '',
      category: poi ? (POI_KINDS[String(p.osm_value || '')] || '') : '',
    };
  }

  function photonFetch(params) {
    return withTimeout(fetch('https://photon.komoot.io/api/?' + params).then((res) => {
      if (!res.ok) throw new Error('photon');
      return res.json();
    }), 15000).then((data) => (data && data.features) || []).catch(() => []);
  }

  function searchWords(q) {
    const skip = { tx: 1, texas: 1, usa: 1, us: 1, the: 1, of: 1, and: 1, at: 1, near: 1 };
    return normText(q).split(' ').filter((w) => w.length >= 2 && !skip[w]);
  }

  function wordStarts(text, piece) {
    if (!piece) return false;
    return (' ' + normText(text)).indexOf(' ' + piece) !== -1;
  }

  function looksLikeAddress(text) {
    return /^\s*\d+\s+/.test(String(text || ''));
  }

  /** 0 = name/address matches what was typed, 1 = partial match, 2 = loose match. */
  function placeTier(p, q) {
    const words = searchWords(q);
    const num = looksLikeAddress(q) ? (normText(q).split(' ')[0] || '') : '';
    const text = words.filter((w) => !/^\d+$/.test(w));
    const name = p.name || '';
    const street = p.street || '';
    if (num) {
      const streetHit = !text.length || text.some((w) => wordStarts(street, w) || wordStarts(name, w));
      if (normText(p.housenumber) === num && streetHit) return 0;
      return streetHit ? 1 : 2;
    }
    if (!text.length) return 1;
    if (text.every((w) => wordStarts(name, w))) return 0;
    if (text.some((w) => wordStarts(name, w) || wordStarts(street, w))) return 1;
    return 2;
  }

  /** Best text match first, then (when geocoding a typed address) same city/ZIP, then real distance. */
  function rankPlaces(features, q, origin, want) {
    const seen = {};
    const wantGas = /\b(gas|fuel|station|pump)\b/.test(normText(q));
    let items = [];
    (features || []).forEach((f) => {
      const p = (f && f.properties) || {};
      if (p.countrycode && String(p.countrycode).toUpperCase() !== 'US') return;
      const place = photonPlace(f);
      if (!isFinite(place.lat) || !isFinite(place.lng) || !place.line1) return;
      const idA = String(p.osm_type || '') + String(p.osm_id || '');
      const idB = normText(place.line1) + '|' + place.zip;
      if ((idA && seen[idA]) || seen[idB]) return;
      if (idA) seen[idA] = 1;
      seen[idB] = 1;
      let cityKey = 0;
      if (want && (want.city || want.zip)) {
        const cityOk = want.city && normText(cityFromProps(p)) === normText(want.city);
        const zipOk = want.zip && String(p.postcode || '').slice(0, 5) === String(want.zip).slice(0, 5);
        cityKey = cityOk || zipOk ? 0 : 1;
      }
      items.push({
        place,
        tier: placeTier(p, q),
        cityKey,
        fuel: String(p.osm_value || '') === 'fuel',
        nameKey: normText(p.name),
        dist: haversineMiles(origin, { lat: place.lat, lng: place.lng }),
      });
    });
    // Drop matches more than 300 miles away.
    items = items.filter((it) => !(it.dist > 300));
    if (!wantGas) {
      // Fuel pumps next to the same store are folded into the store.
      items = items.filter((it) => {
        if (!it.fuel || !it.nameKey) return true;
        return !items.some((other) => other !== it && !other.fuel && other.nameKey === it.nameKey &&
          haversineMiles({ lat: other.place.lat, lng: other.place.lng }, { lat: it.place.lat, lng: it.place.lng }) < 0.5);
      });
    }
    items.sort((a, b) => (a.tier - b.tier) || (a.cityKey - b.cityKey) || (a.dist - b.dist));
    return items;
  }

  function findPlaces(q, origin, want) {
    const o = (origin && origin.point) || DEFAULT_BIAS;
    const lat = o.lat.toFixed(5);
    const lon = o.lng.toFixed(5);
    const dLat = SEARCH_RADIUS_MI / 69;
    const dLon = SEARCH_RADIUS_MI / (69 * Math.cos((o.lat * Math.PI) / 180));
    const bbox = [o.lng - dLon, o.lat - dLat, o.lng + dLon, o.lat + dLat].map((n) => n.toFixed(4)).join(',');
    // location_bias_scale low = distance matters more than how "famous" a place is.
    const common = 'lang=en&lat=' + lat + '&lon=' + lon + '&location_bias_scale=0.1&zoom=12&q=' + encodeURIComponent(q);
    const calls = [
      photonFetch('limit=15&bbox=' + bbox + '&' + common), // nearby (about 40 mi around)
      photonFetch('limit=8&' + common), // farther places (airports, other cities) still show
    ];
    const streetOnly = looksLikeAddress(q) ? String(q).replace(/^\s*\d+[A-Za-z]?\s+/, '') : '';
    if (streetOnly.length >= 3) {
      // Map data often has the street but not each house number: also look up the street by itself.
      calls.push(photonFetch('limit=8&bbox=' + bbox + '&' + common.replace(/&q=.*$/, '&q=' + encodeURIComponent(streetOnly))));
    }
    return Promise.all(calls).then((lists) => rankPlaces([].concat.apply([], lists), q, o, want));
  }

  /* Google address suggestions (street addresses only; places come from the rider app's search above).
     Google returns each suggestion's distance from you, so these are sorted nearest first too. */
  let legacyAutocomplete = null;
  let legacyPlaces = null;
  let placesToken = null;

  function googlePlacesReady() {
    return !!(mapsReady && window.google && google.maps && google.maps.places && google.maps.places.AutocompleteService);
  }

  function componentsToPlace(comps, name, types, lat, lng, nameKey) {
    const get = (type, short) => {
      const c = (comps || []).find((x) => (x.types || []).indexOf(type) !== -1);
      if (!c) return '';
      return short ? (c.short_name || c.long_name || '') : (c.long_name || c.short_name || '');
    };
    const street = [get('street_number'), get('route', true)].filter(Boolean).join(' ');
    const zip = get('postal_code');
    // City = locality (never the county).
    const city = get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3') ||
      ZIP_CITY[String(zip).slice(0, 5)] || get('neighborhood');
    const state = get('administrative_area_level_1', true);
    const t = types || [];
    const isAirport = t.indexOf('airport') !== -1;
    const isPoi = isAirport || t.indexOf('establishment') !== -1 || t.indexOf('point_of_interest') !== -1;
    const known = isAirport ? (knownAirportInText(name) || null) : null;
    let label = String(name || '');
    if (known && label.indexOf('(' + known.code + ')') === -1) label += ' (' + known.code + ')';
    let line1 = street;
    if (isPoi && label && normText(label) !== normText(street)) line1 = street ? label + ', ' + street : label;
    if (!line1) line1 = label || nameKey || '';
    return {
      line1, city, state: stateCode(state), zip, lat, lng,
      kind: isAirport ? 'airport' : (isPoi ? 'place' : 'address'),
      code: known ? known.code : '',
    };
  }

  /** "3131 Canterbury Ln" + "Montgomery, TX, USA" → address fields (used if the details lookup fails). */
  function textPlace(main, secondary) {
    const parts = String(secondary || '').split(',').map((x) => x.trim()).filter((x) => x && x !== 'USA');
    return { line1: main, city: parts[0] || '', state: stateCode(parts[1] || 'TX'), zip: '', lat: NaN, lng: NaN, kind: 'address' };
  }

  function googleDetails(pred, sf) {
    const fallback = () => textPlace(sf.main_text || pred.description, sf.secondary_text);
    return new Promise((resolve) => {
      try {
        if (!legacyPlaces) legacyPlaces = new google.maps.places.PlacesService(document.createElement('div'));
        const req = { placeId: pred.place_id, fields: ['name', 'address_components', 'geometry', 'types'] };
        if (placesToken) req.sessionToken = placesToken;
        legacyPlaces.getDetails(req, (place, status) => {
          placesToken = null;
          if (status !== 'OK' || !place) { resolve(fallback()); return; }
          const loc = place.geometry && place.geometry.location;
          resolve(componentsToPlace(place.address_components, place.name, place.types,
            loc ? loc.lat() : NaN, loc ? loc.lng() : NaN, sf.main_text));
        });
      } catch (err) {
        resolve(fallback());
      }
    });
  }

  function googleSuggest(q, origin) {
    if (!googlePlacesReady()) return Promise.resolve(null);
    const P = google.maps.places;
    try {
      if (!legacyAutocomplete) legacyAutocomplete = new P.AutocompleteService();
      if (!placesToken && P.AutocompleteSessionToken) placesToken = new P.AutocompleteSessionToken();
    } catch (err) {
      return Promise.resolve(null);
    }
    const o = { lat: origin.point.lat, lng: origin.point.lng };
    return withTimeout(new Promise((resolve, reject) => {
      const req = { input: q, origin: o, locationBias: { center: o, radius: 50000 }, componentRestrictions: { country: 'us' } };
      if (placesToken) req.sessionToken = placesToken;
      legacyAutocomplete.getPlacePredictions(req, (preds, status) => {
        if (status === 'OK') resolve(preds || []);
        else if (status === 'ZERO_RESULTS') resolve([]);
        else reject(new Error(String(status)));
      });
    }), 6000).then((preds) => preds
      .map((pred, i) => ({ pred, i, d: pred.distance_meters != null && isFinite(pred.distance_meters) ? pred.distance_meters / 1609.344 : Infinity }))
      .filter((x) => x.d === Infinity || x.d <= 300)
      .sort((a, b) => (a.d - b.d) || (a.i - b.i))
      .slice(0, 5)
      .map(({ pred, d }) => {
        const sf = pred.structured_formatting || {};
        return {
          main: sf.main_text || pred.description,
          sub: String(sf.secondary_text || '').replace(/,\s*USA$/, ''),
          dist: isFinite(d) ? fmtMiles(d) : '',
          resolve: () => googleDetails(pred, sf),
        };
      })).catch(() => null);
  }

  /* v19: Google Places through the pcs-pay Worker. One session token per address block (autocomplete + details =
     one billed session). Capped / error -> null, and the v18 search runs. */
  const placesSessions = new WeakMap();
  let placesOffUntil = 0;
  const GOOGLE_ATTRIB = '<p class="suggest-note powered-by-google" style="text-align:right;margin:0;padding:6px 12px;font-size:12px;opacity:.85">Powered by Google</p>';

  function placesBase() {
    const c = window.PCS_SQUARE || {};
    return String(c.placesUrl || (c.workerUrl ? String(c.workerUrl).replace(/\/+$/, '') + '/places' : '')).trim().replace(/\/+$/, '');
  }
  function newPlacesToken() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* older browser */ }
    let h = '';
    for (let i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
  }
  function workerPlacesToken(block) {
    let t = placesSessions.get(block);
    if (!t) { t = newPlacesToken(); placesSessions.set(block, t); }
    return t;
  }
  function placesPost(path, body, ms) {
    const base = placesBase();
    if (!base || Date.now() < placesOffUntil) return Promise.resolve(null);
    return withTimeout(fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((res) => res.json()), ms || 4000).then((data) => {
      if (!data || !data.ok) return null;
      if (data.capped) { placesOffUntil = Date.now() + 30 * 60000; return null; }
      if (data.fallback) return null;
      return data;
    }).catch(() => null);
  }
  function isBusinessTypes(t) {
    t = t || [];
    return t.indexOf('establishment') !== -1 || t.indexOf('point_of_interest') !== -1 || t.indexOf('airport') !== -1;
  }
  async function workerPlaceDetails(block, p) {
    const data = await placesPost('/details', { placeId: p.placeId, sessionToken: placesSessions.get(block) || '' }, 6000);
    placesSessions.delete(block);
    const d = data && data.place;
    if (!d || !isFinite(d.lat) || !isFinite(d.lng)) return textPlace(p.main, p.sub);
    const t = p.types || [];
    const isAirport = t.indexOf('airport') !== -1;
    const biz = isBusinessTypes(t);
    const known = isAirport ? (knownAirportInText(p.main) || null) : null;
    let label = String(p.main || '');
    if (known && label.indexOf('(' + known.code + ')') === -1) label += ' (' + known.code + ')';
    const street = String(d.street || '');
    let line1 = street;
    if (biz && label && normText(label) !== normText(street)) line1 = street ? label + ', ' + street : label;
    if (!line1) line1 = label;
    return {
      line1, city: d.city || '', state: stateCode(d.state || 'TX'), zip: String(d.zip || '').slice(0, 5), lat: +d.lat, lng: +d.lng,
      kind: isAirport ? 'airport' : (biz ? 'place' : 'address'), code: known ? known.code : '',
      unit: /^[A-Za-z]?\d+[A-Za-z]?$/.test(String(d.unit || '').trim()) ? '#' + String(d.unit).trim() : String(d.unit || '').trim(),
    };
  }
  // v61: Google bias when there is no current location / From pin: the chosen service area (not all of Texas).
  const GOOGLE_AREA_BIAS = {
    'Greater Houston area': { lat: 29.7604, lng: -95.3698 },
    'Waco area': { lat: 31.55, lng: -97.15 },
  };
  const GOOGLE_AREA_MI = 50; // about 80 km around the area center (Houston: Conroe / The Woodlands / Montgomery)
  // With the default area bias, matches inside the area come first (Google's order kept inside each group).
  // p.miles is the Worker's distance from the bias point. Location / From-pin bias keeps Google's order.
  function rankAreaFirst(preds, bias) {
    if (!bias || !bias.area || !Array.isArray(preds)) return preds;
    const inArea = (p) => p && p.miles != null && isFinite(p.miles) && +p.miles <= GOOGLE_AREA_MI;
    return preds.filter(inArea).concat(preds.filter((p) => !inArea(p)));
  }
  function workerPlacesBias(origin) {
    if (origin && origin.from && origin.point && isFinite(origin.point.lat) && isFinite(origin.point.lng)) {
      return { lat: +origin.point.lat, lng: +origin.point.lng, area: false };
    }
    const a = GOOGLE_AREA_BIAS[serviceArea()] || GOOGLE_AREA_BIAS['Greater Houston area'];
    return { lat: a.lat, lng: a.lng, area: true };
  }
  async function workerGoogleSuggest(block, q, origin) {
    const body = { input: q, sessionToken: workerPlacesToken(block) };
    const bias = workerPlacesBias(origin);
    body.lat = bias.lat; body.lng = bias.lng;
    const data = await placesPost('/autocomplete', body);
    if (!data || !Array.isArray(data.predictions) || !data.predictions.length) return null;
    return rankAreaFirst(data.predictions, bias).map((p) => ({
      main: p.main,
      sub: p.sub || '',
      dist: !bias.area && p.miles != null && isFinite(p.miles) ? fmtMiles(+p.miles) : '',
      google: true,
      resolve: () => workerPlaceDetails(block, p),
    }));
  }

  /** Suggestions for Address line 1, nearest first with distance labels. */
  async function placeSuggest(q, origin) {
    const items = await findPlaces(q, origin);
    const num = (q.match(/^(\d+[A-Za-z]?)\s+/) || [])[1];
    return items.slice(0, 6).map((it) => {
      let place = it.place;
      if (num && !place.category && !/^\d/.test(String(place.line1 || ''))) {
        // Typed "3131 Canterbury" but the map only knows the street: keep the house number and let the
        // route lookup find that exact house (instead of pinning the middle of the street).
        place = Object.assign({}, place, { line1: num + ' ' + place.line1, lat: NaN, lng: NaN });
      }
      let sub = [place.city, [place.state, place.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      if (place.category) sub = sub ? sub + ' · ' + place.category : place.category;
      const finalPlace = place;
      return { main: place.line1, sub, dist: fmtMiles(it.dist), resolve: () => Promise.resolve(finalPlace) };
    });
  }

  function suggestBox(block) {
    return block ? block.querySelector('.suggest') : null;
  }

  function hideSuggest(block) {
    const box = suggestBox(block);
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    box._items = null;
  }

  function hideAllSuggest(except) {
    els.form.querySelectorAll('.addr-block').forEach((b) => { if (b !== except) hideSuggest(b); });
  }

  function renderSuggest(block, items, note) {
    const box = suggestBox(block);
    if (!box) return;
    if (!items.length) { hideSuggest(block); return; }
    box._items = items;
    box._touched = false;
    box.innerHTML = (note || '') + items.map((it, i) =>
      '<button type="button" class="suggest-item" role="option" data-i="' + i + '">' +
        '<span class="suggest-main"><strong>' + escapeHtml(it.main) + '</strong>' +
        (it.dist ? '<em class="suggest-dist">' + escapeHtml(it.dist) + '</em>' : '') + '</span>' +
        (it.sub ? '<span class="suggest-sub">' + escapeHtml(it.sub) + '</span>' : '') +
      '</button>'
    ).join('') + (items.some((it) => it.google) ? GOOGLE_ATTRIB : '');
    box.hidden = false;
  }

  function scheduleSuggest(block) {
    const input = partEl(block, 'line1');
    if (!input) return;
    clearTimeout(suggestTimer);
    const q = input.value.trim();
    if (q.length < 2) { hideSuggest(block); return; }
    const seq = ++suggestSeq;
    suggestTimer = setTimeout(async () => {
      const origin = searchOrigin(block);
      const airports = airportMatches(q, origin.point);
      let more = [];
      if (q.length >= 3) {
        const box = suggestBox(block);
        if (box && document.activeElement === input && !airports.length && (!box._items || !box._items.length)) {
          box._items = [];
          box.innerHTML = '<p class="suggest-note">Searching…</p>';
          box.hidden = false;
        }
        const wg = await workerGoogleSuggest(block, q, origin);
        if (wg && wg.length) {
          more = wg; // v19: Google (businesses + addresses) via the Worker
        } else if (looksLikeAddress(q)) {
          // Street addresses: Google (knows exact house numbers), nearest first; the free search as backup.
          more = (await googleSuggest(q, origin)) || [];
          if (!more.length) more = await placeSuggest(q, origin).catch(() => []);
        } else {
          // Places: the rider app's nearest-first search. If it is slow (>4 s), show Google's list sorted by
          // distance meanwhile, then swap in the nearest-first list when it arrives (unless they already tapped).
          const free = placeSuggest(q, origin).catch(() => []);
          more = await Promise.race([free, new Promise((r) => setTimeout(() => r(null), 4000))]);
          if (more === null) {
            const g = googlePlacesReady() ? await googleSuggest(q, origin) : null;
            if (g && g.length) {
              more = g;
              free.then((list) => {
                const box = suggestBox(block);
                if (!list.length || !box || box.hidden || box._touched) return;
                if (seq !== suggestSeq || input.value.trim() !== q || document.activeElement !== input) return;
                const names = airports.map((a) => normText(a.main));
                const rest = list.filter((m) => !names.some((n) => normText(m.main).indexOf(n.replace(/ [a-z]{3}$/, '')) === 0));
                renderSuggest(block, airports.concat(rest).slice(0, 6), suggestNoteHtml(origin));
              });
            } else {
              more = await free;
            }
          }
          if (!more.length) more = (await googleSuggest(q, origin)) || [];
        }
      }
      // Results that arrive after the customer left the field (or pressed Escape) must not reopen the list.
      if (seq !== suggestSeq || input.value.trim() !== q || document.activeElement !== input) return;
      const airportNames = airports.map((a) => normText(a.main));
      more = more.filter((m) => !airportNames.some((n) => normText(m.main).indexOf(n.replace(/ [a-z]{3}$/, '')) === 0));
      const items = airports.concat(more).slice(0, 6);
      if (!items.length && q.length >= 3) {
        const box = suggestBox(block);
        if (box) {
          box._items = [];
          box.innerHTML = '<p class="suggest-note">No matches yet. Keep typing, or fill in line 1, city and ZIP yourself.</p>';
          box.hidden = false;
        }
        return;
      }
      renderSuggest(block, items, items.length ? suggestNoteHtml(origin) : '');
    }, 300);
  }

  function applyPlace(block, place) {
    if (!block || !place) return;
    const set = (part, value) => {
      const el = partEl(block, part);
      if (el && value != null) el.value = value;
    };
    set('line1', place.line1 || '');
    if (place.city) set('city', place.city);
    if (place.state) set('state', place.state);
    set('zip', place.zip || '');
    clearBlockPlace(block);
    if (isFinite(place.lat) && isFinite(place.lng)) {
      block.dataset.lat = String(place.lat);
      block.dataset.lng = String(place.lng);
    }
    if (place.kind) block.dataset.kind = place.kind === 'address' ? 'place' : place.kind;
    if (place.code) block.dataset.code = place.code;
    syncCityRequired(block);
    resetRoute();
    updateFlightDetails();
    updateRatePreview();
    saveDraft();
    markTripChanged();
    scheduleRoute();
  }

  async function pickSuggestion(block, index) {
    const box = suggestBox(block);
    const item = box && box._items && box._items[index];
    if (!item) return;
    hideSuggest(block);
    try {
      const place = await item.resolve();
      applyPlace(block, place);
      const l2 = partEl(block, 'line2');
      if (place && place.unit && l2 && !l2.value.trim()) l2.value = place.unit;
    } catch (err) {
      const input = partEl(block, 'line1');
      if (input) input.value = item.main;
      showRouteStatus('Couldn’t load that place. Check City / State / ZIP.', true);
    }
    const line2 = partEl(block, 'line2');
    if (line2) line2.removeAttribute('readonly');
  }

  /* ---------- Current location (From) ---------- */
  // v16: same as the rider app: OpenStreetMap Nominatim first (it usually has the house number), Photon reverse as
  // backup. The GPS point is always kept as the routing point, so a missing city never blocks the estimate.

  function nominatimPlace(data) {
    const a = data && data.address;
    if (!a || !a.road) return null;
    const zip = String(a.postcode || '').slice(0, 10);
    const city = a.city || a.town || a.village || a.hamlet || ZIP_CITY[zip.slice(0, 5)] || a.county || '';
    return {
      line1: [a.house_number, a.road].filter(Boolean).join(' '),
      city: String(city),
      state: stateCode(a['ISO3166-2-lvl4'] ? String(a['ISO3166-2-lvl4']).replace(/^US-/, '') : a.state),
      zip,
    };
  }

  function photonReversePlace(features) {
    const list = (features || []).filter((f) => f && f.properties);
    if (!list.length) return null;
    const rank = (f) => {
      const p = f.properties;
      if (p.housenumber && p.street) return 0;
      if (p.osm_key === 'highway' || p.type === 'street') return 1;
      if (p.street) return 2;
      return 3;
    };
    list.sort((a, b) => rank(a) - rank(b));
    const p = list[0].properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const line1 = street || (p.osm_key === 'highway' || p.type === 'street' ? p.name : '') || p.name || '';
    if (!line1) return null;
    return { line1, city: cityFromProps(p), state: stateCode(p.state), zip: String(p.postcode || '').slice(0, 10) };
  }

  /** Never rejects. */
  function reverseGeocode(lat, lng) {
    const q = 'lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
    return withTimeout(fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&' + q).then((res) => {
      if (!res.ok) throw new Error('nominatim');
      return res.json();
    }), 6000).then((data) => {
      const place = nominatimPlace(data);
      if (!place) throw new Error('nominatim-empty');
      return place;
    }).catch(() => withTimeout(fetch('https://photon.komoot.io/reverse?limit=5&lang=en&' + q).then((res) => {
      if (!res.ok) throw new Error('photon');
      return res.json();
    }), 6000).then((data) => photonReversePlace(data && data.features)).catch(() => null))
      .then((place) => place || {
        line1: 'Current location (' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + ')',
        city: '',
        state: 'TX',
        zip: '',
      });
  }

  function useCurrentLocation() {
    const btn = els.useLocation;
    if (!btn) return;
    if (!navigator.geolocation) {
      btn.textContent = 'Location not available';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Finding you…';
    const done = (label) => {
      btn.disabled = false;
      btn.textContent = label || '📍 Use current location';
    };
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      hereBias = { lat, lng, at: Date.now() };
      const block = blockByKey('pickup');
      const place = await reverseGeocode(lat, lng);
      place.lat = lat;
      place.lng = lng;
      place.kind = 'place';
      // Clear the old address first so nothing from a previous pickup (city, ZIP) is left behind.
      ['city', 'zip'].forEach((part) => { const el = partEl(block, part); if (el) el.value = ''; });
      applyPlace(block, place);
      done();
      if (!partVal(block, 'city')) {
        const city = partEl(block, 'city');
        if (city) {
          city.removeAttribute('readonly');
          city.placeholder = 'City (optional — your GPS spot is used)';
        }
      }
      const line2 = partEl(block, 'line2');
      if (line2) line2.removeAttribute('readonly');
    }, () => done('Location blocked — type the address'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }
  function isAppleSmsDevice() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad/i.test(ua)) return true;
    // iPadOS 13+ identifies as Macintosh, but still needs the iOS sms separator.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function leadNumbersFor(area) {
    if (area === 'Waco area') return LEAD_SMS_NUMBERS.concat(WACO_EXTRA_SMS_NUMBERS);
    return LEAD_SMS_NUMBERS.slice();
  }

  function smsUrl(body, area) {
    const encoded = encodeURIComponent(body);
    const joined = leadNumbersFor(area).join(',');
    // iOS: sms:/open?addresses= form (also handles the Waco two-recipient case). Android: RFC comma list + ?body=.
    if (isAppleSmsDevice()) {
      return 'sms:/open?addresses=' + joined + '&body=' + encoded;
    }
    return 'sms:' + joined + '?body=' + encoded;
  }


  function needsFlightDetails() {
    return !!detectAirport();
  }

  function updateFlightDetails() {
    const required = needsFlightDetails();
    els.flightDetails.hidden = !required;
    [els.airline, els.flightNumber, els.flightDirection].forEach((field) => {
      field.required = required;
    });
  }

  function serviceLabel() {
    const sel = els.serviceType;
    return sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : 'Standard ride';
  }

  /** Live preview of the automatic rate under the pickup date/time. */
  function updateRatePreview() {
    if (!els.ratePreview) return;
    const dateStr = els.rideDate.value;
    const timeStr = els.rideTime.value;
    if (!dateStr || !timeStr || (els.serviceType && els.serviceType.value !== 'standard')) {
      els.ratePreview.textContent = '';
      return;
    }
    const holiday = isHolidayDate(dateStr);
    const tier = resolveTier(dateStr, timeStr, holiday);
    const bits = ['Rate: ' + tier.label + ' — $' + tier.perMile.toFixed(2) + '/mi'];
    if (holiday) bits.push('holiday');
    if (isShortNotice(dateStr, timeStr)) bits.push('less than 24 hours’ notice (+25%)');
    const airport = detectAirport();
    if (airport) bits.push(airportSummary(airport).toLowerCase());
    els.ratePreview.textContent = bits.join(' · ') + '. Set automatically.';
  }

  function rideRequestBody(result, promo) {
    const lines = [
      'Hello,',
      '',
      'I would like to request a ride. Please confirm availability and the final fare.',
      '',
      'Service area: ' + serviceArea(),
      'Name: ' + els.contactName.value.trim(),
      'Phone: ' + els.contactPhone.value.trim(),
    ];
    const email = els.contactEmail.value.trim();
    if (email) lines.push('Email: ' + email);
    lines.push('From: ' + pickupAddress());
    stopAddresses().forEach((address, index) => {
      lines.push('Stop ' + (index + 1) + ': ' + address);
    });
    lines.push(
      'To: ' + dropoffAddress(),
      'Date: ' + els.rideDate.value,
      'Time: ' + els.rideTime.value,
      'Passengers: ' + els.passengers.value,
      'Service: ' + serviceLabel()
    );
    const airport = detectAirport();
    if (airport) {
      lines.push(
        'Airport: ' + airportSummary(airport),
        'Airline: ' + els.airline.value.trim(),
        'Flight number: ' + els.flightNumber.value.trim(),
        'Arrival or departure: ' + els.flightDirection.value
      );
    }
    if (result && !result.callForQuote && typeof result.total === 'number') {
      lines.push('Rate: ' + result.tier.label + (result.shortNotice ? ' + short notice' : ''));
      lines.push('Miles: ' + result.actualMiles.toFixed(1) + ' (billed ' + result.miles + ')');
      lines.push('Estimated total: ' + money(result.total));
      if (promo) {
        var offer = Math.round(result.total * 0.9 * 100) / 100;
        lines.push('10% website booking. Please apply the discount. Offer total: ' + money(offer));
        lines.push('Offer terms: book by Nov 30, pay in full, no cancel within 24h, at least 48h ahead. Rides through Dec 31.');
      } else {
        lines.push('10% website booking. Please apply the discount.');
      }
    } else if (promo) {
      lines.push('10% website booking. Please apply the discount. Book by Nov 30, pay in full, no cancel within 24h, at least 48h ahead. Rides through Dec 31.');
    } else {
      lines.push('10% website booking. Please apply the discount.');
    }
    lines.push('', 'This is a ride request only, not a booking confirmation.');
    return lines.join('\n');
  }

  /* ---------- Draft (kept in this tab only) ---------- */

  function saveDraft() {
    const data = { _stops: stopBlocks().length, _geo: {} };
    els.form.querySelectorAll('input, select, textarea').forEach((field) => {
      if (!field.id) return;
      // Auto-filled route miles are recalculated, never saved (a saved copy lost its "auto" flag and went stale).
      if (field === els.manualMiles && field.dataset.auto === '1') return;
      data[field.id] = (field.type === 'checkbox' || field.type === 'radio') ? field.checked : field.value;
    });
    routeBlocks().forEach((block) => {
      const d = block.dataset;
      if (d.lat || d.kind) data._geo[d.addr] = { lat: d.lat, lng: d.lng, kind: d.kind, code: d.code };
    });
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (err) {}
  }

  function restoreDraft() {
    let data;
    try { data = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (err) { data = null; }
    if (!data) return false;
    const stops = Math.min(MAX_STOPS, Math.max(0, Number(data._stops) || 0));
    for (let i = 0; i < stops; i += 1) addStop({ save: false });
    Object.keys(data).forEach((id) => {
      if (id.charAt(0) === '_') return;
      const field = document.getElementById(id);
      if (!field || field.type === 'button') return;
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = !!data[id];
      else field.value = data[id];
    });
    const geo = data._geo || {};
    Object.keys(geo).forEach((key) => {
      const block = blockByKey(key);
      const g = geo[key] || {};
      if (!block) return;
      if (g.lat) block.dataset.lat = g.lat;
      if (g.lng) block.dataset.lng = g.lng;
      if (g.kind) block.dataset.kind = g.kind;
      if (g.code) block.dataset.code = g.code;
    });
    routeBlocks().forEach(syncCityRequired);
    if (els.manualMiles.value && els.manualMilesField) els.manualMilesField.hidden = false;
    return true;
  }

  /* ---------- Contact checks: real US phone number + email format ---------- */

  const PHONE_MSG = 'Please enter a 10-digit phone number';
  const EMAIL_TYPO_DOMAINS = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
    'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmal.com': 'gmail.com',
    'gmail.om': 'gmail.com', 'gmali.com': 'gmail.com', 'gmeil.com': 'gmail.com',
    'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.cm': 'yahoo.com',
    'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'homail.com': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com',
    'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com', 'iclound.com': 'icloud.com', 'icoud.com': 'icloud.com',
    'aol.co': 'aol.com', 'comcast.ne': 'comcast.net', 'att.ne': 'att.net', 'sbcglobal.ne': 'sbcglobal.net',
  };
  const EMAIL_BAD_TLDS = ['con', 'cmo', 'ocm', 'vom', 'xom', 'comm', 'coom', 'nett', 'or', 'og'];

  function phoneDigits(value) {
    let d = String(value || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d;
  }

  function formatPhone(d) {
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }

  /** '' when the phone is a plausible real US number, otherwise the message to show. */
  function phoneProblem(value) {
    const raw = String(value || '').trim();
    if (!raw) return PHONE_MSG + '.';
    const all = raw.replace(/\D/g, '');
    const d = phoneDigits(raw);
    if (d.length !== 10) {
      if (all.length === 11 && all.charAt(0) !== '1') return PHONE_MSG + ' (11 digits only works if it starts with 1).';
      return PHONE_MSG + (all.length ? ' — you entered ' + all.length + ' digit' + (all.length === 1 ? '' : 's') + '.' : '.');
    }
    if (/^[01]/.test(d)) return PHONE_MSG + ' — the area code can’t start with 0 or 1.';
    if (/^[01]/.test(d.slice(3))) return PHONE_MSG + ' — the number after the area code can’t start with 0 or 1.';
    if (/^(\d)\1{9}$/.test(d) || d === '1234567890' || d === '0123456789' || d === '9876543210' || /^\d11/.test(d)) {
      return 'That doesn’t look like a real phone number. ' + PHONE_MSG + '.';
    }
    return '';
  }

  /** '' when the email is blank (optional) or looks right, otherwise a friendly message. */
  function emailProblem(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    const generic = 'Please check your email address — it should look like name@example.com.';
    if (/\s/.test(v)) return 'Please remove the spaces from your email address.';
    const at = v.split('@');
    if (at.length !== 2) return at.length < 2 ? 'Your email address is missing the @ sign (like name@example.com).' : generic;
    const local = at[0];
    const domain = at[1].toLowerCase();
    if (!local || !domain) return generic;
    if (local.charAt(0) === '.' || local.slice(-1) === '.' || local.indexOf('..') !== -1) return generic;
    if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)) return generic;
    if (!/^[a-z0-9.-]+$/.test(domain)) return generic;
    if (domain.indexOf('.') === -1) return 'Your email address is missing the ending, like .com (name@' + domain + '.com).';
    if (domain.indexOf('..') !== -1) return generic;
    const labels = domain.split('.');
    if (labels.some((l) => !l || l.charAt(0) === '-' || l.slice(-1) === '-')) return generic;
    const tld = labels[labels.length - 1];
    if (!/^[a-z]{2,}$/.test(tld)) return generic;
    const fix = EMAIL_TYPO_DOMAINS[domain];
    if (fix) return 'Did you mean ' + local + '@' + fix + '? Please check your email address.';
    if (EMAIL_BAD_TLDS.indexOf(tld) !== -1) {
      const guess = tld.charAt(0) === 'n' ? 'net' : (tld.charAt(0) === 'o' && tld !== 'ocm' ? 'org' : 'com');
      return 'Did you mean ' + local + '@' + labels.slice(0, -1).join('.') + '.' + guess + '? Please check your email address.';
    }
    return '';
  }

  function contactErrorEl(field) {
    return field ? document.getElementById(field.id + '-error') : null;
  }

  /** Check one contact field; show/clear its inline error when `show` (or when an error is already showing). */
  function checkContactField(field, show) {
    if (!field) return true;
    const msg = field === els.contactPhone ? phoneProblem(field.value) : emailProblem(field.value);
    field.setCustomValidity(msg);
    const box = contactErrorEl(field);
    const showing = box && !box.hidden;
    if (show || showing || !msg) {
      if (box) {
        box.textContent = msg;
        box.hidden = !msg;
      }
      if (msg) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    return !msg;
  }

  /** Format a valid phone as (xxx) xxx-xxxx and tidy the email. */
  function tidyContact() {
    const ph = els.contactPhone;
    if (ph && !phoneProblem(ph.value)) {
      const formatted = formatPhone(phoneDigits(ph.value));
      if (ph.value !== formatted) ph.value = formatted;
    }
    const em = els.contactEmail;
    if (em && em.value !== em.value.trim()) em.value = em.value.trim();
  }

  /**
   * Before anything that sends or books: phone + email must be valid. Shows the inline errors,
   * focuses and scrolls to the first bad field. Returns true when both are fine.
   */
  function contactReady() {
    tidyContact();
    const phoneOk = checkContactField(els.contactPhone, true);
    const emailOk = checkContactField(els.contactEmail, true);
    if (phoneOk && emailOk) return true;
    const bad = phoneOk ? els.contactEmail : els.contactPhone;
    try { bad.focus({ preventScroll: true }); } catch (err) { bad.focus(); }
    try { bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { bad.scrollIntoView(true); }
    return false;
  }

  /** Full check before a send/book action: contact first, then every other required field. */
  function formReadyToSend() {
    updateFlightDetails();
    if (!contactReady()) return false;
    if (!els.form.reportValidity()) {
      const bad = els.form.querySelector(':invalid');
      if (bad && bad.scrollIntoView) bad.scrollIntoView({ block: 'center' });
      return false;
    }
    return true;
  }

  function initContactChecks() {
    [els.contactPhone, els.contactEmail].forEach((field) => {
      if (!field) return;
      // Live: clear (or update) an error that is already showing as soon as the customer fixes it.
      field.addEventListener('input', () => checkContactField(field, false));
      // Leaving the field: format a good phone, show the error for a bad one (blank fields stay quiet until a send/book tap).
      field.addEventListener('blur', () => {
        tidyContact();
        checkContactField(field, !!field.value.trim());
      });
    });
    // Restored draft: format a good number, keep custom validity in sync (errors stay hidden until needed).
    tidyContact();
    checkContactField(els.contactPhone, false);
    checkContactField(els.contactEmail, false);
  }

  function requestRecipientsLabel() {
    return serviceArea() === 'Waco area' ? '936-261-7878 and Anson (254-498-1335)' : '936-261-7878';
  }

  function updateRequestFine() {
    if (els.requestFine) {
      els.requestFine.textContent = 'Opens a text to ' + requestRecipientsLabel() + ' with your trip details. You tap send.';
    }
  }

  function showConfirmation() {
    if (!els.requestConfirm) return;
    els.requestConfirm.hidden = false;
    els.requestConfirm.textContent = 'Request ready. Send the text to ' + requestRecipientsLabel() + '. Your details stay on this page.';
  }

  function clearRequestNotes() {
    if (els.textRequestNote) els.textRequestNote.hidden = true;
    if (els.requestConfirm) els.requestConfirm.hidden = true;
  }

  /**
   * Only called from a text button the customer tapped (Text ride request / Text my request / 10% off).
   * Sets that link's sms: href; the tap itself opens Messages. Never auto-opens Messages.
   */
  function openRideText(event, result, promo) {
    if (!formReadyToSend()) {
      if (event) event.preventDefault();
      if (els.requestConfirm) els.requestConfirm.hidden = true;
      if (els.textRequestNote) {
        els.textRequestNote.hidden = false;
        els.textRequestNote.textContent = 'Fill the highlighted field, then tap again.';
      }
      return false;
    }
    if (els.textRequestNote) els.textRequestNote.hidden = true;
    saveDraft();
    const url = smsUrl(rideRequestBody(result, promo), serviceArea());
    const link = event && event.currentTarget;
    if (link && link.tagName === 'A') link.href = url;
    showConfirmation();
    return true;
  }

  function renderEstimate(result) {
    lastEstimate = result;
    updateAreaLine();
    updateRequestFine();
    els.resultsEmpty.hidden = true;
    els.resultsBody.hidden = false;

    if (result.callForQuote) {
      els.milesLine.textContent = '';
      els.tierLine.textContent = '';
      if (els.airportLine) els.airportLine.hidden = true;
      els.lineItems.innerHTML = '';
      els.totalAmount.textContent = 'Call for quote';
      els.returnNote.hidden = true;
      els.callQuote.hidden = false;
      updateBooking(result);
      return;
    }

    els.callQuote.hidden = true;
    const driven = typeof result.actualMiles === 'number' ? result.actualMiles : result.miles;
    const billedNote = driven !== result.miles
      ? ` (billed as ${result.miles} miles — always rounded up to the next whole mile)`
      : '';
    els.milesLine.textContent = `One-way driving distance: ${driven.toFixed(1)} miles${billedNote}`;
    const extras = [];
    if (result.holiday) extras.push('holiday');
    if (result.shortNotice) extras.push('under 24 hours’ notice');
    els.tierLine.textContent = `Rate tier (automatic): ${result.tier.label}` + (extras.length ? ' · ' + extras.join(' · ') : '');
    if (els.airportLine) {
      els.airportLine.hidden = !result.airport;
      els.airportLine.textContent = result.airport ? 'Airport detected: ' + airportSummary(result.airport) : '';
    }
    els.lineItems.innerHTML = result.items
      .map(
        (item) =>
          `<li><span class="label">${escapeHtml(item.label)}</span><span class="amount">${money(item.amount)}</span></li>`
      )
      .join('');
    els.totalAmount.textContent = money(result.total);
    els.returnNote.hidden = !result.over75;
    updateBooking(result);
  }

  /* ---------- Book it: business hours + calendar check + 25% deposit ---------- */

  function chicagoOffsetMs(utcMs) {
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).forEach((p) => { parts[p.type] = p.value; });
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, (+parts.hour) % 24, +parts.minute, +parts.second);
    return asUtc - utcMs;
  }

  // Date + time typed on the form are Central (America/Chicago) wall-clock values.
  function chicagoWallToMs(dateStr, timeStr) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    const tm = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
    if (!dm || !tm) return NaN;
    const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
    let ms = guess - chicagoOffsetMs(guess);
    ms = guess - chicagoOffsetMs(ms);
    return ms;
  }

  function weekdayOf(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
  }

  function ymd(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function nthWeekday(y, m, weekday, n) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }

  function lastWeekday(y, m, weekday) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
    return lastDay - ((last - weekday + 7) % 7);
  }

  // Major US holidays (+ Christmas Eve, day after Thanksgiving, New Year's Eve) with observed days.
  // Holidays always go to Matthew for approval.
  function holidaySet(y) {
    const out = {};
    const add = (m, d) => { out[ymd(y, m, d)] = true; };
    const fixed = (m, d) => {
      add(m, d);
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (wd === 6) { const o = new Date(Date.UTC(y, m - 1, d - 1)); out[ymd(o.getUTCFullYear(), o.getUTCMonth() + 1, o.getUTCDate())] = true; }
      if (wd === 0) { const o = new Date(Date.UTC(y, m - 1, d + 1)); out[ymd(o.getUTCFullYear(), o.getUTCMonth() + 1, o.getUTCDate())] = true; }
    };
    fixed(1, 1);                       // New Year's Day
    add(1, nthWeekday(y, 1, 1, 3));    // MLK Day
    add(2, nthWeekday(y, 2, 1, 3));    // Presidents' Day
    add(5, lastWeekday(y, 5, 1));      // Memorial Day
    fixed(6, 19);                      // Juneteenth
    fixed(7, 4);                       // Independence Day
    add(9, nthWeekday(y, 9, 1, 1));    // Labor Day
    fixed(11, 11);                     // Veterans Day
    const thanks = nthWeekday(y, 11, 4, 4);
    add(11, thanks);                   // Thanksgiving
    add(11, thanks + 1);               // Day after Thanksgiving
    add(12, 24);                       // Christmas Eve
    fixed(12, 25);                     // Christmas
    add(12, 31);                       // New Year's Eve
    return out;
  }

  function isHolidayDate(dateStr) {
    const y = Number(String(dateStr).slice(0, 4));
    if (!y) return false;
    return !!(holidaySet(y)[dateStr] || holidaySet(y + 1)[dateStr]);
  }

  function estimatedRideMinutes(miles) {
    const mi = Math.max(0, Number(miles) || 0);
    return Math.max(30, Math.round(mi * 1.5)); // ~40 mph average, at least 30 min
  }

  function loadBusyWindows() {
    return fetch(BUSY_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('busy ' + res.status);
        return res.json();
      })
      .then((data) => (data && Array.isArray(data.windows) ? data.windows : []));
  }

  function overlapsBusy(windows, startMs, endMs) {
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i] || {};
      const ws = new Date(w.start).getTime();
      const we = new Date(w.end).getTime();
      if (!isFinite(ws) || !isFinite(we)) continue;
      if (startMs < we && ws < endMs) return true;
    }
    return false;
  }

  function depositFor(total) {
    return Math.round(total * DEPOSIT_PCT * 100) / 100;
  }


  // Decide whether to offer instant "Book it" or keep the request pending for Matthew / a driver.
  // Instant Book it + Matthew's calendar check apply to Greater Houston only.
  // Waco (and unknown area) always stay pending — we do not have Anson's calendar.
  function bookingDecision(result) {
    if (!result || result.callForQuote || typeof result.total !== 'number') {
      return Promise.resolve({ show: false });
    }
    const dateStr = els.rideDate.value;
    const timeStr = els.rideTime.value;
    const startMs = chicagoWallToMs(dateStr, timeStr);
    if (!isFinite(startMs)) {
      return Promise.resolve({ show: true, ok: false, past: true, message: 'Add a date and time to see booking options.' });
    }
    if (startMs < Date.now()) {
      return Promise.resolve({ show: true, ok: false, past: true, message: 'That pickup time has already passed. Pick a future date and time.' });
    }
    const pending = (message) => ({ show: true, ok: false, message });
    const area = serviceArea();
    if (area === 'Waco area') {
      return Promise.resolve(pending(
        'Waco-area rides always need confirmation from Matthew or Anson. Instant Book it and the online calendar check are for Greater Houston only.'
      ));
    }
    if (area !== 'Greater Houston area') {
      return Promise.resolve(pending(
        'Choose Greater Houston area or Waco area above. Instant Book it is available for Greater Houston only; Waco stays pending confirmation.'
      ));
    }
    const wd = weekdayOf(dateStr);
    const [hh, mm] = timeStr.split(':').map(Number);
    const mins = hh * 60 + (mm || 0);
    if (wd === 0 || wd === 6) return Promise.resolve(pending('Weekend rides need Matthew’s approval.'));
    if (isHolidayDate(dateStr)) return Promise.resolve(pending('Holiday rides need Matthew’s approval.'));
    if (mins < BOOK_START_MIN || mins > BOOK_END_MIN) {
      return Promise.resolve(pending('Rides before 8:00 am or after 6:00 pm need Matthew’s approval.'));
    }
    if (result.over75) return Promise.resolve(pending('Trips over 75 miles need Matthew to confirm the return fee first.'));
    const endMs = startMs + estimatedRideMinutes(result.miles) * 60000;
    const from = startMs - BUSY_BUFFER_MIN * 60000;
    const to = endMs + BUSY_BUFFER_MIN * 60000;
    return loadBusyWindows().then((windows) => {
      if (overlapsBusy(windows, from, to)) {
        return pending('That time is close to another scheduled trip.');
      }
      return { show: true, ok: true };
    }).catch(() => pending('We couldn’t check the schedule right now.'));
  }

  /* ---------- Book it: automatic owner alert (Firebase hub) + on-page payment step ---------- */

  function syncDbUrl() {
    const s = window.PCS_SYNC || {};
    const url = String(s.databaseURL || '').trim().replace(/\/+$/, '');
    return /^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)$/i.test(url) ? url : '';
  }

  function squareCfg() {
    const c = window.PCS_SQUARE || {};
    return {
      appId: String(c.applicationId || '').trim(),
      locationId: String(c.locationId || '').trim(),
      // v18: pcs-pay Worker POST /deposit (25% deposit or pay in full, amount checked by the Worker). Blank = Square off.
      endpoint: String(c.depositUrl || '').trim(),
      sandbox: String(c.environment || '').toLowerCase() === 'sandbox',
      // Only true when app/square-config.js turned on the sandbox for this tab (?squaretest=1).
      testMode: c.testMode === true,
    };
  }

  /** Same gating as the rider app: blank applicationId / locationId / Worker URL means Square is off. */
  function squareConfigured() {
    const c = squareCfg();
    return !!(c.appId && c.locationId && /^https:\/\//i.test(c.endpoint));
  }

  function makeRideCode() {
    const bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 8; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    let out = '';
    for (let i = 0; i < 8; i += 1) out += RIDE_CODE_ALPHABET.charAt(bytes[i] % RIDE_CODE_ALPHABET.length);
    return out;
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 15000) : 0;
    return fetch(url, Object.assign({}, opts || {}, ctrl ? { signal: ctrl.signal } : {}))
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  function addressParts(block) {
    const pt = blockPoint(block);
    return {
      street: partVal(block, 'line1'),
      line2: partVal(block, 'line2'),
      city: partVal(block, 'city'),
      state: partVal(block, 'state') || 'TX',
      zip: partVal(block, 'zip'),
      address: composeAddress(block),
      lat: pt ? pt.lat : null,
      lng: pt ? pt.lng : null,
    };
  }

  /** Ride record in the same shape the rider app writes, so God mode lists it, approves it and denies it the same way. */
  function bookingRide(code, result, payChoice) {
    const now = Date.now();
    const pu = addressParts(blockByKey('pickup'));
    const dr = addressParts(blockByKey('dropoff'));
    const stops = stopBlocks().filter(blockComplete).map(addressParts);
    const total = result.total;
    const deposit = depositFor(total);
    const due = payChoice === 'full' ? total : deposit;
    const airport = detectAirport();
    const notes = [];
    if (airport) {
      notes.push('Airport: ' + airportSummary(airport));
      if (els.airline.value.trim()) notes.push('Airline: ' + els.airline.value.trim());
      if (els.flightNumber.value.trim()) notes.push('Flight: ' + els.flightNumber.value.trim());
      if (els.flightDirection.value) notes.push(els.flightDirection.value);
    }
    return {
      code,
      status: 'pending_owner',
      source: 'quote-page',
      bookedVia: 'Website quote page — Book it',
      // Square TEST MODE bookings are flagged so drivers never see them and God mode can tell them apart.
      isTest: squareConfigured() && squareCfg().testMode,
      name: els.contactName.value.trim(),
      phone: els.contactPhone.value.trim(),
      email: els.contactEmail.value.trim(),
      pickupStreet: pu.street, pickupLine2: pu.line2, pickupCity: pu.city, pickupState: pu.state, pickupZip: pu.zip,
      pickupAddress: pu.address, pickupLat: pu.lat, pickupLng: pu.lng,
      dropStreet: dr.street, dropLine2: dr.line2, dropCity: dr.city, dropState: dr.state, dropZip: dr.zip,
      dropAddress: dr.address, dropLat: dr.lat, dropLng: dr.lng,
      stops: stops.length,
      stopList: stops.map((st) => ({ street: st.street, line2: st.line2, city: st.city, state: st.state, zip: st.zip, address: st.address })),
      stopAddresses: stops.map((st) => st.address),
      date: els.rideDate.value,
      time: els.rideTime.value,
      when: els.rideDate.value + ' ' + els.rideTime.value,
      asap: false,
      passengers: Number(els.passengers.value) || 2,
      serviceArea: serviceArea(),
      service: serviceLabel(),
      miles: typeof result.actualMiles === 'number' ? Math.round(result.actualMiles * 10) / 10 : result.miles,
      billedMiles: result.miles,
      estimateTotal: total,
      estimateCents: Math.round(total * 100),
      depositCents: Math.round(deposit * 100),
      payChoice: payChoice === 'full' ? 'full' : 'deposit',
      amountDueCents: Math.round(due * 100),
      cardStatus: 'link_requested',
      cardRequestedAt: now,
      paymentStatus: 'awaiting_payment',
      notes: notes.join(' · '),
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** REQUESTS summary row (what God mode polls). Mirrors the rider app's openSummaryFromRide. */
  function openSummary(ride) {
    const keys = ['code', 'status', 'source', 'name', 'phone', 'email', 'pickupStreet', 'pickupCity', 'pickupState', 'pickupLine2',
      'pickupZip', 'pickupAddress', 'dropStreet', 'dropCity', 'dropState', 'dropLine2', 'dropZip', 'dropAddress', 'stops',
      'stopAddresses', 'cardStatus', 'date', 'time', 'asap', 'when', 'pickupLat', 'pickupLng', 'dropLat', 'dropLng', 'isTest',
      'estimateCents', 'amountDueCents', 'payChoice', 'serviceArea', 'passengers'];
    const out = {};
    keys.forEach((k) => { if (ride[k] !== undefined) out[k] = ride[k]; });
    out.updatedAt = Date.now();
    return out;
  }

  function dbPut(path, body) {
    const base = syncDbUrl();
    return fetchWithTimeout(base + path + '.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15000).then((res) => {
      if (!res.ok) {
        const err = new Error('write ' + res.status);
        err.status = res.status;
        throw err;
      }
      return res.text();
    });
  }

  function dbPatch(path, body) {
    const base = syncDbUrl();
    return fetchWithTimeout(base + path + '.json', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15000).then((res) => {
      if (!res.ok) throw new Error('patch ' + res.status);
      return res.text();
    });
  }

  /** Pick a ride code that is not already used (one quick read), like the rider app. */
  function freeRideCode(tries) {
    const code = makeRideCode();
    return fetchWithTimeout(syncDbUrl() + '/rides/' + code + '.json', { cache: 'no-store' }, 10000)
      .then((res) => (res.ok ? res.text() : 'null'))
      .catch(() => 'null')
      .then((text) => ((text && text !== 'null' && (tries || 0) < 3) ? freeRideCode((tries || 0) + 1) : code));
  }

  function notifyOwnerWebhook(ride) {
    // Optional Zapier/Make hook (app/sync-config.js). Same rule as the rider app: only with a shared secret.
    const s = window.PCS_SYNC || {};
    const hook = String(s.bookingWebhook || '').trim();
    const secret = String(s.webhookSecret || '').trim();
    if (!/^https:\/\//i.test(hook) || !secret || ride.isTest) return;
    try {
      fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pcs_booking_pending_owner', source: 'quote-page', code: ride.code, name: ride.name, phone: ride.phone,
          date: ride.date, time: ride.time, pickup: ride.pickupAddress, dropoff: ride.dropAddress,
          amountDue: (ride.amountDueCents / 100).toFixed(2), payChoice: ride.payChoice, status: ride.status,
          secret, webhookSecret: secret,
        }),
      }).catch(() => {});
    } catch (err) {}
  }

  /** Writes the booking where God mode reads it. Resolves with the ride; rejects if it could not be saved. */
  function submitBooking(result, payChoice) {
    if (!syncDbUrl()) return Promise.reject(new Error('no-sync'));
    return freeRideCode(0).then((code) => {
      const ride = bookingRide(code, result, payChoice);
      return dbPut('/rides/' + code, ride)
        .then(() => dbPut('/rides/' + OPEN_HUB + '/' + code, openSummary(ride)))
        .then(() => {
          notifyOwnerWebhook(ride);
          return ride;
        });
    });
  }

  let sqCard = null;
  let sqLoading = null;

  function loadSquareSdk(sandbox) {
    if (window.Square && window.Square.payments) return Promise.resolve();
    if (sqLoading) return sqLoading;
    sqLoading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = sandbox ? 'https://sandbox.web.squarecdn.com/v1/square.js' : 'https://web.squarecdn.com/v1/square.js';
      sc.async = true;
      sc.onload = () => resolve();
      sc.onerror = () => { sqLoading = null; reject(new Error('square-sdk')); };
      document.head.appendChild(sc);
    });
    return sqLoading;
  }

  function destroySquareCard() {
    if (sqCard && sqCard.destroy) { try { sqCard.destroy(); } catch (err) {} }
    sqCard = null;
  }

  function bookedHeadHtml(ride) {
    const due = money(ride.amountDueCents / 100);
    const what = ride.payChoice === 'full' ? 'pay in full' : '25% deposit';
    return '<p class="book-kicker">Booking received</p>' +
      '<p class="book-code">Booking code <strong>' + escapeHtml(ride.code) + '</strong></p>' +
      '<div class="deposit-row"><span>Amount due (' + what + ')</span><strong>' + due + '</strong></div>';
  }

  /** On-page step shown after Book it. Never a new window, never Messages, never another website. */
  function renderBookedStep(ride) {
    const panel = els.bookingPanel;
    if (!panel) return;
    destroySquareCard();
    panel.hidden = false;
    panel.dataset.booked = ride.code;
    const due = money(ride.amountDueCents / 100);
    if (!squareConfigured()) {
      panel.innerHTML = bookedHeadHtml(ride) +
        '<p class="book-copy book-received" id="booked-message"><strong>Booking received. We’ll confirm and send your secure payment link shortly.</strong></p>' +
        '<p class="book-fine">The payment link comes by text to ' + escapeHtml(ride.phone) + '. Your booking is pending until Matthew or a driver accepts it. Questions? Call <a href="tel:9362617878">936-261-7878</a>.</p>';
      return;
    }
    const cfg = squareCfg();
    panel.innerHTML = bookedHeadHtml(ride) +
      (cfg.testMode ? '<p class="test-flag">TEST MODE · Square sandbox · card 4111 1111 1111 1111, CVV 111, ZIP 77042</p>' : '') +
      '<p class="book-copy" id="booked-message"><strong>Booking received.</strong> Pay ' + due + ' securely below to finish booking. Square keeps your card; this page never sees the number.</p>' +
      '<div id="qp-card" class="qp-card"><p class="book-fine">Loading the secure card form…</p></div>' +
      '<p class="field-error" id="qp-card-error" role="alert" hidden></p>' +
      '<button type="button" class="btn btn-primary" id="qp-pay-btn" disabled>Pay ' + due + '</button>' +
      '<p class="book-fine">Your booking is pending until Matthew or a driver accepts it. Questions? Call <a href="tel:9362617878">936-261-7878</a>.</p>';
    const errBox = document.getElementById('qp-card-error');
    const showErr = (msg) => { if (errBox) { errBox.textContent = msg || ''; errBox.hidden = !msg; } };
    loadSquareSdk(cfg.sandbox)
      .then(() => Promise.resolve(window.Square.payments(cfg.appId, cfg.locationId)))
      .then((payments) => payments.card())
      .then((card) => {
        const box = document.getElementById('qp-card');
        if (!box || panel.dataset.booked !== ride.code) { try { card.destroy(); } catch (e) {} return null; }
        sqCard = card;
        box.innerHTML = '';
        return card.attach('#qp-card').then(() => {
          const b = document.getElementById('qp-pay-btn');
          if (b) b.disabled = false;
        });
      })
      .catch(() => {
        showErr('The secure card form didn’t load. Your booking is saved, and we’ll text you a secure payment link instead.');
        const b = document.getElementById('qp-pay-btn');
        if (b) b.hidden = true;
      });
    let attempt = 0;
    const payBtn = document.getElementById('qp-pay-btn');
    if (payBtn) payBtn.addEventListener('click', () => {
      if (!sqCard || payBtn.dataset.busy === '1') return;
      payBtn.dataset.busy = '1';
      payBtn.disabled = true;
      payBtn.textContent = 'Paying…';
      showErr('');
      attempt += 1;
      // The Worker builds the Square idempotency key from the booking code + attempt; the busy flag stops double taps.
      sqCard.tokenize().then((tok) => {
        if (!tok || tok.status !== 'OK' || !tok.token) {
          const first = tok && tok.errors && tok.errors[0];
          const err = new Error((first && first.message) || 'Check the card details and try again.');
          err.cardForm = true;
          throw err;
        }
        return fetchWithTimeout(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rideCode: ride.code,
            sourceId: tok.token,
            choice: ride.payChoice === 'full' ? 'full' : 'deposit',
            amountCents: ride.amountDueCents,
            buyerEmail: ride.email || undefined,
            attempt: attempt - 1,
            sandbox: cfg.sandbox ? true : undefined,
          }),
        }, 30000);
      }).then((res) => res.json().catch(() => ({})).then((data) => {
        if (!res.ok || !data || !data.ok || !(data.paymentId || data.already)) throw new Error((data && data.error) || 'The payment didn’t go through. Try again.');
        return data;
      })).then((data) => {
        const now = Date.now();
        const paid = {
          paymentStatus: ride.payChoice === 'full' ? 'paid_in_full' : 'deposit_paid',
          paidCents: Number(data.amountCents) || ride.amountDueCents,
          squarePaymentId: String(data.paymentId),
          squarePaymentStatus: String(data.status || ''),
          receiptUrl: /^https:\/\//i.test(data.receiptUrl || '') ? String(data.receiptUrl) : '',
          paymentEnv: cfg.sandbox ? 'sandbox' : 'production',
          paidAt: now,
          cardStatus: 'on_file',
          cardLast4: String(data.last4 || ''),
          cardBrand: String(data.brand || ''),
          updatedAt: now,
        };
        // Same two records the booking wrote: the full ride and the REQUESTS row God mode polls.
        const row = { paymentStatus: paid.paymentStatus, paidCents: paid.paidCents, squarePaymentId: paid.squarePaymentId,
          cardStatus: paid.cardStatus, paymentEnv: paid.paymentEnv, updatedAt: now };
        // v18: the Worker already wrote the full ride (data.written), so that PATCH is only the fallback.
        // The REQUESTS row (what God mode polls) is always updated here.
        if (!syncDbUrl()) return Promise.resolve(paid);
        return Promise.all([
          data.written === true ? Promise.resolve(true) : dbPatch('/rides/' + ride.code, paid).catch(() => false),
          dbPatch('/rides/' + OPEN_HUB + '/' + ride.code, row).catch(() => false),
        ]).then(() => paid);
      }).then((paid) => {
        destroySquareCard();
        const what = ride.payChoice === 'full' ? 'paid in full' : '25% deposit';
        panel.innerHTML = '<p class="book-kicker">You’re booked</p>' +
          '<p class="book-code">Booking code <strong>' + escapeHtml(ride.code) + '</strong></p>' +
          (cfg.testMode ? '<p class="test-flag">TEST MODE · Square sandbox · no real charge</p>' : '') +
          '<p class="book-copy book-received" id="booked-message"><strong>You’re booked, payment received.</strong></p>' +
          '<div class="deposit-row"><span>Paid (' + what + ')</span><strong>' + money(paid.paidCents / 100) + '</strong></div>' +
          (paid.receiptUrl ? '<p class="book-fine"><a id="receipt-link" href="' + escapeHtml(paid.receiptUrl) + '" target="_blank" rel="noopener">View your receipt</a></p>' : '') +
          '<p class="book-fine">Your booking is pending until Matthew or a driver accepts it. We’ll text ' + escapeHtml(ride.phone) + ' to confirm. Questions? Call <a href="tel:9362617878">936-261-7878</a>.</p>';
      }).catch((err) => {
        payBtn.dataset.busy = '';
        payBtn.disabled = false;
        payBtn.textContent = 'Pay ' + due;
        showErr((err && err.message) || 'The payment didn’t go through. Try again, or call 936-261-7878.');
      });
    });
  }

  function hideBookingPanel(note) {
    bookingToken += 1;
    if (!els.bookingPanel) return;
    // A booking that was already received stays on screen (its code and payment step).
    if (els.bookingPanel.dataset.booked) return;
    if (note && !els.bookingPanel.hidden) {
      els.bookingPanel.innerHTML = '<p class="book-note">' + escapeHtml(note) + '</p>';
      return;
    }
    els.bookingPanel.hidden = true;
    els.bookingPanel.innerHTML = '';
  }

  function renderBookingPanel(result, decision) {
    const panel = els.bookingPanel;
    if (!panel) return;
    if (!decision || !decision.show) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.hidden = false;
    if (decision.past) {
      panel.innerHTML = '<p class="book-note">' + escapeHtml(decision.message) + '</p>';
      return;
    }
    if (!decision.ok) {
      panel.innerHTML =
        '<p class="book-kicker pending">Book it isn’t available for this ride</p>' +
        '<p class="book-copy">' + escapeHtml(decision.message) +
        ' Tap <strong>Request this ride</strong> above to text it to us. It stays <strong>pending until Matthew or a driver accepts it</strong>.</p>' +
        '<p class="book-fine">Instant <strong>Book it</strong> is for <strong>Greater Houston</strong> only, Mon–Fri 8:00 am–6:00 pm (Central) when Matthew’s schedule is open. <strong>Waco</strong> requests always stay pending confirmation (we don’t have Anson’s calendar).</p>';
      return;
    }
    const deposit = depositFor(result.total);
    panel.innerHTML =
      '<p class="book-kicker">Open on the Houston schedule</p>' +
      '<div class="deposit-row"><span>25% deposit to book</span><strong>' + money(deposit) + '</strong></div>' +
      '<p class="book-fine">Greater Houston only — calendar check is for Houston. 25% of the ' + money(result.total) + ' estimate. The rest of your final fare is due after the ride.</p>' +
      '<button type="button" class="btn btn-primary btn-book" id="book-it-btn">Book it</button>' +
      '<div class="book-confirm" id="book-confirm" hidden>' +
        '<div class="book-warning" role="alert">' +
          '<p><strong>Heads up: your booking is pending until accepted by the driver or Matthew.</strong></p>' +
          '<ul>' +
            '<li>Deposit: <strong>' + money(deposit) + '</strong> (25% of the estimated total), or pay the full ' + money(result.total) + '.</li>' +
            '<li>Matthew may adjust the fare after pickup if the trip changes (stops, waits, route).</li>' +
            '<li>If no one is available, Matthew will contact you to revise the pickup or cancel.</li>' +
          '</ul>' +
        '</div>' +
        '<fieldset class="pay-choice">' +
          '<legend>How would you like to pay?</legend>' +
          '<label class="check"><input type="radio" name="pay-choice" id="pay-deposit" value="deposit" checked /> <span>25% deposit now — <strong>' + money(deposit) + '</strong></span></label>' +
          '<label class="check"><input type="radio" name="pay-choice" id="pay-full" value="full" /> <span>Pay in full — <strong>' + money(result.total) + '</strong></span></label>' +
        '</fieldset>' +
        '<label class="check book-ack"><input type="checkbox" id="book-ack" /> <span>I understand my booking is pending until accepted.</span></label>' +
        '<button type="button" class="btn btn-primary btn-book-step" id="book-confirm-btn" aria-disabled="true">Confirm booking</button>' +
        '<p class="field-error" id="book-error" role="alert" hidden></p>' +
        '<p class="book-fine">Your booking goes straight to Private Car Services. No text message needed, and you stay on this page.</p>' +
      '</div>';

    const bookBtn = document.getElementById('book-it-btn');
    const confirmBox = document.getElementById('book-confirm');
    const ack = document.getElementById('book-ack');
    const confirmBtn = document.getElementById('book-confirm-btn');
    const errBox = document.getElementById('book-error');
    const showErr = (html) => { if (errBox) { errBox.innerHTML = html || ''; errBox.hidden = !html; } };
    const syncAck = () => {
      const on = !!(ack && ack.checked);
      if (confirmBtn) confirmBtn.setAttribute('aria-disabled', on ? 'false' : 'true');
    };
    if (bookBtn) {
      bookBtn.addEventListener('click', () => {
        // Booking needs a real phone number (and a valid email if given) first.
        if (!formReadyToSend()) return;
        if (confirmBox) confirmBox.hidden = false;
        bookBtn.hidden = true;
        if (confirmBox && confirmBox.scrollIntoView) confirmBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    if (ack) ack.addEventListener('change', syncAck);
    const needAck = () => {
      if (ack && ack.checked) return true;
      if (ack) {
        ack.focus();
        const label = ack.closest('label');
        if (label) {
          label.classList.add('shake');
          setTimeout(() => label.classList.remove('shake'), 600);
        }
      }
      return false;
    };
    if (confirmBtn) {
      confirmBtn.addEventListener('click', (event) => {
        event.preventDefault();
        if (confirmBtn.dataset.busy === '1') return;
        if (!formReadyToSend()) return;
        if (!needAck()) return;
        const picked = panel.querySelector('input[name="pay-choice"]:checked');
        const payChoice = picked && picked.value === 'full' ? 'full' : 'deposit';
        confirmBtn.dataset.busy = '1';
        confirmBtn.textContent = 'Sending your booking…';
        showErr('');
        saveDraft();
        submitBooking(result, payChoice).then((ride) => {
          renderBookedStep(ride);
          if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }).catch(() => {
          confirmBtn.dataset.busy = '';
          confirmBtn.textContent = 'Try again';
          showErr('We couldn’t send your booking just now. Tap <strong>Try again</strong>, or call <a href="tel:9362617878">936-261-7878</a> and we’ll book it for you.');
        });
      });
    }
  }

  function updateBooking(result) {
    const token = ++bookingToken;
    if (!els.bookingPanel) return;
    delete els.bookingPanel.dataset.booked;
    destroySquareCard();
    if (!result || result.callForQuote) {
      renderBookingPanel(result, { show: false });
      return;
    }
    els.bookingPanel.hidden = false;
    els.bookingPanel.innerHTML = '<p class="book-note">Checking the schedule…</p>';
    bookingDecision(result).then((decision) => {
      if (token !== bookingToken) return;
      renderBookingPanel(result, decision);
    });
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

  /* ---------- Driving miles: real driving route (Google Directions, else free OSRM router) + route map ---------- */
  // v16: the route is looked up as soon as From and To are set (and again whenever From / To / stops change).
  // Its miles fill the "Driving miles" box automatically; that box only shows when the lookup fails.

  const routeState = { key: '', miles: null, minutes: null, line: null, points: null, source: '' };
  let routeSeq = 0;
  let routeTimer = 0;
  let routePending = null; // { key, promise }
  let leafletMap = null;
  let leafletLayer = null;
  const geocodeCache = {};

  /** From, complete stops, To — or null when From / To (or a half-typed stop) are not ready. */
  function routeReadyBlocks() {
    const pickup = blockByKey('pickup');
    const dropoff = blockByKey('dropoff');
    if (!blockComplete(pickup) || !blockComplete(dropoff)) return null;
    const stops = stopBlocks();
    for (let i = 0; i < stops.length; i += 1) {
      if (blockTouched(stops[i]) && !blockComplete(stops[i])) return null;
    }
    return [pickup].concat(stops.filter(blockComplete), [dropoff]);
  }

  function blockRouteKey(block) {
    const pt = blockPoint(block);
    return pt ? pt.lat.toFixed(5) + ',' + pt.lng.toFixed(5) : 'q:' + normText(routeQuery(block));
  }

  function currentRouteKey() {
    const blocks = routeReadyBlocks();
    return blocks ? blocks.map(blockRouteKey).join('|') : '';
  }

  function fmtDuration(min) {
    if (!isFinite(min) || min <= 0) return '';
    const m = Math.max(1, Math.round(min));
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h + ' hr' + (r ? ' ' + r + ' min' : '');
  }

  function routeFoundMessage(miles, minutes) {
    const stopCount = stopAddresses().length;
    const via = stopCount ? ' via ' + stopCount + (stopCount === 1 ? ' stop' : ' stops') : '';
    const time = fmtDuration(minutes);
    return 'Route found: ' + miles.toFixed(1) + ' miles driving' + via + (time ? ' · about ' + time : '') +
      ' (billed ' + billedMiles(miles) + ' mi). Miles are filled in automatically.';
  }

  /** Map point for a typed address (no picked suggestion): Nominatim for house numbers, else ranked Photon. */
  function geocodeBlock(block) {
    const line1 = partVal(block, 'line1');
    const city = partVal(block, 'city');
    const st = partVal(block, 'state') || 'TX';
    const zip = partVal(block, 'zip');
    const known = knownAirportInText(line1);
    if (known) return Promise.resolve({ lat: known.lat, lng: known.lng });
    const low = line1.toLowerCase();
    const parts = [line1];
    if (city && low.indexOf(city.toLowerCase()) === -1) parts.push(city);
    if (st && low.indexOf(' ' + st.toLowerCase()) === -1) parts.push(st);
    if (zip && low.indexOf(zip) === -1) parts.push(zip);
    const q = parts.join(', ');
    if (geocodeCache[q]) return Promise.resolve(geocodeCache[q]);
    const viaPhoton = () => findPlaces(q, searchOrigin(block), { city, zip })
      .then((items) => (items[0] ? { lat: items[0].place.lat, lng: items[0].place.lng } : null))
      .catch(() => null);
    let lookup;
    if (!/^\d+[A-Za-z]?\s/.test(line1)) {
      lookup = viaPhoton();
    } else {
      lookup = withTimeout(fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=' + encodeURIComponent(q)).then((res) => {
        if (!res.ok) throw new Error('nominatim');
        return res.json();
      }), 7000).then((list) => {
        const hit = list && list[0];
        if (!hit || !isCoord(hit.lat) || !isCoord(hit.lon)) return viaPhoton();
        return { lat: +hit.lat, lng: +hit.lon };
      }).catch(viaPhoton);
    }
    return lookup.then((pt) => {
      if (pt) geocodeCache[q] = pt;
      return pt;
    });
  }

  function llOf(p) {
    if (!p) return null;
    return { lat: typeof p.lat === 'function' ? p.lat() : +p.lat, lng: typeof p.lng === 'function' ? p.lng() : +p.lng };
  }

  /** Google Directions (fastest driving route, like Apple / Google Maps). Resolves null on any failure. */
  function googleRoute(blocks) {
    return new Promise((resolve) => {
      if (!mapsReady || !directionsService || !window.google || !google.maps) { resolve(null); return; }
      const loc = (b) => { const pt = blockPoint(b); return pt ? { lat: pt.lat, lng: pt.lng } : routeQuery(b); };
      const timer = setTimeout(() => resolve(null), 10000);
      try {
        directionsService.route({
          origin: loc(blocks[0]),
          destination: loc(blocks[blocks.length - 1]),
          waypoints: blocks.slice(1, -1).map((b) => ({ location: loc(b), stopover: true })),
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
        }, (response, status) => {
          clearTimeout(timer);
          const r = status === 'OK' && response && response.routes && response.routes[0];
          if (!r || !r.legs || !r.legs.length) { resolve(null); return; }
          let meters = 0;
          let secs = 0;
          r.legs.forEach((leg) => {
            meters += (leg.distance && leg.distance.value) || 0;
            secs += (leg.duration && leg.duration.value) || 0;
          });
          if (!(meters > 0)) { resolve(null); return; }
          const points = [llOf(r.legs[0].start_location)].concat(r.legs.map((leg) => llOf(leg.end_location)));
          const line = (r.overview_path || []).map((p) => { const q = llOf(p); return [q.lat, q.lng]; });
          resolve({ miles: meters / 1609.344, minutes: secs / 60, points, line, source: 'google' });
        });
      } catch (err) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  /** Free OSRM driving route (same router as the rider app). */
  async function osrmRoute(blocks) {
    const points = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const pt = blockPoint(blocks[i]) || await geocodeBlock(blocks[i]);
      if (!pt || !isFinite(pt.lat) || !isFinite(pt.lng)) return null;
      points.push({ lat: +pt.lat, lng: +pt.lng });
    }
    const url = 'https://router.project-osrm.org/route/v1/driving/' +
      points.map((p) => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';') + '?overview=full&geometries=geojson';
    const data = await fetchJson(url);
    const r = data && data.code === 'Ok' && data.routes && data.routes[0];
    if (!r || !(r.distance > 0)) return null;
    const line = ((r.geometry && r.geometry.coordinates) || []).map((c) => [c[1], c[0]]);
    return { miles: r.distance / 1609.344, minutes: r.duration / 60, points, line, source: 'osrm' };
  }

  function routeResult() {
    return { miles: routeState.miles, minutes: routeState.minutes, source: routeState.source };
  }

  /** Look up the driving route for the current From / stops / To. Resolves { miles, … } or null. */
  function computeRoute() {
    const blocks = routeReadyBlocks();
    const key = blocks ? blocks.map(blockRouteKey).join('|') : '';
    if (!key) return Promise.resolve(null);
    if (routeState.key === key && routeState.miles != null) return Promise.resolve(routeResult());
    if (routePending && routePending.key === key) return routePending.promise;
    const seq = ++routeSeq;
    showRouteStatus('Looking up driving miles…');
    const promise = (async () => {
      let found = null;
      try {
        found = await googleRoute(blocks);
        if (!found) found = await osrmRoute(blocks);
      } catch (err) {
        found = null;
      }
      if (routePending && routePending.key === key) routePending = null;
      if (seq !== routeSeq || currentRouteKey() !== key) return null; // trip changed meanwhile
      if (!found) {
        els.manualMilesField.hidden = false;
        els.manualMiles.removeAttribute('readonly');
        hideRouteMap();
        showRouteStatus('Couldn’t look up the driving route. Check the addresses, or type the driving miles.', true);
        return null;
      }
      routeState.key = key;
      routeState.miles = found.miles;
      routeState.minutes = found.minutes;
      routeState.line = found.line;
      routeState.points = found.points;
      routeState.source = found.source;
      els.manualMiles.value = (Math.round(found.miles * 10) / 10).toFixed(1);
      els.manualMiles.dataset.auto = '1';
      els.manualMilesField.hidden = true;
      showRouteStatus(routeFoundMessage(found.miles, found.minutes));
      drawRouteMap(found.points, found.line);
      return routeResult();
    })();
    routePending = { key, promise };
    return promise;
  }

  /** Recalculate shortly after From / To / stops change. */
  function scheduleRoute() {
    clearTimeout(routeTimer);
    if (!routeReadyBlocks()) return;
    routeTimer = setTimeout(() => { computeRoute(); }, 500);
  }

  /** The trip changed: drop the old route, its map and its miles (auto-filled or typed). */
  function resetRoute() {
    routeSeq += 1;
    routePending = null;
    clearTimeout(routeTimer);
    routeState.key = '';
    routeState.miles = null;
    routeState.minutes = null;
    routeState.line = null;
    routeState.points = null;
    routeState.source = '';
    if (els.manualMiles) {
      els.manualMiles.value = '';
      delete els.manualMiles.dataset.auto;
    }
    if (els.manualMilesField) els.manualMilesField.hidden = true;
    hideRouteMap();
    if (els.routeStatus && !/Greater Houston area or Waco area/.test(els.routeStatus.textContent)) showRouteStatus('');
  }

  function pinIcon(label, kind) {
    return window.L.divIcon({
      className: 'pin-icon',
      html: '<div class="pin-float ' + kind + '"><span class="pin-label">' + escapeHtml(label) + '</span><span class="pin-head"></span></div>',
      iconSize: [88, 46],
      iconAnchor: [44, 44],
    });
  }

  function hideRouteMap() {
    if (els.map) els.map.hidden = true;
  }

  /** Route map (Leaflet / OpenStreetMap): Pickup, Stop n, Drop-off pins and the driving line. */
  function drawRouteMap(points, line) {
    if (!els.map || !window.L || !points || points.length < 2) return;
    try {
      const L = window.L;
      els.map.hidden = false;
      if (!leafletMap) {
        leafletMap = L.map(els.map, {
          zoomControl: true,
          scrollWheelZoom: false,
          dragging: !L.Browser.mobile, // one-finger page scrolling keeps working over the map on phones
          attributionControl: true,
        });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        }).addTo(leafletMap);
      }
      if (leafletLayer) leafletLayer.remove();
      leafletLayer = L.layerGroup().addTo(leafletMap);
      const pins = points.map((p) => [p.lat, p.lng]);
      const path = line && line.length > 1 ? line : pins;
      L.polyline(path, { color: '#143056', weight: 5, opacity: 0.85 }).addTo(leafletLayer);
      points.forEach((p, i) => {
        const last = i === points.length - 1;
        const label = i === 0 ? 'Pickup' : (last ? 'Drop-off' : 'Stop ' + i);
        const kind = i === 0 ? 'pin-pick' : (last ? 'pin-drop' : 'pin-stop');
        L.marker([p.lat, p.lng], { icon: pinIcon(label, kind), keyboard: false }).addTo(leafletLayer);
      });
      leafletMap.invalidateSize();
      leafletMap.fitBounds(L.latLngBounds(path.concat(pins)), { padding: [36, 36], maxZoom: 15 });
    } catch (err) {
      // The map is a bonus; the miles still apply.
    }
  }

  function currentInputs(miles) {
    const dateStr = els.rideDate.value;
    const timeStr = els.rideTime.value;
    return {
      miles,
      serviceType: els.serviceType ? els.serviceType.value : 'standard',
      passengers: els.passengers.value,
      stops: stopAddresses().length,
      dateStr,
      timeStr,
      isHoliday: isHolidayDate(dateStr),
      shortNotice: isShortNotice(dateStr, timeStr),
      airport: detectAirport(),
    };
  }

  async function onSubmit(e) {
    if (e) e.preventDefault();
    hideAllSuggest();

    if (!requireServiceArea()) return;

    const serviceType = els.serviceType ? els.serviceType.value : 'standard';
    if (serviceType === 'hourly' || serviceType === 'van') {
      const quote = { callForQuote: true, serviceType };
      renderEstimate(quote);
      return quote;
    }

    const missingStop = incompleteStopBlock();
    if (missingStop) {
      showRouteStatus('Finish each stop address (Line 1, City, State), or remove the stop.', true);
      const field = PARTS.map((p) => partEl(missingStop, p)).find((f) => f && f.required && !f.value.trim());
      if (field) {
        field.removeAttribute('readonly');
        field.focus();
      }
      return;
    }

    let miles = null;
    const typed = parseFloat(els.manualMiles.value);
    // Miles the customer typed themselves (the box only shows when the route lookup fails).
    const typedByCustomer = els.manualMiles.dataset.auto !== '1' && typed > 0;

    if (routeReadyBlocks()) {
      const found = await computeRoute({ quiet: false });
      if (found) miles = found.miles;
    }

    if (miles == null && typedByCustomer) {
      miles = typed;
      showRouteStatus(`Using the miles you entered: ${miles.toFixed(1)} (billed ${billedMiles(miles)} mi).`);
    } else if (miles == null) {
      els.manualMilesField.hidden = false;
      if (!routeReadyBlocks()) {
        showRouteStatus('Enter From and To (pick a suggestion, or fill Line 1 and City), or type the driving miles.', true);
      } else {
        showRouteStatus('Couldn’t look up the driving route. Check the addresses, or type the driving miles.', true);
      }
      els.manualMiles.removeAttribute('readonly');
      els.manualMiles.focus();
      return;
    }

    const result = computeEstimate(currentInputs(miles));
    renderEstimate(result);
    return result;
  }

  /** Bring the estimate card (price, breakdown, Book it) into view right after Get estimate. */
  function revealResults() {
    const card = els.resultsCard;
    if (!card || !card.getBoundingClientRect) return;
    const r = card.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    if (r.top >= 70 && r.top <= vh * 0.45) return; // already in view
    const wide = window.matchMedia && window.matchMedia('(min-width: 861px)').matches;
    const layout = card.closest ? card.closest('.layout') : null;
    if (wide && layout) {
      // Two columns: the estimate column is sticky, so scroll to the top of the form + estimate row instead.
      const top = layout.getBoundingClientRect().top + (window.pageYOffset || 0) - 88;
      try { window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (err) { window.scrollTo(0, Math.max(0, top)); }
      return;
    }
    try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) { card.scrollIntoView(true); }
  }

  function initManualMode() {
    mapsReady = false;
  }

  function initMaps() {
    const key = window.PCS_GOOGLE_MAPS_API_KEY.trim();
    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(key) +
      '&libraries=places&v=weekly&loading=async&callback=PCS_initMaps';
    script.async = true;
    script.defer = true;
    script.onerror = function () {
      initManualMode();
    };
    window.PCS_initMaps = async function () {
      try {
        let DS = google.maps.DirectionsService;
        if (!DS && google.maps.importLibrary) DS = (await google.maps.importLibrary('routes')).DirectionsService;
        directionsService = new DS();
        mapsReady = true;
        els.apiBanner.hidden = true;
        // A route looked up before Google loaded (free router) stays; nothing to redo.
      } catch (err) {
        initManualMode();
      }
    };
    // Google calls this if the key is rejected; keep the free route lookup (OSRM).
    window.gm_authFailure = function () {
      mapsReady = false;
      directionsService = null;
      legacyAutocomplete = null;
    };
    document.head.appendChild(script);
  }

  let tripChangedHook = null;
  function markTripChanged() {
    if (tripChangedHook) tripChangedHook();
  }

  function init() {
    if (els.year) els.year.textContent = String(new Date().getFullYear());
    const restored = restoreDraft();
    updateAreaLine();
    updateStopsUi();
    if (!els.rideDate.value || !els.rideTime.value) setDefaultDateTime();
    els.form.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    els.form.addEventListener('focusin', (event) => {
      const field = event.target;
      if (field && field.matches && field.matches('input[readonly]')) {
        field.removeAttribute('readonly');
      }
    });
    els.form.addEventListener('input', saveDraft);
    els.form.addEventListener('change', saveDraft);

    // Address typing: suggestions on Line 1; any manual edit drops the saved map pin for that block.
    els.form.addEventListener('input', (event) => {
      const t = event.target;
      const part = t && t.dataset ? t.dataset.part : '';
      if (!part) return;
      const block = t.closest('.addr-block');
      if (part !== 'line2') {
        clearBlockPlace(block);
        // The old route / miles no longer match this trip.
        resetRoute();
      }
      if (part === 'line1') scheduleSuggest(block);
      updateFlightDetails();
      updateRatePreview();
    });
    // Typed (not picked) addresses: look the route up once the field is left.
    els.form.addEventListener('change', (event) => {
      const t = event.target;
      const part = t && t.dataset ? t.dataset.part : '';
      if (part && part !== 'line2') scheduleRoute();
    });
    els.form.addEventListener('focusin', (event) => {
      const t = event.target;
      if (t && t.dataset && t.dataset.part === 'line1') primeSearchOrigin();
    });
    els.form.addEventListener('keydown', (event) => {
      const t = event.target;
      if (event.key === 'Escape' && t && t.dataset && t.dataset.part === 'line1') {
        clearTimeout(suggestTimer);
        suggestSeq += 1; // drop results still on the way
        hideSuggest(t.closest('.addr-block'));
      }
    });
    els.form.addEventListener('click', (event) => {
      const item = event.target.closest ? event.target.closest('.suggest-item') : null;
      if (item) {
        event.preventDefault();
        pickSuggestion(item.closest('.addr-block'), Number(item.getAttribute('data-i')));
        return;
      }
      const remove = event.target.closest ? event.target.closest('.btn-remove-stop') : null;
      if (remove) {
        const block = remove.closest('.addr-block');
        if (block) block.remove();
        renumberStops();
        resetRoute();
        saveDraft();
        updateFlightDetails();
        updateRatePreview();
        markTripChanged();
        scheduleRoute();
      }
    });
    // Suggestions use mousedown/touch-friendly buttons; keep the list open while tapping it.
    els.form.addEventListener('mousedown', (event) => {
      if (event.target.closest && event.target.closest('.suggest')) event.preventDefault();
    });
    // Once the list is touched, it is never swapped under the customer's finger.
    ['pointerdown', 'touchstart'].forEach((type) => {
      els.form.addEventListener(type, (event) => {
        const box = event.target.closest ? event.target.closest('.suggest') : null;
        if (box) box._touched = true;
      }, { passive: true });
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest || !event.target.closest('.addr-line1')) hideAllSuggest();
    });

    const CONTACT_ONLY = ['contact-name', 'contact-email', 'contact-phone', 'airline', 'flight-number', 'flight-direction'];
    const staleBooking = (event) => {
      const id = event && event.target && event.target.id;
      if (event && (!id || CONTACT_ONLY.indexOf(id) !== -1)) return;
      // A stale estimate must not ride along in a text after the trip changed.
      if (id !== 'manual-miles' || els.manualMiles.dataset.auto !== '1') lastEstimate = null;
      if (els.bookingPanel && !els.bookingPanel.hidden) {
        hideBookingPanel('Trip details changed — tap Get estimate again to see booking options.');
      }
    };
    tripChangedHook = () => staleBooking(null);
    els.form.addEventListener('input', staleBooking);
    els.form.addEventListener('change', staleBooking);

    // Get estimate only calculates and shows the estimate + Book it / request options. It never opens Messages.
    els.estimateButton.addEventListener('click', async (event) => {
      event.preventDefault();
      clearRequestNotes();
      const result = await onSubmit(event);
      if (result) revealResults();
    });
    els.textRequestButton.addEventListener('click', (event) => {
      if (!openRideText(event, lastEstimate, false)) event.preventDefault();
    });
    if (els.promoBookButton) {
      els.promoBookButton.addEventListener('click', (event) => {
        if (!openRideText(event, lastEstimate, true)) event.preventDefault();
      });
    }
    if (els.serviceType) els.serviceType.addEventListener('change', updateRatePreview);
    [els.rideDate, els.rideTime].forEach((f) => {
      f.addEventListener('input', updateRatePreview);
      f.addEventListener('change', updateRatePreview);
    });
    els.manualMiles.addEventListener('input', () => { delete els.manualMiles.dataset.auto; });
    window.addEventListener('resize', () => { if (leafletMap) leafletMap.invalidateSize(); });
    els.form.querySelectorAll('input[name="service-area"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        updateAreaLine();
        updateRequestFine();
        if (els.routeStatus.classList.contains('error') && /Greater Houston area or Waco area/.test(els.routeStatus.textContent)) {
          showRouteStatus('');
        }
        if (lastEstimate && !lastEstimate.callForQuote) updateBooking(lastEstimate);
      });
    });
    initContactChecks();
    updateRequestFine();
    if (els.addStopButton) els.addStopButton.addEventListener('click', () => addStop());
    if (els.useLocation) els.useLocation.addEventListener('click', useCurrentLocation);
    updateFlightDetails();
    updateRatePreview();

    if (hasApiKey()) {
      initMaps();
    } else {
      initManualMode();
    }
    // Restored draft with both ends set: show the route + miles again.
    if (restored) scheduleRoute();
  }

  // Expose for optional testing
  window.PCS_computeEstimate = computeEstimate;
  window.PCS_resolveTier = resolveTier;
  window.PCS_billedMiles = billedMiles;
  window.PCS_isShortNotice = isShortNotice;
  window.PCS_detectAirport = detectAirport;
  window.PCS_knownAirportInText = knownAirportInText;
  window.PCS_genericAirportText = genericAirportText;
  window.PCS_composeAddress = composeAddress;
  window.PCS_smsUrl = smsUrl;
  window.PCS_leadNumbersFor = leadNumbersFor;
  window.PCS_rideRequestBody = rideRequestBody;
  window.PCS_isHolidayDate = isHolidayDate;
  window.PCS_phoneProblem = phoneProblem;
  window.PCS_emailProblem = emailProblem;
  window.PCS_squareConfigured = squareConfigured;
  // Leaflet loads async; draw a route that was found before it arrived.
  window.PCS_leafletReady = () => {
    if (routeState.points && routeState.miles != null && currentRouteKey() === routeState.key) drawRouteMap(routeState.points, routeState.line);
  };
  window.PCS_routeState = () => ({ key: routeState.key, miles: routeState.miles, minutes: routeState.minutes, source: routeState.source, points: routeState.points });

  init();
})();
