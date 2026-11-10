/* SOS on the scheduled to-pickup full map sits above that map, under the Arrive card. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
const RIDE_RULE = "body.pcs-rfs-body #pcs-sos-btn{z-index:2147482100 !important;bottom:auto !important;right:12px !important;top:250px;top:var(--pcs-sos-top,calc(env(safe-area-inset-top,0px) + 250px))}";
const PICKUP_RULE = RIDE_RULE.replace("body.pcs-rfs-body", "body.pcs-fullmap-body");

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

function quotedAll(fnSrc) {
  const parts = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(fnSrc))) parts.push(m[1].replace(/\\"/g, '"'));
  return parts.join("");
}

test("to-pickup full map raises SOS the same way the in-ride map does", function () {
  const fullFn = src.slice(src.indexOf("function schedFullStyle"), src.indexOf("function schedFullResize"));
  const apply = src.slice(src.indexOf("function schedFullApply"), src.indexOf("function fsSpeedOnGps"));
  const rideCss = src.slice(src.indexOf("function fsStyle"), src.indexOf("function rfsKey"));
  const sos = src.slice(src.indexOf("function ensureSosButton"), src.indexOf("function openSosFlow"));
  assert.ok(rideCss.indexOf(RIDE_RULE) >= 0, "in-ride SOS rule changed");
  assert.equal(rideCss.indexOf("pcs-fullmap-body"), -1);
  assert.ok(fullFn.indexOf(PICKUP_RULE) >= 0, "to-pickup SOS rule missing");
  assert.ok(apply.indexOf('classList.toggle("pcs-fullmap-body", !!full)') >= 0);
  assert.ok(apply.indexOf('classList.remove("pcs-fullmap-body")') >= 0);
  assert.ok(sos.indexOf("z-index:10040") >= 0);
  assert.ok(sos.indexOf("width:64px;height:64px") >= 0);
  assert.ok(sos.indexOf('b.innerHTML = "ALERT<br>SOS"') >= 0);
  assert.equal(src.indexOf("pcs-fullmap-body #pcs-sos-btn"), src.lastIndexOf("pcs-fullmap-body #pcs-sos-btn"));
});

function page(w, h, paid) {
  const sosFn = src.slice(src.indexOf("function ensureSosButton"), src.indexOf("function openSosFlow"));
  const sosStart = sosFn.indexOf('"#pcs-sos-btn{');
  const sosMark = 'display:none!important}"';
  const sosEnd = sosFn.indexOf(sosMark, sosStart);
  const sosCss = quotedAll(sosFn.slice(sosStart, sosEnd + sosMark.length));
  assert.ok(sosStart >= 0 && sosEnd > sosStart && sosCss.indexOf("width:64px;height:64px") >= 0, "SOS css");
  const css = quotedCss(src.slice(src.indexOf("function schedFullStyle"), src.indexOf("function schedFullResize"))) +
    quotedCss(src.slice(src.indexOf("function navEtaStyle"), src.indexOf("function schedEtaNums"))) +
    quotedCss(src.slice(src.indexOf("function fsStyle"), src.indexOf("function rfsKey"))) +
    sosCss;
  const inv = paid
    ? 'Invoice #000554 \u00b7 Paid \u00b7 <a id="sched-inv-link" href="https://squareup.com/receipt/rcpt-554" target="_blank" rel="noopener">View receipt</a>'
    : "Invoice #000574";
  return `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <style>
      html,body{margin:0;height:100%;overflow:hidden;background:#0b3d23}
      #live-map{position:absolute;left:0;right:0;top:0;bottom:0;z-index:1;background:#c5d5c8}
      .pin-icon{background:transparent !important;border:none !important}
      .pin-float{width:88px;text-align:center}
      .pin-label{display:inline-block;padding:2px 6px;border-radius:999px;background:rgba(11,28,51,.92);border:1px solid rgba(212,177,90,.38);color:#f4efe4;font:700 11px system-ui,sans-serif}
      .pin-head{display:block;width:16px;height:16px;margin:2px auto 0;background:#f0d48a;border:2px solid #0b1c33;border-radius:50% 50% 50% 0;transform:rotate(-45deg)}
      .leaflet-container{height:100%;width:100%;overflow:hidden;background:#d5e0d4}
      .leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-map-pane svg,.leaflet-zoom-box{position:absolute;left:0;top:0}
      .leaflet-tile{width:256px;height:256px}
      .leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-marker-pane{z-index:600}.leaflet-top{position:absolute;z-index:1000;pointer-events:none}
      .leaflet-left{left:0}.leaflet-control{float:left;clear:both;pointer-events:auto}
      .leaflet-bar a{display:block;width:26px;height:26px;line-height:26px;background:#fff;color:#000;text-align:center;text-decoration:none;border-bottom:1px solid #ccc}
      ${css}
      #home-map-stage{--pcs-safe-top:0px;--pcs-safe-bottom:0px;--pcs-safe-left:0px;--pcs-safe-right:0px}
    </style></head><body>
    <div id="home-map-stage" class="pcs-fullmap">
      <div id="live-map"></div>
      <div id="sched-fs-top">
        <div id="sched-turn-fs" role="status" style="background:#0b3d23;color:#fff;border-radius:12px;padding:10px 12px;margin:0 0 8px;font-size:20px;font-weight:800">
          <small style="display:block;font-size:14px;font-weight:700;color:#d1fae5">In 0.4 mi</small>
          Turn right onto Grogan's Mill Rd
          <small style="display:block;font-size:14px;font-weight:700;color:#d1fae5;margin-top:4px">1.2 mi to the pickup \u00b7 about 4 min</small>
        </div>
        <div id="sched-eta-fs" class="nav-eta" role="status"><div class="nav-eta-at">Arrive 6:12 PM</div><div class="nav-eta-left">4 min \u00b7 1.2 mi</div><div class="nav-eta-to">to pickup</div></div>
      </div>
      <div class="nav-toggle" style="position:absolute;right:8px;display:flex;gap:6px">
        <button type="button" id="map-orient-toggle" style="width:auto;min-height:0;margin:0;padding:6px 12px;border-radius:999px;border:2px solid #fff;background:#20371d;color:#cdeccd;font-weight:800;font-size:14px">North up</button>
        <button type="button" id="map-mode-toggle" style="width:auto;min-height:0;margin:0;padding:6px 12px;border-radius:999px;border:2px solid #fff;background:#20371d;color:#cdeccd;font-weight:800;font-size:14px">Follow</button>
      </div>
      <div id="fs-mph" class="fs-mph" style="bottom:172px"><b>32</b><span>MPH</span></div>
      <div id="sched-fs-bottom">
        <div id="sched-fs-arrived" class="pcs-map-green has-inv" role="button" tabindex="0" aria-label="I\u2019m at the pickup"><span class="pcs-arrived-label">I\u2019m at the pickup</span><span class="pcs-fs-inv" id="sched-fs-inv">${inv}</span></div>
        <button type="button" id="sched-fs-close">Close map</button>
      </div>
    </div>
    <button type="button" id="pcs-sos-btn" aria-label="Alert SOS — request police help">ALERT<br>SOS</button>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      function boot() {
      if (!window.L) { setTimeout(boot, 50); return; }
      var stage = document.getElementById("home-map-stage");
      var top = document.getElementById("sched-fs-top");
      var bar = document.getElementById("sched-fs-bottom");
      stage.style.setProperty("--sched-fs-bar", bar.offsetHeight + "px");
      stage.style.setProperty("--sched-fs-top", top.offsetHeight + "px");
      var mapEl = document.getElementById("live-map");
      mapEl.style.bottom = Math.max(0, stage.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) + "px";
      var line = [[30.1582,-95.4655],[30.1594,-95.4622],[30.1611,-95.4584],[30.1632,-95.4551],[30.1648,-95.4524]];
      var map = L.map(mapEl, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap", referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);
      L.polyline(line, { color: "#0B3D91", weight: 11, opacity: 0.9, lineCap: "round", interactive: false }).addTo(map);
      L.polyline(line, { color: "#1E88FF", weight: 7, opacity: 1, lineCap: "round", interactive: false }).addTo(map);
      L.circleMarker(line[0], { radius: 9, color: "#fff", weight: 3, fillColor: "#111", fillOpacity: 1 }).addTo(map);
      L.marker(line[line.length - 1], { icon: L.divIcon({ className: "pin-icon", html: '<div class="pin-float pin-pickup"><span class="pin-label">Pickup</span><span class="pin-head"></span></div>', iconSize: [88, 46], iconAnchor: [44, 44] }), interactive: false }).addTo(map);
      map.fitBounds(line, { paddingTopLeft: [36, top.offsetHeight + 28], paddingBottomRight: [36, bar.offsetHeight + 28] });
      var zin = document.querySelector(".leaflet-control-zoom-in"), zout = document.querySelector(".leaflet-control-zoom-out");
      if (zin) zin.id = "zoom-in";
      if (zout) zout.id = "zoom-out";
      function rect(id) {
        var el = document.getElementById(id);
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      }
      function hitOf(x, y) {
        var el = document.elementFromPoint(x, y);
        return el ? (el.id || "") : "";
      }
      function sample(on) {
        document.body.classList.toggle("pcs-fullmap-body", on);
        var stack = top.getBoundingClientRect();
        if (on) document.body.style.setProperty("--pcs-sos-top", Math.round(stack.bottom + 14) + "px");
        else document.body.style.removeProperty("--pcs-sos-top");
        var b = document.getElementById("pcs-sos-btn");
        var r = b.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.min(r.width, r.height) / 2 - 6;
        var pts = [[cx, cy], [cx - d, cy], [cx + d, cy], [cx, cy - d], [cx, cy + d]];
        var st = getComputedStyle(b), stageSt = getComputedStyle(stage);
        return {
          on: on, hits: pts.map(function (p) { return hitOf(Math.round(p[0]), Math.round(p[1])); }),
          z: st.zIndex, stageZ: stageSt.zIndex, bg: st.backgroundColor, w: Math.round(r.width), h: Math.round(r.height),
          text: (b.innerText || "").replace(/\\s+/g, " ").trim(),
          sos: rect("pcs-sos-btn"), stage: rect("home-map-stage"), pos: getComputedStyle(stage).position, eta: rect("sched-eta-fs"), turn: rect("sched-turn-fs"),
          follow: rect("map-mode-toggle"), zoom: rect("zoom-out") || rect("zoom-in"), arrived: rect("sched-fs-arrived"),
          close: rect("sched-fs-close"), vw: window.innerWidth, vh: window.innerHeight
        };
      }
      var off = sample(false), on = sample(true);
      document.body.dataset.report = JSON.stringify({ off: off, on: on });
      }
      boot();
    </script></body></html>`;
}

function overlaps(a, b) {
  if (!a || !b) return false;
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

test("SOS is above the to-pickup full map and not covered", { timeout: 90000 }, async function () {
  const port = 8812;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-sos-map-"));
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), page(820, 1180, false));
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
    "--window-size=900,1300", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
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
      return new Promise(function (resolve, reject) {
        pending.set(id, function (msg) { if (msg.error) reject(new Error(method + " " + JSON.stringify(msg.error))); else resolve(msg); });
        ws.send(JSON.stringify({ id: id, sessionId: sessionId, method: method, params: params || {} }));
      });
    }
    const created = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
    const sid = attached.result.sessionId;
    await send("Page.enable", {}, sid);
    await send("Runtime.enable", {}, sid);
    async function ev(expr) {
      const msg = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid);
      return msg.result && msg.result.result ? msg.result.result.value : "";
    }
    const shots = [[820, 1180, false], [768, 1024, false], [645, 1000, true]];
    for (const pair of shots) {
      const w = pair[0], h = pair[1], paid = pair[2];
      fs.writeFileSync(path.join(dir, w + ".html"), page(w, h, paid));
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + w + ".html" }, sid);
      let report = "";
      for (let i = 0; i < 40 && !report; i++) {
        report = await ev("document.body && document.body.dataset.report || ''");
        if (!report) await wait(200);
      }
      assert.ok(report, w + " did not report");
      const got = JSON.parse(report);
      assert.equal(got.off.z, "10040", w + " default SOS z-index");
      assert.ok(Number(got.off.stageZ) > Number(got.off.z), w + " map is not above the default SOS button");
      assert.ok(got.off.hits.indexOf("pcs-sos-btn") === -1, w + " default SOS is not covered: " + got.off.hits.join(","));
      assert.ok(Number(got.on.z) > Number(got.on.stageZ), w + " SOS z-index " + got.on.z + " is not above the map " + got.on.stageZ);
      got.on.hits.forEach(function (id) { assert.equal(id, "pcs-sos-btn", w + " SOS covered, hit " + got.on.hits.join(",")); });
      assert.equal(got.on.text, "ALERT SOS");
      assert.equal(got.on.bg.replace(/\s/g, ""), "rgb(192,22,27)");
      assert.equal(got.on.w, 64);
      assert.equal(got.on.h, 64);
      assert.equal(got.on.vw, w);
      assert.equal(got.on.vh, h);
      assert.ok(got.on.zoom && got.on.zoom.width >= 40, w + " zoom missing");
      const gap = got.on.sos.top - got.on.eta.bottom;
      assert.ok(gap >= 12 && gap <= 16, w + " SOS is not under the Arrive card, gap " + gap);
      const rightGap = got.on.vw - got.on.sos.right;
      assert.ok(rightGap >= 10 && rightGap <= 14, w + " SOS right gap " + rightGap);
      assert.ok(got.on.sos.left > got.on.vw / 2, w + " SOS is not on the right");
      ["eta", "turn", "follow", "zoom", "arrived", "close"].forEach(function (key) {
        assert.equal(overlaps(got.on.sos, got.on[key]), false, w + " SOS covers " + key);
      });
      if (paid) assert.ok((await ev("document.getElementById('sched-fs-inv').textContent")).indexOf("Paid") >= 0);
      let tiles = 0;
      let tileSrc = "";
      for (let i = 0; i < 40 && tiles < 4; i++) {
        tiles = Number(await ev("document.querySelectorAll('img.leaflet-tile-loaded').length")) || 0;
        tileSrc = String(await ev("(document.querySelector('img.leaflet-tile')||{}).src||''"));
        if (tiles < 4) await wait(250);
      }
      assert.ok(tiles >= 4, w + " OpenStreetMap tiles did not load (" + tiles + ")");
      assert.ok(tileSrc.indexOf("openstreetmap.org") >= 0, w + " tile source " + tileSrc);
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }, sid);
      fs.writeFileSync("/opt/cursor/artifacts/driver-pickup-" + w + "-sos.png", Buffer.from(shot.result.data, "base64"));
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
