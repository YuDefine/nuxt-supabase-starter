---
description: Codex 派工觸發 request_user_input 時的攔截→評估→代答/升級 protocol；派 codex 時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', 'scripts/spectra-advanced/**', '.claude/agents/**', '.claude/skills/spectra-*/**', '.claude/skills/commit/SKILL.md', 'screenshots/**/progress.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.codex-input-intercept.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Agent Routing — Codex Input Intercept Protocol

> 所有 codex exec 派工的 `request_user_input` 處理規範。技術機制基於 `codex exec resume` + JSONL 事件解析。搭配 [[agent-routing.codex-watch-protocol]] 的 Watch Protocol 使用。

## 核心命題

codex exec 非互動模式下，model 若需要釐清才能繼續工作，會嘗試呼叫 `request_user_input`（需 `--enable default_mode_request_user_input`）。Runtime 拒絕該呼叫後，model fallback 把問題輸出為文字、turn 結束、session 保留。

**主線 Claude 是攔截層**：偵測到 codex 問了問題後，先自行評估能否代答；信心足夠則直接 `codex exec resume` 回覆，信心不足則升級給 user。目標是讓 codex 不猜、敢問，同時不讓每個問題都打斷 user。

## Dispatch Template 變更（所有 codex exec 派工）

標準 dispatch 模板**MUST**加入以下兩個 flag：

```bash
codex exec \
  --model gpt-5.6-sol \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  --enable default_mode_request_user_input \
  --json \
  -c model_reasoning_effort=<medium|high|xhigh> \
  < /tmp/codex-<topic>-<slug>-prompt.md 2>&1
```

| Flag | 用途 |
| --- | --- |
| `--enable default_mode_request_user_input` | 讓 model 遇到不確定時傾向問而非猜（runtime 會拒絕 tool call，model fallback 文字輸出） |
| `--json` | JSONL 事件輸出，可解析 `thread_id`（resume 用）+ 結構化問題偵測 |

**禁止**對需要 input intercept 的派工加 `--ephemeral`（session 必須保留才能 resume）。

例外：`codex-review-safe.sh`（review 用途）維持 `--ephemeral`（純讀不寫，不需 resume；若有問題代表 review prompt 不清楚，重派即可）。

## Prompt 附加段（所有寫 code 派工 MUST 加）

在 prompt 內**MUST**附帶以下段落（與 Plan-first / Commit Authorization / Git Baseline 同等級的硬指令）：

```
## Asking Questions（MUST）

如果你遇到以下情況，**直接在回覆中提出問題**，不要猜測或做假設：

- 需求 / spec 有歧義，無法從 context 判斷正確做法
- 需要在兩個以上合理方案之間選擇，且沒有明確偏好信號
- 缺少必要資訊（API 契約 / 資料庫 schema / 業務規則）
- 發現 brief 預期行為與現有 code 矛盾

提問格式：在回覆最後輸出一個 `## Question` section，每個問題一行。

主線 Claude 會讀到你的問題並回答，你不需要等 user 直接回覆。
```

## 問題偵測（主線 MUST 在每次 codex 完成後執行）

收到 `<task-notification status=completed>` 後，主線**MUST**先做問題偵測再走正常完成流程：

### Step 1 — 解析 JSONL 輸出

讀 BashOutput，從 JSONL 事件中擷取：

```
thread_id  ← 第一個 {"type":"thread.started","thread_id":"<uuid>"} 的 thread_id
last_msg   ← 最後一個 {"type":"item.completed","item":{"type":"agent_message","text":"..."}} 的 text
has_error  ← stderr 含 "request_user_input is not supported in exec mode"
```

### Step 2 — 判定是否為問題

以下**任一**條件命中 → 判定為「codex 在問問題」：

1. `has_error` = true（model 嘗試呼叫 `request_user_input` 被 runtime 拒絕）
2. `last_msg` 含 `## Question` section（per prompt 附加段格式）
3. `last_msg` 以問號結尾 **且** 本 turn 無任何 tool use / file write 事件（純問不做事）

條件 3 的「無 tool use」判定：JSONL 事件中不含 `"type":"item.completed"` 且 `item.type` 為 `tool_call` / `shell` / `file_write` 的事件。

**都不命中** → 正常完成流程（per Watch Protocol § 收到 notification）。

### Step 3 — 評估能否代答

對每個問題，主線依以下準則判斷信心：

**可代答（auto-respond）**— 答案可從以下來源直接推導，不需 user 判斷：

- Brief / prompt 內已含但 codex 漏讀的資訊
- `rules/core/` 或 consumer `.claude/rules/` 既有規約
- Codebase 現有 code / config / schema（主線可 Read 確認）
- 上游文件 / API 文件的明確定義

**必須升級（escalate）**— 以下情境**NEVER**代答：

- 業務邏輯選擇（「客戶要 A 行為還是 B 行為？」）
- 架構方向或設計取捨（「拆成兩個 service 還是一個？」）
- 涉及資安 / 合規 / 費用影響的決策
- 主線自己也不確定的技術判斷
- codex 回報 brief 預期行為與現有 code 矛盾（需 user 確認哪邊對）

**灰色地帶 default 升級**。代答門檻是「staff engineer 看了不會質疑」。

### Step 4a — 代答（auto-respond）

