# mobile/ — The Daily Compile as an iOS + Android app

A [Capacitor](https://capacitorjs.com) shell that wraps the existing web build. It does **not**
re-implement the UI: it bundles `frontend/dist` and loads it in a native WebView, so the app and
the website are always the same paper. Daily editions load over the network exactly as on the web;
new app code/design ships via over-the-air (OTA) updates without an app-store resubmission.

## How the pieces fit

```
frontend/  ── vite build ──▶  frontend/dist  ──(cap sync)──▶  mobile/android, mobile/ios
   │                              │                                    │
   │ runtime Capacitor plugins    │ the web bundle the app loads       │ native shells
   │ (@capacitor/core, browser,   │ (includes src/native/bootstrap.js) │ (committed)
   │  splash-screen, capgo)       │                                    │
```

- The **native glue is `frontend/src/native/bootstrap.js`**, not a file in this folder — it must
  be compiled into `frontend/dist` (the bundle the app runs). It is gated on
  `Capacitor.isNativePlatform()`, so the website is unaffected. It does: hide splash, open external
  links in the system browser, pull-to-refresh (reload), and the OTA check.
- **Runtime plugins live in `frontend/package.json`** (they are bundled into the web build).
  **`mobile/package.json`** holds the Capacitor CLI + platform packages (`@capacitor/android`,
  `@capacitor/ios`) and the same native plugins so `cap sync` can link them on the native side.
  Keep the plugin versions in the two files aligned.
- `capacitor.config.json` sets `webDir: "../frontend/dist"` and uses the **https scheme on both
  platforms**, so the app origin is `https://localhost` — a single origin to allow in CORS, and a
  secure context (required by `crypto.subtle` in `client.js`).

## One-time setup

```bash
# 1. Install runtime plugins into the web project (updates frontend/package.json + lock)
cd frontend && npm install

# 2. Install the mobile toolchain
cd ../mobile && npm install

# 3. Change the bundle id from the placeholder before reserving it in the stores
#    edit capacitor.config.json  ->  "appId": "com.<yourorg>.dailycompile"

# 4. Build the web bundle, then generate the native projects (commit android/ and ios/)
npm run build:web
npx cap add android
npx cap add ios          # iOS scaffolding; building it needs macOS (see below)

# 5. App icon + splash: drop assets/icon.png (1024²) and assets/splash.png (2732²), then
npm run assets
```

### Build-time config (required)

The bundled app runs at `https://localhost`, so the data/API bases **must be absolute** — the
relative defaults in `frontend/src/api/client.js` only work same-origin behind CloudFront. Every
build passes them as Vite env vars (the CI workflows read repo variables `MOBILE_DATA_BASE` /
`MOBILE_API_BASE`):

```bash
VITE_DATA_BASE=https://<domain>/data \
VITE_API_BASE=https://<domain>/api \
VITE_APP_VERSION=1.0.0 \
npm --prefix ../frontend run build
```

> **Use a stable custom domain, not the `*.cloudfront.net` one.** That base is baked into every
> binary and every OTA bundle; if the CloudFront distribution is recreated the domain changes and
> installed apps break with no OTA recovery. Set `domain_name` in `infra/envs/prod/prod.auto.tfvars`.

CORS for the cross-origin reads/writes is already handled in `infra/` (a `data_cors` response-
headers policy on `/data/*` + `/app/*`, and OPTIONS/`Access-Control-*` in the write Lambda), scoped
to `https://localhost` via the `app_origins` variable. Nothing to do here.

## Local development

- **Android (works on Windows/macOS/Linux):**
  ```bash
  cd mobile && npm run sync:full && npx cap run android    # or: npx cap open android
  ```
  Remote-inspect the WebView at `chrome://inspect`.
- **iOS (macOS only):**
  ```bash
  cd mobile && npm run sync:full && (cd ios/App && pod install) && npx cap open ios
  ```
  Run in the Xcode simulator; inspect via Safari ▸ Develop.

## Over-the-air (OTA) updates

Self-hosted with [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater) — no
paid backend. The backend is just static JSON on the same S3 + CloudFront:

```
https://<domain>/app/production/<version>.zip     # the web bundle, immutable
https://<domain>/app/production/latest.json        # { version, url, checksum }
```

On launch `bootstrap.js` calls `notifyAppReady()` (this is the rollback safety net — a bundle that
never calls it is reverted next launch), fetches `latest.json`, and if the version is newer than the
running bundle, downloads and activates it.

**Publish an update** with the `mobile-ota` workflow (Actions ▸ Run workflow ▸ enter a semver newer
than the last). It builds the web bundle with the absolute bases, zips it, uploads to `app/`, writes
`latest.json`, and invalidates the manifest. Only the web bundle rides OTA — native changes
(anything in `android/`/`ios/`, or a new plugin) require a normal store build + submission.

**Version discipline:** all three workflows take a semver `version` input that becomes
`VITE_APP_VERSION` — the JS bundle version `bootstrap.js` compares. Use one scheme everywhere: an
OTA `version` must be strictly newer than the `version` baked into the store build it updates, or the
device keeps the bundled copy (and a lower OTA version is ignored, never a downgrade). Keep this
separate from the native `versionCode`/`CFBundleVersion`, which only change on a store resubmission.

## Signing (CI)

Secrets live only in the GitHub `mobile-release` environment — never in the repo.

**Android** — `android/app/build.gradle` needs a signing config that reads the workflow env vars:

```gradle
android {
  signingConfigs {
    release {
      storeFile file(System.getenv("ANDROID_KEYSTORE_FILE") ?: "release.keystore")
      storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
      keyAlias System.getenv("ANDROID_KEY_ALIAS")
      keyPassword System.getenv("ANDROID_KEY_PASSWORD")
    }
  }
  buildTypes { release { signingConfig signingConfigs.release } }
}
```
Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. Enroll in **Play App Signing** (Google keeps the app signing key; your
keystore is only the upload key).

**iOS** — commit `ios/App/ExportOptions.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>YOUR_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
```
Secrets: `ASC_API_KEY_P8` (base64 of the App Store Connect `.p8`), `ASC_API_KEY_ID`,
`ASC_API_KEY_ISSUER_ID`.

## Public store submission checklist

- **Bundle id** reserved in App Store Connect and Play Console (matches `appId`).
- **`ios/App/App/PrivacyInfo.xcprivacy`**: `NSPrivacyTracking = false`; declare required-reason APIs
  for the plugins in use; declare *Product Interaction* (keep/spike votes) as **not linked to
  identity**, no tracking.
- **App Privacy (Apple) / Data Safety (Google):** anonymous usage only, encrypted in transit
  (HTTPS), no account. **Disclose Google Fonts** (the CDN in `frontend/index.html` sends device IP
  to Google) — or self-host the three fonts into `frontend/` (also fixes offline first paint).
- **Public privacy-policy URL** is required by both stores (the paper is otherwise noindex/private —
  host a public policy page; the copy in `DisclaimerView.jsx` is a good seed).
- Keep the "not investment advice / machine-generated / unverified" disclaimers exactly as-is.
- **Screenshots**: iPhone 6.9"/6.7"/6.5"; Android phone + tablet. **Age/content rating** questionnaires.
- **Apple 4.2 (thin wrapper)** is the top review risk. This app is defensible: bundled (not a bare
  remote WebView), offline-capable (the SPA falls back to `localStorage`), native features
  (splash/icon/safe-area/pull-to-refresh/native link handling), fresh daily content, in-policy OTA.
  If flagged, the strongest additional native value is a daily "new edition" push notification.

## CI reference

| Workflow | Runner | Trigger | Produces |
|---|---|---|---|
| `mobile-ota.yml` | ubuntu | manual (semver input) | OTA bundle + manifest on S3/CloudFront |
| `mobile-android.yml` | ubuntu | manual | signed `.aab` artifact |
| `mobile-ios.yml` | macos-14 | manual | signed `.ipa` artifact |

Repo **variables** (reuse the site deploy ones + two new): `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`,
`SITE_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `SITE_OWNER_URL`, **`MOBILE_DATA_BASE`**,
**`MOBILE_API_BASE`**.

## Verify end-to-end

1. **CORS:** in the WebView DevTools, `GET /data/editions/index.json` returns 200 with
   `access-control-allow-origin: https://localhost`; a vote fires `OPTIONS /api/feedback` → 204 with
   `access-control-allow-headers` including `x-amz-content-sha256`, then `POST` → 200; the object
   lands under `data/feedback/…`.
2. **OTA:** install version X; publish Y via `mobile-ota`; relaunch → the app downloads and switches
   to Y. Then publish a deliberately broken bundle → confirm it rolls back on next launch.
3. **Native:** splash hides after first paint; the icon is correct; content clears the notch/home
   indicator; pull-to-refresh reloads; an external source link opens the system browser, not the
   main WebView.
