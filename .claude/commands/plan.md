---
description: Monthly planning per area — generates planning/YYYY-MM.md with goals/tasks/critical path/risks/metrics. Locked area context.
argument-hint: <area> | all
allowed-tools: Read, Write, Edit, Bash(date:*), Bash(ls:*), Bash(mkdir:*), Glob, Agent

---

# /plan {area}

Generates monthly planning doc for selected area. Locked context — do NOT load other areas.

## Execution Context

- Date: !`date +%Y-%m-%d`
- Month: !`date +%Y-%m`
- Prev month: !`date -v-1m +%Y-%m`
- Day: !`date +%A`

## Argument

`$ARGUMENTS` — required. Valid values: any area from `kb area list` (ask kb-ops: `intent: read, operation: area.list` if unsure), or `all`.

If `all` → do NOT plan all areas at once. Reply:

```
Planning N areas requires separate sessions — contexts must not mix.

Open separate windows and run /plan <area> for each area from `kb area list`.
```

Then STOP. Do not execute any area in this session.

If empty → ask user which area.

## Locked Context

Mapping: `{area}` → `areas/{AreaDir}/` — the workspace directory for the area (convention: capitalize each dash-separated part, e.g. `work` → `areas/Work/`, `side-projects` → `areas/Side-Projects/`; see `docs/claude-integration.md` → Workspace layout).

Load ONLY:
- `areas/{AreaDir}/{AreaDir}.md` — the area hub note (folder note; created by `/onboard`)
- `areas/{AreaDir}/ROADMAP.md` (focus: "Now" section — optional convention)
- `areas/{AreaDir}/planning/{prev-month}.md` (if it exists — for the retrospective)
- `areas/{AreaDir}/observations.md` (Active section)
- `MASTER-BIO.md` — ONLY the annual goals section for this area

Do NOT load: other areas, daily notes, weekly summaries.

## Process

### 1. Retrospective (if prev planning exists)

Open `areas/{AreaDir}/planning/{prev-month}.md`. Fill Retrospective:
- Done — tasks with status=done
- Carried over — unrealized → propose transfer
- Dropped — skipped/cancelled
- Insights — patterns from observations + planning notes

Save update to previous planning doc.

### 2. ROADMAP Review (if ROADMAP exists)

Read `areas/{AreaDir}/ROADMAP.md` — "Now" section:
- Which initiatives are active this month?
- Does anything from "Next" advance to "Now" (if slot freed)?

No ROADMAP → derive candidate themes from retrospective + observations, confirm with user.

### 3. Goals (max 3)

Propose max 3 goals for `{current-month}`. Each must:
- Link to a ROADMAP "Now" initiative (or a confirmed theme)
- Be concrete (not "work on X" but "deliver X")
- Be realistic (account for retrospective)

Confirm with user before proceeding.

### 4. Tasks — TWO distinct categories

**CRITICAL:** Every task is either **one-off** (has `due` + `priority`) or **recurring habit** (has `schedule`, NO `priority`). No third option. Never mix fields between categories.

Decision per task: "Do once and mark done?" → **4A one-off**. "Habit/ritual to do cyclically?" (daily, 3×/wk, 1st of month) → **4B recurring**.

Present both lists separately to user before creating (separate tables).

#### 4A. One-off Tasks

For each Goal: break into 3-7 one-off tasks.

**Each MUST have 4 fields** — schema + quality rules (SSoT): `.claude/skills/kb-task-payload.md` (title / description+DoD / due / priority; the /plan extension adds `parent_goal_ref` and requires the due date to fall in the current month). Write contract: `.claude/agents/kb-ops.md`.

Confirmation table: `Title | Description | Due | Priority | Goal`.

#### 4B. Recurring Habits

Habits/rituals to introduce this month — e.g. "Gym 4×/wk", "Read 30 min daily", "Weekly sprint planning Mon 10:00", "Portfolio review 1st of month".

