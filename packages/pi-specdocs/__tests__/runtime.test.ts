import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import specdocs from "../extensions/index.js";

const createMockPi = () =>
	({
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		on: vi.fn(),
	}) satisfies Partial<ExtensionAPI>;

const getEventHandler = (mockPi: ReturnType<typeof createMockPi>, eventName: string) => {
	const entry = mockPi.on.mock.calls.find(([event]) => event === eventName);
	return entry?.[1];
};

const getCommandHandler = (mockPi: ReturnType<typeof createMockPi>, commandName: string) => {
	const entry = mockPi.registerCommand.mock.calls.find(([name]) => name === commandName);
	return entry?.[1]?.handler;
};

describe("pi-specdocs runtime", () => {
	const originalCwd = process.cwd();

	afterEach(() => {
		process.chdir(originalCwd);
		vi.restoreAllMocks();
	});

	it("logs workspace summary during session_start", async () => {
		const base = mkdtempSync(join(tmpdir(), "pi-specdocs-runtime-"));
		mkdirSync(join(base, ".claude"), { recursive: true });
		mkdirSync(join(base, "docs", "prd"), { recursive: true });
		mkdirSync(join(base, "docs", "adr"), { recursive: true });
		writeFileSync(join(base, ".claude", "tracker.md"), "---\ntracker: github\n---\n");
		writeFileSync(join(base, "docs", "prd", "PRD-001-auth.md"), '---\ntitle: "Auth"\nstatus: Draft\n---\n');
		writeFileSync(join(base, "docs", "adr", "ADR-0001-db.md"), '---\ntitle: "DB"\nstatus: Proposed\n---\n');

		process.chdir(base);
		const mockPi = createMockPi();
		specdocs(mockPi as unknown as ExtensionAPI);
		const sessionStart = getEventHandler(mockPi, "session_start");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await sessionStart?.();

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[specdocs] Tracker: github"));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Workspace: 1 PRDs, 1 ADRs"));
	});

	it("warns on invalid frontmatter after write/edit tool results", async () => {
		const base = mkdtempSync(join(tmpdir(), "pi-specdocs-lint-"));
		const filePath = join(base, "docs", "prd", "PRD-001-bad.md");
		mkdirSync(join(base, "docs", "prd"), { recursive: true });
		writeFileSync(filePath, '---\ntitle: "Broken"\n---\n');

		const mockPi = createMockPi();
		specdocs(mockPi as unknown as ExtensionAPI);
		const toolResult = getEventHandler(mockPi, "tool_result");
		const notify = vi.fn();

		await toolResult?.({ toolName: "write", input: { file_path: filePath } }, { ui: { notify } });

		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Frontmatter warnings"), "warning");
	});

	it("runs specdocs-validate and reports errors/warnings", async () => {
		const base = mkdtempSync(join(tmpdir(), "pi-specdocs-validate-"));
		mkdirSync(join(base, "docs", "prd"), { recursive: true });
		mkdirSync(join(base, "docs", "adr"), { recursive: true });
		mkdirSync(join(base, "docs", "architecture"), { recursive: true });

		writeFileSync(
			join(base, "docs", "prd", "PRD-001-good.md"),
			'---\nprd: PRD-001\ntitle: "Good"\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n',
		);
		writeFileSync(
			join(base, "docs", "prd", "PRD-003-gap.md"),
			'---\nprd: PRD-003\ntitle: "Gap"\nstatus: Draft\nowner: Bob\ndate: 2025-01-01\nissue: 2\nversion: 1\n---\n',
		);
		writeFileSync(join(base, "docs", "prd", "bad-name.md"), "# invalid filename\n");
		writeFileSync(
			join(base, "docs", "adr", "ADR-0002-gap.md"),
			'---\nadr: ADR-0002\ntitle: "Gap ADR"\nstatus: Proposed\ndate: 2025-01-01\nprd: PRD-001\n---\n',
		);

		const mockPi = createMockPi();
		specdocs(mockPi as unknown as ExtensionAPI);
		const handler = getCommandHandler(mockPi, "specdocs-validate");
		const notify = vi.fn();

		await handler?.({}, { cwd: base, ui: { notify } });

		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Numbering gap: PRD-002 is missing"), "error");
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("filename doesn't match PRD-NNN-*.md pattern"),
			"error",
		);
	});
});
