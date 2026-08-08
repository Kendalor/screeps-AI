// No snapshot needed — hand-built Provider[]/Consumer[]/SnapCreep[] arrays, fully unit-testable.

import { describe, expect, it } from "vitest";
import { allocate, emptyReserved, refKey, type ReservedAmounts } from "../../../src/logistics/allocate";
import type { Consumer, Provider } from "../../../src/logistics/graph";
import { buildCostMatrix } from "../../../src/layouts/roads";
import type { NodeRef } from "../../../src/logistics/types";
import { openTerrain, snapCreep } from "../../fixtures";

const refKeyOf = (ref: NodeRef | undefined) => (ref ? refKey(ref) : undefined);

const idleHauler = (over: Partial<{ storeEnergy: number; storeCapacity: number; x: number; y: number }> = {}) =>
  snapCreep("hauler", { storeEnergy: 0, storeCapacity: 100, ...over });

const provider = (id: string, available: number, pos: { x: number; y: number } | null = { x: 0, y: 0 }): Provider => ({
  ref: { kind: "structure", id: id as Id<AnyStoreStructure> },
  resource: RESOURCE_ENERGY,
  available,
  urgency: 0,
  pos
});

const drop = (id: string, available: number, pos: { x: number; y: number } | null = { x: 0, y: 0 }): Provider => ({
  ref: { kind: "dropped", id: id as Id<Resource> },
  resource: RESOURCE_ENERGY,
  available,
  urgency: 1,
  pos
});

const consumer = (id: string, wanted: number, priority = 50, pos: { x: number; y: number } | null = null): Consumer => ({
  ref: { kind: "structure", id: id as Id<AnyStoreStructure> },
  resource: RESOURCE_ENERGY,
  wanted,
  priority,
  pos
});

const remoteProvider = (id: string, available: number): Provider => ({
  ref: { kind: "dropped", id: id as Id<Resource> },
  resource: RESOURCE_ENERGY,
  available,
  urgency: 1,
  pos: null,
  remote: true
});

