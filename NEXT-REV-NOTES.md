> **Follow-up:** Instant Book it / calendar check = **Greater Houston only**; **Waco** always pending (no Anson calendar). See `app.js` bookingDecision + panel copy. Cache `app.js?v=14`.

# Next revision — Oct 5, 2026 (God v24 + estimator Book it)

Built on the **live** GitHub Pages files (God `?v=22`, password-hash login). No Firebase Auth needed.
The Firebase-Auth God work from earlier today (v23, not live) was moved to `wip-firebase-auth/god/`, so it's
saved for when Matthew finishes the Console steps. **Do not upload that folder.**

## What changed

### God mode (`/god/`) — v24
1. **Stays signed in until you tap Sign out.**
   - After a correct password login (only `mwragge78@gmail.com`), a sign-in marker is saved in **localStorage**
     (`pcs-god-keep-v1`). iOS clears sessionStorage when you switch apps, but it keeps localStorage.
   - The marker is tied to the current password hash in `god-auth.js`. If the password or hash changes, every saved
     sign-in stops working, and the marker is checked again each time the app opens.
   - Only **Sign out** clears it. The old `pcs-god-session` entries (sessionStorage and localStorage) are wiped on load and never trusted.
   - When you come back to the app, the board refreshes right away.
   - Security is the **same as the live v22** (a client-side gate). The real lock is still Firebase Auth plus the rules.
     See `MATTHEW-FIREBASE-AUTH-STEPS.md`.
2. **Tap a driver's name to go to them on the map.**
   - Driver names in the Drivers list are now tappable. Online drivers also get a **📍 Locate on map** button.
     On an active trip card, tapping the driver's name does the same thing.
   - The map flies to the driver at zoom 15 and highlights their marker (gold ring) and card. It keeps following
     them on each 5-second refresh, so it won't jump back to the full view. Tap **Show everyone** to go back to it.
   - Tapping a marker on the map also follows that driver.
   - If a driver has no live location, a short note says "X is not sharing a location right now".
3. Cache bust: `god/index.html` → `styles.css?v=24`, `god-auth.js?v=24`, `god.js?v=24`.

### Estimator (`/index.html`, `app.js?v=14`, `styles.css?v=3`) — Book it, first slice
After a successful estimate, a booking panel shows up under the total:
- **Instant "Book it"** shows only when **all** of these are true:
  - Service area is **Greater Houston area** (Waco always stays pending — Anson’s calendar is not connected)
  - Pickup is **Mon–Fri, 8:00 am–6:00 pm Central**
  - It isn't a holiday (the Holiday box isn't checked and the date isn't on the built-in list: New Year's, MLK,
    Presidents, Memorial, Juneteenth, July 4, Labor, Veterans, Thanksgiving + the Friday after, Christmas Eve/Day,
    New Year's Eve, with observed days)
  - The trip isn't over 75 miles (the return fee needs Matthew)
  - The time hasn't already passed
  - **Calendar check:** nothing in `app/busy.json` overlaps from **30 minutes before pickup** to **30 minutes after
    the estimated drop-off**. Ride length is estimated at about 40 mph, with a 30-minute minimum.
- **Book it** opens a warning: *pending until accepted by the driver or Matthew*, a 25% deposit, Matthew may adjust
  the fare after pickup, and Matthew may revise or cancel the pickup if no one is available. The customer has to
  check "I understand" before either button works:
  1. **Text my booking to PCS.** This sends an SMS to the existing lead numbers with the trip, the "BOOK IT" header, the deposit amount, and the pending acknowledgment.
  2. **Pay $X deposit on Square.** This opens Square in a new tab.
