import { beforeEach, describe, expect, it } from "vitest";
import type { Intent } from "../../../src/intents/types";
import type { ColonySnapshot, SnapStructure } from "../../../src/snapshot/types";
import { colony } from "../../../src/colony";
import type { BuildingPlanEntry } from "../../../src/construction/planner";
import {
  claimsOf,
  findPath,
  resetFindPathCacheForTests,
  wantedStructures,
  ROADS_FROM_ENERGY_CAPACITY,
  type FindPath
} from "../../../src/construction/planner";
import { colonySnap, linkAt, openTerrain, remoteSourceAt, snapCreep, sourceAt } from "../../fixtures";
import { Mining } from "../../../src/operations/mining";
import { Upgrading } from "../../../src/operations/upgrading";
import { buildableAtRcl } from "../../../src/construction/goal";
import { stampLayout, type PlacedStructure } from "../../../src/construction/stamp";
import type { GoalLayout } from "../../../src/construction/sync";
import GOAL_JSON from "../../../src/construction/Base_2.json";
import type { XY } from "../../../src/lib/geometry";
import { stubPathFinderSingleRoom } from "../../constants";

beforeEach(() => {
  stubPathFinderSingleRoom();
  resetFindPathCacheForTests();
  // findPath's terrainFromGame needs Game.map.getRoomTerrain for any remote-room matrix. Deliberately
  // NOT the full stubGame() helper — this file's Memory-cache tests rely on `typeof Memory ===
  // "undefined"` being true except where a test stubs it itself (see hasOutstandingConstruction/
  // writeBuildingPlan's own typeof guards), and stubGame() always sets a global Memory.
  (globalThis as unknown as { Game: { map: { getRoomTerrain: (room: string) => { get(x: number, y: number): number } } } }).Game = {
    map: { getRoomTerrain: () => ({ get: () => 0 }) } // fully open room, every tile walkable
  };
});

const findPathFor = (snap: ColonySnapshot): FindPath => (from, to, range, opts) => findPath(snap, from, to, range, opts);

// What the colony's Mining operation claims — the same call planBuilding makes, so these tests
// assert the arbiter merges real operation demand rather than a re-stated copy of it.
const minedStructures = (snap: ColonySnapshot) => new Mining(snap.name).structures(snap, findPathFor(snap));

// Every non-road structure the goal permits at `rcl`, stamped at the anchor.
function allNonRoadStructuresAt(anchor: XY, rcl: number): SnapStructure[] {
  return stampLayout(buildableAtRcl(GOAL_JSON as GoalLayout, rcl), anchor)
    .filter(p => p.type !== "road")
    .map(p => ({ x: p.x, y: p.y, type: p.type }));
}

