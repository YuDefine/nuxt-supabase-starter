# 兩種跑法：runner process vs in-session turn


> 主檔 pointer：Step 0 決定怎麼起這個 loop 時 MUST 讀本檔。**已經在跑的輪次不必再讀**——
> 本檔管的是「怎麼起」，不是「怎麼跑」。

## Host selection contract

Choose a runner only when the current host provides a verified same-runtime runner and durable wakeup/receipt surface. Otherwise use an attended in-session round when supported; continuous or unattended execution is blocked and must retain durable state and ownership. Codex readers must not execute the Claude commands below.

## Claude host adapter: concrete runner operations

The following `runner.sh`, `claude --print`, `Bash(run_in_background=true)`, `TaskOutput`, `TaskStop`, `ScheduleWakeup`, and `Monitor` examples are Claude-only bindings. They implement the common obligations but do not redefine them for other hosts.

| 跑法 | 一輪的邊界 | context | 什麼時候用 |
| --- | --- | --- | --- |
| **`runner.sh`（預設）** | 一個 `claude --print` **process** | **每輪歸零** | 無人值守、待辦多、要跑久。這是本 skill 的主要跑法 |
| in-session `/loop /work-loop` | 一個 turn | 單調成長，數輪後撞頂 | 只想跑一兩輪、或要邊看邊介入 |

```bash
# MUST 用絕對路徑；在哪個 repo 的 cwd 跑就作用於哪個 repo
cd <目標 repo> && ${CLADE_HOME:-$HOME/offline/clade}/capabilities/core/skills/work-loop/runner.sh --max-rounds 20
cd <目標 repo> && ${CLADE_HOME:-$HOME/offline/clade}/capabilities/core/skills/work-loop/runner.sh --dry-run
```

主線起它的形狀與收尾契約見下方 § 起 runner 的形狀與收尾契約。

`runner.sh` 的 flag：`--max-rounds <n>`（預設 20）、`--dry-run`（只印每輪會下的指令）、
`--permission-mode <mode>`（預設 `acceptEdits`；**NEVER** 預設 `bypassPermissions`——那會連
破壞性指令一起放行，要更寬鬆 MUST 由使用者顯式指定）、`--skip-preflight`、`--min-ready <n>`
（預設 3，0 = 關掉）、`--min-wakeup <秒>`（預設 1200）。runner 另內建只批准該 repo 的
`Bash(node "<CLADE_HOME>/vendor/scripts/work-loop-scan.ts")`（以及顯式 `--preflight`）與 closedBloat 的 `rotate-closed-bloat.ts` 精確 invocation——`<CLADE_HOME>` 是 runner 啟動時把 `${CLADE_HOME:-$HOME/offline/clade}` 展開後的絕對路徑，同一字串也經 `--scan-helper-command`／`--rotate-helper-command` 交給 child；helper 在單一 process
內完成 scan / parse / owner 驗證 / rotate / atomic rename，其他 Bash 仍照 permission mode 與使用者
permission rules 判定。每輪另固定帶模型可見的
`--runner-child` 與 `WORK_LOOP_RUNNER_CHILD=1`；Step 0 命中任一身分就只執行單輪，NEVER 再啟 runner。

每輪 log 落在 `.clade/work-loop/logs/round-<ts>.log`。

## 起跑前的四道門：有沒有人在跑、跑得起來嗎、有事可做嗎

runner 在跑第一輪之前先過四道門，任一不過就**一輪都不跑**、理由落在
`.clade/work-loop/logs/preflight.log`：

| 門 | 檢查什麼 | 不過時的 exit code 與語義 |
| --- | --- | --- |
| **orphan quarantine** | `inFlight` 非空 / 不可解析，或持久 `orphan-quarantine.json` 尚未由 attended reconciliation 清除 | `5` —— 禁止自動 retry；attended 將 ownership 標成 terminal/cancelled、清空 ledger、移除 marker 後才可重跑 |
| **互斥鎖** | `work-loop-lock.ts status --json` 回 `held=true`（判準 SoT 在該檔，**NEVER** 在 bash 重寫） | `6` —— **已有 runner 在跑，不是故障**；等持鎖的那一個跑完。**NEVER** 刪鎖或再起第二個 |
| **preflight** | PATH 上有 `claude` / `node`、repo 可寫、三種待辦源至少一個讀得到、**headless child 真的能跑一個 Bash tool call** | `3` —— 系統性故障，查權限閘門與環境 |
| **待辦源健康門檻** | `work-loop-ready-count.ts` 數出的 ready item ≥ `--min-ready`（預設 3） | `4` —— **待辦枯竭，需 attended 補彈藥**，不是故障 |

