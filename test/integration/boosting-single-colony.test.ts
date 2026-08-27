// Boosting, end to end, single colony: a finished RCL6 colony (labs + terminal already built, storage
// stocked with every boost-line compound at its real empire target) gets a "simpleBaitTower:<room>:1:T1"
// flag placed. Under its own behavior (no test-side shortcut for any step) the colony should: sponsor
// itself (canHostBoosting/pickBoostedSponsor, empire/sponsor.ts), spawn a SimpleBaitTowerRole creep
// stamped with memory.boosts/boostNeeds (SingleTargetFlagOperation.desiredCreeps), have the LabRunner
// (Colony.labs(), src/colony/index.ts) claim ALL 3 of its boost labs — one each for tough/heal/attack's T1
// compounds (GO/LO/UH respectively, verified against the real BOOSTS table,
// node_modules/@screeps/common/lib/constants.js) — have Transport haul each compound from storage into its
// claimed lab (registerBoostLabWantRequest, src/logistics/transportRegister.ts), and finally have the
// creep self-discover the stocked labs and boostCreep() on each line (boostPreemption,
// src/behaviors/interpreter.ts) until every TOUGH/HEAL/ATTACK part carries a boost — a genuinely FULLY
// boosted creep, not just "one part on one line" (gh #61 epic follow-up: SimpleBaitTowerRole has 3
// boostable actions simultaneously, unlike Demolisher's single dismantle line, so this is what actually
// exercises the lab-runner's 3-simultaneous-claim path and the empire logistics matcher moving more than
// one compound at once).
//
// Why seeded, not cold: RCL6 from nothing is an enormous grind (see rcl3.test.ts's own reasoning for why
// even RCL3 is seeded); the point here is to observe the boosting pipeline, not re-measure the RCL climb.
//
// LIQUIDATION_MODE (src/empire/boostTargets.ts): hand-edited to `true` for real deploys — collapses
// every boost-line resource's empire target to 0, which would make Steward read the very compounds this
// test stocks as pure surplus to push out to the terminal/market instead of holding them for the lab (see
// that file's own doc for the full mechanism). Since this flag's effect runs inside the bundled bot's own
// sandboxed isolate, no in-process test override can reach it — this test builds its OWN private bundle
// (harness.ts's buildBotBundle) with LIQUIDATION_MODE_OVERRIDE=false instead of using the shared
// bundleBot() cache.
//
// No available remote rooms: debugDisableRemoteMining (see memory/schema.ts's doc) is set directly,
// same mechanism colonize.test.ts uses, so spawn budget isn't split with a remote-mining fleet — this
// test measures boosting's own economics, not remote mining's.
//
// Terrain: scoutableTerrain(), not bunkerTerrain() — a fully-walled room (every border sealed) makes
// Game.map.findRoute report every OTHER room as genuinely unreachable (route-finding checks real exit
// connectivity, not just map adjacency), which made pickSponsor/pickBoostedSponsor correctly reject the
// flag's target as "unreachable" (confirmed directly: the bot logged exactly that error every tick).
// scoutableTerrain() opens real exits so a target room resolves as reachable for sponsor-pick's route
// check, while debugDisableRemoteMining above still keeps those same open borders from being treated as
// remote-mining candidates.

import { afterAll, beforeAll, expect, test } from "vitest";
import { roleDef } from "../../src/behaviors/roles";
import { orderBody } from "../../src/spawn/body";
import { opName } from "../../src/spawn/request";
import { BootedColony, buildBotBundle, CheckpointLadder, scoutableTerrain } from "./harness";
import { seedColony, seedCreeps, spreadTtl, type SeededCreep } from "./seed";

const HOME = "W0N1";
const TARGET = "W1N1";

// The anchor (Memory.colonies[room].anchor) is not cached until the bot has run a tick; seedColony
// throws without it.
const TICKS_TO_ANCHOR = 5;

