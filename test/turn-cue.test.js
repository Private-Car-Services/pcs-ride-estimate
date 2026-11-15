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
    ["turn", "slight left", "Keep left", "slight-left"],
    ["turn", "sharp left", "Sharp left", "sharp-left"],
    ["turn", "straight", "Continue straight", "straight"],
    ["turn", "slight right", "Slight right", "slight-right"],
    ["turn", "right", "Turn right onto Smith Street", "right"],
    ["turn", "sharp right", "Sharp right", "sharp-right"],
    ["turn", "uturn", "Make a U-turn", "uturn"],
    ["merge", "slight left", "Merge slight left onto Southwest Freeway", "slight-left"],
    ["off ramp", "slight right", "Take the exit on the right", "slight-right"],
    ["roundabout", "right", "At the roundabout, take exit 2", "right"],
    ["roundabout", "", "At the roundabout, take exit 2 onto Main", "straight"],
    ["fork", "slight right", "Keep right at the fork", "slight-right"],
    ["arrive", "left", "Arrive at the destination", "straight"],
    ["depart", "", "Head southwest on Bagby St toward McKinney St", "straight"],
    ["", "", "Turn left onto McKinney St", "left"],
    ["", "", "Turn right onto Branard St Destination will be on the right", "right"],
    ["", "", "Make a U-turn onto Smith Street", "uturn"],
    ["", "", "Slight left to stay on Southwest Freeway", "slight-left"],
    ["", "", "Keep right at the fork", "slight-right"],
    ["", "", "Merge left onto I-45", "slight-left"],
    ["", "", "Continue onto Bagby Street", "straight"],
    ["", "", "Turn left onto Fork Right Rd", "left"],
    ["", "", "Turn left onto Bayou Turnpike", "left"],
    ["", "", "Turn right onto Left Street", "right"],
    ["", "", "Make a U-turn on Bayou Turnpike", "uturn"],
    ["", "", "Make a U turn onto Smith Street", "uturn"],
    ["", "", "U TURN at the light", "uturn"],
    ["", "", "u turn", "uturn"]
  ];
  rows.forEach(function (row) {
    assert.equal(cue.kind(row[0], row[1], row[2]), row[3], row[2]);
  });
});

test("distance is miles to one decimal, then feet in steps of 50 under 0.1 mile", function () {
  assert.equal(cue.dist(1), "1 mile");
  assert.equal(cue.dist(1.04), "1 mile");
  assert.equal(cue.dist(1.2), "1.2 miles");
  assert.equal(cue.dist(1.24), "1.2 miles");
  assert.equal(cue.dist(0.8), "0.8 miles");
  assert.equal(cue.dist(0.5), "0.5 miles");
  assert.equal(cue.dist(0.1), "0.1 miles");
  assert.equal(cue.dist(100 / 5280), "100 feet");
  assert.equal(cue.dist(450 / 5280), "450 feet");
  assert.equal(cue.dist(800 / 5280), "0.2 miles");
  assert.equal(cue.dist(500 / 5280), "500 feet");
  assert.equal(cue.dist(50 / 5280), "50 feet");
  assert.equal(cue.dist(0.004), "50 feet");
  assert.equal(cue.dist(0), "50 feet");
});

