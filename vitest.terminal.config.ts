import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/pi-statusline/__tests__/terminal/*.terminal.test.ts"],
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 45_000,
    hookTimeout: 15_000,
    coverage: { enabled: false },
  },
});
