---
description: 自主迴圈的驗證閘門鏈與停止條件——每個 iterate-until-green 迴圈要跑 gate chain、宣告 max_iterations、定義 escalation action
paths: ['**/*.ts', '**/*.vue', '**/*.tsx', 'tasks/**', 'specs/**', 'package.json', 'packages/*/package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
---
<!-- Clade native rule; source: rules/core/verify-gate-chain.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Verify Gate Chain（自主迴圈驗證標準）

自主迴圈要知道兩件事：什麼算完成、何時放棄。gate chain 給出機器可判定的 PASS / FAIL，`max_iterations` 與 `escalation_action` 給出停止條件。

## Gate chain 定義

Gate chain 是一組**有序、確定性、機器可判定**的驗證指令。每條指令的 exit code 是唯一判定依據：exit 0 = PASS，non-zero = FAIL。

**每個 consumer 要在自己的 local rule source 定義 gate chain。** 新來源位於 `.clade/rules/verify-commands.md`，並宣告經審閱的 runtime audience；既有 `.claude/rules/local/verify-commands.md` 在明確 adoption 前仍保留原內容與所有權。clade 定義標準（本規約），consumer 定義內容（各自的 test runner、port、health endpoint）；adoption 走 [[local-rule-override]] 的來源 hash 與投影所有權檢查。

### Gate chain 層級

| 層級 | 指令類型 | 範例 | 何時跑 |
| --- | --- | --- | --- |
| L0 — 格式 | lint + fmt | `vp check` | 每次修改後；具名 hook 的執行與成功證據可承載該次檢查 |
| L1 — 型別 | typecheck | `pnpm typecheck` | 每個 phase 完成後 |
| L2 — 單元 | test suite | `pnpm test --run` | 每個 phase 完成後 |
| L3 — 整合 | smoke / health | `curl -sf http://localhost:<port>/api/health` | change 全部 phase 完成後 |

**PASS = L0–L2 全 exit 0。** L3 為 SHOULD（dev server 未起時 skip，不算 FAIL）。

Claude Code／Codex／Cursor 每個產品入口分別確認具名驗證 handler 是否安裝、啟用並實際執行。只有 generic hook adapter 或設定檔時，修改後顯式執行 consumer 定義的 L0；phase 結束仍執行完整 L0–L2。沒有命令執行能力或拿不到 exit/result 證據時，該 gate 保持未驗證。

### Consumer verify-commands.md 範本

Consumer 的 verify-commands source 要至少定義 L0–L2：

```markdown
# Verify Commands

## Gate Chain

- L0: `vp check`
- L1: `pnpm typecheck`
- L2: `pnpm test --run`
- L3: `curl -sf http://localhost:3040/api/health` (optional, skip if dev server not running)
```

scaffold 模板：`vendor/snippets/verify-gate-chain/`。

---

## Iterate-until-green 迴圈語義

agent 執行修改後跑 gate chain，FAIL 時**解析 error output → 修正 → 重跑 gate chain**，直到全 PASS 或達到 `max_iterations`。

每次重試從 L0 開始，依序跑 L0 → L1 → L2 並保留同一輪的結果；timeout 或缺結果的輪次不完整，不能把該輪的 L0 綠燈與下一輪的 L1／L2 拼成完整 PASS。只有 formatting 的 phase 也使用這條完成判準。

### MUST 宣告迴圈參數

**每個**自主迴圈（`/implement` phase 實作、bug fix、lint fix、dep update）開始前要確認以下兩個參數：

| 參數 | 預設值 | 說明 |
| --- | --- | --- |
| `max_iterations` | 5 | 跑 gate chain → fix → re-run 的最大輪數 |
| `escalation_action` | `HANDOFF` | 超過上限時的行為：`HANDOFF`（寫 HANDOFF.md 交接）/ `ASK`（問 user）/ `STOP`（靜默停止並報告）/ `ROLLBACK:<artifact>`（退回上游 artifact 修 spec——只在判定 specification error 時用，見 § Error 解析規則） |

**禁止無上限迴圈。** 沒有宣告 `max_iterations` 的自主 iterate 視同違規。

### Error 解析規則

Gate chain FAIL 時，agent 要：

1. **讀 error output 全文**——不截斷、不只看最後一行
2. **分類 error**：
   - **確定性 error**（type error, syntax error, import 缺失, test assertion fail）→ 可自動修正，繼續 iterate
   - **環境 error**（port 占用, DB 未啟, 缺 env var）→ 嘗試 self-fix（kill port / 起 DB / 讀 .env.local），若不可 fix 則 escalation
   - **不確定 error**（test 紅但 root cause 不明）→ 若已 iterate ≥ 2 輪同一 error 不收斂 → 提前 escalation，不燒剩餘輪數
   - **specification error**（命中任一即是：驗收條件互相矛盾；要讓 gate 綠必須改 spec 宣告的行為、刪需求或改資料定義；test 斷言與 spec 文字直接衝突）→ **不是 iterate 對象**。**立刻**執行 `ROLLBACK:<artifact>`，不等 `max_iterations`：走 aixbdd 的工作退回規格層（feature／DSL 歸 `/dsl-refine`、`tasks.md` 結構歸 `/tasks`、需求內容歸 `/specify`——執行層不要自己改「做什麼」）；ad-hoc 工作退回 `tasks/<date>-<slug>.md` 改寫驗收段後再重進迴圈。退回時要保留證據：error output、互相衝突的 spec 條目原文、已試過的修法
3. **同一 error 連續 2 輪不收斂 = 提前 escalation**——避免同一個修法來回震盪
4. gate chain 是全 PASS 語義：跳過某條 test、把 timeout 當通過都不算綠；FAIL 的狀態下不要 commit
