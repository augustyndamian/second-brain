# Second Brain — workspace instructions

This repo is a **workspace**, not just an app: code + `.claude/` + your data in one place. Four pillars:

1. **kb** — local kanban CLI/GUI. Tasks, boards, recurring rules, tracker. Storage: `.kanban/` (YAML + event log).
2. **`journal/`** — daily notes, weekly and monthly reviews. Written by the commands, Obsidian-native.
3. **`areas/{AreaDir}/`** — one directory per life area: hub note, `observations.md`, `planning/YYYY-MM.md`.
4. **`_memory/`** — permanent facts (`user-profile.md`), feedback (`rules.md`), entity registry (`linking-rules.md`).

## Hard rules

- **Never call `kb` directly.** Every CLI interaction goes through the `kb-ops` agent — one spawn per session, `SendMessage` for follow-ups.
- **Digest-first.** Reading a past day: if the note has a `## Digest` section, read that section only, not the whole file.
- **Observer max 3 per session.** Append under `## Active` in `areas/{AreaDir}/observations.md`. Format: `.claude/rules/memory-system.md`.
- **Context routing.** A question about an area → load `areas/{AreaDir}/{AreaDir}.md` + its `observations.md`. Do not load other areas.
- **Writes to files over ~100 lines** go through the `scribe` agent (append-only, verbatim).
- **Wikilinks** follow `_memory/linking-rules.md`. Entity not listed there → plain text.

## Commands

`/onboard` (first run) · `/today-morning` · `/today-eod` · `/plan <area>` · `/weekly-review`

SSoT for how the integration works: [`docs/claude-integration.md`](docs/claude-integration.md). Task payload schema: `.claude/skills/kb-task-payload.md`.

<!-- onboard:begin -->
_Not personalized yet. Run `/onboard` to set up your areas, goals and preferences._
<!-- onboard:end -->
