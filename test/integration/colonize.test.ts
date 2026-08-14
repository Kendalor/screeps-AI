// Colonize, end to end: a stable RCL3 colony gets a "colonize:<room>" flag placed on a neighbouring,
// unowned room. Under its own behaviour (no test-side shortcut) the colony should: pick itself as the
// sponsor via runColonizeFlags, spawn a colonizer, remove the flag once that spawn actually happens,
// walk the colonizer across the border, claim the target's controller, recycle the colonizer immediately
// (see behaviors/interpreter.ts's claimStep), and in parallel spawn a settler that bootstraps the new
// room from nothing — first construction site placed (there being no anchor/spawn there yet), first
// spawn built, and the new room showing up as a real, owned colony.
//
// Why seeded, not cold: the point is to observe the colonize pipeline, not re-measure the RCL climb
// (see rcl3.test.ts) or scouting (see scouting.test.ts). RCL3, same as remote-mining.test.ts/
// scouting.test.ts — RCL5 was tried and made things WORSE: seedColony's plannedWorkforce polls every
// operation's demand against a snapshot with empty energy/no live creeps yet, and a bigger RCL5
// structure set (30 extensions vs RCL3's 10) just means proportionally MORE workforce needed to claw
// back from that same cold-start gap (seedColony's own header says outright it seeds a cold-start shape,
// not a steady-state economy). Directly measured: RCL5 produced 0 spawns in a 500-tick window vs RCL3's
// 3-4. Instead, EXTRA_WORKFORCE below tops up seedColony's naturally-thin RCL3 roster with additional
// miners/transport/upgraders so the sponsor starts genuinely steady-state rather than organically
// ramping up over thousands of ticks.
//
// Terrain: scoutableTerrain() (shared with scouting.test.ts/remote-mining.test.ts) opens W0N1's borders
// exactly where the stub neighbours W0N2 and W1N1 have their facing exits, so a colonizer/settler can
// actually walk there. W1N1 is the target, not W0N2, for the same roomType() reason remote-mining.test.ts
// documents: every room with x=0 or y=0 in stubWorld's 9-room block is a highway (no controller to claim).
//
// Remote mining is disabled (Memory.debugDisableRemoteMining — see its doc in memory/schema.ts): those
// same open borders make W0N2/W1N1 legitimate scout/remote-mining candidates too, and an RCL3 sponsor's
// real steady-state economy (measured directly: spawn+extension energy oscillates in the low hundreds
// out of 800 capacity, well below what's needed to comfortably fund BOTH a normal remote-mining fleet
// and colonize's own colonizer+settler) can't sustain both at once within a reasonable tick budget —
// confirmed live: without this flag the settler request starved indefinitely behind remote-mining
// demand. Colonize's own economics are what this test measures, not remote mining's.

import { afterAll, beforeAll, expect, test } from "vitest";
import { roleDef } from "../../src/behaviors/roles";
import { orderBody } from "../../src/spawn/body";
import { opName } from "../../src/spawn/request";
import { BootedColony, bundleBot, CheckpointLadder, scoutableTerrain } from "./harness";
import { seedColony, seedCreeps, spreadTtl, type SeededCreep } from "./seed";

const HOME = "W0N1";
const TARGET = "W1N1";

// seedColony's own workforce sizing (plannedWorkforce) polls every operation's demand against a
// snapshot with empty energy/no live creeps yet — see that function's own doc: "a seeded colony starts
// with miners and no haulers/upgraders, and the running colony fills those in from tick one." That
// organic ramp-up is fine for a scenario with no extra spawn demand (remote-mining.test.ts,
// scouting.test.ts), but colonize adds real ongoing load (a 650-cost colonizer, then repeated settler
// replenishment) on top of it — directly measured, the naturally-thin RCL3 roster alone produces only
// 3-4 spawns in a 500-tick window, nowhere near enough headroom. Top up with a hand-picked extra
// transport/upgrader roster (sized off the real role bodies, stamped with the real operations' own op
// names so they're claimed exactly like organically-spawned ones) so the sponsor starts genuinely
// steady-state instead.
const EXTRA_TRANSPORT = 3;
const EXTRA_UPGRADERS = 2;

async function seedExtraWorkforce(colony: BootedColony): Promise<void> {
  const energyCapacity = await colony.energyCapacity();
  // Neither Transport's nor Upgrader's body() formula actually reads ctx (only miner sizing cares about
  // container/link presence) — a bare BodyContext literal is enough to satisfy RoleDef.body's signature.
  const ctx = { hasContainer: false, hasLink: false };
  const transportBody = orderBody(roleDef("transport")!.body(energyCapacity, ctx));
  const upgraderBody = orderBody(roleDef("upgrader")!.body(energyCapacity, ctx));

  const extras: SeededCreep[] = [
    ...Array.from({ length: EXTRA_TRANSPORT }, (_, i) => ({
      name: `seed_extra_transport_${i}`,
      role: "transport" as const,
      memory: { role: "transport" as const, home: HOME, op: opName("logistics", HOME) },
      body: transportBody,
      ttl: spreadTtl(i, EXTRA_TRANSPORT)
    })),
    ...Array.from({ length: EXTRA_UPGRADERS }, (_, i) => ({
      name: `seed_extra_upgrader_${i}`,
      role: "upgrader" as const,
      memory: { role: "upgrader" as const, home: HOME, op: opName("upgrading", HOME) },
      body: upgraderBody,
      ttl: spreadTtl(i, EXTRA_UPGRADERS)
    }))
  ];

  await seedCreeps(colony, extras);
}