headless 探針以顯式 `--preflight` 加 nonce **實際執行同一支 helper**；只有 repo-local nonce proof marker 的內容逐字匹配才通過（child `exit=0` 或 helper stdout 都不是 proof）。

探針誤判過嚴時走 `--skip-preflight`（`--dry-run` 自動略過 preflight 與待辦源健康門檻），**NEVER** 靠拿掉探針本身解決。`--skip-preflight` **不**略過互斥鎖門檻——鎖被持有不是探針誤判；`--dry-run` 略過互斥鎖門檻（只印指令，不該拒絕）。

### headless child 使用官方訂閱帳號

preflight 與每輪 child 都經 `project-unattended.ts` 檢查專案授權、需求版本及執行持有者，再由
`claude-account-routing.ts` 驗證官方訂閱登入與最新 quota 快照，在 `cc`／`ccw` 間選擇可用帳號。
帶 `ANTHROPIC_BASE_URL` 的 session（含已拆除的 gateway 入口 `ccg`／`ccx`）會拒絕起跑。

第一次起跑需先開啟該專案的自動開發（`node "${CLADE_HOME:-$HOME/offline/clade}/vendor/scripts/flow/project-automation-cli.ts" <project> --on --reason '<為什麼>'`；只帶 `<project>` 印目前狀態，`--off` 會讓執行中的自動 owner 收手），並確保 consumer 已接收 flow 投影、位於
`consumers.local`、官方帳號已登入且 ai-quota 快照仍有效。缺少前置時錯誤會指出原因；
`--skip-preflight` 只略過 headless 工具探針，不略過訂閱、版本或專案授權。
`--dry-run` 只印完整控制入口與 child 指令，不要求 consumer 已安裝 helper。

ready-count helper 與 lock helper 缺席或輸出無法解析時**放行**（門檻是省成本的優化）。

## 待答決策佇列：runner 只印不擋

runner 起跑時讀 state 的 `awaiting[]`，非空就印一行提示（幾條待答、跑 attended `/work-loop`
可清算），然後**照常開跑**——**NEVER** 因此 exit≠0、**NEVER** 加 flag 要求先清算。

無人值守輪次只排除佇列裡那幾條 item，其餘全部照推；清算由下一次 attended 開場的 Step 2.7 承擔。

## 為什麼 in-session 版有天花板

主線 context 每輪只增不減，數輪後只能走 decay gate 收工；runner 每輪 `claude -p` 是全新 session，連續性由 state 檔承擔。**NEVER** 因為「in-session 比較好觀察」就對長清單用 in-session 版（runner 每輪都留 log）。route 判定表在 SKILL.md Step 0 § Continuous invocation。

## runner 停止 vs 換 process

runner 只認 state 檔的 `stoppedReason`（整個 loop 該停）；`roundEndReason`（這個 process 滿了）
會讓它起下一個全新 process 繼續。兩者的語義差別與寫錯的後果見 SKILL.md Step 1。

### 從外面要求它停：寫 sentinel，NEVER 改 `state.stoppedReason`

```bash
echo '停止理由' > "$(git rev-parse --show-toplevel)/.clade/work-loop/stop"
```

runner 在**每輪開始前**檢查它，語義是「當前這輪跑完就停」，不腰斬 in-flight 的一輪。命中後
sentinel 會被消費掉（一次性），下一次起 runner 不受影響。

**NEVER 從外部寫 `state.stoppedReason`**：child 在 Step 7 整份寫回 state，外部寫入會被靜默覆蓋。child **自己**寫它仍是正解。

runner 自己的停止分類：`stoppedReason` 出現、達 `--max-rounds`、連續 2 輪 exit≠0、
round 數連續 2 輪未前進，或 exit 5 的 orphan quarantine、exit 6 的互斥鎖門檻。exit failure streak 與 no-progress streak
彼此獨立，只有 round 真正前進才同時重設；交錯出現不算恢復。

**語義差別 MUST 出現在收尾回報裡**，逐列對照見下方 § 起 runner 的形狀與收尾契約 (c)。

## per-round Monitor 指令原型

