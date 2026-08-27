// Boosting, end to end, cross-colony: two RCL6 colonies under the SAME empire (one bot, two owned rooms —
// see harness.ts's addOwnedRoom/forRoom, since screeps-server-mockup's addBot always creates a brand-new
// user and can't add a second room to an existing one). Colony 1 (W0N1) starts with a surplus of every
// boost-line compound; colony 2 (W1N1) starts with energy only, no compounds at all. A
// "simpleBaitTower:<room>:1:T1" flag sponsored by colony 2 should, under the empire's own behavior: have
// colony 2's LabRunner claim all 3 of its boost labs (one each for GO/LO/UH — tough/heal/attack's T1
// lines, verified against the real BOOSTS table), have empire/logistics.ts's runEmpireLogisticsPass see
// colony 1 as a surplus donor and colony 2 as a deficit receiver for EACH of those 3 compounds and
// terminal-send them across, have colony 2's Transport haul each received compound from its terminal into
// its claimed lab, and finally have the spawned bait-tower creep self-discover the stocked labs and get
// FULLY boosted (every TOUGH/HEAL/ATTACK part, not just one line) — all without any test-side shortcut for
// the transfer itself (only the STARTING stock imbalance is seeded). gh #61 epic follow-up: 3 simultaneous
// cross-colony compound transfers exercises the empire matcher's own per-resource independence far more
// than Demolisher's single ZH line ever could.
//
// See boosting-single-colony.test.ts's header for why this needs its own private LIQUIDATION_MODE_OVERRIDE
// build (bundleBot()'s shared default bundle has liquidation forced on) and why remote mining is disabled.
// This test additionally needs LIQUIDATION_MODE off for a second reason beyond the single-colony test's:
// with it on, computeEmpireRequests's targets all collapse to 0, so colony 1's stock never reads as
// "surplus above target" in the first place — colony-to-colony redistribution would be a structural no-op
// (see runEmpireLogisticsPass's own doc), which is exactly the mechanism this test exists to exercise.

import { afterAll, beforeAll, expect, test } from "vitest";
import { roleDef } from "../../src/behaviors/roles";
import { orderBody } from "../../src/spawn/body";
import { opName } from "../../src/spawn/request";
import { BootedColony, bunkerTerrain, buildBotBundle, CheckpointLadder, predictAnchor, layoutSpawnPos } from "./harness";
import { seedColony, seedCreeps, spreadTtl, type SeededCreep } from "./seed";

const DONOR = "W0N1"; // colony 1: surplus compounds, no boost demand of its own
const RECEIVER = "W1N1"; // colony 2: energy only, hosts the boosted flag
// The flag targets the RECEIVER's own room — routeDistance/findRoute short-circuits a==b to 0, so no real
// cross-room route needs to exist for pickSponsor's reachability check to clear (see
// boosting-single-colony.test.ts's header for why an arbitrary third room failed this check with
// bunkerTerrain()'s fully-sealed borders, and why a real route matters here at all).
const TARGET = RECEIVER;

const TICKS_TO_ANCHOR = 5;

const COMPOUND_TARGET = 6000;
const BASE_MINERAL_TARGET = 3000;
// Comfortably above RESOURCE_STORAGE_SURPLUS_MULTIPLIER (1.0) x target, so colony 1's stock reads as real
// surplus to computeEmpireRequests/registerMineralStorageSurplusRequest, not merely "at target".
const SURPLUS_MULTIPLE = 3;

const RAW_MINERALS: ResourceConstant[] = ["H", "O", "U", "L", "K", "Z", "G", "X"];
const REACTION_COMPOUNDS: ResourceConstant[] = [
  "OH", "ZK", "UL", "GH", "KH", "LH", "UH", "ZH", "GO", "LO", "ZO", "KO", "UO",
  "GH2O", "LH2O", "KH2O", "ZH2O", "UH2O", "GHO2", "LHO2", "KHO2", "ZHO2", "UHO2",
  "XGH2O", "XLH2O", "XKH2O", "XZH2O", "XUH2O", "XGHO2", "XLHO2", "XKHO2", "XZHO2", "XUHO2"
];

