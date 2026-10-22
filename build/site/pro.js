// KB Pro: a one-time purchase that unlocks practice on every topic.
//
// Two ways to pay, chosen by where the buyer is (they can switch):
//   - India: Razorpay (UPI, cards, netbanking in ₹). Checkout opens on the page; the small KB payments server
//     (payments/worker.js, a Cloudflare Worker) creates the order, checks the payment and issues a licence tied to the
//     buyer's Google account. It's saved to their settings straight away: no key to paste, and "Restore purchase"
//     brings it back on any device. Needs Google sign-in.
//   - Everywhere else: Lemon Squeezy (merchant of record, handles VAT). The buyer gets a licence key by email and
//     pastes it once. The page checks it with Lemon Squeezy's public licence API directly from the browser.
// Either way the licence is kept with their settings (in their Google Drive when signed in), so every device they
// sign in on is unlocked, and it's re-checked about once a week (refunds lock it again; offline stays unlocked).
//
// Free (configurable in site.config.json -> pro.free): reading everything, notes and read marks, plus answers,
// AI grading and the tutor on the first few topics of each design track and the first DSA patterns.
//
// Inside the Android app (Play Store) there is no buy button and no link to buy: Play only allows unlocking
// something bought elsewhere. People who already bought can restore or enter their key there.
(function () {
  "use strict";
  const SITE = window.KB_SITE || {};
  const P = SITE.pro || {};
  const R = P.razorpay || {};
  const FREE = Object.assign({ designPerTrack: 3, dsaPatterns: 2 }, P.free || {});
  const LS = "https://api.lemonsqueezy.com/v1/licenses";
  const RZP_JS = "https://checkout.razorpay.com/v1/checkout.js";
  const RECHECK_MS = 7 * 24 * 3600 * 1000;
  const isKbKey = (k) => /^KB-/i.test(String(k || "").trim());

  // Opened from the Android app? (its start URL carries ?source=twa). Remembered for this tab only:
  // the app shares Chrome's storage with the phone's browser, where buying is fine.
  try {
    if (/[?&]source=twa\b/.test(location.search) || document.referrer.startsWith("android-app://")) sessionStorage.setItem("kb-in-play", "1");
  } catch (e) {}
  const inPlayApp = () => { try { return sessionStorage.getItem("kb-in-play") === "1"; } catch (e) { return false; } };

  // Referral: a friend's link (?aff=CODE) is kept and passed to checkout (Lemon Squeezy's affiliate programme;
  // for Razorpay it's saved on the order, so you can see who referred whom in the dashboard).
  try { const aff = new URLSearchParams(location.search).get("aff"); if (aff) localStorage.setItem("kb-aff", aff.slice(0, 64)); } catch (e) {}
  const affCode = () => { try { return localStorage.getItem("kb-aff") || ""; } catch (e) { return ""; } };

  // Where the licence lives: set by web.js (Google Drive settings when signed in, else this browser).
  let storeGet = (k) => { try { return JSON.parse(localStorage.getItem("kb-" + k)); } catch (e) { return null; } };
  let storeSet = (k, v) => { try { if (v == null) localStorage.removeItem("kb-" + k); else localStorage.setItem("kb-" + k, JSON.stringify(v)); } catch (e) {} };
  let accountEmail = () => "";

  const enabled = () => !!P.enabled;
  const licence = () => storeGet("licence");
  const isPro = () => !enabled() || !!(licence() && licence().status === "active");

  // ---- payment methods -------------------------------------------------------------------
  const hasLemon = () => !!P.checkoutUrl;
  const hasRazorpay = () => !!(R.enabled && R.apiUrl);
  const inIndia = () => {
    try { if (/^Asia\/(Kolkata|Calcutta)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone)) return true; } catch (e) {}
    return /-IN$/i.test(navigator.language || "");
  };
  function method() {
    let pick = "";
    try { pick = sessionStorage.getItem("kb-pay-method") || ""; } catch (e) {}
    if (pick === "razorpay" && hasRazorpay()) return "razorpay";
    if (pick === "lemon" && hasLemon()) return "lemon";
    if (hasRazorpay() && (inIndia() || !hasLemon())) return "razorpay";
    return hasLemon() ? "lemon" : "";
  }
  const priceOf = (m) => (m === "razorpay" ? R.price : P.price) || "";

  // ---- Lemon Squeezy ---------------------------------------------------------------------
  async function lsCall(path, params) {
    let res;
    try {
      res = await fetch(`${LS}/${path}`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
    } catch (e) { throw Object.assign(new Error("Can't reach the licence server. Check your connection and try again."), { code: "OFFLINE" }); }
    let j = {};
    try { j = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, body: j };
  }
  function checkProduct(m) {
    if (!m) return "The licence server gave an unexpected reply.";
    if (P.storeId && Number(m.store_id) !== Number(P.storeId)) return "That key is for a different product.";
    if (P.productId && Number(m.product_id) !== Number(P.productId)) return "That key is for a different product.";
    return "";
  }
  function checkoutUrl() {
    if (!P.checkoutUrl) return "";
    const u = new URL(P.checkoutUrl);
    const email = accountEmail();
    if (email) u.searchParams.set("checkout[email]", email);
    const aff = affCode();
    if (aff) u.searchParams.set("aff", aff);
    return u.toString();
  }

  // ---- KB payments server (Razorpay) -----------------------------------------------------
  async function kbApi(path, payload) {
    let res;
    try {
      res = await fetch(String(R.apiUrl).replace(/\/$/, "") + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch (e) { throw Object.assign(new Error("Can't reach the payment server. Check your connection and try again."), { code: "OFFLINE" }); }
    let j = {};
    try { j = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error(j.error || `Payment server error (${res.status}).`), { code: j.code, status: res.status });
    return j;
  }
  // Who's buying: the payment server asks Google, using the token the page already has for Drive sync.
  async function googleToken() {
    const D = window.KBDrive;
    if (!D || !D.available) throw new Error("Google sign-in isn't set up on this site.");
    if (!D.user) throw Object.assign(new Error("Sign in with Google first: KB Pro is tied to your Google account, so it works on all your devices."), { code: "AUTH" });
    return D.freshToken();
  }
  function saveKb(lic) {
    const rec = { provider: "razorpay", key: lic.key, status: lic.status || "active", email: lic.email || "", checkedAt: Date.now() };
    storeSet("licence", rec);
    return rec;
  }
  let rzpLoad = null;
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    if (rzpLoad) return rzpLoad;
    rzpLoad = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = RZP_JS; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { rzpLoad = null; reject(new Error("Couldn't load Razorpay checkout. Check your connection (or an ad blocker).")); };
      document.head.appendChild(s);
    });
    return rzpLoad;
  }

  // Razorpay checkout. Resolves with the licence once paid; rejects if closed or failed.
  // hooks.opening(): called just before Razorpay's window opens (close any modal dialog: it would sit on top).
  // hooks.paid(): called when the payment went through, before the licence is fetched.
  async function buyRazorpay(onStatus, hooks = {}) {
    const token = await googleToken();
    onStatus("Starting checkout…");
    const [order] = await Promise.all([kbApi("/rzp/order", { token, aff: affCode() }), loadRazorpay()]);
    if (order.licence) return saveKb(order.licence); // already bought on this account
    const user = (window.KBDrive && window.KBDrive.user) || {};
    return new Promise((resolve, reject) => {
      let settled = false;
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
        name: order.name || "KB Pro", description: "KB Pro · one-time, all topics",
        image: new URL("icons/icon-192.png", location.href).href,
        prefill: { email: order.email, name: user.name || "" },
        notes: { email: order.email },
        theme: { color: "#1C39BB" },
        retry: { enabled: true },
        modal: { ondismiss: () => { if (!settled) { settled = true; reject(Object.assign(new Error("Checkout closed. Paid already? Use Restore purchase."), { code: "CLOSED" })); } } },
        handler: async (resp) => {
          settled = true;
          if (hooks.paid) hooks.paid();
          onStatus("Payment received. Unlocking…");
          try {
            // The token may have expired while paying; the payment server only needs a current one.
            const t = (window.KBDrive && window.KBDrive.accessToken()) || token;
            const r = await kbApi("/rzp/verify", { token: t, orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature });
            resolve(saveKb(r.licence));
          } catch (e) { reject(e); }
        },
      });
      rzp.on("payment.failed", (r) => {
        const why = r && r.error && (r.error.description || r.error.reason);
        onStatus(`Payment failed${why ? ": " + why : ""}. You can try again in the window.`, "err");
      });
      if (hooks.opening) hooks.opening();
      rzp.open();
    });
  }

  async function restore() {
    const token = await googleToken();
    const r = await kbApi("/licence/restore", { token });
    return saveKb(r.licence);
  }

  // ---- licence keys (either kind) --------------------------------------------------------
  // Paste a key once. Lemon Squeezy: activates it for this account (one activation per Google account, shared by
  // all your devices). KB keys (from a Razorpay purchase): checked against the Google account that bought it.
  async function activate(key) {
    key = String(key || "").trim();
    if (!key) throw new Error("Paste your licence key first.");
    const old = licence();
    if (old && old.key === key && old.status === "active") return old;
    if (isKbKey(key)) {
      if (!hasRazorpay()) throw new Error("That key can't be checked on this site.");
      const token = await googleToken();
      return saveKb((await kbApi("/licence/activate", { token, key })).licence);
    }
    const r = await lsCall("activate", { license_key: key, instance_name: accountEmail() || "KB on the web" });
    if (!r.ok || !r.body.activated) {
      const err = r.body.error || `Licence check failed (${r.status}).`;
      throw new Error(/limit/i.test(err) ? `${err} Each key works for one Google account. Contact support if you changed accounts.` : err);
    }
    const bad = checkProduct(r.body.meta);
    if (bad) throw new Error(bad);
    const rec = { provider: "lemonsqueezy", key, instanceId: r.body.instance && r.body.instance.id, status: "active", email: (r.body.meta && r.body.meta.customer_email) || "", checkedAt: Date.now() };
    storeSet("licence", rec);
    return rec;
  }

  // Re-check about once a week (catches refunds). Offline or server trouble keeps you unlocked.
  async function recheck() {
    const l = licence();
    if (!enabled() || !l || !l.key || Date.now() - (l.checkedAt || 0) < RECHECK_MS) return;
    try {
      if (l.provider === "razorpay" || isKbKey(l.key)) {
        if (!hasRazorpay()) return;
        const r = await kbApi("/licence/validate", { key: l.key });
        storeSet("licence", Object.assign({}, l, { status: r.valid ? "active" : "inactive", checkedAt: Date.now() }));
        return;
      }
      const params = { license_key: l.key };
      if (l.instanceId) params.instance_id = l.instanceId;
      const r = await lsCall("validate", params);
      if (r.status >= 500) return;
      const st = r.body.license_key && r.body.license_key.status;
      const ok = r.body.valid && !checkProduct(r.body.meta) && st !== "disabled" && st !== "expired";
      storeSet("licence", Object.assign({}, l, { status: ok ? "active" : "inactive", checkedAt: Date.now() }));
    } catch (e) { /* offline or server down: try again next time */ }
  }

  // ---- what's free -----------------------------------------------------------------------
  // addr: { track: "LLD" | "HLD" | "AI" | "DSA" | "READ", number }. dsaPatternOf(number) -> pattern index.
  function allowed(addr, dsaPatternOf) {
    if (isPro() || !addr) return true;
    if (addr.track === "READ") return true;
    if (addr.track === "DSA") return (dsaPatternOf ? dsaPatternOf(addr.number) : 0) < FREE.dsaPatterns;
    return Number(addr.number) <= FREE.designPerTrack;
  }
  const lockedError = () => Object.assign(new Error("This topic is part of KB Pro. The first topics of every track are free; Pro unlocks all of them."), { code: "PRO", status: 402 });

  // ---- dialog ----------------------------------------------------------------------------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function buyBlock(m) {
    if (m === "razorpay") {
      const other = hasLemon() ? `<button type="button" class="linklike small" data-act="method" data-m="lemon">Paying from outside India? Pay${P.price ? ` ${esc(P.price)}` : ""} by card</button>` : "";
      const signedIn = !!(window.KBDrive && window.KBDrive.user);
      return `<p><button type="button" class="btn primary" data-act="rzp">Get KB Pro${R.price ? ` · ${esc(R.price)}` : ""}</button></p>
        <p class="muted small">UPI, cards and netbanking via Razorpay. ${signedIn ? "Unlocks straight away on your Google account, on every device." : "Sign in with Google first: the purchase is saved to your account."}</p>
        ${other ? `<p class="small">${other}</p>` : ""}`;
    }
    const url = checkoutUrl();
    if (!url) return "";
    const other = hasRazorpay() ? `<button type="button" class="linklike small" data-act="method" data-m="razorpay">In India? Pay${R.price ? ` ${esc(R.price)}` : ""} with UPI</button>` : "";
    return `<p><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Get KB Pro${P.price ? ` · ${esc(P.price)}` : ""}</a></p>
      <p class="muted small">You'll get a licence key by email. Paste it below once; it's saved to your account.</p>
      ${other ? `<p class="small">${other}</p>` : ""}`;
  }
  function dialog(reason) {
    let dlg = document.getElementById("proDialog");
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "proDialog"; dlg.className = "ai-dialog pro-dialog"; document.body.appendChild(dlg); }
    const l = licence();
    const play = inPlayApp();
    const m = play ? "" : method();
    const price = priceOf(m);
    if (isPro()) {
      dlg.innerHTML = `<h2>KB Pro</h2>
        <p style="margin-top:0">Every topic is unlocked${l && l.email ? ` (licence for <b>${esc(l.email)}</b>)` : ""}. Thanks for supporting KB.</p>
        ${l && l.key ? `<p class="muted small">Licence key: <code>${esc(l.key)}</code></p>` : ""}
        <div class="dlg-actions"><span class="spacer"></span><button type="button" class="btn primary" data-act="close">Done</button></div>`;
    } else {
      if (m === "razorpay") loadRazorpay().catch(() => {}); // warm up, so checkout opens fast
      dlg.innerHTML = `<h2>${reason ? "Unlock this topic" : "KB Pro"}</h2>
        ${reason ? `<p style="margin-top:0">${esc(reason)}</p>` : ""}
        <ul class="pro-list">
          <li>All ${esc(P.counts || "60 design problems and 304 DSA problems")}: write answers, AI grading and the tutor</li>
          <li>Your progress synced to your Google Drive, on the web and the Android app</li>
          <li>One-time payment${price ? `: <b>${esc(price)}</b>` : ""}. No subscription</li>
        </ul>
        ${m ? buyBlock(m) : ""}
        <label class="field"><span class="lbl">${play || m === "razorpay" ? "Have a licence key?" : "Licence key"}</span>
          <input id="proKey" autocomplete="off" spellcheck="false" placeholder="Paste your licence key" /></label>
        <div class="dlg-actions"><span class="save-state" id="proMsg"></span><span class="spacer"></span>
          ${hasRazorpay() ? `<button type="button" class="btn" data-act="restore" title="Bought with Razorpay on this Google account">Restore purchase</button>` : ""}
          <button type="button" class="btn" data-act="close">Not now</button>
          <button type="button" class="btn primary" data-act="activate">Unlock</button></div>`;
    }
    const msg = () => dlg.querySelector("#proMsg");
    const say = (text, kind) => { const el = msg(); if (el) { el.className = "save-state" + (kind ? " " + kind : ""); el.textContent = text; } };
    const done = () => { say("Unlocked. Reloading…", "ok"); setTimeout(() => location.reload(), 700); };
    dlg.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "close") return dlg.close();
      if (act === "method") { try { sessionStorage.setItem("kb-pay-method", b.dataset.m); } catch (er) {} return dialog(reason); }
      if (b.disabled) return;
      b.disabled = true;
      try {
        if (act === "activate") { say("Checking…"); await activate(dlg.querySelector("#proKey").value); done(); }
        if (act === "restore") { say("Looking up your purchase…"); await restore(); done(); }
        if (act === "rzp") {
          // A modal dialog stays above everything else, so ours closes while Razorpay's window is open
          // and comes back to show the result (or the error if checkout is closed).
          await buyRazorpay((t, k) => say(t, k), { opening: () => dlg.close(), paid: () => { if (!dlg.open) dlg.showModal(); } });
          if (!dlg.open) dlg.showModal();
          done();
        }
      } catch (er) {
        if (!dlg.open) dlg.showModal();
        say(er.message, er.code === "CLOSED" ? "" : "err");
      } finally { b.disabled = false; }
    };
    if (!dlg.open) dlg.showModal();
  }

  window.KBPro = {
    enabled, isPro, allowed, lockedError, activate, restore, recheck, inPlayApp, free: FREE,
    open: dialog,
    // web.js tells us where to keep the licence and which account is signed in.
    useStore(get, set, email) { storeGet = get; storeSet = set; if (email) accountEmail = email; },
  };
})();
