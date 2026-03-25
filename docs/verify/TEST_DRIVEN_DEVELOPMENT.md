# TDD 實踐指南

## 核心流程

```
Red → Green → Refactor
```

1. **Red**：寫一個失敗的測試
2. **Green**：寫最少的程式碼讓測試通過
3. **Refactor**：改善程式碼結構，確保測試仍然通過

## Pre-Commit 檢查清單

- [ ] 所有新功能都有對應測試
- [ ] `pnpm test` 全部通過
- [ ] 沒有 `.skip` 或被註解的測試
- [ ] Mock 只用在外部依賴（API、DB），不 mock 內部邏輯

## 測試分類

| 類型 | 路徑                       | 用途                       |
| ---- | -------------------------- | -------------------------- |
| Unit | `test/unit/*.test.ts`      | 純函式、composables、utils |
| Nuxt | `test/nuxt/*.nuxt.test.ts` | 需要 Nuxt 環境的元件測試   |
| E2E  | `e2e/*.spec.ts`            | 端對端使用者流程           |

## 測試覆蓋率目標

- Server API：每個 endpoint 至少 1 個測試（happy path + validation）
- 業務邏輯：完整邊界測試
- Composables：初始狀態 + 主要行為
- feat:test commits 比例 >= 2:1

## 參考

- [Vitest 文件](https://vitest.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Playwright](https://playwright.dev/)
- `.claude/rules/testing-anti-patterns.md` — 測試反模式指南