describe("allocate", () => {
  it("assigns only one of two idle creeps when the consumer's demand is smaller than their combined capacity", () => {
    const creepA = idleHauler();
    const creepB = idleHauler();
    const result = allocate([provider("src", 1000)], [consumer("sink", 80)], [creepA, creepB], emptyReserved());

    const assigned = Object.keys(result);
    expect(assigned).toHaveLength(1);
    expect(result[assigned[0] as Id<Creep>]).toMatchObject({ kind: "pickup", amount: 80 });
  });

  it("gives a partially-loaded creep a deliver task using its current load, never a redundant pickup", () => {
    const creep = idleHauler({ storeEnergy: 40 });
    const result = allocate([provider("src", 1000)], [consumer("sink", 200)], [creep], emptyReserved());

    expect(result[creep.id]).toEqual({ kind: "deliver", to: { kind: "structure", id: "sink" }, resource: RESOURCE_ENERGY, amount: 40 });
  });

  describe("storage overflow fallback", () => {
    const overflowRef = { kind: "structure", id: "storage1" as Id<AnyStoreStructure> } as const;

    it("dumps a loaded creep's leftover into storage when no consumer wants it, instead of leaving it unassigned", () => {
      const creep = idleHauler({ storeEnergy: 40 });
      const result = allocate([], [], [creep], emptyReserved(), { ref: overflowRef, free: 1000 });

      expect(result[creep.id]).toEqual({ kind: "deliver", to: overflowRef, resource: RESOURCE_ENERGY, amount: 40 });
    });

    it("tops off real consumer demand first, only dumping the remainder into storage", () => {
      const creep = idleHauler({ storeEnergy: 40 });
      const result = allocate([], [consumer("sink", 10)], [creep], emptyReserved(), { ref: overflowRef, free: 1000 });

      expect(result[creep.id]).toEqual({
        kind: "deliver",
        to: { kind: "structure", id: "sink" },
        resource: RESOURCE_ENERGY,
        amount: 10,
        next: { kind: "deliver", to: overflowRef, resource: RESOURCE_ENERGY, amount: 30 }
      });
    });

    it("leaves the creep unassigned when there is no storage overflow to fall back on", () => {
      const creep = idleHauler({ storeEnergy: 40 });
      const result = allocate([], [], [creep], emptyReserved());

      expect(result[creep.id]).toBeUndefined();
    });

    it("does not dump more than storage's real free capacity across two creeps in the same tick", () => {
      const creepA = idleHauler({ storeEnergy: 40 });
      const creepB = idleHauler({ storeEnergy: 40 });
      const result = allocate([], [], [creepA, creepB], emptyReserved(), { ref: overflowRef, free: 50 });

      const totalDumped = [creepA, creepB].reduce((sum, c) => sum + (result[c.id]?.amount ?? 0), 0);
      expect(totalDumped).toBeLessThanOrEqual(50);
      // One of the two gets nothing further to dump once storage's free capacity is exhausted.
      expect([result[creepA.id]?.amount, result[creepB.id]?.amount]).toContain(10);
    });

    it("does not chain a duplicate storage leg when storage is already a normal consumer", () => {
      const creep = idleHauler({ storeEnergy: 40 });
      const result = allocate([], [{ ref: overflowRef, resource: RESOURCE_ENERGY, wanted: 40, priority: 70 }], [creep], emptyReserved(), {
        ref: overflowRef,
        free: 1000
      });

      expect(result[creep.id]).toEqual({ kind: "deliver", to: overflowRef, resource: RESOURCE_ENERGY, amount: 40 });
    });
  });

  it("pairs a pickup with its deliver as `next` so the creep flows straight through with no idle tick", () => {
    const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
    const result = allocate([provider("src", 1000)], [consumer("sink", 200)], [creep], emptyReserved());

    const task = result[creep.id];
    expect(task).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "src" }, amount: 100 });
    expect(task?.next).toEqual({
      kind: "deliver",
      to: { kind: "structure", id: "sink" },
      resource: RESOURCE_ENERGY,
      amount: 100
    });
  });

  it("chains a second pickup into `next` when one provider can't fill the creep for the consumer", () => {
    // Consumer wants 200; the creep can carry 200. No single provider has that much (each holds 120),
    // so the trip must pick up from BOTH before delivering, rather than delivering a half-empty load.
    const creep = idleHauler({ storeEnergy: 0, storeCapacity: 200 });
    const result = allocate([provider("a", 120), provider("b", 120)], [consumer("sink", 200)], [creep], emptyReserved());

    const task = result[creep.id];
    // First pickup drains the larger/equal provider up to what's left of the fill target.
    expect(task).toMatchObject({ kind: "pickup", amount: 120 });
    // Second leg is ANOTHER pickup (80 = 200 capacity - 120 already taken), from the other provider.
    expect(task?.next).toMatchObject({ kind: "pickup", amount: 80 });
    expect(refKeyOf(task?.next?.from)).not.toBe(refKeyOf(task?.from));
    // The chain terminates in a single deliver of the full 200 to the consumer.
    expect(task?.next?.next).toEqual({ kind: "deliver", to: { kind: "structure", id: "sink" }, resource: RESOURCE_ENERGY, amount: 200 });
  });

  describe("nearest-provider-that-can-fill selection", () => {
    it("picks the nearer provider that alone can fill the creep's capacity, over a larger but farther one", () => {
      const creep = idleHauler({ storeCapacity: 100, x: 0, y: 0 });
      const near = provider("near", 150, { x: 2, y: 2 }); // smaller, but still covers the 100 needed
      const far = provider("far", 1000, { x: 40, y: 40 }); // far larger, but a much longer trip
      const result = allocate([far, near], [consumer("sink", 100)], [creep], emptyReserved());

      expect(result[creep.id]).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "near" }, amount: 100 });
    });

    it("still falls back to largest-first chaining when no single provider can fill capacity alone, ignoring distance", () => {
      // Neither provider alone covers the 150 needed, so the trip must combine both regardless of
      // which is nearer — a nearby-but-small provider is not worth a special-case single-leg pick here.
      const creep = idleHauler({ storeCapacity: 150, x: 0, y: 0 });
      const nearSmall = provider("nearSmall", 60, { x: 1, y: 1 });
      const farBig = provider("farBig", 100, { x: 30, y: 30 });
      const result = allocate([nearSmall, farBig], [consumer("sink", 150)], [creep], emptyReserved());

      const task = result[creep.id];
      // Largest-available-first fallback still drains "farBig" first, same as pre-nearest-fill behavior.
      expect(task).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "farBig" }, amount: 100 });
      expect(task?.next).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "nearSmall" }, amount: 50 });
    });

    it("applies nearest-that-can-fill to the speculative decaying-source pickup too", () => {
      const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100, x: 0, y: 0 });
      const nearSmaller = drop("near", 120, { x: 3, y: 3 });
      const farBigger = drop("far", 500, { x: 25, y: 25 });
      const result = allocate([farBigger, nearSmaller], [], [creep], emptyReserved());

      expect(result[creep.id]).toMatchObject({ kind: "pickup", from: { kind: "dropped", id: "near" }, amount: 100 });
    });

    it("ignores a provider with unknown position (e.g. remote energy) when ranking by distance", () => {
      // A remote provider (pos: null) can still fill the need, but since it's not comparable to the
      // creep's position it must lose to a positioned provider that also qualifies, even if farther.
      const creep = idleHauler({ storeCapacity: 100, x: 0, y: 0 });
      const remote = provider("remote", 1000, null);
      const home = provider("home", 100, { x: 20, y: 20 });
      const result = allocate([remote, home], [consumer("sink", 100)], [creep], emptyReserved());

      expect(result[creep.id]).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "home" }, amount: 100 });
    });

    it("prefers a real-path-farther provider once a wall blocks the Chebyshev-nearer one, given a cost matrix", () => {
      // "walled" sits at Chebyshev range 3 from the creep — closer in a straight line than "open" at
      // range 20 — but a solid ring at range 2 seals off every tile within pickup range (1) of it, so
      // no path reaches it at all. Chebyshev would wrongly pick "walled"; real path distance must skip
      // it as unreachable and fall through to "open" instead.
      const terrain = openTerrain();
      for (let x = 8; x <= 12; x++) {
        for (let y = 8; y <= 12; y++) {
          if (Math.max(Math.abs(x - 10), Math.abs(y - 10)) === 2) terrain[x * 50 + y] = 0;
        }
      }
      const costMatrix = buildCostMatrix({ terrain, structures: [] });

      const creep = idleHauler({ storeCapacity: 100, x: 0, y: 0 });
      const walled = provider("walled", 1000, { x: 10, y: 10 });
      const open = provider("open", 100, { x: 20, y: 0 });
      const result = allocate([walled, open], [consumer("sink", 100)], [creep], emptyReserved(), null, costMatrix);

      expect(result[creep.id]).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "open" }, amount: 100 });
    });

    it("lets a remote provider's cached route distance win a nearest-fill pick over a farther home path", () => {
      // "farHome" is a real path of 29 tiles away (30 minus the range-1 stop); "remote"'s cached
      // anchor->source route is only 5 tiles, and remoteDistance now makes it comparable at all
      // (previously pos: null excluded it from this comparison entirely).
      const creep = idleHauler({ storeCapacity: 100, x: 0, y: 0 });
      const farHome = provider("farHome", 100, { x: 30, y: 0 });
      const remote: Provider = { ...remoteProvider("remote", 1000), remoteDistance: 5 };
      const result = allocate([farHome, remote], [consumer("sink", 100)], [creep], emptyReserved());

      // A remote pickup never chains a deliver (see the travelHome-first rule), so only the pickup itself is checked.
      expect(result[creep.id]).toMatchObject({ kind: "pickup", from: { kind: "dropped", id: "remote" }, amount: 100 });
    });
  });

  it("stops chaining pickups at the consumer's demand, not the creep's full capacity", () => {
    // Creep can carry 200 but the consumer only wants 150 — the chain fills to 150, no further.
    const creep = idleHauler({ storeEnergy: 0, storeCapacity: 200 });
    const result = allocate([provider("a", 100), provider("b", 100)], [consumer("sink", 150)], [creep], emptyReserved());

    const task = result[creep.id];
    expect(task).toMatchObject({ kind: "pickup", amount: 100 });
    expect(task?.next).toMatchObject({ kind: "pickup", amount: 50 }); // tops up to 150, the demand
    expect(task?.next?.next).toEqual({ kind: "deliver", to: { kind: "structure", id: "sink" }, resource: RESOURCE_ENERGY, amount: 150 });
  });

  it("does not double-book a provider drained by an earlier chained pickup", () => {
    // Only two providers, both consumed by one creep's chain; a second creep must find nothing left.
    const creepA = idleHauler({ storeEnergy: 0, storeCapacity: 200 });
    const creepB = idleHauler({ storeEnergy: 0, storeCapacity: 200 });
    const result = allocate([provider("a", 120), provider("b", 120)], [consumer("sink", 400)], [creepA, creepB], emptyReserved());

    // creepA fills to 200 across both providers; only 40 (240 total - 200) is left for creepB.
    const first = Object.values(result).find(t => t.amount === 120 || (t.kind === "pickup" && t.next));
    expect(first).toBeDefined();
    // creepB, if assigned, may only carry the 40 remainder.
    const bTask = result[creepB.id];
    if (bTask) expect(bTask.amount).toBeLessThanOrEqual(40);
  });

  it("chains delivers across multiple consumers so one full creep fills several sinks in one trip", () => {
    // A 200-cap creep, one big provider, and four 50-cap extensions: one pickup then four delivers,
    // each 50, so no other creep is dispatched to any of them.
    const creep = idleHauler({ storeEnergy: 0, storeCapacity: 200 });
    const sinks = [consumer("e1", 50, 100), consumer("e2", 50, 100), consumer("e3", 50, 100), consumer("e4", 50, 100)];
    const result = allocate([provider("src", 1000)], sinks, [creep], emptyReserved());

    const task = result[creep.id];
    expect(task).toMatchObject({ kind: "pickup", amount: 200 });
    // Walk the chain: pickup -> deliver e1 -> deliver e2 -> deliver e3 -> deliver e4.
    const legs: { kind: string; amount: number; to?: { id?: string } }[] = [];
    for (let leg = task; leg; leg = leg.next) legs.push(leg as never);
    const delivers = legs.filter(l => l.kind === "deliver");
    expect(delivers).toHaveLength(4);
    expect(delivers.every(d => d.amount === 50)).toBe(true);
    expect(delivers.map(d => (d.to as { id: string }).id).sort()).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("spreads a pre-loaded creep's carried energy across multiple sinks", () => {
    // Loaded with 150, three 50-cap extensions: a three-deliver chain, no pickup leg.
    const creep = idleHauler({ storeEnergy: 150, storeCapacity: 200 });
    const sinks = [consumer("e1", 50, 100), consumer("e2", 50, 100), consumer("e3", 50, 100)];
    const result = allocate([provider("src", 1000)], sinks, [creep], emptyReserved());

    const task = result[creep.id];
    expect(task?.kind).toBe("deliver");
    const legs: { kind: string; amount: number }[] = [];
    for (let leg = task; leg; leg = leg.next) legs.push(leg as never);
    expect(legs).toHaveLength(3);
    expect(legs.every(l => l.kind === "deliver" && l.amount === 50)).toBe(true);
  });

  it("visits same-priority sinks nearest-first, not in array order", () => {
    // Creep starts at (0,0). Consumers are listed far-then-near-then-mid on purpose — array order alone
    // would visit them in that scrambled order; route order should walk near -> mid -> far instead.
    // Kept within MAX_CHAIN_HOP of each other (unlike a real bunker's cross-room leftovers) so this
    // stays a pure ordering test, not a chain-capping one — see the dedicated hop-cap tests below.
    const creep = idleHauler({ storeEnergy: 150, storeCapacity: 200, x: 0, y: 0 });
    const sinks = [
      consumer("far", 50, 100, { x: 6, y: 0 }),
      consumer("near", 50, 100, { x: 2, y: 0 }),
      consumer("mid", 50, 100, { x: 4, y: 0 })
    ];
    const costMatrix = buildCostMatrix({ terrain: openTerrain(), structures: [] });
    const result = allocate([provider("src", 1000)], sinks, [creep], emptyReserved(), null, costMatrix);

    const task = result[creep.id];
    const ids: string[] = [];
    for (let leg = task; leg; leg = leg.next) if (leg.kind === "deliver") ids.push((leg.to as { id: string }).id);
    expect(ids).toEqual(["near", "mid", "far"]);
  });

  it("stops chaining once the next sink is a long hop from the last one visited, leaving it for a later plan", () => {
    // "near" sits right next to the creep; "isolated" is real bunker-scale far (matches the W8N3 live
    // capture: a scattered leftover extension 5-7 tiles from the nearest claimed cluster) — beyond
    // MAX_CHAIN_HOP. The chain should take "near" and then stop, not leap to "isolated" in the same trip.
    const creep = idleHauler({ storeEnergy: 150, storeCapacity: 200, x: 0, y: 0 });
    const sinks = [consumer("near", 50, 100, { x: 1, y: 0 }), consumer("isolated", 50, 100, { x: 10, y: 0 })];
    const costMatrix = buildCostMatrix({ terrain: openTerrain(), structures: [] });
    const result = allocate([provider("src", 1000)], sinks, [creep], emptyReserved(), null, costMatrix);

    const task = result[creep.id];
    const ids: string[] = [];
    for (let leg = task; leg; leg = leg.next) if (leg.kind === "deliver") ids.push((leg.to as { id: string }).id);
    expect(ids).toEqual(["near"]);
  });

  it("chains the next leg from the stand tile actually reached, not the last stop's own position", () => {
    // Two walled 3x3 pockets, each with a single-tile gap: "second"'s gap faces away from "first"
    // (south), "first"'s gap faces toward second's pocket (west). "first" is visited first (its gap
    // sits right off the approach corridor). The tile a creep actually stands on to deliver to "first"
    // (at its gap, range 1) is one tile closer to "second"'s gap than first's own raw (x, y) is: 3 tiles
    // (MAX_CHAIN_HOP) from the real stand tile, but 4 from first's own position. The pre-fix code priced
    // the next hop from the consumer's own position and would wrongly cut the chain there; pricing it
    // from the real stand tile keeps "second" within the cap.
    const terrain = openTerrain();
    const setWall = (x: number, y: number) => (terrain[x * 50 + y] = 0);
    for (let x = 8; x <= 10; x++) {
      for (let y = 8; y <= 10; y++) {
        if ((x === 8 || x === 10 || y === 8 || y === 10) && !(x === 9 && y === 10)) setWall(x, y);
      }
    }
    for (let x = 12; x <= 14; x++) {
      for (let y = 8; y <= 10; y++) {
        if ((x === 12 || x === 14 || y === 8 || y === 10) && !(x === 12 && y === 9)) setWall(x, y);
      }
    }
    const costMatrix = buildCostMatrix({ terrain, structures: [] });

    const creep = idleHauler({ storeEnergy: 150, storeCapacity: 200, x: 9, y: 0 });
    const sinks = [consumer("second", 50, 100, { x: 9, y: 9 }), consumer("first", 50, 100, { x: 13, y: 9 })];
    const result = allocate([provider("src", 1000)], sinks, [creep], emptyReserved(), null, costMatrix);

    const task = result[creep.id];
    const ids: string[] = [];
    for (let leg = task; leg; leg = leg.next) if (leg.kind === "deliver") ids.push((leg.to as { id: string }).id);
    expect(ids).toEqual(["first", "second"]);
  });

  it("still reaches a single far consumer as the FIRST stop — the cap only limits hops between chained stops", () => {
    // No nearby sink at all: the sole consumer is bunker-scale far from the creep's own position. That
    // first hop must never be capped, or a creep with only one distant sink to serve would get nothing.
    const creep = idleHauler({ storeEnergy: 150, storeCapacity: 200, x: 0, y: 0 });
    const sinks = [consumer("isolated", 50, 100, { x: 10, y: 0 })];
    const costMatrix = buildCostMatrix({ terrain: openTerrain(), structures: [] });
    const result = allocate([provider("src", 1000)], sinks, [creep], emptyReserved(), null, costMatrix);

    const task = result[creep.id];
    const ids: string[] = [];
    for (let leg = task; leg; leg = leg.next) if (leg.kind === "deliver") ids.push((leg.to as { id: string }).id);
    expect(ids).toEqual(["isolated"]);
  });

  it("reserves each sink in a deliver chain so a second creep isn't sent to the same extensions", () => {
    // Two full-enough sinks, two loaded creeps: the first claims both; the second finds nothing open.
    const creepA = idleHauler({ storeEnergy: 100, storeCapacity: 200 });
    const creepB = idleHauler({ storeEnergy: 100, storeCapacity: 200 });
    const sinks = [consumer("e1", 50, 100), consumer("e2", 50, 100)];
    const result = allocate([provider("src", 1000)], sinks, [creepA, creepB], emptyReserved());

    // creepA fills both e1 and e2 (100 carried -> 50 + 50); creepB has no open sink left.
    const aLegs: { kind: string }[] = [];
    for (let leg = result[creepA.id]; leg; leg = leg.next) aLegs.push(leg as never);
    expect(aLegs.filter(l => l.kind === "deliver")).toHaveLength(2);
    expect(result[creepB.id]).toBeUndefined();
  });

  it("does not double-book a provider/consumer already reserved by a mid-task creep", () => {
    const reserved: ReservedAmounts = { providers: { "structure:src": 1000 }, consumers: {} };
    const creep = idleHauler();
    const result = allocate([provider("src", 1000)], [consumer("sink", 200)], [creep], reserved);

    expect(result[creep.id]).toBeUndefined(); // provider fully claimed already
  });

  it("serves higher-priority consumers first and starves lower-priority ones when supply is short", () => {
    const creepA = idleHauler();
    const creepB = idleHauler();
    const highPriority = consumer("urgent", 100, 90);
    const lowPriority = consumer("minor", 100, 10);

    const result = allocate([provider("src", 100)], [lowPriority, highPriority], [creepA, creepB], emptyReserved());

    const tasks = Object.values(result);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ to: { kind: "structure", id: "urgent" } });
  });

  it("assigns nothing to a creep with no free capacity and no current load", () => {
    const creep = idleHauler({ storeCapacity: 0 });
    const result = allocate([provider("src", 1000)], [consumer("sink", 100)], [creep], emptyReserved());
    expect(result[creep.id]).toBeUndefined();
  });

  it("assigns nothing when there are no consumers", () => {
    const creep = idleHauler();
    expect(allocate([provider("src", 1000)], [], [creep], emptyReserved())).toEqual({});
  });

  it("assigns nothing when there are no providers for an empty creep", () => {
    const creep = idleHauler();
    expect(allocate([], [consumer("sink", 100)], [creep], emptyReserved())).toEqual({});
  });

  describe("speculative pickup from decaying sources", () => {
    it("sends an empty creep to a dropped pile even when no consumer is waiting, with no deliver leg", () => {
      const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const result = allocate([drop("d1", 500)], [], [creep], emptyReserved());

      expect(result[creep.id]).toEqual({
        kind: "pickup",
        from: { kind: "dropped", id: "d1" },
        resource: RESOURCE_ENERGY,
        amount: 100
      });
      expect(result[creep.id]?.to).toBeUndefined();
      expect(result[creep.id]?.next).toBeUndefined();
    });

    it("does NOT speculatively pick up from a non-decaying container when no consumer is waiting", () => {
      const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const result = allocate([provider("cont", 500)], [], [creep], emptyReserved());
      expect(result[creep.id]).toBeUndefined();
    });

    it("does not over-book a drop across the consumer-driven pass and the speculative pass", () => {
      const consumerCreep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const speculativeCreep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      // Only 120 on the ground: 100 goes to the consumer-driven pickup, 20 left for the speculative one.
      const result = allocate([drop("d1", 120)], [consumer("sink", 100)], [consumerCreep, speculativeCreep], emptyReserved());

      expect(result[consumerCreep.id]).toMatchObject({ kind: "pickup", to: { kind: "structure", id: "sink" }, amount: 100 });
      expect(result[speculativeCreep.id]).toMatchObject({ kind: "pickup", amount: 20 });
      expect(result[speculativeCreep.id]?.to).toBeUndefined();
    });

    it("leaves a full creep idle rather than sending it to a drop it cannot carry", () => {
      const full = idleHauler({ storeEnergy: 100, storeCapacity: 100 });
      const result = allocate([drop("d1", 500)], [], [full], emptyReserved());
      expect(result[full.id]).toBeUndefined();
    });
  });

  describe("remote (cross-room) providers defer the deliver commitment", () => {
    it("queues a remote pickup alone, with no deliver chained on", () => {
      const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const result = allocate([remoteProvider("remote1", 1000)], [consumer("sink", 100)], [creep], emptyReserved());

      expect(result[creep.id]).toEqual({
        kind: "pickup",
        from: { kind: "dropped", id: "remote1" },
        resource: RESOURCE_ENERGY,
        amount: 100
      });
      expect(result[creep.id]?.to).toBeUndefined();
      expect(result[creep.id]?.next).toBeUndefined();
    });

    it("leaves consumer demand fully open on a later tick since a remote pickup reserves nothing", () => {
      // Tick 1: a creep is sent to a remote pile. Its task has no deliver leg chained on.
      const remoteCreep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const firstResult = allocate([remoteProvider("remote1", 1000)], [consumer("sink", 100)], [remoteCreep], emptyReserved());
      const remoteTask = firstResult[remoteCreep.id];
      expect(remoteTask?.next).toBeUndefined();

      // Fold that task the same way index.ts's foldReserved would every following tick: walking its
      // pickup/deliver legs. With no deliver leg, nothing lands in reserved.consumers.
      const reserved: ReservedAmounts = emptyReserved();
      for (let leg = remoteTask; leg; leg = leg.next) {
        if (leg.kind === "deliver" && leg.to) reserved.consumers[refKey(leg.to)] = (reserved.consumers[refKey(leg.to)] ?? 0) + leg.amount;
      }

      // Tick 2 (or any later tick while the remote creep is still mid-trip): a home-fed creep still
      // sees the sink's full, unreserved demand.
      const homeCreep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const result = allocate([provider("home1", 1000)], [consumer("sink", 100)], [homeCreep], reserved);

      expect(result[homeCreep.id]).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "home1" }, amount: 100 });
      expect(result[homeCreep.id]?.next).toEqual({
        kind: "deliver",
        to: { kind: "structure", id: "sink" },
        resource: RESOURCE_ENERGY,
        amount: 100
      });
    });

    it("sends a loaded creep still outside its home room home first, instead of committing to a deliver", () => {
      const creep = snapCreep("hauler", { storeEnergy: 80, storeCapacity: 100, home: "W1N1", room: "W2N1" });
      const result = allocate([provider("home1", 1000)], [consumer("sink", 200)], [creep], emptyReserved());

      expect(result[creep.id]).toEqual({ kind: "travelHome", resource: RESOURCE_ENERGY, amount: 80 });
    });

    it("does not reserve the consumer for a creep sent home first, leaving demand open for a creep already home", () => {
      const awayCreep = snapCreep("hauler", { storeEnergy: 80, storeCapacity: 100, home: "W1N1", room: "W2N1" });
      const homeCreep = snapCreep("hauler", { storeEnergy: 100, storeCapacity: 100, home: "W1N1", room: "W1N1" });
      const result = allocate([provider("home1", 1000)], [consumer("sink", 100)], [awayCreep, homeCreep], emptyReserved());

      expect(result[awayCreep.id]).toEqual({ kind: "travelHome", resource: RESOURCE_ENERGY, amount: 80 });
      expect(result[homeCreep.id]).toMatchObject({ kind: "deliver", to: { kind: "structure", id: "sink" }, amount: 100 });
    });

    it("still gives a loaded creep already home its deliver normally", () => {
      const creep = snapCreep("hauler", { storeEnergy: 50, storeCapacity: 100, home: "W1N1", room: "W1N1" });
      const result = allocate([provider("home1", 1000)], [consumer("sink", 100)], [creep], emptyReserved());

      expect(result[creep.id]).toEqual({ kind: "deliver", to: { kind: "structure", id: "sink" }, resource: RESOURCE_ENERGY, amount: 50 });
    });
  });

  it("processes loaded creeps before empty ones so a pre-loaded creep wins the deliver", () => {
    // One consumer wanting 100. A loaded creep (carrying 100) and an empty creep both idle. The loaded
    // creep must get the deliver — no reason to send the empty one on a round trip while a ready creep waits.
    const loaded = idleHauler({ storeEnergy: 100, storeCapacity: 100 });
    const empty = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
    // Pass empty first to prove ordering is by load, not input order.
    const result = allocate([provider("src", 1000)], [consumer("sink", 100)], [empty, loaded], emptyReserved());

    expect(result[loaded.id]).toMatchObject({ kind: "deliver", to: { kind: "structure", id: "sink" }, amount: 100 });
    expect(result[empty.id]).toBeUndefined(); // demand already met by the loaded creep
  });
});
