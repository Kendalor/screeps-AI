import { beforeEach, describe, expect, it } from "vitest";
import { loadMemory, resetMemoryCache } from "../../src/memory/cache";
import { stubGame } from "../helpers";

function stubMemoryGlobals(time: number, parsed: object): void {
  stubGame({ time });
  (globalThis as Record<string, unknown>).Memory = parsed;
  (globalThis as Record<string, unknown>).RawMemory = { _parsed: parsed };
}

describe("memory parse-skip cache", () => {
  beforeEach(() => resetMemoryCache());

  it("reinstates the cached memory object on the next consecutive tick, skipping the parse", () => {
    const original = { rooms: {}, marker: "cached" };
    stubMemoryGlobals(100, original);
    loadMemory();

    // next tick: the engine re-parsed a fresh object, but the cache should win
    stubMemoryGlobals(101, { rooms: {}, marker: "fresh-parse" });
    loadMemory();

    expect((globalThis as { Memory?: { marker?: string } }).Memory?.marker).toBe("cached");
  });

  it("falls back to the freshly parsed memory after a skipped tick", () => {
    stubMemoryGlobals(100, { rooms: {}, marker: "cached" });
    loadMemory();

    // two ticks later (e.g. after a global reset gap) the cache is stale
    stubMemoryGlobals(103, { rooms: {}, marker: "fresh-parse" });
    loadMemory();

    expect((globalThis as { Memory?: { marker?: string } }).Memory?.marker).toBe("fresh-parse");
  });
});
