# Issue tracker: GitHub Issues

Issues and PRDs for this repo live as GitHub Issues in this repo, via the `gh` CLI.

## Conventions

- One feature = one parent issue (title is the feature name; body is the PRD — problem
  statement, solution, user stories, implementation decisions).
- Implementation issues are separate GitHub Issues, linked to the parent via a `Part of #NN`
  comment (or body line) on the child and a "Sub-issues: #NN, #NN" comment on the parent.
- Dependencies between issues are recorded as `Blocked by: #NN` near the top of the blocked
  issue's body or in a comment — GitHub does not auto-track this, so state it explicitly.
- Triage state is a label on the issue (see `triage-labels.md` for the label vocabulary), not a
  `Status:` text line.
- Comments and conversation history are ordinary GitHub Issue comments (`gh issue comment`).

## When a skill says "publish to the issue tracker"

Create a new GitHub Issue: `gh issue create --title "<title>" --body-file <path>` (or `--body`
for short content). Apply the appropriate triage label from `triage-labels.md`.

## When a skill says "fetch the relevant ticket"

`gh issue view <number>` (add `--comments` for the discussion history). The user will normally
pass the issue number or URL directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is the parent issue; a **child** is a separate linked issue.

- **Map**: the parent issue's body — Notes / Decisions-so-far / Fog live there, kept current via
  `gh issue edit <number> --body-file <path>` or appended as a comment.
- **Child ticket**: its own GitHub Issue, linked to the map via `Part of #<parent>`. A `Type:`
  line in the body records the ticket type (`research`/`prototype`/`grilling`/`task`); triage
  label records `claimed`/`resolved` state (extend `triage-labels.md` if those aren't already
  represented there).
- **Blocking**: a `Blocked by: #NN, #NN` line near the top of the body. A ticket is unblocked
  when every issue it lists is closed/resolved.
- **Frontier**: `gh issue list` filtered to open, unblocked, unclaimed child issues of the map;
  first by issue number wins.
- **Claim**: apply the "claimed" label (or assign yourself via `gh issue edit --add-assignee`)
  before any work.
- **Resolve**: post the answer as a comment (`gh issue comment`), close the issue
  (`gh issue close`), then append a context pointer (gist + link) to the map issue's
  Decisions-so-far via `gh issue comment <parent>`.
