---
description: Morning daily planning — overdue blocker, yesterday carry-over, co-create today's priorities
allowed-tools: Read, Bash(kb:*), Bash(date:*), Write, Edit, Agent, SendMessage
---

# Daily Planning — Morning

Date: !`date +%Y-%m-%d` | Day: !`date +%A`
Work days: **Mon-Fri (default — adjust to your rhythm)** | Off days: NO /today-morning
Previous work day: skip configured off days, else previous calendar day.

> Sections §1/§1b (team sync via external boards) are intentionally absent — see `docs/claude-integration.md` → Known limitations if you want to add your own sync agent. The remaining section numbers are kept as-is so cross-references stay stable.

---

## 0. Trigger Detection (MANDATORY — before sync)

Check day + date, propose/enforce before briefing:

- **Last work day of week** → soft reminder: "Run `/weekly-review` tonight or over the weekend."
- **First work day of week** → if `journal/weekly-reviews/YYYY-WXX.md` (prev week) missing → "Last week's review was never done. Run it now?"
- **1st of month** (work day) → "New month. Run `/plan` per area?" Skip if `journal/monthly-reviews/{prev-month}.md` exists.
- **2nd of month** (when 1st = off day) → same trigger as 1st.

User accepts → execute before continuing. User rejects → continue.

---

## 0a. kb Load (MANDATORY) — via `kb-ops` agent

Never call `kb` directly. Spawn `kb-ops` (foreground), FULL ops manifest below in one round-trip — all session reads (0a+0b+0c+3a.3) in this single spawn.

⚠️ **HARD RULE — one agent per session (no re-spawn):** this spawn = the ONLY kb-ops spawn in the session. Capture `agentId`. Later kb-ops requests (§6 write-once batch, 0c retroactive archive) → `SendMessage` to that agentId, NEVER a new Agent spawn. Re-spawn = cold-start ~20k tokens. # post-mortem 2026-07-09: eod 7 spawns ≈ 140k, morning 3 spawns ≈ 69k subagent tokens

Ops manifest (8 ops, one prompt — SSoT of the read list; 0b/0c/3a.3 only process results):

```
intent: mutate, operation: session.promote-today, reason: "/today-morning open today's session"
intent: read, operation: today
intent: read, operation: overdue
intent: read, operation: tracking.list, params: { dueBefore: "{today+8}", notDone: true }   # → 0b
intent: read, operation: notes.read, params: { date: "{prev-work-day}", archive: true }     # → 0c
intent: read, operation: day.view, params: { date: "{today+1}" }                            # → 3a.3
intent: read, operation: day.view, params: { date: "{today+2}" }                            # → 3a.3
intent: read, operation: day.view, params: { date: "{today+3}" }                            # → 3a.3
```

# session.promote-today first: lazy ensureSession uses date from existing active.json — without explicit promote, reads yesterday's state instead of today's
# day.view ONLY +1..+3, NOT +4..+7 (tracker 0b covers it; post-mortem 2026-05-21: 6 day.view = ~470s)

**FULL PAYLOADS (HARD RULE):** manifest prompt MUST include: "for EVERY task in today/overdue/dueOnlyToday/day.view return full payload: id, title, desc (1 sentence gist), due, planned, column, priority". Main context NEVER greps/reads board storage files — all task details come from the kb-ops response. # retro 2026-07-16: ~8 Bash greps over boards in main = ~8 permission prompts

From response, capture:
- `payload.date` — active session date
- `payload.autoClosed` — if set: flag "⚠️ Session {date} auto-closed after {h}h, {N} recurring marked missed"
- recurring pending/done/skipped, doing tasks, overdue
- **`payload.dueOnlyToday[]`** — tasks with `dueDate=active.date && plannedDate≠active.date`. Flag: "⏰ Deadline today but not planned: [N tasks]" → propose as candidates in section 3 (need `task.reschedule --to today` or `move --column doing` to anchor)

On `status: error` "kb binary not installed" → STOP, surface error to user (kb is SSoT — no fallback). Fix binary first.

**Empty kb ≠ clean day.** `0 overdue` + `0 tasks` = strong signal to surface new candidates in section 3. Goal: generate today's plan from boards, due-dates, ROADMAP, observations, yesterday digest.

**Hard overdue blocker:** if `overdue` non-empty → STOP for DECISIONS (not writes — see Write-once below). For each:

```
⛔ Overdue blocker — decision required:
  [t_XXX] "Title" (area: X, for Y days)
  → done / reschedule YYYY-MM-DD / skip
```

