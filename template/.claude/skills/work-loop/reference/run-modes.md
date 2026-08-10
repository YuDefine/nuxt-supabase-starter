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
破壞性指令一起放行，要更寬鬆 MUST 由使用者顯式指定）。runner 另內建只批准
`Bash(mktemp -t work-loop-scan.XXXXXXXXXX)`，讓 Step 2 的唯一 scan temp path 可在 headless process
建立；其他 Bash 仍照 permission mode 與使用者 permission rules 判定。

每輪 log 落在 `.spectra/work-loop-logs/round-<ts>.log`。

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
`.spectra/work-loop-state.json` 重建狀態、做事、寫回、退出。連續性由 state 檔承擔
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

runner 自己的停止條件：`stoppedReason` 出現、達 `--max-rounds`、連續 2 輪 exit≠0、
或 round 數連續 2 輪未前進（代表那輪沒寫 state，通常是被 lock 擋掉或中途夭折）。

**這四種的語義差別 MUST 出現在收尾回報裡**——只有第一種是「待辦推完」，其餘三種分別是額度用完、
系統性故障、中途夭折。逐列對照表與回報的四個必填項在 SKILL.md Step 0
§ 起 runner 的形狀與收尾契約 (c)。**兩處講同一件事，改其中一處 MUST 同步改另一處。**
