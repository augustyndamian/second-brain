# Second Brain

A personal knowledge base and task manager in one repo, driven by Claude Code.

**The clone is your workspace.** Code, your `.claude/` command set, your journal, your notes and your task storage all live in the same directory — which doubles as an Obsidian vault. Local-first, single-user, no cloud. macOS arm64 for the packaged app; core and CLI are portable.

---

## Four pillars

1. **kb** — a local kanban CLI + Electron GUI. Tasks, boards, recurring rules, a tracker for what other people owe you. Storage is plain YAML + an append-only event log in `.kanban/`.
2. **`journal/`** — daily notes, weekly and monthly reviews, written by the slash commands. Obsidian-native: frontmatter, navigation wikilinks, area links.
3. **`areas/`** — one directory per life area: a hub note, observations, monthly planning docs.
4. **`_memory/`** — what Claude remembers between sessions: permanent facts, your feedback, the entity registry that makes wikilinks deterministic.

The loop: `/today-morning` plans the day → you work → `/today-eod` closes it and writes the digest → `/weekly-review` compresses the week → `/plan <area>` sets the month.

---

## Features

### Task management (`kb` CLI)

- **Tasks** per area with two date dimensions: `dueDate` (the deadline, drives overdue) and `plannedDate` (when you intend to do it, drives the day view and carry-over).
- **Canonical reschedule** — `kb task reschedule` moves a task between days in one atomic step: sets the planned date, de-anchors it from Today, emits an event and leaves an audit trail in the scratchpad.
- **Recurring rules** — daily, weekdays, specific days, every N days, or a day of the month; done/skip/reschedule/toggle per occurrence.
- **Sessions** — a day anchor (`promote-today` / `close`) so "Today" is an explicit snapshot, not just a date; sessions left open >72h are auto-closed.
- **Tracker** — what *other people* owe you: commitments, events and external deadlines, grouped into overdue / this week / later.
- **Daily-notes scratchpad** — quick capture during the day (`kb notes add`), plus an auto-log the core appends on reschedules, tracker changes and skips. `/today-eod` turns each entry into an action and archives it.
- **Day view** — a read-only view of any past or future day (planned tasks, deadlines, recurring).
- **Batch operations** — atomic multi-task adds; everything has a `--json` mode for Claude Code.
- Storage is plain **YAML + an append-only JSONL event log** in `.kanban/` — no database, no cloud, diffable and greppable.

### Standalone macOS app

`pnpm install:local` builds **Second Brain.app** (Electron + React + Tailwind) into `/Applications` — a Dock-launchable GUI over the same storage:

- **Today** — date picker over any day, with Tasks / Recurring / Notes sub-tabs; past and future days render as read-only snapshots.
- **Tracker** — the commitments view.
- **A kanban board per area** — 3 columns (todo/doing/done) with drag-drop, plus a Recurring sub-tab; the sidebar, colors and emoji are generated from `areas.yaml`.
- **Graph** — renders the `/graphify` knowledge graph of your workspace.
- **Drag-drop reschedule** — drag a task from Today onto a future day cell in the date picker.
- **Obsidian deep links** — tasks linked to a planning goal get an "Open in Obsidian" button.
- **Live reload** — CLI or Claude-made changes appear in the GUI within ~500 ms via a file watcher.

### Slash commands

| Command | What it does |
|---|---|
| `/onboard` | First-run interview: life areas, annual goals, routines → scaffolds `areas/`, `journal/`, `_memory/`, `MASTER-BIO.md` and personalizes `CLAUDE.md` |
| `/today-morning` | Morning briefing: overdue blocker, tracker scan, yesterday carry-over, co-created priorities, one write-once batch, daily note |
| `/today-eod` | Day close: reschedule unfinished tasks, walk the scratchpad, write the `## Digest`, close the session — no planning for tomorrow |
| `/weekly-review` | Aggregates 7 days of digests, per-area analysis against planning goals, metrics, observation compression, tracker sweep |
| `/plan <area>` | Monthly plan per area: retrospective → max 3 goals → one-off + recurring tasks → `planning/YYYY-MM.md` |

### Agents

