---
description: /goal 模式設定規則——goal 條件必須完全由 agent 自力達成，禁止把 user-bound action 寫進 goal，卡關時改走 /handoff
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/goal-mode.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Goal Mode — 別把 user 動作寫進 agent goal

`/goal` 是 stop-hook 重試循環：agent 每次嘗試結束，hook 檢查 goal 是否達成，未達成就強制 agent 繼續。

**核心命題**：goal 條件**MUST**完全由 agent 自力達成且自力驗證。把 agent 不能達成的條件寫進 goal = 把 stop-hook 變成無限迴圈，agent 只能反覆吐「等 user」直到 token 燒光或 user 中斷。

## 禁止寫進 goal 的條件類型

凡 agent 無法在 session 內單獨完成 / 驗證的，**NEVER** 列入 goal：

| 類型 | 範例 |
| --- | --- |
| User 親跑 / 親確認 | 「user 跑 `pnpm dev` 驗證頁面」「user 確認截圖」「user 跑 db:reset」「user 親自 review」 |
| User 環境密鑰 / 帳號操作 | 「`wrangler secret put`」「`supabase db push`」「`gcloud auth login`」「user 設定 `.env`」 |
| User commit / push 決策 | 「user commit TD-NNN」「user push 到 main」「user merge PR」 |
| 外部 signal 等待 | 「等 CI 跑完」「等 deploy ETA」「等合約截止日」「等 oncall 回覆」（除非 agent 能 poll 且 poll 在 goal scope 內） |
| 跨 session / 跨人協作 | 「等另一個 session 完成 X」「等同事 review」 |

判別測試：「執行 stop-hook 檢查時，agent 能不能用工具獨立驗證這條成立？」否 → 不可寫進 goal。

## 設定 goal 時的 self-check（強制）

當 agent 在 `/goal` 模式下被請求**設定**新 goal、**補充** goal 條件、或 user 啟動 `/goal` 時把目標清單交給 agent，**MUST** 跑這份檢查：

1. 列出 goal 內**所有條目**
2. 對每條問：「stop-hook 觸發時，我能用工具自力驗證這條完成嗎？」
3. 任一條答 "否" → **NEVER** 直接收下啟動 /goal。改走：
   - 用 `AskUserQuestion` 把 user-bound 條目列出來
   - 提議把它們移到 `HANDOFF.md` / `docs/tech-debt.md` / `openspec/ROADMAP.md`
   - 確認剩下 agent-self-contained 條目後才啟動 /goal

**反模式**（看到自己這樣寫就停下）：

- 「Goal：1. 修 bug X 2. **user 親跑驗證** 3. **user commit TD-061**」 — #2 #3 是 user-bound，stop-hook 永遠彈
- 「Goal：1. 寫完 spec 2. **等 CI green**」 — CI 通常 agent 不能 poll，等於 user-bound
- 「Goal：1. 改完檔案 2. **user 確認可以 push**」 — 決策權在 user，不該在 goal

## 執行中偵測卡關 → 切換 /handoff

`/goal` 跑進去之後，若觀察到以下任一 signal，**MUST** 立即終止 /goal 並改走 `/handoff`：

- Stop-hook 反彈後，agent 連續 ≥ 2 次輸出「等 user」「等待 user」「user-bound」「待 user 操作」「Agent 工作上限」「Goal not yet met」等卡關語句而沒有實質進展
- Agent 已完成自己能做的全部工作，剩餘條目都需要 user 動作
- 對話迴圈出現「#X #Y user-bound 待操作」、「等 user」、「等 user 操作」這類重複輸出 ≥ 2 輪

切換動作：

1. **立即停手**，**NEVER** 再下任何 tool call 嘗試「再推一下看看」
2. 向 user 明確說：「Goal #X #Y 是 user-bound，agent 無法達成，建議現在跑 `/handoff` 把剩餘工作登記到 HANDOFF.md」
3. 跑 `/handoff` skill 把未完項升級到 `HANDOFF.md` / `docs/tech-debt.md` / `openspec/changes/`
4. 由 user 決定是否關掉 /goal 模式

**為什麼一定要切換 /handoff，不能讓 user 自行手動關 /goal**：

- 卡關期間每次 stop-hook 反彈都在燒 token + cache miss
- Agent 反覆吐「等 user」是雜訊，會把真正該登記的 follow-up 淹沒
- `/handoff` skill 已有現成的「未完項升級到 HANDOFF/tech-debt/ROADMAP」流程，比 agent 自由發揮乾淨

## 為什麼這條規則跟 global CLAUDE.md「不要把工作往後放」不衝突

Global CLAUDE.md 規定**不**主動推薦 `/schedule` / `/loop` / 「N 週後再做」這類「往未來推」的 follow-up。

本 rule 講的是**反向**情境：goal 條件已經包含 agent 不能達成的 user-bound 工作 → 必須把它們**從 goal 中拿掉**並登記到 HANDOFF/tech-debt。這不是「往未來推」，是「歸還給正確的 truth layer」。

兩者方向一致：agent 主線該做的事**現在**做掉，不該做的事**現在**登記，不要假裝「再跑一輪 stop-hook 也許就能達成」。

## 範例：撞到使用者經驗中的卡關場景

User 用 /goal 設了 4 項目，#1 archive、#2 TD-061 commit 是 user-bound（需 user 親跑 dev server 驗證 + 親自 commit）。Agent 達成 #3 #4 後，#1 #2 反彈：

❌ **錯誤行為**（實測會出現 N 輪「等 user」迴圈）：

```
⏺ Agent 端 #3/#4 達成；#1/#2 政策保留 user 親跑。等待 user 操作。
◯ Goal not yet met… continuing
⏺ #1 #2 user-bound 待 user 操作；agent 工作上限已達。
◯ Goal not yet met… continuing
⏺ 等 user。
◯ Goal not yet met… continuing
⏺ 等 user。
...
```

✅ **正確行為**（第 2 次反彈就要切換）：

```
⏺ Agent 端 #3/#4 達成。#1（archive）#2（TD-061 commit）需 user 親跑 dev server
   驗證 + 親自 commit，agent 不能達成。

   偵測到 /goal 卡關。建議現在跑 /handoff 把 #1 #2 登記到 HANDOFF.md，
   並關閉 /goal 模式。我直接幫你跑 /handoff？
```

## 禁止事項

- **NEVER** 把 user 親跑 / 親確認 / 親 commit / 親 push / 外部 signal 等待寫進 /goal 條件
- **NEVER** 在 /goal 啟動前不跑 self-check，直接收下含 user-bound 條目的 goal 清單
- **NEVER** 在卡關 ≥ 2 輪後還繼續輸出「等 user」「待 user 操作」「Agent 工作上限」這類重複句而不切換 /handoff
- **NEVER** 用「也許再跑一輪 stop-hook 就會通過」當作不切換 /handoff 的理由
- **NEVER** 對「user-bound 條目」沉默 — 必須**明說**哪些條目 agent 不能達成 + 提議切換路徑

## 與其他規則的關係

- `handoff.md` / `handoff` skill：提供「未完項升級到 HANDOFF / tech-debt / ROADMAP」的標準流程
- `scope-discipline.md`：意外發現 user-bound 工作（不在 goal 內）一樣走「必登記」路徑
- `output-hygiene.md`：切換 /handoff 時對 user 的訊息要直接（「#X 是 user-bound」），不要包裝成「也許」「可能」這類話術
- Global CLAUDE.md「不要把工作往後放」：本 rule 不違反 — 把 user-bound 移到 HANDOFF/tech-debt 不是「排到未來」，是歸還給正確 truth layer