- **Otherwise** (nights, weekends, holidays, a time conflict, or the schedule can't be read) there's no Book it button.
  The panel says the request stays **pending until Matthew or a driver accepts it**, with a **Text my request** button.
- The deposit is 25% of the estimated total, rounded to the cent.
- If the trip details change, the panel asks the customer to tap Get estimate again.

### `app/busy.json` refreshed
Rebuilt from Matthew's Google Calendar on Oct 5 for Oct 5 – Dec 5. It has **timed events only, with start and end
times only** (no titles). All-day items like birthdays aren't counted as busy. The rider app (`app/app.js`) already
reads this same file, so it picks up these windows too.
**It's a snapshot.** Refresh it whenever the calendar changes, or set up a Zapier or Apps Script job to rewrite it.

## Square: is the deposit live?
**Partly.** No Square secrets or API keys are on the site, and none should be.
- Today, **Pay deposit on Square** opens the existing public Square link already used in the app:
  `https://squareup.com/appointments/book/L077DQHSNJAG6`. The page shows the exact deposit amount, but **Square won't
  pre-fill or charge that amount on its own**. That depends on how the Square Appointments page or deposit is set up.
- **To make the deposit amount exact, Matthew needs to:** create a Square **payment link**. Square Dashboard →
  Online Checkout → Payment links. Either use one that lets the customer enter the amount, or use any checkout URL
  that takes the amount in the URL. Then paste it into `SQUARE_DEPOSIT_URL` at the top of `app.js`. If the URL
  contains `{amount}` (like `12.34`) or `{cents}` (like `1234`), the site fills in the deposit automatically.
- Accepting a booking and charging after the ride still happen by hand (text + Square) until there's a server-side Square integration (see `app/SQUARE_PAYMENT_NOTES.md`).

## How to publish (browser upload to GitHub as Private-Car-Services → `main`)
Upload **only** these files, keeping the same paths:

| Path in repo | Why |
|---|---|
| `god/god.js` | stay signed in + tap to locate |
| `god/styles.css` | locate / focus styles |
| `god/index.html` | cache bust to v24 |
| `god/god-auth.js` | **include it.** It's the live password-hash file (same contents as live; Pages needs it at v24) |
| `index.html` | booking panel + `app.js?v=14` / `styles.css?v=3` |
| `app.js` | Book it logic |
| `styles.css` | booking panel styles |
| `app/busy.json` | refreshed busy windows |
| `NEXT-REV-NOTES.md` | optional |

**Never upload:** `config.js` (it holds the Maps key; live already has its own), `.env*`, or `wip-firebase-auth/`.
**Don't upload** the other changed files under `app/` (`app/app.js`, `app/index.html`, `app/driver/*`, `app/signup/*`,
`app/sync-config.js`, `app/pcs-auth.js`). They're the unfinished Firebase Auth round (v37), and uploading them would
break the live rider and driver apps until the apiKey is in.

After the upload, wait about a minute for Pages, then:
1. On iPhone, open `/god/`. Pull down to refresh (or close and reopen the home-screen app) so it loads v24, then sign in once.
2. Switch to another app and come back. You should still be signed in. Tap **Sign out** to test that it signs you out.
3. Tap a driver's name, like Anson's. The map should fly to him. Tap **Show everyone** to go back.
4. On the estimator, get a quote for a weekday at 2 pm and check that the **Book it** panel shows. Then try a Saturday and check that it says **Pending approval**.

## Next rev — Maps UX (requested 2026-10-05)
- Restore **Current Location** on From.
- Restore Places autocomplete (IAH, Pizza Hut, etc.) on From/To/stops.
- Restore the route map.
- Auto-fill computed driving miles into the total-miles field used for the quote (no manual re-entry).
- Likely tied to Pages Actions inject of `config.js` (Maps key); live site may be on a build without Places when Actions is stuck.

- Address fields: **Line 1**, **Line 2**, **City**, **State**, **ZIP** (not street/city/state only).

- Stops: visible control (prefer dropdown **0–5**); render that many address blocks (Line1/Line2/City/State/ZIP). Make Current Location look like a real button.

- Stops dropdown 0–5: at 0 show only From/To; only add stop address blocks for the number selected.

## Address UX reference (2026-10-05 screenshot)
- One searchable line per place (From, then Stop 1…, then “Add a stop”); no empty stop rows until added.
- Map shows route; numbered pin for stops.
- Clear tap targets (pills/buttons), solid Done.
- Optional expand under each line: Line 2 / City / State / ZIP for SMS detail — decide with Matthew.
- Customer-facing copy: never name the competitor app.

- Auto airport upcharge when From/To/stop matches known airports (IAH, HOU, etc.).

- Airport detect: any airport (name/address), not Houston-only.