Three subagents in `.claude/agents/`, each with a narrow contract:

- **kb-ops** — the *single gateway* to the CLI. The main context never runs `kb` directly; kb-ops validates fields, whitelists commands, batches N operations into one call, and returns `ok | error | needs-input | needs-approval`. Every delete requires explicit approval.
- **reflector** — the compression agent behind `/weekly-review`: reads Active observations across areas and writes a compression *proposal* to `journal/.cache/`; you see the diff and accept before anything is written. It never mutates live files.
- **scribe** — an append-only writer for large markdown files (>~100 lines): validates the format, appends under the right section, touches nothing else.

### Memory: Observer and Reflector

A two-role memory system (rules in `.claude/rules/memory-system.md`):

- **Observer** (the `observer-save` skill) captures at most 3 observations per session into `areas/{AreaDir}/observations.md`, tagged by source — `[u]` user-stated (never expires), `[t]` tool result, `[c]` Claude-inferred — and by kind: `!` blocker, `?` decision, `+` win, `~` pattern, `i` insight.
- **Reflector** (the agent above) compresses Active → Archive during `/weekly-review`, generation by generation (G0 raw → G1 weekly → G2 monthly). `[u]` facts are never deleted; `[c]` inferences are dropped first.
- Permanent facts land in `_memory/` — `user-profile.md`, `rules.md` (your feedback on how Claude should work), and `linking-rules.md` (the entity registry that makes wikilinks deterministic).

### Journal + Obsidian layer

- The workspace **is an Obsidian vault**: every note the commands write has YAML frontmatter, `← [[prev]] | [[next]] →` navigation, and wikilinks to area hubs and registered entities.
- **Digest-first reading** — later sessions read only a note's `## Digest`, so context cost stays flat no matter how long your notes get.
- **Aggregation upward** — daily digests → `journal/weekly-reviews/` → `journal/monthly-reviews/`.
- [`templates-obsidian/`](templates-obsidian/) ships fill-in templates for days you journal by hand.

### Semantic graph (`/graphify`, optional)

