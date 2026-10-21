// KB Pro: a one-time purchase that unlocks practice on every topic.
//
// Sold through Lemon Squeezy (merchant of record). The buyer gets a licence key by email, pastes it once,
// and it's kept with their settings (in their Google Drive when signed in), so every device they sign in on
// is unlocked. The page checks the key with Lemon Squeezy's public licence API directly from the browser:
// no KB server.
//
// Free (configurable in site.config.json -> pro.free): reading everything, notes and read marks, plus answers,
// AI grading and the tutor on the first few topics of each design track and the first DSA patterns.
//
// Inside the Android app (Play Store) there is no buy button and no link to buy: Play only allows unlocking
// something bought elsewhere. People who already have a key can enter it there.
(function () {
  "use strict";
  const SITE = window.KB_SITE || {};
  const P = SITE.pro || {};
  const FREE = Object.assign({ designPerTrack: 3, dsaPatterns: 2 }, P.free || {});
  const LS = "https://api.lemonsqueezy.com/v1/licenses";
  const RECHECK_MS = 7 * 24 * 3600 * 1000;

  // Opened from the Android app? (its start URL carries ?source=twa). Remembered for this tab only:
  // the app shares Chrome's storage with the phone's browser, where buying is fine.
  try {
    if (/[?&]source=twa\b/.test(location.search) || document.referrer.startsWith("android-app://")) sessionStorage.setItem("kb-in-play", "1");
  } catch (e) {}
  const inPlayApp = () => { try { return sessionStorage.getItem("kb-in-play") === "1"; } catch (e) { return false; } };

  // Referral: a friend's link (?aff=CODE, from the Lemon Squeezy affiliate programme) is kept and passed to checkout.
  try { const aff = new URLSearchParams(location.search).get("aff"); if (aff) localStorage.setItem("kb-aff", aff.slice(0, 64)); } catch (e) {}

  // Where the licence lives: set by web.js (Google Drive settings when signed in, else this browser).
  let storeGet = (k) => { try { return JSON.parse(localStorage.getItem("kb-" + k)); } catch (e) { return null; } };
  let storeSet = (k, v) => { try { if (v == null) localStorage.removeItem("kb-" + k); else localStorage.setItem("kb-" + k, JSON.stringify(v)); } catch (e) {} };
  let accountEmail = () => "";

  const enabled = () => !!P.enabled;
  const licence = () => storeGet("licence");
  const isPro = () => !enabled() || !!(licence() && licence().status === "active");

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

  // Paste a key once. Activates it for this account (one activation per Google account, shared by all your devices).
  async function activate(key) {
    key = String(key || "").trim();
    if (!key) throw new Error("Paste your licence key first.");
    const old = licence();
    if (old && old.key === key && old.status === "active") return old;
    const r = await lsCall("activate", { license_key: key, instance_name: accountEmail() || "KB on the web" });
    if (!r.ok || !r.body.activated) {
      const err = r.body.error || `Licence check failed (${r.status}).`;
      throw new Error(/limit/i.test(err) ? `${err} Each key works for one Google account. Contact support if you changed accounts.` : err);
    }
    const bad = checkProduct(r.body.meta);
    if (bad) throw new Error(bad);
    const rec = { key, instanceId: r.body.instance && r.body.instance.id, status: "active", email: (r.body.meta && r.body.meta.customer_email) || "", checkedAt: Date.now() };
    storeSet("licence", rec);
    return rec;
  }

  // Re-check about once a week (catches refunds). Offline or server trouble keeps you unlocked.
  async function recheck() {
    const l = licence();
    if (!enabled() || !l || !l.key || Date.now() - (l.checkedAt || 0) < RECHECK_MS) return;
    try {
      const params = { license_key: l.key };
      if (l.instanceId) params.instance_id = l.instanceId;
      const r = await lsCall("validate", params);
      if (r.status >= 500) return;
      const st = r.body.license_key && r.body.license_key.status;
      const ok = r.body.valid && !checkProduct(r.body.meta) && st !== "disabled" && st !== "expired";
      storeSet("licence", Object.assign({}, l, { status: ok ? "active" : "inactive", checkedAt: Date.now() }));
    } catch (e) { /* offline: try again next time */ }
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
  function checkoutUrl() {
    if (!P.checkoutUrl) return "";
    const u = new URL(P.checkoutUrl);
    const email = accountEmail();
    if (email) u.searchParams.set("checkout[email]", email);
    try { const aff = localStorage.getItem("kb-aff"); if (aff) u.searchParams.set("aff", aff); } catch (e) {}
    return u.toString();
  }
  function dialog(reason) {
    let dlg = document.getElementById("proDialog");
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "proDialog"; dlg.className = "ai-dialog pro-dialog"; document.body.appendChild(dlg); }
    const l = licence();
    const play = inPlayApp();
    const buy = !play && checkoutUrl();
    if (isPro()) {
      dlg.innerHTML = `<h2>KB Pro</h2>
        <p style="margin-top:0">Every topic is unlocked${l && l.email ? ` (licence for <b>${esc(l.email)}</b>)` : ""}. Thanks for supporting KB.</p>
        <div class="dlg-actions"><span class="spacer"></span><button type="button" class="btn primary" data-act="close">Done</button></div>`;
    } else {
      dlg.innerHTML = `<h2>${reason ? "Unlock this topic" : "KB Pro"}</h2>
        ${reason ? `<p style="margin-top:0">${esc(reason)}</p>` : ""}
        <ul class="pro-list">
          <li>All ${esc(P.counts || "60 design problems and 304 DSA problems")}: write answers, AI grading and the tutor</li>
          <li>Your progress synced to your Google Drive, on the web and the Android app</li>
          <li>One-time payment${P.price ? `: <b>${esc(P.price)}</b>` : ""}. No subscription</li>
        </ul>
        ${buy ? `<p><a class="btn primary" href="${esc(buy)}" target="_blank" rel="noopener">Get KB Pro${P.price ? ` · ${esc(P.price)}` : ""}</a></p>
          <p class="muted small">You'll get a licence key by email. Paste it below once; it's saved to your account.</p>` : ""}
        <label class="field"><span class="lbl">${play ? "Have a licence key?" : "Licence key"}</span>
          <input id="proKey" autocomplete="off" spellcheck="false" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" /></label>
        <div class="dlg-actions"><span class="save-state" id="proMsg"></span><span class="spacer"></span>
          <button type="button" class="btn" data-act="close">Not now</button>
          <button type="button" class="btn primary" data-act="activate">Unlock</button></div>`;
    }
    dlg.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "close") dlg.close();
      if (b.dataset.act === "activate") {
        const msg = dlg.querySelector("#proMsg");
        msg.className = "save-state"; msg.textContent = "Checking…";
        try {
          await activate(dlg.querySelector("#proKey").value);
          msg.className = "save-state ok"; msg.textContent = "Unlocked. Reloading…";
          setTimeout(() => location.reload(), 700);
        } catch (er) { msg.className = "save-state err"; msg.textContent = er.message; }
      }
    };
    if (!dlg.open) dlg.showModal();
  }

  window.KBPro = {
    enabled, isPro, allowed, lockedError, activate, recheck, inPlayApp, free: FREE,
    open: dialog,
    // web.js tells us where to keep the licence and which account is signed in.
    useStore(get, set, email) { storeGet = get; storeSet = set; if (email) accountEmail = email; },
  };
})();
