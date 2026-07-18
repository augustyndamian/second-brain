---
name: kb-task-payload
description: SSoT for the task payload schema — base fields + quality rules (always a DoD, full-sentence description, ask for a due date) + per-command extensions (/today-morning, /plan). Load it when a command assembles a task for writing.
---

# kb-task-payload (task schema SSoT)

> 🧭 **SSoT: task payload fields and quality rules.** Commands link here, they do not copy. Schema change = edit THIS file only. Map: `docs/claude-integration.md`.

## Base fields (every task, every command)

| Field | Rule |
|---|---|
| **title** | Imperative, concrete, ≤80 chars ("Send", "Prepare", "Call"). NOT "Work on X". |
| **description** | 1-3 full sentences of context + **always a DoD** (measurable). No keyword shorthand. If you do not know what it means — ask the user, do not guess. |
| **area** | a value from `kb area list` |
| **due** | `YYYY-MM-DD` (ISO). **No due date → ASK**, do not assume a default. |
| **priority** | int 1-10 (1=nice-to-have, 10=blocker, default 5-6; 9-10 = at most 10-20% of tasks). |

One-off vs recurring (hard rule, enforced by kb-ops): one-off = `due`+`priority`, recurring = `schedule` (+ optional starts/ends-on), NEVER mixed. In doubt → ask.

## Per-command extensions

**`/today-morning` §3b (candidates):** base + `source:` (tracker|ROADMAP|yesterday|observation|board) + `why today:` (one sentence). Presentation: a `[N] {title}` block with indented fields; the user approves in a single decision; written as a batch through kb-ops (§6 of the command).

**`/plan` §4 (monthly batch):** base + `parent_goal_ref` (Goal 1-3). Due date always within the current month (spillover = justify it). Recurring habit: `schedule` per §4B of the command. Batch in ONE kb-ops call.
