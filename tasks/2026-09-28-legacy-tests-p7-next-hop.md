# P7 relay 下一跳：legacy-tests 凍結（等 clade propagate 後執行）

來源：clade W-2026-09-26-legacy-test-absorption P7（w89:p70 主持的六家 relay）。
本檔是 durable followup brief，交給 clade 主持者在 propagate 落地後再派一棒。

## 本棒已完成（2026-09-28）

- 修好 `template/.claude/consumer-meta.json`：commit `1f82fee8` 已推上 `main`。
  - `database.hosted: "none"`、`database.previewEnvCapability: "none"`、
    `commands.{typecheck,lint,test,build,smoke}`、`deploy.deployTrigger: "none"`、
    `dev.ports` 3000→3020（對齊 `pnpm dev --port 3020`）。
- 驗證：`node ~/offline/clade/scripts/sync-consumer-meta.ts --consumers-file <單家清單>`
  回 `! nuxt-supabase-starter (1W 0E)`，exit 0 —— meta 驗證已通過，propagate 的
  per-consumer withhold 解除（withhold 只看 errors / missing manifest）。
- 殘 1W 屬既有宣告問題，非本棒新增、**不擋 propagate**：
  `auth.devSigninEnabled=false` 但 template 有 `server/api/_dev/login.post.ts`
  dev-login route（better-auth-post）。auth 語意整組宣告（provider、better-auth、
  cookieNamespace 策略）是 starter maintainer 的決策，worker 不應逐欄位猜。

## 下一跳前置條件（主持者動作）

1. clade 主持者跑 `node scripts/sync-consumer-meta.ts`（重生 snapshot）。
2. 下一趟 propagate 把 v1.13.39 投影送進 `template/`：
   `scripts/legacy-tests.ts`、`rules/modules/capabilities/aixbdd/legacy-tests.md`
   對應的 skill 投影（`clade-spec-workflow/rules/legacy-tests.md`）。
3. propagate 落地後再派 worker。CLI 未出現前不要派——`scripts/legacy-tests.ts`
   不在樹上時本工作無法進行。

## 下一跳工作內容（依該 repo 規約）

標準 pointer：
- 規約：`rules/modules/capabilities/aixbdd/legacy-tests.md`（投影後在
  `template/.claude/skills/clade-spec-workflow/rules/legacy-tests.md`）
- cookbook：`~/offline/clade/vendor/snippets/legacy-tests/README.md`
- CLI：`cd template && node scripts/legacy-tests.ts status|mark|unmark`
- audit baseline：clade `scripts/audit-legacy-tests.ts` 報 starter 40 支未標記

步驟（cookbook §1–§3）：

1. **在 worktree 做**（會動大量測試檔；本 repo trunk-based，merge 回 main）。
2. `node scripts/legacy-tests.ts status --json` 確認 `state: not-frozen`。
3. 逐支分類 40 支舊測試（死測試／scenario 重疊 → `git rm`；純邏輯不變量 →
   保留不標；其餘行為測試 → 保留待標）。判不出來歸「其餘行為測試」。
4. `mark --frozen <當日> --all --dry-run` 看標記範圍 → `mark --all` →
   `unmark <純邏輯檔>`。
5. Commit 順序是**硬性**的：刪除一支 commit；marker＋`.legacy-tests.json`
   另一支 commit（= 封存點）。record 先進 commit 會讓後補 marker 全判違規。
6. 完整測試綠（`cd template && pnpm test`）才准 commit 封存 commit。

## 驗收（下一棒要附的證據）

- `node scripts/legacy-tests.ts status --json`：`state=frozen`、`sealed=true`、
  `late_marked` 與 `malformed` 皆空。
- `template/.legacy-tests.json` 已進 commit（未 commit 會被 fleet audit 判
  NOT-FROZEN）。
- 完整測試綠（附指令與結果）；commit SHA 回報。

## 檔案所有權（下一棒）

- 你的：`.legacy-tests.json`、測試檔 marker、依規約所需的 commit／push。
- NEVER 動：clade 投影檔（`.claude/**` 中 clade 管理檔、`.clade/**`）、
  別 session 的 worktree／未提交 WIP。
