## 設計脈絡

### 取捨：preset 軸向 — stack 組合 vs 使用情境

| 軸向選擇               | 例                                                                                                   | 取捨                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **stack 組合**（採用） | `cloudflare-supabase` / `cloudflare-nuxthub-ai` / `vercel-supabase` / `self-hosted-node` / `minimal` | 跟既有 feature 名字一致；debug 時 preset 對應實際設定一目了然；單軸 5 個結構簡單                  |
| 使用情境               | `saas-mvp` / `internal-tool` / `blog-site` / `ai-chatbot`                                            | 使用者不必懂 stack 也能選；但內部 mapping 複雜，同一情境可能對應多 stack（saas 可走 cf / vercel） |
| 二維矩陣               | 情境 × 部署                                                                                          | 9+ 條路徑太多，多數組合不合理（blog × Node 罕見）                                                 |

**決策**：採 stack 組合（單軸 5 個）。理由：5 consumer codebase 都按 stack 命名 feature，preset 對齊降低認知負擔；單軸結構讓 `presets.ts` manifest shape 簡單（`PresetDefinition` 7 個欄位平鋪直敘）。

### 取捨：第一步 picker vs 維持「名稱第一」

| 設計                      | 取捨                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| **picker 第一步**（採用） | 高密度決策表態進場；老手不必跑完 15 prompt；新手在 picker 看 preset description 學到 stack 概念 |
| 名稱第一                  | 起手不嚇人；但 15 prompt 才能完成設定；非互動模式 `--yes` 拿不到 preset 對等捷徑                |

**決策**：picker 第一步。為避免新手「不知道該選哪個」被卡住，picker 第 6 個 option 是 `custom` 走完整 15-prompt wizard（完全獨立於 preset，跟舊行為 100% 一致）。

### 取捨：preset 預設行為 — 鎖死 vs 可覆蓋

| 設計                     | 取捨                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 完全鎖死                 | preset 等於 stack contract，使用者只能切 preset 不能微調                                                                                    | 太僵化，user 可能想 `cloudflare-supabase` + `auth-better-auth`（混搭） |
| **預設值可覆蓋**（採用） | preset 提供 `auth` / `ci` / `dbStack` / `evlogPreset` 預設；`--with` / `--without` / `--auth` / `--ci` / `--db` / `--evlog-preset` 可單獨蓋 | 彈性最大但 mapping 變多                                                |

**決策**：可覆蓋。preset 是 baseline + opinionated 默認值，user 在預設值上微調。`buildSelectionsFromArgs` 用 nullish coalescing：`preset?.dbStack` 被 `--db` 覆蓋、`preset?.authDefault` 被 `--auth` 覆蓋。

### 取捨：backward compat — alias vs deprecate

| 設計                       | 取捨                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Alias 保留                 | `--preset default` → `cloudflare-supabase`、`--preset fast` → `cloudflare-supabase --without testing-*` + deprecation warn | 老腳本零成本升級；但 alias 永遠累積，preset id 命名空間污染   |
| **直接 deprecate**（採用） | `--preset default` / `--preset fast` / `--fast` 全部 fail + 訊息指引等價寫法                                               | 老腳本必改但只需一次；CLI 介面乾淨；fail 訊息明確避免靜默漂移 |

**決策**：直接 deprecate。理由：starter 仍在早期階段（v0.1.0），breaking change 成本低；user 透過 fail 訊息一次學會新介面比長期維護 alias 划算。

## Preset 內容對照表

| Preset id                     | Deploy     | DB stack   | Evlog preset | Auth 預設           | CI          | startEmpty |
| ----------------------------- | ---------- | ---------- | ------------ | ------------------- | ----------- | ---------- |
| `cloudflare-supabase`（預設） | cloudflare | supabase   | baseline     | nuxt-auth-utils     | ci-simple   | false      |
| `cloudflare-nuxthub-ai`       | cloudflare | nuxthub-d1 | nuxthub-ai   | better-auth（強制） | ci-simple   | false      |
| `vercel-supabase`             | vercel     | supabase   | baseline     | nuxt-auth-utils     | ci-simple   | false      |
| `self-hosted-node`            | node       | supabase   | baseline     | nuxt-auth-utils     | ci-advanced | false      |
| `minimal`                     | cloudflare | supabase   | none         | none                | ci-simple   | true       |

`startEmpty=true` 表示 base feature set 從空集合起手（不套 `featureModules.filter(m => m.default)`）。

## CLI 破壞性變更 Migration

| 舊用法             | 新用法                                                               |
| ------------------ | -------------------------------------------------------------------- |
| `--preset default` | `--preset cloudflare-supabase`（或不帶 flag）                        |
| `--preset fast`    | `--preset cloudflare-supabase --without testing-full,testing-vitest` |
| `--fast`           | `--without testing-full,testing-vitest`                              |

CLI 傳入舊值時直接 `failValidation()`，訊息列出可用 preset 清單。

## Interactive Wizard 兩條路徑

```
promptUser(defaultProjectName)
├── step 0: preset picker (select, 6 options)
│
├── 選 5 個 stack preset 之一 → promptUserPreset(preset, defaultProjectName)
│   └── 8 prompt: 專案名 / auth / UI / SSR / extras / state / testing / agentTargets
│       （dbStack / evlogPreset / deploy / monitoring / ci 由 preset 鎖死）
│
└── 選 custom → promptUserCustom(defaultProjectName)
    └── 15 prompt: 完整 wizard（跟舊版 promptUser 行為 100% 一致）
```

`promptUserPreset` 內部用 `applyPreset()` 取得 base feature set，user prompt 答案覆蓋 auth / extras / state / testing，最後 `resolveFeatureDependencies()` 補上 transitive deps。

## 既有測試影響

兩個既有 wizard fixture（`auto-selects NuxtHub D1 for nuxthub-ai` / `rejects wizard NuxtHub D1 with nuxt-auth-utils`）原本第一個 response 是 `auth-better-auth` / `auth-nuxt-utils`（對應舊 step 1 是 auth）。新增 step 0 preset picker 後，fixture 開頭補 `'custom'` 走完整 15-prompt 路徑保持原行為。

## 未來擴張預留

- `PresetDefinition` 已預留 `extraFeatures` / `excludeFeatures` 欄位給未來 preset 個性化（目前 5 個 preset 都沒用到）
- 若未來加第 6 個 preset（例：`cloudflare-d1-only` 沒 AI），只要在 `PRESETS` array 加一筆 + `PresetId` union 加一個 literal，picker / `applyPreset()` / 測試矩陣自動 cover
