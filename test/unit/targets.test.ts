import { describe, expect, it } from "vitest";
import {
  fitsSpec,
  matchesWhere,
  openHarvestTiles,
  resolveTarget,
  type TargetCandidate,
  type TargetKind
} from "../../src/behaviors/targets";
import { stubGame } from "../helpers";

// A candidate carries only the facts the `where` predicates read, not a live game object.
function struct(over: Partial<TargetCandidate>): TargetCandidate {
  return { freeCapacity: 0, usedCapacity: 0, hits: 100, hitsMax: 100, ...over };
}

describe("target where-filter", () => {
  it("notFull matches only candidates with spare capacity", () => {
    expect(matchesWhere(struct({ freeCapacity: 50 }), "notFull")).toBe(true);
    expect(matchesWhere(struct({ freeCapacity: 0 }), "notFull")).toBe(false);
  });

  it("hasEnergy matches only candidates holding resources", () => {
    expect(matchesWhere(struct({ usedCapacity: 50 }), "hasEnergy")).toBe(true);
    expect(matchesWhere(struct({ usedCapacity: 0 }), "hasEnergy")).toBe(false);
  });

  it("damaged matches only candidates below full hits", () => {
    expect(matchesWhere(struct({ hits: 50, hitsMax: 100 }), "damaged")).toBe(true);
    expect(matchesWhere(struct({ hits: 100, hitsMax: 100 }), "damaged")).toBe(false);
  });

  it("an absent where clause matches everything", () => {
    expect(matchesWhere(struct({ freeCapacity: 0, usedCapacity: 0 }), undefined)).toBe(true);
  });
});

// fitsSpec is the kind half of re-validating a locked target each tick (matchesWhere
// is the other half): "could this object still be what the spec is asking for?"
describe("locked target spec-fit", () => {
  it("a construction site fits a constructionSite spec but a structure does not", () => {
    const site: TargetKind = { kind: "constructionSite" };
    expect(fitsSpec(site, { find: "constructionSite" })).toBe(true);
    expect(fitsSpec({ kind: "structure", structureType: STRUCTURE_EXTENSION }, { find: "constructionSite" })).toBe(
      false
    );
  });

  // Without this, a lock taken on an extension step would survive into a spawn step.
  it("a structure fits only a spec asking for its own structureType", () => {
    const extension: TargetKind = { kind: "structure", structureType: STRUCTURE_EXTENSION };
    expect(fitsSpec(extension, { find: "structure", type: STRUCTURE_EXTENSION })).toBe(true);
    expect(fitsSpec(extension, { find: "structure", type: STRUCTURE_SPAWN })).toBe(false);
  });

  it("the storeless kinds fit only their own spec", () => {
    expect(fitsSpec({ kind: "source" }, { find: "source" })).toBe(true);
    expect(fitsSpec({ kind: "source" }, { find: "controller" })).toBe(false);
    expect(fitsSpec({ kind: "controller" }, { find: "controller" })).toBe(true);
    expect(fitsSpec({ kind: "dropped" }, { find: "dropped" })).toBe(true);
    expect(fitsSpec({ kind: "tombstone" }, { find: "tombstone" })).toBe(true);
    expect(fitsSpec({ kind: "dropped" }, { find: "tombstone" })).toBe(false);
  });

  it("an id spec fits whatever the id resolved to", () => {
    expect(fitsSpec({ kind: "source" }, { find: "id", id: "abc" as Id<_HasId> })).toBe(true);
  });

  // A creep target is filtered by role — one role or a list. This is what keeps a hauler's
  // consumer-feed step from targeting another hauler, and a builder's hauler-pull from targeting an
  // upgrader.
  it("a creep fits only a creep spec naming its role", () => {
    const builder: TargetKind = { kind: "creep", role: "builder" };
    expect(fitsSpec(builder, { find: "creep", role: "builder" })).toBe(true);
    expect(fitsSpec(builder, { find: "creep", role: "hauler" })).toBe(false);
    expect(fitsSpec(builder, { find: "creep", role: ["builder", "upgrader"] })).toBe(true);
    expect(fitsSpec(builder, { find: "creep", role: ["hauler", "upgrader"] })).toBe(false);
    // A structure never satisfies a creep spec and vice versa.
    expect(fitsSpec({ kind: "structure", structureType: STRUCTURE_SPAWN }, { find: "creep", role: "builder" })).toBe(false);
    expect(fitsSpec(builder, { find: "structure", type: STRUCTURE_SPAWN })).toBe(false);
  });
});