**Fields FOR RECURRING (different set than one-off):**

| Field | Requirements | In one-off? |
|-------|-------------|-------------|
| **Title** | Imperative, ≤80 chars | ✅ |
| **Description** | 1-2 sentences: why this habit, DoD per occurrence | ✅ |
| **Schedule** | One of 5 types: `daily` \| `weekdays` \| `weekly --days mon,wed,fri` \| `interval --every-n-days N` \| `monthly --day-of-month N`. See Schedule format in `kb-ops.md` | ❌ recurring only |
| **Starts-on** (opt.) | `YYYY-MM-DD` — when habit activates | ❌ recurring only |
| **Ends-on** (opt.) | `YYYY-MM-DD` — if habit has end (e.g. "30-day challenge") | ❌ recurring only |
| **Priority** | **DO NOT SET.** Recurring has no priority. If attempted → kb-ops rejects as `invalid params`. | ⚠️ NO |
| **Due** | **DO NOT SET.** Recurring generates occurrences from schedule, no single due date. | ⚠️ NO |

Confirmation table: `Title | Description | Schedule | Starts-on? | Ends-on? | Goal`.

Sanity rule: "code 30 min daily until month end" → recurring (`--schedule daily --ends-on YYYY-MM-30`). "finish project X by May 15" → one-off (`--due 2026-05-15 --priority 7`). If unclear → ask before creating.

#### Pre-flight: Storage Sync Check (MANDATORY)

Before any batch ADD/EDIT/DELETE — call `kb-ops` once with:

> intent: read, operation: list, area: {area}

Compare IDs from storage with IDs in existing `areas/{AreaDir}/planning/{current-month}.md` (if file exists). Three scenarios:

1. **Storage empty / IDs don't match** → treat all tasks in planning .md as placeholders. All operations are ADD (never EDIT/DELETE existing IDs from .md).
2. **IDs match** → normal flow (ADD new, EDIT/DELETE existing).
3. **Partial mismatch** → flag user before batch, ask how to sync.

#### Batch Execution — ONE kb-ops call per /plan session

**Hard rule #1 — no direct `kb` from main context:** main context NEVER runs `kb ...` via Bash. All storage communication goes through Agent(kb-ops). `Bash(kb:*)` excluded from `allowed-tools` — if system asks permission to run `kb` directly, stop and delegate to kb-ops instead.

**Hard rule #2 — one batch:** all operations (add/edit/delete/recurring) go in ONE prompt to kb-ops. Don't add a second call. If batch returns errors ("task not found", etc.) → stop, sync planning .md with storage state, then optionally a second batch.

Agent call template:

```
Agent(
  subagent_type: "kb-ops"   # if unavailable → fallback "general-purpose" + paste contract from .claude/agents/kb-ops.md
  description: "kb batch /plan {area} {YYYY-MM}"
  prompt: <structured request below>
)
```

Structured request format:

> intent: mutate
> operations:
>   # one-off tasks (from 4A) — MUST have due + priority
>   - add: { area, title, description, due: "YYYY-MM-DD", priority: 1-10, parent_goal_ref }
>   - add: { ... }
>   - edit: { id, ... }
>   # recurring habits (from 4B) — MUST have schedule, NO due/priority
>   - recurring.add: { area, title, description, schedule: "daily|weekdays|weekly|interval|monthly", schedule_opts?: { days?, every_n_days?, day_of_month? }, starts_on?: "YYYY-MM-DD", ends_on?: "YYYY-MM-DD", parent_goal_ref }
>   - recurring.add: { ... }
>   - delete: { id, confirm: true }   # after explicit user approval in session
> reason: "/plan {current-month} batch — <short description>"

Validation by `kb-ops`: `add` without `due`/`priority` → reject. `recurring.add` with `priority` or `due` → reject. Your responsibility: don't put wrong fields into wrong operation.

