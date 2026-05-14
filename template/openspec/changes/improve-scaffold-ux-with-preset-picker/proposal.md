## Why

`create-nuxt-starter` 互動模式跑 15 個 prompt，使用者要連按 15 次決策；第一步問「專案名稱」屬於冷開機，沒讓使用者進入決策狀態。非互動模式 `--preset` flag 只接受 `default | fast` 兩值，無法表達不同 stack 組合（Cloudflare/Vercel/Node × Supabase/NuxtHub D1）。

學 `vp create @<org>:<name>` 的「高密度 picker 第一步 + stack-axis 套餐」UX 模式，把強相關決策（deploy / dbStack / evlog / monitoring / ci）打包成 5 個 stack preset，wizard prompt 數從 15 砍到 9（含專案名）。preset 同時對應 `--preset` CLI flag 一行直達。

## What Changes

- 新增 `src/presets.ts`：`PresetDefinition` 型別 + 5 個 stack-axis preset（`cloudflare-supabase` / `cloudflare-nuxthub-ai` / `vercel-supabase` / `self-hosted-node` / `minimal`）+ `applyPreset()` / `getPresetById()` / `isPresetId()` helper
- 改 `src/cli.ts:buildSelectionsFromArgs`：preset resolve 早於 feature 套用；`--with` / `--without` 仍可覆蓋 preset 預設；`--auth` / `--ci` / `--db` / `--evlog-preset` 可覆蓋對應的 preset 預設值
- 改 `src/prompts.ts:promptUser`：加 preset picker 為 step 0（6 個 option：5 preset + `custom`）；選 preset 後走 `promptUserPreset()` short wizard（8 prompt）；選 `custom` 走 `promptUserCustom()` 完整 15-prompt wizard（完全獨立於 preset）
- 新增測試：`test/presets.test.ts`（12 cases）+ `test/preset-scaffold-smoke.test.ts`（6 cases，5 preset × assembleProject smoke）+ 補 `test/cli.test.ts` 10 個 `--preset` 測試 + 3 個 wizard preset 路徑測試
- **破壞性 CLI 變更**：`--preset default` / `--preset fast` / `--fast` 全部移除，傳入時 `failValidation()` 提示等價寫法
- 改 `scripts/create-fast-project.sh`：wrapper 內部 `--fast` → `--without testing-full,testing-vitest`（外部 API 不變）
- 更新 `docs/QUICK_START.md` / `docs/CLI_SCAFFOLD.md` / `README.md`：preset picker UX 介紹 + 5 preset 對照表 + 破壞性變更 migration note

## Non-Goals

- **不**改 `featureModules`（既有 21 個 feature module 不動）
- **不**改 `assemble.ts` / `post-scaffold.ts`（preset 是 input layer，不影響 scaffold 機制）
- **不**做 preset 二維矩陣（情境 × 部署 = 9 條路徑太多）— 採 stack-axis 單軸 5 個
- **不**保留 `--preset default / fast` alias（直接 fail 提示，避免靜默漂移）
- **不**動 starter template 本體（純 scaffolder CLI 改）

## Capabilities

### New Capabilities

- `scaffolder-stack-preset-picker`: scaffolder CLI 5 個 stack preset 定義（`cloudflare-supabase` / `cloudflare-nuxthub-ai` / `vercel-supabase` / `self-hosted-node` / `minimal`）+ interactive picker 第一步 + `--preset <id>` CLI flag 一行直達 + custom 逃生口走完整 15-prompt wizard + 破壞性變更（移除舊 `--preset default / fast` / `--fast`，fail + migration 訊息）

### Modified Capabilities

（無 spec-level 修改；本 change 純粹新增 `scaffolder-stack-preset-picker` capability。`--preset` flag 是新 capability 範圍內的 contract，之前 default/fast 兩值未寫成 spec）

## Impact

- 新手 UX：picker 第一步「決策密度高」直接表態 stack 偏好，9 個 prompt 完成設定（剩 8 + projectName）
- 老手 UX：`--preset cloudflare-nuxthub-ai --yes` 一行直達，省 15-prompt
- 老使用者腳本：`--preset default` / `--preset fast` / `--fast` 必須改寫（CLI fail 訊息明確指引轉換方式）
- 散播：本 change 只動 `template/packages/create-nuxt-starter/` 跟 starter root 的 docs / wrapper script，**不**動投影到 5 consumer 的 clade 層
- 新增檔案：`src/presets.ts` + `test/presets.test.ts` + `test/preset-scaffold-smoke.test.ts`
