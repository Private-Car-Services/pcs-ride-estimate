/* Customer tracker bottom bar at phone size. The old call button is the invoice line. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const PAY = "https://squareup.com/pay-invoice/inv-574";
const RECEIPT = "https://squareup.com/receipt/preview/rcpt-554";
const TOKEN = "c".repeat(32);

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0} #app{width:390px}</style></head><body>
<main id="app"><p id="fw-loading">Loading the ride…</p></main>
<script>window.fetch = function () { return new Promise(function () {}); };</script>
<script>
window.L = {
  map: function () { return { setView: function () { return this; }, on: function () {}, getSize: function () { return { x: 390, y: 420 }; }, fitBounds: function () {}, panTo: function () {}, invalidateSize: function () {}, remove: function () {} }; },
  tileLayer: function () { return { addTo: function () {} }; },
  layerGroup: function () { return { addTo: function () { return this; }, clearLayers: function () {} }; },
  circleMarker: function () { return { bindTooltip: function () { return this; }, addTo: function () {} }; },
  marker: function () { return { bindTooltip: function () { return this; }, addTo: function () {} }; },
  polyline: function () { return { addTo: function () {} }; },
  divIcon: function () { return {}; },
  control: function () { return { onAdd: function () {}, addTo: function () {} }; },
  DomUtil: { create: function () { return document.createElement("div"); } }
};
</script>
<script src="follow-live.js"></script>
<script>
window.__show = function (d) { window.__pcsFollowLive.update(d); };
window.__bar = function () {
  var el = document.getElementById("fl-call");
  var status = document.getElementById("fl-status");
  var invEl = status && status.querySelector(".fl-status-inv");
  var rideEl = status && status.querySelector(".fl-status-ride");
  var a = el && el.querySelector("a");
  var word = status && status.querySelector("a");
  var bg = el ? getComputedStyle(el).backgroundColor : "";
  var live = document.getElementById("fl-live");
  var sr = status ? status.getBoundingClientRect() : null;
  var phone = (live || document.body).getBoundingClientRect();
  return JSON.stringify({
    hidden: !el || !!el.hidden,
    text: el ? el.textContent : "",
    status: status ? status.textContent : "",
    ride: rideEl ? rideEl.textContent : "",
    inv: invEl ? invEl.textContent : "",
    invNowrap: invEl ? getComputedStyle(invEl).whiteSpace : "",
    invDisplay: invEl ? getComputedStyle(invEl).display : "",
    href: a ? a.getAttribute("href") : "",
    link: a ? a.textContent : "",
    wordHref: word ? word.getAttribute("href") : "",
    bg: bg,
    pinned: !!(live && live.classList.contains("fl-has-bill")),
    statusInView: !!(sr && sr.height > 20 && sr.top >= phone.top - 1 && sr.bottom <= phone.bottom + 1 && sr.right <= phone.right + 1),
    phone: (live || document.body).textContent.indexOf("936-261-7878") >= 0,
    questions: (live || document.body).textContent.indexOf("Questions?") >= 0
  });
};
</script></body></html>`;
}

test("390x844 tracker bottom bar is the invoice line, not the call button", async function () {
  const port = 8802;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-tr-inv-"));
  fs.copyFileSync(path.join(__dirname, "../follow/follow-live.js"), path.join(dir, "follow-live.js"));
  fs.writeFileSync(path.join(dir, "index.html"), page());
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=420,900", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  try {
    let ver;
    for (let i = 0; i < 40 && !ver; i++) {
      try { ver = await fetch("http://127.0.0.1:" + (port + 100) + "/json/version").then(function (r) { return r.json(); }); } catch (e) { await wait(200); }
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
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sid);
    await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html?t=" + TOKEN }, sid);
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      const msg = await send("Runtime.evaluate", { expression: "!!(window.__pcsFollowLive && window.__show)", returnByValue: true }, sid);
      ready = !!(msg.result && msg.result.result && msg.result.result.value);
      if (!ready) await wait(150);
    }
    assert.ok(ready, "tracker did not load");
    const base = { status: "on_way", driverFirst: "Matt", bill: "invoiced", updatedAt: Date.now(), etaAt: Date.now(), eta: { min: 43, miles: 21.7, to: "pickup" }, pickup: { label: "10 Estancia Pl, Spring", lat: 30.1, lng: -95.5 }, dest: { label: "26 Veilwood Cir, Spring", lat: 30.2, lng: -95.4 }, pos: { lat: 30.05, lng: -95.45, at: Date.now() } };
    async function show(extra) {
      await send("Runtime.evaluate", { expression: "window.__show(" + JSON.stringify(Object.assign({}, base, extra)) + ")", returnByValue: true }, sid);
      await wait(50);
      return JSON.parse((await send("Runtime.evaluate", { expression: "window.__bar()", returnByValue: true }, sid)).result.result.value);
    }
    const now = Date.now();
    const none = await show({});
    assert.equal(none.hidden, true);
    assert.equal(none.pinned, false);
    assert.equal(none.phone, false);
    assert.equal(none.questions, false);
    const num = await show({ invoiceNo: "000562" });
    assert.equal(num.hidden, false);
    assert.equal(num.pinned, false);
    assert.equal(num.text, "Invoice #000562");
    assert.equal(num.status, "Your driver is on the way");
    assert.equal(num.inv, "");
    assert.equal(num.status.indexOf("Invoice"), -1);
    assert.equal(num.status.indexOf("Unpaid"), -1);
    assert.equal(num.status.indexOf("Paid"), -1);
    assert.equal(num.statusInView, true);
    assert.equal(num.phone, false);
    const stale = await show({ invoiceNo: "000562", sqInvoice: { status: "DRAFT", paid: false, checkedAt: Date.parse("2026-11-03T12:00:00Z") }, payUrl: PAY });
    assert.equal(stale.hidden, false);
    assert.equal(stale.text, "Invoice #000562");
    assert.equal(stale.status, "Your driver is on the way");
    assert.equal(stale.status.indexOf("Unpaid"), -1);
    const draft = await show({ invoiceNo: "000562", sqInvoice: { status: "DRAFT", paid: false, checkedAt: now } });
    assert.equal(draft.hidden, false);
    assert.equal(draft.text, "Invoice #000562 · Unpaid");
    assert.equal(draft.href, "");
    assert.equal(draft.status, "Your driver is on the way");
    assert.equal(draft.inv, "");
    assert.equal(draft.status.indexOf("Invoice"), -1);
    assert.equal(draft.bg, "rgb(11, 107, 58)");
    assert.equal(draft.pinned, false);
    assert.equal(draft.statusInView, true);
    const unpaid = await show({ invoiceNo: "000562", sqInvoice: { status: "UNPAID", paid: false, checkedAt: now }, payUrl: PAY });
    assert.equal(unpaid.text, "Invoice #000562 · Unpaid · Pay invoice");
    assert.equal(unpaid.href, PAY);
    assert.equal(unpaid.link, "Pay invoice");
    assert.equal(unpaid.wordHref, "");
    assert.equal(unpaid.status, "Your driver is on the way");
    assert.equal(unpaid.bg, "rgb(11, 107, 58)");
    assert.equal(unpaid.phone, false);
    assert.equal(unpaid.statusInView, true);
    const unpaidShot = await send("Page.captureScreenshot", { format: "png" }, sid);
    fs.writeFileSync("/opt/cursor/artifacts/tracker-iphone-390-unpaid.png", Buffer.from(unpaidShot.result.data, "base64"));
    const paid = await show({ invoiceNo: "000562", sqInvoice: { status: "PAID", paid: true, checkedAt: now }, receiptUrl: RECEIPT });
    assert.equal(paid.text, "Invoice #000562 · Paid · View receipt");
    assert.equal(paid.href, RECEIPT);
    assert.equal(paid.link, "View receipt");
    assert.equal(paid.status, "Your driver is on the way");
    assert.equal(paid.status.indexOf("Invoice"), -1);
    assert.equal(paid.bg, "rgb(11, 107, 58)");
    const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
    fs.writeFileSync("/opt/cursor/artifacts/tracker-iphone-390-paid.png", Buffer.from(shot.result.data, "base64"));
    fs.writeFileSync("/opt/cursor/artifacts/tracker-invoice-390.png", Buffer.from(shot.result.data, "base64"));
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
