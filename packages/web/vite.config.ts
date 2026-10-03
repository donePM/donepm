import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const daemon = "http://127.0.0.1:6174";

export default defineConfig({
  plugins: [vue()],
  build: {
    // The daemon serves this directory (packages/daemon/public).
    outDir: fileURLToPath(new URL("../daemon/public", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // The daemon accepts this origin only when started with DONEPM_DEV_ORIGIN (pnpm dev does).
    proxy: {
      "/api": { target: daemon, changeOrigin: true },
      "/ws": { target: daemon, changeOrigin: true, ws: true },
    },
  },
});
