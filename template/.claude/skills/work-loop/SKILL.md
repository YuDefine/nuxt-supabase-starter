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
- 使用者說「自動推」「把待辦跑完」「持續做」「不要停」「無人值守」→ 等同要求 continuous（見下）。

**沒有 `--turbo`。** 非 spectra 待辦（HANDOFF / tech-debt / ROADMAP）是**預設 scope**，不需要任何 flag 開啟。

### Iron Law：`AskUserQuestion` 的可用性由 mode 決定，不由 item 決定

| 可觀察 predicate | `AskUserQuestion` |
| --- | --- |
| `--unattended` 帶了，**或**本輪由 `runner.sh` 起（`claude --print`） | **NEVER 呼叫。** 選不出來的一律走 § Decision packaging 落 HANDOFF |
| 兩者皆非（user 在場的 in-session 呼叫） | 真的選不出來時 **MUST 問**，**NEVER** 靜默跳過可以問就解決的卡點 |

判不出自己在哪個 mode → **當作 unattended**（保守側是不打斷不在場的人）。

**這條分岔的理由是「人在不在場」，NEVER 是「這個 item 重不重要」。** 重要的 item 在 unattended 下同樣走 packaging，不是破例呼叫 `AskUserQuestion`——那會讓整個 loop 卡死在等人，而本 skill 存在的理由就是消掉那個等待。

同一條 mode predicate 也決定 Step 2.7 開場清算跑不跑：attended 跑完整清算（佇列清空才開工）、unattended 只跑 prune。細節見 [reference/decision-drain.md](reference/decision-drain.md) § Mode 分岔。

### 兩種跑法 —— 無人值守優先選 runner

無人值守走 `runner.sh`（每輪一個 `claude --print` process，context 歸零，連續性靠 state 檔）；
只想跑一兩輪或要邊看邊介入才用 in-session `/loop /work-loop`。

**決定怎麼起這個 loop 時 MUST 先讀 [reference/run-modes.md](reference/run-modes.md)** 取兩種跑法的完整對照、runner 指令與 flag、以及 in-session 版為什麼有 context 天花板。**NEVER** 因為「in-session 比較好觀察」就對長清單用 in-session 版——runner 每輪都留 log，觀察性沒有損失。

### Continuous invocation（hard rule）

單次 `/work-loop` = 一輪 scan → 分類 → dispatch/packaging → 收割 → 寫狀態。**一輪不是完成。**

- **直接呼叫**（非從 `/loop`、非 `--unattended`）→ **NEVER 自己跑完一輪就停**。先照下表 route 到承載這個 loop 的跑法，**NEVER** 無條件選 in-session：

  | 可觀察 predicate | route 到 |
  | --- | --- |
  | user 訊息帶無人值守意圖（「自動推」「把待辦跑完」「持續做」「不要停」「無人值守」），**或** 本輪 scan 出的 candidate 多到一個 session 跑不完 | **`runner.sh`** —— 主線**自己起**，形狀照 § 起 runner 的形狀與收尾契約 |
  | user 明說只跑一兩輪、或要邊看邊介入 | in-session `Skill invoke: /loop /work-loop`（dynamic mode，自我 pace） |
  | 判不出來 | **`runner.sh`** —— 主線**自己起**；保守側是續航力，不是觀察便利 |

  **route 判準是「這個 loop 要跑多久」，NEVER 是「哪個叫得比較順手」。** in-session 版的主線 context 每輪只增不減，撞門檻就只能走 decay gate 收工——把長清單放進 in-session 等同預先把它綁死在一輪（2026-08-06 round 26 / 27 連續兩輪實測，兩輪都以 `roundEndReason: context-budget-threshold` 結束，而 `runner.sh` 全程可用）。同一條理由的另一半在 [reference/run-modes.md](reference/run-modes.md) § 為什麼 in-session 版有天花板。
