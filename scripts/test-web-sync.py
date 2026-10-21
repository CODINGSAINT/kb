"""End-to-end test of KB web: Google sign-in, Drive sync across two devices, Grok, KB Pro.
Google, Drive, xAI and Lemon Squeezy are stubbed with Playwright routes; one in-memory Drive is shared by both devices."""
import json, re, sys, threading, http.server, functools, os, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

# Run: KB_GOOGLE_CLIENT_ID=test-123.apps.googleusercontent.com npm run build:site && python scripts/test-web-sync.py site <screenshot-dir>
# Needs: pip install playwright && playwright install chromium. Edits site/config.js (turns KB Pro on) while it runs.
SITE = sys.argv[1]
OUT = sys.argv[2]
PORT = 8765
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(H, directory=SITE)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}/"

drive = {}  # id -> {name, body(bytes), modifiedTime}
seq = [0]
calls = {"xai": 0, "ls": []}
def now():
    seq[0] += 1
    return f"2026-10-21T10:00:{seq[0]:02d}.000Z"

FAKE_GIS = """
window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { return { requestAccessToken(o) { window.__gisPrompts = (window.__gisPrompts||[]).concat([o.prompt]);
     setTimeout(() => cfg.callback({ access_token: 'tok-' + Math.random(), expires_in: 3599, scope: 'openid email profile https://www.googleapis.com/auth/drive.appdata' }), 30); } }; },
  hasGrantedAllScopes() { return true; }, revoke(t, cb) { cb && cb(); } } } };
"""

def cors(extra=None):
    h = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*"}
    if extra: h.update(extra)
    return h

def google(route, request):
    if request.method == "OPTIONS":
        return route.fulfill(status=204, headers=cors())
    u = urlparse(request.url); q = parse_qs(u.query)
    if u.path == "/oauth2/v3/userinfo":
        return route.fulfill(json={"email": "learner@example.com", "name": "Test Learner", "picture": ""}, headers=cors())
    if u.path == "/drive/v3/files" and request.method == "GET":
        return route.fulfill(json={"files": [{"id": i, "name": f["name"], "modifiedTime": f["modifiedTime"]} for i, f in drive.items()]}, headers=cors())
    m = re.match(r"^/drive/v3/files/([^/]+)$", u.path)
    if m and request.method == "GET":
        f = drive.get(m.group(1))
        if not f: return route.fulfill(status=404, json={"error": {"message": "nf"}}, headers=cors())
        if q.get("alt") == ["media"]:
            return route.fulfill(body=f["body"], headers=cors({"content-type": "application/octet-stream"}))
        return route.fulfill(json={"id": m.group(1), "modifiedTime": f["modifiedTime"]}, headers=cors())
    if u.path == "/upload/drive/v3/files" and request.method == "POST":
        body = request.post_data_buffer
        ctype = request.headers.get("content-type", "")
        boundary = ctype.split("boundary=")[1].encode()
        parts = body.split(b"--" + boundary)
        meta = json.loads(parts[1].split(b"\r\n\r\n", 1)[1].strip())
        content = parts[2].split(b"\r\n\r\n", 1)[1][:-2]
        seq[0] += 1; fid = f"f{seq[0]}"
        drive[fid] = {"name": meta["name"], "body": content, "modifiedTime": now()}
        assert meta["parents"] == ["appDataFolder"], meta
        return route.fulfill(json={"id": fid, "modifiedTime": drive[fid]["modifiedTime"]}, headers=cors())
    m = re.match(r"^/upload/drive/v3/files/([^/]+)$", u.path)
    if m and request.method == "PATCH":
        f = drive[m.group(1)]; f["body"] = request.post_data_buffer; f["modifiedTime"] = now()
        return route.fulfill(json={"id": m.group(1), "modifiedTime": f["modifiedTime"]}, headers=cors())
    return route.fulfill(status=500, json={"error": {"message": "unhandled " + request.method + " " + u.path}}, headers=cors())

def xai(route, request):
    if request.method == "OPTIONS": return route.fulfill(status=204, headers=cors())
    calls["xai"] += 1
    assert request.headers.get("authorization") == "Bearer xai-TESTKEY-1234", request.headers.get("authorization")
    sysmsg = json.loads(request.post_data)["messages"][0]["content"]
    text = "OK" if "Reply with exactly: OK" in sysmsg else "**Verdict: Solid** (grok stub) Good separation of concerns."
    sse = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': w}}]})}\n\n" for w in re.findall(r"\S+\s*", text)) + "data: [DONE]\n\n"
    route.fulfill(body=sse, headers=cors({"content-type": "text/event-stream"}))

