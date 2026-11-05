import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests run against shared's source, so they do not need `pnpm -C packages/shared build` first.
    alias: { "@evenhand/shared": fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
