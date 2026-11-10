/* Scheduled full map: SOS sits above the map, under the Arrive stack, and the invoice bar sits above the action button. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
const version = fs.readFileSync(path.join(__dirname, "../app/version.js"), "utf8");

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
const sosCss = quotedAll(src.slice(src.indexOf("st.textContent =", src.indexOf("pcs-sos-style")), src.indexOf("document.head.appendChild(st)", src.indexOf("pcs-sos-style"))));
const turnFn = src.slice(src.indexOf("function schedTurnHtml"), src.indexOf("function navEtaClock"));
const rfsFn = src.slice(src.indexOf("function rfsBarHtml"), src.indexOf("function rfsBarClick"));

test("scheduled full map raises SOS and keeps the invoice off the turn card", function () {
  assert.equal(turnFn.indexOf("navTurnInvoice"), -1);
  assert.equal(turnFn.indexOf("nav-inv"), -1);
  assert.ok(src.indexOf('classList.toggle("pcs-fullmap-body"') >= 0);
  assert.ok(fullCss.indexOf("body.pcs-fullmap-body #pcs-sos-btn{z-index:2147482100") >= 0);
  assert.ok(fullCss.indexOf("top:var(--pcs-sos-top,calc(env(safe-area-inset-top,0px) + 250px))") >= 0);
  assert.ok(sosCss.indexOf("body.pcs-cancel-modal-open #pcs-sos-btn{display:none!important}") >= 0);
  assert.ok(src.indexOf("body.pcs-rfs-body #pcs-sos-btn{z-index:2147482100") >= 0);
  assert.ok(rfsFn.indexOf("navTurnInvoice") >= 0);
  assert.ok(rfsFn.indexOf("navTurnInvoice") < rfsFn.indexOf('class="rfs-actions"'));
  assert.ok(version.indexOf('var APP_VERSION = "v2.0m-bc"') >= 0);
});

function overlap(a, b) {
  if (!a || !b || a.h < 1 || b.h < 1) return false;
  return !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1 || a.right <= b.left + 1 || a.left >= b.right - 1);
}

function invoiceBar(word, href, linkText) {
  const linked = href ? '<a id="nav-inv-link" href="' + href + '" style="color:#fff;font-weight:900;text-decoration:underline">' + word + "</a>" : word;
  const text = "Invoice #000562 · " + (href ? "" : word);
  const inner = href ? "Invoice #000562 · " + linked : text;
  return '<div id="nav-inv" class="nav-inv-bar" style="display:block;width:100%;box-sizing:border-box;margin:0;padding:10px 12px;background:#0b3d23;color:#fff;border:3px solid #2e9d4f;border-radius:14px;font-family:system-ui,-apple-system,sans-serif;font-size:18px;line-height:1.35;font-weight:900;text-align:center;pointer-events:auto">' + inner + "</div>";
}

function page(kind, w, h, word, href, linkText) {
  const inv = invoiceBar(word, href, linkText);
  const rfs = kind === "rfs";
  const css = (rfs ? fsCss : fullCss) + uniformCss + sosCss;
  const stageId = rfs ? "meter-map-stage" : "home-map-stage";
  const stageClass = rfs ? "pcs-rfs" : "pcs-fullmap";
  const bodyClass = rfs ? "pcs-rfs-body" : "pcs-fullmap-body";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#123}
    .leaflet-top,.leaflet-left{position:absolute;pointer-events:none}
    .leaflet-control{pointer-events:auto}
    .leaflet-bar a{display:block;width:44px;height:44px;line-height:44px;background:#fff;color:#000;text-align:center;text-decoration:none}
    .nav-eta{background:#0b3d23;color:#fff;border:3px solid #2e9d4f;border-radius:14px;padding:8px 14px;min-width:150px;text-align:right;margin:8px 0 0 auto;width:max-content;font-family:system-ui,sans-serif}
    .nav-eta-at{font-size:24px;font-weight:900}
    .fs-mph{position:absolute;left:10px;z-index:1003;min-width:86px;padding:6px 10px 5px;background:#fff;color:#0b3d23;border:3px solid #0b3d23;border-radius:16px;text-align:center}
    .fs-mph b{display:block;font-size:40px;line-height:1;font-weight:900}
    #${stageId}{--pcs-safe-top:24px;--pcs-safe-bottom:20px;--pcs-safe-left:0px;--pcs-safe-right:0px}
    ${css}
  </style></head><body class="${bodyClass}" style="width:${w}px;height:${h}px">
  <button id="pcs-sos-btn" type="button">ALERT<br>SOS</button>
  <div id="${stageId}" class="${stageClass}">
    <div class="leaflet-top leaflet-left"><div class="leaflet-control-zoom leaflet-bar"><a id="zoom-in" href="#">+</a><a id="zoom-out" href="#">−</a></div></div>
    ${rfs ? "" : '<div id="sched-fs-top"><div id="sched-turn-fs" style="background:#0b3d23;color:#fff;border-radius:12px;padding:10px 12px;font-size:20px;font-weight:800">Continue onto Rayford Rd</div><div id="sched-eta-fs" class="nav-eta"><div class="nav-eta-at">Arrive 3:40 PM</div><div class="nav-eta-left">9 min · 5 mi</div><div class="nav-eta-to">to pickup</div></div></div>'}
    <div class="nav-toggle" style="position:absolute;right:8px;display:flex;gap:6px">
      <button type="button" id="map-orient-toggle" style="min-height:36px;padding:6px 12px">Heading up</button>
      <button type="button" id="map-mode-toggle" style="min-height:36px;padding:6px 12px">Full route</button>
    </div>
    <button type="button" id="map-recenter" class="nav-recenter" style="position:absolute;right:8px;width:48px;height:48px">recenter</button>
    <div id="fs-mph" class="fs-mph"><b>32</b><span>MPH</span></div>
    ${rfs
      ? '<div id="rfs-bar">' + inv + '<div class="rfs-actions"><button type="button" class="rfs-end" id="sched-fs-arrived">End ride</button><button type="button" class="rfs-close" id="sched-fs-close">Close map</button></div></div>'
      : '<div id="sched-fs-bottom">' + inv + '<button type="button" class="pcs-map-green" id="sched-fs-arrived">I\u2019m at the pickup</button><button type="button" id="sched-fs-close">Close map</button></div>'}
  </div>
  <script>
    try {
    var stage = document.getElementById("${stageId}");
    var bot = document.getElementById("${rfs ? "rfs-bar" : "sched-fs-bottom"}");
    var stack = document.getElementById("sched-fs-top");
    stage.style.setProperty("${rfs ? "--rfs-bar" : "--sched-fs-bar"}", bot.offsetHeight + "px");
    if (stack) stage.style.setProperty("--sched-fs-top", stack.offsetHeight + "px");
    var stackBottom = stack ? stack.getBoundingClientRect().bottom : 0;
    if (${rfs ? "false" : "true"}) document.body.style.setProperty("--pcs-sos-top", Math.round(stackBottom + 14) + "px");
    var mph = document.getElementById("fs-mph");
    mph.style.bottom = Math.round(stage.getBoundingClientRect().bottom - bot.getBoundingClientRect().top + 12) + "px";
    function box(id) {
      var el = document.getElementById(id); if (!el) return null;
      var r = el.getBoundingClientRect();
      return { id: id, top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    }
    function hit(a, b) {
      if (!a || !b || a.h < 1 || b.h < 1) return false;
      return !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1 || a.right <= b.left + 1 || a.left >= b.right - 1);
    }
    var sos = document.getElementById("pcs-sos-btn");
    var sosStyle = getComputedStyle(sos);
    var stageStyle = getComputedStyle(stage);
    document.body.classList.add("pcs-cancel-modal-open");
    var hidden = getComputedStyle(sos).display;
    document.body.classList.remove("pcs-cancel-modal-open");
    var shown = getComputedStyle(sos).display;
    var inv = box("nav-inv");
    var names = ["sched-fs-top","fs-mph","map-orient-toggle","map-mode-toggle","map-recenter","sched-fs-arrived","sched-fs-close","zoom-out","pcs-sos-btn","nav-inv"];
    var boxes = {};
    names.forEach(function (id) { boxes[id] = box(id); });
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = boxes["pcs-sos-btn"];
    document.body.dataset.report = JSON.stringify({
      vw: vw, vh: vh,
      sosZ: parseInt(sosStyle.zIndex, 10), mapZ: parseInt(stageStyle.zIndex, 10),
      hidden: hidden, shown: shown,
      turn: (document.getElementById("sched-turn-fs") || { textContent: "" }).textContent,
      inv: document.getElementById("nav-inv").textContent,
      invParent: document.getElementById("nav-inv").parentElement.id,
      invBg: getComputedStyle(document.getElementById("nav-inv")).backgroundColor,
      boxes: boxes,
      inside: s.top >= -1 && s.left >= -1 && s.right <= vw + 1 && s.bottom <= vh + 1,
      underStack: !stack || s.top >= boxes["sched-fs-top"].bottom - 1,
      sosHits: {
        top: hit(s, boxes["sched-fs-top"]),
        mph: hit(s, boxes["fs-mph"]),
        bar: hit(s, box("${rfs ? "rfs-bar" : "sched-fs-bottom"}")),
        orient: hit(s, boxes["map-orient-toggle"]),
        mode: hit(s, boxes["map-mode-toggle"]),
        recenter: hit(s, boxes["map-recenter"]),
        zoom: hit(s, boxes["zoom-out"]),
        inv: hit(s, inv),
        action: hit(s, boxes["sched-fs-arrived"])
      },
      invHits: {
        mph: hit(inv, boxes["fs-mph"]),
        orient: hit(inv, boxes["map-orient-toggle"]),
        mode: hit(inv, boxes["map-mode-toggle"]),
        action: hit(inv, boxes["sched-fs-arrived"]),
        close: hit(inv, boxes["sched-fs-close"])
      },
      aboveAction: inv.bottom <= boxes["sched-fs-arrived"].top + 1
    });
    } catch (err) { document.body.dataset.report = JSON.stringify({ error: String(err && err.stack || err) }); }
  </script></body></html>`;
}

test("SOS is above the full map and the invoice bar clears the controls", async function () {
  const port = 8811;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-sos-"));
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
    const shots = [
      ["pickup", 820, 1180, "Unpaid", "https://squareup.com/pay-invoice/inv-562", "driver-fullmap-820-unpaid.png"],
      ["pickup", 820, 1180, "Paid", "https://squareup.com/receipt/preview/rcpt-562", "driver-fullmap-820-paid.png"],
      ["pickup", 768, 1024, "Unpaid", "https://squareup.com/pay-invoice/inv-562", "driver-fullmap-768-unpaid.png"],
      ["pickup", 768, 1024, "Paid", "https://squareup.com/receipt/preview/rcpt-562", "driver-fullmap-768-paid.png"],
      ["rfs", 820, 1180, "Unpaid", "https://squareup.com/pay-invoice/inv-562", ""]
    ];
    for (let n = 0; n < shots.length; n++) {
      const row = shots[n];
      const file = "map-" + n + ".html";
      fs.writeFileSync(path.join(dir, file), page(row[0], row[1], row[2], row[3], row[4]));
      await send("Emulation.setDeviceMetricsOverride", { width: row[1], height: row[2], deviceScaleFactor: 1, mobile: true }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + file }, sid);
      let report = "";
      for (let i = 0; i < 30 && !report; i++) {
        const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(150);
      }
      assert.ok(report, row.join(" ") + " did not report");
      const got = JSON.parse(report);
      const label = row[0] + " " + row[1] + "x" + row[2] + " " + row[3];
      assert.equal(got.error || "", "", label + " " + (got.error || ""));
      assert.ok(got.sosZ > got.mapZ, label + " SOS z " + got.sosZ + " map z " + got.mapZ);
      assert.equal(got.inside, true, label + " SOS is outside the viewport");
      assert.equal(got.underStack, true, label + " SOS is not under the Arrive stack");
      assert.equal(got.hidden, "none", label + " cancel modal still shows SOS");
      assert.notEqual(got.shown, "none", label + " SOS stays hidden");
      Object.keys(got.sosHits).forEach(function (k) { assert.equal(got.sosHits[k], false, label + " SOS hits " + k); });
      assert.equal(got.turn.indexOf("Invoice"), -1, label + " invoice is on the turn card");
      assert.ok(got.inv.indexOf("Invoice #000562 · " + row[3]) >= 0, label + " " + got.inv);
      assert.equal(got.invBg, "rgb(11, 61, 35)", label + " invoice bar is not dark green");
      assert.equal(got.aboveAction, true, label + " invoice is not above the action button");
      Object.keys(got.invHits).forEach(function (k) { assert.equal(got.invHits[k], false, label + " invoice hits " + k); });
      if (row[5]) {
        const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
        fs.writeFileSync("/opt/cursor/artifacts/" + row[5], Buffer.from(shot.result.data, "base64"));
      }
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
