---
name: work-loop
description: "Use when 使用者要把待辦自主推進（「自動推」「把待辦跑完」「無人值守推進」）——spectra change、HANDOFF、tech-debt、ROADMAP 全在 scope 內，或 runner.sh --unattended fire。NOT for 單次盤點交接（用 /handoff）、逐項拍板（用 /goal）、interval 盲跑（用 /loop）。"
effort: xhigh
metadata:
  author: clade
  version: "3.0"
permission_tier: action
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# /work-loop — 待辦自主推進迴圈

> 2026-08-05 由 `/change-loop`（含 `--turbo`）與 `/handoff-loop` 合併而成。舊名已移除，無相容 stub。

本 skill 是 loop 四型分類中的 **proactive loop**——trigger 交給 `runner.sh` 或 `/loop`，工作清單交給 scan 自己找。四型分類與通用方法論見 cookbook `vendor/snippets/loop-engineering/`。

**沒有「走哪一支」的判定。** repo 有沒有 `openspec/`、待辦是 spectra change 還是 tech-debt 條目，都由 Step 2 的 scan 結果決定路由——無 `openspec/` 的 repo 掃出來的 spectra 段就是空的，**這是正常的，不是 scan 失敗**。

核心 contract：**每次被叫起來，把待辦盡可能推到「已完成」「可驗收」或「已備妥決策選項」狀態。能自主決策的自主完成；必須人拍板的 NEVER 直接 skip——MUST 走 § Decision packaging 推進到「一句話就能答」的狀態。**

**Output contract**：loop 的 output 是**進度報告**，不是 user call-to-action。

- ✅ 「`<change>` 標 🟢 ready-for-review（寫入 HANDOFF）」「TD-317 已修並 commit `a1b2c3d`」— 報告事實
- ✅ 「本輪處理 3 items：2 completed / 1 packaged。fingerprint 已變，續跑」— 報告進度
- ❌ 「待 user 驗收：請執行 `pnpm review:ui`」— user call-to-action
- ❌ 「待 user 決定：TD-402 要用 A 還是 B？」— 決策要落 `awaiting[]` + HANDOFF `## ⏳ Awaiting Charles`，不是 chat 敘述（attended 下由 Step 2.7 用 `AskUserQuestion` 端出去問）
- ❌ 「下一輪可推進：1. ... 2. ...」— 列選單讓 user 決定

---

## Step 0 — Mode detection、lock、continuous invocation

```text
$ARGUMENTS
```

### Flags

- `--unattended`（`runner.sh` 每輪固定帶）：**3-item cap**（避免 runaway）+ **禁止 `AskUserQuestion`**。不帶時無 item cap，改由 Step 6 的 round cap / fingerprint 控制。
- `--runner-child`（只由 `runner.sh` 帶）：模型可見的 runner child 身分 marker；`WORK_LOOP_RUNNER_CHILD=1` 是同一身分的機械補強。
- `--min-wakeup-seconds <n>`（`runner.sh` 每輪固定帶，預設 1200；`WORK_LOOP_MIN_WAKEUP_SECONDS` 是機械補強）：本輪**每一個** `ScheduleWakeup` / `Monitor` 的 interval **MUST ≥ n**。帶了它就以它為準，**NEVER** 因為「這次只等一下下」用更短的值——短輪詢買不到 notification 沒給的東西（Step 0 § (d) 已逐字禁止輪詢進度）。不帶時各處原有的 interval 建議照舊。
- 使用者說「自動推」「把待辦跑完」「持續做」「不要停」「無人值守」→ 等同要求 continuous（見下）。

**沒有 `--turbo`。** 非 spectra 待辦（HANDOFF / tech-debt / ROADMAP）是**預設 scope**，不需要任何 flag 開啟。

### Iron Law：runner child 永遠只執行單輪

`$ARGUMENTS` 含 `--runner-child`，**或**本 process 的 runner 身分是 `WORK_LOOP_RUNNER_CHILD=1` → 直接進 Step 1，執行一次 Step 1–7 後退出。**NEVER** 進入本 Step 後面的 continuous route 判定、**NEVER** 啟動 `runner.sh`、**NEVER** 呼叫 `/loop`。

marker 有兩層是刻意的：prompt 裡的 `--runner-child` 讓模型必定看得見；env 身分讓 shell fixture 與診斷能機械驗證。任一層存在都已足以判定，**NEVER** 因另一層讀不到就把 child 當成直接呼叫。

| Red Flag | 立即動作 |
| --- | --- |
| arguments 已有 `--runner-child`，卻正在比較「runner 還是 in-session」 | 停止 route；這就是 runner 已啟動的 child，直接跑單輪 |
| 正要從 runner child 呼叫 `runner.sh` 或 `/loop` | 停止；完成本輪 Step 1–7 後退出 |

### Iron Law：`AskUserQuestion` 的可用性由 mode 決定，不由 item 決定

| 可觀察 predicate | `AskUserQuestion` |
| --- | --- |
| `--unattended` 帶了，**或**本輪由 `runner.sh` 起（`claude --print`） | **NEVER 呼叫。** 選不出來的一律走 § Decision packaging 落 HANDOFF |
| 兩者皆非（user 在場的 in-session 呼叫） | 真的選不出來時 **MUST 問**，**NEVER** 靜默跳過可以問就解決的卡點 |

判不出自己在哪個 mode → **當作 unattended**（保守側是不打斷不在場的人）。

**這條分岔的理由是「人在不在場」，NEVER 是「這個 item 重不重要」。** 重要的 item 在 unattended 下同樣走 packaging——破例呼叫 `AskUserQuestion` 會讓整個 loop 卡死在等人。
同一條 mode predicate 也決定 Step 2.7 開場清算跑不跑：attended 跑完整清算（佇列清空才開工）、unattended 只跑 prune。細節見 [reference/decision-drain.md](reference/decision-drain.md) § Mode 分岔。

### 兩種跑法 —— 無人值守優先選 runner

無人值守走 `runner.sh`（每輪一個 `claude --print` process，context 歸零，連續性靠 state 檔）；
只想跑一兩輪或要邊看邊介入才用 in-session `/loop /work-loop`。

**決定怎麼起這個 loop 時 MUST 先讀 [reference/run-modes.md](reference/run-modes.md)** 取兩種跑法的完整對照、runner 指令與 flag、以及 in-session 版為什麼有 context 天花板。**NEVER** 因為「in-session 比較好觀察」就對長清單用 in-session 版——runner 每輪都留 log，觀察性沒有損失。

### 開場佇列檢查（在 route 判定之前）

route 表判定**之前** MUST 先讀 state 的 `awaiting[]` 長度——只讀這一個欄位，不做完整 re-hydrate（那是 Step 1 的事）：

```bash
node -e '
const fs=require("fs");let s;
try{ s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")) }
catch(e){ console.log(e.code==="ENOENT"?0:"STATE_CORRUPT"); process.exit(0) }
console.log(Array.isArray(s.awaiting)?s.awaiting.length:"STATE_CORRUPT")
' "$(git rev-parse --show-toplevel)/.clade/work-loop/state.json"
```

**只有 `ENOENT` 才是 0。** parse 失敗、或 `awaiting` 不是 array，一律回 `STATE_CORRUPT` —— **NEVER** 把它們也折成 `0`。折成 0 會讓損毀的 state 判成「佇列空」直接 route 到 runner，而 runner 的 child 恆為 unattended、只跑 `(a) prune`，於是**唯一**的出列動作永遠不會執行。那正是本節要修的佇列滯留，只是換成由讀取端製造。

| 可觀察 predicate | 動作 |
| --- | --- |
| 回 `STATE_CORRUPT` | **STOP，NEVER 進 route 表。** 先走 Step 1 § 讀取端的三步還原程序 |
| user 直接呼叫（非 `--unattended`、非 `--runner-child`）**且** `awaiting[]` 非空 | **NEVER route 到 runner。** 先在本 session 走 Step 2.7 (a)(b)(c) 清算，佇列清空後才回到 route 表 |
| 其餘（從 `/loop` 進來、`--unattended`、`--runner-child`） | 照 route 表，本步不動作 |

**理由**：attended 清算是佇列**唯一**的出口（unattended 只跑 `(a) prune`），route 到 runner 之後主線從不進 Step 2.7——佇列因此單調遞增（2026-08-12 實測積到 19 輪）。

**清算是有界的**：幾個 `AskUserQuestion` 就結束，清完之後仍照 route 表與 headroom 判定決定待辦由誰承載。**NEVER** 拿「這個 session 快滿了」當跳過清算的理由，**也 NEVER** 把「runner 起跑時會印一行待答提示」當成出口——那條提示印在 runner 的 log 裡，而打 runner 的前提就是 user 離開座位，佇列照樣積到 19 輪。

本證據決定：佇列非空時要不要先清算——要。
本證據不決定：待辦由誰承載——清算完仍照 route 表判，**NEVER** 拿它論證「所以該用 in-session 跑待辦」（那會退回 [[pitfall-work-loop-in-session-default-has-no-context-headroom]] 的 context 空轉）。

### Continuous invocation（hard rule）

單次 `/work-loop` = 一輪 scan → 分類 → dispatch/packaging → 收割 → 寫狀態。**一輪不是完成。**

- **直接呼叫**（非從 `/loop`、非 `--unattended`、非 `--runner-child`）→ **NEVER 自己跑完一輪就停**。先照下表 route 到承載這個 loop 的跑法，**NEVER** 無條件選 in-session：

  | 可觀察 predicate | route 到 |
  | --- | --- |
  | user 訊息帶無人值守意圖（「自動推」「把待辦跑完」「持續做」「不要停」「無人值守」），**或** 本輪 scan 出的 candidate 多到一個 session 跑不完 | **`runner.sh`** —— 主線**自己起**，形狀照 § 起 runner 的形狀與收尾契約 |
  | user 明說只跑一兩輪、或要邊看邊介入 | in-session `Skill invoke: /loop /work-loop`（dynamic mode，自我 pace） |
  | 判不出來 | **`runner.sh`** —— 主線**自己起**；保守側是續航力，不是觀察便利 |

  **route 判準是「這個 loop 要跑多久」，NEVER 是「哪個叫得比較順手」**（實測與另一半理由見 [reference/run-modes.md](reference/run-modes.md) § 為什麼 in-session 版有天花板）。
- **從 `/loop` 呼叫**（正常路徑）→ 每輪結束**先判「現在還有沒有事做」，再決定要不要排 wakeup**：

  | 可觀察 predicate | 動作 |
  | --- | --- |
  | candidate list 還有**未 triage** 或**已判自主但未執行**的 item | **NEVER 排 wakeup。立刻接著跑下一輪**（同一個 turn 內連續跑，不睡） |
  | in-flight ledger > 0，且扇出組還有空位 | **NEVER 排 wakeup。** 補 dispatch，或做主線即時組的工作 |
  | in-flight ledger > 0，扇出組已滿、主線即時組已空 | 排 wakeup 當 notification 的安全網——interval 取 60–180s，但**帶 `--min-wakeup-seconds <n>` 時取 n**（下限壓過本列的建議值） |
  | 尚未命中 Step 6、所有當前 item 都不可推進（completed / packaged / escalated / legal-skip），**且** in-flight = 0 | 排 wakeup，長 interval（1200–1800s heartbeat）——這是**唯一**可以睡長的狀態 |
  | Step 6 停止條件成立 | `ScheduleWakeup({stop: true})`，**不得**再排 heartbeat |

  **Iron Law：`ScheduleWakeup` 是「現在無事可做」的宣告，NEVER 是「這輪做夠了」的休息。** 每一次排 wakeup 之前 MUST 能指出 candidate list 裡**每一個** item 現在都動不了、以及動不了的具體理由（已完成 / 已 packaging / 已 escalated / 命中 skip 窮舉 / 在等某個具名 notification）。指不出來就是還有事做，**接著跑**。

  本段由 `/loop` dynamic mode 自我續跑，所以 `ScheduleWakeup.prompt` **MUST** 保留同一份 `/loop /work-loop` prompt（autonomous dynamic 使用 `<<autonomous-loop-dynamic>>` sentinel）。這是 [[agent-routing]] § `/loop` dynamic 唯一 prompt-preserving 分支；下面 `runner.sh` heartbeat 與 background dispatch safety net 都是 generic async keepalive，MUST 改用 inert control message。

  逐條反藉口（「這輪做了 3 件夠了」「剩下的下一輪再做」等）見 [reference/guardrails.md](reference/guardrails.md) § D。

