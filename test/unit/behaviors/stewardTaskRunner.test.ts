// Regression coverage for planStewardTask's cross-resource race (behaviors/stewardTaskRunner.ts) — gh #59
// generalized registerStewardRequests to register a terminal-rebalance leg per BOOST_TARGETS resource
// (GO/GHO2/XGHO2/...) alongside energy, but planStewardTask still ranked ONLY against RESOURCE_ENERGY
// (pickBestRequest(requests, RESOURCE_ENERGY, ...)) — every mineral rebalance request got built into the
// pool and then silently never picked, so a Steward creep could never actually move a mineral from storage
// to terminal. Fixed to race every resource present in the pool against every other's best pick, the same
// shape transportTaskRunner.ts's planTransportTask already uses via its own resourcesInPool (see that
// file's header for the identical incident: a fixed energy-first order there once made a long-starved
// mineral pickup structurally unable to outrank a routine energy hop). This file drives planStewardTask
// itself against minimal stubs of the exact Game API surface it reads, same pattern
// transportTaskRunner.test.ts/stewardRegister.test.ts already use.

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
// resources at once and win the cross-resource race by sheer numbers). Explicit `stored` overrides win.
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

describe("planStewardTask's cross-resource race", () => {
  it("fetches a mineral from the TERMINAL to fill storage's want — not left inert with no buffer (regression: confirmed live)", () => {
    // The exact scenario found live: an empire transfer landed 3,000 X in the terminal; storage holds
    // none. Storage's want (registerMineralStorageWantRequest) is real and scores highest, but its
    // delivery TARGET is storage itself — offering storage as a buffer would be a same-structure no-op
    // (correctly excluded), and a prior version of planStewardTask excluded storage WITHOUT substituting
    // the terminal, leaving the buffer list empty. With no buffer, evaluateRoutes only scores a direct
    // route, which caps deliverable amount at what the creep already carries (0 for an idle creep) — so
    // the "task" it built delivered 0 and the creep looked permanently idle despite 3,000 real, sitting,
    // fetchable X. Fixed: the terminal is now offered as a buffer whenever it ISN'T the request's own
    // target, so an idle creep withdraws from the terminal first, then delivers to storage.
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

  it("picks a mineral (GO) storage-want task when it is the only qualifying request — not silently dropped", () => {
    // No energy leg qualifies (storage empty, terminal full); GO's storage-want qualifies (storage well
    // below its own target) — before the fix this request was built by registerStewardRequests but
    // pickBestRequest(requests, RESOURCE_ENERGY, ...) would only ever look at RESOURCE_ENERGY and return
    // undefined, dropping GO on the floor even though it was the only real work available.
    const storage = stubStorage({ energy: 0, GO: 0 }, 5, 5);
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY, GO: 0 }, 20, 20); // no GO to fetch — direct is the only option
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe("GO");
    // No buffer holds any GO to withdraw, so this resolves as a direct transfer (delivering 0 for now —
    // it stays pending until GO actually shows up somewhere Steward can fetch it from).
    expect(task?.kind).toBe("transfer");
    expect(task?.target).toBe(storage);
  });

  it("picks a mineral (GO) terminal-have (drain) task when it is the only qualifying request", () => {
    const storage = stubStorage({ energy: 0, GO: GO_TARGET }, 5, 5); // at target — no storage-want
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY, GO: 500 }, 20, 20); // has stock to give
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe("GO");
    expect(task?.kind).toBe("withdraw");
    expect(task?.target).toBe(terminal);
    expect(task?.parent?.target).toBe(storage); // fixed sink, same as link-drain
  });

  it("races a big mineral terminal-have against a small energy want and picks the higher-scoring one, regardless of resource", () => {
    const storage = stubStorage({ energy: 900_000, GO: GO_TARGET }, 5, 5); // GO at target — isolates the terminal-have leg
    const terminal = stubTerminal({ energy: TERMINAL_CAPACITY - 10, GO: 50_000 }, 20, 20); // energy: tiny 10-unit want; GO: huge have
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe("GO"); // the far bigger amount wins, not whichever resource happens to be RESOURCE_ENERGY
  });

  it("still picks energy when it is the only qualifying request (no regression on the pre-gh-#59 behavior)", () => {
    const storage = stubStorage({ energy: 800_000 }, 5, 5);
    const terminal = stubTerminal({ energy: 10_000 }, 20, 20);
    const triangle: StewardTriangle = { storage, terminal };
    const creep = stubCreep(pos(20, 20));

    const task = planStewardTask(creep, triangle);

    expect(task).toBeDefined();
    expect(task?.resource).toBe(RESOURCE_ENERGY);
    expect(task?.kind).toBe("withdraw"); // same via-storage-detour reasoning as the GO-only test above
    expect(task?.parent?.target).toBe(terminal);
  });

  it("uses the winning request's own resource on BOTH legs of an output (withdraw+deliver) task, not a hardcoded energy leg", () => {
    // Link drain is energy-only in practice (no mineral link exists), but this proves the fork()'d pair's
    // resource is read from `best.resource` rather than a literal RESOURCE_ENERGY baked into the Task.
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
});
