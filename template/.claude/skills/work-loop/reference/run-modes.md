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

`runner.sh` 的 flag：`--max-rounds <n>`（預設 20）、`--dry-run`（只印每輪會下的指令）、
`--permission-mode <mode>`（預設 `acceptEdits`；**NEVER** 預設 `bypassPermissions`——那會連
破壞性指令一起放行，要更寬鬆 MUST 由使用者顯式指定）、`--skip-preflight`、`--min-ready <n>`
（預設 3，0 = 關掉）、`--min-wakeup <秒>`（預設 1200）。runner 另內建只批准
`Bash(mktemp -t work-loop-scan.XXXXXXXXXX)`，讓 Step 2 的唯一 scan temp path 可在 headless process
建立；其他 Bash 仍照 permission mode 與使用者 permission rules 判定。每輪另固定帶模型可見的
`--runner-child` 與 `WORK_LOOP_RUNNER_CHILD=1`；Step 0 命中任一身分就只執行單輪，NEVER 再啟 runner。

每輪 log 落在 `.clade/work-loop/logs/round-<ts>.log`。

## 起跑前的兩道門：跑得起來嗎、有事可做嗎

runner 在跑第一輪之前先過兩道門，任一不過就**一輪都不跑**、理由落在
`.clade/work-loop/logs/preflight.log`：

| 門 | 檢查什麼 | 不過時的 exit code 與語義 |
| --- | --- | --- |
| **preflight** | PATH 上有 `claude` / `node`、repo 可寫、三種待辦源至少一個讀得到、**headless child 真的能跑一個 Bash tool call** | `3` —— 系統性故障，查權限閘門與環境 |
| **待辦源健康門檻** | `work-loop-ready-count.ts` 數出的 ready item ≥ `--min-ready`（預設 3） | `4` —— **待辦枯竭，需 attended 補彈藥**，不是故障 |

headless 探針要付一次小的 `claude --print` 呼叫，換掉的是**整個 run**：2026-08-10 <consumer-b> 因
harness 權限閘門連續拒絕，空轉 99 輪、零待辦被修改。探針同時驗回傳 token 與 `mktemp` 的產出
路徑——只驗 token 會被「模型不呼叫工具、直接回 token」騙過，而那正是要抓的失敗形狀。

探針誤判過嚴時走 `--skip-preflight`（`--dry-run` 自動略過），**NEVER** 靠拿掉探針本身解決。
ready-count helper 缺席或輸出無法解析時**放行**：門檻是省成本的優化，NEVER 讓它變成起不了
runner 的新故障。

本證據決定：這兩道門要不要前置——要，且要在第一輪之前。
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

runner 自己的停止條件：`stoppedReason` 出現、達 `--max-rounds`、連續 2 輪 exit≠0、
或 round 數連續 2 輪未前進。exit failure streak 與 no-progress streak 彼此獨立，只有 round 真正前進
才同時重設；交錯出現不算恢復。

**這四種的語義差別 MUST 出現在收尾回報裡**——只有第一種是「待辦推完」，其餘三種分別是額度用完、
系統性故障、中途夭折。逐列對照表與回報的四個必填項在 SKILL.md Step 0
§ 起 runner 的形狀與收尾契約 (c)。**兩處講同一件事，改其中一處 MUST 同步改另一處。**