- **「完成」的定義**：Step 6 的停止條件任一成立。**NEVER** 把「本輪無 actionable item」當成完成——那只代表這一輪 scan 沒新東西，user 答完一條 packaged 決策後下一輪就會有。

### 開場 headroom 判定（在取鎖與 scan 之前）

route 表判完「這個 loop 由誰承載」之後、**跑 Step 2 的 scan 之前**，先判本 session 還有沒有餘裕跑完一輪：

| 可觀察 predicate | 動作 |
| --- | --- |
| 本 session 已收到過 context budget 提示（`session-context-budget-warn.sh` 的 300k / 500k 任一級） | **改走 `runner.sh`**——主線用 `Bash(run_in_background=true)` 起它，起跑形狀與收尾走 § 起 runner 的形狀與收尾契約 (a)–(e)（含 cache-keepalive heartbeat 與 per-round Monitor），回報 log 路徑後結束本輪。**NEVER** 先跑 scan |
| 本輪由 `runner.sh` 起（`claude --print`），**或** 本 skill 是本 session 的第一個工作段 | headroom 充足，照常取鎖進 Step 1 |
| in-session、本 session 已做過別的工作、但還沒收到提示 | 照常進 Step 1，但 route 表「判不出來」那列**改判為 `runner.sh`**——餘裕不明時保守側是換載體 |

**NEVER** 用「先掃一輪看看有什麼再決定」把本步挪到 scan 之後——scan 與 guardrails re-read 是一輪最先燒掉的固定成本，而它們的產出在「沒餘裕做事」時完全用不到。

**改走 runner 是換載體，NEVER 是 skip。** 不寫 `stoppedReason`、不進 § Skip 合法理由窮舉，待辦原封不動留給下一個 process。判完就**立刻**起 runner，**NEVER** 只在輸出裡建議 user 自己去跑（Output contract 逐字禁止的 user call-to-action）。

**NEVER 自行放寬門檻**：門檻值是 [[session-tasks]] § Session context 預算 的 predicate 7 項目，想調鬆它的正是已經超標的那個 session。本步只讀「提示有沒有出現」，不讀也不改門檻數字。

### 起 runner 的形狀與收尾契約

route 表判到 `runner.sh` 之後（含 headroom 判定改判過去的那條），起跑與收尾**全部由主線扛完**：user 不需要自己跑任何指令、不需要輪詢進度、不需要來問它停了沒。

#### (a) 起跑形狀（hard rule）

**MUST** 用 `Bash(run_in_background=true)` 起，指令是 [reference/run-modes.md](reference/run-modes.md) 的絕對路徑形式：

```text
Bash(run_in_background=true):
  cd <目標 repo> && ~/offline/clade/plugins/hub-core/skills/work-loop/runner.sh --max-rounds 20
```

**NEVER** 在該指令裡加 `nohup`、`disown` 或尾綴 `&`。`runner.sh` 是前景同步跑（每輪 `claude --print` 跑完才進下一輪），harness 正是靠這點追蹤它、並在它退出時回頭叫醒主線。自行背景化 → Bash call 立刻返回 → harness 判定已結束 → 真正的 runner 成為無人追蹤的孤兒，**收尾通知永遠不會到達**。這是**靜默**失敗：起跑當下零異常訊號，log 照寫、round 照前進，看起來一切正常。

起完 **MUST** 回報 log 目錄、依 (d) 排一次 cache-keepalive heartbeat、依 (e) arm 一個 per-round Monitor，然後結束本輪。三件都做完才算起跑完成。**NEVER** 在主線空等。

**NEVER** 排 wakeup 去**讀 state 檔或 round log 找進度**——退出通知由 harness 送達，輪詢買不到任何它沒給的東西。

**「NEVER 輪詢」不蘊含「NEVER 醒來」**：前者禁的是醒來後**做**的那件事（讀 state / log / 貼進度），後者是 (d) 要求的動作本身（[[pitfall-work-loop-runner-silence-expires-prompt-cache]]：靜默 119 分鐘跨過 cache TTL）。

#### (b) 收尾回報契約

runner process 的退出通知到達時 **MUST 主動回報，不等 user 問**。這不是 Step 5 的收割對象（那管的是 subagent 的 `<task-notification>`），走本節。

**每一次**回報 MUST 含以下四項，缺一不算回報完成：

1. 最終 round 數（runner 尾巴的 `runner 結束 —— 最終 round=<n>`）
2. `stoppedReason`——有印就照抄，沒印就明說「沒有 `stoppedReason`」
3. log 目錄路徑
4. **停止原因屬於下表哪一列**——這項決定 user 要不要再起一輪，是四項裡唯一不能靠貼 log 代替的

#### (c) 四種停止原因（逐字對照 `runner.sh` 的停止分支）

| runner 印的 | 語義 | 回報 MUST 說 |
| --- | --- | --- |
| `== stop: <reason>`，且 reason 來自 state 的 `stoppedReason` | 正常收工 | 待辦已推完 |
| 迴圈跑滿 `--max-rounds`（**沒有** `== stop:` 行） | 額度用完，**不是**做完 | 待辦還在，需再起一輪 |
| `== stop: 連續 2 輪 exit≠0` | 系統性故障 | **異常中止** + log 路徑 |
| `== stop: state 連續 2 輪未前進` | child 正常退出但 state 沒前進 | **異常中止** + 那幾輪沒寫進 state |
| `== preflight 未通過`（exit 3） | 起跑前探針就不過，**一輪都沒跑** | **環境故障**：逐字轉述探針給的理由 + `preflight.log` 路徑。**NEVER** 直接補 `--skip-preflight` 重跑——那是把探針抓到的問題蓋掉 |
| `== 待辦枯竭`（exit 4） | 推得動的待辦少於門檻，**一輪都沒跑** | **不是故障**：說「待辦枯竭，需 attended 補彈藥」+ 印出的 ready 數。**NEVER** 回報成待辦已推完 |

#### (c.1) 連續未前進的 ownership 分流（hard rule）

| 可觀察 predicate | 父層 MUST |
| --- | --- |
| runner 是**本 session** 依 (a) 啟動、background Bash task id 已記錄，且 task 狀態仍是 running | 自主 `TaskStop(<runner task id>)`，再停止 (e) 的 Monitor；讀最後兩輪 log、state 與 lock holder，找出未前進 root cause 並直接修復。**NEVER** `AskUserQuestion`、**NEVER** 把停止責任推給 user |
| runner 是本 session 啟動，但退出 notification 已把 task 標成 completed / failed | runner 已停止，不再對 completed task 呼叫 `TaskStop`；停止 (e) 的 Monitor後立刻做同一套 log/state/lock 調查。**NEVER** `AskUserQuestion` |
| task id / 啟動 session 無法確認，或可確認 runner 屬於別 session | 先 `AskUserQuestion` 確認 ownership，**NEVER** 擅自 `TaskStop`、刪 lock 或接管 |

**Iron Law：本 session 親自啟動的 runner，就是本 session 的 child。違反字面就是違反精神**——「不知道停了會不會有副作用」「先問一下比較保險」都不成立；harness task id 就是 ownership 證據。只有 ownership 不明或屬別 session 才問。

**Red Flag**：看到 `state 連續 2 輪未前進` 後正要把 log 路徑貼給 user、但尚未依 task 狀態停止 running runner（或確認它已退出）並調查最後兩輪——停下，先走本節 ownership 表。

**只有第一列是「跑完了」，其餘每一列都不是。** **NEVER** 把其中任何一列回報成待辦已推完，**也 NEVER** 只摘成功的那幾輪而不提中止——runner 每輪成功都印 `✓ round <n> 完成`，只讀那些行會產出一份看起來順利的假報告。命中 `連續 2 輪 exit≠0` 或 `state 連續 2 輪未前進` 時 **MUST** 一併附 `tail -20 <最後一個 log>`；命中 `preflight 未通過` 或 `待辦枯竭` 時沒有 round log 可附，改附 `preflight.log` 的最後一行。

#### (d) cache-keepalive heartbeat（MUST）

`--max-rounds 20` 可能跨越 prompt-cache TTL，而主線從起跑回報到退出通知之間可能**一次都不醒**。conversation context 掉出 1 小時 TTL 後，user 下次接手會重付 input token。這筆成本在 log 層面零訊號——round 照前進、`✓` 照印，看起來一切正常。

起跑回報完成的**同一個 turn 內** MUST 排一次；`<task-id>` 是 background Bash 回傳的 harness task id，`deadline` = 起跑後 9 小時。prompt 與 control-turn 分流一律使用 [[agent-routing]] § Generic async keepalive prompt 的 canonical 形狀，`owner=work-loop-runner`、interval=3300s。

**Iron Law：keepalive prompt 只能判活、重排或收割。** 判活的唯一手段是查 harness task 狀態，**NEVER** 讀 log / state / process table 代替。原任務若含共享資源修改，尤其 publish / propagate，**NEVER** 把原 prompt 或任何可重放原任務的摘要塞進 `ScheduleWakeup`——禁止重複原任務、publish、propagate 或寫檔。

| 可觀察 predicate | 動作 |
| --- | --- |
| `TaskOutput(block=false)` = running，且未到 deadline | 重排同一個 3300s control prompt，本 turn 結束。**NEVER** 讀 state、**NEVER** 讀 log、**NEVER** 貼進度 |
| terminal | 停 heartbeat，排一次 `ASYNC_LIFECYCLE_HANDOFF task=<id> owner=work-loop-runner cause=terminal`；handoff 一般 turn 先 claim task id，**先 `TaskStop` per-round Monitor**，再讀 result、分類 (c)、必要時取 `tail -20`，最後走 (b) 回報 |
| deadline / unknown | 依 [[agent-routing]] § Generic keepalive 醒來只做控制面動作 保留 ownership 進 deadline intervention；**確認 terminal 前 NEVER** 讀 result、回報完成或停止 Monitor |

**3300s 貼著 TTL 訂，NEVER 縮短。** TTL 是 3600s，3300 留 300s 餘裕且**只醒一次**就跨過；縮到一半就是每次長跑多付一倍喚醒成本，而每一次喚醒都是一個完整 turn。縮到幾分鐘更是 (a) 禁掉的輪詢換了個名字。

**heartbeat 醒來 NEVER 貼進度**，即使 [[TD-430]] 的原始修法草稿寫了「貼一行進度」。貼進度必須先讀 state 或 log，那正是 (a) 第二段獨立禁止的動作——該禁令的理由（輪詢買不到 harness 沒給的東西）不因為換了個觸發時機就失效。進度由 runner 退出時的 harness 通知或 lifecycle handoff 給，走 (b)。

本條是 [[agent-routing]] § 主線靜默上限在 runner 路徑的實例——`3300`、canonical prompt、task-id claim 與 control/handoff 邊界均以該 § 為 SoT。本節只留 runner 專屬差異：background Bash task id、9 小時 deadline 與 handoff 必須依 (c) 取足異常證據。

#### (e) per-round 進度回報（MUST，與 (d) 同一個 turn 內 arm）

(d) 保住 cache，但長跑期間 user 可能只看得到起跑與收尾兩則訊息。**每輪結束主動回報一行**，事件驅動、不輪詢主線：輪詢發生在 shell 端（零主線 turn），主線只在 round 真的前進時被 Monitor 事件叫醒。

起完 runner **MUST** 立刻 arm（`<repo>` 換成目標 repo 絕對路徑）：

指令原型在 [reference/run-modes.md](reference/run-modes.md) § per-round Monitor 指令原型——**照抄，NEVER 自己重寫一份**（相對路徑、tail log 兩個踩過的坑寫在那份的註解裡）。

