---
description: First-run setup — interview the user, configure life areas, scaffold the workspace (MASTER-BIO, area hubs, journal, _memory) and personalize CLAUDE.md.
allowed-tools: Read, Write, Edit, Glob, Bash(date:*), Bash(ls:*), Bash(mkdir -p *), Agent, SendMessage, AskUserQuestion
---

# /onboard

Turns a fresh clone into **your** workspace. Run once, right after `pnpm install:local`. Re-running switches to UPDATE mode (see §0).

Date: !`date +%Y-%m-%d`

Tone: an interview, not a form. Ask in small batches, propose concrete defaults, let the user correct rather than invent. Never invent facts about the user — everything in MASTER-BIO comes from their answers.

---

## 0. Preflight (MANDATORY — before any question)

ONE `kb-ops` spawn, three read ops in a single round-trip. Capture `agentId` — every later kb write in this session goes through `SendMessage` to it, never a new spawn.

```
intent: read, operation: workspace.status
intent: read, operation: area.list
intent: read, operation: board.list
```

Branch on the result:

- **`kb binary not installed` / unreachable** → STOP. Tell the user: "Run `pnpm install:local` in the repo first, then `/onboard` again." No further questions.
- **`workspace.status.root` is null** → STOP with the same instruction (`pnpm install:local` writes the workspace pointer).
- **`MASTER-BIO.md` exists** (Glob) → **UPDATE mode**: read it, show the current areas + goals, and ask what to change. Skip §1-§4 for anything already answered; never overwrite MASTER-BIO wholesale — edit the sections the user names.
- **Otherwise** → fresh onboarding, continue to §1.

Report the resolved storage root to the user in one line so they know where data will land.

---

## 1. Areas (interview)

Explain in two sentences: areas are the top-level split of the user's life/work; every task, board, recurring rule and tracker item belongs to exactly one; ids are permanent (they are baked into task ids like `work_001`), labels are not.

Ask what parts of their life they want to track. **3-6 areas** is the healthy range — fewer than 3 makes the split pointless, more than 6 fragments attention. Typical starting points: work, health, learning, finance, home, side-projects.

For each area the user names, propose:
- `id` — lowercase, dash-separated, short (`work`, `side-projects`). Immutable.
- `label` — how it shows up in the GUI (`Work`, `Side Projects`).
- `emoji` — one glyph.
- `color` — pick from this palette, no repeats: `#8b5cf6` `#3b82f6` `#10b981` `#f59e0b` `#ef4444` `#ec4899` `#14b8a6` `#6366f1`.

Confirm with a single table before writing anything:

```
| id | label | emoji | color | task ids |
|----|-------|-------|-------|----------|
| work | Work | 💼 | #3b82f6 | work_001, work_002, … |
```

The user approves or corrects the whole table in one decision. Nothing is written to kb yet (§5 is the only write).

---

## 2. Annual goals per area

For each confirmed area ask for **1-3 goals for the year** plus a **Quick Status** (3-5 lines: where this area stands today). Keep the user's own words — this is their bio, not your summary.

Goals should be concrete enough to check against later (`/plan` reads them as Locked Context). Push back once on a vague goal ("get healthier" → "what would tell you at year end that this worked?"), then accept whatever they give.

---

## 3. Routines (recurring)

Ask which recurring habits they already know they want: gym 3×/week, weekly review on Friday, monthly planning on the 1st, daily reading.

Map each to a schedule: `daily` | `weekdays` | `weekly --days mon,wed,fri` | `interval --every-n-days N` | `monthly --day-of-month N`.

Do not push for completeness — anything they are unsure about goes to the first `/plan <area>` instead. Zero routines now is a perfectly good answer.

---

## 4. Preferences

Batch these into one AskUserQuestion round:
- Name (how Claude addresses them).
- Work days (default Mon-Fri) — `/today-morning` uses this to pick the previous work day.
- Communication style: direct and terse / more context and explanation.

---

## 5. Write to kb (the ONLY mutate of this session)

ONE `SendMessage` to the kb-ops agent from §0, all ops sequentially:

