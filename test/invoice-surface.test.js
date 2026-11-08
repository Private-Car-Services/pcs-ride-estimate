/* The rider line is the phone-number slot. It has to be the element under the tap
   in pickup, active, and both fullscreens, and it must not cover Follow, zoom, or End ride.
   Screenshots are the browser viewport. Nothing here scrolls the line into view. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const appSrc = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

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

const fullCss = quotedCss(appSrc.slice(appSrc.indexOf("function schedFullStyle"), appSrc.indexOf("function schedFullResize"))) +
  quotedCss(appSrc.slice(appSrc.indexOf("function fsStyle"), appSrc.indexOf("function rfsKey"))) +
  quotedCss(appSrc.slice(appSrc.indexOf("function ensureMeterSplitStyle"), appSrc.indexOf("function meterOnMap")));

function lineHtml(ride) {
  if (ride === "574") {
    return '<p id="sched-rider-line" class="pcs-ride-line" style="margin:0;min-height:44px;box-sizing:border-box;padding:8px 10px;background:#fff;color:#1a1a1a;border-radius:10px;font-size:16px;font-weight:700;line-height:1.35;white-space:normal;overflow:visible">Rider: Mike Camara · <a id="sched-rider-phone" href="tel:5550102">555-0102</a></p>';
  }
  return '<p id="sched-rider-line" class="pcs-ride-line" style="margin:0;min-height:44px;box-sizing:border-box;padding:8px 10px;background:#fff;color:#1a1a1a;border-radius:10px;font-size:16px;font-weight:700;line-height:1.35;white-space:normal;overflow:visible">Rider: Rahual · <a id="sched-rider-phone" href="tel:5550100">555-0100</a></p>';
}

function controls() {
  return '<div class="leaflet-top leaflet-left"><div class="leaflet-control-zoom leaflet-bar"><a id="zoom-in" href="#">+</a><a id="zoom-out" href="#">−</a></div></div>' +
    '<div class="nav-toggle" style="position:absolute;bottom:40px;right:8px;z-index:1000;display:flex;gap:6px"><button type="button" id="map-orient-toggle" style="padding:6px 12px">North</button><button type="button" id="map-mode-toggle" style="padding:6px 12px">Follow</button></div>' +
    '<button type="button" class="nav-recenter" id="map-recenter" style="position:absolute;right:8px;bottom:84px;z-index:1001;width:48px;height:48px">Center</button>';
}

function page(mode, ride) {
  const line = lineHtml(ride);
  const card = '<section id="sched-sec"><button type="button" id="sched-sec-head" style="display:block;width:100%;height:44px">Scheduled rides</button><div id="sched-sec-body"><article class="card" style="padding:12px"><div id="sched-rider-home">' + (mode === "pickup" ? line : "") + '</div><button type="button" id="sched-arrived" style="display:block;width:100%;height:58px;margin-top:8px">I’m at the pickup</button></article></div></section>';
  const home = mode === "active" || mode === "active-fs" ? "" : (
    '<div id="home-chrome" style="height:96px;background:#102418;color:#fff;padding:8px">Available</div>' +
    '<div id="home-map-stage" class="map-stage board-map home-map' + (mode === "pickup-fs" ? " pcs-fullmap" : "") + '" style="background:#0b3d23;position:relative">' +
    '<div id="live-map" style="background:#14301c"></div>' +
    (mode === "pickup-fs" ? controls() + '<div id="sched-fs-bottom">' + line + '<button type="button" id="sched-fs-arrived" class="pcs-map-green">I’m at the pickup</button><button type="button" id="sched-fs-close">Close map</button></div>' : '<p class="map-caption">You are here</p>') +
    "</div>" + card);
  const active = mode === "active" || mode === "active-fs" ? (
    '<div class="meter-split" id="meter-split-run"><div class="meter-map-col"><div id="meter-map-stage" class="map-stage board-map' + (mode === "active-fs" ? " pcs-rfs" : "") + '" style="background:#0b3d23;position:relative">' +
    '<div id="live-map" style="background:#14301c"></div>' + controls() +
    (mode === "active-fs" ? '<div id="rfs-bar">' + line + '<div class="rfs-row"><span>1.20 mi</span></div><div class="rfs-actions"><button type="button" class="rfs-end" id="rfs-end">End ride</button><button type="button" class="rfs-close" id="rfs-close">Close map</button></div></div>' : "") +
    '</div><div id="meter-ride-line">' + (mode === "active" ? line : "") + '</div></div><section id="meter-running"><button type="button" id="meter-end">End ride</button></section></div>'
  ) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#08140c;color:#111}
    .leaflet-top{position:absolute;z-index:1000}.leaflet-left{left:0}.leaflet-top.leaflet-left{top:0}
    .leaflet-control-zoom a{display:block;width:44px;height:44px;background:#fff;color:#111;text-align:center;line-height:44px;text-decoration:none}
    .map-stage.board-map{min-height:360px;background:#0b3d23}
    .map-stage.board-map #live-map{position:absolute;inset:0;z-index:1;min-height:0;height:100%}
    #meter-split-run .map-stage.board-map{height:46vh;height:46dvh;min-height:240px}
    #meter-split-run .meter-map-col:has(#sched-rider-line) .map-stage.board-map{height:calc(46vh - 52px);height:calc(46dvh - 52px);min-height:188px;overflow:hidden}
    #meter-split-run .meter-map-col:has(#sched-rider-line) #live-map{min-height:0}
    .meter-split{display:flex;flex-direction:column;gap:8px}
    #meter-split-run>.meter-map-col{order:-1}
    ${fullCss}
  </style></head><body>
  ${home}${active}
  <script>
    var st = document.getElementById("home-map-stage") || document.getElementById("meter-map-stage");
    var homeStage = document.getElementById("home-map-stage");
    if (homeStage && !homeStage.classList.contains("pcs-fullmap")) {
      var vh = window.innerHeight;
      var top = homeStage.getBoundingClientRect().top;
      var sh = document.getElementById("sched-sec-head");
      var sb = document.getElementById("sched-sec-body");
      var foot = 26 + (sh ? sh.offsetHeight + 12 : 0);
      var h = Math.max(220, Math.round(vh - top - foot));
      if (sh && sb && !sb.hidden) h = Math.max(220, Math.min(h, Math.round(vh * 0.5)));
      homeStage.style.height = h + "px";
      var lm0 = homeStage.querySelector("#live-map"); if (lm0) lm0.style.height = Math.max(0, h - 18) + "px";
    }
    function reserve(stage, dockId, mapId) {
      var dock = document.getElementById(dockId), map = stage ? stage.querySelector(mapId) : null;
      if (!stage || !dock || !map) return 0;
      var n = Math.max(0, Math.round(stage.getBoundingClientRect().bottom - dock.getBoundingClientRect().top));
      map.style.height = Math.max(120, stage.clientHeight - n) + "px";
      map.style.minHeight = "0";
      return n;
    }
    if (homeStage && homeStage.classList.contains("pcs-fullmap")) {
      var bot = document.getElementById("sched-fs-bottom");
      if (bot) homeStage.style.setProperty("--sched-fs-bar", bot.offsetHeight + "px");
      reserve(homeStage, "sched-fs-bottom", "#live-map");
    }
    var rfs = document.getElementById("meter-map-stage");
    if (rfs && rfs.classList.contains("pcs-rfs")) {
      var rbar = document.getElementById("rfs-bar");
      if (rbar) rfs.style.setProperty("--rfs-bar", rbar.offsetHeight + "px");
      reserve(rfs, "rfs-bar", "#live-map");
    }
    ["map-mode-toggle", "map-orient-toggle", "map-recenter"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.dataset.clicks = "0";
      el.dataset.touches = "0";
      el.addEventListener("click", function () { el.dataset.clicks = String(Number(el.dataset.clicks) + 1); });
      el.addEventListener("touchend", function () { el.dataset.touches = String(Number(el.dataset.touches) + 1); });
      el.addEventListener("pointerup", function (e) { if (e.pointerType === "touch") el.dataset.touches = String(Number(el.dataset.touches) + 1); });
    });
    function probe(id) {
      var el = document.getElementById(id);
      if (!el) return { present: false };
      var r = el.getBoundingClientRect();
      var x = Math.round(r.left + Math.min(r.width / 2, 24));
      var y = Math.round(r.top + r.height / 2);
      var inView = r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1;
      var got = inView ? document.elementFromPoint(x, y) : null;
      var self = !!(got && (got === el || el.contains(got)));
      return { present: true, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right), x: x, y: y, inView: inView, self: self, hit: got ? (got.id || got.className || got.tagName) : "", text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 90) };
    }
    document.body.dataset.report = JSON.stringify({
      mode: ${JSON.stringify(mode)},
      ride: ${JSON.stringify(ride)},
      vh: window.innerHeight,
      vw: window.innerWidth,
      mapH: st ? Math.round(st.getBoundingClientRect().height) : 0,
      line: probe("sched-rider-line"),
      link: probe("sched-rider-phone"),
      questions: ["home-chrome", "home-map-stage", "sched-sec", "meter-split-run"].some(function (id) {
        var el = document.getElementById(id);
        return !!(el && (el.innerText || "").indexOf("Questions? Call") >= 0);
      }),
      end: probe("rfs-end"),
      meterEnd: probe("meter-end"),
      follow: probe("map-mode-toggle"),
      north: probe("map-orient-toggle"),
      center: probe("map-recenter"),
      zoom: probe("zoom-out"),
      arrived: probe("sched-fs-arrived"),
      cardBtn: probe("sched-arrived"),
      closeFs: probe("sched-fs-close"),
      closeRide: probe("rfs-close")
    });
  </script></body></html>`;
}

function overlap(a, b) {
  if (!a || !b || !a.present || !b.present) return false;
  return a.l < b.r && b.l < a.r && a.top < b.bottom && b.top < a.bottom;
}

function chromeSession(port, width, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-surface-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--force-device-scale-factor=1", "--window-size=" + width + "," + height,
    "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, server: server, chrome: chrome, debug: port + 100 };
}

test("the rider line is on screen in pickup and active, normal and fullscreen", async function () {
  const port = 8811;
  const session = chromeSession(port, 768, 1024);
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
  const modes = ["pickup", "pickup-fs", "active", "active-fs"];
  const sizes = [[768, 1024, "portrait"], [1024, 768, "landscape"]];
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
    const out = {};
    for (const size of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false }, sid);
      for (const mode of modes) {
        for (const ride of ["554", "574"]) {
          if (size[2] === "landscape" && ride === "574") continue;
          const name = mode + "-" + ride + "-" + size[2];
          fs.writeFileSync(path.join(session.dir, name + ".html"), page(mode, ride));
          await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + name + ".html" }, sid);
          let report = "";
          for (let i = 0; i < 30 && !report; i++) {
            const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
            report = msg.result && msg.result.result ? msg.result.result.value : "";
            if (!report) await wait(150);
          }
          const got = JSON.parse(report);
          if (mode === "active" && ride === "554") {
            const ids = { follow: "map-mode-toggle", north: "map-orient-toggle", center: "map-recenter" };
            got.clicks = {};
            for (const key of Object.keys(ids)) {
              const p = got[key];
              assert.ok(p && p.self, name + " " + key + " is not the element under the point " + JSON.stringify(p));
              await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, sid);
              await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }, sid);
              await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }, sid);
              const touchStart = await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y, radiusX: 1, radiusY: 1, id: 1 }] }, sid);
              const touchEnd = await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sid);
              assert.ok(!touchStart.error && !touchEnd.error, name + " " + key + " touch dispatch failed " + JSON.stringify(touchStart.error || touchEnd.error));
              const counted = await send("Runtime.evaluate", { expression: "(function(){var el=document.getElementById(" + JSON.stringify(ids[key]) + ");return el.dataset.clicks+'|'+el.dataset.touches;})()", returnByValue: true }, sid);
              got.clicks[key] = counted.result && counted.result.result ? counted.result.result.value : "";
              const parts = String(got.clicks[key]).split("|");
              assert.ok(Number(parts[0]) >= 1, name + " " + key + " mouse click was not registered " + got.clicks[key]);
              assert.ok(Number(parts[1]) >= 1, name + " " + key + " touch was not registered " + got.clicks[key]);
            }
          }
          out[name] = got;
          const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { x: 0, y: 0, width: size[0], height: size[1], scale: 1 } }, sid);
          fs.writeFileSync("/opt/cursor/artifacts/surface-" + name + ".png", Buffer.from(shot.result.data, "base64"));
        }
      }
    }
    fs.writeFileSync("/opt/cursor/artifacts/invoice-surface.json", JSON.stringify(out, null, 2));
    function check(name) {
      const g = out[name];
      assert.ok(g, name);
      assert.ok(Math.abs(g.vh - (name.indexOf("portrait") >= 0 ? 1024 : 768)) < 80, name + " viewport " + g.vh);
      assert.equal(g.line.present, true, name + " line missing");
      assert.equal(g.line.inView, true, name + " line off screen " + JSON.stringify(g.line));
      assert.equal(g.line.self, true, name + " tap missed the line " + JSON.stringify(g.line));
      assert.ok(g.line.h >= 44 && g.line.h <= 88, name + " line height " + g.line.h);
      assert.equal(g.questions, false, name + " still shows the business call line");
      assert.equal(g.link.self, true, name + " rider phone not hittable " + JSON.stringify(g.link));
      assert.ok(String(g.link.text).indexOf("555-") === 0, name + " rider phone text " + g.link.text);
      ["follow", "north", "zoom", "center"].forEach(function (k) {
        if (!g[k] || !g[k].present) return;
        assert.equal(g[k].self, true, name + " " + k + " covered " + JSON.stringify(g[k]));
        assert.equal(overlap(g.line, g[k]), false, name + " line covers " + k);
      });
      ["end", "meterEnd", "arrived", "closeFs", "closeRide", "cardBtn"].forEach(function (k) {
        if (k === "cardBtn" && name.indexOf("pickup-") !== 0) return;
        if (k === "cardBtn" && name.indexOf("pickup-fs") === 0) return;
        if (k === "meterEnd" && name.indexOf("-fs-") >= 0) return;
        if (!g[k] || !g[k].present) return;
        assert.equal(g[k].inView, true, name + " " + k + " off screen");
        assert.equal(g[k].self, true, name + " " + k + " covered " + JSON.stringify(g[k]));
        assert.equal(overlap(g.line, g[k]), false, name + " line covers " + k);
      });
    }
    ["pickup", "pickup-fs", "active", "active-fs"].forEach(function (mode) {
      check(mode + "-554-portrait");
      check(mode + "-574-portrait");
      check(mode + "-554-landscape");
    });
    const heights = ["pickup", "pickup-fs", "active", "active-fs"].map(function (mode) { return out[mode + "-554-portrait"].line.h; });
    assert.ok(Math.max.apply(null, heights) - Math.min.apply(null, heights) <= 24, "line heights diverged " + heights.join(","));
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
  }
});
