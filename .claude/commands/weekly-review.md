---
description: Weekly review assistant - analyze past 7 days, aggregate progress, generate insights and metrics
allowed-tools: Read, Bash(date:*), Bash(ls:*), Write, Edit, Grep, Glob, Task

---

# Weekly Review

Analyze 7 days of daily notes, aggregate progress, generate insights.

Default cadence: end of week, evening. Trigger in `/today-morning`: last work day → soft reminder, first work day of next week → fallback.

## Execution Context

- Date: !`date +%Y-%m-%d`
- Week: !`date +%V` (ISO 8601 — Mon-Sun. NOT %U which is Sunday-based and off by one)
- Week start (Mon): !`date -v-Mon +%Y-%m-%d`
- Week end (Sun): !`date -v+Sun +%Y-%m-%d`
- Day: !`date +%A`

## Process

### 1. Gather Daily Notes

Scan `journal/` last 7 days. List present/missing days, count total.

### 1b. Read Context

- `_memory/rules.md` + `_memory/user-profile.md` (skip when the workspace has no `_memory/`)
- Per area from `kb area list`: `areas/{AreaDir}/observations.md` (if it exists)

Observations = compressed insights from sessions, may not appear in daily notes (mid-week decisions, inferred patterns).
Merge observations into area analysis (Step 3). Unresolved `!` and `?` → Challenges.

Journals: if daily note has `## Digest`, read Digest only. Full journal only if Digest insufficient.

### 2. Aggregate Data

**Tasks:** count `- [x]` (done), `- [ ]` (open), categorize by area.

**Themes:** frequent topics, tags, meetings, projects.

**TIL:** aggregate learnings.

**Wins:** ✅, 🎉, "completed", "shipped".

**Challenges:** ❌, "blocker", "problem".

### 3. Area Analysis

Per area (from `kb area list`):
- Progress vs goals in `areas/{AreaDir}/planning/{YYYY-MM}.md` (if it exists)
- Wins delivered this week, key decisions
- Blockers + unresolved `!`/`?` from observations
- Anything stuck (same item mentioned 2+ weeks in a row → flag explicitly)

### 4. Metrics

**Productivity:** daily notes X/7, tasks completed X, completion rate X%.

**Focus:** {area} X% per area (share of completed tasks).

**Consistency:** streak, gaps.

### 5. Insights

- What Went Well: top 3-5 wins
- What Didn't: blockers, missed goals
- Patterns: best days, time sinks, energy

### 6. Carryover

List unfinished high-priority items. Do NOT create tasks or plan next week — that's `/plan <area>`.

### 7. Create Weekly Review

**File:** `journal/weekly-reviews/YYYY-WXX.md`

```markdown
---
week: YYYY-WXX
range: YYYY-MM-DD → YYYY-MM-DD
type: weekly-review
tags: [weekly-review]
---

# 📊 Weekly Review - Week XX, YYYY

← [[YYYY-W{XX-1}]] | [[YYYY-W{XX+1}]] →

Generated: [Date]

## Digest
- Tasks: X completed / Y total (Z%)
- Wins: [top 2-3 one-liners]
- Challenges: [top 2-3 one-liners]
- Carryover: [key unfinished — do /plan in separate session]
- Pattern: [1 sentence if detected]

---

## 📈 Metrics

- Daily notes: X/7 | Tasks: X done | Rate: X%
- Days: [[YYYY-MM-DD]] · [[YYYY-MM-DD]] · … (one wikilink per daily note found in §1; missing days omitted)
- Time: [{area} X% per area]
- Streak: X days | Missing: [days]

---

## 🏆 Wins

### {area} (one subsection per area with content)

---

## 🤔 Challenges

---

## 💡 Learnings

---

## 📋 Carryover

- [ ] [task — move to /plan {area}]

---

## 🔍 Session Observations

### {area}
[entries from observations.md this week]

---

## 🔗 Surprising connections (graphify — only if step 7e ran)

[1-2 cross-area links from the graph, e.g. "Pattern X connects area A with area B via Y"]

---

## 🔗 Daily Notes

- YYYY-MM-DD - Monday
...

**Next Review:** [next review date]
```

Digest goes at top of file (under title, before Metrics). Target 8-12 lines. Full review stays below for drill-down.

### 7b. Reflector — Compress Observations (delegated subagent)

