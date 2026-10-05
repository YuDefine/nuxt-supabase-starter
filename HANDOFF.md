# HANDOFF

## 2026-09-28 starter Q160／Q161／TD-004 後續指針

本檔位於維護倉根目錄；scaffold 的 `HANDOFF.md` 來源是 `template/HANDOFF.md`。

Q164（Charles 2026-09-28 逐字答覆）：**「B」**。主持者轉述的執行授權：另設獨立名稱的 starter Cloudflare Workers 驗證部署，只測 TD-016；不動既有 consumer 的 Workers／D1／secret、不綁自訂網域、只注入最小環境值；取得附指令與輸出的讀數後立即 `wrangler delete` 並驗證不存在。帳號／權限不足則停下回報；完成後更新 TD-016、commit＋push 到 draft PR #14。

RUSH-69 主持者續行答覆（2026-09-28，保留原話）：

```text
fleet 沒有同時具備 Cloudflare＋Sentry＋NUXT_APP_ENV 的 consumer（<consumer-a> 是 Docker、不算）。最接近的來源是 <home>/offline/<consumer-c>：Cloudflare Workers／NuxtHub 部署、evlog（nuxt.config.ts:131、382），環境經 runtimeConfig 注入（nuxt.config.ts:60 NUXT_KNOWLEDGE_ENVIRONMENT）。做法：只唯讀（wrangler tail 或既有 evlog drain／NuxtHub log，NEVER 部署、NEVER 改該 repo），取一筆 production 事件的 environment 實值，並核對它是否走「Workers 注入 NUXT_* → useRuntimeConfig() module-eval snapshot」同一路徑。等價且讀得到 → 用它回答 TD-016 並記證據；機制不等價或讀不到（缺憑證等）→ TD-016 保持 open、在 summary 寫明原因，--complete 時 decision 改問 Charles 要不要另設一個 starter 的 Cloudflare 驗證部署。
```

- 工作來源：`<clade-central-repo>/tasks/2026-09-28-rush68/charles-answers-Q143-Q163.md` 的 Q160=A、Q161=用現有 Cloudflare consumer 讀數。當前實作在 `session/2026-09-28-1414-handoff-q143-answers`，改動 `docs/tech-debt.md`、`.github/workflows/template-ci.yml`、`template/packages/create-nuxt-starter/{src/assemble.ts,test/scaffold.test.ts,test/consumer-update-policy.test.ts,README.md}`。
- 已驗證：Codex CLI 0.157.1 在沒有 `.codex/rules` 的最小三件檔專案可讀 `.agents/skills`；scaffolder 相關 3 個測試檔 101/101 通過，scaffolder scoped `tsc`、`vp check`、pre-push Nuxt typecheck 通過。指定的 `npx tsc -p tsconfig.clade.json --noEmit` 因本 repo 沒有該 tsconfig 回 TS5058。draft PR #14 的 Template CI mechanical job 與 Validate Starter 綠；scaffold-smoke 紅在既有 TD-019 的 placeholder scan（main 同樣失敗），draft Unit tests skipped。
- Q161 舊 consumer 讀數：唯讀查 `<consumer-c>` production D1 `evlog_events`，事件 `environment=production`；其 evlog 未接到 starter 的 `NUXT_APP_ENV → useRuntimeConfig()` 零參數路徑，因此這筆值未拿來驗收 TD-016。該 consumer 未被部署或修改。
- Q164 直接驗證：Charles 答「B」後，在獨立 Workers `starter-td016-verify-822797f7` 部署同版 Nuxt／Nitro 與 starter 相同的 runtimeConfig／Cloudflare preset 最小 probe。build inline `appEnv=unknown`，只在部署時注入 `NUXT_APP_ENV=staging`；真實 endpoint 回 `moduleEvalAppEnv=staging`、request 零參數及帶 event 值亦為 `staging`，否證 TD-016 的「module-eval snapshot 恆讀不到注入值」假說。取得讀數後已 `wrangler delete`，Cloudflare API 查詢回 `Worker does not exist [10007]`；完整指令、輸出及範圍限制在 `docs/tech-debt.md` TD-016。未送 Sentry 事件或跑完整 starter app，不能外推到其他版本／設定。
- 其他接續：主持者擁有 `.claude/rules/starter-hygiene.md`，應把「忽略的 `.codex/`／`.agents/` 不會被 scaffold 帶走」改為「scaffold 會從 target `.claude/skills` 生成最小投影」；本 worker 不動該路徑。PR 0-A、ready、merge 與既有 TD-019／TD-021 CI 紅燈歸主持者或另派 owner，本 worker 不執行。

## PR #14 0-A r1 修補交接

- 工作指針：分支 `session/2026-09-28-1414-handoff-q143-answers`；finding 原文在 `<clade-central-repo>/tasks/2026-09-28-rush70/starter14-oa-r1.md`。本節隨同修補提交，最終 head 以 `git rev-parse HEAD` 為準。
- 已修：私人筆記從 `template/HANDOFF.md` 移到本檔；`copyGatePlaybookPack()` 僅複製 `template/HANDOFF.md`，現在該檔與 `origin/main` 相同且指定敏感字樣無命中。TD-016 文件的五欄 probe 片段與本機 `template/temp/td016-verify/server/api/td016.get.ts` 一致，保留既有 curl 讀數；未重新部署 Worker。TD-020 表格已標記 Q160=A、PR #14 待驗證合入。
- 本機證據：`test/scaffold.test.ts` 31/31、變更 Markdown 路徑 `pnpm exec vp check --no-lint`、`git diff --check` 通過。`npx --no-install tsc -p tsconfig.clade.json --noEmit` 因 repo 無此設定檔回 TS5058；本次僅改文件。廣範圍回歸依 PR CI 判讀，與本機結果分開。
- 下一步與所有權：主持者對本分支最終 head 跑 PR #14 的 0-A 驗證輪、判讀 CI，再決定 PR ready／merge；`.claude/**`、`template/packages/create-nuxt-starter/src/**` 與 TD-019／TD-021 後續由主持者或另派 owner 處理。本 worker 的改檔僅本檔、`template/HANDOFF.md`、`docs/tech-debt.md`。

