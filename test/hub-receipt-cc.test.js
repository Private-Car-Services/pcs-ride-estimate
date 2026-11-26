/* v2.0m-cc: ride history cards show the saved tax and link only a real Square receipt. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const src = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

function fn(name) {
  const i = src.indexOf("function " + name + "(");
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}" && --d === 0) return new Function("return " + src.slice(i, k + 1))(); }
}

test("only Square receipt links pass", function () {
  const ok = fn("hubReceiptOk");
  assert.equal(ok("https://squareup.com/receipt/preview/K23ZHT1PL6Y3AQi9fuSNbCfxBsPZY"), true);
  assert.equal(ok("https://square.link/u/YYg1ZcSe"), true);
  assert.equal(ok("https://app.squareup.com/pay-invoice/x"), true);
  assert.equal(ok("https://gosq.me/abc"), false);
  assert.equal(ok("http://squareup.com/receipt/x"), false);
  assert.equal(ok("https://evil.com/squareup.com/x"), false);
  assert.equal(ok(""), false);
  assert.equal(ok(null), false);
});

test("day card adds a Tax row and a View receipt link, nothing else", function () {
  const i = src.indexOf("function driverHubDay(");
  const body = src.slice(i, src.indexOf("function driverHub()", i)); /* whole card markup, through the per-ride map */
  assert.ok(body.indexOf('<article class="card">') > 0);
  assert.ok(body.indexOf('<span>Tax</span>') > body.indexOf('<article class="card">'));
  assert.ok(body.indexOf("money(Number(r.fareTax) || 0)") > 0);
  assert.ok(body.indexOf("View receipt") > 0);
  assert.ok(body.indexOf("hubReceiptOk(hubReceipt(r))") > 0);
  assert.ok(body.indexOf("Commission (") > 0 && body.indexOf("Tip (100% yours)") > 0);
});
