<!-- AUTO-GENERATED from .claude/ — 請勿手動編輯 -->

## Language

- 一律使用繁體中文，不要使用簡體中文。

## Source Of Truth

兩層來源 — 上游進來、下游投影出去，**永遠單向**：

```
clade（~/offline/clade）         ← 跨專案共用中央倉
  └→ .claude/                     ← 本專案 source（AI Agent First）
       └→ .codex/ / .agents/ / AGENTS.md    ← sync-to-agents 投影
```

- 上游：`rules/`、`skills/`、部分 `hooks/`、`scripts/` 由 clade 治理（見 `.claude/.hub-state.json` 的 checksum 清單）。要改這些**先改 clade 中央倉**，跑 `pnpm hub:sync` 投到本專案；直接在 `.claude/rules/` 等改 → SessionStart `_bootstrap-check.sh` 會自動還原 + commit hook 會擋。
- 本層：`.claude/` 是本專案唯一 source（settings.json、hub.json、本地 commands/agents、business-specific hooks）。
- 下游：`.codex/`、`.agents/`、`AGENTS.md` 全是 sync-to-agents 從 `.claude/` 投影出來。**禁止**直接編輯，要改先回 `.claude/` 改、再跑 `node ~/.claude/scripts/sync-to-agents.mjs` 重投影。

常用命令：

| 動作                                | 命令                                        |
| ----------------------------------- | ------------------------------------------- |
| 從 clade 拉新版到本專案             | `pnpm hub:sync`                             |
| 檢查本專案 vs clade drift           | `pnpm hub:check`                            |
| 從 `.claude/` 重投影到 codex/agents | `node ~/.claude/scripts/sync-to-agents.mjs` |
| 完整 bootstrap（首次）              | `pnpm hub:bootstrap`                        |

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
<!-- SPECTRA-UX:START v1.13.4 -->

繁體中文 | [English](./agents-md.en.md)

## UX Completeness Rules

**Before running any `spectra-*` command**, every agent (AI Agent, Codex,
Copilot, Cursor) must follow the UX Completeness gates. These prevent the
recurring pattern "DB + API done, UI missing/skipped".

完整規則：[`docs/rules/ux-completeness.md`](docs/rules/ux-completeness.md)

### Required workflow integration

| Spectra phase                       | Gate script                                                                 | When to run                                                                |
| ----------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Before `spectra-propose`            | `bash scripts/spectra-ux/pre-propose-scan.sh`                               | 注入 blast radius 要求，提醒必填區塊                                       |
| After `spectra-propose`             | `bash scripts/spectra-ux/post-propose-check.sh <change>`                    | 驗證 proposal 完整性                                                       |
| After `spectra-propose`             | `bash scripts/spectra-ux/design-inject.sh <change>`                         | 若有 UI scope，提醒補上 `## Design Review` 區塊                            |
| Before `spectra-apply`              | `bash scripts/spectra-ux/pre-apply-brief.sh <change>`                       | 簡報 user journeys                                                         |
| During UI edits                     | `bash scripts/spectra-ux/ui-qa-reminder.sh <file>`                          | 中途提醒 design / screenshot review，不要等到 archive 才檢查               |
| Before `spectra-archive`            | `bash scripts/spectra-ux/design-gate.sh <change>`                           | 阻擋未完成人工檢查或缺設計審查證據的 UI change                             |
| Before `spectra-archive`            | `bash scripts/spectra-ux/archive-gate.sh <change>`                          | 驗證 journey URL touch、schema drift、exhaustiveness                       |
| Before `spectra-archive` (v1.5+)    | `bash scripts/spectra-ux/followup-gate.sh <change>`                         | 驗證 tasks.md 的 `@followup[TD-NNN]` 都在 `docs/tech-debt.md` 有完整 entry |
| **Session start / after `/assign`** | `pnpm spectra:roadmap` && `pnpm spectra:claims` && `pnpm spectra:followups` | 重算 ROADMAP、查看 active claims、摘要 follow-up 狀態                      |

**AI Agent 使用者**：上述由 `.codex/hooks/` 自動觸發，無需手動（roadmap sync 含 SessionStart hook）。

**Codex / Copilot / Cursor 使用者**：必須在對應 spectra 階段手動呼叫這些腳本，
或把它們加入自訂工作流。每個腳本都是 agent-agnostic，可在任何環境執行。
**此外，session 開始時必須手動跑一次 `pnpm spectra:roadmap` 與 `pnpm spectra:claims`。**

### Required proposal sections

`proposal.md` 必填區塊（spectra-ux 會檢查）：