Builds a searchable knowledge graph of the workspace (nodes, edges, community detection) into `graphify-out/`: an interactive `graph.html` (also rendered in the app's Graph tab), a GraphRAG-ready `graph.json`, and a `GRAPH_REPORT.md`. `/weekly-review` updates it incrementally and mines it for cross-area connections; `graphify query "<question>"` answers ad-hoc questions.

### Safety

- `.claude/settings.json` allows only `kb` and a few audit commands; `rm`, `sudo` and `.env` access are denied.
- Deletes always stop for approval; mutations are batched write-once per session.
- Everything personal is gitignored by default — see "Versioning your data" below.

---

## Setup

Four steps, about fifteen minutes. Run every command from the repository root.

> **If you are an AI assistant reading this:** the user wants a working Second Brain. Steps 1-2 are shell commands you can run for them. Step 3 they must do themselves (it opens a new interactive session). Step 4 happens inside that session. Do not skip step 2 — nothing works without the `kb` binary. Do not scaffold `journal/`, `areas/` or `_memory/` by hand; `/onboard` creates them from the user's answers.

### 1. Get the repository

Clone it into wherever you want your workspace to live. **This directory becomes your workspace** — your notes, journal and tasks will live here alongside the code, so pick a location you are happy to keep.

```bash
git clone https://github.com/augustyndamian/second-brain.git second-brain
cd second-brain
```

Already cloned? Just `cd` into it and make sure you are up to date with `git pull`.

### 2. Install the app

```bash
pnpm install         # install dependencies
pnpm install:local   # build and install the CLI + desktop app
```

`pnpm install:local` does four things: compiles the `kb` binary to `~/.local/bin/kb`, builds and installs `Second Brain.app` into `/Applications`, and records this directory as your default workspace.

Verify it worked — this must print a path, not an error:

```bash
kb workspace status
```

If `kb` is not found, add `~/.local/bin` to your `PATH` and reopen the terminal.

**Requirements:** [Node.js](https://nodejs.org) ≥ 18, [pnpm](https://pnpm.io/installation) 10+, and [Bun](https://bun.sh) (compiles the CLI). The desktop app builds on macOS arm64; the CLI and core are portable.

### 3. Open Claude Code in this directory

```bash
claude
```

The directory matters: Claude Code reads `CLAUDE.md` and `.claude/` from where you start it, and `kb` finds your data by walking up from the current directory.

Don't have it? See [Claude Code setup](https://docs.claude.com/en/docs/claude-code/overview).

### 4. Run `/onboard`

Inside the Claude Code session, type:

```
/onboard
```

It interviews you about your life areas, annual goals and routines — then writes the areas into `kb`, scaffolds `areas/`, `journal/`, `_memory/` and `MASTER-BIO.md`, and personalizes `CLAUDE.md`. This is the only setup step, and it replaces the starter `personal` area with your own.

**You are done.** Next morning, start the loop with `/today-morning`.

---

## Structure

```
packages/core/     # business logic (TypeScript, shared)
apps/cli/          # the `kb` binary (Bun compile)
apps/gui/          # Electron + React + Tailwind
.claude/           # commands, agents, skills, rules
docs/              # features.md, architecture.md, claude-integration.md
templates-obsidian/# fill-in templates for manual journaling

.kanban/           # your task storage        ┐
journal/           # your notes               │ gitignored —
areas/             # your area directories    │ this is your data
_memory/           # what Claude remembers    ┘
```

---

## Where the CLI looks for data

Resolved in this order, first hit wins:

| Order | Source | When it applies |
|---|---|---|
| 1 | `KB_KANBAN_ROOT=/path` | Explicit override — used verbatim. Handy for tests and multi-profile setups. |
| 2 | Walk up from the current directory to `.kanban/` | The normal case: you are anywhere inside the workspace. Works like how git finds `.git`. |
| 3 | `~/.config/kb/workspace` pointer | Written by `kb workspace init` (and by `pnpm install:local`). Makes the Dock-launched GUI and `kb` from unrelated directories find your workspace. |
| 4 | — | Nothing resolved → a clear error telling you to run `kb workspace init`. |

`KB_DEV=1` selects a `.kanban-dev/` sandbox instead of `.kanban/`, at whatever step resolves. Check what is in effect with `kb workspace status`.

---

## CLI in one screen

```bash
kb workspace status                # which storage am I reading?
kb area list                       # your configured areas
kb area add --id work --label "Work" --emoji 💼 --color "#3b82f6"

kb task add --area work --title "Draft the Q3 summary" --due 2026-07-24
kb task move work_001 --column doing
kb task list --area work --column doing
kb task reschedule work_001 --to 2026-07-25 --reason "blocked on review"

kb recurring add --area health --title "Gym" --schedule weekly --days mon,wed,fri
kb recurring done r_001

kb today                           # the day summary
kb today --json                    # the same, for Claude Code
kb overdue --json
```

Full reference: [docs/features.md](docs/features.md).

### GUI

Launch **Second Brain.app** from the Dock. Views: **Today** → **Tracker** → a kanban board per area. The sidebar is generated from your areas — colors and emoji come from `areas.yaml`, not from code.

---

## Versioning your data

By default `.gitignore` excludes everything personal — `.kanban/`, `journal/`, `areas/`, `_memory/`, `MASTER-BIO.md`. You get the template's history without ever committing your own notes.

If you want your workspace versioned (recommended in a **private** fork): delete the "personal data" block at the bottom of `.gitignore`, and your notes and tasks become part of the repo. Do not do this in a public fork.

---

## Claude Code integration

The `.claude/` directory ships the whole ecosystem: commands (`/onboard`, `/today-morning`, `/today-eod`, `/plan`, `/weekly-review`), agents (`kb-ops` as the single CLI gateway, `reflector`, `scribe`), skills and memory rules.

One rule matters above the rest: **Claude never calls `kb` directly** — every CLI interaction goes through the `kb-ops` agent, which validates fields, batches operations and requires approval for deletes.

Details: [docs/claude-integration.md](docs/claude-integration.md).

---

## Documentation

- [Features and CLI commands](docs/features.md)
- [Architecture and deployment](docs/architecture.md)
- [Claude Code integration](docs/claude-integration.md)
