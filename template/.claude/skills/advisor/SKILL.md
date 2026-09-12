---
name: advisor
description: 在 Herdr 開立獨立顧問 pane，派外部模型（Fable / Astra / Opus / Sol 等）針對當前工作區進行唯讀架構評估、方案審查或決策諮詢。主線不交棒收工，與 /handoff relay 互斥。Use when 使用者說「派 advisor」「派 fable」「ccw fable medium」「cx astra medium」，或需要獨立外部專家進行架構評估時。
license: MIT
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: action
---


# /advisor — 架構顧問獨立 Pane 派工

本 skill 用於在 Herdr 中開出一個**獨立的新 Pane**，指派指定模型與推理檔位（如 `ccw fable medium`、`cx astra medium`）作為**唯讀架構顧問 (Read-Only Advisor)**，針對當前問題進行架構評估、方案對比或極端邊界審查。

**與 `/handoff relay` 的本質區隔**：
- `/handoff relay` 是**移交主線位置並收工**。
- `/advisor` 是**主線 MUST 保留運行**，開立獨立 Pane 供外部模型分析，主線不交棒、不收工、不 emit `work.done`。

## 調用語法

```bash
/advisor [<launcher> <model> <effort>] [諮詢題目或目標描述]
```

### 參數契約（預設值為 `ccw fable medium`）

| 參數 | 支援值域 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| `launcher` | `ccw`, `cx`, `cc`, `ccg`, `ccagy`, `grok`, `pi` | `ccw` | 執行環境別名（`ccw` 為 Claude Work, `cx` 為 Codex, `cc` 為 Claude Personal） |
| `model` | `fable`, `astra`, `opus`, `sol`, `luna`, `gemini`, `grok-4.6` | `fable` | 目標模型別名（`fable` 為 Claude 3.7/Sonnet, `astra` 為 GPT-6 Astra, `sol` 為 GPT-5.6 Sol） |
| `effort` | `low`, `medium`, `high`, `max` | `medium` | 推理強度 / 思考檔位 |

常見呼叫組合：
- `/advisor ccw fable medium [題目]`：標準架構評估、程式碼實作審查（預設）。
- `/advisor cx astra medium [題目]`：高層次架構決策、系統邊界裁決。
- `/advisor cx sol high [題目]`：深度效能分析、複雜演算法或並發鎖競爭排查。
- `/advisor cc opus high [題目]`：重大重構方案安全性論證。
- `/advisor grok grok-4.6 high [題目]`：第三方發散性探索。

## 執行流程

### Step 1 — 解析參數與上下文
1. 解析命令列的三元組 `<launcher> <model> <effort>`；若使用者未指定，預設填入 `ccw fable medium`。
2. 收集當前工作區上下文：
   - 工作區絕對路徑 (`cwd`)
   - 當前 Git HEAD 與分支
   - 相關的 spec / code / migration 檔案路徑
   - 近期發生的 error / evlog 軌跡或待決策點

### Step 2 — 建立 Advisory Brief
在 `/tmp/advisor-brief-<uuid>.md` 寫入薄指示書：
- **角色宣告**：`你是 Read-Only 架構顧問（Advisor）。專注在架構深度分析、風險盤點、方案比較與決策建議。請勿修改程式碼、建立 migration 或發動 commit。`
- **專案上下文**：當前工作區路徑、相關檔案、已知現象。
- **目標與提問**：使用者交辦的具體題目與期待產出（根本原因、方案權衡、落地步驟）。

### Step 3 — 透過 Herdr Helper 派工
呼叫 Clade 跨環境分發腳本：
```bash
node "${CLADE_HOME:-$HOME/offline/clade}/vendor/scripts/herdr-session-handoff.ts" \
  --advisory \
  --launcher "<launcher>" \
  --model "<model>" \
  --effort "<effort>" \
  --route manual \
  --tier-basis manual \
  --label "[advisor] <簡短標籤>" \
  --cwd "$(pwd)" \
  --prompt-file "<brief-path>"
```

### Step 4 — 回報並維持主線運行
1. 輸出派工結果（Pane ID、Launcher、Model、Effort、Brief 路徑）。
2. **主線 MUST 繼續保留運行**，不調用 `work.done`，隨時可進行後續開發或向顧問追問。
