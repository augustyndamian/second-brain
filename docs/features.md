# Second Brain — features and CLI reference

Examples below use the areas `work`, `health`, `learning` and `finance`. Yours come from `kb area list` — nothing here is hardcoded in the app.

---

## Workspace

The CLI resolves its storage root in this order: `KB_KANBAN_ROOT` → walk up from the current directory to `.kanban/` → the `~/.config/kb/workspace` pointer. `KB_DEV=1` selects `.kanban-dev/` instead.

```bash
kb workspace status                  # resolved root + where it came from
kb workspace status --json
kb workspace init                    # make the current directory a workspace
kb workspace init ~/second-brain     # …or a specific one
kb workspace init . --keep-pointer   # do not overwrite an existing default
```

`workspace init` creates `.kanban/`, bootstraps storage, and records the workspace in the pointer file so the Dock-launched GUI finds it too.

---

## Areas

Areas are the top-level split of your life or work. Every task, board, recurring rule and tracker item belongs to exactly one. They live in `.kanban/areas.yaml` — configurable, no code changes.

```bash
kb area list
kb area list --json
kb area add --id work --label "Work" --emoji 💼 --color "#3b82f6"
kb area add --id side-projects --label "Side Projects" --emoji 🚀 --color "#10b981"
kb area edit --id work --label "Day Job" --emoji 🏢
kb area remove --id work
```

- **`id`** is immutable — it is baked into task ids (`work_001`) and board ids (`b_work_main`). Lowercase, letters/digits/dashes, max 24 chars.
- **`label`**, **`emoji`**, **`color`** are presentation only; the GUI sidebar reads them live.
- **`prefix`** (optional) overrides the task-id prefix; it defaults to the id with dashes stripped (`side-projects` → `sideprojects_001`).
- `area add` also creates the area's default board `b_{id}_main`.
- `area remove` refuses while any task, recurring rule or tracker item still references the area — move or delete those first.

A fresh workspace ships with a single starter area, `personal`. `/onboard` replaces it with yours.

---

## Tasks

### Adding

```bash
kb task add --area <area> --title "Title"
kb task add --area work --title "Record the demo" --due 2026-07-24 --planned 2026-07-22
kb task add --area work --title "Brief for alice" --due 2026-07-20 --planned 2026-07-19 --column doing
kb task add --area health --title "Book blood work" --desc "Glucose + CBC" --parent-goal-ref "areas/Health/planning/2026-07.md#goal-1"
```

Options: `--area`, `--title`, `--desc`, **`--due YYYY-MM-DD`** (deadline), **`--planned YYYY-MM-DD`** (when you intend to do it — optional), `--column todo|doing|done`, `--board <boardId>`, `--parent-goal-ref`, `--note "..."` (optional follow-up note).

**`due` vs `planned`** — two disjoint dimensions:
- **`due`** = the deadline (drives overdue).
- **`planned`** = when you intend to do it (drives day view + carry-over). Can stay empty; then the task shows up in Today whenever `column=doing` (legacy fallback).

### Listing

```bash
kb task list
kb task list --area work
kb task list --column doing
kb task list --area work --column todo --json
kb task list --due-before 2026-07-25
kb task list --done-in-session 2026-07-18 --json   # tasks closed in the July 18 session
```

### Showing

```bash
kb task show work_001
kb task show work_001 --json
```

### Editing

```bash
kb task edit work_001 --title "New title"
kb task edit work_001 --due 2026-07-30
kb task edit work_001 --planned 2026-07-25
kb task edit work_001 --planned ""             # clear plannedDate (back to legacy behavior)
kb task edit work_001 --area learning --board b_learning_main
kb task edit work_001 --note "When done, hand the assets to alice"
kb task edit work_001 --note ""    # clear the note
```

**Note:** `edit --planned` is for administrative corrections (e.g. setting a plan on a task not anchored in a session). To move an anchored task to another day use `task reschedule` (see "Moving tasks between days") — it emits a semantic event plus an auto-log.

### Notes (task follow-ups)

Every task has an optional `note` field (multiline string), editable in the GUI (textarea under Description) and the CLI (`--note`). The idea: you jot a short follow-up during or after finishing a task ("hand over X", "finish Y", "remember Z"), and in the evening `/today-eod` collects notes from tasks closed in the current session (`column=done` and `completedSessionDate=active.date`) and proposes actions (journal append / new task / observation).

