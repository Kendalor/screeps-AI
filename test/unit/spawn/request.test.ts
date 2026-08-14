// fillTo is the shared satisfaction-check helper most colony-scoped operations route through
// (Building, Upgrading, Scouting, Defense, Repairing, Logistics' steward/transport). Its spawnRoom pin
// is the load-bearing fix for a real bug: without it, a colony-scoped request could be opportunistically
// fulfilled by an unrelated colony's spawn (see planSpawning's "nearest colony that can afford it"
// fallback in empire/spawning.ts) — observed live when a freshly colonized, spawnless room's own Mining
// operation started requesting a local miner that got silently routed through the SPONSOR colony's
// spawn, starving the sponsor's settler request for the exact same budget.

import { describe, expect, it } from "vitest";
import { fillTo } from "../../../src/spawn/request";

const memory: CreepMemory = { role: "builder", home: "W1N1" };
const body: BodyPartConstant[] = [WORK, CARRY, MOVE];

describe("fillTo", () => {
  it("pins spawnRoom to memory.home, same as targetRoom", () => {
    const requests = fillTo(1, 0, body, 50, memory);
    expect(requests).toHaveLength(1);
    expect(requests[0].targetRoom).toBe("W1N1");
    expect(requests[0].spawnRoom).toBe("W1N1");
  });

  it("pins every request in a multi-request fill, not just the first", () => {
    const requests = fillTo(3, 0, body, 50, memory);
    expect(requests).toHaveLength(3);
    for (const r of requests) expect(r.spawnRoom).toBe("W1N1");
  });

  it("emits nothing once the quota is met", () => {
    expect(fillTo(2, 2, body, 50, memory)).toEqual([]);
  });
});
