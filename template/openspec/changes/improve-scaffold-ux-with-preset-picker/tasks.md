## 1. Preset manifest 與單元測試（Requirement: scaffolder 提供 5 個 stack preset）

> 對齊 design.md「取捨：preset 軸向 — stack 組合 vs 使用情境」決策：採 stack 組合（單軸 5 個）。

- [x] 1.1 新增 `template/packages/create-nuxt-starter/src/presets.ts`：`PresetDefinition` 型別 + 5 個 `PRESETS` + `applyPreset()` / `getPresetById()` / `isPresetId()` / `PRESET_IDS` / `DEFAULT_PRESET_ID`
- [x] 1.2 新增 `test/presets.test.ts`：12 cases 覆蓋 manifest 結構 + `applyPreset()` 行為（cloudflare-supabase / cloudflare-nuxthub-ai / vercel-supabase / self-hosted-node / minimal 各驗一次）
- [x] 1.3 `pnpm test` presets.test.ts 12/12 pass

## 2. cli.ts 接 preset + 破壞性變更（Requirement: scaffolder CLI 支援 `--preset` flag 接 5 個 stack id + 破壞性變更 — 舊 `--preset default / fast` 與 `--fast` 移除）

> 對齊 design.md「取捨：preset 預設行為 — 鎖死 vs 可覆蓋」決策：採可覆蓋（preset 提供 baseline，flag 可單獨蓋）。
> 對齊 design.md「取捨：backward compat — alias vs deprecate」決策：採直接 deprecate（fail + migration 訊息）。

- [x] 2.1 `src/cli.ts` import `PRESET_IDS / applyPreset / getPresetById / isPresetId / PresetDefinition` from `./presets`
- [x] 2.2 `buildSelectionsFromArgs` L232-236：擴 `--preset` 值域；`--preset default` / `--preset fast` 直接 `failValidation()` 提示等價寫法；`--fast` flag 傳入也 `failValidation()`
- [x] 2.3 `buildSelectionsFromArgs` L245-254：刪 `useFastPreset` 邏輯；改成從 preset 取 `dbStack` / `evlogPreset` 預設（被 `--db` / `--evlog-preset` 覆蓋）
- [x] 2.4 `buildSelectionsFromArgs` L249：`selected = preset ? applyPreset(preset) : (args.minimal ? new Set() : new Set(defaults))`
- [x] 2.5 main args block：preset description 改成 PRESET_IDS 列表；`--fast` description 標記 deprecated
- [x] 2.6 補 `test/cli.test.ts` 10 個 `--preset` 測試（cloudflare-supabase = 預設 / nuxthub-ai 自動鎖 / vercel / self-hosted-node / minimal / --with override / 舊值 fail / 未知 fail / --fast fail）

## 3. prompts.ts 加 picker + custom 逃生（Requirement: scaffolder 互動 wizard 第一步是 preset picker）

> 對齊 design.md「取捨：第一步 picker vs 維持「名稱第一」」決策：採 picker 第一步，第 6 option `custom` 走完整 15-prompt 保留新手逃生口。

- [x] 3.1 `src/prompts.ts` import preset stuff
- [x] 3.2 `promptUser()` 開頭加 preset picker（select widget，6 options：5 preset + `custom`，initial=`cloudflare-supabase`）
- [x] 3.3 picker 選非 custom → `return promptUserPreset(preset, defaultProjectName)`
- [x] 3.4 picker 選 custom → `return promptUserCustom(defaultProjectName)`
- [x] 3.5 新增 `promptUserPreset()`：8 prompt（projectName / auth / UI / SSR / extras / state / testing / agentTargets），用 `applyPreset()` 取 base 後套 user 答案，最後 `resolveFeatureDependencies()`
- [x] 3.6 把原 `promptUser` body 改名為 `promptUserCustom`（內部 function，保留 15-prompt 行為 100%）
- [x] 3.7 補既有 2 個 wizard fixture（`test/cli.test.ts`）開頭加 `'custom'` 走完整 15-prompt
- [x] 3.8 補 3 個 wizard preset 路徑測試（cloudflare-supabase / minimal / cloudflare-nuxthub-ai 各跑完 short wizard 驗 output）

## 4. Scaffold smoke + 全測試綠燈

- [x] 4.1 新增 `test/preset-scaffold-smoke.test.ts`：5 個 preset 各跑一次 `buildSelectionsFromArgs` → `assembleProject` → 驗 `package.json` / `nuxt.config.ts` 對齊
- [x] 4.2 加「每個 preset 都產出必要檔」smoke 覆蓋所有 preset 起碼產出 package.json / nuxt.config.ts / tsconfig.json / app/app.vue / .env.example / .claude/settings.json
- [x] 4.3 `pnpm test` 全綠：83 tests（82 passed + 1 pre-existing skipped）
- [x] 4.4 `pnpm typecheck` pass

## 5. Docs 更新（Requirement: scaffolder docs 含 preset picker 章節）

- [x] 5.1 `docs/QUICK_START.md`：加 preset picker UX 介紹（互動模式段）+ 5 preset 對照表 + 破壞性變更 migration note
- [x] 5.2 `docs/QUICK_START.md`：非互動模式範例改成 `--preset` 寫法；fast profile 範例改成 `--without testing-full,testing-vitest`
- [x] 5.3 `docs/CLI_SCAFFOLD.md`：非互動參數段重寫（含 `--preset` / 破壞性變更 migration 表）+ 互動選單段分 preset path / custom path 兩條路徑
- [x] 5.4 `README.md`：CLI Tool 段加 preset 範例 + 5 preset 列表
- [x] 5.5 `scripts/create-fast-project.sh`：wrapper 內部 `--fast` → `--without testing-full,testing-vitest`（外部 API 不變）

## 6. Spectra change 收尾

- [x] 6.1 `spectra validate improve-scaffold-ux-with-preset-picker` 通過
- [x] 6.2 `spectra analyze improve-scaffold-ux-with-preset-picker` 無 critical findings（coverage/consistency warning 已對齊 requirement 與 design topic 至 task heading）
- [ ] 6.3 commit：先 `git reset HEAD` 撤掉 propagate 投影 + 別 session WIP，再 selective stage 本 change 影響的 10 個檔 + 4 個 spectra change 檔
- [ ] 6.4 `/spectra-archive` 把 change 收進 archive
