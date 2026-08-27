// Colony.labs() (docs/boosting-lab-runner-design.md sections 2-3, Task D of gh #61's epic): the LabRunner.
// Two independent halves in one method: (a) one-time lab-identity discovery (persist the first 3 built
// labs' ids, never re-decided), (b) every-call claim reconciliation/allocation via Task A's planLabClaims
// (src/empire/labClaims.ts), fed by this colony's own boostable creeps' outstanding memory.boosts orders.
//
// Fixture conventions follow test/unit/colony.test.ts (testColony/colonySnap from test/fixtures.ts) and
// test/unit/colonyMemory.test.ts (stubGame + hand-built Memory.colonies entries) — a fabricated
// ColonySnapshot + stubbed Game/Memory, no mockup server needed (Colony.labs() only reads
// Memory.colonies[name] directly and Game.rooms[name].find(FIND_MY_STRUCTURES) for live lab discovery).

import { beforeEach, describe, expect, it } from "vitest";
import { colony } from "../../src/colony";
import type { Intent } from "../../src/intents/types";
import { colonySnap } from "../fixtures";
import { stubGame } from "../helpers";
import { resetFindPathCacheForTests } from "../../src/construction/planner";
import { stubPathFinderSingleRoom } from "../constants";

const LAB_1 = "lab1" as Id<StructureLab>;
const LAB_2 = "lab2" as Id<StructureLab>;
const LAB_3 = "lab3" as Id<StructureLab>;
const LAB_4 = "lab4" as Id<StructureLab>;

function labStructure(id: Id<StructureLab>): StructureLab {
  return { id, structureType: STRUCTURE_LAB } as unknown as StructureLab;
}

// Stubs Game.rooms[room].find so FIND_MY_STRUCTURES returns exactly the given lab ids (filtered by the
// planner's own `s.structureType === STRUCTURE_LAB` predicate, matching the real API shape).
function roomWithLabs(room: string, labIds: Id<StructureLab>[]): void {
  stubGame({
    rooms: {
      [room]: {
        find: (type: number, opts?: { filter?: (s: unknown) => boolean }) => {
          if (type !== FIND_MY_STRUCTURES) return [];
          const labs = labIds.map(labStructure);
          return opts?.filter ? labs.filter(opts.filter) : labs;
        }
      }
    }
  });
}

function setBoostLabIdsIntents(intents: Intent[]): Extract<Intent, { kind: "setBoostLabIds" }>[] {
  return intents.filter((i): i is Extract<Intent, { kind: "setBoostLabIds" }> => i.kind === "setBoostLabIds");
}

function setBoostClaimsIntents(intents: Intent[]): Extract<Intent, { kind: "setBoostClaims" }>[] {
  return intents.filter((i): i is Extract<Intent, { kind: "setBoostClaims" }> => i.kind === "setBoostClaims");
}

beforeEach(() => {
  stubPathFinderSingleRoom();
  resetFindPathCacheForTests();
});

describe("Colony.labs(): lab-identity discovery", () => {
  it("emits no setBoostLabIds intent when boostLabIds is unset and only 2 labs are built", () => {
    roomWithLabs("W1N1", [LAB_1, LAB_2]);
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };
    const c = colony(colonySnap({ name: "W1N1" }));

    const intents = c.labs();

    expect(setBoostLabIdsIntents(intents)).toEqual([]);
  });

  it("emits exactly one setBoostLabIds intent with 3 deterministically-chosen ids when 3+ labs are built", () => {
    roomWithLabs("W1N1", [LAB_3, LAB_1, LAB_2, LAB_4]); // unsorted on purpose
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };
    const c = colony(colonySnap({ name: "W1N1" }));

    const intents = c.labs();
    const setIntents = setBoostLabIdsIntents(intents);

    expect(setIntents).toHaveLength(1);
    expect(setIntents[0].labIds).toHaveLength(3);
    // Deterministic: ascending by id string, first 3 -> lab1, lab2, lab3 (lab4 excluded).
    expect(setIntents[0].labIds).toEqual([LAB_1, LAB_2, LAB_3]);
  });

  it("produces the same chosen ids across repeated calls against the same input (deterministic)", () => {
    roomWithLabs("W1N1", [LAB_3, LAB_1, LAB_2, LAB_4]);
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };
    const c1 = colony(colonySnap({ name: "W1N1" }));
    const c2 = colony(colonySnap({ name: "W1N1" }));

    const first = setBoostLabIdsIntents(c1.labs())[0];
    const second = setBoostLabIdsIntents(c2.labs())[0];

    expect(second.labIds).toEqual(first.labIds);
  });

  it("never re-emits setBoostLabIds once already persisted, even if more labs appear built", () => {
    roomWithLabs("W1N1", [LAB_1, LAB_2, LAB_3, LAB_4]); // now 4 built
    Memory.colonies = {
      W1N1: {
        sources: {},
        remotes: [],
        danger: 0,
        colonizing: [],
        attacking: [],
        defending: [],
        boostLabIds: [LAB_1, LAB_2, LAB_3] // already decided previously
      }
    };
    const c = colony(colonySnap({ name: "W1N1" }));

    const intents = c.labs();

    expect(setBoostLabIdsIntents(intents)).toEqual([]);
  });
});

