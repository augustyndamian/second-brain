# Second Brain — Claude Code integration

The complete `.claude/` ecosystem (slash commands, agents, skills) built around the `kb` CLI. This document is the SSoT for the integration: architecture, the daily/weekly/monthly loops, entity reference, configuration and limitations.

---

## 1. Overview

Two tracks:

```
EXECUTION TRACK (tasks)
/onboard  /today-morning  /today-eod  /plan  /weekly-review (§7d)
        │  Agent / SendMessage (structured request)
        ▼
.claude/agents/kb-ops.md      ← the ONLY bridge to the CLI
        │  bash: kb ... --json
        ▼
   `kb` binary  →  storage .kanban/ (YAML + JSONL)

MEMORY TRACK (markdown workspace)
/today-eod §3, /weekly-review §7b-7c, ad-hoc sessions
        │
        ├─ observer-save (skill)  → areas/{AreaDir}/observations.md
        ├─ reflector (agent)      → compression proposal → archive
        └─ scribe (agent)         → append-only writes (files >100 lines)
```

Commands orchestrate; `kb-ops` translates structured requests into CLI calls; storage is the single source of truth about tasks. The memory layer writes only to markdown files in the workspace.

---

## 2. Architecture principles

1. **Single gateway** — the main context NEVER calls `kb` via Bash. Everything goes through `Agent(kb-ops)`. Why: field validation/coercion, command whitelist, output sanitization, protection against hallucinated subcommands.
2. **One spawn per session** — kb-ops is spawned ONCE per command session; later requests use `SendMessage` to the same agentId (a re-spawn costs ~20k tokens of cold start).
3. **Write-once batch** — a command collects ALL user decisions, then sends a single bundle of mutations. Zero mutations between question rounds.
4. **Two-layer batching** — N operations → 1 agent call (layer 1); ≥2 ops of the same type → native `*-batch --json -` over stdin (layer 2). Details: `kb-ops.md` §6a.
5. **Status contract** — kb-ops returns `ok | error | needs-input | needs-approval`. `error` only when the `kb` process actually ran and exited non-zero. Deletes are always `needs-approval`.
6. **Want your own sync with external boards** (GitHub Projects, Jira, …)? Write a separate read-only agent following the kb-ops pattern (structured input → compact summary output) and spawn it in parallel with kb-ops in §0a — see `kb-ops.md` §7a.

---

## 3. Component inventory

| File | Type | Role |
|---|---|---|
| `.claude/commands/onboard.md` | command | First-run setup: area interview, kb writes, workspace scaffold, CLAUDE.md personalization |
| `.claude/commands/today-morning.md` | command | Morning briefing: session, overdue blocker, tracker, candidates, write-once batch |
| `.claude/commands/today-eod.md` | command | Day close: read → reschedule → session.close, scratchpad, digest |
| `.claude/commands/plan.md` | command | Monthly plan per area: goals → one-off/recurring tasks → batch → planning doc |
| `.claude/commands/weekly-review.md` | command | Week review: aggregation, insights, observation compression, tracker sweep |
| `.claude/agents/kb-ops.md` | agent | CLI gateway — I/O contract, coercion, validation, batching, whitelist |
| `.claude/agents/reflector.md` | agent | Compresses Active observations → Archive (proposal; never mutates live files) |
| `.claude/agents/scribe.md` | agent | Append-only writer for large markdown files |
| `.claude/skills/kb-task-payload.md` | skill | Task schema SSoT (title/desc+DoD/area/due/priority) |
| `.claude/skills/observer-save.md` | skill | Observation format and routing |
| `.claude/skills/graphify/SKILL.md` | skill | Semantic workspace graph (`/graphify`) — optional module, see §8a |
| `.claude/rules/memory-system.md` | rule | Memory architecture SSoT (Observer/Reflector, source tags, G0→G2) |
| `.claude/templates/Monthly Planning.md` | template | Planning doc template for `/plan` |
| `.claude/settings.json` | config | Permissions (allow `kb`, deny reading the binary) |

