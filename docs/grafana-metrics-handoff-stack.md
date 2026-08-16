# Grafana metrics — Part 2: docker-compose stack (NEW repository)

## Status: not started (2026-08-16)

Companion doc: `docs/grafana-metrics-handoff-bot.md` (Part 1, changes to the Screeps bot repo). Part 1
must land first (or at least its Step 1) — this stack has nothing to graph until `Memory.stats` is
populated.

**Goal:** stand up Grafana + a TSDB that graphs the Screeps bot's `Memory.stats`, in a **new, separate
git repository** — none of this runs inside the Screeps sandbox (no network access there).

**Decision: use the established `screepers/screeps-grafana` project, do not build a bespoke
exporter/stack from scratch.** It already ships the poll→TSDB→Grafana pipeline and a working
dashboard, and forwards whatever is in `Memory.stats` verbatim — no schema to write on this side.
Repo: <https://github.com/screepers/screeps-grafana> (org-maintained under `screepers`, the same org
behind `screeps-api`; a `bkconrad/screeps-grafana` lineage also exists but the `screepers` fork is the
one to build on).

```
Screeps Memory.stats (Part 1's job)  →  screeps-grafana's poller  →  InfluxDB  →  Grafana
```

## What `screeps-grafana` actually is (verified from its README/stats.js, 2026-08-16)

- **Convention, not schema.** Its bot-side half (`stats.js` in their repo) is a *template*, normally
  copied into your own bot and edited — writes plain dotted/nested keys into `Memory.stats`, e.g.
  `Memory.stats["room." + room.name + ".energyAvailable"]`, `Memory.stats.cpu.{bucket,limit,used}`,
  `Memory.stats.gcl.{progress,progressTotal,level}`. **This bot already has its own equivalent** (Part
  1) — do not also copy in their `stats.js` template; the two would fight over `Memory.stats.cpu`'s
  shape. Their exporter forwards **everything** found under `Memory.stats` to the TSDB verbatim — no
  allowlist, no schema file to edit on the exporter side, so Part 1's keys just need to exist.
- **Stack: InfluxDB + StatsD + Grafana**, all three as docker-compose services (`docker-compose.yml`,
  `Dockerfile`, `docker-compose.env.example` in their repo root). A `playbook.yml` + `setup.sh` also
  offer an Ansible path for a bare VPS instead of compose — ignore that path, compose is enough here.
  Default Grafana login is `admin`/`admin` — **must be changed**, see Traps.
- **Auth: username/password against the Screeps API**, not a token. This is the one place the project
  shows its age (33 commits, no clear recent-activity signal) — Screeps has since added token auth, and
  password auth may be deprecated/discouraged on screeps.com by now. **Verify current screeps.com auth
  support before configuring** (check `screeps-api`'s current README, since screeps-grafana's own
  poller is likely built on it or an equivalent client) — if password auth no longer works, the
  exporter's auth config needs a small patch to use a token instead. This is the one place an
  "established tool" may still require a few lines of real code, not just YAML/env config.
- **Poll cadence:** the exporter pulls `Memory` on its own interval (StatsD/collector loop), independent
  of the bot's own tick rate. Interval is a config value in their compose env file — set it deliberately,
  don't assume a shipped default is sane for this bot's actual tick cadence.

## Footprint (sizing the host)

Idle, at this bot's metric volume: **~500 MB RAM total, well under 1 CPU core** — Grafana ~150–250 MB,
InfluxDB ~200–400 MB (disk growth negligible at this volume), StatsD collector negligible. Any small
VPS or a Pi is enough.

## Build order

### Step 1 — Fork/clone the new repo
- Fork or clone `screepers/screeps-grafana` into the new repository — do not build a stack from
  scratch; do not copy their `stats.js` template into the bot repo (Part 1 already covers that ground
  with this bot's own conventions).

### Step 2 — Configure
- `docker-compose.env.example` → `.env`: Screeps credentials (see auth caveat above — may need a
  token-auth patch), InfluxDB creds, poll interval matched to this bot's actual tick cadence.
- **Do not commit real credentials.** Confirm `.env` is gitignored before first commit.

### Step 3 — Bring up the stack
- `docker compose up -d`.
- Change the default `admin`/`admin` Grafana login immediately — first thing after the containers are
  healthy, before anything else.
- Done-check: the bundled dashboard shows live data sourced from `Memory.stats.cpu` (Part 1's Step 1
  output) within one poll interval. If nothing appears, check the exporter's auth first (most likely
  failure point per the caveat above), then confirm Part 1 actually landed on the bot side.

### Step 4 — Adjust/extend the dashboard
- The shipped dashboard covers their own `stats.js` template's keys, which won't all exist here (this
  bot writes its own key names, per Part 1). Add/edit panels for this bot's actual
  `Memory.stats.cpu.<system>` keys (and `Memory.stats.fn`/`Memory.stats.rooms` if Part 1 added them).
- Export the edited dashboard JSON back into this repo (`grafana/provisioning/dashboards/*.json` or
  wherever their layout puts it) so it's reproducible from a clean checkout, not left as a hand-clicked
  one-off that a fresh `docker compose up` can't reproduce.

### Step 5 — Docs
- New repo's README: how to get Screeps credentials/token, `.env` setup, `docker compose up -d`, where
  to open Grafana, and a one-line pointer back to the bot repo's `docs/grafana-metrics-handoff-bot.md`
  / `src/kernel/stats.ts` as the source of the keys being graphed.

## Traps to avoid

1. **Don't also copy their `stats.js` template into the bot.** Part 1 already writes `Memory.stats` in
   this bot's own way; adding theirs on top creates two writers fighting over the same keys.
2. **Verify auth before assuming password auth still works** against current screeps.com — the one spot
   the established tool is old enough to plausibly be broken out of the box.
3. **Change the default `admin`/`admin` Grafana password** immediately after first `docker compose up`
   — it's a documented default in a public repo.
4. **Don't commit `.env` with real credentials.** Confirm gitignore before the first commit, not after.
5. **This stack has nothing to show until Part 1 lands.** If dashboards are empty, check
   `Memory.stats` on the bot side (via `debug-main`/`debug-local`) before assuming the stack is
   misconfigured.
