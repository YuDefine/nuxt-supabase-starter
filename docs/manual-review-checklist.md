# 人工檢查清單（Manual Review Checklist）

Spectra tasks 完成後，建議人工確認以下項目。此清單由所有 `/spectra-*` workflow 共用，在 tasks artifact 最後自動附加。

## 編號規則

每個檢查項目在 tasks artifact 中自動編號為 `#1`, `#2`, `#3`...，格式：

```markdown
## 人工檢查

> 來源：`<change-name>` | Specs: `<spec-1>`, `<spec-2>`

- [ ] #1 實際操作功能，確認 happy path 正常運作
- [ ] #2 測試 edge case（空資料、超長文字、特殊字元）
- [ ] #3 確認手機/平板響應式顯示正常
      ...
```

編號用途：

- 溝通時可說「#3 有問題」直接定位
- `/review-screenshot` skill 截圖時以 `#N` 命名
- 歸檔時以 `#N` 標記已完成項目

## 歸檔規則

完成的項目用 `/review-archive` 遷移到 `docs/manual-review-archive.md`：

- 保留來源 change name、spec names、完成日期
- 原 tasks artifact 中已歸檔的項目改為 `[x]`

## 回報格式

發現問題時，回報格式：

- **項目編號**: `#N`
- **來源 change**: `<change-name>`
- **來源 spec**: `<spec-name>`（若能追溯到特定 spec）
- **問題描述**: 具體發現
- **截圖**: `screenshots/local/review/<change-name>-#N-xxx.png`（若有）

---

## 通用檢查

- 實際操作功能，確認 happy path 正常運作
- 測試 edge case（空資料、超長文字、特殊字元）
- 確認手機/平板響應式顯示正常
- 檢查 loading 狀態與 error 狀態是否有處理
- 確認頁面切換、返回不會遺失已填資料

## 資料庫相關

- 確認 RLS policy 正確：一般使用者不能存取他人資料
- 確認 migration 可重複執行（idempotent）
- 檢查 index 是否涵蓋常用查詢條件

## API 相關

- 確認權限檢查：未登入、一般使用者、管理員各角色行為正確
- 確認錯誤回應格式一致，不洩漏內部資訊
- 確認 input validation 涵蓋所有必填欄位

## UI/UX 相關

- 操作成功/失敗有明確的 toast 回饋
- 表單送出後 button 有 loading 狀態防止重複送出

## 部署前確認

- `vp check` 全部通過
- 無殘留的 `console.log` 或 debug code
- 新增的環境變數已加到 GitHub Secrets
