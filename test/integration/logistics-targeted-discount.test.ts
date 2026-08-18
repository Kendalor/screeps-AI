// Proves gh #49's targetedBy-equivalent + predicted-amount discount: a request already being served by
// one creep becomes less attractive on a SECOND creep's fresh ranking pass — a soft discount, not a hard
// lock — and a remote-room withdraw request needs no room-boundary special case to be matched and chained
// to a home-room deliver leg. See logistics/targeted.ts's header and ADR 0008's "drop travelHome's hard
// reservation-span guard" / "targetedBy is derived fresh each tick" sections.
//
// Driven entirely through the test-only __assignLogisticsTaskChain (gh #45) and
// __pickLogisticsRequestDiscounted (gh #49) console hooks (logistics/testHooks.ts) — standalone infra,
// not yet wired to any live role (see request.ts's/task.ts's headers). Candidates are dropped energy
// piles / a remote container, not seeded structures at arbitrary tiles: construction/planner.ts's
// demolish-unwanted pass tears down anything not part of the bunker's goal layout on tick 0 (see
// logistics-request-rank.test.ts's own header for the same note), so a container is only used in the
// remote room, which the home colony's planner never governs.

import { CARRY, CARRY_CAPACITY, CREEP_LIFE_TIME, MOVE, RESOURCE_ENERGY } from "@screeps/common/lib/constants";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, scoutableTerrain } from "./harness";
import { seedCreeps } from "./seed";

const HOME = "W0N1";
const REMOTE = "W1N1"; // scoutableTerrain()'s west neighbour — see harness.ts's own doc on the exit alignment.

let colony: BootedColony;

beforeAll(async () => {
  // scoutableTerrain (not the default bunkerTerrain) so the remote-pickup scenario (b) below has a real,
  // walkable crossing into W1N1 — the same terrain remote-mining.test.ts uses for the same reason.
  colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: scoutableTerrain() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "scenario (a): once one creep is routed toward a request, a second creep's ranking pass sees a discounted (not zero, not unaffected) remaining amount",
  async () => {
    const spawn = (await colony.structures("spawn"))[0];
    const spawnX = spawn.x as number;
    const spawnY = spawn.y as number;

    // A single large pile both creeps could plausibly serve — big enough that one CARRY,MOVE creep's
    // carry capacity (50) covers only a fraction of it, so the discount is provably partial, not total.
    const pileX = Math.min(48, spawnX + 4);
    await colony.server.world.addRoomObject(colony.room, "energy", pileX, spawnY, { energy: 500 });

    await seedCreeps(colony, [
      {
        name: "discount_creep_a",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, MOVE], // CARRY_CAPACITY(50) per part — one part, so this creep can carry 50 max.
        ttl: CREEP_LIFE_TIME
      },
      {
        name: "discount_creep_b",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);

    const pile = (await colony.roomObjects()).find(o => o.type === "energy" && o.x === pileX && o.y === spawnY);
    if (!pile) throw new Error("seeded drop pile not found");

    // Creep A commits to the pile first (a real persisted Task, via the gh #45 chain-assign hook) —
    // exactly the "routed toward this target" state buildTargetedBy scans for.
    await colony.console(
      `__assignLogisticsTaskChain("discount_creep_a", ${JSON.stringify([
        { kind: "withdraw", targetId: pile._id, resource: RESOURCE_ENERGY }
      ])})`
    );

    const assignedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsTask?: unknown }> };
      return mem.creeps?.discount_creep_a?.logisticsTask !== undefined;
    }, 20);
    expect(assignedTick, "creep A's task chain was never assigned/persisted").not.toBeNull();

    // Creep B's fresh ranking pass, scanning creep A's live task via buildTargetedBy.
    await colony.console(
      `__pickLogisticsRequestDiscounted("discount_creep_b", ${JSON.stringify([
        { targetId: pile._id, resource: RESOURCE_ENERGY, amount: 500 }
      ])}, ${JSON.stringify(["discount_creep_a"])})`
    );

    const pickedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsDiscountProbe?: unknown }> };
      return mem.creeps?.discount_creep_b?.logisticsDiscountProbe !== undefined;
    }, 20);
    expect(pickedTick, "creep B's discounted pick never recorded a result").not.toBeNull();

    const mem = (await colony.memory()) as {
      creeps?: Record<string, { logisticsRequestPick?: string; logisticsDiscountProbe?: { raw: number; discounted: number } }>;
    };
    const bMem = mem.creeps?.discount_creep_b;

    // Still the same request (the only candidate) — the discount is soft, not a hard lock that removes it.
    expect(bMem?.logisticsRequestPick).toBe(pile._id);

    const probe = bMem?.logisticsDiscountProbe;
    expect(probe, "no discount probe recorded").toBeDefined();
    expect(probe!.raw).toBe(500);
    // Discounted by creep A's carry capacity (50) — proportional to A's predicted delivery, not zero,
    // not unaffected by A's claim.
    expect(probe!.discounted).toBe(500 - CARRY_CAPACITY);
    expect(probe!.discounted).toBeGreaterThan(0);
    expect(probe!.discounted).toBeLessThan(probe!.raw);
  },
  60_000
);

