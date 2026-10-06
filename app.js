/**
 * Private Car Services — Ride Fare Estimator
 * Rates mirror ptstaxiservices.com (estimate only).
 * v15: From / To / "+ Add a stop" address blocks (Line 1 with suggestions, Line 2, City, State, ZIP),
 * automatic rate tier + holiday + short notice from pickup date/time, automatic airport fee from addresses,
 * billed miles always rounded UP to the next whole mile.
 */
(function () {
  'use strict';

  // Business line shown to customers on the page.
  const PHONE = '9362617878';
  // Lead SMS recipients only (not shown in page copy). Business, then Matthew's personal.
  const LEAD_SMS_NUMBERS = ['9362617878', '9365227347'];
  // Waco-area leads also go to Anson. Greater Houston leads do not.
  const WACO_EXTRA_SMS_NUMBERS = ['2544981335'];
  // —— Book it (25% deposit) ——
  // Public Square link only. No Square secrets/API keys ever go on this site.
  // Matthew: replace with a Square payment link if you make one. If the URL contains
  // {amount} (e.g. 12.34) or {cents} (e.g. 1234), the deposit is filled in automatically.
  const SQUARE_DEPOSIT_URL = 'https://squareup.com/appointments/book/L077DQHSNJAG6';
  const DEPOSIT_PCT = 0.25;
  // Auto "Book it" only for Greater Houston, Mon–Fri 8:00 am–6:00 pm America/Chicago (same hours as the rider app).
  // Waco always stays pending — Anson's calendar is not connected.
  const BOOK_START_MIN = 8 * 60;
  const BOOK_END_MIN = 18 * 60;
  // Matthew's calendar must be clear this many minutes before pickup and after the estimated drop-off.
  const BUSY_BUFFER_MIN = 30;
  const BUSY_URL = 'app/busy.json';
  const DRAFT_KEY = 'pcs-quote-v15';
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
    smsLaunch: document.getElementById('sms-launch'),
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

  let map = null;
  let directionsService = null;
  let directionsRenderer = null;
  let fallbackOverlays = [];
  let mapsReady = false;
  let lastEstimate = null;
  let bookingToken = 0;
  let hereBias = null; // set only after the customer taps "Use current location"

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

  function blockComplete(block) {
    return !!(partVal(block, 'line1') && partVal(block, 'city') && partVal(block, 'state'));
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
  // Order: built-in airports → Google Places (when the page's Maps key allows it) → free OSM search (Photon).
  // Google failures switch that provider off for the visit and fall back silently.

  const providers = { googleNew: true, googleLegacy: true };
  let googleSession = null;
  let legacyAutocomplete = null;
  let legacyPlaces = null;
  let suggestTimer = 0;
  let suggestSeq = 0;

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

  /** Bias suggestions to the nearest results: current location → From pin → service area → Houston. */
  function searchBias(block) {
    if (hereBias) return hereBias;
    const from = blockPoint(blockByKey('pickup'));
    if (from && block && block.dataset.addr !== 'pickup') return from;
    return AREA_BIAS[serviceArea()] || DEFAULT_BIAS;
  }

  function nearbyCity(block) {
    const own = partVal(block, 'city');
    if (own && !/county$/i.test(own)) return own;
    const from = partVal(blockByKey('pickup'), 'city');
    if (from && !/county$/i.test(from)) return from;
    return serviceArea() === 'Waco area' ? 'Waco' : '';
  }

  function airportMatches(q) {
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
      resolve: () => Promise.resolve({
        line1: a.name + ' (' + a.code + '), ' + a.line1,
        city: a.city, state: a.state, zip: a.zip, lat: a.lat, lng: a.lng,
        kind: 'airport', code: a.code,
      }),
    }));
  }

  function componentsToPlace(comps, name, types, lat, lng, nameKey) {
    const get = (type, short) => {
      const c = (comps || []).find((x) => (x.types || []).indexOf(type) !== -1);
      if (!c) return '';
      return short ? (c.shortText || c.short_name || c.longText || c.long_name || '') : (c.longText || c.long_name || c.shortText || c.short_name || '');
    };
    const street = [get('street_number'), get('route', true)].filter(Boolean).join(' ');
    const city = get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3') || get('neighborhood');
    const state = get('administrative_area_level_1', true);
    const zip = get('postal_code');
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

  async function googleSuggest(q, bias) {
    if (!mapsReady || !window.google || !google.maps || !google.maps.places) return null;
    const P = google.maps.places;
    const circle = { center: { lat: bias.lat, lng: bias.lng }, radius: 50000 };
    if (providers.googleNew && P.AutocompleteSuggestion && P.AutocompleteSessionToken) {
      try {
        if (!googleSession) googleSession = new P.AutocompleteSessionToken();
        const res = await withTimeout(P.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q,
          sessionToken: googleSession,
          locationBias: circle,
          origin: { lat: bias.lat, lng: bias.lng },
          includedRegionCodes: ['us'],
        }), 6000);
        return (res.suggestions || []).filter((s) => s.placePrediction).slice(0, 5).map((s) => {
          const p = s.placePrediction;
          const main = p.mainText ? p.mainText.text : (p.text ? p.text.text : '');
          return {
            main,
            sub: p.secondaryText ? p.secondaryText.text : '',
            resolve: async () => {
              const place = p.toPlace();
              await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'addressComponents', 'location', 'types'] });
              googleSession = null;
              const loc = place.location;
              return componentsToPlace(place.addressComponents, place.displayName, place.types,
                loc ? loc.lat() : NaN, loc ? loc.lng() : NaN, main);
            },
          };
        });
      } catch (err) {
        providers.googleNew = false;
      }
    }
    if (providers.googleLegacy && P.AutocompleteService) {
      try {
        if (!legacyAutocomplete) legacyAutocomplete = new P.AutocompleteService();
        const preds = await withTimeout(new Promise((resolve, reject) => {
          legacyAutocomplete.getPlacePredictions({
            input: q,
            locationBias: circle,
            componentRestrictions: { country: 'us' },
          }, (results, status) => {
            if (status === 'OK') resolve(results || []);
            else if (status === 'ZERO_RESULTS') resolve([]);
            else reject(new Error(String(status)));
          });
        }), 6000);
        return preds.slice(0, 5).map((p) => {
          const sf = p.structured_formatting || {};
          return {
            main: sf.main_text || p.description,
            sub: sf.secondary_text || '',
            resolve: () => new Promise((resolve, reject) => {
              if (!legacyPlaces) legacyPlaces = new P.PlacesService(document.createElement('div'));
              legacyPlaces.getDetails({
                placeId: p.place_id,
                fields: ['name', 'formatted_address', 'address_components', 'geometry', 'types'],
              }, (place, status) => {
                if (status !== 'OK' || !place) { reject(new Error(String(status))); return; }
                const loc = place.geometry && place.geometry.location;
                resolve(componentsToPlace(place.address_components, place.name, place.types,
                  loc ? loc.lat() : NaN, loc ? loc.lng() : NaN, sf.main_text));
              });
            }),
          };
        });
      } catch (err) {
        providers.googleLegacy = false;
      }
    }
    return null;
  }

  function photonPlace(feature) {
    const p = (feature && feature.properties) || {};
    const coords = (feature && feature.geometry && feature.geometry.coordinates) || [];
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const isAirport = p.osm_key === 'aeroway' && /^(aerodrome|terminal)$/.test(String(p.osm_value || ''));
    const isPoi = !!p.name && p.osm_key !== 'highway' && p.osm_key !== 'place' && p.type !== 'street' && p.type !== 'house';
    const known = isAirport ? knownAirportInText(p.name) : null;
    let name = p.name || '';
    if (known && name.indexOf('(' + known.code + ')') === -1) name += ' (' + known.code + ')';
    let line1 = street;
    if (name && normText(name) !== normText(street)) line1 = street ? name + ', ' + street : name;
    return {
      line1: line1 || name,
      // OSM often has no city for unincorporated areas; "Harris County" is clearer than a neighborhood name.
      city: p.city || p.town || p.village || (p.county ? String(p.county).replace(/\s+County$/i, '') + ' County' : '') || p.locality || '',
      state: stateCode(p.state),
      zip: p.postcode || '',
      lat: Number(coords[1]),
      lng: Number(coords[0]),
      kind: isAirport ? 'airport' : (isPoi ? 'place' : 'address'),
      code: known ? known.code : '',
    };
  }

  async function photonSuggest(q, bias, city) {
    const base = 'https://photon.komoot.io/api/?limit=10&lang=en&location_bias_scale=0&zoom=14&lat=' + bias.lat + '&lon=' + bias.lng + '&q=';
    const queries = [q];
    // Place names ("Walmart") get a second pass with the nearby city so the closest one shows up.
    if (city && !/^\s*\d/.test(q) && normText(q).indexOf(normText(city)) === -1) queries.push(q + ', ' + city);
    const results = await Promise.all(queries.map((query) => fetchJson(base + encodeURIComponent(query))));
    const feats = [];
    results.forEach((data) => { ((data && data.features) || []).forEach((f) => feats.push(f)); });
    const seen = {};
    return feats
      .filter((f) => {
        const p = f.properties || {};
        if (p.countrycode && p.countrycode !== 'US') return false;
        const id = String(p.osm_id || '') + '|' + normText(p.name) + '|' + normText(p.street);
        if (seen[id]) return false;
        seen[id] = 1;
        return true;
      })
      .map((f) => {
        const place = photonPlace(f);
        const pt = isFinite(place.lat) ? { lat: place.lat, lng: place.lng } : null;
        return { place, dist: pt ? haversineMiles(pt, bias) : 9999 };
      })
      .filter(({ place }) => {
        const id = normText(place.line1) + '|' + normText(place.city) + '|' + place.zip;
        if (seen[id]) return false;
        seen[id] = 1;
        return true;
      })
      // Nearest first (e.g. the closest Walmart).
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
      .map(({ place }) => ({
        main: place.line1,
        sub: [place.city, [place.state, place.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        resolve: () => Promise.resolve(place),
      }));
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

  function renderSuggest(block, items) {
    const box = suggestBox(block);
    if (!box) return;
    if (!items.length) { hideSuggest(block); return; }
    box._items = items;
    box.innerHTML = items.map((it, i) =>
      '<button type="button" class="suggest-item" role="option" data-i="' + i + '">' +
        '<strong>' + escapeHtml(it.main) + '</strong>' +
        (it.sub ? '<span>' + escapeHtml(it.sub) + '</span>' : '') +
      '</button>'
    ).join('');
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
      const bias = searchBias(block);
      const airports = airportMatches(q);
      let more = [];
      if (q.length >= 3) {
        more = (await googleSuggest(q, bias)) || (await photonSuggest(q, bias, nearbyCity(block))) || [];
      }
      if (seq !== suggestSeq || input.value.trim() !== q) return;
      const airportNames = airports.map((a) => normText(a.main));
      more = more.filter((m) => !airportNames.some((n) => normText(m.main).indexOf(n.replace(/ [a-z]{3}$/, '')) === 0));
      renderSuggest(block, airports.concat(more).slice(0, 6));
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
    clearManualMiles();
    updateFlightDetails();
    updateRatePreview();
    saveDraft();
    markTripChanged();
  }

  async function pickSuggestion(block, index) {
    const box = suggestBox(block);
    const item = box && box._items && box._items[index];
    if (!item) return;
    hideSuggest(block);
    try {
      const place = await item.resolve();
      applyPlace(block, place);
    } catch (err) {
      const input = partEl(block, 'line1');
      if (input) input.value = item.main;
      showRouteStatus('Couldn’t load that place. Check City / State / ZIP.', true);
    }
    const line2 = partEl(block, 'line2');
    if (line2) line2.removeAttribute('readonly');
  }

  /* ---------- Current location (From) ---------- */

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
      hereBias = { lat, lng };
      const block = blockByKey('pickup');
      const data = await fetchJson('https://photon.komoot.io/reverse?limit=1&lang=en&lat=' + lat + '&lon=' + lng);
      const feature = data && data.features && data.features[0];
      let place = feature ? photonPlace(feature) : null;
      if (!place || !place.line1) {
        place = { line1: 'Current location (' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ')', city: '', state: 'TX', zip: '' };
      }
      place.lat = lat;
      place.lng = lng;
      if (place.kind !== 'airport') place.kind = 'place';
      applyPlace(block, place);
      done();
      if (!partVal(block, 'city')) {
        const city = partEl(block, 'city');
        if (city) { city.removeAttribute('readonly'); city.focus(); }
      }
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
    // iOS: undocumented multi-recipient form. Android: RFC comma list + ?body=.
    // Customer Messages To: will list both; page copy still shows business only.
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
    return true;
  }

  function showConfirmation() {
    if (!els.requestConfirm) return;
    els.requestConfirm.hidden = false;
    els.requestConfirm.textContent = 'Request ready. Send the text to 936-261-7878. Your details stay on this page.';
  }

  function openRideText(event, result, promo) {
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
    const url = smsUrl(rideRequestBody(result, promo), serviceArea());
    if (els.textRequestButton) els.textRequestButton.href = url;
    if (els.promoBookButton) els.promoBookButton.href = url;
    if (els.smsLaunch) els.smsLaunch.href = url;
    showConfirmation();
    if (event && (event.currentTarget === els.textRequestButton || event.currentTarget === els.promoBookButton)) return true;
    if (els.smsLaunch) els.smsLaunch.click();
    return true;
  }

  function renderEstimate(result) {
    lastEstimate = result;
    updateAreaLine();
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

  function squareDepositUrl(deposit) {
    const cents = String(Math.round(deposit * 100));
    return SQUARE_DEPOSIT_URL
      .replace(/\{amount\}/g, deposit.toFixed(2))
      .replace(/\{cents\}/g, cents);
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

  function bookingRequestBody(result, deposit) {
    return rideRequestBody(result, false)
      // 10% web offer requires pay-in-full, so it does not apply to a deposit booking.
      .replace('\n10% website booking. Please apply the discount.', '')
      .replace(
        'I would like to request a ride. Please confirm availability and the final fare.',
        'BOOK IT — I would like to book this ride (website Book it, business hours).'
      )
      .replace(
        'This is a ride request only, not a booking confirmation.',
        'Deposit: 25% = ' + money(deposit) + ' (Square).\n' +
        'I understand this booking is PENDING until accepted by a driver or Matthew, ' +
        'the fare may change after pickup if the trip changes, and Matthew may revise or cancel the pickup if no one is available.'
      );
  }

  function hideBookingPanel(note) {
    bookingToken += 1;
    if (!els.bookingPanel) return;
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
        '<p class="book-kicker pending">Pending approval</p>' +
        '<p class="book-copy">' + escapeHtml(decision.message) +
        ' Your request stays <strong>pending until Matthew or a driver accepts it</strong>. Text it to us and we’ll confirm.</p>' +
        '<a class="btn btn-secondary" id="book-pending-text" href="sms:' + PHONE + '">Text my request</a>' +
        '<p class="book-fine">Instant <strong>Book it</strong> is for <strong>Greater Houston</strong> only, Mon–Fri 8:00 am–6:00 pm (Central) when Matthew’s schedule is open. <strong>Waco</strong> requests always stay pending confirmation (we don’t have Anson’s calendar).</p>';
      const btn = document.getElementById('book-pending-text');
      if (btn) {
        btn.addEventListener('click', (event) => {
          if (!openRideText(event, lastEstimate, false)) event.preventDefault();
        });
      }
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
            '<li>Deposit: <strong>' + money(deposit) + '</strong> (25% of the estimated total).</li>' +
            '<li>Matthew may adjust the fare after pickup if the trip changes (stops, waits, route).</li>' +
            '<li>If no one is available, Matthew will contact you to revise the pickup or cancel.</li>' +
          '</ul>' +
        '</div>' +
        '<label class="check book-ack"><input type="checkbox" id="book-ack" /> <span>I understand my booking is pending until accepted.</span></label>' +
        '<a class="btn btn-primary btn-book-step" id="book-text-btn" aria-disabled="true" href="sms:' + PHONE + '">1 · Text my booking to PCS</a>' +
        '<a class="btn btn-secondary btn-book-step" id="book-square-btn" aria-disabled="true" target="_blank" rel="noopener" href="' +
          escapeHtml(squareDepositUrl(deposit)) + '">2 · Pay ' + money(deposit) + ' deposit on Square</a>' +
        '<p class="book-fine">Square opens in a new tab. Your deposit amount is ' + money(deposit) + '.</p>' +
      '</div>';

    const bookBtn = document.getElementById('book-it-btn');
    const confirmBox = document.getElementById('book-confirm');
    const ack = document.getElementById('book-ack');
    const textBtn = document.getElementById('book-text-btn');
    const squareBtn = document.getElementById('book-square-btn');
    const syncAck = () => {
      const on = !!(ack && ack.checked);
      [textBtn, squareBtn].forEach((a) => { if (a) a.setAttribute('aria-disabled', on ? 'false' : 'true'); });
    };
    if (bookBtn) {
      bookBtn.addEventListener('click', () => {
        if (confirmBox) confirmBox.hidden = false;
        bookBtn.hidden = true;
        if (confirmBox && confirmBox.scrollIntoView) confirmBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    if (ack) ack.addEventListener('change', syncAck);
    const needAck = (event) => {
      if (ack && ack.checked) return true;
      event.preventDefault();
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
    if (textBtn) {
      textBtn.addEventListener('click', (event) => {
        if (!needAck(event)) return;
        updateFlightDetails();
        if (!els.form.reportValidity()) {
          event.preventDefault();
          const bad = els.form.querySelector(':invalid');
          if (bad && bad.scrollIntoView) bad.scrollIntoView({ block: 'center' });
          return;
        }
        saveDraft();
        textBtn.href = smsUrl(bookingRequestBody(lastEstimate, deposit), serviceArea());
      });
    }
    if (squareBtn) {
      squareBtn.addEventListener('click', (event) => { needAck(event); });
    }
  }

  function updateBooking(result) {
    const token = ++bookingToken;
    if (!els.bookingPanel) return;
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

  /* ---------- Driving miles: Google route when available, else free OSM route ---------- */

  async function geocodeAddress(address, bias) {
    const b = bias || DEFAULT_BIAS;
    const url = 'https://photon.komoot.io/api/?limit=1&lat=' + b.lat + '&lon=' + b.lng + '&q=' + encodeURIComponent(address);
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

  function routeFoundMessage(miles) {
    const stopCount = stopAddresses().length;
    const via = stopCount
      ? ' via ' + stopCount + (stopCount === 1 ? ' stop' : ' stops')
      : '';
    return 'Route found: ' + miles.toFixed(1) + ' miles driving' + via + ' (billed ' + billedMiles(miles) + ' mi).';
  }

  function clearFallbackOverlays() {
    fallbackOverlays.forEach((o) => { try { o.setMap(null); } catch (err) {} });
    fallbackOverlays = [];
  }

  function drawFallbackRoute(points, geometry) {
    if (!map || !window.google || !google.maps) return;
    try {
      if (directionsRenderer) directionsRenderer.set('directions', null);
      clearFallbackOverlays();
      const bounds = new google.maps.LatLngBounds();
      const path = (geometry || []).map((c) => ({ lat: c[1], lng: c[0] }));
      if (path.length) {
        fallbackOverlays.push(new google.maps.Polyline({ map, path, strokeColor: '#143056', strokeOpacity: 0.85, strokeWeight: 5 }));
        path.forEach((p) => bounds.extend(p));
      }
      points.forEach((p, i) => {
        const label = i === 0 ? 'A' : (i === points.length - 1 ? 'B' : String(i));
        fallbackOverlays.push(new google.maps.Marker({ map, position: { lat: p.lat, lng: p.lon }, label }));
        bounds.extend({ lat: p.lat, lng: p.lon });
      });
      els.map.hidden = false;
      map.fitBounds(bounds, 40);
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchOsrmRoute(points) {
    const path = points.map((point) => point.lon + ',' + point.lat).join(';');
    const url = 'https://router.project-osrm.org/route/v1/driving/' + path + '?overview=full&geometries=geojson';
    const data = await fetchJson(url);
    const route = data && data.code === 'Ok' && data.routes && data.routes[0];
    const meters = route && route.distance;
    if (!Number.isFinite(meters) || meters <= 0) return null;
    return { miles: meters / 1609.344, geometry: route.geometry && route.geometry.coordinates };
  }

  async function fetchPublicDrivingMiles() {
    const blocks = routeBlocks().filter(blockComplete);
    if (blocks.length < 2 || !blockComplete(blockByKey('pickup')) || !blockComplete(blockByKey('dropoff'))) return null;

    const points = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const known = blockPoint(blocks[i]);
      const point = known
        ? { lat: known.lat, lon: known.lng }
        : await geocodeAddress(routeQuery(blocks[i]), points.length ? { lat: points[0].lat, lng: points[0].lon } : searchBias(blocks[i]));
      if (!point) return null;
      points.push(point);
    }

    const route = await fetchOsrmRoute(points);
    if (!route) return null;
    drawFallbackRoute(points, route.geometry);
    showRouteStatus(routeFoundMessage(route.miles));
    return route.miles;
  }

  function routeLocation(block) {
    const pt = blockPoint(block);
    return pt ? new google.maps.LatLng(pt.lat, pt.lng) : routeQuery(block);
  }

  async function fetchDrivingMiles() {
    if (!mapsReady || !directionsService) return null;
    const pickup = blockByKey('pickup');
    const dropoff = blockByKey('dropoff');
    if (!blockComplete(pickup) || !blockComplete(dropoff)) return null;
    const stops = stopBlocks().filter(blockComplete);

    return new Promise((resolve) => {
      try {
        directionsService.route(
          {
            origin: routeLocation(pickup),
            destination: routeLocation(dropoff),
            waypoints: stops.map((b) => ({ location: routeLocation(b), stopover: true })),
            travelMode: google.maps.TravelMode.DRIVING,
            unitSystem: google.maps.UnitSystem.IMPERIAL,
          },
          (response, status) => {
            if (status === 'OK' && response.routes && response.routes[0]) {
              clearFallbackOverlays();
              directionsRenderer.setDirections(response);
              els.map.hidden = false;
              let meters = 0;
              response.routes[0].legs.forEach((leg) => { meters += leg.distance.value; });
              const miles = meters / 1609.344;
              showRouteStatus(routeFoundMessage(miles));
              resolve(miles);
            } else {
              resolve(null);
            }
          }
        );
      } catch (err) {
        resolve(null);
      }
    });
  }

  function clearManualMiles() {
    if (els.manualMiles && els.manualMiles.dataset.auto === '1') {
      els.manualMiles.value = '';
      delete els.manualMiles.dataset.auto;
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
    const typedByCustomer = els.manualMiles.dataset.auto !== '1' && typed > 0 && !els.manualMilesField.hidden;

    if (blockComplete(blockByKey('pickup')) && blockComplete(blockByKey('dropoff'))) {
      showRouteStatus('Looking up driving miles…');
      if (mapsReady) miles = await fetchDrivingMiles();
      if (miles == null) miles = await fetchPublicDrivingMiles();
    }

    if (miles != null) {
      // Auto-fill the miles box so nobody has to re-type it.
      els.manualMiles.value = (Math.round(miles * 10) / 10).toFixed(1);
      els.manualMiles.dataset.auto = '1';
    } else if (typedByCustomer) {
      miles = typed;
      showRouteStatus(`Using the miles you entered: ${miles.toFixed(1)} (billed ${billedMiles(miles)} mi).`);
    } else {
      els.manualMilesField.hidden = false;
      if (!blockComplete(blockByKey('pickup')) || !blockComplete(blockByKey('dropoff'))) {
        showRouteStatus('Enter From and To (Line 1, City, State), or type driving miles.', true);
      } else {
        showRouteStatus('Couldn’t look up the route. Check the addresses, or type the driving miles.', true);
      }
      els.manualMiles.removeAttribute('readonly');
      els.manualMiles.focus();
      return;
    }

    const result = computeEstimate(currentInputs(miles));
    renderEstimate(result);
    return result;
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
    window.PCS_initMaps = function () {
      try {
        map = new google.maps.Map(els.map, {
          center: AREA_BIAS[serviceArea()] || DEFAULT_BIAS,
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
        mapsReady = true;
        els.apiBanner.hidden = true;
      } catch (err) {
        console.error(err);
        initManualMode();
      }
    };
    // Google calls this if the key is rejected; keep the free lookup path.
    window.gm_authFailure = function () {
      mapsReady = false;
      map = null;
      if (els.map) els.map.hidden = true;
      providers.googleNew = false;
      providers.googleLegacy = false;
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
    if (restored && sessionStorage.getItem(DRAFT_KEY)) showConfirmation();
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
      if (part !== 'line2') clearBlockPlace(block);
      clearManualMiles();
      if (part === 'line1') scheduleSuggest(block);
      updateFlightDetails();
      updateRatePreview();
    });
    els.form.addEventListener('keydown', (event) => {
      const t = event.target;
      if (event.key === 'Escape' && t && t.dataset && t.dataset.part === 'line1') hideSuggest(t.closest('.addr-block'));
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
        clearManualMiles();
        saveDraft();
        updateFlightDetails();
        updateRatePreview();
        markTripChanged();
      }
    });
    // Suggestions use mousedown/touch-friendly buttons; keep the list open while tapping it.
    els.form.addEventListener('mousedown', (event) => {
      if (event.target.closest && event.target.closest('.suggest')) event.preventDefault();
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest || !event.target.closest('.addr-line1')) hideAllSuggest();
    });

    const CONTACT_ONLY = ['contact-name', 'contact-email', 'contact-phone', 'airline', 'flight-number', 'flight-direction'];
    const staleBooking = (event) => {
      const id = event && event.target && event.target.id;
      if (event && (!id || CONTACT_ONLY.indexOf(id) !== -1)) return;
      if (els.bookingPanel && !els.bookingPanel.hidden) {
        hideBookingPanel('Trip details changed — tap Get estimate again to see booking options.');
      }
    };
    tripChangedHook = () => staleBooking(null);
    els.form.addEventListener('input', staleBooking);
    els.form.addEventListener('change', staleBooking);

    els.estimateButton.addEventListener('click', async (event) => {
      event.preventDefault();
      const result = await onSubmit(event);
      if (result) openRideText(null, result);
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
    els.form.querySelectorAll('input[name="service-area"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        updateAreaLine();
        if (els.routeStatus.classList.contains('error') && /Greater Houston area or Waco area/.test(els.routeStatus.textContent)) {
          showRouteStatus('');
        }
        if (lastEstimate && !lastEstimate.callForQuote) updateBooking(lastEstimate);
      });
    });
    if (els.addStopButton) els.addStopButton.addEventListener('click', () => addStop());
    if (els.useLocation) els.useLocation.addEventListener('click', useCurrentLocation);
    updateFlightDetails();
    updateRatePreview();

    if (hasApiKey()) {
      initMaps();
    } else {
      initManualMode();
    }
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

  init();
})();
