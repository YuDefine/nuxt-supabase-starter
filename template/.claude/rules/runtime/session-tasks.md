---
description: ad-hoc 工作開工前 MUST 先建 per-session task 檔——觸發條件、檔名格式、共享單檔禁令、session context 預算門檻
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/session-tasks.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude task UI and carrier adapter

Claude `TaskCreate` and `TaskUpdate` are progress presentation only; create the per-session tasks file first. Native context thresholds, `/compact`, `/clear`, and headless `claude --print` behavior must be checked against the current launcher profile. `Agent`, `TaskOutput`, `TaskStop`, `AskUserQuestion`, and `run_in_background` are Claude-only surfaces; missing availability is a blocked capability.

## Claude launcher context 預算（MUST）

**Iron Law：越過收工線就收工，不是「等這件做完再說」。而收工線是該 launcher 的 hard tier，不是第一次響的 soft tier。**（門檻見下表。）

本節適用使用下列 Claude launcher 的**每一個** session、**所有** consumer——不是只有覺得跑很久的那次。

### 主判準是可觀察 predicate，token 數字是兜底（MUST）

**切點由下表判，NEVER 由 token 數字判。** Anthropic 官方文檔全站**不給任何** token 門檻——
`/clear` 與 `/compact` 的判準一律是行為型（見下表逐字出處）。官方甚至明寫反向那一半：
*"Sometimes you **should** let context accumulate because you're deep in one complex problem
and the history is valuable"*（[best-practices](https://code.claude.com/docs/en/best-practices)
§ Develop your intuition）。

| 可觀察 predicate | 動作 | 出處 |
| --- | --- | --- |
| 換到**不相關**的任務 / 換 repo / 換主題 | `/clear`，或收工開新 session | 官方 best-practices § Manage context aggressively 逐字 `Run /clear between unrelated tasks` |
| 同一個問題已經糾正 **≥2 次** | `/clear` 重來，把學到的寫進更好的初始 prompt。**NEVER** 在同一段壞掉的 context 上繼續第三次 | 同上 § Course-correct 逐字 |
| 一個 phase / 工作段做完的自然斷點，**且未越過該 launcher 的 hard tier** | `/compact`——**NEVER** 直接跳到「收工開新 session」，見 § 收工訊息契約。越過該 launcher 的 hard tier 之後 `/compact` 不再是選項（見該節門檻閘） | Claude Code 的 context-window 文件 逐字 `before a long new task` |
| 品質退化訊號：開始忘記早前指令、重複犯同一個錯、回答明顯變差 | `/compact` 或收工 | 同上逐字 `when context starts affecting performance` |
| **深在同一個複雜問題中、history 有價值** | **續跑。NEVER 因為 token 數字切** | 官方 best-practices § Develop your intuition 逐字 |

上表沒有任一條觸發時，才輪到下面的 token 兜底層。

**`/clear` 與「同目錄開新 session」同價，NEVER 假設 `/clear` 比較省。** prompt cache 是
server-side、以 **prefix bytes + model** 為 key，**process 身份不在 key 裡**——官方
Claude Code prompt-caching § Cache scope 逐字：
*"Sessions you run in parallel in the same directory build matching prefixes and **read each
other's cache**"*，不同 process 互讀就是證明。官方自己也把 `/clear` 定義成開新 session
（Claude Code costs 逐字 `These totals reset when /clear starts a
new session`）。

> 同一份條文同時支持正解與一個已實際發生的誤讀（實錄見 rationale），所以此處把結論寫死，
> **NEVER** 要求下一個讀者自己從 cache scope 重新推導。
>
> 連帶結論：headless Claude runner 沒有 `/clear`（官方 Claude Code headless
> 頁：terminal-only 命令在 `-p` 模式不可用），但**也不需要**——每次 `claude -p` 本身就是新
> session，依上述等價性沒有多付任何成本。**NEVER** 把「runner 不能 `/clear`」當成 runner 的缺陷。

**launcher profile 是兜底上限，不是切點建議**（native launcher profile 由 Charles 2026-08-06 round 27 拍板；
ccg profile 由 2026-08-31 的 auto-compact 實測收斂；ccx 同日退役，不再接受新 session）。它們的正當性**不**來自「官方建議這個數字」——
官方不建議任何數字——而來自「predicate 全沒觸發時仍需要一條 hard stop」。**NEVER** 把 profile 讀成「跑到這裡就該切」，
那會讓上表第五列（該續跑的那列）永遠輪不到。