test(
  "scenario (a-continued): when the predicted incoming delivery does not cover the full need, a second creep can still legitimately be routed to help",
  async () => {
    const spawn = (await colony.structures("spawn"))[0];
    const spawnX = spawn.x as number;
    const spawnY = Math.max(1, (spawn.y as number) - 3); // distinct row from the first test's pile.

    // A near-small pile (rate loser once discounted) and a far-large pile (rate winner) — sized so that
    // even after subtracting creep C's 50-capacity claim on the far pile, its discounted rate still beats
    // the near pile's undiscounted one, proving a second creep legitimately keeps helping the same target
    // rather than being pushed elsewhere by the discount alone.
    const nearX = Math.min(48, spawnX + 2);
    await colony.server.world.addRoomObject(colony.room, "energy", nearX, spawnY, { energy: 40 });
    const farX = Math.min(48, spawnX + 10);
    await colony.server.world.addRoomObject(colony.room, "energy", farX, spawnY, { energy: 2000 });

    await seedCreeps(colony, [
      {
        name: "discount_creep_c",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      },
      {
        name: "discount_creep_d",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);

    const piles = (await colony.roomObjects()).filter(o => o.type === "energy" && o.y === spawnY);
    const near = piles.find(p => p.x === nearX);
    const far = piles.find(p => p.x === farX);
    if (!near || !far) throw new Error("seeded drop piles not found");

    // Creep C commits to the far (large) pile first.
    await colony.console(
      `__assignLogisticsTaskChain("discount_creep_c", ${JSON.stringify([
        { kind: "withdraw", targetId: far._id, resource: RESOURCE_ENERGY }
      ])})`
    );
    const assignedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsTask?: unknown }> };
      return mem.creeps?.discount_creep_c?.logisticsTask !== undefined;
    }, 20);
    expect(assignedTick).not.toBeNull();

    // Creep D ranks both piles, scanning creep C's claim.
    await colony.console(
      `__pickLogisticsRequestDiscounted("discount_creep_d", ${JSON.stringify([
        { targetId: near._id, resource: RESOURCE_ENERGY, amount: 40 },
        { targetId: far._id, resource: RESOURCE_ENERGY, amount: 2000 }
      ])}, ${JSON.stringify(["discount_creep_c"])})`
    );
    const pickedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsDiscountProbe?: unknown }> };
      return mem.creeps?.discount_creep_d?.logisticsDiscountProbe !== undefined;
    }, 20);
    expect(pickedTick).not.toBeNull();

    const mem = (await colony.memory()) as {
      creeps?: Record<string, { logisticsRequestPick?: string; logisticsDiscountProbe?: { raw: number; discounted: number } }>;
    };
    const dMem = mem.creeps?.discount_creep_d;

    // Even discounted by C's 50-capacity claim, the far pile's remaining 1950 still outranks the near
    // pile's undiscounted 40 at these distances — D legitimately helps C rather than being deflected.
    expect(dMem?.logisticsRequestPick).toBe(far._id);
    expect(dMem?.logisticsDiscountProbe?.discounted).toBe(2000 - CARRY_CAPACITY);
  },
  60_000
);

