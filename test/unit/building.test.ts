import { describe, expect, it } from "vitest";
import type { Intent } from "../../src/intents/types";
import type { ColonySnapshot, SnapStructure } from "../../src/snapshot/types";
import { colony } from "../../src/colony";
import type { BuildingCountRow } from "../../src/colony/building";
import { wantedStructures } from "../../src/colony/building";
import { colonySnap, remoteSourceAt, snapCreep, sourceAt } from "../fixtures";
import { Mining } from "../../src/operations/mining";
import { buildableAtRcl } from "../../src/layouts/goal";
import { stampLayout, type PlacedStructure } from "../../src/layouts/stamp";
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
        energyCapacity: 800,
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
      energyCapacity: 800,
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
      energyCapacity: 800,
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

  it("places only RCL2-buildable structural sites (no RCL3+ type, no roads)", () => {
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
    expect(intents.length).toBeGreaterThan(0);
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
    // 20 open sites already — matches FOCUS_SITE_CAP, so no budget remains regardless of type.
    const sites: SnapStructure[] = Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: 0,
      type: "extension" as const
    }));

    const snap = colony(
      colonySnap({
        anchor: { x: 25, y: 25 },
        controllerLevel: 2,
        structures: [],
        sites,
        siteSummary: sites.map(s => ({ room: "W1N1", type: s.type }))
      })
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

  it("never demolishes or re-sites a wanted tile occupied by a hand-placed spawn", () => {
    const anchor = { x: 25, y: 25 };
    // A goal-planned extension tile occupied by a spawn placed by hand, off-layout — never demolished
    // (a spawn can't be razed at this RCL/count), so the extension's site must simply be skipped rather
    // than retried against an occupied tile every tick.
    const wantedExt = allNonRoadStructuresAt(anchor, 2).find(s => s.type === "extension")!;
    const blockerSpawn: SnapStructure = { x: wantedExt.x, y: wantedExt.y, type: "spawn" };

    const snap = colony(colonySnap({ anchor, controllerLevel: 2, structures: [blockerSpawn], sites: [] }));

    const intents = snap.building();
    expect(
      intents.some(i => i.kind === "removeStructure" && i.x === blockerSpawn.x && i.y === blockerSpawn.y)
    ).toBe(false);
    expect(
      intents.some(
        i => i.kind === "placeSite" && i.x === wantedExt.x && i.y === wantedExt.y && i.type === "extension"
      )
    ).toBe(false);
  });

  it("substitutes the next-best extension slot when the capped one is blocked by a spawn, instead of losing the slot", () => {
    const anchor = { x: 25, y: 25 };
    // A goal-planned extension tile occupied by a spawn placed by hand, off-layout. The colony should
    // still reach its full RCL2 extension cap by drawing a replacement from beyond the capped set,
    // rather than quietly building one fewer extension than the RCL permits forever.
    const rcl2Exts = allNonRoadStructuresAt(anchor, 2).filter(s => s.type === "extension");
    const blockerSpawn: SnapStructure = { x: rcl2Exts[0].x, y: rcl2Exts[0].y, type: "spawn" };

    const snap = colony(colonySnap({ anchor, controllerLevel: 2, structures: [blockerSpawn], sites: [] }));

    const intents = snap.building();
    const placedExtensions = intents.filter(i => i.kind === "placeSite" && i.type === "extension");
    // Full RCL2 extension cap still reached — the blocked slot's budget went to a substitute, not lost.
    expect(placedExtensions).toHaveLength(rcl2Exts.length);
    // The substitute must be a genuinely new tile, not the blocked one.
    expect(placedExtensions.every(p => p.x !== blockerSpawn.x || p.y !== blockerSpawn.y)).toBe(true);
  });

  it("clears a structure blocking a wanted tile in the same tick it places the replacement, not before", () => {
    const anchor = { x: 25, y: 25 };
    // A goal-planned extension tile occupied by the wrong type — nothing else built yet, so budget
    // is wide open and the replacement site places this same tick.
    const wantedExt = allNonRoadStructuresAt(anchor, 2).find(s => s.type === "extension")!;
    const blocker: SnapStructure = { x: wantedExt.x, y: wantedExt.y, type: "rampart" };

    const snap = colony(colonySnap({ anchor, controllerLevel: 2, structures: [blocker], sites: [] }));

    const intents = snap.building();
    const removeIdx = intents.findIndex(
      i => i.kind === "removeStructure" && i.x === blocker.x && i.y === blocker.y && i.type === "rampart"
    );
    const placeIdx = intents.findIndex(
      i => i.kind === "placeSite" && i.x === wantedExt.x && i.y === wantedExt.y && i.type === "extension"
    );
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(placeIdx).toBeGreaterThanOrEqual(0);
    // Removal must precede placement so the site actually succeeds in-game the same tick it's cleared.
    expect(removeIdx).toBeLessThan(placeIdx);
  });

  it("does not clear a structure blocking a wanted tile while the focus-site budget has no room for the replacement", () => {
    const anchor = { x: 25, y: 25 };
    const wantedExt = allNonRoadStructuresAt(anchor, 2).find(s => s.type === "extension")!;
    const blocker: SnapStructure = { x: wantedExt.x, y: wantedExt.y, type: "rampart" };
    // 20 open sites elsewhere already exhaust FOCUS_SITE_CAP, so the extension's replacement site
    // can never place this tick — the blocker must be left standing, not demolished ahead of need.
    const sites: SnapStructure[] = Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: 0,
      type: "extension" as const
    }));

    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 2,
        structures: [blocker],
        sites,
        siteSummary: sites.map(s => ({ room: "W1N1", type: s.type }))
      })
    );

    const intents = snap.building();
    expect(intents.filter(i => i.kind === "placeSite")).toEqual([]);
    expect(
      intents.some(i => i.kind === "removeStructure" && i.x === blocker.x && i.y === blocker.y)
    ).toBe(false);
  });

  it("still demolishes a structure nobody wants at all, even at the focus-site budget cap", () => {
    const anchor = { x: 25, y: 25 };
    // (35,35) is nowhere in the goal layout — genuinely stale, not blocking any pending placement.
    const stale: SnapStructure = { x: 35, y: 35, type: "tower" };
    const sites: SnapStructure[] = Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: 0,
      type: "extension" as const
    }));

    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 2,
        structures: [stale],
        sites,
        siteSummary: sites.map(s => ({ room: "W1N1", type: s.type }))
      })
    );

    const removals = snap.building().filter(i => i.kind === "removeStructure");
    expect(removals).toEqual([{ kind: "removeStructure", room: "W1N1", x: 35, y: 35, type: "tower" }]);
  });
});

