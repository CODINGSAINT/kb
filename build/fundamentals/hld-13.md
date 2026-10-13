=== hld-security | HLD | Security for system design: authn, authz, TLS and secrets ===
Security in a system-design interview is not cryptography trivia; it is putting the right control at the right layer. You need to say who is calling (authentication), what they may do (authorization), how data is protected on the wire and on disk, where secrets live, and how the system resists abuse. Each idea below comes with a concrete mistake and the better design.

## 1. Authentication vs. authorization

**Definition:** Authentication (authn) proves *who* is calling; authorization (authz) decides *what* that caller may do.

At an airport, showing your passport is authentication; your boarding pass deciding which plane and seat you may use is authorization. A **principal** is whoever was authenticated: a user, a service, a device or an API client. Two guiding rules: **least privilege** (give each principal only what it needs) and **zero trust** (being inside the network proves nothing; every call is checked).

### The problem

```text
Internet -> API gateway (checks login) -> order-service (trusts everything)
Attacker inside the VPC, or a compromised pod -> calls order-service directly
-> no checks at all
```

The team treated "inside the network" as "trusted".

### Better design

```text
Gateway:  is the token valid? does it carry the right scope?   (coarse)
Service:  does THIS user own THIS order?                        (fine-grained)
Database: every query filtered by tenant_id                     (safety net)
Service-to-service: mutual TLS, so each call proves which service sent it
```

Several independent layers (defence in depth) mean one mistake is not a breach.

**Key takeaway:** Authenticate every hop and authorize at the layer that knows the resource.

---

## 2. Sessions vs. tokens

**Definition:** With a session, the server stores login state and the client holds a random session ID; with a self-contained token, the client holds signed claims that any server can verify without a lookup.

A session ID is like a cloakroom ticket: worthless on its own, the cloakroom has your coat. A token is like a signed letter of introduction: anyone who trusts the signature can read it, but you cannot easily take it back once issued.

### The problem

A browser single-page app stores a long-lived token in `localStorage`. One cross-site scripting (XSS) bug, where attacker JavaScript runs on your page, reads the token and sends it away. The attacker uses it for days, and there is no way to log them out.

### Better design

```text
Browser --(cookie: sid; HttpOnly; Secure; SameSite=Lax)--> BFF (backend-for-frontend)
BFF holds the OAuth tokens server-side --(Bearer token)--> APIs
```

`HttpOnly` stops JavaScript reading the cookie, `Secure` forces HTTPS, and `SameSite` limits cross-site request forgery (CSRF). Tokens never touch browser JavaScript. APIs, mobile apps and service-to-service calls use short-lived tokens.

| | Session | Token (JWT) |
|---|---|---|
| Validation | Look up the session store (Redis) | Verify signature locally |
| Revocation | Instant: delete the session | Hard until it expires |
| Best for | Browser apps | APIs, mobile, services |

**Key takeaway:** Sessions for browsers (easy logout), short-lived tokens for APIs.

---

## 3. JWT and its pitfalls

**Definition:** A JWT (JSON Web Token) is `header.payload.signature`, each part base64url-encoded, where the signature proves the issuer created it and nobody changed it.

The payload holds **claims**: `iss` (issuer), `sub` (subject, the user), `aud` (audience, the API it is for), `exp` (expiry), and scopes. The payload is **encoded, not encrypted**: anyone holding the token can read it.

### The problem

```java
// decodes the payload and trusts it, never checking the signature
String userId = decodeBase64(token.split("\\.")[1]).get("sub");
```

Common mistakes: not verifying the signature; accepting `"alg":"none"`; letting an attacker switch RS256 to HS256 and "sign" with your public key (algorithm confusion); not checking `aud`, so a token minted for the reporting API works on the payments API; putting secrets or personal data in the payload; and 24-hour tokens with no way to revoke them.

### Better design

```yaml
spring.security.oauth2.resourceserver.jwt:
  issuer-uri: https://auth.example.com/realms/prod   # fetches public keys (JWKS), checks iss
  audiences: orders-api                              # rejects tokens meant for other APIs
```

Validate in this order: allow-listed algorithm, signature using the key named by `kid` from the issuer's cached **JWKS** (published public keys), then `exp`/`nbf` with a little clock-skew allowance, then `iss` and `aud`, and only then read scopes. Prefer RS256 or ES256 (private key signs, public key verifies) over HS256 when many services verify. Keep access tokens short (5-15 minutes) and use **refresh tokens** that are rotated on every use and can be revoked; for emergencies, keep a denylist of token IDs (`jti`) in Redis.

