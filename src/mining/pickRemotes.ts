// Chooses which remote sources to mine, nearest-first, off scout memory (no live vision needed). Pure —
// its output is cached in ColonyMemory.remotes by a throttled setRemotes intent, so the active source set
// is stable and not re-ranked every tick. Same testable shape as the scout target picker: plain data in,
// a selection out, no Game.*. Prefers each candidate's real, precomputed PathFinder distance (see
// ScoutedSource.paths, populated by the scouting operation before this ever runs) over the cheap
// remoteDistanceEstimate fallback, so ranking and profitability are judged on the ground truth wherever
// it's already available.

import type { XY } from "../lib/geometry";
import type { RemoteMemory } from "../memory/schema";
import type { ScoutCandidate } from "../snapshot/types";
import { remoteDistanceEstimate } from "./distance";
import { defaultEconomyContext, netEnergy } from "./remoteEconomics";

export interface PickRemotesHome {
  name: string; // home room — never mine our own room as a remote
  storage: XY; // home storage/anchor, the haul endpoint distance is measured from
  energyCapacity: number; // affordability gate: can we spawn a useful miner/claimer body
  spawnHeadroom: boolean; // capacity gate: can the spawn(s) take on more creeps without starving local roles
}

export interface PickRemotesInput {
  candidates: ScoutCandidate[]; // scouted neighbours; each info.sources is the remote-mining input
  home: PickRemotesHome;
  currentlySelected: Id<Source>[]; // sources already committed to Memory.remotes — never dropped here
  // unless reevaluate is set, and at most one never-before-selected room's worth of sources is added per
  // call, so a burst of newly-scouted rooms can't all commit their whole remote-mining fleet in the same
  // throttle tick.
  // On a normal call (false), previously-selected sources are preserved unconditionally and at most one
  // new room's sources are added — today's stable, append-only behavior. On a periodic re-evaluation call
  // (true), every previously-selected source is re-priced and re-ranked alongside fresh candidates as one
  // combined pool, so a source that's gone stale (e.g. a nearer room only scouted since, or one that's
  // become unprofitable) can be evicted in favor of a better one. Structures/miners already built for an
  // evicted source are not touched here — that's a separate cleanup concern.
  reevaluate: boolean;
}

// Below this, energyCapacity can't build a miner worth sending (RCL2 with all extensions = 550).
const MIN_ENERGY_CAPACITY = 550;

// Cap on total selected remote sources, so autonomous selection can never over-commit the spawn with an
// unbounded remote fleet. Nearest-first, so the cap keeps the cheapest energy. A coarse ceiling — the
// real spawn-capacity signal is the handoff's open question; this is the safety net until then.
const MAX_REMOTE_SOURCES = 6;

// A room farther than this is never worth remote-mining, full stop — not every scouted room is a
// realistic candidate, and the scouting frontier (Memory.scouting.radius) grows well past this for
// unrelated reasons (general map awareness). Enforced here (not just at the scouting precompute step)
// so a source that somehow got a real path cached anyway still can't be selected past this range.
export const MAX_REMOTE_HOPS = 3;

// One scouted source flattened with the room it lives in and its computed haul distance.
interface Candidate {
  room: string;
  id: Id<Source>;
  x: number;
  y: number;
  distance: number;
}

export function pickRemotes(input: PickRemotesInput): RemoteMemory[] {
  const { home } = input;

  // Gate 2 (affordability) and gate 3 (spawn headroom) are room-wide: if either fails, attempt nothing.
  if (home.energyCapacity < MIN_ENERGY_CAPACITY || !home.spawnHeadroom) return [];

  const ctx = defaultEconomyContext();

  const flat: Candidate[] = [];
  for (const cand of input.candidates) {
    if (cand.room === home.name) continue; // never our own room
    if (cand.type !== "normal") continue; // highways have no sources; keeper rooms need combat (deferred)
    if (cand.distance > MAX_REMOTE_HOPS) continue; // too far to ever be worth mining
    const info = cand.info;
    if (!info) continue; // unscouted — no source data to decide on
    for (const src of info.sources) {
      const cachedPath = src.paths?.[home.name];
      const distance =
        cachedPath !== undefined
          ? cachedPath.length
          : remoteDistanceEstimate({ roomDistance: cand.distance, source: src, storage: home.storage });
      flat.push({ room: cand.room, id: src.id, x: src.x, y: src.y, distance });
    }
  }

  // Gate 1 (economics): keep only sources that pay off. reserved:false — selection prices the baseline
  // unreserved yield; Reservation later upgrades a room whose sources are all being mined.
  const worthwhile = flat.filter(
    c => netEnergy({ ...c, room: c.room, openTiles: 0, reserved: false, danger: 0 }, ctx) > 0
  );

  // Nearest-first, then capped: the spawn-capacity ceiling keeps the cheapest energy and can't over-commit.
  worthwhile.sort((a, b) => a.distance - b.distance);

  const alreadySelected = new Set(input.currentlySelected);
  let capped: Candidate[];
  if (input.reevaluate) {
    // Full re-rank: every worthwhile candidate (previously-selected or not) competes on equal footing,
    // re-priced with whatever distance/economics apply right now. This is the only branch that can drop
    // a previously-selected source.
    capped = worthwhile.slice(0, MAX_REMOTE_SOURCES);
  } else {
    // Never drop a source we've already committed to, even if it'd fall outside the cap on a re-rank (e.g.
    // nearer candidates appeared). Then commit previously-unseen rooms whole: find the single nearest
    // never-selected room (by its nearest source) and add every worthwhile source in it together, rather
    // than trickling in one source per call while its room-mates — already paid for by the same scouting/
    // reservation cost — wait their turn behind a farther room.
    const kept = worthwhile.filter(c => alreadySelected.has(c.id));
    const fresh = worthwhile.filter(c => !alreadySelected.has(c.id));

    capped = kept.slice(0, MAX_REMOTE_SOURCES);
    const nextRoom = fresh[0]?.room; // worthwhile is sorted nearest-first; fresh preserves that order
    if (nextRoom !== undefined && capped.length < MAX_REMOTE_SOURCES) {
      for (const c of fresh) {
        if (c.room !== nextRoom) continue;
        if (capped.length >= MAX_REMOTE_SOURCES) break;
        capped.push(c);
      }
    }
  }

  // Group surviving sources back into per-room RemoteMemory entries.
  const byRoom = new Map<string, RemoteMemory>();
  for (const c of capped) {
    let entry = byRoom.get(c.room);
    if (!entry) {
      entry = { room: c.room, sources: [], reserved: false };
      byRoom.set(c.room, entry);
    }
    entry.sources.push({ id: c.id, x: c.x, y: c.y, distance: c.distance });
  }
  return [...byRoom.values()];
}
