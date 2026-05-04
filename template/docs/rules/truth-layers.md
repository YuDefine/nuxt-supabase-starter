---
description: Optional truth-layers 規則——適用於有明確 persistence / contract / API / UI 分層的專案，定義每一層的真相來源
globs:
  [
    'openspec/**',
    'docs/decisions/**',
    'server/**/*.ts',
    'shared/**/*.ts',
    'src/**/*.ts',
    'app/**/*.vue',
  ]
---

# Truth Layers

繁體中文

> Optional rule: 若專案有明確的資料層、契約層、API 層、UI 層，保留此規則。若專案沒有這種分層，可在安裝後移除或調整。

## 核心概念

- **意圖層**：需求、限制、架構方向放在 `openspec/**`、`docs/decisions/**`
- **持久化層**：schema、constraints、migrations 是資料真相來源
- **契約層**：request / response schema、shared contract 是跨層介面真相
- **服務 / API 層**：負責驗證輸入、組裝資料、維持 request-scoped 行為
- **UI 層**：消費契約，不重寫角色、constraint、交易邊界等規則

## 規則

- 不要只在 TypeScript type 或 UI 邏輯中暗自宣告資料庫真相
- 不要讓 API response shape 與 shared contract 漂移
- 不要在 UI 內重建權限 / 狀態機 / 商業規則
- migration、shared contract、API response shape 任一改動時，應同步更新相鄰測試

## 什麼時候特別有用

- 有 migrations / schema tooling
- 有 shared schemas / types
- 有 server routes / handlers
- UI 與資料模型同步成本高

## 禁止事項

- **NEVER** 把不同層的真相重複維護在多個地方
- **NEVER** 讓 UI 成為第一個知道 schema 變更的地方
- **NEVER** 在缺乏明確意圖記錄時直接推翻既有分層決策
