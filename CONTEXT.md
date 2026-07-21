# Screeps Colony AI

An autonomous Screeps bot that grows a single room from an empty controller to a
self-sustaining colony. This glossary covers the colony's energy economy and the
creep roles that run it.

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

**Deficit**:
The gap between a role's desired census and its live census. Spawn order is derived
from deficits each tick rather than read from a fixed list.
_Avoid_: shortfall, gap, need

**Proportional deficit**:
A role's deficit expressed as a fraction of its own target, used so roles with
different absolute quotas compete for the spawn on equal footing.
_Avoid_: relative need, weighted deficit

**Collector cap**:
The limit on miner headcount imposed by how much energy the colony can actually
collect, preventing miners whose output nobody retrieves.
_Avoid_: hauler gate, miner limit

**Recovery**:
The wipe state in which a colony has zero live creeps and bypasses deficit
scheduling entirely to spawn a single restart creep.
_Avoid_: emergency, panic, bootstrap (which is a role, not a state)