下方 (e) 要 arm 的就是這一份，**照抄，NEVER 自己重寫**（`<repo>` 換成目標 repo 絕對路徑）。

```text
Monitor({ persistent: true, description: "work-loop round 進度（<repo> ）", command: <<'EOF'
cd <repo>
# 絕對路徑是必要的：node 的 require() 對相對路徑會當成模組名解析而丟例外，
# 被 catch 吞掉後 round 恆為 0 → Monitor 永遠不 emit
S="$PWD/.clade/work-loop/state.json"; L="$PWD/.clade/work-loop/logs"
r() { node -e 'try{console.log(require(process.argv[1]).round??0)}catch{console.log(0)}' "$S" 2>/dev/null || echo 0; }
prev=$(r); last_change=$(date +%s)
while true; do
  sleep 60
  cur=$(r)
  if [ "$cur" != "$prev" ]; then
    # 摘要一律取 state 的 sessionNote（該輪做了什麼的人讀敘述）＋ roundEndReason。
    # NEVER 退回 tail log：log 尾巴是 `claude --print` 的收尾輸出，多數輪沒有實質內容，
    # 於是 user 每輪只看得到「round N 完成」。
    node -e 'const s=require(process.argv[1]);console.log(`round ${s.round} 完成｜${s.roundEndReason??"?"}｜${(s.sessionNote??"(無 sessionNote)").replace(/\s+/g," ").slice(0,400)}`)' "$S" 2>/dev/null \
      || echo "round $cur 完成（sessionNote 讀取失敗）"
    prev=$cur; last_change=$(date +%s)
  fi
  reason=$(node -e 'try{const s=require(process.argv[1]);if(s.stoppedReason)console.log(s.stoppedReason)}catch{}' "$S" 2>/dev/null)
  [ -n "$reason" ] && { echo "runner stopped: $reason"; break; }
  [ $(( $(date +%s) - last_change )) -ge 5400 ] && { echo "⚠ round 已 90 分鐘沒前進（目前 round=$cur）"; last_change=$(date +%s); }
done
EOF
})
```


## scan helper 的原子邊界

- **temp 與 latest 同目錄**：helper 在 `<repo>/.clade/work-loop/` 建唯一 temp，最後的 rename 才是
  同 filesystem atomic rename；不碰 `/tmp`，也不讓 `mktemp` / `cp` / `mv` 各自觸發 unattended approval。
- **驗證先於 rotate**：JSON malformed 或 `consumerId` 與 git common dir owner 不符時，helper nonzero 並印
  `WORK_LOOP_SCAN_MALFORMED` / `WORK_LOOP_SCAN_MISMATCH`，既有 `scan-latest.json` 原封不動。
- **固定 latest / prev**：驗證通過才 copy latest 到同目錄 prev-temp、atomic publish prev，最後 atomic rename
  temp 成 latest；latest 從不被移走，因此任何 fault window 都不會出現 ENOENT。latest replace 失敗時
  latest 保持舊 snapshot，prev 可能與它相同，這是明確 failure contract。同一輪要回看讀固定路徑，不重跑
  scan。

---

## 起 runner 的形狀與收尾契約

route 表判到 `runner.sh` 之後（含 headroom 判定改判過去的那條），起跑與收尾**全部由主線扛完**：user 不需要自己跑任何指令、不需要輪詢進度、不需要來問它停了沒。

#### (a) 起跑形狀（hard rule）

**MUST** 用 `Bash(run_in_background=true)` 起，指令是 本檔 的絕對路徑形式：

```text
Bash(run_in_background=true):
  cd <目標 repo> && ${CLADE_HOME:-$HOME/offline/clade}/capabilities/core/skills/work-loop/runner.sh --max-rounds 20
```

**NEVER** 在該指令裡加 `nohup`、`disown` 或尾綴 `&`：harness 靠前景同步執行追蹤它，自行背景化會讓收尾通知永遠不會到達（靜默失敗）。

起完 **MUST** 回報 log 目錄、依 (d) 排一次 cache-keepalive heartbeat、依 (e) arm 一個 per-round Monitor，然後結束本輪。三件都做完才算起跑完成。**NEVER** 在主線空等。

**NEVER** 排 wakeup 去**讀 state 檔或 round log 找進度**——退出通知由 harness 送達，輪詢買不到任何它沒給的東西。

