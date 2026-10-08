# 前提修復與品質 gate 失敗

觸發點：SKILL.md 第 3 步（owner 的輸入前提缺失，或品質 gate 失敗時）。文中「第 N 節」指 SKILL.md 的第 N 步與它讀取的判準檔：第 0 節 `rules/worktree隔離與work-id.md`、第 1 節 `rules/定位既有工作與鑄id.md`、第 2 節 `rules/owner載入與代打.md`、第 3 節 `rules/前提修復與gate失敗.md`、第 4 節 `rules/依產物推進.md`、第 5 節 `rules/驗收交付與回報.md`；「上表」「判定表」未另指明時指 `rules/需求分流與免package.md` Rule 2。

# Rule 1 - 前提修復後實際執行 owner 並接續；只問真正要人決定的事

- Level: `MUST`

1. 從所選 owner 的實際契約解析輸入（project artifact 按專案根、internal resources 按 owner 目錄），逐檔檢查。尚待該 owner 產出的檔案不是輸入前提。
2. 缺投影或安裝：用 repo 的固定版本來源與既有投影／安裝 owner 補齊後重驗；不手改 generated projection、不從網路追最新版、不把 pinned internal flow 裝成公開 skill。
3. 缺 project artifact：載入該 artifact owner 並執行其流程；constitution 走第 1 節，techstack 走 technical-research。truth root 分兩種：缺 `specs/truth/work-lifecycle.md` 是 **lifecycle 遷移**，不是補檔——`specs/truth/work-lifecycle.md` 是 lifecycle-repo marker（一存在，gate 擋新 TD、`docs/tech-debt.md` 凍結、舊 TD 只經 `specs/truth/legacy-ids.json` 解析），scaffold **NEVER** 代放；照 `~/offline/clade/vendor/snippets/consumer-lifecycle/README.md` 先把舊 TD 逐筆處置進 `legacy-ids.json`（或搬進 plan § Open work），處置量大或要 user 拍板時先停下回報，NEVER 為了開 W- plan 跳過。已是 lifecycle repo 只缺 `owners.md` 時，owner 是 `node ~/offline/clade/scripts/scaffold-consumer-truth.ts --consumer-path <consumer 根> --apply`：範本源固定、只建缺檔、NEVER 覆寫，建好的檔隨本次工作 commit。它印出的其餘缺口（`techstack.md`、`isa.yml`、acceptance feature）照本步交各自 owner。既有 artifact 已回答的事項不重問，不代替 owner 捏造答案。
4. 前提通過後，實際執行候選 owner，查驗產出，重新判定下一步並繼續；「知道下一支是誰」不是本輪完成條件。
5. 同一修復方式沒有新證據時不重複重試；修復 owner 循環、來源不可取得、必要工具無法使用、權限不足或需要外部狀態改變時，保留已做工作與原始錯誤，回報具體缺口及解除條件。仍可獨立完成的工作繼續。

若必須問使用者，只問需求取捨、必要環境資訊、權限邊界或具體驗收確認；不問「要不要載入下一支 skill／修入口／繼續查」。不得宣稱未通過的 gate 已完成。

## Good Example

- 這個例子是好的，因為缺 project artifact 時載入該 artifact 的 owner 補齊後續跑。

```text
缺 techstack → technical-research 產出 → 前提通過 → 執行候選 owner → 查驗產出 → 重新判定下一步
```

## Bad Example

- 這個例子是壞的，因為由 scaffold 代放 lifecycle marker，或問使用者「要不要載入下一支 skill」。

```text
缺 specs/truth/work-lifecycle.md → 直接 touch 一份（跳過舊 TD 逐筆處置）
```

# Rule 2 - 品質 gate 失敗先分可修復與不可修復

- Level: `MUST`

`vp check`、typecheck、lint、測試等品質 gate 失敗時，先讀錯誤全文再分類；exit code 非 0 本身不是停手理由。判準全文在 verify-gate-chain 規約（clade 源檔 `rules/core/verify-gate-chain.md`，consumer 投影 Claude `.claude/rules/verify-gate-chain.md`、Codex `.agents/skills/clade-verification/rules/verify-gate-chain.md`）§ 可修復的 gate 失敗不是停手理由；該規約 path-gated，沒載入時照這個路徑直接讀。

| 可觀察 predicate | 處理 |
| --- | --- |
| 可修復：錯誤具名到檔（與行），修法在本次 scope 內（格式、lint、型別、import、root cause 明確的 test assertion；root cause 不明的 test 紅燈照 verify-gate-chain 的不確定 error 處理） | 讀錯誤、就地修、從 L0 重跑整輪 gate chain，全綠後續接原工作；test assertion 紅修受測實作，**NEVER** 放寬或改寫斷言求綠 |
| `pnpm exec vp check` 只報格式 | 修前看 `git status --porcelain`，只對本次擁有的路徑跑 `pnpm exec vp check --fix <owned-paths>`（或 `pnpm exec vp fmt --ignore-path .oxfmtignore <owned-files>`；裸打 `vp fmt` 必帶 `--ignore-path`），修後看 `git diff` 確認變動只落在擁有的路徑，再從 L0 重跑整輪 gate chain。**NEVER** 跑不帶路徑的全 repo `--fix`，也 **NEVER** 還原別人改過的檔；報錯的檔不歸你就回報持有者 |
| spec 矛盾（verify-gate-chain 的 specification error） | 立刻退回規格層 owner（`ROLLBACK:<artifact>`），不在執行層改「做什麼」 |
| 不可修復：環境經 self-fix 仍不可解、權限不足、需人拍板、修法在 scope 外、同一 error 連續 2 輪不收斂 | 照本檔 Rule 1 第 5 點停手並回報具體 blocker |

**NEVER** 把可修復的 gate 失敗當成收工、`--complete failed` 或 `--complete blocked` 的理由；brief 或 relay prompt 寫「gate 失敗即停」時，也只指不可修復那一類。

## Good Example

- 這個例子是好的，因為可修復的失敗就地修，從 L0 重跑整輪 gate chain。

```text
vp check 只報格式 → git status --porcelain → pnpm exec vp check --fix <owned-paths> → git diff 確認 → 從 L0 重跑
```

## Bad Example

- 這個例子是壞的，因為把可修復的 gate 失敗當成收工理由，或放寬斷言求綠。

```text
typecheck 報 src/a.ts:12 型別錯（scope 內）→ --complete failed
```