- **從 `/loop` 呼叫**（正常路徑）→ 每輪結束**先判「現在還有沒有事做」，再決定要不要排 wakeup**：

  | 可觀察 predicate | 動作 |
  | --- | --- |
  | candidate list 還有**未 triage** 或**已判自主但未執行**的 item | **NEVER 排 wakeup。立刻接著跑下一輪**（同一個 turn 內連續跑，不睡） |
  | in-flight ledger > 0，且扇出組還有空位 | **NEVER 排 wakeup。** 補 dispatch，或做主線即時組的工作 |
  | in-flight ledger > 0，扇出組已滿、主線即時組已空 | 排 wakeup，短 interval（60–180s）當 notification 的安全網 |
  | 所有 item 皆 completed / packaged / escalated / legal-skip，**且** in-flight = 0 | 排 wakeup，長 interval（1200–1800s heartbeat）——這是**唯一**可以睡長的狀態 |
  | Step 6 停止條件成立 | `ScheduleWakeup({stop: true})` |

  **Iron Law：`ScheduleWakeup` 是「現在無事可做」的宣告，NEVER 是「這輪做夠了」的休息。** 每一次排 wakeup 之前 MUST 能指出 candidate list 裡**每一個** item 現在都動不了、以及動不了的具體理由（已完成 / 已 packaging / 已 escalated / 命中 skip 窮舉 / 在等某個具名 notification）。指不出來就是還有事做，**接著跑**。

  逐條反藉口（「這輪做了 3 件夠了」「剩下的下一輪再做」等）見 [reference/guardrails.md](reference/guardrails.md) § D。

- **「完成」的定義**：Step 6 的停止條件任一成立。**NEVER** 把「本輪無 actionable item」當成完成——那只代表這一輪 scan 沒新東西，user 答完一條 packaged 決策後下一輪就會有。

### 開場 headroom 判定（在取鎖與 scan 之前）

route 表判完「這個 loop 由誰承載」之後、**跑 Step 2 的 scan 之前**，先判本 session 還有沒有餘裕跑完一輪：

| 可觀察 predicate | 動作 |
| --- | --- |
| 本 session 已收到過 context budget 提示（`session-context-budget-warn.sh` 的 300k / 500k 任一級） | **改走 `runner.sh`**——主線用 `Bash(run_in_background=true)` 起它，回報 log 路徑後結束本輪。**NEVER** 先跑 scan |
| 本輪由 `runner.sh` 起（`claude --print`），**或** 本 skill 是本 session 的第一個工作段 | headroom 充足，照常取鎖進 Step 1 |
| in-session、本 session 已做過別的工作、但還沒收到提示 | 照常進 Step 1，但 route 表「判不出來」那列**改判為 `runner.sh`**——餘裕不明時保守側是換載體 |

**這一步的位置就是它的全部價值**：scan、分類、Step 1.5 的 guardrails re-read 是一輪裡最先燒掉的一段固定成本，而它們產出的東西在「沒餘裕做事」時完全用不到。**NEVER** 用「先掃一輪看看有什麼再決定」把本步挪到 scan 之後——那正是本步要省掉的那筆開銷。

**改走 runner 是換載體，NEVER 是 skip。** 本步不讓任何一個 item 消失、不寫 `stoppedReason`、不進 § Skip 合法理由窮舉：待辦原封不動留在原處，由 runner 的下一個 process 從乾淨 context 接手。判完就**立刻**起 runner，**NEVER** 只在輸出裡建議 user 自己去跑（那是 Output contract 逐字禁止的 user call-to-action）。

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

起完 **MUST** 回報 log 目錄後結束本輪。**NEVER** 在主線空等，**也 NEVER** 排 wakeup 去輪詢 state 檔——退出通知由 harness 送達，輪詢買不到任何它沒給的東西。

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
| `== stop: state 連續 2 輪未前進` | 被 lock 擋掉或中途夭折 | **異常中止** + 那幾輪沒寫進 state |

**下三列都不是「跑完了」。** **NEVER** 把其中任何一列回報成待辦已推完，**也 NEVER** 只摘成功的那幾輪而不提中止——runner 每輪成功都印 `✓ round <n> 完成`，只讀那些行會產出一份看起來順利的假報告。命中下兩列時 **MUST** 一併附 `tail -20 <最後一個 log>`。

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

- **heartbeat**：**每一次**寫 `.spectra/work-loop-state.json` 的同時都 MUST 跑 `node ~/offline/clade/vendor/scripts/work-loop-lock.ts refresh --session <id>`（Step 1 / Step 5 **每一次**收割 / Step 7 各一次，不是只在 Step 7 刷）。窗口 45 分鐘
- **釋放**：**每一條**停止路徑（含失敗提早結束）都 MUST 跑 `node ~/offline/clade/vendor/scripts/work-loop-lock.ts release --session <id>`；in-flight ledger > 0 期間 **NEVER** 釋放

