---
name: observer-save
description: Save observation to area observations.md. Trigger after 5-6 exchanges or immediately on decision/plan change. Mandatory in /today-morning, /today-eod and /weekly-review.
---

# Observer

**Format:** `- YYYY-MM-DD | EMOJI | [source] one-liner`
**Source:** `[u]` user stated (highest, never expires) | `[c]` Claude inferred (low) | `[t]` tool result (medium)
**Emoji:** `!` blocker | `?` decision | `+` win | `~` pattern | `i` insight
**Max:** 3 per session. Append under `## Active` in `areas/{AreaDir}/observations.md`.
**Routing:** `{area}` (from `kb area list`) → the area directory in the workspace, e.g. `work` → `areas/Work/observations.md`. Mapping convention: `docs/claude-integration.md` → Workspace layout. Cross-area → best fit. File missing → create it with an `## Active` header.
**Escalation (default):** permanent `[u]` facts → also `_memory/user-profile.md`, feedback → `_memory/rules.md`. Workspace without `_memory/` → skip this step.
**Linking (default):** the workspace is an Obsidian vault with `_memory/linking-rules.md` → use `[[wikilinks]]` for every entity mentioned. No linking-rules file → plain text.
**Tracker handoff:** Observation contains other person's commitment + date (e.g. "Alice promised the assets by 10.05") or external deadline (accountant, institution, supplier) → also call `kb-ops` `tracking.add { area, who, what, due: "YYYY-MM-DD", status: "todo" }`. Tracker is SSoT for commitments others owe.
