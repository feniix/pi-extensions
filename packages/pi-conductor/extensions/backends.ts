import { createRequire } from "node:module";

export type ConductorBackendKind = "native" | "pi-subagents";

export interface ConductorBackendCapabilities {
  canStartRun: boolean;
  canRunForeground: boolean;
  supportsScopedChildTools: boolean;
  requiresReviewOnExit: boolean;
}

export interface ConductorBackendStatus {
  available: boolean;
  canonicalStateOwner: "conductor";
  capabilities: ConductorBackendCapabilities;
  packagePath?: string | null;
  diagnostic?: string | null;
}

export interface ConductorBackendsStatus {
  native: ConductorBackendStatus;
  piSubagents: ConductorBackendStatus;
}

export interface ConductorBackendDispatchResult {
  ok: boolean;
  diagnostic: string | null;
  backendRunId?: string | null;
}

export type ConductorBackendDispatcher = (
  input: unknown,
) => ConductorBackendDispatchResult | Promise<ConductorBackendDispatchResult>;

export interface ConductorBackendAdapter {
  backend: ConductorBackendKind;
  preflight(): ConductorBackendStatus;
  dispatch(input?: unknown): ConductorBackendDispatchResult | Promise<ConductorBackendDispatchResult>;
}

const nativeCapabilities: ConductorBackendCapabilities = {
  canStartRun: true,
  canRunForeground: true,
  supportsScopedChildTools: true,
  requiresReviewOnExit: true,
};

const unavailablePiSubagentsCapabilities: ConductorBackendCapabilities = {
  canStartRun: false,
  canRunForeground: false,
  supportsScopedChildTools: false,
  requiresReviewOnExit: true,
};

function resolvePiSubagents(input: { resolvePackage?: (specifier: string) => string | null } = {}): string | null {
  const resolvePackage =
    input.resolvePackage ??
    ((specifier: string) => {
      try {
        return createRequire(import.meta.url).resolve(specifier);
      } catch {
        return null;
      }
    });
  return resolvePackage("pi-subagents/package.json");
}

export function inspectConductorBackends(
  input: { resolvePackage?: (specifier: string) => string | null; dispatcher?: ConductorBackendDispatcher } = {},
): ConductorBackendsStatus {
  const piSubagentsPath = resolvePiSubagents(input);
  const piSubagentsAvailable = Boolean(piSubagentsPath && input.dispatcher);

  return {
    native: {
      available: true,
      canonicalStateOwner: "conductor",
      capabilities: nativeCapabilities,
      diagnostic: null,
    },
    piSubagents: {
      available: piSubagentsAvailable,
      canonicalStateOwner: "conductor",
      capabilities: piSubagentsAvailable ? nativeCapabilities : unavailablePiSubagentsCapabilities,
      packagePath: piSubagentsPath,
      diagnostic: piSubagentsAvailable
        ? null
        : piSubagentsPath
          ? "pi-subagents adapter is detected but dispatch is not implemented; conductor fails closed"
          : "Optional pi-subagents adapter is not installed or not resolvable from pi-conductor",
    },
  };
}

export function getConductorBackendAdapter(
  backend: ConductorBackendKind,
  input: { resolvePackage?: (specifier: string) => string | null; dispatcher?: ConductorBackendDispatcher } = {},
): ConductorBackendAdapter {
  return {
    backend,
    preflight() {
      const status = inspectConductorBackends(input);
      return backend === "native" ? status.native : status.piSubagents;
    },
    dispatch(dispatchInput?: unknown) {
      if (backend === "native") {
        return { ok: true, diagnostic: null };
      }
      if (input.dispatcher && resolvePiSubagents(input)) {
        return input.dispatcher(dispatchInput);
      }
      return { ok: false, diagnostic: "pi-subagents dispatch is not implemented; conductor fails closed" };
    },
  };
}