- `## Affected Entity Matrix` — 若觸動 DB schema / shared types
- `## User Journeys` — 強制；純後端 change 寫 `**No user-facing journey (backend-only)**` + 理由
- `## Implementation Risk Plan` — 強制；固定回答五行：
  `Truth layer / invariants`、`Review tier`、`Contract / failure paths`、
  `Test plan`、`Artifact sync`
  目的：把最常拖到 `/commit` 才被追問的風險前提，前移到 propose

### Follow-up markers (v1.5+)

tasks.md 內未解決或延後項目 **必須** 用 `@followup[TD-NNN]` 標註，每個 ID 在 `docs/tech-debt.md` 有完整 entry（Status / Priority / Problem / Fix approach / Acceptance）。

**禁止** 自由文字註記（「DEFERRED」「LOCAL BLOCKED」）不帶 marker。Archive gate 會阻擋未登記的 marker。

完整規則：`follow-up-register.md`。

### Supporting workflow rules (v1.10+)

spectra-ux 另外提供一組配套規則，預設安裝在與 `docs/rules/ux-completeness.md` 同目錄：

- `handoff.md` — session / agent 交接
- `work-claims.md` — 即時 ownership / heartbeat
- `scope-discipline.md` — 不擴散、必登記、不擅改他人成果
- `manual-review.md` — `## 人工檢查` 不得代勾
- `knowledge-and-decisions.md` — solutions / ADR 沉澱
- `review-tiers.md` — 依風險選 review 強度
- `screenshot-strategy.md` — 截圖工具決策
- `truth-layers.md` — optional，適合有明確 schema / contract / API / UI 分層的專案

### Optional proposal markers

這些 marker 被 `spectra:roadmap` 解析用於平行推進分析：

- `<!-- depends: other-change-name -->` — 宣告本 change 依賴另一個 change 先完成。多個依賴可逗號分隔或用多個 marker
- `<!-- blocked: reason -->` — 強制標記為 blocked 狀態，AUTO 區塊會顯示理由

### Structural enforcement

所有 agent 都受益的硬性規則：

- **Enum exhaustiveness**：使用 `switch + assertNever`，禁止 `if/else if/else` 鏈
- **離線稽核**：`pnpm audit:ux-drift` 檢查 enum 漂移
- **Roadmap 儀表板**：`pnpm spectra:roadmap` 維護 `openspec/ROADMAP.md`
- **Work claims**：`pnpm spectra:claim -- <change>` / `pnpm spectra:release -- <change>` 維護即時 ownership
- **Follow-up register**：`pnpm spectra:followups` 維護 `docs/tech-debt.md`（v1.5+）
- **Design Gate**：UI change 在 archive 前必須有設計審查證據與完成的人工檢查
- **Git pre-commit**：自動跑 audit:ux-drift（所有 agent 的 commit 都會被檢查）
- **CI**：PR 執行完整檢查

### 心智模型清單

| 錯誤直覺                            | 正確認識                   |
| ----------------------------------- | -------------------------- |
| DB migration 過了就是 feature ready | DB allow ≠ feature ready   |
| API test 綠就是 UX 完成             | Tests pass ≠ UX done       |
| 既有頁面有了就不用改                | Branching logic 要更多改動 |
| 記得住改了什麼                      | 列舉比記憶可靠             |
| Kiosk/主流程做完就收工              | Admin 管理路徑同等重要     |
| 感覺完成就是完成                    | 差的那一哩通常是 UI        |

### 必禁事項

- **NEVER** 寫空洞的 User Journeys 為通過 gate
- **NEVER** 用 Non-Goals 隱藏忘記做的 surface（必須有具體理由）
- **NEVER** 把 `if/else if/else` 用在 enum 分支
- **NEVER** 新增 route 但不在 navigation 加入口（除非明確宣告 internal-only）
- **NEVER** 把「tasks 全勾 + tests 綠」當作 feature complete 的充分條件
- **NEVER** 手編 `openspec/ROADMAP.md` 的 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊 — 會被下次 sync 覆寫
- **NEVER** 未 claim 就開始做 active spectra change

<!-- SPECTRA-UX:END -->

## Project Focus

- 這是可直接執行的 Nuxt + Supabase starter template；入口文件見 `../docs/QUICK_START.md`、`../docs/INTEGRATION_GUIDE.md` 與 `docs/WORKFLOW.md`。

## Rule Entry Points

- API / DB / 開發約定：`.claude/rules/api-patterns.md`、`.claude/rules/database-access.md`、`.claude/rules/development.md`
- UX / Spectra workflow：`.claude/rules/ux-completeness.md`、`.claude/rules/proactive-skills.md`
- 其餘 shared rules：`.claude/rules/`
- workflow / skills：`.agents/skills/`、`.agents/commands/`

