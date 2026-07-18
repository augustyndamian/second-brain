---
description: End-of-day close — check kb status, write daily digest, save to journal. No planning, no new tasks.
allowed-tools: Read, Agent, SendMessage, Bash(date:*), Write, Edit
---

# End of Day

Date: !`date +%Y-%m-%d` | Day: !`date +%A`

---

## 1. kb Status — via `kb-ops` agent

⚠️ **Order is critical:** read → reschedule unfinished → THEN session.close. Closing first freezes unfinished tasks in `doing` in the historical snapshot even after reschedule.

⚠️ **HARD RULE — one agent per session (no re-spawn):** Spawn `kb-ops` ONCE (§1.1). Capture `agentId` from result. ALL later kb-ops requests this session (§1.2, §1.3, §1a follow-ups, §1b archive, §2a, §2b) → `SendMessage` to that agentId, NEVER new Agent spawn. Re-spawn = cold-start ~20k tokens each. # post-mortem 2026-07-09: 7 spawns ≈ 140k tokens; 1 spawn + SendMessage ≈ -70%.

### 1.1 Read state (before mutations) — ONE spawn, ALL reads

Single kb-ops call, six read ops (all needed regardless of state):

```
intent: read, operation: today
intent: read, operation: overdue
intent: read, operation: tasks.with-notes-today
intent: read, operation: notes.read, params: { date: <active.date> }
intent: read, operation: audit   # filter task.rescheduled sessionDate=active.date; drop no-ops from→to same date
intent: read, operation: ghost-check   # kb task list --json → filter: column≠done AND plannedDate≤active.date AND id NOT IN (today.tasks ∪ today.overdue). Return matching ids+titles or []
```

From `today.tasks[]` + `today.overdue[]` + `ghost-check[]` collect `unfinishedTaskIds` (anything not `column=done`).

⚠️ **HARD RULE — ghost-check:** `today` shows only tasks anchored in the session; anchor drift = tasks invisible despite planned=today. # post-mortem 2026-07-16: no-op reschedule de-anchored 3 tasks → EOD saw "0 unfinished", tasks sat overdue. Core has self-heal in `today()`, ghost-check = second net. Ghost-check non-empty → treat as unfinished (§1.2) + report to user "⚠️ N tasks recovered outside today (anchor bug?)".

Results feed §1a/§1b/§1c — don't re-read there.

### 1.2 Reschedule unfinished (required if any)

If `unfinishedTaskIds` non-empty:

1. Check ARGUMENTS for target date ("tomorrow", "to 2026-05-10", "X and Y tomorrow, Z Monday").
   - "tomorrow" → `active.date + 1`
   - specific date → use it
   - no instruction → ask: "Where to move the unfinished tasks? (tomorrow / specific date / decide per task)"

2. `SendMessage` to kb-ops from §1.1 — batch ALL `task.reschedule` ops in ONE message (HARD RULE — kb-ops §6a layer-1):
   ```
   intent: mutate, reason: "carry-over from <active.date> — /today-eod (<user reason>)"
   ops:
     - operation: task.reschedule, params: { id: "<id1>", to: "<YYYY-MM-DD>" }
     - operation: task.reschedule, params: { id: "<id2>", to: "<YYYY-MM-DD>" }
     ...
   ```
   N tasks → 1 agent call (~25s), not N calls (~N×10s + kb).

3. Confirm: "✅ N tasks moved to YYYY-MM-DD."

⚠️ **HARD RULE:** Reschedule BEFORE session.close. `task.reschedule` updates `plannedDate` + demotes `doing→todo` → task exits snapshot. `dueDate` unchanged (business deadline, not execution date).

### 1.3 Session close (after reschedule)

```
intent: mutate, operation: session.close, reason: "/today-eod close"
```

⚠️ **Post-close assert:** close result `unfinishedTaskIds` MUST be `[]`. Non-empty = something slipped past §1.2 → reschedule the missing ones (batch, §1.2 format) → `session.close` again (idempotent, verified 2026-07-16). Do not ignore.

Display summary:
```
Today (active.date YYYY-MM-DD, session closed):
✅ Recurring done: N/M (auto-marked missed: K)
✅ Tasks done: [titles]
⏭️ Carry-over → YYYY-MM-DD: [rescheduled]
⚠️ Overdue (no reschedule): [if any]
```

---

## 1a. Notes from today's done tasks

Data already in §1.1 result (`tasks.with-notes-today`) — no new read. "no notes today" → skip silently.

For each note (max ~5; if more, ask user to prioritize):
1. Analyze note in context of area + task title.
2. Propose **one** action per note:
   - **(a) journal append** — bullet in `journal/YYYY-MM-DD.md` section `## Notes from done tasks`
   - **(b) follow-up task** — `kb-ops mutate add` with area/title/due/priority + **`description` (1-3 sentences with DoD — REQUIRED, kb-ops rejects without it)**
   - **(c) observation** — entry in `areas/{AreaDir}/observations.md` as `[t]`