// claimsOf's own consolidate() step: dedup + container/rampart-over-road + exit-tile drop, exercised
// through real operations (not a hand-rolled claim list) so this proves the actual production seam —
// two operations' claims genuinely colliding at claimsOf's own call site — not just consolidate's
// isolated logic in a vacuum.
describe("claimsOf — consolidate (cross-operation dedup)", () => {
  it("drops a later operation's claim when it collides with an earlier one's DIFFERENT structure type", () => {
    const anchor = { x: 25, y: 25 };
    const source = sourceAt(20, 25); // straight line toward the anchor from the west
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const mining = new Mining("W1N1");
    const upgrading = new Upgrading("W1N1");
    // Mining runs first (operationsFor's real order): its container/road claims seed the matrix: run
    // both through the real claimsOf pipeline and confirm every resulting claim is unique per tile.
    const claimed = claimsOf(snap, [mining, upgrading]);

    const keys = claimed.map(p => `${p.room ?? "home"},${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Regression for the Upgrading controller-link exclusion hack this refactor deletes (see
  // operations/upgrading.ts's structures() doc): the matrix is seeded from terrain + bunker layout +
  // accumulated claims only, never colony.structures — so a link that's already BUILT (a real,
  // non-walkable obstacle in the engine) must not block Upgrading's own re-derivation of the exact
  // same tile as its next claim; it's already present in the claim set every pass re-derives.
  it("never seeds the matrix from colony.structures — a built (non-walkable) link is not an obstacle to re-deriving its own tile", () => {
    const anchor = { x: 25, y: 25 };
    const controller = { x: 25, y: 40 };
    const snap = colonySnap({ anchor, controller, controllerLevel: 5, energyCapacity: 800 });
    const upgrading = new Upgrading("W1N1");

    const firstPass = claimsOf(snap, [upgrading]);
    const link = firstPass.find(p => p.type === "link")!;
    expect(link).toBeDefined();

    // Same tile, but now genuinely built — a matrix keyed off colony.structures would treat this real
    // link as IMPASSABLE (links aren't walkable) and re-site a second one nearby instead.
    const builtLink = linkAt(link.x, link.y, 0);
    const built = colonySnap({
      anchor,
      controller,
      controllerLevel: 5,
      energyCapacity: 800,
      structures: [{ x: link.x, y: link.y, type: "link", id: builtLink.id }],
      links: [builtLink],
      linkNetwork: { controller: builtLink.id }
    });
    const secondPass = claimsOf(built, [upgrading]);
    const linkAgain = secondPass.find(p => p.type === "link");
    expect(linkAgain).toEqual(link);
  });
});

// stampLayout is pure anchor-relative offset math with no terrain awareness — a goal tile lands on
// whatever the real room's terrain happens to be at that offset. Confirmed live on W45N17 2026-08-14:
// Game.map.getRoomTerrain('W45N17').get(8,15) === TERRAIN_MASK_WALL, yet the bunker grid's plain road
// (no sourceId) wanted a road there, sitting forever as an un-buildable "wanted" entry — a construction
// site can never actually go up on a wall tile, so nothing ever placed or cleared it.
describe("wantedStructures — bunker grid tiles that land on a wall", () => {
  it("drops a bunker-grid road claim whose tile is a real wall, but keeps the rest of the grid", () => {
    const anchor = { x: 25, y: 25 };
    const atRcl = buildableAtRcl(GOAL_JSON as GoalLayout, 3, { anchor, sources: [] });
    const roads = stampLayout(atRcl, anchor).filter(p => p.type === "road");
    expect(roads.length).toBeGreaterThan(1); // otherwise this test can't tell "dropped" from "never there"

    const wallTile = roads[0];
    const terrain = openTerrain();
    terrain[wallTile.x * 50 + wallTile.y] = 0; // 0 = wall, per ColonySnapshot.terrain's convention

    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, terrain, structures: [], sites: [] });
    const wanted = wantedStructures(snap, []);

    expect(wanted.some(p => p.x === wallTile.x && p.y === wallTile.y && p.type === "road")).toBe(false);
    expect(wanted.some(p => p.type === "road")).toBe(true); // sibling road tiles still stand
  });

  it("never drops an operation's own claimed tile (already terrain-aware via its own pathfinder)", () => {
    const anchor = { x: 25, y: 25 };
    const claimedOnWall: PlacedStructure = { x: anchor.x + 30, y: anchor.y, type: "road", sourceId: "srcA" as Id<Source> };
    const terrain = openTerrain();
    terrain[claimedOnWall.x * 50 + claimedOnWall.y] = 0;

    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, terrain, structures: [], sites: [] });
    const wanted = wantedStructures(snap, [claimedOnWall]);

    expect(wanted).toContainEqual(claimedOnWall);
  });
});

// The pathing-matrix half of the same defect documented above: stampLayout's bunker grid has no terrain
// awareness, so seedMatrixFor's layout stamp (applyClaimToMatrix) could previously downgrade a real wall
// tile to ROAD_COST/walkable wherever a bunker-grid road happened to land on one — letting findPath's
// search tunnel straight through a wall it should have routed around. wantedStructures' own `walkable`
// filter (tested above) only ever protected the site-placement list; it never touched the matrix findPath
// itself searches against.
describe("findPath — bunker grid tiles that land on a wall", () => {
  it("never lets a bunker-grid road claim downgrade a real wall tile to walkable", () => {
    const anchor = { x: 25, y: 25 };
    const atRcl = buildableAtRcl(GOAL_JSON as GoalLayout, 3, { anchor, sources: [] });
    const roads = stampLayout(atRcl, anchor).filter(p => p.type === "road");
    expect(roads.length).toBeGreaterThan(1);

    // Wall off one bunker-grid road tile, and every tile on the opposite (short, direct) side of it, so
    // the only way through is either straight across the wall (if the bug lets the claim un-wall it) or
    // all the way around the bunker footprint (if the fix holds).
    const wallTile = roads[0];
    const terrain = openTerrain();
    terrain[wallTile.x * 50 + wallTile.y] = 0;

    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, terrain, structures: [], sites: [] });

    const from = new RoomPosition(wallTile.x - 1, wallTile.y, "W1N1");
    const to = new RoomPosition(wallTile.x + 1, wallTile.y, "W1N1");
    const route = findPath(snap, from, to, 0);

    expect(route.path.some(p => p.x === wallTile.x && p.y === wallTile.y)).toBe(false);
  });
});

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
    // The home-room leg's road is a real, already-built road; nothing claims it any more. Its tile
    // (45,25) is deliberately far outside the bunker's own goal-layout footprint (BUNKER_RADIUS=6 of
    // anchor) — unlike the describe block's shared `route` (whose (26,25) home-room leg happens to
    // coincide with the goal layout's own storage slot, at anchor offset (1,0)), so this fixture isn't
    // shielded by that unrelated coincidence and genuinely tests the unwanted/stale demolition path.
    const evictedSnap = colony(
      colonySnap({
        anchor,
        controllerLevel: 3,
        energyCapacity: 800,
        sources: [],
        // Home-room leg's road, already built while the source was still selected.
        structures: [...built, { x: 45, y: 25, type: "road" }],
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
      expect(removals).toContainEqual({ kind: "removeStructure", room: "W1N1", x: 45, y: 25, type: "road" });
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

  // hasOutstandingConstruction's fast path (src/construction/planner.ts) answers this with a per-type COUNT
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

// The metrics panel's ENTIRE "Buildings" data source is ColonyMemory.buildingPlan, written by
// planBuilding (construction/planner.ts) as a side effect of building() — never computed or re-derived by any
// reader. Critically, this must be the FINAL, fully-gated positional plan (same list placeAndDemolish
// itself places sites from — gateSourceGroups, gateRoads' adjacency gate, substituteBlockedCapped, exit
// tiles via the goal layout), not a cheaper re-derivation: a hand-rolled reimplementation of "what does
// the plan want" (e.g. replaying buildableAtRcl+stampLayout alone) silently drifts from the real answer
// the moment one of those gates applies — confirmed live 2026-08-13 when an ad-hoc missing-roads report
// built that way reported tiles as missing that gateRoads' adjacency gate correctly excludes. These tests
// stub a global Memory (same pattern as the "cross-tick cache" describe block below) and drive the real
// colony(...).building() call, so they exercise the actual write path against the actual gated output,
// not an isolated helper's approximation of it.
describe("ColonyMemory.buildingPlan (metrics panel source, written by building())", () => {
  const anchor = { x: 25, y: 25 };

  function stubMemory(name: string): { colonies: Record<string, { buildingPlan?: BuildingPlanEntry[]; roadsBuilt?: boolean }> } {
    const mem = { colonies: { [name]: {} } };
    (globalThis as unknown as { Memory: typeof mem }).Memory = mem;
    return mem;
  }

  it("caches every entry with its full position (type, x, y, room) and resolved built status", () => {
    const mem = stubMemory("W1N1");
    colony(colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [] })).building();

    const plan = mem.colonies.W1N1.buildingPlan!;
    expect(plan.length).toBeGreaterThan(0);
    const extension = plan.find(p => p.type === "extension")!;
    expect(extension).toMatchObject({ room: "W1N1", built: false });
    expect(typeof extension.x).toBe("number");
    expect(typeof extension.y).toBe("number");
  });

  it("resolves built:true for a structure that's actually standing, via the real builtAt predicate", () => {
    const mem = stubMemory("W1N1");
    const oneBuilt = colonySnap({
      anchor,
      controllerLevel: 2,
      structures: allNonRoadStructuresAt(anchor, 2).filter(s => s.type === "extension").slice(0, 1),
      sites: []
    });
    colony(oneBuilt).building();
    const plan = mem.colonies.W1N1.buildingPlan!;
    expect(plan.filter(p => p.type === "extension" && p.built)).toHaveLength(1);
    expect(plan.filter(p => p.type === "extension" && !p.built).length).toBeGreaterThan(0);
  });

  it("includes an operation's claimed structures (e.g. a remote container) with their sourceId", () => {
    const mem = stubMemory("W1N1");
    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: 800, structures: [], sites: [] });
    // The real claimed set building() uses — every default operation's structures(), not just Mining's —
    // so this matches writeBuildingPlan's own claimsOf(colony, operations) call exactly.
    const claimed = claimsOf(snap, colony(snap).operations);
    expect(claimed.some(p => p.type === "container")).toBe(true);
    colony(snap).building();

    const plan = mem.colonies.W1N1.buildingPlan!;
    const containers = plan.filter(p => p.type === "container");
    expect(containers.length).toBe(claimed.filter(p => p.type === "container").length);
    // Mining's source containers carry a sourceId; Upgrading's own controller-container claim (also
    // present here, below linkRcl) legitimately doesn't — so at least one, not every, container has one.
    expect(containers.some(c => c.sourceId !== undefined)).toBe(true);
    expect(containers.every(c => !c.built)).toBe(true);
  });

  it("excludes a bunker road that isn't adjacent to any served structure yet (gateRoads' own gate), matching wantedStructures exactly", () => {
    const mem = stubMemory("W1N1");
    const snap = colonySnap({ anchor, controllerLevel: 2, energyCapacity: 800, structures: [], sites: [] });
    colony(snap).building();

    const plan = mem.colonies.W1N1.buildingPlan!;
    const planRoads = new Set(plan.filter(p => p.type === "road").map(p => `${p.x},${p.y}`));
    // Same claimed set writeBuildingPlan itself derives — not an empty array — or this test would just be
    // re-proving the earlier bug (comparing against a DIFFERENT, easier claimed set than the real one).
    const claimed = claimsOf(snap, colony(snap).operations);
    const realRoads = new Set(wantedStructures(snap, claimed, false).filter(p => p.type === "road").map(p => `${p.x},${p.y}`));
    expect(planRoads).toEqual(realRoads);
  });

  it("does not write (or crash) when the colony has no anchor yet", () => {
    const mem = stubMemory("W1N1");
    colony(colonySnap({ anchor: null, controllerLevel: 1, structures: [], sites: [] })).building();
    expect(mem.colonies.W1N1.buildingPlan).toBeUndefined();
  });
});

// ColonyMemory.roadsBuilt — written alongside buildingPlan, in the same interval:100 pass, so
// spawn/bodyContext.ts can ask the planner directly ("are roads done") instead of re-deriving completion
// itself from colony.remoteSources' routeBuilt strings (the old, now-deleted allRemoteRoutesBuilt). Below
// the capacity gate roads are excluded from wantedStructures' own output entirely (see that function's
// roadReady filter), so an empty road list there must read as "not asked for yet", not "done" — these
// tests cover that distinction explicitly.
describe("ColonyMemory.roadsBuilt (spawn/bodyContext.ts's road-readiness source)", () => {
  const anchor = { x: 25, y: 25 };

  function stubMemory(name: string): { colonies: Record<string, { roadsBuilt?: boolean }> } {
    const mem = { colonies: { [name]: {} } };
    (globalThis as unknown as { Memory: typeof mem }).Memory = mem;
    return mem;
  }

  it("is false below the energyCapacity gate, even though no road is 'wanted' yet to fail against", () => {
    const mem = stubMemory("W1N1");
    const snap = colonySnap({ anchor, controllerLevel: 2, energyCapacity: ROADS_FROM_ENERGY_CAPACITY - 1, structures: [], sites: [] });
    colony(snap).building();
    expect(mem.colonies.W1N1.roadsBuilt).toBe(false);
  });

  it("is false once past the gate while any planned road is still unbuilt", () => {
    const mem = stubMemory("W1N1");
    const snap = colonySnap({ anchor, controllerLevel: 3, energyCapacity: ROADS_FROM_ENERGY_CAPACITY, structures: [], sites: [] });
    colony(snap).building();
    expect(mem.colonies.W1N1.roadsBuilt).toBe(false);
  });

  it("is true once every planned road (bunker layout + every operation's own claims) is standing", () => {
    const mem = stubMemory("W1N1");
    // Two-pass: derive the full plan against an empty room first (matching writeBuildingPlan's own
    // wantedStructures(colony, claimed, false) call), then build every road the plan wants and confirm
    // roadsBuilt flips true — proving the check covers operation-claimed roads too, not just the bunker's.
    const empty = colonySnap({ anchor, controllerLevel: 3, energyCapacity: ROADS_FROM_ENERGY_CAPACITY, structures: [], sites: [] });
    const claimed = claimsOf(empty, colony(empty).operations);
    const allWantedRoads = wantedStructures(empty, claimed, false).filter(p => p.type === "road");
    const nonRoads = wantedStructures(empty, claimed, false).filter(p => p.type !== "road");

    const snap = colonySnap({
      anchor,
      controllerLevel: 3,
      energyCapacity: ROADS_FROM_ENERGY_CAPACITY,
      structures: [...nonRoads, ...allWantedRoads],
      sites: []
    });
    colony(snap).building();
    expect(mem.colonies.W1N1.roadsBuilt).toBe(true);
  });
});

