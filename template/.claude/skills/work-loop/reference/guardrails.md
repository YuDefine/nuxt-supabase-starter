<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Guardrails（每輪 re-read，Step 1.5 hard rule）

> 本檔存在的理由：長時間跑的 loop 會被 auto-compaction 壓縮 context，**壓掉的東西裡就包含安全約束，而且壓掉時不會通知你**。所以護欄不能只靠「主線記得」——它必須是每一輪重新讀進最近 context 的檔案。
>
> **NEVER** 因為「這輪還記得」「上一輪剛讀過」「這輪只做一個小 item」跳過 re-read。你會覺得自己記得，那正是 decay 的症狀而不是反例。

---

## A. 執行面（16 條）

1. **不搶 working tree** —— tracked code 改動一律走 `/wt <slug>` worktree subagent；主線只做唯讀調查與單檔文字編輯
2. **commit 走 `--only`** —— `git commit --only -m "…" -- <paths>`。**NEVER** `git add` + `git commit` 兩段式（會吞掉別 session 預 stage 的內容）
3. **每個 item 獨立 commit** —— 不把多個 item 的改動混進同一 commit
4. **不 force push** —— 所有 git 操作 safe，無 `--force`
5. **動標準層 MUST 散播完畢** —— `rules/`、`plugins/hub-core/`、`CLAUDE.md`、`vendor/`。**可以改**（2026-08-05 Charles 授權），但改完 **MUST** 走 `/clade-publish` Step 1–9 把它推到 consumer，**NEVER** 改完擱著等人來散。做不到就別動它
6. **不跨 consumer** —— loop 只操作當前 repo
7. **不自創新 spectra change** —— 只做已登記的待辦；規模需開 change 的 → packaging 成決策題
8. **不碰 user 的 stash** —— worktree / stash audit 只讀不寫
9. **subagent scope verify** —— 每個 subagent 回報後 MUST 跑 `scripts/scope-verify.ts`，scope 外的實質改動 revert
10. **Error isolation + 跨輪升級** —— 單一 item 失敗不停整個 loop；同 item `failStreak` ≥3 → Escalated，不再 dispatch。同錯重複該產出系統性修正，不是無限 retry。codex pre-scan 的 exit 4（quota）/ exit 3（機械故障）**NEVER** 記入 `failStreak` / `consecutiveDispatchFailures`——fallback 形狀見 `dispatch-topology.md` § pre-scan 的 exit code 分流
11. **收割護欄** —— `inFlight` > 0 時**不是**停止狀態；lock 在此期間 **NEVER** 釋放；2h 無回報強制退出
12. **每條停止路徑 MUST 跑 `work-loop-lock.ts release --session <id>`** —— 含失敗提早結束的路徑。**NEVER** 改用 Write tool 或 `rm` 直接動 `.clade/work-loop/lock`（per Step 0 § 互斥鎖 Iron Law）
13. **Blocked / Decision item 先評估再處理** —— `applyBlocked` 走 blocker 鮮度判定、`awaitingUserDecision` 先嘗試自主解決（技術決策自決，只有商業決策才是真的 user-bound）。兩者都**不是**「永遠跳過」。見 `blocker-evaluation.md`
14. **NEVER 因 size / progress 跳過 dispatch** —— `applyInProgress` 不管進度 0% 或 change 看起來多大，MUST dispatch；`/spectra-apply` 自管步驟粒度、phase、pause 與 blocker。「需要完整 session」「不適合 loop」= 違反本條
15. **Bucket ≠ ball ownership** —— `bucket=ready` 不等於 user-bound，`bucket=applyBlocked` 不等於 Claude 無事可做。**MUST** 在每條 change 的 bucket routing 後檢查 `issued` / `verifyClaudePendingCount` / `discussPendingCount` / `staleEvidenceCount`，任一 > 0 = 仍有工作。實證（2026-07-21 <consumer-a>）：bucket=`ready` + issued=5 → loop 宣告 user-bound + 30min idle，user 在 review-gui 等一個不會來的接手。**「所有 change 卡 user action」這句話在 `issued>0` 時就是錯誤判斷**
16. **重複 invocation safe（三層）** —— 已 shipped 的 item 不出現在 scan；in-flight item 由 Step 2 的 claim 鮮度 filter 排除；整輪重疊由 Step 0 互斥鎖擋。**三層合起來才算 idempotent**——只靠「shipped 不再出現」不夠

