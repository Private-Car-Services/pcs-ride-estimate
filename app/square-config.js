/*
  Square card-on-file settings for the rider app (public values only — NO access tokens here).
  Leave these empty until all three are ready. While any is empty, riders see the interim
  "we'll text you a secure payment link" step and the app never opens the booking website.

  applicationId : Square Developer Dashboard -> your app -> Credentials -> Application ID (sq0idp-...)
  locationId    : Square Developer Dashboard -> Locations (the business location ID, e.g. L077...)
  cardOnFileUrl : HTTPS URL of the small server function that saves the card with Square
                  (see app/SQUARE_PAYMENT_NOTES.md and app/square-card-worker.example.js)
  environment   : "production" (real cards) or "sandbox" (Square test cards)
*/
window.PCS_SQUARE = {
  applicationId: "",
  locationId: "",
  cardOnFileUrl: "",
  environment: "production"
};
