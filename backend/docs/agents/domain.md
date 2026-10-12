# Domain docs

This repo uses a single-context domain documentation layout.

## Before exploring

- Read `GLOSSARY.md` at the repo root.
- Read decisions in `docs/adr/` that touch the area you are about to work in.

If these files do not exist, proceed silently. Do not flag their absence or suggest creating them upfront. Create them as domain terms or decisions are resolved; the `/domain-modeling` skill can handle this when installed.

## File structure

- `GLOSSARY.md`: shared domain vocabulary at the repo root.
- `docs/adr/`: architectural decision records, with numbered files such as `0001-<decision>.md`.

## Use the glossary's vocabulary

When naming a domain concept in an issue title, proposal, hypothesis, or test, use the term defined in `GLOSSARY.md`. Avoid synonyms the glossary explicitly excludes.

If a needed concept is missing, reconsider whether it belongs to the domain or record the gap for later domain modeling.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain the reason for reopening the decision instead of silently overriding it.
