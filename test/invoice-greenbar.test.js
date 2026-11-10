/* Driver green bar for the 000554 and 000574 field shapes. Customer tracker is a separate change. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const test = require("node:test");

const RAHUAL = { prepaidInvoiceNo: "000554", status: "assigned" };
const CAMARA = { prepaidInvoiceNo: "000574", prepaid: false, prepaidVia: "square_invoice", prepaidAmountCents: 2066, prepaidTaxCents: 2066, status: "assigned" };
const PAY = "https://squareup.com/pay-invoice/inv-574";
const RECEIPT = "https://squareup.com/receipt/rcpt-554";

function el() {
  return {
    style: {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {}
  };
}
function loadApp() {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", share: null, geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: false, status: 0, text: function () { return Promise.resolve(""); }, json: function () { return Promise.resolve(null); } }); },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: el, body: el(), head: el(), documentElement: el()
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app/app.js" });
  return sandbox.__pcsV20lBill;
}
const bill = loadApp();
const appSrc = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

test("000554 and 000574 show the invoice number and do not invent paid or unpaid", function () {
  assert.equal(bill.pay(RAHUAL), "");
  assert.equal(bill.bar(RAHUAL), "Invoice #000554");
  assert.equal(bill.pickupLine(RAHUAL), "I\u2019m at the pickup");
  assert.equal(bill.slot(RAHUAL), " \u00b7 Invoice #000554");
  assert.equal(bill.slot(RAHUAL).indexOf("href"), -1);
  assert.equal(bill.slot(RAHUAL).indexOf("unpaid"), -1);
  assert.equal(bill.pay(CAMARA), "");
  assert.equal(bill.slot(CAMARA), " \u00b7 Invoice #000574");
  assert.equal(bill.slot(CAMARA).indexOf("unpaid"), -1);
  assert.equal(bill.pickupLine({}), "I\u2019m at the pickup");
  assert.equal(bill.slot({ riderPhone: "9365550100" }), "");
});

test("paid and unpaid words follow an actual payment record", function () {
  const paid = { prepaidInvoiceNo: "000554", sqInvoice: { paid: true, status: "PAID" } };
  const pending = { prepaidInvoiceNo: "000574", prepaid: false, prepaidVia: "square_invoice", payState: "invoice_pending" };
  const squareUnpaid = { prepaidInvoiceNo: "000574", sqInvoice: { status: "UNPAID", paid: false }, invoicePayUrl: PAY };
  const cash = { prepaidInvoiceNo: "000554", assignedDriverId: "mwragge_privatetaxiservices_net", paidCash: { by: "driver", driverId: "mwragge_privatetaxiservices_net" } };
  assert.equal(bill.pay(paid), "paid");
  assert.equal(bill.bar(paid), "Invoice #000554 \u2013 paid");
  assert.equal(bill.pay(pending), "");
  assert.equal(bill.bar(pending), "Invoice #000574");
  assert.equal(bill.slot(pending), " \u00b7 Invoice #000574");
  assert.equal(bill.pay(squareUnpaid), "unpaid");
  assert.equal(bill.slot(squareUnpaid).indexOf("\u2013 unpaid") >= 0, true);
  assert.equal(bill.slot(squareUnpaid).indexOf("Pay invoice") >= 0, true);
  assert.equal(bill.pay(cash), "paid");
  assert.equal(bill.pay({ prepaidInvoiceNo: "000554", prepaid: false }), "");
  assert.equal(bill.pay({ prepaidInvoiceNo: "000574", prepaidVia: "square_invoice" }), "");
  assert.equal(bill.pay({ prepaid: true, prepaidInvoiceNo: "000574" }), "");
  assert.equal(bill.slot({ prepaid: true, prepaidInvoiceNo: "000574" }).indexOf("unpaid"), -1);
  assert.equal(bill.pay({ prepaidInvoiceNo: "000574", sqInvoice: { paid: false } }), "");
  assert.equal(bill.pay({ prepaidInvoiceNo: "000574", invoiceStatus: "UNPAID", payState: "invoice_pending" }), "");
  const paidLinked = { prepaidInvoiceNo: "000554", sqInvoice: { paid: true, status: "PAID", amountDueCents: 0 }, receiptUrl: RECEIPT };
  assert.equal(bill.slot(paidLinked), " \u00b7 Invoice #000554 \u2013 paid \u00b7 <a id=\"sched-inv-link\" href=\"" + RECEIPT + "\" target=\"_blank\" rel=\"noopener\">View receipt</a>");
  const owedLinked = { prepaidInvoiceNo: "000574", payState: "invoice_pending", invoicePayUrl: PAY };
  assert.equal(bill.slot(owedLinked).indexOf("Pay invoice"), -1);
  assert.equal(bill.slot(owedLinked).indexOf(PAY), -1);
  assert.equal(bill.slot(owedLinked).indexOf("unpaid"), -1);
  assert.equal(bill.slot({ prepaidInvoiceNo: "000300", sqInvoice: { status: "PARTIALLY_PAID", amountDueCents: 400 } }).indexOf("href"), -1);
  assert.equal(bill.slot({ prepaidInvoiceNo: "000301", sqInvoice: { status: "REFUNDED" } }).indexOf("unpaid"), -1);
  const shared = { prepaid: true, prepaidInvoiceNo: "000560", payState: "invoice_pending", paymentStatus: "invoice_pending", invoiceStatus: "UNPAID", sqInvoice: { paid: true, status: "PAID", invoiceNumber: "000560" } };
  assert.equal(bill.pay(shared), "");
  assert.equal(bill.slot(shared), " \u00b7 Invoice #000560");
  assert.equal(bill.slot(shared).indexOf("unpaid"), -1);
  assert.equal(bill.slot(shared).indexOf("paid"), -1);
  const dueUnpaid = { prepaidInvoiceNo: "000574", sqInvoice: { status: "UNPAID", paid: false, amountDueCents: 2066, public_url: PAY } };
  assert.equal(bill.pay(dueUnpaid), "unpaid");
  assert.equal(bill.slot(dueUnpaid), " \u00b7 Invoice #000574 \u2013 unpaid \u00b7 <a id=\"sched-inv-link\" href=\"" + PAY + "\" target=\"_blank\" rel=\"noopener\">Pay invoice</a>");
  assert.equal(bill.pay({ prepaidInvoiceNo: "000559", paymentStatus: "unpaid", invoiceStatus: "UNPAID" }), "");
  assert.equal(bill.slot({ prepaidInvoiceNo: "000559", paymentStatus: "unpaid" }), " \u00b7 Invoice #000559");
});

test("a live Square read picks the pay page or the receipt, and a saved flag does not", function () {
  const unpaid = { invoiceNumber: "000554", status: "UNPAID", public_url: "https://app.squareup.com/pay-invoice/invtmp:example-554", payments: [], orderState: "OPEN" };
  const paid = { invoiceNumber: "000574", status: "PAID", public_url: "https://app.squareup.com/pay-invoice/invtmp:example-574", payments: [{ status: "COMPLETED", refundedCents: null, receipt_url: "https://squareup.com/receipt/preview/EXAMPLE" }] };
  const u = bill.square(unpaid), p = bill.square(paid);
  assert.equal(u.pay, "unpaid");
  assert.equal(u.link, "Pay invoice");
  assert.equal(u.url, unpaid.public_url);
  assert.equal(p.pay, "paid");
  assert.equal(p.link, "View receipt");
  assert.equal(p.url, paid.payments[0].receipt_url);
  assert.notEqual(p.url, paid.public_url);
  assert.equal(bill.square({ invoiceNumber: "000574", status: "PAID", public_url: paid.public_url, payments: [{ status: "COMPLETED", refundedCents: 100, receipt_url: paid.payments[0].receipt_url }] }).pay, "");
  assert.equal(bill.pay({ prepaid: false, prepaidInvoiceNo: "000574", prepaidVia: "square_invoice" }), "");
  const shown = bill.slot({ prepaidInvoiceNo: "000554", sqLive: unpaid });
  assert.ok(shown.indexOf("Invoice #000554") >= 0 && shown.indexOf("unpaid") >= 0 && shown.indexOf("Pay invoice") >= 0);
  assert.ok(shown.indexOf(unpaid.public_url) >= 0);
  const shownPaid = bill.slot({ prepaidInvoiceNo: "000574", sqLive: paid });
  assert.ok(shownPaid.indexOf("Invoice #000574") >= 0 && shownPaid.indexOf("View receipt") >= 0);
  assert.equal(shownPaid.indexOf(paid.public_url), -1);
});

test("the driver invoice read keeps only the asked ride", function () {
  const slice = appSrc.slice(appSrc.indexOf("function verInvFetch"), appSrc.indexOf("function verifiedPrepaid"));
  assert.equal(slice.indexOf("/sq/invoice"), -1);
  assert.equal(slice.indexOf("godToken"), -1);
  assert.equal(slice.indexOf("godPassword"), -1);
  const askAt = appSrc.indexOf("verInvFetch((rows");
  const ask = appSrc.slice(askAt, askAt + 500);
  assert.ok(ask.indexOf('r.status !== "cancelled"') >= 0 && ask.indexOf('r.status !== "canceled"') >= 0);
  const got = bill.take(["ride-554"], {
    "ride-554": { square: { invoiceNumber: "000554", status: "UNPAID", public_url: "https://app.squareup.com/pay-invoice/invtmp:example-554", payments: [] } },
    "ride-574": { square: { invoiceNumber: "000574", status: "PAID", public_url: "https://app.squareup.com/pay-invoice/invtmp:example-574", payments: [{ status: "COMPLETED", refundedCents: 0, receipt_url: "https://squareup.com/receipt/preview/EXAMPLE574" }] } }
  });
  assert.equal(got["ride-574"], undefined);
  assert.equal(got["ride-554"].square.status, "UNPAID");
  assert.equal(got["ride-554"].square.payments.length, 0);
  const shown = bill.slot({ id: "ride-554", prepaidInvoiceNo: "000554" });
  assert.ok(shown.indexOf("Invoice #000554") >= 0 && shown.indexOf("unpaid") >= 0 && shown.indexOf("Pay invoice") >= 0);
  assert.ok(shown.indexOf("app.squareup.com/pay-invoice/invtmp:example-554") >= 0);
  const stranger = bill.slot({ id: "ride-574", prepaidInvoiceNo: "000574" });
  assert.equal(stranger.indexOf("View receipt"), -1);
  assert.equal(stranger.indexOf("paid"), -1);
  assert.equal(stranger.indexOf("unpaid"), -1);
  assert.equal(appSrc.indexOf("rideLineHold(bot)"), -1);
  assert.equal(appSrc.indexOf('id="meter-ride-line"'), -1);
  const riderFn = appSrc.slice(appSrc.indexOf("function schedRiderLineHtml"), appSrc.indexOf("function schedBillHostHtml"));
  assert.ok(riderFn.indexOf("href=\\\"tel:") >= 0);
  assert.equal(riderFn.indexOf("rideInvoiceSlotHtml"), -1);
  assert.equal(riderFn.indexOf("Invoice #"), -1);
  const cardAt = appSrc.indexOf("'<div id=\"sched-rider-home\">' + schedRiderLineHtml(r)");
  const card = appSrc.slice(cardAt, cardAt + 220);
  assert.ok(cardAt > 0 && card.indexOf("sched-bill-home") >= 0 && card.indexOf("schedBillHostHtml") >= 0);
  assert.ok(appSrc.indexOf("stage.clientHeight - reserve") >= 0);
});

test("the ride map bar does not add a second invoice row", function () {
  const rfs = appSrc.slice(appSrc.indexOf("function rfsBarHtml"), appSrc.indexOf("function rfsBarClick"));
  const place = appSrc.slice(appSrc.indexOf("function schedMapBillPlace"), appSrc.indexOf("function schedFsMeasure"));
  const turn = appSrc.slice(appSrc.indexOf("function schedTurnHtml"), appSrc.indexOf("function navEtaClock"));
  assert.equal(rfs.indexOf("rideBillLabelHtml"), -1);
  assert.equal(rfs.indexOf("pcs-map-green"), -1);
  assert.equal(rfs.indexOf("rfs-bill"), -1);
  assert.equal(place.indexOf("questionSlotHtml"), -1);
  assert.match(place, /schedBillHome/);
  assert.match(place, /sched-bill-host/);
  assert.doesNotMatch(place, /insertBefore/);
  assert.doesNotMatch(place, /host\.remove/);
  assert.doesNotMatch(place, /rideBillLabelHtml|schedMapBillHtml/);
  assert.match(turn, /navTurnInvoice/);
  assert.match(appSrc, /sqInvoice: raw\.sqInvoice/);
});

test("the dark green nav line uses fresh Square truth for 000562", function () {
  const now = Date.now();
  const draft = bill.nav({ prepaidInvoiceNo: "000562", sqInvoice: { status: "DRAFT", paid: false, checkedAt: now } }, null, now);
  assert.equal(draft.text, "Invoice #000562 · Unpaid");
  assert.equal(draft.href, "");
  const owed = bill.nav({ prepaidInvoiceNo: "000562", sqInvoice: { status: "UNPAID", paid: false, checkedAt: now, public_url: PAY } }, null, now);
  assert.equal(owed.text, "Invoice #000562 · Unpaid");
  assert.equal(owed.href, PAY);
  const paid = bill.nav({ prepaidInvoiceNo: "000562", sqInvoice: { paid: true, status: "PAID", checkedAt: now, receipt_url: RECEIPT } }, null, now);
  assert.equal(paid.text, "Invoice #000562 · Paid");
  assert.equal(paid.href, RECEIPT);
  const stale = bill.nav({ prepaidInvoiceNo: "000562", sqInvoice: { status: "UNPAID", paid: false, checkedAt: Date.parse("2026-11-03T12:00:00Z"), public_url: PAY } }, null, now);
  assert.equal(stale.text, "Invoice #000562");
  assert.equal(stale.word, "");
  assert.equal(stale.href, "");
  const none = bill.nav({ prepaidInvoiceNo: "000562" }, null, now);
  assert.equal(none.word, "");
  assert.equal(none.text, "Invoice #000562");
  const held = bill.nav({ prepaidInvoiceNo: "000999" }, { fetchedAt: now, checkedAt: now, square: { invoiceNumber: "000562", status: "DRAFT", paid: false } }, now);
  assert.equal(held.text, "Invoice #000562 · Unpaid");
  const html = bill.navHtml(owed);
  assert.ok(html.indexOf("nav-inv") >= 0);
  assert.ok(html.indexOf(PAY) >= 0);
  assert.ok(html.indexOf(">Unpaid<") >= 0);
  assert.equal(bill.navHtml(none).indexOf("nav-inv-link"), -1);
  const flat = bill.take(["ride-562"], { "ride-562": { number: "000562", status: "DRAFT", paid: false, payUrl: "", receiptUrl: "", checkedAt: now } });
  assert.equal(flat["ride-562"].square.status, "DRAFT");
  assert.equal(flat["ride-562"].square.paid, false);
  assert.equal(bill.nav({ prepaidInvoiceNo: "000999" }, flat["ride-562"], now).text, "Invoice #000562 · Unpaid");
  const paidFlat = bill.take(["ride-paid"], { "ride-paid": { number: "000562", status: "PAID", paid: true, payUrl: PAY, receiptUrl: RECEIPT, checkedAt: now } });
  const paidNav = bill.nav({ prepaidInvoiceNo: "000999" }, paidFlat["ride-paid"], now);
  assert.equal(paidNav.text, "Invoice #000562 · Paid");
  assert.equal(paidNav.href, RECEIPT);
});

function quotedCss(fnSrc) {
  const parts = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(fnSrc))) {
    const bit = m[1].replace(/\\"/g, '"');
    if (bit.indexOf("{") >= 0) parts.push(bit);
  }
  return parts.join("");
}

function driverPage(kind, text, w, h, safe, row) {
  safe = safe || { top: 47, bottom: 34, left: 0, right: 0 };
  const css = quotedCss(appSrc.slice(appSrc.indexOf("function schedFullStyle"), appSrc.indexOf("function schedFullResize"))) +
    quotedCss(appSrc.slice(appSrc.indexOf("function fsStyle"), appSrc.indexOf("function rfsKey")));
  const rfs = kind === "rfs";
  const model = row && typeof row === "object" ? bill.nav(row, null, Date.now()) : { text: "", href: "" };
  const inv = bill.navHtml(model);
  const stageStyle = "position:relative;width:" + w + "px;height:" + h + "px;--pcs-safe-top:" + safe.top + "px;--pcs-safe-bottom:" + safe.bottom + "px;--pcs-safe-left:" + safe.left + "px;--pcs-safe-right:" + safe.right + "px";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#123}
    .leaflet-top,.leaflet-left{position:absolute}
    .leaflet-bar a{display:block;width:44px;height:44px;line-height:44px;background:#fff;color:#000;text-align:center;text-decoration:none}
    ${css}
  </style></head><body>
  <div id="${rfs ? "meter-map-stage" : "home-map-stage"}" class="${rfs ? "pcs-rfs" : "pcs-fullmap"}" style="${stageStyle}">
    <div class="leaflet-top leaflet-left"><div class="leaflet-control-zoom leaflet-bar"><a id="zoom-out" href="#">−</a></div></div>
    ${rfs ? "" : '<div id="sched-fs-top"><div id="sched-turn" style="background:#0b3d23;color:#fff;border-radius:12px;padding:10px 12px;font-size:20px;font-weight:800">Continue onto Rayford Rd' + inv + '</div></div>'}
    <div class="nav-toggle" style="position:absolute;right:8px;display:flex;gap:6px;z-index:1004">
      <button type="button" id="map-orient-toggle" style="min-height:36px">North up</button>
      <button type="button" id="map-mode-toggle" style="min-height:36px">Follow</button>
    </div>
    <div id="fs-mph" class="fs-mph" style="bottom:172px"><b id="fs-mph-num">32</b><span>MPH</span></div>
    ${rfs
      ? '<div id="rfs-bar" role="region" aria-label="Ride"><div class="rfs-row"><div class="rfs-stats"><span><b>1.20</b> mi</span><span><b>0:12</b></span></div></div><div class="rfs-actions"><button type="button" class="rfs-end" id="rfs-end">End ride</button><button type="button" class="rfs-close" id="sched-fs-close">Close map</button></div></div>'
      : '<div id="sched-fs-bottom"><button type="button" class="pcs-map-green" id="sched-fs-arrived">' + text + '</button><button type="button" id="sched-fs-close">Close map</button></div>'}
  </div>
  <p id="sched-rider-line" style="margin:8px">Rider: Rahual · <a href="tel:9365550100">9365550100</a></p>
  <script>
    var stage = document.getElementById("${rfs ? "meter-map-stage" : "home-map-stage"}");
    var bar = document.getElementById("${rfs ? "rfs-bar" : "sched-fs-bottom"}");
    if (stage.style.setProperty) stage.style.setProperty("${rfs ? "--rfs-bar" : "--sched-fs-bar"}", bar.offsetHeight + "px");
    if (!${rfs ? "true" : "false"} && stage.style.setProperty) stage.style.setProperty("--sched-fs-top", "84px");
    ["map-mode-toggle","map-orient-toggle","zoom-out","sched-fs-close","rfs-end","sched-fs-arrived","nav-inv-link"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", function (e) { if (e.preventDefault) e.preventDefault(); el.dataset.n = String(Number(el.dataset.n || 0) + 1); });
    });
    var greenEl = document.getElementById("rfs-bill") || document.getElementById("sched-fs-arrived");
    var endEl = document.getElementById("rfs-end");
    var overlap = false, greenBottom = 0, endTop = 0, greenH = 0;
    if (greenEl) { var gb = greenEl.getBoundingClientRect(); greenBottom = gb.bottom; greenH = gb.height; }
    if (endEl) { var eb = endEl.getBoundingClientRect(); endTop = eb.top; overlap = greenBottom > endTop + 1; }
    function hit(id) {
      var el = document.getElementById(id); if (!el) return { id: id, hit: "missing" };
      var r = el.getBoundingClientRect();
      var x = Math.round(r.left + r.width / 2);
      var y = Math.round(r.top + r.height / 2);
      var got = document.elementFromPoint(x, y);
      var bill = document.getElementById("sched-fs-arrived") || document.getElementById("rfs-bill");
      var host = document.getElementById("sched-bill-host");
      var rider = document.getElementById("sched-rider-line");
      var inv = document.getElementById("nav-inv");
      var mph = document.getElementById("fs-mph");
      var invoiceLinks = document.querySelectorAll("#nav-inv a[href]").length;
      var mphOverlap = false;
      if (inv && mph) {
        var ib = inv.getBoundingClientRect(), mb = mph.getBoundingClientRect();
        mphOverlap = ib.height > 0 && mb.height > 0 && !(ib.bottom <= mb.top + 1 || ib.top >= mb.bottom - 1 || ib.right <= mb.left + 1 || ib.left >= mb.right - 1);
      }
      var turn = document.getElementById("sched-turn");
      var turnBg = turn ? getComputedStyle(turn).backgroundColor : "";
      return { id: id, x: x, y: y, top: r.top, bottom: r.bottom, left: r.left, hit: got ? (got.id || got.className || got.tagName) : "",
        bill: bill ? bill.textContent : "", clip: bill ? bill.scrollWidth > bill.clientWidth + 2 : false,
        links: document.querySelectorAll("#home-map-stage a[href],#meter-map-stage a[href]").length, invoiceLinks: invoiceLinks,
        host: !!host, hostText: host ? host.textContent : "", riderText: rider ? rider.textContent : "",
        inv: inv ? inv.textContent : "", turnBg: turnBg, mphOverlap: mphOverlap,
        label: !!document.querySelector(".pcs-bill-label,#rfs-bill"),
        overlap: overlap, greenBottom: greenBottom, endTop: endTop, greenH: greenH };
    }
    var ids = ["map-orient-toggle","map-mode-toggle","zoom-out","sched-fs-close"];
    if (document.getElementById("rfs-end")) ids.push("rfs-end");
    document.body.dataset.report = JSON.stringify(ids.map(hit));
  </script></body></html>`;
}

function chromeSession(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-inv-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=1100,1200", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, server: server, chrome: chrome, debug: port + 100 };
}

test("full-page map and tracker keep the invoice on one line and the controls hittable", async function () {
  const port = 8794;
  const session = chromeSession(port);
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
  try {
    let ver;
    for (let i = 0; i < 40 && !ver; i++) {
      try { ver = await fetch("http://127.0.0.1:" + session.debug + "/json/version").then(function (r) { return r.json(); }); } catch (e) { await wait(200); }
    }
    assert.ok(ver, "chrome did not start");
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    const pending = new Map();
    let seq = 0;
    ws.onmessage = function (ev) { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
    await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
    function send(method, params, sessionId) {
      const id = ++seq;
      return new Promise(function (resolve) { pending.set(id, resolve); ws.send(JSON.stringify({ id: id, sessionId: sessionId, method: method, params: params || {} })); });
    }
    const created = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
    const sid = attached.result.sessionId;
    await send("Page.enable", {}, sid);
    await send("Runtime.enable", {}, sid);
    async function open(name, html) {
      fs.writeFileSync(path.join(session.dir, name), html);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + name }, sid);
      let report = "";
      for (let i = 0; i < 30 && !report; i++) {
        const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(150);
      }
      assert.ok(report, name + " did not report");
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      fs.writeFileSync("/opt/cursor/artifacts/invoice-" + name.replace(".html", "") + ".png", Buffer.from(shot.result.data, "base64"));
      return JSON.parse(report);
    }
    const ipadSafe = { top: 24, bottom: 20, left: 0, right: 0 };
    const ipadLand = { top: 24, bottom: 20, left: 24, right: 24 };
    const now = Date.now();
    const pages = [
      ["554-portrait.html", driverPage("pickup", bill.pickupLine(RAHUAL), 768, 1024, ipadSafe, RAHUAL)],
      ["574-portrait.html", driverPage("pickup", bill.pickupLine(CAMARA), 768, 1024, ipadSafe, Object.assign({}, CAMARA, { sqInvoice: { status: "DRAFT", paid: false, checkedAt: now } }))],
      ["554-landscape.html", driverPage("pickup", bill.pickupLine(RAHUAL), 1024, 768, ipadLand, Object.assign({}, RAHUAL, { receiptUrl: RECEIPT, sqInvoice: { paid: true, status: "PAID", checkedAt: now, receipt_url: RECEIPT } }))],
      ["574-rfs.html", driverPage("rfs", "", 768, 1024, ipadSafe, null)],
      ["554-rfs-landscape.html", driverPage("rfs", "", 1024, 768, ipadLand, null)],
      ["574-unpaid-rfs.html", driverPage("rfs", "", 1024, 768, ipadLand, null)],
      ["554-paid-rfs.html", driverPage("rfs", "", 768, 1024, ipadSafe, null)]
    ];
    for (const pair of pages) {
      const hits = await open(pair[0], pair[1]);
      hits.forEach(function (row) {
        assert.equal(row.hit, row.id, pair[0] + " " + row.id + " hit " + row.hit + " @" + row.x + "," + row.y);
        assert.equal(row.clip, false, pair[0] + " clipped " + row.bill);
        assert.equal(row.links, 1 + (row.invoiceLinks || 0), pair[0] + " unexpected link");
        assert.equal(row.host, false, pair[0] + " white bill bar is on the map");
        assert.equal(row.label, false);
        if (pair[0].indexOf("rfs") < 0) {
          assert.ok(row.inv.indexOf("Invoice #") >= 0, pair[0] + " invoice missing from the green bar " + row.inv);
          assert.equal(row.bill.indexOf("Invoice #"), -1, pair[0] + " invoice is on the arrive button");
          assert.equal(row.mphOverlap, false, pair[0] + " MPH covers the invoice");
          assert.equal(row.turnBg, "rgb(11, 61, 35)", pair[0] + " turn bar is not dark green");
          assert.equal(row.riderText.indexOf("Invoice #"), -1, pair[0] + " invoice is on the rider line");
        }
      });
      const zoom = hits.filter(function (row) { return row.id === "zoom-out"; })[0];
      if (pair[0].indexOf("rfs") < 0) assert.ok(zoom.top >= 24, pair[0] + " zoom is under the status area");
      if (pair[0].indexOf("rfs") >= 0) {
        const end = hits.filter(function (row) { return row.id === "rfs-end"; })[0];
        const follow = hits.filter(function (row) { return row.id === "map-mode-toggle"; })[0];
        assert.equal(end.hit, "rfs-end", pair[0] + " End ride covered");
        assert.ok(follow.bottom <= end.top, pair[0] + " Follow overlaps End ride");
      }
    }
    const paidPage = pages.filter(function (pair) { return pair[0] === "554-landscape.html"; })[0];
    await open(paidPage[0], paidPage[1]);
    await send("Runtime.evaluate", { expression: "document.getElementById('map-mode-toggle').click(); document.getElementById('map-orient-toggle').click(); document.getElementById('zoom-out').click(); document.getElementById('nav-inv-link').click(); document.getElementById('sched-fs-close').click();", returnByValue: true }, sid);
    const tapped = await send("Runtime.evaluate", { expression: "JSON.stringify({mode:document.getElementById('map-mode-toggle').dataset.n,orient:document.getElementById('map-orient-toggle').dataset.n,zoom:document.getElementById('zoom-out').dataset.n,link:document.getElementById('nav-inv-link').dataset.n,href:document.getElementById('nav-inv-link').getAttribute('href'),inv:document.getElementById('nav-inv').textContent,line:document.getElementById('sched-rider-line').textContent,close:document.getElementById('sched-fs-close').dataset.n,parent:document.getElementById('nav-inv-link').closest('#sched-turn') ? 'top' : '',host:!!document.getElementById('sched-bill-host')})", returnByValue: true }, sid);
    const got = JSON.parse(tapped.result.result.value);
    assert.equal(got.mode, "1");
    assert.equal(got.orient, "1");
    assert.equal(got.zoom, "1");
    assert.equal(got.link, "1");
    assert.equal(got.href, RECEIPT);
    assert.equal(got.parent, "top");
    assert.ok(got.inv.indexOf("Invoice #000554") >= 0 && got.inv.indexOf("Paid") >= 0);
    assert.equal(got.host, false);
    assert.equal(got.line.indexOf("Invoice #"), -1);
    assert.equal(got.close, "1");
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
  }
});