| 契約 | 逐字 |
| --- | --- |
| 每輪 emit **一行，且該行 MUST 帶該輪成果摘要** | 內容固定為 `round <n> 完成｜<roundEndReason>｜<sessionNote 前 400 字>`。**NEVER** 貼 log 段落、**NEVER** 額外展開該輪細節——per-round 的 turn 成本壓在 cache_read 量級，400 字上限就是為此 |
| 主線收到該事件後 **MUST 轉述摘要**，不是只回「round N 完成」 | 逐字複述或濃縮 Monitor 那行的 sessionNote 段（**每一輪**都要，不是只在有異常時）——user 對 5–8 小時的 runner 只有這個可見度來源。摘要缺內容時 **MUST** 自己補讀：`node -e 'const s=require(process.argv[1]);console.log(s.sessionNote)' <repo>/.clade/work-loop/state.json`，**NEVER** 把「Monitor 沒給細節」當成可以只回一句「完成」的理由 |
| 失敗訊號要蓋到 | round 前進、`stoppedReason`、90 分鐘沒前進三種都 emit（per `Monitor` tool description § Coverage — silence is not success：只 grep 成功訊號的 monitor 在 crashloop 時與「還在跑」長得一模一樣） |
| 收尾 | runner 退出通知到達 → 走 (b) 回報，並 `TaskStop` 這個 Monitor。**NEVER** 讓它留到 session 結束 |
| 與 (d) 的關係 | **兩個都要**，不是二選一。round 通常 15–25 分 < 55 分，事件本身順帶維持 cache；但 round 卡住超過 55 分時，(d) 的 heartbeat 是唯一還會醒的東西 |

**這不是 (a) 禁掉的輪詢**：(a) 禁的是**主線**排 wakeup 去讀 state（燒主線 turn），本節的讀取跑在 Monitor 的 shell 裡，主線在 round 前進之前**零 turn**。
> **NEVER 改用 `CLAUDE_CODE_MESSAGING_SOCKET` 那條變體**，除非先驗掉 [reference/run-modes.md](reference/run-modes.md) § 未採用的變體 列的兩件事。

### 開場准入判定（headroom 之後、取鎖與 scan 之前；**每一輪**都跑，含 runner child 的每一輪，不是只有第一輪）

跑 `node ~/offline/clade/vendor/scripts/work-loop-ready-count.ts --repo "$(git rev-parse --show-toplevel)" --json`，依下表分流：

| 可觀察 predicate | 動作 |
| --- | --- |
| `inFlight` 非空 | **准入**（有收割工作），本節其餘列不再判 |
| `debtReady >= 1` | 准入，照常取鎖進 Step 1 |
| `debtReady == 0` 且 `awaiting[]` 非空且 attended | 准入，但本輪只做 Step 2.7 清算，**NEVER** dispatch 新工作 |
| `debtReady == 0`（其餘情況） | **不准入**。寫 state `stoppedReason: no-admissible-work`（走 Step 7.3 正常寫入路徑，允許只寫這一個欄位），**NEVER 取鎖、NEVER 跑 scan**，結束本輪 |

**不准入是收工，NEVER 是 skip**：沒有 item 被標記、沒有 `⏸ Skipped` 條目——`debtReady == 0` 的意思是
**沒有 item 存在**。回報措辭 MUST 是「**無可推進的債**（debtReady 0），需 attended 補彈藥或等 audit /
digest signal」，**NEVER** 回報成「待辦已推完」。**NEVER 為了讓 `debtReady >= 1` 而登記新 TD**、**NEVER
用「掃一輪看看」繞過本節**、**不准入時 NEVER 排長間隔 wakeup**——四條的實測依據見
[reference/productivity-gate.md](reference/productivity-gate.md) § 准入。

### 互斥鎖

單輪可能耗時數小時，無鎖會讓下一次觸發疊上第二輪。進 Step 1 前 **MUST** 跑：

```bash
node ~/offline/clade/vendor/scripts/work-loop-lock.ts acquire
```

| exit | 輸出 | 動作 |
| --- | --- | --- |
| 0 | `acquired` / `took-over` / `reentrant` ＋ `WORK_LOOP_SESSION_ID=<id>` | 把 `<id>` 記進 state 的 `lockSessionId`，進 Step 1 |
| 3 | `work-loop already running (…)` | **逐字照抄那一行輸出後結束本輪**，不做任何其他事 |
| 1 | `error: …` | 與 Step 2 scan 失敗同級：STOP，直接結束本輪 |

**Iron Law：鎖檔只由這支 script 讀寫。違反字面就是違反精神**——「用 Write tool 補一個就好」「script 跑不動先手寫一個」都不算遵守。

- **heartbeat**：**每一次**寫 `.clade/work-loop/state.json` 的同時都 MUST 跑 `node ~/offline/clade/vendor/scripts/work-loop-lock.ts refresh --session <id>`（Step 1 / Step 5 **每一次**收割 / Step 7 各一次，不是只在 Step 7 刷）。窗口 45 分鐘
- **釋放**：**每一條**停止路徑（含失敗提早結束）都 MUST 跑 `node ~/offline/clade/vendor/scripts/work-loop-lock.ts release --session <id>`；in-flight ledger > 0 期間 **NEVER** 釋放
- **Budget 計數器歸零（定義「一次 run」的唯一位置）**：`acquire` 回 `acquired` 或 `took-over` = **一次新的 run 開始** → 本輪 Step 7 寫 state 時 MUST 把 `subagentsSpawned` **歸零重新起算**；回 `reentrant` = 同一個 run 續跑 → **沿用**既有值，**NEVER** 歸零。這讓 Step 6.2 budget proxy 的兩半（`subagentsSpawned` 與 `lock timestamp`）字面共用同一個窗口定義

**NEVER 把歸零改掛在 `runner.sh` 起跑。** 兩條理由：in-session `/loop` 沒有 `runner.sh`，掛那裡會讓同一條停止條件在兩種 run mode 語義分裂；且 `runner.sh` 的分工是「不碰 state 內容、連續性全由 child 承擔」，歸零屬於 state 內容。鎖的 acquire 已經是「一次 run」的天然邊界，用它不必另外定義窗口。

判準是**析取**——`heartbeat 在 45min 窗口內` **或** `pid 存活`，任一成立即為 active。舊版單看 `$$` 的合取判準在 in-session 模式下恆判 stale，鎖從未擋過任何一次（[[TD-424]]）。

**NEVER 用 Write tool、`printf`、`echo` 或任何其他方式手寫鎖檔。** 手寫的鎖沒有 session 識別也沒有 heartbeat，判準當場退回它要修的那個狀態：

| 逐字實錄的開脫 | 實際 |
| --- | --- |
| 「sandbox 擋掉 `$$`，用 Write tool 補一個鎖檔就好」（round 33） | 手寫的鎖第一行是**已結束的那個 Bash call 的 pid**，寫進去的當下就是死的 |
| 「pid 欄填 0 或哨兵值，反正判準會走 DEAD 分支」（round 30 / 36） | 那正是「鎖從未擋過任何一次」的成因，不是它的解法 |
| 「這支 script 在這個 repo 找不到，先跳過鎖」 | 找不到 = 路徑打錯。先 `ls ~/offline/clade/vendor/scripts/work-loop-lock.ts` 確認，**NEVER** 無鎖開跑 |

**Red Flag**：正要對 `.clade/work-loop/lock` 下 Write / Edit / `printf` / `echo` —— 停手，回到上面那條指令。

宣布模式一句話後進 Step 1。

---

## Step 1 — State re-hydrate（durable execution，每輪必做）

**Iron Law：每一輪開頭 MUST 從 `.clade/work-loop/state.json` 重建狀態，NEVER 依賴對話記憶。**

理由不是保守，是機制事實：主線 context 會被 auto-compaction 壓縮，壓掉的第一批就是「上一輪做了什麼」。狀態外部化之後，compaction 只丟敘事、不丟事實。

```bash
STATE="$(git rev-parse --show-toplevel)/.clade/work-loop/state.json"
if [ ! -f "$STATE" ]; then
  echo '{}'                                    # 真的第一輪
elif node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$STATE"; then
  cat "$STATE"
else
  echo 'STATE_CORRUPT'; ls -la "$STATE" "$STATE.bak" 2>&1   # 走下面的還原程序
fi
```

**`STATE_CORRUPT` NEVER 當成 `{}` 處理。** 空物件會讓 `round` 從 0 重來、`awaiting` / `decisions` / `failStreak` 全空——上游那 N 輪的記憶一次歸零，而每個欄位看起來都「合法」，沒有任何一步會報錯。還原程序（依序）：

1. `state.json.bak` parse 得過 → `mv` 回正本，本輪的 `sessionNote` **MUST** 記「從 .bak 還原，round <N> 的 bookkeeping 可能遺失」。還原回來的 `sessionNote` 若以 `⟨截斷 …⟩` 收尾，全文在 `state-archive.json` 的 `sessionNotes.r<N>`（見 § Retention）——**MUST** 讀那份全文再判上一輪做到哪，**NEVER** 只憑截斷後的頭 800 字下判斷
2. `.bak` 也壞或不存在 → **STOP，NEVER 自行重建一份新 state**。沒有第二份現況可抄（HANDOFF 自 2026-08-13 起不 render 進度），重建輪次與 awaiting 是**人**的工作，不是本輪的
3. 兩者皆不可用 → 標 `stoppedReason: state-unrecoverable` 並回報 user

```json
{
  "round": 7,
  "startedAt": "2026-08-05T03:11:00Z",
  "lastRoundAt": "2026-08-05T04:02:13Z",
  "fingerprint": "sha256:abc123…",
  "fingerprintUnchangedRounds": 1,
  "nonProductiveRounds": 0,
  "subagentsSpawned": 4,
  "consecutiveDispatchFailures": 0,
  "guardrailsAck": "2026-08-05T04:02:10Z",
  "sessionNote": "本輪一句話紀錄（值得留痕的事）",
  "lockSessionId": "mshkf6es-mptx87qc-ubuntu",
  "inFlight": [{ "agent": "wt-td317", "item": "TD-317", "dispatchedAt": "…",
                 "taskId": "<Bash harness task id 或 null>", "owner": "work-loop-dispatch",
                 "deadline": "<ISO 或 null>", "lifecycle": "dispatching|dispatch-failed|pending|harvesting|harvested|cancelling" }],
  "packaged": { "TD-402": "2026-08-05T03:40:00Z" },
  "awaiting": [{ "id": "TD-402", "title": "grain 二選一", "packagedAt": "2026-08-05T03:40:00Z",
                 "round": 6, "blocker": "src/db/schema.ts:88 …", "startableDone": "index 已補齊",
                 "requiresSpecificConsent": false, "state": "awaiting",
                 "options": [{ "key": "A", "label": "…", "effect": "…", "recommended": true },
                             { "key": "B", "label": "…", "effect": "…" }],
                 "rationale": "…", "nextStep": "/wt td402: …" }],
  "refused": { "TD-401": { "answer": "B", "scope": { "resource": "…", "action": "…" }, "refusedAt": "…", "note": "<Charles 逐字>" } },
  "decisions": { "TD-355": { "answer": "A", "outcome": "granted", "note": "<Charles 逐字>", "answeredAt": "…",
                 "grant": { "actionFingerprint": "sha256:<item + exact scope>", "scope": { "resource": "…", "action": "…", "pathsOrRefs": ["…"], "exclusions": ["…"] }, "grantedAt": "…", "consumedAt": null } } },
  "failStreak": { "TD-388": 2, "fix-pinia-mutation": 1 },
  "escalated": { "add-audit-log": { "bucket": "applyBlocked", "reason": "…" } },
  "blockers": { "TD-402": { "fingerprint": "sha256:…", "blocker": "<原文>",
                            "unblockPredicate": "<一條可觀察 predicate>", "predicateValue": "<上次量到的值>",
                            "firstSeenRound": 12, "lastCheckedRound": 18 } }
}
```

`blockers` 是 blocker 指紋表，讓同一批卡住的 item 不必每輪重新診斷一次——欄位語義、三步查表、入表門檻與清表時機在 [reference/blocker-ledger.md](reference/blocker-ledger.md)，**此處不複述**。舊 state 檔沒有這個欄位是正常的（本欄位之前的版本），當成空物件起算即可。

**檔案不存在** → 這是第 1 輪，用 `{round: 0}` 起手，Step 7 建檔。