- Places search: bias to nearest (geolocation / From pin), e.g. closest Walmart first.

- Remove guest trip-type / day-night toggles; auto from pickup time + airport place.

- FlightAware: lookup by flight number → live land/depart time → suggest pickup/drop-off (Matthew to provide link).

- FlightAware app/source: https://apps.apple.com/app/id316793974

## FlightAware (research 2026-10-05) — DO NOT PUBLISH yet
- Auto-fill needs AeroAPI Standard (~$100/mo min), server-side key. Personal tier not OK for B2C.
- Interim: deep-link https://www.flightaware.com/live/flight/{IDENT} (e.g. UAL123).
- No scraping (ToS).
- Alt: Aviationstack paid ~$50/mo if cheaper later.

## Driver shift odometer (requested 2026-10-05) — built in v45 (below)
- After **ending miles** on logout (or skip), mark the shift closed.
- Next login must ask for a **new opening odometer** so miles while logged out stay personal.
- Local patch already drafted in `app/app.js` (cache target `?v=41`); hold until Matthew says go.

## God mode day board from calendar (requested 2026-10-05) — built in v45 (below)
- Show **scheduled rides** on God mode with pickup + drop-off from Matthew’s calendar (dates/times/locations).
- Goal: plan the day / wall-TV ops board. Feasible via Calendar busy/events + Book it / ride records; needs design pass (map pins vs list timeline).
- Not building now.

## God mode dispatch + commission (requested 2026-10-05) — first slice in v45 day board
- Future website bookings on God board; Matthew assigns a driver (dispatcher).
- Assigned rides pay that driver’s commission into their Mon–Sun pay week.
- Depends on Book it / scheduled rides + roster commissions already started.


## v45 — built locally Oct 5, 2026 (NOT published yet)
Cache: `app/app.js?v=45`, `app/styles.css?v=45`, God `god.js?v=45` / `styles.css?v=45` / `god-auth.js?v=45`.

### 1) Driver shift odometer re-prompt (`driver-shift-odo-reprompt`)
- Logout (ending odometer **or Skip**) sets `shiftClosed: true` on today's miles row.
- Next login **must** enter a new opening odometer before GPS miles count again.
- Miles while logged out stay personal (not counted) because `trackDailyMiles` only runs when signed in and not gated.
- **Keeps the v44 GPS counting path intact:** same lat/lng that moves the map icon, ~3 m threshold, no accuracy gate, no `shiftClosed` blocking of counting once the new opening odo is saved (row is reopened with `shiftClosed: false`).
- Same-day reopen **preserves** prior `gpsMiles` so Today miles does not reset to 0 after re-login.

### 2) God Scheduled rides / day board (`god-calendar-day-board`)
- God mode top board lists upcoming rides from Firebase hub `/rides/PCSCALND/{eventId}`.
- Events must have titles starting with **PCS** (case-insensitive), e.g. `PCS – John Smith`.
- Fields: time, rider (title after PCS), pickup (Location), drop-off (`Drop-off:` / `To:` line in notes, else whole notes).
- God assigns an **approved** driver; assignment is written back to the hub and shows on that driver's app ("Scheduled for you").
- Complete (God with fare-before-tax, or driver Mark complete) credits commission into `/rides/DRVRHSTY/{driverId}/{code}` for the Mon–Sun pay week.
- Big TV-readable layout in `god/styles.css`.
- Browser cannot call Google Calendar directly → hub is populated by a sync routine (see below). **Do not edit routines from this pack; parent/Matthew applies the prompt.**

### Calendar notation (answer for Matthew)
**Yes — title calendar events with `PCS` at the start** (example: `PCS – John Smith`). Put the pickup in the event **Location**. Put drop-off in notes as `Drop-off: …` or `To: …`. Non-PCS titles stay off the day board (and can still block busy time via `busy.json` if the busy sync includes them).