Agent returns table with Title → ID mapping + flag if storage empty/inconsistent. Save IDs to planning doc.

**Planning doc format** — TWO distinct sections under each Goal:

```markdown
### Goal N: <title>

#### One-off Tasks
- [ ] **Task title** — due: YYYY-MM-DD — `priority: 6/10` — [t_XXX]
  - {Description: 1-3 sentences, context + DoD}
- [ ] ...

#### Recurring Habits
- 🔁 **Habit title** — schedule: `daily` (or `weekly mon,wed,fri`, `monthly day-1`, etc.) — [r_YYY]
  - {Description: why, DoD per occurrence}
  - Starts: YYYY-MM-DD | Ends: YYYY-MM-DD (if bounded)
- 🔁 ...
```

Missing section → model reading doc later won't know which tasks are recurring. **Both sections must be present even if one is empty** (use "—").

If CLI unavailable (`which kb` fails) → write `#TBD` in place of IDs, keep all 4 fields in doc, log warning, ask user to add manually.

**Do NOT create tasks missing description, due date, or priority.** If user can't define a field → task is too large/immature: refine before adding to planning doc.

### 4b. Due Dates & Checkpoints (MANDATORY)

Capture what/when to check, who to follow up with, external deadlines in `{current-month}`.

Ask user (2-5 entries):
- What are we committing to or delegating to others (collaborators, external parties) this month? By when?
- What external deadlines (institutions, accountant, authorities, suppliers) fall this month?
- What self-checkpoints (e.g. "check campaign metrics after 2 weeks")?

Present table and confirm:

```markdown
## Due dates & checkpoints

| Date | What | Who | Tracked in |
|------|------|-----|------------|
| 2026-05-10 | Status of delegated assets | Alice | tracker (trk_NNN) |
| 2026-05-15 | Quarterly tax filing | accountant | tracker (trk_NNN) |
| 2026-05-20 | Mid-month campaign review | self | planning doc / kb task |
```

Push via `kb-ops` (single batch, reason: "/plan {area} {YYYY-MM} due-dates"):
- Entries involving **other people** or **external institutions** → `tracking.add` per entry: `{ area, who, what, due: "YYYY-MM-DD", status: "todo" }`. Save returned `trk_NNN` ID into "Tracked in" column of planning doc.
- "Self-only" checkpoints → planning doc only, or kb task with `due` field (if it requires action).
- Before adding: ask user if any entry is duplicate of existing tracker item (`tracking.list` if needed).

### 5. Critical Path

Ask user: which blocking task sequence? Numbered list of 3-5 elements (not all tasks).

### 6. Risks

Ask user: 2-3 biggest risks + mitigation. From observations: blockers, external deadlines, dependencies on others.

### 7. Success Metrics

Ask user: how will I know the month succeeded? **Measurable** (numbers, dates, deliverables — not "better", "more").

### 7b. Consistency Check

- Does every task with due date < month end have a tracker entry (if checkpoint needed), or is tracking via kb task alone acceptable?
- Did every "someone delivers to me" commitment land in tracker (`tracking.add`)?

### 8. Save (MANDATORY)

**Output must go to `areas/{AreaDir}/planning/{current-month}.md`** — single source of truth. Without this file `/today-morning` won't load due dates and next month's retrospective has nothing to work with.

Steps:
1. `mkdir -p areas/{AreaDir}/planning/`
2. If file exists (user ran `/plan` twice this month) → ask user: overwrite / append / abort?
3. Save `areas/{AreaDir}/planning/{current-month}.md` from `.claude/templates/Monthly Planning.md`.
4. File MUST contain **"One-off Tasks"** and **"Recurring Habits"** sections under each Goal (even if empty — use "—"). Without this, model reading doc later won't know which tasks are recurring.

After save — short summary to user (Goals + critical path).

## /plan all

See Argument section — `/plan all` does not plan, only instructs user to open separate windows.
