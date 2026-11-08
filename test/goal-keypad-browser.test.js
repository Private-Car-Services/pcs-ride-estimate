/* Real Chrome pointer clicks: repeat PIN and tip must receive the digit, not the field the pad opened on. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-kp-"));
  fs.symlinkSync(path.join(__dirname, "../god"), path.join(dir, "god"));
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
try { localStorage.setItem("pcsGoalSysKb", "1"); } catch (e) {}
window.module = { exports: {} };
(function () {
  var fake = { open: function () { return {}; } };
  try { Object.defineProperty(window, "indexedDB", { configurable: true, get: function () { return fake; } }); } catch (e) {}
})();
window.fetch = function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve(null); } }); };
</script>
<script src="god/goal.js"></script>
<script>
function box(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  var r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: r.top, bottom: r.bottom };
}
function hit(id) {
  var b = box(id);
  if (!b) return { id: id, missing: true };
  var el = document.elementFromPoint(b.x, b.y);
  return { id: id, x: b.x, y: b.y, hit: el ? (el.id || (el.getAttribute && el.getAttribute("data-k")) || el.tagName) : "none" };
}
function keyBox(k) {
  var keys = document.querySelectorAll("#gl-kp [data-k]");
  for (var i = 0; i < keys.length; i++) if (keys[i].getAttribute("data-k") === k) return box(keys[i].id) || (function () {
    var r = keys[i].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })();
  return null;
}
window.__keyBox = keyBox;
window.__hit = hit;
window.__pcsGoalOpen();
setTimeout(function () { window.__pcsGoalFirstRun(); document.body.dataset.phase = "pin"; }, 100);
window.__showMoney = function () {
  var T = "2026-11-08";
  module.exports._set({ entries: { a: { date: T, line: "pcs", amount: 3, note: "", at: Date.parse(T + "T18:00:00Z"), source: "manual" } }, dayHrs: {}, adj: {}, settings: { fix76j: 1, daySnap: { date: T, goal: 1, weekly: 1, weekBeforeToday: 0, daysLeft: 1, sunWork: false, typed: false, at: 1, recalc: false } } });
  module.exports._setApp(document.getElementById("gl-app"));
  module.exports.paint();
  window.__pcsKpShow(document.getElementById("gl-q-amt"));
  document.body.dataset.phase = "money";
};
window.__showUnlock = function () {
  window.__pcsGoalPinScreen({ fails: 0, exp: Date.now() + 3600000 });
  document.body.dataset.phase = "unlock";
};
</script></body></html>`);
  const port = 8777;
  const debug = 9241;
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=820,700", "--remote-debugging-port=" + debug,
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, port: port, debug: debug, server: server, chrome: chrome };
}

test("Chrome pointer clicks switch the repeat PIN and the tip onto the compact pad", async function () {
  const session = start();
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
  try {
    let ver;
    for (let i = 0; i < 40 && !ver; i++) {
      try { ver = await fetch("http://127.0.0.1:" + session.debug + "/json/version").then(function (r) { return r.json(); }); }
      catch (e) { await wait(200); }
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
    async function ev(expression) {
      const msg = await send("Runtime.evaluate", { expression: expression, returnByValue: true }, sid);
      return msg.result && msg.result.result ? msg.result.result.value : undefined;
    }
    async function clickAt(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x, y: y, button: "left", clickCount: 1 }, sid);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x, y: y, button: "left", clickCount: 1 }, sid);
      await wait(40);
    }
    async function clickKey(k) {
      const raw = await ev("JSON.stringify(window.__keyBox(" + JSON.stringify(k) + "))");
      const b = JSON.parse(raw);
      assert.ok(b && b.x, "missing key " + k);
      await clickAt(b.x, b.y);
    }
    await send("Page.navigate", { url: "http://127.0.0.1:" + session.port + "/index.html" }, sid);
    let phase = "";
    for (let i = 0; i < 40 && phase !== "pin"; i++) { phase = await ev("document.body.dataset.phase || ''"); if (phase !== "pin") await wait(150); }
    assert.equal(phase, "pin");
    await wait(80);
    const pinHit = JSON.parse(await ev("JSON.stringify({p1:window.__hit('gl-pin1'),p2:window.__hit('gl-pin2'),focus:document.activeElement&&document.activeElement.id||''})"));
    assert.equal(pinHit.p2.hit, "gl-pin2", "repeat PIN is covered by " + pinHit.p2.hit);
    assert.equal(pinHit.p1.hit, "gl-pin1");
    assert.notEqual(pinHit.focus, "gl-pin1");
    assert.notEqual(pinHit.focus, "gl-pin2");
    await clickAt(pinHit.p2.x, pinHit.p2.y);
    await clickKey("7");
    const pins = JSON.parse(await ev("JSON.stringify({a:document.getElementById('gl-pin1').value,b:document.getElementById('gl-pin2').value})"));
    assert.equal(pins.a, "");
    assert.equal(pins.b, "7");
    fs.writeFileSync("/opt/cursor/artifacts/keypad-repeat-pin.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sid)).result.data, "base64"));
    await ev("window.__showMoney()");
    await wait(80);
    const moneyHit = JSON.parse(await ev("JSON.stringify({ride:window.__hit('gl-q-amt'),tip:window.__hit('gl-q-tip'),note:window.__hit('gl-q-note')})"));
    assert.equal(moneyHit.tip.hit, "gl-q-tip", "tip is covered by " + moneyHit.tip.hit);
    assert.equal(moneyHit.ride.hit, "gl-q-amt");
    const note = JSON.parse(await ev("JSON.stringify({mode:document.getElementById('gl-q-note').getAttribute('inputmode'),ro:document.getElementById('gl-q-note').readOnly,kp:document.getElementById('gl-q-note').getAttribute('data-kp')})"));
    assert.notEqual(note.mode, "none");
    assert.equal(note.ro, false);
    assert.equal(note.kp, null);
    await clickAt(moneyHit.tip.x, moneyHit.tip.y);
    await clickKey("5"); await clickKey("0"); await clickKey("0");
    let vals = JSON.parse(await ev("JSON.stringify({ride:document.getElementById('gl-q-amt').value,tip:document.getElementById('gl-q-tip').value})"));
    assert.equal(vals.tip, "5.00");
    assert.equal(vals.ride, "");
    await clickAt(moneyHit.ride.x, moneyHit.ride.y);
    await clickKey("9"); await clickKey("6"); await clickKey("2"); await clickKey("5");
    vals = JSON.parse(await ev("JSON.stringify({ride:document.getElementById('gl-q-amt').value,tip:document.getElementById('gl-q-tip').value})"));
    assert.equal(vals.ride, "96.25");
    assert.equal(vals.tip, "5.00");
    fs.writeFileSync("/opt/cursor/artifacts/keypad-ride-tip.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sid)).result.data, "base64"));
    await clickKey("bs");
    assert.equal(await ev("document.getElementById('gl-q-amt').value"), "9.62");
    await clickKey("done");
    assert.equal(await ev("document.getElementById('gl-kp').style.display"), "none");
    await clickAt(moneyHit.note.x, moneyHit.note.y);
    assert.equal(await ev("document.activeElement && document.activeElement.id"), "gl-q-note");
    await ev("window.__showUnlock()");
    await wait(50);
    const unlock = JSON.parse(await ev("JSON.stringify(window.__hit('gl-pin'))"));
    assert.equal(unlock.hit, "gl-pin");
    assert.notEqual(await ev("document.activeElement && document.activeElement.id"), "gl-pin");
    for (const k of ["0", "1", "2", "3"]) await clickKey(k);
    assert.equal(await ev("document.getElementById('gl-pin').value"), "0123");
    await clickKey("9");
    assert.equal(await ev("document.getElementById('gl-pin').value"), "0123");
    const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
    fs.writeFileSync("/opt/cursor/artifacts/keypad-switch-proof.png", Buffer.from(shot.result.data, "base64"));
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
  }
});
