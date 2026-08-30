<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 互斥鎖 —— budget 計數器窗口與 TD-424 的析取判準

SKILL.md Step 0 § 互斥鎖 的 exit 表、Iron Law、rationalization table 與 Red Flag **留在主檔**——
那些在「正要手寫一個鎖檔」的那一刻必須已經在 context 裡。本檔收的是**改判準時**才需要的成因。

## `continued` 與 `took-over` 讀錯的代價

**`continued` 是 runner 模式的常態**（第 2 輪起每一輪都回它）：同一個 `runner.sh` pid 的上一輪殘鎖，`sessionId` 與 `acquiredAt` 都由 script 保留。**NEVER 把 `continued` 讀成 `took-over`**——那正是 2026-08-13 那份「budget proxy 兩半皆為死碼」的成因：舊版對這一格回 `took-over` ＋ 換新 `sessionId`／`acquiredAt`，於是 runner 下 `subagentsSpawned` 每輪歸零、`lock timestamp` 每輪重設，`>= 15` 與 `≥6h` 兩條**在無人值守下永遠不可能成立**，攔 runaway 只剩 `--max-rounds` / no-progress 2 輪 / 連續失敗 2 輪。判準寫在檔上但不會觸發，與判準不存在的差別只在讀的人以為有防線

## 歸零掛在哪裡

**NEVER 把歸零改掛在 `runner.sh` 起跑。** 兩條理由：in-session `/loop` 沒有 `runner.sh`，掛那裡會讓同一條停止條件在兩種 run mode 語義分裂；且 `runner.sh` 的分工是「不碰 state 內容、連續性全由 child 承擔」，歸零屬於 state 內容。鎖的 acquire 已經是「一次 run」的天然邊界，用它不必另外定義窗口。

## 析取判準（TD-424）

判準是**析取**——`heartbeat 在 45min 窗口內` **或** `pid 存活`，任一成立即為 active。舊版單看 `$$` 的合取判準在 in-session 模式下恆判 stale，鎖從未擋過任何一次（[[TD-424]]）。
