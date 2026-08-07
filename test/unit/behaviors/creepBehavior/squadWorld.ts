// A multi-creep, multi-room fake world for driving the REAL squad planner (lib/squad.ts's planSquadMove)
// end to end across many ticks, with every member's position observable every tick — the squad analogue
// of world.ts's single-creep FakeWorld. Unlike squad.test.ts (which hand-builds one SquadState and calls
// planSquadMove once), this plays a squad across a live, mutating multi-room terrain map for N ticks,
// feeding each tick's OWN resulting positions back in as next tick's SquadState — so drift, oscillation,
// and border-crossing bugs (see docs/drain-squad-handoff.md) actually have a chance to manifest, the same
// way they only showed up from watching a live uncontrolled colony rather than from single-call unit tests.
//
// Deliberately NOT a Game/Creep/RoomPosition stand-in like world.ts's FakeWorld: planSquadMove/slotTiles/
// findSquadPath are already pure functions over plain XY + a TerrainSource/OccupancySource, so this harness
// stays at that same level of abstraction (a "member" is just {id,x,y,room,hits,hitsMax,fatigue,role})
// rather than wrapping a duck-typed Creep. Movement here means literally adopting the resolved intent tile
// — this harness assumes a move that planSquadMove itself approved always succeeds (no failed move() from
// a THIRD independent cause outside the planner's own terrain/occupancy checks — e.g. no fatigue-desync
// with the real engine's move-resolution order), which mirrors planSquadMove's contract exactly. Bystander
// occupancy (production's answer to handoff open issue #2's pathing half) IS modeled — see Bystander/
// addBystander/occupancy() below — so a formation can be exercised routing around a live non-squad unit
// the same way it would a wall.

import { inFormation, planSquadMove, type SquadMoveIntent, type SquadState } from "../../../../src/lib/squad";
import { slotTiles, type Formation } from "../../../../src/lib/formation";
import { roomAndLocal, worldOf, type XY } from "../../../../src/lib/geometry";
import { NO_OCCUPANCY, type OccupancySource, type TerrainSource } from "../../../../src/lib/squadPath";
import type { SnapCreep } from "../../../../src/snapshot/types";
import { snapCreep } from "../../../fixtures";

export interface SquadMemberSpec {
  role: string;
  x: number;
  y: number;
  room: string;
  hits?: number;
  hitsMax?: number;
  fatigue?: number;
}

// A non-squad live unit occupying a tile — a hostile, or the colony's own unrelated bystander (e.g. a
// frozen Defender, see docs/drain-squad-handoff.md's open issue #2) — for exercising occupancy-aware
// pathing (nearestFittingAnchor/findSquadPath routing around it, mirroring Drain.occupancy()'s real
// production wiring, src/operations/drain.ts). Stationary unless moved explicitly between ticks via
// SquadWorld.moveBystander — this harness has no AI for bystanders, only a fixed or test-driven position.
export interface Bystander {
  id: string;
  x: number;
  y: number;
  room: string;
}

export interface SquadTickLog {
  tick: number;
  goal: XY & { room: string };
  intents: SquadMoveIntent[];
  // Snapshot of every member's position AFTER this tick's move was applied — the thing a real debugColony
  // trace would show, and what every test in this suite asserts on.
  positions: { id: Id<Creep>; role: string; room: string; x: number; y: number; fatigue: number }[];
  tight: boolean; // whether the squad was in-formation BEFORE this tick's move was planned
}

/** All-plains terrain for a fixed set of rooms — the common case ("nothing here should ever block the
 * squad"); pass a real Uint8Array-backed TerrainSource (see squad.test.ts's openTerrain pattern) to a
 * test that needs walls, borders-with-obstacles, or an unlisted (fail-open undefined) room. */
export function openRooms(...rooms: string[]): TerrainSource {
  const plains = new Uint8Array(2500).fill(1);
  const set = new Set(rooms);
  return room => (set.has(room) ? plains : undefined);
}

/**
 * A live, mutating multi-creep squad: each `member()` is a real driven unit (position tracked across
 * ticks), `tick()` runs the ONE real planSquadMove call for the whole formation and applies its resulting
 * intents directly (assumed-successful moves — see module header), and every tick's outcome is both
 * returned and appended to `log` for later inspection — the "observable every tick" requirement without
 * needing a live pserver.
 */
export class SquadWorld {
  formation: Formation;
  terrain: TerrainSource;
  members: { id: Id<Creep>; role: string; x: number; y: number; room: string; hits: number; hitsMax: number; fatigue: number }[] = [];
  bystanders: Bystander[] = [];
  log: SquadTickLog[] = [];
  private tick = 0;
  private idSeq = 0;

  constructor(formation: Formation, terrain: TerrainSource) {
    this.formation = formation;
    this.terrain = terrain;
  }

