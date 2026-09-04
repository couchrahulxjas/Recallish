// The TanStack Vite config includes the standard plugins and runtime setup.
// Add only project-specific overrides here.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

// Vite 8's SSR module runner has a hard-coded 60s "transport invoke" timeout
// (vitejs/vite#23131). On slow machines the first SSR compile can exceed it, and
// unpatched Vite then permanently poisons the runner. We ship a pre-warm step so
// the browser never hits a cold, mid-compile graph.
function ssrWarmupPlugin(): Plugin {
  return {
    name: "ssr-warmup",
    apply: "serve",
    configureServer(server) {
      const entry =
        "/node_modules/@tanstack/react-start/dist/default-entry/esm/server.js";
      void (async () => {
        for (let i = 1; i <= 60; i++) {
          try {
            await server.ssrLoadModule(entry);
            console.log("[ssr-warmup] SSR module graph ready");
            return;
          } catch (err) {
            const msg =
              err instanceof Error ? err.message.slice(0, 100) : String(err);
            console.log(`[ssr-warmup] attempt ${i} not ready: ${msg}`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      })();
    },
  };
}

export default defineConfig({
  plugins: [ssrWarmupPlugin()],
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "node-server",
  },
  vite: {
    server: {
      proxy: {
        "/api": "http://127.0.0.1:8765",
      },
    },
  },
});