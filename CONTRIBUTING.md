# Contributing

Start with [AGENTS.md](AGENTS.md) for a map of the repo, then [CONTEXT.md](CONTEXT.md)
for vocabulary — use the terms it defines, not synonyms.

## Workflow

1. `npm test` (unit) before and after a change; `npm run test:integration` for
   anything touching a full tick, spawning, or cross-room behavior.
2. Match the existing test style: unit tests under `test/unit/` mirror `src/`;
   integration tests in `test/integration/` boot a real
   [screeps-server-mockup](docs/watching-a-run.md) colony.
3. If a change reverses a documented architectural decision, add an ADR under
   [docs/adr/](docs/adr/) that says what it supersedes (see any existing ADR for
   the shape). Only write one when the decision is hard to reverse, would
   surprise a future reader without context, and came from a real trade-off —
   not for routine changes.
4. If a change introduces or redefines domain vocabulary, update
   [CONTEXT.md](CONTEXT.md) in the same change, not after.
5. `npm run lint` before pushing.

## Testing a change against a live bot

Don't hand-simulate — use the `debug-local` skill (local pserver) or `debug-main`
skill (screeps.com) to read Memory/stats and issue console commands against a
running instance. See [docs/console-commands.md](docs/console-commands.md) for
what's available from the in-game console.

## Benchmarks

`npm run bench` / `npm run bench:slow` record economy and RCL-timing milestones
to `test/benchmark/benchmarks.json`. If a change could plausibly move these
(economy, spawning, pathing), run the relevant benchmark and compare — don't
assume a milestone shift is noise without checking sibling runs at the same
commit.
