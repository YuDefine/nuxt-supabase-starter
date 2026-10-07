---
description: Vitest multi-project test script 設計規範——禁止寫死 path filter 導致單檔測試靜默跳過
paths: ['package.json', 'vitest.config.ts', 'vite.config.ts']
---
<!-- Clade native rule; source: rules/core/test-scripts.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

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
執行前仍要核對 repo 的 gate 入口：已包 `clade-gate` 的 `test:file` 可直接使用；
直呼 `vp test run` 若未經 script 受閘，須在 wrapper 可用時改由 `clade-gate run test -- vp test run <path>` 執行。
小範圍定點測試會走 light lane；wrapper 不存在的 CI／cloud 環境保持原本測試入口可執行，
不因 Bash admission hook 缺少 wrapper 而硬擋。
`node --test`／`vitest run` 直呼一律經 `clade-gate run test -- <命令>`：明確列出 1–5 個
`.test.*`／`.spec.*` 檔案由 gate 分到 light slot，不排 heavy；`2>&1` 等重導向及
`--reporter=dot`、`--test-name-pattern` 旗標不算測試檔。未指定檔案或列出超過 5 個檔案按整套測試處理；
resource-patrol 用相同的檔數門檻。wrapper 不存在的 CI／cloud 環境照舊可直跑。
被派出的 worker（`CLADE_DISPATCH_ID` 非空）跑不帶 lane 的整套（`pnpm test`、`test:full`／`--lane=full`、
`clade-gate run test -- <未列檔的 runner>`）會被擋；確要跑加 `CLADE_ALLOW_FULL_SUITE=1`
（命令前綴、同一命令串 `export`、或 session 啟動環境——前一個 Bash call 裡 `export` 只有 gate 看得到、
admission hook 看不到，仍會被擋）並在回報寫理由。

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


### 禁止以 `pnpm test:<project> -- <path>` 形式跑單檔

即使 script 本身正確（`--project=<name>`），加了 `-- <path>` 等於把 path filter 限到那個 project 的 include 範圍。**MUST** 改用 `pnpm test:file <path>`。

### 禁止省略 `test:file` escape hatch

每個 multi-project consumer **MUST** 提供無 filter 的 `test:file` script。

## 心智模型

| 想做的事 | 用哪個 script |
| --- | --- |
| 跑全部 test（CI / commit 0-C） | `pnpm test` |
| 嚴格只跑某 project 的全部 test | `pnpm test:<project>` |
| 跑特定路徑（單檔、目錄、glob）| `pnpm test:file <path>` |

**不要**用 `pnpm test:<project> -- <path>` — 那是 path filter 限到 project include 範圍的混合形式，trap 之源。

## Advisory：包 clade-gate 收 signal（improvement-loop enabled consumer）

Consumer 在 `registry/consumers.json` 標 `improvement_loop_enabled: true` 時，`.clade/bin/clade-gate` 會由 propagate 寫入。本檔規範的 `test` / `test:<project>` / `test:file` 等 script 建議 wrap 一層 `.clade/bin/clade-gate run test --` 讓 dev cycle 進 signal ledger（不只是 git pre-commit 那一次）。

```diff
-"test": "vp test run --coverage",
+"test": ".clade/bin/clade-gate run test -- vp test run --coverage",
```

`lint` / `typecheck` 同理。詳細採用收益 + 快速 diff + anti-pattern：見 `vendor/snippets/clade-gate-package-scripts/README.md`。

採用由 consumer 的 session 決定，clade 稽核命中時 **MUST relay 給它**。

## MUST：重寫已包 clade-gate 的 script 時保留前綴

**要不要採用** clade-gate 是 advisory（上一段，consumer 自治區決定）；但**一旦某個 `test` / `lint` / `typecheck` script 已經包了 `.clade/bin/clade-gate run <gate> --` 前綴**，後續任何「換 lint/test/typecheck 工具」「重寫該 script 命令」的操作（含跨 consumer fleet sweep、tooling migration、scaffold 重生）**MUST 只替換 wrapper `--` 後面的內層命令、保留前綴**，**NEVER** 整行覆蓋把前綴一起丟掉。

```diff
# ✅ 正確：換 lint 工具 oxlint → vp lint，只換 `--` 後面的內層命令
-"lint": ".clade/bin/clade-gate run lint -- oxlint .",
+"lint": ".clade/bin/clade-gate run lint -- vp lint --deny-warnings",

# ❌ 錯誤：整行重寫，clade-gate 前綴消失 → instrumentation 退化、dev signal 整片盲區
-"lint": ".clade/bin/clade-gate run lint -- oxlint .",
+"lint": "vp lint --deny-warnings",
```

**改 `package.json` 的 test/lint/typecheck script 前自查一句**：這行原本有 `.clade/bin/clade-gate run` 前綴嗎？有 → 改完它**必須**還在。

機械檢查（本檔 `paths:` 命中時適用）：`node scripts/audit-test-scripts.ts` 掃 `package.json`／`vitest.config.ts` 的 test script 與 project 宣告一致性——改完跑一遍再走。
