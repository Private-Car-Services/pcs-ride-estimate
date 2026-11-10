/* Full-screen cards share the Arrive card: #0b3d23, 3px #2e9d4f, 14px corners. End ride stays red. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

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

const uniformCss = quotedCss(src.slice(src.indexOf("function navUniformStyle"), src.indexOf("function schedFullStyle")));
const fullCss = quotedCss(src.slice(src.indexOf("function schedFullStyle"), src.indexOf("function schedFullResize")));
const fsCss = quotedCss(src.slice(src.indexOf("function fsStyle"), src.indexOf("function rfsKey")));
const etaCss = quotedCss(src.slice(src.indexOf("function navEtaStyle"), src.indexOf("function schedEtaNums")));
const meterCss = quotedCss(src.slice(src.indexOf('".meter-turn{position:absolute'), src.indexOf('".meter-qr-modal')));
const sosCss = quotedAll(src.slice(src.indexOf("st.textContent =", src.indexOf("pcs-sos-style")), src.indexOf("document.head.appendChild(st)", src.indexOf("pcs-sos-style"))));
const pill = "width:auto;min-height:0;margin:0;padding:6px 12px;border-radius:999px;border:2px solid #fff;background:#20371d;color:#cdeccd;font-weight:800;font-size:14px;box-shadow:0 1px 4px rgba(0,0,0,.4)";

test("the uniform rule uses the Arrive card colors on both full maps", function () {
  assert.ok(uniformCss.indexOf("background:#0b3d23 !important") >= 0);
  assert.ok(uniformCss.indexOf("border:3px solid #2e9d4f !important") >= 0);
  assert.ok(uniformCss.indexOf("border-radius:14px !important") >= 0);
  assert.ok(uniformCss.indexOf("#sched-turn-fs") >= 0);
  assert.ok(uniformCss.indexOf(".meter-turn") >= 0);
  assert.ok(uniformCss.indexOf(".rfs-row") >= 0);
  assert.ok(uniformCss.indexOf(".rfs-toll-add") >= 0);
  assert.ok(uniformCss.indexOf("#sched-fs-arrived") >= 0);
  assert.ok(uniformCss.indexOf(".nav-toggle button") >= 0);
  assert.ok(uniformCss.indexOf("#rfs-bar .rfs-end{border-width:3px") >= 0);
  assert.equal(uniformCss.indexOf("#rfs-bar .rfs-end{background"), -1);
  assert.ok(src.indexOf("var(--rfs-top, 168px)") >= 0);
  assert.ok(src.indexOf("function rfsTopMeasure") >= 0);
});

function invoice(word, href) {
  const linked = href ? '<a href="' + href + '" style="color:#fff;font-weight:900;text-decoration:underline">' + word + "</a>" : word;
  return '<div id="nav-inv" style="display:block;width:100%;box-sizing:border-box;margin:0;padding:10px 12px;background:#0b3d23;color:#fff;border:3px solid #2e9d4f;border-radius:14px;font-family:system-ui,-apple-system,sans-serif;font-size:18px;line-height:1.35;font-weight:900;text-align:center;pointer-events:auto">Invoice #000562 · ' + linked + "</div>";
}

function page(kind, word, href) {
  const rfs = kind === "inride";
  const inv = invoice(word, href);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#123}
    .leaflet-top,.leaflet-left{position:absolute}
    .leaflet-bar a{display:block;width:44px;height:44px;line-height:44px;background:#fff;color:#000;text-align:center;text-decoration:none}
    .fs-mph{position:absolute;left:10px;z-index:1003;min-width:86px;padding:6px 10px 5px;background:#fff;color:#0b3d23;border:3px solid #0b3d23;border-radius:16px;text-align:center;font-family:system-ui,sans-serif}
    .fs-mph b{display:block;font-size:40px;line-height:1;font-weight:900}
    #live-map{position:absolute;left:0;right:0;top:0;bottom:0;z-index:1;background:#d5e3d4}
    ${etaCss}
    ${meterCss}
    ${rfs ? fsCss : fullCss}
    ${uniformCss}
    ${sosCss}
  </style>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  </head><body class="${rfs ? "pcs-rfs-body" : "pcs-fullmap-body"}">
  <button id="pcs-sos-btn" type="button">ALERT<br>SOS</button>
  <div id="${rfs ? "meter-map-stage" : "home-map-stage"}" class="${rfs ? "pcs-rfs" : "pcs-fullmap"}" style="--pcs-safe-top:24px;--pcs-safe-bottom:20px;--pcs-safe-left:0px;--pcs-safe-right:0px">
    <div id="live-map"></div>
    ${rfs
      ? '<div id="meter-topstack" class="meter-topstack"><div class="meter-turn" id="meter-turn"><small>In 0.2 mi</small>Turn left onto Player Woods Dr</div><div id="arrive-card" class="nav-eta"><div class="nav-eta-at">Arrive 10:52 AM</div><div class="nav-eta-left">15 min · 5.8 mi</div><div class="nav-eta-to">to drop-off</div></div></div>'
      : '<div id="sched-fs-top"><div id="sched-turn-fs" style="background:#0b3d23;color:#fff;border-radius:12px;padding:10px 12px;margin:0 0 8px;font-size:20px;font-weight:800">Continue onto Rayford Rd</div><div id="arrive-card" class="nav-eta"><div class="nav-eta-at">Arrive 3:40 PM</div><div class="nav-eta-left">9 min · 5 mi</div><div class="nav-eta-to">to pickup</div></div></div>'}
    <div class="nav-toggle" style="position:absolute;right:8px;display:flex;gap:6px">
      <button type="button" id="map-orient-toggle" style="${pill}">Heading up</button>
      <button type="button" id="map-mode-toggle" style="${pill}">Full route</button>
    </div>
    <button type="button" id="map-recenter" class="nav-recenter" aria-label="Re-center on my position" style="position:absolute;right:8px;bottom:84px;z-index:1001;width:48px;height:48px;min-height:0;margin:0;padding:0;border-radius:50%;border:0;background:#1f1f1f;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45);display:none;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></button>
    <div id="fs-mph" class="fs-mph"><b>32</b><span>MPH</span></div>
    ${rfs
      ? '<div id="rfs-bar"><div id="rfs-row" class="rfs-row"><div class="rfs-stats"><span><b>0.20</b> mi</span><span><b>1:13</b></span></div></div><div class="rfs-toll"><button type="button" id="rfs-toll-add" class="rfs-toll-add">Add toll</button></div>' + inv + '<div class="rfs-actions"><button type="button" class="rfs-end" id="rfs-end">End ride</button><button type="button" class="rfs-close" id="rfs-close">Close map</button></div></div>'
      : '<div id="sched-fs-bottom">' + inv + '<button type="button" class="pcs-map-green" id="sched-fs-arrived">I\u2019m at the pickup</button><button type="button" id="sched-fs-close">Close map</button></div>'}
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    try {
    var stage = document.getElementById("${rfs ? "meter-map-stage" : "home-map-stage"}");
    var bot = document.getElementById("${rfs ? "rfs-bar" : "sched-fs-bottom"}");
    var stack = document.getElementById("${rfs ? "meter-topstack" : "sched-fs-top"}");
    stage.style.setProperty("${rfs ? "--rfs-bar" : "--sched-fs-bar"}", bot.offsetHeight + "px");
    if (${rfs ? "true" : "false"}) stage.style.setProperty("--rfs-top", stack.offsetHeight + "px");
    else stage.style.setProperty("--sched-fs-top", stack.offsetHeight + "px");
    document.body.style.setProperty("--pcs-sos-top", Math.round(stack.getBoundingClientRect().bottom + 14) + "px");
    var mph = document.getElementById("fs-mph");
    mph.style.bottom = Math.round(stage.getBoundingClientRect().bottom - bot.getBoundingClientRect().top + 12) + "px";
    function box(id) {
      var el = document.getElementById(id); if (!el) return null;
      var r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    }
    function hit(a, b) {
      if (!a || !b || a.w < 1 || b.w < 1) return false;
      return !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1 || a.right <= b.left + 1 || a.left >= b.right - 1);
    }
    function skin(id) {
      var el = document.getElementById(id);
      var s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        bw: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].join(" "),
        bs: [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle].join(" "),
        bc: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor].join(" "),
        br: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].join(" "),
        ff: s.fontFamily
      };
    }
    var ids = ${rfs
      ? '["meter-turn","nav-inv","rfs-row","rfs-toll-add","map-orient-toggle","map-mode-toggle","rfs-close"]'
      : '["sched-turn-fs","nav-inv","map-orient-toggle","map-mode-toggle","sched-fs-arrived","sched-fs-close"]'};
    var loaded = 0, sent = false;
    function publish() {
      if (sent) return;
      var zoomEl = document.querySelector(".leaflet-control-zoom-out");
      if (!zoomEl || loaded < 1) return;
      sent = true;
      zoomEl.id = "zoom-out";
      var skins = {};
      ids.forEach(function (id) { skins[id] = skin(id); });
      var arrive = skin("arrive-card");
      var end = ${rfs ? "skin('rfs-end')" : "null"};
      var sos = box("pcs-sos-btn");
      var inv = box("nav-inv");
      var turn = box("${rfs ? "meter-turn" : "sched-turn-fs"}");
      var zoom = box("zoom-out");
      document.body.dataset.report = JSON.stringify({
        arrive: arrive, skins: skins, end: end,
        sosZ: parseInt(getComputedStyle(document.getElementById("pcs-sos-btn")).zIndex, 10),
        mapZ: parseInt(getComputedStyle(stage).zIndex, 10),
        inside: sos.top >= -1 && sos.left >= -1 && sos.right <= window.innerWidth + 1 && sos.bottom <= window.innerHeight + 1,
        under: sos.top >= box("${rfs ? "meter-topstack" : "sched-fs-top"}").bottom - 1,
        sosInv: hit(sos, inv),
        sosMph: hit(sos, box("fs-mph")),
        sosOrient: hit(sos, box("map-orient-toggle")),
        invMph: hit(inv, box("fs-mph")),
        invOrient: hit(inv, box("map-orient-toggle")),
        invMode: hit(inv, box("map-mode-toggle")),
        invAction: hit(inv, box("${rfs ? "rfs-end" : "sched-fs-arrived"}")),
        above: inv.bottom <= box("${rfs ? "rfs-end" : "sched-fs-arrived"}").top + 1,
        invText: document.getElementById("nav-inv").textContent,
        tiles: loaded,
        zoomTurn: hit(zoom, turn),
        zoomBelow: zoom.top >= turn.bottom - 1,
        recenterText: (document.getElementById("map-recenter").innerText || "").trim(),
        recenterDisplay: getComputedStyle(document.getElementById("map-recenter")).display
      });
    }
    var route = [[30.0792, -95.4410], [30.0834, -95.4288], [30.0881, -95.4162], [30.0936, -95.4044]];
    var map = L.map("live-map", { zoomControl: true, attributionControl: true });
    var tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
    L.polyline(route, { color: "#0B3D91", weight: 11, opacity: 0.9, lineCap: "round" }).addTo(map);
    L.polyline(route, { color: "#1E88FF", weight: 7, opacity: 1, lineCap: "round" }).addTo(map);
    L.circleMarker(route[0], { radius: 9, color: "#fff", weight: 3, fillColor: "#1E88FF", fillOpacity: 1 }).addTo(map);
    L.circleMarker(route[route.length - 1], { radius: 9, color: "#fff", weight: 3, fillColor: "#0b6b3a", fillOpacity: 1 }).addTo(map);
    map.fitBounds(route, { paddingTopLeft: [60, 210], paddingBottomRight: [60, 250] });
    tiles.on("tileload", function () { loaded += 1; });
    tiles.on("load", function () { setTimeout(publish, 250); });
    setTimeout(function () {
      if (sent) return;
      var zoomEl = document.querySelector(".leaflet-control-zoom-out");
      if (zoomEl) zoomEl.id = "zoom-out";
      if (loaded < 1) { sent = true; document.body.dataset.report = JSON.stringify({ error: "no map tiles loaded" }); return; }
      publish();
    }, 7000);
    } catch (err) { document.body.dataset.report = JSON.stringify({ error: String(err && err.stack || err) }); }
  </script></body></html>`;
}

test("full-screen cards share the Arrive card chrome at iPad widths", async function () {
  const port = 8823;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-uniform-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
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
      return new Promise(function (resolve) { pending.set(id, resolve); ws.send(JSON.stringify({ id: id, sessionId: sessionId, method: method, params: params || {} })); });
    }
    const created = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
    const sid = attached.result.sessionId;
    await send("Page.enable", {}, sid);
    await send("Runtime.enable", {}, sid);
    const shots = [];
    ["pickup", "inride"].forEach(function (kind) {
      [[820, 1180], [768, 1024], [645, 1000]].forEach(function (size) {
        ["Unpaid", "Paid"].forEach(function (word) {
          const href = word === "Paid" ? "https://squareup.com/receipt/preview/rcpt-562" : "https://squareup.com/pay-invoice/inv-562";
          shots.push([kind, size[0], size[1], word, href, "driver-" + kind + "-" + size[0] + "-" + word.toLowerCase() + ".png"]);
        });
      });
    });
    for (let n = 0; n < shots.length; n++) {
      const row = shots[n];
      const file = "u-" + n + ".html";
      fs.writeFileSync(path.join(dir, file), page(row[0], row[3], row[4]));
      await send("Emulation.setDeviceMetricsOverride", { width: row[1], height: row[2], deviceScaleFactor: 1, mobile: true }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + file }, sid);
      let report = "";
      for (let i = 0; i < 50 && !report; i++) {
        const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(200);
      }
      const label = row[0] + " " + row[1] + "x" + row[2] + " " + row[3];
      assert.ok(report, label + " did not report");
      const got = JSON.parse(report);
      assert.equal(got.error || "", "", label + " " + (got.error || ""));
      const ref = got.arrive;
      assert.equal(ref.bg, "rgb(11, 61, 35)", label + " arrive background");
      assert.ok(ref.bc.indexOf("rgb(46, 157, 79)") >= 0, label + " arrive border " + ref.bc);
      assert.equal(ref.bw, "3px 3px 3px 3px", label + " arrive border width");
      assert.equal(ref.br, "14px 14px 14px 14px", label + " arrive radius");
      Object.keys(got.skins).forEach(function (id) {
        const skin = got.skins[id];
        assert.equal(skin.bg, ref.bg, label + " " + id + " background " + skin.bg);
        assert.equal(skin.bw, ref.bw, label + " " + id + " border width");
        assert.equal(skin.bs, ref.bs, label + " " + id + " border style");
        assert.equal(skin.bc, ref.bc, label + " " + id + " border color");
        assert.equal(skin.br, ref.br, label + " " + id + " radius");
        assert.equal(skin.ff, ref.ff, label + " " + id + " font");
      });
      if (got.end) {
        assert.equal(got.end.bw, ref.bw, label + " end ride border width");
        assert.equal(got.end.br, ref.br, label + " end ride radius");
        assert.notEqual(got.end.bg, ref.bg, label + " end ride should stay red");
        assert.ok(got.end.bg.indexOf("139, 28, 28") >= 0, label + " end ride " + got.end.bg);
      }
      assert.ok(got.sosZ > got.mapZ, label + " SOS z");
      assert.equal(got.inside, true, label + " SOS off screen");
      assert.equal(got.under, true, label + " SOS not under Arrive");
      assert.equal(got.sosInv, false, label + " SOS covers invoice");
      assert.equal(got.sosMph, false, label + " SOS covers MPH");
      assert.equal(got.sosOrient, false, label + " SOS covers Heading up");
      assert.equal(got.invMph, false, label + " invoice covers MPH");
      assert.equal(got.invOrient, false, label + " invoice covers Heading up");
      assert.equal(got.invMode, false, label + " invoice covers Full route");
      assert.equal(got.invAction, false, label + " invoice covers the action");
      assert.equal(got.above, true, label + " invoice is not above the action");
      assert.ok(got.invText.indexOf("Invoice #000562 · " + row[3]) >= 0, got.invText);
      assert.ok(got.tiles >= 1, label + " map tiles did not load");
      assert.equal(got.zoomTurn, false, label + " zoom covers the turn card");
      assert.equal(got.zoomBelow, true, label + " zoom is not below the turn card");
      assert.equal(got.recenterText, "", label + " recenter has clipped text");
      assert.equal(got.recenterDisplay, "none", label + " recenter is showing during Follow");
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      const out = "/opt/cursor/artifacts/" + row[5];
      fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
      const packed = out + ".q.png";
      spawnSync("pngquant", ["--quality=50-75", "--speed", "1", "--force", "--output", packed, out], { stdio: "ignore" });
      if (fs.existsSync(packed)) { fs.renameSync(packed, out); }
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
