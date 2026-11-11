/* v2.0m-bk: in the REAL driver app (app/driver/index.html), the rider-in-car full map's zoom buttons sit where the
   drive-to-rider full map's do. Stubs only: GPS, Firebase (no database URL, SDK blocked), the PCS Worker (blocked),
   and the route server (a fixed OSRM-shaped route, answered late so the ETA pill shows first). Leaflet and OSM tiles load
   as in the other browser tests. app.js gets one extra line at the end of its closure that exposes state and the
   functions the driver's taps call (window.__T). */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const DON = { id: "icloud_e3c7f78e8c4364875277", status: "assigned", rider: "Pick up Don Mordas from Galaxy FBO", riderPhone: "+18645511230",
  pickup: "Galaxy FBO, 2971 Hawthorne Dr, Conroe, TX  77303, United States", dropoff: "18308 Woodstream Crossing Rd, Montgomery, TX 77356",
  assignedDriverId: "mwragge_privatetaxiservices_net", assignedDriverName: "Matthew Wragge", prepaidInvoiceNo: "000586", prepaid: false, prepaidVia: "square_invoice",
  sqInvoice: { number: "000586", status: "UNPAID", paid: false, public_url: "https://app.squareup.com/pay-invoice/invtmp:41611547-76a4-4ca2-8fa0-da55855ad720", subtotalCents: 4480, taxCents: 370, totalCents: 4850 },
  pickupLat: 30.3528, pickupLng: -95.4147, dropoffLat: 30.3861, dropoffLng: -95.6158 };
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAEAAQBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

