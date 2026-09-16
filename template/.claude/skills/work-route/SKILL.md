---
name: work-route
description: Use when user asks to start or continue product work; first let clade-onboard confirm the repo is onboarded, then route here. Do not use for onboard status/readiness or registry drift.
license: MIT
metadata: {"author":"clade","version":"1.0","clade":{"permission_tier":"action"}}
---


# work-route（工作路由入口）

<role>

本 skill 只負責把已 onboard repo 的新需求或續跑需求分類、定位既有 package、檢查前提並交棒。完整的 package 內容由下游 skill 產出；本 skill 不寫 spec、truth、tasks、產品碼，也不提前執行 UI 或實作。

</role>

<decision_boundary>

| 輸入狀態 | 路由 |
| --- | --- |
| 純 onboard 狀態、readiness 或 registry drift 查詢 | 回 `clade-onboard`，不進本 skill |
| 純措辭／設定，且不改行為、權限、資料契約或部署語意 | 依 repo 流程直接實作與驗證；不建 package |
| 既有 scenario 可重現失敗，需求只是恢復既有 truth | 既有修 bug 流程；只有有對應未完成且已解鎖 task 才交 `implement` |
| bug 缺 scenario、truth／DSL 缺口，或要求改變既有行為 | `specify` 建新 package；truth 缺口回 truth owner |
| hotfix／一次性工作 | 依 hotfix 授權與規約執行；必要 regression 當次完成 |
| 缺少會改變方案的驗收條件或決策 | `clarify`，保留未回答前提 |
| 新需求或既有行為新增／修改／刪除 | 進新 package／續跑判定 |

**clade lifecycle repo 判準**：本次 plan package 的 `plan.md` frontmatter 同時含 `work_id:` 與 `truth_baseline:` 兩個鍵。判準只看這兩個鍵，**NEVER** 用 repo 名、`.clade/manifest.json`、`specs/truth/work-lifecycle.md` 是否存在或任何其他檔案推斷。

命中判準時：package 固定是 `specs/plans/<work-id>/`，work id 由 `flow plan open` 鑄；同一件工作續跑同一個 work id，**NEVER** 再開第二份。未命中判準、仍走 aixbdd 九步的產品 SDD consumer，在遷移完成前才建新的 `NNN-<slug>` package。

</decision_boundary>

<workflow>

## 1. 先通過規則 artifact gate

先檢查本次需求是否要新增或調整 `.agents/constitution/**`。需要時 MUST 讀取本 skill 目錄下 `rules/constitution/SKILL.md`，並依它引用的 `rules/constitution/rules/*.md` 執行 constitution gate；這是 `work-route` 的 internal contract，不是獨立 public skill。任一資源缺席時，輸出 `缺少的前提`，具名列出當前 runtime 與缺失路徑後停止。完成前不得進 `specify`、續跑判定或任何下游步驟。這個 gate 優先於 package 是否存在。

## 2. 收斂當前 package

讀取使用者需求與目前 package 的 `spec.md`、`plan.md`、`research.md`、`truth-delta.md`、`ui/**`、`tasks.md`（存在時），以及 `specs/truth/**` 的必要 owner 產物。命中 lifecycle repo 判準時，該 package 沒有 `truth-delta.md`：本輪 delta 讀 `plan.md` 的 `## Truth delta` 表，系統分析讀 `system-analysis.md`。若尚無本次 package，交 `specify`；若 package 有待澄清問題，交 `clarify-over-specs`。

續跑時只接受本次指定、仍未完成且前提已滿足的 package。不要用 shared truth 或檔案存在代替本次 delta、PM 確認或 task 解鎖判定。

## 3. 依 package 狀態交棒

依序判定：

1. spec 尚無、或需求是新行為：命中 lifecycle repo 判準時，先 `node vendor/scripts/flow/flow.ts plan open <slug> --title '<title>'` 鑄 work id 與 package 骨架，再交 `specify` 填 `spec.md` 與 `checklists/requirements.md`；`specify` **NEVER** 覆寫 lifecycle 檔 `plan.md`，也 **NEVER** 建 `truth-delta.md`。未命中判準的產品 SDD consumer 直接交 `specify` 建 `NNN-<slug>` package。同一 work 已有 plan 則續跑，不另開。
2. spec 有待澄清：`clarify-over-specs`。
3. acceptance 尚未完成：`spec-by-example`；需求改 UI 時再交 `ui-plan`。API-only 不建立 UI 工作。
4. acceptance 已完成但 UI 需求缺 `ui-plan`／靜態雛形／review：`ui-plan`，補齊後再回 PM confirmation gate；API-only 不建立 UI 工作。
5. research／BDD techstack 決策未完成：`technical-research`。
6. Gherkin 與適用的 UI 產物已完成但尚未由 PM 確認：停在 **PM confirmation gate**，不得進 `system-analysis`；API-only 只需 Gherkin／PM 確認。
7. plan 尚未完成：`system-analysis`。
8. 本次 truth delta 尚未由 owner 對齊：`dsl-refine` 或適用 truth owner。
9. tasks 尚未產出或不一致：`tasks`。
10. tasks 與本次 delta 一致且有已解鎖未完成 task：`implement`。
11. 全部 tasks 完成且沒有新需求：交付／收尾；有新需求則另開 package。

命中 lifecycle repo 判準時，本次省略的 artifact（`ui-plan.md`、`research.md`、openapi 等）MUST 在 `plan.md` 的 `## Decisions` 留一行工作特定理由；缺理由就當作前提未滿足，列進 `缺少的前提`。

UI checkpoint 是路由與驗收前提。先完成 PRODUCT／design context、雛形與 review，再把結果交 PM；本 skill 不代替下游執行。

本入口的共同 SKILL.md 可由既有投影流程嘗試交付到 `.claude/skills/`、`.agents/skills/`、`.cursor/skills/`；這不是三端已驗證的 receipt，也不是 `clade-adapters` 宣告。若所選 runtime 沒有該目錄或入口，輸出 `缺少的前提` 具體列出 runtime 與缺失路徑，停止並回報。

</workflow>

<output_contract>

固定依序輸出以下五段，每段一行或短表格：

1. `需求類型:` 新需求／續跑／regression／hotfix／research／狀態查詢。
2. `package 或免 package:` package 路徑，或免 package 的具體理由。
3. `下一支 skill:` 一支可直接交棒的 skill；若有前提未滿足，填最先解除前提的 owner。
4. `缺少的前提:` 列出未滿足項；沒有時寫 `無`。
5. `UI checkpoint:` `需要`／`不需要`／`沿用既有證據`，附一句依據。

完成條件是路由唯一、前提具名、下游入口可載入；不得把下游執行結果冒充本 skill 已完成。

</output_contract>

<default_follow_through_policy>

可直接讀取與分類；可逆的狀態檢查可直接執行。建立 package、修改 truth、執行下游 skill 或改產品碼交給指定入口。缺 capability、入口尚未同步、PM 尚未確認或驗收條件不足時停止並回報，不自行腦補。

</default_follow_through_policy>