```bash
kb task list --has-note --json   # only tasks with a non-empty note
```

The note stays on the task permanently — it naturally drops out of EOD tomorrow through the close-date filter.

Editing supports changing area and board (cross-board move).

### Moving columns

```bash
kb task move work_001 --column doing
kb task move work_001 --column done
```

- Move → `doing` anchors the task in `active.anchoredTaskIds` (when a session is open).
- Move → `done` sets `completedAt` (ISO timestamp) **and** `completedSessionDate=active.date` (YYYY-MM-DD) — so the task stays in the current session's Done view even if you clicked past local midnight.
- Moving out of `done` (`done→doing` or `done→todo`, e.g. unchecking in Today) clears **both** fields: `completedAt=null`, `completedSessionDate=null`. Without that the stale stamp would linger in the YAML while the task is back in the active flow.

### Moving tasks between days

The system has **two disjoint date dimensions** plus the **session anchor**, which together decide whether and when a task appears in Today. There is one canonical reschedule command:

```bash
kb task reschedule work_001 --to 2026-07-25 --reason "turned out complicated, better on Friday"
```

**What `reschedule` does:**
1. Sets `plannedDate=2026-07-25`.
2. If the task was `column=doing` → demotes it to `todo` (natural de-anchor).
3. Removes it from `active.anchoredTaskIds` (it leaves today's Today immediately).
4. Emits a single `task.rescheduled` event (with `fromPlanned`, `toPlanned`, `fromColumn`, `sessionDate`, `reason?`).
5. Appends an `[auto:reschedule]` line to `daily-notes/{today}.md` — `/today-eod` sees the semantic trace.
6. **Validation**: `--to` cannot be in the past.

**`dueDate` stays untouched** — a deliberate decision: a deadline is not a day plan. Change it separately with `task edit --due` when you actually mean the deadline.

#### Usage patterns

**a) "Didn't finish today, let it roll over"** (most common — no action needed)

Leave the task in `doing` after EOD. Next morning `/today-morning` (i.e. `ensureSession` when no active session exists) anchors it into the new session automatically per the carry-over rule (tasks with `plannedDate ≤ today`, or legacy `column=doing && plannedDate=null`).

**b) "Move it to a specific day"**

```bash
kb task reschedule work_001 --to 2026-07-25 --reason "..."
```

The task leaves today's Today immediately and shows up in `kb day-view --date 2026-07-25` under `plannedTasks`. Auto-logged in the scratchpad. `dueDate` untouched.

**c) "Only change the deadline, keep the day plan"**

```bash
kb task edit work_001 --due 2026-07-30
```

The task stays in `doing` (anchored), still in Today. Only the deadline moved.

**d) "Take it off today, but don't plan a specific day"**

```bash
kb task move work_001 --column todo      # de-anchor; plannedDate and dueDate stay
```

Back to the backlog, out of Today. It returns only on another `move --column doing` or `reschedule --to <date>`.

**e) "Move a recurring occurrence to another day"**

```bash
kb recurring reschedule r_001 --from 2026-07-18 --to 2026-07-19
```

Recurring rules only.

#### In the GUI

- **Task edit modal** (click a task in Today): the "Planned day" section shows the current plan plus a **"Move to day…"** button with a date picker and optional reason. Past dates are blocked. This calls the `tasks.reschedule` IPC underneath.
- **Drag-drop in the Today date picker**: open the date picker (click the date in the header) and drag a task onto a day cell. Future cells highlight emerald → drop → `reschedule` with reason `"drag-drop in date picker"`. Past cells are disabled as drop targets.
- **Edit modal**: `dueDate` is editable normally (the deadline). `plannedDate` is a **read-only display** for existing tasks (changes go through Move-to-day) — on create you can set it directly.
- **"New task" modal** (Add task in Today): `dueDate` and `plannedDate` are pre-filled with today's calendar date. Default `column=doing`, so the task lands in the active session through auto-anchoring.
- **Drag-drop on the per-area kanban** (`todo ↔ doing ↔ done`): moves the column and anchors/de-anchors as expected.

#### Architecture underneath