判準是**析取**——`heartbeat 在 45min 窗口內` **或** `pid 存活`，任一成立即為 active。舊版單看 `$$` 的合取判準在 in-session 模式下恆判 stale，鎖從未擋過任何一次（[[TD-424]]）。

**NEVER 用 Write tool、`printf`、`echo` 或任何其他方式手寫鎖檔。** 手寫的鎖沒有 session 識別也沒有 heartbeat，判準當場退回它要修的那個狀態：

| 逐字實錄的開脫 | 實際 |
| --- | --- |
| 「sandbox 擋掉 `$$`，用 Write tool 補一個鎖檔就好」（round 33） | 手寫的鎖第一行是**已結束的那個 Bash call 的 pid**，寫進去的當下就是死的 |
| 「pid 欄填 0 或哨兵值，反正判準會走 DEAD 分支」（round 30 / 36） | 那正是「鎖從未擋過任何一次」的成因，不是它的解法 |
| 「這支 script 在這個 repo 找不到，先跳過鎖」 | 找不到 = 路徑打錯。先 `ls ~/offline/clade/vendor/scripts/work-loop-lock.ts` 確認，**NEVER** 無鎖開跑 |

**Red Flag**：正要對 `.spectra/work-loop.lock` 下 Write / Edit / `printf` / `echo` —— 停手，回到上面那條指令。

宣布模式一句話後進 Step 1。

---

## Step 1 — State re-hydrate（durable execution，每輪必做）

**Iron Law：每一輪開頭 MUST 從 `.spectra/work-loop-state.json` 重建狀態，NEVER 依賴對話記憶。**

理由不是保守，是機制事實：主線 context 會被 auto-compaction 壓縮，壓掉的第一批就是「上一輪做了什麼」。狀態外部化之後，compaction 只丟敘事、不丟事實。

```bash
STATE="$(git rev-parse --show-toplevel)/.spectra/work-loop-state.json"
[ -f "$STATE" ] && cat "$STATE" || echo '{}'
```

```json
{
  "round": 7,
  "startedAt": "2026-08-05T03:11:00Z",
  "lastRoundAt": "2026-08-05T04:02:13Z",
  "fingerprint": "sha256:abc123…",
  "fingerprintUnchangedRounds": 1,
  "subagentsSpawned": 4,
  "consecutiveDispatchFailures": 0,
  "guardrailsAck": "2026-08-05T04:02:10Z",
  "lockSessionId": "mshkf6es-mptx87qc-ubuntu",
  "inFlight": [{ "agent": "wt-td317", "item": "TD-317", "dispatchedAt": "…" }],
  "packaged": { "TD-402": "2026-08-05T03:40:00Z" },
  "awaiting": [{ "id": "TD-402", "title": "grain 二選一", "packagedAt": "2026-08-05T03:40:00Z",
                 "round": 6, "blocker": "src/db/schema.ts:88 …", "startableDone": "index 已補齊",
                 "options": [{ "key": "A", "label": "…", "effect": "…", "recommended": true },
                             { "key": "B", "label": "…", "effect": "…" }],
                 "rationale": "…", "nextStep": "/wt td402: …" }],
  "decisions": { "TD-355": { "answer": "A", "note": "<Charles 逐字>", "answeredAt": "…" } },
  "failStreak": { "TD-388": 2, "fix-pinia-mutation": 1 },
  "escalated": { "add-audit-log": { "bucket": "applyBlocked", "reason": "…" } }
}
```

**檔案不存在** → 這是第 1 輪，用 `{round: 0}` 起手，Step 7 建檔。

**`awaiting` / `packaged` / `decisions` 三者的關係**（寫錯會讓已答的決策被重問，或已問的被當成沒問）：

| 欄位 | 語義 | 唯一寫入時機 |
| --- | --- | --- |
| `awaiting[]` | 待答決策佇列，**帶完整選項內容**。Step 2.7 清算的對象就是它 | Step 4b packaging 入列、Step 2.7 出列 |
| `packaged` | `awaiting[]` 的 `id → packagedAt` 投影，供 Step 2 排除用 | 與 `awaiting[]` 同步增刪，**NEVER** 單獨寫 |
| `decisions` | 已答的答案（含 Charles 逐字），**答完不刪**——後續輪次照它執行 | Step 2.7 (c) 收到答案當下 |

