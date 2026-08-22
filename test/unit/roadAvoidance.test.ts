import { beforeEach, describe, expect, it, vi } from "vitest";
import { stepOffRoad } from "../../src/behaviors/roadAvoidance";
import { clearTiles, stubTile } from "../constants";
import { stubGame } from "../helpers";

const ROOM = "W1N1";
const OPEN_TERRAIN = { getTerrain: () => ({ get: () => 0 }) };

function creepAt(x: number, y: number): Creep & { travelTo: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn> } {
  return {
    id: "me",
    pos: new RoomPosition(x, y, ROOM),
    travelTo: vi.fn(),
    move: vi.fn()
  } as unknown as Creep & { travelTo: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  stubGame({ rooms: { [ROOM]: OPEN_TERRAIN } });
  clearTiles();
});

// stepOffRoad only bothers evacuating when a road-using ("mover") creep is within range to want the
// tile — stub one nearby (a transport creep, whose Role.mover is true) for every test that expects a
// step off.
function stubNearbyMover(roomName: string, x: number, y: number): void {
  stubTile(roomName, x, y, { creep: [{ id: "mover", memory: { role: "transport" } }] });
}

describe("stepOffRoad", () => {
  it("does nothing when the creep is not standing on a road", () => {
    const creep = creepAt(25, 25);

    stepOffRoad(creep, new RoomPosition(25, 25, ROOM), 3);

    expect(creep.travelTo).not.toHaveBeenCalled();
  });

  it("does nothing when standing on a road but no mover creep is nearby to want it", () => {
    stubTile(ROOM, 25, 25, { structure: [{ structureType: STRUCTURE_ROAD }] });
    const creep = creepAt(25, 25);

    stepOffRoad(creep, new RoomPosition(25, 25, ROOM), 3);

    expect(creep.travelTo).not.toHaveBeenCalled();
  });

  it("steps onto the nearest free non-road tile in range when standing on a road and a mover is nearby", () => {
    stubTile(ROOM, 25, 25, { structure: [{ structureType: STRUCTURE_ROAD }] });
    stubNearbyMover(ROOM, 27, 27);
    const creep = creepAt(25, 25);

    stepOffRoad(creep, new RoomPosition(25, 25, ROOM), 3);

    expect(creep.travelTo).toHaveBeenCalledTimes(1);
    const dest = (creep.travelTo.mock.calls[0] as [RoomPosition])[0];
    expect(dest.isEqualTo(new RoomPosition(25, 25, ROOM))).toBe(false);
    // The nearest non-road tile is one of the 8 immediate neighbours.
    expect(Math.max(Math.abs(dest.x - 25), Math.abs(dest.y - 25))).toBe(1);
  });

  it("stays put when every tile in range is a road, a wall, or occupied by another creep", () => {
    stubGame({ rooms: { [ROOM]: { getTerrain: () => ({ get: () => TERRAIN_MASK_WALL }) } } });
    // Only the creep's own tile is walkable (a road); every other tile in range is a wall.
    stubTile(ROOM, 25, 25, { structure: [{ structureType: STRUCTURE_ROAD }] });
    stubNearbyMover(ROOM, 25, 25);
    const creep = creepAt(25, 25);

    stepOffRoad(creep, new RoomPosition(25, 25, ROOM), 1);

    expect(creep.travelTo).not.toHaveBeenCalled();
  });

  it("skips a non-road tile that another creep already occupies", () => {
    // Wall off every neighbour except (24,25) and (26,25); occupy (24,25) so only (26,25) remains free.
    stubGame({
      rooms: {
        [ROOM]: {
          getTerrain: () => ({
            get: (x: number, y: number) => (y === 25 && (x === 24 || x === 26) ? 0 : x === 25 && y === 25 ? 0 : 1)
          })
        }
      }
    });
    stubTile(ROOM, 25, 25, { structure: [{ structureType: STRUCTURE_ROAD }] });
    stubTile(ROOM, 24, 25, { creep: [{ id: "other", memory: { role: "builder" } }] }); // nearer candidate, but occupied
    stubNearbyMover(ROOM, 25, 24); // within range-2 to trigger evacuation, but not a range-1 candidate tile
    const creep = creepAt(25, 25);

    stepOffRoad(creep, new RoomPosition(25, 25, ROOM), 1);

    expect(creep.travelTo).toHaveBeenCalledWith(expect.objectContaining({ x: 26, y: 25 }));
  });

  // Confirmed live on shard1/W47N14: a packed bunker core can surround a working creep's road tile
  // entirely with obstacle structures (spawns/storage/link), so there is no free tile to evacuate to
  // at all — every candidate tilesInRange() finds is either an obstacle or a road. Traveler's own
  // stuck-counter fallback never engages here either, since this creep never calls travelTo toward a
  // real destination. The creep must instead trade places with whichever mover is blocked beside it.
  it("swaps places with an adjacent mover when no free tile exists to step off to", () => {
    // Every neighbour is either a wall or, at (26,25), the road tile the blocked mover already occupies.
    stubGame({
      rooms: {
        [ROOM]: {
          getTerrain: () => ({
            get: (x: number, y: number) => (x === 25 && y === 25 ? 0 : x === 26 && y === 25 ? 0 : TERRAIN_MASK_WALL)
          })
        }
      }
    });
    stubTile(ROOM, 25, 25, { structure: [{ structureType: STRUCTURE_ROAD }] });
    stubTile(ROOM, 26, 25, {
      structure: [{ structureType: STRUCTURE_ROAD }],
      creep: [{ id: "mover", pos: new RoomPosition(26, 25, ROOM), memory: { role: "transport" }, move: vi.fn() }]
    });
    const creep = creepAt(25, 25);

    stepOffRoad(creep, new RoomPosition(25, 25, ROOM), 1);

    expect(creep.travelTo).not.toHaveBeenCalled();
    expect(creep.move).toHaveBeenCalledWith(RIGHT);
  });

  it("does not swap with a non-mover neighbour (nothing gained — it isn't trying to get through)", () => {
    stubGame({
      rooms: {
        [ROOM]: {
          getTerrain: () => ({
            get: (x: number, y: number) => (x === 25 && y === 25 ? 0 : x === 26 && y === 25 ? 0 : TERRAIN_MASK_WALL)
          })
        }
      }
    });
    stubTile(ROOM, 25, 25, { structure: [{ structureType: STRUCTURE_ROAD }] });
    stubTile(ROOM, 26, 25, {
      structure: [{ structureType: STRUCTURE_ROAD }],
      creep: [{ id: "other-builder", pos: new RoomPosition(26, 25, ROOM), memory: { role: "builder" } }]
    });
    stubNearbyMover(ROOM, 27, 25); // range-2: triggers evacuation, but too far away to be a swap candidate
    const creep = creepAt(25, 25);

    stepOffRoad(creep, new RoomPosition(25, 25, ROOM), 1);

    expect(creep.travelTo).not.toHaveBeenCalled();
    expect(creep.move).not.toHaveBeenCalled();
  });
});
