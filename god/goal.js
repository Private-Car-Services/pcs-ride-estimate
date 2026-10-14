/* PCS Monthly Goal (Matthew) - v75s: tappable goal overrides, adjustment re-dating/repair, goals never negative. v75r: goal cascade + YTD totals. v75g: runs INSIDE God mode as its own Home panel (God Home > Monthly Goal).
   Own password + PIN, separate from God sign-in. Data stays on this device only (never Firebase, no network calls).
   Ported from the former standalone /ledger/ app; same IndexedDB vault.
   Local-first: all data lives on this device in IndexedDB, AES-GCM encrypted with a key derived from Matthew's own
   password (PBKDF2-SHA256, 600,000 rounds, random salt) via a random data key. Password once per 24 h; a 4-digit PIN
   (data key wrapped by a PIN key, PBKDF2 1,000,000 rounds) unlocks until that expires; 5 wrong PINs wipe the PIN copy. The password itself is never stored. Wrong password = data
   cannot decrypt. No network calls (CSP connect-src 'none'). Back up with "Export encrypted backup". */
(function () {
  "use strict";
  var GL_CSS = '#gl-screen{--bg:#0b1f0b;--card:#102810;--line:#2e5a2e;--green:#3fae5a;--lite:#7ee08f;--gold:#d4af37;--goldt:#f0d48a;--red:#ff8a80;--txt:#eef5ee}#gl-screen,#gl-screen *{box-sizing:border-box}#gl-screen,#gl-screen{margin:0;background:var(--bg);color:var(--txt);font:16px/1.35 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}#gl-screen main{max-width:760px;margin:0 auto;padding:14px 14px 80px}#gl-screen h1{color:var(--goldt);font-size:24px;margin:6px 0 10px}#gl-screen .card{border:1px solid var(--line);border-radius:14px;padding:12px;margin:10px 0;background:var(--card)}#gl-screen .card.hero{border:2px solid var(--gold)}#gl-screen .card.day{border:2px solid var(--green);text-align:center;background:#0f300f}#gl-screen .card b.t{color:var(--goldt);font-size:17px}#gl-screen .grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}#gl-screen .big{flex:1 1 30%;min-width:110px;background:#163a16;border:1px solid var(--green);border-radius:10px;padding:8px}#gl-screen .big .v{font-size:22px;font-weight:900}#gl-screen .neg{color:var(--red)}#gl-screen .pos{color:var(--lite)}#gl-screen .fine{font-size:13px;color:#b9cdb9}#gl-screen table{width:100%;border-collapse:collapse}#gl-screen td,#gl-screen th{padding:4px 3px}#gl-screen td.r,#gl-screen th.r{text-align:right}#gl-screen tr.b{border-top:1px solid var(--line)}#gl-screen input,#gl-screen select{font-size:16px;padding:9px;border-radius:10px;border:1px solid #9ab79a;background:#fff;color:#000}#gl-screen .btn{font-weight:800;border-radius:12px;padding:10px 16px;border:2px solid var(--gold);background:linear-gradient(#f0d48a,#d4af37);color:#0b1f0b;cursor:pointer;font-size:16px}#gl-screen .btn.ghost{background:transparent;color:var(--goldt)}#gl-screen .total{font-size:42px;font-weight:900;color:var(--lite)}#gl-screen #gl-q-amt{font-size:28px;width:170px;text-align:right}#gl-screen label{display:inline-block;margin:4px 8px 4px 0}#gl-screen label span{display:block}#gl-screen .lock{max-width:420px;margin:12vh auto;padding:20px}#gl-screen .err{color:var(--red);min-height:1.2em}#gl-screen .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:center}#gl-screen .btn.ghost{background:#f3f4f6;color:#1a1a1a;border:2px solid #6b7280}#gl-screen .lock{color:#eef5ee}#gl-screen summary{cursor:pointer}#gl-screen input,#gl-screen .gl-ovin{pointer-events:auto;touch-action:manipulation;-webkit-user-select:text;user-select:text;position:relative;z-index:2}#gl-screen .gl-ovin::placeholder{color:#555;opacity:1}#gl-close{position:fixed;top:max(40px,calc(10px + env(safe-area-inset-top)));right:max(16px,env(safe-area-inset-right));z-index:9101;min-height:52px;min-width:120px;font-size:20px;font-weight:900;border-radius:14px;border:2px solid #fff;background:#1f8a3b;color:#fff;cursor:pointer}#gl-screen main{padding-top:100px}';
  var ITER = 600000, LOCK_MS = 5 * 60000, MINPW = 10;
  var LINES = [["uber", "Uber"], ["lyft", "Lyft"], ["pcs", "PCS (private clients)"], ["ofc", "Officiating (Football/Softball)"], ["va", "VA"], ["cash", "Cash"]];
  var EXP = [["exp", "Fuel & expenses"]];
  var dek = null, D = null, lastAct = Date.now(), app = null;
  var PIN_ITER = 1000000, PIN_TTL = 24 * 3600000, PIN_TRIES = 5;

  /* ---------- storage ---------- */
  function idb() { return new Promise(function (ok, no) { var r = indexedDB.open("pcs-ledger", 1); r.onupgradeneeded = function () { r.result.createObjectStore("kv"); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
  function kvGet(k) { return idb().then(function (db) { return new Promise(function (ok, no) { var q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { no(q.error); }; }); }); }
  function kvPut(k, v) { return idb().then(function (db) { return new Promise(function (ok, no) { var t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = function () { ok(); }; t.onerror = function () { no(t.error); }; }); }); }
  function kvDel(k) { return idb().then(function (db) { return new Promise(function (ok) { var t = db.transaction("kv", "readwrite"); t.objectStore("kv").delete(k); t.oncomplete = function () { ok(); }; t.onerror = function () { ok(); }; }); }); }
  var enc = new TextEncoder(), dec = new TextDecoder();
  function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  /* KEK from a secret (password or PIN): PBKDF2-SHA256 -> AES-GCM key used only to wrap/unwrap the data key */
  function kek(secret, s, iter) { return crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]).then(function (b) {
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: s, iterations: iter, hash: "SHA-256" }, b, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]); }); }
  function wrap(k, key) { var iv = rnd(12); return crypto.subtle.wrapKey("raw", key, k, { name: "AES-GCM", iv: iv }).then(function (w) { return { iv: Array.from(iv), w: new Uint8Array(w) }; }); }
  function unwrap(k, rec) { return crypto.subtle.unwrapKey("raw", rec.w, k, { name: "AES-GCM", iv: new Uint8Array(rec.iv) }, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }
  /* vault v2 = { salt, iter, pw:{iv,w} (data key wrapped by password KEK), iv, ct (data encrypted by data key) } */
  function sealData(obj, key) { var iv = rnd(12); return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(JSON.stringify(obj))).then(function (ct) { return { iv: Array.from(iv), ct: new Uint8Array(ct) }; }); }
  function openData(v, key) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(v.iv) }, key, v.ct).then(function (pt) { return JSON.parse(dec.decode(pt)); }); }
  function openWithPassword(v, pw) { return kek(pw, new Uint8Array(v.salt), v.iter || ITER).then(function (k) { return unwrap(k, v.pw); }).then(function (key) { return openData(v, key).then(function (d) { return { key: key, d: d }; }); }); }
  function save() { return kvGet("vault").then(function (v) { return sealData(D, dek).then(function (x) { v.iv = x.iv; v.ct = x.ct; return kvPut("vault", v); }); }).catch(function (e) { alert("Not saved: " + e.message); }); }
  function blank() { return { settings: {}, entries: {}, lastLine: "uber" }; }

  /* ---------- PIN window: after a password unlock the data key is also wrapped with a PIN KEK, valid 24 h ---------- */
  function pinArm(pin) { var s = rnd(16);
    return kek(pin, s, PIN_ITER).then(function (k) { return wrap(k, dek); }).then(function (r) { return kvPut("pin", { salt: Array.from(s), iter: PIN_ITER, iv: r.iv, w: r.w, exp: Date.now() + PIN_TTL, fails: 0 }); }); }
  function pinValid() { return kvGet("pin").then(function (p) { if (!p) return null; if (!(Number(p.exp) > Date.now()) || (p.fails || 0) >= PIN_TRIES) return kvDel("pin").then(function () { return null; }); return p; }); }

  /* ---------- lock ---------- */
  function shell(inner, msg) { app.innerHTML = '<div class="lock card"><h1>Monthly Goal</h1>' + inner + '<p class="err" id="gl-err">' + (msg || "") + "</p></div>"; return document.getElementById("gl-err"); }
  function lockNow(msg) { dek = null; D = null; if (!app) return; kvGet("vault").then(function (v) { if (!v) return firstRun(); pinValid().then(function (p) { if (p) pinScreen(p, msg); else pwScreen(msg); }); }); }
  function firstRun(msg) {
    var err = shell('<p>Create your ledger password (not your God mode password), at least ' + MINPW + ' characters, and a 4-digit PIN. ' +
      'The password is needed once every 24 hours; in between, the PIN unlocks. There is no reset: keep an encrypted backup and the password somewhere safe.</p>' +
      '<form id="gl-f-set"><p><input type="password" id="gl-pw1" autocomplete="new-password" placeholder="New password" style="width:100%"></p><p><input type="password" id="gl-pw2" autocomplete="new-password" placeholder="Repeat password" style="width:100%"></p>' +
      '<p><input type="password" id="gl-pin1" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4-digit PIN" style="width:48%"> <input type="password" id="gl-pin2" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Repeat PIN" style="width:48%"></p>' +
      '<button class="btn" type="submit">Set password &amp; PIN</button></form>', msg);
    document.getElementById("gl-f-set").onsubmit = function (e) { e.preventDefault();
      var a = val("gl-pw1"), b = val("gl-pw2"), p1 = val("gl-pin1"), p2 = val("gl-pin2");
      if (a.length < MINPW) { err.textContent = "Use at least " + MINPW + " characters."; return; }
      if (a !== b) { err.textContent = "The two passwords do not match."; return; }
      if (!/^\d{4}$/.test(p1)) { err.textContent = "The PIN must be exactly 4 digits."; return; }
      if (p1 !== p2) { err.textContent = "The two PINs do not match."; return; }
      if (/^(\d)\1{3}$|^(1234|4321|0123|9876)$/.test(p1)) { err.textContent = "Pick a less obvious PIN."; return; }
      err.textContent = "Setting up\u2026"; var s = rnd(16);
      crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]).then(function (k) { dek = k; D = blank(); D.pin = p1; /* PIN kept only inside the encrypted data */
        return kek(a, s, ITER).then(function (pk) { return wrap(pk, dek); }).then(function (w) { return sealData(D, dek).then(function (x) { return kvPut("vault", { v: 2, kdf: "PBKDF2-SHA256", salt: Array.from(s), iter: ITER, pw: w, iv: x.iv, ct: x.ct }); }); });
      }).then(function () { return pinArm(p1); }).then(start).catch(function (er) { err.textContent = "Setup failed: " + er.message; });
    };
  }
  function pwScreen(msg) {
    var err = shell('<form id="gl-f-unlock"><p class="fine">Password needed (once every 24 hours).</p><p><input type="password" id="gl-pw" autocomplete="current-password" placeholder="Ledger password" style="width:100%" autofocus></p><button class="btn" type="submit">Unlock</button></form>', msg);
    document.getElementById("gl-f-unlock").onsubmit = function (e) { e.preventDefault(); err.textContent = "Unlocking\u2026";
      kvGet("vault").then(function (v) { return openWithPassword(v, val("gl-pw")); }).then(function (r) { dek = r.key; D = r.d; return D.pin ? pinArm(D.pin) : null; })
        .then(start).catch(function () { err.textContent = "Wrong password."; }); };
  }
  function pinScreen(p, msg) {
    var left = PIN_TRIES - (p.fails || 0), hrs = Math.max(0, Math.round((p.exp - Date.now()) / 360000) / 10);
    var err = shell('<form id="gl-f-pin"><p class="fine">Enter your PIN (' + hrs + ' h left before the password is needed again).</p><p><input type="password" id="gl-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN" style="width:100%;font-size:28px;text-align:center;letter-spacing:8px" autofocus></p>' +
      '<button class="btn" type="submit">Unlock</button> <button class="btn ghost" type="button" id="gl-b-usepw">Use password</button></form>', msg || (left < PIN_TRIES ? left + " tries left" : ""));
    document.getElementById("gl-b-usepw").onclick = function () { pwScreen(); };
    document.getElementById("gl-f-pin").onsubmit = function (e) { e.preventDefault(); var pin = val("gl-pin"); if (!/^\d{4}$/.test(pin)) { err.textContent = "4 digits."; return; }
      err.textContent = "Unlocking\u2026";
      pinValid().then(function (cur) { if (!cur) return pwScreen("PIN window ended. Enter your password.");
        return kek(pin, new Uint8Array(cur.salt), cur.iter).then(function (k) { return unwrap(k, cur); })
          .then(function (key) { return kvGet("vault").then(function (v) { return openData(v, key); }).then(function (d) { dek = key; D = d; cur.fails = 0; return kvPut("pin", cur); }).then(start); },
            function () { cur.fails = (cur.fails || 0) + 1;
              if (cur.fails >= PIN_TRIES) return kvDel("pin").then(function () { pwScreen("5 wrong PINs: the PIN is off until you enter your password."); });
              return kvPut("pin", cur).then(function () { pinScreen(cur, "Wrong PIN. " + (PIN_TRIES - cur.fails) + " tries left."); }); }); });
    };
  }
  function val(id) { return document.getElementById(id).value; }
  function lockScreen(first, msg) { lockNow(msg); } /* kept for callers */
  function start() { lastAct = Date.now(); var fixed = 0; try { fixed = repair(); } catch (e) {} paint(); if (fixed) save(); }
  ["click", "keydown", "touchstart", "input"].forEach(function (t) { document.addEventListener(t, function () { lastAct = Date.now(); }, true); });
  setInterval(function () { if (app && dek && Date.now() - lastAct > LOCK_MS) lockNow("Locked after 5 quiet minutes."); }, 15000);
  document.addEventListener("visibilitychange", function () { if (document.hidden) lastAct = Math.min(lastAct, Date.now()); else if (app && dek && Date.now() - lastAct > LOCK_MS) lockNow("Locked."); });

  /* ---------- math (same rules as the Monthly Goal tracker) ---------- */
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); }
  function addDays(ymd, n) { return new Date(Date.parse(ymd + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10); }
  function goal(v) { return Number(v) > 0 ? Number(v) : null; }
  function sub(a, b) { return a == null || b == null ? null : a - b; }
  /* Monday-start weeks left in this month, counting the current one */
  function weeksLeft(t, wk0) { var n = 1, d = addDays(wk0, 7); while (d.slice(0, 7) === t.slice(0, 7)) { n++; d = addDays(d, 7); } return n; }
  function calc(t) {
    t = t || today(); var s = D.settings || {}, dow = (new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7, wk0 = addDays(t, -dow), yday = addDays(t, -1);
    var y = t.slice(0, 4), m = t.slice(0, 7), m1 = m + "-01", sum = {};
    function add(k, v) { sum[k] = (sum[k] || 0) + v; }
    Object.keys(D.entries).forEach(function (id) { var e = D.entries[id], d = String(e.date || ""), a = Number(e.amount) || 0, l = e.line;
      var adj = e.type === "adjustment", inW = d >= wk0 && d <= t && (!adj || e.scope === "w"), inD = d === t && !adj; /* v75q: month/year adjustments never touch Today or the week */
      var bm = d < m1 || (adj && e.scope === "y"), bw = d < wk0 || (adj && (e.scope === "y" || e.scope === "m")); /* v75s: older adjustments count by date too */ /* v75r: income before this month / before this week */
      if (d.slice(0, 4) === y && bm) add("yb:" + l, a); if (d.slice(0, 7) === m && bw && !(adj && e.scope === "y")) add("mb:" + l, a);
      if (d.slice(0, 4) === y) add("y:" + l, a); if (d.slice(0, 7) === m) add("m:" + l, a); if (inW) add("w:" + l, a); if (inD) add("d:" + l, a); if (d === yday && !adj) add("y1:" + l, a);
      if (e.tip) { if (d.slice(0, 4) === y) add("y:tip:" + l, a); if (d.slice(0, 7) === m) add("m:tip:" + l, a); if (inW) add("w:tip:" + l, a); if (inD) add("d:tip:" + l, a); } });
    function g(sc, l) { return sum[sc + ":" + l] || 0; }
    function inc(sc) { return LINES.reduce(function (a, l) { return a + g(sc, l[0]); }, 0); }
    /* v75r cascade: year (typed) -> month -> week -> today; each derived goal is auto unless overridden */
    var yearGoal = goal(s.year), mLeft = 12 - Number(t.slice(5, 7)) + 1, wLeft = weeksLeft(t, wk0);
    var monthAuto = yearGoal == null ? null : Math.max(0, (yearGoal - inc("yb")) / mLeft), monthOv = goal(s.monthOv), monthGoal = monthOv != null ? monthOv : monthAuto;
    var weekAuto = monthGoal == null ? null : Math.max(0, (monthGoal - inc("mb")) / wLeft), weekOv = goal(s.weekOv), weekGoal = weekOv != null ? weekOv : weekAuto;
    var dTyped = goal(s.daysLeft), dSet = String(s.daysLeftSet || "");
    var passed = dSet && dSet <= t ? Math.round((Date.parse(t + "T12:00:00Z") - Date.parse(dSet + "T12:00:00Z")) / 86400000) : 0;
    var dLeft = dTyped == null ? null : Math.max(1, dTyped - passed);
    var before = inc("w") - inc("d"), dailyAuto = weekGoal == null || dLeft == null ? null : Math.max(0, (weekGoal - before) / dLeft), dayOv = goal(s.dayOv), daily = dayOv != null ? dayOv : dailyAuto;
    var rolled = null; if (weekGoal != null && dLeft != null && yday >= wk0) { var yi = inc("y1"); rolled = Math.max(0, (weekGoal - (before - yi)) / (dLeft + 1)) - yi; }
    var uberG = goal(s.uber), uberDaily = uberG == null || dLeft == null ? null : (uberG - (g("w", "uber") - g("d", "uber"))) / dLeft;
    return { monthAuto: monthAuto, monthOv: monthOv, weekAuto: weekAuto, weekOv: weekOv, dailyAuto: dailyAuto, dayOv: dayOv, mLeft: mLeft, wLeft: wLeft, yBefore: inc("yb"), mBefore: inc("mb"), wBefore: before, t: t, wk0: wk0, g: g, inc: inc, weekGoal: weekGoal, dLeft: dLeft, daily: daily, rolled: rolled, dayGross: inc("d"), expD: g("d", "exp"),
      todayRem: sub(daily, inc("d")), weekTotal: inc("w"), weekRem: sub(weekGoal, inc("w")), expW: g("w", "exp"),
      monthGoal: monthGoal, monthTotal: inc("m"), expM: g("m", "exp"), monthRem: sub(monthGoal, inc("m")),
      yearGoal: yearGoal, yearTotal: inc("y"), expY: g("y", "exp"), yearRem: sub(yearGoal, inc("y")), uberG: uberG, uberDaily: uberDaily, uberRem: sub(uberG, g("w", "uber")) };
  }


  /* ---------- v75q: Adjustments ---------- */
  var ADJ = [["uber", "Uber", false], ["lyft", "Lyft", false], ["pcs", "PCS (rides)", false], ["pcs", "PCS tips", true], ["ofc", "Officiating", false], ["va", "VA", false], ["cash", "Cash", false], ["exp", "Fuel & expenses", false]];
  /* current period amount for an ADJ row, EXCLUDING today's (non-adjustment) entries */
  function adjCur(c, sc, r) { var g = c.g;
    function v(x) { return r[2] ? g(x, "tip:" + r[0]) : g(x, r[0]) - (r[0] === "pcs" ? g(x, "tip:pcs") : 0); }
    return v(sc) - v("d"); }
  /* inputs: [{w,m,y}] per ADJ row (null = leave alone). Week first, then month, then year, so each lands exactly. */
  function planAdjust(inputs, t, at) {
    t = t || today(); at = at || Date.now(); var out = [], n = 0, m1 = t.slice(0, 7) + "-01", y1 = t.slice(0, 4) + "-01-01";
    [["w", "week"], ["m", "month"], ["y", "year"]].forEach(function (p) {
      ADJ.forEach(function (r, i) { var v = inputs[i] && inputs[i][p[0]]; if (v == null) return;
        if (p[0] === "m" && inputs[i].y != null && v > inputs[i].y) return; var c = calc(t), date = p[0] === "w" ? c.wk0 : p[0] === "m" ? m1 : y1, amt = Math.round((v - adjCur(c, p[0], r)) * 100) / 100; if (!amt) return;
        var id = "adj-" + newId(at + n); D.entries[id] = { date: date, line: r[0], amount: amt, tip: r[2], type: "adjustment", scope: p[0], note: "Manual adjustment (" + p[1] + " to date)", at: at + n++ }; out.push(id); }); });
    return out;
  }
  /* v75s: repair saved adjustments on load. Year = Jan 1, month = the 1st, week = its Monday. A month adjustment that pushes
     a source's month above its year total was really a year figure: it becomes part of the year remainder (Jan 1). */
  function repair(t) { t = t || today(); var ch = 0, E = D.entries;
    Object.keys(E).forEach(function (k) { var e = E[k]; if (e.type !== "adjustment") return; var d = String(e.date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = t;
      var nd = e.scope === "y" ? d.slice(0, 4) + "-01-01" : e.scope === "m" ? d.slice(0, 7) + "-01" : e.scope === "w" ? addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7)) : d;
      if (nd !== e.date) { e.date = nd; ch++; } });
    var c = calc(t), m = t.slice(0, 7);
    ADJ.forEach(function (r) { if (ytdTotal(c, r) >= -0.005 && mtd(c, r) <= ytdTotal(c, r) + 0.005) return;
      Object.keys(E).forEach(function (k) { var e = E[k]; if (e.type === "adjustment" && e.scope === "m" && e.line === r[0] && !!e.tip === !!r[2] && String(e.date).slice(0, 7) === m) { e.scope = "y"; e.date = t.slice(0, 4) + "-01-01"; e.note = "Manual adjustment (year to date, moved from month)"; ch++; } }); });
    return ch; }
  function mtd(c, r) { return r[2] ? c.g("m", "tip:" + r[0]) : c.g("m", r[0]) - (r[0] === "pcs" ? c.g("m", "tip:pcs") : 0); }
  function ytdTotal(c, r) { return r[2] ? c.g("y", "tip:" + r[0]) : c.g("y", r[0]) - (r[0] === "pcs" ? c.g("y", "tip:pcs") : 0); }
  function updYtd(c) { ADJ.forEach(function (r, i) { var el = document.getElementById("gl-adj-t" + i); if (el) el.value = $m(ytdTotal(c, r), true); }); }
  function ADJHTML(c) { var open = paint.adjOpen ? " open" : "";
    function inp(i, k) { return '<td><input id="gl-adj-' + k + i + '" type="text" inputmode="decimal" autocomplete="off" style="width:110px;background:#fff;color:#000"></td>'; }
    var ids = Object.keys(D.entries).filter(function (k) { return D.entries[k].type === "adjustment"; }).sort(function (a, b) { return (D.entries[b].at || 0) - (D.entries[a].at || 0); });
    return '<details class="card" id="gl-adj"' + open + '><summary><b class="t">Adjustments</b> <span class="fine">set your real to-date totals</span></summary>' +
      '<p class="fine">Type your actual totals through yesterday (leave a box blank to leave it alone). Apply adds a dated "Manual adjustment" so Month and Year match. Month to date is dated the 1st, year remainder Jan 1. Today and this week stay the same unless you fill in Week to date. YTD total (green) is fixed: everything this year, rides, tips and adjustments, and updates on its own.</p>' +
      '<table><tr class="fine"><th style="text-align:left">Source</th><th>YTD entered</th><th>YTD total</th><th>Month to date</th><th>Week to date (before today)</th></tr>' +
      ADJ.map(function (r, i) { return "<tr><td>" + esc(r[1]) + "</td>" + inp(i, "y") + '<td><input id="gl-adj-t' + i + '" type="text" readonly tabindex="-1" aria-label="YTD total" value="' + esc($m(ytdTotal(c, r), true)) + '" style="width:120px;background:#163a16;color:#7ee08f;border-color:#3fae5a;font-weight:800"></td>' + inp(i, "m") + inp(i, "w") + "</tr>"; }).join("") + "</table>" +
      '<button class="btn" id="gl-b-adj" type="button">Apply adjustments</button> <span class="fine" id="gl-adj-msg"></span>' +
      (ids.length ? '<table style="margin-top:8px"><tr class="fine"><th style="text-align:left">Date</th><th style="text-align:left">Source</th><th class="r">Amount</th><th style="text-align:left">For</th><th></th></tr>' + ids.map(function (k) { var e = D.entries[k];
        return '<tr class="b"><td>' + esc(e.date) + "</td><td>" + esc(name(e.line).replace(/ \(.*\)/, "") + (e.tip ? " tip" : "")) + '</td><td class="r">' + $m(e.amount, true) + '</td><td class="fine">' + ({ w: "week", m: "month", y: "year" }[e.scope] || "") + '</td><td class="r"><button class="btn ghost" data-adjdel="' + esc(k) + '">Undo</button></td></tr>'; }).join("") + "</table>" : "") + "</details>";
  }
  function bindAdj() { var d = document.getElementById("gl-adj"); if (!d) return; d.ontoggle = function () { paint.adjOpen = d.open; };
    document.getElementById("gl-b-adj").onclick = function () { var bad = false, any = false;
      var inputs = ADJ.map(function (r, i) { var o = {}; ["y", "m", "w"].forEach(function (k) { var el = document.getElementById("gl-adj-" + k + i), raw = el.value.trim(); if (!raw) return; var v = num(raw); if (v == null) bad = true; else { o[k] = v; any = true; } }); return o; });
      var msg = document.getElementById("gl-adj-msg"); if (bad) { msg.textContent = "Check the numbers."; return; } if (!any) { msg.textContent = "Nothing entered."; return; }
      if (!confirm("Set these to-date totals? Adjustment entries will be added (you can Undo them).")) return;
      var ids = planAdjust(inputs); paint.adjOpen = true; paint(); save(); var m = document.getElementById("gl-adj-msg"); if (m) m.textContent = ids.length ? ids.length + " adjustment(s) added." : "Already matched; nothing to add."; };
    Array.prototype.forEach.call(document.querySelectorAll("#gl-adj [data-adjdel]"), function (b) { b.onclick = function () { if (confirm("Undo this adjustment?")) { delete D.entries[b.getAttribute("data-adjdel")]; paint.adjOpen = true; paint(); save(); } }; });
  }

  /* ---------- UI ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $m(n, cents) { if (n == null || !isFinite(n)) return "\u2014"; var a = Math.abs(n).toLocaleString("en-US", cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }); return (n < 0 ? "-$" : "$") + a; }
  function left(n) { return n == null ? null : Math.max(0, n); }
  function name(l) { var x = LINES.concat(EXP).filter(function (a) { return a[0] === l; })[0]; return x ? x[1] : l; }
  function big(l, v, extra) { return '<div class="big"><div class="fine">' + l + '</div><div class="v">' + v + "</div>" + (extra || "") + "</div>"; }
  function row(l, v, gap) { return "<tr><td>" + l + '</td><td class="r"><b>' + v + "</b></td><td class=\"r " + (gap == null ? "" : gap >= 0 ? "pos" : "neg") + '">' + (gap == null ? "" : $m(gap)) + "</td></tr>"; }
  function paint() {
    var c = calc(), s = D.settings, h = "";
    h += '<div id="gl-top">' + topHtml(c) + '</div>';
    function f(id, l, v) { return '<label><span class="fine">' + l + '</span><input id="' + id + '" type="text" ' + (id === "gl-s-days" ? 'inputmode="numeric" pattern="[0-9]*"' : 'inputmode="decimal"') + ' autocomplete="off" value="' + esc(v == null ? "" : v) + '" style="width:130px"></label>'; }
    function o(id, l, v, tag) { return '<div class="gl-ov" style="display:inline-block;margin:4px 8px 4px 0;position:relative;z-index:2"><span class="fine" style="display:block">' + l + ' <b id="' + tag + '" style="color:var(--lite)"></b></span><input id="' + id + '" class="gl-ovin" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="auto" aria-label="' + esc(l) + ' (blank = auto)" value="' + esc(v == null ? "" : v) + '" style="width:130px"></div>'; }
    h += '<form class="card" id="gl-f-set"><b class="t">Goals</b><br>' + f("gl-s-year", "Year goal $", s.year) + o("gl-s-month", "Monthly goal $", s.monthOv, "gl-t-month") + o("gl-s-week", "Weekly goal $", s.weekOv, "gl-t-week") + o("gl-s-day", "Today's goal $", s.dayOv, "gl-t-day") + f("gl-s-days", "Days left in week", c.dLeft) + f("gl-s-uber", "Uber week goal $", s.uber) +
      '<p class="fine">Leave Monthly / Weekly / Today blank for <b>auto</b>; type a number to override, clear it to go back to auto.</p><p class="fine" id="gl-formula"></p>' +
      '<br><button class="btn" type="submit">Save goals</button> <span class="fine" id="gl-set-msg">Saves automatically as you type.</span></form>';
    h += ADJHTML(c);
    h += REST(c);
    app.innerHTML = h; bind(); bindAdj(); updGoalTags(c);
    var qa = document.getElementById("gl-q-amt"); if (qa && paint.focusQ) { qa.focus(); paint.focusQ = false; }
  }
  /* v75l: everything above the Goals form; re-rendered on each goal keystroke without touching the Goals inputs (keeps the keyboard up) */
  function paintTop() { var top = document.getElementById("gl-top"); if (!top || !D) return; var c = calc(); top.innerHTML = topHtml(c); bindTop(); updGoalTags(c); updYtd(c); }
  function updGoalTags(c) { function t(id, ov, auto, cents) { var el = document.getElementById(id); if (el) el.textContent = ov != null ? "override (auto " + $m(auto, cents) + ")" : "auto " + $m(auto, cents); }
    t("gl-t-month", c.monthOv, c.monthAuto); t("gl-t-week", c.weekOv, c.weekAuto); t("gl-t-day", c.dayOv, c.dailyAuto, true);
    var f = document.getElementById("gl-formula"); if (f) f.innerHTML = "Monthly = (year goal \u2212 year income before this month " + $m(c.yBefore) + ") \u00f7 " + c.mLeft + " months left \u00b7 Weekly = (monthly \u2212 month income before this week " + $m(c.mBefore) + ") \u00f7 " + c.wLeft + " weeks left \u00b7 Today = (weekly \u2212 week income before today " + $m(c.wBefore, true) + ") \u00f7 days left. Adjustments count as income."; }
  function topHtml(c) {
    var g = c.g, h = "";
    h += '<div class="row" style="justify-content:space-between"><h1>Monthly Goal</h1><button class="btn ghost" id="gl-b-lock">Lock</button></div>';
    var roll = c.rolled != null && Math.abs(c.rolled) >= 0.01 ? '<div class="fine ' + (c.rolled > 0 ? "neg" : "pos") + '">Rolled over from yesterday: ' + (c.rolled > 0 ? "+$" + c.rolled.toFixed(2) + " short" : "ahead by $" + Math.abs(c.rolled).toFixed(2)) + "</div>" : "";
    h += '<div class="card hero"><b class="t">TODAY \u00b7 ' + esc(c.t) + '</b><div class="grid">' + big("Weekly goal", $m(c.weekGoal)) + big("Days left in week", c.dLeft == null ? "\u2014" : String(c.dLeft), '<div class="fine">counts down daily</div>') +
      big("Today's goal", $m(c.daily, true), roll) + big("Today remaining", $m(left(c.todayRem), true)) + big("Week remaining", $m(left(c.weekRem))) + big("Month remaining", $m(left(c.monthRem))) +
      '</div><p class="fine">Today\'s goal = (weekly goal \u2212 week income before today) \u00f7 days left. Week = Mon\u2013Sun (Sunday optional).</p></div>';
    var ids = Object.keys(D.entries).filter(function (k) { return D.entries[k].date === c.t && D.entries[k].line !== "exp"; }).sort(function (a, b) { return (D.entries[a].at || 0) - (D.entries[b].at || 0); });
    var run = 0, tape = ids.map(function (k) { var e = D.entries[k]; run += Number(e.amount) || 0; var rem = c.daily == null ? null : c.daily - run;
      return '<tr class="b"><td style="text-align:left">' + esc(name(e.line).replace(/ \(.*\)/, "") + (e.line === "exp" ? "" : e.tip ? " tip" : " ride")) + '</td><td class="r">+' + $m(e.amount, true) + '</td><td class="r pos">' + $m(run, true) + '</td><td class="r" style="color:' + (rem != null && rem <= 0 ? "var(--lite)" : "var(--goldt)") + '">' + (rem != null && rem < 0 ? "ahead by " + $m(-rem, true) : $m(rem, true)) + '</td><td class="r"><button class="btn ghost" data-del="' + esc(k) + '">Undo</button></td></tr>'; }).reverse().join("");
    h += '<div class="card day"><div class="fine">DAILY TOTAL</div><div class="total">' + $m(c.dayGross, true) + '</div>' +
      '<form id="gl-f-q" class="row"><input id="gl-q-amt" type="text" inputmode="decimal" autocomplete="off" placeholder="Ride 0.00" aria-label="Ride amount"><input id="gl-q-tip" type="text" inputmode="decimal" autocomplete="off" placeholder="Tip" aria-label="Tip (optional)" style="font-size:28px;width:120px;text-align:right"><select id="gl-q-line" aria-label="Source">' +
      LINES.concat(EXP).map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === D.lastLine ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + '</select><button class="btn" type="submit" style="font-size:20px;padding:10px 26px">Add</button></form>' +
      (tape ? '<table style="margin-top:8px"><tr class="fine"><th style="text-align:left">Source</th><th class="r">Amount</th><th class="r">Daily total</th><th class="r">Goal left</th><th></th></tr>' + tape + "</table>" : "") +
      (c.expD ? '<p class="fine">Expenses today ' + $m(c.expD, true) + " \u00b7 net " + $m(c.dayGross - c.expD, true) + "</p>" : "") + "</div>";
    h += '<div class="card"><b class="t">Week</b><table>' + row("WEEKLY GOAL", $m(c.weekGoal)) + row("<b>Left for the week</b>", $m(left(c.weekRem))) + row("WEEK TOTAL", $m(c.weekTotal)) + row("WEEKLY EXPENSES", $m(c.expW)) +
      row("After expenses", $m(c.weekTotal - c.expW)) + row("UBER GOAL", $m(c.uberG)) + row("UBER WEEK TOTAL", $m(g("w", "uber"))) + row("UBER REMAINING", $m(left(c.uberRem))) + row("UBER TODAY'S GOAL", $m(c.uberDaily, true), sub(g("d", "uber"), c.uberDaily)) + "</table></div>";
    h += '<div class="card"><b class="t">Month &amp; year</b><table>' + row("MONTHLY GOAL", $m(c.monthGoal)) + row("MONTHLY TOTAL", $m(c.monthTotal), sub(c.monthTotal, c.monthGoal)) + row("MONTHLY EXPENSES", $m(c.expM)) + row("After expenses", $m(c.monthTotal - c.expM)) + row("MONTHLY REMAINING", $m(left(c.monthRem))) +
      row("YEAR GOAL", $m(c.yearGoal)) + row("YEAR TOTAL", $m(c.yearTotal), sub(c.yearTotal, c.yearGoal)) + row("YEAR EXPENSES", $m(c.expY)) + row("YEAR REMAINING", $m(left(c.yearRem))) + "</table></div>";
    h += '<div class="card"><b class="t">Income lines</b><table><tr><th></th><th class="r" style="color:var(--goldt)">Today</th><th class="r" style="color:var(--goldt)">Week</th><th class="r" style="color:var(--goldt)">Month</th><th class="r" style="color:var(--goldt)">Year</th></tr>' + LINES.concat(EXP).map(function (l) { var k = "tip:" + l[0], tr = g("y", k) ? '<tr class="fine"><td>\u21b3 of which tips</td><td class="r">' + $m(g("d", k)) + '</td><td class="r">' + $m(g("w", k)) + '</td><td class="r">' + $m(g("m", k)) + '</td><td class="r">' + $m(g("y", k)) + "</td></tr>" : "";
      return "<tr><td>" + l[1] + '</td><td class="r">' + $m(g("d", l[0])) + '</td><td class="r">' + $m(g("w", l[0])) + '</td><td class="r">' + $m(g("m", l[0])) + '</td><td class="r">' + $m(g("y", l[0])) + "</td></tr>" + tr; }).join("") +
      '<tr class="b"><td><b>TOTAL income</b></td><td class="r"><b>' + $m(c.dayGross) + '</b></td><td class="r"><b>' + $m(c.weekTotal) + '</b></td><td class="r"><b>' + $m(c.monthTotal) + '</b></td><td class="r"><b>' + $m(c.yearTotal) + "</b></td></tr></table></div>";
    return h;
  }
  function REST(c) { var h = "";
    h += '<form class="card" id="gl-f-add"><b class="t">Add past entry</b><br><input id="gl-a-date" type="date" value="' + esc(c.t) + '"> <select id="gl-a-line">' + LINES.concat(EXP).map(function (l) { return '<option value="' + l[0] + '">' + l[1] + "</option>"; }).join("") + '</select> <input id="gl-a-amt" type="text" inputmode="decimal" autocomplete="off" placeholder="Amount" style="width:120px"> <label style="display:inline"><input type="checkbox" id="gl-a-tip"> tip</label> <input id="gl-a-note" placeholder="Note" style="width:150px"> <button class="btn" type="submit">Add</button></form>';
    h += '<div class="card"><b class="t">Backup &amp; import</b><p class="fine">Everything stays on this device, encrypted. Export a backup regularly.</p><div class="row" style="justify-content:flex-start">' +
      '<button class="btn ghost" id="gl-b-exp">Export encrypted backup</button><button class="btn ghost" id="gl-b-csv">Export CSV (not encrypted)</button>' +
      '<label class="btn ghost">Import CSV / seed / backup<input type="file" id="gl-b-imp" accept=".csv,.json,text/csv,application/json" hidden></label></div><p class="fine" id="gl-imp-msg"></p>' +
      '<p class="fine">CSV format: Date,Category,Service,Amount,Notes (Service uber/lyft; Category Other = PCS, Tips = Cash (or a tip on the Service named), Bonus = Uber, Officiating, VA, Expense). ' + Object.keys(D.entries).length + " entries stored.</p></div>";
    return h;
  }
  function num(v) { var n = Number(String(v == null ? "" : v).replace(/[$,\s]/g, "")); return String(v).trim() !== "" && isFinite(n) ? n : null; }
  function newId(at) { return String(at) + "-" + Math.random().toString(36).slice(2, 7); }
  /* v75l: read the Goals form into settings. Days left is only re-stamped when its box actually changed,
     so the typed value counts for today and then counts down one per day. */
  var setTimer = null;
  function readGoals() { var s = D.settings;
    [["gl-s-week", "weekOv"], ["gl-s-day", "dayOv"], ["gl-s-uber", "uber"], ["gl-s-month", "monthOv"], ["gl-s-year", "year"]].forEach(function (p) { var el = document.getElementById(p[0]); if (el) s[p[1]] = num(el.value); });
    var de = document.getElementById("gl-s-days"); if (de) { var d = num(de.value); if (d !== calc().dLeft) { s.daysLeft = d; s.daysLeftSet = today(); } } }
  function goalsSaved(m) { var x = document.getElementById("gl-set-msg"); if (x) x.textContent = m; }
  function bind() {
    bindTop();
    var fs = document.getElementById("gl-f-set");
    fs.onsubmit = function (e) { e.preventDefault(); clearTimeout(setTimer); readGoals(); paint(); save().then(function () { goalsSaved("Saved."); }); };
    fs.oninput = function () { readGoals(); paintTop(); goalsSaved("Saving\u2026"); clearTimeout(setTimer); setTimer = setTimeout(function () { save().then(function () { goalsSaved("Saved."); }); }, 600); };
    fs.onchange = function () { readGoals(); paintTop(); clearTimeout(setTimer); save().then(function () { goalsSaved("Saved."); }); };
    Array.prototype.forEach.call(document.querySelectorAll("#gl-screen .gl-ovin"), function (el) { el.readOnly = false; el.disabled = false; el.removeAttribute("readonly"); el.removeAttribute("disabled");
      el.addEventListener("touchend", function () { if (document.activeElement !== el) el.focus(); }); });
    bindRest();
  }
  function bindTop() {
    document.getElementById("gl-b-lock").onclick = function () { lockNow("Locked."); };
    document.getElementById("gl-f-q").onsubmit = function (e) { e.preventDefault(); var a = num(document.getElementById("gl-q-amt").value), l = document.getElementById("gl-q-line").value;
      var tp = num(document.getElementById("gl-q-tip").value);
      if (!(a > 0) && !(tp > 0)) { document.getElementById("gl-q-amt").focus(); return; } var at = Date.now();
      if (a > 0) D.entries[newId(at)] = { date: today(), line: l, amount: Math.round(a * 100) / 100, note: "", at: at, source: "quick" };
      if (tp > 0 && l !== "exp") D.entries[newId(at + 1)] = { date: today(), line: l, amount: Math.round(tp * 100) / 100, note: "", at: at + 1, source: "quick", tip: true };
      D.lastLine = l; paint.focusQ = true; paint(); save(); };
    Array.prototype.forEach.call(document.querySelectorAll("#gl-top [data-del]"), function (b) { b.onclick = function () { if (confirm("Undo this entry?")) { delete D.entries[b.getAttribute("data-del")]; paint(); save(); } }; });
  }
  function bindRest() {
    document.getElementById("gl-f-add").onsubmit = function (e) { e.preventDefault(); var a = num(document.getElementById("gl-a-amt").value), d = document.getElementById("gl-a-date").value;
      if (a == null || !d) return alert("Enter a date and amount."); var at = Date.now();
      D.entries[newId(at)] = { date: d, line: document.getElementById("gl-a-line").value, amount: a, note: document.getElementById("gl-a-note").value.trim(), at: at, source: "manual", tip: document.getElementById("gl-a-tip").checked || undefined }; paint(); save(); };
    document.getElementById("gl-b-exp").onclick = function () { kvGet("vault").then(function (v0) { var v = Object.assign({}, v0, { pw: { iv: v0.pw.iv, w: Array.from(v0.pw.w) }, ct: Array.from(v0.ct) }); download("ledger-backup-" + today() + ".json", JSON.stringify({ pcsLedgerBackup: 1, vault: v }), "application/json"); }); };
    document.getElementById("gl-b-csv").onclick = function () { if (confirm("The CSV is NOT encrypted. Export anyway?")) download("ledger-" + today() + ".csv", toCsv(), "text/csv"); };
    document.getElementById("gl-b-imp").onchange = function (e) { var file = e.target.files[0]; if (!file) return; file.text().then(function (txt) { importText(file.name, txt); }); e.target.value = ""; };
  }
  function download(n, txt, type) { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: type })); a.download = n; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  var OUT = { uber: ["", "uber"], lyft: ["", "lyft"], pcs: ["Other", ""], cash: ["Tips", ""], ofc: ["Officiating", ""], va: ["VA", ""], exp: ["Expense", ""] };
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv() { return "Date,Category,Service,Amount,Notes\n" + Object.keys(D.entries).map(function (k) { return D.entries[k]; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || 0) - (b.at || 0); })
      .map(function (e) { var o = e.tip ? ["Tips", e.line] : (OUT[e.line] || ["", e.line]); return [e.date, o[0], o[1], Number(e.amount).toFixed(2), e.note].map(csvCell).join(","); }).join("\n") + "\n"; }
  function parseCsv(t) { var rows = [], r = [], f = "", q = false; for (var i = 0; i < t.length; i++) { var ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { r.push(f); f = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; r.push(f); rows.push(r); r = []; f = ""; } else f += ch; }
    if (f || r.length) { r.push(f); rows.push(r); } return rows.filter(function (x) { return x.join("").trim(); }); }
  function mapLine(cat, svc, note) { cat = String(cat || "").trim().toLowerCase(); svc = String(svc || "").trim().toLowerCase();
    if (svc === "uber" || svc === "lyft") return svc; if (cat === "tips" && /^(pcs|ofc|va|cash)$/.test(svc)) return svc; if (cat === "other" || cat === "pcs") return "pcs"; if (cat === "tips" || cat === "cash") return "cash";
    if (cat === "bonus") return "uber"; if (/offic|football|softball/.test(cat)) return "ofc"; if (cat === "va") return "va"; if (/expense|fuel|gas/.test(cat)) return "exp"; return ""; }
  function fp(e) { return [e.date, e.line + (e.tip ? ":tip" : ""), Number(e.amount).toFixed(2), String(e.note || "").trim()].join("|"); }
  function addMany(list, src) { /* skips exact duplicates (same date, line, amount, note) already stored, so re-importing is safe */
    var have = {}; Object.keys(D.entries).forEach(function (k) { var x = fp(D.entries[k]); have[x] = (have[x] || 0) + 1; });
    var seen = {}, added = 0, dup = 0, base = Date.now();
    list.forEach(function (e, i) { var x = fp(e); seen[x] = (seen[x] || 0) + 1; if (seen[x] <= (have[x] || 0)) { dup++; return; }
      var at = Number(e.at) || base + i; D.entries[newId(at)] = { date: e.date, line: e.line, amount: Math.round(Number(e.amount) * 100) / 100, note: e.note || "", at: at, source: src, tip: e.tip ? true : undefined }; added++; });
    return { added: added, dup: dup };
  }
  function importText(fname, txt) {
    var msg = document.getElementById("gl-imp-msg"), list = [], skipped = 0;
    try {
      if (/^\s*[\[{]/.test(txt)) { var j = JSON.parse(txt);
        if (j && j.pcsLedgerBackup) { var pw = prompt("Password for this backup:"); if (!pw) return; var v = j.vault; v.ct = new Uint8Array(v.ct); if (v.pw) v.pw.w = new Uint8Array(v.pw.w);
          openWithPassword(v, pw).then(function (o) { var d = o.d; var r = addMany(Object.keys(d.entries).map(function (k) { return d.entries[k]; }), "backup");
            if (confirm("Also replace goals with the backup's goals?")) D.settings = d.settings || {}; paint(); save(); document.getElementById("gl-imp-msg").textContent = "Backup: " + r.added + " added, " + r.dup + " duplicates skipped."; })
            .catch(function () { msg.textContent = "Wrong password for that backup."; }); return; }
        Object.keys(j || {}).forEach(function (k) { var e = j[k] || {}; var l = e.line === "ofc" || LINES.concat(EXP).some(function (x) { return x[0] === e.line; }) ? e.line : "";
          if (l && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && isFinite(Number(e.amount))) list.push({ date: e.date, line: l, amount: Number(e.amount), note: e.note, at: e.at, tip: !!e.tip }); else skipped++; });
      } else { var rows = parseCsv(txt), hd = rows.shift().map(function (x) { return x.trim().toLowerCase(); }), ix = function (n) { return hd.indexOf(n); };
        rows.forEach(function (r) { var d = (r[ix("date")] || "").trim(), a = num(r[ix("amount")]), l = mapLine(r[ix("category")], r[ix("service")]);
          if (/^\d{4}-\d{2}-\d{2}$/.test(d) && a != null && l) list.push({ date: d, line: l, amount: a, note: (r[ix("notes")] || "").trim(), tip: String(r[ix("category")] || "").trim().toLowerCase() === "tips" && !!String(r[ix("service")] || "").trim() }); else skipped++; }); }
    } catch (e) { msg.textContent = "Could not read " + fname + ": " + e.message; return; }
    var r = addMany(list, "import"); paint(); save();
    document.getElementById("gl-imp-msg").textContent = fname + ": " + r.added + " added, " + r.dup + " duplicates skipped" + (skipped ? ", " + skipped + " rows not understood" : "") + ".";
  }

  /* ---------- God mode panel: open / close (v75g) ---------- */
  function glOpen() {
    var ov = document.getElementById("gl-screen"); if (ov) ov.remove();
    if (!document.getElementById("gl-style")) { var st = document.createElement("style"); st.id = "gl-style"; st.textContent = GL_CSS; document.head.appendChild(st); }
    ov = document.createElement("div"); ov.id = "gl-screen";
    ov.style.cssText = "position:fixed;inset:0;z-index:9100;background:#0b1f0b;color:#eef5ee;overflow:auto;-webkit-overflow-scrolling:touch;font:16px/1.35 -apple-system,system-ui,Segoe UI,Roboto,sans-serif";
    ov.innerHTML = '<button type="button" id="gl-close" aria-label="Close Monthly Goal">Close \u2715</button><main id="gl-app"><p class="fine">Loading\u2026</p></main>';
    document.body.appendChild(ov); app = document.getElementById("gl-app");
    document.getElementById("gl-close").onclick = glClose;
    lastAct = Date.now();
    idb().then(function () { lockNow(); }).catch(function () { app.innerHTML = '<p class="err">This browser cannot store the ledger (private browsing?).</p>'; });
  }
  function glClose() { dek = null; D = null; app = null; var ov = document.getElementById("gl-screen"); if (ov) ov.remove(); }
  if (typeof module !== "undefined" && module.exports) module.exports = { repair: repair, _set: function (d) { D = d; }, calc: calc, planAdjust: planAdjust, ytdTotal: ytdTotal, ADJ: ADJ, weeksLeft: weeksLeft };
  window.__pcsGoalOpen = glOpen; window.__pcsGoalClose = glClose;
  document.addEventListener("click", function (e) { var t = e.target.closest ? e.target.closest("[data-god-menu=goal]") : null; if (t) { e.stopPropagation(); glOpen(); } }, true);
})();