「NEVER 輪詢」不蘊含「NEVER 醒來」：(d) 的 heartbeat 仍要做。

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
| `== stop: orphan-quarantine-*`（exit 5） | `inFlight` 非空 / 不可解析，或 quarantine marker 尚未由 attended 清除，**一輪都沒跑**（child-exit guard 除外） | **孤兒 ownership quarantine**：逐字回報 `runnerStopReason`、marker 路徑與 attended reconciliation 要求；**NEVER** 自動 retry、刪 lock 或宣稱 lock 仍由 process 持有 |
| `== 已有 runner 在跑`（exit 6） | **不是故障**：另一個 runner 持鎖，本次一輪都沒跑 | 說出 sessionId / pid 與「不需重起，等它跑完」。**NEVER** 刪鎖、`--force`、接管或再起第二個 runner |

#### (c.1) 連續未前進的 ownership 分流（hard rule）

| 可觀察 predicate | 父層 MUST |
| --- | --- |
| runner 是**本 session** 依 (a) 啟動、background Bash task id 已記錄，且 task 狀態仍是 running | 自主 `TaskStop(<runner task id>)`，再停止 (e) 的 Monitor；讀最後兩輪 log、state 與 lock holder，找出未前進 root cause 並直接修復。**NEVER** `AskUserQuestion`、**NEVER** 把停止責任推給 user |
| runner 是本 session 啟動，但退出 notification 已把 task 標成 completed / failed | runner 已停止，不再對 completed task 呼叫 `TaskStop`；停止 (e) 的 Monitor後立刻做同一套 log/state/lock 調查。**NEVER** `AskUserQuestion` |
| task id / 啟動 session 無法確認，或可確認 runner 屬於別 session | 先 `AskUserQuestion` 確認 ownership，**NEVER** 擅自 `TaskStop`、刪 lock 或接管 |

**Iron Law：本 session 親自啟動的 runner，就是本 session 的 child。違反字面就是違反精神**——「不知道停了會不會有副作用」「先問一下比較保險」都不成立；harness task id 就是 ownership 證據。只有 ownership 不明或屬別 session 才問。

**Red Flag**：看到 `state 連續 2 輪未前進` 後正要把 log 路徑貼給 user、但尚未依 task 狀態停止 running runner（或確認它已退出）並調查最後兩輪——停下，先走本節 ownership 表。

**只有第一列是「跑完了」，其餘每一列都不是。** **NEVER** 把其中任何一列回報成待辦已推完，**也 NEVER** 只摘成功的那幾輪而不提中止——runner 每輪成功都印 `✓ round <n> 完成`，只讀那些行會產出一份看起來順利的假報告。命中 `連續 2 輪 exit≠0` 或 `state 連續 2 輪未前進` 時 **MUST** 一併附 `tail -20 <最後一個 log>`；命中 `preflight 未通過`、`待辦枯竭` 或 `已有 runner 在跑` 時沒有 round log 可附，改附 `preflight.log` 的最後一行。

#### (d) cache-keepalive heartbeat（MUST）

長跑可能跨越 prompt-cache TTL 而主線一次都不醒，下次接手會重付 input token。

起跑回報完成的**同一個 turn 內** MUST 排一次；`<task-id>` 是 background Bash 回傳的 harness task id，`deadline` = 起跑後 9 小時。prompt 與 control-turn 分流一律使用 [[agent-routing.keepalive-wake]] § Async keepalive prompt 的 canonical 形狀，`owner=work-loop-runner`、interval=3300s。

**Iron Law：keepalive prompt 只能判活、重排或收割。** 判活的唯一手段是查 harness task 狀態，**NEVER** 讀 log / state / process table 代替。原任務若含共享資源修改，尤其 publish / propagate，**NEVER** 把原 prompt 或任何可重放原任務的摘要塞進 `ScheduleWakeup`——禁止重複原任務、publish、propagate 或寫檔。

| 可觀察 predicate | 動作 |
| --- | --- |
| `TaskOutput(block=false)` = running，且未到 deadline | 重排同一個 3300s control prompt，本 turn 結束。**NEVER** 讀 state、**NEVER** 讀 log、**NEVER** 貼進度 |
| terminal | 停 heartbeat，排一次 `ASYNC_LIFECYCLE_HANDOFF task=<id> owner=work-loop-runner cause=terminal`；handoff 一般 turn 先 claim task id，**先 `TaskStop` per-round Monitor**，再讀 result、分類 (c)、必要時取 `tail -20`，最後走 (b) 回報 |
| deadline / unknown | 依 [[agent-routing.keepalive-wake]] § Generic keepalive 醒來只做控制面動作 保留 ownership 進 deadline intervention；**確認 terminal 前 NEVER** 讀 result、回報完成或停止 Monitor |

