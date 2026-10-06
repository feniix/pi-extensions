import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { TerminalSession } from "./terminal-harness.js";

let session: TerminalSession | undefined;
const modes = ["fullscreen", "regular"] as const;
const themes = ["dark", "light"] as const;
const cases = modes.flatMap((mode) => themes.map((theme) => ({ mode, theme })));

afterEach(async () => {
  await session?.close();
  session = undefined;
});

it.each(cases)("renders the local statusline using workspace pi: $mode / $theme", async (options) => {
  session = await TerminalSession.start({ ...options, name: "startup" });
  await session.waitFor(
    "startup footer",
    (screen) => screen.includes("Model: Smoke Model") && screen.includes("Act: idle") && screen.includes("⎇ smoke"),
  );
  expect(session.version).toMatch(/^1\./);
  expect(session.footer()).toHaveLength(2);
});

it.each(cases)("reflows narrow and wide terminal columns: $mode / $theme", async (options) => {
  session = await TerminalSession.start({ ...options, name: "resize" });
  await session.waitFor("startup", (screen) => screen.includes("Act: idle"));
  for (const width of [80, 40, 20, 120, 140]) {
    await session.resize(width);
    await session.waitFor(`width-${width}`, () => {
      const footer = session?.footer() ?? [];
      return (
        footer.length === 2 && footer[0].startsWith(width <= 80 ? "Ctx:" : "Model:") && footer[1].includes("Act: idle")
      );
    });
    expect(session.footer()).toHaveLength(2);
    expect(session.footer()[1]).toContain(`W${width}`);
  }
});

it.each(cases)("preserves Unicode statuses and removes them: $mode / $theme", async (options) => {
  session = await TerminalSession.start({ ...options, name: "statuses" });
  await session.waitFor("startup", (screen) => screen.includes("Act: idle"));
  await session.command("/smoke-status");
  await session.waitFor("statuses", (screen) => screen.includes("SMOKE READY") && screen.includes("SECOND STATUS"));
  expect(session.footer()[1]).toContain("🧪 项目 é — SMOKE READY");
  expect(session.cellWidth("🧪")).toBe(2);
  await session.resize(40);
  expect(session.footer()[1]).toContain("Act: idle");
  expect(session.footer()[1]).toContain("🧪");
  await session.resize(140);
  await session.command("/smoke-clear");
  await session.waitFor(
    "statuses-cleared",
    (screen) => !screen.includes("SMOKE READY") && !screen.includes("SECOND STATUS"),
  );
});

it.each(cases)("waits, restores idle, and refreshes thinking: $mode / $theme", async (options) => {
  session = await TerminalSession.start({ ...options, name: "lifecycle" });
  await session.waitFor("startup", (screen) => screen.includes("Act: idle"));
  await session.command("/smoke-prompt");
  await session.waitFor(
    "waiting",
    (screen) => screen.includes("SMOKE CONFIRM") && screen.includes("Act: waiting for user"),
  );
  session.key("\x1b");
  await session.waitFor("dismissed", (screen) => screen.includes("Act: idle") && !screen.includes("SMOKE CONFIRM"));
  await session.command("/smoke-thinking");
  await session.waitFor("thinking", (screen) => screen.includes("Thinking: high"));
  expect(session.footer()[0]).toContain("↑0/↓0");
});

it.each(cases)("normalizes multiline statuses into the footer: $mode / $theme", async (options) => {
  session = await TerminalSession.start({ ...options, name: "multiline" });
  await session.waitFor("startup", (screen) => screen.includes("Act: idle"));
  await session.command("/smoke-multiline");
  await session.waitFor("multiline", () => session?.footer()[1]?.includes("MULTILINE SECOND DONE") ?? false);
  expect(session.footer()).toHaveLength(2);
  expect(session.screen().filter((line) => line.includes("MULTILINE SECOND DONE"))).toHaveLength(1);
  await session.resize(40);
  expect(session.footer()[1]).toContain("MULTILINE SECOND DONE");
});

it.each(modes)("uses distinct native dark/light footer colors in %s mode", async (mode) => {
  const colors: number[] = [];
  for (const theme of themes) {
    session = await TerminalSession.start({ mode, theme, name: "palette" });
    await session.waitFor("startup", (screen) => screen.includes("Model: Smoke Model"));
    const color = session.modelColor();
    expect(color?.rgb).toBe(true);
    expect(color?.value).toBeTypeOf("number");
    if (color) colors.push(color.value);
    await session.close();
    session = undefined;
  }
  expect(colors).toHaveLength(2);
  expect(colors[0]).not.toBe(colors[1]);
});

it("rejects an attempted model request instead of silently invoking a real provider", async () => {
  session = await TerminalSession.start({ mode: "fullscreen", theme: "dark", name: "request-guard" });
  await session.waitFor("startup", (screen) => screen.includes("Act: idle"));
  await session.command("Deliberate smoke guard probe");
  await expect(session.waitFor("request-guard", () => false)).rejects.toThrow("Unexpected runtime error");
  expect(session.modelRequestAttempted()).toBe(true);
});

it("fails bounded screen waits and saves readable screen and ANSI evidence", async () => {
  session = await TerminalSession.start({ mode: "fullscreen", theme: "dark", name: "timeout-artifacts" });
  await session.waitFor("startup", (screen) => screen.includes("Act: idle"));
  await expect(session.waitFor("deliberate-timeout", () => false, 100)).rejects.toThrow("Timed out");
  const directory = resolve(import.meta.dirname, "../../../../coverage/terminal/fullscreen-dark/timeout-artifacts");
  expect(await readFile(join(directory, "FAILED-deliberate-timeout.txt"), "utf8")).toContain("Model: Smoke Model");
  expect(await readFile(join(directory, "terminal.ansi"), "utf8")).toContain("\u001B[");
});
