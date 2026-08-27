import { describe, expect, it, vi } from "vitest";
import { runSingleTargetFlags, tierRequestFor } from "../../../src/empire/singleTargetFlags";
import { SimpleBaitTowerOperation, SIMPLE_BAIT_TOWER_ROLE } from "../../../src/operations/simpleBaitTower";
import { SIMPLE_BAIT_TOWER_MIN_COST } from "../../../src/behaviors/roles/simpleBaitTower";
import { testEmpire, colonySnap } from "../../fixtures";
import { stubGame } from "../../helpers";
import { log } from "../../../src/lib/log";

describe("tierRequestFor", () => {
  it("parses a forced T3 tier from the optional 4th segment", () => {
    const flag = { name: "simpleBaitTower:W1N1:3:T3" } as Flag;
    expect(tierRequestFor(flag)).toEqual({ kind: "forced", tier: 3 });
  });

  it("parses a forced T2 tier from the optional 4th segment", () => {
    const flag = { name: "simpleBaitTower:W1N1:3:T2" } as Flag;
    expect(tierRequestFor(flag)).toEqual({ kind: "forced", tier: 2 });
  });

  it("parses a bare T as greedy", () => {
    const flag = { name: "simpleBaitTower:W1N1:3:T" } as Flag;
    expect(tierRequestFor(flag)).toEqual({ kind: "greedy" });
  });

  it("parses an omitted 4th segment as greedy", () => {
    const flag = { name: "simpleBaitTower:W1N1:3" } as Flag;
    expect(tierRequestFor(flag)).toEqual({ kind: "greedy" });
  });

  it("surfaces an invalid tier segment as-is", () => {
    const flag = { name: "simpleBaitTower:W1N1:3:T9" } as Flag;
    const result = tierRequestFor(flag);
    expect(result.kind).toBe("invalid");
  });

  it("handles a flag name with no count or tier segments at all", () => {
    const flag = { name: "simpleBaitTower:W1N1" } as Flag;
    expect(tierRequestFor(flag)).toEqual({ kind: "greedy" });
  });
});

// runSingleTargetFlags' boost-tier threading (Task E, gh #61 epic): a "<kind>:<room>:<n>:<tier>" flag must
// actually reach pickBoostedSponsor (gated first through canHostBoosting) instead of the plain
// pickSponsorFor path, and the resolved tier must land on the created SingleTargetOpState. Uses
// SimpleBaitTowerOperation as the concrete OpClass under test (boostable: ["tough", "heal", "attack"], real
// BOOSTS-table compounds stubbed in test/constants.ts) so resolveCompoundViaBoostActions' real wiring is
// exercised, not a fake resolve table.
function flag(name: string) {
  return { name, pos: { roomName: "W5N5" }, remove: vi.fn() };
}