```bash
echo '<answer>' | codex exec resume <thread_id> \
  --model gpt-5.6-sol \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  --enable default_mode_request_user_input \
  --json \
  2>&1
```

以 `run_in_background=true` 執行，啟動新一輪 Watch Protocol。

resume 後 codex 可能再問 → 回到 Step 1 重新偵測。**連續代答上限 3 次**。第 4 次問題**強制升級**（防止 auto-respond loop 失控）。

### Step 4b — 升級給 user（escalate）

用 `AskUserQuestion` 把 codex 的問題呈現給 user：

```
Codex 在執行 <topic> 時提出問題：

<codex 的問題文字>

---
背景：<主線對問題的理解 + 為什麼無法代答>
```

選項依問題性質調整，**MUST** 含至少：
- 直接回答（user 填答案）
- 中止 codex（不再 resume）

收到 user 回答後 → 走 Step 4a 的 resume 流程。

## Q&A Log（MUST）

每次 input intercept 發生（無論代答或升級），**MUST** 寫 log 到 `/tmp/codex-<topic>-<slug>-qa-log.md`：

```markdown
## Codex Input Intercept Log — <topic>-<slug>

### Q1 (auto-responded)
- **Thread**: <thread_id>
- **Question**: <codex 的問題>
- **Answer**: <主線給的答案>
- **Source**: brief / rule:<rule-name> / codebase:<file-path> / <其他>
- **Confidence**: high

### Q2 (escalated to user)
- **Thread**: <thread_id>
- **Question**: <codex 的問題>
- **Answer**: <user 給的答案>
- **Reason for escalation**: <為什麼不能代答>
```

Log 目的：
1. User 事後可 audit Claude 代為做了什麼決策
2. 如果代答導致結果錯誤，可追溯根因
3. 累積 pattern → 未來可改善 brief 品質（問題多 = brief 寫得不夠好）

## 與 Watch Protocol 的整合

### JSONL 格式下的健康判斷

`--json` 改變 BashOutput 內容格式。Watch Protocol 的健康判斷 pattern 對照：

| 舊 pattern（plain text） | 新 pattern（JSONL） |
| --- | --- |
| `exec` 行 / `succeeded in` | `"type":"item.completed"` 且 `item.type` 為 `tool_call` / `shell` |
| `tokens used` | `"type":"turn.completed"` 含 `usage` |
| `Codex Report` | 最後一個 `agent_message` |
| `fetch failed` / `sandbox: rejected` | 仍在 stderr（不受 `--json` 影響） |
| `Continue?` / `waiting for input` | stderr 含 `request_user_input is not supported` |

### 流程順序

```
dispatch (run_in_background)
  → Watch Protocol 安全網 fallback (ScheduleWakeup 1200-1800)
  → <task-notification status=completed>
  → Input Intercept 偵測 (本 rule Step 1-2)
    → 無問題 → 正常完成流程
    → 有問題 → 評估 (Step 3) → 代答/升級 (Step 4a/4b)
      → resume (新 run_in_background) → 新 Watch Protocol cycle → 回到偵測
```

### 安全網 fallback 期間的問題偵測

Watch Protocol 安全網 fallback 觸發時（codex 仍在跑），若 BashOutput tail 含 `request_user_input is not supported` error → codex 正在等 input 但 exec mode 拒絕了。此時 codex 會 fallback 輸出文字問題後結束 turn → background bash 很快就會完成 → notification 觸發 → 走正常 Input Intercept 流程。**不需要在安全網 fallback 階段提前介入**。

## codex-dispatch.mjs 整合

`vendor/scripts/codex-dispatch.mjs`（泛用 Dispatcher）**MUST** 同步更新：

- 加入 `--enable default_mode_request_user_input` + `--json` 為預設 flag
- Exit code `0` 的後處理增加問題偵測步驟
- Resume 機制整合（caller 提供 `--on-question callback` 或 dispatcher 自動 loop）

> 具體 code 改動由後續 session 執行。本 rule 先定義契約。

## 例外

| 場景 | 處理 |
| --- | --- |
| `codex-review-safe.sh`（review） | 維持 `--ephemeral`；codex 問問題 = review prompt 不清楚，調整 prompt 重派 |
| WebSearch routing | 維持 `--ephemeral`；問題場景罕見，重派即可 |
| 連續代答 > 3 次 | 強制升級 user（brief 品質問題，不該由 auto-respond 遮蔽） |

## 為什麼這條 rule 存在

1. codex 在不確定時猜測比問問題更危險（hard-code 騙綠燈 / scope creep / 錯誤假設連鎖）
2. `--enable default_mode_request_user_input` 鼓勵 model 問而非猜，但 exec mode 不支援互動 → 需要 resume 機制補上
3. 不是所有問題都需要打斷 user — 很多問題 Claude 看 context 就能代答（brief 漏寫 / rule 已定義 / codebase 明確）
4. Q&A Log 讓代答行為可審計 + 可追溯，user 不用擔心 Claude 偷偷做了錯誤決策

## 何時退場

當 codex CLI 原生支援 exec mode 的 `request_user_input`（不再回 `-32000` error）+ 提供 stdin 互動管道時，本 rule 的 resume 機制可簡化為直接 stdin 回覆。核心的「攔截→評估→代答/升級」pattern 不變。
