# vendor/doctor-shared — vite-doctor 共用 rule baseline

clade 治理的 vite-doctor 規則嚴重度設定，散播到所有 Nuxt consumer。

## 安裝

```bash
pnpm add -D vite-doctor@0.0.1
```

## Consumer 使用（nuxt.config.ts）

```typescript
import { doctorConfig } from './vendor/doctor-shared/preset.mjs'

export default defineNuxtConfig({
  modules: [
    ['vite-doctor/nuxt', doctorConfig],
  ],
})
```

### 覆寫單一規則

```typescript
import { doctorRules } from './vendor/doctor-shared/preset.mjs'

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
pnpm doctor                    # 跑全部規則（hub-scripts 注入）
vite-doctor scan . --changed   # 只掃改動檔
vite-doctor scan . --fix       # 自動修 safe fixes
```

## 編輯 baseline

改 `~/offline/clade/vendor/doctor-shared/preset.mjs`，走標準 publish + propagate 流程。