**Cluster rule:** tasks = one decision chain (kb-ops flags a chain, or obvious from titles: verify→decide→pick) → ONE question "whole chain?". Goal: overdue + dueOnlyToday fit in 1 AskUserQuestion round (limit 4 questions). # retro 2026-07-09 morning #2

Mapping decision → op (written in §6 batch, reason: "overdue resolution from /today-morning"):
- done → `operation: move, params: {id, column: done}`
- reschedule to other day → `operation: task.reschedule, params: {id, to: YYYY-MM-DD}`
- reschedule to today → two ops: `task.reschedule {to: today}` then `move {column: doing}` — reschedule alone sets plannedDate but doesn't anchor; task won't appear in Today without move→doing
- skip → `operation: delete` (agent returns `needs-approval` → confirm with user → resend `confirm: true`)

**Write-once HARD RULE:** STOP = decision gate, not a write gate. ZERO mutations between question rounds — collect decisions (overdue + 0b tracker + dueOnlyToday + candidates), ALL mutations in ONE `SendMessage` to kb-ops in §6. Exception: 0c retroactive archive (hard blocker, write immediately). # ref: kb-ops.md §6a layer-1 + retro 2026-07-09 morning #3

Continue after all overdue decisions collected.

---

## 0b. Tracker scan (MANDATORY) — op in manifest 0a

From `tracking.list` response extract:
- `overdue[]` — `dueDate < today`
- `due_soon[]` — `dueDate ∈ [today, today+3]`
- `upcoming[]` — `dueDate ∈ [today+4, today+7]`

For each `overdue` / `due_soon` — offer 4 options:

```
📅 Tracker needs attention:
  ⚠️ overdue (3 days) — trk_007 [work @alice] event assets (due: 2026-04-30)
     → (a) add kb task / (b) done / (c) reschedule / (d) skip ?
```

- **(a)** `kb-ops` add task with `ref: trk_NNN` in description (stable pointer)
- **(b)** HARD RULE: `kb-ops` `tracking.edit {id, status: "done"}` — memory note alone is NOT sufficient, item returns tomorrow
- **(c)** `tracking.edit --due YYYY-MM-DD`
- **(d)** no action

**Batch:** decisions → §6 batch (Write-once from 0a). Pattern:
- (a) decisions ≥2 → `task.add-batch` with `items[]`
- (b)/(c) ≥1 → `tracking.edit` ops in the same batch
- (d) → no-op skip

Not a hard blocker — surface only, continue regardless.

---

## 0c. Daily-notes archive sanity check — op in manifest 0a

From `notes.read` response + digest check (main does ONE Read of `journal/{prev-work-day}.md` and checks for a `## Digest` header — no grep sweeps):

- Archive non-empty → EOD ran correctly, skip.
- Archive empty BUT yesterday's journal has `## Digest` → EOD ran, scratchpad was empty at close — benign, skip.
- Archive empty AND live scratchpad file exists → EOD was skipped. Flag:

```
⚠️ Yesterday's scratchpad ({yesterday}) was not archived.
   Content: {content preview, max 500 chars}
   Action: retroactive /today-eod or `kb notes archive --date {yesterday}`?
```

**Single day missing** → don't block, note as known issue in §9.

**2+ days in a row missing** (add `notes.read {date: prev-work-day-2, archive: true}` to the round-trip; if also empty) → HARD blocker:

```
⛔ /today-eod skipped 2 days in a row ({day-2}, {day-1}) — retroactive archive required.
   Action: `kb notes archive --date {day-2}` + `kb notes archive --date {day-1}` before continuing.
```

Resolve via kb-ops `notes.archive` per day, then continue briefing.

---

## 2. Yesterday Carry-Over (Interactive — MANDATORY)

**Digest-first short path:** yesterday's journal has `## Digest` (EOD ran) → do NOT re-ask about wins (already in digest), content = read the `## Digest` section only (NOT the full file). Checkboxes: states from Digest (✅/⏭ lines) → targeted Edit `- [ ]` → `- [x]`/`- [⏭]` — MANDATORY, don't skip silently. Bridging below still applies. # retro 2026-07-09 morning #4

No `## Digest` → full flow. Open `journal/{prev-work-day}.md`, section "Today's Priorities":

```
Yesterday's priorities (YYYY-MM-DD):
- [ ] Priority 1 → done / carried-over / skipped
- [ ] Priority 2 → ...

From kb: ✅ [completed] | ⏭️ [incomplete]
Wins or challenges not visible above?
```

Update yesterday's note: `- [ ]` → `- [x]` (done) or `- [⏭]` (skipped). Append to "Yesterday Review".