**舊 state 檔只有 `packaged` 沒有 `awaiting`**（本欄位之前的版本）→ 用 HANDOFF `## ⏳ Awaiting Charles` 的對應 `###` 子段回填成 `awaiting[]` 條目，回填不出來的（子段已不存在）直接把該 key 從 `packaged` 刪掉。

**`failStreak` / `escalated` 的來源是本檔，NEVER 是 HANDOFF 的 marker 段。** HANDOFF 段是**人讀輸出**——它可能被人手動編輯、被 rotate 搬走、被別的 skill 覆寫。狀態只認 state 檔。

**Escalated 離場規則**（對 `escalated` 每一條逐項判定，兩條 predicate 任一成立＝已有人介入，streak 歸零、移出 escalated）：

- 該 item 不再出現在本輪 scan（已 archive / 已刪除 / 已勾 `[x]`）
- 該 item 本輪狀態 ≠ escalated 條目記錄的狀態（已被推動）

兩條都不成立 → 續留 escalated（本輪**不 dispatch**），Step 7 原樣 re-emit。

**Decay 偵測（hard gate）**：`guardrailsAck` 讀不到、或 `round` 與 HANDOFF `## Work Loop Status` 段記載的輪次不一致 → **判定 context decayed**，**MUST** 結束本輪：state 寫 `roundEndReason: "context-decay"`、跑 `work-loop-lock.ts release --session <id>`、退出。**NEVER**「感覺還記得」就繼續跑。

**`roundEndReason` 與 `stoppedReason` 是兩件事，寫錯會讓 loop 提早死掉**：

| 欄位 | 語義 | runner 的反應 |
| --- | --- | --- |
| `roundEndReason` | **這個 process** 該結束（context 到頂、item cap 用完） | 起下一個全新 process 繼續 |
| `stoppedReason` | **整個 loop** 該停（真的做完 / fingerprint 三輪不變 / 連續失敗） | 不再起新 process |

context-decay **永遠**寫 `roundEndReason`，**NEVER** 寫 `stoppedReason`。

---

## Step 1.5 — Guardrails re-read（hard rule，dispatch 前）

**MUST Read [reference/guardrails.md](reference/guardrails.md) —— 每一輪都讀，不是只在第 1 輪讀。**

**NEVER** 因為「我這輪還記得護欄」「上一輪剛讀過」「這輪只做一個小 item」跳過。compaction 抹掉的正是「上一輪剛讀過」的那份 context，而它抹掉時不會通知你——你會覺得自己記得。re-read 的成本是 1KB，漏讀的成本是把不可逆動作當成可自主動作做掉。

讀完把 `guardrailsAck` 更新為當前 ISO 時間（Step 7 落檔）。

---

## Step 2 — Scan

```bash
# MUST mktemp 唯一路徑——固定路徑是全機器所有 consumer 共用，多 session 會互相覆寫
SCAN="$(mktemp -t work-loop-scan.XXXXXXXXXX)"
node ~/offline/clade/vendor/scripts/handoff-scan.ts --json > "$SCAN" 2>/dev/null
# MUST 落檔後立刻驗歸屬，不符就當 scan 失敗處理
EXPECT="$(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")"
GOT="$(jq -r '.consumerId // "MISSING"' "$SCAN")"
[ "$GOT" = "$EXPECT" ] && echo "scan ok: $GOT" || echo "SCAN-MISMATCH: got=$GOT expect=$EXPECT"
# spectra repo 才有 parked（無 openspec 時回空，屬正常）
PARKED="$(spectra list --parked --json 2>/dev/null || echo '{}')"
```

**失敗 fallback**：script 不存在或回 error、**或 `SCAN-MISMATCH` / `MISSING`** → **STOP**，寫 HANDOFF 一行 `work-loop: scan failed at <ISO>`，跑 `work-loop-lock.ts release --session <id>` 後結束。`SCAN-MISMATCH` 表示讀到別 repo 的掃描結果（unattended 下危害最大：無人在旁審視就照它推進待辦）。**NEVER** 憑記憶或 HANDOFF 既有 narrative 猜待辦狀態。

### 單一 candidate list，兩種 source

| source | 來自 | 進 Step 3 走哪條 |
| --- | --- | --- |
| `spectra` | `reviewGuiReadiness.raw.entries[]` + `PARKED` 的 parked change | § 3.1a bucket 路由 |
| `handoff` / `techdebt` / `roadmap` | `HANDOFF.md` 待辦段、`techDebtHygiene.raw`、`openspec/ROADMAP.md` | § 3.1b 分類表 |

