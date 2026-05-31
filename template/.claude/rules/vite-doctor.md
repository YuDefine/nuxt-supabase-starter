---
description: vite-doctor framework diagnostic scanner 配置與使用
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/vite-doctor.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Vite Doctor（framework diagnostic scanner）

vite-doctor 掃描 Nuxt/Vue/Vite/Nitro 專案，在 review 前偵測 hydration、fetch、routing、security 等常見 bug。

## MUST

1. **devDependency 必裝**：`pnpm add -D vite-doctor@0.0.1`
2. **Nuxt consumer 必啟用 module**：在 `nuxt.config.ts` 加入 `vite-doctor/nuxt`，使用 clade 共用 preset：

   ```typescript
   import { doctorConfig } from './vendor/doctor-shared/preset.mjs'

   export default defineNuxtConfig({
     modules: [
       ['vite-doctor/nuxt', doctorConfig],
     ],
   })
   ```

3. **CI gate**：`pnpm doctor` 必須綠燈（`--max-warnings 0`）
4. **覆寫規則**須有理由：per-consumer override 只用於確實不適用的規則（如不使用 `@nuxt/ui` 時關閉 `nuxt/ui/*`）

## CLI

```bash
pnpm doctor                            # 全掃 + CI gate（--max-warnings 0）
vite-doctor scan . --changed           # 只掃改動檔
vite-doctor scan . --fix               # 自動修 safe fixes
vite-doctor scan . --rules "nuxt/hydration/*"  # 只跑特定規則
```

## Baseline 管理

共用 rule severity 在 `~/offline/clade/vendor/doctor-shared/preset.mjs`（clade 治理），改了走標準 publish + propagate。Consumer 端 `vendor/doctor-shared/` 是投影副本。