**Bridging (MANDATORY):** each ✅/⏭ generates today candidate:
- ✅ done → follow-up? Patterns: "spec ready" → "send for review", "handed off to X" → "follow up with X", "meeting" → "write up action items", "research" → "decision + announcement"
- ⏭ skipped → today / reschedule (date) / drop. If today → full payload candidate for section 3
- "Waiting on X" → task "Ping X if no update by [date]"

Bridging candidates → section 3 pool.

---

## 3. Planning + Insights

**Goal:** propose 5-10 concrete task candidates before asking user anything. User corrects, not creates from scratch.

### 3a. Surface candidates (MANDATORY — before questions)

Scan all sources:

1. **Yesterday bridging** (section 2): follow-ups + carried-over + ping tasks
2. **Tracker** (from 0b: overdue + due_soon + upcoming): each without kb task → candidate. Meeting in +1..+3 days → "prepare materials for [meeting] (date)"
3. **Look-ahead +1..+3** — data from manifest 0a (`day.view` ×3, zero new calls). Surface: `plannedTasks[]`, `dueOnlyTasks[]` (red flag: need anchor or reschedule), `recurring[]` (esp. meeting/planning). Format: "⏰ On [day] (X days): N deadlines (K unplanned) + meeting Y → 'Prepare materials for [event]'". For +4..+7 tracker 0b (due_soon/upcoming) is enough.
4. **ROADMAP Now bucket** per area (optional convention): if `areas/{AreaDir}/ROADMAP.md` exists → Read the "Now" section; entries with no kb counterpart → "start [item]"
5. **Boards in-progress** (from kb-ops 0a payloads): `doing` tasks that keep carrying over session after session → "unblock [task]"
6. **Observations `!`** per area: if `areas/{AreaDir}/observations.md` exists → Read `## Active`, filter `!` blockers → "resolve [blocker]"

**HARD RULE — zero Bash/grep in main for 3a:** all data comes from the kb-ops response + at most single-file Reads of the optional convention files above. Missing something from kb → SendMessage to the agent, not your own grep. # retro 2026-07-16

### 3b. Candidate format — full kb payload (ready for `kb add`)

> Fields + quality rules (SSoT): `.claude/skills/kb-task-payload.md` (/today-morning extension: `source`, `why today`).

```
[N] {title}
  area: {one of `kb area list`}
  priority: {1-10}
  due: {YYYY-MM-DD or "today"}
  description / DoD: {1-2 sentences, measurable}
  source: {tracker|ROADMAP|yesterday|observation|board}
  why today: {1 sentence}
```

No 1-liners. User approves in one decision.

### 3c. Proactive insights (ALWAYS — after candidate list)

1. **Drift:** task stuck multiple days → flag
2. **Strategic gap:** a goal from `areas/{AreaDir}/planning/{YYYY-MM}.md` absent from today's candidates → call out
3. **Claude offers (1-2):** specific output, never vague
4. **Pattern (1 sentence):** name recurring pattern once

### 3d. Questions (ONLY after surfacing)

**MANDATORY first AskUserQuestion (batch — single tool call):**
- Every item from `dueOnlyToday[]` (from 0a kb response) → separate question in batch, options: (a) Anchor to Today / (b) Reschedule +1d / (c) Done / (d) Skip. Default: (a).
- Candidate selection from section 3a → second question in the SAME AskUserQuestion call (multiSelect: true).
- Insights/offers (3c) requiring decisions → further questions in the SAME call.

**HARD RULE:** `dueOnlyToday[]` NEVER asked separately in a second round — always batched with the first AskUserQuestion, together with the overdue blocker from 0a (STOP = decision, not a separate round). >4 items → Cluster rule from 0a (decision chains → 1 question) instead of a second round. AskUserQuestion accepts 1-4 questions — use the limit.

Forbidden (vague, user creates from scratch):
- ❌ "What do you want to do today?"
- ❌ "Which one is most urgent?"
- ❌ "Deep work or tactical day?"

OK (concrete, user corrects a proposal):
- ✅ "Out of 8 candidates for [area] — which do you drop?"
- ✅ "Anything missing from [area]?"
- ✅ "Candidate [X] — confirm it's for today?"

---

## 4. Day-Specific

**Recurring** — single-line mention ONLY:

> 🔁 Recurring today: [comma-separated 1-2 word labels].

**Full briefing exception — planning/retro recurring only:**
- Last work day / review day → weekly-review
- 1st of month → monthly planning (`/plan`)
- Other retros → full agenda

Daily habits → **always 1-2 words**.

---

## 5. Finalize Priorities (after user corrections)

Finalize 3-7 priorities:
- Reference kb tasks
- Connect to `areas/{AreaDir}/planning/{YYYY-MM}.md` goals
- Balance across areas, strategic/operational
- Each has full payload (3b) — ready for section 6