3. Present as:
   ```
   1. [t_042 career — "Prepare client brief"] note: "After finishing, hand the assets over to Alice"
      → proposal: (b) task career "Hand assets over to Alice" due 2026-05-03 prio 6
   ```
4. User confirms → batch execute. Notes stay on tasks (auto-filter tomorrow by `completedAt=today`).

---

## 1b. Daily-notes scratchpad

Data already in §1.1 result (`notes.read`) — no new read. `payload.empty === true` → skip silently.

Parse content on `### HH:MM[ [auto:source]]` blocks:
- **Manual entries** (no `[auto:`) → dialog per block
- **Auto-log entries** (`[auto:source]`) → render as "📋 Auto log of the day" summary, no dialog

For each manual entry, propose **one** action:
- **(a) journal append** → `journal/{active.date}.md` section `## Daily notes`
- **(b) new task** → `kb-ops mutate add` (REQUIRED: `description` 1-3 sentences with DoD)
- **(c) observation** → `areas/{AreaDir}/observations.md`
- **(d) tracker entry** → `kb-ops mutate tracking.add`
- **(e) ROADMAP update** → Edit `areas/{AreaDir}/ROADMAP.md` (if the workspace keeps one)
- **(f) drop** → no action

```
1. [12:34] "New commitment from Bob: database refactor — wants it by May 15"
   → proposal: (d) tracker: work commitment @bob "Database refactor" due 2026-05-15

2. [14:02] "Idea: educational short videos 2× per week"
   → proposal: (e) ROADMAP work Now: "Educational shorts 2x/wk"
```

User confirms → batch execute → **archive scratchpad**:
```
intent: mutate, operation: notes.archive, reason: "from /today-eod after processing",
params: { date: <active.date> }
```

---

## 1c. Rescheduled today (audit)

Data already in §1.1 result (`audit`) — no new read.

Filter events `task.rescheduled` where `sessionDate === active.date` AND `fromPlanned !== toPlanned` (no-op X→X = anchor noise, skip). If non-empty → report:

```
📅 Moved out of today:
  • t_037 [work] "Ping Alice about the assets" → 2026-05-08 (reason: turned out complicated)
  • t_044 [career] "Conference follow-up" → 2026-05-06
```

Informational only — no action needed.

---

## 2. Digest — journal entry

Open `journal/YYYY-MM-DD.md`. If `## Digest` already exists → skip. Locate the append point by header search, not byte offset — the note starts with YAML frontmatter written by `/today-morning`.

**Write mechanics:** file ≤100 lines → append inline (Edit). File >100 lines → compose content in main, delegate the write to agent `scribe` (`file`, `section: "## Digest"`, `content` verbatim). # scribe = write mechanics, NOT editing

Append:
```markdown
## Digest
- ✅ [N]/[M] done: [key tasks]
- ⏭️ Carry-over: [total N] (intra-day reschedule: [M from §1c] | unfinished at close: [K from §1.2]) → [target dates]
- [key decisions, wins, challenges — max 2 lines]
```

⚠️ **HARD RULE — Carry-over scope:** Carry-over = ALL tasks moved out of `active.date`, NOT only unfinished-at-close. Sources:
- §1.2 unfinished-at-close (`doing/todo` at session.close)
- §1c audit `task.rescheduled where sessionDate === active.date` (intra-day → outside session snapshot)

`intra-day=0` ∧ `unfinished=0` → "none". Otherwise always total + breakdown.

---

## 2a. New commitments (others)

> Any new commitments from others today (collaborators/external parties)? (y/n + description or "skip")

If `y` → `kb-ops` `tracking.add` per commitment, reason: "from /today-eod new commitment".
Fields: `area`, `who`, `what`, `due` (YYYY-MM-DD), `status: todo`.

---

## 2b. Tracker reconciliation

> Did you close any tracker commitment/event today? (trk_NNN or description, or "skip")

For each → `kb-ops` `tracking.edit {id, status: "done"}`, reason: "from /today-eod tracker reconciliation".

**Batch HARD RULE:** ≥2 tracker ops (2a `tracking.add` + 2b `tracking.edit`) → ONE `SendMessage` to kb-ops from §1.1. List all ops sequentially in the prompt. # ref: kb-ops.md §6a layer-1.

⚠️ **HARD RULE:** `tracking.edit status=done` is the only way to close a tracker item. Memory note alone = bug — item returns tomorrow.

---

## 3. Observer (optional — max 1)

If notable observation (decision, pattern, win, blocker) → append to `areas/{AreaDir}/observations.md` under `## Active`.
Format: `- YYYY-MM-DD | EMOJI | [source] one-liner` (SSoT: `.claude/rules/memory-system.md`)
Skip if nothing worth keeping.

**Write mechanics:** file ≤100 lines → inline. >100 lines → agent `scribe` (`section: "## Active"`, content verbatim from main).

---

## 4. STOP

No tomorrow planning. No priority questions. No kb task creation.
Tomorrow → `/today-morning`.
