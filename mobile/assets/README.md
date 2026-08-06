# App icon & splash source images

Drop two source images here, then run `npm run assets` (from `mobile/`) to generate every
platform-specific icon and splash into `android/` and `ios/` via `@capacitor/assets`.

| File | Size | Notes |
|---|---|---|
| `icon.png` | 1024×1024 | Opaque. The app icon. |
| `splash.png` | 2732×2732 | Centered logo on the paper background `#F6F5F1`; keep important content within the central ~1200×1200 (the edges are cropped on most devices). |

Optional dark-mode variants: `icon-dark.png`, `splash-dark.png` (same sizes).

Palette (from the paper's design): paper `#F6F5F1`, ink `#16150F`, wire-blue `#1F3FAE`.

These source PNGs are committed; the generated per-density assets are written into the native
projects (which are also committed) and should not be hand-edited.
