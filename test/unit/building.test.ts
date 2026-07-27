import { describe, expect, it } from "vitest";
import type { Intent } from "../../src/intents/types";
import type { ColonySnapshot, SnapStructure } from "../../src/snapshot/types";
import { colony } from "../../src/colony";
import { colonySnap, sourceAt } from "../fixtures";
import { Mining } from "../../src/operations/mining";
import { buildableAtRcl } from "../../src/layouts/goal";
import { stampLayout } from "../../src/layouts/stamp";
import type { GoalLayout } from "../../src/layouts/sync";
import GOAL_JSON from "../../src/layouts/Base_2.json";
import type { XY } from "../../src/lib/geometry";

// What the colony's Mining operation claims — the same call planBuilding makes, so these tests
// assert the arbiter merges real operation demand rather than a re-stated copy of it.
const minedStructures = (snap: ColonySnapshot) => new Mining(snap.name).structures(snap);

// Every non-road structure the goal permits at `rcl`, stamped at the anchor.
function allNonRoadStructuresAt(anchor: XY, rcl: number): SnapStructure[] {
  return stampLayout(buildableAtRcl(GOAL_JSON as GoalLayout, rcl), anchor)
    .filter(p => p.type !== "road")
    .map(p => ({ x: p.x, y: p.y, type: p.type }));
}

describe("building planner", () => {
  // Base_2.json has no containers; building.ts must collect mining's per-source
  // declarations or the colony can never build one.
  it("places the source containers that mining declares (once higher priorities are built)", () => {
    const anchor = { x: 25, y: 25 };
    const built = allNonRoadStructuresAt(anchor, 3);
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 550,
        sources: [sourceAt(20, 10)],
        structures: built,
        sites: []
      })
    );

    const intents = snap.building();

    const [container] = minedStructures(snap.snapshot);
    expect(intents).toContainEqual({
      kind: "placeSite",
      room: "W1N1",
      x: container.x,
      y: container.y,
      type: "container"
    });
  });

  it("does not re-place a source container that already exists", () => {
    const base = colonySnap({
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 550,
      sources: [sourceAt(20, 10)],
      structures: [],
      sites: []
    });
    const [container] = minedStructures(base);
    const snap = colony({ ...base, structures: [container] });

    const intents = snap.building();

    expect(intents).not.toContainEqual(
      expect.objectContaining({ kind: "placeSite", x: container.x, y: container.y })
    );
  });

  it("does not tear down a source container as a stale structure", () => {
    const base = colonySnap({
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 550,
      sources: [sourceAt(20, 10)],
      structures: [],
      sites: []
    });
    const [container] = minedStructures(base);
    const snap = colony({ ...base, structures: [container] });

    const intents = snap.building();

    // Containers are absent from the bunker stamp by design; the teardown pass must
    // consult mining's declarations too, or it demolishes the container it just placed.
    expect(intents).not.toContainEqual(
      expect.objectContaining({ kind: "removeStructure", x: container.x, y: container.y })
    );
  });

  it("places only RCL2-buildable structural sites (no RCL3+ type, no roads), within the focus cap", () => {
    const snap = colony(
      colonySnap({
        anchor: { x: 25, y: 25 },
        controllerLevel: 2,
        sources: [sourceAt(20, 10)],
        structures: [],
        sites: []
      })
    );

    const intents = snap.building();

    expect(intents.every(i => i.kind === "placeSite")).toBe(true);
    expect(intents).toHaveLength(2);
    const types = new Set(intents.map(i => i.kind === "placeSite" && i.type));
    expect([...types].some(t => t === "road")).toBe(false);
    expect(
      [...types].every(t => t === "spawn" || t === "extension" || t === "container")
    ).toBe(true);
  });

  it("emits nothing once every RCL-appropriate structure already exists (idempotency)", () => {
    const anchor = { x: 25, y: 25 };
    const base = colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [] });
    const containers: SnapStructure[] = minedStructures(base).map(c => ({ x: c.x, y: c.y, type: c.type }));
    const built = [...allNonRoadStructuresAt(anchor, 2), ...containers];
    const rebuilt = colony({ ...base, structures: built }).building();

    expect(rebuilt.filter(i => i.kind === "placeSite")).toEqual([]);
  });

  it("emits nothing further once the room is already at the focus site cap", () => {
    const sites: SnapStructure[] = [
      { x: 1, y: 0, type: "extension" },
      { x: 2, y: 0, type: "extension" }
    ];

    const snap = colony(
      colonySnap({ anchor: { x: 25, y: 25 }, controllerLevel: 2, structures: [], sites })
    );

    expect(snap.building().filter(i => i.kind === "placeSite")).toEqual([]);
  });

  it("RCL-up unlocks the next tier's intents without re-requesting already-built structures", () => {
    const anchor = { x: 25, y: 25 };
    const structures = allNonRoadStructuresAt(anchor, 2);
    const rcl3 = colony(colonySnap({ anchor, controllerLevel: 3, structures, sites: [] })).building();

    for (const s of structures) {
      expect(rcl3.some(i => i.kind === "placeSite" && i.x === s.x && i.y === s.y && i.type === s.type)).toBe(
        false
      );
    }
    expect(rcl3.some(i => i.kind === "placeSite" && i.type === "tower")).toBe(true);
  });

  it("flags a stale non-spawn structure (present but absent from the goal layout) for removal", () => {
    const anchor = { x: 25, y: 25 };
    const stale: SnapStructure = { x: 35, y: 35, type: "tower" };

    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [stale], sites: [] }));

    const removals = snap.building().filter(i => i.kind === "removeStructure");
    expect(removals).toEqual([{ kind: "removeStructure", room: "W1N1", x: 35, y: 35, type: "tower" }]);
  });

  it("never auto-demolishes a spawn at a stale position, even when it's the room's only spawn", () => {
    const anchor = { x: 25, y: 25 };
    const staleSpawn: SnapStructure = { x: 35, y: 35, type: "spawn" };

    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [staleSpawn], sites: [] }));

    const removals = snap.building().filter(i => i.kind === "removeStructure");
    expect(removals).toEqual([]);
  });
});

