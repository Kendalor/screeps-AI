// Chooses which remote sources to mine, nearest-first, off scout memory (no live vision needed). Pure —
// its output is cached in ColonyMemory.remotes by a throttled setRemotes intent, so the active source set
// is stable and not re-ranked every tick. Same testable shape as the scout target picker: plain data in,
// a selection out, no Game.*.

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
  currentlySelected: Id<Source>[]; // sources already committed to Memory.remotes — never dropped here, and
  // at most one *new* source is added per call so a burst of newly-profitable candidates can't all land
  // in the same throttle tick (see MAX_NEW_REMOTES_PER_SELECTION below).
}

// Below this, energyCapacity can't build a miner worth sending (RCL2 with all extensions = 550).
const MIN_ENERGY_CAPACITY = 550;

// Cap on total selected remote sources, so autonomous selection can never over-commit the spawn with an
// unbounded remote fleet. Nearest-first, so the cap keeps the cheapest energy. A coarse ceiling — the
// real spawn-capacity signal is the handoff's open question; this is the safety net until then.
const MAX_REMOTE_SOURCES = 6;

// At most one never-before-selected source is added per call, even if several newly become profitable in
// the same throttle tick (e.g. a scout just finished several rooms at once). Keeps ramp-up gradual instead
// of spawning a whole remote-mining fleet's worth of miners/haulers/claimers in one go.
const MAX_NEW_REMOTES_PER_SELECTION = 1;

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
    const info = cand.info;
    if (!info) continue; // unscouted — no source data to decide on
    for (const src of info.sources) {
      flat.push({
        room: cand.room,
        id: src.id,
        x: src.x,
        y: src.y,
        distance: remoteDistanceEstimate({ home: home.name, remote: cand.room, source: src, storage: home.storage })
      });
    }
  }

  // Gate 1 (economics): keep only sources that pay off. reserved:false — selection prices the baseline
  // unreserved yield; Reservation later upgrades a room whose sources are all being mined.
  const worthwhile = flat.filter(
    c => netEnergy({ ...c, room: c.room, openTiles: 0, reserved: false, danger: 0 }, ctx) > 0
  );

  // Nearest-first, then capped: the spawn-capacity ceiling keeps the cheapest energy and can't over-commit.
  worthwhile.sort((a, b) => a.distance - b.distance);

  // Never drop a source we've already committed to, even if it'd fall outside the cap on a re-rank (e.g.
  // nearer candidates appeared). Then add previously-unseen sources one at a time, nearest-first, up to
  // both the per-call trickle limit and the overall ceiling.
  const alreadySelected = new Set(input.currentlySelected);
  const kept = worthwhile.filter(c => alreadySelected.has(c.id));
  const fresh = worthwhile.filter(c => !alreadySelected.has(c.id));

  const capped = kept.slice(0, MAX_REMOTE_SOURCES);
  for (const c of fresh) {
    if (capped.length >= MAX_REMOTE_SOURCES) break;
    if (capped.length - kept.length >= MAX_NEW_REMOTES_PER_SELECTION) break;
    capped.push(c);
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
