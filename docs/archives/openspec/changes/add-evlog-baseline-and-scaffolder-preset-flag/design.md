## Context

starter (`nuxt-supabase-starter/template`) 是 5 consumer 的 reference template — 新 consumer 透過 `pnpm create nuxt-supabase-starter` scaffold 出來。但目前 starter 自身 evlog wiring 是 depth 3（只有 drain pipeline 框架，沒套自家 evlog-baseline preset），且 scaffolder CLI 沒提供 `--evlog-preset` flag — user scaffold 完還要手動 cp `presets/evlog-baseline/` 進去才能拿到 evlog T1 baseline。

clade evlog adoption M3a 階段已經把 30 個 preset file sync 進 `template/presets/{evlog-baseline,evlog-d-pattern-audit,evlog-nuxthub-ai}/`（由 clade `sync-evlog-presets.mjs` 管理）。preset file 在 starter 端是 read-only 散播產物，但**沒人**自動把 baseline preset 套進 starter template 主體。

scaffolder CLI 目前已支援 `--preset default | fast` 為 profile preset（影響 turborepo / oxc 等選項），但 evlog 維度還沒接上。

## Goals / Non-Goals

**Goals:**

- starter template 自身達 evlog T1 baseline（depth ≥ 5）— audit 報 `block signals 0/4`
- scaffolder 一行指令選 evlog preset：`pnpm create nuxt-supabase-starter my-app --evlog-preset {none|baseline|d-pattern-audit|nuxthub-ai}`
- wizard mode（沒帶 flag）對話式問 evlog preset 偏好
- 既有 user 行為不變（預設 `baseline`，新 starter 開箱有 evlog；想關掉用 `--evlog-preset none`）

**Non-Goals:**

- 不做 `--multi-package` flag（M3b.3；T4 layout overlay；獨立 spectra change scope）
- 不改 `presets/` 目錄內 30 個 preset file（clade 管）
- 不重構 scaffolder feature module 系統
- 不支援 evlog version override（preset 鎖 evlog@2.16+）

## Decisions

### Decision 1：starter 自家 wiring 跟 scaffolder CLI flag 同 change 做

兩件事可拆兩條 spectra change，但綁在一起做的好處：

- 套自家 wiring 後，scaffolder 預設 `baseline` preset 已經對應 starter template 主體（不需要額外 cp）
- 順序自然：先 1.1-1.12 套自家 wiring → 2.1-2.9 加 CLI flag → 3.x 整合驗證
- M3b.1 + M3b.2 之間有依賴關係（2 套 baseline 用的就是 1 套進去的 file）

拆開反而要用 mock baseline state，難測。

### Decision 2：`--evlog-preset` 接 4 個值（含 `none`）

候選的：

- `baseline` / `d-pattern-audit` / `nuxthub-ai` — 對應 `presets/` 三個目錄
- `none` — 完全不要 evlog（給「我不想要 wide event」的 user）

**選 4 個含 none**：scaffolder 預設 `baseline`，user 想完全跳過時必須有路徑。否則「pnpm create」就強迫接受 evlog tax。

`d-pattern-audit` 是 baseline 上面疊 audit-pattern；`nuxthub-ai` 是替換 baseline 的 sentry drain 為 nuxthub D1 drain + 加 ai-sdk-logger。assemble.ts 的 helper 處理疊加 / 替換邏輯。

### Decision 3：wizard mode 預設選項

沒帶 flag 時 scaffolder 進對話式 wizard。evlog preset 問題擺在「要不要 logging stack」這層 — 預設選項 baseline，user 直接 enter 就跳過。

理由：90% scaffold 場景是「我要寫個新 nuxt app」，evlog baseline 是合理 default（5 件套 enricher + sampling 都 sane default）。

### Decision 4：preset 套法是 file copy，不是 module install

scaffolder 已支援 `featureModules`（auth / runtime / db 等以 module 注入），但 evlog 用的是 file copy 模式（從 `presets/<preset>/` 抓）。理由：

- evlog preset 涵蓋多個 file（nuxt config + plugins + utils + docs），不只 dependency
- preset 是「一次性套上去就獨立演化」，不像 feature module 需要保持 sync 升版
- clade `sync-evlog-presets.mjs` 已經是 file-copy 模型，scaffolder 對齊比較簡單

### Decision 5：scaffolder 內的 `--evlog-preset` flag 跟 starter template 自身 wiring 不衝突

starter template 主體（套了 baseline 後）在 scaffolder 跑時是「source」。scaffolder `--evlog-preset baseline` 直接 copy starter template 過去（已含 baseline）；`--evlog-preset none` 就 copy 完之後刪掉 evlog files；`--evlog-preset d-pattern-audit | nuxthub-ai` 就 copy 完之後 overlay `presets/d-pattern-audit/` 或 `presets/nuxthub-ai/`。

assemble.ts helper.applyPreset() 邏輯：

```ts
function applyPreset(targetDir: string, preset: EvlogPreset) {
  if (preset === 'none') {
    // 刪除 starter template 內 evlog files
    rmFile(`${targetDir}/server/plugins/evlog-*.ts`)
    rmFile(`${targetDir}/app/utils/evlog-identity.ts`)
    rmFile(`${targetDir}/docs/evlog-client-transport.md`)
    // 移除 nuxt.config.ts 的 evlog block
  } else if (preset === 'baseline') {
    // 啥都不做 — starter template 已含 baseline
  } else {
    // d-pattern-audit / nuxthub-ai：cp presets/<preset>/* 到 targetDir
    copyPresetOverlay(`${cladeRoot}/presets/${preset}`, targetDir)
  }
}
```

## Risks / Trade-offs

### Risk 1：`--evlog-preset none` 刪除 evlog file 時可能漏

evlog 7 個 file 散在多目錄；新增一個 evlog file 進 starter template 但忘了加進「none」的 rmFile list 會 leave 殘留檔。

**Mitigation**：建一個 manifest（`evlog-preset.ts` 內 const `BASELINE_FILES = [...]`），applyPreset('none') 走這個 list；之後新增 file 必須同步更新 manifest（test 2.6 檢查一致性）。

### Risk 2：`presets/` 目錄 30 個 file 是 clade 管的 read-only，scaffolder 拷貝來源也是這

scaffolder 在 user machine 跑時 `presets/` 是 starter template 內的 read-only 投影。如果 user 透過 `pnpm create` 跑時 starter monorepo 不在 user 機器上（pnpm cache 拿到的版本），preset overlay 怎麼定位？

**Mitigation**：scaffolder 跑時會把 starter template 整個 cp 進 target dir（包含 `presets/` 目錄）；assemble.ts 的 applyPreset 從 target dir 自己的 `presets/<preset>/` 抓 overlay file，再把 `presets/` 整個刪掉（preset 套完後不需保留）。

### Risk 3：scaffolder 內既有 `--preset default | fast` 跟新 `--evlog-preset` 名字相似

`--preset` 是 profile preset（影響 turborepo etc），`--evlog-preset` 是 evlog tier — 兩個獨立維度但容易混淆。

**Mitigation**：CLI help 文字 + README 章節分清楚兩個 flag 的職責；wizard mode 對話分兩個獨立問題（profile preset 一個、evlog preset 另一個）。

### Risk 4：starter 目前 dirty（user `assemble.ts` + `_dev-login.get.ts` WIP）

user WIP 沒 commit，本 change apply 的 1.x 步驟（cp 7 個 file + 改 nuxt.config.ts）會跟 user WIP 混。

**Mitigation**：tasks 1.1 第一步明確要求 user 先 commit / stash WIP；apply phase 跑前驗證 working tree clean。