// seedColony's own workforce sizing (plannedWorkforce) polls each operation's demand against a snapshot
// with empty energy and no live creeps yet, so at RCL6 it seeds only the two miners and two supply
// creeps its cold-start shape produces (see that function's own doc) — no transport, no steward, no
// upgrader. Two things then starve the colony:
//   1. Nothing moves energy from storage into the extensions, so energyAvailable never climbs past
//      what the miners drop this tick. The RCL6 bait-tower body is sized off the FULL 2300 energy
//      capacity, so a colony whose extensions never fill stops on that unaffordable top request every
//      tick (spawn arbiter's stop-not-skip livelock guard) and never spawns it.
//   2. The "labs stocked" checkpoint needs Transport hauling compounds from storage into the claimed
//      boost labs — this needs a properly-sized Transport roster, which seedColony's cold-start shape
//      never seeds either.
// So top the seeded roster up with a hand-picked extra transport/steward/upgrader roster (sized off the
// real role bodies, stamped with the real operations' own op names so they're claimed exactly like
// organically-spawned ones), same technique colonize.test.ts uses for its own RCL3 cold-start gap — just
// scaled up for RCL6's much larger economy and its extra Steward role. energyFraction is raised to 1.0
// (extensions start full) and storage is given a real energy reserve (seedAllCompounds below) so the
// extras have energy to keep the extensions topped up after each spawn.
const EXTRA_TRANSPORT = 4;
const EXTRA_UPGRADERS = 2;
const EXTRA_STEWARDS = 1;

async function seedExtraWorkforce(colony: BootedColony): Promise<void> {
  const energyCapacity = await colony.energyCapacity();
  // None of these three roles' body() formulas read ctx (only miner sizing cares about container/link
  // presence) — a bare BodyContext literal satisfies RoleDef.body's signature.
  const ctx = { hasContainer: false, hasLink: false };
  const transportBody = orderBody(roleDef("transport")!.body(energyCapacity, ctx));
  const upgraderBody = orderBody(roleDef("upgrader")!.body(energyCapacity, ctx));
  const stewardBody = orderBody(roleDef("steward")!.body(energyCapacity, ctx));

  // Transport and Steward are both owned by the Logistics operation (op: "logistics:<room>" — see
  // operations/logistics.ts's desiredCreeps/desiredStewards, both stamping `op: this.name`); Upgrader is
  // owned by Upgrading (op: "upgrading:<room>").
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
    })),
    ...Array.from({ length: EXTRA_STEWARDS }, (_, i) => ({
      name: `seed_extra_steward_${i}`,
      role: "steward" as const,
      memory: { role: "steward" as const, home: HOME, op: opName("logistics", HOME) },
      body: stewardBody,
      ttl: spreadTtl(i, EXTRA_STEWARDS)
    }))
  ];

  await seedCreeps(colony, extras);
}

// Real empire target for every reaction compound (src/empire/boostTargets.ts's COMPOUND_TARGET) —
// stocking exactly this much means storage is neither deficient (Steward would keep pulling more in,
// fine either way) nor in RESOURCE_STORAGE_SURPLUS_MULTIPLIER-surplus (which would push it straight back
// out to the terminal instead of leaving it for the lab to draw from).
const COMPOUND_TARGET = 6000;
const BASE_MINERAL_TARGET = 3000;

// Every resource src/empire/boostTargets.ts assigns a target to, at that real target — "has all available
// compounds stocked as required" per the scenario brief. GO/LO/UH (tough/heal/attack's T1 lines) are what
// this scenario's flag actually consumes; the rest just needs to sit there without being mistaken for
// surplus/deficit.
const RAW_MINERALS: ResourceConstant[] = ["H", "O", "U", "L", "K", "Z", "G", "X"];
const REACTION_COMPOUNDS: ResourceConstant[] = [
  "OH", "ZK", "UL", "GH", "KH", "LH", "UH", "ZH", "GO", "LO", "ZO", "KO", "UO",
  "GH2O", "LH2O", "KH2O", "ZH2O", "UH2O", "GHO2", "LHO2", "KHO2", "ZHO2", "UHO2",
  "XGH2O", "XLH2O", "XKH2O", "XZH2O", "XUH2O", "XGHO2", "XLHO2", "XKHO2", "XZHO2", "XUHO2"
];

// A large energy reserve for storage so the seeded transport/steward workforce can keep the extensions
// topped up to capacity after each spawn (the RCL6 bait-tower body is sized off the full 2300 capacity —
// see seedExtraWorkforce's own doc). Well below STORAGE_SURPLUS_FRACTION * STORAGE_CAPACITY (100,000) so
// Steward doesn't start dumping this energy into the terminal instead of holding it for the colony.
const STORAGE_ENERGY_RESERVE = 50_000;

async function seedAllCompounds(colony: BootedColony): Promise<void> {
  const storage = (await colony.structures("storage"))[0];
  expect(storage, "no storage built — seedColony(level: 6) should have placed one").toBeDefined();

  const store: Partial<Record<ResourceConstant, number>> = { energy: STORAGE_ENERGY_RESERVE };
  for (const r of RAW_MINERALS) store[r] = BASE_MINERAL_TARGET;
  for (const r of REACTION_COMPOUNDS) store[r] = COMPOUND_TARGET;
  await colony.setStoreResources(storage._id as string, store);
}