**Trade-offs:**
- Short tokens mean more refresh traffic; a denylist adds back a lookup.

**Key takeaway:** Verify signature, algorithm, expiry, issuer and audience; keep JWTs short-lived and secret-free.

---

## 4. OAuth2 and OpenID Connect

**Definition:** OAuth 2.0 lets a client app get an **access token** to call an API on a user's behalf (or its own); OpenID Connect (OIDC) adds an **ID token** that says who the user is.

OAuth is a valet key: it lets the valet drive your car, not open the boot. OAuth alone answers "what may this app access"; OIDC answers "who logged in". The **authorization server** (identity provider, IdP) such as Keycloak, Okta, Entra ID or Cognito issues the tokens.

### The problem

A mobile app asks users to type their Google password into the app itself (the old "password grant"). The app now holds a password it should never see, and a malicious app could steal it.

### Better design

```text
1. App makes code_verifier (random) and code_challenge = SHA-256(verifier)
2. Redirect user to IdP /authorize?...&code_challenge=..&state=xyz
3. User logs in at the IdP (with MFA); IdP redirects back with ?code=AUTH_CODE&state=xyz
4. App POSTs code + code_verifier to IdP /token
5. IdP returns access_token (+ refresh_token, + id_token for OIDC)
6. App calls API: Authorization: Bearer <access_token>
```

This is **Authorization Code + PKCE**. PKCE (proof key for code exchange) means a stolen code is useless without the verifier, and current best practice requires it for all clients. `state` blocks CSRF on the redirect. For service-to-service calls with no user, use the **client credentials** flow: the service authenticates as itself and gets its own token. Do not propose the implicit or password grants; both are deprecated.

**Key takeaway:** Users: authorization code + PKCE. Services: client credentials. OIDC adds identity on top.

---

## 5. RBAC and ABAC

**Definition:** RBAC (role-based access control) grants permissions through roles; ABAC (attribute-based) decides from attributes of the user, resource, action and context.

RBAC: "ADMIN can delete products". ABAC: "allow if user.department == document.department and it is business hours". For sharing models such as Google Drive, **ReBAC** (relationship-based, as in Google Zanzibar and open-source SpiceDB or OpenFGA) asks "is Alice a viewer of this folder through her group?".

### The problem

A team uses only roles: `REGION_NORTH_MANAGER`, `REGION_SOUTH_MANAGER`, `REGION_NORTH_MANAGER_READONLY`... soon there are 400 roles (role explosion), and nobody knows who can do what.

### Better design

```java
@PreAuthorize("hasRole('MANAGER') and @authz.sameRegion(authentication, #reportId)")
public Report getReport(String reportId) { ... }
```

Use a few roles for broad capability and attributes (region, tenant, owner) for the fine rule. Complex policies can move to a policy engine such as OPA or Cedar.

**Trade-offs:**
- ABAC is very expressive but harder to audit than a role list.

**Key takeaway:** Roles for coarse capability, attributes or relationships for per-resource rules.

---

## 6. API keys and request signing

**Definition:** An API key is a long random secret that identifies a client *application*; request signing has the client compute an HMAC (a keyed hash) over the request so the server can detect tampering and replay.

An API key is a bearer secret: whoever holds it is trusted. Signing proves the request was made by the secret holder and was not changed in transit.

### The problem

A partner integration stores API keys in plain text in the database, and webhook calls carry no signature. A database leak exposes every key, and anyone who learns the webhook URL can send fake "payment succeeded" events.

### Better design

```text
API keys: random from a CSPRNG, prefixed (sk_live_...) so secret scanners spot leaks,
          store only SHA-256(key) + last 4 chars, show once, scoped, rotatable

Signing:  to_sign = METHOD \n PATH \n TIMESTAMP \n SHA256(body)
          X-Signature = Base64(HMAC_SHA256(secret, to_sign))
          reject if |now - timestamp| > 5 min   (replay protection)
```

```java
boolean ok = MessageDigest.isEqual(expectedSig, receivedSig);  // constant-time compare
```

Stripe and GitHub webhooks and AWS Signature V4 all follow this pattern.

**Key takeaway:** Hash API keys at rest; sign high-value requests and webhooks with HMAC plus a timestamp.

---

## 7. TLS and mTLS

**Definition:** TLS encrypts traffic and proves the server's identity with a certificate; mutual TLS (mTLS) makes the client present a certificate too.

TLS 1.3 gives confidentiality, integrity and server authentication with a one-round-trip handshake. With mTLS, the server knows exactly which service is calling, not just that "someone inside the network" is.

