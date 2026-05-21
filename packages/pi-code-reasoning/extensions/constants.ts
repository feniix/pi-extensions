import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

export const SETTINGS_KEY = "pi-code-reasoning";

export const DEFAULT_CONFIG_FILE: Record<string, unknown> = {
  maxBytes: DEFAULT_MAX_BYTES,
  maxLines: DEFAULT_MAX_LINES,
};

export const CODE_REASONING_FLAGS = {
  configFile: "--code-reasoning-config-file",
  legacyConfigFile: "--code-reasoning-config",
  maxBytes: "--code-reasoning-max-bytes",
  maxLines: "--code-reasoning-max-lines",
} as const;

export const CODE_REASONING_TOOLS = {
  reasoning: "code_reasoning",
  status: "code_reasoning_status",
  reset: "code_reasoning_reset",
} as const;