## Codex Projection

- 定期執行 `node ~/.claude/scripts/sync-to-agents.mjs`，讓 Codex surface 與 `.claude/` 保持一致。
- 專案特化 promotion 規則放在 `.claude/sync-to-agents.config.json`。
- 若 source 與投影不一致，以 `.claude/` 為準，之後再同步生成。

<!-- CLADE:SNIPPET:post-push-ci-watch:START -->

## Post-Push CI Watcher

當主線執行 `git push --tags`（或推單一 tag、或 push commit 觸發發版 workflow）**成功**後，**若**該 repo 含 `.github/workflows/*.yml` 且 `gh` CLI 可用：

**MUST** 立刻用 `Agent(run_in_background=true)` 開 watcher subagent 監看 GitHub Actions 結果，**NEVER** 自己同步 block 等待 — 主線繼續對話，watcher 完成時系統會自動通知主線。

### Watcher subagent prompt 模板

Subagent 任務應包含（cwd 設為 push 發生的 repo path）：

1. `gh run list --limit 1 --json databaseId,name,status,conclusion,url,headBranch,event,createdAt`
   - 若 list 空 / `gh` 未登入 / 無權限 → 回報 `status: unavailable` + 原因，結束
   - 若最新 run 的 `createdAt` 早於 push 時間（不是這次 push 觸發的） → 同上回報 unavailable
2. `timeout 900 gh run watch <databaseId> --exit-status`
   - exit 0 → `status: success`
   - exit 124 → `status: timeout`（15 min 上限）
   - 其他非 0 → `status: fail`；補跑 `gh run view <databaseId> --log-failed` 截前 200 行作 `logExcerpt`
3. 結構化回報（≤200 字）：
   - `status`、`runUrl`、`version`（由 `git describe --tags --abbrev=0` 抓；無 tag 則填 commit short sha）
   - 若 fail：`failedJob`、`logExcerpt`（節錄前 30 行）

### Watcher 完成後主線必做

- **success** → 一行報 `v<version> CI 綠燈 — <runUrl>` 後結束本話題，**NEVER** 多嘴
- **fail / timeout** → **MUST** 用 `request_user_input` 給使用者二選一：
  - `[1] 立刻 root-cause + 修` — 讀 `logExcerpt` 找根因，進除錯流程；修完前 **NEVER** 主動 push
  - `[2] 登記 HANDOFF.md` — 在 repo root 的 `HANDOFF.md` 末尾 append：

    ```
    - [ ] [<YYYY-MM-DD>] v<version> CI <fail|timeout> — <failedJob>
      - Run: <runUrl>
      - 根因猜測: <一行>
    ```

    若 `HANDOFF.md` 不存在 → 先建立骨架：

    ```
    # HANDOFF

    ## CI 紅燈待辦
    ```

- **unavailable** → 一行報「watcher 無法啟動（<原因>），略過」結束，**NEVER** 追問使用者

### 禁忌

- **NEVER** 在 watcher 回報前主動結束話題或叫 user 自己看
- **NEVER** 在 user 未選 `[1]` 前替他改 code / push commit 修 CI
- **NEVER** 對沒有 `.github/workflows/` 的 repo 套用這條規則（直接跳過 watcher）
- **NEVER** 重開新 watcher 取代尚在跑的 watcher（避免重複監看同一個 run）
<!-- CLADE:SNIPPET:post-push-ci-watch:END -->

# RTK Instructions

Use RTK (Rust Token Killer) to reduce token-heavy shell output when running commands through an AI coding assistant.

## Command Routing

- Prefer `rtk git status`, `rtk git diff`, `rtk git log`, `rtk gh ...` for Git and GitHub CLI output.
- Prefer `rtk pnpm ...`, `rtk npm ...`, `rtk vitest`, `rtk playwright test`, `rtk lint`, and `rtk tsc` for package manager, test, lint, and typecheck output.
- Prefer `rtk grep`, `rtk find`, `rtk read`, and `rtk ls` when the expected output is large.
- Use raw shell commands for small, structural, or shell-native operations such as `pwd`, `cd`, `mkdir`, `test`, `[ ... ]`, `[[ ... ]]`, `true`, `false`, `export`, `printf`, and `echo`.
- Do not rewrite shell builtins as RTK subcommands. For example, use `test -d path`, not `rtk test -d path`.
- For shell syntax, compound commands, heredocs, or commands RTK does not understand, use the raw command or `rtk proxy <command>` only when compact tracking is still useful.

## Sandbox Database

RTK tracking must use a Codex-writable database path:

```toml
[tracking]
database_path = "/Users/charles/.codex/memories/rtk/history.db"
```
