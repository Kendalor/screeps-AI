// Shared W/E/N/S room-name <-> integer-grid conversion, mirroring
// node_modules/@screeps/backend/lib/utils.js's roomNameToXY/roomNameFromXY
// exactly (same sign convention: W0/N0 sit at x=-1/y=-1, not 0).

export function roomNameToXY(name) {
  const match = name.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) throw new Error(`Invalid room name: ${name}`);
  const [, hor, xStr, ver, yStr] = match;
  const x = hor === "W" ? -Number(xStr) - 1 : Number(xStr);
  const y = ver === "N" ? -Number(yStr) - 1 : Number(yStr);
  return [x, y];
}

export function roomNameFromXY(x, y) {
  const hor = x < 0 ? `W${-x - 1}` : `E${x}`;
  const ver = y < 0 ? `N${-y - 1}` : `S${y}`;
  return `${hor}${ver}`;
}

// All room names within Chebyshev `radius` of `centerName` (a (2*radius+1)^2 block).
export function roomsInRadius(centerName, radius) {
  const [cx, cy] = roomNameToXY(centerName);
  const names = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      names.push(roomNameFromXY(cx + dx, cy + dy));
    }
  }
  return names;
}
