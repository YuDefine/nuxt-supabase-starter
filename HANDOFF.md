# HANDOFF

## 2026-09-28 starter Q160／Q161／TD-004 後續指針

本檔位於維護倉根目錄；scaffold 的 `HANDOFF.md` 來源是 `template/HANDOFF.md`。

Q164（Charles 2026-09-28 逐字答覆）：**「B」**。主持者轉述的執行授權：另設獨立名稱的 starter Cloudflare Workers 驗證部署，只測 TD-016；不動既有 consumer 的 Workers／D1／secret、不綁自訂網域、只注入最小環境值；取得附指令與輸出的讀數後立即 `wrangler delete` 並驗證不存在。帳號／權限不足則停下回報；完成後更新 TD-016、commit＋push 到 draft PR #14。

RUSH-69 主持者續行答覆（2026-09-28，保留原話）：

```text
fleet 沒有同時具備 Cloudflare＋Sentry＋NUXT_APP_ENV 的 consumer（perno 是 Docker、不算）。最接近的來源是 /home/charles/offline/nuxt-edge-agentic-rag：Cloudflare Workers／NuxtHub 部署、evlog（nuxt.config.ts:131、382），環境經 runtimeConfig 注入（nuxt.config.ts:60 NUXT_KNOWLEDGE_ENVIRONMENT）。做法：只唯讀（wrangler tail 或既有 evlog drain／NuxtHub log，NEVER 部署、NEVER 改該 repo），取一筆 production 事件的 environment 實值，並核對它是否走「Workers 注入 NUXT_* → useRuntimeConfig() module-eval snapshot」同一路徑。等價且讀得到 → 用它回答 TD-016 並記證據；機制不等價或讀不到（缺憑證等）→ TD-016 保持 open、在 summary 寫明原因，--complete 時 decision 改問 Charles 要不要另設一個 starter 的 Cloudflare 驗證部署。
```

- 工作來源：`/home/charles/offline/clade/tasks/2026-09-28-rush68/charles-answers-Q143-Q163.md` 的 Q160=A、Q161=用現有 Cloudflare consumer 讀數。當前實作在 `session/2026-09-28-1414-handoff-q143-answers`，改動 `docs/tech-debt.md`、`.github/workflows/template-ci.yml`、`template/packages/create-nuxt-starter/{src/assemble.ts,test/scaffold.test.ts,test/consumer-update-policy.test.ts,README.md}`。
- 已驗證：Codex CLI 0.157.1 在沒有 `.codex/rules` 的最小三件檔專案可讀 `.agents/skills`；scaffolder 相關 3 個測試檔 101/101 通過，scaffolder scoped `tsc`、`vp check`、pre-push Nuxt typecheck 通過。指定的 `npx tsc -p tsconfig.clade.json --noEmit` 因本 repo 沒有該 tsconfig 回 TS5058。draft PR #14 的 Template CI mechanical job 與 Validate Starter 綠；scaffold-smoke 紅在既有 TD-019 的 placeholder scan（main 同樣失敗），draft Unit tests skipped。
- Q161 舊 consumer 讀數：唯讀查 `nuxt-edge-agentic-rag` production D1 `evlog_events`，事件 `environment=production`；其 evlog 未接到 starter 的 `NUXT_APP_ENV → useRuntimeConfig()` 零參數路徑，因此這筆值未拿來驗收 TD-016。該 consumer 未被部署或修改。
- Q164 直接驗證：Charles 答「B」後，在獨立 Workers `starter-td016-verify-822797f7` 部署同版 Nuxt／Nitro 與 starter 相同的 runtimeConfig／Cloudflare preset 最小 probe。build inline `appEnv=unknown`，只在部署時注入 `NUXT_APP_ENV=staging`；真實 endpoint 回 `moduleEvalAppEnv=staging`、request 零參數及帶 event 值亦為 `staging`，否證 TD-016 的「module-eval snapshot 恆讀不到注入值」假說。取得讀數後已 `wrangler delete`，Cloudflare API 查詢回 `Worker does not exist [10007]`；完整指令、輸出及範圍限制在 `docs/tech-debt.md` TD-016。未送 Sentry 事件或跑完整 starter app，不能外推到其他版本／設定。
- 其他接續：主持者擁有 `.claude/rules/starter-hygiene.md`，應把「忽略的 `.codex/`／`.agents/` 不會被 scaffold 帶走」改為「scaffold 會從 target `.claude/skills` 生成最小投影」；本 worker 不動該路徑。PR 0-A、ready、merge 與既有 TD-019／TD-021 CI 紅燈歸主持者或另派 owner，本 worker 不執行。
