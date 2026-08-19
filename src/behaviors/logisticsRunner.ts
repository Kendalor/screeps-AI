// gh #55: the old graph.ts/allocate.ts-driven transport executor (runTransport, and everything that
// existed only to support it — advanceOrPark, advanceOrTopOff, findLiveTopoff, topoffTask, resolveNode,
// isTaskDone, providerEmpty, consumerFull, homeRoomWaypoint, roomsFromHome) was deleted here once
// Steward's own cutover (#54) confirmed the whole graph.ts/allocate.ts/logisticsRunner.ts/logistics/
// index.ts system had zero live callers left. parkNearBunker survives: both new task runners
// (behaviors/transportTaskRunner.ts, behaviors/supplyTaskRunner.ts) call it directly from
// empire/creeps.ts when a creep has nothing assigned this tick, so an idle mover still loiters centrally
// near the bunker anchor instead of sitting wherever it happened to finish its last task.

import { stepOffRoad } from "./roadAvoidance";

const PARK_RADIUS = 3; // "near the bunker" — anywhere within this range of the anchor counts as parked
const PARK_SPREAD = 2; // per-creep offset off the anchor so idle creeps fan out instead of stacking

// A stable per-creep hash so a given creep always parks on the same spread-out spot rather than
// jittering every tick — cheap FNV-ish fold over the name.
function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h = (h ^ name.charCodeAt(i)) * 16777619;
  }
  return h >>> 0;
}

// Idle with nothing to carry and nowhere to deliver: loiter near the bunker anchor (a spread-out spot,
// not exactly on it) so a parked transport creep isn't sitting on a source/road blocking traffic, and
// is central for whichever consumer appears next. No-op until building has recorded an anchor.
export function parkNearBunker(creep: Creep): void {
  const anchor = typeof Memory !== "undefined" ? Memory.colonies?.[creep.memory.home]?.anchor : undefined;
  if (!anchor) return;

  if (creep.pos.getRangeTo(anchor.x, anchor.y) <= PARK_RADIUS) {
    // Already "close enough" to stay put — but a road tile right by the bunker can be the sole approach
    // to an adjacent structure (confirmed live: a parked supply creep squatting on the only tile next to
    // an extension permanently blocked a sibling's deliveries, since Traveler's cost matrix ignores
    // creep occupancy and never repaths around one). Cede it the same way a stationary
    // builder/upgrader does.
    stepOffRoad(creep, new RoomPosition(anchor.x, anchor.y, creep.room.name), PARK_RADIUS);
    return;
  }

  const h = nameHash(creep.name);
  const dx = (h % (2 * PARK_SPREAD + 1)) - PARK_SPREAD;
  const dy = (Math.floor(h / (2 * PARK_SPREAD + 1)) % (2 * PARK_SPREAD + 1)) - PARK_SPREAD;
  creep.travelTo(new RoomPosition(anchor.x + dx, anchor.y + dy, creep.room.name));
}