let colony: BootedColony;
let bundle: string;

beforeAll(async () => {
  bundle = buildBotBundle({ LIQUIDATION_MODE_OVERRIDE: "false" });

  colony = await BootedColony.boot({ botCode: bundle, room: HOME, terrain: scoutableTerrain() });

  await colony.runTicks(TICKS_TO_ANCHOR);
  expect(await colony.anchor(), "the bot never cached a bunker anchor — nothing downstream runs").not.toBeNull();

  await colony.patchMemory(mem => {
    (mem as { debugDisableRemoteMining?: boolean }).debugDisableRemoteMining = true;
  });

  // A finished RCL6 base: structures (including 3 labs + 1 terminal), workforce and energy all from the
  // bot's own planners. energyFraction 1.0 (extensions start full) so the ~2000-cost RCL6 bait-tower body
  // is affordable from tick one instead of the colony stalling on it — see seedExtraWorkforce's own doc.
  const seeded = await seedColony(colony, { level: 6, energyFraction: 1.0 });
  expect(seeded.creeps.length, "no workforce was seeded — the colony would cold-start instead").toBeGreaterThan(0);
  expect(await colony.structures("lab"), "RCL6 should have built 3 labs").toHaveLength(3);
  expect(await colony.structures("terminal"), "RCL6 should have built a terminal").toHaveLength(1);

  // Top the naturally-thin RCL6 roster up with extra transport/steward/upgraders so the colony starts
  // genuinely steady-state rather than stalling in a spawn-starved cold start — see seedExtraWorkforce.
  await seedExtraWorkforce(colony);

  await seedAllCompounds(colony);

  // A "simpleBaitTower:<room>:1:T1" flag: 1 SimpleBaitTowerRole creep, boosted to T1 on all 3 of its
  // lines (tough/heal/attack). Placed in-room on the sponsor so targetRoomFor resolves it without needing
  // a colonize/scout step — this scenario measures boosting, not target-room discovery.
  await colony.placeFlag(`simpleBaitTower:${TARGET}:1:T1`, HOME, 25, 25);
}, 180_000);

afterAll(() => {
  colony?.stop();
});

// The 3 T1 compounds SimpleBaitTowerRole's boostable lines resolve to (tough/heal/attack respectively) —
// verified against the real BOOSTS table, not hand-recalled: empire/boostActions.ts's boostActionFor
// derives these dynamically from the engine's own constants, and this scenario's own seeded storage
// includes all of them (REACTION_COMPOUNDS above), so hardcoding the 3 names here only affects what this
// test LOOKS for, never what the bot itself computes.
const BOOST_COMPOUNDS: ResourceConstant[] = ["GO", "LO", "UH"];
const BOOSTABLE_PARTS = ["tough", "heal", "attack"];

// Matches the real engine constant (@screeps/common's LAB_BOOST_MINERAL) — a lab needs at least this much
// of a compound to boost even a single body part.
const LAB_BOOST_MINERAL_FOR_TEST = 30;