**`awaiting` / `packaged` / `decisions` 三者的關係**（寫錯會讓已答的決策被重問，或已問的被當成沒問）：

| 欄位 | 語義 | 唯一寫入時機 |
| --- | --- | --- |
| `awaiting[]` | **只放 unresolved** 的待答決策，帶完整選項內容。`requiresSpecificConsent=true` 不得自主 prune；答覆後必須出列 | Step 4b packaging 入列、Step 2.7 granted / refused 皆出列 |
| `packaged` | `awaiting[]` 的 `id → packagedAt` 投影，供 Step 2 排除用 | 與 `awaiting[]` 同步增刪，**NEVER** 單獨寫 |
| `refused` | 已明確拒絕的 scope ledger；Step 2 scan 必須排除這些 id，避免重問或自行執行，但它**不計入** attended 的 unresolved queue | Step 2.7 收到 refused 當下寫入；只有 user 之後明確改變決定才移除 |
| `decisions` | 已答的答案（含 Charles 逐字）、`outcome: granted|refused` 與逐字 note，**答完不刪**——後續輪次照它執行。較舊的條目會被 retention 轉成 stub（key 與 `answer` 都還在，見 § Retention），語義不變。specific shared-action consent 只能建立 action fingerprint 完全相符的 one-shot `grant`；dispatch 前原子寫入 `consumedAt`。**NEVER** 重用已消耗 grant | Step 2.7 (c) 收到答案當下；消耗發生在同一 action instance dispatch 前 |

**舊 state 檔只有 `packaged` 沒有 `awaiting`**（本欄位之前的版本）→ 用 HANDOFF `## ⏳ Awaiting Charles` 的對應 `###` 子段回填成 `awaiting[]` 條目，回填不出來的（子段已不存在）直接把該 key 從 `packaged` 刪掉。

### Retention（state 正本只留會改變路由的內容）

state.json 每輪被**整讀**一次，所以它的體積是一筆與本輪成果無關的固定成本（2026-08-13 clade 實測 48.6 KB，TD-491）。`work-loop-state-write.ts` 每次寫入時自動把下列內容 rotate 進**同目錄**的 `state-archive.json`，正本只留路由需要的部分：

| 正本欄位 | 留下什麼 | 全文去哪 |
| --- | --- | --- |
| `sessionNote` | 頭 800 字元 + `…⟨截斷 N 字元，全文見 state-archive.json sessionNotes.r<N>⟩` | `sessionNotes.r<N>` |
| `notes` | 頭 1200 字元 + 同款標記 | `notes.r<N>` |
| `decisions` | 最近 12 筆全文；更舊的轉 stub `{ answer, answeredAt, archivedAt: "r<N>" }` | `decisions.<key>` |
| `completed` | 最近 8 筆 | `completed[]` |

**`decisions` 的 key 與 `answer` NEVER 因 rotate 而消失**——這正是三欄位關係表要防的失敗（已答的決策被重問）。看到某 key 帶 `archivedAt` 就是「這條已答、答案是 `answer`」，照它執行即可；**只有需要 Charles 逐字理由時**才去讀 `state-archive.json`。

**自創欄位 MUST 自己收斂。** `nextRoundQueue` / `decidedHoldSteady` / `roundFindings` / `legitimateSkips` 這類不在本 schema 的欄位沒有 reader 契約，retention **不會**替它們修剪——猜著剪的失敗是靜默資料遺失。寫這些欄位的**每一輪**都 MUST 只留下輪真的會用到的條目，**NEVER** 把歷史累積留著等人清。writer 在 state 超過 24 KB 時於 stderr 印 `STATE_OVERSIZE: <bytes>｜前三大：<欄位=bytes>`——**看到它 MUST 當輪就把被點名的欄位收斂掉**，`NEVER` 記進 `notes` 留給下一輪。

**Dispatch lifecycle rehydrate（每輪 MUST）**：逐筆檢查 `inFlight`。`dispatching + taskId:null` 代表 process 可能死在 dispatch 回傳前，進 reconciliation / intervention，**NEVER** 自動重派或當 notification-only job；`dispatch-failed` 移出 in-flight 並按 failure packaging；Bash owner 的 `pending` MUST 有真實 taskId；notification-only `pending` MUST 有可由 `TaskStop(owner)` 操作的 owner ref 與 deadline。任何 schema 不完整條目 fail-closed 保留 ownership，先修 state 再 dispatch。

**`failStreak` / `escalated` / `refused` 的來源是本檔，NEVER 是 HANDOFF 的 marker 段。** HANDOFF 段是**人讀輸出**——它可能被人手動編輯、被 rotate 搬走、被別的 skill 覆寫。狀態只認 state 檔。

**Escalated 離場規則**（對 `escalated` 每一條逐項判定，兩條 predicate 任一成立＝已有人介入，streak 歸零、移出 escalated）：

- 該 item 不再出現在本輪 scan（已 archive / 已刪除 / 已勾 `[x]`）
- 該 item 本輪狀態 ≠ escalated 條目記錄的狀態（已被推動）

兩條都不成立 → 續留 escalated（本輪**不 dispatch**），Step 7 原樣 re-emit。

### Decay 偵測（hard gate，先判身分再判 decay）

觸發訊號只有一個：`guardrailsAck` 讀不到。

> **2026-08-13 TD-495 起，「`round` 與 HANDOFF 記載輪次不一致」不再是訊號。** HANDOFF 不再 render loop 進度（Step 7.2），第二份現況不存在了，也就沒有「兩邊不一致」這回事。真正的停滯由 `runner.sh` 的 no-progress 網接（`exit=0 且 round 未前進` 連續 2 輪 → 自行停）。**NEVER** 為了恢復這個訊號把進度寫回 HANDOFF —— 兩份現況正是 2026-08-11 <consumer-b> 空轉近 7 小時的根因。

**這個訊號在 runner child 身上永遠不代表 decay。** decay 指的是**同一個 process 的 context 被 auto-compaction 壓掉**——只有 in-session `/loop` 有這個失敗模式。runner child 每輪是 `claude --print` 起的**全新 process**，context 從零重建、狀態只從 state 檔讀，結構上不可能 decay。所以在 child 身上，訊號命中**一定**是「上一輪 bookkeeping 沒收尾」，而那需要的是**自癒或忽略**，不是中止。無條件中止會讓**每一輪**都在 Step 1 停住、零 scan 零 dispatch，直到 runner 的 no-progress 條件把自己停掉——而那個停法在 log 上跟正常收工幾乎無法區分（2026-08-11 <consumer-b> 實測：連續空轉近 7 小時，所有健康訊號正常，靠人工介入才發現）。

**MUST** 依下表分流，**每一列**都要照著判，不是只看第一列：

**列有代號（D4–D6），其他段落引用時 MUST 用代號、NEVER 用「第 N 列」**——列序會隨增補改變，序號指標會在改動後指到別列而沒有任何訊號。**D1–D3 已於 2026-08-13 隨 HANDOFF 輪次訊號一併廢除，代號 NEVER 回收再用於新列**（舊 sessionNote 與 log 仍寫著它們，回收會讓歷史紀錄指到不同語義）。

| 代號 | 可觀察 predicate | 動作 |
| --- | --- | --- |
| **D4** | **HANDOFF 寫入失敗**——Step 7.2 的 `## ⏳ Awaiting Charles` 收尾寫入失敗 | 中止本輪（release lock、退出），照下方 § D4 的部分寫入白名單落檔。**D4 命中時壓過其餘各列**：同時命中 D5 一律以 D4 為準 |
| **D5** | runner child，`guardrailsAck` 讀不到 | **NEVER 判 decay**。那是第 1 輪、或 state 檔不完整；照常進 Step 1.5，讀完在 Step 7 補寫 `guardrailsAck`。與 D4 同時命中則以 D4 為準 |
| **D6** | **非** runner child（in-session `/loop`），任一訊號命中 | 判定 context decayed，**MUST** 結束本輪：state 寫 `roundEndReason: "context-decay"`、跑 `work-loop-lock.ts release --session <id>`、退出。**NEVER**「感覺還記得」就繼續跑。**但下列不算訊號命中**（那是首輪的正常長相，不是 decay）：state 檔不存在或 `round` 為 0 |

### D4 的部分寫入白名單（唯一容許在 7.2 失敗後仍寫 state 的路徑）

D4 與 Step 7.2 的「寫入失敗時 NEVER 繼續寫 7.3」不衝突，因為它寫的**不是** 7.3 的 bookkeeping。**MUST 只寫這兩個欄位、其餘一律不動**：

| 欄位 | 寫什麼 |
| --- | --- |
| `roundEndReason` | `handoff-write-failed: <實際錯誤逐字>`，**NEVER** `context-decay` |
| `stoppedReason` | **只在連續第 2 輪命中時**寫 `handoff-write-failed ×2: <錯誤>`（child 自己寫 `stoppedReason` 合法且有效，per [run-modes.md](reference/run-modes.md)） |

**NEVER** 在 D4 路徑動 `round` / `fingerprint` / `fingerprintUnchangedRounds` / `inFlight` / `packaged` / `awaiting` / `guardrailsAck`——本輪什麼都沒做完，bump 它們等於謊報進度。

**「連續第 2 輪」的判定 predicate**（不是憑印象）：Step 1 讀進來的 state，既有 `roundEndReason` 以 `handoff-write-failed:` 起頭，**且**冒號後的錯誤字串與本輪這次相同 → 這是第 2 輪。

**`round` 不 bump 的連帶效果要講清楚，NEVER 反過來說**：D4 不動 `round`，所以 runner 的 `exit=0 且 round 未前進` 網會在**連續 2 輪**後印 `== stop: state 連續 2 輪未前進` 自行停掉（`runner.sh` 的 no-progress 判定）——**不會**空轉到 `--max-rounds`。`stoppedReason` 在這裡買的是**可診斷性**：沒有它，log 只說「state 未前進」，沒說是寫入權限壞了；有它，停止原因直接寫在 state 檔裡。它是第二道網，不是唯一那道。


| Red Flag | 立即動作 |
| --- | --- |
| 身為 runner child，正在寫 `roundEndReason: "context-decay"` | 停手。child 不可能 decay，回上表判身分與方向 |
| 看到輪次不一致就準備「把 HANDOFF 對齊到 state」，還沒判方向 | 停手。`state.round` < HANDOFF 時這個動作會把較新的敘事蓋上錯的輪次 |
| 「兩邊輪次不一致、狀態不可信，安全起見先停一輪」 | 停止這個推論。安全中止在 child 身上不是保守選擇，是讓 loop 永久空轉 |
| 自癒時順手把下方 In Progress / Next Steps 各段「更新成現況」 | 停手。本輪 scan 都還沒跑，那些「現況」是編的 |

**`roundEndReason` 與 `stoppedReason` 是兩件事，寫錯會讓 loop 提早死掉**：

| 欄位 | 語義 | runner 的反應 |
| --- | --- | --- |
| `roundEndReason` | **這個 process** 該結束（context 到頂、item cap 用完） | 起下一個全新 process 繼續 |
| `stoppedReason` | **整個 loop** 該停（真的做完 / fingerprint 三輪不變 / 連續失敗） | 不再起新 process |

context-decay 與 handoff-write-failed **永遠**寫 `roundEndReason`，**NEVER** 寫 `stoppedReason`——唯一例外是 D4 的「同一寫入錯誤連續第 2 輪」，那時**兩個都寫**（`roundEndReason` 記本輪為何結束、`stoppedReason` 記整個 loop 不該再起新 process）。

**兩個中止值語義不同，寫錯會把後續診斷帶去錯的方向**：

| `roundEndReason` 值 | 語義 | 只在什麼身分下合法 | 讀到它該往哪查 |
| --- | --- | --- | --- |
| `context-decay` | **這個 process 的 context 被壓縮**，狀態記憶不可信 | 只有 in-session `/loop`。runner child **NEVER** 寫這個值 | 起 loop 的方式（該改用 runner） |
| `handoff-write-failed: <錯誤>` | 狀態記憶正常，但 **HANDOFF 寫不進去**（permission / 路徑 / 工具錯誤） | 任何身分 | 寫入權限與 Step 7.1 路徑，**不是** context |

---

