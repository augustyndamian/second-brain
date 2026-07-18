# Memory System (rules)

> 🧭 **SSoT: memory architecture (Observer/Reflector mechanics, format, source tags).** Updated manually. Do not copy — link here. Map: [`../../docs/claude-integration.md`](../../docs/claude-integration.md).

## Memory Architecture

Three layers: `_memory/` (permanent, created by `/onboard`) → `areas/{AreaDir}/observations.md` (active) → `areas/{AreaDir}/observations-archive.md` (compressed).

### Observer — when to save

- `/today-morning`, `/today-eod` and `/weekly-review`: MANDATORY
- Regular sessions: after 5-6 exchanges OR immediately on user decision/plan change
- Format: `- YYYY-MM-DD | EMOJI | [source] one-liner`
- Source: `[u]` user stated (highest, never expires) | `[c]` Claude inferred (low) | `[t]` tool result (medium)
- Emoji: `!` blocker | `?` decision | `+` win | `~` pattern | `i` insight
- Max 3 per session. Append under `## Active` in `areas/{AreaDir}/observations.md`
- Permanent `[u]` facts → also `_memory/user-profile.md`, feedback → `_memory/rules.md`. Workspace without `_memory/` → skip this step.

### Reflector — compression

- `/weekly-review`: compress Active → Archive. Priority: `[u]` never delete > `[t]` condense > `[c]` drop first
- Monthly deep compression (manual, e.g. with `/plan` retrospective): condense archive further
- Archive format: `- WXX | EMOJI | [source] G{N} | entry` (G0=raw, G1=weekly, G2=monthly)
- `[u]` never expires. `[c]`/`[t]` after G2 → deletion candidates.
