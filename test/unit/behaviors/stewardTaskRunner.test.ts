// Regression coverage for planStewardTask's cross-resource pairing (behaviors/stewardTaskRunner.ts) —
// gh #59 fix: planStewardTask used to score each resource's single best request in isolation
// (pickBestRequest, sign-agnostic) with no check that a real opposite-signed counterpart existed. A
// permanently-unfillable want (e.g. a never-mined mineral's storage-want, pinned at the full flat target
// since storage holds none of it) could then win the cross-resource race by magnitude alone and starve
// every real, fulfillable request behind it — confirmed live on the pserver: X sat at 3000 in the
// terminal, 0 in storage, and Steward never moved it because a same-scoring or higher-scoring one-sided
// want for an entirely different, never-mined resource kept winning instead. Fixed by routing
// planStewardTask through the SAME greedy cross-resource pairing algorithm Transport's pool uses
// (logistics/greedyMatch.ts's pickBestPair) — a resource is only ever a candidate if BOTH a real output
// and a real input exist for it right now; a one-sided want or have, however large, is never scored and
// never wins. This file drives planStewardTask itself against minimal stubs of the exact Game API surface
// it reads, same pattern transportTaskRunner.test.ts/stewardRegister.test.ts already use.

import { beforeEach, describe, expect, it } from "vitest";
import { planStewardTask, type StewardTriangle } from "../../../src/behaviors/stewardTaskRunner";
import { baseTargetFor, boostLineResources } from "../../../src/empire/boostTargets";

const STORAGE_CAPACITY = 1_000_000;
const TERMINAL_CAPACITY = 300_000;
const GO_TARGET = baseTargetFor("GO")!; // src/empire/boostTargets.ts's BOOST_TARGETS.GO

beforeEach(() => {
  (globalThis as Record<string, unknown>).Memory = { colonies: { W1N1: {} } };
});

function pos(x: number, y: number, roomName = "W1N1"): RoomPosition {
  const self = {
    x,
    y,
    roomName,
    getRangeTo: (other: { pos?: RoomPosition } | RoomPosition) => {
      const o = (other as { pos?: RoomPosition }).pos ?? (other as RoomPosition);
      return Math.max(Math.abs(x - o.x), Math.abs(y - o.y));
    }
  };
  return self as unknown as RoomPosition;
}

// registerMineralStorageWantRequest registers for EVERY boostLineResources() entry, not just the one a
// test cares about — an unspecified resource's stock defaults to its OWN target here (want-neutral, "at
// target, nothing wanted"), not to 0 (which would spawn a spurious want for all ~40 other configured
// resources at once, though under the new pairing rule those wants are harmless anyway since none of them
// has a matching terminal-have — this default is kept so tests stay focused on the resource(s) they name).
function neutralMineralStock(overrides: Partial<Record<ResourceConstant, number>>): Partial<Record<ResourceConstant, number>> {
  const neutral: Partial<Record<ResourceConstant, number>> = {};
  for (const r of boostLineResources()) neutral[r] = baseTargetFor(r) ?? 0;
  return { ...neutral, ...overrides };
}

function stubStorage(stored: Partial<Record<ResourceConstant, number>>, x = 5, y = 5): StructureStorage {
  const full = neutralMineralStock(stored);
  return {
    id: "storage1" as Id<StructureStorage>,
    pos: pos(x, y),
    structureType: STRUCTURE_STORAGE,
    store: {
      getUsedCapacity: (r: ResourceConstant) => full[r] ?? 0,
      getCapacity: () => STORAGE_CAPACITY,
      getFreeCapacity: (r: ResourceConstant) => STORAGE_CAPACITY - (full[r] ?? 0)
    }
  } as unknown as StructureStorage;
}

function stubTerminal(stored: Partial<Record<ResourceConstant, number>>, x = 20, y = 20): StructureTerminal {
  return {
    id: "terminal1" as Id<StructureTerminal>,
    pos: pos(x, y),
    structureType: STRUCTURE_TERMINAL,
    store: {
      getUsedCapacity: (r: ResourceConstant) => stored[r] ?? 0,
      getCapacity: () => TERMINAL_CAPACITY,
      getFreeCapacity: (r: ResourceConstant) => TERMINAL_CAPACITY - (stored[r] ?? 0)
    }
  } as unknown as StructureTerminal;
}

