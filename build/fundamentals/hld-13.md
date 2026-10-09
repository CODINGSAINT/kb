=== hld-security | HLD | Security for system design: authn, authz, TLS and secrets ===
Security in a system-design interview is not about cryptography trivia; it is about putting the right control at the right layer: who is calling (authentication), what they may do (authorization), how data is protected in transit and at rest, where secrets live, and how the system resists abuse. This chapter covers sessions vs tokens, JWT and its pitfalls, OAuth2 and OIDC flows, RBAC/ABAC/ReBAC, API keys and request signing, TLS and mTLS, secrets and envelope encryption, password hashing, the OWASP API risks, DDoS protection, audit logging and compliance basics, with a Spring Security resource server example.

## Core vocabulary
- **Authentication (authn):** proving identity ("this is user 42", "this is the billing service").
- **Authorization (authz):** deciding whether an authenticated principal may perform an action on a resource.
- **Principal:** the authenticated entity: user, service, device or API client.
- **Defence in depth:** multiple independent layers (edge, gateway, service, data) so one failure isn't a breach.
- **Least privilege:** every identity gets only the permissions it needs, for only as long as it needs them.
- **Zero trust:** the network location grants nothing; every request is authenticated and authorized, including service-to-service calls inside the VPC.

## Authentication for users
### Sessions vs tokens
| | Server-side session | Self-contained token (JWT) |
|---|---|---|
| What the client holds | Opaque random session ID in a cookie | Signed token containing claims |
| Validation | Look up the session store (Redis) on each request | Verify signature and expiry locally, no lookup |
| Revocation | Instant: delete the session | Hard: valid until expiry unless you add a denylist |
| Scaling | Needs a shared session store | Stateless; any service can verify |
| Size | ~32 bytes | 500 bytes to several KB on every request |
| Best for | Browser apps on one domain (BFF) | APIs, mobile clients, service-to-service, federated systems |

Many modern architectures combine them: the browser talks to a **Backend-for-Frontend** using an `HttpOnly; Secure; SameSite` session cookie, and the BFF holds the OAuth tokens and calls APIs with them. Tokens never touch browser JavaScript, which removes the main XSS token-theft risk.

### Cookie hygiene
`Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`. `HttpOnly` blocks JavaScript access, `Secure` forces HTTPS, `SameSite` mitigates CSRF; add CSRF tokens for state-changing requests when cookies authenticate. Rotate the session ID on login (prevents session fixation) and expire idle sessions.

### JWT structure
A JWT is `base64url(header).base64url(payload).base64url(signature)`:
```
header:  {"alg":"RS256","kid":"2026-10-key-1","typ":"JWT"}
payload: {"iss":"https://auth.example.com","sub":"user_8812","aud":"orders-api",
          "exp":1760015400,"iat":1760014500,"nbf":1760014500,
          "jti":"8f1c...","scope":"orders:read orders:write","tenant":"acme"}
signature: RS256(base64url(header) + "." + base64url(payload), privateKey)
```
- The payload is **encoded, not encrypted**: anyone can read it. Never put secrets or sensitive PII in it (use JWE if you must encrypt).
- **Signing algorithms:** HS256 uses a shared secret (every verifier can also mint tokens, so use it only inside one trust boundary); RS256/ES256/EdDSA use a private key to sign and public keys to verify, which is the right choice when many services verify. The issuer publishes public keys at a **JWKS** endpoint, and the `kid` header selects the key, enabling key rotation without downtime.

### Validating a JWT correctly
1. Parse the header and **allow-list the algorithm** (reject `alg: none`, and never let a token switch RS256 to HS256 using the public key as an HMAC secret: the classic algorithm-confusion attack).
2. Fetch the key by `kid` from a cached JWKS; verify the signature.
3. Check `exp`, `nbf`, `iat` with a small clock-skew allowance (30–60 s).
4. Check `iss` is your trusted issuer and `aud` is **this** API (a token minted for the reporting API must not work on the payments API).
5. Only then read scopes and claims for authorization.

### Revocation and lifetimes
Stateless tokens cannot be "logged out". Mitigations:
- **Short-lived access tokens** (5–15 minutes) plus **refresh tokens** (hours to days) stored securely; revoke the refresh token to end the session within one access-token lifetime.
- **Refresh token rotation:** every refresh issues a new refresh token and invalidates the old one; reuse of an old one signals theft and revokes the whole family.
- **Denylist by `jti`** in Redis with TTL equal to the remaining lifetime, checked at the gateway, for urgent revocation (compromised account, employee offboarding).
- **Token introspection** (opaque tokens validated by calling the authorization server) when instant revocation outweighs the per-request lookup cost; cache the result briefly.
- **Sender-constrained tokens** (DPoP, mTLS-bound tokens) so a stolen token is useless without the client's private key; increasingly common in financial-grade APIs.

