/* v2.0m-ph2 r3 (Harry r2 B2: no call link / calendar tag / driver tap-to-call). The second phone is the EXISTING per-ride Additional number (extraPhoneOnce, God card, v77.5);
   the calendar sync fills it (extraPhoneSrc "calendar"). Harry 11/20: it only ever gets the read-only Share-my-ride link
   (FLWRDMAP shareT), never the account holder's t / holderT / teen link. Sample data only; no network. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
function loaderFrom(file, name) { /* reuse the existing test loader function (only its text), returning the sandbox */
  const src = fs.readFileSync(path.join(__dirname, file), "utf8"), i = src.indexOf("function " + name + "()");
  const fn = src.slice(i, src.indexOf("\n}\n", i) + 3).replace(/return sandbox\.__pcs\w+;/, "return sandbox;");
  const pre = src.indexOf("function el()") >= 0 && name === "loadGod" ? src.slice(src.indexOf("function el()"), src.indexOf("\n}\n", src.indexOf("function el()")) + 3) : "";
  return new Function("require", "__dirname", "fs", "path", "vm", pre + fn + "\nreturn " + name + ";")(require, __dirname, fs, path, require("vm"));
}
const g = loaderFrom("god-trip-token.test.js", "loadGod")();
const a = loaderFrom("post-ride-bz.test.js", "loadApp")();
/* the sandbox has no page URL: give the link builder one so the Messages bodies are real (not empty) */
(function () { const w = g.window || g; if (!g.URL) g.URL = URL; w.location = { href: "https://www.privatecarservices.example/god/" }; if (w !== g) g.location = w.location; })();
const T = "T".repeat(32), H = "H".repeat(32), K = "K".repeat(32), S = "S".repeat(32);
const base = { id: "c2", assignedDriverId: "drv", assignedDriverName: "Matthew Wragge", status: "assigned", riderPhone: "+18139289397" };
function smsBodies(html) { const out = {}; const re = /href="sms:([^?"]*)\?(?:&amp;|&)body=([^"]*)"/g; let m; while ((m = re.exec(html))) out[m[1]] = decodeURIComponent(m[2]); return out; }

test("God card: Additional number shown as before (no call link, no calendar tag); God typing clears the calendar mark", function () {
  if (g.__loadError) assert.fail("god.js failed to load: " + g.__loadError.message);
  const at = g.__pcsGodAutoText;
  const html = at.teenHtml({ id: "c2", riderPhone: "+18139289397", extraPhoneOnce: "+18327020571", extraPhoneSrc: "calendar" });
  assert.ok(html.indexOf("Additional number") >= 0 && html.indexOf("832-702-0571") >= 0, html);
  assert.ok(html.indexOf('<span class="fine">(this ride only, never saved to the client)</span></div>') >= 0, "label exactly as on main (Harry r3)");
  assert.equal(html.indexOf("tel:"), -1, "no call link (Harry r2 B2)"); assert.equal(html.indexOf("from the calendar"), -1, "no calendar tag (Harry r2 B2)");
  const p = at.extraPatch("832-702-0571", 5).patch;
  assert.equal(p.extraPhoneOnce, "+18327020571"); assert.ok("extraPhoneSrc" in p && p.extraPhoneSrc === null, "God's own number: sync mark removed");
});
test("God tracking link: the Additional number gets ONLY the share token (never t / holderT / teenT)", function () {
  const fol = g.__pcsGodFollow;
  const r = Object.assign({}, base, { extraPhoneOnce: "+18327020571", teenRider: true, teenPhone: "+18325550000" });
  fol.state.map.c2 = { t: T, holderT: H, teenT: K, shareT: S };
  const b = smsBodies(fol.html(r));
  assert.ok("+18327020571" in b, "button for the Additional number");
  assert.ok(/\/follow\/\?t=/.test(b["+18327020571"]), "real link body: " + b["+18327020571"]);
  assert.ok(b["+18327020571"].indexOf(S) >= 0, b["+18327020571"]);
  for (const tok of [T, H, K]) assert.equal(b["+18327020571"].indexOf(tok), -1, "owner token leaked");
  assert.ok(/invoice|receipt|pay|tip|survey/i.test(b["+18327020571"]) === false, b["+18327020571"]);
  assert.ok(b["+18139289397"] && b["+18139289397"].indexOf(S) === -1, "main number keeps its own link");
  for (const bad of [{ t: T, holderT: H }, { t: T, shareT: T }, { t: T, holderT: H, shareT: H }, { t: T, shareT: "short" }]) {
    fol.state.map.c2 = bad;
    const h = fol.html(r), bb = smsBodies(h);
    assert.equal(bb["+18327020571"], undefined, "no share token -> no Messages button: " + JSON.stringify(bad));
    assert.ok(h.indexOf("gfol-x-wait") >= 0);
  }
  assert.equal(fol.shareTok({ t: T, shareT: S }), S);
});
test("Driver card: no second-phone extras (Harry r2 B2)", function () {
  if (a.__loadError) assert.fail("app.js failed to load: " + a.__loadError.message);
  assert.equal(a.__pcsPhone2, undefined);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "app", "app.js"), "utf8");
  assert.equal(/sched-rider-ph2|sched-arr-ph2|schedPhone2/.test(src), false);
});
