import { describe, expect, it } from "vitest";
import { inspectConductorBackends } from "../extensions/backends.js";

describe("conductor backend inspection", () => {
  it("always reports the native backend as available", () => {
    const status = inspectConductorBackends({ resolvePackage: () => null });

    expect(status.native).toMatchObject({ available: true, canonicalStateOwner: "conductor" });
  });

  it("treats pi-subagents as an optional adapter", () => {
    const unavailable = inspectConductorBackends({ resolvePackage: () => null });
    expect(unavailable.piSubagents).toMatchObject({ available: false, canonicalStateOwner: "conductor" });

    const available = inspectConductorBackends({ resolvePackage: () => "/tmp/pi-subagents/package.json" });
    expect(available.piSubagents).toMatchObject({ available: true, packagePath: "/tmp/pi-subagents/package.json" });
  });
});
