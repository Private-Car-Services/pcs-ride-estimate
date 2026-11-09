/* Full-screen pickup: invoice stays on the green pickup line, and Follow, North, zoom, and Close stay hittable. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
const styleFn = src.slice(src.indexOf("function schedFullStyle"), src.indexOf("function schedFullResize"));

function rects(w, h, safe, bannerH, barH) {
  const barBottom = safe.bottom + 22;
  const barTop = h - barBottom - barH;
  const toggleH = 40;
  const toggleBottom = safe.bottom + 22 + barH + 14;
  const toggleTop = h - toggleBottom - toggleH;
  const recenter = 48;
  const recenterBottom = safe.bottom + 22 + barH + 62;
  const recenterTop = h - recenterBottom - recenter;
  const zoomTop = safe.top + bannerH + 12;
  const zoomLeft = safe.left + 10;
  return { barTop: barTop, toggleTop: toggleTop, toggleBottomY: toggleTop + toggleH, recenterTop: recenterTop, zoomTop: zoomTop, zoomLeft: zoomLeft };
}

test("portrait and landscape keep Follow, North, and zoom clear of the pickup bar and the top corner", function () {
  assert.match(styleFn, /--sched-fs-bar, 148px\) \+ 14px/);
  assert.match(styleFn, /leaflet-top\.leaflet-left\{top:calc\(var\(--pcs-safe-top/);
  assert.doesNotMatch(styleFn, /nav-toggle\{bottom:172px/);
  assert.match(styleFn, /#sched-fs-bottom\{[^}]*pointer-events:none/);
  assert.match(styleFn, /#sched-fs-bottom button\{pointer-events:auto/);
  const cases = [
    { name: "portrait", w: 768, h: 1024, safe: { top: 47, bottom: 34, left: 0 } },
    { name: "landscape", w: 1024, h: 768, safe: { top: 24, bottom: 21, left: 47 } }
  ];
  cases.forEach(function (c) {
    const box = rects(c.w, c.h, c.safe, 96, 190);
    assert.ok(box.toggleBottomY <= box.barTop - 4, c.name + " Follow/North overlap the pickup buttons");
    assert.ok(box.recenterTop + 48 <= box.toggleTop - 4, c.name + " recenter overlaps Follow");
    assert.ok(box.zoomTop >= c.safe.top + 59, c.name + " zoom sits in the top corner");
    assert.ok(box.zoomLeft >= c.safe.left + 8, c.name + " zoom is not inset from the left edge");
    assert.ok(box.zoomTop + 88 < box.barTop, c.name + " zoom reaches the bottom bar");
  });
});

function fullscreenCss() {
  const parts = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(styleFn))) {
    const bit = m[1].replace(/\\"/g, '"');
    if (bit.indexOf("{") >= 0) parts.push(bit);
  }
  return parts.join("");
}

function page(w, h, safe) {
  const css = fullscreenCss();
  assert.ok(css.indexOf(".nav-toggle{") >= 0, "fullscreen CSS");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#123}
    .leaflet-top,.leaflet-bottom,.leaflet-left{position:absolute;pointer-events:none}
    .leaflet-control{pointer-events:auto}
    .leaflet-bar a{display:block;background:#fff;color:#000;text-align:center;text-decoration:none;border-bottom:1px solid #ccc}
    ${css}
    #home-map-stage{--pcs-safe-top:${safe.top}px;--pcs-safe-bottom:${safe.bottom}px;--pcs-safe-left:${safe.left}px;--pcs-safe-right:0px}
  </style></head><body>
  <div id="home-map-stage" class="pcs-fullmap" style="position:relative;width:${w}px;height:${h}px">
    <div class="leaflet-top leaflet-left"><div class="leaflet-control-zoom leaflet-bar"><a id="zoom-in" href="#">+</a><a id="zoom-out" href="#">−</a></div></div>
    <div id="sched-fs-top" style="height:96px;background:#20371d;color:#fff">In 0.4 mi · about 2 min</div>
    <div class="nav-toggle" style="position:absolute;right:8px;display:flex;gap:6px">
      <button type="button" id="map-orient-toggle" style="min-height:36px;padding:6px 12px">North up</button>
      <button type="button" id="map-mode-toggle" style="min-height:36px;padding:6px 12px">Follow</button>
    </div>
    <button type="button" id="map-recenter" class="nav-recenter" style="position:absolute;right:8px;width:48px;height:48px">recenter</button>
    <div id="sched-fs-bottom">
      <div id="sched-bill-host" class="sched-bill-host"><p class="fine" id="pcs-question-slot">Invoice #000574</p></div>
      <button type="button" id="sched-fs-arrived">I’m at the pickup</button>
      <button type="button" id="sched-fs-close">Close map</button>
    </div>
  </div>
  <script>
    var stage = document.getElementById("home-map-stage");
    stage.style.setProperty("--sched-fs-bar", document.getElementById("sched-fs-bottom").offsetHeight + "px");
    stage.style.setProperty("--sched-fs-top", document.getElementById("sched-fs-top").offsetHeight + "px");
    var mode = document.getElementById("map-mode-toggle");
    var orient = document.getElementById("map-orient-toggle");
    mode.addEventListener("click", function () { mode.textContent = mode.textContent === "Follow" ? "Full route" : "Follow"; mode.dataset.n = String(Number(mode.dataset.n || 0) + 1); });
    orient.addEventListener("click", function () { orient.textContent = orient.textContent === "North up" ? "Heading up" : "North up"; orient.dataset.n = String(Number(orient.dataset.n || 0) + 1); });
    document.getElementById("zoom-out").addEventListener("click", function (e) { e.preventDefault(); this.dataset.n = String(Number(this.dataset.n || 0) + 1); });
    document.getElementById("sched-fs-close").addEventListener("click", function () { this.dataset.n = "1"; });
    function hit(id) {
      var el = document.getElementById(id), r = el.getBoundingClientRect();
      var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + Math.min(r.height / 2, 20));
      var got = document.elementFromPoint(x, y);
      return { id: id, x: x, y: y, top: r.top, left: r.left, hit: got ? (got.id || got.className) : "" };
    }
    document.body.dataset.report = JSON.stringify(["map-orient-toggle", "map-mode-toggle", "zoom-out", "sched-fs-arrived", "sched-fs-close"].map(hit));
  </script></body></html>`;
}

function chromeHit(html, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-pickup-"));
  fs.writeFileSync(path.join(dir, "index.html"), html);
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=1100,1100", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, server: server, chrome: chrome, debug: port + 100 };
}

test("clicks land on Follow, North, zoom out, and Close in portrait and landscape", async function () {
  const port = 8791;
  const session = chromeHit(page(768, 1024, { top: 47, bottom: 34, left: 0 }), port);
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
    async function run(file, w, h) {
      fs.writeFileSync(path.join(session.dir, file), page(w, h, w > h ? { top: 24, bottom: 21, left: 47 } : { top: 47, bottom: 34, left: 0 }));
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + file }, sid);
      let report = "";
      for (let i = 0; i < 30 && !report; i++) {
        const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(150);
      }
      const hits = JSON.parse(report);
      hits.forEach(function (row) { assert.equal(row.hit, row.id, file + " " + row.id + " hit " + row.hit); });
      const zoom = hits.filter(function (row) { return row.id === "zoom-out"; })[0];
      assert.ok(zoom.top >= 80, file + " zoom is still in the top corner");
      assert.ok(zoom.left >= (w > h ? 47 : 8), file + " zoom is not inset");
      await send("Runtime.evaluate", { expression: "document.getElementById('map-mode-toggle').click(); document.getElementById('map-orient-toggle').click(); document.getElementById('zoom-out').click(); document.getElementById('sched-fs-close').click();", returnByValue: true }, sid);
      const after = await send("Runtime.evaluate", { expression: "JSON.stringify({mode:document.getElementById('map-mode-toggle').textContent,orient:document.getElementById('map-orient-toggle').textContent,zoom:document.getElementById('zoom-out').dataset.n,close:document.getElementById('sched-fs-close').dataset.n,bill:document.getElementById('sched-fs-arrived').textContent,host:!!document.getElementById('sched-bill-host')})", returnByValue: true }, sid);
      const got = JSON.parse(after.result.result.value);
      assert.equal(got.mode, "Full route");
      assert.equal(got.orient, "Heading up");
      assert.equal(got.zoom, "1");
      assert.equal(got.close, "1");
      assert.equal(got.bill, "I’m at the pickup");
      assert.equal(got.bill.indexOf("Invoice #"), -1);
      assert.equal(got.host, true);
      const hostText = await send("Runtime.evaluate", { expression: "document.getElementById('sched-bill-host').textContent", returnByValue: true }, sid);
      assert.ok(String(hostText.result.result.value).indexOf("Invoice #000574") >= 0);
      assert.equal(String(hostText.result.result.value).indexOf("unpaid"), -1);
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      fs.writeFileSync("/opt/cursor/artifacts/pickup-" + (w > h ? "landscape" : "portrait") + ".png", Buffer.from(shot.result.data, "base64"));
    }
    await run("portrait.html", 768, 1024);
    await run("landscape.html", 1024, 768);
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
  }
});
