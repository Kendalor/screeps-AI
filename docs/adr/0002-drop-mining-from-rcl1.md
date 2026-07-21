# Drop mining from RCL1, with creeps as transfer targets

Previously `bootstrap` was the entire pre-container economy: it harvested and
carried its own energy, and miners only became worthwhile once a container existed
(RCL3+). That wastes the early game, because a harvest-and-carry creep spends most
of its life walking rather than mining.

Miners now spawn from RCL1 as pure `[WORK,WORK,MOVE,MOVE]` drop miners with no
CARRY, letting energy fall to the ground for collectors to retrieve. Container
gating is unchanged (`CONTAINERS_FROM_RCL = 3`), so the RCL1→RCL3 window is served
entirely by drop piles. To make that work, energy transfer between creeps becomes
first-class: haulers may deliver to working consumers, and consumers may withdraw
from haulers. Both sides of a rendezvous may move, and movement stops when the
target-locked partner is within transfer range.

## Creeps as targets

`toKind()` discriminates target kinds by marker fields, and a creep has none of
them — it would fall through to `null` and be dropped as an invalid lock every tick,
making a rendezvous impossible to hold. It gains an explicit creep case.

A locked creep stays valid while it is **alive and still useful for the step's
direction**: a hauler locked for delivery stays valid while it has free capacity, a
hauler locked as a withdraw source while it still holds energy. This reuses the
existing `matchesWhere` where-clause vocabulary rather than inventing a second
predicate language.

Pairing is deliberately **not** modelled as shared state. Each side revalidates its
own lock independently every tick, so a partner that was filled or emptied by
someone else is released within a tick. There is no pair object to desynchronise and
no new memory schema to clean up on death or role change.

## Worthwhile amount

The floor below which a pile is not worth walking to is expressed as a **fraction of
the collector's free capacity** (plus a small absolute floor), not a single
constant — 50 energy is significant to an early hauler and noise to a late one, and
a fraction scales without retuning.

Because a decaying pile would eventually fall below every collector's threshold and
be orphaned, the fraction filters **preference, not eligibility**: when no pile
clears the bar, collectors fall back to the unfiltered set. This is the same
"stranding is worse than doubling up" fallback `resolveTarget` already applies to
share caps.

## Consequences

Dropped energy decays, so the early economy now has a loss term it did not have
before — mitigated by capping miner count at collector capacity and by the
worthwhile-amount preference. The mutual-lock plus range-stop rule is what prevents
two mutually-seeking creeps from oscillating.