test(
  "scenario (b): a remote room's container energy registers as an ordinary withdraw request and chains to a home-room deliver leg, with no hard reservation for the round trip",
  async () => {
    // A container in the REMOTE room, not HOME — proves no room-boundary special case is needed on the
    // withdraw side (ADR 0008's remote-pickup decision): pickBestRequest/pickBestDiscountedRequest are
    // handed a live target however far away, and rank it by the same rate math (naturally discounted by
    // the real cross-room distance), never refused outright for being out of room.
    await colony.server.world.addRoomObject(REMOTE, "container", 25, 25, {
      store: { energy: 300 },
      storeCapacity: 2000,
      hits: 100000,
      hitsMax: 100000
    });

    const spawn = (await colony.structures("spawn"))[0];
    await colony.setStore(spawn._id as string, 0);

    // Seeded standing IN the remote room (not near home spawn like seedCreeps' usual spot, and not via
    // colony.addCreep, which hardcodes the HOME room) — Game.getObjectById only resolves objects the bot
    // currently has vision of, same as the real engine; a transporter actually sent on a remote pickup
    // gains that vision by being there, which is exactly what this scenario needs to prove (no vision
    // special-case, just the ordinary "a creep in the room sees it" rule).
    await colony.server.world.addRoomObject(REMOTE, "creep", 25, 24, {
      name: "remote_pickup_creep",
      user: colony.bot.id,
      notifyWhenAttacked: true,
      body: [{ type: CARRY, hits: 100 }, { type: CARRY, hits: 100 }, { type: "move", hits: 100 }, { type: "move", hits: 100 }],
      store: { energy: 0 },
      storeCapacity: CARRY_CAPACITY * 2,
      hits: 400,
      hitsMax: 400,
      spawning: false,
      fatigue: 0,
      ageTime: (await colony.server.world.gameTime) + CREEP_LIFE_TIME
    });
    await colony.patchMemory(mem => {
      const creepMem = (mem.creeps ??= {}) as Record<string, CreepMemory>;
      creepMem.remote_pickup_creep = { home: colony.room, role: "hauler" };
    });

    const remoteObjects = (await colony.server.world.roomObjects(REMOTE)) as Array<{
      type: string;
      x: number;
      y: number;
      _id: string;
    }>;
    const container = remoteObjects.find(o => o.type === "container");
    if (!container) throw new Error("seeded remote container not found");

    // Rank it exactly like a local request — no separate remote code path.
    await colony.console(
      `__pickLogisticsRequest("remote_pickup_creep", ${JSON.stringify([
        { targetId: container._id, resource: RESOURCE_ENERGY, amount: 300 }
      ])})`
    );
    const pickedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRequestPick?: string }> };
      return mem.creeps?.remote_pickup_creep?.logisticsRequestPick !== undefined;
    }, 20);
    expect(pickedTick, "the remote pickup was never ranked/picked").not.toBeNull();

    const pickMem = (await colony.memory()) as { creeps?: Record<string, { logisticsRequestPick?: string }> };
    expect(pickMem.creeps?.remote_pickup_creep?.logisticsRequestPick).toBe(container._id);

    // Chain a real 2-leg route (gh #45's fork/parent shape): withdraw from the remote container, then
    // deliver home to the spawn — assigned immediately, same tick, with no bare travelHome-style
    // "don't reserve the deliver leg" placeholder task (ADR 0008 explicitly drops that guard in favor of
    // the discount alone).
    await colony.console(
      `__assignLogisticsTaskChain("remote_pickup_creep", ${JSON.stringify([
        { kind: "withdraw", targetId: container._id, resource: RESOURCE_ENERGY },
        { kind: "transfer", targetId: spawn._id, resource: RESOURCE_ENERGY }
      ])})`
    );

    const assignedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsTask?: { kind?: string } }> };
      return mem.creeps?.remote_pickup_creep?.logisticsTask?.kind === "withdraw";
    }, 20);
    expect(assignedTick, "the 2-leg withdraw-then-deliver chain was never assigned").not.toBeNull();

    // The chain is standalone infra (not wired into the live tick loop yet — see main.ts's history and
    // logisticsTaskRunner.ts's header): drive it explicitly via __runLogisticsTask (the same executor a
    // live role will call once wired, gh #52+), proving the chained task actually walks the creep home
    // and delivers, not just that it was assigned.
    const deliveredTick = await colony.runUntil(
      async () => (await colony.energyIn("spawn")) > 0,
      600,
      async () => {
        await colony.console(`__runLogisticsTask("remote_pickup_creep")`);
      }
    );
    expect(deliveredTick, "energy from the remote container never reached the home spawn").not.toBeNull();

    const spawnEnergy = await colony.energyIn("spawn");
    expect(spawnEnergy).toBeGreaterThan(0);
  },
  120_000
);
