import type { RoleName } from "../memory/schema";

// How many creeps may share one resolved target: "allow"/absent = unlimited, "avoid" = exclusive (1), a number = that many.
// Sources ignore this and use their open harvest-tile count as the cap instead.
export type Share = "allow" | "avoid" | number;

// Selection strategy a step declares outright, no implicit fallback: "nearest" (default) is closest, "largest" ranks a drop pile by amount, "mostProgress" ranks a construction site closest to done, "mostDamaged" ranks a structure by lowest hits fraction (the repair counterpart of "mostProgress"), "mostThreatening" ranks a hostile creep by body composition (attacker > healer > unarmed), nearest as the tiebreaker.
export type Prefer = "nearest" | "largest" | "mostProgress" | "mostDamaged" | "mostThreatening";

export type TargetSpec =
  | {
      find: "structure";
      // A single type or a list — a list pools every matching structureType into one candidate set
      // (e.g. STRUCTURE_SPAWN and STRUCTURE_EXTENSION together), same as "any" does across find-kinds.
      type: StructureConstant | StructureConstant[];
      where?: "notFull" | "hasEnergy" | "damaged";
      share?: Share;
      prefer?: Prefer;
      // Positional discriminator, the only way to tell same-typed structures apart by where they sit:
      //  - "assignedSource": range 1 of the creep's memory.sourceId — a miner's own source container/link.
      //  - "controller": range 2 of the room controller — the controller container (an upgrader parked on
      //    it stays in upgrade range). This is the hauler's fill target.
      //  - "notController": the complement — every container that is NOT the controller's, i.e. the source
      //    containers a hauler draws from. Keeps a hauler from draining the very container it fills.
      near?: "assignedSource" | "controller" | "notController";
      // Only qualify a store-holder while its energy fraction is BELOW this (0..1). Lets the hauler top the
      // controller container to a floor (0.7) and then leave it alone, rather than fighting the upgraders
      // that drain it for every last unit. Combines with `where` (both must pass).
      fillTo?: number;
      // Only qualify a structure while its hits fraction is BELOW this (0..1) — the repair counterpart of
      // fillTo. Lets a miner start repairing its container only once it has decayed past a floor (0.7)
      // rather than chasing every point of decay. Combines with `where` (both must pass).
      repairBelow?: number;
      // Exclude a candidate the creep can't reach before it dies (see requireReachableAlive doc below).
      requireReachableAlive?: boolean;
    }
  // unlessSpawnNeedsEnergy: skip this pool while the room's spawn/extensions aren't full, so builders/
  // upgraders leave ground piles for the hauler (whose own gather step has no such gate) rather than
  // competing with it for the exact energy the spawn system needs to produce replacements.
  //
  // requireReachableAlive: exclude a candidate whose straight-line range exceeds the creep's own
  // ticksToLive — a lower bound on travel time (a hauler is built 1 MOVE per CARRY, so it never fatigues
  // and covers a tile in at most 1 tick), cheap enough to check per-candidate without a real path search.
  // Keeps a transport creep near the end of its life from locking onto a pickup (e.g. a remote container)
  // it will die en route to, stranding the energy and wasting the trip. Undefined/false means unchecked,
  // matching every existing caller's behavior.
  | { find: "dropped"; share?: Share; prefer?: Prefer; unlessSpawnNeedsEnergy?: boolean; requireReachableAlive?: boolean }
  | { find: "tombstone"; share?: Share; prefer?: Prefer; requireReachableAlive?: boolean }
  | { find: "ruin"; share?: Share; prefer?: Prefer; requireReachableAlive?: boolean }
  | { find: "source" }
  // structureType/near scope which sites qualify, mirroring the structure spec: a miner builds only the
  // CONTAINER site at its own source, not whatever construction site happens to be nearest.
  // onlyIfCarryOver: a single-CARRY creep (e.g. the base upgrader body) can't afford a long round trip
  // to refill after building — sites farther than this range from the controller are excluded unless the
  // creep's own CARRY part count exceeds the given floor. Range is against the room's controller, not the
  // creep's position, since it gates by the site's inherent distance from where the creep actually works.
  | {
      find: "constructionSite";
      structureType?: StructureConstant;
      near?: "assignedSource" | "controller" | "notController";
      share?: Share;
      prefer?: Prefer;
      onlyIfCarryOver?: { carry: number; range: number };
    }
  | { find: "controller" }
  | { find: "creep"; role: RoleName | RoleName[]; where?: "notFull" | "hasEnergy"; share?: Share; prefer?: Prefer } // friendly creep as source/sink, filtered by role
  | { find: "hostile"; prefer?: Prefer } // enemy creep in the room; defaults to "nearest" — a defender wants "mostThreatening" instead
  // The acting creep's squad-mates: every friendly creep sharing the same memory.op value (see
  // operations/operation.ts's owned(), the same op-based ownership stamp), INCLUDING the acting creep
  // itself — a healer can target itself. Squad membership is derived, not stored (see ADR 0006): there is
  // no squadId, just "same op". Ranked with "mostDamaged" (a healer's use), same as a repair pool.
  | { find: "squadMate"; prefer?: Prefer }
  | { find: "id"; id: Id<_HasId> }
  // Groups several specs into one pool (e.g. every viable energy sink) so a step picks the nearest
  // across kinds in one shot instead of falling through a priority-ordered chain of single-kind steps.
  // Each member keeps its own where/share/prefer; "any" itself only decides how the merged pool is ranked.
  // Members exclude "any" (no nesting), "id" and "controller" (both singular, not a search pool).
  | { find: "any"; of: Exclude<TargetSpec, { find: "any" | "id" | "controller" }>[]; prefer?: Prefer };

