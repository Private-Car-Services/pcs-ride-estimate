# PCS deploy notes (Harry review fixes) — for Amanda / Matthew

## Do not publish secrets
- Never commit `god/god-auth.js`, `config.js`, or `.env*`.
- Never put a plaintext God password in the repo.

## 1) God mode password hash
1. Copy `god/god-auth.js.example` → `god/god-auth.js` on the publish machine (already done if Amanda set it).
2. Set `window.PCS_GOD_PASSWORD_HASH` to the **SHA-256 hex** of the God password (lowercase hex, 64 chars).
3. `god/index.html` loads `god-auth.js` **before** `god.js`.
4. Login fails closed if the hash is missing or wrong.
5. Session uses `sessionStorage` (clears when the browser tab/session ends). Sign out works.

Generate a hash locally (example; do not commit the password):

```bash
printf '%s' 'YOUR_PASSWORD' | sha256sum
```

## 2) Firebase Realtime Database rules
1. Open Firebase Console → Realtime Database → Rules.
2. Paste contents of `database.rules.json` (alphabet-gated `/rides/{8-char}`).
3. **Important:** True owner-only approval and private PIN fields require **Firebase Auth**. Until Auth is live, treat the open REST DB as semi-public; client mitigations are in place (no driver self-approve writes of `approvalStatus: approved`, bookings start as `pending_owner`, accept uses ETag race lock).
4. See `database.rules.HARDENED.example.json` for the Auth-era target rules (do not paste until Auth works).
5. After rules change, confirm hubs still work: `AVLBLDRV`, `REQUESTS`, `DRVRCMMS`, **`DRVRMLES`** (mileage; replaces broken `DRVRMILZ` which contained letter **I**), `DRVRHSTY`.

## 3) Mileage hub rename
- Old (broken): `DRVRMILZ` (contains **I** → 401 under alphabet rules).
- New: `DRVRMLES` (valid 8-char: no I/O).
- Path: `/rides/DRVRMLES/{driverId}/{YYYY-MM-DD}`.
- God mode and driver app both use `DRVRMLES`. Existing `DRVRMILZ` data (if any) will not migrate automatically.

## 4) Booking alerts / owner confirm
- New rides save as `status: pending_owner` and appear on the REQUESTS hub with that status.
- Drivers only see `status: requested` after God mode **Approve booking**.
- God mode: pending banner, optional browser Notification, Approve / Deny buttons.
- Optional webhook: set `PCS_BOOKING_WEBHOOK` in `app/sync-config.js` (or `window.PCS_SYNC.bookingWebhook`). POSTed JSON on new booking when set.
- Manual ping buttons use `mailto:` / `sms:` deep links (business line). Real SMS needs Zapier/webhook filled in.
- Deny sets `status: denied`; rider app shows denied in-app (no reliance on `/refusals` email).

## 5) Google Maps API key (finding #13)
- Old key appeared in git history commit `b886af0`. **Matthew must revoke that key** in Google Cloud Console.
- Current live key (if any) must be **HTTP referrer–restricted** to:
  - `https://private-car-services.github.io/*`
  - `https://ptstaxiservices.com/*`
  - `https://www.ptstaxiservices.com/*` (if used)
- Keep `config.js` gitignored; do not commit unrestricted keys.

## 6) Test payment skip
- `PCS_TEST_SKIP_PAY` defaults **off**. "Skip for testing" is hidden unless localStorage `PCS_TEST_SKIP_PAY=true` (or God enables it). Do not leave it on for real riders.

## 7) Start PIN
- Test PIN `0001` removed.
- Firebase ride records store `pinHash` (SHA-256), not plaintext PIN. Rider still sees PIN on their device; tell the driver verbally / on screen.

## 8) Cache bust
- After publish, bump `?v=` on changed JS/CSS in `app/index.html`, `app/driver/index.html`, `god/index.html` (this build uses v22 / app.js?v=36).

## Publish path
Amanda publishes via the established browser upload path. Do not push secrets. CloudAgent GitHub SCM may be disconnected — local checkout is source of truth until upload.