def lemon(route, request):
    if request.method == "OPTIONS": return route.fulfill(status=204, headers=cors())
    form = parse_qs(request.post_data)
    calls["ls"].append((urlparse(request.url).path, form))
    if form.get("license_key") != ["GOOD-KEY"]:
        return route.fulfill(status=404, json={"activated": False, "valid": False, "error": "license_key not found."}, headers=cors())
    return route.fulfill(json={"activated": True, "valid": True, "license_key": {"status": "active"}, "instance": {"id": "inst-1"},
        "meta": {"store_id": 111, "product_id": 222, "customer_email": "learner@example.com"}}, headers=cors())

def device(browser, name, mobile=False):
    ctx = browser.new_context(**({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True} if mobile else {"viewport": {"width": 1280, "height": 850}}))
    ctx.route("https://accounts.google.com/gsi/client", lambda r, q: r.fulfill(body=FAKE_GIS, headers={"content-type": "text/javascript"}))
    ctx.route(re.compile(r"https://www\.googleapis\.com/.*"), google)
    ctx.route(re.compile(r"https://api\.x\.ai/.*"), xai)
    ctx.route(re.compile(r"https://api\.lemonsqueezy\.com/.*"), lemon)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "404" not in m.text and errs.append(m.text))
    page.on("response", lambda r: r.status == 404 and "lemonsqueezy" not in r.url and errs.append("404 " + r.url))
    return ctx, page, errs

def api(page, method, path, body=None):
    return page.evaluate("""async ([m, p, b]) => { const r = await fetch(p, m === 'GET' ? {} : { method: m, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() }; }""", [method, path, body])

def drive_json(name):
    for f in drive.values():
        if f["name"] == name: return json.loads(f["body"])
    return None

def wait_synced(page):
    page.wait_for_function("() => window.KBDrive.state().pending === 0 && window.KBDrive.state().sync === 'idle'", timeout=8000)

