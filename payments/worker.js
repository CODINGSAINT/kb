// KB payments: the only server-side piece of KB. A Cloudflare Worker (free tier is plenty).
//
// Lemon Squeezy (international) needs nothing here: the browser talks to its public licence API.
// Razorpay (India: UPI, cards, netbanking in ₹) needs a server, because creating an order and checking a
// payment's signature use your secret key. This Worker does that and issues KB licence keys
// ("KB-XXXXX-XXXXX-XXXXX-XXXXX") that are tied to the buyer's Google account.
//
// Endpoints (all POST, JSON in and out; CORS limited to ALLOWED_ORIGINS):
//   /rzp/order        { token, aff? }                       -> { orderId, amount, currency, keyId, email, name } or { licence } if already bought
//   /rzp/verify       { token, orderId, paymentId, signature } -> { licence }
//   /rzp/webhook      Razorpay webhook (order.paid, payment.captured, refund.processed): issues or revokes licences
//   /licence/restore  { token }                              -> { licence } for the signed-in Google account
//   /licence/activate { token, key }                         -> { licence } if the key belongs to that account
//   /licence/validate { key }                                -> { valid, status, email }
//
// `token` is the Google access token the KB page already holds (scope email). It's checked with Google:
// it must be for KB's own OAuth client (GOOGLE_CLIENT_ID) and a verified email.
//
// Secrets (wrangler secret put): RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
// Vars (wrangler.toml): RAZORPAY_KEY_ID, PRICE_PAISE, CURRENCY, GOOGLE_CLIENT_ID, ALLOWED_ORIGINS, PRODUCT_NAME.
// KV binding: LICENCES.

const RZP = "https://api.razorpay.com/v1";
const PRODUCT = "kb-pro";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method === "GET" && url.pathname === "/") return json({ ok: true, service: "kb-payments" }, 200, cors);
    if (req.method !== "POST") return json({ error: "Not found" }, 404, cors);
    try {
      switch (url.pathname) {
        case "/rzp/webhook": return await webhook(req, env); // server to server: no CORS
        case "/rzp/order": return json(await createOrder(await body(req), env), 200, cors);
        case "/rzp/verify": return json(await verifyPayment(await body(req), env), 200, cors);
        case "/licence/restore": return json(await restore(await body(req), env), 200, cors);
        case "/licence/activate": return json(await activate(await body(req), env), 200, cors);
        case "/licence/validate": return json(await validate(await body(req), env), 200, cors);
        default: return json({ error: "Not found" }, 404, cors);
      }
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e && e.stack || e);
      return json({ error: status >= 500 ? "Payment server error. Please try again in a minute." : e.message, code: e.code }, status, cors);
    }
  },
};

// ------------------------------------------------------------------ helpers
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) });
}
async function body(req) {
  try { return await req.json(); } catch (e) { throw fail(400, "Bad request."); }
}
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}
const enc = new TextEncoder();
async function hmacHex(secret, message) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join("");
  return "KB-" + chars.match(/.{5}/g).join("-");
}
const normEmail = (e) => String(e || "").trim().toLowerCase();

async function rzp(env, path, init = {}) {
  const auth = "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const res = await fetch(RZP + path, Object.assign({}, init, { headers: Object.assign({ Authorization: auth, "Content-Type": "application/json" }, init.headers || {}) }));
  let j = {};
  try { j = await res.json(); } catch (e) {}
  if (!res.ok) throw fail(502, `Razorpay ${res.status}: ${(j.error && j.error.description) || res.statusText}`);
  return j;
}