// Same RCL6 cold-start workforce gap boosting-single-colony.test.ts documents and fixes: seedColony's own
// plannedWorkforce seeds only miners+supply, no transport/steward/upgrader, so nothing moves energy from
// storage into extensions and no Steward/Transport ever appears organically in a reasonable tick budget —
// the colony stalls on the bait-tower's own ~2000-energy spawn request forever. Applies to BOTH colonies
// here (donor needs to actually reach steady state to run its own economy; receiver needs it to ever
// spawn+boost the bait-tower at all).
const EXTRA_TRANSPORT = 4;
const EXTRA_UPGRADERS = 2;
const EXTRA_STEWARDS = 1;

async function seedExtraWorkforce(colony: BootedColony, home: string): Promise<void> {
  const energyCapacity = await colony.energyCapacity();
  const ctx = { hasContainer: false, hasLink: false };
  const transportBody = orderBody(roleDef("transport")!.body(energyCapacity, ctx));
  const upgraderBody = orderBody(roleDef("upgrader")!.body(energyCapacity, ctx));
  const stewardBody = orderBody(roleDef("steward")!.body(energyCapacity, ctx));

  const extras: SeededCreep[] = [
    ...Array.from({ length: EXTRA_TRANSPORT }, (_, i) => ({
      name: `seed_extra_transport_${home}_${i}`,
      role: "transport" as const,
      memory: { role: "transport" as const, home, op: opName("logistics", home) },
      body: transportBody,
      ttl: spreadTtl(i, EXTRA_TRANSPORT)
    })),
    ...Array.from({ length: EXTRA_UPGRADERS }, (_, i) => ({
      name: `seed_extra_upgrader_${home}_${i}`,
      role: "upgrader" as const,
      memory: { role: "upgrader" as const, home, op: opName("upgrading", home) },
      body: upgraderBody,
      ttl: spreadTtl(i, EXTRA_UPGRADERS)
    })),
    ...Array.from({ length: EXTRA_STEWARDS }, (_, i) => ({
      name: `seed_extra_steward_${home}_${i}`,
      role: "steward" as const,
      memory: { role: "steward" as const, home, op: opName("logistics", home) },
      body: stewardBody,
      ttl: spreadTtl(i, EXTRA_STEWARDS)
    }))
  ];

  await seedCreeps(colony, extras);
}

async function seedSurplusCompounds(colony: BootedColony): Promise<void> {
  const storage = (await colony.structures("storage"))[0];
  expect(storage, "donor has no storage — seedColony(level: 6) should have placed one").toBeDefined();

  const store: Partial<Record<ResourceConstant, number>> = { energy: 50_000 };
  for (const r of RAW_MINERALS) store[r] = BASE_MINERAL_TARGET * SURPLUS_MULTIPLE;
  for (const r of REACTION_COMPOUNDS) store[r] = COMPOUND_TARGET * SURPLUS_MULTIPLE;
  await colony.setStoreResources(storage._id as string, store);

  // Terminal energy seeded directly (not left for Steward to fund organically from storage): a terminal
  // send (StructureTerminal.send, Game.market.calcTransactionCost) costs the SENDING terminal energy
  // proportional to distance, and confirmed live via integration testing, an artificially-seeded colony
  // with ~35 simultaneously-overflowing boost-line resources all competing for Steward's single anchor
  // creep starves the terminal's own (comparatively modest, TERMINAL_ENERGY_TARGET=50,000) energy want
  // indefinitely — a pre-existing Steward pool-scaling limit unrelated to what this test exists to verify
  // (the cross-colony empire transfer mechanism itself), so it's sidestepped by seeding a realistic
  // mid-game terminal energy level directly, the same "seed the state you're not testing" principle
  // rcl3.test.ts/remote-mining.test.ts already use for workforce/energy.
  const terminal = (await colony.structures("terminal"))[0];
  expect(terminal, "donor has no terminal — seedColony(level: 6) should have placed one").toBeDefined();
  await colony.setStoreResources(terminal._id as string, { energy: 50_000 });
}

