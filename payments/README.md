# KB payments (Razorpay)

KB Pro is sold two ways, picked automatically by where the buyer is (they can switch in the dialog):

| | India | Everywhere else |
|---|---|---|
| Provider | **Razorpay**: UPI, cards, netbanking in ₹ | **Lemon Squeezy**: cards, PayPal; merchant of record, handles VAT/GST abroad |
| Server | this Worker (free Cloudflare tier) | none: the browser uses Lemon Squeezy's public licence API |
| Buyer gets | unlocked straight away on their Google account; *Restore purchase* on other devices | a licence key by email, pasted once |
| Refunds | webhook locks the licence | weekly re-check locks it |

Lemon Squeezy setup is in the main README (*KB Pro: one-time payment*). This page covers Razorpay.

## How it works

```
KB page ──(Google token)──▶ /rzp/order ──▶ Razorpay: create order (amount fixed here, buyer email in notes)
   │                                        
   ├── Razorpay Checkout (UPI / card) ──▶ payment
   │
   └──(order id, payment id, signature)──▶ /rzp/verify ──▶ HMAC check with your secret, confirms the order is paid,
                                                            issues "KB-XXXXX-…" licence → saved in the buyer's Drive settings
Razorpay ──▶ /rzp/webhook   order.paid: issues the licence if the buyer closed the tab (or UPI completed late)
                            refund.processed: locks it
```

The licence is tied to the Google account that paid. The Worker checks every Google token against **your**
OAuth client ID, so a token from another app can't be used.

## Set up (about 20 minutes)

**1. Razorpay account.** Sign up at razorpay.com and finish KYC (business details, PAN, bank account).
Razorpay reviews the website before turning on live payments. The site must have these pages, linked from the footer:
*Terms & conditions, Privacy policy, Refund & cancellation policy, Contact us*, and *Shipping/Delivery* (for a digital product:
"delivered instantly online after payment"). The KB site doesn't have them yet.

Everything below works in **Test mode** straight away, before activation.

**2. API keys.** Dashboard → Account & Settings → API keys → generate. You get a `key_id` (public, `rzp_test_…`) and a `key_secret` (secret).

**3. Cloudflare Worker.**

```powershell
cd payments
npx wrangler login
npx wrangler kv namespace create LICENCES        # paste the printed id into wrangler.toml
# edit wrangler.toml: RAZORPAY_KEY_ID, PRICE_PAISE (99900 = ₹999), GOOGLE_CLIENT_ID
npx wrangler secret put RAZORPAY_KEY_SECRET      # paste key_secret
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET  # make up a long random string; use it in step 4 too
npx wrangler deploy                              # prints https://kb-payments.<you>.workers.dev
```

Optional: serve it at `https://pay.codingsaint.com` (Workers → your worker → Settings → Domains & Routes), if codingsaint.com's DNS is on Cloudflare.

**4. Webhook.** Razorpay Dashboard → Account & Settings → Webhooks → *Add new*:
URL `https://kb-payments.<you>.workers.dev/rzp/webhook`, secret = the one from step 3,
events **order.paid** and **refund.processed**. Test mode and live mode each have their own webhooks: add it in both.

**5. Turn it on in the site.** In `site.config.json`:

```json
"pro": {
  "enabled": true,
  "razorpay": { "enabled": true, "apiUrl": "https://kb-payments.<you>.workers.dev", "price": "₹999" }
}
```

Keep `price` in step with `PRICE_PAISE`; the Worker's amount is the one actually charged. Commit and push.

**6. Test.** On the site, sign in with Google, open KB Pro, pay with Razorpay's test UPI ID `success@razorpay`
(or card `4111 1111 1111 1111`, any future date, any CVV). The topic unlocks. Refund it from the dashboard:
within a week (or after *Restore purchase*) it locks again.

**7. Go live.** After Razorpay activates the account: generate live keys, set `RAZORPAY_KEY_ID = "rzp_live_…"`,
`wrangler secret put RAZORPAY_KEY_SECRET` with the live secret, add the live webhook, `wrangler deploy`.

## Run the tests

```powershell
cd payments
node test.js        # Razorpay, Google and KV faked; no network
```

## Looking things up

Every licence is in the KV namespace: `lic:<key>` (the record), `email:<email>`, `order:<order id>`, `pay:<payment id>`.
Cloudflare dashboard → Workers → KV → LICENCES shows them. To move a licence to another Google account, edit the
record's `email` and add an `email:<new>` entry with the key.

If someone pays twice (two tabs), they keep one licence and the Worker logs the duplicate order
(`npx wrangler tail`); refund the second payment from the Razorpay dashboard. Refunding a duplicate doesn't lock their licence.

## Notes

- GST: as an Indian business you invoice GST on Indian sales yourself (Razorpay doesn't). Lemon Squeezy handles tax for its sales.
- Google Play: inside the Android app there's no buy button (Play's rules); *Restore purchase* and pasting a key work there.
- Referral codes (`?aff=CODE`) are saved on the Razorpay order's notes; Lemon Squeezy pays commissions through its affiliate programme.
