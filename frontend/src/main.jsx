import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { initNative } from "./native/bootstrap.js";
import { initStorage } from "./state/storage.js";

// Decrypt persisted state into memory before the first render — components read it synchronously in
// their state initializers, so the cache must be warm first. Always renders: if initStorage stalls
// (a blocked IndexedDB open, say), a short timeout lets the app start anyway and re-fetch. initNative
// runs after render so the native splash hides on a painted app, not a blank one.
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

withTimeout(initStorage(), 3000).finally(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  initNative();
});