// Focused construction: at most 2 open sites at once, a type priority for which 2,
// and no roads before 800 energy capacity (RCL3 with all extensions).
describe("building planner focus policy", () => {
  const anchor = { x: 25, y: 25 };
  const placeSites = (intents: Intent[]) =>
    intents.filter((i): i is Extract<Intent, { kind: "placeSite" }> => i.kind === "placeSite");

  it("places at most 20 construction sites at a time", () => {
    // RCL3's non-road backlog from empty exceeds the cap, so the cap itself is what's under test.
    const snap = colony(colonySnap({ anchor, controllerLevel: 8, structures: [], sites: [] }));

    expect(placeSites(snap.building()).length).toBeLessThanOrEqual(20);
    expect(placeSites(snap.building()).length).toBe(20);
  });

  it("counts existing sites against the cap of 20", () => {
    const nineteenOpen: SnapStructure[] = Array.from({ length: 19 }, (_, i) => ({
      x: i,
      y: 10,
      type: "road" as const
    }));
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 8,
        structures: [],
        sites: nineteenOpen,
        siteSummary: nineteenOpen.map(s => ({ room: "W1N1", type: s.type }))
      })
    );

    expect(placeSites(snap.building())).toHaveLength(1);
  });

  it("opens at most one container site at a time even when mining declares two", () => {
    // Everything higher-priority already built, two sources → two container claims compete for the focus slots.
    const built = allNonRoadStructuresAt(anchor, 3);
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [sourceAt(20, 10), sourceAt(30, 40)],
        structures: built,
        sites: []
      })
    );

    const placed = placeSites(snap.building());
    expect(placed.filter(i => i.type === "container")).toHaveLength(1);
  });

  it("opens no new container site while one is already under construction", () => {
    const built = allNonRoadStructuresAt(anchor, 3);
    const base = colonySnap({
      anchor,
      controllerLevel: 3,
      energyCapacity: 800,
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      structures: built,
      sites: []
    });
    const [firstContainer] = minedStructures(base);
    const snap = colony({
      ...base,
      sites: [{ x: firstContainer.x, y: firstContainer.y, type: "container" }],
      siteSummary: [{ room: "W1N1", type: "container" }]
    });

    const placed = placeSites(snap.building());
    expect(placed.some(i => i.type === "container")).toBe(false);
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
        energyCapacity: 800,
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
    // Squeeze the home-room budget down to 1 (19 home-room sites already open) so extensions and
    // the container claim genuinely compete for a single slot. Crowding must be in the colony's own
    // room (W1N1) — a remote room's backlog has its own separate budget and must not starve home
    // placement (see "building planner — remote construction" below).
    const crowding = Array.from({ length: 19 }, (_, i) => ({ room: "W1N1", type: "rampart" as const }));
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [sourceAt(20, 10)],
        structures: withTower,
        sites: [],
        siteSummary: crowding
      })
    );
    const placed = placeSites(snap.building());
    expect(placed).toHaveLength(1);
    expect(placed[0].type).toBe("extension");
  });

  it("places no roads below 800 energy capacity", () => {
    for (const capacity of [300, 550, 799]) {
      // No local source: isolates the bunker's own road grid from Mining's source-access roads,
      // which are deliberately exempt from this gate (see the bypass test below).
      const snap = colony(
        colonySnap({ anchor, controllerLevel: 3, energyCapacity: capacity, sources: [], structures: [], sites: [] })
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

  // Once Mining claims (at its 800 container gate), building.ts places the claimed source-access roads
  // via gateRoads' claimed-bypass — a claimed road is kept even where it doesn't neighbour a served
  // structure, which the plain adjacency gate would strip out. claimed is the gate.
  it("mining's source-access roads bypass building.ts's road adjacency gate", () => {
    const base = colonySnap({
      anchor,
      controllerLevel: 3,
      energyCapacity: 800,
      sources: [sourceAt(20, 10)],
      structures: allNonRoadStructuresAt(anchor, 3),
      sites: []
    });
    const nonRoadClaims = minedStructures(base)
      .filter(p => p.type !== "road")
      .map(p => ({ x: p.x, y: p.y, type: p.type }));
    const snap = colony({ ...base, structures: [...base.structures, ...nonRoadClaims] });

    const placed = placeSites(snap.building());
    expect(placed.some(i => i.type === "road")).toBe(true);
  });
});

// A remote route reuses the same claim/placement pipeline as a local source, but the arbiter must
// target the tile's own room, dedup against remote-room vision (not the home room's structures/sites),
// and count the shared budget from siteSummary rather than the home-only sites count.
describe("building planner — remote construction", () => {
  const anchor = { x: 25, y: 25 };
  const placeSites = (intents: Intent[]) =>
    intents.filter((i): i is Extract<Intent, { kind: "placeSite" }> => i.kind === "placeSite");
  const route = [
    { room: "W1N1", x: 26, y: 25 },
    { room: "W2N1", x: 0, y: 25 },
    { room: "W2N1", x: 1, y: 25 } // container spot
  ];
  const built = allNonRoadStructuresAt(anchor, 3);

  it("places a remote claim's site in its own room, not the colony's home room", () => {
    const source = remoteSourceAt(2, 25, "W2N1", { route });
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [],
        structures: built,
        sites: [],
        remoteSources: [source],
        remoteStructures: { W2N1: [] }
      })
    );

    const placed = placeSites(snap.building());
    expect(placed).toContainEqual(
      expect.objectContaining({ room: "W2N1", x: 1, y: 25, type: "container" })
    );
  });

  it("does not re-place a remote structure that's already built", () => {
    const source = remoteSourceAt(2, 25, "W2N1", { route });
    const remoteContainer: SnapStructure = { id: "cont1" as Id<StructureContainer>, x: 1, y: 25, type: "container" };
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [],
        structures: built,
        sites: [],
        remoteSources: [source],
        remoteStructures: { W2N1: [remoteContainer] }
      })
    );

    const placed = placeSites(snap.building());
    expect(placed.some(i => i.room === "W2N1" && i.type === "container")).toBe(false);
  });

  it("counts a remote site against the remote budget even without live vision of its room this tick", () => {
    // Remote crowding (20 open remote-room sites, from siteSummary alone — no live vision of any of
    // these rooms this tick) must exhaust the *remote* budget without touching the home-room budget:
    // a remote route's backlog must never starve home-room placement (extensions, towers, ...).
    const crowding = Array.from({ length: 20 }, () => ({ room: "W9N9", type: "rampart" as const }));
    const source = remoteSourceAt(2, 25, "W2N1", { route });
    const withTower = built.filter(s => s.type === "tower");
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 300,
        sources: [],
        structures: withTower,
        sites: [],
        remoteSources: [source],
        remoteStructures: { W2N1: [] },
        siteSummary: [...crowding, { room: "W2N1", type: "container" }]
      })
    );

    const placed = placeSites(snap.building());
    // The remote container claim is blocked — its room's budget is spent.
    expect(placed.some(i => i.room === "W2N1")).toBe(false);
    // Home-room placement proceeds unaffected by the remote-room crowding.
    expect(placed.some(i => i.room === "W1N1")).toBe(true);
  });

  // Regression coverage for the E28S4 incident: an unarmed scout's mere presence flipped danger,
  // Mining dropped its whole route's claim, and building.ts's demolition read the already-built
  // home-room-leg road as stale and tore down the entire route. Danger must now only stop a site
  // going up (and a builder being sent) IN the remote room — the claim itself, and the home-room
  // leg's construction, must be unaffected.
  it("does not place a site in a dangerous remote room, but still builds the route's home-room leg", () => {
    const source = remoteSourceAt(2, 25, "W2N1", { route, danger: 1 });
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [],
        structures: built,
        sites: [],
        remoteSources: [source],
        remoteStructures: { W2N1: [] }
      })
    );

    const placed = placeSites(snap.building());
    expect(placed.some(i => i.room === "W2N1")).toBe(false);
    expect(placed).toContainEqual(expect.objectContaining({ room: "W1N1", x: 26, y: 25, type: "road" }));
  });

  it("does not place a site in a remote room reserved by someone else, but still builds the home-room leg", () => {
    const source = remoteSourceAt(2, 25, "W2N1", { route, reservedBy: "SomePlayer" });
    const snap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [],
        structures: built,
        sites: [],
        remoteSources: [source],
        remoteStructures: { W2N1: [] }
      })
    );

    const placed = placeSites(snap.building());
    expect(placed.some(i => i.room === "W2N1")).toBe(false);
    expect(placed).toContainEqual(expect.objectContaining({ room: "W1N1", x: 26, y: 25, type: "road" }));
  });

  // The actual W8N3 incident: a remote source that was selected, built out (home-leg road + remote
  // container/road), then dropped from colony.remoteSources entirely (pickRemotes' reevaluate branch
  // evicting it — see mining/pickRemotes.ts — or a scenario where the source simply no longer scouts as
  // worthwhile). Mining.structures() only claims tiles for sources still in colony.remoteSources (see
  // mining.ts's structures(), the `for (const source of colony.remoteSources)` loop), so an evicted
  // source's entire route drops out of `claimed` the very next tick, home-room leg included.
  describe("after a remote source is evicted from colony.remoteSources", () => {
    // No remoteSources at all — as if the source that built this route has since been dropped.
    // The home-room leg (26,25) is a real, already-built road; nothing claims it any more.
    const evictedSnap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [],
        // Home-room leg's road, already built while the source was still selected.
        structures: [...built, { x: 26, y: 25, type: "road" }],
        sites: [],
        remoteSources: [], // evicted: no longer selected
        remoteStructures: {}
      })
    );

    it("demolishes the orphaned home-room-leg road as unwanted stale structure — this is the actual bug", () => {
      // This documents CURRENT (buggy) behavior: once a source drops out of colony.remoteSources,
      // Mining no longer claims its home-room-leg road at all, so placeAndDemolish's stale/unwanted
      // check (building.ts's `unwanted` filter) has nothing shielding it and tears it down — even
      // though the physical road is still standing and perfectly serviceable. This is the mechanism
      // that destroys W8N3's roads: eviction, not hostiles/danger/reservation.
      const removals = evictedSnap.building().filter(i => i.kind === "removeStructure");
      expect(removals).toContainEqual({ kind: "removeStructure", room: "W1N1", x: 26, y: 25, type: "road" });
    });

    it("never emits a removeStructure for a remote room's own structures, even after eviction", () => {
      // placeAndDemolish only ever inspects colony.structures (home room) for staleness — a remote
      // room's own already-built container/road is simply never considered for demolition by this
      // arbiter at all (see building.ts's structuresAt/roomOf). So the remote room's own structures
      // are orphaned (unmaintained, unclaimed) rather than actively torn down.
      const removals = evictedSnap.building().filter(i => i.kind === "removeStructure");
      expect(removals.every(r => r.room === "W1N1")).toBe(true);
    });

    it("stops claiming the evicted source's route at all (structures() returns nothing for it)", () => {
      const claims = minedStructures(evictedSnap.snapshot);
      expect(claims).toEqual([]);
    });
  });
});

