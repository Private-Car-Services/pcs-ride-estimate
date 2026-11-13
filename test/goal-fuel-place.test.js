/* Landscape and portrait: the open pad must not cover a fuel box, and each key types into the box that was tapped. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <script>
    try { Object.defineProperty(window, "indexedDB", { configurable: true, value: { open: function () { return {}; } } }); window.__idb = "stub " + String(indexedDB.open); }
    catch (e) { window.__idb = "fail " + e.message; }
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
  </script></body></html>`;
}

function chromeSession(port, width, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-fuel-"));
  const html = path.join(__dirname, "fuel-place.html");
  fs.writeFileSync(html, page());
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", path.join(__dirname, "..")], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--force-device-scale-factor=1", "--window-size=" + width + "," + height,
    "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
  return { dir: dir, server: server, chrome: chrome, debug: port + 100 };
}

function clickExpr(id) {
  return `(function () {
    var el = document.getElementById(${JSON.stringify(id)});
    var pad = document.getElementById("gl-kp");
    if (!el) return { missing: true };
    var r = el.getBoundingClientRect();
    var p = pad && pad.style.display !== "none" ? pad.getBoundingClientRect() : { top: 99999 };
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    var hit = document.elementFromPoint(x, y);
    return { x: x, y: y, top: r.top, bottom: r.bottom, padTop: p.top, covered: r.bottom > p.top - 1,
      hit: hit ? (hit.id || hit.getAttribute && hit.getAttribute("data-k") || hit.tagName) : "",
      self: !!(hit && (hit === el || el.contains(hit))) };
  })()`;
}

test("fuel fields stay above the pad and keep their own digits in both orientations", async function () {
  const port = 8841;
  const session = chromeSession(port, 1024, 768);
  const wait = (ms) => new Promise(function (r) { setTimeout(r, ms); });
  const sizes = [[1024, 768, "landscape"], [768, 1024, "portrait"]];
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
    const plan = [
      ["gl-fuel-price", ["4", "0", "5", "0"], "40.50"],
      ["gl-fuel-odo", ["1", "0", "0", "3", "7", "9"], "100379"],
      ["gl-fuel-gal", ["1", "8", "1", "5", "7"], "18.157"]
    ];
    for (const size of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false }, sid);
      for (const kind of ["mouse", "touch"]) {
        await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/test/fuel-place.html" }, sid);
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
          const msg = await send("Runtime.evaluate", { expression: "!!window.__bootFuel", returnByValue: true }, sid);
          ready = !!(msg.result && msg.result.result && msg.result.result.value);
          if (!ready) await wait(100);
        }
        assert.ok(ready, size[2] + " " + kind + " page did not load");
        const booted = await send("Runtime.evaluate", { expression: "(function(){ try { window.__bootFuel(); return window.__idb + ' price=' + !!document.getElementById('gl-fuel-price') + ' html=' + (document.getElementById('gl-app')||{innerHTML:''}).innerHTML.slice(0,120); } catch (e) { return 'BOOT ' + e.stack; } })()", returnByValue: true }, sid);
        if (!booted.result || !booted.result.result || String(booted.result.result.value).indexOf("price=true") < 0) throw new Error(size[2] + " " + kind + " boot " + JSON.stringify(booted).slice(0, 900));
        await wait(50);
        for (const step of plan) {
          const open = await send("Runtime.evaluate", { expression: "document.getElementById('gl-kp').style.display", returnByValue: true }, sid);
          if (!open.result.result.value || open.result.result.value === "none") {
            await send("Runtime.evaluate", { expression: `(function(){ var el = document.getElementById(${JSON.stringify(step[0])}); var sc = document.getElementById("gl-screen"); var r = el.getBoundingClientRect(); sc.scrollTop += r.bottom - (window.innerHeight - 100); })()`, returnByValue: true }, sid);
            await wait(30);
          }
          const where = await send("Runtime.evaluate", { expression: clickExpr(step[0]), returnByValue: true }, sid);
          if (!where.result || !where.result.result || where.result.result.value == null) throw new Error(size[2] + " " + kind + " " + step[0] + " " + JSON.stringify(where).slice(0, 800));
          const box = where.result.result.value;
          assert.equal(box.self, true, size[2] + " " + kind + " " + step[0] + " is not the element under the pointer " + JSON.stringify(box));
          if (kind === "mouse") {
            await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }, sid);
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 }, sid);
          } else {
            await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] }, sid);
            await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sid);
          }
          await wait(40);
          const after = await send("Runtime.evaluate", { expression: clickExpr(step[0]), returnByValue: true }, sid);
          const seen = after.result.result.value;
          assert.equal(seen.covered, false, size[2] + " " + kind + " " + step[0] + " covered after focus " + JSON.stringify(seen));
          for (const key of step[1]) {
            const keyBox = await send("Runtime.evaluate", { expression: `(function () { var b = document.querySelector('#gl-kp button[data-k="${key}"]'); var r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`, returnByValue: true }, sid);
            const k = keyBox.result.result.value;
            if (kind === "mouse") {
              await send("Input.dispatchMouseEvent", { type: "mousePressed", x: k.x, y: k.y, button: "left", clickCount: 1 }, sid);
              await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: k.x, y: k.y, button: "left", clickCount: 1 }, sid);
            } else {
              await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: k.x, y: k.y }] }, sid);
              await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sid);
            }
            await wait(20);
          }
          const values = await send("Runtime.evaluate", { expression: "JSON.stringify({price:document.getElementById('gl-fuel-price').value,odo:document.getElementById('gl-fuel-odo').value,gal:document.getElementById('gl-fuel-gal').value,cur:document.activeElement&&document.activeElement.id})", returnByValue: true }, sid);
          const got = JSON.parse(values.result.result.value);
          if (step[0] === "gl-fuel-price") assert.equal(got.price, step[2], size[2] + " " + kind + " price " + JSON.stringify(got));
          if (step[0] === "gl-fuel-odo") {
            assert.equal(got.odo, step[2], size[2] + " " + kind + " odo " + JSON.stringify(got));
            assert.equal(got.price, "40.50", size[2] + " " + kind + " price changed while typing odometer " + JSON.stringify(got));
          }
          if (step[0] === "gl-fuel-gal") {
            assert.equal(got.gal, step[2], size[2] + " " + kind + " gallons " + JSON.stringify(got));
            assert.equal(got.price, "40.50", size[2] + " " + kind + " price changed while typing gallons " + JSON.stringify(got));
            assert.equal(got.odo, "100379", size[2] + " " + kind + " odometer changed while typing gallons " + JSON.stringify(got));
          }
        }
      }
    }
    ws.close();
  } finally {
    session.chrome.kill("SIGKILL");
    session.server.kill("SIGKILL");
    try { fs.unlinkSync(path.join(__dirname, "fuel-place.html")); } catch (e) {}
  }
});
