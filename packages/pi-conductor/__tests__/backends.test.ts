import { describe, expect, it } from "vitest";
import { getConductorBackendAdapter, inspectConductorBackends } from "../extensions/backends.js";

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
});
