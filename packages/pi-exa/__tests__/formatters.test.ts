/**
 * Unit tests for response-metadata formatting.
 *
 * The Exa API removed `resolvedSearchType` from the /search response on
 * 2026-05-01. These tests pin the shape pi-exa surfaces back to consumers.
 */

import { describe, expect, it } from "vitest";
import { toMetadata } from "../extensions/formatters.js";

describe("pi-exa toMetadata", () => {
  it("surfaces costDollars when present", () => {
    const result = toMetadata({ costDollars: { total: 0.01 } });
    expect(result.costDollars).toEqual({ total: 0.01 });
  });

  it("surfaces searchTime when present", () => {
    const result = toMetadata({ searchTime: 1234 });
    expect(result.searchTime).toBe(1234);
  });

  it("returns an empty object when no live fields are present", () => {
    expect(toMetadata({})).toEqual({});
  });

  it("does not surface resolvedSearchType even if the SDK still includes it", () => {
    // The field was removed from the live Exa API on 2026-05-01. pi-exa
    // must not re-expose it via tool details — consumers who read it
    // would silently receive stale data.
    const result = toMetadata({
      costDollars: { total: 0.01 },
      searchTime: 42,
      // Deliberately cast through unknown to simulate a stale SDK payload
      // without re-introducing the field in the static type.
      ...({ resolvedSearchType: "neural" } as unknown as Record<string, unknown>),
    });
    expect(result).not.toHaveProperty("resolvedSearchType");
    expect(result.costDollars).toEqual({ total: 0.01 });
    expect(result.searchTime).toBe(42);
  });
});
