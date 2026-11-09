/* Customer tracker SOS at phone size. Confirm first. The 911 link is not followed by itself. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const TOKEN = "d".repeat(32);

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main id="app"><p>Loading the ride…</p></main>
<script>window.fetch = function () { return new Promise(function () {}); };</script>
<script>
window.L = {
  map: function () { return { setView: function () { return this; }, on: function () {}, getSize: function () { return { x: 390, y: 500 }; }, fitBounds: function () {}, invalidateSize: function () {}, remove: function () {} }; },
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
</body></html>`;
}

test("390x844 tracker SOS confirms, then shows 911 plus driver car plate and location", async function () {
  const port = 8804;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-tr-sos-"));
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
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }, sid);
    await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html?t=" + TOKEN }, sid);
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      const msg = await send("Runtime.evaluate", { expression: "!!(window.__pcsFollowLive && document.getElementById('fl-sos-btn'))", returnByValue: true }, sid);
      ready = !!(msg.result && msg.result.result && msg.result.result.value);
      if (!ready) await wait(150);
    }
    assert.ok(ready, "SOS button did not appear");
    async function ev(expr) {
      const msg = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid);
      return msg.result.result.value;
    }
    const ride = { status: "on_way", driverFirst: "Matt", car: { color: "Black", year: "2020", make: "Cadillac", model: "Escalade", plate: "PCS 1042" }, pos: { lat: 30.0512, lng: -95.4518, at: Date.now() }, pickup: { label: "10 Estancia Pl", lat: 30.1, lng: -95.5 }, updatedAt: Date.now() };
    await ev("window.__pcsFollowLive.update(" + JSON.stringify(ride) + ")");
    await wait(80);
    const hit = JSON.parse(await ev("(function(){var b=document.getElementById('fl-sos-btn');var r=b.getBoundingClientRect();var x=r.left+r.width/2,y=r.top+r.height/2;var el=document.elementFromPoint(x,y);return JSON.stringify({id:el&&el.id,w:Math.round(r.width),h:Math.round(r.height)});})()"));
    assert.equal(hit.id, "fl-sos-btn");
    assert.ok(hit.w >= 44 && hit.h >= 44);
    await ev("document.getElementById('fl-sos-btn').click()");
    const ask = await ev("document.getElementById('fl-sos-ask').innerText");
    assert.ok(ask.indexOf("Request police help?") >= 0);
    assert.equal(await ev("!!document.getElementById('fl-sos-ask').querySelector('a[href=\"tel:911\"]')"), false);
    const hrefBefore = await ev("location.href");
    await ev("document.getElementById('fl-sos-no').click()");
    assert.equal(await ev("!!document.getElementById('fl-sos-ask')"), false);
    assert.equal(await ev("!!document.getElementById('fl-sos-sheet')"), false);
    assert.equal(await ev("location.href"), hrefBefore);
    await ev("document.getElementById('fl-sos-btn').click()");
    await ev("document.getElementById('fl-sos-yes').click()");
    assert.equal(await ev("location.href"), hrefBefore);
    const sheet = await ev("document.getElementById('fl-sos-read').textContent");
    assert.ok(sheet.indexOf("Driver: Matt") >= 0);
    assert.ok(sheet.indexOf("Black") >= 0 && sheet.indexOf("Cadillac") >= 0);
    assert.ok(sheet.indexOf("PCS 1042") >= 0);
    assert.ok(sheet.indexOf("30.051200, -95.451800") >= 0);
    assert.equal(await ev("document.getElementById('fl-sos-911').getAttribute('href')"), "tel:911");
    assert.ok(String(await ev("document.getElementById('fl-sos-maps').getAttribute('href')")).indexOf("30.051200") >= 0);
    assert.equal(await ev("!!document.getElementById('pcs-sos-btn')"), false);
    await ev("document.getElementById('fl-sos-copy').click()");
    await wait(30);
    await ev("document.getElementById('fl-sos-close').click()");
    await ev("window.__pcsFollowLive.notice('Ride ended','This ride has ended. Thanks for following along with PCS.',true)");
    assert.equal(await ev("!!document.getElementById('fl-msg')"), true);
    assert.equal(await ev("!!document.getElementById('fl-sos-btn')"), true);
    await ev("document.getElementById('fl-sos-btn').click(); document.getElementById('fl-sos-yes').click();");
    const ended = await ev("document.getElementById('fl-sos-read').textContent");
    assert.ok(ended.indexOf("PCS 1042") >= 0);
    assert.equal(await ev("document.getElementById('fl-sos-911').getAttribute('href')"), "tel:911");
    await ev("document.getElementById('fl-sos-close').click()");
    const pickupOnly = { status: "on_way", driverFirst: "Matt", car: { color: "Black", make: "Cadillac", plate: "PCS 1042" }, pickup: { label: "10 Estancia Pl", lat: 30.1, lng: -95.5 }, updatedAt: Date.now() };
    await ev("window.__pcsFollowLive.update(" + JSON.stringify(pickupOnly) + ")");
    await ev("document.getElementById('fl-sos-btn').click(); document.getElementById('fl-sos-yes').click();");
    const missing = await ev("document.getElementById('fl-sos-read').textContent");
    assert.ok(missing.indexOf("Location: Location unavailable") >= 0);
    assert.equal(missing.indexOf("30.100000"), -1);
    assert.equal(missing.indexOf("-95.500000"), -1);
    assert.equal(missing.indexOf("30.1"), -1);
    assert.equal(await ev("!!document.getElementById('fl-sos-copy')"), false);
    assert.equal(await ev("!!document.getElementById('fl-sos-maps')"), false);
    assert.equal(await ev("document.getElementById('fl-sos-911').getAttribute('href')"), "tel:911");
    const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
    fs.writeFileSync("/opt/cursor/artifacts/tracker-sos-390.png", Buffer.from(shot.result.data, "base64"));
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
