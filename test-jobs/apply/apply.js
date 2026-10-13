/* PCS driver application (staged). Live camera only: photos come from getUserMedia -> canvas -> JPEG. There is no file input. */
(function () {
  "use strict";
  var API = String(window.PCS_APPLY_API || "").replace(/\/+$/, "");
  var KEY = "pcs-apply-v1";
  var PHOTOS = [
    null,
    { t: "Limousine license", tip: "Lay your city limo or chauffeur license flat in good light. Fill the frame; the number and expiration date must be readable.", doc: "limo" },
    { t: "Driver's license", tip: "Front of your driver's license, flat, no glare. Number and expiration date must be readable.", doc: "dl" },
    { t: "Headshot (passport-style)", tip: "Face the camera, plain background, no hat or sunglasses, shoulders up.", front: true },
    { t: "Front of the vehicle", tip: "Stand about 10 feet back so the whole front and the plate are in the photo." },
    { t: "Driver side of the vehicle", tip: "Whole driver side, bumper to bumper." },
    { t: "Rear of the vehicle", tip: "Whole rear with the license plate readable." },
    { t: "Passenger side of the vehicle", tip: "Whole passenger side, bumper to bumper." },
    { t: "Driver seat", tip: "Driver door open. Stand outside and photograph the driver seat area looking in." },
    { t: "Front passenger seat", tip: "Front passenger door open. Stand outside and photograph the seat looking in." },
    { t: "Driver-side rear seat", tip: "Rear door behind the driver open. Photograph the rear seat from outside." },
    { t: "Passenger-side rear seat", tip: "Rear door on the passenger side open. Photograph the rear seat from outside." },
    { t: "Third row", tip: "Fold the middle row forward and photograph the third row from outside. No third row? Tap N/A.", na: true },
    { t: "Cargo area", tip: "Open the hatch or trunk. If you have a third row, fold it down first. Photograph the full cargo space." },
    { t: "Commercial liability insurance", tip: "Your commercial auto Certificate of Liability Insurance (ACORD 25) or declarations page, flat and readable: policy number, dates, limits and any Additional Insured line must show.", doc: "ins" }
  ];
  var DOCS = { limo: "Limousine license", dl: "Driver's license", ins: "Commercial liability insurance" };
  var DOCPHOTO = { limo: 1, dl: 2, ins: 14 };
  var STEPS = ["Start", "About you", "Criminal history", "Licenses & insurance", "Document photos", "Vehicle & photos", "Work history", "Policies & signature", "Review & submit", "Submitted"];

  var S = load();
  var CFG = { leatherRequired: true }; /* God-mode setting, loaded from the Worker at start */
  /* invite-only: ?i=<token> from Matthew's text/email; remembered on this phone so the applicant can resume */
  (function () { var q = new URLSearchParams(location.search).get("i"); if (q) { if (S.inv && S.inv !== q) { var keep = q; S = blank(); S.inv = keep; } else S.inv = q; save(); try { history.replaceState(null, "", location.pathname); } catch (e) {} } })();
  var blobs = {}; /* slot -> object URL (from IndexedDB) */
  var app = document.getElementById("app");

  function blank() { return { step: 0, gate: {}, personal: { state: "TX" }, elig: {}, docs: { limo: {}, dl: { state: "TX" }, ins: {} }, vehicle: {}, work: { jobs: [{}] }, photos: {}, agree: {}, appId: "", submitted: false }; }
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.personal) { s.gate = s.gate || {}; return s; } } catch (e) {} return blank(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function ageOn(dob, t) { var a = dob.split("-").map(Number), b = t.split("-").map(Number); return b[0] - a[0] - (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2]) ? 1 : 0); }
  function get(path) { return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, S); }
  function set(path, v) { var ks = path.split("."), o = S; for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; save(); }
  function fmtDate(s) { if (!s) return ""; var p = s.split("-"); return p.length === 3 ? p[1] + "/" + p[2] + "/" + p[0] : p[1] + "/" + p[0]; }

  /* ---------- IndexedDB photo store (local draft only) ---------- */
  var dbp = null;
  function db() { if (!dbp) dbp = new Promise(function (res, rej) { var r = indexedDB.open("pcs-apply", 1); r.onupgradeneeded = function () { r.result.createObjectStore("p"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return dbp; }
  function idb(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var tx = d.transaction("p", mode), st = tx.objectStore("p"), q = fn(st); tx.oncomplete = function () { res(q && q.result); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function putBlob(slot, b) { return idb("readwrite", function (st) { return st.put(b, String(slot)); }); }
  function getBlob(slot) { return idb("readonly", function (st) { return st.get(String(slot)); }); }
  function delBlob(slot) { return idb("readwrite", function (st) { return st.delete(String(slot)); }); }
  function loadThumbs() { var ps = []; for (var i = 1; i <= 14; i++) (function (i) { if (S.photos[i] && S.photos[i] !== "na") ps.push(getBlob(i).then(function (b) { if (b) blobs[i] = URL.createObjectURL(b); else S.photos[i] = null; })); })(i); return Promise.all(ps).then(save); }

  /* ---------- modal ---------- */
  function modal(title, html, buttons, info) {
    var m = document.getElementById("modal");
    m.innerHTML = '<div class="box' + (info ? " info" : "") + '" role="alertdialog" aria-modal="true"><h3>' + esc(title) + "</h3>" + html + '<div class="nav" id="mbtns"></div></div>';
    var bar = m.querySelector("#mbtns");
    (buttons || [{ t: "OK" }]).forEach(function (b) { var x = document.createElement("button"); x.className = "btn" + (b.ghost ? " ghost" : ""); x.textContent = b.t; x.onclick = function () { m.hidden = true; if (b.fn) b.fn(); }; bar.appendChild(x); });
    m.hidden = false; bar.firstChild.focus();
  }

  /* ---------- live camera ---------- */
  var cam = { stream: null, slot: 0, facing: "environment" };
  function openCam(slot) {
    var p = PHOTOS[slot]; cam.slot = slot; cam.facing = p.front ? "user" : "environment";
    document.getElementById("camtitle").textContent = slot + ". " + p.t;
    document.getElementById("camtip").textContent = p.tip;
    document.getElementById("cam").hidden = false;
    startStream();
  }
  function startStream() {
    stopStream();
    var err = document.getElementById("camerr"); err.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camErr("This browser can't open the camera. Open this page in Safari (iPhone) or Chrome (Android)."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cam.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false }).then(function (st) {
      cam.stream = st; var v = document.getElementById("camvideo"); v.srcObject = st; v.play().catch(function () {});
    }).catch(function () { camErr("Camera access was blocked. Allow camera access for this site (iPhone: Settings > Safari > Camera > Allow), then try again. Photos must be taken live; uploads aren't accepted."); });
  }
  function camErr(t) { var e = document.getElementById("camerr"); e.textContent = t; e.hidden = false; }
  function stopStream() { if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); }); cam.stream = null; }
  function closeCam() { stopStream(); document.getElementById("cam").hidden = true; }
  document.getElementById("camcancel").onclick = closeCam;
  document.getElementById("camflip").onclick = function () { cam.facing = cam.facing === "user" ? "environment" : "user"; startStream(); };
  document.getElementById("camsnap").onclick = function () {
    var v = document.getElementById("camvideo");
    if (!cam.stream || !v.videoWidth) return;
    var w = v.videoWidth, h = v.videoHeight, k = Math.min(1, 1600 / Math.max(w, h));
    var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    var slot = cam.slot;
    c.toBlob(function (b) {
      putBlob(slot, b).then(function () {
        if (blobs[slot]) URL.revokeObjectURL(blobs[slot]);
        blobs[slot] = URL.createObjectURL(b);
        S.photos[slot] = { at: Date.now() }; save(); closeCam(); render();
      });
    }, "image/jpeg", 0.82);
  };

  /* ---------- field helpers ---------- */
  function inp(path, label, o) {
    o = o || {}; var v = get(path); v = v == null ? "" : v;
    return "<label for='f_" + path + "'>" + esc(label) + "</label><input id='f_" + path + "' data-p='" + path + "' value='" + esc(v) + "'" +
      " type='" + (o.type || "text") + "'" + (o.im ? " inputmode='" + o.im + "'" : "") + (o.ac ? " autocomplete='" + o.ac + "'" : "") +
      (o.max ? " maxlength='" + o.max + "'" : "") + (o.ph ? " placeholder='" + esc(o.ph) + "'" : "") + (o.pat ? " pattern='" + o.pat + "'" : "") + (o.cap ? " autocapitalize='characters'" : "") + ">";
  }
  function yn(path, q) {
    var v = get(path);
    return "<label>" + esc(q) + "</label><div class='yn'><button type='button' class='btn ghost" + (v === "yes" ? " sel" : "") + "' data-yn='" + path + "' data-v='yes'>Yes</button><button type='button' class='btn ghost" + (v === "no" ? " sel" : "") + "' data-yn='" + path + "' data-v='no'>No</button></div>";
  }
  function chk(path, text) { return "<label class='check'><input type='checkbox' data-c='" + path + "'" + (get(path) ? " checked" : "") + "><span>" + text + "</span></label>"; }
  function nav(nextLabel, noBack) { return "<div class='err' id='err'></div><div class='nav'>" + (noBack ? "" : "<button type='button' class='btn ghost' id='back'>Back</button>") + "<button type='button' class='btn' id='next'>" + (nextLabel || "Next") + "</button></div>"; }
  function showErr(list) { var e = document.getElementById("err"); e.innerHTML = list.map(esc).join("<br>"); if (list.length) e.scrollIntoView({ block: "center" }); return !list.length; }

  /* ---------- expired document rule ---------- */
  function expiredPopup(k) {
    var name = DOCS[k];
    S.docs[k].expiredSeen = S.docs[k].expiredSeen || today(); /* remembered + sent so Matthew sees it was entered expired */
    save();
    modal(name + " is expired",
      "<p>The expiration date you entered for your <b>" + esc(name.toLowerCase()) + "</b> has already passed.</p>" +
      "<p>You can't go any further with this application until your " + esc(name.toLowerCase()) + " is active. If you've renewed it, enter the <b>new expiration date</b> and take a <b>new live photo of the renewed " + (k === "ins" ? "certificate" : "license") + "</b>.</p>" +
      "<p class='muted'>Your progress is saved on this phone, so you can come back once it's renewed.</p>", [{ t: "OK, I understand" }]);
  }
  function docExpChanged(k, v) {
    if (v && v < today()) { expiredPopup(k); return; }
    /* a renewed date after an expired one: the old photo shows the expired document, so it must be retaken */
    if (v && S.docs[k].expiredSeen && !S.docs[k].renewedAt) {
      S.docs[k].renewedAt = Date.now(); var slot = DOCPHOTO[k];
      if (S.photos[slot] && S.photos[slot].at < S.docs[k].renewedAt) { S.photos[slot] = null; delBlob(slot); if (blobs[slot]) { URL.revokeObjectURL(blobs[slot]); delete blobs[slot]; } }
      save();
      modal("Retake the photo", "<p>Thanks. Since your " + esc(DOCS[k].toLowerCase()) + " was renewed, you'll be asked to take a new live photo of the renewed " + (k === "ins" ? "certificate" : "license") + " on the photos step.</p>", [{ t: "OK" }], true);
    }
  }

  /* ---------- work history coverage (last 5 years) ---------- */
  function mi(s) { var p = s.split("-").map(Number); return p[0] * 12 + p[1] - 1; }
  function mname(i) { return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i % 12] + " " + Math.floor(i / 12); }
  function coverage() {
    var end = mi(today().slice(0, 7)), start = end - 60;
    var iv = S.work.jobs.filter(function (j) { return j.start; }).map(function (j) { return [mi(j.start), j.current ? end : (j.end ? mi(j.end) : -1)]; }).filter(function (x) { return x[1] >= x[0]; }).sort(function (a, b) { return a[0] - b[0]; });
    var gaps = [], cur = start;
    iv.forEach(function (x) { if (x[0] > cur + 1) gaps.push([cur, x[0]]); cur = Math.max(cur, x[1]); });
    if (cur < end - 1) gaps.push([cur, end]);
    return { gaps: gaps.filter(function (g) { return g[1] - g[0] - 1 > 0; }).map(function (g) { return { from: mname(g[0] + 1), to: mname(g[1] - 1), months: g[1] - g[0] - 1 }; }), any: iv.length > 0 };
  }

  /* ---------- steps ---------- */
  var R = {}, V = {};
  function minYear() { return new Date().getFullYear() - 10; }
  function gateHtml() {
    var G = S.gate, h = "<div class='card'><h3>First, a few quick questions</h3>" + yn("gate.txdl", "Do you have a valid Texas driver's license?") +
      yn("gate.limo", "Do you have a limo/chauffeur license?");
    if (G.limo === "no") h += yn("gate.limoObtain", "Can you obtain a limo license before being hired?");
    h += yn("gate.vehicle", "Do you have a four-door luxury vehicle that is 10 years old or newer (model year " + minYear() + " or newer)?");
    if (G.vehicle === "yes") h += yn("gate.leather", "Does it have leather interior?");
    if (G.vehicle === "yes") h += inp("vehicle.year", "Vehicle year", { im: "numeric", max: 4, pat: "[0-9]*", ph: "e.g. 2021" }) + inp("vehicle.make", "Make", { ph: "e.g. Lincoln" }) + inp("vehicle.model", "Model", { ph: "e.g. Navigator" });
    return h + "</div>";
  }
  function endPolite(why) {
    modal("Thank you for your interest", "<p>Thank you for taking the time to apply with Private Car Services.</p><p>" + why + " Once you have it, we'd be glad to hear from you again.</p><p class='muted'>Questions? Visit www.PCSrides.com or call 936-261-7878.</p>", [{ t: "OK" }], true);
    return false;
  }
  V[0] = function () {
    var G = S.gate, v = S.vehicle, e = [];
    if (!G.txdl || !G.limo || (G.limo === "no" && !G.limoObtain) || !G.vehicle || (G.vehicle === "yes" && !G.leather)) return showErr(["Please answer each question above."]);
    if (G.txdl === "no") return endPolite("A valid Texas driver's license is required to drive for PCS.");
    if (G.limo === "no" && G.limoObtain === "no") return endPolite("A limo/chauffeur license is required before a driver can be hired.");
    if (G.vehicle === "no") return endPolite("PCS drivers need a four-door luxury vehicle that is 10 years old or newer (model year " + minYear() + " or newer).");
    if (G.leather === "no" && CFG.leatherRequired) return endPolite("PCS drivers need a vehicle with leather interior.");
    ["year", "make", "model"].forEach(function (k) { if (!String(v[k] || "").trim()) e.push("Vehicle: enter the " + k + "."); });
    if (e.length) return showErr(e);
    var y = Number(v.year);
    if (!(y >= minYear() && y <= minYear() + 12)) return endPolite("PCS drivers need a vehicle that is model year " + minYear() + " or newer.");
    S.docs.limo.has = G.limo === "yes" ? "yes" : "no";
    G.year = String(v.year); G.make = String(v.make).trim(); G.model = String(v.model).trim(); G.passed = true; G.passedAt = Date.now(); save();
    return showErr([]);
  };
  R[0] = function () {
    if (!S.gate.passed) return "<h2>Drive with Private Car Services</h2><p class='muted'>Quick pre-screen: answer these first. The full application opens after.</p>" + gateHtml() + nav("Continue", true);
    return "<h2>Drive with Private Car Services</h2><div class='card'><p>Thanks for your interest in driving with PCS. This takes about 20 minutes. Your progress is saved on this phone as you go.</p>" +
      "<h3>You'll need</h3><ul class='req'><li>Your city limo or chauffeur license (Houston, Dallas, Austin, San Antonio, etc.), unless you'll obtain it before you're hired</li><li>Your driver's license</li><li>Your commercial auto insurance certificate (ACORD 25), if you have one. It's optional to apply, but required (30/60/25, Private Taxi Services LLC as Additional Insured) before your first ride</li><li>Your vehicle, with doors, hatch and trunk you can open</li><li>5 years of work history, including any Uber, Lyft or other rideshare work</li></ul>" +
      "<h3>Requirements</h3><ul class='req'><li>At least 21 years old</li><li>No domestic violence charge or conviction of any kind, ever</li><li>No DWI or DUI in the last 7 years</li><li>No felony in the last 7 years</li><li>No sex offense or sex offender registration, crime against a child, child abuse/endangerment, or kidnapping, ever</li></ul>" +
      "<div class='note'>All photos must be taken <b>live with your phone's camera</b> during this application. Photos from your photo library can't be used.</div>" +
      "<div class='note'>If you're hired, you must list <b>Private Taxi Services LLC</b> as an <b>Additional Insured</b> on your commercial liability policy and send us the updated certificate before your first ride.</div></div>" +
      nav(S.step > 0 || S.personal.first ? "Continue" : "Start application", true);
  };
  R[1] = function () {
    return "<h2>About you</h2><div class='card'><div class='row'>" + inp("personal.first", "First name", { ac: "given-name" }) + inp("personal.last", "Last name", { ac: "family-name" }) + "</div>" +
      inp("personal.middle", "Middle name (optional)", { ac: "additional-name" }) +
      inp("personal.dob", "Date of birth", { type: "date", ac: "bday" }) +
      inp("personal.phone", "Mobile phone", { type: "tel", im: "tel", ac: "tel-national", max: 14, ph: "(713) 555-0123" }) +
      inp("personal.email", "Email", { type: "email", im: "email", ac: "email" }) +
      inp("personal.street", "Street address", { ac: "address-line1" }) + inp("personal.unit", "Apt / unit (optional)", { ac: "address-line2" }) +
      "<div class='row3'>" + inp("personal.city", "City", { ac: "address-level2" }) + inp("personal.state", "State", { max: 2, ac: "address-level1", cap: 1 }) + inp("personal.zip", "ZIP", { im: "numeric", max: 5, ac: "postal-code", pat: "[0-9]*" }) + "</div></div>" + nav();
  };
  var CRIM = [
    ["dv", "Have you EVER been charged with or convicted of domestic violence of any kind (including dismissed, deferred, or pending charges)?"],
    ["dwi", "In the last 7 years, have you been charged with or convicted of DWI or DUI?"],
    ["felony", "In the last 7 years, have you been charged with or convicted of a felony?"],
    ["sex", "Have you EVER been charged with or convicted of any sex offense, or ever been required to register as a sex offender?"],
    ["child", "Have you EVER been charged with or convicted of any crime against a child, including child abuse, neglect, or endangerment?"],
    ["kidnap", "Have you EVER been charged with or convicted of kidnapping or unlawful restraint?"]
  ];
  R[2] = function () {
    var h = "<h2>Criminal history</h2><p class='muted'>Answer honestly. We verify every answer with a background check.</p><div class='card'>";
    CRIM.forEach(function (q) {
      h += yn("elig." + q[0], q[1]);
      if (S.elig[q[0]] === "yes") h += "<div class='row'>" + inp("elig." + q[0] + "Date", "Date (approximate is OK)", { type: "date" }) + "<div></div></div><label for='d_" + q[0] + "'>Details</label><textarea id='d_" + q[0] + "' data-p='elig." + q[0] + "Details' rows='2'>" + esc(S.elig[q[0] + "Details"] || "") + "</textarea>";
    });
    return h + chk("elig.bgConsent", "I authorize Private Car Services (Private Taxi Services LLC) to run a criminal background check and driving record (MVR) check on me. I understand a separate disclosure form will be provided before the check is run.") +
      chk("elig.sorConsent", "PCS drivers may transport children riding alone. I authorize PCS to search the National Sex Offender Public Website (NSOPW) and state sex offender registries for my name.") + "</div>" + nav();
  };
  function docCard(k, num, extra) {
    var x = S.docs[k] || {}, exp = x.exp || "", bad = exp && exp < today();
    return "<div class='card'><h3>" + esc(DOCS[k]) + "</h3>" + num + extra + inp("docs." + k + ".exp", "Expiration date", { type: "date" }) +
      (bad ? "<div class='err'>Expired " + fmtDate(exp) + ". You can't continue until it's renewed.</div>" : "") + "</div>";
  }
  var LIMO_CITIES = ["Houston", "Dallas", "Austin", "San Antonio", "Fort Worth", "El Paso", "Arlington", "Corpus Christi", "Other Texas city"];
  function noLimo() { return S.docs.limo.has === "no"; }
  function limoCard() {
    var L = S.docs.limo, h = "<div class='card'><h3>Limousine / chauffeur license</h3><p class='muted'>An active limo or chauffeur license from any city that issues one is accepted.</p>";
    L.has = S.gate.limo === "yes" ? "yes" : "no";
    if (L.has === "no") return h + "<div class='note'>You said you'll obtain your limo/chauffeur license before you're hired. You'll be asked for it before your first ride.</div></div>";
    if (L.has !== "yes") return h + "</div>";
    h += "<label for='lc'>Issuing city</label><select id='lc' data-p='docs.limo.city'><option value=''>Choose…</option>" + LIMO_CITIES.map(function (c) { return "<option" + (L.city === c ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>";
    if (L.city === "Other Texas city") h += inp("docs.limo.cityOther", "City name");
    var exp = L.exp || "";
    return h + inp("docs.limo.number", "License number", { max: 20, cap: 1 }) + inp("docs.limo.exp", "Expiration date", { type: "date" }) + (exp && exp < today() ? "<div class='err'>Expired " + fmtDate(exp) + ". You can't continue until it's renewed.</div>" : "") + "</div>";
  }
  function noIns() { return S.docs.ins.has === "no"; }
  function insCard() {
    var I = S.docs.ins, h = "<div class='card'><h3>Commercial auto insurance <span class='muted'>(optional now)</span></h3>" + yn("docs.ins.has", "Do you have commercial auto liability insurance right now?");
    var after = "<div class='note'>Before your first ride, hired drivers must have <b>commercial</b> auto liability of at least 30/60/25 with <b>Private Taxi Services LLC</b> listed as <b>Additional Insured</b>. You don't need it to apply.</div>";
    if (I.has === "no") return h + "<p class='muted'>No problem. You can apply without it.</p>" + after + "</div>";
    if (I.has !== "yes") return h + after + "</div>";
    return h + inp("docs.ins.number", "Policy number", { max: 30, cap: 1 }) + inp("docs.ins.carrier", "Insurance company", { ph: "e.g. Progressive" }) + inp("docs.ins.exp", "Expiration date", { type: "date" }) +
      (I.exp && I.exp < today() ? "<p class='muted'>This policy looks expired. You can still apply; you'll need current coverage if hired.</p>" : "") + after + "</div>";
  }
  R[3] = function () {
    return "<h2>Licenses &amp; insurance</h2>" +
      limoCard() +
      docCard("dl", inp("docs.dl.number", "Driver's license number", { im: "numeric", pat: "[0-9]*", max: 20 }), inp("docs.dl.state", "Issuing state", { max: 2, cap: 1 })) +
      insCard() + nav();
  };
  function photoCard(i) {
    var p = PHOTOS[i], v = S.photos[i], done = v && v !== "na";
    return "<div class='ph" + (done || v === "na" ? " done" : "") + "'><div class='thumb'" + (done && blobs[i] ? " style=\"background-image:url('" + blobs[i] + "')\"" : "") + ">" + (done ? "" : v === "na" ? "N/A" : "&#128247;") + "</div><div><b>" + i + ". " + esc(p.t) + "</b><p>" + esc(p.tip) + "</p><div class='acts'>" +
      "<button type='button' class='btn small' data-cam='" + i + "'>" + (done ? "Retake" : "Take photo") + "</button>" +
      (p.na ? "<button type='button' class='btn small ghost" + (v === "na" ? " sel" : "") + "' data-na='" + i + "'>N/A, no third row</button>" : "") + "</div></div></div>";
  }
  R[4] = function () {
    return "<h2>Document photos</h2><p class='muted'>Live camera only. Make sure the text is sharp and readable, with no glare.</p><div class='photos'>" + [1, 2, 14, 3].map(photoCard).join("") + "</div>" + nav();
  };
  R[5] = function () {
    var h = "<h2>Vehicle</h2><div class='card'><div class='row'>" + inp("vehicle.year", "Year", { im: "numeric", max: 4, pat: "[0-9]*" }) + inp("vehicle.make", "Make") + "</div><div class='row'>" + inp("vehicle.model", "Model") + inp("vehicle.color", "Color") + "</div><div class='row'>" +
      inp("vehicle.plate", "License plate", { max: 10, cap: 1 }) + inp("vehicle.seats", "Passenger seats", { im: "numeric", max: 2, pat: "[0-9]*" }) + "</div></div>";
    h += "<h3>Vehicle photos</h3><p class='muted'>Take these in daylight or a well-lit area. Interior photos are taken from outside the car with the door open.</p><div class='photos'>";
    for (var i = 4; i <= 13; i++) h += photoCard(i);
    return h + "</div>" + nav();
  };
  R[6] = function () {
    var cov = coverage();
    var h = "<h2>Work history</h2><p class='muted'>List every job from the last 5 years, newest first, including Uber, Lyft, or other rideshare and delivery driving.</p><div class='card'>" + yn("work.rideshare", "Have you driven for Uber, Lyft, or another rideshare company?") + "</div>";
    S.work.jobs.forEach(function (j, n) {
      var b = "work.jobs." + n + ".";
      h += "<div class='job'><div class='hd'><b>Job " + (n + 1) + "</b>" + (S.work.jobs.length > 1 ? "<button type='button' class='btn small ghost' data-rm='" + n + "'>Remove</button>" : "") + "</div>" +
        inp(b + "employer", "Employer (Uber, Lyft, company name…)") + inp(b + "role", "Job title / role") +
        "<div class='row'>" + inp(b + "start", "Start (month)", { type: "month" }) + (j.current ? "<div><label>End</label><input disabled value='Present'></div>" : inp(b + "end", "End (month)", { type: "month" })) + "</div>" +
        chk(b + "current", "I still work here") + chk(b + "rideshare", "This is rideshare / app-based driving") +
        inp(b + "contact", "Supervisor or contact phone/email (for rideshare: the email on your driver account)") + inp(b + "reason", "Reason for leaving (optional)") + "</div>";
    });
    h += "<button type='button' class='btn ghost' id='addjob' style='width:100%'>+ Add another job</button>";
    h += "<div class='card cov' style='margin-top:12px'>" + (cov.any && !cov.gaps.length ? "<span class='ok'>&#10003; Your last 5 years are covered.</span>" :
      "<b>Gaps in the last 5 years:</b><ul class='req'>" + (cov.any ? cov.gaps.map(function (g) { return "<li>" + g.from + " – " + g.to + " (" + g.months + " mo)</li>"; }).join("") : "<li>Add your jobs to cover the last 5 years</li>") + "</ul>") +
      (cov.gaps.length && cov.any ? "<label for='gapn'>Explain each gap (school, caregiving, looking for work, etc.)</label><textarea id='gapn' data-p='work.gapNote' rows='3'>" + esc(S.work.gapNote || "") + "</textarea>" : "") + "</div>";
    return h + nav();
  };
  R[7] = function () {
    return "<h2>Policies &amp; signature</h2><div class='card'>" +
      chk("agree.smoke", "<b>No smoking or vaping.</b> I understand there is no smoking or vaping of any kind (cigarettes, cigars, e-cigarettes, vapes) in the vehicle by the driver or riders, at any time, including between rides.") +
      chk("agree.insured", "If I'm hired, I will list <b>Private Taxi Services LLC</b> as an <b>Additional Insured</b> on my commercial liability policy and provide an updated certificate before my first ride.") +
      chk("agree.accurate", "Everything in this application is true and complete. False or missing information may disqualify me or end my contract. The photos were taken live, today, of my own documents and vehicle.") +
      inp("agree.signature", "Type your full legal name to sign", { ac: "name" }) + "<p class='muted'>Signed " + fmtDate(today()) + ". Full policies: <a href='../policies/' target='_blank' style='color:#f0d48a'>Terms and Policies</a> at www.PCSrides.com</p></div>" + nav();
  };
  R[8] = function () {
    var p = S.personal, d = S.docs, v = S.vehicle, n = 0;
    for (var i = 1; i <= 14; i++) if (S.photos[i]) n++;
    function dd(t, x) { return "<dt>" + esc(t) + "</dt><dd>" + esc(x) + "</dd>"; }
    return "<h2>Review &amp; submit</h2><div class='card'><dl class='rev'>" + dd("Name", [p.first, p.middle, p.last].filter(Boolean).join(" ")) + dd("Date of birth", fmtDate(p.dob)) + dd("Phone / email", p.phone + " · " + p.email) +
      dd("Address", [p.street, p.unit].filter(Boolean).join(" ") + ", " + p.city + ", " + p.state + " " + p.zip) +
      dd("Limo license", noLimo() ? "Will obtain before hire" : d.limo.number + " (" + (d.limo.city === "Other Texas city" ? d.limo.cityOther || "" : d.limo.city) + ") · expires " + fmtDate(d.limo.exp)) + dd("Driver's license", d.dl.number + " (" + (d.dl.state || "") + ") · expires " + fmtDate(d.dl.exp)) +
      dd("Insurance", noIns() ? "No commercial insurance yet" : (d.ins.carrier ? d.ins.carrier + " " : "") + d.ins.number + (d.ins.exp ? " · expires " + fmtDate(d.ins.exp) : "")) + dd("Vehicle", [v.year, v.color, v.make, v.model].filter(Boolean).join(" ") + (v.plate ? " · " + v.plate : "")) +
      dd("Photos", n + " of " + (14 - (noLimo() ? 1 : 0) - (noIns() ? 1 : 0)) + (S.photos[12] === "na" ? " (no third row)" : "")) + dd("Jobs listed", String(S.work.jobs.length)) + "</dl></div>" +
      "<div id='upl' class='muted'></div>" + nav("Submit application");
  };
  R[9] = function () {
    return "<h2>Application submitted</h2><div class='card'><p>Thank you, " + esc(S.personal.first) + ". We received your application" + (S.appId ? " (reference <b>" + esc(S.appId) + "</b>)" : "") + ".</p><p>Matthew will review it and contact you by phone or email. If you have questions, visit www.PCSrides.com.</p>" +
      "<h3>Next: background check invite</h3><p>If your application moves forward, you'll get an email or text from our background check provider with a secure link. You'll enter your Social Security number and sign the authorization <b>on their site</b>. PCS never sees or stores your SSN.</p>" +
      "<div class='note'>Reminder: if you're hired, list <b>Private Taxi Services LLC</b> as an <b>Additional Insured</b> and send the updated certificate.</div></div>" +
      "";
  };

  /* ---------- validation per step ---------- */
  V[1] = function () {
    var p = S.personal, e = [];
    ["first", "last", "dob", "phone", "email", "street", "city", "state", "zip"].forEach(function (k) { if (!String(p[k] || "").trim()) e.push("Please fill in " + { first: "first name", last: "last name", dob: "date of birth", phone: "phone", email: "email", street: "street address", city: "city", state: "state", zip: "ZIP" }[k] + "."); });
    if (p.phone && String(p.phone).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) e.push("Phone number must be 10 digits.");
    if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) e.push("Check your email address.");
    if (p.zip && !/^\d{5}$/.test(p.zip)) e.push("ZIP must be 5 digits.");
    if (!e.length && p.dob && ageOn(p.dob, today()) < 21) {
      modal("You must be 21 or older", "<p>PCS drivers must be at least 21 years old. Based on the date of birth you entered, you can't continue with this application.</p><p class='muted'>If you entered your birth date wrong, correct it and tap Next again.</p>");
      return false;
    }
    return showErr(e);
  };
  V[2] = function () {
    var x = S.elig, e = [], yes = [];
    CRIM.forEach(function (q) { if (!x[q[0]]) e.push("Please answer every question."); else if (x[q[0]] === "yes") { yes.push(q[0]); if (!x[q[0] + "Date"] || String(x[q[0] + "Details"] || "").trim().length < 3) e.push("Please add the date and details for each Yes answer."); } });
    if (e.length) return showErr([e[0]].concat(e.indexOf(e[0]) === e.lastIndexOf(e[0]) ? e.slice(1) : []));
    if (yes.length) {
      reportDisq(yes);
      modal("Thank you for your honesty", "<p>We're sorry, but based on your answers you don't meet PCS driver requirements, so this application can't continue.</p><p class='muted'>Because PCS drivers may transport children, PCS can't accept drivers with any domestic violence, sex offense, crime against a child, or kidnapping charge or conviction, ever, or a DWI/DUI or felony in the last 7 years. If you answered by mistake, change your answer and tap Next.</p>", [{ t: "OK" }], true);
      return false;
    }
    if (!x.bgConsent) e.push("Please check the box to authorize the background check.");
    if (!x.sorConsent) e.push("Please check the box to authorize the sex offender registry check.");
    return showErr(e);
  };
  /* Matthew asked to be flagged when someone answers Yes: send a small record (no photos), once per answer set */
  function reportDisq(yes) {
    var sig = yes.join(",") + "|" + yes.map(function (k) { return S.elig[k + "Date"]; }).join(",");
    if (S.disqSent === sig) return;
    var el = {}; yes.forEach(function (k) { el[k] = "yes"; el[k + "Date"] = S.elig[k + "Date"]; el[k + "Details"] = S.elig[k + "Details"]; });
    post("/apply/disqualified", { inv: S.inv, personal: S.personal, elig: el }).then(function () { S.disqSent = sig; save(); }).catch(function () {});
  }
  V[3] = function () {
    var e = [], exp = null;
    if (!S.docs.limo.has) e.push("Limo license: answer whether you have one.");
    else if (!noLimo() && !S.docs.limo.city) e.push("Limo license: choose the issuing city.");
        if (!S.docs.ins.has) e.push("Insurance: answer whether you have commercial insurance now.");
    Object.keys(DOCS).forEach(function (k) { if (k === "limo" && S.docs.limo.has !== "yes") return; if (k === "ins") { if (S.docs.ins.has === "yes" && !String(S.docs.ins.number || "").trim()) e.push("Insurance: enter the policy number, or answer No."); return; } var x = S.docs[k]; if (!String(x.number || "").trim()) e.push(DOCS[k] + ": enter the number."); if (!x.exp) e.push(DOCS[k] + ": enter the expiration date."); else if (x.exp < today() && !exp) exp = k; });
    if (!String(S.docs.dl.state || "").trim()) e.push("Driver's license: enter the issuing state.");
    if (exp) { expiredPopup(exp); return false; }
    return showErr(e);
  };
  function needPhotos(list) { var miss = list.filter(function (i) { return !S.photos[i]; }); return showErr(miss.map(function (i) { return "Take photo " + i + ": " + PHOTOS[i].t + (Object.keys(DOCPHOTO).some(function (k) { return DOCPHOTO[k] === i && S.docs[k].renewedAt; }) ? " (renewed document)" : "") + "."; })); }
  V[4] = function () { return needPhotos([1, 2, 14, 3].filter(function (i) { return !(i === 1 && noLimo()) && !(i === 14 && noIns()); })); };
  V[5] = function () { var v = S.vehicle, e = []; ["year", "make", "model", "color", "plate", "seats"].forEach(function (k) { if (!String(v[k] || "").trim()) e.push("Vehicle: enter the " + k + "."); }); var y = Number(v.year); if (!e.length && !(y >= minYear() && y <= minYear() + 12)) e.push("Vehicle: model year must be " + minYear() + " or newer."); if (e.length) return showErr(e); return needPhotos([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); };
  V[6] = function () {
    var e = [], cov = coverage();
    S.work.jobs.forEach(function (j, n) { var m = []; if (!String(j.employer || "").trim()) m.push("employer"); if (!String(j.role || "").trim()) m.push("role"); if (!j.start) m.push("start month"); if (!j.current && !j.end) m.push("end month"); if (!String(j.contact || "").trim()) m.push("contact"); if (j.start && j.end && !j.current && j.end < j.start) m.push("end is before start"); if (m.length) e.push("Job " + (n + 1) + ": " + m.join(", ") + "."); });
    if (!S.work.rideshare) e.push("Answer the rideshare question.");
    if (S.work.rideshare === "yes" && !S.work.jobs.some(function (j) { return j.rideshare; })) e.push("You said you've driven rideshare. Add that job and check 'This is rideshare'.");
    if (!e.length && cov.gaps.length && String(S.work.gapNote || "").trim().length < 10) e.push("Your jobs don't cover the full 5 years. Add the missing jobs or explain each gap.");
    return showErr(e);
  };
  V[7] = function () { var a = S.agree, e = []; if (!a.smoke) e.push("Please acknowledge the no smoking / no vaping policy."); if (!a.insured) e.push("Please acknowledge the Additional Insured requirement."); if (!a.accurate) e.push("Please confirm your information is true."); if (String(a.signature || "").trim().length < 3) e.push("Type your full name to sign."); return showErr(e); };

  /* ---------- submit: start -> upload photos -> submit ---------- */
  function post(path, body, raw) {
    return fetch(API + path, raw ? { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || "Server error " + r.status); return d; }); });
  }
  function submit(btn) {
    var upl = document.getElementById("upl"); btn.disabled = true;
    function say(t) { upl.textContent = t; }
    say("Connecting…");
    post("/apply/start", S.appId ? { appId: S.appId, inv: S.inv } : { inv: S.inv }).then(function (st) {
      S.appId = st.appId; save();
      var slots = []; for (var i = 1; i <= 14; i++) if (S.photos[i] && S.photos[i] !== "na") slots.push(i);
      var n = 0;
      return slots.reduce(function (pr, i) {
        return pr.then(function () { return getBlob(i); }).then(function (b) {
          if (!b) throw new Error("Photo " + i + " is missing on this phone. Please retake it.");
          say("Uploading photos securely… " + (++n) + " of " + slots.length);
          return post("/apply/photo?app=" + st.appId + "&tok=" + encodeURIComponent(st.upTok) + "&slot=" + i + "&at=" + S.photos[i].at + "&inv=" + encodeURIComponent(S.inv), b, true);
        });
      }, Promise.resolve()).then(function () {
        say("Sending application…");
        var f = JSON.parse(JSON.stringify({ gate: S.gate, personal: S.personal, elig: S.elig, docs: S.docs, vehicle: S.vehicle, work: S.work, photos: S.photos, agree: S.agree }));
        return post("/apply/submit", { inv: S.inv, appId: st.appId, upTok: st.upTok, form: f });
      });
    }).then(function () {
      S.submitted = true; S.step = 9; save();
      for (var i = 1; i <= 14; i++) delBlob(i);
      render();
    }).catch(function (e) { btn.disabled = false; say(""); showErr([e.message || "Couldn't send. Check your connection and tap Submit again. Nothing is lost."]); });
  }

  /* ---------- render + events ---------- */
  function render() {
    app.innerHTML = R[S.step]();
    document.getElementById("bar").style.width = Math.round(S.step / 9 * 100) + "%";
    document.getElementById("stepname").textContent = S.step > 0 && S.step < 9 ? "Step " + S.step + " of 8 · " + STEPS[S.step] : "";
    window.scrollTo(0, 0);
  }
  app.addEventListener("input", function (ev) {
    var t = ev.target, p = t.getAttribute("data-p"); if (!p) return;
    var v = t.value;
    if (/\.phone$/.test(p)) { var d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10); v = d.length > 6 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : d.length > 3 ? "(" + d.slice(0, 3) + ") " + d.slice(3) : d; if (v !== t.value) t.value = v; }
    if (/(zip|year|seats)$/.test(p) || p === "docs.dl.number") { var n = v.replace(/\D/g, ""); if (n !== v) { v = n; t.value = n; } }
    if (/(state|plate)$/.test(p) || p === "docs.ins.number" || p === "docs.limo.number") { v = v.toUpperCase(); }
    set(p, v);
  });
  app.addEventListener("change", function (ev) {
    var t = ev.target, p = t.getAttribute("data-p"), c = t.getAttribute("data-c");
    if (c) { set(c, t.checked); if (/current$/.test(c)) render(); return; }
    var m = p && /^docs\.(limo|dl)\.exp$/.exec(p); if (p === "docs.ins.exp") render(); if (m) { docExpChanged(m[1], t.value); render(); }
    if (p && /^work\.jobs\.\d+\.(start|end)$/.test(p)) render();
    if (p === "docs.limo.city") { set(p, t.value); render(); }
  });
  app.addEventListener("click", function (ev) {
    var t = ev.target.closest("button"); if (!t) return;
    if (t.id === "next") { if (S.step === 8) return submit(t); if (S.step === 0 && !S.gate.passed) { if (V[0]()) render(); return; } if (S.step > 0 && V[S.step] && !V[S.step]()) return; S.step++; save(); render(); }
    else if (t.id === "back") { S.step = Math.max(0, S.step - 1); save(); render(); }
    else if (t.id === "addjob") { S.work.jobs.push({}); save(); render(); }
    else if (t.id === "newapp") { localStorage.removeItem(KEY); S = blank(); blobs = {}; render(); }
    else if (t.getAttribute("data-rm") != null) { S.work.jobs.splice(Number(t.getAttribute("data-rm")), 1); save(); render(); }
    else if (t.getAttribute("data-yn")) { set(t.getAttribute("data-yn"), t.getAttribute("data-v")); render(); }
    else if (t.getAttribute("data-cam")) openCam(Number(t.getAttribute("data-cam")));
    else if (t.getAttribute("data-na")) { var i = Number(t.getAttribute("data-na")); S.photos[i] = S.photos[i] === "na" ? null : "na"; delBlob(i); delete blobs[i]; save(); render(); }
  });
  function gate(msg) {
    app.innerHTML = "<h2>Driver application</h2><div class='card'><p>" + esc(msg) + "</p></div>";
    document.getElementById("bar").style.width = "0"; document.getElementById("stepname").textContent = "";
  }
  /* Oct 13: open to everyone (no invite needed). An old invite link still prefills name/phone/email. */
  post("/apply/config", {}).then(function (d) { if (d.cfg) CFG = d.cfg; }).catch(function () {});
  if (S.submitted) { S.step = 9; render(); }
  else if (!S.inv) loadThumbs().then(render, render);
  else {
    app.innerHTML = "<p class='muted'>Checking your invitation…</p>";
    post("/apply/invite-check", { inv: S.inv }).then(function (d) {
      if (!S.personal.first && d.name) { var n = d.name.split(/\s+/); S.personal.first = n[0]; S.personal.last = n.slice(1).join(" "); }
      if (!S.personal.email && d.email) S.personal.email = d.email;
      if (!S.personal.phone && d.phone) S.personal.phone = d.phone;
      save(); return loadThumbs().then(render, render);
    }).catch(function () { S.inv = ""; save(); loadThumbs().then(render, render); });
  }
  window.__pcsApply = { state: function () { return S; } };
})();