**3300s 貼著 TTL（3600s）訂，NEVER 縮短。** **heartbeat 醒來 NEVER 貼進度**（那要讀 state 或 log，正是 (a) 禁止的）。其餘以 [[agent-routing]] § 主線靜默上限 為 SoT。

#### (e) per-round 進度回報（MUST，與 (d) 同一個 turn 內 arm）

**每輪結束主動回報一行**，事件驅動：輪詢發生在 Monitor 的 shell 端（零主線 turn）。起完 runner **MUST** 立刻 arm 本檔 § per-round Monitor 指令原型——**照抄，NEVER 自己重寫一份**。

| 契約 | 逐字 |
| --- | --- |
| 每輪 emit **一行，且該行 MUST 帶該輪成果摘要** | 內容固定為 `round <n> 完成｜<roundEndReason>｜<sessionNote 前 400 字>`。**NEVER** 貼 log 段落、**NEVER** 額外展開該輪細節——per-round 的 turn 成本壓在 cache_read 量級，400 字上限就是為此 |
| 主線收到該事件後 **MUST 轉述摘要**，不是只回「round N 完成」 | 逐字複述或濃縮 Monitor 那行的 sessionNote 段（**每一輪**都要，不是只在有異常時）——user 對 5–8 小時的 runner 只有這個可見度來源。摘要缺內容時 **MUST** 自己補讀：`node -e 'const s=require(process.argv[1]);console.log(s.sessionNote)' <repo>/.clade/work-loop/state.json`，**NEVER** 把「Monitor 沒給細節」當成可以只回一句「完成」的理由 |
| 失敗訊號要蓋到 | round 前進、`stoppedReason`、90 分鐘沒前進三種都 emit（per `Monitor` tool description § Coverage — silence is not success：只 grep 成功訊號的 monitor 在 crashloop 時與「還在跑」長得一模一樣） |
| 收尾 | runner 退出通知到達 → 走 (b) 回報，並 `TaskStop` 這個 Monitor。**NEVER** 讓它留到 session 結束 |
| 與 (d) 的關係 | **兩個都要**，不是二選一。round 通常 15–25 分 < 55 分，事件本身順帶維持 cache；但 round 卡住超過 55 分時，(d) 的 heartbeat 是唯一還會醒的東西 |

**NEVER 改用 `CLAUDE_CODE_MESSAGING_SOCKET` 把結果 post 回主線的變體**，除非先驗掉主線 inbox socket bind 與 wire format（評估見 `${CLADE_HOME:-$HOME/offline/clade}/docs/discussions/2026-08-08-cross-session-messaging-evaluation.md`）。

## 開場佇列檢查的理由（主檔 Step 0 下推）

> 主檔 pointer：Step 0 § 開場佇列檢查。判準表留主檔；以下是理由與證據邊界。

**理由**：attended 清算是佇列**唯一**的出口（unattended 只跑 `(a) prune`），route 到 runner 之後主線從不進 Step 2.7——佇列因此單調遞增（2026-08-12 實測積到 19 輪）。

**清算是有界的**：幾個詢問操作就結束。runner 起跑時印的那一行待答提示不算出口：它印在 runner 的 log 裡，而打 runner 的前提就是 user 離開座位，佇列照樣積到 19 輪。

本證據決定：待答題是否要在新工作 dispatch 前送達——要；答案未到時只阻擋依賴該答案的 item。
本證據不決定：待辦由誰承載——清算完仍照 route 表判；把它當成選 in-session 的論據，會退回 [[pitfall-work-loop-in-session-default-has-no-context-headroom]] 的 context 空轉。

## Runner child 的 decision-linked dispatch（主檔 Step 1.5 下推）

> 主檔 pointer：本輪是 runner child，且 routing gate 阻擋 Read / Bash 後回傳 `decision_id` 時 MUST 讀本節。

當本輪是 runner child，且 routing gate 阻擋 Read / Bash 後回傳 `decision_id`，該 dispatch 是 Step 1.5
繼續執行的前置，不是可跨 round 收割的工作。依下表 first-match：