## OAuth 2.0 and OpenID Connect
**OAuth 2.0** is a delegation framework: a **client** gets an **access token** from an **authorization server** to call a **resource server** on behalf of a **resource owner** (or itself). It answers "what may this client access", not "who is the user". **OpenID Connect (OIDC)** is an identity layer on top: it adds an **ID token** (a JWT about the user's authentication: `sub`, `email`, `auth_time`, `nonce`), a `userinfo` endpoint and discovery metadata (`/.well-known/openid-configuration`).

### Authorization Code + PKCE (users, all client types)
```
 Browser/App            Authorization Server (IdP)              Client backend / API
     │ 1. generate code_verifier (random), code_challenge = SHA256(verifier)
     │ 2. redirect ──> /authorize?response_type=code&client_id=..&redirect_uri=..
     │                  &scope=openid profile orders:read&state=xyz&code_challenge=..&code_challenge_method=S256
     │ 3. user logs in (+ MFA), consents
     │ <── 4. redirect to redirect_uri?code=AUTH_CODE&state=xyz  (check state matches)
     │ 5. POST /token  code=AUTH_CODE, code_verifier, redirect_uri ──>
     │ <── 6. access_token (+ refresh_token, + id_token if OIDC)
     │ 7. call API with  Authorization: Bearer <access_token> ──────────────────────>
```
- **PKCE** stops an attacker who intercepts the authorization code (malicious app on a phone, leaked logs) from redeeming it, because they lack the `code_verifier`. OAuth 2.1 makes PKCE mandatory for all clients.
- `state` prevents CSRF on the redirect; `nonce` binds the ID token to the request.
- Exact-match `redirect_uri` registration prevents tokens being sent to attacker URLs.
- **Deprecated:** the Implicit flow (tokens in URL fragments) and Resource Owner Password Credentials (app collects the user's password). Don't propose them.

### Client Credentials (service-to-service)
A service authenticates as itself (client ID + secret, or better a signed JWT assertion or mTLS) and receives an access token with its own scopes. No user involved: batch jobs, backend integrations, microservices calling each other.

### Other flows worth naming
- **Device Authorization Grant:** TVs and CLIs show a code that the user enters on a phone.
- **Token Exchange (RFC 8693):** a service swaps the user's token for a downstream token with narrower audience and scopes, preserving "acting on behalf of user X" across hops without forwarding the original token everywhere.

### SSO and federation
**Single sign-on** lets one login at an identity provider (Okta, Entra ID, Keycloak, Auth0, Cognito) grant access to many applications. Enterprises federate via **SAML 2.0** (XML assertions, common for legacy enterprise apps) or **OIDC** (modern, JSON/JWT). **SCIM** provisions and deprovisions users automatically. Add **MFA** (TOTP, push, and phishing-resistant WebAuthn/passkeys) at the IdP so every app benefits.

## Authorization
### Models
| Model | Decision based on | Example rule | Strengths | Weaknesses |
|---|---|---|---|---|
| RBAC | Roles assigned to users | `ADMIN` can delete products | Simple, auditable | Role explosion for fine-grained or per-resource rules |
| ABAC | Attributes of subject, resource, action, environment | Allow if `user.dept == doc.dept` and time in business hours | Very expressive, contextual | Harder to reason about and audit |
| ReBAC | Relationships in a graph | Alice can view doc D because she's in group G which is editor of folder F containing D | Natural for sharing (Drive, GitHub orgs) | Needs a dedicated, consistent relationship store |

### Zanzibar and ReBAC at scale
Google Zanzibar stores relation tuples like `doc:readme#viewer@group:eng#member` and answers `check(user, relation, object)` by graph traversal, at millions of checks per second with low latency. It handles the **new enemy problem** (a check must not use permissions older than a content change, so ACL removals take effect before new sensitive content is visible) with consistency tokens ("zookies"). Open-source descendants: SpiceDB, OpenFGA, Ory Keto. Mention it for Google Drive, Dropbox, Notion or GitHub-style sharing.

### Where to enforce
- **Gateway:** coarse checks: is the token valid, does it have the `orders:*` scope, is this tenant active. Cheap and central.
- **Service:** fine-grained, resource-level checks ("does user 42 own order 991?"). Only the service knows the resource, so **object-level authorization must live in the service** (or call a policy engine).
- **Data layer:** tenant isolation as a safety net: row-level security in PostgreSQL, a mandatory `tenant_id` predicate in every repository, per-tenant encryption keys or schemas.
- **Policy engines:** externalise rules to OPA/Rego, Cedar (AWS Verified Permissions) or a Zanzibar-style service, evaluated as a sidecar or library for low latency, with decisions logged.

## Machine and API client authentication
### API keys
Long random secrets that identify a client application. Good for developer platforms and simple partner integrations. Rules:
- Generate with a CSPRNG, prefix them (`sk_live_...`) so leaks are detectable by secret scanners.
- Store only a **hash** (SHA-256 is fine for high-entropy keys) plus the last 4 characters for display; show the key once at creation.
- Scope keys (read-only vs read-write), support multiple active keys for rotation, and rate-limit per key.
- An API key identifies an app, not a user, and travels in a header; it is a bearer secret, so TLS is mandatory.

### HMAC request signing
For high-value APIs and webhooks, the client signs the request so it can't be tampered with or replayed:
```
string_to_sign = METHOD + "\n" + PATH + "\n" + SORTED_QUERY + "\n" + TIMESTAMP + "\n" + SHA256(body)
signature      = Base64(HMAC_SHA256(secret, string_to_sign))
headers: X-Key-Id, X-Timestamp, X-Signature  (server rejects if |now - timestamp| > 5 min)
```
```java
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secret, "HmacSHA256"));
byte[] expected = mac.doFinal(stringToSign.getBytes(StandardCharsets.UTF_8));
boolean ok = MessageDigest.isEqual(expected, Base64.getDecoder().decode(signatureHeader)); // constant time
```
The timestamp (plus an optional nonce cache) prevents replay; constant-time comparison prevents timing attacks. AWS SigV4, Stripe and GitHub webhooks all work this way.

## Encryption in transit: TLS and mTLS
- **TLS 1.3** gives confidentiality, integrity and server authentication with a 1-RTT handshake (0-RTT resumption, which is replayable, so only for idempotent requests). Use it everywhere, including internal traffic.
- **Termination points:** at the CDN/load balancer (re-encrypt to backends, or you have plaintext inside the network), at the gateway, or end-to-end. In zero-trust designs, traffic is encrypted on every hop.
- **HSTS** forces browsers to use HTTPS; automate certificates (ACME / Let's Encrypt, cert-manager) and monitor expiry, since expired certificates cause real outages.
- **mTLS:** both sides present certificates, so the server knows exactly which service is calling. It is the backbone of service-to-service authentication.

### Service mesh identity
Managing certificates for thousands of pods by hand is impossible. A service mesh (Istio, Linkerd) or SPIFFE/SPIRE issues each workload a short-lived certificate encoding its identity (`spiffe://prod.example.com/ns/payments/sa/payment-service`), rotates it automatically (hours), and the sidecar proxies enforce mTLS transparently. Authorization policies then say "only `order-service` may call `POST /payments`". Combine with user context propagated as a JWT so services know both **which service** and **on behalf of which user**.

## Secrets management
Secrets: DB passwords, API keys, signing keys, OAuth client secrets, encryption keys.
- **Never** in source code, container images, plain environment files committed to Git, or logs. Run secret scanning in CI.
- Use a **secrets manager**: HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault. Services authenticate with their platform identity (Kubernetes service account, IAM role), not with another secret.
- **Dynamic secrets:** Vault can create a unique, short-lived database credential per service instance and revoke it at lease expiry; a leaked credential is worthless within an hour.
- **Rotation:** automate it; support two valid versions during the switchover.
- Spring: `spring-cloud-vault` or `spring-cloud-aws-secrets-manager` loads secrets as properties at startup and can refresh them.

## Encryption at rest and envelope encryption
Disk- or volume-level encryption (EBS, managed DB encryption) protects against stolen disks but not against an attacker with application or DB access. For sensitive fields (national IDs, card data, health data), add **application-level** or column-level encryption.

**Envelope encryption** is how KMS-based systems scale:
```
1. App asks KMS: GenerateDataKey(keyId = CMK "pii-key")
2. KMS returns: plaintext DEK + DEK encrypted under the CMK (the CMK never leaves the HSM)
3. App encrypts data locally with the DEK (AES-256-GCM), then discards the plaintext DEK
4. Store: ciphertext + encrypted DEK side by side
5. Decrypt: send encrypted DEK to KMS (authorised + audited) -> plaintext DEK -> decrypt locally
```
Why: bulk data never goes to KMS (fast, no size limits), the master key lives in an HSM and is never exposed, every decrypt is access-controlled and audited, and **rotating the master key** only re-wraps small DEKs rather than re-encrypting terabytes. Per-tenant keys enable **crypto-shredding**: delete a tenant's key and all its data becomes unreadable, which helps satisfy deletion requests even in backups.

Use authenticated encryption (AES-GCM, ChaCha20-Poly1305), a unique nonce per encryption, and never invent your own crypto. For searchable encrypted fields, store a keyed hash (HMAC) alongside for equality lookups, or **tokenize** (replace a card number with a token, with the real value in an isolated vault, which shrinks PCI scope dramatically).

## Password storage
- Never store plaintext or reversible encryption, and never use fast hashes (MD5, SHA-256) alone: GPUs try billions per second.
- Use a **slow, salted, memory-hard** algorithm: **Argon2id** (preferred; e.g. 19–64 MB memory, 2–3 iterations), **bcrypt** (cost 12+; note its 72-byte input limit), or **scrypt**; PBKDF2 with high iterations when FIPS compliance requires it.
- Tune cost so a hash takes ~100–500 ms on your servers, and re-hash on login when you raise the cost.
- Unique random salt per password (built into these algorithms); an optional **pepper** (secret key kept in the KMS/HSM) adds protection if only the DB leaks.
- Spring: `PasswordEncoderFactories.createDelegatingPasswordEncoder()` stores `{bcrypt}` / `{argon2}` prefixes so you can migrate algorithms gradually.
- Also: breached-password checks, rate limiting and lockout on login, MFA, and preferably passkeys.

## API threats: OWASP API Security Top 10 highlights
| Risk | What goes wrong | Mitigation |
|---|---|---|
| Broken Object Level Authorization (BOLA/IDOR) | `GET /orders/1002` returns someone else's order | Check ownership/tenant on every object access in the service; non-guessable IDs as defence in depth |
| Broken authentication | Weak tokens, no expiry, credential stuffing | Standard IdP, short-lived tokens, MFA, login rate limits |
| Broken object property level authorization | Mass assignment (`"role":"admin"` in a PATCH), over-exposed fields | Explicit request DTOs and response DTOs; never bind entities directly |
| Unrestricted resource consumption | Huge page sizes, expensive queries, unlimited uploads | Rate limits, pagination caps, payload size limits, timeouts, GraphQL depth limits |
| Broken function level authorization | Regular user calls `/admin/*` endpoints | Deny by default, role checks per endpoint |
| Server-Side Request Forgery (SSRF) | User-supplied URL makes your server fetch `http://169.254.169.254/` (cloud metadata) or internal admin services | Allow-list destinations, resolve and block private/link-local IP ranges (recheck after redirects, beware DNS rebinding), egress proxy, IMDSv2 |
| Security misconfiguration | Verbose errors, open CORS `*` with credentials, default creds | Hardened defaults, config scanning, generic error messages |
| Unsafe consumption of third-party APIs | Trusting partner responses blindly | Validate and sanitise external data, timeouts, TLS |

### Input validation and injection
Validate at the boundary (type, length, range, format, allow-lists) with Bean Validation (`@Valid`, `@Size`, `@Pattern`); use **parameterised queries** (JPA, `PreparedStatement`) to prevent SQL injection; encode output by context to prevent XSS; set a strict Content-Security-Policy; never deserialise untrusted data into arbitrary types; and scan uploads (type sniffing, size limits, malware scanning, serve from a separate domain).

## DDoS protection and WAF
- **Volumetric (L3/L4)** floods are absorbed by anycast networks and scrubbing (Cloudflare, AWS Shield, Akamai). Keep origins hidden and reachable only from the CDN's IP ranges.
- **Application-layer (L7)** attacks look like real requests: a **WAF** applies managed rules (OWASP Core Rule Set), bot detection, challenges (CAPTCHA, proof-of-work), geo and reputation blocking, and per-IP/fingerprint rate limits at the edge.
- **Design-level defences:** cache aggressively, make expensive endpoints authenticated, add rate limiting and load shedding, autoscale with caps (unbounded autoscaling turns an attack into a billing incident), and protect login/OTP/search endpoints specifically.

## Audit logging
Security-relevant events (logins, failed logins, permission changes, admin actions, data exports, access to sensitive records, key usage) go to an **audit log** separate from debug logs:
- Who (principal, on behalf of whom), what (action, resource), when, where (IP, device, service), outcome, and a correlation ID.
- **Append-only and tamper-evident:** write to a separate account or store with object lock (WORM), or hash-chain entries so deletion or modification is detectable.
- Retain per regulation (often 1–7 years), restrict who can read it, and feed it to a SIEM for detection (impossible travel, privilege escalation, mass downloads).

## PII and compliance basics
- **Data minimisation:** don't collect what you don't need; classify data (public, internal, confidential, restricted) and tag columns.
- **GDPR / India DPDP Act:** lawful basis and consent, right of access and erasure (design for deletion: know every store and backup containing a user's data; crypto-shredding helps), data residency constraints that drive region-pinned storage.
- **PCI DSS:** keep card data out of your systems via a payment provider's hosted fields and tokens to minimise scope.
- **HIPAA / SOC 2 / ISO 27001:** access controls, encryption, audit trails, change management.
- **Masking and pseudonymisation:** mask PII in logs and non-production environments; analytics on pseudonymised IDs.

## Spring Security resource server example
A Spring Boot 3 API that validates JWTs from an OIDC provider, enforces scopes at the endpoint and ownership at the object:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.example.com/realms/prod   # discovers JWKS, validates iss
          audiences: orders-api                              # Boot 3.2+: validates aud
```
```java
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())                       // stateless bearer-token API
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/orders/**").hasAuthority("SCOPE_orders:read")
                .requestMatchers(HttpMethod.POST, "/api/orders/**").hasAuthority("SCOPE_orders:write")
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())                 // deny-by-default posture
            .oauth2ResourceServer(o -> o.jwt(jwt -> jwt.jwtAuthenticationConverter(rolesConverter())))
            .build();
    }

    private JwtAuthenticationConverter rolesConverter() {
        var scopes = new JwtGrantedAuthoritiesConverter();      // "scope" claim -> SCOPE_x
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Collection<GrantedAuthority> all = new ArrayList<>(scopes.convert(jwt));
            List<String> roles = jwt.getClaimAsStringList("roles");
            if (roles != null) roles.forEach(r -> all.add(new SimpleGrantedAuthority("ROLE_" + r)));
            return all;
        });
        return converter;
    }
}

@RestController
@RequestMapping("/api/orders")
class OrderController {
    private final OrderService orders;
    OrderController(OrderService orders) { this.orders = orders; }

    @GetMapping("/{id}")
    @PreAuthorize("@orderAuthz.canView(authentication, #id)")   // object-level check (BOLA)
    OrderDto get(@PathVariable String id) { return orders.find(id); }
}

@Component("orderAuthz")
class OrderAuthorization {
    private final OrderRepository repo;
    OrderAuthorization(OrderRepository repo) { this.repo = repo; }

    boolean canView(Authentication auth, String orderId) {
        Jwt jwt = (Jwt) auth.getPrincipal();
        return repo.findOwnerAndTenant(orderId)
                   .map(o -> o.ownerId().equals(jwt.getSubject())
                          && o.tenantId().equals(jwt.getClaimAsString("tenant")))
                   .orElse(false);                              // missing = deny (and return 404)
    }
}
```
The framework validates signature (via JWKS with caching and key rotation), expiry, issuer and audience; your code adds scopes and the object-level ownership check that no gateway can do for you.

## Putting it together: a reference architecture
```
Internet ─> CDN/WAF (TLS, DDoS, bot rules, IP limits)
        ─> API Gateway (JWT validation, scopes, per-key rate limits, request IDs, audit of admin calls)
        ─> Services in mesh (mTLS via SPIFFE identities, authz policies, object-level checks)
        ─> Data stores (encryption at rest, KMS envelope keys, row-level tenant isolation)
Side systems: IdP (OIDC, MFA, SSO), Vault/KMS (secrets, keys), SIEM (audit + detection)
```

## How it shows up in interview problems
- **API gateway:** JWT validation with JWKS caching, scopes, API keys hashed at rest, rate limits, WAF in front, mTLS to services.
- **Payments:** tokenisation to shrink PCI scope, HMAC-signed webhooks, idempotency keys, mTLS to the PSP, envelope encryption, immutable audit trail, fail-closed limits against card testing.
- **Dropbox / Google Drive:** ReBAC/Zanzibar sharing model, pre-signed URLs with short expiry, per-user encryption keys, virus scanning of uploads.
- **Chat / WhatsApp:** end-to-end encryption (Signal protocol: the server routes ciphertext and never holds message keys), device keys, TLS to servers.
- **URL shortener:** abuse prevention (malicious link scanning, Safe Browsing), rate limits, unguessable codes for private links.
- **Notification / email:** signed unsubscribe links, SPF/DKIM/DMARC for email deliverability and anti-spoofing.
- **E-commerce / BookMyShow:** session or BFF auth, BOLA checks on orders and bookings, bot protection on flash sales.
- **Logging / metrics systems:** PII masking at ingestion, access controls on log search, audit log separation.
- **Multi-tenant SaaS anything:** tenant ID in the token, enforced at the gateway, the service and the database (RLS).

## Common pitfalls
- Trusting the JWT payload without verifying signature, `aud` and `iss`, or accepting `alg: none`.
- Long-lived access tokens with no revocation path.
- Storing tokens in `localStorage` in browser apps (XSS steals them); prefer BFF + HttpOnly cookies.
- Authorization only at the gateway, leaving BOLA in every service.
- Shared HS256 secrets across many services.
- Secrets in Git, Docker images or logs; no rotation.
- Fast hashes (SHA-256/MD5) for passwords.
- TLS terminated at the edge with plaintext inside the network for sensitive data.
- Fetching user-supplied URLs without SSRF protection.
- Audit logs that admins can edit or delete.

## Interview questions
1. **Sessions or JWTs?** Sessions for browser apps (easy revocation, small cookie, BFF pattern); short-lived JWTs for APIs and service-to-service where stateless verification matters; refresh-token rotation and a `jti` denylist for revocation.
2. **How do you revoke a JWT?** Short expiry plus refresh tokens you can revoke; a denylist keyed by `jti` with TTL for emergencies; or opaque tokens with introspection when instant revocation is required.
3. **Why PKCE?** It binds the authorization code to a secret only the original client knows, so an intercepted code can't be redeemed; mandatory in OAuth 2.1 for all clients.
4. **OAuth vs OIDC?** OAuth delegates access (access tokens, scopes); OIDC adds authentication: an ID token about the user, userinfo and discovery.
5. **How do services authenticate each other?** mTLS with workload identities issued and rotated by a mesh or SPIFFE, plus client-credentials or exchanged tokens carrying the user context and scopes.
6. **Explain envelope encryption.** Data is encrypted with a per-object data key; the data key is encrypted by a master key held in KMS/HSM; rotating the master key only re-wraps data keys, and every decrypt is authorised and audited.
7. **How do you store passwords?** Argon2id or bcrypt with per-password salt, cost tuned to ~250 ms, optional HSM-held pepper, rehash on login when parameters change; plus MFA and login rate limits.
8. **What is BOLA and where must it be fixed?** Accessing another user's object by changing an ID; it must be enforced in the service that owns the resource by checking ownership/tenant on every access, because the gateway doesn't know who owns what.

## Cheat sheet
- Authn = who, authz = what. Zero trust: authenticate every hop; least privilege everywhere.
- Browser: BFF + HttpOnly/Secure/SameSite cookie. APIs: short-lived JWT (RS256/ES256 via JWKS) + refresh rotation.
- Validate JWT: allow-listed alg, signature by `kid`, `exp/nbf`, `iss`, `aud`; payload is readable, not secret.
- OAuth2: auth code + PKCE for users, client credentials for services, token exchange for downstream; OIDC adds ID token; no implicit/password grants.
- Authz: RBAC (roles), ABAC (attributes), ReBAC/Zanzibar (relationships); coarse at gateway, object-level in service, tenant isolation in DB.
- API keys: random, prefixed, hashed at rest, scoped, rotatable. HMAC signing + timestamp for integrity and replay protection.
- TLS 1.3 everywhere; mTLS + SPIFFE/mesh for service identity; HSTS; automate cert renewal.
- Secrets in Vault/KMS, dynamic and rotated; envelope encryption with DEK/CMK; tokenise card data; crypto-shred for deletion.
- Passwords: Argon2id/bcrypt, salt, pepper, MFA, passkeys.
- OWASP API: BOLA, mass assignment, resource consumption, SSRF; validate input, parameterise queries.
- Edge: CDN + WAF + bot defence; audit logs append-only; minimise and mask PII.
