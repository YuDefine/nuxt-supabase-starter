# P7 legacy-tests 凍結完成回報（nuxt-supabase-starter）

來源：clade W-2026-09-26-legacy-test-absorption P7；worker dispatch d1b77dae（冷續接 w94:p1）。
落地：origin/main `ba4f607b`（seal commit `4fef2812`）。

## 結果

`node scripts/legacy-tests.ts status --json`（template/ 內）：

```json
{ "state": "frozen", "frozen_at": "2026-09-28", "legacy": 29, "unmarked": 11,
  "post_freeze_unmarked": [], "late_marked": [], "malformed": [],
  "unverifiable": [], "features": 0, "shallow": false,
  "recorded": true, "sealed": true }
```

分類（40 → 29 標記 + 11 純邏輯保留 + 0 刪除）：

- **標記 29**：e2e 3（auth / roles.example / smoke）、`test/nuxt/AppEmptyState`、
  API handler 4（_dev/login.post、profiles ×3）、有 I/O 的 server utils 3
  （audit/drizzle/supabase，受測單元做 DB I/O 但全 mock）、自留 placeholder
  `test/unit/example.test.ts`、create-nuxt-starter 17（受測單元做 FS/process I/O）。
- **保留不標 11 純邏輯**：schemas/profiles、validation、api-response、db-errors、
  useModalForm、vue-component-resolution、vue-warn-guard、presets、question-catalog，
  及 `templates/features/testing-{vitest,full}/test/unit/example.test.ts`。
  **後兩支刻意不標**：它們經 feature overlay ship 進新 consumer；帶 marker 的話，
  consumer 首次凍結前 `status` 會把它判成 late_marked 違規噪音（檔案建立日晚於
  marker 日期）。
- **無刪除**：無死測試（skip 全是 env-gated）；repo 尚無 `.feature`，無 scenario 重疊。

## 驗證（本機）

- `pnpm test`（template/，vp test --coverage：unit+scaffolder+nuxt 三 project）：
  **34 files / 372 tests passed**，2 skipped，exit 0。
- `pnpm check`（vue-component-resolution + vp check + nuxt typecheck）：exit 0。
- 本 repo 無 `tsconfig.clade.json`（clade 慣例不適用），typecheck 由 `nuxt typecheck` 涵蓋。
- e2e playwright 屬 CI lane（template-e2e.yml）；marker 為 `//` 註解行，無行為影響。

## 殘項（非本件，pre-existing）

**main CI 紅，與凍結無關**：`template-ci.yml` Unit tests job 自 v1.13.37 起連續失敗
（run 36344278803 同樣斷言 `.codex/config.toml`）。根因：`scaffold.test.ts`
"supports codex + cursor multi-select" 斷言 `assembleProject` 產出 `.codex/`、
`.agents/`，但這兩個目錄被 `template/.gitignore` 排除（sync-to-codex 投影，
可重生），fresh clone / CI / 新 worktree 都沒有 → `copyTemplateCodexAssets`
跳過 → 斷言失敗。maintainer 本機有投影所以綠。

修法選項（maintainer 決策）：(a) scaffolder 改為從 `.claude/` 即時生成 codex 投影、
(b) 測試改寫成不依賴本機投影、(c) 解除該兩目錄的 gitignore 改為 tracked 投影。
本 worker 驗證用：從 main checkout 複製 `.codex`/`.agents` 進 worktree 後全綠。

其餘已知殘項：consumer-meta 1W（`auth.devSigninEnabled` vs `_dev/login.post.ts`
路由存在）屬 maintainer 決策，上一棒已記錄。
EOF