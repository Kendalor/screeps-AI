# Drain Energy operation: squad without a squad ID, one phase not two

Supersedes nothing; extends the operation pattern from [ADR 0005](0005-empire-colony-operations-staged.md), whose consequences list named "squad coordination" as deferred work. This is that work's first instance.

## Context

Drain Energy sends a fixed 4-creep squad (1 melee attacker + 3 healers) to sit at the edge of a hostile room's tower range, forcing tower energy expenditure, and to push deeper as that expenditure weakens the room's ability to hurt them — with no separate "we've won, now loot" step. Two things this needs don't exist anywhere in the codebase yet: a `heal` behaviour verb, and any notion of creeps moving as a coordinated unit. Both had to be designed from scratch rather than adapted from precedent.

## Decision

**One continuous phase, not attrition-then-breach.** The squad always tries to advance in formation; a per-tick predictive check (projected tower damage at the next tile vs. current heal output, via the existing `combat.ts` formulas) decides whether it may. As the target's towers weaken, the safe distance shrinks and the squad advances further under the same rule — breach is an emergent outcome of one check, not a state the operation tracks or transitions into. Rejected: an explicit `attrition | breach` state field. It would duplicate what the damage check already decides and could disagree with it.

**Squad membership is derived, not stored.** A squad is every creep sharing `op = "drain:<room>"`, discoverable through the `Operation.owned()` pattern `Attack`/`Defense` already use — no `squadId`. This only holds because of two other decisions made together: exactly one drain target per colony, and fixed composition (1 attacker, 3 healers). Multi-squad-per-colony or variable composition would break this and require a real ID; noted so nobody "simplifies" this later without checking those two constraints still hold.

**Leader-relative offsets for formation, built as a swappable unit.** Heal output requires every squad member at range 1 of every other — not the range-3 `HEAL` allows, an explicit tightening for this operation. That rules out loose proximity-following. One squad member (the attacker when alive, else a deterministic pick among survivors) is leader; the other three path to fixed tile offsets relative to it, recomputed each tick, rotated to face travel direction. The leader only advances once all offsets are closed. This is hand-rolled rather than any Screeps-native multi-creep movement helper, and deliberately isolated behind its own module interface — the user asked for this explicitly, to A/B against other formation-movement strategies later without touching the rest of the operation.

**Death and expiry share one path.** Losing a squad member — combat death or `ticksToLive` hitting zero — is handled identically: survivors retreat to the staging room, a replacement is requested, the assembly gate re-applies before advancing again. No pre-spawned rotation to avoid the retreat cycle on predictable expiry. Simpler, and the retreat-to-heal behaviour already exists for the damage case, so expiry costs nothing extra to support.

**Staging room reuses `ScoutInfo.hostile`, no new danger intel.** The squad rendezvouses in the first room along the route where `ScoutInfo.hostile` is false (unscouted treated as safe). No tower-count or lethality caching was added for this — it was considered and deferred, since the target room's own state is already tracked separately (see below) and staging only needs a coarse "is this a hostile-owned room" filter.

**Enemy room snapshot is operation-owned, not general room intel.** Tower energy and storage/room energy observed while the squad has vision are kept in the Drain operation's own memory, scoped to its current target — not folded into `ScoutInfo`. Rejected: extending `ScoutInfo`, which would make one operation's tactical observation log visible to (and mutable by) every other system, for data nothing else currently needs. It's presently observability only — no automatic success/failure trigger reads it yet — which is intentional; automatic breach/failure detection is deferred, not designed away.

**Parallel to `Attack`, not merged into it.** New `src/operations/drain.ts`, `src/empire/drainFlags.ts`, `src/empire/drainSponsor.ts`, mirroring `attack.ts`/`attackFlags.ts`/`attackSponsor.ts` file-for-file. Not folded into `Attack`'s sponsor list or flag namespace despite the structural similarity, because the two operations diverge immediately below that surface: `Attack` is an unbounded pool of independent creeps against a list of targets, Drain is one rigid squad against one target. Sharing the outer shape (flag → sponsor → `ColonyMemory` field → ad hoc Colony attachment) without sharing the inner one would couple two operations that should be free to diverge further (e.g. Drain gaining automatic end conditions later) without renegotiating shared state.

## Consequences

- `Step` gains its first `heal` verb and `TargetSpec` its first squad-scoped `find` variant — both net-new surface area other future roles can reuse, not Drain-specific plumbing.
- The single-target-per-colony and fixed-composition constraints are load-bearing for the no-`squadId` decision above; relaxing either later requires revisiting squad identity, not just tuning a number.
- No automatic success/failure detection exists yet — an operator must manually clear `ColonyMemory.draining` (or remove the flag) to end a drain, indefinitely, even against an empty room. Acceptable for v1; the enemy room snapshot data is already positioned to drive this later.
- Formation movement is intentionally over-engineered relative to what v1 strictly needs (a swappable module instead of inline logic), traded for the ability to A/B a different formation strategy without an operation-wide rewrite.
