import { describe, expect, it } from "vitest";

import { renderStatusLine } from "../src/index.js";

function makeStatusLineInput(
	overrides: {
		cwd?: string;
		repoName?: string | null;
		model?: string | null;
		contextPct?: number | null;
		thinkingLevel?: "low" | "medium" | "high" | "max" | null;
		branch?: string | null;
		worktree?: string | null;
		dirty?: number;
		inputTokens?: number;
		outputTokens?: number;
		lastSkill?: string | null;
	} = {},
) {
	const {
		cwd = "/Users/test/src/my-project",
		repoName = "my-project",
		model = "Claude Opus 4",
		contextPct = 11.0,
		thinkingLevel = "medium",
		branch = "main",
		worktree = "main",
		dirty = 3,
		inputTokens = 10_500,
		outputTokens = 3200,
		lastSkill = "code-search",
	} = overrides;

	return {
		gathered: {
			repoRoot: cwd,
			git: { branch, worktree, dirty },
			transcriptTokens: inputTokens !== undefined || outputTokens !== undefined ? { inputTokens, outputTokens } : null,
		},
		params: {
			cwd,
			repoName,
			model,
			contextPct,
			thinkingLevel: thinkingLevel as "low" | "medium" | "high" | "max" | null,
		},
		lastSkill: lastSkill ?? null,
	};
}

function renderBoth(params: ReturnType<typeof makeStatusLineInput>) {
	const full = renderStatusLine(params.gathered, params.params, params.lastSkill);
	const lines = full.split("\n");
	return { line1: lines[0], line2: lines[1] };
}

describe("renderStatusLine", () => {
	it("renders line1 with all widgets", () => {
		const p = makeStatusLineInput();
		const { line1 } = renderBoth(p);

		expect(line1).toContain("Model:");
		expect(line1).toContain("Claude Opus 4");
		expect(line1).toContain("Thinking:");
		expect(line1).toContain("medium");
		expect(line1).toContain("Ctx:");
		expect(line1).toContain("11.0%");
		expect(line1).toContain("⎇");
		expect(line1).toContain("main");
		expect(line1).toContain("dirty:");
		expect(line1).toContain("+3");
		expect(line1).toContain("Tokens:");
		expect(line1).toContain("↑10.5k");
		expect(line1).toContain("↓3.2k");
	});

	it("renders line1 with null transcript tokens", () => {
		const p = makeStatusLineInput();
		p.gathered.transcriptTokens = null;
		const { line1 } = renderBoth(p);

		expect(line1).toContain("Tokens:");
		expect(line1).toContain("↑0/↓0");
	});

	it("renders line1 with no git branch", () => {
		const p = makeStatusLineInput({ branch: null, worktree: null, dirty: 0 });
		const { line1 } = renderBoth(p);

		expect(line1).toContain("no git");
		expect(line1).toContain("dirty:");
		expect(line1).toContain("+0");
	});

	it("renders line1 with null model", () => {
		const p = makeStatusLineInput({ model: null });
		const { line1 } = renderBoth(p);

		expect(line1).toContain("Model:");
		expect(line1).toContain("?");
	});

	it("renders line2 with all widgets", () => {
		const p = makeStatusLineInput();
		const { line2 } = renderBoth(p);

		expect(line2).toContain("my-project");
		expect(line2).toContain("cwd:");
		expect(line2).toContain("/Users/test/src/my-project");
		expect(line2).toContain("𖠰");
		expect(line2).toContain("main");
		expect(line2).toContain("Skill:");
		expect(line2).toContain("code-search");
	});

	it("renders line2 with null worktree", () => {
		const p = makeStatusLineInput({ branch: null, worktree: null });
		const { line2 } = renderBoth(p);

		expect(line2).toContain("𖠰");
		expect(line2).toContain("no git");
	});

	it("renders line2 with no skill", () => {
		const p = makeStatusLineInput({ lastSkill: null });
		const { line2 } = renderBoth(p);

		expect(line2).toContain("Skill:");
		expect(line2).toContain("none");
	});
});
