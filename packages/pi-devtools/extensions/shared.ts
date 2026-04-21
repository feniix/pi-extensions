export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function successResult(text: string, details: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function errorResult(prefix: string, error: unknown, details: Record<string, unknown> = {}): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${prefix}: ${message}` }],
    isError: true,
    details: { ...details, error: message },
  };
}