test(
  "a stable RCL6 colony fills its boost labs and spawns a fully boosted creep from a boosted flag",
  async () => {
    const ladder = new CheckpointLadder([
      // Confirms the seed took (workforce alive from tick one), not a cold recovery.
      { name: "workforce alive", by: 20 },
      // Colony.labs() discovered and persisted its 3 boost lab ids (first tier-3 pass; runs every tick).
      { name: "boost labs identified", by: 50 },
      // singleTargetFlags.ts resolved the flag, picked this colony as a BOOSTED sponsor (canHostBoosting
      // + pickBoostedSponsor cleared), and recorded the entry.
      { name: "boosted op handed off", by: 100 },
      // Colony.labs() claimed ALL 3 labs — one each for GO/LO/UH (aggregated demand from the
      // spawned/spawning creep's 3 simultaneous boost lines).
      { name: "all 3 labs claimed", by: 400 },
      // Transport hauled each compound from storage into its claimed lab (registerBoostLabWantRequest
      // winning a pass of pickBestPair) — tracked per-compound, not as one joint "all 3 at once" check:
      // gh #61 epic's Q4 precise-amount fix means a lab only ever holds exactly what its own claim still
      // needs, consumed by boostCreep() within a tick or two of arriving (only one lab acts per creep per
      // tick — see boostPreemption's own doc), so the three lines are almost never simultaneously stocked
      // at the same instant even though each one genuinely was, in its own turn.
      { name: "GO lab stocked", by: 900 },
      { name: "LO lab stocked", by: 900 },
      { name: "UH lab stocked", by: 900 },
      // The bait-tower's Memory.creeps entry exists — the spawn REQUEST was accepted and spawning has
      // STARTED (spawning: true), not finished. Gated on boost-compound availability (see
      // empire/spawning.ts's boostCompoundsReady) — this only fires once spawning has actually started,
      // which itself only happens once the compounds are already available, so a wide budget is kept
      // here deliberately rather than tightened to reflect that new ordering.
      { name: "bait-tower spawn accepted (spawning=true)", by: 900 },
      // The creep object now reports spawning: false — it has physically left the spawn and is a real,
      // mobile creep whose ticksToLive is now counting down. The gap between this and the PREVIOUS
      // checkpoint is real spawn time (body-length-dependent, ~90 ticks for this body); the gap between
      // THIS and "fully boosted" below is pure waste against the creep's own lifetime — the quantity the
      // whole boosting pipeline is trying to minimize (equivalently, maximize the ticksToLive remaining
      // once boosting completes).
      { name: "bait-tower finished spawning (spawning=false)", by: 1100 },
      // boostPreemption found every stocked lab and called boostCreep() successfully on each line — the
      // creep's body now carries a boosted part for TOUGH, HEAL, and ATTACK (all three, not just one).
      { name: "bait-tower fully boosted", by: 1500 }
    ]);

    const boostLabIds = async (): Promise<string[] | undefined> => {
      const mem = (await colony.memory()) as {
        colonies?: Record<string, { boostLabIds?: string[] }>;
      };
      return mem.colonies?.[HOME]?.boostLabIds;
    };

    const boostedOpHandedOff = async (): Promise<boolean> => {
      const mem = (await colony.memory()) as {
        colonies?: Record<string, { singleTargetOps?: Record<string, Record<string, { wanted?: number }>> }>;
      };
      const entry = mem.colonies?.[HOME]?.singleTargetOps?.simpleBaitTower?.[TARGET];
      return (entry?.wanted ?? 0) > 0;
    };

    const boostClaims = async (): Promise<Record<string, { compound?: string; amount?: number }>> => {
      const mem = (await colony.memory()) as {
        colonies?: Record<string, { boostClaims?: Record<string, { compound?: string; amount?: number }> }>;
      };
      return mem.colonies?.[HOME]?.boostClaims ?? {};
    };

    const allLabsClaimed = async (): Promise<boolean> => {
      const claims = Object.values(await boostClaims());
      return BOOST_COMPOUNDS.every(c => claims.some(claim => claim?.compound === c && (claim?.amount ?? 0) > 0));
    };

    const labs = async (): Promise<Array<{ _id: string; store?: Record<string, number> }>> =>
      (await colony.structures("lab")) as unknown as Array<{ _id: string; store?: Record<string, number> }>;

    const compoundStocked = async (compound: ResourceConstant): Promise<boolean> => {
      const ls = await labs();
      return ls.some(l => (l.store?.[compound] ?? 0) >= LAB_BOOST_MINERAL_FOR_TEST);
    };

    const baitTowerAlive = async (): Promise<boolean> => colony.hasRole("simpleBaitTower");

    // The live room object for the bait-tower creep, once one exists — shared by both the
    // spawning-state check and the fully-boosted check below, so both read the exact same object each
    // tick rather than two independently-timed roomObjects() calls.
    // The raw mockup DB stores a creep's death tick as `ageTime` (absolute), not a live `ticksToLive`
    // countdown — that field only exists on the engine's own Game-object wrapper (ageTime - Game.time),
    // which roomObjects()'s direct DB read bypasses entirely (see seed.ts's own `ageTime: gameTime + ttl`
    // for the same raw shape). Computed here from the current gameTime so ticksToLive means the same thing
    // this test's own doc says it does.
    const baitTowerObj = async (): Promise<{ spawning?: unknown; ticksToLive?: number; body?: Array<{ type: string; boost?: string }> } | undefined> => {
      const objs = (await colony.roomObjects()) as Array<{
        type: string;
        user?: string;
        spawning?: unknown;
        ageTime?: number;
        body?: Array<{ type: string; boost?: string }>;
      }>;
      const creep = objs.find(
        o => o.type === "creep" && o.user === colony.bot.id && (o.body ?? []).some(p => BOOSTABLE_PARTS.includes(p.type))
      );
      if (!creep) return undefined;
      const gameTime = await colony.server.world.gameTime;
      return { ...creep, ticksToLive: creep.ageTime !== undefined ? creep.ageTime - gameTime : undefined };
    };

    const baitTowerFinishedSpawning = async (): Promise<boolean> => {
      const obj = await baitTowerObj();
      return !!obj && !obj.spawning;
    };

    const baitTowerFullyBoosted = async (): Promise<boolean> => {
      const creep = await baitTowerObj();
      if (!creep?.body) return false;
      const relevant = creep.body.filter(p => BOOSTABLE_PARTS.includes(p.type));
      // Fully boosted, not just "one part on one line": every TOUGH/HEAL/ATTACK part must carry a boost.
      return relevant.length > 0 && relevant.every(p => !!p.boost);
    };

    let ticksToLiveAtFullyBoosted: number | undefined;
    // gh #61 epic Q4: precise-amount delivery means a lab should hold ~0 of its compound once the last
    // boostCreep() call on that line consumes it — not the 3x-over-need surplus the pre-Q4 pipeline left
    // stranded (confirmed live: 1150 units left in a lab for a 390-unit order). Captured the instant
    // "fully boosted" first goes true — a tick later the LabRunner's own reconciliation could already have
    // reset the claim/lab for something else, so this is the one honest moment to check.
    let labCompoundsAtFullyBoosted: Record<ResourceConstant, number> | undefined;

    const reached = await colony.runUntil(
      baitTowerFullyBoosted,
      1500,
      async tick => {
        await ladder.sample(tick, async name => {
          switch (name) {
            case "workforce alive":
              return (await colony.creepCount()) > 0;
            case "boost labs identified":
              return (await boostLabIds())?.length === 3;
            case "boosted op handed off":
              return boostedOpHandedOff();
            case "all 3 labs claimed":
              return allLabsClaimed();
            case "GO lab stocked":
              return compoundStocked("GO");
            case "LO lab stocked":
              return compoundStocked("LO");
            case "UH lab stocked":
              return compoundStocked("UH");
            case "bait-tower spawn accepted (spawning=true)":
              return baitTowerAlive();
            case "bait-tower finished spawning (spawning=false)":
              return baitTowerFinishedSpawning();
            case "bait-tower fully boosted": {
              const done = await baitTowerFullyBoosted();
              if (done && ticksToLiveAtFullyBoosted === undefined) {
                ticksToLiveAtFullyBoosted = (await baitTowerObj())?.ticksToLive;
                const ls = await labs();
                labCompoundsAtFullyBoosted = Object.fromEntries(
                  BOOST_COMPOUNDS.map(c => [c, Math.max(0, ...ls.map(l => l.store?.[c] ?? 0))])
                ) as Record<ResourceConstant, number>;
              }
              return done;
            }
            default:
              return false;
          }
        });
      }
    );

    // ticksToLive at the moment boosting completes is the metric this whole pipeline exists to maximize
    // (equivalently: minimize the gap between "finished spawning" and "fully boosted" above) — surfaced
    // in the failure message so a regression shows the actual cost, not just a missed tick budget.
    expect(
      reached,
      `bait-tower was never fully boosted within 1500 ticks (ticksToLive at fully-boosted: ${ticksToLiveAtFullyBoosted}):\n${ladder.report()}`
    ).not.toBeNull();
    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();

    // Neither "labs claimed" nor "labs stocked" is re-checked here: once the creep is fully boosted,
    // aggregated demand for every compound drops to 0, the claim gets reconciled away on the LabRunner's
    // very next interval:5 pass, and each compound has typically already been consumed down to 0 by
    // boostCreep() itself — a live race between "did this happen at some point" (it did; see the ladder's
    // own per-compound checkpoints above, sampled tick-by-tick as it occurred) and "is it still true this
    // instant," which is not what either of those checkpoints was ever meant to assert.
    expect(await baitTowerAlive(), "no bait-tower was ever spawned").toBe(true);

    // gh #61 epic Q4: every lab should be left empty of its compound once boosting is fully done —
    // precise-amount delivery (transportRegister.ts's registerBoostCompoundSourceRequests capped to the
    // real shortfall + logistics/task.ts's Task.amount capping the actual withdraw) means nothing is ever
    // over-delivered in the first place, so there's no surplus left to strand.
    expect(
      labCompoundsAtFullyBoosted,
      "never captured lab compound levels at the fully-boosted moment"
    ).toBeDefined();
    for (const c of BOOST_COMPOUNDS) {
      expect(labCompoundsAtFullyBoosted?.[c], `${c} was left stranded in a lab after boosting completed`).toBe(0);
    }
  },
  300_000
);