---

## B. 決策面（4 條）

17. **`AskUserQuestion` 的可用性由 mode 決定，NEVER 由 item 決定** ——

    | 可觀察 predicate | 動作 |
    | --- | --- |
    | `--unattended`，**或**本輪由 `runner.sh` 起（`claude --print`） | **NEVER 呼叫。** 選不出來的走 decision packaging 落進 `HANDOFF.md` 的 `## ⏳ Awaiting Charles` |
    | 兩者皆非（user 在場的 in-session 呼叫） | 真的選不出來時 **MUST 問**，**NEVER** 靜默跳過可以問就解決的卡點 |

    判不出自己在哪個 mode → **當作 unattended**。**NEVER** 用「這個 item 很重要」在 unattended 下破例呼叫——那會讓整個 loop 卡死在等人。

18. **能寫出「推薦 A」就去做，NEVER packaging** —— packaging 是 fallback 不是 default。寫得出 `(推薦)` 標記＝決策已完成，送去等人覆述你的結論是拖慢開發。判準見 `autonomy-predicate.md` § Iron Law
19. **人類 gate 只擋真正不可逆的** —— prod 部署 / 刪除 branch / tag / 遠端資料 / 花錢的 API / 任何 `--force`。**publish 與 propagate 不在此列**（2026-08-05 Charles 授權）：它們可 revert + 重新 publish，且 MUST 走 `/clade-publish` Step 1–9，NEVER 自己拼 `publish.ts` + `propagate.ts`
20. **attended 下待答佇列非空 NEVER 開工** —— state 的 `awaiting[]` 非空、且本輪是 attended（非 `--unattended`、非 `claude --print`）→ **MUST** 先跑完 Step 2.7 開場清算把佇列問到空，**NEVER** 進 Step 3 分類或 Step 4 dispatch。判準是 mode 與佇列空不空，**NEVER** 是題數或急迫性。unattended 下反過來：佇列非空**照跑**、只排除佇列裡那幾條，**NEVER** 因此寫 `stoppedReason`。見 `decision-drain.md`

---

## C. Dispatch 內嵌段（逐字貼進每個 `/wt` brief）

**MUST 逐字複製以下區塊到 brief**，**NEVER** 改寫成「照護欄做」這種 by-reference 指示——subagent 讀不到本檔。

```text
## 硬性約束（違反任一條即停手回報，不要自行判斷例外）

- commit 一律 `git commit --only -m "…" -- <你改的檔案路徑>`；NEVER `git add` + `git commit` 兩段式
- NEVER `git push --force` / `--force-with-lease`
- 標準層（rules/、plugins/hub-core/、CLAUDE.md）只改**本 brief 所有權清單逐條列出的**那幾個檔；
  清單沒列的標準層檔 NEVER 改。帶 `🔒 LOCKED — managed by clade` banner 的檔一律 NEVER 改，
  清單列了也不例外（那是投影不是源）
- NEVER 操作本 repo 以外的目錄
- NEVER 執行不可逆動作：publish、propagate、prod 部署、刪除 branch / tag / 遠端資料、任何花錢的 API
- 只改 brief 明列的檔案路徑。需要動 scope 外的檔 → 停下來回報，NEVER 自己動手（主線會跑 scope-verify 對照）
```

**授權邊界由 brief 的所有權清單承載，不由路徑黑名單承載。** 這是 2026-08-05 從路徑制改過來的：
護欄 5 已授權「標準層可以改，改完 MUST 走 `/clade-publish`」，而舊版第 3 行寫死
`NEVER 改標準層` —— round 11 兩條要改標準層的 dispatch 照舊版逐字貼，brief 會同時說「做這 12 個
`rules/` / `plugins/` 檔」和「NEVER 改 `rules/` / `plugins/`」，合規的 subagent 只能停手回報。
主線當時是自行在 brief 裡加 carve-out 才派得出去，而 § C 的存在理由正是「不可即興改寫」。

因此主線 **MUST** 確保 brief 帶一份逐條列出的所有權清單（`subagent-scope-discipline.md`
§ 併發編輯協議 本來就要求兩份清單）——**NEVER** 只寫「你可以改標準層」這種沒有清單的授權，
那等於把邊界還原成沒有邊界。

