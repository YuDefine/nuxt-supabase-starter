<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 兩種跑法：runner process vs in-session turn

> 主檔 pointer：Step 0 決定怎麼起這個 loop 時 MUST 讀本檔。**已經在跑的輪次不必再讀**——
> 本檔管的是「怎麼起」，不是「怎麼跑」。

| 跑法 | 一輪的邊界 | context | 什麼時候用 |
| --- | --- | --- | --- |
| **`runner.sh`（預設）** | 一個 `claude --print` **process** | **每輪歸零** | 無人值守、待辦多、要跑久。這是本 skill 的主要跑法 |
| in-session `/loop /work-loop` | 一個 turn | 單調成長，數輪後撞頂 | 只想跑一兩輪、或要邊看邊介入 |

```bash
# MUST 用絕對路徑 —— consumer 端沒有 `./plugins/`（skill 由 hub-core plugin 提供，
# 實體在版本化的 plugin cache 路徑下，會隨每次 publish 漂移）。
# runner 自己用 `git rev-parse --show-toplevel` 認 repo，
# 所以**在哪個 repo 的 cwd 跑就作用於哪個 repo**。
cd <目標 repo> && ~/offline/clade/plugins/hub-core/skills/work-loop/runner.sh --max-rounds 20
cd <目標 repo> && ~/offline/clade/plugins/hub-core/skills/work-loop/runner.sh --dry-run
```

**主線起它時 MUST 用 `Bash(run_in_background=true)`，且 NEVER 加 `nohup` / `disown` / 尾綴 `&`**——
形狀、理由、以及退出後的回報契約在 SKILL.md Step 0 § 起 runner 的形狀與收尾契約。上面兩行是給
人看的指令原型，主線照抄時要包進 background Bash call。起跑的**同一則訊息**內還要配齊該節 (d) 的
cache-keepalive heartbeat 與 (e) 的 per-round Monitor——本檔只管指令長什麼樣，配哪些出口以該節為準。
runner heartbeat 是 generic async keepalive，prompt MUST 使用 [[agent-routing]] 的 canonical inert control
message；只有 in-session `/loop /work-loop` 的 dynamic 自我續跑保留原 `/loop` prompt / sentinel。

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

headless 探針要付一次小的 `claude --print` 呼叫，並以顯式 `--preflight` 加 runner 未知 nonce
**實際執行同一支 helper**（含 scanner syntax check、但不寫 scan；helper 以 nonce proof marker
回寫 repo-local 路徑，runner 驗證後立即刪除），換掉的是**整個 run**：2026-08-10 <consumer-b> 因
harness 權限閘門連續拒絕，空轉 99 輪、零待辦被修改。child `exit=0` 仍不構成成功；只有
repo-local nonce proof marker 的內容逐字匹配 runner 產生的 nonce 才通過。helper stdout（包含任何
token 或路徑）僅供診斷，不是 proof；只用 `[ -f ]` 看檔案存在會漏掉 script 無法執行或 scanner parse 失敗。

探針誤判過嚴時走 `--skip-preflight`（`--dry-run` 自動略過 preflight 與待辦源健康門檻），**NEVER** 靠拿掉探針本身解決。`--skip-preflight` **不**略過互斥鎖門檻——鎖被持有不是探針誤判；`--dry-run` 略過互斥鎖門檻（只印指令，不該拒絕）。

### headless child 跟發起點走同一條帳號

preflight 探針與每輪 child 的 **launcher 跟起 runner 的入口對齊**：

| 發起點 | child 呼叫 | 帳號 |
| --- | --- | --- |
| `cc` | 剝 gateway 變數後 `claude --print` | 官方個人（`~/.claude`） |
| `ccw` | 同上，`CLAUDE_CONFIG_DIR=~/.claude-work` | 官方工作 |
| `ccg` | `claudeg --print`（釘 `--model ccg-opus`） | gateway / Grok |
| `ccx` | `claudex --print`（釘 `--model ccx-opus`） | gateway / GPT |

判定看 `ANTHROPIC_DEFAULT_OPUS_MODEL` 是否 `ccg-*` / `ccx-*`，再看 `CLAUDE_CONFIG_DIR` 是否
`~/.claude-work`，其餘當 `cc`。**NEVER** 從 CCG pane 起 runner 卻剝成官方 CC —— 兩池額度
不是同一個，2026-08-20 實測剝完撞 `You've hit your session limit · resets 5am`，gateway 還有額度。

2026-08-19 的 gateway 429（`claude-opus-5` cooling down）是「繼承 CCG env 卻呼叫裸
`claude --print`、沒釘 `ccg-opus`」，gateway 把預設 opus 送到 Codex channel。修法是換 launcher
為 `claudeg`，**不是**永遠剝掉。這種 preflight 失敗 **NEVER** 用 `--skip-preflight` 繞。
ready-count helper 與 lock helper 缺席或輸出無法解析時**放行**：門檻是省成本的優化，NEVER 讓它變成起不了
runner 的新故障。

