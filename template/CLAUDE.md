@RTK.md

## Language

- 一律使用繁體中文，不要使用簡體中文。

## Source Of Truth

- `.claude/` 是本專案唯一真理。
- 規則 source 在 `.claude/rules/`。
- workflow / skills source 在 `.claude/skills/` 與 `.claude/commands/`。
- hooks / agents / settings source 在 `.claude/` 內對應路徑。
- `AGENTS.md`、`.agents/`、`.codex/` 都是投影；若需調整內容，先改 `.claude/`，再用 `sync-to-agents` 同步。

<!-- SPECTRA:START v1.0.2 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`
- Commit only files related to a specific change → `/spectra-commit`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `/spectra-apply` and `/spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

## Project Focus

- 這是可直接執行的 Nuxt + Supabase starter template；入口文件見 `../docs/QUICK_START.md`、`../docs/INTEGRATION_GUIDE.md` 與 `docs/WORKFLOW.md`。

## Rule Entry Points

- API / DB / 開發約定：`.claude/rules/api-patterns.md`、`.claude/rules/database-access.md`、`.claude/rules/development.md`
- UX / Spectra workflow：`.claude/rules/ux-completeness.md`、`.claude/rules/proactive-skills.md`
- 其餘 shared rules：`.claude/rules/`
- workflow / skills：`.claude/skills/`、`.claude/commands/`

## Codex Projection

- 定期執行 `node ~/.claude/scripts/sync-to-agents.mjs`，讓 Codex surface 與 `.claude/` 保持一致。
- 專案特化 promotion 規則放在 `.claude/sync-to-agents.config.json`。
- 若 source 與投影不一致，以 `.claude/` 為準，之後再同步生成。
