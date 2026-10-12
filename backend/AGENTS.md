## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Call processing

For further design decisions about call processing inside a stream, follow this repository's implementation. See `docs/call-processing.md` for the inspected pipeline and `.scratch/vox-ai-design/spec.md` for previously agreed requirements and extensions. Resolve processing facts from the code rather than asking the user to redesign them; preserve the agreed stream settings and scoring requirements where the prototype differs.
