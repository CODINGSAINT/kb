// Offline tests for worker.js: Google, Razorpay and KV are faked. Run: node test.js
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker from "./worker.js";

const SECRET = "rzp_secret_test", WH = "wh_secret_test", CLIENT = "kb-client.apps.googleusercontent.com";
const store = new Map();
const env = {
  LICENCES: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
  RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WH,
  PRICE_PAISE: "99900", CURRENCY: "INR", GOOGLE_CLIENT_ID: CLIENT, ALLOWED_ORIGINS: "https://www.codingsaint.com",
};
const tokens = { good: "pallav@example.com", other: "someone@example.com" };
const orders = new Map(), payments = new Map();
let n = 0;

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
  if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
    const t = new URL(url).searchParams.get("access_token");
    if (t === "foreign") return ok({ aud: "other-app", email: "x@example.com", email_verified: "true" });
    return tokens[t] ? ok({ aud: CLIENT, azp: CLIENT, email: tokens[t], email_verified: "true" }) : new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 });
  }
  assert.ok(url.startsWith("https://api.razorpay.com/v1"), url);
  assert.equal(init.headers.Authorization, "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${SECRET}`));
  const path = url.slice("https://api.razorpay.com/v1".length);
  if (path === "/orders" && init.method === "POST") {
    const b = JSON.parse(init.body);
    const o = { id: "order_" + ++n, amount: b.amount, currency: b.currency, notes: b.notes, status: "created" };
    orders.set(o.id, o);
    return ok(o);
  }
  let m;
  if ((m = path.match(/^\/orders\/(.+)$/))) return ok(orders.get(m[1]));
  if ((m = path.match(/^\/payments\/([^/]+)$/))) return ok(payments.get(m[1]));
  if ((m = path.match(/^\/payments\/([^/]+)\/capture$/))) { const p = payments.get(m[1]); p.status = "captured"; orders.get(p.order_id).status = "paid"; return ok(p); }
  throw new Error("unexpected fetch " + url);
};

const call = async (path, body, headers = {}) => {
  const res = await worker.fetch(new Request("https://kb-payments.test" + path, { method: "POST", headers: Object.assign({ Origin: "https://www.codingsaint.com", "Content-Type": "application/json" }, headers), body: typeof body === "string" ? body : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json(), cors: res.headers.get("Access-Control-Allow-Origin") };
};
const sign = (s, msg) => crypto.createHmac("sha256", s).update(msg).digest("hex");
function pay(orderId, status = "captured") {
  const id = "pay_" + ++n;
  payments.set(id, { id, order_id: orderId, status, amount: orders.get(orderId).amount, currency: "INR" });
  if (status === "captured") orders.get(orderId).status = "paid";
  return id;
}

// 1. order needs a valid KB Google token
assert.equal((await call("/rzp/order", { token: "nope" })).status, 401);
assert.equal((await call("/rzp/order", { token: "foreign" })).status, 401);

// 2. order -> pay -> verify -> licence
let r = await call("/rzp/order", { token: "good", aff: "FRIEND1" });
assert.equal(r.status, 200); assert.equal(r.cors, "https://www.codingsaint.com");
assert.equal(r.body.amount, 99900); assert.equal(r.body.keyId, "rzp_test_abc"); assert.equal(r.body.email, "pallav@example.com");
const o1 = r.body.orderId;
assert.equal(orders.get(o1).notes.aff, "FRIEND1");
const p1 = pay(o1);
assert.equal((await call("/rzp/verify", { token: "good", orderId: o1, paymentId: p1, signature: "00" })).status, 400, "bad signature");
assert.equal((await call("/rzp/verify", { token: "other", orderId: o1, paymentId: p1, signature: sign(SECRET, `${o1}|${p1}`) })).status, 403, "other account");
r = await call("/rzp/verify", { token: "good", orderId: o1, paymentId: p1, signature: sign(SECRET, `${o1}|${p1}`) });
assert.equal(r.status, 200, JSON.stringify(r.body));
const key = r.body.licence.key;
assert.match(key, /^KB-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
assert.equal(r.body.licence.status, "active");

// 3. verify again (retry) and the webhook arriving too: still one licence
r = await call("/rzp/verify", { token: "good", orderId: o1, paymentId: p1, signature: sign(SECRET, `${o1}|${p1}`) });
assert.equal(r.body.licence.key, key);
const ev = JSON.stringify({ event: "order.paid", payload: { order: { entity: orders.get(o1) }, payment: { entity: payments.get(p1) } } });
assert.equal((await call("/rzp/webhook", ev, { "X-Razorpay-Signature": "bad" })).status, 400);
assert.equal((await call("/rzp/webhook", ev, { "X-Razorpay-Signature": sign(WH, ev) })).status, 200);
assert.equal([...store.keys()].filter((k) => k.startsWith("lic:")).length, 1);

// 4. a second order for the same account returns the licence instead of charging again
r = await call("/rzp/order", { token: "good" });
assert.equal(r.body.licence.key, key); assert.equal(r.body.orderId, undefined);

// 5. restore / activate / validate
assert.equal((await call("/licence/restore", { token: "good" })).body.licence.key, key);
assert.equal((await call("/licence/restore", { token: "other" })).status, 404);
assert.equal((await call("/licence/activate", { token: "good", key: key.toLowerCase() })).body.licence.key, key);
assert.equal((await call("/licence/activate", { token: "other", key })).status, 403);
assert.deepEqual((await call("/licence/validate", { key })).body, { valid: true, status: "active", email: "pallav@example.com" });
assert.equal((await call("/licence/validate", { key: "KB-NOPE" })).body.valid, false);

// 6. pending UPI: verify says pending; the webhook issues the licence later
r = await call("/rzp/order", { token: "other" });
const o2 = r.body.orderId;
const p2 = pay(o2, "created");
r = await call("/rzp/verify", { token: "other", orderId: o2, paymentId: p2, signature: sign(SECRET, `${o2}|${p2}`) });
assert.equal(r.status, 409); assert.equal(r.body.code, "PENDING");
payments.get(p2).status = "captured"; orders.get(o2).status = "paid";
const ev2 = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: Object.assign({ notes: orders.get(o2).notes }, payments.get(p2)) } } });
assert.equal((await call("/rzp/webhook", ev2, { "X-Razorpay-Signature": sign(WH, ev2) })).status, 200);
const key2 = (await call("/licence/restore", { token: "other" })).body.licence.key;
assert.ok(key2 && key2 !== key);

// 7. authorised-but-not-captured payments are captured on verify
store.clear();
r = await call("/rzp/order", { token: "good" });
const o3 = r.body.orderId, p3 = pay(r.body.orderId, "authorized");
r = await call("/rzp/verify", { token: "good", orderId: o3, paymentId: p3, signature: sign(SECRET, `${o3}|${p3}`) });
assert.equal(r.status, 200); assert.equal(payments.get(p3).status, "captured");
const key3 = r.body.licence.key;

// 8. refund locks it
const ev3 = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: p3 } } } });
await call("/rzp/webhook", ev3, { "X-Razorpay-Signature": sign(WH, ev3) });
assert.equal((await call("/licence/validate", { key: key3 })).body.status, "refunded");
assert.equal((await call("/licence/restore", { token: "good" })).status, 404);

// 9. CORS: unknown origins get no allow header
r = await call("/licence/validate", { key: key3 }, { Origin: "https://evil.example" });
assert.equal(r.cors, null);

console.log("payments worker: all tests passed");