- **`HANDOFF.md`** —— 掃 `## In Progress` / `## Blocked` / `## Next Steps` / `## Outstanding` / `## Follow-up`（heading 名因 consumer 而異，靠 `##` / `###` 辨識）。`- [ ]` 未勾項 = 一個 candidate；`- [x]` 跳過；純文字段落視為單一 candidate
- **`docs/tech-debt.md`** —— **NEVER 整讀主檔**（2026-08-06 實測 clade 196KB / <consumer-b> 363KB，整讀一次吃掉大半預算）。從 `techDebtHygiene.raw` 取，優先序三層：`stale`（>60d）→ `aging`（>14d）→ 其他 `open`。需要細節時用 `raw` 的 `lineNo` **定點 Read**（`offset` + `limit`）

  ```bash
  wc -c docs/tech-debt.md   # 上面兩個數字的來源。主檔隨 rotate / 新增增減，複跑取當前值
  ```
- **`openspec/ROADMAP.md`** `## Next Moves` 的 `###` 子段（存在時）
- **`worktreeStash`** —— `mergedToMain: false` 的 wt 與每一筆 stash

**Consumer filter**：只處理 `consumerId` = 當前 repo 的 entries。**Spectra change association**：非 spectra source 的 candidate 若文字命中 active change name（word boundary match，非 substring）→ 改判為 `spectra` source 走 3.1a，避免降級成 ad-hoc brief 而丟失 phase 結構與 evidence 收集。細節見 [reference/non-spectra-dispatch.md](reference/non-spectra-dispatch.md) § Spectra change association。

**In-flight filter（防單 item 雙派）**：已有對應 worktree 的 item **不一定跳過**，先查 `.clade/claims/` 的 session claim 鮮度——active claim < 30min 才跳過；claim > 2h 或無 claim 視為可接手。**每一個** dispatch 前都要對照，不是只在開場檢查一次。

**排除**：state 的 `packaged` 已有 timestamp、或 `escalated` 未離場的 item，本輪跳過。

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

**為什麼是實跑**：2026-08-05 <consumer-a> 實證——`scripts/lib/detect-runtime.ts` 從未被散播，
四支入口（`dev-session` / `dev-singleton` / `db-lease` / `claims-lib`）全部
`ERR_MODULE_NOT_FOUND`。**那四支檔案本身都在**，`[ -f ]` 一路綠燈；死的是它們 import 的東西。
該輪因此白派了一個 worktree agent 出去，回來才知道 dev-port 組整組不可用。

**為什麼第 0 步在實跑之後**：2026-08-06 round 27 於 clade home 實測——`node scripts/wt-helper.ts list` 回 `MODULE_NOT_FOUND`，而 wt-helper 在產地是 `vendor/scripts/wt-helper.ts`、**完全正常**。照 1–3 步處置會把 main 組 + 扇出組整組標成不可用，該輪所有 item 走 packaging，空轉一輪——而 clade home 正是 `/work-loop` 目前唯一的實跑場地（[[TD-395]]）。**實跑擋得住「檔案在但 import 死了」，擋不住「探針量錯檔」**，兩者的輸出無法區分，所以要有獨立的第 0 步。

---

## Step 2.7 — 開場決策清算（每一輪都跑）

**MUST 先完整讀 [reference/decision-drain.md](reference/decision-drain.md) 再執行**——每一輪都讀，不是只在第 1 輪讀。

### Iron Law：attended 下 `awaiting[]` 非空 NEVER 開工

**佇列非空時 NEVER 進 Step 3、NEVER 進 Step 4。** 先清空，再開工。

順序是「先清算，後開工」，不是「邊做邊找機會問」。Charles 在場的那一段**正是**他準備離開座位的那一段——把問題留到「做完手上這件再問」，多數時候等同留到他已經走了。

**判準是 mode，不是題數、不是急迫性。** 佇列剩 1 題和剩 9 題同一條規則；「這幾條都不急」不構成延後——不急的題目照樣佔著佇列。

### 三步