Boards (task lifecycle) and the day session (`anchoredTaskIds`) are two disjoint dimensions, with `plannedDate` as a third (the day-view driver). See `docs/architecture.md` → "Task vs session" for the full interaction table of `moveTask` / `rescheduleTask` with the active session.

#### Legacy 2-step (deprecated, still works)

The old `task edit --due X + task move --column todo` pattern still works but **loses the audit trail**: no `task.rescheduled` event, no auto-log, and `/today-eod` §1c goes blind. Do not use it for anchored tasks — use `reschedule`.

### Deleting

```bash
kb task delete work_001
```

Atomically: removes the task from the board YAML, **filters it out of `active.anchoredTaskIds`** (no-orphan invariant), and emits `task.deleted` with a snapshot into `events.jsonl`.

### Batch add (atomic)

```bash
kb task add-batch --json items.json
cat items.json | kb task add-batch --json -
```

Input — an array of objects (each = params for `task add`: `area`, `title`, `desc`, `due` (YYYY-MM-DD), `priority` (1-10), `column?`, `board?`, `parentGoalRef?`).

Output (success):
```json
{ "ok": true, "items": [{"id":"finance_005","boardId":"b_finance_main","area":"finance"}] }
```

Output (validation error — zero writes):
```json
{ "ok": false, "errors": [{"index": 7, "field": "due", "reason": "expected YYYY-MM-DD"}] }
```

Semantics: all-or-nothing. The whole array is validated before any write. On success — one `writeBoard` per board (not per task) and N consecutive ids allocated in a single meta update. Events land in `events.jsonl` per task (audit trail consistent with single add).

`kb recurring add-batch --json` works the same way (no `priority`/`due`, and `schedule` as an object `{type, ...}`):

```json
[
  {"area":"health","title":"Gym","schedule":{"type":"weekly","daysOfWeek":["mon","wed","fri"]}},
  {"area":"finance","title":"Rebalance portfolio","schedule":{"type":"monthly","dayOfMonth":1}}
]
```

---

## Boards

```bash
kb board add --area work --name "Work — Q3"
kb board add --area work --name "Work — Hiring" --default
kb board list
kb board list --area health --json
```

Every area gets one board by default (`b_{area}_main`). You can add more.

---

## Recurring rules

### Adding

```bash
# Every day
kb recurring add --area health --title "Morning routine" --schedule daily

# Work days (Mon-Fri)
kb recurring add --area learning --title "Course lesson" --schedule weekdays

# Specific weekdays
kb recurring add --area health --title "Gym" --schedule weekly --days mon,wed,fri

# Every N days
kb recurring add --area health --title "Stretching" --schedule interval --every-n-days 2

# A specific day of the month
kb recurring add --area finance --title "Rebalance portfolio" --schedule monthly --day-of-month 1
```

Options: `--area`, `--title`, `--schedule`, `--desc`, `--days`, `--every-n-days`, `--day-of-month`, `--board`, `--starts-on YYYY-MM-DD`, `--ends-on YYYY-MM-DD`.

### Managing

```bash
kb recurring list
kb recurring list --area health
kb recurring list --json

# Mark as done (today by default)
kb recurring done r_001
kb recurring done r_001 --date 2026-07-18

# Skip, with an optional reason
kb recurring skip r_001
kb recurring skip r_001 --reason "sick"

# Move an occurrence
kb recurring reschedule r_001 --from 2026-07-18 --to 2026-07-19

# Enable/disable a rule
kb recurring toggle r_001

# Delete a rule
kb recurring delete r_001
```

---

## Today (active session)

```bash
kb today
kb today --json
kb today --date 2026-07-01   # date override (pure read, does NOT touch active)
```

Returns: recurring instances for `active.date` + tasks in `doing` + overdue tasks + the session's done tasks (`completedSessionDate=active.date`).

**Side effects** (without the `--date` override):
1. **Lazily opens the active session** if `today-sessions/active.json` does not exist (`localToday()` as the date, carrying over everything currently `doing` as `anchoredTaskIds`).
2. **Auto-closes a session** left open >72h (status `auto-closed`, missed recurring marked, snapshot saved). Signalled by a stderr warning + `payload.autoClosed` in JSON.
3. Writes a preliminary snapshot to `today-sessions/{active.date}.json`.

Missed marking of unchecked recurring happens **at session close** (`session close` or auto-close), not when the next session starts.

