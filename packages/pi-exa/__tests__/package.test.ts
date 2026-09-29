import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("declares host-provided TypeBox as a wildcard peer, not a runtime dependency", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(manifest.dependencies).not.toHaveProperty("typebox");
    expect(manifest.peerDependencies.typebox).toBe("*");
  });
});
