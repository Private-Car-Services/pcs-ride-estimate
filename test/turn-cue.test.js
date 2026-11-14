/* v2.0m-bt: turn arrow + live distance on the driver nav maps. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const test = require("node:test");

const route = JSON.parse(fs.readFileSync(path.join(__dirname, "houston-galleria-route.json"), "utf8"));

function el() {
  return {
    style: {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {},
    insertAdjacentHTML: function () {}, remove: function () {}
  };
}
function loadCue() {
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
  return sandbox.__pcsTurnCue;
}

const cue = loadCue();
const appSrc = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

test("maneuver modifier picks the arrow, and Google text is the fallback", function () {
  const rows = [
    ["turn", "left", "Turn left onto McKinney St", "left"],
    ["turn", "slight left", "Keep left", "left"],
    ["turn", "sharp left", "Sharp left", "left"],
    ["turn", "straight", "Continue straight", "straight"],
    ["turn", "slight right", "Slight right", "right"],
    ["turn", "right", "Turn right onto Smith Street", "right"],
    ["turn", "sharp right", "Sharp right", "right"],
    ["turn", "uturn", "Make a U-turn", "uturn"],
    ["merge", "slight left", "Merge slight left onto Southwest Freeway", "left"],
    ["off ramp", "slight right", "Take the exit on the right", "right"],
    ["roundabout", "right", "At the roundabout, take exit 2", "right"],
    ["roundabout", "", "At the roundabout, take exit 2 onto Main", "straight"],
    ["fork", "slight right", "Keep right at the fork", "right"],
    ["arrive", "left", "Arrive at the destination", "straight"],
    ["depart", "", "Head southwest on Bagby St toward McKinney St", "straight"],
    ["", "", "Turn left onto McKinney St", "left"],
    ["", "", "Turn right onto Branard St Destination will be on the right", "right"],
    ["", "", "Make a U-turn onto Smith Street", "uturn"],
    ["", "", "Slight left to stay on Southwest Freeway", "left"],
    ["", "", "Keep right at the fork", "right"],
    ["", "", "Merge left onto I-45", "left"],
    ["", "", "Continue onto Bagby Street", "straight"]
  ];
  rows.forEach(function (row) {
    assert.equal(cue.kind(row[0], row[1], row[2]), row[3], row[2]);
  });
});

test("distance is miles to one decimal, then feet in steps of 50 under 0.1 mile", function () {
  assert.equal(cue.dist(1.24), "1.2 miles");
  assert.equal(cue.dist(0.8), "0.8 miles");
  assert.equal(cue.dist(0.1), "0.1 miles");
  assert.equal(cue.dist(450 / 5280), "450 feet");
  assert.equal(cue.dist(800 / 5280), "0.2 miles");
  assert.equal(cue.dist(500 / 5280), "500 feet");
  assert.equal(cue.dist(50 / 5280), "50 feet");
  assert.equal(cue.dist(0.004), "50 feet");
  assert.equal(cue.dist(0), "50 feet");
});

test("distance follows the route line, and the step advances to the next maneuver", function () {
  const line = [[29.76, -95.37], [29.76, -95.36], [29.75, -95.36]];
  const along = cue.miles(line, { lat: 29.76, lng: -95.37 }, 29.75, -95.36);
  const straight = cue.miles(null, { lat: 29.76, lng: -95.37 }, 29.75, -95.36);
  assert.ok(along > straight + 0.05, "along " + along + " straight " + straight);
  assert.ok(Math.abs(cue.miles(null, { lat: 29.76, lng: -95.37 }, 29.75, -95.36) - straight) < 1e-9);
  const steps = [
    { lat: 29.7604, lng: -95.3698, text: "Head out on Bagby Street", type: "depart", modifier: "" },
    { lat: 29.7600, lng: -95.3700, text: "Turn left onto McKinney Street", type: "turn", modifier: "left" },
    { lat: 29.7590, lng: -95.3684, text: "Turn right onto Smith Street", type: "turn", modifier: "right" }
  ];
  assert.equal(cue.pick(steps, { lat: 29.7604, lng: -95.3698 }), 1);
  assert.equal(cue.kind(steps[1].type, steps[1].modifier, steps[1].text), "left");
  assert.equal(cue.pick(steps, { lat: 29.76, lng: -95.37 }), 2);
  assert.equal(cue.kind(steps[2].type, steps[2].modifier, steps[2].text), "right");
  const houstonLeft = route.steps.filter(function (s) { return s.modifier === "slight left" && s.type === "merge"; })[0];
  assert.ok(houstonLeft, "recorded Houston route has a slight-left merge");
  assert.equal(cue.kind(houstonLeft.type, houstonLeft.modifier, "Merge slight left onto " + houstonLeft.name), "left");
});

test("the cue sits in both turn banners and uses the invoice green", function () {
  const sched = appSrc.slice(appSrc.indexOf("function schedTurnHtml"), appSrc.indexOf("function schedTurnMapPaint"));
  const meter = appSrc.slice(appSrc.indexOf("function meterTurnHtml"), appSrc.indexOf("function meterTurnPaint"));
  const paint = appSrc.slice(appSrc.indexOf("function schedNavPaint"), appSrc.indexOf("function schedFullKey"));
  const gps = appSrc.slice(appSrc.indexOf("function onGpsFix"), appSrc.indexOf("function fgLocateNow"));
  assert.match(sched, /navCueHtml\(kind, cueMi\)/);
  assert.match(sched, /mi to the pickup/);
  assert.doesNotMatch(sched, /In ' \+ esc\(dd\)/);
  assert.match(meter, /navCueHtml\(t\.kind, t\.mi\)/);
  assert.match(meter, /id="meter-turn"/);
  assert.equal(meter.indexOf("Invoice"), -1);
  assert.match(paint, /schedTurnMapPaint\(\)/);
  assert.match(gps, /schedNavPaint\(\)/);
  assert.match(gps, /meterTurnPaint\(\)/);
  assert.match(appSrc, /type: String\(mv\.type \|\| ""\), modifier: String\(mv\.modifier \|\| ""\)/);
  assert.ok(cue.css().indexOf("#0b6b3a") >= 0);
  assert.ok(cue.css().indexOf("#meter-map-stage .meter-turn .pcs-turn-cue{margin-left:46px}") >= 0);
  const html = cue.html("uturn", 0.8);
  assert.ok(html.indexOf('data-turn="uturn"') >= 0);
  assert.ok(html.indexOf("0.8 miles") >= 0);
  assert.ok(html.indexOf("<svg") >= 0);
  assert.ok(cue.svg("left").indexOf("rotate(-40") >= 0);
  assert.ok(cue.svg("right").indexOf("rotate(40") >= 0);
  assert.ok(cue.svg("straight").indexOf("rotate") < 0);
});

function hav(a, b) {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function pointBefore(line, dest, targetMi) {
  let bestI = 0, best = Infinity, i;
  for (i = 0; i < line.length; i += 1) {
    const d = hav(line[i], [dest.lat, dest.lng]);
    if (d < best) { best = d; bestI = i; }
  }
  let acc = 0;
  const samples = [{ lat: line[bestI][0], lng: line[bestI][1], mi: 0 }];
  for (i = bestI; i > 0; i -= 1) {
    acc += hav(line[i], line[i - 1]);
    samples.push({ lat: line[i - 1][0], lng: line[i - 1][1], mi: acc });
    if (acc > targetMi + 0.4) break;
  }
  let pick = samples[0], diff = Infinity;
  samples.forEach(function (s) {
    const got = Math.abs(s.mi - targetMi);
    if (got < diff) { diff = got; pick = s; }
  });
  return pick;
}

function banner(kind, miles, text, id) {
  return '<div id="' + id + '" role="status" style="background:#0b3d23;color:#fff;border-radius:12px;padding:10px 12px;margin:0;font-size:20px;font-weight:800">' +
    cue.html(kind, miles) + text +
    '<small style="display:block;font-size:14px;font-weight:700;color:#d1fae5;margin-top:4px">5.2 mi to the pickup · about 9 min</small></div>';
}

function page(spec) {
  const css = cue.css() +
    "html,body{margin:0;background:#d5e0ea;font-family:system-ui,-apple-system,sans-serif}" +
    "#home-map-stage,#meter-map-stage{position:relative;overflow:hidden;background:#d5e0ea}" +
    "#live-map{position:absolute;inset:0;background:#d5e0ea}" +
    ".leaflet-top,.leaflet-left{position:absolute;z-index:1005;pointer-events:none}.leaflet-control{pointer-events:auto}" +
    ".leaflet-bar a{display:block;width:30px;height:30px;line-height:30px;background:#fff;color:#000;text-align:center;text-decoration:none;border-bottom:1px solid #ccc;font-weight:700}" +
    "#home-map-stage.pcs-fullmap .leaflet-top.leaflet-left{top:calc(var(--sched-fs-top, 150px) + 12px) !important;left:10px !important}" +
    "#sched-fs-top{position:absolute;left:8px;right:8px;top:8px;z-index:1002}" +
    "#sched-fs-top .nav-eta{margin:8px 0 0 auto;width:max-content}" +
    ".nav-eta{background:#0b3d23;color:#fff;border:3px solid #2e9d4f;border-radius:14px;padding:8px 14px;min-width:150px;text-align:right;box-shadow:0 2px 8px rgba(0,0,0,.45);pointer-events:none}" +
    ".nav-eta-at{font-size:24px;font-weight:900;line-height:1.15}.nav-eta-left{font-size:20px;font-weight:800;color:#d1fae5}.nav-eta-to{font-size:14px;font-weight:700;color:#bef1c6}" +
    "#sched-eta-map{position:absolute;right:8px;top:8px;z-index:1001}" +
    "#sched-fs-open,#rfs-open{position:absolute;z-index:1002;width:auto;min-height:52px;margin:0;padding:10px 16px;font-size:18px;font-weight:800;border-radius:12px;border:2px solid #0b3d23;background:#d1fae5;color:#0b3d23}" +
    "#sched-fs-open{left:8px;top:8px}#rfs-open{left:8px;bottom:34px}" +
    "#sched-fs-bottom,#rfs-bar{position:absolute;left:8px;right:8px;bottom:22px;z-index:1002;display:flex;flex-direction:column;gap:8px}" +
    ".pcs-map-green{display:block;width:100%;box-sizing:border-box;min-height:62px;margin:0;padding:8px 12px;font-size:18px;font-weight:800;text-align:center;background:#0b6b3a;color:#fff;border:2px solid #fff;border-radius:14px}" +
    "#sched-fs-close,#rfs-close{display:block;width:100%;min-height:58px;font-size:20px;font-weight:800;background:#d1fae5;color:#0b3d23;border:3px solid #0b3d23;border-radius:14px}" +
    ".rfs-end{display:block;width:100%;min-height:62px;font-size:24px;font-weight:900;border-radius:14px;background:#8b1c1c;color:#fff;border:3px solid #5c0f0f}" +
    ".rfs-actions{display:flex;gap:8px}.rfs-actions .rfs-end{flex:2}.rfs-actions .rfs-close{flex:1;width:auto}" +
    ".fs-mph{position:absolute;left:10px;bottom:172px;z-index:1003;min-width:86px;padding:6px 10px 5px;background:#fff;color:#0b3d23;border:3px solid #0b3d23;border-radius:16px;text-align:center;pointer-events:none}" +
    ".fs-mph b{display:block;font-size:40px;line-height:1;font-weight:900}.fs-mph span{display:block;font-size:14px;font-weight:900}" +
    ".nav-toggle{position:absolute;right:8px;z-index:1004;display:flex;gap:6px}" +
    ".nav-toggle button{padding:6px 12px;border-radius:999px;border:2px solid #fff;background:#20371d;color:#cdeccd;font-weight:800;font-size:14px}" +
    "#pcs-sos-btn{position:absolute;right:12px;z-index:1006;width:64px;height:64px;border-radius:50%;border:3px solid #fff;background:#b91c1c;color:#fff;font-weight:900}" +
    ".meter-topstack{position:absolute;left:8px;right:8px;top:8px;z-index:900;display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none}" +
    ".meter-turn{position:static;align-self:stretch;background:#20371d;color:#cdeccd;border-radius:10px;padding:8px 12px;font-weight:800;font-size:18px;line-height:1.25;box-shadow:0 2px 8px rgba(0,0,0,.35)}" +
    "#card-banner{flex:0 0 auto;padding:8px;background:#eef6f0}";
  const eta = '<div id="' + spec.etaId + '" class="nav-eta" role="status"><div class="nav-eta-at">Arrive 1:55 PM</div><div class="nav-eta-left">9 min · 5.2 mi</div><div class="nav-eta-to">' + spec.etaTo + "</div></div>";
  const toggles = '<div class="nav-toggle" style="bottom:' + spec.toggleBottom + '"><button type="button" id="map-orient-toggle">Heading up</button><button type="button" id="map-mode-toggle">Full route</button></div>';
  let stage = "";
  if (spec.map === "pickup-full") {
    stage = '<div id="home-map-stage" class="pcs-fullmap" style="width:' + spec.w + 'px;height:' + spec.h + 'px">' +
      '<div id="live-map"></div><div id="sched-fs-top">' + banner(spec.kind, spec.miles, spec.text, "sched-turn-fs") + eta + "</div>" +
      toggles +
      '<div id="fs-mph" class="fs-mph"><b>32</b><span>MPH</span></div>' +
      '<div id="sched-fs-bottom"><div id="sched-fs-arrived" class="pcs-map-green">I\u2019m at the pickup<div id="sched-fs-inv">Invoice #000584 \u00b7 Paid \u00b7 View receipt</div></div><button type="button" id="sched-fs-close">Close map</button></div>' +
      '<button type="button" id="pcs-sos-btn">SOS</button></div>';
  } else if (spec.map === "pickup-small") {
    stage = '<div style="width:' + spec.w + 'px;height:' + spec.h + 'px;display:flex;flex-direction:column"><div id="home-map-stage" style="flex:1;min-height:0">' +
      '<div id="live-map"></div><button type="button" id="sched-fs-open">Full screen map</button>' + eta +
      '<div id="sched-turn-map" class="pcs-turn-float">' + cue.html(spec.kind, spec.miles) + "</div>" + toggles +
      '</div><div id="card-banner">' + banner(spec.kind, spec.miles, spec.text, "sched-turn") + "</div></div>";
  } else if (spec.map === "ride-small") {
    stage = '<div id="meter-map-stage" style="width:' + spec.w + 'px;height:' + spec.h + 'px"><div id="live-map"></div>' +
      '<div class="meter-topstack" id="meter-topstack"><div class="meter-turn" id="meter-turn">' + cue.html(spec.kind, spec.miles) + spec.text + "</div>" + eta + "</div>" +
      '<button type="button" id="rfs-open">Full screen</button>' + toggles + "</div>";
  } else {
    stage = '<div id="meter-map-stage" class="pcs-rfs" style="width:' + spec.w + 'px;height:' + spec.h + 'px"><div id="live-map"></div>' +
      '<div class="meter-topstack" id="meter-topstack"><div class="meter-turn" id="meter-turn">' + cue.html(spec.kind, spec.miles) + spec.text + "</div>" + eta + "</div>" +
      toggles +
      '<div id="fs-mph" class="fs-mph"><b>32</b><span>MPH</span></div>' +
      '<div id="rfs-bar"><div id="rfs-green" class="pcs-map-green">Invoice #000584 \u00b7 Paid \u00b7 View receipt</div>' +
      '<div class="rfs-actions"><button type="button" class="rfs-end" id="rfs-end">End ride</button><button type="button" id="rfs-close" class="rfs-close">Close map</button></div></div>' +
      '<button type="button" id="pcs-sos-btn">SOS</button></div>';
  }
  return "<!doctype html><html><head><meta charset=\"utf-8\"><link rel=\"stylesheet\" href=\"leaflet.css\"><style>" + css + "</style></head><body>" + stage +
    "<script src=\"leaflet.js\"></script><script>var line = " + JSON.stringify(route.line) + "; var car = " + JSON.stringify(spec.car) + "; var focus = " + JSON.stringify(spec.focus) + ";" +
    "var map = L.map('live-map', { zoomControl: true, attributionControl: false });" +
    "L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);" +
    "L.polyline(line, { color: '#1E88FF', weight: 6 }).addTo(map);" +
    "L.circleMarker([car.lat, car.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#0b6b3a', fillOpacity: 1 }).addTo(map);" +
    "map.fitBounds(focus, { padding: [30, 30], maxZoom: 15, animate: false });" +
    "var bannerEl = document.getElementById('sched-fs-top'); var stage = document.getElementById('home-map-stage') || document.getElementById('meter-map-stage');" +
    "if (bannerEl && stage) stage.style.setProperty('--sched-fs-top', bannerEl.offsetHeight + 'px');" +
    "var zoom = document.querySelector('#home-map-stage.pcs-fullmap .leaflet-top.leaflet-left');" +
    "if (zoom && bannerEl) zoom.style.setProperty('top', (bannerEl.offsetHeight + 16) + 'px', 'important');" +
    "var sos = document.getElementById('pcs-sos-btn'); if (sos) { var stack = document.getElementById('sched-fs-top') || document.getElementById('meter-topstack'); sos.style.top = Math.round((stack ? stack.getBoundingClientRect().bottom : 120) + 16) + 'px'; }" +
    "function box(id){var n=document.getElementById(id); if(!n) return null; var r=n.getBoundingClientRect(); if(r.width<2||r.height<2) return null; return {id:id,left:r.left,top:r.top,right:r.right,bottom:r.bottom};}" +
    "function hit(a,b){return !(a.right<=b.left+1||a.left>=b.right-1||a.bottom<=b.top+1||a.top>=b.bottom-1);}" +
    "var cues=[].slice.call(document.querySelectorAll('.pcs-turn-cue')).map(function(n){var r=n.getBoundingClientRect(); var bg=getComputedStyle(n).backgroundColor; var arrow=n.querySelector('.pcs-turn-arrow'); var ar=arrow.getBoundingClientRect(); return {turn:n.getAttribute('data-turn'),text:n.querySelector('.pcs-turn-dist').textContent,bg:bg,aw:Math.round(ar.width),ah:Math.round(ar.height),left:r.left,top:r.top,right:r.right,bottom:r.bottom};});" +
    "var watch=" + JSON.stringify(spec.watch) + "; var hits=[]; cues.forEach(function(c){ watch.forEach(function(id){ var b=box(id); if(b && hit(c,b)) hits.push(c.turn+' '+id); }); });" +
    "document.body.dataset.report=JSON.stringify({hits:hits,cues:cues,zoom:!!document.querySelector('.leaflet-control-zoom')});" +
    "</script></body></html>";
}

const SIZES = [{ w: 375, h: 667, name: "375x667" }, { w: 430, h: 932, name: "430x932" }, { w: 820, h: 1180, name: "820x1180" }];
const MAPS = ["pickup-full", "pickup-small", "ride-full", "ride-small"];

function maneuvers() {
  const by = {};
  route.steps.forEach(function (s) { by[s.type + "|" + s.modifier] = s; });
  const merge = route.steps.filter(function (s) { return s.type === "merge" && s.modifier === "slight left"; })[0];
  const ramp = route.steps.filter(function (s) { return s.type === "off ramp" && s.modifier === "slight right"; })[0];
  const smith = route.steps.filter(function (s) { return s.name === "Smith Street" && s.modifier === "right"; })[0];
  return {
    left: { kind: "left", miles: 0.8, text: "Merge slight left onto Southwest Freeway", dest: merge, label: "left-0.8miles" },
    right: { kind: "right", miles: 0.8, text: "Take the exit on the right", dest: ramp, label: "right-0.8miles" },
    uturn: { kind: "uturn", miles: 0.4, text: "Make a U-turn onto Smith Street", dest: { lat: smith.lat, lng: smith.lng }, label: "uturn" },
    feet450: { kind: "left", miles: 450 / 5280, text: "Merge slight left onto Southwest Freeway", dest: merge, label: "450feet" },
    feet50: { kind: "left", miles: 50 / 5280, text: "Merge slight left onto Southwest Freeway", dest: merge, label: "50feet" }
  };
}

test("four driver maps keep the arrow clear of the other controls", async function () {
  const moves = maneuvers();
  const shots = [];
  SIZES.forEach(function (size) {
    MAPS.forEach(function (map) { shots.push({ size: size, map: map, move: moves.left }); });
  });
  const big = SIZES[1];
  ["right", "uturn", "feet450", "feet50"].forEach(function (key) {
    MAPS.forEach(function (map) { shots.push({ size: big, map: map, move: moves[key] }); });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-turn-"));
  fs.copyFileSync("/tmp/leaflet/leaflet.js", path.join(dir, "leaflet.js"));
  fs.copyFileSync("/tmp/leaflet/leaflet.css", path.join(dir, "leaflet.css"));
  const port = 8798;
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=900,1300", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  const outDir = "/opt/cursor/artifacts/v2.0m-bt";
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
  try {
    let ver;
    for (let i = 0; i < 40 && !ver; i += 1) {
      try { ver = await fetch("http://127.0.0.1:" + (port + 100) + "/json/version").then(function (r) { return r.json(); }); } catch (e) { await wait(200); }
    }
    assert.ok(ver && ver.webSocketDebuggerUrl, "chrome did not start");
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    const pending = new Map();
    let seq = 0;
    ws.onmessage = function (ev) {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
    function send(method, params, sessionId) {
      const id = ++seq;
      return new Promise(function (resolve) {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id: id, sessionId: sessionId, method: method, params: params || {} }));
      });
    }
    const created = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
    const sid = attached.result.sessionId;
    await send("Page.enable", {}, sid);
    await send("Runtime.enable", {}, sid);
    for (let n = 0; n < shots.length; n += 1) {
      const shot = shots[n];
      const car = pointBefore(route.line, shot.move.dest, shot.move.miles);
      const miles = shot.move.miles;
      const focus = route.line.filter(function (p) {
        return Math.abs(p[0] - car.lat) < 0.03 && Math.abs(p[1] - car.lng) < 0.04;
      });
      if (focus.length < 2) focus.push([car.lat, car.lng], [shot.move.dest.lat, shot.move.dest.lng]);
      const watch = {
        "pickup-full": ["sched-eta-fs", "map-orient-toggle", "map-mode-toggle", "fs-mph", "sched-fs-arrived", "sched-fs-close", "pcs-sos-btn"],
        "pickup-small": ["sched-eta-map", "sched-fs-open", "map-orient-toggle", "map-mode-toggle"],
        "ride-full": ["meter-eta-box", "map-orient-toggle", "map-mode-toggle", "fs-mph", "rfs-green", "rfs-end", "rfs-close", "pcs-sos-btn"],
        "ride-small": ["meter-eta-box", "rfs-open", "map-orient-toggle", "map-mode-toggle"]
      }[shot.map];
      const html = page({
        map: shot.map, w: shot.size.w, h: shot.size.h, kind: shot.move.kind, miles: miles, text: shot.move.text,
        etaId: shot.map.indexOf("ride") === 0 ? "meter-eta-box" : (shot.map === "pickup-full" ? "sched-eta-fs" : "sched-eta-map"),
        etaTo: shot.map.indexOf("ride") === 0 ? "to drop-off" : "to pickup",
        toggleBottom: shot.map.indexOf("full") >= 0 ? "calc(22px + 150px + 14px)" : "40px",
        car: car, focus: focus, watch: watch
      });
      const name = shot.map + "-" + shot.size.name + "-" + shot.move.label + ".html";
      fs.writeFileSync(path.join(dir, name), html);
      await send("Emulation.setDeviceMetricsOverride", { width: shot.size.w, height: shot.size.h, deviceScaleFactor: 1, mobile: shot.size.w < 800 }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + name }, sid);
      let report = "";
      for (let i = 0; i < 40 && !report; i += 1) {
        const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(150);
      }
      assert.ok(report, name + " did not report");
      const got = JSON.parse(report);
      assert.equal(got.hits.length, 0, name + " arrow covers " + got.hits.join(", "));
      assert.ok(got.cues.length >= 1, name + " missing arrow");
      got.cues.forEach(function (c) {
        assert.equal(c.turn, shot.move.kind, name);
        assert.equal(c.bg.replace(/\s/g, ""), "rgb(11,107,58)", name + " green");
        assert.ok(c.aw >= 52 && c.aw <= 64, name + " arrow width " + c.aw);
        assert.ok(c.ah >= 52 && c.ah <= 64, name + " arrow height " + c.ah);
      });
      if (shot.move.label === "left-0.8miles") assert.ok(got.cues[0].text.indexOf("miles") >= 0, got.cues[0].text);
      if (shot.move.label === "450feet" || shot.move.label === "50feet") assert.ok(/feet$/.test(got.cues[0].text), got.cues[0].text);
      await wait(400);
      const pic = await send("Page.captureScreenshot", { format: "png" }, sid);
      const file = path.join(outDir, shot.map + "-" + shot.size.name + "-" + shot.move.label + ".png");
      fs.writeFileSync(file, Buffer.from(pic.result.data, "base64"));
      assert.ok(fs.statSync(file).size > 5000, file);
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