// Precondition on the CREEP's own store (not the target's `where`); "empty" gates a gather step so a loaded hauler delivers first.
export type When = "empty";

export type Step = ({
  when?: When;
  oneShot?: boolean; // complete on first act instead of waiting for store to empty; needed for creep sinks, which never "fill"
}) &
  (
    | { do: "harvest"; from: TargetSpec }
    | { do: "withdraw"; from: TargetSpec; resource?: ResourceConstant }
    | { do: "pickup"; from: TargetSpec }
    // Like withdraw/pickup but picks the right game call per resolved target — a "from" spec (e.g.
    // energySourceGroup()) may resolve to either a dropped Resource (needs pickup) or a store-holder
    // (needs withdraw), and the step shouldn't have to commit to one verb ahead of knowing which.
    | { do: "gather"; from: TargetSpec; resource?: ResourceConstant }
    | { do: "transfer"; to: TargetSpec; resource?: ResourceConstant }
    | { do: "build"; at?: TargetSpec }
    | { do: "repair"; at: TargetSpec; upTo?: number }
    // Dismantle a structure (e.g. an invader core) at range 1. Store-less like attack — never
    // self-completes on store state, only via targetGone once the structure is destroyed.
    | { do: "dismantle"; at: TargetSpec }
    | { do: "upgrade" }
    | { do: "reserve" } // reserve the current room's controller — a claimer's whole job, once it has arrived
    | { do: "claim" } // claimController on the current room's controller — a colonizer's whole job, once it has arrived
    // Top up ticksToLive at a spawn in the creep's targetRoom, but only below `below` ticks — a no-op
    // (falls through to the next step) above that threshold or while targetRoom has no spawn yet. Unlike
    // reserve/claim this never holds the creep in place once satisfied: renewCreep is called once per
    // tick it's actually needed, same "act or fall through" shape moveToRoom already has with no dest.
    | { do: "renew"; below: number }
    // Engage the nearest hostile: ranged-attack at range 3 if the body has RANGED_ATTACK, else close to
    // melee range 1. Never self-completes on store state (a fighter carries nothing) — only targetGone
    // (no hostile left in the room) ends it, same as reserve.
    | { do: "attack"; from: TargetSpec }
    // Heal the resolved target: creep.heal() at range 1 (full HEAL_POWER), creep.rangedHeal() at range
    // 2-3 (reduced RANGED_HEAL_POWER), closing distance via travelTo when out of range 3 entirely. No
    // kiting logic (unlike attackStep) — a healer just needs to get in range and heal. Store-less like
    // attack — never self-completes on store state, only via targetGone (target gone/no longer resolves).
    | { do: "heal"; at: TargetSpec }
    | {
        do: "moveToRoom";
        room?: string;
        to?: "scoutTarget" | "targetRoom" | "buildTargetRoom" | "repairTargetRoom" | "defendTargetRoom" | "attackTargetRoom";
        // Steer wide of source keepers and hostile creeps while travelling (see moveToRoom's
        // dangerCostMatrix). Only meaningful for a role with no means to fight back — a defender/attacker
        // walking toward hostiles on purpose must never set this, or it'd path away from its own target.
        avoidDanger?: boolean;
      } // static room, or a memory field name, to read the destination + memory.route from creep memory
    | { do: "sit"; pos: { x: number; y: number } } // for the anchor logistics sitter
    // Travels toward a position read off creep memory rather than a literal (unlike "sit"): Drain's
    // squad formation/advance-retreat target is recomputed fresh every tick by the operation (see
    // operations/drain.ts), so — unlike "sit"'s fixed anchor spot — it can't be a constant in the role's
    // step list. No-ops (falls through) while memory.squadTargetPos is unset, same "static field, memory
    // field name" split moveToRoom's `to` already has. Room-crossing via travelTo, same as "sit".
    | { do: "moveToPos"; to: "squadTargetPos" }
  );

