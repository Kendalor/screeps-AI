import { describe, expect, it } from "vitest";
import { haulerRequests, minerRequests } from "../../src/systems/logistics";
import { containerAt, snapCreep, snapCreeps, sourceAt, testColony } from "../fixtures";

// The formulas are ported verbatim from the counts these requesters replaced, so every assertion
// about "how many" survives as an assertion about how many requests come back.
describe("minerRequests", () => {
  it("wants exactly one miner for a single source when no haulers are alive yet", () => {
    expect(minerRequests(testColony({ sources: [sourceAt(20, 10)] }))).toHaveLength(1);
  });

  it("caps requests by live hauler count once a hauler exists", () => {
    // Default 300-energy body carries 2 WORK, so one source (target 6 WORK) wants 3 miners
    // once the cold-start floor no longer applies — but only one hauler is alive to collect.
    const colony = testColony({ sources: [sourceAt(20, 10)], creeps: snapCreeps("hauler", 1) });
    expect(minerRequests(colony)).toHaveLength(1);
  });

  // The cap is on total miner headcount, not on requests per tick: counting only requests would
  // let the colony re-spend the whole hauler allowance every tick and mine far past its collectors.
  it("counts live miners against the collector cap", () => {
    const colony = testColony({
      sources: [sourceAt(20, 10)],
      creeps: [...snapCreeps("hauler", 1), ...snapCreeps("miner", 1)]
    });

    expect(minerRequests(colony)).toEqual([]);
  });

  it("caps requests by the source's open adjacent tiles, even with haulers to spare", () => {
    // An enclosed source with only one open tile can never seat more than one miner.
    const enclosed = sourceAt(20, 10, "source_20_10", 1);
    const colony = testColony({ sources: [enclosed], creeps: snapCreeps("hauler", 5) });
    expect(minerRequests(colony)).toHaveLength(1);
  });

  it("asks for fewer, bigger miners as energy capacity grows", () => {
    const twoSources = [sourceAt(20, 10), sourceAt(30, 40)];
    const small = testColony({ sources: twoSources, creeps: snapCreeps("hauler", 5), energyCapacity: 300 });
    const large = testColony({ sources: twoSources, creeps: snapCreeps("hauler", 5), energyCapacity: 1000 });

    const workOf = (body: BodyPartConstant[]) => body.filter(p => p === WORK).length;
    expect(workOf(minerRequests(large)[0].body)).toBeGreaterThan(workOf(minerRequests(small)[0].body));
  });

  // The per-source deficit is the point of the change: a count could not tell a double-staffed
  // source from a bare one.
  it("asks only for the source no live miner is assigned to", () => {
    // One open tile each, so a single miner saturates a source and the only remaining demand is
    // the source nobody is on. A count could not tell these two apart.
    const covered = sourceAt(20, 10, "source_20_10", 1);
    const bare = sourceAt(30, 40, "source_30_40", 1);
    const colony = testColony({
      sources: [covered, bare],
      creeps: [
        ...snapCreeps("hauler", 5),
        snapCreep("miner", { memory: { sourceId: covered.id } })
      ]
    });

    const requests = minerRequests(colony);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.sourceId).toBe(bare.id);
  });

  it("ignores a miner assigned to a source this colony does not have", () => {
    const source = sourceAt(20, 10);
    const colony = testColony({
      sources: [source],
      // Haulers for headroom: the collector cap counts every live miner, including the stray one.
      creeps: [...snapCreeps("hauler", 5), snapCreep("miner", { memory: { sourceId: "elsewhere" as Id<Source> } })]
    });

    expect(minerRequests(colony)[0].memory.sourceId).toBe(source.id);
  });

  it("returns nothing once every source is covered", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const colony = testColony({
      sources: [source],
      creeps: [...snapCreeps("hauler", 5), snapCreep("miner", { memory: { sourceId: source.id } })]
    });

    expect(minerRequests(colony)).toEqual([]);
  });

  // A miner deployed before this stage carries no sourceId (PRD §6). It still mines, so it must
  // count as cover for a source — not merely consume the collector cap while every source still
  // looks bare, which would stop miner demand entirely until it died of old age.
  it("treats a miner with no sourceId as cover rather than letting it starve demand", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const colony = testColony({
      sources: [source],
      creeps: [...snapCreeps("hauler", 1), snapCreep("miner", { memory: {} })]
    });

    expect(minerRequests(colony)).toEqual([]);
  });

  it("spreads unassigned miners across sources before asking for new ones", () => {
    const a = sourceAt(20, 10, "source_a", 1);
    const b = sourceAt(30, 40, "source_b", 1);
    const colony = testColony({
      sources: [a, b],
      // Two haulers of headroom, one legacy miner: it covers the first source, the second is bare.
      creeps: [...snapCreeps("hauler", 2), snapCreep("miner", { memory: {} })]
    });

    const requests = minerRequests(colony);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.sourceId).toBe(b.id);
  });

  // The per-source WORK target and the body that fills it must be sized against the same context;
  // asking with hasContainer:false while spawning a container-shaped body over-provisions the source.
  it("sizes the per-source target against the same body it actually requests", () => {
    const source = sourceAt(20, 10);
    const colony = testColony({
      sources: [source],
      containers: [containerAt(21, 10, 0)],
      energyCapacity: 800,
      creeps: snapCreeps("hauler", 9)
    });

    const requests = minerRequests(colony);
    const workPerMiner = requests[0].body.filter(p => p === WORK).length;
    // 6 WORK wanted per source, so the count must follow the body actually being sent.
    expect(requests).toHaveLength(Math.ceil(6 / workPerMiner));
  });

  it("stamps the requesting op on every request, so its creeps are identifiable next tick", () => {
    const [request] = minerRequests(testColony({ sources: [sourceAt(20, 10)] }));

    expect(request.memory).toMatchObject({ role: "miner", home: "W1N1", op: "mining:W1N1" });
  });
});

describe("haulerRequests", () => {
  it("wants no haulers when there is nothing to haul from", () => {
    expect(haulerRequests(testColony({ containers: [] }))).toEqual([]);
  });

  it("wants one hauler per active container", () => {
    expect(haulerRequests(testColony({ containers: [containerAt(10, 10, 500)], energyAvailable: 550 }))).toHaveLength(1);
    expect(
      haulerRequests(
        testColony({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 500)], energyAvailable: 550 })
      )
    ).toHaveLength(2);
  });

  it("ignores containers that are sitting empty", () => {
    expect(
      haulerRequests(
        testColony({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 0)], energyAvailable: 550 })
      )
    ).toHaveLength(1);
  });

  it("wants no haulers when the colony cannot afford even one body", () => {
    expect(haulerRequests(testColony({ containers: [containerAt(10, 10, 500)], energyCapacity: 100 }))).toEqual([]);
  });

  it("returns nothing once the live haulers cover every filling container", () => {
    const colony = testColony({
      containers: [containerAt(10, 10, 500)],
      energyAvailable: 550,
      creeps: snapCreeps("hauler", 1)
    });

    expect(haulerRequests(colony)).toEqual([]);
  });
});