| 步 | 做什麼 |
| --- | --- |
| (a) Prune | 對 `awaiting[]` **每一條**逐條判定：已不在本輪 scan → 移除不問；依 [autonomy-predicate.md](reference/autonomy-predicate.md) § Iron Law 重判後**現在**寫得出「推薦 A + 站得住的理由」且未命中 predicate 7 → 移出佇列當自主 item 做掉，**NEVER** 拿去問 |
| (b) Ask | 剩下的**全部問完**，`AskUserQuestion` 一次 ≤4 題、連續發到佇列清空。**沒有題數上限**，**NEVER** 問一批就先開工 |
| (c) Record | **每一個**答案立刻三處同步落檔（`decisions` 寫入 / `awaiting` + `packaged` 移除 / HANDOFF 子段刪除），**MUST 在進 Step 3 之前完成**——runner 每輪是全新 process，沒落檔的答案等於沒答 |

### Mode 分岔

| 可觀察 predicate | 本步怎麼跑 |
| --- | --- |
| **attended**（非 `--unattended` 且本輪非 `claude --print` 起） | 跑完整 (a)(b)(c)，佇列清空才進 Step 3 |
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
| 8 | `applyBlocked` | 3i | **評估 blocker**（[blocker-evaluation.md](reference/blocker-evaluation.md)） |
| 9 | `awaitingUserDecision` | 3j | **評估決策需求**（同上） |
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

### 4b. 非自主 item → decision packaging

**NEVER log + skip。** 依 [autonomy-predicate.md](reference/autonomy-predicate.md) § Packaging SOP 做三件事（蒐證 → 抽 startable 子集先做掉 → 寫 2–3 個排序選項進 HANDOFF `## ⏳ Awaiting Charles`），完成後**同步**寫進 state 的 `awaiting[]`（完整條目：`id` / `title` / `blocker` / `startableDone` / `options` / `rationale` / `nextStep` / `packagedAt` / `round`）與 `packaged`（id → ISO 投影）。

**`awaiting[]` 是 Step 2.7 清算的唯一輸入。** 只寫 HANDOFF 不寫 `awaiting[]` = 這條決策永遠不會被端到 Charles 面前，退回本步存在之前的累積狀態——**NEVER** 只寫其中一邊。

**packaging 本身算合法進度**——它會改變 fingerprint，Step 6 不會誤判成空轉。

attended mode 且真的選不出來 → 依 Step 0 Iron Law **MUST `AskUserQuestion`**；unattended / runner → packaging，**NEVER** 呼叫。

### 4c. Dispatch 共通規則

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

**每一個** `<task-notification>` 到達時 **MUST 先完整讀 [reference/harvest.md](reference/harvest.md)** 走它的 8 步 SOP（驗收 → scope-verify → 高擴散半徑 change 的 checker subagent → 更新 progress → re-scan → 檢查新 actionable → 更新 ledger → 補滿扇出組），與等待機制（notification-only + `ScheduleWakeup` 1500s 安全網 + **2h 無回報強制退出**）。**NEVER** 憑印象跑收割——漏掉 scope-verify 或 checker 那兩步，未驗證的改動會直接進 main。

state 更新：成功 → 該 item `failStreak` 歸零、來源條目勾 `[x]` 或補完成摘要（讓下一輪不重複做）；失敗 → `failStreak[item] += 1`、`consecutiveDispatchFailures += 1`，≥3 進 `escalated`。兩者都要從 `inFlight` 移除。**每一次**收割寫完 state 後都 MUST 跑 `work-loop-lock.ts refresh --session <id>`（per Step 0 § 互斥鎖），不是只有最後一次。

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
| Budget proxy | `subagentsSpawned >= 15`，或 lock timestamp 距今 ≥6h |
| 系統性失敗 | `consecutiveDispatchFailures >= 2`（escalated 項不計入——它們本輪未 dispatch，沒有新失敗事件） |
| Scan 失敗 | Step 2 已 STOP |
| Context decay | Step 1 已 STOP |
| 真正做完 | 四組皆空 ∧ `inFlight` 空 ∧ 無未 packaged 的非自主 item |

`fingerprintUnchangedRounds == 2` 且 `inFlight` 空 → 不停，但下次 `ScheduleWakeup` 退到長間隔。

**in-flight ledger > 0 就不是停止狀態**，即使 candidate list 空——background agent 完成後狀態會位移（`applyInProgress` → `ready` → `done`），此時退出 = 成果懸空等 user 手動善後。

---

## Step 7 — 寫 HANDOFF + state