### The problem

```text
Internet --TLS--> Load balancer --plain HTTP--> services --plain--> database
```

TLS ends at the load balancer. Anyone who gets a foothold inside the network can read card data and tokens in plain text, and any pod can call the payment service.

### Better design

```text
Internet --TLS 1.3--> LB --TLS--> order-svc --mTLS--> payment-svc --TLS--> DB
Mesh (Istio/Linkerd) or SPIFFE issues each workload a short-lived certificate:
  spiffe://prod/ns/payments/sa/payment-service   (rotated every few hours)
Policy: only order-service may call POST /payments
```

The sidecar proxies handle certificates automatically. Add HSTS so browsers always use HTTPS, and automate certificate renewal; expired certificates cause real outages.

**Key takeaway:** TLS on every hop; mTLS for service identity inside the network.

---

## 8. Secrets management

**Definition:** Secrets management means storing passwords, keys and tokens in a dedicated, access-controlled, audited store and delivering them to services at runtime.

Secrets include database passwords, API keys, signing keys and OAuth client secrets. They must never live in code.

### The problem

```properties
# application.properties, committed to Git
spring.datasource.password=Pr0d!Passw0rd
payment.api.key=sk_live_51Hx...
```

Everyone with repository access, every old commit and every container image now holds production credentials, forever.

### Better design

```text
Service authenticates with its platform identity (Kubernetes service account, IAM role)
-> Vault / AWS Secrets Manager / Azure Key Vault
-> returns the secret at startup (spring-cloud-vault), refreshed on rotation
Vault "dynamic secrets": a unique DB login per instance, expiring in ~1 hour
```

Run secret scanning in CI, rotate automatically, and allow two valid versions during a switchover.

**Key takeaway:** No secrets in Git, images or logs; fetch them at runtime and rotate them.

---

## 9. Encryption at rest

**Definition:** Encryption at rest protects stored data; **envelope encryption** encrypts data with a data key and encrypts that data key with a master key kept in a KMS (key management service).

Disk encryption only protects against a stolen disk. Sensitive fields (national IDs, health data) also need application-level encryption so a database dump alone is useless.

### The problem

The team encrypts every record by sending it to the KMS. Large files are slow, KMS request limits are hit, and rotating the master key would mean re-encrypting terabytes.

### Better design

```text
1. App: KMS.GenerateDataKey(master key "pii") -> plaintext DEK + encrypted DEK
2. App encrypts data locally with the DEK (AES-256-GCM), then forgets the plaintext DEK
3. Store ciphertext + encrypted DEK together
4. Read: send encrypted DEK to KMS (checked + audited) -> DEK -> decrypt locally
```

Bulk data never goes to the KMS, the master key never leaves its hardware security module (HSM), and rotating the master key only re-wraps small data keys. Per-tenant keys allow **crypto-shredding**: delete a tenant's key and its data, backups included, becomes unreadable. For card numbers, **tokenization** (store a token, keep the real number in an isolated vault) shrinks PCI scope.

**Key takeaway:** Data key encrypts data, master key encrypts data keys; the master key stays in the KMS.

---

## 10. Password hashing

**Definition:** Passwords are stored as the output of a slow, salted, one-way hash, never as plain text or reversible encryption.

A **salt** is a random value stored per password so identical passwords hash differently. "Slow" is the point: it makes guessing expensive.

### The problem

```text
password_hash = SHA-256(password)
GPU cracking rigs try billions of SHA-256 guesses per second
-> leaked table, most common passwords cracked within hours
```

Fast hashes are built for speed, which is exactly what an attacker wants.

### Better design

```java
PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();
String stored = encoder.encode(rawPassword);   // "{bcrypt}$2a$10$..." with salt built in
boolean ok = encoder.matches(rawPassword, stored);
```

Use **Argon2id** (memory-hard; OWASP suggests at least 19 MiB of memory and 2 iterations) or **bcrypt** (cost 10 or more; note its 72-byte input limit). Tune so one hash takes roughly 100-500 ms, and re-hash on login when you raise the cost. The `{id}` prefix lets you migrate algorithms gradually. Add login rate limits, MFA and ideally passkeys.

**Key takeaway:** Argon2id or bcrypt with a salt, never a fast hash.

---

## 11. Common API risks

**Definition:** The OWASP API Security Top 10 lists the most frequent API weaknesses; a few appear in almost every design.

The most important is **BOLA** (broken object level authorization, also called IDOR): the API checks that you are logged in but not that the object is yours.