export interface TaskState {
  step: number;
  target?: Id<_HasId>;
}

// What a body calculator may know beyond the energy budget (e.g. container/link presence).
export interface BodyContext {
  hasContainer: boolean;
  hasLink: boolean;
  // A container construction site exists at the source but isn't built yet. Grants a drop-miner one CARRY
  // so it can harvest into its store and help build (and later repair) its own container, rather than
  // dropping everything and standing idle while a builder does all the work.
  hasContainerSite?: boolean;
  roads?: boolean; // whether the creep's route is paved; unused by body calculators today, reserved for MOVE-ratio tuning
  // This body is for a source in a remote room, not the home room — no paved road home is assumed, so a
  // miner needs a full MOVE per non-MOVE part rather than the home bunker's road-subsidized half ratio.
  remote?: boolean;
  // Only meaningful when remote is true: is the remote room currently reserved by us? Reserved sources
  // regen at the same 10/tick rate as home sources (worth the full WORK target); unreserved ones regen at
  // half that, so staffing to the full target would only buy idle WORK parts.
  reserved?: boolean;
}

export interface RoleDef {
  body: (energy: number, ctx: BodyContext) => BodyPartConstant[];
  steps: Step[];
  priority: number;
  // Opt in to opportunistic en-route pickup while travelling to a gather target (behaviors/sweep.ts).
  sweep?: boolean;
  // Opt in to stepping off a road tile once settled in to build/repair/upgrade, so the creep doesn't
  // block travelling creeps for the whole job (behaviors/roadAvoidance.ts).
  doNotBlockRoads?: boolean;
  // Opt in as a road user: a role that spends its working life pathing between rooms/targets rather
  // than parking on one tile (behaviors/roadAvoidance.ts). stepOffRoad only evacuates for these —
  // no point ceding a tile when nothing nearby actually wants to walk through it.
  mover?: boolean;
  // Opt in to fleeing an armed hostile (behaviors/interpreter.ts's fleeThreat) instead of working on
  // obliviously. Only non-combat roles want this — see Role.flee's doc for the full rationale.
  flee?: boolean;
}
