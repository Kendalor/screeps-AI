// Executes the steward's per-tick job: park on the anchor tile and rebalance energy between the anchor
// link, storage, and terminal — the three room-fixed structures the bunker layout puts adjacent to the
// anchor. Threshold-based, not planLogistics' allocator: all three targets are zero-travel from a creep
// parked on the anchor, so there is no pickup/deliver matching to do, only "does a leg need running this
// tick" — the legacy bot's RoomLogisticsOperation/LogisticJob pair, reworked onto live Game reads instead
// of a home-grown operation-manager object.
//
// Not derived from a snapshot/intent: like runTransport, a steward's actions are read-act-done within a
// single tick with no cross-tick task state worth persisting (unlike a transport creep's multi-leg
// chain), so it acts directly off Game.* the same way runOne's step table does for every other role.

import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";
import { transferTo, withdrawOrPickup } from "./actions";

// A link should never sit full — it needs headroom for the next source delivery — so drain it toward
// storage the instant it holds anything at all, no fractional floor needed on this leg.
const LINK_DRAIN_FLOOR = 0;
// Storage is treated as "has plenty to spare" only once comfortably above the point Logistics itself
// would start drawing it down to cover a spawn deficit (see logistics/graph.ts's spawnSystemDeficit
// source path) — 50% keeps the steward from fighting that drain by restocking the terminal out of a
// buffer Logistics is simultaneously trying to protect.
const STORAGE_SURPLUS_FRACTION = 0.5;
// Only worth topping the terminal up once it's run fairly low — a terminal a bit short of full isn't
// worth a trip, mirroring the same "not every last unit" reasoning graph.ts's controller-container
// floor already uses.
const TERMINAL_LOW_FRACTION = 0.5;
// Below this, the controller link is "running low enough to bother" — mirrors the same not-every-
//-last-unit floor as the terminal check above. Only matters pre-RCL7: once source links exist they
// feed the anchor link (and onward, via planLinkTransfers) on their own; this is what closes the loop
// before then, when nothing else would ever put energy into the link chain at all.
const CONTROLLER_LINK_LOW_FRACTION = 0.5;

function anchorPos(creep: Creep): RoomPosition | undefined {
  const anchor = typeof Memory !== "undefined" ? Memory.colonies?.[creep.memory.home]?.anchor : undefined;
  return anchor ? new RoomPosition(anchor.x, anchor.y, creep.memory.home) : undefined;
}

function anchorLink(room: Room, anchor: RoomPosition): StructureLink | undefined {
  return anchor
    .findInRange<StructureLink>(FIND_MY_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_LINK })
    .find(l => l.room.name === room.name);
}

// The controller link is out of the steward's reach (it sits by the controller, not the anchor) — read
// its fill level from the id operations/upgrading.ts already recorded (see ColonyMemory.links.controller,
// snapshot/types.ts's SnapLinkNetwork), the same handle planLinkTransfers uses, rather than re-deriving
// its position here.
function controllerLink(home: string): StructureLink | undefined {
  const id = typeof Memory !== "undefined" ? Memory.colonies?.[home]?.links?.controller : undefined;
  return id ? (Game.getObjectById(id) ?? undefined) : undefined;
}

function controllerLinkNeedsTopUp(link: StructureLink): boolean {
  return link.store.getUsedCapacity(RESOURCE_ENERGY) < link.store.getCapacity(RESOURCE_ENERGY) * CONTROLLER_LINK_LOW_FRACTION;
}

export const runSteward = wrapFn(function runSteward(creep: Creep): void {
  const anchor = anchorPos(creep);
  if (!anchor) return; // no anchor recorded yet — nothing to park on

  if (!creep.pos.isEqualTo(anchor)) {
    creep.travelTo(anchor);
    return;
  }

  const room = creep.room;
  const storage = room.storage;
  const terminal = room.terminal;
  const link = anchorLink(room, anchor);

  // Already carrying energy: finish delivering it before considering a new pickup, so the creep never
  // holds two partial jobs at once.
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    const dest = creep.memory.stewardDest && Game.getObjectById(creep.memory.stewardDest);
    if (dest) {
      log.debugCreep(creep.name, `delivering to stewardDest=${creep.memory.stewardDest}`);
      const result = transferTo(creep, dest as RoomObject, RESOURCE_ENERGY);
      if (result.didAct) creep.memory.stewardDest = undefined;
      return;
    }
    // Destination vanished or was never set (e.g. resuming after a respawn): storage is always a safe
    // dump — never worse than stranding the energy on the creep.
    if (storage) {
      log.debugCreep(creep.name, "stewardDest gone/unset — dumping carried energy into storage");
      transferTo(creep, storage, RESOURCE_ENERGY);
    }
    return;
  }

  // Drain the link first: it needs headroom for the next source delivery more urgently than any
  // rebalance below, and — unlike storage/terminal — nothing else in the colony can empty it.
  if (link && link.store.getUsedCapacity(RESOURCE_ENERGY) > LINK_DRAIN_FLOOR && storage) {
    log.debugCreep(creep.name, `draining anchor link (${link.store.getUsedCapacity(RESOURCE_ENERGY)} energy) to storage`);
    creep.memory.stewardDest = storage.id;
    withdrawOrPickup(creep, link, RESOURCE_ENERGY);
    return;
  }

  // Feed the anchor link from storage when the controller link is running low: before RCL7 (no source
  // links yet), nothing else ever puts energy into the link chain at all — mining only starts feeding
  // the anchor link once source links exist, and even then a slow trickle could leave the controller
  // link running dry between deliveries. planLinkTransfers (logistics/links.ts) carries it the rest of
  // the way to the controller link once it lands here; the steward itself never goes near the
  // controller link, which sits out of its reach at the controller, not the anchor.
  if (link && storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    const cLink = controllerLink(creep.memory.home);
    if (cLink && controllerLinkNeedsTopUp(cLink) && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      log.debugCreep(creep.name, "controller link running low — feeding anchor link from storage");
      creep.memory.stewardDest = link.id;
      withdrawOrPickup(creep, storage, RESOURCE_ENERGY);
      return;
    }
  }

  // Rebalance storage -> terminal: only once storage has a genuine surplus AND the terminal is
  // genuinely low, so this can't oscillate against Logistics' own storage-as-source/sink switch.
  if (storage && terminal) {
    const storageSurplus = storage.store.getUsedCapacity(RESOURCE_ENERGY) > storage.store.getCapacity(RESOURCE_ENERGY) * STORAGE_SURPLUS_FRACTION;
    const terminalLow = terminal.store.getUsedCapacity(RESOURCE_ENERGY) < terminal.store.getCapacity(RESOURCE_ENERGY) * TERMINAL_LOW_FRACTION;
    if (storageSurplus && terminalLow) {
      log.debugCreep(creep.name, "storage surplus + terminal low — rebalancing storage -> terminal");
      creep.memory.stewardDest = terminal.id;
      withdrawOrPickup(creep, storage, RESOURCE_ENERGY);
      return;
    }
  }

  // Nothing to do this tick: stay parked (already in position, no travelTo needed).
  log.debugCreep(creep.name, "idle at anchor — nothing to rebalance");
}, "steward:runSteward");