### The problem

```http
GET /api/orders/1002
Authorization: Bearer <token for user 42>
-> 200 OK, returns user 77's order
```

Other classics: **mass assignment** (a `PATCH` body containing `"role":"admin"` is bound straight onto the entity), **unrestricted resource consumption** (`?pageSize=1000000`), and **SSRF** (server-side request forgery: a "fetch this image URL" feature is pointed at `http://169.254.169.254/`, the cloud metadata endpoint, and leaks credentials).

### Better design

```java
@GetMapping("/{id}")
@PreAuthorize("@orderAuthz.isOwner(authentication, #id)")   // object-level check
OrderResponse get(@PathVariable String id) { ... }
```

Check ownership and tenant on every object access *in the service*, because the gateway does not know who owns order 1002. Bind requests to explicit DTOs, never entities. Cap page sizes, payload sizes and query cost. For user-supplied URLs, allow-list destinations and block private and link-local IP ranges. Use parameterised queries against SQL injection.

**Key takeaway:** Object-level authorization lives in the service; validate and cap every input.

---

## 12. Rate limits and WAF

**Definition:** A WAF (web application firewall) at the edge filters malicious HTTP traffic; rate limits cap how fast any one client can call you.

Volumetric DDoS floods are absorbed by CDN and scrubbing networks (Cloudflare, AWS Shield). Application-layer attacks look like real requests, so the WAF applies managed rules (such as the OWASP Core Rule Set), bot detection and per-IP limits.

### The problem

The login endpoint has no limits. An attacker replays millions of leaked email/password pairs (credential stuffing), and the OTP endpoint is abused to send thousands of paid SMS messages.

### Better design

```text
CDN/WAF:  bot score, managed rules, per-IP limits, origin reachable only from CDN
Gateway:  per user / API key limits, 429 + Retry-After
Login:    per account AND per IP limits, CAPTCHA after N failures, fail closed
Autoscale with a cap, so an attack does not become a surprise bill
```

**Key takeaway:** Block cheap attacks at the edge and protect login, OTP and search endpoints specifically.

---

## In an HLD interview

- **API Gateway:** JWT validation with cached JWKS, scope checks, hashed API keys, rate limits, WAF in front, mTLS to services.
- **Payment System:** tokenized card data, HMAC-signed webhooks, idempotency keys, envelope encryption, an append-only audit log, fail-closed limits on card attempts.
- **Dropbox / Google Drive:** ReBAC sharing (Zanzibar style), short-lived pre-signed download URLs, per-user keys, virus scanning of uploads.
- **Chat/WhatsApp, Amazon E-commerce, BookMyShow:** end-to-end encryption for chat (the server routes ciphertext only); BFF sessions and BOLA checks on orders and bookings.
- **What to say:** "Users log in through OIDC with authorization code + PKCE; the gateway validates short-lived JWTs, each service enforces ownership, services talk over mTLS, and secrets come from Vault, never from config files."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Authn vs authz | Who vs what | Is every hop checked, not just the edge? |
| Sessions vs tokens | Server state vs signed claims | How do I log someone out? |
| JWT | Signed, readable claims | Do I check alg, signature, exp, iss and aud? |
| OAuth2 / OIDC | Delegated access + identity | Is this a user flow (PKCE) or a service flow? |
| RBAC / ABAC | Roles vs attributes | Am I heading for role explosion? |
| API keys / signing | Bearer secret vs HMAC proof | Are keys hashed, and can requests be replayed? |
| TLS / mTLS | Encrypt and identify | Is any hop plain text? |
| Secrets | Runtime store, rotated | Is any secret in Git or an image? |
| Encryption at rest | Envelope with KMS | Can I rotate keys without re-encrypting everything? |
| Password hashing | Slow and salted | Could a GPU crack this quickly? |
| API risks | BOLA, mass assignment, SSRF | Does the service check who owns this object? |
| Rate limits / WAF | Stop abuse at the edge | Are login and OTP protected? |

## Final memory aid

- **Authn = who, authz = what;** zero trust, least privilege
- **Browser:** BFF + HttpOnly cookie; **APIs:** short-lived JWT
- **JWT:** verify alg, signature, exp, iss, aud; payload is not secret
- **OAuth:** code + PKCE for users, client credentials for services
- **mTLS** inside, **TLS 1.3** everywhere
- **Secrets** in Vault/KMS; **envelope encryption** for data
- **Passwords:** Argon2id or bcrypt, never SHA-256
- **BOLA** is fixed in the service, not the gateway
