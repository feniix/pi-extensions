import { defineConfig } from "vitest/config";

function coverageInclude(): string[] {
  const packageNames = new Set<string>();
  for (const arg of process.argv) {
    const match = arg.match(/packages\/([^/]+)\/__tests__/);
    if (match?.[1]) packageNames.add(match[1]);
  }
  return packageNames.size === 1
    ? [`packages/${[...packageNames][0]}/extensions/**/*.ts`]
    : ["packages/*/extensions/**/*.ts"];
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: coverageInclude(),
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