// The anchor (Memory.colonies[room].anchor) is not cached until the bot has run a tick; seedColony
// throws without it.
const TICKS_TO_ANCHOR = 5;

let colony: BootedColony;

beforeAll(async () => {
  // gcl: 1_000_000 raw XP => level 2 (see BootOptions.gcl's doc) — a fresh GCL1 bot can legally own only
  // one room, so colonizing a second room is impossible without raising it first, same as seedColony
  // skips the natural RCL grind.
  colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: scoutableTerrain(), gcl: 1_000_000 });

  await colony.runTicks(TICKS_TO_ANCHOR);
  expect(await colony.anchor(), "the bot never cached a bunker anchor — nothing downstream runs").not.toBeNull();

  // A finished RCL3 base: structures, workforce and energy all from the bot's own planners.
  const seeded = await seedColony(colony, { level: 3 });
  expect(seeded.creeps.length, "no workforce was seeded — the colony would cold-start instead").toBeGreaterThan(0);
  expect(seeded.energy, "the seeded colony started with no energy — it would recover rather than run").toBeGreaterThan(0);

  // Top up with extra transport/upgraders so the sponsor starts steady-state — see EXTRA_TRANSPORT's doc.
  await seedExtraWorkforce(colony);

  await colony.patchMemory(mem => {
    (mem as { debugDisableRemoteMining?: boolean }).debugDisableRemoteMining = true;
  });
  await colony.placeFlag(`colonize:${TARGET}`, HOME, 25, 25);
}, 180_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a stable colony claims a flagged neighbour and bootstraps it into a real colony",
  async () => {
    const ladder = new CheckpointLadder([
      // Confirms the seed took (workforce alive from tick one), not a cold recovery.
      { name: "workforce alive", by: 20 },
      // runColonizeFlags picked a sponsor and spawned a colonizer, removing the flag on success.
      { name: "flag consumed", by: 300 },
      // The colonizer physically entered the target room.
      { name: "colonizer entered target", by: 800 },
      // claimController succeeded — the target shows up owned by this bot.
      { name: "target claimed", by: 1200 },
      // A settler is present in the target room, bootstrapping it.
      { name: "settler in target", by: 1200 },
      // The new colony's own spawn construction site was placed (Building's first-priority structure
      // in a room with nothing built yet).
      { name: "spawn site placed in target", by: 2000 },
      // The new colony finished building its own spawn.
      { name: "spawn built in target", by: 4000 }
    ]);

    const targetOwner = async (): Promise<string | undefined> => {
      const objs = (await colony.server.world.roomObjects(TARGET)) as Array<{ type: string; user?: string }>;
      return objs.find(o => o.type === "controller")?.user;
    };

    const targetCreepRoles = async (): Promise<string[]> => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { role?: string; home?: string }> };
      const objs = (await colony.server.world.roomObjects(TARGET)) as Array<{ type: string; user?: string; name?: string }>;
      const names = objs.filter(o => o.type === "creep" && o.user === colony.bot.id).map(o => o.name).filter((n): n is string => !!n);
      return names.map(n => mem.creeps?.[n]?.role).filter((r): r is string => r !== undefined);
    };

    const targetHasColonizer = async (): Promise<boolean> => (await targetCreepRoles()).includes("colonizer");
    const targetHasSettler = async (): Promise<boolean> => (await targetCreepRoles()).includes("settler");

    const targetSpawnSites = async (): Promise<number> => {
      const objs = (await colony.server.world.roomObjects(TARGET)) as Array<{ type: string; structureType?: string; user?: string }>;
      return objs.filter(o => o.type === "constructionSite" && o.structureType === "spawn" && o.user === colony.bot.id).length;
    };

    const targetSpawnBuilt = async (): Promise<boolean> => {
      const objs = (await colony.server.world.roomObjects(TARGET)) as Array<{ type: string; user?: string }>;
      return objs.some(o => o.type === "spawn" && o.user === colony.bot.id);
    };

    const flagConsumedAt = { tick: undefined as number | undefined };

    const reached = await colony.runUntil(
      targetSpawnBuilt,
      4000,
      async tick => {
        const creeps = await colony.creepCount();
        const flags = await colony.flagNames();
        if (flagConsumedAt.tick === undefined && !flags.includes(`colonize:${TARGET}`)) {
          flagConsumedAt.tick = tick;
        }
        const owner = await targetOwner();
        const colonizerPresent = await targetHasColonizer();
        const settlerPresent = await targetHasSettler();
        const spawnSites = await targetSpawnSites();
        const spawnBuilt = await targetSpawnBuilt();

        await ladder.sample(tick, name => {
          switch (name) {
            case "workforce alive":
              return creeps > 0;
            case "flag consumed":
              return flagConsumedAt.tick !== undefined;
            case "colonizer entered target":
              return colonizerPresent;
            case "target claimed":
              return owner === colony.bot.id;
            case "settler in target":
              return settlerPresent;
            case "spawn site placed in target":
              return spawnSites > 0;
            case "spawn built in target":
              return spawnBuilt;
            default:
              return false;
          }
        });
      }
    );

    expect(reached, `${TARGET} never got its own spawn built within 4000 ticks:\n${ladder.report()}`).not.toBeNull();
    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();

    expect(await targetOwner(), `${TARGET}'s controller was never claimed by this bot`).toBe(colony.bot.id);
    expect(await targetSpawnBuilt(), `${TARGET} never finished building its own spawn`).toBe(true);
  },
  600_000
);