| 可觀察 predicate | 執行形狀 |
| --- | --- |
| `$ARGUMENTS` 含 `--runner-child --linked-dispatch-mode foreground`，或 `WORK_LOOP_RUNNER_CHILD=1` | 在**同一個** `claude --print` process 用 foreground `Bash` 呼叫 dispatcher，timeout 600000；等待 exit `0/2/3/4` 後立刻按 routing receipt 分流，再繼續本輪 |
| 非 runner child | 不適用本節，走主檔 Step 1.5 寫的一般路徑 |

Foreground 路徑**不**寫 `inFlight`、不建 background task、也不 arm keepalive：結果已在同一 tool call
回來，沒有未來 notification 可收割。主檔在這條路徑禁用 background 的原因：`claude --print` 回覆後
process 退出，background task ownership 隨之消失；2026-08-14 某 consumer round 46 的 log 只留下
`task ba6yk67mk`，state 停在 round 45。

## runner.sh 的 inFlight mechanical fail-closed（主檔 Step 4 下推）

> 主檔 pointer：Step 4 § Runner child 的 background ownership。同 process wait + harvest 契約留主檔。

runner.sh 另有 mechanical fail-closed：起跑前、每次 child launch 前，以及 child 退出後都檢查
`inFlight`。非空或不可解析時寫入持久 `orphan-quarantine.json`、輸出 `preexisting-inflight-quarantine`
或 `child-exited-with-inflight`、保留 lock 檔並停止，**NEVER 起下一個 child**。process 退出後 lock
的 heartbeat/pid lease 仍可能自然失效；startup marker gate 才負責禁止 retry。這道 guard 只防 orphan
擴大，不取代主檔 Step 4 的同 process wait + harvest 契約。

## runner 為什麼不走 `/handoff`、並行走哪個載體（主檔 Step 4b 下推）

> 主檔 pointer：Step 4b。禁令本體與逐字反開脫留主檔；要在 runner 底下並行推進、或有人主張 relay／fanout 也算派出時 MUST 讀本節。

主檔那條禁令的理由：`relay` 會把位置連同 coordinator 身分交給 successor，
runner 迴圈就沒有主體了；且 `completeRelay()` 要求有 current pane 可交，headless runner child 沒有 pane
時直接回 `relay_refused`。runner 只派 worker、不交位置：outcome 落 durable record，由後續輪次的 Step 2
re-scan 或 `herdr-patrol.ts --stalled` 收。

交位置與並行在 runner 底下有各自的載體：

| 要的是 | 載體 | 誰能用 |
| --- | --- | --- |
| 並行推進多條 worker 工作 | 4a 的 `wt` 扇出組（≤4）、4b 的裸 dispatch（共享同一 working tree ≤2）、`Workflow` script 的 `parallel()` | **runner child 每一輪都可以** |
| 把本 session 的位置交給下一個 | `/handoff` 的 `park` / `relay` / `fanout` / `next` | **只有 attended 收工時**——那本來就是它的場域 |

`fanout` 看起來像「並行」是因為它同時做了兩件事：派 N 個 worker **並且**交出位置給 successor 收割。
runner 要的只有前一半，而後一半由**下一輪 child 的 Step 0 准入**承擔（`harvestReady > 0` 就准入、
該輪只做收割）——不需要任何 pane 交接。

## 工具健檢（Step 2.5）探針非 0 的處置

> 主檔 pointer：Step 2.5 任一探針回非 0 時 MUST 讀本節並照四步做完，缺一不可。

**非 0 的處置**（四步，缺一不可）：

0. **先確認探針路徑在本 repo 成立** —— 「探針寫錯路徑」與「工具真的死了」在 exit code 上**完全同形**，兩者都回非 0 + `MODULE_NOT_FOUND`。產地與投影的路徑不同（上表 main 列即為一例），照抄另一側的路徑會讓整組 item 被誤判成不可用。路徑確認無誤才進第 1 步
1. 把該組標成**本輪不可用**，落進 state 的 `notes`，附**實際 stderr 首行**（不是「壞了」）
2. 該組的 item **全部改走 § Decision packaging**，**NEVER** dispatch、**NEVER** 標 skip
3. 修法若落在別的 repo（clade 投影層、上游工具）→ 修法本身也是一條 packaged 決策，
   **NEVER** 在本 repo 手補投影檔繞過