### 7.1 路徑 invariant

`HANDOFF.md` / `docs/tech-debt.md` / `openspec/ROADMAP.md` **MUST** 寫到 main worktree absolute path——用 `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` 解。**禁止**用 cwd-相對路徑寫這幾個檔（在 linked worktree 內跑會寫進 worktree 副本，下一輪讀到舊版）。

### 7.2 HANDOFF 兩個段

`## Work Loop Status`（`<!-- BEGIN: work-loop-status -->` / `<!-- END: work-loop-status -->` marker 包夾，**每輪整段覆寫**）。模板見 [reference/handoff-template.md](reference/handoff-template.md)。

**舊 marker 遷移（每輪 MUST 檢查，不是只在第一輪）**：HANDOFF 若存在 `<!-- BEGIN: loop-engineer-status -->` 或 `<!-- BEGIN: handoff-loop-status -->` 包夾的段落 → **整段刪除**（連 marker），內容以本輪新段取代。**NEVER** 讓兩個世代的 status 段並存——讀者無法判斷哪個是現況，而舊段不會再被任何東西更新。

`## ⏳ Awaiting Charles` —— 格式見 [autonomy-predicate.md](reference/autonomy-predicate.md) § 段模板。**Append 不覆寫**（尚未答的舊決策不能被沖掉）；已答的由下一輪 scan 判定移除。

### 7.3 落 state 檔

把 Step 1 schema 的每個欄位更新後寫回 `.spectra/work-loop-state.json`（`.spectra/` 已 gitignored）。`guardrailsAck` 用 Step 1.5 讀完的時間。

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

完整 19 條 + dispatch 內嵌段 + 反藉口逐字實錄在 [reference/guardrails.md](reference/guardrails.md)——**每輪 Step 1.5 re-read 的就是那份**，此處不複述以免兩邊漂移。最常被違反的三條各自寫在它們生效的位置：`AskUserQuestion` 的 mode 分岔在 Step 0 Iron Law、「非自主 item NEVER skip」在 Step 4b、「每輪 re-read」在 Step 1.5。

## Reference

| 檔 | 什麼時候 MUST 讀 |
| --- | --- |
| [guardrails.md](reference/guardrails.md) | **每一輪**（Step 1.5，hard rule） |
| [run-modes.md](reference/run-modes.md) | 決定怎麼起這個 loop 時（Step 0） |
| [decision-drain.md](reference/decision-drain.md) | **每一輪**（Step 2.7，hard rule） |
| [simple-buckets.md](reference/simple-buckets.md)／[blocker-evaluation.md](reference/blocker-evaluation.md) | spectra item 命中固定步驟 bucket／`applyBlocked`・`awaitingUserDecision`（Step 3.1a） |
| [non-spectra-dispatch.md](reference/non-spectra-dispatch.md) | 分類非 spectra candidate（Step 3.1b） |
| [autonomy-predicate.md](reference/autonomy-predicate.md) | 判自主 / 做 packaging（Step 3.2 / 4b） |
| [dispatch-topology.md](reference/dispatch-topology.md) | 分組（Step 3.3） |
| [harvest.md](reference/harvest.md) | 每個 notification 到達時（Step 5） |
| [no-wt-dispatch.md](reference/no-wt-dispatch.md) | Step 4a 判出 `/wt` 叫不動時（產地 clade home 恆命中） |
| [handoff-template.md](reference/handoff-template.md) | 寫 HANDOFF status 段前（Step 7.2） |
| [skill-relations.md](reference/skill-relations.md) | 查與其他 skill 的邊界、scope 排除清單 |

## 與其他 skill 的銜接

- `/handoff` —— 本 skill 不取代它。Mode A（登記）仍由 `/handoff` 做；本 skill 自動化的是 Mode B 的「盤點 → 推薦 → 執行」，並在 unattended 下把 `AskUserQuestion` 換成 packaging
- `/goal` —— attended 姊妹：user 在場、要逐項拍板 dispatch 優先序時用它
- `/spectra-apply` / `/spectra-archive` —— spectra item 的實際執行者，本 skill 只編排不介入其內部流程
- `/wt` —— 所有 tracked code 改動的 dispatch 入口
- `/loop`（內建）—— interval 盲跑某 prompt、stateless 無 verifier。「每 N 分鐘重跑 X」用它；「狀態驅動推進待辦」用本 skill
