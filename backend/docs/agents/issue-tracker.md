# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file.
- Triage state is recorded as a `Status:` line near the top of each implementation issue file; use the role strings in `triage-labels.md`.
- Comments and conversation history append to the bottom of the file under a `## Comments` heading.

## Publishing to the issue tracker

Create the corresponding spec or ticket file under `.scratch/<feature-slug>/`, creating the directory if needed.

## Fetching the relevant ticket

Read the file at the referenced path. The user will normally pass the path or the issue number directly. If a number matches multiple features, resolve the feature before editing.

## Wayfinding operations

Used by `/wayfinder`. The map is a file with one child file per ticket.

- **Map**: `.scratch/<effort>/map.md` with Notes, Decisions-so-far, and Fog sections.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records `research`, `prototype`, `grilling`, or `task`. A `Status:` line records `open`, `claimed`, or `resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for open, unblocked, unclaimed tickets; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a summary and ticket link to Decisions-so-far in `map.md`.