// Focused construction: at most 2 open sites at once, a type priority for which 2,
// and no roads before 800 energy capacity (RCL3 with all extensions).
describe("building planner focus policy", () => {
  const anchor = { x: 25, y: 25 };
  const placeSites = (intents: Intent[]) =>
    intents.filter((i): i is Extract<Intent, { kind: "placeSite" }> => i.kind === "placeSite");

  it("places at most 2 construction sites at a time", () => {
    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [], sites: [] }));

    expect(placeSites(snap.building())).toHaveLength(2);
  });

  it("counts existing sites against the cap of 2", () => {
    const oneOpen: SnapStructure[] = [{ x: 10, y: 10, type: "road" }];
    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [], sites: oneOpen }));

    expect(placeSites(snap.building())).toHaveLength(1);
  });

  it("prioritises the tower ahead of extensions when both are buildable", () => {
    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [], sites: [] }));

    const placed = placeSites(snap.building());
    expect(placed.some(i => i.type === "tower")).toBe(true);
  });

  it("places no container sites below the container energy-capacity gate", () => {
    for (const capacity of [300, 549]) {
      const snap = colony(
        colonySnap({
          anchor,
          controllerLevel: 3,
          energyCapacity: capacity,
          sources: [sourceAt(20, 10)],
          structures: [],
          sites: []
        })
      );
      expect(placeSites(snap.building()).some(i => i.type === "container")).toBe(false);
    }
  });

  it("places container sites once the container energy-capacity gate is met", () => {
    const built = allNonRoadStructuresAt(anchor, 3);
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 550,
        sources: [sourceAt(20, 10)],
        structures: built,
        sites: []
      })
    );
    expect(placeSites(snap.building()).some(i => i.type === "container")).toBe(true);
  });

  it("ranks containers below extensions in the focus slots", () => {
    const withTower = [
      ...allNonRoadStructuresAt(anchor, 3).filter(s => s.type === "tower")
    ];
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 550,
        sources: [sourceAt(20, 10)],
        structures: withTower,
        sites: []
      })
    );
    const placed = placeSites(snap.building());
    expect(placed.every(i => i.type === "extension")).toBe(true);
    expect(placed.some(i => i.type === "container")).toBe(false);
  });

  it("places no roads below 800 energy capacity", () => {
    for (const capacity of [300, 550, 799]) {
      const snap = colony(
        colonySnap({ anchor, controllerLevel: 3, energyCapacity: capacity, structures: [], sites: [] })
      );
      expect(placeSites(snap.building()).some(i => i.type === "road")).toBe(false);
    }
  });

  it("road gating at 800 energy capacity: paves near placed structures, not the far outer ring", () => {
    const builtStructures = allNonRoadStructuresAt(anchor, 4);
    const snap = colony(
      colonySnap({ anchor, controllerLevel: 4, energyCapacity: 800, structures: builtStructures, sites: [] })
    );
    const placed = placeSites(snap.building());

    expect(placed.some(i => i.type === "road" && i.x === 23 && i.y === 19)).toBe(false);
    expect(placed.some(i => i.type === "road")).toBe(true);
  });

  // Once Mining claims (at its 550 container gate), building.ts places the claimed source-access
  // roads without also holding them behind its own 800 bunker-road gate — claimed is the gate.
  it("mining's source-access roads bypass building.ts's 800 road gate", () => {
    const base = colonySnap({
      anchor,
      controllerLevel: 3,
      energyCapacity: 550, // at Mining's container gate, still below building.ts's 800 road gate
      sources: [sourceAt(20, 10)],
      structures: allNonRoadStructuresAt(anchor, 3),
      sites: []
    });
    // Pre-build every non-road claim Mining makes so the only thing left to place is its road —
    // otherwise the higher-priority containers monopolise the two focus-site slots and the road
    // (which we're actually testing) never gets a turn.
    const nonRoadClaims = minedStructures(base)
      .filter(p => p.type !== "road")
      .map(p => ({ x: p.x, y: p.y, type: p.type }));
    const snap = colony({ ...base, structures: [...base.structures, ...nonRoadClaims] });

    const placed = placeSites(snap.building());
    // A road placed despite capacity (550) sitting well below building.ts's 800 bunker-road gate.
    expect(placed.some(i => i.type === "road")).toBe(true);
  });

});
