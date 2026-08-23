import { describe, expect, it } from "vitest";
import { parseTierSegment } from "../../../src/empire/boostTier";

describe("parseTierSegment", () => {
  it("parses an explicit T3 suffix to a forced tier 3 result", () => {
    expect(parseTierSegment("T3")).toEqual({ kind: "forced", tier: 3 });
  });

  it("parses an explicit T2 suffix to a forced tier 2 result", () => {
    expect(parseTierSegment("T2")).toEqual({ kind: "forced", tier: 2 });
  });

  it("parses an explicit T1 suffix to a forced tier 1 result", () => {
    expect(parseTierSegment("T1")).toEqual({ kind: "forced", tier: 1 });
  });

  it("parses a bare T marker to a greedy-selection result", () => {
    expect(parseTierSegment("T")).toEqual({ kind: "greedy" });
  });

  it("parses an omitted (undefined) segment to a greedy-selection result", () => {
    expect(parseTierSegment(undefined)).toEqual({ kind: "greedy" });
  });

  it("rejects an out-of-range tier number like T4 as invalid", () => {
    const result = parseTierSegment("T4");
    expect(result.kind).toBe("invalid");
    expect((result as { reason: string }).reason).toMatch(/T4/);
  });

  it("rejects a lowercase 't3' as invalid (case-sensitive)", () => {
    const result = parseTierSegment("t3");
    expect(result.kind).toBe("invalid");
  });

  it("rejects a tier of zero as invalid", () => {
    expect(parseTierSegment("T0").kind).toBe("invalid");
  });

  it("rejects a non-tier segment (e.g. a room name) as invalid", () => {
    expect(parseTierSegment("W1N1").kind).toBe("invalid");
  });

  it("rejects an empty string as invalid, not the same as omitted", () => {
    expect(parseTierSegment("").kind).toBe("invalid");
  });
});
