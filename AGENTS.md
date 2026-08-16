# Agent notes

Autonomous Screeps bot (TypeScript). Grows a room from empty controller to a
self-sustaining, multi-colony empire — economy, remote mining, defense, and
squad-based offense.

# Mistakes
For every session record mistakes in a mistakes.md.
Be aware of old mistakes in mistakes.md

## Orient yourself

- **Vocabulary** — [CONTEXT.md](CONTEXT.md) is the glossary. Read it before naming
  anything; it's opinionated about which term wins (e.g. Hauler vs Supply are
  opposite directions, never interchangeable).
- **Architectural history** — [docs/adr/](docs/adr/) records why the current shape
  won over alternatives. Start at the highest-numbered non-superseded ADR in a
  given area; each one says what it supersedes.
- **Entry point** — [src/main.ts](src/main.ts) → [src/kernel/tick.ts](src/kernel/tick.ts)
  drives one game tick: load memory, run empire → colony → operation → behavior
  layers, execute intents.
- **In-game commands** — [docs/console-commands.md](docs/console-commands.md).
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md).
- **Screeps engine reference** — [docs.screeps.com](https://docs.screeps.com/index.html)
  and the [API reference](https://docs.screeps.com/api/), for game rules and
  engine behavior this codebase is built against.

## Source layout

Roughly top-down per tick:

| dir | what |
| --- | --- |
| `src/empire/` | cross-colony decisions: flags, sponsorship, colonize targets |
| `src/operations/` | one file per operation kind (mining, defense, drain, parade, …) |
| `src/colony/` | per-room building/metrics |
| `src/behaviors/` | per-role creep logic (`roles/`), the step interpreter, movement |
| `src/logistics/` | energy routing between sinks and sources |
| `src/mining/` | remote-source selection and economics |
| `src/spawn/` | body composition and spawn requests |
| `src/intents/` | the only place game-mutating calls (`creep.move`, etc.) happen |
| `src/kernel/` | tick driver, Memory schema for colony/creep, stats |
| `src/memory/` | Memory load/migrate/cache |
| `src/snapshot/` | per-tick read-only room/colony snapshots behaviors act on |
| `src/layouts/` | bunker/stamp placement, road planning |
| `src/lib/` | traveler (pathing), combat math, profiler, squad math |
| `src/commands/` | console command registration |

Tests mirror this under `test/unit/`; `test/integration/` boots a real
[screeps-server-mockup](docs/watching-a-run.md) colony; `test/benchmark/` tracks
economy/RCL-timing regressions over many ticks.

## Debugging a live bot

Use the `debug-local` skill (pserver) or `debug-main` skill (screeps.com) rather
than guessing — they know how to read Memory/stats and send console commands.
Do not Guess each deduction must be based on evidence. Make sure to know how Ticks change Gamestate. 

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/<feature-slug>/` in this
repo, not GitHub Issues. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`), unmodified. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context: one [CONTEXT.md](CONTEXT.md) + [docs/adr/](docs/adr/) at the repo
root. See [docs/agents/domain.md](docs/agents/domain.md).
