# Firebase path for God mode driver roster

God mode stores hired drivers, commission %, and active/fired under:

`/rides/DRVRCMMS/{driverId}`

`DRVRCMMS` is an 8-character hub that matches the existing ride-code alphabet
(`A–Z` without `I`/`O`, plus `2–9`). The suggested name `DRVRCOMM` contains **O**
and would be denied by the current `$code.matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)` rule.

## Record shape

```json
{
  "name": "Anson",
  "phone": "254-498-1335",
  "email": "driver@example.com",
  "commissionPct": 70,
  "active": true,
  "hiredAt": 0,
  "updatedAt": 0,
  "firedAt": 0,
  "rehiredAt": 0
}
```

`driverId` is the sanitized email (same style as presence ids under `/rides/AVLBLDRV/drivers/{id}`).

## If writes are denied

If `PUT/GET /rides/DRVRCMMS.json` returns 401/403, keep the existing `/rides/{code}` rules and confirm `DRVRCMMS` is allowed as an 8-char code (it should be). No new root path is required.

Optional explicit rule (only if you broaden hubs later):

```json
"DRVRCMMS": {
  ".read": true,
  "$driverId": {
    ".write": true
  }
}
```

## Enforcement note

**Fire** sets `active: false` and deletes `/rides/AVLBLDRV/drivers/{id}` so they drop off the live map immediately. The rider/driver apps still need to honor `active: false` on this roster before accepting new heartbeats/rides for full lockout after the driver opens the app again.
