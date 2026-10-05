# CHANGELOG — Harry review fixes (Oct 5, 2026)

Codebase: `/workspace/pcs-ride-estimate-git` (local checkout). **Not published/pushed by this agent** — Amanda publishes via the browser upload path. Cache bust: `app.js?v=36`, CSS/`god.js` `?v=22`, Form still labeled v21 in signup links (profile form unchanged).

Findings source: `/workspace/pts-app-review/FINDINGS.md` @ live commit ae32c98.

---

## Critical

### #1 God mode accepts any password
**Fixed.** `god/index.html` loads `god-auth.js` before `god.js`. Login SHA-256–hashes the typed password and compares to `window.PCS_GOD_PASSWORD_HASH` (fail closed if missing/invalid). Session uses `sessionStorage` (`authOk`); logout clears it; boot clears old insecure `localStorage` sessions. Plaintext password is never in the repo. See `god-auth.js.example` + `DEPLOY-NOTES.md`.

### #2 Firebase rules open / self-approve
**Mitigated + documented (Auth still required for true lock-down).**
- Added `database.rules.json` (alphabet-gated `/rides/{8-char}`) and `database.rules.HARDENED.example.json` (Auth-era owner-only approval).
- Driver client no longer PUTs a full row that could flip `approvalStatus` on an existing record — new signups create `pending` only; updates PATCH profile fields without approval/active/commission.
- **Remaining gap:** without Firebase Auth, anyone who knows paths can still PATCH the REST DB. Matthew must paste rules and plan Auth. Documented in `DEPLOY-NOTES.md`.

### #3 Double accept race
**Fixed.** `acceptSelectedOpenRide` uses Firebase REST ETag (`X-Firebase-ETag` + `if-match`) via `getRideWithEtag` / `patchRideIfMatch`. Second writer gets clear “already taken” messaging; open index entry removed only after a winning accept.

### #4 PIN 0001 + plaintext PIN in ride
**Fixed.** Removed always-working `0001` and its UI copy. Rides store `pinHash` (SHA-256 of `pin|code`) remotely; plaintext PIN stays on the rider device for display/verbal share. Driver verifies by hashing the entered PIN. **Limitation:** REST cannot field-restrict `pinHash` without Auth — hash is not reversible but is still world-readable under current rules.

### #5 No booking alert / owner confirm
**Fixed (client-side).**
- New bookings save as `status: pending_owner` and appear on REQUESTS with that status (drivers only list `requested`).
- God mode: pending banner, Approve / Deny booking, optional browser `Notification`, mailto/sms reminder deep links.
- Optional `PCS_SYNC.bookingWebhook` POST on new booking (`app/sync-config.js`).
- Rider waiting UI shows “Waiting for confirmation” / denied in-app. Real SMS still needs Zapier/webhook filled in.

---

## Should-fix

### #6 Airport base fee missing in rider app
**Fixed — rates taken from the estimator (not missing).**

Source of truth (estimator `app.js` `RATES` + README “Rate rules encoded”):

| Tier | Per-mile | Airport drop-off | Airport pick-up |
|------|----------|------------------|-----------------|
| Weekday daytime | $1.10 | **$15.50** | **$25** |
| Nights / weekends / holidays / evening 6–9:59 pm | $1.38 | **$20** | **$30** |
| Late 10 pm–5:59 am | $1.43 | **$30** | **$50** |
| Local (non-airport) base | — | **$11** (includes 2 pax) | |

Rider `app/app.js` now uses the same bases (in cents: 1550/2500, 2000/3000, 3000/5000). Trip type: Auto (address detect for IAH/HOU/Hobby/terminal streets/etc.), or explicit Local / Airport drop-off / Airport pick-up (estimator-style). Money card shows the base line item.

**Verified against Harry’s IAH Sat 6:30 AM case:** ~33 billed mi + weekend pick base + 25% short notice → **$76.51 local vs $102.22 airport pick** (matches FINDINGS).

No rate gap for Amanda to chase unless Matthew changes published website rates later.

### #7 Hours / 48h weekend / busy.json / double-book
**Fixed.** Scheduled rides: Mon–Fri 8:00–18:00 America/Chicago; weekends require ≥48h notice. ASAP any hour OK. `busy.json` failure **fails closed** (error, no silent book). Clash check against REQUESTS summaries (including `pending_owner`).

### #8 Time zone (under-24h + busy)
**Fixed.** `chicagoWallToMs` / `chicagoWeekday` used for short-notice, busy windows, and schedule validation — not device local TZ.

### #9 Silent Firebase save failure
**Fixed.** Failed `publishRide` returns rider to home with a clear error; no fake “waiting”.

### #10 Accounts only in localStorage
**Partial.** Best-effort profile mirror to `/rides/USRACCTS/{id}` (name/phone/email/role, no password). Login still validates against on-device `passwordHash`. **Remaining gap:** true multi-device Auth not implemented (needs Firebase Auth).

### #11 Skip for testing + cancel fee honesty
**Fixed.** `PCS_TEST_SKIP_PAY` defaults **off**; Skip button hidden unless explicitly enabled. Cancel copy no longer claims a live card charge.

### #12 DRVRMILZ mileage 401
**Fixed.** Hub renamed to **`DRVRMLES`** (no letter I) in rider/driver app + God mode. Docs updated (`FIREBASE_MILES_RULES.md`, `DEPLOY-NOTES.md`). Old `DRVRMILZ` data (if any) not migrated.

### #13 Old Maps key in git history
**Documented.** `DEPLOY-NOTES.md` instructs Matthew to revoke key from commit `b886af0` and referrer-restrict the current key to `private-car-services.github.io` and `ptstaxiservices.com`. `config.js` remains gitignored; no new unrestricted keys added.

---

## Minor (done if low-risk)

- Phone: require valid 10-digit US number on request.
- Copy: removed false “Nothing is sent” / softened preview sheet.
- Stale ASAP: open ASAP requests older than ~20 minutes dropped from the driver board.
- Passengers/luggage/flight fields: **not added** on rider form (estimator has flight fields; rider still defaults 2 pax / 0 stops). Low-risk skip — Amanda can ask if Matthew wants them on `/app/`.

---

## Manual steps remaining (Matthew / Amanda)

1. Publish this tree via Amanda’s upload path (do **not** commit `god/god-auth.js` or `config.js`).
2. Confirm `god-auth.js` is present on the published God host with the real hash.
3. Paste `database.rules.json` into Firebase Console; plan Auth + hardened example later.
4. Revoke Maps key from `b886af0`; restrict live key referrers.
5. Optionally set `bookingWebhook` in `sync-config.js` for SMS/Zapier alerts.
6. Harry retests Critical #1–5 and Should #6–13 before telling Matthew.
