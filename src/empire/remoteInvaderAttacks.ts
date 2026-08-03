// Automatic counterpart to attackFlags.ts, scoped to any room near a colony instead of player-placed
// flags. A STRUCTURE_INVADER_CORE reserves its room's controller under the NPC username "Invader" —
// this stops Mining/Reservation from staffing that room if it's a selected remote (see
// SnapRemoteSource.reservedBy), but does nothing to clear the core itself. Left alone, a core in an
// UNMINED neighboring room keeps reseeding invaders into the colony's actual remotes even though nothing
// ever selects that room for mining — so this sweeps every scouted room within PRUNE_RADIUS, not just
// colony.remoteSources, and hands a live level-0 core off to the nearest affordable colony via the exact
// same pickAttackSponsor/addAttackTarget pipeline the manual "attack" flag uses (see attackFlags.ts's
// header for the full shape) — Attack (operations/attack.ts) already targets STRUCTURE_INVADER_CORE
// first and already self-removes once the room is seen with zero hostile creeps/structures.
//
// Deliberately excludes a Stronghold's fortified core (level 1-5, ramparted, deploys defenders) —
// clearing one isn't feasible yet. Room type/name can't tell a Stronghold room apart from an ordinary
// one (Strongholds spawn in any normal room, see lib/roomName.ts's roomType), so the only real signal is
// the core's own `level`: 0 for a plain remote-mining-room core, >0 for a Stronghold's.
//
// Not wired into SYSTEMS/operationsFor (Attack itself isn't a default operation), so this runs as its
// own call from kernel/tick.ts's tick(), right alongside runAttackFlags — same reasoning, same
// untiered/unconditional treatment (a missed firing under CPU pressure would silently leave a room
// undefended, unlike a tier-3 luxury system).
//
// Also force-rescouts any room within PRUNE_RADIUS of a freshly-sighted live core (see
// runRemoteInvaderAttacks' first block, and intents/types.ts's forceRescout doc). Without this, a room
// whose core spawned after its last scout visit sits at whatever staleness interval its CORE-LESS
// ScoutInfo already earned it — up to the full 100k-tick "normal room" interval — and is invisible to the
// `targets` sweep below until that interval happens to lapse on its own.

import { pickAttackSponsor } from "./attackSponsor";
import { execute } from "../intents/execute";
import { INVADER_USERNAME } from "../mining/remoteSources";
import { scoutCandidatesAround } from "../snapshot/scoutGraph";
import type { Intent } from "../intents/types";
import type { Empire } from "./index";
const NON_FORTIFIED_CORE_LEVEL = 0;

// How far out (real room-graph hops, matching ScoutCandidate.distance's BFS depth) to prune invader
// cores from. A neighbor this close reseeds a colony's remotes almost immediately if left standing.
const PRUNE_RADIUS = 3;

// Real room-graph route length, Infinity when findRoute can't connect the two rooms — same convention
// attackFlags.ts's/colonizeFlags.ts's own routeDistance uses, not the spawn arbiter's Chebyshev estimate.
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from kernel/tick.ts. Finds every room within PRUNE_RADIUS of a colony that's
 * reserved by the Invader NPC with a live, non-fortified core still present, and hands it off to the
 * nearest affordable colony — unless some colony (not necessarily the nearest one) is already attacking
 * it. */
export function runRemoteInvaderAttacks(world: Empire): void {
  const alreadyAttacking = new Set(world.colonies.flatMap(c => c.snapshot.attacking));

  // Any live core seen this tick (fortified or not) forces its own neighbourhood's scout data stale, so
  // Scouting sends eyes back within PRUNE_RADIUS promptly instead of waiting out whatever interval each
  // neighbour's last (possibly core-less, possibly ancient) observation happened to earn it. A room whose
  // ScoutInfo predates the core's own arrival has no way to already carry INVADER_OWNED_STALE_AFTER's
  // tighter cadence — see the module header — so this is the only thing that ever notices such a room.
  // visibleRooms is the same shared array on every colony (built once by buildEmpireSnapshot), so this is
  // scanned once, empire-wide — not per colony — and picks up ANY sighting, not just rooms already
  // flagged invader-owned from a past scout.
  const visibleRooms = world.snapshot.colonies[0]?.visibleRooms ?? [];
  const rescoutIntents: Intent[] = [];
  const rescouted = new Set<string>();
  for (const visible of visibleRooms) {
    if (visible.invaderCoreLevel === undefined) continue;
    for (const nearby of scoutCandidatesAround(visible.room, PRUNE_RADIUS)) {
      if (rescouted.has(nearby.room)) continue;
      rescouted.add(nearby.room);
      rescoutIntents.push({ kind: "forceRescout", room: nearby.room });
    }
  }
  if (rescoutIntents.length > 0) execute(rescoutIntents);

  for (const colony of world.colonies) {
    const targets = new Set(
      colony.snapshot.scoutTargets
        .filter(t => t.distance <= PRUNE_RADIUS && t.info?.owner === INVADER_USERNAME)
        .map(t => t.room)
    );

    for (const target of targets) {
      if (alreadyAttacking.has(target)) continue;

      // ScoutInfo.owner alone doesn't prove a core is still standing (the reservation outlives the core
      // that placed it) or that it isn't a Stronghold's fortified one — both require this tick's live
      // vision. No vision this tick just means "don't decide yet," same non-decision the reservedBy gate
      // already makes for a selected remote.
      const visible = colony.snapshot.visibleRooms.find(r => r.room === target);
      if (!visible || visible.invaderCoreLevel !== NON_FORTIFIED_CORE_LEVEL) continue;

      const pick = pickAttackSponsor(world.colonies, target, routeDistance);
      if (!pick.colony) continue; // no fitting sponsor this tick; retried automatically next tick

      execute([{ kind: "addAttackTarget", room: pick.colony.name, target }]);
      alreadyAttacking.add(target);
    }
  }
}