  /** Adds one live member to the squad, returning its id (for later fatigue/hit mutation between ticks). */
  addMember(spec: SquadMemberSpec): Id<Creep> {
    const id = `${spec.role}_${this.idSeq++}` as Id<Creep>;
    this.members.push({
      id,
      role: spec.role,
      x: spec.x,
      y: spec.y,
      room: spec.room,
      hits: spec.hits ?? 100,
      hitsMax: spec.hitsMax ?? 100,
      fatigue: spec.fatigue ?? 0
    });
    return id;
  }

  /** Removes a member outright (simulates death) — the next squadState() computed from this world reflects
   * a degraded formation with that slot vacant, same as Drain.squad() dropping a dead creep. */
  kill(id: Id<Creep>): void {
    this.members = this.members.filter(m => m.id !== id);
  }

  /** Adds a stationary non-squad unit (a bystander creep, or a stand-in for an obstructing structure) at a
   * fixed tile, returning its id for later repositioning via moveBystander. Feeds occupancy() below. */
  addBystander(spec: { id?: string; x: number; y: number; room: string }): string {
    const id = spec.id ?? `bystander_${this.idSeq++}`;
    this.bystanders.push({ id, x: spec.x, y: spec.y, room: spec.room });
    return id;
  }

  /** Relocates an existing bystander — for a test that wants a hostile patrolling or reacting between
   * ticks rather than sitting frozen; SquadWorld itself has no bystander AI (see Bystander's doc). */
  moveBystander(id: string, to: { x: number; y: number; room: string }): void {
    const b = this.bystanders.find(bb => bb.id === id);
    if (!b) throw new Error(`no such bystander: ${id}`);
    b.x = to.x;
    b.y = to.y;
    b.room = to.room;
  }

  /** The live OccupancySource this world's bystanders produce — SAME shape/exclusion rule as
   * Drain.occupancy() in production (src/operations/drain.ts): every bystander tile reads as occupied,
   * but a squad's OWN member tiles are always excluded so the formation never reads itself as blocking
   * its own current slots (planSquadMove's fit-checks would otherwise hold forever — see occupancy()'s
   * production doc for the full rationale). Returns NO_OCCUPANCY (nothing occupied, matching squadPath.ts's
   * fail-open convention) when there are no bystanders at all, so a test that never adds one sees
   * byte-for-byte the same behavior as before this feature existed. */
  occupancy(): OccupancySource {
    if (this.bystanders.length === 0) return NO_OCCUPANCY;
    const byRoom = new Map<string, Uint8Array>();
    for (const b of this.bystanders) {
      let grid = byRoom.get(b.room);
      if (!grid) {
        grid = new Uint8Array(2500);
        byRoom.set(b.room, grid);
      }
      grid[b.x * 50 + b.y] = 1;
    }
    const mine = new Set(this.members.map(m => `${m.room}:${m.x},${m.y}`));
    return room => {
      const grid = byRoom.get(room);
      if (!grid) return undefined;
      const out = grid.slice();
      for (const key of mine) {
        const [r, xy] = key.split(":");
        if (r !== room) continue;
        const [x, y] = xy.split(",").map(Number);
        out[x * 50 + y] = 0;
      }
      return out;
    };
  }

  private member(id: Id<Creep>) {
    const m = this.members.find(mm => mm.id === id);
    if (!m) throw new Error(`no such member: ${id}`);
    return m;
  }

  setFatigue(id: Id<Creep>, fatigue: number): void {
    this.member(id).fatigue = fatigue;
  }

  setHits(id: Id<Creep>, hits: number): void {
    this.member(id).hits = hits;
  }

  /** Moves ONE member a single tile toward `dest` (Chebyshev-greedy, crossing a room border via the same
   * world-coordinate lattice slotTiles/planSquadMove use — geometry.ts's worldOf/roomAndLocal — rather than
   * clamping at a room's local edge), stepping around a wall tile via a simple side-step if the direct step
   * is blocked. NOT squad-controlled: this is for the pre-assembly phase of a squad's lifecycle, where each
   * member rallies independently via its own step table (moveToPos/drainRallyPos in production — see
   * operations/drain.ts's squadState doc on "assembling") before ever coming under planSquadMove. Returns
   * true once the member has actually reached `dest` (same room, same tile). */
  walkIndependently(id: Id<Creep>, dest: XY & { room: string }): boolean {
    const m = this.member(id);
    if (m.room === dest.room && m.x === dest.x && m.y === dest.y) return true;
    const a = worldOf(m.x, m.y, m.room);
    const b = worldOf(dest.x, dest.y, dest.room);
    const candidates: { dwx: number; dwy: number }[] = [
      { dwx: Math.sign(b.wx - a.wx), dwy: Math.sign(b.wy - a.wy) },
      { dwx: Math.sign(b.wx - a.wx), dwy: 0 },
      { dwx: 0, dwy: Math.sign(b.wy - a.wy) }
    ];
    for (const c of candidates) {
      if (c.dwx === 0 && c.dwy === 0) continue;
      const nwx = a.wx + c.dwx;
      const nwy = a.wy + c.dwy;
      const { room, x, y } = roomAndLocal(nwx, nwy);
      const t = this.terrain(room);
      if (t && t[x * 50 + y] !== 1) continue; // wall — try the next candidate direction
      m.x = x;
      m.y = y;
      m.room = room;
      return m.room === dest.room && m.x === dest.x && m.y === dest.y;
    }
    return false; // boxed in on every candidate direction — held in place this call
  }

