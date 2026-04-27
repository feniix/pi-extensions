import { describe, expect, it } from "vitest";
import {
  getConductorBackendAdapter,
  getConductorRuntimeModeStatus,
  inspectConductorBackends,
  inspectConductorRuntimeModes,
} from "../extensions/backends.js";

describe("conductor backend inspection", () => {
  it("always reports the native backend as available", () => {
    const status = inspectConductorBackends({ resolvePackage: () => null });

    expect(status.native).toMatchObject({
      available: true,
      canonicalStateOwner: "conductor",
      capabilities: { canStartRun: true, supportsScopedChildTools: true },
    });
  });

  it("treats pi-subagents as an optional adapter", () => {
    const unavailable = inspectConductorBackends({ resolvePackage: () => null });
    expect(unavailable.piSubagents).toMatchObject({ available: false, canonicalStateOwner: "conductor" });

    const available = inspectConductorBackends({ resolvePackage: () => "/tmp/pi-subagents/package.json" });
    expect(available.piSubagents).toMatchObject({
      available: false,
      packagePath: "/tmp/pi-subagents/package.json",
      capabilities: { canStartRun: false },
    });
  });

  it("exposes backend adapters with fail-closed pi-subagents dispatch", () => {
    const native = getConductorBackendAdapter("native");
    expect(native.preflight().available).toBe(true);
    expect(native.dispatch()).toMatchObject({ ok: true });
    const piSubagents = getConductorBackendAdapter("pi-subagents", { resolvePackage: () => null });
    expect(piSubagents.preflight()).toMatchObject({ available: false, capabilities: { canStartRun: false } });
    expect(piSubagents.dispatch()).toMatchObject({ ok: false });
  });

  it("reports runtime mode availability without requiring tmux", () => {
    const status = inspectConductorRuntimeModes();

    expect(status.headless).toMatchObject({
      mode: "headless",
      available: true,
      canonicalStateOwner: "conductor",
      capabilities: { canStartRun: true, canSuperviseLiveOutput: false },
    });
    expect(status.tmux).toMatchObject({
      mode: "tmux",
      available: false,
      capabilities: { canStartRun: false, canSuperviseLiveOutput: true, requiresExternalRunner: true },
    });
    expect(status.itermTmux).toMatchObject({
      mode: "iterm-tmux",
      available: false,
      capabilities: { viewerOnly: true },
    });
    expect(getConductorRuntimeModeStatus("headless").available).toBe(true);
    expect(getConductorRuntimeModeStatus("tmux").diagnostic).toMatch(/not implemented yet/i);
  });

  it("reports pi-subagents available when an explicit dispatcher is injected", async () => {
    const piSubagents = getConductorBackendAdapter("pi-subagents", {
      resolvePackage: () => "/tmp/pi-subagents/package.json",
      dispatcher: async () => ({ ok: true, backendRunId: "child-run-1", diagnostic: null }),
    });

    expect(piSubagents.preflight()).toMatchObject({ available: true, capabilities: { canStartRun: true } });
    await expect(piSubagents.dispatch({})).resolves.toMatchObject({ ok: true, backendRunId: "child-run-1" });
  });
});