// These tests assert the search never runs: the stub room's find() throws if
// resolveTarget falls through to a fresh search instead of reusing the lock.
interface FakeTargetOpts {
  structureType?: StructureConstant;
  free?: number;
  used?: number;
}

function fakeSite(id: string, opts: FakeTargetOpts = {}): object {
  const store = {
    getFreeCapacity: () => opts.free ?? 0,
    getUsedCapacity: () => opts.used ?? 0
  };
  return {
    id,
    pos: { x: 10, y: 10 },
    ...(opts.structureType ? { structureType: opts.structureType, store } : { progress: 0, progressTotal: 100 })
  };
}

function creepWithNoSearch(): Creep {
  return {
    pos: {
      x: 5,
      y: 5,
      findClosestByPath: () => {
        throw new Error("resolveTarget searched when it should have reused the lock");
      }
    },
    room: {
      find: () => {
        throw new Error("resolveTarget searched when it should have reused the lock");
      }
    }
  } as unknown as Creep;
}

function creepFinding(candidates: object[]): Creep {
  return {
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: { find: () => candidates }
  } as unknown as Creep;
}

describe("resolveTarget locking", () => {
  it("reuses a locked target that still resolves and still fits the spec", () => {
    const site = fakeSite("site1");
    stubGame({ objects: { site1: site } });

    const got = resolveTarget(creepWithNoSearch(), { find: "constructionSite" }, "site1" as Id<_HasId>);

    expect(got).toBe(site);
  });

  it("drops a lock whose object no longer resolves and picks a fresh target", () => {
    const replacement = fakeSite("site2");
    stubGame({ objects: {} });

    const got = resolveTarget(creepFinding([replacement]), { find: "constructionSite" }, "site1" as Id<_HasId>);

    expect(got).toBe(replacement);
  });

  it("drops a lock on a structure that no longer satisfies the step's where clause", () => {
    const full = fakeSite("ext1", { structureType: STRUCTURE_EXTENSION, free: 0 });
    const empty = fakeSite("ext2", { structureType: STRUCTURE_EXTENSION, free: 50 });
    stubGame({ objects: { ext1: full, ext2: empty } });

    const got = resolveTarget(
      creepFinding([full, empty]),
      { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" },
      "ext1" as Id<_HasId>
    );

    expect(got).toBe(empty);
  });

  it("drops a lock whose object no longer fits the current step's spec", () => {
    const extension = fakeSite("ext1", { structureType: STRUCTURE_EXTENSION, free: 50 });
    const spawn = fakeSite("spawn1", { structureType: STRUCTURE_SPAWN, free: 50 });
    stubGame({ objects: { ext1: extension, spawn1: spawn } });

    const got = resolveTarget(
      creepFinding([spawn]),
      { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" },
      "ext1" as Id<_HasId>
    );

    expect(got).toBe(spawn);
  });
});

// A spec's `share` flag limits how many creeps may claim one target, counted
// from creeps' task.target locks.
function namedCreep(name: string, candidates: object[], lockedTarget?: string): Creep {
  return {
    name,
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: { find: () => candidates },
    memory: { task: lockedTarget ? { step: 0, target: lockedTarget } : { step: 0 } }
  } as unknown as Creep;
}

// Advances Game.time so the per-tick claim cache doesn't carry over between tests.
let fakeTick = 1;
function withClaims(claims: Record<string, string | undefined>): void {
  const creeps: Record<string, unknown> = {};
  for (const [name, target] of Object.entries(claims)) {
    creeps[name] = { name, memory: { task: target ? { step: 0, target } : { step: 0 } } };
  }
  const g = Game as unknown as { creeps: Record<string, unknown>; time: number };
  g.creeps = creeps;
  g.time = ++fakeTick;
}

describe("resolveTarget share caps", () => {
  it("avoids a construction site another creep already claimed when share is 'avoid'", () => {
    const claimed = fakeSite("claimed");
    const free = fakeSite("free");
    stubGame({ objects: { claimed, free } });
    withClaims({ other: "claimed" });

    const got = resolveTarget(namedCreep("me", [claimed, free]), { find: "constructionSite", share: "avoid" });

    expect((got as { id: string }).id).toBe("free");
  });

  it("allows sharing up to the numeric cap, then excludes the target", () => {
    const a = fakeSite("a");
    const b = fakeSite("b");
    stubGame({ objects: { a, b } });
    withClaims({ c1: "a", c2: "a" });

    const got = resolveTarget(namedCreep("me", [a, b]), { find: "constructionSite", share: 2 });

    expect((got as { id: string }).id).toBe("b");
  });

  it("shares freely when share is absent (unlimited)", () => {
    const a = fakeSite("a");
    const b = fakeSite("b");
    stubGame({ objects: { a, b } });
    withClaims({ c1: "a", c2: "a", c3: "a" });

    const got = resolveTarget(namedCreep("me", [a, b]), { find: "constructionSite" });

    expect((got as { id: string }).id).toBe("a");
  });

  it("does not count the creep's own lock against the cap", () => {
    const a = fakeSite("a");
    stubGame({ objects: { a } });
    withClaims({ me: "a" });

    const got = resolveTarget(namedCreep("me", [a], "a"), { find: "constructionSite", share: 1 });

    expect((got as { id: string }).id).toBe("a");
  });

  it("falls back to a claimed target when every candidate is at capacity", () => {
    const only = fakeSite("only");
    stubGame({ objects: { only } });
    withClaims({ c1: "only" });

    // Stranding the creep is worse than sharing, so it still gets the target.
    const got = resolveTarget(namedCreep("me", [only]), { find: "constructionSite", share: 1 });

    expect((got as { id: string }).id).toBe("only");
  });
});

// A drop pile candidate; freeCapacity is what the worthwhile-amount rule reads to size its floor.
function fakeDrop(id: string, amount: number): object {
  return { id, pos: { x: 5, y: 5 }, amount };
}

function collectorCreep(name: string, freeCapacity: number, candidates: object[]): Creep {
  return {
    name,
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: { find: () => candidates },
    store: { getFreeCapacity: () => freeCapacity },
    memory: { task: { step: 0 } }
  } as unknown as Creep;
}

describe("resolveTarget worthwhile-amount filter for drop piles", () => {
  it("prefers a pile that clears 25% of the collector's free capacity", () => {
    const big = fakeDrop("big", 100);
    const small = fakeDrop("small", 10);
    stubGame({ objects: { big, small } });

    // free capacity 200 -> worthwhile floor is max(0.25*200, 50) = 50; only "big" clears it.
    const got = resolveTarget(collectorCreep("me", 200, [small, big]), { find: "dropped" });

    expect((got as { id: string }).id).toBe("big");
  });

  it("falls back to the best trivial pile when nothing clears the worthwhile bar", () => {
    const only = fakeDrop("only", 5);
    stubGame({ objects: { only } });

    // A decaying pile must still eventually be picked up, or it would be orphaned forever.
    const got = resolveTarget(collectorCreep("me", 200, [only]), { find: "dropped" });

    expect((got as { id: string }).id).toBe("only");
  });
});

describe("resolveTarget pile claim limits", () => {
  it("locks a small pile to a single claimant", () => {
    const small = fakeDrop("small", 80); // under the 100-energy reference capacity -> cap of 1
    const large = fakeDrop("large", 500);
    stubGame({ objects: { small, large } });
    withClaims({ other: "small" });

    const got = resolveTarget(collectorCreep("me", 200, [small, large]), { find: "dropped" });

    expect((got as { id: string }).id).toBe("large");
  });

  it("lets several collectors claim a large pile", () => {
    const large = fakeDrop("large", 500); // 500 / 100 -> cap of 5
    stubGame({ objects: { large } });
    withClaims({ c1: "large", c2: "large", c3: "large" });

    const got = resolveTarget(collectorCreep("me", 200, [large]), { find: "dropped" });

    expect((got as { id: string }).id).toBe("large");
  });
});

// A source's share cap is its open harvest-tile count, computed from terrain.
function fakeSource(id: string, x: number, y: number): object {
  return { id, pos: { x, y }, energy: 3000, room: plainRoom };
}

function sourceCreep(name: string, sources: object[], lockedTarget?: string): Creep {
  return {
    name,
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: { find: () => sources },
    memory: { task: lockedTarget ? { step: 0, target: lockedTarget } : { step: 0 } }
  } as unknown as Creep;
}

// All-plain terrain gives a free-standing source its full 8 adjacent tiles.
const plainRoom = { getTerrain: () => ({ get: () => 0 }) };

// The snapshot builder needs this same count for each source, so it must work
// against a plain positioned object, not just a live Source.
describe("openHarvestTiles", () => {
  it("counts all 8 neighbors open on plain terrain away from the room edge", () => {
    expect(openHarvestTiles({ pos: { x: 25, y: 25 }, room: plainRoom })).toBe(8);
  });

  it("excludes neighbors that are walls", () => {
    const wallRoom = { getTerrain: () => ({ get: (x: number, y: number) => (x === 25 && y === 24 ? 1 : 0) }) };
    expect(openHarvestTiles({ pos: { x: 25, y: 25 }, room: wallRoom })).toBe(7);
  });

  it("excludes neighbors that fall off the room edge", () => {
    expect(openHarvestTiles({ pos: { x: 0, y: 0 }, room: plainRoom })).toBe(3);
  });
});

// A creep candidate as room.find(FIND_MY_CREEPS) returns it: an id, a role in memory, and a store
// the `where` filter reads. The acting creep carries its own id so findCandidates can exclude it.
function fakeCreep(id: string, role: string, opts: { free?: number; used?: number } = {}): object {
  return {
    id,
    pos: { x: 6, y: 6 },
    body: [{ type: "carry" }],
    memory: { role },
    store: { getFreeCapacity: () => opts.free ?? 0, getUsedCapacity: () => opts.used ?? 0 }
  };
}

// The actor: it never searches (findClosestByPath returns the first candidate), and room.find hands
// back the fixed candidate list. Its own id is set so self-exclusion can be checked.
function actorCreep(id: string, candidates: object[]): Creep {
  return {
    id,
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: { find: () => candidates }
  } as unknown as Creep;
}

describe("resolveTarget creep targets", () => {
  it("finds only creeps of the named role", () => {
    const builder = fakeCreep("b1", "builder", { free: 50 });
    const hauler = fakeCreep("h1", "hauler", { free: 50 });
    stubGame({ objects: {} });

    const got = resolveTarget(actorCreep("me", [builder, hauler]), { find: "creep", role: "builder", where: "notFull" });
    expect((got as { id: string }).id).toBe("b1");
  });

  it("accepts a list of roles", () => {
    const upgrader = fakeCreep("u1", "upgrader", { free: 50 });
    stubGame({ objects: {} });

    const got = resolveTarget(actorCreep("me", [upgrader]), {
      find: "creep",
      role: ["builder", "upgrader"],
      where: "notFull"
    });
    expect((got as { id: string }).id).toBe("u1");
  });

  it("never targets the acting creep itself", () => {
    // Only candidate is the actor — findCandidates must drop it, leaving nothing.
    const me = fakeCreep("me", "hauler", { used: 50 });
    stubGame({ objects: {} });

    const got = resolveTarget(actorCreep("me", [me]), { find: "creep", role: "hauler", where: "hasEnergy" });
    expect(got).toBeNull();
  });

  it("applies the where filter to the creep's store (hasEnergy / notFull)", () => {
    const loaded = fakeCreep("full", "hauler", { used: 50, free: 0 });
    const empty = fakeCreep("empty", "hauler", { used: 0, free: 50 });
    stubGame({ objects: {} });

    // A consumer pulling from a hauler wants one that HAS energy.
    const pull = resolveTarget(actorCreep("me", [empty, loaded]), { find: "creep", role: "hauler", where: "hasEnergy" });
    expect((pull as { id: string }).id).toBe("full");

    // A hauler feeding a consumer wants one that is NOT full.
    const feed = resolveTarget(actorCreep("me", [loaded, empty]), { find: "creep", role: "hauler", where: "notFull" });
    expect((feed as { id: string }).id).toBe("empty");
  });
});

describe("resolveTarget source spreading", () => {
  it("sends a harvester to the emptier source once the nearer one fills its tiles", () => {
    const near = fakeSource("near", 10, 10);
    const far = fakeSource("far", 40, 40);
    stubGame({ objects: { near, far } });
    const claims: Record<string, string> = {};
    for (let i = 0; i < 8; i++) claims["h" + i] = "near";
    withClaims(claims);

    const got = resolveTarget(sourceCreep("me", [near, far]), { find: "source" });

    expect((got as { id: string }).id).toBe("far");
  });

  it("still returns a source when all are saturated", () => {
    const a = fakeSource("a", 10, 10);
    stubGame({ objects: { a } });
    const claims: Record<string, string> = {};
    for (let i = 0; i < 10; i++) claims["h" + i] = "a";
    withClaims(claims);

    const got = resolveTarget(sourceCreep("me", [a]), { find: "source" });

    expect((got as { id: string }).id).toBe("a");
  });
});
