/* Driver green bar and customer white bar for the 000554 and 000574 field shapes. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const test = require("node:test");

const RAHUAL = { prepaidInvoiceNo: "000554", status: "assigned" };
const CAMARA = { prepaidInvoiceNo: "000574", prepaid: false, prepaidVia: "square_invoice", prepaidAmountCents: 2066, prepaidTaxCents: 2066, status: "assigned" };
const PAY = "https://squareup.com/pay-invoice/inv-574";
const RECEIPT = "https://squareup.com/receipt/rcpt-554";

function el() {
  return {
    style: {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    appendChild: function () {}, addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return ""; }, removeAttribute: function () {}
  };
}
function loadApp() {
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
  return sandbox.__pcsV20lBill;
}
function loadFollow() {
  const nodes = {};
  function make(id) {
    return nodes[id] || (nodes[id] = { id: id, hidden: true, textContent: "", innerHTML: "", src: "", style: {}, className: "", children: [],
      appendChild: function (c) { this.children.push(c); }, setAttribute: function () {}, addEventListener: function () {},
      querySelector: function () { return null; }, parentNode: { removeChild: function () {} } });
  }
  ["app", "fl-live", "fl-photo", "fl-status", "fl-bill", "fl-who", "fl-car", "fl-eta", "fl-from", "fl-to", "fl-upd", "fl-net", "fl-stops", "fl-big", "fl-map"].forEach(make);
  const sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String, Object: Object,
    Array: Array, RegExp: RegExp, Error: Error, parseInt: parseInt, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    document: { visibilityState: "visible", getElementById: function (id) { return nodes[id] || null; }, createElement: function () { return make("made"); }, addEventListener: function () {}, head: { appendChild: function () {} }, body: {} },
    location: { search: "?t=" + "a".repeat(32) },
    fetch: function () { return new Promise(function () {}); },
    navigator: {}, addEventListener: function () {}, removeEventListener: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8"), sandbox, { filename: "follow-live.js" });
  return sandbox.__pcsFollowLive;
}
function loadClean() {
  const sandbox = {
    console: console, Date: Date, Math: Math, Intl: Intl, JSON: JSON, Promise: Promise,
    Number: Number, String: String, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt,
    RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    navigator: { userAgent: "test", geolocation: null, maxTouchPoints: 0, language: "en-US" },
    location: { search: "", hostname: "localhost", href: "http://localhost/app/driver/", protocol: "http:", hash: "", pathname: "/app/driver/", replace: function () {} },
    history: { pushState: function () {}, replaceState: function () {}, back: function () {}, state: null },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {},
    fetch: function () { return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve("null"); }, json: function () { return Promise.resolve(null); } }); },
    PCS_SYNC: { databaseURL: "https://example.test" },
    document: {
      readyState: "complete", currentScript: { src: "" }, visibilityState: "visible",
      getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; },
      body: { getAttribute: function () { return "driver"; }, style: {} }, head: { appendChild: function () {} }, documentElement: {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), sandbox, { filename: "app.js" });
  return sandbox.__pcsFollow.clean;
}

const bill = loadApp();
const live = loadFollow();
const clean = loadClean();
const appSrc = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
const followSrc = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");

test("000554 and 000574 show the invoice number and do not invent paid or unpaid", function () {
  assert.equal(bill.pay(RAHUAL), "");
  assert.equal(bill.bar(RAHUAL), "Invoice #000554");
  assert.equal(bill.pickupLine(RAHUAL), "I\u2019m at the pickup \u00b7 Invoice #000554");
  assert.equal(bill.pay(CAMARA), "");
  assert.equal(bill.bar(CAMARA), "Invoice #000574");
  assert.equal(bill.pickupLine(CAMARA), "I\u2019m at the pickup \u00b7 Invoice #000574");
  assert.equal(bill.pickupLine(RAHUAL).indexOf("paid"), -1);
  assert.equal(bill.pickupLine(CAMARA).indexOf("unpaid"), -1);
  assert.equal(bill.pickupLine(CAMARA).indexOf("href"), -1);
});

test("paid and unpaid words follow an actual payment record", function () {
  const paid = { prepaidInvoiceNo: "000554", sqInvoice: { paid: true, status: "PAID" } };
  const unpaid = { prepaidInvoiceNo: "000574", prepaid: false, prepaidVia: "square_invoice", payState: "invoice_pending" };
  const squareUnpaid = { prepaidInvoiceNo: "000574", sqInvoice: { status: "UNPAID", paid: false } };
  const cash = { prepaidInvoiceNo: "000554", assignedDriverId: "mwragge_privatetaxiservices_net", paidCash: { by: "driver", driverId: "mwragge_privatetaxiservices_net" } };
  assert.equal(bill.pay(paid), "paid");
  assert.equal(bill.bar(paid), "Invoice #000554 \u2013 paid");
  assert.equal(bill.pay(unpaid), "unpaid");
  assert.equal(bill.bar(unpaid), "Invoice #000574 \u2013 unpaid");
  assert.equal(bill.pay(squareUnpaid), "unpaid");
  assert.equal(bill.pay(cash), "paid");
  assert.equal(bill.pay({ prepaidInvoiceNo: "000554", prepaid: false }), "");
  assert.equal(bill.pay({ prepaidInvoiceNo: "000574", prepaidVia: "square_invoice" }), "");
  assert.equal(bill.bar(paid).indexOf("href"), -1);
});

test("the ride map bar does not add a second invoice row", function () {
  const rfs = appSrc.slice(appSrc.indexOf("function rfsBarHtml"), appSrc.indexOf("function rfsBarClick"));
  const place = appSrc.slice(appSrc.indexOf("function schedMapBillPlace"), appSrc.indexOf("function schedFsMeasure"));
  assert.equal(rfs.indexOf("rideBillLabelHtml"), -1);
  assert.ok(rfs.indexOf('id="rfs-bill"') >= 0);
  assert.match(place, /host\.remove/);
  assert.doesNotMatch(place, /insertBefore/);
  assert.match(appSrc, /sqInvoice: raw\.sqInvoice/);
});

test("the public tracker keeps a real Square link only beside the matching pay word", function () {
  const now = Date.now();
  const bare = clean({ status: "picked_up", bill: "invoiced", invoiceNo: "000554", driverName: "Pat" }, now);
  assert.equal(bare.invoiceNo, "000554");
  assert.equal(bare.pay, undefined);
  assert.equal(bare.payUrl, undefined);
  assert.equal(bare.receiptUrl, undefined);
  const via = clean(Object.assign({ status: "picked_up", bill: "invoiced", invoiceNo: "000574", payUrl: PAY, receiptUrl: RECEIPT }, { pay: "" }), now);
  assert.equal(via.payUrl, undefined);
  assert.equal(via.receiptUrl, undefined);
  const owed = clean({ status: "picked_up", bill: "invoiced", pay: "unpaid", invoiceNo: "000574", payUrl: PAY, receiptUrl: RECEIPT }, now);
  assert.equal(owed.pay, "unpaid");
  assert.equal(owed.payUrl, PAY);
  assert.equal(owed.receiptUrl, undefined);
  const done = clean({ status: "picked_up", bill: "invoiced", pay: "paid", invoiceNo: "000554", payUrl: PAY, receiptUrl: RECEIPT }, now);
  assert.equal(done.pay, "paid");
  assert.equal(done.receiptUrl, RECEIPT);
  assert.equal(done.payUrl, undefined);
  const evil = clean({ status: "picked_up", pay: "unpaid", payUrl: "https://evil.example/pay", invoiceNo: "000574" }, now);
  assert.equal(evil.payUrl, undefined);
  assert.equal(live.bill({ status: "picked_up", pay: "unpaid", invoiceNo: "000574", payUrl: PAY }).link.text, "Pay now");
  assert.equal(live.bill({ status: "completed", pay: "unpaid", invoiceNo: "000574", payUrl: PAY }).link, null);
  assert.equal(live.bill({ status: "picked_up", pay: "paid", invoiceNo: "000554", receiptUrl: RECEIPT }).link.text, "View receipt");
  assert.equal(live.bill({ status: "picked_up", invoiceNo: "000554" }).label, "Invoice #000554");
  assert.equal(live.bill({ status: "picked_up", invoiceNo: "000554" }).link, null);
  assert.equal(live.bill({ status: "picked_up", pay: "unpaid", payUrl: "javascript:alert(1)" }).link, null);
});

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

function driverPage(kind, text, w, h) {
  const css = quotedCss(appSrc.slice(appSrc.indexOf("function schedFullStyle"), appSrc.indexOf("function schedFullResize"))) +
    quotedCss(appSrc.slice(appSrc.indexOf("function fsStyle"), appSrc.indexOf("function rfsKey")));
  const rfs = kind === "rfs";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#123}
    .leaflet-top,.leaflet-left{position:absolute}
    .leaflet-bar a{display:block;width:44px;height:44px;line-height:44px;background:#fff;color:#000;text-align:center;text-decoration:none}
    ${css}
    #home-map-stage{--pcs-safe-top:47px;--pcs-safe-bottom:34px;--pcs-safe-left:0px;--pcs-safe-right:0px}
  </style></head><body>
  <div id="${rfs ? "meter-map-stage" : "home-map-stage"}" class="${rfs ? "pcs-rfs" : "pcs-fullmap"}" style="position:relative;width:${w}px;height:${h}px">
    <div class="leaflet-top leaflet-left"><div class="leaflet-control-zoom leaflet-bar"><a id="zoom-out" href="#">−</a></div></div>
    ${rfs ? "" : '<div id="sched-fs-top" style="height:72px;background:#20371d;color:#fff">In 0.4 mi · about 2 min</div>'}
    <div class="nav-toggle" style="position:absolute;right:8px;display:flex;gap:6px;z-index:1004">
      <button type="button" id="map-orient-toggle" style="min-height:36px">North up</button>
      <button type="button" id="map-mode-toggle" style="min-height:36px">Follow</button>
    </div>
    ${rfs
      ? '<div id="rfs-bar" role="region" aria-label="Ride"><div class="rfs-row"><p class="rfs-bill" id="rfs-bill">' + text + '</p><div class="rfs-stats"><span><b>1.20</b> mi</span><span><b>0:12</b></span></div></div><div class="rfs-actions"><button type="button" class="rfs-end" id="rfs-end">End ride</button><button type="button" class="rfs-close" id="sched-fs-close">Close map</button></div></div>'
      : '<div id="sched-fs-bottom"><button type="button" id="sched-fs-arrived">' + text + '</button><button type="button" id="sched-fs-close">Close map</button></div>'}
  </div>
  <script>
    var stage = document.getElementById("${rfs ? "meter-map-stage" : "home-map-stage"}");
    var bar = document.getElementById("${rfs ? "rfs-bar" : "sched-fs-bottom"}");
    if (stage.style.setProperty) stage.style.setProperty("${rfs ? "--rfs-bar" : "--sched-fs-bar"}", bar.offsetHeight + "px");
    if (!${rfs ? "true" : "false"} && stage.style.setProperty) stage.style.setProperty("--sched-fs-top", "84px");
    ["map-mode-toggle","map-orient-toggle","zoom-out","sched-fs-close"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", function (e) { if (e.preventDefault) e.preventDefault(); el.dataset.n = String(Number(el.dataset.n || 0) + 1); });
    });
    function hit(id) {
      var el = document.getElementById(id); if (!el) return { id: id, hit: "missing" };
      var r = el.getBoundingClientRect();
      var x = Math.round(r.left + Math.min(r.width / 2, 18));
      var y = Math.round(r.top + Math.min(r.height / 2, 16));
      var got = document.elementFromPoint(x, y);
      var bill = document.getElementById("sched-fs-arrived") || document.getElementById("rfs-bill");
      return { id: id, x: x, y: y, top: r.top, bottom: r.bottom, left: r.left, hit: got ? (got.id || got.className || got.tagName) : "",
        bill: bill ? bill.textContent : "", clip: bill ? bill.scrollWidth > bill.clientWidth + 2 : false,
        links: document.querySelectorAll("a[href]").length, host: !!document.getElementById("sched-bill-host"), label: !!document.querySelector(".pcs-bill-label"),
        rows: document.querySelectorAll(".pcs-bill-label,.rfs-bill,#sched-fs-arrived").length };
    }
    document.body.dataset.report = JSON.stringify(["map-orient-toggle","map-mode-toggle","zoom-out","sched-fs-close"].map(hit));
  </script></body></html>`;
}

function customerPage(model, w, h) {
  const link = model.link ? ' · <a id="' + model.link.id + '" href="' + model.link.href + '">' + model.link.text + "</a>" : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#e8f5e9}
    #fl-live{position:relative;width:${w}px;height:${h}px;box-sizing:border-box;background:#f0fdf4;color:#0b3d23;padding:12px}
    #fl-live p{color:#0b3d23}.fl-status{display:block;margin:0 0 8px;padding:10px 12px;border-radius:12px;background:#0b6b3a;color:#fff !important;font-size:21px;font-weight:900;text-align:center}
    .fl-head{position:relative;min-height:68px;margin:0 0 6px;padding:2px 76px 2px 0}
    .fl-photo{position:absolute;top:0;right:0;width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #0b3d23;background:#cde}
    #fl-bill{margin:0 0 8px;padding:6px 10px;border-radius:12px;border:2px solid #0b6b3a;background:#fff;color:#0b3d23;font-size:19px;font-weight:900;text-align:center}
    #fl-map{position:relative;height:${Math.max(220, h - 230)}px;border:2px solid #0b3d23;background:#ddd}
    #fl-north{position:absolute;top:8px;right:8px;width:40px;height:48px;background:#fff;border:3px solid #0b3d23}
    #zoom-out{position:absolute;top:8px;left:8px;width:44px;height:44px}
  </style></head><body>
  <div id="fl-live">
    <p class="fl-status" id="fl-status">On the ride</p>
    <div class="fl-head" id="fl-head"><div><p class="fl-who" id="fl-who">Your PCS driver: Matt</p><p class="fl-car" id="fl-car">Black sedan</p></div>
      <img class="fl-photo" id="fl-photo" alt="Your PCS driver" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>
    <p class="fl-bill" id="fl-bill">${model.label || ""}${link}</p>
    <div id="fl-map"><button type="button" id="zoom-out">−</button><div id="fl-north">N</div></div>
  </div>
  <script>
    ["fl-pay","fl-receipt","zoom-out"].forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      el.addEventListener("click", function (e) { e.preventDefault(); el.dataset.n = "1"; });
    });
    function box(id) { var el = document.getElementById(id), r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width }; }
    var photo = box("fl-photo"), statusBox = box("fl-status"), map = box("fl-map"), north = box("fl-north"), billBox = box("fl-bill");
    var pay = document.getElementById("fl-pay"), receipt = document.getElementById("fl-receipt");
    document.body.dataset.report = JSON.stringify({ photo: photo, statusBox: statusBox, map: map, north: north, bill: billBox,
      text: document.getElementById("fl-bill").textContent, pay: pay ? pay.getAttribute("href") : "", receipt: receipt ? receipt.getAttribute("href") : "" });
  </script></body></html>`;
}

function chromeSession(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-inv-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=1100,1200", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, server: server, chrome: chrome, debug: port + 100 };
}

test("full-page map and tracker keep the invoice on one line and the controls hittable", async function () {
  const port = 8794;
  const session = chromeSession(port);
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
    async function open(name, html) {
      fs.writeFileSync(path.join(session.dir, name), html);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" + name }, sid);
      let report = "";
      for (let i = 0; i < 30 && !report; i++) {
        const msg = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.report || ''", returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(150);
      }
      assert.ok(report, name + " did not report");
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      fs.writeFileSync("/opt/cursor/artifacts/invoice-" + name.replace(".html", "") + ".png", Buffer.from(shot.result.data, "base64"));
      return JSON.parse(report);
    }
    const pages = [
      ["554-portrait.html", driverPage("pickup", bill.pickupLine(RAHUAL), 768, 1024)],
      ["574-portrait.html", driverPage("pickup", bill.pickupLine(CAMARA), 768, 1024)],
      ["554-landscape.html", driverPage("pickup", bill.pickupLine(RAHUAL), 1024, 768)],
      ["574-rfs.html", driverPage("rfs", bill.bar(CAMARA), 768, 1024)],
      ["554-paid-rfs.html", driverPage("rfs", bill.bar({ prepaidInvoiceNo: "000554", sqInvoice: { paid: true, status: "PAID" } }), 768, 1024)]
    ];
    for (const pair of pages) {
      const hits = await open(pair[0], pair[1]);
      hits.forEach(function (row) {
        assert.equal(row.hit, row.id, pair[0] + " " + row.id + " hit " + row.hit);
        assert.equal(row.clip, false, pair[0] + " clipped " + row.bill);
        assert.equal(row.links, 1, pair[0] + " unexpected link");
        assert.equal(row.host, false);
        assert.equal(row.label, false);
      });
      const zoom = hits.filter(function (row) { return row.id === "zoom-out"; })[0];
      if (pair[0].indexOf("rfs") < 0) assert.ok(zoom.top >= 47, pair[0] + " zoom is under the status area");
    }
    await send("Runtime.evaluate", { expression: "document.getElementById('map-mode-toggle').click(); document.getElementById('map-orient-toggle').click(); document.getElementById('zoom-out').click(); document.getElementById('sched-fs-close').click();", returnByValue: true }, sid);
    const tapped = await send("Runtime.evaluate", { expression: "JSON.stringify({mode:document.getElementById('map-mode-toggle').dataset.n,orient:document.getElementById('map-orient-toggle').dataset.n,zoom:document.getElementById('zoom-out').dataset.n,close:document.getElementById('sched-fs-close').dataset.n,bill:document.getElementById('rfs-bill').textContent})", returnByValue: true }, sid);
    const got = JSON.parse(tapped.result.result.value);
    assert.equal(got.mode, "1");
    assert.equal(got.orient, "1");
    assert.equal(got.zoom, "1");
    assert.equal(got.close, "1");
    assert.equal(got.bill, "Invoice #000554 – paid");
    const bare = await open("tracker-554.html", customerPage(live.bill({ status: "picked_up", invoiceNo: "000554", driverName: "Matt" }), 768, 1024));
    assert.equal(bare.text, "Invoice #000554");
    assert.equal(bare.pay, "");
    assert.equal(bare.receipt, "");
    assert.ok(bare.photo.top + 8 >= bare.statusBox.bottom, "photo overlaps the green bar " + JSON.stringify({ photo: bare.photo, status: bare.statusBox }));
    assert.ok(bare.photo.left > 768 / 2, "photo is not on the right");
    assert.ok(bare.photo.bottom <= bare.map.top + 1, "photo covers the map");
    assert.ok(bare.north.top >= bare.map.top, "north control left the map");
    const owed = await open("tracker-574-unpaid.html", customerPage(live.bill({ status: "picked_up", pay: "unpaid", invoiceNo: "000574", payUrl: PAY }), 390, 844));
    assert.ok(owed.text.indexOf("Unpaid") >= 0 && owed.text.indexOf("Pay now") >= 0);
    assert.equal(owed.pay, PAY);
    assert.ok(owed.photo.bottom <= owed.bill.top + 1, "photo covers the white bar");
    await send("Runtime.evaluate", { expression: "document.getElementById('fl-pay').click()", returnByValue: true }, sid);
    const payN = await send("Runtime.evaluate", { expression: "document.getElementById('fl-pay').dataset.n", returnByValue: true }, sid);
    assert.equal(payN.result.result.value, "1");
    const paid = await open("tracker-554-paid.html", customerPage(live.bill({ status: "picked_up", pay: "paid", invoiceNo: "000554", receiptUrl: RECEIPT, payUrl: PAY }), 768, 1024));
    assert.ok(paid.text.indexOf("Paid") >= 0 && paid.text.indexOf("View receipt") >= 0);
    assert.equal(paid.text.indexOf("Pay now"), -1);
    assert.equal(paid.receipt, RECEIPT);
    assert.equal(paid.pay, "");
    await send("Runtime.evaluate", { expression: "document.getElementById('fl-receipt').click()", returnByValue: true }, sid);
    const recN = await send("Runtime.evaluate", { expression: "document.getElementById('fl-receipt').dataset.n", returnByValue: true }, sid);
    assert.equal(recN.result.result.value, "1");
    assert.match(followSrc, /\.fl-photo\{position:absolute;top:0;right:0/);
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
  }
});
