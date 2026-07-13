import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanonicalJsonError, canonicalJson, canonicalSha256 } from "../extensions/evaluation-receipts.js";

describe("evaluation receipt canonicalization", () => {
  it("matches the RFC 8785 primitive and recursive sorting example", () => {
    const value = {
      numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27],
      string: '€$\u000f\nA\'B"\\\\"/',
      literals: [null, true, false],
    };

    expect(canonicalJson(value)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts property names by raw UTF-16 code units while preserving array order", () => {
    const value = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
      nested: [
        { z: 1, a: 2 },
        { b: 3, a: 4 },
      ],
    };

    expect(canonicalJson(value)).toBe(
      '{"\\r":"Carriage Return","1":"One","nested":[{"a":2,"z":1},{"a":4,"b":3}],"":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it("preserves Unicode without normalization and emits stable UTF-8 SHA-256", () => {
    const value = { decomposed: "e\u0301", composed: "é", negativeZero: -0 };
    const canonical = canonicalJson(value);
    expect(canonical).toBe('{"composed":"é","decomposed":"é","negativeZero":0}');
    expect(canonicalSha256(value)).toEqual({
      canonical,
      byteLength: Buffer.byteLength(canonical, "utf8"),
      digest: createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex"),
    });
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["undefined", undefined],
    ["bigint", 1n],
    ["function", () => undefined],
    ["symbol", Symbol("unsafe")],
    ["date", new Date(0)],
    ["lone high surrogate", "\ud800"],
    ["lone low surrogate", "\udc00"],
    ["lone surrogate property", { "\ud800": true }],
  ])("rejects non-I-JSON input: %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("rejects cycles, sparse arrays, accessors, hidden fields, symbols, and custom prototypes", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cycle/i);

    const sparse = [1, 2, 3];
    delete sparse[1];
    expect(() => canonicalJson(sparse)).toThrow(/sparse/i);

    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => "unsafe" });
    expect(() => canonicalJson(accessor)).toThrow(/data property/i);

    const hidden = { visible: true };
    Object.defineProperty(hidden, "secret", { value: "unsafe", enumerable: false });
    expect(() => canonicalJson(hidden)).toThrow(/data property|non-JSON/i);

    const symbolic = { visible: true, [Symbol("secret")]: "unsafe" };
    expect(() => canonicalJson(symbolic)).toThrow(/non-JSON/i);

    const custom = Object.assign(Object.create({ inherited: "unsafe" }), { visible: true });
    expect(() => canonicalJson(custom)).toThrow(/plain JSON object/i);
  });

  it("accepts shared acyclic values and frozen JSON data", () => {
    const shared = Object.freeze({ b: 2, a: 1 });
    expect(canonicalJson({ right: shared, left: shared })).toBe('{"left":{"a":1,"b":2},"right":{"a":1,"b":2}}');
  });
});