let donor: BootedColony;
let receiver: BootedColony;

beforeAll(async () => {
  const bundle = buildBotBundle({ LIQUIDATION_MODE_OVERRIDE: "false" });

  // gcl: 1_000_000 raw XP => level 2 (see BootOptions.gcl's doc) — owning a second room needs it, same
  // as colonize.test.ts.
  donor = await BootedColony.boot({ botCode: bundle, room: DONOR, terrain: bunkerTerrain(), gcl: 1_000_000 });

  // Second owned room, same bot: lay its terrain BEFORE predicting/placing its spawn (same ordering
  // boot() itself follows for the first room), then claim it via addOwnedRoom.
  await donor.server.world.setTerrain(RECEIVER, bunkerTerrain());
  const anchor = await predictAnchor(donor.server, RECEIVER);
  const spawnPos = anchor ? layoutSpawnPos(anchor) : null;
  expect(spawnPos, `${RECEIVER} admits no bunker anchor — bunkerTerrain() should guarantee one`).not.toBeNull();
  receiver = await donor.addOwnedRoom(RECEIVER, spawnPos!.x, spawnPos!.y);

  await donor.runTicks(TICKS_TO_ANCHOR);
  expect(await donor.anchor(), `${DONOR} never cached a bunker anchor`).not.toBeNull();
  expect(await receiver.anchor(), `${RECEIVER} never cached a bunker anchor`).not.toBeNull();

  await donor.patchMemory(mem => {
    (mem as { debugDisableRemoteMining?: boolean }).debugDisableRemoteMining = true;
  });

  // Both colonies to a finished RCL6 base (3 labs, 1 terminal, 1 storage each) via the bot's own planners.
  // energyFraction 1.0 (not the default 0.7): see EXTRA_TRANSPORT's own doc — extensions start full so the
  // seeded extra transport/steward/upgrader roster has energy on hand to keep them topped up immediately.
  const seededDonor = await seedColony(donor, { level: 6, energyFraction: 1.0 });
  const seededReceiver = await seedColony(receiver, { level: 6, energyFraction: 1.0 });
  expect(seededDonor.creeps.length, `${DONOR} seeded no workforce`).toBeGreaterThan(0);
  expect(seededReceiver.creeps.length, `${RECEIVER} seeded no workforce`).toBeGreaterThan(0);
  expect(await donor.structures("terminal"), `${DONOR} has no terminal`).toHaveLength(1);
  expect(await receiver.structures("terminal"), `${RECEIVER} has no terminal`).toHaveLength(1);

  await seedExtraWorkforce(donor, DONOR);
  await seedExtraWorkforce(receiver, RECEIVER);

  // Colony 1: surplus of every boost-line compound. Colony 2: deliberately left with energy only — its
  // seedColony call above already gave it storage with 0 of everything else.
  await seedSurplusCompounds(donor);
  const receiverStorage = (await receiver.structures("storage"))[0];
  await receiver.setStoreResources(receiverStorage._id as string, { energy: 50000 });

  // The boosted flag is sponsored by colony 2 specifically: placed IN colony 2's own room so
  // targetRoomFor/pickBoostedSponsor's affordability+reachability pick it over the donor without needing
  // real cross-room routing logic as part of what this test measures. canHostBoosting requires RCL6+3
  // labs+terminal, which BOTH colonies satisfy — colony 2 wins because it's nearest to its own room.
  await receiver.placeFlag(`simpleBaitTower:${TARGET}:1:T1`, RECEIVER, 25, 25);
}, 180_000);

