/* PCS Monthly Goal (Matthew) - v76e: 'Fuel & expenses' replaced by 'Other' (positive income, in every total); expense and negative rows removed; work days Mon-Sat; partial weeks at the month's edges count only their in-month days; Sunday is the catch-up day and counts only if 'Working this Sunday' is on or Sunday income is logged; month daily pace uses work days left including today (Oct 14 = 15); Saturday shows 'Sunday catch-up needed'; on a worked Sunday today's goal = week remaining before Sunday. v76d: lock screens - 4th PIN digit unlocks by itself, keypad Done submits, Unlock works on the first tap (the pointerdown that closed the keypad shifted the page so the click missed the button). v76c: full step-by-step line only after Recalculate today; setup text reworded positively. v76b: today's goal is SNAPSHOT once a day {date, goal, weekly, weekBeforeToday, daysLeft} on first open/unlock and stays fixed all day; big Recalculate today button; 'Set today's goal' box counts for today only; Today remaining shows 'ahead by'; 'Rolled over from yesterday' removed; Week check card lists every entry Mon..yesterday so extra past entries are easy to spot. v76a: matches Matthew's morning math. Weeks left = whole Monday weeks left in the month (this week counts 1); weekly = month remaining at the start of this week / weeks left, optional round up (weekRound, e.g. 100); days left = Mon-Sat left this week including today (typed days only count on the day typed); today = week remaining before today / days left, rounded UP to the cent; month pace line; migrated month sets built from old year adjustments are dropped (doubling fix); week income comes from real entries only. v75z: weeks left prorated by working days (Mon-Sat) in the month; 'How today's goal was figured' line with every number; warning when month income before this week already passes the monthly goal; Adjustments show which past entries sit inside a YTD set. v75y: Adjustments are SET values (YTD and Month to date replace, never add); one-time migration of old adjustment entries keeping totals; Adjustments list + Past entries with Undo; month > year blocked; old heuristic repair removed. v75w: foolproof month repair - per source, if Month > Year, or Month > 40% of Year (March on), every adjustment dated this month (any scope) moves to Jan 1 and merges; a single non-adjustment entry this month bigger than 40% of Year moves too; visible 'goal v75w' label. v75v: robust repair - a month-to-date adjustment that is really a year figure (>40% of that source's YTD from March on, or >2x a plausible month) is re-dated to Jan 1 and netted with Apply's negative year remainder; Apply treats MTD >= 90% of YTD as YTD only. v75u: big on-screen 9-key pad (1-9 . 0 del, Clear, Done) on every money/number box; 'Use iPad keyboard' fallback. v75t: every money/number box opens the number pad (numPad helper after each render). v75s: tappable goal overrides, adjustment re-dating/repair, goals never negative. v75r: goal cascade + YTD totals. v75g: runs INSIDE God mode as its own Home panel (God Home > Monthly Goal).
   Own password + PIN, separate from God sign-in. Data stays on this device only (never Firebase, no network calls).
   Ported from the former standalone /ledger/ app; same IndexedDB vault.
   Local-first: all data lives on this device in IndexedDB, AES-GCM encrypted with a key derived from Matthew's own
   password (PBKDF2-SHA256, 600,000 rounds, random salt) via a random data key. Password once per 24 h; a 4-digit PIN
   (data key wrapped by a PIN key, PBKDF2 1,000,000 rounds) unlocks until that expires; 5 wrong PINs wipe the PIN copy. The password itself is never stored. Wrong password = data
   cannot decrypt. No network calls (CSP connect-src 'none'). Back up with "Export encrypted backup". */