function osrm(url, street) {
  const pts = url.split("/driving/")[1].split("?")[0].split(";").map(function (p) { return p.split(",").map(Number); });
  const a = pts[0], b = pts[pts.length - 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const mi = Math.hypot((b[0] - a[0]) * 59, (b[1] - a[1]) * 69);
  return { code: "Ok", routes: [{ distance: mi * 1609.344, duration: mi * 100, geometry: { type: "LineString", coordinates: [a, m, b] },
    legs: [{ steps: [{ maneuver: { type: "depart", location: a }, name: "Hawthorne Drive" }, { maneuver: { type: "turn", modifier: "left", location: m }, name: street }, { maneuver: { type: "arrive", location: b }, name: "" }] }] }] };
}

async function drive(w, h, port, street) {
  let appSrc = fs.readFileSync(path.join(ROOT, "app/app.js"), "utf8");
  const end = appSrc.lastIndexOf("\n})();");
  appSrc = appSrc.slice(0, end) + "\n  window.__T = { state: state, render: render, schedBegin: schedBegin, schedTripSave: schedTripSave, schedFullSet: schedFullSet, schedNavFetch: schedNavFetch, rfsSet: rfsSet, sosPlace: sosPlace };" + appSrc.slice(end);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-ridezoom-"));
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", ROOT], { stdio: "ignore" });
  const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--remote-debugging-port=" + (port + 100), "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"], { stdio: "ignore" });
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
  try {
    let ver;
    for (let i = 0; i < 50 && !ver; i++) { try { ver = await fetch("http://127.0.0.1:" + (port + 100) + "/json/version").then(function (r) { return r.json(); }); } catch (e) { await wait(200); } }
    assert.ok(ver, "chrome did not start");
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    const pending = new Map(); const handlers = []; let seq = 0;
    ws.onmessage = function (ev) { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) handlers.forEach(function (fn) { fn(msg); }); };
    await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
    function send(method, params, sessionId) { const id = ++seq; return new Promise(function (resolve) { pending.set(id, resolve); ws.send(JSON.stringify({ id: id, sessionId: sessionId, method: method, params: params || {} })); }); }
    const created = await send("Target.createTarget", { url: "about:blank" });
    const sid = (await send("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
    const b64 = function (s) { return Buffer.from(s, "utf8").toString("base64"); };
    handlers.push(function (m) {
      if (m.method !== "Fetch.requestPaused") return;
      const u = m.params.request.url, rid = m.params.requestId;
      const ok = function (body, type) { return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: type || "application/javascript" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: b64(body) }, sid); };
      if (u.indexOf("http://127.0.0.1:" + port + "/") === 0) {
        const p = new URL(u).pathname;
        if (p === "/app/app.js") return ok(appSrc);
        if (p === "/app/sync-config.js") return ok('window.PCS_SYNC = { databaseURL: "", bookingWebhook: "" };');
        return send("Fetch.continueRequest", { requestId: rid }, sid);
      }
      if (/^https:\/\/router\.project-osrm\.org\//.test(u)) { setTimeout(function () { ok(JSON.stringify(osrm(u, street)), "application/json"); }, 1500); return; } /* late: the ETA pill shows first */
      if (/^https:\/\/(tile\.openstreetmap\.org|unpkg\.com)\//.test(u) && m.params.request.method === "GET") return send("Fetch.continueRequest", { requestId: rid }, sid);
      if (/\.js(\?|$)/.test(u)) return ok("/* blocked in test */");
      return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 503, responseHeaders: [{ name: "Access-Control-Allow-Origin", value: "*" }], body: b64("") }, sid);
    });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sid);
    await send("Page.enable", {}, sid); await send("Runtime.enable", {}, sid);
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__gps={lat:30.3119,lng:-95.4561};(function(){var subs=[];function fix(){return{coords:{latitude:window.__gps.lat,longitude:window.__gps.lng,accuracy:5,speed:17,heading:45,altitude:null,altitudeAccuracy:null},timestamp:Date.now()};}" +
      "var geo={getCurrentPosition:function(ok){setTimeout(function(){ok(fix());},30);},watchPosition:function(ok){subs.push(ok);setTimeout(function(){ok(fix());},30);return subs.length;},clearWatch:function(){}};" +
      "Object.defineProperty(navigator,'geolocation',{get:function(){return geo;}});setInterval(function(){subs.forEach(function(f){try{f(fix());}catch(e){}});},1000);})();" +
      "localStorage.setItem('pcs-driver-session','mwragge@privatetaxiservices.net');localStorage.setItem('pcs-driver-speed-notice-v73','1');" +
      "localStorage.setItem('pcs-driver-account',JSON.stringify({name:'Test Driver',carYear:2022,carMake:'Test',carModel:'Car',carColor:'Black',carPlate:'TEST123',carSeats:4,carPhoto:'data:image/jpeg;base64," + JPEG + "'}));" }, sid);
    async function ev(expr) { const msg = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sid); return msg.result && msg.result.result ? msg.result.result.value : null; }
    async function until(expr, ms) { for (let i = 0; i < ms / 200; i++) { if (await ev(expr)) return true; await wait(200); } return false; }
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true, screenWidth: w, screenHeight: h }, sid);
    await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/app/driver/index.html" }, sid);
    assert.ok(await until("!!window.__T && document.getElementById('app').innerHTML.length > 50", 15000), w + " app did not load");
    const row = Object.assign({}, DON, { start: new Date(Date.now() + 30 * 60000).toISOString(), headedToPickupAt: Date.now() - 300000 });
    await ev("(function(){var T=window.__T,row=" + JSON.stringify(row) + ";T.state.milesNeedStart=false;T.state.milesStartOdo=100000;T.state.rosterStatus='approved';T.state.scheduledRides=[row];T.state.scheduledLoadedAt=Date.now();T.state.scheduledError='';" +
      "T.schedTripSave({id:row.id,phase:'pickup',at:row.headedToPickupAt});T.render();T.schedFullSet(true);T.schedNavFetch(true);return 1;})()");
    assert.ok(await until("/mi to the pickup/.test((document.getElementById('sched-turn-fs')||{}).innerText||'')", 15000), w + " pickup route");
    await wait(1500);
    const RECT = "function r(sel){var e=document.querySelector(sel);if(!e)return null;var q=e.getBoundingClientRect();return q.width&&q.height?{t:Math.round(q.top),b:Math.round(q.bottom),l:Math.round(q.left),r:Math.round(q.right)}:null;}";
    const pick = await ev("(function(){" + RECT + "return{zoom:r('#home-map-stage .leaflet-control-zoom'),eta:r('#sched-eta-fs'),turn:r('#sched-turn-fs'),turnText:document.getElementById('sched-turn-fs').innerText};})()");
    /* pick the rider up with the full map already chosen, before the drop-off route is back: the ETA pill shows first */
    await ev("window.__gps.lat=30.3528;window.__gps.lng=-95.4147;1");
    await wait(1200);
    await ev("(function(){var T=window.__T;T.rfsSet(true);return T.schedBegin(T.state.scheduledRides[0].id).then(function(){T.rfsSet(true);return 1;});})()");
    const pillFirst = await ev("(function(){var c=document.getElementById('meter-eta-chip');return !!c&&c.getBoundingClientRect().height>0;})()");
    assert.ok(await until("(function(){var c=document.getElementById('meter-eta-chip'),b=document.getElementById('meter-eta-box');return c&&b&&c.style.display==='none'&&b.getBoundingClientRect().height>0&&/mi to the drop-off/.test((document.getElementById('meter-turn')||{}).innerText||'');})()", 15000), w + " ride route / ETA box");
    await wait(2500); /* several 1 s ticks after the pill hides */
    const ride = await ev("(function(){" + RECT + "var st=document.getElementById('meter-map-stage'),ts=document.getElementById('meter-topstack'),t0=ts.getBoundingClientRect().top,vis=0;Array.prototype.forEach.call(ts.children,function(c){var q=c.getBoundingClientRect();if(q.width>0&&q.height>0)vis=Math.max(vis,Math.round(q.bottom-t0));});" +
      "return{zoom:r('#meter-map-stage .leaflet-control-zoom'),eta:r('#meter-eta-box'),turn:r('#meter-turn'),turnText:document.getElementById('meter-turn').innerText,rfsTop:st.style.getPropertyValue('--rfs-top'),visible:vis,full:st.classList.contains('pcs-rfs')};})()");
    ws.close();
    return { pick: pick, ride: ride, pillFirst: pillFirst };
  } finally { chrome.kill("SIGKILL"); server.kill("SIGKILL"); }
}