// The Google account behind a KB page's access token.
async function googleUser(token, env) {
  if (!token) throw fail(401, "Sign in with Google first.", "AUTH");
  let res;
  try { res = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token)); }
  catch (e) { throw fail(502, "Couldn't reach Google. Try again."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw fail(401, "Your Google sign-in has expired. Tap the sync chip, then try again.", "AUTH");
  if (env.GOOGLE_CLIENT_ID && j.aud !== env.GOOGLE_CLIENT_ID && j.azp !== env.GOOGLE_CLIENT_ID) throw fail(401, "That sign-in isn't from KB.", "AUTH");
  const verified = j.email_verified === true || j.email_verified === "true";
  if (!j.email || !verified) throw fail(401, "Your Google account needs a verified email.", "AUTH");
  return normEmail(j.email);
}

// ------------------------------------------------------------------ licence store (KV)
//   lic:<key>     -> record      email:<email> -> key      order:<id> -> key      pay:<id> -> key
const getJson = async (env, k) => { const v = await env.LICENCES.get(k); return v ? JSON.parse(v) : null; };
const publicLicence = (r) => ({ key: r.key, email: r.email, status: r.status, provider: "razorpay", purchasedAt: r.createdAt });

async function licenceForEmail(env, email) {
  const key = await env.LICENCES.get("email:" + email);
  return key ? getJson(env, "lic:" + key) : null;
}

// Idempotent: one licence per paid order, however many times verify and the webhook arrive.
async function issue(env, { orderId, paymentId, email, amount, currency, aff }) {
  email = normEmail(email);
  if (!email) throw fail(400, "Order has no buyer email.");
  const existingKey = await env.LICENCES.get("order:" + orderId);
  if (existingKey) {
    const rec = await getJson(env, "lic:" + existingKey);
    if (paymentId && !rec.paymentId) { rec.paymentId = paymentId; await env.LICENCES.put("lic:" + rec.key, JSON.stringify(rec)); await env.LICENCES.put("pay:" + paymentId, rec.key); }
    return rec;
  }
  const prev = await licenceForEmail(env, email);
  if (prev && prev.status === "active") {
    // Paid twice (two tabs, say). Keep their one licence; the second payment shows in your Razorpay dashboard to refund.
    await env.LICENCES.put("order:" + orderId, prev.key);
    if (paymentId) await env.LICENCES.put("pay:" + paymentId, prev.key);
    console.warn(`duplicate payment for ${email}: order ${orderId} (licence ${prev.key}) — refund it from the dashboard`);
    return prev;
  }
  const rec = { key: newKey(), email, product: PRODUCT, provider: "razorpay", orderId, paymentId: paymentId || null, amount, currency, aff: aff || null, status: "active", createdAt: new Date().toISOString() };
  await env.LICENCES.put("lic:" + rec.key, JSON.stringify(rec));
  await env.LICENCES.put("email:" + email, rec.key);
  await env.LICENCES.put("order:" + orderId, rec.key);
  if (paymentId) await env.LICENCES.put("pay:" + paymentId, rec.key);
  return rec;
}

// ------------------------------------------------------------------ Razorpay
async function createOrder({ token, aff }, env) {
  const email = await googleUser(token, env);
  const have = await licenceForEmail(env, email);
  if (have && have.status === "active") return { licence: publicLicence(have) };
  const amount = Number(env.PRICE_PAISE);
  if (!(amount >= 100)) throw fail(500, "PRICE_PAISE isn't set.");
  const order = await rzp(env, "/orders", {
    method: "POST",
    body: JSON.stringify({
      amount, currency: env.CURRENCY || "INR",
      receipt: ("kb-" + Date.now().toString(36) + "-" + crypto.getRandomValues(new Uint32Array(1))[0].toString(36)).slice(0, 40),
      notes: { product: PRODUCT, email, aff: aff ? String(aff).slice(0, 64) : "" },
    }),
  });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID, email, name: env.PRODUCT_NAME || "KB Pro" };
}

