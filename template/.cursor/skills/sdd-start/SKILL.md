---
name: sdd-start
description: Use when user asks to start or continue product work after clade-onboard confirms an onboard repo. Do not use for onboard status/readiness or registry drift.
homepage: "https://github.com/YuDefine/clade"
license: MIT
metadata: {"author":"clade","version":"1.0","clade":{"permission_tier":"action"}}
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/sdd-start/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


<!-- clade-targets: claude,codex,cursor -->

# sdd-start（統一新工作入口）

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

新需求 MUST 建新的 `NNN-<slug>` package；shared truth 檔存在、同名 slug 或舊 package 存在，都不是續跑證據。

</decision_boundary>

<workflow>

## 1. 先通過規則 artifact gate

先檢查本次需求是否要新增或調整 `.agents/constitution/**`。需要時下一支 skill 固定是 `constitution`；完成前不得進 `specify`、續跑判定或任何下游步驟。這個 gate 優先於 package 是否存在。

## 2. 收斂當前 package

讀取使用者需求與目前 package 的 `spec.md`、`plan.md`、`research.md`、`truth-delta.md`、`ui/**`、`tasks.md`（存在時），以及 `specs/truth/**` 的必要 owner 產物。若尚無本次 package，交 `specify`；若 package 有待澄清問題，交 `clarify-over-specs`。

續跑時只接受本次指定、仍未完成且前提已滿足的 package。不要用 shared truth 或檔案存在代替本次 delta、PM 確認或 task 解鎖判定。

## 3. 依 package 狀態交棒

依序判定：

1. spec 尚無、或需求是新行為：`specify`；新需求 MUST 建新的 `NNN-<slug>` package。
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

UI checkpoint 是路由與驗收前提。先完成 PRODUCT／design context、雛形與 review，再把結果交 PM；本 skill 不代替下游執行。

本入口的共同 SKILL.md 可由既有投影流程嘗試交付到 `.cursor/skills/`、`.agents/skills/`、`.cursor/skills/`；這不是三端已驗證的 receipt，也不是 `clade-adapters` 宣告。若所選 runtime 沒有該目錄或入口，輸出 `缺少的前提` 具體列出 runtime 與缺失路徑，停止並回報。

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
