/* Placement only: the customer tracker photo sits top-right, under the green bar, clear of the map controls. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../follow/follow-live.js"), "utf8");
const shell = src.slice(src.indexOf("function shell"), src.indexOf("function draw"));

test("the photo is the right-hand corner under the green bar and the picture guards are untouched", function () {
  assert.ok(shell.indexOf('id="fl-status"') < shell.indexOf('id="fl-under"'));
  assert.ok(shell.indexOf('id="fl-under"') < shell.indexOf('id="fl-photo"'));
  assert.ok(shell.indexOf('class="fl-under-main"') < shell.indexOf('id="fl-photo"'));
  assert.ok(shell.indexOf('<img class="fl-photo" id="fl-photo"') >= 0);
  assert.ok(shell.indexOf('id="fl-drv"') < shell.indexOf('<img class="fl-photo"'));
  assert.equal(shell.slice(shell.indexOf('id="fl-drv"'), shell.indexOf("</div></div>")).indexOf("<img"), -1);
  assert.match(src, /function trackerPhotoSrc/);
  assert.match(src, /function applyTrackerPhoto/);
  assert.match(src, /card jpeg first/);
  assert.doesNotMatch(shell, /Pay now|View receipt|Invoice #/);
});

const SIZES = [
  ["phone-portrait", 390, 844],
  ["phone-landscape", 844, 390],
  ["ipad-portrait", 768, 1024],
  ["ipad-landscape", 1024, 768]
];

function chromeSession(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-photo-"));
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", path.join(__dirname, "..")], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=1100,1200", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, server: server, chrome: chrome, debug: port + 100 };
}

test("the synthetic driver photo stays under the green bar and off the map controls", async function () {
  const port = 8796;
  const session = chromeSession(port);
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
  const token = "a".repeat(32);
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
    const billOnScreen = `
      (function () {
        var now = Date.now();
        window.__pcsFollowLive.update({
          status: "on_way", driverFirst: "Matt", bill: "invoiced", invoiceNo: "000562",
          sqInvoice: { status: "DRAFT", paid: false, checkedAt: now },
          car: { color: "Black", year: "2022", make: "Cadillac", model: "XTS", plate: "PCS1" },
          photo: document.getElementById("fl-photo").src,
          pickup: { label: "1200 Smith St, Houston", lat: 29.76, lng: -95.36 },
          dest: { label: "IAH Airport", lat: 29.99, lng: -95.34 },
          eta: { min: 12, miles: 6.4, to: "pickup" }, etaAt: now,
          pos: { lat: 29.75, lng: -95.37, at: now }, updatedAt: now
        });
        var bill = document.getElementById("fl-call");
        var status = document.getElementById("fl-status");
        var photo = document.getElementById("fl-photo").getBoundingClientRect();
        var br = bill.getBoundingClientRect();
        var sr = status.getBoundingClientRect();
        var phone = document.querySelector(".phone").getBoundingClientRect();
        var sos = getComputedStyle(document.getElementById("fl-sos-btn"));
        var overlap = !(photo.bottom <= br.top + 1 || photo.top >= br.bottom - 1 || photo.right <= br.left + 1 || photo.left >= br.right - 1);
        var bg = getComputedStyle(bill).backgroundColor;
        var statusBg = getComputedStyle(status).backgroundColor;
        return JSON.stringify({
          text: bill.textContent, status: status.textContent, hidden: !!bill.hidden, bg: bg, statusBg: statusBg,
          top: Math.round(sr.top), bottom: Math.round(sr.bottom), h: Math.round(sr.height),
          phoneTop: Math.round(phone.top), phoneBottom: Math.round(phone.bottom),
          inView: sr.height >= 20 && sr.top >= phone.top - 1 && sr.bottom <= phone.bottom + 1 && sr.left >= phone.left - 1 && sr.right <= phone.right + 1,
          overlap: overlap, pinned: document.getElementById("fl-live").classList.contains("fl-has-bill"),
          sosPos: sos.position, sosTop: Math.round(parseFloat(sos.top) || 0), sosRight: sos.right,
          green: statusBg === "rgb(11, 107, 58)" && bg === "rgb(11, 107, 58)"
        });
      })()
    `;
    const paint = `
      (function () {
        var c = document.createElement("canvas"); c.width = 128; c.height = 128;
        var g = c.getContext("2d");
        g.fillStyle = "#1d4e89"; g.fillRect(0, 0, 128, 128);
        g.fillStyle = "#f3ead2"; g.beginPath(); g.arc(64, 50, 28, 0, 6.2832); g.fill();
        g.fillStyle = "#0b3d23"; g.fillRect(36, 92, 56, 28);
        var photo = c.toDataURL("image/jpeg", 0.85);
        var now = Date.now();
        window.__pcsFollowLive.update({
          status: "on_way", driverFirst: "Matt",
          car: { color: "Black", year: "2022", make: "Cadillac", model: "XTS", plate: "PCS1" },
          photo: photo, bill: "invoiced",
          pickup: { label: "1200 Smith St, Houston", lat: 29.76, lng: -95.36 },
          dest: { label: "IAH Airport", lat: 29.99, lng: -95.34 },
          eta: { min: 12, miles: 6.4, to: "pickup" }, etaAt: now,
          pos: { lat: 29.75, lng: -95.37, at: now }, updatedAt: now
        });
        function box(sel) {
          var el = sel.charAt(0) === "." ? document.querySelector(sel) : document.getElementById(sel);
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
        }
        function overlap(a, b) {
          if (!a || !b || a.h < 1 || b.h < 1) return false;
          return !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1 || a.right <= b.left + 1 || a.left >= b.right - 1);
        }
        var photoBox = box("fl-photo"), status = box("fl-status"), map = box("fl-map"), live = box("fl-live");
        var north = box("fl-north"), zoom = box(".leaflet-control-zoom");
        var sos = box("fl-sos-btn"), phone = box(".phone");
        function hit(x, y) {
          var el = document.elementFromPoint(x, y);
          return el ? (el.id || el.tagName) : "";
        }
        var inset = 4;
        var cx = photoBox.left + photoBox.w / 2, cy = photoBox.top + photoBox.h / 2;
        var photoHits = [
          hit(cx, photoBox.top + inset),
          hit(cx, photoBox.bottom - inset),
          hit(photoBox.left + inset, cy),
          hit(photoBox.right - inset, cy),
          hit(cx, cy)
        ];
        return JSON.stringify({
          photo: photoBox, status: status, map: map, live: live, north: north, zoom: zoom,
          sos: sos, phone: phone, vw: window.innerWidth, vh: window.innerHeight,
          hidden: document.getElementById("fl-photo").hidden,
          overStatus: overlap(photoBox, status), overNorth: overlap(photoBox, north), overZoom: overlap(photoBox, zoom),
          overSos: overlap(photoBox, sos),
          sosHit: hit(sos.left + sos.w / 2, sos.top + sos.h / 2),
          photoHits: photoHits,
          text: document.getElementById("fl-who").textContent
        });
      })()
    `;
    for (const size of SIZES) {
      await send("Emulation.setDeviceMetricsOverride", { width: size[1], height: size[2], deviceScaleFactor: 1, mobile: true }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/follow/?t=" + token }, sid);
      let ready = false;
      for (let i = 0; i < 50 && !ready; i++) {
        const msg = await send("Runtime.evaluate", { expression: "!!(window.__pcsFollowLive && window.L && document.getElementById('app'))", returnByValue: true }, sid);
        ready = !!(msg.result && msg.result.result && msg.result.result.value);
        if (!ready) await wait(200);
      }
      assert.ok(ready, size[0] + " tracker did not load");
      let report = "";
      for (let i = 0; i < 10 && !report; i++) {
        const msg = await send("Runtime.evaluate", { expression: paint, returnByValue: true }, sid);
        report = msg.result && msg.result.result ? msg.result.result.value : "";
        if (!report) await wait(200);
      }
      const got = JSON.parse(report);
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      fs.writeFileSync("/opt/cursor/artifacts/tracker-photo-" + size[0] + ".png", Buffer.from(shot.result.data, "base64"));
      assert.equal(got.hidden, false, size[0] + " photo hidden");
      assert.ok(got.photo && got.photo.w >= 40, size[0] + " photo missing " + report);
      assert.ok(got.photo.top >= got.status.bottom - 1, size[0] + " photo overlaps the green bar " + report);
      assert.ok(got.photo.right >= got.live.right - 20, size[0] + " photo is not in the right corner " + report);
      assert.ok(got.photo.left > got.live.left + got.live.w / 2, size[0] + " photo is not on the right " + report);
      assert.ok(got.photo.bottom <= got.map.top + 1, size[0] + " photo covers the map " + report);
      assert.equal(got.overStatus, false, size[0] + " status overlap");
      assert.ok(got.north, size[0] + " north control missing");
      assert.ok(got.zoom, size[0] + " zoom control missing");
      assert.equal(got.overNorth, false, size[0] + " photo covers north");
      assert.equal(got.overZoom, false, size[0] + " photo covers zoom");
      assert.equal(got.overSos, false, size[0] + " SOS covers the photo " + report);
      assert.ok(got.sos && got.sos.w >= 44 && got.sos.h >= 44, size[0] + " SOS is too small " + report);
      assert.ok(got.sos.top >= 6, size[0] + " SOS is under the top edge " + report);
      assert.ok(Math.abs(got.phone.right - got.sos.right - 6) <= 2, size[0] + " SOS is not inset from the right edge " + report);
      assert.ok(got.sos.left >= -1 && got.sos.bottom <= got.vh + 1 && got.sos.right <= got.vw + 1, size[0] + " SOS is off screen " + report);
      assert.equal(got.sosHit, "fl-sos-btn", size[0] + " SOS is not the top control " + report);
      assert.ok(got.photoHits.every(function (id) { return id === "fl-photo"; }), size[0] + " photo is covered " + JSON.stringify(got.photoHits));
      assert.ok(got.north.top >= got.map.top - 1 && got.north.bottom <= got.map.bottom + 1, size[0] + " north left the map");
      assert.ok(got.zoom.left <= got.map.left + 30, size[0] + " zoom left the map");
      assert.equal(got.text, "Your PCS driver: Matt");
      const bareBill = await send("Runtime.evaluate", { expression: billOnScreen, returnByValue: true }, sid);
      const bare = JSON.parse(bareBill.result.result.value);
      assert.ok(bare.status.indexOf("Invoice #000562 · Unpaid") >= 0, size[0] + " " + bareBill.result.result.value);
      assert.equal(bare.text, "Unpaid", size[0] + " bottom alert " + bare.text);
      assert.equal(bare.hidden, false, size[0] + " unpaid alert hidden");
      assert.equal(bare.pinned, false, size[0] + " light bill bar is pinned");
      assert.equal(bare.overlap, false, size[0] + " invoice bar covers the photo");
      assert.equal(bare.inView, true, size[0] + " status line is off the phone " + bareBill.result.result.value);
      assert.equal(bare.green, true, size[0] + " bars are not dark green " + bare.statusBg + " " + bare.bg);
      assert.equal(bare.sosPos, "absolute", size[0] + " SOS position changed");
      assert.ok(bare.sosTop >= 6, size[0] + " SOS is not below the safe area");
      assert.equal(bare.sosRight, "6px", size[0] + " SOS right " + bare.sosRight);
    }
    const billExpr = `
      (function (kind) {
        var now = Date.now();
        var base = { status: "picked_up", driverFirst: "Matt", bill: "invoiced",
          car: { color: "Black", make: "Cadillac" }, photo: document.getElementById("fl-photo").src,
          pickup: { label: "1200 Smith St", lat: 29.76, lng: -95.36 }, updatedAt: now };
        if (kind === "paid") Object.assign(base, { invoiceNo: "000562", sqInvoice: { status: "PAID", paid: true, checkedAt: now }, receiptUrl: "https://squareup.com/receipt/preview/rcpt210" });
        else if (kind === "unpaid") Object.assign(base, { invoiceNo: "000562", sqInvoice: { status: "UNPAID", paid: false, checkedAt: now }, payUrl: "https://squareup.com/pay-invoice/inv574" });
        else Object.assign(base, { invoiceNo: "000562" });
        window.__pcsFollowLive.update(base);
        ["fl-pay","fl-receipt"].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.addEventListener("click", function (e) { e.preventDefault(); el.dataset.n = "1"; });
        });
        var bill = document.getElementById("fl-call");
        var statusEl = document.getElementById("fl-status");
        if (document.getElementById("fl-bill")) throw new Error("extra bill row");
        if (document.getElementById("fl-live").classList.contains("fl-has-bill")) throw new Error("light bill bar");
        if (document.body.textContent.indexOf("Questions? Call") >= 0) throw new Error("business call line remains");
        var a = bill.querySelector("a");
        var photo = document.getElementById("fl-photo").getBoundingClientRect();
        var status = statusEl.getBoundingClientRect();
        var map = document.getElementById("fl-map").getBoundingClientRect();
        var br = bill.getBoundingClientRect();
        var overlap = !bill.hidden && !(photo.bottom <= br.top + 1 || photo.top >= br.bottom - 1 || photo.right <= br.left + 1 || photo.left >= br.right - 1);
        return JSON.stringify({ text: bill.textContent, status: statusEl.textContent, hidden: !!bill.hidden, href: a ? a.getAttribute("href") : "", id: a ? a.id : "",
          photoTop: Math.round(photo.top), statusBottom: Math.round(status.bottom), mapTop: Math.round(map.top),
          photoRight: Math.round(photo.right), liveRight: Math.round(document.getElementById("fl-live").getBoundingClientRect().right),
          overlapBill: overlap });
      })
    `;
    async function showBill(kind, file) {
      const msg = await send("Runtime.evaluate", { expression: "(" + billExpr + ")(" + JSON.stringify(kind) + ")", returnByValue: true }, sid);
      const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
      fs.writeFileSync("/opt/cursor/artifacts/" + file, Buffer.from(shot.result.data, "base64"));
      return JSON.parse(msg.result.result.value);
    }
    const paid = await showBill("paid", "tracker-green-paid.png");
    assert.ok(paid.status.indexOf("Invoice #000562 · Paid") >= 0, paid.status);
    assert.equal(paid.text, "Paid · View receipt");
    assert.equal(paid.href, "https://squareup.com/receipt/preview/rcpt210");
    assert.equal(paid.id, "fl-receipt");
    assert.equal(paid.overlapBill, false);
    assert.ok(paid.photoTop >= paid.statusBottom - 1);
    assert.ok(paid.mapTop >= paid.photoTop);
    await send("Runtime.evaluate", { expression: "document.getElementById('fl-receipt').click()", returnByValue: true }, sid);
    const paidClick = await send("Runtime.evaluate", { expression: "document.getElementById('fl-receipt').dataset.n", returnByValue: true }, sid);
    assert.equal(paidClick.result.result.value, "1");
    const owed = await showBill("unpaid", "tracker-green-unpaid.png");
    assert.ok(owed.status.indexOf("Invoice #000562 · Unpaid") >= 0, owed.status);
    assert.equal(owed.text, "Unpaid · Pay invoice");
    assert.equal(owed.href, "https://squareup.com/pay-invoice/inv574");
    assert.equal(owed.id, "fl-pay");
    await send("Runtime.evaluate", { expression: "document.getElementById('fl-pay').click()", returnByValue: true }, sid);
    const payClick = await send("Runtime.evaluate", { expression: "document.getElementById('fl-pay').dataset.n", returnByValue: true }, sid);
    assert.equal(payClick.result.result.value, "1");
    const unknown = await showBill("bare", "tracker-green-number.png");
    assert.equal(unknown.hidden, true);
    assert.ok(unknown.status.indexOf("Invoice #000562") >= 0, unknown.status);
    assert.equal(unknown.status.indexOf("Unpaid"), -1);
    assert.equal(unknown.status.indexOf("Paid"), -1);
    assert.equal(unknown.href, "");
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
  }
});