async function verifyPayment({ token, orderId, paymentId, signature }, env) {
  if (!orderId || !paymentId || !signature) throw fail(400, "Missing payment details.");
  const email = await googleUser(token, env);
  const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  if (!safeEqual(expected, signature)) throw fail(400, "Payment signature didn't match. If money was taken, it'll be unlocked automatically or refunded.", "SIGNATURE");
  const order = await rzp(env, "/orders/" + encodeURIComponent(orderId));
  const notes = order.notes || {};
  if (notes.product !== PRODUCT) throw fail(400, "That order isn't for KB Pro.");
  if (normEmail(notes.email) !== email) throw fail(403, "That payment was made from a different Google account.");
  // The signature proves Razorpay authorised this payment for this order; make sure the money is actually in.
  let paid = order.status === "paid";
  if (!paid) {
    const pay = await rzp(env, "/payments/" + encodeURIComponent(paymentId));
    if (pay.order_id !== orderId) throw fail(400, "Payment and order don't match.");
    if (pay.status === "authorized") { await rzp(env, `/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST", body: JSON.stringify({ amount: pay.amount, currency: pay.currency }) }); paid = true; }
    else paid = pay.status === "captured";
  }
  if (!paid) throw fail(409, "The payment hasn't completed yet. KB unlocks by itself once it does: use Restore purchase in a few minutes.", "PENDING");
  if (Number(order.amount) < Number(env.PRICE_PAISE)) throw fail(400, "Paid amount doesn't match the price.");
  const rec = await issue(env, { orderId, paymentId, email, amount: order.amount, currency: order.currency, aff: notes.aff });
  return { licence: publicLicence(rec) };
}

// Razorpay -> Worker. Set it up in Dashboard → Webhooks with events order.paid and refund.processed
// (payment.captured also works). Covers a buyer who closes the tab before verify, and refunds.
async function webhook(req, env) {
  const raw = await req.text();
  const sig = req.headers.get("X-Razorpay-Signature") || "";
  if (!safeEqual(await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw), sig)) return json({ error: "bad signature" }, 400);
  let ev;
  try { ev = JSON.parse(raw); } catch (e) { return json({ error: "bad json" }, 400); }
  const p = ev.payload || {};
  const pay = p.payment && p.payment.entity;
  const order = p.order && p.order.entity;
  if (ev.event === "order.paid" || ev.event === "payment.captured") {
    const notes = (order && order.notes) || (pay && pay.notes) || {};
    const orderId = (order && order.id) || (pay && pay.order_id);
    if (notes.product === PRODUCT && orderId && notes.email) {
      await issue(env, { orderId, paymentId: pay && pay.id, email: notes.email, amount: (order || pay).amount, currency: (order || pay).currency, aff: notes.aff });
    }
  } else if (ev.event === "refund.processed" || ev.event === "payment.refunded") {
    const refund = p.refund && p.refund.entity;
    const paymentId = (refund && refund.payment_id) || (pay && pay.id);
    const key = paymentId && await env.LICENCES.get("pay:" + paymentId);
    if (key) {
      const rec = await getJson(env, "lic:" + key);
      // Only a refund of the payment that bought the licence locks it (not a refund of a duplicate payment).
      if (rec && rec.paymentId === paymentId) { rec.status = "refunded"; rec.refundedAt = new Date().toISOString(); await env.LICENCES.put("lic:" + key, JSON.stringify(rec)); }
    }
  }
  return json({ ok: true }, 200);
}

// ------------------------------------------------------------------ licences
async function restore({ token }, env) {
  const email = await googleUser(token, env);
  const rec = await licenceForEmail(env, email);
  if (!rec || rec.status !== "active") throw fail(404, `No KB Pro purchase found for ${email}. If you just paid, wait a minute and try again.`, "NONE");
  return { licence: publicLicence(rec) };
}

async function activate({ token, key }, env) {
  key = String(key || "").trim().toUpperCase();
  const email = await googleUser(token, env);
  const rec = key && await getJson(env, "lic:" + key);
  if (!rec) throw fail(404, "That licence key wasn't found.", "NONE");
  if (rec.status !== "active") throw fail(403, "That licence is no longer active (refunded).", "INACTIVE");
  if (rec.email !== email) throw fail(403, `That key belongs to a different Google account. Sign in with that account, or contact support to move it.`, "ACCOUNT");
  return { licence: publicLicence(rec) };
}

async function validate({ key }, env) {
  key = String(key || "").trim().toUpperCase();
  const rec = key && await getJson(env, "lic:" + key);
  if (!rec) return { valid: false, status: "missing" };
  return { valid: rec.status === "active", status: rec.status, email: rec.email };
}
