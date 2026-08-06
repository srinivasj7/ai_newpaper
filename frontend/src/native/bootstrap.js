/*
 * Native shell glue for the Capacitor app.
 *
 * This file is compiled INTO the web bundle (frontend/dist), because that bundle is what the
 * native app loads. Everything here is gated on Capacitor.isNativePlatform(): on the website
 * initNative() returns immediately and nothing below runs. Only @capacitor/core is imported
 * statically (a few KB, no-ops on web); the platform plugins are dynamically imported after the
 * native check, so Vite code-splits them out of the paths the website ever executes.
 *
 * Responsibilities (thin scope):
 *   - hide the native splash once the app has painted
 *   - open external links in the system browser, not the in-app WebView
 *   - pull-to-refresh (reload the current bundle)
 *   - check for an over-the-air (OTA) web-bundle update and apply it (with auto-rollback)
 */

import { Capacitor } from "@capacitor/core";

// Where the OTA manifest + bundles live (same CloudFront the data comes from). VITE_DATA_BASE is
// e.g. https://<domain>/data; the OTA prefix is a sibling, https://<domain>/app.
const DATA_BASE = import.meta.env.VITE_DATA_BASE ?? "/data";
const OTA_BASE = DATA_BASE.replace(/\/data\/?$/, "/app");
const OTA_CHANNEL = "production";

// The version baked into this shipped bundle. The mobile build injects it; without it, OTA treats
// the builtin as 0.0.0 and will pull the first published bundle. Keep it aligned with latest.json.
const SHIPPED_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.0";

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await Promise.all([setupSplash(), setupExternalLinks()]);
    setupPullToRefresh();
    // OTA runs last and never blocks startup — a failed check just means "keep the current bundle".
    checkForUpdate();
  } catch (err) {
    console.warn("[native] init failed", err);
  }
}

async function setupSplash() {
  const { SplashScreen } = await import("@capacitor/splash-screen");
  // launchAutoHide is false in capacitor.config, so we control the hide. Wait one frame so the
  // first paint is up before the splash comes down — no white flash.
  requestAnimationFrame(() => requestAnimationFrame(() => SplashScreen.hide().catch(() => {})));
}

async function setupExternalLinks() {
  const { Browser } = await import("@capacitor/browser");
  // Capture phase so we intercept before React's own handlers. Any http(s) link that is not the
  // app's own origin opens in SFSafariViewController / Chrome Custom Tab instead of navigating
  // the main WebView (which would strand the user outside the app).
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href) && !href.startsWith("https://localhost")) {
        e.preventDefault();
        Browser.open({ url: href }).catch((err) => console.warn("[native] link open failed", err));
      }
    },
    true,
  );
}

function setupPullToRefresh() {
  // Minimal overscroll-to-reload: only arms when the page is already scrolled to the very top.
  // A full reload re-fetches the manifest and re-opens the current edition — the right refresh
  // for a daily paper. (A styled spinner is a deliberate future enhancement; thin for now.)
  const THRESHOLD = 70;
  const scroller = document.scrollingElement || document.documentElement;
  let startY = 0;
  let armed = false;

  addEventListener(
    "touchstart",
    (e) => {
      armed = scroller.scrollTop <= 0 && e.touches.length === 1;
      startY = armed ? e.touches[0].clientY : 0;
    },
    { passive: true },
  );
  addEventListener(
    "touchmove",
    (e) => {
      if (!armed) return;
      if (e.touches[0].clientY - startY > THRESHOLD) {
        armed = false;
        location.reload();
      }
    },
    { passive: true },
  );
  addEventListener("touchend", () => (armed = false), { passive: true });
}

async function checkForUpdate() {
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");

    // Confirm the running bundle rendered: without this call capgo rolls back to the last good
    // bundle on the next launch. It is the safety net that makes a broken OTA push self-healing.
    await CapacitorUpdater.notifyAppReady();

    const res = await fetch(`${OTA_BASE}/${OTA_CHANNEL}/latest.json`, { cache: "no-store" });
    if (!res.ok) return;
    const { version, url, checksum } = await res.json();
    if (!version || !url) return;

    const current = await CapacitorUpdater.current().catch(() => null);
    const active =
      current?.bundle?.version && current.bundle.version !== "builtin"
        ? current.bundle.version
        : SHIPPED_VERSION;
    if (!isNewer(version, active)) return;

    const bundle = await CapacitorUpdater.download({ version, url, checksum });
    // set() activates the new bundle and reloads into it. It becomes the current bundle; if it
    // fails to call notifyAppReady() next launch, capgo reverts to this one automatically.
    await CapacitorUpdater.set(bundle);
  } catch (err) {
    console.warn("[ota] update check failed", err);
  }
}

/** Loose semver compare — true when `candidate` is strictly newer than `active`. */
function isNewer(candidate, active) {
  const parse = (v) => String(v).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(active);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