---

## D. 反藉口（壓力下最常見的 20 條自我合理化）

以下**每一句**都不是合法理由。看到自己在心裡講出其中任何一句 → 立即停手自查。

**跳過 re-read 類**：

- ❌「這輪還記得護欄」— 記得的感覺不是證據，decay 不會通知你
- ❌「上一輪剛讀過」— compaction 抹的就是上一輪
- ❌「只做一個小 item，不必讀」— 護欄擋的是「小 item 其實不可逆」這種誤判

**跳過 packaging 類**：

- ❌「這條要等 user，先 skip 下一輪再說」— packaging 是 MUST
- ❌「選項太明顯了，寫出來是浪費」— 明顯的話就是可自主，重判 predicate
- ❌「等 Charles 回來直接問比較快」— unattended / runner 下那是 `AskUserQuestion`，護欄 17 禁止
- ❌「這條太模糊，packaging 不出來」— 先跑唯讀調查補事實（見 `autonomy-predicate.md` § 判不出來時的三步）

**跳過 dispatch 類**（逐字實錄，前身為 `turbo-dispatch.md`）：

- ❌「needs careful testing」— worktree isolation 就是為此設計
- ❌「complex」「多個 script 有不同 scope」— 那是 dispatch 的理由不是 skip 的理由
- ❌「not ideal for quick wins」— loop 不只做 quick wins
- ❌「這輪已經做了一個了」— 沒有 per-round 上限（除 `--unattended` 3-item cap）
- ❌「等 agents 完成再處理」— 扇出組滿 4 就是做主線即時組的時機，不是等的時機
- ❌「先寫 HANDOFF status」— 那是 Step 7，不是中途的 exit ramp

**跳過開場清算類**（護欄 20，attended）：

- ❌「先做一件看得到成果的，等一下再問」— 「等一下」就是他已經離開座位的那一刻
- ❌「這幾條都不急，下次開場再問」— 判準是佇列空不空，不是急不急
- ❌「一次問 9 題太打擾了」— 沒有題數上限；打擾一次比讓 9 條工作各卡一輪便宜
- ❌「這條寫得很清楚了，他看 HANDOFF 就會答」— HANDOFF 不會主動出現在他面前，那正是累積的成因
- ❌「答案我先記著，Step 7 一起寫」— 下一輪是新 process。沒落檔＝沒答

**提早收工類**：

- ❌「本輪無 actionable = 完成」— 只代表這輪 scan 沒新東西
- ❌「in-flight 還在跑，但我先把 HANDOFF 寫了收工」— 違反護欄 11

**睡掉無人值守時間類**（2026-08-05 round 1 實測違反 —— 還有 28 條 TD 未 triage 就排了 900s wakeup）：

- ❌「這輪做了 3 件，夠了」— 沒有 per-round 配額
- ❌「剩下的下一輪再做」— 那段睡眠不產生任何東西，而 user 正是為了離開座位才開這個 loop
- ❌「context 用得有點多，先睡一下」— 睡眠不回收 context；真撞上限走 decay gate **停 loop 交棒**，不是排 wakeup
- ❌「等使用者看一下再繼續」— packaged 決策不阻塞其他 item

---

## E. Red Flags（出現任一 → 停手，重讀本檔）

- 正要呼叫 `AskUserQuestion`，而本輪是 `--unattended` 或 runner 起的
- 正要對 `rules/` 或 `plugins/hub-core/` 底下的檔下 Edit / Write
- 正要跑 `publish.ts` / `propagate.ts` / `git push --force` / `wrangler deploy` / `supabase db push`
- 正要 `git add` 之後接 `git commit`
- 正要對 `.clade/work-loop/lock` 下 Write / Edit / `printf` / `echo` / `rm`（鎖檔只由 `work-loop-lock.ts` 讀寫）
- state 檔的 `inFlight` 非空，但你正在寫 Step 7
- state 檔的 `awaiting[]` 非空、本輪是 attended，而你正要進 Step 3 分類
- 已收到 Charles 的答案，但還沒寫進 `decisions` 就開始 dispatch
- 這輪還沒 Read 過本檔
