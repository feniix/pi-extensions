import { closeSync, openSync, readSync, statSync } from "node:fs";

export function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  let bytes = 0;
  let output = "";
  for (const char of content) {
    const charBytes = Buffer.byteLength(char, "utf-8");
    if (bytes + charBytes > maxBytes) {
      return { content: output, truncated: true };
    }
    output += char;
    bytes += charBytes;
  }
  return { content: output, truncated: false };
}

export function boundedArtifactContent(
  artifactId: string,
  ref: string,
  content: string,
  maxBytes: number,
  diagnostic: string | null = null,
): { artifactId: string; ref: string; content: string; truncated: boolean; diagnostic: string | null } {
  return { artifactId, ref, ...truncateUtf8(content, maxBytes), diagnostic };
}

export function readBoundedTextFile(path: string, maxBytes: number): { content: string; truncated: boolean } {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size, maxBytes + 4));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const bounded = truncateUtf8(buffer.subarray(0, bytesRead).toString("utf-8"), maxBytes);
    return { content: bounded.content, truncated: bounded.truncated || size > maxBytes };
  } finally {
    closeSync(fd);
  }
}

export function fileHasBinaryPrefix(path: string): boolean {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size, 1024));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}
