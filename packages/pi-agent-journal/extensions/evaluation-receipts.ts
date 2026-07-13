import { createHash } from "node:crypto";

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function assertUnicode(value: string, field: string): void {
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

function serializeString(value: string, field: string): string {
  assertUnicode(value, field);
  return JSON.stringify(value);
}

function arrayDescriptors(value: unknown[], field: string): PropertyDescriptor[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new CanonicalJsonError(`${field} must be a plain JSON array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"].sort();
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    JSON.stringify((ownKeys as string[]).sort()) !== JSON.stringify(expected)
  ) {
    throw new CanonicalJsonError(`${field} contains non-JSON fields or sparse items`);
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

function serialize(value: unknown, field: string, stack: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return serializeString(value, field);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalJsonError(`${field} contains a non-finite number`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError(`${field} contains unsupported ${typeof value} data`);
  }
  if (stack.has(value)) throw new CanonicalJsonError(`${field} contains a cycle`);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = arrayDescriptors(value, field);
      return `[${descriptors.map((descriptor, index) => serialize(descriptor.value, `${field}[${index}]`, stack)).join(",")}]`;
    }
    const entries = objectDescriptors(value, field);
    return `{${entries
      .map(
        ([key, descriptor]) =>
          `${serializeString(key, `${field} property name`)}:${serialize(descriptor.value, `${field}.${key}`, stack)}`,
      )
      .join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, "$", new WeakSet<object>());
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
