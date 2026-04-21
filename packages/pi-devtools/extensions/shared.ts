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

export function errorResult(text: string, error: unknown, details: Record<string, unknown> = {}): ToolResult {
  if (error instanceof Error) {
    return {
      content: [{ type: "text", text: `${text}: ${error.message}` }],
      isError: true,
      details: { ...details, error: error.message },
    };
  }
  const code = String(error);
  return {
    content: [{ type: "text", text }],
    isError: true,
    details: { ...details, error: code },
  };
}
