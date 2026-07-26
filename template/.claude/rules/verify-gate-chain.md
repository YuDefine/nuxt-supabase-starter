---
description: 自主迴圈的驗證閘門鏈與停止條件——每個 iterate-until-green 迴圈 MUST 跑 gate chain、宣告 max_iterations、定義 escalation action
paths: ['**/*.ts', '**/*.vue', '**/*.tsx', 'openspec/**', 'tasks/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/verify-gate-chain.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Verify Gate Chain（自主迴圈驗證標準）

**核心命題**：agent 自主完成長任務的瓶頸不是行動能力，是**不知道什麼時候算完成**。本規約定義「gate chain」——一組依序執行的驗證指令，結果是機器可判定的 PASS / FAIL——讓 agent 能自行判斷「做完了嗎」並決定重試或停止，不用問人。

## Gate chain 定義

Gate chain 是一組**有序、確定性、機器可判定**的驗證指令。每條指令的 exit code 是唯一判定依據：exit 0 = PASS，non-zero = FAIL。

**每個 consumer MUST 在 `.claude/rules/local/verify-commands.md` 定義自己的 gate chain。** clade 定義標準（本規約），consumer 定義內容（各自的 test runner、port、health endpoint）。

### Gate chain 層級

| 層級 | 指令類型 | 範例 | 何時跑 |
| --- | --- | --- | --- |
| L0 — 格式 | lint + fmt | `vp check` | 每次 Edit/Write 後（PostToolUse hook 已覆蓋） |
| L1 — 型別 | typecheck | `pnpm typecheck` | 每個 phase 完成後 |
| L2 — 單元 | test suite | `pnpm test --run` | 每個 phase 完成後 |
| L3 — 整合 | smoke / health | `curl -sf http://localhost:<port>/api/health` | change 全部 phase 完成後 |

**PASS = L0–L2 全 exit 0。** L3 為 SHOULD（dev server 未起時 skip，不算 FAIL）。

### Consumer verify-commands.md 範本

Consumer 端 `.claude/rules/local/verify-commands.md` MUST 至少定義 L0–L2：

```markdown
# Verify Commands

## Gate Chain

- L0: `vp check`
- L1: `pnpm typecheck`
- L2: `pnpm test --run`
- L3: `curl -sf http://localhost:3040/api/health` (optional, skip if dev server not running)
```

clade 不散播此檔——各 consumer 自管。`vendor/snippets/verify-gate-chain/` 提供 scaffold 模板。

---

## Iterate-until-green 迴圈語義

agent 執行修改後跑 gate chain，FAIL 時**解析 error output → 修正 → 重跑 gate chain**，直到全 PASS 或達到 `max_iterations`。

### MUST 宣告迴圈參數

**每個**自主迴圈（spectra-apply phase 實作、bug fix、lint fix、dep update）開始前 MUST 確認以下兩個參數：

| 參數 | 預設值 | 說明 |
| --- | --- | --- |
| `max_iterations` | 5 | 跑 gate chain → fix → re-run 的最大輪數 |
| `escalation_action` | `HANDOFF` | 超過上限時的行為：`HANDOFF`（寫 HANDOFF.md 交接）/ `ASK`（問 user）/ `STOP`（靜默停止並報告） |

**禁止無上限迴圈。** 沒有宣告 `max_iterations` 的自主 iterate 視同違規。

### 迴圈流程

```
iteration = 0
while iteration < max_iterations:
    run gate chain (L0 → L1 → L2)
    if ALL PASS:
        → done, proceed to next step
    else:
        parse FAIL output (stderr + stdout)
        identify root cause from error messages
        apply fix (Edit/Write)
        iteration += 1

if iteration == max_iterations and still FAIL:
    execute escalation_action
```

### Error 解析規則

Gate chain FAIL 時，agent MUST：

1. **讀 error output 全文**——不截斷、不只看最後一行
2. **分類 error**：
   - **確定性 error**（type error, syntax error, import 缺失, test assertion fail）→ 可自動修正，繼續 iterate
   - **環境 error**（port 占用, DB 未啟, 缺 env var）→ 嘗試 self-fix（kill port / 起 DB / 讀 .env.local），若不可 fix 則 escalation
   - **不確定 error**（test 紅但 root cause 不明）→ 若已 iterate ≥ 2 輪同一 error 不收斂 → 提前 escalation，不燒剩餘輪數
3. **同一 error 連續 2 輪不收斂 = 提前 escalation**——避免同一個修法來回震盪

### Red Flags

發現自己在想以下任一句就 **STOP**，跑 escalation_action：

- 「再試一次應該就好了」（已試 ≥ 2 次同 error）
- 「先跳過這個 test，其他都過了」（不可。gate chain 是全 PASS 語義）
- 「typecheck 太久了，應該沒問題」（不可。timeout 不等於 PASS）
- 「改不動，先 commit 再說」（gate chain FAIL 時 NEVER commit）

---

## 與既有機制的關係

| 機制 | 本規約的角色 |
| --- | --- |
| PostToolUse typecheck hook | L0 即時回饋。本規約的 gate chain 是 phase 完成後的**完整**驗證 |
| `vp check` / publish gate | publish gate 是最終發布門。本規約在**開發過程中**提供相同等級的驗證 |
| spectra-apply Step 8 Final check | Step 8 確認 `state: "all_done"`。本規約在**每個 phase 結束後**就跑，不等到最後 |
| [[checker-contract]] | checker-contract 定義 checker 的 output 格式。本規約定義**何時跑**和**跑完怎麼辦** |
| [[agent-self-verification]] | self-verification 禁止把可自動化的驗證踢回 user。本規約提供具體的「自動化驗證」清單 |

---

## 為什麼

- spectra-apply 目前的 iterate 靠 agent 自由判斷「改完沒」——沒有形式化 gate，agent 傾向過早宣告 done（per [[pitfall-review-gui-detail-page-no-impl-gate]] 類似根因）
- PostToolUse typecheck hook 是 advisory（exit 0 不阻擋）——agent 看到 warning 但不一定修
- 沒有 `max_iterations` → token 和時間可能無限消耗，或反過來一輪就放棄
- Loop Engineering 的核心觀點：「A good loop always knows two things: What success looks like. When to give up.」本規約是這句話的 clade 落地
