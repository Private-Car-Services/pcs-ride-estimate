/* Shared Firebase Auth helper for PCS rider / driver / god (compat CDN). */
(function (global) {
  "use strict";

  var OWNER_EMAIL = "mwragge78@gmail.com";
  var app = null;
  var ready = false;
  var initError = "";

  function cfg() {
    try {
      var sync = global.PCS_SYNC || {};
      return sync.firebase && typeof sync.firebase === "object" ? sync.firebase : null;
    } catch (err) {
      return null;
    }
  }

  function hasConfig() {
    var c = cfg();
    if (!c) return false;
    var key = String(c.apiKey || "").trim();
    var appId = String(c.appId || "").trim();
    if (!key || key === "REPLACE_ME") return false;
    if (!appId || appId === "REPLACE_ME") return false;
    return true;
  }

  function init() {
    if (ready) return true;
    initError = "";
    if (!hasConfig()) {
      initError = "Firebase web config missing (apiKey/appId). See MATTHEW-FIREBASE-AUTH-STEPS.md.";
      return false;
    }
    if (!global.firebase || !global.firebase.initializeApp) {
      initError = "Firebase Auth SDK not loaded.";
      return false;
    }
    try {
      if (!global.firebase.apps || !global.firebase.apps.length) {
        app = global.firebase.initializeApp(cfg());
      } else {
        app = global.firebase.app();
      }
      ready = true;
      return true;
    } catch (err) {
      initError = (err && err.message) || "Firebase init failed.";
      ready = false;
      return false;
    }
  }

  function auth() {
    if (!init()) return null;
    try { return global.firebase.auth(); } catch (err) { return null; }
  }

  function currentUser() {
    var a = auth();
    return a && a.currentUser ? a.currentUser : null;
  }

  function normalizeEmail(raw) {
    return String(raw || "").trim().toLowerCase();
  }

  function isOwnerUser(user) {
    return !!(user && normalizeEmail(user.email) === OWNER_EMAIL);
  }

  function isOwnerSignedIn() {
    return isOwnerUser(currentUser());
  }

  function getIdToken(forceRefresh) {
    var user = currentUser();
    if (!user) return Promise.resolve("");
    return user.getIdToken(!!forceRefresh).catch(function () { return ""; });
  }

  function withAuthUrl(url) {
    return getIdToken(false).then(function (token) {
      if (!token) {
        var err = new Error("auth-required");
        err.authRequired = true;
        throw err;
      }
      var u = String(url || "");
      var sep = u.indexOf("?") >= 0 ? "&" : "?";
      return u + sep + "auth=" + encodeURIComponent(token);
    });
  }

  function authFetch(url, opts) {
    return withAuthUrl(url).then(function (u) {
      return fetch(u, opts || {});
    });
  }

  function signInEmailPassword(email, password) {
    if (!init()) return Promise.reject(new Error(initError || "auth-not-configured"));
    var a = auth();
    if (!a) return Promise.reject(new Error("auth-unavailable"));
    return a.signInWithEmailAndPassword(normalizeEmail(email), String(password || ""));
  }

  function createEmailPassword(email, password) {
    if (!init()) return Promise.reject(new Error(initError || "auth-not-configured"));
    var a = auth();
    if (!a) return Promise.reject(new Error("auth-unavailable"));
    return a.createUserWithEmailAndPassword(normalizeEmail(email), String(password || ""));
  }

  function signOut() {
    var a = auth();
    if (!a) return Promise.resolve();
    return a.signOut().catch(function () {});
  }

  function onAuth(cb) {
    if (!init()) {
      try { cb(null); } catch (e) {}
      return function () {};
    }
    var a = auth();
    if (!a) {
      try { cb(null); } catch (e) {}
      return function () {};
    }
    return a.onAuthStateChanged(function (user) {
      try { cb(user || null); } catch (e) {}
    });
  }

  function authErrorMessage(err) {
    var code = err && err.code ? String(err.code) : "";
    if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return "Wrong email or password.";
    }
    if (code === "auth/email-already-in-use") return "That email already has an account. Log in instead.";
    if (code === "auth/weak-password") return "Password must be at least 6 characters.";
    if (code === "auth/invalid-email") return "Enter a valid email.";
    if (code === "auth/too-many-requests") return "Too many attempts. Try again later.";
    if (err && err.message === "auth-not-configured") return initError || "Firebase Auth is not configured yet.";
    return (err && err.message) || "Sign-in failed.";
  }

  global.PCS_AUTH = {
    OWNER_EMAIL: OWNER_EMAIL,
    init: init,
    hasConfig: hasConfig,
    initError: function () { return initError; },
    auth: auth,
    currentUser: currentUser,
    isOwnerUser: isOwnerUser,
    isOwnerSignedIn: isOwnerSignedIn,
    getIdToken: getIdToken,
    withAuthUrl: withAuthUrl,
    authFetch: authFetch,
    signInEmailPassword: signInEmailPassword,
    createEmailPassword: createEmailPassword,
    signOut: signOut,
    onAuth: onAuth,
    authErrorMessage: authErrorMessage,
    normalizeEmail: normalizeEmail
  };
})(typeof window !== "undefined" ? window : this);
