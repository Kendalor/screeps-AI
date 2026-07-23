// Pure room-name math — the port of legacy MapRoom, reduced to what scouting needs and stripped of
// its class/Game coupling. A room's *type* (highway/keeper/intersection/normal) is a function of the
// coordinates in its name alone, so it is decided here with no map access; only *adjacency* needs the
// live map (Game.map.describeExits) and that stays at the snapshot boundary.

export type RoomType = "normal" | "highway" | "intersection" | "keeper";

export interface RoomCoords {
  wx: "W" | "E"; // west/east half
  x: number;
  wy: "N" | "S"; // north/south half
  y: number;
}

const ROOM_NAME = /^([WE])(\d+)([NS])(\d+)$/;

/** Parse `W7N4` into its quadrant letters and coordinates. Throws on a malformed name — callers
 * only ever pass real room names (from Game.rooms keys or describeExits), so a bad one is a bug. */
export function parseRoomName(name: string): RoomCoords {
  const m = ROOM_NAME.exec(name);
  if (!m) throw new Error(`not a room name: ${name}`);
  return { wx: m[1] as "W" | "E", x: Number(m[2]), wy: m[3] as "N" | "S", y: Number(m[4]) };
}

/**
 * The room's map category, from the coordinate lattice Screeps lays down:
 *  - both coordinates on a multiple-of-10 line → intersection (a highway crossroads)
 *  - either coordinate on a multiple-of-10 line → highway
 *  - both coordinates in 4..6 (mod 10) → a source-keeper block
 *  - otherwise → an ordinary room
 *
 * Ported verbatim from legacy MapRoom.getRoomType(), including its evaluation order (intersection
 * before highway before keeper) — a coordinate can satisfy more than one predicate and the order is
 * what disambiguates.
 */
export function roomType(name: string): RoomType {
  const { x, y } = parseRoomName(name);
  const onLine = (n: number): boolean => n % 10 === 0;
  const inKeeperBand = (n: number): boolean => n % 10 >= 4 && n % 10 <= 6;

  if (onLine(x) && onLine(y)) return "intersection";
  if (onLine(x) || onLine(y)) return "highway";
  if (inKeeperBand(x) && inKeeperBand(y)) return "keeper";
  return "normal";
}

/**
 * The map-grid distance between two rooms, matching Game.map.getRoomLinearDistance's math so the
 * scouting operation can rank todos without a live map in a unit test. Along each axis: coordinates
 * on the same side subtract; on opposite sides they add plus one, because W0 and E0 (and N0/S0) are
 * neighbours with no gap at the origin. The room distance is the larger of the two axis distances
 * (Chebyshev), the same metric Screeps uses.
 */
export function roomLinearDistance(a: string, b: string): number {
  const ca = parseRoomName(a);
  const cb = parseRoomName(b);
  const axis = (s1: string, n1: number, s2: string, n2: number): number =>
    s1 === s2 ? Math.abs(n1 - n2) : n1 + n2 + 1;
  return Math.max(axis(ca.wx, ca.x, cb.wx, cb.x), axis(ca.wy, ca.y, cb.wy, cb.y));
}
