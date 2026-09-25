# 兩種跑法：runner process vs in-session turn


> 主檔 pointer：Step 0 決定怎麼起這個 loop 時 MUST 讀本檔。**已經在跑的輪次不必再讀**——
> 本檔管的是「怎麼起」，不是「怎麼跑」。

## Host selection contract

Choose a runner only when the current host provides a verified same-runtime runner and durable wakeup/receipt surface. Otherwise use an attended in-session round when supported; continuous or unattended execution is blocked and must retain durable state and ownership. Codex and Cursor readers must not execute the Claude commands below.

## Claude host adapter: concrete runner operations

The following `runner.sh`, `claude --print`, `Bash(run_in_background=true)`, `TaskOutput`, `TaskStop`, `ScheduleWakeup`, and `Monitor` examples are Claude-only bindings. They implement the common obligations but do not redefine them for other hosts.

| 跑法 | 一輪的邊界 | context | 什麼時候用 |
| --- | --- | --- | --- |
| **`runner.sh`（預設）** | 一個 `claude --print` **process** | **每輪歸零** | 無人值守、待辦多、要跑久。這是本 skill 的主要跑法 |
| in-session `/loop /work-loop` | 一個 turn | 單調成長，數輪後撞頂 | 只想跑一兩輪、或要邊看邊介入 |

```bash
# MUST 用絕對路徑；在哪個 repo 的 cwd 跑就作用於哪個 repo
cd <目標 repo> && ~/offline/clade/capabilities/core/skills/work-loop/runner.sh --max-rounds 20
cd <目標 repo> && ~/offline/clade/capabilities/core/skills/work-loop/runner.sh --dry-run
```

主線起它的形狀與收尾契約見下方 § 起 runner 的形狀與收尾契約。

`runner.sh` 的 flag：`--max-rounds <n>`（預設 20）、`--dry-run`（只印每輪會下的指令）、
`--permission-mode <mode>`（預設 `acceptEdits`；**NEVER** 預設 `bypassPermissions`——那會連
破壞性指令一起放行，要更寬鬆 MUST 由使用者顯式指定）、`--skip-preflight`、`--min-ready <n>`
（預設 3，0 = 關掉）、`--min-wakeup <秒>`（預設 1200）。runner 另內建只批准該 repo 的
`Bash(node "$HOME/offline/clade/vendor/scripts/work-loop-scan.ts")`（以及顯式 `--preflight`）精確 invocation；helper 在單一 process
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
gateway／退役入口（`ccg`、`ccx`，或任何帶 `ANTHROPIC_BASE_URL` 的 session）會拒絕起跑；GPT／Codex 工作經 Pi dispatcher。

第一次起跑需在 `/overview` 開啟該專案的自動開發，並確保 consumer 已接收 flow 投影、位於
`consumers.local`、官方帳號已登入且 <consumer-f> 快照仍有效。缺少前置時錯誤會指出原因；
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
  cd <目標 repo> && ~/offline/clade/capabilities/core/skills/work-loop/runner.sh --max-rounds 20
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

**NEVER 改用 `CLAUDE_CODE_MESSAGING_SOCKET` 把結果 post 回主線的變體**，除非先驗掉主線 inbox socket bind 與 wire format（評估見 `~/offline/clade/docs/discussions/2026-08-08-cross-session-messaging-evaluation.md`）。
