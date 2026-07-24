// Pure room-name math. A room's type is a function of its name's coordinates alone, no map access needed.

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

/** The room's map category from its coordinate lattice; evaluation order (intersection, highway,
 * keeper) disambiguates coordinates that satisfy more than one predicate. */
export function roomType(name: string): RoomType {
  const { x, y } = parseRoomName(name);
  const onLine = (n: number): boolean => n % 10 === 0;
  const inKeeperBand = (n: number): boolean => n % 10 >= 4 && n % 10 <= 6;

  if (onLine(x) && onLine(y)) return "intersection";
  if (onLine(x) || onLine(y)) return "highway";
  if (inKeeperBand(x) && inKeeperBand(y)) return "keeper";
  return "normal";
}

/** Matches Game.map.getRoomLinearDistance's math (Chebyshev), usable without a live map in tests. */
export function roomLinearDistance(a: string, b: string): number {
  const ca = parseRoomName(a);
  const cb = parseRoomName(b);
  const axis = (s1: string, n1: number, s2: string, n2: number): number =>
    s1 === s2 ? Math.abs(n1 - n2) : n1 + n2 + 1;
  return Math.max(axis(ca.wx, ca.x, cb.wx, cb.x), axis(ca.wy, ca.y, cb.wy, cb.y));
}