## Step 1.5 — Guardrails re-read（hard rule，dispatch 前）

**MUST Read [reference/guardrails.md](reference/guardrails.md) —— 每一輪都讀，不是只在第 1 輪讀。**

**NEVER** 因為「我這輪還記得護欄」「上一輪剛讀過」「這輪只做一個小 item」跳過。compaction 抹掉的正是「上一輪剛讀過」的那份 context，而它抹掉時不會通知你——你會覺得自己記得。re-read 的成本是 1KB，漏讀的成本是把不可逆動作當成可自主動作做掉。

讀完把 `guardrailsAck` 更新為當前 ISO 時間（Step 7 落檔）。

### Routing re-read（同一輪，同樣 hard rule）

**每一輪** dispatch 前 **MUST** 一併讀 [[agent-routing]] 的 § 派不派（先於派給誰）、§ Routing Table、
§ Claude 委派的 model 檔位——loop 是 dispatch 量的主要來源，檔位選擇每一輪都在發生。

三條在 loop 路徑上最常滑掉的：

- **主線自己動手也要過 Routing Table**。mechanical fan-out 與 read-heavy 兩列的觸發條件**不限於委派**：
  準備自己跑 ≥3 條唯讀指令、或自己讀 ≥5 個檔／>500 行長文件，就已經命中 → 派 `--model luna --effort low`。
  **NEVER** 因「順手跑掉比較快」略過查表
- **原判 Claude `sonnet`／`haiku` 的委派 MUST 先判 codex 可用性**，可用就轉派 `--model luna`
  （`sonnet` → `--effort high`、`haiku` → `--effort low`），准入判準見該 §
- **每一次 dispatch MUST 帶 `--route` 與 `--tier-basis`**（各缺就 exit 1），重試帶 `--retry-of <label>`。
  **NEVER** 不確定就填 `manual`／`table-row`——兩者都與「判定根本沒發生」事後不可區分。
  `--tier-basis` 各值與對 `--model` 的約束見該 § 的 `--tier-basis` 段；宣告與實際檔位矛盾時
  dispatcher 直接 exit 1，**NEVER** 改宣告去遷就已經打好的 `--model`

---

## Step 2 — Scan

```bash
# temp 一律用**這條逐字命令**——runner.sh 的 --allowedTools 只放行它，換個寫法在無人值守下
# 會停在 approval 等一個不存在的人（$SCAN_MKTEMP_RULE，NEVER 改成 mktemp "$D/xxx.XXXXXX"）
TMP="$(mktemp -t work-loop-scan.XXXXXXXXXX)"
# 落點固定在 repo 內（見下方「為什麼是固定路徑」）
D="$(git rev-parse --show-toplevel)/.clade/work-loop"; mkdir -p "$D"
SCAN="$D/scan-latest.json"
node ~/offline/clade/vendor/scripts/handoff-scan.ts --json > "$TMP" 2>/dev/null
# MUST 落檔後立刻驗歸屬，不符就當 scan 失敗處理
EXPECT="$(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")"
GOT="$(jq -r '.consumerId // "MISSING"' "$TMP" 2>/dev/null)"
if [ "$GOT" = "$EXPECT" ]; then
  [ -f "$SCAN" ] && cp -p "$SCAN" "$D/scan-prev.json"   # 覆蓋前 rotate 一份，要比 delta 時讀它
  mv -T "$TMP" "$SCAN" && echo "scan ok: $GOT → $SCAN"
else
  rm -f "$TMP"; echo "SCAN-MISMATCH: got=$GOT expect=$EXPECT"   # 驗不過 NEVER 覆蓋既有 scan-latest
fi
# spectra repo 才有 parked（無 openspec 時回空，屬正常）
PARKED="$(spectra list --parked --json 2>/dev/null || echo '{}')"
```

**為什麼寫進 temp、卻落在固定路徑**（兩件事各自有理由，缺一不可）見 [reference/run-modes.md](reference/run-modes.md) § scan 的 temp 與落點。

**同一輪內 NEVER 為了「找不到上一份輸出」重跑 scan**：要回頭看就讀 `scan-latest.json`，只要摘要就跑 `node ~/offline/clade/vendor/scripts/work-loop-summary.ts`。本輪合法的重跑**只有一個**時機：Step 5 收割後的 re-scan。
**NEVER 因此改成「N 輪跑一次」**：scan 是路由輸入，跳過的那一輪是盲跑；要省的是**同一輪內的重複**，不是輪次覆蓋率。

**失敗 fallback**：script 不存在或回 error、**或 `SCAN-MISMATCH` / `MISSING`** → **STOP**，寫 HANDOFF 一行 `work-loop: scan failed at <ISO>`，跑 `work-loop-lock.ts release --session <id>` 後結束。`SCAN-MISMATCH` 表示讀到別 repo 的掃描結果（unattended 下危害最大：無人在旁審視就照它推進待辦）。**NEVER** 憑記憶或 HANDOFF 既有 narrative 猜待辦狀態。

### 單一 candidate list，兩種 source

| source | 來自 | 進 Step 3 走哪條 |
| --- | --- | --- |
| `spectra` | `reviewGuiReadiness.raw.entries[]` + `PARKED` 的 parked change | § 3.1a bucket 路由 |
| `handoff` / `techdebt` / `roadmap` | `HANDOFF.md` 待辦段、`techDebtHygiene.raw`、`openspec/ROADMAP.md` | § 3.1b 分類表 |

- **`HANDOFF.md`** —— 掃 `## In Progress` / `## Blocked` / `## Next Steps` / `## Outstanding` / `## Follow-up`（heading 名因 consumer 而異，靠 `##` / `###` 辨識）。`- [ ]` 未勾項 = 一個 candidate；`- [x]` 跳過；純文字段落視為單一 candidate
- **`docs/tech-debt.md`** —— **NEVER 整讀主檔**（2026-08-06 實測 clade 196KB / <consumer-b> 363KB，整讀一次吃掉大半預算）。從 `techDebtHygiene.raw` 取，優先序**四層**：`landed-pending-verification`（驗收）→ `stale`（>60d）→ `aging`（>14d）→ 其他 `open`。需要細節時用 `raw` 的 `lineNo` **定點 Read**（`offset` + `limit`）

  **驗收排第一層不是偏好，是流量算術**：landed 條目的 Resolution 已經寫好，close 它的成本是「跑一次自驗」；開一條新 TD 的成本也差不多，但方向相反。驗收永遠排在新工作後面的迴圈，close 流量必定輸給 open 流量——2026-08-13 clade 實測近 7 天 opened 39 / closed 10，同期 landed 桶 16 條無一驗收。**NEVER** 把「landed 那條反正已經 land 了」讀成它不急：它佔著 open class 的位置，且它的 Resolution 每多放一天就多一分過期風險。

  **`--run-selfverify` MUST 帶 `--selfverify-cache`**：全套一次 ~26 秒 / ~384KB 輸出，而 2026-08-06～13 的 round 70–75 **六輪 verdict 逐項相同**——每輪重跑換到的資訊量是 0 bit。快取 key =（audit script 內容 + `docs/tech-debt.md` 內容 + git HEAD），輸入不變就回上次結果並標 `cached: true`。實測冷跑 26s → 熱跑 **0.12s**；TD 檔一改立即失效（實測 0/47 命中），不是恆命中。

  **NEVER 改成「N 輪跑一次」**：calendar-based skip 會讓真實改動落在跳過窗口內溜過去，然後搭著 propagate 散到全 registry consumer 才被發現。輸入不變時跳過在數學上無資訊損失，輪次計數跳過不是。**已知邊界**：48 條 probe 有一部分量的是**活狀態**（檔案數、目錄體積），git HEAD 涵蓋 repo 內變動但涵蓋不到 repo 外的環境漂移——所以它是 opt-in，判斷這一輪能不能接受這個邊界是呼叫端的責任。

  **`blocked-attended-only` 一律跳過**（unattended）：它的定義就是「本迴圈拿不到出口」，撈進 candidate list 只會每輪重新判定一次再放棄。attended 模式照撈——那正是它等的東西。判準與防濫用見 clade `.claude/rules/local/tech-debt-hygiene.md` § Invariant 12。

  ```bash
  wc -c docs/tech-debt.md   # 上面兩個數字的來源。主檔隨 rotate / 新增增減，複跑取當前值
  ```
- **`openspec/ROADMAP.md`** `## Next Moves` 的 `###` 子段（存在時）
- **`worktreeStash`** —— `mergedToMain: false` 的 wt 與每一筆 stash

**Consumer filter**：只處理 `consumerId` = 當前 repo 的 entries。**Spectra change association**：非 spectra source 的 candidate 若文字命中 active change name（word boundary match，非 substring）→ 改判為 `spectra` source 走 3.1a，避免降級成 ad-hoc brief 而丟失 phase 結構與 evidence 收集。細節見 [reference/non-spectra-dispatch.md](reference/non-spectra-dispatch.md) § Spectra change association。

**In-flight filter（防單 item 雙派）**：已有對應 worktree 的 item **不一定跳過**，先查 `.clade/claims/` 的 session claim 鮮度——active claim < 30min 才跳過；claim > 2h 或無 claim 視為可接手。**每一個** dispatch 前都要對照，不是只在開場檢查一次。

**排除**：state 的 `packaged` 已有 timestamp、`refused` ledger 已有相同 id / scope、或 `escalated` 未離場的 item，本輪跳過。`refused` 只排除被拒 scope，不阻塞其他 candidate；user 明確改變決定時才移除該 ledger entry。

---

## Step 2.5 — 工具健檢（分類前，每一輪都跑）

**Iron Law：探針 MUST 是實跑一次，NEVER 是 `[ -f ]` / `command -v` / 「檔案在就算活」。**

scan 回的是**待辦**狀態，不是**工具**狀態。兩者無關：待辦清單完全正常，而推進它們要用的
launcher 早就死了。分類之前先實跑一次，死掉的組直接標不可用——**NEVER** 派 worktree 進去
「看看能不能跑」。

對本輪 candidate list 會用到的每一組各跑一次（沒有 item 落在該組就跳過該列）：

| 組 | 探針 | 判活 |
| --- | --- | --- |
| dev-port | `node scripts/dev-session.ts status`（無此檔改 `dev-singleton.ts`） | exit 0 |
| main | `node scripts/wt-helper.ts list`（**產地 clade home 在 `vendor/scripts/wt-helper.ts`** —— `scripts/` 是投影側路徑） | exit 0 |
| 扇出 | 同上（`/wt` 靠 wt-helper 建 worktree） | exit 0 |
| spectra item 存在時 | `spectra list --json` | exit 0 且吐得出 JSON |

**非 0 的處置**（四步，缺一不可）：

0. **先確認探針路徑在本 repo 成立** —— 「探針寫錯路徑」與「工具真的死了」在 exit code 上**完全同形**，兩者都回非 0 + `MODULE_NOT_FOUND`。產地與投影的路徑不同（上表 main 列即為一例），照抄另一側的路徑會讓整組 item 被誤判成不可用。路徑確認無誤才進第 1 步
1. 把該組標成**本輪不可用**，落進 state 的 `notes`，附**實際 stderr 首行**（不是「壞了」）
2. 該組的 item **全部改走 § Decision packaging**，**NEVER** dispatch、**NEVER** 標 skip
3. 修法若落在別的 repo（clade 投影層、上游工具）→ 修法本身也是一條 packaged 決策，
   **NEVER** 在本 repo 手補投影檔繞過

**實跑擋得住「檔案在但 import 死了」，擋不住「探針量錯檔」**，兩者輸出無法區分——所以第 0 步獨立存在。兩者的實證見 [reference/run-modes.md](reference/run-modes.md) § 工具健檢為什麼要實跑。

---

## Step 2.7 — 開場決策清算（每一輪都跑）

**MUST 先完整讀 [reference/decision-drain.md](reference/decision-drain.md) 再執行**——每一輪都讀，不是只在第 1 輪讀。

### Iron Law：attended 下 `awaiting[]` 非空 NEVER 開工

**佇列非空時 NEVER 進 Step 3、NEVER 進 Step 4。** 先清空，再開工。

