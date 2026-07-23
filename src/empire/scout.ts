// The scout behaviour's imperative glue — the half that cannot be pure because it drives a live
// creep across rooms and reads live rooms into observations. The one decision that *can* be pure
// (which room to walk to) is delegated to behaviors/scout.ts; everything here needs Game.
//
// Ported from legacy ScoutingJob: travel to a target room, record what it stands in on arrival,
// leave the exit tile so it does not bounce back across the border, and give up on a room it cannot
// reach (antistuck). What is dropped from legacy: the Operation.setChanged/todo-invalidation dance
// (the todo is recomputed every tick now) and the persisted _trav skip heuristic.

import { pickScoutTarget } from "../behaviors/scout";
import { execute } from "../intents/execute";
import { roomType } from "../lib/roomName";
import type { ScoutInfo } from "../memory/schema";
import { needsScouting, staleAfter } from "../operations/scouting";
import { scoutCandidatesAround } from "../snapshot/scoutGraph";

// A scout that cannot reach its target for this many ticks gives it up and picks another, so one
// unreachable room (walled-off, perpetually blocked) never strands a scout forever. Legacy used 1000.
const ANTISTUCK_LIMIT = 1000;

export function runScout(creep: Creep): void {
  const here = creep.room.name;

  // Standing in a room that still wants surveying — including the target it was walking to — record
  // it. This is the whole point of the trip, so it happens before any travel decision.
  recordIfWorthwhile(creep);

  // Arrived at (or already sitting in) the target: clear it so a fresh target is picked below. The
  // record above already captured this room.
  if (creep.memory.scoutTarget === here) {
    creep.memory.scoutTarget = undefined;
    clearAntistuck(creep);
  }

  const target = ensureTarget(creep);
  if (!target) {
    // Nothing left to scout in range. Sit on the exit-adjacent tile rather than the border so vision
    // stays put; the scout dies off by attrition until an observation goes stale and re-opens demand.
    return;
  }

  if (target !== here) {
    creep.travelTo(new RoomPosition(25, 25, target), { range: 20 });
    tickAntistuck(creep, target);
  } else {
    // On the target's border tile — step inward so the recorded room is genuinely this one, not the
    // room across the exit the creep is straddling.
    leaveBorder(creep);
  }
}

// Record the current room if scouting still wants it, through the intent boundary so the Memory
// write stays in execute.ts. Reads the live room to build the observation.
function recordIfWorthwhile(creep: Creep): void {
  const here = creep.room.name;
  const candidate = { room: here, distance: 0, type: roomType(here), info: Memory.rooms[here]?.scouted };
  if (!needsScouting(candidate, Game.time)) return;
  execute([{ kind: "recordScout", room: here, info: observeRoom(creep.room) }]);
}

// What a scout can see of the room it stands in, distilled to the ScoutInfo remote mining and
// expansion read. `tick` stamps when it was seen so staleAfter() can age it out.
function observeRoom(room: Room): ScoutInfo {
  const controller = room.controller;
  const owner = controller?.owner?.username ?? controller?.reservation?.username;
  const mineral = room.find(FIND_MINERALS)[0]?.mineralType;
  return {
    tick: Game.time,
    type: roomType(room.name),
    sources: room.find(FIND_SOURCES).length,
    ...(mineral ? { mineral } : {}),
    ...(owner ? { owner } : {}),
    hostile: owner !== undefined && owner !== room.controller?.my ? isHostileOwner(room) : false
  };
}

// A room is hostile if its controller is owned or reserved by someone who isn't us.
function isHostileOwner(room: Room): boolean {
  const c = room.controller;
  if (!c) return false;
  if (c.my) return false;
  return c.owner !== undefined || c.reservation !== undefined;
}

// The scout's current target, picking a fresh one from its home colony's frontier if it has none.
// The todo is recomputed here from the same graph the snapshot uses, so behaviour and operation
// agree on what needs scouting.
function ensureTarget(creep: Creep): string | undefined {
  if (creep.memory.scoutTarget) return creep.memory.scoutTarget;

  const radius = Memory.scouting?.radius ?? 1;
  const todo = scoutCandidatesAround(creep.memory.home, radius);
  const picked = pickScoutTarget(todo, creep.room.name, Game.time);
  if (picked) {
    creep.memory.scoutTarget = picked;
    return picked;
  }

  // Frontier exhausted at this radius: push it outward (up to the cap) so next tick's graph reaches
  // farther. This is the outward growth legacy did in validateTodo(); done here because the
  // behaviour is where the "nothing left to scout" condition is actually observed.
  advanceRadius(todo);
  return undefined;
}

// Grow the empire's scouting radius one ring, up to MAX_SCOUT_RANGE, when the current ring is fully
// surveyed. Idempotent per tick — only grows when there is genuinely nothing left needing scouting.
const MAX_SCOUT_RANGE = 6; // legacy MAX_RANGE
function advanceRadius(todo: readonly { room: string; type: RoomType; info?: ScoutInfo }[]): void {
  const anyOpen = todo.some(t => needsScouting(t, Game.time));
  if (anyOpen) return;
  const mem = (Memory.scouting ??= { radius: 1 });
  if (mem.radius < MAX_SCOUT_RANGE) mem.radius += 1;
}

// A creep sitting on an exit tile is pushed straight back out of the room next tick; step one tile
// inward so it stays in the room it just entered. Ported verbatim from legacy ScoutingJob.leaveBorder.
function leaveBorder(creep: Creep): void {
  const { x, y } = creep.pos;
  if (y === 0) creep.move(BOTTOM);
  else if (y === 49) creep.move(TOP);
  else if (x === 49) creep.move(LEFT);
  else if (x === 0) creep.move(RIGHT);
}

function tickAntistuck(creep: Creep, target: string): void {
  const a = creep.memory.antistuck;
  if (!a || a.target !== target) {
    creep.memory.antistuck = { target, counter: 0 };
    return;
  }
  a.counter += 1;
  if (a.counter > ANTISTUCK_LIMIT) {
    // Give up on this room — mark it seen-now so it drops out of the todo for a full interval rather
    // than being retried immediately, and clear the target so a new one is picked next tick.
    execute([{ kind: "recordScout", room: target, info: skippedInfo(target) }]);
    creep.memory.scoutTarget = undefined;
    clearAntistuck(creep);
  }
}

function clearAntistuck(creep: Creep): void {
  creep.memory.antistuck = undefined;
}

// A placeholder observation for a room a scout gave up reaching: enough to keep it out of the todo
// for one interval, with the sentinel source count -1 so a reader can tell "never entered" apart
// from a real survey.
function skippedInfo(room: string): ScoutInfo {
  return { tick: Game.time, type: roomType(room), sources: -1, hostile: false };
}

import type { RoomType } from "../lib/roomName";
