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
<!-- SPECTRA-UX:START v1.0.0 -->

## UX Completeness Rules

**Before running any `spectra-*` command**, every agent (Claude Code, Codex,
Copilot, Cursor) must follow the UX Completeness gates. These prevent the
recurring pattern "DB + API done, UI missing/skipped".

完整規則：[`docs/rules/ux-completeness.md`](docs/rules/ux-completeness.md)

### Required workflow integration

| Spectra phase | Gate script | When to run |
| --- | --- | --- |
| Before `spectra-propose` | `bash scripts/spectra-ux/pre-propose-scan.sh` | 注入 blast radius 要求，提醒必填區塊 |
| After `spectra-propose` | `bash scripts/spectra-ux/post-propose-check.sh <change>` | 驗證 proposal 完整性 |
| Before `spectra-apply` | `bash scripts/spectra-ux/pre-apply-brief.sh <change>` | 簡報 user journeys |
| Before `spectra-archive` | `bash scripts/spectra-ux/archive-gate.sh <change>` | 驗證 journey URL touch、schema drift、exhaustiveness |

**Claude Code 使用者**：上述由 `.claude/hooks/` 自動觸發，無需手動。

**Codex / Copilot / Cursor 使用者**：必須在對應 spectra 階段手動呼叫這些腳本，
或把它們加入自訂工作流。每個腳本都是 agent-agnostic，可在任何環境執行。

### Required proposal sections

`proposal.md` 必填區塊（spectra-ux 會檢查）：

- `## Affected Entity Matrix` — 若觸動 DB schema / shared types
- `## User Journeys` — 強制；純後端 change 寫 `**No user-facing journey (backend-only)**` + 理由

### Structural enforcement

所有 agent 都受益的硬性規則：

- **Enum exhaustiveness**：使用 `switch + assertNever`，禁止 `if/else if/else` 鏈
- **離線稽核**：`pnpm audit:ux-drift` 檢查 enum 漂移
- **Git pre-commit**：自動跑 audit:ux-drift（所有 agent 的 commit 都會被檢查）
- **CI**：PR 執行完整檢查

### 心智模型清單

| 錯誤直覺 | 正確認識 |
| --- | --- |
| DB migration 過了就是 feature ready | DB allow ≠ feature ready |
| API test 綠就是 UX 完成 | Tests pass ≠ UX done |
| 既有頁面有了就不用改 | Branching logic 要更多改動 |
| 記得住改了什麼 | 列舉比記憶可靠 |
| Kiosk/主流程做完就收工 | Admin 管理路徑同等重要 |
| 感覺完成就是完成 | 差的那一哩通常是 UI |

### 必禁事項

- **NEVER** 寫空洞的 User Journeys 為通過 gate
- **NEVER** 用 Non-Goals 隱藏忘記做的 surface（必須有具體理由）
- **NEVER** 把 `if/else if/else` 用在 enum 分支
- **NEVER** 新增 route 但不在 navigation 加入口（除非明確宣告 internal-only）
- **NEVER** 把「tasks 全勾 + tests 綠」當作 feature complete 的充分條件

<!-- SPECTRA-UX:END -->
