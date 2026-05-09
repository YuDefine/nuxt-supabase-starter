## 1. Starter 自家 evlog baseline wiring（M3b.1）

- [ ] 1.1 確認 starter working tree clean（user `assemble.ts` + `_dev-login.get.ts` WIP 先 commit / stash）
- [ ] 1.2 `pnpm add evlog@^2.16.0 @sentry/nuxt`（如尚未裝）
- [ ] 1.3 cp `presets/evlog-baseline/server/plugins/evlog-drain.ts` → `server/plugins/evlog-drain.ts`
- [ ] 1.4 cp `presets/evlog-baseline/server/plugins/evlog-enrich.ts` → `server/plugins/evlog-enrich.ts`
- [ ] 1.5 cp `presets/evlog-baseline/server/plugins/evlog-sentry-drain.ts` → `server/plugins/evlog-sentry-drain.ts`
- [ ] 1.6 cp `presets/evlog-baseline/server/plugins/_evlog-drain.README.md` → `server/plugins/_evlog-drain.README.md`
- [ ] 1.7 cp `presets/evlog-baseline/app/utils/evlog-identity.ts` → `app/utils/evlog-identity.ts`
- [ ] 1.8 cp `presets/evlog-baseline/docs/evlog-client-transport.md` → `docs/evlog-client-transport.md`
- [ ] 1.9 修 starter `nuxt.config.ts` — 套 `PRESET.md` pre-applied evlog block（modules 加 `evlog`、加 `evlog: { ... }` config 含 sampling / redaction / client transport / typed fields）
- [ ] 1.10 補 `.env.example` evlog 環境變數（`SENTRY_DSN` / `NUXT_PUBLIC_SENTRY_DSN` / `EVLOG_CLIENT_RATE_LIMIT_PER_MIN=100`）
- [ ] 1.11 `pnpm typecheck` 0 errors
- [ ] 1.12 跑 `node /Users/charles/offline/clade/scripts/evlog-adoption-audit.mjs --repo $(pwd)` 驗 depth ≥ 5；block signals 0/4

## 2. Scaffolder CLI `--evlog-preset` flag（M3b.2）

- [ ] 2.1 `packages/create-nuxt-starter/src/cli.ts` 加 `--evlog-preset <name>` flag — accept enum `none | baseline | d-pattern-audit | nuxthub-ai`，default 為 `baseline`
- [ ] 2.2 `packages/create-nuxt-starter/src/prompts.ts` 加 wizard 問答 — flag 沒帶時對話式問 evlog preset 偏好（含 4 個選項 + 各自描述）
- [ ] 2.3 新增 `packages/create-nuxt-starter/src/evlog-preset.ts` helper — 內含 4 個 preset 對應的 file copy / overlay 規則（baseline → 7 個檔；d-pattern-audit → baseline + 1 個 audit-pattern 檔；nuxthub-ai → 替換 evlog-sentry-drain 為 evlog-nuxthub-drain + 加 ai-sdk-logger）
- [ ] 2.4 `packages/create-nuxt-starter/src/assemble.ts` 整合：依 `selections.evlogPreset` 跑 helper.applyPreset()
- [ ] 2.5 `packages/create-nuxt-starter/src/types.ts` 加 `evlogPreset` field 到 `Selections` interface
- [ ] 2.6 加 vitest 單元測試：`packages/create-nuxt-starter/test/evlog-preset.test.ts` — 驗證 4 個 preset 各自 applyPreset 後 file tree 正確
- [ ] 2.7 加 e2e 測試：`packages/create-nuxt-starter/test/cli-evlog-preset.e2e.test.ts` — 驗 CLI 4 個 flag 值各自 scaffold 出符合預期的 starter
- [ ] 2.8 `pnpm test` 全綠
- [ ] 2.9 update `packages/create-nuxt-starter/README.md`：加 `--evlog-preset` 章節 + 4 個 preset 使用情境介紹

## 3. 整合驗證

- [ ] 3.1 用新 scaffolder scaffold 一個 `--evlog-preset baseline` 樣本 app；跑 `evlog-adoption-audit` 驗 depth 5
- [ ] 3.2 同上 `--evlog-preset d-pattern-audit`；驗 depth 6+ + audit-pattern hash chain 段落
- [ ] 3.3 同上 `--evlog-preset nuxthub-ai`；驗 depth 6+ + NuxtHub D1 drain + ai-sdk-logger
- [ ] 3.4 `--evlog-preset none`：無 evlog 任何 file，scaffold 出乾淨 starter
- [ ] 3.5 user wizard mode（不帶 flag）跑 scaffold；驗對話正確顯示 4 選項

## 4. 文件 + commit

- [ ] 4.1 update starter `README.md`：加 evlog preset 章節 link
- [ ] 4.2 update starter `openspec/ROADMAP.md`：標 M3b.1 + M3b.2 完成
- [ ] 4.3 update clade HANDOFF.md：標 §2.1 部分完成（M3b.1 + M3b.2 done；M3b.3 multi-package 留下次 spectra change）
- [ ] 4.4 commit + push（trunk-based 或 PR flow 視 starter 設定）

## 5. 人工檢查

- [ ] #1 scaffold 一個 `pnpm create nuxt-supabase-starter test-app --evlog-preset baseline` 跑 `pnpm dev`，瀏覽器打 `http://localhost:3000` 觸發任何 endpoint，Sentry Logs 看到 wide event（含 actor / tenant / requestSize / userAgent / geo / traceContext 5 件套 enricher 命中）
- [ ] #2 同 #1 但 `--evlog-preset d-pattern-audit`；除 #1 內容外，DB 內看到 `audit_logs` table 有 row（hash + prev_hash 不為 null）
- [ ] #3 同 #1 但 `--evlog-preset nuxthub-ai`；NuxtHub D1 binding 後 `evlog_events` table 有 row + `event.ai.cost_usd` 寫入
- [ ] #4 wizard mode 跑 `pnpm create nuxt-supabase-starter test-wizard`（不帶 flag），對話階段選「baseline」與「none」結果跟對應 flag 一致
- [ ] #5 starter 自家（不 scaffold）跑 `pnpm dev` + `evlog-adoption-audit`，depth 顯示 5；block signals 全綠
