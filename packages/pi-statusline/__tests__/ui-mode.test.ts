import { describe, expect, it, vi } from "vitest";
import { createUiOnlyHandler } from "../extensions/ui-mode.js";

describe("UI-mode event helpers", () => {
  it("skips handlers when UI is unavailable", async () => {
    const handler = vi.fn();
    const uiOnly = createUiOnlyHandler(handler);

    const result = await uiOnly({ type: "event" }, { hasUI: false });

    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs handlers when UI is available", async () => {
    const handler = vi.fn(async () => "handled");
    const uiOnly = createUiOnlyHandler(handler);

    const result = await uiOnly({ type: "event" }, { hasUI: true });

    expect(result).toBe("handled");
    expect(handler).toHaveBeenCalledOnce();
  });
});