---

## 4. Daily loop

**`/today-morning`** (morning, work days):
1. §0 — calendar triggers (weekly review, new month).
2. §0a — ONE kb-ops spawn with a manifest of 8 operations: `session.promote-today` + `today` + `overdue` + `tracking.list` + `notes.read` (yesterday's archive) + 3× `day.view` (look-ahead). Full task payloads come back in the response — main never reads storage itself. Non-empty overdue → hard decision blocker.
3. §0b/§0c — tracker scan (other people's commitments) + scratchpad archive sanity check.
4. §2/§3 — carry-over from yesterday (digest-first), 5-10 candidates with full payloads, insights, batched questions.
5. §6 — the ONLY mutate of the session: every decision (overdue, tracker, anchors, new tasks) in one SendMessage.
6. §7-§10 — daily note in `journal/`, yesterday's digest, summary block, observer.

**`/today-eod`** (evening):
1. §1.1 — one kb-ops spawn, 6 reads (today, overdue, notes-on-done, scratchpad, audit, ghost-check).
2. §1.2 — reschedule unfinished tasks (batch) **BEFORE** §1.3 `session.close` (order is critical — closing first freezes tasks in the snapshot).
3. §1a/§1b — dialogue over notes from done tasks and the scratchpad → actions (task/tracker/journal/observation) → scratchpad archived.
4. §2 — `## Digest` in the journal (carry-over = unfinished-at-close + intra-day reschedules from §1c).
5. §2a/§2b — new commitments into the tracker + reconciliation. §3 observer. §4 STOP (no planning for tomorrow).

## 5. Weekly and monthly loop

**`/weekly-review`** (end of week): aggregates 7 days of journals (digest-first), per-area analysis against planning goals, metrics, a review doc in `journal/weekly-reviews/`, observation compression through `reflector` (proposal → diff → user accepts → write), tracker sweep (read-only). The first review of a month also produces a monthly summary.

**`/plan <area>`** (1st of the month or on demand): retrospective of the previous plan → goals (max 3) → tasks in TWO disjoint categories (one-off: `due`+`priority` | recurring: `schedule`) → pre-flight storage sync → ONE kb-ops batch → planning doc `areas/{AreaDir}/planning/YYYY-MM.md` carrying the CLI ids. Checkpoints involving other people → tracker.

---

## 6. `kb` entity reference

`kb` is a compiled Bun binary at `~/.local/bin/kb`. **The main context never calls it directly — always through `kb-ops`.**

### Entities

| Entity | What | Operations (through kb-ops) |
|---|---|---|
| **Area** | Configurable life areas (`.kanban/areas.yaml`) | `area.list` / `area.add` / `area.edit` / `area.remove` (needs-approval) |
| **Task** | Personal tasks per area | `add` / `add-batch` / `edit` / `move` / `task.reschedule` / `delete` (needs-approval) |
| **Board** | Per area (`b_{area}_main`) | `board.add` / `board.list` |
| **Recurring** | Cyclical (daily/weekdays/weekly/interval/monthly) | `recurring.add` / `recurring.done` / `recurring.skip` / `recurring.reschedule` / `recurring.toggle` |
| **Session** | Day anchor (`active.json` + `today-sessions/{date}.json`) | `session.promote-today` / `session.close` / `session.active` |
| **Tracking** | Other people's commitments + external deadlines | `tracking.add` / `tracking.edit` / `tracking.list` / `tracking.delete` (needs-approval) |
| **Daily notes** | Markdown scratchpad `daily-notes/{YYYY-MM-DD}.md` | `notes.read` / `notes.append` / `notes.archive` |
| **Workspace** | Storage resolution | `workspace.status` / `workspace.init` |

### Two date dimensions + the session anchor

- **`dueDate`** — the deadline (drives overdue)
- **`plannedDate`** — when I intend to do it (drives day-view + carry-over)
- **`active.anchoredTaskIds`** — what is in Today right now (set by `column=doing` or `task.reschedule --to today`)

**Canonical move:** `kb task reschedule <id> --to YYYY-MM-DD --reason "..."`:
1. Sets `plannedDate`
2. Demotes `doing → todo` (de-anchor)
3. Removes it from `active.anchoredTaskIds`
4. Emits a `task.rescheduled` event
5. Appends `[auto:reschedule]` to the daily-notes scratchpad

Never `edit --due` + `move` instead of reschedule — that loses the event and the EOD audit trail.

### Today view contract

`payload` from `kb today --json`:
- `recurring[]` — instances for `active.date` + status
- `tasks[]` — anchored, `dueDate ≥ active.date` or `null`
- `overdue[]` — anchored, `dueDate < active.date`
- `doneTasks[]` — `column=done && completedSessionDate=active.date`
- `dueOnlyToday[]` — `dueDate=active.date && plannedDate≠active.date && column∈{todo,doing}` (flagged in /today-morning §0a)
- `autoClosed` — non-null when a previous session was auto-closed after >72h

### Day view (read-only, any day)

`kb day-view --date YYYY-MM-DD`. States: `active` / `closed` / `auto-closed` / `future` (with `plannedTasks[]` + `dueOnlyTasks[]` + recurring) / `empty`. Used by `/today-morning` for the +1..+3 look-ahead.

### Auto-log in the daily-notes scratchpad

Core appends `[auto:source]` on: `task.rescheduled` → `[auto:reschedule]`, `tracking.edited` (status change) → `[auto:tracker]`, `recurring.skipped` (with a reason) → `[auto:skip]`. `/today-eod` §1b reads the scratchpad, walks through the manual entries, and archives after the batch is confirmed.

Full CLI reference: [`features.md`](features.md).

---

## 7. Task payload schema

Every task the commands create passes one quality schema: imperative title ≤80 chars, 1-3 sentence description with a measurable DoD, `area` from `kb area list`, ISO `due` (missing → ask), `priority` 1-10. One-off and recurring are disjoint field sets. SSoT: [`.claude/skills/kb-task-payload.md`](../.claude/skills/kb-task-payload.md).

---

## 8. Memory layer

Three layers of markdown files (`/onboard` creates them; commands degrade gracefully if a file is missing):

1. **`areas/{AreaDir}/observations.md`** (`## Active`) — session observations: `- YYYY-MM-DD | EMOJI | [source] one-liner`. Source tags: `[u]` user (never expires) / `[t]` tool / `[c]` inferred. Emoji: `!` blocker, `?` decision, `+` win, `~` pattern, `i` insight. Max 3 per session.
2. **`areas/{AreaDir}/observations-archive.md`** — compressed by `reflector` during `/weekly-review`: `- WXX | EMOJI | [source] G{N} | entry` (G0 raw → G1 weekly → G2 monthly).
3. **`journal/YYYY-MM-DD.md`** — the daily note (priorities in the morning, `## Digest` in the evening). Digest-first: later commands read the digest, not the whole file.

Full rules: [`.claude/rules/memory-system.md`](../.claude/rules/memory-system.md).

---

## 8a. Semantic graph (graphify) — optional module

The `/graphify` skill (`.claude/skills/graphify/SKILL.md`) builds a searchable knowledge graph out of workspace files (nodes/edges + community detection) — outputs land in `graphify-out/`: an interactive `graph.html`, `graph.json` (GraphRAG-ready) and `GRAPH_REPORT.md`. It wraps the `graphifyy` Python package (self-installing on first run; requires `python3`).

Loop integration (everything degrades gracefully when `graphify-out/` does not exist):
- **`/weekly-review` §7e** — `/graphify --update` after the review is saved (incremental: only changed `.md` files), 1-2 cross-area queries → the `## 🔗 Surprising connections` section, plus an optional link audit from `GRAPH_REPORT.md` Knowledge Gaps.
- **`/plan` (template)** — the "God nodes shift" section: which nodes gained or lost edges versus the previous month (a signal that a pattern is tightening or loosening).
- **Ad-hoc** — `graphify query "<question>"` for cross-cutting questions about the workspace.

Initialization: `/graphify .` in the workspace root. Keep `graphify-out/` in `.gitignore` (derived artifact, contains note content).

---

## 8b. Journal — methodology (+ the Obsidian layer)

The journal is the workspace's durable, human-readable timeline. Key point: the journal is WRITTEN BY the commands, not by you by hand during the day — your ad-hoc input goes to the kb scratchpad.

### Two note streams

| Stream | Where | Who writes | Lifecycle |
|---|---|---|---|
| **Scratchpad** | `.kanban/daily-notes/{date}.md` (kb storage) | You during the day (`kb notes add "..."` / GUI) + core auto-log | Ephemeral: `/today-eod` §1b turns each entry into an action (task/tracker/journal/observation/drop), then archives it |
| **Journal** | `journal/{date}.md` (workspace) | The commands (`/today-morning` §7, `/today-eod` §2) | Durable: never deleted, aggregated upward |

### Daily note lifecycle

1. **Morning** — `/today-morning` §7 creates `journal/YYYY-MM-DD.md`: frontmatter, navigation wikilinks, Yesterday Review (yesterday's checkboxes resolved), Today's Priorities and the recurring mention. §8 appends `## Digest` to YESTERDAY's journal if EOD never did.
2. **During the day** — nothing in the journal. Thoughts and notes → the kb scratchpad (`kb notes add`). Core appends its own auto-log there (`[auto:reschedule]`, `[auto:tracker]`, `[auto:skip]`).
3. **Evening** — `/today-eod`: scratchpad → dialogue → actions → archive; the journal receives `## Digest` (done/carry-over/decisions, ~5 lines max).

### Digest-first (hard reading rule)

Every later read of a journal (morning carry-over, weekly review) reads **only `## Digest`**, not the whole file. The full file is the fallback when the digest is not enough. This keeps context cost flat regardless of how long the notes get. The digest is located by header search, never by byte offset — notes start with YAML frontmatter.

### Aggregation upward

```
journal/YYYY-MM-DD.md  (## Digest, daily)
   └─→ journal/weekly-reviews/YYYY-WXX.md   (/weekly-review — the week's digest at the top of the file)
          └─→ journal/monthly-reviews/YYYY-MM.md   (first review of the month — goals progress vs planning)
```

Observations run in parallel: `areas/{AreaDir}/observations.md` → reflector compression → `observations-archive.md` (G0→G1→G2). The journal records what happened; observations record what follows from it.

### The Obsidian layer

The workspace **is** an Obsidian vault by default — the commands write Obsidian-native markdown:

- **Vault = workspace root.** `journal/` becomes the daily-notes folder; in Obsidian set Daily notes → folder `journal/`, format `YYYY-MM-DD`. The GUI's "Open in Obsidian" button uses the workspace directory name as the vault name.
- **Frontmatter + navigation.** Every note the commands write starts with YAML frontmatter (`date`/`type`/`tags`) and carries `← [[prev]] | [[next]] →` navigation links between work days, weeks and months.
- **Wikilinks.** Priorities link to their area hub (`[[Work]]` → `areas/Work/Work.md`, a folder note so the link resolves unambiguously). Entity links (people, projects) follow the registry in `_memory/linking-rules.md`, created by `/onboard`. No linking-rules file → plain text, no broken links.
- **Fill-in templates:** [`templates-obsidian/`](../templates-obsidian/) holds `Daily Note.md` and `Weekly Review.md` (`{{date}}` syntax — core Templates or Templater). Copy them into your vault's template folder and adjust the area sections. These are for MANUAL journaling on days you do not run the commands.
- **Graph:** Obsidian's graph view shows explicit links; `/graphify` (§8a) also extracts semantic relations without wikilinks — the two complement each other.

---

## 9. Workspace layout

A fresh clone **is** the workspace. Claude Code runs in it, and `kb` finds its storage by walking up from the current directory to `.kanban/`.

```
workspace/                      # the clone = your private workspace
├── .claude/                    # this package
├── .kanban/                    # kb storage (YAML + JSONL, gitignored)
├── CLAUDE.md                   # workspace instructions (personalized by /onboard)
├── MASTER-BIO.md               # profile + annual goals (created by /onboard)
├── journal/                    # daily notes (created by /today-morning)
│   ├── weekly-reviews/         # /weekly-review
│   ├── monthly-reviews/        # monthly summary
│   └── .cache/                 # reflector proposals
├── _memory/                    # user-profile.md, rules.md, linking-rules.md
└── areas/                      # one directory per area from `kb area list`
    └── {AreaDir}/              # convention: capitalize dash-separated parts (side-projects → Side-Projects)
        ├── {AreaDir}.md        # hub note (folder note — makes [[Work]] unambiguous)
        ├── observations.md     # memory layer
        ├── observations-archive.md
        ├── planning/YYYY-MM.md # /plan
        └── ROADMAP.md          # optional (Now/Next/Later — feeds /plan §2 and /today-morning §3a.4)
```

Missing directories are created by the commands (`journal/`, `planning/`); optional files are skipped without error. Everything holding personal data is gitignored — see the README section "Versioning your data".

---

## 10. Configuration

- **Areas:** configured in `.kanban/areas.yaml`, managed with `kb area add|edit|remove|list`. `/onboard` sets them up interactively. Ids are immutable (they are baked into task ids); labels, emoji and colors are not.
- **Work days:** default Mon-Fri in the `today-morning.md` header — adjust the triggers (§0) to your rhythm.
- **Storage root:** resolved in order — `KB_KANBAN_ROOT=<path>` → walk-up from cwd to `.kanban/` → the `~/.config/kb/workspace` pointer. `KB_DEV=1` switches to the `.kanban-dev/` sandbox. Check with `kb workspace status`. Test on clean storage: `KB_KANBAN_ROOT=$TMPDIR/kb-test kb today --json`.
- **Binary install:** `pnpm install:local` in this repo → `~/.local/bin/kb` + `/Applications/Second Brain.app` + the workspace pointer.

---

## 11. Permissions and safety (`settings.json`)

- **Allow:** `Bash(kb:*)` plus the PATH/`KB_DEV`/`KB_KANBAN_ROOT` variants, `tail` on `events.jsonl`/`recurring-stats.jsonl` (audit), basic `date`/`ls`/`mkdir`, `pnpm build/test/install:local`.
- **Deny — binary read ban:** `cat`/`head`/`file` on `~/.local/bin/*` and `strings`/`xxd`/`hexdump`/`od` globally. Why: `kb` is a ~60 MB compiled Bun binary — reading it injects megabytes of garbage into the model's context. Check for its presence only with `which kb` / `kb --version`.
- **Deny:** `rm`, `sudo`, access to `.env*`.
- **Sandbox:** as a compiled binary, `kb` in practice needs `dangerouslyDisableSandbox: true` per call — which is exactly why only kb-ops calls it, never main.

---

## 12. Known limitations

1. **No team-sync layer** — there is no agent syncing external boards (GitHub Projects, Jira, …). Pattern for writing your own: §2 point 6.
2. **No enforcement hooks** — Observer discipline and document freshness are instructions inside the commands, not hooks that can block a session.
3. **`kb day-view`** — available in the current CLI; if you run an older binary, kb-ops falls back to `kb today --date` as an approximation.
4. **macOS-first packaging** — `pnpm install:local` builds an arm64 `.app` and a Bun binary for `bun-darwin-arm64`. The core and CLI are portable; the packaging scripts need adjusting for other platforms.
5. **Single-user model** — storage has no notion of multiple users or shared boards; the tracker records what others owe you, not their own task lists.