> **NEVER** 拿社群單一來源的數字推翻 user 拍板的門檻——一個曾據此提出的 300k→200k 下修提案，
> 查證後理由整條不成立（實錄見 rationale）。

**兩級語義不同，NEVER 當成同一件事的兩個強度**（Charles 2026-08-06 round 27 拍板）：

| launcher profile | soft tier | hard tier | hard repeat |
| --- | ---: | ---: | ---: |
| `cc` / `ccw` | 300k | 500k | +100k |
| `ccg` | 400k | 450k | +50k |
| native work-loop runner child | 500k | 600k | +100k |

`ccx` 已退役：新入口與新 successor 都 fail-closed；既有 process 只做 drain，不再套 numeric
收工線逼它建立另一個 ccx session。既有 Pi 路由的 GPT／Codex 工作走 `cx`；原生 Codex session 依 Codex adapter，不套用本表。需要 Claude 互動式 harness 的既有工作走 `cc`／`ccw`。歷史 transcript 的 `ccx` 歸因仍保留在 audit 層，退役不等於改寫歷史。

| 可觀察 predicate | MUST |
| --- | --- |
| session context 越過**該 launcher 的 soft tier** | **NEVER** 開新的**大**工作段（新的 change / 新的多檔重構 / 新的 spectra phase / **invoke 一個本 session 還沒載過的 skill**）；手上這件做完就收。**小 item 照做**——單檔文字修正、補一條 TD、勾一個 checkbox、回答一個問題不受本級限制 |
| session context 越過**該 launcher 的 hard tier** | **現在**收工，走下面 § 收工三步（先派、後登記、再收工）。手上若是不可分割的驗證迴圈，跑完那一輪就切。**NEVER 用 `/compact` 續跑代替收工**——這一級唯一的出口是 `relay`／`fanout`，判準見 [[session-tasks.operations]] § 收工訊息契約 的門檻閘 |
| 正在跑不可分割的驗證迴圈（單一 test run / 單一 migration） | 跑完再切。**NEVER** 拿「等一下還有事要做」把它延伸成新工作段 |
| **本輪是 work-loop runner child**（`WORK_LOOP_RUNNER_CHILD=1`，由 runner entrypoint 設） | 只有 native launcher 改讀 **500k / 600k**；gateway child 仍走自己的 launcher profile，NEVER 用 runner marker 越過 auto-compact 物理上限 |

**runner child 的 native profile 為什麼不同。** runner child 每輪是 `claude --print` 起的**全新 process**、跨輪不累積——起始載入量是它的**固定成本**，不是累積量，而實測起始就已越過 native soft tier（取證見 rationale）。**NEVER 把 500k / 600k 套到 in-session `/loop` 或 gateway child**——前者 context 真的跨輪累積，後者先受較小 auto-compact window 約束。判別只認 runner entrypoint 設的 env 與 launcher resolver，**NEVER** 從「感覺像無人值守」推斷。

**NEVER 把 soft tier 讀成「什麼都不能開」。** 舊版第一級綁「NEVER 開新的工作段」，對 `/work-loop` 這類一個接一個開 item 的 loop 等於硬停（兩輪腰斬實證見 rationale）。**改的不是數字算錯，是那一級的語義訂錯了**；把 300k 讀回「什麼都不能開」等於把這次拍板退回它要修的狀態。

### 身分豁免：三種身分不受本線約束（Charles 2026-09-02 拍板）

收工線買的是「successor 從 fresh context 起跑」，它的前提是**這個 session 有東西可以交**。
下面三種身分都不成立 —— 對它們發收工提示，是要求一個交不出東西的收件人去執行收工三步：

| 身分 | 機械 marker（hook 認的就是這個） |
| --- | --- |
| in-process subagent（in-process worker tool：Explore / Plan / general-purpose / advisory worker…） | PostToolUse payload 的 `agent_id` / `agent_type`（2026-09-02 probe 實測：主線 payload 完全沒有這兩個 key） |
| Herdr 派出去的顧問 pane | `CLADE_ADVISORY_SESSION=1`，由 `herdr-session-handoff.ts --advisory` 注入 |
| Fable 系列主線 | transcript 尾端的 `"model":"claude-fable*"` |

**NEVER 從工作性質自評身分。** 逐字反開脫：「我這個主線 session 現在做的事很像顧問
（只是讀 code 給建議）」—— 不算，判別只認上面三個 marker。主線就算整輪只讀不寫，
它仍然有殘工要派、仍然受兩級門檻約束。