**實跑擋得住「檔案在但 import 死了」，擋不住「探針量錯檔」**，兩者輸出無法區分——所以第 0 步獨立存在。

## unattended 的裝載準則與 runner-only flag 的理由（主檔 Step 0 § Flags）

> 主檔 pointer：Step 0 § Flags 的 `--unattended` bullet 指向本節。判準本體在主檔，本節只放理由與證據，不複述判準；判準的增修只落主檔。

- **裝載準則（同 Location／同 skill 併輪）**：理由是成本不是整齊——runner 每輪起全新 process，而 git snapshot 每輪變動使 always-load 段整段重付一次冷載（約 90k effective tokens），輪數減半即該固定成本減半（[[TD-433]]，前提實測 median 18.6 分 < 1h cache TTL）。反過來湊滿 cap，只會讓單輪失敗牽連無關 item。
- **`--scan-helper-command`／`--rotate-helper-command`**：runner 以解析後的 clade checkout（`$CLADE_HOME`）把兩者展開成絕對路徑的完整命令。
- **`--min-wakeup-seconds`**：其他 host 依自身 schema 與 harness wait 界限。帶了它就以它為準；短輪詢買不到 notification 沒給的東西（本檔 § 起 runner 的形狀與收尾契約 (d) 已逐字禁止輪詢進度）。

## in-session `/loop` 的每輪收尾表（主檔 Step 0 § Continuous invocation 下推）

> 主檔 pointer：從 `/loop` 呼叫時，**每一次**要排 wakeup 或結束 turn 之前 MUST 讀本節並逐列判。逐列判準只在本表；排 wakeup 的 Iron Law 本體在主檔 Step 0 § Continuous invocation，本節不複述。

由上而下逐列判，first-match：

  | 可觀察 predicate | 動作 |
  | --- | --- |
  | candidate list 還有**未 triage** 或**已判自主但未執行**的 item | **NEVER 排 wakeup。立刻接著跑下一輪**（同一個 turn 內連續跑，不睡） |
  | in-flight ledger > 0，且扇出組還有空位 | **NEVER 排 wakeup。** 補 dispatch，或做主線即時組的工作 |
  | in-flight ledger > 0，扇出組已滿、主線即時組已空 | 只有 adapter 提供已驗證 durable 喚醒時才排 notification safety net；timer 與 bounded wait 依 host schema/harness cadence |
  | 尚未命中 Step 6、所有當前 item 都不可推進（completed / packaged / escalated / legal-skip），**且** in-flight = 0 | 只有已驗證 durable timer 才排 heartbeat；沒有 timer 就保存 state 並結束當前 turn，不假造 scheduled resume |
  | Step 6 停止條件成立 | 取消該 adapter owned 喚醒，**不得**再排 heartbeat |

  adapter 負責 durable 喚醒的 prompt/continuation binding；common 只要求原始 task、ownership 與 state 不重播，停止時取消 owned 喚醒。Claude adapter 可保留 dynamic prompt-preserving sentinel；其他 host 依自身 schema，不假造 timer。

  反藉口實錄（「這輪做了 3 件夠了」「剩下的下一輪再做」等）在 [guardrails.md](guardrails.md) § D。

## 主檔 Step 0／2／2.5 判準的理由（判準本體在主檔，本節不複述）

> 判準只有一份，在主檔 SKILL.md 標示的 Step；本節只放那些判準的理由與證據，不複述判準。判準的增修只落主檔。

- **Step 0 § 起 runner 的形狀與收尾契約，runner child 不讀**：那五條只在 attended 主線起 runner 的那一刻適用。
- **Step 2 scan helper 的失敗判定**：helper 在單一 Node process 內完成 handoff-scan → repo-local 同目錄 temp → JSON parse → git common dir owner `consumerId` 驗證 → latest rotate 成 prev → atomic rename（完整理由見本檔 § scan helper 的原子邊界）。
- **Step 2 scan 不准隔輪跑**：要省的是**同一輪內的重複**，不是輪次覆蓋率。
- **Step 2 `SCAN-MISMATCH` 也算失敗**：它表示讀到別 repo 的掃描結果（unattended 下危害最大：無人在旁審視就照它推進待辦）。
- **Step 2.5 探針要實跑**：scan 回的是**待辦**狀態，不是**工具**狀態。兩者無關：待辦清單完全正常，而推進它們要用的 launcher 早就死了。
