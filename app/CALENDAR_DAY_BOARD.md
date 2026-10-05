# PCS calendar day board (God) — hub + sync

## Hub
`/rides/PCSCALND/{eventId}`

Example row:
```json
{
  "id": "googleEventId",
  "title": "PCS – John Smith",
  "rider": "John Smith",
  "pickup": "123 Main St, Conroe, TX",
  "dropoff": "IAH Terminal C",
  "start": "2026-10-06T09:15:00-05:00",
  "end": "2026-10-06T10:15:00-05:00",
  "description": "Drop-off: IAH Terminal C",
  "status": "open",
  "assignedDriverId": "",
  "assignedDriverName": "",
  "code": "",
  "fareBeforeTax": null,
  "commissionCents": null
}
```

## Calendar notation
Titles **must start with PCS** (case-insensitive). Pickup = Location. Drop-off = `Drop-off:` or `To:` line in description/notes.

## Sync
God / driver apps read the Firebase hub (not Google Calendar from the browser). A routine or Zapier/Apps Script must upsert PCS events into this hub and keep `busy.json` for Book it.
