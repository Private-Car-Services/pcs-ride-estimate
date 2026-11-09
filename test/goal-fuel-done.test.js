/* Portrait Done: the touch that closes the pad must not be followed by the pad opening again. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <script>
    try { Object.defineProperty(window, "indexedDB", { configurable: true, value: { open: function () { return {}; } } }); }
    catch (e) {}
    localStorage.setItem("pcs-god-keep-v1", JSON.stringify({ email: "mwragge78@gmail.com" }));
    localStorage.setItem("pcsGoalSysKb", "1");
    var module = { exports: {} };
  </script>
  <script src="/god/goal.js"></script>
  <script>
    window.__bootFuel = function () {
      window.__pcsGoalOpen();
      module.exports._set({ settings: {}, entries: {}, fuel: { seed: { odo: 100000, at: 1 } } });
      module.exports.paint();
      return true;
    };
    window.__box = function (sel) {
      var el = typeof sel === "string" && sel.charAt(0) !== "#" ? document.querySelector(sel) : document.querySelector(sel);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: r.top, bottom: r.bottom };
    };
  </script></body></html>`;
}

test("Done touch in a long portrait sequence stays closed at the next instant", async function () {
  const port = 8857;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-done-"));
  const html = path.join(__dirname, "fuel-done.html");
  fs.writeFileSync(html, page());
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", path.join(__dirname, "..")], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--force-device-scale-factor=1", "--window-size=390,844",
    "--remote-debugging-port=" + (port + 100),
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
    async function ev(expr) {
      const msg = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid);
      if (!msg.result || !msg.result.result) throw new Error(JSON.stringify(msg).slice(0, 500));
      return msg.result.result.value;
    }
    async function point(kind, x, y) {
      if (kind === "mouse") {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x, y: y, button: "left", clickCount: 1 }, sid);
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x, y: y, button: "left", clickCount: 1 }, sid);
      } else {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x, y: y }] }, sid);
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sid);
      }
    }
    async function tapKey(kind, k) {
      const box = await ev("window.__box('#gl-kp button[data-k=\"" + k + "\"]')");
      assert.ok(box && box.x, k + " " + JSON.stringify(box));
      await point(kind, box.x, box.y);
      await wait(30);
    }
    const runs = [
      [390, 844, "touch", "portrait long"],
      [390, 844, "touch", "portrait isolated"],
      [390, 844, "mouse", "portrait mouse"],
      [1024, 768, "touch", "landscape touch"],
      [1024, 768, "mouse", "landscape mouse"]
    ];
    for (const run of runs) {
      await send("Emulation.setDeviceMetricsOverride", { width: run[0], height: run[1], deviceScaleFactor: 1, mobile: run[1] > run[0] }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/test/fuel-done.html" }, sid);
      let ready = false;
      for (let i = 0; i < 30 && !ready; i++) { ready = await ev("!!window.__bootFuel"); if (!ready) await wait(100); }
      assert.ok(ready, run[3] + " did not load");
      assert.equal(await ev("(function(){ try { return String(window.__bootFuel()); } catch (e) { return e.stack; } })()"), "true", run[3]);
      await ev("(function(){ var el = document.getElementById('gl-fuel-price'); var sc = document.getElementById('gl-screen'); var r = el.getBoundingClientRect(); sc.scrollTop += r.bottom - (window.innerHeight - 120); })()");
      await wait(30);
      const field = await ev("window.__box('#gl-fuel-price')");
      await point(run[2], field.x, field.y);
      await wait(40);
      const keys = run[3] === "portrait isolated" ? ["5"] : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
      for (const k of keys) await tapKey(run[2], k);
      const before = Date.now();
      await tapKey(run[2], "done");
      const samples = [];
      for (const delay of [0, 50, 300]) {
        if (delay) await wait(delay === 50 ? 50 : 250);
        const shown = await ev("document.getElementById('gl-kp') && document.getElementById('gl-kp').style.display");
        samples.push({ ms: Date.now() - before, shown: shown });
      }
      samples.forEach(function (s) { assert.equal(s.shown, "none", run[3] + " pad open " + JSON.stringify(samples)); });
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
    try { fs.unlinkSync(html); } catch (e) {}
  }
});
