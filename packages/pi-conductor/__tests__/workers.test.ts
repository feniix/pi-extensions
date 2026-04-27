import { describe, expect, it } from "vitest";
import { buildBranchName, createWorkerId, normalizeWorkerSlug } from "../extensions/workers.js";

describe("worker helpers", () => {
  it("normalizes worker names into branch-safe slugs", () => {
    expect(normalizeWorkerSlug("Fix Auth")).toBe("fix-auth");
    expect(normalizeWorkerSlug("frontend/api")).toBe("frontend-api");
    expect(normalizeWorkerSlug("***")).toBeNull();
  });

  it("builds a branch name from a normalized worker slug", () => {
    expect(buildBranchName("worker-1", "Fix Auth")).toBe("conductor/fix-auth");
    expect(buildBranchName("worker-1", "***")).toBe("conductor/worker-1");
  });

  it("creates stable-enough worker ids with conductor prefix", () => {
    const id = createWorkerId();
    expect(id.startsWith("worker-")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
  });
});
