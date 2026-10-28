---
name: nuxt-charts
description: Nuxt 圖表、dashboard、KPI／狀態卡類 UI：先查已購 nuxtcharts.com block／template 再自組。NOT for admin CRUD、資源列表與表單（用 dashboardstack）、NOT for 資料抓取與分頁效能稽核（用 nuxt-data-audit）。
---


# Nuxt Charts

fleet 持有 Nuxt Charts **Commercial License（All Access）**：付費 block、template 與 Theme Editor 都在授權內。付費內容與取得方式：

| 種類 | 在哪 | 怎麼取得 |
| --- | --- | --- |
| chart（11 種） | npm `nuxt-charts` 套件，開源 | `pnpm add nuxt-charts@^3`，不需授權 |
| block（2026-10-23 同步 135 個，數量以鏡像 `manifest.json` 為準；20 類：各式 chart、dashboard navbar、status、calendar、AI、bar lists、cards、account & users、pricing tables、onboarding、file upload、heatmaps） | PRIVATE 鏡像 `YuDefine/nuxt-charts-assets` 的 `<類別>/<標題 slug>.vue`＋同名 `.png` | clone 鏡像讀檔；鏡像過期或缺 block 才退回官網 Code（`rules/付費內容取得路徑.md`） |
| template（5 個可取得的整站樣板） | 同一個鏡像的 `templates/<name>/` | clone 鏡像讀檔 |

鏡像由 clade 的 `vendor/scripts/nuxt-charts-assets-sync.ts` 在 desk 每週同步（官網 Code、`nuxtcharts/*` 上游 repo 是它的來源），`manifest.json` 記每個檔的來源與 sha256。本 skill 以 `nuxt-charts` **v3** 為準。

# SOP

## Phase 1 -- 判定要不要畫圖、版本對不對

1. THINK 先判這個需求的答案用圖比用表格好讀：需要看趨勢、比例、分佈才畫圖；只是查值、比數字就用表格，不畫圖。要畫圖時先讀取 `rules/圖表類型選擇判準.md`，依資料形狀定出圖種，作為 Phase 2 要查的 block 類別。這一步只決定畫不畫圖與畫哪一種：KPI／統計卡、狀態、定價表、帳號頁這類 UI 即使不畫圖，也照樣走 Phase 2 查 block。
2. READ 讀 consumer `package.json` 的 `nuxt-charts` 版本（寫 `catalog:` 的去 `pnpm-workspace.yaml` 的 `catalog` 查實際版號）。還沒裝時：要畫圖才裝 v3（`pnpm add nuxt-charts@^3`，再照官方文件註冊 module）；不畫圖的 UI 只照 Phase 2 查 blocks 與 template 當版面底稿，**NEVER** 為此安裝 `nuxt-charts`。已裝但不是 `3.x` 就停下：付費 block 與 v3 API 對 v2 不相容，回報「需先升 v3」並另開升級工作，**NEVER** 把 v3 的 block 硬塞進 v2 專案。停下前仍照 Phase 2 唯讀查過 blocks 與 template，把查到可用的寫進升級工作的需求，升完直接接 Phase 3。

## Phase 2 -- 先查付費資產，確定沒有合用的才自組

1. READ 先讀取 `rules/付費內容取得路徑.md` Rule 1，照它把鏡像 clone 到 session scratchpad 並判 `FRESH`／`STALE`，然後兩步都要做，**NEVER** 因為需求看起來只是單張圖就跳過 template、或只是整頁就跳過 blocks：
   - 讀鏡像 `manifest.json` 的 `blocks`（依 `category` 找對應類別）與 `templates`，用每個 block 同名的 `.png`（Example 截圖）判斷合不合用，不開瀏覽器。
   - 查 https://nuxtcharts.com/docs 的 v3 API，**NEVER** 憑記憶寫 v3 props。fleet 不用官方 MCP。
2. THINK 先讀取 `rules/付費資產優先與來源註記.md`，照它判定要以哪個 block／template 為底，或判定沒有合用的而改用開源 chart 自組。

## Phase 3 -- 授權前置

1. READ 先讀 `rules/付費授權與token保管.md`，照它檢查目的 repo 的可見度，不過就停在這一步。

## Phase 4 -- 落地

1. READ 先讀取 `rules/付費內容取得路徑.md`，照 block 或 template 對應的那條從鏡像複製原始碼落進 repo（鏡像 `STALE` 或缺該 block 時照 Rule 1 退回官網 Code）；自組的跳過這步。
2. WRITE 每個用到 nuxt-charts 圖表的 `.vue` 檔第一行都寫來源註記，格式照 `rules/付費資產優先與來源註記.md` Rule 2。
3. READ 先讀取 `rules/SSR與尺寸判準.md`，照它檢查每張圖的 SSR 處理與高度，不符就改。
4. READ 先讀取 `rules/圖表配色與無障礙判準.md`，照它改落地後的資料色、外框色與文字替代；判準沒涵蓋的視覺問題交 `/impeccable`。

## Phase 5 -- 驗證

1. DELEGATE 跑 consumer 的 typecheck 與 build。
2. DELEGATE 起 dev server 實際截圖，亮暗兩種主題都看，確認圖有資料、色彩對、窄螢幕不破版。
3. WRITE 在 PR 說明或回報裡列出用了哪些 block／template；有自組的，寫出查過哪些 block／template、各自為何不合用（與來源註記的 `checked:`、`reason:` 一致）。
