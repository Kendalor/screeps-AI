import { describe, it, expect } from "vitest";
import { buildRemoteSources } from "../../../src/mining/remoteSources";
import type { RemoteMemory } from "../../../src/memory/schema";

const remoteMem = (over: Partial<RemoteMemory> = {}): RemoteMemory => ({
  room: "W2N1",
  reserved: false,
  sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 60 }],
  ...over
});

describe("buildRemoteSources", () => {
  it("flattens the selected remotes into per-source snapshot entries", () => {
    const out = buildRemoteSources([remoteMem()], {}, 1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "s1", room: "W2N1", x: 25, y: 25, distance: 60 });
  });

  it("carries the room's reserved flag onto each of its sources", () => {
    const out = buildRemoteSources([remoteMem({ reserved: true })], {}, 1000);
    expect(out[0].reserved).toBe(true);
  });

  it("defaults danger to 0 and reserved from memory when the room has no live vision", () => {
    const out = buildRemoteSources([remoteMem()], {}, 1000);
    expect(out[0].danger).toBe(0);
    expect(out[0].reserved).toBe(false);
  });

  it("prefers live vision over memory for reserved, danger, openTiles and container", () => {
    const out = buildRemoteSources(
      [remoteMem({ reserved: false })],
      {
        W2N1: {
          reserved: true, // live says reserved even though memory said false
          danger: 2,
          dangerUntil: 1100,
          openTilesBySource: { s1: 5 } as Partial<Record<Id<Source>, number>>,
          containerBySource: { s1: "cont1" as Id<StructureContainer> } as Partial<Record<Id<Source>, Id<StructureContainer>>>,
          structures: [],
          sites: []
        }
      },
      1000
    );
    expect(out[0].reserved).toBe(true);
    expect(out[0].danger).toBe(2);
    expect(out[0].openTiles).toBe(5);
    expect(out[0].containerId).toBe("cont1");
  });

  it("keeps a remote flagged dangerous after losing vision, until dangerUntil passes", () => {
    const out = buildRemoteSources([remoteMem({ dangerUntil: 1100 })], {}, 1000);
    expect(out[0].danger).toBe(1);
  });

  it("clears danger once dangerUntil has passed, even without fresh vision", () => {
    const out = buildRemoteSources([remoteMem({ dangerUntil: 900 })], {}, 1000);
    expect(out[0].danger).toBe(0);
  });

  it("forwards the cached route from memory onto the snapshot entry", () => {
    const route = [{ room: "W2N1", x: 24, y: 25 }];
    const out = buildRemoteSources(
      [remoteMem({ sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 60, route }] })],
      {},
      1000
    );
    expect(out[0].route).toEqual(route);
  });

  it("leaves route undefined when memory hasn't computed one yet", () => {
    const out = buildRemoteSources([remoteMem()], {}, 1000);
    expect(out[0].route).toBeUndefined();
  });
});
