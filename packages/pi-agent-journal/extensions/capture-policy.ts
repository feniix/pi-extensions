import { createHash } from "node:crypto";
import type { EntryType } from "./domain.js";

export type CaptureEvent =
  | { kind: "assistant_message"; text: string }
  | { kind: "tool_result"; tool: string; success: boolean; output?: string }
  | { kind: "validation"; command: string; success: boolean; artifacts?: string[] }
  | { kind: "artifact_changed"; paths: string[] };

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export function containsLikelySecret(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

/** Scan every string leaf without retaining or returning candidate bytes. */
export function containsLikelySecretValue(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return containsLikelySecret(value);
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsLikelySecretValue(item, seen));
  return Object.values(value as Record<string, unknown>).some((item) => containsLikelySecretValue(item, seen));
}

export interface CaptureCandidate {
  type: EntryType;
  content: string;
  artifactPaths: string[];
  fingerprint: string;
}

function candidate(type: EntryType, content: string, artifactPaths: string[]): CaptureCandidate | null {
  if (containsLikelySecret(content)) return null;
  return {
    type,
    content,
    artifactPaths,
    fingerprint: createHash("sha256").update(JSON.stringify({ type, content, artifactPaths })).digest("hex"),
  };
}

export function captureDeterministicFacts(event: CaptureEvent): CaptureCandidate[] {
  switch (event.kind) {
    case "validation": {
      if (!event.success) return [];
      const validation = candidate("validation", `${event.command} passed`, [...new Set(event.artifacts ?? [])].sort());
      return validation ? [validation] : [];
    }
    case "artifact_changed": {
      const paths = [...new Set(event.paths)].sort();
      if (paths.length === 0) return [];
      const observation = candidate("observation", `${paths.length} artifact(s) changed`, paths);
      return observation ? [observation] : [];
    }
    case "assistant_message":
    case "tool_result":
      return [];
  }
}
