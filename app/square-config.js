/*
  Square settings for the quote page and the rider app (public values only. NO access tokens here).

  LIVE CUSTOMERS: Square stays OFF. No card form appears, and customers see
  "Booking received, we'll send your secure payment link" (quote page) or the card-link step (rider app).

  TEST MODE (Matthew only): open any page with ?squaretest=1 in the address, for example
    https://private-car-services.github.io/pcs-ride-estimate/?squaretest=1
  That turns on the Square SANDBOX for that browser tab only (no real money moves) and shows a gold
  TEST MODE banner. ?squaretest=0 or closing the tab turns it off again.

  Sandbox card: 4111 1111 1111 1111 · any future expiry · CVV 111 · ZIP 77042.

  Payments go through the pcs-pay Cloudflare Worker, which keeps the Square access token as a secret.
  To go live later: set Production IDs + a production Worker here and remove the test-mode gate (separate step).
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

  window.PCS_SQUARE = on
    ? {
        applicationId: "sandbox-sq0idb-yE-VuoAn8z-GvC-85yL7DQ",
        locationId: "LRZMXRC1JN5VQ",
        cardOnFileUrl: WORKER + "/card",
        paymentUrl: WORKER + "/charge",
        environment: "sandbox",
        testMode: true
      }
    : {
        applicationId: "",
        locationId: "",
        cardOnFileUrl: "",
        paymentUrl: "",
        environment: "production",
        testMode: false
      };

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