describe("Colony.labs(): claim reconciliation + allocation", () => {
  it("skips claim allocation entirely while boostLabIds is still unset", () => {
    roomWithLabs("W1N1", [LAB_1]); // not enough to discover labs yet either
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };
    const c = colony(colonySnap({ name: "W1N1" }));

    const intents = c.labs();

    expect(setBoostClaimsIntents(intents)).toEqual([]);
  });

  it("emits a setBoostClaims intent with an empty claims array when no creeps have pending boosts.memory", () => {
    roomWithLabs("W1N1", [LAB_1, LAB_2, LAB_3]);
    Memory.colonies = {
      W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [], boostLabIds: [LAB_1, LAB_2, LAB_3] }
    };
    const c = colony(colonySnap({ name: "W1N1", creeps: [] }));

    const intents = c.labs();
    const claimIntents = setBoostClaimsIntents(intents);

    expect(claimIntents).toHaveLength(1);
    expect(claimIntents[0].claims).toEqual([]);
  });

  it("emits a setBoostClaims intent reflecting a new claim for a creep with a pending boost order", () => {
    roomWithLabs("W1N1", [LAB_1, LAB_2, LAB_3]);
    Memory.colonies = {
      W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [], boostLabIds: [LAB_1, LAB_2, LAB_3] }
    };
    const healerCreep = {
      id: "h1" as Id<Creep>,
      name: "h1",
      body: [HEAL, HEAL, MOVE],
      ticksToLive: 1000,
      spawning: false,
      role: "simpleHealer",
      home: "W1N1",
      room: "W1N1",
      x: 5,
      y: 5,
      hits: 100,
      hitsMax: 100,
      fatigue: 0,
      storeEnergy: 0,
      storeCapacity: 0,
      memory: { role: "simpleHealer", home: "W1N1", boosts: ["heal"] }
    };
    const c = colony(colonySnap({ name: "W1N1", creeps: [healerCreep as never] }));

    const intents = c.labs();
    const claimIntents = setBoostClaimsIntents(intents);

    expect(claimIntents).toHaveLength(1);
    expect(claimIntents[0].claims).toHaveLength(1);
    // Tier defaults to T1 (no tier-resolution plumbing exists yet — see Colony.labs()'s own doc); heal's
    // T1 compound is LO == RESOURCE_LEMERGIUM_OXIDE (BOOSTS.heal.LO, test/constants.ts's stubbed table).
    expect(claimIntents[0].claims[0]).toMatchObject({ compound: RESOURCE_LEMERGIUM_OXIDE });
  });

  it("reads existing boostClaims from memory, threads them through planLabClaims, and emits the reconciled result", () => {
    roomWithLabs("W1N1", [LAB_1, LAB_2, LAB_3]);
    // An existing claim for a compound nobody needs anymore -> planLabClaims should drop it (0 demand).
    Memory.colonies = {
      W1N1: {
        sources: {},
        remotes: [],
        danger: 0,
        colonizing: [],
        attacking: [],
        defending: [],
        boostLabIds: [LAB_1, LAB_2, LAB_3],
        boostClaims: { [LAB_1]: { compound: RESOURCE_UTRIUM_HYDRIDE, amount: 200 } }
      }
    };
    const c = colony(colonySnap({ name: "W1N1", creeps: [] }));

    const intents = c.labs();
    const claimIntents = setBoostClaimsIntents(intents);

    expect(claimIntents).toHaveLength(1);
    // Stale claim (no demand for RESOURCE_UTRIUM_HYDRIDE anymore) must be dropped, not carried forward.
    expect(claimIntents[0].claims).toEqual([]);
  });
});