本證據決定：這四道門要不要前置——要，且要在第一輪之前。
本證據不決定：跑起來之後的停止條件——那仍由下方四種停止原因判定，**NEVER** 拿本節論證「輪次可以更早收掉」。

## 待答決策佇列：runner 只印不擋

runner 起跑時讀 state 的 `awaiting[]`，非空就印一行提示（幾條待答、跑 attended `/work-loop`
可清算），然後**照常開跑**——**NEVER** 因此 exit≠0、**NEVER** 加 flag 要求先清算。

理由是 runner 的使用情境本身：Charles 打這個腳本就是要離開座位，這時擋住等於什麼都不做。
無人值守輪次只排除佇列裡那幾條 item，其餘全部照推（Charles 2026-08-06 逐字：「如果我跑那個
腳本 就不用特別阻擋 就做那些不受影響的」）。清算由下一次 attended 開場的 Step 2.7 承擔。

## 為什麼 in-session 版有天花板

主線 context 每輪只增不減，跑幾輪就進入 TD-378 量到的重 session 區間（peak >200k，這類
session 吞掉 95.5% 的加權配額），然後只能走 decay gate 收工——loop 的價值上限被 context 綁死。

runner 把「一輪」的邊界從 turn 提升到 process：每輪 `claude -p` 是全新 session，讀
`.clade/work-loop/state.json` 重建狀態、做事、寫回、退出。連續性由 state 檔承擔
（durable execution：能 resume 的只有落檔的那份）。

**NEVER** 因為「in-session 比較好觀察」就對長清單用 in-session 版——那是拿 loop 的續航力換
觀察便利，而 runner 每輪都留 log，觀察性沒有損失。

**這條表態的執行面在 SKILL.md Step 0 § Continuous invocation 的 route 判定表**（無人值守意圖或
長清單 → runner；user 明說只跑一兩輪 → in-session；判不出來 → runner）。兩處講同一件事，**改
其中一處 MUST 同步改另一處**——2026-08-06 round 26 / 27 連續兩輪撞 context 門檻收工，成因就是
Step 0 當時寫成無條件 route 到 in-session、與本節相反，而執行時 Step 0 贏。

## runner 停止 vs 換 process

runner 只認 state 檔的 `stoppedReason`（整個 loop 該停）；`roundEndReason`（這個 process 滿了）
會讓它起下一個全新 process 繼續。兩者的語義差別與寫錯的後果見 SKILL.md Step 1。

### 從外面要求它停：寫 sentinel，NEVER 改 `state.stoppedReason`

```bash
echo '停止理由' > "$(git rev-parse --show-toplevel)/.clade/work-loop/stop"
```

runner 在**每輪開始前**檢查它，語義是「當前這輪跑完就停」，不腰斬 in-flight 的一輪。命中後
sentinel 會被消費掉（一次性），下一次起 runner 不受影響。

**NEVER 從外部寫 `state.stoppedReason`**：child 在 Step 1 讀 state、Step 7 把自己那份物件
**整份**寫回，兩點之間任何外部寫入都被 whole-document last-writer-wins 吃掉。2026-08-11 實證
——外部在 round 49 寫入 `stoppedReason` 要求「下一輪做完就停」，round 50 的 child 收尾時把它
蓋掉，runner 毫無所覺地照跑 51、52。**失敗是靜默的**：旗標消失不留任何訊號，外觀與「還沒跑到
停止條件」完全相同。

child **自己**寫 `state.stoppedReason` 仍然有效且是正解——寫它的 child 就是最後一個寫入者、
寫完立刻退出，沒有 clobber 窗口。壞掉的只有**外部**這條路。回歸測試在
`test/work-loop-runner.test.ts`（兩條：sentinel 抗整份覆寫、child 自寫仍有效）。

runner 自己的停止分類：`stoppedReason` 出現、達 `--max-rounds`、連續 2 輪 exit≠0、
round 數連續 2 輪未前進，或 exit 5 的 orphan quarantine、exit 6 的互斥鎖門檻。exit failure streak 與 no-progress streak
彼此獨立，只有 round 真正前進才同時重設；交錯出現不算恢復。

**這四種的語義差別 MUST 出現在收尾回報裡**——只有第一種是「待辦推完」，其餘三種分別是額度用完、
系統性故障、中途夭折。逐列對照表與回報的四個必填項在 SKILL.md Step 0
§ 起 runner 的形狀與收尾契約 (c)。**兩處講同一件事，改其中一處 MUST 同步改另一處。**

## per-round Monitor 指令原型