afterAll(() => {
  // Only the ORIGINAL BootedColony (donor, from boot()) owns the server/temp dir — receiver is a
  // forRoom() view over the same server (see addOwnedRoom's doc) and must never be stopped separately.
  donor?.stop();
});

// The 3 T1 compounds SimpleBaitTowerRole's boostable lines resolve to (tough/heal/attack respectively) —
// see boosting-single-colony.test.ts's own doc for why these are hardcoded here as an assertion target
// only, never as something the bot itself is told.
const BOOST_COMPOUNDS: ResourceConstant[] = ["GO", "LO", "UH"];
const BOOSTABLE_PARTS = ["tough", "heal", "attack"];

// Matches the real engine constant (@screeps/common's LAB_BOOST_MINERAL).
const LAB_BOOST_MINERAL_FOR_TEST = 30;

test(
  "a compound-poor colony gets fully boosted via empire logistics pulling 3 surplus compounds from its sibling colony",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "both colonies alive", by: 20 },
      { name: "receiver identified boost labs", by: 50 },
      { name: "boosted op handed off to receiver", by: 100 },
      // empire/logistics.ts's runEmpireLogisticsPass matched donor's surplus to receiver's deficit and
      // issued a terminalSend intent, per compound — observed here via the RECEIVING side's terminal
      // stock actually rising (the transfer completing, not merely being requested — sends are
      // asynchronous in the real engine, see EMPIRE_LOGISTICS_INTERVAL/calcTransactionCost). Tracked per
      // compound, not jointly: 3 independent empire matches don't necessarily land the same tick. This is
      // "some amount arrived," not "enough arrived" — see boostCompoundsReady's own doc for the gate that
      // actually cares about the full amount.
      { name: "GO arrived in receiver's terminal", by: 2200 },
      { name: "LO arrived in receiver's terminal", by: 2200 },
      { name: "UH arrived in receiver's terminal", by: 2200 },
      // gh #61 epic follow-up (empire/spawning.ts's boostCompoundsReady): the spawn ARBITER now withholds
      // the bait-tower's spawn request until the receiver's own storage+terminal already hold the FULL
      // amount every compound needs — not merely "some" (the checkpoints above). This changed the causal
      // order from the old flow (spawn immediately, claim immediately, wait on the lab afterward): a
      // colony/labClaims.ts contender can only ever be a LIVE creep (spawning or alive — see
      // Colony.labs()'s own ticksUntilReady derivation), so claiming now can't happen until spawning has
      // already started, which itself now waits on full compound availability. "Claimed" therefore lands
      // at essentially the SAME time as "spawned" below, not hundreds of ticks before it the way it used
      // to — confirmed live, this is the intended effect of the gate, not a regression.
      // Budget loosened generously, same reasoning the original single-compound version of this test
      // already documented for its own "arrived in terminal" leg: 3 independent compounds now all have
      // to individually clear the FULL-amount gate (not just "some arrived"), each on its own
      // EMPIRE_LOGISTICS_INTERVAL-throttled cadence with real send-cost/cooldown variance — measured live
      // across repeated runs at ok@1296, ok@1301, and one LATE@1865, real run-to-run timing variance in
      // the mockup server rather than a tight bound re-derived from a single sample.
      // The bait-tower's Memory.creeps entry exists — the spawn REQUEST was accepted and spawning has
      // STARTED (spawning: true), not finished.
      { name: "bait-tower spawn accepted (spawning=true) in receiver", by: 2600 },
      { name: "receiver claimed all 3 labs", by: 2650 },
      // The creep object now reports spawning: false — it has physically left the spawn, a real mobile
      // creep whose ticksToLive is now counting down. Real spawn time (body-length-dependent, ~90 ticks
      // for this body) sits between this and the PREVIOUS checkpoint; the gap between THIS and "fully
      // boosted" is pure waste against the creep's own lifetime — see boosting-single-colony.test.ts's
      // own doc for the full framing (minimize this gap == maximize ticksToLive once boosting completes).
      { name: "bait-tower finished spawning (spawning=false) in receiver", by: 2700 },
      // Tracked per compound, not jointly (see boosting-single-colony.test.ts's own doc): gh #61 epic's
      // Q4 precise-amount fix means a lab only ever holds exactly its own remaining shortfall, consumed
      // by boostCreep() within a tick or two of arriving, so the three lines are rarely simultaneously
      // stocked at once even though each genuinely was, in its own turn. Should now follow spawning
      // almost immediately too: the compound is already sitting in storage/terminal by the time
      // boostCompoundsReady allowed the spawn at all, so only the local haul to the lab remains.
      { name: "GO lab stocked", by: 3000 },
      { name: "LO lab stocked", by: 3000 },
      { name: "UH lab stocked", by: 3000 },
      // boostPreemption found every stocked lab and called boostCreep() successfully on each line — the
      // creep's body now carries a boosted part for TOUGH, HEAL, and ATTACK (all three, not just one).
      { name: "bait-tower fully boosted", by: 3400 }
    ]);

    const boostLabIds = async (col: BootedColony, room: string): Promise<string[] | undefined> => {
      const mem = (await col.memory()) as { colonies?: Record<string, { boostLabIds?: string[] }> };
      return mem.colonies?.[room]?.boostLabIds;
    };

    const boostedOpHandedOff = async (): Promise<boolean> => {
      const mem = (await receiver.memory()) as {
        colonies?: Record<string, { singleTargetOps?: Record<string, Record<string, { wanted?: number }>> }>;
      };
      const entry = mem.colonies?.[RECEIVER]?.singleTargetOps?.simpleBaitTower?.[TARGET];
      return (entry?.wanted ?? 0) > 0;
    };

    const allLabsClaimed = async (col: BootedColony, room: string): Promise<boolean> => {
      const mem = (await col.memory()) as {
        colonies?: Record<string, { boostClaims?: Record<string, { compound?: string; amount?: number }> }>;
      };
      const claims = Object.values(mem.colonies?.[room]?.boostClaims ?? {});
      return BOOST_COMPOUNDS.every(c => claims.some(claim => claim?.compound === c && (claim?.amount ?? 0) > 0));
    };

    const terminalStock = async (col: BootedColony, resource: ResourceConstant): Promise<number> => {
      const terminals = (await col.structures("terminal")) as Array<{ store?: Record<string, number> }>;
      return terminals[0]?.store?.[resource] ?? 0;
    };

    const labs = async (col: BootedColony): Promise<Array<{ store?: Record<string, number> }>> =>
      (await col.structures("lab")) as Array<{ store?: Record<string, number> }>;

    const compoundStocked = async (col: BootedColony, resource: ResourceConstant): Promise<boolean> =>
      (await labs(col)).some(l => (l.store?.[resource] ?? 0) >= LAB_BOOST_MINERAL_FOR_TEST);

    const baitTowerAlive = async (): Promise<boolean> => receiver.hasRole("simpleBaitTower");

    // The live room object for the bait-tower creep, once one exists — shared by the spawning-state check
    // and the fully-boosted check below, so both read the exact same object each tick.
    // See boosting-single-colony.test.ts's own doc: the raw mockup DB stores `ageTime` (absolute), not a
    // live `ticksToLive` countdown — computed here from the current gameTime instead.
    const baitTowerObj = async (): Promise<{ spawning?: unknown; ticksToLive?: number; body?: Array<{ type: string; boost?: string }> } | undefined> => {
      const objs = (await receiver.roomObjects()) as Array<{
        type: string;
        user?: string;
        spawning?: unknown;
        ageTime?: number;
        body?: Array<{ type: string; boost?: string }>;
      }>;
      const creep = objs.find(
        o => o.type === "creep" && o.user === receiver.bot.id && (o.body ?? []).some(p => BOOSTABLE_PARTS.includes(p.type))
      );
      if (!creep) return undefined;
      const gameTime = await receiver.server.world.gameTime;
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
      return relevant.length > 0 && relevant.every(p => !!p.boost);
    };

    const receiverTerminalBaseline: Partial<Record<ResourceConstant, number>> = {};
    let ticksToLiveAtFullyBoosted: number | undefined;
    // gh #61 epic Q4: a lab should hold ~0 of its compound once fully boosted — see
    // boosting-single-colony.test.ts's own doc for the full reasoning and why this is captured at the
    // exact instant "fully boosted" first goes true.
    let labCompoundsAtFullyBoosted: Record<ResourceConstant, number> | undefined;

    const reached = await donor.runUntil(
      baitTowerFullyBoosted,
      3600,
      async tick => {
        if (tick === 1) {
          for (const c of BOOST_COMPOUNDS) receiverTerminalBaseline[c] = await terminalStock(receiver, c);
        }
        await ladder.sample(tick, async name => {
          switch (name) {
            case "both colonies alive":
              return (await donor.creepCount()) > 0 && (await receiver.creepCount()) > 0;
            case "receiver identified boost labs":
              return (await boostLabIds(receiver, RECEIVER))?.length === 3;
            case "boosted op handed off to receiver":
              return boostedOpHandedOff();
            case "receiver claimed all 3 labs":
              return allLabsClaimed(receiver, RECEIVER);
            case "GO arrived in receiver's terminal":
              return (await terminalStock(receiver, "GO")) > (receiverTerminalBaseline.GO ?? 0);
            case "LO arrived in receiver's terminal":
              return (await terminalStock(receiver, "LO")) > (receiverTerminalBaseline.LO ?? 0);
            case "UH arrived in receiver's terminal":
              return (await terminalStock(receiver, "UH")) > (receiverTerminalBaseline.UH ?? 0);
            case "GO lab stocked":
              return compoundStocked(receiver, "GO");
            case "LO lab stocked":
              return compoundStocked(receiver, "LO");
            case "UH lab stocked":
              return compoundStocked(receiver, "UH");
            case "bait-tower spawn accepted (spawning=true) in receiver":
              return baitTowerAlive();
            case "bait-tower finished spawning (spawning=false) in receiver":
              return baitTowerFinishedSpawning();
            case "bait-tower fully boosted": {
              const done = await baitTowerFullyBoosted();
              if (done && ticksToLiveAtFullyBoosted === undefined) {
                ticksToLiveAtFullyBoosted = (await baitTowerObj())?.ticksToLive;
                const ls = await labs(receiver);
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
      `bait-tower was never fully boosted within 3600 ticks (ticksToLive at fully-boosted: ${ticksToLiveAtFullyBoosted}):\n${ladder.report()}`
    ).not.toBeNull();
    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();

    expect(await baitTowerAlive(), "no bait-tower was ever spawned in the receiver").toBe(true);
    // Neither "labs claimed" nor "labs stocked" is re-checked here — see boosting-single-colony.test.ts's
    // own doc for why both are transient once the creep is fully boosted (claim reconciled away, compound
    // consumed by boostCreep()), a race the ladder's own tick-by-tick sampling above isn't subject to.

    // gh #61 epic Q4: every lab should be left empty of its compound once boosting is fully done — see
    // boosting-single-colony.test.ts's own doc for the full reasoning.
    expect(labCompoundsAtFullyBoosted, "never captured lab compound levels at the fully-boosted moment").toBeDefined();
    for (const c of BOOST_COMPOUNDS) {
      expect(labCompoundsAtFullyBoosted?.[c], `${c} was left stranded in a lab after boosting completed`).toBe(0);
    }
  },
  480_000
);
