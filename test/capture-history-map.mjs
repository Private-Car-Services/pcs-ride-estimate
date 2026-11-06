import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = "/opt/cursor/artifacts";
const port = 8765;
const debugPort = 9222;

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitFor(url, tries) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 200) return; } catch (e) {}
    await wait(200);
  }
  throw new Error("not up " + url);
}

const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
const chrome = spawn("google-chrome", [
  "--headless=new",
  "--disable-gpu",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--window-size=460,1180",
  "--hide-scrollbars",
  "--remote-debugging-port=" + debugPort,
  "--user-data-dir=/tmp/pcs-history-map-chrome",
  "http://127.0.0.1:" + port + "/test/history-map-preview.html"
], { stdio: "ignore" });

function shutdown() { try { chrome.kill("SIGKILL"); } catch (e) {} try { server.kill("SIGKILL"); } catch (e) {} }
process.on("exit", shutdown);

await waitFor("http://127.0.0.1:" + port + "/test/history-map-preview.html", 40);
await waitFor("http://127.0.0.1:" + debugPort + "/json/list", 50);
let page = null;
for (let i = 0; i < 40 && !page; i++) {
  const list = await fetch("http://127.0.0.1:" + debugPort + "/json/list").then(function (r) { return r.json(); });
  page = list.find(function (t) { return t.type === "page" && String(t.url || "").indexOf("history-map-preview") >= 0; });
  if (!page) await wait(200);
}
if (!page) throw new Error("preview tab missing");

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
ws.onmessage = function (ev) {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
function send(method, params) {
  const id = ++seq;
  return new Promise(function (resolve) {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}
await send("Page.enable");
await send("Runtime.enable");

async function evalJs(expression) {
  const msg = await send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
  if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails));
  return msg.result && msg.result.result ? msg.result.result.value : undefined;
}

let ready = "";
for (let i = 0; i < 80 && ready !== "overview"; i++) {
  ready = await evalJs("document.querySelector('#dl-map') && document.querySelector('#dl-map').dataset.ready || document.body.dataset.err || ''");
  if (ready && ready !== "overview") throw new Error(String(ready));
  if (ready !== "overview") await wait(500);
}
if (ready !== "overview") throw new Error("map did not become ready");
await wait(400);

async function shot(name) {
  const msg = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const file = path.join(outDir, name);
  await mkdir(outDir, { recursive: true });
  await writeFile(file, Buffer.from(msg.result.data, "base64"));
  console.log(file);
}

await shot("history-map-overview.png");
await evalJs("(function () { var m = document.getElementById('host')._dlMap.getMap(); var el = document.getElementById('dl-map'); el.dataset.ready = 'zooming'; m.once('idle', function () { el.dataset.ready = 'street'; }); m.jumpTo({ center: window.__pcsStreet, zoom: 17 }); })()");
let street = "";
for (let i = 0; i < 40 && street !== "street"; i++) {
  street = await evalJs("document.getElementById('dl-map').dataset.ready");
  if (street !== "street") await wait(400);
}
if (street !== "street") throw new Error("street zoom did not settle: " + street);
await wait(500);
await shot("history-map-street.png");
const hit = await evalJs("(function () { var m = document.getElementById('host')._dlMap.getMap(); var feats = m.queryRenderedFeatures({ layers: ['dl-stroke'] }); var pcs = null; for (var i = 0; i < feats.length; i++) { if (String(feats[i].properties.label || '').indexOf('PCS') === 0) { pcs = feats[i]; break; } } pcs = pcs || feats[0]; if (!pcs) return ''; var c = pcs.geometry.coordinates[Math.floor(pcs.geometry.coordinates.length / 2)]; var p = m.project(c); var rect = document.getElementById('dl-map').getBoundingClientRect(); return JSON.stringify({ x: rect.left + p.x, y: rect.top + p.y, label: pcs.properties.label }); })()");
console.log("hit", hit);
if (hit) {
  const pt = JSON.parse(hit);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await wait(300);
  const tap = await evalJs("document.getElementById('dl-map-tap').textContent");
  console.log("tap", tap);
  await shot("history-map-tap.png");
}
const zoom = await evalJs("(function () { var m = document.getElementById('host')._dlMap.getMap(); return JSON.stringify({ z: m.getZoom(), style: m.getStyle().layers.map(function (l) { return l.id; }), traffic: JSON.stringify(m.getStyle()).indexOf('traffic') >= 0 }); })()");
console.log(zoom);
ws.close();
shutdown();
process.exit(0);