function stubCreep(p: RoomPosition, store: Partial<Record<ResourceConstant, number>> = {}, capacity = 50): Creep {
  return {
    pos: p,
    memory: { home: "W1N1" },
    store: {
      getUsedCapacity: (r: ResourceConstant) => store[r] ?? 0,
      getFreeCapacity: (r: ResourceConstant) => capacity - (store[r] ?? 0)
    }
  } as unknown as Creep;
}

describe("planStewardTask's greedy cross-resource pairing", () => {
  it("fetches a mineral from the TERMINAL to fill storage's want (regression: confirmed live)", () => {
    // The exact scenario found live: an empire transfer landed 3,000 X in the terminal; storage holds
    // none. Storage's want (input) and the terminal's have (output) are a real matched pair for X.
    const storage = stubStorage({ energy: 0, X: 0 }, 5, 5);
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY, X: 3000 }, 20, 20);
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe("X");
    expect(task?.kind).toBe("withdraw");
    expect(task?.target).toBe(terminal); // fetches from the terminal, where the mineral actually is
    expect(task?.parent?.kind).toBe("transfer");
    expect(task?.parent?.target).toBe(storage); // then delivers to storage, the request's real target
  });

  it("a one-sided storage-want with NO matching terminal supply is never picked, however large (the live bug)", () => {
    // The actual live bug: O/U/L/K/Z/G-style never-mined minerals register a full-target storage-want
    // (permanently unfillable — terminal has none) that used to win the old single-sided race by
    // magnitude alone. Under the pairing rule, GO's storage-want has no matching terminal-have, so it's
    // never even a candidate — even though it's the ONLY registered request besides energy (which also
    // doesn't qualify here), planStewardTask must return undefined, not a phantom 0-amount task.
    const storage = stubStorage({ energy: 0, GO: 0 }, 5, 5);
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY, GO: 0 }, 20, 20); // no GO to fetch — no pair possible
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeUndefined();
  });

  it("a one-sided want never blocks a DIFFERENT resource's real, fulfillable pair (the live bug's actual symptom)", () => {
    // Reproduces the live scenario directly: GO has only a one-sided storage-want (no terminal supply,
    // unfulfillable, scores at the max possible amount since storage holds none) sitting alongside X's
    // real two-sided pair (terminal has 2,200 X — smaller than GO's phantom 3,000 want). The old
    // single-sided race let GO's larger phantom amount win and starve X forever; the pairing rule must
    // skip GO (no counterpart) and pick X (a real pair) instead, regardless of GO's larger raw amount.
    const storage = stubStorage({ energy: 0, GO: 0, X: 800 }, 5, 5); // X: min(3000-800, free) storage-want = 2200
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY, GO: 0, X: 2200 }, 20, 20);
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe("X");
    expect(task?.kind).toBe("withdraw");
    expect(task?.target).toBe(terminal);
    expect(task?.parent?.target).toBe(storage);
  });

  it("picks a mineral (GO) terminal-have (drain) task when it is the only qualifying pair", () => {
    // Storage must be BELOW target for a real GO input to exist — the terminal-have (output) needs a
    // genuine opposite-signed counterpart to pair against under the new rule; "storage already at target"
    // would leave the have side one-sided and unpickable (see the live bug this fix addresses).
    const storage = stubStorage({ energy: 0, GO: 500 }, 5, 5); // below target — a real storage-want exists
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY, GO: 500 }, 20, 20); // has stock to give
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe("GO");
    expect(task?.kind).toBe("withdraw");
    expect(task?.target).toBe(terminal);
    expect(task?.parent?.target).toBe(storage);
  });

  it("races a big mineral terminal-have against a small energy want and picks the higher-scoring one, regardless of resource", () => {
    const storage = stubStorage({ energy: 900_000, GO: 500 }, 5, 5); // below target — a real GO pair exists
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY - 10, GO: 50_000 }, 20, 20); // energy: tiny 10-unit want; GO: huge have
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe("GO"); // the far bigger amount wins, not whichever resource happens to be RESOURCE_ENERGY
  });

  it("still picks energy when it is the only qualifying pair (no regression on the pre-gh-#59 behavior)", () => {
    const storage = stubStorage({ energy: 800_000 }, 5, 5);
    const terminal = stubTerminal({ energy: 10_000 }, 20, 20);
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe(RESOURCE_ENERGY);
    expect(task?.kind).toBe("withdraw");
    expect(task?.parent?.target).toBe(terminal);
  });

  it("uses the winning pair's own resource on BOTH legs of the withdraw+deliver task, not a hardcoded energy leg", () => {
    // Link drain is energy-only in practice (no mineral link exists), but this proves the fork()'d pair's
    // resource is read from the matched pair rather than a literal RESOURCE_ENERGY baked into the Task.
    const link = {
      id: "link1" as Id<StructureLink>,
      pos: pos(10, 10),
      structureType: STRUCTURE_LINK,
      store: {
        getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 400 : 0),
        getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 800 : 0),
        getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 400 : 0)
      }
    } as unknown as StructureLink;
    const storage = stubStorage({ energy: 0 }, 5, 5);
    const triangle: StewardTriangle = { link, storage };
    const creep = stubCreep(pos(10, 10));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.kind).toBe("withdraw");
    expect(task?.resource).toBe(RESOURCE_ENERGY);
    expect(task?.parent?.resource).toBe(RESOURCE_ENERGY);
    expect(task?.parent?.target).toBe(storage);
  });

  it("link drain pairs against storage's own implicit energy want (gh #59: links resolved as real pairs, not a hardcoded sink)", () => {
    // The link has energy to give (drain, output) and storage's own implicit input request (free
    // capacity) is its real pairing partner (stewardRegister.ts's registerStorageEnergyRequests) — no
    // other energy input exists here (no controller link, no terminal), so this proves the pairing
    // resolves correctly even when storage's implicit request is the ONLY thing making the pair possible.
    const link = {
      id: "link1" as Id<StructureLink>,
      pos: pos(10, 10),
      structureType: STRUCTURE_LINK,
      store: {
        getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 800 : 0),
        getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 800 : 0),
        getFreeCapacity: () => 0
      }
    } as unknown as StructureLink;
    const storage = stubStorage({ energy: 500_000 }, 5, 5); // plenty of free capacity to receive the drain
    const triangle: StewardTriangle = { link, storage };
    const creep = stubCreep(pos(10, 10));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.kind).toBe("withdraw");
    expect(task?.target).toBe(link);
    expect(task?.parent?.target).toBe(storage);
  });

  it("controller-link top-up pairs against storage's own implicit energy have", () => {
    const link = {
      id: "link1" as Id<StructureLink>,
      pos: pos(10, 10),
      structureType: STRUCTURE_LINK,
      store: {
        getUsedCapacity: () => 0,
        getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 800 : 0),
        getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 800 : 0)
      }
    } as unknown as StructureLink;
    const controllerLink = {
      id: "clink1" as Id<StructureLink>,
      pos: pos(30, 30),
      structureType: STRUCTURE_LINK,
      store: {
        getUsedCapacity: () => 0, // empty — well below CONTROLLER_LINK_LOW_FRACTION
        getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 800 : 0),
        getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? 800 : 0)
      }
    } as unknown as StructureLink;
    const storage = stubStorage({ energy: 500_000 }, 5, 5); // has energy to give
    const triangle: StewardTriangle = { link, controllerLink, storage };
    const creep = stubCreep(pos(10, 10));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.kind).toBe("withdraw");
    expect(task?.target).toBe(storage); // withdraws energy from storage
    expect(task?.parent?.target).toBe(link); // delivers to the anchor link
  });

  it("returns undefined when the pool is empty (no storage at all)", () => {
    const triangle: StewardTriangle = {};
    const creep = stubCreep(pos(10, 10));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeUndefined();
  });
});
