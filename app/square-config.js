/*
  Square settings for the quote page and the rider app (PUBLIC values only. NO access tokens here).
  v58 (Oct 6, 2026): PRODUCTION — real cards, real money.

  - Rider app: the card is SAVED at booking (Square Customer + Card on file, no charge). After drop-off the rider
    picks a tip and pays the driver's final fare + tip. v59: cancel fee (cancelPct % of the estimate, cancelMinCents
    minimum) ONLY if the assigned driver is within cancelRadiusMiles of the pickup when the rider cancels; otherwise
    free. The pcs-pay Worker re-reads the ride + driver location from Firebase and decides every amount.
  - Quote page Book it: 25% deposit (or pay in full) charged at booking.
  - Payments go through the pcs-pay Cloudflare Worker; the Square access token is a Worker secret.

  TEST MODE (Matthew only, no real money): add ?squaretest=1 to any page, e.g.
    https://private-car-services.github.io/pcs-ride-estimate/app/?squaretest=1
  That switches THIS TAB to the Square SANDBOX (gold TEST MODE bar). Card 4111 1111 1111 1111, any future date,
  CVV 111, ZIP 77042. ?squaretest=0 or closing the tab goes back to production.
*/
(function () {
  "use strict";
  var KEY = "pcs-squaretest";
  var WORKER = "https://pcs-pay.pcsrides.workers.dev";
  var on = false;
  try {
    var q = String(window.location.search || "");
    if (/[?&]squaretest=1(&|#|$)/.test(q)) window.sessionStorage.setItem(KEY, "1");
    else if (/[?&]squaretest=0(&|#|$)/.test(q)) window.sessionStorage.removeItem(KEY);
    on = window.sessionStorage.getItem(KEY) === "1";
  } catch (err) {
    on = false;
  }

  var PRODUCTION = {
    applicationId: "sq0idp-W9ccaO520ypI0soN9RIlyA",
    locationId: "L077DQHSNJAG6",
    environment: "production",
    sdkUrl: "https://web.squarecdn.com/v1/square.js",
    testMode: false
  };
  var SANDBOX = {
    applicationId: "sandbox-sq0idb-yE-VuoAn8z-GvC-85yL7DQ",
    locationId: "LRZMXRC1JN5VQ",
    environment: "sandbox",
    sdkUrl: "https://sandbox.web.squarecdn.com/v1/square.js",
    testMode: true
  };

  window.PCS_SQUARE = Object.assign({}, on ? SANDBOX : PRODUCTION, {
    workerUrl: WORKER,
    cardOnFileUrl: WORKER + "/save-card",   /* rider app: save card at booking (no charge) */
    chargeUrl: WORKER + "/charge",          /* rider app: after drop-off, final fare + tip */
    cancelFeeUrl: WORKER + "/cancel-fee",   /* rider app: cancelled while the driver was within 1 mile (Worker decides) */
    depositUrl: WORKER + "/deposit",        /* quote page Book it: 25% deposit or pay in full */
    paymentUrl: "",                         /* old v48 key ("charge at booking" in the rider app). Must stay blank. */
    cancelPct: 25,
    cancelMinCents: 1000,
    cancelRadiusMiles: 1,                   /* v59: display only; the Worker enforces CANCEL_RADIUS_MILES */
    depositPct: 25
  });

  if (!on) return;

  function exitHref() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("squaretest", "0");
      return u.toString();
    } catch (err) {
      return "?squaretest=0";
    }
  }

  function addBanner() {
    if (document.getElementById("pcs-test-banner")) return;
    var b = document.createElement("div");
    b.id = "pcs-test-banner";
    b.setAttribute("role", "status");
    b.style.cssText = "position:relative;z-index:50;flex:0 0 auto;background:#c9a227;color:#0b1f3a;" +
      "font:700 14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:8px 12px;text-align:center;" +
      "box-shadow:0 2px 6px rgba(0,0,0,.25)";
    b.innerHTML = "TEST MODE: use card 4111 1111 1111 1111 " +
      "<span style=\"font-weight:500\">· any future date · CVV 111 · ZIP 77042 · Square sandbox, no real charges</span> " +
      "<a href=\"" + exitHref() + "\" style=\"color:#0b1f3a;text-decoration:underline;margin-left:6px;font-weight:600\">Exit test mode</a>";
    /* Rider app: <body> is a flex row, so the banner goes inside the .phone column (top). Quote page: top of <body>. */
    var host = document.querySelector("body > .phone") || document.body;
    host.insertBefore(b, host.firstChild);
  }

  if (document.body) addBanner();
  else document.addEventListener("DOMContentLoaded", addBanner);
})();
