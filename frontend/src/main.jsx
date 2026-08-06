import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { initNative } from "./native/bootstrap.js";

// No-op on the web; sets up splash/links/pull-to-refresh/OTA inside the native app. Fire-and-forget
// so it never delays first render.
initNative();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
