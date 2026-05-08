<!--
🔒 LOCKED — managed by clade
Source: rules/core/test-scripts.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Vitest multi-project test script 設計規範——禁止寫死 path filter 導致單檔測試靜默跳過
globs: ['package.json', 'vitest.config.ts', 'vitest.config.mts', 'vite.config.ts']
---

# Test Scripts

**核心命題**：vitest multi-project 配置（`projects: [...]` 或 `test.workspace`）下，`package.json` 的 `test:*` script 若寫死路徑當 path filter（例如 `vp test run test/unit`），會把不在該路徑下的 project 整個排除。開發者跑 `pnpm test:unit -- <該 project 範圍外的單檔>` 時 vitest **靜默不跑**（無錯誤、無警告、回 0 fail），開發者誤以為通過但實際根本沒執行。

此規則優先於個別 consumer 既有的 script 命名習慣。

## 適用範圍

- **觸發條件**：`vitest.config.ts` 含 `projects: [...]`（或 `test.workspace`）且 ≥ 2 個 project
- **不適用**：單一 project 配置（一個 `include`），或非 vitest 測試框架（jest、bun:test 等）

## MUST

### 用 `--project=<name>` 取代寫死路徑

每個 vitest project **MUST** 在 `package.json` 有對應 `test:<project>` script，使用 `--project=<name>` flag：

```json
{
  "scripts": {
    "test": "vp test run --coverage",
    "test:file": "vp test run",
    "test:unit": "vp test run --project=unit",
    "test:nuxt": "vp test run --project=nuxt",
    "test:integration": "vp test run --project=integration"
  }
}
```

- `test`：跑全部 projects（CI 預設）
- `test:<project>`：嚴格只跑單一 project，**不**限 path
- `test:file`：無 filter 的 escape hatch，跑單檔時 vitest 自動匹配對應 project（**MUST** 提供）

### 跑單檔的標準作法

跑單檔測試時，**MUST** 使用以下任一形式：

```bash
pnpm test:file <path>           # 推薦：明確走 escape hatch
pnpm vp test run <path>         # 等價：直接呼叫 vp
```

vitest 會依 `vitest.config.ts` 內各 project 的 `include` / `exclude` 自動把該 path 路由到對應 project。

## NEVER

### 禁止把路徑寫進 `test:<project>` script

```json
// ❌ 錯誤——把路徑當 filter 寫死，跨 project 單檔測試會靜默跳過
{
  "scripts": {
    "test:unit": "vp test run test/unit",
    "test:nuxt": "vp test run app"
  }
}
```

寫死路徑的問題：
- `pnpm test:unit -- app/pages/foo.test.ts` 經 npm script 展開為 `vp test run test/unit app/pages/foo.test.ts`
- vitest 把兩者都當 path filter，行為不一致（依版本可能 0 file matched 或部分匹配）
- 開發者無法明確知道 test 是否真的跑了該檔

### 禁止以 `pnpm test:<project> -- <path>` 形式跑單檔

即使 script 本身正確（`--project=<name>`），加了 `-- <path>` 等於把 path filter 限到那個 project 的 include 範圍。**MUST** 改用 `pnpm test:file <path>`。

### 禁止省略 `test:file` escape hatch

每個 multi-project consumer **MUST** 提供無 filter 的 `test:file` script。沒有 escape hatch 時，開發者只能靠 `pnpm vp test run <path>` 直呼，新 contributor 容易踩 `test:<project> -- <path>` trap。

## 範例：違反 → 修正

**Before（寫死路徑 trap）**：

```json
{
  "scripts": {
    "test:unit": "vp test run test/unit"
  }
}
```

**After**：

```json
{
  "scripts": {
    "test:file": "vp test run",
    "test:nuxt": "vp test run --project=nuxt",
    "test:unit": "vp test run --project=unit"
  }
}
```

## 心智模型

| 想做的事 | 用哪個 script |
| --- | --- |
| 跑全部 test（CI / commit 0-C） | `pnpm test` |
| 嚴格只跑某 project 的全部 test | `pnpm test:<project>` |
| 跑特定路徑（單檔、目錄、glob）| `pnpm test:file <path>` |

**不要**用 `pnpm test:<project> -- <path>` — 那是 path filter 限到 project include 範圍的混合形式，trap 之源。

## 與其他規則的關係

- **`testing-anti-patterns.md`**：本規則處理 test **執行入口**；anti-patterns 處理 test **內容**反模式。兩者並存
- **`commit.md`**：commit 0-C 跑 `pnpm test`（無 filter），不受本規則影響；本規則只規範 dev / debug 跑單檔的入口

## 違反時的回報方式

```
[Test Scripts] vitest multi-project 偵測到寫死路徑

問題：<consumer>/package.json 的 scripts.test:<name> 寫成 "vp test run <path>"，
      consumer 用 vitest multi-project 配置時，此 path 等於 filter 限到該路徑下的
      test，跨 project 單檔測試會靜默不跑。

修正：
  - 將 "test:<name>": "vp test run <path>" 改為 "vp test run --project=<name>"
  - 補 "test:file": "vp test run" 作為單檔 escape hatch
  - 跑單檔請改用 pnpm test:file <path>，禁止 pnpm test:<name> -- <path>
```
