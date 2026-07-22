# Empire/Colony/Operation replaces the flat systems/ pipeline

> **Superseded by [ADR 0005](0005-empire-colony-operations-staged.md).** The diagnosis
> below stands and is quoted there; the prescription designed the whole hierarchy at
> once and left holes where the pieces meet (whose `RoomSnapshot`, who constructs
> operations, which operation owns a spawned creep). 0005 keeps the target shape and
> stages the work around spawning, where those holes actually bite.

`systems/*.ts` conflated three unrelated things under one name: pure quota math
(`desiredMinerCount` in `logistics.ts`), capability logic that owns a domain concept
end-to-end (`mining.ts`, `defense.ts`), and cross-cutting arbitration (`spawning.ts`
reads every other system's desired count and picks one deficit to fill). Nothing
bundled "everything about mining" in one place — its quota lived in `logistics.ts`,
its structure placement in `mining.ts`, its role definition in the shared `roles.ts`
table — so a new capability had no obvious home and a reader had no single file to
open. Room-scoping was a bare `for (const colony of snap.colonies)` repeated in five
files: correct today, but not a parameter of the abstraction, so multi-room
operation-level state (a remote-mining source assignment, a squad's target) had
nowhere to live once a capability stopped being "one instance per colony."

## Decision

Three-tier structure, all still pure (fixture-in, `Intent[]`-out, no `Game.*` inside
planning code):

```
Empire
 ├─ owns: cross-colony capabilities (spawning arbitration, trading, memory cleanup)
 ├─ colonies: Colony[]
 └─ plan(): Intent[] — runs each colony, then its own capabilities, in tier order

Colony (one per owned room)
 ├─ snapshot: ColonySnapshot (extends RoomSnapshot)
 ├─ operations: Operation[] — this colony's home Mining + whatever it sponsors
 ├─ desiredCensus(): Census — merges operations' desiredCreeps()
 └─ canAfford(op): boolean — commitment check against its own operations

Operation (e.g. Mining, RemoteMining, Steal, future Military ops)
 ├─ desiredCreeps?(): Partial<Census>
 └─ plan(colonySnap, empire): Intent[]
```

### Operations, not a fixed capability-per-colony list

A colony's `Mining` is always present; `RemoteMining` and other operations are
constructed fresh **every tick** from typed Memory and live flags — no
`start()`/`pause()`/`wrapUp()` lifecycle (that machinery was already killed once,
for good reason: `ColonizeOperation.wrapUp` running unconditionally every tick was
exactly the bug class it caused). A flag's *existence* is a standing order
(`remote-mine`, `rally`); one-shot commands (`claim`, `nuke`) translate to a
`cmd.*` call and remove their own flag. This restores the flag-command boundary
`rewrite-skeleton.md` §6 already specified but that never got built.

Composition, not inheritance: `RemoteMining` holds a `Mining` instance internally
and adds claim-creep logic around it, rather than extending a `MiningOperation`
base class. A `CenterRoomMining` composing `Mining` + attack/defend logic doesn't
need the hierarchy question ("does this extend Mining or RemoteMining?") answered
up front, and none of the operations are coupled to another's internals.

Multiple instances of the same operation type coexist on one colony (one
`RemoteMining` per target room). A single operation instance may claim more than
one role name (`Steal` wants both `attacker` and `hauler`), and multiple operation
instances may legitimately want the same role concurrently (home `Mining` and two
`RemoteMining` instances all wanting `miner`). `Colony.desiredCensus()` sums
`desiredCreeps()` contributions per role across all of a colony's operations —
there is no exclusivity between operations over a role name, only between the
*creeps* eventually spawned to fill it — and that exclusivity is real: a `miner`
spawned for a `RemoteMining` targeting W2N1 must not drift back to harvest the
home room's source just because a generic `{find: "source"}` step would resolve to
whichever source is nearest/notFull. `CreepMemory` gains an `assignment?: { room:
string }` field, set from the spawn `Intent`, alongside the existing `home` field
(which already scopes a creep to its colony). A role's `TargetSpec` resolution
uses `assignment?.room ?? home` as its search room, not "current room" or "any
matching target empire-wide" — this is what actually keeps two Mining-family
operations on one colony from interfering with each other's creeps, not an
exclusivity rule between the operations themselves.

### State: typed Memory at the boundary, same pattern as ColonySnapshot

Being reconstructed every tick is fine because durable state never lives on the
instance — it lives in a typed Memory slice keyed by the operation's stable
identity (flag name for flag-driven operations, room name for home Mining),
resolved into the operation's constructor arguments exactly like
`buildColonySnapshot` already resolves `ColonyMemory.anchor` today. Writes go back
out through the existing `Intent` → `execute.ts` boundary (a new intent variant per
write-case, e.g. `recordRemoteSourceSpot`), so "what wrote this Memory field" still
has exactly one answer regardless of how many operation types exist.

### RoomSnapshot vs ColonySnapshot

`ColonySnapshot` assumes ownership (spawns, `controller.my`, census) and cannot
represent a remote-mining target room, which may have partial or stale visibility.
`RoomSnapshot` is the ownership-free subset (terrain, sources, hostiles,
structures, a `visible` flag); `ColonySnapshot extends RoomSnapshot`. An operation
that needs a target room's data takes a `RoomSnapshot` alongside its home colony's
`ColonySnapshot`, rather than every consumer of `ColonySnapshot` gaining optional
ownership fields — the null-check pyramid the original rewrite already killed once.

### Capability/Operation interface

Fixed, small, multi-method — not one `plan()` with private internals hiding
cross-capability reads:

```ts
interface Operation {
  desiredCreeps?(): Partial<Census>;
  plan(colony: ColonySnapshot, empire: EmpireSnapshot): Intent[];
}
```

`Colony.desiredCensus()` polls `desiredCreeps()` across its own operations and
merges — callers (Empire-level spawning) never need to know which operations a
colony runs, only that it can answer "what do you want."

### Roles: one file per role, not one growing table

`behaviors/roles/<role>.ts` exports one `{body, steps}` each; `roles/index.ts`
assembles `ROLES` and `roleDef()`. Role-specific body math (e.g. `minerBody`'s
container/link branching) lives with that role; only genuinely shared body-math
utilities (`affordableSets`, `orderBody`) stay in `behaviors/body.ts`. Steps remain
the existing declarative `TargetSpec`/`Step` vocabulary — that part already worked
and isn't changing.

### Creep-to-operation binding

A role's step list (`{find: "source"}`, `{find: "structure", ...}`) resolves
targets by searching a room, and with multiple same-role operations per colony
(home `Mining` plus N `RemoteMining` instances) a bare "current room" or
"empire-wide nearest" search would let a remote miner's creep drift back into the
home room, or vice versa. `CreepMemory` gains `assignment?: { room: string }`,
set from the spawn `Intent` alongside the existing `home` field; `TargetSpec`
resolution searches `assignment?.room ?? home`. This is what actually partitions
operations' creeps from each other — not an exclusivity rule between operations
(there is none; see "Operations, not a fixed capability-per-colony list" above).

## Consequences

- Adding a capability means adding one `Operation` class in one file, not editing a
  shared table plus a shared quota file plus a shared role table. "Everything about
  mining" is one file again.
- Multi-room is structural: a `RemoteMining` instance's target room is a
  constructor argument, not a loop variable a future author has to remember to add.
- The `Intent` union keeps growing as operations gain their own memory write-cases
  — accepted cost, reviewed in one file, same tradeoff already made for
  `recordSourceSpot`.
- `spawning.ts`'s current flat `PRIORITY` list and `systems/*.ts` module layout are
  superseded; migration is a real rewrite of `src/systems/`, `src/behaviors/roles.ts`,
  and `src/kernel/tick.ts`, plus every test that currently calls a bare planner
  function. Sequencing: migrate one operation (`Mining`, smallest surface) through
  the full new shape first as the proof case before moving the rest.
- Squad/formation coordination (creeps in one operation needing shared state beyond
  their own step list) is explicitly deferred — not designed here, revisit when a
  concrete squad operation is being built rather than speculatively now.