  /** The live SquadState as lib/squad.ts would see it right now — anchor/facing supplied by the caller
   * (mirrors Drain.squadState()'s own anchor/facing derivation, which is Drain's content, not the generic
   * Squad's — this harness stays formation-agnostic and takes them as given). */
  state(anchor: XY & { room: string }, facing: DirectionConstant): SquadState {
    return {
      members: this.members.map(m => snapCreepFromMember(m)),
      formation: this.formation,
      anchor,
      facing
    };
  }

  /** Runs ONE tick: computes planSquadMove against the CURRENT live positions, applies every resulting
   * intent directly to the corresponding member (assumed-successful move, per module header), advances the
   * tick counter, and appends+returns a full log entry — the per-tick observability the test suite needs. */
  step(anchor: XY & { room: string }, facing: DirectionConstant, goal: XY & { room: string }): SquadTickLog {
    const state = this.state(anchor, facing);
    const tight = isTight(state, this.formation);
    const intents = planSquadMove(state, goal, this.terrain, this.occupancy());
    for (const intent of intents) {
      const m = this.member(intent.creep);
      m.x = intent.to.x;
      m.y = intent.to.y;
      m.room = intent.to.room;
    }
    this.tick++;
    const entry: SquadTickLog = {
      tick: this.tick,
      goal,
      intents,
      positions: this.members.map(m => ({ id: m.id, role: m.role, room: m.room, x: m.x, y: m.y, fatigue: m.fatigue })),
      tight
    };
    this.log.push(entry);
    return entry;
  }

  /** Runs `n` ticks back to back with a FIXED anchor/facing/goal strategy supplied per tick (a function so
   * a test can recompute anchor/facing from the squad's own live state each tick, mirroring Drain's real
   * recompute-every-tick rule — see operations/drain.ts's squadState doc) — returns the full per-tick log. */
  run(
    ticks: number,
    plan: (world: SquadWorld) => { anchor: XY & { room: string }; facing: DirectionConstant; goal: XY & { room: string } }
  ): SquadTickLog[] {
    const out: SquadTickLog[] = [];
    for (let i = 0; i < ticks; i++) {
      const { anchor, facing, goal } = plan(this);
      out.push(this.step(anchor, facing, goal));
    }
    return out;
  }

  /** Pretty-prints the full tick-by-tick position log — the "make behavior observable" requirement,
   * usable from a failing test's error message or ad hoc debugging without re-deriving it from `log`.
   * Bystanders are appended once at the end (they're not part of the per-tick log — this harness has no
   * bystander AI, so their positions are constant except when a test calls moveBystander explicitly). */
  describeLog(): string {
    const ticks = this.log
      .map(
        e =>
          `tick ${e.tick} goal=(${e.goal.x},${e.goal.y},${e.goal.room}) tight=${e.tight} ` +
          e.positions.map(p => `${p.role}@${p.room}(${p.x},${p.y})${p.fatigue ? `fatigue=${p.fatigue}` : ""}`).join(" ")
      )
      .join("\n");
    if (this.bystanders.length === 0) return ticks;
    const bystanders = `bystanders: ${this.bystanders.map(b => `${b.id}@${b.room}(${b.x},${b.y})`).join(" ")}`;
    return `${ticks}\n${bystanders}`;
  }
}

function snapCreepFromMember(m: { id: Id<Creep>; role: string; x: number; y: number; room: string; hits: number; hitsMax: number; fatigue: number }): SnapCreep {
  // snapCreep()'s fixture auto-generates its OWN name/id when not given one (a fresh sequence number every
  // call) — pass this member's real tracked id through explicitly, or every SnapCreep built here would get
  // a disconnected id and planSquadMove's returned intents could never be matched back to a live member.
  return snapCreep(m.role as SnapCreep["role"], {
    id: m.id,
    name: m.id,
    home: m.room,
    room: m.room,
    x: m.x,
    y: m.y,
    hits: m.hits,
    hitsMax: m.hitsMax,
    fatigue: m.fatigue,
    memory: {}
  });
}

// Applies squad.ts's own inFormation predicate to the CURRENT anchor/facing's slot tiles, purely for the
// log's `tight` field — re-derives nothing planSquadMove itself doesn't already check internally, just
// surfaces it for observability.
function isTight(state: SquadState, formation: Formation): boolean {
  return inFormation(state.members, slotTiles(state.anchor, state.facing, formation));
}
