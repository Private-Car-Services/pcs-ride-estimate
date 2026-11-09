/* iPad-size touch order: Ride amount, Tip, Note, then Ride amount again.
   The note uses the iOS keyboard. The nine-key pad closes for it and returns for amount or tip. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<script src="goal.js"></script>
<script>
window.__boot = function () {
  window.__pcsGoalOpen();
  var ov = document.getElementById("gl-screen");
  var row = document.createElement("form");
  row.id = "gl-f-q";
  row.style.cssText = "position:fixed;left:8px;right:8px;top:72px;z-index:9800;display:flex;flex-wrap:wrap;gap:8px;background:#102810;padding:8px";
  row.innerHTML = '<input id="gl-q-amt" type="text" inputmode="decimal" autocomplete="off" aria-label="Ride amount" style="font-size:28px;width:140px">' +
    '<input id="gl-q-tip" type="text" inputmode="decimal" autocomplete="off" aria-label="Tip (optional)" style="font-size:28px;width:110px">' +
    '<input id="gl-q-note" type="text" maxlength="120" autocomplete="off" aria-label="Note (optional)" style="font-size:18px;flex:1 1 160px;min-width:140px;max-width:100%">';
  ov.appendChild(row);
  window.__pcsNumPad(ov);
  return true;
};
window.__state = function () {
  var pad = document.getElementById("gl-kp");
  var lb = document.getElementById("gl-kp-lbl");
  var active = document.activeElement;
  function box(id) {
    var el = document.getElementById(id);
    return { ro: !!el.readOnly, mode: el.getAttribute("inputmode"), value: el.value };
  }
  return JSON.stringify({
    pad: pad ? pad.style.display : "",
    label: lb ? lb.textContent : "",
    active: active ? active.id || active.tagName : "",
    amt: box("gl-q-amt"),
    tip: box("gl-q-tip"),
    note: box("gl-q-note")
  });
};
window.__center = function (id) {
  var r = document.getElementById(id).getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
};
</script></body></html>`;
}

test("iPad sizes: amount, tip, and the note do not leave both keyboards up", async function () {
  const port = 8798;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-goal-note-"));
  fs.copyFileSync(path.join(__dirname, "../god/goal.js"), path.join(dir, "goal.js"));
  fs.writeFileSync(path.join(dir, "index.html"), page());
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const chrome = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--window-size=1200,1400", "--remote-debugging-port=" + (port + 100),
    "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"
  ], { stdio: "ignore" });
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
    const sizes = [[390, 844], [768, 1024], [1024, 768]];
    for (const size of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: true }, sid);
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }, sid);
      await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" }, sid);
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        const msg = await send("Runtime.evaluate", { expression: "!!(window.__pcsGoalOpen && window.__boot)", returnByValue: true }, sid);
        ready = !!(msg.result && msg.result.result && msg.result.result.value);
        if (!ready) await wait(150);
      }
      assert.ok(ready, size.join("x") + " goal.js did not load");
      await send("Runtime.evaluate", { expression: "window.__boot()", returnByValue: true }, sid);
      await wait(200);
      async function center(id) { return JSON.parse((await send("Runtime.evaluate", { expression: "window.__center(" + JSON.stringify(id) + ")", returnByValue: true }, sid)).result.result.value); }
      async function state() { return JSON.parse((await send("Runtime.evaluate", { expression: "window.__state()", returnByValue: true }, sid)).result.result.value); }
      async function tap(id) {
        const p = await center(id);
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] }, sid);
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sid);
        await wait(80);
        return state();
      }
      const amount = await tap("gl-q-amt");
      assert.equal(amount.pad, "block", size.join("x") + " amount pad");
      assert.equal(amount.label, "Ride amount");
      assert.equal(amount.amt.ro, true);
      assert.equal(amount.amt.mode, "none");
      assert.notEqual(amount.active, "gl-q-amt");
      const tipped = await tap("gl-q-tip");
      assert.equal(tipped.pad, "block", size.join("x") + " tip pad");
      assert.equal(tipped.label, "Tip (optional)");
      assert.equal(tipped.tip.ro, true);
      assert.equal(tipped.tip.mode, "none");
      assert.notEqual(tipped.active, "gl-q-note");
      const noted = await tap("gl-q-note");
      assert.equal(noted.pad, "none", size.join("x") + " note closed the pad");
      assert.equal(noted.active, "gl-q-note");
      assert.equal(noted.note.ro, false);
      const back = await tap("gl-q-amt");
      assert.equal(back.pad, "block", size.join("x") + " amount reopened");
      assert.equal(back.label, "Ride amount");
      assert.notEqual(back.active, "gl-q-note");
      assert.notEqual(back.active, "gl-q-amt");
      const noteAgain = await tap("gl-q-note");
      assert.equal(noteAgain.pad, "none");
      const tipBack = await tap("gl-q-tip");
      assert.equal(tipBack.pad, "block", size.join("x") + " tip after note");
      assert.equal(tipBack.label, "Tip (optional)");
      assert.notEqual(tipBack.active, "gl-q-note");
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