test("the next maneuver is the first one ahead, and the countdown reaches the turn", function () {
  const mile = 1 / 69.172;
  function at(mi) { return [29.76 + mi * mile, -95.37]; }
  const line = [];
  let i;
  for (i = 0; i <= 200; i += 1) line.push(at(i * 0.01));
  const left = { lat: at(0.5)[0], lng: at(0.5)[1], text: "Turn left onto N 10th St", type: "turn", modifier: "left" };
  const right = { lat: at(1.2)[0], lng: at(1.2)[1], text: "Turn right onto Main St", type: "turn", modifier: "right" };
  const steps = [{ lat: at(0)[0], lng: at(0)[1], text: "Head out", type: "depart", modifier: "" }, left, right];
  function car(mi) { return { lat: at(mi)[0], lng: at(mi)[1] }; }
  const before576 = 0.5 - 576 / 5280;
  assert.equal(cue.pick(steps, car(before576), line), 1, "576 ft before the left still shows that left");
  assert.ok(Math.abs(cue.miles(line, car(before576), left.lat, left.lng) * 5280 - 576) < 40);
  const before150 = 0.5 - 150 / 5280;
  assert.equal(cue.pick(steps, car(before150), line), 1, "does not switch 150 ft early");
  const leftFt = cue.miles(line, car(before150), left.lat, left.lng) * 5280;
  assert.ok(leftFt > 120 && leftFt < 180, leftFt);
  const before30 = 0.5 - 30 / 5280;
  assert.equal(cue.pick(steps, car(before30), line), 1, "stays on this turn under 50 ft");
  assert.ok(cue.miles(line, car(before30), left.lat, left.lng) * 5280 < 50);
  assert.equal(cue.pick(steps, car(0.5 + 40 / 5280), line), 2, "switches only after the car passes the turn");
  /* a later maneuver sits close to the car as the crow flies, but it is still behind on the route */
  const bent = [];
  for (i = 0; i <= 40; i += 1) bent.push(at(i * 0.01));
  for (i = 1; i <= 5; i += 1) bent.push([at(0.4)[0], -95.37 + i * 0.0002]);
  for (i = 1; i <= 35; i += 1) bent.push([at(0.4)[0] - i * mile * 0.01, -95.37 + 0.001]);
  const leftB = { lat: at(0.25)[0], lng: at(0.25)[1], text: "Turn left onto N 10th St", type: "turn", modifier: "left" };
  const rightB = { lat: bent[bent.length - 1][0], lng: bent[bent.length - 1][1], text: "Turn right", type: "turn", modifier: "right" };
  const bentSteps = [{ lat: at(0)[0], lng: at(0)[1], text: "Head out", type: "depart", modifier: "" }, leftB, rightB];
  assert.equal(cue.pick(bentSteps, car(0.1), bent), 1, "does not jump to a later turn that is merely nearby");
});