// The arbiter finishes one source's entire claimed group (container + its road tiles) before opening
// sites for another's — MAX_CONTAINER_SITES already serialized containers this way; this generalizes it
// to whole routes, local and remote alike, via PlacedStructure.sourceId.
describe("building planner — one source group at a time", () => {
  const anchor = { x: 25, y: 25 };
  const groupA = [
    { x: 30, y: 25, type: "container" as const, sourceId: "srcA" as Id<Source> },
    { x: 31, y: 25, type: "road" as const, sourceId: "srcA" as Id<Source> }
  ];
  const groupB = [
    { x: 40, y: 25, type: "container" as const, sourceId: "srcB" as Id<Source> },
    { x: 41, y: 25, type: "road" as const, sourceId: "srcB" as Id<Source> }
  ];

  it("holds back a later group's claims entirely while an earlier group is unbuilt", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, structures: [], sites: [] });

    const claimed: PlacedStructure[] = [...groupA, ...groupB];
    const wanted = wantedStructures(snap, claimed);

    expect(wanted.some(p => p.sourceId === "srcA")).toBe(true);
    expect(wanted.some(p => p.sourceId === "srcB")).toBe(false);
  });

  it("releases the next group once the earlier one is fully built", () => {
    const snap = colonySnap({
      anchor,
      controllerLevel: 3,
      energyCapacity: 800,
      // Group A's tiles are both already standing.
      structures: groupA.map(p => ({ x: p.x, y: p.y, type: p.type })),
      sites: []
    });

    const claimed: PlacedStructure[] = [...groupA, ...groupB];
    const wanted = wantedStructures(snap, claimed);

    expect(wanted.some(p => p.sourceId === "srcB")).toBe(true);
  });

  it("never holds back an ungrouped claim (no sourceId), regardless of group state", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, structures: [], sites: [] });
    const ungrouped: PlacedStructure = { x: 35, y: 25, type: "extension" };

    const claimed: PlacedStructure[] = [...groupA, ...groupB, ungrouped];
    const wanted = wantedStructures(snap, claimed);

    expect(wanted).toContainEqual(ungrouped);
  });

  it("throttleGroups: false includes every group's claims, not just the in-progress one — for the metrics panel's denominator", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, structures: [], sites: [] });

    const claimed: PlacedStructure[] = [...groupA, ...groupB];
    const wanted = wantedStructures(snap, claimed, false);

    expect(wanted.some(p => p.sourceId === "srcA")).toBe(true);
    expect(wanted.some(p => p.sourceId === "srcB")).toBe(true);
  });
});

