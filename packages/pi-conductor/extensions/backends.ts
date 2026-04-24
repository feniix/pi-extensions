import { createRequire } from "node:module";

export interface ConductorBackendStatus {
  available: boolean;
  canonicalStateOwner: "conductor";
  packagePath?: string | null;
  diagnostic?: string | null;
}

export interface ConductorBackendsStatus {
  native: ConductorBackendStatus;
  piSubagents: ConductorBackendStatus;
}

export function inspectConductorBackends(
  input: { resolvePackage?: (specifier: string) => string | null } = {},
): ConductorBackendsStatus {
  const resolvePackage =
    input.resolvePackage ??
    ((specifier: string) => {
      try {
        return createRequire(import.meta.url).resolve(specifier);
      } catch {
        return null;
      }
    });
  const piSubagentsPath = resolvePackage("pi-subagents/package.json");

  return {
    native: {
      available: true,
      canonicalStateOwner: "conductor",
      diagnostic: null,
    },
    piSubagents: {
      available: piSubagentsPath !== null,
      canonicalStateOwner: "conductor",
      packagePath: piSubagentsPath,
      diagnostic: piSubagentsPath
        ? null
        : "Optional pi-subagents adapter is not installed or not resolvable from pi-conductor",
    },
  };
}
