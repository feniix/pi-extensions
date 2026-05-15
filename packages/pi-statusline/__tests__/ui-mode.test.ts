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

  it("treats stale context access like an unavailable UI", async () => {
    const handler = vi.fn();
    const uiOnly = createUiOnlyHandler(handler);
    const staleCtx = {
      get hasUI() {
        throw new Error("This extension ctx is stale after session replacement or reload");
      },
    };

    await expect(Promise.resolve(uiOnly({ type: "event" }, staleCtx))).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("rethrows non-stale UI availability failures", async () => {
    const handler = vi.fn();
    const uiOnly = createUiOnlyHandler(handler);
    const brokenCtx = {
      get hasUI() {
        throw new Error("boom");
      },
    };

    await expect(uiOnly({ type: "event" }, brokenCtx)).rejects.toThrow("boom");
    expect(handler).not.toHaveBeenCalled();
  });

  it("swallows stale async handler failures", async () => {
    const handler = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("This extension ctx is stale after session replacement or reload");
    });
    const uiOnly = createUiOnlyHandler(handler);

    await expect(uiOnly({ type: "event" }, { hasUI: true })).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rethrows non-stale handler failures", async () => {
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const uiOnly = createUiOnlyHandler(handler);

    await expect(uiOnly({ type: "event" }, { hasUI: true })).rejects.toThrow("boom");
  });
});
