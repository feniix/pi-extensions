import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import devtoolsExtension, { parseConventionalCommit } from "../extensions/index.js";

const createMockPi = () =>
	({
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerTool: vi.fn(),
		on: vi.fn(),
	}) satisfies Partial<ExtensionAPI>;

describe("pi-devtools helpers", () => {
	describe("parseConventionalCommit", () => {
		it("parses feat commit", () => {
			const result = parseConventionalCommit("feat: add new feature");
			expect(result.type).toBe("feat");
			expect(result.breaking).toBe(false);
		});

		it("parses fix commit", () => {
			const result = parseConventionalCommit("fix: fix bug");
			expect(result.type).toBe("fix");
			expect(result.breaking).toBe(false);
		});

		it("parses commit with scope", () => {
			const result = parseConventionalCommit("feat(core): add new feature");
			expect(result.type).toBe("feat");
			expect(result.scope).toBe("core");
			expect(result.breaking).toBe(false);
		});

		it("parses breaking commit with !", () => {
			const result = parseConventionalCommit("feat!: breaking change");
			expect(result.type).toBe("feat");
			expect(result.breaking).toBe(true);
		});

		it("parses non-conventional commit", () => {
			const result = parseConventionalCommit("just a regular message");
			expect(result.type).toBe("other");
			expect(result.breaking).toBe(false);
		});

		it("normalizes type to lowercase", () => {
			const result = parseConventionalCommit("FEAT: add feature");
			expect(result.type).toBe("feat");
		});

		it("parses chore commit", () => {
			const result = parseConventionalCommit("chore: update deps");
			expect(result.type).toBe("chore");
			expect(result.breaking).toBe(false);
		});

		it("parses docs commit", () => {
			const result = parseConventionalCommit("docs: update readme");
			expect(result.type).toBe("docs");
		});

		it("parses refactor commit", () => {
			const result = parseConventionalCommit("refactor: simplify code");
			expect(result.type).toBe("refactor");
		});

		it("parses test commit", () => {
			const result = parseConventionalCommit("test: add unit tests");
			expect(result.type).toBe("test");
		});

		it("parses ci commit", () => {
			const result = parseConventionalCommit("ci: update pipeline");
			expect(result.type).toBe("ci");
		});

		it("parses build commit", () => {
			const result = parseConventionalCommit("build: compile assets");
			expect(result.type).toBe("build");
		});

		it("parses perf commit", () => {
			const result = parseConventionalCommit("perf: improve performance");
			expect(result.type).toBe("perf");
		});

		it("parses style commit", () => {
			const result = parseConventionalCommit("style: format code");
			expect(result.type).toBe("style");
		});
	});
});

describe("pi-devtools extension", () => {
	describe("tool registration", () => {
		it("registers all tools", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);

			expect(toolNames).toContain("devtools_create_branch");
			expect(toolNames).toContain("devtools_commit");
			expect(toolNames).toContain("devtools_push");
			expect(toolNames).toContain("devtools_create_pr");
			expect(toolNames).toContain("devtools_merge_pr");
			expect(toolNames).toContain("devtools_squash_merge_pr");
			expect(toolNames).toContain("devtools_check_ci");
			expect(toolNames).toContain("devtools_get_repo_info");
			expect(toolNames).toContain("devtools_get_latest_tag");
			expect(toolNames).toContain("devtools_analyze_commits");
			expect(toolNames).toContain("devtools_bump_version");
			expect(toolNames).toContain("devtools_create_release");
		});

		it("registers exactly 12 tools", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
			expect(toolNames).toHaveLength(12);
		});

		it("registers tools with execute functions", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			tools.forEach((tool) => {
				expect(tool.execute).toBeDefined();
				expect(typeof tool.execute).toBe("function");
			});
		});

		it("registers tools with labels", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			tools.forEach((tool) => {
				expect(tool.label).toBeDefined();
				expect(tool.label.length).toBeGreaterThan(0);
			});
		});

		it("registers tools with descriptions", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			tools.forEach((tool) => {
				expect(tool.description).toBeDefined();
				expect(tool.description.length).toBeGreaterThan(0);
			});
		});

		it("registers tools with parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			tools.forEach((tool) => {
				expect(tool.parameters).toBeDefined();
			});
		});

		it("devtools_create_branch has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const branchTool = tools.find((t) => t.name === "devtools_create_branch");

			expect(branchTool?.parameters).toBeDefined();
			expect(branchTool?.label).toBe("Create Branch");
		});

		it("devtools_commit has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const commitTool = tools.find((t) => t.name === "devtools_commit");

			expect(commitTool?.parameters).toBeDefined();
			expect(commitTool?.label).toBe("Git Commit");
		});

		it("devtools_push has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const pushTool = tools.find((t) => t.name === "devtools_push");

			expect(pushTool?.parameters).toBeDefined();
			expect(pushTool?.label).toBe("Git Push");
		});

		it("devtools_create_pr has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const prTool = tools.find((t) => t.name === "devtools_create_pr");

			expect(prTool?.parameters).toBeDefined();
			expect(prTool?.label).toBe("Create PR");
		});

		it("devtools_merge_pr has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const mergeTool = tools.find((t) => t.name === "devtools_merge_pr");

			expect(mergeTool?.parameters).toBeDefined();
			expect(mergeTool?.label).toBe("Merge PR");
		});

		it("devtools_squash_merge_pr has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const squashTool = tools.find((t) => t.name === "devtools_squash_merge_pr");

			expect(squashTool?.parameters).toBeDefined();
			expect(squashTool?.label).toBe("Squash Merge PR");
		});

		it("devtools_check_ci has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const ciTool = tools.find((t) => t.name === "devtools_check_ci");

			expect(ciTool?.parameters).toBeDefined();
			expect(ciTool?.label).toBe("Check CI");
		});

		it("devtools_get_repo_info has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const repoInfoTool = tools.find((t) => t.name === "devtools_get_repo_info");

			expect(repoInfoTool?.parameters).toBeDefined();
			expect(repoInfoTool?.label).toBe("Repo Info");
		});

		it("devtools_get_latest_tag has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const tagTool = tools.find((t) => t.name === "devtools_get_latest_tag");

			expect(tagTool?.parameters).toBeDefined();
			expect(tagTool?.label).toBe("Latest Tag");
		});

		it("devtools_analyze_commits has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const analyzeTool = tools.find((t) => t.name === "devtools_analyze_commits");

			expect(analyzeTool?.parameters).toBeDefined();
			expect(analyzeTool?.label).toBe("Analyze Commits");
		});

		it("devtools_bump_version has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const bumpTool = tools.find((t) => t.name === "devtools_bump_version");

			expect(bumpTool?.parameters).toBeDefined();
			expect(bumpTool?.label).toBe("Bump Version");
		});

		it("devtools_create_release has correct parameters", () => {
			const mockPi = createMockPi();
			devtoolsExtension(mockPi as unknown as ExtensionAPI);

			const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
			const releaseTool = tools.find((t) => t.name === "devtools_create_release");

			expect(releaseTool?.parameters).toBeDefined();
			expect(releaseTool?.label).toBe("Create Release");
		});

		it("handles multiple extension instances", () => {
			const mockPi1 = createMockPi();
			const mockPi2 = createMockPi();

			devtoolsExtension(mockPi1 as unknown as ExtensionAPI);
			devtoolsExtension(mockPi2 as unknown as ExtensionAPI);

			expect(mockPi1.registerTool).toHaveBeenCalledTimes(12);
			expect(mockPi2.registerTool).toHaveBeenCalledTimes(12);
		});
	});
});
