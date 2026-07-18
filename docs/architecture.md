# Second Brain — architecture and deployment

## Overview

A local desktop application (macOS arm64) for managing personal tasks inside a knowledge-base workspace. Three layers: on-disk storage, a CLI binary and an Electron GUI. All three share the same storage and the same logic (`packages/core`).

```
Claude Code (/today-morning, /plan, …)
        │ via the kb-ops agent → bash: kb today --json
        ▼
   apps/cli/  (binary: kb)
        │ import
        ▼
packages/core/  (TS, pure logic)
        │ fs read/write
        ▼
<workspace>/.kanban/  (YAML + JSONL)
        ▲ chokidar watch
   apps/gui/  (Electron + React)
```

---

## Monorepo

```
second-brain/
├── packages/
│   └── core/               # pure TS, no dependency on Electron/Bun
├── apps/
│   ├── cli/                # the `kb` binary (Bun compile)
│   └── gui/                # Electron + React + Tailwind
├── .claude/                # commands, agents, skills, rules
├── docs/
├── scripts/
│   └── install-local.mjs   # build + deploy in one command
├── pnpm-workspace.yaml
└── package.json
```

Package manager: **pnpm workspaces**. Every package has its own `package.json` and `tsconfig.json`.

---

## packages/core

Pure business logic. No runtime dependencies (it imports neither Electron nor Bun-specific APIs), so both the CLI (Bun) and the GUI (Electron's Node.js) can use it.

### Modules

| Module | Responsibility |
|-------|-----------------|
| `types.ts` | Zod schemas for every data type (Task, Board, RecurringRule, ActiveSession, FocusSession, TodaySessionSnapshot). `AreaSchema` validates the id *format* only — the valid set lives in `areas.yaml`. Task carries two date dimensions: `dueDate` (deadline) and `plannedDate` (when I intend to do it). Schema v3. |
| `storage/areas.ts` | `areas.yaml`: schema, `DEFAULT_AREAS` (the `personal` starter), `readAreas` (missing file → defaults, no write), `writeAreas`, `areaPrefix`. |
| `storage/paths.ts` | Workspace resolution (`defaultRoot`, `resolveRootInfo`, `WorkspaceNotFoundError`) + every storage path. |
| `storage/workspace.ts` | `workspaceStatus()` and `initWorkspace()` behind `kb workspace status|init`. |
| `storage/atomic.ts` | Safe writes: write tmp → rename + `proper-lockfile` |
| `storage/boards.ts` | CRUD over `boards/{boardId}.yaml` |
| `storage/recurring.ts` | CRUD over `recurring.yaml` |
| `storage/events.ts` | Append-only into `events.jsonl`. Event types: `task.*`, `board.*`, `recurring.*`, `tracking.*`, `session.opened` (`{date, startedAt, autoClosedPrev}`), `session.closed` (`{date, startedAt, closedAt, status, missedCount, doingCount}`). |
| `storage/meta.ts` | `meta.yaml` (`taskCounters` per area, `nextBoardId`/`nextRuleId`/`nextTrackingId`, schemaVersion). Task-id prefixes come from the area config. |
| `storage/today-session.ts` | `today-sessions/{date}.json` snapshots + `recurring-stats.jsonl` |
| `storage/active-session.ts` | `today-sessions/active.json` — the currently open session (read/write/clear, `isStaleSession` with a 72h cutoff) |
| `storage/daily-notes.ts` | `daily-notes/{date}.md` (live) + `daily-notes/archive/{date}.md` (after /today-eod). Free-form markdown with automatic `### HH:MM` timestamps. Helpers: `readDailyNote`, `appendDailyNote`, `appendAutoLog(date, source, msg)` (best-effort, non-blocking; `[auto:source]` tag), `archiveDailyNote`, `writeDailyNote`. Per-file lock via `proper-lockfile`. |
| `storage/focus.ts` | `focus.json` (Pomodoro session). Date mismatch is compared against active.date, not calendar today |
| `storage/init.ts` | Bootstraps the `.kanban/` structure on first run, seeding boards from `readAreas` |
| `storage/migrate.ts` | Migration runner keyed by `schemaVersion` |
| `schedule/engine.ts` | Expands recurring rules for any date |
| `schedule/dates.ts` | `localToday()`, `localDateOf(iso)` |
| `queries/today.ts` | Aggregation: recurring + tasks (filter: `id ∈ active.anchoredTaskIds`) + overdue + doneTasks (`completedSessionDate=active.date`) + **`dueOnlyToday`** (`dueDate=active.date && plannedDate≠active.date && column∈{todo,doing}` — informational). Lazily opens the active session when missing. |
| `queries/day-view.ts` | Read-only view of any day. States: `active` (live), `closed`/`auto-closed` (frozen snapshot), **`future`** (with `plannedTasks[]` + `dueOnlyTasks[]` derived from boards), `empty`. |
| `queries/trigger-today.ts` | Backwards-compat wrapper over `ensureSession` |
| `services/areas.ts` | `listAreas`, `createArea` (also creates `b_{id}_main`), `editArea`, `removeArea` (refuses while data references the area), `assertValidArea`. |
| `services/tasks.ts` | createTask, editTask, moveTask, deleteTask, **rescheduleTask**. Move→doing anchors the task in active.anchoredTaskIds; move→done stamps `completedSessionDate=active.date`; **moving out of done (`done→doing` or `done→todo`) resets both `completedAt` AND `completedSessionDate` to `null`** (the uncheck-in-Today flow). `deleteTask` filters the task from the board **and** from `active.anchoredTaskIds` (no-orphan invariant). `rescheduleTask(id, toDate, reason?)` is atomic: sets `plannedDate=toDate`, demotes `doing→todo`, de-anchors from the active session, emits `task.rescheduled` (with `fromPlanned`, `toPlanned`, `fromColumn`, `sessionDate`, `reason`), appends the auto-log. Validation: `toDate ≥ localToday()`. |
| `services/boards.ts` | createBoard, listBoards |
| `services/recurring.ts` | createRule, markRuleDone (falls back to active.date), **markRuleSkipped** (with `reason` → `[auto:skip]` auto-log), rescheduleRule, toggleRule. |
| `services/session.ts` | `openSession`, `closeSession` (snapshot doing + missed recurring), `ensureSession` (lazy open + auto-close stale >72h, **carry-over by `plannedDate ≤ today` or legacy `column=doing && plannedDate=null`**), `anchorTaskToActive`. |
| `services/tracking.ts` | createTrackingItem, editTrackingItem, deleteTrackingItem. **editTrackingItem** appends an `[auto:tracker]` auto-log to `daily-notes/{localToday()}.md` on status change. |

Mutating services call `assertValidArea` before writing, so an unconfigured area fails fast with the list of configured ones. Reads stay permissive — data written before an area was removed remains readable.

### Concurrency

The CLI and GUI write to the same files simultaneously. Strategy:

1. Every mutation takes a `proper-lockfile` on the file (2s timeout, 100+ retries)
2. Mutation: read → modify in memory → write to `.tmp` → atomic rename (POSIX)
3. `events.jsonl` — a separate lock, append only

This makes data corruption from concurrent CLI + GUI writes impossible.

---

## apps/cli

The `kb` binary, compiled with `bun build --compile` — a single ~60MB file with no runtime dependencies (neither Node.js nor Bun need to be installed).

- Command parser: **Commander.js**
- Output: human-readable tables or `--json` (a frozen contract for Claude Code)
- Location after install: `~/.local/bin/kb` (or `/usr/local/bin/kb`)

### Workspace resolution

`defaultRoot()` resolves the storage root synchronously, first hit wins:

1. **`KB_KANBAN_ROOT`** — used verbatim, no walk-up, no pointer.
2. **Walk-up** from `process.cwd()` looking for `.kanban/` (or `.kanban-dev/` under `KB_DEV=1`), exactly how git finds `.git`. This is what makes "the clone is your workspace" work.
3. **Pointer file** `~/.config/kb/workspace` — a single line holding the workspace path, written by `kb workspace init` and by `pnpm install:local`. It is what lets the Dock-launched GUI (which starts outside the repo) find the workspace.
4. Nothing resolved → `WorkspaceNotFoundError` with instructions. The CLI prints it; the GUI shows it in a dialog and quits rather than crashing before a window exists.

The repo ships a tracked `.kanban/.gitkeep`, so walk-up succeeds in a fresh clone immediately.

---

## apps/gui

An Electron application with a React renderer.

### Processes

**Main process** (`electron/main.ts`):
- **Forces `process.env.TZ`** from `Intl.DateTimeFormat().resolvedOptions().timeZone` before importing core. Electron launched from the Dock/Finder does not inherit TZ from the shell → it defaults to UTC, which breaks `localToday()` after local midnight. Without this, a session opened at 02:00 local got the previous calendar day in UTC.
- Imports `packages/core` directly
- Resolves the storage root inside `app.whenReady()` — `WorkspaceNotFoundError` becomes an error dialog + quit
- Registers IPC handlers (`ipcMain.handle`): tasks/boards/recurring/today/focus plus **areas:list**, **session:active|close|ensure**, **day:view**
- Runs a `chokidar` watcher over `.kanban/` → emits `storage:changed` to the renderer

**Preload** (`electron/preload.ts`):
- Exposes `window.api` through `contextBridge`
- The renderer has no Node.js access — only `window.api`

**Renderer** (`src/`):
- React 18 + Tailwind CSS
- Areas come from `areas-context.tsx` (`AreasProvider` + `useAreas()`), fetched over IPC and refetched when `areas.yaml` changes. Area colors are applied as **inline styles**, never Tailwind classes — class names must exist at build time, and area colors are user data.
- Routing: `Screen = string`, where `"today"` and `"tracker"` are reserved and anything else is an area id. Removing an area redirects an open screen back to Today.
- Drag-drop: `@dnd-kit/core` (PointerSensor, 4px activation distance)

### Build

```
Vite → dist/           (renderer: HTML + JS + CSS)
esbuild → dist-electron/main.cjs    (main process, bundled CJS)
esbuild → dist-electron/preload.cjs (preload, bundled CJS)
```

Electron main must be CJS (not ESM) — esbuild bundles everything including `packages/core`, with only `electron` and `fsevents` external.

### Live reload CLI → GUI

```
kb task add ...
    │ writes boards/b_work_main.yaml
    ▼
chokidar detects the change (awaitWriteFinish: 50ms)
    │ ignores .lockfile, .tmp
    ▼
main.ts → mainWindow.webContents.send("storage:changed")
    ▼
App.tsx → setReloadKey(k+1) → view remounts → data re-fetched
```

Time from CLI write to GUI refresh: < 500ms.

---

## Storage

Location: `<workspace>/.kanban/` (see Workspace resolution above).

```
.kanban/
├── meta.yaml                    # schemaVersion: 3, taskCounters per area, nextBoardId/RuleId/TrackingId
├── areas.yaml                   # configured areas: id, label, emoji, color, prefix?
├── boards/
│   ├── b_work_main.yaml         # a Task carries completedSessionDate, dueDate, plannedDate
│   └── b_health_main.yaml
├── recurring.yaml               # all recurring rules
├── events.jsonl                 # append-only audit log of every mutation (incl. task.rescheduled)
├── recurring-stats.jsonl        # done/missed per rule per day
├── focus.json                   # the current Pomodoro session (if any)
├── tracking.yaml                # commitments / events / external-tasks
├── daily-notes/
│   ├── YYYY-MM-DD.md            # live scratchpad for the current active.date — append-only with `### HH:MM` headings
│   └── archive/
│       └── YYYY-MM-DD.md        # archived by /today-eod (after the entries are processed)
└── today-sessions/
    ├── active.json              # the open session: {date, startedAt, status, anchoredTaskIds}
    └── YYYY-MM-DD.json          # a closed day snapshot (status, doingSnapshot, anchoredTaskIds)
```

### Areas

`areas.yaml` holds `{schemaVersion: 1, areas: [{id, label, emoji, color, prefix?}]}`. It is read per call (the file is under 1 KB, like meta) and written through `atomicWrite`.

The `id` is immutable — board ids (`b_{id}_main`) and task ids (`{prefix}_001`) embed it, so renaming would orphan existing data. `label`, `emoji` and `color` are presentation and can change freely. `prefix` defaults to the id with dashes stripped.

A missing `areas.yaml` yields `DEFAULT_AREAS` (a single `personal` area) **without writing** — bootstrapping belongs to `initStorage`, reads stay side-effect free.

### Active session model

The application's notion of a "day" does not match calendar midnight. `today-sessions/active.json` holds the currently open session (date, startedAt, status, anchoredTaskIds). A session:

- **opens** on the first `kb today` (or `/today-morning`) — `ensureSession` lazily creates active with `localToday()` and anchors everything currently `doing` (carry-over),
- **closes** explicitly through `kb session close` (or `/today-eod`) — a snapshot of doing + missed recurring → `today-sessions/{date}.json` with status `closed`. The snapshot is **immutable once closed** — a repeat `persistClose` for the same day is a no-op (guarded in `session.ts`),
- **auto-closes** on the next `ensureSession` when `startedAt` is >72h old (status `auto-closed`, signalled via `payload.autoClosed`). The GUI calls `ensureSession(ROOT)` at startup (before registering IPC) — self-healing for orphaned `active.json`.

All mutations (`moveTask` to done, `markRuleDone`) anchor to `active.date` rather than `new Date()`, which lets you close out a day after midnight without losing context. Tasks get `completedSessionDate` on move-to-done; recurring done events carry `forDate=active.date`.

### plannedDate vs dueDate

A task has **two disjoint date dimensions**:

- **`dueDate`** — the deadline. Drives overdue (`dueDate < active.date && column ∈ {todo, doing}` → `payload.overdue`). Edited normally through `kb task edit --due` or the GUI modal.
- **`plannedDate`** — when I intend to do it (optional, `null` = legacy fallback). Drives day view and carry-over. **Not edited directly for existing anchored tasks** — changes go through `rescheduleTask` (audit + auto-log).

Carry-over rule (`ensureSession` when no active.json exists):
1. Anchor every task where `plannedDate ≤ localToday() && column ∈ {todo, doing}` (planned for today, or overdue by plan).
2. Plus the legacy fallback: `column = doing && plannedDate = null` (tasks from before the v2 migration).

Day view per day:
- **`plannedTasks[]`**: `plannedDate = X && column ≠ done` — tasks planned specifically for that day.
- **`dueOnlyTasks[]`**: `dueDate = X && plannedDate ≠ X && column ≠ done` — tasks with a deadline that day but no plan (a red flag in the future view).
- Active day: `tasks[]` filtered by `anchoredTaskIds`, plus the informational `dueOnlyToday[]` in the `kb today --json` payload.

### Daily-notes scratchpad

`daily-notes/{date}.md` is a free-form markdown buffer for "what is happening today". Two entry kinds:

- **Manual** — appended by `kb notes add "..."` or the GUI quick-add/textarea. Format: `### HH:MM\n\n{text}`.
- **Auto-log** — appended by core on high-signal mutations. Format: `### HH:MM [auto:source]\n\n{message}`. Triggers:
  - `task.rescheduled` → `[auto:reschedule]` (taskId, area, title, fromPlanned → toPlanned, reason?)
  - `tracking.edited` with `changes.status` → `[auto:tracker]` (id, area, kind, assignee, title, status: prev → next)
  - `recurring.skipped` with a `reason` (NOT without one — too noisy) → `[auto:skip]` (id, area, title, forDate, reason)

Auto-log is **best-effort and non-blocking**: if the file write fails, the mutation proceeds (the audit trail is also in `events.jsonl`).

`/today-eod` §1b reads the scratchpad, walks each manual entry (journal/task/observation/tracker/ROADMAP/drop) and shows auto-logs for information. After the batch is confirmed, `notes.archive` moves the file to `daily-notes/archive/{date}.md`.

### Task vs session — two disjoint dimensions

A task on a board has an independent lifecycle (`column ∈ todo|doing|done`). The session holds `anchoredTaskIds` — which tasks are "taken for today". Two different dimensions:

| Operation | Boards (lifecycle) | Active session (anchor) |
|---|---|---|
| `moveTask(t, doing)` | `column → doing`; if coming from `done` → `completedAt=null`, `completedSessionDate=null` | push into `anchoredTaskIds` (idempotent) |
| `moveTask(t, todo)` | `column → todo`; if coming from `done` → `completedAt=null`, `completedSessionDate=null` | no push (de-anchor — the task leaves Today but stays on the board) |
| `moveTask(t, done)` | `column → done`, stamps `completedAt` + `completedSessionDate=active.date` | `anchoredTaskIds` unchanged (the anchor is historical) |
| `deleteTask(t)` | removes the task from the board + emits `task.deleted` (snapshot) | filtered out of `anchoredTaskIds` (no-orphan) |
| `rescheduleTask(t, toDate, reason?)` | `plannedDate=toDate`; if `column=doing` → `column=todo` | filtered out of `anchoredTaskIds`. Emits `task.rescheduled` + the `[auto:reschedule]` auto-log. Validates `toDate ≥ today`. |
| `ensureSession()` with no active | none | seeds `anchoredTaskIds` from `(plannedDate ≤ today && col≠done) ∪ (plannedDate=null && col=doing)` |
| `closeSession()` | none | snapshots `anchoredTaskIds` + `doingSnapshot` (titles copied for the past read-only view), clears `active.json` |

Consequence: "move a task to another day" is a single semantic operation — `kb task reschedule` — not a composition of edit + move. See `docs/features.md` → "Moving tasks between days".

### Formats

**YAML** (boards, recurring, meta, areas) — human-readable, hand-editable when needed.

**JSONL** (events, recurring-stats) — one JSON object per line, append only. Safe under concurrent writes.

### Schema versioning

`schemaVersion` in meta.yaml (currently `3`). The migration runner in `storage/migrate.ts` maps `oldVersion → migration fn` and is invoked automatically by `ensureStorageReady()` (CLI + GUI startup). Migrations:

- **v1 → v2**: added `Task.plannedDate` (Zod schema default `null`). No data rewrite — existing tasks read through the Zod fallback and get the field on the next mutation.
- **v2 → v3**: areas moved out of the code into `areas.yaml`, and the fixed `nextTaskId<Area>` counters became the generic `taskCounters` map. The migration reads `meta.yaml` as **raw YAML** on purpose — `readMeta()` parses through `MetaSchema`, which strips exactly the legacy fields the migration needs to carry over. It scans for keys matching `/^nextTaskId([A-Z][A-Za-z]*)$/`, lowercases the suffix into `taskCounters`, and drops the old keys. If no `areas.yaml` exists, it reconstructs one from the areas found on existing boards (label = title-cased id, neutral emoji and color). After the loop, `runMigrations` re-reads meta before stamping the new version — the pre-loop copy is stale by then.

Migrating storage from an older install with custom task-id prefixes: set `prefix:` per area in `areas.yaml` and the migration handles the rest.

---

## Deployment

### Install

```bash
pnpm install:local
```

`scripts/install-local.mjs` runs, in order:
1. `pnpm build:cli` → Bun compiles the binary
2. `pnpm build:gui` → Vite + esbuild + electron-packager produce the `.app`
3. Copies the `.app` to `/Applications/Second Brain.app` + ad-hoc codesign
4. Copies the `kb` binary to `~/.local/bin/kb` (or `/usr/local/bin/kb`)
5. Records the repo as the default workspace (`kb workspace init`) — skipped when a pointer already exists, so an existing workspace is never hijacked

### Codesign

Ad-hoc signing: `codesign --deep --force --sign -`. No Apple Developer ID required. Gatekeeper accepts it — no warnings when launching from the Dock.

### Updating

After any code change:
```bash
pnpm install:local   # full rebuild + reinstall
```

Running from source without rebuilding (for testing):
```bash
pnpm dev:gui         # Vite dev server + Electron (renderer hot reload)
```

### Requirements

| Requirement | Version |
|-----------|---------|
| macOS | arm64 (Apple Silicon) — for the packaged app |
| Node.js | ≥ 18 (build scripts) |
| Bun | ≥ 1.0 (CLI compile) |
| pnpm | 10.28.0 |
| Electron | 33.x (bundled in the .app) |

On the end machine after installation: no runtime dependencies. The `kb` binary and the `.app` are fully self-contained.

---

## Claude Code integration

Slash commands call `kb` through the `kb-ops` agent — the only bridge between the main context and the binary. The `kb today --json` contract is frozen under the commands that consume it: `payload.date` is active.date (not calendar today), `payload.doneTasks` is filtered by `completedSessionDate`, and `payload.autoClosed` signals a >72h auto-close of the previous session.

Full documentation of the integration — commands, agents, memory layer, loops: [`claude-integration.md`](claude-integration.md).