(function () {
  "use strict";
  var GL_CSS = '#gl-screen{--bg:#0b1f0b;--card:#102810;--line:#2e5a2e;--green:#3fae5a;--lite:#7ee08f;--gold:#d4af37;--goldt:#f0d48a;--red:#ff8a80;--txt:#eef5ee}#gl-screen,#gl-screen *{box-sizing:border-box}#gl-screen,#gl-screen{margin:0;background:var(--bg);color:var(--txt);font:16px/1.35 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}#gl-screen main{max-width:760px;margin:0 auto;padding:14px 14px 80px}#gl-screen h1{color:var(--goldt);font-size:24px;margin:6px 0 10px}#gl-screen .card{border:1px solid var(--line);border-radius:14px;padding:12px;margin:10px 0;background:var(--card)}#gl-screen .card.hero{border:2px solid var(--gold)}#gl-screen .card.day{border:2px solid var(--green);text-align:center;background:#0f300f}#gl-screen .card b.t{color:var(--goldt);font-size:17px}#gl-screen .grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}#gl-screen .big{flex:1 1 30%;min-width:110px;background:#163a16;border:1px solid var(--green);border-radius:10px;padding:8px}#gl-screen .big .v{font-size:22px;font-weight:900}#gl-screen .neg{color:var(--red)}#gl-screen .pos{color:var(--lite)}#gl-screen .fine{font-size:13px;color:#b9cdb9}#gl-screen table{width:100%;border-collapse:collapse}#gl-screen td,#gl-screen th{padding:4px 3px}#gl-screen td.r,#gl-screen th.r{text-align:right}#gl-screen tr.b{border-top:1px solid var(--line)}#gl-screen input,#gl-screen select{font-size:16px;padding:9px;border-radius:10px;border:1px solid #9ab79a;background:#fff;color:#000}#gl-screen .btn{font-weight:800;border-radius:12px;padding:10px 16px;border:2px solid var(--gold);background:linear-gradient(#f0d48a,#d4af37);color:#0b1f0b;cursor:pointer;font-size:16px}#gl-screen .btn.ghost{background:transparent;color:var(--goldt)}#gl-screen .total{font-size:42px;font-weight:900;color:var(--lite)}#gl-screen #gl-q-amt{font-size:28px;width:170px;text-align:right}#gl-screen label{display:inline-block;margin:4px 8px 4px 0}#gl-screen label span{display:block}#gl-screen .lock{max-width:420px;margin:12vh auto;padding:20px}#gl-screen .err{color:var(--red);min-height:1.2em}#gl-screen .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:center}#gl-screen .btn.ghost{background:#f3f4f6;color:#1a1a1a;border:2px solid #6b7280}#gl-screen .lock{color:#eef5ee}#gl-screen summary{cursor:pointer}#gl-screen input,#gl-screen .gl-ovin{pointer-events:auto;touch-action:manipulation;-webkit-user-select:text;user-select:text;position:relative;z-index:2}#gl-screen .gl-ovin::placeholder{color:#555;opacity:1}#gl-close{position:fixed;top:max(40px,calc(10px + env(safe-area-inset-top)));right:max(16px,env(safe-area-inset-right));z-index:9101;min-height:52px;min-width:120px;font-size:20px;font-weight:900;border-radius:14px;border:2px solid #fff;background:#1f8a3b;color:#fff;cursor:pointer}#gl-screen main{padding-top:100px}#gl-kp{display:none;position:fixed;left:0;right:0;bottom:0;z-index:9102;background:#0b3d17;border-top:3px solid #3fae5a;padding:10px max(10px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));box-shadow:0 -6px 24px rgba(0,0,0,.6)}#gl-kp .kp-top{display:flex;align-items:center;gap:10px;max-width:520px;margin:0 auto 8px}#gl-kp #gl-kp-lbl{flex:1;text-align:center;color:#fff;font-weight:800;font-size:17px}#gl-kp .kp-g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:520px;margin:0 auto}#gl-kp button{-webkit-user-select:none;user-select:none;touch-action:manipulation;cursor:pointer}#gl-kp .kp-g button{min-height:68px;font-size:32px;font-weight:800;border-radius:14px;border:2px solid #1f8a3b;background:#fff;color:#0b1f0b}#gl-kp .kp-g button:active{background:#c8f0d0}#gl-kp.whole button[data-k=\".\"]{visibility:hidden}#gl-kp .kp-sm{min-height:48px;padding:8px 14px;font-size:16px;font-weight:800;border-radius:12px;border:2px solid #fff;background:#1f8a3b;color:#fff}#gl-kp .kp-clr{background:#fff;color:#0b1f0b;border-color:#1f8a3b}#gl-kp .kp-done{display:block;width:100%;max-width:520px;margin:10px auto 0;min-height:68px;font-size:26px;font-weight:900;border-radius:14px;border:2px solid #fff;background:#1f8a3b;color:#fff}#gl-screen.kp-open #gl-close{display:none}#gl-kb-tog{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:9101;min-height:44px;padding:8px 14px;font-size:15px;font-weight:800;border-radius:12px;border:2px solid #fff;background:#1f8a3b;color:#fff}#gl-screen.kp-open #gl-kb-tog{display:none!important}';
  var ITER = 600000, LOCK_MS = 5 * 60000, MINPW = 10;
  var LINES = [["uber", "Uber"], ["lyft", "Lyft"], ["pcs", "PCS (private clients)"], ["ofc", "Officiating (Football/Softball)"], ["va", "VA"], ["cash", "Cash"], ["oth", "Other"]];
  var EXP = [["exp", "Old fuel & expenses"]]; /* v76e: kept only so old entries still show; never offered, never in totals */
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
  /* v75t: number pad on every money/number box. decimal = dollars (keypad with a point), numeric = whole counts (days left, PIN). */
  function numPad(root) { if (!root || !root.querySelectorAll) return 0; var n = 0; [].forEach.call(root.querySelectorAll("input"), function (el) {
    if (el.readOnly || /^(password|checkbox|radio|date|time|file|hidden)$/.test(el.type) && !(el.type === "password" && el.getAttribute("inputmode") === "numeric")) return;
    var im = el.getAttribute("inputmode"), whole = el.id === "gl-s-days" || im === "numeric", money = whole || im === "decimal" || el.type === "number";
    if (!money) return; if (el.type === "number") el.type = "text";
    el.setAttribute("inputmode", whole ? "numeric" : "decimal"); el.setAttribute("pattern", whole ? "[0-9]*" : "[0-9]*[.]?[0-9]*");
    el.setAttribute("autocomplete", "off"); el.setAttribute("autocorrect", "off"); el.setAttribute("spellcheck", "false"); kpMark(el, whole); n++; }); return n; }
  /* v75u: big on-screen 9-key pad (iPadOS has none). Boxes marked by numPad get data-kp="d" (dollars, has a point) or "w" (whole: days, PIN).
     While the pad is on, inputmode="none" hides the system keyboard; caret + value still show. Physical keyboards still type normally. */
  var KP_KEY = "pcsGoalSysKb", kpEl = null, kpCur = null;
  function kpOn() { try { return localStorage.getItem(KP_KEY) !== "1"; } catch (e) { return true; } }
  function kpMark(el, whole) { el.setAttribute("data-kp", whole ? "w" : "d"); if (kpOn()) el.setAttribute("inputmode", "none"); }
  function kpRefresh() { var ov = document.getElementById("gl-screen"); if (!ov) return; [].forEach.call(ov.querySelectorAll("input[data-kp]"), function (el) { el.setAttribute("inputmode", kpOn() ? "none" : (el.getAttribute("data-kp") === "w" ? "numeric" : "decimal")); });
    var t = document.getElementById("gl-kb-tog"); if (t) { t.textContent = kpOn() ? "Use iPad keyboard" : "Use big keypad"; t.style.display = kpOn() ? "none" : ""; } }
  function kpBuild() { if (kpEl) return kpEl; var d = document.createElement("div"); d.id = "gl-kp"; d.setAttribute("role", "group"); d.setAttribute("aria-label", "Number pad");
    d.innerHTML = '<div class="kp-top"><button type="button" data-k="sys" class="kp-sm">Use iPad keyboard</button><span id="gl-kp-lbl"></span><button type="button" data-k="clr" class="kp-sm kp-clr">Clear</button></div><div class="kp-g">' +
      ["1","2","3","4","5","6","7","8","9",".","0","bs"].map(function (k) { return '<button type="button" data-k="' + k + '"' + (k === "bs" ? ' aria-label="Delete">\u232b' : ">" + k) + "</button>"; }).join("") +
      '</div><button type="button" data-k="done" class="kp-done">Done</button>';
    d.addEventListener("pointerdown", function (e) { e.preventDefault(); }); d.addEventListener("mousedown", function (e) { e.preventDefault(); });
    d.addEventListener("click", function (e) { var b = e.target.closest ? e.target.closest("button[data-k]") : null; if (b) kpPress(b.getAttribute("data-k")); });
    kpEl = d; return d; }
  function kpFire(el) { el.dispatchEvent(new Event("input", { bubbles: true })); }
  function kpPress(k) { var el = kpCur; if (k === "done") { if (el) el.dispatchEvent(new Event("change", { bubbles: true })); var fm = el && el.form && /^gl-f-(pin|unlock)$/.test(el.form.id) ? el.form : null; kpClose(); if (fm) lockSubmit(fm); return; }
    if (k === "sys") { try { localStorage.setItem(KP_KEY, "1"); } catch (e) {} var c = kpCur; kpClose(); kpRefresh(); if (c) { c.blur(); setTimeout(function () { c.focus(); }, 30); } return; }
    if (!el) return; var v = el.value, s = el.selectionStart, en = el.selectionEnd; if (s == null || el.type === "password") { s = en = v.length; }
    var whole = el.getAttribute("data-kp") === "w", nv;
    if (k === "clr") nv = "", s = 0;
    else if (k === "bs") { if (s === en && s > 0) s--; nv = v.slice(0, s) + v.slice(en); }
    else { if (k === "." && (whole || v.slice(0, s).concat(v.slice(en)).indexOf(".") >= 0)) return; nv = v.slice(0, s) + k + v.slice(en);
      if (k === "." && s === 0) { nv = "0" + nv; s++; }
      var dp = nv.indexOf("."); if (dp >= 0 && nv.length - dp - 1 > 2) return;
      var ml = parseInt(el.getAttribute("maxlength"), 10); if (ml > 0 && nv.length > ml) return; s++; }
    el.value = nv; try { el.setSelectionRange(s, s); } catch (e) {} kpFire(el); }
  function kpShow(el) { if (!kpOn()) return; var ov = document.getElementById("gl-screen"); if (!ov) return; var d = kpBuild(); if (d.parentNode !== ov) ov.appendChild(d);
    if (kpCur && kpCur !== el) kpCur.dispatchEvent(new Event("change", { bubbles: true }));
    kpCur = el; d.classList.toggle("whole", el.getAttribute("data-kp") === "w"); d.style.display = "block"; ov.classList.add("kp-open");
    var lb = document.getElementById("gl-kp-lbl"); if (lb) lb.textContent = el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
    var m = document.getElementById("gl-app"); if (m) m.style.paddingBottom = (d.offsetHeight + 40) + "px";
    setTimeout(function () { var r = el.getBoundingClientRect(), top = d.getBoundingClientRect().top || (window.innerHeight - d.offsetHeight);
      if (r.bottom > top - 16) ov.scrollTop += r.bottom - top + 24; else if (r.top < 100) ov.scrollTop -= 110 - r.top; }, 0); }
  function kpClose() { if (kpEl) kpEl.style.display = "none"; var ov = document.getElementById("gl-screen"); if (ov) ov.classList.remove("kp-open"); var m = document.getElementById("gl-app"); if (m) m.style.paddingBottom = "";
    if (kpCur) { try { kpCur.blur(); } catch (e) {} } kpCur = null; }
  function kpWire(ov) { kpEl = null; kpCur = null;
    ov.addEventListener("focusin", function (e) { var t = e.target; if (t && t.getAttribute && t.getAttribute("data-kp")) kpShow(t); });
    ov.addEventListener("pointerdown", function (e) { var t = e.target; if (!kpCur) return; if (kpEl && kpEl.contains(t)) return; if (t && t.getAttribute && t.getAttribute("data-kp")) return kpShow(t); if (t && t.closest && t.closest("button")) return; /* v76d: let the button's click land first; it closes the pad itself */ kpClose(); }, true);
    ov.addEventListener("click", function (e) { var t = e.target; if (kpCur && t && t.closest && t.closest("button") && !(kpEl && kpEl.contains(t))) setTimeout(kpClose, 0); });
    ov.addEventListener("keydown", function (e) { if (kpCur && e.key === "Escape" && e.target === kpCur) kpClose(); });
    var tg = document.createElement("button"); tg.type = "button"; tg.id = "gl-kb-tog"; tg.onclick = function () { try { localStorage.removeItem(KP_KEY); } catch (e) {} kpRefresh(); }; ov.appendChild(tg); kpRefresh(); }

  /* v76d: one submit at a time for the lock forms (Done, 4th digit and Unlock all land here) */
  var lockBusy = false;
  function lockSubmit(fm) { if (lockBusy || !fm) return; if (fm.requestSubmit) fm.requestSubmit(); else fm.dispatchEvent(new Event("submit", { cancelable: true })); }
  function lockWire(fm, inp) { [].forEach.call(fm.querySelectorAll("button[type=submit]"), function (b) { b.addEventListener("pointerdown", function (e) { e.preventDefault(); }); b.addEventListener("mousedown", function (e) { e.preventDefault(); }); });
    if (inp) { inp.setAttribute("enterkeyhint", "go"); setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0); } }
  function shell(inner, msg) { kpClose(); lockBusy = false; app.innerHTML = '<div class="lock card"><h1>Monthly Goal</h1>' + inner + '<p class="err" id="gl-err">' + (msg || "") + "</p></div>"; numPad(app); return document.getElementById("gl-err"); }
  function lockNow(msg) { dek = null; D = null; if (!app) return; kvGet("vault").then(function (v) { if (!v) return firstRun(); pinValid().then(function (p) { if (p) pinScreen(p, msg); else pwScreen(msg); }); }); }
  function firstRun(msg) {
    var err = shell('<p>Create your ledger password (not your God mode password), at least ' + MINPW + ' characters, and a 4-digit PIN. ' +
      'The password is needed once every 24 hours; in between, the PIN unlocks. Keep your password somewhere safe. It\u2019s the only way back into your ledger, so keep an encrypted backup too.</p>' +
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
    lockWire(document.getElementById("gl-f-unlock"), document.getElementById("gl-pw"));
    document.getElementById("gl-f-unlock").onsubmit = function (e) { e.preventDefault(); if (lockBusy) return; if (!val("gl-pw")) { err.textContent = "Type your password."; return; } lockBusy = true; err.textContent = "Unlocking\u2026";
      kvGet("vault").then(function (v) { return openWithPassword(v, val("gl-pw")); }).then(function (r) { dek = r.key; D = r.d; return D.pin ? pinArm(D.pin) : null; })
        .then(start).catch(function () { lockBusy = false; err.textContent = "Wrong password."; var x = document.getElementById("gl-pw"); if (x) { x.value = ""; x.focus(); } }); };
  }
  function pinScreen(p, msg) {
    var left = PIN_TRIES - (p.fails || 0), hrs = Math.max(0, Math.round((p.exp - Date.now()) / 360000) / 10);
    var err = shell('<form id="gl-f-pin"><p class="fine">Enter your PIN (' + hrs + ' h left before the password is needed again).</p><p><input type="password" id="gl-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN" style="width:100%;font-size:28px;text-align:center;letter-spacing:8px" autofocus></p>' +
      '<button class="btn" type="submit">Unlock</button> <button class="btn ghost" type="button" id="gl-b-usepw">Use password</button></form>', msg || (left < PIN_TRIES ? left + " tries left" : ""));
    document.getElementById("gl-b-usepw").onclick = function () { pwScreen(); };
    var pinEl = document.getElementById("gl-pin"), pinFm = document.getElementById("gl-f-pin"); lockWire(pinFm, pinEl);
    pinEl.addEventListener("input", function () { pinEl.value = pinEl.value.replace(/\D/g, "").slice(0, 4); if (pinEl.value.length === 4) lockSubmit(pinFm); }); /* v76d: 4th digit unlocks */
    pinFm.onsubmit = function (e) { e.preventDefault(); if (lockBusy) return; var pin = val("gl-pin"); if (!/^\d{4}$/.test(pin)) { err.textContent = "4 digits."; return; } lockBusy = true;
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
  /* v76b: once-a-day snapshot of today's goal */
  function snapToday(force) { var s = D.settings = D.settings || {}, t = today(); if (!force && s.daySnap && s.daySnap.date === t) return false; var c = calc(t);
    if (c.dailyAuto == null) return false; s.daySnap = { date: t, goal: c.dailyAuto, weekly: c.weekGoal, weekBeforeToday: r2(c.wBefore), daysLeft: c.dLeft, at: Date.now(), recalc: !!force }; return true; }
  function start() { lastAct = Date.now(); var fixed = 0; try { fixed = migrate(); } catch (e) {} if (snapToday()) fixed = 1; paint(); if (fixed) save(); }
  ["click", "keydown", "touchstart", "input"].forEach(function (t) { document.addEventListener(t, function () { lastAct = Date.now(); }, true); });
  setInterval(function () { if (app && dek && Date.now() - lastAct > LOCK_MS) lockNow("Locked after 5 quiet minutes."); }, 15000);
  document.addEventListener("visibilitychange", function () { if (document.hidden) lastAct = Math.min(lastAct, Date.now()); else if (app && dek && Date.now() - lastAct > LOCK_MS) lockNow("Locked."); });

  /* ---------- math (same rules as the Monthly Goal tracker) ---------- */
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); }
  function addDays(ymd, n) { return new Date(Date.parse(ymd + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10); }
  function goal(v) { return Number(v) > 0 ? Number(v) : null; }
  function sub(a, b) { return a == null || b == null ? null : a - b; }
  /* Monday-start weeks left in this month, counting the current one */
  /* v75z: this week counts as 1; each later Mon-Sun week counts by its working days (Mon-Sat) inside this month / 6 */
  /* v76a: whole weeks - this week + every later Monday inside this month (Oct 14 2026 -> 12, 19, 26 = 3) */
  function weeksLeft(t, wk0) { var n = 1, d = addDays(wk0, 7), m = t.slice(0, 7); while (d.slice(0, 7) === m) { n++; d = addDays(d, 7); } return n; }
  function ceilC(n) { return n == null ? null : Math.ceil(Math.round(n * 1000) / 10) / 100; }
  /* v76e: Mon-Sat work days left in the month, today included; a Sunday counts only when sunOK(date) says so (Oct 14 2026 -> 15) */
  function isSun(d) { return new Date(d + "T12:00:00Z").getUTCDay() === 0; }
  function monthDaysLeft(t, sunOK) { var n = 0, d = t; while (d.slice(0, 7) === t.slice(0, 7)) { if (!isSun(d) || (sunOK && sunOK(d))) n++; d = addDays(d, 1); } return Math.max(1, n); }
  function calc(t) {
    t = t || today(); var s = D.settings || {}, dow = (new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7, wk0 = addDays(t, -dow), yday = addDays(t, -1);
    var y = t.slice(0, 4), m = t.slice(0, 7), m1 = m + "-01", sum = {};
    function add(k, v) { sum[k] = (sum[k] || 0) + v; }
    var wkS = wk0 < m1 ? m1 : wk0; /* v76e: a week that started last month only counts this month's days */
    var LIST = Object.keys(D.entries).map(function (k) { return D.entries[k]; }).concat(derived(t)); /* v75y: set adjustments are virtual */
    LIST.forEach(function (e) { var d = String(e.date || ""), a = Number(e.amount) || 0, l = e.line;
      var adj = e.type === "adjustment", inW = d >= wkS && d <= t && (!adj || e.scope === "w"), inD = d === t && !adj; /* v75q: month/year adjustments never touch Today or the week */
      var bm = d < m1 || (adj && e.scope === "y"), bw = d < wkS || (adj && (e.scope === "y" || e.scope === "m")); /* v75s: older adjustments count by date too */ /* v75r: income before this month / before this week */
      if (d.slice(0, 4) === y && bm) add("yb:" + l, a); if (d.slice(0, 7) === m && bw && !(adj && e.scope === "y")) add("mb:" + l, a);
      if (d.slice(0, 4) === y) add("y:" + l, a); if (d.slice(0, 7) === m) add("m:" + l, a); if (inW) add("w:" + l, a); if (inD) add("d:" + l, a); if (d === yday && !adj) add("y1:" + l, a);
      if (e.tip) { if (d.slice(0, 4) === y) add("y:tip:" + l, a); if (d.slice(0, 7) === m) add("m:tip:" + l, a); if (inW) add("w:tip:" + l, a); if (inD) add("d:tip:" + l, a); } });
    function g(sc, l) { return sum[sc + ":" + l] || 0; }
    function inc(sc) { return LINES.reduce(function (a, l) { return a + g(sc, l[0]); }, 0); }
    /* v75r cascade: year (typed) -> month -> week -> today; each derived goal is auto unless overridden */
    var yearGoal = goal(s.year), mLeft = 12 - Number(t.slice(5, 7)) + 1, wLeft = weeksLeft(t, wk0);
    var monthAuto = yearGoal == null ? null : Math.max(0, (yearGoal - inc("yb")) / mLeft), monthOv = goal(s.monthOv), monthGoal = monthOv != null ? monthOv : monthAuto;
    var weekRaw = monthGoal == null ? null : Math.max(0, (monthGoal - inc("mb")) / wLeft), wRound = goal(s.weekRound), weekAuto = weekRaw == null ? null : wRound ? Math.ceil(r2(weekRaw) / wRound) * wRound : r2(weekRaw), weekOv = goal(s.weekOv), weekGoal = weekOv != null ? weekOv : weekAuto;
    var dTyped = goal(s.daysLeft), dSet = String(s.daysLeftSet || "");
    var passed = dSet && dSet <= t ? Math.round((Date.parse(t + "T12:00:00Z") - Date.parse(dSet + "T12:00:00Z")) / 86400000) : 0;
    var sun = addDays(wk0, 6), sunInc = 0; LIST.forEach(function (e) { if (e.date === sun && e.type !== "adjustment" && e.line !== "exp") sunInc += Number(e.amount) || 0; });
    var sunWork = s.workSunDate === sun || sunInc > 0; /* v76e: Sunday = catch-up day, counts only if switched on for this Sunday or income is logged on it */
    var autoD = 1; if (dow !== 6) { autoD = 0; for (var q = t; q <= sun; q = addDays(q, 1)) { if (q.slice(0, 7) === m && (q !== sun || sunWork)) autoD++; } autoD = Math.max(1, autoD); } /* Mon-Sat left this week inside this month, today included (+ Sunday if working it); a partial last week only counts its own days */
    var dLeft = dTyped != null && dSet === t ? Math.max(1, dTyped) : autoD; void passed;
    var before = inc("w") - inc("d"), dailyAuto = weekGoal == null || dLeft == null ? null : (dow === 6 && !sunWork ? null : ceilC(Math.max(0, (weekGoal - before) / dLeft))), dayOv = s.dayOvDate === t ? goal(s.dayOv) : null, snap = s.daySnap && s.daySnap.date === t ? s.daySnap : null, daily = dayOv != null ? dayOv : snap ? snap.goal : dailyAuto; /* v76b: fixed for the day */
    var uberG = goal(s.uber), uberDaily = uberG == null || dLeft == null ? null : (uberG - (g("w", "uber") - g("d", "uber"))) / dLeft;
    var mBeforeToday = inc("m") - inc("d"), mdLeft = monthDaysLeft(t, function (d) { return d === sun && sunWork; }), monthRemBefore = monthGoal == null ? null : monthGoal - mBeforeToday, monthPace = monthRemBefore == null ? null : r2(Math.max(0, monthRemBefore) / mdLeft);
    return { wkS: wkS, sun: sun, sunWork: sunWork, sunInc: sunInc, dow: dow, weekRaw: weekRaw, wRound: wRound, autoD: autoD, mBeforeToday: mBeforeToday, mdLeft: mdLeft, monthRemBefore: monthRemBefore, monthPace: monthPace, weekRemBefore: weekGoal == null ? null : weekGoal - before, monthAuto: monthAuto, monthOv: monthOv, weekAuto: weekAuto, weekOv: weekOv, dailyAuto: dailyAuto, dayOv: dayOv, mLeft: mLeft, wLeft: wLeft, yBefore: inc("yb"), mBefore: inc("mb"), wBefore: before, t: t, wk0: wk0, g: g, inc: inc, weekGoal: weekGoal, dLeft: dLeft, daily: daily, snap: snap, dayGross: inc("d"), expD: g("d", "exp"),
      todayRem: sub(daily, inc("d")), weekTotal: inc("w"), weekRem: sub(weekGoal, inc("w")), expW: g("w", "exp"),
      monthGoal: monthGoal, monthTotal: inc("m"), expM: g("m", "exp"), monthRem: sub(monthGoal, inc("m")),
      yearGoal: yearGoal, yearTotal: inc("y"), expY: g("y", "exp"), yearRem: sub(yearGoal, inc("y")), uberG: uberG, uberDaily: uberDaily, uberRem: sub(uberG, g("w", "uber")) };
  }


  /* ---------- v75y: Adjustments = SET values (deterministic). ----------
     Per source D.adj[key] = { y, yThru, m, mThru, mMonth }. "YTD entered" SETS the source's total Jan 1 .. yThru (yesterday when applied);
     "Month to date" SETS this month's total 1st .. mThru. Nothing is ever added on top: each Apply REPLACES the earlier value.
     The adjustment amounts are worked out live from those set values minus the real entries in the same dates, so a past entry
     added later inside those dates does not double count. Entries after the "through" date (today's tape) add on top. */
  var ADJ = [["uber", "Uber", false], ["lyft", "Lyft", false], ["pcs", "PCS (rides)", false], ["pcs", "PCS tips", true], ["ofc", "Officiating", false], ["va", "VA", false], ["cash", "Cash", false], ["oth", "Other", false]];
  function akey(r) { return r[0] + (r[2] ? ":tip" : ""); }
  function inRow(e, r) { return e.line === r[0] && !!e.tip === !!r[2]; }
  function r2(n) { return Math.round(n * 100) / 100; }
  /* virtual adjustment entries for calc(); t = today */
  function derived(t) { var out = [], A = D.adj || {}, y = t.slice(0, 4), m = t.slice(0, 7), m1 = m + "-01", y1 = y + "-01-01";
    ADJ.forEach(function (r) { var s = A[akey(r)]; if (!s) return;
      var Y = s.y != null && String(s.yThru || "").slice(0, 4) === y ? Number(s.y) : null, M = s.m != null && s.mMonth === m && !s.migrated ? Number(s.m) : null; /* v76a: a migrated month set mixed old YEAR adjustments dated this month into October - ignore it (year total unchanged, since the year set still covers it) */ if (Y == null && M == null) return;
      var eY = 0, eM = 0; Object.keys(D.entries).forEach(function (k) { var e = D.entries[k], d = String(e.date || ""); if (e.type === "adjustment" || !inRow(e, r)) return; var a = Number(e.amount) || 0;
        if (Y != null && d.slice(0, 4) === y && d <= s.yThru) eY += a; if (M != null && d.slice(0, 7) === m && d <= s.mThru) eM += a; });
      var mAdj = M != null ? r2(M - eM) : 0, yAdj = Y != null ? r2(Y - eY - (M != null && m1 <= s.yThru ? mAdj : 0)) : 0;
      if (yAdj) out.push({ date: y1, line: r[0], amount: yAdj, tip: r[2] || undefined, type: "adjustment", scope: "y", virtual: true });
      if (mAdj) out.push({ date: m1, line: r[0], amount: mAdj, tip: r[2] || undefined, type: "adjustment", scope: "m", virtual: true });
      s._calc = { eY: r2(eY), eM: r2(eM), yAdj: yAdj, mAdj: mAdj }; });
    return out; }
  function ytdTotal(c, r) { return r[2] ? c.g("y", "tip:" + r[0]) : c.g("y", r[0]) - (r[0] === "pcs" ? c.g("y", "tip:pcs") : 0); }
  function mtd(c, r) { return r[2] ? c.g("m", "tip:" + r[0]) : c.g("m", r[0]) - (r[0] === "pcs" ? c.g("m", "tip:pcs") : 0); }
  /* one-time migration of the old added-on adjustment entries into set values that keep today's totals exactly */
  function migrate(t) { t = t || today(); if (D.adjV === "75y") return 0; D.adj = D.adj || {}; var yday = addDays(t, -1), y = t.slice(0, 4), m = t.slice(0, 7), log = {}, ch = 0;
    ADJ.forEach(function (r) { var ks = Object.keys(D.entries).filter(function (k) { var e = D.entries[k]; return e.type === "adjustment" && inRow(e, r); }); if (!ks.length) return;
      var Y = 0, M = 0, hasM = false, oldY = 0, oldM = 0;
      Object.keys(D.entries).forEach(function (k) { var e = D.entries[k], d = String(e.date || ""), a = Number(e.amount) || 0; if (!inRow(e, r) || d.slice(0, 4) !== y) return;
        if (e.type === "adjustment") { Y += a; if (d.slice(0, 7) === m && e.scope !== "y") { M += a; hasM = true; oldM += a; } else oldY += a; }
        else if (d <= yday) { Y += a; if (d.slice(0, 7) === m) M += a; } });
      D.adj[akey(r)] = { y: r2(Y), yThru: yday, m: hasM ? r2(M) : null, mThru: hasM ? yday : null, mMonth: hasM ? m : null, at: Date.now(), migrated: true };
      log[akey(r)] = { name: r[1], ytd: r2(Y), mtd: hasM ? r2(M) : null, oldYearAdj: r2(oldY), oldMonthAdj: r2(oldM), count: ks.length };
      ks.forEach(function (k) { delete D.entries[k]; }); ch++; });
    D.adjV = "75y"; if (ch) D.adjMig = { at: t, rows: log }; return ch || 1; }
  /* Apply: inputs [{y,m}] per ADJ row (blank = leave alone). Returns {ok, bad:[names]} ; nothing is applied if any row has month > year */
  function applySets(inputs, t) { t = t || today(); D.adj = D.adj || {}; var yday = addDays(t, -1), m = t.slice(0, 7), bad = [], n = 0;
    ADJ.forEach(function (r, i) { var o = inputs[i] || {}, s = D.adj[akey(r)] || {}; if (o.y == null && o.m == null) return;
      var Y = o.y != null ? o.y : (String(s.yThru || "").slice(0, 4) === t.slice(0, 4) ? s.y : null), M = o.m != null ? o.m : (s.mMonth === m ? s.m : null);
      if (Y != null && M != null && M > Y + 0.005) bad.push(r[1] + " (month " + $m(M, true) + " is more than year " + $m(Y, true) + ")"); });
    if (bad.length) return { ok: false, bad: bad };
    ADJ.forEach(function (r, i) { var o = inputs[i] || {}, k = akey(r), s = D.adj[k] = D.adj[k] || {};
      if (o.y != null) { s.y = r2(o.y); s.yThru = yday; n++; } if (o.m != null) { s.m = r2(o.m); s.mThru = yday; s.mMonth = m; n++; } if (n) { s.at = Date.now(); delete s.migrated; } });
    return { ok: true, n: n }; }
  function updYtd(c) { ADJ.forEach(function (r, i) { var el = document.getElementById("gl-adj-t" + i); if (el) el.value = $m(ytdTotal(c, r), true); }); }
  function fmtD(d) { return d ? Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10)) : ""; }
  /* v76b: every entry Mon..yesterday, so an extra past entry is easy to find */
  function WEEKCHK(c) { var ks = Object.keys(D.entries).filter(function (k) { var e = D.entries[k], d = String(e.date || ""); return e.type !== "adjustment" && e.line !== "exp" && d >= c.wkS && d < c.t; }).sort(function (a, b) { var x = D.entries[a], y = D.entries[b]; return x.date < y.date ? -1 : x.date > y.date ? 1 : (x.at || 0) - (y.at || 0); });
    var tot = 0, rows = ks.map(function (k) { var e = D.entries[k]; tot += Number(e.amount) || 0; return "<tr><td>" + esc(fmtD(e.date)) + "</td><td>" + esc(name(e.line)) + (e.tip ? " tip" : "") + '</td><td class="r">' + $m(Number(e.amount), true) + "</td><td>" + esc(e.source || "") + (e.at ? " \u00b7 added " + esc(new Date(e.at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })) : "") + "</td><td>" + esc(e.note || "") + '</td><td><button type="button" class="btn ghost" data-pastdel="' + esc(k) + '">Undo</button></td></tr>'; }).join("");
    return '<details class="card" id="gl-wk"><summary><b class="t">Week check</b> <span class="fine">every entry this week before today: ' + $m(tot, true) + "</span></summary>" + (rows ? '<table><tr class="fine"><th style="text-align:left">Date</th><th style="text-align:left">Source</th><th class="r">Amount</th><th style="text-align:left">Added</th><th style="text-align:left">Note</th><th></th></tr>' + rows + "</table>" : '<p class="fine">Nothing yet this week.</p>') + "</details>"; }
  function ADJHTML(c) { var open = paint.adjOpen ? " open" : "", A = D.adj || {}, m = c.t.slice(0, 7), yr = c.t.slice(0, 4);
    function inp(i, k, ph) { return '<td><input id="gl-adj-' + k + i + '" type="text" inputmode="decimal" autocomplete="off" placeholder="' + esc(ph || "") + '" style="width:110px;background:#fff;color:#000"></td>'; }
    var warn = ADJ.filter(function (r) { return mtd(c, r) > ytdTotal(c, r) + 0.005; }).map(function (r) { return r[1]; });
    var h = '<details class="card" id="gl-adj"' + open + '><summary><b class="t">Adjustments</b> <span class="fine">set your real to-date totals</span></summary>' +
      '<p class="fine">Type your real totals <b>through yesterday</b>. Each number you Apply <b>replaces</b> the one before it (it never adds on top). Blank = leave it as it is. Month to date has to be the same as or less than YTD. Today\u2019s entries add on top. YTD total (green) is everything this year.</p>' +
      (warn.length ? '<p class="err">Month is more than Year for: ' + esc(warn.join(", ")) + '. Check the list below and Undo the entry that does not belong.</p>' : "") +
      '<table><tr class="fine"><th style="text-align:left">Source</th><th>YTD entered</th><th>YTD total</th><th>Month to date</th></tr>' +
      ADJ.map(function (r, i) { var s = A[akey(r)] || {}; return "<tr><td>" + esc(r[1]) + "</td>" + inp(i, "y", s.y != null && String(s.yThru || "").slice(0, 4) === yr ? "set " + $m(s.y, true) : "") + '<td><input id="gl-adj-t' + i + '" type="text" readonly tabindex="-1" aria-label="YTD total" value="' + esc($m(ytdTotal(c, r), true)) + '" style="width:120px;background:#163a16;color:#7ee08f;border-color:#3fae5a;font-weight:800"></td>' + inp(i, "m", s.m != null && s.mMonth === m ? "set " + $m(s.m, true) : "") + "</tr>"; }).join("") + "</table>" +
      '<button class="btn" id="gl-b-adj" type="button">Apply adjustments</button> <span class="fine" id="gl-adj-msg"></span>';
    /* Adjustments list: every set value with its math, plus past entries, each with Undo */
    var rows = []; ADJ.forEach(function (r) { var k = akey(r), s = A[k], x = s && s._calc; if (!s || !x) return;
      if (s.y != null && String(s.yThru || "").slice(0, 4) === yr) rows.push('<tr class="b"><td>' + esc(r[1]) + '</td><td>Year to date through ' + fmtD(s.yThru) + '</td><td class="r">' + $m(s.y, true) + '</td><td class="fine">entries ' + $m(x.eY, true) + (x.mAdj && s.m != null ? " + month adj. " + $m(x.mAdj, true) : "") + " + adjustment " + $m(x.yAdj, true) + '</td><td class="r"><button class="btn ghost" data-setdel="' + esc(k) + '|y">Undo</button></td></tr>');
      if (s.m != null && s.mMonth === m) rows.push('<tr class="b"><td>' + esc(r[1]) + '</td><td>Month to date through ' + fmtD(s.mThru) + '</td><td class="r">' + $m(s.m, true) + '</td><td class="fine">entries ' + $m(x.eM, true) + " + adjustment " + $m(x.mAdj, true) + '</td><td class="r"><button class="btn ghost" data-setdel="' + esc(k) + '|m">Undo</button></td></tr>'); });
    var past = Object.keys(D.entries).filter(function (k) { var e = D.entries[k], d = String(e.date || ""); return e.type !== "adjustment" && d < c.t && d.slice(0, 4) === yr && (d.slice(0, 7) === m || e.source === "manual"); })
      .sort(function (a, b) { var x = D.entries[a], y = D.entries[b]; return x.date < y.date ? 1 : x.date > y.date ? -1 : (y.at || 0) - (x.at || 0); }).slice(0, 150);
    h += '<p style="margin-top:10px"><b class="t">Adjustments list</b></p>' + (rows.length ? '<table><tr class="fine"><th style="text-align:left">Source</th><th style="text-align:left">Set</th><th class="r">Amount</th><th style="text-align:left">How it adds up</th><th></th></tr>' + rows.join("") + "</table>" : '<p class="fine">Nothing set yet.</p>');
    h += '<p style="margin-top:10px"><b class="t">Past entries</b> <span class="fine">this month, and any typed in by hand this year</span></p>' + (past.length ? '<table><tr class="fine"><th style="text-align:left">Date</th><th style="text-align:left">Source</th><th class="r">Amount</th><th style="text-align:left">Note</th><th></th></tr>' + past.map(function (k) { var e = D.entries[k];
        return '<tr class="b"><td>' + esc(fmtD(e.date)) + "</td><td>" + esc(name(e.line).replace(/ \(.*\)/, "") + (e.tip ? " tip" : "")) + '</td><td class="r">' + $m(Number(e.amount) || 0, true) + '</td><td class="fine">' + esc(e.note || e.source || "") + '</td><td class="r"><button class="btn ghost" data-pastdel="' + esc(k) + '">Undo</button></td></tr>'; }).join("") + "</table>" : '<p class="fine">None.</p>');
    if (D.adjMig && D.adjMig.rows) { var mr = D.adjMig.rows; h += '<p class="fine" style="margin-top:10px"><b>Moved from the old adjustments on ' + esc(fmtD(D.adjMig.at)) + ' (totals unchanged):</b><br>' + Object.keys(mr).map(function (k) { var x = mr[k];
      return esc(x.name) + ": YTD set " + $m(x.ytd, true) + (x.mtd != null ? ", month to date set " + $m(x.mtd, true) : "") + " (old year adjustments " + $m(x.oldYearAdj, true) + ", old month adjustments " + $m(x.oldMonthAdj, true) + ", " + x.count + " entries)"; }).join("<br>") + "</p>"; }
    return h + "</details>"; }
  function bindAdj() { var d = document.getElementById("gl-adj"); if (!d) return; d.ontoggle = function () { paint.adjOpen = d.open; };
    document.getElementById("gl-b-adj").onclick = function () { var bad = false, any = false;
      var inputs = ADJ.map(function (r, i) { var o = {}; ["y", "m"].forEach(function (k) { var el = document.getElementById("gl-adj-" + k + i), raw = el.value.trim(); if (!raw) return; var v = num(raw); if (v == null || v < 0) bad = true; else { o[k] = v; any = true; } }); return o; });
      var msg = document.getElementById("gl-adj-msg"); if (bad) { msg.textContent = "Check the numbers."; return; } if (!any) { msg.textContent = "Type a number first."; return; }
      var res = applySets(inputs); if (!res.ok) { msg.innerHTML = '<span class="err">Not applied. Month to date has to be the same as or less than YTD: ' + esc(res.bad.join("; ")) + "</span>"; return; }
      paint.adjOpen = true; paint(); save(); var mm = document.getElementById("gl-adj-msg"); if (mm) mm.textContent = "Set. Earlier numbers for those boxes were replaced."; };
    Array.prototype.forEach.call(document.querySelectorAll("#gl-adj [data-setdel]"), function (b) { b.onclick = function () { var p = b.getAttribute("data-setdel").split("|"), s = (D.adj || {})[p[0]]; if (!s || !confirm("Undo this set total?")) return;
      if (p[1] === "y") { s.y = null; s.yThru = null; } else { s.m = null; s.mThru = null; s.mMonth = null; } paint.adjOpen = true; paint(); save(); }; });
    Array.prototype.forEach.call(document.querySelectorAll("#gl-adj [data-pastdel], #gl-wk [data-pastdel]"), function (b) { b.onclick = function () { if (confirm("Undo this past entry?")) { delete D.entries[b.getAttribute("data-pastdel")]; paint.adjOpen = true; paint(); save(); } }; });
  }


  /* ---------- UI ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $m(n, cents) { if (n == null || !isFinite(n)) return "\u2014"; var a = Math.abs(n).toLocaleString("en-US", cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }); return (n < 0 ? "-$" : "$") + a; }
  function left(n) { return n == null ? null : Math.max(0, n); }
  /* v76e: old 'Fuel & expenses' entries stay stored, are left out of every total, and are listed here so you can decide */
  function oldExp() { var n = 0, t = 0; Object.keys(D.entries).forEach(function (k) { var e = D.entries[k]; if (e.line === "exp" && e.type !== "adjustment") { n++; t += Math.abs(Number(e.amount) || 0); } }); return { n: n, total: Math.round(t * 100) / 100 }; }
  function oldExpNote() { var x = oldExp(); return x.n ? '<p class="fine">Old \u201cFuel &amp; expenses\u201d entries kept on file: ' + x.n + " (" + $m(x.total, true) + "). They stay out of every total. Say the word and they can move into Other as income.</p>" : ""; }
  function name(l) { var x = LINES.concat(EXP).filter(function (a) { return a[0] === l; })[0]; return x ? x[1] : l; }
  function big(l, v, extra) { return '<div class="big"><div class="fine">' + l + '</div><div class="v">' + v + "</div>" + (extra || "") + "</div>"; }
  function row(l, v, gap) { return "<tr><td>" + l + '</td><td class="r"><b>' + v + "</b></td><td class=\"r " + (gap == null ? "" : gap >= 0 ? "pos" : "neg") + '">' + (gap == null ? "" : $m(gap)) + "</td></tr>"; }
  /* v75z: every number behind today's goal, in plain words */
  function howToday(c) { if (c.snap && c.dayOv == null) { var sn = c.snap; return '<p class="fine" id="gl-how"><b>How today\u2019s goal was figured</b> (' + (sn.recalc ? "recalculated" : "fixed this morning") + '): weekly ' + $m(sn.weekly, true) + " \u2212 week income before today " + $m(sn.weekBeforeToday, true) + " = " + $m(Math.max(0, sn.weekly - sn.weekBeforeToday), true) + " \u00f7 " + sn.daysLeft + " days left = today " + $m(sn.goal, true) + "." + (Math.abs(c.wBefore - sn.weekBeforeToday) >= 0.01 ? " Week income before today has changed to " + $m(c.wBefore, true) + " since then (an earlier day was edited); tap Recalculate today to use it." : "") + "</p>" + (sn.recalc ? howAll(c) : (c.monthGoal != null && c.mBefore > c.monthGoal ? howAll(c).replace(/^[\s\S]*?<\/p>/, "") : "")); } return howAll(c); }
  function howAll(c) { var mg = c.monthGoal, h = '<p class="fine" id="gl-how"><b>How today\u2019s goal was figured:</b> ';
    h += "Monthly goal " + $m(mg) + (c.monthOv != null ? " (you typed it)" : " (auto)") + " \u2212 October income before this week " + $m(c.mBefore) + " = " + $m(mg == null ? null : Math.max(0, mg - c.mBefore)) + " \u00f7 " + c.wLeft + " weeks left = " + $m(c.weekRaw, true) + (c.wRound ? ", rounded up to " + $m(c.weekAuto) : "") + " = weekly (auto)";
    if (c.weekOv != null) h += "; you typed weekly " + $m(c.weekOv) + ", so that is used";
    h += ". Weekly " + $m(c.weekGoal) + " \u2212 week income before today " + $m(c.wBefore, true) + " = " + $m(c.weekGoal == null ? null : Math.max(0, c.weekGoal - c.wBefore), true) + " \u00f7 " + (c.dLeft == null ? "?" : c.dLeft) + " days left = today " + $m(c.dailyAuto, true) + (c.dayOv != null ? "; you typed today " + $m(c.dayOv, true) + ", so that is used" : "") + ".</p>";
    if (mg != null && c.mBefore > mg) h += '<p class="err">October income before this week (' + $m(c.mBefore) + ') is already more than the monthly goal, so the weekly auto shows $0. If that number looks too big, open Adjustments and check the list for an entry counted twice.</p>';
    return h; }
  function paint() {
    if (snapToday()) save(); /* first open after midnight, or once goals are set */
    var c = calc(), s = D.settings, h = "";
    h += '<div id="gl-top">' + topHtml(c) + '</div>';
    function f(id, l, v) { return '<label><span class="fine">' + l + '</span><input id="' + id + '" type="text" ' + (id === "gl-s-days" ? 'inputmode="numeric" pattern="[0-9]*"' : 'inputmode="decimal"') + ' autocomplete="off" value="' + esc(v == null ? "" : v) + '" style="width:130px"></label>'; }
    function o(id, l, v, tag) { return '<div class="gl-ov" style="display:inline-block;margin:4px 8px 4px 0;position:relative;z-index:2"><span class="fine" style="display:block">' + l + ' <b id="' + tag + '" style="color:var(--lite)"></b></span><input id="' + id + '" class="gl-ovin" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="auto" aria-label="' + esc(l) + ' (blank = auto)" value="' + esc(v == null ? "" : v) + '" style="width:130px"></div>'; }
    h += '<form class="card" id="gl-f-set"><b class="t">Goals</b><br>' + f("gl-s-year", "Year goal $", s.year) + o("gl-s-month", "Monthly goal $", s.monthOv, "gl-t-month") + o("gl-s-week", "Weekly goal $", s.weekOv, "gl-t-week") + o("gl-s-day", "Set today\u2019s goal $ (today only)", s.dayOvDate === c.t ? s.dayOv : null, "gl-t-day") + f("gl-s-days", "Days left in week", c.dLeft) + f("gl-s-wround", "Round weekly up to $ (e.g. 100)", s.weekRound) + '<div style="display:inline-block;margin:6px 10px 6px 0"><span class="fine" style="display:block">Work days: Mon\u2013Sat</span><label style="font-size:18px"><input type="checkbox" id="gl-s-sun"' + (s.workSunDate === c.sun ? " checked" : "") + ' style="width:26px;height:26px;vertical-align:middle"> Working this Sunday (' + esc(fmtD(c.sun)) + ")</label></div>" + f("gl-s-uber", "Uber week goal $", s.uber) +
      '<p class="fine">Leave Monthly / Weekly / Today blank for <b>auto</b>; type a number to override, clear it to go back to auto.</p><p class="fine" id="gl-formula"></p>' +
      '<br><button class="btn" type="submit">Save goals</button> <span class="fine" id="gl-set-msg">Saves automatically as you type.</span></form>';
    h += WEEKCHK(c);
    h += ADJHTML(c);
    h += REST(c);
    app.innerHTML = h; bind(); bindAdj(); updGoalTags(c); numPad(app);
    var qa = document.getElementById("gl-q-amt"); if (qa && paint.focusQ) { qa.focus(); paint.focusQ = false; }
  }
  /* v75l: everything above the Goals form; re-rendered on each goal keystroke without touching the Goals inputs (keeps the keyboard up) */
  function paintTop() { var top = document.getElementById("gl-top"); if (!top || !D) return; if (snapToday()) save(); var c = calc(); top.innerHTML = topHtml(c); bindTop(); numPad(top); updGoalTags(c); updYtd(c); }
  function updGoalTags(c) { function t(id, ov, auto, cents) { var el = document.getElementById(id); if (el) el.textContent = ov != null ? "override (auto " + $m(auto, cents) + ")" : "auto " + $m(auto, cents); }
    t("gl-t-month", c.monthOv, c.monthAuto); t("gl-t-week", c.weekOv, c.weekAuto); t("gl-t-day", c.dayOv, c.dailyAuto, true);
    var f = document.getElementById("gl-formula"); if (f) f.innerHTML = "Monthly = (year goal \u2212 year income before this month " + $m(c.yBefore) + ") \u00f7 " + c.mLeft + " months left \u00b7 Weekly = (monthly \u2212 month income before this week " + $m(c.mBefore) + ") \u00f7 " + c.wLeft + " weeks left \u00b7 Today = (weekly \u2212 week income before today " + $m(c.wBefore, true) + ") \u00f7 days left. Adjustments count as income."; }
  /* v76e: Saturday shows what Sunday would need; Sunday shows off unless working it */
  function sunLine(c) { var wr = c.weekRem;
    if (c.dow === 5 && wr != null && wr > 0.005) return '<p style="font-size:20px;font-weight:800;color:#ffd27a;margin:10px 0 4px">Sunday catch-up needed: ' + $m(wr, true) + "</p>";
    if (c.dow === 6 && !c.sunWork) return '<p class="fine" style="font-size:16px;margin:10px 0 4px">Sunday is your catch-up day' + (wr != null && wr > 0.005 ? " (week remaining " + $m(wr, true) + ")" : " and the week goal is met") + '. Turn on \u201cWorking this Sunday\u201d or log a ride to set today\u2019s goal.</p>';
    return ""; }
  function topHtml(c) {
    var g = c.g, h = "";
    h += '<div class="row" style="justify-content:space-between"><h1>Monthly Goal</h1><button class="btn ghost" id="gl-b-lock">Lock</button></div>';
    h += '<div class="fine" id="gl-ver" style="text-align:right;opacity:.7">goal v76e</div>';
    var roll = '<div class="fine">' + (c.dayOv != null ? "you set it for today" : c.snap ? "fixed for today" : "") + '</div>', tr = c.todayRem;
    h += '<div class="card hero"><b class="t">TODAY \u00b7 ' + esc(c.t) + '</b><div class="grid">' + big("Weekly goal", $m(c.weekGoal)) + big("Days left in week", c.dLeft == null ? "\u2014" : String(c.dLeft), '<div class="fine">counts down daily</div>') +
      big("Today's goal", $m(c.daily, true), roll + '<button type="button" class="btn" id="gl-b-recalc" style="font-size:20px;padding:12px 22px;margin-top:6px">Recalculate today</button>') + big("Today remaining", tr != null && tr < 0 ? "ahead by " + $m(-tr, true) : $m(tr, true)) + big("Week remaining", $m(left(c.weekRem), true), '<div class="fine">before today ' + $m(c.weekRemBefore, true) + '</div>') + big("Month remaining", $m(left(c.monthRem), true), '<div class="fine">before today ' + $m(c.monthRemBefore, true) + '</div>') + big("Month daily pace", $m(c.monthPace, true), '<div class="fine">' + c.mdLeft + ' days, ' + (c.sunWork ? "6 a week + this Sunday" : "6 a week") + '</div>') +
      '</div>' + sunLine(c) + howToday(c) + '</div>';
    var ids = Object.keys(D.entries).filter(function (k) { return D.entries[k].date === c.t && D.entries[k].line !== "exp"; }).sort(function (a, b) { return (D.entries[a].at || 0) - (D.entries[b].at || 0); });
    var run = 0, tape = ids.map(function (k) { var e = D.entries[k]; run += Number(e.amount) || 0; var rem = c.daily == null ? null : c.daily - run;
      return '<tr class="b"><td style="text-align:left">' + esc(name(e.line).replace(/ \(.*\)/, "") + (e.line === "exp" ? "" : e.tip ? " tip" : " ride")) + '</td><td class="r">+' + $m(e.amount, true) + '</td><td class="r pos">' + $m(run, true) + '</td><td class="r" style="color:' + (rem != null && rem <= 0 ? "var(--lite)" : "var(--goldt)") + '">' + (rem != null && rem < 0 ? "ahead by " + $m(-rem, true) : $m(rem, true)) + '</td><td class="r"><button class="btn ghost" data-del="' + esc(k) + '">Undo</button></td></tr>'; }).reverse().join("");
    h += '<div class="card day"><div class="fine">DAILY TOTAL</div><div class="total">' + $m(c.dayGross, true) + '</div>' +
      '<form id="gl-f-q" class="row"><input id="gl-q-amt" type="text" inputmode="decimal" autocomplete="off" placeholder="Ride 0.00" aria-label="Ride amount"><input id="gl-q-tip" type="text" inputmode="decimal" autocomplete="off" placeholder="Tip" aria-label="Tip (optional)" style="font-size:28px;width:120px;text-align:right"><select id="gl-q-line" aria-label="Source">' +
      LINES.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === D.lastLine ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + '</select><button class="btn" type="submit" style="font-size:20px;padding:10px 26px">Add</button></form>' +
      (tape ? '<table style="margin-top:8px"><tr class="fine"><th style="text-align:left">Source</th><th class="r">Amount</th><th class="r">Daily total</th><th class="r">Goal left</th><th></th></tr>' + tape + "</table>" : "") +
      "</div>";
    h += '<div class="card"><b class="t">Week</b><table>' + row("WEEKLY GOAL", $m(c.weekGoal)) + row("<b>Left for the week</b>", $m(left(c.weekRem))) + row("WEEK TOTAL", $m(c.weekTotal)) +
      row("UBER GOAL", $m(c.uberG)) + row("UBER WEEK TOTAL", $m(g("w", "uber"))) + row("UBER REMAINING", $m(left(c.uberRem))) + row("UBER TODAY'S GOAL", $m(left(c.uberDaily), true)) + "</table></div>";
    h += '<div class="card"><b class="t">Month &amp; year</b><table>' + row("MONTHLY GOAL", $m(c.monthGoal)) + row("MONTHLY TOTAL", $m(c.monthTotal)) + row("MONTHLY REMAINING", $m(left(c.monthRem))) +
      row("YEAR GOAL", $m(c.yearGoal)) + row("YEAR TOTAL", $m(c.yearTotal)) + row("YEAR REMAINING", $m(left(c.yearRem))) + "</table></div>";
    h += '<div class="card"><b class="t">Income lines</b><table><tr><th></th><th class="r" style="color:var(--goldt)">Today</th><th class="r" style="color:var(--goldt)">Week</th><th class="r" style="color:var(--goldt)">Month</th><th class="r" style="color:var(--goldt)">Year</th></tr>' + LINES.map(function (l) { var k = "tip:" + l[0], tr = g("y", k) ? '<tr class="fine"><td>\u21b3 of which tips</td><td class="r">' + $m(g("d", k)) + '</td><td class="r">' + $m(g("w", k)) + '</td><td class="r">' + $m(g("m", k)) + '</td><td class="r">' + $m(g("y", k)) + "</td></tr>" : "";
      return "<tr><td>" + l[1] + '</td><td class="r">' + $m(g("d", l[0])) + '</td><td class="r">' + $m(g("w", l[0])) + '</td><td class="r">' + $m(g("m", l[0])) + '</td><td class="r">' + $m(g("y", l[0])) + "</td></tr>" + tr; }).join("") +
      '<tr class="b"><td><b>TOTAL income</b></td><td class="r"><b>' + $m(c.dayGross) + '</b></td><td class="r"><b>' + $m(c.weekTotal) + '</b></td><td class="r"><b>' + $m(c.monthTotal) + '</b></td><td class="r"><b>' + $m(c.yearTotal) + "</b></td></tr></table>" + oldExpNote() + "</div>";
    return h;
  }
  function REST(c) { var h = "";
    h += '<form class="card" id="gl-f-add"><b class="t">Add past entry</b><br><input id="gl-a-date" type="date" value="' + esc(c.t) + '"> <select id="gl-a-line">' + LINES.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + "</option>"; }).join("") + '</select> <input id="gl-a-amt" type="text" inputmode="decimal" autocomplete="off" placeholder="Amount" style="width:120px"> <label style="display:inline"><input type="checkbox" id="gl-a-tip"> tip</label> <input id="gl-a-note" placeholder="Note" style="width:150px"> <button class="btn" type="submit">Add</button></form>';
    h += '<div class="card"><b class="t">Backup &amp; import</b><p class="fine">Everything stays on this device, encrypted. Export a backup regularly.</p><div class="row" style="justify-content:flex-start">' +
      '<button class="btn ghost" id="gl-b-exp">Export encrypted backup</button><button class="btn ghost" id="gl-b-csv">Export CSV (not encrypted)</button>' +
      '<label class="btn ghost">Import CSV / seed / backup<input type="file" id="gl-b-imp" accept=".csv,.json,text/csv,application/json" hidden></label></div><p class="fine" id="gl-imp-msg"></p>' +
      '<p class="fine">CSV format: Date,Category,Service,Amount,Notes (Service uber/lyft; Category Other = PCS, Tips = Cash (or a tip on the Service named), Bonus = Uber, Officiating, VA, Other income). ' + Object.keys(D.entries).length + " entries stored.</p></div>";
    return h;
  }
  function num(v) { var n = Number(String(v == null ? "" : v).replace(/[$,\s]/g, "")); return String(v).trim() !== "" && isFinite(n) ? n : null; }
  function newId(at) { return String(at) + "-" + Math.random().toString(36).slice(2, 7); }
  /* v75l: read the Goals form into settings. Days left is only re-stamped when its box actually changed,
     so the typed value counts for today and then counts down one per day. */
  var setTimer = null;
  function readGoals() { var s = D.settings;
    [["gl-s-week", "weekOv"], ["gl-s-uber", "uber"], ["gl-s-month", "monthOv"], ["gl-s-year", "year"], ["gl-s-wround", "weekRound"]].forEach(function (p) { var el = document.getElementById(p[0]); if (el) s[p[1]] = num(el.value); });
    var sk = document.getElementById("gl-s-sun"); if (sk) { var su = calc().sun; if (sk.checked) s.workSunDate = su; else if (s.workSunDate === su) s.workSunDate = null; }
    var dy = document.getElementById("gl-s-day"); if (dy) { s.dayOv = num(dy.value); s.dayOvDate = s.dayOv == null ? null : today(); }
    var de = document.getElementById("gl-s-days"); if (de) { var d = num(de.value); var cc = calc(); if (d == null || d === cc.autoD) { s.daysLeft = null; s.daysLeftSet = null; } else if (d !== cc.dLeft) { s.daysLeft = d; s.daysLeftSet = today(); } } }
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
    var rc = document.getElementById("gl-b-recalc"); if (rc) rc.onclick = function () { if (!confirm("Recalculate today\u2019s goal from the numbers right now?")) return; snapToday(true); paint(); save(); };
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
  var OUT = { uber: ["", "uber"], lyft: ["", "lyft"], pcs: ["Other", ""], cash: ["Tips", ""], ofc: ["Officiating", ""], va: ["VA", ""], oth: ["Other income", ""], exp: ["Expense", ""] };
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv() { return "Date,Category,Service,Amount,Notes\n" + Object.keys(D.entries).map(function (k) { return D.entries[k]; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || 0) - (b.at || 0); })
      .map(function (e) { var o = e.tip ? ["Tips", e.line] : (OUT[e.line] || ["", e.line]); return [e.date, o[0], o[1], Number(e.amount).toFixed(2), e.note].map(csvCell).join(","); }).join("\n") + "\n"; }
  function parseCsv(t) { var rows = [], r = [], f = "", q = false; for (var i = 0; i < t.length; i++) { var ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { r.push(f); f = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; r.push(f); rows.push(r); r = []; f = ""; } else f += ch; }
    if (f || r.length) { r.push(f); rows.push(r); } return rows.filter(function (x) { return x.join("").trim(); }); }
  function mapLine(cat, svc, note) { cat = String(cat || "").trim().toLowerCase(); svc = String(svc || "").trim().toLowerCase();
    if (svc === "uber" || svc === "lyft") return svc; if (cat === "tips" && /^(pcs|ofc|va|cash)$/.test(svc)) return svc; if (cat === "other income") return "oth"; if (cat === "other" || cat === "pcs") return "pcs"; if (cat === "tips" || cat === "cash") return "cash";
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
    document.getElementById("gl-close").onclick = glClose; kpWire(ov);
    lastAct = Date.now();
    idb().then(function () { lockNow(); }).catch(function () { app.innerHTML = '<p class="err">This browser cannot store the ledger (private browsing?).</p>'; });
  }
  function glClose() { kpClose(); kpEl = null; dek = null; D = null; app = null; var ov = document.getElementById("gl-screen"); if (ov) ov.remove(); }
  if (typeof module !== "undefined" && module.exports) module.exports = { migrate: migrate, applySets: applySets, derived: derived, mtd: mtd, _set: function (d) { D = d; }, calc: calc, ytdTotal: ytdTotal, ADJ: ADJ, weeksLeft: weeksLeft, numPad: numPad, kpPress: kpPress, glOpen: glOpen };
  window.__pcsGoalOpen = glOpen; window.__pcsGoalClose = glClose;
  document.addEventListener("click", function (e) { var t = e.target.closest ? e.target.closest("[data-god-menu=goal]") : null; if (t) { e.stopPropagation(); glOpen(); } }, true);
})();