```
intent: mutate, reason: "/onboard initial setup"
ops:
  - operation: area.add, params: { id, label, emoji, color }    # one per area from §1
  - operation: recurring.add, params: { items: [...] }          # batch, only if §3 produced any
```

**Starter area:** a fresh workspace ships with `personal`. If the user did not keep it, append `operation: area.remove, params: { id: "personal" }` as the LAST op — `kb area remove` returns `needs-approval`, so confirm with the user and resend with `confirm: true`. It only succeeds while `personal` is empty; if the user already created tasks there, keep it and say so.

Report the created ids back (`work_001`-style prefixes come from the area ids).

---

## 6. Scaffold the workspace

Create, in this order (all paths relative to the workspace root):

1. **Area directories** — for each area, `areas/{AreaDir}/` where `{AreaDir}` capitalizes each dash-separated part (`side-projects` → `Side-Projects`). If a directory matching case-insensitively already exists, reuse it instead of creating a second one.

2. **Hub note** — `areas/{AreaDir}/{AreaDir}.md` (a folder note, so `[[Work]]` resolves unambiguously):

```markdown
---
area: {id}
type: area-hub
tags: [area]
---

# {emoji} {label}

## What this area is
{1-3 sentences from the interview}

## Current status
{Quick Status from §2}

## Goals {YYYY}
- {goal 1}
- {goal 2}

## Links
- Planning: `planning/{YYYY-MM}.md` (created by `/plan {id}`)
- Observations: [[observations]]
```

3. **Observations** — `areas/{AreaDir}/observations.md`:

```markdown
---
area: {id}
type: observations
last-cleared: {YYYY-MM-DD}
---

# {label} — Observations

## Active
```

4. **`journal/`** — create the directory (empty; `/today-morning` writes the first daily note).

5. **`MASTER-BIO.md`** (workspace root):

```markdown
---
type: master-bio
last-updated: {YYYY-MM-DD}
---

# {name} — Master Bio

## About
{name}, work days {days}, prefers {style} communication.

## Areas
- [[{AreaDir}]] — {label}: {one-line description}

## Annual Goals {YYYY}

### [[{AreaDir}]]
- {goal}
**Quick Status:** {status}

## Review Log
- {YYYY-MM-DD} — created via `/onboard`
```

6. **`_memory/`** — three files:
   - `user-profile.md` — permanent `[u]` facts from the interview (name, work days, style, anything they stated about themselves).
   - `rules.md` — empty scaffold with an `## Active` header; feedback accumulates here.
   - `linking-rules.md` — the entity registry that makes wikilinks deterministic:

```markdown
---
type: linking-rules
---

# Linking rules

Entities that get `[[wikilinks]]` when mentioned in journal notes or observations.
Anything not listed here stays plain text.

## Areas
- [[Work]] — areas/Work/Work.md
{one line per area}

## People
{seed from the interview: collaborators the user named. Format: `- [[Alice]] — context`}

## Projects
{seed from the interview, or leave the header with a "(none yet)" line}
```

---

## 7. Personalize CLAUDE.md

Edit ONLY the block between the markers — never touch anything outside them:

```
<!-- onboard:begin -->
...replace this region...
<!-- onboard:end -->
```

Write into it: the user's name and communication style, the area table (id → label → directory), work days, and a one-line pointer to `MASTER-BIO.md`. Keep it under ~15 lines — CLAUDE.md is loaded into every session.

---

## 8. Wrap-up

Print a summary:

```
## ✅ /onboard complete
- Areas: {N} ({ids})
- Recurring rules: {N}
- Files: MASTER-BIO.md, areas/{...}/, journal/, _memory/
- Storage: {resolved root}

Next:
1. `/plan <area>` — build this month's plan for your first area
2. Tomorrow morning: `/today-morning`
```

Mention once that the workspace doubles as an Obsidian vault (open the workspace directory as a vault; `templates-obsidian/` holds fill-in templates for days without Claude).

---

## 9. Observer (MANDATORY — last step)

Save up to 3 observations from the interview per `.claude/rules/memory-system.md`: area decisions, stated constraints, anything `[u]`. Route to `areas/{AreaDir}/observations.md` under `## Active`; permanent user facts also to `_memory/user-profile.md`.
