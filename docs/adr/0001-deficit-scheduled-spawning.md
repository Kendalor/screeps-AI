# Deficit-scheduled spawning replaces the fixed priority list

Spawn order was a fixed array (`PRIORITY = ["bootstrap", "miner", "hauler", …]`)
where the first unmet deficit won. That cannot express the ramp the colony actually
needs, because roles depend on each other: miners are useless before a collector
exists to retrieve their output, so a strict list either builds miners too early or
never interleaves roles at all.

Spawn order is now derived each tick from each role's **proportional** deficit
(missing ÷ desired), so roles compete on equal footing regardless of quota size and
the ramp interleaves on its own. Two guards shape it: miner headcount is capped by
available collector capacity, and bootstrap is sized as the summed deficit of every
other role × 1.5 (a generalist body is less efficient than the specialist it stands
in for). Recovery — zero live creeps — stays a pre-scheduler escape hatch that
bypasses deficit math entirely.

## Breaking the quota cycle

Bootstrap's quota depends on every other role's deficit, so nothing else may depend
on bootstrap's, or the two chase each other upward. **Only haulers count toward the
miner collector cap** — bootstraps are excluded, which removes the circular term.
Bootstraps still opportunistically collect drop piles; the cap is about sustained
throughput, not pickup.

That exclusion creates a cold-start deadlock of its own: hauler demand derives from
miner output, so with zero miners there is zero hauler demand, zero collector cap,
and no miner is ever wanted. The seed is a **floor of one miner while zero haulers
are alive** — that miner's drop pile produces the output that makes throughput
matching ask for a hauler, after which the cap governs normally. Scoping the floor
to "no haulers alive" means it cannot cause over-mining later, and it doubles as
useful behavior after a hauler wipe.

## Consequences

Spawn order is no longer readable from a single constant; understanding why a given
creep spawned means evaluating the quota functions. In exchange, no hand-authored
sequence has to be maintained as quotas change, and role dependencies are expressed
as caps rather than as list position.

Quota functions must be evaluated as a one-way pipeline — live census in, desired
counts out — with bootstrap computed last. A future quota that reads another role's
*desired* count would reintroduce the cycle.