順序是「先清算，後開工」，不是「邊做邊找機會問」。Charles 在場的那一段**正是**他準備離開座位的那一段——把問題留到「做完手上這件再問」，多數時候等同留到他已經走了。

**判準是 mode，不是題數、不是急迫性。** 佇列剩 1 題和剩 9 題同一條規則；「這幾條都不急」不構成延後。
### 三步

| 步 | 做什麼 |
| --- | --- |
| (a) Prune | 對 unresolved `awaiting[]` **每一條**逐條判定：已不在本輪 scan → 移除不問；依 [autonomy-predicate.md](reference/autonomy-predicate.md) § Iron Law 重判後**現在**寫得出「推薦 A + 站得住的理由」，且未命中 predicate 7，且 `requiresSpecificConsent !== true` → 移出佇列當自主 item做掉。`refused` ledger 不在 awaiting，永不自主執行 |
| (b) Ask | unresolved entries 全部問完，`AskUserQuestion` 一次 ≤4 題、連續發到 `awaiting[]` 清空。specific consent 推薦選項 description MUST 含完整具名 scope，選取即授權 |
| (c) Record | 每個答案立即寫 `decisions.outcome`。granted：移除 `awaiting` / `packaged` / HANDOFF 子段並建立 one-shot grant；refused：同樣從 unresolved `awaiting` / `packaged` 出列，另寫 `refused` ledger，HANDOFF 子段改標 blocked/refused。refused 不進 Step 3，也不阻塞其他 item。dispatch 前 grant fingerprint + scope MUST 完全相符並原子寫 `consumedAt` |

### Mode 分岔

| 可觀察 predicate | 本步怎麼跑 |
| --- | --- |
| **attended**（非 `--unattended` 且本輪非 `claude --print` 起） | 跑完整 (a)(b)(c)，佇列清空才進 Step 3；**接著逐條重量 `blockers` 的 predicate**（[blocker-ledger.md](reference/blocker-ledger.md) § 清 ledger 是正當工作） |
| **unattended / runner** | **只跑 (a)**，(b)(c) 跳過。佇列剩下的 item 本輪照舊排除，**其餘工作全部照跑** |

判不出自己在哪個 mode → 當作 unattended。

**unattended 下佇列非空 NEVER 是停 loop 的理由**——**NEVER** 因此寫 `stoppedReason`、**NEVER** 因此跳過與佇列無關的 item。**佇列裡的 item 本輪排除也不是 skip**：它不進 § 3.1b 的 skip 合法理由窮舉，**NEVER** 被拿來當理由套用在其他 item 上。

---

## Step 3 — 分類與自主判定

**每一個** candidate 都 MUST 走完三步（3.1 分類 → 3.2 自主判定 → 3.3 分組），不是只對前幾條。

### 3.1a spectra source — bucket 路由

| 優先 | Bucket | 代號 | 動作 |
| --- | --- | --- | --- |
| 0 | `done` | 3z | archive → merge-back → commit + push |
| 1 | `feedbackGiven` | 3a | 處理 review feedback → 補 evidence |
| 2 | `readyForEvidence` | 3b | 補 evidence annotation |
| 3 | `awaitArchiveWalkthrough` | 3c | 跑 archive walkthrough |
| 4 | `ready` + `userActionPending=0` | 3d | auto-archive + commit |
| 5 | `ready` + `userActionPending>0` | 3e | 標 🟢 ready-for-review |
| 5.5 | `parked` | 3h | unpark → apply |
| 6 | `applyInProgress` | 3f | 繼續 apply |
| 7 | `healthCheckNeeded` | 3g | 修 tasks.md 格式 |
| 8 | `applyBlocked` | 3i | **先過 [blocker-ledger.md](reference/blocker-ledger.md) 三步查表**，沒命中才**評估 blocker**（[blocker-evaluation.md](reference/blocker-evaluation.md)） |
| 9 | `awaitingUserDecision` | 3j | 同上查表，沒命中才**評估決策需求** |
| — | `crossWtDirty` / `malformed` | — | 跳過（log） |

**代號欄**是 reference 檔內部使用的 bucket 短碼（`3z` / `3f` / `3i` …）——它們在 reference 裡出現時
指的就是本表這一列，不是另一套流程。

固定步驟的五個 bucket（`done` / `awaitArchiveWalkthrough` / `ready(0)` / `parked` / `healthCheckNeeded`）**MUST 讀 [simple-buckets.md](reference/simple-buckets.md) § 對應 bucket** 照步驟走——三條 ship 路徑的 commit pathspec 不同，憑印象跑會漏 commit 或誤納其他 change 的檔案。

**Claude-actionable override（hard rule，bucket 之上的修正層）**：bucket 是粗粒度聚合。**每一條** change 在 bucket routing 之後、skip 之前 MUST 檢查 `issued` / `verifyClaudePendingCount` / `discussPendingCount` / `staleEvidenceCount`：

```
IF 任一 > 0:
  → 有 Claude-actionable review work，先走對應處理邏輯 → 處理完 re-scan（bucket 會位移）
  → 只有全部處理完、re-scan 確認 0 後，才能走 bucket 的 skip / ready-for-review 路徑
ELSE:
  → 走原 bucket routing
```

**`bucket=ready` 不等於 user-bound；`bucket=applyBlocked` 不等於 Claude 無事可做**（impl 卡 blocker ≠ review items 也卡）。2026-07-21 <consumer-a> 實證：5 個 issued items 被 `ready` bucket 掩蓋，loop 宣告 user-bound 然後 30min idle，user 在 review-gui 等一個不會來的接手。**「所有 change 卡 user action」這句話在 `issued>0` 時就是錯誤判斷。**

### 3.1b 非 spectra source — 分類表

**MUST Read [reference/non-spectra-dispatch.md](reference/non-spectra-dispatch.md)** 取分類表（code task / investigation / blocked / 模糊）與 **skip 合法理由窮舉 4 條 + 8 條不合法藉口逐字實錄**。**NEVER** 自創第 5 條 skip 理由。

分類為 blocked 的 candidate 與 3.1a 的 bucket 8／9 走同一條路：**先過 [blocker-ledger.md](reference/blocker-ledger.md) 三步查表**，沒命中才逐條診斷。

### 3.2 自主判定（七條 AND）

**MUST Read [reference/autonomy-predicate.md](reference/autonomy-predicate.md)** 取判定表與 packaging SOP。摘要：七條全成立 → 自主做；任一不成立 → **decision packaging**（不是 skip）。

**NEVER** 把「不確定能不能自主」當成「必須等人」。判不出來時先跑唯讀調查把事實補齊，再重判——該檔 § 判不出來時的三步 有具體流程。

### 3.3 分組

**MUST Read [reference/dispatch-topology.md](reference/dispatch-topology.md)**。四組併發契約（扇出 ≤4 / dev-port 1 / main 1 / 主線即時）對**兩種 source 一視同仁**，**每一個** item 都要落進其中一組。spectra item 與非 spectra item 共用同一個扇出上限，不是各自一套。

---

## Step 4 — 執行

執行模型（**不是**單一佇列逐一取）：

1. **先把扇出組填到 4 個 in-flight**（各自 `/wt` worktree）
2. **主線接著推進序列組**：main 組（archive/commit/push）→ dev-port 組（evidence，取得 lease 後仍走 `/wt`）→ 主線即時組（investigation / blocker 評估 / 單檔文字改動，主線自己做）
3. **收到 `<task-notification>`** → 走 Step 5 收割 → 從扇出組補一個新 dispatch
4. 每完成一個 item，**立即** commit + 重跑 scan 更新狀態

同一個 item 的步驟之間序列；**不同 item 之間沒有依賴**，NEVER 讓 B 等 A 完成。

### 4a. 自主 item → dispatch

- 要改 tracked code → `/wt <slug>: <brief>`（扇出組，≤4 in-flight）
- spectra change 的實作 → `/wt <change-name>: /spectra-apply <change-name>`
- 純唯讀調查 / 單檔文字改動 → 主線即時組（read-heavy 者先過 [dispatch-topology.md](reference/dispatch-topology.md) § 主線即時組的 pre-scan 前置判定派 codex，主線消費 report）
- 記進 state 的 `inFlight`，`subagentsSpawned` +1

上面三條假設 `/wt` 在本 repo 叫得動，而那個假設在**產地（clade home）不成立**。開工前判一次：

| 可觀察 predicate | dispatch 形狀 |
| --- | --- |
| `ls .claude/skills/wt` 存在，**或** `jq -r '.enabledPlugins' .claude/settings.json` 不是 `none` | 照上面三條走，扇出組 ≤4 in-flight |
| 兩者皆不成立 | **主線自己進 worktree**，扇出組併發降為 **1**。**MUST 先完整讀 [no-wt-dispatch.md](reference/no-wt-dispatch.md)** —— 那份的第 4b 步（`merge-back` 只 stage 不 commit）漏掉會讓整份工作停在 index 裡 |

兩格都不是 skip：「工具叫不動」不在 § Skip 合法理由窮舉 的 3 條之內。

**每一個** `/wt` brief **MUST 逐字內嵌** [guardrails.md](reference/guardrails.md) § C 的護欄區塊。subagent 是 fresh context，天然免疫主線 compaction——把安全執行面下沉到 subagent 是本設計對 governance decay 最可靠的一道。**NEVER** 只寫「照護欄做」這種 by-reference 指示。

**NEVER 因 size / progress 跳過 dispatch**：`applyInProgress` 不管進度 0% 或 change 看起來多大，MUST dispatch——`/spectra-apply` 自管步驟粒度、phase、pause 與 blocker。「需要完整 session」「不適合 loop」都是違規。

### 4b. 本輪承載不了的 item → 出口分流（dispatch 是 default，登記是付費 fallback）

**每一個**收輪時仍非 completed 且不在 `inFlight` 的 item（含 turn cap 擠出的自主 item）都 MUST 過下表，依序判、first-match，**不是只處理最後一個**：

| 條件（依序判） | 動作 |
| --- | --- |
| 殘工 <15 分鐘 | 本輪做完，不落任何檔（turn cap 為此 +0 不 +1） |
| 需要 Charles 拍板（過不了自主判定七條 AND） | **packaging**——照下方既有 Packaging SOP 全文執行（唯一免費的登記） |
| 需要 attended / permission gate（publish、`.claude/**`） | attended 佇列（`tasks/` 既有形狀，一檔一條） |
| 可執行，且 context 可 durable 化成 ≤5K thin brief | **`/handoff now <task pointer>` dispatch**（default 出口；brief 紀律照 [[session-tasks]] § Herdr session transport） |
| 等具體外部 signal | TD ＋ `wontfix-until-signal` ＋ **可觀察 signal predicate**。寫不出 predicate 就不准用本格——那是等待區，不是掩埋場 |
| 以上皆非（context 無法 durable 化） | TD 登記，**MUST 同 commit 附 `### Restart brief` 段**：檔案路徑、指令、驗收 predicate、已排除方案。heading 逐字 `### Restart brief`（`####` 亦可），**NEVER** 寫成 `**Restart brief**` 粗體或 `## `（前者不是 heading、後者被 TD parser 當成新 entry 的起點）。缺 = `audit-tech-debt-hygiene` violation（`restart-brief-missing`，紅線 >0） |

**Iron Law：登記之前先問「這條為什麼不能現在 dispatch」。違反字面就是違反精神**——「登記比較快」
「brief 明天再補」「反正 HANDOFF 會有人看」都不成立：Restart brief 的內容就是 thin brief 的內容，
寫得出來的當下 dispatch 幾乎恆優於登記。

**dispatch 的三個不准**：探索型（結論仍依賴本 session 判斷鏈、brief 落不下來）NEVER dispatch——先把
判斷落盤，落不了走登記；需 attended gate 的 NEVER dispatch——新 session 一樣 blocked；**並行 dispatch
已 ≥2 條時 NEVER 再發**——排入下一輪，N session 搶同一 working tree 是把 usage 問題升級成 race 問題。

#### Packaging SOP（「需要拍板」那格的執行內容；本體不動）