test("real app 390x844: ride map zoom sits where the pickup map zoom does, after the ETA pill hides", { timeout: 90000 }, async function () {
  const got = await drive(390, 844, 8874, "Oak Street");
  assert.equal(got.ride.full, true);
  assert.equal(got.pillFirst, true, "the ETA pill should show before the drop-off route is back");
  assert.equal(got.ride.rfsTop, got.ride.visible + "px", "--rfs-top tracks the visible top cards");
  assert.deepEqual(got.ride.turn, got.pick.turn, "turn card " + JSON.stringify(got));
  assert.deepEqual(got.ride.eta, got.pick.eta, "Arrive box " + JSON.stringify(got));
  assert.deepEqual(got.ride.zoom, got.pick.zoom, "zoom " + JSON.stringify(got));
  assert.equal(got.ride.zoom.t, 216);
});

test("real app 390x844: when the turn name wraps on both maps, the ride card, Arrive box and zoom still match the pickup map", { timeout: 90000 }, async function () {
  const got = await drive(390, 844, 8876, "Sterling Place Drive Northwest");
  assert.equal(got.ride.rfsTop, got.ride.visible + "px", "--rfs-top tracks the visible top cards");
  assert.ok(got.pick.turn.b - got.pick.turn.t > 89, "the longer name wraps: " + JSON.stringify(got.pick));
  assert.deepEqual(got.ride.turn, got.pick.turn, "turn card " + JSON.stringify(got));
  assert.deepEqual(got.ride.eta, got.pick.eta, "Arrive box " + JSON.stringify(got));
  assert.deepEqual(got.ride.zoom, got.pick.zoom, "zoom " + JSON.stringify(got));
});
