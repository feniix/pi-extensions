import { describe, expect, it } from "vitest";
import { createEmptyRun, getConductorProjectDir } from "../extensions/storage.js";

describe("storage helpers", () => {
	it("creates an empty run", () => {
		const run = createEmptyRun("abc", "/tmp/repo");
		expect(run.projectKey).toBe("abc");
		expect(run.repoRoot).toBe("/tmp/repo");
		expect(run.workers).toEqual([]);
	});

	it("builds a conductor project dir", () => {
		const dir = getConductorProjectDir("abc");
		expect(dir).toContain(".pi/agent/conductor/projects/abc");
	});
});