**NEVER log + skip。** 依 [autonomy-predicate.md](reference/autonomy-predicate.md) § Packaging SOP 做三件事（蒐證 → 抽 startable 子集先做掉 → 寫 2–3 個排序選項進 HANDOFF `## ⏳ Awaiting Charles`），完成後**同步**寫進 state 的 `awaiting[]`（完整條目：`id` / `title` / `blocker` / `startableDone` / `options` / `rationale` / `nextStep` / `packagedAt` / `round`）與 `packaged`（id → ISO 投影）。

**`awaiting[]` 是 Step 2.7 清算的唯一輸入。** 只寫 HANDOFF 不寫 `awaiting[]` = 這條決策永遠不會被端到 Charles 面前，退回本步存在之前的累積狀態——**NEVER** 只寫其中一邊。

**packaging 本身算合法進度**——它會改變 fingerprint，Step 6 不會誤判成空轉。

attended mode 且真的選不出來 → 依 Step 0 Iron Law **MUST `AskUserQuestion`**；unattended / runner → packaging，**NEVER** 呼叫。

### 4c. Dispatch 共通規則

- **Lifecycle 兩階段綁定（MUST）**：dispatch 前先把 intent 寫入 state：`inFlight={agent,item,dispatchedAt,taskId:null,owner,deadline,lifecycle:"dispatching"}`。`Bash(run_in_background=true)` 回傳後，**同一 assistant turn** 原子綁定真實 `taskId`、確認 owner / deadline、改 `lifecycle:"pending"`，再 arm `ASYNC_KEEPALIVE_CONTROL`。dispatch 失敗則移除 intent或標 `lifecycle:"dispatch-failed"`，**NEVER** 留下假 ownership。無 task id 的 Agent / Monitor / Workflow 保留 `taskId:null`，但 MUST 寫可由 `TaskStop(owner)` 操作的 owner ref 與 deadline，並 arm `ASYNC_NOTIFICATION_KEEPALIVE`。Codex pre-scan owner 固定 `codex-watch`。
- **Per-item task 追蹤（MUST）**：每條 dispatch item MUST 先 `TaskCreate`（subject 用 `<item>: <狀態> → <動作>`），dispatch 時標 `in_progress`，完成/skip/blocked 立即標 `completed`。**NEVER** 只建概括性收割 task——user 看 task list 判斷 loop 在幹嘛，概括 task 提供零資訊
- **Dev server 協調**：evidence collection 需要 dev server 時**主線自行協調**（清 stale session → 起新 dev server），**NEVER** 把 port 被佔當 user 協調事項跳過。三層判定（archived → stale → active claim < 30min 才是真 conflict）
- **Workflow model 感知**（archive 後 push 前 MUST）：讀 `~/offline/clade/registry/consumers.json` 的 `workflow_model`——`trunk-based` 直接 push；`pr-merge-based` **NEVER 直推 main**，改 push feature branch + `gh pr create --fill`；查不到當 `pr-merge-based` 保守處理
- **Commit 紀律**：每個 item 獨立 commit，走 `git commit --only -- <paths>`
- **Error handling**：
  - **Dispatch failure**（skill 報錯 / infra 不可達）→ log + skip + `failStreak` +1，繼續下一個
  - **Fixable issue found during dispatch**（E2E selector bug / guard 漏路徑 / annotation drift / test assertion 要更新）→ **MUST 就地修 → 重跑 → re-scan → 繼續**，**NEVER** 當成 dispatch failure skip。判準：「我能在當前 session 用 Edit + Bash 修好嗎？」是 → 就地修
  - `failStreak` ≥3 → 移進 state 的 `escalated`，下一輪起不再 dispatch
  - **codex pre-scan 的 exit 2 / 3 / 4 NEVER 記入 `failStreak` / `consecutiveDispatchFailures`**（分流見 [dispatch-topology.md](reference/dispatch-topology.md) § pre-scan 的 exit code 分流）——兩個計數器管的是 item 的工作 dispatch，不管蒐證段

---

## Step 5 — 收割（每個 notification 到達時做，不是階段）

收割跟 dispatch 交錯進行，**不是** dispatch 全部結束後才開始的階段。收完從扇出組補一個 dispatch，再回主線的序列組工作。

**每一個** `<task-notification>` 到達時 **MUST 先完整讀 [reference/harvest.md](reference/harvest.md)** 走它的 8 步 SOP（驗收 → scope-verify → 高擴散半徑 change 的 checker subagent → 更新 progress → re-scan → 檢查新 actionable → 更新 ledger → 補滿扇出組）與 lifecycle waiting protocol。deadline 到達只進 `cancelling` / intervention：先停 wakeup、依 owner 用 `TaskStop` 或原生 cancel protocol，並等待 terminal confirmation；terminal 前保留 ledger 與 lock，**NEVER** 記 fail-streak、移除 ownership、重派或收割。

只有 terminal completion / failure notification 且 task-id claim 成功後才更新 state：成功 → 該 item `failStreak` 歸零、來源條目勾 `[x]` 或補完成摘要；失敗 → `failStreak[item] += 1`、`consecutiveDispatchFailures += 1`，≥3 進 `escalated`。兩者完成收割後才從 `inFlight` 移除。**每一次**收割寫完 state 後都 MUST 跑 `work-loop-lock.ts refresh --session <id>`（per Step 0 § 互斥鎖）。

**反模式**（任一出現 = 立即停手自查）：

- 有 actionable item 未處理卻停下來「等 user」
- in-flight ledger > 0 就寫 HANDOFF、釋放 lock 收工
- 寫「下一輪要做的」「下次 session 處理」然後收工——fixable issue MUST 就地修 → 重跑 → re-scan → 繼續

---

## Step 6 — Fingerprint 與停止判定

### 6.1 算 fingerprint

```
fingerprint = sha256(
  排序後的 [(每條 candidate 的 id/heading slug, 狀態類別, failStreak)] 序列
  + scan JSON 各 section 的 count
  + spectra entries 的 (name, bucket) 序列
)
```

**用 slug / bucket 不用全文**——全文會因為措辭微調產生假進度。`packaged` 新增、`[x]` 勾選、`failStreak` 變動、**bucket 位移**都會改 fingerprint，都是真進度。

與 state 裡的舊 fingerprint 比對：相同 → `fingerprintUnchangedRounds += 1`；不同 → 歸零。

### 6.2 停止條件（任一成立即停；**每一條**都 MUST 跑 `work-loop-lock.ts release --session <id>`）

| 件 | 條件 |
| --- | --- |
| No-progress | `fingerprintUnchangedRounds >= 3` |
| Turn cap | `--unattended` 已處理 3 items（**含收割後補 dispatch 的**）；interactive `round >= 12` |
| Budget proxy | **本 run 內**（per lock session，歸零時機見 Step 0 § 互斥鎖）`subagentsSpawned >= 15`，或 lock timestamp 距今 ≥6h |
| 非生產 | `nonProductiveRounds >= 2`（見 6.3） |
| 系統性失敗 | `consecutiveDispatchFailures >= 2`（escalated 項不計入——它們本輪未 dispatch，沒有新失敗事件） |
| Scan 失敗 | Step 2 已 STOP |
| Step 1 中止（`context-decay` / `handoff-write-failed`；兩者都寫 `roundEndReason`，**NEVER** 寫成 `stoppedReason`——唯一例外是 D4 連續第 2 輪，那時兩個都寫） | Step 1 已 STOP |
| 真正做完 | 四組皆空 ∧ `inFlight` 空 ∧ 無未 packaged 的非自主 item ∧ `techDebtHygiene.raw.flow.actionableOpen == 0`（**NEVER 讀 open 總數**，見下） |

**「真正做完」讀 `actionableOpen`，NEVER 讀 open 總數。** `techDebtHygiene.raw` 的 `flow.actionableOpen` = open class 扣掉 `blocked-attended-only`（機制擋著）與 `wontfix-until-signal`（等外部 signal）。open 總數含結構性 open，**在設計上就不可能歸零**——拿它當判準的迴圈永遠不會停，而那看起來會像「還有很多事沒做」，不像「判準寫錯了」。

**軟配額——`landed` 桶非空時，本輪 3 items 中 MUST 至少 1 項是 close/verify**（驗收 landed / 改判 wontfix / rotate 進 archive），不是 open/登記。`flow.window.closedInWindow == 0` 而 `openedInWindow > 0` 時這條**升為硬性**：不足額就不算合法進度。

**這不是禁止登記**：帶 `**Blocker**:` 的新條目與 packaging 決策**無條件通過**——要掐斷的是「量測 → 登記 → 下輪再讀一次」的自循環（2026-08-13 實測近 7 天 opened 40 / closed 10）。

**NEVER 靠改 status 讓 `actionableOpen` 下降。** 把 open 改標 `blocked-attended-only` 會當場讓停止條件成立——Invariant 12 是這一格的唯一防線，`blockedWithoutGate` 非 0 時 **`actionableOpen` 讀數不可信，MUST 先修完再判停**。

**寫 `stoppedReason` 之前 MUST 先清一次 `blockers` ledger**（逐條重量 predicate，值變了或 predicate 已不成立就刪條目）——誤入表的 item 不會出現在 candidate list 裡，所以「四組皆空」這個判準看不到它們。清完仍空才算真正做完，詳見 [reference/blocker-ledger.md](reference/blocker-ledger.md) § 清 ledger 是正當工作。

`fingerprintUnchangedRounds == 2` 且 `inFlight` 空 → 不停，但下次 `ScheduleWakeup` 退到長間隔。

**in-flight ledger > 0 就不是停止狀態**，即使 candidate list 空——background agent 完成後狀態會位移（`applyInProgress` → `ready` → `done`），此時退出 = 成果懸空等 user 手動善後。

### 6.3 生產性判定（**每一輪**收輪時算，含 runner child 的每一輪；只當停止條件用，NEVER 當本輪目標）

本輪為**生產輪**，若下列 P1–P4 **任一**成立（由 round-start 基線與 `git diff <round-start-sha>..HEAD` 機械判定）：

| # | Predicate | 機械判法 |
| --- | --- | --- |
| P1 | Tier A 淨減 | Tier A 檔（`HANDOFF.md`、`tasks/*.md`、`docs/tech-debt.md`）行數合計下降，**且**通過 entropy 過濾：本輪 diff 中 Tier A 移除行若與 `docs/archives/**`、`*-bodies.md`、`docs/pitfalls/**` 的新增行**含相同 `TD-\d+` id 或行級匹配 ≥70%**，該部分減量**不計**。過濾後仍 <0 才算 |
| P2 | 交付物 landed | 本輪 commit 觸及 `rules/core/`、`rules/modules/`、`vendor/`、`plugins/hub-core/`、`scripts/`（`.clade/` 除外），且該 item 已過 Step 5 收割的 scope-verify |
| P3 | TD 關閉帶憑證 | `docs/tech-debt.md` 有 heading 消失，且同輪 commit 內含該條 `### 自驗` 的實跑輸出、或 state `decisions` 對應條目、或一行 wontfix 理由＋可觀察 signal predicate。**heading 消失但三種憑證皆無 = 不計 P3 也不計 P1**（那是刪除不是關閉） |
| P4 | 新決策 packaging | `awaiting[]` 新增**先前未出現過的 id** 的完整條目（含 options）。**單輪 P4 至多貢獻一次**——三條 packaging 不等於三輪份的生產 |

皆不成立 → `nonProductiveRounds += 1`（state 新欄位，Step 7.3 寫）；任一成立 → 歸零。
**與軟配額的關係是包含，不是並列**：軟配額（6.2）不足額的輪，P1–P4 的計入資格直接取消，該輪**必為**
非生產輪；反向不成立。**兩條 NEVER 矛盾**——嚴者恆贏。entropy 過濾完整算法、P1–P4 邊界案例、N=2 的
理由、包含關係的完整論證、反 Goodhart 防線見 [reference/productivity-gate.md](reference/productivity-gate.md)。

---

## Step 7 — 寫 HANDOFF + state

### 7.1 路徑 invariant

`HANDOFF.md` / `docs/tech-debt.md` / `openspec/ROADMAP.md` **MUST** 寫到 main worktree absolute path——用 `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` 解。**禁止**用 cwd-相對路徑寫這幾個檔（在 linked worktree 內跑會寫進 worktree 副本，下一輪讀到舊版）。

### 7.2 HANDOFF 的一個段

