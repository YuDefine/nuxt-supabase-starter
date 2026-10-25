# vendor/doctor-shared — vite-doctor 共用 rule baseline

clade 治理的 vite-doctor 規則嚴重度設定，散播到所有 Nuxt consumer。

## 安裝

```bash
pnpm add -D vite-doctor
```

## 兩個設定入口，吃不同形狀

vite-doctor 有兩個**互不相通**的設定入口。CLI（`pnpm run doctor`，CI gate）**不讀 `nuxt.config.ts`**，
只讀 `--config <path>` 的 default export，或 repo 根的 `doctor.config.json`。

| 入口 | 檔案 | 形狀 | 作用範圍 |
| --- | --- | --- | --- |
| CLI | `doctor.config.ts`（選用）／clade 預設 | `rules`、`exclude` 在**頂層** | `pnpm run doctor` |
| Nuxt module | `nuxt.config.ts` | `{ config: { rules, exclude } }` | Nuxt 整合（dev / build） |

### CLI 設定（`pnpm run doctor`）

`run.mjs` 依序決定 `--config`：

1. 呼叫端自帶 `--config` → 原樣使用，不重複帶
2. consumer 根目錄有 `doctor.config.{ts,mts,mjs,js,cjs}` → `--config` 它（**整份取代**；要保留 baseline 就 spread
   `doctorCliConfig`；同時有 `doctor.config.json` 時以它為準並印一行警告）
3. consumer 根目錄有 `doctor.config.json` → **疊在 preset 上**（`run.mjs` 產生暫存設定檔：json 的 `rules` 逐條覆蓋
   preset、`exclude` 追加，`suppressions` 等其他欄位照 json）。CLI 單獨自動讀 json 會整份丟掉 baseline，所以不走那條
4. 都沒有 → `--config vendor/doctor-shared/preset.ts`（default export 是 clade baseline）

舊版 `scan` CLI（help 顯示 `--config  Unsupported`）不支援 `--config`，`run.mjs` 不會帶；那些 consumer
在 `nuxt.config.ts` 接上 `vite-doctor/nuxt` module（下節）才有 baseline；升到支援 `--config <path>` 的版本後 CI gate 才改由 `run.mjs` 帶 baseline。

覆寫單一規則（consumer 根目錄 `doctor.config.ts`，import 不帶副檔名）：

```typescript
import { doctorCliConfig, doctorRules } from './vendor/doctor-shared/preset'

export default {
  ...doctorCliConfig,
  rules: { ...doctorRules, 'nuxt-image/prefer-nuxtimg': 'off' },
}
```

### Nuxt module（nuxt.config.ts）

```typescript
import { doctorConfig } from './vendor/doctor-shared/preset'

export default defineNuxtConfig({
  modules: [
    ['vite-doctor/nuxt', doctorConfig],
  ],
})
```

在這裡覆寫規則**不影響** `pnpm run doctor`；要讓 CI gate 看到，改 `doctor.config.ts`。

## CLI

```bash
pnpm run doctor                # 跑全部規則（run 必要；裸 pnpm doctor 撞 pnpm 內建子命令）
pnpm run doctor --changed      # 只掃改動檔
pnpm run doctor --fix          # 自動修 safe fixes
```

`scripts.doctor` 使用 `node vendor/doctor-shared/run.mjs`，依本專案 CLI 的 help 選擇舊版
`scan` 或新版 positional path，並依上節規則帶 `--config`。缺少已安裝的工具時明確失敗，warning 門檻保持 0。

## 編輯 baseline

改 `~/offline/clade/vendor/doctor-shared/preset.ts`，走標準 publish + propagate 流程。
