## Why

Starter template 需要同時滿足兩種使用情境：(1) 完整 demo 展示所有 pattern，供學習參考；(2) 乾淨空白版，clone 下來即可開始實作新 Application。目前只有一堆 `.gitkeep` 空目錄，既不是 demo 也不是乾淨起點。

## What Changes

- 建立雙模式架構：`main` branch 包含完整 demo，`scripts/create-clean.sh` 可一鍵移除 demo 內容
- 定義 demo 內容的檔案命名慣例與目錄結構，讓 clean script 能精確移除
- Demo 內容集中在可移除的位置：
  - `app/pages/` 中的範例頁面
  - `app/components/demo/` 範例元件
  - `supabase/migrations/` 範例 migration
  - `supabase/seed.sql` 範例種子資料
  - `server/api/v1/` 範例 API endpoints
  - `app/queries/` 範例 queries
  - `test/` 中對應 demo 功能的測試
- Infrastructure 程式碼（layouts, middleware, server utils, error page）在 clean 版本中保留
- Clean script 執行後：
  - 移除 demo pages/components/API/queries/tests
  - 清空 migrations（保留目錄）
  - 清空 seed.sql
  - 重設 `database.types.ts` 為空白型別
  - 保留所有 infrastructure 程式碼
  - 更新 `(home).vue` 為簡潔的 welcome page

## Capabilities

### New Capabilities

- `clean-script`: 一鍵移除 demo 內容的 shell script，產出乾淨的專案起點
- `demo-convention`: Demo 內容的標記慣例，使 infrastructure 與 demo 邊界清晰

### Modified Capabilities

(none)

## Impact

- 新增 `scripts/create-clean.sh`
- 修改 `package.json` 新增 `pnpm create:clean` script
- 修改 `scripts/validate-starter.sh` 支援 demo / clean 兩種模式驗證
- 不影響現有程式碼，純新增