### Routine change needed (suggested prompt — do not auto-edit routines)
Update / create routine **"PCS busy slots from calendar"** (or a sibling **"PCS calendar rides → Firebase"**) so that on a weekday cadence it:
1. Reads Matthew's Google Calendar timed events for today → ~14–30 days ahead.
2. Continues writing `app/busy.json` windows (start/end only, no titles) for Book it.
3. **Also** upserts PCS-titled events into Firebase Realtime Database hub:
   `PUT https://pts-maps-rides-default-rtdb.firebaseio.com/rides/PCSCALND/{stableEventId}.json`
   with JSON: `{ id, title, rider, pickup, dropoff, start, end, description, status:"open" }`
   - Include only titles matching `/^pcs\b/i`.
   - `pickup` = event location; `dropoff` = Drop-off:/To: line or full description.
   - Preserve existing `assignedDriverId` / `assignedDriverName` / `status` / `code` / `commissionCents` when the event already exists (do not wipe assignments on sync).
   - Remove or mark cancelled hub rows whose Google event was deleted / no longer PCS.
4. Apply Firebase rules for `PCSCALND` (see `database.rules.json`) when hardening auth.

### Not in v45
- FlightAware (awaiting Matthew's link / AeroAPI).
- Estimator Places/stops/auto-rate extras left queued unless already live.

### Upload package
Prepared at `/workspace/pcs-next-rev-v45/` — publish only when Matthew says go. Never upload `config.js`.

## Driver app: keep screen awake while logged in
- Requested 2026-10-05 by Matthew: screen dims/locks when untouched. Keep the screen on while the driver is logged in/online (Screen Wake Lock API; re-acquire on visibilitychange; fallback for iOS PWA if needed). Release on logout.
- Clarified by Matthew: screen stays on from login until logout, or until he manually presses the side button to lock / closes the app. No auto-dim while logged in.

## Quote page v15 — built locally Oct 5, 2026 (NOT published yet)
Cache: root `index.html` → `styles.css?v=15`, `app.js?v=15` (live was v14). Package: `/workspace/pcs-quote-rev/`.

- **Header/footer/meta:** "Houston & Willis, TX" → **"Houston & Waco, TX"**. City placeholders no longer say Willis.
- **Why Willis kept coming back:** it was in the root `index.html` since the first upload (Oct 2, `f0cee71`) and was
  never removed there. The Oct 3 "Remove Houston and Willis from the app header" commits only changed
  `app/index.html` and `app/driver/index.html` (rider/driver apps). Every quote-page publish since then (v14 Book it,
  Pages Actions recovery) re-uploaded a root `index.html` copied from that original file. Stale copies that still
  have it: `/workspace/pcs-ride-estimate/`, `/workspace/pcs-app-starter/`, `/workspace/pcs-publish-v24/`,
  `/workspace/pcs-publish-actions-fix/`. **Never build the root page from those folders.** Build from this repo's root.
- **Addresses:** From, To, and stops each have Address line 1 (suggestions), Line 2, City, State, ZIP.
  Suggestions: built-in airports first (IAH, HOU, EFD, CXO, DWH, ACT, CLL, GRK, AUS, SAT, DFW, DAL), then Google Places
  if the live Maps key allows it (new Places API, then legacy), else free OSM search (Photon) biased to the nearest
  results (current location → From pin → service area). **📍 Use current location** on From.
- **Layout:** From, To, then **+ Add a stop** (0–5 stops; no empty stop rows until tapped; Remove on each).
- **Rates are automatic:** trip-type airport picker, Holiday checkbox, and Short-notice checkbox are gone.
  Tier from pickup date/time (late 10 pm–5:59 am, nights/weekends/holidays, weekday day), holidays from the built-in list,
  +25% when pickup is under 24 h away. Airport base auto-detected: From is an airport → pick-up base; To or a stop is an
  airport → drop-off base. Hotels/"Airport Blvd" streets and "Hobby Lobby" don't count. Hourly / van stay call-for-quote
  in a "Service" menu.
- **Miles:** billed miles always round **up** to the next whole mile (10.01 → 11). Route via Google Directions when
  allowed, else OSRM (map shows the OSRM line on the Google map when Maps JS loads). Computed miles fill the miles box;
  the manual box shows only if the lookup fails.
- Book it (Houston calendar `app/busy.json`, Waco pending, Square 25% deposit) unchanged except holiday is now automatic.
- No FlightAware. Airline / flight number fields still appear when an airport is detected.
- Follow-up (not in this package): rider app `app/app.js` still has a "Sample map · Willis" map caption.
