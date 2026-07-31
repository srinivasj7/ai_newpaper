import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEV_DATA = fileURLToPath(new URL("./dev-data", import.meta.url));

/**
 * Dev-only stand-in for CloudFront: serves `/data/*` out of `dev-data/` and answers the three
 * `/api/*` routes the Lambda will own. `dev-data/` lives outside `public/`, so `vite build`
 * cannot ship fixtures to S3 — the only way to get data in production is the real pipeline.
 */
function devBackend() {
  return {
    name: "daily-compile-dev-backend",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        const pathname = decodeURIComponent(url.pathname);

        if (pathname.startsWith("/data/")) {
          const file = path.join(DEV_DATA, pathname.slice("/data/".length));
          if (!file.startsWith(DEV_DATA)) return send(res, 403, { error: "forbidden" });
          try {
            const body = await readFile(file);
            res.setHeader("content-type", "application/json");
            res.setHeader("cache-control", "no-cache");
            return res.end(body);
          } catch {
            return send(res, 404, { error: "not found", key: pathname });
          }
        }

        if (pathname === "/api/health") return send(res, 200, { ok: true, dev: true });

        if (pathname === "/api/config" || pathname === "/api/feedback") {
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const body = await readBody(req);
          server.config.logger.info(
            `[dev-api] POST ${pathname} ${body.slice(0, 400)}${body.length > 400 ? "…" : ""}`,
          );
          return send(res, 200, { ok: true, dev: true });
        }

        next();
      });
    },
  };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

export default defineConfig({
  plugins: [react(), devBackend()],
  build: { outDir: "dist", sourcemap: true },
});
