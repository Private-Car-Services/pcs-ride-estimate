/* Fuel save uses the ledger's IndexedDB vault. A second page load reads that vault, not the first page's memory. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");
const test = require("node:test");

function memoryIdb(mem) {
  const db = {
    transaction() {
      const tx = {
        objectStore() {
          return {
            get(key) {
              const q = {};
              queueMicrotask(function () { q.result = mem[key]; if (q.onsuccess) q.onsuccess(); });
              return q;
            },
            put(value, key) { mem[key] = value; },
            delete(key) { delete mem[key]; }
          };
        }
      };
      Object.defineProperty(tx, "oncomplete", { set(fn) { queueMicrotask(fn); } });
      Object.defineProperty(tx, "onerror", { set() {} });
      return tx;
    }
  };
  return {
    open() {
      const req = {};
      queueMicrotask(function () { req.result = db; if (req.onsuccess) req.onsuccess(); });
      return req;
    }
  };
}

function load(mem, store) {
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, Promise, RegExp, Error, parseInt, isFinite,
    setTimeout(fn) { return setTimeout(fn, 0); }, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    queueMicrotask, alert() {}, confirm() { return false; }, prompt() { return ""; },
    crypto: webcrypto, indexedDB: memoryIdb(mem),
    localStorage: { getItem(k) { return store[k] == null ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
    location: { search: "", hostname: "localhost", href: "http://localhost/god/" },
    navigator: { userAgent: "test" },
    TextEncoder, TextDecoder, Uint8Array, btoa, atob,
    document: { addEventListener() {}, getElementById() { return null; }, createElement() { return { id: "", style: {}, appendChild() {}, setAttribute() {} }; }, head: { appendChild() {} }, body: { appendChild() {} } },
    module: { exports: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8"), sandbox, { filename: "god/goal.js" });
  return sandbox;
}

test("Matthew's fuel fill is still there after the page is loaded again", async function () {
  const mem = { vault: { iv: [], ct: new Uint8Array([1]) } };
  const store = { "pcs-god-keep-v1": JSON.stringify({ email: "mwragge78@gmail.com" }) };
  const first = load(mem, store);
  assert.equal(first.__pcsGoalFuel.owner(), true);
  store["pcs-god-keep-v1"] = JSON.stringify({ email: "other@example.com" });
  assert.equal(first.__pcsGoalFuel.owner(), false);
  store["pcs-god-keep-v1"] = JSON.stringify({ email: "mwragge78@gmail.com" });
  const otherId = load(mem, { "pcs-god-keep-v1": JSON.stringify({ email: "driver@example.com" }) });
  assert.equal(otherId.__pcsGoalFuel.owner(), false);
  const src = fs.readFileSync(path.join(__dirname, "../god/goal.js"), "utf8");
  const gate = src.slice(src.indexOf("function fuelForMatthew"), src.indexOf("function fuelRows"));
  assert.equal(gate.indexOf("PCS_GOAL_DRIVER_ID"), -1);
  assert.equal(gate.indexOf("HR.id"), -1);
  assert.equal(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8").indexOf('id="gl-fuel"'), -1);
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const when = first.__pcsGoalFuel.when(Date.parse("2026-11-08T14:55:00Z"));
  first.module.exports._set({
    settings: {}, entries: {},
    fuel: { seed: { odo: 100000, at: 1 }, log_1: { at: Date.parse("2026-11-08T14:55:00Z"), date: when.date, time: when.time, prev: 100000, odo: 100220, gallons: 10, price: 40 } }
  });
  first.module.exports._setDek(key);
  await first.module.exports.saveLocal();
  const second = load(mem, store);
  const opened = await second.module.exports.openData(mem.vault, key);
  assert.equal(opened.fuel.log_1.date, "11/8/26");
  assert.equal(opened.fuel.log_1.time, "0855");
  assert.equal(opened.fuel.log_1.odo, 100220);
  assert.equal(opened.fuel.log_1.gallons, 10);
  assert.equal(second.module.exports._get(), null);
});

test("a later fill on another day keeps the earlier fills in a new page", async function () {
  const mem = { vault: { iv: [], ct: new Uint8Array([1]) } };
  const store = { "pcs-god-keep-v1": JSON.stringify({ email: "mwragge78@gmail.com" }) };
  const first = load(mem, store);
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const fuel = first.__pcsGoalFuel;
  const morningAt = Date.parse("2026-11-08T14:55:00Z");
  const sameAt = Date.parse("2026-11-08T21:40:00Z");
  const nextAt = Date.parse("2026-11-09T16:05:00Z");
  const morning = fuel.when(morningAt), same = fuel.when(sameAt), next = fuel.when(nextAt);
  first.module.exports._set({
    settings: {}, entries: {},
    fuel: {
      seed: { odo: 100000, at: 1 },
      log_morning: { at: morningAt, date: morning.date, time: morning.time, prev: 100000, odo: 100220, gallons: 10, price: 40 },
      log_same: { at: sameAt, date: same.date, time: same.time, prev: 100220, odo: 100400, gallons: 8.25, price: 31.5 },
      log_next: { at: nextAt, date: next.date, time: next.time, prev: 100400, odo: 100640, gallons: 9.5, price: 36 }
    }
  });
  first.module.exports._setDek(key);
  await first.module.exports.saveLocal();
  const second = load(mem, store);
  assert.equal(second.module.exports._get(), null);
  const opened = await second.module.exports.openData(mem.vault, key);
  assert.equal(opened.fuel.log_morning.odo, 100220);
  assert.equal(opened.fuel.log_morning.gallons, 10);
  assert.equal(opened.fuel.log_morning.price, 40);
  assert.equal(opened.fuel.log_morning.date, morning.date);
  assert.equal(opened.fuel.log_same.date, morning.date);
  assert.notEqual(opened.fuel.log_next.date, morning.date);
  assert.equal(opened.fuel.log_same.prev, 100220);
  assert.equal(opened.fuel.log_next.prev, 100400);
  assert.equal(fuel.prev(opened.fuel), 100640);
  assert.equal(fuel.rows(opened.fuel).length, 3);
  assert.equal(fuel.rows(opened.fuel)[0].gallons, 10);
});