JSON format (the contract for `/today-morning` in Claude Code):
```json
{
  "date": "2026-07-18",
  "recurring": [{"ruleId":"r_001","title":"...","area":"health","status":"pending"}],
  "tasks": [{"id":"work_042","title":"...","area":"work","column":"doing","dueDate":"2026-07-18","plannedDate":"2026-07-18"}],
  "overdue": [{"id":"work_038","title":"...","daysOverdue":2,"area":"work","column":"doing"}],
  "doneTasks": [{"id":"work_039","title":"...","area":"work","note":null}],
  "dueOnlyToday": [{"id":"learning_044","title":"...","area":"learning","column":"todo","dueDate":"2026-07-18","plannedDate":null}],
  "autoClosed": null
}
```

**`dueOnlyToday[]`**: tasks with `dueDate=active.date && plannedDate≠active.date && column∈{todo,doing}` — surfacing "deadline today but not planned for today". `/today-morning` flags these (§0a) as candidates to anchor via `reschedule --to today` or `move --column doing`.

`autoClosed` is non-null when a previous session open for >72h was closed automatically:
```json
{ "date": "2026-07-18", "autoClosed": {"date": "2026-07-16", "hoursOpen": 38, "missedCount": 3} }
```

---

## Session

```bash
kb session status [--json]   # show the current active.json
kb session close [--json]    # close the session: snapshot doing + mark missed
kb session ensure [--json]   # lazy open / auto-close stale (debug)
```

`session close` returns:
```json
{
  "closed": true,
  "date": "2026-07-18",
  "status": "closed",
  "missedMarked": ["r_001"],
  "doingCount": 4,
  "unfinishedTaskIds": ["work_018", "learning_001", "learning_002"]
}
```

`unfinishedTaskIds` are anchored tasks still `column=doing` on the board — their status does not change; tomorrow's `kb today` carries them over automatically through `anchoredTaskIds` in the new session.

Idempotent: a second `session close` returns `{closed: false, reason: "no active session"}`.

---

## Day view (read-only view of any day)

```bash
kb day-view --date 2026-07-25
kb day-view --date 2026-07-25 --json
```

Read-only day view. States in `payload.state`:

- **`active`** — the current active.date. Live data: `doingTasks` from the board, `recurring` (with status), `doneTasks` (`completedSessionDate=date`).
- **`closed` / `auto-closed`** — a past day with a closed session. Frozen `doingSnapshot` + `doneTasks` filtered by `completedSessionDate`.
- **`future`** — a day without a session but with planned content. The payload carries **`plannedTasks[]`** (`plannedDate=date && column≠done`) + **`dueOnlyTasks[]`** (`dueDate=date && plannedDate≠date && column≠done`) + `recurring[]` instances. **Read-only** — checkboxes do nothing (the session is not active yet).
- **`empty`** — no session and no tasks.

Used by:
- the GUI Today date picker → `dayView` IPC,
- `/today-morning` look-ahead (§3a item 3) → surfacing upcoming deadlines,
- the `kb-ops` `day.view` operation.

## Daily notes (scratchpad)

A free-form markdown buffer for "what is happening today". File: `.kanban/daily-notes/{YYYY-MM-DD}.md`.

```bash
kb notes show                         # today's scratchpad
kb notes show --date 2026-07-18
kb notes show --date 2026-07-15 --archive   # read from archive/
kb notes show --json

kb notes add "New commitment from bob: database refactor by July 30"
kb notes add "Idea: short educational videos 2x/week" --date 2026-07-18

kb notes archive                      # today → archive/
kb notes archive --date 2026-07-17

kb notes list-archive --json
```

**File format** — append-only markdown with automatic timestamps:

```markdown
### 09:14 [auto:tracker]

trk_007 [work commitment @alice] "campaign assets" — status: in-progress → done

### 14:32

New commitment from bob: database refactor by July 30

### 15:01 [auto:reschedule]

work_037 [work] "Ping alice about the assets" — rescheduled: 2026-07-18 → 2026-07-25 (reason: turned out complicated, better on Friday)
```

**Auto-log** — core appends `[auto:source]` entries on high-signal mutations:
- `[auto:tracker]` — `kb tracking edit <id> --status <new>` (status change)
- `[auto:reschedule]` — `kb task reschedule <id> --to <date>`
- `[auto:skip]` — `kb recurring skip <id> --reason "..."` (only with a reason)