// Once construction is genuinely finished (not merely paused between placements), a builder that would
// otherwise drop-mine out its remaining life is converted: to a repairer while anything is decaying,
// else to an upgrader. maintainWorkforce() runs every tick and reuses the same backlog derivation.
describe("idle-builder repurposing", () => {
  const anchor = { x: 25, y: 25 };

  // The fully-built RCL2 colony: every buildable structure plus mining's containers present, no sites.
  function finishedColony(over: Partial<ColonySnapshot> = {}): ColonySnapshot {
    const base = colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [], ...over });
    const containers: SnapStructure[] = minedStructures(base).map(c => ({ x: c.x, y: c.y, type: c.type }));
    return { ...base, structures: [...allNonRoadStructuresAt(anchor, 2), ...containers], ...over };
  }

  const roleChanges = (intents: Intent[]) =>
    intents.filter((i): i is Extract<Intent, { kind: "setCreepRole" }> => i.kind === "setCreepRole");

  it("converts an idle builder to upgrader when construction is finished and nothing is damaged", () => {
    const snap = colony({ ...finishedColony(), creeps: [snapCreep("builder")] });

    const changes = roleChanges(snap.maintainWorkforce());
    expect(changes).toHaveLength(1);
    expect(changes[0].role).toBe("upgrader");
  });

  it("converts an idle builder to repair when a structure has decayed past the repair floor", () => {
    const finished = finishedColony();
    // Damage one built structure below 80% hits.
    const damaged = finished.structures.map((s, i) =>
      i === 0 ? { ...s, hits: 100, hitsMax: 1000 } : s
    );
    const snap = colony({ ...finished, structures: damaged, creeps: [snapCreep("builder")] });

    const changes = roleChanges(snap.maintainWorkforce());
    expect(changes).toHaveLength(1);
    expect(changes[0].role).toBe("repair");
  });

  it("does NOT convert while construction sites are still open", () => {
    const snap = colony({
      ...finishedColony(),
      sites: [{ x: 1, y: 0, type: "extension" }],
      creeps: [snapCreep("builder")]
    });

    expect(snap.maintainWorkforce()).toEqual([]);
  });

  it("does NOT convert while the planner backlog still has unbuilt structures (between placements)", () => {
    // A room that is NOT fully built and has zero sites right now: exactly the between-placements gap
    // the focus cap creates. constructionProgress is 0, sites are empty, yet real work remains.
    const snap = colony(
      colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [], creeps: [snapCreep("builder")] })
    );

    expect(snap.maintainWorkforce()).toEqual([]);
  });

  it("leaves non-builder creeps alone", () => {
    const snap = colony({
      ...finishedColony(),
      creeps: [snapCreep("upgrader"), snapCreep("miner"), snapCreep("hauler")]
    });

    expect(snap.maintainWorkforce()).toEqual([]);
  });

  // hasOutstandingConstruction's fast path checks the bunker layout by COUNT, but falls back to checking
  // `claimed` (operation claims — remote routes etc.) item by item, since those aren't RCL-capped/
  // substituted the same way (see that function's own doc). A bunker-complete colony with an unbuilt
  // remote container must still read as having outstanding construction.
  it("does NOT convert while a remote operation claim (e.g. a mining container) is still unbuilt", () => {
    const route = [
      { room: "W1N1", x: 26, y: 25 },
      { room: "W2N1", x: 0, y: 25 },
      { room: "W2N1", x: 1, y: 25 }
    ];
    const source = remoteSourceAt(2, 25, "W2N1", { route });
    // energyCapacity must clear Mining's own structuresFromEnergyCapacity gate (550) or it claims
    // nothing at all regardless of the remote source being selected — see mining.ts's structures().
    const snap = colony({
      ...finishedColony({ energyCapacity: 800, remoteSources: [source], remoteStructures: { W2N1: [] } }),
      creeps: [snapCreep("builder")]
    });

    expect(snap.maintainWorkforce()).toEqual([]);
  });

  it("ignores a structure that is damaged but still above the repair floor (converts to upgrader)", () => {
    const finished = finishedColony();
    // 90% hits — damaged, but not past the 0.8 repair floor.
    const lightlyHurt = finished.structures.map((s, i) =>
      i === 0 ? { ...s, hits: 900, hitsMax: 1000 } : s
    );
    const snap = colony({ ...finished, structures: lightlyHurt, creeps: [snapCreep("builder")] });

    const changes = roleChanges(snap.maintainWorkforce());
    expect(changes).toHaveLength(1);
    expect(changes[0].role).toBe("upgrader");
  });

  // hasOutstandingConstruction's fast path (src/colony/building.ts) answers this with a per-type COUNT
  // comparison, not positions — deliberately correct even though substituteBlockedCapped exists to swap a
  // spawn-blocked slot for a different same-type tile elsewhere in the full RCL8 goal (see that function's
  // own doc): the count never needs to know WHICH tile satisfies the cap, only that enough of the type
  // exist. This proves that holds — a spawn squatting on one wanted extension tile, with the RCL's full
  // extension count otherwise satisfied by a substitute placement, must still read as finished.
  it("converts an idle builder when a spawn blocks one wanted extension tile but the count is satisfied by a substitute", () => {
    const finished = finishedColony();
    const extensionSlot = finished.structures.find(s => s.type === "extension")!;
    // Swap that one extension for a spawn on the same tile, and add a real extension at a tile the RCL2
    // goal doesn't itself list — the same shape substituteBlockedCapped's own replacement would produce.
    const withBlockerAndSubstitute: SnapStructure[] = [
      ...finished.structures.filter(s => s !== extensionSlot),
      { x: extensionSlot.x, y: extensionSlot.y, type: "spawn" },
      { x: extensionSlot.x + 5, y: extensionSlot.y + 5, type: "extension" }
    ];
    const snap = colony({ ...finished, structures: withBlockerAndSubstitute, creeps: [snapCreep("builder")] });

    const changes = roleChanges(snap.maintainWorkforce());
    expect(changes).toHaveLength(1);
    expect(changes[0].role).toBe("upgrader");
  });

  // Same setup, but WITHOUT the substitute extension — the count genuinely falls short by one, so
  // construction must still read as outstanding (the builder must NOT convert).
  it("does NOT convert when a spawn blocks a wanted extension tile with no substitute built", () => {
    const finished = finishedColony();
    const extensionSlot = finished.structures.find(s => s.type === "extension")!;
    const withBlockerOnly: SnapStructure[] = [
      ...finished.structures.filter(s => s !== extensionSlot),
      { x: extensionSlot.x, y: extensionSlot.y, type: "spawn" }
    ];
    const snap = colony({ ...finished, structures: withBlockerOnly, creeps: [snapCreep("builder")] });

    expect(snap.maintainWorkforce()).toEqual([]);
  });

  // hasOutstandingConstruction's expensive fallback (bunkerBacklogRemains + claimed.some) is cached
  // cross-tick in ColonyMemory.outstandingConstructionCache, keyed by a fingerprint of everything that
  // could change the real answer (see outstandingConstructionFingerprint's own doc). These two tests
  // prove the cache is actually consulted, not just present and unused: a deliberately WRONG cached
  // value under a MATCHING fingerprint must win (proving a real cache hit occurs), while the same wrong
  // value under a fingerprint that no longer matches must be ignored and recomputed correctly.
  describe("cross-tick cache", () => {
    const unfinished = colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [], creeps: [snapCreep("builder")] });

    function fingerprintFor(snap: ColonySnapshot): string {
      // Mirrors outstandingConstructionFingerprint's own join exactly — claimed is empty for this
      // RCL2/no-remotes fixture (Mining's own gate needs energyCapacity>=550, not met here — see the
      // remote-claim test above), matching what maintainWorkforce's real call site passes.
      return [snap.structures.length, snap.sites.length, snap.siteSummary.length, snap.energyCapacity, snap.controllerLevel, 0].join(",");
    }

    it("uses a cached value when the fingerprint still matches, even if the cached value is stale/wrong", () => {
      (globalThis as unknown as { Memory: { colonies: Record<string, unknown> } }).Memory = {
        colonies: {
          W1N1: { outstandingConstructionCache: { fingerprint: fingerprintFor(unfinished), value: false } }
        }
      };
      const snap = colony(unfinished);

      // The real backlog is genuinely non-empty (an RCL2 room with zero structures) — a fresh
      // computation would say "outstanding" and never convert. The cache says otherwise; if it's
      // actually being read, that wrong answer wins and the builder converts.
      const changes = snap.maintainWorkforce();
      expect(changes).not.toEqual([]);
    });

    it("ignores a cached value once the fingerprint no longer matches (recomputes correctly)", () => {
      (globalThis as unknown as { Memory: { colonies: Record<string, unknown> } }).Memory = {
        colonies: {
          // A fingerprint from a DIFFERENT colony state (structures.length off by one) — must not match.
          W1N1: { outstandingConstructionCache: { fingerprint: "999,0,0,300,2,0", value: false } }
        }
      };
      const snap = colony(unfinished);

      expect(snap.maintainWorkforce()).toEqual([]);
    });
  });
});

