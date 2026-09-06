# vendor/doctor-shared — vite-doctor 共用 rule baseline

clade 治理的 vite-doctor 規則嚴重度設定，散播到所有 Nuxt consumer。

## 安裝

```bash
pnpm add -D vite-doctor
```

## Consumer 使用（nuxt.config.ts）

```typescript
import { doctorConfig } from './vendor/doctor-shared/preset'

export default defineNuxtConfig({
  modules: [
    ['vite-doctor/nuxt', doctorConfig],
  ],
})
```

### 覆寫單一規則

```typescript
import { doctorRules } from './vendor/doctor-shared/preset'

export default defineNuxtConfig({
  modules: [
    ['vite-doctor/nuxt', {
      config: {
        rules: { ...doctorRules, 'nuxt/ui/prefer-u-button': 'off' },
      },
    }],
  ],
})
```

## CLI

```bash
pnpm run doctor                # 跑全部規則（run 必要；裸 pnpm doctor 撞 pnpm 內建子命令）
pnpm run doctor --changed      # 只掃改動檔
pnpm run doctor --fix          # 自動修 safe fixes
```

`scripts.doctor` 使用 `node vendor/doctor-shared/run.mjs`，依本專案 CLI 的 help 選擇舊版
`scan` 或新版 positional path。缺少已安裝的工具時明確失敗，warning 門檻保持 0。

## 編輯 baseline

改 `~/offline/clade/vendor/doctor-shared/preset.ts`，走標準 publish + propagate 流程。
