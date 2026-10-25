# 品質 gate 失敗分流判準

觸發點：`SKILL.md` Phase 5 step 4（`vp check`、typecheck、lint、測試等品質 gate 失敗時）。

# Rule 1 - 品質 gate 失敗先分可修復與不可修復

- Level: `MUST`

`vp check`、typecheck、lint、測試等品質 gate 失敗時，先讀錯誤全文再分類；exit code 非 0 本身不是停手理由。判準全文在 verify-gate-chain 規約（clade 源檔 `rules/core/verify-gate-chain.md`，consumer 投影 Claude `.claude/rules/verify-gate-chain.md`、Pi `.agents/skills/clade-verification/rules/verify-gate-chain.md`）§ 可修復的 gate 失敗不是停手理由；該規約 path-gated，沒載入時照這個路徑直接讀。

| 可觀察 predicate | 處理 |
| --- | --- |
| 可修復：錯誤具名到檔（與行），修法在本次 scope 內（格式、lint、型別、import、root cause 明確的 test assertion；root cause 不明的 test 紅燈照 verify-gate-chain 的不確定 error 處理） | 讀錯誤、就地修、從 L0 重跑整輪 gate chain，全綠後續接原工作；test assertion 紅修受測實作，**NEVER** 放寬或改寫斷言求綠 |
| `pnpm exec vp check` 只報格式 | 修前看 `git status --porcelain`，只對本次擁有的路徑跑 `pnpm exec vp check --fix <owned-paths>`（或 `pnpm exec vp fmt --ignore-path .oxfmtignore <owned-files>`；裸打 `vp fmt` 必帶 `--ignore-path`），修後看 `git diff` 確認變動只落在擁有的路徑，再從 L0 重跑整輪 gate chain。**NEVER** 跑不帶路徑的全 repo `--fix`，也 **NEVER** 還原別人改過的檔；報錯的檔不歸你就回報持有者 |
| spec 矛盾（verify-gate-chain 的 specification error） | 立刻退回規格層 owner（`ROLLBACK:<artifact>`），不在執行層改「做什麼」 |
| 不可修復：環境經 self-fix 仍不可解、權限不足、需人拍板、修法在 scope 外、同一 error 連續 2 輪不收斂 | 停手並回報具體 blocker：保留已做工作與原始錯誤，寫明解除條件；仍可獨立完成的工作繼續 |

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