test("the cue sits in both turn banners and uses the invoice green", function () {
  const sched = appSrc.slice(appSrc.indexOf("function schedTurnHtml"), appSrc.indexOf("function schedTurnMapPaint"));
  const meter = appSrc.slice(appSrc.indexOf("function meterTurnHtml"), appSrc.indexOf("function meterTurnPaint"));
  const paint = appSrc.slice(appSrc.indexOf("function schedNavPaint"), appSrc.indexOf("function schedFullKey"));
  const gps = appSrc.slice(appSrc.indexOf("function onGpsFix"), appSrc.indexOf("function fgLocateNow"));
  assert.match(sched, /navCueHtml\(kind, cueMi\) \+ '<span class="pcs-turn-text">'/);
  assert.match(sched, /mi to the pickup/);
  assert.match(sched, /In ' \+ esc\(dd\)/);
  assert.match(meter, /navCueHtml\(t\.kind, t\.mi\) \+ '<span class="pcs-turn-text">'/);
  assert.match(meter, /id="meter-turn"/);
  assert.equal(meter.indexOf("Invoice"), -1);
  assert.match(paint, /schedTurnHtml\(false\)/);
  assert.match(paint, /schedTurnHtml\(true\)/);
  assert.match(gps, /schedNavPaint\(\)/);
  assert.match(gps, /meterTurnPaint\(\)/);
  assert.match(appSrc, /type: String\(mv\.type \|\| ""\), modifier: String\(mv\.modifier \|\| ""\)/);
  assert.match(appSrc, /var\(--meter-banner, 96px\)/);
  assert.match(appSrc, /#rfs-open\{position:absolute;left:52px;top:calc\(var\(--meter-banner, 96px\) \+ 12px\);bottom:auto/);
  assert.equal(appSrc.indexOf("bottom:34px"), -1);
  assert.ok(cue.css().indexOf("#0b6b3a") >= 0);
  assert.equal(cue.css().indexOf("margin-left:46px"), -1);
  assert.equal(cue.css().indexOf("pcs-turn-float"), -1);
  const html = cue.html("uturn", 0.8);
  assert.ok(html.indexOf('data-turn="uturn"') >= 0);
  assert.ok(html.indexOf("0.8 miles") >= 0);
  assert.ok(html.indexOf("<svg") >= 0);
  assert.ok(cue.svg("straight").indexOf("M32 8 46 26") >= 0);
  assert.ok(cue.svg("uturn").indexOf("M22 52V30a10 10 0 0 1 20 0v10") >= 0);
  assert.ok(cue.svg("left").indexOf("A16 16 0 0 0 34 22") >= 0);
  assert.ok(cue.svg("right").indexOf("A16 16 0 0 1 30 22") >= 0);
  assert.ok(cue.svg("right").indexOf('fill="none"') >= 0);
  assert.ok(cue.svg("right").indexOf('stroke-linecap="round"') >= 0);
  assert.equal(cue.svg("left").indexOf("rotate"), -1);
  assert.equal((cue.svg("right").match(/ d="/g) || []).length, 1);
  assert.equal((cue.svg("left").match(/ d="/g) || []).length, 1);
  assert.ok(cue.svg("slight-right").indexOf("A16 16") >= 0);
  assert.ok(cue.svg("sharp-left").indexOf("A13 13") >= 0);
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

function banner(kind, miles, text, id, ride) {
  const words = '<div class="pcs-turn-row">' + cue.html(kind, miles) + '<span class="pcs-turn-text">' + text + "</span></div>";
  if (ride) return '<div class="meter-turn" id="' + id + '" role="status">' + words + "</div>";
  return '<div id="' + id + '" role="status" style="background:#0b3d23;color:#fff;border-radius:12px;padding:10px 12px;margin:0;font-size:20px;font-weight:800">' +
    words + '<small style="display:block;font-size:14px;font-weight:700;color:#d1fae5;margin-top:4px">5.2 mi to the pickup · about 9 min</small></div>';
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
    "#sched-fs-open{left:8px;top:8px}#meter-map-stage:not(.pcs-rfs) #rfs-open{left:52px;top:calc(var(--meter-banner, 96px) + 12px);bottom:auto}#meter-map-stage.pcs-rfs #rfs-open{display:none}" +
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
    stage = '<div id="home-map-stage" style="width:' + spec.w + 'px;height:' + spec.h + 'px">' +
      '<div id="live-map"></div>' + banner(spec.kind, spec.miles, spec.text, "sched-turn-map") +
      '<button type="button" id="sched-fs-open">Full screen map</button>' + eta + toggles + "</div>";
  } else if (spec.map === "ride-small") {
    stage = '<div id="meter-map-stage" style="width:' + spec.w + 'px;height:' + spec.h + 'px"><div id="live-map"></div>' +
      '<div class="meter-topstack" id="meter-topstack">' + banner(spec.kind, spec.miles, spec.text, "meter-turn", true) + eta + "</div>" +
      '<button type="button" id="rfs-open">Full screen</button>' + toggles + "</div>";
  } else {
    stage = '<div id="meter-map-stage" class="pcs-rfs" style="width:' + spec.w + 'px;height:' + spec.h + 'px"><div id="live-map"></div>' +
      '<div class="meter-topstack" id="meter-topstack">' + banner(spec.kind, spec.miles, spec.text, "meter-turn", true) + eta + "</div>" +
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
    "var bannerEl = document.getElementById('sched-fs-top') || document.getElementById('sched-turn-map') || document.getElementById('meter-topstack');" +
    "var stage = document.getElementById('home-map-stage') || document.getElementById('meter-map-stage');" +
    "if (bannerEl && stage) {" +
    "  if (stage.id === 'meter-map-stage') stage.style.setProperty('--meter-banner', bannerEl.offsetHeight + 'px');" +
    "  else if (!stage.classList.contains('pcs-fullmap')) {" +
    "    stage.style.setProperty('--sched-map-banner', (bannerEl.offsetHeight + 8) + 'px');" +
    "    var etaEl = document.getElementById('sched-eta-map');" +
    "    stage.style.setProperty('--sched-map-chrome', (bannerEl.offsetHeight + 8 + (etaEl ? etaEl.offsetHeight + 12 : 0)) + 'px');" +
    "  } else stage.style.setProperty('--sched-fs-top', bannerEl.offsetHeight + 'px');" +
    "}" +
    "var sos = document.getElementById('pcs-sos-btn'); if (sos) { var stack = document.getElementById('sched-fs-top') || document.getElementById('meter-topstack'); sos.style.top = Math.round((stack ? stack.getBoundingClientRect().bottom : 120) + 16) + 'px'; }" +
    "function box(id){var n=document.getElementById(id); if(!n) return null; var r=n.getBoundingClientRect(); if(r.width<2||r.height<2) return null; return {id:id,left:r.left,top:r.top,right:r.right,bottom:r.bottom};}" +
    "function hit(a,b){return !(a.right<=b.left+1||a.left>=b.right-1||a.bottom<=b.top+1||a.top>=b.bottom-1);}" +
    "var cues=[].slice.call(document.querySelectorAll('.pcs-turn-cue')).map(function(n){var r=n.getBoundingClientRect(); var bg=getComputedStyle(n).backgroundColor; var arrow=n.querySelector('.pcs-turn-arrow'); var ar=arrow.getBoundingClientRect(); var words=n.parentNode.querySelector('.pcs-turn-text'); var wr=words?words.getBoundingClientRect():null; var dist=n.querySelector('.pcs-turn-dist'); return {turn:n.getAttribute('data-turn'),text:dist?dist.textContent:'',instr:words?words.textContent:'',bg:bg,aw:Math.round(ar.width),ah:Math.round(ar.height),left:r.left,top:r.top,right:r.right,bottom:r.bottom,beside:!!(wr && r.right<=wr.left+2 && Math.abs(r.top-wr.top)<8)};});" +
    "var watch=" + JSON.stringify(spec.watch) + "; var hits=[]; var zoomEl=document.querySelector('.leaflet-control-zoom'); var zb=zoomEl?zoomEl.getBoundingClientRect():null;" +
    "cues.forEach(function(c){ watch.forEach(function(id){ var b=box(id); if(b && hit(c,b)) hits.push(c.turn+' '+id); }); if(zb && zb.width>2 && hit(c,{left:zb.left,top:zb.top,right:zb.right,bottom:zb.bottom})) hits.push(c.turn+' zoom'); });" +
    "document.body.dataset.report=JSON.stringify({hits:hits,cues:cues,zoom:!!zoomEl});" +
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
    left: { kind: "left", miles: 0.5, text: "Turn left onto N 10th St", dest: merge, label: "left-0.5miles" },
    feet450: { kind: "left", miles: 450 / 5280, text: "Turn left onto N 10th St", dest: merge, label: "450feet" },
    feet100: { kind: "left", miles: 100 / 5280, text: "Turn left onto N 10th St", dest: merge, label: "100feet" },
    feet50: { kind: "left", miles: 50 / 5280, text: "Turn left onto N 10th St", dest: merge, label: "50feet" },
    fork: { kind: "left", miles: 0.5, text: "Turn left onto Fork Right Rd", dest: merge, label: "fork-right" },
    bayou: { kind: "left", miles: 0.5, text: "Turn left onto Bayou Turnpike", dest: merge, label: "bayou" },
    right: { kind: "right", miles: 0.5, text: "Take the exit on the right", dest: ramp, label: "right" },
    uturn: { kind: "uturn", miles: 0.4, text: "Make a U-turn onto Smith Street", dest: { lat: smith.lat, lng: smith.lng }, label: "uturn" }
  };
}

test("four driver maps keep the arrow clear of the other controls", async function () {
  const moves = maneuvers();
  const shots = [];
  SIZES.forEach(function (size) {
    MAPS.forEach(function (map) { shots.push({ size: size, map: map, move: moves.left }); });
  });
  const big = SIZES[1];
  ["feet450", "feet100", "feet50", "fork", "bayou", "right", "uturn"].forEach(function (key) {
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
  const outDir = "/opt/cursor/artifacts/v2.0m-bu";
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
      assert.equal(got.cues.length, 1, name + " arrow count " + got.cues.length);
      got.cues.forEach(function (c) {
        assert.equal(c.turn, shot.move.kind, name);
        assert.equal(c.beside, true, name + " direction is not beside the arrow box");
        assert.equal(c.bg.replace(/\s/g, ""), "rgb(11,107,58)", name + " green");
        assert.ok(c.aw >= 52 && c.aw <= 64, name + " arrow width " + c.aw);
        assert.ok(c.ah >= 52 && c.ah <= 64, name + " arrow height " + c.ah);
      });
      if (shot.move.label === "left-0.5miles") assert.equal(got.cues[0].text, "0.5 miles");
      if (shot.move.label === "450feet") assert.equal(got.cues[0].text, "450 feet");
      if (shot.move.label === "100feet") assert.equal(got.cues[0].text, "100 feet");
      if (shot.move.label === "50feet") assert.equal(got.cues[0].text, "50 feet");
      if (shot.move.label === "fork-right" || shot.move.label === "bayou") assert.equal(got.cues[0].turn, "left");
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

test("ride-map Full screen sits beside zoom, and U turn is a U-turn", async function () {
  assert.equal(cue.kind("", "", "Make a U turn onto Smith Street"), "uturn");
  assert.equal(cue.kind("", "", "U TURN"), "uturn");
  assert.equal(cue.kind("", "", "u turn"), "uturn");
  assert.equal(cue.kind("", "", "Turn left onto Bayou Turnpike"), "left");
  const openAt = appSrc.indexOf("#rfs-open{position:absolute;left:52px");
  const openCss = appSrc.slice(openAt, appSrc.indexOf('"', openAt));
  const zoomAt = appSrc.indexOf("#meter-map-stage.pcs-rfs .leaflet-top");
  const zoomCss = appSrc.slice(zoomAt, appSrc.indexOf('"', zoomAt));
  const words = "Turn left onto<br>North 10th Street";
  function ridePage(full, w, h) {
    const banner = '<div class="meter-turn" id="meter-turn"><div class="pcs-turn-row">' + cue.html("left", 0.5) + '<span class="pcs-turn-text">' + words + "</span></div></div>";
    const eta = '<div id="meter-eta-box" class="nav-eta"><div class="nav-eta-at">Arrive 1:55 PM</div><div class="nav-eta-left">9 min · 5.2 mi</div><div class="nav-eta-to">to drop-off</div></div>';
    const stageH = full ? "100vh" : "46vh";
    return "<!doctype html><html><head><meta charset=\"utf-8\"><link rel=\"stylesheet\" href=\"leaflet.css\"><style>" +
      cue.css() + zoomCss + openCss +
      "html,body{margin:0;background:#d5e0ea}#meter-map-stage{position:relative;width:100vw;height:" + stageH + ";overflow:hidden;background:#d5e0ea}" +
      "#live-map{position:absolute;inset:0}.leaflet-top,.leaflet-left{position:absolute;pointer-events:none}.leaflet-control{pointer-events:auto}" +
      ".nav-eta{background:#0b3d23;color:#fff;border:3px solid #2e9d4f;border-radius:14px;padding:8px 14px;min-width:150px;text-align:right}" +
      ".nav-eta-at{font-size:24px;font-weight:900}.nav-eta-left{font-size:20px;font-weight:800;color:#d1fae5}.nav-eta-to{font-size:14px;font-weight:700}" +
      ".meter-topstack{position:absolute;left:8px;right:8px;top:8px;z-index:900;display:flex;flex-direction:column;align-items:flex-end;gap:6px}" +
      ".meter-turn{align-self:stretch;background:#20371d;color:#cdeccd;border-radius:10px;padding:8px 12px;font-weight:800;font-size:18px;line-height:1.25}" +
      ".nav-toggle{position:absolute;right:8px;bottom:40px;z-index:1004;display:flex;gap:6px}" +
      ".nav-toggle button{padding:6px 12px;border-radius:999px;border:2px solid #fff;background:#20371d;color:#cdeccd;font-weight:800;font-size:14px}" +
      "</style></head><body><div id=\"meter-map-stage\"" + (full ? " class=\"pcs-rfs\"" : "") + " style=\"width:" + w + "px\">" +
      "<div id=\"live-map\"></div><div class=\"meter-topstack\" id=\"meter-topstack\">" + banner + eta + "</div>" +
      "<button type=\"button\" id=\"rfs-open\">Full screen</button>" +
      "<div class=\"nav-toggle\"><button type=\"button\" id=\"map-orient-toggle\">Heading up</button><button type=\"button\" id=\"map-mode-toggle\">Full route</button></div>" +
      "</div><script src=\"leaflet.js\"></script><script>" +
      "var map=L.map('live-map',{zoomControl:true,attributionControl:false});" +
      "L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);" +
      "map.setView([29.75,-95.39],13);" +
      "var stage=document.getElementById('meter-map-stage');var stack=document.getElementById('meter-topstack');" +
      "stage.style.setProperty('--meter-banner', stack.offsetHeight+'px');" +
      "function box(n){if(!n)return null;var r=n.getBoundingClientRect();if(r.width<2||r.height<2)return null;return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}" +
      "function hit(a,b){return a.right>b.left+1&&a.left<b.right-1&&a.bottom>b.top+1&&a.top<b.bottom-1;}" +
      "var ids=['rfs-open','map-orient-toggle','map-mode-toggle'];" +
      "var nodes=ids.map(function(id){return {id:id,box:box(document.getElementById(id))};});" +
      "var zoom=document.querySelectorAll('.leaflet-control-zoom a');" +
      "nodes.push({id:'zoom-in',box:box(zoom[0])});nodes.push({id:'zoom-out',box:box(zoom[1])});" +
      "var hits=[];for(var i=0;i<nodes.length;i++)for(var j=i+1;j<nodes.length;j++){if(nodes[i].box&&nodes[j].box&&hit(nodes[i].box,nodes[j].box))hits.push(nodes[i].id+' '+nodes[j].id);}" +
      "document.body.dataset.report=JSON.stringify({hits:hits,open:!!box(document.getElementById('rfs-open')),zoom:zoom.length,boxes:nodes.map(function(n){return {id:n.id,box:n.box};})});" +
      "</script></body></html>";
  }
  const shots = [
    { full: false, w: 1024, h: 768, name: "ride-small-1024x768" },
    { full: false, w: 390, h: 844, name: "ride-small-390x844" },
    { full: false, w: 375, h: 667, name: "ride-small-375x667" },
    { full: true, w: 1024, h: 768, name: "ride-full-1024x768" },
    { full: true, w: 390, h: 844, name: "ride-full-390x844" },
    { full: true, w: 375, h: 667, name: "ride-full-375x667" }
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-rfs-"));
  fs.copyFileSync("/tmp/leaflet/leaflet.js", path.join(dir, "leaflet.js"));
  fs.copyFileSync("/tmp/leaflet/leaflet.css", path.join(dir, "leaflet.css"));
  const port = 8804;
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=1100,900", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  const outDir = "/opt/cursor/artifacts/v2.0m-bu";
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
      fs.writeFileSync(path.join(dir, shot.name + ".html"), ridePage(shot.full, shot.w, shot.h));
      await send("Emulation.setDeviceMetricsOverride", { width: shot.w, height: shot.h, deviceScaleFactor: 1, mobile: shot.w < 800 }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + shot.name + ".html" }, sid);
      let report = "";
      for (let i = 0; i < 40 && !report; i += 1) {
        const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(150);
      }
      assert.ok(report, shot.name + " did not report");
      const got = JSON.parse(report);
      assert.equal(got.hits.length, 0, shot.name + " overlap " + got.hits.join(", ") + " " + JSON.stringify(got.boxes));
      assert.equal(got.zoom, 2, shot.name);
      if (!shot.full) assert.equal(got.open, true, shot.name + " Full screen hidden");
      await wait(300);
      const pic = await send("Page.captureScreenshot", { format: "png" }, sid);
      const file = path.join(outDir, shot.name + "-zoom-fullscreen.png");
      fs.writeFileSync(file, Buffer.from(pic.result.data, "base64"));
      assert.ok(fs.statSync(file).size > 4000, file);
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
