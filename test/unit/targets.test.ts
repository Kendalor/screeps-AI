import { describe, expect, it } from "vitest";
import { fitsSpec, matchesWhere, resolveTarget, type TargetCandidate, type TargetKind } from "../../src/behaviors/targets";
import { stubGame } from "../helpers";

// A candidate carries only the facts the `where` predicates read — a snapshot,
// not a live game object, so the filter is unit-testable.
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

// A locked target is re-validated each tick against the step's spec. fitsSpec
// is the kind half of that check (matchesWhere is the other half): it answers
// "could this object still be what the spec is asking for?" without the game.
describe("locked target spec-fit", () => {
  it("a construction site fits a constructionSite spec but a structure does not", () => {
    const site: TargetKind = { kind: "constructionSite" };
    expect(fitsSpec(site, { find: "constructionSite" })).toBe(true);
    expect(fitsSpec({ kind: "structure", structureType: STRUCTURE_EXTENSION }, { find: "constructionSite" })).toBe(
      false
    );
  });

  // bootstrap transfers to extension, then spawn, then tower — three steps whose
  // specs differ only by structureType. Without this check a lock taken on an
  // extension would survive into the spawn step and be acted on as a spawn.
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

  // An id-spec names one object outright, so any object that still resolves
  // under that id is by definition what the step asked for.
  it("an id spec fits whatever the id resolved to", () => {
    expect(fitsSpec({ kind: "source" }, { find: "id", id: "abc" as Id<_HasId> })).toBe(true);
  });
});

// --- lock reuse ---------------------------------------------------------------
// resolveTarget takes the id the creep locked last tick. The point of the lock
// is that a creep walking toward a target does not swap to a nearer one that
// appears mid-journey (#23), so these tests assert the search never runs: the
// stub room's find() throws if resolveTarget falls through to a fresh search.

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

// A creep whose room refuses to be searched — any fresh findCandidates call is
// a test failure rather than a silently different result.
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

// The counterpart: a creep whose room does return candidates, for the cases
// where dropping the lock and searching again is the expected behavior.
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
    stubGame({ objects: {} }); // the locked site finished and is gone

    const got = resolveTarget(creepFinding([replacement]), { find: "constructionSite" }, "site1" as Id<_HasId>);

    expect(got).toBe(replacement);
  });

  it("drops a lock on a structure that no longer satisfies the step's where clause", () => {
    const full = fakeSite("ext1", { structureType: STRUCTURE_EXTENSION, free: 0 });
    const empty = fakeSite("ext2", { structureType: STRUCTURE_EXTENSION, free: 50 });
    stubGame({ objects: { ext1: full, ext2: empty } });

    // Locked onto ext1, but a supply creep filled it — notFull no longer holds.
    const got = resolveTarget(
      creepFinding([full, empty]),
      { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" },
      "ext1" as Id<_HasId>
    );

    expect(got).toBe(empty);
  });

  // Replaces the issue's "lock cleared on step change": with spec-fit
  // re-validation the lock is dropped by the spec no longer matching, which is
  // the behavior that actually matters (bootstrap: extension step -> spawn step).
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

// --- targeting cache / share caps ---------------------------------------------
// A spec's `share` flag limits how many creeps may claim one target. The cache
// counts claims from creeps' task.target locks, so a creep choosing sees where
// the others are headed and spreads out.

function namedCreep(name: string, candidates: object[], lockedTarget?: string): Creep {
  return {
    name,
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: { find: () => candidates },
    memory: { task: lockedTarget ? { step: 0, target: lockedTarget } : { step: 0 } }
  } as unknown as Creep;
}

// Register creeps in Game.creeps with the given task.target claims. Advances
// Game.time so the per-tick claim cache doesn't carry over between tests.
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
    // Two creeps already on 'a'; with share:2 it is full, so 'b' is chosen.
    withClaims({ c1: "a", c2: "a" });

    const got = resolveTarget(namedCreep("me", [a, b]), { find: "constructionSite", share: 2 });

    expect((got as { id: string }).id).toBe("b");
  });

  it("shares freely when share is absent (unlimited)", () => {
    const a = fakeSite("a");
    const b = fakeSite("b");
    stubGame({ objects: { a, b } });
    withClaims({ c1: "a", c2: "a", c3: "a" });

    // No share cap -> nearest (first) wins regardless of crowding.
    const got = resolveTarget(namedCreep("me", [a, b]), { find: "constructionSite" });

    expect((got as { id: string }).id).toBe("a");
  });

  it("does not count the creep's own lock against the cap", () => {
    const a = fakeSite("a");
    stubGame({ objects: { a } });
    // Only this creep claims 'a'; with share:1 it must still be allowed to keep it.
    withClaims({ me: "a" });

    const got = resolveTarget(namedCreep("me", [a], "a"), { find: "constructionSite", share: 1 });

    expect((got as { id: string }).id).toBe("a");
  });

  it("falls back to a claimed target when every candidate is at capacity", () => {
    const only = fakeSite("only");
    stubGame({ objects: { only } });
    withClaims({ c1: "only" });

    // Single site, already full for share:1 — but stranding the creep is worse
    // than sharing, so it still gets the target.
    const got = resolveTarget(namedCreep("me", [only]), { find: "constructionSite", share: 1 });

    expect((got as { id: string }).id).toBe("only");
  });
});

// A source's share cap is its open harvest-tile count, computed from terrain —
// so harvesters spread across sources instead of stacking. All-plain terrain
// gives a free-standing source 8 open tiles.
// 0 = plain everywhere (never TERRAIN_MASK_WALL), so a free-standing source has
// its full 8 adjacent tiles open.
const plainRoom = { getTerrain: () => ({ get: () => 0 }) };

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

describe("resolveTarget source spreading", () => {
  it("sends a harvester to the emptier source once the nearer one fills its tiles", () => {
    const near = fakeSource("near", 10, 10);
    const far = fakeSource("far", 40, 40);
    stubGame({ objects: { near, far } });
    // 8 creeps already on 'near' (its 8 open tiles on plain) -> full; 'far' open.
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
    for (let i = 0; i < 10; i++) claims["h" + i] = "a"; // over its 8 tiles
    withClaims(claims);

    const got = resolveTarget(sourceCreep("me", [a]), { find: "source" });

    expect((got as { id: string }).id).toBe("a");
  });
});
