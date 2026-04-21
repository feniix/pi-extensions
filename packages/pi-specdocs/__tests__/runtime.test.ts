import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

    await toolResult?.({ toolName: "write", input: { file_path: filePath } }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Frontmatter warnings"), "warning");
  });

  it("warns on invalid architecture filename after write/edit tool results", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-lint-plan-name-"));
    const filePath = join(base, "docs", "architecture", "architecture-outline.md");
    mkdirSync(join(base, "docs", "architecture"), { recursive: true });
    writeFileSync(filePath, "# Invalid plan name\n");

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const toolResult = getEventHandler(mockPi, "tool_result");
    const notify = vi.fn();

    await toolResult?.({ toolName: "write", input: { file_path: filePath } }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("plan-*.md pattern"), "warning");
  });

  it("warns on missing required sections and tables for a plan after write/edit tool results", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-lint-plan-structure-"));
    const filePath = join(base, "docs", "architecture", "plan-test-feature.md");
    mkdirSync(join(base, "docs", "architecture"), { recursive: true });
    writeFileSync(
      filePath,
      '---\ntitle: "Plan"\nprd: "PRD-001-test-feature"\ndate: 2025-01-01\nauthor: "Alice"\nstatus: Draft\n---\n\n# Plan: Test\n\n## Source\n',
    );

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const toolResult = getEventHandler(mockPi, "tool_result");
    const notify = vi.fn();

    await toolResult?.({ toolName: "write", input: { file_path: filePath } }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Missing required section: ## ADR Index"), "warning");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Missing required table in section ADR Index"), "warning");
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
    writeFileSync(
      join(base, "docs", "architecture", "plan-invalid.md"),
      '---\ntitle: "Plan"\nprd: "PRD-001"\ndate: 2025-01-01\nstatus: Draft\n---\n',
    );
    writeFileSync(join(base, "docs", "architecture", "architecture-outline.md"), "# invalid plan filename\n");

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
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("docs/architecture/architecture-outline.md: filename doesn't match plan-*.md pattern"),
      "error",
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("PLAN"), "error");
  });

  it("reports duplicate PRD and ADR numbers during workspace validation", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-duplicate-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    mkdirSync(join(base, "docs", "adr"), { recursive: true });

    writeFileSync(
      join(base, "docs", "prd", "PRD-002-alpha.md"),
      '---\nprd: PRD-002\ntitle: "Alpha"\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n',
    );
    writeFileSync(
      join(base, "docs", "prd", "PRD-002-beta.md"),
      '---\nprd: PRD-002\ntitle: "Beta"\nstatus: Draft\nowner: Bob\ndate: 2025-01-01\nissue: 2\nversion: 1\n---\n',
    );
    writeFileSync(
      join(base, "docs", "adr", "ADR-0003-first.md"),
      '---\nadr: ADR-0003\ntitle: "First"\nstatus: Proposed\ndate: 2025-01-01\nprd: PRD-002\n---\n',
    );
    writeFileSync(
      join(base, "docs", "adr", "ADR-0003-second.md"),
      '---\nadr: ADR-0003\ntitle: "Second"\nstatus: Proposed\ndate: 2025-01-01\nprd: PRD-002\n---\n',
    );

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-validate");
    const notify = vi.fn();

    await handler?.({}, { cwd: base, ui: { notify } });

    const [message, level] = notify.mock.calls.at(-1) ?? [];
    expect(level).toBe("error");
    expect(message).toContain("Duplicate PRD number: PRD-002");
    expect(message).toContain("docs/prd/PRD-002-alpha.md");
    expect(message).toContain("docs/prd/PRD-002-beta.md");
    expect(message).toContain("Duplicate ADR number: ADR-0003");
    expect(message).toContain("docs/adr/ADR-0003-first.md");
    expect(message).toContain("docs/adr/ADR-0003-second.md");
  });

  it("warns on duplicate numbers after write/edit tool results", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-duplicate-lint-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    const first = join(base, "docs", "prd", "PRD-007-first.md");
    const second = join(base, "docs", "prd", "PRD-007-second.md");

    writeFileSync(
      first,
      '---\nprd: PRD-007\ntitle: "First"\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n',
    );
    writeFileSync(
      second,
      '---\nprd: PRD-007\ntitle: "Second"\nstatus: Draft\nowner: Bob\ndate: 2025-01-01\nissue: 2\nversion: 1\n---\n',
    );

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const toolResult = getEventHandler(mockPi, "tool_result");
    const notify = vi.fn();

    await toolResult?.({ toolName: "write", input: { file_path: second } }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Duplicate PRD number: PRD-007"), "warning");
  });

  it("reports a clear error when specdocs-format targets a nonexistent path", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-"));
    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: "docs/prd/PRD-999-missing.md" }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("does not exist"), "error");
  });

  it("reports a clear error when specdocs-format targets an unsupported markdown file", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-unsupported-"));
    mkdirSync(join(base, "docs"), { recursive: true });
    writeFileSync(join(base, "docs", "notes.md"), "# Notes\n");
    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: "docs/notes.md" }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("unsupported spec document path"), "error");
  });

  it("reports no changes for an already normalized spec document", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-noop-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    const filePath = join(base, "docs", "prd", "PRD-001-test.md");
    const content =
      '---\ntitle: "Test"\nprd: PRD-001\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n\n# Test\n\n## 1. Problem & Context\n\nBody\n';
    writeFileSync(filePath, content);

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: filePath }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No formatting changes were needed"), "info");
  });

  it("formats frontmatter and section spacing in place", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-rewrite-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    const filePath = join(base, "docs", "prd", "PRD-001-test.md");
    writeFileSync(
      filePath,
      '---\ntitle: "Test"\nprd: PRD-001\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n# Test\n## 1. Problem & Context\nBody\n',
    );

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: filePath }, { cwd: base, ui: { notify } });

    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain('---\n\n# Test\n\n## 1. Problem & Context\n\nBody\n');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Formatted spec document"), "info");
  });

  it("formats gfm tables with normalized spacing", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-table-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    const filePath = join(base, "docs", "prd", "PRD-001-test.md");
    writeFileSync(
      filePath,
      '---\ntitle: "Test"\nprd: PRD-001\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n\n# Test\n\n## 1. Problem & Context\n\n|A|B|\n|-|-|\n|1|22|\n',
    );

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: filePath }, { cwd: base, ui: { notify } });

    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain('| A | B  |');
    expect(updated).toContain('| - | -- |');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Formatted spec document"), "info");
  });

  it("preserves thematic breaks while normalizing surrounding spacing", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-break-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    const filePath = join(base, "docs", "prd", "PRD-001-test.md");
    writeFileSync(
      filePath,
      '---\ntitle: "Test"\nprd: PRD-001\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n# Test\n---\n## 1. Problem & Context\nBody\n',
    );

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: filePath }, { cwd: base, ui: { notify } });

    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain('# Test\n\n---\n\n## 1. Problem & Context');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Formatted spec document"), "info");
  });

  it("preserves gfm task list and strikethrough content", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-gfm-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    const filePath = join(base, "docs", "prd", "PRD-001-test.md");
    writeFileSync(
      filePath,
      '---\ntitle: "Test"\nprd: PRD-001\nstatus: Draft\nowner: Alice\ndate: 2025-01-01\nissue: 1\nversion: 1\n---\n\n# Test\n\n## 1. Problem & Context\n- [x] done\n- [ ] todo\n~~old~~ text\n',
    );

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: filePath }, { cwd: base, ui: { notify } });

    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain('[x] done');
    expect(updated).toContain('[ ] todo');
    expect(updated).toContain('~~old~~ text');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Formatted spec document"), "info");
  });

  it("reports a clear error when specdocs-format targets malformed frontmatter", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-specdocs-format-malformed-"));
    mkdirSync(join(base, "docs", "prd"), { recursive: true });
    const filePath = join(base, "docs", "prd", "PRD-001-test.md");
    writeFileSync(filePath, '---\ntitle: "Broken"\nstatus: [Draft\n---\n# Test\n');

    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);
    const handler = getCommandHandler(mockPi, "specdocs-format");
    const notify = vi.fn();

    await handler?.({ path: filePath }, { cwd: base, ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("malformed frontmatter"), "error");
  });
});
