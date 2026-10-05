# Firebase rules needed for driver open-ride map

Verified against the live database (no API key; public REST):

- `GET /rides.json` → **401 Permission denied** (cannot list rides)
- `GET /rides/{8-char-code}.json` → **200** when the ride exists
- `GET /open.json` → **401**
- `PUT /open/{code}.json` → **401**
- `PUT /refusals/{id}.json` → **401**

The client already writes and reads these paths. Until rules allow them, the driver map shows an empty board with a plain message that `/open` cannot load.

## Exact rules to add (keep existing `/rides/{code}` rules)

```json
{
  "rules": {
    "rides": {
      "$code": {
        ".read": "$code.matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)",
        ".write": "$code.matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)"
      }
    },
    "open": {
      ".read": true,
      "$code": {
        ".write": "$code.matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)"
      }
    },
    "refusals": {
      ".read": false,
      "$id": {
        ".write": "!data.exists() && newData.hasChildren(['deniedAt','notifyEmail','needsEmail','rideCode','driverName','customerName'])"
      }
    }
  }
}
```

### Paths the app uses

| Path | Who writes | Who reads | Purpose |
|------|------------|-----------|---------|
| `/rides/{CODE}` | Rider (create), driver (accept/location) | Rider + driver by code | Full ride |
| `/open/{CODE}` | Rider on submit / coord update | Driver board (`GET /open.json`) | Open requested pickups for the map |
| `/refusals/{id}` | Driver on **Deny** | Server only (rules: read false) | Refusal record for email to mwragge@privatetaxiservices.net |

### Email

The static GitHub page **cannot send email**. On Deny it PUTs a refusal object with `needsEmail: true` and `notifyEmail: "mwragge@privatetaxiservices.net"`, including driver name, customer name/phone, pickup, drop-off, date/time, and fare fields when known. A later Cloud Function / server job must email Matthew from that path. Do not rely on mailto or the driver to send mail.


## Driver online presence (`/drivers`)

Verified: `PUT /drivers/{id}.json` and `GET /drivers.json` currently return **401**.

The driver app heartbeats while signed in (about every 20s and on GPS updates):

`PUT /drivers/{sanitizedEmail}.json`
`{ "online": true, "at": <ms>, "name", "phone", "lat", "lng" }`

On logout / page hide: `DELETE /drivers/{id}.json`

The rider app lists `GET /drivers.json` and treats any driver with `at` within the last 2 minutes as available, so waiting riders do **not** see "No one is available" when a driver is online — even before Accept.

Add under rules (alongside `/open` and `/refusals`):

```json
"drivers": {
  ".read": true,
  "$id": {
    ".write": true
  }
}
```


## Working without /open or /drivers (current live rules)

Verified 2026-10-03: `GET/PUT /open` and `/drivers` are still denied, but nested writes under an existing-style ride code work:

- Presence hub: `PUT/GET /rides/AVLBLDRV/drivers/{id}.json`
- Open-requests hub: `PUT/GET /rides/REQUESTS/{code}.json`

The app now uses those hubs, so driver availability and the open-ride map work with the current `/rides/{8-char}` rules. No new root paths required for these two features.

## Daily driver mileage (`/rides/DRVRMILZ`)

See `FIREBASE_MILES_RULES.md`. Hub `DRVRMILZ` (not `DRVMILES` — that contains **I**) stores per-driver per-day start odometer + GPS miles under the existing `/rides/{8-char}` rules. No new root path required.