---

## 6. kb Write — the ONLY mutate of the session (`SendMessage` to kb-ops from 0a)

Write-once (0a): EVERYTHING lands here — overdue resolutions + 0b tracker decisions + dueOnlyToday anchors + new tasks. One SendMessage, ops sequentially.

`intent: mutate, reason: "from /today-morning priorities"`. REQUIRED per item add: `desc` (1-3 sentences with DoD) — kb-ops rejects add without it.

**HARD RULE:** ≥2 new tasks → ONE request with `params: { items: [...] }`. No N separate adds. Each item `column: "doing"`.

```jsonc
{
  "intent": "mutate",
  "operation": "add",
  "reason": "from /today-morning priorities 2026-05-04",
  "params": {
    "items": [
      {"area":"work","title":"Prepare quarterly summary","priority":10,"due":"2026-05-04","desc":"...","column":"doing"},
      {"area":"career","title":"Record talk demo","priority":10,"due":"2026-05-04","desc":"...","column":"doing"}
    ]
  }
}
```

Each new task requires user confirmation. Agent returns ids + summary.

**Anchor to Today view:** `add-batch` with `column: "doing"` anchors tasks automatically. If kb version doesn't support per-item column → write IDs to daily note as "anchor manually in UI" + report in section 9 as known issue.

**Reschedule existing task:**
```jsonc
{ "intent": "mutate", "operation": "task.reschedule", "reason": "from /today-morning — user decision",
  "params": { "id": "t_037", "to": "2026-05-08", "reason": "turned out complicated, better on Friday" } }
```

Agent calls `kb task reschedule` → emits `task.rescheduled` event → auto-log in daily-notes/{today}.md.

---

## 7. Daily Note

File: `journal/YYYY-MM-DD.md`. The workspace is an Obsidian vault — the note is written Obsidian-native: YAML frontmatter, navigation wikilinks between work days, area links on priorities.

```markdown
---
date: YYYY-MM-DD
type: daily
tags: [daily]
---

# YYYY-MM-DD ([Day])

← [[{prev-work-day}]] | [[{next-work-day}]] →

## Yesterday Review ({prev-work-day})
**Completed:** ✅ [items]
**Not completed:** ⏭️ [items]
**Notes:** [wins, challenges]

---

## Today's Priorities
- [ ] Priority 1 ([[{AreaDir}]])
- [ ] Priority 2 ([[{AreaDir}]])
**Recurring today (mention):** 🔁 [comma-separated 1-2 word labels]
```

- `{AreaDir}` = the area's hub note (`areas/{AreaDir}/{AreaDir}.md`), so `[[Work]]` resolves unambiguously.
- The `# YYYY-MM-DD (Day)` header stays below the frontmatter — greppability, and §8's digest-first check depends on headers, not offsets.
- Entity wikilinks per `_memory/linking-rules.md` (missing file → plain text).

---

## 8. Yesterday Digest

Append `## Digest` to previous day's journal. Skip if missing or already has Digest. Find the insertion point by searching for the `## Digest` header — never by byte offset (frontmatter shifts every offset).

```markdown
## Digest
- ✅ X/Y done: [key tasks]
- ⏭️ [deferred]
- [key decisions/events]
```

---

## 9. Mandatory Output Block (before Observer)

```
## ✅ /today-morning summary
- Added to kb: [N] (IDs: t_XXX, ...)
- Anchored to Today: [M]
- Daily note: journal/YYYY-MM-DD.md
- Yesterday digest: ✅ appended / ❌ skipped (reason)
- Tracker changes (add/edit/done): [N]
- Observations saved: [N]
- Next: [task1 → task2 → task3]
```

Missing block = briefing incomplete.

---

## 10. Observer (MANDATORY — last step)

1. Review session for new facts/decisions
2. Append to `areas/{AreaDir}/observations.md` under `## Active` (format: `.claude/rules/memory-system.md`)
3. Permanent facts: user fact → `_memory/user-profile.md` | feedback → `_memory/rules.md` (skip when the workspace has no `_memory/`)
4. Max 3. Format: `- YYYY-MM-DD | EMOJI | [source] one-liner`

---

## Edge Cases

**Gap >3 days:** note gap, skip yesterday analysis, fresh start.
**kb unavailable:** `kb-ops` error → STOP, surface error. kb is SSoT (boards + tracker + recurring) — no fallback. User must fix binary.
**Health check `kb`:** `kb --version 2>/dev/null | head -1`. NEVER `cat`/`head`/`file` on binary.
**Review-day reminder:** after section 9: "📅 Remember to run `/weekly-review`."
**Off days (per Work days config):** NO `/today-morning`.
