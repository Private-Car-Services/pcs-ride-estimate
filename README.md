# Private Car Services — Ride Fare Estimator

Static webpage that estimates private car fares for Houston & Waco, TX.
**Estimate only** — not a booking. Customers still call or use the site request form to confirm.

After an estimate, the page shows the current website-booking promotion: book on the website by Nov 30 for 10% off (pay in full, no cancellation within 24 hours, and at least 48 hours’ notice; rides through Dec 31). The promotion is a separate booking CTA and does not change the regular rate calculations.

Public site: [ptstaxiservices.com](https://www.ptstaxiservices.com)  
Phone: **936-261-7878** · Email: **mwragge@privatetaxiservices.net**

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure |
| `styles.css` | Layout & branding |
| `app.js` | Rate logic, Maps / manual miles, UI |
| `config.js` | Google Maps API key placeholder |
| `README.md` | This file |

## Open locally

From this folder:

```bash
# Option A — open the file
open index.html          # macOS
xdg-open index.html      # Linux

# Option B — simple local server (recommended if using Maps)
python3 -m http.server 8080
# then visit http://localhost:8080
```

Without an API key, **Get estimate** looks up driving miles from the street, city, and state (Photon geocoding and OSRM). If that lookup fails, enter **driving miles** manually. The estimate still works.

## Add a Google Maps API key

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable billing (Maps has a free monthly credit).
3. Enable:
   - **Maps JavaScript API**
   - **Places API**
   - **Directions API** (used for route + miles)
4. Create an API key → restrict by **HTTP referrer**:
   - `https://YOURUSER.github.io/*`
   - `http://localhost:8080/*` (for local testing)
5. Edit `config.js`:

```js
window.PCS_GOOGLE_MAPS_API_KEY = 'YOUR_KEY_HERE';
```

Do **not** commit an unrestricted key. Prefer referrer restrictions.

With a key, pickup/drop-off get Places autocomplete and driving miles from Directions. Manual miles remain as a fallback.

## Deploy on GitHub Pages

1. Create a public GitHub repo (e.g. `pcs-ride-estimate`).
2. Push these files to the `main` branch (repo root or `/docs`).
3. **Settings → Pages → Build from branch** → `main` / root (or `/docs`).
4. Site URL will be like: `https://YOURUSER.github.io/pcs-ride-estimate/`
5. Put that URL (and `/*`) in the API key referrer restrictions.
6. On [ptstaxiservices.com](https://www.ptstaxiservices.com), add a button/link: **Get an estimate** → your Pages URL.

## Rate rules encoded

- Base covers **2 passengers**; each additional passenger **+$5**; each extra stop **+$11**.
- Less than **24 hours’ notice** → **+25%** on the subtotal.
- **Local:** $11 + per-mile by tier.
- **Airport drop-off / pick-up:** airport base for the tier + same per-mile.
- **Tiers:**
  - Late (10:00 pm–5:59 am): $1.43/mi · drop $30 · pick $50
  - Weekend / holiday / evening 6:00–9:59 pm (and weekend daytime): $1.38/mi · drop $20 · pick $30
  - Weekday daytime Mon–Fri 6:00 am–5:59 pm: $1.10/mi · drop $15.50 · pick $25
- One-way **> 75 miles:** note that a return fee may apply (call to confirm; no invented amount).
- **Hourly** and **11-passenger van:** “Call for quote” only.

## Disclaimer (shown on page)

Estimate only — not a confirmed fare. Final price may change with traffic, waits, route, stops, vehicle, and timing. Book by phone or the website request form. Deposit via Square may be required after confirmation.

## Next steps for Matthew

1. Create Google Cloud Maps key (restricted).
2. Paste into `config.js`.
3. Push to GitHub Pages.
4. Add **Get an estimate** link on ZenBusiness → this URL.
5. Later: Square deposit after fare is confirmed.
