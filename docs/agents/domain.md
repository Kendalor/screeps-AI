# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary for this bot's economy/role vocabulary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Start at the highest-numbered non-superseded ADR in a given area; each one says what it supersedes.

This repo is single-context (one `CONTEXT.md`, no `CONTEXT-MAP.md`).

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-deficit-scheduled-spawning.md
│   ├── ...
│   └── 0007-squad-movement.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids (e.g. Hauler vs Supply are opposite directions, never interchangeable).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (squad movement) — but worth reopening because…_
