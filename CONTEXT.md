# Screeps Colony AI

An autonomous Screeps bot that grows a single room from an empty controller to a
self-sustaining colony. This glossary covers the colony's energy economy and the
creep roles that run it.

For where things live in the repo, see [AGENTS.md](AGENTS.md). For why the
architecture is shaped the way it is, see [docs/adr/](docs/adr/).

## Language

### Roles

**Miner**:
A creep that parks at a source and harvests it, never transporting the energy
itself. Its output accumulates as a drop pile or falls into a container beneath it.
_Avoid_: harvester, digger

**Hauler**:
A creep that carries energy from where it is produced to where it is consumed. It
never harvests.
_Avoid_: carrier, transporter, courier, mule

**Supply**:
A hauler-bodied creep that runs the opposite direction: from storage out to spawn
and extensions. Distinct from Hauler, which runs source-to-storage.
_Avoid_: refiller, distributor

**Bootstrap**:
The generalist stopgap creep that harvests, builds, upgrades and supplies in one
body. It exists only to cover work no specialist is alive to do yet, and its
population is expected to shrink toward zero as specialists spawn.
_Avoid_: allrounder, generalist, worker, jack

**Consumer**:
Any creep that spends energy rather than moving it — upgrader, builder, or
bootstrap. Named as a group because energy-acquisition rules apply to all three
identically.
_Avoid_: worker, spender

**Collector**:
Any creep that gathers energy from a drop pile — haulers and consumers both. Named
as a group because pile claiming and share caps apply to both.
_Avoid_: picker, gatherer

### Energy flow

**Drop mining**:
The arrangement where a miner harvests without carrying, letting energy fall to the
ground for collectors to retrieve. The colony's default before containers exist.
_Avoid_: floor mining, ground mining

**Drop pile**:
Ground-level energy under or beside a source, produced by drop mining. Unlike a
structure, it is consumed to nothing and decays over time.
_Avoid_: dropped resource, ground stack, scrap

**Worthwhile amount**:
The minimum energy a candidate source must hold before a creep will walk to it,
filtering out trivial scraps that cost more travel than they return.
_Avoid_: threshold, minimum, floor

**Rendezvous**:
A hauler and a consumer that have target-locked each other for a hand-off. Both may
close the distance; movement stops once the partner is in transfer range.
_Avoid_: meetup, handshake, pairing

**Source saturation**:
The WORK capacity that fully consumes a source's regeneration. A source yields 10
energy/tick and a WORK part harvests 2/tick, so 5 WORK is exact saturation and the
colony deliberately provisions slightly above it to cover travel and replacement gaps.
_Avoid_: max harvest, full mining

### Spawn scheduling

**Request**:
A single creep a requester has decided is missing, carrying the body, the priority
and the complete creep memory to spawn it with. Always exactly one creep — a
requester short three haulers emits three requests.
_Avoid_: order, job, entry, queue item, spawn task

**Requester**:
Whatever states demand for creeps. Colony-scoped functions today; operations later.
A requester computes its own bodies and runs its own satisfaction check — nothing
does that on its behalf.
_Avoid_: producer, provider, client

**Arbiter**:
The single consumer that decides which requests actually become creeps, by priority
and affordability. It knows nothing about roles.
_Avoid_: scheduler, dispatcher, manager

**Satisfaction check**:
A requester's own reading of the colony's live creeps to decide what is still
missing. Distinct from validation or reconciliation: there is no ledger to prune,
so nothing can drift and nothing needs repairing.
_Avoid_: validation, reconciliation, sync

**Deficit**:
What a requester finds missing during its satisfaction check. Not necessarily a
count — a deficit may be per assignment ("this source has no miner") or per body
("this source lacks 6 WORK"), which is why it is not expressed as a census gap.
_Avoid_: shortfall, gap, need

**Assignment**:
The specific job a creep was spawned for, carried in its memory beyond its role — a
miner belongs to a *source*, not merely to mining. Two creeps of the same role for
the same requester are told apart by their assignment.
_Avoid_: task (which is behaviour progress), binding, allocation

**Collector cap**:
The limit on miner headcount imposed by how much energy the colony can actually
collect, preventing miners whose output nobody retrieves.
_Avoid_: hauler gate, miner limit

**Recovery**:
The wipe state in which a colony has zero live creeps. Its restart creep is an
ordinary request at a reserved top priority, sized against energy actually
available rather than capacity — a dead colony has nothing to fill its extensions.
_Avoid_: emergency, panic, bootstrap (which is a role, not a state)

### Military

**Squad**:
A fixed group of creeps belonging to one military operation, sharing a single
`op` value and required to be complete before it may enter a target room. A
squad's membership is derived from its creeps' `op` and role, never a separate
ID — an operation scoped to one target already identifies its own squad.
_Avoid_: party, group, formation (formation is squad behaviour, not the squad itself)

**Staging room**:
The room a squad gathers in before entering a target room — the nearest room on
the route that isn't itself a hostile-owned target. Distinct from Rendezvous,
which is a hauler/consumer pairing in the energy economy, not a military
assembly point.
_Avoid_: rendezvous (already means the hauler/consumer hand-off), forward base, muster point

**Assembled**:
A squad's readiness gate: every creep the operation requires is alive and
present in the staging room. An assembled squad may advance into the target
room; an incomplete one waits or retreats to the staging room instead.
_Avoid_: ready, formed up

**Leader**:
The squad member whose position the rest of the squad paths relative to while
holding formation. Chosen by role when a role-appropriate member is alive;
otherwise picked deterministically among whoever remains.
_Avoid_: point, anchor

**Enemy room snapshot**:
A military operation's own running record of what it has observed of a target
room over time — tower energy, storage/room energy — kept to judge whether
sustained pressure is having an effect. Owned by the operation, not general
room intel; a different operation targeting the same room keeps its own.
_Avoid_: intel (too broad — this is one operation's observation log, not a
general-purpose record)
