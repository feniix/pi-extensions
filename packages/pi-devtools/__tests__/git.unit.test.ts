import { afterEach, describe, expect, it, vi } from "vitest";

const { execSyncMock } = vi.hoisted(() => ({
	execSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execSync: execSyncMock,
}));

import {
	compareVersions,
	execGh,
	execGit,
	getCurrentBranch,
	getGitContext,
	getTagInfo,
	getWorkingTreeStatus,
	isGitRepo,
	parseVersion,
} from "../extensions/git.js";

describe("pi-devtools git unit helpers", () => {
	afterEach(() => {
		execSyncMock.mockReset();
	});

	it("parses and compares versions", () => {
		expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
		expect(parseVersion("2.0.1")).toEqual([2, 0, 1]);
		expect(compareVersions([1, 2, 0], [1, 1, 9])).toBeGreaterThan(0);
		expect(compareVersions([1, 2], [1, 2, 0])).toBe(0);
	});

	it("detects whether the cwd is inside a git repository", () => {
		execSyncMock.mockReturnValueOnce("true\n");
		expect(isGitRepo()).toBe(true);

		execSyncMock.mockImplementationOnce(() => {
			throw new Error("not a repo");
		});
		expect(isGitRepo()).toBe(false);
	});

	it("returns detached head branch labels when branch name is empty", () => {
		execSyncMock.mockReturnValueOnce("\n").mockReturnValueOnce("abc123\n");
		expect(getCurrentBranch()).toBe("Detached HEAD at abc123");
	});

	it("formats working tree status from porcelain output", () => {
		execSyncMock.mockReturnValueOnce(" M file1\n?? new.txt\n M file2\n");
		expect(getWorkingTreeStatus()).toBe("2 modified, 1 untracked");
	});

	it("formats tag info with unreleased commit count", () => {
		execSyncMock.mockReturnValueOnce("v1.0.0\nv1.2.0\nv1.1.5\n").mockReturnValueOnce("3\n");
		expect(getTagInfo()).toBe("Tag: v1.2.0 (3 unreleased commits)");
	});

	it("returns no tags message when tag list is empty", () => {
		execSyncMock.mockReturnValueOnce("\n");
		expect(getTagInfo()).toBe("No version tags found");
	});

	it("builds git context from branch, status, and tags", () => {
		execSyncMock
			.mockReturnValueOnce("true\n")
			.mockReturnValueOnce("feature/coverage\n")
			.mockReturnValueOnce(" M file.ts\n")
			.mockReturnValueOnce("v1.0.0\n")
			.mockReturnValueOnce("2\n");

		expect(getGitContext()).toBe(
			"[devtools] Branch: feature/coverage | Status: 1 modified | Tag: v1.0.0 (2 unreleased commits)",
		);
	});

	it("wraps git and gh command failures with clearer messages", () => {
		execSyncMock.mockImplementationOnce(() => {
			throw new Error("git blew up");
		});
		expect(() => execGit("git status")).toThrow("Git error: git blew up");

		execSyncMock.mockImplementationOnce(() => {
			throw new Error("gh blew up");
		});
		expect(() => execGh("gh pr view")).toThrow("gh error: gh blew up");
	});
});
