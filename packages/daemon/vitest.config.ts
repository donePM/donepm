import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against core's sources, so `pnpm -F daemon test` needs no prior build.
    alias: { "@donepm/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  test: { include: ["src/**/*.test.ts"] },
});
