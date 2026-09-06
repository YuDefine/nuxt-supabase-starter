---
description: 動到 nuxt.config / vite.config / package.json scripts / doctor preset 時的 vite-doctor 配置判準（devDependency 必裝、module 必啟用、`pnpm run doctor` 的 run 不可省）
paths: ['nuxt.config.*', 'vite.config.*', 'package.json', 'vendor/doctor-shared/**', 'packages/**/nuxt.config.*', 'packages/**/package.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/vite-doctor.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


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
   § 三條語法限制）。本行 2026-08-29 修正：原範例寫的是 `preset.ts`，與 preset 檔頭自己的
   警告相反。

   **接上 module 才算數，vendored 了 preset 不算。** Doctor CLI 只從 Nuxt
   manifest 的 `doctorConfig` 讀 rule 設定；module 沒接，那份 preset 就只是一個沒有人 import
   的檔案，掃描跑的是 vite-doctor **內建預設**。這個失敗**靜默且反向**：doctor 照跑、照打分、
   照 exit 0/1，只是量的是別的規則集，而內建預設比 clade baseline 寬鬆的那幾格會讓分數**更好看**。
   **NEVER** 從「doctor 有輸出」「分數很高」「CI 綠」推論 baseline 生效 —— 判定器是
   `scripts/audit-tooling-drift.ts` 的 1c（`doctorBaselineWiring`）。

3. **CI gate**：`pnpm run doctor` 必須綠燈（`--max-warnings 0`）。**MUST** 帶 `run`，**NEVER** 裸打 `pnpm doctor` — `doctor` 撞 pnpm 內建子命令，裸打跑的是 pnpm 自家 doctor（檢查 pnpm 環境）並 silent exit 0，`scripts.doctor` 的掃描永遠不執行、errors 不被 enforce
4. **覆寫規則**須有理由：per-consumer override 只用於確實不適用的規則（如不使用 `@nuxt/ui` 時關閉 `nuxt/ui/*`）

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
