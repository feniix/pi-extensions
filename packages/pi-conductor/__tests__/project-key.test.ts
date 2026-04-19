import { describe, expect, it } from "vitest";
import { deriveProjectKey } from "../extensions/project-key.js";

describe("deriveProjectKey", () => {
  it("is stable for the same repo root", () => {
    const a = deriveProjectKey("/tmp/example/repo");
    const b = deriveProjectKey("/tmp/example/repo");
    expect(a).toBe(b);
  });

  it("differs for different repo roots", () => {
    const a = deriveProjectKey("/tmp/example/repo-a");
    const b = deriveProjectKey("/tmp/example/repo-b");
    expect(a).not.toBe(b);
  });
});
