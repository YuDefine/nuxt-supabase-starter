<!-- SPECTRA:START v2.2.3 -->

# Spectra Instructions

This project uses Spectra 2.2.3 for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`. Config: `.spectra.yaml`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `spectra-apply` and `spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->
<!-- SPECTRA-UX:START v1.3.1 -->

## UX Completeness Rules

**Before running any `spectra-*` command**, every agent (Claude Code, Codex, Copilot, Cursor) must follow the UX Completeness gates. These prevent the recurring pattern "DB + API done, UI missing/skipped".

**完整規則**：[`.claude/rules/ux-completeness.md`](.claude/rules/ux-completeness.md) — Definition of Done、必填 Propose 區塊、Exhaustiveness、Navigation Reachability、State Coverage、心智模型、必禁事項皆定義於此。

**Review 強度分級**：[`.claude/rules/review-tiers.md`](.claude/rules/review-tiers.md) — 決定何時必須跑 `spectra-audit` + `code-review` agent。

### Proposal optional markers

這些 marker 被 `spectra:roadmap` 解析用於平行推進分析：

- `<!-- depends: other-change-name -->` — 宣告本 change 依賴另一個 change 先完成
- `<!-- blocked: reason -->` — 強制標記為 blocked 狀態，AUTO 區塊會顯示理由

**NEVER** 手編 `openspec/ROADMAP.md` 的 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊 — 會被下次 sync 覆寫。

<!-- SPECTRA-UX:END -->
