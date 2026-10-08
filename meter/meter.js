/* PCS v70: rider live meter (public, read-only, no login). Opened from the driver's "Watch your meter" QR:
   /meter/?t=<sealed token>. Polls the pcs-pay Worker /meter/live, which answers ONLY meter numbers (mode, rates,
   miles, time, slow minutes, fare parts, tax, total, pay state). Nothing here can change the meter.
   Optional (never required): name / phone / email for the receipt and a card saved with Square's own card form
   (Square keeps the card; this page never sees the number). At the end: the fare breakdown, then Pay with the saved
   card (tip optional, confirm screen) or Square's secure payment page. */
(function () {
  "use strict";
  var WORKER = "https://pcs-pay.pcsrides.workers.dev";
  var POLL_MS = 4000;
  var TIP_CHOICES = ["0", "15", "20", "25"];
  var BUSINESS_PHONE = "936-261-7878";
  var app = document.getElementById("app");
  var m = String(window.location.search || "").match(/[?&]t=([A-Za-z0-9_-]{40,120})(?:&|#|$)/);
  var token = m ? m[1] : "";
  var S = { d: null, off: 0, err: "", phase: "", polls: 0, timer: 0, busy: "", infoMsg: "", infoErr: "", cardErr: "", cardOpen: false,
    sqCard: null, tip: "", tipCustom: "", confirm: null, payErr: "", stopped: false };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function money(c) { return "$" + ((Number(c) || 0) / 100).toFixed(2); }
  function pct(rate) { return String(Math.round(Number(rate) * 1000000) / 10000) + "%"; }
  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + String(mm).padStart(2, "0") : String(mm)) + ":" + String(sec).padStart(2, "0");
  }
  function brandName(b) {
    var k = String(b || "").toUpperCase().replace(/[^A-Z_]/g, "");
    var map = { VISA: "Visa", MASTERCARD: "Mastercard", AMERICAN_EXPRESS: "Amex", AMEX: "Amex", DISCOVER: "Discover", DISCOVER_DINERS: "Diners Club", JCB: "JCB", CHINA_UNIONPAY: "UnionPay" };
    return map[k] || (k ? k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, " ") : "Card");
  }
  function cardWords(c) { return c && c.last4 ? brandName(c.brand) + " ending " + c.last4 : "your saved card"; }
  function modeWord(key) { return key === "late" ? "LATE NIGHT" : key === "night" ? "NIGHT · WEEKEND · HOLIDAY" : "DAY"; }
  function now() { return Date.now() + S.off; }
  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { var el = $(id); if (el && el.textContent !== txt) el.textContent = txt; }

  function post(path, body) {
    return fetch(WORKER + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || data.ok === false) {
          var e = new Error((data && data.error) || "Server error " + res.status);
          e.status = res.status;
          e.data = data;
          throw e;
        }
        return data;
      });
    }, function () { var e = new Error("No connection. Check your signal."); e.network = true; throw e; });
  }

  /* ---------- polling ---------- */
  function schedule(ms) {
    if (S.timer) clearTimeout(S.timer);
    S.timer = S.stopped ? 0 : setTimeout(poll, ms || POLL_MS);
  }
  function poll() {
    S.timer = 0;
    if (document.visibilityState === "hidden") { schedule(POLL_MS); return; }
    S.polls += 1;
    var d0 = S.d;
    var check = !!(d0 && d0.status === "ended" && d0.pay && d0.pay.linkOpen && S.polls % 3 === 0);
    post("/meter/live", { t: token, check: check }).then(function (d) {
      S.err = "";
      S.off = (Number(d.now) || Date.now()) - Date.now();
      S.d = d;
      if (d.pay && d.pay.paid) S.stopped = true;
      draw();
      schedule(POLL_MS);
    }).catch(function (e) {
      if (e.status === 404 || e.status === 410) {
        S.stopped = true;
        S.d = null;
        S.err = e.message;
        draw(true);
        return;
      }
      S.err = e.network ? "No signal right now. The meter keeps running in the car; this page catches up when you're back online." : e.message;
      var el = $("rm-net");
      if (el) el.textContent = S.err;
      else if (!S.d) draw(true);
      schedule(POLL_MS * 2);
    });
  }

  /* ---------- screens ---------- */
  function phaseOf(d) {
    if (!d) return "none";
    if (d.pay && d.pay.paid) return d.pay.other ? "settled" : "paid";
    if (d.status === "running") return "run|" + (d.card && d.card.onFile ? 1 : 0);
    return "end|" + (d.card && d.card.onFile ? 1 : 0) + "|" + (d.pay && d.pay.linkOpen ? 1 : 0);
  }
  function testTag(d) { return d && d.sandbox ? '<p class="rm-test" id="rm-test">TEST MODE · Square sandbox · no real money</p>' : ""; }
  function modeHtml(d) {
    var why = d.mode.holiday || /holiday/i.test(d.mode.label) ? "holiday" : /weekend/i.test(d.mode.label) ? "weekend" : "";
    return '<p class="rm-mode rm-mode-' + esc(d.mode.key || "day") + '" id="rm-mode">' + esc(modeWord(d.mode.key)) + " RATE" + (why ? " <small>(" + why + ")</small>" : "") + "</p>";
  }
  function ratesHtml(d) {
    var r = d.rates;
    var incl = Number(r.includedMiles) || 0;
    return '<div class="card" id="rm-rates"><p class="tag">How your fare works · ' + esc(d.mode.label || d.mode.name || "") + "</p>" +
      '<div class="money-row"><span>Start' + (incl ? " (incl. " + (incl === 1 ? "first mile" : esc(String(incl)) + " mi") + ")" : "") + '</span><span id="rm-rate-start">' + money(r.startCents) + "</span></div>" +
      '<div class="money-row"><span>Each mile after that</span><span id="rm-rate-mile">' + money(r.perMileCents) + "</span></div>" +
      '<div class="money-row"><span>Stopped / slow traffic (under ' + esc(String(r.slowMph)) + ' mph)</span><span id="rm-rate-min">' + money(r.perMinCents) + "/min</span></div>" +
      (r.freeWaitSec >= 60 ? '<div class="money-row"><span>Free waiting at the start</span><span>' + Math.floor(r.freeWaitSec / 60) + " min</span></div>" : "") +
      (r.stepCents > 1 ? '<div class="money-row"><span>Fare goes up in</span><span>' + money(r.stepCents) + " steps</span></div>" : "") +
      (r.taxRate > 0 ? '<div class="money-row"><span>Tax (' + pct(r.taxRate) + ')</span><span id="rm-rate-tax">added at the end</span></div>' : "") +
      "</div>";
  }
  function formHtml(d) {
    var saved = d.card && d.card.onFile;
    return '<div class="card" id="rm-form"><p class="tag">Optional · receipt and quick pay</p>' +
      '<p class="fine">Nothing here is required. Skip it and pay at the end on Square\u2019s secure page.</p>' +
      '<label for="rm-name">Name</label><input id="rm-name" autocomplete="name" maxlength="80">' +
      '<label for="rm-phone">Phone</label><input id="rm-phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30">' +
      '<label for="rm-email">Email (for your receipt)</label><input id="rm-email" type="email" autocomplete="email" inputmode="email" maxlength="160">' +
      '<p class="fine rm-ok" id="rm-info-msg">' + esc(S.infoMsg || (d.contactSaved ? "\u2713 Your info is saved for the receipt." : "")) + "</p>" +
      '<p class="error" id="rm-info-err" role="alert">' + esc(S.infoErr) + "</p>" +
      '<button class="btn secondary" type="button" id="rm-save-info">Save my info</button>' +
      '<hr style="border:0;border-top:1px solid rgba(212,177,90,.3);margin:12px 0">' +
      (saved
        ? '<p class="lede rm-ok" id="rm-card-saved">\u2713 Card saved: ' + esc(cardWords(d.card)) + ". At the end you\u2019ll see the fare and a Pay button right here.</p>"
        : (S.cardOpen
          ? '<p class="lede">Save a card to pay from this page at the end. <strong>Nothing is charged now.</strong></p>' +
            '<p class="fine">Square keeps your card; this page never sees the number.' + (d.sandbox ? " Test card 4111 1111 1111 1111 · CVV 111 · ZIP 77042." : "") + "</p>" +
            '<div class="rm-card-box" id="rm-card"><p class="fine" style="color:#0b1f3a">Loading the secure card form…</p></div>' +
            '<p class="error" id="rm-card-err" role="alert">' + esc(S.cardErr) + "</p>" +
            '<button class="btn" type="button" id="rm-save-card" disabled>Save card</button>'
          : '<p class="fine">Want to pay from your phone at the end? Save a card now (nothing is charged now).</p>' +
            '<button class="btn" type="button" id="rm-add-card">Add a card</button>')) +
      "</div>";
  }
  function runningHtml(d) {
    return testTag(d) + '<p class="tag">Your meter · live</p>' + modeHtml(d) +
      '<p class="rm-fare" id="rm-fare" aria-live="off">' + money(d.live.fareCents) + "</p>" +
      '<p class="rm-sub">Meter' + (d.rates.taxRate > 0 ? " · tax " + pct(d.rates.taxRate) + " added at the end" : "") + "</p>" +
      '<div class="rm-grid"><div><b id="rm-miles">' + Number(d.live.miles || 0).toFixed(2) + "</b><span>Miles</span></div>" +
      '<div><b id="rm-time">0:00</b><span>Time</span></div>' +
      '<div><b id="rm-wait">' + (d.live.waitMin || 0) + "</b><span>Slow min</span></div></div>" +
      '<p class="rm-free" id="rm-free"></p>' +
      '<p class="rm-updated" id="rm-updated"></p>' +
      '<p class="error" id="rm-net" role="status"></p>' +
      ratesHtml(d) + formHtml(d);
  }
  function breakdownHtml(d) {
    var f = d.final || {};
    var r = d.rates;
    var incl = Number(r.includedMiles) || 0;
    var parts = (f.base || 0) + (f.mileCents || 0) + (f.waitCents || 0);
    var diff = (f.sub || 0) - parts;
    var minApplied = diff > 0 && r.minCents > 0 && f.sub === r.minCents && diff >= (r.stepCents || 1);
    return '<div class="card" id="rm-breakdown">' +
      '<div class="money-row" id="rm-start-row"><span>Start (incl. ' + (incl === 1 ? "first mile" : esc(String(incl)) + " mi") + ")</span><span>" + money(f.base) + "</span></div>" +
      '<div class="money-row" id="rm-miles-row"><span>Miles after first ' + esc(Number(f.afterMiles || 0).toFixed(2)) + " × " + money(r.perMileCents) + "</span><span>" + money(f.mileCents) + "</span></div>" +
      '<div class="money-row" id="rm-wait-row"><span>Stopped / slow ' + esc(String(f.waitMin || 0)) + " min × " + money(r.perMinCents) + "</span><span>" + money(f.waitCents) + "</span></div>" +
      (d.live && d.live.freeUsed ? '<div class="money-row"><span>Free waiting at start ' + esc(String(d.live.freeUsed)) + " min</span><span>" + money(0) + "</span></div>" : "") +
      (diff > 0 ? '<div class="money-row"><span>' + (minApplied ? "Minimum fare " + money(r.minCents) + " applied" : "Round up to " + money(r.stepCents) + " step") + "</span><span>" + money(diff) + "</span></div>" : "") +
      (f.tax ? '<div class="money-row"><span>Fare</span><span id="rm-fare-sub">' + money(f.sub) + "</span></div>" +
        '<div class="money-row" id="rm-tax-row"><span>Tax (' + pct(r.taxRate) + ")</span><span>" + money(f.tax) + "</span></div>" : "") +
      '<div class="total-row"><span>Total</span><span id="rm-total">' + money(f.total) + "</span></div>" +
      '<p class="fine">' + esc(d.mode.label || "") + " · " + esc(Number(f.miles || 0).toFixed(2)) + " mi · " + esc(String(f.minutes || 0)) + " min</p></div>";
  }
  function tipCents(d) {
    var base = (d.final && d.final.sub) || 0;
    if (S.tip === "custom") {
      var raw = String(S.tipCustom || "").trim();
      if (raw.indexOf("-") !== -1) return 0;
      var v = parseFloat(raw.replace(/[^0-9.]/g, ""));
      return isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
    }
    var p = Number(S.tip);
    return isFinite(p) && p > 0 ? Math.round(base * p / 100) : 0;
  }
  function payHtml(d) {
    var f = d.final || {};
    if (d.card && d.card.onFile) {
      var tip = tipCents(d), total = (f.total || 0) + tip;
      var base = f.sub || 0;
      var chips = TIP_CHOICES.map(function (c) {
        var on = S.tip === c;
        return '<button type="button" class="btn ' + (on ? "" : "ghost ") + 'rm-tip" data-tip="' + c + '" aria-pressed="' + on + '">' + (on ? "\u2713 " : "") +
          esc(c === "0" ? "No tip" : c + "% · " + money(Math.round(base * Number(c) / 100))) + "</button>";
      }).join("") + '<button type="button" class="btn ' + (S.tip === "custom" ? "" : "ghost ") + 'rm-tip" data-tip="custom" aria-pressed="' + (S.tip === "custom") + '">' + (S.tip === "custom" ? "\u2713 " : "") + "Other</button>";
      var c = S.confirm;
      return '<div class="card" id="rm-pay-card"><p class="tag">Pay for your ride</p>' +
        '<p class="fine">Card on file: ' + esc(cardWords(d.card)) + ". Tip is optional (100% goes to your driver).</p>" +
        '<div class="rm-tips" role="group" aria-label="Tip">' + chips + "</div>" +
        (S.tip === "custom" ? '<label for="rm-tip-custom">Tip amount</label><input id="rm-tip-custom" inputmode="decimal" placeholder="0.00" value="' + esc(S.tipCustom) + '">' : "") +
        '<p class="error" id="rm-pay-err" role="alert">' + esc(S.payErr || (d.pay && d.pay.error ? "The last try didn\u2019t go through: " + d.pay.error : "")) + "</p>" +
        (c
          ? '<div id="rm-confirm" role="alertdialog" aria-labelledby="rm-confirm-q" style="border:2px solid #f0d48a;border-radius:14px;padding:12px;margin:10px 0">' +
            '<p class="lede" id="rm-confirm-q" style="margin:0 0 4px"><strong>Charge ' + esc(money(c.total)) + " to " + esc(cardWords(d.card)) + "?</strong></p>" +
            '<p class="fine" id="rm-confirm-split" style="margin:0 0 10px">(fare ' + esc(money(c.fare)) + " + tip " + esc(money(c.tip)) + (c.tip ? "" : ", no tip") + ")</p>" +
            '<button class="btn" type="button" id="rm-confirm-yes"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? esc(S.busy) : "Confirm · charge " + esc(money(c.total))) + "</button>" +
            '<button class="btn secondary" type="button" id="rm-confirm-change" style="margin-top:8px">Change tip</button></div>'
          : '<button class="btn rm-big" type="button" id="rm-pay"' + (S.tip === "" ? " disabled" : "") + ">Pay " + esc(money(total)) + "</button>" +
            (S.tip === "" ? '<p class="fine" id="rm-pick-tip">Pick a tip option (or No tip) first.</p>' : "")) +
        '<button class="btn ghost" type="button" id="rm-paylink-alt">Pay on Square\u2019s page instead</button></div>';
    }
    return '<div class="card" id="rm-pay-card"><p class="tag">Pay for your ride</p>' +
      '<p class="error" id="rm-pay-err" role="alert">' + esc(S.payErr) + "</p>" +
      '<button class="btn rm-big" type="button" id="rm-paylink"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? esc(S.busy) : "Pay " + esc(money(f.total)) + " on Square\u2019s secure page") + "</button>" +
      '<p class="fine">Tip is optional on the next page. Apple Pay / Google Pay / card.</p></div>';
  }
  function endedHtml(d) {
    return testTag(d) + '<p class="tag">Ride ended · your fare</p>' + modeHtml(d) +
      '<p class="rm-fare" id="rm-fare">' + money(d.final && d.final.total) + "</p>" +
      '<p class="rm-sub">Total incl. tax</p>' + breakdownHtml(d) + payHtml(d) +
      '<p class="error" id="rm-net" role="status"></p>';
  }
  function paidHtml(d) {
    var p = d.pay || {};
    return testTag(d) + '<p class="tag">Ride ' + (p.other ? "settled" : "paid") + "</p>" +
      (p.other
        ? '<p class="rm-paid" id="rm-paid">Paid \u2014 thank you!</p><p class="rm-sub">Your driver marked this ride as paid.</p>'
        : '<p class="rm-paid" id="rm-paid">Paid ' + money(p.totalCents) + "</p>" +
          '<p class="rm-sub" id="rm-paid-detail">Thank you! Fare ' + money(Math.max(0, (p.totalCents || 0) - (p.tipCents || 0))) + (p.tipCents ? " + tip " + money(p.tipCents) : " · no tip") + "</p>" +
          (p.receiptUrl ? '<p style="text-align:center"><a class="btn ghost" id="rm-receipt" href="' + esc(p.receiptUrl) + '" target="_blank" rel="noopener">View receipt</a></p>' : "")) +
      (d.final ? breakdownHtml(d) : "");
  }
  function draw(force) {
    var d = S.d;
    if (!d) {
      app.innerHTML = '<div class="card" id="rm-error"><p class="tag">Your meter</p><p class="lede">' + esc(S.err || (token ? "Loading your meter…" : "This meter link isn\u2019t valid or has expired.")) + "</p>" +
        '<p class="fine">Questions? Call <a href="tel:' + BUSINESS_PHONE + '" style="color:#f0d48a">' + BUSINESS_PHONE + "</a>.</p></div>";
      S.phase = "none";
      return;
    }
    var ph = phaseOf(d);
    if (force || ph !== S.phase) {
      var keep = S.phase.indexOf("run") === 0 ? readForm() : null;
      if (S.sqCard && ph.indexOf("run|0") !== 0) { try { S.sqCard.destroy(); } catch (e) {} S.sqCard = null; }
      S.phase = ph;
      app.innerHTML = ph === "paid" || ph === "settled" ? paidHtml(d) : d.status === "running" ? runningHtml(d) : endedHtml(d);
      if (keep) writeForm(keep);
      bind();
    }
    tick();
  }
  function redrawEnded() { if (S.d && S.d.status === "ended") draw(true); }
  function readForm() { var g = function (id) { var el = $(id); return el ? el.value : ""; }; return { name: g("rm-name"), phone: g("rm-phone"), email: g("rm-email") }; }
  function writeForm(v) { ["name", "phone", "email"].forEach(function (k) { var el = $("rm-" + k); if (el && v[k]) el.value = v[k]; }); }
  function tick() {
    var d = S.d;
    if (!d) return;
    if (d.status === "running") {
      setText("rm-fare", money(d.live.fareCents));
      setText("rm-miles", Number(d.live.miles || 0).toFixed(2));
      setText("rm-wait", String(d.live.waitMin || 0));
      setText("rm-time", clock(now() - d.startedAt));
      var left = d.live.moved ? 0 : Math.ceil((Number(d.rates.freeWaitSec) || 0) - (now() - d.startedAt) / 1000);
      setText("rm-free", left > 0 ? "Free waiting " + clock(left * 1000) + " left" : "");
      var age = d.live.at ? Math.max(0, Math.round((now() - d.live.at) / 1000)) : -1;
      setText("rm-updated", age < 0 ? "Waiting for the first update from the car…" : age <= 12 ? "Live · updated just now" : age < 60 ? "Live · updated " + age + " s ago" :
        "Waiting for the driver\u2019s phone (last update " + Math.floor(age / 60) + " min ago). The meter keeps running in the car.");
      setText("rm-net", S.err || "");
    }
  }

  /* ---------- actions ---------- */
  function on(id, fn) { var el = $(id); if (el) el.addEventListener("click", fn); }
  function bind() {
    on("rm-save-info", saveInfo);
    on("rm-add-card", function () { S.cardOpen = true; draw(true); mountCard(); });
    on("rm-save-card", saveCard);
    on("rm-pay", function () {
      var d = S.d, tip = tipCents(d);
      if (S.tip === "") return;
      if (tip > Math.max((d.final && d.final.total) || 0, 5000)) { S.payErr = "That tip is over the limit. Pick a smaller tip."; redrawEnded(); return; }
      S.payErr = "";
      S.confirm = { fare: d.final.total, tip: tip, total: d.final.total + tip };
      redrawEnded();
    });
    on("rm-confirm-change", function () { S.confirm = null; redrawEnded(); });
    on("rm-confirm-yes", charge);
    on("rm-paylink", payLink);
    on("rm-paylink-alt", payLink);
    Array.prototype.forEach.call(document.querySelectorAll(".rm-tip"), function (b) {
      b.addEventListener("click", function () { S.tip = b.getAttribute("data-tip") || "0"; S.confirm = null; S.payErr = ""; redrawEnded(); });
    });
    var tc = $("rm-tip-custom");
    if (tc) tc.addEventListener("change", function () { S.tipCustom = tc.value; redrawEnded(); });
  }
  function saveInfo() {
    var v = readForm();
    S.infoErr = ""; S.infoMsg = "";
    if (!v.name.trim() && !v.phone.trim() && !v.email.trim()) { S.infoErr = "Type your name, phone or email first (all optional)."; setText("rm-info-err", S.infoErr); return; }
    var btn = $("rm-save-info");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    post("/meter/rider", { t: token, name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim() }).then(function () {
      S.infoMsg = "\u2713 Saved. Your receipt goes to " + (v.email.trim() || "your phone number if Square has it") + ".";
      if (S.d) S.d.contactSaved = true;
      setText("rm-info-msg", S.infoMsg); setText("rm-info-err", "");
      if (btn) { btn.disabled = false; btn.textContent = "Save my info"; }
    }).catch(function (e) {
      S.infoErr = e.message;
      setText("rm-info-err", S.infoErr);
      if (btn) { btn.disabled = false; btn.textContent = "Save my info"; }
    });
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("script")); };
      document.head.appendChild(s);
    });
  }
  function squareCfg() {
    try {
      if (S.d && S.d.sandbox) sessionStorage.setItem("pcs-squaretest", "1");
      else sessionStorage.removeItem("pcs-squaretest");
    } catch (e) {}
    var cfgP = window.PCS_SQUARE ? Promise.resolve() : loadScript("../app/square-config.js?v=60");
    return cfgP.then(function () {
      var c = window.PCS_SQUARE || {};
      if (!c.applicationId || !c.locationId || !!c.testMode !== !!(S.d && S.d.sandbox)) throw new Error("config");
      return c;
    });
  }
  function mountCard() {
    squareCfg().then(function (cfg) {
      return (window.Square && window.Square.payments ? Promise.resolve() : loadScript(cfg.sdkUrl)).then(function () {
        return Promise.resolve(window.Square.payments(cfg.applicationId, cfg.locationId)).then(function (p) { return p.card(); });
      });
    }).then(function (card) {
      var box = $("rm-card");
      if (!box) { try { card.destroy(); } catch (e) {} return; }
      S.sqCard = card;
      box.innerHTML = "";
      return card.attach("#rm-card").then(function () { var b = $("rm-save-card"); if (b) b.disabled = false; });
    }).catch(function () {
      S.cardErr = "The secure card form didn\u2019t load. Check your signal and try again, or pay at the end on Square\u2019s page.";
      setText("rm-card-err", S.cardErr);
    });
  }
  function saveCard() {
    var btn = $("rm-save-card");
    if (!S.sqCard || !btn) return;
    btn.disabled = true; btn.textContent = "Saving…";
    S.cardErr = ""; setText("rm-card-err", "");
    var v = readForm();
    S.sqCard.tokenize().then(function (r) {
      if (!r || r.status !== "OK" || !r.token) {
        var first = r && r.errors && r.errors[0];
        throw new Error((first && first.message) || "Check the card details and try again.");
      }
      return post("/meter/rider", { t: token, sourceId: r.token, name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim() });
    }).then(function (data) {
      if (S.d) {
        S.d.card = { onFile: true, brand: data.card && data.card.brand || "", last4: data.card && data.card.last4 || "" };
        if (data.contactSaved) S.d.contactSaved = true;
      }
      draw();
    }).catch(function (e) {
      S.cardErr = e.message;
      setText("rm-card-err", S.cardErr);
      btn.disabled = false; btn.textContent = "Save card";
    });
  }
  function charge() {
    var c = S.confirm;
    if (!c || S.busy) return;
    S.busy = "Charging…";
    S.payErr = "";
    redrawEnded();
    post("/meter/charge", { t: token, tipCents: c.tip, expectedCents: c.total }).then(function (data) {
      S.busy = "";
      S.confirm = null;
      if (S.d) {
        S.d.pay = { status: "charged", paid: true, totalCents: Number(data.totalCents) || c.total, tipCents: data.already ? Number(data.tipCents) || 0 : c.tip,
          receiptUrl: /^https:\/\//i.test(String(data.receiptUrl || "")) ? String(data.receiptUrl) : "" };
      }
      S.stopped = true;
      draw();
    }).catch(function (e) {
      S.busy = "";
      S.confirm = null;
      S.payErr = e.message + (e.status === 402 ? " You can also pay on Square\u2019s page below." : "");
      redrawEnded();
      schedule(300);
    });
  }
  function payLink() {
    if (S.busy) return;
    var d = S.d;
    if (d && d.pay && d.pay.linkOpen && d.pay.linkUrl && !(d.card && d.card.onFile)) { window.location.href = d.pay.linkUrl; return; }
    S.busy = "Opening Square…";
    S.payErr = "";
    redrawEnded();
    post("/meter/paylink", { t: token }).then(function (data) {
      S.busy = "";
      if (data.already || data.paid) { schedule(10); return; }
      if (/^https:\/\//i.test(String(data.url || ""))) window.location.href = data.url;
      else { S.payErr = "Square didn\u2019t return a page. Try again."; redrawEnded(); }
    }).catch(function (e) {
      S.busy = "";
      S.payErr = e.message;
      redrawEnded();
    });
  }

  if (!token) { draw(true); return; }
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && !S.stopped) schedule(50); });
  poll();
})();