## 2026-09-30 PR #14 rebase 與 main 既有紅燈落點（clade 端 followup brief）

- 工作指針：Work `W-2026-09-28-rush68-starter-handoff`；PR #14 已 rebase 到 `origin/main` `1cf6899d`（clade v1.13.46）。衝突兩處：`.github/workflows/template-ci.yml` 保留 main 的 evlog gate `mode: ratchet`、刪 Spectra 診斷步驟；`docs/tech-debt.md` index 取 main 版（含 TD-024／TD-025）。
- 主持者裁定在本 PR 修兩個 main 紅燈；實查兩者根因都在 clade 源檔（clade HEAD `df94fac9d` 仍在），starter 端沒有不繞過的修法，依 brief 停手：
  1. **UX drift audit（TD-021）**：不是路徑漂移。`template/shared/types/` 存在且 config 正確，但 starter 本就沒有 enum-like 定義（`shared/schemas/` 也無 `z.enum`）。clade `vendor/scripts/audit-ux-drift.ts:1130-1133` 對零 enum 一律 `process.exit(2)`，沒有 allow-empty 出口。建議修在 clade：零 enum 時回報 skip 並 exit 0，或加 config 欄位（例如 `paths.allowEmptyTypes`）明示允許。
  2. **scaffold-smoke placeholder scan（TD-019）**：命中全部是 clade 投影檔。clade `vendor/scripts/preservation-profiles.ts:73`（consumer 名冊列）、`vendor/scripts/wt-batch.ts:195`（consumer→repo 對照列）是真資料，要 clade 決定投影時去識別化或改由 registry 讀入；`vendor/scripts/pre-push/runner.sh:55` 與 `vendor/scripts/pre-push/checks/{nuxt-typecheck,utable-slots,mutation-loading,data-perf-check,review-rules-ratchet,native-picker-ban,nuxt-ui-mixed-slot}.sh` 各一行註解，改成 `<consumer>` 即可。starter 端加 exclude 違反 TD-019 的 NEVER。
- 剩餘步驟：(a) clade owner 修上述兩處、發版；(b) starter 升級 clade 後重跑 PR／main 的 Template CI 與 scaffold-smoke；scan 之後的 typecheck／test:unit／test／check 四關從未在 CI 跑過，可能再露紅燈。
- 所有權：clade `vendor/scripts/**` 歸 clade owner；starter 端本 PR 不動投影檔。

## 2026-10-05 starter hygiene real-tenant-identifier 投影面檢查改 salted-hash

- 工作指針：branch `session/2026-10-05-2217-starter-hygiene-salted-hash`；修 clade propagate v1.13.55 被本 repo pre-commit `[Starter Hygiene] real-tenant-identifier` 誤擋（證據檔 `template/.claude/skills/work-loop/SKILL.md`）。relay 全文：`~/.cache/clade/coordinator/cdb175/starter-hygiene-relay.md`。
- 根因：2026-10-03 public-repo history rewrite 把 `CONSUMER_NAMES` 明文清單洗成 `<consumer-x>` placeholder，check 從此只命中 placeholder（誤判）且永遠抓不到真名（漏抓），雙向失效；test fixture 被一致洗過所以照樣綠。
- 改動（本檔擁有者範圍：`scripts/audit-template-hygiene{,.test}.sh`）：移除明文 regex，改為對 `template/scripts/public-tree-hygiene-tokens.json`（clade propagate 產生、與 `audit-public-tree-hygiene.ts` 同語義的 salted sha256-16 清單）做同等滑窗 hash 比對；掃描器以 `CONSUMER_TOKEN_SCANNER_JS` 內嵌於 audit script，只吃 consumer 類、保留單檔判定。清單缺失／毀損／canary 不符一律 scanner_error fail-closed。例外 hub-agnostic 化：`_notion-*-board` pattern（原例外是目錄名內嵌真名）與 `yudefine/nuxt-supabase-starter`。掃描對象含 path 本身（對齊 .ts）。
- 已驗證：`bash scripts/audit-template-hygiene.test.sh` 11/11（新斷言：placeholder `<consumer-b>` 放行、合成真名 hash 命中被擋、缺清單 fail-closed）；用 propagate 同款清單對 1372 個投影面 tracked 檔實掃 0 命中；hook 三態實測——staged placeholder `SKILL.md` 放行、staged 真名被擋、缺清單被擋。`vp check` 綠；`tsc -p tsconfig.clade.json` 本 repo 無此設定檔（TS5058）。
- 刻意語義：tokens 清單隨 propagate v1.13.55 落地；落地前 staged `template/.claude/**|/.agents/**|/.codex/**|AGENTS.md|CLAUDE.md` 變更會被 fail-closed 擋下（沒有清單等於沒有 gate），本 commit 不觸及 `template/` 不受影響。
- 下一步與所有權：PR 0-A／ready／merge 與 clade v1.13.55 重跑 propagate 歸主持者；`template/**`（含 tokens 清單與 audit .ts 投影檔）歸 clade，NEVER 在 starter 端手改。真名 NEVER 以明文進任何 tracked 檔（測試只用合成 token）。