SKILL.md Step 0 § 起 runner 的形狀與收尾契約 (e) 要 arm 的就是這一份，**照抄，NEVER 自己重寫**
（`<repo>` 換成目標 repo 絕對路徑）。契約表（emit 幾行、主線收到後 MUST 做什麼、收尾怎麼停）留在
該節，本檔只放指令本身。

```text
Monitor({ persistent: true, description: "work-loop round 進度（<repo> ）", command: <<'EOF'
cd <repo>
# 絕對路徑是必要的：node 的 require() 對相對路徑會當成模組名解析而丟例外，
# 被 catch 吞掉後 round 恆為 0 → Monitor 永遠不 emit（2026-08-08 實測踩過）
S="$PWD/.clade/work-loop/state.json"; L="$PWD/.clade/work-loop/logs"
r() { node -e 'try{console.log(require(process.argv[1]).round??0)}catch{console.log(0)}' "$S" 2>/dev/null || echo 0; }
prev=$(r); last_change=$(date +%s)
while true; do
  sleep 60
  cur=$(r)
  if [ "$cur" != "$prev" ]; then
    # 摘要一律取 state 的 sessionNote（該輪做了什麼的人讀敘述）＋ roundEndReason。
    # NEVER 退回 tail log：log 尾巴是 `claude --print` 的收尾輸出，多數輪沒有實質內容，
    # 於是 user 每輪只看得到「round N 完成」（2026-08-11 Charles 回報）。
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

**未採用的變體，NEVER 在沒驗完兩件事之前改用**：`runner.sh` 是主線的 child process，理論上能經
`CLAUDE_CODE_MESSAGING_SOCKET` 把每輪結果 post 回主線 inbox——cross-session messaging 對 own-child
message 的投遞繞過 permission-class hold，且 Linux 連已退出的 child 都能驗證。那條路徑事件驅動、
自帶進度，嚴格優於定時盲醒——**但 (e) 的 Monitor 已經用現成工具拿到同樣的事件驅動與 per-round
進度**，socket 路徑剩下的增量只有「不必 poll state 檔」，不值得為它逆向 wire format。2026-08-08
驗證時卡在兩點：主線 session 未 bind inbox socket，socket 的 wire format 也未逆向出來。**兩件都
驗掉才可改用**；擋住它的 permission-class hold 規則與完整評估見
`~/offline/clade/docs/discussions/2026-08-08-cross-session-messaging-evaluation.md`。

## scan helper 的原子邊界

- **temp 與 latest 同目錄**：helper 在 `<repo>/.clade/work-loop/` 建唯一 temp，最後的 rename 才是
  同 filesystem atomic rename；不再碰 `/tmp`，也不讓 `mktemp` / `cp` / `mv` 各自觸發 unattended approval。
- **驗證先於 rotate**：JSON malformed 或 `consumerId` 與 git common dir owner 不符時，helper nonzero 並印
  `WORK_LOOP_SCAN_MALFORMED` / `WORK_LOOP_SCAN_MISMATCH`，既有 `scan-latest.json` 原封不動。
- **固定 latest / prev**：驗證通過才 copy latest 到同目錄 prev-temp、atomic publish prev，最後 atomic rename
  temp 成 latest；latest 從不被移走，因此任何 fault window 都不會出現 ENOENT。latest replace 失敗時
  latest 保持舊 snapshot，prev 可能與它相同，這是明確 failure contract。同一輪要回看讀固定路徑，不重跑
  scan。2026-08-13 clade round 70 的七份 mid scan 正是這條在防的重跑噪音。

## 工具健檢為什麼要實跑（Step 2.5 的兩段實證）

**為什麼是實跑**：2026-08-05 <consumer-a> 實證——`scripts/lib/detect-runtime.ts` 從未被散播，四支入口
（`dev-session` / `dev-singleton` / `db-lease` / `claims-lib`）全部 `ERR_MODULE_NOT_FOUND`。
**那四支檔案本身都在**，`[ -f ]` 一路綠燈；死的是它們 import 的東西。該輪因此白派了一個 worktree
agent 出去，回來才知道 dev-port 組整組不可用。

**為什麼第 0 步（確認探針路徑）排在實跑之後**：2026-08-06 round 27 於 clade home 實測——
`node scripts/wt-helper.ts list` 回 `MODULE_NOT_FOUND`，而 wt-helper 在產地是
`vendor/scripts/wt-helper.ts`、**完全正常**。照 1–3 步處置會把 main 組 + 扇出組整組標成不可用，
該輪所有 item 走 packaging，空轉一輪——而 clade home 正是 `/work-loop` 目前唯一的實跑場地
（[[TD-395]]）。實跑擋得住「檔案在但 import 死了」，擋不住「探針量錯檔」。