**這三條 NEVER 是下一段那條「門檻 NEVER 可由 env 放寬」的破口**：它們與 runner-child marker
同型 —— 宣告的是**執行身分**，不是門檻數值。兩組門檻數字仍寫死在 hook 裡，要放寬仍然只有
改 hook 一途。**NEVER** 反過來拿本節論證「所以門檻也可以由 env 調」。

門檻是 `session-context-budget-warn.sh`（PostToolUse hook）機械報出來的，本節是它引用的 SoT：
**每個仍可啟動的 launcher在 soft tier 響一次、hard tier 起依 profile 的 repeat 步長再響**；native runner child 才改讀 **500k / 600k / +100k**。提示走 exit 2 —— PostToolUse 的 exit 0 stderr
只進 debug log，agent 永遠看不到（實錄見 rationale）。

**門檻 NEVER 可由 env / flag 放寬**（曾有的兩個覆寫變數已移除）：門檻是判定 agent 行為合不合格的
數值，只有 user 能調鬆（per `agent-routing` 的自主判定紀律）。會想調鬆它的，正是已經超標的那個
session —— 把閂交給它等於沒有閂。

上表的 runner-child 那列**不是**本條的破口：`WORK_LOOP_RUNNER_CHILD` 不是門檻參數，它是
runner entrypoint 用來宣告**執行身分**的 marker——值由誰設、設成什麼，都不影響任何一組門檻數字。
兩組數字都寫死在 hook 裡，要放寬仍然只有改 hook 一途。**NEVER** 反過來拿這一列論證
「所以其他 env 也可以調門檻」。

## Claude writer forensics

The shared ownership probe runs first. When the available evidence identifies a Claude writer, use this legacy transcript and process sequence to investigate that writer. Transcript filename matches are candidates only; verify an actual write tool event, the exact target path, and its timestamp. This corpus does not cover Codex, Cursor, or human editors.

### Claude transcript / Herdr / runner 探測

取證對象是 Claude writer 時使用下列程序；Herdr 與 transcript 入口先驗證可用。缺少入口保留未知歸因，不將其他 runtime 的寫入者判成不存在。

```bash
# 0) 誰寫的（零訊息、跨 cwd）：<project-dir> 就是對方 cwd。MUST 再篩「寫入型 tool_use ＋
#    落在爭用檔 mtime 時間窗」，再用 agent_session.value 對回 pane
cd ~/.claude-work/projects && grep -l '<檔名或獨特字串>' */*.jsonl
# 1) 誰在這個 repo 家族上工作（linked worktree 的 cwd 是 <repo>-wt/*，MUST 用前綴比對而非等值）
herdr agent list | python3 -c '
import json,sys
for a in json.load(sys.stdin)["result"]["agents"]:
    if a["cwd"].startswith("<repo 絕對路徑，不含尾斜線>"):
        print(a["pane_id"], a["agent_status"], a["terminal_title_stripped"])
'
# 2) 命中的 pane 逐一讀，看它正在做什麼
herdr agent read <pane_id> --source recent-unwrapped --lines 70
# 3) 無論前兩步結論是什麼都 MUST 跑：背景 runner 沒有自己的 pane，第 1 步對它零訊號
pgrep -af 'work-loop/[r]unner\.sh'            # runner 本體
pgrep -af 'claude --print.*[-]-runner-child'  # 它的當輪 child（runner 正在換輪時只剩這個在）
```

**第 0 步 MUST 跑在第 1 步之前，命中就直接問那一個 pane，NEVER 問候選集。** 第 1 步的 cwd 前綴給的是**候選**，**NEVER 當成完整母體**——跨 repo 寫入者結構上不在裡面，候選集全回「不是我的」只代表「母體可能不含答案」，**NEVER** 是「已排除完畢」。只 grep 檔名會假陽性（查的人自己也命中）。盲區與實證見 [[concurrent-session-probe]] § 入口 A 第 0 步。

第 3 步 **MUST 用 `work-loop/[r]unner\.sh` 這個 pattern**，**NEVER** 用 runner entrypoint / `work-loop` / `--unattended` 這類寬 pattern：2026-08-20 於 `~/offline/clade` 實跑 `pgrep -af "work-loop|runner.sh|--unattended"` 回 9 筆，**全是 false positive**（8 筆 `vendor/scripts/pre-push/runner.sh` git hook ＋ pgrep 自己的 shell），真正的 runner 0 筆。方括號防自我匹配：自己的 command line 含字面 `[r]unner`，不匹配 regex `[r]unner`。

