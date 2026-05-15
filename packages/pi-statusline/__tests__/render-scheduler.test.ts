import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderScheduler } from "../extensions/render-scheduler.js";

describe("render scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("throttles render callbacks", async () => {
    const render = vi.fn();
    const scheduler = createRenderScheduler(100, () => false);
    scheduler.setRenderCallback(render);

    scheduler.rerender();
    scheduler.rerender();
    scheduler.rerender();

    expect(render).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(render).toHaveBeenCalledTimes(2);
  });

  it("clears recoverable stale render callbacks", () => {
    const render = vi.fn(() => {
      throw new Error("recoverable");
    });
    const scheduler = createRenderScheduler(100, (error) => error instanceof Error && error.message === "recoverable");
    scheduler.setRenderCallback(render);

    expect(() => scheduler.rerender(true)).not.toThrow();
    scheduler.rerender(true);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it("rethrows unrecoverable render callback failures", () => {
    const render = vi.fn(() => {
      throw new Error("boom");
    });
    const scheduler = createRenderScheduler(100, () => false);
    scheduler.setRenderCallback(render);

    expect(() => scheduler.rerender(true)).toThrow("boom");
  });

  it("cancels pending throttled renders on clear", async () => {
    const render = vi.fn();
    const scheduler = createRenderScheduler(100, () => false);
    scheduler.setRenderCallback(render);

    scheduler.rerender();
    scheduler.rerender();
    scheduler.clear();

    await vi.advanceTimersByTimeAsync(100);

    expect(render).toHaveBeenCalledTimes(1);
  });
});
