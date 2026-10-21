# KB for Android

The Android app is the KB website in a full-screen Chrome window: a **Trusted Web Activity** (TWA).
There is one codebase. Every push to `main` updates the website *and* the app, with no Play Store
release needed for content or feature changes. Google sign-in, Drive sync, the AI tutor, voice and
offline use all work exactly as on the website, because it *is* the website.

```
android/
  twa-manifest.json   the app's settings (package name, colours, start URL): edit and commit
  assetlinks.json     proves to Android that the app and www.codingsaint.com belong together
  README.md           this file
```

Everything else Bubblewrap generates here (the Gradle project, the APK/AAB) is git-ignored.
**Never commit the `.keystore` file.** Back it up somewhere safe: losing it means you can't update the app.

## Before you start

1. The website is live with Google sign-in set up (see the main README: *Google sign-in, Drive sync and KB Pro*),
   and `https://www.codingsaint.com/kb/manifest.webmanifest` opens in a browser.
2. Install Node.js 18+ and Bubblewrap: `npm i -g @bubblewrap/cli`.
   On first run Bubblewrap offers to download a JDK and the Android SDK for you. Say yes.

## Build

```powershell
cd android
bubblewrap build          # first time: it asks to create kb-upload.keystore; choose passwords and keep them
```

This produces `app-release-signed.apk` (install on a phone to test) and `app-release-bundle.aab` (upload to Play).

To try it on your phone: enable USB debugging, plug it in, and run `bubblewrap install`.

## Link the app to the website (removes the browser address bar)

Android only shows KB full-screen once the website vouches for the app:

1. Get your key's fingerprint: `bubblewrap fingerprint list` (or `keytool -list -v -keystore kb-upload.keystore`).
2. After the first upload to Play, also copy the **App signing key certificate SHA-256** from
   Play Console → your app → *Test and release → App integrity*.
3. Put both into `assetlinks.json` and publish it at
   **`https://www.codingsaint.com/.well-known/assetlinks.json`** (the root of the domain, not under `/kb/`).
   codingsaint.com is served from a different GitHub Pages repo than KB, so the file goes in **that** repo, in a
   `.well-known/` folder. That repo needs a `.nojekyll` file at its root, otherwise GitHub Pages skips folders starting with a dot.
4. Check it: https://developers.google.com/digital-asset-links/tools/generator

Until this is done the app still works, with a thin address bar at the top.

## Google sign-in inside the app

Nothing extra to set up. Sign-in runs in Chrome, so the web OAuth client you created for the website
(authorised origin `https://www.codingsaint.com`) is the one the app uses. No Android OAuth client is needed.

## KB Pro and Google Play's payment rules

The app is *consumption-only*: people unlock KB Pro by entering a licence key they bought on the website.
The app shows no buy button and no link to a payment page; Play doesn't allow steering to outside payments
from inside an app. `build/site/pro.js` detects the app from its start URL (`?source=twa`) and hides the buy link.
You can still promote the website and Pro anywhere *outside* the app (YouTube, X, email).

If you later want to sell inside the app too, that needs Google Play Billing (or Play's alternative-billing programme for India),
which is a separate integration.

## Updating the app

Only needed when `twa-manifest.json` changes (name, colours, icon). Bump `appVersionCode` (and `appVersionName`), then:

```powershell
bubblewrap update && bubblewrap build
```

## iPhone

There is no App Store build. On an iPhone, open the website in Safari → Share → **Add to Home Screen**.
It installs as an app with its own icon and offline cache. The Google sign-in window from a home-screen app on iOS
hasn't been tested yet; if it doesn't return to KB, use KB in Safari itself, where sign-in works as on any browser.