// The metrics panel's ENTIRE "Buildings" data source is ColonyMemory.buildingCounts, written by
// planBuilding (colony/building.ts) as a side effect of building() — never computed by metrics.ts itself
// (colony/index.ts's metrics() just reads Memory.colonies[name].buildingCounts ?? []). These tests stub a
// global Memory (same pattern as the "cross-tick cache" describe block below) and drive the real
// colony(...).building() call, so they exercise the actual write path rather than a helper's own
// isolated computation.
describe("ColonyMemory.buildingCounts (metrics panel source, written by building())", () => {
  const anchor = { x: 25, y: 25 };

  function stubMemory(name: string): { colonies: Record<string, { buildingCounts?: BuildingCountRow[] }> } {
    const mem = { colonies: { [name]: {} } };
    (globalThis as unknown as { Memory: typeof mem }).Memory = mem;
    return mem;
  }

  it("writes built vs targeted per bunker-layout type at the current RCL", () => {
    const mem = stubMemory("W1N1");
    colony(colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [] })).building();

    const rows = mem.colonies.W1N1.buildingCounts!;
    const extension = rows.find(r => r.type === "extension");
    expect(extension).toBeDefined();
    expect(extension!.built).toBe(0);
    expect(extension!.targeted).toBeGreaterThan(0);
  });

  it("counts a built bunker structure against its type's target", () => {
    const targetMem = stubMemory("W1N1");
    colony(colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [] })).building();
    const targetCount = targetMem.colonies.W1N1.buildingCounts!.find(r => r.type === "extension")!.targeted;

    const mem = stubMemory("W1N1");
    const oneBuilt = colonySnap({
      anchor,
      controllerLevel: 2,
      structures: allNonRoadStructuresAt(anchor, 2).filter(s => s.type === "extension").slice(0, 1),
      sites: []
    });
    colony(oneBuilt).building();
    const row = mem.colonies.W1N1.buildingCounts!.find(r => r.type === "extension")!;
    expect(row).toEqual({ type: "extension", built: 1, targeted: targetCount });
  });

  it("includes an operation's claimed structures (e.g. a remote container) in both built and targeted", () => {
    const before = stubMemory("W1N1");
    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, structures: [], sites: [] });
    const claimed = minedStructures(snap);
    expect(claimed.some(p => p.type === "container")).toBe(true);
    colony(snap).building();
    const beforeRow = before.colonies.W1N1.buildingCounts!.find(r => r.type === "container")!;
    expect(beforeRow.built).toBe(0);
    expect(beforeRow.targeted).toBeGreaterThan(0);

    const after = stubMemory("W1N1");
    const built = claimed.filter(p => p.type === "container").map(p => ({ x: p.x, y: p.y, type: p.type }));
    const withContainer = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, structures: built, sites: [] });
    colony(withContainer).building();
    const afterRow = after.colonies.W1N1.buildingCounts!.find(r => r.type === "container")!;
    expect(afterRow.built).toBe(built.length);
    expect(afterRow.targeted).toBe(beforeRow.targeted);
  });

  it("orders the most-remaining type first", () => {
    const mem = stubMemory("W1N1");
    colony(colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [] })).building();
    // Every row here starts at built:0, so remaining === targeted; the sort must be non-increasing by it.
    const remaining = mem.colonies.W1N1.buildingCounts!.map(r => r.targeted - r.built);
    expect(remaining).toEqual([...remaining].sort((a, b) => b - a));
  });

  it("does not write (or crash) when the colony has no anchor yet", () => {
    const mem = stubMemory("W1N1");
    colony(colonySnap({ anchor: null, controllerLevel: 1, structures: [], sites: [] })).building();
    expect(mem.colonies.W1N1.buildingCounts).toBeUndefined();
  });
});

