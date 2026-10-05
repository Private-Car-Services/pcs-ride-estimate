# Square card hold / charge-after-ride

## Product rules (Matthew)
1. Customer adds a card **before** the ride.
2. Customer is **not charged until after** drop-off (so they can tip).
3. Cancel **before pickup**: charge **25% of the estimate or $10**, whichever is more.
4. After the driver enters the PIN and the ride **starts**, the rider **cannot cancel**.

## What this starter does
- Shows clear UI copy on the request and waiting screens.
- Opens the existing public Square appointments/book link for card setup (no API secret in the repo).
- Shows a cancel warning with the calculated fee; confirm cancels the ride locally and marks Firebase `cancelled` with `cancelFeeCents` when sync is on.
- Does **not** authorize or capture a real Square payment (that needs a server).

## What a real hold needs
A secure backend (Cloud Function, Cloud Run, etc.) that:
1. Uses the Square **Orders / Payments** APIs with a **secret access token** stored only on the server.
2. Creates a payment with `autocomplete: false` (auth/hold) when the ride is requested.
3. Captures (or tips + captures) after `completed`.
4. Captures the cancel fee if status becomes `cancelled` before start.
5. Voids the auth if you choose not to charge.

Do **not** put Square secret keys in `config.js`, GitHub Pages, or this repo.


## Testing (no live Square charge yet)
- Payment UI is shown on request / waiting / completed screens.
- With `localStorage.PCS_TEST_SKIP_PAY` unset or `true` (default), **Skip for testing** appears and payment is not required.
- Set `PCS_TEST_SKIP_PAY=false` later to hide the skip when real holds go live.
- Driver start PIN: ride PIN still shown to rider; **0001** is always accepted as an alternate test start PIN.