Auto-log is **best-effort and non-blocking**: if the file write fails, the mutation still goes through.

**`/today-eod` §1b** reads the scratchpad, walks through each manual entry (journal/task/observation/tracker/ROADMAP/drop) and shows auto-logs for information only. After the batch is confirmed, `notes archive` moves the file to `daily-notes/archive/{date}.md`.

**In the GUI** — a third **Notes** tab in Today (next to Tasks/Recurring):
- Active day: textarea with autosave (600ms debounce) + a quick-add input (Enter appends an entry with a `### HH:MM` heading).
- Past days: read-only (prefers `archive/` when present, falls back to live).

## Tracker

Commitments other people made to you, external deadlines and events — the things you do not execute yourself but must not forget.

```bash
kb tracking add --kind commitment --area work --title "Campaign assets" --assignee alice --due 2026-07-24
kb tracking add --kind external-task --area finance --title "Quarterly filing" --assignee external --due 2026-07-31
kb tracking list --json
kb tracking list --area work --not-done
kb tracking edit trk_007 --status done
kb tracking delete trk_007
```

Kinds: `commitment` | `event` | `external-task`. Statuses: `todo` | `in-progress` | `done` | `cancelled`. `--assignee` is a free-form string (a name, `external`, or nothing).

## Overdue

```bash
kb overdue
kb overdue --json
```

Lists `column=doing` tasks whose `dueDate` is before today.

---

## GUI

Launch **Second Brain.app** from the Dock.

### Screens

| Screen | Description |
|-------|-------------|
| **Today** (default) | Date picker in the header — pick any day, defaults to `active.date`. Tasks / Recurring / Notes sub-tabs with checkboxes. A "📅 Viewing a closed session" banner for past days; a ⚠️ auto-close banner when the previous session was closed after 72h. |
| **Tracker** | Commitments / events / external tasks grouped into overdue / this week / later. |
| **One screen per area** | A 3-column kanban (todo/doing/done) + a Recurring sub-tab per area. The sidebar list, colors and emoji come from `areas.yaml`. |

**Date picker view:** clicking any day fetches `dayView(date)` over the `day:view` IPC. Day states:
- `active` — current session, live data
- `closed` / `auto-closed` — closed snapshot (frozen `doingSnapshot` + `doneTasks` filtered by `completedSessionDate=date`)
- `future` — a future day with planned content. Sections "📌 Planned for {date}" + "⏰ Due that day (deadline, not planned)" + Recurring. Read-only.
- `empty` — no session and nothing planned

### Operations

- Drag-drop tasks between kanban columns (per-area views).
- **Drag-drop reschedule**: open the date picker in Today → drag a task onto a future day cell → emerald ring → drop = `tasks.reschedule`. Past cells disabled.
- Click a task → edit modal (`due` editable, `planned` read-only display + a "Move to day…" button, "Open in Obsidian" when `parentGoalRef` is set).
- Checkbox in Today → the task/recurring moves to done. **Past days (closed/future): checkboxes and drag-drop are read-only** (greyed out, clicks blocked) — mutations only apply to `active.date`.
- Drag done→todo in Today → restores it to doing.
- **Notes tab**: quick-add input (Enter) + autosaving textarea. Past days read-only.
- CLI changes appear in the GUI within ~500ms (file watcher). Daily-notes file changes are filtered out of the global reload (the Notes tab manages itself).

---

## Obsidian deep links

The `--parent-goal-ref` field on tasks and recurring rules points at a file and section in your vault — which, by default, is the workspace itself:

```bash
kb task add --area work --title "Set up the newsletter" \
  --parent-goal-ref "areas/Work/planning/2026-07.md#goal-2"
```

In the GUI, "Open in Obsidian" opens `obsidian://open?vault=<workspace-dir-name>&file=...`.

---

## Environment variables

| Variable | Effect |
|---------|--------|
| `KB_KANBAN_ROOT` | Storage root override, used verbatim. Highest precedence; handy for tests: `KB_KANBAN_ROOT=$TMPDIR/kb-test kb today --json`. |
| `KB_DEV=1` | Use the `.kanban-dev/` sandbox instead of `.kanban/`, at whichever resolution step applies. Keeps experiments out of real data. |