> Pipeline: the compression mechanics run in subagent `reflector` (model sonnet), main only orchestrates + writes after your accept. Subagent prepares a proposal; decision/write = user+main. Compression rules: agent reads `.claude/rules/memory-system.md` itself. Skip if review was not created (<3 daily notes / user declined).

1. Spawn `reflector` (Task) — input: `week`, `range`, `digest` (from this review's Digest section), `areas` = N× {observations + archive path}, one pair per area from `kb area list` that has an observations file. ONE spawn, all areas.
2. Reflector writes `journal/.cache/reflector-proposal-{WXX}.md` (per area: archive-append + new-Active) and returns a 1-line summary. Does NOT mutate live observations.
3. Read proposal → show the user a **diff per area** (what → archive, what stays Active).
4. Accept → per area: append archive-append under `### WXX (range)` in `observations-archive.md`; replace Active with the new content (keep frontmatter + header); update frontmatter `last-cleared` (obs) / `last-compressed` (archive) → today. (File >100 lines → delegate the write to `scribe`.)
5. Digest backfill: check this week's journals — missing `## Digest` → generate and append.

### 7c. Observer (MANDATORY)

After compression, extract observations from this review session:
1. Scan for new insights/patterns from aggregation
2. Append to `areas/{AreaDir}/observations.md` Active with source tags
3. New permanent user facts → `_memory/user-profile.md` (skip when the workspace has no `_memory/`)
4. Max 3 total.

### 7d. Tracker Sweep (MANDATORY)

Call `kb-ops` `intent: read, operation: tracking.list, params: { all: true }`. From response:
- `overdue` items >7 days without movement → flag in Challenges (`🚧 Stale overdue: ...`)
- `due_soon` (≤7 days) → add to Carryover
- `done` in the last week → mention in Wins (tracker archives itself via status)

No mutations — sweep is read-only. User action goes through `/today-morning` 0b or `/today-eod` 2b.

### 7e. Graphify Update (optional — skip if graphify not initialized)

After saving the review + compressing observations:

1. If `graphify-out/` does not exist → skip this step, log in output ("graphify not initialized — run `/graphify .` first").
2. Run `/graphify --update` (Skill tool, skill: `graphify`, args: `--update`) — re-extracts changed `.md` files, rest from cache. Goal: the new weekly review + archived observations enter the graph.
3. Cross-area patterns query: for each pattern/blocker from this week (Patterns section) → `graphify query "what connected {pattern} with other areas?"`. Max 1-2 queries. Findings → section `## 🔗 Surprising connections` in the review doc.
4. Optional link audit: read `graphify-out/GRAPH_REPORT.md` section `## Knowledge Gaps` — isolated/weakly-connected nodes that correspond to recurring entities (people, tools, projects; ≥3 mentions cross-file) → propose adding links at the mention sites. Proposals only, no auto-edits; user approves.

### 7f. Memory Cleanup (optional)

`_memory/` files carrying an `expires:` frontmatter key: expired ones → move to `_memory/archive/`, update references. No `_memory/` → skip.

## Special Cases

- Mid-week (Mon-Wed only): label "Mid-Week Check-In"
- First week: simpler template
- <3 notes: ask if continue, suggest filling gaps
- After vacation: acknowledge break

## Integration

- First review of the month: generate monthly summary → `journal/monthly-reviews/YYYY-MM.md`

---

## Monthly Summary (first review of month only)

Trigger: `date +%d` ≤ 7 AND review day.

**File:** `journal/monthly-reviews/YYYY-MM.md`

```markdown
---
month: YYYY-MM
type: monthly-review
tags: [monthly-review]
---

# 📊 Monthly Review - [Month] YYYY

← [[{prev-month}]] | [[{next-month}]] →

Generated: [Date]

## 📈 Overview

- Weeks: W01-W04 | Daily notes: X/~30 | Weekly reviews: X/4

## 🎯 Goals Progress (vs areas/{AreaDir}/planning/{YYYY-MM}.md)

| Area | Goal | Progress | Status |
|------|------|----------|--------|
| {area} | | | 🟢/🟡/🔴 |
| ... one row per area ... | | | |

## 🏆 Highlights / 🤔 Challenges / 💡 Learnings

[Aggregated from weekly reviews]

## 🔄 Patterns

## 📋 Next Month Focus

- [ ] Priority 1/2/3

## 🔗 Weekly Reviews

- YYYY-W01 through YYYY-W04
```
