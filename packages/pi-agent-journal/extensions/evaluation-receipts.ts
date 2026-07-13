import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

export const CANONICAL_JSON_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxArrayLength: 10_000,
  maxObjectProperties: 10_000,
  maxStringBytes: 256 * 1024,
  maxOutputBytes: 1024 * 1024,
});

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

class CanonicalWriter {
  readonly chunks: string[] = [];
  byteLength = 0;

  append(value: string): void {
    const nextBytes = Buffer.byteLength(value, "utf8");
    if (this.byteLength + nextBytes > CANONICAL_JSON_LIMITS.maxOutputBytes) {
      throw new CanonicalJsonError("canonical JSON output byte limit exceeded");
    }
    this.chunks.push(value);
    this.byteLength += nextBytes;
  }

  finish(): string {
    return this.chunks.join("");
  }
}

interface SerializationContext {
  writer: CanonicalWriter;
  stack: WeakSet<object>;
  nodes: number;
}

function assertUnicode(value: string, field: string): void {
  if (Buffer.byteLength(value, "utf8") > CANONICAL_JSON_LIMITS.maxStringBytes) {
    throw new CanonicalJsonError(`${field} exceeds the string byte limit`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError(`${field} contains a lone high surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalJsonError(`${field} contains a lone low surrogate`);
    }
  }
}

function serializeString(value: string, field: string, writer: CanonicalWriter): void {
  assertUnicode(value, field);
  writer.append(JSON.stringify(value));
}

function arrayDescriptors(value: unknown[], field: string): PropertyDescriptor[] {
  if (value.length > CANONICAL_JSON_LIMITS.maxArrayLength) {
    throw new CanonicalJsonError(`${field} exceeds the array length limit`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new CanonicalJsonError(`${field} must be a plain JSON array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key !== "string")) {
    throw new CanonicalJsonError(`${field} contains non-JSON fields or sparse items`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== value.length) {
    throw new CanonicalJsonError(`${field}.length must be an array data property`);
  }
  const descriptors: PropertyDescriptor[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new CanonicalJsonError(`${field}[${index}] must be an enumerable data property`);
    }
    descriptors.push(descriptor);
  }
  return descriptors;
}

function objectDescriptors(value: object, field: string): Array<[string, PropertyDescriptor]> {
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CanonicalJsonError(`${field} must be a plain JSON object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > CANONICAL_JSON_LIMITS.maxObjectProperties) {
    throw new CanonicalJsonError(`${field} exceeds the object property limit`);
  }
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new CanonicalJsonError(`${field} contains non-JSON symbol fields`);
  }
  const entries = (ownKeys as string[]).map((key): [string, PropertyDescriptor] => {
    assertUnicode(key, `${field} property name`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new CanonicalJsonError(`${field}.${key} must be an enumerable data property`);
    }
    return [key, descriptor];
  });
  return entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

function serialize(value: unknown, field: string, depth: number, context: SerializationContext): void {
  if (depth > CANONICAL_JSON_LIMITS.maxDepth) throw new CanonicalJsonError(`${field} exceeds the depth limit`);
  context.nodes += 1;
  if (context.nodes > CANONICAL_JSON_LIMITS.maxNodes)
    throw new CanonicalJsonError("canonical JSON node limit exceeded");

  if (value === null) {
    context.writer.append("null");
    return;
  }
  if (typeof value === "string") {
    serializeString(value, field, context.writer);
    return;
  }
  if (typeof value === "boolean") {
    context.writer.append(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalJsonError(`${field} contains a non-finite number`);
    context.writer.append(JSON.stringify(value));
    return;
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError(`${field} contains unsupported ${typeof value} data`);
  }
  if (isProxy(value)) throw new CanonicalJsonError(`${field} contains a Proxy`);
  if (context.stack.has(value)) throw new CanonicalJsonError(`${field} contains a cycle`);

  context.stack.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = arrayDescriptors(value, field);
      context.writer.append("[");
      descriptors.forEach((descriptor, index) => {
        if (index > 0) context.writer.append(",");
        serialize(descriptor.value, `${field}[${index}]`, depth + 1, context);
      });
      context.writer.append("]");
      return;
    }

    const entries = objectDescriptors(value, field);
    context.writer.append("{");
    entries.forEach(([key, descriptor], index) => {
      if (index > 0) context.writer.append(",");
      serializeString(key, `${field} property name`, context.writer);
      context.writer.append(":");
      serialize(descriptor.value, `${field}.${key}`, depth + 1, context);
    });
    context.writer.append("}");
  } finally {
    context.stack.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  const writer = new CanonicalWriter();
  serialize(value, "$", 0, { writer, stack: new WeakSet<object>(), nodes: 0 });
  return writer.finish();
}

export function canonicalSha256(value: unknown): { canonical: string; byteLength: number; digest: string } {
  const canonical = canonicalJson(value);
  const bytes = Buffer.from(canonical, "utf8");
  return {
    canonical,
    byteLength: bytes.byteLength,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}
