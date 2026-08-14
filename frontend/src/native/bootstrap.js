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
    await Promise.all([setupSplash(), setupStatusBar(), setupExternalLinks()]);
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

async function setupStatusBar() {
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  const root = document.documentElement;

  // Android 15+/16 enforce edge-to-edge, so by default the WebView draws behind the status bar and
  // the masthead's top row is clipped. overlay:false lays the WebView out below the bar. On iOS this
  // is effectively a no-op — content is already inset past the notch by the safe area.
  await StatusBar.setOverlaysWebView({ overlay: false }).catch((err) =>
    console.warn("[native] status bar overlay failed", err),
  );

  const isAndroid = Capacitor.getPlatform() === "android";
  // Paint the bar to match whatever theme useTheme resolved onto <html data-theme> (only ever
  // "light" or "dark"), and follow it when the user cycles the theme or the system flips.
  const apply = async () => {
    const dark = root.getAttribute("data-theme") === "dark";
    try {
      // Style.Dark = light glyphs (for a dark bar); Style.Light = dark glyphs (for a light bar).
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
      // Bar background is Android-only; iOS has no settable status-bar background.
      if (isAndroid) await StatusBar.setBackgroundColor({ color: dark ? "#14140F" : "#F6F5F1" });
    } catch (err) {
      console.warn("[native] status bar style failed", err);
    }
  };

  await apply();
  // initNative() runs before React's first paint, so data-theme may not be stamped yet; the observer
  // catches the first stamp and every later theme change.
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
}

function setupPullToRefresh() {
  // Overscroll-to-reload: fires ONLY on a deliberate downward pull that both starts and stays at the
  // very top. It re-reads the scroll position on every move and stands down on any upward motion, so
  // ordinary scrolling never reloads. A full reload re-fetches the manifest and re-opens the current
  // edition — the right refresh for a daily paper. (A styled spinner is a future enhancement.)
  const THRESHOLD = 90;
  const scrollTop = () =>
    window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  let startY = 0;
  let armed = false;
  let fired = false;

  addEventListener(
    "touchstart",
    (e) => {
      armed = e.touches.length === 1 && scrollTop() <= 0;
      fired = false;
      startY = e.touches[0]?.clientY ?? 0;
    },
    { passive: true },
  );
  addEventListener(
    "touchmove",
    (e) => {
      if (!armed || fired) return;
      const dy = e.touches[0].clientY - startY;
      // The page moved off the top, or the finger went up — a scroll, not a pull. Stand down.
      if (scrollTop() > 0 || dy < 0) {
        armed = false;
        return;
      }
      if (dy > THRESHOLD) {
        fired = true;
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
