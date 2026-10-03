import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const daemon = (file: string) => fileURLToPath(new URL(`../daemon/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Test against the daemon's sources, so `pnpm -F cli test` needs no prior build.
    alias: {
      "@donepm/daemon/config": daemon("config/config.ts"),
      "@donepm/daemon/paths": daemon("config/paths.ts"),
      "@donepm/daemon/exec": daemon("process/exec.ts"),
      "@donepm/daemon/status": daemon("status/status.ts"),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
