---
description: 動到 nuxt.config / vite.config / package.json scripts / doctor preset 時的 vite-doctor 配置判準（devDependency 必裝、module 必啟用、`pnpm run doctor` 的 run 不可省）
paths: ['nuxt.config.*', 'vite.config.*', 'package.json', 'vendor/doctor-shared/**', 'packages/**/nuxt.config.*', 'packages/**/package.json']
---
<!-- Clade native rule; source: rules/core/vite-doctor.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Vite Doctor（framework diagnostic scanner）

vite-doctor 掃描 Nuxt/Vue/Vite/Nitro 專案，在 review 前偵測 hydration、fetch、routing、security 等常見 bug。

## MUST

1. **devDependency 必裝**：`pnpm add -D vite-doctor`（`/commit` 0-C gate 會偵測 `scripts.doctor` 是否存在，**缺裝直接 block commit**，不是跳過）
2. **Nuxt consumer 必啟用 module**：在 `nuxt.config.ts` 加入 `vite-doctor/nuxt`，使用 clade 共用 preset：

   ```typescript
   import { doctorRules } from './vendor/doctor-shared/preset'

   export default defineNuxtConfig({
     modules: [
       ['vite-doctor/nuxt', { config: { rules: doctorRules } }],
     ],
   })
   ```

   import **NEVER 帶 `.ts` 副檔名** —— `nuxt.config.ts` 在 `nuxi typecheck` 的 program 內，
   帶副檔名在 Nuxt 4.4.x 是 `TS5097`，會擋死**所有** push（見 `rules/core/code-style.md`
   § 三條語法限制；preset 檔頭同樣警告）。

   **兩個設定入口互不相通，各自要接。** `pnpm run doctor`（CI gate）走 CLI，CLI **不讀
   `nuxt.config.ts`**，只讀 `--config <path>` 或根目錄 `doctor.config.json`；`vendor/doctor-shared/run.mjs`
   已替新版 CLI 帶 `--config`（consumer 根目錄有 `doctor.config.{ts,mjs,…}` 用它；只有 `doctor.config.json` 時疊在 clade preset 上；都沒有就用 clade preset），
   所以 `rules` / `exclude` 對 CI gate 的生效**不靠 nuxt.config.ts**。舊版 `scan` CLI 不支援 `--config`，
   只能靠 module 的 Nuxt manifest。module 沒接＝Nuxt 整合與舊版 CLI 跑 vite-doctor **內建預設**，
   靜默且反向：doctor 照跑、照打分、照 exit 0/1，內建預設比 clade baseline 寬鬆的那幾格讓分數**更好看**。
   **NEVER** 從「doctor 有輸出」「分數很高」「CI 綠」推論 baseline 生效 —— module 接線的判定器是
   `scripts/audit-tooling-drift.ts` 的 1c（`doctorBaselineWiring`）。
   **在 `nuxt.config.ts` 覆寫規則不影響 `pnpm run doctor`**；要覆寫 CI gate 的規則，在 consumer 根目錄寫
   `doctor.config.ts`（`{ ...doctorCliConfig, rules: { ...doctorRules, '<rule>': 'off' } }`，形狀見
   `vendor/doctor-shared/README.md`）。

3. **CI gate**：`pnpm run doctor` 必須綠燈（`--max-warnings 0`）。**MUST** 帶 `run`，**NEVER** 裸打 `pnpm doctor` — `doctor` 撞 pnpm 內建子命令，裸打跑的是 pnpm 自家 doctor（檢查 pnpm 環境）並 silent exit 0，`scripts.doctor` 的掃描永遠不執行、errors 不被 enforce
4. **覆寫規則**須有理由：per-consumer override 只用於確實不適用的規則（如不使用 `@nuxt/ui` 時關閉 `nuxt/ui/*`）
5. **版本 fleet 統一鎖精確 `0.1.0`**：`devDependencies.vite-doctor` 寫 `"0.1.0"`，不帶 `^`／`~`。規則 id、診斷代碼與 JSON 形狀隨版本變動，各 consumer 版本不一就會「這邊綠、那邊紅」；升版由 clade 統一改 preset 並散播，NEVER 單一 consumer 自升
6. **NUXT0037 遇到專案自己的 server guard helper → 登記到該規則的 `guards` 選項，NEVER suppress／關規則**：先確認 handler 真的呼叫了 guard（或有 server middleware 擋住），Doctor 只是跟不進專案自己的函式。登記在 consumer 根目錄 `doctor.config.ts`，值是 `[severity, { guards: [...函式名稱] }]`（選項名稱與格式見 `node_modules/vite-doctor/dist/no-route-middleware-api-security-*.mjs` 的 `ctx.options?.guards`）：

   ```typescript
   import { doctorCliConfig, doctorRules } from './vendor/doctor-shared/preset'

   export default {
     ...doctorCliConfig,
     rules: {
       ...doctorRules,
       'nuxt/middleware/no-route-middleware-api-security': ['error', { guards: ['requireAdmin'] }],
     },
   }
   ```

   `guards` 只收函式名稱字串；severity 沿用 preset 的 `error`。handler 真的沒有保護是安全漏洞，要修授權，不是登記 guard。

## CLI

```bash
pnpm run doctor                        # 全掃 + CI gate（run 必要；裸 pnpm doctor 撞 pnpm 內建子命令）
pnpm run doctor --changed              # 只掃改動檔
pnpm run doctor --fix                  # 自動修 safe fixes
pnpm run doctor --rules "nuxt/hydration/*"  # 只跑特定規則
```

初始化的 `scripts.doctor` 使用 `node vendor/doctor-shared/run.mjs`。入口讀本專案已安裝
CLI 的 help，選擇舊版 `scan` 或新版 positional path，保留 `--max-warnings 0` 與附加參數。
缺少本地 binary 或無法辨識 CLI 時回非零；安裝檢查由 new-project-readiness gate 承接。

## Baseline 管理

共用 rule severity 在 `~/offline/clade/vendor/doctor-shared/preset.ts`（clade 治理），改了走標準 publish + propagate。Consumer 端 `vendor/doctor-shared/` 是投影副本。
