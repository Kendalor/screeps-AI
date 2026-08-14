# Watching a run & energy metrics

Two tools for seeing *why* a colony behaves the way it does, beyond the pass/fail
of the integration milestones.

## 1. Energy metrics (headless, in the integration harness)

`test/integration/energyMetrics.ts` accounts for every unit of source energy over
a run. It is pure logic over per-tick world observations (unit-tested in
`test/unit/energyMetrics.test.ts`), so any scenario can fold it in:

```ts
import { EnergyMetrics, observeTick, type RawObj } from "./energyMetrics";

const m = new EnergyMetrics();
const seen = new Set<string>();
await colony.runUntil(pred, maxTicks, async () => {
  m.sample(observeTick((await colony.roomObjects()) as RawObj[], seen));
});
console.log(m.report());
```

`report()` gives:

| field | meaning |
| --- | --- |
| `harvested` | source energy actually drained |
| `wasted` | energy still in a source at its regen reset — income no miner took in time |
| `decayed` | dropped energy that vanished unpicked (only dropped resources decay) |
| `sinks.upgrading` | controller progress gained (energy spent on the controller) |
| `sinks.construction` | site progress gained (energy spent building) |
| `sinks.creeps` | body cost of creeps spawned |
| `perTick.{harvested,wasted}` | the above averaged over ticks sampled |

**Reading it:** a source yields ~6.67 energy/tick (2 sources ≈ 13.3). If
`perTick.wasted` is a large fraction of `harvested`, the workforce is not
draining the sources — the bottleneck is harvest/logistics, not building. If
`sinks.upgrading` is ~0 while `construction`/`creeps` are large, the colony is
pouring everything into growth and never touching the controller.

## 2. Watching the room live in the Steam client

The integration harness uses `screeps-server-mockup` — headless, no UI. To watch
a room render live, run a full local private server instead. `screeps.json`
already has a `pserver` entry pointing at `http://localhost:21025` (gitignored —
change the `email`/`password` to whatever you register in step 3).

**Step 1 — initialise the server (once).** Creates `server/.screepsrc` and
downloads the web assets. Needs the Steam client running, or a Steam Web API key
(https://steamcommunity.com/dev/apikey) passed when prompted:

```
cd server && node ../node_modules/@screeps/launcher/bin/screeps.js init
```

**Step 2 — start it** (backend on localhost:21025; Ctrl-C stops it):

```
npm run watch:server
```

**Step 3 — register an account.** Open the Steam client →
**Private Server → localhost:21025**, and sign up. Use the same email/password
you put in `screeps.json`'s `pserver` block (so `push-pserver` can log in).

**Step 4 — upload this bot** (in another terminal):

```
npm run push-pserver
```

Then spawn from the client and watch. Re-run `push-pserver` after code changes.

**Seeding to a given RCL.** To skip the early grind, connect to the launcher's
CLI (`node ../node_modules/@screeps/launcher/bin/screeps.js cli` in `server/`)
once your controller exists and run:

```
storage.db['rooms.objects'].update({ type: 'controller' }, { $set: { level: 3 } })
```

## What to look for (the open question)

At RCL1–3 the colony is meant to run on **allrounders (bootstrap) only**, scaled
dynamically to drain both sources (20 energy/tick total) and spend it all. It
currently does not: a 4000-tick RCL3 run harvested ~9/tick against a 20/tick
ceiling — under half the sources' output left unharvested. Watch whether the
allrounders actually saturate the sources, and whether specialist roles
(miner/hauler/upgrader) are spawning earlier than they should.