**Iron Law：HANDOFF 先寫、state 後寫，順序不可對調。** 7.2 與 7.3 是兩個獨立寫入、**沒有原子性**，所以要讓失敗往無害的一側倒：

| 先寫誰 | 中途失敗後的下一輪 | 後果 |
| --- | --- | --- |
| **HANDOFF 先**（本 skill 的順序） | 待答條目已寫進 HANDOFF、state 沒記 → 下一輪重做一次已完成的 bookkeeping | 冪等、無害 |
| state 先 | state 說某條已 packaged、HANDOFF 卻沒有那條的選項 → Charles 看不到題目，佇列永遠不清 | 靜默失效 |

**7.2 寫入失敗時 NEVER 繼續寫 7.3 的 bookkeeping** —— 中止本輪並照 Step 1 § D4 的**部分寫入白名單**落檔：只寫 `roundEndReason`（＋連續第 2 輪的 `stoppedReason`），`round` / `fingerprint` / `inFlight` 等其餘欄位一律不動。「state 先落下來至少不會丟進度」是製造死鎖的那個推論，**NEVER** 採用。

**NEVER 把 loop 進度 render 進 HANDOFF**（2026-08-13 TD-495 起）。`.clade/work-loop/state.json` 是進度的**唯一** SoT；每輪整段覆寫一份它的 markdown 副本，買到的只有「每輪一次必然的 diff ＋ 一份會過期的第二現況」。要看進度跑 `jq . .clade/work-loop/state.json`。

**舊 marker 遷移（每輪 MUST 檢查，不是只在第一輪）**：HANDOFF 若存在 `<!-- BEGIN: work-loop-status -->`、`<!-- BEGIN: loop-engineer-status -->` 或 `<!-- BEGIN: handoff-loop-status -->` 包夾的段落 → **整段刪除**（連 marker 連 `## Work Loop Status` 標題），**不產生取代內容**。**NEVER** 因為「本輪有值得記的發現」就把它寫回 HANDOFF —— 那類發現的載體是 TD entry / pitfall / `tasks/`，不是 HANDOFF。

`## ⏳ Awaiting Charles` —— 格式見 [autonomy-predicate.md](reference/autonomy-predicate.md) § 段模板。**Append 不覆寫**（尚未答的舊決策不能被沖掉）；已答的由下一輪 scan 判定移除。

### 7.3 落 state 檔

把 Step 1 schema 的每個欄位更新後寫回 `.clade/work-loop/state.json`（`.clade/` 已 gitignored）。`guardrailsAck` 用 Step 1.5 讀完的時間。

**`subagentsSpawned` 是唯一一個「不是累加就好」的欄位**：本輪 Step 0 的 `acquire` 回 `acquired` / `took-over` 時 MUST 從 **0** 起算（本輪派幾個就寫幾個），回 `reentrant` 才是舊值 + 本輪新增。判定與理由在 Step 0 § 互斥鎖，**此處不複述**——但 **NEVER** 因為「schema 範例長得像單調遞增」就無條件累加，那會讓 Step 6.2 的 budget proxy 退化成跨 run 單調計數（門檻一旦跨過就永遠為真，[[TD-424]] 同型）。

**Iron Law：NEVER 直接覆寫 `state.json`。一律 temp → 驗 → 備份 → rename。** 這個檔是整個 loop 的**唯一**記憶載體（Step 1 Iron Law：不依賴對話記憶），寫壞它等於把 N 輪進度一次歸零，而失敗完全靜默——寫入工具照樣回成功，下一輪才在讀取端炸開。

**寫入一律走 `work-loop-state-write.ts`，NEVER 自己生成一支 write-state script。** 上面那個序列逐輪不變，逐輪變的只有欄位值 —— 所以本輪要產出的只有一份 **patch**（改了什麼寫什麼），沒改的欄位不必重述：

```bash
PATCH="$(mktemp -t work-loop-patch.XXXXXX)"
cat > "$PATCH" <<'JSON'
{ "round": <N>, "lastRoundAt": "<ISO>", "sessionNote": "<本輪一句話>", "…": "…" }
JSON
node ~/offline/clade/vendor/scripts/work-loop-state-write.ts --patch "$PATCH"
rm -f "$PATCH"
```

patch 語義：**給值＝覆蓋、給 `null`＝刪除、沒提到＝原值不動**。合併是**淺層**的，**NEVER** 期待深合併 —— `awaiting[]` / `blockers` / `decisions` 的正確更新常常是「整個換成本輪算出來的版本」，深合併會把已經移除的條目悄悄留下來。

該 script 已內建四道，**NEVER** 因為「這輪只改一個欄位」就改用 `>` 直接覆寫來繞過：

- 新內容寫進同目錄 temp 後**讀回來 parse 一次**才換正本（rename 要原子就必須同目錄）
- `.bak` 先寫 temp 再 rename —— `cp` 中途失敗不會把既有備份截斷。漏掉這道的長相是：`.bak` 寫壞、正本照換、還印 `STATE_OK`，兩份一起沒了
- 換檔用 `rename(2)`（即 `mv -T` 語義）：`state.json.bak` 若是**目錄**（前一次救援留下的、或誰手滑 mkdir 的）直接失敗，**NEVER** 把備份搬進那個目錄還回成功。實測（2026-08-12）：無 `-T` 時該情境回 `STATE_OK` 而備份根本不存在
- `round` 不得倒退 —— 倒退代表本輪讀到的是舊 state 或 patch 算錯，續寫會靜默吃掉中間輪次的 bookkeeping。確認過是刻意的才加 `--allow-round-regress`
- retention pass（`--no-retention` 關閉）—— 契約見 Step 1 § Retention。archive **先**落地才換正本，所以被移出正本的內容不會兩邊都不在

**stderr 的 `STATE_ARCHIVE_FAILED` / `STATE_OVERSIZE` 都不是失敗 token**（stdout 仍是 `STATE_OK`、exit 0），**NEVER** 因為看到它們就中止本輪 bookkeeping：

- `STATE_ARCHIVE_FAILED: <原因>` —— 本輪不 rotate、state **照原樣完整**寫入。正本是完好的，停下來只會製造 `state.round` < HANDOFF 的落差。記進 `sessionNote` 讓下一輪知道 archive 落點有問題，然後**照常收尾**
- `STATE_OVERSIZE: …｜前三大：<欄位=bytes>` —— 被點名的欄位是自創欄位（無 reader 契約），處置見 Step 1 § Retention：**當輪**收斂掉它

**現有 `state.json` parse 不過時它回 `STATE_CORRUPT_REFUSED` 並且不動正本**，**NEVER** 當成 `{}` 從頭寫 —— 那會讓 `round` 從 0 重來且每個欄位看起來都合法（處置走 Step 1 § `STATE_CORRUPT` 的還原程序）。

**看到 `STATE_WRITE_FAILED` / `STATE_BACKUP_FAILED` / `STATE_ROUND_REGRESS` / `STATE_CORRUPT_REFUSED` MUST 立刻停止本輪 bookkeeping**（`STATE_OK` 以外的每一個都是）：四者都保證正本仍是上一輪的完好版本，照 7.2 Iron Law 的無害方向倒（`state.round` < HANDOFF，下一輪冪等重做）。`STATE_BACKUP_FAILED` 額外意味著磁碟或權限有問題，**MUST** 在 `sessionNote` 記一筆再重試。**NEVER** 因為「內容應該沒問題」跳過驗證，也 **NEVER** 在失敗後改用直接覆寫繞過。

**`.bak` 只保留上一輪的完好版本，NEVER 累積多份帶時間戳的副本**——救援時要能一眼看出該還原哪一個。且 **NEVER 把寫壞的檔存成 `.bak-<ts>`**：那個名字會讓還原程序把屍體當備份撿起來（2026-08-12 <consumer-b> 實際留過一份，已改名 `state.json.corrupt-<ts>`）。

寫完 **MUST** 跑 `node ~/offline/clade/vendor/scripts/work-loop-lock.ts refresh --session <lockSessionId>`。鎖的 heartbeat 只在 Step 1 / Step 5 / 本步被刷，漏掉一次就讓還在跑的這一輪被下一輪判成死掉並接手——失敗長相是兩個 loop 同時跑、state 互相覆寫，沒有任何錯誤訊號。

**`decisions` 的內容 NEVER 在本步才寫**——Step 2.7 (c) 收到答案當下就已落檔。本步只是把 Step 2.7 之後又變動的欄位一併寫回。

### 7.4 Commit

```bash
git commit --only -m "📝 docs(handoff): work-loop round <N> 狀態段更新" -- HANDOFF.md <其他改過的檔>
git show --stat HEAD | tail -3   # 驗 scope
```

**NEVER** `git add` + `git commit` 兩段式——會吞掉別 session 預 stage 的內容。

**message 的 emoji 與中文 subject 都不是裝飾**：clade 與各 consumer 的 `commit-msg` hook 跑 commitlint，header 必須是 `<emoji> <type>[(<scope>)]: <subject>`，emoji 與 type 一對一綁定（`docs` 只能配 📝）。配錯或漏 emoji 會讓 header 整個解析失敗、並誤報成 `subject-empty`。clade 另有 `subject-has-chinese`，所以 subject 需含中文。

---

## 安全護欄

完整護欄清單 + dispatch 內嵌段 + 反藉口逐字實錄在 [reference/guardrails.md](reference/guardrails.md)——**每輪 Step 1.5 re-read 的就是那份**，此處不硬編碼條數，避免新增護欄後主檔漂移。最常被違反的三條各自寫在它們生效的位置：`AskUserQuestion` 的 mode 分岔在 Step 0 Iron Law、「非自主 item NEVER skip」在 Step 4b、「每輪 re-read」在 Step 1.5。

## Reference

| 檔 | 什麼時候 MUST 讀 |
| --- | --- |
| [guardrails.md](reference/guardrails.md) | **每一輪**（Step 1.5，hard rule） |
| [run-modes.md](reference/run-modes.md) | 決定怎麼起這個 loop 時（Step 0） |
| [productivity-gate.md](reference/productivity-gate.md) | 改准入／生產性判準之前（Step 0 § 開場准入判定、Step 6.3）——執行時不必讀 |
| [decision-drain.md](reference/decision-drain.md) | **每一輪**（Step 2.7，hard rule） |
| [simple-buckets.md](reference/simple-buckets.md)／[blocker-evaluation.md](reference/blocker-evaluation.md) | spectra item 命中固定步驟 bucket／`applyBlocked`・`awaitingUserDecision`（Step 3.1a） |
| [blocker-ledger.md](reference/blocker-ledger.md) | **任一** blocked item 進評估之前（Step 3.1a／3.1b）、以及寫 `stoppedReason` 之前（Step 6.2） |
| [non-spectra-dispatch.md](reference/non-spectra-dispatch.md) | 分類非 spectra candidate（Step 3.1b） |
| [autonomy-predicate.md](reference/autonomy-predicate.md) | 判自主 / 做 packaging（Step 3.2 / 4b） |
| [dispatch-topology.md](reference/dispatch-topology.md) | 分組（Step 3.3） |
| [harvest.md](reference/harvest.md) | 每個 notification 到達時（Step 5） |
| [no-wt-dispatch.md](reference/no-wt-dispatch.md) | Step 4a 判出 `/wt` 叫不動時（產地 clade home 恆命中） |
| [skill-relations.md](reference/skill-relations.md) | 查與其他 skill 的邊界、scope 排除清單 |

## 與其他 skill 的銜接

- `/handoff` —— 本 skill 不取代它。Mode A（登記）仍由 `/handoff` 做；本 skill 自動化的是 Mode B 的「盤點 → 推薦 → 執行」，並在 unattended 下把 `AskUserQuestion` 換成 packaging
- `/goal` —— attended 姊妹：user 在場、要逐項拍板 dispatch 優先序時用它
- `/spectra-apply` / `/spectra-archive` —— spectra item 的實際執行者，本 skill 只編排不介入其內部流程
- `/wt` —— 所有 tracked code 改動的 dispatch 入口
- `/loop`（內建）—— interval 盲跑某 prompt、stateless 無 verifier。「每 N 分鐘重跑 X」用它；「狀態驅動推進待辦」用本 skill