ok = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg); ok.append(cond)

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------------- device A: laptop
    ctx, page, errs = device(browser, "A")
    page.goto(BASE + "#/")
    page.wait_for_selector("#googleBtn")
    check(page.is_visible("text=Continue with Google"), "signed-out site offers Continue with Google")
    page.screenshot(path=f"{OUT}/01-signed-out.png")
    page.click("#googleBtn")
    page.wait_for_selector("#acctChip", timeout=10000)
    check(page.evaluate("KBDrive.user.email") == "learner@example.com", "signed in as the Google account")
    # connect Grok once
    page.click("#aiButton")
    page.click("[data-prov=xai]")
    check(page.is_visible(".drive-only"), "AI dialog explains the key is kept in your Google Drive")
    check(not page.is_visible("#aiRememberRow"), "no 'remember in this browser' box when signed in")
    page.fill("#aiKey", "xai-TESTKEY-1234")
    page.screenshot(path=f"{OUT}/02-ai-settings.png")
    page.click("#aiSave")
    page.wait_for_selector("#aiMsg.ok, .save-state.ok", timeout=8000)
    check("Grok" in page.inner_text("#aiLabel"), "AI chip shows Grok after save & test")
    wait_synced(page)
    st = drive_json("settings.json")
    check(st and st["ai"]["keys"]["xai"] == "xai-TESTKEY-1234" and st["ai"]["prefs"]["provider"] == "xai", "API key + provider saved to Drive settings.json")
    # answer LLD 1 and evaluate with Grok
    r = api(page, "POST", "/api/days/1/answer", {"topicIndex": 0, "userAnswer": "Parking lot: ParkingLot, Floor, Spot, Ticket."})
    check(r["status"] == 200, "saving an answer works")
    r = api(page, "POST", "/api/ai/evaluate", {"track": "LLD", "number": 1})
    check(r["status"] == 200 and "grok stub" in r["body"]["item"]["answerEvaluation"], "Evaluate with AI goes to Grok and saves the verdict")
    wait_synced(page)
    pj = drive_json("progress.json") or {}
    rec = next((v for v in pj.values() if "Parking lot" in json.dumps(v)), None)
    check(rec is not None and "grok stub" in json.dumps(rec), "answer + verdict synced to Drive progress.json")
    print("   progress.json keys:", list(pj.keys()))
    check(not errs, "no page errors on device A" + (": " + "; ".join(errs[:3]) if errs else ""))
    ctx.close()

    # ---------------- KB Pro on: rebuild config in the served site
    print("--- enabling KB Pro")
    cfg = open(f"{SITE}/config.js").read()
    cfg = cfg.replace('"enabled": false', '"enabled": true').replace('"checkoutUrl": ""', '"checkoutUrl": "https://codingsaint.lemonsqueezy.com/buy/abc"').replace('"price": ""', '"price": "₹999"').replace('"storeId": null', '"storeId": 111').replace('"productId": null', '"productId": 222')
    open(f"{SITE}/config.js", "w").write(cfg)

    # ---------------- device B: phone, same Google account
    ctx, page, errs = device(browser, "B", mobile=True)
    page.goto(BASE + "#/")
    page.wait_for_selector("#googleBtn")
    page.screenshot(path=f"{OUT}/03-phone-signed-out.png")
    page.click("#googleBtn")
    page.wait_for_selector("#acctChip", timeout=10000)
    page.wait_for_timeout(500)
    cfgB = api(page, "GET", "/api/ai/config")["body"]
    check(cfgB["ready"] and cfgB["provider"] == "xai", "phone: Grok is already connected (key came from Drive, no re-entry)")
    day1 = api(page, "GET", "/api/days/1")["body"]
    check("Parking lot" in (day1["topics"][0].get("userAnswer") or ""), "phone: the laptop's answer is there")
    check("grok stub" in (day1["topics"][0].get("answerEvaluation") or ""), "phone: the laptop's verdict is there")
    page.goto(BASE + "#/t/1/0"); page.wait_for_timeout(800)
    page.screenshot(path=f"{OUT}/04-phone-topic.png", full_page=False)
    # free topic works, locked topic asks for Pro
    r = api(page, "POST", "/api/days/3/answer", {"topicIndex": 0, "userAnswer": "free topic answer"})
    check(r["status"] == 200, "free plan: LLD 3 answer saves")
    r = api(page, "POST", "/api/days/5/answer", {"topicIndex": 0, "userAnswer": "locked topic answer"})
    check(r["status"] == 402 and r["body"]["code"] == "PRO", "free plan: LLD 5 answer is locked (402 PRO)")
    page.wait_for_selector("#proDialog[open]")
    href = page.get_attribute("#proDialog a.btn", "href")
    check(href and "checkout%5Bemail%5D=learner%40example.com" in href, "Pro dialog buy link prefills the Google email")
    page.screenshot(path=f"{OUT}/05-phone-pro.png")
    r2 = api(page, "POST", "/api/ai/chat", {"track": "DSA", "number": 300, "message": "hi"})
    check(r2["status"] == 402, "free plan: tutor on a late DSA problem is locked")
    page.fill("#proKey", "BAD-KEY"); page.click("#proDialog [data-act=activate]")
    page.wait_for_selector("#proMsg.err"); check("not found" in page.inner_text("#proMsg"), "wrong licence key is rejected")
    page.fill("#proKey", "GOOD-KEY")
    with page.expect_navigation(): page.click("#proDialog [data-act=activate]")
    page.wait_for_selector("#acctChip", timeout=10000); page.wait_for_timeout(500)
    check(calls["ls"][-1][1].get("instance_name") == ["learner@example.com"], "licence activated once for the Google account")
    r = api(page, "POST", "/api/days/5/answer", {"topicIndex": 0, "userAnswer": "locked topic answer"})
    check(r["status"] == 200, "after unlocking: LLD 5 saves")
    wait_synced(page)
    check((drive_json("settings.json") or {}).get("licence", {}).get("status") == "active", "licence saved to Drive settings.json")
    check(not errs, "no page errors on phone" + (": " + "; ".join(errs[:3]) if errs else ""))
    ctx.close()

    # ---------------- device C: Android app (TWA) — no buy button; licence already on the account
    ctx, page, errs = device(browser, "C", mobile=True)
    page.goto(BASE + "?source=twa#/")
    page.wait_for_selector("#googleBtn"); page.click("#googleBtn"); page.wait_for_selector("#acctChip", timeout=10000); page.wait_for_timeout(400)
    check(page.evaluate("KBPro.isPro()"), "Android app: Pro already unlocked from the account")
    page.evaluate("localStorage.clear(); sessionStorage.setItem('kb-in-play','1')")
    page.evaluate("KBPro.useStore(() => null, () => {}); KBPro.open('test')")
    check(page.locator("#proDialog a.btn").count() == 0, "Android app: no buy link in the Pro dialog (Play policy)")
    page.screenshot(path=f"{OUT}/06-android-pro.png")
    ctx.close()

    # ---------------- expired token: chip says tap to sync, tap renews
    ctx, page, errs = device(browser, "D")
    page.goto(BASE + "#/"); page.click("#googleBtn"); page.wait_for_selector("#acctChip", timeout=10000)
    page.evaluate("localStorage.setItem('kb-drive-token', JSON.stringify({value:'old', exp: 1}))")
    page.reload(); page.wait_for_selector("#acctChip")
    api(page, "POST", "/api/days/2/answer", {"topicIndex": 0, "userAnswer": "written while token expired"})
    page.wait_for_timeout(1600)
    txt = page.inner_text("#acctChip")
    check("tap to sync" in txt.lower(), f"expired token: chip asks to tap to sync ({txt.strip()!r})")
    page.screenshot(path=f"{OUT}/07-tap-to-sync.png")
    page.click("#acctChip"); wait_synced(page)
    check("written while token expired" in json.dumps(drive_json("progress.json")), "after tap: offline change reached Drive")
    ctx.close()
    browser.close()

print(f"\n{sum(ok)}/{len(ok)} checks passed")
sys.exit(0 if all(ok) else 1)
