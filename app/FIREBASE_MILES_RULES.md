# Firebase path for daily driver mileage

Daily odometer + GPS miles are stored under:

`/rides/DRVRMILZ/{driverId}/{YYYY-MM-DD}`

`DRVRMILZ` is an 8-character hub that matches the existing ride-code alphabet
(`A–Z` without `I`/`O`, plus `2–9`). The name `DRVMILES` contains **I** and would
be denied by the current `$code.matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)` rule.

## Record shape

```json
{
  "startOdometer": 12345.6,
  "gpsMiles": 42.3,
  "startedAt": 0,
  "lastUpdate": 0,
  "endOdometer": 12390.1
}
```

`driverId` is the sanitized email (same style as presence ids under `/rides/AVLBLDRV/drivers/{id}`).
Dates are America/Chicago calendar days (`YYYY-MM-DD`).

## If writes are denied

If `PUT/GET /rides/DRVRMILZ.json` returns 401/403, keep the existing `/rides/{code}` rules and confirm `DRVRMILZ` is allowed as an 8-char code (it should be). No new root path is required.

The driver app also keeps a local copy in `localStorage` (`pcs-driver-miles-{driverId}`) so the day still works offline; Firebase sync catches up when rules allow.

## Safari / iPhone note

iPhone Safari only runs `watchPosition` while the driver page is open in the foreground. Background or locked-screen miles are not counted.
