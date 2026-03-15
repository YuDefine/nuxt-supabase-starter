## Context

The starter template's documentation has drifted from actual project state after the migration from `opsx/` to `spectra/` naming and multiple skill installations/removals. Three documentation files and the validation script contain stale references. Additionally, 11 skills exist as duplicates in both `.agents/skills/` (third-party, managed by `pnpm skills:update`) and `.claude/skills/` (project-specific, manually maintained).

## Goals / Non-Goals

**Goals:**

- All documentation accurately reflects the current project structure
- `validate-starter.md` uses correct directory names and command lists
- Skill counts in `QUICK_START.md` match reality
- No duplicate skills across `.agents/skills/` and `.claude/skills/`
- `CLAUDE_CODE_GUIDE.md` skills table lists only actually installed skills

**Non-Goals:**

- Installing missing third-party skills (the 11 skills listed in docs but not installed — that is a separate concern)
- Changing skill functionality or content
- Modifying CLAUDE.md (it does not contain the affected sections)

## Decisions

### Remove duplicates from `.claude/skills/` rather than `.agents/skills/`

`.agents/skills/` is the canonical location for third-party skills managed by `pnpm skills:update`. `.claude/skills/` is for project-specific skills only. The 11 duplicates in `.claude/skills/` are copies of third-party skills and SHALL be removed. The originals in `.agents/skills/` remain untouched.

### Update documentation to reflect actual state rather than aspirational state

The CLAUDE_CODE_GUIDE.md lists 26 general skills but only 15 are installed. Rather than installing the missing 11, update the documentation to match reality. Missing skills can be added later as a separate change.

### Use dynamic counting in validate-starter.md

Rather than hardcoding expected command names, the validation script SHALL dynamically discover commands under `spectra/` to avoid future drift.

## Risks / Trade-offs

- [Risk] Removing duplicate skills might break skill resolution if Claude Code prioritizes `.claude/skills/` over `.agents/skills/` → Mitigation: Both locations are valid; Claude Code loads skills from both directories, so removing duplicates from one location does not affect availability.
- [Risk] Documentation counts become stale again after future skill changes → Mitigation: The `validate-starter.md` script now validates dynamically, catching future drift.
