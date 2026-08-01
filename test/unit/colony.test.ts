// Colony's constructor attaches one Colonize instance per target listed in its snapshot's `colonizing`
// array (ColonyMemory.colonizing) — see colony/index.ts's header comment. This is the durable seam that
// replaced deriving "is this colony colonizing X" from a live colonizer/settler creep's own memory: the
// list is written once by a flag/auto-pick handoff (addColonizeTarget) and read every tick, so the
// operation exists as a plain memory fact from the moment of handoff, not only once a creep for it
// happens to already be alive. Separately, Colony threads each active target's OWN energyCapacity (once
// that target is itself a real Colony in the wider colony list) into Colonize's targetEnergyCapacity,
// since neither Colonize nor Colony can look that up on their own — only the Empire constructing every
// Colony at once has that visibility.

import { describe, expect, it } from "vitest";
import { colony } from "../../src/colony";
import { opName } from "../../src/spawn/request";
import { colonySnap, testColony } from "../fixtures";

describe("Colony: colonize targets", () => {
  it("attaches no Colonize operation when colonizing is empty", () => {
    const c = testColony();
    expect(c.operations.some(op => op.kind === "colonize")).toBe(false);
  });

  it("attaches a Colonize operation for each listed target", () => {
    const c = testColony({ colonizing: ["W5N5"] });
    const colonize = c.operations.find(op => op.kind === "colonize");
    expect(colonize?.name).toBe(opName("colonize", "W1N1"));
  });

  it("attaches one Colonize operation per distinct target room", () => {
    const c = testColony({ colonizing: ["W5N5", "W6N6"] });
    expect(c.operations.filter(op => op.kind === "colonize")).toHaveLength(2);
  });

  it("attaches no operation for a target that is not listed", () => {
    const c = testColony({ colonizing: [] });
    expect(c.operations.some(op => op.kind === "colonize")).toBe(false);
  });
});

describe("Colony: colonize target energy capacity threading", () => {
  it("leaves targetEnergyCapacity undefined when the target isn't yet a real colony (claim hasn't landed)", () => {
    const sponsor = colonySnap({ name: "W1N1", colonizing: ["W5N5"] });
    const c = colony(sponsor, [sponsor]); // W5N5 absent from allSnapshots — not a colony yet
    const colonize = c.operations.find(op => op.kind === "colonize");
    // Settlers should still be requested with no self-sufficiency cap in effect (targetEnergyCapacity
    // undefined) — an affordable sponsor snapshot proves the settler request survived the lookup miss.
    const settlerRequests = colonize!.desiredCreeps(sponsor).filter(r => r.memory.role === "settler");
    expect(settlerRequests).toHaveLength(1);
  });

  it("threads the target's own energyCapacity through once it appears in allSnapshots", () => {
    const sponsor = colonySnap({ name: "W1N1", energyCapacity: 650, colonizing: ["W5N5"] });
    // The target has already reached self-sufficiency (>= SELF_SUFFICIENT_ENERGY_CAP, 550).
    const target = colonySnap({ name: "W5N5", energyCapacity: 550 });
    const c = colony(sponsor, [sponsor, target]);
    const colonize = c.operations.find(op => op.kind === "colonize");
    const settlerRequests = colonize!.desiredCreeps(sponsor).filter(r => r.memory.role === "settler");
    expect(settlerRequests).toEqual([]);
  });

  it("still requests settlers when the target exists but hasn't reached self-sufficiency yet", () => {
    const sponsor = colonySnap({ name: "W1N1", energyCapacity: 650, colonizing: ["W5N5"] });
    const target = colonySnap({ name: "W5N5", energyCapacity: 300 }); // below the 550 cap
    const c = colony(sponsor, [sponsor, target]);
    const colonize = c.operations.find(op => op.kind === "colonize");
    const settlerRequests = colonize!.desiredCreeps(sponsor).filter(r => r.memory.role === "settler");
    expect(settlerRequests).toHaveLength(1);
  });

  it("does not confuse a different colony's energyCapacity in allSnapshots for the actual target's", () => {
    const sponsor = colonySnap({ name: "W1N1", energyCapacity: 650, colonizing: ["W5N5"] });
    // A third, unrelated colony sits in allSnapshots at self-sufficient capacity — must not leak onto W5N5.
    const unrelated = colonySnap({ name: "W9N9", energyCapacity: 550 });
    const c = colony(sponsor, [sponsor, unrelated]);
    const colonize = c.operations.find(op => op.kind === "colonize");
    const settlerRequests = colonize!.desiredCreeps(sponsor).filter(r => r.memory.role === "settler");
    expect(settlerRequests).toHaveLength(1);
  });
});