function setUpFlags(names: string[]): void {
  stubGame();
  // lifetimeOf (empire/flagRequest.ts) reads flag.color against COLOR_WHITE/COLOR_RED — real Screeps
  // globals normally supplied by the engine, not stubbed in test/constants.ts since no other unit test
  // exercises runSingleTargetFlags today. Our fixture flags never set `color`, so any distinct values work.
  (globalThis as Record<string, unknown>).COLOR_WHITE = 1;
  (globalThis as Record<string, unknown>).COLOR_RED = 7;
  const game = (globalThis as { Game: { flags: Record<string, unknown>; rooms: Record<string, unknown>; map: unknown } }).Game;
  game.flags = Object.fromEntries(names.map((n, i) => [`f${i}`, flag(n)]));
  game.rooms.W5N5 = {}; // target room vision, irrelevant to sponsor pick itself
  game.map = { findRoute: (_from: string, dest: string) => [{ room: dest }] };
  (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies = {};
}

/** A colony that clears canHostBoosting's own bar (RCL6+, terminal, 3+ labs) and can afford the op. */
function boostEligibleColony(labCount = 3) {
  const game = (globalThis as { Game: { rooms: Record<string, unknown> } }).Game;
  game.rooms.W1N1 = {
    find: (_type: unknown, opts?: { filter: (s: { structureType: string }) => boolean }) => {
      const labs = Array.from({ length: labCount }, () => ({ structureType: "lab" }));
      return opts?.filter ? labs.filter(opts.filter) : labs;
    }
  };
  return colonySnap({
    name: "W1N1",
    energyCapacity: SIMPLE_BAIT_TOWER_MIN_COST,
    controllerLevel: 6,
    terminalId: "term1" as Id<StructureTerminal>
  });
}

function opStateOf(room: string, target: string) {
  return (Memory as unknown as { colonies: Record<string, { singleTargetOps?: Record<string, Record<string, { wanted: number; boostTier?: number }>>}> })
    .colonies[room]?.singleTargetOps?.[SimpleBaitTowerOperation.kind]?.[target];
}

describe("runSingleTargetFlags boosting", () => {
  it("a flag with no tier suffix takes the plain un-boosted path unchanged", () => {
    setUpFlags(["simpleBaitTower:W5N5:1"]);
    const world = testEmpire(boostEligibleColony());

    runSingleTargetFlags(world, SimpleBaitTowerOperation);

    const entry = opStateOf("W1N1", "W5N5");
    expect(entry?.wanted).toBe(1);
    expect(entry?.boostTier).toBeUndefined();
  });

  it("an invalid tier suffix logs an error and creates no operation", () => {
    setUpFlags(["simpleBaitTower:W5N5:1:T9"]);
    const world = testEmpire(boostEligibleColony());
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);

    runSingleTargetFlags(world, SimpleBaitTowerOperation);

    expect(errorSpy).toHaveBeenCalled();
    expect(opStateOf("W1N1", "W5N5")).toBeUndefined();
  });

  it("a forced tier with no colony passing canHostBoosting logs an error and creates no operation", () => {
    setUpFlags(["simpleBaitTower:W5N5:1:T3"]);
    // Below RCL6 — fails canHostBoosting outright, never even reaches pickBoostedSponsor's own checks.
    const world = testEmpire(
      colonySnap({ name: "W1N1", energyCapacity: SIMPLE_BAIT_TOWER_MIN_COST, controllerLevel: 5 })
    );
    const game = (globalThis as { Game: { rooms: Record<string, unknown> } }).Game;
    game.rooms.W1N1 = { find: () => [] };
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);

    runSingleTargetFlags(world, SimpleBaitTowerOperation);

    expect(errorSpy).toHaveBeenCalled();
    expect(opStateOf("W1N1", "W5N5")).toBeUndefined();
  });

  it("a forced tier where the colony qualifies but the tier is empire-wide unavailable logs boostTierUnavailable and creates no operation", () => {
    setUpFlags(["simpleBaitTower:W5N5:1:T3"]);
    const world = testEmpire(boostEligibleColony());
    // No terminal/storage stock seeded at all -> every compound reads 0 stock -> T3 can never clear.
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);

    runSingleTargetFlags(world, SimpleBaitTowerOperation);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("boostTierUnavailable"));
    expect(opStateOf("W1N1", "W5N5")).toBeUndefined();
  });

  it("a forced tier where everything checks out creates the operation with that exact tier stamped", () => {
    setUpFlags(["simpleBaitTower:W5N5:1:T3"]);
    const world = testEmpire(boostEligibleColony());
    const game = (globalThis as { Game: { rooms: Record<string, unknown> } }).Game;
    // Real BOOSTS-resolved T3 compounds for tough/heal/attack: XGHO2, XLHO2, XUH2O — plenty of each.
    const bigStock = { getUsedCapacity: () => 100_000 };
    game.rooms.W1N1 = {
      ...(game.rooms.W1N1 as object),
      terminal: { store: bigStock },
      storage: { store: bigStock }
    };

    runSingleTargetFlags(world, SimpleBaitTowerOperation);

    const entry = opStateOf("W1N1", "W5N5");
    expect(entry?.wanted).toBe(1);
    expect(entry?.boostTier).toBe(3);
  });

  it("a bare greedy tier where everything checks out resolves to whichever tier the empire can actually supply", () => {
    setUpFlags(["simpleBaitTower:W5N5:1:T"]);
    const world = testEmpire(boostEligibleColony());
    const game = (globalThis as { Game: { rooms: Record<string, unknown> } }).Game;
    // Only T1 compounds (GO/LO/UH) are stocked — T3/T2 must fail, greedy must land on exactly T1.
    const t1Only = { getUsedCapacity: (r: ResourceConstant) => (["GO", "LO", "UH"].includes(r) ? 100_000 : 0) };
    game.rooms.W1N1 = {
      ...(game.rooms.W1N1 as object),
      terminal: { store: t1Only },
      storage: { store: t1Only }
    };

    runSingleTargetFlags(world, SimpleBaitTowerOperation);

    const entry = opStateOf("W1N1", "W5N5");
    expect(entry?.wanted).toBe(1);
    expect(entry?.boostTier).toBe(1);
  });
});
