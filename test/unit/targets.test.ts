import { describe, expect, it } from "vitest";
import {
  belowFillTo,
  belowRepair,
  energySinkGroup,
  energySourceGroup,
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

// belowFillTo is the fill-fraction cap that lets a hauler stop topping the controller container at a
// floor rather than chase every last unit the upgraders drain.
describe("belowFillTo", () => {
  it("no cap matches every candidate", () => {
    expect(belowFillTo(struct({ usedCapacity: 2000, freeCapacity: 0 }), undefined)).toBe(true);
  });

  it("qualifies a candidate below the fraction, rejects one at or above it", () => {
    // capacity 2000: 60% used is below the 0.7 floor -> still wants topping up.
    expect(belowFillTo(struct({ usedCapacity: 1200, freeCapacity: 800 }), 0.7)).toBe(true);
    // exactly at the floor is NOT below it -> drops out so the step falls through to storage.
    expect(belowFillTo(struct({ usedCapacity: 1400, freeCapacity: 600 }), 0.7)).toBe(false);
    expect(belowFillTo(struct({ usedCapacity: 1600, freeCapacity: 400 }), 0.7)).toBe(false);
  });

  it("a zero-capacity candidate can never be filled, so it never wants more", () => {
    expect(belowFillTo(struct({ usedCapacity: 0, freeCapacity: 0 }), 0.7)).toBe(false);
  });
});

// belowRepair is the hits-fraction gate that lets a miner start repairing its container only once it has
// decayed past a floor (0.7) — the repair counterpart of belowFillTo.
describe("belowRepair", () => {
  it("no gate matches every candidate", () => {
    expect(belowRepair(struct({ hits: 10, hitsMax: 100 }), undefined)).toBe(true);
  });

  it("qualifies a candidate below the fraction, rejects one at or above it", () => {
    expect(belowRepair(struct({ hits: 60, hitsMax: 100 }), 0.7)).toBe(true); // decayed past 70% -> repair
    expect(belowRepair(struct({ hits: 70, hitsMax: 100 }), 0.7)).toBe(false); // exactly at floor is not below it
    expect(belowRepair(struct({ hits: 90, hitsMax: 100 }), 0.7)).toBe(false); // healthy -> leave it alone
  });

  it("a candidate with no hitsMax (a site, a source) can never be repaired", () => {
    expect(belowRepair(struct({ hits: 0, hitsMax: 0 }), 0.7)).toBe(false);
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

  // A structureType-scoped site spec (the miner's container-build step) fits only a site of that type, so
  // a lock on the container site never survives onto, say, a road site the miner should ignore.
  it("a scoped constructionSite spec fits only a site of its structureType", () => {
    const containerSite: TargetKind = { kind: "constructionSite", structureType: STRUCTURE_CONTAINER };
    const roadSite: TargetKind = { kind: "constructionSite", structureType: STRUCTURE_ROAD };
    expect(fitsSpec(containerSite, { find: "constructionSite", structureType: STRUCTURE_CONTAINER })).toBe(true);
    expect(fitsSpec(roadSite, { find: "constructionSite", structureType: STRUCTURE_CONTAINER })).toBe(false);
    // An unscoped spec still matches any site type, as before.
    expect(fitsSpec(roadSite, { find: "constructionSite" })).toBe(true);
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

// A hostile creep candidate for mostThreatening: `body` carries whichever active parts threatTier reads.
function fakeHostile(id: string, body: BodyPartConstant[]): object {
  return {
    id,
    pos: { x: 5, y: 5 },
    body: body.map(type => ({ type, hits: 100 })),
    my: false,
    getActiveBodyparts: (part: BodyPartConstant) => body.filter(p => p === part).length
  };
}

function collectorCreep(
  name: string,
  freeCapacity: number,
  candidates: object[],
  energy?: { available: number; capacity: number }
): Creep {
  return {
    name,
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: {
      find: () => candidates,
      energyAvailable: energy?.available ?? 0,
      energyCapacityAvailable: energy?.capacity ?? 0
    },
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

// unlessSpawnNeedsEnergy: a builder/upgrader gather step must leave ground piles for the hauler while
// the room's spawn/extensions aren't full, so the two roles stop competing for the same energy.
describe("resolveTarget unlessSpawnNeedsEnergy gate for drop piles", () => {
  it("excludes drop piles while the spawn system has spare capacity", () => {
    const pile = fakeDrop("pile", 500);
    stubGame({ objects: { pile } });

    const creep = collectorCreep("me", 200, [pile], { available: 200, capacity: 300 });
    const got = resolveTarget(creep, { find: "dropped", unlessSpawnNeedsEnergy: true });

    expect(got).toBeNull();
  });

  it("offers drop piles once the spawn system is full", () => {
    const pile = fakeDrop("pile", 500);
    stubGame({ objects: { pile } });

    const creep = collectorCreep("me", 200, [pile], { available: 300, capacity: 300 });
    const got = resolveTarget(creep, { find: "dropped", unlessSpawnNeedsEnergy: true });

    expect((got as { id: string }).id).toBe("pile");
  });

  it("without the flag, drop piles are offered regardless of spawn fill state", () => {
    const pile = fakeDrop("pile", 500);
    stubGame({ objects: { pile } });

    const creep = collectorCreep("me", 200, [pile], { available: 0, capacity: 300 });
    const got = resolveTarget(creep, { find: "dropped" });

    expect((got as { id: string }).id).toBe("pile");
  });

  it("releases a locked drop pile the instant the spawn system starts needing energy", () => {
    const pile = fakeDrop("pile", 500);
    stubGame({ objects: { pile } });

    const creep = collectorCreep("me", 200, [pile], { available: 200, capacity: 300 });
    const got = resolveTarget(creep, { find: "dropped", unlessSpawnNeedsEnergy: true }, "pile" as Id<_HasId>);

    expect(got).toBeNull();
  });
});

// prefer is opt-in per spec: it only reorders the pool the step already asked for, so a step
// that omits it keeps whatever order room.find() (here, the fixture's candidate array) returned.
describe("resolveTarget prefer ordering", () => {
  it("without prefer, the fallback keeps room.find()'s order (first candidate)", () => {
    const small = fakeDrop("small", 500);
    const big = fakeDrop("big", 1000);
    stubGame({ objects: { small, big } });

    // Both clear the worthwhile floor; findClosestByPath here always returns list[0], so
    // whichever the fixture lists first wins when prefer is absent.
    const got = resolveTarget(collectorCreep("me", 200, [small, big]), { find: "dropped" });

    expect((got as { id: string }).id).toBe("small");
  });

  it("prefer: largest picks the biggest pile regardless of room.find() order", () => {
    const small = fakeDrop("small", 500);
    const big = fakeDrop("big", 1000);
    stubGame({ objects: { small, big } });

    const got = resolveTarget(collectorCreep("me", 200, [small, big]), { find: "dropped", prefer: "largest" });

    expect((got as { id: string }).id).toBe("big");
  });

  it("prefer: mostProgress picks the nearest-to-complete construction site", () => {
    const fresh = { id: "fresh", pos: { x: 5, y: 5 }, progress: 10, progressTotal: 100 };
    const almostDone = { id: "almostDone", pos: { x: 5, y: 5 }, progress: 90, progressTotal: 100 };
    stubGame({ objects: { fresh, almostDone } });

    const got = resolveTarget(collectorCreep("me", 200, [fresh, almostDone]), {
      find: "constructionSite",
      prefer: "mostProgress"
    });

    expect((got as { id: string }).id).toBe("almostDone");
  });

  it("prefer: mostDamaged picks the structure with the lowest hits fraction, not the nearest", () => {
    // First in the fixture (what nearest would pick) is the least damaged; mostDamaged must skip it.
    const barelyDamaged = { id: "barely", pos: { x: 5, y: 5 }, structureType: STRUCTURE_ROAD, hits: 4900, hitsMax: 5000 };
    const wrecked = { id: "wrecked", pos: { x: 5, y: 5 }, structureType: STRUCTURE_ROAD, hits: 200, hitsMax: 5000 };
    stubGame({ objects: { barelyDamaged, wrecked } });

    const got = resolveTarget(collectorCreep("me", 200, [barelyDamaged, wrecked]), {
      find: "structure",
      type: STRUCTURE_ROAD,
      where: "damaged",
      prefer: "mostDamaged"
    });

    expect((got as { id: string }).id).toBe("wrecked");
  });

  it("prefer: mostThreatening picks the attacker over a nearer healer, so a defender doesn't kite the wrong hostile", () => {
    // healer is first in the fixture (what nearest would pick, per findClosestByPath: list[0]) and closer;
    // mostThreatening must skip it for the attacker despite that.
    const healer = fakeHostile("healer", [HEAL]);
    const attacker = fakeHostile("attacker", [RANGED_ATTACK]);
    stubGame({ objects: { healer, attacker } });

    const got = resolveTarget(collectorCreep("me", 200, [healer, attacker]), {
      find: "hostile",
      prefer: "mostThreatening"
    });

    expect((got as { id: string }).id).toBe("attacker");
  });

  it("prefer: mostThreatening picks a healer over an unarmed hostile when no attacker is present", () => {
    const scout = fakeHostile("scout", []);
    const healer = fakeHostile("healer", [HEAL]);
    stubGame({ objects: { scout, healer } });

    const got = resolveTarget(collectorCreep("me", 200, [scout, healer]), {
      find: "hostile",
      prefer: "mostThreatening"
    });

    expect((got as { id: string }).id).toBe("healer");
  });

  it("prefer: mostThreatening breaks ties between two attackers by nearest-by-path", () => {
    // findClosestByPath here always returns list[0] — assert it's actually consulted (not just tier-filtered
    // down to a single candidate) by putting the intended winner first.
    const nearAttacker = fakeHostile("near", [ATTACK]);
    const farAttacker = fakeHostile("far", [RANGED_ATTACK]);
    stubGame({ objects: { nearAttacker, farAttacker } });

    const got = resolveTarget(collectorCreep("me", 200, [nearAttacker, farAttacker]), {
      find: "hostile",
      prefer: "mostThreatening"
    });

    expect((got as { id: string }).id).toBe("near");
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
  return {
    id,
    pos: { x, y, inRangeTo: (o: { x: number; y: number }, r: number) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= r },
    energy: 3000,
    room: plainRoom
  };
}

function sourceCreep(name: string, sources: object[], lockedTarget?: string, sourceId?: string): Creep {
  return {
    name,
    pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
    room: { find: () => sources },
    memory: {
      task: lockedTarget ? { step: 0, target: lockedTarget } : { step: 0 },
      ...(sourceId ? { sourceId } : {})
    }
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

// A miner assigned a source (memory.sourceId, written by Mining's per-source requests) must stick to
// that source rather than drift to whichever is nearest or least-claimed — otherwise Mining's own
// per-source WORK accounting (which counts miners by sourceId) disagrees with where miners actually
// stand, letting one source get overstaffed while another sits under its target.
describe("resolveTarget source pinning", () => {
  it("sends an assigned miner to its own source even when a closer one is offered first", () => {
    const near = fakeSource("near", 10, 10);
    const assigned = fakeSource("assigned", 40, 40);
    stubGame({ objects: { near, assigned } });

    const got = resolveTarget(sourceCreep("me", [near, assigned], undefined, "assigned"), { find: "source" });

    expect((got as { id: string }).id).toBe("assigned");
  });

  it("ignores an assigned source's own share cap being full — no other source is a legal fallback", () => {
    const assigned = fakeSource("assigned", 10, 10);
    const other = fakeSource("other", 40, 40);
    stubGame({ objects: { assigned, other } });
    const claims: Record<string, string> = {};
    for (let i = 0; i < 10; i++) claims["h" + i] = "assigned";
    withClaims(claims);

    const got = resolveTarget(sourceCreep("me", [assigned, other], undefined, "assigned"), { find: "source" });

    expect((got as { id: string }).id).toBe("assigned");
  });

  it("an unassigned creep (no sourceId) still sees every source, spreading as before", () => {
    const near = fakeSource("near", 10, 10);
    const far = fakeSource("far", 40, 40);
    stubGame({ objects: { near, far } });
    const claims: Record<string, string> = {};
    for (let i = 0; i < 8; i++) claims["h" + i] = "near";
    withClaims(claims);

    const got = resolveTarget(sourceCreep("me", [near, far]), { find: "source" });

    expect((got as { id: string }).id).toBe("far");
  });
});

// A miner on a containerless source must never dump into a sibling source's container just because
// it's nearest by path — that would send it walking clear across the room every time its (single, if
// any) CARRY part fills, instead of staying parked and harvesting. `near: "assignedSource"` restricts
// a structure spec to range 1 of the creep's own memory.sourceId.
describe("resolveTarget near:assignedSource", () => {
  function structureCreep(sourceId: string, sources: object[], structures: object[], lockedTarget?: string): Creep {
    return {
      pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: {
        find: (kind: FindConstant) => (kind === FIND_SOURCES ? sources : structures)
      },
      memory: {
        task: lockedTarget ? { step: 0, target: lockedTarget } : { step: 0 },
        sourceId
      }
    } as unknown as Creep;
  }

  function fakeContainer(id: string, x: number, y: number): object {
    return {
      id,
      structureType: STRUCTURE_CONTAINER,
      pos: { x, y, inRangeTo: (o: { x: number; y: number }, r: number) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= r },
      store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 }
    };
  }

  it("ignores a sibling source's nearer container and finds nothing for a containerless source", () => {
    const mine = fakeSource("mine", 40, 40);
    const sibling = fakeSource("sibling", 10, 10);
    const siblingContainer = fakeContainer("siblingCont", 10, 11);
    stubGame({ objects: { mine, sibling, siblingCont: siblingContainer } });

    const got = resolveTarget(structureCreep("mine", [mine, sibling], [siblingContainer]), {
      find: "structure",
      type: STRUCTURE_CONTAINER,
      where: "notFull",
      near: "assignedSource"
    });

    expect(got).toBeNull();
  });

  it("finds its own source's container when one exists", () => {
    const mine = fakeSource("mine", 40, 40);
    const myContainer = fakeContainer("myCont", 40, 41);
    stubGame({ objects: { mine, myCont: myContainer } });

    const got = resolveTarget(structureCreep("mine", [mine], [myContainer]), {
      find: "structure",
      type: STRUCTURE_CONTAINER,
      where: "notFull",
      near: "assignedSource"
    });

    expect((got as { id: string }).id).toBe("myCont");
  });

  it("drops a stale lock on a sibling source's container once resolved fresh", () => {
    const mine = fakeSource("mine", 40, 40);
    const siblingContainer = fakeContainer("siblingCont", 10, 11);
    stubGame({ objects: { mine, siblingCont: siblingContainer } });

    // Locked target predates sourceId-aware filtering (or was mis-locked) — must not survive re-validation.
    const got = resolveTarget(
      structureCreep("mine", [mine], [siblingContainer], "siblingCont"),
      { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull", near: "assignedSource" }
    );

    expect(got).toBeNull();
  });
});

// Once a room has both source containers and a controller container, a container spec must be able to
// pick one role and never the other: the hauler FILLS the controller container (near: "controller") and
// DRAINS the source containers (near: "notController"). They partition by range 1 of the controller.
describe("resolveTarget near:controller / notController", () => {
  const inRange = (x: number, y: number) => (o: { x: number; y: number }, r: number) =>
    Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= r;

  // A container with a real store so `where` and `fillTo` can read used/free capacity off it.
  function container(id: string, x: number, y: number, used = 0, capacity = 2000): object {
    return {
      id,
      structureType: STRUCTURE_CONTAINER,
      pos: { x, y, inRangeTo: inRange(x, y) },
      store: {
        getUsedCapacity: () => used,
        getFreeCapacity: () => capacity - used,
        getCapacity: () => capacity
      }
    };
  }

  // Controller sits at (25,25); creep's findClosestByPath just returns the first candidate.
  function creepInRoom(containers: object[], lockedTarget?: string): Creep {
    return {
      id: "me",
      pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: {
        controller: { pos: { x: 25, y: 25, inRangeTo: inRange(25, 25) } },
        find: () => containers
      },
      store: { getFreeCapacity: () => 200 },
      memory: { task: lockedTarget ? { step: 0, target: lockedTarget } : { step: 0 } }
    } as unknown as Creep;
  }

  const ctrlContainer = () => container("ctrl", 25, 26, 0); // range 1 of controller -> the controller container
  const srcContainer = () => container("src", 10, 10, 1000); // far from controller -> a source container

  it("near:controller resolves only the container within range 1 of the controller", () => {
    const ctrl = ctrlContainer();
    const src = srcContainer();
    stubGame({ objects: { ctrl, src } });

    const got = resolveTarget(creepInRoom([src, ctrl]), {
      find: "structure",
      type: STRUCTURE_CONTAINER,
      where: "notFull",
      near: "controller"
    });

    expect((got as { id: string }).id).toBe("ctrl");
  });

  it("near:notController excludes the controller container, leaving only source containers", () => {
    const ctrl = ctrlContainer();
    const src = srcContainer();
    stubGame({ objects: { ctrl, src } });

    const got = resolveTarget(creepInRoom([ctrl, src]), {
      find: "structure",
      type: STRUCTURE_CONTAINER,
      where: "hasEnergy",
      near: "notController"
    });

    expect((got as { id: string }).id).toBe("src");
  });

  it("fillTo:0.7 keeps the controller container a target below the floor, drops it at or above", () => {
    const spec = {
      find: "structure" as const,
      type: STRUCTURE_CONTAINER,
      where: "notFull" as const,
      near: "controller" as const,
      fillTo: 0.7
    };

    const low = container("ctrl", 25, 26, 600); // 30% -> still wanted
    stubGame({ objects: { ctrl: low } });
    expect((resolveTarget(creepInRoom([low]), spec) as { id: string }).id).toBe("ctrl");

    const atFloor = container("ctrl", 25, 26, 1400); // 70% -> no longer wanted; step falls through
    stubGame({ objects: { ctrl: atFloor } });
    expect(resolveTarget(creepInRoom([atFloor]), spec)).toBeNull();
  });

  it("drops a lock on the controller container once it crosses the fill floor", () => {
    const spec = {
      find: "structure" as const,
      type: STRUCTURE_CONTAINER,
      where: "notFull" as const,
      near: "controller" as const,
      fillTo: 0.7
    };
    const full = container("ctrl", 25, 26, 1500); // 75% -> stale lock must not survive
    stubGame({ objects: { ctrl: full } });

    const got = resolveTarget(creepInRoom([full], "ctrl"), spec);

    expect(got).toBeNull();
  });
});

// A structure spec's `type` may be one constant or a list; a list pools every matching
// structureType into a single candidate set, same as room.find(FIND_STRUCTURES) filtered by an OR.
describe("resolveTarget structure type lists", () => {
  it("matches any structureType in the list", () => {
    const spawn = fakeSite("spawn1", { structureType: STRUCTURE_SPAWN, free: 50 });
    const tower = fakeSite("tower1", { structureType: STRUCTURE_TOWER, free: 50 });
    const storage = fakeSite("storage1", { structureType: STRUCTURE_STORAGE, free: 50 });
    stubGame({ objects: { spawn1: spawn, tower1: tower, storage1: storage } });

    const got = resolveTarget(creepFinding([spawn, tower, storage]), {
      find: "structure",
      type: [STRUCTURE_SPAWN, STRUCTURE_TOWER],
      where: "notFull"
    });

    // creepFinding's findClosestByPath returns list[0]; room.find is unfiltered by the fixture, so the
    // real work under test is the type-list filter happening before that pick.
    expect((got as { id: string }).id).toBe("spawn1");
  });

  it("a locked target fits only if its structureType is in the list", () => {
    const spawn = fakeSite("spawn1", { structureType: STRUCTURE_SPAWN, free: 50 });
    expect(fitsSpec({ kind: "structure", structureType: STRUCTURE_SPAWN }, { find: "structure", type: [STRUCTURE_SPAWN, STRUCTURE_TOWER] })).toBe(true);
    expect(fitsSpec({ kind: "structure", structureType: STRUCTURE_STORAGE }, { find: "structure", type: [STRUCTURE_SPAWN, STRUCTURE_TOWER] })).toBe(false);
    void spawn;
  });
});

// "any" merges several specs' candidate pools into one before ranking, so the step never commits to
// a worse match from an earlier-listed kind just because that kind's search happened to find something
// first — the exact failure mode a priority-ordered chain of single-kind steps has.
describe("resolveTarget grouped (any) specs", () => {
  // Dispatches room.find by FIND_* constant so a merged spec can pull dropped piles, tombstones, and
  // structures from the same fixture room.
  function roomWithKinds(byKind: Partial<Record<FindConstant, object[]>>): { find: (k: FindConstant) => object[] } {
    return { find: (k: FindConstant) => byKind[k] ?? [] };
  }

  function groupCreep(
    byKind: Partial<Record<FindConstant, object[]>>,
    nearest: object,
    lockedTarget?: string
  ): Creep {
    return {
      pos: { x: 5, y: 5, findClosestByPath: (list: object[]) => (list.includes(nearest) ? nearest : list[0] ?? null) },
      room: roomWithKinds(byKind),
      store: { getFreeCapacity: () => 200 },
      memory: { task: lockedTarget ? { step: 0, target: lockedTarget } : { step: 0 } }
    } as unknown as Creep;
  }

  it("picks the nearest candidate across kinds, not just the first-listed kind's own nearest", () => {
    const farContainer = fakeSite("cont1", { structureType: STRUCTURE_CONTAINER, used: 100 });
    const nearTombstone = { id: "tomb1", pos: { x: 5, y: 5 }, deathTime: 1, store: { getUsedCapacity: () => 100 } };
    stubGame({ objects: { cont1: farContainer, tomb1: nearTombstone } });

    const got = resolveTarget(
      groupCreep({ [FIND_STRUCTURES]: [farContainer], [FIND_TOMBSTONES]: [nearTombstone] }, nearTombstone),
      energySourceGroup()
    );

    expect((got as { id: string }).id).toBe("tomb1");
  });

  it("applies each member's own where filter within the merged pool", () => {
    const emptyContainer = fakeSite("cont1", { structureType: STRUCTURE_CONTAINER, used: 0, free: 100 });
    const fullExtension = fakeSite("ext1", { structureType: STRUCTURE_EXTENSION, free: 0 });
    const openExtension = fakeSite("ext2", { structureType: STRUCTURE_EXTENSION, free: 50 });
    stubGame({ objects: { cont1: emptyContainer, ext1: fullExtension, ext2: openExtension } });

    // energySinkGroup wants notFull — the empty (0 used) container is irrelevant here since sink
    // members only carry structure types, and the full extension must be excluded despite matching type.
    const got = resolveTarget(
      groupCreep({ [FIND_STRUCTURES]: [emptyContainer, fullExtension, openExtension] }, openExtension),
      energySinkGroup()
    );

    expect((got as { id: string }).id).toBe("ext2");
  });

  it("re-validates a lock against whichever member spec the object still fits", () => {
    const tombstone = {
      id: "tomb1",
      pos: { x: 5, y: 5 },
      deathTime: 1,
      store: { getUsedCapacity: () => 100, getFreeCapacity: () => 0 }
    };
    stubGame({ objects: { tomb1: tombstone } });

    const got = resolveTarget(groupCreep({}, tombstone, "tomb1"), energySourceGroup(), "tomb1" as Id<_HasId>);

    expect(got).toBe(tombstone);
  });

  it("drops a lock once the held object no longer resolves and picks a fresh member's candidate", () => {
    const dropped = { id: "drop1", pos: { x: 5, y: 5 }, amount: 100 };
    stubGame({ objects: { drop1: dropped } }); // "tomb1" is gone — consumed or decayed away

    const got = resolveTarget(
      groupCreep({ [FIND_DROPPED_RESOURCES]: [dropped] }, dropped, "tomb1"),
      energySourceGroup(),
      "tomb1" as Id<_HasId>
    );

    expect((got as { id: string }).id).toBe("drop1");
  });

  it("energySinkGroup pools extension/spawn/storage/container behind one notFull filter", () => {
    const spawn = fakeSite("spawn1", { structureType: STRUCTURE_SPAWN, free: 50 });
    stubGame({ objects: { spawn1: spawn } });

    const got = resolveTarget(groupCreep({ [FIND_STRUCTURES]: [spawn] }, spawn), energySinkGroup());

    expect((got as { id: string }).id).toBe("spawn1");
  });
});
