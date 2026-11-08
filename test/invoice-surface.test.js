/* Truthful geometry: the invoice replaces the rider phone line on the card under the map.
   Fullscreen covers that card. This test records what a tap on the visible screen hits.
   It does not scroll the line into view and it does not call element.click(). */
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
  quotedCss(appSrc.slice(appSrc.indexOf("function fsStyle"), appSrc.indexOf("function rfsKey")));

function page(mode) {
  const line = '<p id="sched-rider-line" style="margin:0 0 6px">Rider: Rahual · Invoice #000554</p>';
  const card = '<section id="sched-sec"><button type="button" id="sched-sec-head" style="display:block;width:100%;height:44px">Scheduled rides</button><div id="sched-sec-body"><article class="card" style="padding:12px"><p style="margin:0 0 4px">Assigned to you</p><p style="margin:0 0 6px;font-size:20px">3:40 PM</p>' + line + '<p style="margin:0 0 6px">Pickup: 1200 Smith St</p><button type="button" id="sched-arrived" style="display:block;width:100%;height:58px">I\u2019m at the pickup</button></article></div></section>';
  const home = mode === "active" || mode === "active-fs" ? "" : (
    '<div id="home-chrome" style="height:96px;background:#102418;color:#fff;padding:8px">Available</div>' +
    '<div id="home-map-stage" class="map-stage board-map home-map' + (mode === "pickup-fs" ? " pcs-fullmap" : "") + '" style="background:#0b3d23;position:relative">' +
    '<div id="live-map" style="background:#14301c"></div>' +
    (mode === "pickup-fs" ? '<div id="sched-fs-bottom"><button type="button" id="sched-fs-arrived" style="height:62px;width:100%">I\u2019m at the pickup</button><button type="button" id="sched-fs-close" style="height:58px;width:100%">Close map</button></div><div class="nav-toggle" style="position:absolute;right:8px"><button type="button" id="map-mode-toggle">Follow</button></div>' : '<p class="map-caption">You are here</p>') +
    "</div>" + card);
  const active = mode === "active" || mode === "active-fs" ? (
    '<div class="meter-split" id="meter-split-run"><div class="meter-map-col"><div id="meter-map-stage" class="map-stage board-map' + (mode === "active-fs" ? " pcs-rfs" : "") + '" style="background:#0b3d23;position:relative;height:46vh">' +
    (mode === "active-fs" ? '<div id="rfs-bar"><div class="rfs-row"><span>1.20 mi</span></div><button type="button" id="rfs-end">End ride</button></div><div class="nav-toggle" style="position:absolute;right:8px"><button type="button" id="map-mode-toggle">Follow</button></div>' : "") +
    "</div></div><section id=\"meter-running\"><button type=\"button\" id=\"meter-end\">End ride</button></section></div>"
  ) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#08140c;color:#111}
    .map-stage.board-map{min-height:360px;background:#0b3d23}
    .map-stage.board-map #live-map{min-height:360px;height:100%}
    #meter-split-run .map-stage.board-map{height:46vh;height:46dvh;min-height:240px}
    ${fullCss}
  </style></head><body>
  ${home}${active}
  <script>
    var st = document.getElementById("home-map-stage");
    if (st && !st.classList.contains("pcs-fullmap")) {
      var vh = window.innerHeight;
      var top = st.getBoundingClientRect().top;
      var sh = document.getElementById("sched-sec-head");
      var sb = document.getElementById("sched-sec-body");
      var foot = 26 + (sh ? sh.offsetHeight + 12 : 0);
      var h = Math.max(220, Math.round(vh - top - foot));
      if (sh && sb && !sb.hidden) h = Math.max(220, Math.min(h, Math.round(vh * 0.5)));
      st.style.height = h + "px";
      var lm = document.getElementById("live-map"); if (lm) lm.style.height = Math.max(0, h - 18) + "px";
    }
    if (st) st.style.setProperty("--sched-fs-bar", "148px");
    var rfs = document.getElementById("meter-map-stage");
    if (rfs) rfs.style.setProperty("--rfs-bar", "120px");
    function probe(id) {
      var el = document.getElementById(id);
      if (!el) return { present: false };
      var r = el.getBoundingClientRect();
      var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      var inView = r.width > 0 && r.height > 0 && y >= 0 && y < window.innerHeight && x >= 0 && x < window.innerWidth;
      var got = inView ? document.elementFromPoint(x, y) : null;
      var self = !!(got && (got === el || el.contains(got)));
      return { present: true, top: Math.round(r.top), bottom: Math.round(r.bottom), x: x, y: y, inView: inView, self: self, hit: got ? (got.id || got.className || got.tagName) : "", text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) };
    }
    document.body.dataset.report = JSON.stringify({
      mode: ${JSON.stringify(mode)},
      vh: window.innerHeight,
      mapH: st ? Math.round(st.getBoundingClientRect().height) : 0,
      line: probe("sched-rider-line"),
      end: probe("rfs-end"),
      meterEnd: probe("meter-end"),
      follow: probe("map-mode-toggle"),
      arrived: probe("sched-fs-arrived")
    });
  </script></body></html>`;
}

function chromeSession(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-surface-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=1100,1200", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, server: server, chrome: chrome, debug: port + 100 };
}

test("pickup, active, and fullscreen report whether the invoice line is actually on screen", async function () {
  const port = 8807;
  const session = chromeSession(port);
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
      await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: true }, sid);
      for (const mode of modes) {
        const name = mode + "-" + size[2];
        fs.writeFileSync(path.join(session.dir, name + ".html"), page(mode));
        await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + name + ".html" }, sid);
        let report = "";
        for (let i = 0; i < 30 && !report; i++) {
          const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
          report = msg.result && msg.result.result ? msg.result.result.value : "";
          if (!report) await wait(150);
        }
        const got = JSON.parse(report);
        out[name] = got;
        const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
        fs.writeFileSync("/opt/cursor/artifacts/surface-" + name + ".png", Buffer.from(shot.result.data, "base64"));
      }
    }
    fs.writeFileSync("/opt/cursor/artifacts/invoice-surface.json", JSON.stringify(out, null, 2));
    const open = out["pickup-portrait"].line;
    const fsPick = out["pickup-fs-portrait"].line;
    const active = out["active-portrait"].line;
    const activeFs = out["active-fs-portrait"].line;
    assert.equal(open.present, true);
    assert.equal(open.self, true, "open pickup card line is not the thing under the tap " + JSON.stringify(open));
    assert.equal(fsPick.present, true);
    assert.equal(fsPick.self, false, "fullscreen still shows the card line; expected it to be covered " + JSON.stringify(fsPick));
    assert.equal(active.present, false, "active meter home still has the card phone line");
    assert.equal(activeFs.present, false, "active fullscreen still has the card phone line");
    assert.equal(out["pickup-fs-landscape"].line.self, false);
    assert.equal(out["active-landscape"].line.present, false);
    assert.equal(out["active-fs-landscape"].line.present, false);
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
  }
});
